use core::mem::offset_of;

use bun_collections::{BabyList, HashMap, OffsetByteList};
type ByteList = BabyList<u8>;
use crate::jsc::JSValue;
use bun_uws::{self as uws, AnySocket as Socket, SslCtx};

use bun_sql::mysql::protocol::any_mysql_error::{self as any_mysql_error, Error as AnyMySQLError};
use bun_sql::mysql::protocol::auth as Auth;
use bun_sql::mysql::protocol::auth_switch_request::AuthSwitchRequest;
use bun_sql::mysql::protocol::auth_switch_response::AuthSwitchResponse;
use bun_sql::mysql::protocol::character_set::CharacterSet;
use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
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
use bun_sql::mysql::auth_method::AuthMethod;
use bun_sql::mysql::connection_state::ConnectionState;
use bun_sql::mysql::mysql_types::FieldType;
use bun_sql::mysql::protocol::column_definition41::ColumnFlags;
use bun_sql::mysql::ssl_mode::SSLMode;
use bun_sql::mysql::status_flags::{StatusFlag, StatusFlags};
use bun_sql::mysql::tls_status::TLSStatus;
use bun_sql::mysql::Capabilities;
use bun_sql::mysql::MySQLQueryResult;
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

bun_core::declare_scope!(MySQLConnection, visible);
macro_rules! debug {
    ($($arg:tt)*) => { bun_core::scoped_log!(MySQLConnection, $($arg)*) };
}

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
            socket: Socket::SocketTcp(uws::SocketTCP::detached()),
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
            socket: Socket::SocketTcp(uws::SocketTCP::detached()),
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
        let conn = self.get_js_connection();
        // SAFETY: get_js_connection returns the parent struct embedding self.
        self.queue.can_pipeline(unsafe { &*conn })
    }
    pub fn can_prepare_query(&mut self) -> bool {
        let conn = self.get_js_connection();
        // SAFETY: see can_pipeline.
        self.queue.can_prepare_query(unsafe { &*conn })
    }
    pub fn can_execute_query(&mut self) -> bool {
        let conn = self.get_js_connection();
        // SAFETY: see can_pipeline.
        self.queue.can_execute_query(unsafe { &*conn })
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
                || if let Some(request) = self.queue.current() {
                    // SAFETY: queue holds a ref on every request; pointer is live.
                    let request = unsafe { &*request };
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
    /// projects the queue internally via `addr_of_mut!`, so every queue access
    /// and every `&mut *connection` reborrow share one SharedRW provenance
    /// tag. Deriving a separate `&mut self.queue as *mut _` here would pop
    /// `js_connection`'s tag on the queue bytes (Stacked Borrows UB).
    fn advance(&mut self) {
        let js_connection = self.get_js_connection();
        // SAFETY: `js_connection` is the `@fieldParentPtr` of `self`; advance()
        // derives the queue pointer from it and never holds two overlapping
        // `&mut` borrows.
        unsafe { MySQLRequestQueue::advance(js_connection) };
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

        let wrote = any_socket_write(&self.socket, chunk);
        self.flags.set(
            ConnectionFlags::HAS_BACKPRESSURE,
            usize::try_from(wrote).unwrap_or(0) < chunk.len(),
        );
        debug!("flushData: wrote {}/{} bytes", wrote, chunk.len());
        if wrote > 0 {
            let wrote_usize = usize::try_from(wrote).unwrap();
            SocketMonitor::write(&chunk[0..wrote_usize]);
            self.write_buffer.consume(u32::try_from(wrote_usize).unwrap());
        }
    }

    pub fn close(&mut self) {
        any_socket_close(&self.socket);
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
        let Socket::SocketTcp(tcp) = &self.socket else { return Ok(()) };
        let uws::InternalSocket::Connected(raw) = tcp.socket else { return Ok(()) };

        // PORT NOTE: reshaped for borrowck — `rare_data()` borrows `vm` mutably
        // while `mysql_group` also wants `&VirtualMachine`; route through a raw
        // pointer (Zig passed the same `vm` twice with no aliasing rules).
        let vm_ptr: *mut crate::jsc::VirtualMachine = crate::jsc::VirtualMachine::get();
        // SAFETY: `vm_ptr` is the live VM singleton; the two derefs do not
        // produce overlapping `&mut` (rare_data accesses a disjoint field).
        let tls_group = unsafe { (*vm_ptr).rare_data().mysql_group(&*vm_ptr, true) };

        // SAFETY: `secure` is set to a live `SSL_CTX*` before TLS upgrade is
        // requested (Zig: `this.#secure.?`).
        let ssl_ctx = unsafe { &mut *self.secure.expect("secure SSL_CTX must be set before upgradeToTLS") };
        let sni = if self.tls_config.server_name.is_null() {
            None
        } else {
            // SAFETY: `server_name` is a NUL-terminated C string owned by
            // `tls_config` for the connection lifetime.
            Some(unsafe { core::ffi::CStr::from_ptr(self.tls_config.server_name) })
        };
        let ext_size = core::mem::size_of::<Option<*mut JSMySQLConnection>>() as i32;

        // SAFETY: `raw` is a live connected `us_socket_t*`; `tls_group` is a
        // live SocketGroup; adopt_tls may realloc and return a different ptr.
        // PORT NOTE: `bun_uws::SocketGroup` and `bun_uws_sys::SocketGroup` are
        // layout-identical `#[repr(C)]` mirrors during the port; cast through
        // raw pointer so `adopt_tls` (defined on the `_sys` flavor) accepts it.
        let Some(new_socket) = (unsafe { &mut *raw }).adopt_tls(
            // SAFETY: `tls_group` is non-null (lazy-init in `mysql_group`).
            unsafe { &mut *(tls_group as *mut bun_uws_sys::SocketGroup) },
            bun_uws_sys::SocketKind::MysqlTls,
            ssl_ctx,
            sni,
            ext_size,
            ext_size,
        ) else {
            return Err(FlushQueueError::AuthenticationFailed);
        };

        let js_connection = self.get_js_connection();
        let new_socket = new_socket.as_ptr();
        // SAFETY: ext storage was sized for `Option<*mut JSMySQLConnection>` above
        // and `new_socket` is a live us_socket_t.
        unsafe { *(*new_socket).ext::<Option<*mut JSMySQLConnection>>() = Some(js_connection) };
        self.socket = Socket::SocketTls(uws::SocketTLS {
            socket: uws::InternalSocket::Connected(new_socket),
        });
        // ext is now repointed; safe to kick the handshake (any dispatch lands here).
        // SAFETY: `new_socket` is a live us_socket_t with an attached SSL*.
        unsafe { (*new_socket).start_tls_handshake() };
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

                        // SAFETY: native handle of a connected TLS socket is `SSL*`.
                        let ssl_ptr: *mut bun_boringssl_sys::SSL = self
                            .socket
                            .get_native_handle()
                            .map(|h| h.cast())
                            .unwrap_or(core::ptr::null_mut());
                        // SAFETY: `ssl_ptr` is a live SSL* (handshake just succeeded).
                        let servername = unsafe { bun_boringssl_sys::SSL_get_servername(ssl_ptr, 0) };
                        if !servername.is_null() {
                            // SAFETY: SSL_get_servername returns a NUL-terminated C string
                            // borrowed for the SSL session lifetime.
                            let hostname = unsafe { core::ffi::CStr::from_ptr(servername) }.to_bytes();
                            // SAFETY: `ssl_ptr` is non-null and live (see above).
                            if !bun_boringssl::check_server_identity(unsafe { &mut *ssl_ptr }, hostname) {
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
        any_socket_set_timeout(&self.socket, 0);

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
                    debug!("processPackets without buffer: {}", <&'static str>::from(err));
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
                        self.read_buffer.byte_list.len = 0;
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
                            self.read_buffer.byte_list.len
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
            debug!("sequence_id: {} header: {}", self.sequence_id, header_length);
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
        self.capabilities =
            Capabilities::get_default_capabilities(self.ssl_mode != SSLMode::Disable, !self.database.is_empty())
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
        if self.capabilities.CLIENT_SSL {
            let mut response = SSLRequest {
                capability_flags: self.capabilities,
                max_packet_size: 0, // 16777216,
                character_set: CharacterSet::default(),
                // bun always send connection attributes
                has_connection_attributes: true,
            };
            response.write_internal(self.writer())?;
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
            password: &*self.password as *const [u8],
            public_key: response.data.slice() as *const [u8],
            nonce: &*self.auth_data as *const [u8],
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
                // SAFETY: get_js_connection returns the parent struct embedding self.
                // PORT NOTE: spec spelling — Zig defines `onConnectionEstabilished`
                // (sic, JSMySQLConnection.zig:654 / MySQLConnection.zig:491).
                unsafe { (*self.get_js_connection()).on_connection_estabilished() };
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

                // SAFETY: get_js_connection returns the parent struct embedding self.
                unsafe { (*self.get_js_connection()).on_error_packet(None, err) };
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
                                        bun_core::scoped_log!(MySQLConnection, "awaiting public key");
                                        let mut packet = self.writer().start(self.sequence_id)?;

                                        let request =
                                            Auth::caching_sha2_password::PublicKeyRequest;
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
                    bun_core::scoped_log!(MySQLConnection, "Received auth continuation without plugin");
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
                bun_core::scoped_log!(MySQLConnection, "Unexpected auth packet: 0x{:02x}", first_byte);
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
        let Some(request) = self.queue.current() else {
            debug!("Received unexpected command response");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        // SAFETY: queue holds a ref on every request; pointer is live.
        unsafe { (*request).ref_() };
        // Zig: `defer request.deref()` — scopeguard captures the raw pointer by
        // copy; deref runs on every exit path.
        let _request_guard = scopeguard::guard(request, |r| unsafe { (*r).deref_() });

        debug!("handleCommand");
        // SAFETY: see above.
        if unsafe { (*request).is_simple() } {
            // Regular query response
            return self.handle_result_set(reader, header_length);
        }

        // Handle based on request type
        // SAFETY: see above.
        if let Some(statement) = unsafe { (*request).get_statement() } {
            // PORT NOTE: reshaped for borrowck — `get_statement()` borrows
            // `*request` mutably; downgrade to a raw pointer immediately so
            // `request` can be re-borrowed below and `&mut self` isn't aliased.
            let statement = statement as *mut MySQLStatement;
            // TODO(b2-blocked): MySQLStatement intrusive ref_/deref_ (bun_ptr).
            // Skipped here; the queue's ref on `request` keeps the statement
            // alive for the duration of this call.
            // SAFETY: statement is a live *mut MySQLStatement owned by the request.
            match unsafe { (*statement).status } {
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
                    // SAFETY: request is live (ref'd above).
                    self.queue.mark_current_request_as_finished(unsafe { &mut *request });
                    let connection = self.get_js_connection();
                    // TODO(b2-blocked): ErrorPacket is not Clone in bun_sql; the
                    // Zig passes statement.error_response by value (struct copy).
                    // Send a default packet as a placeholder until ErrorPacket
                    // grows Clone or a borrowed-variant overload lands.
                    // SAFETY: connection/request are live.
                    unsafe {
                        (*connection)
                            .on_error_packet(Some(&mut *request), ErrorPacket::default())
                    };
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
            username: Data::Temporary(&*self.user as *const [u8]),
            database: Data::Temporary(&*self.database as *const [u8]),
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
            connect_attrs: Default::default(),
        };

        // Add some basic connect attributes like mysql2
        response.connect_attrs.insert(
            Box::<[u8]>::from(b"_client_name".as_slice()),
            Box::<[u8]>::from(b"Bun".as_slice()),
        );
        response.connect_attrs.insert(
            Box::<[u8]>::from(b"_client_version".as_slice()),
            Box::<[u8]>::from(bun_core::Global::package_json_version_with_revision.as_bytes()),
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
        response.write_internal(response_writer)?;
        packet.end()?;
        self.flush_data();
        Ok(())
    }

    pub fn writer(&mut self) -> NewWriter<Writer> {
        NewWriter {
            wrapped: Writer { connection: self as *mut Self },
        }
    }

    pub fn buffered_reader(&mut self) -> NewReader<Reader> {
        NewReader {
            wrapped: Reader { connection: self as *mut Self },
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

        let Some(request) = self.queue.current() else {
            debug!("Unexpected prepared statement packet missing request");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        // SAFETY: queue holds a ref on every request; pointer is live.
        unsafe { (*request).ref_() };
        let _request_guard = scopeguard::guard(request, |r| unsafe { (*r).deref_() });
        // SAFETY: see above.
        let Some(statement) = (unsafe { (*request).get_statement() }) else {
            debug!("Unexpected prepared statement packet missing statement");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        // PORT NOTE: reshaped for borrowck — downgrade to raw pointer so `&mut
        // self` (passed to `check_if_prepared_statement_is_done`) doesn't alias
        // the statement borrow rooted in `self.queue`.
        let statement = statement as *mut MySQLStatement;
        // TODO(b2-blocked): MySQLStatement intrusive ref_/deref_ (bun_ptr).
        // SAFETY: statement is a live *mut MySQLStatement owned by the request.
        let statement = unsafe { &mut *statement };
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
                    statement.params = vec![Param::default(); ok.num_params as usize];
                    statement.params_received = 0;
                }

                // Read column definitions if any
                if ok.num_columns > 0 {
                    statement.columns =
                        vec![ColumnDefinition41::default(); ok.num_columns as usize];
                    statement.columns_received = 0;
                }

                self.check_if_prepared_statement_is_done(statement);
            }

            PacketType::ERROR => {
                debug!("handlePreparedStatement ERROR");
                let mut err = ErrorPacket::default();
                err.decode(reader)?;
                // PORT NOTE: reshaped for borrowck — Zig `defer this.queue.advance(connection)`
                // moved to explicit call after `on_error_packet` below.
                self.flags.insert(ConnectionFlags::IS_READY_FOR_QUERY);
                statement.status = mysql_statement::Status::Failed;
                // err.error_message is a Data{ .temporary = ... } slice into the socket read
                // buffer which will be overwritten by the next packet. The statement is cached
                // in this.statements and its error_response may be read later via
                // stmt.error_response.toJS(), so we must own a copy of the message bytes.
                // TODO(b2-blocked): ErrorPacket lacks Clone in bun_sql; manual
                // copy of just `error_message` is what the Zig actually needs.
                statement.error_response = ErrorPacket::default(); // drop old (Drop handles deinit)
                statement.error_response.error_message =
                    Data::create(err.error_message.slice()).map_err(|_| AnyMySQLError::OutOfMemory)?;
                self.queue.mark_as_ready_for_query();
                // SAFETY: request is live (ref'd above).
                self.queue.mark_current_request_as_finished(unsafe { &mut *request });

                let connection = self.get_js_connection();
                // SAFETY: connection/request are live.
                unsafe { (*connection).on_error_packet(Some(&mut *request), err) };
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

    // PORT NOTE: reshaped for borrowck — `request`/`statement` come from
    // `self.queue` so passing `&mut self` alongside `&mut JSMySQLQuery` would
    // alias. Take raw pointers (Zig's `*JSMySQLQuery` / `*MySQLStatement`) and
    // deref locally; the queue's intrusive ref keeps them alive.
    
    fn handle_result_set_ok(
        &mut self,
        request: *mut JSMySQLQuery,
        statement: *mut MySQLStatement,
        status_flags: StatusFlags,
        last_insert_id: u64,
        affected_rows: u64,
    ) {
        self.status_flags = status_flags;
        let is_last_result = !status_flags.has(StatusFlags::SERVER_MORE_RESULTS_EXISTS);
        debug!("handleResultSetOK: {} {}", status_flags.to_int(), is_last_result);
        // PORT NOTE: Zig `defer this.flushQueue()` moved to explicit tail call.
        self.flags.set(ConnectionFlags::IS_READY_FOR_QUERY, is_last_result);
        if is_last_result {
            self.queue.mark_as_ready_for_query();
            // SAFETY: request is live (caller holds a ref).
            self.queue.mark_current_request_as_finished(unsafe { &mut *request });
        }

        // SAFETY: statement is live (owned by request).
        let result_count = unsafe { (*statement).result_count };
        let connection = self.get_js_connection();
        // SAFETY: connection/request are live.
        unsafe {
            (*connection).on_query_result(
                &mut *request,
                QueryResult { result_count, last_insert_id, affected_rows, is_last_result },
            )
        };

        // SAFETY: statement is live.
        unsafe { (*statement).reset() };

        // Use flushQueue instead of just advance to ensure any data written
        // by queries added during onQueryResult is actually sent.
        // This fixes a race condition where the auto flusher may not be
        // registered if the queue's current item is completed (not pending).
        let _ = self.flush_queue();
    }

    fn get_js_connection(&mut self) -> *mut JSMySQLConnection {
        // SAFETY: self is the `connection` field embedded inside JSMySQLConnection;
        // @fieldParentPtr("#connection", this) in Zig. Derive from `*mut Self`
        // (Unique provenance) so callers may write through the result — casting
        // from `&self` (`*const`) would carry SharedReadOnly provenance and
        // make any subsequent write UB under Stacked Borrows.
        unsafe {
            (self as *mut Self as *mut u8)
                .sub(offset_of!(JSMySQLConnection, connection))
                .cast::<JSMySQLConnection>()
        }
        // TODO(port): JSMySQLConnection field name was `#connection` (private) in Zig; confirm Rust field name
    }

    
    fn handle_result_set<C: ReaderContext>(
        &mut self,
        reader: NewReader<C>,
        header_length: u32, // u24 in Zig
    ) -> Result<(), AnyMySQLError> {
        let first_byte = reader.int::<u8>()?;
        debug!("handleResultSet: {:02x}", first_byte);

        reader.skip(-1isize);

        let Some(request) = self.queue.current() else {
            debug!("Unexpected result set packet");
            return Err(AnyMySQLError::UnexpectedPacket);
        };
        // SAFETY: queue holds a ref on every request; pointer is live.
        unsafe { (*request).ref_() };
        let _request_guard = scopeguard::guard(request, |r| unsafe { (*r).deref_() });
        let mut ok = OKPacket {
            packet_size: header_length,
            ..Default::default()
        };
        match PacketType::from_raw(first_byte) {
            PacketType::ERROR => {
                let mut err = ErrorPacket::default();
                err.decode(reader)?;
                // PORT NOTE: reshaped for borrowck — Zig `defer this.flushQueue()`
                // moved to explicit tail call.
                // SAFETY: request is live (ref'd above).
                if let Some(statement) = unsafe { (*request).get_statement() } {
                    statement.reset();
                }

                self.flags.insert(ConnectionFlags::IS_READY_FOR_QUERY);
                self.queue.mark_as_ready_for_query();
                // SAFETY: request is live.
                self.queue.mark_current_request_as_finished(unsafe { &mut *request });

                let connection = self.get_js_connection();
                // SAFETY: connection/request are live.
                unsafe { (*connection).on_error_packet(Some(&mut *request), err) };
                let _ = self.flush_queue();
            }

            packet_type => {
                // SAFETY: request is live (ref'd above).
                let Some(statement) = (unsafe { (*request).get_statement() }) else {
                    debug!("Unexpected result set packet");
                    return Err(AnyMySQLError::UnexpectedPacket);
                };
                // PORT NOTE: reshaped for borrowck — downgrade to raw pointer so
                // `&mut self` calls below don't alias the statement borrow.
                let statement = statement as *mut MySQLStatement;
                // TODO(b2-blocked): MySQLStatement intrusive ref_/deref_ (bun_ptr).
                // SAFETY: statement is a live *mut MySQLStatement owned by the request.
                let statement = unsafe { &mut *statement };
                if !statement
                    .execution_flags
                    .contains(mysql_statement::ExecutionFlags::HEADER_RECEIVED)
                {
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
                        statement.columns =
                            vec![ColumnDefinition41::default(); header.field_count as usize];
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
                    statement.columns[statement.columns_received as usize].decode(reader)?;
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
                            if !statement
                                .execution_flags
                                .contains(mysql_statement::ExecutionFlags::COLUMNS_EOF_RECEIVED)
                            {
                                // Intermediate EOF between column definitions and row data - skip it
                                let mut eof = EOFPacket::default();
                                eof.decode(reader)?;
                                statement
                                    .execution_flags
                                    .insert(mysql_statement::ExecutionFlags::COLUMNS_EOF_RECEIVED);
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

                    // SAFETY: connection is the parent JSMySQLConnection containing
                    // self; request is live (ref'd above).
                    unsafe { (*connection).on_result_row(&mut *request, statement, reader)? };
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

impl WriterContext for Writer {
    fn write(self, data: &[u8]) -> Result<(), AnyMySQLError> {
        // SAFETY: self.connection points at a live MySQLConnection for the
        // duration of the write call (NewWriter is constructed by
        // `MySQLConnection::writer(&mut self)` and not stored).
        let buffer = unsafe { &mut (*self.connection).write_buffer };
        buffer.write(data).map_err(|_| AnyMySQLError::OutOfMemory)?;
        Ok(())
    }

    fn pwrite(self, data: &[u8], index: usize) -> Result<(), AnyMySQLError> {
        // SAFETY: see `write`.
        let byte_list = unsafe { &mut (*self.connection).write_buffer.byte_list };
        byte_list.slice_mut()[index..][..data.len()].copy_from_slice(data);
        Ok(())
    }

    fn offset(self) -> usize {
        // SAFETY: see `write`.
        unsafe { (*self.connection).write_buffer.len() as usize }
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
// UB). Instead each method below dereferences only the specific field(s) it
// touches via `(*self.connection).field`, matching `Writer` above and Zig's
// freely-aliasing `*MySQLConnection` semantics.
impl ReaderContext for Reader {
    fn mark_message_start(self) {
        // SAFETY: self.connection points at a live MySQLConnection for the
        // duration of the read call (NewReader is constructed by
        // `MySQLConnection::buffered_reader(&mut self)` and not stored).
        unsafe { (*self.connection).last_message_start = (*self.connection).read_buffer.head };
    }

    fn set_offset_from_start(self, offset: usize) {
        // SAFETY: see `mark_message_start`.
        unsafe {
            (*self.connection).read_buffer.head =
                (*self.connection).last_message_start + (offset as u32);
        }
    }

    fn peek(&self) -> &[u8] {
        // SAFETY: see `mark_message_start`.
        unsafe { (*self.connection).read_buffer.remaining() }
    }

    fn skip(self, count: isize) {
        // SAFETY: see `mark_message_start`. Borrow only `read_buffer`.
        let rb = unsafe { &mut (*self.connection).read_buffer };
        if count < 0 {
            let abs_count = count.unsigned_abs();
            if abs_count > rb.head as usize {
                rb.head = 0;
                return;
            }
            rb.head -= u32::try_from(abs_count).unwrap();
            return;
        }

        let ucount: usize = usize::try_from(count).unwrap();
        if rb.head as usize + ucount > rb.byte_list.len as usize {
            rb.head = rb.byte_list.len;
            return;
        }

        rb.head += u32::try_from(ucount).unwrap();
    }

    fn ensure_capacity(self, count: usize) -> bool {
        // SAFETY: see `mark_message_start`.
        unsafe { (*self.connection).read_buffer.remaining().len() >= count }
    }

    fn read(self, count: usize) -> Result<Data, AnyMySQLError> {
        // SAFETY: see `mark_message_start`.
        let remaining = unsafe { (*self.connection).read_buffer.remaining() };
        if remaining.len() < count {
            return Err(AnyMySQLError::ShortRead);
        }

        // PORT NOTE: reshaped for borrowck — capture slice ptr before skip().
        let slice = &remaining[0..count] as *const [u8];
        self.skip(isize::try_from(count).unwrap());
        Ok(Data::Temporary(slice))
    }

    fn read_z(self) -> Result<Data, AnyMySQLError> {
        // SAFETY: see `mark_message_start`.
        let remaining = unsafe { (*self.connection).read_buffer.remaining() };
        if let Some(zero) = bun_core::strings::index_of_char(remaining, 0) {
            let slice = &remaining[0..zero as usize] as *const [u8];
            self.skip(isize::try_from(zero + 1).unwrap());
            return Ok(Data::Temporary(slice));
        }

        Err(AnyMySQLError::ShortRead)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AnySocket dispatch helpers — TODO(b2-blocked): bun_uws::AnySocket grows
// `write`/`close`/`set_timeout` once the socket-handler dispatch surface
// un-gates. Until then, match on the variant and call NewSocketHandler.
// ──────────────────────────────────────────────────────────────────────────

#[inline]
fn any_socket_write(s: &Socket, data: &[u8]) -> i32 {
    match s {
        Socket::SocketTcp(h) => h.write(data),
        Socket::SocketTls(h) => h.write(data),
    }
}

#[inline]
fn any_socket_close(s: &Socket) {
    match s {
        Socket::SocketTcp(h) => h.close(uws::CloseKind::Normal),
        Socket::SocketTls(h) => h.close(uws::CloseKind::Normal),
    }
}

#[inline]
fn any_socket_set_timeout(s: &Socket, seconds: core::ffi::c_uint) {
    match s {
        Socket::SocketTcp(h) => h.set_timeout(seconds),
        Socket::SocketTls(h) => h.set_timeout(seconds),
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/MySQLConnection.zig (1180 lines)
//   confidence: medium
//   gating:     none — do_handshake / upgrade_to_tls / cleanup now ported.
//               handle_handshake / handle_auth / handle_command /
//               handle_prepared_statement / handle_result_set /
//               handle_result_set_ok / check_if_prepared_statement_is_done /
//               send_handshake_response / send_auth_switch_response /
//               handle_handshake_decode_public_key depend on
//               bun_sql::mysql::protocol decode/write surfaces (Decode trait,
//               writeWrap, PacketType repr, Capabilities field-style accessors,
//               Auth::caching_sha2_password::Status,
//               OKPacket/HandshakeResponse41 Default).
//   un-gated:   struct + Default + init / can_pipeline / can_prepare_query /
//               can_execute_query / is_able_to_write / is_processing_data /
//               has_backpressure / reset_backpressure / can_flush / is_idle /
//               enqueue_request / flush_queue / advance / flush_data / close /
//               clean_queue_and_close / cleanup / set_socket / is_active /
//               is_connected / read_and_process_data / process_packets dispatch /
//               set_status / writer / buffered_reader / get_js_connection /
//               Writer + WriterContext / Reader + ReaderContext / AnySocket
//               dispatch helpers.
//   notes:      ConnectionFlags is bitflags (Zig packed struct of bools —
//               accessors rewritten to .contains()/.set()/.insert()/.remove());
//               Reader/Writer hold *mut MySQLConnection (Copy) so the
//               ReaderContext/WriterContext: Copy bounds are satisfied; queue
//               advance/on_* calls route through raw `*mut JSMySQLConnection`
//               (Zig @fieldParentPtr) to dodge stacked-borrow aliasing; Zig
//               `defer` reshaped to explicit tail calls (no scopeguard capture
//               of &mut self). database/user/password/options should be ranges
//               into options_buf (currently 5 Box<[u8]> — revert init() params
//               to &[u8] in Phase B).
// ──────────────────────────────────────────────────────────────────────────
