//! Case properties and mappings of single code points. A value above U+10FFFF maps to itself. ICU4C: ucase.cpp

use crate::common::bytes::U16s;
use crate::common::slice_ext::SliceExt;
use crate::common::udata::{compiled_in, compiled_in_index};
use crate::common::uniset::UnicodeSet;
use crate::common::utf16;
use crate::common::utrie2::{UTrie2, UTrie2ValueBits::Bits16};

const UCASE_IX_TRIE_SIZE: usize = 2;
const UCASE_IX_EXC_LENGTH: usize = 3;
const UCASE_IX_TOP: usize = 16;

// Layout: indexes[16], trie, exceptions[], unfold[]
const UCASE: &[u8] = compiled_in!("ucase.icu", b"cASE", 4).1;
const EXCEPTIONS_OFFSET: usize = UCASE_IX_TOP * 4 + compiled_in_index!(UCASE, UCASE_IX_TRIE_SIZE);

const TRIE: UTrie2 =
    UTrie2::open_from_serialized(Bits16, UCASE.split_at(UCASE_IX_TOP * 4).1).unwrap();
const EXCEPTIONS: U16s = U16s::try_from_offset(
    UCASE,
    EXCEPTIONS_OFFSET,
    compiled_in_index!(UCASE, UCASE_IX_EXC_LENGTH),
)
.unwrap();

const UCASE_TYPE_MASK: u16 = 3;
// The other types are none (0) and title (3).
const UCASE_LOWER: u16 = 1;
const UCASE_UPPER: u16 = 2;
const UCASE_CASE_IGNORABLE: u16 = 4;
const UCASE_EXCEPTION: u16 = 8;
const UCASE_SENSITIVE: u16 = 0x10;
const UCASE_DOT_MASK: u16 = 0x60;
const UCASE_DELTA_SHIFT: u32 = 7;
const UCASE_EXC_SHIFT: u32 = 4;

/// The trie value of a code point. If `UCASE_EXCEPTION` is set, the higher bits are an index into `EXCEPTIONS`.
#[derive(Clone, Copy)]
pub(crate) struct Props {
    bits: u16,
}

/// The role of a character in the dot-above conditions of SpecialCasing.txt.
#[derive(Clone, Copy, PartialEq, Eq)]
enum DotType {
    NoDot,
    SoftDotted,
    /// cc=230
    Above,
    OtherAccent,
}

impl Props {
    #[inline(always)]
    pub(crate) fn of(c: u32) -> Self {
        Self {
            bits: TRIE.get16(c),
        }
    }

    /// Requires that `unit` is not a surrogate.
    #[inline(always)]
    pub(crate) fn of_single(unit: u16) -> Self {
        Self {
            bits: TRIE.get16_from_u16_single_lead(unit),
        }
    }

    pub(crate) fn is_lowercase(self) -> bool {
        self.bits & UCASE_TYPE_MASK == UCASE_LOWER
    }

    pub(crate) fn is_uppercase(self) -> bool {
        self.bits & UCASE_TYPE_MASK == UCASE_UPPER
    }

    #[inline]
    pub(crate) fn is_cased(self) -> bool {
        self.bits & UCASE_TYPE_MASK != 0
    }

    /// Whether the type is `case_type`, lower or upper. Title counts as upper, and none, whose delta is 0, as lower.
    #[inline(always)]
    fn uses_delta(self, case_type: u16) -> bool {
        (self.bits ^ case_type) & 2 == 0
    }

    #[inline]
    pub(crate) fn is_case_ignorable(self) -> bool {
        self.bits & UCASE_CASE_IGNORABLE != 0
    }

    #[inline]
    pub(crate) fn has_exception(self) -> bool {
        self.bits & UCASE_EXCEPTION != 0
    }

    /// The offset to the other case. Only valid without an exception, which every titlecase character has.
    #[inline]
    fn delta(self) -> i32 {
        i32::from(self.bits as i16) >> UCASE_DELTA_SHIFT
    }

    #[inline]
    fn exception(self) -> Option<Exception> {
        self.has_exception().then(|| Exception::of(self))
    }

    fn dot_type(self) -> DotType {
        match self
            .exception()
            .map_or(self.bits, |exception| exception.word >> UCASE_EXC_DOT_SHIFT)
            & UCASE_DOT_MASK
        {
            0 => DotType::NoDot,
            0x20 => DotType::SoftDotted,
            0x40 => DotType::Above,
            _ => DotType::OtherAccent,
        }
    }

