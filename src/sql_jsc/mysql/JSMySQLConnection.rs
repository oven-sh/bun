use core::cell::Cell;
use core::ffi::c_void;

use crate::jsc::{
    AutoFlushTarget, AutoFlusher, CallFrame, EventLoopTimer, EventLoopTimerState,
    EventLoopTimerTag, GlobalRef, JSGlobalObject, JSValue, JsCell, JsRef, JsResult, KeepAlive,
    TimerRef, VirtualMachine, VirtualMachineSqlExt as _, codegen::js_mysql_connection as js,
};
use crate::shared::CachedStructure;
use crate::shared::connection_ctor_args::ConnectionCtorArgs;
use bun_core::strings;
use bun_core::{TimespecMockMode, timespec};
use bun_ptr::{BackRef, RefPtr, ThisPtr};
use bun_sql::mysql::MySQLQueryResult;
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLErrorT;
use bun_sql::mysql::protocol::error_packet::ErrorPacket;
use bun_sql::mysql::protocol::new_reader::NewReader;
use bun_sql::mysql::protocol::new_writer::NewWriter;
use bun_sql::mysql::ssl_mode::SSLMode;
use bun_uws::{self as uws, AnySocket, NewSocketHandler, SocketTCP};

use super::js_mysql_query::JSMySQLQuery;
use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
use crate::mysql::protocol::error_packet_jsc::ErrorPacketJsc;
// `my_sql_connection::MySQLConnection` (the protocol-layer struct)
// is intentionally NOT imported by name — that ident is taken in this module's
// value namespace by the `declare_scope!` static and in the type namespace by
// the `pub use JSMySQLConnection as MySQLConnection` re-export below.
use super::my_sql_connection::{self as my_sql_connection};
use super::my_sql_statement::MySQLStatement;
use super::protocol::result_set::{self as ResultSet};

bun_core::declare_scope!(MySQLConnection, visible);

// The #[bun_jsc::JsClass] proc-macro is not applied because this type
// already has its `to_js`/`from_js` wired through `crate::jsc::codegen::
// js_mysql_connection` (which owns the extern symbols) — the hand-rolled
// `impl crate::jsc::JsClass` below forwards to those. `crate::jsc` re-exports
// `bun_jsc::{JSGlobalObject, CallFrame, JSValue}`, so the types are identical;
// switching to the derive is a mechanical follow-up, not a layering blocker.
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut JSMySQLConnection` — `&mut T` auto-derefs
// to `&T` so the impls below compile against either.
// `JsCell` is `#[repr(transparent)]`, so `from_field_ptr!` recovery
// (`from_timer_ptr` / `MySQLConnection::get_js_connection`) sees identical
// offsets.
#[derive(bun_ptr::CellRefCounted)]
pub struct JSMySQLConnection {
    // Intrusive refcount (`CellRefCounted`); the last release runs `Drop`.
    ref_count: Cell<u32>,
    js_value: JsCell<JsRef>,
    // LIFETIMES.tsv: JSC_BORROW — assigned from createInstance param; never freed
    global_object: GlobalRef,
    // LIFETIMES.tsv: STATIC — globalObject.bunVM() singleton. `BackRef` so the
    // hot `vm()` deref is safe; `vm_mut()` routes through the canonical
    // `VirtualMachine::as_mut()` accessor.
    vm: BackRef<VirtualMachine>,
    poll_ref: JsCell<KeepAlive>,

    // pub(crate): MySQLRequestQueue::advance reaches `connection.get().queue`
    // via `&JSMySQLConnection`; the inner protocol struct's
    // `js_connection_ref()` recovers the embedding via `from_field_ptr!`
    // (offset unchanged — `JsCell` is transparent).
    pub(crate) connection: JsCell<my_sql_connection::MySQLConnection>,

    pub(crate) auto_flusher: AutoFlusher<JSMySQLConnection>,

    pub(crate) idle_timeout_interval_ms: u32,
    pub(crate) connection_timeout_ms: u32,
    /// Before being connected, this is a connection timeout timer.
    /// After being connected, this is an idle timeout timer.
    // Intrusive heap node; `bun_runtime::dispatch` recovers `Self` from it by
    // `offset_of!` (`JsCell` is `#[repr(transparent)]`).
    pub timer: JsCell<EventLoopTimer>,

