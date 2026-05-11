#![allow(dead_code)]

use core::fmt;
use core::ptr::NonNull;

// Opaque handle slot allocated by JSC's strong-reference table.
//
// The type crate owns only the pointer identity shape. Allocation, mutation,
// clearing, and destruction stay in `bun_jsc::strong`, which owns the JSC FFI
// calls and the drop semantics.
bun_opaque::opaque_ffi! {
    pub struct StrongRefSlot;
}

/// Non-null identity for a JSC strong-reference slot.
///
/// This is still only an inert handle shape. The crate that owns JSC effects
/// decides when the slot is allocated, read, written, cleared, and destroyed.
#[repr(transparent)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StrongRefHandle(NonNull<StrongRefSlot>);

impl StrongRefHandle {
    /// Wrap a slot pointer allocated by the JSC strong-reference table.
    ///
    /// # Safety
    /// `slot` must be a live strong-reference slot produced by the JSC owner
    /// crate and must remain valid until that owner destroys it.
    #[inline(always)]
    pub unsafe fn from_non_null(slot: NonNull<StrongRefSlot>) -> Self {
        Self(slot)
    }

    /// Wrap a raw slot pointer allocated by the JSC strong-reference table.
    ///
    /// # Safety
    /// `slot` must be non-null and satisfy [`Self::from_non_null`]'s
    /// provenance/lifetime contract.
    #[inline(always)]
    pub unsafe fn from_raw(slot: *mut StrongRefSlot) -> Option<Self> {
        NonNull::new(slot).map(|slot| unsafe { Self::from_non_null(slot) })
    }

    #[inline(always)]
    pub fn as_non_null(self) -> NonNull<StrongRefSlot> {
        self.0
    }

    #[inline(always)]
    pub fn as_ptr(self) -> *mut StrongRefSlot {
        self.0.as_ptr()
    }
}

/// VM-lifetime handle to a JSC-owned global object.
///
/// This is only pointer identity. The concrete JSC crate supplies the typed
/// alias (`bun_jsc::GlobalRef = GlobalRef<JSGlobalObject>`) and keeps all
/// effectful operations on `JSGlobalObject` itself.
#[repr(transparent)]
pub struct GlobalRef<T = ()>(*const T);

impl<T> Copy for GlobalRef<T> {}

impl<T> Clone for GlobalRef<T> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> GlobalRef<T> {
    #[inline(always)]
    pub fn new(global: &T) -> Self {
        Self(core::ptr::from_ref(global))
    }

    /// Raw FFI pointer.
    #[inline(always)]
    pub fn as_ptr(self) -> *mut T {
        self.0.cast_mut()
    }

    #[inline(always)]
    pub fn cast<U>(self) -> GlobalRef<U> {
        GlobalRef(self.0.cast::<U>())
    }
}

impl<T> core::ops::Deref for GlobalRef<T> {
    type Target = T;

    #[inline(always)]
    fn deref(&self) -> &T {
        // SAFETY: constructed only from a live `&T`; callers uphold that the
        // referenced JSC object outlives every stored handle.
        unsafe { &*self.0 }
    }
}

impl<T> From<&T> for GlobalRef<T> {
    #[inline(always)]
    fn from(global: &T) -> Self {
        Self::new(global)
    }
}

impl<T> fmt::Debug for GlobalRef<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("GlobalRef").field(&self.0).finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strong_ref_handle_preserves_pointer_shape() {
        assert_eq!(
            core::mem::size_of::<StrongRefHandle>(),
            core::mem::size_of::<usize>()
        );
        assert_eq!(
            core::mem::size_of::<Option<StrongRefHandle>>(),
            core::mem::size_of::<usize>()
        );

        let slot = NonNull::<StrongRefSlot>::dangling();
        let handle = unsafe { StrongRefHandle::from_non_null(slot) };
        assert_eq!(handle.as_non_null(), slot);
        assert_eq!(
            unsafe { StrongRefHandle::from_raw(handle.as_ptr()) },
            Some(handle)
        );
        assert_eq!(unsafe { StrongRefHandle::from_raw(core::ptr::null_mut()) }, None);
    }
}
