use core::cell::Cell;
use core::ffi::c_void;

use bun_boringssl_sys as boringssl;
use bun_core::{err, fmt as bun_fmt, timespec, TimespecMockMode};
use crate::jsc::{
    api::server_config::SSLConfig, codegen::js_mysql_connection as js, webcore::AutoFlusher,
    CallFrame, EventLoopSqlExt as _, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag,
    HasAutoFlush, JSGlobalObject, JSValue, JsRef, JsResult, KeepAlive, VirtualMachine,
    VirtualMachineSqlExt as _,
};
use bun_sql::mysql::protocol::any_mysql_error::{self as AnyMySQLError, Error as AnyMySQLErrorT};
use bun_sql::mysql::protocol::error_packet::ErrorPacket;
use bun_sql::mysql::protocol::new_reader::NewReader;
use bun_sql::mysql::protocol::new_writer::NewWriter;
use bun_sql::mysql::ssl_mode::SSLMode;
use bun_sql::mysql::MySQLQueryResult;
use crate::shared::CachedStructure;
use bun_string::strings;
use bun_uws::{self as uws, AnySocket, NewSocketHandler, SocketTCP};

use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
use crate::mysql::protocol::error_packet_jsc::ErrorPacketJsc;
use super::js_mysql_query::JSMySQLQuery;
// PORT NOTE: `my_sql_connection::MySQLConnection` (the protocol-layer struct)
// is intentionally NOT imported by name — that ident is taken in this module's
// value namespace by the `declare_scope!` static and in the type namespace by
// the `pub use JSMySQLConnection as MySQLConnection` re-export below.
use super::my_sql_connection::{self as my_sql_connection};
use super::my_sql_statement::MySQLStatement;
use super::protocol::result_set::{self as ResultSet};

bun_core::declare_scope!(MySQLConnection, visible);

const NS_PER_MS: u64 = 1_000_000;

// PORT NOTE: #[bun_jsc::JsClass] proc-macro is not applied because this type
// already has its `to_js`/`from_js` wired through `crate::jsc::codegen::
// js_mysql_connection` (which owns the extern symbols) — the hand-rolled
// `impl crate::jsc::JsClass` below forwards to those. `crate::jsc` re-exports
// `bun_jsc::{JSGlobalObject, CallFrame, JSValue}`, so the types are identical;
// switching to the derive is a mechanical follow-up, not a layering blocker.
pub struct JSMySQLConnection {
    // intrusive refcount (bun.ptr.RefCount mixin); destroy callback = `deinit`
    ref_count: Cell<u32>,
    js_value: JsRef,
    // LIFETIMES.tsv: JSC_BORROW — assigned from createInstance param; never freed
    // TODO(port): lifetime — JSC_BORROW rust_type is `&JSGlobalObject`; struct lifetime deferred to Phase B
    global_object: &'static JSGlobalObject,
    // LIFETIMES.tsv: STATIC — globalObject.bunVM() singleton
    vm: *mut VirtualMachine,
    poll_ref: KeepAlive,

    // pub(crate): MySQLRequestQueue::advance projects `connection.queue` via
    // `addr_of_mut!` from a `*mut JSMySQLConnection` so that the queue pointer
    // and the connection pointer share one Stacked Borrows provenance tag.
    pub(crate) connection: my_sql_connection::MySQLConnection,

    pub auto_flusher: AutoFlusher,

    pub idle_timeout_interval_ms: u32,
    pub connection_timeout_ms: u32,
    /// Before being connected, this is a connection timeout timer.
    /// After being connected, this is an idle timeout timer.
    pub timer: EventLoopTimer,

    /// This timer controls the maximum lifetime of a connection.
    /// It starts when the connection successfully starts (i.e. after handshake is complete).
    /// It stops when the connection is closed.
    pub max_lifetime_interval_ms: u32,
    pub max_lifetime_timer: EventLoopTimer,
}

impl crate::jsc::JsClass for JSMySQLConnection {
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        js::to_js(Box::into_raw(Box::new(self)), global)
    }
    fn from_js(value: JSValue) -> Option<*mut Self> {
        js::from_js(value)
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        js::from_js_direct(value)
    }
    fn get_constructor(global: &JSGlobalObject) -> JSValue {
        js::get_constructor(global)
    }
}

/// RAII owner for one intrusive refcount on a `JSMySQLConnection`. Dropping
/// calls [`JSMySQLConnection::deref`], which may free `*self.0` — so callers
/// must not hold a live `&`/`&mut JSMySQLConnection` across the guard's drop
/// point. Construct via [`JSMySQLConnection::ref_guard`] (which also bumps the
/// count) or directly when adopting a ref taken elsewhere (e.g. the socket ref
/// from `on_open`).
struct DerefOnDrop(*mut JSMySQLConnection);
impl Drop for DerefOnDrop {
    fn drop(&mut self) {
        // SAFETY: constructor contract — `self.0` is a live `Box::into_raw`
        // pointer with at least one outstanding ref owned by this guard.
        unsafe { JSMySQLConnection::deref(self.0) }
    }
}

// pub const ref = RefCount.ref; pub const deref = RefCount.deref;
// → intrusive Cell<u32> refcount; destroy callback = `deinit`.
bun_ptr::impl_cell_ref_counted! {
    impl JSMySQLConnection {
        fn ref_count(&self) -> &Cell<u32> { &self.ref_count }
        // SAFETY: count hit 0; `this` came from `Box::into_raw` in
        // `create_instance`, so we are the unique owner here. `deinit` takes
        // ownership back via `Box::from_raw` (mirrors Zig `bun.destroy(this)`).
        unsafe fn destroy(this: *mut Self) { Self::deinit(this) }
    }
}

