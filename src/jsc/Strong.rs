//! Holds a strong reference to a JS value, protecting it from garbage
//! collection. This type implies there is always a valid value held.
//! For a strong that may be empty (to reuse allocation), use `Optional`.

use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue};

// Note: field renamed from `impl` (Rust keyword) to `handle`.
pub struct Strong {
    handle: NonNull<Impl>,
    // NonNull<T> is !Send + !Sync: the slot must be released on the JS thread.
}

impl Strong {
    /// Hold a strong reference to a JavaScript value. Released on `Drop`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Strong {
        debug_assert!(!value.is_empty());
        Strong {
            handle: Impl::init(global, value),
        }
    }

    pub fn get(&self) -> JSValue {
        let result = Impl::get(self.handle);
        debug_assert!(!result.is_empty());
        result
    }

    /// Set a new value for the strong reference.
    pub fn set(&mut self, _global: &JSGlobalObject, new_value: JSValue) {
        debug_assert!(!new_value.is_empty());
        Impl::set(self.handle, new_value);
    }

    /// Adopt an `Impl` handle allocated externally (e.g. by C++ bindgen glue),
    /// taking ownership. The handle will be destroyed on `Drop`.
    ///
    /// # Safety
    /// `handle` must have been produced by `Bun__StrongRef__new` (or equivalent)
    /// and must not be owned by any other `Strong`/`Optional`.
    pub(crate) unsafe fn adopt(handle: NonNull<Impl>) -> Strong {
        Strong { handle }
    }
}

impl Drop for Strong {
    /// Release the strong reference.
    fn drop(&mut self) {
        // SAFETY: `self.handle` came from `Impl::init` and is consumed exactly once here.
        unsafe { Impl::destroy(self.handle) };
    }
}

/// Holds a strong reference to a JS value, protecting it from garbage
/// collection. When not holding a value, the strong may still be allocated.
// Note: field renamed from `impl` (Rust keyword) to `handle`.
// `#[repr(transparent)]` over a single nullable pointer keeps this FFI-safe
// when embedded in `extern "C"` structs.
#[repr(transparent)]
#[derive(Default)]
pub struct Optional {
    handle: Option<NonNull<Impl>>,
}

impl Optional {
    pub const fn empty() -> Optional {
        Optional { handle: None }
    }

    /// Hold a strong reference to a JavaScript value. Released on `Drop` or `clear`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Optional {
        if !value.is_empty() {
            Optional {
                handle: Some(Impl::init(global, value)),
            }
        } else {
            Optional::empty()
        }
    }

    /// Clears the value, but does not de-allocate the Strong reference.
    pub fn clear_without_deallocation(&mut self) {
        let Some(r) = self.handle else { return };
        Impl::clear(r);
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
        let Some(imp) = self.handle else {
            return JSValue::ZERO;
        };
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

    /// Explicit teardown. Idempotent; equivalent to dropping in place and
    /// leaving `self` empty so `Drop` is a no-op.
    pub fn deinit(&mut self) {
        let Some(r) = self.handle.take() else { return };
        // SAFETY: `r` came from `Impl::init` and is consumed exactly once here.
        unsafe { Impl::destroy(r) };
    }

    pub fn set(&mut self, global: &JSGlobalObject, value: JSValue) {
        let Some(r) = self.handle else {
            if value.is_empty() {
                return;
            }
            self.handle = Some(Impl::init(global, value));
            return;
        };
        Impl::set(r, value);
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

bun_opaque::opaque_ffi! {
    /// The `JSC::JSValue` slot that `Bun__StrongRef__new` allocated in the VM's
    /// `JSC::StrongSet`; see StrongRef.cpp.
    pub struct Impl;
}

impl Impl {
    #[inline(always)]
    fn slot(this: NonNull<Impl>) -> NonNull<JSValue> {
        this.cast()
    }

    pub(crate) fn init(global: &JSGlobalObject, value: JSValue) -> NonNull<Impl> {
        crate::mark_binding!();
        NonNull::new(Bun__StrongRef__new(global, value)).expect("Bun__StrongRef__new returned null")
    }

    #[inline(always)]
    pub fn get(this: NonNull<Impl>) -> JSValue {
        // SAFETY: the slot is live until `destroy`, and only this thread uses it.
        unsafe { Self::slot(this).read() }
    }

    /// A plain store, like `JSC::Strong::set()`: the GC scans every slot of
    /// the set, so there is no write barrier.
    #[inline(always)]
    pub fn set(this: NonNull<Impl>, value: JSValue) {
        // SAFETY: as in `get`.
        unsafe { Self::slot(this).write(value) };
    }

    #[inline(always)]
    pub(crate) fn clear(this: NonNull<Impl>) {
        Self::set(this, JSValue::ZERO);
    }

    /// SAFETY: `this` must be a valid handle from `init`; consumed here (do not reuse).
    pub(crate) unsafe fn destroy(this: NonNull<Impl>) {
        crate::mark_binding!();
        if cfg!(debug_assertions) {
            assert!(
                (this.as_ptr() as usize) >= 0x10000,
                "Strong<Impl>* corrupted ({:p}); owning struct was overwritten",
                this.as_ptr(),
            );
        }
        // `VirtualMachine::teardown` destroys the JSC VM, and the StrongSet
        // with it, before it drops the runtime state that still owns
        // `Strong`s; once shutdown has begun the slot dies with the set.
        match crate::virtual_machine::VirtualMachine::get_or_null() {
            Some(vm) => {
                // SAFETY: `get_or_null` returns the thread-local pointer set by
                // `init()`; the allocation outlives the thread.
                if unsafe { (*vm).is_shutting_down() } {
                    return;
                }
            }
            None => {
                // Off the JS thread (an `unsafe impl Send` wrapper dropped us on
                // a pool thread). StrongSet::deallocate needs the JSLock, so the
                // slot leaks until the VM's teardown; the wrapper should queue
                // the drop back to the JS thread instead.
                debug_assert!(
                    false,
                    "bun_jsc::Strong dropped off the JS thread; slot leaks"
                );
                return;
            }
        }
        // SAFETY: caller contract guarantees `this` is a live handle from
        // `Bun__StrongRef__new`; it is released exactly once here.
        unsafe { Bun__StrongRef__delete(this.as_ptr()) };
    }
}

// `&JSGlobalObject` is ABI-identical to a non-null `*const T` (opaque ZST
// handle), so `new` is a safe fn; `delete` consumes the slot and stays unsafe.
unsafe extern "C" {
    fn Bun__StrongRef__delete(this: *mut Impl);
    safe fn Bun__StrongRef__new(global: &JSGlobalObject, value: JSValue) -> *mut Impl;
}
