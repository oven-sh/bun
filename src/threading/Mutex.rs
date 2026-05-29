//! This is a copy-pasta of std.Thread.Mutex with some changes.
//! - No assert with unreachable
//! - uses bun.Futex instead of std.Thread.Futex
//! Synchronized with std as of Zig 0.14.1
//!
//! Mutex is a synchronization primitive which enforces atomic access to a shared region of code known as the "critical section".
//! It does this by blocking ensuring only one thread is in the critical section at any given point in time by blocking the others.
//! Mutex can be statically initialized and is at most `size_of::<u64>()` large.
//! Use `lock()` or `try_lock()` to enter the critical section and `unlock()` to leave it.
//!
//! Example:
//! ```ignore
//! let m = Mutex::default();
//!
//! {
//!     m.lock();
//!     // ... critical section code
//!     m.unlock();
//! }
//!
//! if m.try_lock() {
//!     // ... critical section code
//!     m.unlock();
//! }
//! ```

#[cfg(not(any(windows, target_vendor = "apple")))]
use core::sync::atomic::AtomicU32;
#[cfg(debug_assertions)]
use core::sync::atomic::AtomicU64;
#[cfg(any(debug_assertions, not(any(windows, target_vendor = "apple"))))]
use core::sync::atomic::Ordering;

#[cfg(not(any(windows, target_vendor = "apple")))]
use crate::Futex;

#[derive(Default)]
pub struct Mutex {
    // `pub(crate)` so `Condition` can reach `srwlock` / `locking_thread` for
    // `SleepConditionVariableSRW` (mirrors Zig's same-module field access).
    pub(crate) impl_: Impl,
}

impl Mutex {
    /// Const-init an unlocked mutex (Zig: `.{}`). Required for `static` items.
    pub const fn new() -> Self {
        Self { impl_: Impl::new() }
    }

    /// Tries to acquire the mutex without blocking the caller's thread.
    /// Returns `false` if the calling thread would have to block to acquire it.
    /// Otherwise, returns `true` and the caller should `unlock()` the Mutex to release it.
    pub fn try_lock(&self) -> bool {
        self.impl_.try_lock()
    }

    /// Acquires the mutex, blocking the caller's thread until it can.
    /// It is undefined behavior if the mutex is already held by the caller's thread.
    /// Once acquired, call `unlock()` on the Mutex to release it.
    pub fn lock(&self) {
        self.impl_.lock()
    }

    /// Releases the mutex which was previously acquired with `lock()` or `try_lock()`.
    /// It is undefined behavior if the mutex is unlocked from a different thread that it was locked from.
    pub fn unlock(&self) {
        self.impl_.unlock()
    }

    #[inline]
    pub fn is_held_by_current_thread(&self) -> bool {
        #[cfg(debug_assertions)]
        {
            self.impl_.locking_thread.load(Ordering::Relaxed) == current_thread_id()
        }
        #[cfg(not(debug_assertions))]
        {
            true
        }
    }

    #[inline]
    #[must_use = "the mutex unlocks immediately if the guard is dropped"]
    pub fn lock_guard(&self) -> MutexGuard {
        self.lock();
        MutexGuard {
            mutex: bun_ptr::BackRef::new(self),
            _not_send: core::marker::PhantomData,
        }
    }
}

pub struct MutexGuard {
    mutex: bun_ptr::BackRef<Mutex>,
    // Preserve the previous `!Send`/`!Sync` auto-trait surface (the field was
    // `*const Mutex`): the Darwin `os_unfair_lock` / Windows `SRWLOCK` backends
    // require unlock on the locking thread.
    _not_send: core::marker::PhantomData<*const Mutex>,
}

impl Drop for MutexGuard {
    #[inline]
    fn drop(&mut self) {
        self.mutex.unlock()
    }
}

// Zig: `pub const deinit = void;` — no-op; Drop is implicit and there is nothing to free.

// TODO(port): Zig also gates on `!builtin.single_threaded`; Rust has no direct equivalent.
#[cfg(debug_assertions)]
type Impl = DebugImpl;
#[cfg(not(debug_assertions))]
type Impl = ReleaseImpl;

#[cfg(windows)]
pub type ReleaseImpl = WindowsImpl;
#[cfg(target_vendor = "apple")]
pub type ReleaseImpl = DarwinImpl;
#[cfg(not(any(windows, target_vendor = "apple")))]
pub type ReleaseImpl = FutexImpl;

