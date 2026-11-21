//! The core character properties. A negative `UChar32` arrives as a value above U+10FFFF. ICU4C: uchar.cpp, uprops.h

use crate::common::bytes::{U16s, U32s};
use crate::common::udata::{compiled_in, compiled_in_index};
use crate::common::unicode::uchar::*;
use crate::common::unicode::uscript::{USCRIPT_COMMON, USCRIPT_INHERITED, UScriptCode};
use crate::common::utrie2::{UTrie2, UTrie2ValueBits::Bits16};

const UPROPS_ADDITIONAL_TRIE_INDEX: usize = 3;
const UPROPS_ADDITIONAL_VECTORS_INDEX: usize = 4;
const UPROPS_SCRIPT_EXTENSIONS_INDEX: usize = 6;
const UPROPS_BLOCK_TRIE_INDEX: usize = 7;
const UPROPS_INDEX_COUNT: usize = 16;

const UPROPS_NUMERIC_TYPE_VALUE_SHIFT: u32 = 6;
const UPROPS_NTV_DECIMAL_START: i32 = 1;

// Vector word 0
const UPROPS_EA_SHIFT: u32 = 12;
const UPROPS_EA_MASK: u32 = 7 << UPROPS_EA_SHIFT;
const UPROPS_SCRIPT_X_MASK: u32 = 0x0000_0fff;
const UPROPS_SCRIPT_X_WITH_OTHER: u32 = 0xc00;
const UPROPS_SCRIPT_X_WITH_INHERITED: u32 = 0x800;
const UPROPS_SCRIPT_X_WITH_COMMON: u32 = 0x400;
const UPROPS_MAX_SCRIPT: u32 = 0x3ff;

// Vector word 1
const UPROPS_WHITE_SPACE: u32 = 0;
const UPROPS_ID_START: u32 = 24;
const UPROPS_ID_CONTINUE: u32 = 25;
const UPROPS_VARIATION_SELECTOR: u32 = 28;

// Vector word 2
const UPROPS_LB_SHIFT: u32 = 20;
const UPROPS_LB_MASK: u32 = 0x3f << UPROPS_LB_SHIFT;

/// 16 indexes (offsets in 32-bit units), the main trie, and the indexed sections.
const UPROPS: &[u8] = compiled_in!("uprops.icu", b"UPro", 9).1;

macro_rules! section {
    ($start:ident, $limit:ident) => {
        UPROPS
            .split_at(compiled_in_index!(UPROPS, $limit) * 4)
            .0
            .split_at(compiled_in_index!(UPROPS, $start) * 4)
            .1
    };
}

const PROPS_TRIE: UTrie2 =
    UTrie2::open_from_serialized(Bits16, UPROPS.split_at(UPROPS_INDEX_COUNT * 4).1).unwrap();
const PROPS_VECTORS_TRIE: UTrie2 = UTrie2::open_from_serialized(
    Bits16,
    section!(
        UPROPS_ADDITIONAL_TRIE_INDEX,
        UPROPS_ADDITIONAL_VECTORS_INDEX
    ),
)
.unwrap();
const PROPS_VECTORS: U32s = U32s::of(section!(
    UPROPS_ADDITIONAL_VECTORS_INDEX,
    UPROPS_SCRIPT_EXTENSIONS_INDEX
));
const SCRIPT_EXTENSIONS: U16s = U16s::of(section!(
    UPROPS_SCRIPT_EXTENSIONS_INDEX,
    UPROPS_BLOCK_TRIE_INDEX
));

/// The common case gets its own code, without the jumps that join the other cases.
#[inline(always)]
fn get16(trie: &UTrie2, c: u32) -> u16 {
    if c < 0xd800 {
        trie.get16_from_u16_single_lead(c as u16)
    } else {
        trie.get16(c)
    }
}

#[inline(always)]
fn get_props(c: u32) -> u32 {
    get16(&PROPS_TRIE, c).into()
}

#[inline]
fn vector_word(c: u32, column: usize) -> u32 {
    PROPS_VECTORS.at(usize::from(get16(&PROPS_VECTORS_TRIE, c)) + column)
}

#[inline]
fn has_flag(c: u32, bit: u32) -> bool {
    vector_word(c, 1) & (1 << bit) != 0
}

#[inline]
pub(crate) fn u_char_type(c: u32) -> UCharCategory {
    (get_props(c) & 0x1f) as UCharCategory
}

#[inline(always)]
pub(crate) fn u_get_gc_mask(c: u32) -> i32 {
    1 << u_char_type(c)
}

pub(crate) fn u_islower(c: u32) -> bool {
    u_char_type(c) == U_LOWERCASE_LETTER
}

pub(crate) fn u_is_java_space_char(c: u32) -> bool {
    u_get_gc_mask(c) & U_GC_Z_MASK != 0
}

/// Returns -1 unless `c` is a decimal digit.
pub(crate) fn u_char_digit_value(c: u32) -> i32 {
    let value = (get_props(c) >> UPROPS_NUMERIC_TYPE_VALUE_SHIFT) as i32 - UPROPS_NTV_DECIMAL_START;
    if value <= 9 { value } else { -1 }
}

pub(crate) fn u_is_u_white_space(c: u32) -> bool {
    has_flag(c, UPROPS_WHITE_SPACE)
}

pub(crate) fn is_id_start(c: u32) -> bool {
    has_flag(c, UPROPS_ID_START)
}

pub(crate) fn is_id_continue(c: u32) -> bool {
    has_flag(c, UPROPS_ID_CONTINUE)
}

pub(crate) fn is_variation_selector(c: u32) -> bool {
    has_flag(c, UPROPS_VARIATION_SELECTOR)
}

pub(crate) fn east_asian_width(c: u32) -> i32 {
    ((vector_word(c, 0) & UPROPS_EA_MASK) >> UPROPS_EA_SHIFT) as i32
}

pub(crate) fn line_break(c: u32) -> ULineBreak {
    ((vector_word(c, 2) & UPROPS_LB_MASK) >> UPROPS_LB_SHIFT) as ULineBreak
}

pub(crate) fn uscript_get_script(c: u32) -> UScriptCode {
    let script_x = vector_word(c, 0) & UPROPS_SCRIPT_X_MASK;
    let code_or_index = script_x & UPROPS_MAX_SCRIPT;
    match script_x - code_or_index {
        UPROPS_SCRIPT_X_WITH_COMMON => USCRIPT_COMMON,
        UPROPS_SCRIPT_X_WITH_INHERITED => USCRIPT_INHERITED,
        UPROPS_SCRIPT_X_WITH_OTHER => SCRIPT_EXTENSIONS.at(code_or_index as usize).into(),
        _ => code_or_index as UScriptCode,
    }
}
