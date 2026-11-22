//! Collation elements: a CE is a `u64`, a CE32 its compact form or a tagged value. ICU4C: collation.h

/// The weight of U+FFFE.
pub(crate) const MERGE_SEPARATOR_BYTE: u8 = 2;
pub(crate) const MERGE_SEPARATOR_PRIMARY: u32 = 0x0200_0000;

const COMMON_SECONDARY_CE: u32 = 0x0500_0000;
const COMMON_TERTIARY_CE: u32 = 0x0500;
const COMMON_SEC_AND_TER_CE: u32 = 0x0500_0500;

const CASE_MASK: u32 = 0xc000;
pub(crate) const ONLY_TERTIARY_MASK: u32 = 0x3f3f;
pub(crate) const CASE_AND_TERTIARY_MASK: u32 = CASE_MASK | ONLY_TERTIARY_MASK;

const UNASSIGNED_IMPLICIT_BYTE: u8 = 0xfe;
pub(crate) const TRAIL_WEIGHT_BYTE: u8 = 0xff;

/// The lowest low byte of a special CE32. The low four bits of a special CE32 are its tag.
pub(crate) const SPECIAL_CE32_LOW_BYTE: u8 = 0xc0;
pub(crate) const FALLBACK_CE32: u32 = SPECIAL_CE32_LOW_BYTE as u32;
pub(crate) const LONG_PRIMARY_CE32_LOW_BYTE: u8 = SPECIAL_CE32_LOW_BYTE | LONG_PRIMARY_TAG as u8;
pub(crate) const UNASSIGNED_CE32: u32 = 0xffff_ffff;

/// No mapping has this value.
pub(crate) const NO_CE32: u32 = 1;
pub(crate) const NO_CE_PRIMARY: u32 = 1;
pub(crate) const NO_CE_WEIGHT16: u32 = 0x0100;
/// The CE that marks the end of the text.
pub(crate) const NO_CE: u64 = 0x1_0100_0100;

pub(crate) const LONG_PRIMARY_TAG: u32 = 1;
pub(crate) const LONG_SECONDARY_TAG: u32 = 2;
pub(crate) const LATIN_EXPANSION_TAG: u32 = 4;
pub(crate) const EXPANSION32_TAG: u32 = 5;
pub(crate) const EXPANSION_TAG: u32 = 6;
pub(crate) const PREFIX_TAG: u32 = 8;
pub(crate) const CONTRACTION_TAG: u32 = 9;
pub(crate) const DIGIT_TAG: u32 = 10;
pub(crate) const U0000_TAG: u32 = 11;
pub(crate) const HANGUL_TAG: u32 = 12;
pub(crate) const LEAD_SURROGATE_TAG: u32 = 13;
pub(crate) const OFFSET_TAG: u32 = 14;
pub(crate) const IMPLICIT_TAG: u32 = 15;

pub(crate) const MAX_INDEX: usize = 0x7_ffff;

/// The character has no mapping without a suffix: the default CE32 falls back to a shorter prefix.
pub(crate) const CONTRACT_SINGLE_CP_NO_MATCH: u32 = 0x100;
/// Every suffix begins with lccc != 0.
pub(crate) const CONTRACT_NEXT_CCC: u32 = 0x200;
/// Some suffix ends with lccc != 0.
pub(crate) const CONTRACT_TRAILING_CCC: u32 = 0x400;

pub(crate) const HANGUL_NO_SPECIAL_JAMO: u32 = 0x100;

pub(crate) const LEAD_ALL_UNASSIGNED: u32 = 0;
pub(crate) const LEAD_ALL_FALLBACK: u32 = 0x100;
pub(crate) const LEAD_TYPE_MASK: u32 = 0x300;

pub(crate) fn is_special_ce32(ce32: u32) -> bool {
    ce32 as u8 >= SPECIAL_CE32_LOW_BYTE
}

pub(crate) fn tag_from_ce32(ce32: u32) -> u32 {
    ce32 & 0xf
}

pub(crate) fn has_ce32_tag(ce32: u32, tag: u32) -> bool {
    is_special_ce32(ce32) && tag_from_ce32(ce32) == tag
}

pub(crate) fn index_from_ce32(ce32: u32) -> usize {
    (ce32 >> 13) as usize
}

