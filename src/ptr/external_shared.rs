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

    /// Alias of [`Self::get`] — provided so call sites that previously used a
    /// hand-rolled `NonNull` wrapper (e.g. `AbortSignalRef`) keep compiling.
    #[inline]
    pub fn as_ptr(&self) -> *mut T {
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

    // TODO(port): Zig's `ExternalShared(T).Optional` was an inherent associated type.
    // Stable Rust callers spell `ExternalSharedOptional<T>` directly.
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

// ported from: src/ptr/external_shared.zig
