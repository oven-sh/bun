//! QPACK, the field compression of HTTP/3 (RFC 9204). Parts derive from ls-qpack (LICENSE.md).
#![forbid(unsafe_code)]
// Field sections and instructions come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod decoder;
mod encoder;
mod error;
mod input;
mod static_table;

pub use bun_hpack::Indexing;
pub use decoder::{Decoder, Field, Fields};
pub use encoder::{Encoder, Section};
pub use error::{Error, Result};
