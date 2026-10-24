//! tar and gzip framing without I/O, behaving as libarchive did. Parts derive from it (LICENSE.md).
#![forbid(unsafe_code)]
// Archives come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

pub mod compose;
pub mod decoder;
pub mod error;
pub mod gzip;
mod header;
mod num;
pub mod output;
pub mod reader;
pub mod writer;

pub use decoder::{Decoder, MemoryDecoder};
pub use error::{Error, Result};
pub use reader::{Charset, Dialect, Entry, Event, Options, Reader};
