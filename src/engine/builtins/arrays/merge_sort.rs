//! A stable sort for comparisons that are expensive, can fail and may contradict each other: powersort (Munro and
//! Wild, "Nearly-Optimal Mergesorts", ESA 2018) with galloping merges.

use core::ops::Range;

use smallvec::SmallVec;

/// A run that is shorter than this is extended to `EXTENDED_RUN`.
const SHORT_RUN: usize = 8;
const EXTENDED_RUN: usize = 64;
const GALLOP_THRESHOLD: usize = 7;

struct Sorter<F> {
    is_less: F,
    /// How many times in a row one side of a merge has to win before it gallops.
    min_gallop: usize,
}

/// `scratch` is at least as long as `items`. After an error `items` has any of the elements.
#[inline(always)]
pub(crate) fn sort<T: Copy, E>(
    items: &mut [T],
    scratch: &mut [T],
    is_less: impl FnMut(T, T) -> Result<bool, E>,
) -> Result<(), E> {
    let mut sorter = Sorter {
        is_less,
        min_gallop: GALLOP_THRESHOLD,
    };
    if items.len() < SHORT_RUN {
        return sorter.insert_from(items, 1);
    }
    let mut pending = SmallVec::<[(usize, u32); 32]>::new();
    let mut run = 0..sorter.next_run(items, 0)?;
    while run.end < items.len() {
        let next = run.end..sorter.next_run(items, run.end)?;
        let power = power(&run, &next, items.len());
        while let Some(&(start, _)) = pending.last().filter(|it| it.1 > power) {
            pending.pop();
            sorter.merge(&mut items[start..run.end], run.start - start, scratch)?;
            run.start = start;
        }
        pending.push((run.start, power));
        run = next;
    }
    while let Some((start, _)) = pending.pop() {
        sorter.merge(&mut items[start..run.end], run.start - start, scratch)?;
        run.start = start;
    }
    Ok(())
}

/// The depth of the boundary between two runs in a perfectly balanced tree of merges.
fn power(left: &Range<usize>, right: &Range<usize>, length: usize) -> u32 {
    let midpoint = |run: &Range<usize>| (((run.start + run.end) as u128) << 62) / length as u128;
    ((midpoint(left) ^ midpoint(right)) as u64).leading_zeros()
}