    /// This timer controls the maximum lifetime of a connection.
    /// It starts when the connection successfully starts (i.e. after handshake is complete).
    /// It stops when the connection is closed.
    pub(crate) max_lifetime_interval_ms: u32,
    // See `timer`.
    pub max_lifetime_timer: JsCell<EventLoopTimer>,
    /// This allocation's root pointer, for the `&self` paths that take refs on
    /// it (`ref_guard`, the socket ext slot, the auto-flush registration).
    this_ptr: Cell<Option<BackRef<JSMySQLConnection, bun_ptr::Root>>>,
    /// The ref held for the socket whose ext slot points here: taken by the
    /// TCP `on_open`, released by `on_close`.
    socket_ref: Cell<Option<RefPtr<JSMySQLConnection>>>,
}

bun_event_loop::impl_timer_owner!(JSMySQLConnection;
    from_timer_ptr => timer,
    from_max_lifetime_timer_ptr => max_lifetime_timer,
);

bun_jsc::impl_js_class_via_generated!(JSMySQLConnection => crate::jsc::codegen::js_mysql_connection);

impl JSMySQLConnection {
    /// This allocation's root pointer (see the `this_ptr` field).
    #[inline]
    pub(crate) fn this_ptr(&self) -> ThisPtr<Self> {
        self.this_ptr
            .get()
            .expect("JSMySQLConnection used before create_instance")
            .this_ptr()
    }

    /// Takes a ref on `self` now and releases it on drop (which may free
    /// `self`).
    #[inline]
    fn ref_guard(&self) -> RefPtr<Self> {
        RefPtr::from_this(self.this_ptr())
    }

    #[inline]
    fn timer_ref(&self) -> TimerRef {
        TimerRef::new(self, |c| &c.timer)
    }

    #[inline]
    fn max_lifetime_timer_ref(&self) -> TimerRef {
        TimerRef::new(self, |c| &c.max_lifetime_timer)
    }

    /// Shared borrow of the JS-thread `VirtualMachine` singleton stored in this
    /// connection. Safe `Deref` via [`BackRef`] — the VM strictly outlives
    /// every connection it creates (process-lifetime singleton).
    #[inline]
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }
    /// `&mut EventLoop` for `run_callback`; the loop is owned by the JS-thread
    /// VM singleton (see `VirtualMachine::event_loop_mut`).
    #[inline]
    fn event_loop(&self) -> &mut crate::jsc::EventLoop {
        self.vm().event_loop_mut()
    }

    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }
}

impl AutoFlushTarget for JSMySQLConnection {
    fn auto_flusher(&self) -> &AutoFlusher<Self> {
        &self.auto_flusher
    }

    /// Whether to stay registered for the next drain.
    fn on_auto_flush(this: ThisPtr<Self>) -> bool {
        bun_core::scoped_log!(MySQLConnection, "onAutoFlush");
        if this.connection.get().has_backpressure() {
            // if we have backpressure, wait for onWritable
            return false;
        }

        // drain as much as we can
        this.drain_internal();

        // if we dont have backpressure and if we still have data to send, return true otherwise return false and wait for onWritable
        this.connection.get().can_flush()
    }
}

impl JSMySQLConnection {
    // ─── R-2 interior-mutability helpers ────────────────────────────────────

    /// Run `f` against the inner protocol connection.
    ///
    /// `my_sql_connection::MySQLConnection` is the protocol state machine (not
    /// itself JS-exposed); every method on it still takes `&mut self`, reached
    /// through this closure-scoped [`JsCell::with_mut`].
    #[inline]
    fn with_connection<R>(
        &self,
        f: impl FnOnce(&mut my_sql_connection::MySQLConnection) -> R,
    ) -> R {
        self.connection.with_mut(f)
    }

    // ────────────────────────────────────────────────────────────────────────

    fn register_auto_flusher(&self) {
        if !self.auto_flusher.is_registered() // should not be registered
            && self.connection.get().can_flush()
        {
            AutoFlusher::register(self.this_ptr(), self.vm());
        }
    }

    fn unregister_auto_flusher(&self) {
        self.auto_flusher.unregister(self.vm());
    }

    fn stop_timers(&self) {
        bun_core::scoped_log!(MySQLConnection, "stopTimers");
        if self.timer.get().state == EventLoopTimerState::ACTIVE {
            self.vm().timer_remove(self.timer_ref());
        }
        if self.max_lifetime_timer.get().state == EventLoopTimerState::ACTIVE {
            self.vm().timer_remove(self.max_lifetime_timer_ref());
        }
    }

