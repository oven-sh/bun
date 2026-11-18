//! What a build with `-Cpasses=sancov-module -Cllvm-args=-sanitizer-coverage-inline-8bit-counters` counts.
//! <https://clang.llvm.org/docs/SanitizerCoverage.html>

use core::sync::atomic::{AtomicPtr, AtomicU8, AtomicUsize, Ordering};

static START: AtomicPtr<AtomicU8> = AtomicPtr::new(core::ptr::dangling_mut());
static COUNT: AtomicUsize = AtomicUsize::new(0);

#[unsafe(no_mangle)]
extern "C" fn __sanitizer_cov_8bit_counters_init(start: *mut AtomicU8, end: *mut AtomicU8) {
    START.store(start, Ordering::Relaxed);
    COUNT.store(end.addr() - start.addr(), Ordering::Relaxed);
}

#[unsafe(no_mangle)]
extern "C" fn __sanitizer_cov_pcs_init(_: *const usize, _: *const usize) {}

/// One byte for each edge of the control flow. They start over from zero.
pub(crate) fn take() -> Vec<u8> {
    let (start, count) = (START.load(Ordering::Relaxed), COUNT.load(Ordering::Relaxed));
    // SAFETY: a section of the program, or nothing.
    let counters = unsafe { core::slice::from_raw_parts(start, count) };
    let take = |counter: &AtomicU8| {
        let count = counter.load(Ordering::Relaxed);
        counter.store(0, Ordering::Relaxed);
        count
    };
    counters.iter().map(take).collect()
}
