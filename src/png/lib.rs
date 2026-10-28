//! PNG to and from 8-bit RGBA, for `Bun.Image`. Parts derive from libspng (LICENSE.md). DEFLATE comes from zlib through
//! `bun_zlib`, and the loops of the scanline filters from src/jsc/bindings/highway_png.cpp through `bun_highway`.
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
mod decoder;
mod encoder;
mod error;
mod filter;
mod header;

pub use decoder::{Decoder, Image};
pub use encoder::{Palette, encode};
pub use error::{Error, Result};
pub use header::Header;
