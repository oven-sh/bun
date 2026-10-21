use core::cell::Cell;
use core::ffi::c_void;

use bun_jsc::bindgen::JsScope;

use crate::generated_bindgen::js_my_sql_connection::js_MySQLConnection as js;
use crate::jsc::{
    AutoFlush, CallFrame, EventLoopSqlExt as _, EventLoopTimerTag, GlobalRef, JSGlobalObject,
    JSValue, JsCell, JsRef, JsResult, KeepAlive, VirtualMachine, VirtualMachineSqlExt as _,
    run_callback,
};
use crate::shared::CachedStructure;
use crate::shared::cached_structure::{column_name_to_js, transform_name};
use crate::shared::connection_ctor_args::ConnectionCtorArgs;
use crate::shared::connection_timers::{ConnectionTimers, Phase, TimedConnection};
use crate::shared::server_identity;
use bun_core::fmt::ConnTimeoutKind;
use bun_core::strings;
use bun_ptr::{AsCtxPtr, BackRef, ParentRef, RefPtr};
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLErrorT;
use bun_sql::mysql::protocol::error_packet::ErrorPacket;
use bun_sql::mysql::protocol::new_writer::NewWriter;
use bun_sql::mysql::protocol::stack_reader::PacketReader;
use bun_uws::{self as uws, AnySocket, NewSocketHandler, SocketTCP};

use super::js_my_sql_query::JSMySQLQuery;
use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
use crate::mysql::protocol::error_packet_jsc::ErrorPacketJsc;
// Not `MySQLConnection` by name: `declare_scope!` below takes that name.
use super::my_sql_connection::{self as my_sql_connection};
use super::my_sql_request_queue::MySQLRequestQueue;
use super::my_sql_statement::MySQLStatement;
use super::my_sql_value::Value;
use super::protocol::result_set::{self as ResultSet};

bun_core::declare_scope!(MySQLConnection, visible);

// JS can re-enter any method, so they all take `&self` and the fields are cells.
/// `MySQLConnection`, declared in `JSMySQLConnection.bind.ts`.
#[derive(bun_ptr::CellRefCounted)]
pub struct JSMySQLConnection {
    ref_count: Cell<u32>,
    js_value: JsCell<JsRef>,
    global_object: GlobalRef,
    vm: BackRef<VirtualMachine>,
    poll_ref: JsCell<KeepAlive>,

    pub(crate) connection: JsCell<my_sql_connection::MySQLConnection>,

    auto_flush_registered: Cell<bool>,
    timers: ConnectionTimers,
}

bun_event_loop::impl_timer_owner!(JSMySQLConnection;
    from_timer_ptr => timers.timer,
    from_max_lifetime_timer_ptr => timers.max_lifetime_timer,
);

impl Drop for JSMySQLConnection {
    fn drop(&mut self) {
        self.timers.stop();
        let ctx = self.vm_ctx();
        self.poll_ref.with_mut(|p| p.unref(ctx));
        self.unregister_auto_flusher();
    }
}

impl JSMySQLConnection {
    pub fn server_identity(
        &self,
        ssl: &mut bun_boringssl_sys::SSL,
    ) -> bun_boringssl::ServerIdentity {
        self.connection.get().server_identity(ssl)
    }

    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    #[inline]
    fn event_loop(&self) -> &'static mut crate::jsc::EventLoop {
        VirtualMachine::get().event_loop_mut()
    }

    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }
}

impl TimedConnection for JSMySQLConnection {
    fn timers(&self) -> &ConnectionTimers {
        &self.timers
    }

    fn phase(&self) -> Phase {
        use my_sql_connection::Status as S;
        match self.connection.get().status {
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
        !self.connection.get().is_idle()
    }

    fn is_processing_data(&self) -> bool {
        self.connection.get().is_processing_data()
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
        let Some(js_value) = self.js_value.get().try_get() else {
            return;
        };
        if let Some(on_retire) = js::onretire_take_cached(js_value, &self.global_object) {
            run_callback(&self.global_object, on_retire, &[]);
        }
    }
}

impl AutoFlush for JSMySQLConnection {
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    fn auto_flush_registered(&self) -> &Cell<bool> {
        &self.auto_flush_registered
    }

    fn can_flush(&self) -> bool {
        self.connection.get().can_flush()
    }

