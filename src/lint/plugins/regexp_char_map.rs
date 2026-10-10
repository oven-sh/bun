#![allow(dead_code)] // until every rule of the plugin is written
//! refa's `char-map` and `char-base`.

use crate::regexp_char_set::{Char, CharRange, CharSet};
use bun_collections::ArrayHashMap;
use bun_lint::utils::sort;
use std::hash::Hash;

#[derive(Clone)]
struct Item<T> {
    range: CharRange,
    value: T,
}

/// From characters to values. The ranges are ascending, and no two that touch have equal values.
/// `==` of `T` is upstream's `===`, `clone()` its `copy()` without a function.
#[derive(Clone)]
pub(crate) struct CharMap<T> {
    array: Vec<Item<T>>,
}

impl<T: Clone + PartialEq> CharMap<T> {
    pub(crate) fn new() -> CharMap<T> {
        CharMap { array: Vec::new() }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.array.is_empty()
    }

    /// The number of characters.
    pub(crate) fn size(&self) -> u32 {
        self.array
            .iter()
            .map(|item| item.range.max - item.range.min + 1)
            .sum()
    }

    /// The number of ranges.
    pub(crate) fn entry_count(&self) -> usize {
        self.array.len()
    }

    fn index_of(&self, c: Char) -> Option<usize> {
        let (mut l, mut h) = (0, self.array.len());
        while l < h {
            let m = l + ((h - l) >> 2);
            let r = self.array.get(m)?.range;
            if c < r.min {
                h = m;
            } else if c > r.max {
                l = m + 1;
            } else {
                return Some(m);
            }
        }
        None
    }

    /// The item that has `c`, else the nearest one to the left of it.
    fn index_of_or_left(&self, c: Char) -> Option<usize> {
        let (mut l, mut h) = (0, self.array.len());
        while l < h {
            let m = l + ((h - l) >> 2);
            let r = self.array.get(m)?.range;
            if c < r.min {
                h = m;
            } else if c > r.max {
                if self.array.get(m + 1).is_none_or(|next| c < next.range.min) {
                    return Some(m);
                }
                l = m + 1;
            } else {
                return Some(m);
            }
        }
        None
    }

    /// The item that has `c`, else the nearest one to the right of it.
    fn index_of_or_right(&self, c: Char) -> Option<usize> {
        if self.array.is_empty() {
            return None;
        }
        let Some(left) = self.index_of_or_left(c) else {
            return Some(0);
        };
        if c > self.array.get(left)?.range.max {
            (left + 1 < self.array.len()).then_some(left + 1)
        } else {
            Some(left)
        }
    }

    /// The first and the last of the items that have a character of `range`.
    fn index_in_range(&self, range: CharRange) -> Option<std::ops::RangeInclusive<usize>> {
        let start = self.index_of_or_right(range.min)?;
        let stop = self.index_of_or_left(range.max)?;
        (start <= stop).then_some(start..=stop)
    }

    /// No character of `range` is in the map.
    fn insert(&mut self, range: CharRange, value: T) {
        if self
            .array
            .last()
            .is_none_or(|last| last.range.max + 1 < range.min)
        {
            self.array.push(Item { range, value });
            return;
        }

        let Some(left) = self.index_of_or_left(range.min) else {
            if let Some(first) = self.array.first_mut()
                && first.range.min == range.max + 1
                && first.value == value
            {
                first.range.min = range.min;
            } else {
                self.array.insert(0, Item { range, value });
            }
            return;
        };

        let right = left + 1;
        if right == self.array.len() {
            if let Some(last) = self.array.get_mut(left)
                && last.range.max + 1 == range.min
                && last.value == value
            {
                last.range.max = range.max;
            } else {
                self.array.push(Item { range, value });
            }
            return;
        }

        let joins_left = self
            .array
            .get(left)
            .is_some_and(|item| item.range.max + 1 == range.min && item.value == value);
        let joins_right = self
            .array
            .get(right)
            .is_some_and(|item| item.range.min == range.max + 1 && item.value == value);
        if joins_right {
            if joins_left {
                let right_item = self.array.remove(right);
                if let Some(left_item) = self.array.get_mut(left) {
                    left_item.range.max = right_item.range.max;
                }
            } else if let Some(right_item) = self.array.get_mut(right) {
                right_item.range.min = range.min;
            }
        } else if joins_left {
            if let Some(left_item) = self.array.get_mut(left) {
                left_item.range.max = range.max;
            }
        } else {
            self.array.insert(right, Item { range, value });
        }
    }

