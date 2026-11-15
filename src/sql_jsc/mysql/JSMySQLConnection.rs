use core::cell::Cell;
use core::ffi::c_void;

use bun_jsc::bindgen::{Callable, JsLocal, JsScope};

use crate::generated_bindgen::js_my_sql_connection::js_MySQLConnection as js;
use crate::jsc::api::server_config::SSLConfig;
use crate::jsc::{
    AutoFlush, EventLoopTimerTag, GlobalRef, JSGlobalObject, JSValue, JsRef, JsResult, OwnedTimer,
    VirtualMachine, VirtualMachineSqlExt as _, run_callback,
};
use crate::shared::cached_structure::{column_name_to_js, transform_name};
use crate::shared::connection_ctor_args::ConnectionCtorArgs;
use crate::shared::connection_timers::{ConnectionTimers, Phase, TimedConnection};
use crate::shared::server_identity;
use bun_boringssl_sys::OwnedSslCtx;
use bun_collections::OffsetByteList;
use bun_core::fmt::ConnTimeoutKind;
use bun_core::strings;
use bun_ptr::{AsCtxPtr, BackRef, RefPtr};
use bun_sql::mysql::Capabilities;
use bun_sql::mysql::auth_method::AuthMethod;
use bun_sql::mysql::capabilities::MariaDBCapabilities;
use bun_sql::mysql::connection_state::ConnectionState;
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLErrorT;
use bun_sql::mysql::protocol::auth as Auth;
use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::mysql::protocol::error_packet::ErrorPacket;
use bun_sql::mysql::protocol::packet_reader::PacketReader;
use bun_sql::mysql::status_flags::StatusFlags;
use bun_sql::mysql::tls_status::TLSStatus;
use bun_sql::shared::SSLMode;
use bun_sql::shared::connection_flags::ConnectionFlags;
use bun_uws::{self as uws, AnySocket, NewSocketHandler, SocketTCP};

use super::js_my_sql_query::JSMySQLQuery;
use super::my_sql_request_queue::MySQLRequestQueue;
use super::my_sql_statement::{ResultState, StatementCache};
use super::protocol::result_set::{self as ResultSet};
use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
use crate::mysql::protocol::error_packet_jsc::ErrorPacketJsc;

#[path = "MySQLConnection.rs"]
mod my_sql_connection;

bun_core::declare_scope!(MySQLConnection, visible);

// JS can re-enter any method, so they all take `&self` and the fields are cells.
/// `MySQLConnection`, declared in `JSMySQLConnection.bind.ts`.
#[derive(bun_ptr::RefCounted)]
pub struct JSMySQLConnection {
    ref_count: bun_ptr::RefCount,
    js_value: JsRef,
    global_object: GlobalRef,
    vm: BackRef<VirtualMachine>,
    poll_ref: bun_io::JsKeepAlive,
    /// Held from the socket's open to its close.
    socket_ref: Cell<Option<RefPtr<Self>>>,

    socket: Cell<AnySocket>,
    status: Cell<ConnectionState>,

    write_buffer: Cell<OffsetByteList>,
    read_buffer: Cell<OffsetByteList>,
    /// While set, a read from a nested event loop tick only appends to `read_buffer`.
    defer_reads: Cell<bool>,
    /// The one behind the last packet that was read.
    sequence_id: Cell<u8>,
    /// The reply to the head of the queue has begun: its next packet has `sequence_id`. The first
    /// one has no id to expect: it counts on from the packets of the command, not all of which a
    /// server reads before it refuses them, and an ERR that nobody asked for has 0.
    in_reply: Cell<bool>,

    queue: MySQLRequestQueue,
    statements: StatementCache,

    capabilities: Cell<Capabilities>,
    mariadb_capabilities: Cell<MariaDBCapabilities>,
    status_flags: Cell<StatusFlags>,

    auth_plugin: Cell<Option<AuthMethod>>,
    auth_switch_count: Cell<u8>,
    full_auth_requested: Cell<bool>,

    auth_data: Cell<Auth::Nonce>,
    database: Box<[u8]>,
    user: Box<[u8]>,
    password: Box<[u8]>,
    secure: Option<OwnedSslCtx>,
    tls_config: SSLConfig,
    tls_status: Cell<TLSStatus>,
    ssl_mode: SSLMode,
    allow_public_key_retrieval: bool,
    unix_socket: bool,
    flags: Cell<ConnectionFlags>,

