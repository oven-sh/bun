//! The properties for bidi and Arabic shaping. ICU4C: ubidi_props.cpp, ubidi_props.h

use crate::common::udata::compiled_in;
use crate::common::unicode::uchar::{UCharDirection, UJoiningType};
use crate::common::utrie2::{UTrie2, UTrie2ValueBits::Bits16};

const UBIDI_IX_TOP: usize = 16;

const UBIDI_JT_SHIFT: u32 = 5;
const UBIDI_BIDI_CONTROL_SHIFT: u32 = 11;

const UBIDI_CLASS_MASK: u16 = 0x001f;
const UBIDI_JT_MASK: u16 = 0x00e0;

const UBIDI: &[u8] = compiled_in!("ubidi.icu", b"BiDi", 2).1;
const TRIE: UTrie2 =
    UTrie2::open_from_serialized(Bits16, UBIDI.split_at(UBIDI_IX_TOP * 4).1).unwrap();

pub(crate) fn ubidi_get_class(c: u32) -> UCharDirection {
    (TRIE.get16(c) & UBIDI_CLASS_MASK).into()
}

pub(crate) fn ubidi_is_bidi_control(c: u32) -> bool {
    (TRIE.get16(c) >> UBIDI_BIDI_CONTROL_SHIFT) & 1 != 0
}

pub(crate) fn ubidi_get_joining_type(c: u32) -> UJoiningType {
    ((TRIE.get16(c) & UBIDI_JT_MASK) >> UBIDI_JT_SHIFT).into()
}