    pub(crate) fn has(&self, c: Char) -> bool {
        self.index_of(c).is_some()
    }

    /// As upstream: only gaps BETWEEN the items that `chars` meets are seen, none at its ends.
    pub(crate) fn has_every(&self, chars: CharRange) -> bool {
        let Some(met) = self.index_in_range(chars) else {
            return false;
        };
        let items = self.array.get(met).unwrap_or_default();
        items
            .iter()
            .zip(items.iter().skip(1))
            .all(|(item, next)| item.range.max + 1 == next.range.min)
    }

    pub(crate) fn has_some(&self, chars: CharRange) -> bool {
        self.index_in_range(chars).is_some()
    }

    pub(crate) fn get(&self, c: Char) -> Option<&T> {
        Some(&self.array.get(self.index_of(c)?)?.value)
    }

    pub(crate) fn set(&mut self, c: Char, value: T) {
        self.delete(c);
        self.insert(CharRange { min: c, max: c }, value);
    }

    pub(crate) fn set_range(&mut self, chars: CharRange, value: T) {
        self.delete_range(chars);
        self.insert(chars, value);
    }

    pub(crate) fn set_char_set(&mut self, char_set: &CharSet, value: &T) {
        if !self.array.is_empty() {
            for range in char_set.ranges() {
                self.delete_range(*range);
            }
        }

        if self.array.is_empty() {
            self.array
                .extend(char_set.ranges().iter().map(|range| Item {
                    range: *range,
                    value: value.clone(),
                }));
        } else {
            for range in char_set.ranges() {
                self.insert(*range, value.clone());
            }
        }
    }

    pub(crate) fn delete(&mut self, c: Char) -> bool {
        let Some(index) = self.index_of(c) else {
            return false;
        };
        let Some(item) = self.array.get_mut(index) else {
            return false;
        };
        let CharRange { min, max } = item.range;
        if min == max {
            self.array.remove(index);
        } else if min == c {
            item.range.min = min + 1;
        } else if max == c {
            item.range.max = max - 1;
        } else {
            let after = Item {
                range: CharRange { min: c + 1, max },
                value: item.value.clone(),
            };
            item.range.max = c - 1;
            self.array.insert(index + 1, after);
        }
        true
    }

    pub(crate) fn delete_range(&mut self, range: CharRange) {
        let Some(met) = self.index_in_range(range) else {
            return;
        };
        let (mut start, mut stop) = (*met.start(), *met.end());

        if start == stop {
            let Some(item) = self.array.get_mut(start) else {
                return;
            };
            let CharRange { min, max } = item.range;
            if range.min <= min && max <= range.max {
                self.array.remove(start);
            } else if min < range.min && range.max < max {
                let after = Item {
                    range: CharRange {
                        min: range.max + 1,
                        max,
                    },
                    value: item.value.clone(),
                };
                // Upstream's `+ 1`, where `- 1` is meant: `range.min` and the next character stay.
                item.range.max = range.min + 1;
                self.array.insert(start + 1, after);
            } else if range.max < max {
                item.range.min = range.max + 1;
            } else {
                item.range.max = range.min - 1;
            }
        } else {
            if let Some(first) = self.array.get_mut(start)
                && first.range.min < range.min
            {
                first.range.max = range.min - 1;
                start += 1;
            }
            if let Some(last) = self.array.get_mut(stop)
                && last.range.max > range.max
            {
                last.range.min = range.max + 1;
                stop -= 1;
            }
            self.array.drain(start..=stop);
        }
    }

    pub(crate) fn clear(&mut self) {
        self.array.clear();
    }

    /// upstream's `copy(mapFn)`
    pub(crate) fn copy_with<U: Clone + PartialEq>(
        &self,
        map_fn: &mut dyn FnMut(&T) -> U,
    ) -> CharMap<U> {
        let mut map: CharMap<U> = CharMap {
            array: self
                .array
                .iter()
                .map(|item| Item {
                    range: item.range,
                    value: map_fn(&item.value),
                })
                .collect(),
        };
        map.merge_adjacent();
        map
    }

    pub(crate) fn map(&mut self, map_fn: &mut dyn FnMut(&T, CharRange) -> T) {
        for item in &mut self.array {
            item.value = map_fn(&item.value, item.range);
        }
        self.merge_adjacent();
    }

