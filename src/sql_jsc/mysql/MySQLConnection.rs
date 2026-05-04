use core::ffi::{c_char, CStr};
use core::mem::offset_of;

use bun_collections::{ByteList, HashMap, OffsetByteList};
use bun_jsc::JSValue;
use bun_uws::{self as uws, AnySocket as Socket, SslCtx};
use bun_boringssl as boringssl;

use bun_sql::mysql::protocol::any_mysql_error::{self as any_mysql_error, Error as AnyMySQLError};
use bun_sql::mysql::protocol::{
    Auth, AuthSwitchRequest, AuthSwitchResponse, ColumnDefinition41, EOFPacket, HandshakeResponse41,
    HandshakeV10, LocalInfileRequest, OKPacket, PacketHeader, ResultSetHeader, SSLRequest,
    StackReader, StmtPrepareOKPacket,
};
use bun_sql::mysql::protocol::character_set::CharacterSet;
use bun_sql::mysql::protocol::new_reader::NewReader;
use bun_sql::mysql::protocol::new_writer::NewWriter;
use bun_sql::mysql::protocol::packet_type::PacketType;
use bun_sql::mysql::auth_method::AuthMethod;
use bun_sql::mysql::connection_state::ConnectionState;
use bun_sql::mysql::ssl_mode::SSLMode;
use bun_sql::mysql::status_flags::StatusFlags;
use bun_sql::mysql::tls_status::TLSStatus;
use bun_sql::mysql::Capabilities;
use bun_sql::postgres::SocketMonitor;
use bun_sql::shared::connection_flags::ConnectionFlags;
use bun_sql::shared::data::Data;

use crate::mysql::js_mysql_connection::JSMySQLConnection;
use crate::mysql::js_mysql_query::JSMySQLQuery;
use crate::mysql::mysql_request_queue::MySQLRequestQueue;
use crate::mysql::mysql_statement::MySQLStatement;

pub use bun_sql::mysql::protocol::ErrorPacket;

// TODO(port): jsc.API.ServerConfig.SSLConfig — confirm crate path in Phase B
use bun_jsc::api::server_config::SslConfig as SSLConfig;

bun_output::declare_scope!(MySQLConnection, visible);

pub struct MySQLConnection {
    socket: Socket,
    pub status: ConnectionState,

    write_buffer: OffsetByteList,
    read_buffer: OffsetByteList,
    last_message_start: u32,
    sequence_id: u8,

    // TODO: move it to JSMySQLConnection
    pub queue: MySQLRequestQueue,
    // TODO: move it to JSMySQLConnection
    pub statements: PreparedStatementsMap,

    server_version: ByteList,
    connection_id: u32,
    capabilities: Capabilities,
    character_set: CharacterSet,
    status_flags: StatusFlags,

    auth_plugin: Option<AuthMethod>,
    auth_state: AuthState,

    auth_data: Vec<u8>,
    // TODO(port): in Zig, database/user/password/options are sub-slices into options_buf
    // (single backing allocation; only options_buf is freed in cleanup()). Per the
    // `[]const u8 struct field → look at deinit` rule, only options_buf should be
    // Box<[u8]>; the others should be ranges/raw `*const [u8]` into it. Phase B:
    // restore the single-buffer layout and revert init()'s database/username/password/
    // options params from Box<[u8]> back to &[u8] (1 caller-side alloc, not 5).
    database: Box<[u8]>,
    user: Box<[u8]>,
    password: Box<[u8]>,
    options: Box<[u8]>,
    options_buf: Box<[u8]>,
    secure: Option<*mut SslCtx>,
    tls_config: SSLConfig,
    tls_status: TLSStatus,
    ssl_mode: SSLMode,
    flags: ConnectionFlags,
}

impl Default for MySQLConnection {
    fn default() -> Self {
        Self {
            socket: Socket::SocketTCP { socket: uws::SocketTCP::detached() },
            status: ConnectionState::Disconnected,
            write_buffer: OffsetByteList::default(),
            read_buffer: OffsetByteList::default(),
            last_message_start: 0,
            sequence_id: 0,
            queue: MySQLRequestQueue::init(),
            statements: PreparedStatementsMap::default(),
            server_version: ByteList::default(),
            connection_id: 0,
            capabilities: Capabilities::default(),
            character_set: CharacterSet::default(),
            status_flags: StatusFlags::default(),
            auth_plugin: None,
            auth_state: AuthState::Pending,
            auth_data: Vec::new(),
            database: Box::default(),
            user: Box::default(),
            password: Box::default(),
            options: Box::default(),
            options_buf: Box::default(),
            secure: None,
            tls_config: SSLConfig::default(),
            tls_status: TLSStatus::None,
            ssl_mode: SSLMode::Disable,
            flags: ConnectionFlags::default(),
        }
    }
}

impl MySQLConnection {
    pub fn init(
        database: Box<[u8]>,
        username: Box<[u8]>,
        password: Box<[u8]>,
        options: Box<[u8]>,
        options_buf: Box<[u8]>,
        tls_config: SSLConfig,
        secure: Option<*mut SslCtx>,
        ssl_mode: SSLMode,
    ) -> Self {
        Self {
            database,
            user: username,
            password,
            options,
            options_buf,
            socket: Socket::SocketTCP { socket: uws::SocketTCP::detached() },
            queue: MySQLRequestQueue::init(),
            statements: PreparedStatementsMap::default(),
            tls_config,
            secure,
            ssl_mode,
            tls_status: if ssl_mode != SSLMode::Disable { TLSStatus::Pending } else { TLSStatus::None },
            character_set: CharacterSet::default(),
            ..Default::default()
        }
    }

    pub fn can_pipeline(&mut self) -> bool {
        self.queue.can_pipeline(self.get_js_connection())
    }
    pub fn can_prepare_query(&mut self) -> bool {
        self.queue.can_prepare_query(self.get_js_connection())
    }
    pub fn can_execute_query(&mut self) -> bool {
        self.queue.can_execute_query(self.get_js_connection())
    }

    #[inline]
    pub fn is_able_to_write(&self) -> bool {
        self.status == ConnectionState::Connected
            && !self.flags.has_backpressure
            && self.write_buffer.len() < MAX_PIPELINE_SIZE
    }

