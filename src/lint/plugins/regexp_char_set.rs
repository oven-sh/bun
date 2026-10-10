#![allow(dead_code)] // until every rule of the plugin is written
//! refa's `char-set`, `char-types`, `word-set`, `errors`, `js/maximum` and `words/readable`.

use bun_lint::utils::sort;
use std::cmp::Ordering;
use std::sync::Arc;

/// A UTF-16 code unit or a code point: the maximum of the set says which.
pub(crate) type Char = u32;
pub(crate) type Word = Vec<Char>;
/// No set in it is empty, and all have the same maximum.
pub(crate) type WordSet = Vec<CharSet>;

/// upstream's `Maximum.UTF16`
pub(crate) const MAX_UTF16: Char = 0xFFFF;
/// upstream's `Maximum.UNICODE`
pub(crate) const MAX_UNICODE: Char = 0x10FFFF;

/// What refa throws and a rule catches: `TooManyNodesError`, `MaxCharacterError`, "not supported".
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum RefaError {
    TooManyNodes,
    MaxCharacter,
    Unsupported,
}

/// All `x` with `min <= x <= max`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(crate) struct CharRange {
    pub(crate) min: Char,
    pub(crate) max: Char,
}

/// Ranges that are ascending, disjoint, not adjacent, at most `maximum`. `==` is upstream's `equals`.
/// No operation looks at the maximum of its argument: the result has the one of `self`.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub(crate) struct CharSet {
    maximum: Char,
    ranges: Arc<[CharRange]>,
}

impl CharSet {
    pub(crate) fn maximum(&self) -> Char {
        self.maximum
    }

    pub(crate) fn ranges(&self) -> &[CharRange] {
        &self.ranges
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }

    pub(crate) fn is_all(&self) -> bool {
        self.equals_range(CharRange {
            min: 0,
            max: self.maximum,
        })
    }

    pub(crate) fn size(&self) -> u32 {
        self.ranges.iter().map(|it| it.max - it.min + 1).sum()
    }

    /// Also upstream's `newRanges.length === 0 ? CharSet.empty(maximum) : ..`.
    fn new(maximum: Char, ranges: Vec<CharRange>) -> CharSet {
        if ranges.is_empty() {
            return CharSet::empty(maximum);
        }
        CharSet {
            maximum,
            ranges: Arc::from(ranges),
        }
    }

    /// Ascending, each once.
    pub(crate) fn characters(&self) -> impl Iterator<Item = Char> {
        self.ranges.iter().flat_map(|it| it.min..=it.max)
    }

    pub(crate) fn empty(maximum: Char) -> CharSet {
        CharSet {
            maximum,
            ranges: Arc::default(),
        }
    }

    pub(crate) fn all(maximum: Char) -> CharSet {
        CharSet::from_range(
            maximum,
            CharRange {
                min: 0,
                max: maximum,
            },
        )
    }

    /// `characters` are ascending and at most `maximum`.
    pub(crate) fn from_characters(maximum: Char, characters: &[Char]) -> CharSet {
        CharSet::new(maximum, run_encode_characters(characters))
    }

    pub(crate) fn from_range(maximum: Char, range: CharRange) -> CharSet {
        CharSet {
            maximum,
            ranges: Arc::from([range]),
        }
    }

    pub(crate) fn from_character(maximum: Char, c: Char) -> CharSet {
        CharSet::from_range(maximum, CharRange { min: c, max: c })
    }

    pub(crate) fn equals_range(&self, other: CharRange) -> bool {
        *self.ranges == [other]
    }

    /// A total order in which disjoint sets stand by their smallest character.
    pub(crate) fn compare(&self, other: &CharSet) -> Ordering {
        if self.maximum != other.maximum {
            return self.maximum.cmp(&other.maximum);
        }
        let (Some(this_first), Some(other_first)) = (self.ranges.first(), other.ranges.first())
        else {
            // The empty set is the least.
            return other.is_empty().cmp(&self.is_empty());
        };
        if this_first.min != other_first.min {
            return this_first.min.cmp(&other_first.min);
        }
        if self.ranges.len() != other.ranges.len() {
            return self.ranges.len().cmp(&other.ranges.len());
        }
        for (this, that) in self.ranges.iter().zip(other.ranges.iter()) {
            if this.min != that.min {
                return this.min.cmp(&that.min);
            }
            if this.max != that.max {
                return this.max.cmp(&that.max);
            }
        }
        Ordering::Equal
    }

