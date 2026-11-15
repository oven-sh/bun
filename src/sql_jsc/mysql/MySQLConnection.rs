use bun_uws as uws;
use core::cell::Cell;
use std::rc::Rc;

use bun_sql::mysql::MySQLQueryResult;
use bun_sql::mysql::auth_method::{AuthMethod, AuthResponse, Transport};
use bun_sql::mysql::capabilities::MariaDBCapabilities;
use bun_sql::mysql::connection_state::ConnectionState;
use bun_sql::mysql::mysql_request;
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use bun_sql::mysql::protocol::auth as Auth;
use bun_sql::mysql::protocol::auth_switch_request::AuthSwitchRequest;
use bun_sql::mysql::protocol::character_set::CharacterSet;
use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::mysql::protocol::eof_packet::EOFPacket;
use bun_sql::mysql::protocol::error_packet::ErrorPacket;
use bun_sql::mysql::protocol::handshake_response41::HandshakeResponse41;
use bun_sql::mysql::protocol::handshake_v10::HandshakeV10;
use bun_sql::mysql::protocol::new_writer::NewWriter;
use bun_sql::mysql::protocol::ok_packet::OKPacket;
use bun_sql::mysql::protocol::packet_header::PacketHeader;
use bun_sql::mysql::protocol::packet_reader::PacketReader;
use bun_sql::mysql::protocol::packet_type::PacketType;
use bun_sql::mysql::protocol::prepared_statement::ExecuteParam;
use bun_sql::mysql::protocol::result_set_header::ResultSetHeader;
use bun_sql::mysql::protocol::ssl_request::SSLRequest;
use bun_sql::mysql::protocol::stmt_prepare_ok_packet::StmtPrepareOKPacket;
use bun_sql::mysql::status_flags::StatusFlag;
use bun_sql::mysql::tls_status::TLSStatus;
use bun_sql::postgres::socket_monitor as SocketMonitor;
use bun_sql::shared::SSLMode;
use bun_sql::shared::connection_flags::ConnectionFlags;

use super::JSMySQLConnection;
use crate::jsc::{JSValue, JsResult};
use crate::mysql::js_my_sql_query::JSMySQLQuery;
use crate::mysql::my_sql_statement::{
    self as mysql_statement, ExecutionFlags, MySQLStatement, ResultState, ResultStateGuard,
    StatementCache,
};
use crate::shared::start_tls::{StartTlsError, start_tls, verifies_certificate};
use bun_jsc::rare_data::SocketGroups;
use bun_ptr::{AsCtxPtr, CellExt as _, RefPtr, VecCellExt as _};

bun_core::define_scoped_log!(debug, MySQLConnection, visible);

/// The head of the queue, held across the packets of one result in one read.
struct CurrentRequest {
    request: RefPtr<JSMySQLQuery>,
    statement: ResultStateGuard,
}

/// What ends a result set or the reply to a COM_STMT_PREPARE. The packet it names is still to be read.
enum Terminator {
    Prepared,
    Ok,
    Eof,
    Error,
}

