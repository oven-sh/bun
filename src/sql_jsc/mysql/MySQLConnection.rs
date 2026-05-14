use core::mem::offset_of;

use crate::jsc::{JSValue, VirtualMachineSqlExt as _};
use bun_collections::{HashMap, OffsetByteList, VecExt};
use bun_uws::{self as uws, AnySocket as Socket, SslCtx};

use bun_sql::mysql::Capabilities;
use bun_sql::mysql::MySQLQueryResult;
use bun_sql::mysql::auth_method::AuthMethod;
use bun_sql::mysql::connection_state::ConnectionState;
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::any_mysql_error::{self as any_mysql_error, Error as AnyMySQLError};
use bun_sql::mysql::protocol::auth as Auth;
use bun_sql::mysql::protocol::auth_switch_request::AuthSwitchRequest;
use bun_sql::mysql::protocol::auth_switch_response::AuthSwitchResponse;
use bun_sql::mysql::protocol::character_set::CharacterSet;
use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::mysql::protocol::column_definition41::ColumnFlags;
use bun_sql::mysql::protocol::eof_packet::EOFPacket;
use bun_sql::mysql::protocol::handshake_response41::HandshakeResponse41;
use bun_sql::mysql::protocol::handshake_v10::HandshakeV10;
use bun_sql::mysql::protocol::local_infile_request::LocalInfileRequest;
use bun_sql::mysql::protocol::new_reader::{NewReader, ReaderContext};
use bun_sql::mysql::protocol::new_writer::{NewWriterWrap as NewWriter, WriterContext};
use bun_sql::mysql::protocol::ok_packet::OKPacket;
use bun_sql::mysql::protocol::packet_header::PacketHeader;
use bun_sql::mysql::protocol::packet_type::PacketType;
use bun_sql::mysql::protocol::result_set_header::ResultSetHeader;
use bun_sql::mysql::protocol::ssl_request::SSLRequest;
use bun_sql::mysql::protocol::stack_reader::StackReader;
use bun_sql::mysql::protocol::stmt_prepare_ok_packet::StmtPrepareOKPacket;
use bun_sql::mysql::ssl_mode::SSLMode;
use bun_sql::mysql::status_flags::{StatusFlag, StatusFlags};
use bun_sql::mysql::tls_status::TLSStatus;
use bun_sql::postgres::socket_monitor as SocketMonitor;
use bun_sql::shared::connection_flags::ConnectionFlags;
use bun_sql::shared::data::Data;

use crate::mysql::js_mysql_connection::JSMySQLConnection;
use crate::mysql::js_mysql_query::JSMySQLQuery;
use crate::mysql::my_sql_request_queue::MySQLRequestQueue;
use crate::mysql::my_sql_statement::{self as mysql_statement, MySQLStatement, Param};

pub use bun_sql::mysql::protocol::error_packet::ErrorPacket;
// Zig: `pub const Status = ConnectionState;` — re-export so callers can write
// `my_sql_connection::Status::Connected` without naming `bun_sql`.
pub use bun_sql::mysql::connection_state::ConnectionState as Status;

// TODO(port): jsc.API.ServerConfig.SSLConfig — confirm crate path in Phase B
use crate::jsc::api::server_config::SSLConfig;

bun_core::define_scoped_log!(debug, MySQLConnection, visible);

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

    server_version: Vec<u8>,
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
            socket: Socket::SocketTcp(uws::SocketTCP::detached()),
            status: ConnectionState::Disconnected,
            write_buffer: OffsetByteList::default(),
            read_buffer: OffsetByteList::default(),
            last_message_start: 0,
            sequence_id: 0,
            queue: MySQLRequestQueue::init(),
            statements: PreparedStatementsMap::default(),
            server_version: Vec::<u8>::default(),
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