    #[inline]
    pub fn is_processing_data(&self) -> bool {
        self.flags.is_processing_data
    }
    #[inline]
    pub fn has_backpressure(&self) -> bool {
        self.flags.has_backpressure
    }
    #[inline]
    pub fn reset_backpressure(&mut self) {
        self.flags.has_backpressure = false;
    }

    #[inline]
    pub fn can_flush(&self) -> bool {
        !self.flags.has_backpressure // if has backpressure we need to wait for onWritable event
            && self.status == ConnectionState::Connected // and we need to be connected
            // we need data to send
            && (self.write_buffer.len() > 0
                || if let Some(request) = self.queue.current() {
                    request.is_pending() && !request.is_being_prepared()
                } else {
                    false
                })
    }

    #[inline]
    pub fn is_idle(&self) -> bool {
        self.queue.current().is_none() && self.write_buffer.len() == 0
    }

    #[inline]
    pub fn enqueue_request(&mut self, request: *mut JSMySQLQuery) {
        self.queue.add(request);
    }

    pub fn flush_queue(&mut self) -> Result<(), FlushQueueError> {
        self.flush_data();
        if !self.flags.has_backpressure {
            if self.tls_status == TLSStatus::MessageSent {
                self.upgrade_to_tls()?;
            } else {
                // no backpressure yet so pipeline more if possible and flush again
                // PORT NOTE: reshaped for borrowck
                let connection = self.get_js_connection();
                self.queue.advance(connection);
                self.flush_data();
            }
        }
        Ok(())
    }

    fn flush_data(&mut self) {
        // we know we still have backpressure so just return we will flush later
        if self.flags.has_backpressure {
            bun_output::scoped_log!(MySQLConnection, "flushData: has backpressure");
            return;
        }

        let chunk = self.write_buffer.remaining();
        if chunk.is_empty() {
            return;
        }

        let wrote = self.socket.write(chunk);
        self.flags.has_backpressure = usize::try_from(wrote).unwrap_or(0) < chunk.len();
        bun_output::scoped_log!(MySQLConnection, "flushData: wrote {}/{} bytes", wrote, chunk.len());
        if wrote > 0 {
            let wrote_usize = usize::try_from(wrote).unwrap();
            SocketMonitor::write(&chunk[0..wrote_usize]);
            self.write_buffer.consume(u32::try_from(wrote_usize).unwrap());
        }
    }

    pub fn close(&mut self) {
        self.socket.close();
        self.write_buffer = OffsetByteList::default();
    }

    pub fn clean_queue_and_close(&mut self, js_reason: Option<JSValue>, js_queries_array: JSValue) {
        // cleanup requests
        self.queue.clean(
            js_reason,
            if !js_queries_array.is_empty() { js_queries_array } else { JSValue::UNDEFINED },
        );

        self.close();
    }

    pub fn cleanup(&mut self) {
        let _queue = core::mem::replace(&mut self.queue, MySQLRequestQueue::init());
        // _queue dropped at scope exit
        let _write_buffer = core::mem::take(&mut self.write_buffer);
        let _read_buffer = core::mem::take(&mut self.read_buffer);
        let statements = core::mem::take(&mut self.statements);
        let _tls_config = core::mem::take(&mut self.tls_config);
        let _options_buf = core::mem::take(&mut self.options_buf);

        for stmt in statements.values() {
            // SAFETY: statements map holds intrusive-refcounted MySQLStatement pointers
            unsafe { (**stmt).deref_() };
            // TODO(port): MySQLStatement uses intrusive refcount (ref/deref); confirm
            // whether PreparedStatementsMap should store IntrusiveRc<MySQLStatement>.
        }
        drop(statements);

        self.auth_data = Vec::new();
        if let Some(s) = self.secure.take() {
            // SAFETY: FFI — secure is an owned SSL_CTX* freed exactly once here
            unsafe { boringssl::c::SSL_CTX_free(s) };
        }
        // _options_buf dropped at scope exit (Box<[u8]> frees via Drop)
    }

    pub fn upgrade_to_tls(&mut self) -> Result<(), FlushQueueError> {
        if let Socket::SocketTCP { socket } = &self.socket {
            let vm = bun_jsc::VirtualMachine::get();
            let tls_group = vm.rare_data().mysql_group(vm, true);
            // TODO(port): confirm uws connected-socket adoptTLS API surface in Rust
            let new_socket = socket
                .connected()
                .adopt_tls(
                    tls_group,
                    uws::SocketKind::MysqlTls,
                    self.secure.expect("secure must be set when upgrading to TLS"),
                    self.tls_config.server_name(),
                    core::mem::size_of::<Option<*mut JSMySQLConnection>>(),
                    core::mem::size_of::<Option<*mut JSMySQLConnection>>(),
                )
                .ok_or(FlushQueueError::AuthenticationFailed)?;
            // SAFETY: ext storage on the new socket is sized for Option<*mut JSMySQLConnection>
            unsafe {
                *new_socket.ext::<Option<*mut JSMySQLConnection>>() = Some(self.get_js_connection());
            }
            self.socket = Socket::SocketTLS { socket: uws::SocketTLS::connected(new_socket) };
            // ext is now repointed; safe to kick the handshake (any dispatch lands here).
            new_socket.start_tls_handshake();
        }
        Ok(())
    }

    pub fn set_socket(&mut self, socket: Socket) {
        self.socket = socket;
    }

    pub fn is_active(&self) -> bool {
        if self.status == ConnectionState::Disconnected || self.status == ConnectionState::Failed {
            return false;
        }

        // if is connected or connecting we keep alive until idle timeout is reached
        true
    }

    #[inline]
    pub fn is_connected(&self) -> bool {
        self.status == ConnectionState::Connected
    }