impl JSMySQLConnection {
    /// RAII pair for `ref_()` / `deref()`: bumps the intrusive refcount now and
    /// releases it on drop. Replaces the Zig `this.ref(); defer this.deref();`
    /// idiom. The guard holds a raw pointer (not `&mut Self`) so no Rust
    /// reference is live across the potential free in `deref()`.
    ///
    /// SAFETY: `this` must satisfy the contract of [`Self::deref`] for the
    /// guard's entire lifetime.
    #[inline]
    unsafe fn ref_guard(this: *mut Self) -> DerefOnDrop {
        // SAFETY: caller contract — `this` is live.
        unsafe { (*this).ref_() };
        DerefOnDrop(this)
    }

    /// Short-lived `&mut VirtualMachine` for the few `vm.timer()` callers
    /// (jsc shim's `timer()` is `&mut self`). The VM is a JS-thread singleton;
    /// we never hold two `&mut` to it at once in this module.
    ///
    /// SAFETY: `self.vm()` is `&'static`; the cast reborrows the same singleton
    /// the JS thread already owns. Do not call while another `&mut VirtualMachine`
    /// is live in this frame.
    #[inline]
    fn vm(&self) -> &'static VirtualMachine {
        // SAFETY: process-lifetime singleton.
        unsafe { &*self.vm }
    }
    #[inline]
    fn vm_ptr(&self) -> *mut VirtualMachine {
        self.vm
    }
    fn vm_mut(&self) -> &'static mut VirtualMachine {
        // Explicit `'static` so the return does not reborrow `*self` — callers
        // pair this with `&mut self.timer` in the same expression.
        // SAFETY: vm is a process-lifetime singleton (per docs/PORTING.md);
        // stored as *mut to preserve write provenance.
        unsafe { &mut *self.vm }
    }

    /// `bun_aio::EventLoopCtx` for `KeepAlive::{ref_,unref}`. The JS-thread VM
    /// is a singleton; route through the global hook (same target as
    /// `self.vm`).
    #[inline]
    fn vm_ctx(&self) -> bun_aio::EventLoopCtx {
        self.vm().vm_ctx()
    }
}

impl HasAutoFlush for JSMySQLConnection {
    fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: `this` is the live `*mut JSMySQLConnection` registered with
        // the deferred-task queue; the queue runs on the JS thread with
        // exclusive access.
        unsafe { (*this).on_auto_flush() }
    }
}

impl JSMySQLConnection {
    pub fn on_auto_flush(&mut self) -> bool {
        bun_core::scoped_log!(MySQLConnection, "onAutoFlush");
        if self.connection.has_backpressure() {
            self.auto_flusher.registered = false;
            // if we have backpressure, wait for onWritable
            return false;
        }

        // drain as much as we can
        self.drain_internal();

        // if we dont have backpressure and if we still have data to send, return true otherwise return false and wait for onWritable
        let keep_flusher_registered = self.connection.can_flush();
        self.auto_flusher.registered = keep_flusher_registered;
        keep_flusher_registered
    }

    fn register_auto_flusher(&mut self) {
        if !self.auto_flusher.registered // should not be registered
            && self.connection.can_flush()
        {
            AutoFlusher::register_deferred_microtask_with_type_unchecked(self, self.vm());
            self.auto_flusher.registered = true;
        }
    }

    fn unregister_auto_flusher(&mut self) {
        if self.auto_flusher.registered {
            AutoFlusher::unregister_deferred_microtask_with_type(self, self.vm());
            self.auto_flusher.registered = false;
        }
    }

    fn stop_timers(&mut self) {
        bun_core::scoped_log!(MySQLConnection, "stopTimers");
        if self.timer.state == EventLoopTimerState::ACTIVE {
            self.vm_mut().timer().remove(&mut self.timer);
        }
        if self.max_lifetime_timer.state == EventLoopTimerState::ACTIVE {
            self.vm_mut().timer().remove(&mut self.max_lifetime_timer);
        }
    }

    fn get_timeout_interval(&self) -> u32 {
        match self.connection.status {
            my_sql_connection::Status::Connected => {
                if self.connection.is_idle() {
                    return self.idle_timeout_interval_ms;
                }
                0
            }
            my_sql_connection::Status::Failed => 0,
            _ => self.connection_timeout_ms,
        }
    }

    pub fn reset_connection_timeout(&mut self) {
        let interval = self.get_timeout_interval();
        bun_core::scoped_log!(MySQLConnection, "resetConnectionTimeout {}", interval);
        if self.timer.state == EventLoopTimerState::ACTIVE {
            self.vm_mut().timer().remove(&mut self.timer);
        }
        if self.connection.status == my_sql_connection::Status::Failed
            || self.connection.is_processing_data()
            || interval == 0
        {
            return;
        }

        self.timer.next =
            timespec::ms_from_now(TimespecMockMode::AllowMockedTime, interval.into());
        self.vm_mut().timer().insert(&mut self.timer);
    }