    /// The ranges of `self.intersect_range(CharRange { min: 0, max: new_maximum })`.
    pub(crate) fn resize(&self, new_maximum: Char) -> CharSet {
        let Some(last) = self.ranges.last() else {
            return CharSet::empty(new_maximum);
        };
        if new_maximum >= self.maximum || last.max <= new_maximum {
            return CharSet {
                maximum: new_maximum,
                ranges: Arc::clone(&self.ranges),
            };
        }
        let kept = CharRange {
            min: 0,
            max: new_maximum,
        };
        CharSet::new(new_maximum, intersect_ranges(&self.ranges, &[kept]))
    }

    pub(crate) fn negate(&self) -> CharSet {
        CharSet::new(self.maximum, negate_ranges(&self.ranges, self.maximum))
    }

    pub(crate) fn union(&self, other: &CharSet) -> CharSet {
        if other.ranges.is_empty() {
            return self.clone();
        }
        CharSet::new(self.maximum, union_ranges(&self.ranges, &other.ranges))
    }

    /// upstream's `union(...data)` of sets.
    pub(crate) fn union_all(&self, data: &[CharSet]) -> CharSet {
        if let [first] = data {
            return self.union(first);
        }
        let mut new_ranges = self.ranges.to_vec();
        for set in data {
            new_ranges.extend_from_slice(&set.ranges);
        }
        optimize_ranges(&mut new_ranges);
        CharSet::new(self.maximum, new_ranges)
    }

    /// upstream's `union(ranges)` of an iterable: in any order, overlapping or not.
    pub(crate) fn union_ranges(&self, ranges: &[CharRange]) -> CharSet {
        let mut new_ranges = self.ranges.to_vec();
        new_ranges.extend_from_slice(ranges);
        optimize_ranges(&mut new_ranges);
        CharSet::new(self.maximum, new_ranges)
    }

    pub(crate) fn intersect(&self, other: &CharSet) -> CharSet {
        CharSet::new(self.maximum, intersect_ranges(&self.ranges, &other.ranges))
    }

    pub(crate) fn intersect_range(&self, other: CharRange) -> CharSet {
        CharSet::new(self.maximum, intersect_ranges(&self.ranges, &[other]))
    }

    pub(crate) fn without(&self, other: &CharSet) -> CharSet {
        CharSet::new(self.maximum, without_ranges(&self.ranges, &other.ranges))
    }

    pub(crate) fn without_range(&self, other: CharRange) -> CharSet {
        CharSet::new(self.maximum, without_ranges(&self.ranges, &[other]))
    }

    pub(crate) fn has(&self, character: Char) -> bool {
        has_every_of_range(&self.ranges, character, character)
    }

    /// `self ⊇ other`
    pub(crate) fn is_superset_of(&self, other: &CharSet) -> bool {
        let (mut this_ranges, mut other_ranges) = (self.ranges.iter(), other.ranges.iter());
        let (mut this_item, mut other_item) = (this_ranges.next(), other_ranges.next());
        while let (Some(this), Some(that)) = (this_item, other_item) {
            if this.min <= that.min && this.max >= that.max {
                other_item = other_ranges.next();
            } else if this.max < that.min {
                this_item = this_ranges.next();
            } else {
                return false;
            }
        }
        other_item.is_none()
    }

    pub(crate) fn is_superset_of_range(&self, other: CharRange) -> bool {
        has_every_of_range(&self.ranges, other.min, other.max)
    }

    /// `self ⊆ other`
    pub(crate) fn is_subset_of(&self, other: &CharSet) -> bool {
        other.is_superset_of(self)
    }

    pub(crate) fn is_subset_of_range(&self, other: CharRange) -> bool {
        match (self.ranges.first(), self.ranges.last()) {
            (Some(first), Some(last)) => other.min <= first.min && last.max <= other.max,
            _ => true,
        }
    }

