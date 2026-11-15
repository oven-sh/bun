//! Holds a strong reference to a JS value, protecting it from garbage
//! collection. This type implies there is always a valid value held.
//! For a strong that may be empty (to reuse allocation), use `Optional`.

use core::cell::Cell;
use core::ptr::NonNull;

use bun_ptr::{CellExt as _, OptionCellExt as _};

use crate::{JSGlobalObject, JSValue};

// Note: field renamed from `impl` (Rust keyword) to `handle`.
pub struct Strong {
    handle: OwnedImpl,
    // NonNull<T> is already !Send + !Sync, matching the requirement that
    // Strong must be dropped on the JS thread (the StrongRootBlock list hangs
    // off the per-VM JSVMClientData).
}

impl Strong {
    /// Hold a strong reference to a JavaScript value. Released on `Drop`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Strong {
        debug_assert!(!value.is_empty());
        Strong {
            handle: OwnedImpl::new(global, value),
        }
    }

    pub fn get(&self) -> JSValue {
        let result = self.handle.get();
        debug_assert!(!result.is_empty());
        result
    }

    /// Set a new value for the strong reference.
    pub fn set(&mut self, global: &JSGlobalObject, new_value: JSValue) {
        debug_assert!(!new_value.is_empty());
        self.handle.set(global, new_value);
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
    handle: Option<OwnedImpl>,
}

impl Optional {
    pub const fn empty() -> Optional {
        Optional { handle: None }
    }

    /// Hold a strong reference to a JavaScript value. Released on `Drop` or `clear`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Optional {
        if !value.is_empty() {
            Optional {
                handle: Some(OwnedImpl::new(global, value)),
            }
        } else {
            Optional::empty()
        }
    }

    /// Clears the value, but does not de-allocate the Strong reference.
    pub fn clear_without_deallocation(&mut self) {
        let Some(r) = &self.handle else { return };
        r.clear();
    }

    pub fn get(&self) -> Option<JSValue> {
        let result = self.handle.as_ref()?.get();
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    pub fn swap(&mut self) -> JSValue {
        let Some(imp) = &self.handle else {
            return JSValue::ZERO;
        };
        let result = imp.get();
        if result.is_empty() {
            return JSValue::ZERO;
        }
        imp.clear();
        result
    }

    pub fn has(&self) -> bool {
        let Some(r) = &self.handle else { return false };
        !r.get().is_empty()
    }

    pub fn try_swap(&mut self) -> Option<JSValue> {
        let result = self.swap();
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    pub fn set(&mut self, global: &JSGlobalObject, value: JSValue) {
        let Some(r) = &self.handle else {
            if value.is_empty() {
                return;
            }
            self.handle = Some(OwnedImpl::new(global, value));
            return;
        };
        r.set(global, value);
    }
}

/// An optional `Strong` that is set and cleared through `&self`.
#[derive(Default)]
pub struct StrongCell(Cell<Option<Strong>>);

impl From<Option<Strong>> for StrongCell {
    fn from(value: Option<Strong>) -> StrongCell {
        StrongCell(Cell::new(value))
    }
}

impl StrongCell {
    pub fn get(&self) -> Option<JSValue> {
        self.0.with_taken(|value| value.as_ref().map(Strong::get))
    }

    pub fn is_some(&self) -> bool {
        self.0.is_some()
    }

    pub fn set(&self, value: Strong) {
        self.0.set(Some(value));
    }

    pub fn clear(&self) {
        self.0.set(None);
    }
}

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to a `Bun::StrongRef` (one occupied slot in a
    /// `Bun::StrongRootBlock`); see StrongRef.cpp.
    struct Impl;
}

#[repr(transparent)]
struct OwnedImpl(NonNull<Impl>);

impl OwnedImpl {
    // Low 48 bits of the handle point at the `WriteBarrier<Unknown>` slot (a
    // `JSC::JSValue`); see `encodeStrongRef` in StrongRef.cpp.
    const SLOT_MASK: usize = (1usize << 48) - 1;

    #[inline(always)]
    fn slot_ptr(&self) -> *mut crate::DecodedJSValue {
        (self.0.as_ptr() as usize & Self::SLOT_MASK) as *mut crate::DecodedJSValue
    }

    fn new(global: &JSGlobalObject, value: JSValue) -> OwnedImpl {
        crate::mark_binding!();
        Bun__StrongRef__new(global, value)
    }

    #[inline(always)]
    fn get(&self) -> JSValue {
        // SAFETY: StrongRef.cpp guarantees the low 48 bits address a live
        // `JSC::JSValue`-sized slot for the lifetime of the handle;
        // `DecodedJSValue` is its `#[repr(C)]` ABI mirror.
        unsafe { (*self.slot_ptr()).encode() }
    }

    fn set(&self, global: &JSGlobalObject, value: JSValue) {
        crate::mark_binding!();
        // SAFETY: the handle that `self` owns.
        unsafe { Bun__StrongRef__set(self.0.as_ptr(), global, value) };
    }

    #[inline(always)]
    fn clear(&self) {
        // SAFETY: same slot-pointer invariant as `get`; clearing holds no
        // barrier (WriteBarrier<Unknown>::clear() just stores encoded 0).
        unsafe { self.slot_ptr().cast::<i64>().write(0) };
    }
}

impl Drop for OwnedImpl {
    fn drop(&mut self) {
        let this = self.0;
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
                if vm.is_shutting_down() {
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
        // SAFETY: the handle that `self` owns; C++ releases the block slot it encodes.
        unsafe { Bun__StrongRef__delete(this.as_ptr()) };
    }
}

// The handle's low 48 bits point at the slot and the top 16 hold the index (no heap allocation).
unsafe extern "C" {
    fn Bun__StrongRef__delete(this: *mut Impl);
    safe fn Bun__StrongRef__new(global: &JSGlobalObject, value: JSValue) -> OwnedImpl;
    fn Bun__StrongRef__set(this: *mut Impl, global: &JSGlobalObject, value: JSValue);
}
