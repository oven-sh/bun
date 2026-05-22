// ── Once ──────────────────────────────────────────────────────────────────
// Port of `bun.Once(f)` (bun.zig:3637). Zig parameterizes over a comptime fn
// and stores the payload; Rust callers use two shapes:
//   * `Once<T>` — fn supplied at `.call(f)` / `.get_or_init(f)` time
//   * `Once<T, fn(A) -> T>` — fn supplied at construction (PackageManagerDirectories.rs)
//
// Open-coded double-checked-init (AtomicU8 + UnsafeCell<MaybeUninit<T>>) rather
// than `std::sync::OnceLock`. The previous `OnceLock` backing produced 157
// `OnceLock::initialize` + 30 `LazyLock` monomorphizations (~36.7 KB) whose
// shared callee `std::sys::sync::once::futex::Once::call` lives in libstd's
// own CGU — every hot-path `get_or_init` paid a cross-CGU call + futex-aware
// state machine even when the value was already initialised. The Zig original
// is a plain `bool` flag + payload; this matches it: post-init reads are one
// Acquire load + cmp inlined into the caller. Pattern proven at
// `bun_alloc/lib.rs::bss_heap_init`'s accessor macro.
//
// Contention: startup is single-threaded for every current call site; the
// rare cross-thread race spins on `yield_now()` (no futex). No poisoning —
// a panic mid-init resets to UNINIT so the next call retries (Zig has no
// poisoning either).
const ONCE_UNINIT: u8 = 0;
const ONCE_BUSY: u8 = 1;
const ONCE_DONE: u8 = 2;

pub struct Once<T, F = ()> {
    state: core::sync::atomic::AtomicU8,
    cell: core::cell::UnsafeCell<core::mem::MaybeUninit<T>>,
    f: F,
}

// SAFETY: `T` is published behind a Release store / Acquire load pair; once
// DONE the cell is immutable and only `&T` is handed out, so the bounds match
// `std::sync::OnceLock` (`T: Send` because init may happen on a different
// thread than the reader; `T: Sync` because `&T` crosses threads).
unsafe impl<T: Send + Sync, F: Sync> Sync for Once<T, F> {}
// SAFETY: `Once<T, F>` owns a `T` (in `UnsafeCell<MaybeUninit<T>>`) and an
// `F` by value; sending the whole struct to another thread is sound exactly
// when sending its owned fields is (`T: Send`, `F: Send`).
unsafe impl<T: Send, F: Send> Send for Once<T, F> {}
impl<T: core::panic::RefUnwindSafe, F: core::panic::RefUnwindSafe> core::panic::RefUnwindSafe
    for Once<T, F>
{
}

/// Cold contended path shared by every `Once<T, F>` instantiation. Taking
/// `&AtomicU8` (not `&self`) keeps this **non-generic** so exactly one copy
/// lands in `bun_core`'s CGU regardless of how many `T`s the crate uses.
/// Returns `true` if the caller won the claim and must initialise + publish;
/// `false` if another thread finished first (cell is now DONE).
#[cold]
#[inline(never)]
fn once_claim_slow(state: &core::sync::atomic::AtomicU8) -> bool {
    use core::sync::atomic::Ordering::Acquire;
    loop {
        match state.compare_exchange_weak(ONCE_UNINIT, ONCE_BUSY, Acquire, Acquire) {
            Ok(_) => return true,
            Err(ONCE_DONE) => return false,
            // BUSY (or spurious weak failure) — another thread is mid-init.
            // Startup is single-threaded in practice; spin-yield instead of
            // pulling in libstd's futex machinery.
            Err(_) => std::thread::yield_now(),
        }
    }
}

impl<T, F> Once<T, F> {
    /// Fast path: already initialised?
    #[inline(always)]
    pub fn get(&self) -> Option<&T> {
        if self.state.load(core::sync::atomic::Ordering::Acquire) == ONCE_DONE {
            // SAFETY: DONE is only stored after `cell` has been fully written;
            // the Acquire load synchronises with that Release store. The cell
            // is never mutated again for the process lifetime.
            Some(unsafe { (*self.cell.get()).assume_init_ref() })
        } else {
            None
        }
    }

    #[inline(always)]
    pub fn done(&self) -> bool {
        self.state.load(core::sync::atomic::Ordering::Acquire) == ONCE_DONE
    }

    /// `OnceLock::get_or_init` equivalent. Hot path is the inlined DONE check;
    /// the init closure runs at most once.
    #[inline(always)]
    pub fn get_or_init(&self, f: impl FnOnce() -> T) -> &T {
        if let Some(v) = self.get() {
            return v;
        }
        self.init_slow(f)
    }