    auto_flush_registered: Cell<bool>,
    timers: Timers,
}

const TIMEOUT: EventLoopTimerTag = EventLoopTimerTag::MySQLConnectionTimeout;
const MAX_LIFETIME: EventLoopTimerTag = EventLoopTimerTag::MySQLConnectionMaxLifetime;
type Timers = ConnectionTimers<TIMEOUT, MAX_LIFETIME>;

bun_event_loop::impl_timer_owner!(JSMySQLConnection, drop = Self::unregister_auto_flusher;
    (timers: Timers).timer: OwnedTimer<MySQLConnectionTimeout>,
    (timers: Timers).max_lifetime_timer: OwnedTimer<MySQLConnectionMaxLifetime>,
);

impl JSMySQLConnection {
    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    #[inline]
    fn event_loop(&self) -> &'static crate::jsc::EventLoop {
        VirtualMachine::get().event_loop()
    }

    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }
}

impl TimedConnection<TIMEOUT, MAX_LIFETIME> for JSMySQLConnection {
    fn timers(&self) -> &Timers {
        &self.timers
    }

    fn phase(&self) -> Phase {
        use ConnectionState as S;
        match self.status.get() {
            S::Connected => Phase::Connected,
            S::Failed => Phase::Failed,
            S::Connecting => Phase::Connecting(""),
            S::Handshaking | S::Authenticating | S::AuthenticationAwaitingPk => {
                Phase::Connecting(" (during authentication)")
            }
            S::SessionSetup => Phase::Connecting(" (during session setup)"),
        }
    }

    fn has_requests(&self) -> bool {
        !self.is_idle()
    }

    fn is_processing_data(&self) -> bool {
        self.flags
            .get()
            .contains(ConnectionFlags::IS_PROCESSING_DATA)
    }

    fn fail_timeout(&self, kind: ConnTimeoutKind, message: core::fmt::Arguments<'_>) {
        let code = match kind {
            ConnTimeoutKind::Idle => AnyMySQLErrorT::IdleTimeout,
            ConnTimeoutKind::Connection => AnyMySQLErrorT::ConnectionTimedOut,
            ConnTimeoutKind::MaxLifetime => AnyMySQLErrorT::LifetimeTimeout,
        };
        self.fail_fmt(code, message);
    }

    fn notify_retiring(&self) {
        let Some(js_value) = self.js_value.try_get() else {
            return;
        };
        if let Some(on_retire) = js::onretire_take_cached(js_value, &self.global_object) {
            run_callback(&self.global_object, on_retire, &[]);
        }
    }
}

// SAFETY: refcounted on the heap, and `drop` unregisters.
unsafe impl AutoFlush for JSMySQLConnection {
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    fn auto_flush_registered(&self) -> &Cell<bool> {
        &self.auto_flush_registered
    }

    fn can_flush(&self) -> bool {
        !self.has_backpressure() // if has backpressure we need to wait for onWritable event
            && self.status.get() == ConnectionState::Connected // and we need to be connected
            // we need data to send
            && (self.write_buffer_len() > 0 || self.queue.is_waiting_to_write())
    }

    fn on_auto_flush(&self) -> bool {
        // With backpressure, onWritable drains.
        if !self.has_backpressure() {
            self.drain_internal();
        }
        let again = self.can_flush();
        self.auto_flush_registered.set(again);
        again
    }
}

impl JSMySQLConnection {
    pub(crate) fn enqueue_request(&self, item: RefPtr<JSMySQLQuery>) {
        bun_core::scoped_log!(MySQLConnection, "enqueueRequest");
        let _entered = self.entered_from_js();
        self.queue.add(item);
        self.advance();
        self.on_queue_changed();
    }

