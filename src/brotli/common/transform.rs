//! Appendix B. List of Word Transformations.

use crate::util::{Bug, Checked, SliceExt};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    Identity,
    OmitLast(u8),
    UppercaseFirst,
    UppercaseAll,
    OmitFirst(u8),
}
use Kind::{Identity, OmitFirst, OmitLast, UppercaseAll, UppercaseFirst};

#[derive(Clone, Copy)]
pub(crate) struct Transform {
    /// Index in [`AFFIXES`].
    pub(crate) prefix: u8,
    pub(crate) kind: Kind,
    /// Index in [`AFFIXES`].
    pub(crate) suffix: u8,
}

const fn t(prefix: u8, kind: Kind, suffix: u8) -> Transform {
    Transform { prefix, kind, suffix }
}

pub(crate) const NUM_TRANSFORMS: usize = 121;

/// The longest word between the two longest affixes.
pub(crate) const MAX_TRANSFORMED_LENGTH: usize = 8 + crate::common::dictionary::MAX_DICTIONARY_WORD_LENGTH + 8;

/// `CUT_OFF_TRANSFORMS[n]` is the transform that only omits the last `n` bytes.
pub(crate) static CUT_OFF_TRANSFORMS: [u8; 10] = [0, 12, 27, 23, 42, 63, 56, 48, 59, 64];

#[rustfmt::skip]
static AFFIXES: [&[u8]; 50] = [
    b" ", b", ", b" of the ", b" of ", b"s ",
    b".", b" and ", b" in ", b"\"", b" to ",
    b"\">", b"\n", b". ", b"]", b" for ",
    b" a ", b" that ", b"'", b" with ", b" from ",
    b" by ", b"(", b". The ", b" on ", b" as ",
    b" is ", b"ing ", b"\n\t", b":", b"ed ",
    b"=\"", b" at ", b"ly ", b",", b"='",
    b".com/", b". This ", b" not ", b"er ", b"al ",
    b"ful ", b"ive ", b"less ", b"est ", b"ize ",
    b"\xc2\xa0", b"ous ", b" the ", b"e ", b"",
];

