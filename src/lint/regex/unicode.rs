//! What regular expressions need to know about Unicode.

use super::charset::{CharSet, MAX};
use super::unicode_tables as tables;
use bun_core::strings;

/// The index of `name` in `names`, which are separated by spaces.
fn index_of_name(names: &'static [u8], name: &[u8]) -> Option<usize> {
    let mut all = strings::split(names, b" ");
    let mut index = 0;
    while let Some(candidate) = all.next() {
        if candidate == name {
            return Some(index);
        }
        index += 1;
    }
    None
}

/// Looks `name` up in a table of `version << 8 | index`.
fn versioned(names: &'static [u8], values: &'static [u16], name: &[u8]) -> Option<(u32, u8)> {
    let value = *values.get(index_of_name(names, name)?)?;
    Some((2018 + u32::from(value >> 8), value as u8))
}

fn is_general_category(name: &[u8]) -> bool {
    matches!(name, b"General_Category" | b"gc")
}

fn is_script(name: &[u8]) -> bool {
    matches!(name, b"Script" | b"Script_Extensions" | b"sc" | b"scx")
}

/// `\p{name=value}`
pub(super) fn is_valid_unicode_property(version: u32, name: &[u8], value: &[u8]) -> bool {
    if is_general_category(name) {
        return version >= 2018 && index_of_name(tables::GENERAL_CATEGORY_NAMES, value).is_some();
    }
    if is_script(name) {
        return versioned(tables::SCRIPT_NAMES, tables::SCRIPT_VALUES, value)
            .is_some_and(|(since, _)| version >= since);
    }
    false
}

/// `\p{value}`
pub(super) fn is_valid_lone_unicode_property(version: u32, value: &[u8]) -> bool {
    versioned(tables::BINARY_NAMES, tables::BINARY_VALUES, value)
        .is_some_and(|(since, _)| version >= since)
}

/// `\p{value}` with the `v` flag.
pub(super) fn is_valid_lone_unicode_property_of_string(version: u32, value: &[u8]) -> bool {
    version >= 2024 && index_of_name(tables::STRING_PROPERTY_NAMES, value).is_some()
}

/// The ranges of a table of `start << bits | value`, which covers all code points.
fn partition(table: &'static [u32], bits: u32) -> impl Iterator<Item = (u32, u32, u32)> {
    let ends = table.iter().skip(1).map(move |next| (next >> bits) - 1).chain([MAX]);
    table.iter().zip(ends).map(move |(entry, end)| (entry >> bits, end, entry & ((1 << bits) - 1)))
}

/// The code points whose General_Category is one of `mask`.
fn general_category(mask: u32) -> CharSet {
    CharSet::from_ranges(
        partition(tables::GENERAL_CATEGORY, 5)
            .filter(|(_, _, category)| mask & (1 << *category) != 0)
            .map(|(lo, hi, _)| (lo, hi))
            .collect(),
    )
}

fn script(script: u8) -> CharSet {
    CharSet::from_ranges(
        partition(tables::SCRIPT, 8)
            .filter(|(_, _, value)| *value == u32::from(script))
            .map(|(lo, hi, _)| (lo, hi))
            .collect(),
    )
}

fn script_extensions(wanted: u8) -> CharSet {
    let mut with = Vec::new();
    let mut without = Vec::new();
    for pair in tables::SCRIPT_EXTENSIONS.chunks_exact(2) {
        let [first, hi] = *pair else { continue };
        let (lo, set) = (first >> 11, (first & 0x7FF) as usize);
        let bounds = (tables::SCRIPT_SET_OFFSETS.get(set), tables::SCRIPT_SET_OFFSETS.get(set + 1));
        let (Some(from), Some(to)) = bounds else { continue };
        let scripts = tables::SCRIPT_SETS.get(usize::from(*from)..usize::from(*to));
        if strings::contains_char(scripts.unwrap_or_default(), wanted) {
            with.push((lo, hi));
        } else {
            without.push((lo, hi));
        }
    }
    let mut set = script(wanted).difference(&CharSet::from_ranges(without));
    set.add_all(&with);
    set
}

fn binary(property: u8) -> Option<CharSet> {
    let property = usize::from(property);
    let from = usize::from(*tables::BINARY_OFFSETS.get(property)?);
    let to = usize::from(*tables::BINARY_OFFSETS.get(property + 1)?);
    let flipped = CharSet::from_toggles(tables::BINARY_TOGGLES.get(from..to)?);
    Some(general_category(*tables::BINARY_MASKS.get(property)?).symmetric_difference(&flipped))
}