    fn get_timeout_interval(&self) -> u32 {
        match self.connection.get().status {
            my_sql_connection::Status::Connected => {
                if self.connection.get().is_idle() {
                    return self.idle_timeout_interval_ms;
                }
                0
            }
            my_sql_connection::Status::Failed => 0,
            _ => self.connection_timeout_ms,
        }
    }

    pub(crate) fn reset_connection_timeout(&self) {
        let interval = self.get_timeout_interval();
        bun_core::scoped_log!(MySQLConnection, "resetConnectionTimeout {}", interval);
        if self.timer.get().state == EventLoopTimerState::ACTIVE {
            self.vm().timer_remove(self.timer_ref());
        }
        if self.connection.get().status == my_sql_connection::Status::Failed
            || self.connection.get().is_processing_data()
            || interval == 0
        {
            return;
        }

        self.timer.with_mut(|t| {
            t.next = timespec::ms_from_now(TimespecMockMode::ForceRealTime, interval.into());
        });
        self.vm().timer_insert(self.timer_ref());
    }

    pub fn on_connection_timeout(&self) {
        self.timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);

        if self.connection.get().is_processing_data() {
            return;
        }

        if self.connection.get().status == my_sql_connection::Status::Failed {
            return;
        }

        if self.get_timeout_interval() == 0 {
            self.reset_connection_timeout();
            return;
        }

