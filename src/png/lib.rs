//! PNG to and from 8-bit RGBA, for `Bun.Image`. Parts derive from libspng (LICENSE.md). DEFLATE comes from
//! `bun_zlib`.
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
// `Vec::shrink_to_fit()` aborts if it is refused memory: test/internal/source-lints/refusable-memory.test.ts.
#![feature(vec_fallible_shrink)]

mod chunk;
mod decoder;
mod encoder;
mod error;
mod filter;
mod header;
#[expect(clippy::indexing_slicing, reason = "the rows have one length")]
mod simd;

pub use decoder::{Decoder, Image};
pub use encoder::{Palette, encode};
pub use error::{Error, Result};
pub use header::Header;
