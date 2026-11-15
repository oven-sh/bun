//! A kernel is written once and compiled once per target, and the best copy is picked at run time.
#![no_std]
#![feature(portable_simd, core_float_math, likely_unlikely)]
#![forbid(unsafe_code)]
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]
// Vectors are in registers.
#![allow(clippy::large_types_passed_by_value)]

mod dispatch;
#[macro_use]
mod every_target;
mod lanes;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#[macro_use]
mod registers;
#[cfg(all(doctest, target_arch = "x86_64"))]
mod rejected;
mod up_to_16;

#[cfg(target_arch = "aarch64")]
pub mod neon;
mod spec;
#[cfg(target_arch = "x86_64")]
mod x86;

pub use bun_simd_macros::{foreach_target, foreach_width};
#[doc(hidden)]
pub use bun_simd_trusted::{AtomicFn, gate, if_supported};
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
pub use bun_simd_trusted::{Features, detected};
pub use dispatch::{Target, limit_to};
pub use lanes::{Array, Chunk, Lane, Unit};
pub use spec::{portable, portable32, portable64};
pub use up_to_16::UpTo16;
#[cfg(target_arch = "x86_64")]
pub use x86::{avx2, avx512_icl, avx512_skx, sse4};

#[cfg(doctest)]
#[doc = include_str!("README.md")]
struct Readme;
