//! Holds a strong reference to a JS value, protecting it from garbage
//! collection. This type implies there is always a valid value held.
//! For a strong that may be empty (to reuse allocation), use `Optional`.

use core::ptr::NonNull;

use crate::{JSGlobalObject, JSValue};

/// The C++ allocation itself. Only the extern declarations below name this
/// type; all Rust code uses the owning [`Impl`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// A `JSC::HandleSet` slot (`JSC::JSValue*`); see StrongRef.cpp. `&Self`
        /// is ABI-identical to a non-null slot pointer and carries no
        /// `noalias`/`readonly` — JSC writes the slot through it.
        pub struct Impl;
    }
}

/// A corrupted slot pointer segfaults inside JSC's `HandleBlock::handleSet`,
/// which loses the Rust caller frame; panicking here names the exact owner.
/// `0x10000` is Windows' null-page guard — real slots are bmalloc'd far above.
fn strong_ref_delete(slot: &sys::Impl) {
    if cfg!(debug_assertions) {
        assert!(
            (std::ptr::from_ref(slot) as usize) >= 0x10000,
            "Strong::drop: corrupted HandleSlot pointer {slot:p}"
        );
    }
    Bun__StrongRef__delete(slot)
}

// `Bun__StrongRef__new` allocates a HandleSlot from the VM's HandleSet and
// hands back its sole owner. One `Impl` handle owns exactly that one slot.
bun_opaque::foreign_handle! {
    /// Owned handle to one `JSC::HandleSet` slot rooting a `JSValue`.
    ///
    /// `Drop` deallocates the slot. Every method takes `&self`: JSC writes the slot
    /// through the same pointer, and deallocating it is not exclusive access.
    pub struct Impl(sys::Impl) via strong_ref_delete;
}

/// Slot lifecycle and access. `&self` throughout: JSC mutates the slot.
impl Impl {
    /// C++ allocates the slot and hands back its sole owner.
    pub fn init(global: &JSGlobalObject, value: JSValue) -> Self {
        crate::mark_binding!();
        let p = NonNull::new(Bun__StrongRef__new(global, value))
            .expect("Bun__StrongRef__new returned null");
        // SAFETY: freshly allocated slot, owned by nobody else.
        unsafe { Self::adopt(p) }
    }

    pub fn get(&self) -> JSValue {
        // The slot *is* a `JSC::JSValue`; see StrongRef.cpp.
        // SAFETY: the slot is a live, aligned JSC::JSValue for `self`'s
        // lifetime; `DecodedJSValue` is its `#[repr(C)]` ABI-compatible mirror.
        unsafe { (*self.as_ptr().cast::<crate::DecodedJSValue>()).encode() }
    }

    pub fn set(&self, global: &JSGlobalObject, value: JSValue) {
        crate::mark_binding!();
        Bun__StrongRef__set(self.raw(), global, value);
    }

    pub fn clear(&self) {
        crate::mark_binding!();
        Bun__StrongRef__clear(self.raw());
    }
}

// `ForeignRef` is !Send + !Sync, matching the requirement that Strong must be
// dropped on the JS thread (HandleSet is VM-owned).
#[repr(transparent)]
pub struct Strong(Impl);

impl Strong {
    /// Hold a strong reference to a JavaScript value. Released on `Drop`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Strong {
        debug_assert!(!value.is_empty());
        Strong(Impl::init(global, value))
    }

    pub fn get(&self) -> JSValue {
        let result = self.0.get();
        debug_assert!(!result.is_empty());
        result
    }

    /// Set a new value for the strong reference.
    pub fn set(&mut self, global: &JSGlobalObject, new_value: JSValue) {
        debug_assert!(!new_value.is_empty());
        self.0.set(global, new_value);
    }

    /// Swap a new value for the strong reference.
    pub fn swap(&mut self, global: &JSGlobalObject, new_value: JSValue) -> JSValue {
        let result = self.0.get();
        self.set(global, new_value);
        result
    }

    /// Adopt a slot allocated externally (e.g. by C++ bindgen glue), taking
    /// ownership. The slot is deallocated on `Drop`.
    ///
    /// # Safety
    /// `handle` must have been produced by `Bun__StrongRef__new` (or equivalent)
    /// and must not be owned by any other `Strong`/`Optional`.
    pub unsafe fn adopt(handle: NonNull<sys::Impl>) -> Strong {
        // SAFETY: caller transfers the allocation.
        Strong(unsafe { Impl::adopt(handle) })
    }
}

