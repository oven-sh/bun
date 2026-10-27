//! A JPEG decoder and encoder for `Bun.Image`.
//!
//! It does what libjpeg-turbo 3.2.0 does on x86-64 through the TurboJPEG API, bit for bit: the same streams decode, to
//! the same pixels, and the same pixels encode to the same bytes. Most of it derives from libjpeg-turbo and from the
//! Independent JPEG Group's library that libjpeg-turbo is based on (LICENSE.md). The file names in the module
//! descriptions are theirs.
//!
//! Only what `Bun.Image` needs is here. Decoding: 8-bit baseline, extended sequential and progressive streams, Huffman or
//! arithmetic coded, and lossless Huffman streams of up to 8 bits, to RGBA or CMYK, at 1/8 to 8/8 of the size.
//! Encoding: RGBA to 4:2:0 YCbCr, baseline or progressive.

#![forbid(unsafe_code)]
// Images come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]

mod decode;
mod encode;
mod error;
mod lanes;
mod markers;
mod tables;

pub use decode::{ColorSpace, Decoder};
pub use encode::{EncodeOptions, encode};
pub use error::{Error, Result};