    /// Keeps a callback's exit from draining microtasks in the middle of the calling JS frame.
    fn entered_from_js(&self) -> bun_jsc::event_loop::EventLoopEnterNoCheckpointGuard<'_> {
        self.vm().enter_event_loop_scope_without_checkpoint()
    }

    fn on_queue_changed(&self) {
        if self.retire_if_idle() {
            return;
        }
        if self.status.get() == ConnectionState::Connected {
            self.reset_connection_timeout();
        }
        self.update_reference_type();
        self.register_auto_flusher();
    }

    fn drain_internal(&self) {
        bun_core::scoped_log!(MySQLConnection, "drainInternal");
        let _guard = self.ref_guard();
        {
            let _loop_guard = self.event_loop().enter_scope();
            self.ensure_js_value_is_alive();
            if let Err(my_sql_connection::FlushQueueError::AuthenticationFailed) =
                self.flush_queue()
            {
                self.fail(
                    b"Authentication failed",
                    AnyMySQLErrorT::AuthenticationFailed,
                );
            }
            self.retire_if_idle();
        }
        self.on_queue_changed();
    }

    fn ensure_js_value_is_alive(&self) {
        if let Some(value) = self.js_value.try_get() {
            value.ensure_still_alive();
        }
    }

    pub fn finalize(&self) {
        bun_core::scoped_log!(MySQLConnection, "finalize");
        self.js_value.finalize();
    }

    fn update_reference_type(&self) {
        if self.is_active() {
            bun_core::scoped_log!(MySQLConnection, "connection is active");
            if self.js_value.is_not_empty() && !self.js_value.is_strong() {
                bun_core::scoped_log!(MySQLConnection, "strong ref until connection is closed");
                self.js_value.upgrade(&self.global_object);
            }
            let ctx = self.vm_ctx();
            if self.status.get() == ConnectionState::Connected && self.is_idle() {
                self.poll_ref.unref(ctx);
            } else {
                self.poll_ref.r#ref(ctx);
            }
            return;
        }
        self.js_value.downgrade();
        let ctx = self.vm_ctx();
        self.poll_ref.unref(ctx);
    }

    pub(crate) fn create_connection<'a>(
        cx: &mut JsScope<'a>,
        hostname: &[u8],
        port: f64,
        username: &[u8],
        password: &[u8],
        database: &[u8],
        ssl_mode: u8,
        tls: JsLocal<'a>,
        _: JsLocal<'a>,
        path: &[u8],
        on_connected: JsLocal<'a, Callable>,
        on_disconnected: JsLocal<'a, Callable>,
        idle_timeout: f64,
        connection_timeout: f64,
        max_lifetime: f64,
        _: JsLocal<'a>,
        allow_public_key_retrieval: bool,
        on_retire: Option<JsLocal<'a, Callable>>,
        found_rows: bool,
        _: JsLocal<'a>,
        column_transform: Option<JsLocal<'a, Callable>>,
    ) -> JsResult<JSValue> {
        let global_object = cx.global();
        let vm = global_object.bun_vm();
        let port = port as i32;
        // The connection is the calling script's.
        let context = global_object.bun_vm().context_of_caller();
        let Some(args) = ConnectionCtorArgs::parse(
            global_object,
            hostname,
            ssl_mode,
            tls.to_js(),
            idle_timeout,
            connection_timeout,
            max_lifetime,
        )?
        else {
            return Ok(JSValue::ZERO);
        };
        let (secure, tls_config) = (args.secure, args.tls_config);
        let check_server_identity = server_identity::callback_of(global_object, tls.to_js())?;

        let username: Box<[u8]> = Box::from(username);
        let password: Box<[u8]> = Box::from(password);
        let database: Box<[u8]> = Box::from(database);
        let path: Box<[u8]> = Box::from(path);

        // Reject null bytes in connection parameters to prevent protocol injection
        // (null bytes act as field terminators in the MySQL wire protocol).
        for (slice, msg) in [
            (&username[..], "username must not contain null bytes"),
            (&password[..], "password must not contain null bytes"),
            (&database[..], "database must not contain null bytes"),
            (&path[..], "path must not contain null bytes"),
        ] {
            if !slice.is_empty() && strings::index_of_char(slice, 0).is_some() {
                return Err(global_object.throw_invalid_arguments(format_args!("{msg}")));
            }
        }

        let this = RefPtr::new(JSMySQLConnection {
            ref_count: bun_ptr::RefCount::init(),
            js_value: JsRef::empty(),
            global_object: GlobalRef::from(global_object),
            vm: BackRef::new(VirtualMachine::get()),
            poll_ref: Default::default(),
            socket: Cell::new(AnySocket::SocketTcp(SocketTCP::detached())),
            status: Cell::new(ConnectionState::Connecting),
            write_buffer: Cell::default(),
            read_buffer: Cell::default(),
            defer_reads: Cell::new(false),
            sequence_id: Cell::new(0),
            in_reply: Cell::new(false),
            queue: MySQLRequestQueue::init(),
            statements: StatementCache::default(),
            capabilities: Cell::new(Capabilities::get_default_capabilities(
                args.ssl_mode != SSLMode::Disable,
                !database.is_empty(),
                found_rows,
            )),
            mariadb_capabilities: Cell::default(),
            status_flags: Cell::default(),
            auth_plugin: Cell::new(None),
            auth_switch_count: Cell::new(0),
            full_auth_requested: Cell::new(false),
            auth_data: Cell::new([0; Auth::NONCE_LENGTH]),
            database,
            user: username,
            password,
            secure,
            tls_config,
            tls_status: Cell::new(if args.ssl_mode != SSLMode::Disable {
                TLSStatus::Pending
            } else {
                TLSStatus::None
            }),
            ssl_mode: args.ssl_mode,
            allow_public_key_retrieval,
            unix_socket: !path.is_empty(),
            flags: Cell::default(),
            socket_ref: Cell::new(None),
            auto_flush_registered: Cell::new(false),
            timers: ConnectionTimers::new(
                args.idle_timeout_ms,
                args.connection_timeout_ms,
                args.max_lifetime_ms,
            ),
        });
        OwnedTimer::<TIMEOUT>::mark_pinned(this.as_pin_ref());
        OwnedTimer::<MAX_LIFETIME>::mark_pinned(this.as_pin_ref());
        let ptr = this.as_ptr();

        {
            // MySQL always opens plain TCP first; STARTTLS adopts into the TLS
            // group after the SSLRequest exchange.
            let group = vm.mysql_socket_group::<false>(context);
            let result = if !path.is_empty() {
                SocketTCP::connect_unix_group(
                    group,
                    uws::DispatchKind::Mysql,
                    None,
                    &path[..],
                    ptr,
                    false,
                )
            } else {
                SocketTCP::connect_group(
                    group,
                    uws::DispatchKind::Mysql,
                    None,
                    hostname,
                    port,
                    ptr,
                    false,
                )
            };
            let socket = match result {
                Ok(s) => s,
                Err(_) => {
                    let mut message = b"Failed to connect".to_vec();
                    if !path.is_empty() {
                        message.extend_from_slice(b" to ");
                        message.extend_from_slice(&path);
                    }
                    return Err(global_object.throw_value(mysql_error_to_js(
                        global_object,
                        Some(&message),
                        AnyMySQLErrorT::ConnectionRefused,
                    )));
                }
            };
            this.socket.set(AnySocket::SocketTcp(socket));
        }
        this.reset_connection_timeout();
        this.poll_ref.r#ref(vm.vm_ctx());
        // The wrapper takes the ref.
        let this = this.into_this_ptr();
        let js_value = js::to_js(ptr, global_object);
        js_value.ensure_still_alive();
        this.js_value.set_strong(js_value, global_object);
        js::onconnect_set_cached(js_value, global_object, on_connected.to_js());
        if let Some(column_transform) = column_transform {
            js::column_transform_set_cached(js_value, global_object, column_transform.to_js());
        }
        js::onclose_set_cached(js_value, global_object, on_disconnected.to_js());
        if let Some(on_retire) = on_retire {
            js::onretire_set_cached(js_value, global_object, on_retire.to_js());
        }
        // Next to `rejectUnauthorized: false` it is not asked, as in Node.
        if let Some(callback) = check_server_identity.filter(|_| this.verifies_certificate()) {
            js::check_server_identity_set_cached(js_value, global_object, callback);
        }

        Ok(js_value)
    }

    pub fn flush(this: &Self) {
        this.register_auto_flusher();
    }

    pub fn close(this: &Self, _: &mut JsScope<'_>) {
        let _entered = this.entered_from_js();
        this.fail(b"Connection closed", AnyMySQLErrorT::ConnectionClosed);
    }

    pub fn hold(this: &Self) {
        this.timers.set_checked_out(true);
        this.reset_connection_timeout();
    }

    pub fn unhold(this: &Self, _: &mut JsScope<'_>) {
        let _entered = this.entered_from_js();
        this.timers.set_checked_out(false);
        this.on_queue_changed();
    }

    pub fn get_in_transaction(&self) -> bool {
        self.is_in_transaction()
    }

    fn check_server_identity_callback(&self) -> Option<JSValue> {
        self.js_value
            .try_get()
            .and_then(js::check_server_identity_get_cached)
    }

    fn consume_on_connect_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if let Some(value) = self.js_value.try_get() {
            return js::onconnect_take_cached(value, global_object);
        }
        None
    }

    fn consume_on_close_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if let Some(value) = self.js_value.try_get() {
            return js::onclose_take_cached(value, global_object);
        }
        None
    }

    fn fail_fmt(&self, error_code: AnyMySQLErrorT, args: core::fmt::Arguments<'_>) {
        let mut message: Vec<u8> = Vec::new();
        {
            use std::io::Write;
            let _ = write!(&mut message, "{}", args);
        }

        let err = mysql_error_to_js(&self.global_object, Some(&message), error_code);
        self.fail_with_js_value(err);
    }

    /// In this order: the socket closes, `onclose` tells the pool, the requests are rejected.
    fn fail_with_js_value(&self, value: JSValue) {
        if self.status.get() == ConnectionState::Failed {
            return;
        }
        let _guard = self.ref_guard();
        self.timers.stop();
        self.quit();
        self.status.set(ConnectionState::Failed);
        // Raises the socket's close event, which comes back here.
        self.socket.get().close_now();
        self.write_buffer.set(OffsetByteList::default());

        if let Some(on_close) = self.consume_on_close_callback(&self.global_object) {
            on_close.ensure_still_alive();
            self.ensure_js_value_is_alive();
            let mut js_error = value.to_error().unwrap_or(value);
            if js_error.is_empty() {
                js_error = mysql_error_to_js(
                    &self.global_object,
                    Some(b"Connection closed"),
                    AnyMySQLErrorT::ConnectionClosed,
                );
            }
            js_error.ensure_still_alive();

            run_callback(&self.global_object, on_close, &[js_error]);
        }

        self.queue.clean(value);
        self.update_reference_type();
    }

    fn fail(&self, message: &[u8], err: AnyMySQLErrorT) {
        let instance = mysql_error_to_js(&self.global_object, Some(message), err);
        self.fail_with_js_value(instance);
    }

    /// Outside the packet parser, and synchronous like `onclose` so that the two keep their order.
    fn notify_connected(&self) {
        if !self.take_on_connect_pending() || self.status.get() != ConnectionState::Connected {
            return;
        }
        self.start_max_lifetime_timer();
        let Some(on_connect) = self.consume_on_connect_callback(&self.global_object) else {
            return;
        };
        on_connect.ensure_still_alive();
        let js_value = self.js_value.try_get().unwrap_or(JSValue::UNDEFINED);
        js_value.ensure_still_alive();
        run_callback(&self.global_object, on_connect, &[JSValue::NULL, js_value]);
    }

    /// The client cannot turn one of `request`'s rows into a JS value. The
    /// packet header frames the row and the packet is skipped whole, so the
    /// stream is still in step: that fails the request alone, not the
    /// connection and the requests queued behind it. A VM that is stopping
    /// fails the connection instead.
    fn on_undecodable_row(
        &self,
        request: &JSMySQLQuery,
        err: AnyMySQLErrorT,
    ) -> Result<(), AnyMySQLErrorT> {
        if self.global_object.has_pending_termination_exception() {
            return Err(AnyMySQLErrorT::JSError);
        }
        request.reject_undecodable_row(err);
        Ok(())
    }

    /// Runs `transform.column.from`, user code.
    fn on_column_name(
        &self,
        request: &JSMySQLQuery,
        column: &mut ColumnDefinition41,
    ) -> Result<(), AnyMySQLErrorT> {
        let Some(transform) = self
            .js_value
            .try_get()
            .and_then(js::column_transform_get_cached)
        else {
            return Ok(());
        };
        if request.is_discarding_response() {
            column.forget_name();
            return Ok(());
        }
        let renamed = column_name_to_js(&self.global_object, &column.name_or_index)
            .and_then(|name| transform_name(&self.global_object, transform, name));
        match renamed {
            Ok(renamed) => {
                column.name_or_index = renamed;
                Ok(())
            }
            Err(err) => {
                column.forget_name();
                self.on_undecodable_row(request, crate::jsc::js_error_to_mysql(err))
            }
        }
    }

    fn on_result_row(
        &self,
        request: &JSMySQLQuery,
        result: &mut ResultState,
        reader: PacketReader<'_>,
    ) -> Result<(), AnyMySQLErrorT> {
        if request.is_discarding_response() {
            return Ok(());
        }
        let result_mode = request.get_result_mode();
        let mut structure: JSValue = JSValue::UNDEFINED;
        let cached_structure = match result_mode {
            ResultMode::Objects => {
                // Build unconditionally (matches postgres) so toJS always has
                // either a Structure or a names array.
                let owner = self.js_value.try_get().unwrap_or_default();
                result.build_structure(owner, &self.global_object);
                let cs = &result.cached_structure;
                structure = cs.js_value().unwrap_or(JSValue::UNDEFINED);
                Some(cs)
            }
            // no need to check for duplicate fields or structure
            ResultMode::Raw | ResultMode::Values => None,
        };
        let fields_flags = result.fields_flags;
        let mut row = ResultSet::Row {
            global_object: &self.global_object,
            columns: &result.columns,
            binary: !request.is_simple(),
            raw: result_mode == ResultMode::Raw,
            bigint: request.is_bigint_supported(),
            values: Vec::new(),
        };
        if let Err(e) = row.decode(reader) {
            return self.on_undecodable_row(request, e);
        }
        let pending_value = request.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        let Ok(row_value) = row.to_js(
            &self.global_object,
            pending_value,
            structure,
            fields_flags,
            result_mode,
            cached_structure,
        ) else {
            return self.on_undecodable_row(request, AnyMySQLErrorT::JSError);
        };
        drop(row);
        result.result_count += 1;

        if pending_value.is_empty_or_undefined_or_null() {
            request.set_pending_value(row_value);
        }
        Ok(())
    }

    pub(crate) fn on_error(&self, request: Option<&JSMySQLQuery>, err: AnyMySQLErrorT) {
        if let Some(request) = request {
            if let Some(err_) = self.global_object.try_take_exception() {
                request.reject_with_js_value(err_);
            } else {
                request.reject(err);
            }
        } else {
            if let Some(err_) = self.global_object.try_take_exception() {
                self.fail_with_js_value(err_);
            } else {
                self.fail_with_js_value(mysql_error_to_js(&self.global_object, None, err));
            }
        }
    }

    fn on_error_packet(&self, request: Option<&JSMySQLQuery>, err: &ErrorPacket<'_>) {
        if let Some(request) = request {
            if let Some(err_) = self.global_object.try_take_exception() {
                request.reject_with_js_value(err_);
            } else {
                request.reject_with_js_value(err.to_js(&self.global_object));
            }
        } else {
            if let Some(err_) = self.global_object.try_take_exception() {
                self.fail_with_js_value(err_);
            } else {
                self.fail_with_js_value(err.to_js(&self.global_object));
            }
        }
    }
}

