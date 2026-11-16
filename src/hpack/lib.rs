//! HPACK, the header compression of HTTP/2 (RFC 7541). Parts derive from ls-hpack (LICENSE.md).
#![forbid(unsafe_code)]
// Header blocks come from anywhere and a panic aborts the process.
#![deny(
    clippy::indexing_slicing,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unreachable
)]
#![warn(unused_must_use)]

mod decoder;
mod dynamic_table;
mod encoder;
mod error;
mod huffman;
mod integer;
mod static_table;

pub use decoder::{Decoder, Field, Fields};
pub use encoder::{Block, Encoder, Indexing};
pub use error::{Error, Result};

/// The initial value of `SETTINGS_HEADER_TABLE_SIZE` (RFC 9113 §6.5.2).
const DEFAULT_TABLE_SIZE: usize = 4096;

/// Of a name and its value together, for a [`Decoder`].
pub const MAX_FIELD_LEN: usize = 65536;

/// `table[index % N]`, which the compiler knows to be in bounds.
#[inline(always)]
#[expect(clippy::indexing_slicing, reason = "the index is less than N")]
fn wrapped<T, const N: usize>(table: &[T; N], index: usize) -> &T {
    const { assert!(N.is_power_of_two()) };
    &table[index % N]
}

#[inline(always)]
#[expect(clippy::indexing_slicing, reason = "the index is less than N")]
fn wrapped_mut<T, const N: usize>(table: &mut [T; N], index: usize) -> &mut T {
    const { assert!(N.is_power_of_two()) };
    &mut table[index % N]
}
