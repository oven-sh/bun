use core::cell::Cell;
use core::ffi::c_void;

use crate::jsc::{
    CallFrame, EventLoopSqlExt as _, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag,
    GlobalRef, HasAutoFlush, JSGlobalObject, JSValue, JsCell, JsRef, JsResult, KeepAlive,
    VirtualMachine, VirtualMachineSqlExt as _, api::server_config::SSLConfig,
    codegen::js_mysql_connection as js, webcore::AutoFlusher,
};
use crate::shared::CachedStructure;
use bun_boringssl_sys as boringssl;
use bun_core::strings;
use bun_core::{TimespecMockMode, err, fmt as bun_fmt, timespec};
use bun_ptr::{AsCtxPtr, BackRef, ParentRef};
use bun_sql::mysql::MySQLQueryResult;
use bun_sql::mysql::protocol::any_mysql_error::{self as AnyMySQLError, Error as AnyMySQLErrorT};
use bun_sql::mysql::protocol::error_packet::ErrorPacket;
use bun_sql::mysql::protocol::new_reader::NewReader;
use bun_sql::mysql::protocol::new_writer::NewWriter;
use bun_sql::mysql::ssl_mode::SSLMode;
use bun_uws::{self as uws, AnySocket, NewSocketHandler, SocketTCP};

use super::js_mysql_query::JSMySQLQuery;
use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
use crate::mysql::protocol::error_packet_jsc::ErrorPacketJsc;
// PORT NOTE: `my_sql_connection::MySQLConnection` (the protocol-layer struct)
// is intentionally NOT imported by name — that ident is taken in this module's
// value namespace by the `declare_scope!` static and in the type namespace by
// the `pub use JSMySQLConnection as MySQLConnection` re-export below.
use super::my_sql_connection::{self as my_sql_connection};
use super::my_sql_statement::MySQLStatement;
use super::protocol::result_set::{self as ResultSet};

bun_core::declare_scope!(MySQLConnection, visible);

use bun_core::time::NS_PER_MS;

// PORT NOTE: #[bun_jsc::JsClass] proc-macro is not applied because this type
// already has its `to_js`/`from_js` wired through `crate::jsc::codegen::
// js_mysql_connection` (which owns the extern symbols) — the hand-rolled
// `impl crate::jsc::JsClass` below forwards to those. `crate::jsc` re-exports
// `bun_jsc::{JSGlobalObject, CallFrame, JSValue}`, so the types are identical;
// switching to the derive is a mechanical follow-up, not a layering blocker.
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut JSMySQLConnection` until Phase 1 lands —
// `&mut T` auto-derefs to `&T` so the impls below compile against either.
// `JsCell` is `#[repr(transparent)]`, so `from_field_ptr!` recovery
// (`from_timer_ptr` / `MySQLConnection::get_js_connection`) sees identical
// offsets.
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct JSMySQLConnection {
    // intrusive refcount (bun.ptr.RefCount mixin); destroy callback = `deinit`
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
    // via a `ParentRef<JSMySQLConnection>` shared borrow; the inner protocol
    // struct's `get_js_connection()` recovers the embedding via
    // `from_field_ptr!` (offset unchanged — `JsCell` is transparent).
    pub(crate) connection: JsCell<my_sql_connection::MySQLConnection>,

    pub auto_flusher: JsCell<AutoFlusher>,

    pub idle_timeout_interval_ms: u32,
    pub connection_timeout_ms: u32,
    /// Before being connected, this is a connection timeout timer.
    /// After being connected, this is an idle timeout timer.
    // Private — intrusive heap node; cross-crate `container_of` goes through
    // [`Self::from_timer_ptr`] instead of `offset_of!` on the field.
    timer: JsCell<EventLoopTimer>,

    /// This timer controls the maximum lifetime of a connection.
    /// It starts when the connection successfully starts (i.e. after handshake is complete).
    /// It stops when the connection is closed.
    pub max_lifetime_interval_ms: u32,
    // Private — see `timer`; recovered via [`Self::from_max_lifetime_timer_ptr`].
    max_lifetime_timer: JsCell<EventLoopTimer>,
}

bun_event_loop::impl_timer_owner!(JSMySQLConnection;
    from_timer_ptr => timer,
    from_max_lifetime_timer_ptr => max_lifetime_timer,
);

bun_jsc::impl_js_class_via_generated!(JSMySQLConnection => crate::jsc::codegen::js_mysql_connection);

