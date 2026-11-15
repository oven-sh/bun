//! JPEG to and from RGBA. It derives from libjpeg-turbo 3.2.0, so it is based in part on the work of the Independent JPEG Group (LICENSE.md).
#![forbid(unsafe_code)]
// Images come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]
// `Vec::shrink_to_fit()` aborts if it is refused memory: test/internal/source-lints/image-refusable-memory.test.ts.
#![feature(hint_prefetch, vec_fallible_shrink)]

// The C files and functions that comments name are in https://github.com/libjpeg-turbo/libjpeg-turbo/tree/c85e6b905bf237038faa936dab160ebfc5da0344/src
mod arithmetic;
mod bit_reader;
mod bit_writer;
mod block;
mod decoder;
mod encoder;
mod error;
mod header;
mod huffman;
mod input;
mod lossless;
mod marker;
mod output;
mod progressive;
mod progressive_encoder;
mod scan;
mod segment_writer;
mod sequential;
mod sequential_encoder;
mod smoothing;
mod strips;

pub use decoder::{Decoder, Image};
pub use encoder::encode;
pub use error::{Error, Result};
pub use header::Header;

const MAX_COMPONENTS: usize = 4;

/// `table[index % N]`, which the compiler knows to be in bounds.
#[inline(always)]
#[expect(clippy::indexing_slicing, reason = "the index is less than N")]
fn wrapped<T, const N: usize>(table: &[T; N], index: usize) -> &T {
    const { assert!(N.is_power_of_two()) };
    &table[index % N]
}

#[inline(always)]
#[expect(clippy::indexing_slicing, reason = "the index is less than N")]
fn wrapped_mut<T, const N: usize>(table: &mut [T; N], index: usize) -> &mut T {
    const { assert!(N.is_power_of_two()) };
    &mut table[index % N]
}

/// Grows `vec` to `len`. Inlined, so that filling with zeros becomes a `memset`.
#[inline(always)]
fn fill_up<T: Copy>(vec: &mut Vec<T>, len: usize, value: T) -> Result<()> {
    vec.try_reserve_exact(len.saturating_sub(vec.len()))?;
    vec.resize(len, value);
    Ok(())
}

#[inline(always)]
fn filled<T: Copy>(len: usize, value: T) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    fill_up(&mut vec, len, value)?;
    Ok(vec)
}

/// Splits `0..len` into runs of at most `size`. Yields where each starts, and its length.
fn batches(len: usize, size: usize) -> impl Iterator<Item = [usize; 2]> {
    let starts = (0..len).step_by(size);
    starts.map(move |start| [start, size.min(len - start)])
}
