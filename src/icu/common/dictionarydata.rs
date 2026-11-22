//! Break dictionaries, the `.dict` items: `int32_t` indexes followed by a trie of the words. ICU4C: dictionarydata.cpp

use crate::common::bytes::{I32s, U16s};
use crate::common::bytestrie::BytesTrie;
use crate::common::slice_ext::to_index;
use crate::common::ucharstrie::UCharsTrie;
use crate::common::ustringtrie::UStringTrieResult;
use crate::common::utf16;

const IX_STRING_TRIE_OFFSET: usize = 0;
const IX_TRIE_TYPE: usize = 4;
const IX_TRANSFORM: usize = 5;

const TRIE_TYPE_BYTES: i32 = 0;
const TRIE_TYPE_UCHARS: i32 = 1;
const TRIE_TYPE_MASK: i32 = 7;

const TRANSFORM_TYPE_OFFSET: i32 = 0x100_0000;
const TRANSFORM_TYPE_MASK: i32 = 0x7f00_0000;
const TRANSFORM_OFFSET_MASK: i32 = 0x1f_ffff;
const MAX_DELTA: i32 = 0xFD;

/// A final value at the root, as bytes and as units.
const EMPTY_TRIE: &[u8] = &[0xFF, 0xFF];

#[derive(Clone, Copy)]
pub(crate) enum DictionaryMatcher {
    UChars(UCharsTrie<'static>),
    Bytes {
        trie: BytesTrie<'static>,
        transform_constant: i32,
        /// `transform` subtracts this from all code points in `offset..=offset + MAX_DELTA`.
        offset: i32,
    },
}

/// Transforms the code point `delta + offset`. One outside the range gets the byte of U+200D.
#[cold]
#[inline(never)]
fn transform(delta: i32, offset: i32, transform_constant: i32) -> i32 {
    let c = delta + offset;
    if transform_constant & TRANSFORM_TYPE_MASK != TRANSFORM_TYPE_OFFSET {
        return c;
    }
    match (c, c - (transform_constant & TRANSFORM_OFFSET_MASK)) {
        (0x200D, _) => 0xFF,
        (0x200C, _) => 0xFE,
        (_, delta @ 0..=MAX_DELTA) => delta,
        _ => 0xFF,
    }
}

impl DictionaryMatcher {
    /// `data` can have another format than that of a dictionary.
    pub(crate) fn new(data: &'static [u8]) -> Option<Self> {
        let indexes = I32s::of(data);
        let offset = to_index(indexes.get(IX_STRING_TRIE_OFFSET)?);
        let trie = data.get(offset..).unwrap_or(EMPTY_TRIE);
        match indexes.get(IX_TRIE_TYPE)? & TRIE_TYPE_MASK {
            TRIE_TYPE_BYTES => {
                let transform_constant = indexes.get(IX_TRANSFORM).unwrap_or(0);
                let offset = transform_constant & TRANSFORM_OFFSET_MASK;
                let only_subtracts = transform_constant & TRANSFORM_TYPE_MASK
                    == TRANSFORM_TYPE_OFFSET
                    && !(0x200C - MAX_DELTA..=0x200D).contains(&offset);
                Some(Self::Bytes {
                    trie: BytesTrie::new(trie),
                    transform_constant,
                    offset: if only_subtracts { offset } else { i32::MAX },
                })
            }
            TRIE_TYPE_UCHARS => Some(Self::UChars(UCharsTrie::new(U16s::of(trie)))),
            _ => None,
        }
    }

    fn next(&mut self, c: u32) -> UStringTrieResult {
        match self {
            // A supplementary code point never matches.
            Self::UChars(trie) => trie.next(c as i32),
            Self::Bytes {
                trie,
                transform_constant,
                offset,
            } => trie.next(match c as i32 - *offset {
                delta @ 0..=MAX_DELTA => delta,
                delta => transform(delta, *offset, *transform_constant),
            }),
        }
    }

    fn value(&self) -> i32 {
        match self {
            Self::UChars(trie) => trie.get_value(),
            Self::Bytes { trie, .. } => trie.get_value(),
        }
    }

    /// Calls `found(units, code points, value)` for each word that starts `text`, shortest first. Returns the code points read.
    pub(crate) fn matches(
        mut self,
        text: &[u16],
        max_length: usize,
        mut found: impl FnMut(usize, usize, i32),
    ) -> usize {
        let (mut length, mut matched) = (0, 0);
        while let Some(&unit) = text.get(length) {
            let result = self.next(if utf16::is_lead(unit.into()) {
                utf16::next(text, &mut length)
            } else {
                length += 1;
                unit.into()
            });
            matched += 1;
            if result.has_value() {
                found(length, matched, self.value());
            }
            // A surrogate pair can cross the limit.
            if !result.has_next() || length >= max_length {
                break;
            }
        }
        matched
    }
}
