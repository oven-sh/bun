//! Safe wrappers of raw pointers.

use std::ffi::{CStr, c_char};
use std::marker::PhantomData;
use std::sync::atomic::AtomicPtr;
use std::sync::atomic::Ordering::{Acquire, Release};

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