    pub(crate) fn is_soft_dotted(self) -> bool {
        self.dot_type() == DotType::SoftDotted
    }

    pub(crate) fn is_case_sensitive(self) -> bool {
        match self.exception() {
            None => self.bits & UCASE_SENSITIVE != 0,
            Some(exception) => exception.has(UCASE_EXC_SENSITIVE),
        }
    }
}

pub(crate) fn add_property_starts(sa: &mut UnicodeSet) {
    TRIE.add_range_starts(sa);
}

/// The discriminant is the slot of the simple mapping in an `Exception`, and the position of the full mapping string.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Lower = 0,
    Fold = 1,
    Upper = 2,
    Title = 3,
}

impl Kind {
    #[inline(always)]
    fn uses_delta(self, props: Props) -> bool {
        props.uses_delta(self.type_with_delta())
    }

    /// The case type whose delta yields this kind of mapping.
    #[inline(always)]
    fn type_with_delta(self) -> u16 {
        match self {
            Self::Lower | Self::Fold => UCASE_UPPER,
            Self::Upper | Self::Title => UCASE_LOWER,
        }
    }

    /// The flags and simple mapping slots that this kind reads. Fold falls back to the slot of lower, title to upper.
    #[inline(always)]
    fn flags(self) -> u16 {
        match self {
            Self::Lower => UCASE_EXC_CONDITIONAL_SPECIAL | 1,
            Self::Fold => UCASE_EXC_CONDITIONAL_FOLD | UCASE_EXC_NO_SIMPLE_CASE_FOLDING | 2 | 1,
            Self::Upper => UCASE_EXC_CONDITIONAL_SPECIAL | 4,
            Self::Title => UCASE_EXC_CONDITIONAL_SPECIAL | 8 | 4,
        }
    }
}

// Slots 0 to 3 are the values of `Kind`.
const UCASE_EXC_DELTA: u32 = 4;
const UCASE_EXC_FULL_MAPPINGS: u32 = 7;

// Flags in the high byte. No entry has UCASE_EXC_DOUBLE_SLOTS (0x100).
const UCASE_EXC_NO_SIMPLE_CASE_FOLDING: u16 = 0x200;
const UCASE_EXC_DELTA_IS_NEGATIVE: u16 = 0x400;
const UCASE_EXC_SENSITIVE: u16 = 0x800;
const UCASE_EXC_DOT_SHIFT: u32 = 7;
// The mapping is hardcoded.
const UCASE_EXC_CONDITIONAL_SPECIAL: u16 = 0x4000;
const UCASE_EXC_CONDITIONAL_FOLD: u16 = 0x8000;

const CONDITIONAL: u16 = UCASE_EXC_CONDITIONAL_SPECIAL | UCASE_EXC_CONDITIONAL_FOLD;

/// A flag word, a slot per bit set in its low byte, and the full mappings, whose lengths are the last slot's nibbles.
#[derive(Clone, Copy)]
struct Exception {
    word: u16,
    /// Index of the first slot.
    slots: usize,
}

/// `count_ones` takes a dozen instructions on processors without a popcount instruction.
static FLAGS_OFFSET: [u8; 0x80] = {
    let (mut table, mut i) = ([0; _], 0);
    while let Some((_, [count, ..])) = table.split_at_mut_checked(i) {
        *count = i.count_ones() as u8;
        i += 1;
    }
    table
};

impl Exception {
    #[inline(always)]
    fn of(props: Props) -> Self {
        let index = usize::from(props.bits >> UCASE_EXC_SHIFT);
        Self {
            word: EXCEPTIONS.at(index),
            slots: index + 1,
        }
    }

    #[inline]
    fn has(self, flag: u16) -> bool {
        self.word & flag != 0
    }

    #[inline(always)]
    fn slot_index(self, flag: u16) -> usize {
        self.slots + usize::from(FLAGS_OFFSET.at(usize::from(self.word & (flag - 1) & 0x7f)))
    }

    #[inline(always)]
    fn slot(self, slot: u32) -> Option<u32> {
        self.has(1 << slot)
            .then(|| EXCEPTIONS.at(self.slot_index(1 << slot)).into())
    }