#[cfg(windows)]
#[allow(dead_code)]
pub(crate) type ExternImpl = bun_sys::windows::SRWLOCK;
#[cfg(not(any(windows, target_vendor = "apple")))]
#[allow(dead_code)]
pub(crate) type ExternImpl = u32;

#[cfg(debug_assertions)]
type ThreadId = u64;
#[cfg(debug_assertions)]
#[inline]
fn current_thread_id() -> ThreadId {
    crate::current_thread_id()
}

#[cfg(debug_assertions)]
#[derive(Default)]
pub(crate) struct DebugImpl {
    /// 0 means it's not locked.
    pub(crate) locking_thread: AtomicU64,
    pub(crate) impl_: ReleaseImpl,
}

#[cfg(debug_assertions)]
impl DebugImpl {
    pub(crate) const fn new() -> Self {
        Self {
            locking_thread: AtomicU64::new(0),
            impl_: ReleaseImpl::new(),
        }
    }

    #[inline]
    fn try_lock(&self) -> bool {
        let locking = self.impl_.try_lock();
        if locking {
            // PORT NOTE: Zig uses .unordered; Rust's weakest is Relaxed.
            self.locking_thread
                .store(current_thread_id(), Ordering::Relaxed);
        }
        locking
    }

    #[inline]
    fn lock(&self) {
        let current_id = current_thread_id();
        if self.locking_thread.load(Ordering::Relaxed) == current_id && current_id != 0 {
            panic!("Deadlock detected");
        }
        self.impl_.lock();
        self.locking_thread.store(current_id, Ordering::Relaxed);
    }

    #[inline]
    fn unlock(&self) {
        debug_assert!(self.locking_thread.load(Ordering::Relaxed) == current_thread_id());
        self.locking_thread.store(0, Ordering::Relaxed);
        self.impl_.unlock();
    }
}

/// SRWLOCK on windows is almost always faster than Futex solution.
/// It also implements an efficient Condition with requeue support for us.
#[cfg(windows)]
#[derive(Default)]
pub struct WindowsImpl {
    pub(crate) srwlock: core::cell::UnsafeCell<bun_sys::windows::SRWLOCK>,
}

#[cfg(windows)]
unsafe impl Sync for WindowsImpl {}
#[cfg(windows)]
unsafe impl Send for WindowsImpl {}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn AcquireSRWLockExclusive(lock: &core::cell::UnsafeCell<bun_sys::windows::SRWLOCK>);
    // Returns BOOLEAN (u8), not BOOL — compare against 0, not the i32 `FALSE`.
    safe fn TryAcquireSRWLockExclusive(
        lock: &core::cell::UnsafeCell<bun_sys::windows::SRWLOCK>,
    ) -> u8;
}

#[cfg(windows)]
impl WindowsImpl {
    pub(crate) const fn new() -> Self {
        Self {
            srwlock: core::cell::UnsafeCell::new(bun_sys::windows::SRWLOCK_INIT),
        }
    }

    fn try_lock(&self) -> bool {
        TryAcquireSRWLockExclusive(&self.srwlock) != 0
    }

    fn lock(&self) {
        AcquireSRWLockExclusive(&self.srwlock)
    }

    fn unlock(&self) {
        // SAFETY: caller acquired the lock on this thread (`Mutex::unlock`
        // contract); releasing without ownership is documented UB on Windows.
        unsafe { bun_sys::windows::kernel32::ReleaseSRWLockExclusive(self.srwlock.get()) }
    }
}

/// os_unfair_lock on darwin supports priority inheritance and is generally faster than Futex solutions.
#[cfg(target_vendor = "apple")]
#[derive(Default)]
pub struct DarwinImpl {
    oul: core::cell::UnsafeCell<OsUnfairLock>,
}

// SAFETY: `os_unfair_lock` is the kernel's cross-thread lock primitive; the
// `UnsafeCell` only exists to hand the FFI a mutable pointer from `&self`.
#[cfg(target_vendor = "apple")]
unsafe impl Sync for DarwinImpl {}
// SAFETY: see `Sync` above.
#[cfg(target_vendor = "apple")]
unsafe impl Send for DarwinImpl {}

#[cfg(target_vendor = "apple")]
#[repr(C)]
#[derive(Default)]
pub(crate) struct OsUnfairLock {
    _opaque: u32,
}