    pub fn do_handshake(
        &mut self,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) -> Result<bool, AnyMySQLError> {
        bun_output::scoped_log!(
            MySQLConnection,
            "onHandshake: {} {} {}",
            success,
            ssl_error.error_no,
            <&'static str>::from(self.ssl_mode)
        );
        let handshake_success = success == 1;
        self.sequence_id = self.sequence_id.wrapping_add(1);
        if handshake_success {
            self.tls_status = TLSStatus::SslOk;
            if self.tls_config.reject_unauthorized != 0 {
                // follow the same rules as postgres
                // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279
                // only reject the connection if reject_unauthorized == true
                match self.ssl_mode {
                    SSLMode::VerifyCa | SSLMode::VerifyFull => {
                        if ssl_error.error_no != 0 {
                            self.tls_status = TLSStatus::SslFailed;
                            return Ok(false);
                        }

                        // SAFETY: getNativeHandle returns the underlying SSL* for a TLS socket
                        let ssl_ptr: *mut boringssl::c::SSL =
                            unsafe { self.socket.get_native_handle().cast() };
                        // SAFETY: FFI call into BoringSSL
                        if let Some(servername) =
                            unsafe { boringssl::c::SSL_get_servername(ssl_ptr, 0).as_ref() }
                        {
                            // SAFETY: SSL_get_servername returns a NUL-terminated C string
                            let hostname = unsafe { CStr::from_ptr(servername as *const c_char) }.to_bytes();
                            if !boringssl::check_server_identity(ssl_ptr, hostname) {
                                self.tls_status = TLSStatus::SslFailed;
                                return Ok(false);
                            }
                        }
                    }
                    // require is the same as prefer
                    SSLMode::Require | SSLMode::Prefer | SSLMode::Disable => {}
                }
            }
            self.send_handshake_response()?;
            return Ok(true);
        }
        self.tls_status = TLSStatus::SslFailed;
        // if we are here is because server rejected us, and the error_no is the cause of this
        // no matter if reject_unauthorized is false because we are disconnected by the server
        Ok(false)
    }

    pub fn read_and_process_data(&mut self, data: &[u8]) -> Result<(), AnyMySQLError> {
        self.flags.is_processing_data = true;
        // PORT NOTE: reshaped for borrowck — Zig `defer this.flags.is_processing_data = false`
        // is hand-inlined before every return below (scopeguard would need &mut self.flags).
        // Clear the timeout.
        self.socket.set_timeout(0);

        SocketMonitor::read(data);

        if self.read_buffer.remaining().is_empty() {
            let mut consumed: usize = 0;
            let mut offset: usize = 0;
            let reader = StackReader::init(data, &mut consumed, &mut offset);
            match self.process_packets(reader) {
                Ok(()) => {}
                Err(err) => {
                    bun_output::scoped_log!(
                        MySQLConnection,
                        "processPackets without buffer: {}",
                        err.name()
                    );
                    if err == any_mysql_error::Error::ShortRead {
                        if cfg!(debug_assertions) {
                            bun_output::scoped_log!(
                                MySQLConnection,
                                "Received short read: last_message_start: {}, head: {}, len: {}",
                                offset,
                                consumed,
                                data.len()
                            );
                        }

                        self.read_buffer.head = 0;
                        self.last_message_start = 0;
                        self.read_buffer.byte_list.len = 0;
                        self.read_buffer
                            .write(&data[offset..])
                            .unwrap_or_else(|_| panic!("failed to write to read buffer"));
                    } else {
                        if cfg!(debug_assertions) {
                            // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent
                        }
                        self.flags.is_processing_data = false;
                        return Err(err);
                    }
                }
            }
            self.flags.is_processing_data = false;
            return Ok(());
        }

        {
            self.read_buffer.head = self.last_message_start;

            self.read_buffer
                .write(data)
                .unwrap_or_else(|_| panic!("failed to write to read buffer"));
            match self.process_packets(self.buffered_reader()) {
                Ok(()) => {}
                Err(err) => {
                    bun_output::scoped_log!(
                        MySQLConnection,
                        "processPackets with buffer: {}",
                        err.name()
                    );
                    if err != any_mysql_error::Error::ShortRead {
                        if cfg!(debug_assertions) {
                            // TODO(port): @errorReturnTrace — no Rust equivalent
                        }
                        self.flags.is_processing_data = false;
                        return Err(err);
                    }

                    if cfg!(debug_assertions) {
                        bun_output::scoped_log!(
                            MySQLConnection,
                            "Received short read: last_message_start: {}, head: {}, len: {}",
                            self.last_message_start,
                            self.read_buffer.head,
                            self.read_buffer.byte_list.len
                        );
                    }

                    self.flags.is_processing_data = false;
                    return Ok(());
                }
            }

            self.last_message_start = 0;
            self.read_buffer.head = 0;
        }
        self.flags.is_processing_data = false;
        Ok(())
    }

    pub fn process_packets<C>(&mut self, reader: NewReader<C>) -> Result<(), AnyMySQLError> {
        loop {
            reader.mark_message_start();

            // Read packet header
            let header = PacketHeader::decode(reader.peek()).ok_or(AnyMySQLError::ShortRead)?;
            let header_length = header.length;
            let packet_length: usize = header_length as usize + PacketHeader::SIZE;
            bun_output::scoped_log!(
                MySQLConnection,
                "sequence_id: {} header: {}",
                self.sequence_id,
                header_length
            );
            // Ensure we have the full packet
            reader
                .ensure_capacity(packet_length)
                .map_err(|_| AnyMySQLError::ShortRead)?;
            // always skip the full packet, we dont care about padding or unreaded bytes
            let _skip_guard = scopeguard::guard((), |_| {
                reader.set_offset_from_start(packet_length);
            });
            // TODO(port): scopeguard captures `reader` by ref; may need NewReader<C>: Copy or restructure
            reader.skip(PacketHeader::SIZE as isize);

            // Update sequence id
            self.sequence_id = header.sequence_id.wrapping_add(1);

            // Process packet based on connection state
            match self.status {
                ConnectionState::Handshaking => self.handle_handshake(reader)?,
                ConnectionState::Authenticating | ConnectionState::AuthenticationAwaitingPk => {
                    self.handle_auth(reader, header_length)?
                }
                ConnectionState::Connected => self.handle_command(reader, header_length)?,
                _ => {
                    bun_output::scoped_log!(
                        MySQLConnection,
                        "Unexpected packet in state {}",
                        <&'static str>::from(self.status)
                    );
                    return Err(AnyMySQLError::UnexpectedPacket);
                }
            }
        }
    }

