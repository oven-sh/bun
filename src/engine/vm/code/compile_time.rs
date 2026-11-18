//! How long it has taken all threads to make machine code from bytecode.

use core::sync::atomic::{AtomicU64, Ordering};

use bun_engine_platform::clock::monotonic_seconds;

use crate::options;

static NANOSECONDS: AtomicU64 = AtomicU64::new(0);

pub fn counting_compile_time<T>(compile: impl FnOnce() -> T) -> T {
    let start = options().report_total_compile_times.then(monotonic_seconds);
    let result = compile();
    if let Some(start) = start {
        let elapsed = (monotonic_seconds() - start) * 1e9;
        NANOSECONDS.fetch_add(elapsed as u64, Ordering::Relaxed);
    }
    result
}

/// Zero unless it is counted.
pub fn total_compile_seconds() -> f64 {
    NANOSECONDS.load(Ordering::Relaxed) as f64 / 1e9
}
