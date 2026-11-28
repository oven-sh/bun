//! Brotli (RFC 7932), with large windows and raw dictionaries (RFC 9841). Parts derive from google/brotli (LICENSE.md).
#![feature(allocator_ext)]
#![forbid(unsafe_code)]
#![feature(core_io_borrowed_buf, stmt_expr_attributes)]
// Streams come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod context;
mod decoder;
mod dictionary;
mod encoder;
mod error;
mod format;
mod memory;
mod streaming;
mod transform;

pub use decoder::{DecodeStatus, Decoder, SpareTables};
pub use encoder::{
    EncodeStatus, Encoder, MAX_QUALITY, MIN_QUALITY, Operation, SpareMemory, max_compressed_size,
};
pub use error::{DecodeError, EncodeError, Error, Result};
pub use streaming::StreamingDecoder;
