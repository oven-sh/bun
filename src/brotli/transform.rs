//! RFC 7932 section 8 and appendix B: what a reference does to a word of the static dictionary.

use crate::dictionary::{MAX_WORD_LENGTH, PADDED_WORD_LENGTH};
use Kind::{Identity, OmitFirst, OmitLast, UppercaseAll, UppercaseFirst};

const MAX_AFFIX_LENGTH: usize = 8;
/// Holds the longest result, and what the copies of a fixed size write past it.
pub(crate) const ROOM: usize = 48;

#[derive(Clone, Copy)]
pub(crate) enum Kind {
    Identity,
    OmitFirst(u8),
    OmitLast(u8),
    UppercaseFirst,
    UppercaseAll,
}

#[derive(Clone, Copy)]
pub(crate) struct Transform {
    prefix: [u8; MAX_AFFIX_LENGTH],
    suffix: [u8; MAX_AFFIX_LENGTH],
    prefix_length: u8,
    suffix_length: u8,
    skipped: u8,
    omitted: u8,
    /// Up to so many characters.
    uppercased: u8,
}

impl Transform {
    const fn new(prefix: &[u8], kind: Kind, suffix: &[u8]) -> Self {
        const fn padded(text: &[u8]) -> [u8; MAX_AFFIX_LENGTH] {
            let mut bytes = [0; MAX_AFFIX_LENGTH];
            bytes.split_at_mut(text.len()).0.copy_from_slice(text);
            bytes
        }
        let (skipped, omitted, uppercased) = match kind {
            Identity => (0, 0, 0),
            OmitFirst(n) => (n, n, 0),
            OmitLast(n) => (0, n, 0),
            UppercaseFirst => (0, 0, 1),
            UppercaseAll => (0, 0, MAX_WORD_LENGTH as u8),
        };
        Self {
            prefix: padded(prefix),
            suffix: padded(suffix),
            prefix_length: prefix.len() as u8,
            suffix_length: suffix.len() as u8,
            skipped,
            omitted,
            uppercased,
        }
    }

    /// The inverse of [`get`](Self::get), for tables.
    #[allow(clippy::indexing_slicing)] // Runs at compile time.
    pub(crate) const fn index_of(prefix: &[u8], kind: Kind, suffix: &[u8]) -> Option<u8> {
        let wanted = Self::new(prefix, kind, suffix);
        let mut index = 0;
        while index < TRANSFORMS.len() {
            let other = &TRANSFORMS[index];
            if u64::from_le_bytes(other.prefix) == u64::from_le_bytes(wanted.prefix)
                && u64::from_le_bytes(other.suffix) == u64::from_le_bytes(wanted.suffix)
                && other.skipped == wanted.skipped
                && other.omitted == wanted.omitted
                && other.uppercased == wanted.uppercased
            {
                return Some(index as u8);
            }
            index += 1;
        }
        None
    }

    pub(crate) fn get(index: usize) -> Option<&'static Self> {
        TRANSFORMS.get(index)
    }

    /// Returns the length of what it left at the start of `out`. Spoils up to 16 bytes after that.
    #[inline(always)]
    pub(crate) fn apply(
        &self,
        word: &[u8; PADDED_WORD_LENGTH],
        length: usize,
        out: &mut [u8; ROOM],
    ) -> Option<usize> {
        let length = length.saturating_sub(usize::from(self.omitted));
        let word = word.get(usize::from(self.skipped)..)?;
        let (first, rest) = word.first_chunk::<MAX_WORD_LENGTH>()?.split_at(16);
        *out.first_chunk_mut()? = self.prefix;
        let body = out.get_mut(usize::from(self.prefix_length)..)?;
        *body.first_chunk_mut::<16>()? = *first.first_chunk()?;
        if length > first.len() {
            *body.get_mut(16..)?.first_chunk_mut::<8>()? = *rest.first_chunk()?;
        }
        let mut at = 0;
        for _ in 0..self.uppercased {
            at += uppercase_one(body.get_mut(at..)?.first_chunk_mut()?);
            if at >= length {
                break;
            }
        }
        *body.get_mut(length..)?.first_chunk_mut()? = self.suffix;
        Some(usize::from(self.prefix_length + self.suffix_length) + length)
    }
}

/// Returns the length of the character.
fn uppercase_one([first, second, third]: &mut [u8; 3]) -> usize {
    match *first {
        0..0xC0 => {
            first.make_ascii_uppercase();
            1
        }
        0xC0..0xE0 => {
            *second ^= 32;
            2
        }
        0xE0.. => {
            *third ^= 5;
            3
        }
    }
}

#[allow(clippy::indexing_slicing)] // Runs at compile time.
static TRANSFORMS: [Transform; LIST.len()] = {
    let mut transforms = [Transform::new(b"", Identity, b""); LIST.len()];
    let mut i = 0;
    while i < LIST.len() {
        let (prefix, kind, suffix) = LIST[i];
        transforms[i] = Transform::new(prefix, kind, suffix);
        i += 1;
    }
    transforms
};