    #[inline]
    fn apply_delta(self, c: u32) -> Option<u32> {
        let delta = self.slot(UCASE_EXC_DELTA)?;
        Some(if self.has(UCASE_EXC_DELTA_IS_NEGATIVE) {
            c.wrapping_sub(delta)
        } else {
            c.wrapping_add(delta)
        })
    }

    /// `flags` is the result of `Kind::flags`.
    #[inline(always)]
    fn simple_mapping(self, c: u32, uses_delta: bool, flags: u16) -> u32 {
        let flags = self.word & flags;
        if flags & UCASE_EXC_NO_SIMPLE_CASE_FOLDING != 0 {
            return c;
        }
        if uses_delta && let Some(mapped) = self.apply_delta(c) {
            return mapped;
        }
        // If both slots are present, the higher one wins.
        let Some(slot) = (flags & 0xf).checked_ilog2() else {
            return c;
        };
        EXCEPTIONS.at(self.slot_index(1 << slot)).into()
    }

    /// Returns `None` if the full mapping is the simple mapping.
    #[inline(always)]
    fn full_mapping(self, kind: Kind) -> Option<U16s<'static>> {
        let lengths = self.slot(UCASE_EXC_FULL_MAPPINGS)?;
        let nibble = |word: u32| (word >> (4 * kind as u32) & 0xf) as usize;
        let length = Some(nibble(lengths)).filter(|&length| length != 0)?;
        // Nibble n of the product is the sum of the first n lengths, which is below 16.
        let start = self.slot_index(1 << UCASE_EXC_FULL_MAPPINGS)
            + 1
            + nibble(lengths.wrapping_mul(0x1_1110));
        Some(EXCEPTIONS.slice(start..start + length))
    }
}

/// The simple and full mapping of a character without an exception.
#[inline(always)]
fn delta_mapping(c: u32, props: Props, kind: Kind) -> u32 {
    if kind.uses_delta(props) {
        c.wrapping_add_signed(props.delta())
    } else {
        c
    }
}

#[inline]
fn simple_mapping(c: u32, props: Props, kind: Kind) -> u32 {
    match props.exception() {
        None => delta_mapping(c, props, kind),
        Some(exception) => exception.simple_mapping(c, kind.uses_delta(props), kind.flags()),
    }
}

pub(crate) fn to_lower(c: u32) -> u32 {
    simple_mapping(c, Props::of(c), Kind::Lower)
}

pub(crate) fn to_upper(c: u32) -> u32 {
    simple_mapping(c, Props::of(c), Kind::Upper)
}

/// The result of a full case mapping.
#[derive(Clone, Copy)]
pub(crate) enum Mapped {
    Unchanged,
    CodePoint(u32),
    /// At most three BMP characters. An empty string removes the character.
    String(U16s<'static>),
}

impl Mapped {
    #[inline]
    fn simple(c: u32, mapped: u32) -> Self {
        if mapped == c {
            Self::Unchanged
        } else {
            Self::CodePoint(mapped)
        }
    }

    pub(crate) fn is_change(self) -> bool {
        !matches!(self, Self::Unchanged)
    }
}

/// The languages with special case mappings.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CaseLocale {
    Root,
    /// Also Azerbaijani
    Turkish,
    Lithuanian,
    Greek,
    Dutch,
    /// Eastern Armenian. Only `to_full_title_in_context` knows it.
    Armenian,
}

impl CaseLocale {
    /// `locale` is the base name of a `Locale`, whose language is lowercase and has two letters where it can.
    pub(crate) fn of(locale: &[u8]) -> Self {
        let ([a, b] | [a, b, b'_', ..]) = *locale else {
            return Self::Root;
        };
        match &[a, b] {
            b"tr" | b"az" => Self::Turkish,
            b"lt" => Self::Lithuanian,
            b"el" => Self::Greek,
            b"nl" => Self::Dutch,
            b"hy" => Self::Armenian,
            _ => Self::Root,
        }
    }
}

/// The character `text[start..limit]` and the text around it.
pub(crate) struct Context<'a> {
    pub(crate) text: &'a [u16],
    pub(crate) start: usize,
    pub(crate) limit: usize,
}

impl Context<'_> {
    pub(crate) const NONE: Context<'static> = Context {
        text: &[],
        start: 0,
        limit: 0,
    };

    /// Iterates backward from the character.
    fn before(&self) -> impl Iterator<Item = u32> {
        let mut i = self.start;
        std::iter::from_fn(move || (i > 0).then(|| utf16::prev(self.text, &mut i)))
    }

    fn after(&self) -> impl Iterator<Item = u32> {
        let mut i = self.limit;
        std::iter::from_fn(move || (i < self.text.len()).then(|| utf16::next(self.text, &mut i)))
    }
}

