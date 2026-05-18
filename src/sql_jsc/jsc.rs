//! `bun_jsc` re-export façade for the SQL bindings.
//!
//! All core handle types (`JSValue`, `JSGlobalObject`, `CallFrame`, `JsError`,
//! `JsResult`, `JSObject`, `JSCell`, `JSType`, [`VirtualMachine`],
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

#![allow(unused_variables, non_snake_case, dead_code, unused_imports)]
#![warn(unused_must_use)]

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;

// ──────────────────────────────────────────────────────────────────────────
// Core handles — re-exported from `bun_jsc` so proc-macro generated wrappers
// (which hard-code `bun_jsc::JSGlobalObject` / `bun_jsc::CallFrame` / …) see
// the same types as user code importing `crate::jsc::*`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_jsc::{
    ArrayBuffer, CallFrame, CoerceTo, ErrorBuilder, ErrorCode, ExternColumnIdentifier,
    ExternColumnIdentifierValue, GlobalRef, JSArrayIterator, JSCell, JSGlobalObject, JSObject,
    JSType, JSValue, JsCell, JsError, JsRef, JsResult, MarkedArgumentBuffer, StringJsc,
    StrongOptional, ThrowFmtArgs, ZigStringJsc, bun_string_jsc, host_fn,
};

/// Re-export — `bun_jsc` now defines `IntegerRange` at its crate root and the
/// inherent `JSGlobalObject::{validate_integer_range, validate_big_int_range}`
/// take it directly, so the previous local mirror is gone.
pub use bun_jsc::IntegerRange;

/// Back-compat alias — earlier ports named this `ErrBuilder`.
pub type ErrBuilder<'a> = bun_jsc::ErrorBuilder<'a>;