/// uSockets event handlers for the MySQL connection (plain and TLS).
pub struct SocketHandler<const SSL: bool>;

impl<const SSL: bool> SocketHandler<SSL> {
    fn socket(s: NewSocketHandler<SSL>) -> AnySocket {
        if SSL {
            AnySocket::SocketTls(s.assume_ssl())
        } else {
            AnySocket::SocketTcp(s.assume_tcp())
        }
    }

    pub fn on_open(this: &JSMySQLConnection, s: NewSocketHandler<SSL>) {
        let socket = Self::socket(s);
        let is_tcp = matches!(socket, AnySocket::SocketTcp(_));
        this.socket.set(socket);

        if is_tcp {
            // This handshake is not TLS handleshake is actually the MySQL handshake
            // When a connection is upgraded to TLS, the onOpen callback is called again and at this moment we dont wanna to change the status to handshaking
            this.status.set(ConnectionState::Handshaking);
            this.socket_ref.set(Some(this.ref_guard()));
            // The bound on a query whose peer is gone: no timer runs while one is in flight.
            if !this.unix_socket {
                let _ = s.set_keep_alive(true, 60);
            }
        }
        // Only set up the timers after all status changes are complete — the timers rely on the status to determine timeouts.
        this.reset_connection_timeout();
        this.update_reference_type();
    }

