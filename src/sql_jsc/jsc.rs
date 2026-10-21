//! `bun_jsc` re-export façade for the SQL bindings.
//!
//! All core handle types (`JSValue`, `JSGlobalObject`, `CallFrame`, `JsError`,
//! `JsResult`, `JSObject`, `JSType`, [`VirtualMachine`],
//! [`EventLoop`], [`KeepAlive`], …) are **re-exported from `bun_jsc` /
//! `bun_io`** so the `#[bun_jsc::JsClass]` / `#[bun_jsc::host_fn]` proc-macros
//! see identical types. SQL-specific helpers that `bun_jsc` doesn't expose at
//! this tier are provided as extension traits ([`JSGlobalObjectSqlExt`],
//! [`VirtualMachineSqlExt`], [`EventLoopSqlExt`]).
//!
//! [`RareData`] here is the **per-VM SQL state** (`mysql_context` /
//! `postgresql_context`) that `bun_runtime::jsc_hooks::RuntimeState` owns by
//! value — it is *not* a view of `bun_jsc::rare_data::RareData` (which holds
//! the per-protocol `SocketGroup`s and is reached via the inherent
//! `VirtualMachine::rare_data()`).

#![warn(unused_must_use)]

use core::cell::Cell;
use core::ffi::{c_char, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;

pub use bun_jsc::{
    CallFrame, ErrorBuilder, ErrorCode, ExternColumnIdentifier, GlobalRef, JSArrayIterator,
    JSGlobalObject, JSObject, JSType, JSValue, JsCell, JsError, JsRef, JsResult,
    MarkedArgumentBuffer, StringJsc, Strong, StrongOptional, bun_string_jsc,
};

pub use bun_jsc::IntegerRange;

// `impl From<bun_jsc::JsError> for bun_sql::*` would be an orphan impl, hence free functions.
#[inline]
pub(crate) fn js_error_to_postgres(e: JsError) -> bun_sql::postgres::AnyPostgresError {
    use bun_sql::postgres::AnyPostgresError as E;
    match e {
        JsError::Thrown | JsError::Terminated => E::JSError,
        JsError::OutOfMemory => E::OutOfMemory,
    }
}
#[inline]
pub(crate) fn js_error_to_mysql(e: JsError) -> bun_sql::mysql::protocol::any_mysql_error::Error {
    use bun_sql::mysql::protocol::any_mysql_error::Error as E;
    match e {
        JsError::Thrown | JsError::Terminated => E::JSError,
        JsError::OutOfMemory => E::OutOfMemory,
    }
}

/// `SQLErrorClass` in SQLError.cpp.
#[repr(u8)]
#[derive(Clone, Copy)]
pub(crate) enum SQLErrorClass {
    Postgres = 0,
    MySQL = 1,
}

/// Runs no JS. The caller puts the fields other than `message`, `name` and `stack`.
pub(crate) fn create_sql_error(
    global: &JSGlobalObject,
    class: SQLErrorClass,
    message: &[u8],
) -> JsResult<JSValue> {
    unsafe extern "C" {
        fn Bun__SQLError__create(
            global: &JSGlobalObject,
            class: SQLErrorClass,
            message: *const u8,
            message_length: usize,
        ) -> JSValue;
    }
    bun_jsc::host_fn::from_js_host_call(global, || {
        // SAFETY: C++ copies the `message.len()` bytes before it returns.
        unsafe { Bun__SQLError__create(global, class, message.as_ptr(), message.len()) }
    })
}

pub use bun_jsc::system_error::verify_error_to_js;

// The same as `bun_runtime::socket::uws_jsc::create_bun_socket_error_to_js`: importing that one
// would be a cycle (`bun_runtime` depends on this crate).

/// `BoringSSL.ERR_toJS` — formats the packed error code into a JS Error with
/// code `BORINGSSL`. Body mirrors `bun_runtime::crypto::boringssl_jsc::err_to_js`
/// (unreachable from here without a cycle).
fn boringssl_err_to_js(global: &JSGlobalObject, err_code: u32) -> JSValue {
    const PREFIX: &[u8] = b"BoringSSL ";
    let mut outbuf = [0u8; 128 + 1 + PREFIX.len()];
    outbuf[..PREFIX.len()].copy_from_slice(PREFIX);
    let message_buf = &mut outbuf[PREFIX.len()..];
    // SAFETY: `message_buf` is a valid writable buffer of `message_buf.len()` bytes.
    unsafe {
        bun_boringssl_sys::ERR_error_string_n(
            err_code,
            message_buf.as_mut_ptr().cast::<core::ffi::c_char>(),
            message_buf.len(),
        );
    }
    let error_message: &[u8] = bun_core::slice_to_nul(&outbuf[..]);
    if error_message.len() == PREFIX.len() {
        return global
            .err(
                ErrorCode::BORINGSSL,
                format_args!("An unknown BoringSSL error occurred: {}", err_code),
            )
            .to_js();
    }
    global
        .err(
            ErrorCode::BORINGSSL,
            format_args!("{}", bstr::BStr::new(error_message)),
        )
        .to_js()
}

pub(crate) fn create_bun_socket_error_to_js(
    err: bun_uws::create_bun_socket_error_t,
    global: &JSGlobalObject,
) -> JSValue {
    use bun_uws::create_bun_socket_error_t as E;
    match err {
        // `us_ssl_ctx_from_options` only sets *err for the CA/cipher cases;
        // bad cert/key/DH return NULL with `.none` and the detail is on the
        // BoringSSL error queue. Surfacing it here keeps every
        // `getOrCreateOpts(...) orelse return err.toJS()` site correct.
        E::none => boringssl_err_to_js(global, bun_boringssl_sys::ERR_get_error()),
        E::load_ca_file => global
            .err(ErrorCode::BORINGSSL, format_args!("Failed to load CA file"))
            .to_js(),
        E::invalid_ca_file => global
            .err(ErrorCode::BORINGSSL, format_args!("Invalid CA file"))
            .to_js(),
        E::invalid_ca => global
            .err(ErrorCode::BORINGSSL, format_args!("Invalid CA"))
            .to_js(),
        E::invalid_ciphers => global
            .err(ErrorCode::BORINGSSL, format_args!("Invalid ciphers"))
            .to_js(),
        E::invalid_crl => global
            .err(
                ErrorCode::ERR_CRYPTO_OPERATION_FAILED,
                format_args!("Failed to parse CRL"),
            )
            .to_js(),
        E::invalid_ecdh_curve => global
            .err(
                ErrorCode::ERR_CRYPTO_OPERATION_FAILED,
                format_args!("Failed to set ECDH curve"),
            )
            .to_js(),
    }
}

/// SQL-side helpers on `JSGlobalObject` not provided by `bun_jsc` (or where
/// the SQL bindings need a slightly different signature).
pub(crate) trait JSGlobalObjectSqlExt {
    fn err_out_of_range<'a>(&'a self, args: core::fmt::Arguments<'a>) -> ErrorBuilder<'a>;
}

impl JSGlobalObjectSqlExt for JSGlobalObject {
    #[inline]
    fn err_out_of_range<'a>(&'a self, args: core::fmt::Arguments<'a>) -> ErrorBuilder<'a> {
        self.err(ErrorCode::OUT_OF_RANGE, args)
    }
}

pub use bun_io::KeepAlive;
pub use bun_jsc::event_loop::{EventLoop, EventLoopEnterGuard as EventLoopGuard};
pub use bun_jsc::virtual_machine::VirtualMachine;

// `bun_runtime` owns the per-VM `RuntimeState` (timer heap, SSLContextCache, SSLConfig parser) and
// depends on this crate, so importing it would be a cycle. This crate defines the table of
// function pointers, `bun_runtime::hw_exports::sql_hooks` the one instance.
pub struct SqlRuntimeHooks {
    /// `&mut runtime_state().sql_rare` — this crate's [`RareData`] storage.
    pub sql_rare: unsafe fn(*mut VirtualMachine) -> *mut RareData,
    /// `&mut runtime_state().timer` — opaque `bun_runtime::timer::All`.
    pub timer_heap: unsafe fn(*mut VirtualMachine) -> *mut c_void,
    /// `Timer.All.insert` — push an intrusive `EventLoopTimer` into the heap.
    pub timer_insert: unsafe fn(heap: *mut c_void, *mut EventLoopTimer),
    /// `Timer.All.remove`.
    pub timer_remove: unsafe fn(heap: *mut c_void, *mut EventLoopTimer),
    /// `&mut runtime_state().ssl_ctx_cache` — opaque `SSLContextCache`.
    pub ssl_ctx_cache: unsafe fn(*mut VirtualMachine) -> *mut c_void,
    /// `SSLContextCache::getOrCreateOpts` — digest-keyed weak `SSL_CTX*` cache.
    pub ssl_ctx_get_or_create: unsafe fn(
        cache: *mut c_void,
        opts: &bun_uws::us_bun_socket_context_options_t,
        err: &mut bun_uws::create_bun_socket_error_t,
    ) -> Option<OwnedSslCtx>,
    /// `SSLConfig::fromJS` — parse a JS TLS-options object. Returns a boxed
    /// `bun_runtime::socket::SSLConfig` (caller frees via `ssl_config_free`),
    /// or null when the value contained no TLS config / threw (caller checks
    /// `global.has_exception()`).
    pub ssl_config_from_js: unsafe fn(&JSGlobalObject, JSValue) -> *mut c_void,
    /// Drop a boxed `SSLConfig` returned by `ssl_config_from_js`.
    pub ssl_config_free: unsafe fn(*mut c_void),
    /// `SSLConfig::asUSocketsForClientVerification`.
    pub ssl_config_as_usockets_client:
        unsafe fn(*const c_void) -> bun_uws::us_bun_socket_context_options_t,
    /// `SSLConfig.server_name` — null when unset.
    pub ssl_config_server_name: unsafe fn(*const c_void) -> *const c_char,
    /// `SSLConfig.reject_unauthorized`.
    pub ssl_config_reject_unauthorized: unsafe fn(*const c_void) -> i32,
}

unsafe extern "Rust" {
    /// The single `&'static` instance, defined `#[no_mangle]` in
    /// `bun_runtime::hw_exports::sql_hooks`. Link-time resolved — no
    /// `AtomicPtr`, no init-order hazard. Immutable POD vtable, so reading it
    /// has no preconditions beyond the link succeeding → `safe static`.
    safe static __BUN_SQL_RUNTIME_HOOKS: SqlRuntimeHooks;
}

#[inline]
fn hooks() -> &'static SqlRuntimeHooks {
    &__BUN_SQL_RUNTIME_HOOKS
}

