//! Per-size-bucket live-allocation histogram for the Rust global allocator.
//!
//! Only compiled when `cfg(bun_track_alloc)` is set (via `BUN_TRACK_ALLOC=1`
//! at build time). Wraps the real allocator and maintains `(bytes, count)`
//! counters per power-of-two size bucket, readable from JS via
//! `hotReloadDiagnostics().allocHistogram`. This surfaces reachable-but-growing
//! native memory that LSAN (unreachable-only) cannot see.

use core::alloc::{GlobalAlloc, Layout};
use core::sync::atomic::{AtomicI64, Ordering};

const BUCKETS: usize = 32;
static LIVE_BYTES: [AtomicI64; BUCKETS] = [const { AtomicI64::new(0) }; BUCKETS];
static LIVE_COUNT: [AtomicI64; BUCKETS] = [const { AtomicI64::new(0) }; BUCKETS];

#[inline]
fn bucket(size: usize) -> usize {
    let b = usize::BITS - size.max(1).leading_zeros();
    (b as usize).min(BUCKETS - 1)
}

#[inline]
fn add(size: usize) {
    let b = bucket(size);
    LIVE_BYTES[b].fetch_add(size as i64, Ordering::Relaxed);
    LIVE_COUNT[b].fetch_add(1, Ordering::Relaxed);
}

#[inline]
fn sub(size: usize) {
    let b = bucket(size);
    LIVE_BYTES[b].fetch_sub(size as i64, Ordering::Relaxed);
    LIVE_COUNT[b].fetch_sub(1, Ordering::Relaxed);
}

pub(crate) struct Tracked<A: GlobalAlloc>(pub(crate) A);

unsafe impl<A: GlobalAlloc> GlobalAlloc for Tracked<A> {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let p = unsafe { self.0.alloc(layout) };
        if !p.is_null() {
            add(layout.size());
        }
        p
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        sub(layout.size());
        unsafe { self.0.dealloc(ptr, layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let p = unsafe { self.0.alloc_zeroed(layout) };
        if !p.is_null() {
            add(layout.size());
        }
        p
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let p = unsafe { self.0.realloc(ptr, layout, new_size) };
        if !p.is_null() {
            sub(layout.size());
            add(new_size);
        }
        p
    }
}

/// Writes `BUCKETS` pairs of `(live_bytes, live_count)` into `out` (caller
/// provides `out_len` i64 slots). Returns the bucket count written.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__trackedAllocHistogram(out: *mut i64, out_len: usize) -> usize {
    let n = BUCKETS.min(out_len / 2);
    for i in 0..n {
        // SAFETY: caller passes a buffer of `out_len` i64s.
        unsafe {
            *out.add(i * 2) = LIVE_BYTES[i].load(Ordering::Relaxed);
            *out.add(i * 2 + 1) = LIVE_COUNT[i].load(Ordering::Relaxed);
        }
    }
    n
}