pub(crate) fn length_from_ce32(ce32: u32) -> usize {
    ((ce32 >> 8) & 31) as usize
}

pub(crate) fn digit_from_ce32(ce32: u32) -> u8 {
    ((ce32 >> 8) & 0xf) as u8
}

/// Returns the first CE of a Latin expansion: pp tt ss C4 -> pp000000 0500 tt00.
pub(crate) fn latin_ce0_from_ce32(ce32: u32) -> u64 {
    (u64::from(ce32 & 0xff00_0000) << 32)
        | u64::from(COMMON_SECONDARY_CE | ((ce32 & 0xff_0000) >> 8))
}

/// Returns the second CE of a Latin expansion: pp tt ss C4 -> 00000000 ss00 0500.
pub(crate) fn latin_ce1_from_ce32(ce32: u32) -> u64 {
    u64::from(((ce32 & 0xff00) << 16) | COMMON_TERTIARY_CE)
}

/// Converts pppp ss tt to pppp0000 ss00 tt00.
pub(crate) fn ce_from_simple_ce32(ce32: u32) -> u64 {
    (u64::from(ce32 & 0xffff_0000) << 32)
        | u64::from(((ce32 & 0xff00) << 16) | ((ce32 & 0xff) << 8))
}

/// Converts pppppp C1 to pppppp00 0500 0500.
pub(crate) fn ce_from_long_primary_ce32(ce32: u32) -> u64 {
    make_ce(ce32 & 0xffff_ff00)
}

/// Converts ssss tt C2 to 00000000 ssss tt00.
pub(crate) fn ce_from_long_secondary_ce32(ce32: u32) -> u64 {
    u64::from(ce32 & 0xffff_ff00)
}

/// Converts a simple, long-primary or long-secondary CE32.
pub(crate) fn ce_from_ce32(ce32: u32) -> u64 {
    let low_byte = ce32 as u8;
    if low_byte < SPECIAL_CE32_LOW_BYTE {
        ce_from_simple_ce32(ce32)
    } else if low_byte & 0xf == LONG_PRIMARY_TAG as u8 {
        ce_from_long_primary_ce32(ce32)
    } else {
        ce_from_long_secondary_ce32(ce32)
    }
}

pub(crate) fn make_ce(p: u32) -> u64 {
    (u64::from(p) << 32) | u64::from(COMMON_SEC_AND_TER_CE)
}

fn inc_two_byte_primary_by_offset(base_primary: u32, is_compressible: bool, offset: i32) -> u32 {
    let sum = offset.wrapping_add(((base_primary >> 16) & 0xff) as i32);
    let (byte2, carry) = if is_compressible {
        (sum.wrapping_sub(4) % 251 + 4, sum.wrapping_sub(4) / 251)
    } else {
        (sum.wrapping_sub(2) % 254 + 2, sum.wrapping_sub(2) / 254)
    };
    ((byte2 as u32) << 16) | (base_primary & 0xff00_0000).wrapping_add((carry as u32) << 24)
}

fn inc_three_byte_primary_by_offset(base_primary: u32, is_compressible: bool, offset: i32) -> u32 {
    let offset = offset.wrapping_add(((base_primary >> 8) & 0xff) as i32 - 2);
    (((offset % 254 + 2) as u32) << 8)
        | inc_two_byte_primary_by_offset(base_primary, is_compressible, offset / 254)
}

/// `data_ce` holds the base primary, the base code point, the compressible flag and the step of the range.
pub(crate) fn three_byte_primary_for_offset_data(c: u32, data_ce: u64) -> u32 {
    let lower32 = data_ce as i32;
    let offset = (c as i32)
        .wrapping_sub(lower32 >> 8)
        .wrapping_mul(lower32 & 0x7f);
    inc_three_byte_primary_by_offset((data_ce >> 32) as u32, lower32 & 0x80 != 0, offset)
}

/// `c` is `u32::MAX` for no code point.
pub(crate) fn unassigned_ce_from_code_point(c: u32) -> u64 {
    let c = c.wrapping_add(1);
    let fourth = 2 + (c % 18) * 14;
    let third = 2 + (c / 18) % 254;
    let second = 4 + (c / (18 * 254)) % 251;
    make_ce((u32::from(UNASSIGNED_IMPLICIT_BYTE) << 24) | (second << 16) | (third << 8) | fourth)
}
