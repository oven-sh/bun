//! This pool exists because on Windows, each path buffer costs 64 KB.
//! This makes the stack memory usage very unpredictable, which means we can't
//! really know how much stack space we have left. This pool is a workaround to
//! make the stack memory usage more predictable. We keep up to 4 path buffers
//! alive per thread at a time.
//!
//! A pooled buffer is zeroed once on allocation and then reused, which is how
//! scratch storage avoids both a per-call zero-fill and uninitialized `[u8; N]`.
//!
//! Implemented over `thread_local!` + `RefCell<Vec<Box<T>>>` (per-thread, so no
//! lock needed): at most 4 buffers cached per thread; excess `put`s drop. An
//! RAII guard replaces manual `get`/`put` pairing.

use core::cell::RefCell;
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};

use bun_core::{PathBuffer, WPathBuffer};

const POOL_CAP: usize = 4;

/// Per-thread pool of reusable path buffers.
pub struct PathBufferPoolT<T: 'static>(PhantomData<T>);

// One thread-local Vec per buffer type: per-thread storage means mimalloc
// frees the buffers on thread deinit and no lock is needed.
thread_local! {
    #[allow(clippy::vec_box)]
    static U8_POOL: RefCell<Vec<Box<PathBuffer>>> = const { RefCell::new(Vec::new()) };
    #[allow(clippy::vec_box)]
    static U16_POOL: RefCell<Vec<Box<WPathBuffer>>> = const { RefCell::new(Vec::new()) };
}

pub trait PoolStorage: Sized + 'static {
    /// `None` while this thread's TLS destructors run. The caller uses the heap.
    fn with_pool<R>(f: impl FnOnce(&RefCell<Vec<Box<Self>>>) -> R) -> Option<R>;
    /// Allocate a fresh boxed buffer. Implemented per concrete type so the
    /// `assume_init` SAFETY obligation is discharged monomorphically (the
    /// generic site cannot soundly assert "every bit-pattern is valid" for an
    /// arbitrary `T`).
    fn new_boxed() -> Box<Self>;
}
impl PoolStorage for PathBuffer {
    fn with_pool<R>(f: impl FnOnce(&RefCell<Vec<Box<Self>>>) -> R) -> Option<R> {
        U8_POOL.try_with(f).ok()
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
        lsan_ignore(unsafe { Box::<Self>::new_zeroed().assume_init() })
    }
}
impl PoolStorage for WPathBuffer {
    fn with_pool<R>(f: impl FnOnce(&RefCell<Vec<Box<Self>>>) -> R) -> Option<R> {
        U16_POOL.try_with(f).ok()
    }
    #[inline]
    fn new_boxed() -> Box<Self> {
        // SAFETY: `WPathBuffer` is `#[repr(transparent)]` over `[u16; N]`;
        // `new_zeroed` writes every byte to `0`, which is a valid `u16`, so the
        // value is fully initialized before `assume_init`. See `PathBuffer`
        // impl above for rationale re: `new_uninit` UB and perf.
        lsan_ignore(unsafe { Box::<Self>::new_zeroed().assume_init() })
    }
}

/// A guard still live at `exit` never drops, and an optimized build may have
/// discarded its stack slot, so LeakSanitizer would report the buffer.
#[inline]
fn lsan_ignore<T>(buf: Box<T>) -> Box<T> {
    bun_core::asan::ignore_object((&raw const *buf).cast());
    buf
}

impl<T: PoolStorage> PathBufferPoolT<T> {
    /// Returns an RAII guard that derefs to `&mut T` and returns the buffer to
    /// the pool on `Drop`. Replaces manual `get`/`put` pairing.
    #[inline]
    pub fn get() -> PoolGuard<T> {
        let buf = T::with_pool(|p| p.borrow_mut().pop())
            .flatten()
            .unwrap_or_else(T::new_boxed);
        PoolGuard { buf: Some(buf) }
    }

    /// Manual return path. Prefer dropping
    /// the `PoolGuard` instead.
    pub fn put(buf: Box<T>) {
        // Dropped when the pool is full or TLS is gone.
        let _ = T::with_pool(|p| {
            let mut p = p.borrow_mut();
            if p.len() < POOL_CAP {
                p.push(buf);
            }
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

/// Lets a struct that embeds a `Guard` `#[derive(Default)]`.
impl<T: PoolStorage> Default for PoolGuard<T> {
    #[inline]
    fn default() -> Self {
        PathBufferPoolT::<T>::get()
    }
}

impl<T: PoolStorage> Drop for PoolGuard<T> {
    fn drop(&mut self) {
        if let Some(buf) = self.buf.take() {
            PathBufferPoolT::<T>::put(buf);
        }
    }
}

impl<T: PoolStorage> PoolGuard<T> {
    /// Extract the `Box` without returning it to the pool; the owner `put`s it later.
    #[inline]
    pub fn into_box(mut self) -> Box<T> {
        self.buf.take().unwrap()
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

#[cfg(windows)]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = w_path_buffer_pool;
#[cfg(not(windows))]
#[allow(non_camel_case_types)]
pub type os_path_buffer_pool = path_buffer_pool;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_buffers_are_initialized_and_returned_to_the_pool() {
        let drained: Vec<Box<PathBuffer>> = U8_POOL.with(|p| core::mem::take(&mut *p.borrow_mut()));
        drop(drained);

        let mut a = get();
        let mut b = get();
        assert!(a.iter().all(|&byte| byte == 0));
        assert!(b.iter().all(|&byte| byte == 0));
        a[0] = b'a';
        b[0] = b'b';
        let a_ptr: *const PathBuffer = &*a;
        let b_ptr: *const PathBuffer = &*b;
        drop(b);
        drop(a);

        // LIFO reuse, previous contents kept.
        let c = get();
        assert_eq!(&*c as *const PathBuffer, a_ptr);
        assert_eq!(c[0], b'a');
        let d = get();
        assert_eq!(&*d as *const PathBuffer, b_ptr);
        assert_eq!(d[0], b'b');
    }

    #[test]
    fn pool_caps_the_cached_buffers() {
        U8_POOL.with(|p| p.borrow_mut().clear());
        let guards: Vec<Guard> = (0..POOL_CAP + 2).map(|_| get()).collect();
        drop(guards);
        assert_eq!(U8_POOL.with(|p| p.borrow().len()), POOL_CAP);
    }

    #[test]
    fn wide_pool_is_separate_and_zeroed() {
        U16_POOL.with(|p| p.borrow_mut().clear());
        let w = w_path_buffer_pool::get();
        assert!(w.iter().all(|&unit| unit == 0));
        assert_eq!(w.len(), bun_core::PATH_MAX_WIDE);
    }
}
