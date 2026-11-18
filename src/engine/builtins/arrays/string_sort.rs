//! The order of `sort` without a comparator: that of the code units of the elements as strings.

use bun_engine_text::{AllocError, Text, with_text};
use smallvec::SmallVec;

use super::radix_sort;

#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct Entry {
    pub(super) key: u64,
    pub(super) index: u32,
}

pub(super) fn try_collect<T>(
    items: impl ExactSizeIterator<Item = T>,
) -> Result<Vec<T>, AllocError> {
    let mut list = Vec::new();
    list.try_reserve_exact(items.len())
        .map_err(|_| AllocError)?;
    list.extend(items);
    Ok(list)
}

/// There are fewer than 2^32 keys.
pub(super) fn entries_for(
    keys: impl ExactSizeIterator<Item = u64>,
) -> Result<Vec<Entry>, AllocError> {
    try_collect(keys.enumerate().map(|(index, key)| Entry {
        key,
        index: index as u32,
    }))
}

/// Up to here, comparing whole texts is cheaper than a round of keys.
const SMALL_GROUP: usize = 5;

/// The next units of the text, and in the low byte how many it has left, as far as that matters.
#[inline(always)]
fn key<const UNIT_BITS: usize>(text: Text<'_>, depth: usize) -> u64 {
    if let (8, Text::Latin1(characters)) = (UNIT_BITS, text) {
        return key_of_latin1(&characters[depth..]);
    }
    let units_in_key = 56 / UNIT_BITS;
    with_text!(text.slice_from(depth), |rest| {
        let mut key = rest.len().min(units_in_key + 1) as u64;
        for (position, &unit) in (1..).zip(rest.iter().take(units_in_key)) {
            key |= u64::from(unit) << (64 - position * UNIT_BITS);
        }
        key
    })
}

#[inline(always)]
fn key_of_latin1(rest: &[u8]) -> u64 {
    let length = rest.len();
    if let Some(&bytes) = rest.first_chunk() {
        u64::from_be_bytes(bytes) & !0xff | 8
    } else if let (Some(&first), Some(&last)) = (rest.first_chunk(), rest.last_chunk()) {
        let [first, last] = [first, last].map(|it| u64::from(u32::from_be_bytes(it)));
        first << 32 | last << (64 - length * 8) | length as u64
    } else {
        let bytes = rest.iter().fold(0, |all, &byte| all << 8 | u64::from(byte));
        bytes.rotate_right(length as u32 * 8) | length as u64
    }
}

fn insertion_sort(group: &mut [Entry], texts: &[Text<'_>], depth: usize) {
    let rest = |entry: Entry| texts[entry.index as usize].slice_from(depth);
    for next in 1..group.len() {
        let (entry, mut place) = (group[next], next);
        let text = rest(entry);
        while place != 0 && text < rest(group[place - 1]) {
            group[place] = group[place - 1];
            place -= 1;
        }
        group[place] = entry;
    }
}

fn sort_entries<const UNIT_BITS: usize>(entries: &mut [Entry], texts: &[Text<'_>]) {
    let units_in_key = 56 / UNIT_BITS;
    // Groups of entries whose texts are the same up to a depth, and whose indices ascend.
    let mut pending = SmallVec::<[_; 8]>::new();
    pending.push((0..entries.len(), 0));
    while let Some((range, mut depth)) = pending.pop() {
        let start = range.start;
        let group = &mut entries[range];
        let text = |entry: &Entry| texts[entry.index as usize];
        let mut shared = text(&group[0]).slice_from(depth);
        for entry in &group[1..] {
            if shared.is_empty() {
                break;
            }
            shared = shared.slice(0..shared.common_prefix_len(text(entry).slice_from(depth)));
        }
        depth += shared.len();
        for entry in &mut *group {
            entry.key = key::<UNIT_BITS>(text(entry), depth);
        }
        radix_sort::sort(group, |entry| entry.key);
        let mut offset = start;
        for ties in group.chunk_by_mut(|a, b| a.key == b.key) {
            if ties.len() > 1 && usize::from(ties[0].key as u8) > units_in_key {
                if ties.len() <= SMALL_GROUP {
                    insertion_sort(ties, texts, depth + units_in_key);
                } else {
                    pending.push((offset..offset + ties.len(), depth + units_in_key));
                }
            }
            offset += ties.len();
        }
    }
}

/// An entry for each text, in their order. The indices of equal texts ascend.
pub(super) fn sort_texts(texts: &[Text<'_>]) -> Result<Vec<Entry>, AllocError> {
    let mut entries = entries_for(texts.iter().map(|_| 0))?;
    if texts.is_empty() {
        return Ok(entries);
    }
    if texts.iter().all(|text| text.is_latin1()) {
        sort_entries::<8>(&mut entries, texts);
    } else {
        sort_entries::<16>(&mut entries, texts);
    }
    Ok(entries)
}

pub(super) const FEW: usize = 8;

/// There are at most `FEW` items.
#[inline(always)]
pub(super) fn sort_few<'a, T: Copy>(items: &mut [T], text: impl Fn(usize) -> Text<'a>) {
    let mut texts = [Text::EMPTY; FEW];
    for next in 0..items.len() {
        let (item, text, mut place) = (items[next], text(next), next);
        while place != 0 && text < texts[place - 1] {
            (items[place], texts[place]) = (items[place - 1], texts[place - 1]);
            place -= 1;
        }
        (items[place], texts[place]) = (item, text);
    }
}

const MAX_DIGITS: usize = 10;
const POWERS_OF_TEN: [u64; MAX_DIGITS] = {
    let (mut powers, mut exponent) = ([1; MAX_DIGITS], 1);
    while exponent < MAX_DIGITS {
        powers[exponent] = powers[exponent - 1] * 10;
        exponent += 1;
    }
    powers
};
const IS_NOT_NEGATIVE: u64 = 1 << 63;

/// Compares as the decimal text does: the sign, the digits padded with zeros, and their number.
#[inline(always)]
pub(super) fn key_of_int32(number: i32) -> u64 {
    let magnitude = u64::from(number.unsigned_abs());
    let digits = bun_engine_number::decimal_length(magnitude);
    let sign = if number < 0 { 0 } else { IS_NOT_NEGATIVE };
    sign | (magnitude * POWERS_OF_TEN[MAX_DIGITS - digits]) << 4 | digits as u64
}

#[inline(always)]
pub(super) fn int32_of_key(key: u64) -> i32 {
    let digits = (key & 0xf) as usize;
    let magnitude = ((key & !IS_NOT_NEGATIVE) >> 4) / POWERS_OF_TEN[MAX_DIGITS - digits];
    if key & IS_NOT_NEGATIVE == 0 {
        (magnitude as i32).wrapping_neg()
    } else {
        magnitude as i32
    }
}
