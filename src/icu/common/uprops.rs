//! Property values by `UProperty`, and their data sources. The arguments are code points. ICU4C: uprops.cpp

use crate::common::bytes::U32s;
use crate::common::emojiprops;
use crate::common::normalizer2::{
    Normalizer2, UNormalization2Mode::Compose, get_nfd_instance, get_nfkc_cf_impl, get_nfkc_impl,
};
use crate::common::normalizer2impl::{DECOMPOSITION_CAPACITY, NFC, get_fcd16};
use crate::common::sink::{TextBuf, TextSink, WritableAlias};
use crate::common::slice_ext::SoftUnwrap;
use crate::common::ubidi_props::*;
use crate::common::ucase::{
    CaseLocale, Props, to_full_folding, to_full_lower, to_full_title, to_full_upper,
};
use crate::common::uchar::*;
use crate::common::ucptrie::UCPTrie;
use crate::common::udata::{self, UDataInfo};
use crate::common::umutex::OnceBox;
use crate::common::unicode::uchar::*;
use crate::common::uniset::UnicodeSet;
use crate::common::utf16;
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, UErrorCode};

/// The binary properties in vector word 1, by bit. ICU4C: uprops.h
const FLAGS: [UProperty; 32] = [
    UCHAR_WHITE_SPACE,
    UCHAR_DASH,
    UCHAR_HYPHEN,
    UCHAR_QUOTATION_MARK,
    UCHAR_TERMINAL_PUNCTUATION,
    UCHAR_MATH,
    UCHAR_HEX_DIGIT,
    UCHAR_ASCII_HEX_DIGIT,
    UCHAR_ALPHABETIC,
    UCHAR_IDEOGRAPHIC,
    UCHAR_DIACRITIC,
    UCHAR_EXTENDER,
    UCHAR_NONCHARACTER_CODE_POINT,
    UCHAR_GRAPHEME_EXTEND,
    UCHAR_GRAPHEME_LINK,
    UCHAR_IDS_BINARY_OPERATOR,
    UCHAR_IDS_TRINARY_OPERATOR,
    UCHAR_RADICAL,
    UCHAR_UNIFIED_IDEOGRAPH,
    UCHAR_DEFAULT_IGNORABLE_CODE_POINT,
    UCHAR_DEPRECATED,
    UCHAR_LOGICAL_ORDER_EXCEPTION,
    UCHAR_XID_START,
    UCHAR_XID_CONTINUE,
    UCHAR_ID_START,
    UCHAR_ID_CONTINUE,
    UCHAR_GRAPHEME_BASE,
    UCHAR_S_TERM,
    UCHAR_VARIATION_SELECTOR,
    UCHAR_PATTERN_SYNTAX,
    UCHAR_PATTERN_WHITE_SPACE,
    UCHAR_PREPENDED_CONCATENATION_MARK,
];

/// The tries of InPC, InSC and vo follow the indexes, which are their number and the limit of each trie.
fn load_layout_tries() -> Result<[UCPTrie<'static>; 3], UErrorCode> {
    let is_acceptable =
        |info: &UDataInfo| &info.data_format == b"Layo" && info.format_version[0] == 1;
    let bytes = udata::open_choice(None, b"icu", b"ulayout", is_acceptable)?.memory;
    let indexes = U32s::of(bytes);
    let open = |offset: u32| {
        let trie = bytes.get(offset as usize..).and_then(UCPTrie::open);
        trie.ok_or(U_INVALID_FORMAT_ERROR)
    };
    Ok([
        open(indexes.at(0).wrapping_mul(4))?,
        open(indexes.at(1))?,
        open(indexes.at(2))?,
    ])
}

