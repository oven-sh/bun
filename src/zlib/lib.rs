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
#![feature(
    allocator_ext,
    borrowed_buf_init,
    core_io_borrowed_buf,
    stmt_expr_attributes
)]

mod array;
mod checksum;
pub mod deflate;
mod error;
mod format;
pub mod inflate;
mod vec;

pub use deflate::Deflater;
pub use error::{Damage, Error, Result};
pub use format::GZIP_ID;
pub use inflate::Inflater;