    /// `self ⊃ other`
    pub(crate) fn is_proper_superset_of(&self, other: &CharSet) -> bool {
        self.is_superset_of(other) && self != other
    }

    /// `self ⊂ other`
    pub(crate) fn is_proper_subset_of(&self, other: &CharSet) -> bool {
        self.is_subset_of(other) && self != other
    }

    pub(crate) fn is_disjoint_with(&self, other: &CharSet) -> bool {
        self.common_character(other).is_none()
    }

    pub(crate) fn is_disjoint_with_range(&self, other: CharRange) -> bool {
        self.common_character_range(other).is_none()
    }

    /// The smallest character that is in both.
    pub(crate) fn common_character(&self, other: &CharSet) -> Option<Char> {
        let (mut this_ranges, mut other_ranges) = (self.ranges.iter(), other.ranges.iter());
        let (mut this_item, mut other_item) = (this_ranges.next(), other_ranges.next());
        while let (Some(this), Some(that)) = (this_item, other_item) {
            if that.max < this.min {
                other_item = other_ranges.next();
            } else if this.max < that.min {
                this_item = this_ranges.next();
            } else {
                return Some(Char::max(this.min, that.min));
            }
        }
        None
    }

    /// ANY character that is in both: see `common_character_of_range`.
    pub(crate) fn common_character_range(&self, other: CharRange) -> Option<Char> {
        common_character_of_range(&self.ranges, other.min, other.max)
    }
}

/// upstream's `hasEveryOfRange`
fn has_every_of_range(ranges: &[CharRange], min: Char, max: Char) -> bool {
    let index = ranges.partition_point(|it| it.max < min);
    ranges
        .get(index)
        .is_some_and(|it| it.min <= min && max <= it.max)
}

/// upstream's `commonCharacterOfRange`. Which one it finds depends on where the search looks first,
/// and a message shows it (`pick_most_readable_character`): the halving is upstream's.
fn common_character_of_range(ranges: &[CharRange], min: Char, max: Char) -> Option<Char> {
    if max < ranges.first()?.min || min > ranges.last()?.max {
        return None;
    }
    let (mut low, mut high) = (0, ranges.len());
    while low < high {
        let m = low + ((high - low) >> 1);
        let m_range = ranges.get(m)?;
        match m_range.min.cmp(&min) {
            Ordering::Equal => return Some(min),
            Ordering::Less => {
                if min <= m_range.max {
                    return Some(min);
                }
                low = m + 1;
            }
            Ordering::Greater => {
                if m_range.min <= max {
                    return Some(m_range.min);
                }
                high = m;
            }
        }
    }
    None
}

/// upstream's `intersectRanges`
fn intersect_ranges(a: &[CharRange], b: &[CharRange]) -> Vec<CharRange> {
    let mut new_ranges = Vec::new();
    let (mut a, mut b) = (a.iter(), b.iter());
    let (mut a_range, mut b_range) = (a.next(), b.next());
    while let (Some(this), Some(that)) = (a_range, b_range) {
        if this.max < that.min {
            a_range = a.next();
            continue;
        }
        if that.max < this.min {
            b_range = b.next();
            continue;
        }
        new_ranges.push(CharRange {
            min: Char::max(this.min, that.min),
            max: Char::min(this.max, that.max),
        });
        if this.max <= that.max {
            a_range = a.next();
        }
        if that.max <= this.max {
            b_range = b.next();
        }
    }
    new_ranges
}

/// upstream's `unionRanges`
fn union_ranges(a: &[CharRange], b: &[CharRange]) -> Vec<CharRange> {
    let mut new_ranges = Vec::with_capacity(a.len() + b.len());
    let (mut a, mut b) = (a.iter().copied(), b.iter().copied());
    let (mut a_range, mut b_range) = (a.next(), b.next());
    while let (Some(this), Some(that)) = (a_range, b_range) {
        if this.min <= that.min {
            new_ranges.push(this);
            a_range = a.next();
        } else {
            new_ranges.push(that);
            b_range = b.next();
        }
    }
    new_ranges.extend(a_range.into_iter().chain(a));
    new_ranges.extend(b_range.into_iter().chain(b));
    optimize_sorted_ranges(&mut new_ranges);
    new_ranges
}

