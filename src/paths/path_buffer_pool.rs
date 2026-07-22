//! This pool exists because on Windows, each path buffer costs 64 KB.
//! This makes the stack memory usage very unpredictable, which means we can't
//! really know how much stack space we have left. This pool is a workaround to
//! make the stack memory usage more predictable. We keep up to 4 path buffers
//! alive per thread at a time.
//!
//! Implemented over `thread_local!` + `RefCell<Vec<Box<T>>>` (per-thread, so no
//! lock needed): at most 4 buffers cached per thread; excess `put`s drop. An
//! RAII guard replaces manual `get`/`put` pairing.

use core::cell::RefCell;
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};

use crate::{PathBuffer, WPathBuffer};

const POOL_CAP: usize = 4;

/// Per-thread pool of reusable path buffers.
pub struct PathBufferPoolT<T: 'static + Default>(PhantomData<T>);

// One thread-local Vec per buffer type: per-thread storage means mimalloc
// frees the buffers on thread deinit and no lock is needed.
thread_local! {
    #[allow(clippy::vec_box)]
    static U8_POOL: RefCell<Vec<Box<PathBuffer>>> = const { RefCell::new(Vec::new()) };
    #[allow(clippy::vec_box)]
    static U16_POOL: RefCell<Vec<Box<WPathBuffer>>> = const { RefCell::new(Vec::new()) };
}

pub trait PoolStorage: Sized + Default + 'static {
    fn with_pool<R>(f: impl FnOnce(&RefCell<Vec<Box<Self>>>) -> R) -> R;
    /// Allocate a fresh boxed buffer. Implemented per concrete type so the
    /// `assume_init` SAFETY obligation is discharged monomorphically (the
    /// generic site cannot soundly assert "every bit-pattern is valid" for an
    /// arbitrary `T`).
    fn new_boxed() -> Box<Self>;
}
impl PoolStorage for PathBuffer {
    fn with_pool<R>(f: impl FnOnce(&RefCell<Vec<Box<Self>>>) -> R) -> R {
        U8_POOL.with(f)
    }
    #[inline]
    fn new_boxed() -> Box<Self> {
        // SAFETY: `PathBuffer` is `#[repr(transparent)]` over `[u8; N]`;
        // `new_zeroed` writes every byte to `0`, which is a valid `u8`, so the
        // value is fully initialized before `assume_init`. We use `new_zeroed`
        // rather than `new_uninit` because materializing a `Box<T>` whose bytes
        // were never written is UB even for integer arrays. This path runs only
        // on pool cache miss (≤ once per slot per thread); `alloc_zeroed` for a
        // 64 KB heap block is typically satisfied by fresh OS-zeroed pages, so
        // there is no hot-path memset cost.
        unsafe { Box::<Self>::new_zeroed().assume_init() }
    }
}
impl PoolStorage for WPathBuffer {
    fn with_pool<R>(f: impl FnOnce(&RefCell<Vec<Box<Self>>>) -> R) -> R {
        U16_POOL.with(f)
    }
    #[inline]
    fn new_boxed() -> Box<Self> {
        // SAFETY: `WPathBuffer` is `#[repr(transparent)]` over `[u16; N]`;
        // `new_zeroed` writes every byte to `0`, which is a valid `u16`, so the
        // value is fully initialized before `assume_init`. See `PathBuffer`
        // impl above for rationale re: `new_uninit` UB and perf.
        unsafe { Box::<Self>::new_zeroed().assume_init() }
    }
}

impl<T: PoolStorage> PathBufferPoolT<T> {
    /// Returns an RAII guard that derefs to `&mut T` and returns the buffer to
    /// the pool on `Drop`. Replaces manual `get`/`put` pairing.
    pub fn get() -> PoolGuard<T> {
        // Zero-allocate on the (rare) cache-miss path — see
        // `PoolStorage::new_boxed` for the soundness/perf justification.
        let buf = T::with_pool(|p| p.borrow_mut().pop()).unwrap_or_else(T::new_boxed);
        PoolGuard { buf: Some(buf) }
    }

    /// Manual return path. Prefer dropping
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

/// `bun.path_buffer_pool.get()` — convenience wrapper returning the RAII guard.
/// `Path<U>` callers store this in a `ManuallyDrop` and explicitly `put` on
/// reset, so also expose `into_box`/free `put`.
pub type Guard = PoolGuard<PathBuffer>;
#[inline]
pub fn get() -> PoolGuard<PathBuffer> {
    PathBufferPoolT::<PathBuffer>::get()
}
#[inline]
pub fn put(buf: Box<PathBuffer>) {
    PathBufferPoolT::<PathBuffer>::put(buf)
}

impl<T: PoolStorage> PoolGuard<T> {
    /// Extract the `Box` without returning it to the pool (for `ManuallyDrop`
    /// owners that will `put` explicitly later). `Drop` is a no-op once `buf`
    /// is `None`, so no leak.
    #[inline]
    pub(crate) fn into_box(mut self) -> Box<T> {
        self.buf.take().unwrap()
    }
}

#[cfg(windows)]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = w_path_buffer_pool;
#[cfg(not(windows))]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = path_buffer_pool;