    fn on_handshake(
        this: &JSMySQLConnection,
        _: NewSocketHandler<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        if success == 1 && !this.awaits_tls_handshake() {
            return;
        }
        if !this.do_handshake(success, ssl_error) {
            let v = crate::jsc::verify_error_to_js(&ssl_error, &this.global_object);
            return this.fail_with_js_value(v);
        }
        if let Some(callback) = this.check_server_identity_callback() {
            // It can close this connection.
            let _guard = this.ref_guard();
            let socket = this.socket.get();
            let hostname = this.server_name();
            if let Err(reason) =
                server_identity::check(&this.global_object, callback, &socket, hostname)
            {
                return this.fail_with_js_value(reason);
            }
            if this.status.get() != ConnectionState::Authenticating {
                return;
            }
        }
        if let Err(e) = this.send_handshake_response() {
            this.fail_fmt(e, format_args!("Failed to send handshake response"));
        }
    }

    pub const ON_HANDSHAKE: Option<
        fn(&JSMySQLConnection, NewSocketHandler<SSL>, i32, uws::us_bun_verify_error_t),
    > = if SSL { Some(Self::on_handshake) } else { None };

    pub fn on_close(
        this: &JSMySQLConnection,
        _: NewSocketHandler<SSL>,
        _: i32,
        _: Option<*mut c_void>,
    ) {
        let _guard = this.socket_ref.take();
        // usockets frees this socket at end-of-tick; drop the stored pointer
        // now so nothing (timer callbacks, close) dereferences it after
        // the free.
        this.socket.set(AnySocket::SocketTcp(SocketTCP::detached()));
        if this.status.get() == ConnectionState::Failed {
            return;
        }
        // A close before the handshake finished means the server (or an
        // intermediary like a container port proxy) accepted the TCP
        // connection but went away before completing startup — e.g. the
        // database is still initializing. Report it as a connect failure
        // (the connection was never established) rather than a closed
        // connection so the error is actionable.
        use ConnectionState as S;
        let (message, err): (&'static [u8], AnyMySQLErrorT) = match this.status.get() {
            S::Connecting
            | S::Handshaking
            | S::Authenticating
            | S::AuthenticationAwaitingPk
            | S::SessionSetup => (
                b"Connection closed before the connection was established",
                AnyMySQLErrorT::ConnectionFailed,
            ),
            S::Connected | S::Failed => (b"Connection closed", AnyMySQLErrorT::ConnectionClosed),
        };
        this.fail(message, err);
    }

