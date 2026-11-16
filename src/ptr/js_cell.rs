/// An `UnsafeCell<T>` whose safe `get` and `with_mut` leave it to the caller that no borrows overlap.
#[repr(transparent)]
pub struct JsCell<T>(core::cell::UnsafeCell<T>);

impl<T> JsCell<T> {
    #[inline(always)]
    pub const fn new(value: T) -> Self {
        Self(core::cell::UnsafeCell::new(value))
    }

    /// Nothing may write to the cell while the reference is live.
    #[inline(always)]
    pub fn get(&self) -> &T {
        // SAFETY: left to the caller, see the type's docs.
        unsafe { &*self.0.get() }
    }

    /// Mutable-reference projection from `&self`.
    ///
    /// # Safety
    ///
    /// Caller must guarantee that **no other reference** (`&T` or `&mut T`) to
    /// the contained value is live for the lifetime of the returned borrow.
    /// Same-thread *reentrancy* (host fn → JS → host fn) can produce
    /// stacked `&mut T` if a borrow is held across a call that re-enters.
    /// Keep the borrow short and do not hold it across any call that may
    /// reach back into code touching this cell.
    ///
    /// Prefer [`Self::with_mut`] when the mutation fits in a closure: its
    /// borrow cannot escape.
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn get_mut(&self) -> &mut T {
        // SAFETY: forwarded to caller — see fn-level contract.
        unsafe { &mut *self.0.get() }
    }

    /// Mutable reference for a caller that borrows the cell exclusively, like `Cell::get_mut`.
    #[inline(always)]
    pub fn as_mut(&mut self) -> &mut T {
        self.0.get_mut()
    }

    /// No reference from [`Self::get`] may be live, and `f` must not reach this cell again.
    #[inline(always)]
    pub fn with_mut<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        // SAFETY: left to the caller, see the type's docs.
        f(unsafe { &mut *self.0.get() })
    }

    /// Overwrite the contained value. Like `Cell::set`, the old value is
    /// dropped *after* the write, with no borrow of the cell live — so a `Drop`
    /// that re-enters (or frees the struct holding this cell) is sound.
    #[inline(always)]
    pub fn set(&self, value: T) {
        drop(self.replace(value));
    }

    /// Replace the contained value, returning the old one.
    #[inline(always)]
    pub fn replace(&self, value: T) -> T {
        self.with_mut(|slot| core::mem::replace(slot, value))
    }

    /// Raw pointer to the inner `T` — for FFI / `addr_of!` paths that must
    /// not form a reference.
    #[inline(always)]
    pub const fn as_ptr(&self) -> *mut T {
        self.0.get()
    }
}

impl<T: Default> JsCell<T> {
    /// Move the value out, leaving `T::default()` behind.
    #[inline(always)]
    pub fn take(&self) -> T {
        self.replace(T::default())
    }
}

impl<T: Default> Default for JsCell<T> {
    #[inline(always)]
    fn default() -> Self {
        Self::new(T::default())
    }
}

impl<T: Clone> Clone for JsCell<T> {
    #[inline(always)]
    fn clone(&self) -> Self {
        Self::new(self.get().clone())
    }
}

impl<T> From<T> for JsCell<T> {
    #[inline(always)]
    fn from(value: T) -> Self {
        Self::new(value)
    }
}

impl<T: core::fmt::Debug> core::fmt::Debug for JsCell<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.get().fmt(f)
    }
}