    pub fn on_connection_timeout(&mut self) {
        self.timer.state = EventLoopTimerState::FIRED;

        if self.connection.is_processing_data() {
            return;
        }

        if self.connection.status == my_sql_connection::Status::Failed {
            return;
        }

        if self.get_timeout_interval() == 0 {
            self.reset_connection_timeout();
            return;
        }

        match self.connection.status {
            my_sql_connection::Status::Connected => {
                self.fail_fmt(
                    AnyMySQLErrorT::IdleTimeout,
                    format_args!(
                        "Idle timeout reached after {}",
                        bun_fmt::fmt_duration_one_decimal(
                            (self.idle_timeout_interval_ms as u64).saturating_mul(NS_PER_MS)
                        )
                    ),
                );
            }
            my_sql_connection::Status::Connecting => {
                self.fail_fmt(
                    AnyMySQLErrorT::ConnectionTimedOut,
                    format_args!(
                        "Connection timeout after {}",
                        bun_fmt::fmt_duration_one_decimal(
                            (self.connection_timeout_ms as u64).saturating_mul(NS_PER_MS)
                        )
                    ),
                );
            }
            my_sql_connection::Status::Handshaking
            | my_sql_connection::Status::Authenticating
            | my_sql_connection::Status::AuthenticationAwaitingPk => {
                self.fail_fmt(
                    AnyMySQLErrorT::ConnectionTimedOut,
                    format_args!(
                        "Connection timeout after {} (during authentication)",
                        bun_fmt::fmt_duration_one_decimal(
                            (self.connection_timeout_ms as u64).saturating_mul(NS_PER_MS)
                        )
                    ),
                );
            }
            my_sql_connection::Status::Disconnected | my_sql_connection::Status::Failed => {}
        }
    }

    pub fn on_max_lifetime_timeout(&mut self) {
        self.max_lifetime_timer.state = EventLoopTimerState::FIRED;
        if self.connection.status == my_sql_connection::Status::Failed {
            return;
        }
        self.fail_fmt(
            AnyMySQLErrorT::LifetimeTimeout,
            format_args!(
                "Max lifetime timeout reached after {}",
                bun_fmt::fmt_duration_one_decimal(
                    (self.max_lifetime_interval_ms as u64).saturating_mul(NS_PER_MS)
                )
            ),
        );
    }

