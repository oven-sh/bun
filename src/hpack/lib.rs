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
pub use static_table::name as static_name;

/// The initial value of `SETTINGS_HEADER_TABLE_SIZE` (RFC 9113 §6.5.2).
const DEFAULT_TABLE_SIZE: usize = 4096;

/// Of a name and its value together, for a [`Decoder`].
pub const MAX_FIELD_LEN: usize = 65536;

/// `a == b` without a call for what is short.
#[inline(always)]
fn equal(a: &[u8], b: &[u8]) -> bool {
    #[inline(always)]
    fn ends_equal<const N: usize>(a: &[u8], b: &[u8]) -> bool {
        a.first_chunk::<N>() == b.first_chunk() && a.last_chunk::<N>() == b.last_chunk()
    }
    a.len() == b.len()
        && match a.len() {
            0 => true,
            1 => ends_equal::<1>(a, b),
            2..4 => ends_equal::<2>(a, b),
            4..8 => ends_equal::<4>(a, b),
            8..16 => ends_equal::<8>(a, b),
            16..=32 => ends_equal::<16>(a, b),
            _ => a == b,
        }
}

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

#[cfg(test)]
mod tests {
    use super::equal;

    #[test]
    fn equal_looks_at_every_byte() {
        let one_at = |at, len| (0..len).map(|i| u8::from(i == at)).collect::<Vec<_>>();
        for len in 0..70 {
            assert!(equal(&vec![0; len], &vec![0; len]));
            assert!(!equal(&vec![0; len], &vec![0; len + 1]));
            for at in 0..len {
                assert!(!equal(&vec![0; len], &one_at(at, len)));
            }
        }
    }
}
