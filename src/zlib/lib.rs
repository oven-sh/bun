//! DEFLATE (RFC 1951), bare or in a zlib (RFC 1950) or gzip (RFC 1952) container. Derived from zlib-ng (LICENSE.md).
#![forbid(unsafe_code)]
// Compressed data comes from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]
#![feature(allocator_ext, core_io_borrowed_buf)]

mod array;
mod checksum;
pub mod deflate;
mod error;
mod format;
pub mod inflate;
mod vec;

pub use checksum::{adler32, crc32};
pub use deflate::Deflater;
pub use error::{Damage, Error, Result};
pub use format::{DEFLATE_METHOD, GZIP_ID, gzip_flag};
pub use inflate::Inflater;