    fn setup_max_lifetime_timer_if_necessary(&mut self) {
        if self.max_lifetime_interval_ms == 0 {
            return;
        }
        if self.max_lifetime_timer.state == EventLoopTimerState::ACTIVE {
            return;
        }

        self.max_lifetime_timer.next = timespec::ms_from_now(
            TimespecMockMode::AllowMockedTime,
            self.max_lifetime_interval_ms.into(),
        );
        self.vm_mut().timer().insert(&mut self.max_lifetime_timer);
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn] — free-fn shim emitted inside an
    // `impl` block tries to call `constructor()` unqualified; re-enable once the
    // proc-macro emits `Self::constructor` for receiverless impl items.
    pub fn constructor(
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut Self> {
        Err(global_object.throw(format_args!("MySQLConnection cannot be constructed directly")))
    }

    pub fn enqueue_request(&mut self, item: *mut JSMySQLQuery) {
        bun_core::scoped_log!(MySQLConnection, "enqueueRequest");
        self.connection.enqueue_request(item);
        self.reset_connection_timeout();
        self.register_auto_flusher();
    }

    pub fn close(&mut self) {
        // Zig `this.ref(); defer { updateReferenceType(); deref(); }`. Re-enter
        // through a raw pointer so no `&mut Self` is live across the potential
        // free in `deref()`. Guard drop order is LIFO: `_ref` (deref) drops
        // last, after `update_reference_type()` has run.
        let p: *mut Self = self;
        // SAFETY: `p` is derived from a live `&mut self`.
        let _ref = unsafe { Self::ref_guard(p) };
        scopeguard::defer! {
            // SAFETY: `_ref` has not yet dropped, so `*p` is still live.
            unsafe { (*p).update_reference_type() };
        }
        self.stop_timers();
        self.unregister_auto_flusher();
        if self.vm().is_shutting_down() {
            self.connection.close();
        } else {
            self.connection
                .clean_queue_and_close(None, self.get_queries_array());
        }
    }

    fn drain_internal(&mut self) {
        bun_core::scoped_log!(MySQLConnection, "drainInternal");
        if self.vm().is_shutting_down() {
            return self.close();
        }
        // Zig `this.ref(); defer this.deref();` — raw-pointer RAII guard so no
        // `&mut` alias is captured and no reference is live across the
        // potential free.
        // SAFETY: `&mut self` is live.
        let _ref = unsafe { Self::ref_guard(self) };
        let _loop_guard = unsafe { self.vm().event_loop_mut() }.entered();
        self.ensure_js_value_is_alive();
        if let Err(my_sql_connection::FlushQueueError::AuthenticationFailed) = self.connection.flush_queue() {
            self.fail(b"Authentication failed", AnyMySQLErrorT::AuthenticationFailed);
            return;
        }
    }

    /// Intrusive-refcount destroy callback. Not `Drop` — this type is a
    /// `.classes.ts` `m_ctx` payload; teardown is driven by `finalize()` → `deref()`.
    /// Private: only `deref()` calls this when the count hits 0.
    ///
    /// SAFETY: `this` was originally allocated via `Box::new` and leaked via
    /// `Box::into_raw` in `create_instance`; the caller is the unique owner.
    /// No `&Self` / `&mut Self` may outlive the `Box::from_raw` drop below —
    /// that is why this (and `deref`) are raw-pointer-shaped, mirroring Zig's
    /// `fn deinit(this: *@This())` which has no reference-validity invariant.
    unsafe fn deinit(this: *mut Self) {
        // SAFETY: see fn-level contract — `this` is a live `Box::into_raw` ptr;
        // unique owner; no `&`/`&mut Self` outlives the `Box::from_raw` below.
        unsafe {
            (*this).stop_timers();
            (*this).poll_ref.unref((*this).vm_ctx());
            (*this).unregister_auto_flusher();

            (*this).connection.cleanup();
            // bun.destroy(this): reclaim the `Box::into_raw` from `create_instance`.
            drop(Box::from_raw(this));
        }
    }

    fn ensure_js_value_is_alive(&self) {
        if let Some(value) = self.js_value.try_get() {
            value.ensure_still_alive();
        }
    }

    pub fn finalize(this: *mut Self) {
        bun_core::scoped_log!(MySQLConnection, "finalize");
        // SAFETY: called on mutator thread during lazy sweep; `this` is the
        // m_ctx ptr from `Box::into_raw`. Stays raw-pointer-shaped end-to-end
        // so no `&mut Self` dangles past the potential free in `deref()`.
        unsafe {
            (*this).js_value.finalize();
            Self::deref(this);
        }
    }

    fn update_reference_type(&mut self) {
        if self.connection.is_active() {
            bun_core::scoped_log!(MySQLConnection, "connection is active");
            if self.js_value.is_not_empty() && !self.js_value.is_strong() {
                bun_core::scoped_log!(MySQLConnection, "strong ref until connection is closed");
                self.js_value.upgrade(self.global_object);
            }
            if self.connection.status == my_sql_connection::Status::Connected
                && self.connection.is_idle()
            {
                self.poll_ref.unref(self.vm_ctx());
            } else {
                self.poll_ref.r#ref(self.vm_ctx());
            }
            return;
        }
        if self.js_value.is_not_empty() && self.js_value.is_strong() {
            self.js_value.downgrade();
        }
        self.poll_ref.unref(self.vm_ctx());
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(export = "MySQLConnection__createInstance")]
    // — same proc-macro limitation as `constructor` above.
    pub fn create_instance(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: JS-thread only; short-lived `&mut` to the singleton VM via raw ptr,
        // no other live borrow in this scope.
        let vm = global_object.bun_vm().as_mut();
        let arguments = callframe.arguments();
        let hostname_str = arguments[0].to_bun_string(global_object)?;
        // defer hostname_str.deref() — Drop on bun_str::String
        let port = arguments[1].coerce::<i32>(global_object)?;

        let username_str = arguments[2].to_bun_string(global_object)?;
        let password_str = arguments[3].to_bun_string(global_object)?;
        let database_str = arguments[4].to_bun_string(global_object)?;
        // TODO: update this to match MySQL.
        let ssl_mode: SSLMode = match arguments[5].to_int32() {
            0 => SSLMode::Disable,
            1 => SSLMode::Prefer,
            2 => SSLMode::Require,
            3 => SSLMode::VerifyCa,
            4 => SSLMode::VerifyFull,
            _ => SSLMode::Disable,
        };

        let tls_object = arguments[6];

        let mut tls_config: SSLConfig = SSLConfig::default();
        let mut secure: Option<*mut uws::SslCtx> = None;
        if ssl_mode != SSLMode::Disable {
            tls_config = if tls_object.is_boolean() && tls_object.to_boolean() {
                SSLConfig::default()
            } else if tls_object.is_object() {
                match SSLConfig::from_js(&mut *vm, global_object, tls_object) {
                    Ok(Some(c)) => c,
                    Ok(None) => SSLConfig::default(),
                    Err(_) => return Ok(JSValue::ZERO),
                }
            } else {
                return Err(global_object
                    .throw_invalid_arguments(format_args!("tls must be a boolean or an object")));
            };

            if global_object.has_exception() {
                drop(tls_config);
                return Ok(JSValue::ZERO);
            }

            // We always request the cert so we can verify it and also we manually
            // abort the connection if the hostname doesn't match. Built here so
            // CA/cert errors throw synchronously, applied later by upgradeToTLS.
            // Goes through the per-VM weak `SSLContextCache` so every pooled
            // connection / reconnect shares one `SSL_CTX*` per distinct config.
            let mut err = uws::create_bun_socket_error_t::none;
            secure = vm
                .ssl_ctx_cache()
                .get_or_create_opts(tls_config.as_usockets_for_client_verification(), &mut err);
            if secure.is_none() {
                drop(tls_config);
                return Err(global_object
                    .throw_value(crate::jsc::create_bun_socket_error_to_js(err, global_object)));
            }
        }
        // Covers `try arguments[7/8].toBunString()` and the null-byte rejection
        // below. Ownership passes to `MySQLConnection.init` once `Box::new`
        // succeeds — we null the locals at that point so the connect-fail path
        // (which `deref()`s the connection) doesn't double-free.
        let mut tls_guard = scopeguard::guard((secure, tls_config), |(s, cfg)| {
            if let Some(s) = s {
                // SAFETY: secure was created by ssl_ctx_cache; we own one ref until transferred.
                unsafe { boringssl::SSL_CTX_free(s) };
            }
            drop(cfg);
        });

        let options_str = arguments[7].to_bun_string(global_object)?;
        let path_str = arguments[8].to_bun_string(global_object)?;

        // PORT NOTE: Zig packed all five strings into one `StringBuilder`-owned
        // arena and handed `[]const u8` slices into it to `MySQLConnection.init`.
        // The Rust `init` takes `Box<[u8]>` per field (each separately owned),
        // so we just copy each string into its own allocation. `options_buf`
        // (the original arena handle, kept only so `cleanup()` could free it)
        // becomes an empty box.
        let username: Box<[u8]> = Box::from(username_str.to_utf8_without_ref().slice());
        let password: Box<[u8]> = Box::from(password_str.to_utf8_without_ref().slice());
        let database: Box<[u8]> = Box::from(database_str.to_utf8_without_ref().slice());
        let options: Box<[u8]> = Box::from(options_str.to_utf8_without_ref().slice());
        let path: Box<[u8]> = Box::from(path_str.to_utf8_without_ref().slice());
        let options_buf: Box<[u8]> = Box::default();

        // Reject null bytes in connection parameters to prevent protocol injection
        // (null bytes act as field terminators in the MySQL wire protocol).
        for (slice, msg) in [
            (&username[..], "username must not contain null bytes"),
            (&password[..], "password must not contain null bytes"),
            (&database[..], "database must not contain null bytes"),
            (&path[..], "path must not contain null bytes"),
        ] {
            if !slice.is_empty() && strings::index_of_char(slice, 0).is_some() {
                // tls_config / secure released by the guard above.
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

        // Ownership transferred into `ptr.connection`; disarm the errdefer so the
        // connect-fail `ptr.deref()` is the sole cleanup path from here on.
        let (secure, tls_config) = scopeguard::ScopeGuard::into_inner(tls_guard);

        let ptr: *mut JSMySQLConnection = Box::into_raw(Box::new(JSMySQLConnection {
            ref_count: Cell::new(1),
            js_value: JsRef::empty(),
            // SAFETY: JSC_BORROW — JSGlobalObject / VirtualMachine outlive every
            // m_ctx payload (they own the heap that holds the JS wrapper).
            // Lifetime-extend the param refs via raw-ptr roundtrip.
            global_object: unsafe { &*(global_object as *const JSGlobalObject) },
            vm,
            poll_ref: KeepAlive::default(),
            connection: my_sql_connection::MySQLConnection::init(
                database,
                username,
                password,
                options,
                options_buf,
                tls_config,
                secure,
                ssl_mode,
            ),
            auto_flusher: AutoFlusher::default(),
            idle_timeout_interval_ms: u32::try_from(idle_timeout).expect("int cast"),
            connection_timeout_ms: u32::try_from(connection_timeout).expect("int cast"),
            max_lifetime_interval_ms: u32::try_from(max_lifetime).expect("int cast"),
            timer: EventLoopTimer::init_paused(EventLoopTimerTag::MySQLConnectionTimeout),
            max_lifetime_timer: EventLoopTimer::init_paused(
                EventLoopTimerTag::MySQLConnectionMaxLifetime,
            ),
        }));
        // SAFETY: ptr was just allocated and is non-null; we hold the only reference.
        let this = unsafe { &mut *ptr };

        {
            let hostname = hostname_str.to_utf8();

            // MySQL always opens plain TCP first; STARTTLS adopts into the TLS
            // group after the SSLRequest exchange.
            // SAFETY: `mysql_group` returns the embedded `&mut SocketGroup`
            // owned by RareData (lives for the VM's lifetime). `vm` reborrowed
            // via raw ptr to avoid the `rare_data(&mut vm)` /
            // `mysql_group(.., &vm)` aliasing conflict.
            let vm_p = vm as *mut VirtualMachine;
            let group = unsafe { (*vm_p).rare_data().mysql_group::<false>(&*vm_p) };
            let result = if !path.is_empty() {
                SocketTCP::connect_unix_group(group, uws::DispatchKind::Mysql, None, &path[..], ptr, false)
            } else {
                SocketTCP::connect_group(
                    group,
                    uws::DispatchKind::Mysql,
                    None,
                    hostname.slice(),
                    port,
                    ptr,
                    false,
                )
            };
            let socket = match result {
                Ok(s) => s,
                Err(e) => {
                    // SAFETY: `ptr` is the freshly-boxed allocation; sole owner.
                    // Drop the `&mut` borrow (`this`) before freeing so no
                    // reference outlives the `Box::from_raw` inside `deinit`.
                    let _ = this;
                    unsafe { Self::deref(ptr) };
                    return Err(global_object.throw_error(e.into(), "failed to connect to mysql"));
                }
            };
            this.connection.set_socket(AnySocket::SocketTcp(socket));
        }
        this.connection.status = my_sql_connection::Status::Connecting;
        this.reset_connection_timeout();
        this.poll_ref.r#ref(vm.vm_ctx());
        let js_value = js::to_js(ptr, global_object);
        js_value.ensure_still_alive();
        this.js_value.set_strong(js_value, global_object);
        js::onconnect_set_cached(js_value, global_object, on_connect);
        js::onclose_set_cached(js_value, global_object, on_close);

        Ok(js_value)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)] — see JsClass note above.
    pub fn get_queries(
        _this: &Self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        if let Some(value) = js::queries_get_cached(this_value) {
            return Ok(value);
        }

        let array = JSValue::create_empty_array(global_object, 0)?;
        js::queries_set_cached(this_value, global_object, array);

        Ok(array)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)] — see JsClass note above.
    pub fn get_connected(this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(this.connection.status == my_sql_connection::Status::Connected)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)] — see JsClass note above.
    pub fn get_on_connect(_this: &Self, this_value: JSValue, _: &JSGlobalObject) -> JSValue {
        if let Some(value) = js::onconnect_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(setter)] — see JsClass note above.
    pub fn set_on_connect(
        _this: &mut Self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        js::onconnect_set_cached(this_value, global_object, value);
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)] — see JsClass note above.
    pub fn get_on_close(_this: &Self, this_value: JSValue, _: &JSGlobalObject) -> JSValue {
        if let Some(value) = js::onclose_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(setter)] — see JsClass note above.
    pub fn set_on_close(
        _this: &mut Self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        js::onclose_set_cached(this_value, global_object, value);
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn do_ref(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.r#ref(this.vm_ctx());
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn do_unref(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.unref(this.vm_ctx());
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn do_flush(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.register_auto_flusher();
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn do_close(
        this: &mut Self,
        _global_object: &JSGlobalObject,
        _: &CallFrame,
    ) -> JsResult<JSValue> {
        this.stop_timers();

        // Zig `defer this.updateReferenceType();` — re-enter via raw pointer so
        // the closure does not hold a second `&mut` alias of `this`.
        let p: *mut Self = this;
        scopeguard::defer! {
            // SAFETY: `p` from live `&mut this`; `*p` outlives the guard (no deref()).
            unsafe { (*p).update_reference_type() };
        }
        this.connection
            .clean_queue_and_close(None, this.get_queries_array());
        Ok(JSValue::UNDEFINED)
    }

    fn consume_on_connect_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.js_value.try_get() {
            let on_connect = js::onconnect_get_cached(value)?;
            js::onconnect_set_cached(value, global_object, JSValue::ZERO);
            return Some(on_connect);
        }
        None
    }

    fn consume_on_close_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.js_value.try_get() {
            let on_close = js::onclose_get_cached(value)?;
            js::onclose_set_cached(value, global_object, JSValue::ZERO);
            return Some(on_close);
        }
        None
    }

    pub fn get_queries_array(&self) -> JSValue {
        if self.vm().is_shutting_down() {
            return JSValue::UNDEFINED;
        }
        if let Some(value) = self.js_value.try_get() {
            return js::queries_get_cached(value).unwrap_or(JSValue::UNDEFINED);
        }
        JSValue::UNDEFINED
    }

    #[inline]
    pub fn is_able_to_write(&self) -> bool {
        self.connection.is_able_to_write()
    }
    #[inline]
    pub fn is_connected(&self) -> bool {
        self.connection.status == my_sql_connection::Status::Connected
    }
    #[inline]
    pub fn can_pipeline(&mut self) -> bool {
        self.connection.can_pipeline()
    }
    #[inline]
    pub fn can_prepare_query(&mut self) -> bool {
        self.connection.can_prepare_query()
    }
    #[inline]
    pub fn can_execute_query(&mut self) -> bool {
        self.connection.can_execute_query()
    }
    #[inline]
    pub fn get_writer(&mut self) -> NewWriter<my_sql_connection::Writer> {
        self.connection.writer()
    }

    fn fail_fmt(&mut self, error_code: AnyMySQLErrorT, args: core::fmt::Arguments<'_>) {
        // bun.handleOom(std.fmt.allocPrint(...)) → write into Vec<u8>
        let mut message: Vec<u8> = Vec::new();
        {
            use std::io::Write;
            let _ = write!(&mut message, "{}", args);
        }

        let err = mysql_error_to_js(self.global_object, &message, error_code);
        self.fail_with_js_value(err);
    }

    fn fail_with_js_value(&mut self, value: JSValue) {
        // Zig `this.ref(); defer { ...; updateReferenceType(); deref(); }` —
        // runs on every exit path. Re-enter through a raw pointer so no `&mut`
        // alias is captured and no reference is live across the potential free
        // in `deref()`. LIFO drop order: the `defer!` body runs first, then
        // `_ref` releases the count — matches Zig.
        let p: *mut Self = self;
        // SAFETY: `p` is derived from a live `&mut self`.
        let _ref = unsafe { Self::ref_guard(p) };
        scopeguard::defer! {
            // SAFETY: `_ref` has not yet dropped, so `*p` is still live.
            unsafe {
                if (*p).vm().is_shutting_down() {
                    (*p).connection.close();
                } else {
                    let queries = (*p).get_queries_array();
                    (*p).connection.clean_queue_and_close(Some(value), queries);
                }
                (*p).update_reference_type();
            }
        }
        self.stop_timers();

        if self.connection.status == my_sql_connection::Status::Failed {
            return;
        }

        self.connection.status = my_sql_connection::Status::Failed;
        if self.vm().is_shutting_down() {
            return;
        }

        let Some(on_close) = self.consume_on_close_callback(self.global_object) else {
            return;
        };
        on_close.ensure_still_alive();
        let loop_ = unsafe { self.vm().event_loop_mut() };
        // loop.enter();
        // defer loop.exit();
        self.ensure_js_value_is_alive();
        let mut js_error = value.to_error().unwrap_or(value);
        if js_error.is_empty() {
            js_error = mysql_error_to_js(
                self.global_object,
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
            self.global_object,
            JSValue::UNDEFINED,
            &[js_error, queries_array],
        );
    }

    fn fail(&mut self, message: &[u8], err: AnyMySQLErrorT) {
        let instance = mysql_error_to_js(self.global_object, message, err);
        self.fail_with_js_value(instance);
    }

    pub fn on_connection_estabilished(&mut self) {
        if self.vm().is_shutting_down() {
            return;
        }
        let Some(on_connect) = self.consume_on_connect_callback(self.global_object) else {
            return;
        };
        on_connect.ensure_still_alive();
        let js_value = self.js_value.try_get().unwrap_or(JSValue::UNDEFINED);
        js_value.ensure_still_alive();
        self.global_object
            .queue_microtask(on_connect, &[JSValue::NULL, js_value]);
    }

    pub fn on_query_result(&mut self, request: &mut JSMySQLQuery, result: MySQLQueryResult) {
        request.resolve(self.get_queries_array(), result);
    }

    pub fn on_result_row<C: bun_sql::mysql::protocol::ReaderContext>(
        &mut self,
        request: &mut JSMySQLQuery,
        statement: &mut MySQLStatement,
        reader: NewReader<C>,
    ) -> Result<(), OnResultRowError> {
        let result_mode = request.get_result_mode();
        let mut structure: JSValue = JSValue::UNDEFINED;
        // PORT NOTE: `MySQLStatement::structure(&mut self) -> &CachedStructure`
        // would keep `*statement` exclusively borrowed for the lifetime of the
        // returned ref, blocking the `&statement.columns` / `fields_flags` reads
        // below. Stash a raw ptr (Zig holds it by value) and re-borrow at the
        // `to_js` call site.
        let cached_structure_ptr: Option<*const CachedStructure> = match result_mode {
            ResultMode::Objects => self.js_value.try_get().map(|value| {
                let cs = statement.structure(value, self.global_object);
                structure = cs.js_value().unwrap_or(JSValue::UNDEFINED);
                cs as *const CachedStructure
            }),
            // no need to check for duplicate fields or structure
            ResultMode::Raw | ResultMode::Values => None,
        };
        let fields_flags = statement.fields_flags;
        // PERF(port): was stack-fallback allocator (4096 bytes)
        let mut row = ResultSet::Row {
            global_object: self.global_object,
            columns: &statement.columns,
            binary: !request.is_simple(),
            raw: result_mode == ResultMode::Raw,
            bigint: request.is_bigint_supported(),
            values: Box::default(),
        };
        // defer row.deinit(allocator) — Drop on ResultSet::Row
        if let Err(e) = row.decode(reader) {
            if e == AnyMySQLErrorT::ShortRead {
                return Err(OnResultRowError::ShortRead);
            }
            self.connection.queue.mark_current_request_as_finished(request);
            request.reject(self.get_queries_array(), e);
            return Ok(());
        }
        let pending_value = request.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        // SAFETY: points into `*statement.cached_structure`; `statement` is live
        // and not mutably borrowed for the duration of this `to_js` call.
        let cached_structure = cached_structure_ptr.map(|p| unsafe { &*p });
        // Process row data
        let row_value = row
            .to_js(
                self.global_object,
                pending_value,
                structure,
                fields_flags,
                result_mode,
                cached_structure,
            )
            .map_err(|_| OnResultRowError::JSError)?;
        // `Row<'_>` has a Drop impl, so its `&statement.columns` borrow lives to
        // end-of-scope; drop it now so `statement.result_count += 1` may take `&mut`.
        drop(row);
        if let Some(err) = self.global_object.try_take_exception() {
            self.connection.queue.mark_current_request_as_finished(request);
            request.reject_with_js_value(self.get_queries_array(), err);
            return Ok(());
        }
        statement.result_count += 1;

        if pending_value.is_empty_or_undefined_or_null() {
            request.set_pending_value(row_value);
        }
        Ok(())
    }

    pub fn on_error(&mut self, request: Option<&mut JSMySQLQuery>, err: AnyMySQLErrorT) {
        if let Some(request) = request {
            if self.vm().is_shutting_down() {
                request.mark_as_failed();
                return;
            }
            if let Some(err_) = self.global_object.try_take_exception() {
                request.reject_with_js_value(self.get_queries_array(), err_);
            } else {
                request.reject(self.get_queries_array(), err);
            }
        } else {
            if self.vm().is_shutting_down() {
                self.close();
                return;
            }
            if let Some(err_) = self.global_object.try_take_exception() {
                self.fail_with_js_value(err_);
            } else {
                self.fail(b"Connection closed", err);
            }
        }
    }

    pub fn on_error_packet(&mut self, request: Option<&mut JSMySQLQuery>, err: ErrorPacket) {
        if let Some(request) = request {
            if self.vm().is_shutting_down() {
                request.mark_as_failed();
            } else {
                if let Some(err_) = self.global_object.try_take_exception() {
                    request.reject_with_js_value(self.get_queries_array(), err_);
                } else {
                    request
                        .reject_with_js_value(self.get_queries_array(), err.to_js(self.global_object));
                }
            }
        } else {
            if self.vm().is_shutting_down() {
                self.close();
                return;
            }
            if let Some(err_) = self.global_object.try_take_exception() {
                self.fail_with_js_value(err_);
            } else {
                self.fail_with_js_value(err.to_js(self.global_object));
            }
        }
    }

    pub fn get_statement_from_signature_hash(
        &mut self,
        signature_hash: u64,
    ) -> Result<my_sql_connection::PreparedStatementsMapGetOrPutResult<'_>, bun_core::Error> {
        // TODO(port): narrow error set — `get_or_put` currently yields `AllocError`.
        self.connection
            .statements
            .get_or_put(signature_hash)
            .map_err(|_| bun_core::err!("OutOfMemory"))
    }
}

/// Referenced by `dispatch.zig` (kind = `.mysql[_tls]`).
pub struct SocketHandler<const SSL: bool>;

// PORT NOTE: Zig's `pub const SocketType = uws.NewSocketHandler(ssl)` is an
// inherent associated type, which is unstable in Rust (`feature(inherent_associated_types)`).
// Spell out `NewSocketHandler<SSL>` at every use site instead.
impl<const SSL: bool> SocketHandler<SSL> {
    fn _socket(s: NewSocketHandler<SSL>) -> AnySocket {
        // SAFETY: `NewSocketHandler<true>` / `NewSocketHandler<false>` have
        // identical layout (single `InternalSocket` field, no PhantomData on
        // SSL); transmute reinterprets the const-generic discriminant only.
        if SSL {
            AnySocket::SocketTls(unsafe { core::mem::transmute::<_, NewSocketHandler<true>>(s) })
        } else {
            AnySocket::SocketTcp(unsafe { core::mem::transmute::<_, NewSocketHandler<false>>(s) })
        }
    }

    pub fn on_open(this: &mut JSMySQLConnection, s: NewSocketHandler<SSL>) {
        let socket = Self::_socket(s);
        let is_tcp = matches!(socket, AnySocket::SocketTcp(_));
        this.connection.set_socket(socket);

        if is_tcp {
            // This handshake is not TLS handleshake is actually the MySQL handshake
            // When a connection is upgraded to TLS, the onOpen callback is called again and at this moment we dont wanna to change the status to handshaking
            this.connection.status = my_sql_connection::Status::Handshaking;
            this.ref_(); // keep a ref for the socket
        }
        // Only set up the timers after all status changes are complete — the timers rely on the status to determine timeouts.
        this.setup_max_lifetime_timer_if_necessary();
        this.reset_connection_timeout();
        this.update_reference_type();
    }

    fn on_handshake_<S>(
        this: &mut JSMySQLConnection,
        _: S,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        let handshake_was_successful = match this.connection.do_handshake(success, ssl_error) {
            Ok(v) => v,
            Err(e) => {
                return this.fail_fmt(e, format_args!("Failed to send handshake response"));
            }
        };
        if !handshake_was_successful {
            // ssl_error.toJS(this.#globalObject) catch return
            let Ok(v) = crate::jsc::verify_error_to_js(&ssl_error, this.global_object) else {
                return;
            };
            this.fail_with_js_value(v);
        }
    }

    // pub const onHandshake = if (ssl) onHandshake_ else null;
    // TODO(port): conditional associated const on const-generic bool — Phase B wires this
    // via the dispatch table (only register on_handshake when SSL == true).

    pub fn on_close(this: &mut JSMySQLConnection, _: NewSocketHandler<SSL>, _: i32, _: Option<*mut c_void>) {
        // Zig `defer this.deref();` — releases the socket ref taken in on_open.
        // RAII guard adopts that existing ref (no `ref_()` here); raw-pointer
        // shaped so no `&mut` alias outlives the potential free.
        let _ref = DerefOnDrop(this);
        this.fail(b"Connection closed", AnyMySQLErrorT::ConnectionClosed);
    }

    pub fn on_end(_: &mut JSMySQLConnection, socket: NewSocketHandler<SSL>) {
        // no half closed sockets
        socket.close(uws::CloseKind::Normal);
    }

    pub fn on_connect_error(this: &mut JSMySQLConnection, _: NewSocketHandler<SSL>, _: i32) {
        // TODO: proper propagation of the error
        this.fail(b"Connection closed", AnyMySQLErrorT::ConnectionClosed);
    }

    pub fn on_timeout(this: &mut JSMySQLConnection, _: NewSocketHandler<SSL>) {
        this.fail(b"Connection timeout", AnyMySQLErrorT::ConnectionTimedOut);
    }

    pub fn on_data(this: &mut JSMySQLConnection, _: NewSocketHandler<SSL>, data: &[u8]) {
        // Zig `this.ref(); defer this.deref();` + `defer { resetConnectionTimeout(); ... }`.
        // Both guards re-enter via raw pointer so neither captures a `&mut`
        // alias and no reference is live across the potential free. Guard drop
        // order is LIFO, so `_ref` (deref) runs last — matches Zig.
        let p: *mut JSMySQLConnection = this;
        // SAFETY: `p` from live `&mut this`.
        let _ref = unsafe { JSMySQLConnection::ref_guard(p) };
        let vm = this.vm();

        scopeguard::defer! {
            // SAFETY: `_ref` has not yet dropped, so `*p` is still live.
            unsafe {
                // reset the connection timeout after we're done processing the data
                (*p).reset_connection_timeout();
                (*p).update_reference_type();
                (*p).register_auto_flusher();
            }
        }
        if this.vm().is_shutting_down() {
            // we are shutting down lets not process the data
            return;
        }

        let _loop_guard = unsafe { vm.event_loop_mut() }.entered();
        this.ensure_js_value_is_alive();

        if let Err(e) = this.connection.read_and_process_data(data) {
            this.on_error(None, e);
        }
    }

    pub fn on_writable(this: &mut JSMySQLConnection, _: NewSocketHandler<SSL>) {
        this.connection.reset_backpressure();
        this.drain_internal();
    }
}

#[derive(strum::IntoStaticStr, Debug)]
pub enum OnResultRowError {
    ShortRead,
    JSError,
}
impl core::fmt::Display for OnResultRowError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(<&'static str>::from(self))
    }
}
impl core::error::Error for OnResultRowError {}
impl From<OnResultRowError> for bun_core::Error {
    fn from(e: OnResultRowError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}
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

/// Zig re-export pattern: `MySQLQuery.zig` / `MySQLRequestQueue.zig` /
/// `JSMySQLQuery.zig` import the JS-wrapper type under the bare
/// `MySQLConnection` name (the connection state-machine struct lives in
/// `my_sql_connection`). Surface the alias here so `super::js_mysql_connection::
/// MySQLConnection` resolves to this type, not the protocol-layer struct.
pub use JSMySQLConnection as MySQLConnection;

pub type Writer = my_sql_connection::Writer;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/JSMySQLConnection.zig (801 lines)
//   confidence: medium
//   todos:      2
//   notes:      SocketHandler conditional onHandshake unresolved; global_object JSC_BORROW lifetime deferred; deref/deinit raw-ptr-shaped to avoid dangling &mut across Box::from_raw
// ──────────────────────────────────────────────────────────────────────────
