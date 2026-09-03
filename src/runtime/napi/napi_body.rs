//! Node-API (N-API) implementation.

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicI64, AtomicU8, AtomicU32, AtomicUsize, Ordering};

use bun_collections::LinearFifo;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_event_loop::ConcurrentTask::AutoDeinit;
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_io::KeepAlive;
use bun_jsc::StringJsc;
use bun_jsc::bun_string_jsc;
use bun_jsc::event_loop::{ConcurrentTaskItem as ConcurrentTask, EventLoop};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, Debugger, GlobalRef, JSGlobalObject, JSPromiseStrong, JSValue,
    JsResult, StrongOptional, Task,
};
use bun_threading::Condition as Condvar;
use bun_threading::Mutex;
use bun_threading::work_pool::{IntrusiveWorkTask as _, Task as WorkPoolTask, WorkPool};

// ─── local shims for upstream-crate gaps (see PORTING.md §extension traits) ───

/// Local extension shims for `JSValue` methods not yet surfaced on the
/// `bun_jsc::JSValue` type.
trait JSValueNapiExt {
    fn is_async_context_frame(self) -> bool;
}

unsafe extern "C" {
    fn Bun__JSValue__isAsyncContextFrame(value: JSValue) -> bool;
}

impl JSValueNapiExt for JSValue {
    #[inline]
    fn is_async_context_frame(self) -> bool {
        // SAFETY: trivial FFI.
        unsafe { Bun__JSValue__isAsyncContextFrame(self) }
    }
}

// `Taskable` impls for the napi heap tasks dispatched through the JS event loop.
impl Taskable for napi_async_work {
    const TAG: TaskTag = task_tag::NapiAsyncWork;
    /// Work the pool handed back during teardown: its `complete` callback is
    /// how the addon learns the outcome and frees the work (Node calls it from
    /// environment cleanup too); script it tries to run is refused at the boundary.
    unsafe fn release_unrun(this: *mut Self) {
        let global = VirtualMachine::get().global();
        // `Err` is left pending for the release dispatcher's fold.
        // SAFETY: fn contract — the addon's live work object the pool posted.
        let _ = unsafe { (*this).run_from_js(global) };
    }
}
impl Taskable for ThreadSafeFunction {
    const TAG: TaskTag = task_tag::ThreadSafeFunction;
    /// `this` is the TSFN itself, which the env's cleanup hook (`env_teardown`,
    /// run with the exit handlers before the queue is released) already
    /// neutralised or freed. Nothing to do, and `this` must not be dereferenced.
    unsafe fn release_unrun(_: *mut Self) {}
}
impl Taskable for NapiFinalizerTask {
    const TAG: TaskTag = task_tag::NapiFinalizerTask;
    /// A finalizer queued before the loop stopped: Node runs an addon's
    /// finalizers during environment cleanup (script already forbidden), and
    /// an addon counts on them (external buffers freed when a Worker exits).
    unsafe fn release_unrun(this: *mut Self) {
        // `Err` is left pending for the release dispatcher's fold.
        let _ = NapiFinalizerTask::run_on_js_thread(this);
    }
}

bun_output::declare_scope!(napi, visible);

// ──────────────────────────────────────────────────────────────────────────
// NapiEnv
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// This is `struct napi_env__` from napi.h
    ///
    /// Opaque C++ object. `!Freeze` so that `&NapiEnv` does not assert
    /// immutability — C++ mutates the underlying object (e.g.
    /// `napi_set_last_error`, handle-scope push/pop) through pointers derived
    /// from `&self`. See [`Self::as_mut_ptr`].
    pub struct NapiEnv;
}

#[allow(improper_ctypes)] // `vm_handle::Shared` is opaque to C++ (`BunVmHandleRef`)
unsafe extern "C" {
    fn NapiEnv__globalObject(env: *mut NapiEnv) -> *mut JSGlobalObject;
    fn NapiEnv__getAndClearPendingException(env: *mut NapiEnv, out: *mut JSValue) -> bool;
    fn NapiEnv__hasPendingException(env: *mut NapiEnv) -> bool;
    fn NapiEnv__deref(env: *mut NapiEnv);
    fn NapiEnv__ref(env: *mut NapiEnv);
    /// The reference to its VM's handle the env holds (`BunVmHandleRef`).
    fn NapiEnv__vmHandle(env: *mut NapiEnv) -> *const bun_jsc::vm_handle::Shared;
    fn napi_set_last_error(env: napi_env, status: NapiStatus) -> napi_status;
    fn NapiUngatedScope__construct(storage: *mut c_void, env: *mut NapiEnv);
    fn NapiUngatedScope__destruct(storage: *mut c_void);
}

impl NapiEnv {
    pub(crate) fn to_js(&self) -> &JSGlobalObject {
        // SAFETY: NapiEnv__globalObject always returns a valid non-null pointer.
        unsafe { &*NapiEnv__globalObject(self.as_mut_ptr()) }
    }

    /// Any thread holding an env ref: the env's VM handle.
    pub(crate) fn vm_handle(&self) -> bun_jsc::vm_handle::BorrowedRef {
        // SAFETY: the env holds a reference for its whole lifetime.
        unsafe { bun_jsc::VmHandle::borrow_ref(NapiEnv__vmHandle(self.as_mut_ptr())) }
    }

    /// Convert err to an extern napi_status, and store the error code in env so that it can be
    /// accessed by napi_get_last_error_info
    pub(crate) fn set_last_error(self_: Option<&Self>, err: NapiStatus) -> napi_status {
        // SAFETY: napi_set_last_error accepts null env.
        unsafe { napi_set_last_error(self_.map(Self::as_mut_ptr).unwrap_or(ptr::null_mut()), err) }
    }

    /// Convenience wrapper for set_last_error(.ok)
    pub(crate) fn ok(&self) -> napi_status {
        Self::set_last_error(Some(self), NapiStatus::ok)
    }

    /// These wrappers exist for convenience and so we can set a breakpoint in lldb
    pub(crate) fn invalid_arg(&self) -> napi_status {
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(napi, "invalid arg");
        }
        Self::set_last_error(Some(self), NapiStatus::invalid_arg)
    }

    pub(crate) fn generic_failure(&self) -> napi_status {
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(napi, "generic failure");
        }
        Self::set_last_error(Some(self), NapiStatus::generic_failure)
    }

    pub(crate) fn pending_exception(&self) -> napi_status {
        Self::set_last_error(Some(self), NapiStatus::pending_exception)
    }

    /// Checks both `env->m_pendingException` (set by `napi_throw*`) and the JSC
    /// VM exception slot. This is the gate Node.js's `NAPI_PREAMBLE` enforces.
    pub(crate) fn has_pending_exception(&self) -> bool {
        // SAFETY: env is non-null; C++ side is read-only here.
        unsafe { NapiEnv__hasPendingException(self.as_mut_ptr()) }
    }

    /// Assert that we're not currently performing garbage collection
    pub(crate) fn check_gc(&self) {
        // SAFETY: env is non-null; C++ side is read-only here.
        unsafe { napi_internal_check_gc(self.as_mut_ptr()) };
    }

    pub(crate) fn get_and_clear_pending_exception(&self) -> Option<JSValue> {
        let mut exception = JSValue::ZERO;
        // SAFETY: out-param is a valid stack location; interior mutability via
        // `as_mut_ptr` permits C++ to clear the pending exception.
        if unsafe { NapiEnv__getAndClearPendingException(self.as_mut_ptr(), &raw mut exception) } {
            return Some(exception);
        }
        None
    }

    /// After a native addon callback (a `complete`, a finalizer, a `call_js`):
    /// what it raised through Node-API — latched on the env — or left on the VM
    /// is that call's exception, surfaced as `Err` with it pending on the VM.
    /// If both exist the VM's own wins and the latched one is discarded (it
    /// cannot be reported without running JS over the pending one).
    pub(crate) fn surface_exception(&self, global: &JSGlobalObject) -> JsResult<()> {
        let latched = self.get_and_clear_pending_exception();
        if global.has_exception() {
            return Err(jsc::JsError::Thrown);
        }
        match latched {
            Some(exception) => Err(global.throw_value(exception)),
            None => Ok(()),
        }
    }
}

// SAFETY: NapiEnv refcount is managed externally by C++ via NapiEnv__ref/NapiEnv__deref;
// the pointee remains valid while the count is > 0.
unsafe impl bun_ptr::ExternalSharedDescriptor for NapiEnv {
    unsafe fn ext_ref(this: *mut Self) {
        // SAFETY: caller contract — `this` is a valid C++-owned napi_env.
        unsafe { NapiEnv__ref(this) }
    }
    unsafe fn ext_deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is a valid C++-owned napi_env.
        unsafe { NapiEnv__deref(this) }
    }
}

pub(super) type NapiEnvRef = bun_ptr::ExternalShared<NapiEnv>;

#[cold]
fn env_is_null() -> napi_status {
    // in this case we don't actually have an environment to set the last error on, so it doesn't
    // make sense to call napi_set_last_error
    NapiStatus::invalid_arg as napi_status
}

/// This is nullable because native modules may pass null pointers for the NAPI environment, which
/// is an error that our NAPI functions need to handle (by returning napi_invalid_arg). To specify
/// a Rust API that uses a never-null napi_env, use `&NapiEnv`.
pub(super) type napi_env = *mut NapiEnv;

bun_opaque::opaque_ffi! {
    /// Contents are not used by any Rust code
    pub struct Ref;
}

type napi_ref = *mut Ref;

// ──────────────────────────────────────────────────────────────────────────
// NapiHandleScope
// ──────────────────────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// Opaque C++ handle-scope object (see [`NapiEnv`] for rationale).
    pub struct NapiHandleScope;
}

// `crate::ffi::ffi_body` re-declares `NapiHandleScope__{open,close}` locally
// with `*mut c_void` (it only needs the symbol address for TCC injection and
// cannot name the private `NapiHandleScope` type). Both declarations are
// ABI-identical thin pointers; suppress the duplicate-signature lint here as
// well since which side it fires on depends on module traversal order.
#[allow(clashing_extern_declarations)]
unsafe extern "C" {
    pub(super) fn NapiHandleScope__open(env: *mut NapiEnv, escapable: bool)
    -> *mut NapiHandleScope;
    pub(super) fn NapiHandleScope__close(env: *mut NapiEnv, current: *mut NapiHandleScope);
    fn NapiHandleScope__append(env: *mut NapiEnv, value: usize);
    fn NapiHandleScope__escape(handle_scope: *mut NapiHandleScope, value: usize) -> bool;
}

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
enum EscapeError {
    #[error("escape called twice")]
    EscapeCalledTwice,
}

impl NapiHandleScope {
    /// Create a new handle scope in the given environment, or return null if creating one now is
    /// unsafe (i.e. inside a finalizer)
    fn open(env: &NapiEnv, escapable: bool) -> *mut NapiHandleScope {
        // SAFETY: env is valid; C++ mutates env's scope stack (interior mutability).
        unsafe { NapiHandleScope__open(env.as_mut_ptr(), escapable) }
    }

    /// Closes the given handle scope, releasing all values inside it, if it is safe to do so.
    /// Asserts that self is the current handle scope in env.
    fn close(self_: *mut NapiHandleScope, env: &NapiEnv) {
        // SAFETY: NapiHandleScope__close handles null `current`.
        unsafe { NapiHandleScope__close(env.as_mut_ptr(), self_) }
    }

    /// Place a value in the handle scope. Must be done while returning any JS value into NAPI
    /// callbacks, as the value must remain alive as long as the handle scope is active, even if the
    /// native module doesn't keep it visible on the stack.
    fn append(env: &NapiEnv, value: JSValue) {
        // SAFETY: env is valid; C++ appends to the current scope (interior mutability).
        unsafe { NapiHandleScope__append(env.as_mut_ptr(), value.encoded()) }
    }

    /// Move a value from the current handle scope (which must be escapable) to the reserved escape
    /// slot in the parent handle scope, allowing that value to outlive the current handle scope.
    /// Returns an error if escape() has already been called on this handle scope.
    fn escape(&self, value: JSValue) -> Result<(), EscapeError> {
        // SAFETY: self is a valid handle scope; C++ writes the escape slot
        // (interior mutability via `as_mut_ptr`).
        if !unsafe { NapiHandleScope__escape(self.as_mut_ptr(), value.encoded()) } {
            return Err(EscapeError::EscapeCalledTwice);
        }
        Ok(())
    }
}

/// RAII guard for [`NapiHandleScope::open`] / [`NapiHandleScope::close`].
pub(super) struct NapiHandleScopeGuard<'a> {
    scope: *mut NapiHandleScope,
    env: &'a NapiEnv,
}

impl NapiHandleScope {
    /// Open a non-escapable handle scope and return an RAII guard that closes
    /// it on `Drop`. If opening returns null (inside a finalizer), the guard's
    /// `Drop` is a no-op.
    #[must_use]
    fn open_scoped(env: &NapiEnv) -> NapiHandleScopeGuard<'_> {
        NapiHandleScopeGuard {
            scope: Self::open(env, false),
            env,
        }
    }
}

impl Drop for NapiHandleScopeGuard<'_> {
    fn drop(&mut self) {
        if !self.scope.is_null() {
            NapiHandleScope::close(self.scope, self.env);
        }
    }
}

type napi_handle_scope = *mut NapiHandleScope;
type napi_escapable_handle_scope = *mut NapiHandleScope;
pub(super) type napi_callback_info = *mut CallFrame;
type napi_deferred = *mut JSPromiseStrong;

// ──────────────────────────────────────────────────────────────────────────
// napi_value
// ──────────────────────────────────────────────────────────────────────────

/// To ensure napi_values are not collected prematurely after being returned into a native module,
/// you must use these functions rather than convert between napi_value and jsc::JSValue directly
#[repr(transparent)]
#[derive(Copy, Clone)]
pub(crate) struct napi_value(i64);

impl napi_value {
    pub(crate) fn set(&mut self, env: &NapiEnv, val: JSValue) {
        NapiHandleScope::append(env, val);
        self.0 = val.encoded() as i64;
    }

    pub(crate) fn get(self) -> JSValue {
        JSValue::from_encoded(self.0 as usize)
    }

    pub(crate) fn create(env: &NapiEnv, val: JSValue) -> napi_value {
        NapiHandleScope::append(env, val);
        napi_value(val.encoded() as i64)
    }
}

type char16_t = u16;
pub(super) type napi_property_attributes = c_uint;

// Only used as `*mut napi_valuetype` out-param written by C++; Rust never
// constructs or matches variants.
type napi_valuetype = u32;

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum napi_typedarray_type {
    int8_array = 0,
    uint8_array = 1,
    uint8_clamped_array = 2,
    int16_array = 3,
    uint16_array = 4,
    int32_array = 5,
    uint32_array = 6,
    float32_array = 7,
    float64_array = 8,
    bigint64_array = 9,
    biguint64_array = 10,
    float16_array = 11,
}

impl napi_typedarray_type {
    fn from_js_type(this: jsc::JSType) -> Option<napi_typedarray_type> {
        // Note: jsc::JSType is a newtype struct with associated consts (not an enum),
        // so glob-import is unavailable; match on the qualified const paths instead.
        Some(match this {
            jsc::JSType::Int8Array => napi_typedarray_type::int8_array,
            jsc::JSType::Uint8Array => napi_typedarray_type::uint8_array,
            jsc::JSType::Uint8ClampedArray => napi_typedarray_type::uint8_clamped_array,
            jsc::JSType::Int16Array => napi_typedarray_type::int16_array,
            jsc::JSType::Uint16Array => napi_typedarray_type::uint16_array,
            jsc::JSType::Int32Array => napi_typedarray_type::int32_array,
            jsc::JSType::Uint32Array => napi_typedarray_type::uint32_array,
            jsc::JSType::Float32Array => napi_typedarray_type::float32_array,
            jsc::JSType::Float64Array => napi_typedarray_type::float64_array,
            jsc::JSType::BigInt64Array => napi_typedarray_type::bigint64_array,
            jsc::JSType::BigUint64Array => napi_typedarray_type::biguint64_array,
            jsc::JSType::Float16Array => napi_typedarray_type::float16_array,
            _ => return None,
        })
    }
}

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum NapiStatus {
    ok = 0,
    invalid_arg = 1,
    object_expected = 2,
    string_expected = 3,
    name_expected = 4,
    function_expected = 5,
    number_expected = 6,
    boolean_expected = 7,
    array_expected = 8,
    generic_failure = 9,
    pending_exception = 10,
    cancelled = 11,
    escape_called_twice = 12,
    handle_scope_mismatch = 13,
    callback_scope_mismatch = 14,
    queue_full = 15,
    closing = 16,
    bigint_expected = 17,
    date_expected = 18,
    arraybuffer_expected = 19,
    detachable_arraybuffer_expected = 20,
    would_deadlock = 21,
    no_external_buffers_allowed = 22,
    cannot_run_js = 23,
}

/// This is not an `enum` so that the enum values cannot be trivially returned from NAPI functions,
/// as that would skip storing the last error code. You should wrap return values in a call to
/// NapiEnv::set_last_error.
pub(super) type napi_status = c_uint;

pub(super) type napi_callback = Option<extern "C" fn(napi_env, napi_callback_info) -> napi_value>;

/// expects `napi_env`, `callback_data`, `context`
pub(super) type NapiFinalizeFunction = extern "C" fn(napi_env, *mut c_void, *mut c_void);
pub(super) type napi_finalize = Option<NapiFinalizeFunction>;

#[repr(C)]
pub(super) struct napi_property_descriptor {
    pub utf8name: *const c_char,
    pub name: napi_value,
    pub method: napi_callback,
    pub getter: napi_callback,
    pub setter: napi_callback,
    pub value: napi_value,
    pub attributes: napi_property_attributes,
    pub data: *mut c_void,
}

#[repr(C)]
pub(super) struct napi_extended_error_info {
    pub error_message: *const c_char,
    pub engine_reserved: *mut c_void,
    pub engine_error_code: u32,
    pub error_code: napi_status,
}

type napi_key_collection_mode = c_uint;
type napi_key_filter = c_uint;
type napi_key_conversion = c_uint;

#[repr(C)]
pub(super) struct napi_type_tag {
    lower: u64,
    upper: u64,
}

// ──────────────────────────────────────────────────────────────────────────
// Helper macro: unwrap nullable env / nullable out-param
// ──────────────────────────────────────────────────────────────────────────

macro_rules! get_env {
    ($env:expr) => {
        // SAFETY: caller passes raw napi_env; we treat non-null as &NapiEnv borrow.
        match unsafe { $env.as_ref() } {
            Some(e) => e,
            None => return env_is_null(),
        }
    };
}

/// Like `get_env!` but also returns `napi_pending_exception` if a JS exception
/// is pending on the env (mirrors Node's `NAPI_PREAMBLE`). Use this for napi
/// entry points that can execute JS or have observable side effects.
macro_rules! preamble {
    ($env:expr) => {{
        let env = get_env!($env);
        if env.has_pending_exception() {
            return env.pending_exception();
        }
        env
    }};
}

/// napi.cpp's `NapiUngatedScope` (see the comment there), constructed in place in this storage.
#[repr(C, align(8))]
struct UngatedScope([core::mem::MaybeUninit<u8>; 80]);

struct UngatedScopeGuard<'a>(&'a mut UngatedScope);

impl UngatedScope {
    #[inline]
    fn enter<'a>(
        storage: &'a mut core::mem::MaybeUninit<UngatedScope>,
        env: &NapiEnv,
    ) -> UngatedScopeGuard<'a> {
        let this = storage.write(UngatedScope([core::mem::MaybeUninit::uninit(); 80]));
        // SAFETY: storage is 80 bytes, 8-aligned, and stays put until the guard drops; napi.cpp
        // static_asserts that NapiUngatedScope fits.
        unsafe { NapiUngatedScope__construct(this.0.as_mut_ptr().cast(), env.as_mut_ptr()) };
        UngatedScopeGuard(this)
    }
}

impl Drop for UngatedScopeGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: constructed by `enter`, destroyed exactly once here.
        unsafe { NapiUngatedScope__destruct(self.0.0.as_mut_ptr().cast()) };
    }
}

/// `get_env!`, then the rest of the function runs under napi.cpp's `NapiUngatedScope` (which see): no JS or addon code.
macro_rules! ungated {
    ($env:ident, $raw:expr) => {
        let $env = get_env!($raw);
        let mut napi_ungated_storage = ::core::mem::MaybeUninit::<UngatedScope>::uninit();
        let _napi_ungated_scope = UngatedScope::enter(&mut napi_ungated_storage, $env);
    };
}

macro_rules! get_out {
    ($env:expr, $ptr:expr) => {
        // SAFETY: caller passes raw out pointer; we treat non-null as &mut borrow.
        match unsafe { $ptr.as_mut() } {
            Some(r) => r,
            None => return $env.invalid_arg(),
        }
    };
}