/// RAII owner for one intrusive refcount on a `JSMySQLConnection`. Dropping
/// calls [`JSMySQLConnection::deref`], which may free `*self.0` — so callers
/// must not hold a live `&`/`&mut JSMySQLConnection` across the guard's drop
/// point. Construct via [`JSMySQLConnection::ref_guard`] (which also bumps the
/// count) or directly when adopting a ref taken elsewhere (e.g. the socket ref
/// from `on_open`).
struct DerefOnDrop(*mut JSMySQLConnection);
impl Drop for DerefOnDrop {
    fn drop(&mut self) {
        // SAFETY: constructor contract — `self.0` is a live `heap::alloc`
        // pointer with at least one outstanding ref owned by this guard.
        unsafe { JSMySQLConnection::deref(self.0) }
    }
}

impl JSMySQLConnection {
    /// RAII pair for `ref_()` / `deref()`: bumps the intrusive refcount now and
    /// releases it on drop. Replaces the Zig `this.ref(); defer this.deref();`
    /// idiom. The guard stashes a raw pointer (not `&Self`) so no Rust
    /// reference is held across the potential free in `deref()`; the `&self`
    /// receiver here is only borrowed for the bump itself.
    #[inline]
    fn ref_guard(&self) -> DerefOnDrop {
        self.ref_();
        DerefOnDrop(self.as_ctx_ptr())
    }

    /// Shared borrow of the JS-thread `VirtualMachine` singleton stored in this
    /// connection. Safe `Deref` via [`BackRef`] — the VM strictly outlives
    /// every connection it creates (process-lifetime singleton).
    #[inline]
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }
    #[inline]
    fn vm_ptr(&self) -> *mut VirtualMachine {
        self.vm.as_ptr()
    }
    /// Short-lived `&mut VirtualMachine` for the few `vm.timer()` callers
    /// (jsc shim's `timer()` is `&mut self`). The VM is a JS-thread singleton;
    /// we never hold two `&mut` to it at once in this module.
    fn vm_mut(&self) -> &'static mut VirtualMachine {
        VirtualMachine::get_mut()
    }

    /// `&mut EventLoop` for `entered()`/`run_callback`. One audited unsafe
    /// here replaces the per-site `unsafe { self.vm().event_loop_mut() }` —
    /// the loop is a disjoint heap allocation owned by the JS-thread VM
    /// singleton; single-thread affinity ⇒ no two `&mut EventLoop` coexist.
    #[inline]
    fn event_loop(&self) -> &'static mut crate::jsc::EventLoop {
        // `vm_mut()` yields the process-lifetime `'static mut VM` (see above);
        // the owned event loop lives for the VM's lifetime. Single-JS-thread
        // invariant ⇒ callers never overlap `&mut`.
        self.vm_mut().event_loop_mut()
    }

    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }
}

impl HasAutoFlush for JSMySQLConnection {
    fn on_auto_flush(this: *mut Self) -> bool {
        // `this` is the live `*mut JSMySQLConnection` registered with the
        // deferred-task queue; the queue runs on the JS thread. R-2: deref as
        // shared — `on_auto_flush` body takes `&self`. `ParentRef` (lifetime-
        // erased `&T`) centralises the backref deref under its own invariant.
        ParentRef::from(core::ptr::NonNull::new(this).expect("auto-flush ctx non-null"))
            .on_auto_flush()
    }
}

impl JSMySQLConnection {
    // ─── R-2 interior-mutability helpers ────────────────────────────────────

