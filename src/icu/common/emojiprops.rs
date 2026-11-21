//! The emoji properties of code points, from `uemoji.icu`. ICU4C: emojiprops.cpp

use crate::common::bytes::I32s;
use crate::common::slice_ext::{SoftUnwrap as _, to_index};
use crate::common::ucptrie::FastTrie8;
use crate::common::udata::{self, UDataInfo};
use crate::common::umutex::OnceBox;
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, UErrorCode};

const IX_CPTRIE_OFFSET: usize = 0;

const BIT_EMOJI_PRESENTATION: u32 = 1;
const BIT_EMOJI_MODIFIER: u32 = 2;

fn load() -> Result<FastTrie8<'static>, UErrorCode> {
    let is_acceptable =
        |info: &UDataInfo| &info.data_format == b"Emoj" && info.format_version[0] == 1;
    let bytes = udata::open_choice(None, b"icu", b"uemoji", is_acceptable)?.memory;
    let offset = I32s::of(bytes).at(IX_CPTRIE_OFFSET);
    let trie = bytes.get(to_index(offset)..).and_then(FastTrie8::open);
    trie.ok_or(U_INVALID_FORMAT_ERROR)
}

#[inline]
fn has_bit(c: u32, bit: u32) -> bool {
    static TRIE: OnceBox<Result<FastTrie8<'static>, UErrorCode>> = OnceBox::new();
    let trie = TRIE.get_or_init_caching_err(load).ok().soft_some();
    trie.is_some_and(|trie| (trie.get(c) >> bit) & 1 != 0)
}

pub(crate) fn is_emoji_presentation(c: u32) -> bool {
    has_bit(c, BIT_EMOJI_PRESENTATION)
}

pub(crate) fn is_emoji_modifier(c: u32) -> bool {
    has_bit(c, BIT_EMOJI_MODIFIER)
}
