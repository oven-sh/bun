//! Safe wrappers of raw pointers.

use bun_core::{heap, try_cast_slice};
use std::ffi::{CStr, c_char};
use std::marker::PhantomData;
use std::mem::ManuallyDrop;
use std::ops::{Deref, DerefMut};
use std::ptr::NonNull;
use std::sync::atomic::Ordering::{AcqRel, Acquire, Relaxed, Release};
use std::sync::atomic::{AtomicPtr, AtomicU16, AtomicU32};

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

/// 16-bit units that are set once and never freed. The first one is their number.
#[derive(Default)]
pub(crate) struct OnceUnits(AtomicPtr<u16>);

impl OnceUnits {
    #[inline]
    pub(crate) fn get(&self) -> Option<&'static [[u8; 2]]> {
        let units = NonNull::new(self.0.load(Acquire))?;
        // SAFETY: `set` has leaked as many units as the first one says.
        Some(unsafe { std::slice::from_raw_parts(units.as_ptr().cast(), units.read().into()) })
    }

    /// Drops `units` if another thread was first, or if the number is wrong.
    pub(crate) fn set(&self, units: Vec<u16>) {
        let mut units = ManuallyDrop::new(units);
        let (null, new) = (std::ptr::null_mut(), units.as_mut_ptr());
        if units.first().map(|&count| count.into()) != Some(units.len())
            || self.0.compare_exchange(null, new, AcqRel, Acquire).is_err()
        {
            drop(ManuallyDrop::into_inner(units));
        }
    }
}

/// An atomic integer that may be in read-only memory, where nothing but a relaxed load is allowed.
#[repr(transparent)]
pub(crate) struct LoadOnly<A>(A);

impl<A> LoadOnly<A> {
    pub(crate) fn slice_of(atomics: &[A]) -> &[Self] {
        // SAFETY: `Self` is transparent.
        unsafe { std::slice::from_raw_parts(atomics.as_ptr().cast(), atomics.len()) }
    }
}

macro_rules! load_only {
    ($($atomic:ident $int:ident,)*) => {$(
        impl LoadOnly<$atomic> {
            /// Returns `None` unless `bytes` is aligned.
            pub(crate) fn slice_in(bytes: &[u8]) -> Option<&[Self]> {
                let whole = bytes.as_chunks::<{ size_of::<$int>() }>().0.as_flattened();
                let numbers = try_cast_slice::<u8, $int>(whole)?;
                // SAFETY: `Self` has the size and the alignment of the number on all targets, and does not write.
                Some(unsafe { std::slice::from_raw_parts(numbers.as_ptr().cast(), numbers.len()) })
            }

            #[inline(always)]
            pub(crate) fn load(&self) -> $int {
                self.0.load(Relaxed)
            }
        }
    )*};
}

load_only!(AtomicU16 u16, AtomicU32 u32,);

/// Returns the bytes before the NUL.
/// SAFETY: As for [`CStr::from_ptr`].
#[inline]
pub(crate) unsafe fn c_bytes<'a>(s: *const c_char) -> &'a [u8] {
    // SAFETY: the caller's.
    unsafe { CStr::from_ptr(s) }.to_bytes()
}