    // `#[inline(never)]`, not `#[cold]`: the very first call to every `Once`
    // *always* lands here during single-threaded startup, so this is not a
    // rare branch — `#[cold]` would only relocate every monomorphisation into
    // `.text.unlikely`, scattering init code away from the startup.order
    // cluster. We only want it outlined so the DONE fast path in
    // `get_or_init` stays a load+branch.
    #[inline(never)]
    fn init_slow(&self, f: impl FnOnce() -> T) -> &T {
        if once_claim_slow(&self.state) {
            // Reset to UNINIT if `f` unwinds so a later retry isn't deadlocked
            // on a permanently-BUSY slot (Zig has no poisoning; neither do we).
            struct Reset<'a>(&'a core::sync::atomic::AtomicU8);
            impl Drop for Reset<'_> {
                #[inline]
                fn drop(&mut self) {
                    self.0
                        .store(ONCE_UNINIT, core::sync::atomic::Ordering::Release);
                }
            }
            let guard = Reset(&self.state);
            let v = f();
            // SAFETY: we hold BUSY exclusively (CAS won); no other thread can
            // be reading or writing `cell` until we publish DONE below.
            unsafe { (*self.cell.get()).write(v) };
            let _ = core::mem::ManuallyDrop::new(guard);
            self.state
                .store(ONCE_DONE, core::sync::atomic::Ordering::Release);
        }
        // SAFETY: either we just stored DONE, or `once_claim_slow` observed
        // DONE from another thread (Acquire in the CAS failure path).
        unsafe { (*self.cell.get()).assume_init_ref() }
    }

    /// `OnceLock::set` equivalent: store `value` if uninitialised, else hand it
    /// back. Never blocks — if another thread is mid-init (BUSY) this returns
    /// `Err(value)` rather than waiting, which is fine for the write-once
    /// startup statics that use it (`START_TIME`, `STD*_DESCRIPTOR_TYPE`, …).
    #[inline]
    pub fn set(&self, value: T) -> Result<(), T> {
        use core::sync::atomic::Ordering::{Acquire, Release};
        if self
            .state
            .compare_exchange(ONCE_UNINIT, ONCE_BUSY, Acquire, Acquire)
            .is_ok()
        {
            // SAFETY: we hold BUSY exclusively; see `init_slow`.
            unsafe { (*self.cell.get()).write(value) };
            self.state.store(ONCE_DONE, Release);
            Ok(())
        } else {
            Err(value)
        }
    }
}

impl<T, F> Drop for Once<T, F> {
    #[inline]
    fn drop(&mut self) {
        if *self.state.get_mut() == ONCE_DONE {
            // SAFETY: DONE ⇒ cell holds a valid `T`; we have `&mut self`.
            unsafe { self.cell.get_mut().assume_init_drop() };
        }
    }
}

impl<T> Once<T, ()> {
    pub const fn new() -> Self {
        Self {
            state: core::sync::atomic::AtomicU8::new(ONCE_UNINIT),
            cell: core::cell::UnsafeCell::new(core::mem::MaybeUninit::uninit()),
            f: (),
        }
    }
    /// Run `f` exactly once; subsequent calls return the cached payload.
    #[inline(always)]
    pub fn call(&self, f: impl FnOnce() -> T) -> T
    where
        T: Copy,
    {
        *self.get_or_init(f)
    }
}
impl<T, A> Once<T, fn(A) -> T> {
    pub const fn with_fn(f: fn(A) -> T) -> Self {
        Self {
            state: core::sync::atomic::AtomicU8::new(ONCE_UNINIT),
            cell: core::cell::UnsafeCell::new(core::mem::MaybeUninit::uninit()),
            f,
        }
    }
    /// Run the stored fn exactly once with `arg`; returns a borrow of the cached
    /// payload. Bound to `&'static self` because every call site is a `static`.
    #[inline(always)]
    pub fn call(&'static self, arg: A) -> &'static T {
        let f = self.f;
        self.get_or_init(|| f(arg))
    }
}
impl<T> Default for Once<T, ()> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

/// Void-result sibling of [`Once`]: declares a hidden `static std::sync::Once`
/// and runs `$body` exactly once for the process lifetime. Replaces the
/// hand-rolled `static AtomicBool; if X.swap(true){return}` one-shot guards
/// (D006). Acquire/Release per `std::sync::Once`; poisons on panic — second
/// call after a mid-init panic will panic instead of silently returning.
///
/// Do **not** use when the guard must be reset on failure (e.g. retry-on-error)
/// or when both first/subsequent arms run real code — keep the `AtomicBool`.
#[macro_export]
macro_rules! run_once {
    ($body:block) => {{
        static __ONCE: ::std::sync::Once = ::std::sync::Once::new();
        __ONCE.call_once(|| $body);
    }};
}