/// Skips case-ignorable characters, even cased ones.
pub(crate) fn starts_with_cased_letter(mut text: impl Iterator<Item = u32>) -> bool {
    text.find_map(|c| Some(Props::of(c)).filter(|props| !props.is_case_ignorable()))
        .is_some_and(Props::is_cased)
}

fn skip_other_accents(text: impl Iterator<Item = u32>) -> Option<(u32, DotType)> {
    text.map(|c| (c, Props::of(c).dot_type()))
        .find(|&(_, dot_type)| dot_type != DotType::OtherAccent)
}

macro_rules! units {
    ($($unit:literal),*) => {
        U16s::from_chunks(&[$(u16::to_ne_bytes($unit)),*])
    };
}

const I_DOT: U16s = units!(0x69, 0x307);
const J_DOT: U16s = units!(0x6a, 0x307);
const I_OGONEK_DOT: U16s = units!(0x12f, 0x307);
const I_DOT_GRAVE: U16s = units!(0x69, 0x307, 0x300);
const I_DOT_ACUTE: U16s = units!(0x69, 0x307, 0x301);
const I_DOT_TILDE: U16s = units!(0x69, 0x307, 0x303);
const ECH_VEW_TITLE: U16s = units!(0x535, 0x57e);
const ECH_YIWN_UPPER: U16s = units!(0x535, 0x552);
const ECH_YIWN_TITLE: U16s = units!(0x535, 0x582);

/// A full case mapping for a language.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Mapping {
    kind: Kind,
    locale: CaseLocale,
}

impl Mapping {
    pub(crate) fn lower(locale: CaseLocale) -> Self {
        Self {
            kind: Kind::Lower,
            locale,
        }
    }

    pub(crate) fn upper(locale: CaseLocale) -> Self {
        Self {
            kind: Kind::Upper,
            locale,
        }
    }

    /// Requires that the kind is lower or upper.
    #[inline(always)]
    pub(crate) fn to_fast(self) -> FastMapping {
        use CaseLocale::{Lithuanian, Turkish};
        let latin = match (self.kind, self.locale) {
            (Kind::Upper, Turkish) => &latin_case::TO_UPPER_TR,
            (Kind::Upper, _) => &latin_case::TO_UPPER_NORMAL,
            (_, Turkish | Lithuanian) => &latin_case::TO_LOWER_TR_LT,
            _ => &latin_case::TO_LOWER_NORMAL,
        };
        FastMapping {
            mapping: self,
            latin,
            may_change: self.kind.type_with_delta() | UCASE_EXCEPTION,
            flags: self.kind.flags() | 1 << UCASE_EXC_FULL_MAPPINGS,
        }
    }

    /// The mapping without context.
    #[inline(always)]
    fn of(self, c: u32) -> Mapped {
        let props = Props::of(c);
        if props.has_exception() {
            self.of_exception(c, props)
        } else {
            Mapped::simple(c, delta_mapping(c, props, self.kind))
        }
    }

    #[inline(never)]
    fn of_exception(self, c: u32, props: Props) -> Mapped {
        let (exception, flags) = (Exception::of(props), self.kind.flags());
        if exception.has(flags & CONDITIONAL) {
            if let Some(mapped) = self.special(c, &Context::NONE) {
                return mapped;
            }
        } else if let Some(string) = exception.full_mapping(self.kind) {
            return Mapped::String(string);
        }
        Mapped::simple(
            c,
            exception.simple_mapping(c, self.kind.uses_delta(props), flags),
        )
    }

    /// Returns the hardcoded mapping, or `None` if the simple mapping applies.
    #[inline(never)]
    fn special(self, c: u32, context: &Context) -> Option<Mapped> {
        match self.kind {
            Kind::Lower => self.special_lower(c, context),
            // Only I and İ have `UCASE_EXC_CONDITIONAL_FOLD`.
            Kind::Fold => (c == 0x130).then_some(Mapped::String(I_DOT)),
            Kind::Upper | Kind::Title => self.special_upper_or_title(c, context),
        }
    }