        use bun_core::fmt::{ConnTimeoutKind::*, fmt_conn_timeout};
        use my_sql_connection::Status as S;
        let (code, kind, ms, sfx) = match self.connection.get().status {
            S::Connected => (
                AnyMySQLErrorT::IdleTimeout,
                Idle,
                self.idle_timeout_interval_ms,
                "",
            ),
            S::Connecting => (
                AnyMySQLErrorT::ConnectionTimedOut,
                Connection,
                self.connection_timeout_ms,
                "",
            ),
            S::Handshaking | S::Authenticating | S::AuthenticationAwaitingPk => (
                AnyMySQLErrorT::ConnectionTimedOut,
                Connection,
                self.connection_timeout_ms,
                " (during authentication)",
            ),
            S::SessionSetup => (
                AnyMySQLErrorT::ConnectionTimedOut,
                Connection,
                self.connection_timeout_ms,
                " (during session setup)",
            ),
            S::Disconnected | S::Failed => return,
        };
        self.fail_fmt(code, format_args!("{}", fmt_conn_timeout(kind, ms, sfx)));
    }

    pub fn on_max_lifetime_timeout(&self) {
        self.max_lifetime_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        if self.connection.get().status == my_sql_connection::Status::Failed {
            return;
        }
        use bun_core::fmt::{ConnTimeoutKind, fmt_conn_timeout};
        self.fail_fmt(
            AnyMySQLErrorT::LifetimeTimeout,
            format_args!(
                "{}",
                fmt_conn_timeout(
                    ConnTimeoutKind::MaxLifetime,
                    self.max_lifetime_interval_ms,
                    ""
                )
            ),
        );
    }

    fn setup_max_lifetime_timer_if_necessary(&self) {
        if self.max_lifetime_interval_ms == 0 {
            return;
        }
        if self.max_lifetime_timer.get().state == EventLoopTimerState::ACTIVE {
            return;
        }

        self.max_lifetime_timer.with_mut(|t| {
            t.next = timespec::ms_from_now(
                TimespecMockMode::ForceRealTime,
                self.max_lifetime_interval_ms.into(),
            );
        });
        self.vm().timer_insert(self.max_lifetime_timer_ref());
    }

    // Exported via the `.classes.ts` codegen (`MySQLConnectionClass__construct`).
    pub fn constructor(
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut Self> {
        Err(global_object.throw(format_args!(
            "MySQLConnection cannot be constructed directly"
        )))
    }

    pub(crate) fn enqueue_request(&self, item: ThisPtr<JSMySQLQuery>) {
        bun_core::scoped_log!(MySQLConnection, "enqueueRequest");
        self.with_connection(|c| c.enqueue_request(item));
        self.reset_connection_timeout();
        self.register_auto_flusher();
    }

    fn drain_internal(&self) {
        bun_core::scoped_log!(MySQLConnection, "drainInternal");
        // Raw-pointer RAII guard so no reference is live across the potential
        // free.
        let _ref = self.ref_guard();
        let _loop_guard = self.vm().enter_event_loop_scope();
        self.ensure_js_value_is_alive();
        if let Err(my_sql_connection::FlushQueueError::AuthenticationFailed) =
            self.with_connection(|c| c.flush_queue())
        {
            self.fail(
                b"Authentication failed",
                AnyMySQLErrorT::AuthenticationFailed,
            );
            return;
        }
    }

    fn ensure_js_value_is_alive(&self) {
        if let Some(value) = self.js_value.get().try_get() {
            value.ensure_still_alive();
        }
    }

    /// Runs before the JS wrapper's ref is dropped.
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

    // — same proc-macro limitation as `constructor` above.
    pub(crate) fn create_instance(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // `bun_vm()` → `&'static VirtualMachine` (per-thread singleton); `as_mut()`
        // is the canonical safe escape hatch for `mysql_socket_group()`.
        let vm = global_object.bun_vm().as_mut();
        let arguments = callframe.arguments();
        let Some(args) = ConnectionCtorArgs::<SSLMode>::parse(global_object, vm, arguments)? else {
            return Ok(JSValue::ZERO);
        };
        // `secure` / `tls_config` are dropped with `args` on every early return
        // until they move into the connection below.

        let path_str = arguments[8].to_bun_string(global_object)?;

        let username = args.username_str.to_owned_slice().into_boxed_slice();
        let password = args.password_str.to_owned_slice().into_boxed_slice();
        let database = args.database_str.to_owned_slice().into_boxed_slice();
        let path = path_str.to_owned_slice().into_boxed_slice();

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
        let idle_timeout = arguments[11].to_int32();
        let connection_timeout = arguments[12].to_int32();
        let max_lifetime = arguments[13].to_int32();
        let use_unnamed_prepared_statements = arguments[14].as_boolean();
        // MySQL doesn't support unnamed prepared statements
        let _ = use_unnamed_prepared_statements;
        let allow_public_key_retrieval = callframe.argument(15).to_boolean();

        let (secure, tls_config) = (args.secure, args.tls_config);

        // The initial ref is the one the JS wrapper adopts below (or that the
        // connect-failure path releases).
        let initial: RefPtr<JSMySQLConnection> = RefPtr::new(JSMySQLConnection {
            ref_count: Cell::new(1),
            js_value: JsCell::new(JsRef::empty()),
            global_object: GlobalRef::from(global_object),
            vm: BackRef::new(global_object.bun_vm()),
            poll_ref: JsCell::new(KeepAlive::default()),
            connection: JsCell::new(my_sql_connection::MySQLConnection::init(
                database,
                username,
                password,
                tls_config,
                secure,
                args.ssl_mode,
                allow_public_key_retrieval,
            )),
            auto_flusher: AutoFlusher::default(),
            idle_timeout_interval_ms: u32::try_from(idle_timeout).expect("int cast"),
            connection_timeout_ms: u32::try_from(connection_timeout).expect("int cast"),
            max_lifetime_interval_ms: u32::try_from(max_lifetime).expect("int cast"),
            timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::MySQLConnectionTimeout,
            )),
            max_lifetime_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::MySQLConnectionMaxLifetime,
            )),
            this_ptr: Cell::new(None),
            socket_ref: Cell::new(None),
        });
        initial.this_ptr.set(Some(initial.this_ptr().into()));
        let this: ThisPtr<JSMySQLConnection> = initial.this_ptr();

        {
            let hostname = args.hostname_str.to_utf8();

            // MySQL always opens plain TCP first; STARTTLS adopts into the TLS
            // group after the SSLRequest exchange.
            let group = vm.mysql_socket_group::<false>();
            let result = if !path.is_empty() {
                SocketTCP::connect_unix_group(
                    group,
                    uws::DispatchKind::Mysql,
                    None,
                    &path[..],
                    this.as_ptr(),
                    false,
                )
            } else {
                SocketTCP::connect_group(
                    group,
                    uws::DispatchKind::Mysql,
                    None,
                    hostname.slice(),
                    args.port,
                    this.as_ptr(),
                    false,
                )
            };
            let socket = match result {
                Ok(s) => s,
                Err(e) => {
                    // Sole owner: releasing the initial ref frees the connection.
                    drop(initial);
                    return Err(global_object
                        .throw_error(bun_jsc::CrateError::from(e), "failed to connect to mysql"));
                }
            };
            this.with_connection(|c| c.set_socket(AnySocket::SocketTcp(socket)));
        }
        this.with_connection(|c| c.status = my_sql_connection::Status::Connecting);
        this.reset_connection_timeout();
        this.poll_ref.with_mut(|p| p.r#ref(vm.vm_ctx()));
        // The JS wrapper adopts the initial ref (released by `finalize`).
        let js_value = js::to_js(initial.into_this_ptr().as_ptr(), global_object);
        js_value.ensure_still_alive();
        this.js_value
            .with_mut(|r| r.set_strong(js_value, global_object));
        js::onconnect_set_cached(js_value, global_object, on_connect);
        js::onclose_set_cached(js_value, global_object, on_close);

        Ok(js_value)
    }

    bun_jsc::cached_prop_hostfns! {
        crate::jsc::codegen::js_mysql_connection;
        lazy_array(get_queries => queries_get_cached, queries_set_cached),
        (get_on_connect, set_on_connect => onconnect_get_cached, onconnect_set_cached),
        (get_on_close,   set_on_close   => onclose_get_cached, onclose_set_cached),
    }

    bun_jsc::poll_ref_hostfns!(field = poll_ref, ctx = vm_ctx);

    pub fn get_connected(this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(this.connection.get().status == my_sql_connection::Status::Connected)
    }

    pub fn do_flush(this: &Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.register_auto_flusher();
        Ok(JSValue::UNDEFINED)
    }

    pub fn do_close(
        this: &Self,
        _global_object: &JSGlobalObject,
        _: &CallFrame,
    ) -> JsResult<JSValue> {
        this.stop_timers();

        // `&Self` is `Copy`, so the scopeguard closure captures a shared
        // reborrow and the body's `with_connection()` borrow is non-overlapping.
        scopeguard::defer! {
            this.update_reference_type();
        }
        use my_sql_connection::Status as S;
        match this.connection.get().status {
            // A close while the connect/handshake is still in flight gets no
            // socket event (uws skips the on_close dispatch for sockets whose
            // connect never completed), so the socket-close -> on_close ->
            // fail chain never runs: fail directly so the JS onclose callback
            // fires and the status goes terminal instead of staying
            // Connecting forever.
            S::Connecting
            | S::Handshaking
            | S::Authenticating
            | S::AuthenticationAwaitingPk
            | S::SessionSetup => {
                this.fail(b"Connection closed", AnyMySQLErrorT::ConnectionClosed);
            }
            S::Connected | S::Disconnected | S::Failed => {
                let queries = this.get_queries_array();
                this.with_connection(|c| c.clean_queue_and_close(None, queries));
            }
        }
        Ok(JSValue::UNDEFINED)
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

    pub(crate) fn get_queries_array(&self) -> JSValue {
        if let Some(value) = self.js_value.get().try_get() {
            return js::queries_get_cached(value).unwrap_or(JSValue::UNDEFINED);
        }
        JSValue::UNDEFINED
    }

    #[inline]
    pub(crate) fn is_able_to_write(&self) -> bool {
        self.connection.get().is_able_to_write()
    }
    #[inline]
    pub(crate) fn can_pipeline(&self) -> bool {
        self.connection.get().queue.can_pipeline(self)
    }
    #[inline]
    pub(crate) fn can_prepare_query(&self) -> bool {
        self.connection.get().queue.can_prepare_query(self)
    }
    #[inline]
    pub(crate) fn can_execute_query(&self) -> bool {
        self.connection.get().queue.can_execute_query(self)
    }
    #[inline]
    pub(crate) fn get_writer(&self) -> NewWriter<my_sql_connection::Writer> {
        self.connection.get().writer()
    }

    fn fail_fmt(&self, error_code: AnyMySQLErrorT, args: core::fmt::Arguments<'_>) {
        let mut message: Vec<u8> = Vec::new();
        {
            use std::io::Write;
            let _ = write!(&mut message, "{}", args);
        }

        let err = mysql_error_to_js(&self.global_object, &message, error_code);
        self.fail_with_js_value(err);
    }

    fn fail_with_js_value(&self, value: JSValue) {
        // Runs on every exit path. LIFO drop order: the `defer!` body runs
        // first, then `_ref` releases the count (which may free `self`).
        let _ref = self.ref_guard();
        scopeguard::defer! {
            let queries = self.get_queries_array();
            self.with_connection(|c| c.clean_queue_and_close(Some(value), queries));
            self.update_reference_type();
        }
        self.stop_timers();

        if self.connection.get().status == my_sql_connection::Status::Failed {
            return;
        }

        self.with_connection(|c| c.status = my_sql_connection::Status::Failed);
        let Some(on_close) = self.consume_on_close_callback(&self.global_object) else {
            return;
        };
        on_close.ensure_still_alive();
        let loop_ = self.event_loop();
        self.ensure_js_value_is_alive();
        let mut js_error = value.to_error().unwrap_or(value);
        if js_error.is_empty() {
            js_error = mysql_error_to_js(
                &self.global_object,
                b"Connection closed",
                AnyMySQLErrorT::ConnectionClosed,
            );
        }
        js_error.ensure_still_alive();

        let queries_array = self.get_queries_array();
        queries_array.ensure_still_alive();
        // self.global_object.queue_microtask(on_close, &[js_error, queries_array]);
        loop_.run_callback(
            on_close,
            &self.global_object,
            JSValue::UNDEFINED,
            &[js_error, queries_array],
        );
    }

    fn fail(&self, message: &[u8], err: AnyMySQLErrorT) {
        let instance = mysql_error_to_js(&self.global_object, message, err);
        self.fail_with_js_value(instance);
    }

    pub(crate) fn on_connection_estabilished(&self) {
        let Some(on_connect) = self.consume_on_connect_callback(&self.global_object) else {
            return;
        };
        on_connect.ensure_still_alive();
        let js_value = self.js_value.get().try_get().unwrap_or(JSValue::UNDEFINED);
        js_value.ensure_still_alive();
        self.global_object
            .queue_microtask(on_connect, &[JSValue::NULL, js_value]);
    }

    pub(crate) fn on_query_result(&self, request: &JSMySQLQuery, result: &MySQLQueryResult) {
        request.resolve(self.get_queries_array(), result);
    }

    pub(crate) fn on_result_row<C: bun_sql::mysql::protocol::ReaderContext>(
        &self,
        request: &JSMySQLQuery,
        statement: &MySQLStatement,
        reader: NewReader<C>,
    ) -> Result<(), OnResultRowError> {
        let result_mode = request.get_result_mode();
        let mut structure: JSValue = JSValue::UNDEFINED;
        let cached_structure: Option<&CachedStructure> = match result_mode {
            ResultMode::Objects => {
                // Build unconditionally (matches postgres) so toJS always has
                // either a Structure or a names array.
                let owner = self.js_value.get().try_get().unwrap_or_default();
                let cs = statement.structure(owner, &self.global_object);
                structure = cs.js_value().unwrap_or(JSValue::UNDEFINED);
                Some(cs)
            }
            // no need to check for duplicate fields or structure
            ResultMode::Raw | ResultMode::Values => None,
        };
        let fields_flags = statement.fields_flags.get();
        let columns = statement.columns.get();
        let mut row = ResultSet::Row {
            global_object: &self.global_object,
            columns,
            binary: !request.is_simple(),
            raw: result_mode == ResultMode::Raw,
            bigint: request.is_bigint_supported(),
            values: Box::default(),
            storage: Default::default(),
        };
        if let Err(e) = row.decode(reader) {
            if e == AnyMySQLErrorT::ShortRead {
                return Err(OnResultRowError::ShortRead);
            }
            self.connection
                .get()
                .queue
                .mark_current_request_as_finished(request);
            request.reject(self.get_queries_array(), e);
            return Ok(());
        }
        let pending_value = request.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        // Process row data
        let row_value = row
            .to_js(
                &self.global_object,
                pending_value,
                structure,
                fields_flags,
                result_mode,
                cached_structure,
            )
            .map_err(|_| OnResultRowError::JSError)?;
        drop(row);
        if let Some(err) = self.global_object.try_take_exception() {
            self.connection
                .get()
                .queue
                .mark_current_request_as_finished(request);
            request.reject_with_js_value(self.get_queries_array(), err);
            return Ok(());
        }
        statement.result_count.set(statement.result_count.get() + 1);

        if pending_value.is_empty_or_undefined_or_null() {
            request.set_pending_value(row_value);
        }
        Ok(())
    }

    pub(crate) fn on_error(&self, request: Option<&JSMySQLQuery>, err: AnyMySQLErrorT) {
        if let Some(request) = request {
            if let Some(err_) = self.global_object.try_take_exception() {
                request.reject_with_js_value(self.get_queries_array(), err_);
            } else {
                request.reject(self.get_queries_array(), err);
            }
        } else {
            if let Some(err_) = self.global_object.try_take_exception() {
                self.fail_with_js_value(err_);
            } else {
                let message: &[u8] = match err {
                    AnyMySQLErrorT::PublicKeyRetrievalNotAllowed => {
                        b"The server requested RSA public key retrieval to complete \
                          authentication, which is not allowed over an insecure connection. \
                          Enable TLS or set allowPublicKeyRetrieval: true"
                    }
                    _ => b"Connection closed",
                };
                self.fail(message, err);
            }
        }
    }

    pub(crate) fn on_error_packet(&self, request: Option<&JSMySQLQuery>, err: &ErrorPacket) {
        if let Some(request) = request {
            if let Some(err_) = self.global_object.try_take_exception() {
                request.reject_with_js_value(self.get_queries_array(), err_);
            } else {
                request
                    .reject_with_js_value(self.get_queries_array(), err.to_js(&self.global_object));
            }
        } else {
            if let Some(err_) = self.global_object.try_take_exception() {
                self.fail_with_js_value(err_);
            } else {
                self.fail_with_js_value(err.to_js(&self.global_object));
            }
        }
    }

    /// The cached statement for `signature` plus `true` (a new ref; the
    /// signature is dropped), or a fresh `Pending` statement built from it that
    /// the connection's map now also references plus `false`.
    pub(crate) fn statement_for_signature(
        &self,
        signature: crate::mysql::protocol::Signature,
    ) -> Result<(RefPtr<MySQLStatement>, bool), bun_core::AllocError> {
        self.with_connection(|c| {
            let entry = c.statements.get_or_put(&signature.name)?;
            if entry.found_existing {
                let existing = entry
                    .value_ptr
                    .as_ref()
                    .expect("cached statement slots are always filled");
                return Ok((existing.clone(), true));
            }
            // One ref for the caller, one for the map entry.
            let stmt = MySQLStatement::new(signature, super::my_sql_statement::Status::Pending);
            *entry.value_ptr = Some(stmt.clone());
            Ok((stmt, false))
        })
    }
}