    fn on_auto_flush(&self) -> bool {
        // With backpressure, onWritable drains.
        if !self.connection.get().has_backpressure() {
            self.drain_internal();
        }
        let again = self.can_flush();
        self.auto_flush_registered.set(again);
        again
    }
}

impl JSMySQLConnection {
    /// The inner connection's methods take `&mut self`. Keep the borrow short: not across a call
    /// that re-enters JS and comes back to this connection.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    fn connection_mut(&self) -> &mut my_sql_connection::MySQLConnection {
        // SAFETY: R-2 single-JS-thread invariant (see `JsCell` docs). The
        // `&mut` is fresh per call site; reentrancy through
        // `MySQLConnection::get_js_connection()` forms a shared
        // `&JSMySQLConnection` only.
        unsafe { self.connection.get_mut() }
    }

    pub(crate) fn enqueue_request(&self, item: RefPtr<JSMySQLQuery>) {
        bun_core::scoped_log!(MySQLConnection, "enqueueRequest");
        let _entered = self.entered_from_js();
        self.connection.get().queue.add(item);
        MySQLRequestQueue::advance(self);
        self.on_queue_changed();
    }

    /// Keeps a callback's exit from draining microtasks in the middle of the calling JS frame.
    fn entered_from_js(&self) -> bun_jsc::event_loop::EventLoopEnterNoCheckpointGuard {
        self.vm().enter_event_loop_scope_without_checkpoint()
    }

    fn on_queue_changed(&self) {
        if self.retire_if_idle() {
            return;
        }
        if self.connection.get().status == my_sql_connection::Status::Connected {
            self.reset_connection_timeout();
        }
        self.update_reference_type();
        self.register_auto_flusher();
    }

