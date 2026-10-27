//! Brotli (RFC 7932), and its "large window" extension. Derived from https://github.com/google/brotli (LICENSE.md).
#![forbid(unsafe_code)]
// Streams come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod common;
mod dec;
mod enc;
mod io;
mod util;

pub use dec::{Decoder, DecoderErrorCode, DecoderParameter, DecoderResult};
pub use io::{Output, SpareCapacity};