#[cfg(target_vendor = "apple")]
unsafe extern "C" {
    safe fn os_unfair_lock_trylock(lock: &core::cell::UnsafeCell<OsUnfairLock>) -> bool;
    safe fn os_unfair_lock_lock(lock: &core::cell::UnsafeCell<OsUnfairLock>);
    safe fn os_unfair_lock_unlock(lock: &core::cell::UnsafeCell<OsUnfairLock>);
}

#[cfg(target_vendor = "apple")]
impl DarwinImpl {
    pub(crate) const fn new() -> Self {
        Self {
            oul: core::cell::UnsafeCell::new(OsUnfairLock { _opaque: 0 }),
        }
    }

    fn try_lock(&self) -> bool {
        os_unfair_lock_trylock(&self.oul)
    }

    fn lock(&self) {
        os_unfair_lock_lock(&self.oul)
    }

    fn unlock(&self) {
        os_unfair_lock_unlock(&self.oul)
    }
}

#[cfg(not(any(windows, target_vendor = "apple")))]
#[derive(Default)]
pub struct FutexImpl {
    state: AtomicU32,
}

#[cfg(not(any(windows, target_vendor = "apple")))]
impl FutexImpl {
    pub(crate) const fn new() -> Self {
        Self {
            state: AtomicU32::new(0),
        }
    }

    const UNLOCKED: u32 = 0b00;
    const LOCKED: u32 = 0b01;
    /// must contain the `LOCKED` bit for x86 optimization below
    const CONTENDED: u32 = 0b11;

    fn lock(&self) {
        if !self.try_lock() {
            self.lock_slow();
        }
    }

    fn try_lock(&self) -> bool {
        // On x86, use `lock bts` instead of `lock cmpxchg` as:
        // - they both seem to mark the cache-line as modified regardless: https://stackoverflow.com/a/63350048
        // - `lock bts` is smaller instruction-wise which makes it better for inlining
        #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
        {
            let locked_bit: u32 = Self::LOCKED.trailing_zeros();
            // PERF(port): Zig emits `lock bts` via atomic bitSet; fetch_or is the closest stable
            // Rust atomic — profile if it shows up on a hot path and consider inline asm if needed.
            return (self.state.fetch_or(1 << locked_bit, Ordering::Acquire) & (1 << locked_bit))
                == 0;
        }

        // Acquire barrier ensures grabbing the lock happens before the critical section
        // and that the previous lock holder's critical section happens before we grab the lock.
        #[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
        {
            self.state
                .compare_exchange_weak(
                    Self::UNLOCKED,
                    Self::LOCKED,
                    Ordering::Acquire,
                    Ordering::Relaxed,
                )
                .is_ok()
        }
    }

    #[cold]
    fn lock_slow(&self) {
        // Avoid doing an atomic swap below if we already know the state is contended.
        // An atomic swap unconditionally stores which marks the cache-line as modified unnecessarily.
        if self.state.load(Ordering::Relaxed) == Self::CONTENDED {
            Futex::wait_forever(&self.state, Self::CONTENDED);
        }

        while self.state.swap(Self::CONTENDED, Ordering::Acquire) != Self::UNLOCKED {
            Futex::wait_forever(&self.state, Self::CONTENDED);
        }
    }

    fn unlock(&self) {
        let state = self.state.swap(Self::UNLOCKED, Ordering::Release);
        debug_assert!(state != Self::UNLOCKED);

        if state == Self::CONTENDED {
            Futex::wake(&self.state, 1);
        }
    }
}

// PORT NOTE: Zig had `pub const Type` inside each impl as an associated alias.
// Inherent associated types are unstable in Rust; the per-platform alias is
// already exposed as the module-level `ExternImpl` type above.

// These have to be a size known to C.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__lock(ptr: *mut ReleaseImpl) {
    // SAFETY: C caller passes a valid, initialized ReleaseImpl pointer.
    unsafe { (*ptr).lock() }
}

// These have to be a size known to C.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__unlock(ptr: *mut ReleaseImpl) {
    // SAFETY: C caller passes a valid, initialized ReleaseImpl pointer that this thread locked.
    unsafe { (*ptr).unlock() }
}

#[unsafe(no_mangle)]
pub(crate) static Bun__lock__size: usize = core::mem::size_of::<ReleaseImpl>();

// ported from: src/threading/Mutex.zig
