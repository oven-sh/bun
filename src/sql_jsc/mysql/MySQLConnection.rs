use bun_boringssl_sys::OwnedSslCtx;
use bun_collections::{OffsetByteList, VecExt};
use bun_uws::{self as uws, AnySocket as Socket};

use bun_sql::mysql::Capabilities;
use bun_sql::mysql::MySQLQueryResult;
use bun_sql::mysql::auth_method::{AuthMethod, AuthResponse, Transport};
use bun_sql::mysql::capabilities::MariaDBCapabilities;
use bun_sql::mysql::connection_state::ConnectionState;
use bun_sql::mysql::mysql_request;
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::any_mysql_error::{self as any_mysql_error, Error as AnyMySQLError};
use bun_sql::mysql::protocol::auth as Auth;
use bun_sql::mysql::protocol::auth_switch_request::AuthSwitchRequest;
use bun_sql::mysql::protocol::character_set::CharacterSet;
use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::mysql::protocol::eof_packet::EOFPacket;
use bun_sql::mysql::protocol::handshake_response41::HandshakeResponse41;
use bun_sql::mysql::protocol::handshake_v10::HandshakeV10;
use bun_sql::mysql::protocol::new_reader::{NewReader, ReaderContext};
use bun_sql::mysql::protocol::new_writer::{NewWriterWrap as NewWriter, WriterContext};
use bun_sql::mysql::protocol::ok_packet::OKPacket;
use bun_sql::mysql::protocol::packet_header::PacketHeader;
use bun_sql::mysql::protocol::packet_type::PacketType;
use bun_sql::mysql::protocol::prepared_statement::ExecuteParam;
use bun_sql::mysql::protocol::result_set_header::ResultSetHeader;
use bun_sql::mysql::protocol::ssl_request::SSLRequest;
use bun_sql::mysql::protocol::stack_reader::{PacketReader, StackReader};
use bun_sql::mysql::protocol::stmt_prepare_ok_packet::StmtPrepareOKPacket;
use bun_sql::mysql::status_flags::{StatusFlag, StatusFlags};
use bun_sql::mysql::tls_status::TLSStatus;
use bun_sql::postgres::socket_monitor as SocketMonitor;
use bun_sql::shared::SSLMode;
use bun_sql::shared::connection_flags::ConnectionFlags;
use bun_sql::shared::data::Data;

use crate::mysql::js_my_sql_connection::JSMySQLConnection;
use crate::mysql::js_my_sql_query::JSMySQLQuery;
use crate::mysql::my_sql_request_queue::MySQLRequestQueue;
use crate::mysql::my_sql_statement::{self as mysql_statement, MySQLStatement, StatementCache};
use crate::shared::start_tls::{StartTlsError, start_tls, verifies_certificate};
use bun_jsc::rare_data::SocketGroups;
use bun_ptr::RefPtr;

pub use bun_sql::mysql::connection_state::ConnectionState as Status;
pub use bun_sql::mysql::protocol::error_packet::ErrorPacket;

use crate::jsc::api::server_config::SSLConfig;

bun_core::define_scoped_log!(debug, MySQLConnection, visible);

pub struct MySQLConnection {
    socket: Socket,
    pub(crate) status: ConnectionState,

    write_buffer: OffsetByteList,
    read_buffer: OffsetByteList,
    last_message_start: usize,
    /// The one behind the last packet that was read.
    sequence_id: u8,
    /// The reply to the head of the queue has begun: its next packet has `sequence_id`. The first
    /// one has no id to expect: it counts on from the packets of the command, not all of which a
    /// server reads before it refuses them, and an ERR that nobody asked for has 0.
    in_reply: bool,

    // TODO: move it to JSMySQLConnection
    pub(crate) queue: MySQLRequestQueue,
    // TODO: move it to JSMySQLConnection
    statements: StatementCache,

    server_version: Vec<u8>,
    connection_id: u32,
    capabilities: Capabilities,
    mariadb_capabilities: MariaDBCapabilities,
    character_set: CharacterSet,
    status_flags: StatusFlags,

    auth_plugin: Option<AuthMethod>,
    auth_switch_count: u8,
    full_auth_requested: bool,

    auth_data: Auth::Nonce,
    database: Box<[u8]>,
    user: Box<[u8]>,
    password: Box<[u8]>,
    secure: Option<OwnedSslCtx>,
    tls_config: SSLConfig,
    tls_status: TLSStatus,
    ssl_mode: SSLMode,
    allow_public_key_retrieval: bool,
    unix_socket: bool,
    flags: ConnectionFlags,
}

impl Default for MySQLConnection {
    fn default() -> Self {
        Self {
            socket: Socket::SocketTcp(uws::SocketTCP::detached()),
            status: ConnectionState::Connecting,
            write_buffer: OffsetByteList::default(),
            read_buffer: OffsetByteList::default(),
            last_message_start: 0,
            sequence_id: 0,
            in_reply: false,
            queue: MySQLRequestQueue::init(),
            statements: StatementCache::default(),
            server_version: Vec::<u8>::default(),
            connection_id: 0,
            capabilities: Capabilities::default(),
            mariadb_capabilities: MariaDBCapabilities::default(),
            character_set: CharacterSet::default(),
            status_flags: StatusFlags::default(),
            auth_plugin: None,
            auth_switch_count: 0,
            full_auth_requested: false,
            auth_data: [0; Auth::NONCE_LENGTH],
            database: Box::default(),
            user: Box::default(),
            password: Box::default(),
            secure: None,
            tls_config: SSLConfig::default(),
            tls_status: TLSStatus::None,
            ssl_mode: SSLMode::Disable,
            allow_public_key_retrieval: false,
            unix_socket: false,
            flags: ConnectionFlags::default(),
        }
    }
}

// SAFETY: `MySQLConnection` is the `connection` field embedded inside
// `JSMySQLConnection`; never constructed standalone.
bun_core::impl_field_parent! { MySQLConnection => JSMySQLConnection.connection; fn js_connection_ref; fn mut get_js_connection; fn shared js_connection; }

impl MySQLConnection {
    pub(crate) fn init(
        database: Box<[u8]>,
        username: Box<[u8]>,
        password: Box<[u8]>,
        tls_config: SSLConfig,
        secure: Option<OwnedSslCtx>,
        ssl_mode: SSLMode,
        allow_public_key_retrieval: bool,
        unix_socket: bool,
        found_rows: bool,
    ) -> Self {
        Self {
            capabilities: Capabilities::get_default_capabilities(
                ssl_mode != SSLMode::Disable,
                !database.is_empty(),
                found_rows,
            ),
            database,
            user: username,
            password,
            tls_config,
            secure,
            ssl_mode,
            allow_public_key_retrieval,
            unix_socket,
            tls_status: if ssl_mode != SSLMode::Disable {
                TLSStatus::Pending
            } else {
                TLSStatus::None
            },
            ..Default::default()
        }
    }