// ──────────────────────────────────────────────────────────────────────────
// Error bridging.
//
// `impl From<bun_jsc::JsError> for bun_sql::*` would be an orphan (both types
// foreign to this crate), so the conversions are exposed as free fns instead.
// Callers use `.map_err(jsc::js_error_to_postgres)?` / `..._to_mysql)?`.
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn js_error_to_postgres(e: JsError) -> bun_sql::postgres::AnyPostgresError {
    use bun_sql::postgres::AnyPostgresError as E;
    match e {
        JsError::Thrown => E::JSError,
        JsError::OutOfMemory => E::OutOfMemory,
        JsError::Terminated => E::JSTerminated,
    }
}
#[inline]
pub fn js_error_to_mysql(e: JsError) -> bun_sql::mysql::protocol::any_mysql_error::Error {
    use bun_sql::mysql::protocol::any_mysql_error::Error as E;
    match e {
        JsError::Thrown => E::JSError,
        JsError::OutOfMemory => E::OutOfMemory,
        JsError::Terminated => E::JSTerminated,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// host_fn helpers (mirrors bun_jsc::host_fn::from_js_host_call*; kept local
// for the few extension-trait bodies below that call extern "C" symbols
// directly).
// ──────────────────────────────────────────────────────────────────────────
#[inline]
fn from_js_host_call(global: &JSGlobalObject, v: JSValue) -> JsResult<JSValue> {
    if global.has_exception() {
        return Err(JsError::Thrown);
    }
    debug_assert!(
        !v.is_empty(),
        "fromJSHostCall: empty JSValue with no pending exception"
    );
    Ok(v)
}
#[inline]
fn from_js_host_call_generic<R>(global: &JSGlobalObject, r: R) -> JsResult<R> {
    if global.has_exception() {
        Err(JsError::Thrown)
    } else {
        Ok(r)
    }
}

// `uws.us_bun_verify_error_t::toJS` — sunk to `bun_jsc::system_error` so both
// `bun_runtime` and this crate import the single canonical body (was
// triplicated across runtime/socket/uws_jsc, here, and PostgresSQLConnection).
pub use bun_jsc::system_error::verify_error_to_js;

// ──────────────────────────────────────────────────────────────────────────
// uws.create_bun_socket_error_t::toJS
//
// Same layering note as `verify_error_to_js` above: canonical impl lives in
// `bun_runtime::socket::uws_jsc::create_bun_socket_error_to_js`, but importing
// it would cycle (`bun_runtime` depends on this crate). The body only needs
// `bun_uws` + `bun_boringssl_sys` + `bun_jsc` (all lower-tier), so it is hosted
// here for the SQL connection `createInstance` paths. Matches
// `src/runtime/socket/uws_jsc.zig`.
// ──────────────────────────────────────────────────────────────────────────

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

pub fn create_bun_socket_error_to_js(
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
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSGlobalObject — SQL-specific extension surface.
// ──────────────────────────────────────────────────────────────────────────

/// SQL-side helpers on `JSGlobalObject` not provided by `bun_jsc` (or where
/// the SQL bindings need a slightly different signature).
pub trait JSGlobalObjectSqlExt {
    fn err_out_of_range<'a>(&'a self, args: core::fmt::Arguments<'a>) -> ErrorBuilder<'a>;
    fn throw_invalid_arguments_fmt(&self, args: core::fmt::Arguments<'_>) -> JsResult<JSValue>;
    /// `globalObject.bunVM()` — `bun_jsc::JSGlobalObject::bun_vm()` returns
    /// `&mut VirtualMachine`; this `&`-receiver form is for SQL callsites that
    /// only need shared access.
    fn sql_vm(&self) -> &VirtualMachine;
    fn sql_vm_ptr(&self) -> *mut VirtualMachine;

    // PORT NOTE: `validate_integer_range` / `validate_big_int_range` /
    // `gregorian_date_time_to_ms` were duplicated here while gated in
    // `bun_jsc`; all three are now inherent on `bun_jsc::JSGlobalObject`, so
    // the trait copies are removed (inherent methods always win in
    // resolution, so the trait versions were dead code anyway).
}

impl JSGlobalObjectSqlExt for JSGlobalObject {
    #[inline]
    fn err_out_of_range<'a>(&'a self, args: core::fmt::Arguments<'a>) -> ErrorBuilder<'a> {
        self.err(ErrorCode::OUT_OF_RANGE, args)
    }
    #[inline]
    fn throw_invalid_arguments_fmt(&self, args: core::fmt::Arguments<'_>) -> JsResult<JSValue> {
        Err(self.throw(args))
    }
    #[inline]
    fn sql_vm(&self) -> &VirtualMachine {
        // `JSGlobalObject::bun_vm` is the canonical safe accessor (single
        // audited deref in bun_jsc); the VM is a process-lifetime singleton.
        self.bun_vm()
    }
    #[inline]
    fn sql_vm_ptr(&self) -> *mut VirtualMachine {
        JSC__JSGlobalObject__bunVM(self).cast::<VirtualMachine>()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine / EventLoop — direct re-exports from bun_jsc.
//
// bun_sql_jsc already depends on bun_jsc, so the previous opaque-ZST view
// structs that round-tripped through Rust→Rust extern "C" shims
// (Bun__VM__global / Bun__VM__eventLoop / Bun__EventLoop__enterLoop / …)
// were a layering workaround. SQL-specific accessors that bun_jsc doesn't
// expose at this tier (sql_state(), timer(), ssl_ctx_cache()) are provided
// as the [VirtualMachineSqlExt] extension trait.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_io::KeepAlive;
pub use bun_jsc::event_loop::{EventLoop, EventLoopEnterGuard as EventLoopGuard};
pub use bun_jsc::virtual_machine::VirtualMachine;

// ──────────────────────────────────────────────────────────────────────────
// SqlRuntimeHooks — manual cold-path vtable (CYCLEBREAK §Dispatch).
//
// `bun_runtime` owns the per-VM `RuntimeState` (timer heap, SSLContextCache,
// SSLConfig parser, Blob accessors) and *depends on* this crate, so direct
// imports would cycle. Instead of Rust→Rust `extern "C"` shims (which let the
// two sides disagree on pointee types — the previous local `EventLoopTimer` /
// `SSLConfig` stubs were layout-incompatible with what `hw_exports.rs` wrote),
// the low tier defines the fn-pointer table and `bun_runtime::jsc_hooks::
// `__BUN_SQL_RUNTIME_HOOKS` defines a `#[no_mangle]` instance. Every signature here
// is checked by the compiler at the registration site.
// ──────────────────────────────────────────────────────────────────────────

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
    ) -> *mut bun_uws::SslCtx,
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
    /// `Blob::needsToReadFile`.
    pub blob_needs_to_read_file: unsafe fn(*const c_void) -> bool,
    /// `Blob::sharedView` — returns `(ptr, len)` borrowing the immutable store.
    pub blob_shared_view: unsafe fn(*const c_void, out_len: *mut usize) -> *const u8,
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
/// crate::postgres::PostgresSQLContext that the Zig RareData carried as
/// value fields. The bun_jsc::rare_data::RareData slots for these are opaque
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
pub trait VirtualMachineSqlExt {
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
    /// Lazy-init `RareData`'s per-protocol uws [`bun_uws::SocketGroup`].
    /// Encapsulates the `rare_data(&mut self)` / `*_group(.., &VirtualMachine)`
    /// borrowck conflict (the two borrows touch field-disjoint state) so the
    /// four call sites need no per-site raw-pointer dance.
    fn postgres_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup;
    /// See [`Self::postgres_socket_group`].
    fn mysql_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup;
    // NOTE: `event_loop_mut` lives on `VirtualMachine` as a safe inherent
    // accessor (single audited deref under the JS-thread-singleton invariant);
    // the former unsafe trait shim here was dead — inherent methods always win
    // method resolution over this extension trait.
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
    fn postgres_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup {
        // `rare_data()` returns the boxed `&mut RareData` (disjoint allocation);
        // `*_group` only reads `vm.uws_loop()`. Route the read-only `vm`
        // argument through the JS-thread singleton accessor instead of a
        // raw-pointer split-borrow — `VirtualMachine::get()` is `&'static`
        // and doesn't borrow `self`, so borrowck is satisfied without a
        // per-site raw-pointer deref.
        self.rare_data()
            .postgres_group::<SSL>(VirtualMachine::get())
    }
    #[inline]
    fn mysql_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup {
        // See `postgres_socket_group` — singleton `&'static` for the read-only
        // `vm` argument avoids the raw-pointer split-borrow.
        self.rare_data().mysql_group::<SSL>(VirtualMachine::get())
    }
}

/// RAII enter()/exit() for [EventLoop] — wraps the inherent (unsafe,
/// raw-pointer) bun_jsc::event_loop::EventLoop::enter_scope.
pub trait EventLoopSqlExt {
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

// ──────────────────────────────────────────────────────────────────────────
// Timer heap / EventLoopTimer.
//
// The intrusive `EventLoopTimer` node + `Tag`/`State` enums are the canonical
// `bun_event_loop` types (lower tier — also what `bun_runtime::dispatch::
// fire_timer` reads via `from_field_ptr!`). The previous local `#[repr(C)]`
// stub diverged on layout (`[usize;3]` heap, no `in_heap`) *and* discriminants
// (Tag::PostgresSQLConnectionTimeout=1 vs canonical 8, State::FIRED/CANCELLED
// swapped), so insertion into the real pairing-heap was UB and tag dispatch
// mis-routed.
//
// `Timer::All` (the heap container) lives in `bun_runtime::RuntimeState`;
// reached via [`SqlRuntimeHooks::timer_heap`] / `timer_insert` / `timer_remove`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};

/// `bun_runtime::timer::All` — heap of `EventLoopTimer`. Opaque on this side
/// (the layout is high-tier); insert/remove forward to `bun_runtime` via the
/// [`SqlRuntimeHooks`] vtable.
bun_opaque::opaque_ffi! { pub struct TimerHeap; }
impl TimerHeap {
    pub fn insert(&mut self, t: &mut EventLoopTimer) {
        // SAFETY: `self` is `&mut runtime_state().timer`; `t` is a live
        // intrusive heap node owned by the caller.
        unsafe { (hooks().timer_insert)(self._p.get().cast::<c_void>(), t) }
    }
    pub fn remove(&mut self, t: &mut EventLoopTimer) {
        // SAFETY: `self` is `&mut runtime_state().timer`; `t` was previously
        // inserted by the caller.
        unsafe { (hooks().timer_remove)(self._p.get().cast::<c_void>(), t) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AutoFlusher — thin VM-taking wrapper over
// bun_jsc::event_loop::EventLoop::deferred_tasks (Zig
// AutoFlusher.registerDeferredMicrotaskWithType).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default, Debug)]
pub struct AutoFlusher {
    pub registered: bool,
}

/// Zig's free fns take (comptime Type: type, this: *Type) and duck-type on
/// this.auto_flusher + Type.onAutoFlush. SQL connection types implement this.
pub trait HasAutoFlush: Sized {
    fn on_auto_flush(this: *mut Self) -> bool;
}

impl AutoFlusher {
    pub fn register_deferred_microtask_with_type_unchecked<T: HasAutoFlush>(
        this: *mut T,
        vm: &VirtualMachine,
    ) {
        // Body is fully safe — `cast()` is safe and `on_auto_flush` takes a
        // raw pointer by value. `ctx` is the `*mut T` registered below; the
        // queue feeds it back unchanged. A safe `extern "C" fn` coerces to the
        // `DeferredRepeatingTask` fn-pointer type.
        extern "C" fn trampoline<T: HasAutoFlush>(ctx: *mut c_void) -> bool {
            T::on_auto_flush(ctx.cast::<T>())
        }
        // `event_loop_mut()` is the canonical safe `&mut EventLoop` accessor
        // (single audited deref inside `VirtualMachine`); `deferred_tasks` is an
        // embedded field with stable address for the VM lifetime.
        let q = &mut vm.event_loop_mut().deferred_tasks;
        q.post_task(NonNull::new(this.cast::<c_void>()), trampoline::<T>);
    }
    pub fn unregister_deferred_microtask_with_type<T>(this: *mut T, vm: &VirtualMachine) {
        // See register_deferred_microtask_with_type_unchecked.
        let q = &mut vm.event_loop_mut().deferred_tasks;
        q.unregister_task(NonNull::new(this.cast::<c_void>()));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// api::ServerConfig::SSLConfig — opaque handle to a boxed
// `bun_runtime::socket::SSLConfig`.
//
// The full `SSLConfig` (~18 fields incl. `Vec`/`CString`) is high-tier (it
// pulls in `node::fs`/`webcore::Blob`). The previous 3-field local mirror was
// passed as `*mut c_void` storage to `Bun__SSLConfig__fromJS`, which `.write()`
// the full struct into the 16-byte stack slot — stack overflow / UB. Storage
// now lives in `bun_runtime`; this side holds only an owning pointer and
// reaches the two fields SQL actually reads (`server_name`,
// `reject_unauthorized`) via [`SqlRuntimeHooks`].
// ──────────────────────────────────────────────────────────────────────────

pub mod api {
    use super::*;
    pub mod server_config {
        use super::*;

        /// Owning handle to a `Box<bun_runtime::socket::SSLConfig>`. `None` =
        /// the default-constructed config (Zig: `.{}`) — callers that pass
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
            pub fn server_name(&self) -> *const c_char {
                match self.0 {
                    None => core::ptr::null(),
                    // SAFETY: live boxed SSLConfig; hook returns a borrow into
                    // its `Option<CString>` field, valid for `self`'s lifetime.
                    Some(p) => unsafe { (hooks().ssl_config_server_name)(p.as_ptr()) },
                }
            }

            /// `SSLConfig.reject_unauthorized` — non-zero rejects on verify error.
            #[inline]
            pub fn reject_unauthorized(&self) -> i32 {
                match self.0 {
                    None => 0,
                    // SAFETY: live boxed SSLConfig.
                    Some(p) => unsafe { (hooks().ssl_config_reject_unauthorized)(p.as_ptr()) },
                }
            }

            /// `SSLConfig.fromJS(vm, global, value)` — VM is accepted for API
            /// parity with the Zig signature but unused (the hook recovers it
            /// from `global`).
            pub fn from_js<V>(
                _vm: V,
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
            pub fn as_usockets_for_client_verification(
                &self,
            ) -> bun_uws::us_bun_socket_context_options_t {
                match self.0 {
                    None => {
                        let mut opts = bun_uws::us_bun_socket_context_options_t::default();
                        opts.request_cert = 1;
                        opts.reject_unauthorized = 0;
                        opts
                    }
                    // SAFETY: live boxed SSLConfig.
                    Some(p) => unsafe { (hooks().ssl_config_as_usockets_client)(p.as_ptr()) },
                }
            }
        }
        // Zig-style PascalCase alias.
        pub use SSLConfig as SslConfig;
    }
    /// Zig: `jsc.API.ServerConfig.SSLConfig` — PascalCase namespace alias.
    #[allow(non_snake_case)]
    pub mod ServerConfig {
        pub use super::server_config::SSLConfig;
    }
}

pub mod webcore {
    pub use super::AutoFlusher;
    use super::*;

    /// Opaque view of `bun_runtime::webcore::Blob`. Never constructed by value
    /// on this side — SQL only ever holds `*mut Blob` recovered from a JS
    /// wrapper's `m_ctx` via `value.as_::<Blob>()`. Field accessors route
    /// through [`SqlRuntimeHooks`]; the `from_js`/`from_js_direct` codegen
    /// externs are real C++ symbols (generate-classes.ts), not Rust shims.
    bun_opaque::opaque_ffi! { pub struct Blob; }
    impl Blob {
        pub fn needs_to_read_file(&self) -> bool {
            // SAFETY: `self` is a live `*const bun_runtime::webcore::Blob`
            // (codegen m_ctx payload).
            unsafe { (hooks().blob_needs_to_read_file)(self._p.get() as *const c_void) }
        }
        pub fn shared_view(&self) -> &[u8] {
            let mut len: usize = 0;
            // SAFETY: `self` is a live `*const Blob`; the returned ptr/len
            // borrow the Blob's store, which is immutable for its lifetime.
            let ptr =
                unsafe { (hooks().blob_shared_view)(self._p.get() as *const c_void, &raw mut len) };
            if ptr.is_null() || len == 0 {
                return &[];
            }
            // SAFETY: hook guarantees `ptr[..len]` valid while the Blob lives.
            unsafe { core::slice::from_raw_parts(ptr, len) }
        }
    }
    impl super::JsClass for Blob {
        fn from_js(value: JSValue) -> Option<*mut Self> {
            let p = Blob__fromJS(value);
            if p.is_null() {
                None
            } else {
                Some(p.cast::<Self>())
            }
        }
        fn from_js_direct(value: JSValue) -> Option<*mut Self> {
            let p = Blob__fromJSDirect(value);
            if p.is_null() {
                None
            } else {
                Some(p.cast::<Self>())
            }
        }
        fn to_js(self, _global: &JSGlobalObject) -> JSValue {
            // The opaque view is zero-sized and unconstructible (no `pub`
            // ctor); real callers go through `bun_runtime::webcore::Blob::to_js`.
            // Safe `unreachable!` so a stray generic-over-`JsClass` call panics
            // with a diagnostic instead of invoking UB.
            unreachable!(
                "webcore::Blob is an opaque view on the sql_jsc side; \
                 construct via bun_runtime::webcore::Blob"
            )
        }
        fn get_constructor(global: &JSGlobalObject) -> JSValue {
            Blob__getConstructor(global)
        }
    }

    // C++ codegen symbols (generate-classes.ts) — NOT Rust→Rust shims.
    // SAFETY (safe fn): `JSValue` is a by-value scalar; `JSGlobalObject` is an
    // opaque `UnsafeCell`-backed handle, so `&JSGlobalObject` is ABI-identical
    // to a non-null `JSGlobalObject*` with write provenance.
    // C++ declares these `extern JSC_CALLCONV` (= SysV ABI on win-x64), so
    // import via `jsc_abi_extern!` — plain `extern "C"` is the Win64 ABI on
    // Windows and would pass args in the wrong registers.
    bun_jsc::jsc_abi_extern! {
        safe fn Blob__fromJS(value: JSValue) -> *mut c_void;
        safe fn Blob__fromJSDirect(value: JSValue) -> *mut c_void;
        safe fn Blob__getConstructor(global: &JSGlobalObject) -> JSValue;
    }
}

/// `bun_jsc::JsClass` — generic downcast trait backing `JSValue::as_<T>()`.
/// Re-exported so the codegen module's blanket impls land on the same trait
/// `bun_jsc::JSValue::as_<T>()` keys on.
pub use bun_jsc::JsClass;

// ──────────────────────────────────────────────────────────────────────────
// codegen::JS{Type} — per-JsClass cached-value getters/setters generated from
// `.classes.ts`.
// ──────────────────────────────────────────────────────────────────────────

pub mod codegen {
    ::bun_jsc::js_class_module!(JSPostgresSQLConnection = "PostgresSQLConnection"
        as crate::postgres::PostgresSQLConnection { queries, onconnect, onclose });
    ::bun_jsc::js_class_module!(
        JSPostgresSQLQuery = "PostgresSQLQuery" as crate::postgres::PostgresSQLQuery,
        impl_js_class {
            binding,
            columns,
            pendingValue,
            target
        }
    );

    ::bun_jsc::js_class_module!(js_mysql_connection = "MySQLConnection"
        as crate::mysql::js_my_sql_connection::JSMySQLConnection { queries, onconnect, onclose });
    #[allow(non_snake_case)]
    pub use js_mysql_connection as JSMySQLConnection;

    ::bun_jsc::js_class_module!(
        js_mysql_query = "MySQLQuery" as crate::mysql::js_mysql_query::JSMySQLQuery,
        impl_js_class {
            binding,
            columns,
            pendingValue,
            target
        }
    );
    #[allow(non_snake_case)]
    pub use js_mysql_query as JSMySQLQuery;
}

// ──────────────────────────────────────────────────────────────────────────
// JSFunction — host-function constructor.
//
// `bun_jsc::JSFunction` exists, but its `create` signature differs; the SQL
// callsites only need the `JSHostFn` thunk plumbing, kept local so callers
// don't churn.
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct JSFunction {
    _opaque: [u8; 0],
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

/// `jsc.JSHostFn` — the JSC-ABI host-function pointer JSC dispatches to
/// (`extern "sysv64"` on win-x64, `extern "C"` elsewhere). Re-exported from
/// `bun_jsc` so the cfg-split lives in one place.
pub use bun_jsc::host_fn::JsHostFn as JSHostFn;
pub type JSHostFnZig = fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

pub trait IntoJSHostFn<Marker>: Sized {
    fn into_js_host_fn(self) -> JSHostFn;
}
#[doc(hidden)]
pub struct HostFnRaw;
#[doc(hidden)]
pub struct HostFnResult;
#[doc(hidden)]
pub struct HostFnPlain;

impl IntoJSHostFn<HostFnRaw> for JSHostFn {
    #[inline]
    fn into_js_host_fn(self) -> JSHostFn {
        self
    }
}
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
#[derive(Default)]
pub struct CreateJSFunctionOptions {
    pub implementation_visibility: ImplementationVisibility,
    pub intrinsic: Intrinsic,
    pub constructor: Option<JSHostFn>,
}

unsafe extern "C" {
    // `&JSGlobalObject` is ABI-identical to a non-null `*const JSGlobalObject`;
    // remaining args are by-value scalars/fn-ptrs. No caller-side memory
    // preconditions remain → `safe fn`.
    safe fn JSFunction__createFromZig(
        global: &JSGlobalObject,
        fn_name: bun_core::String,
        implementation: JSHostFn,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: Option<JSHostFn>,
    ) -> JSValue;
}

/// `bun_jsc::JSValue::put_host_functions`-shaped helper for the SQL binding
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
    /// Accepts either a raw [`JSHostFn`] (C-ABI) or a safe Rust
    /// `fn(&JSGlobalObject, &CallFrame) -> JSValue` / `-> JsResult<JSValue>`
    /// via [`IntoJSHostFn`] (Zig: `jsc.toJSHostFn(fn)`).
    pub fn create<M, F: IntoJSHostFn<M>>(
        global: &JSGlobalObject,
        name: &str,
        implementation: F,
        arg_count: u32,
        opts: CreateJSFunctionOptions,
    ) -> JSValue {
        let implementation: JSHostFn = implementation.into_js_host_fn();
        let fn_name = bun_core::String::init(name);
        JSFunction__createFromZig(
            global,
            fn_name,
            implementation,
            arg_count,
            opts.implementation_visibility,
            opts.intrinsic,
            opts.constructor,
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CallFrame helpers — `bun_jsc::ArgumentsSlice` exists; this local variant
// keeps the `&VirtualMachine` (local view) signature the SQL callsites use.
// ──────────────────────────────────────────────────────────────────────────

pub mod call_frame {
    use super::*;
    /// `Node.ArgumentsSlice` — cursor over a `&[JSValue]` (CallFrame.zig:289).
    pub struct ArgumentsSlice<'a> {
        remaining: &'a [JSValue],
        _vm: *const c_void,
    }
    impl<'a> ArgumentsSlice<'a> {
        /// Generic over the VM handle so it accepts both the local
        /// [`VirtualMachine`] and `bun_jsc`'s (callers pass `global.bun_vm()`,
        /// which returns a raw `*mut VirtualMachineRef`). The VM is not
        /// dereferenced — it's only carried for API parity with the Zig
        /// `Node.ArgumentsSlice` shape — so it's accepted by-value and dropped.
        pub fn init<V>(_vm: V, slice: &'a [JSValue]) -> Self {
            Self {
                remaining: slice,
                _vm: core::ptr::null(),
            }
        }
        /// Zig `len` (CallFrame.zig) — remaining argument count.
        #[inline]
        pub fn len(&self) -> u16 {
            self.remaining.len() as u16
        }
        /// Zig `eat` (CallFrame.zig) — advance past the head without returning it.
        #[inline]
        pub fn eat(&mut self) {
            if let Some((_, rest)) = self.remaining.split_first() {
                self.remaining = rest;
            }
        }
        /// Zig `next` (CallFrame.zig) — **peek** the head without advancing.
        ///
        /// NOTE: an earlier port gave this eat-semantics; callers wanting the
        /// Zig `nextEat` behaviour must call [`Self::next_eat`] (the
        /// `JSMySQLQuery` callsite was updated alongside this fix).
        #[inline]
        pub fn next(&self) -> Option<JSValue> {
            self.remaining.first().copied()
        }
        /// Zig `nextEat` (CallFrame.zig) — return the head **and** advance.
        #[inline]
        pub fn next_eat(&mut self) -> Option<JSValue> {
            let (first, rest) = self.remaining.split_first()?;
            self.remaining = rest;
            Some(*first)
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// MarkedArgumentBuffer::run — C++-side trampoline. `bun_jsc::MarkedArgumentBuffer`
// exposes `new(f)`; the SQL callsites use the lower-level `run(ctx, fn_ptr)`
// shape, kept here as a free fn (cannot add inherent methods to a foreign type).
// ──────────────────────────────────────────────────────────────────────────

pub fn marked_argument_buffer_run<Ctx>(
    ctx: *mut c_void,
    f: extern "C" fn(*mut Ctx, *mut MarkedArgumentBuffer),
) {
    // SAFETY: both fn-pointer params are `extern "C" fn(thin_ptr, thin_ptr)`,
    // so the transmute is ABI-identical (same arity, same per-arg repr).
    let f = unsafe {
        bun_ptr::cast_fn_ptr::<
            extern "C" fn(*mut Ctx, *mut MarkedArgumentBuffer),
            extern "C" fn(*mut c_void, *mut c_void),
        >(f)
    };
    MarkedArgumentBuffer__run(ctx, f)
}

/// Opaque handle to `bun_runtime::api::SSLContextCache` (owned by
/// `RuntimeState`). Reached via [`VirtualMachineSqlExt::ssl_ctx_cache`]; backed
/// by [`SqlRuntimeHooks::ssl_ctx_cache`] / `ssl_ctx_get_or_create`.
bun_opaque::opaque_ffi! { pub struct SslCtxCache; }
impl SslCtxCache {
    pub fn get_or_create_opts(
        &mut self,
        opts: bun_uws::us_bun_socket_context_options_t,
        err: &mut bun_uws::create_bun_socket_error_t,
    ) -> Option<*mut bun_uws::SslCtx> {
        // SAFETY: `self` is `&mut runtime_state().ssl_ctx_cache`; `opts`/`err`
        // are caller stack locals.
        let p =
            unsafe { (hooks().ssl_ctx_get_or_create)(self._p.get().cast::<c_void>(), &opts, err) };
        if p.is_null() { None } else { Some(p) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" — **C++** JSC bindings (src/jsc/bindings/bindings.cpp) used by
// the extension traits above. No Rust-defined symbols are declared here; all
// `bun_runtime` cross-calls go through [`SqlRuntimeHooks`] so the compiler
// type-checks both sides at the registration site.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    // JSValue — by-value `JSValue` (encoded NaN-boxed u64) + scalar args; the
    // C++ side reads no caller memory and upholds no invariants the caller must
    // discharge, so these are `safe fn`.

    // JSGlobalObject — `&JSGlobalObject` is ABI-identical to a non-null
    // `*const JSGlobalObject`; the reference type discharges the validity
    // precondition, so `safe fn`. Returned pointer is opaque (caller derefs
    // under its own SAFETY obligation).
    safe fn JSC__JSGlobalObject__bunVM(this: &JSGlobalObject) -> *mut c_void;

    // MarkedArgumentBuffer — C++ side stack-allocates a `MarkedArgumentBuffer`
    // and calls `f(ctx, &buffer)`; it never dereferences `ctx` itself (opaque
    // round-trip), and `f` is a *safe* `extern "C" fn` pointer, so calling it
    // is safe by type. No caller-side preconditions remain → `safe fn`.
    safe fn MarkedArgumentBuffer__run(ctx: *mut c_void, f: extern "C" fn(*mut c_void, *mut c_void));
}