/// upstream's `withoutRanges`
fn without_ranges(a: &[CharRange], b: &[CharRange]) -> Vec<CharRange> {
    let mut new_ranges = Vec::new();
    let (mut a, mut b) = (a.iter().copied(), b.iter().copied());
    let (mut a_range, mut b_range) = (a.next(), b.next());
    while let (Some(this), Some(that)) = (a_range, b_range) {
        if this.max < that.min {
            new_ranges.push(this);
            a_range = a.next();
        } else if that.max < this.min {
            b_range = b.next();
        } else {
            if this.min < that.min {
                new_ranges.push(CharRange {
                    min: this.min,
                    max: that.min - 1,
                });
            }
            if that.max < this.max {
                a_range = Some(CharRange {
                    min: that.max + 1,
                    max: this.max,
                });
                b_range = b.next();
            } else {
                a_range = a.next();
            }
        }
    }
    new_ranges.extend(a_range.into_iter().chain(a));
    new_ranges
}

/// upstream's `optimizeSortedRanges`: `ranges` are ascending by `min`.
fn optimize_sorted_ranges(ranges: &mut Vec<CharRange>) {
    ranges.dedup_by(|next, current| {
        if current.max >= next.max {
            true
        } else if next.min <= current.max + 1 {
            current.max = next.max;
            true
        } else {
            false
        }
    });
}

/// upstream's `optimizeRanges`
fn optimize_ranges(ranges: &mut Vec<CharRange>) {
    sort::sort_by_key(ranges, |it| it.min);
    optimize_sorted_ranges(ranges);
}

/// upstream's `negateRanges`
fn negate_ranges(ranges: &[CharRange], maximum: Char) -> Vec<CharRange> {
    let (Some(first), Some(last)) = (ranges.first(), ranges.last()) else {
        return vec![CharRange {
            min: 0,
            max: maximum,
        }];
    };
    let mut result = Vec::with_capacity(ranges.len() + 1);
    if first.min > 0 {
        result.push(CharRange {
            min: 0,
            max: first.min - 1,
        });
    }
    for (previous, range) in ranges.iter().zip(ranges.iter().skip(1)) {
        result.push(CharRange {
            min: previous.max + 1,
            max: range.min - 1,
        });
    }
    if last.max < maximum {
        result.push(CharRange {
            min: last.max + 1,
            max: maximum,
        });
    }
    result
}

/// upstream's `runEncodeCharacters`
fn run_encode_characters(characters: &[Char]) -> Vec<CharRange> {
    let mut characters = characters.iter().copied();
    let Some(first) = characters.next() else {
        return Vec::new();
    };
    let mut ranges = Vec::new();
    let mut run = CharRange {
        min: first,
        max: first,
    };
    for i in characters {
        if i == run.max + 1 {
            run.max = i;
        } else if i > run.max {
            ranges.push(run);
            run = CharRange { min: i, max: i };
        }
        // Else a duplicate. For what is not ascending upstream throws: here it is left out.
    }
    ranges.push(run);
    ranges
}

const fn ascii(min: char, max: char) -> CharRange {
    CharRange {
        min: min as Char,
        max: max as Char,
    }
}

const READABILITY_ASCII_PRIORITY: [CharRange; 10] = [
    ascii('A', 'Z'),
    ascii('a', 'z'),
    ascii('0', '9'),
    ascii('-', '-'),
    ascii('_', '_'),
    ascii(' ', ' '),
    ascii(' ', '~'),
    ascii('\t', '\t'),
    ascii('\n', '\n'),
    ascii('\r', '\r'),
];

/// upstream's `Words.pickMostReadableCharacter`
pub(crate) fn pick_most_readable_character(set: &CharSet) -> Option<Char> {
    let first = set.ranges.first()?;
    if set.ranges.len() == 1 && first.min == first.max {
        return Some(first.min);
    }
    for range in READABILITY_ASCII_PRIORITY {
        if let Some(c) = set.common_character_range(range) {
            return Some(c);
        }
    }
    Some(first.min)
}
