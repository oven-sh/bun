//! `utils/compare/*.ts`. Nothing is allocated unless a name has to change to be compared.

use super::SortingNode;
use super::groups::GroupId;
use super::options::{
    Alphabet, Configuration, GroupEntry, GroupNames, Locale, Order, SortBy, SortOptions, SortType,
    SpecialCharacters,
};
use bun_core::strings;
use bun_lint::prelude::*;
use std::borrow::Cow;
use std::cell::Cell;
use std::cmp::Ordering;

/// `computeComparators` applied to two nodes. `type: "unsorted"` has no comparators, so the fallback is not tried
/// either. A `localeCompare` with a [`Locale::Invalid`] sets `reached_invalid_locale`, where upstream throws.
pub(crate) fn compare(
    a: &SortingNode,
    b: &SortingNode,
    options: SortOptions,
    config: &Configuration,
    reached_invalid_locale: &Cell<bool>,
) -> Ordering {
    if options.type_ == SortType::Unsorted {
        return Ordering::Equal;
    }
    let main = compare_once(a, b, options, config, reached_invalid_locale);
    if main != Ordering::Equal {
        return main;
    }
    let fallback = options.fallback_sort;
    let with_fallback = SortOptions {
        type_: fallback.type_,
        order: fallback.order.unwrap_or(options.order),
        sort_by: fallback.sort_by.unwrap_or(options.sort_by),
        ..options
    };
    compare_once(a, b, with_fallback, config, reached_invalid_locale)
}

/// The comparator that `buildStringComparatorByOptionsComputer` picks for `options.type`, with
/// `nameOrValueComparatorByOptionsComputer`'s choice of the string to compare, and `computeOrderedValue` applied.
fn compare_once(
    a: &SortingNode,
    b: &SortingNode,
    options: SortOptions,
    config: &Configuration,
    reached_invalid_locale: &Cell<bool>,
) -> Ordering {
    let ascending = match options.type_ {
        SortType::Unsorted => return Ordering::Equal,
        SortType::SubgroupOrder => compare_by_subgroup_order(a, b, &config.groups),
        SortType::LineLength => a.size.cmp(&b.size),
        SortType::Alphabetical => match options.locale {
            Locale::Collator(collator) => {
                collator.compare(&text_to_compare(a, options), &text_to_compare(b, options))
            }
            Locale::Root => {
                strings::locale_compare(&text_to_compare(a, options), &text_to_compare(b, options))
            }
            Locale::Invalid => {
                reached_invalid_locale.set(true);
                return Ordering::Equal;
            }
        },
        SortType::Natural => match options.locale {
            Locale::Collator(collator) => text::natural_orderby_in(
                collator,
                &text_to_compare(a, options),
                &text_to_compare(b, options),
            ),
            Locale::Root => {
                text::natural_orderby(&text_to_compare(a, options), &text_to_compare(b, options))
            }
            Locale::Invalid => match text::natural_orderby_without_locale(
                &text_to_compare(a, options),
                &text_to_compare(b, options),
            ) {
                Some(order) => order,
                None => {
                    reached_invalid_locale.set(true);
                    return Ordering::Equal;
                }
            },
        },
        SortType::Custom => compare_by_custom_sort(
            &text_to_compare(a, options),
            &text_to_compare(b, options),
            &config.alphabet,
        ),
    };
    match options.order {
        Order::Asc => ascending,
        Order::Desc => ascending.reverse(),
    }
}

/// `nameOrValueComparatorByOptionsComputer`'s choice of string, formatted.
fn text_to_compare<'n>(node: &'n SortingNode<'_>, options: SortOptions) -> Cow<'n, [u8]> {
    let text = match options.sort_by {
        SortBy::Name => &*node.name,
        SortBy::Value => node.value,
    };
    format(text, options)
}

/// Upstream's `buildStringFormatter`: lower-cased if `ignoreCase`, then the special characters `specialCharacters`
/// says are dropped, then every `\s` character is dropped. Borrowed while nothing changes.
fn format<'t>(value: &'t [u8], options: SortOptions) -> Cow<'t, [u8]> {
    let mut text = match options.ignore_case {
        true => text::to_lower_case(value),
        false => Cow::Borrowed(value),
    };
    match options.special_characters {
        SpecialCharacters::Keep => {}
        SpecialCharacters::Trim => {
            let first_kept = match strings::wtf8_codepoints(&text)
                .find(|&(_, cp)| is_kept_special_character(cp))
            {
                Some((at, _)) => at,
                None => text.len(),
            };
            if first_kept > 0 {
                text = match text {
                    Cow::Borrowed(borrowed) => Cow::Borrowed(&borrowed[first_kept..]),
                    Cow::Owned(mut owned) => {
                        owned.drain(..first_kept);
                        Cow::Owned(owned)
                    }
                };
            }
        }
        SpecialCharacters::Remove => text = retain_code_points(text, is_kept_special_character),
    }
    retain_code_points(text, |cp| !strings::is_js_whitespace(cp))
}

