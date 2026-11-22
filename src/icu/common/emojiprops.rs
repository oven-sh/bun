//! The emoji properties of code points, from `uemoji.icu`. ICU4C: emojiprops.cpp

use crate::common::bytes::I32s;
use crate::common::slice_ext::to_index;
use crate::common::ucptrie::{FastTrie8, UCPTrie};
use crate::common::udata::{self, UDataInfo};
use crate::common::umutex::OnceBox;
use crate::common::unicode::uchar::*;
use crate::common::uniset::UnicodeSet;
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, UErrorCode};

const IX_CPTRIE_OFFSET: usize = 0;

const BIT_EMOJI: u32 = 0;
const BIT_EMOJI_PRESENTATION: u32 = 1;
const BIT_EMOJI_MODIFIER: u32 = 2;
const BIT_EMOJI_MODIFIER_BASE: u32 = 3;
const BIT_EMOJI_COMPONENT: u32 = 4;
const BIT_EXTENDED_PICTOGRAPHIC: u32 = 5;
const BIT_BASIC_EMOJI: u32 = 6;

fn open_trie<T>(open: fn(&'static [u8]) -> Option<T>) -> Result<T, UErrorCode> {
    let is_acceptable =
        |info: &UDataInfo| &info.data_format == b"Emoj" && info.format_version[0] == 1;
    let bytes = udata::open_choice(None, b"icu", b"uemoji", is_acceptable)?.memory;
    let offset = I32s::of(bytes).at(IX_CPTRIE_OFFSET);
    let trie = bytes.get(to_index(offset)..).and_then(open);
    trie.ok_or(U_INVALID_FORMAT_ERROR)
}

#[inline]
fn trie() -> Result<&'static FastTrie8<'static>, UErrorCode> {
    static TRIE: OnceBox<Result<FastTrie8<'static>, UErrorCode>> = OnceBox::new();
    TRIE.get_or_init_caching_err(|| open_trie(FastTrie8::open))
}

#[inline]
fn has_bit(c: u32, bit: u32) -> bool {
    trie().is_ok_and(|trie| (trie.get(c) >> bit) & 1 != 0)
}

pub(crate) fn is_emoji_presentation(c: u32) -> bool {
    has_bit(c, BIT_EMOJI_PRESENTATION)
}

pub(crate) fn is_emoji_modifier(c: u32) -> bool {
    has_bit(c, BIT_EMOJI_MODIFIER)
}

/// Of the properties of strings, only Basic_Emoji and the union RGI_Emoji have single code points.
pub(crate) fn has_binary_property(c: u32, which: UProperty) -> bool {
    let bit = match which {
        UCHAR_EMOJI => BIT_EMOJI,
        UCHAR_EMOJI_PRESENTATION => BIT_EMOJI_PRESENTATION,
        UCHAR_EMOJI_MODIFIER => BIT_EMOJI_MODIFIER,
        UCHAR_EMOJI_MODIFIER_BASE => BIT_EMOJI_MODIFIER_BASE,
        UCHAR_EMOJI_COMPONENT => BIT_EMOJI_COMPONENT,
        UCHAR_EXTENDED_PICTOGRAPHIC => BIT_EXTENDED_PICTOGRAPHIC,
        UCHAR_BASIC_EMOJI | UCHAR_RGI_EMOJI => BIT_BASIC_EMOJI,
        _ => return false,
    };
    has_bit(c, bit)
}

pub(crate) fn add_property_starts(sa: &mut UnicodeSet) -> Result<(), UErrorCode> {
    trie()?;
    let trie = open_trie(UCPTrie::open)?;
    trie.range_starts().for_each(|start| sa.add(start));
    Ok(())
}
