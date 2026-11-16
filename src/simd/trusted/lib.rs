//! All the `unsafe` of `bun_simd`, and what it relies on.
#![no_std]
#![feature(cfg_sanitize, fn_static, portable_simd, try_blocks)]
#![deny(unsafe_code)]
// The decoders for other systems are public, so that every machine can test them.
#![cfg_attr(mordant, allow(unused_pub))]
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

extern crate alloc;

pub mod aarch64;
#[allow(unsafe_code)]
mod atomic_fn;
pub mod features;
mod gate;
#[allow(unsafe_code)]
mod opaque;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#[allow(unsafe_code)]
mod os;
#[allow(unsafe_code)]
mod output;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#[allow(unsafe_code)]
pub mod shared;
#[allow(unsafe_code)]
mod shared_u8;
mod target;
pub mod x86_64;

#[cfg(target_arch = "aarch64")]
pub use aarch64::Features;
pub use atomic_fn::AtomicFn;
pub use opaque::{opaque, opaque16};
pub use output::{Append, Out, UNROLL, Writer, extend_vec, quarters, spare_capacity};
pub use shared_u8::SharedU8;
pub use target::Target;
#[cfg(target_arch = "x86_64")]
pub use x86_64::Features;

/// The features that every thread of this process can use.
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#[inline]
pub fn detected() -> Features {
    use core::sync::atomic::{AtomicU64, Ordering::Relaxed};
    const KNOWN: u64 = 1 << 63;
    static CACHE: AtomicU64 = AtomicU64::new(0);
    #[cold]
    fn first_call() -> u64 {
        let bits = os::query().0 | Features::IN_BUILD.0 | KNOWN;
        CACHE.store(bits, Relaxed);
        bits
    }
    let bits = CACHE.load(Relaxed);
    Features::from_bits((if bits != 0 { bits } else { first_call() }) & !KNOWN)
}

/// A constant if the whole program is compiled for `features`.
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#[inline(always)]
pub fn is_supported(features: Features) -> bool {
    #[inline(never)]
    fn is_detected(features: Features) -> bool {
        detected().contains(features)
    }
    Features::IN_BUILD.contains(features) || is_detected(features)
}