    pub fn handle_handshake<C>(&mut self, reader: NewReader<C>) -> Result<(), AnyMySQLError> {
        let mut handshake = HandshakeV10::default();
        handshake.decode(reader)?;
        // handshake dropped at scope exit

        // Store server info
        self.server_version = handshake.server_version.to_owned()?;
        self.connection_id = handshake.connection_id;
        // Negotiate capabilities: only request capabilities that the server also supports.
        // Per MySQL protocol, the client MUST intersect its desired capabilities with the
        // server's advertised capabilities. This ensures features like CLIENT_DEPRECATE_EOF
        // are only used when the server actually supports them (critical for MySQL-compatible
        // databases like StarRocks, TiDB, SingleStore, etc.).
        self.capabilities =
            Capabilities::get_default_capabilities(self.ssl_mode != SSLMode::Disable, !self.database.is_empty())
                .intersect(handshake.capability_flags);

        // Override with utf8mb4 instead of using server's default
        self.character_set = CharacterSet::default();
        self.status_flags = handshake.status_flags;

        bun_output::scoped_log!(
            MySQLConnection,
            "Handshake\n   Server Version: {}\n   Connection ID:  {}\n   Character Set:  {} ({})\n   Server Capabilities:   [ {} ] 0x{:08x}\n   Negotiated Capabilities: [ {} ] 0x{:08x}\n   Status Flags:   [ {} ]\n",
            bstr::BStr::new(self.server_version.slice()),
            self.connection_id,
            self.character_set as u32,
            bstr::BStr::new(self.character_set.label()),
            handshake.capability_flags,
            handshake.capability_flags.to_int(),
            self.capabilities,
            self.capabilities.to_int(),
            self.status_flags
        );

        self.auth_data.clear();
        self.auth_data.shrink_to_fit();

        // Store auth data
        self.auth_data
            .reserve(handshake.auth_plugin_data_part_1.len() + handshake.auth_plugin_data_part_2.len());
        self.auth_data.extend_from_slice(&handshake.auth_plugin_data_part_1[..]);
        self.auth_data.extend_from_slice(&handshake.auth_plugin_data_part_2[..]);

        // Get auth plugin
        if !handshake.auth_plugin_name.slice().is_empty() {
            self.auth_plugin = Some(
                AuthMethod::from_string(handshake.auth_plugin_name.slice())
                    .ok_or(AnyMySQLError::UnsupportedAuthPlugin)?,
            );
        }

        // Update status
        self.set_status(ConnectionState::Authenticating);

        // https://dev.mysql.com/doc/dev/mysql-server/8.4.6/page_protocol_connection_phase_packets_protocol_ssl_request.html
        if self.capabilities.client_ssl() {
            let mut response = SSLRequest {
                capability_flags: self.capabilities,
                max_packet_size: 0, // 16777216,
                character_set: CharacterSet::default(),
                // bun always send connection attributes
                has_connection_attributes: true,
            };
            response.write(self.writer())?;
            self.capabilities = response.capability_flags;
            self.tls_status = TLSStatus::MessageSent;
            self.flush_data();
            if !self.flags.has_backpressure {
                self.upgrade_to_tls()
                    .map_err(|_| AnyMySQLError::AuthenticationFailed)?;
            }
            return Ok(());
        }
        if self.tls_status != TLSStatus::None {
            self.tls_status = TLSStatus::SslNotAvailable;

            match self.ssl_mode {
                SSLMode::VerifyCa | SSLMode::VerifyFull => {
                    return Err(AnyMySQLError::AuthenticationFailed);
                }
                // require behaves like prefer for postgres.js compatibility,
                // allowing graceful fallback to non-SSL when the server
                // doesn't support it.
                SSLMode::Require | SSLMode::Prefer | SSLMode::Disable => {}
            }
        }
        // Send auth response
        self.send_handshake_response()
    }

    fn handle_handshake_decode_public_key<C>(
        &mut self,
        reader: NewReader<C>,
    ) -> Result<(), AnyMySQLError> {
        let mut response = Auth::caching_sha2_password::PublicKeyResponse::default();
        response.decode(reader)?;
        // revert back to authenticating since we received the public key
        self.set_status(ConnectionState::Authenticating);

        let mut encrypted_password = Auth::caching_sha2_password::EncryptedPassword {
            password: &self.password,
            public_key: response.data.slice(),
            nonce: &self.auth_data,
            sequence_id: self.sequence_id,
        };
        encrypted_password.write(self.writer())?;
        self.flush_data();
        Ok(())
    }

    pub fn set_status(&mut self, status: ConnectionState) {
        if self.status == status {
            return;
        }

        self.status = status;

        match status {
            ConnectionState::Connected => {
                self.get_js_connection().on_connection_established();
            }
            _ => {}
        }
    }

    pub fn handle_auth<C>(
        &mut self,
        reader: NewReader<C>,
        header_length: u32, // u24 in Zig
    ) -> Result<(), AnyMySQLError> {
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1);

        bun_output::scoped_log!(MySQLConnection, "Auth packet: 0x{:02x}", first_byte);

