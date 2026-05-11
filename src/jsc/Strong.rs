//! Holds a strong reference to a JS value, protecting it from garbage
//! collection. This type implies there is always a valid value held.
//! For a strong that may be empty (to reuse allocation), use `Optional`.

use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue};

pub type Impl = bun_jsc_types::StrongRefSlot;
pub type Handle = bun_jsc_types::StrongRefHandle;
pub type OptionalHandle = bun_jsc_types::OptionalStrongRefHandle;

// PORT NOTE: field renamed from `impl` (Rust keyword) to `handle`.
pub struct Strong {
    handle: Handle,
    // Handle wraps NonNull<T>, preserving the requirement that Strong must be
    // dropped on the JS thread (HandleSet is VM-owned).
}

impl Strong {
    /// Hold a strong reference to a JavaScript value. Released on `Drop`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Strong {
        debug_assert!(!value.is_empty());
        Strong { handle: init_handle(global, value) }
    }

    pub fn get(&self) -> JSValue {
        let result = get_handle(self.handle);
        debug_assert!(!result.is_empty());
        result
    }

    /// Set a new value for the strong reference.
    pub fn set(&mut self, global: &JSGlobalObject, new_value: JSValue) {
        debug_assert!(!new_value.is_empty());
        set_handle(self.handle, global, new_value);
    }

    /// Swap a new value for the strong reference.
    pub fn swap(&mut self, global: &JSGlobalObject, new_value: JSValue) -> JSValue {
        let result = get_handle(self.handle);
        self.set(global, new_value);
        result
    }

    /// Adopt an `Impl` handle allocated externally (e.g. by C++ bindgen glue),
    /// taking ownership. The handle will be destroyed on `Drop`.
    ///
    /// # Safety
    /// `handle` must have been produced by `Bun__StrongRef__new` (or equivalent)
    /// and must not be owned by any other `Strong`/`Optional`.
    pub unsafe fn adopt(handle: NonNull<Impl>) -> Strong {
        Strong { handle: unsafe { Handle::from_non_null(handle) } }
    }
}

impl Drop for Strong {
    /// Release the strong reference.
    fn drop(&mut self) {
        // SAFETY: `self.handle` came from `init_handle` and is consumed exactly once here.
        unsafe { destroy_handle(self.handle) };
        // Zig: `if (Environment.isDebug) strong.* = undefined;` — Rust drop
        // already invalidates the binding; no poison needed.
    }
}

/// Holds a strong reference to a JS value, protecting it from garbage
/// collection. When not holding a value, the strong may still be allocated.
// PORT NOTE: field renamed from `impl` (Rust keyword) to `handle`.
// `#[repr(transparent)]` matches the Zig layout (`?*Impl` — single nullable
// pointer) so it stays FFI-safe when embedded in `extern "C"` structs.
#[repr(transparent)]
pub struct Optional {
    handle: OptionalHandle,
}

impl Default for Optional {
    fn default() -> Self {
        Self { handle: OptionalHandle::empty() }
    }
}

impl Optional {
    pub const fn empty() -> Optional {
        Optional { handle: OptionalHandle::empty() }
    }

    /// Adopt an `Impl` handle allocated externally (e.g. by C++ bindgen glue),
    /// taking ownership if non-null. The handle will be destroyed on `Drop`.
    ///
    /// # Safety
    /// If `Some`, `handle` must have been produced by `Bun__StrongRef__new`
    /// (or equivalent) and must not be owned by any other `Strong`/`Optional`.
    pub unsafe fn adopt(handle: Option<NonNull<Impl>>) -> Optional {
        Optional {
            handle: unsafe { OptionalHandle::from_non_null(handle) },
        }
    }

