#![doc = include_str!("README.md")]
#![forbid(unsafe_code)]
// A peer's bytes reach this crate and the release profile aborts on a panic.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]

mod decoder;
mod encoder;
mod error;
mod huffman;
mod integer;
mod static_table;
mod storage;

pub use decoder::{Decoder, Field};
pub use encoder::{Encoder, Indexing};
pub use error::Error;
pub(crate) use error::Result;

/// The dynamic table capacity both sides start from (RFC 9113 §6.5.2).
const DEFAULT_TABLE_CAPACITY: u32 = 4096;

/// The longest name and value together that [`Encoder::encode`] takes and the decoder accepts.
const MAX_FIELD_LEN: usize = 65536;

/// What an entry counts towards the table size beside its name and value (§4.1).
const ENTRY_OVERHEAD: usize = 32;

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::indexing_slicing)]
mod tests;