/// Write `v` through an optional N-API out-param pointer.
///
/// N-API "info" entry points take a family of nullable `*mut T` out-params where
/// `NULL` means "caller doesn't want this field". This helper centralizes the
/// `if let Some(r) = ptr.as_mut() { *r = v }` pattern so the per-site `unsafe`
/// blocks collapse into one audited location.
///
/// # Safety
/// The caller (the native addon) must pass either `NULL` or a pointer that is:
/// - valid for a single write of `T`,
/// - properly aligned for `T`,
/// - not aliased by any other live `&`/`&mut` borrow for the duration of the call.
///
/// These are exactly the N-API ABI guarantees for out-params, so call sites in
/// `extern "C" fn napi_*` bodies need no additional justification.
#[inline]
fn write_out<T>(p: *mut T, v: T) {
    // SAFETY: see doc comment — `p` is either null (skipped) or a valid,
    // exclusively-owned out-param per the N-API contract.
    if let Some(r) = unsafe { p.as_mut() } {
        *r = v;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Exported / extern NAPI functions
// ──────────────────────────────────────────────────────────────────────────

// Implemented in C++ (napi.cpp); declared extern here for Rust-side callers.
unsafe extern "C" {
    pub(super) fn napi_get_last_error_info(
        env: napi_env,
        result: *mut *const napi_extended_error_info,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_undefined(env_: napi_env, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_undefined");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::UNDEFINED);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_null(env_: napi_env, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_null");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::NULL);
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_get_global(env: napi_env, result: *mut napi_value) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_boolean(
    env_: napi_env,
    value: bool,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_boolean");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::from(value));
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_array(env_: napi_env, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_array");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let arr = match JSValue::create_empty_array(env.to_js(), 0) {
        Ok(v) => v,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    result.set(env, arr);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_array_with_length(
    env_: napi_env,
    length: usize,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_array_with_length");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);

    // https://github.com/nodejs/node/blob/14c68e3b536798e25f810ed7ae180a5cde9e47d3/deps/v8/src/api/api.cc#L8163-L8174
    // size_t immediately cast to int as argument to Array::New, then min 0
    // Bit-reinterpret usize as i64 (same width on 64-bit targets).
    let len_i64: i64 = length as i64;
    let len_i32: i32 = len_i64 as i32; // intentional truncation
    let len: u32 = if len_i32 > 0 { len_i32 as u32 } else { 0 };

    let array = match JSValue::create_empty_array(env.to_js(), len as usize) {
        Ok(v) => v,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    array.ensure_still_alive();
    result.set(env, array);
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_create_double(
        env: napi_env,
        value: f64,
        result: *mut napi_value,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_int32(
    env_: napi_env,
    value: i32,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_int32");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value as f64));
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_uint32(
    env_: napi_env,
    value: u32,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_uint32");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value as f64));
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_int64(
    env_: napi_env,
    value: i64,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_int64");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value as f64));
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_string_latin1(
    env_: napi_env,
    str_: *const u8,
    length: usize,
    result_: *mut napi_value,
) -> napi_status {
    ungated!(env, env_);
    let result = get_out!(env, result_);

    let slice: &[u8] = 'brk: {
        if !str_.is_null() {
            if NAPI_AUTO_LENGTH == length {
                // SAFETY: caller guarantees ptr is NUL-terminated when length == NAPI_AUTO_LENGTH.
                break 'brk unsafe { bun_core::ffi::cstr(str_.cast::<c_char>()) }.to_bytes();
            } else if length > i32::MAX as usize {
                return env.invalid_arg();
            } else {
                // SAFETY: caller guarantees [ptr, ptr+length) is valid.
                break 'brk unsafe { bun_core::ffi::slice(str_, length) };
            }
        }

        if length == 0 {
            break 'brk &[];
        } else {
            return env.invalid_arg();
        }
    };

    bun_output::scoped_log!(
        napi,
        "napi_create_string_latin1: {}",
        bstr::BStr::new(slice)
    );

    if slice.is_empty() {
        result.set(env, JSValue::js_empty_string(env.to_js()));
        return env.ok();
    }

    let (string, bytes) = bun_core::String::create_uninitialized_latin1(slice.len());
    bytes.copy_from_slice(slice);

    let js = match string.into_js(env.to_js()) {
        Ok(v) => v,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::generic_failure),
    };
    result.set(env, js);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_string_utf8(
    env_: napi_env,
    str_: *const u8,
    length: usize,
    result_: *mut napi_value,
) -> napi_status {
    ungated!(env, env_);
    let result = get_out!(env, result_);

    let slice: &[u8] = 'brk: {
        if !str_.is_null() {
            if NAPI_AUTO_LENGTH == length {
                // SAFETY: caller guarantees ptr is NUL-terminated when length == NAPI_AUTO_LENGTH.
                break 'brk unsafe { bun_core::ffi::cstr(str_.cast::<c_char>()) }.to_bytes();
            } else if length > i32::MAX as usize {
                return env.invalid_arg();
            } else {
                // SAFETY: caller guarantees [ptr, ptr+length) is valid.
                break 'brk unsafe { bun_core::ffi::slice(str_, length) };
            }
        }

        if length == 0 {
            break 'brk &[];
        } else {
            return env.invalid_arg();
        }
    };

    bun_output::scoped_log!(napi, "napi_create_string_utf8: {}", bstr::BStr::new(slice));

    let global_object = env.to_js();
    let string = match bun_string_jsc::create_utf8_for_js(global_object, slice) {
        Ok(v) => v,
        Err(_) => return env.generic_failure(),
    };
    result.set(env, string);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_string_utf16(
    env_: napi_env,
    str_: *const char16_t,
    length: usize,
    result_: *mut napi_value,
) -> napi_status {
    ungated!(env, env_);
    let result = get_out!(env, result_);

    let slice: &[u16] = 'brk: {
        if !str_.is_null() {
            if NAPI_AUTO_LENGTH == length {
                // SAFETY: caller guarantees ptr is NUL-terminated when length == NAPI_AUTO_LENGTH.
                // Scan to the NUL u16 terminator.
                break 'brk unsafe { bun_core::ffi::wstr_units(str_) };
            } else if length > i32::MAX as usize {
                return env.invalid_arg();
            } else {
                // SAFETY: caller guarantees [ptr, ptr+length) is valid.
                break 'brk unsafe { bun_core::ffi::slice(str_, length) };
            }
        }

        if length == 0 {
            break 'brk &[];
        } else {
            return env.invalid_arg();
        }
    };

    if cfg!(debug_assertions) {
        bun_output::scoped_log!(
            napi,
            "napi_create_string_utf16: {} {}",
            slice.len(),
            bun_core::fmt::utf16(&slice[..slice.len().min(512)])
        );
    }

    if slice.is_empty() {
        result.set(env, JSValue::js_empty_string(env.to_js()));
        return env.ok();
    }

    let (string, chars) = bun_core::String::create_uninitialized_utf16(slice.len());
    chars.copy_from_slice(slice);

    let js = match string.into_js(env.to_js()) {
        Ok(v) => v,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::generic_failure),
    };
    result.set(env, js);
    env.ok()
}

// Implemented in C++ (napi.cpp); declared extern here for Rust-side callers.
unsafe extern "C" {
    pub(super) fn napi_create_symbol(
        env: napi_env,
        description: napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_create_error(
        env: napi_env,
        code: napi_value,
        msg: napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_create_type_error(
        env: napi_env,
        code: napi_value,
        msg: napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_create_range_error(
        env: napi_env,
        code: napi_value,
        msg: napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_typeof(
        env: napi_env,
        value: napi_value,
        result: *mut napi_valuetype,
    ) -> napi_status;
    pub(super) fn napi_get_value_double(
        env: napi_env,
        value: napi_value,
        result: *mut f64,
    ) -> napi_status;
    pub(super) fn napi_get_value_int32(
        env: napi_env,
        value: napi_value,
        result: *mut i32,
    ) -> napi_status;
    pub(super) fn napi_get_value_uint32(
        env: napi_env,
        value: napi_value,
        result: *mut u32,
    ) -> napi_status;
    pub(super) fn napi_get_value_int64(
        env: napi_env,
        value: napi_value,
        result: *mut i64,
    ) -> napi_status;
    pub(super) fn napi_get_value_bool(
        env: napi_env,
        value: napi_value,
        result: *mut bool,
    ) -> napi_status;
    pub(super) fn napi_get_value_string_latin1(
        env: napi_env,
        value: napi_value,
        buf_ptr: *mut c_char,
        bufsize: usize,
        result_ptr: *mut usize,
    ) -> napi_status;
    /// Copies a JavaScript string into a UTF-8 string buffer. The result is the
    /// number of bytes (excluding the null terminator) copied into buf.
    /// A sufficient buffer size should be greater than the length of string,
    /// reserving space for null terminator.
    /// If bufsize is insufficient, the string will be truncated and null terminated.
    /// If buf is NULL, this method returns the length of the string (in bytes)
    /// via the result parameter.
    /// The result argument is optional unless buf is NULL.
    pub(super) fn napi_get_value_string_utf8(
        env: napi_env,
        value: napi_value,
        buf_ptr: *mut u8,
        bufsize: usize,
        result_ptr: *mut usize,
    ) -> napi_status;
    pub(super) fn napi_get_value_string_utf16(
        env: napi_env,
        value: napi_value,
        buf_ptr: *mut char16_t,
        bufsize: usize,
        result_ptr: *mut usize,
    ) -> napi_status;
    pub(super) fn napi_coerce_to_bool(
        env: napi_env,
        value: napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_coerce_to_number(
        env: napi_env,
        value: napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_coerce_to_object(
        env: napi_env,
        value: napi_value,
        result: *mut napi_value,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_prototype(
    env_: napi_env,
    object_: napi_value,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_prototype");
    let env = preamble!(env_);
    let result = get_out!(env, result_);
    let object = object_.get();
    if object.is_empty() {
        return env.invalid_arg();
    }
    // Node's CHECK_TO_OBJECT: ToObject throws on null/undefined; leave the
    // TypeError pending and return napi_object_expected. Other primitives are
    // coerced, so `get_prototype` (which synthesizes the prototype for
    // non-object values) handles them without an allocation.
    if object.is_undefined_or_null() {
        let _ = object.to_object(env.to_js());
        return NapiEnv::set_last_error(Some(env), NapiStatus::object_expected);
    }

    // Like V8's Object::GetPrototype: a Proxy yields null and its trap never runs.
    if object.js_type() == jsc::JSType::ProxyObject {
        result.set(env, JSValue::NULL);
        return env.ok();
    }
    let prototype = match object.get_prototype(env.to_js()) {
        Ok(prototype) => prototype,
        Err(_) => return env.pending_exception(),
    };
    result.set(env, prototype);
    env.ok()
}

// TODO: bind JSC::ownKeys
// pub extern "C" fn napi_get_property_names(env: napi_env, object: napi_value, result: *mut napi_value) -> napi_status {
//     log("napi_get_property_names");
//     if !object.is_object() {
//         return .object_expected;
//     }
//     result.* =
// }

unsafe extern "C" {
    pub(super) fn napi_set_element(
        env: napi_env,
        object: napi_value,
        index: c_uint,
        value: napi_value,
    ) -> napi_status;
    pub(super) fn napi_has_element(
        env: napi_env,
        object: napi_value,
        index: c_uint,
        result: *mut bool,
    ) -> napi_status;
    pub(super) fn napi_get_element(
        env: napi_env,
        object: napi_value,
        index: u32,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_delete_element(
        env: napi_env,
        object: napi_value,
        index: u32,
        result: *mut bool,
    ) -> napi_status;
    pub(super) fn napi_define_properties(
        env: napi_env,
        object: napi_value,
        property_count: usize,
        properties: *const napi_property_descriptor,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_is_array(env_: napi_env, value_: napi_value, result_: *mut bool) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_array");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    *result = value.js_type().is_array();
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_array_length(
    env_: napi_env,
    value_: napi_value,
    result_: *mut u32,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_array_length");
    let env = preamble!(env_);
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }

    if !value.js_type().is_array() {
        return NapiEnv::set_last_error(Some(env), NapiStatus::array_expected);
    }

    *result = match value.get_length(env.to_js()) {
        Ok(len) => len as u32, // intentional truncation
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_strict_equals(
    env_: napi_env,
    lhs_: napi_value,
    rhs_: napi_value,
    result_: *mut bool,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_strict_equals");
    let env = preamble!(env_);
    let result = get_out!(env, result_);
    let (lhs, rhs) = (lhs_.get(), rhs_.get());
    if lhs.is_empty() || rhs.is_empty() {
        return env.invalid_arg();
    }
    *result = match lhs.is_strict_equal(rhs, env.to_js()) {
        Ok(b) => b,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    };
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_call_function(
        env: napi_env,
        recv: napi_value,
        func: napi_value,
        argc: usize,
        argv: *const napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_new_instance(
        env: napi_env,
        constructor: napi_value,
        argc: usize,
        argv: *const napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_instanceof(
        env: napi_env,
        object: napi_value,
        constructor: napi_value,
        result: *mut bool,
    ) -> napi_status;
    pub(super) fn napi_get_cb_info(
        env: napi_env,
        cbinfo: napi_callback_info,
        argc: *mut usize,
        argv: *mut napi_value,
        this_arg: *mut napi_value,
        data: *mut *mut c_void,
    ) -> napi_status;
    pub(super) fn napi_get_new_target(
        env: napi_env,
        cbinfo: napi_callback_info,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_define_class(
        env: napi_env,
        utf8name: *const c_char,
        length: usize,
        constructor: napi_callback,
        data: *mut c_void,
        property_count: usize,
        properties: *const napi_property_descriptor,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_wrap(
        env: napi_env,
        js_object: napi_value,
        native_object: *mut c_void,
        finalize_cb: napi_finalize,
        finalize_hint: *mut c_void,
        result: *mut napi_ref,
    ) -> napi_status;
    pub(super) fn napi_unwrap(
        env: napi_env,
        js_object: napi_value,
        result: *mut *mut c_void,
    ) -> napi_status;
    pub(super) fn napi_remove_wrap(
        env: napi_env,
        js_object: napi_value,
        result: *mut *mut c_void,
    ) -> napi_status;
    pub(super) fn napi_create_object(env: napi_env, result: *mut napi_value) -> napi_status;
    pub(super) fn napi_create_external(
        env: napi_env,
        data: *mut c_void,
        finalize_cb: napi_finalize,
        finalize_hint: *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_get_value_external(
        env: napi_env,
        value: napi_value,
        result: *mut *mut c_void,
    ) -> napi_status;
    pub(super) fn napi_create_reference(
        env: napi_env,
        value: napi_value,
        initial_refcount: u32,
        result: *mut napi_ref,
    ) -> napi_status;
    pub(super) fn napi_delete_reference(env: napi_env, ref_: napi_ref) -> napi_status;
    pub(super) fn napi_reference_ref(
        env: napi_env,
        ref_: napi_ref,
        result: *mut u32,
    ) -> napi_status;
    pub(super) fn napi_reference_unref(
        env: napi_env,
        ref_: napi_ref,
        result: *mut u32,
    ) -> napi_status;
    pub(super) fn napi_get_reference_value(
        env: napi_env,
        ref_: napi_ref,
        result: *mut napi_value,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_open_handle_scope(
    env_: napi_env,
    result_: *mut napi_handle_scope,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    *result = NapiHandleScope::open(env, false);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_close_handle_scope(
    env_: napi_env,
    handle_scope: napi_handle_scope,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_close_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    if !handle_scope.is_null() {
        NapiHandleScope::close(handle_scope, env);
    }
    env.ok()
}

// we don't support async contexts
#[unsafe(no_mangle)]
extern "C" fn napi_async_init(
    env_: napi_env,
    _async_resource: napi_value,
    _async_resource_name: napi_value,
    async_ctx_: *mut *mut c_void,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_async_init");
    let env = get_env!(env_);
    let async_ctx = get_out!(env, async_ctx_);
    *async_ctx = env_.cast::<c_void>();
    env.ok()
}

// we don't support async contexts
#[unsafe(no_mangle)]
extern "C" fn napi_async_destroy(env_: napi_env, _async_ctx: *mut c_void) -> napi_status {
    bun_output::scoped_log!(napi, "napi_async_destroy");
    let env = get_env!(env_);
    env.ok()
}

// this is just a regular function call
#[unsafe(no_mangle)]
extern "C" fn napi_make_callback(
    env_: napi_env,
    _async_ctx: *mut c_void,
    recv_: napi_value,
    func_: napi_value,
    arg_count: usize,
    args: *const napi_value,
    maybe_result: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_make_callback");
    let env = preamble!(env_);
    let (recv, func) = (recv_.get(), func_.get());
    if recv.is_empty() {
        return env.invalid_arg();
    }
    if arg_count > 0 && args.is_null() {
        return env.invalid_arg();
    }
    if func.is_empty_or_undefined_or_null()
        || (!func.is_callable() && !func.is_async_context_frame())
    {
        return env.invalid_arg();
    }

    let this_value = recv;
    let args_slice: &[JSValue] = if arg_count > 0 {
        // SAFETY: napi_value is repr(transparent) over i64, same as JSValue; the
        // arg_count > 0 && args.is_null() case returned napi_invalid_arg above,
        // and caller guarantees [args, args+arg_count) is valid.
        unsafe { bun_core::ffi::slice(args.cast::<JSValue>(), arg_count) }
    } else {
        &[]
    };

    // Node.js returns napi_pending_exception iff the callback threw, leaves the
    // exception pending for napi_is_exception_pending / napi_get_and_clear_last_exception,
    // and does not write *result in that case. A callback that *returns* an Error
    // without throwing is napi_ok.
    let res = match func.call(env.to_js(), this_value, args_slice) {
        Ok(v) => v,
        Err(_) => return env.pending_exception(),
    };

    // SAFETY: `maybe_result` is null or a valid exclusive out-param per N-API contract.
    if let Some(result) = unsafe { maybe_result.as_mut() } {
        result.set(env, res);
    }

    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_open_escapable_handle_scope(
    env_: napi_env,
    result_: *mut napi_escapable_handle_scope,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_escapable_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    *result = NapiHandleScope::open(env, true);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_close_escapable_handle_scope(
    env_: napi_env,
    scope: napi_escapable_handle_scope,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_close_escapable_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    if !scope.is_null() {
        NapiHandleScope::close(scope, env);
    }
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_escape_handle(
    env_: napi_env,
    scope_: napi_escapable_handle_scope,
    escapee: napi_value,
    result_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_escape_handle");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    // SAFETY: scope_ is a raw NAPI handle; non-null is treated as &NapiHandleScope.
    let Some(scope) = (unsafe { scope_.as_ref() }) else {
        return env.invalid_arg();
    };
    if scope.escape(escapee.get()).is_err() {
        return NapiEnv::set_last_error(Some(env), NapiStatus::escape_called_twice);
    }
    *result = escapee;
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_type_tag_object(
        env: napi_env,
        value: napi_value,
        tag: *const napi_type_tag,
    ) -> napi_status;
    pub(super) fn napi_check_object_type_tag(
        env: napi_env,
        value: napi_value,
        tag: *const napi_type_tag,
        result: *mut bool,
    ) -> napi_status;
}

// do nothing for both of these
#[unsafe(no_mangle)]
extern "C" fn napi_open_callback_scope(
    _env: napi_env,
    _resource: napi_value,
    _context: *mut c_void,
    _result: *mut c_void,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_callback_scope");
    NapiStatus::ok as napi_status
}

#[unsafe(no_mangle)]
extern "C" fn napi_close_callback_scope(_env: napi_env, _scope: *mut c_void) -> napi_status {
    bun_output::scoped_log!(napi, "napi_close_callback_scope");
    NapiStatus::ok as napi_status
}

unsafe extern "C" {
    pub(super) fn napi_throw(env: napi_env, error: napi_value) -> napi_status;
    pub(super) fn napi_throw_error(
        env: napi_env,
        code: *const c_char,
        msg: *const c_char,
    ) -> napi_status;
    pub(super) fn napi_throw_type_error(
        env: napi_env,
        code: *const c_char,
        msg: *const c_char,
    ) -> napi_status;
    pub(super) fn napi_throw_range_error(
        env: napi_env,
        code: *const c_char,
        msg: *const c_char,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_is_error(env_: napi_env, value_: napi_value, result_: *mut bool) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_error");
    ungated!(env, env_);
    env.check_gc();
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    let result = get_out!(env, result_);
    *result = value.is_any_error();
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_is_exception_pending(env: napi_env, result: *mut bool) -> napi_status;
    pub(super) fn napi_get_and_clear_last_exception(
        env: napi_env,
        result: *mut napi_value,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_is_arraybuffer(
    env_: napi_env,
    value_: napi_value,
    result_: *mut bool,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_arraybuffer");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    // A SharedArrayBuffer shares the `ArrayBuffer` cell type with a plain
    // ArrayBuffer in JSC, so `js_type` alone can't tell them apart. Node's
    // `napi_is_arraybuffer` maps to V8's `IsArrayBuffer()`, which is false for
    // SharedArrayBuffer, so exclude shared buffers here too.
    *result = value
        .as_array_buffer(env.to_js())
        .is_some_and(|ab| ab.typed_array_type == jsc::JSType::ArrayBuffer && !ab.shared);
    env.ok()
}

unsafe extern "C" {
    // Verified against the C++ implementation (napi.cpp `napi_create_arraybuffer`):
    // `data` is a `void**` out-param receiving the buffer's data pointer,
    // matching the N-API spec.
    pub(super) fn napi_create_arraybuffer(
        env: napi_env,
        byte_length: usize,
        data: *mut *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_create_external_arraybuffer(
        env: napi_env,
        external_data: *mut c_void,
        byte_length: usize,
        finalize_cb: napi_finalize,
        finalize_hint: *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_arraybuffer_info(
    env_: napi_env,
    arraybuffer_: napi_value,
    data: *mut *mut u8,
    byte_length: *mut usize,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_arraybuffer_info");
    ungated!(env, env_);
    env.check_gc();
    let arraybuffer = arraybuffer_.get();
    let Some(array_buffer) = arraybuffer.as_array_buffer(env.to_js()) else {
        return NapiEnv::set_last_error(Some(env), NapiStatus::invalid_arg);
    };
    if array_buffer.typed_array_type != jsc::JSType::ArrayBuffer {
        return NapiEnv::set_last_error(Some(env), NapiStatus::invalid_arg);
    }

    write_out(data, array_buffer.ptr);
    write_out(byte_length, array_buffer.byte_len);
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_is_typedarray(
        env: napi_env,
        value: napi_value,
        result: *mut bool,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_typedarray_info(
    env_: napi_env,
    typedarray_: napi_value,
    maybe_type: *mut napi_typedarray_type,
    maybe_length: *mut usize,
    maybe_data: *mut *mut u8,
    maybe_arraybuffer: *mut napi_value,
    maybe_byte_offset: *mut usize,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_typedarray_info");
    ungated!(env, env_);
    env.check_gc();
    let typedarray = typedarray_.get();
    if typedarray.is_empty_or_undefined_or_null() {
        return env.invalid_arg();
    }
    let _keep = jsc::EnsureStillAlive(typedarray);

    // Keep the pointer valid for the view's lifetime, as in Node: the
    // arraybuffer out-param below would otherwise invalidate it.
    if !maybe_data.is_null() && !typedarray.materialize_array_buffer_view_buffer() {
        return env.generic_failure();
    }

    let Some(array_buffer) = typedarray.as_array_buffer(env.to_js()) else {
        return env.invalid_arg();
    };
    // SAFETY: `maybe_type` is null or a valid exclusive out-param per N-API contract.
    if let Some(ty) = unsafe { maybe_type.as_mut() } {
        // The `ArrayBuffer.typed_array_type` field is already a `JSType`, so map it
        // straight to `napi_typedarray_type`.
        let Some(napi_ty) = napi_typedarray_type::from_js_type(array_buffer.typed_array_type)
        else {
            return env.invalid_arg();
        };
        *ty = napi_ty;
    }

    // TODO: handle detached
    write_out(maybe_data, array_buffer.ptr);
    write_out(maybe_length, array_buffer.len);

    // SAFETY: `maybe_arraybuffer` is null or a valid exclusive out-param per N-API contract.
    if let Some(arraybuffer) = unsafe { maybe_arraybuffer.as_mut() } {
        arraybuffer.set(env, typedarray.get_array_buffer_view_buffer(env.to_js()));
    }

    // SAFETY: `maybe_byte_offset` is null or a valid exclusive out-param per N-API contract.
    if let Some(byte_offset) = unsafe { maybe_byte_offset.as_mut() } {
        *byte_offset = typedarray.get_array_buffer_view_byte_offset();
    }
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_create_dataview(
        env: napi_env,
        length: usize,
        arraybuffer: napi_value,
        byte_offset: usize,
        result: *mut napi_value,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_is_dataview(
    env_: napi_env,
    value_: napi_value,
    result_: *mut bool,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_dataview");
    ungated!(env, env_);
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    *result =
        !value.is_empty_or_undefined_or_null() && value.js_type_loose() == jsc::JSType::DataView;
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_dataview_info(
    env_: napi_env,
    dataview_: napi_value,
    maybe_bytelength: *mut usize,
    maybe_data: *mut *mut u8,
    maybe_arraybuffer: *mut napi_value,
    maybe_byte_offset: *mut usize,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_dataview_info");
    ungated!(env, env_);
    env.check_gc();
    let dataview = dataview_.get();
    if dataview.is_empty() {
        return env.invalid_arg();
    }
    let Some(array_buffer) = dataview.as_array_buffer(env.to_js()) else {
        return NapiEnv::set_last_error(Some(env), NapiStatus::object_expected);
    };
    write_out(maybe_bytelength, array_buffer.byte_len);
    write_out(maybe_data, array_buffer.ptr);
    // SAFETY: `maybe_arraybuffer` is null or a valid exclusive out-param per N-API contract.
    if let Some(arraybuffer) = unsafe { maybe_arraybuffer.as_mut() } {
        arraybuffer.set(env, dataview.get_array_buffer_view_buffer(env.to_js()));
    }
    // SAFETY: `maybe_byte_offset` is null or a valid exclusive out-param per N-API contract.
    if let Some(byte_offset) = unsafe { maybe_byte_offset.as_mut() } {
        *byte_offset = dataview.get_array_buffer_view_byte_offset();
    }

    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_version(env_: napi_env, result_: *mut u32) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_version");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    // The result is supposed to be the highest NAPI version Bun supports, rather than the version reported by a NAPI module.
    // Keep this in sync with process.versions.napi in BunProcess.cpp.
    *result = 10;
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_promise(
    env_: napi_env,
    deferred_: *mut napi_deferred,
    promise_: *mut napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_promise");
    let env = preamble!(env_);
    let deferred = get_out!(env, deferred_);
    let promise = get_out!(env, promise_);
    let strong = Box::new(JSPromiseStrong::init(env.to_js()));
    let strong_ptr = bun_core::heap::into_raw(strong);
    *deferred = strong_ptr;
    // SAFETY: strong_ptr was just created from heap::alloc and is non-null.
    let prom_value = unsafe { (*strong_ptr).get() }.as_value(env.to_js());
    promise.set(env, prom_value);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_resolve_deferred(
    env_: napi_env,
    deferred: napi_deferred,
    resolution_: napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_resolve_deferred");
    let env = preamble!(env_);
    // SAFETY: deferred was created by heap::alloc in napi_create_promise.
    let deferred_box = unsafe { bun_core::heap::take(deferred) };
    // `deferred_box` drops at scope exit (deinit + free).
    let resolution = resolution_.get();
    let prom = deferred_box.get();
    if prom.resolve(env.to_js(), resolution).is_err() {
        return env.generic_failure();
    }
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_reject_deferred(
    env_: napi_env,
    deferred: napi_deferred,
    rejection_: napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_reject_deferred");
    let env = preamble!(env_);
    // SAFETY: deferred was created by heap::alloc in napi_create_promise.
    let deferred_box = unsafe { bun_core::heap::take(deferred) };
    let rejection = rejection_.get();
    let prom = deferred_box.get();
    if prom.reject(env.to_js(), Ok(rejection)).is_err() {
        return env.generic_failure();
    }
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_is_promise(
    env_: napi_env,
    value_: napi_value,
    is_promise_: *mut bool,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_promise");
    ungated!(env, env_);
    env.check_gc();
    let value = value_.get();
    let is_promise = get_out!(env, is_promise_);

    if value.is_empty() {
        return env.invalid_arg();
    }

    *is_promise = value.as_any_promise().is_some();
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_run_script(
        env: napi_env,
        script: napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_adjust_external_memory(
        env: napi_env,
        change_in_bytes: i64,
        adjusted_value: *mut i64,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_date(env_: napi_env, time: f64, result_: *mut napi_value) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_date");
    let env = preamble!(env_);
    let result = get_out!(env, result_);
    result.set(
        env,
        JSValue::from_date_number(env.to_js(), JSValue::purify_nan(time)),
    );
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_is_date(env_: napi_env, value_: napi_value, is_date_: *mut bool) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_date");
    ungated!(env, env_);
    env.check_gc();
    let is_date = get_out!(env, is_date_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    *is_date = value.js_type_loose() == jsc::JSType::JSDate;
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_get_date_value(
        env: napi_env,
        value: napi_value,
        result: *mut f64,
    ) -> napi_status;
    pub(super) fn napi_add_finalizer(
        env: napi_env,
        js_object: napi_value,
        native_object: *mut c_void,
        finalize_cb: napi_finalize,
        finalize_hint: *mut c_void,
        result: napi_ref,
    ) -> napi_status;
    pub(super) fn napi_create_bigint_int64(
        env: napi_env,
        value: i64,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_create_bigint_uint64(
        env: napi_env,
        value: u64,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_create_bigint_words(
        env: napi_env,
        sign_bit: c_int,
        word_count: usize,
        words: *const u64,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_get_value_bigint_int64(
        env: napi_env,
        value: napi_value,
        result: *mut i64,
        lossless: *mut bool,
    ) -> napi_status;
    pub(super) fn napi_get_value_bigint_uint64(
        env: napi_env,
        value: napi_value,
        result: *mut u64,
        lossless: *mut bool,
    ) -> napi_status;
    pub(super) fn napi_get_value_bigint_words(
        env: napi_env,
        value: napi_value,
        sign_bit: *mut c_int,
        word_count: *mut usize,
        words: *mut u64,
    ) -> napi_status;
    pub(super) fn napi_get_all_property_names(
        env: napi_env,
        object: napi_value,
        key_mode: napi_key_collection_mode,
        key_filter: napi_key_filter,
        key_conversion: napi_key_conversion,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_set_instance_data(
        env: napi_env,
        data: *mut c_void,
        finalize_cb: napi_finalize,
        finalize_hint: *mut c_void,
    ) -> napi_status;
    pub(super) fn napi_get_instance_data(env: napi_env, data: *mut *mut c_void) -> napi_status;
    pub(super) fn napi_detach_arraybuffer(env: napi_env, arraybuffer: napi_value) -> napi_status;
    pub(super) fn napi_is_detached_arraybuffer(
        env: napi_env,
        value: napi_value,
        result: *mut bool,
    ) -> napi_status;
}

// ──────────────────────────────────────────────────────────────────────────
// napi_async_work
// ──────────────────────────────────────────────────────────────────────────

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum AsyncWorkStatus {
    Pending = 0,
    Started = 1,
    Completed = 2,
    Cancelled = 3,
}

/// must be globally allocated
pub(crate) struct napi_async_work {
    pub task: WorkPoolTask,
    pub(crate) concurrent_task: ConcurrentTask,
    /// Held while the work is out on the pool (`schedule` until it is posted
    /// back): how the pool thread delivers completion / cancellation, and what
    /// makes the VM wait for it.
    pub(crate) ticket: Option<bun_jsc::Ticket>,
    /// JS thread only.
    pub global: GlobalRef,
    pub(crate) env: NapiEnvRef,
    pub(crate) execute: napi_async_execute_callback,
    pub(crate) complete: Option<napi_async_complete_callback>,
    pub(crate) data: *mut c_void,
    pub(crate) status: AtomicU32, // AsyncWorkStatus
    pub(crate) scheduled: bool,
    pub poll_ref: KeepAlive,
}

bun_threading::intrusive_work_task!(napi_async_work, task);

impl napi_async_work {
    pub(crate) fn new(
        env: &NapiEnv,
        execute: napi_async_execute_callback,
        complete: Option<napi_async_complete_callback>,
        data: *mut c_void,
    ) -> *mut napi_async_work {
        let global = env.to_js();

        bun_core::heap::into_raw(Box::new(napi_async_work {
            task: WorkPoolTask {
                node: bun_threading::thread_pool::Node::default(),
                callback: Self::run_from_thread_pool,
            },
            concurrent_task: ConcurrentTask::default(),
            global: GlobalRef::from(global),
            // SAFETY: env outlives the async work; clone bumps the C++ refcount.
            env: unsafe { NapiEnvRef::clone_from_raw(env.as_mut_ptr()) },
            execute,
            ticket: None,
            complete,
            data,
            status: AtomicU32::new(AsyncWorkStatus::Pending as u32),
            scheduled: false,
            poll_ref: KeepAlive::default(),
        }))
    }

    // Forwards `this` to `heap::take` without dereferencing it here;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn destroy(this: *mut napi_async_work) {
        // SAFETY: `this` was created by heap::alloc in `new`.
        // env.deinit() runs via Drop on NapiEnvRef.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub(crate) fn schedule(&mut self) {
        if self.scheduled {
            return;
        }
        self.scheduled = true;
        self.poll_ref.ref_(bun_io::js_vm_ctx());
        // The work object belongs to the addon and `execute` receives this
        // env, so the VM waits for it (Node likewise settles its threadpool
        // requests before an environment is freed).
        self.ticket = Some(self.global.bun_vm().ticket());
        WorkPool::schedule(&raw mut self.task);
    }

    pub(crate) unsafe fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: `task` is the `task` field of a live heap `napi_async_work`,
        // exclusively owned by the work pool for this callback's duration.
        unsafe { (*napi_async_work::from_task_ptr(task)).run() };
    }

    fn run(&mut self) {
        let self_ptr: *mut Self = self;
        // Moved out: the JS thread may free `self` the moment it is posted back.
        let ticket = self
            .ticket
            .take()
            .expect("scheduled napi async work holds a ticket");
        // A VM that is already stopping cancels work it has not started, as
        // Node's environment cleanup does (uv_cancel).
        let started = ticket.script_allowed()
            && match self.status.compare_exchange(
                AsyncWorkStatus::Pending as u32,
                AsyncWorkStatus::Started as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => true,
                Err(state) => state != AsyncWorkStatus::Cancelled as u32,
            };
        if started {
            (self.execute)(self.env.get(), self.data);
            self.status
                .store(AsyncWorkStatus::Completed as u32, Ordering::SeqCst);
        } else {
            let _ = self.cancel();
        }
        self.post_to_js_thread(self_ptr, &ticket);
    }

    /// Pool thread → JS thread: run `complete` there. `concurrent_task` is the
    /// live inline field of this heap work; the queue takes ownership of its
    /// `next` link. A VM tearing down runs `complete` from its queue release
    /// (status cancelled if `execute` never ran), as Node does at environment
    /// cleanup.
    fn post_to_js_thread(&mut self, self_ptr: *mut Self, ticket: &bun_jsc::Ticket) {
        let ct = core::ptr::NonNull::from(
            self.concurrent_task
                .from(self_ptr, AutoDeinit::ManualDeinit),
        );
        ticket.post(ct);
    }

    pub(crate) fn cancel(&mut self) -> bool {
        self.status
            .compare_exchange(
                AsyncWorkStatus::Pending as u32,
                AsyncWorkStatus::Cancelled as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    pub(crate) fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        // Note: the "this" value here may already be freed by the user in `complete`
        // Note: KeepAlive is not `Copy`, so move it out (the original slot may
        // be freed under us by `complete`).
        let mut poll_ref = core::mem::take(&mut self.poll_ref);
        // KeepAlive::unref needs an event-loop ctx so it cannot impl Drop
        // generically; this is a genuine one-off cleanup.
        scopeguard::defer! { poll_ref.unref(bun_io::js_vm_ctx()); }

        // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1201
        let Some(complete) = self.complete else {
            return Ok(());
        };

        let env = self.env.get();
        // SAFETY: env is held alive by NapiEnvRef for the duration of this call.
        let env_ref = unsafe { &*env };
        let _hs = NapiHandleScope::open_scoped(env_ref);

        let status: NapiStatus =
            if self.status.load(Ordering::SeqCst) == AsyncWorkStatus::Cancelled as u32 {
                NapiStatus::cancelled
            } else {
                NapiStatus::ok
            };

        complete(env, status as napi_status, self.data);

        // SAFETY: env is valid for the duration of this call.
        unsafe { &*env }.surface_exception(global)
    }
}

type napi_threadsafe_function = *mut ThreadSafeFunction;

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum napi_threadsafe_function_release_mode {
    release = 0,
    abort = 1,
}

const NAPI_TSFN_BLOCKING: c_uint = 1;
type napi_threadsafe_function_call_mode = c_uint;
pub(super) type napi_async_execute_callback = extern "C" fn(napi_env, *mut c_void);
pub(super) type napi_async_complete_callback = extern "C" fn(napi_env, napi_status, *mut c_void);
pub(super) type napi_threadsafe_function_call_js =
    extern "C" fn(napi_env, napi_value, *mut c_void, *mut c_void);

#[repr(C)]
struct napi_node_version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub release: *const c_char,
}

// SAFETY: napi_node_version is POD; the *const c_char points at a static literal.
unsafe impl Sync for napi_node_version {}

// Splits "MAJOR.MINOR.PATCH" into u32 components at compile time.
const fn parse_semver_component(s: &str, idx: usize) -> u32 {
    let bytes = s.as_bytes();
    let mut i = 0usize;
    let mut field = 0usize;
    // advance to the requested dot-separated field
    while field < idx {
        while i < bytes.len() && bytes[i] != b'.' {
            i += 1;
        }
        i += 1; // skip '.'
        field += 1;
    }
    let mut n: u32 = 0;
    while i < bytes.len() && bytes[i] != b'.' {
        n = n * 10 + (bytes[i] - b'0') as u32;
        i += 1;
    }
    n
}

static NAPI_NODE_VERSION_GLOBAL: napi_node_version = napi_node_version {
    major: parse_semver_component(bun_core::Environment::REPORTED_NODEJS_VERSION, 0),
    minor: parse_semver_component(bun_core::Environment::REPORTED_NODEJS_VERSION, 1),
    patch: parse_semver_component(bun_core::Environment::REPORTED_NODEJS_VERSION, 2),
    release: c"node".as_ptr(),
};

bun_opaque::opaque_ffi! { pub struct struct_napi_async_cleanup_hook_handle__; }
type napi_async_cleanup_hook_handle = *mut struct_napi_async_cleanup_hook_handle__;
type napi_async_cleanup_hook = Option<extern "C" fn(napi_async_cleanup_hook_handle, *mut c_void)>;

fn napi_span(ptr: *const u8, len: usize) -> &'static [u8] {
    // SAFETY: caller-supplied C string region; lifetime is the duration of the NAPI call.
    // `'static` is used because the slice never outlives the FFI call.
    if ptr.is_null() {
        return &[];
    }

    if len == NAPI_AUTO_LENGTH {
        // SAFETY: N-API contract — `ptr` is a NUL-terminated C string when `len == NAPI_AUTO_LENGTH`.
        return unsafe { bun_core::ffi::cstr(ptr.cast::<c_char>()) }.to_bytes();
    }

    // SAFETY: N-API contract — `[ptr, ptr+len)` is a valid readable region for the call.
    unsafe { bun_core::ffi::slice(ptr, len) }
}

#[unsafe(no_mangle)]
extern "C" fn napi_fatal_error(
    location_ptr: *const u8,
    location_len: usize,
    message_ptr: *const u8,
    message_len_: usize,
) -> ! {
    bun_output::scoped_log!(napi, "napi_fatal_error");
    napi_internal_suppress_crash_on_abort_if_desired();
    let mut message = napi_span(message_ptr, message_len_);
    if message.is_empty() {
        message = b"fatal error";
    }

    let location = napi_span(location_ptr, location_len);
    if !location.is_empty() {
        bun_core::Output::panic(format_args!(
            "NAPI FATAL ERROR: {} {}",
            bstr::BStr::new(location),
            bstr::BStr::new(message)
        ));
    }

    bun_core::Output::panic(format_args!("napi: {}", bstr::BStr::new(message)));
}

unsafe extern "C" {
    pub(super) fn napi_create_buffer(
        env: napi_env,
        length: usize,
        data: *mut *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_create_external_buffer(
        env: napi_env,
        length: usize,
        data: *mut c_void,
        finalize_cb: napi_finalize,
        finalize_hint: *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_create_buffer_copy(
        env: napi_env,
        length: usize,
        data: *const c_void,
        result_data: *mut *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
}

unsafe extern "C" {
    fn napi_is_buffer(env: napi_env, value: napi_value, result: *mut bool) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_buffer_info(
    env_: napi_env,
    value_: napi_value,
    data: *mut *mut u8,
    length: *mut usize,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_buffer_info");
    ungated!(env, env_);
    let value = value_.get();
    // Keep the pointer valid for the buffer's lifetime, as in Node.
    if !data.is_null() && !value.materialize_array_buffer_view_buffer() {
        return env.generic_failure();
    }
    let Some(array_buf) = value.as_array_buffer(env.to_js()) else {
        return NapiEnv::set_last_error(Some(env), NapiStatus::invalid_arg);
    };
    // node::Buffer::HasInstance is IsArrayBufferView: reject a bare ArrayBuffer.
    if array_buf.typed_array_type == jsc::JSType::ArrayBuffer {
        return NapiEnv::set_last_error(Some(env), NapiStatus::invalid_arg);
    }

    write_out(data, array_buf.ptr);
    write_out(length, array_buf.byte_len);

    env.ok()
}

unsafe extern "C" {
    fn node_api_create_syntax_error(
        env: napi_env,
        code: napi_value,
        msg: napi_value,
        result: *mut napi_value,
    ) -> napi_status;
    fn node_api_symbol_for(
        env: napi_env,
        utf8: *const c_char,
        length: usize,
        result: *mut napi_value,
    ) -> napi_status;
    fn node_api_throw_syntax_error(
        env: napi_env,
        code: *const c_char,
        msg: *const c_char,
    ) -> napi_status;
    fn node_api_create_external_string_latin1(
        env: napi_env,
        str_: *mut u8,
        length: usize,
        finalize_cb: napi_finalize,
        finalize_hint: *mut c_void,
        result: *mut JSValue,
        copied: *mut bool,
    ) -> napi_status;
    fn node_api_create_external_string_utf16(
        env: napi_env,
        str_: *mut u16,
        length: usize,
        finalize_cb: napi_finalize,
        finalize_hint: *mut c_void,
        result: *mut JSValue,
        copied: *mut bool,
    ) -> napi_status;
    fn node_api_set_prototype(env: napi_env, object: napi_value, value: napi_value) -> napi_status;
    fn node_api_create_object_with_properties(
        env: napi_env,
        prototype_or_null: napi_value,
        property_names: *const napi_value,
        property_values: *const napi_value,
        property_count: usize,
        result: *mut napi_value,
    ) -> napi_status;
    fn node_api_create_sharedarraybuffer(
        env: napi_env,
        byte_length: usize,
        data: *mut *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    fn node_api_create_external_sharedarraybuffer(
        env: napi_env,
        external_data: *mut c_void,
        byte_length: usize,
        finalize_cb: Option<unsafe extern "C" fn(*mut c_void, *mut c_void)>,
        finalize_hint: *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    fn node_api_is_sharedarraybuffer(
        env: napi_env,
        value: napi_value,
        result: *mut bool,
    ) -> napi_status;
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_async_work(
    env_: napi_env,
    _async_resource: napi_value,
    _async_resource_name: *const c_char,
    execute_: Option<napi_async_execute_callback>,
    complete: Option<napi_async_complete_callback>,
    data: *mut c_void,
    result_: *mut *mut napi_async_work,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_async_work");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1245
    let Some(execute) = execute_ else {
        return env.invalid_arg();
    };
    *result = napi_async_work::new(env, execute, complete, data);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_delete_async_work(env_: napi_env, work_: *mut napi_async_work) -> napi_status {
    bun_output::scoped_log!(napi, "napi_delete_async_work");
    let env = get_env!(env_);
    // SAFETY: `work_` is null or the `napi_async_work` we allocated in `napi_create_async_work`.
    let Some(work) = (unsafe { work_.as_mut() }) else {
        return env.invalid_arg();
    };
    debug_assert!(core::ptr::eq(env.to_js(), work.global.as_ptr()));
    napi_async_work::destroy(work_);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_queue_async_work(env_: napi_env, work_: *mut napi_async_work) -> napi_status {
    bun_output::scoped_log!(napi, "napi_queue_async_work");
    let env = get_env!(env_);
    // SAFETY: `work_` is null or the `napi_async_work` we allocated in `napi_create_async_work`.
    let Some(work) = (unsafe { work_.as_mut() }) else {
        return env.invalid_arg();
    };
    debug_assert!(core::ptr::eq(env.to_js(), work.global.as_ptr()));
    work.schedule();
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_cancel_async_work(env_: napi_env, work_: *mut napi_async_work) -> napi_status {
    bun_output::scoped_log!(napi, "napi_cancel_async_work");
    let env = get_env!(env_);
    // SAFETY: `work_` is null or the `napi_async_work` we allocated in `napi_create_async_work`.
    let Some(work) = (unsafe { work_.as_mut() }) else {
        return env.invalid_arg();
    };
    debug_assert!(core::ptr::eq(env.to_js(), work.global.as_ptr()));
    if work.cancel() {
        return env.ok();
    }

    env.generic_failure()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_node_version(
    env_: napi_env,
    version_: *mut *const napi_node_version,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_node_version");
    let env = get_env!(env_);
    let version = get_out!(env, version_);
    *version = &raw const NAPI_NODE_VERSION_GLOBAL;
    env.ok()
}

#[cfg(windows)]
type napi_event_loop = *mut bun_sys::windows::libuv::Loop;
#[cfg(not(windows))]
type napi_event_loop = *mut EventLoop;

#[unsafe(no_mangle)]
extern "C" fn napi_get_uv_event_loop(env_: napi_env, loop_: *mut napi_event_loop) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_uv_event_loop");
    let env = get_env!(env_);
    let loop_out = get_out!(env, loop_);
    #[cfg(windows)]
    {
        // A past alignment assertion here fired spuriously.
        // TODO(@190n) investigate
        *loop_out = VirtualMachine::get().uv_loop();
    }
    #[cfg(not(windows))]
    {
        // there is no uv event loop on posix, we use our event loop handle.
        // SAFETY: `VirtualMachine::event_loop` already yields `*mut EventLoop`;
        // no const→mut cast needed.
        // SAFETY: bun_vm() never null for a Bun-owned global.
        *loop_out = env.to_js().bun_vm().event_loop();
    }
    env.ok()
}

unsafe extern "C" {
    pub(super) fn napi_fatal_exception(env: napi_env, err: napi_value) -> napi_status;
    pub(super) fn napi_add_async_cleanup_hook(
        env: napi_env,
        function: napi_async_cleanup_hook,
        data: *mut c_void,
        handle_out: *mut napi_async_cleanup_hook_handle,
    ) -> napi_status;
    pub(super) fn napi_add_env_cleanup_hook(
        env: napi_env,
        function: Option<extern "C" fn(*mut c_void)>,
        data: *mut c_void,
    ) -> napi_status;
    pub(super) fn napi_create_typedarray(
        env: napi_env,
        type_: napi_typedarray_type,
        length: usize,
        arraybuffer: napi_value,
        byte_offset: usize,
        result: *mut napi_value,
    ) -> napi_status;
    pub(super) fn napi_remove_async_cleanup_hook(
        handle: napi_async_cleanup_hook_handle,
    ) -> napi_status;
    pub(super) fn napi_remove_env_cleanup_hook(
        env: napi_env,
        function: Option<extern "C" fn(*mut c_void)>,
        data: *mut c_void,
    ) -> napi_status;

    fn napi_internal_cleanup_env_cpp(env: napi_env);
    fn napi_internal_check_gc(env: napi_env);

    /// Returns false if the env has already torn down its registry.
    fn NapiEnv__registerThreadSafeFunction(env: *mut NapiEnv, tsfn: *mut c_void) -> bool;
    fn NapiEnv__unregisterThreadSafeFunction(env: *mut NapiEnv, tsfn: *mut c_void);
}

extern "C" fn napi_internal_register_cleanup_callback(data: *mut c_void) {
    // SAFETY: data is the napi_env we registered below.
    unsafe { napi_internal_cleanup_env_cpp(data as napi_env) };
}

#[unsafe(no_mangle)]
extern "C" fn napi_internal_register_cleanup_zig(env_: napi_env) {
    // SAFETY: caller guarantees env_ is non-null.
    let env = unsafe { &*env_ };
    env.to_js().bun_vm().as_mut().rare_data().push_cleanup_hook(
        env.to_js(),
        env_.cast::<c_void>(),
        napi_internal_register_cleanup_callback,
    );
}

#[unsafe(no_mangle)]
extern "C" fn napi_internal_suppress_crash_on_abort_if_desired() {
    if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT
        .get()
        .unwrap_or(false)
    {
        bun_crash_handler::suppress_reporting();
    }
}

unsafe extern "C" {
    fn napi_internal_remove_finalizer(
        env: napi_env,
        fun: napi_finalize,
        hint: *mut c_void,
        data: *mut c_void,
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Finalizer
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct Finalizer {
    pub env: NapiEnvRef,
    pub fun: NapiFinalizeFunction,
    pub data: *mut c_void,
    pub hint: *mut c_void,
}

impl Finalizer {
    /// Run the addon's finalizer. What it raised through napi (latched on the
    /// env) or left on the VM is the `Err`, for the caller's dispatcher to fold.
    pub(crate) fn run(&mut self) -> JsResult<()> {
        let env = self.env.get();
        // SAFETY: env is valid for the duration of this call.
        let env_ref = unsafe { &*env };
        let _hs = NapiHandleScope::open_scoped(env_ref);

        (self.fun)(env, self.data, self.hint);
        // SAFETY: env is valid; passes the C finalizer back for bookkeeping.
        unsafe { napi_internal_remove_finalizer(env, Some(self.fun), self.hint, self.data) };

        env_ref.surface_exception(env_ref.to_js())
    }

    // `deinit` is handled by Drop on NapiEnvRef.

    /// Takes ownership of `this`.
    pub(crate) fn enqueue(self) {
        NapiFinalizerTask::init(self).schedule();
    }
}

/// For Node-API modules not built with NAPI_EXPERIMENTAL, finalizers should be deferred to the
/// immediate task queue instead of run immediately. This lets finalizers perform allocations,
/// which they couldn't if they ran immediately while the garbage collector is still running.
#[unsafe(no_mangle)]
extern "C" fn napi_internal_enqueue_finalizer(
    env: napi_env,
    fun: napi_finalize,
    data: *mut c_void,
    hint: *mut c_void,
) {
    let Some(fun) = fun else { return };
    // SAFETY: env is either null or a valid pointer per the N-API contract;
    // null returns early.
    let Some(env_ref) = (unsafe { env.as_ref() }) else {
        return;
    };
    let this = Finalizer {
        fun,
        // SAFETY: env_ref points to a live C++-owned napi_env.
        env: unsafe { NapiEnvRef::clone_from_raw(env_ref.as_mut_ptr()) },
        data,
        hint,
    };
    this.enqueue();
}

// ──────────────────────────────────────────────────────────────────────────
// ThreadSafeFunction
// ──────────────────────────────────────────────────────────────────────────

/// Ownership: the JS thread owns this allocation until `finalize` or `env_teardown` sets `resources_released`; then the remaining `thread_count` references own it and the last one dropped frees it.
// TODO: generate a compile-time version of this instead of runtime checking
pub(crate) struct ThreadSafeFunction {
    /// thread-safe functions can be "referenced" and "unreferenced". A
    /// "referenced" thread-safe function will cause the event loop on the thread
    /// on which it is created to remain alive until the thread-safe function is
    /// destroyed. In contrast, an "unreferenced" thread-safe function will not
    /// prevent the event loop from exiting. The APIs napi_ref_threadsafe_function
    /// and napi_unref_threadsafe_function exist for this purpose.
    ///
    /// Neither does napi_unref_threadsafe_function mark the thread-safe
    /// functions as able to be destroyed nor does napi_ref_threadsafe_function
    /// prevent it from being destroyed.
    pub poll_ref: KeepAlive,

    // User implementation error can cause this number to go negative.
    pub(crate) thread_count: AtomicI64,
    // for std.condvar
    pub(crate) lock: Mutex,

    // Note: BackRef — `enqueue_task`/`drain_microtasks` need `&mut
    // EventLoop`; reborrowed at use sites (single JS thread). `None` once the
    // owning env is torn down: the loop lives inside a VirtualMachine that a
    // worker's shutdown frees, while addon threads outlive it.
    /// JS-thread uses; `None` once the env has been torn down.
    pub(crate) event_loop: Option<bun_ptr::BackRef<EventLoop, bun_ptr::Mut>>,
    /// How addon threads (`napi_call_threadsafe_function`) schedule a
    /// dispatch on the VM. Weak: addon threads hold this function for as long
    /// as they like (Node: calls after env cleanup get `napi_closing`), so it
    /// cannot be something the VM waits for.
    pub(crate) handle: bun_jsc::VmHandle,
    pub(crate) loop_kind: bun_jsc::LoopKind,
    pub(crate) tracker: Debugger::AsyncTaskTracker,

    /// Dropped on the JS thread by `env_teardown`; `None` afterwards.
    pub(crate) env: Option<NapiEnvRef>,
    pub(crate) finalizer_fun: napi_finalize,
    pub(crate) finalizer_data: *mut c_void,

    pub(crate) has_queued_finalizer: bool,
    pub(crate) queue: TsfnQueue,

    pub ctx: *mut c_void,

    pub callback: TsfnCallback,
    pub(crate) dispatch_state: AtomicU8, // DispatchState
    pub(crate) blocking_condvar: Condvar,
    pub(crate) closing: AtomicU8, // ClosingState
    /// Written under `lock` by `env_teardown` on the JS thread. Every path
    /// that would reach `event_loop` from another thread reads it under the
    /// same lock, so teardown cannot land between the check and the enqueue.
    pub(crate) env_dead: AtomicBool,
    /// Also written under `lock`, once `finalize` or `env_teardown` has released every JS-thread-owned resource; until then the thread that drops the last `thread_count` reference must not free this (Node's `kClosed`).
    pub(crate) resources_released: AtomicBool,
}

pub(crate) enum TsfnCallback {
    Js(StrongOptional),
    C {
        js: StrongOptional,
        napi_threadsafe_function_call_js: napi_threadsafe_function_call_js,
    },
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
enum ClosingState {
    NotClosing,
    Closing,
    Closed,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum DispatchState {
    Idle,
    Running,
    Pending,
}

pub(crate) struct TsfnQueue {
    pub data: LinearFifo<*mut c_void, DynamicBuffer<*mut c_void>>,
    /// This value will never change after initialization. Zero means the size is unlimited.
    pub max_queue_size: usize,
    pub count: AtomicU32,
}

impl TsfnQueue {
    pub(crate) fn init(max_queue_size: usize) -> TsfnQueue {
        TsfnQueue {
            data: LinearFifo::<*mut c_void, DynamicBuffer<*mut c_void>>::init(),
            max_queue_size,
            count: AtomicU32::new(0),
        }
    }

    pub(crate) fn is_blocked(&self) -> bool {
        self.max_queue_size > 0 && self.count.load(Ordering::SeqCst) as usize >= self.max_queue_size
    }
}

// Drop on TsfnQueue: LinearFifo drops itself.

/// Live `ThreadSafeFunction` allocations, process-wide.
static THREADSAFE_FUNCTION_LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Exposed via `bun:internal-for-testing` so tests can assert a threadsafe
/// function orphaned by a dead worker is freed rather than leaked.
#[bun_jsc::host_fn]
pub(crate) fn js_threadsafe_function_live_count(
    _global: &JSGlobalObject,
    _callframe: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::js_number(
        THREADSAFE_FUNCTION_LIVE_COUNT.load(Ordering::SeqCst) as f64,
    ))
}

impl Drop for ThreadSafeFunction {
    fn drop(&mut self) {
        let _ = THREADSAFE_FUNCTION_LIVE_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

impl ThreadSafeFunction {
    pub(crate) fn new(init: ThreadSafeFunction) -> *mut ThreadSafeFunction {
        let _ = THREADSAFE_FUNCTION_LIVE_COUNT.fetch_add(1, Ordering::SeqCst);
        bun_core::heap::into_raw(Box::new(init))
    }

    // This has two states:
    // 1. We need to run potentially multiple tasks.
    // 2. We need to finalize the ThreadSafeFunction.
    //
    // Dispatched via the event-loop task table (`dispatch.rs`), which hands us
    // a `*mut ThreadSafeFunction`; the signature is fixed by that registry.
    /// The threadsafe function's queue drain is a dispatcher: each queued call
    /// is a JS entry of its own, so what one leaves pending is folded per call
    /// (`dispatch_one`) and the drain goes on; the VM's termination ends it.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn on_dispatch(this: *mut ThreadSafeFunction) {
        // SAFETY: `this` is a live heap allocation owned by the event loop
        // dispatch; `env_dead` is atomic so a shared reborrow suffices.
        if unsafe { (*this).env_dead.load(Ordering::SeqCst) } {
            // `env_teardown` already released everything and owns the free
            // decision. The loop this task came from is being destroyed.
            return;
        }
        // SAFETY: as above.
        if unsafe { (*this).closing.load(Ordering::SeqCst) } == ClosingState::Closed as u8 {
            // SAFETY: `this` is the live heap allocation `maybe_queue_finalizer`
            // queued this task for.
            unsafe { ThreadSafeFunction::finalize(this) };
            return;
        }

        let mut is_first = true;

        // Run the tasks.
        loop {
            // SAFETY: as above.
            unsafe {
                (*this)
                    .dispatch_state
                    .store(DispatchState::Running as u8, Ordering::SeqCst)
            };
            // SAFETY: as above. `dispatch_one` runs JS that can re-enter other
            // TSFN entry points, so the exclusive borrow is scoped to this call.
            // A stopping VM ends the drain like an empty queue does.
            let more = unsafe { (*this).dispatch_one(is_first) }.unwrap_or(false);
            if more {
                is_first = false;
                // SAFETY: as above.
                unsafe {
                    (*this)
                        .dispatch_state
                        .store(DispatchState::Pending as u8, Ordering::SeqCst)
                };
            } else {
                // We're done running tasks, for now. Transition Running → Idle
                // via CAS instead of an unconditional store: between
                // dispatch_one() observing an empty queue (and dropping the
                // lock) and this point, another thread may have enqueued an
                // item and called schedule_dispatch(). That swap() saw
                // Running, so it intentionally did *not* schedule a new
                // concurrent task — it relies on this loop to pick the item
                // up. If we blindly stored Idle we'd overwrite that Pending
                // and the callback would be dropped (flaky lost-wakeup under
                // load). On CAS failure, loop and re-drain.
                // SAFETY: as above.
                if unsafe {
                    (*this).dispatch_state.compare_exchange(
                        DispatchState::Running as u8,
                        DispatchState::Idle as u8,
                        Ordering::SeqCst,
                        Ordering::SeqCst,
                    )
                }
                .is_ok()
                {
                    break;
                }
                // state was bumped to Pending by enqueue()/release(); re-dispatch.
            }
        }

        // Node sets a maximum number of runs per ThreadSafeFunction to 1,000.
        // We don't set a max. I would like to see an issue caused by not
        // setting a max before we do set a max. It is better for performance to
        // not add unnecessary event loop ticks.
    }

    pub(crate) fn is_closing(&self) -> bool {
        self.closing.load(Ordering::SeqCst) != ClosingState::NotClosing as u8
    }

    /// The creating VM's event loop, or `None` once its env has been torn down.
    ///
    /// JS-thread only. Its callers (`call`, `maybe_queue_finalizer`) run from
    /// the loop's own dispatch, so no other `&mut EventLoop` is live. Paths
    /// reachable from an addon thread must use the shared `&EventLoop` that
    /// `BackRef` derefs to, never this.
    #[inline]
    fn loop_mut(&mut self) -> Option<&mut EventLoop> {
        let back_ref = self.event_loop.as_mut()?;
        // SAFETY: BackRef invariant while `Some`; JS thread, outside tick().
        Some(unsafe { back_ref.get_mut() })
    }

    fn maybe_queue_finalizer(&mut self) {
        let prev = self
            .closing
            .swap(ClosingState::Closed as u8, Ordering::SeqCst);
        match prev {
            x if x == ClosingState::Closing as u8 || x == ClosingState::NotClosing as u8 => {
                // TODO: is this boolean necessary? Can we rely just on the closing value?
                if !self.has_queued_finalizer {
                    // Note: replace callback with a no-op variant to drop Strong now.
                    self.callback = TsfnCallback::Js(StrongOptional::empty());
                    self.poll_ref.disable();
                    let self_ptr: *mut Self = self;
                    let Some(loop_) = self.loop_mut() else {
                        // env torn down: `env_teardown` owns the finalize + free.
                        return;
                    };
                    loop_.enqueue_task(Task::init(self_ptr));
                    self.has_queued_finalizer = true;
                }
            }
            _ => {
                // already scheduled.
            }
        }
    }

    /// `Ok(true)`: a queued call ran (what it threw has been reported), keep
    /// draining. `Err`: the VM is stopping.
    ///
    /// This can run several times in one tick of the event loop, so the
    /// microtasks one call queued are drained before the next call
    /// (https://github.com/nodejs/node/pull/38506), but not before the first.
    pub(crate) fn dispatch_one(&mut self, is_first: bool) -> Result<bool, bun_jsc::Stopped> {
        let mut queue_finalizer_after_call = false;
        let task = 'brk: {
            // `MutexGuard` holds the lock by raw pointer, so it does not borrow
            // `*self` across the `&mut self` calls below.
            let _g = self.lock.lock_guard();
            if self.is_closing() {
                // Closing (napi_tsfn_abort, or the last call already ran):
                // nothing still queued runs any more, as in Node's DispatchOne.
                // An abort's leftovers go back to the addon, with no lock held
                // since that re-enters it. Then it finalizes whatever thread_count is: after an abort the other threads may never release (Node's CloseHandlesAndMaybeDelete).
                let leftovers = self.take_queue();
                drop(_g);
                self.hand_back(leftovers);
                let _g = self.lock.lock_guard();
                self.maybe_queue_finalizer();
                return Ok(false);
            }
            let was_blocked = self.queue.is_blocked();
            let Some(t) = self.queue.data.read_item() else {
                // When there are no tasks and the number of threads that have
                // references reaches zero, we prepare to finalize the
                // ThreadSafeFunction.
                if self.thread_count.load(Ordering::SeqCst) == 0 {
                    if self.queue.max_queue_size > 0 {
                        self.blocking_condvar.signal();
                    }
                    self.maybe_queue_finalizer();
                }
                return Ok(false);
            };

            if self.queue.count.fetch_sub(1, Ordering::SeqCst) == 1
                && self.thread_count.load(Ordering::SeqCst) == 0
            {
                self.closing
                    .store(ClosingState::Closing as u8, Ordering::SeqCst);
                if self.queue.max_queue_size > 0 {
                    self.blocking_condvar.signal();
                }
                queue_finalizer_after_call = true;
            } else if was_blocked && !self.queue.is_blocked() {
                self.blocking_condvar.signal();
            }

            break 'brk t;
        };

        let called = match self.loop_mut() {
            Some(loop_) if !is_first => loop_.drain_microtasks(),
            _ => Ok(()),
        }
        .and_then(|()| self.call(task));

        // The last queued call finalizes even when the VM is stopping.
        if queue_finalizer_after_call {
            self.maybe_queue_finalizer();
        }
        called?;

        // An item was dequeued: keep on_dispatch looping so remaining queued
        // items drain and the empty-queue thread_count==0 path can finalize.
        Ok(true)
    }

    /// One queued call from the drain, which is its landing frame: what it
    /// left pending is folded here. `Err`: the VM is stopping.
    fn call(&mut self, task: *mut c_void) -> Result<(), bun_jsc::Stopped> {
        let Some(env) = self.env.as_ref().map(NapiEnvRef::get) else {
            // env torn down; nothing to call into.
            return Ok(());
        };
        // SAFETY: env is valid while the TSF is live.
        let env = unsafe { &*env };
        match self.deliver(env, task) {
            Ok(()) => Ok(()),
            Err(err) => bun_jsc::task::report_error_or_terminate(env.to_js(), err),
        }
    }

    /// One queued call: a JS entry of its own, so what it leaves pending is
    /// the `Err`, for the caller's landing frame to fold. `env` is this
    /// function's own, which `self.env` still holds.
    fn deliver(&mut self, env: &NapiEnv, task: *mut c_void) -> JsResult<()> {
        let global_object = env.to_js();
        let _dispatch = self.tracker.dispatch(global_object);

        match &self.callback {
            TsfnCallback::Js(strong) => {
                let js: JSValue = strong.get().unwrap_or(JSValue::UNDEFINED);
                if js.is_empty_or_undefined_or_null() {
                    return Ok(());
                }

                js.call(global_object, JSValue::UNDEFINED, &[]).map(drop)
            }
            TsfnCallback::C {
                js: cb_js,
                napi_threadsafe_function_call_js,
            } => {
                let _hs = NapiHandleScope::open_scoped(env);
                // No func at creation => null js_callback (Node), not encoded undefined.
                let js = match cb_js.get() {
                    Some(v) => napi_value::create(env, v),
                    None => napi_value(0),
                };
                napi_threadsafe_function_call_js(env.as_mut_ptr(), js, self.ctx, task);
                env.surface_exception(global_object)
            }
        }
    }

    /// Caller holds `lock`. Empties the queue; the items are the caller's to
    /// give back to the addon once the lock is dropped.
    fn take_queue(&mut self) -> Vec<*mut c_void> {
        let mut items = Vec::new();
        while let Some(item) = self.queue.data.read_item() {
            items.push(item);
        }
        self.queue.count.store(0, Ordering::SeqCst);
        items
    }

    /// What a closing function does with items it will never run: each goes
    /// back to the addon's call_js_cb with a null env and js_callback, which is
    /// the signal napi_threadsafe_function_call_js documents for "free this,
    /// JS is no longer reachable" (Node's ThreadSafeFunction::EmptyQueue). A
    /// function created without a call_js_cb has nothing to give back.
    fn hand_back(&self, items: Vec<*mut c_void>) {
        let TsfnCallback::C {
            napi_threadsafe_function_call_js,
            ..
        } = &self.callback
        else {
            return;
        };
        let call_js = *napi_threadsafe_function_call_js;
        for item in items {
            call_js(ptr::null_mut(), napi_value(0), self.ctx, item);
        }
    }

    /// Runs on an addon thread. A call that reports `napi_closing` consumes the
    /// caller's thread reference, so like a release it can free the threadsafe
    /// function -- hence `*mut Self`, not `&mut self` (Node's `Push`).
    ///
    /// SAFETY: `this` is a live threadsafe function and the caller holds no
    /// reference into it.
    pub(crate) unsafe fn push(
        this: *mut ThreadSafeFunction,
        ctx: *mut c_void,
        block: bool,
    ) -> napi_status {
        // SAFETY: live allocation; the borrow is scoped to this call and ends
        // before the free below.
        let (status, orphaned) = unsafe { (*this).enqueue(ctx, block) };

        if orphaned {
            // SAFETY: the lock is dropped, this was the last thread reference,
            // and the JS thread already released what only it may release.
            unsafe { ThreadSafeFunction::free_orphaned(this) };
        }
        status
    }

    /// Returns `(status, caller_must_free)`; the free must happen after the
    /// lock guard here is dropped, which is why only `push` may call this.
    fn enqueue(&mut self, ctx: *mut c_void, block: bool) -> (napi_status, bool) {
        let _g = self.lock.lock_guard();
        if block {
            while self.queue.is_blocked() && !self.is_closing() {
                self.blocking_condvar.wait(&self.lock);
            }
        } else if self.queue.is_blocked() && !self.is_closing() {
            // A closing threadsafe function reports napi_closing even with a full
            // queue (node's `Push` skips the queue-full check unless it is open),
            // so the caller's reference is still consumed and it can finalize.
            // don't set the error on the env as this is run from another thread
            return (NapiStatus::queue_full as napi_status, false);
        }

        if self.is_closing() {
            // `env_teardown` sets `closing` under this same lock, so an env that
            // dies while we wait above lands here, never below.
            if self.thread_count.load(Ordering::SeqCst) <= 0 {
                return (NapiStatus::invalid_arg as napi_status, false);
            }
            // Consumes this thread's reference, like Node's `Push`, so a thread
            // that stops calling after napi_closing does not pin the loop. That
            // can be the last reference: the caller frees if we say so.
            let (_, caller_must_free) =
                self.release_locked(napi_threadsafe_function_release_mode::release);
            return (NapiStatus::closing as napi_status, caller_must_free);
        }

        let _ = self.queue.count.fetch_add(1, Ordering::SeqCst);
        let _ = self.queue.data.write_item(ctx); // OOM/capacity failures are fire-and-forget
        self.schedule_dispatch();
        (NapiStatus::ok as napi_status, false)
    }

    /// Caller must hold `lock`. Reached from addon threads (`enqueue`,
    /// `release_locked`); the VM is reached only through its handle.
    fn schedule_dispatch(&mut self) {
        let prev = self
            .dispatch_state
            .swap(DispatchState::Pending as u8, Ordering::SeqCst);
        match prev {
            x if x == DispatchState::Idle as u8 => {
                let self_ptr: *mut Self = self;
                if self.event_loop.is_none() {
                    // env torn down: the loop is gone, nothing to schedule onto.
                    return;
                }
                let ct = ConcurrentTask::create_from(self_ptr);
                if let bun_jsc::vm_handle::Posted::Refused(ct) =
                    self.handle.post(self.loop_kind, ct)
                {
                    // VM closed before the env cleanup hook ran here: no
                    // dispatch will happen; the queued calls are released by the
                    // teardown path. Free the task and fall back to Idle.
                    // SAFETY: refused ⇒ we own the task box.
                    unsafe { drop(bun_core::heap::take(ct.as_ptr())) };
                    self.dispatch_state
                        .store(DispatchState::Idle as u8, Ordering::SeqCst);
                }
            }
            x if x == DispatchState::Running as u8 => {
                // it will check if it has more work to do
            }
            _ => {
                // we've already scheduled it to run
            }
        }
    }

    /// Runs on the JS thread once the function has closed. Runs the addon's
    /// finalizer, releases what only this thread may release, and frees the
    /// allocation unless another thread still holds a reference; then the last
    /// release frees it (Node's Finalize + MaybeDelete).
    ///
    /// SAFETY: `this` is a live allocation from `new` that no other event-loop
    /// task will reach again.
    unsafe fn finalize(this: *mut ThreadSafeFunction) {
        // SAFETY: caller contract. The borrow ends before the addon's finalizer
        // runs; it may still use the handle (napi_get_threadsafe_function_context).
        let finalizer = unsafe {
            let self_ = &mut *this;
            if let Some(env) = self_.env.as_ref() {
                // SAFETY: env is live (we hold a ref). `this` is an opaque
                // registry key here, never dereferenced.
                NapiEnv__unregisterThreadSafeFunction(env.get(), this.cast());
            }
            self_
                .finalizer_fun
                .take()
                .zip(self_.env.as_ref())
                .map(|(fun, env)| Finalizer {
                    env: env.clone(),
                    fun,
                    data: self_.finalizer_data,
                    hint: self_.ctx,
                })
        };

        // Before anything is released, as in Node and `env_teardown`.
        if let Some(mut finalizer) = finalizer {
            crate::dispatch::fold(finalizer.run());
        }

        // SAFETY: caller contract; the finalizer has returned and the borrow
        // ends before the free below.
        let free = unsafe {
            let self_ = &mut *this;
            // The same critical section reads thread_count, so a thread that drops the last reference frees only if it sees this store.
            let _g = self_.lock.lock_guard();
            self_.event_loop = None;
            drop(self_.env.take());
            self_.resources_released.store(true, Ordering::SeqCst);
            self_.thread_count.load(Ordering::SeqCst) <= 0
        };

        if free {
            // SAFETY: no thread reference is left, the lock is dropped, and
            // nothing else can reach this allocation.
            unsafe { ThreadSafeFunction::free_orphaned(this) };
        }
    }

    /// Frees the allocation and nothing else: no finalizer, no registry entry,
    /// no event loop. Every JS-thread-owned resource must already be released
    /// (`finalize`, `env_teardown`) or be safe to drop here (a creation that failed).
    ///
    /// SAFETY: `this` is a live allocation from `new`, the caller holds no
    /// lock on it, and no other thread holds a reference.
    unsafe fn free_orphaned(this: *mut ThreadSafeFunction) {
        // SAFETY: per this function's contract, `this` is a live allocation from `new`.
        drop(unsafe { bun_core::heap::take(this) });
    }

    /// Runs on the JS thread from `NapiEnv::cleanup()` while JSC is still
    /// alive but the VirtualMachine (and the event loop this TSFN points at)
    /// is about to be destroyed. Mirrors Node's
    /// ThreadSafeFunction::Cleanup -> Finalize -> MaybeDelete.
    ///
    /// Returns true if the caller must free the allocation.
    fn env_teardown(&mut self) -> bool {
        // Phase 1: publish "the loop is going away". From here no other thread
        // schedules onto it, but none may free us either -- the JS resources
        // below are still live and only this thread may touch them.
        let (was_closing, queued) = {
            let _g = self.lock.lock_guard();
            self.env_dead.store(true, Ordering::SeqCst);
            let was_closing = self.is_closing();
            if !was_closing {
                self.closing
                    .store(ClosingState::Closing as u8, Ordering::SeqCst);
            }
            if self.queue.max_queue_size > 0 {
                // Wake producers blocked on the bounded queue; they observe
                // is_closing and release.
                self.blocking_condvar.broadcast();
            }
            (was_closing, self.take_queue())
        };

        // Phase 2: addon callbacks, so no lock is held.
        //
        // What is still queued goes back to the addon only when a worker's env
        // dies under it. On the main thread this is process exit, where Node
        // runs nothing of a threadsafe function; most call_js_cbs cannot take
        // the null env a hand-back would give them (they abort), and a
        // process.exit() from inside one of them would re-enter it. The queue
        // dies with the process. In a worker the items arrive as Node's last
        // turn of the loop (CleanupHandles) delivers them: the normal call,
        // live env and js_callback, with script refused if the worker was
        // stopped. A function already closing (napi_tsfn_abort) keeps the
        // abort contract. The finalizer runs either way.
        //
        // SAFETY: `env` is live; phase 3 below is what drops our reference.
        let env = self.env.as_ref().map(|env| unsafe { &*env.get() });
        if let Some(env) = env
            && env.to_js().bun_vm().worker_ref().is_some()
        {
            if was_closing {
                self.hand_back(queued);
            } else if matches!(self.callback, TsfnCallback::C { .. }) {
                for item in queued {
                    // The env's cleanup hook is each delivery's landing frame,
                    // as it is the finalizer's below.
                    crate::dispatch::fold(self.deliver(env, item));
                }
            }
        }
        let finalizer = self
            .finalizer_fun
            .take()
            .zip(self.env.as_ref())
            .map(|(fun, env)| Finalizer {
                env: env.clone(),
                fun,
                data: self.finalizer_data,
                hint: self.ctx,
            });
        if let Some(mut finalizer) = finalizer {
            // The env's cleanup hook is this finalizer's landing frame: what it
            // leaves is folded here so the next function's teardown starts clean.
            crate::dispatch::fold(finalizer.run());
        }

        // Phase 3: release what only the JS thread may release, then hand the
        // allocation over. `resources_released` is published in the critical section that reads thread_count (Node's ReleaseResources + MaybeDelete).
        let _g = self.lock.lock_guard();
        self.callback = TsfnCallback::Js(StrongOptional::empty());
        self.poll_ref.disable();
        self.event_loop = None;
        drop(self.env.take());
        self.resources_released.store(true, Ordering::SeqCst);
        // Cleanup hooks are the loop's last tick: a task still queued for this
        // TSFN will never run (and its `release_unrun` does not dereference it).
        // With no thread_count reference left, nobody else can reach this, so
        // free it here.
        self.thread_count.load(Ordering::SeqCst) <= 0
    }

    /// `napi_ref_threadsafe_function` — JS thread only (as in Node).
    pub(crate) fn ref_(&mut self) {
        self.poll_ref.ref_(bun_io::js_vm_ctx());
    }

    /// `napi_unref_threadsafe_function` — JS thread only (as in Node).
    pub(crate) fn unref(&mut self) {
        self.poll_ref.unref(bun_io::js_vm_ctx());
    }

    pub(crate) fn acquire(&mut self) -> napi_status {
        let _g = self.lock.lock_guard();
        if self.is_closing() {
            return NapiStatus::closing as napi_status;
        }
        let _ = self.thread_count.fetch_add(1, Ordering::SeqCst);
        NapiStatus::ok as napi_status
    }

    /// Frees the threadsafe function when this drops the last thread reference
    /// of an orphaned one, so it dispatches off `*mut Self`: freeing through a
    /// pointer derived from a live `&mut self` is UB.
    ///
    /// SAFETY: `this` is a live threadsafe function and the caller holds no
    /// reference into it.
    pub(crate) unsafe fn release(
        this: *mut ThreadSafeFunction,
        mode: napi_threadsafe_function_release_mode,
    ) -> napi_status {
        let (status, orphaned) = {
            // SAFETY: live allocation. `MutexGuard` holds the lock by raw
            // pointer, so it does not keep `*this` borrowed across the call
            // below; both borrows are scoped and end before the free.
            let _g = unsafe { (*this).lock.lock_guard() };
            // SAFETY: as above.
            unsafe { (*this).release_locked(mode) }
        };

        if orphaned {
            // SAFETY: the lock is dropped, this was the last thread reference,
            // and the JS thread already released what only it may release.
            unsafe { ThreadSafeFunction::free_orphaned(this) };
        }
        status
    }

    /// Caller must hold `lock`. Returns `(status, caller_must_free)`; the free
    /// must happen after the lock is dropped.
    fn release_locked(
        &mut self,
        mode: napi_threadsafe_function_release_mode,
    ) -> (napi_status, bool) {
        if self.thread_count.load(Ordering::SeqCst) <= 0 {
            return (NapiStatus::invalid_arg as napi_status, false);
        }

        let prev_remaining = self.thread_count.fetch_sub(1, Ordering::SeqCst);

        if self.env_dead.load(Ordering::SeqCst)
            || self.closing.load(Ordering::SeqCst) == ClosingState::Closed as u8
        {
            // The JS thread owns the finalization (`finalize` queued or done, or `env_teardown` ran): never schedule onto the loop again. The last reference frees us once `resources_released` is set; before that the JS thread frees us itself.
            let orphaned = prev_remaining == 1 && self.resources_released.load(Ordering::SeqCst);
            return (NapiStatus::ok as napi_status, orphaned);
        }

        // Already closing: the abort's dispatch is pending or running and finalizes whatever thread_count is by then.
        if (mode == napi_threadsafe_function_release_mode::abort || prev_remaining == 1)
            && !self.is_closing()
        {
            if mode == napi_threadsafe_function_release_mode::abort {
                self.closing
                    .store(ClosingState::Closing as u8, Ordering::SeqCst);
                if self.queue.max_queue_size > 0 {
                    // Wake all producers blocked in enqueue()'s bounded queue wait so they observe is_closing and release.
                    self.blocking_condvar.broadcast();
                }
            }
            self.schedule_dispatch();
        }

        (NapiStatus::ok as napi_status, false)
    }
}

/// Called from `NapiEnv::cleanup()` (JS thread) for every threadsafe function
/// still registered with the env that is being torn down.
#[unsafe(no_mangle)]
extern "C" fn napi_internal_threadsafe_function_env_teardown(tsfn: *mut c_void) {
    let this = tsfn.cast::<ThreadSafeFunction>();
    // SAFETY: the registry only holds live TSFN pointers — `finalize` and
    // `env_teardown` both remove the entry before freeing. Exclusive borrow
    // scoped to this call.
    if unsafe { (*this).env_teardown() } {
        // SAFETY: no other thread holds a reference (thread_count == 0) and no
        // event-loop task will run again.
        unsafe { ThreadSafeFunction::free_orphaned(this) };
    }
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_threadsafe_function(
    env_: napi_env,
    func_: napi_value,
    _async_resource: napi_value,
    _async_resource_name: napi_value,
    max_queue_size: usize,
    initial_thread_count: usize,
    thread_finalize_data: *mut c_void,
    thread_finalize_cb: napi_finalize,
    context: *mut c_void,
    call_js_cb: Option<napi_threadsafe_function_call_js>,
    result_: *mut napi_threadsafe_function,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_threadsafe_function");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    let func = func_.get();

    if call_js_cb.is_none()
        && (func.is_empty_or_undefined_or_null()
            || (!func.is_callable() && !func.is_async_context_frame()))
    {
        return NapiEnv::set_last_error(Some(env), NapiStatus::function_expected);
    }

    let vm = env.to_js().bun_vm().as_mut();
    let callback = if let Some(c) = call_js_cb {
        TsfnCallback::C {
            napi_threadsafe_function_call_js: c,
            js: if func.is_empty() {
                StrongOptional::empty()
            } else {
                StrongOptional::create(func.with_async_context_if_needed(env.to_js()), vm.global())
            },
        }
    } else {
        TsfnCallback::Js(if func.is_empty() {
            StrongOptional::empty()
        } else {
            StrongOptional::create(func.with_async_context_if_needed(env.to_js()), vm.global())
        })
    };

    let function = ThreadSafeFunction::new(ThreadSafeFunction {
        // SAFETY: the loop is live now; `NapiEnv::cleanup()` clears this field
        // (via `env_teardown`) before the VirtualMachine holding it is freed.
        event_loop: Some(unsafe { bun_ptr::BackRef::from_raw_mut(vm.event_loop()) }),
        handle: vm.handle(),
        loop_kind: vm.current_loop_kind(),
        // SAFETY: env is a live C++-owned napi_env.
        env: Some(unsafe { NapiEnvRef::clone_from_raw(env.as_mut_ptr()) }),
        callback,
        ctx: context,
        queue: TsfnQueue::init(max_queue_size),
        thread_count: AtomicI64::new(i64::try_from(initial_thread_count).expect("int cast")),
        poll_ref: KeepAlive::init(),
        tracker: Debugger::AsyncTaskTracker::init(vm),
        finalizer_fun: thread_finalize_cb,
        finalizer_data: thread_finalize_data,
        has_queued_finalizer: false,
        lock: Mutex::new(),
        dispatch_state: AtomicU8::new(DispatchState::Idle as u8),
        blocking_condvar: Condvar::default(),
        closing: AtomicU8::new(ClosingState::NotClosing as u8),
        env_dead: AtomicBool::new(false),
        resources_released: AtomicBool::new(false),
    });

    // Register with the env so that VM/worker teardown neutralizes this TSFN
    // before the event loop it points at is freed. `false` means the env has
    // already torn its threadsafe functions down -- we are running from a
    // finalizer, after the loop's last tick.
    // SAFETY: env is live; `function` is a fresh heap allocation.
    if !unsafe { NapiEnv__registerThreadSafeFunction(env.as_mut_ptr(), function.cast()) } {
        // Born dead. Free only what we allocated and never run the addon's
        // finalizer: the handle was never published, so the addon still owns
        // what it passed in (node's `Init` failure path just deletes the
        // ThreadSafeFunction, whose destructor only releases its own resources).
        // SAFETY: the allocation we just made; nothing else can reach it.
        unsafe { ThreadSafeFunction::free_orphaned(function) };
        return env.generic_failure();
    }

    // nodejs by default keeps the event loop alive until the thread-safe function is unref'd
    // SAFETY: function is non-null (just allocated) and not yet handed out.
    unsafe { (*function).ref_() };
    // SAFETY: as above.
    unsafe { (*function).tracker.did_schedule(vm.global()) };

    *result = function;
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_threadsafe_function_context(
    func: napi_threadsafe_function,
    result: *mut *mut c_void,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_threadsafe_function_context");
    // SAFETY: func and result are non-null per N-API contract.
    unsafe { *result = (*func).ctx };
    NapiStatus::ok as napi_status
}

#[unsafe(no_mangle)]
extern "C" fn napi_call_threadsafe_function(
    func: napi_threadsafe_function,
    data: *mut c_void,
    is_blocking: napi_threadsafe_function_call_mode,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_call_threadsafe_function");
    // SAFETY: func is non-null per N-API contract, and the caller may not use it
    // afterwards if this reports napi_closing — that consumes the caller's
    // thread reference, which can free it.
    unsafe { ThreadSafeFunction::push(func, data, is_blocking == NAPI_TSFN_BLOCKING) }
}

#[unsafe(no_mangle)]
extern "C" fn napi_acquire_threadsafe_function(func: napi_threadsafe_function) -> napi_status {
    bun_output::scoped_log!(napi, "napi_acquire_threadsafe_function");
    // SAFETY: func is non-null per N-API contract.
    unsafe { &mut *func }.acquire()
}

#[unsafe(no_mangle)]
extern "C" fn napi_release_threadsafe_function(
    func: napi_threadsafe_function,
    mode: napi_threadsafe_function_release_mode,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_release_threadsafe_function");
    // SAFETY: func is non-null per N-API contract, and the caller may not use
    // it afterwards — this call can free it.
    unsafe { ThreadSafeFunction::release(func, mode) }
}

#[unsafe(no_mangle)]
extern "C" fn napi_unref_threadsafe_function(
    env_: napi_env,
    func: napi_threadsafe_function,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_unref_threadsafe_function");
    if func.is_null() {
        return NapiStatus::invalid_arg as napi_status;
    }
    #[cfg(debug_assertions)]
    {
        // SAFETY: `func` was null-checked above; JS thread, shared read.
        let loop_ = unsafe { (*func).event_loop.as_ref() };
        // SAFETY: `env_` is either null or a valid napi_env per N-API contract.
        let env = unsafe { env_.as_ref() };
        if let (Some(loop_), Some(env)) = (loop_, env) {
            debug_assert!(core::ptr::eq(loop_.global.unwrap().as_ptr(), env.to_js()));
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = env_;
    // SAFETY: `func` was null-checked above; exclusive borrow scoped to this call.
    unsafe { (*func).unref() };
    NapiStatus::ok as napi_status
}

#[unsafe(no_mangle)]
extern "C" fn napi_ref_threadsafe_function(
    env_: napi_env,
    func: napi_threadsafe_function,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_ref_threadsafe_function");
    if func.is_null() {
        return NapiStatus::invalid_arg as napi_status;
    }
    #[cfg(debug_assertions)]
    {
        // SAFETY: `func` was null-checked above; JS thread, shared read.
        let loop_ = unsafe { (*func).event_loop.as_ref() };
        // SAFETY: `env_` is either null or a valid napi_env per N-API contract.
        let env = unsafe { env_.as_ref() };
        if let (Some(loop_), Some(env)) = (loop_, env) {
            debug_assert!(core::ptr::eq(loop_.global.unwrap().as_ptr(), env.to_js()));
        }
    }
    #[cfg(not(debug_assertions))]
    let _ = env_;
    // SAFETY: `func` was null-checked above; exclusive borrow scoped to this call.
    unsafe { (*func).ref_() };
    NapiStatus::ok as napi_status
}

const NAPI_AUTO_LENGTH: usize = usize::MAX;

// ──────────────────────────────────────────────────────────────────────────
// V8 API symbol references (DCE suppression)
// ──────────────────────────────────────────────────────────────────────────

/// v8:: C++ symbols defined in v8.cpp
///
/// Do not call these at runtime, as they do not contain type and callconv info. They are simply
/// used for DCE suppression and asserting that the symbols exist at link-time.
///
// TODO: write a script to generate this struct. ideally it wouldn't even need to be committed to source.
#[cfg(not(windows))]
mod v8_api {
    use core::ffi::c_void;
    unsafe extern "C" {
        pub(super) fn _ZN2v87Isolate10GetCurrentEv() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate13TryGetCurrentEv() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate17GetCurrentContextEv() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate28GetEnteredOrMicrotaskContextEv() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate36GetContinuationPreservedEmbedderDataEv() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate7IsInUseEv() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate21LowMemoryNotificationEv() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate36AutomaticallyRestoreInitialHeapLimitEd() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate30NumberOfTrackedHeapObjectTypesEv() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate31GetHeapObjectStatisticsAtLastGCEPNS_20HeapObjectStatisticsEm()
        -> *mut c_void;
        pub(super) fn _ZN2v87Isolate21AddGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_S2_()
        -> *mut c_void;
        pub(super) fn _ZN2v87Isolate24RemoveGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_()
        -> *mut c_void;
        pub(super) fn _ZN2v87Isolate21AddGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_S2_()
        -> *mut c_void;
        pub(super) fn _ZN2v87Isolate24RemoveGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_()
        -> *mut c_void;
        pub(super) fn _ZN2v87Isolate24AddNearHeapLimitCallbackEPFmPvmmES1_() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate27RemoveNearHeapLimitCallbackEPFmPvmmEm() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate16RequestInterruptEPFvPS0_PvES2_() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate14ThrowExceptionENS_5LocalINS_5ValueEEE() -> *mut c_void;
        pub(super) fn _ZN2v87Isolate10ThrowErrorENS_5LocalINS_6StringEEE() -> *mut c_void;
        pub(super) fn _ZN2v89Exception5ErrorENS_5LocalINS_6StringEEENS1_INS_5ValueEEE()
        -> *mut c_void;
        pub(super) fn _ZN2v89Exception9TypeErrorENS_5LocalINS_6StringEEENS1_INS_5ValueEEE()
        -> *mut c_void;
        pub(super) fn _ZN2v87Isolate15GetHeapProfilerEv() -> *mut c_void;
        pub(super) fn _ZN2v812HeapProfiler24StopSamplingHeapProfilerEv() -> *mut c_void;
        pub(super) fn _ZN2v812HeapProfiler20GetAllocationProfileEv() -> *mut c_void;
        pub(super) fn _ZN4node25AddEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_() -> *mut c_void;
        pub(super) fn _ZN4node28RemoveEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_() -> *mut c_void;
        pub(super) fn _ZN4node19GetCurrentEventLoopEPN2v87IsolateE() -> *mut c_void;
        pub(super) fn _ZN4node29AsyncHooksGetExecutionAsyncIdEN2v85LocalINS0_7ContextEEE()
        -> *mut c_void;
        pub(super) fn _ZN4node13EmitAsyncInitEPN2v87IsolateENS0_5LocalINS0_6ObjectEEENS3_INS0_6StringEEEd()
        -> *mut c_void;
        pub(super) fn _ZN4node16EmitAsyncDestroyEPN2v87IsolateENS_13async_contextE() -> *mut c_void;
        pub(super) fn _ZN4node12MakeCallbackEPN2v87IsolateENS0_5LocalINS0_6ObjectEEENS3_INS0_8FunctionEEEiPNS3_INS0_5ValueEEENS_13async_contextE()
        -> *mut c_void;
        pub(super) fn _ZN2v84base9TimeTicks3NowEv() -> *mut c_void;
        pub(super) fn _ZN2v86Number3NewEPNS_7IsolateEd() -> *mut c_void;
        pub(super) fn _ZNK2v86Number5ValueEv() -> *mut c_void;
        pub(super) fn _ZN2v86Number12NewFromInt32EPNS_7IsolateEi() -> *mut c_void;
        pub(super) fn _ZN2v86Number13NewFromUint32EPNS_7IsolateEj() -> *mut c_void;
        pub(super) fn _ZN2v86String11NewFromUtf8EPNS_7IsolateEPKcNS_13NewStringTypeEi()
        -> *mut c_void;
        pub(super) fn _ZNK2v86String9WriteUtf8EPNS_7IsolateEPciPii() -> *mut c_void;
        pub(super) fn _ZN2v812api_internal12ToLocalEmptyEv() -> *mut c_void;
        pub(super) fn _ZNK2v86String6LengthEv() -> *mut c_void;
        pub(super) fn _ZN2v88External3NewEPNS_7IsolateEPv() -> *mut c_void;
        pub(super) fn _ZNK2v88External5ValueEv() -> *mut c_void;
        pub(super) fn _ZN2v88External3NewEPNS_7IsolateEPvt() -> *mut c_void;
        pub(super) fn _ZNK2v88External5ValueEt() -> *mut c_void;
        pub(super) fn _ZN2v86Object3NewEPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZN2v86Object3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_() -> *mut c_void;
        pub(super) fn _ZN2v86Object3SetENS_5LocalINS_7ContextEEEjNS1_INS_5ValueEEE() -> *mut c_void;
        pub(super) fn _ZN2v86Object16SetInternalFieldEiNS_5LocalINS_4DataEEE() -> *mut c_void;
        pub(super) fn _ZN2v86Object20SlowGetInternalFieldEi() -> *mut c_void;
        pub(super) fn _ZN2v86Object32SetAlignedPointerInInternalFieldEiPvt() -> *mut c_void;
        pub(super) fn _ZN2v86Object38SlowGetAlignedPointerFromInternalFieldEit() -> *mut c_void;
        pub(super) fn _ZN2v86Object3GetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE() -> *mut c_void;
        pub(super) fn _ZN2v86Object3GetENS_5LocalINS_7ContextEEEj() -> *mut c_void;
        pub(super) fn _ZN2v811HandleScope12CreateHandleEPNS_8internal7IsolateEm() -> *mut c_void;
        pub(super) fn _ZN2v811HandleScope12CreateHandleEPNS_7IsolateEm() -> *mut c_void;
        pub(super) fn _ZN2v811HandleScope10InitializeEPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZNK2v85Value16QuickIsUndefinedEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value11QuickIsNullEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value22QuickIsNullOrUndefinedEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value13QuickIsStringEv() -> *mut c_void;
        pub(super) fn _ZN2v811HandleScope6ExtendEPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZN2v811HandleScope16DeleteExtensionsEPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZN2v811HandleScopeC1EPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZN2v811HandleScopeD1Ev() -> *mut c_void;
        pub(super) fn _ZN2v811HandleScopeD2Ev() -> *mut c_void;
        pub(super) fn _ZN2v816FunctionTemplate11GetFunctionENS_5LocalINS_7ContextEEE() -> *mut c_void;
        pub(super) fn _ZN2v816FunctionTemplate12SetClassNameENS_5LocalINS_6StringEEE() -> *mut c_void;
        pub(super) fn _ZN2v816FunctionTemplate3NewEPNS_7IsolateEPFvRKNS_20FunctionCallbackInfoINS_5ValueEEEENS_5LocalIS4_EENSA_INS_9SignatureEEEiNS_19ConstructorBehaviorENS_14SideEffectTypeEPKNS_9CFunctionEttt()
        -> *mut c_void;
        pub(super) fn _ZN2v814ObjectTemplate11NewInstanceENS_5LocalINS_7ContextEEE() -> *mut c_void;
        pub(super) fn _ZN2v814ObjectTemplate21SetInternalFieldCountEi() -> *mut c_void;
        pub(super) fn _ZNK2v814ObjectTemplate18InternalFieldCountEv() -> *mut c_void;
        pub(super) fn _ZN2v814ObjectTemplate3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE()
        -> *mut c_void;
        pub(super) fn _ZN2v816FunctionTemplate16InstanceTemplateEv() -> *mut c_void;
        pub(super) fn _ZN2v816FunctionTemplate17PrototypeTemplateEv() -> *mut c_void;
        pub(super) fn _ZN2v88Template3SetENS_5LocalINS_4NameEEENS1_INS_4DataEEENS_17PropertyAttributeE()
        -> *mut c_void;
        pub(super) fn _ZN2v88Template21SetNativeDataPropertyENS_5LocalINS_4NameEEEPFvS3_RKNS_20PropertyCallbackInfoINS_5ValueEEEEPFvS3_NS1_IS5_EERKNS4_IvEEESB_NS_17PropertyAttributeENS_14SideEffectTypeESI_()
        -> *mut c_void;
        pub(super) fn _ZN2v89Signature3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE()
        -> *mut c_void;
        pub(super) fn _ZN2v824EscapableHandleScopeBase10EscapeSlotEPm() -> *mut c_void;
        pub(super) fn _ZN2v824EscapableHandleScopeBaseC2EPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZN2v88internal35IsolateFromNeverReadOnlySpaceObjectEm() -> *mut c_void;
        pub(super) fn _ZN2v85Array3NewEPNS_7IsolateEPNS_5LocalINS_5ValueEEEm() -> *mut c_void;
        pub(super) fn _ZNK2v85Array6LengthEv() -> *mut c_void;
        pub(super) fn _ZN2v85Array3NewEPNS_7IsolateEi() -> *mut c_void;
        pub(super) fn _ZN2v85Array7IterateENS_5LocalINS_7ContextEEEPFNS0_14CallbackResultEjNS1_INS_5ValueEEEPvES7_()
        -> *mut c_void;
        pub(super) fn _ZN2v85Array9CheckCastEPNS_5ValueE() -> *mut c_void;
        pub(super) fn _ZN2v88Function7SetNameENS_5LocalINS_6StringEEE() -> *mut c_void;
        pub(super) fn _ZN2v88Function4CallENS_5LocalINS_7ContextEEENS1_INS_5ValueEEEiPS5_()
        -> *mut c_void;
        pub(super) fn _ZNK2v88Function11NewInstanceENS_5LocalINS_7ContextEEEiPNS1_INS_5ValueEEE()
        -> *mut c_void;
        pub(super) fn _ZNK2v85Value9IsBooleanEv() -> *mut c_void;
        pub(super) fn _ZNK2v87Boolean5ValueEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value10FullIsTrueEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value11FullIsFalseEv() -> *mut c_void;
        pub(super) fn _ZN2v820EscapableHandleScopeC1EPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZN2v820EscapableHandleScopeC2EPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZN2v820EscapableHandleScopeD1Ev() -> *mut c_void;
        pub(super) fn _ZN2v820EscapableHandleScopeD2Ev() -> *mut c_void;
        pub(super) fn _ZNK2v85Value8IsObjectEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value8IsNumberEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value8IsUint32Ev() -> *mut c_void;
        pub(super) fn _ZNK2v85Value11Uint32ValueENS_5LocalINS_7ContextEEE() -> *mut c_void;
        pub(super) fn _ZNK2v85Value11IsUndefinedEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value6IsNullEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value17IsNullOrUndefinedEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value6IsTrueEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value7IsFalseEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value8IsStringEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value12StrictEqualsENS_5LocalIS0_EE() -> *mut c_void;
        pub(super) fn _ZN2v87Boolean3NewEPNS_7IsolateEb() -> *mut c_void;
        pub(super) fn _ZN2v811ArrayBuffer3NewEPNS_7IsolateEmNS_30BackingStoreInitializationModeE()
        -> *mut c_void;
        pub(super) fn _ZN2v811ArrayBuffer15GetBackingStoreEv() -> *mut c_void;
        pub(super) fn _ZNK2v812BackingStore4DataEv() -> *mut c_void;
        pub(super) fn _ZN2v815ArrayBufferView6BufferEv() -> *mut c_void;
        pub(super) fn _ZN2v815ArrayBufferView10ByteLengthEv() -> *mut c_void;
        pub(super) fn _ZN2v815ArrayBufferView10ByteOffsetEv() -> *mut c_void;
        pub(super) fn _ZN2v810Uint8Array3NewENS_5LocalINS_11ArrayBufferEEEmm() -> *mut c_void;
        pub(super) fn _ZN2v811Uint32Array3NewENS_5LocalINS_11ArrayBufferEEEmm() -> *mut c_void;
        pub(super) fn _ZN2v86Object16GetInternalFieldEi() -> *mut c_void;
        pub(super) fn _ZN2v87Context10GetIsolateEv() -> *mut c_void;
        pub(super) fn _ZN2v86String14NewFromOneByteEPNS_7IsolateEPKhNS_13NewStringTypeEi()
        -> *mut c_void;
        pub(super) fn _ZNK2v86String10Utf8LengthEPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZNK2v86String10IsExternalEv() -> *mut c_void;
        pub(super) fn _ZNK2v86String17IsExternalOneByteEv() -> *mut c_void;
        pub(super) fn _ZNK2v86String17IsExternalTwoByteEv() -> *mut c_void;
        pub(super) fn _ZNK2v86String9IsOneByteEv() -> *mut c_void;
        pub(super) fn _ZNK2v86String19ContainsOnlyOneByteEv() -> *mut c_void;
        pub(super) fn _ZNK2v86String7WriteV2EPNS_7IsolateEjjPti() -> *mut c_void;
        pub(super) fn _ZNK2v86String14WriteOneByteV2EPNS_7IsolateEjjPhi() -> *mut c_void;
        pub(super) fn _ZNK2v86String11WriteUtf8V2EPNS_7IsolateEPcmiPm() -> *mut c_void;
        pub(super) fn _ZNK2v86String12Utf8LengthV2EPNS_7IsolateE() -> *mut c_void;
        pub(super) fn _ZN2v812api_internal18GlobalizeReferenceEPNS_8internal7IsolateEm()
        -> *mut c_void;
        pub(super) fn _ZN2v812api_internal13DisposeGlobalEPm() -> *mut c_void;
        pub(super) fn _ZN2v812api_internal8MakeWeakEPmPvPFvRKNS_16WeakCallbackInfoIvEEENS_16WeakCallbackTypeE()
        -> *mut c_void;
        pub(super) fn _ZN2v812api_internal9ClearWeakEPm() -> *mut c_void;
        pub(super) fn _ZN2v812api_internal19MoveGlobalReferenceEPPmS2_() -> *mut c_void;
        pub(super) fn _ZN2v812api_internal23GetFunctionTemplateDataEPNS_7IsolateENS_5LocalINS_4DataEEE()
        -> *mut c_void;
        pub(super) fn _ZNK2v88Function7GetNameEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value10IsFunctionEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value5IsMapEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value7IsArrayEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value7IsInt32Ev() -> *mut c_void;
        pub(super) fn _ZNK2v85Value8IsBigIntEv() -> *mut c_void;
        pub(super) fn _ZN2v812api_internal17FromJustIsNothingEv() -> *mut c_void;
        pub(super) fn _ZN2v87Integer3NewEPNS_7IsolateEi() -> *mut c_void;
        pub(super) fn _ZN2v87Integer15NewFromUnsignedEPNS_7IsolateEj() -> *mut c_void;
        pub(super) fn _ZNK2v87Integer5ValueEv() -> *mut c_void;
        pub(super) fn _ZN2v86String18NewFromUtf8LiteralEPNS_7IsolateEPKcNS_13NewStringTypeEi()
        -> *mut c_void;
        pub(super) fn _ZNK2v85Value12IsUint8ArrayEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value8ToStringENS_5LocalINS_7ContextEEE() -> *mut c_void;
        pub(super) fn _ZNK2v85Value9ToIntegerENS_5LocalINS_7ContextEEE() -> *mut c_void;
        pub(super) fn _ZN2v87Context6GlobalEv() -> *mut c_void;
        pub(super) fn _ZNK2v86Object18InternalFieldCountEv() -> *mut c_void;
        pub(super) fn _ZN2v86Object15GetIdentityHashEv() -> *mut c_void;
        pub(super) fn _ZN2v86Object17DefineOwnPropertyENS_5LocalINS_7ContextEEENS1_INS_4NameEEENS1_INS_5ValueEEENS_17PropertyAttributeE()
        -> *mut c_void;
        pub(super) fn _ZN2v820ToExternalPointerTagEt() -> *mut c_void;
        pub(super) fn _ZN2v88internal9Internals17GetCurrentIsolateEv() -> *mut c_void;
        pub(super) fn _ZN2v820HeapObjectStatisticsC1Ev() -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler3NewEPNS_7IsolateENS_22CpuProfilingNamingModeENS_23CpuProfilingLoggingModeE()
        -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler7DisposeEv() -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler19SetSamplingIntervalEi() -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler5StartENS_5LocalINS_6StringEEENS_16CpuProfilingModeEbj()
        -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler4StopEj() -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler14StartProfilingENS_5LocalINS_6StringEEENS_16CpuProfilingModeEbj()
        -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler14StartProfilingENS_5LocalINS_6StringEEEb() -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler13StopProfilingENS_5LocalINS_6StringEEE() -> *mut c_void;
        pub(super) fn _ZN2v810CpuProfile6DeleteEv() -> *mut c_void;
        pub(super) fn _ZNK2v810CpuProfile8GetTitleEv() -> *mut c_void;
        pub(super) fn _ZNK2v810CpuProfile10GetEndTimeEv() -> *mut c_void;
        pub(super) fn _ZNK2v810CpuProfile12GetStartTimeEv() -> *mut c_void;
        pub(super) fn _ZNK2v810CpuProfile14GetTopDownRootEv() -> *mut c_void;
        pub(super) fn _ZNK2v810CpuProfile15GetSamplesCountEv() -> *mut c_void;
        pub(super) fn _ZNK2v810CpuProfile18GetSampleTimestampEi() -> *mut c_void;
        pub(super) fn _ZNK2v810CpuProfile9GetSampleEi() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode11GetHitCountEv() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode11GetScriptIdEv() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode12GetLineTicksEPNS0_8LineTickEj() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode13GetLineNumberEv() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode15GetColumnNumberEv() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode15GetFunctionNameEv() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode15GetHitLineCountEv() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode16GetChildrenCountEv() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode18GetFunctionNameStrEv() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode21GetScriptResourceNameEv() -> *mut c_void;
        pub(super) fn _ZNK2v814CpuProfileNode8GetChildEi() -> *mut c_void;
        pub(super) fn _ZN2v83Map3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_() -> *mut c_void;
        pub(super) fn _ZN2v83Map6DeleteENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE() -> *mut c_void;
        // NOTE: return type omitted to match the `uv_functions_to_export` declarations
        // below (avoids `clashing_extern_declarations`); only the symbol address is used.
        pub(super) fn uv_os_getpid();
        pub(super) fn uv_os_getppid();
    }
}

#[cfg(windows)]
mod v8_api {
    use core::ffi::c_void;
    // MSVC name mangling is different than it is on unix.
    // To make this easier to deal with, this script generates the list of functions.
    //
    // dumpbin .\build\CMakeFiles\bun-debug.dir\src\bun.js\bindings\v8\*.cpp.obj /symbols | where-object { $_.Contains(' node::') -or $_.Contains(' v8::') } | foreach-object { (($_ -split "\|")[1] -split " ")[1] } | ForEach-Object { "extern fn @`"${_}`"() *anyopaque;" }
    //
    // MSVC-mangled symbol names contain `?@$` and are not valid Rust identifiers, so each entry
    // is exposed under a Rust-safe alias via `#[link_name = "..."]`. The list is purely for DCE
    // suppression / link-time existence checks and has no runtime callers — only the symbol
    // *address* is taken (see `fix_dead_code_elimination`).
    #[rustfmt::skip]
    unsafe extern "C" {
        #[link_name = "?TryGetCurrent@Isolate@v8@@SAPEAV12@XZ"]
        pub(super) fn v8_Isolate_TryGetCurrent() -> *mut c_void;
        #[link_name = "?GetCurrent@Isolate@v8@@SAPEAV12@XZ"]
        pub(super) fn v8_Isolate_GetCurrent() -> *mut c_void;
        #[link_name = "?GetCurrentContext@Isolate@v8@@QEAA?AV?$Local@VContext@v8@@@2@XZ"]
        pub(super) fn v8_Isolate_GetCurrentContext() -> *mut c_void;
        #[link_name = "?GetEnteredOrMicrotaskContext@Isolate@v8@@QEAA?AV?$Local@VContext@v8@@@2@XZ"]
        pub(super) fn v8_Isolate_GetEnteredOrMicrotaskContext() -> *mut c_void;
        #[link_name = "?GetContinuationPreservedEmbedderData@Isolate@v8@@QEAA?AV?$Local@VValue@v8@@@2@XZ"]
        pub(super) fn v8_Isolate_GetContinuationPreservedEmbedderData() -> *mut c_void;
        #[link_name = "?IsInUse@Isolate@v8@@QEAA_NXZ"]
        pub(super) fn v8_Isolate_IsInUse() -> *mut c_void;
        #[link_name = "?LowMemoryNotification@Isolate@v8@@QEAAXXZ"]
        pub(super) fn v8_Isolate_LowMemoryNotification() -> *mut c_void;
        #[link_name = "?AutomaticallyRestoreInitialHeapLimit@Isolate@v8@@QEAAXN@Z"]
        pub(super) fn v8_Isolate_AutomaticallyRestoreInitialHeapLimit() -> *mut c_void;
        #[link_name = "?NumberOfTrackedHeapObjectTypes@Isolate@v8@@QEAA_KXZ"]
        pub(super) fn v8_Isolate_NumberOfTrackedHeapObjectTypes() -> *mut c_void;
        #[link_name = "?GetHeapObjectStatisticsAtLastGC@Isolate@v8@@QEAA_NPEAVHeapObjectStatistics@2@_K@Z"]
        pub(super) fn v8_Isolate_GetHeapObjectStatisticsAtLastGC() -> *mut c_void;
        #[link_name = "?AddGCPrologueCallback@Isolate@v8@@QEAAXP6AXPEAV12@W4GCType@2@W4GCCallbackFlags@2@PEAX@Z31@Z"]
        pub(super) fn v8_Isolate_AddGCPrologueCallback() -> *mut c_void;
        #[link_name = "?RemoveGCPrologueCallback@Isolate@v8@@QEAAXP6AXPEAV12@W4GCType@2@W4GCCallbackFlags@2@PEAX@Z3@Z"]
        pub(super) fn v8_Isolate_RemoveGCPrologueCallback() -> *mut c_void;
        #[link_name = "?AddGCEpilogueCallback@Isolate@v8@@QEAAXP6AXPEAV12@W4GCType@2@W4GCCallbackFlags@2@PEAX@Z31@Z"]
        pub(super) fn v8_Isolate_AddGCEpilogueCallback() -> *mut c_void;
        #[link_name = "?RemoveGCEpilogueCallback@Isolate@v8@@QEAAXP6AXPEAV12@W4GCType@2@W4GCCallbackFlags@2@PEAX@Z3@Z"]
        pub(super) fn v8_Isolate_RemoveGCEpilogueCallback() -> *mut c_void;
        #[link_name = "?AddNearHeapLimitCallback@Isolate@v8@@QEAAXP6A_KPEAX_K1@Z0@Z"]
        pub(super) fn v8_Isolate_AddNearHeapLimitCallback() -> *mut c_void;
        #[link_name = "?RemoveNearHeapLimitCallback@Isolate@v8@@QEAAXP6A_KPEAX_K1@Z1@Z"]
        pub(super) fn v8_Isolate_RemoveNearHeapLimitCallback() -> *mut c_void;
        #[link_name = "?RequestInterrupt@Isolate@v8@@QEAAXP6AXPEAV12@PEAX@Z1@Z"]
        pub(super) fn v8_Isolate_RequestInterrupt() -> *mut c_void;
        #[link_name = "?ThrowException@Isolate@v8@@QEAA?AV?$Local@VValue@v8@@@2@V32@@Z"]
        pub(super) fn v8_Isolate_ThrowException() -> *mut c_void;
        #[link_name = "?ThrowError@Isolate@v8@@QEAA?AV?$Local@VValue@v8@@@2@V?$Local@VString@v8@@@2@@Z"]
        pub(super) fn v8_Isolate_ThrowError() -> *mut c_void;
        #[link_name = "?Error@Exception@v8@@SA?AV?$Local@VValue@v8@@@2@V?$Local@VString@v8@@@2@V32@@Z"]
        pub(super) fn v8_Exception_Error() -> *mut c_void;
        #[link_name = "?TypeError@Exception@v8@@SA?AV?$Local@VValue@v8@@@2@V?$Local@VString@v8@@@2@V32@@Z"]
        pub(super) fn v8_Exception_TypeError() -> *mut c_void;
        #[link_name = "?GetHeapProfiler@Isolate@v8@@QEAAPEAVHeapProfiler@2@XZ"]
        pub(super) fn v8_Isolate_GetHeapProfiler() -> *mut c_void;
        #[link_name = "?StartSamplingHeapProfiler@HeapProfiler@v8@@QEAA_N_KHW4SamplingFlags@12@@Z"]
        pub(super) fn v8_HeapProfiler_StartSamplingHeapProfiler() -> *mut c_void;
        #[link_name = "?StopSamplingHeapProfiler@HeapProfiler@v8@@QEAAXXZ"]
        pub(super) fn v8_HeapProfiler_StopSamplingHeapProfiler() -> *mut c_void;
        #[link_name = "?GetAllocationProfile@HeapProfiler@v8@@QEAAPEAVAllocationProfile@2@XZ"]
        pub(super) fn v8_HeapProfiler_GetAllocationProfile() -> *mut c_void;
        #[link_name = "?AddEnvironmentCleanupHook@node@@YAXPEAVIsolate@v8@@P6AXPEAX@Z1@Z"]
        pub(super) fn node_AddEnvironmentCleanupHook() -> *mut c_void;
        #[link_name = "?RemoveEnvironmentCleanupHook@node@@YAXPEAVIsolate@v8@@P6AXPEAX@Z1@Z"]
        pub(super) fn node_RemoveEnvironmentCleanupHook() -> *mut c_void;
        #[link_name = "?GetCurrentEventLoop@node@@YAPEAUuv_loop_s@@PEAVIsolate@v8@@@Z"]
        pub(super) fn node_GetCurrentEventLoop() -> *mut c_void;
        #[link_name = "?AsyncHooksGetExecutionAsyncId@node@@YANV?$Local@VContext@v8@@@v8@@@Z"]
        pub(super) fn node_AsyncHooksGetExecutionAsyncId() -> *mut c_void;
        #[link_name = "?EmitAsyncInit@node@@YA?AUasync_context@1@PEAVIsolate@v8@@V?$Local@VObject@v8@@@4@V?$Local@VString@v8@@@4@N@Z"]
        pub(super) fn node_EmitAsyncInit() -> *mut c_void;
        #[link_name = "?EmitAsyncDestroy@node@@YAXPEAVIsolate@v8@@Uasync_context@1@@Z"]
        pub(super) fn node_EmitAsyncDestroy() -> *mut c_void;
        #[link_name = "?MakeCallback@node@@YA?AV?$MaybeLocal@VValue@v8@@@v8@@PEAVIsolate@3@V?$Local@VObject@v8@@@3@V?$Local@VFunction@v8@@@3@HPEAV?$Local@VValue@v8@@@3@Uasync_context@1@@Z"]
        pub(super) fn node_MakeCallback() -> *mut c_void;
        #[link_name = "?Now@TimeTicks@base@v8@@SA?AV123@XZ"]
        pub(super) fn v8_base_TimeTicks_Now() -> *mut c_void;
        #[link_name = "?New@Number@v8@@SA?AV?$Local@VNumber@v8@@@2@PEAVIsolate@2@N@Z"]
        pub(super) fn v8_Number_New() -> *mut c_void;
        #[link_name = "?Value@Number@v8@@QEBANXZ"]
        pub(super) fn v8_Number_Value() -> *mut c_void;
        #[link_name = "?NewFromInt32@Number@v8@@CA?AV?$Local@VNumber@v8@@@2@PEAVIsolate@2@H@Z"]
        pub(super) fn v8_Number_NewFromInt32() -> *mut c_void;
        #[link_name = "?NewFromUint32@Number@v8@@CA?AV?$Local@VNumber@v8@@@2@PEAVIsolate@2@I@Z"]
        pub(super) fn v8_Number_NewFromUint32() -> *mut c_void;
        #[link_name = "?NewFromUtf8@String@v8@@SA?AV?$MaybeLocal@VString@v8@@@2@PEAVIsolate@2@PEBDW4NewStringType@2@H@Z"]
        pub(super) fn v8_String_NewFromUtf8() -> *mut c_void;
        #[link_name = "?WriteUtf8@String@v8@@QEBAHPEAVIsolate@2@PEADHPEAHH@Z"]
        pub(super) fn v8_String_WriteUtf8() -> *mut c_void;
        #[link_name = "?ToLocalEmpty@api_internal@v8@@YAXXZ"]
        pub(super) fn v8_api_internal_ToLocalEmpty() -> *mut c_void;
        #[link_name = "?Length@String@v8@@QEBAHXZ"]
        pub(super) fn v8_String_Length() -> *mut c_void;
        #[link_name = "?New@External@v8@@SA?AV?$Local@VExternal@v8@@@2@PEAVIsolate@2@PEAX@Z"]
        pub(super) fn v8_External_New() -> *mut c_void;
        #[link_name = "?Value@External@v8@@QEBAPEAXXZ"]
        pub(super) fn v8_External_Value() -> *mut c_void;
        #[link_name = "?New@External@v8@@SA?AV?$Local@VExternal@v8@@@2@PEAVIsolate@2@PEAXG@Z"]
        pub(super) fn v8_External_New_tagged() -> *mut c_void;
        #[link_name = "?Value@External@v8@@QEBAPEAXG@Z"]
        pub(super) fn v8_External_Value_tagged() -> *mut c_void;
        #[link_name = "?New@Object@v8@@SA?AV?$Local@VObject@v8@@@2@PEAVIsolate@2@@Z"]
        pub(super) fn v8_Object_New() -> *mut c_void;
        #[link_name = "?Set@Object@v8@@QEAA?AV?$Maybe@_N@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@1@Z"]
        pub(super) fn v8_Object_Set_key() -> *mut c_void;
        #[link_name = "?Set@Object@v8@@QEAA?AV?$Maybe@_N@2@V?$Local@VContext@v8@@@2@IV?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Object_Set_index() -> *mut c_void;
        #[link_name = "?SetInternalField@Object@v8@@QEAAXHV?$Local@VData@v8@@@2@@Z"]
        pub(super) fn v8_Object_SetInternalField() -> *mut c_void;
        #[link_name = "?SlowGetInternalField@Object@v8@@AEAA?AV?$Local@VData@v8@@@2@H@Z"]
        pub(super) fn v8_Object_SlowGetInternalField() -> *mut c_void;
        #[link_name = "?SetAlignedPointerInInternalField@Object@v8@@QEAAXHPEAXG@Z"]
        pub(super) fn v8_Object_SetAlignedPointerInInternalField() -> *mut c_void;
        #[link_name = "?SlowGetAlignedPointerFromInternalField@Object@v8@@AEAAPEAXHG@Z"]
        pub(super) fn v8_Object_SlowGetAlignedPointerFromInternalField() -> *mut c_void;
        #[link_name = "?Get@Object@v8@@QEAA?AV?$MaybeLocal@VValue@v8@@@2@V?$Local@VContext@v8@@@2@I@Z"]
        pub(super) fn v8_Object_Get_index() -> *mut c_void;
        #[link_name = "?Get@Object@v8@@QEAA?AV?$MaybeLocal@VValue@v8@@@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Object_Get_key() -> *mut c_void;
        #[link_name = "?CreateHandle@HandleScope@v8@@KAPEA_KPEAVIsolate@internal@2@_K@Z"]
        pub(super) fn v8_HandleScope_CreateHandle() -> *mut c_void;
        #[link_name = "?Extend@HandleScope@v8@@CAPEA_KPEAVIsolate@2@@Z"]
        pub(super) fn v8_HandleScope_Extend() -> *mut c_void;
        #[link_name = "?DeleteExtensions@HandleScope@v8@@AEAAXPEAVIsolate@2@@Z"]
        pub(super) fn v8_HandleScope_DeleteExtensions() -> *mut c_void;
        #[link_name = "??0HandleScope@v8@@QEAA@PEAVIsolate@1@@Z"]
        pub(super) fn v8_HandleScope_ctor() -> *mut c_void;
        #[link_name = "??1HandleScope@v8@@QEAA@XZ"]
        pub(super) fn v8_HandleScope_dtor() -> *mut c_void;
        #[link_name = "?GetFunction@FunctionTemplate@v8@@QEAA?AV?$MaybeLocal@VFunction@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_FunctionTemplate_GetFunction() -> *mut c_void;
        #[link_name = "?SetClassName@FunctionTemplate@v8@@QEAAXV?$Local@VString@v8@@@2@@Z"]
        pub(super) fn v8_FunctionTemplate_SetClassName() -> *mut c_void;
        #[link_name = "?New@FunctionTemplate@v8@@SA?AV?$Local@VFunctionTemplate@v8@@@2@PEAVIsolate@2@P6AXAEBV?$FunctionCallbackInfo@VValue@v8@@@2@@ZV?$Local@VValue@v8@@@2@V?$Local@VSignature@v8@@@2@HW4ConstructorBehavior@2@W4SideEffectType@2@PEBVCFunction@2@GGG@Z"]
        pub(super) fn v8_FunctionTemplate_New() -> *mut c_void;
        #[link_name = "?NewInstance@ObjectTemplate@v8@@QEAA?AV?$MaybeLocal@VObject@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_ObjectTemplate_NewInstance() -> *mut c_void;
        #[link_name = "?SetInternalFieldCount@ObjectTemplate@v8@@QEAAXH@Z"]
        pub(super) fn v8_ObjectTemplate_SetInternalFieldCount() -> *mut c_void;
        #[link_name = "?InternalFieldCount@ObjectTemplate@v8@@QEBAHXZ"]
        pub(super) fn v8_ObjectTemplate_InternalFieldCount() -> *mut c_void;
        #[link_name = "?New@ObjectTemplate@v8@@SA?AV?$Local@VObjectTemplate@v8@@@2@PEAVIsolate@2@V?$Local@VFunctionTemplate@v8@@@2@@Z"]
        pub(super) fn v8_ObjectTemplate_New() -> *mut c_void;
        #[link_name = "?InstanceTemplate@FunctionTemplate@v8@@QEAA?AV?$Local@VObjectTemplate@v8@@@2@XZ"]
        pub(super) fn v8_FunctionTemplate_InstanceTemplate() -> *mut c_void;
        #[link_name = "?PrototypeTemplate@FunctionTemplate@v8@@QEAA?AV?$Local@VObjectTemplate@v8@@@2@XZ"]
        pub(super) fn v8_FunctionTemplate_PrototypeTemplate() -> *mut c_void;
        #[link_name = "?Set@Template@v8@@QEAAXV?$Local@VName@v8@@@2@V?$Local@VData@v8@@@2@W4PropertyAttribute@2@@Z"]
        pub(super) fn v8_Template_Set() -> *mut c_void;
        #[link_name = "?SetNativeDataProperty@Template@v8@@QEAAXV?$Local@VName@v8@@@2@P6AX0AEBV?$PropertyCallbackInfo@VValue@v8@@@2@@ZP6AX0V?$Local@VValue@v8@@@2@AEBV?$PropertyCallbackInfo@X@2@@Z3W4PropertyAttribute@2@W4SideEffectType@2@7@Z"]
        pub(super) fn v8_Template_SetNativeDataProperty() -> *mut c_void;
        #[link_name = "?New@Signature@v8@@SA?AV?$Local@VSignature@v8@@@2@PEAVIsolate@2@V?$Local@VFunctionTemplate@v8@@@2@@Z"]
        pub(super) fn v8_Signature_New() -> *mut c_void;
        #[link_name = "?EscapeSlot@EscapableHandleScopeBase@v8@@IEAAPEA_KPEA_K@Z"]
        pub(super) fn v8_EscapableHandleScopeBase_EscapeSlot() -> *mut c_void;
        #[link_name = "??0EscapableHandleScopeBase@v8@@QEAA@PEAVIsolate@1@@Z"]
        pub(super) fn v8_EscapableHandleScopeBase_ctor() -> *mut c_void;
        #[link_name = "?IsolateFromNeverReadOnlySpaceObject@internal@v8@@YAPEAVIsolate@12@_K@Z"]
        pub(super) fn v8_internal_IsolateFromNeverReadOnlySpaceObject() -> *mut c_void;
        #[link_name = "?New@Array@v8@@SA?AV?$Local@VArray@v8@@@2@PEAVIsolate@2@PEAV?$Local@VValue@v8@@@2@_K@Z"]
        pub(super) fn v8_Array_New_elements() -> *mut c_void;
        #[link_name = "?Length@Array@v8@@QEBAIXZ"]
        pub(super) fn v8_Array_Length() -> *mut c_void;
        #[link_name = "?New@Array@v8@@SA?AV?$Local@VArray@v8@@@2@PEAVIsolate@2@H@Z"]
        pub(super) fn v8_Array_New_len() -> *mut c_void;
        #[link_name = "?New@Array@v8@@SA?AV?$MaybeLocal@VArray@v8@@@2@V?$Local@VContext@v8@@@2@_KV?$function@$$A6A?AV?$MaybeLocal@VValue@v8@@@v8@@XZ@std@@@Z"]
        pub(super) fn v8_Array_New_fn() -> *mut c_void;
        #[link_name = "?Iterate@Array@v8@@QEAA?AV?$Maybe@X@2@V?$Local@VContext@v8@@@2@P6A?AW4CallbackResult@12@IV?$Local@VValue@v8@@@2@PEAX@Z2@Z"]
        pub(super) fn v8_Array_Iterate() -> *mut c_void;
        #[link_name = "?CheckCast@Array@v8@@CAXPEAVValue@2@@Z"]
        pub(super) fn v8_Array_CheckCast() -> *mut c_void;
        #[link_name = "?SetName@Function@v8@@QEAAXV?$Local@VString@v8@@@2@@Z"]
        pub(super) fn v8_Function_SetName() -> *mut c_void;
        #[link_name = "?Call@Function@v8@@QEAA?AV?$MaybeLocal@VValue@v8@@@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@HQEAV52@@Z"]
        pub(super) fn v8_Function_Call() -> *mut c_void;
        #[link_name = "?NewInstance@Function@v8@@QEBA?AV?$MaybeLocal@VObject@v8@@@2@V?$Local@VContext@v8@@@2@HQEAV?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Function_NewInstance() -> *mut c_void;
        #[link_name = "?NewInstance@Function@v8@@QEBA?AV?$MaybeLocal@VObject@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_Function_NewInstance_noargs() -> *mut c_void;
        #[link_name = "?GetAlignedPointerFromInternalField@Object@v8@@QEAAPEAXHG@Z"]
        pub(super) fn v8_Object_GetAlignedPointerFromInternalField() -> *mut c_void;
        #[link_name = "?IsBoolean@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsBoolean() -> *mut c_void;
        #[link_name = "?Value@Boolean@v8@@QEBA_NXZ"]
        pub(super) fn v8_Boolean_Value() -> *mut c_void;
        #[link_name = "?FullIsTrue@Value@v8@@AEBA_NXZ"]
        pub(super) fn v8_Value_FullIsTrue() -> *mut c_void;
        #[link_name = "?FullIsFalse@Value@v8@@AEBA_NXZ"]
        pub(super) fn v8_Value_FullIsFalse() -> *mut c_void;
        #[link_name = "??1EscapableHandleScope@v8@@QEAA@XZ"]
        pub(super) fn v8_EscapableHandleScope_dtor() -> *mut c_void;
        #[link_name = "??0EscapableHandleScope@v8@@QEAA@PEAVIsolate@1@@Z"]
        pub(super) fn v8_EscapableHandleScope_ctor() -> *mut c_void;
        #[link_name = "?IsObject@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsObject() -> *mut c_void;
        #[link_name = "?IsNumber@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsNumber() -> *mut c_void;
        #[link_name = "?IsUint32@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsUint32() -> *mut c_void;
        #[link_name = "?Uint32Value@Value@v8@@QEBA?AV?$Maybe@I@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_Value_Uint32Value() -> *mut c_void;
        #[link_name = "?IsUndefined@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsUndefined() -> *mut c_void;
        #[link_name = "?IsNull@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsNull() -> *mut c_void;
        #[link_name = "?IsNullOrUndefined@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsNullOrUndefined() -> *mut c_void;
        #[link_name = "?IsTrue@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsTrue() -> *mut c_void;
        #[link_name = "?IsFalse@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsFalse() -> *mut c_void;
        #[link_name = "?IsString@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsString() -> *mut c_void;
        #[link_name = "?StrictEquals@Value@v8@@QEBA_NV?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Value_StrictEquals() -> *mut c_void;
        #[link_name = "?New@Boolean@v8@@SA?AV?$Local@VBoolean@v8@@@2@PEAVIsolate@2@_N@Z"]
        pub(super) fn v8_Boolean_New() -> *mut c_void;
        #[link_name = "?GetInternalField@Object@v8@@QEAA?AV?$Local@VData@v8@@@2@H@Z"]
        pub(super) fn v8_Object_GetInternalField() -> *mut c_void;
        #[link_name = "?GetIsolate@Context@v8@@QEAAPEAVIsolate@2@XZ"]
        pub(super) fn v8_Context_GetIsolate() -> *mut c_void;
        #[link_name = "?NewFromOneByte@String@v8@@SA?AV?$MaybeLocal@VString@v8@@@2@PEAVIsolate@2@PEBEW4NewStringType@2@H@Z"]
        pub(super) fn v8_String_NewFromOneByte() -> *mut c_void;
        #[link_name = "?IsExternal@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_IsExternal() -> *mut c_void;
        #[link_name = "?IsExternalOneByte@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_IsExternalOneByte() -> *mut c_void;
        #[link_name = "?IsExternalTwoByte@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_IsExternalTwoByte() -> *mut c_void;
        #[link_name = "?IsOneByte@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_IsOneByte() -> *mut c_void;
        #[link_name = "?Utf8Length@String@v8@@QEBAHPEAVIsolate@2@@Z"]
        pub(super) fn v8_String_Utf8Length() -> *mut c_void;
        #[link_name = "?ContainsOnlyOneByte@String@v8@@QEBA_NXZ"]
        pub(super) fn v8_String_ContainsOnlyOneByte() -> *mut c_void;
        #[link_name = "?WriteV2@String@v8@@QEBAXPEAVIsolate@2@IIPEAGH@Z"]
        pub(super) fn v8_String_WriteV2() -> *mut c_void;
        #[link_name = "?WriteOneByteV2@String@v8@@QEBAXPEAVIsolate@2@IIPEAEH@Z"]
        pub(super) fn v8_String_WriteOneByteV2() -> *mut c_void;
        #[link_name = "?WriteUtf8V2@String@v8@@QEBA_KPEAVIsolate@2@PEAD_KHPEA_K@Z"]
        pub(super) fn v8_String_WriteUtf8V2() -> *mut c_void;
        #[link_name = "?Utf8LengthV2@String@v8@@QEBA_KPEAVIsolate@2@@Z"]
        pub(super) fn v8_String_Utf8LengthV2() -> *mut c_void;
        #[link_name = "?GlobalizeReference@api_internal@v8@@YAPEA_KPEAVIsolate@internal@2@_K@Z"]
        pub(super) fn v8_api_internal_GlobalizeReference() -> *mut c_void;
        #[link_name = "?DisposeGlobal@api_internal@v8@@YAXPEA_K@Z"]
        pub(super) fn v8_api_internal_DisposeGlobal() -> *mut c_void;
        #[link_name = "?MakeWeak@api_internal@v8@@YAXPEA_KPEAXP6AXAEBV?$WeakCallbackInfo@X@2@@ZW4WeakCallbackType@2@@Z"]
        pub(super) fn v8_api_internal_MakeWeak() -> *mut c_void;
        #[link_name = "?ClearWeak@api_internal@v8@@YAPEAXPEA_K@Z"]
        pub(super) fn v8_api_internal_ClearWeak() -> *mut c_void;
        #[link_name = "?MoveGlobalReference@api_internal@v8@@YAXPEAPEA_K0@Z"]
        pub(super) fn v8_api_internal_MoveGlobalReference() -> *mut c_void;
        #[link_name = "?GetFunctionTemplateData@api_internal@v8@@YA?AV?$Local@VValue@v8@@@2@PEAVIsolate@2@V?$Local@VData@v8@@@2@@Z"]
        pub(super) fn v8_api_internal_GetFunctionTemplateData() -> *mut c_void;
        #[link_name = "?GetName@Function@v8@@QEBA?AV?$Local@VValue@v8@@@2@XZ"]
        pub(super) fn v8_Function_GetName() -> *mut c_void;
        #[link_name = "?IsFunction@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsFunction() -> *mut c_void;
        #[link_name = "?IsMap@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsMap() -> *mut c_void;
        #[link_name = "?IsArray@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsArray() -> *mut c_void;
        #[link_name = "?IsInt32@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsInt32() -> *mut c_void;
        #[link_name = "?IsBigInt@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsBigInt() -> *mut c_void;
        #[link_name = "?FromJustIsNothing@api_internal@v8@@YAXXZ"]
        pub(super) fn v8_api_internal_FromJustIsNothing() -> *mut c_void;
        #[link_name = "?New@Integer@v8@@SA?AV?$Local@VInteger@v8@@@2@PEAVIsolate@2@H@Z"]
        pub(super) fn v8_Integer_New() -> *mut c_void;
        #[link_name = "?NewFromUnsigned@Integer@v8@@SA?AV?$Local@VInteger@v8@@@2@PEAVIsolate@2@I@Z"]
        pub(super) fn v8_Integer_NewFromUnsigned() -> *mut c_void;
        #[link_name = "?Value@Integer@v8@@QEBA_JXZ"]
        pub(super) fn v8_Integer_Value() -> *mut c_void;
        #[link_name = "?New@BigInt@v8@@SA?AV?$Local@VBigInt@v8@@@2@PEAVIsolate@2@_J@Z"]
        pub(super) fn v8_BigInt_New() -> *mut c_void;
        #[link_name = "?NewFromUtf8Literal@String@v8@@CA?AV?$Local@VString@v8@@@2@PEAVIsolate@2@PEBDW4NewStringType@2@H@Z"]
        pub(super) fn v8_String_NewFromUtf8Literal() -> *mut c_void;
        #[link_name = "?IsUint8Array@Value@v8@@QEBA_NXZ"]
        pub(super) fn v8_Value_IsUint8Array() -> *mut c_void;
        #[link_name = "?ToString@Value@v8@@QEBA?AV?$MaybeLocal@VString@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_Value_ToString() -> *mut c_void;
        #[link_name = "?ToInteger@Value@v8@@QEBA?AV?$MaybeLocal@VInteger@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_Value_ToInteger() -> *mut c_void;
        #[link_name = "?Global@Context@v8@@QEAA?AV?$Local@VObject@v8@@@2@XZ"]
        pub(super) fn v8_Context_Global() -> *mut c_void;
        #[link_name = "?InternalFieldCount@Object@v8@@QEBAHXZ"]
        pub(super) fn v8_Object_InternalFieldCount() -> *mut c_void;
        #[link_name = "?GetIdentityHash@Object@v8@@QEAAHXZ"]
        pub(super) fn v8_Object_GetIdentityHash() -> *mut c_void;
        #[link_name = "?DefineOwnProperty@Object@v8@@QEAA?AV?$Maybe@_N@2@V?$Local@VContext@v8@@@2@V?$Local@VName@v8@@@2@V?$Local@VValue@v8@@@2@W4PropertyAttribute@2@@Z"]
        pub(super) fn v8_Object_DefineOwnProperty() -> *mut c_void;
        #[link_name = "?ToExternalPointerTag@v8@@YA?AW4ExternalPointerTag@internal@1@G@Z"]
        pub(super) fn v8_ToExternalPointerTag() -> *mut c_void;
        #[link_name = "?GetCurrentIsolate@Internals@internal@v8@@SAPEAVIsolate@3@XZ"]
        pub(super) fn v8_internal_Internals_GetCurrentIsolate() -> *mut c_void;
        #[link_name = "??0HeapObjectStatistics@v8@@QEAA@XZ"]
        pub(super) fn v8_HeapObjectStatistics_ctor() -> *mut c_void;
        #[link_name = "?New@ArrayBuffer@v8@@SA?AV?$Local@VArrayBuffer@v8@@@2@PEAVIsolate@2@_KW4BackingStoreInitializationMode@2@@Z"]
        pub(super) fn v8_ArrayBuffer_New() -> *mut c_void;
        #[link_name = "?GetBackingStore@ArrayBuffer@v8@@QEAA?AV?$shared_ptr@VBackingStore@v8@@@std@@XZ"]
        pub(super) fn v8_ArrayBuffer_GetBackingStore() -> *mut c_void;
        #[link_name = "?Data@BackingStore@v8@@QEBAPEAXXZ"]
        pub(super) fn v8_BackingStore_Data() -> *mut c_void;
        #[link_name = "?Buffer@ArrayBufferView@v8@@QEAA?AV?$Local@VArrayBuffer@v8@@@2@XZ"]
        pub(super) fn v8_ArrayBufferView_Buffer() -> *mut c_void;
        #[link_name = "?ByteLength@ArrayBufferView@v8@@QEAA_KXZ"]
        pub(super) fn v8_ArrayBufferView_ByteLength() -> *mut c_void;
        #[link_name = "?ByteOffset@ArrayBufferView@v8@@QEAA_KXZ"]
        pub(super) fn v8_ArrayBufferView_ByteOffset() -> *mut c_void;
        #[link_name = "?New@Uint8Array@v8@@SA?AV?$Local@VUint8Array@v8@@@2@V?$Local@VArrayBuffer@v8@@@2@_K1@Z"]
        pub(super) fn v8_Uint8Array_New() -> *mut c_void;
        #[link_name = "?New@Uint32Array@v8@@SA?AV?$Local@VUint32Array@v8@@@2@V?$Local@VArrayBuffer@v8@@@2@_K1@Z"]
        pub(super) fn v8_Uint32Array_New() -> *mut c_void;
        #[link_name = "?New@CpuProfiler@v8@@SAPEAV12@PEAVIsolate@2@W4CpuProfilingNamingMode@2@W4CpuProfilingLoggingMode@2@@Z"]
        pub(super) fn v8_CpuProfiler_New() -> *mut c_void;
        #[link_name = "?Dispose@CpuProfiler@v8@@QEAAXXZ"]
        pub(super) fn v8_CpuProfiler_Dispose() -> *mut c_void;
        #[link_name = "?SetSamplingInterval@CpuProfiler@v8@@QEAAXH@Z"]
        pub(super) fn v8_CpuProfiler_SetSamplingInterval() -> *mut c_void;
        #[link_name = "?Start@CpuProfiler@v8@@QEAA?AUCpuProfilingResult@2@V?$Local@VString@v8@@@2@W4CpuProfilingMode@2@_NI@Z"]
        pub(super) fn v8_CpuProfiler_Start() -> *mut c_void;
        #[link_name = "?Stop@CpuProfiler@v8@@QEAAPEAVCpuProfile@2@I@Z"]
        pub(super) fn v8_CpuProfiler_Stop() -> *mut c_void;
        #[link_name = "?StartProfiling@CpuProfiler@v8@@QEAA?AW4CpuProfilingStatus@2@V?$Local@VString@v8@@@2@W4CpuProfilingMode@2@_NI@Z"]
        pub(super) fn v8_CpuProfiler_StartProfiling_mode() -> *mut c_void;
        #[link_name = "?StartProfiling@CpuProfiler@v8@@QEAA?AW4CpuProfilingStatus@2@V?$Local@VString@v8@@@2@_N@Z"]
        pub(super) fn v8_CpuProfiler_StartProfiling() -> *mut c_void;
        #[link_name = "?StopProfiling@CpuProfiler@v8@@QEAAPEAVCpuProfile@2@V?$Local@VString@v8@@@2@@Z"]
        pub(super) fn v8_CpuProfiler_StopProfiling() -> *mut c_void;
        #[link_name = "?CollectSample@CpuProfiler@v8@@SAXPEAVIsolate@2@V?$optional@_K@std@@@Z"]
        pub(super) fn v8_CpuProfiler_CollectSample() -> *mut c_void;
        #[link_name = "?Delete@CpuProfile@v8@@QEAAXXZ"]
        pub(super) fn v8_CpuProfile_Delete() -> *mut c_void;
        #[link_name = "?GetTitle@CpuProfile@v8@@QEBA?AV?$Local@VString@v8@@@2@XZ"]
        pub(super) fn v8_CpuProfile_GetTitle() -> *mut c_void;
        #[link_name = "?GetEndTime@CpuProfile@v8@@QEBA_JXZ"]
        pub(super) fn v8_CpuProfile_GetEndTime() -> *mut c_void;
        #[link_name = "?GetStartTime@CpuProfile@v8@@QEBA_JXZ"]
        pub(super) fn v8_CpuProfile_GetStartTime() -> *mut c_void;
        #[link_name = "?GetTopDownRoot@CpuProfile@v8@@QEBAPEBVCpuProfileNode@2@XZ"]
        pub(super) fn v8_CpuProfile_GetTopDownRoot() -> *mut c_void;
        #[link_name = "?GetSamplesCount@CpuProfile@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfile_GetSamplesCount() -> *mut c_void;
        #[link_name = "?GetSampleTimestamp@CpuProfile@v8@@QEBA_JH@Z"]
        pub(super) fn v8_CpuProfile_GetSampleTimestamp() -> *mut c_void;
        #[link_name = "?GetSample@CpuProfile@v8@@QEBAPEBVCpuProfileNode@2@H@Z"]
        pub(super) fn v8_CpuProfile_GetSample() -> *mut c_void;
        #[link_name = "?GetHitCount@CpuProfileNode@v8@@QEBAIXZ"]
        pub(super) fn v8_CpuProfileNode_GetHitCount() -> *mut c_void;
        #[link_name = "?GetScriptId@CpuProfileNode@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfileNode_GetScriptId() -> *mut c_void;
        #[link_name = "?GetLineTicks@CpuProfileNode@v8@@QEBA_NPEAULineTick@12@I@Z"]
        pub(super) fn v8_CpuProfileNode_GetLineTicks() -> *mut c_void;
        #[link_name = "?GetLineNumber@CpuProfileNode@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfileNode_GetLineNumber() -> *mut c_void;
        #[link_name = "?GetColumnNumber@CpuProfileNode@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfileNode_GetColumnNumber() -> *mut c_void;
        #[link_name = "?GetFunctionName@CpuProfileNode@v8@@QEBA?AV?$Local@VString@v8@@@2@XZ"]
        pub(super) fn v8_CpuProfileNode_GetFunctionName() -> *mut c_void;
        #[link_name = "?GetHitLineCount@CpuProfileNode@v8@@QEBAIXZ"]
        pub(super) fn v8_CpuProfileNode_GetHitLineCount() -> *mut c_void;
        #[link_name = "?GetChildrenCount@CpuProfileNode@v8@@QEBAHXZ"]
        pub(super) fn v8_CpuProfileNode_GetChildrenCount() -> *mut c_void;
        #[link_name = "?GetFunctionNameStr@CpuProfileNode@v8@@QEBAPEBDXZ"]
        pub(super) fn v8_CpuProfileNode_GetFunctionNameStr() -> *mut c_void;
        #[link_name = "?GetScriptResourceName@CpuProfileNode@v8@@QEBA?AV?$Local@VString@v8@@@2@XZ"]
        pub(super) fn v8_CpuProfileNode_GetScriptResourceName() -> *mut c_void;
        #[link_name = "?GetChild@CpuProfileNode@v8@@QEBAPEBV12@H@Z"]
        pub(super) fn v8_CpuProfileNode_GetChild() -> *mut c_void;
        #[link_name = "?Set@Map@v8@@QEAA?AV?$MaybeLocal@VMap@v8@@@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@1@Z"]
        pub(super) fn v8_Map_Set() -> *mut c_void;
        #[link_name = "?Delete@Map@v8@@QEAA?AV?$Maybe@_N@2@V?$Local@VContext@v8@@@2@V?$Local@VValue@v8@@@2@@Z"]
        pub(super) fn v8_Map_Delete() -> *mut c_void;
    }
}

/// V8 API functions whose Itanium mangled name is platform-dependent: the C++
/// stdlib inline namespace (std:: vs std::__1:: vs std::__ndk1::) and the
/// int64_t/uint64_t underlying type (long `l`/`m` vs long long `x`/`y`).
#[cfg(windows)]
mod posix_platform_specific_v8_apis {}
#[cfg(all(not(windows), target_os = "android"))]
mod posix_platform_specific_v8_apis {
    use core::ffi::c_void;
    unsafe extern "C" {
        pub(super) fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt6__ndk18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE()
        -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt6__ndk18optionalImEE()
        -> *mut c_void;
        pub(super) fn _ZN2v86BigInt3NewEPNS_7IsolateEl() -> *mut c_void;
        pub(super) fn _ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE()
        -> *mut c_void;
    }
}
#[cfg(all(not(windows), target_os = "macos"))]
mod posix_platform_specific_v8_apis {
    use core::ffi::c_void;
    unsafe extern "C" {
        pub(super) fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE()
        -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt3__18optionalIyEE()
        -> *mut c_void;
        pub(super) fn _ZN2v86BigInt3NewEPNS_7IsolateEx() -> *mut c_void;
        pub(super) fn _ZN2v812HeapProfiler25StartSamplingHeapProfilerEyiNS0_13SamplingFlagsE()
        -> *mut c_void;
    }
}
#[cfg(all(not(windows), target_os = "freebsd"))]
mod posix_platform_specific_v8_apis {
    use core::ffi::c_void;
    // FreeBSD's base libc++ uses the same `std::__1::` inline namespace as Apple's,
    // but uint64_t/int64_t are `unsigned long`/`long` (m/l) like Linux, not `long long` (y/x).
    unsafe extern "C" {
        pub(super) fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE()
        -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt3__18optionalImEE()
        -> *mut c_void;
        pub(super) fn _ZN2v86BigInt3NewEPNS_7IsolateEl() -> *mut c_void;
        pub(super) fn _ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE()
        -> *mut c_void;
    }
}
#[cfg(all(
    not(windows),
    not(target_os = "android"),
    not(target_os = "macos"),
    not(target_os = "freebsd")
))]
mod posix_platform_specific_v8_apis {
    use core::ffi::c_void;
    unsafe extern "C" {
        pub(super) fn _ZN2v85Array3NewENS_5LocalINS_7ContextEEEmSt8functionIFNS_10MaybeLocalINS_5ValueEEEvEE()
        -> *mut c_void;
        pub(super) fn _ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateESt8optionalImE() -> *mut c_void;
        pub(super) fn _ZN2v86BigInt3NewEPNS_7IsolateEl() -> *mut c_void;
        pub(super) fn _ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE()
        -> *mut c_void;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// uv_* symbol references (posix DCE suppression)
// ──────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
mod uv_functions_to_export {
    unsafe extern "C" {
        pub(super) fn uv_accept();
        pub(super) fn uv_async_init();
        pub(super) fn uv_async_send();
        pub(super) fn uv_available_parallelism();
        pub(super) fn uv_backend_fd();
        pub(super) fn uv_backend_timeout();
        pub(super) fn uv_barrier_destroy();
        pub(super) fn uv_barrier_init();
        pub(super) fn uv_barrier_wait();
        pub(super) fn uv_buf_init();
        pub(super) fn uv_cancel();
        pub(super) fn uv_chdir();
        pub(super) fn uv_check_init();
        pub(super) fn uv_check_start();
        pub(super) fn uv_check_stop();
        pub(super) fn uv_clock_gettime();
        pub(super) fn uv_close();
        pub(super) fn uv_cond_broadcast();
        pub(super) fn uv_cond_destroy();
        pub(super) fn uv_cond_init();
        pub(super) fn uv_cond_signal();
        pub(super) fn uv_cond_timedwait();
        pub(super) fn uv_cond_wait();
        pub(super) fn uv_cpu_info();
        pub(super) fn uv_cpumask_size();
        pub(super) fn uv_cwd();
        pub(super) fn uv_default_loop();
        pub(super) fn uv_disable_stdio_inheritance();
        pub(super) fn uv_dlclose();
        pub(super) fn uv_dlerror();
        pub(super) fn uv_dlopen();
        pub(super) fn uv_dlsym();
        pub(super) fn uv_err_name();
        pub(super) fn uv_err_name_r();
        pub(super) fn uv_exepath();
        pub(super) fn uv_fileno();
        pub(super) fn uv_free_cpu_info();
        pub(super) fn uv_free_interface_addresses();
        pub(super) fn uv_freeaddrinfo();
        pub(super) fn uv_fs_access();
        pub(super) fn uv_fs_chmod();
        pub(super) fn uv_fs_chown();
        pub(super) fn uv_fs_close();
        pub(super) fn uv_fs_closedir();
        pub(super) fn uv_fs_copyfile();
        pub(super) fn uv_fs_event_getpath();
        pub(super) fn uv_fs_event_init();
        pub(super) fn uv_fs_event_start();
        pub(super) fn uv_fs_event_stop();
        pub(super) fn uv_fs_fchmod();
        pub(super) fn uv_fs_fchown();
        pub(super) fn uv_fs_fdatasync();
        pub(super) fn uv_fs_fstat();
        pub(super) fn uv_fs_fsync();
        pub(super) fn uv_fs_ftruncate();
        pub(super) fn uv_fs_futime();
        pub(super) fn uv_fs_get_path();
        pub(super) fn uv_fs_get_ptr();
        pub(super) fn uv_fs_get_result();
        pub(super) fn uv_fs_get_statbuf();
        pub(super) fn uv_fs_get_system_error();
        pub(super) fn uv_fs_get_type();
        pub(super) fn uv_fs_lchown();
        pub(super) fn uv_fs_link();
        pub(super) fn uv_fs_lstat();
        pub(super) fn uv_fs_lutime();
        pub(super) fn uv_fs_mkdir();
        pub(super) fn uv_fs_mkdtemp();
        pub(super) fn uv_fs_mkstemp();
        pub(super) fn uv_fs_open();
        pub(super) fn uv_fs_opendir();
        pub(super) fn uv_fs_poll_getpath();
        pub(super) fn uv_fs_poll_init();
        pub(super) fn uv_fs_poll_start();
        pub(super) fn uv_fs_poll_stop();
        pub(super) fn uv_fs_read();
        pub(super) fn uv_fs_readdir();
        pub(super) fn uv_fs_readlink();
        pub(super) fn uv_fs_realpath();
        pub(super) fn uv_fs_rename();
        pub(super) fn uv_fs_req_cleanup();
        pub(super) fn uv_fs_rmdir();
        pub(super) fn uv_fs_scandir();
        pub(super) fn uv_fs_scandir_next();
        pub(super) fn uv_fs_sendfile();
        pub(super) fn uv_fs_stat();
        pub(super) fn uv_fs_statfs();
        pub(super) fn uv_fs_symlink();
        pub(super) fn uv_fs_unlink();
        pub(super) fn uv_fs_utime();
        pub(super) fn uv_fs_write();
        pub(super) fn uv_get_available_memory();
        pub(super) fn uv_get_constrained_memory();
        pub(super) fn uv_get_free_memory();
        pub(super) fn uv_get_osfhandle();
        pub(super) fn uv_get_process_title();
        pub(super) fn uv_get_total_memory();
        pub(super) fn uv_getaddrinfo();
        pub(super) fn uv_getnameinfo();
        pub(super) fn uv_getrusage();
        pub(super) fn uv_getrusage_thread();
        pub(super) fn uv_gettimeofday();
        pub(super) fn uv_guess_handle();
        pub(super) fn uv_handle_get_data();
        pub(super) fn uv_handle_get_loop();
        pub(super) fn uv_handle_get_type();
        pub(super) fn uv_handle_set_data();
        pub(super) fn uv_handle_size();
        pub(super) fn uv_handle_type_name();
        pub(super) fn uv_has_ref();
        pub(super) fn uv_hrtime();
        pub(super) fn uv_idle_init();
        pub(super) fn uv_idle_start();
        pub(super) fn uv_idle_stop();
        pub(super) fn uv_if_indextoiid();
        pub(super) fn uv_if_indextoname();
        pub(super) fn uv_inet_ntop();
        pub(super) fn uv_inet_pton();
        pub(super) fn uv_interface_addresses();
        pub(super) fn uv_ip_name();
        pub(super) fn uv_ip4_addr();
        pub(super) fn uv_ip4_name();
        pub(super) fn uv_ip6_addr();
        pub(super) fn uv_ip6_name();
        pub(super) fn uv_is_active();
        pub(super) fn uv_is_closing();
        pub(super) fn uv_is_readable();
        pub(super) fn uv_is_writable();
        pub(super) fn uv_key_create();
        pub(super) fn uv_key_delete();
        pub(super) fn uv_key_get();
        pub(super) fn uv_key_set();
        pub(super) fn uv_kill();
        pub(super) fn uv_library_shutdown();
        pub(super) fn uv_listen();
        pub(super) fn uv_loadavg();
        pub(super) fn uv_loop_alive();
        pub(super) fn uv_loop_close();
        pub(super) fn uv_loop_configure();
        pub(super) fn uv_loop_delete();
        pub(super) fn uv_loop_fork();
        pub(super) fn uv_loop_get_data();
        pub(super) fn uv_loop_init();
        pub(super) fn uv_loop_new();
        pub(super) fn uv_loop_set_data();
        pub(super) fn uv_loop_size();
        pub(super) fn uv_metrics_idle_time();
        pub(super) fn uv_metrics_info();
        pub(super) fn uv_mutex_destroy();
        pub(super) fn uv_mutex_init();
        pub(super) fn uv_mutex_init_recursive();
        pub(super) fn uv_mutex_lock();
        pub(super) fn uv_mutex_trylock();
        pub(super) fn uv_mutex_unlock();
        pub(super) fn uv_now();
        pub(super) fn uv_once();
        pub(super) fn uv_open_osfhandle();
        pub(super) fn uv_os_environ();
        pub(super) fn uv_os_free_environ();
        pub(super) fn uv_os_free_group();
        pub(super) fn uv_os_free_passwd();
        pub(super) fn uv_os_get_group();
        pub(super) fn uv_os_get_passwd();
        pub(super) fn uv_os_get_passwd2();
        pub(super) fn uv_os_getenv();
        pub(super) fn uv_os_gethostname();
        pub(super) fn uv_os_getpid();
        pub(super) fn uv_os_getppid();
        pub(super) fn uv_os_getpriority();
        pub(super) fn uv_os_homedir();
        pub(super) fn uv_os_setenv();
        pub(super) fn uv_os_setpriority();
        pub(super) fn uv_os_tmpdir();
        pub(super) fn uv_os_uname();
        pub(super) fn uv_os_unsetenv();
        pub(super) fn uv_pipe();
        pub(super) fn uv_pipe_bind();
        pub(super) fn uv_pipe_bind2();
        pub(super) fn uv_pipe_chmod();
        pub(super) fn uv_pipe_connect();
        pub(super) fn uv_pipe_connect2();
        pub(super) fn uv_pipe_getpeername();
        pub(super) fn uv_pipe_getsockname();
        pub(super) fn uv_pipe_init();
        pub(super) fn uv_pipe_open();
        pub(super) fn uv_pipe_pending_count();
        pub(super) fn uv_pipe_pending_instances();
        pub(super) fn uv_pipe_pending_type();
        pub(super) fn uv_poll_init();
        pub(super) fn uv_poll_init_socket();
        pub(super) fn uv_poll_start();
        pub(super) fn uv_poll_stop();
        pub(super) fn uv_prepare_init();
        pub(super) fn uv_prepare_start();
        pub(super) fn uv_prepare_stop();
        pub(super) fn uv_print_active_handles();
        pub(super) fn uv_print_all_handles();
        pub(super) fn uv_process_get_pid();
        pub(super) fn uv_process_kill();
        pub(super) fn uv_queue_work();
        pub(super) fn uv_random();
        pub(super) fn uv_read_start();
        pub(super) fn uv_read_stop();
        pub(super) fn uv_recv_buffer_size();
        pub(super) fn uv_ref();
        pub(super) fn uv_replace_allocator();
        pub(super) fn uv_req_get_data();
        pub(super) fn uv_req_get_type();
        pub(super) fn uv_req_set_data();
        pub(super) fn uv_req_size();
        pub(super) fn uv_req_type_name();
        pub(super) fn uv_resident_set_memory();
        pub(super) fn uv_run();
        pub(super) fn uv_rwlock_destroy();
        pub(super) fn uv_rwlock_init();
        pub(super) fn uv_rwlock_rdlock();
        pub(super) fn uv_rwlock_rdunlock();
        pub(super) fn uv_rwlock_tryrdlock();
        pub(super) fn uv_rwlock_trywrlock();
        pub(super) fn uv_rwlock_wrlock();
        pub(super) fn uv_rwlock_wrunlock();
        pub(super) fn uv_sem_destroy();
        pub(super) fn uv_sem_init();
        pub(super) fn uv_sem_post();
        pub(super) fn uv_sem_trywait();
        pub(super) fn uv_sem_wait();
        pub(super) fn uv_send_buffer_size();
        pub(super) fn uv_set_process_title();
        pub(super) fn uv_setup_args();
        pub(super) fn uv_shutdown();
        pub(super) fn uv_signal_init();
        pub(super) fn uv_signal_start();
        pub(super) fn uv_signal_start_oneshot();
        pub(super) fn uv_signal_stop();
        pub(super) fn uv_sleep();
        pub(super) fn uv_socketpair();
        pub(super) fn uv_spawn();
        pub(super) fn uv_stop();
        pub(super) fn uv_stream_get_write_queue_size();
        pub(super) fn uv_stream_set_blocking();
        pub(super) fn uv_strerror();
        pub(super) fn uv_strerror_r();
        pub(super) fn uv_tcp_bind();
        pub(super) fn uv_tcp_close_reset();
        pub(super) fn uv_tcp_connect();
        pub(super) fn uv_tcp_getpeername();
        pub(super) fn uv_tcp_getsockname();
        pub(super) fn uv_tcp_init();
        pub(super) fn uv_tcp_init_ex();
        pub(super) fn uv_tcp_keepalive();
        pub(super) fn uv_tcp_nodelay();
        pub(super) fn uv_tcp_open();
        pub(super) fn uv_tcp_simultaneous_accepts();
        pub(super) fn uv_thread_create();
        pub(super) fn uv_thread_create_ex();
        pub(super) fn uv_thread_detach();
        pub(super) fn uv_thread_equal();
        pub(super) fn uv_thread_getaffinity();
        pub(super) fn uv_thread_getcpu();
        pub(super) fn uv_thread_getname();
        pub(super) fn uv_thread_getpriority();
        pub(super) fn uv_thread_join();
        pub(super) fn uv_thread_self();
        pub(super) fn uv_thread_setaffinity();
        pub(super) fn uv_thread_setname();
        pub(super) fn uv_thread_setpriority();
        pub(super) fn uv_timer_again();
        pub(super) fn uv_timer_get_due_in();
        pub(super) fn uv_timer_get_repeat();
        pub(super) fn uv_timer_init();
        pub(super) fn uv_timer_set_repeat();
        pub(super) fn uv_timer_start();
        pub(super) fn uv_timer_stop();
        pub(super) fn uv_translate_sys_error();
        pub(super) fn uv_try_write();
        pub(super) fn uv_try_write2();
        pub(super) fn uv_tty_get_vterm_state();
        pub(super) fn uv_tty_get_winsize();
        pub(super) fn uv_tty_init();
        pub(super) fn uv_tty_reset_mode();
        pub(super) fn uv_tty_set_mode();
        pub(super) fn uv_tty_set_vterm_state();
        pub(super) fn uv_udp_bind();
        pub(super) fn uv_udp_connect();
        pub(super) fn uv_udp_get_send_queue_count();
        pub(super) fn uv_udp_get_send_queue_size();
        pub(super) fn uv_udp_getpeername();
        pub(super) fn uv_udp_getsockname();
        pub(super) fn uv_udp_init();
        pub(super) fn uv_udp_init_ex();
        pub(super) fn uv_udp_open();
        pub(super) fn uv_udp_recv_start();
        pub(super) fn uv_udp_recv_stop();
        pub(super) fn uv_udp_send();
        pub(super) fn uv_udp_set_broadcast();
        pub(super) fn uv_udp_set_membership();
        pub(super) fn uv_udp_set_multicast_interface();
        pub(super) fn uv_udp_set_multicast_loop();
        pub(super) fn uv_udp_set_multicast_ttl();
        pub(super) fn uv_udp_set_source_membership();
        pub(super) fn uv_udp_set_ttl();
        pub(super) fn uv_udp_try_send();
        pub(super) fn uv_udp_try_send2();
        pub(super) fn uv_udp_using_recvmmsg();
        pub(super) fn uv_unref();
        pub(super) fn uv_update_time();
        pub(super) fn uv_uptime();
        pub(super) fn uv_utf16_length_as_wtf8();
        pub(super) fn uv_utf16_to_wtf8();
        pub(super) fn uv_version();
        pub(super) fn uv_version_string();
        pub(super) fn uv_walk();
        pub(super) fn uv_write();
        pub(super) fn uv_write2();
        pub(super) fn uv_wtf8_length_as_utf16();
        pub(super) fn uv_wtf8_to_utf16();
    }
}
#[cfg(not(unix))]
mod uv_functions_to_export {}

// ──────────────────────────────────────────────────────────────────────────
// fix_dead_code_elimination
// ──────────────────────────────────────────────────────────────────────────

/// To update this list, use find + multi-cursor in your editor.
/// - pub extern fn napi_
/// - pub export fn napi_
use bun_core::keep_symbols;

pub(crate) fn fix_dead_code_elimination() {
    jsc::mark_binding();

    // napi_functions_to_export
    keep_symbols!(
        napi_acquire_threadsafe_function,
        napi_add_async_cleanup_hook,
        napi_add_env_cleanup_hook,
        napi_add_finalizer,
        napi_adjust_external_memory,
        napi_async_destroy,
        napi_async_init,
        napi_call_function,
        napi_call_threadsafe_function,
        napi_cancel_async_work,
        napi_check_object_type_tag,
        napi_close_callback_scope,
        napi_close_escapable_handle_scope,
        napi_close_handle_scope,
        napi_coerce_to_bool,
        napi_coerce_to_number,
        napi_coerce_to_object,
        napi_create_array,
        napi_create_array_with_length,
        napi_create_arraybuffer,
        napi_create_async_work,
        napi_create_bigint_int64,
        napi_create_bigint_uint64,
        napi_create_bigint_words,
        napi_create_buffer,
        napi_create_buffer_copy,
        napi_create_dataview,
        napi_create_date,
        napi_create_double,
        napi_create_error,
        napi_create_external,
        napi_create_external_arraybuffer,
        napi_create_external_buffer,
        napi_create_int32,
        napi_create_int64,
        napi_create_object,
        napi_create_promise,
        napi_create_range_error,
        napi_create_reference,
        napi_create_string_latin1,
        napi_create_string_utf16,
        napi_create_string_utf8,
        napi_create_symbol,
        napi_create_threadsafe_function,
        napi_create_type_error,
        napi_create_typedarray,
        napi_create_uint32,
        napi_define_class,
        napi_define_properties,
        napi_delete_async_work,
        napi_delete_element,
        napi_delete_reference,
        napi_detach_arraybuffer,
        napi_escape_handle,
        napi_fatal_error,
        napi_fatal_exception,
        napi_get_all_property_names,
        napi_get_and_clear_last_exception,
        napi_get_array_length,
        napi_get_arraybuffer_info,
        napi_get_boolean,
        napi_get_buffer_info,
        napi_get_cb_info,
        napi_get_dataview_info,
        napi_get_date_value,
        napi_get_element,
        napi_get_global,
        napi_get_instance_data,
        napi_get_last_error_info,
        napi_get_new_target,
        napi_get_node_version,
        napi_get_null,
        napi_get_prototype,
        napi_get_reference_value,
        napi_get_threadsafe_function_context,
        napi_get_typedarray_info,
        napi_get_undefined,
        napi_get_uv_event_loop,
        napi_get_value_bigint_int64,
        napi_get_value_bigint_uint64,
        napi_get_value_bigint_words,
        napi_get_value_bool,
        napi_get_value_double,
        napi_get_value_external,
        napi_get_value_int32,
        napi_get_value_int64,
        napi_get_value_string_latin1,
        napi_get_value_string_utf16,
        napi_get_value_string_utf8,
        napi_get_value_uint32,
        napi_get_version,
        napi_has_element,
        napi_instanceof,
        napi_is_array,
        napi_is_arraybuffer,
        napi_is_buffer,
        napi_is_dataview,
        napi_is_date,
        napi_is_detached_arraybuffer,
        napi_is_error,
        napi_is_exception_pending,
        napi_is_promise,
        napi_is_typedarray,
        napi_make_callback,
        napi_new_instance,
        napi_open_callback_scope,
        napi_open_escapable_handle_scope,
        napi_open_handle_scope,
        napi_queue_async_work,
        napi_ref_threadsafe_function,
        napi_reference_ref,
        napi_reference_unref,
        napi_reject_deferred,
        napi_release_threadsafe_function,
        napi_remove_async_cleanup_hook,
        napi_remove_env_cleanup_hook,
        napi_remove_wrap,
        napi_resolve_deferred,
        napi_run_script,
        napi_set_element,
        napi_set_instance_data,
        napi_strict_equals,
        napi_throw,
        napi_throw_error,
        napi_throw_range_error,
        napi_throw_type_error,
        napi_type_tag_object,
        napi_typeof,
        napi_unref_threadsafe_function,
        napi_unwrap,
        napi_wrap,
        // -- node-api
        node_api_create_syntax_error,
        node_api_symbol_for,
        node_api_throw_syntax_error,
        node_api_create_external_string_latin1,
        node_api_create_external_string_utf16,
        node_api_set_prototype,
        node_api_create_object_with_properties,
        node_api_create_sharedarraybuffer,
        node_api_create_external_sharedarraybuffer,
        node_api_is_sharedarraybuffer,
    );

    // uv_functions_to_export
    // This list is hand-maintained — keep it in sync with the
    // `uv_functions_to_export` module above.
    #[cfg(unix)]
    {
        use uv_functions_to_export::*;
        keep_symbols!(
            uv_accept,
            uv_async_init,
            uv_async_send,
            uv_available_parallelism,
            uv_backend_fd,
            uv_backend_timeout,
            uv_barrier_destroy,
            uv_barrier_init,
            uv_barrier_wait,
            uv_buf_init,
            uv_cancel,
            uv_chdir,
            uv_check_init,
            uv_check_start,
            uv_check_stop,
            uv_clock_gettime,
            uv_close,
            uv_cond_broadcast,
            uv_cond_destroy,
            uv_cond_init,
            uv_cond_signal,
            uv_cond_timedwait,
            uv_cond_wait,
            uv_cpu_info,
            uv_cpumask_size,
            uv_cwd,
            uv_default_loop,
            uv_disable_stdio_inheritance,
            uv_dlclose,
            uv_dlerror,
            uv_dlopen,
            uv_dlsym,
            uv_err_name,
            uv_err_name_r,
            uv_exepath,
            uv_fileno,
            uv_free_cpu_info,
            uv_free_interface_addresses,
            uv_freeaddrinfo,
            uv_fs_access,
            uv_fs_chmod,
            uv_fs_chown,
            uv_fs_close,
            uv_fs_closedir,
            uv_fs_copyfile,
            uv_fs_event_getpath,
            uv_fs_event_init,
            uv_fs_event_start,
            uv_fs_event_stop,
            uv_fs_fchmod,
            uv_fs_fchown,
            uv_fs_fdatasync,
            uv_fs_fstat,
            uv_fs_fsync,
            uv_fs_ftruncate,
            uv_fs_futime,
            uv_fs_get_path,
            uv_fs_get_ptr,
            uv_fs_get_result,
            uv_fs_get_statbuf,
            uv_fs_get_system_error,
            uv_fs_get_type,
            uv_fs_lchown,
            uv_fs_link,
            uv_fs_lstat,
            uv_fs_lutime,
            uv_fs_mkdir,
            uv_fs_mkdtemp,
            uv_fs_mkstemp,
            uv_fs_open,
            uv_fs_opendir,
            uv_fs_poll_getpath,
            uv_fs_poll_init,
            uv_fs_poll_start,
            uv_fs_poll_stop,
            uv_fs_read,
            uv_fs_readdir,
            uv_fs_readlink,
            uv_fs_realpath,
            uv_fs_rename,
            uv_fs_req_cleanup,
            uv_fs_rmdir,
            uv_fs_scandir,
            uv_fs_scandir_next,
            uv_fs_sendfile,
            uv_fs_stat,
            uv_fs_statfs,
            uv_fs_symlink,
            uv_fs_unlink,
            uv_fs_utime,
            uv_fs_write,
            uv_get_available_memory,
            uv_get_constrained_memory,
            uv_get_free_memory,
            uv_get_osfhandle,
            uv_get_process_title,
            uv_get_total_memory,
            uv_getaddrinfo,
            uv_getnameinfo,
            uv_getrusage,
            uv_getrusage_thread,
            uv_gettimeofday,
            uv_guess_handle,
            uv_handle_get_data,
            uv_handle_get_loop,
            uv_handle_get_type,
            uv_handle_set_data,
            uv_handle_size,
            uv_handle_type_name,
            uv_has_ref,
            uv_hrtime,
            uv_idle_init,
            uv_idle_start,
            uv_idle_stop,
            uv_if_indextoiid,
            uv_if_indextoname,
            uv_inet_ntop,
            uv_inet_pton,
            uv_interface_addresses,
            uv_ip_name,
            uv_ip4_addr,
            uv_ip4_name,
            uv_ip6_addr,
            uv_ip6_name,
            uv_is_active,
            uv_is_closing,
            uv_is_readable,
            uv_is_writable,
            uv_key_create,
            uv_key_delete,
            uv_key_get,
            uv_key_set,
            uv_kill,
            uv_library_shutdown,
            uv_listen,
            uv_loadavg,
            uv_loop_alive,
            uv_loop_close,
            uv_loop_configure,
            uv_loop_delete,
            uv_loop_fork,
            uv_loop_get_data,
            uv_loop_init,
            uv_loop_new,
            uv_loop_set_data,
            uv_loop_size,
            uv_metrics_idle_time,
            uv_metrics_info,
            uv_mutex_destroy,
            uv_mutex_init,
            uv_mutex_init_recursive,
            uv_mutex_lock,
            uv_mutex_trylock,
            uv_mutex_unlock,
            uv_now,
            uv_once,
            uv_open_osfhandle,
            uv_os_environ,
            uv_os_free_environ,
            uv_os_free_group,
            uv_os_free_passwd,
            uv_os_get_group,
            uv_os_get_passwd,
            uv_os_get_passwd2,
            uv_os_getenv,
            uv_os_gethostname,
            uv_os_getpid,
            uv_os_getppid,
            uv_os_getpriority,
            uv_os_homedir,
            uv_os_setenv,
            uv_os_setpriority,
            uv_os_tmpdir,
            uv_os_uname,
            uv_os_unsetenv,
            uv_pipe,
            uv_pipe_bind,
            uv_pipe_bind2,
            uv_pipe_chmod,
            uv_pipe_connect,
            uv_pipe_connect2,
            uv_pipe_getpeername,
            uv_pipe_getsockname,
            uv_pipe_init,
            uv_pipe_open,
            uv_pipe_pending_count,
            uv_pipe_pending_instances,
            uv_pipe_pending_type,
            uv_poll_init,
            uv_poll_init_socket,
            uv_poll_start,
            uv_poll_stop,
            uv_prepare_init,
            uv_prepare_start,
            uv_prepare_stop,
            uv_print_active_handles,
            uv_print_all_handles,
            uv_process_get_pid,
            uv_process_kill,
            uv_queue_work,
            uv_random,
            uv_read_start,
            uv_read_stop,
            uv_recv_buffer_size,
            uv_ref,
            uv_replace_allocator,
            uv_req_get_data,
            uv_req_get_type,
            uv_req_set_data,
            uv_req_size,
            uv_req_type_name,
            uv_resident_set_memory,
            uv_run,
            uv_rwlock_destroy,
            uv_rwlock_init,
            uv_rwlock_rdlock,
            uv_rwlock_rdunlock,
            uv_rwlock_tryrdlock,
            uv_rwlock_trywrlock,
            uv_rwlock_wrlock,
            uv_rwlock_wrunlock,
            uv_sem_destroy,
            uv_sem_init,
            uv_sem_post,
            uv_sem_trywait,
            uv_sem_wait,
            uv_send_buffer_size,
            uv_set_process_title,
            uv_setup_args,
            uv_shutdown,
            uv_signal_init,
            uv_signal_start,
            uv_signal_start_oneshot,
            uv_signal_stop,
            uv_sleep,
            uv_socketpair,
            uv_spawn,
            uv_stop,
            uv_stream_get_write_queue_size,
            uv_stream_set_blocking,
            uv_strerror,
            uv_strerror_r,
            uv_tcp_bind,
            uv_tcp_close_reset,
            uv_tcp_connect,
            uv_tcp_getpeername,
            uv_tcp_getsockname,
            uv_tcp_init,
            uv_tcp_init_ex,
            uv_tcp_keepalive,
            uv_tcp_nodelay,
            uv_tcp_open,
            uv_tcp_simultaneous_accepts,
            uv_thread_create,
            uv_thread_create_ex,
            uv_thread_detach,
            uv_thread_equal,
            uv_thread_getaffinity,
            uv_thread_getcpu,
            uv_thread_getname,
            uv_thread_getpriority,
            uv_thread_join,
            uv_thread_self,
            uv_thread_setaffinity,
            uv_thread_setname,
            uv_thread_setpriority,
            uv_timer_again,
            uv_timer_get_due_in,
            uv_timer_get_repeat,
            uv_timer_init,
            uv_timer_set_repeat,
            uv_timer_start,
            uv_timer_stop,
            uv_translate_sys_error,
            uv_try_write,
            uv_try_write2,
            uv_tty_get_vterm_state,
            uv_tty_get_winsize,
            uv_tty_init,
            uv_tty_reset_mode,
            uv_tty_set_mode,
            uv_tty_set_vterm_state,
            uv_udp_bind,
            uv_udp_connect,
            uv_udp_get_send_queue_count,
            uv_udp_get_send_queue_size,
            uv_udp_getpeername,
            uv_udp_getsockname,
            uv_udp_init,
            uv_udp_init_ex,
            uv_udp_open,
            uv_udp_recv_start,
            uv_udp_recv_stop,
            uv_udp_send,
            uv_udp_set_broadcast,
            uv_udp_set_membership,
            uv_udp_set_multicast_interface,
            uv_udp_set_multicast_loop,
            uv_udp_set_multicast_ttl,
            uv_udp_set_source_membership,
            uv_udp_set_ttl,
            uv_udp_try_send,
            uv_udp_try_send2,
            uv_udp_using_recvmmsg,
            uv_unref,
            uv_update_time,
            uv_uptime,
            uv_utf16_length_as_wtf8,
            uv_utf16_to_wtf8,
            uv_version,
            uv_version_string,
            uv_walk,
            uv_write,
            uv_write2,
            uv_wtf8_length_as_utf16,
            uv_wtf8_to_utf16,
        );
    }

    // V8API
    // Hand-maintained for the same reason as the uv list above (no reflection
    // over extern blocks) — keep in sync with the `v8_api` module.
    #[cfg(not(windows))]
    {
        use v8_api::*;
        keep_symbols!(
            _ZN2v87Isolate10GetCurrentEv, _ZN2v87Isolate13TryGetCurrentEv,
            _ZN2v87Isolate17GetCurrentContextEv,
            _ZN2v87Isolate28GetEnteredOrMicrotaskContextEv,
            _ZN2v87Isolate36GetContinuationPreservedEmbedderDataEv,
            _ZN2v87Isolate7IsInUseEv, _ZN2v87Isolate21LowMemoryNotificationEv,
            _ZN2v87Isolate36AutomaticallyRestoreInitialHeapLimitEd,
            _ZN2v87Isolate30NumberOfTrackedHeapObjectTypesEv,
            _ZN2v87Isolate31GetHeapObjectStatisticsAtLastGCEPNS_20HeapObjectStatisticsEm,
            _ZN2v87Isolate21AddGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_S2_,
            _ZN2v87Isolate24RemoveGCPrologueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_,
            _ZN2v87Isolate21AddGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_S2_,
            _ZN2v87Isolate24RemoveGCEpilogueCallbackEPFvPS0_NS_6GCTypeENS_15GCCallbackFlagsEPvES4_,
            _ZN2v87Isolate24AddNearHeapLimitCallbackEPFmPvmmES1_,
            _ZN2v87Isolate27RemoveNearHeapLimitCallbackEPFmPvmmEm,
            _ZN2v87Isolate16RequestInterruptEPFvPS0_PvES2_,
            _ZN2v87Isolate14ThrowExceptionENS_5LocalINS_5ValueEEE,
            _ZN2v87Isolate10ThrowErrorENS_5LocalINS_6StringEEE,
            _ZN2v89Exception5ErrorENS_5LocalINS_6StringEEENS1_INS_5ValueEEE,
            _ZN2v89Exception9TypeErrorENS_5LocalINS_6StringEEENS1_INS_5ValueEEE,
            _ZN2v87Isolate15GetHeapProfilerEv,
            _ZN2v812HeapProfiler24StopSamplingHeapProfilerEv,
            _ZN2v812HeapProfiler20GetAllocationProfileEv,
            _ZN4node25AddEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_,
            _ZN4node28RemoveEnvironmentCleanupHookEPN2v87IsolateEPFvPvES3_,
            _ZN4node19GetCurrentEventLoopEPN2v87IsolateE,
            _ZN4node29AsyncHooksGetExecutionAsyncIdEN2v85LocalINS0_7ContextEEE,
            _ZN4node13EmitAsyncInitEPN2v87IsolateENS0_5LocalINS0_6ObjectEEENS3_INS0_6StringEEEd,
            _ZN4node16EmitAsyncDestroyEPN2v87IsolateENS_13async_contextE,
            _ZN4node12MakeCallbackEPN2v87IsolateENS0_5LocalINS0_6ObjectEEENS3_INS0_8FunctionEEEiPNS3_INS0_5ValueEEENS_13async_contextE,
            _ZN2v84base9TimeTicks3NowEv,
            _ZN2v86Number3NewEPNS_7IsolateEd, _ZNK2v86Number5ValueEv,
            _ZN2v86Number12NewFromInt32EPNS_7IsolateEi,
            _ZN2v86Number13NewFromUint32EPNS_7IsolateEj,
            _ZN2v86String11NewFromUtf8EPNS_7IsolateEPKcNS_13NewStringTypeEi,
            _ZNK2v86String9WriteUtf8EPNS_7IsolateEPciPii, _ZN2v812api_internal12ToLocalEmptyEv,
            _ZNK2v86String6LengthEv, _ZN2v88External3NewEPNS_7IsolateEPv,
            _ZNK2v88External5ValueEv, _ZN2v86Object3NewEPNS_7IsolateE,
            _ZN2v88External3NewEPNS_7IsolateEPvt, _ZNK2v88External5ValueEt,
            _ZN2v86Object3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_,
            _ZN2v86Object3SetENS_5LocalINS_7ContextEEEjNS1_INS_5ValueEEE,
            _ZN2v86Object16SetInternalFieldEiNS_5LocalINS_4DataEEE,
            _ZN2v86Object20SlowGetInternalFieldEi,
            _ZN2v86Object32SetAlignedPointerInInternalFieldEiPvt,
            _ZN2v86Object38SlowGetAlignedPointerFromInternalFieldEit,
            _ZN2v86Object3GetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE,
            _ZN2v86Object3GetENS_5LocalINS_7ContextEEEj,
            _ZN2v811HandleScope12CreateHandleEPNS_8internal7IsolateEm,
            _ZN2v811HandleScope12CreateHandleEPNS_7IsolateEm,
            _ZN2v811HandleScope10InitializeEPNS_7IsolateE,
            _ZNK2v85Value16QuickIsUndefinedEv,
            _ZNK2v85Value11QuickIsNullEv,
            _ZNK2v85Value22QuickIsNullOrUndefinedEv,
            _ZNK2v85Value13QuickIsStringEv,
            _ZN2v811HandleScope6ExtendEPNS_7IsolateE,
            _ZN2v811HandleScope16DeleteExtensionsEPNS_7IsolateE,
            _ZN2v811HandleScopeC1EPNS_7IsolateE, _ZN2v811HandleScopeD1Ev,
            _ZN2v811HandleScopeD2Ev,
            _ZN2v816FunctionTemplate11GetFunctionENS_5LocalINS_7ContextEEE,
            _ZN2v816FunctionTemplate12SetClassNameENS_5LocalINS_6StringEEE,
            _ZN2v816FunctionTemplate3NewEPNS_7IsolateEPFvRKNS_20FunctionCallbackInfoINS_5ValueEEEENS_5LocalIS4_EENSA_INS_9SignatureEEEiNS_19ConstructorBehaviorENS_14SideEffectTypeEPKNS_9CFunctionEttt,
            _ZN2v814ObjectTemplate11NewInstanceENS_5LocalINS_7ContextEEE,
            _ZN2v814ObjectTemplate21SetInternalFieldCountEi,
            _ZNK2v814ObjectTemplate18InternalFieldCountEv,
            _ZN2v814ObjectTemplate3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE,
            _ZN2v816FunctionTemplate16InstanceTemplateEv,
            _ZN2v816FunctionTemplate17PrototypeTemplateEv,
            _ZN2v88Template3SetENS_5LocalINS_4NameEEENS1_INS_4DataEEENS_17PropertyAttributeE,
            _ZN2v88Template21SetNativeDataPropertyENS_5LocalINS_4NameEEEPFvS3_RKNS_20PropertyCallbackInfoINS_5ValueEEEEPFvS3_NS1_IS5_EERKNS4_IvEEESB_NS_17PropertyAttributeENS_14SideEffectTypeESI_,
            _ZN2v89Signature3NewEPNS_7IsolateENS_5LocalINS_16FunctionTemplateEEE,
            _ZN2v824EscapableHandleScopeBase10EscapeSlotEPm,
            _ZN2v824EscapableHandleScopeBaseC2EPNS_7IsolateE,
            _ZN2v88internal35IsolateFromNeverReadOnlySpaceObjectEm,
            _ZN2v85Array3NewEPNS_7IsolateEPNS_5LocalINS_5ValueEEEm, _ZNK2v85Array6LengthEv,
            _ZN2v85Array3NewEPNS_7IsolateEi,
            _ZN2v85Array7IterateENS_5LocalINS_7ContextEEEPFNS0_14CallbackResultEjNS1_INS_5ValueEEEPvES7_,
            _ZN2v85Array9CheckCastEPNS_5ValueE,
            _ZN2v88Function7SetNameENS_5LocalINS_6StringEEE,
            _ZN2v88Function4CallENS_5LocalINS_7ContextEEENS1_INS_5ValueEEEiPS5_,
            _ZNK2v88Function11NewInstanceENS_5LocalINS_7ContextEEEiPNS1_INS_5ValueEEE,
            _ZNK2v85Value9IsBooleanEv,
            _ZNK2v87Boolean5ValueEv, _ZNK2v85Value10FullIsTrueEv, _ZNK2v85Value11FullIsFalseEv,
            _ZN2v820EscapableHandleScopeC1EPNS_7IsolateE,
            _ZN2v820EscapableHandleScopeC2EPNS_7IsolateE, _ZN2v820EscapableHandleScopeD1Ev,
            _ZN2v820EscapableHandleScopeD2Ev, _ZNK2v85Value8IsObjectEv,
            _ZNK2v85Value8IsNumberEv, _ZNK2v85Value8IsUint32Ev,
            _ZNK2v85Value11Uint32ValueENS_5LocalINS_7ContextEEE, _ZNK2v85Value11IsUndefinedEv,
            _ZNK2v85Value6IsNullEv, _ZNK2v85Value17IsNullOrUndefinedEv, _ZNK2v85Value6IsTrueEv,
            _ZNK2v85Value7IsFalseEv, _ZNK2v85Value8IsStringEv,
            _ZNK2v85Value12StrictEqualsENS_5LocalIS0_EE, _ZN2v87Boolean3NewEPNS_7IsolateEb,
            _ZN2v811ArrayBuffer3NewEPNS_7IsolateEmNS_30BackingStoreInitializationModeE,
            _ZN2v811ArrayBuffer15GetBackingStoreEv, _ZNK2v812BackingStore4DataEv,
            _ZN2v815ArrayBufferView6BufferEv, _ZN2v815ArrayBufferView10ByteLengthEv,
            _ZN2v815ArrayBufferView10ByteOffsetEv,
            _ZN2v810Uint8Array3NewENS_5LocalINS_11ArrayBufferEEEmm,
            _ZN2v811Uint32Array3NewENS_5LocalINS_11ArrayBufferEEEmm,
            _ZN2v86Object16GetInternalFieldEi, _ZN2v87Context10GetIsolateEv,
            _ZN2v86String14NewFromOneByteEPNS_7IsolateEPKhNS_13NewStringTypeEi,
            _ZNK2v86String10Utf8LengthEPNS_7IsolateE, _ZNK2v86String10IsExternalEv,
            _ZNK2v86String17IsExternalOneByteEv, _ZNK2v86String17IsExternalTwoByteEv,
            _ZNK2v86String9IsOneByteEv, _ZNK2v86String19ContainsOnlyOneByteEv,
            _ZNK2v86String7WriteV2EPNS_7IsolateEjjPti,
            _ZNK2v86String14WriteOneByteV2EPNS_7IsolateEjjPhi,
            _ZNK2v86String11WriteUtf8V2EPNS_7IsolateEPcmiPm,
            _ZNK2v86String12Utf8LengthV2EPNS_7IsolateE,
            _ZN2v812api_internal18GlobalizeReferenceEPNS_8internal7IsolateEm,
            _ZN2v812api_internal13DisposeGlobalEPm,
            _ZN2v812api_internal8MakeWeakEPmPvPFvRKNS_16WeakCallbackInfoIvEEENS_16WeakCallbackTypeE,
            _ZN2v812api_internal9ClearWeakEPm,
            _ZN2v812api_internal19MoveGlobalReferenceEPPmS2_,
            _ZN2v812api_internal23GetFunctionTemplateDataEPNS_7IsolateENS_5LocalINS_4DataEEE,
            _ZNK2v88Function7GetNameEv, _ZNK2v85Value10IsFunctionEv, _ZNK2v85Value5IsMapEv,
            _ZNK2v85Value7IsArrayEv, _ZNK2v85Value7IsInt32Ev, _ZNK2v85Value8IsBigIntEv,
            _ZN2v812api_internal17FromJustIsNothingEv, uv_os_getpid, uv_os_getppid,
            _ZN2v87Integer3NewEPNS_7IsolateEi,
            _ZN2v87Integer15NewFromUnsignedEPNS_7IsolateEj,
            _ZNK2v87Integer5ValueEv,
            _ZN2v86String18NewFromUtf8LiteralEPNS_7IsolateEPKcNS_13NewStringTypeEi,
            _ZNK2v85Value12IsUint8ArrayEv,
            _ZNK2v85Value8ToStringENS_5LocalINS_7ContextEEE,
            _ZNK2v85Value9ToIntegerENS_5LocalINS_7ContextEEE,
            _ZN2v87Context6GlobalEv,
            _ZNK2v86Object18InternalFieldCountEv,
            _ZN2v86Object15GetIdentityHashEv,
            _ZN2v86Object17DefineOwnPropertyENS_5LocalINS_7ContextEEENS1_INS_4NameEEENS1_INS_5ValueEEENS_17PropertyAttributeE,
            _ZN2v820ToExternalPointerTagEt,
            _ZN2v88internal9Internals17GetCurrentIsolateEv,
            _ZN2v820HeapObjectStatisticsC1Ev,
            _ZN2v811CpuProfiler3NewEPNS_7IsolateENS_22CpuProfilingNamingModeENS_23CpuProfilingLoggingModeE,
            _ZN2v811CpuProfiler7DisposeEv,
            _ZN2v811CpuProfiler19SetSamplingIntervalEi,
            _ZN2v811CpuProfiler5StartENS_5LocalINS_6StringEEENS_16CpuProfilingModeEbj,
            _ZN2v811CpuProfiler4StopEj,
            _ZN2v811CpuProfiler14StartProfilingENS_5LocalINS_6StringEEENS_16CpuProfilingModeEbj,
            _ZN2v811CpuProfiler14StartProfilingENS_5LocalINS_6StringEEEb,
            _ZN2v811CpuProfiler13StopProfilingENS_5LocalINS_6StringEEE,
            _ZN2v810CpuProfile6DeleteEv,
            _ZNK2v810CpuProfile8GetTitleEv,
            _ZNK2v810CpuProfile10GetEndTimeEv,
            _ZNK2v810CpuProfile12GetStartTimeEv,
            _ZNK2v810CpuProfile14GetTopDownRootEv,
            _ZNK2v810CpuProfile15GetSamplesCountEv,
            _ZNK2v810CpuProfile18GetSampleTimestampEi,
            _ZNK2v810CpuProfile9GetSampleEi,
            _ZNK2v814CpuProfileNode11GetHitCountEv,
            _ZNK2v814CpuProfileNode11GetScriptIdEv,
            _ZNK2v814CpuProfileNode12GetLineTicksEPNS0_8LineTickEj,
            _ZNK2v814CpuProfileNode13GetLineNumberEv,
            _ZNK2v814CpuProfileNode15GetColumnNumberEv,
            _ZNK2v814CpuProfileNode15GetFunctionNameEv,
            _ZNK2v814CpuProfileNode15GetHitLineCountEv,
            _ZNK2v814CpuProfileNode16GetChildrenCountEv,
            _ZNK2v814CpuProfileNode18GetFunctionNameStrEv,
            _ZNK2v814CpuProfileNode21GetScriptResourceNameEv,
            _ZNK2v814CpuProfileNode8GetChildEi,
            _ZN2v83Map3SetENS_5LocalINS_7ContextEEENS1_INS_5ValueEEES5_,
            _ZN2v83Map6DeleteENS_5LocalINS_7ContextEEENS1_INS_5ValueEEE,
        );
    }
    #[cfg(windows)]
    {
        use v8_api::*;
        keep_symbols!(
            v8_Isolate_TryGetCurrent,
            v8_Isolate_GetCurrent,
            v8_Isolate_GetCurrentContext,
            v8_Isolate_GetEnteredOrMicrotaskContext,
            v8_Isolate_GetContinuationPreservedEmbedderData,
            v8_Isolate_IsInUse,
            v8_Isolate_LowMemoryNotification,
            v8_Isolate_AutomaticallyRestoreInitialHeapLimit,
            v8_Isolate_NumberOfTrackedHeapObjectTypes,
            v8_Isolate_GetHeapObjectStatisticsAtLastGC,
            v8_Isolate_AddGCPrologueCallback,
            v8_Isolate_RemoveGCPrologueCallback,
            v8_Isolate_AddGCEpilogueCallback,
            v8_Isolate_RemoveGCEpilogueCallback,
            v8_Isolate_AddNearHeapLimitCallback,
            v8_Isolate_RemoveNearHeapLimitCallback,
            v8_Isolate_RequestInterrupt,
            v8_Isolate_ThrowException,
            v8_Isolate_ThrowError,
            v8_Exception_Error,
            v8_Exception_TypeError,
            v8_Isolate_GetHeapProfiler,
            v8_HeapProfiler_StartSamplingHeapProfiler,
            v8_HeapProfiler_StopSamplingHeapProfiler,
            v8_HeapProfiler_GetAllocationProfile,
            node_AddEnvironmentCleanupHook,
            node_RemoveEnvironmentCleanupHook,
            node_GetCurrentEventLoop,
            node_AsyncHooksGetExecutionAsyncId,
            node_EmitAsyncInit,
            node_EmitAsyncDestroy,
            node_MakeCallback,
            v8_base_TimeTicks_Now,
            v8_Number_New,
            v8_Number_Value,
            v8_Number_NewFromInt32,
            v8_Number_NewFromUint32,
            v8_String_NewFromUtf8,
            v8_String_WriteUtf8,
            v8_api_internal_ToLocalEmpty,
            v8_String_Length,
            v8_External_New,
            v8_External_Value,
            v8_External_New_tagged,
            v8_External_Value_tagged,
            v8_Object_New,
            v8_Object_Set_key,
            v8_Object_Set_index,
            v8_Object_SetInternalField,
            v8_Object_SlowGetInternalField,
            v8_Object_SetAlignedPointerInInternalField,
            v8_Object_SlowGetAlignedPointerFromInternalField,
            v8_Object_Get_index,
            v8_Object_Get_key,
            v8_HandleScope_CreateHandle,
            v8_HandleScope_Extend,
            v8_HandleScope_DeleteExtensions,
            v8_HandleScope_ctor,
            v8_HandleScope_dtor,
            v8_FunctionTemplate_GetFunction,
            v8_FunctionTemplate_SetClassName,
            v8_FunctionTemplate_New,
            v8_ObjectTemplate_NewInstance,
            v8_ObjectTemplate_SetInternalFieldCount,
            v8_ObjectTemplate_InternalFieldCount,
            v8_ObjectTemplate_New,
            v8_FunctionTemplate_InstanceTemplate,
            v8_FunctionTemplate_PrototypeTemplate,
            v8_Template_Set,
            v8_Template_SetNativeDataProperty,
            v8_Signature_New,
            v8_EscapableHandleScopeBase_EscapeSlot,
            v8_EscapableHandleScopeBase_ctor,
            v8_internal_IsolateFromNeverReadOnlySpaceObject,
            v8_Array_New_elements,
            v8_Array_Length,
            v8_Array_New_len,
            v8_Array_New_fn,
            v8_Array_Iterate,
            v8_Array_CheckCast,
            v8_Function_SetName,
            v8_Function_Call,
            v8_Function_NewInstance,
            v8_Function_NewInstance_noargs,
            v8_Object_GetAlignedPointerFromInternalField,
            v8_Value_IsBoolean,
            v8_Boolean_Value,
            v8_Value_FullIsTrue,
            v8_Value_FullIsFalse,
            v8_EscapableHandleScope_dtor,
            v8_EscapableHandleScope_ctor,
            v8_Value_IsObject,
            v8_Value_IsNumber,
            v8_Value_IsUint32,
            v8_Value_Uint32Value,
            v8_Value_IsUndefined,
            v8_Value_IsNull,
            v8_Value_IsNullOrUndefined,
            v8_Value_IsTrue,
            v8_Value_IsFalse,
            v8_Value_IsString,
            v8_Value_StrictEquals,
            v8_Boolean_New,
            v8_Object_GetInternalField,
            v8_Context_GetIsolate,
            v8_String_NewFromOneByte,
            v8_String_IsExternal,
            v8_String_IsExternalOneByte,
            v8_String_IsExternalTwoByte,
            v8_String_IsOneByte,
            v8_String_Utf8Length,
            v8_String_ContainsOnlyOneByte,
            v8_String_WriteV2,
            v8_String_WriteOneByteV2,
            v8_String_WriteUtf8V2,
            v8_String_Utf8LengthV2,
            v8_api_internal_GlobalizeReference,
            v8_api_internal_DisposeGlobal,
            v8_api_internal_MakeWeak,
            v8_api_internal_ClearWeak,
            v8_api_internal_MoveGlobalReference,
            v8_api_internal_GetFunctionTemplateData,
            v8_Function_GetName,
            v8_Value_IsFunction,
            v8_Value_IsMap,
            v8_Value_IsArray,
            v8_Value_IsInt32,
            v8_Value_IsBigInt,
            v8_api_internal_FromJustIsNothing,
            v8_Integer_New,
            v8_Integer_NewFromUnsigned,
            v8_Integer_Value,
            v8_BigInt_New,
            v8_String_NewFromUtf8Literal,
            v8_Value_IsUint8Array,
            v8_Value_ToString,
            v8_Value_ToInteger,
            v8_Context_Global,
            v8_Object_InternalFieldCount,
            v8_Object_GetIdentityHash,
            v8_Object_DefineOwnProperty,
            v8_ToExternalPointerTag,
            v8_internal_Internals_GetCurrentIsolate,
            v8_HeapObjectStatistics_ctor,
            v8_ArrayBuffer_New,
            v8_ArrayBuffer_GetBackingStore,
            v8_BackingStore_Data,
            v8_ArrayBufferView_Buffer,
            v8_ArrayBufferView_ByteLength,
            v8_ArrayBufferView_ByteOffset,
            v8_Uint8Array_New,
            v8_Uint32Array_New,
            v8_CpuProfiler_New,
            v8_CpuProfiler_Dispose,
            v8_CpuProfiler_SetSamplingInterval,
            v8_CpuProfiler_Start,
            v8_CpuProfiler_Stop,
            v8_CpuProfiler_StartProfiling_mode,
            v8_CpuProfiler_StartProfiling,
            v8_CpuProfiler_StopProfiling,
            v8_CpuProfiler_CollectSample,
            v8_CpuProfile_Delete,
            v8_CpuProfile_GetTitle,
            v8_CpuProfile_GetEndTime,
            v8_CpuProfile_GetStartTime,
            v8_CpuProfile_GetTopDownRoot,
            v8_CpuProfile_GetSamplesCount,
            v8_CpuProfile_GetSampleTimestamp,
            v8_CpuProfile_GetSample,
            v8_CpuProfileNode_GetHitCount,
            v8_CpuProfileNode_GetScriptId,
            v8_CpuProfileNode_GetLineTicks,
            v8_CpuProfileNode_GetLineNumber,
            v8_CpuProfileNode_GetColumnNumber,
            v8_CpuProfileNode_GetFunctionName,
            v8_CpuProfileNode_GetHitLineCount,
            v8_CpuProfileNode_GetChildrenCount,
            v8_CpuProfileNode_GetFunctionNameStr,
            v8_CpuProfileNode_GetScriptResourceName,
            v8_CpuProfileNode_GetChild,
            v8_Map_Set,
            v8_Map_Delete,
        );
    }

    // posix_platform_specific_v8_apis
    #[cfg(all(not(windows), target_os = "android"))]
    keep_symbols!(
        posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt6__ndk18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE,
        posix_platform_specific_v8_apis::_ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt6__ndk18optionalImEE,
        posix_platform_specific_v8_apis::_ZN2v86BigInt3NewEPNS_7IsolateEl,
        posix_platform_specific_v8_apis::_ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE,
    );
    #[cfg(all(not(windows), target_os = "macos"))]
    keep_symbols!(
        posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE,
        posix_platform_specific_v8_apis::_ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt3__18optionalIyEE,
        posix_platform_specific_v8_apis::_ZN2v86BigInt3NewEPNS_7IsolateEx,
        posix_platform_specific_v8_apis::_ZN2v812HeapProfiler25StartSamplingHeapProfilerEyiNS0_13SamplingFlagsE,
    );
    #[cfg(all(not(windows), target_os = "freebsd"))]
    keep_symbols!(
        posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmNSt3__18functionIFNS_10MaybeLocalINS_5ValueEEEvEEE,
        posix_platform_specific_v8_apis::_ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateENSt3__18optionalImEE,
        posix_platform_specific_v8_apis::_ZN2v86BigInt3NewEPNS_7IsolateEl,
        posix_platform_specific_v8_apis::_ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE,
    );
    #[cfg(all(
        not(windows),
        not(target_os = "android"),
        not(target_os = "macos"),
        not(target_os = "freebsd")
    ))]
    keep_symbols!(
        posix_platform_specific_v8_apis::_ZN2v85Array3NewENS_5LocalINS_7ContextEEEmSt8functionIFNS_10MaybeLocalINS_5ValueEEEvEE,
        posix_platform_specific_v8_apis::_ZN2v811CpuProfiler13CollectSampleEPNS_7IsolateESt8optionalImE,
        posix_platform_specific_v8_apis::_ZN2v86BigInt3NewEPNS_7IsolateEl,
        posix_platform_specific_v8_apis::_ZN2v812HeapProfiler25StartSamplingHeapProfilerEmiNS0_13SamplingFlagsE,
    );

    keep_symbols!(crate::node::buffer::BufferVectorized::fill);
}

// ──────────────────────────────────────────────────────────────────────────
// NapiFinalizerTask
// ──────────────────────────────────────────────────────────────────────────

pub(crate) struct NapiFinalizerTask {
    pub(crate) finalizer: Finalizer,
}

impl NapiFinalizerTask {
    pub(crate) fn init(finalizer: Finalizer) -> Box<NapiFinalizerTask> {
        Box::new(NapiFinalizerTask { finalizer })
    }

    pub(crate) fn schedule(self: Box<Self>) {
        // SAFETY: env is valid (held by NapiEnvRef).
        let global_this = unsafe { &*self.finalizer.env.get() }.to_js();

        // Inline of `JSGlobalObject::try_bun_vm` (the full impl lives in the
        // gated `JSGlobalObject.rs`): the VM pointer is fetched unconditionally
        // from C++; "main thread" is determined by whether the thread-local VM
        // holder is populated.
        // SAFETY: `bun_vm()` returns a valid `*mut VirtualMachine` for this global.
        let vm: &VirtualMachine = global_this.bun_vm();
        let is_main_thread = VirtualMachine::get_or_null().is_some();

        if !is_main_thread {
            // Off the JS thread (e.g. an external buffer finalized from a GC
            // helper thread): post through the env's VM handle. If the VM is
            // already torn down the finalizer can never run; free the task but
            // not the env ref — the env's count is not atomic and the env goes
            // with its VM — as the cleanup-hooks-already-ran case below does.
            // SAFETY: env is valid (held by NapiEnvRef).
            let handle = unsafe { &*self.finalizer.env.get() }.vm_handle().clone();
            let this = bun_core::heap::into_raw(self);
            let ct = ConcurrentTask::create(Task::init(this));
            if let bun_jsc::vm_handle::Posted::Refused(ct) =
                handle.post(bun_jsc::LoopKind::Regular, ct)
            {
                // SAFETY: refused ⇒ we own both boxes.
                unsafe {
                    drop(bun_core::heap::take(ct.as_ptr()));
                    let task = bun_core::heap::take(this);
                    let _ = core::mem::ManuallyDrop::new(task.finalizer.env);
                }
            }
            return;
        }

        if vm.is_shutting_down() {
            if vm.has_run_cleanup_hooks() {
                // `on_exit()` already drained cleanup hooks; we are inside the
                // final `collectNow()` (Heap::sweepArrayBuffers) and the JSC
                // VM is being torn down. The cleanup-hook list will never be
                // walked again, and running the user finalizer here (mid-GC,
                // with the global about to be freed) is unsafe. Drop the task
                // so the `Box<NapiFinalizerTask>` and its `NapiEnvRef` are
                // released; the addon's external data is reclaimed by the OS
                // at process exit.
                drop(self);
                return;
            }
            // Immediate tasks won't run, so we run this as a cleanup hook instead
            let this = bun_core::heap::into_raw(self);
            global_this.bun_vm().as_mut().rare_data().push_cleanup_hook(
                vm.global(),
                this.cast::<c_void>(),
                Self::run_as_cleanup_hook,
            );
        } else {
            let this = bun_core::heap::into_raw(self);
            vm.event_loop_ref().enqueue_task(Task::init(this));
        }
    }

    // Forwards `this` to `heap::take` without dereferencing it here;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn run_on_js_thread(this: *mut NapiFinalizerTask) -> JsResult<()> {
        // SAFETY: `this` was created by heap::alloc in `schedule`.
        let mut this_box = unsafe { bun_core::heap::take(this) };
        this_box.finalizer.run()
        // finalizer.deinit() runs via Drop on NapiEnvRef when this_box drops.
    }

    extern "C" fn run_as_cleanup_hook(opaque_this: *mut c_void) {
        // SAFETY: opaque_this is the *mut NapiFinalizerTask we registered above (non-null).
        let this: *mut NapiFinalizerTask = opaque_this.cast();
        // A cleanup hook returns nothing: `Err` is left pending for the hook
        // runner's fold.
        let _ = Self::run_on_js_thread(this);
    }
}
