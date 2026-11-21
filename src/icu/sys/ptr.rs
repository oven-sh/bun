//! Safe wrappers of raw pointers.

use bun_core::heap;
use std::ffi::{CStr, c_char};
use std::marker::PhantomData;
use std::ops::{Deref, DerefMut};
use std::ptr::NonNull;
use std::sync::atomic::AtomicPtr;
use std::sync::atomic::Ordering::{Acquire, Release};

/// A `Box` that does not assert unique access when it is moved: C keeps a pointer to the value and writes through it between calls.
pub(crate) struct AliasableBox<T> {
    ptr: NonNull<T>,
    owns: PhantomData<T>,
}

// SAFETY: it owns a `T`, like `Box`.
unsafe impl<T: Send> Send for AliasableBox<T> {}
// SAFETY: `&self` gives access to `&T` only, like `Box`. `as_ptr` returns a raw pointer.
unsafe impl<T: Sync> Sync for AliasableBox<T> {}

impl<T> AliasableBox<T> {
    /// Returns a pointer that is valid for reads and writes while no reference from `deref` or `deref_mut` is alive.
    pub(crate) fn as_ptr(this: &Self) -> *mut T {
        this.ptr.as_ptr()
    }
}

impl<T> From<Box<T>> for AliasableBox<T> {
    fn from(boxed: Box<T>) -> Self {
        Self {
            ptr: heap::into_raw_nn(boxed),
            owns: PhantomData,
        }
    }
}

impl<T> Deref for AliasableBox<T> {
    type Target = T;

    fn deref(&self) -> &T {
        // SAFETY: `self` owns the value. Users of `as_ptr` do not write while the reference is alive.
        unsafe { self.ptr.as_ref() }
    }
}

impl<T> DerefMut for AliasableBox<T> {
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: `self` owns the value. Users of `as_ptr` neither read nor write while the reference is alive.
        unsafe { self.ptr.as_mut() }
    }
}

impl<T> Drop for AliasableBox<T> {
    fn drop(&mut self) {
        // SAFETY: `ptr` comes from a `Box`, and `self` is its only owner.
        unsafe { heap::destroy(self.ptr.as_ptr()) };
    }
}

/// An atomically replaceable `&'static T`.
pub(crate) struct AtomicRef<T>(AtomicPtr<T>, PhantomData<&'static T>)
where
    T: 'static;

impl<T> AtomicRef<T> {
    pub(crate) const fn new(value: &'static T) -> Self {
        Self(
            AtomicPtr::new(std::ptr::from_ref(value).cast_mut()),
            PhantomData,
        )
    }

    #[inline]
    pub(crate) fn get(&self) -> &'static T {
        // SAFETY: the pointer was made from a `&'static T`.
        unsafe { &*self.0.load(Acquire) }
    }

    pub(crate) fn set(&self, value: &'static T) {
        self.0.store(std::ptr::from_ref(value).cast_mut(), Release);
    }
}

/// Returns the bytes before the NUL.
/// SAFETY: As for [`CStr::from_ptr`].
#[inline]
pub(crate) unsafe fn c_bytes<'a>(s: *const c_char) -> &'a [u8] {
    // SAFETY: the caller's.
    unsafe { CStr::from_ptr(s) }.to_bytes()
}
