//! DEFLATE, zlib and gzip, one whole buffer at a time, byte for byte as libdeflate does it. A port of it (LICENSE.md, README.md).

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
mod compress;
mod compressor;
mod constants;
mod decompress;
mod decompressor;
mod error;
mod hc_matchfinder;
mod ht_matchfinder;
mod huffman;
mod matchfinder;
mod near_optimal;

pub use compressor::{Compressor, MAX_COMPRESSION_LEVEL, MIN_COMPRESSION_LEVEL};
pub use decompressor::{Decompressed, Decompressor};
pub use error::{Error, Result};

/// What wraps the DEFLATE stream.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Encoding {
    /// Nothing (RFC 1951).
    Deflate,
    /// A two-byte header and an Adler-32 (RFC 1950).
    Zlib,
    /// A header of ten bytes or more, a CRC-32 and the length (RFC 1952).
    Gzip,
}

const GZIP_MIN_HEADER_SIZE: usize = 10;
const GZIP_FOOTER_SIZE: usize = 8;
const GZIP_MIN_OVERHEAD: usize = GZIP_MIN_HEADER_SIZE + GZIP_FOOTER_SIZE;
const GZIP_ID1: u8 = 0x1F;
const GZIP_ID2: u8 = 0x8B;
const GZIP_CM_DEFLATE: u8 = 8;

const ZLIB_MIN_HEADER_SIZE: usize = 2;
const ZLIB_FOOTER_SIZE: usize = 4;
const ZLIB_MIN_OVERHEAD: usize = ZLIB_MIN_HEADER_SIZE + ZLIB_FOOTER_SIZE;
const ZLIB_CM_DEFLATE: u16 = 8;
const ZLIB_CINFO_32K_WINDOW: u16 = 7;