    fn drain_internal(&self) {
        bun_core::scoped_log!(MySQLConnection, "drainInternal");
        let _guard = self.ref_guard();
        {
            let _loop_guard = self.event_loop().entered();
            self.ensure_js_value_is_alive();
            if let Err(my_sql_connection::FlushQueueError::AuthenticationFailed) =
                self.connection_mut().flush_queue()
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
        if let Some(value) = self.js_value.get().try_get() {
            value.ensure_still_alive();
        }
    }

    pub fn finalize(&self) {
        bun_core::scoped_log!(MySQLConnection, "finalize");
        self.js_value.with_mut(|r| r.finalize());
    }

    fn update_reference_type(&self) {
        if self.connection.get().is_active() {
            bun_core::scoped_log!(MySQLConnection, "connection is active");
            if self.js_value.get().is_not_empty() && !self.js_value.get().is_strong() {
                bun_core::scoped_log!(MySQLConnection, "strong ref until connection is closed");
                self.js_value.with_mut(|r| r.upgrade(&self.global_object));
            }
            let ctx = self.vm_ctx();
            if self.connection.get().status == my_sql_connection::Status::Connected
                && self.connection.get().is_idle()
            {
                self.poll_ref.with_mut(|p| p.unref(ctx));
            } else {
                self.poll_ref.with_mut(|p| p.r#ref(ctx));
            }
            return;
        }
        if self.js_value.get().is_not_empty() && self.js_value.get().is_strong() {
            self.js_value.with_mut(|r| r.downgrade());
        }
        let ctx = self.vm_ctx();
        self.poll_ref.with_mut(|p| p.unref(ctx));
    }

    pub(crate) fn create_instance(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let vm = global_object.bun_vm().as_mut();
        // The connection is the calling script's.
        let context = global_object.bun_vm().context_of_caller(callframe);
        let arguments = callframe.arguments();
        let Some(args) = ConnectionCtorArgs::parse(global_object, &mut *vm, arguments)? else {
            return Ok(JSValue::ZERO);
        };
        let (secure, tls_config) = (args.secure, args.tls_config);
        let check_server_identity = server_identity::callback_of(global_object, arguments[6])?;

        let username = args.username_str.to_owned_slice().into_boxed_slice();
        let password = args.password_str.to_owned_slice().into_boxed_slice();
        let database = args.database_str.to_owned_slice().into_boxed_slice();
        let path = args.path_str.to_owned_slice().into_boxed_slice();

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

        let on_connect = arguments[9];
        let on_close = arguments[10];
        let allow_public_key_retrieval = callframe.argument(15).to_boolean();
        let on_retire = callframe.argument(16);
        let found_rows = callframe.argument(17).to_boolean();

        let ptr: *mut JSMySQLConnection = bun_core::heap::into_raw(Box::new(JSMySQLConnection {
            ref_count: Cell::new(1),
            js_value: JsCell::new(JsRef::empty()),
            global_object: GlobalRef::from(global_object),
            vm: BackRef::from(
                core::ptr::NonNull::new(VirtualMachine::get_mut_ptr()).expect("vm singleton"),
            ),
            poll_ref: JsCell::new(KeepAlive::default()),
            connection: JsCell::new(my_sql_connection::MySQLConnection::init(
                database,
                username,
                password,
                tls_config,
                secure,
                args.ssl_mode,
                allow_public_key_retrieval,
                !path.is_empty(),
                found_rows,
            )),
            auto_flush_registered: Cell::new(false),
            timers: ConnectionTimers::new(
                args.idle_timeout_ms,
                args.connection_timeout_ms,
                args.max_lifetime_ms,
                EventLoopTimerTag::MySQLConnectionTimeout,
                EventLoopTimerTag::MySQLConnectionMaxLifetime,
            ),
        }));
        let this = ParentRef::from(core::ptr::NonNull::new(ptr).expect("heap::into_raw non-null"));

        {
            let hostname = args.hostname_str.to_utf8();

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
                    hostname.slice(),
                    args.port,
                    ptr,
                    false,
                )
            };
            let socket = match result {
                Ok(s) => s,
                Err(_) => {
                    // SAFETY: `ptr` is the freshly-boxed allocation; sole owner.
                    // `this` (a `ParentRef`) is not used past this point, so no
                    // borrow outlives the `heap::take` inside `deinit`.
                    unsafe { Self::deref(ptr) };
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
            this.connection_mut()
                .set_socket(AnySocket::SocketTcp(socket));
        }
        this.reset_connection_timeout();
        this.poll_ref.with_mut(|p| p.r#ref(vm.vm_ctx()));
        let js_value = js::to_js(ptr, global_object);
        js_value.ensure_still_alive();
        this.js_value
            .with_mut(|r| r.set_strong(js_value, global_object));
        js::onconnect_set_cached(js_value, global_object, on_connect);
        let column_transform = callframe.argument(19);
        if column_transform.is_callable() {
            js::column_transform_set_cached(js_value, global_object, column_transform);
        }
        js::onclose_set_cached(js_value, global_object, on_close);
        if on_retire.is_callable() {
            js::onretire_set_cached(js_value, global_object, on_retire);
        }
        // Next to `rejectUnauthorized: false` it is not asked, as in Node.
        if let Some(callback) =
            check_server_identity.filter(|_| this.connection.get().verifies_certificate())
        {
            js::check_server_identity_set_cached(js_value, global_object, callback);
        }

        Ok(js_value)
    }

    pub fn do_flush(this: &Self) {
        this.register_auto_flusher();
    }

    pub fn do_close(this: &Self, _: &mut JsScope<'_>) {
        let _entered = this.entered_from_js();
        this.fail(b"Connection closed", AnyMySQLErrorT::ConnectionClosed);
    }

    pub fn do_hold(this: &Self) {
        this.timers.set_checked_out(true);
        this.reset_connection_timeout();
    }

    pub fn do_unhold(this: &Self, _: &mut JsScope<'_>) {
        let _entered = this.entered_from_js();
        this.timers.set_checked_out(false);
        this.on_queue_changed();
    }

    pub fn get_in_transaction(&self) -> bool {
        self.connection.get().is_in_transaction()
    }

    pub(crate) fn check_server_identity_callback(&self) -> Option<JSValue> {
        self.js_value
            .get()
            .try_get()
            .and_then(js::check_server_identity_get_cached)
    }

    fn consume_on_connect_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if let Some(value) = self.js_value.get().try_get() {
            return js::onconnect_take_cached(value, global_object);
        }
        None
    }

    fn consume_on_close_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if let Some(value) = self.js_value.get().try_get() {
            return js::onclose_take_cached(value, global_object);
        }
        None
    }

    #[inline]
    pub(crate) fn is_able_to_write(&self) -> bool {
        self.connection.get().is_able_to_write()
    }
    #[inline]
    pub(crate) fn cached_statement(
        &self,
        query: &[u8],
        params: &[Value<'_>],
    ) -> Option<RefPtr<MySQLStatement>> {
        self.connection_mut().cached_statement(query, params)
    }
    #[inline]
    pub(crate) fn prepare_statement(
        &self,
        query: &[u8],
        params: &[Value<'_>],
    ) -> Result<RefPtr<MySQLStatement>, AnyMySQLErrorT> {
        self.connection_mut().prepare_statement(query, params)
    }
    /// Connecting or connected: not failed, and not closed.
    #[inline]
    pub(crate) fn is_active(&self) -> bool {
        self.connection.get().is_active()
    }
    #[inline]
    pub(crate) fn get_writer(&self) -> NewWriter<my_sql_connection::Writer> {
        self.connection_mut().writer()
    }

    pub(crate) fn fail_fmt(&self, error_code: AnyMySQLErrorT, args: core::fmt::Arguments<'_>) {
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
        if self.connection.get().status == my_sql_connection::Status::Failed {
            return;
        }
        let _guard = self.ref_guard();
        self.timers.stop();
        self.connection_mut().quit();
        self.connection_mut().status = my_sql_connection::Status::Failed;
        // Raises the socket's close event, which comes back here: no `connection_mut()` borrow is live.
        let socket = self.connection.get().socket();
        socket.close_now();
        self.connection_mut().discard_write_buffer();

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

        self.connection.get().queue.clean(value);
        self.update_reference_type();
    }

    fn fail(&self, message: &[u8], err: AnyMySQLErrorT) {
        let instance = mysql_error_to_js(&self.global_object, Some(message), err);
        self.fail_with_js_value(instance);
    }

    /// Outside the packet parser, and synchronous like `onclose` so that the two keep their order.
    fn notify_connected(&self) {
        if !self.connection_mut().take_on_connect_pending()
            || self.connection.get().status != my_sql_connection::Status::Connected
        {
            return;
        }
        self.start_max_lifetime_timer();
        let Some(on_connect) = self.consume_on_connect_callback(&self.global_object) else {
            return;
        };
        on_connect.ensure_still_alive();
        let js_value = self.js_value.get().try_get().unwrap_or(JSValue::UNDEFINED);
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

    /// Runs `transform.column.from`, user code: the caller holds no reference to the statement.
    pub(crate) fn on_column_name(
        &self,
        request: &JSMySQLQuery,
        index: usize,
    ) -> Result<(), AnyMySQLErrorT> {
        let Some(transform) = self
            .js_value
            .get()
            .try_get()
            .and_then(js::column_transform_get_cached)
        else {
            return Ok(());
        };
        let Some(column) = request
            .get_statement()
            .and_then(|statement| statement.columns.get_mut(index))
        else {
            return Ok(());
        };
        if request.is_discarding_response() {
            column.forget_name();
            return Ok(());
        }
        let renamed = column_name_to_js(&self.global_object, &column.name_or_index)
            .and_then(|name| transform_name(&self.global_object, transform, name));
        // `None` when the function closed the client.
        let column = request
            .get_statement()
            .and_then(|statement| statement.columns.get_mut(index));
        match renamed {
            Ok(renamed) => {
                if let Some(column) = column {
                    column.name_or_index = renamed;
                }
                Ok(())
            }
            Err(err) => {
                if let Some(column) = column {
                    column.forget_name();
                }
                self.on_undecodable_row(request, crate::jsc::js_error_to_mysql(err))
            }
        }
    }

    pub(crate) fn on_result_row(
        &self,
        request: &JSMySQLQuery,
        statement: &mut MySQLStatement,
        reader: PacketReader<'_>,
    ) -> Result<(), AnyMySQLErrorT> {
        if request.is_discarding_response() {
            return Ok(());
        }
        let result_mode = request.get_result_mode();
        let mut structure: JSValue = JSValue::UNDEFINED;
        // `structure()` borrows `*statement` mutably for as long as its result lives, and the
        // columns are read below: hence the lifetime-erased `ParentRef`. The caller's ref keeps
        // the statement alive.
        let cached_structure: Option<ParentRef<CachedStructure>> = match result_mode {
            ResultMode::Objects => {
                // Build unconditionally (matches postgres) so toJS always has
                // either a Structure or a names array.
                let owner = self.js_value.get().try_get().unwrap_or_default();
                let cs = statement.structure(owner, &self.global_object);
                structure = cs.js_value().unwrap_or(JSValue::UNDEFINED);
                Some(ParentRef::new(cs))
            }
            // no need to check for duplicate fields or structure
            ResultMode::Raw | ResultMode::Values => None,
        };
        let fields_flags = statement.fields_flags;
        let mut row = ResultSet::Row {
            global_object: &self.global_object,
            columns: &statement.columns,
            binary: !request.is_simple(),
            raw: result_mode == ResultMode::Raw,
            bigint: request.is_bigint_supported(),
            values: Box::default(),
        };
        if let Err(e) = row.decode(reader) {
            return self.on_undecodable_row(request, e);
        }
        let pending_value = request.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        let cached_structure = cached_structure.as_deref();
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
        // `Row<'_>` has a Drop impl, so its `&statement.columns` borrow lives to
        // end-of-scope; drop it now so `statement.result_count += 1` may take `&mut`.
        drop(row);
        statement.result_count += 1;

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

    pub(crate) fn on_error_packet(&self, request: Option<&JSMySQLQuery>, err: &ErrorPacket) {
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
        this.connection_mut().set_socket(socket);

        if is_tcp {
            // This handshake is not TLS handleshake is actually the MySQL handshake
            // When a connection is upgraded to TLS, the onOpen callback is called again and at this moment we dont wanna to change the status to handshaking
            this.connection_mut().status = my_sql_connection::Status::Handshaking;
            this.ref_(); // keep a ref for the socket
            // The bound on a query whose peer is gone: no timer runs while one is in flight.
            if !this.connection.get().is_unix_socket() {
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
        if success == 1 && !this.connection.get().awaits_tls_handshake() {
            return;
        }
        if !this.connection_mut().do_handshake(success, ssl_error) {
            let v = crate::jsc::verify_error_to_js(&ssl_error, &this.global_object);
            return this.fail_with_js_value(v);
        }
        if let Some(callback) = this.check_server_identity_callback() {
            // It can close this connection.
            let _guard = this.ref_guard();
            let socket = this.connection.get().socket();
            let hostname = this.connection.get().server_name();
            if let Err(reason) =
                server_identity::check(&this.global_object, callback, &socket, hostname)
            {
                return this.fail_with_js_value(reason);
            }
            if this.connection.get().status != my_sql_connection::Status::Authenticating {
                return;
            }
        }
        if let Err(e) = this.connection_mut().send_handshake_response() {
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
        // Takes over the socket ref taken in on_open.
        // SAFETY: `this` is live and that ref is outstanding.
        let _guard = unsafe { RefPtr::from_raw(this.as_ctx_ptr()) };
        // usockets frees this socket at end-of-tick; drop the stored pointer
        // now so nothing (timer callbacks, do_close) dereferences it after
        // the free.
        this.connection_mut()
            .set_socket(AnySocket::SocketTcp(SocketTCP::detached()));
        if this.connection.get().status == my_sql_connection::Status::Failed {
            return;
        }
        // A close before the handshake finished means the server (or an
        // intermediary like a container port proxy) accepted the TCP
        // connection but went away before completing startup — e.g. the
        // database is still initializing. Report it as a connect failure
        // (the connection was never established) rather than a closed
        // connection so the error is actionable.
        use my_sql_connection::Status as S;
        let (message, err): (&'static [u8], AnyMySQLErrorT) = match this.connection.get().status {
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
        this.connection_mut()
            .set_socket(AnySocket::SocketTcp(SocketTCP::detached()));
        this.fail(b"Failed to connect", AnyMySQLErrorT::ConnectionRefused);
    }

    pub fn on_timeout(_: &JSMySQLConnection, _: NewSocketHandler<SSL>) {}

    pub fn on_data(this: &JSMySQLConnection, _: NewSocketHandler<SSL>, data: &[u8]) {
        let _guard = this.ref_guard();
        {
            let _loop_guard = this.event_loop().entered();
            this.ensure_js_value_is_alive();

            if let Err(e) = this.connection_mut().read_and_process_data(data) {
                this.on_error(None, e);
            }
            this.notify_connected();
            this.retire_if_idle();
        }
        this.on_queue_changed();
    }

    pub fn on_writable(this: &JSMySQLConnection, _: NewSocketHandler<SSL>) {
        this.connection_mut().reset_backpressure();
        this.drain_internal();
    }
}

use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode as ResultMode;