// SAFETY: `MySQLConnection` is the `connection` field embedded inside
// `JSMySQLConnection` (Zig: `@fieldParentPtr("#connection", this)`); never
// constructed standalone.
bun_core::impl_field_parent! { MySQLConnection => JSMySQLConnection.connection; fn js_connection_ref; fn get_js_connection; }

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
            socket: Socket::SocketTcp(uws::SocketTCP::detached()),
            queue: MySQLRequestQueue::init(),
            statements: PreparedStatementsMap::default(),
            tls_config,
            secure,
            ssl_mode,
            tls_status: if ssl_mode != SSLMode::Disable {
                TLSStatus::Pending
            } else {
                TLSStatus::None
            },
            character_set: CharacterSet::default(),
            ..Default::default()
        }
    }

    pub fn can_pipeline(&mut self) -> bool {
        self.queue.can_pipeline(self.js_connection_ref())
    }
    pub fn can_prepare_query(&mut self) -> bool {
        self.queue.can_prepare_query(self.js_connection_ref())
    }
    pub fn can_execute_query(&mut self) -> bool {
        self.queue.can_execute_query(self.js_connection_ref())
    }

    #[inline]
    pub fn is_able_to_write(&self) -> bool {
        self.status == ConnectionState::Connected
            && !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE)
            && (self.write_buffer.len() as usize) < MAX_PIPELINE_SIZE
    }

    #[inline]
    pub fn is_processing_data(&self) -> bool {
        self.flags.contains(ConnectionFlags::IS_PROCESSING_DATA)
    }
    #[inline]
    pub fn has_backpressure(&self) -> bool {
        self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE)
    }
    #[inline]
    pub fn reset_backpressure(&mut self) {
        self.flags.remove(ConnectionFlags::HAS_BACKPRESSURE);
    }

    #[inline]
    pub fn can_flush(&self) -> bool {
        !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) // if has backpressure we need to wait for onWritable event
            && self.status == ConnectionState::Connected // and we need to be connected
            // we need data to send
            && (self.write_buffer.len() > 0
                || self
                    .queue
                    .current_ref()
                    .is_some_and(|r| r.is_pending() && !r.is_being_prepared()))
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
        if !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) {
            if self.tls_status == TLSStatus::MessageSent {
                self.upgrade_to_tls()?;
            } else {
                // no backpressure yet so pipeline more if possible and flush again
                self.advance();
                self.flush_data();
            }
        }
        Ok(())
    }

    /// PORT NOTE: reshaped for borrowck — `self.queue.advance(js_connection)`
    /// would alias `&mut self.queue` with `&mut JSMySQLConnection` (which
    /// embeds `self`). Route through a single raw root:
    /// `MySQLRequestQueue::advance` takes only `*mut JSMySQLConnection` and
    /// reaches the queue via `ParentRef`/`JsCell` shared borrows (all queue
    /// fields are interior-mutable), so no `&mut` to the queue bytes is ever
    /// materialised concurrently with the connection backref.
    fn advance(&mut self) {
        let js_connection = self.get_js_connection();
        // `js_connection` is the `@fieldParentPtr` of `self` — non-null, live,
        // full-allocation provenance. advance() only forms shared borrows of it
        // (queue mutation goes through `Cell`/`JsCell`); the raw pointer is
        // wrapped via the safe `ParentRef::from(NonNull)` inside.
        MySQLRequestQueue::advance(js_connection);
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
            self.write_buffer
                .consume(u32::try_from(wrote_usize).expect("int cast"));
        }
    }

    pub fn close(&mut self) {
        self.socket.close(uws::CloseKind::Normal);
        self.write_buffer = OffsetByteList::default();
    }

    pub fn clean_queue_and_close(&mut self, js_reason: Option<JSValue>, js_queries_array: JSValue) {
        // cleanup requests
        self.queue.clean(
            js_reason,
            if !js_queries_array.is_empty() {
                js_queries_array
            } else {
                JSValue::UNDEFINED
            },
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
            // The map holds an intrusive ref on every cached prepared statement;
            // release it here (mirrors PostgresSQLConnection::deinit). Silently
            // dropping the `*mut` would leak every MySQLStatement.
            // SAFETY: every value inserted into `statements` is a live boxed
            // `MySQLStatement` with the map holding one ref (Zig:
            // `stmt.deref()`).
            unsafe { MySQLStatement::deref(*stmt) };
        }
        drop(statements);

        self.auth_data = Vec::new();
        if let Some(s) = self.secure.take() {
            // SAFETY: FFI — secure is an owned SSL_CTX* freed exactly once here
            unsafe { bun_boringssl_sys::SSL_CTX_free(s) };
        }
        // _options_buf dropped at scope exit (Box<[u8]> frees via Drop)
    }

    pub fn upgrade_to_tls(&mut self) -> Result<(), FlushQueueError> {
        // Only adopt if we're currently a plain TCP socket.
        let Socket::SocketTcp(tcp) = &self.socket else {
            return Ok(());
        };
        let uws::InternalSocket::Connected(raw) = tcp.socket else {
            return Ok(());
        };

        // `as_mut()` is `'static`, so `tls_group` borrows the VM singleton —
        // not `*self` — and stays live across the field reads below.
        let tls_group: &mut bun_uws::SocketGroup = crate::jsc::VirtualMachine::get()
            .as_mut()
            .mysql_socket_group::<true>();

        // SAFETY: `secure` is set to a live `SSL_CTX*` before TLS upgrade is
        // requested (Zig: `this.#secure.?`).
        let ssl_ctx = unsafe {
            &mut *self
                .secure
                .expect("secure SSL_CTX must be set before upgradeToTLS")
        };
        let server_name = self.tls_config.server_name();
        let sni = if server_name.is_null() {
            None
        } else {
            // SAFETY: `server_name` is a NUL-terminated C string owned by
            // `tls_config` for the connection lifetime.
            Some(unsafe { bun_core::ffi::cstr(server_name) })
        };
        // Zig: `@sizeOf(?*JSMySQLConnection)` — `?*T` is an 8-byte null-niche
        // optional. The Rust layout-equivalent is `Option<NonNull<T>>`; using
        // `Option<*mut T>` here would request 16 bytes (separate discriminant)
        // and desync with the trampoline reader (uws_handlers.rs) which reads
        // the slot as `Option<NonNull<_>>`.
        let ext_size = core::mem::size_of::<Option<core::ptr::NonNull<JSMySQLConnection>>>() as i32;

        // SAFETY: `raw` is a live connected `us_socket_t*`; adopt_tls may
        // realloc and return a different ptr.
        let Some(new_socket) = (unsafe { &mut *raw }).adopt_tls(
            tls_group,
            bun_uws::SocketKind::MysqlTls,
            ssl_ctx,
            sni,
            ext_size,
            ext_size,
        ) else {
            return Err(FlushQueueError::AuthenticationFailed);
        };

        let js_connection = self.get_js_connection();
        let new_socket = new_socket.as_ptr();
        // SAFETY: `new_socket` is a live us_socket_t freshly returned by
        // `adopt_tls`; ext storage was sized for
        // `Option<NonNull<JSMySQLConnection>>` above. One `&mut` reborrow
        // drives both safe inherent methods (`ext` / `start_tls_handshake`).
        // Zig: `ext(?*JSMySQLConnection).* = this.getJSConnection()`.
        let sock = unsafe { &mut *new_socket };
        *sock.ext::<Option<core::ptr::NonNull<JSMySQLConnection>>>() =
            core::ptr::NonNull::new(js_connection);
        self.socket = Socket::SocketTls(uws::SocketTLS {
            socket: uws::InternalSocket::Connected(new_socket),
        });
        // ext is now repointed; safe to kick the handshake (any dispatch lands here).
        sock.start_tls_handshake();
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
                            self.tls_status = TLSStatus::SslFailed;
                            return Ok(false);
                        }

                        // VerifyFull additionally requires the certificate identity to
                        // match the intended host. Absence of a configured server name is
                        // not a license to skip the check — fail closed.
                        if self.ssl_mode == SSLMode::VerifyFull {
                            let servername = self.tls_config.server_name();
                            if servername.is_null() {
                                self.tls_status = TLSStatus::SslFailed;
                                return Ok(false);
                            }
                            // SAFETY: native handle of a connected TLS socket is `SSL*`.
                            let ssl_ptr: *mut bun_boringssl_sys::SSL = self
                                .socket
                                .get_native_handle()
                                .map(|h| h.cast())
                                .unwrap_or(core::ptr::null_mut());
                            // SAFETY: `server_name` is a NUL-terminated C string owned by
                            // `tls_config` for the connection lifetime.
                            let hostname = unsafe { bun_core::ffi::cstr(servername) }.to_bytes();
                            if ssl_ptr.is_null()
                                // SAFETY: `ssl_ptr` is non-null and live (handshake just succeeded).
                                || !bun_boringssl::check_server_identity(
                                    unsafe { &mut *ssl_ptr },
                                    hostname,
                                )
                            {
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
        self.flags.insert(ConnectionFlags::IS_PROCESSING_DATA);
        // PORT NOTE: reshaped for borrowck — Zig `defer this.flags.is_processing_data = false`
        // is hand-inlined before every return below (scopeguard would need &mut self.flags).
        // Clear the timeout.
        self.socket.set_timeout(0);

        SocketMonitor::read(data);

        if self.read_buffer.remaining().is_empty() {
            // PORT NOTE: StackReader takes `&Cell<usize>` (interior mutability)
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
                        if cfg!(debug_assertions) {
                            // TODO(port): bun.handleErrorReturnTrace — no Rust equivalent
                        }
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
            // PORT NOTE: reshaped for borrowck — `self.process_packets(self.buffered_reader())`
            // borrows `&mut self` twice. Construct the reader first; it holds a
            // `*mut Self` so the second borrow doesn't conflict.
            let reader = self.buffered_reader();
            match self.process_packets(reader) {
                Ok(()) => {}
                Err(err) => {
                    debug!("processPackets with buffer: {}", <&'static str>::from(err));
                    if err != any_mysql_error::Error::ShortRead {
                        if cfg!(debug_assertions) {
                            // TODO(port): @errorReturnTrace — no Rust equivalent
                        }
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

    pub fn process_packets<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
    ) -> Result<(), AnyMySQLError> {
        loop {
            reader.mark_message_start();

            // Read packet header
            let header = PacketHeader::decode(reader.peek()).ok_or(AnyMySQLError::ShortRead)?;
            let header_length = header.length;
            let packet_length: usize = header_length as usize + PacketHeader::SIZE;
            debug!(
                "sequence_id: {} header: {}",
                self.sequence_id, header_length
            );
            // Ensure we have the full packet
            reader
                .ensure_capacity(packet_length)
                .map_err(|_| AnyMySQLError::ShortRead)?;
            // PORT NOTE: Zig `defer reader.setOffsetFromStart(packet_length)` —
            // `NewReader<C>: Copy` so the scopeguard captures by copy; the inner
            // `C` writes through a raw pointer so the offset update still lands.
            // Always skip the full packet, we dont care about padding or unread bytes.
            let _skip_guard = scopeguard::guard(reader, move |r| {
                r.set_offset_from_start(packet_length);
            });
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
                    debug!("Unexpected packet in state {}", self.status as u8);
                    return Err(AnyMySQLError::UnexpectedPacket);
                }
            }
        }
    }

    pub fn handle_handshake<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
    ) -> Result<(), AnyMySQLError> {
        let mut handshake = HandshakeV10::default();
        handshake.decode_internal(reader)?;
        // handshake dropped at scope exit

        // Store server info
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
        self.capabilities = Capabilities::get_default_capabilities(
            self.ssl_mode != SSLMode::Disable,
            !self.database.is_empty(),
        )
        .intersect(handshake.capability_flags);

        // Override with utf8mb4 instead of using server's default
        self.character_set = CharacterSet::default();
        self.status_flags = handshake.status_flags;

        bun_core::scoped_log!(
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
        self.auth_data.reserve(
            handshake.auth_plugin_data_part_1.len() + handshake.auth_plugin_data_part_2.len(),
        );
        self.auth_data
            .extend_from_slice(&handshake.auth_plugin_data_part_1[..]);
        self.auth_data
            .extend_from_slice(&handshake.auth_plugin_data_part_2[..]);

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
        if self.capabilities.CLIENT_SSL {
            let mut response = SSLRequest {
                capability_flags: self.capabilities,
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

    fn handle_handshake_decode_public_key<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
    ) -> Result<(), AnyMySQLError> {
        let mut response = Auth::caching_sha2_password::PublicKeyResponse::default();
        response.decode(reader)?;
        // revert back to authenticating since we received the public key
        self.set_status(ConnectionState::Authenticating);

        let mut encrypted_password = Auth::caching_sha2_password::EncryptedPassword {
            password: bun_ptr::RawSlice::new(&self.password),
            public_key: bun_ptr::RawSlice::new(response.data.slice()),
            nonce: bun_ptr::RawSlice::new(&self.auth_data),
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
                // PORT NOTE: spec spelling — Zig defines `onConnectionEstabilished`
                // (sic, JSMySQLConnection.zig:654 / MySQLConnection.zig:491).
                self.js_connection_ref().on_connection_estabilished();
            }
            _ => {}
        }
    }

    pub fn handle_auth<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
        header_length: u32, // u24 in Zig
    ) -> Result<(), AnyMySQLError> {
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1isize);

        bun_core::scoped_log!(MySQLConnection, "Auth packet: 0x{:02x}", first_byte);

        match first_byte {
            x if x == PacketType::OK.0 => {
                let mut ok = OKPacket {
                    header: 0,
                    affected_rows: 0,
                    last_insert_id: 0,
                    status_flags: StatusFlags::default(),
                    warnings: 0,
                    info: Data::Empty,
                    session_state_changes: Data::Empty,
                    packet_size: header_length,
                };
                ok.decode_internal(reader)?;

                self.set_status(ConnectionState::Connected);

                self.status_flags = ok.status_flags;
                self.flags.insert(ConnectionFlags::IS_READY_FOR_QUERY);
                self.queue.mark_as_ready_for_query();
                self.advance();
            }

            x if x == PacketType::ERROR.0 => {
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;

                self.js_connection_ref().on_error_packet(None, err);
                return Err(AnyMySQLError::AuthenticationFailed);
            }

            x if x == PacketType::MORE_DATA.0 => {
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
                                Auth::caching_sha2_password::FastAuthStatus::SUCCESS => {
                                    debug!("success auth");
                                    self.set_status(ConnectionState::Connected);

                                    self.flags.insert(ConnectionFlags::IS_READY_FOR_QUERY);
                                    self.queue.mark_as_ready_for_query();
                                    self.advance();
                                }
                                Auth::caching_sha2_password::FastAuthStatus::CONTINUE_AUTH => {
                                    bun_core::scoped_log!(MySQLConnection, "continue auth");

                                    if self.ssl_mode == SSLMode::Disable {
                                        // we are in plain TCP so we need to request the public key
                                        self.set_status(ConnectionState::AuthenticationAwaitingPk);
                                        bun_core::scoped_log!(
                                            MySQLConnection,
                                            "awaiting public key"
                                        );
                                        let mut packet = self.writer().start(self.sequence_id)?;

                                        let request = Auth::caching_sha2_password::PublicKeyRequest;
                                        request.write(self.writer())?;
                                        packet.end()?;
                                        self.flush_data();
                                    } else {
                                        bun_core::scoped_log!(
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
                            bun_core::scoped_log!(
                                MySQLConnection,
                                "Unexpected auth continuation for plugin: {:?}",
                                plugin
                            );
                            return Err(AnyMySQLError::UnexpectedPacket);
                        }
                    }
                } else if first_byte == PacketType::LOCAL_INFILE.0 {
                    // Handle LOCAL INFILE request
                    let mut infile = LocalInfileRequest {
                        packet_size: header_length,
                        ..Default::default()
                    };
                    infile.decode_internal(reader)?;

                    // We don't support LOCAL INFILE for security reasons
                    return Err(AnyMySQLError::LocalInfileNotSupported);
                } else {
                    bun_core::scoped_log!(
                        MySQLConnection,
                        "Received auth continuation without plugin"
                    );
                    return Err(AnyMySQLError::UnexpectedPacket);
                }
            }

            PacketType::AUTH_SWITCH => {
                let mut auth_switch = AuthSwitchRequest {
                    packet_size: header_length,
                    ..Default::default()
                };
                auth_switch.decode_internal(reader)?;

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

    pub fn handle_command<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
        header_length: u32, // u24 in Zig
    ) -> Result<(), AnyMySQLError> {
        // Get the current request if any
        let Some(request) = self.queue.current_ref() else {
            debug!("Received unexpected command response");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        // Queue holds a ref on every request; bump it for the body's duration so
        // re-entrant `deref()` cannot free it (Zig: `defer request.deref()`).
        let _request_guard = request.ref_guard();
        // `ThisPtr::get` borrows the local `request` (Copy), not `*self`, so the
        // shared `&JSMySQLQuery` is sound across the `&mut self` calls below.
        let request: &JSMySQLQuery = request.get();

        debug!("handleCommand");
        if request.is_simple() {
            // Regular query response
            return self.handle_result_set(reader, header_length);
        }

        // Handle based on request type
        if let Some(statement) = request.get_statement() {
            // Only the `status` discriminant is needed below; read it and drop
            // the `&mut MySQLStatement` borrow immediately so `request` /
            // `&mut self` are unconstrained inside the match arms (no raw-ptr
            // downgrade needed for a single Copy field read).
            // TODO(b2-blocked): MySQLStatement intrusive ref_/deref_ (bun_ptr).
            // Skipped here; the queue's ref on `request` keeps the statement
            // alive for the duration of this call.
            match statement.status {
                mysql_statement::Status::Pending => {
                    return Err(AnyMySQLError::UnexpectedPacket);
                }
                mysql_statement::Status::Parsing => {
                    // We're waiting for prepare response
                    self.handle_prepared_statement(reader, header_length)?;
                }
                mysql_statement::Status::Prepared => {
                    // We're waiting for execute response
                    self.handle_result_set(reader, header_length)?;
                }
                mysql_statement::Status::Failed => {
                    // PORT NOTE: reshaped for borrowck — Zig `defer this.flushQueue()`
                    // moved to explicit call after `on_error_packet` below.
                    self.flags.insert(ConnectionFlags::IS_READY_FOR_QUERY);
                    self.queue.mark_as_ready_for_query();
                    self.queue.mark_current_request_as_finished(request);
                    // TODO(b2-blocked): ErrorPacket is not Clone in bun_sql; the
                    // Zig passes statement.error_response by value (struct copy).
                    // Send a default packet as a placeholder until ErrorPacket
                    // grows Clone or a borrowed-variant overload lands.
                    //
                    // R-2: `on_error_packet` is `&self`; route through the
                    // audited `js_connection_ref()` container_of accessor (one
                    // centralised unsafe). `*self` sits inside the parent's
                    // `JsCell`, so re-entrant `connection_mut()` does not alias
                    // this outer shared borrow.
                    self.js_connection_ref()
                        .on_error_packet(Some(request), ErrorPacket::default());
                    let _ = self.flush_queue();
                }
            }
        }
        Ok(())
    }

    pub fn send_handshake_response(&mut self) -> Result<(), AnyMySQLError> {
        debug!("sendHandshakeResponse");
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
            username: Data::Temporary(bun_ptr::RawSlice::new(&self.user)),
            database: Data::Temporary(bun_ptr::RawSlice::new(&self.database)),
            auth_plugin_name: Data::Temporary(bun_ptr::RawSlice::new(
                if let Some(plugin) = self.auth_plugin {
                    match plugin {
                        AuthMethod::MysqlNativePassword => &b"mysql_native_password"[..],
                        AuthMethod::CachingSha2Password => &b"caching_sha2_password"[..],
                        AuthMethod::Sha256Password => &b"sha256_password"[..],
                    }
                } else {
                    &b""[..]
                },
            )),
            auth_response: Data::Empty,
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

        // Generate auth response based on plugin
        let mut scrambled_buf = [0u8; 32];
        if let Some(plugin) = self.auth_plugin {
            if self.auth_data.is_empty() {
                return Err(AnyMySQLError::MissingAuthData);
            }

            response.auth_response = Data::Temporary(bun_ptr::RawSlice::new(plugin.scramble(
                &self.password,
                &self.auth_data,
                &mut scrambled_buf,
            )?));
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

        response.auth_response = Data::Temporary(bun_ptr::RawSlice::new(auth_method.scramble(
            &self.password,
            plugin_data,
            &mut scrambled_buf,
        )?));

        let response_writer = self.writer();
        let mut packet = response_writer.start(self.sequence_id)?;
        response.write_internal(response_writer)?;
        packet.end()?;
        self.flush_data();
        Ok(())
    }

    pub fn writer(&mut self) -> NewWriter<Writer> {
        NewWriter {
            wrapped: Writer {
                connection: std::ptr::from_mut::<Self>(self),
            },
        }
    }

    pub fn buffered_reader(&mut self) -> NewReader<Reader> {
        NewReader {
            wrapped: Reader {
                connection: std::ptr::from_mut::<Self>(self),
            },
        }
    }

    fn check_if_prepared_statement_is_done(&mut self, statement: &mut MySQLStatement) {
        bun_core::scoped_log!(
            MySQLConnection,
            "checkIfPreparedStatementIsDone: {} {} {} {}",
            statement.columns_received,
            statement.params_received,
            statement.columns.len(),
            statement.params.len()
        );
        if statement.columns_received as usize == statement.columns.len()
            && statement.params_received as usize == statement.params.len()
        {
            statement.status = mysql_statement::Status::Prepared;
            self.flags.remove(ConnectionFlags::WAITING_TO_PREPARE);
            self.flags.insert(ConnectionFlags::IS_READY_FOR_QUERY);
            self.queue.mark_as_ready_for_query();
            self.queue.mark_as_prepared();
            statement.reset();
            self.advance();
        }
    }

    pub fn handle_prepared_statement<C: ReaderContext>(
        &mut self,
        mut reader: NewReader<C>,
        header_length: u32, // u24 in Zig
    ) -> Result<(), AnyMySQLError> {
        debug!("handlePreparedStatement");
        let first_byte = reader.int::<u8>()?;
        reader.skip(-1isize);

        let Some(request) = self.queue.current_ref() else {
            debug!("Unexpected prepared statement packet missing request");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        // Queue holds a ref on every request; bump it for the body's duration so
        // re-entrant `deref()` cannot free it (Zig: `defer request.deref()`).
        let _request_guard = request.ref_guard();
        // `ThisPtr::get` borrows the local `request` (Copy), not `*self`.
        let request: &JSMySQLQuery = request.get();
        // `get_statement()` derefs the intrusive `*mut MySQLStatement` held by
        // the request (separate heap allocation, never aliases `*self`); the
        // returned `&mut` is rooted in the local `ThisPtr`, not `self.queue`,
        // so `&mut self` calls below do not conflict.
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
                && header_length < 0xFFFFFF
                && PacketType(first_byte) == PacketType::EOF
            {
                let mut eof = EOFPacket::default();
                eof.decode_internal(reader)?;
                self.check_if_prepared_statement_is_done(statement);
                return Ok(());
            }
            if (statement.params_received as usize) < statement.params.len() {
                let mut column = ColumnDefinition41::default();
                column.decode(&mut reader)?;
                statement.params[statement.params_received as usize] = Param {
                    r#type: column.column_type,
                    flags: column.flags,
                };
                statement.params_received += 1;
            } else if (statement.columns_received as usize) < statement.columns.len() {
                statement.columns[statement.columns_received as usize].decode(&mut reader)?;
                statement.columns_received += 1;
            }
            // In CLIENT_DEPRECATE_EOF mode, there are no trailing EOF packets, so
            // we check completion after each column/param definition. In legacy mode,
            // completion is deferred to the EOF handler above to avoid marking the
            // statement as prepared before the trailing EOF is consumed.
            if self.capabilities.CLIENT_DEPRECATE_EOF {
                self.check_if_prepared_statement_is_done(statement);
            }
            return Ok(());
        }

        match PacketType(first_byte) {
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
                    // Zig: bun.default_allocator.alloc(Param, n) — slots are
                    // overwritten as param-definition packets arrive, so the
                    // initial value is a placeholder.
                    statement.params = (0..ok.num_params as usize)
                        .map(|_| Param {
                            r#type: FieldType::MYSQL_TYPE_NULL,
                            flags: ColumnFlags::default(),
                        })
                        .collect();
                    statement.params_received = 0;
                }

                // Read column definitions if any
                if ok.num_columns > 0 {
                    statement.columns = (0..ok.num_columns as usize)
                        .map(|_| ColumnDefinition41::default())
                        .collect();
                    statement.columns_received = 0;
                }

                self.check_if_prepared_statement_is_done(statement);
            }

            PacketType::ERROR => {
                debug!("handlePreparedStatement ERROR");
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;
                // PORT NOTE: reshaped for borrowck — Zig `defer this.queue.advance(connection)`
                // moved to explicit call after `on_error_packet` below.
                self.flags.insert(ConnectionFlags::IS_READY_FOR_QUERY);
                statement.status = mysql_statement::Status::Failed;
                // err.error_message is a Data{ .temporary = ... } slice into the socket read
                // buffer which will be overwritten by the next packet. The statement is cached
                // in this.statements and its error_response may be read later via
                // stmt.error_response.toJS(), so we must own a copy of the message bytes.
                // Zig: `statement.error_response = err;` (struct copy) then overwrite
                // `error_message` with an owned dupe. ErrorPacket lacks Clone in bun_sql
                // (Data is not Clone), so reconstruct field-by-field — the scalar fields
                // (header / error_code / sql_state) are all Copy.
                statement.error_response = ErrorPacket {
                    header: err.header,
                    error_code: err.error_code,
                    sql_state_marker: err.sql_state_marker,
                    sql_state: err.sql_state,
                    error_message: Data::create(err.error_message.slice())
                        .map_err(|_| AnyMySQLError::OutOfMemory)?,
                };
                self.queue.mark_as_ready_for_query();
                self.queue.mark_current_request_as_finished(request);

                // R-2: `on_error_packet` is `&self`; `js_connection_ref()` is
                // the audited container_of accessor (one centralised unsafe).
                // The `&JSMySQLConnection` it yields lives only for this call —
                // identical footprint to the prior `(*ptr).on_error_packet()`
                // temporary — and `*self` sits inside the parent's `JsCell`, so
                // re-entrant `connection_mut()` does not alias the outer
                // shared borrow.
                self.js_connection_ref().on_error_packet(Some(request), err);
                self.advance();
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

    // PORT NOTE: reshaped for borrowck — `request` comes from `self.queue` so
    // passing `&mut self` alongside `&mut JSMySQLQuery` would alias. `request`
    // is `&JSMySQLQuery` (R-2: fully interior-mutable, so a shared borrow is
    // sound across the re-entrant `on_query_result` callback). The statement is
    // re-fetched via the single-unsafe `request.get_statement()` accessor at
    // each touch point so no `&mut MySQLStatement` spans the re-entrant
    // `on_query_result` call (which may itself call `get_statement()`).
    fn handle_result_set_ok(
        &mut self,
        request: &JSMySQLQuery,
        status_flags: StatusFlags,
        last_insert_id: u64,
        affected_rows: u64,
    ) {
        self.status_flags = status_flags;
        let is_last_result = !status_flags.has(StatusFlag::SERVER_MORE_RESULTS_EXISTS);
        debug!(
            "handleResultSetOK: {} {}",
            status_flags.to_int(),
            is_last_result
        );
        // PORT NOTE: Zig `defer this.flushQueue()` moved to explicit tail call.
        self.flags
            .set(ConnectionFlags::IS_READY_FOR_QUERY, is_last_result);
        if is_last_result {
            self.queue.mark_as_ready_for_query();
            self.queue.mark_current_request_as_finished(request);
        }

        // Short-lived borrow via the audited accessor; dropped before the
        // re-entrant `on_query_result` call below.
        let result_count = request.get_statement().map_or(0, |s| s.result_count);
        // R-2: `on_query_result` is `&self`; `js_connection_ref()` is the
        // audited container_of accessor. The `&JSMySQLConnection` lives only for
        // this call (same footprint as the prior `(*ptr).on_query_result()`
        // temporary). `*self` sits inside the parent's `JsCell` (`UnsafeCell`),
        // so re-entrant `connection_mut()` writes through SharedRW provenance
        // independent of this outer shared borrow.
        self.js_connection_ref().on_query_result(
            request,
            MySQLQueryResult {
                result_count,
                last_insert_id,
                affected_rows,
                is_last_result,
            },
        );

        // Re-fetch (fresh `&mut`) so no borrow spanned the JS callback above.
        if let Some(s) = request.get_statement() {
            s.reset();
        }

        // Use flushQueue instead of just advance to ensure any data written
        // by queries added during onQueryResult is actually sent.
        // This fixes a race condition where the auto flusher may not be
        // registered if the queue's current item is completed (not pending).
        let _ = self.flush_queue();
    }

    fn handle_result_set<C: ReaderContext>(
        &mut self,
        mut reader: NewReader<C>,
        header_length: u32, // u24 in Zig
    ) -> Result<(), AnyMySQLError> {
        let first_byte = reader.int::<u8>()?;
        debug!("handleResultSet: {:02x}", first_byte);

        reader.skip(-1isize);

        let Some(request) = self.queue.current_ref() else {
            debug!("Unexpected result set packet");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        // Queue holds a ref on every request; bump it for the body's duration so
        // re-entrant `deref()` cannot free it (Zig: `defer request.deref()`).
        let _request_guard = request.ref_guard();
        // `ThisPtr::get` borrows the local `request` (Copy), not `*self`.
        let request: &JSMySQLQuery = request.get();
        let mut ok = OKPacket {
            header: 0,
            affected_rows: 0,
            last_insert_id: 0,
            status_flags: StatusFlags::default(),
            warnings: 0,
            info: Data::Empty,
            session_state_changes: Data::Empty,
            packet_size: header_length,
        };
        match PacketType(first_byte) {
            PacketType::ERROR => {
                let mut err = ErrorPacket::default();
                err.decode_internal(reader)?;
                // PORT NOTE: reshaped for borrowck — Zig `defer this.flushQueue()`
                // moved to explicit tail call.
                if let Some(statement) = request.get_statement() {
                    statement.reset();
                }

                self.flags.insert(ConnectionFlags::IS_READY_FOR_QUERY);
                self.queue.mark_as_ready_for_query();
                self.queue.mark_current_request_as_finished(request);

                // R-2: `on_error_packet` is `&self`; route through the audited
                // `js_connection_ref()` container_of accessor. `*self` lives
                // inside the parent's `JsCell`, so re-entrant `connection_mut()`
                // does not alias this outer shared borrow.
                self.js_connection_ref().on_error_packet(Some(request), err);
                let _ = self.flush_queue();
            }

            packet_type => {
                // `get_statement()` derefs the intrusive `*mut MySQLStatement`
                // held by the request (separate heap allocation); the `&mut` is
                // rooted in the local `ThisPtr`, not `self`, so `&mut self`
                // calls below do not conflict. `handle_result_set_ok` re-fetches
                // via the same accessor; `on_result_row` reborrows `&mut`.
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
                        // NLL: caller's `statement` borrow ends here;
                        // `handle_result_set_ok` re-fetches via the accessor.
                        self.handle_result_set_ok(
                            request,
                            ok.status_flags,
                            ok.last_insert_id,
                            ok.affected_rows,
                        );
                        return Ok(());
                    }

                    let mut header = ResultSetHeader::default();
                    header.decode_internal(reader)?;
                    if header.field_count == 0 {
                        // Can't be 0
                        return Err(AnyMySQLError::UnexpectedPacket);
                    }
                    if statement.columns.len() as u64 != header.field_count {
                        bun_core::scoped_log!(
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
                            statement.columns = Vec::new();
                        }
                        // Zig: `try bun.default_allocator.alloc(ColumnDefinition41, header.field_count)`
                        // — fallible. field_count is server-controlled (lenenc int up to 2^64-1),
                        // so a panicking `collect()` would let a malicious/buggy server crash us.
                        let field_count = usize::try_from(header.field_count)
                            .map_err(|_| AnyMySQLError::OutOfMemory)?;
                        let mut columns = Vec::new();
                        columns
                            .try_reserve_exact(field_count)
                            .map_err(|_| AnyMySQLError::OutOfMemory)?;
                        columns.resize_with(field_count, ColumnDefinition41::default);
                        statement.columns = columns;
                        statement.columns_received = 0;
                    }
                    statement
                        .execution_flags
                        .insert(mysql_statement::ExecutionFlags::NEEDS_DUPLICATE_CHECK);
                    statement
                        .execution_flags
                        .insert(mysql_statement::ExecutionFlags::HEADER_RECEIVED);
                    return Ok(());
                } else if (statement.columns_received as usize) < statement.columns.len() {
                    statement.columns[statement.columns_received as usize].decode(&mut reader)?;
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

                    // R-2: `on_result_row` is `&self`; route through the audited
                    // `js_connection_ref()` container_of accessor. The
                    // `&JSMySQLConnection` is held only for this call (identical
                    // footprint to the prior `(*ptr).on_result_row()` temporary);
                    // `*self` sits inside the parent's `JsCell`, so re-entrant
                    // `connection_mut()` does not alias this shared borrow.
                    self.js_connection_ref()
                        .on_result_row(request, statement, reader)?;
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

#[derive(strum::IntoStaticStr, Debug)]
pub enum FlushQueueError {
    AuthenticationFailed,
}
impl From<FlushQueueError> for bun_core::Error {
    fn from(_: FlushQueueError) -> Self {
        bun_core::err!("AuthenticationFailed")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Writer / Reader — protocol-layer adapters wrapping the connection's
// OffsetByteList buffers. Hold `*mut MySQLConnection` (Copy) so they satisfy
// `bun_sql::mysql::protocol::new_{reader,writer}::{Reader,Writer}Context: Copy`.
// This matches the Zig semantics where both wrap `*MySQLConnection`.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct Writer {
    pub connection: *mut MySQLConnection,
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
        // caller's own `&mut self` (see the PORT NOTE on `Reader` below).
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
        let byte_list = &mut self.write_buffer().byte_list;
        byte_list.slice_mut()[index..][..data.len()].copy_from_slice(data);
        Ok(())
    }

    fn offset(self) -> usize {
        self.write_buffer().len() as usize
    }
}

#[derive(Clone, Copy)]
pub struct Reader {
    pub connection: *mut MySQLConnection,
}

// PORT NOTE (aliasing): `Reader` is constructed from `&mut MySQLConnection`
// and then threaded through `process_packets(&mut self, reader)` — i.e. the
// raw `*mut` and a live `&mut self` coexist. Materializing a whole-struct
// `&mut MySQLConnection` here would alias that `&mut self` (Stacked Borrows
// UB). Instead the accessors below project only the specific field(s) the
// reader touches via `addr_of_mut!`, matching `Writer` above and Zig's
// freely-aliasing `*MySQLConnection` semantics.
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
    fn last_message_start(&self) -> &mut u32 {
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
        self.read_buffer().head = *self.last_message_start() + (offset as u32);
    }

    fn peek(&self) -> &[u8] {
        self.read_buffer().remaining()
    }

    fn skip(self, count: isize) {
        let rb = self.read_buffer();
        if count < 0 {
            let abs_count = count.unsigned_abs();
            if abs_count > rb.head as usize {
                rb.head = 0;
                return;
            }
            rb.head -= u32::try_from(abs_count).expect("int cast");
            return;
        }

        let ucount: usize = usize::try_from(count).expect("int cast");
        if rb.head as usize + ucount > rb.byte_list.len() as usize {
            rb.head = rb.byte_list.len() as u32;
            return;
        }

        rb.head += u32::try_from(ucount).expect("int cast");
    }

    fn ensure_capacity(self, count: usize) -> bool {
        self.read_buffer().remaining().len() >= count
    }

    fn read(self, count: usize) -> Result<Data, AnyMySQLError> {
        let remaining = self.read_buffer().remaining();
        if remaining.len() < count {
            return Err(AnyMySQLError::ShortRead);
        }

        // PORT NOTE: reshaped for borrowck — capture detached slice before skip().
        let slice = bun_ptr::RawSlice::new(&remaining[0..count]);
        self.skip(isize::try_from(count).expect("int cast"));
        Ok(Data::Temporary(slice))
    }

    fn read_z(self) -> Result<Data, AnyMySQLError> {
        let remaining = self.read_buffer().remaining();
        if let Some(zero) = bun_core::strings::index_of_char(remaining, 0) {
            let slice = bun_ptr::RawSlice::new(&remaining[0..zero as usize]);
            self.skip(isize::try_from(zero + 1).expect("int cast"));
            return Ok(Data::Temporary(slice));
        }

        Err(AnyMySQLError::ShortRead)
    }
}

// Canonical type lives in `bun_sql::mysql`; re-export so this module's
// struct-literal call sites (`QueryResult { .. }`) flow into
// `JSMySQLConnection::on_query_result(MySQLQueryResult)` without conversion.
pub use bun_sql::mysql::MySQLQueryResult as QueryResult;

// TODO(port): IdentityContext(u64) hasher — bun_collections::HashMap should support identity hash for u64 keys
pub type PreparedStatementsMap = HashMap<u64, *mut MySQLStatement>;
/// Result of `PreparedStatementsMap::get_or_put` — surfaced for
/// `JSMySQLConnection::get_statement_from_signature_hash`.
pub type PreparedStatementsMapGetOrPutResult<'a> =
    bun_collections::hash_map::GetOrPutResult<'a, *mut MySQLStatement>;

const MAX_PIPELINE_SIZE: usize = u16::MAX as usize; // about 64KB per connection

// ported from: src/sql_jsc/mysql/MySQLConnection.zig
