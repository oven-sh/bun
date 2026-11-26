//! The core character properties. A negative `UChar32` arrives as a value above U+10FFFF. ICU4C: uchar.cpp, uprops.h

use crate::common::bytes::{U16s, U32s};
use crate::common::slice_ext::SoftUnwrap;
use crate::common::ucptrie::UCPTrie;
use crate::common::udata::{compiled_in, compiled_in_index};
use crate::common::unicode::uchar::*;
use crate::common::unicode::uscript::{USCRIPT_COMMON, USCRIPT_INHERITED, UScriptCode};
use crate::common::uniset::{MAX_VALUE, UnicodeSet};
use crate::common::utrie2::{UTrie2, UTrie2ValueBits::Bits16};

const UPROPS_ADDITIONAL_TRIE_INDEX: usize = 3;
const UPROPS_ADDITIONAL_VECTORS_INDEX: usize = 4;
const UPROPS_SCRIPT_EXTENSIONS_INDEX: usize = 6;
const UPROPS_BLOCK_TRIE_INDEX: usize = 7;
const UPROPS_RESERVED_INDEX_8: usize = 8;
const UPROPS_INDEX_COUNT: usize = 16;

const UPROPS_NUMERIC_TYPE_VALUE_SHIFT: u32 = 6;
const UPROPS_NTV_NONE: u32 = 0;
const UPROPS_NTV_DECIMAL_START: u32 = 1;
const UPROPS_NTV_DIGIT_START: u32 = 11;
const UPROPS_NTV_NUMERIC_START: u32 = 21;
const UPROPS_NTV_FRACTION_START: u32 = 0xb0;
const UPROPS_NTV_LARGE_START: u32 = 0x1e0;
const UPROPS_NTV_BASE60_START: u32 = 0x300;
const UPROPS_NTV_FRACTION20_START: u32 = UPROPS_NTV_BASE60_START + 36;
const UPROPS_NTV_FRACTION32_START: u32 = UPROPS_NTV_FRACTION20_START + 24;
const UPROPS_NTV_RESERVED_START: u32 = UPROPS_NTV_FRACTION32_START + 16;

// Vector word 0
const UPROPS_AGE_SHIFT: u32 = 24;
const UPROPS_EA_SHIFT: u32 = 12;
const UPROPS_EA_MASK: u32 = 7 << UPROPS_EA_SHIFT;
const UPROPS_SCRIPT_X_MASK: u32 = 0x0000_0fff;
const UPROPS_SCRIPT_X_WITH_OTHER: u32 = 0xc00;
const UPROPS_SCRIPT_X_WITH_INHERITED: u32 = 0x800;
const UPROPS_SCRIPT_X_WITH_COMMON: u32 = 0x400;
const UPROPS_MAX_SCRIPT: u32 = 0x3ff;

// Vector word 1
const UPROPS_WHITE_SPACE: u32 = 0;
const UPROPS_ALPHABETIC: u32 = 8;
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
/// Indexed by `c >> 4`, because block boundaries are multiples of 16.
const BLOCK_TRIE: UCPTrie =
    UCPTrie::open(section!(UPROPS_BLOCK_TRIE_INDEX, UPROPS_RESERVED_INDEX_8)).unwrap();

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

#[inline(always)]
fn numeric_type_value(c: u32) -> u32 {
    get_props(c) >> UPROPS_NUMERIC_TYPE_VALUE_SHIFT
}

#[inline]
pub(crate) fn vector_word(c: u32, column: usize) -> u32 {
    PROPS_VECTORS.at(usize::from(get16(&PROPS_VECTORS_TRIE, c)) + column)
}

