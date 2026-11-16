//! Node-API (N-API) implementation.

use core::cell::{Cell, UnsafeCell};
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ptr;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;

use bun_collections::LinearFifo;
use bun_collections::linear_fifo::DynamicBuffer;
use bun_core::Unaligned;
use bun_event_loop::{BoxedTask, TaskTag, Taskable, task_tag};
use bun_io::{JsKeepAlive, KeepAlive};
use bun_jsc::StringJsc;
use bun_jsc::bun_string_jsc;
use bun_jsc::event_loop::{ConcurrentTaskItem as ConcurrentTask, EventLoop};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, Debugger, JSGlobalObject, JSPromiseStrong, JSValue, JsResult, StrongOptional,
    Task, VmBound,
};
use bun_ptr::CellExt;
use bun_threading::Condition as Condvar;
use bun_threading::guarded::GuardedLock;
use bun_threading::work_pool::{IntrusiveWorkTask as _, Task as WorkPoolTask, WorkPool};
use bun_threading::{Guarded, Mutex};

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

impl Taskable for napi_async_work {
    const TAG: TaskTag = task_tag::NapiAsyncWork;
    /// Work the pool handed back during teardown: its `complete` callback is
    /// how the addon learns the outcome and frees the work (Node calls it from
    /// environment cleanup too); script it tries to run is refused at the boundary.
    unsafe fn release_unrun(this: *mut Self) {
        let global = VirtualMachine::get().global();
        // `Err` is left pending for the release dispatcher's fold.
        // SAFETY: fn contract — the addon's live work object the pool posted.
        let _ = unsafe { Self::run_from_js(this, global) };
    }
    /// An addon's completion always runs (it frees the work there): `NapiEnv::complete_in_context`
    /// enters the context that queued it, and refuses calls into script if that context has stopped.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
/// The queued pointer is from `Arc::into_raw`.
impl Taskable for ThreadSafeFunction {
    const TAG: TaskTag = task_tag::ThreadSafeFunction;
    /// The env's cleanup hook (`env_teardown`) does what the dispatch would have done.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the task owns this reference.
        drop(unsafe { Arc::from_raw(this) });
    }
    /// As `napi_async_work`.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
impl BoxedTask for TsfnRefRequest {
    const TAG: TaskTag = task_tag::ThreadSafeFunctionRefRequest;
    fn release_unrun(self: Box<Self>) {}
    /// As `napi_async_work`.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
impl BoxedTask for NapiFinalizerTask {
    const TAG: TaskTag = task_tag::NapiFinalizerTask;
    /// A finalizer queued before the loop stopped: Node runs an addon's
    /// finalizers during environment cleanup (script already forbidden), and
    /// an addon counts on them (external buffers freed when a Worker exits).
    fn release_unrun(self: Box<Self>) {
        // `Err` is left pending for the release dispatcher's fold.
        let _ = self.finalizer.run();
    }
    /// An addon counts on its finalizers running.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
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
    /// Returns the previous value.
    fn NapiEnv__setCompletingForStoppedContext(env: *mut NapiEnv, value: bool) -> bool;
    /// `NapiStatus::ok`, or the status Node's `NAPI_PREAMBLE` returns at entry (`NapiEnv::entryStatus`).
    fn NapiEnv__entryStatus(env: *mut NapiEnv) -> napi_status;
    /// `NapiEnv::cleanup` runs no finalizer until each of these has its `NapiEnv__asyncWorkLeftThreadPool`.
    fn NapiEnv__asyncWorkEnteredThreadPool(env: *mut NapiEnv);
    fn NapiEnv__asyncWorkLeftThreadPool(env: *mut NapiEnv);
    fn NapiEnv__deref(env: *mut NapiEnv);
    fn NapiEnv__ref(env: *mut NapiEnv);
    /// The reference to its VM's handle the env holds (`BunVmHandleRef`).
    fn NapiEnv__vmHandle(env: *mut NapiEnv) -> *const bun_jsc::vm_handle::Shared;
    fn napi_set_last_error(env: napi_env, status: napi_status) -> napi_status;
    fn NapiUngatedScope__construct(storage: *mut c_void, env: *mut NapiEnv);
    fn NapiUngatedScope__destruct(storage: *mut c_void);
}

impl NapiEnv {
    pub(crate) fn to_js(&self) -> &JSGlobalObject {
        // SAFETY: NapiEnv__globalObject always returns a valid non-null pointer.
        unsafe { &*NapiEnv__globalObject(self.as_mut_ptr()) }
    }

    fn ref_(&self) -> NapiEnvRef {
        // SAFETY: `self` is a live C++-owned napi_env. Its count is not atomic, and `&NapiEnv` is not
        // `Send`: it is made on the JS thread, or on the collector's while that thread is stopped.
        unsafe { NapiEnvRef::clone_from_raw(self.as_mut_ptr()) }
    }

    /// Any thread holding an env ref: the env's VM handle.
    pub(crate) fn vm_handle(&self) -> bun_jsc::VmHandle {
        // SAFETY: the env holds a reference for its whole lifetime.
        unsafe { bun_jsc::VmHandle::borrow_ref(NapiEnv__vmHandle(self.as_mut_ptr())) }.clone()
    }

