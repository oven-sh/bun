// ─── RacyCell ─────────────────────────────────────────────────────────────
/// Stable equivalent of `core::cell::SyncUnsafeCell<T>` (nightly-only as of
/// 1.79). A `static`-safe interior-mutability cell with **no** synchronization.
///
/// This exists to replace `static mut` (banned per docs/PORTING.md §Global
/// mutable state). Unlike `static mut`, taking `&RACY` does not assert
/// uniqueness; callers stay in raw-ptr land via `.get()` and only deref for
/// the duration of a single statement.
///
/// **Invariant the caller upholds:** all access is either single-threaded
/// (e.g. HTTP-thread-only buffers, main-thread-only CLI state) or externally
/// synchronized. For anything actually shared across threads, use
/// `Atomic*` / `OnceLock` / `Mutex` instead — `RacyCell` is the last resort
/// for scratch buffers and FFI-shaped globals where the Zig already proved
/// thread-affinity.
#[repr(transparent)]
pub struct RacyCell<T: ?Sized>(core::cell::Cell<T>);
// SAFETY: by construction, callers promise external synchronization or
// single-thread access. Unlike std's nightly `SyncUnsafeCell` (which gates
// `Sync` on `T: Sync`), this impl is intentionally unconditional: many
// payloads ported from `static mut` are `!Sync` only by auto-trait inference
// (raw pointers, `MaybeUninit<T>` over FFI handles) yet are sound to share
// because all access is single-threaded or externally synchronized — the
// exact contract `static mut` already imposed. **Do not** wrap *payloads*
// whose `!Sync` is load-bearing (`Cell<U>`, `Rc<U>`, `RefCell<U>`); use
// `thread_local!` or a real lock for those. (The inner storage here is
// `Cell<T>` purely so `read`/`write` bodies are safe code — the cross-thread
// hazard is fully accounted for by this `unsafe impl Sync`.)
unsafe impl<T: ?Sized> Sync for RacyCell<T> {}
// SAFETY: `RacyCell<T>` owns a `T` by value via `Cell<T>`; sending the cell to
// another thread is sound exactly when sending `T` itself is (`T: Send`).
unsafe impl<T: ?Sized + Send> Send for RacyCell<T> {}

impl<T> RacyCell<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self(core::cell::Cell::new(value))
    }
    /// Raw pointer to the contained value. Never produces a reference; callers
    /// deref per-access (`unsafe { *X.get() }` / `unsafe { (*X.get()).field }`).
    #[inline]
    pub const fn get(&self) -> *mut T {
        self.0.as_ptr()
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
        self.0.get()
    }
    /// Convenience: overwrite the value.
    ///
    /// # Safety
    /// Caller guarantees no concurrent reader/writer on another thread.
    #[inline]
    pub unsafe fn write(&self, value: T) {
        self.0.set(value)
    }
}
impl<T: Default> Default for RacyCell<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}