    #[inline]
    pub(crate) fn is_able_to_write(&self) -> bool {
        self.status == ConnectionState::Connected
            && !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE)
            && self.write_buffer.len() < MAX_PIPELINE_SIZE
    }

    #[inline]
    pub(crate) fn is_processing_data(&self) -> bool {
        self.flags.contains(ConnectionFlags::IS_PROCESSING_DATA)
    }
    #[inline]
    pub(crate) fn has_backpressure(&self) -> bool {
        self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE)
    }
    #[inline]
    pub(crate) fn reset_backpressure(&mut self) {
        self.flags.remove(ConnectionFlags::HAS_BACKPRESSURE);
    }

    #[inline]
    pub(crate) fn can_flush(&self) -> bool {
        !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) // if has backpressure we need to wait for onWritable event
            && self.status == ConnectionState::Connected // and we need to be connected
            // we need data to send
            && (self.write_buffer.len() > 0 || self.queue.is_waiting_to_write())
    }

    #[inline]
    pub(crate) fn is_idle(&self) -> bool {
        self.queue.current().is_none() && self.write_buffer.len() == 0
    }

    /// As of the last reply that said so: an ERR packet has no status.
    #[inline]
    pub(crate) fn is_in_transaction(&self) -> bool {
        self.status_flags.has(StatusFlag::SERVER_STATUS_IN_TRANS)
    }

    #[inline]
    pub(crate) fn take_on_connect_pending(&mut self) -> bool {
        let pending = self.flags.contains(ConnectionFlags::ON_CONNECT_PENDING);
        self.flags.remove(ConnectionFlags::ON_CONNECT_PENDING);
        pending
    }

    #[inline]
    pub(crate) fn is_unix_socket(&self) -> bool {
        self.unix_socket
    }

    fn transport(&self) -> Transport {
        if self.tls_status == TLSStatus::SslOk {
            Transport::Tls
        } else if self.unix_socket {
            Transport::UnixSocket
        } else {
            Transport::Tcp
        }
    }

    pub(crate) fn flush_queue(&mut self) -> Result<(), FlushQueueError> {
        self.flush_data();
        if self.tls_status == TLSStatus::MessageSent {
            if !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) {
                self.upgrade_to_tls()?;
            }
            return Ok(());
        }
        // Under backpressure too: the next reply is for the request behind the one that just ended.
        self.advance();
        self.flush_data();
        Ok(())
    }

    fn advance(&mut self) {
        MySQLRequestQueue::advance(self.js_connection_ref());
    }

    fn flush_data(&mut self) {
        // we know we still have backpressure so just return we will flush later
        if self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) {
            debug!("flushData: has backpressure");
            return;
        }

        let chunk = self.write_buffer.remaining();
        if chunk.is_empty() {
            return;
        }

        let wrote = self.socket.write(chunk);
        self.flags.set(
            ConnectionFlags::HAS_BACKPRESSURE,
            usize::try_from(wrote).unwrap_or(0) < chunk.len(),
        );
        debug!("flushData: wrote {}/{} bytes", wrote, chunk.len());
        if wrote > 0 {
            let wrote_usize = usize::try_from(wrote).expect("int cast");
            SocketMonitor::write(&chunk[0..wrote_usize]);
            self.write_buffer.consume(wrote_usize);
        }
    }

    pub(crate) fn socket(&self) -> Socket {
        self.socket
    }

    pub(crate) fn discard_write_buffer(&mut self) {
        self.write_buffer = OffsetByteList::default();
    }

    pub(crate) fn upgrade_to_tls(&mut self) -> Result<(), FlushQueueError> {
        let started = start_tls(
            self.get_js_connection(),
            self.socket,
            (uws::SocketKind::MysqlTls, SocketGroups::mysql_group::<true>),
            self.secure.as_ref(),
            &self.tls_config,
            self.ssl_mode,
            |socket| self.socket = socket,
        );
        match started {
            Err(StartTlsError::Failed) => Err(FlushQueueError::AuthenticationFailed),
            // `NotPlain`: the handshake is under way.
            _ => Ok(()),
        }
    }

    pub(crate) fn set_socket(&mut self, socket: Socket) {
        self.socket = socket;
    }

    pub(crate) fn is_active(&self) -> bool {
        self.status != ConnectionState::Failed
    }

    /// verify-full's name check, asked inside the handshake.
    pub fn server_identity(
        &self,
        ssl: &mut bun_boringssl_sys::SSL,
    ) -> bun_boringssl::ServerIdentity {
        bun_boringssl::server_identity(ssl, self.native_identity_hostname())
    }

    /// The name verify-full matches, in and after the handshake. Empty (none configured) matches no certificate.
    /// `tls.checkServerIdentity` replaces the match, as in Node.
    fn native_identity_hostname(&self) -> Option<&[u8]> {
        (self.tls_config.reject_unauthorized() != 0
            && self.ssl_mode == SSLMode::VerifyFull
            && self
                .js_connection()
                .check_server_identity_callback()
                .is_none())
        .then(|| self.server_name())
    }

    pub(crate) fn server_name(&self) -> &[u8] {
        self.tls_config.server_name_bytes()
    }

    pub(crate) fn verifies_certificate(&self) -> bool {
        verifies_certificate(&self.tls_config, self.ssl_mode)
    }

    /// A server can renegotiate, which ends in another handshake event.
    pub(crate) fn awaits_tls_handshake(&self) -> bool {
        self.tls_status == TLSStatus::MessageSent
    }

    /// Whether `sslmode` accepts what the TLS handshake gave.
    pub(crate) fn do_handshake(
        &mut self,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) -> bool {
        bun_core::scoped_log!(
            MySQLConnection,
            "onHandshake: {} {} {:?}",
            success,
            ssl_error.error_no,
            self.ssl_mode
        );
        let handshake_success = success == 1;
        self.sequence_id = self.sequence_id.wrapping_add(1);
        if handshake_success {
            self.tls_status = TLSStatus::SslOk;
            if self.tls_config.reject_unauthorized() != 0 {
                // follow the same rules as postgres
                // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279
                // only reject the connection if reject_unauthorized == true
                match self.ssl_mode {
                    SSLMode::VerifyCa | SSLMode::VerifyFull => {
                        if ssl_error.error_no != 0 {
                            self.tls_status = TLSStatus::None;
                            return false;
                        }

                        // VerifyFull additionally requires the certificate identity to
                        // match the intended host. Absence of a configured server name is
                        // not a license to skip the check — fail closed.
                        let identity_ok = self.native_identity_hostname().is_none_or(|hostname| {
                            // SAFETY: native handle of a connected TLS socket is `SSL*`.
                            let ssl_ptr: *mut bun_boringssl_sys::SSL = self
                                .socket
                                .get_native_handle()
                                .map(|h| h.cast())
                                .unwrap_or(core::ptr::null_mut());
                            !hostname.is_empty()
                                && !ssl_ptr.is_null()
                                && uws::check_server_identity(
                                    // SAFETY: `ssl_ptr` is non-null (checked by the short-circuit above) and live (handshake just succeeded).
                                    unsafe { &mut *ssl_ptr },
                                    hostname,
                                )
                        });
                        if !identity_ok {
                            self.tls_status = TLSStatus::None;
                            return false;
                        }
                    }
                    // require is the same as prefer
                    SSLMode::Require | SSLMode::Prefer | SSLMode::Disable => {}
                }
            }
            return true;
        }
        self.tls_status = TLSStatus::None;
        // if we are here is because server rejected us, and the error_no is the cause of this
        // no matter if reject_unauthorized is false because we are disconnected by the server
        false
    }

    pub(crate) fn read_and_process_data(&mut self, data: &[u8]) -> Result<(), AnyMySQLError> {
        self.flags.insert(ConnectionFlags::IS_PROCESSING_DATA);
        // The flag clear is hand-inlined before every return below
        // (scopeguard would need &mut self.flags).

        SocketMonitor::read(data);

        if self.read_buffer.remaining().is_empty() {
            // StackReader takes `&Cell<usize>` (interior mutability)
            // so the post-error read of `offset`/`consumed` doesn't conflict.
            let consumed = core::cell::Cell::new(0usize);
            let offset = core::cell::Cell::new(0usize);
            let reader = StackReader::init(data, &consumed, &offset);
            match self.process_packets(reader) {
                Ok(()) => {}
                Err(err) => {
                    debug!(
                        "processPackets without buffer: {}",
                        <&'static str>::from(err)
                    );
                    if err == any_mysql_error::Error::ShortRead {
                        #[cfg(debug_assertions)]
                        debug!(
                            "Received short read: last_message_start: {}, head: {}, len: {}",
                            offset.get(),
                            consumed.get(),
                            data.len()
                        );

                        self.read_buffer.head = 0;
                        self.last_message_start = 0;
                        self.read_buffer.byte_list.clear();
                        self.read_buffer
                            .write(&data[offset.get()..])
                            .unwrap_or_else(|_| panic!("failed to write to read buffer"));
                    } else {
                        bun_core::handle_error_return_trace(err);
                        self.flags.remove(ConnectionFlags::IS_PROCESSING_DATA);
                        return Err(err);
                    }
                }
            }
            self.flags.remove(ConnectionFlags::IS_PROCESSING_DATA);
            return Ok(());
        }

        {
            self.read_buffer.head = self.last_message_start;

            self.read_buffer
                .write(data)
                .unwrap_or_else(|_| panic!("failed to write to read buffer"));
            let reader = self.buffered_reader();
            match self.process_packets(reader) {
                Ok(()) => {}
                Err(err) => {
                    debug!("processPackets with buffer: {}", <&'static str>::from(err));
                    if err != any_mysql_error::Error::ShortRead {
                        bun_core::handle_error_return_trace(err);
                        self.flags.remove(ConnectionFlags::IS_PROCESSING_DATA);
                        return Err(err);
                    }

                    if cfg!(debug_assertions) {
                        bun_core::scoped_log!(
                            MySQLConnection,
                            "Received short read: last_message_start: {}, head: {}, len: {}",
                            self.last_message_start,
                            self.read_buffer.head,
                            self.read_buffer.byte_list.len()
                        );
                    }

                    self.flags.remove(ConnectionFlags::IS_PROCESSING_DATA);
                    return Ok(());
                }
            }

            self.last_message_start = 0;
            self.read_buffer.head = 0;
        }
        self.flags.remove(ConnectionFlags::IS_PROCESSING_DATA);
        Ok(())
    }

    /// Frames the packets. `ShortRead` (wait for the socket) comes from here and from nowhere else.
    pub(crate) fn process_packets<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
    ) -> Result<(), AnyMySQLError> {
        loop {
            reader.mark_message_start();

            let header = PacketHeader::decode(reader.peek()).ok_or(AnyMySQLError::ShortRead)?;
            let packet_length: usize = header.length as usize + PacketHeader::SIZE;
            debug!(
                "sequence_id: {} header: {}",
                self.sequence_id, header.length
            );
            reader.ensure_capacity(packet_length)?;
            if header.length as usize == PacketHeader::MAX_PAYLOAD_LENGTH {
                self.process_split_packet(reader)?;
                continue;
            }
            let payload = &reader.peek()[PacketHeader::SIZE..packet_length];
            reader.set_offset_from_start(packet_length);
            self.handle_packet(
                payload,
                header.sequence_id,
                header.sequence_id.wrapping_add(1),
            )?;
            // After the SSLRequest, bytes already buffered behind this packet are plaintext a
            // man-in-the-middle could have injected (CVE-2021-23222 class).
            if self.tls_status == TLSStatus::MessageSent && !reader.peek().is_empty() {
                return Err(AnyMySQLError::UnexpectedPacket);
            }
        }
    }

    /// `payload` is one whole packet, so a handler cannot read into the next one.
    /// It came with `sequence_id`, and `next_sequence_id` is the one behind its last part.
    fn handle_packet(
        &mut self,
        payload: &[u8],
        sequence_id: u8,
        next_sequence_id: u8,
    ) -> Result<(), AnyMySQLError> {
        let in_step = !self.in_reply || sequence_id == self.sequence_id;
        self.sequence_id = next_sequence_id;
        self.in_reply = self.status == ConnectionState::Connected;

        let mut cursor: usize = 0;
        let mut message_start: usize = 0;
        let reader: PacketReader<'_> = StackReader::init(payload, &mut cursor, &mut message_start);
        match self.status {
            ConnectionState::Handshaking => self.handle_handshake(reader),
            ConnectionState::Authenticating | ConnectionState::AuthenticationAwaitingPk => {
                self.handle_auth(reader)
            }
            ConnectionState::SessionSetup => self.handle_session_setup(reader),
            ConnectionState::Connected if in_step => self.handle_command(reader),
            ConnectionState::Connected => self.handle_unasked(reader),
            _ => {
                debug!("Unexpected packet in state {}", self.status as u8);
                Err(AnyMySQLError::UnexpectedPacket)
            }
        }
    }

    fn handle_handshake(&mut self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        // A server that takes no connection, or none from this host, says so in place of its greeting.
        if reader.peek().first() == Some(&PacketType::ERROR.0) {
            return self.handle_unasked(reader);
        }
        let mut handshake = HandshakeV10::default();
        handshake.decode_internal(reader)?;
        self.server_version = handshake
            .server_version
            .to_owned()
            .map_err(|_| AnyMySQLError::OutOfMemory)?;
        self.connection_id = handshake.connection_id;
        // Negotiate capabilities: only request capabilities that the server also supports.
        // Per MySQL protocol, the client MUST intersect its desired capabilities with the
        // server's advertised capabilities. This ensures features like CLIENT_DEPRECATE_EOF
        // are only used when the server actually supports them (critical for MySQL-compatible
        // databases like StarRocks, TiDB, SingleStore, etc.).
        self.capabilities = self.capabilities.intersect(handshake.capability_flags);
        self.mariadb_capabilities = MariaDBCapabilities::get_default_capabilities()
            .intersect(handshake.mariadb_capability_flags);

        // Override with utf8mb4 instead of using server's default
        self.character_set = CharacterSet::default();
        self.status_flags = handshake.status_flags;

        bun_core::scoped_log!(
            MySQLConnection,
            "Handshake\n   Server Version: {}\n   Connection ID:  {}\n   Character Set:  {} ({})\n   Server Capabilities:   [ {} ] 0x{:08x}\n   Negotiated Capabilities: [ {} ] 0x{:08x}\n   Status Flags:   [ {} ]\n",
            bstr::BStr::new(self.server_version.slice()),
            self.connection_id,
            u32::from(self.character_set.to_int()),
            bstr::BStr::new(self.character_set.label()),
            handshake.capability_flags,
            handshake.capability_flags.to_int(),
            self.capabilities,
            self.capabilities.to_int(),
            self.status_flags
        );

        self.auth_data = handshake.auth_plugin_data;

        if !handshake.auth_plugin_name.slice().is_empty() {
            self.auth_plugin = Some(self.auth_plugin_named(handshake.auth_plugin_name.slice())?);
        }

        self.set_status(ConnectionState::Authenticating);

        // https://dev.mysql.com/doc/dev/mysql-server/8.4.6/page_protocol_connection_phase_packets_protocol_ssl_request.html
        if self.capabilities.CLIENT_SSL {
            let mut response = SSLRequest {
                capability_flags: self.capabilities,
                mariadb_capability_flags: self.mariadb_capabilities,
                max_packet_size: 0, // 16777216,
                character_set: CharacterSet::default(),
                // bun always send connection attributes
                has_connection_attributes: true,
            };
            let mut w = self.writer();
            response.write_internal(&mut w)?;
            self.capabilities = response.capability_flags;
            self.tls_status = TLSStatus::MessageSent;
            self.flush_data();
            if !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) {
                self.upgrade_to_tls()
                    .map_err(|_| AnyMySQLError::AuthenticationFailed)?;
            }
            return Ok(());
        }
        if self.tls_status != TLSStatus::None {
            self.tls_status = TLSStatus::None;

            match self.ssl_mode {
                // The server did not advertise CLIENT_SSL. `require` and
                // stricter must fail rather than silently continue in
                // plaintext (matches the Postgres driver's TLSNotAvailable
                // handling).
                SSLMode::Require | SSLMode::VerifyCa | SSLMode::VerifyFull => {
                    return Err(AnyMySQLError::AuthenticationFailed);
                }
                SSLMode::Prefer | SSLMode::Disable => {}
            }
        }
        self.send_handshake_response()
    }

    fn auth_plugin_named(&mut self, name: &[u8]) -> Result<AuthMethod, AnyMySQLError> {
        AuthMethod::from_string(name).ok_or_else(|| {
            self.js_connection_ref().fail_fmt(
                AnyMySQLError::UnsupportedAuthPlugin,
                format_args!(
                    "{}: {}",
                    AnyMySQLError::UnsupportedAuthPlugin,
                    bstr::BStr::new(name)
                ),
            );
            AnyMySQLError::UnsupportedAuthPlugin
        })
    }

    fn handle_handshake_decode_public_key(
        &mut self,
        reader: PacketReader<'_>,
    ) -> Result<(), AnyMySQLError> {
        let mut response = Auth::caching_sha2_password::PublicKeyResponse::default();
        response.decode(reader)?;
        // revert back to authenticating since we received the public key
        self.set_status(ConnectionState::Authenticating);

        let encrypted_password = Auth::caching_sha2_password::EncryptedPassword {
            password: bun_ptr::RawSlice::new(&self.password),
            public_key: bun_ptr::RawSlice::new(response.data.slice()),
            nonce: self.auth_data,
            sequence_id: self.sequence_id,
        };
        encrypted_password.write(self.writer())?;
        self.flush_data();
        Ok(())
    }

    pub(crate) fn set_status(&mut self, status: ConnectionState) {
        if self.status == status {
            return;
        }

        self.status = status;

        if status == ConnectionState::Connected {
            self.flags.insert(ConnectionFlags::ON_CONNECT_PENDING);
        }
    }

    fn handle_auth(&mut self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1isize);

        bun_core::scoped_log!(MySQLConnection, "Auth packet: 0x{:02x}", first_byte);

        match first_byte {
            x if x == PacketType::OK.0 => {
                let mut ok = OKPacket::default();
                ok.decode_internal(reader)?;

                self.status_flags = ok.status_flags;
                self.send_session_setup()?;
            }

            x if x == PacketType::ERROR.0 => {
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;

                self.js_connection_ref().on_error_packet(None, &err);
                return Err(AnyMySQLError::AuthenticationFailed);
            }

            x if x == PacketType::MORE_DATA.0 => {
                if let Some(plugin) = self.auth_plugin {
                    match plugin {
                        AuthMethod::Sha256Password | AuthMethod::CachingSha2Password => {
                            reader.skip(1);

                            if self.status == ConnectionState::AuthenticationAwaitingPk {
                                return self.handle_handshake_decode_public_key(reader);
                            }

                            let mut response = Auth::caching_sha2_password::Response::default();
                            response.decode(reader)?;

                            match response.status {
                                Auth::caching_sha2_password::FastAuthStatus::SUCCESS => {
                                    // fast_auth_success only acknowledges the cached scramble; the
                                    // server always follows it with the OK/ERR packet that concludes
                                    // auth, so stay in Authenticating and let the arms above consume it.
                                    debug!("fast auth success, awaiting OK");
                                }
                                Auth::caching_sha2_password::FastAuthStatus::CONTINUE_AUTH => {
                                    bun_core::scoped_log!(MySQLConnection, "continue auth");

                                    if self.full_auth_requested {
                                        return Err(AnyMySQLError::UnexpectedPacket);
                                    }
                                    self.full_auth_requested = true;

                                    self.send_auth_response(plugin, true)?;
                                }
                                _ => {
                                    return Err(AnyMySQLError::AuthenticationFailed);
                                }
                            }
                        }
                        _ => {
                            bun_core::scoped_log!(
                                MySQLConnection,
                                "Unexpected auth continuation for plugin: {:?}",
                                plugin
                            );
                            return Err(AnyMySQLError::UnexpectedPacket);
                        }
                    }
                } else {
                    bun_core::scoped_log!(
                        MySQLConnection,
                        "Received auth continuation without plugin"
                    );
                    return Err(AnyMySQLError::UnexpectedPacket);
                }
            }

            PacketType::AUTH_SWITCH => {
                let mut auth_switch = AuthSwitchRequest::default();
                auth_switch.decode_internal(reader)?;

                let auth_method = self.auth_plugin_named(auth_switch.plugin_name.slice())?;

                // Bound a hostile server's auth ping-pong.
                if self.auth_switch_count >= 2
                    || (self.auth_switch_count > 0 && self.auth_plugin == Some(auth_method))
                {
                    bun_core::scoped_log!(
                        MySQLConnection,
                        "rejecting AuthSwitchRequest (count={}, plugin={:?})",
                        self.auth_switch_count,
                        auth_method
                    );
                    return Err(AnyMySQLError::UnexpectedPacket);
                }
                self.auth_switch_count += 1;

                self.auth_plugin = Some(auth_method);
                self.auth_data = Auth::nonce(auth_switch.plugin_data.slice())?;

                self.send_auth_response(auth_method, false)?;
            }

            _ => {
                bun_core::scoped_log!(
                    MySQLConnection,
                    "Unexpected auth packet: 0x{:02x}",
                    first_byte
                );
                return Err(AnyMySQLError::UnexpectedPacket);
            }
        }
        Ok(())
    }

    /// The Date codec (`MySQLValue.rs`) is UTC on both ends, but the server
    /// converts TIMESTAMP columns through `@@session.time_zone` (#40435).
    fn send_session_setup(&mut self) -> Result<(), AnyMySQLError> {
        self.set_status(ConnectionState::SessionSetup);
        mysql_request::execute_query(b"SET time_zone = '+00:00'", self.writer())?;
        self.flush_data();
        Ok(())
    }

    fn handle_session_setup(&mut self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1isize);

        match first_byte {
            x if x == PacketType::OK.0 => {
                let mut ok = OKPacket::default();
                ok.decode_internal(reader)?;

                self.set_status(ConnectionState::Connected);

                self.status_flags = ok.status_flags;
                self.advance();
                Ok(())
            }
            x if x == PacketType::ERROR.0 => {
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;

                self.js_connection_ref().on_error_packet(None, &err);
                Err(AnyMySQLError::ConnectionFailed)
            }
            _ => {
                bun_core::scoped_log!(
                    MySQLConnection,
                    "Unexpected session-setup packet: 0x{:02x}",
                    first_byte
                );
                Err(AnyMySQLError::UnexpectedPacket)
            }
        }
    }

    fn handle_command(&mut self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        let Some(request) = self.queue.current().filter(|r| r.is_in_flight()) else {
            return self.handle_unasked(reader);
        };
        match request.get_statement().map(|statement| statement.status) {
            Some(mysql_statement::Status::Parsing) => self.handle_prepared_statement(reader),
            Some(mysql_statement::Status::Prepared) => self.handle_result_set(reader),
            _ => Err(AnyMySQLError::UnexpectedPacket),
        }
    }

    /// No request waits for this packet, or it is not the next one of the reply that has begun:
    /// whose it is cannot be told. Always `Err`, which fails the connection.
    fn handle_unasked(&mut self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        // The ERR that says why the server drops the connection (KILL, wait_timeout).
        if reader.peek().first() == Some(&PacketType::ERROR.0) {
            let mut err = ErrorPacket::default();
            err.decode_internal(reader)?;
            self.js_connection_ref().on_error_packet(None, &err);
            return Err(AnyMySQLError::ConnectionClosed);
        }
        debug!("Received unexpected command response");
        Err(AnyMySQLError::UnexpectedPacket)
    }

    pub(crate) fn send_handshake_response(&mut self) -> Result<(), AnyMySQLError> {
        debug!("sendHandshakeResponse");
        let writer = self.writer();
        let mut scrambled_buf = [0u8; 32];
        let auth_response = match self.auth_plugin {
            Some(plugin) => plugin.first_response(
                &self.password,
                &self.auth_data,
                self.transport(),
                &mut scrambled_buf,
            ),
            None => AuthResponse::Scramble(&[]),
        };
        let awaits_public_key = self.awaits_public_key(&auth_response)?;

        let mut response = HandshakeResponse41 {
            capability_flags: self.capabilities,
            mariadb_capability_flags: self.mariadb_capabilities,
            max_packet_size: 0, // 16777216,
            character_set: CharacterSet::default(),
            username: Data::Temporary(bun_ptr::RawSlice::new(&self.user)),
            database: Data::Temporary(bun_ptr::RawSlice::new(&self.database)),
            auth_plugin_name: Data::Temporary(bun_ptr::RawSlice::new(
                self.auth_plugin.map_or(&b""[..], AuthMethod::name),
            )),
            auth_response,
            sequence_id: self.sequence_id,
            connect_attrs: Default::default(),
        };

        // Add some basic connect attributes like mysql2
        response
            .connect_attrs
            .put_assume_capacity(b"_client_name", Box::<[u8]>::from(b"Bun".as_slice()));
        response.connect_attrs.put_assume_capacity(
            b"_client_version",
            Box::<[u8]>::from(bun_core::Global::package_json_version_with_revision.as_bytes()),
        );

        response.capability_flags.reject();
        response.write(writer)?;
        self.capabilities = response.capability_flags;
        if awaits_public_key {
            self.set_status(ConnectionState::AuthenticationAwaitingPk);
        }
        self.flush_data();
        Ok(())
    }

    /// An on-path attacker can answer with a key of their own and recover the password: opt-in.
    fn awaits_public_key(&self, response: &AuthResponse<'_>) -> Result<bool, AnyMySQLError> {
        let awaits_public_key = matches!(response, AuthResponse::PublicKeyRequest(_));
        if awaits_public_key && !self.allow_public_key_retrieval {
            return Err(AnyMySQLError::PublicKeyRetrievalNotAllowed);
        }
        Ok(awaits_public_key)
    }

    fn send_auth_response(
        &mut self,
        plugin: AuthMethod,
        full_authentication: bool,
    ) -> Result<(), AnyMySQLError> {
        let writer = self.writer();
        let mut scrambled_buf = [0u8; 32];
        let response = if full_authentication {
            plugin.full_authentication(&self.password, self.transport())
        } else {
            plugin.first_response(
                &self.password,
                &self.auth_data,
                self.transport(),
                &mut scrambled_buf,
            )
        };
        let awaits_public_key = self.awaits_public_key(&response)?;
        let mut packet = writer.start(self.sequence_id)?;
        response.write(writer)?;
        packet.end()?;
        if awaits_public_key {
            self.set_status(ConnectionState::AuthenticationAwaitingPk);
        }
        self.flush_data();
        Ok(())
    }

    pub(crate) fn writer(&mut self) -> NewWriter<Writer> {
        NewWriter {
            wrapped: Writer {
                connection: std::ptr::from_mut::<Self>(self),
            },
        }
    }

    pub(crate) fn buffered_reader(&mut self) -> NewReader<Reader> {
        NewReader {
            wrapped: Reader {
                connection: std::ptr::from_mut::<Self>(self),
            },
        }
    }

    fn process_split_packet<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
    ) -> Result<(), AnyMySQLError> {
        if self.status != ConnectionState::Connected {
            return Err(AnyMySQLError::UnexpectedPacket);
        }
        let buffered = reader.peek();
        let first_sequence_id = PacketHeader::decode(buffered)
            .ok_or(AnyMySQLError::ShortRead)?
            .sequence_id;
        let mut sequence_id = first_sequence_id;
        let mut wire_length: usize = 0;
        let mut payload_length: usize = 0;
        loop {
            let header =
                PacketHeader::decode(&buffered[wire_length..]).ok_or(AnyMySQLError::ShortRead)?;
            if header.sequence_id != sequence_id {
                return Err(AnyMySQLError::UnexpectedPacket);
            }
            sequence_id = sequence_id.wrapping_add(1);
            wire_length += PacketHeader::SIZE + header.length as usize;
            payload_length += header.length as usize;
            u32::try_from(wire_length).map_err(|_| AnyMySQLError::Overflow)?;
            if buffered.len() < wire_length {
                return Err(AnyMySQLError::ShortRead);
            }
            if (header.length as usize) < PacketHeader::MAX_PAYLOAD_LENGTH {
                break;
            }
        }

        let mut payload: Vec<u8> = Vec::new();
        payload
            .try_reserve_exact(payload_length)
            .map_err(|_| AnyMySQLError::OutOfMemory)?;
        let mut offset = PacketHeader::SIZE;
        while offset < wire_length {
            let end = (offset + PacketHeader::MAX_PAYLOAD_LENGTH).min(wire_length);
            payload.extend_from_slice(&buffered[offset..end]);
            offset = end + PacketHeader::SIZE;
        }

        reader.set_offset_from_start(wire_length);
        self.handle_packet(&payload, first_sequence_id, sequence_id)
    }

    pub(crate) fn cached_statement<P: ExecuteParam>(
        &mut self,
        query: &[u8],
        params: &[P],
    ) -> Option<RefPtr<MySQLStatement>> {
        self.statements.get(query, params)
    }

    pub(crate) fn prepare_statement<P: ExecuteParam>(
        &mut self,
        query: &[u8],
        params: &[P],
    ) -> Result<RefPtr<MySQLStatement>, AnyMySQLError> {
        let statement = self.statements.insert(query, params);
        if let Some(evicted) = self.statements.evict(StatementCache::MAX_STATEMENTS) {
            let _ = mysql_request::close_statement(evicted.statement_id, self.writer());
        }
        if let Err(err) = mysql_request::prepare_request(query, self.writer()) {
            self.statements.remove(&statement);
            return Err(err.into());
        }
        Ok(statement)
    }

    fn close_statement(&mut self, statement: &MySQLStatement) {
        self.statements.remove(statement);
        let _ = mysql_request::close_statement(statement.statement_id, self.writer());
    }

    fn on_statement_prepared(&mut self, request: &JSMySQLQuery) {
        // Also for a request that was cancelled meanwhile: the next execution with as many values would find it.
        if let Some(statement) = request
            .get_statement()
            .filter(|statement| !statement.parameter_count_matches())
        {
            self.close_statement(statement);
        }
        self.in_reply = false;
        request.prepared();
        self.advance();
    }

    /// Without a COM_QUIT the server counts an aborted client.
    pub(crate) fn quit(&mut self) {
        if self.is_able_to_write()
            && self.write_buffer.len() == 0
            && !self.queue.current().is_some_and(|r| r.is_in_flight())
            && mysql_request::quit(self.writer()).is_ok()
        {
            self.flush_data();
        }
    }

    /// The caller runs `on_statement_prepared`: it must not read the statement under this `&mut`.
    fn check_if_prepared_statement_is_done(statement: &mut MySQLStatement) -> bool {
        bun_core::scoped_log!(
            MySQLConnection,
            "checkIfPreparedStatementIsDone: {} {} {} {}",
            statement.columns_received,
            statement.params_received,
            statement.columns.len(),
            statement.params.len()
        );
        let is_done = statement.columns_received as usize == statement.columns.len()
            && statement.params_received as usize == statement.params.len();
        if is_done {
            statement.status = mysql_statement::Status::Prepared;
            statement.reset();
        }
        is_done
    }

    fn handle_prepared_statement(
        &mut self,
        mut reader: PacketReader<'_>,
    ) -> Result<(), AnyMySQLError> {
        debug!("handlePreparedStatement");
        let payload_length = reader.peek().len();
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1isize);

        let Some(request) = self.queue.current() else {
            debug!("Unexpected prepared statement packet missing request");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        // Queue holds a ref on every request; bump it for the body's duration so
        // re-entrant `deref()` cannot free it.
        let _request_guard = request.ref_guard();
        let request: &JSMySQLQuery = request.get();
        let Some(statement) = request.get_statement() else {
            debug!("Unexpected prepared statement packet missing statement");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        if statement.statement_id > 0 {
            // In legacy protocol (CLIENT_DEPRECATE_EOF not negotiated), the server sends
            // intermediate EOF packets between param definitions and column definitions,
            // and after column definitions. We must consume these EOF packets and only
            // finalize the prepared statement after the trailing EOF is consumed.
            // Disambiguation from a 0xFE length-prefixed row: any 0xFE packet below
            // the 16 MB max-packet marker (0xFFFFFF) is an EOF. See handleResultSet
            // for the full rationale.
            if !self.capabilities.CLIENT_DEPRECATE_EOF
                && payload_length < PacketHeader::MAX_PAYLOAD_LENGTH
                && PacketType(first_byte) == PacketType::EOF
            {
                let mut eof = EOFPacket::default();
                eof.decode_internal(reader)?;
                if Self::check_if_prepared_statement_is_done(statement) {
                    self.on_statement_prepared(request);
                }
                return Ok(());
            }
            let extended_type_info = self.mariadb_capabilities.MARIADB_CLIENT_EXTENDED_TYPE_INFO;
            if (statement.params_received as usize) < statement.params.len() {
                let mut column = ColumnDefinition41::default();
                column.decode(&mut reader, extended_type_info)?;
                statement.params[statement.params_received as usize] = column.column_type;
                statement.params_received += 1;
            } else if (statement.columns_received as usize) < statement.columns.len() {
                // Only counted: every execution brings the definitions again.
                ColumnDefinition41::default().decode(&mut reader, extended_type_info)?;
                statement.columns_received += 1;
            }
            // In CLIENT_DEPRECATE_EOF mode, there are no trailing EOF packets, so
            // we check completion after each column/param definition. In legacy mode,
            // completion is deferred to the EOF handler above to avoid marking the
            // statement as prepared before the trailing EOF is consumed.
            if self.capabilities.CLIENT_DEPRECATE_EOF
                && Self::check_if_prepared_statement_is_done(statement)
            {
                self.on_statement_prepared(request);
            }
            return Ok(());
        }

        match PacketType(first_byte) {
            PacketType::OK => {
                let mut ok = StmtPrepareOKPacket::default();
                ok.decode(reader)?;

                statement.statement_id = ok.statement_id;

                if ok.num_params > 0 {
                    // Slots are overwritten as param-definition packets
                    // arrive, so the initial value is a placeholder.
                    statement.params = vec![FieldType::MYSQL_TYPE_NULL; ok.num_params as usize];
                    statement.params_received = 0;
                }

                if ok.num_columns > 0 {
                    statement.columns = (0..ok.num_columns as usize)
                        .map(|_| ColumnDefinition41::default())
                        .collect();
                    statement.columns_received = 0;
                }

                if Self::check_if_prepared_statement_is_done(statement) {
                    self.on_statement_prepared(request);
                }
            }

            PacketType::ERROR => {
                debug!("handlePreparedStatement ERROR");
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;
                // The cache holds handles the server has. The next use of the text prepares again.
                self.statements.remove(statement);
                self.on_request_error(request, &err)?;
            }

            _ => {
                bun_core::scoped_log!(
                    MySQLConnection,
                    "Unexpected prepared statement packet: 0x{:02x}",
                    first_byte
                );
                return Err(AnyMySQLError::UnexpectedPacket);
            }
        }
        Ok(())
    }

    /// `err` answers `request`. `Err` fails the connection.
    fn on_request_error(
        &mut self,
        request: &JSMySQLQuery,
        err: &ErrorPacket,
    ) -> Result<(), AnyMySQLError> {
        self.in_reply = false;
        self.js_connection_ref().on_error_packet(Some(request), err);
        if err.ends_session() {
            return Err(AnyMySQLError::ConnectionClosed);
        }
        let _ = self.flush_queue();
        Ok(())
    }

    fn handle_result_set_ok(
        &mut self,
        request: &JSMySQLQuery,
        status_flags: StatusFlags,
        last_insert_id: u64,
        affected_rows: u64,
    ) {
        self.status_flags = status_flags;
        let is_last_result = !status_flags.has(StatusFlag::SERVER_MORE_RESULTS_EXISTS);
        self.in_reply = !is_last_result;
        debug!(
            "handleResultSetOK: {} {}",
            status_flags.to_int(),
            is_last_result
        );

        // Before the result is delivered: the request lets go of its statement at its last one.
        let mut result_count = 0;
        let mut has_columns = false;
        if let Some(statement) = request.get_statement() {
            result_count = statement.result_count;
            has_columns = statement
                .execution_flags
                .contains(mysql_statement::ExecutionFlags::HEADER_RECEIVED);
            statement.reset();
        }
        request.resolve(&MySQLQueryResult {
            result_count,
            has_columns,
            last_insert_id,
            affected_rows,
            is_last_result,
        });

        // Not only `advance()`: what it writes has to be sent, and the auto flusher may not be registered.
        let _ = self.flush_queue();
    }

    fn handle_result_set(&mut self, mut reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        let payload_length = reader.peek().len();
        let first_byte = reader.int::<u8>()?;
        debug!("handleResultSet: {:02x}", first_byte);

        reader.skip(-1isize);

        let Some(request) = self.queue.current() else {
            debug!("Unexpected result set packet");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        // Queue holds a ref on every request; bump it for the body's duration so
        // re-entrant `deref()` cannot free it.
        let _request_guard = request.ref_guard();
        let request: &JSMySQLQuery = request.get();
        let mut ok = OKPacket::default();
        match PacketType(first_byte) {
            PacketType::ERROR => {
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;
                if let Some(statement) = request.get_statement() {
                    statement.reset();
                }
                self.on_request_error(request, &err)?;
            }

            packet_type => {
                // Script that runs while a row is built can end the request, which drops its ref.
                let _statement_guard = request.statement_ref();
                let Some(statement) = request.get_statement() else {
                    debug!("Unexpected result set packet");
                    return Err(AnyMySQLError::UnexpectedPacket);
                };
                if !statement
                    .execution_flags
                    .contains(mysql_statement::ExecutionFlags::HEADER_RECEIVED)
                {
                    if packet_type == PacketType::OK {
                        // if packet type is OK it means the query is done and no results are returned
                        ok.decode_internal(reader)?;
                        self.handle_result_set_ok(
                            request,
                            ok.status_flags,
                            ok.last_insert_id,
                            ok.affected_rows,
                        );
                        return Ok(());
                    }
                    // The client never offers CLIENT_LOCAL_FILES.
                    if packet_type == PacketType::LOCAL_INFILE {
                        return Err(AnyMySQLError::UnexpectedPacket);
                    }

                    let mut header = ResultSetHeader::default();
                    header.decode_internal(reader)?;
                    if header.field_count == 0 {
                        // Can't be 0
                        return Err(AnyMySQLError::UnexpectedPacket);
                    }
                    // field_count is a server-controlled lenenc int (up to 2^64-1) and is
                    // used below to size a Vec<ColumnDefinition41> (~256 bytes each). MySQL
                    // hard-caps a result set at 4096 columns (MAX_FIELDS), so anything
                    // larger is a malformed/hostile packet trying to make us commit
                    // gigabytes from a ~13-byte response.
                    if header.field_count > 4096 {
                        return Err(AnyMySQLError::UnexpectedPacket);
                    }
                    if statement.columns.len() as u64 != header.field_count {
                        bun_core::scoped_log!(
                            MySQLConnection,
                            "header field count mismatch: {} != {}",
                            statement.columns.len(),
                            header.field_count
                        );
                        if !statement.columns.is_empty() {
                            statement.columns = Vec::new();
                        }
                        // Fallible allocation: field_count is server-controlled
                        // (lenenc int up to 2^64-1), so a panicking `collect()`
                        // would let a malicious/buggy server crash us.
                        let field_count = usize::try_from(header.field_count)
                            .map_err(|_| AnyMySQLError::OutOfMemory)?;
                        let mut columns = Vec::new();
                        columns
                            .try_reserve_exact(field_count)
                            .map_err(|_| AnyMySQLError::OutOfMemory)?;
                        columns.resize_with(field_count, ColumnDefinition41::default);
                        statement.columns = columns;
                        statement.columns_received = 0;
                        statement.cached_structure = Default::default();
                        statement.fields_flags = Default::default();
                    }
                    statement
                        .execution_flags
                        .insert(mysql_statement::ExecutionFlags::NEEDS_DUPLICATE_CHECK);
                    statement
                        .execution_flags
                        .insert(mysql_statement::ExecutionFlags::HEADER_RECEIVED);
                    return Ok(());
                } else if (statement.columns_received as usize) < statement.columns.len() {
                    use bun_sql::mysql::protocol::column_definition41::Changed;
                    let index = statement.columns_received as usize;
                    let changed = statement.columns[index].decode(
                        &mut reader,
                        self.mariadb_capabilities.MARIADB_CLIENT_EXTENDED_TYPE_INFO,
                    )?;
                    statement.columns_received += 1;
                    match changed {
                        Changed::Nothing => {}
                        Changed::Description => statement.cached_structure.clear_description(),
                        Changed::Name => {
                            statement.cached_structure = Default::default();
                            statement.fields_flags = Default::default();
                            statement
                                .execution_flags
                                .insert(mysql_statement::ExecutionFlags::NEEDS_DUPLICATE_CHECK);
                            self.js_connection_ref().on_column_name(request, index)?;
                        }
                    }
                } else {
                    // A 0xFE-prefixed packet at this point is either the end-of-result
                    // terminator or a row whose first column is a length-encoded integer
                    // starting with 0xFE (values that don't fit in 3 bytes).
                    //
                    // Disambiguation per the MySQL protocol spec: a terminator packet's
                    // payload length is always below the 16 MB max-packet marker
                    // (0xFFFFFF); a 0xFE row prefix means the next 8 bytes are a u64
                    // length, pushing the row payload past that marker. An OK terminator
                    // has no small bound: it can carry a trailing human-readable `info`
                    // string (e.g. ManticoreSearch's `szMeta`).
                    if packet_type == PacketType::EOF
                        && payload_length < PacketHeader::MAX_PAYLOAD_LENGTH
                    {
                        if !self.capabilities.CLIENT_DEPRECATE_EOF {
                            // Legacy protocol: EOF packets delimit sections of the result set.
                            // Handle the intermediate EOF (between column defs and rows) and
                            // the final EOF (after all rows) differently.
                            if !statement
                                .execution_flags
                                .contains(mysql_statement::ExecutionFlags::COLUMNS_EOF_RECEIVED)
                            {
                                // Intermediate EOF between column definitions and row data - skip it
                                let mut eof = EOFPacket::default();
                                eof.decode_internal(reader)?;
                                statement
                                    .execution_flags
                                    .insert(mysql_statement::ExecutionFlags::COLUMNS_EOF_RECEIVED);
                                return Ok(());
                            }
                            // Final EOF after all row data - terminates the result set
                            let mut eof = EOFPacket::default();
                            eof.decode_internal(reader)?;
                            self.handle_result_set_ok(request, eof.status_flags, 0, 0);
                            return Ok(());
                        }

                        // CLIENT_DEPRECATE_EOF mode: OK packet with 0xFE header.
                        ok.decode_internal(reader)?;

                        self.handle_result_set_ok(
                            request,
                            ok.status_flags,
                            ok.last_insert_id,
                            ok.affected_rows,
                        );
                        return Ok(());
                    }

                    self.js_connection_ref()
                        .on_result_row(request, statement, reader)?;
                }
            }
        }
        Ok(())
    }
}

#[derive(strum::IntoStaticStr, Debug)]
pub enum FlushQueueError {
    AuthenticationFailed,
}

// The protocol layer's handles on the connection's two buffers. `Copy`, as its traits ask.
#[derive(Clone, Copy)]
pub struct Writer {
    pub(crate) connection: *mut MySQLConnection,
}

impl Writer {
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn write_buffer(&self) -> &mut OffsetByteList {
        // SAFETY: `self.connection` is never null — `Writer` is only ever
        // constructed by `MySQLConnection::writer(&mut self)` from a live
        // `&mut MySQLConnection`, and the `NewWriter<Writer>` is consumed
        // before that connection is dropped (it is never stored).
        //
        // Raw-pointer field projection (`addr_of_mut!`) avoids materializing
        // an intermediate `&mut MySQLConnection`, which could alias the
        // caller's own `&mut self` (see the aliasing note on `Reader` below).
        // Callers never touch `write_buffer` through `&mut self` while a
        // `Writer` is live, so no two `&mut OffsetByteList` coexist.
        unsafe { &mut *core::ptr::addr_of_mut!((*self.connection).write_buffer) }
    }
}

impl WriterContext for Writer {
    fn write(self, data: &[u8]) -> Result<(), AnyMySQLError> {
        self.write_buffer()
            .write(data)
            .map_err(|_| AnyMySQLError::OutOfMemory)?;
        Ok(())
    }

    fn pwrite(self, data: &[u8], index: usize) -> Result<(), AnyMySQLError> {
        let buffer = self.write_buffer();
        let head = buffer.head;
        buffer.byte_list[head + index..][..data.len()].copy_from_slice(data);
        Ok(())
    }

    fn offset(self) -> usize {
        self.write_buffer().len()
    }

    fn truncate(self, offset: usize) {
        let buffer = self.write_buffer();
        let head = buffer.head;
        buffer.byte_list.truncate(head + offset);
    }

    fn copy_within(self, src: core::ops::Range<usize>, dest: usize) {
        let buffer = self.write_buffer();
        let head = buffer.head;
        buffer
            .byte_list
            .copy_within(head + src.start..head + src.end, head + dest);
    }
}

#[derive(Clone, Copy)]
pub struct Reader {
    pub(crate) connection: *mut MySQLConnection,
}

// Aliasing: `Reader` is constructed from `&mut MySQLConnection`
// and then threaded through `process_packets(&mut self, reader)` — i.e. the
// raw `*mut` and a live `&mut self` coexist. Materializing a whole-struct
// `&mut MySQLConnection` here would alias that `&mut self` (Stacked Borrows
// UB). Instead the accessors below project only the specific field(s) the
// reader touches via `addr_of_mut!`, matching `Writer` above.
impl Reader {
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn read_buffer(&self) -> &mut OffsetByteList {
        // SAFETY: `self.connection` points at a live `MySQLConnection` for the
        // duration of the read call (NewReader is constructed by
        // `MySQLConnection::buffered_reader(&mut self)` and never stored).
        // Raw-pointer field projection (`addr_of_mut!`) avoids materializing an
        // intermediate `&mut MySQLConnection`, which would alias the caller's
        // live `&mut self` in `process_packets`. `process_packets` never touches
        // `read_buffer` through its own `&mut self` while a `Reader` is live, so
        // no two `&mut OffsetByteList` coexist.
        unsafe { &mut *core::ptr::addr_of_mut!((*self.connection).read_buffer) }
    }

    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn last_message_start(&self) -> &mut usize {
        // SAFETY: same justification as `read_buffer()` — disjoint field
        // projection from a non-null connection pointer that outlives the
        // `Reader`; `process_packets` does not access `last_message_start`
        // through `&mut self` while the reader is live.
        unsafe { &mut *core::ptr::addr_of_mut!((*self.connection).last_message_start) }
    }
}

impl ReaderContext for Reader {
    fn mark_message_start(self) {
        *self.last_message_start() = self.read_buffer().head;
    }

    fn set_offset_from_start(self, offset: usize) {
        self.read_buffer().head = *self.last_message_start() + offset;
    }

    fn peek(&self) -> &[u8] {
        self.read_buffer().remaining()
    }

    fn ensure_capacity(self, count: usize) -> bool {
        self.read_buffer().remaining().len() >= count
    }
}

const MAX_PIPELINE_SIZE: usize = u16::MAX as usize; // about 64KB per connection
