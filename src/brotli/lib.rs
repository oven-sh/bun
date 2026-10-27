//! Brotli (RFC 7932), and its "large window" extension. Derived from https://github.com/google/brotli (LICENSE.md).
#![feature(allocator_api, hint_prefetch)]
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
mod error;
mod io;
mod streaming_decoder;
mod util;

pub use dec::{Decoder, DecoderErrorCode, DecoderParameter, DecoderResult};
pub use enc::{
    DEFAULT_QUALITY, DEFAULT_WINDOW, Encoder, EncoderMode, EncoderOperation, EncoderParameter,
    LARGE_MAX_WINDOW_BITS, MAX_INPUT_BLOCK_BITS, MAX_QUALITY, MAX_WINDOW_BITS,
    MIN_INPUT_BLOCK_BITS, MIN_QUALITY, MIN_WINDOW_BITS, PreparedDictionary, compress,
    compress_append, max_compressed_size,
};
pub use error::{Error, Result};
pub use io::{Output, SpareCapacity};
pub use streaming_decoder::StreamingDecoder;
