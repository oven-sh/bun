//! This pool exists because on Windows, each path buffer costs 64 KB.
//! This makes the stack memory usage very unpredictable, which means we can't
//! really know how much stack space we have left. This pool is a workaround to
//! make the stack memory usage more predictable. We keep up to 4 path buffers
//! alive per thread at a time.
//!
//! PORT NOTE: Zig used `bun.ObjectPool<T, null, true, 4>` (a thread-safe
//! 4-slot freelist). Rewritten over `thread_local!` + `RefCell<Vec<Box<T>>>`
//! per PORTING.md §Concurrency (init-once / per-thread → no lock needed).
//! Same observable behavior: at most 4 buffers cached per thread; excess `put`s
//! drop. RAII guard replaces the manual `get`/`put` pairing.

use core::cell::RefCell;
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};

use crate::{PathBuffer, WPathBuffer};

const POOL_CAP: usize = 4;

/// Per-thread pool of reusable path buffers.
pub struct PathBufferPoolT<T: 'static + Default>(PhantomData<T>);

// One thread-local Vec per buffer type. Zig's threadsafe pool used a global
// lock; per-thread is closer to "use a thread-local allocator so mimalloc
// deletes it on thread deinit" (the original comment) and avoids any lock.
thread_local! {
    static U8_POOL: RefCell<Vec<Box<PathBuffer>>> = const { RefCell::new(Vec::new()) };
    static U16_POOL: RefCell<Vec<Box<WPathBuffer>>> = const { RefCell::new(Vec::new()) };
}

trait PoolStorage: Sized + Default + 'static {
    fn with_pool<R>(f: impl FnOnce(&RefCell<Vec<Box<Self>>>) -> R) -> R;
}
impl PoolStorage for PathBuffer {
    fn with_pool<R>(f: impl FnOnce(&RefCell<Vec<Box<Self>>>) -> R) -> R {
        U8_POOL.with(f)
    }
}
impl PoolStorage for WPathBuffer {
    fn with_pool<R>(f: impl FnOnce(&RefCell<Vec<Box<Self>>>) -> R) -> R {
        U16_POOL.with(f)
    }
}

impl<T: PoolStorage> PathBufferPoolT<T> {
    /// Returns an RAII guard that derefs to `&mut T` and returns the buffer to
    /// the pool on `Drop`. Replaces manual `get`/`put` pairing.
    pub fn get() -> PoolGuard<T> {
        let buf = T::with_pool(|p| p.borrow_mut().pop()).unwrap_or_else(|| Box::new(T::default()));
        PoolGuard { buf: Some(buf) }
    }

    /// Manual return path (kept for structure parity with Zig). Prefer dropping
    /// the `PoolGuard` instead.
    pub fn put(buf: Box<T>) {
        T::with_pool(|p| {
            let mut p = p.borrow_mut();
            if p.len() < POOL_CAP {
                p.push(buf);
            }
            // else: drop — mimalloc frees it.
        });
    }

    pub fn delete_all() {
        T::with_pool(|p| p.borrow_mut().clear());
    }
}

/// RAII guard returned by `PathBufferPoolT::get()`.
pub struct PoolGuard<T: PoolStorage> {
    buf: Option<Box<T>>,
}

impl<T: PoolStorage> Deref for PoolGuard<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY-ish: `buf` is always `Some` until `Drop`.
        self.buf.as_deref().unwrap()
    }
}

impl<T: PoolStorage> DerefMut for PoolGuard<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        self.buf.as_deref_mut().unwrap()
    }
}

impl<T: PoolStorage> Drop for PoolGuard<T> {
    fn drop(&mut self) {
        if let Some(buf) = self.buf.take() {
            PathBufferPoolT::<T>::put(buf);
        }
    }
}

#[allow(non_camel_case_types)]
pub type path_buffer_pool = PathBufferPoolT<PathBuffer>;
#[allow(non_camel_case_types)]
pub type w_path_buffer_pool = PathBufferPoolT<WPathBuffer>;

#[cfg(windows)]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = w_path_buffer_pool;
#[cfg(not(windows))]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = path_buffer_pool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/paths/path_buffer_pool.zig (34 lines)
//   confidence: high
//   todos:      0
//   notes:      ObjectPool → thread_local Vec<Box<T>> (cap 4); get() now RAII guard.
// ──────────────────────────────────────────────────────────────────────────