/// `text.replaceAll(/<the code points that `keep` refuses>/gu, '')`: `text` itself while nothing is removed.
fn retain_code_points(text: Cow<'_, [u8]>, keep: impl Fn(u32) -> bool) -> Cow<'_, [u8]> {
    let Some((first_removed, _)) = strings::wtf8_codepoints(&text).find(|&(_, cp)| !keep(cp))
    else {
        return text;
    };
    let mut kept = Vec::with_capacity(text.len());
    kept.extend_from_slice(&text[..first_removed]);
    let mut at = first_removed;
    while at < text.len() {
        let (cp, size) = strings::wtf8_codepoint_at(&text, at);
        if keep(cp) {
            kept.extend_from_slice(&text[at..at + size]);
        }
        at += size;
    }
    Cow::Owned(kept)
}

/// What `/[^a-z\u{C0}-\u{24F}\u{1E00}-\u{1EFF}]+/giu` leaves. The `i` flag adds the IPA letters whose capitals are
/// in U+0180-U+024F, and the Kelvin and Angstrom signs.
fn is_kept_special_character(cp: u32) -> bool {
    matches!(
        cp,
        0x61..=0x7A
            | 0x41..=0x5A
            | 0xC0..=0x24F
            | 0x1E00..=0x1EFF
            | 0x253
            | 0x254
            | 0x256
            | 0x257
            | 0x259
            | 0x25B
            | 0x260
            | 0x263
            | 0x268
            | 0x269
            | 0x26F
            | 0x272
            | 0x275
            | 0x280
            | 0x283
            | 0x288..=0x28C
            | 0x292
            | 0x212A
            | 0x212B
            | 0x2C65
            | 0x2C66
            | 0x2C7E
            | 0x2C7F
            | 0xA7DC
    )
}

/// Upstream's `compareByCustomSort`: UTF-16 unit by unit, each ordered by its index in `alphabet`, one that is not
/// in it after every one that is; then the shorter text first.
fn compare_by_custom_sort(a: &[u8], b: &[u8], alphabet: &Alphabet) -> Ordering {
    let index_of = |unit: u16| alphabet.index_of.get(&u32::from(unit));
    let (mut a_units, mut b_units) = (utf16_units(a), utf16_units(b));
    loop {
        match (a_units.next(), b_units.next()) {
            (Some(a_unit), Some(b_unit)) => {
                let order = match (index_of(a_unit), index_of(b_unit)) {
                    (Some(a_index), Some(b_index)) => a_index.cmp(b_index),
                    (Some(_), None) => Ordering::Less,
                    (None, Some(_)) => Ordering::Greater,
                    (None, None) => Ordering::Equal,
                };
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(_), None) => return Ordering::Greater,
            (None, Some(_)) => return Ordering::Less,
            (None, None) => return Ordering::Equal,
        }
    }
}

/// The UTF-16 code units of `text`, which is what `value[i]` indexes: a code point outside the BMP is its two
/// surrogates.
fn utf16_units(text: &[u8]) -> impl Iterator<Item = u16> + '_ {
    let mut code_points = strings::wtf8_codepoints(text);
    let mut trail = None;
    std::iter::from_fn(move || {
        if let Some(unit) = trail.take() {
            return Some(unit);
        }
        let (_, cp) = code_points.next()?;
        if cp > 0xFFFF {
            let cp = cp - 0x10000;
            trail = Some(0xDC00 | (cp & 0x3FF) as u16);
            return Some(0xD800 | (cp >> 10) as u16);
        }
        Some(cp as u16)
    })
}

/// Upstream's `buildSubgroupOrderComparator`: two nodes of the same `["a", "b"]` entry of `groups` order as their
/// groups do in it; any other pair is equal.
fn compare_by_subgroup_order(a: &SortingNode, b: &SortingNode, groups: &[GroupEntry]) -> Ordering {
    let (Some((a_entry, subgroup)), Some((b_entry, _))) = (
        subgroup_containing(groups, a.group),
        subgroup_containing(groups, b.group),
    ) else {
        return Ordering::Equal;
    };
    if a_entry != b_entry {
        return Ordering::Equal;
    }
    let position = |group: GroupId| subgroup.iter().position(|&it| it == group);
    position(a.group).cmp(&position(b.group))
}

/// `computeSubgroupContainingNode`: the first array entry of `groups` that names `group`, with its index.
fn subgroup_containing(groups: &[GroupEntry], group: GroupId) -> Option<(usize, &[GroupId])> {
    groups.iter().enumerate().find_map(|(index, entry)| {
        let names = match entry {
            GroupEntry::Names(names) => names,
            GroupEntry::Overrides(overrides) => &overrides.names,
            GroupEntry::NewlinesBetween(_) => return None,
        };
        match names {
            GroupNames::Many(subgroup) if subgroup.contains(&group) => Some((index, &**subgroup)),
            GroupNames::Many(_) | GroupNames::One(_) => None,
        }
    })
}