/// Tests a bit of vector word 1.
#[inline]
pub(crate) fn has_flag(c: u32, bit: u32) -> bool {
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

fn u_isdigit(c: u32) -> bool {
    u_char_type(c) == U_DECIMAL_DIGIT_NUMBER
}

pub(crate) fn u_isxdigit(c: u32) -> bool {
    matches!(c, 0x41..=0x46 | 0x61..=0x66 | 0xff21..=0xff26 | 0xff41..=0xff46) || u_isdigit(c)
}

pub(crate) fn u_isalnum_posix(c: u32) -> bool {
    has_flag(c, UPROPS_ALPHABETIC) || u_isdigit(c)
}

pub(crate) fn u_is_whitespace(c: u32) -> bool {
    match c {
        ..=0xa0 => matches!(c, 9..=0xd | 0x1c..=0x20),
        0x2007 | 0x202f => false,
        _ => u_is_java_space_char(c),
    }
}

pub(crate) fn u_isblank(c: u32) -> bool {
    c == 9 || u_char_type(c) == U_SPACE_SEPARATOR
}

pub(crate) fn u_isprint_posix(c: u32) -> bool {
    u_char_type(c) == U_SPACE_SEPARATOR || u_isgraph_posix(c)
}

pub(crate) fn u_isgraph_posix(c: u32) -> bool {
    u_get_gc_mask(c) & (U_GC_CC_MASK | U_GC_CS_MASK | U_GC_CN_MASK | U_GC_Z_MASK) == 0
}

pub(crate) fn u_is_java_space_char(c: u32) -> bool {
    u_get_gc_mask(c) & U_GC_Z_MASK != 0
}

/// Returns -1 unless `c` is a decimal digit.
pub(crate) fn u_char_digit_value(c: u32) -> i32 {
    let value = numeric_type_value(c) as i32 - UPROPS_NTV_DECIMAL_START as i32;
    if value <= 9 { value } else { -1 }
}

pub(crate) fn numeric_type(c: u32) -> UNumericType {
    match numeric_type_value(c) {
        UPROPS_NTV_NONE => U_NT_NONE,
        UPROPS_NTV_DECIMAL_START..UPROPS_NTV_DIGIT_START => U_NT_DECIMAL,
        UPROPS_NTV_DIGIT_START..UPROPS_NTV_NUMERIC_START => U_NT_DIGIT,
        UPROPS_NTV_NUMERIC_START.. => U_NT_NUMERIC,
    }
}

pub(crate) fn u_get_numeric_value(c: u32) -> f64 {
    const U_NO_NUMERIC_VALUE: f64 = -123456789.;
    let fraction = |numerator: i32, denominator: u32| f64::from(numerator) / f64::from(denominator);
    match numeric_type_value(c) {
        UPROPS_NTV_NONE | UPROPS_NTV_RESERVED_START.. => U_NO_NUMERIC_VALUE,
        ntv @ UPROPS_NTV_DECIMAL_START..UPROPS_NTV_DIGIT_START => {
            f64::from(ntv - UPROPS_NTV_DECIMAL_START)
        }
        ntv @ UPROPS_NTV_DIGIT_START..UPROPS_NTV_NUMERIC_START => {
            f64::from(ntv - UPROPS_NTV_DIGIT_START)
        }
        ntv @ UPROPS_NTV_NUMERIC_START..UPROPS_NTV_FRACTION_START => {
            f64::from(ntv - UPROPS_NTV_NUMERIC_START)
        }
        ntv @ UPROPS_NTV_FRACTION_START..UPROPS_NTV_LARGE_START => {
            fraction((ntv >> 4) as i32 - 12, (ntv & 0xf) + 1)
        }
        ntv @ UPROPS_NTV_LARGE_START..UPROPS_NTV_BASE60_START => {
            // Above 10^22, rounding depends on the factors and their order.
            let exponent = (ntv & 0x1f) + 2;
            let value =
                (0..exponent / 4).fold(f64::from((ntv >> 5) - 14), |value, _| value * 10000.);
            value * f64::from(10u32.pow(exponent % 4))
        }
        ntv @ UPROPS_NTV_BASE60_START..UPROPS_NTV_FRACTION20_START => {
            f64::from(((ntv >> 2) - 0xbf) * 60u32.pow((ntv & 3) + 1))
        }
        ntv @ UPROPS_NTV_FRACTION20_START..UPROPS_NTV_FRACTION32_START => {
            let frac20 = ntv - UPROPS_NTV_FRACTION20_START;
            fraction(2 * (frac20 & 3) as i32 + 1, 20 << (frac20 >> 2))
        }
        ntv @ UPROPS_NTV_FRACTION32_START..UPROPS_NTV_RESERVED_START => {
            let frac32 = ntv - UPROPS_NTV_FRACTION32_START;
            fraction(2 * (frac32 & 3) as i32 + 1, 32 << (frac32 >> 2))
        }
    }
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

pub(crate) fn uscript_has_script(c: u32, script: UScriptCode) -> bool {
    /// Marks the last script of an ascending list.
    const LAST_SCRIPT: u16 = 0x8000;
    let script_x = vector_word(c, 0) & UPROPS_SCRIPT_X_MASK;
    let code_or_index = script_x & UPROPS_MAX_SCRIPT;
    let list = match script_x {
        ..UPROPS_SCRIPT_X_WITH_COMMON => return code_or_index as UScriptCode == script,
        UPROPS_SCRIPT_X_WITH_OTHER.. => SCRIPT_EXTENSIONS.at(code_or_index as usize + 1).into(),
        _ => code_or_index as usize,
    };
    let mut scripts = SCRIPT_EXTENSIONS.slice(list..).iter();
    let candidate = scripts.find(|&it| UScriptCode::from(it) >= script);
    UScriptCode::from(candidate.soft_unwrap() & !LAST_SCRIPT) == script
}

pub(crate) fn u_char_age(c: u32) -> [u8; 4] {
    let version = vector_word(c, 0) >> UPROPS_AGE_SHIFT;
    [(version >> 2) as u8, (version & 3) as u8, 0, 0]
}

pub(crate) fn ublock_get_code(c: u32) -> i32 {
    BLOCK_TRIE.get(c >> 4) as i32
}

pub(crate) fn uchar_add_property_starts(sa: &mut UnicodeSet) {
    PROPS_TRIE.add_range_starts(sa);
    // Where `u_isblank` and `u_isxdigit` change within a range.
    for c in ['\t', '\n', 'G', 'g', 'Ｇ', 'ｇ'] {
        sa.add(c.into());
    }
}

pub(crate) fn upropsvec_add_property_starts(sa: &mut UnicodeSet) {
    PROPS_VECTORS_TRIE.add_range_starts(sa);
}

pub(crate) fn ublock_add_property_starts(sa: &mut UnicodeSet) {
    BLOCK_TRIE
        .range_starts()
        .for_each(|start| sa.add(MAX_VALUE.min(start << 4)));
}
