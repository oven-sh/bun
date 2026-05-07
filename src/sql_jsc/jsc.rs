//! `bun_jsc` re-export façade for the SQL bindings.
//!
//! All core handle types (`JSValue`, `JSGlobalObject`, `CallFrame`, `JsError`,
//! `JsResult`, `JSObject`, `JSCell`, `JSType`, [`VirtualMachine`],
//! [`EventLoop`], [`KeepAlive`], …) are **re-exported from `bun_jsc` /
//! `bun_aio`** so the `#[bun_jsc::JsClass]` / `#[bun_jsc::host_fn]` proc-macros
//! see identical types. SQL-specific helpers that `bun_jsc` doesn't expose at
//! this tier are provided as extension traits ([`JSValueSqlExt`],
//! [`JSGlobalObjectSqlExt`], [`VirtualMachineSqlExt`], [`EventLoopSqlExt`]).
//!
//! [`RareData`] here is the **per-VM SQL state** (`mysql_context` /
//! `postgresql_context`) that `bun_runtime::jsc_hooks::RuntimeState` owns by
//! value — it is *not* a view of `bun_jsc::rare_data::RareData` (which holds
//! the per-protocol `SocketGroup`s and is reached via the inherent
//! `VirtualMachine::rare_data()`).

#![allow(unused_variables, non_snake_case, dead_code, unused_imports)]

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::marker::PhantomData;
use core::ptr::NonNull;

// ──────────────────────────────────────────────────────────────────────────
// Core handles — re-exported from `bun_jsc` so proc-macro generated wrappers
// (which hard-code `bun_jsc::JSGlobalObject` / `bun_jsc::CallFrame` / …) see
// the same types as user code importing `crate::jsc::*`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_jsc::{
    JSValue, JSGlobalObject, CallFrame, JSObject, JSCell, JsError, JsResult, JSType,
    MarkedArgumentBuffer, JSArrayIterator, ErrorCode, ErrorBuilder,
    ExternColumnIdentifier, ExternColumnIdentifierValue,
    StrongOptional, JsRef, CoerceTo, ThrowFmtArgs,
    StringJsc, ZigStringJsc, bun_string_jsc, host_fn,
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
    if global.has_exception() { return Err(JsError::Thrown); }
    debug_assert!(!v.is_empty(), "fromJSHostCall: empty JSValue with no pending exception");
    Ok(v)
}
#[inline]
fn from_js_host_call_generic<R>(global: &JSGlobalObject, r: R) -> JsResult<R> {
    if global.has_exception() { Err(JsError::Thrown) } else { Ok(r) }
}

// ──────────────────────────────────────────────────────────────────────────
// JSValue — SQL-specific extension surface (methods bun_jsc doesn't expose).
// ──────────────────────────────────────────────────────────────────────────

/// SQL-side helpers on `JSValue` not (yet) provided by `bun_jsc`.
pub trait JSValueSqlExt: Sized + Copy {
    fn create_buffer_copy(global: &JSGlobalObject, slice: &[u8]) -> JSValue;
    fn js_double_number(n: f64) -> JSValue;
    fn to_uint64_no_truncate(self) -> u64;
    fn is_big_int_in_int64_range(self, min: i64, max: i64) -> bool;
    fn is_big_int_in_uint64_range(self, min: u64, max: u64) -> bool;
}

const DOUBLE_ENCODE_OFFSET: i64 = 1i64 << 49;

