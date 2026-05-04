//! Holds a strong reference to a JS value, protecting it from garbage
//! collection. This type implies there is always a valid value held.
//! For a strong that may be empty (to reuse allocation), use `Optional`.

use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue};

// PORT NOTE: field renamed from `impl` (Rust keyword) to `handle`.
pub struct Strong {
    handle: NonNull<Impl>,
    // NonNull<T> is already !Send + !Sync, matching the requirement that
    // Strong must be dropped on the JS thread (HandleSet is VM-owned).
}

impl Strong {
    /// Hold a strong reference to a JavaScript value. Released on `Drop`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Strong {
        debug_assert!(!value.is_empty());
        Strong { handle: Impl::init(global, value) }
    }

    pub fn get(&self) -> JSValue {
        let result = Impl::get(self.handle);
        debug_assert!(!result.is_empty());
        result
    }

    /// Set a new value for the strong reference.
    pub fn set(&mut self, global: &JSGlobalObject, new_value: JSValue) {
        debug_assert!(!new_value.is_empty());
        Impl::set(self.handle, global, new_value);
    }

    /// Swap a new value for the strong reference.
    pub fn swap(&mut self, global: &JSGlobalObject, new_value: JSValue) -> JSValue {
        let result = Impl::get(self.handle);
        self.set(global, new_value);
        result
    }
}

impl Drop for Strong {
    /// Release the strong reference.
    fn drop(&mut self) {
        // SAFETY: `self.handle` came from `Impl::init` and is consumed exactly once here.
        unsafe { Impl::destroy(self.handle) };
        // Zig: `if (Environment.isDebug) strong.* = undefined;` — Rust drop
        // already invalidates the binding; no poison needed.
    }
}

/// Holds a strong reference to a JS value, protecting it from garbage
/// collection. When not holding a value, the strong may still be allocated.
// PORT NOTE: field renamed from `impl` (Rust keyword) to `handle`.
pub struct Optional {
    handle: Option<NonNull<Impl>>,
}

impl Default for Optional {
    fn default() -> Self {
        Self { handle: None }
    }
}

impl Optional {
    pub const fn empty() -> Optional {
        Optional { handle: None }
    }

    /// Hold a strong reference to a JavaScript value. Released on `Drop` or `clear`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Optional {
        if !value.is_empty() {
            Optional { handle: Some(Impl::init(global, value)) }
        } else {
            Optional::empty()
        }
    }

    /// Clears the value, but does not de-allocate the Strong reference.
    pub fn clear_without_deallocation(&mut self) {
        let Some(r) = self.handle else { return };
        Impl::clear(r);
    }

    pub fn call(&mut self, global: &JSGlobalObject, args: &[JSValue]) -> JSValue {
        let Some(function) = self.try_swap() else { return JSValue::ZERO };
        function.call(global, args)
    }

    pub fn get(&self) -> Option<JSValue> {
        let imp = self.handle?;
        let result = Impl::get(imp);
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    pub fn swap(&mut self) -> JSValue {
        let Some(imp) = self.handle else { return JSValue::ZERO };
        let result = Impl::get(imp);
        if result.is_empty() {
            return JSValue::ZERO;
        }
        Impl::clear(imp);
        result
    }

    pub fn has(&self) -> bool {
        let Some(r) = self.handle else { return false };
        !Impl::get(r).is_empty()
    }

    pub fn try_swap(&mut self) -> Option<JSValue> {
        let result = self.swap();
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    pub fn set(&mut self, global: &JSGlobalObject, value: JSValue) {
        let Some(r) = self.handle else {
            if value.is_empty() {
                return;
            }
            self.handle = Some(Impl::init(global, value));
            return;
        };
        Impl::set(r, global, value);
    }
}

impl Drop for Optional {
    /// Frees memory for the underlying Strong reference.
    fn drop(&mut self) {
        let Some(r) = self.handle.take() else { return };
        // SAFETY: `r` came from `Impl::init` and is consumed exactly once here.
        unsafe { Impl::destroy(r) };
    }
}

/// Opaque FFI handle. Backed by a `JSC::JSValue`-sized HandleSlot; see Strong.cpp.
#[repr(C)]
pub struct Impl {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl Impl {
    pub fn init(global: &JSGlobalObject, value: JSValue) -> NonNull<Impl> {
        crate::mark_binding!();
        // SAFETY: Bun__StrongRef__new never returns null (allocates via HandleSet).
        unsafe { NonNull::new_unchecked(Bun__StrongRef__new(global, value)) }
    }

    pub fn get(this: NonNull<Impl>) -> JSValue {
        // `this` is actually a pointer to a `JSC::JSValue`; see Strong.cpp.
        let js_value: *const crate::DecodedJSValue = this.as_ptr().cast();
        // SAFETY: HandleSlot storage is a live, aligned JSC::JSValue for the
        // lifetime of the Impl handle.
        unsafe { (*js_value).encode() }
    }

    pub fn set(this: NonNull<Impl>, global: &JSGlobalObject, value: JSValue) {
        crate::mark_binding!();
        // SAFETY: `this` is a valid handle from `init`.
        unsafe { Bun__StrongRef__set(this.as_ptr(), global, value) };
    }

    pub fn clear(this: NonNull<Impl>) {
        crate::mark_binding!();
        // SAFETY: `this` is a valid handle from `init`.
        unsafe { Bun__StrongRef__clear(this.as_ptr()) };
    }

    /// SAFETY: `this` must be a valid handle from `init`; consumed here (do not reuse).
    pub unsafe fn destroy(this: NonNull<Impl>) {
        crate::mark_binding!();
        unsafe { Bun__StrongRef__delete(this.as_ptr()) };
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__StrongRef__delete(this: *mut Impl);
    fn Bun__StrongRef__new(global: *const JSGlobalObject, value: JSValue) -> *mut Impl;
    fn Bun__StrongRef__set(this: *mut Impl, global: *const JSGlobalObject, value: JSValue);
    fn Bun__StrongRef__clear(this: *mut Impl);
}

// TODO(port): verify module path for DeprecatedStrong.zig re-export
pub use crate::deprecated_strong as deprecated;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Strong.zig (153 lines)
//   confidence: high
//   todos:      2
//   notes:      field `impl` renamed to `handle` (Rust keyword); deinit→Drop; Impl::deinit→unsafe destroy (FFI); mark_binding! assumed macro
// ──────────────────────────────────────────────────────────────────────────
