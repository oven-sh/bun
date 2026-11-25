//! The history of a time zone, which is in the place of `typeMap`.

use crate::words::{Words, take_bytes};

/// What the binary has after the number of bytes of each but the last.
pub const PARTS: [&str; 5] = [
    "typeOffsets",
    "transPre32",
    "trans",
    "transPost32",
    "typeMap",
];

#[inline]
pub fn parts(mut bytes: &[u8]) -> [&[u8]; PARTS.len()] {
    let sizes = Words::of(take_bytes(&mut bytes, 2 * (PARTS.len() - 1)));
    let [offsets, before, within, after] =
        [0, 1, 2, 3].map(|i| take_bytes(&mut bytes, sizes.index_at(i)));
    [offsets, before, within, after, bytes]
}
