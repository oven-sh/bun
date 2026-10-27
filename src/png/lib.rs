//! PNG to and from 8-bit RGBA, behaving as libspng 0.7.4 did for `Bun.Image`. Parts derive from it (LICENSE.md).
//! DEFLATE comes from zlib through `bun_zlib`.
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

mod chunk;
pub mod decoder;
pub mod encoder;
pub mod error;
mod filter;
pub mod header;

pub use decoder::{Decoder, Image};
pub use encoder::{Palette, encode_indexed, encode_rgba};
pub use error::{Error, Result};
pub use header::{ColorType, Header};
