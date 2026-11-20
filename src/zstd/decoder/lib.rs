//! The zstd format (RFC 8878) and its decoder. Derived from zstd 1.5.7 (LICENSE.md).
#![forbid(unsafe_code)]
// Frames come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]
#![feature(allocator_ext, const_trait_impl, hint_prefetch)]

pub mod array;
mod bits;
mod block;
pub mod bounded;
mod decompress;
mod destination;
mod dictionary;
mod error;
pub mod format;
mod frame;
mod fse;
mod huffman;
mod literals;
mod output;
mod sequences;
mod stream;
mod xxhash;

pub use block::SpareTables;
pub use decompress::{decompress, decompress_with};
pub use dictionary::Dictionary;
pub use error::{Error, Result};
pub use frame::{
    ContentSize, FrameLen, decompressed_size, frame_content_size, frame_len, may_start_frame,
};
pub use fse::{TableDescription, read_normalized_counts};
pub use huffman::{HuffmanWeights, read_huffman_weights};
pub use output::Output;
pub use stream::{Decoder, Status};
pub use xxhash::XxHash64;