    /// Convert err to an extern napi_status, and store the error code in env so that it can be
    /// accessed by napi_get_last_error_info
    pub(crate) fn set_last_error(self_: Option<&Self>, err: NapiStatus) -> napi_status {
        // SAFETY: napi_set_last_error accepts null env.
        unsafe {
            napi_set_last_error(
                self_.map(Self::as_mut_ptr).unwrap_or(ptr::null_mut()),
                err as napi_status,
            )
        }
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

    pub(crate) fn cannot_run_js(&self) -> napi_status {
        Self::set_last_error(Some(self), NapiStatus::cannot_run_js)
    }

    /// Runs `completion` (an addon's `complete` or `call_js`) in `context`, the one whose script
    /// asked for the work: what the callback opens is that context's. Once the context has
    /// stopped the callback still runs, since it owns memory only it can free, but functions
    /// that would run script answer it as they do in a VM that is stopping.
    pub(crate) fn complete_in_context(
        &self,
        context: bun_jsc::ContextId,
        completion: impl FnOnce(),
    ) {
        let vm = self.to_js().bun_vm();
        let stopped = !vm.is_context_live(context);
        let _context = vm.enter_context(context);
        // SAFETY: `self` is a live C++-owned napi_env; JS thread.
        let previous =
            unsafe { NapiEnv__setCompletingForStoppedContext(self.as_mut_ptr(), stopped) };
        completion();
        // SAFETY: as above; the env outlives its completions (the caller holds a ref).
        unsafe { NapiEnv__setCompletingForStoppedContext(self.as_mut_ptr(), previous) };
    }

    /// Node's `NAPI_PREAMBLE` entry check (napi.h `NapiEnv::entryStatus`). `Err` is the status Node
    /// returns, set as the last error.
    pub(crate) fn entry_status(&self) -> Result<(), napi_status> {
        // SAFETY: env is non-null; C++ side is read-only here.
        let status = unsafe { NapiEnv__entryStatus(self.as_mut_ptr()) };
        if status == NapiStatus::ok as napi_status {
            return Ok(());
        }
        // SAFETY: env is non-null.
        Err(unsafe { napi_set_last_error(self.as_mut_ptr(), status) })
    }

    /// Assert that we're not currently performing garbage collection
    pub(crate) fn check_gc(&self) {
        Bun__napi_check_gc(self);
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
/// a Rust API that uses a never-null napi_env, use `&NapiEnv`; an entry point written in Rust takes `Option<&NapiEnv>`.
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
    safe fn NapiHandleScope__escape(handle_scope: &NapiHandleScope, value: JSValue) -> bool;
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
        // SAFETY: C++ dereferences `self_` only once it has found it to be the env's current scope.
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
        if !NapiHandleScope__escape(self, value) {
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
pub(super) type napi_callback_info = *mut c_void;
/// What `napi_create_promise` hands the addon.
pub(crate) struct Deferred {
    promise: JSPromiseStrong,
    /// The context whose script made the promise: settling it once that context has stopped
    /// settles nothing, whichever completion the addon does it from.
    context: bun_jsc::ContextId,
}
type napi_deferred = *mut Deferred;

/// A box that the addon hands back. It stays the addon's if the call is refused.
type AddonBox<T> = ManuallyDrop<Box<T>>;

// ──────────────────────────────────────────────────────────────────────────
// napi_value
// ──────────────────────────────────────────────────────────────────────────

/// To ensure napi_values are not collected prematurely after being returned into a native module,
/// you must use these functions rather than convert between napi_value and jsc::JSValue directly
#[repr(transparent)]
#[derive(Copy, Clone)]
pub(crate) struct napi_value(i64);

impl napi_value {
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

/// The `napi_status` values (js_native_api_types.h) Rust produces. A status that comes from C++ is a
/// `napi_status`, the integer: it can be any of them. The ones commented out are the values Rust
/// does not produce yet; uncomment one to use it.
#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum NapiStatus {
    ok = 0,
    invalid_arg = 1,
    object_expected = 2,
    // string_expected = 3,
    // name_expected = 4,
    function_expected = 5,
    // number_expected = 6,
    // boolean_expected = 7,
    array_expected = 8,
    generic_failure = 9,
    pending_exception = 10,
    cancelled = 11,
    escape_called_twice = 12,
    // handle_scope_mismatch = 13,
    // callback_scope_mismatch = 14,
    queue_full = 15,
    closing = 16,
    // bigint_expected = 17,
    // date_expected = 18,
    // arraybuffer_expected = 19,
    // detachable_arraybuffer_expected = 20,
    // would_deadlock = 21,
    // no_external_buffers_allowed = 22,
    cannot_run_js = 23,
}

/// This is not an `enum` so that the enum values cannot be trivially returned from NAPI functions,
/// as that would skip storing the last error code. You should wrap return values in a call to
/// NapiEnv::set_last_error.
pub(super) type napi_status = c_uint;

pub(super) type napi_callback = Option<extern "C" fn(napi_env, napi_callback_info) -> napi_value>;

/// expects `napi_env`, `callback_data`, `context`
pub(super) type NapiFinalizeFunction = unsafe extern "C" fn(napi_env, *mut c_void, *mut c_void);
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
        match $env {
            Some(e) => e,
            None => return env_is_null(),
        }
    };
}

/// Node's `NAPI_PREAMBLE`: `get_env!`, then [`NapiEnv::entry_status`].
macro_rules! preamble {
    ($env:expr) => {{
        let env = get_env!($env);
        if let Err(status) = env.entry_status() {
            return status;
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

/// Where an addon wants a result. It can be uninitialized, and it can alias another argument.
#[repr(transparent)]
struct Out<T>(Cell<MaybeUninit<T>>);

impl<T> Out<T> {
    fn write(&self, value: T) {
        self.0.set(MaybeUninit::new(value));
    }
}

impl Out<napi_value> {
    fn set(&self, env: &NapiEnv, val: JSValue) {
        self.write(napi_value::create(env, val));
    }
}

macro_rules! get_out {
    ($env:expr, $out:expr) => {
        match $out {
            Some(r) => r,
            None => return $env.invalid_arg(),
        }
    };
}

/// For the "info" entry points, where `NULL` means that the addon does not want this field.
#[inline]
fn write_out<T>(out: Option<&Out<T>>, v: T) {
    if let Some(out) = out {
        out.write(v);
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
extern "C" fn napi_get_undefined(
    env_: Option<&NapiEnv>,
    result_: Option<&Out<napi_value>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_undefined");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::UNDEFINED);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_null(
    env_: Option<&NapiEnv>,
    result_: Option<&Out<napi_value>>,
) -> napi_status {
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
    env_: Option<&NapiEnv>,
    value: u8,
    result_: Option<&Out<napi_value>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_boolean");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::from(value != 0));
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_array(
    env_: Option<&NapiEnv>,
    result_: Option<&Out<napi_value>>,
) -> napi_status {
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
    env_: Option<&NapiEnv>,
    length: usize,
    result_: Option<&Out<napi_value>>,
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
    env_: Option<&NapiEnv>,
    value: i32,
    result_: Option<&Out<napi_value>>,
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
    env_: Option<&NapiEnv>,
    value: u32,
    result_: Option<&Out<napi_value>>,
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
    env_: Option<&NapiEnv>,
    value: i64,
    result_: Option<&Out<napi_value>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_int64");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.set(env, JSValue::js_number(value as f64));
    env.ok()
}

/// # Safety
/// `str_` is null, or points to `length` bytes, or to a C string for `NAPI_AUTO_LENGTH`.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_create_string_latin1(
    env_: Option<&NapiEnv>,
    str_: *const u8,
    length: usize,
    result_: Option<&Out<napi_value>>,
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

/// # Safety
/// `str_` is null, or points to `length` bytes, or to a C string for `NAPI_AUTO_LENGTH`.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_create_string_utf8(
    env_: Option<&NapiEnv>,
    str_: *const u8,
    length: usize,
    result_: Option<&Out<napi_value>>,
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

/// # Safety
/// As [`napi_create_string_utf8`], in units of two bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_create_string_utf16(
    env_: Option<&NapiEnv>,
    // Addons pass the bytes of a `Buffer`, which can start anywhere.
    str_: *const Unaligned<char16_t>,
    length: usize,
    result_: Option<&Out<napi_value>>,
) -> napi_status {
    ungated!(env, env_);
    let result = get_out!(env, result_);

    let slice: &[Unaligned<char16_t>] = 'brk: {
        if !str_.is_null() {
            if NAPI_AUTO_LENGTH == length {
                // SAFETY: caller guarantees ptr is NUL-terminated when length == NAPI_AUTO_LENGTH.
                // Scan to the NUL u16 terminator.
                break 'brk unsafe {
                    bun_core::ffi::slice(str_, bun_core::ffi::wcslen(str_.cast()))
                };
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

    if slice.is_empty() {
        result.set(env, JSValue::js_empty_string(env.to_js()));
        return env.ok();
    }

    let (string, chars) = bun_core::String::create_uninitialized_utf16(slice.len());
    bun_core::slice_as_bytes_mut(chars).copy_from_slice(bun_core::slice_as_bytes(slice));

    if cfg!(debug_assertions) {
        bun_output::scoped_log!(
            napi,
            "napi_create_string_utf16: {} {}",
            chars.len(),
            bun_core::fmt::utf16(&chars[..chars.len().min(512)])
        );
    }

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
    env_: Option<&NapiEnv>,
    object_: napi_value,
    result_: Option<&Out<napi_value>>,
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
extern "C" fn napi_is_array(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Option<&Out<bool>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_array");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    result.write(value.js_type().is_array());
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_array_length(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Option<&Out<u32>>,
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

    result.write(match value.get_length(env.to_js()) {
        Ok(len) => len as u32, // intentional truncation
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    });
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_strict_equals(
    env_: Option<&NapiEnv>,
    lhs_: napi_value,
    rhs_: napi_value,
    result_: Option<&Out<bool>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_strict_equals");
    let env = preamble!(env_);
    let result = get_out!(env, result_);
    let (lhs, rhs) = (lhs_.get(), rhs_.get());
    if lhs.is_empty() || rhs.is_empty() {
        return env.invalid_arg();
    }
    result.write(match lhs.is_strict_equal(rhs, env.to_js()) {
        Ok(b) => b,
        Err(_) => return NapiEnv::set_last_error(Some(env), NapiStatus::pending_exception),
    });
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
    env_: Option<&NapiEnv>,
    result_: Option<&Out<napi_handle_scope>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.write(NapiHandleScope::open(env, false));
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_close_handle_scope(
    env_: Option<&NapiEnv>,
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
    env_: Option<&NapiEnv>,
    _async_resource: napi_value,
    _async_resource_name: napi_value,
    async_ctx_: Option<&Out<*mut c_void>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_async_init");
    let env = get_env!(env_);
    let async_ctx = get_out!(env, async_ctx_);
    async_ctx.write(env.as_mut_ptr().cast::<c_void>());
    env.ok()
}

// we don't support async contexts
#[unsafe(no_mangle)]
extern "C" fn napi_async_destroy(env_: Option<&NapiEnv>, _async_ctx: *mut c_void) -> napi_status {
    bun_output::scoped_log!(napi, "napi_async_destroy");
    let env = get_env!(env_);
    env.ok()
}

// this is just a regular function call
/// # Safety
/// `args` is null, or points to `arg_count` values that nothing writes while the callee runs.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_make_callback(
    env_: Option<&NapiEnv>,
    _async_ctx: *mut c_void,
    recv_: napi_value,
    func_: napi_value,
    arg_count: usize,
    args: *const napi_value,
    maybe_result: Option<&Out<napi_value>>,
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

    if let Some(result) = maybe_result {
        result.set(env, res);
    }

    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_open_escapable_handle_scope(
    env_: Option<&NapiEnv>,
    result_: Option<&Out<napi_escapable_handle_scope>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_escapable_handle_scope");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    result.write(NapiHandleScope::open(env, true));
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_close_escapable_handle_scope(
    env_: Option<&NapiEnv>,
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
    env_: Option<&NapiEnv>,
    scope_: Option<&NapiHandleScope>,
    escapee: napi_value,
    result_: Option<&Out<napi_value>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_escape_handle");
    ungated!(env, env_);
    env.check_gc();
    let result = get_out!(env, result_);
    let Some(scope) = scope_ else {
        return env.invalid_arg();
    };
    if scope.escape(escapee.get()).is_err() {
        return NapiEnv::set_last_error(Some(env), NapiStatus::escape_called_twice);
    }
    result.write(escapee);
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
    _env: Option<&NapiEnv>,
    _resource: napi_value,
    _context: *mut c_void,
    _result: *mut c_void,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_open_callback_scope");
    NapiStatus::ok as napi_status
}

#[unsafe(no_mangle)]
extern "C" fn napi_close_callback_scope(
    _env: Option<&NapiEnv>,
    _scope: *mut c_void,
) -> napi_status {
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
extern "C" fn napi_is_error(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Option<&Out<bool>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_error");
    ungated!(env, env_);
    env.check_gc();
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    let result = get_out!(env, result_);
    result.write(value.is_any_error());
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
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Option<&Out<bool>>,
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
    result.write(
        value
            .as_array_buffer(env.to_js())
            .is_some_and(|ab| ab.typed_array_type == jsc::JSType::ArrayBuffer && !ab.shared),
    );
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
    env_: Option<&NapiEnv>,
    arraybuffer_: napi_value,
    data: Option<&Out<*mut u8>>,
    byte_length: Option<&Out<usize>>,
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
    env_: Option<&NapiEnv>,
    typedarray_: napi_value,
    maybe_type: Option<&Out<napi_typedarray_type>>,
    maybe_length: Option<&Out<usize>>,
    maybe_data: Option<&Out<*mut u8>>,
    maybe_arraybuffer: Option<&Out<napi_value>>,
    maybe_byte_offset: Option<&Out<usize>>,
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
    if maybe_data.is_some() && !typedarray.materialize_array_buffer_view_buffer() {
        return env.generic_failure();
    }

    let Some(array_buffer) = typedarray.as_array_buffer(env.to_js()) else {
        return env.invalid_arg();
    };
    if let Some(ty) = maybe_type {
        // The `ArrayBuffer.typed_array_type` field is already a `JSType`, so map it
        // straight to `napi_typedarray_type`.
        let Some(napi_ty) = napi_typedarray_type::from_js_type(array_buffer.typed_array_type)
        else {
            return env.invalid_arg();
        };
        ty.write(napi_ty);
    }

    // TODO: handle detached
    write_out(maybe_data, array_buffer.ptr);
    write_out(maybe_length, array_buffer.len);

    if let Some(arraybuffer) = maybe_arraybuffer {
        arraybuffer.set(env, typedarray.get_array_buffer_view_buffer(env.to_js()));
    }

    if let Some(byte_offset) = maybe_byte_offset {
        byte_offset.write(typedarray.get_array_buffer_view_byte_offset());
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
    env_: Option<&NapiEnv>,
    value_: napi_value,
    result_: Option<&Out<bool>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_dataview");
    ungated!(env, env_);
    let result = get_out!(env, result_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    result.write(
        !value.is_empty_or_undefined_or_null() && value.js_type_loose() == jsc::JSType::DataView,
    );
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_dataview_info(
    env_: Option<&NapiEnv>,
    dataview_: napi_value,
    maybe_bytelength: Option<&Out<usize>>,
    maybe_data: Option<&Out<*mut u8>>,
    maybe_arraybuffer: Option<&Out<napi_value>>,
    maybe_byte_offset: Option<&Out<usize>>,
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
    if let Some(arraybuffer) = maybe_arraybuffer {
        arraybuffer.set(env, dataview.get_array_buffer_view_buffer(env.to_js()));
    }
    if let Some(byte_offset) = maybe_byte_offset {
        byte_offset.write(dataview.get_array_buffer_view_byte_offset());
    }

    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_version(env_: Option<&NapiEnv>, result_: Option<&Out<u32>>) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_version");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    // The result is supposed to be the highest NAPI version Bun supports, rather than the version reported by a NAPI module.
    // Keep this in sync with process.versions.napi in BunProcess.cpp.
    result.write(10);
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_create_promise(
    env_: Option<&NapiEnv>,
    deferred_: Option<&Out<napi_deferred>>,
    promise_: Option<&Out<napi_value>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_promise");
    let env = preamble!(env_);
    let deferred = get_out!(env, deferred_);
    let promise = get_out!(env, promise_);
    let strong = Box::new(Deferred {
        promise: JSPromiseStrong::init(env.to_js()),
        context: env.to_js().bun_vm().context_of_caller().id(),
    });
    let prom_value = strong.promise.value();
    deferred.write(bun_core::heap::into_raw(strong));
    promise.set(env, prom_value);
    env.ok()
}

/// `napi_resolve_deferred` / `napi_reject_deferred`. A deferred is settled for the context whose
/// script made it, whichever completion the addon does it from.
fn conclude_deferred(
    env: &NapiEnv,
    deferred: Option<AddonBox<Deferred>>,
    settle: impl FnOnce(&mut jsc::JSPromise, &JSGlobalObject) -> JsResult<()>,
) -> napi_status {
    let Some(deferred) = deferred else {
        return env.invalid_arg();
    };
    let context = deferred.context;
    if !env.to_js().bun_vm().is_context_live(context) {
        // Of a Bun.ModuleGraph that has been disposed: released, and nothing is settled.
        drop(ManuallyDrop::into_inner(deferred));
        return env.ok();
    }
    let mut status = env.ok();
    env.complete_in_context(context, || {
        if let Err(refused) = env.entry_status() {
            status = refused;
            return;
        }
        let deferred_box = ManuallyDrop::into_inner(deferred);
        if settle(deferred_box.promise.get(), env.to_js()).is_err() {
            status = env.generic_failure();
        }
    });
    status
}

#[unsafe(no_mangle)]
extern "C" fn napi_resolve_deferred(
    env_: Option<&NapiEnv>,
    deferred: Option<AddonBox<Deferred>>,
    resolution_: napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_resolve_deferred");
    let env = get_env!(env_);
    let resolution = resolution_.get();
    conclude_deferred(env, deferred, |promise, global| {
        promise.resolve(global, resolution)
    })
}

#[unsafe(no_mangle)]
extern "C" fn napi_reject_deferred(
    env_: Option<&NapiEnv>,
    deferred: Option<AddonBox<Deferred>>,
    rejection_: napi_value,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_reject_deferred");
    let env = get_env!(env_);
    let rejection = rejection_.get();
    conclude_deferred(env, deferred, |promise, global| {
        promise.reject(global, Ok(rejection))
    })
}

#[unsafe(no_mangle)]
extern "C" fn napi_is_promise(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    is_promise_: Option<&Out<bool>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_promise");
    ungated!(env, env_);
    env.check_gc();
    let value = value_.get();
    let is_promise = get_out!(env, is_promise_);

    if value.is_empty() {
        return env.invalid_arg();
    }

    is_promise.write(value.as_any_promise().is_some());
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
extern "C" fn napi_create_date(
    env_: Option<&NapiEnv>,
    time: f64,
    result_: Option<&Out<napi_value>>,
) -> napi_status {
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
extern "C" fn napi_is_date(
    env_: Option<&NapiEnv>,
    value_: napi_value,
    is_date_: Option<&Out<bool>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_is_date");
    ungated!(env, env_);
    env.check_gc();
    let is_date = get_out!(env, is_date_);
    let value = value_.get();
    if value.is_empty() {
        return env.invalid_arg();
    }
    is_date.write(value.js_type_loose() == jsc::JSType::JSDate);
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
    /// Only the pool thread uses it between `schedule` and the post back.
    off_thread: UnsafeCell<AsyncWorkOffThread>,
    status: AtomicU32, // AsyncWorkStatus
    data: *mut c_void,
    /// Taken by `run_from_js`, which needs the env for longer than the work lives.
    env: Cell<Option<NapiEnvRef>>,
    complete: Option<napi_async_complete_callback>,
    scheduled: Cell<bool>,
    poll_ref: Cell<JsKeepAlive>,
    /// The context whose script created the work: `complete` runs in it.
    context: bun_jsc::ContextId,
}

struct AsyncWorkOffThread {
    task: WorkPoolTask,
    concurrent_task: ConcurrentTask,
    /// How the pool thread delivers completion / cancellation, and what makes the VM wait for it.
    ticket: Option<bun_jsc::Ticket>,
    env: napi_env,
    execute: napi_async_execute_callback,
}

bun_threading::intrusive_work_task!(AsyncWorkOffThread, task);

impl napi_async_work {
    /// # Safety
    /// As [`napi_create_async_work`].
    unsafe fn new(
        env: &NapiEnv,
        execute: napi_async_execute_callback,
        complete: Option<napi_async_complete_callback>,
        data: *mut c_void,
    ) -> *mut napi_async_work {
        bun_core::heap::into_raw(Box::new(napi_async_work {
            off_thread: UnsafeCell::new(AsyncWorkOffThread {
                task: WorkPoolTask {
                    node: bun_threading::thread_pool::Node::default(),
                    callback: Self::run_from_thread_pool,
                },
                concurrent_task: ConcurrentTask::default(),
                ticket: None,
                env: env.as_mut_ptr(),
                execute,
            }),
            status: AtomicU32::new(AsyncWorkStatus::Pending as u32),
            data,
            env: Cell::new(Some(env.ref_())),
            complete,
            scheduled: Cell::new(false),
            poll_ref: Cell::default(),
            context: env.to_js().bun_vm().context_of_caller().id(),
        }))
    }

    /// Returns false if the VM is closed. The addon still has to delete the work.
    ///
    /// # Safety
    /// As [`napi_queue_async_work`].
    unsafe fn schedule(&self) -> bool {
        if self.scheduled.get() {
            return true;
        }
        let vm = VirtualMachine::get();
        // A finalizer can call this during the GC that destroys the heap.
        if vm.closed() {
            return false;
        }
        self.scheduled.set(true);
        self.poll_ref.set(JsKeepAlive::active());
        // The work object belongs to the addon and `execute` receives this
        // env, so the VM waits for it (Node likewise settles its threadpool
        // requests before an environment is freed).
        let ticket = vm.ticket();
        // Not `.get()`: `run_from_thread_pool` recovers `Self` from this pointer.
        let off_thread = UnsafeCell::raw_get(&raw const self.off_thread);
        // SAFETY: the work was not scheduled, so nothing else has `off_thread`, and `self.env` keeps the env alive.
        unsafe {
            (*off_thread).ticket = Some(ticket);
            NapiEnv__asyncWorkEnteredThreadPool((*off_thread).env);
            WorkPool::schedule(&raw mut (*off_thread).task);
        }
        true
    }

    /// # Safety
    /// `task` is the one that `schedule` handed to the pool.
    unsafe fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: the addon deletes no work before its `complete` is called, and only this thread uses
        // `off_thread`. `napi_cancel_async_work` can be running, so the rest is only shared.
        let (this, off_thread, status, data) = unsafe {
            let off_thread = AsyncWorkOffThread::from_task_ptr(task);
            let this = bun_core::from_field_ptr!(Self, off_thread, off_thread);
            (this, &mut *off_thread, &(*this).status, (*this).data)
        };
        // Moved out: the JS thread may free the work the moment it is posted back.
        let ticket = off_thread
            .ticket
            .take()
            .expect("scheduled napi async work holds a ticket");
        // A VM that is already stopping cancels work it has not started, as
        // Node's environment cleanup does (uv_cancel).
        let started = ticket.script_allowed()
            && match status.compare_exchange(
                AsyncWorkStatus::Pending as u32,
                AsyncWorkStatus::Started as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            ) {
                Ok(_) => true,
                Err(state) => state != AsyncWorkStatus::Cancelled as u32,
            };
        if started {
            // SAFETY: `napi_create_async_work`'s contract. The work keeps the env alive until it is posted back.
            unsafe { (off_thread.execute)(off_thread.env, data) };
            status.store(AsyncWorkStatus::Completed as u32, Ordering::SeqCst);
        } else {
            let _ = Self::cancel(status);
        }
        // SAFETY: as above.
        unsafe { NapiEnv__asyncWorkLeftThreadPool(off_thread.env) };
        // A VM tearing down runs `complete` from its queue release, as Node does at environment cleanup.
        ticket.post_intrusive(ptr::NonNull::from(off_thread.concurrent_task.from(this)));
    }

    fn cancel(status: &AtomicU32) -> bool {
        status
            .compare_exchange(
                AsyncWorkStatus::Pending as u32,
                AsyncWorkStatus::Cancelled as u32,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
    }

    /// # Safety
    /// `this` is the work that the pool posted back, on the thread it was posted to.
    pub(crate) unsafe fn run_from_js(this: *mut Self, global: &JSGlobalObject) -> JsResult<()> {
        let (_poll_ref, env, complete, status, data, context) = {
            // SAFETY: fn contract. The borrow ends here, because `complete` usually deletes the work.
            let work = unsafe { &*this };
            (
                work.poll_ref.take(),
                work.env.take(),
                work.complete,
                work.status.load(Ordering::SeqCst),
                work.data,
                work.context,
            )
        };

        // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1201
        let (Some(complete), Some(env)) = (complete, env) else {
            return Ok(());
        };

        let _hs = NapiHandleScope::open_scoped(&env);

        let status: NapiStatus = if status == AsyncWorkStatus::Cancelled as u32 {
            NapiStatus::cancelled
        } else {
            NapiStatus::ok
        };

        env.complete_in_context(context, || {
            // SAFETY: `napi_create_async_work`'s contract.
            unsafe { complete(env.get(), status as napi_status, data) }
        });

        env.surface_exception(global)
    }
}

type napi_threadsafe_function = *const ThreadSafeFunction;

const NAPI_TSFN_ABORT: c_uint = 1;
type napi_threadsafe_function_release_mode = c_uint;
const NAPI_TSFN_BLOCKING: c_uint = 1;
type napi_threadsafe_function_call_mode = c_uint;
pub(super) type napi_async_execute_callback = unsafe extern "C" fn(napi_env, *mut c_void);
pub(super) type napi_async_complete_callback =
    unsafe extern "C" fn(napi_env, napi_status, *mut c_void);
type napi_threadsafe_function_call_js =
    unsafe extern "C" fn(napi_env, napi_value, AddonData, AddonData);

#[repr(C)]
struct napi_node_version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub release: &'static [u8; 5],
}

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
    release: b"node\0",
};

bun_opaque::opaque_ffi! { pub struct struct_napi_async_cleanup_hook_handle__; }
type napi_async_cleanup_hook_handle = *mut struct_napi_async_cleanup_hook_handle__;
type napi_async_cleanup_hook = Option<extern "C" fn(napi_async_cleanup_hook_handle, *mut c_void)>;

/// # Safety
/// For `'a`, `ptr` is null, or points to `len` bytes, or to a C string for `NAPI_AUTO_LENGTH`.
unsafe fn napi_span<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() {
        return &[];
    }

    if len == NAPI_AUTO_LENGTH {
        // SAFETY: fn contract.
        return unsafe { bun_core::ffi::cstr(ptr.cast::<c_char>()) }.to_bytes();
    }

    // SAFETY: fn contract.
    unsafe { bun_core::ffi::slice(ptr, len) }
}

/// # Safety
/// As [`napi_span`], for both strings.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_fatal_error(
    location_ptr: *const u8,
    location_len: usize,
    message_ptr: *const u8,
    message_len_: usize,
) -> ! {
    bun_output::scoped_log!(napi, "napi_fatal_error");
    Bun__napi_suppress_crash_on_abort_if_desired();
    // SAFETY: fn contract.
    let (mut message, location) = unsafe {
        (
            napi_span(message_ptr, message_len_),
            napi_span(location_ptr, location_len),
        )
    };
    if message.is_empty() {
        message = b"fatal error";
    }

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
    env_: Option<&NapiEnv>,
    value_: napi_value,
    data: Option<&Out<*mut u8>>,
    length: Option<&Out<usize>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_buffer_info");
    ungated!(env, env_);
    let value = value_.get();
    // Keep the pointer valid for the buffer's lifetime, as in Node.
    if data.is_some() && !value.materialize_array_buffer_view_buffer() {
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

/// # Safety
/// `execute_` takes `data` on a pool thread, and `complete` takes it on this one afterwards.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_create_async_work(
    env_: Option<&NapiEnv>,
    _async_resource: napi_value,
    _async_resource_name: *const c_char,
    execute_: Option<napi_async_execute_callback>,
    complete: Option<napi_async_complete_callback>,
    data: *mut c_void,
    result_: Option<&Out<*mut napi_async_work>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_create_async_work");
    let env = get_env!(env_);
    let result = get_out!(env, result_);
    // https://github.com/nodejs/node/blob/a2de5b9150da60c77144bb5333371eaca3fab936/src/node_api.cc#L1245
    let Some(execute) = execute_ else {
        return env.invalid_arg();
    };
    // SAFETY: fn contract.
    result.write(unsafe { napi_async_work::new(env, execute, complete, data) });
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_delete_async_work(
    env_: Option<&NapiEnv>,
    work_: Option<AddonBox<napi_async_work>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_delete_async_work");
    let env = get_env!(env_);
    let Some(work) = work_ else {
        return env.invalid_arg();
    };
    drop(ManuallyDrop::into_inner(work));
    env.ok()
}

/// # Safety
/// The addon does not delete the work before its `complete` is called.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_queue_async_work(
    env_: Option<&NapiEnv>,
    work_: Option<&napi_async_work>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_queue_async_work");
    let env = get_env!(env_);
    let Some(work) = work_ else {
        return env.invalid_arg();
    };
    // SAFETY: fn contract.
    if !unsafe { work.schedule() } {
        return env.cannot_run_js();
    }
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_cancel_async_work(
    env_: Option<&NapiEnv>,
    work_: Option<&napi_async_work>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_cancel_async_work");
    let env = get_env!(env_);
    let Some(work) = work_ else {
        return env.invalid_arg();
    };
    if napi_async_work::cancel(&work.status) {
        return env.ok();
    }

    env.generic_failure()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_node_version(
    env_: Option<&NapiEnv>,
    version_: Option<&Out<*const napi_node_version>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_node_version");
    let env = get_env!(env_);
    let version = get_out!(env, version_);
    version.write(&raw const NAPI_NODE_VERSION_GLOBAL);
    env.ok()
}

#[cfg(windows)]
type napi_event_loop = *mut bun_sys::windows::libuv::Loop;
#[cfg(unix)]
type napi_event_loop = *mut super::uv_posix::UvLoop;

#[unsafe(no_mangle)]
extern "C" fn napi_get_uv_event_loop(
    env_: Option<&NapiEnv>,
    loop_: Option<&Out<napi_event_loop>>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_uv_event_loop");
    let env = get_env!(env_);
    let loop_out = get_out!(env, loop_);
    #[cfg(windows)]
    {
        // A past alignment assertion here fired spuriously.
        // TODO(@190n) investigate
        loop_out.write(VirtualMachine::get().uv_loop());
    }
    #[cfg(unix)]
    {
        // Bun doesn't run libuv on POSIX. The addon gets this VM's `UvLoop`, and
        // `uv_posix` implements the uv_* functions on this VM's event loop.
        // SAFETY: the env's VM is alive while the env is.
        let uv_loop = unsafe { super::uv_posix::UvLoop::of_vm(env.to_js().bun_vm()) };
        if uv_loop.is_null() {
            return env.generic_failure();
        }
        loop_out.write(uv_loop);
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

    safe fn Bun__napi_check_gc(env: &NapiEnv);

    /// Returns false if the env has already torn down its registry.
    fn NapiEnv__registerThreadSafeFunction(env: *mut NapiEnv, tsfn: *const c_void) -> bool;
    fn NapiEnv__unregisterThreadSafeFunction(env: *mut NapiEnv, tsfn: *const c_void);
}

/// # Safety
/// `env` lives until its VM has run its cleanup hooks.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__napi_register_cleanup_zig(env: &NapiEnv) {
    unsafe extern "C" {
        fn Bun__napi_cleanup_env_cpp(env: *mut c_void);
    }
    let rare_data = env.to_js().bun_vm().rare_data();
    // SAFETY: fn contract.
    unsafe {
        rare_data.push_cleanup_hook(
            env.to_js(),
            env.as_mut_ptr().cast::<c_void>(),
            Bun__napi_cleanup_env_cpp,
        )
    };
}

/// # Safety
/// As [`Bun__napi_register_cleanup_zig`].
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__napi_run_finalizers_after_teardown_wait(env: &NapiEnv) {
    unsafe extern "C" {
        fn NapiEnv__runFinalizers(env: *mut c_void);
    }
    let rare_data = env.to_js().bun_vm().rare_data();
    // SAFETY: fn contract.
    unsafe {
        rare_data.push_cleanup_hook_after_teardown_wait(
            env.to_js(),
            env.as_mut_ptr().cast::<c_void>(),
            NapiEnv__runFinalizers,
        )
    };
}

#[unsafe(no_mangle)]
extern "C" fn Bun__napi_suppress_crash_on_abort_if_desired() {
    if bun_core::env_var::feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT
        .get()
        .unwrap_or(false)
    {
        bun_crash_handler::suppress_reporting();
    }
}

unsafe extern "C" {
    fn Bun__napi_remove_finalizer(
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
    env: NapiEnvRef,
    fun: NapiFinalizeFunction,
    data: *mut c_void,
    hint: *mut c_void,
}

impl Finalizer {
    /// Run the addon's finalizer. What it raised through napi (latched on the
    /// env) or left on the VM is the `Err`, for the caller's dispatcher to fold.
    pub(crate) fn run(self) -> JsResult<()> {
        let env_ref: &NapiEnv = &self.env;
        let env = env_ref.as_mut_ptr();
        let _hs = NapiHandleScope::open_scoped(env_ref);

        // SAFETY: env is valid, and the addon gave `fun` together with `data` and `hint`.
        unsafe {
            (self.fun)(env, self.data, self.hint);
            Bun__napi_remove_finalizer(env, Some(self.fun), self.hint, self.data);
        }

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
///
/// # Safety
/// `fun` takes `data` and `hint`, once. This is `env`'s JS thread, or the collector's while that thread is stopped.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__napi_enqueue_finalizer(
    env: Option<&NapiEnv>,
    fun: napi_finalize,
    data: *mut c_void,
    hint: *mut c_void,
) {
    let Some(fun) = fun else { return };
    let Some(env_ref) = env else {
        return;
    };
    let this = Finalizer {
        fun,
        env: env_ref.ref_(),
        data,
        hint,
    };
    this.enqueue();
}

// ──────────────────────────────────────────────────────────────────────────
// ThreadSafeFunction
// ──────────────────────────────────────────────────────────────────────────

/// A pointer of the addon's, which is only ever handed back to it.
#[repr(transparent)]
#[derive(Copy, Clone)]
struct AddonData(*mut c_void);

// SAFETY: never dereferenced here. Node-API lets the addon pass these between its threads.
unsafe impl Send for AddonData {}
// SAFETY: as above.
unsafe impl Sync for AddonData {}

/// Lives in an `Arc` owned by the env's registry, [`TsfnShared::dispatch_ref`], [`TsfnShared::threads_ref`] and any [`TsfnRefRequest`].
// TODO: generate a compile-time version of this instead of runtime checking
pub(crate) struct ThreadSafeFunction {
    shared: Guarded<TsfnShared>,
    blocking_condvar: Condvar,
    /// Its handle is weak: addon threads hold the function for as long as they like, so the VM cannot wait for it.
    js: VmBound<TsfnJsSide>,
    loop_kind: bun_jsc::LoopKind,
    tracker: Debugger::AsyncTaskTracker,
    /// The context whose script created the function: its calls run in it.
    context: bun_jsc::ContextId,
    /// Zero means the size is unlimited.
    max_queue_size: usize,
    ctx: AddonData,
    call_js: Option<napi_threadsafe_function_call_js>,
}

type TsfnQueue = LinearFifo<AddonData, DynamicBuffer<AddonData>>;

struct TsfnShared {
    queue: TsfnQueue,
    thread_count: i64,
    closing: ClosingState,
    /// The reference that a dispatch runs on. `None` while one is queued or running.
    dispatch_ref: Option<Arc<ThreadSafeFunction>>,
    /// The reference that the addon's `thread_count` references stand for.
    threads_ref: Option<Arc<ThreadSafeFunction>>,
    /// A ref (`true`) or an unref from another thread that the JS thread has yet to apply.
    requested_ref: Option<bool>,
}

struct TsfnJsSide {
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
    poll_ref: KeepAlive,
    /// Armed in the function's context until the JS thread lets go of the function (`finalize`,
    /// `env_teardown`): once the context has stopped, the function no longer keeps the loop
    /// alive, whoever asked it to. Addon threads can still call it and it is finalized as usual.
    abort_handle: bun_jsc::AbortHandle,
    /// Taken out for a call, which can tear the env down, and for good by `finalize` or `env_teardown`.
    target: Cell<Option<TsfnTarget>>,
    finalizer_fun: Cell<napi_finalize>,
    finalizer_data: *mut c_void,
}

impl TsfnJsSide {
    fn set_referenced(&self, referenced: bool) {
        if referenced {
            self.poll_ref.ref_(bun_io::js_vm_ctx());
        } else {
            self.poll_ref.unref(bun_io::js_vm_ctx());
        }
    }
}

/// Applies [`TsfnShared::requested_ref`].
pub(crate) struct TsfnRefRequest(Arc<ThreadSafeFunction>);

impl TsfnRefRequest {
    pub(crate) fn run(&self) {
        let js = self.0.js_side(VirtualMachine::get());
        let requested = self.0.shared.lock().requested_ref.take();
        match requested {
            Some(true) if js.abort_handle.context_stopped() => {}
            Some(referenced) => js.set_referenced(referenced),
            None => {}
        }
    }
}

struct TsfnTarget {
    env: NapiEnvRef,
    callback: StrongOptional,
}

bun_jsc::impl_abort_handle_owner!(TsfnJsSide, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live, and this is the JS thread.
    unsafe { &*this }.poll_ref.unref(bun_io::js_vm_ctx())
});

#[derive(Copy, Clone, PartialEq, Eq)]
enum ClosingState {
    NotClosing,
    Closing,
    /// `finalize` is queued or running, or `env_teardown` is running.
    Closed,
    /// The JS thread has let go of the function (Node's `kClosed`).
    Finalized,
}

enum DispatchStep {
    Call { item: AddonData },
    QueueFinalizer { leftovers: TsfnQueue },
    Finalize,
}

impl TsfnShared {
    fn is_closing(&self) -> bool {
        self.closing != ClosingState::NotClosing
    }

    /// The items are the caller's to give back to the addon once the lock is dropped.
    fn take_queue(&mut self) -> TsfnQueue {
        core::mem::replace(&mut self.queue, TsfnQueue::init())
    }

    /// Node's MaybeDelete. Drop the result after unlocking.
    fn take_if_orphaned(&mut self) -> Option<Arc<ThreadSafeFunction>> {
        if self.closing == ClosingState::Finalized && self.thread_count <= 0 {
            return self.threads_ref.take();
        }
        None
    }
}

/// Live `ThreadSafeFunction` allocations, process-wide.
static THREADSAFE_FUNCTION_LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

/// Exposed via `bun:internal-for-testing` so tests can assert a threadsafe
/// function orphaned by a dead worker is freed rather than leaked.
pub(crate) fn threadsafe_function_live_count() -> usize {
    THREADSAFE_FUNCTION_LIVE_COUNT.load(Ordering::SeqCst)
}

impl Drop for ThreadSafeFunction {
    fn drop(&mut self) {
        let _ = THREADSAFE_FUNCTION_LIVE_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

impl ThreadSafeFunction {
    fn new(init: ThreadSafeFunction) -> Arc<ThreadSafeFunction> {
        let _ = THREADSAFE_FUNCTION_LIVE_COUNT.fetch_add(1, Ordering::SeqCst);
        Arc::new(init)
    }

    /// Runs `f` under the lock when `f` can give up the caller's reference.
    ///
    /// # Safety
    /// This thread holds a `thread_count` reference or an `Arc`, and only `f` gives it up during the call.
    unsafe fn with_lock_raw<R>(
        this: *const Self,
        f: impl FnOnce(&Self, &mut GuardedLock<'_, TsfnShared, Mutex>) -> R,
    ) -> R {
        // SAFETY: `this` is live on entry. `f` gives the reference up to `dispatch_ref` or `threads_ref`,
        // which another thread can only take under the lock. `_orphaned` is dropped after the unlock.
        let (result, _orphaned) = unsafe {
            Guarded::with_lock_raw(&raw const (*this).shared, |shared| {
                (f(&*this, shared), shared.take_if_orphaned())
            })
        };
        result
    }

    fn js_side<'a>(&'a self, vm: &'a VirtualMachine) -> &'a TsfnJsSide {
        self.js.get(vm).expect("the function's own VM")
    }

    // This has two states:
    // 1. We need to run potentially multiple tasks.
    // 2. We need to finalize the ThreadSafeFunction.
    /// The threadsafe function's queue drain is a dispatcher: each queued call
    /// is a JS entry of its own, so what one leaves pending is folded per call
    /// (`call`) and the drain goes on; the VM's termination ends it.
    pub(crate) fn on_dispatch(mut this: Arc<Self>, event_loop: &EventLoop, vm: &VirtualMachine) {
        let mut is_first = true;
        let mut is_stopped = false;

        // Run the tasks.
        loop {
            // SAFETY: `this` is moved into the closure, which stores or returns it.
            let next = unsafe {
                Self::with_lock_raw(Arc::as_ptr(&this), |function, shared| {
                    let Some(step) = function.next_step(shared, is_stopped) else {
                        shared.dispatch_ref = Some(this);
                        return None;
                    };
                    Some((this, step))
                })
            };
            let Some((returned, step)) = next else {
                break;
            };
            this = returned;
            let js = this.js_side(vm);

            match step {
                DispatchStep::Call { item } => {
                    // One call's microtasks are drained before the next call (https://github.com/nodejs/node/pull/38506).
                    is_stopped = (!is_first && event_loop.drain_microtasks().is_err())
                        || this.call(js, item).is_err();
                    is_first = false;
                }
                DispatchStep::QueueFinalizer { leftovers } => {
                    this.hand_back(leftovers);
                    js.poll_ref.disable();
                    event_loop.enqueue_task(Task::init(Arc::into_raw(this).cast_mut()));
                    break;
                }
                DispatchStep::Finalize => {
                    this.finalize(js);
                    break;
                }
            }
        }

        // Node sets a maximum number of runs per ThreadSafeFunction to 1,000.
        // We don't set a max. I would like to see an issue caused by not
        // setting a max before we do set a max. It is better for performance to
        // not add unnecessary event loop ticks.
    }

    /// `None`: done running tasks, for now.
    fn next_step(&self, shared: &mut TsfnShared, is_stopped: bool) -> Option<DispatchStep> {
        match shared.closing {
            ClosingState::Closed | ClosingState::Finalized => return Some(DispatchStep::Finalize),
            // Finalizes whatever thread_count is: after an abort the other threads may never release (Node's CloseHandlesAndMaybeDelete).
            ClosingState::Closing => {}
            ClosingState::NotClosing if shared.queue.readable_length() > 0 => {
                if is_stopped {
                    // The queue waits for the next dispatch, or for `env_teardown`.
                    return None;
                }
                return self.dequeue(shared);
            }
            ClosingState::NotClosing => {
                // When there are no tasks and the number of threads that have
                // references reaches zero, we prepare to finalize the
                // ThreadSafeFunction.
                if shared.thread_count != 0 {
                    return None;
                }
                if self.max_queue_size > 0 {
                    self.blocking_condvar.signal();
                }
            }
        }
        shared.closing = ClosingState::Closed;
        Some(DispatchStep::QueueFinalizer {
            leftovers: shared.take_queue(),
        })
    }

    fn dequeue(&self, shared: &mut TsfnShared) -> Option<DispatchStep> {
        let was_blocked = self.is_blocked(shared);
        let item = shared.queue.read_item()?;

        if shared.queue.readable_length() == 0 && shared.thread_count == 0 {
            shared.closing = ClosingState::Closing;
            if self.max_queue_size > 0 {
                self.blocking_condvar.signal();
            }
        } else if was_blocked && !self.is_blocked(shared) {
            self.blocking_condvar.signal();
        }

        Some(DispatchStep::Call { item })
    }

    fn is_blocked(&self, shared: &TsfnShared) -> bool {
        self.max_queue_size > 0 && shared.queue.readable_length() >= self.max_queue_size
    }

    /// One queued call from the drain, which is its landing frame: what it
    /// left pending is folded here. `Err`: the VM is stopping.
    fn call(&self, js: &TsfnJsSide, item: AddonData) -> Result<(), bun_jsc::Stopped> {
        js.target.with_taken(|target| {
            let Some(target) = target else {
                // env torn down; nothing to call into.
                return Ok(());
            };
            self.deliver(target, item)
                .or_else(|err| bun_jsc::task::report_error_or_terminate(target.env.to_js(), err))
        })
    }

    /// One queued call: a JS entry of its own, so what it leaves pending is
    /// the `Err`, for the caller's landing frame to fold.
    fn deliver(&self, target: &TsfnTarget, item: AddonData) -> JsResult<()> {
        let env: &NapiEnv = &target.env;
        let global_object = env.to_js();
        let _dispatch = self.tracker.dispatch(global_object);

        let Some(call_js) = self.call_js else {
            let js: JSValue = target.callback.get().unwrap_or(JSValue::UNDEFINED);
            if js.is_empty_or_undefined_or_null() {
                return Ok(());
            }

            return js.call(global_object, JSValue::UNDEFINED, &[]).map(drop);
        };

        let _hs = NapiHandleScope::open_scoped(env);
        // No func at creation => null js_callback (Node), not encoded undefined.
        let js = match target.callback.get() {
            Some(v) => napi_value::create(env, v),
            None => napi_value(0),
        };
        env.complete_in_context(self.context, || {
            // SAFETY: the addon's callback, with its context and an item it queued.
            unsafe { call_js(env.as_mut_ptr(), js, self.ctx, item) }
        });
        env.surface_exception(global_object)
    }

    /// What a closing function does with items it will never run: each goes
    /// back to the addon's call_js_cb with a null env and js_callback, which is
    /// the signal napi_threadsafe_function_call_js documents for "free this,
    /// JS is no longer reachable" (Node's ThreadSafeFunction::EmptyQueue). A
    /// function created without a call_js_cb has nothing to give back.
    fn hand_back(&self, mut items: TsfnQueue) {
        let Some(call_js) = self.call_js else {
            return;
        };
        while let Some(item) = items.read_item() {
            // SAFETY: as in `deliver`.
            unsafe { call_js(ptr::null_mut(), napi_value(0), self.ctx, item) };
        }
    }

    /// Runs on an addon thread (Node's `Push`).
    fn enqueue(
        &self,
        shared: &mut GuardedLock<'_, TsfnShared, Mutex>,
        item: AddonData,
        block: bool,
    ) -> NapiStatus {
        if block {
            while self.is_blocked(shared) && !shared.is_closing() {
                self.blocking_condvar.wait_guarded(shared);
            }
        } else if self.is_blocked(shared) && !shared.is_closing() {
            // A closing threadsafe function reports napi_closing even with a full
            // queue (node's `Push` skips the queue-full check unless it is open),
            // so the caller's reference is still consumed and it can finalize.
            // don't set the error on the env as this is run from another thread
            return NapiStatus::queue_full;
        }

        if shared.is_closing() {
            // `env_teardown` sets `closing` under this same lock, so an env that
            // dies while we wait above lands here, never below.
            if shared.thread_count <= 0 {
                return NapiStatus::invalid_arg;
            }
            // Consumes this thread's reference, like Node's `Push`, so a thread
            // that stops calling after napi_closing does not pin the loop.
            shared.thread_count -= 1;
            return NapiStatus::closing;
        }

        let _ = shared.queue.write_item(item); // OOM/capacity failures are fire-and-forget
        self.schedule_dispatch(shared);
        NapiStatus::ok
    }

    /// Reached from addon threads; the VM is reached only through its handle.
    fn schedule_dispatch(&self, shared: &mut TsfnShared) {
        let Some(this) = shared.dispatch_ref.take() else {
            // A dispatch is queued or running and will see this, or `env_teardown` will.
            return;
        };
        let queued = Arc::into_raw(this);
        let ct = ConcurrentTask::create_from(queued.cast_mut());
        if let bun_jsc::vm_handle::Posted::Refused(_) = self.js.handle().post(self.loop_kind, ct) {
            // VM closed before the env cleanup hook ran here: no
            // dispatch will happen; the queued calls are released by the
            // teardown path.
            // SAFETY: the reference that the refused task carried.
            shared.dispatch_ref = Some(unsafe { Arc::from_raw(queued) });
        }
    }

    /// Runs once the function has closed (Node's Finalize).
    fn finalize(self: &Arc<Self>, js: &TsfnJsSide) {
        let Some(target) = js.target.take() else {
            return;
        };
        let this = Arc::as_ptr(self);
        // SAFETY: env is live (we hold a ref). Its registry still has its reference: the env's
        // teardown takes `target`, and it runs no task.
        unsafe {
            NapiEnv__unregisterThreadSafeFunction(target.env.get(), this.cast());
            Arc::decrement_strong_count(this);
        }
        self.run_finalizer_and_release(js, &target.env);
    }

    /// Runs the addon's finalizer and leaves the function to the threads that still hold a reference.
    fn run_finalizer_and_release(&self, js: &TsfnJsSide, env: &NapiEnv) {
        if let Some(fun) = js.finalizer_fun.take() {
            let finalizer = Finalizer {
                env: env.ref_(),
                fun,
                data: js.finalizer_data,
                hint: self.ctx.0,
            };
            // This is the finalizer's landing frame: what it leaves is folded here.
            crate::dispatch::fold(finalizer.run());
        }

        js.poll_ref.disable();
        js.abort_handle.leave();

        let mut shared = self.shared.lock();
        shared.closing = ClosingState::Finalized;
        let released = (shared.dispatch_ref.take(), shared.take_if_orphaned());
        drop(shared);
        drop(released);
    }

    /// Runs on the JS thread from `NapiEnv::cleanup()` while JSC is still
    /// alive but the VirtualMachine is about to be destroyed. Mirrors Node's
    /// ThreadSafeFunction::Cleanup -> Finalize -> MaybeDelete.
    fn env_teardown(&self, env: &NapiEnv) {
        let vm = env.to_js().bun_vm();
        let js = self.js_side(vm);

        // Publish "the loop is going away". From here no other thread
        // schedules onto it, but none may free us either -- the JS resources
        // below are still live and only this thread may touch them.
        let (was_closing, mut queued) = {
            let mut shared = self.shared.lock();
            let was_closing = shared.is_closing();
            shared.closing = ClosingState::Closed;
            if self.max_queue_size > 0 {
                // Wake producers blocked on the bounded queue; they observe
                // is_closing and release.
                self.blocking_condvar.broadcast();
            }
            (was_closing, shared.take_queue())
        };

        // Addon callbacks run from here, so no lock is held.
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
        let target = js.target.take();
        if vm.worker_ref().is_some() && self.call_js.is_some() {
            match &target {
                Some(target) if !was_closing => {
                    while let Some(item) = queued.read_item() {
                        // The env's cleanup hook is each delivery's landing frame.
                        crate::dispatch::fold(self.deliver(target, item));
                    }
                }
                _ => self.hand_back(queued),
            }
        }
        self.run_finalizer_and_release(js, env);
    }

    /// Node's `Ref` and `Unref`, which take effect on any thread.
    fn set_referenced(&self, referenced: bool) {
        let vm = VirtualMachine::get_or_null();
        let Some((vm, js)) = vm.and_then(|vm| Some((vm, self.js.get(vm)?))) else {
            return self.request_ref(referenced);
        };
        // Nothing of a context that has stopped holds the loop: not the function's own call_js
        // once its maker has stopped (that is where it runs), not a disposed graph's leftover
        // script. Accepted, and holds nothing.
        if referenced && vm.context_of_caller().is_stopped() {
            return;
        }
        self.shared.lock().requested_ref = None;
        js.set_referenced(referenced);
    }

    /// Does not wake the loop, like `uv_unref`, so that it does not exit before a call that follows.
    fn request_ref(&self, referenced: bool) {
        let mut shared = self.shared.lock();
        if shared.is_closing() || shared.requested_ref.replace(referenced).is_some() {
            return;
        }
        let this = shared.threads_ref.clone().expect("held until finalized");
        let ct = ConcurrentTask::create_boxed(Box::new(TsfnRefRequest(this)));
        if let bun_jsc::vm_handle::Posted::Refused(ct) =
            self.js.handle().post_without_waking(self.loop_kind, ct)
        {
            // SAFETY: the task made above.
            drop(unsafe { ct.task.into_boxed::<TsfnRefRequest>() });
        }
    }

    fn acquire(&self) -> NapiStatus {
        let mut shared = self.shared.lock();
        if shared.is_closing() {
            return NapiStatus::closing;
        }
        shared.thread_count += 1;
        NapiStatus::ok
    }

    fn release(&self, shared: &mut TsfnShared, abort: bool) -> NapiStatus {
        if shared.thread_count <= 0 {
            return NapiStatus::invalid_arg;
        }

        shared.thread_count -= 1;

        // Already closing: the JS thread finalizes whatever thread_count is by then.
        if (abort || shared.thread_count == 0) && !shared.is_closing() {
            if abort {
                shared.closing = ClosingState::Closing;
                if self.max_queue_size > 0 {
                    // Wake all producers blocked in enqueue()'s bounded queue wait so they observe is_closing and release.
                    self.blocking_condvar.broadcast();
                }
            }
            self.schedule_dispatch(shared);
        }

        NapiStatus::ok
    }
}

/// Called from `NapiEnv::cleanup()` (JS thread) for every threadsafe function
/// still registered with the env that is being torn down.
///
/// # Safety
/// `tsfn` is the reference that `env`'s registry had.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__napi_threadsafe_function_env_teardown(
    env: &NapiEnv,
    tsfn: *const ThreadSafeFunction,
) {
    // SAFETY: fn contract.
    unsafe { Arc::from_raw(tsfn) }.env_teardown(env);
}

/// # Safety
/// On this thread, `call_js_cb` takes `context` and each item that the addon queues,
/// and `thread_finalize_cb` takes `thread_finalize_data` and `context`.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_create_threadsafe_function(
    env_: Option<&NapiEnv>,
    func_: napi_value,
    _async_resource: napi_value,
    _async_resource_name: napi_value,
    max_queue_size: usize,
    initial_thread_count: usize,
    thread_finalize_data: *mut c_void,
    thread_finalize_cb: napi_finalize,
    context: AddonData,
    call_js_cb: Option<napi_threadsafe_function_call_js>,
    result_: Option<&Out<napi_threadsafe_function>>,
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

    let vm = env.to_js().bun_vm();
    let target = TsfnTarget {
        env: env.ref_(),
        callback: if func.is_empty() {
            StrongOptional::empty()
        } else {
            StrongOptional::create(func.with_async_context_if_needed(env.to_js()), vm.global())
        },
    };

    let function = ThreadSafeFunction::new(ThreadSafeFunction {
        shared: Guarded::new(TsfnShared {
            queue: TsfnQueue::init(),
            thread_count: i64::try_from(initial_thread_count).expect("int cast"),
            closing: ClosingState::NotClosing,
            dispatch_ref: None,
            threads_ref: None,
            requested_ref: None,
        }),
        blocking_condvar: Condvar::default(),
        js: VmBound::new(
            vm,
            TsfnJsSide {
                poll_ref: KeepAlive::init(),
                abort_handle: bun_jsc::AbortHandle::for_owner::<TsfnJsSide>(),
                target: Cell::new(None),
                finalizer_fun: Cell::new(thread_finalize_cb),
                finalizer_data: thread_finalize_data,
            },
        ),
        loop_kind: vm.current_loop_kind(),
        tracker: Debugger::AsyncTaskTracker::init(vm),
        context: vm.context_of_caller().id(),
        max_queue_size,
        ctx: context,
        call_js: call_js_cb,
    });

    // Register with the env so that VM/worker teardown neutralizes this TSFN
    // before the VM is freed. `false` means the env has
    // already torn its threadsafe functions down -- we are running from a
    // finalizer, after the loop's last tick.
    // SAFETY: env is live. The registry gets the reference that `into_raw` leaves below.
    if !unsafe {
        NapiEnv__registerThreadSafeFunction(env.as_mut_ptr(), Arc::as_ptr(&function).cast())
    } {
        // Born dead. Free only what we allocated and never run the addon's
        // finalizer: the handle was never published, so the addon still owns
        // what it passed in (node's `Init` failure path just deletes the
        // ThreadSafeFunction, whose destructor only releases its own resources).
        return env.generic_failure();
    }

    let js = function.js_side(vm);
    js.target.set(Some(target));
    let mut shared = function.shared.lock();
    shared.dispatch_ref = Some(Arc::clone(&function));
    shared.threads_ref = Some(Arc::clone(&function));
    drop(shared);

    // nodejs by default keeps the event loop alive until the thread-safe function is unref'd
    js.set_referenced(!vm.context_of_caller().is_stopped());
    // (Unless the context whose script is creating it stops first.)
    // SAFETY: `threads_ref` keeps the allocation until `run_finalizer_and_release` has left the context.
    unsafe {
        bun_jsc::AbortHandle::arm_owner(ptr::from_ref(js).cast_mut(), vm.context_of_caller())
    };
    function.tracker.did_schedule(vm.global());

    result.write(Arc::into_raw(function));
    env.ok()
}

#[unsafe(no_mangle)]
extern "C" fn napi_get_threadsafe_function_context(
    func: &ThreadSafeFunction,
    result: &Out<AddonData>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_get_threadsafe_function_context");
    result.write(func.ctx);
    NapiStatus::ok as napi_status
}

/// # Safety
/// As [`napi_release_threadsafe_function`], and `call_js_cb` takes `data`. napi_closing consumes the reference.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_call_threadsafe_function(
    func: napi_threadsafe_function,
    data: AddonData,
    is_blocking: napi_threadsafe_function_call_mode,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_call_threadsafe_function");
    let block = is_blocking == NAPI_TSFN_BLOCKING;
    // SAFETY: fn contract.
    unsafe {
        ThreadSafeFunction::with_lock_raw(func, |func, shared| func.enqueue(shared, data, block))
            as napi_status
    }
}

#[unsafe(no_mangle)]
extern "C" fn napi_acquire_threadsafe_function(func: &ThreadSafeFunction) -> napi_status {
    bun_output::scoped_log!(napi, "napi_acquire_threadsafe_function");
    func.acquire() as napi_status
}

/// # Safety
/// The caller has a reference to `func`, or it is on the JS thread and the finalizer has not returned.
#[unsafe(no_mangle)]
unsafe extern "C" fn napi_release_threadsafe_function(
    func: napi_threadsafe_function,
    mode: napi_threadsafe_function_release_mode,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_release_threadsafe_function");
    let abort = mode == NAPI_TSFN_ABORT;
    // SAFETY: fn contract.
    unsafe {
        ThreadSafeFunction::with_lock_raw(func, |func, shared| func.release(shared, abort))
            as napi_status
    }
}

#[unsafe(no_mangle)]
extern "C" fn napi_unref_threadsafe_function(
    _env: napi_env,
    func: Option<&ThreadSafeFunction>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_unref_threadsafe_function");
    let Some(func) = func else {
        return NapiStatus::invalid_arg as napi_status;
    };
    func.set_referenced(false);
    NapiStatus::ok as napi_status
}

#[unsafe(no_mangle)]
extern "C" fn napi_ref_threadsafe_function(
    _env: napi_env,
    func: Option<&ThreadSafeFunction>,
) -> napi_status {
    bun_output::scoped_log!(napi, "napi_ref_threadsafe_function");
    let Some(func) = func else {
        return NapiStatus::invalid_arg as napi_status;
    };
    func.set_referenced(true);
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
        pub(super) fn _ZNK2v88Function15GetScriptOriginEv() -> *mut c_void;
        pub(super) fn _ZNK2v88Function19GetScriptLineNumberEv() -> *mut c_void;
        pub(super) fn _ZNK2v88Function21GetScriptColumnNumberEv() -> *mut c_void;
        pub(super) fn _ZNK2v85Value7ToInt32ENS_5LocalINS_7ContextEEE() -> *mut c_void;
        pub(super) fn _ZNK2v85Int325ValueEv() -> *mut c_void;
        pub(super) fn _ZNK2v812ScriptOrigin24VerifyHostDefinedOptionsEv() -> *mut c_void;
        pub(super) fn _ZNK2v812ScriptOrigin12ResourceNameEv() -> *mut c_void;
        pub(super) fn _ZNK2v812ScriptOrigin10LineOffsetEv() -> *mut c_void;
        pub(super) fn _ZNK2v812ScriptOrigin12ColumnOffsetEv() -> *mut c_void;
        pub(super) fn _ZNK2v812ScriptOrigin8ScriptIdEv() -> *mut c_void;
        pub(super) fn _ZNK2v812ScriptOrigin12SourceMapUrlEv() -> *mut c_void;
        pub(super) fn _ZNK2v812ScriptOrigin21GetHostDefinedOptionsEv() -> *mut c_void;
        pub(super) fn _ZNK2v812ScriptOrigin7OptionsEv() -> *mut c_void;
        pub(super) static _ZN2v88Function19kLineOffsetNotFoundE: i32;
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
        #[link_name = "?GetScriptOrigin@Function@v8@@QEBA?AVScriptOrigin@2@XZ"]
        pub(super) fn v8_Function_GetScriptOrigin() -> *mut c_void;
        #[link_name = "?GetScriptLineNumber@Function@v8@@QEBAHXZ"]
        pub(super) fn v8_Function_GetScriptLineNumber() -> *mut c_void;
        #[link_name = "?GetScriptColumnNumber@Function@v8@@QEBAHXZ"]
        pub(super) fn v8_Function_GetScriptColumnNumber() -> *mut c_void;
        #[link_name = "?ToInt32@Value@v8@@QEBA?AV?$MaybeLocal@VInt32@v8@@@2@V?$Local@VContext@v8@@@2@@Z"]
        pub(super) fn v8_Value_ToInt32() -> *mut c_void;
        #[link_name = "?Value@Int32@v8@@QEBAHXZ"]
        pub(super) fn v8_Int32_Value() -> *mut c_void;
        #[link_name = "?VerifyHostDefinedOptions@ScriptOrigin@v8@@AEBAXXZ"]
        pub(super) fn v8_ScriptOrigin_VerifyHostDefinedOptions() -> *mut c_void;
        #[link_name = "?ResourceName@ScriptOrigin@v8@@QEBA?AV?$Local@VValue@v8@@@2@XZ"]
        pub(super) fn v8_ScriptOrigin_ResourceName() -> *mut c_void;
        #[link_name = "?LineOffset@ScriptOrigin@v8@@QEBAHXZ"]
        pub(super) fn v8_ScriptOrigin_LineOffset() -> *mut c_void;
        #[link_name = "?ColumnOffset@ScriptOrigin@v8@@QEBAHXZ"]
        pub(super) fn v8_ScriptOrigin_ColumnOffset() -> *mut c_void;
        #[link_name = "?ScriptId@ScriptOrigin@v8@@QEBAHXZ"]
        pub(super) fn v8_ScriptOrigin_ScriptId() -> *mut c_void;
        #[link_name = "?SourceMapUrl@ScriptOrigin@v8@@QEBA?AV?$Local@VValue@v8@@@2@XZ"]
        pub(super) fn v8_ScriptOrigin_SourceMapUrl() -> *mut c_void;
        #[link_name = "?GetHostDefinedOptions@ScriptOrigin@v8@@QEBA?AV?$Local@VData@v8@@@2@XZ"]
        pub(super) fn v8_ScriptOrigin_GetHostDefinedOptions() -> *mut c_void;
        #[link_name = "?Options@ScriptOrigin@v8@@QEBA?AVScriptOriginOptions@2@XZ"]
        pub(super) fn v8_ScriptOrigin_Options() -> *mut c_void;
        #[link_name = "?kLineOffsetNotFound@Function@v8@@2HB"]
        pub(super) static v8_Function_kLineOffsetNotFound: i32;
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

/// Lists only the uv_* symbols defined in C and C++. `uv_posix` exports its own.
#[cfg(unix)]
mod uv_functions_to_export {
    unsafe extern "C" {
        pub(super) fn uv_accept();
        pub(super) fn uv_available_parallelism();
        pub(super) fn uv_backend_fd();
        pub(super) fn uv_backend_timeout();
        pub(super) fn uv_barrier_destroy();
        pub(super) fn uv_barrier_init();
        pub(super) fn uv_barrier_wait();
        pub(super) fn uv_buf_init();
        pub(super) fn uv_chdir();
        pub(super) fn uv_clock_gettime();
        pub(super) fn uv_cond_broadcast();
        pub(super) fn uv_cond_destroy();
        pub(super) fn uv_cond_init();
        pub(super) fn uv_cond_signal();
        pub(super) fn uv_cond_timedwait();
        pub(super) fn uv_cond_wait();
        pub(super) fn uv_cpu_info();
        pub(super) fn uv_cpumask_size();
        pub(super) fn uv_cwd();
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
        pub(super) safe fn uv_hrtime() -> u64;
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
        pub(super) fn uv_print_active_handles();
        pub(super) fn uv_print_all_handles();
        pub(super) fn uv_process_get_pid();
        pub(super) fn uv_process_kill();
        pub(super) fn uv_random();
        pub(super) fn uv_read_start();
        pub(super) fn uv_read_stop();
        pub(super) fn uv_recv_buffer_size();
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

#[inline(never)]
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
        super::uv_posix::fix_dead_code_elimination();
        use uv_functions_to_export::*;
        keep_symbols!(
            uv_accept,
            uv_available_parallelism,
            uv_backend_fd,
            uv_backend_timeout,
            uv_barrier_destroy,
            uv_barrier_init,
            uv_barrier_wait,
            uv_buf_init,
            uv_chdir,
            uv_clock_gettime,
            uv_cond_broadcast,
            uv_cond_destroy,
            uv_cond_init,
            uv_cond_signal,
            uv_cond_timedwait,
            uv_cond_wait,
            uv_cpu_info,
            uv_cpumask_size,
            uv_cwd,
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
            uv_hrtime,
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
            uv_print_active_handles,
            uv_print_all_handles,
            uv_process_get_pid,
            uv_process_kill,
            uv_random,
            uv_read_start,
            uv_read_stop,
            uv_recv_buffer_size,
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
            _ZNK2v88Function15GetScriptOriginEv,
            _ZNK2v88Function19GetScriptLineNumberEv,
            _ZNK2v88Function21GetScriptColumnNumberEv,
            _ZNK2v85Value7ToInt32ENS_5LocalINS_7ContextEEE,
            _ZNK2v85Int325ValueEv,
            _ZNK2v812ScriptOrigin24VerifyHostDefinedOptionsEv,
            _ZNK2v812ScriptOrigin12ResourceNameEv,
            _ZNK2v812ScriptOrigin10LineOffsetEv,
            _ZNK2v812ScriptOrigin12ColumnOffsetEv,
            _ZNK2v812ScriptOrigin8ScriptIdEv,
            _ZNK2v812ScriptOrigin12SourceMapUrlEv,
            _ZNK2v812ScriptOrigin21GetHostDefinedOptionsEv,
            _ZNK2v812ScriptOrigin7OptionsEv,
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
        // Data symbol: keep_symbols! only takes function paths.
        ::core::hint::black_box(&raw const _ZN2v88Function19kLineOffsetNotFoundE);
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
            v8_Function_GetScriptOrigin,
            v8_Function_GetScriptLineNumber,
            v8_Function_GetScriptColumnNumber,
            v8_Value_ToInt32,
            v8_Int32_Value,
            v8_ScriptOrigin_VerifyHostDefinedOptions,
            v8_ScriptOrigin_ResourceName,
            v8_ScriptOrigin_LineOffset,
            v8_ScriptOrigin_ColumnOffset,
            v8_ScriptOrigin_ScriptId,
            v8_ScriptOrigin_SourceMapUrl,
            v8_ScriptOrigin_GetHostDefinedOptions,
            v8_ScriptOrigin_Options,
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
        ::core::hint::black_box(&raw const v8_Function_kLineOffsetNotFound);
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
        // `bun_vm()` reads a thread-local that is null on a GC thread, so check the thread first.
        if !VirtualMachine::is_loaded() {
            // Off the JS thread (e.g. an external buffer finalized from a GC
            // helper thread): post through the env's VM handle. If the VM is
            // already torn down the finalizer can never run; free the task but
            // not the env ref — the env's count is not atomic and the env goes
            // with its VM — as the cleanup-hooks-already-ran case below does.
            let handle = self.finalizer.env.vm_handle();
            let ct = ConcurrentTask::create_boxed(self);
            if let bun_jsc::vm_handle::Posted::Refused(ct) =
                handle.post(bun_jsc::LoopKind::Regular, ct)
            {
                // SAFETY: the task made above.
                let task = unsafe { ct.task.into_boxed::<Self>() };
                let _ = core::mem::ManuallyDrop::new(task.finalizer.env);
            }
            return;
        }

        let vm: &VirtualMachine = self.finalizer.env.to_js().bun_vm();

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
            // SAFETY: the hook owns the box from here.
            unsafe {
                vm.rare_data().push_cleanup_hook(
                    vm.global(),
                    this.cast::<c_void>(),
                    Self::run_as_cleanup_hook,
                )
            };
        } else {
            vm.event_loop().enqueue_task(Task::from_boxed(self));
        }
    }

    /// # Safety
    /// `opaque_this` is the box that `schedule` gave up.
    unsafe extern "C" fn run_as_cleanup_hook(opaque_this: *mut c_void) {
        // SAFETY: fn contract.
        let this = unsafe { bun_core::heap::take(opaque_this.cast::<NapiFinalizerTask>()) };
        // A cleanup hook returns nothing: `Err` is left pending for the hook
        // runner's fold.
        let _ = this.finalizer.run();
    }
}
