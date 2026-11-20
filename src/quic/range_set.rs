use core::ops::Range;
use std::collections::VecDeque;

const MAX_SPARE_CAPACITY: usize = 64;

/// Ranges that neither overlap nor touch, in ascending order.
#[derive(Debug, Default, Clone)]
pub(crate) struct RangeSet(VecDeque<Range<u64>>);

impl RangeSet {
    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The number of ranges.
    #[inline]
    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }

    #[inline]
    pub(crate) fn first(&self) -> Option<Range<u64>> {
        self.0.front().cloned()
    }

    #[inline]
    pub(crate) fn last(&self) -> Option<Range<u64>> {
        self.0.back().cloned()
    }

    #[inline]
    pub(crate) fn pop_first(&mut self) -> Option<Range<u64>> {
        self.trim();
        self.0.pop_front()
    }

    #[inline]
    fn trim(&mut self) {
        if self.0.capacity() > MAX_SPARE_CAPACITY + 4 * self.0.len() {
            self.0.shrink_to(2 * self.0.len());
        }
    }

    pub(crate) fn iter(&self) -> impl DoubleEndedIterator<Item = Range<u64>> + '_ {
        self.0.iter().cloned()
    }

    pub(crate) fn contains(&self, value: u64) -> bool {
        let at = self.0.partition_point(|range| range.end <= value);
        self.0.get(at).is_some_and(|range| range.start <= value)
    }

    /// The number of ranges that start after `value`.
    pub(crate) fn count_above(&self, value: u64) -> usize {
        self.0.len() - self.0.partition_point(|range| range.start <= value)
    }

    #[inline]
    pub(crate) fn insert(&mut self, new: Range<u64>) {
        if new.is_empty() {
            return;
        }
        match self.0.back_mut() {
            Some(last) if last.end == new.start => last.end = new.end,
            Some(last) if last.end > new.start => self.merge(new),
            _ => self.0.push_back(new),
        }
    }

    fn merge(&mut self, new: Range<u64>) {
        let first = self.0.partition_point(|range| range.end < new.start);
        let after = self.0.partition_point(|range| range.start <= new.end);
        if first == after {
            return self.0.insert(first, new);
        }
        let start = self.0.get(first).map_or(new.start, |it| it.start);
        let end = self.0.get(after - 1).map_or(new.end, |it| it.end);
        self.0.drain(first + 1..after);
        self.trim();
        let merged = start.min(new.start)..end.max(new.end);
        crate::with(self.0.get_mut(first), |it| *it = merged);
    }

    pub(crate) fn remove(&mut self, gone: Range<u64>) {
        if gone.is_empty() {
            return;
        }
        let mut first = self.0.partition_point(|range| range.end <= gone.start);
        let mut after = self.0.partition_point(|range| range.start < gone.end);
        if let Some(range) = self.0.get_mut(first)
            && range.start < gone.start
        {
            let end = core::mem::replace(&mut range.end, gone.start);
            first += 1;
            if end > gone.end {
                return self.0.insert(first, gone.end..end);
            }
        }
        if first < after
            && let Some(range) = self.0.get_mut(after - 1)
            && range.end > gone.end
        {
            range.start = gone.end;
            after -= 1;
        }
        if first < after {
            self.0.drain(first..after);
            self.trim();
        }
    }

    /// Removes what is less than `end`.
    #[inline]
    pub(crate) fn remove_below(&mut self, end: u64) {
        while let Some(first) = self.0.front_mut()
            && first.start < end
        {
            if first.end > end {
                first.start = end;
                return;
            }
            self.pop_first();
        }
    }

    /// The parts of `within` that are not in the set.
    pub(crate) fn gaps(&self, within: Range<u64>) -> impl Iterator<Item = Range<u64>> + '_ {
        let first = self.0.partition_point(|range| range.end <= within.start);
        let end = within.end;
        let inside = (self.0.range(first..)).take_while(move |range| range.start < end);
        (inside.cloned().chain(core::iter::once(end..end)))
            .scan(within.start, |at, range| {
                Some(core::mem::replace(at, range.end)..range.start)
            })
            .filter(|gap| !gap.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_is_given_back() {
        let cases: [fn(&mut RangeSet); 3] = [
            |it| it.remove_below(1990),
            |it| it.remove(0..1990),
            |it| it.insert(0..1990),
        ];
        for shorten in cases {
            let mut set = RangeSet::default();
            (0..1000).for_each(|it| set.insert(2 * it..2 * it + 1));
            shorten(&mut set);
            assert_eq!(set.count_above(1992), 3);
            assert!(set.0.capacity() < 100);
        }
    }
}