impl JSValueSqlExt for JSValue {
    /// `JSValue.createBuffer(global, slice, null)` — Zig passes a `[]const u8`
    /// and `null` allocator, meaning JSC must not free the pointer. The SQL
    /// callsite (`bytea.zig`) passes a slice into a transient decode buffer, so
    /// the bytes are duplicated into a mimalloc allocation here and handed to
    /// JSC with the standard deallocator.
    fn create_buffer_copy(global: &JSGlobalObject, slice: &[u8]) -> JSValue {
        if slice.is_empty() {
            // SAFETY: `global` is live; null deallocator for empty.
            return unsafe {
                JSBuffer__bufferFromPointerAndLengthAndDeinit(
                    global.as_mut_ptr(),
                    core::ptr::NonNull::dangling().as_ptr(),
                    0,
                    core::ptr::null_mut(),
                    None,
                )
            };
        }
        // Dup into a mimalloc allocation so `MarkedArrayBuffer_deallocator`
        // (which calls `mi_free`) is the correct destructor.
        let mut owned: Vec<u8> = slice.to_vec();
        let ptr = owned.as_mut_ptr();
        let len = owned.len();
        core::mem::forget(owned);
        // SAFETY: `ptr[..len]` is a fresh mimalloc allocation; ownership
        // transfers to JSC (freed via `MarkedArrayBuffer_deallocator`).
        unsafe {
            JSBuffer__bufferFromPointerAndLengthAndDeinit(
                global.as_mut_ptr(),
                ptr,
                len,
                core::ptr::null_mut(),
                Some(MarkedArrayBuffer_deallocator),
            )
        }
    }
    /// `JSValue::jsDoubleNumber` — boxes an f64 (always double-encoded; no
    /// int32 fast path). FFI.zig: `DOUBLE_TO_JSVALUE`.
    fn js_double_number(n: f64) -> JSValue {
        JSValue::from_encoded(
            (n.to_bits() as i64).wrapping_add(DOUBLE_ENCODE_OFFSET) as usize,
        )
    }
    fn to_uint64_no_truncate(self) -> u64 {
        // SAFETY: pure FFI conversion.
        unsafe { JSC__JSValue__toUInt64NoTruncate(self) }
    }
    fn is_big_int_in_int64_range(self, min: i64, max: i64) -> bool {
        // SAFETY: pure FFI predicate (JSValue.zig:40).
        unsafe { JSC__isBigIntInInt64Range(self, min, max) }
    }
    fn is_big_int_in_uint64_range(self, min: u64, max: u64) -> bool {
        // SAFETY: pure FFI predicate (JSValue.zig:36).
        unsafe { JSC__isBigIntInUInt64Range(self, min, max) }
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
    let error_message: &[u8] = bun_string::slice_to_nul(&outbuf[..]);
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
        E::none => {
            // SAFETY: ERR_get_error reads the thread-local error queue; always safe.
            boringssl_err_to_js(global, unsafe { bun_boringssl_sys::ERR_get_error() })
        }
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
        // SAFETY: bunVM returns a valid *VirtualMachine for this global,
        // live for the VM lifetime.
        unsafe { &*(JSC__JSGlobalObject__bunVM(self.as_mut_ptr()) as *mut VirtualMachine) }
    }
    #[inline]
    fn sql_vm_ptr(&self) -> *mut VirtualMachine {
        // SAFETY: FFI — &self is a valid JSGlobalObject*.
        unsafe { JSC__JSGlobalObject__bunVM(self.as_mut_ptr()) as *mut VirtualMachine }
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

pub use bun_jsc::virtual_machine::VirtualMachine;
pub use bun_jsc::event_loop::{EventLoop, EventLoopEnterGuard as EventLoopGuard};
pub use bun_aio::KeepAlive;

// ──────────────────────────────────────────────────────────────────────────
// SqlRuntimeHooks — manual cold-path vtable (CYCLEBREAK §Dispatch).
//
// `bun_runtime` owns the per-VM `RuntimeState` (timer heap, SSLContextCache,
// SSLConfig parser, Blob accessors) and *depends on* this crate, so direct
// imports would cycle. Instead of Rust→Rust `extern "C"` shims (which let the
// two sides disagree on pointee types — the previous local `EventLoopTimer` /
// `SSLConfig` stubs were layout-incompatible with what `hw_exports.rs` wrote),
// the low tier defines the fn-pointer table and `bun_runtime::jsc_hooks::
// install_jsc_hooks()` registers a `&'static` instance. Every signature here
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

static SQL_RUNTIME_HOOKS: core::sync::atomic::AtomicPtr<SqlRuntimeHooks> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

/// Called once from `bun_runtime::jsc_hooks::install_jsc_hooks()` before the
/// first `VirtualMachine::init`.
pub fn set_sql_runtime_hooks(hooks: &'static SqlRuntimeHooks) {
    SQL_RUNTIME_HOOKS.store(
        hooks as *const SqlRuntimeHooks as *mut SqlRuntimeHooks,
        core::sync::atomic::Ordering::Release,
    );
}

#[inline]
fn hooks() -> &'static SqlRuntimeHooks {
    let p = SQL_RUNTIME_HOOKS.load(core::sync::atomic::Ordering::Acquire);
    debug_assert!(
        !p.is_null(),
        "SqlRuntimeHooks not registered — bun_runtime::install_jsc_hooks() must run before any SQL connection"
    );
    // SAFETY: registered once at startup with a `&'static` instance; never
    // cleared, never mutated after publication.
    unsafe { &*p }
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
    /// bun_aio::EventLoopCtx for the JS-thread VM, for KeepAlive::{ref_,unref}.
    fn vm_ctx(&self) -> bun_aio::EventLoopCtx;
    /// &mut *self.event_loop() — EventLoop::{enter,exit,run_callback} take
    /// &mut self; bun_jsc returns the raw pointer. Unbounded lifetime so the
    /// returned &mut does not borrow *self (the loop is a disjoint heap
    /// allocation owned by the VM).
    ///
    /// SAFETY: caller must not hold another live &mut EventLoop.
    unsafe fn event_loop_mut<'a>(&self) -> &'a mut EventLoop;
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
        unsafe { &mut *((hooks().timer_heap)(self) as *mut TimerHeap) }
    }
    #[inline]
    fn ssl_ctx_cache(&mut self) -> &mut SslCtxCache {
        // SAFETY: hook returns `&mut runtime_state().ssl_ctx_cache`; non-null
        // after `init_runtime_state`.
        unsafe { &mut *((hooks().ssl_ctx_cache)(self) as *mut SslCtxCache) }
    }
    #[inline]
    fn vm_ctx(&self) -> bun_aio::EventLoopCtx {
        bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js)
    }
    #[inline]
    unsafe fn event_loop_mut<'a>(&self) -> &'a mut EventLoop {
        // SAFETY: caller contract; event_loop() points into the VM-owned
        // EventLoop, live for the VM lifetime.
        unsafe { &mut *self.event_loop() }
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
// fire_timer` reads via `container_of!`). The previous local `#[repr(C)]`
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
#[repr(C)]
pub struct TimerHeap {
    _opaque: core::cell::UnsafeCell<[u8; 0]>,
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
impl TimerHeap {
    pub fn insert(&mut self, t: &mut EventLoopTimer) {
        // SAFETY: `self` is `&mut runtime_state().timer`; `t` is a live
        // intrusive heap node owned by the caller.
        unsafe { (hooks().timer_insert)(self._opaque.get() as *mut c_void, t) }
    }
    pub fn remove(&mut self, t: &mut EventLoopTimer) {
        // SAFETY: `self` is `&mut runtime_state().timer`; `t` was previously
        // inserted by the caller.
        unsafe { (hooks().timer_remove)(self._opaque.get() as *mut c_void, t) }
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
        unsafe extern "C" fn trampoline<T: HasAutoFlush>(ctx: *mut c_void) -> bool {
            // SAFETY: ctx is the *mut T registered below; the queue feeds it
            // back unchanged.
            T::on_auto_flush(ctx as *mut T)
        }
        // SAFETY: vm.event_loop() is the live VM-owned loop; deferred_tasks
        // is an embedded field with stable address for the VM lifetime.
        let q = unsafe { &mut (*vm.event_loop()).deferred_tasks };
        q.post_task(NonNull::new(this as *mut c_void), trampoline::<T>);
    }
    pub fn unregister_deferred_microtask_with_type<T>(this: *mut T, vm: &VirtualMachine) {
        // SAFETY: see register_deferred_microtask_with_type_unchecked.
        let q = unsafe { &mut (*vm.event_loop()).deferred_tasks };
        q.unregister_task(NonNull::new(this as *mut c_void));
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
    #[repr(C)]
    pub struct Blob {
        _opaque: core::cell::UnsafeCell<[u8; 0]>,
        _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
    }
    impl Blob {
        pub fn needs_to_read_file(&self) -> bool {
            // SAFETY: `self` is a live `*const bun_runtime::webcore::Blob`
            // (codegen m_ctx payload).
            unsafe { (hooks().blob_needs_to_read_file)(self._opaque.get() as *const c_void) }
        }
        pub fn shared_view(&self) -> &[u8] {
            let mut len: usize = 0;
            // SAFETY: `self` is a live `*const Blob`; the returned ptr/len
            // borrow the Blob's store, which is immutable for its lifetime.
            let ptr = unsafe {
                (hooks().blob_shared_view)(self._opaque.get() as *const c_void, &mut len)
            };
            if ptr.is_null() || len == 0 { return &[]; }
            // SAFETY: hook guarantees `ptr[..len]` valid while the Blob lives.
            unsafe { core::slice::from_raw_parts(ptr, len) }
        }
    }
    impl super::JsClass for Blob {
        fn from_js(value: JSValue) -> Option<*mut Self> {
            // SAFETY: codegen-emitted `Blob__fromJS` returns null when `value`
            // is not a Blob wrapper.
            let p = unsafe { Blob__fromJS(value) };
            if p.is_null() { None } else { Some(p as *mut Self) }
        }
        fn from_js_direct(value: JSValue) -> Option<*mut Self> {
            // SAFETY: codegen extern; caller has already checked `is_cell()`.
            let p = unsafe { Blob__fromJSDirect(value) };
            if p.is_null() { None } else { Some(p as *mut Self) }
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
            // SAFETY: `global` is live; codegen extern returns the cached ctor.
            unsafe { Blob__getConstructor(global.as_mut_ptr()) }
        }
    }

    // C++ codegen symbols (generate-classes.ts) — NOT Rust→Rust shims.
    unsafe extern "C" {
        fn Blob__fromJS(value: JSValue) -> *mut c_void;
        fn Blob__fromJSDirect(value: JSValue) -> *mut c_void;
        fn Blob__getConstructor(global: *mut JSGlobalObject) -> JSValue;
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
    use super::{JSGlobalObject, JSValue};
    use core::ffi::c_void;

    macro_rules! cached_slot {
        ($get:ident, $set:ident, $get_ext:ident, $set_ext:ident) => {
            unsafe extern "C" {
                fn $get_ext(this_value: JSValue) -> JSValue;
                fn $set_ext(this_value: JSValue, global: *mut JSGlobalObject, value: JSValue);
            }
            pub fn $get(this_value: JSValue) -> Option<JSValue> {
                // SAFETY: codegen guarantees the symbol; returns ZERO when unset.
                let result = unsafe { $get_ext(this_value) };
                if result.is_empty() { None } else { Some(result) }
            }
            pub fn $set(this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
                // SAFETY: codegen guarantees the symbol.
                unsafe { $set_ext(this_value, global.as_mut_ptr(), value) }
            }
        };
    }

    macro_rules! get_constructor {
        ($extern_name:ident) => {
            unsafe extern "C" {
                fn $extern_name(global: *mut JSGlobalObject) -> JSValue;
            }
            pub fn get_constructor(global: &JSGlobalObject) -> JSValue {
                // SAFETY: `global` is a live JSGlobalObject; the codegen symbol
                // is emitted alongside the JS class wrapper and never null.
                unsafe { $extern_name(global.as_mut_ptr()) }
            }
        };
    }

    macro_rules! js_class_fns {
        ($payload:ty, $create:ident, $from_js:ident, $from_js_direct:ident) => {
            unsafe extern "C" {
                fn $create(global: *mut JSGlobalObject, ptr: *mut c_void) -> JSValue;
                fn $from_js(value: JSValue) -> *mut c_void;
                fn $from_js_direct(value: JSValue) -> *mut c_void;
            }
            pub fn to_js(ptr: *mut $payload, g: &JSGlobalObject) -> JSValue {
                // SAFETY: `ptr` is a live m_ctx payload; ownership transfers.
                unsafe { $create(g.as_mut_ptr(), ptr as *mut c_void) }
            }
            pub fn from_js(v: JSValue) -> Option<*mut $payload> {
                // SAFETY: codegen returns null when `v` is not the wrapper type.
                let p = unsafe { $from_js(v) };
                if p.is_null() { None } else { Some(p as *mut $payload) }
            }
            pub fn from_js_direct(v: JSValue) -> Option<*mut $payload> {
                // SAFETY: codegen returns null when `v` is not the wrapper type.
                let p = unsafe { $from_js_direct(v) };
                if p.is_null() { None } else { Some(p as *mut $payload) }
            }
        };
        // Variant that also emits `impl JsClass` (Zig: `value.as(T)`). Some
        // payload types already provide their own `impl JsClass` (e.g. the
        // Connection types), so the impl is opt-in via this trailing marker
        // rather than unconditional.
        ($payload:ty, $create:ident, $from_js:ident, $from_js_direct:ident, impl_js_class) => {
            js_class_fns!($payload, $create, $from_js, $from_js_direct);
            impl crate::jsc::JsClass for $payload {
                fn to_js(self, g: &JSGlobalObject) -> JSValue {
                    // Ownership transfers to the C++ wrapper (freed via
                    // `${T}Class__finalize`); box and hand off the raw ptr.
                    to_js(::std::boxed::Box::into_raw(::std::boxed::Box::new(self)), g)
                }
                fn from_js(v: JSValue) -> Option<*mut Self> { from_js(v) }
                fn from_js_direct(v: JSValue) -> Option<*mut Self> { from_js_direct(v) }
                fn get_constructor(g: &JSGlobalObject) -> JSValue { get_constructor(g) }
            }
        };
    }

    #[allow(non_snake_case)]
    pub mod JSPostgresSQLConnection {
        use super::*;
        cached_slot!(queries_get_cached, queries_set_cached,
            PostgresSQLConnectionPrototype__queriesGetCachedValue,
            PostgresSQLConnectionPrototype__queriesSetCachedValue);
        cached_slot!(onconnect_get_cached, onconnect_set_cached,
            PostgresSQLConnectionPrototype__onconnectGetCachedValue,
            PostgresSQLConnectionPrototype__onconnectSetCachedValue);
        cached_slot!(onclose_get_cached, onclose_set_cached,
            PostgresSQLConnectionPrototype__oncloseGetCachedValue,
            PostgresSQLConnectionPrototype__oncloseSetCachedValue);
        get_constructor!(PostgresSQLConnection__getConstructor);
        js_class_fns!(crate::postgres::PostgresSQLConnection,
            PostgresSQLConnection__create,
            PostgresSQLConnection__fromJS,
            PostgresSQLConnection__fromJSDirect);
    }

    #[allow(non_snake_case)]
    pub mod JSPostgresSQLQuery {
        use super::*;
        cached_slot!(binding_get_cached, binding_set_cached,
            PostgresSQLQueryPrototype__bindingGetCachedValue,
            PostgresSQLQueryPrototype__bindingSetCachedValue);
        cached_slot!(columns_get_cached, columns_set_cached,
            PostgresSQLQueryPrototype__columnsGetCachedValue,
            PostgresSQLQueryPrototype__columnsSetCachedValue);
        cached_slot!(pending_value_get_cached, pending_value_set_cached,
            PostgresSQLQueryPrototype__pendingValueGetCachedValue,
            PostgresSQLQueryPrototype__pendingValueSetCachedValue);
        cached_slot!(target_get_cached, target_set_cached,
            PostgresSQLQueryPrototype__targetGetCachedValue,
            PostgresSQLQueryPrototype__targetSetCachedValue);
        get_constructor!(PostgresSQLQuery__getConstructor);
        js_class_fns!(crate::postgres::PostgresSQLQuery,
            PostgresSQLQuery__create,
            PostgresSQLQuery__fromJS,
            PostgresSQLQuery__fromJSDirect,
            impl_js_class);
    }

    pub mod js_mysql_connection {
        use super::*;
        cached_slot!(queries_get_cached, queries_set_cached,
            MySQLConnectionPrototype__queriesGetCachedValue,
            MySQLConnectionPrototype__queriesSetCachedValue);
        cached_slot!(onconnect_get_cached, onconnect_set_cached,
            MySQLConnectionPrototype__onconnectGetCachedValue,
            MySQLConnectionPrototype__onconnectSetCachedValue);
        cached_slot!(onclose_get_cached, onclose_set_cached,
            MySQLConnectionPrototype__oncloseGetCachedValue,
            MySQLConnectionPrototype__oncloseSetCachedValue);
        get_constructor!(MySQLConnection__getConstructor);
        js_class_fns!(crate::mysql::js_my_sql_connection::JSMySQLConnection,
            MySQLConnection__create,
            MySQLConnection__fromJS,
            MySQLConnection__fromJSDirect);
    }
    #[allow(non_snake_case)]
    pub use js_mysql_connection as JSMySQLConnection;

    pub mod js_mysql_query {
        use super::*;
        cached_slot!(binding_get_cached, binding_set_cached,
            MySQLQueryPrototype__bindingGetCachedValue,
            MySQLQueryPrototype__bindingSetCachedValue);
        cached_slot!(columns_get_cached, columns_set_cached,
            MySQLQueryPrototype__columnsGetCachedValue,
            MySQLQueryPrototype__columnsSetCachedValue);
        cached_slot!(pending_value_get_cached, pending_value_set_cached,
            MySQLQueryPrototype__pendingValueGetCachedValue,
            MySQLQueryPrototype__pendingValueSetCachedValue);
        cached_slot!(target_get_cached, target_set_cached,
            MySQLQueryPrototype__targetGetCachedValue,
            MySQLQueryPrototype__targetSetCachedValue);
        get_constructor!(MySQLQuery__getConstructor);
        js_class_fns!(crate::mysql::js_mysql_query::JSMySQLQuery,
            MySQLQuery__create,
            MySQLQuery__fromJS,
            MySQLQuery__fromJSDirect,
            impl_js_class);
    }
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
pub struct JSFunction { _opaque: [u8; 0], _m: PhantomData<(*mut u8, core::marker::PhantomPinned)> }

/// `jsc.JSHostFn` — the C-ABI host-function pointer JSC dispatches to.
pub type JSHostFn = unsafe extern "C" fn(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue;
pub type JSHostFnZig = fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>;

pub trait IntoJSHostFn<Marker>: Sized {
    fn into_js_host_fn(self) -> JSHostFn;
}
#[doc(hidden)] pub struct HostFnRaw;
#[doc(hidden)] pub struct HostFnResult;
#[doc(hidden)] pub struct HostFnPlain;

impl IntoJSHostFn<HostFnRaw> for JSHostFn {
    #[inline] fn into_js_host_fn(self) -> JSHostFn { self }
}
impl<F> IntoJSHostFn<HostFnResult> for F
where
    F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static,
{
    fn into_js_host_fn(self) -> JSHostFn {
        debug_assert_eq!(core::mem::size_of::<F>(), 0, "IntoJSHostFn: expected fn item (ZST)");
        let _ = self;
        unsafe extern "C" fn thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
        where
            F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static,
        {
            // SAFETY: `F` is a ZST fn item — no bit pattern to invalidate.
            let f: F = unsafe { core::mem::MaybeUninit::zeroed().assume_init() };
            // SAFETY: JSC passes live non-null `*JSGlobalObject` / `*CallFrame`.
            let global = unsafe { &*g };
            let frame = unsafe { &*c };
            match f(global, frame) {
                Ok(v) => v,
                Err(JsError::OutOfMemory) => { let _ = global.throw_out_of_memory(); JSValue::ZERO }
                Err(_) => JSValue::ZERO,
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
        debug_assert_eq!(core::mem::size_of::<F>(), 0, "IntoJSHostFn: expected fn item (ZST)");
        let _ = self;
        unsafe extern "C" fn thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
        where
            F: Fn(&JSGlobalObject, &CallFrame) -> JSValue + Copy + 'static,
        {
            // SAFETY: `F` is a ZST fn item.
            let f: F = unsafe { core::mem::MaybeUninit::zeroed().assume_init() };
            // SAFETY: JSC passes live non-null pointers.
            f(unsafe { &*g }, unsafe { &*c })
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
    fn JSFunction__createFromZig(
        global: *mut JSGlobalObject,
        fn_name: bun_string::String,
        implementation: JSHostFn,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: Option<JSHostFn>,
    ) -> JSValue;
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
        let fn_name = bun_string::String::init(name);
        // SAFETY: `global` is live; `implementation` is a valid C-ABI fn ptr.
        unsafe {
            JSFunction__createFromZig(
                global.as_mut_ptr(),
                fn_name,
                implementation,
                arg_count,
                opts.implementation_visibility,
                opts.intrinsic,
                opts.constructor,
            )
        }
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
            Self { remaining: slice, _vm: core::ptr::null() }
        }
        #[allow(dead_code)]
        pub fn next(&mut self) -> Option<JSValue> {
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
    // SAFETY: `MarkedArgumentBuffer__run` round-trips `ctx` opaquely back to
    // `f`; both params are thin pointers so the transmute is ABI-identical.
    unsafe {
        MarkedArgumentBuffer__run(
            ctx,
            core::mem::transmute::<
                extern "C" fn(*mut Ctx, *mut MarkedArgumentBuffer),
                extern "C" fn(*mut c_void, *mut c_void),
            >(f),
        )
    }
}

/// Opaque handle to bun_runtime::api::SSLContextCache (owned by RuntimeState).
/// Reached via [VirtualMachineSqlExt::ssl_ctx_cache]; backed by
/// Bun__RareData__sslCtxCache / Bun__SSLContextCache__getOrCreateOpts in
/// src/runtime/hw_exports.rs.
#[repr(C)]
pub struct SslCtxCache { _opaque: core::cell::UnsafeCell<[u8; 0]> }
impl SslCtxCache {
    pub fn get_or_create_opts(
        &mut self,
        opts: bun_uws::us_bun_socket_context_options_t,
        err: &mut bun_uws::create_bun_socket_error_t,
    ) -> Option<*mut bun_uws::SslCtx> {
        // SAFETY: self is &runtime_state().ssl_ctx_cache; opts passed by
        // value; err is a valid out-param.
        let p = unsafe {
            Bun__SSLContextCache__getOrCreateOpts(
                self._opaque.get() as *mut c_void,
                &opts as *const _,
                err as *mut bun_uws::create_bun_socket_error_t as *mut c_int,
            )
        };
        if p.is_null() { None } else { Some(p) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// extern "C" — JSC bindings (src/jsc/bindings/bindings.cpp) used by the
// extension traits / local types above.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    // JSValue
    fn JSBuffer__bufferFromPointerAndLengthAndDeinit(
        global: *mut JSGlobalObject, ptr: *mut u8, len: usize,
        ctx: *mut c_void,
        deallocator: Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>,
    ) -> JSValue;
    fn MarkedArrayBuffer_deallocator(bytes: *mut c_void, ctx: *mut c_void);
    fn JSC__JSValue__toUInt64NoTruncate(this: JSValue) -> u64;
    fn JSC__isBigIntInInt64Range(this: JSValue, min: i64, max: i64) -> bool;
    fn JSC__isBigIntInUInt64Range(this: JSValue, min: u64, max: u64) -> bool;

    // JSGlobalObject
    fn JSC__JSGlobalObject__bunVM(this: *mut JSGlobalObject) -> *mut c_void;

    // MarkedArgumentBuffer
    fn MarkedArgumentBuffer__run(ctx: *mut c_void, f: extern "C" fn(*mut c_void, *mut c_void));

    // ── bun_runtime/hw_exports.rs (forward-dep; RuntimeState owns the
    // backing storage). VirtualMachine / EventLoop / RareData themselves are
    // imported directly from bun_jsc above; only the higher-tier state
    // (sql_rare, timer heap, ssl_ctx_cache, SSLConfig parser) crosses the
    // C ABI here.
    fn Bun__VM__rareData(vm: *mut VirtualMachine) -> *mut RareData;
    fn Bun__VM__timer(vm: *mut VirtualMachine) -> *mut TimerHeap;
    fn Bun__Timer__All__insert(this: *mut TimerHeap, timer: *mut EventLoopTimer);
    fn Bun__Timer__All__remove(this: *mut TimerHeap, timer: *mut EventLoopTimer);
    fn Bun__RareData__sslCtxCache(vm: *mut c_void) -> *mut SslCtxCache;
    fn Bun__SSLContextCache__getOrCreateOpts(
        this: *mut c_void,
        opts: *const bun_uws::us_bun_socket_context_options_t,
        err: *mut c_int,
    ) -> *mut bun_uws::SslCtx;
    fn Bun__SSLConfig__fromJS(global: *mut JSGlobalObject, value: JSValue, out: *mut c_void) -> bool;
    fn Bun__SSLConfig__asUSocketsClient(this: *const c_void, out: *mut bun_uws::us_bun_socket_context_options_t);
}
