//! Sets of code points.

pub(super) const MAX: u32 = 0x10FFFF;

/// Inclusive ranges: sorted, apart from each other by at least one code point.
#[derive(Clone, Default, PartialEq, Eq, Debug)]
pub(super) struct CharSet {
    ranges: Vec<(u32, u32)>,
}

impl CharSet {
    pub(super) fn new() -> Self {
        CharSet::default()
    }

    pub(super) fn all() -> Self {
        CharSet { ranges: vec![(0, MAX)] }
    }

    /// `ranges` in any order, overlapping or not.
    pub(super) fn from_ranges(ranges: Vec<(u32, u32)>) -> Self {
        let mut set = CharSet { ranges };
        set.normalize();
        set
    }

    /// `toggles` is sorted. Membership starts as false and flips at each of them.
    pub(super) fn from_toggles(toggles: &[u32]) -> Self {
        let ranges = toggles
            .chunks(2)
            .filter_map(|pair| match *pair {
                [lo, next] => Some((lo, next.checked_sub(1)?)),
                [lo] => Some((lo, MAX)),
                _ => None,
            })
            .collect();
        CharSet { ranges }
    }

    fn toggles(&self) -> impl Iterator<Item = u32> {
        self.ranges.iter().flat_map(|(lo, hi)| [*lo, *hi + 1])
    }

    #[inline]
    pub(super) fn ranges(&self) -> &[(u32, u32)] {
        &self.ranges
    }

    pub(super) fn is_empty(&self) -> bool {
        self.ranges.is_empty()
    }

    /// The only member.
    pub(super) fn single(&self) -> Option<u32> {
        match self.ranges[..] {
            [(lo, hi)] if lo == hi => Some(lo),
            _ => None,
        }
    }

    pub(super) fn contains(&self, cp: u32) -> bool {
        let after = self.ranges.partition_point(|(lo, _)| *lo <= cp);
        after.checked_sub(1).and_then(|i| self.ranges.get(i)).is_some_and(|(_, hi)| cp <= *hi)
    }

    fn normalize(&mut self) {
        self.ranges.sort_unstable();
        let mut merged = 0usize;
        for i in 0..self.ranges.len() {
            let (lo, hi) = self.ranges[i];
            if let Some(last) = merged.checked_sub(1).and_then(|last| self.ranges.get_mut(last))
                && lo <= last.1.saturating_add(1)
            {
                last.1 = last.1.max(hi);
            } else {
                self.ranges[merged] = (lo, hi);
                merged += 1;
            }
        }
        self.ranges.truncate(merged);
    }

    pub(super) fn add(&mut self, lo: u32, hi: u32) {
        self.add_all(&[(lo, hi)]);
    }

    /// `ranges` in any order, overlapping or not.
    pub(super) fn add_all(&mut self, ranges: &[(u32, u32)]) {
        self.ranges.extend_from_slice(ranges);
        self.normalize();
    }

    pub(super) fn union(&mut self, other: &CharSet) {
        self.add_all(&other.ranges);
    }

    pub(super) fn complement(&self) -> CharSet {
        self.symmetric_difference(&CharSet::all())
    }

    pub(super) fn intersection(&self, other: &CharSet) -> CharSet {
        let (a, b) = (&self.ranges, &other.ranges);
        let mut ranges = Vec::new();
        let (mut i, mut j) = (0, 0);
        while let (Some(x), Some(y)) = (a.get(i), b.get(j)) {
            let (lo, hi) = (x.0.max(y.0), x.1.min(y.1));
            if lo <= hi {
                ranges.push((lo, hi));
            }
            if x.1 < y.1 {
                i += 1;
            } else {
                j += 1;
            }
        }
        CharSet { ranges }
    }

    pub(super) fn difference(&self, other: &CharSet) -> CharSet {
        self.intersection(&other.complement())
    }

    pub(super) fn symmetric_difference(&self, other: &CharSet) -> CharSet {
        let mut a = self.toggles().peekable();
        let mut b = other.toggles().peekable();
        let mut toggles = Vec::new();
        loop {
            match (a.peek().copied(), b.peek().copied()) {
                (Some(x), Some(y)) if x == y => {
                    a.next();
                    b.next();
                }
                (Some(x), Some(y)) if x < y => {
                    toggles.push(x);
                    a.next();
                }
                (Some(x), None) => {
                    toggles.push(x);
                    a.next();
                }
                (_, Some(y)) => {
                    toggles.push(y);
                    b.next();
                }
                (None, None) => break,
            }
        }
        CharSet::from_toggles(&toggles)
    }

    /// The ranges that have a code point in `lo..=hi`.
    pub(super) fn overlapping(&self, lo: u32, hi: u32) -> impl Iterator<Item = (u32, u32)> {
        let first = self.ranges.partition_point(|range| range.1 < lo);
        self.ranges.get(first..).unwrap_or_default().iter().copied().take_while(move |r| r.0 <= hi)
    }
}
