//! What `fetch()` and the `WebSocket` client read off an HTTP/1.x connection: the head of a response and a chunked
//! body. No I/O and no allocation.
//!
//! Both derive from picohttpparser, and accept and reject what Bun did when it called that:
//! - https://github.com/h2o/picohttpparser (Kazuho Oku, Tokuhiro Matsuno, Daisuke Murase, Shigeo Mitsunari; MIT or
//!   the Perl license)
#![forbid(unsafe_code)]
// The bytes come from whatever server answered, and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod chunked;
mod response;
#[cfg(test)]
mod tests;

pub use chunked::{ChunkedDecoder, ChunkedStatus, Decoded};
pub use response::{HeadScanner, Header, ParseError, ResponseHead, parse_response};