    /// Hold a strong reference to a JavaScript value. Released on `Drop` or `clear`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Optional {
        if !value.is_empty() {
            Optional { handle: OptionalHandle::new(init_handle(global, value)) }
        } else {
            Optional::empty()
        }
    }

    /// Clears the value, but does not de-allocate the Strong reference.
    pub fn clear_without_deallocation(&mut self) {
        let Some(r) = self.handle.get() else { return };
        clear_handle(r);
    }

    pub fn call(&mut self, global: &JSGlobalObject, args: &[JSValue]) -> JSValue {
        let Some(function) = self.try_swap() else { return JSValue::ZERO };
        // PORT NOTE: Zig source (Strong.zig:71) calls `function.call(global, args)`
        // which predates the `thisValue` param on JSValue.call; pass `.undefined`.
        function
            .call(global, JSValue::UNDEFINED, args)
            .unwrap_or(JSValue::ZERO)
    }

    pub fn get(&self) -> Option<JSValue> {
        let imp = self.handle.get()?;
        let result = get_handle(imp);
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    pub fn swap(&mut self) -> JSValue {
        let Some(imp) = self.handle.get() else { return JSValue::ZERO };
        let result = get_handle(imp);
        if result.is_empty() {
            return JSValue::ZERO;
        }
        clear_handle(imp);
        result
    }

    pub fn has(&self) -> bool {
        let Some(r) = self.handle.get() else { return false };
        !get_handle(r).is_empty()
    }

    pub fn try_swap(&mut self) -> Option<JSValue> {
        let result = self.swap();
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    /// Explicit teardown for call sites ported from Zig that wrote
    /// `strong.deinit()` (Strong.zig:96). Idempotent; equivalent to dropping
    /// in place and leaving `self` empty so `Drop` is a no-op.
    pub fn deinit(&mut self) {
        let Some(r) = self.handle.take() else { return };
        // SAFETY: `r` came from `init_handle` and is consumed exactly once here.
        unsafe { destroy_handle(r) };
    }

    pub fn set(&mut self, global: &JSGlobalObject, value: JSValue) {
        let Some(r) = self.handle.get() else {
            if value.is_empty() {
                return;
            }
            self.handle.set(init_handle(global, value));
            return;
        };
        set_handle(r, global, value);
    }
}

impl Drop for Optional {
    /// Frees memory for the underlying Strong reference.
    fn drop(&mut self) {
        let Some(r) = self.handle.take() else { return };
        // SAFETY: `r` came from `init_handle` and is consumed exactly once here.
        unsafe { destroy_handle(r) };
    }
}

pub fn init_handle(global: &JSGlobalObject, value: JSValue) -> Handle {
    crate::mark_binding!();
    // SAFETY: FFI call; `global` is a live JSGlobalObject.
    unsafe { Handle::from_raw(Bun__StrongRef__new(global, value)) }
        .expect("Bun__StrongRef__new returned null")
}

pub fn get_handle(this: Handle) -> JSValue {
    // `this` is actually a pointer to a `JSC::JSValue`; see Strong.cpp.
    // SAFETY: HandleSlot storage is a live, aligned JSC::JSValue (encoded i64) for the
    // lifetime of the Impl handle. JSValue stub is `#[repr(transparent)] usize` (same
    // size); reading it directly is the encode() operation.
    // TODO(b2): once DecodedJSValue.rs un-gates, switch back to `(*js_value).encode()`.
    unsafe { *this.as_ptr().cast::<JSValue>() }
}

pub fn set_handle(this: Handle, global: &JSGlobalObject, value: JSValue) {
    crate::mark_binding!();
    // SAFETY: `this` is a valid handle from `init_handle`.
    unsafe { Bun__StrongRef__set(this.as_ptr(), global, value) };
}

pub fn clear_handle(this: Handle) {
    crate::mark_binding!();
    // SAFETY: `this` is a valid handle from `init_handle`.
    unsafe { Bun__StrongRef__clear(this.as_ptr()) };
}

/// SAFETY: `this` must be a valid handle from `init_handle`; consumed here (do not reuse).
pub unsafe fn destroy_handle(this: Handle) {
    crate::mark_binding!();
    unsafe { Bun__StrongRef__delete(this.as_ptr()) };
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__StrongRef__delete(this: *mut Impl);
    fn Bun__StrongRef__new(global: *const JSGlobalObject, value: JSValue) -> *mut Impl;
    fn Bun__StrongRef__set(this: *mut Impl, global: *const JSGlobalObject, value: JSValue);
    fn Bun__StrongRef__clear(this: *mut Impl);
}

pub use crate::deprecated_strong as deprecated;

// ported from: src/jsc/Strong.zig
