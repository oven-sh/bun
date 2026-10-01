use core::ptr::NonNull;

/// Protocol for types whose reference count is managed externally (e.g., by extern functions).
///
/// # Safety
/// Implementors guarantee that `ext_ref`/`ext_deref` operate on a valid externally-owned
/// reference count, and that the pointee remains alive while the count is > 0.
// Named `ext_ref`/`ext_deref` to avoid the `ref` keyword and
// `core::ops::Deref::deref` confusion.
pub unsafe trait ExternalSharedDescriptor {
    unsafe fn ext_ref(this: *mut Self);
    unsafe fn ext_deref(this: *mut Self);
}

/// A shared pointer whose reference count is managed externally; e.g., by extern functions.
///
/// `T` must implement [`ExternalSharedDescriptor`].
#[repr(transparent)]
pub struct ExternalShared<T: ExternalSharedDescriptor> {
    ptr: NonNull<T>,
}

impl<T: ExternalSharedDescriptor> ExternalShared<T> {
    /// `incremented_raw` should have already had its ref count incremented by 1.
    ///
    /// # Safety
    /// `incremented_raw` must be a valid pointer with at least one outstanding ref that
    /// ownership of is being transferred to the returned `ExternalShared`.
    pub unsafe fn adopt(incremented_raw: *mut T) -> Self {
        Self {
            // SAFETY: caller contract requires `incremented_raw` to be a valid
            // (hence non-null) pointer.
            ptr: unsafe { NonNull::new_unchecked(incremented_raw) },
        }
    }

    /// Gets the underlying pointer. This pointer may not be valid after `self` is dropped.
    pub fn get(&self) -> *mut T {
        self.ptr.as_ptr()
    }

    /// # Safety
    /// `raw` must be a valid pointer managed by the external refcount.
    pub unsafe fn clone_from_raw(raw: *mut T) -> Self {
        // SAFETY: caller contract.
        unsafe { T::ext_ref(raw) };
        Self {
            // SAFETY: caller contract requires `raw` to be a valid (hence
            // non-null) pointer.
            ptr: unsafe { NonNull::new_unchecked(raw) },
        }
    }
}

impl<T: ExternalSharedDescriptor> core::ops::Deref for ExternalShared<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: `ExternalSharedDescriptor` guarantees the pointee remains
        // alive while the externally-managed refcount is > 0, and `self` owns
        // exactly one such ref for its entire lifetime (released only in
        // `Drop`). The pointee is treated as shared-immutable from Rust's
        // side; any C++-side mutation goes through `UnsafeCell`/opaque-FFI
        // interior mutability on `T` itself, so `&T` carries no `noalias
        // readonly` assumption that the FFI could violate.
        unsafe { self.ptr.as_ref() }
    }
}

/// Clones the shared pointer, incrementing the ref count.
impl<T: ExternalSharedDescriptor> Clone for ExternalShared<T> {
    fn clone(&self) -> Self {
        // SAFETY: `self.ptr` is valid while `self` is alive.
        unsafe { T::ext_ref(self.ptr.as_ptr()) };
        Self { ptr: self.ptr }
    }
}

/// Deinitializes the shared pointer, decrementing the ref count.
impl<T: ExternalSharedDescriptor> Drop for ExternalShared<T> {
    fn drop(&mut self) {
        // SAFETY: `self.ptr` is valid; we hold one ref which we now release.
        unsafe { T::ext_deref(self.ptr.as_ptr()) };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `WTF::StringImpl` descriptor — lives here (not `bun_string`) because the
// struct is defined in `bun_alloc` and the trait here; orphan rule requires
// one of them to be local. `bun_ptr` already depends on `bun_alloc`.
// ──────────────────────────────────────────────────────────────────────────

// SAFETY: ref/deref delegate to JSC's WTF::StringImpl atomic refcount via FFI;
// the pointee remains valid while count > 0 (JSC contract).
unsafe impl ExternalSharedDescriptor for bun_alloc::WTFStringImplStruct {
    unsafe fn ext_ref(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live WTFStringImpl.
        unsafe { (*this).r#ref() }
    }
    unsafe fn ext_deref(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live WTFStringImpl.
        unsafe { (*this).deref() }
    }
}

/// Behaves like `WTF::Ref<WTF::StringImpl>`.
pub type WTFString = ExternalShared<bun_alloc::WTFStringImplStruct>;
