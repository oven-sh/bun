//! HTTP/2 (RFC 9113), apart from sockets.
#![forbid(unsafe_code)]
// Frames come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]

pub mod server;
