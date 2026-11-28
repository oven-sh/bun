use core::marker::PhantomData;
use core::ptr::NonNull;

/// A pointer that an intrusive container keeps as an address.
/// SAFETY: from `into_raw` until `from_raw` the target is live, stays where it is, and is reached by no
/// `&mut` and no other `IntrusivePtr`.
pub unsafe trait IntrusivePtr {
    type Target;

    fn into_raw(self) -> *mut Self::Target;

    /// SAFETY: `ptr` came from `into_raw`, and is taken back once.
    unsafe fn from_raw(ptr: *mut Self::Target) -> Self;
}

// SAFETY: nothing else reaches a box that was given up.
unsafe impl<T> IntrusivePtr for Box<T> {
    type Target = T;

    fn into_raw(self) -> *mut T {
        bun_core::heap::into_raw(self)
    }

    unsafe fn from_raw(ptr: *mut T) -> Self {
        // SAFETY: fn contract.
        unsafe { bun_core::heap::take(ptr) }
    }
}

/// As `&'static mut T`, but the value may be freed while a function that took this still runs.
pub struct Unique<T>(NonNull<T>, PhantomData<*mut T>);

// SAFETY: as `&mut T`.
unsafe impl<T: Send> Send for Unique<T> {}

impl<T> Unique<T> {
    /// SAFETY: the value stays live and in place, and nothing else uses it, for as long as this is used.
    pub unsafe fn from_raw(ptr: *mut T) -> Self {
        // SAFETY: fn contract.
        Self(unsafe { NonNull::new_unchecked(ptr) }, PhantomData)
    }

    pub fn into_raw(self) -> *mut T {
        self.as_ptr()
    }

    pub fn as_ptr(&self) -> *mut T {
        self.0.as_ptr()
    }
}

impl<T> From<Box<T>> for Unique<T> {
    fn from(value: Box<T>) -> Self {
        Self(Box::into_non_null(value), PhantomData)
    }
}

impl<T> core::ops::Deref for Unique<T> {
    type Target = T;
    fn deref(&self) -> &T {
        // SAFETY: contract of `from_raw`.
        unsafe { self.0.as_ref() }
    }
}

impl<T> core::ops::DerefMut for Unique<T> {
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: contract of `from_raw`.
        unsafe { self.0.as_mut() }
    }
}

// SAFETY: contract of `from_raw`.
unsafe impl<T> IntrusivePtr for Unique<T> {
    type Target = T;

    fn into_raw(self) -> *mut T {
        Unique::into_raw(self)
    }

    unsafe fn from_raw(ptr: *mut T) -> Self {
        // SAFETY: what held before `into_raw` holds again.
        unsafe { Unique::from_raw(ptr) }
    }
}
