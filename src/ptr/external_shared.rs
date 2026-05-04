use core::ptr::NonNull;

/// Protocol for types whose reference count is managed externally (e.g., by extern functions).
///
/// In Zig this is duck-typed via `T.external_shared_descriptor = struct { ref, deref }`.
/// In Rust the type implements this trait directly.
///
/// # Safety
/// Implementors guarantee that `ext_ref`/`ext_deref` operate on a valid externally-owned
/// reference count, and that the pointee remains alive while the count is > 0.
// TODO(port): Zig names are `ref`/`deref`; renamed to avoid the `ref` keyword and
// `core::ops::Deref::deref` confusion. Revisit naming in Phase B.
pub unsafe trait ExternalSharedDescriptor {
    unsafe fn ext_ref(this: *mut Self);
    unsafe fn ext_deref(this: *mut Self);
}

/// A shared pointer whose reference count is managed externally; e.g., by extern functions.
///
/// `T` must implement [`ExternalSharedDescriptor`] (the Rust equivalent of Zig's
/// `T.external_shared_descriptor` struct with `ref(*T)` / `deref(*T)`).
#[repr(transparent)]
pub struct ExternalShared<T: ExternalSharedDescriptor> {
    // Zig: `#impl: *T` (private, non-null)
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
            // SAFETY: Zig `*T` is non-null by construction.
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
            // SAFETY: Zig `*T` is non-null.
            ptr: unsafe { NonNull::new_unchecked(raw) },
        }
    }

    /// Returns the raw pointer without decrementing the ref count. Consumes `self`.
    pub fn leak(self) -> *mut T {
        let ptr = self.ptr.as_ptr();
        core::mem::forget(self);
        ptr
    }

    /// Consumes `self`, converting into the optional form.
    pub fn into_optional(self) -> ExternalSharedOptional<T> {
        let ptr = self.ptr;
        core::mem::forget(self);
        ExternalSharedOptional { ptr: Some(ptr) }
    }

    /// Associated optional type (mirrors Zig's nested `Optional`).
    pub type Optional = ExternalSharedOptional<T>;
    // TODO(port): inherent associated types are unstable (feature(inherent_associated_types)).
    // Phase B: either gate on nightly or have callers spell `ExternalSharedOptional<T>` directly.
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

/// Optional variant of [`ExternalShared`] (Zig: `ExternalShared(T).Optional`).
#[repr(transparent)]
pub struct ExternalSharedOptional<T: ExternalSharedDescriptor> {
    // Zig: `#impl: ?*T = null`
    ptr: Option<NonNull<T>>,
}

impl<T: ExternalSharedDescriptor> ExternalSharedOptional<T> {
    pub const fn init_null() -> Self {
        Self { ptr: None }
    }

    /// `incremented_raw`, if non-null, should have already had its ref count incremented by 1.
    ///
    /// # Safety
    /// If non-null, `incremented_raw` must be valid and carry one transferred ref.
    pub unsafe fn adopt(incremented_raw: *mut T) -> Self {
        Self {
            ptr: NonNull::new(incremented_raw),
        }
    }

    pub fn get(&self) -> Option<*mut T> {
        self.ptr.map(|p| p.as_ptr())
    }

    /// Sets `self` to null, returning the non-optional pointer if present.
    pub fn take(&mut self) -> Option<ExternalShared<T>> {
        let ptr = self.ptr.take()?;
        Some(ExternalShared { ptr })
    }

    /// # Safety
    /// If non-null, `raw` must be a valid pointer managed by the external refcount.
    pub unsafe fn clone_from_raw(raw: *mut T) -> Self {
        if let Some(some_raw) = NonNull::new(raw) {
            // SAFETY: caller contract.
            unsafe { T::ext_ref(some_raw.as_ptr()) };
        }
        Self {
            ptr: NonNull::new(raw),
        }
    }

    /// Returns the raw pointer without decrementing the ref count. Consumes `self`.
    pub fn leak(self) -> Option<*mut T> {
        let ptr = self.ptr.map(|p| p.as_ptr());
        core::mem::forget(self);
        ptr
    }
}

impl<T: ExternalSharedDescriptor> Default for ExternalSharedOptional<T> {
    fn default() -> Self {
        Self::init_null()
    }
}

impl<T: ExternalSharedDescriptor> Clone for ExternalSharedOptional<T> {
    fn clone(&self) -> Self {
        if let Some(ptr) = self.ptr {
            // SAFETY: `ptr` is valid while `self` is alive.
            unsafe { T::ext_ref(ptr.as_ptr()) };
        }
        Self { ptr: self.ptr }
    }
}

impl<T: ExternalSharedDescriptor> Drop for ExternalSharedOptional<T> {
    fn drop(&mut self) {
        if let Some(ptr) = self.ptr {
            // SAFETY: `ptr` is valid; we hold one ref which we now release.
            unsafe { T::ext_deref(ptr.as_ptr()) };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/ptr/external_shared.zig (114 lines)
//   confidence: medium
//   todos:      2
//   notes:      duck-typed `external_shared_descriptor` → trait; nested `Optional` hoisted to `ExternalSharedOptional<T>` (inherent assoc types unstable); `ref`/`deref` renamed to `ext_ref`/`ext_deref` to dodge keyword/Deref collision
// ──────────────────────────────────────────────────────────────────────────