/// Runs when the last ref is released (`CellRefCounted` reclaims the box).
impl Drop for JSMySQLConnection {
    fn drop(&mut self) {
        // No refs remain; nothing below may mint one.
        self.this_ptr.set(None);
        self.stop_timers();
        let ctx = self.vm_ctx();
        self.poll_ref.with_mut(|p| p.unref(ctx));
        self.unregister_auto_flusher();
        self.connection.get_mut_unique().cleanup();
    }
}

/// uSockets event handlers for the MySQL connection (plain and TLS).
pub struct SocketHandler<const SSL: bool>;

// Inherent associated types are unstable in Rust
// (`feature(inherent_associated_types)`), so spell out
// `NewSocketHandler<SSL>` at every use site instead.
impl<const SSL: bool> SocketHandler<SSL> {
    fn socket(s: NewSocketHandler<SSL>) -> AnySocket {
        if SSL {
            AnySocket::SocketTls(s.assume_ssl())
        } else {
            AnySocket::SocketTcp(s.assume_tcp())
        }
    }

    pub fn on_open(this: ThisPtr<JSMySQLConnection>, s: NewSocketHandler<SSL>) {
        let socket = Self::socket(s);
        let is_tcp = matches!(socket, AnySocket::SocketTcp(_));
        this.with_connection(|c| c.set_socket(socket));

        if is_tcp {
            // This handshake is not TLS handleshake is actually the MySQL handshake
            // When a connection is upgraded to TLS, the onOpen callback is called again and at this moment we dont wanna to change the status to handshaking
            this.with_connection(|c| c.status = my_sql_connection::Status::Handshaking);
            // keep a ref for the socket
            this.socket_ref.set(Some(RefPtr::from_this(this)));
        }
        // Only set up the timers after all status changes are complete — the timers rely on the status to determine timeouts.
        this.setup_max_lifetime_timer_if_necessary();
        this.reset_connection_timeout();
        this.update_reference_type();
    }