        match first_byte {
            x if x == PacketType::OK as u8 => {
                let mut ok = OKPacket {
                    packet_size: header_length,
                    ..Default::default()
                };
                ok.decode(reader)?;

                self.set_status(ConnectionState::Connected);

                self.status_flags = ok.status_flags;
                self.flags.is_ready_for_query = true;
                let connection = self.get_js_connection();
                self.queue.mark_as_ready_for_query();
                self.queue.advance(connection);
            }

            x if x == PacketType::ERROR as u8 => {
                let mut err = ErrorPacket::default();
                err.decode(reader)?;

                let connection = self.get_js_connection();
                connection.on_error_packet(None, err);
                return Err(AnyMySQLError::AuthenticationFailed);
            }

            x if x == PacketType::MORE_DATA as u8 => {
                // Handle various MORE_DATA cases
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
                                Auth::caching_sha2_password::Status::Success => {
                                    bun_output::scoped_log!(MySQLConnection, "success auth");
                                    self.set_status(ConnectionState::Connected);

                                    self.flags.is_ready_for_query = true;
                                    self.queue.mark_as_ready_for_query();
                                    let connection = self.get_js_connection();
                                    self.queue.advance(connection);
                                }
                                Auth::caching_sha2_password::Status::ContinueAuth => {
                                    bun_output::scoped_log!(MySQLConnection, "continue auth");

                                    if self.ssl_mode == SSLMode::Disable {
                                        // we are in plain TCP so we need to request the public key
                                        self.set_status(ConnectionState::AuthenticationAwaitingPk);
                                        bun_output::scoped_log!(MySQLConnection, "awaiting public key");
                                        let mut packet = self.writer().start(self.sequence_id)?;

                                        let mut request =
                                            Auth::caching_sha2_password::PublicKeyRequest::default();
                                        request.write(self.writer())?;
                                        packet.end()?;
                                        self.flush_data();
                                    } else {
                                        bun_output::scoped_log!(
                                            MySQLConnection,
                                            "sending password TLS enabled"
                                        );
                                        // SSL mode is enabled, send password as is
                                        let mut packet = self.writer().start(self.sequence_id)?;
                                        self.writer().write_z(&self.password)?;
                                        packet.end()?;
                                        self.flush_data();
                                    }
                                }
                                _ => {
                                    return Err(AnyMySQLError::AuthenticationFailed);
                                }
                            }
                        }
                        _ => {
                            bun_output::scoped_log!(
                                MySQLConnection,
                                "Unexpected auth continuation for plugin: {}",
                                <&'static str>::from(plugin)
                            );
                            return Err(AnyMySQLError::UnexpectedPacket);
                        }
                    }
                } else if first_byte == PacketType::LOCAL_INFILE as u8 {
                    // Handle LOCAL INFILE request
                    let mut infile = LocalInfileRequest {
                        packet_size: header_length,
                        ..Default::default()
                    };
                    infile.decode(reader)?;

                    // We don't support LOCAL INFILE for security reasons
                    return Err(AnyMySQLError::LocalInfileNotSupported);
                } else {
                    bun_output::scoped_log!(MySQLConnection, "Received auth continuation without plugin");
                    return Err(AnyMySQLError::UnexpectedPacket);
                }
            }

            PacketType::AUTH_SWITCH => {
                let mut auth_switch = AuthSwitchRequest {
                    packet_size: header_length,
                    ..Default::default()
                };
                auth_switch.decode(reader)?;

                // Update auth plugin and data
                let auth_method = AuthMethod::from_string(auth_switch.plugin_name.slice())
                    .ok_or(AnyMySQLError::UnsupportedAuthPlugin)?;
                let auth_data = auth_switch.plugin_data.slice();
                self.auth_plugin = Some(auth_method);
                self.auth_data.clear();
                self.auth_data.extend_from_slice(auth_data);

                // Send new auth response
                self.send_auth_switch_response(auth_method, auth_data)?;
            }

            _ => {
                bun_output::scoped_log!(MySQLConnection, "Unexpected auth packet: 0x{:02x}", first_byte);
                return Err(AnyMySQLError::UnexpectedPacket);
            }
        }
        Ok(())
    }

    pub fn handle_command<C>(
        &mut self,
        reader: NewReader<C>,
        header_length: u32, // u24 in Zig
    ) -> Result<(), AnyMySQLError> {
        // Get the current request if any
        let Some(request) = self.queue.current() else {
            bun_output::scoped_log!(MySQLConnection, "Received unexpected command response");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        request.ref_();
        let _request_guard = scopeguard::guard((), |_| request.deref_());
        // TODO(port): intrusive ref/deref via scopeguard captures request by ref; verify lifetime in Phase B

        bun_output::scoped_log!(MySQLConnection, "handleCommand");
        if request.is_simple() {
            // Regular query response
            return self.handle_result_set(reader, header_length);
        }

        // Handle based on request type
        if let Some(statement) = request.get_statement() {
            statement.ref_();
            let _statement_guard = scopeguard::guard((), |_| statement.deref_());
            match statement.status {
                MySQLStatement::Status::Pending => {
                    return Err(AnyMySQLError::UnexpectedPacket);
                }
                MySQLStatement::Status::Parsing => {
                    // We're waiting for prepare response
                    self.handle_prepared_statement(reader, header_length)?;
                }
                MySQLStatement::Status::Prepared => {
                    // We're waiting for execute response
                    self.handle_result_set(reader, header_length)?;
                }
                MySQLStatement::Status::Failed => {
                    let connection = self.get_js_connection();
                    let _flush_guard = scopeguard::guard((), |_| {
                        let _ = self.flush_queue();
                    });
                    // TODO(port): defer captures &mut self; reshape in Phase B if borrowck rejects
                    self.flags.is_ready_for_query = true;
                    self.queue.mark_as_ready_for_query();
                    self.queue.mark_current_request_as_finished(request);
                    connection.on_error_packet(Some(request), statement.error_response);
                }
            }
        }
        Ok(())
    }

    pub fn send_handshake_response(&mut self) -> Result<(), AnyMySQLError> {
        bun_output::scoped_log!(MySQLConnection, "sendHandshakeResponse");
        // Only require password for caching_sha2_password when connecting for the first time
        if let Some(plugin) = self.auth_plugin {
            let requires_password = match plugin {
                AuthMethod::CachingSha2Password => false, // Allow empty password, server will handle auth flow
                AuthMethod::Sha256Password => true,       // Always requires password
                AuthMethod::MysqlNativePassword => false, // Allows empty password
            };

            if requires_password && self.password.is_empty() {
                return Err(AnyMySQLError::PasswordRequired);
            }
        }

        let mut response = HandshakeResponse41 {
            capability_flags: self.capabilities,
            max_packet_size: 0, // 16777216,
            character_set: CharacterSet::default(),
            username: Data::Temporary(&self.user),
            database: Data::Temporary(&self.database),
            auth_plugin_name: Data::Temporary(if let Some(plugin) = self.auth_plugin {
                match plugin {
                    AuthMethod::MysqlNativePassword => b"mysql_native_password",
                    AuthMethod::CachingSha2Password => b"caching_sha2_password",
                    AuthMethod::Sha256Password => b"sha256_password",
                }
            } else {
                b""
            }),
            auth_response: Data::Empty,
            sequence_id: self.sequence_id,
            ..Default::default()
        };

        // Add some basic connect attributes like mysql2
        response.connect_attrs.insert(
            Box::<[u8]>::from(b"_client_name".as_slice()),
            Box::<[u8]>::from(b"Bun".as_slice()),
        );
        response.connect_attrs.insert(
            Box::<[u8]>::from(b"_client_version".as_slice()),
            Box::<[u8]>::from(bun_core::Global::PACKAGE_JSON_VERSION_WITH_REVISION.as_bytes()),
        );

        // Generate auth response based on plugin
        let mut scrambled_buf = [0u8; 32];
        if let Some(plugin) = self.auth_plugin {
            if self.auth_data.is_empty() {
                return Err(AnyMySQLError::MissingAuthData);
            }

            response.auth_response =
                Data::Temporary(plugin.scramble(&self.password, &self.auth_data, &mut scrambled_buf)?);
        }
        response.capability_flags.reject();
        response.write(self.writer())?;
        self.capabilities = response.capability_flags;
        self.flush_data();
        Ok(())
    }

    pub fn send_auth_switch_response(
        &mut self,
        auth_method: AuthMethod,
        plugin_data: &[u8],
    ) -> Result<(), AnyMySQLError> {
        let mut response = AuthSwitchResponse::default();

        let mut scrambled_buf = [0u8; 32];

        response.auth_response =
            Data::Temporary(auth_method.scramble(&self.password, plugin_data, &mut scrambled_buf)?);

        let response_writer = self.writer();
        let mut packet = response_writer.start(self.sequence_id)?;
        response.write(response_writer)?;
        packet.end()?;
        self.flush_data();
        Ok(())
    }

    pub fn writer(&mut self) -> NewWriter<Writer<'_>> {
        NewWriter {
            wrapped: Writer { connection: self },
        }
    }

    pub fn buffered_reader(&mut self) -> NewReader<Reader<'_>> {
        NewReader {
            wrapped: Reader { connection: self },
        }
    }

    fn check_if_prepared_statement_is_done(&mut self, statement: &mut MySQLStatement) {
        bun_output::scoped_log!(
            MySQLConnection,
            "checkIfPreparedStatementIsDone: {} {} {} {}",
            statement.columns_received,
            statement.params_received,
            statement.columns.len(),
            statement.params.len()
        );
        if statement.columns_received == statement.columns.len()
            && statement.params_received == statement.params.len()
        {
            statement.status = MySQLStatement::Status::Prepared;
            self.flags.waiting_to_prepare = false;
            self.flags.is_ready_for_query = true;
            self.queue.mark_as_ready_for_query();
            self.queue.mark_as_prepared();
            statement.reset();
            let connection = self.get_js_connection();
            self.queue.advance(connection);
        }
    }

    pub fn handle_prepared_statement<C>(
        &mut self,
        reader: NewReader<C>,
        header_length: u32, // u24 in Zig
    ) -> Result<(), AnyMySQLError> {
        bun_output::scoped_log!(MySQLConnection, "handlePreparedStatement");
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1);

        let Some(request) = self.queue.current() else {
            bun_output::scoped_log!(MySQLConnection, "Unexpected prepared statement packet missing request");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        request.ref_();
        let _request_guard = scopeguard::guard((), |_| request.deref_());
        let Some(statement) = request.get_statement() else {
            bun_output::scoped_log!(
                MySQLConnection,
                "Unexpected prepared statement packet missing statement"
            );
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        statement.ref_();
        let _statement_guard = scopeguard::guard((), |_| statement.deref_());
        if statement.statement_id > 0 {
            // In legacy protocol (CLIENT_DEPRECATE_EOF not negotiated), the server sends
            // intermediate EOF packets between param definitions and column definitions,
            // and after column definitions. We must consume these EOF packets and only
            // finalize the prepared statement after the trailing EOF is consumed.
            // Disambiguation from a 0xFE length-prefixed row: any 0xFE packet below
            // the 16 MB max-packet marker (0xFFFFFF) is an EOF. See handleResultSet
            // for the full rationale.
            if !self.capabilities.client_deprecate_eof()
                && header_length < 0xFFFFFF
                && PacketType::from_raw(first_byte) == PacketType::EOF
            {
                let mut eof = EOFPacket::default();
                eof.decode(reader)?;
                self.check_if_prepared_statement_is_done(statement);
                return Ok(());
            }
            if statement.params_received < statement.params.len() {
                let mut column = ColumnDefinition41::default();
                column.decode(reader)?;
                statement.params[statement.params_received] = MySQLStatement::Param {
                    type_: column.column_type,
                    flags: column.flags,
                };
                statement.params_received += 1;
            } else if statement.columns_received < statement.columns.len() {
                statement.columns[statement.columns_received].decode(reader)?;
                statement.columns_received += 1;
            }
            // In CLIENT_DEPRECATE_EOF mode, there are no trailing EOF packets, so
            // we check completion after each column/param definition. In legacy mode,
            // completion is deferred to the EOF handler above to avoid marking the
            // statement as prepared before the trailing EOF is consumed.
            if self.capabilities.client_deprecate_eof() {
                self.check_if_prepared_statement_is_done(statement);
            }
            return Ok(());
        }

        match PacketType::from_raw(first_byte) {
            PacketType::OK => {
                let mut ok = StmtPrepareOKPacket {
                    packet_length: header_length,
                    ..Default::default()
                };
                ok.decode(reader)?;

                // Get the current request

                statement.statement_id = ok.statement_id;

                // Read parameter definitions if any
                if ok.num_params > 0 {
                    statement.params =
                        vec![MySQLStatement::Param::default(); ok.num_params as usize].into_boxed_slice();
                    statement.params_received = 0;
                }

                // Read column definitions if any
                if ok.num_columns > 0 {
                    statement.columns =
                        vec![ColumnDefinition41::default(); ok.num_columns as usize].into_boxed_slice();
                    statement.columns_received = 0;
                }

                self.check_if_prepared_statement_is_done(statement);
            }

            PacketType::ERROR => {
                bun_output::scoped_log!(MySQLConnection, "handlePreparedStatement ERROR");
                let mut err = ErrorPacket::default();
                err.decode(reader)?;
                let connection = self.get_js_connection();
                let _advance_guard = scopeguard::guard((), |_| {
                    self.queue.advance(connection);
                });
                // TODO(port): defer captures &mut self.queue; reshape in Phase B if borrowck rejects
                self.flags.is_ready_for_query = true;
                statement.status = MySQLStatement::Status::Failed;
                // err.error_message is a Data{ .temporary = ... } slice into the socket read
                // buffer which will be overwritten by the next packet. The statement is cached
                // in this.statements and its error_response may be read later via
                // stmt.error_response.toJS(), so we must own a copy of the message bytes.
                statement.error_response = ErrorPacket::default(); // drop old (Drop handles deinit)
                statement.error_response = err.clone();
                statement.error_response.error_message = Data::create(err.error_message.slice());
                self.queue.mark_as_ready_for_query();
                self.queue.mark_current_request_as_finished(request);

                connection.on_error_packet(Some(request), err);
            }

            _ => {
                bun_output::scoped_log!(
                    MySQLConnection,
                    "Unexpected prepared statement packet: 0x{:02x}",
                    first_byte
                );
                return Err(AnyMySQLError::UnexpectedPacket);
            }
        }
        Ok(())
    }

    fn handle_result_set_ok(
        &mut self,
        request: &mut JSMySQLQuery,
        statement: &mut MySQLStatement,
        status_flags: StatusFlags,
        last_insert_id: u64,
        affected_rows: u64,
    ) {
        self.status_flags = status_flags;
        let is_last_result = !status_flags.has(StatusFlags::SERVER_MORE_RESULTS_EXISTS);
        let connection = self.get_js_connection();
        bun_output::scoped_log!(
            MySQLConnection,
            "handleResultSetOK: {} {}",
            status_flags.to_int(),
            is_last_result
        );
        let _flush_guard = scopeguard::guard((), |_| {
            // Use flushQueue instead of just advance to ensure any data written
            // by queries added during onQueryResult is actually sent.
            // This fixes a race condition where the auto flusher may not be
            // registered if the queue's current item is completed (not pending).
            let _ = self.flush_queue();
        });
        // TODO(port): defer captures &mut self; reshape in Phase B if borrowck rejects
        self.flags.is_ready_for_query = is_last_result;
        if is_last_result {
            self.queue.mark_as_ready_for_query();
            self.queue.mark_current_request_as_finished(request);
        }

        connection.on_query_result(
            request,
            QueryResult {
                result_count: statement.result_count,
                last_insert_id,
                affected_rows,
                is_last_result,
            },
        );

        statement.reset();
    }

    fn get_js_connection(&mut self) -> *mut JSMySQLConnection {
        // SAFETY: self is the `connection` field embedded inside JSMySQLConnection;
        // @fieldParentPtr("#connection", this) in Zig.
        unsafe {
            (self as *mut Self as *mut u8)
                .sub(offset_of!(JSMySQLConnection, connection))
                .cast::<JSMySQLConnection>()
        }
        // TODO(port): JSMySQLConnection field name was `#connection` (private) in Zig; confirm Rust field name
    }

    fn handle_result_set<C>(
        &mut self,
        reader: NewReader<C>,
        header_length: u32, // u24 in Zig
    ) -> Result<(), AnyMySQLError> {
        let first_byte = reader.int::<u8>()?;
        bun_output::scoped_log!(MySQLConnection, "handleResultSet: {:02x}", first_byte);

        reader.skip(-1);

        let Some(request) = self.queue.current() else {
            bun_output::scoped_log!(MySQLConnection, "Unexpected result set packet");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        request.ref_();
        let _request_guard = scopeguard::guard((), |_| request.deref_());
        let mut ok = OKPacket {
            packet_size: header_length,
            ..Default::default()
        };
        match PacketType::from_raw(first_byte) {
            PacketType::ERROR => {
                let connection = self.get_js_connection();
                let mut err = ErrorPacket::default();
                err.decode(reader)?;
                let _flush_guard = scopeguard::guard((), |_| {
                    let _ = self.flush_queue();
                });
                // TODO(port): defer captures &mut self; reshape in Phase B if borrowck rejects
                if let Some(statement) = request.get_statement() {
                    statement.reset();
                }

                self.flags.is_ready_for_query = true;
                self.queue.mark_as_ready_for_query();
                self.queue.mark_current_request_as_finished(request);

                connection.on_error_packet(Some(request), err);
            }

            packet_type => {
                let Some(statement) = request.get_statement() else {
                    bun_output::scoped_log!(MySQLConnection, "Unexpected result set packet");
                    return Err(AnyMySQLError::UnexpectedPacket);
                };
                statement.ref_();
                let _statement_guard = scopeguard::guard((), |_| statement.deref_());
                if !statement.execution_flags.header_received {
                    if packet_type == PacketType::OK {
                        // if packet type is OK it means the query is done and no results are returned
                        ok.decode(reader)?;
                        self.handle_result_set_ok(
                            request,
                            statement,
                            ok.status_flags,
                            ok.last_insert_id,
                            ok.affected_rows,
                        );
                        return Ok(());
                    }

                    let mut header = ResultSetHeader::default();
                    header.decode(reader)?;
                    if header.field_count == 0 {
                        // Can't be 0
                        return Err(AnyMySQLError::UnexpectedPacket);
                    }
                    if statement.columns.len() != header.field_count as usize {
                        bun_output::scoped_log!(
                            MySQLConnection,
                            "header field count mismatch: {} != {}",
                            statement.columns.len(),
                            header.field_count
                        );
                        statement.cached_structure = Default::default();
                        if !statement.columns.is_empty() {
                            // Clear the slice before the fallible alloc below. If the alloc
                            // fails, MySQLStatement.deinit() would otherwise iterate and free
                            // the already-freed columns again (use-after-free / double-free).
                            statement.columns = Box::default();
                        }
                        statement.columns =
                            vec![ColumnDefinition41::default(); header.field_count as usize]
                                .into_boxed_slice();
                        statement.columns_received = 0;
                    }
                    statement.execution_flags.needs_duplicate_check = true;
                    statement.execution_flags.header_received = true;
                    return Ok(());
                } else if statement.columns_received < statement.columns.len() {
                    statement.columns[statement.columns_received].decode(reader)?;
                    statement.columns_received += 1;
                } else {
                    // A 0xFE-prefixed packet at this point is either the end-of-result
                    // terminator or a row whose first column is a length-encoded integer
                    // starting with 0xFE (values that don't fit in 3 bytes).
                    //
                    // Disambiguation per the MySQL protocol spec: a terminator packet's
                    // payload length is always below the 16 MB max-packet marker
                    // (0xFFFFFF); a 0xFE row prefix means the next 8 bytes are a u64
                    // length, pushing the row payload past that marker. We used to gate
                    // on `header_length < 9` here, but an OK terminator can carry a
                    // trailing human-readable `info` string (e.g. ManticoreSearch's
                    // `szMeta`) that pushes the payload past 9 bytes, causing the
                    // terminator to be misparsed as a row and the query to hang.
                    if packet_type == PacketType::EOF && header_length < 0xFFFFFF {
                        if !self.capabilities.client_deprecate_eof() {
                            // Legacy protocol: EOF packets delimit sections of the result set.
                            // Handle the intermediate EOF (between column defs and rows) and
                            // the final EOF (after all rows) differently.
                            if !statement.execution_flags.columns_eof_received {
                                // Intermediate EOF between column definitions and row data - skip it
                                let mut eof = EOFPacket::default();
                                eof.decode(reader)?;
                                statement.execution_flags.columns_eof_received = true;
                                return Ok(());
                            }
                            // Final EOF after all row data - terminates the result set
                            let mut eof = EOFPacket::default();
                            eof.decode(reader)?;
                            self.handle_result_set_ok(request, statement, eof.status_flags, 0, 0);
                            return Ok(());
                        }

                        // CLIENT_DEPRECATE_EOF mode: OK packet with 0xFE header.
                        ok.decode(reader)?;

                        self.handle_result_set_ok(
                            request,
                            statement,
                            ok.status_flags,
                            ok.last_insert_id,
                            ok.affected_rows,
                        );
                        return Ok(());
                    }

                    let connection = self.get_js_connection();

                    // SAFETY: connection is the parent JSMySQLConnection containing self
                    unsafe { (*connection).on_result_row(request, statement, reader)? };
                }
            }
        }
        Ok(())
    }
}

pub enum AuthState {
    Pending,
    NativePassword,
    CachingSha2(CachingSha2),
    Ok,
}

pub enum CachingSha2 {
    FastAuth,
    FullAuth,
    WaitingKey,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum FlushQueueError {
    #[error("AuthenticationFailed")]
    AuthenticationFailed,
}
impl From<FlushQueueError> for bun_core::Error {
    fn from(e: FlushQueueError) -> Self {
        bun_core::err!("AuthenticationFailed")
    }
}

pub struct Writer<'a> {
    pub connection: &'a mut MySQLConnection,
}

impl<'a> Writer<'a> {
    pub fn write(&self, data: &[u8]) -> Result<(), AnyMySQLError> {
        let buffer = &mut self.connection.write_buffer;
        buffer.write(data)?;
        Ok(())
    }

    pub fn pwrite(&self, data: &[u8], index: usize) -> Result<(), AnyMySQLError> {
        self.connection.write_buffer.byte_list.slice_mut()[index..][..data.len()]
            .copy_from_slice(data);
        Ok(())
    }

    pub fn offset(&self) -> usize {
        self.connection.write_buffer.len()
    }
}

pub struct Reader<'a> {
    pub connection: &'a mut MySQLConnection,
}