/// The code points that `\p{key=value}`, or `\p{key}`, matches. `None` if the tables do not have the
/// property, which the version of Unicode they were made from does not know.
pub(super) fn property(key: &[u8], value: Option<&[u8]>) -> Option<CharSet> {
    const UNSUPPORTED: u8 = 255;
    let Some(value) = value else {
        let (_, property) = versioned(tables::BINARY_NAMES, tables::BINARY_VALUES, key)?;
        return binary(property);
    };
    if is_general_category(key) {
        let index = index_of_name(tables::GENERAL_CATEGORY_NAMES, value)?;
        return Some(general_category(*tables::GENERAL_CATEGORY_MASKS.get(index)?));
    }
    let (_, index) = versioned(tables::SCRIPT_NAMES, tables::SCRIPT_VALUES, value)?;
    if index == UNSUPPORTED {
        return None;
    }
    Some(if matches!(key, b"Script" | b"sc") { script(index) } else { script_extensions(index) })
}

/// What `\p{name}` matches with the `v` flag, for a property of strings: the strings of one code point
/// as a set, and the others.
pub(super) fn property_of_strings(name: &[u8]) -> (CharSet, Vec<Vec<u32>>) {
    const VARIATION_SELECTOR: u32 = 0xFE0F;
    const TONES: std::ops::RangeInclusive<u32> = 0x1F3FB..=0x1F3FF;
    const ANY_TONE: u8 = 255;
    let members = |toggles: &[u32]| {
        let set = CharSet::from_toggles(toggles);
        set.ranges().iter().flat_map(|(lo, hi)| *lo..=*hi).collect::<Vec<u32>>()
    };
    let wants = |part: &[u8]| name == part || name == b"RGI_Emoji";
    let mut chars = CharSet::new();
    let mut strings = Vec::new();
    if wants(b"Basic_Emoji") {
        chars = CharSet::from_toggles(tables::EMOJI_BASIC);
        let bases = members(tables::EMOJI_BASIC_WITH_VARIATION_SELECTOR);
        strings.extend(bases.into_iter().map(|c| vec![c, VARIATION_SELECTOR]));
    }
    if wants(b"Emoji_Keycap_Sequence") {
        strings.extend(b"#*0123456789".iter().map(|c| vec![u32::from(*c), VARIATION_SELECTOR, 0x20E3]));
    }
    if wants(b"RGI_Emoji_Flag_Sequence") {
        for (first, mask) in (0x1F1E6..).zip(tables::EMOJI_FLAGS) {
            let seconds = (0..26u32).filter(|second| *mask & (1 << *second) != 0);
            strings.extend(seconds.map(|second| vec![first, 0x1F1E6 + second]));
        }
    }
    if wants(b"RGI_Emoji_Modifier_Sequence") {
        for base in members(tables::EMOJI_MODIFIER_BASES) {
            strings.extend(TONES.map(|tone| vec![base, tone]));
        }
    }
    if wants(b"RGI_Emoji_Tag_Sequence") {
        let mut tags = strings::split(tables::EMOJI_TAGS, b" ");
        while let Some(tag) = tags.next() {
            let tag = tag.iter().map(|c| 0xE0000 + u32::from(*c));
            strings.push([0x1F3F4].into_iter().chain(tag).chain([0xE007F]).collect());
        }
    }
    if wants(b"RGI_Emoji_ZWJ_Sequence") {
        let mut rest = tables::EMOJI_ZWJ_SEQUENCES;
        while let Some((len, tail)) = rest.split_first()
            && let Some((sequence, tail)) = tail.split_at_checked(usize::from(*len))
        {
            rest = tail;
            let mut expanded: Vec<Vec<u32>> = vec![Vec::new()];
            for letter in sequence {
                if *letter == ANY_TONE {
                    expanded = (expanded.iter())
                        .flat_map(|head| TONES.map(move |tone| [&head[..], &[tone][..]].concat()))
                        .collect();
                } else if let Some(c) = tables::EMOJI_ZWJ_ALPHABET.get(usize::from(*letter)) {
                    expanded.iter_mut().for_each(|string| string.push(*c));
                }
            }
            strings.append(&mut expanded);
        }
    }
    (chars, strings)
}

/// A run of code points, `stride` apart, that are each `delta` away from the least of the code
/// points that they are equal to when case is ignored.
#[derive(Copy, Clone)]
struct Fold {
    first: u32,
    last: u32,
    stride: u32,
    delta: i32,
}

