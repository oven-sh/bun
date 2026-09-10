//! FFI glue for the C++ Node-API objects (`src/jsc/bindings/napi.h`,
//! `napi_handle_scope.h`): the `napi_env` handle, handle scopes and the
//! `NapiUngatedScope`. The Node-API implementation itself is `bun_runtime::napi`.

use core::mem::MaybeUninit;

use crate::{JSGlobalObject, JSValue, VmHandle, vm_handle};

bun_opaque::opaque_ffi! {
    /// `struct napi_env__` (napi.h `NapiEnv`): C++-owned and `WTF::RefCounted`.
    /// C++ mutates it (last error, handle-scope stack) through pointers derived
    /// from `&self`, which the opaque body permits.
    pub struct NapiEnv;
    /// napi_handle_scope.h `NapiHandleScopeImpl`.
    pub struct NapiHandleScope;
}

#[allow(improper_ctypes)] // `vm_handle::Shared` is opaque to C++ (`BunVmHandleRef`)
unsafe extern "C" {
    safe fn NapiEnv__globalObject(env: &NapiEnv) -> *mut JSGlobalObject;
    safe fn NapiEnv__getAndClearPendingException(env: &NapiEnv, out: &mut JSValue) -> bool;
    safe fn NapiEnv__hasPendingException(env: &NapiEnv) -> bool;
    safe fn NapiEnv__ref(env: &NapiEnv);
    safe fn NapiEnv__deref(env: &NapiEnv);
    /// The reference to its VM's handle the env holds (`BunVmHandleRef`).
    safe fn NapiEnv__vmHandle(env: &NapiEnv) -> *const vm_handle::Shared;
    safe fn NapiUngatedScope__construct(storage: &mut MaybeUninit<UngatedScope>, env: &NapiEnv);
    fn NapiUngatedScope__destruct(storage: &mut UngatedScope);
}

// `bun_runtime::ffi` hands these two addresses to TinyCC.
#[allow(clashing_extern_declarations)]
unsafe extern "C" {
    pub safe fn NapiHandleScope__open(env: &NapiEnv, escapable: bool) -> *mut NapiHandleScope;
    pub safe fn NapiHandleScope__close(env: &NapiEnv, current: Option<&NapiHandleScope>);
    safe fn NapiHandleScope__append(env: &NapiEnv, value: JSValue);
    safe fn NapiHandleScope__escape(handle_scope: &NapiHandleScope, value: JSValue) -> bool;
}

impl NapiEnv {
    #[inline]
    pub fn to_js(&self) -> &JSGlobalObject {
        JSGlobalObject::opaque_ref(NapiEnv__globalObject(self))
    }

    /// Any thread holding an env ref: (a clone of) the env's VM handle.
    pub fn vm_handle(&self) -> VmHandle {
        // SAFETY: the env holds this reference for its whole lifetime, which `&self` is within.
        (*unsafe { VmHandle::borrow_ref(NapiEnv__vmHandle(self)) }).clone()
    }

    /// Checks both `env->m_pendingException` (set by `napi_throw*`) and the JSC
    /// VM exception slot. This is the gate Node.js's `NAPI_PREAMBLE` enforces.
    #[inline]
    pub fn has_pending_exception(&self) -> bool {
        NapiEnv__hasPendingException(self)
    }

    pub fn get_and_clear_pending_exception(&self) -> Option<JSValue> {
        let mut exception = JSValue::ZERO;
        NapiEnv__getAndClearPendingException(self, &mut exception).then_some(exception)
    }

    /// One more reference on this env (JS thread: the C++ count is not atomic).
    #[inline]
    pub fn to_ref(&self) -> NapiEnvRef {
        // SAFETY: `&NapiEnv` only ever refers to a live C++ `napi_env`.
        unsafe { NapiEnvRef::clone_from_raw(self.as_mut_ptr()) }
    }
}

