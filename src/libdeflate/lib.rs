//! A port of libdeflate: DEFLATE, zlib and gzip, one whole buffer at a time. See README.md and LICENSE next to it.

#![feature(allocator_api)]
#![feature(fn_align)]
#![forbid(unsafe_code)]
// Streams come from anywhere and the release profile aborts on a panic.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod bt_matchfinder;
mod compressor;
mod constants;
mod decompressor;
mod deflate_compress;
mod deflate_decompress;
mod error;
mod hc_matchfinder;
mod ht_matchfinder;
mod huffman;
mod matchfinder;
mod near_optimal;
mod output;

pub use compressor::{Compressor, Encoding, Level};
pub use decompressor::{ByteCounts, Decoding, Decompressor};
pub use error::{Error, Result};

/// An empty `Vec` with room for `capacity` elements, or `None` if there is no memory for them.
fn vec_with_capacity<T>(capacity: usize) -> Option<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity).ok()?;
    Some(vec)
}