    /// Mutable projection of the inner protocol connection through `&self`.
    ///
    /// `my_sql_connection::MySQLConnection` is the protocol state machine (not
    /// itself JS-exposed); every method on it still takes `&mut self`. This is
    /// the single audited escape hatch — callers must keep the returned borrow
    /// short and not hold it across a call that re-enters JS and re-derives
    /// the same connection.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(crate) fn connection_mut(&self) -> &mut my_sql_connection::MySQLConnection {
        // SAFETY: R-2 single-JS-thread invariant (see `JsCell` docs). The
        // `&mut` is fresh per call site; reentrancy through
        // `MySQLConnection::get_js_connection()` forms a shared
        // `&JSMySQLConnection` only.
        unsafe { self.connection.get_mut() }
    }

    // ────────────────────────────────────────────────────────────────────────

    pub fn on_auto_flush(&self) -> bool {
        bun_core::scoped_log!(MySQLConnection, "onAutoFlush");
        if self.connection.get().has_backpressure() {
            self.auto_flusher.with_mut(|a| a.registered = false);
            // if we have backpressure, wait for onWritable
            return false;
        }

        // drain as much as we can
        self.drain_internal();

        // if we dont have backpressure and if we still have data to send, return true otherwise return false and wait for onWritable
        let keep_flusher_registered = self.connection.get().can_flush();
        self.auto_flusher
            .with_mut(|a| a.registered = keep_flusher_registered);
        keep_flusher_registered
    }

    fn register_auto_flusher(&self) {
        if !self.auto_flusher.get().registered // should not be registered
            && self.connection.get().can_flush()
        {
            AutoFlusher::register_deferred_microtask_with_type_unchecked(
                self.as_ctx_ptr(),
                self.vm(),
            );
            self.auto_flusher.with_mut(|a| a.registered = true);
        }
    }

    fn unregister_auto_flusher(&self) {
        if self.auto_flusher.get().registered {
            AutoFlusher::unregister_deferred_microtask_with_type(self.as_ctx_ptr(), self.vm());
            self.auto_flusher.with_mut(|a| a.registered = false);
        }
    }

    fn stop_timers(&self) {
        bun_core::scoped_log!(MySQLConnection, "stopTimers");
        if self.timer.get().state == EventLoopTimerState::ACTIVE {
            self.timer.with_mut(|t| self.vm_mut().timer().remove(t));
        }
        if self.max_lifetime_timer.get().state == EventLoopTimerState::ACTIVE {
            self.max_lifetime_timer
                .with_mut(|t| self.vm_mut().timer().remove(t));
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

    pub fn reset_connection_timeout(&self) {
        let interval = self.get_timeout_interval();
        bun_core::scoped_log!(MySQLConnection, "resetConnectionTimeout {}", interval);
        if self.timer.get().state == EventLoopTimerState::ACTIVE {
            self.timer.with_mut(|t| self.vm_mut().timer().remove(t));
        }
        if self.connection.get().status == my_sql_connection::Status::Failed
            || self.connection.get().is_processing_data()
            || interval == 0
        {
            return;
        }

        self.timer.with_mut(|t| {
            t.next = timespec::ms_from_now(TimespecMockMode::AllowMockedTime, interval.into());
            self.vm_mut().timer().insert(t);
        });
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
                TimespecMockMode::AllowMockedTime,
                self.max_lifetime_interval_ms.into(),
            );
            self.vm_mut().timer().insert(t);
        });
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn] — free-fn shim emitted inside an
    // `impl` block tries to call `constructor()` unqualified; re-enable once the
    // proc-macro emits `Self::constructor` for receiverless impl items.
    pub fn constructor(
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut Self> {
        Err(global_object.throw(format_args!(
            "MySQLConnection cannot be constructed directly"
        )))
    }

    pub fn enqueue_request(&self, item: *mut JSMySQLQuery) {
        bun_core::scoped_log!(MySQLConnection, "enqueueRequest");
        self.connection_mut().enqueue_request(item);
        self.reset_connection_timeout();
        self.register_auto_flusher();
    }

    pub fn close(&self) {
        // Zig `this.ref(); defer { updateReferenceType(); deref(); }`. Re-enter
        // through a `ParentRef` (lifetime-erased `&Self`) so no Rust borrow is
        // held across the potential free in `deref()`. Guard drop order is
        // LIFO: `_ref` (deref) drops last, after `update_reference_type()` has
        // run, so `*p` is still live when the defer body executes.
        let p = ParentRef::new(self);
        let _ref = self.ref_guard();
        scopeguard::defer! {
            p.update_reference_type();
        }
        self.stop_timers();
        self.unregister_auto_flusher();
        if self.vm().is_shutting_down() {
            self.connection_mut().close();
        } else {
            let queries = self.get_queries_array();
            self.connection_mut().clean_queue_and_close(None, queries);
        }
    }

    fn drain_internal(&self) {
        bun_core::scoped_log!(MySQLConnection, "drainInternal");
        if self.vm().is_shutting_down() {
            return self.close();
        }
        // Zig `this.ref(); defer this.deref();` — raw-pointer RAII guard so no
        // reference is live across the potential free.
        let _ref = self.ref_guard();
        let _loop_guard = self.event_loop().entered();
        self.ensure_js_value_is_alive();
        if let Err(my_sql_connection::FlushQueueError::AuthenticationFailed) =
            self.connection_mut().flush_queue()
        {
            self.fail(
                b"Authentication failed",
                AnyMySQLErrorT::AuthenticationFailed,
            );
            return;
        }
    }

    /// Intrusive-refcount destroy callback. Not `Drop` — this type is a
    /// `.classes.ts` `m_ctx` payload; teardown is driven by `finalize()` → `deref()`.
    /// Private: only `deref()` calls this when the count hits 0.
    ///
    /// Raw-pointer-shaped (not `&mut self`): ends in `heap::take(this)`, and a
    /// `&mut self` protector live across the dealloc would be UB under Stacked
    /// Borrows — direct mapping of Zig's `fn deinit(this: *@This())`.
    fn deinit(this: *mut Self) {
        // SAFETY: routed only through `CellRefCounted::destroy` (refcount==0);
        // `this` is the live `heap::alloc` ptr from `create_instance`, sole
        // owner; no `&`/`&mut Self` outlives the `heap::take` below.
        unsafe {
            {
                let r = &*this;
                r.stop_timers();
                let ctx = r.vm_ctx();
                r.poll_ref.with_mut(|p| p.unref(ctx));
                r.unregister_auto_flusher();
                r.connection_mut().cleanup();
            }
            // bun.destroy(this): reclaim the `heap::alloc` from `create_instance`.
            drop(bun_core::heap::take(this));
        }
    }

    fn ensure_js_value_is_alive(&self) {
        if let Some(value) = self.js_value.get().try_get() {
            value.ensure_still_alive();
        }
    }

    pub fn finalize(self: Box<Self>) {
        bun_core::scoped_log!(MySQLConnection, "finalize");
        bun_ptr::finalize_js_box(self, |this| this.js_value.with_mut(|r| r.finalize()));
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
        // defer hostname_str.deref() — Drop on bun_core::String
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
                return Err(
                    global_object.throw_value(crate::jsc::create_bun_socket_error_to_js(
                        err,
                        global_object,
                    )),
                );
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

        let ptr: *mut JSMySQLConnection = bun_core::heap::into_raw(Box::new(JSMySQLConnection {
            ref_count: Cell::new(1),
            js_value: JsCell::new(JsRef::empty()),
            global_object: GlobalRef::from(global_object),
            vm: BackRef::new_mut(vm),
            poll_ref: JsCell::new(KeepAlive::default()),
            connection: JsCell::new(my_sql_connection::MySQLConnection::init(
                database,
                username,
                password,
                options,
                options_buf,
                tls_config,
                secure,
                ssl_mode,
            )),
            auto_flusher: JsCell::new(AutoFlusher::default()),
            idle_timeout_interval_ms: u32::try_from(idle_timeout).expect("int cast"),
            connection_timeout_ms: u32::try_from(connection_timeout).expect("int cast"),
            max_lifetime_interval_ms: u32::try_from(max_lifetime).expect("int cast"),
            timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::MySQLConnectionTimeout,
            )),
            max_lifetime_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::MySQLConnectionMaxLifetime,
            )),
        }));
        // `heap::into_raw` is `Box::into_raw` — never null. `ParentRef` wraps
        // the freshly-boxed allocation as a lifetime-erased `&Self` (R-2: every
        // field is interior-mutable, so shared access suffices for the writes
        // below); we hold the only reference.
        let this = ParentRef::from(core::ptr::NonNull::new(ptr).expect("heap::into_raw non-null"));

        {
            let hostname = hostname_str.to_utf8();

            // MySQL always opens plain TCP first; STARTTLS adopts into the TLS
            // group after the SSLRequest exchange.
            let group = vm.mysql_socket_group::<false>();
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
                    port,
                    ptr,
                    false,
                )
            };
            let socket = match result {
                Ok(s) => s,
                Err(e) => {
                    // SAFETY: `ptr` is the freshly-boxed allocation; sole owner.
                    // `this` (a `ParentRef`) is not used past this point, so no
                    // borrow outlives the `heap::take` inside `deinit`.
                    let _ = this;
                    unsafe { Self::deref(ptr) };
                    return Err(global_object.throw_error(e.into(), "failed to connect to mysql"));
                }
            };
            this.connection_mut()
                .set_socket(AnySocket::SocketTcp(socket));
        }
        this.connection_mut().status = my_sql_connection::Status::Connecting;
        this.reset_connection_timeout();
        this.poll_ref.with_mut(|p| p.r#ref(vm.vm_ctx()));
        let js_value = js::to_js(ptr, global_object);
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

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)] — see JsClass note above.
    pub fn get_connected(this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(this.connection.get().status == my_sql_connection::Status::Connected)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn do_flush(this: &Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.register_auto_flusher();
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn do_close(
        this: &Self,
        _global_object: &JSGlobalObject,
        _: &CallFrame,
    ) -> JsResult<JSValue> {
        this.stop_timers();

        // Zig `defer this.updateReferenceType();` — R-2: `&Self` is `Copy`, so
        // the scopeguard closure captures a shared reborrow and the body's
        // `connection_mut()` borrow is non-overlapping.
        scopeguard::defer! {
            this.update_reference_type();
        }
        let queries = this.get_queries_array();
        this.connection_mut().clean_queue_and_close(None, queries);
        Ok(JSValue::UNDEFINED)
    }

    fn consume_on_connect_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.js_value.get().try_get() {
            return js::onconnect_take_cached(value, global_object);
        }
        None
    }

    fn consume_on_close_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.js_value.get().try_get() {
            return js::onclose_take_cached(value, global_object);
        }
        None
    }

    pub fn get_queries_array(&self) -> JSValue {
        if self.vm().is_shutting_down() {
            return JSValue::UNDEFINED;
        }
        if let Some(value) = self.js_value.get().try_get() {
            return js::queries_get_cached(value).unwrap_or(JSValue::UNDEFINED);
        }
        JSValue::UNDEFINED
    }

    #[inline]
    pub fn is_able_to_write(&self) -> bool {
        self.connection.get().is_able_to_write()
    }
    #[inline]
    pub fn is_connected(&self) -> bool {
        self.connection.get().status == my_sql_connection::Status::Connected
    }
    #[inline]
    pub fn can_pipeline(&self) -> bool {
        self.connection_mut().can_pipeline()
    }
    #[inline]
    pub fn can_prepare_query(&self) -> bool {
        self.connection_mut().can_prepare_query()
    }
    #[inline]
    pub fn can_execute_query(&self) -> bool {
        self.connection_mut().can_execute_query()
    }
    #[inline]
    pub fn get_writer(&self) -> NewWriter<my_sql_connection::Writer> {
        self.connection_mut().writer()
    }

    fn fail_fmt(&self, error_code: AnyMySQLErrorT, args: core::fmt::Arguments<'_>) {
        // bun.handleOom(std.fmt.allocPrint(...)) → write into Vec<u8>
        let mut message: Vec<u8> = Vec::new();
        {
            use std::io::Write;
            let _ = write!(&mut message, "{}", args);
        }

        let err = mysql_error_to_js(&self.global_object, &message, error_code);
        self.fail_with_js_value(err);
    }

    fn fail_with_js_value(&self, value: JSValue) {
        // Zig `this.ref(); defer { ...; updateReferenceType(); deref(); }` —
        // runs on every exit path. Re-enter through a raw pointer so no
        // reference is live across the potential free in `deref()`. LIFO drop
        // order: the `defer!` body runs first, then `_ref` releases the count
        // — matches Zig.
        let p = ParentRef::new(self);
        let _ref = self.ref_guard();
        scopeguard::defer! {
            // `_ref` has not yet dropped, so `*p` is still live; `ParentRef`
            // yields a fresh `&Self` per access (R-2: every callee is `&self`).
            if p.vm().is_shutting_down() {
                p.connection_mut().close();
            } else {
                let queries = p.get_queries_array();
                p.connection_mut().clean_queue_and_close(Some(value), queries);
            }
            p.update_reference_type();
        }
        self.stop_timers();

        if self.connection.get().status == my_sql_connection::Status::Failed {
            return;
        }

        self.connection_mut().status = my_sql_connection::Status::Failed;
        if self.vm().is_shutting_down() {
            return;
        }

        let Some(on_close) = self.consume_on_close_callback(&self.global_object) else {
            return;
        };
        on_close.ensure_still_alive();
        let loop_ = self.event_loop();
        // loop.enter();
        // defer loop.exit();
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

    pub fn on_connection_estabilished(&self) {
        if self.vm().is_shutting_down() {
            return;
        }
        let Some(on_connect) = self.consume_on_connect_callback(&self.global_object) else {
            return;
        };
        on_connect.ensure_still_alive();
        let js_value = self.js_value.get().try_get().unwrap_or(JSValue::UNDEFINED);
        js_value.ensure_still_alive();
        self.global_object
            .queue_microtask(on_connect, &[JSValue::NULL, js_value]);
    }

    pub fn on_query_result(&self, request: &JSMySQLQuery, result: MySQLQueryResult) {
        request.resolve(self.get_queries_array(), result);
    }

    pub fn on_result_row<C: bun_sql::mysql::protocol::ReaderContext>(
        &self,
        request: &JSMySQLQuery,
        statement: &mut MySQLStatement,
        reader: NewReader<C>,
    ) -> Result<(), OnResultRowError> {
        let result_mode = request.get_result_mode();
        let mut structure: JSValue = JSValue::UNDEFINED;
        // PORT NOTE: `MySQLStatement::structure(&mut self) -> &CachedStructure`
        // would keep `*statement` exclusively borrowed for the lifetime of the
        // returned ref, blocking the `&statement.columns` / `fields_flags` reads
        // below. Stash a `ParentRef` (lifetime-erased `&T`; Zig holds it by
        // value) and `as_deref` at the `to_js` call site — `*statement`
        // outlives this fn (held via `request`'s intrusive ref), satisfying
        // the `ParentRef` liveness invariant.
        let cached_structure: Option<ParentRef<CachedStructure>> = match result_mode {
            ResultMode::Objects => self.js_value.get().try_get().map(|value| {
                let cs = statement.structure(value, &self.global_object);
                structure = cs.js_value().unwrap_or(JSValue::UNDEFINED);
                ParentRef::new(cs)
            }),
            // no need to check for duplicate fields or structure
            ResultMode::Raw | ResultMode::Values => None,
        };
        let fields_flags = statement.fields_flags;
        // PERF(port): was stack-fallback allocator (4096 bytes)
        let mut row = ResultSet::Row {
            global_object: &self.global_object,
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
            self.connection_mut()
                .queue
                .mark_current_request_as_finished(request);
            request.reject(self.get_queries_array(), e);
            return Ok(());
        }
        let pending_value = request.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        // `ParentRef::Deref` recovers `&CachedStructure`; `*statement` is live
        // and not mutably borrowed for the duration of this `to_js` call.
        let cached_structure = cached_structure.as_deref();
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
        // `Row<'_>` has a Drop impl, so its `&statement.columns` borrow lives to
        // end-of-scope; drop it now so `statement.result_count += 1` may take `&mut`.
        drop(row);
        if let Some(err) = self.global_object.try_take_exception() {
            self.connection_mut()
                .queue
                .mark_current_request_as_finished(request);
            request.reject_with_js_value(self.get_queries_array(), err);
            return Ok(());
        }
        statement.result_count += 1;

        if pending_value.is_empty_or_undefined_or_null() {
            request.set_pending_value(row_value);
        }
        Ok(())
    }

    pub fn on_error(&self, request: Option<&JSMySQLQuery>, err: AnyMySQLErrorT) {
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

    pub fn on_error_packet(&self, request: Option<&JSMySQLQuery>, err: ErrorPacket) {
        if let Some(request) = request {
            if self.vm().is_shutting_down() {
                request.mark_as_failed();
            } else {
                if let Some(err_) = self.global_object.try_take_exception() {
                    request.reject_with_js_value(self.get_queries_array(), err_);
                } else {
                    request.reject_with_js_value(
                        self.get_queries_array(),
                        err.to_js(&self.global_object),
                    );
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
                self.fail_with_js_value(err.to_js(&self.global_object));
            }
        }
    }

    pub fn get_statement_from_signature_hash(
        &self,
        signature_hash: u64,
    ) -> Result<my_sql_connection::PreparedStatementsMapGetOrPutResult<'_>, bun_core::Error> {
        // TODO(port): narrow error set — `get_or_put` currently yields `AllocError`.
        self.connection_mut()
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
        if SSL {
            AnySocket::SocketTls(s.assume_ssl())
        } else {
            AnySocket::SocketTcp(s.assume_tcp())
        }
    }

    pub fn on_open(this: &JSMySQLConnection, s: NewSocketHandler<SSL>) {
        let socket = Self::_socket(s);
        let is_tcp = matches!(socket, AnySocket::SocketTcp(_));
        this.connection_mut().set_socket(socket);

        if is_tcp {
            // This handshake is not TLS handleshake is actually the MySQL handshake
            // When a connection is upgraded to TLS, the onOpen callback is called again and at this moment we dont wanna to change the status to handshaking
            this.connection_mut().status = my_sql_connection::Status::Handshaking;
            this.ref_(); // keep a ref for the socket
        }
        // Only set up the timers after all status changes are complete — the timers rely on the status to determine timeouts.
        this.setup_max_lifetime_timer_if_necessary();
        this.reset_connection_timeout();
        this.update_reference_type();
    }

    fn on_handshake_(
        this: &JSMySQLConnection,
        _: NewSocketHandler<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        let handshake_was_successful = match this.connection_mut().do_handshake(success, ssl_error)
        {
            Ok(v) => v,
            Err(e) => {
                return this.fail_fmt(e, format_args!("Failed to send handshake response"));
            }
        };
        if !handshake_was_successful {
            // ssl_error.toJS(this.#globalObject) catch return
            let Ok(v) = crate::jsc::verify_error_to_js(&ssl_error, &this.global_object) else {
                return;
            };
            this.fail_with_js_value(v);
        }
    }

    // pub const onHandshake = if (ssl) onHandshake_ else null;
    pub const ON_HANDSHAKE: Option<
        fn(&JSMySQLConnection, NewSocketHandler<SSL>, i32, uws::us_bun_verify_error_t),
    > = if SSL { Some(Self::on_handshake_) } else { None };

    pub fn on_close(
        this: &JSMySQLConnection,
        _: NewSocketHandler<SSL>,
        _: i32,
        _: Option<*mut c_void>,
    ) {
        // Zig `defer this.deref();` — releases the socket ref taken in on_open.
        // RAII guard adopts that existing ref (no `ref_()` here); raw-pointer
        // shaped so no reference outlives the potential free.
        let _ref = DerefOnDrop(this.as_ctx_ptr());
        this.fail(b"Connection closed", AnyMySQLErrorT::ConnectionClosed);
    }

    pub fn on_end(_: &JSMySQLConnection, socket: NewSocketHandler<SSL>) {
        // no half closed sockets
        socket.close(uws::CloseKind::Normal);
    }

    pub fn on_connect_error(this: &JSMySQLConnection, _: NewSocketHandler<SSL>, _: i32) {
        // TODO: proper propagation of the error
        this.fail(b"Connection closed", AnyMySQLErrorT::ConnectionClosed);
    }

    pub fn on_timeout(this: &JSMySQLConnection, _: NewSocketHandler<SSL>) {
        this.fail(b"Connection timeout", AnyMySQLErrorT::ConnectionTimedOut);
    }

    pub fn on_data(this: &JSMySQLConnection, _: NewSocketHandler<SSL>, data: &[u8]) {
        // Zig `this.ref(); defer this.deref();` + `defer { resetConnectionTimeout(); ... }`.
        // Both guards re-enter via raw pointer so no reference is live across
        // the potential free. Guard drop order is LIFO, so `_ref` (deref) runs
        // last — matches Zig.
        let p = ParentRef::new(this);
        let _ref = this.ref_guard();

        scopeguard::defer! {
            // `_ref` has not yet dropped, so `*p` is still live; `ParentRef`
            // yields a fresh `&JSMySQLConnection` per access (R-2: every
            // callee is `&self`).
            // reset the connection timeout after we're done processing the data
            p.reset_connection_timeout();
            p.update_reference_type();
            p.register_auto_flusher();
        }
        if this.vm().is_shutting_down() {
            // we are shutting down lets not process the data
            return;
        }

        let _loop_guard = this.event_loop().entered();
        this.ensure_js_value_is_alive();

        if let Err(e) = this.connection_mut().read_and_process_data(data) {
            this.on_error(None, e);
        }
    }

    pub fn on_writable(this: &JSMySQLConnection, _: NewSocketHandler<SSL>) {
        this.connection_mut().reset_backpressure();
        this.drain_internal();
    }
}

#[derive(strum::IntoStaticStr, Debug)]
pub enum OnResultRowError {
    ShortRead,
    JSError,
}
bun_core::impl_tag_error!(OnResultRowError);
bun_core::named_error_set!(OnResultRowError);
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

// ported from: src/sql_jsc/mysql/JSMySQLConnection.zig
