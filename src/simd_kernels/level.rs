//! The instructions that the kernels of all crates use.
//!
//! Vectors of 64 bytes start at `icelake`. On Skylake and Cascade Lake one such instruction lowers the clock for all code
//! that follows, by up to 15% for 0.7 ms.
use bun_simd::prelude::*;
use bun_simd::target::{Target, set_cpu};
use core::sync::atomic::{AtomicUsize, Ordering::Relaxed};

const NAMES: [&str; 8] = [
    "baseline",
    "sse4",
    "avx2 without aes",
    "avx2",
    "avx512",
    "icelake",
    "neon",
    "neon82",
];

static DETECTED: AtomicUsize = AtomicUsize::new(0);

/// Remembers the level in use.
#[kernel(icelake, avx512 + aes, avx2 + aes, avx2, sse4, neon82, neon)]
pub fn detect() {
    let level = pick! {
        icelake => 5,
        avx512 => 4,
        avx2 + aes => 3,
        avx2 => 2,
        sse4 => 1,
        neon82 => 7,
        neon => 6,
        _ => 0,
    };
    DETECTED.store(level, Relaxed);
}

/// What [`detect`] has found.
pub fn detected() -> &'static str {
    NAMES[DETECTED.load(Relaxed)]
}

/// From now on, only what the whole program is compiled for. It doesn't ask the CPU.
pub fn lower_to_baseline() {
    set_cpu(Target::Portable);
}