pub(crate) fn layout_trie(which: UProperty) -> Result<&'static UCPTrie<'static>, UErrorCode> {
    static TRIES: OnceBox<Result<[UCPTrie<'static>; 3], UErrorCode>> = OnceBox::new();
    let [inpc, insc, vo] = TRIES.get_or_init_caching_err(load_layout_tries)?;
    Ok(match which {
        UCHAR_INDIC_POSITIONAL_CATEGORY => inpc,
        UCHAR_INDIC_SYLLABIC_CATEGORY => insc,
        _ => vo,
    })
}

/// Excludes the code points in `ID_COMPAT_MATH_START`.
const ID_COMPAT_MATH_CONTINUE: [(u32, u32); 5] = [
    (0x00B2, 0x00B3),
    (0x00B9, 0x00B9),
    (0x2070, 0x2070),
    (0x2074, 0x207E),
    (0x2080, 0x208E),
];

const ID_COMPAT_MATH_START: [u32; 13] = [
    0x2202, 0x2207, 0x221E, 0x1D6C1, 0x1D6DB, 0x1D6FB, 0x1D715, 0x1D735, 0x1D74F, 0x1D76F, 0x1D789,
    0x1D7A9, 0x1D7C3,
];

const MODIFIER_COMBINING_MARK: [(u32, u32); 12] = [
    (0x0654, 0x0655),
    (0x0658, 0x0658),
    (0x06DC, 0x06DC),
    (0x06E3, 0x06E3),
    (0x06E7, 0x06E8),
    (0x08CA, 0x08CB),
    (0x08CD, 0x08CF),
    (0x08D3, 0x08D3),
    (0x08F3, 0x08F3),
    (0x10EF4, 0x10EF4),
    (0x10EF6, 0x10EF6),
    (0x10EF9, 0x10EF9),
];

fn ranges_contain(ranges: &[(u32, u32)], c: u32) -> bool {
    ranges
        .iter()
        .any(|&(start, end)| (start..=end).contains(&c))
}

/// Returns `test(c, normalized c)`.
fn test_normalized(norm2: &Normalizer2, c: u32, test: fn(&[u16], &[u16]) -> bool) -> bool {
    let (mut src, mut dest) = ([0; 2], [0; DECOMPOSITION_CAPACITY]);
    let mut src = WritableAlias::new(&mut src, 0);
    let mut dest = WritableAlias::new(&mut dest, 0);
    src.add_code_point(c);
    norm2.normalize(src.as_slice(), &mut dest).is_ok() && test(src.as_slice(), dest.as_slice())
}

fn changes_when_titlecased(c: u32) -> bool {
    to_full_title(c, CaseLocale::Root).is_change()
}

/// Segment_Starter has no lookup: `canon_segment_starters` returns its set.
pub(crate) fn u_has_binary_property(c: u32, which: UProperty) -> bool {
    match which {
        UCHAR_BIDI_CONTROL => ubidi_is_bidi_control(c),
        UCHAR_BIDI_MIRRORED => ubidi_is_mirrored(c),
        UCHAR_JOIN_CONTROL => ubidi_is_join_control(c),

        UCHAR_LOWERCASE => Props::of(c).is_lowercase(),
        UCHAR_UPPERCASE => Props::of(c).is_uppercase(),
        UCHAR_SOFT_DOTTED => Props::of(c).is_soft_dotted(),
        UCHAR_CASE_SENSITIVE => Props::of(c).is_case_sensitive(),
        UCHAR_CASED => Props::of(c).is_cased(),
        UCHAR_CASE_IGNORABLE => Props::of(c).is_case_ignorable(),
        UCHAR_CHANGES_WHEN_LOWERCASED => to_full_lower(c).is_change(),
        UCHAR_CHANGES_WHEN_UPPERCASED => to_full_upper(c).is_change(),
        UCHAR_CHANGES_WHEN_TITLECASED => changes_when_titlecased(c),
        UCHAR_CHANGES_WHEN_CASEMAPPED => {
            to_full_lower(c).is_change()
                || to_full_upper(c).is_change()
                || changes_when_titlecased(c)
        }
        UCHAR_CHANGES_WHEN_CASEFOLDED => test_normalized(get_nfd_instance(), c, |_, nfd| {
            utf16::code_points(nfd).any(|c| to_full_folding(c).is_change())
        }),

        UCHAR_FULL_COMPOSITION_EXCLUSION => NFC.has_full_composition_exclusion(c),
        UCHAR_NFD_INERT => NFC.is_decomp_inert(c),
        UCHAR_NFC_INERT => NFC.is_comp_inert(c),
        UCHAR_NFKD_INERT => get_nfkc_impl().is_ok_and(|nfkc| nfkc.is_decomp_inert(c)),
        UCHAR_NFKC_INERT => get_nfkc_impl().is_ok_and(|nfkc| nfkc.is_comp_inert(c)),
        UCHAR_CHANGES_WHEN_NFKC_CASEFOLDED => get_nfkc_cf_impl().is_ok_and(|nfkc_cf| {
            test_normalized(&Normalizer2::new(nfkc_cf, Compose), c, |src, dest| {
                src != dest
            })
        }),

        UCHAR_POSIX_ALNUM => u_isalnum_posix(c),
        UCHAR_POSIX_BLANK => u_isblank(c),
        UCHAR_POSIX_GRAPH => u_isgraph_posix(c),
        UCHAR_POSIX_PRINT => u_isprint_posix(c),
        UCHAR_POSIX_XDIGIT => u_isxdigit(c),

        UCHAR_EMOJI..=UCHAR_EMOJI_COMPONENT | UCHAR_EXTENDED_PICTOGRAPHIC..=UCHAR_RGI_EMOJI => {
            emojiprops::has_binary_property(c, which)
        }

        UCHAR_REGIONAL_INDICATOR => (0x1F1E6..=0x1F1FF).contains(&c),
        UCHAR_IDS_UNARY_OPERATOR => (0x2FFE..=0x2FFF).contains(&c),
        UCHAR_ID_COMPAT_MATH_START => ID_COMPAT_MATH_START.contains(&c),
        UCHAR_ID_COMPAT_MATH_CONTINUE => {
            ranges_contain(&ID_COMPAT_MATH_CONTINUE, c) || ID_COMPAT_MATH_START.contains(&c)
        }
        UCHAR_MODIFIER_COMBINING_MARK => ranges_contain(&MODIFIER_COMBINING_MARK, c),

        _ => {
            let bit = FLAGS.iter().position(|&flag| flag == which);
            has_flag(c, bit.soft_unwrap() as u32)
        }
    }
}

fn hangul_syllable_type(c: u32) -> UHangulSyllableType {
    // Some supplementary Kirat Rai vowels have GCB=V.
    if c > 0xffff {
        return U_HST_NOT_APPLICABLE;
    }
    match u_get_int_property_value(c, UCHAR_GRAPHEME_CLUSTER_BREAK) {
        U_GCB_L => U_HST_LEADING_JAMO,
        U_GCB_V => U_HST_VOWEL_JAMO,
        U_GCB_T => U_HST_TRAILING_JAMO,
        U_GCB_LV => U_HST_LV_SYLLABLE,
        U_GCB_LVT => U_HST_LVT_SYLLABLE,
        _ => U_HST_NOT_APPLICABLE,
    }
}

pub(crate) fn u_get_int_property_value(c: u32, which: UProperty) -> i32 {
    let field = |column, shift: u32, mask: u32| (vector_word(c, column) >> shift & mask) as i32;
    match which {
        UCHAR_EAST_ASIAN_WIDTH => east_asian_width(c),
        UCHAR_INDIC_CONJUNCT_BREAK => field(0, 15, 3),
        UCHAR_LINE_BREAK => line_break(c),
        UCHAR_SENTENCE_BREAK => field(2, 15, 0x1f),
        UCHAR_WORD_BREAK => field(2, 10, 0x1f),
        UCHAR_GRAPHEME_CLUSTER_BREAK => field(2, 5, 0x1f),
        UCHAR_DECOMPOSITION_TYPE => field(2, 0, 0x1f),

        UCHAR_BIDI_CLASS => ubidi_get_class(c),
        UCHAR_JOINING_GROUP => ubidi_get_joining_group(c),
        UCHAR_JOINING_TYPE => ubidi_get_joining_type(c),
        UCHAR_BIDI_PAIRED_BRACKET_TYPE => ubidi_get_paired_bracket_type(c),

        UCHAR_NUMERIC_TYPE => numeric_type(c),
        UCHAR_BLOCK => ublock_get_code(c),
        UCHAR_SCRIPT => uscript_get_script(c),
        UCHAR_HANGUL_SYLLABLE_TYPE => hangul_syllable_type(c),
        // 0 is Restricted, 1 is Allowed.
        UCHAR_IDENTIFIER_STATUS => (encoded_id_type(c) >= UPROPS_ID_TYPE_ALLOWED_MIN).into(),

        UCHAR_CANONICAL_COMBINING_CLASS => NFC.get_cc(c).into(),
        UCHAR_LEAD_CANONICAL_COMBINING_CLASS => (get_fcd16(c) >> 8).into(),
        UCHAR_TRAIL_CANONICAL_COMBINING_CLASS => (get_fcd16(c) & 0xff).into(),
        UCHAR_NFD_QUICK_CHECK => NFC.get_decomp_quick_check(c),
        UCHAR_NFC_QUICK_CHECK => NFC.get_comp_quick_check(c),
        UCHAR_NFKD_QUICK_CHECK => get_nfkc_impl().map_or(0, |it| it.get_decomp_quick_check(c)),
        UCHAR_NFKC_QUICK_CHECK => get_nfkc_impl().map_or(0, |it| it.get_comp_quick_check(c)),

        _ => layout_trie(which).map_or(0, |trie| trie.get(c) as i32),
    }
}

/// The data of a property, which determine the code points at which the value can change.
#[derive(Clone, Copy)]
pub(crate) enum UPropertySource {
    Char,
    PropsVec,
    Case,
    Bidi,
    CharAndPropsVec,
    CaseAndNorm,
    Nfc,
    Nfkc,
    NfkcCf,
    Inpc,
    Insc,
    Vo,
    Emoji,
    Idsu,
    IdCompatMath,
    Block,
    Mcm,
}

impl UPropertySource {
    pub(crate) const COUNT: usize = Self::Mcm as usize + 1;
}

pub(crate) fn uprops_get_source(which: UProperty) -> UPropertySource {
    use UPropertySource::*;
    match which {
        UCHAR_GENERAL_CATEGORY_MASK
        | UCHAR_NUMERIC_TYPE
        | UCHAR_NUMERIC_VALUE
        | UCHAR_POSIX_BLANK
        | UCHAR_POSIX_GRAPH
        | UCHAR_POSIX_PRINT
        | UCHAR_POSIX_XDIGIT => Char,
        UCHAR_POSIX_ALNUM => CharAndPropsVec,
        UCHAR_BLOCK => Block,

        UCHAR_LOWERCASE
        | UCHAR_UPPERCASE
        | UCHAR_SOFT_DOTTED
        | UCHAR_CASE_SENSITIVE
        | UCHAR_CASED
        | UCHAR_CASE_IGNORABLE
        | UCHAR_CHANGES_WHEN_LOWERCASED
        | UCHAR_CHANGES_WHEN_UPPERCASED
        | UCHAR_CHANGES_WHEN_TITLECASED
        | UCHAR_CHANGES_WHEN_CASEMAPPED => Case,
        UCHAR_CHANGES_WHEN_CASEFOLDED => CaseAndNorm,

        UCHAR_BIDI_CONTROL
        | UCHAR_BIDI_MIRRORED
        | UCHAR_JOIN_CONTROL
        | UCHAR_BIDI_CLASS
        | UCHAR_JOINING_GROUP
        | UCHAR_JOINING_TYPE
        | UCHAR_BIDI_PAIRED_BRACKET_TYPE => Bidi,

        UCHAR_FULL_COMPOSITION_EXCLUSION
        | UCHAR_NFD_INERT
        | UCHAR_NFC_INERT
        | UCHAR_CANONICAL_COMBINING_CLASS
        | UCHAR_LEAD_CANONICAL_COMBINING_CLASS
        | UCHAR_TRAIL_CANONICAL_COMBINING_CLASS
        | UCHAR_NFD_QUICK_CHECK
        | UCHAR_NFC_QUICK_CHECK => Nfc,
        UCHAR_NFKD_INERT | UCHAR_NFKC_INERT | UCHAR_NFKD_QUICK_CHECK | UCHAR_NFKC_QUICK_CHECK => {
            Nfkc
        }
        UCHAR_CHANGES_WHEN_NFKC_CASEFOLDED => NfkcCf,

        UCHAR_INDIC_POSITIONAL_CATEGORY => Inpc,
        UCHAR_INDIC_SYLLABIC_CATEGORY => Insc,
        UCHAR_VERTICAL_ORIENTATION => Vo,

        UCHAR_EMOJI..=UCHAR_EMOJI_COMPONENT | UCHAR_EXTENDED_PICTOGRAPHIC..=UCHAR_RGI_EMOJI => {
            Emoji
        }

        UCHAR_IDS_UNARY_OPERATOR => Idsu,
        UCHAR_ID_COMPAT_MATH_START | UCHAR_ID_COMPAT_MATH_CONTINUE => IdCompatMath,
        UCHAR_MODIFIER_COMBINING_MARK => Mcm,

        // Includes Regional_Indicator, whose starts are a subset of the starts of lb=RI.
        _ => PropsVec,
    }
}

fn add_starts_and_limits(ranges: &[(u32, u32)], sa: &mut UnicodeSet) {
    for &(start, end) in ranges {
        sa.add(start);
        sa.add(end + 1);
    }
}

pub(crate) fn add_id_compat_math_starts(sa: &mut UnicodeSet) {
    add_starts_and_limits(&ID_COMPAT_MATH_CONTINUE, sa);
    add_starts_and_limits(&ID_COMPAT_MATH_START.map(|c| (c, c)), sa);
}

pub(crate) fn add_modifier_combining_mark_starts(sa: &mut UnicodeSet) {
    add_starts_and_limits(&MODIFIER_COMBINING_MARK, sa);
}

const UPROPS_ID_TYPE_ALLOWED_MIN: u32 = 0x3c;

fn encoded_id_type(c: u32) -> u32 {
    vector_word(c, 2) >> 26
}

pub(crate) fn u_has_id_type(c: u32, type_: UIdentifierType) -> bool {
    /// Exclusion and Limited_Use cannot be combined, so both bits together mark a value that excludes all others.
    const EXCLUSIVE: u32 = 0x30;
    let encoded = encoded_id_type(c);
    let has_bit = |bit| encoded < EXCLUSIVE && encoded & bit != 0;
    match type_ {
        U_ID_TYPE_NOT_CHARACTER => encoded == 0,
        U_ID_TYPE_DEPRECATED => encoded == 0x30,
        U_ID_TYPE_DEFAULT_IGNORABLE => encoded == 0x31,
        U_ID_TYPE_NOT_NFKC => encoded == 0x32,
        U_ID_TYPE_INCLUSION => encoded == 0x3e,
        U_ID_TYPE_RECOMMENDED => encoded == 0x3f,
        U_ID_TYPE_NOT_XID => has_bit(1),
        U_ID_TYPE_OBSOLETE => has_bit(2),
        U_ID_TYPE_TECHNICAL => has_bit(4),
        U_ID_TYPE_UNCOMMON_USE => has_bit(8),
        U_ID_TYPE_LIMITED_USE => has_bit(0x10),
        _ => has_bit(0x20),
    }
}
