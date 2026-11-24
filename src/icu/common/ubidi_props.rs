//! The properties for bidi and Arabic shaping. ICU4C: ubidi_props.cpp, ubidi_props.h

use crate::common::bytes::U32s;
use crate::common::slice_ext::SoftUnwrap;
use crate::common::udata::{compiled_in, compiled_in_index};
use crate::common::unicode::uchar::{UCharDirection, UJoiningType};
use crate::common::uniset::UnicodeSet;
use crate::common::utrie2::{UTrie2, UTrie2ValueBits::Bits16};

const UBIDI_IX_TRIE_SIZE: usize = 2;
const UBIDI_IX_MIRROR_LENGTH: usize = 3;
const UBIDI_IX_JG_START: usize = 4;
const UBIDI_IX_JG_LIMIT: usize = 5;
const UBIDI_IX_JG_START2: usize = 6;
const UBIDI_IX_JG_LIMIT2: usize = 7;
const UBIDI_IX_TOP: usize = 16;

const UBIDI_JT_SHIFT: u32 = 5;
const UBIDI_BPT_SHIFT: u32 = 8;
const UBIDI_JOIN_CONTROL_SHIFT: u32 = 10;
const UBIDI_BIDI_CONTROL_SHIFT: u32 = 11;
const UBIDI_IS_MIRRORED_SHIFT: u32 = 12;
const UBIDI_MIRROR_DELTA_SHIFT: u32 = 13;

const UBIDI_CLASS_MASK: u16 = 0x001f;
const UBIDI_JT_MASK: u16 = 0x00e0;
const UBIDI_BPT_MASK: u16 = 0x0300;

const UBIDI_ESC_MIRROR_DELTA: i32 = -4;
const UBIDI_MIRROR_INDEX_SHIFT: u32 = 21;

// Layout: indexes[16], the trie, mirrors[], jgArray[], jgArray2[]
const UBIDI: &[u8] = compiled_in!("ubidi.icu", b"BiDi", 2).1;

macro_rules! index {
    ($index:ident) => {
        compiled_in_index!(UBIDI, $index)
    };
}

const TRIE: UTrie2 =
    UTrie2::open_from_serialized(Bits16, UBIDI.split_at(UBIDI_IX_TOP * 4).1).unwrap();
const MIRRORS_OFFSET: usize = UBIDI_IX_TOP * 4 + index!(UBIDI_IX_TRIE_SIZE);
const MIRRORS: U32s =
    U32s::try_from_offset(UBIDI, MIRRORS_OFFSET, index!(UBIDI_IX_MIRROR_LENGTH)).unwrap();
/// Two ranges, each with its first code point and the Joining_Group values from there on.
const JG_ARRAYS: [(u32, &[u8]); 2] = {
    let (start, start2) = (index!(UBIDI_IX_JG_START), index!(UBIDI_IX_JG_START2));
    let arrays = UBIDI.split_at(MIRRORS_OFFSET + MIRRORS.len() * 4).1;
    let (jg_array, rest) = arrays.split_at(index!(UBIDI_IX_JG_LIMIT) - start);
    let jg_array2 = rest.split_at(index!(UBIDI_IX_JG_LIMIT2) - start2).0;
    [(start as u32, jg_array), (start2 as u32, jg_array2)]
};

pub(crate) fn ubidi_add_property_starts(sa: &mut UnicodeSet) {
    TRIE.add_range_starts(sa);
    for (start, jg_array) in JG_ARRAYS {
        sa.add_range(start, start + jg_array.len() as u32);
    }
}

pub(crate) fn ubidi_get_class(c: u32) -> UCharDirection {
    (TRIE.get16(c) & UBIDI_CLASS_MASK).into()
}

/// `ubidi_get_class` for a unit that is not a lead surrogate.
#[inline]
pub(crate) fn ubidi_get_class_from_single_unit(unit: u16) -> UCharDirection {
    (TRIE.get16_from_u16_single_lead(unit) & UBIDI_CLASS_MASK).into()
}

pub(crate) fn ubidi_is_mirrored(c: u32) -> bool {
    (TRIE.get16(c) >> UBIDI_IS_MIRRORED_SHIFT) & 1 != 0
}

pub(crate) fn ubidi_is_bidi_control(c: u32) -> bool {
    (TRIE.get16(c) >> UBIDI_BIDI_CONTROL_SHIFT) & 1 != 0
}

pub(crate) fn ubidi_is_join_control(c: u32) -> bool {
    (TRIE.get16(c) >> UBIDI_JOIN_CONTROL_SHIFT) & 1 != 0
}

pub(crate) fn ubidi_get_joining_type(c: u32) -> UJoiningType {
    ((TRIE.get16(c) & UBIDI_JT_MASK) >> UBIDI_JT_SHIFT).into()
}

pub(crate) fn ubidi_get_joining_group(c: u32) -> i32 {
    JG_ARRAYS
        .iter()
        .find_map(|(start, jg_array)| jg_array.get(c.wrapping_sub(*start) as usize))
        .map_or(0, |&group| group.into())
}

pub(crate) fn ubidi_get_paired_bracket_type(c: u32) -> i32 {
    ((TRIE.get16(c) & UBIDI_BPT_MASK) >> UBIDI_BPT_SHIFT).into()
}

fn get_mirror_code_point(m: u32) -> u32 {
    m & 0x1f_ffff
}

fn get_mirror(c: u32, props: u16) -> u32 {
    let delta = i32::from(props as i16) >> UBIDI_MIRROR_DELTA_SHIFT;
    if delta != UBIDI_ESC_MIRROR_DELTA {
        return c.wrapping_add_signed(delta);
    }
    let m = MIRRORS
        .iter()
        .find(|&m| get_mirror_code_point(m) == c)
        .soft_unwrap();
    get_mirror_code_point(MIRRORS.at((m >> UBIDI_MIRROR_INDEX_SHIFT) as usize))
}

pub(crate) fn ubidi_get_paired_bracket(c: u32) -> u32 {
    let props = TRIE.get16(c);
    if props & UBIDI_BPT_MASK == 0 {
        c
    } else {
        get_mirror(c, props)
    }
}
