//! Bun's kernels on `bun_simd`.
#![feature(hint_prefetch, loop_hints, trait_alias)]
#![feature(const_array, const_closures, const_trait_impl)]
#![forbid(unsafe_code)]
// For `#[inline(always)]` in the copies.
#![recursion_limit = "1024"]
// The copies for the targets look alike.
#![cfg_attr(mordant, allow(reimplemented_helper))]

mod adler32;
pub mod brotli;
mod byte_set;
mod convert;
mod crc32;
mod hex;
pub mod image;
pub mod jpeg;
pub mod json;
mod memmem;
mod paths;
pub mod png;
mod scanner;
mod search;
pub mod sourcemap;
pub mod webp;
pub mod websocket;
mod width;
mod words;
pub mod xml;
mod xxhash;

use bun_simd::Source;

pub use byte_set::ByteSet;
pub use {adler32::*, crc32::*, xxhash::*};
pub use {convert::*, hex::*, words::*};
pub use {memmem::*, paths::*, scanner::*, search::*, width::*};

trait Byte = Source<Lane = u8>;

/// Starts a cache line.
#[repr(align(64))]
struct Aligned<T>(T);

/// In a long input, it is worth a call to have no load cross a cache line.
#[inline(always)]
fn in_aligned_parts<B>(mut state: u32, mut bytes: &[B], update: impl Fn(u32, &[B]) -> u32) -> u32 {
    if bytes.len() > 65536 {
        let (head, rest) = bytes.split_at(bytes.as_ptr().addr().wrapping_neg() % 64);
        (state, bytes) = (update(state, head), rest);
    }
    update(state, bytes)
}
