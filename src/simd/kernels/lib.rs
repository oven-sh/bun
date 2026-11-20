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
pub mod zlib;
pub mod zstd;

use bun_simd::{Out, Source, Writer, opaque};
use core::hint::cold_path;

pub use byte_set::ByteSet;
pub use {adler32::*, crc32::*, xxhash::*};
pub use {convert::*, hex::*, words::*};
pub use {memmem::*, paths::*, scanner::*, search::*, width::*};

trait Byte = Source<Lane = u8>;

/// What gets the bytes that a checksum loads.
trait Copies {
    /// Then loads are `opaque`, or LLVM may make a second pass of the copy.
    const KEEPS: bool;

    /// Keeps the first `count`.
    fn put<const N: usize>(&mut self, bytes: [u8; N], count: usize);
    fn put_each<T, const N: usize>(&mut self, from: &[T], load: impl FnMut(&T) -> [u8; N]);
}

impl Copies for () {
    const KEEPS: bool = false;

    #[inline(always)]
    fn put<const N: usize>(&mut self, _: [u8; N], _: usize) {}

    #[inline(always)]
    fn put_each<T, const N: usize>(&mut self, from: &[T], mut load: impl FnMut(&T) -> [u8; N]) {
        #[rustc_unroll(never)]
        for it in from {
            load(it);
        }
    }
}

impl Copies for Writer<'_, u8> {
    const KEEPS: bool = true;

    #[inline(always)]
    fn put<const N: usize>(&mut self, bytes: [u8; N], count: usize) {
        self.push_first(bytes, count);
    }

    #[inline(always)]
    fn put_each<T, const N: usize>(&mut self, from: &[T], mut load: impl FnMut(&T) -> [u8; N]) {
        self.extend_with(from, |it| Some(load(it)));
    }
}

/// The checksum is that of the copy.
#[inline(always)]
fn copy_then<'a>(
    sum: &mut u32,
    from: &[u8],
    to: Out<'a, u8>,
    update: impl Fn(u32, &[u8]) -> u32,
) -> &'a mut [u8] {
    let mut to = to.into_writer();
    to.extend_from_slice(from);
    let copy = to.finish();
    // LLVM may read `from` again, unless this can be another address.
    *sum = update(*sum, &copy[opaque(0) as usize..]);
    copy
}

/// From it on, aligned loads are worth a second call.
const LONG: usize = 16384;

/// How many bytes `aligned` leaves for its second call.
#[inline(always)]
fn unaligned_len(bytes: &[impl Byte]) -> usize {
    if bytes.len() < LONG {
        return 0;
    }
    cold_path();
    bytes.as_ptr_range().end.addr() % align_of::<Aligned<()>>()
}

/// Checksums count vectors from the end. CRC of 64 KB on Sapphire Rapids: 650 ns, from 910.
#[inline(never)]
fn aligned<B: Byte>(sum: u32, bytes: &[B], update: impl Fn(u32, &[B]) -> u32) -> u32 {
    let (most, rest) = bytes.split_at(bytes.len() - unaligned_len(bytes));
    update(update(sum, most), rest)
}

/// Starts a cache line.
#[repr(align(64))]
struct Aligned<T>(T);
