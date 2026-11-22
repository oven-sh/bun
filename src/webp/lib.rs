//! Still WebP images to and from 8-bit RGBA, for `Bun.Image`. Derived from libwebp (LICENSE.md).
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
#![feature(hint_prefetch)]

mod alpha;
mod array;
mod decoder;
mod encoder;
mod error;
mod lossless;
mod lossy;
mod riff;
mod slice;
mod vec;

pub use decoder::{Decoder, Image};
pub use encoder::{Compression, encode};
pub use error::{Error, Result};