impl JSMySQLConnection {
    fn update_flags(&self, f: impl FnOnce(&mut ConnectionFlags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    pub(super) fn write_buffer_len(&self) -> usize {
        self.write_buffer.with_taken(|buffer| buffer.len())
    }

    #[inline]
    pub(crate) fn is_able_to_write(&self) -> bool {
        self.status.get() == ConnectionState::Connected
            && !self.has_backpressure()
            && self.write_buffer_len() < MAX_PIPELINE_SIZE
    }

    #[inline]
    pub(crate) fn has_backpressure(&self) -> bool {
        self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE)
    }
    #[inline]
    pub(crate) fn reset_backpressure(&self) {
        self.update_flags(|f| f.remove(ConnectionFlags::HAS_BACKPRESSURE));
    }

    #[inline]
    pub(crate) fn is_idle(&self) -> bool {
        self.queue.is_empty() && self.write_buffer_len() == 0
    }

    /// As of the last reply that said so: an ERR packet has no status.
    #[inline]
    pub(crate) fn is_in_transaction(&self) -> bool {
        self.status_flags
            .get()
            .has(StatusFlag::SERVER_STATUS_IN_TRANS)
    }

    #[inline]
    pub(crate) fn take_on_connect_pending(&self) -> bool {
        let pending = self
            .flags
            .get()
            .contains(ConnectionFlags::ON_CONNECT_PENDING);
        self.update_flags(|f| f.remove(ConnectionFlags::ON_CONNECT_PENDING));
        pending
    }

    fn transport(&self) -> Transport {
        if self.tls_status.get() == TLSStatus::SslOk {
            Transport::Tls
        } else if self.unix_socket {
            Transport::UnixSocket
        } else {
            Transport::Tcp
        }
    }

    pub(super) fn flush_queue(&self) -> Result<(), FlushQueueError> {
        self.flush_data();
        if self.tls_status.get() == TLSStatus::MessageSent {
            if !self.has_backpressure() {
                self.upgrade_to_tls()?;
            }
            return Ok(());
        }
        // Under backpressure too: the next reply is for the request behind the one that just ended.
        self.advance();
        self.flush_data();
        Ok(())
    }

    pub(super) fn advance(&self) {
        self.queue.advance(self);
    }

    fn flush_data(&self) {
        // we know we still have backpressure so just return we will flush later
        if self.has_backpressure() {
            debug!("flushData: has backpressure");
            return;
        }

        if self.write_buffer_len() == 0 {
            return;
        }

        let mut buffer = self.write_buffer.take();
        let chunk = buffer.remaining();
        let wrote = self.socket.get().write(chunk);
        self.update_flags(|f| {
            f.set(
                ConnectionFlags::HAS_BACKPRESSURE,
                usize::try_from(wrote).unwrap_or(0) < chunk.len(),
            )
        });
        debug!("flushData: wrote {}/{} bytes", wrote, chunk.len());
        if wrote > 0 {
            let wrote_usize = usize::try_from(wrote).expect("int cast");
            SocketMonitor::write(&chunk[0..wrote_usize]);
            buffer.consume(wrote_usize);
        }
        self.write_buffer.put_back(buffer);
    }

    fn upgrade_to_tls(&self) -> Result<(), FlushQueueError> {
        let started = start_tls(
            self.as_ctx_ptr(),
            self.socket.get(),
            (uws::SocketKind::MysqlTls, SocketGroups::mysql_group::<true>),
            self.secure.as_ref(),
            &self.tls_config,
            self.ssl_mode,
            |socket| self.socket.set(socket),
        );
        match started {
            Err(StartTlsError::Failed) => Err(FlushQueueError::AuthenticationFailed),
            // `NotPlain`: the handshake is under way.
            _ => Ok(()),
        }
    }

    /// Connecting or connected: not failed, and not closed.
    pub(crate) fn is_active(&self) -> bool {
        self.status.get() != ConnectionState::Failed
    }

    /// verify-full's name check, asked inside the handshake.
    pub fn server_identity(&self, ssl: &bun_boringssl_sys::SSL) -> bun_boringssl::ServerIdentity {
        bun_boringssl::server_identity(ssl, self.native_identity_hostname())
    }

    /// The name verify-full matches, in and after the handshake. Empty (none configured) matches no certificate.
    /// `tls.checkServerIdentity` replaces the match, as in Node.
    fn native_identity_hostname(&self) -> Option<&[u8]> {
        (self.tls_config.reject_unauthorized() != 0
            && self.ssl_mode == SSLMode::VerifyFull
            && self.check_server_identity_callback().is_none())
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
        self.tls_status.get() == TLSStatus::MessageSent
    }

    /// Whether `sslmode` accepts what the TLS handshake gave.
    pub(crate) fn do_handshake(&self, success: i32, ssl_error: uws::us_bun_verify_error_t) -> bool {
        bun_core::scoped_log!(
            MySQLConnection,
            "onHandshake: {} {} {:?}",
            success,
            ssl_error.error_no,
            self.ssl_mode
        );
        let handshake_success = success == 1;
        self.sequence_id.update(|id| id.wrapping_add(1));
        if handshake_success {
            self.tls_status.set(TLSStatus::SslOk);
            if self.tls_config.reject_unauthorized() != 0 {
                // follow the same rules as postgres
                // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279
                // only reject the connection if reject_unauthorized == true
                match self.ssl_mode {
                    SSLMode::VerifyCa | SSLMode::VerifyFull => {
                        if ssl_error.error_no != 0 {
                            self.tls_status.set(TLSStatus::None);
                            return false;
                        }

                        // VerifyFull additionally requires the certificate identity to
                        // match the intended host. Absence of a configured server name is
                        // not a license to skip the check — fail closed.
                        let identity_ok = self.native_identity_hostname().is_none_or(|hostname| {
                            let socket = self.socket.get();
                            // SAFETY: `socket` is live or detached, and `ssl` is used at once.
                            !hostname.is_empty()
                                && unsafe { socket.ssl() }
                                    .is_some_and(|ssl| uws::check_server_identity(ssl, hostname))
                        });
                        if !identity_ok {
                            self.tls_status.set(TLSStatus::None);
                            return false;
                        }
                    }
                    // require is the same as prefer
                    SSLMode::Require | SSLMode::Prefer | SSLMode::Disable => {}
                }
            }
            return true;
        }
        self.tls_status.set(TLSStatus::None);
        // if we are here is because server rejected us, and the error_no is the cause of this
        // no matter if reject_unauthorized is false because we are disconnected by the server
        false
    }

    pub(crate) fn read_and_process_data(&self, mut data: &[u8]) -> Result<(), AnyMySQLError> {
        SocketMonitor::read(data);
        if self.defer_reads.get() {
            bun_core::handle_oom(self.read_buffer.with_taken(|buffer| buffer.write(data)));
            return Ok(());
        }
        self.update_flags(|f| f.insert(ConnectionFlags::IS_PROCESSING_DATA));

        let mut buffer = self.read_buffer.take();
        let mut current = None;
        let result = loop {
            let cursor = Cell::new(0usize);
            let message_start = Cell::new(0usize);
            let result;
            if buffer.remaining().is_empty() {
                let reader = PacketReader::new(data, &cursor, &message_start);
                result = self.process_packets(reader, &mut current);
                if result == Err(AnyMySQLError::ShortRead) {
                    bun_core::handle_oom(buffer.write(&data[message_start.get()..]));
                }
            } else {
                bun_core::handle_oom(buffer.write(data));
                let reader = PacketReader::new(buffer.remaining(), &cursor, &message_start);
                result = self.process_packets(reader, &mut current);
                buffer.consume(message_start.get());
            }
            let read_meanwhile = self.read_buffer.take();
            if read_meanwhile.is_empty() || result != Err(AnyMySQLError::ShortRead) {
                break result;
            }
            bun_core::handle_oom(buffer.write(read_meanwhile.remaining()));
            data = b"";
        };
        self.read_buffer.set(buffer);
        self.defer_reads.set(false);

        self.update_flags(|f| f.remove(ConnectionFlags::IS_PROCESSING_DATA));
        match result {
            Ok(()) | Err(AnyMySQLError::ShortRead) => Ok(()),
            Err(err) => {
                debug!("processPackets: {}", <&'static str>::from(err));
                bun_core::handle_error_return_trace(err);
                Err(err)
            }
        }
    }

    /// Frames the packets. `ShortRead` (wait for the socket) comes from here and from nowhere else.
    fn process_packets(
        &self,
        reader: PacketReader<'_>,
        current: &mut Option<CurrentRequest>,
    ) -> Result<(), AnyMySQLError> {
        loop {
            reader.mark_message_start();

            let header = PacketHeader::decode(reader.peek()).ok_or(AnyMySQLError::ShortRead)?;
            let packet_length: usize = header.length as usize + PacketHeader::SIZE;
            debug!(
                "sequence_id: {} header: {}",
                self.sequence_id.get(),
                header.length
            );
            reader.ensure_capacity(packet_length)?;
            if header.length as usize == PacketHeader::MAX_PAYLOAD_LENGTH {
                self.process_split_packet(reader, current)?;
                continue;
            }
            let payload = &reader.peek()[PacketHeader::SIZE..packet_length];
            reader.set_offset_from_start(packet_length);
            self.defer_reads.set(!reader.peek().is_empty());
            self.handle_packet(
                payload,
                header.sequence_id,
                header.sequence_id.wrapping_add(1),
                current,
            )?;
            // After the SSLRequest, bytes already buffered behind this packet are plaintext a
            // man-in-the-middle could have injected (CVE-2021-23222 class).
            if self.tls_status.get() == TLSStatus::MessageSent && !reader.peek().is_empty() {
                return Err(AnyMySQLError::UnexpectedPacket);
            }
        }
    }

    /// `payload` is one whole packet, so a handler cannot read into the next one.
    /// It came with `sequence_id`, and `next_sequence_id` is the one behind its last part.
    fn handle_packet(
        &self,
        payload: &[u8],
        sequence_id: u8,
        next_sequence_id: u8,
        current: &mut Option<CurrentRequest>,
    ) -> Result<(), AnyMySQLError> {
        let begins_reply = !self.in_reply.get();
        let in_step = begins_reply || sequence_id == self.sequence_id.get();
        self.sequence_id.set(next_sequence_id);
        self.in_reply
            .set(self.status.get() == ConnectionState::Connected);

        let cursor = Cell::new(0usize);
        let message_start = Cell::new(0usize);
        let reader = PacketReader::new(payload, &cursor, &message_start);
        match self.status.get() {
            ConnectionState::Handshaking => self.handle_handshake(reader),
            ConnectionState::Authenticating | ConnectionState::AuthenticationAwaitingPk => {
                self.handle_auth(reader)
            }
            ConnectionState::SessionSetup => self.handle_session_setup(reader),
            ConnectionState::Connected if in_step => {
                self.handle_command(reader, begins_reply, current)
            }
            ConnectionState::Connected => self.handle_unasked(reader),
            _ => {
                debug!("Unexpected packet in state {}", self.status.get() as u8);
                Err(AnyMySQLError::UnexpectedPacket)
            }
        }
    }

    fn handle_handshake(&self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        // A server that takes no connection, or none from this host, says so in place of its greeting.
        if reader.peek().first() == Some(&PacketType::ERROR.0) {
            return self.handle_unasked(reader);
        }
        let mut handshake = HandshakeV10::default();
        handshake.decode_internal(reader)?;
        // Negotiate capabilities: only request capabilities that the server also supports.
        // Per MySQL protocol, the client MUST intersect its desired capabilities with the
        // server's advertised capabilities. This ensures features like CLIENT_DEPRECATE_EOF
        // are only used when the server actually supports them (critical for MySQL-compatible
        // databases like StarRocks, TiDB, SingleStore, etc.).
        self.capabilities
            .update(|capabilities| capabilities.intersect(handshake.capability_flags));
        self.mariadb_capabilities.set(
            MariaDBCapabilities::get_default_capabilities()
                .intersect(handshake.mariadb_capability_flags),
        );

        self.status_flags.set(handshake.status_flags);

        bun_core::scoped_log!(
            MySQLConnection,
            "Handshake\n   Server Version: {}\n   Connection ID:  {}\n   Character Set:  {} ({})\n   Server Capabilities:   [ {} ] 0x{:08x}\n   Negotiated Capabilities: [ {} ] 0x{:08x}\n   Status Flags:   [ {} ]\n",
            bstr::BStr::new(handshake.server_version),
            handshake.connection_id,
            u32::from(CharacterSet::default().to_int()),
            bstr::BStr::new(CharacterSet::default().label()),
            handshake.capability_flags,
            handshake.capability_flags.to_int(),
            self.capabilities.get(),
            self.capabilities.get().to_int(),
            self.status_flags.get()
        );

        self.auth_data.set(handshake.auth_plugin_data);

        if !handshake.auth_plugin_name.is_empty() {
            self.auth_plugin
                .set(Some(self.auth_plugin_named(handshake.auth_plugin_name)?));
        }

        self.set_status(ConnectionState::Authenticating);

        // https://dev.mysql.com/doc/dev/mysql-server/8.4.6/page_protocol_connection_phase_packets_protocol_ssl_request.html
        if self.capabilities.get().CLIENT_SSL {
            let mut response = SSLRequest {
                capability_flags: self.capabilities.get(),
                mariadb_capability_flags: self.mariadb_capabilities.get(),
                max_packet_size: 0, // 16777216,
                character_set: CharacterSet::default(),
                // bun always send connection attributes
                has_connection_attributes: true,
            };
            self.with_writer(|writer| response.write_internal(writer))?;
            self.capabilities.set(response.capability_flags);
            self.tls_status.set(TLSStatus::MessageSent);
            self.flush_data();
            if !self.has_backpressure() {
                self.upgrade_to_tls()
                    .map_err(|_| AnyMySQLError::AuthenticationFailed)?;
            }
            return Ok(());
        }
        if self.tls_status.get() != TLSStatus::None {
            self.tls_status.set(TLSStatus::None);

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

    fn auth_plugin_named(&self, name: &[u8]) -> Result<AuthMethod, AnyMySQLError> {
        AuthMethod::from_string(name).ok_or_else(|| {
            self.fail_fmt(
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
        &self,
        reader: PacketReader<'_>,
    ) -> Result<(), AnyMySQLError> {
        let mut response = Auth::caching_sha2_password::PublicKeyResponse::default();
        response.decode(reader)?;
        // revert back to authenticating since we received the public key
        self.set_status(ConnectionState::Authenticating);

        let encrypted_password = Auth::caching_sha2_password::EncryptedPassword {
            password: &self.password,
            public_key: response.data,
            nonce: self.auth_data.get(),
            sequence_id: self.sequence_id.get(),
        };
        self.with_writer(|writer| encrypted_password.write(writer))?;
        self.flush_data();
        Ok(())
    }

    fn set_status(&self, status: ConnectionState) {
        if self.status.get() == status {
            return;
        }

        self.status.set(status);

        if status == ConnectionState::Connected {
            self.update_flags(|f| f.insert(ConnectionFlags::ON_CONNECT_PENDING));
        }
    }

    fn handle_auth(&self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1isize);

        bun_core::scoped_log!(MySQLConnection, "Auth packet: 0x{:02x}", first_byte);

        match first_byte {
            x if x == PacketType::OK.0 => {
                let mut ok = OKPacket::default();
                ok.decode_internal(reader)?;

                self.status_flags.set(ok.status_flags);
                self.send_session_setup()?;
            }

            x if x == PacketType::ERROR.0 => {
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;

                self.on_error_packet(None, &err);
                return Err(AnyMySQLError::AuthenticationFailed);
            }

            x if x == PacketType::MORE_DATA.0 => {
                if let Some(plugin) = self.auth_plugin.get() {
                    match plugin {
                        AuthMethod::Sha256Password | AuthMethod::CachingSha2Password => {
                            reader.skip(1);

                            if self.status.get() == ConnectionState::AuthenticationAwaitingPk {
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

                                    if self.full_auth_requested.get() {
                                        return Err(AnyMySQLError::UnexpectedPacket);
                                    }
                                    self.full_auth_requested.set(true);

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

                let auth_method = self.auth_plugin_named(auth_switch.plugin_name)?;

                // Bound a hostile server's auth ping-pong.
                if self.auth_switch_count.get() >= 2
                    || (self.auth_switch_count.get() > 0
                        && self.auth_plugin.get() == Some(auth_method))
                {
                    bun_core::scoped_log!(
                        MySQLConnection,
                        "rejecting AuthSwitchRequest (count={}, plugin={:?})",
                        self.auth_switch_count.get(),
                        auth_method
                    );
                    return Err(AnyMySQLError::UnexpectedPacket);
                }
                self.auth_switch_count.update(|count| count + 1);

                self.auth_plugin.set(Some(auth_method));
                self.auth_data.set(Auth::nonce(auth_switch.plugin_data)?);

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
    fn send_session_setup(&self) -> Result<(), AnyMySQLError> {
        self.set_status(ConnectionState::SessionSetup);
        self.with_writer(|writer| {
            mysql_request::execute_query(b"SET time_zone = '+00:00'", writer)
        })?;
        self.flush_data();
        Ok(())
    }

    fn handle_session_setup(&self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1isize);

        match first_byte {
            x if x == PacketType::OK.0 => {
                let mut ok = OKPacket::default();
                ok.decode_internal(reader)?;

                self.set_status(ConnectionState::Connected);

                self.status_flags.set(ok.status_flags);
                self.advance();
                Ok(())
            }
            x if x == PacketType::ERROR.0 => {
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;

                self.on_error_packet(None, &err);
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

    fn handle_command(
        &self,
        reader: PacketReader<'_>,
        begins_reply: bool,
        current: &mut Option<CurrentRequest>,
    ) -> Result<(), AnyMySQLError> {
        let CurrentRequest { request, statement } = match current {
            Some(current) => current,
            None => {
                let Some(request) = self.queue.in_flight() else {
                    return self.handle_unasked(reader);
                };
                let statement = request.statement().ok_or(AnyMySQLError::UnexpectedPacket)?;
                // A result without a result set needs no `ResultStateGuard`.
                if begins_reply
                    && reader.peek().first() == Some(&PacketType::OK.0)
                    && statement.status.get() == mysql_statement::Status::Prepared
                {
                    let mut ok = OKPacket::default();
                    ok.decode_internal(reader)?;
                    let description = request.description(&statement, None);
                    drop(statement);
                    self.handle_result_set_ok(&request, 0, description, &ok);
                    return Ok(());
                }
                current.get_or_insert_with(|| CurrentRequest {
                    request,
                    statement: ResultStateGuard::new(statement),
                })
            }
        };
        let (statement, result) = statement.split();
        let end = match statement.status.get() {
            mysql_statement::Status::Parsing => {
                self.handle_prepared_statement(statement, result, reader)?
            }
            mysql_statement::Status::Prepared => {
                self.handle_result_set(request, statement, result, reader)?
            }
            _ => return Err(AnyMySQLError::UnexpectedPacket),
        };
        match end {
            None => {}
            Some(Terminator::Prepared) => {
                if let Some(CurrentRequest { request, statement }) = current.take() {
                    self.on_statement_prepared(&request, statement);
                }
            }
            Some(end @ (Terminator::Ok | Terminator::Eof)) => {
                let mut ok = OKPacket::default();
                if let Terminator::Eof = end {
                    let mut eof = EOFPacket::default();
                    eof.decode_internal(reader)?;
                    ok.status_flags = eof.status_flags;
                } else {
                    ok.decode_internal(reader)?;
                }
                let result_count = result.result_count;
                let has_columns = result
                    .execution_flags
                    .contains(ExecutionFlags::HEADER_RECEIVED);
                result.reset();
                let columns = has_columns.then_some(&mut result.columns);
                let description = request.description(statement, columns);
                if let Some(request) = current.take().map(|current| current.request) {
                    self.handle_result_set_ok(&request, result_count, description, &ok);
                }
            }
            Some(Terminator::Error) => {
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;
                if let Some(request) = current.take().map(|current| current.request) {
                    self.on_request_error(&request, &err)?;
                }
            }
        }
        Ok(())
    }

    /// No request waits for this packet, or it is not the next one of the reply that has begun:
    /// whose it is cannot be told. Always `Err`, which fails the connection.
    fn handle_unasked(&self, reader: PacketReader<'_>) -> Result<(), AnyMySQLError> {
        // The ERR that says why the server drops the connection (KILL, wait_timeout).
        if reader.peek().first() == Some(&PacketType::ERROR.0) {
            let mut err = ErrorPacket::default();
            err.decode_internal(reader)?;
            self.on_error_packet(None, &err);
            return Err(AnyMySQLError::ConnectionClosed);
        }
        debug!("Received unexpected command response");
        Err(AnyMySQLError::UnexpectedPacket)
    }

    pub(crate) fn send_handshake_response(&self) -> Result<(), AnyMySQLError> {
        debug!("sendHandshakeResponse");
        let mut scrambled_buf = [0u8; 32];
        let auth_response = match self.auth_plugin.get() {
            Some(plugin) => plugin.first_response(
                &self.password,
                &self.auth_data.get(),
                self.transport(),
                &mut scrambled_buf,
            ),
            None => AuthResponse::Scramble(&[]),
        };
        let awaits_public_key = self.awaits_public_key(&auth_response)?;

        let mut response = HandshakeResponse41 {
            capability_flags: self.capabilities.get(),
            mariadb_capability_flags: self.mariadb_capabilities.get(),
            max_packet_size: 0, // 16777216,
            character_set: CharacterSet::default(),
            username: &self.user,
            database: &self.database,
            auth_plugin_name: self.auth_plugin.get().map_or(&b""[..], AuthMethod::name),
            auth_response,
            sequence_id: self.sequence_id.get(),
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
        self.with_writer(|writer| response.write(writer))?;
        self.capabilities.set(response.capability_flags);
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
        &self,
        plugin: AuthMethod,
        full_authentication: bool,
    ) -> Result<(), AnyMySQLError> {
        let mut scrambled_buf = [0u8; 32];
        let response = if full_authentication {
            plugin.full_authentication(&self.password, self.transport())
        } else {
            plugin.first_response(
                &self.password,
                &self.auth_data.get(),
                self.transport(),
                &mut scrambled_buf,
            )
        };
        let awaits_public_key = self.awaits_public_key(&response)?;
        self.with_writer(|writer| {
            let packet = writer.start(self.sequence_id.get())?;
            response.write(writer)?;
            packet.end(writer)
        })?;
        if awaits_public_key {
            self.set_status(ConnectionState::AuthenticationAwaitingPk);
        }
        self.flush_data();
        Ok(())
    }

    pub(crate) fn with_writer<R>(&self, f: impl FnOnce(&mut NewWriter<'_>) -> R) -> R {
        let mut buffer = self.write_buffer.take();
        let result = f(&mut NewWriter::new(&mut buffer.byte_list));
        self.write_buffer.put_back(buffer);
        result
    }

    fn process_split_packet(
        &self,
        reader: PacketReader<'_>,
        current: &mut Option<CurrentRequest>,
    ) -> Result<(), AnyMySQLError> {
        if self.status.get() != ConnectionState::Connected {
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
        self.defer_reads.set(!reader.peek().is_empty());
        self.handle_packet(&payload, first_sequence_id, sequence_id, current)
    }

    pub(crate) fn cached_statement<P: ExecuteParam>(
        &self,
        query: &[u8],
        params: &[P],
    ) -> Option<Rc<MySQLStatement>> {
        self.statements.get(query, params)
    }

    pub(crate) fn prepare_statement<P: ExecuteParam>(
        &self,
        query: &[u8],
        params: &[P],
    ) -> Result<Rc<MySQLStatement>, AnyMySQLError> {
        let statement = self.statements.insert(query, params);
        if let Some(evicted) = self.statements.evict(StatementCache::MAX_STATEMENTS) {
            self.write_close_statement(&evicted);
        }
        if let Err(err) = self.with_writer(|writer| mysql_request::prepare_request(query, writer)) {
            self.statements.remove(&statement);
            return Err(err.into());
        }
        Ok(statement)
    }

    fn write_close_statement(&self, statement: &MySQLStatement) {
        let id = statement.statement_id.get();
        let _ = self.with_writer(|writer| mysql_request::close_statement(id, writer));
    }

    fn on_statement_prepared(&self, request: &JSMySQLQuery, statement: ResultStateGuard) {
        // Also for a request that was cancelled meanwhile: the next execution with as many values would find it.
        if !statement.parameter_count_matches() {
            self.statements.remove(&statement);
            self.write_close_statement(&statement);
        }
        drop(statement);
        self.in_reply.set(false);
        request.prepared();
        self.advance();
    }

    /// Without a COM_QUIT the server counts an aborted client.
    pub(crate) fn quit(&self) {
        if self.is_able_to_write()
            && self.write_buffer_len() == 0
            && self.queue.in_flight().is_none()
            && self.with_writer(mysql_request::quit).is_ok()
        {
            self.flush_data();
        }
    }

    fn check_if_prepared_statement_is_done(
        statement: &MySQLStatement,
        result: &mut ResultState,
    ) -> Option<Terminator> {
        bun_core::scoped_log!(
            MySQLConnection,
            "checkIfPreparedStatementIsDone: {} {} {} {}",
            result.columns_received,
            result.params_received,
            result.columns.len(),
            statement.params.len()
        );
        let is_done = result.columns_received as usize == result.columns.len()
            && result.params_received as usize == statement.params.len();
        if is_done {
            statement.status.set(mysql_statement::Status::Prepared);
            result.reset();
        }
        is_done.then_some(Terminator::Prepared)
    }

    fn handle_prepared_statement(
        &self,
        statement: &MySQLStatement,
        result: &mut ResultState,
        mut reader: PacketReader<'_>,
    ) -> Result<Option<Terminator>, AnyMySQLError> {
        debug!("handlePreparedStatement");
        let payload_length = reader.peek().len();
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1isize);

        if statement.statement_id.get() > 0 {
            // In legacy protocol (CLIENT_DEPRECATE_EOF not negotiated), the server sends
            // intermediate EOF packets between param definitions and column definitions,
            // and after column definitions. We must consume these EOF packets and only
            // finalize the prepared statement after the trailing EOF is consumed.
            // Disambiguation from a 0xFE length-prefixed row: any 0xFE packet below
            // the 16 MB max-packet marker (0xFFFFFF) is an EOF. See handleResultSet
            // for the full rationale.
            if !self.capabilities.get().CLIENT_DEPRECATE_EOF
                && payload_length < PacketHeader::MAX_PAYLOAD_LENGTH
                && PacketType(first_byte) == PacketType::EOF
            {
                let mut eof = EOFPacket::default();
                eof.decode_internal(reader)?;
                return Ok(Self::check_if_prepared_statement_is_done(statement, result));
            }
            let extended_type_info = self
                .mariadb_capabilities
                .get()
                .MARIADB_CLIENT_EXTENDED_TYPE_INFO;
            if (result.params_received as usize) < statement.params.len() {
                let mut column = ColumnDefinition41::default();
                column.decode(&mut reader, extended_type_info)?;
                let index = result.params_received as usize;
                statement
                    .params
                    .with_taken(|params| params[index] = column.column_type);
                result.params_received += 1;
            } else if (result.columns_received as usize) < result.columns.len() {
                // Only counted: every execution brings the definitions again.
                ColumnDefinition41::default().decode(&mut reader, extended_type_info)?;
                result.columns_received += 1;
            }
            // In CLIENT_DEPRECATE_EOF mode, there are no trailing EOF packets, so
            // we check completion after each column/param definition. In legacy mode,
            // completion is deferred to the EOF handler above to avoid marking the
            // statement as prepared before the trailing EOF is consumed.
            if self.capabilities.get().CLIENT_DEPRECATE_EOF {
                return Ok(Self::check_if_prepared_statement_is_done(statement, result));
            }
            return Ok(None);
        }

        match PacketType(first_byte) {
            PacketType::OK => {
                let mut ok = StmtPrepareOKPacket::default();
                ok.decode(reader)?;

                statement.statement_id.set(ok.statement_id);

                if ok.num_params > 0 {
                    // Slots are overwritten as param-definition packets
                    // arrive, so the initial value is a placeholder.
                    statement
                        .params
                        .set(vec![FieldType::MYSQL_TYPE_NULL; ok.num_params as usize]);
                    result.params_received = 0;
                }

                if ok.num_columns > 0 {
                    result.columns = (0..ok.num_columns as usize)
                        .map(|_| ColumnDefinition41::default())
                        .collect();
                    result.columns_received = 0;
                }

                Ok(Self::check_if_prepared_statement_is_done(statement, result))
            }

            PacketType::ERROR => {
                debug!("handlePreparedStatement ERROR");
                // The cache holds handles the server has. The next use of the text prepares again.
                self.statements.remove(statement);
                Ok(Some(Terminator::Error))
            }

            _ => {
                bun_core::scoped_log!(
                    MySQLConnection,
                    "Unexpected prepared statement packet: 0x{:02x}",
                    first_byte
                );
                Err(AnyMySQLError::UnexpectedPacket)
            }
        }
    }

    /// `err` answers `request`. `Err` fails the connection.
    fn on_request_error(
        &self,
        request: &JSMySQLQuery,
        err: &ErrorPacket<'_>,
    ) -> Result<(), AnyMySQLError> {
        self.in_reply.set(false);
        self.on_error_packet(Some(request), err);
        if err.ends_session() {
            return Err(AnyMySQLError::ConnectionClosed);
        }
        let _ = self.flush_queue();
        Ok(())
    }

    fn handle_result_set_ok(
        &self,
        request: &JSMySQLQuery,
        result_count: u64,
        description: JsResult<JSValue>,
        ok: &OKPacket,
    ) {
        let status_flags = ok.status_flags;
        self.status_flags.set(status_flags);
        let is_last_result = !status_flags.has(StatusFlag::SERVER_MORE_RESULTS_EXISTS);
        self.in_reply.set(!is_last_result);
        debug!(
            "handleResultSetOK: {} {}",
            status_flags.to_int(),
            is_last_result
        );

        let result = MySQLQueryResult {
            result_count,
            last_insert_id: ok.last_insert_id,
            affected_rows: ok.affected_rows,
            is_last_result,
        };
        request.resolve(&result, description);

        // Not only `advance()`: what it writes has to be sent, and the auto flusher may not be registered.
        let _ = self.flush_queue();
    }

    fn handle_result_set(
        &self,
        request: &JSMySQLQuery,
        statement: &MySQLStatement,
        result: &mut ResultState,
        mut reader: PacketReader<'_>,
    ) -> Result<Option<Terminator>, AnyMySQLError> {
        let payload_length = reader.peek().len();
        let first_byte = reader.int::<u8>()?;
        debug!("handleResultSet: {:02x}", first_byte);

        reader.skip(-1isize);

        match PacketType(first_byte) {
            PacketType::ERROR => {
                result.reset();
                return Ok(Some(Terminator::Error));
            }

            packet_type => {
                if !result
                    .execution_flags
                    .contains(ExecutionFlags::HEADER_RECEIVED)
                {
                    if packet_type == PacketType::OK {
                        // if packet type is OK it means the query is done and no results are returned
                        return Ok(Some(Terminator::Ok));
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
                    if result.columns.len() as u64 != header.field_count {
                        bun_core::scoped_log!(
                            MySQLConnection,
                            "header field count mismatch: {} != {}",
                            result.columns.len(),
                            header.field_count
                        );
                        if !result.columns.is_empty() {
                            result.columns = Vec::new();
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
                        result.columns = columns;
                        result.columns_received = 0;
                        result.cached_structure = Default::default();
                        statement.clear_description();
                        result.fields_flags = Default::default();
                    }
                    result
                        .execution_flags
                        .insert(ExecutionFlags::NEEDS_DUPLICATE_CHECK);
                    result
                        .execution_flags
                        .insert(ExecutionFlags::HEADER_RECEIVED);
                    return Ok(None);
                } else if (result.columns_received as usize) < result.columns.len() {
                    use bun_sql::mysql::protocol::column_definition41::Changed;
                    let index = result.columns_received as usize;
                    let changed = result.columns[index].decode(
                        &mut reader,
                        self.mariadb_capabilities
                            .get()
                            .MARIADB_CLIENT_EXTENDED_TYPE_INFO,
                    )?;
                    result.columns_received += 1;
                    match changed {
                        Changed::Nothing => {}
                        Changed::Description => statement.clear_description(),
                        Changed::Name => {
                            result.cached_structure = Default::default();
                            statement.clear_description();
                            result.fields_flags = Default::default();
                            result
                                .execution_flags
                                .insert(ExecutionFlags::NEEDS_DUPLICATE_CHECK);
                            // The column transform can run the event loop; rows must wait for it.
                            self.defer_reads.set(true);
                            self.on_column_name(request, &mut result.columns[index])?;
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
                        if !self.capabilities.get().CLIENT_DEPRECATE_EOF {
                            // Legacy protocol: EOF packets delimit sections of the result set.
                            // Handle the intermediate EOF (between column defs and rows) and
                            // the final EOF (after all rows) differently.
                            if !result
                                .execution_flags
                                .contains(ExecutionFlags::COLUMNS_EOF_RECEIVED)
                            {
                                // Intermediate EOF between column definitions and row data - skip it
                                let mut eof = EOFPacket::default();
                                eof.decode_internal(reader)?;
                                result
                                    .execution_flags
                                    .insert(ExecutionFlags::COLUMNS_EOF_RECEIVED);
                                return Ok(None);
                            }
                            // Final EOF after all row data - terminates the result set
                            return Ok(Some(Terminator::Eof));
                        }

                        // CLIENT_DEPRECATE_EOF mode: OK packet with 0xFE header.
                        return Ok(Some(Terminator::Ok));
                    }

                    self.on_result_row(request, result, reader)?;
                }
            }
        }
        Ok(None)
    }
}

#[derive(strum::IntoStaticStr, Debug)]
pub(super) enum FlushQueueError {
    AuthenticationFailed,
}

const MAX_PIPELINE_SIZE: usize = u16::MAX as usize; // about 64KB per connection
