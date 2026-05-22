// ─── Mutex / RwLock (poison-free std::sync wrappers) ──────────────────────
//
// LAYERING: `bun_core` sits *below* `bun_threading` in the crate graph, so it
// cannot use the futex-backed `Guarded<T>` / `RwLock<T>` defined there. The
// handful of low-tier call sites (this crate, `bun_ptr`, `bun_alloc`) instead
// get thin newtype wrappers around `std::sync` that strip the poisoning API —
// Bun aborts on panic, so a poisoned lock is unreachable in practice and the
// `LockResult` ceremony is pure noise. Higher-tier crates should use
// `bun_threading::Guarded` / `bun_threading::RwLock` directly.
//
// API parity with the previous `parking_lot` aliases: `const fn new(T)`,
// `.lock()` → guard (no `Result`), `.try_lock()` → `Option`, `.get_mut()`,
// `Default`.

/// Poison-free `std::sync::Mutex<T>` wrapper. See module note above for why
/// this is not `bun_threading::Guarded<T>`.
pub struct Mutex<T>(std::sync::Mutex<T>);

/// Guard returned by [`Mutex::lock`] / [`Mutex::try_lock`]. Re-exported so
/// callers can name it in return types (e.g. `rare_data::ProxyEnvStorage::lock`).
pub type MutexGuard<'a, T> = std::sync::MutexGuard<'a, T>;

/// Zig `Guarded(T)` — same wrapper, different spelling.
pub type Guarded<T> = Mutex<T>;

impl<T> Mutex<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self(std::sync::Mutex::new(value))
    }

    #[inline]
    pub fn lock(&self) -> MutexGuard<'_, T> {
        // Poisoning is unreachable (Bun aborts on panic); recover the guard if
        // it ever happens rather than propagating a `Result`.
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[inline]
    pub fn try_lock(&self) -> Option<MutexGuard<'_, T>> {
        match self.0.try_lock() {
            Ok(g) => Some(g),
            Err(std::sync::TryLockError::Poisoned(e)) => Some(e.into_inner()),
            Err(std::sync::TryLockError::WouldBlock) => None,
        }
    }

    #[inline]
    pub fn get_mut(&mut self) -> &mut T {
        self.0
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[inline]
    pub fn into_inner(self) -> T {
        self.0
            .into_inner()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl<T: Default> Default for Mutex<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

/// Poison-free `std::sync::RwLock<T>` wrapper. See module note on [`Mutex`].
pub struct RwLock<T>(std::sync::RwLock<T>);

pub type RwLockReadGuard<'a, T> = std::sync::RwLockReadGuard<'a, T>;
pub type RwLockWriteGuard<'a, T> = std::sync::RwLockWriteGuard<'a, T>;

impl<T> RwLock<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self(std::sync::RwLock::new(value))
    }

    #[inline]
    pub fn read(&self) -> RwLockReadGuard<'_, T> {
        self.0
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[inline]
    pub fn write(&self) -> RwLockWriteGuard<'_, T> {
        self.0
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[inline]
    pub fn get_mut(&mut self) -> &mut T {
        self.0
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl<T: Default> Default for RwLock<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}
