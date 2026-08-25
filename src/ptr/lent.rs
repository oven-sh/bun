//! A parent's value lent to a child object for the child's whole life.
//!
//! [`Lent`] / [`LentMut`] are `&T` / `&mut T` whose lifetime is an obligation
//! on the lender instead of a type parameter: **the lender keeps the value
//! alive, at the same address, for as long as the holder exists, and — for
//! `LentMut` — does not touch it while the holder may.** They exist for
//! parent→child loans across an ownership graph the borrow checker cannot see
//! (a server lending its transpiler to the bundle it drives); prefer a real
//! reference whenever a lifetime parameter can express it.

use core::ptr::NonNull;

/// Shared loan; see the module doc for the lender's obligation.
#[repr(transparent)]
pub struct Lent<T: ?Sized>(NonNull<T>);

impl<T: ?Sized> Lent<T> {
    /// The lender's obligation (module doc) starts here.
    #[inline]
    pub fn new(value: &T) -> Self {
        Lent(NonNull::from(value))
    }
}

impl<T: ?Sized> Clone for Lent<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T: ?Sized> Copy for Lent<T> {}

impl<T: ?Sized> core::ops::Deref for Lent<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: the lender keeps the value alive and unmoved (module doc).
        unsafe { self.0.as_ref() }
    }
}

// SAFETY: a `Lent<T>` is a `&T` with an out-of-band lifetime.
unsafe impl<T: ?Sized + Sync> Send for Lent<T> {}
// SAFETY: as above.
unsafe impl<T: ?Sized + Sync> Sync for Lent<T> {}

/// Exclusive loan; see the module doc for the lender's obligation.
#[repr(transparent)]
pub struct LentMut<T: ?Sized>(NonNull<T>);

impl<T: ?Sized> LentMut<T> {
    /// The lender's obligation (module doc) starts here.
    #[inline]
    pub fn new(value: &mut T) -> Self {
        LentMut(NonNull::from(value))
    }

    /// A shared loan of the same value, for holders that only read fields the
    /// exclusive holder leaves alone.
    #[inline]
    pub fn lend(&self) -> Lent<T> {
        Lent(self.0)
    }
}

impl<T: ?Sized> core::ops::Deref for LentMut<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: the lender keeps the value alive and unmoved (module doc).
        unsafe { self.0.as_ref() }
    }
}

impl<T: ?Sized> core::ops::DerefMut for LentMut<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: as `deref`, and the lender does not touch the value while
        // this holder may (module doc).
        unsafe { self.0.as_mut() }
    }
}

// SAFETY: a `LentMut<T>` is a `&mut T` with an out-of-band lifetime.
unsafe impl<T: ?Sized + Send> Send for LentMut<T> {}
// SAFETY: as above.
unsafe impl<T: ?Sized + Sync> Sync for LentMut<T> {}