    fn special_lower(self, c: u32, context: &Context) -> Option<Mapped> {
        use CaseLocale::{Lithuanian, Turkish};
        if c == 0x3a3 {
            let is_final = !starts_with_cased_letter(context.after())
                && starts_with_cased_letter(context.before());
            return is_final.then_some(Mapped::CodePoint(0x3c2));
        }
        let more_above = || {
            matches!(
                skip_other_accents(context.after()),
                Some((_, DotType::Above))
            )
        };
        let after_i = || matches!(skip_other_accents(context.before()), Some((0x49, _)));
        let before_dot = || matches!(skip_other_accents(context.after()), Some((0x307, _)));
        Some(match (c, self.locale) {
            (0x49, Lithuanian) if more_above() => Mapped::String(I_DOT),
            (0x4a, Lithuanian) if more_above() => Mapped::String(J_DOT),
            (0x12e, Lithuanian) if more_above() => Mapped::String(I_OGONEK_DOT),
            (0xcc, Lithuanian) => Mapped::String(I_DOT_GRAVE),
            (0xcd, Lithuanian) => Mapped::String(I_DOT_ACUTE),
            (0x128, Lithuanian) => Mapped::String(I_DOT_TILDE),
            (0x130, Turkish) => Mapped::CodePoint(0x69),
            (0x307, Turkish) if after_i() => Mapped::String(U16s::EMPTY),
            (0x49, Turkish) if !before_dot() => Mapped::CodePoint(0x131),
            (0x130, _) => Mapped::String(I_DOT),
            _ => return None,
        })
    }

    fn special_upper_or_title(self, c: u32, context: &Context) -> Option<Mapped> {
        use CaseLocale::{Lithuanian, Turkish};
        let after_soft_dotted = || {
            matches!(
                skip_other_accents(context.before()),
                Some((_, DotType::SoftDotted))
            )
        };
        Some(match (c, self.locale) {
            (0x69, Turkish) => Mapped::CodePoint(0x130),
            (0x307, Lithuanian) if after_soft_dotted() => Mapped::String(U16s::EMPTY),
            (0x587, _) if self.kind == Kind::Upper => Mapped::String(ECH_YIWN_UPPER),
            (0x587, _) => Mapped::String(ECH_YIWN_TITLE),
            _ => return None,
        })
    }
}

/// A `Mapping` with precomputed tables and masks for mapping strings.
#[derive(Clone, Copy)]
pub(crate) struct FastMapping {
    mapping: Mapping,
    latin: &'static [i8; latin_case::LIMIT],
    /// A character maps to itself if its `Props` has none of these bits.
    may_change: u16,
    /// `Kind::flags` and the bit of the full mappings slot.
    flags: u16,
}

impl FastMapping {
    /// Returns the delta or `latin_case::EXC`, and `None` above U+017F.
    #[inline(always)]
    pub(crate) fn latin(&self, c: u32) -> Option<i8> {
        self.latin.get(c as usize).copied()
    }

    #[inline(always)]
    fn may_change(&self, props: Props) -> bool {
        props.bits & self.may_change != 0
    }

    /// Requires that `c` has no exception.
    #[inline(always)]
    pub(crate) fn by_delta(&self, c: u32, props: Props) -> u32 {
        if self.may_change(props) {
            c.wrapping_add_signed(props.delta())
        } else {
            c
        }
    }

    /// Returns `None` if the mapping may be a string or depend on the context.
    #[inline(always)]
    pub(crate) fn simple(&self, c: u32, props: Props) -> Option<u32> {
        if !self.may_change(props) {
            return Some(c);
        }
        let Some(exception) = props.exception() else {
            return Some(c.wrapping_add_signed(props.delta()));
        };
        (!exception.has(self.flags & (CONDITIONAL | 1 << UCASE_EXC_FULL_MAPPINGS)))
            .then(|| exception.simple_mapping(c, props.uses_delta(self.may_change), self.flags))
    }

