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

#[derive(Clone, Copy)]
pub(crate) enum DictionaryMatcher {
    UChars(UCharsTrie<'static>),
    /// The trie holds each code point minus `offset`.
    Bytes {
        trie: BytesTrie<'static>,
        offset: i32,
    },
}

impl DictionaryMatcher {
    // ICU4C: brkeng.cpp, ICULanguageBreakFactory::loadDictionaryMatcherFor
    pub(crate) fn new(data: &'static [u8]) -> Option<Self> {
        let indexes = I32s::of(data);
        let trie = data.get(to_index(indexes.get(IX_STRING_TRIE_OFFSET)?)..)?;
        let transform = indexes.get(IX_TRANSFORM)?;
        match indexes.get(IX_TRIE_TYPE)? & TRIE_TYPE_MASK {
            TRIE_TYPE_BYTES if transform & TRANSFORM_TYPE_MASK == TRANSFORM_TYPE_OFFSET => {
                Some(Self::Bytes {
                    trie: BytesTrie::new(trie),
                    offset: transform & TRANSFORM_OFFSET_MASK,
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
            // 0xFE and 0xFF stand for U+200C and U+200D. A code point outside the range matches U+200D.
            Self::Bytes { trie, offset } => trie.next(match c as i32 - *offset {
                delta @ 0..=0xFD => delta,
                _ => 0xFF,
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
        mut found: impl FnMut(usize, usize, i32),
    ) -> usize {
        let (mut length, mut matched) = (0, 0);
        while length < text.len() {
            let result = self.next(utf16::next(text, &mut length));
            matched += 1;
            if result.has_value() {
                found(length, matched, self.value());
            }
            if !result.has_next() {
                break;
            }
        }
        matched
    }
}
