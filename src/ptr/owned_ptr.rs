use core::ops::DerefMut;
use core::ptr::NonNull;

/// A pointer that owns its target, like `Box`, and can be stored in an intrusive list or a `void*`.
///
/// # Safety
/// `into_raw` returns the address that `self` dereferences to. It is valid for reads and writes,
/// and nothing else uses it, until it is passed to `from_raw`.
pub unsafe trait OwnedPtr: DerefMut<Target: Sized> {
    fn into_raw(this: Self) -> NonNull<Self::Target>;

    /// # Safety
    /// `ptr` came from `into_raw` of this type, and is passed to `from_raw` once.
    unsafe fn from_raw(ptr: NonNull<Self::Target>) -> Self;
}

// SAFETY: the allocation is leaked until `from_raw`.
unsafe impl<T> OwnedPtr for Box<T> {
    fn into_raw(this: Self) -> NonNull<T> {
        Box::into_non_null(this)
    }

    unsafe fn from_raw(ptr: NonNull<T>) -> Self {
        // SAFETY: fn contract.
        unsafe { bun_core::heap::take(ptr.as_ptr()) }
    }
}