    fn on_handshake(
        this: ThisPtr<JSMySQLConnection>,
        _: NewSocketHandler<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        let handshake_was_successful =
            match this.with_connection(|c| c.do_handshake(success, ssl_error)) {
                Ok(v) => v,
                Err(e) => {
                    return this.fail_fmt(e, format_args!("Failed to send handshake response"));
                }
            };
        if !handshake_was_successful {
            let v = crate::jsc::verify_error_to_js(&ssl_error, &this.global_object);
            this.fail_with_js_value(v);
        }
    }

    pub const ON_HANDSHAKE: Option<
        fn(ThisPtr<JSMySQLConnection>, NewSocketHandler<SSL>, i32, uws::us_bun_verify_error_t),
    > = if SSL { Some(Self::on_handshake) } else { None };

    pub fn on_close(
        this: ThisPtr<JSMySQLConnection>,
        _: NewSocketHandler<SSL>,
        _: i32,
        _: Option<*mut c_void>,
    ) {
        // Releases the socket ref taken in on_open at scope end (which may
        // free the connection).
        let _ref = this.socket_ref.take();
        // usockets frees this socket at end-of-tick; drop the stored pointer
        // now so nothing (timer callbacks, do_close) dereferences it after
        // the free.
        this.with_connection(|c| c.set_socket(AnySocket::SocketTcp(SocketTCP::detached())));
        // Nothing left to flush to.
        this.unregister_auto_flusher();
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
            S::Connected | S::Disconnected | S::Failed => {
                (b"Connection closed", AnyMySQLErrorT::ConnectionClosed)
            }
        };
        this.fail(message, err);
    }

    pub fn on_end(_: ThisPtr<JSMySQLConnection>, socket: NewSocketHandler<SSL>) {
        // no half closed sockets
        socket.close(uws::CloseKind::Normal);
    }

    pub fn on_connect_error(this: ThisPtr<JSMySQLConnection>, _: NewSocketHandler<SSL>, _: i32) {
        // The dispatch trampoline already closed the connecting socket; it is
        // freed at end-of-tick, so detach before any user-visible callback.
        this.with_connection(|c| c.set_socket(AnySocket::SocketTcp(SocketTCP::detached())));
        this.fail(b"Failed to connect", AnyMySQLErrorT::ConnectionRefused);
    }

    pub fn on_timeout(this: ThisPtr<JSMySQLConnection>, _: NewSocketHandler<SSL>) {
        this.fail(b"Connection timeout", AnyMySQLErrorT::ConnectionTimedOut);
    }

    pub fn on_data(this: ThisPtr<JSMySQLConnection>, _: NewSocketHandler<SSL>, data: &[u8]) {
        // Guard drop order is LIFO, so `_ref` (deref, which may free the
        // connection) runs last.
        let _ref = this.ref_guard();

        scopeguard::defer! {
            if this.connection.get().status == my_sql_connection::Status::Connected {
                this.reset_connection_timeout();
            }
            this.update_reference_type();
            this.register_auto_flusher();
        }
        let _loop_guard = this.vm().enter_event_loop_scope();
        this.ensure_js_value_is_alive();

        if let Err(e) = this.with_connection(|c| c.read_and_process_data(data)) {
            this.on_error(None, e);
        }
    }

    pub fn on_writable(this: ThisPtr<JSMySQLConnection>, _: NewSocketHandler<SSL>) {
        this.with_connection(|c| c.reset_backpressure());
        this.drain_internal();
    }
}

#[derive(strum::IntoStaticStr, Debug)]
pub enum OnResultRowError {
    ShortRead,
    JSError,
}
bun_core::impl_tag_error!(OnResultRowError);
impl From<OnResultRowError> for AnyMySQLErrorT {
    fn from(e: OnResultRowError) -> Self {
        match e {
            OnResultRowError::ShortRead => AnyMySQLErrorT::ShortRead,
            OnResultRowError::JSError => AnyMySQLErrorT::JSError,
        }
    }
}

// Result-mode enum lives in `bun_sql::shared` (`SQLQueryResultMode`); aliased
// here as `ResultMode` to keep the call sites readable.
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode as ResultMode;

// pub const js = jsc.Codegen.JSMySQLConnection; — re-exported via `use ... as js` above.
// fromJS / fromJSDirect / toJS — provided by #[bun_jsc::JsClass] derive.

/// Sibling modules import the JS-wrapper type under the bare
/// `MySQLConnection` name (the connection state-machine struct lives in
/// `my_sql_connection`). Surface the alias here so `super::js_mysql_connection::
/// MySQLConnection` resolves to this type, not the protocol-layer struct.
pub use JSMySQLConnection as MySQLConnection;
