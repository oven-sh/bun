/// `JsCell<T>` is a `#[repr(transparent)]` wrapper over `UnsafeCell<T>` that
/// hands out `&mut T` from `&self`. It is the load-bearing primitive that lets
/// `VirtualMachine::get()` / `JSGlobalObject::bun_vm()` return a *safe*
/// `&'static VirtualMachine` while still permitting field mutation.
///
/// ## Soundness model
///
/// Bun runs **one** `VirtualMachine` per JS thread. JavaScript is
/// single-threaded and reentrant: a host function may call back into JS, which
/// may call back into Rust, but always on the *same* OS thread. There is no
/// true concurrent aliasing — only stacked, same-thread reentrancy. `JsCell`
/// is the Rust spelling of that contract.
///
/// `get_mut()` is therefore *not* sound under arbitrary `Sync` semantics — the
/// `unsafe impl Sync` below is a lie to the type system that we discharge by
/// the thread-affinity invariant: a `JsCell` embedded in `VirtualMachine` (or
/// any JS-heap-adjacent struct) is only ever touched from its owning JS
/// thread. Cross-thread access goes through `ConcurrentTask` /
/// `enqueueTaskConcurrent`, which never hands out a `&JsCell`.
///
/// This is morally `Cell<T>` with a `get_mut`-from-`&self` escape hatch and
/// no `T: Copy` bound. [`Self::with_mut`] is the safe entry point (the
/// `&mut T` is closure-scoped and cannot escape); [`Self::get_mut`] is
/// `unsafe` and requires the caller to uphold the no-alias invariant
/// explicitly.
#[repr(transparent)]
pub struct JsCell<T>(core::cell::UnsafeCell<T>);

// SAFETY: see type-level docs — `JsCell` is only dereferenced on the owning
// JS thread; the `Sync` impl exists so `&'static VirtualMachine` (which
// contains `JsCell` fields) satisfies `'static`-bound trait objects and
// `thread_local!` accessors without `T: Sync` cascading everywhere. It is NOT
// a license for cross-thread `get_mut()`.
unsafe impl<T> Sync for JsCell<T> {}
// SAFETY: same single-thread-owner invariant as `Sync` above.
unsafe impl<T> Send for JsCell<T> {}

impl<T> JsCell<T> {
    #[inline(always)]
    pub const fn new(value: T) -> Self {
        Self(core::cell::UnsafeCell::new(value))
    }

    /// Shared-reference read. Caller must not hold a live `get_mut()` borrow
    /// across this call (single-JS-thread reentrancy makes overlap rare but
    /// possible — keep borrows short).
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub fn get(&self) -> &T {
        // SAFETY: single-JS-thread invariant — see type docs.
        unsafe { &*self.0.get() }
    }

    /// Mutable-reference projection from `&self`.
    ///
    /// # Safety
    ///
    /// Caller must guarantee that **no other reference** (`&T` or `&mut T`) to
    /// the contained value is live for the lifetime of the returned borrow.
    /// The single-JS-thread invariant rules out *concurrent* aliasing, but
    /// same-thread *reentrancy* (host fn → JS → host fn) can still produce
    /// stacked `&mut T` if a borrow is held across a call that re-enters.
    /// Keep the borrow short and do not hold it across any call that may
    /// reach back into code touching this cell.
    ///
    /// Prefer [`Self::with_mut`] when the mutation fits in a closure — its
    /// borrow cannot escape and the safety obligation is discharged at one
    /// audited site.
    #[inline(always)]
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn get_mut(&self) -> &mut T {
        // SAFETY: forwarded to caller — see fn-level contract.
        unsafe { &mut *self.0.get() }
    }

    /// Mutable access through an exclusive borrow of the cell itself — no
    /// aliasing is possible, so this is plain [`UnsafeCell::get_mut`].
    #[inline(always)]
    pub fn get_mut_unique(&mut self) -> &mut T {
        self.0.get_mut()
    }

    /// Closure-scoped mutable access. The `&mut T` cannot escape `f`, so the
    /// only way to violate the aliasing invariant is for `f` itself to
    /// re-enter a path that touches this same cell — which the
    /// single-JS-thread model already forbids for the duration of a field
    /// mutation. This is the **safe** spelling of `get_mut`; use it whenever
    /// the mutation does not need to outlive a single expression.
    #[inline(always)]
    pub fn with_mut<R>(&self, f: impl FnOnce(&mut T) -> R) -> R {
        // SAFETY: single-JS-thread invariant (see type docs); the `&mut T`
        // is confined to `f`'s frame and cannot be stored or returned.
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
        // Route through the single audited `with_mut` site; the `&mut T` is
        // closure-scoped so no aliasing obligation leaks to this fn.
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
