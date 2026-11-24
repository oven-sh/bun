//! A static list of short strings as bytes and 16-bit offsets: a `[&str; N]` takes two words and a relocation per entry.

use crate::common::slice_ext::SliceExt;

pub(crate) struct PackedStrs<const BOUNDS: usize, const BYTES: usize> {
    /// 0, then the end offset of each string.
    pub bounds: [u16; BOUNDS],
    pub bytes: [u8; BYTES],
}

impl<const BOUNDS: usize, const BYTES: usize> PackedStrs<BOUNDS, BYTES> {
    pub(crate) fn len(&self) -> usize {
        BOUNDS - 1
    }

    pub(crate) fn at(&self, index: usize) -> &[u8] {
        self.bytes
            .slice(self.bounds.at(index).into()..self.bounds.at(index + 1).into())
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &[u8]> {
        (0..self.len()).map(|index| self.at(index))
    }
}

/// Declares a static `PackedStrs`: `packed_strs! { static NAMES = ["a", "bc"]; }`
macro_rules! packed_strs {
    ($(#[$attribute:meta])* $visibility:vis static $name:ident = [$($text:literal),* $(,)?];) => {
        $(#[$attribute])*
        $visibility static $name: $crate::common::packed_strs::PackedStrs<
            { [$($text),*].len() + 1 },
            { concat!($($text),*).len() },
        > = {
            let mut end: u16 = 0;
            $crate::common::packed_strs::PackedStrs {
                bounds: [0, $({
                    end += $text.len() as u16;
                    end
                }),*],
                bytes: *concat!($($text),*).as_bytes().first_chunk().unwrap(),
            }
        };
    };
}
pub(crate) use packed_strs;
