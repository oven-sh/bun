use std::{cell::UnsafeCell, ptr};

///Vibe cell for T-s that are !Sync but they have Sync vibe
#[repr(transparent)]
#[deprecated(
    note = "This cell is a temporary stopgap for a lot of RacyCells that broke after making RacyCell sound"
)]
pub struct SyncVibeCell<T: ?Sized>(UnsafeCell<T>);

unsafe impl<T: ?Sized> Sync for SyncVibeCell<T> {}
unsafe impl<T: ?Sized + Send> Send for SyncVibeCell<T> {}

impl<T: ?Sized> SyncVibeCell<T> {
    /// Raw pointer to the contained value. Never produces a reference; callers
    /// deref per-access (`unsafe { *X.get() }` / `unsafe { (*X.get()).field }`).
    #[inline]
    pub const fn get(&self) -> *mut T {
        self.0.get()
    }
}

impl<T> SyncVibeCell<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self(UnsafeCell::new(value))
    }

    /// Convenience: read a `Copy` value. Single load, no aliasing assertion.
    ///
    /// # Safety
    /// Caller guarantees no concurrent writer on another thread.
    #[inline]
    pub unsafe fn read(&self) -> T
    where
        T: Copy,
    {
        unsafe { ptr::read(self.0.get()) }
    }

    /// Convenience: overwrite the value.
    ///
    /// # Safety
    /// Caller guarantees no concurrent reader/writer on another thread.
    /// Caller should also ensure that value is not Drop
    #[inline]
    pub unsafe fn write(&self, value: T) {
        unsafe {
            ptr::write(self.get(), value);
        }
    }
}

impl<T: Default> Default for SyncVibeCell<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}