/// Holds a strong reference to a JS value, protecting it from garbage
/// collection. When not holding a value, the strong may still be allocated.
// `#[repr(transparent)]` over a niche-optimized `Option<Impl>` (one nullable
// pointer) keeps this FFI-safe when embedded in `extern "C"` structs.
#[repr(transparent)]
#[derive(Default)]
pub struct Optional(Option<Impl>);

impl Optional {
    pub const fn empty() -> Optional {
        Optional(None)
    }

    /// Adopt a slot allocated externally (e.g. by C++ bindgen glue), taking
    /// ownership if non-null. The slot is deallocated on `Drop`.
    ///
    /// # Safety
    /// If `Some`, `handle` must have been produced by `Bun__StrongRef__new`
    /// (or equivalent) and must not be owned by any other `Strong`/`Optional`.
    pub unsafe fn adopt(handle: Option<NonNull<sys::Impl>>) -> Optional {
        // SAFETY: caller transfers the allocation, if any.
        Optional(handle.map(|p| unsafe { Impl::adopt(p) }))
    }

    /// Hold a strong reference to a JavaScript value. Released on `Drop` or `clear`.
    pub fn create(value: JSValue, global: &JSGlobalObject) -> Optional {
        if !value.is_empty() {
            Optional(Some(Impl::init(global, value)))
        } else {
            Optional::empty()
        }
    }

    /// Clears the value, but does not de-allocate the Strong reference.
    pub fn clear_without_deallocation(&mut self) {
        let Some(r) = &self.0 else { return };
        r.clear();
    }

    pub fn call(&mut self, global: &JSGlobalObject, args: &[JSValue]) -> JSValue {
        let Some(function) = self.try_swap() else {
            return JSValue::ZERO;
        };
        function
            .call(global, JSValue::UNDEFINED, args)
            .unwrap_or(JSValue::ZERO)
    }

    pub fn get(&self) -> Option<JSValue> {
        let result = self.0.as_ref()?.get();
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    pub fn swap(&mut self) -> JSValue {
        let Some(imp) = &self.0 else {
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
        let Some(r) = &self.0 else { return false };
        !r.get().is_empty()
    }

    pub fn try_swap(&mut self) -> Option<JSValue> {
        let result = self.swap();
        if result.is_empty() {
            return None;
        }
        Some(result)
    }

    /// Explicit teardown. Idempotent; leaves `self` empty.
    pub fn deinit(&mut self) {
        drop(self.0.take());
    }

    pub fn set(&mut self, global: &JSGlobalObject, value: JSValue) {
        if let Some(r) = &self.0 {
            r.set(global, value);
        } else if !value.is_empty() {
            self.0 = Some(Impl::init(global, value));
        }
    }
}

// `sys::Impl` and `JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles,
// so `&T` is ABI-identical to a non-null `*const T` and the HandleSet slot
// write C++ performs through them is interior mutation invisible to Rust.
unsafe extern "C" {
    // safe: C++ hands the slot to `HandleSet::deallocate`. Deallocating is not
    // exclusive access — the slot is JSC's, not Rust's — so the receiver is
    // `&`, not `&mut`. `foreign_owned!` requires a `safe fn` here.
    safe fn Bun__StrongRef__delete(this: &sys::Impl);
    safe fn Bun__StrongRef__new(global: &JSGlobalObject, value: JSValue) -> *mut sys::Impl;
    safe fn Bun__StrongRef__set(this: &sys::Impl, global: &JSGlobalObject, value: JSValue);
    safe fn Bun__StrongRef__clear(this: &sys::Impl);
}

pub use crate::deprecated_strong as deprecated;
