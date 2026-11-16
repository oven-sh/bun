//! HTTP/1.1 response framing without I/O. Parts derive from picohttpparser (LICENSE.md).
#![forbid(unsafe_code)]
// Responses come from anywhere and a panic aborts the process.
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
mod response;

pub use chunked::ChunkedDecoder;
pub use error::{Error, Result};
pub use response::{HeadOptions, Response, ResponseParser};