    /// Without `always`, returns `None` if `latin` or `simple` can map `c`. Calling `of_exception` here is 5% slower.
    #[inline(always)]
    pub(crate) fn full(&self, c: u32, context: &Context, always: bool) -> Option<Mapped> {
        if !always && self.latin(c).is_some_and(|delta| delta != latin_case::EXC) {
            return None;
        }
        let props = Props::of(c);
        let Some(exception) = props.exception() else {
            return always.then(|| Mapped::simple(c, self.by_delta(c, props)));
        };
        if exception.has(self.flags & CONDITIONAL) {
            if let Some(mapped) = self.mapping.special(c, context) {
                return Some(mapped);
            }
        } else if let Some(string) = exception.full_mapping(self.mapping.kind) {
            return Some(Mapped::String(string));
        } else if !always && !exception.has(1 << UCASE_EXC_FULL_MAPPINGS) {
            return None;
        }
        Some(Mapped::simple(
            c,
            exception.simple_mapping(c, props.uses_delta(self.may_change), self.flags),
        ))
    }
}

pub(crate) fn to_full_lower(c: u32) -> Mapped {
    Mapping::lower(CaseLocale::Root).of(c)
}

pub(crate) fn to_full_upper(c: u32) -> Mapped {
    Mapping::upper(CaseLocale::Root).of(c)
}

pub(crate) fn to_full_title(c: u32, locale: CaseLocale) -> Mapped {
    let kind = Kind::Title;
    Mapping { kind, locale }.of(c)
}

pub(crate) fn to_full_title_in_context(c: u32, context: &Context, locale: CaseLocale) -> Mapped {
    let kind = Kind::Title;
    match (c, locale) {
        (0x587, CaseLocale::Armenian) => Mapped::String(ECH_VEW_TITLE),
        // No other mapping depends on the context.
        (0x307, _) => (Mapping { kind, locale }.special(c, context)).unwrap_or(Mapped::Unchanged),
        _ => to_full_title(c, locale),
    }
}

pub(crate) fn to_full_folding(c: u32) -> Mapped {
    let (kind, locale) = (Kind::Fold, CaseLocale::Root);
    Mapping { kind, locale }.of(c)
}

/// Deltas for U+0000..U+017F. 0 means no mapping.
pub(crate) mod latin_case {
    pub(super) const LIMIT: usize = 0x180;
    /// Marks a complex mapping or a delta that does not fit.
    pub(crate) const EXC: i8 = -0x80;

    #[rustfmt::skip]
    pub(super) static TO_LOWER_NORMAL: [i8; LIMIT] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        0, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32,
        32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, EXC, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32,
        32, 32, 32, 32, 32, 32, 32, 0, 32, 32, 32, 32, 32, 32, 32, EXC,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        EXC, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1,

        0, 1, 0, 1, 0, 1, 0, 1, 0, EXC, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, -121, 1, 0, 1, 0, 1, 0, EXC
    ];

    #[rustfmt::skip]
    pub(super) static TO_LOWER_TR_LT: [i8; LIMIT] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        0, 32, 32, 32, 32, 32, 32, 32, 32, EXC, EXC, 32, 32, 32, 32, 32,
        32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, EXC, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, EXC, EXC, 32, 32,
        32, 32, 32, 32, 32, 32, 32, 0, 32, 32, 32, 32, 32, 32, 32, EXC,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, EXC, 0, 1, 0, 1, 0, EXC, 0,
        EXC, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1,

        0, 1, 0, 1, 0, 1, 0, 1, 0, EXC, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0,
        1, 0, 1, 0, 1, 0, 1, 0, -121, 1, 0, 1, 0, 1, 0, EXC
    ];

    #[rustfmt::skip]
    pub(super) static TO_UPPER_NORMAL: [i8; LIMIT] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32,
        -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, 0, 0, 0, 0, 0,

        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, EXC, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, EXC,
        -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32,
        -32, -32, -32, -32, -32, -32, -32, 0, -32, -32, -32, -32, -32, -32, -32, 121,

        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, EXC, 0, -1, 0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0,

        -1, 0, -1, 0, -1, 0, -1, 0, -1, EXC, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, EXC
    ];

    #[rustfmt::skip]
    pub(super) static TO_UPPER_TR: [i8; LIMIT] = [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, -32, -32, -32, -32, -32, -32, -32, -32, EXC, -32, -32, -32, -32, -32, -32,
        -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, 0, 0, 0, 0, 0,

        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, EXC, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,

        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, EXC,
        -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32, -32,
        -32, -32, -32, -32, -32, -32, -32, 0, -32, -32, -32, -32, -32, -32, -32, 121,

        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, EXC, 0, -1, 0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0,

        -1, 0, -1, 0, -1, 0, -1, 0, -1, EXC, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1, 0, -1,
        0, -1, 0, -1, 0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, EXC
    ];
}