    pub fn on_end(_: &JSMySQLConnection, socket: NewSocketHandler<SSL>) {
        // no half closed sockets
        socket.close(uws::CloseKind::Normal);
    }

    pub fn on_connect_error(this: &JSMySQLConnection, _: NewSocketHandler<SSL>, _: i32) {
        // As in `on_close`.
        this.socket.set(AnySocket::SocketTcp(SocketTCP::detached()));
        this.fail(b"Failed to connect", AnyMySQLErrorT::ConnectionRefused);
    }

    pub fn on_timeout(_: &JSMySQLConnection, _: NewSocketHandler<SSL>) {}

    pub fn on_data(this: &JSMySQLConnection, _: NewSocketHandler<SSL>, data: &[u8]) {
        let _guard = this.ref_guard();
        {
            let _loop_guard = this.event_loop().enter_scope();
            this.ensure_js_value_is_alive();

            if let Err(e) = this.read_and_process_data(data) {
                this.on_error(None, e);
            }
            this.notify_connected();
            this.retire_if_idle();
        }
        this.on_queue_changed();
    }

    pub fn on_writable(this: &JSMySQLConnection, _: NewSocketHandler<SSL>) {
        this.reset_backpressure();
        this.drain_internal();
    }
}

use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode as ResultMode;
