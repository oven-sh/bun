//! Brotli (RFC 7932), and its "large window" extension. Derived from https://github.com/google/brotli (LICENSE.md).
#![feature(allocator_api, hint_prefetch, once_cell_try)]
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
    DEFAULT_WINDOW, Encoder, EncoderError, EncoderMode, EncoderOperation, EncoderParameter,
    MAX_QUALITY, MIN_QUALITY, PreparedDictionary, compress, compress_append, max_compressed_size,
};
pub use error::{Error, Result};
pub use io::{Output, SpareCapacity};
pub use streaming_decoder::StreamingDecoder;