    fn merge_adjacent(&mut self) {
        self.array.dedup_by(|item, prev| {
            let same = prev.range.max + 1 == item.range.min && prev.value == item.value;
            if same {
                prev.range.max = item.range.max;
            }
            same
        });
    }

    pub(crate) fn filter(&mut self, condition_fn: &mut dyn FnMut(&T, CharRange) -> bool) {
        self.array
            .retain(|item| condition_fn(&item.value, item.range));
    }

    /// From the values to their characters, in the order in which the values come first.
    pub(crate) fn invert(&self, max_character: Char) -> Vec<(T, CharSet)>
    where
        T: Eq + Hash,
    {
        let mut range_map: ArrayHashMap<&T, Vec<CharRange>> = ArrayHashMap::new();
        for item in &self.array {
            range_map.entry(&item.value).or_default().push(item.range);
        }
        range_map
            .iter()
            .map(|(value, ranges)| {
                let set = CharSet::empty(max_character).union_ranges(ranges);
                ((*value).clone(), set)
            })
            .collect()
    }

    pub(crate) fn for_each(&self, callback: &mut dyn FnMut(&T, CharRange)) {
        for item in &self.array {
            callback(&item.value, item.range);
        }
    }

    pub(crate) fn keys(&self) -> impl Iterator<Item = CharRange> {
        self.array.iter().map(|item| item.range)
    }

    pub(crate) fn values(&self) -> impl Iterator<Item = &T> {
        self.array.iter().map(|item| &item.value)
    }

    /// Ascending.
    pub(crate) fn entries(&self) -> impl Iterator<Item = (CharRange, &T)> {
        self.array.iter().map(|item| (item.range, &item.value))
    }
}

/// Disjoint sets, none empty, as few as can be, of which each set that it is made from is a union.
pub(crate) struct CharBase {
    pub(crate) sets: Vec<CharSet>,
}

impl CharBase {
    /// All of `char_sets` have one maximum. Their order and a set that comes twice change nothing.
    pub(crate) fn new(char_sets: &[CharSet]) -> CharBase {
        CharBase {
            sets: get_base_sets(char_sets),
        }
    }

    /// The indexes, ascending, of the base sets that `char_set` is the union of.
    pub(crate) fn split(&self, char_set: &CharSet) -> Vec<usize> {
        let mut indexes = Vec::new();
        for (i, set) in self.sets.iter().enumerate() {
            if set
                .ranges()
                .first()
                .is_some_and(|first| char_set.has(first.min))
            {
                indexes.push(i);
            }
        }
        indexes
    }
}

/// upstream's `getBaseSets`
fn get_base_sets(char_sets: &[CharSet]) -> Vec<CharSet> {
    let mut sets: Vec<CharSet> = char_sets
        .iter()
        .filter(|set| !set.is_empty())
        .cloned()
        .collect();
    sort::sort_by(&mut sets, CharSet::compare);
    sets.dedup();

    let Some(maximum) = sets.first().map(CharSet::maximum) else {
        return sets;
    };
    if sets.len() == 1 {
        return sets;
    }

    let mut ranges: Vec<CharRange> = Vec::new();
    for set in &sets {
        ranges.extend_from_slice(set.ranges());
    }
    let union = CharSet::empty(maximum).union_ranges(&ranges);

    let mut sorted_cuts: Vec<Char> = Vec::with_capacity(ranges.len() * 2);
    for range in &ranges {
        sorted_cuts.push(range.min);
        sorted_cuts.push(range.max + 1);
    }
    sort::sort(&mut sorted_cuts);
    sorted_cuts.dedup();

    // The key: which of `sets` have the characters between two cuts.
    let mut base_ranges: ArrayHashMap<Vec<usize>, Vec<CharRange>> = ArrayHashMap::new();
    for (&min, &next) in sorted_cuts.iter().zip(sorted_cuts.iter().skip(1)) {
        if union.has(min) {
            let key: Vec<usize> = sets
                .iter()
                .enumerate()
                .filter(|(_, set)| set.has(min))
                .map(|(set_index, _)| set_index)
                .collect();
            let range = CharRange { min, max: next - 1 };
            base_ranges.entry(key).or_default().push(range);
        }
    }

    base_ranges
        .values()
        .iter()
        .map(|ranges| CharSet::empty(maximum).union_ranges(ranges))
        .collect()
}
