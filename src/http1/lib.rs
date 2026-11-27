//! HTTP/1.1 framing without I/O. Parts derive from picohttpparser and llhttp (LICENSE.md).
#![forbid(unsafe_code)]
// Messages come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod byte_sets;
mod chunked;
mod error;
pub mod message;
mod response;

pub use chunked::ChunkedDecoder;
pub use error::{Error, Result};
pub use response::{HeadOptions, Response, ResponseParser};