/// The first index in the range for which `is_before` is false, if it is true for all before and false for all after.
#[inline(always)]
fn bisect<E>(
    range: Range<usize>,
    mut is_before: impl FnMut(usize) -> Result<bool, E>,
) -> Result<usize, E> {
    let (mut low, mut high) = (range.start, range.end);
    while low < high {
        let middle = low + (high - low) / 2;
        if is_before(middle)? {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    Ok(low)
}

/// The same in `0..length`, which is not empty, for an answer that is likely to be small.
#[inline(always)]
fn gallop_from_start<E>(
    length: usize,
    mut is_before: impl FnMut(usize) -> Result<bool, E>,
) -> Result<usize, E> {
    if !is_before(0)? {
        return Ok(0);
    }
    let (mut before, mut probe) = (0, 1);
    while probe < length && is_before(probe)? {
        before = probe;
        probe = (probe * 2 + 1).min(length);
    }
    bisect(before + 1..probe, is_before)
}

/// The same, for an answer that is likely to be near `length`.
#[inline(always)]
fn gallop_from_end<E>(
    length: usize,
    mut is_before: impl FnMut(usize) -> Result<bool, E>,
) -> Result<usize, E> {
    let last = length - 1;
    if is_before(last)? {
        return Ok(length);
    }
    let (mut after, mut probe) = (0, 1);
    while probe < length && !is_before(last - probe)? {
        after = probe;
        probe = (probe * 2 + 1).min(length);
    }
    bisect(length - probe..last - after, is_before)
}

impl<F> Sorter<F> {
    /// The first `sorted` items are in order.
    #[inline(always)]
    fn insert_from<T: Copy, E>(&mut self, items: &mut [T], sorted: usize) -> Result<(), E>
    where
        F: FnMut(T, T) -> Result<bool, E>,
    {
        for index in sorted..items.len() {
            let item = items[index];
            let place = bisect(0..index, |at| Ok(!(self.is_less)(item, items[at])?))?;
            items.copy_within(place..index, place + 1);
            items[place] = item;
        }
        Ok(())
    }

    /// The end of the run that includes the item before `end`.
    #[inline(always)]
    fn extend_while<T: Copy, E>(
        &mut self,
        items: &[T],
        mut end: usize,
        is_descending: bool,
    ) -> Result<usize, E>
    where
        F: FnMut(T, T) -> Result<bool, E>,
    {
        while end < items.len() && (self.is_less)(items[end], items[end - 1])? == is_descending {
            end += 1;
        }
        Ok(end)
    }

    /// Puts items from `start` on in order, and returns where they end.
    #[inline(never)]
    fn next_run<T: Copy, E>(&mut self, items: &mut [T], start: usize) -> Result<usize, E>
    where
        F: FnMut(T, T) -> Result<bool, E>,
    {
        let mut end = start + 1;
        if end < items.len() {
            let is_descending = (self.is_less)(items[end], items[start])?;
            end = self.extend_while(items, end + 1, is_descending)?;
            if is_descending {
                items[start..end].reverse();
            }
        }
        if end - start <= SHORT_RUN {
            let extended = items.len().min(start + EXTENDED_RUN);
            self.insert_from(&mut items[start..extended], end - start)?;
            end = extended;
        }
        self.extend_while(items, end, false)
    }

    /// The items before `middle` are in order, and so are the others. Neither part is empty.
    #[inline(never)]
    fn merge<T: Copy, E>(
        &mut self,
        items: &mut [T],
        middle: usize,
        scratch: &mut [T],
    ) -> Result<(), E>
    where
        F: FnMut(T, T) -> Result<bool, E>,
    {
        let is_less = &mut self.is_less;
        let (first_right, last_left) = (items[middle], items[middle - 1]);
        let start = gallop_from_start(middle, |at| Ok(!is_less(first_right, items[at])?))?;
        if start == middle {
            return Ok(());
        }
        let right_length = items.len() - middle;
        let end =
            middle + gallop_from_end(right_length, |at| is_less(items[middle + at], last_left))?;
        let left_items = &mut scratch[..middle - start];
        left_items.copy_from_slice(&items[start..middle]);

        // What is left of the left part fits exactly between `target` and `right`.
        let (mut left, mut right, mut target): (&[T], _, _) = (left_items, middle, start);
        'merge: while right < end {
            let (mut left_wins, mut right_wins) = (0, 0);
            while left_wins < self.min_gallop && right_wins < self.min_gallop {
                let (Some(&next_left), true) = (left.first(), right < end) else {
                    break 'merge;
                };
                if is_less(items[right], next_left)? {
                    items[target] = items[right];
                    right += 1;
                    (left_wins, right_wins) = (0, right_wins + 1);
                } else {
                    items[target] = next_left;
                    left = &left[1..];
                    (left_wins, right_wins) = (left_wins + 1, 0);
                }
                target += 1;
            }
            self.min_gallop += 1;
            loop {
                self.min_gallop -= usize::from(self.min_gallop > 1);
                if left.is_empty() || right == end {
                    break 'merge;
                }
                let next_right = items[right];
                left_wins =
                    gallop_from_start(left.len(), |at| Ok(!is_less(next_right, left[at])?))?;
                items[target..][..left_wins].copy_from_slice(&left[..left_wins]);
                left = &left[left_wins..];
                items[target + left_wins] = next_right;
                target += left_wins + 1;
                right += 1;
                let (Some(&next_left), true) = (left.first(), right < end) else {
                    break 'merge;
                };
                right_wins =
                    gallop_from_start(end - right, |at| is_less(items[right + at], next_left))?;
                items.copy_within(right..right + right_wins, target);
                right += right_wins;
                items[target + right_wins] = next_left;
                target += right_wins + 1;
                left = &left[1..];
                if left.is_empty() || right == end {
                    break 'merge;
                }
                if left_wins < GALLOP_THRESHOLD && right_wins < GALLOP_THRESHOLD {
                    break;
                }
            }
            self.min_gallop += 1;
        }
        items[target..][..left.len()].copy_from_slice(left);
        Ok(())
    }
}