impl<'a> Reader<'a> {
    pub fn mark_message_start(&self) {
        self.connection.last_message_start = self.connection.read_buffer.head;
    }

    pub fn set_offset_from_start(&self, offset: usize) {
        self.connection.read_buffer.head =
            self.connection.last_message_start + (offset as u32);
    }

    pub fn ensure_length(&self, count: usize) -> bool {
        self.ensure_capacity(count)
    }

    pub fn peek(&self) -> &[u8] {
        self.connection.read_buffer.remaining()
    }

    pub fn skip(&self, count: isize) {
        if count < 0 {
            let abs_count = count.unsigned_abs();
            if abs_count > self.connection.read_buffer.head as usize {
                self.connection.read_buffer.head = 0;
                return;
            }
            self.connection.read_buffer.head -= u32::try_from(abs_count).unwrap();
            return;
        }

        let ucount: usize = usize::try_from(count).unwrap();
        if self.connection.read_buffer.head as usize + ucount
            > self.connection.read_buffer.byte_list.len as usize
        {
            self.connection.read_buffer.head = self.connection.read_buffer.byte_list.len;
            return;
        }

        self.connection.read_buffer.head += u32::try_from(ucount).unwrap();
    }

    pub fn ensure_capacity(&self, count: usize) -> bool {
        self.connection.read_buffer.remaining().len() >= count
    }

