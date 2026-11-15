//! All the `unsafe` of `bun_simd`, and what it relies on.
#![no_std]
#![feature(portable_simd, fn_static)]
#![deny(unsafe_code)]
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

#[macro_use]
mod features;
pub mod aarch64;
#[allow(unsafe_code)]
mod atomic_fn;
#[allow(unsafe_code)]
pub mod gate;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#[allow(unsafe_code)]
mod os;
#[allow(unsafe_code)]
pub mod shared;
pub mod x86_64;

#[cfg(target_arch = "aarch64")]
pub use aarch64::Features;
pub use atomic_fn::AtomicFn;
#[cfg(target_arch = "x86_64")]
pub use x86_64::Features;

/// What the code may use on every thread of this process.
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#[inline]
pub fn detected() -> Features {
    use core::sync::atomic::{AtomicU64, Ordering::Relaxed};
    const KNOWN: u64 = 1 << 63;
    static CACHE: AtomicU64 = AtomicU64::new(0);
    #[cold]
    fn first_call() -> u64 {
        let bits = os::ask().0 | Features::OF_BUILD.0 | KNOWN;
        CACHE.store(bits, Relaxed);
        bits
    }
    let bits = CACHE.load(Relaxed);
    Features((if bits != 0 { bits } else { first_call() }) & !KNOWN)
}
