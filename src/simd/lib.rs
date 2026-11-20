//! A kernel is written once and compiled once per target, and the best copy is picked at run time.
#![no_std]
#![feature(portable_simd, likely_unlikely, loop_hints, trait_alias, try_blocks)]
#![feature(const_array, const_closures, const_trait_impl, fn_align)]
#![forbid(unsafe_code)]
// For `#[inline(always)]` in the copies.
#![recursion_limit = "1024"]
#![doc(test(attr(deny(unsafe_code, unfulfilled_lint_expectations), allow(unused))))]
#![cfg_attr(miri, allow(dead_code, unused_imports))]
#![allow(clippy::disallowed_methods, clippy::disallowed_types)]
// The ops come before their first callers, and the copies for the targets look alike.
#![cfg_attr(mordant, allow(unused_pub, reimplemented_helper))]
// Vectors live in registers.
#![allow(clippy::large_types_passed_by_value)]

extern crate self as bun_simd;

mod algo;
mod bit_indices;
#[doc(hidden)]
pub mod dispatch;
mod interleave;
mod isa;
mod mask;
mod matches;
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
mod native;
#[cfg(target_arch = "aarch64")]
pub mod neon;
mod partial;
pub mod portable;
mod sink;
mod source;
#[cfg(all(target_arch = "aarch64", not(target_vendor = "apple")))]
pub mod sve2;
mod swizzle;
mod vector;
#[cfg(target_arch = "x86_64")]
mod x86;

pub use algo::blocks;
pub use bit_indices::BitIndices;
#[doc(hidden)]
pub use bun_simd_macros::force_inline;
pub use bun_simd_macros::{foreach_target, foreach_width};
#[doc(hidden)]
pub use bun_simd_trusted::AtomicFn;
pub use bun_simd_trusted::{Append, Appender, Out, Writer};
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
pub use bun_simd_trusted::{Features, detected, if_supported};
pub use bun_simd_trusted::{SharedOutU8, SharedU8, copy_from_shared, copy_to_shared};
pub use bun_simd_trusted::{Target, opaque};
pub use bun_simd_trusted::{extend_cursor, extend_vec, spare_capacity};
pub use dispatch::{limit_to, limit_to_named, limit_to_with, out_of_line, with_bmi2};
pub use isa::Isa;
pub use mask::Mask;
pub use matches::Matches;
pub use partial::Padded;
#[cfg(any(feature = "test_support", not(target_arch = "x86_64")))]
pub use portable::{portable32, portable64};
pub use sink::{SharedWriter, Sink};
#[cfg(feature = "test_support")]
pub use source::Memory;
pub use source::Source;
pub use swizzle::Shuffle;
pub use vector::{Factor, Int, Lane, Vector};
#[cfg(target_arch = "x86_64")]
pub use x86::{avx2, avx512_icl, avx512_skx, sse4};

cfg_select! {
    target_arch = "x86_64" => {
        pub use sse4 as baseline;
    }
    target_arch = "aarch64" => {
        pub use neon as baseline;
    }
    _ => {
        pub use portable as baseline;
    }
}

#[cfg(doctest)]
#[doc = include_str!("README.md")]
struct Readme;

#[cfg(all(doctest, target_arch = "x86_64", not(miri)))]
#[doc = include_str!("rejected.md")]
struct Rejected;