impl Fold {
    /// The part of the run in `lo..=hi`.
    fn clamp(self, lo: u32, hi: u32) -> Option<(u32, u32)> {
        let lo = lo.max(self.first);
        let lo = lo + (lo - self.first) % self.stride;
        let hi = hi.min(self.last);
        (lo <= hi).then(|| (lo, hi - (hi - self.first) % self.stride))
    }

    /// Adds `lo..=hi`, a part of the run moved by `delta`, to `out`.
    fn push(self, (lo, hi): (u32, u32), delta: i32, out: &mut Vec<(u32, u32)>) {
        let moved = |cp: u32| cp.wrapping_add_signed(delta);
        if self.stride == 1 {
            out.push((moved(lo), moved(hi)));
        } else {
            out.extend((lo..=hi).step_by(self.stride as usize).map(|cp| (moved(cp), moved(cp))));
        }
    }
}

fn folds(unicode: bool) -> impl Iterator<Item = Fold> {
    fold_table(unicode).chunks_exact(3).filter_map(fold_at)
}

fn fold_table(unicode: bool) -> &'static [i32] {
    if unicode { tables::FOLD_UNICODE } else { tables::FOLD_LEGACY }
}

fn fold_at(triple: &[i32]) -> Option<Fold> {
    let [first, last, delta] = *triple else { return None };
    Some(Fold {
        first: first as u32,
        last: (last >> 1) as u32,
        stride: 1 + (last & 1) as u32,
        delta,
    })
}

/// The specification's `Canonicalize`, but for which of the equal characters is returned: two
/// characters are equal when case is ignored if this is the same for both. `unicode` is whether the
/// regular expression has the `u` or the `v` flag.
pub(super) fn canonicalize(cp: u32, unicode: bool) -> u32 {
    if cp < 0x80 {
        return if (0x61..=0x7A).contains(&cp) { cp - 0x20 } else { cp };
    }
    let table = fold_table(unicode);
    let count = table.len() / 3;
    let (mut lo, mut hi) = (0, count);
    while lo < hi {
        let mid = usize::midpoint(lo, hi);
        let Some(fold) = table.get(mid * 3..mid * 3 + 3).and_then(fold_at) else { return cp };
        if cp < fold.first {
            hi = mid;
        } else if cp > fold.last {
            lo = mid + 1;
        } else if (cp - fold.first) % fold.stride == 0 {
            return cp.wrapping_add_signed(fold.delta);
        } else {
            return cp;
        }
    }
    cp
}

/// Adds the characters that are equal to one of `set` when case is ignored.
pub(super) fn close_over_case(set: &mut CharSet, unicode: bool) {
    let mut found = Vec::new();
    for fold in folds(unicode) {
        for (lo, hi) in set.overlapping(fold.first, fold.last) {
            if let Some(part) = fold.clamp(lo, hi) {
                fold.push(part, fold.delta, &mut found);
            }
        }
    }
    set.add_all(&found);
    found.clear();
    for fold in folds(unicode) {
        let moved = |cp: u32| cp.wrapping_add_signed(fold.delta);
        for (lo, hi) in set.overlapping(moved(fold.first), moved(fold.last)) {
            let back = |cp: u32| cp.wrapping_add_signed(-fold.delta);
            let lo = back(lo.max(moved(fold.first)));
            let hi = back(hi.min(moved(fold.last)));
            if let Some(part) = fold.clamp(lo, hi) {
                fold.push(part, 0, &mut found);
            }
        }
    }
    set.add_all(&found);
}

/// `\s`
pub(super) fn space() -> CharSet {
    CharSet::from_ranges(vec![
        (0x09, 0x0D),
        (0x20, 0x20),
        (0xA0, 0xA0),
        (0x1680, 0x1680),
        (0x2000, 0x200A),
        (0x2028, 0x2029),
        (0x202F, 0x202F),
        (0x205F, 0x205F),
        (0x3000, 0x3000),
        (0xFEFF, 0xFEFF),
    ])
}

/// `\d`
pub(super) fn digit() -> CharSet {
    CharSet::from_ranges(vec![(0x30, 0x39)])
}

/// `\w`
pub(super) fn word() -> CharSet {
    CharSet::from_ranges(vec![(0x30, 0x39), (0x41, 0x5A), (0x5F, 0x5F), (0x61, 0x7A)])
}

/// What `.` does not match without the `s` flag.
pub(super) fn line_terminators() -> CharSet {
    CharSet::from_ranges(vec![(0x0A, 0x0A), (0x0D, 0x0D), (0x2028, 0x2029)])
}
