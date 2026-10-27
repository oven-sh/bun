//! The threads that only read files: one pool for the process, shared by the bundler and the type
//! checker. The field `io_pool` of the bundler's `ThreadPool` says why they exist.

use core::mem::MaybeUninit;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_core::env_var;

use crate::{Mutex, thread_pool as ThreadPoolLib};

/// What the result of [`acquire`] converts into, for a field. Valid until [`release`].
pub type Ref = bun_ptr::ParentRef<ThreadPoolLib::ThreadPool>;

// PORTING.md §Global mutable state: init/drop guarded by `MUTEX` +
// `REF_COUNT`. RacyCell so accessors stay in raw-ptr land; the mutex
// provides synchronization.
static THREAD_POOL: bun_core::RacyCell<MaybeUninit<ThreadPoolLib::ThreadPool>> =
    bun_core::RacyCell::new(MaybeUninit::uninit());
/// Protects initialization and deinitialization of the IO thread pool.
static MUTEX: Mutex = {
    // `Mutex` derives `Default` but `Default::default()` isn't
    // `const`. An all-zero `Mutex` is the documented unlocked state on
    // every impl.
    // SAFETY: `Mutex` is `repr(Rust)` over an atomic / Futex word; zero is
    // the valid initial value (matches `#[derive(Default)]`).
    unsafe { bun_core::ffi::zeroed_unchecked() }
};
/// 0 means not initialized. 1 means initialized but not used.
/// N > 1 means N-1 `ThreadPool`s are using the IO thread pool.
static REF_COUNT: AtomicUsize = AtomicUsize::new(0);

pub fn acquire() -> NonNull<ThreadPoolLib::ThreadPool> {
    let mut count = REF_COUNT.load(Ordering::Acquire);
    loop {
        if count == 0 {
            break;
        }
        // Relaxed is okay because we already loaded this value with Acquire,
        // and we don't need the store to be Release because the only store that
        // matters is the one that goes from 0 to 1, and that one is Release.
        match REF_COUNT.compare_exchange_weak(
            count,
            count + 1,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => {
                // REF_COUNT != 0 ⇒ THREAD_POOL is initialized (set under MUTEX below).
                // `UnsafeCell::get` never returns null.
                return NonNull::new(THREAD_POOL.get().cast::<ThreadPoolLib::ThreadPool>())
                    .expect("UnsafeCell::get is non-null");
            }
            Err(actual) => count = actual,
        }
    }

    let _guard = MUTEX.lock_guard();

    // Relaxed because the store we care about (the one that stores 1 to
    // indicate the thread pool is initialized) is guarded by the mutex.
    if REF_COUNT.load(Ordering::Relaxed) == 0 {
        // SAFETY: we hold MUTEX and REF_COUNT == 0, so no other thread is reading THREAD_POOL.
        unsafe {
            (*THREAD_POOL.get()).write(ThreadPoolLib::ThreadPool::init(ThreadPoolLib::Config {
                max_threads: u32::from(bun_core::get_thread_count().clamp(2, 4)),
                // Use a much smaller stack size for the IO thread pool
                stack_size: 512 * 1024,
            }));
        }
        // 2 means initialized and referenced by one `ThreadPool`.
        REF_COUNT.store(2, Ordering::Release);
    } else {
        // NOTE: a racing acquirer that reaches here does not bump the ref
        // count — a latent under-count, preserved intentionally.
    }
    // Just initialized (or observed initialized) above. `UnsafeCell::get` never returns null.
    NonNull::new(THREAD_POOL.get().cast::<ThreadPoolLib::ThreadPool>())
        .expect("UnsafeCell::get is non-null")
}

pub fn release() {
    let old = REF_COUNT.fetch_sub(1, Ordering::Release);
    debug_assert!(old > 1, "IOThreadPool: too many calls to release()");
}

pub fn uses_io_pool() -> bool {
    if env_var::feature_flag::BUN_FEATURE_FLAG_FORCE_IO_POOL.get() == Some(true) {
        // For testing.
        return true;
    }

    if env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_IO_POOL.get() == Some(true) {
        // For testing.
        return false;
    }

    // 4 was the sweet spot on macOS. Didn't check the sweet spot on Windows.
    #[cfg(any(target_os = "macos", windows))]
    return bun_core::get_thread_count() > 3;
    #[cfg(not(any(target_os = "macos", windows)))]
    return false;
}