const LIST: [(&[u8], Kind, &[u8]); 121] = [
    (b"", Identity, b""),
    (b"", Identity, b" "),
    (b" ", Identity, b" "),
    (b"", OmitFirst(1), b""),
    (b"", UppercaseFirst, b" "),
    (b"", Identity, b" the "),
    (b" ", Identity, b""),
    (b"s ", Identity, b" "),
    (b"", Identity, b" of "),
    (b"", UppercaseFirst, b""),
    (b"", Identity, b" and "),
    (b"", OmitFirst(2), b""),
    (b"", OmitLast(1), b""),
    (b", ", Identity, b" "),
    (b"", Identity, b", "),
    (b" ", UppercaseFirst, b" "),
    (b"", Identity, b" in "),
    (b"", Identity, b" to "),
    (b"e ", Identity, b" "),
    (b"", Identity, b"\""),
    (b"", Identity, b"."),
    (b"", Identity, b"\">"),
    (b"", Identity, b"\n"),
    (b"", OmitLast(3), b""),
    (b"", Identity, b"]"),
    (b"", Identity, b" for "),
    (b"", OmitFirst(3), b""),
    (b"", OmitLast(2), b""),
    (b"", Identity, b" a "),
    (b"", Identity, b" that "),
    (b" ", UppercaseFirst, b""),
    (b"", Identity, b". "),
    (b".", Identity, b""),
    (b" ", Identity, b", "),
    (b"", OmitFirst(4), b""),
    (b"", Identity, b" with "),
    (b"", Identity, b"'"),
    (b"", Identity, b" from "),
    (b"", Identity, b" by "),
    (b"", OmitFirst(5), b""),
    (b"", OmitFirst(6), b""),
    (b" the ", Identity, b""),
    (b"", OmitLast(4), b""),
    (b"", Identity, b". The "),
    (b"", UppercaseAll, b""),
    (b"", Identity, b" on "),
    (b"", Identity, b" as "),
    (b"", Identity, b" is "),
    (b"", OmitLast(7), b""),
    (b"", OmitLast(1), b"ing "),
    (b"", Identity, b"\n\t"),
    (b"", Identity, b":"),
    (b" ", Identity, b". "),
    (b"", Identity, b"ed "),
    (b"", OmitFirst(9), b""),
    (b"", OmitFirst(7), b""),
    (b"", OmitLast(6), b""),
    (b"", Identity, b"("),
    (b"", UppercaseFirst, b", "),
    (b"", OmitLast(8), b""),
    (b"", Identity, b" at "),
    (b"", Identity, b"ly "),
    (b" the ", Identity, b" of "),
    (b"", OmitLast(5), b""),
    (b"", OmitLast(9), b""),
    (b" ", UppercaseFirst, b", "),
    (b"", UppercaseFirst, b"\""),
    (b".", Identity, b"("),
    (b"", UppercaseAll, b" "),
    (b"", UppercaseFirst, b"\">"),
    (b"", Identity, b"=\""),
    (b" ", Identity, b"."),
    (b".com/", Identity, b""),
    (b" the ", Identity, b" of the "),
    (b"", UppercaseFirst, b"'"),
    (b"", Identity, b". This "),
    (b"", Identity, b","),
    (b".", Identity, b" "),
    (b"", UppercaseFirst, b"("),
    (b"", UppercaseFirst, b"."),
    (b"", Identity, b" not "),
    (b" ", Identity, b"=\""),
    (b"", Identity, b"er "),
    (b" ", UppercaseAll, b" "),
    (b"", Identity, b"al "),
    (b" ", UppercaseAll, b""),
    (b"", Identity, b"='"),
    (b"", UppercaseAll, b"\""),
    (b"", UppercaseFirst, b". "),
    (b" ", Identity, b"("),
    (b"", Identity, b"ful "),
    (b" ", UppercaseFirst, b". "),
    (b"", Identity, b"ive "),
    (b"", Identity, b"less "),
    (b"", UppercaseAll, b"'"),
    (b"", Identity, b"est "),
    (b" ", UppercaseFirst, b"."),
    (b"", UppercaseAll, b"\">"),
    (b" ", Identity, b"='"),
    (b"", UppercaseFirst, b","),
    (b"", Identity, b"ize "),
    (b"", UppercaseAll, b"."),
    (b"\xC2\xA0", Identity, b""),
    (b" ", Identity, b","),
    (b"", UppercaseFirst, b"=\""),
    (b"", UppercaseAll, b"=\""),
    (b"", Identity, b"ous "),
    (b"", UppercaseAll, b", "),
    (b"", UppercaseFirst, b"='"),
    (b" ", UppercaseFirst, b","),
    (b" ", UppercaseAll, b"=\""),
    (b" ", UppercaseAll, b", "),
    (b"", UppercaseAll, b","),
    (b"", UppercaseAll, b"("),
    (b"", UppercaseAll, b". "),
    (b" ", UppercaseAll, b"."),
    (b"", UppercaseAll, b"='"),
    (b" ", UppercaseAll, b". "),
    (b" ", UppercaseFirst, b"=\""),
    (b" ", UppercaseAll, b"='"),
    (b" ", UppercaseFirst, b"='"),
];
