//! libjpeg-turbo 3.2.0 on x86-64, bit for bit but for `Error::RedundantScan`. Modules name their sources (LICENSE.md).

#![feature(allocator_api)]
#![forbid(unsafe_code)]
// Images come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]

mod alloc;
mod decode;
mod encode;
mod error;
mod lanes;
mod markers;
mod tables;
mod zigzag;

pub use decode::{ColorSpace, DecodeOptions, Decoder};
pub use encode::{EncodeOptions, encode};
pub use error::{Error, Result};