// SAFETY: the count is the C++ `WTF::RefCounted` one; the env stays alive
// while it is > 0, and a `NapiEnv` is only ever seen by reference to one.
unsafe impl bun_ptr::ExternalSharedDescriptor for NapiEnv {
    unsafe fn ext_ref(this: *mut Self) {
        NapiEnv__ref(Self::opaque_ref(this))
    }
    unsafe fn ext_deref(this: *mut Self) {
        NapiEnv__deref(Self::opaque_ref(this))
    }
}

/// A counted reference to a `napi_env` (`Ref<NapiEnv>`).
pub type NapiEnvRef = bun_ptr::ExternalShared<NapiEnv>;

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum EscapeError {
    #[error("escape called twice")]
    EscapeCalledTwice,
}

impl NapiHandleScope {
    /// Create a new handle scope in the given environment, or return null if
    /// creating one now is unsafe (i.e. inside a finalizer).
    #[inline]
    pub fn open(env: &NapiEnv, escapable: bool) -> *mut NapiHandleScope {
        NapiHandleScope__open(env, escapable)
    }

    /// Closes the given handle scope, releasing all values inside it, if it is
    /// safe to do so. Asserts that `scope` is the current handle scope in env.
    #[inline]
    pub fn close(scope: Option<&NapiHandleScope>, env: &NapiEnv) {
        NapiHandleScope__close(env, scope)
    }

    /// Place a value in the handle scope. Must be done while returning any JS
    /// value into NAPI callbacks, as the value must remain alive as long as the
    /// handle scope is active, even if the native module doesn't keep it
    /// visible on the stack.
    #[inline]
    pub fn append(env: &NapiEnv, value: JSValue) {
        NapiHandleScope__append(env, value)
    }

    /// Move a value from the current handle scope (which must be escapable) to
    /// the reserved escape slot in the parent handle scope, allowing that
    /// value to outlive the current handle scope.
    pub fn escape(&self, value: JSValue) -> Result<(), EscapeError> {
        if NapiHandleScope__escape(self, value) {
            Ok(())
        } else {
            Err(EscapeError::EscapeCalledTwice)
        }
    }

    /// Open a non-escapable handle scope that closes when the guard drops. If
    /// opening returns null (inside a finalizer), the guard's `Drop` is a no-op.
    #[must_use]
    pub fn open_scoped(env: &NapiEnv) -> NapiHandleScopeGuard<'_> {
        NapiHandleScopeGuard {
            scope: Self::open(env, false),
            env,
        }
    }
}

/// RAII guard for [`NapiHandleScope::open`] / [`NapiHandleScope::close`].
pub struct NapiHandleScopeGuard<'a> {
    scope: *mut NapiHandleScope,
    env: &'a NapiEnv,
}

impl Drop for NapiHandleScopeGuard<'_> {
    fn drop(&mut self) {
        if !self.scope.is_null() {
            NapiHandleScope::close(Some(NapiHandleScope::opaque_ref(self.scope)), self.env);
        }
    }
}

/// napi.cpp's `NapiUngatedScope` (see the comment there), constructed in
/// place in caller-provided storage by [`UngatedScope::enter`].
#[repr(C, align(8))]
pub struct UngatedScope([MaybeUninit<u8>; 80]);

/// Destroys the [`UngatedScope`] it was returned for.
pub struct UngatedScopeGuard<'a>(&'a mut UngatedScope);

impl UngatedScope {
    /// The rest of the caller's frame runs with no JS or addon code (traps
    /// deferred, a pending exception suspended).
    #[inline]
    pub fn enter<'a>(
        storage: &'a mut MaybeUninit<UngatedScope>,
        env: &NapiEnv,
    ) -> UngatedScopeGuard<'a> {
        NapiUngatedScope__construct(storage, env);
        // SAFETY: constructed just above; napi.cpp static_asserts the C++ object fits.
        UngatedScopeGuard(unsafe { storage.assume_init_mut() })
    }
}

impl Drop for UngatedScopeGuard<'_> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: a guard only exists for storage `enter` constructed; destroyed once, here.
        unsafe { NapiUngatedScope__destruct(self.0) };
    }
}
