//! JPEG to and from 8-bit RGBA, for `Bun.Image`, on the kernels in src/jsc/bindings/highway_jpeg.cpp. It is based in part
//! on the work of the Independent JPEG Group (LICENSE.md), and derives from libjpeg-turbo, whose files it names:
//! <https://github.com/libjpeg-turbo/libjpeg-turbo/tree/c85e6b905bf237038faa936dab160ebfc5da0344/src>
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
#![feature(vec_fallible_shrink)]

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
mod sequential;
mod smoothing;

pub use decoder::{Decoder, Image};
pub use encoder::encode;
pub use error::{Error, Result};
pub use header::Header;

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

fn filled<T: Copy>(len: usize, value: T) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(len)?;
    vec.resize(len, value);
    Ok(vec)
}