/// Per-VM SQL state — the concrete crate::mysql::MySQLContext /
/// crate::postgres::PostgresSQLContext.
/// The bun_jsc::rare_data::RareData slots for these are opaque
/// (cycle break: bun_jsc cannot name bun_sql_jsc types), so the storage lives
/// in bun_runtime::jsc_hooks::RuntimeState.sql_rare and is reached via
/// [VirtualMachineSqlExt::sql_state].
#[repr(C)]
pub struct RareData {
    pub mysql_context: crate::mysql::MySQLContext,
    pub postgresql_context: crate::postgres::PostgresSQLContext,
}

/// SQL-specific accessors on [VirtualMachine] for state owned by the
/// higher-tier bun_runtime::jsc_hooks::RuntimeState.
pub(crate) trait VirtualMachineSqlExt {
    /// RareData.{mysql,postgresql}_context. Named sql_state to avoid
    /// shadowing the inherent VirtualMachine::rare_data() (which returns the
    /// bun_jsc RareData holding the per-protocol SocketGroups).
    fn sql_state(&mut self) -> &mut RareData;
    /// vm.timer — the Timer::All heap, owned by RuntimeState.
    fn timer(&mut self) -> &mut TimerHeap;
    /// RareData.ssl_ctx_cache — owned by RuntimeState.
    fn ssl_ctx_cache(&mut self) -> &mut SslCtxCache;
    /// bun_io::EventLoopCtx for the JS-thread VM, for KeepAlive::{ref_,unref}.
    fn vm_ctx(&self) -> bun_io::EventLoopCtx;
    /// `context`'s per-protocol uws [`bun_uws::SocketGroup`], for a new connection its script opens.
    fn postgres_socket_group<const SSL: bool>(
        &mut self,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> &mut bun_uws::SocketGroup;
    /// See [`Self::postgres_socket_group`].
    fn mysql_socket_group<const SSL: bool>(
        &mut self,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> &mut bun_uws::SocketGroup;
}
impl VirtualMachineSqlExt for VirtualMachine {
    #[inline]
    fn sql_state(&mut self) -> &mut RareData {
        // SAFETY: hook returns `&mut runtime_state().sql_rare`; non-null on
        // the JS thread once `init_runtime_state` has run.
        unsafe { &mut *(hooks().sql_rare)(self) }
    }
    #[inline]
    fn timer(&mut self) -> &mut TimerHeap {
        // SAFETY: hook returns `&mut runtime_state().timer`; non-null after
        // `init_runtime_state`. `TimerHeap` is an opaque newtype over the
        // `*mut c_void` so callers stay typed.
        unsafe { &mut *(hooks().timer_heap)(self).cast::<TimerHeap>() }
    }
    #[inline]
    fn ssl_ctx_cache(&mut self) -> &mut SslCtxCache {
        // SAFETY: hook returns `&mut runtime_state().ssl_ctx_cache`; non-null
        // after `init_runtime_state`.
        unsafe { &mut *(hooks().ssl_ctx_cache)(self).cast::<SslCtxCache>() }
    }
    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }
    #[inline]
    fn postgres_socket_group<const SSL: bool>(
        &mut self,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> &mut bun_uws::SocketGroup {
        let loop_ = self.uws_loop();
        self.client_socket_groups_in(context)
            .postgres_group::<SSL>(loop_)
    }
    #[inline]
    fn mysql_socket_group<const SSL: bool>(
        &mut self,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> &mut bun_uws::SocketGroup {
        let loop_ = self.uws_loop();
        self.client_socket_groups_in(context)
            .mysql_group::<SSL>(loop_)
    }
}

/// RAII enter()/exit() for [EventLoop] — wraps the inherent (unsafe,
/// raw-pointer) bun_jsc::event_loop::EventLoop::enter_scope.
pub(crate) trait EventLoopSqlExt {
    fn entered(&mut self) -> EventLoopGuard;
}
impl EventLoopSqlExt for EventLoop {
    #[inline]
    fn entered(&mut self) -> EventLoopGuard {
        // SAFETY: self is the live VM-owned event loop; the guard holds the
        // raw pointer so no &mut is held across re-entrant JS.
        unsafe { EventLoop::enter_scope(self) }
    }
}

/// What `callback` throws is reported, not returned.
pub(crate) fn run_callback(global: &JSGlobalObject, callback: JSValue, arguments: &[JSValue]) {
    VirtualMachine::get_mut().event_loop_mut().run_callback(
        bun_event_loop::ContextId::NONE,
        callback,
        global,
        JSValue::UNDEFINED,
        arguments,
    );
}

pub use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};

// `bun_runtime::timer::All` — heap of `EventLoopTimer`. Opaque on this side
// (the layout is high-tier); insert/remove forward to `bun_runtime` via the
// [`SqlRuntimeHooks`] vtable.
bun_opaque::opaque_ffi! { pub struct TimerHeap; }
impl TimerHeap {
    pub(crate) fn insert(&mut self, t: *mut EventLoopTimer) {
        // SAFETY: `self` is `&mut runtime_state().timer`; `t` is a live
        // intrusive heap node whose provenance covers its container.
        unsafe { (hooks().timer_insert)(self._p.get().cast::<c_void>(), t) }
    }
    pub(crate) fn remove(&mut self, t: &mut EventLoopTimer) {
        // SAFETY: `self` is `&mut runtime_state().timer`; `t` was previously
        // inserted by the caller.
        unsafe { (hooks().timer_remove)(self._p.get().cast::<c_void>(), t) }
    }
}

/// A connection that writes what one turn of JS queued on it in one flush, at the end of the turn.
pub(crate) trait AutoFlush: Sized {
    fn vm(&self) -> &VirtualMachine;
    fn auto_flush_registered(&self) -> &Cell<bool>;
    /// Connected, without backpressure, and with something to write.
    fn can_flush(&self) -> bool;
    /// Returns what it left in `auto_flush_registered`: whether to run again after the next turn.
    fn on_auto_flush(&self) -> bool;

    fn register_auto_flusher(&self) {
        extern "C" fn run<T: AutoFlush>(ctx: *mut c_void) -> bool {
            let this = NonNull::new(ctx.cast::<T>()).expect("auto-flush ctx non-null");
            bun_ptr::ParentRef::from(this).on_auto_flush()
        }
        if !self.auto_flush_registered().get() && self.can_flush() {
            let tasks = &mut self.vm().event_loop_mut().deferred_tasks;
            tasks.post_task(Some(NonNull::from(self).cast()), run::<Self>);
            self.auto_flush_registered().set(true);
        }
    }

    fn unregister_auto_flusher(&self) {
        if self.auto_flush_registered().replace(false) {
            let tasks = &mut self.vm().event_loop_mut().deferred_tasks;
            tasks.unregister_task(Some(NonNull::from(self).cast()));
        }
    }
}

// The full `SSLConfig` is high-tier (it pulls in `node::fs` / `webcore::Blob`), so it lives in
// `bun_runtime`. This side owns a pointer to it and reads what SQL needs through the hooks.
pub mod api {
    use super::*;
    pub mod server_config {
        use super::*;

        /// Owning handle to a `Box<bun_runtime::socket::SSLConfig>`. `None` =
        /// the default-constructed config — callers that pass
        /// `tls: true` get an SSLConfig with no overrides.
        #[derive(Default)]
        pub struct SSLConfig(Option<NonNull<c_void>>);

        // SAFETY: the boxed `bun_runtime::socket::SSLConfig` is `Send` (only
        // `CString`/`Vec`/`AtomicU64` fields); the handle moves between
        // construction and the connection struct on the same JS thread anyway.
        unsafe impl Send for SSLConfig {}

        impl Drop for SSLConfig {
            fn drop(&mut self) {
                if let Some(p) = self.0.take() {
                    // SAFETY: `p` was returned by `ssl_config_from_js` and not
                    // yet freed (Option::take guarantees single drop).
                    unsafe { (hooks().ssl_config_free)(p.as_ptr()) }
                }
            }
        }

        impl SSLConfig {
            /// `SSLConfig.server_name` — the SNI hostname C string, or null
            /// when unset / default.
            #[inline]
            pub(crate) fn server_name(&self) -> *const c_char {
                match self.0 {
                    None => core::ptr::null(),
                    // SAFETY: live boxed SSLConfig; hook returns a borrow into
                    // its `Option<CString>` field, valid for `self`'s lifetime.
                    Some(p) => unsafe { (hooks().ssl_config_server_name)(p.as_ptr()) },
                }
            }

            /// [`server_name`](Self::server_name) as the name a certificate carries: an IPv6 literal without its brackets. Empty when unset.
            pub(crate) fn server_name_bytes(&self) -> &[u8] {
                let server_name = self.server_name();
                if server_name.is_null() {
                    return b"";
                }
                // SAFETY: NUL-terminated C string that the boxed SSLConfig owns.
                let name = unsafe { core::ffi::CStr::from_ptr(server_name) }.to_bytes();
                bun_core::ip_address::strip_ipv6_brackets(name)
            }

            /// `SSLConfig.reject_unauthorized` — non-zero rejects on verify error.
            #[inline]
            pub(crate) fn reject_unauthorized(&self) -> i32 {
                match self.0 {
                    None => 0,
                    // SAFETY: live boxed SSLConfig.
                    Some(p) => unsafe { (hooks().ssl_config_reject_unauthorized)(p.as_ptr()) },
                }
            }

            /// `server_name` as SNI. `None` when unset or an IP literal, bracketed or not (RFC 6066 section 3).
            pub(crate) fn sni(&self) -> Option<&core::ffi::CStr> {
                let server_name = self.server_name();
                if server_name.is_null() {
                    return None;
                }
                // SAFETY: NUL-terminated C string owned by the boxed SSLConfig
                // for `self`'s lifetime.
                let name = unsafe { bun_core::ffi::cstr(server_name) };
                let bare = bun_core::ip_address::strip_ipv6_brackets(name.to_bytes());
                let bracketed = bare.len() != name.to_bytes().len();
                (!bracketed && !bun_core::ip_address::is_ip_host(bare)).then_some(name)
            }

            pub(crate) fn from_js(
                global: &JSGlobalObject,
                value: JSValue,
            ) -> JsResult<Option<Self>> {
                // SAFETY: hook contract — may run JS getters / throw.
                let p = unsafe { (hooks().ssl_config_from_js)(global, value) };
                if global.has_exception() {
                    debug_assert!(p.is_null());
                    return Err(JsError::Thrown);
                }
                Ok(NonNull::new(p).map(|p| Self(Some(p))))
            }

            /// `SSLConfig.asUSocketsForClientVerification` — projects to the
            /// `#[repr(C)]` `us_bun_socket_context_options_t` for client mode
            /// (request_cert=1, reject_unauthorized=0; SQL re-verifies hostname
            /// itself). Returns `Default` for the empty/`tls:true` config.
            pub(crate) fn as_usockets_for_client_verification(
                &self,
            ) -> bun_uws::us_bun_socket_context_options_t {
                match self.0 {
                    None => bun_uws::us_bun_socket_context_options_t {
                        request_cert: 1,
                        reject_unauthorized: 0,
                        ..Default::default()
                    },
                    // SAFETY: live boxed SSLConfig.
                    Some(p) => unsafe { (hooks().ssl_config_as_usockets_client)(p.as_ptr()) },
                }
            }
        }
    }
}

// The getters and setters of the cached slots that `.classes.ts` declares.
pub mod codegen {
    ::bun_jsc::js_class_module!(JSPostgresSQLConnection = "PostgresSQLConnection"
        as crate::postgres::PostgresSQLConnection { onconnect, onclose, onretire, checkServerIdentity, onnotification, columnTransform });
    ::bun_jsc::js_class_module!(JSPostgresSQLQuery = "PostgresSQLQuery"
        as crate::postgres::PostgresSQLQuery { binding, copy, pendingValue, target });

    ::bun_jsc::js_class_module!(js_mysql_query = "MySQLQuery"
        as crate::mysql::js_my_sql_query::JSMySQLQuery { binding, pendingValue, target });
}

// `bun_jsc::JSFunction::create` has another signature. SQL only needs the `JSHostFn` thunk.
#[repr(C)]
pub(crate) struct JSFunction {
    _opaque: [u8; 0],
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

/// `jsc.JSHostFn` — the JSC-ABI host-function pointer JSC dispatches to
/// (`extern "sysv64"` on win-x64, `extern "C"` elsewhere). Re-exported from
/// `bun_jsc` so the cfg-split lives in one place.
pub use bun_jsc::host_fn::JsHostFn as JSHostFn;

pub(crate) trait IntoJSHostFn<Marker>: Sized {
    fn into_js_host_fn(self) -> JSHostFn;
}
#[doc(hidden)]
pub(crate) struct HostFnResult;
#[doc(hidden)]
pub(crate) struct HostFnPlain;

// `jsc_host_abi!` can't express a generic `where` clause, so cfg-split the
// thunk body manually (sysv64 on win-x64, C elsewhere — matches `JSHostFn`).
// The where-clause is bracketed to avoid `tt`-muncher ambiguity against `{`.
// Thunk bodies scope their raw-ptr derefs locally, so the fn itself has no
// caller preconditions; a safe `extern fn` coerces to the `JSHostFn` type.
macro_rules! sql_jsc_host_thunk {
    ($name:ident<$F:ident>($($args:tt)*) -> $ret:ty where [$($bound:tt)+] $body:block) => {
        #[cfg(all(windows, target_arch = "x86_64"))]
        extern "sysv64" fn $name<$F>($($args)*) -> $ret where $($bound)+ $body
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        extern "C" fn $name<$F>($($args)*) -> $ret where $($bound)+ $body
    };
}

impl<F> IntoJSHostFn<HostFnResult> for F
where
    F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static,
{
    fn into_js_host_fn(self) -> JSHostFn {
        debug_assert_eq!(
            core::mem::size_of::<F>(),
            0,
            "IntoJSHostFn: expected fn item (ZST)"
        );
        let _ = self;
        sql_jsc_host_thunk! {
            thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
            where [F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static]
            {
                let f: F = bun_core::ffi::conjure_zst::<F>();
                // JSC passes live non-null `*JSGlobalObject` / `*CallFrame`; both
                // strictly outlive the host-fn call, satisfying the `ParentRef`
                // invariant. Safe `From<NonNull>` + `Deref` collapse the per-thunk
                // raw `&*ptr` pair to one audited deref site in `bun_ptr`.
                let global = bun_ptr::ParentRef::from(NonNull::new(g).expect("JSC host fn: global non-null"));
                let frame = bun_ptr::ParentRef::from(NonNull::new(c).expect("JSC host fn: callframe non-null"));
                match f(&global, &frame) {
                    Ok(v) => v,
                    Err(JsError::OutOfMemory) => { let _ = global.throw_out_of_memory(); JSValue::ZERO }
                    Err(_) => JSValue::ZERO,
                }
            }
        }
        thunk::<F>
    }
}
impl<F> IntoJSHostFn<HostFnPlain> for F
where
    F: Fn(&JSGlobalObject, &CallFrame) -> JSValue + Copy + 'static,
{
    fn into_js_host_fn(self) -> JSHostFn {
        debug_assert_eq!(
            core::mem::size_of::<F>(),
            0,
            "IntoJSHostFn: expected fn item (ZST)"
        );
        let _ = self;
        sql_jsc_host_thunk! {
            thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
            where [F: Fn(&JSGlobalObject, &CallFrame) -> JSValue + Copy + 'static]
            {
                let f: F = bun_core::ffi::conjure_zst::<F>();
                // JSC passes live non-null pointers; both outlive the host-fn
                // call (the `ParentRef` invariant). Safe `Deref` recovers `&T`.
                let global = bun_ptr::ParentRef::from(NonNull::new(g).expect("JSC host fn: global non-null"));
                let frame = bun_ptr::ParentRef::from(NonNull::new(c).expect("JSC host fn: callframe non-null"));
                f(&global, &frame)
            }
        }
        thunk::<F>
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Default)]
pub enum ImplementationVisibility {
    #[default]
    Public = 0,
    Private = 1,
    PrivateRecursive = 2,
}
#[repr(u8)]
#[derive(Clone, Copy, Default)]
pub enum Intrinsic {
    #[default]
    None = 0,
}
#[derive(Clone, Copy, Default)]
pub struct CreateJSFunctionOptions {
    pub(crate) implementation_visibility: ImplementationVisibility,
    pub(crate) intrinsic: Intrinsic,
    pub(crate) constructor: Option<JSHostFn>,
}

unsafe extern "C" {
    // `&JSGlobalObject` is ABI-identical to a non-null `*const JSGlobalObject`;
    // remaining args are by-value scalars/fn-ptrs. No caller-side memory
    // preconditions remain → `safe fn`.
    safe fn JSFunction__createFromZig(
        global: &JSGlobalObject,
        fn_name: &bun_core::String,
        implementation: JSHostFn,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: Option<JSHostFn>,
    ) -> JSValue;
}

/// `bun_jsc::create_host_function_object`-shaped helper for the SQL binding
/// objects. Macro (not fn) because each entry's `$f` is a *distinct* fn-item
/// ZST routed through [`IntoJSHostFn`] — a `&[(&str, JSHostFn, u32)]` slice
/// can't hold heterogeneous safe-Rust signatures. Expands to the same
/// `put`/`JSFunction::create` ladder the open-coded sites used; returns the
/// receiver for chaining.
#[macro_export]
macro_rules! put_host_functions {
    ($obj:expr, $global:expr, [ $( ($name:literal, $f:expr, $arity:expr) ),* $(,)? ]) => {{
        let __obj: $crate::jsc::JSValue = $obj;
        let __g = $global;
        $(
            __obj.put(
                __g,
                $name.as_bytes(),
                $crate::jsc::JSFunction::create(__g, $name, $f, $arity, ::core::default::Default::default()),
            );
        )*
        __obj
    }};
}

impl JSFunction {
    /// Accepts a safe Rust `fn(&JSGlobalObject, &CallFrame) -> JSValue` /
    /// `-> JsResult<JSValue>` via [`IntoJSHostFn`].
    pub(crate) fn create<M, F: IntoJSHostFn<M>>(
        global: &JSGlobalObject,
        name: &str,
        implementation: F,
        arg_count: u32,
        opts: CreateJSFunctionOptions,
    ) -> JSValue {
        let implementation: JSHostFn = implementation.into_js_host_fn();
        let fn_name = bun_core::String::from_bytes(name.as_bytes());
        JSFunction__createFromZig(
            global,
            &fn_name,
            implementation,
            arg_count,
            opts.implementation_visibility,
            opts.intrinsic,
            opts.constructor,
        )
    }
}

// Opaque handle to `bun_runtime::api::SSLContextCache` (owned by
// `RuntimeState`). Reached via [`VirtualMachineSqlExt::ssl_ctx_cache`]; backed
// by [`SqlRuntimeHooks::ssl_ctx_cache`] / `ssl_ctx_get_or_create`.
use bun_boringssl_sys::OwnedSslCtx;

bun_opaque::opaque_ffi! { pub struct SslCtxCache; }
impl SslCtxCache {
    pub(crate) fn get_or_create_opts(
        &mut self,
        opts: &bun_uws::us_bun_socket_context_options_t,
        err: &mut bun_uws::create_bun_socket_error_t,
    ) -> Option<OwnedSslCtx> {
        // SAFETY: `self` is `&mut runtime_state().ssl_ctx_cache`; `opts`/`err`
        // are caller stack locals.
        unsafe { (hooks().ssl_ctx_get_or_create)(self._p.get().cast::<c_void>(), opts, err) }
    }
}