    pub fn read(&self, count: usize) -> Result<Data, AnyMySQLError> {
        let remaining = self.peek();
        if remaining.len() < count {
            return Err(AnyMySQLError::ShortRead);
        }

        self.skip(isize::try_from(count).unwrap());
        Ok(Data::Temporary(&remaining[0..count]))
    }

    pub fn read_z(&self) -> Result<Data, AnyMySQLError> {
        let remaining = self.peek();
        if let Some(zero) = bun_str::strings::index_of_char(remaining, 0) {
            self.skip(isize::try_from(zero + 1).unwrap());
            return Ok(Data::Temporary(&remaining[0..zero as usize]));
        }

        Err(AnyMySQLError::ShortRead)
    }
}

// TODO(port): QueryResult struct shape — defined inline at call site in Zig; confirm canonical type in Phase B
pub struct QueryResult {
    pub result_count: u64,
    pub last_insert_id: u64,
    pub affected_rows: u64,
    pub is_last_result: bool,
}

// TODO(port): IdentityContext(u64) hasher — bun_collections::HashMap should support identity hash for u64 keys
pub type PreparedStatementsMap = HashMap<u64, *mut MySQLStatement>;

const MAX_PIPELINE_SIZE: usize = u16::MAX as usize; // about 64KB per connection

pub type PreparedStatementsMapGetOrPutResult<'a> =
    bun_collections::hash_map::GetOrPutResult<'a, u64, *mut MySQLStatement>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/MySQLConnection.zig (1180 lines)
//   confidence: medium
//   todos:      15
//   notes:      Heavy borrowck reshaping needed for scopeguard defers capturing &mut self; Reader/Writer take &self but mutate via &'a mut connection (interior-mut needed); database/user/password/options should be ranges into options_buf (currently 5 Box<[u8]> — revert init() params to &[u8] in Phase B).
// ──────────────────────────────────────────────────────────────────────────
