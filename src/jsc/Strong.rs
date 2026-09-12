//! Holds a strong reference to a JS value, protecting it from garbage
//! collection. This type implies there is always a valid value held.
//! For a strong that may be empty (to reuse allocation), use `Optional`.

use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue};

// Note: field renamed from `impl` (Rust keyword) to `handle`.
pub struct Strong {
    handle: NonNull<Impl>,
    // NonNull<T> is already !Send + !Sync, matching the requirement that
    // Strong must be dropped on the JS thread (the StrongRootBlock list hangs
    // off the per-VM JSVMClientData).
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
    pub fn set(&mut self, global: &JSGlobalObject, new_value: JSValue) {
        debug_assert!(!new_value.is_empty());
        Impl::set(self.handle, global, new_value);
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

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to a `Bun::StrongRef` (one occupied slot in a
    /// `Bun::StrongRootBlock`); see StrongRef.cpp.
    pub struct Impl;
}

impl Impl {
    // Low 48 bits of the handle point at the `WriteBarrier<Unknown>` slot (a
    // `JSC::JSValue`); see `encodeStrongRef` in StrongRef.cpp.
    const SLOT_MASK: usize = (1usize << 48) - 1;

    #[inline(always)]
    fn slot_ptr(this: NonNull<Impl>) -> *mut crate::DecodedJSValue {
        (this.as_ptr() as usize & Self::SLOT_MASK) as *mut crate::DecodedJSValue
    }

    pub(crate) fn init(global: &JSGlobalObject, value: JSValue) -> NonNull<Impl> {
        crate::mark_binding!();
        NonNull::new(Bun__StrongRef__new(global, value)).expect("Bun__StrongRef__new returned null")
    }

    #[inline(always)]
    pub fn get(this: NonNull<Impl>) -> JSValue {
        // SAFETY: StrongRef.cpp guarantees the low 48 bits address a live
        // `JSC::JSValue`-sized slot for the lifetime of the handle;
        // `DecodedJSValue` is its `#[repr(C)]` ABI mirror.
        unsafe { (*Self::slot_ptr(this)).encode() }
    }

    pub fn set(this: NonNull<Impl>, global: &JSGlobalObject, value: JSValue) {
        crate::mark_binding!();
        Bun__StrongRef__set(Impl::opaque_ref(this.as_ptr()), global, value);
    }

    #[inline(always)]
    pub(crate) fn clear(this: NonNull<Impl>) {
        // SAFETY: same slot-pointer invariant as `get`; clearing holds no
        // barrier (WriteBarrier<Unknown>::clear() just stores encoded 0).
        unsafe { Self::slot_ptr(this).cast::<i64>().write(0) };
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
        // destructOnExit / WebWorker__teardownJSCVM unprotect the global and
        // run a final full GC whose sweep-time finalizers (and
        // deinit_runtime_state after ~VM) can drop `Strong`s; past that point
        // the encoded StrongRootBlock cell may be unmarked or the heap freed.
        // `is_shutting_down` is set before either path reaches the final
        // collection, and the handle carries no allocation, so skipping the
        // slot release is the whole of teardown. The Rust VM TLS outlives ~VM.
        match crate::virtual_machine::VirtualMachine::get_or_null() {
            Some(vm) => {
                // SAFETY: `get_or_null` returns the thread-local pointer set by
                // `init()`; the allocation outlives the thread.
                if unsafe { (*vm).is_shutting_down() } {
                    return;
                }
            }
            None => {
                // Off the JS thread. `Strong` is !Send, so reaching here means
                // an `unsafe impl Send` wrapper carried one by value and
                // dropped it on a pool thread; the slot (and its rooted value)
                // leak until that VM's teardown. The block bitset/count are
                // not thread-safe to touch here. Flag in debug so the owning
                // wrapper can queue the drop back to the JS thread instead.
                debug_assert!(
                    false,
                    "bun_jsc::Strong dropped off the JS thread; slot leaks"
                );
                return;
            }
        }
        // SAFETY: caller contract guarantees `this` is a live handle from
        // `Bun__StrongRef__new`; C++ releases the block slot it encodes.
        unsafe { Bun__StrongRef__delete(this.as_ptr()) };
    }
}

// `Impl` and `JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles, so
// `&Impl`/`&JSGlobalObject` are ABI-identical to non-null `*const T` and C++
// mutating through them (block slot write) is interior mutation invisible to
// Rust. The handle's low 48 bits point at the slot and the top 16 hold the
// index (no heap allocation); `delete` releases the slot and so stays `unsafe fn`.
unsafe extern "C" {
    fn Bun__StrongRef__delete(this: *mut Impl);
    safe fn Bun__StrongRef__new(global: &JSGlobalObject, value: JSValue) -> *mut Impl;
    safe fn Bun__StrongRef__set(this: &Impl, global: &JSGlobalObject, value: JSValue);
}