#[rustfmt::skip]
pub(crate) static TRANSFORMS: [Transform; NUM_TRANSFORMS] = [
    t(49, Identity, 49),
    t(49, Identity, 0),
    t(0, Identity, 0),
    t(49, OmitFirst(1), 49),
    t(49, UppercaseFirst, 0),
    t(49, Identity, 47),
    t(0, Identity, 49),
    t(4, Identity, 0),
    t(49, Identity, 3),
    t(49, UppercaseFirst, 49),
    t(49, Identity, 6),
    t(49, OmitFirst(2), 49),
    t(49, OmitLast(1), 49),
    t(1, Identity, 0),
    t(49, Identity, 1),
    t(0, UppercaseFirst, 0),
    t(49, Identity, 7),
    t(49, Identity, 9),
    t(48, Identity, 0),
    t(49, Identity, 8),
    t(49, Identity, 5),
    t(49, Identity, 10),
    t(49, Identity, 11),
    t(49, OmitLast(3), 49),
    t(49, Identity, 13),
    t(49, Identity, 14),
    t(49, OmitFirst(3), 49),
    t(49, OmitLast(2), 49),
    t(49, Identity, 15),
    t(49, Identity, 16),
    t(0, UppercaseFirst, 49),
    t(49, Identity, 12),
    t(5, Identity, 49),
    t(0, Identity, 1),
    t(49, OmitFirst(4), 49),
    t(49, Identity, 18),
    t(49, Identity, 17),
    t(49, Identity, 19),
    t(49, Identity, 20),
    t(49, OmitFirst(5), 49),
    t(49, OmitFirst(6), 49),
    t(47, Identity, 49),
    t(49, OmitLast(4), 49),
    t(49, Identity, 22),
    t(49, UppercaseAll, 49),
    t(49, Identity, 23),
    t(49, Identity, 24),
    t(49, Identity, 25),
    t(49, OmitLast(7), 49),
    t(49, OmitLast(1), 26),
    t(49, Identity, 27),
    t(49, Identity, 28),
    t(0, Identity, 12),
    t(49, Identity, 29),
    t(49, OmitFirst(9), 49),
    t(49, OmitFirst(7), 49),
    t(49, OmitLast(6), 49),
    t(49, Identity, 21),
    t(49, UppercaseFirst, 1),
    t(49, OmitLast(8), 49),
    t(49, Identity, 31),
    t(49, Identity, 32),
    t(47, Identity, 3),
    t(49, OmitLast(5), 49),
    t(49, OmitLast(9), 49),
    t(0, UppercaseFirst, 1),
    t(49, UppercaseFirst, 8),
    t(5, Identity, 21),
    t(49, UppercaseAll, 0),
    t(49, UppercaseFirst, 10),
    t(49, Identity, 30),
    t(0, Identity, 5),
    t(35, Identity, 49),
    t(47, Identity, 2),
    t(49, UppercaseFirst, 17),
    t(49, Identity, 36),
    t(49, Identity, 33),
    t(5, Identity, 0),
    t(49, UppercaseFirst, 21),
    t(49, UppercaseFirst, 5),
    t(49, Identity, 37),
    t(0, Identity, 30),
    t(49, Identity, 38),
    t(0, UppercaseAll, 0),
    t(49, Identity, 39),
    t(0, UppercaseAll, 49),
    t(49, Identity, 34),
    t(49, UppercaseAll, 8),
    t(49, UppercaseFirst, 12),
    t(0, Identity, 21),
    t(49, Identity, 40),
    t(0, UppercaseFirst, 12),
    t(49, Identity, 41),
    t(49, Identity, 42),
    t(49, UppercaseAll, 17),
    t(49, Identity, 43),
    t(0, UppercaseFirst, 5),
    t(49, UppercaseAll, 10),
    t(0, Identity, 34),
    t(49, UppercaseFirst, 33),
    t(49, Identity, 44),
    t(49, UppercaseAll, 5),
    t(45, Identity, 49),
    t(0, Identity, 33),
    t(49, UppercaseFirst, 30),
    t(49, UppercaseAll, 30),
    t(49, Identity, 46),
    t(49, UppercaseAll, 1),
    t(49, UppercaseFirst, 34),
    t(0, UppercaseFirst, 33),
    t(0, UppercaseAll, 30),
    t(0, UppercaseAll, 1),
    t(49, UppercaseAll, 33),
    t(49, UppercaseAll, 21),
    t(49, UppercaseAll, 12),
    t(0, UppercaseAll, 5),
    t(49, UppercaseAll, 34),
    t(0, UppercaseAll, 12),
    t(0, UppercaseFirst, 30),
    t(0, UppercaseAll, 34),
    t(0, UppercaseFirst, 34),
];

/// "An overly simplified uppercasing model for UTF-8". Returns the length of the character at `at`. Its last byte can
/// lie past the end of the word.
fn to_upper_case(dst: &mut [u8], at: usize) -> Checked<usize> {
    let first = dst.at(at)?;
    if first < 0xC0 {
        if first.is_ascii_lowercase() {
            dst.put(at, first ^ 32)?;
        }
        return Ok(1);
    }
    if first < 0xE0 {
        *dst.at_mut(at + 1)? ^= 32;
        return Ok(2);
    }
    *dst.at_mut(at + 2)? ^= 5;
    Ok(3)
}

/// Writes transform `index` of `word` to the start of `dst` and returns its length. `dst` has to have room for
/// [`MAX_TRANSFORMED_LENGTH`] + 2 bytes.
pub(crate) fn transform_dictionary_word(dst: &mut [u8], word: &[u8], index: usize) -> Checked<usize> {
    let transform = TRANSFORMS.at(index)?;
    let prefix = AFFIXES.at(usize::from(transform.prefix))?;
    let suffix = AFFIXES.at(usize::from(transform.suffix))?;
    let word = match transform.kind {
        OmitLast(n) => word.get(..word.len().saturating_sub(usize::from(n))),
        OmitFirst(n) => word.get(usize::from(n).min(word.len())..),
        Identity | UppercaseFirst | UppercaseAll => Some(word),
    }
    .ok_or(Bug)?;

    dst.write_at(0, prefix)?;
    let start = prefix.len();
    dst.write_at(start, word)?;
    let end = start + word.len();
    match transform.kind {
        UppercaseFirst => {
            to_upper_case(dst, start)?;
        }
        UppercaseAll => {
            let mut at = start;
            while at < end {
                at += to_upper_case(dst, at)?;
            }
        }
        Identity | OmitLast(_) | OmitFirst(_) => {}
    }
    dst.write_at(end, suffix)?;
    Ok(end + suffix.len())
}
