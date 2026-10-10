//! The operations of JavaScript arrays whose result depends on how the engine does them.

/// `items.sort(compare)`, where `is_before(a, b)` is `compare(a, b) < 0`.
///
/// It matters for a `compare` that is no order: `(a, b) => a > b ? 1 : -1` in the fixes of
/// `sort-imports` and `sort-vars` never answers 0, that of `import/order` is not transitive. Where
/// the items end up then depends on the algorithm. This is that of V8 14, of Node.js 25 and 26: it
/// asks the same questions in the same order.
pub fn array_sort_by<T: Copy>(items: &mut [T], mut is_before: impl FnMut(T, T) -> bool) {
    let given = items.to_vec();
    let mut places: Vec<u32> = (0..given.len() as u32).collect();
    sort_places(&mut places, &mut |a, b| {
        is_before(given[a as usize], given[b as usize])
    });
    for (item, &place) in items.iter_mut().zip(&places) {
        *item = given[place as usize];
    }
}

type IsBefore<'f> = &'f mut dyn FnMut(u32, u32) -> bool;

const MIN_GALLOP_WINS: usize = 7;

/// `ArrayTimSort`
fn sort_places(work: &mut [u32], is_before: IsBefore) {
    let length = work.len();
    if length < 8 {
        return binary_insertion_sort(work, 0, is_before);
    }
    // `ComputeMinRunLength`
    let (mut min_run, mut carry) = (length, 0);
    while min_run >= 64 {
        carry |= min_run & 1;
        min_run >>= 1;
    }
    min_run += carry;
    let mut runs = Runs {
        work,
        pending: Vec::new(),
        min_gallop: MIN_GALLOP_WINS,
        is_before,
    };
    let mut low = 0;
    while low < length {
        let mut counted = count_and_make_run(&mut runs.work[low..], runs.is_before);
        if counted < min_run {
            let forced = min_run.min(length - low);
            binary_insertion_sort(&mut runs.work[low..low + forced], counted, runs.is_before);
            counted = forced;
        }
        runs.pending.push(Run {
            start: low,
            length: counted,
        });
        runs.merge_collapse(Collapse::WhatIsOutOfBalance);
        low += counted;
    }
    runs.merge_collapse(Collapse::All);
}

/// `BinaryInsertionSort`. `run[..sorted]` is sorted.
fn binary_insertion_sort(run: &mut [u32], sorted: usize, is_before: IsBefore) {
    for next in sorted.max(1)..run.len() {
        let pivot = run[next];
        let (mut left, mut right) = (0, next);
        while left < right {
            let middle = left + (right - left) / 2;
            match is_before(pivot, run[middle]) {
                true => right = middle,
                false => left = middle + 1,
            }
        }
        run.copy_within(left..next, left + 1);
        run[left] = pivot;
    }
}

/// `CountAndMakeRun`: how many items at the start of `rest` ascend, or descend and are reversed.
fn count_and_make_run(rest: &mut [u32], is_before: IsBefore) -> usize {
    if rest.len() < 2 {
        return rest.len();
    }
    let is_descending = is_before(rest[1], rest[0]);
    let mut length = 2;
    while length < rest.len() && is_before(rest[length], rest[length - 1]) == is_descending {
        length += 1;
    }
    if is_descending {
        rest[..length].reverse();
    }
    length
}

#[derive(Copy, Clone)]
enum Side {
    /// `GallopLeft`: before what is equal to the key.
    Left,
    /// `GallopRight`: after it.
    Right,
}

impl Side {
    /// Where `key` belongs in `run`, which is sorted. The search begins at `hint`.
    fn gallop(self, run: &[u32], key: u32, hint: usize, is_before: IsBefore) -> usize {
        let mut is_below = |at: usize| match self {
            Side::Left => is_before(run[at], key),
            Side::Right => !is_before(key, run[at]),
        };
        let (mut last, mut offset) = (0, 1);
        let (mut from, mut to) = if is_below(hint) {
            let max = run.len() - hint;
            while offset < max && is_below(hint + offset) {
                (last, offset) = (offset, offset * 2 + 1);
            }
            (hint + last + 1, hint + offset.min(max))
        } else {
            let max = hint + 1;
            while offset < max && !is_below(hint - offset) {
                (last, offset) = (offset, offset * 2 + 1);
            }
            (max - offset.min(max), hint - last)
        };
        while from < to {
            let middle = from + (to - from) / 2;
            match is_below(middle) {
                true => from = middle + 1,
                false => to = middle,
            }
        }
        to
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Collapse {
    /// `MergeCollapse`
    WhatIsOutOfBalance,
    /// `MergeForceCollapse`
    All,
}

#[derive(Copy, Clone)]
struct Run {
    start: usize,
    length: usize,
}

/// `SortState`
struct Runs<'w, 'f> {
    work: &'w mut [u32],
    /// Those that wait to be merged.
    pending: Vec<Run>,
    min_gallop: usize,
    is_before: IsBefore<'f>,
}

impl Runs<'_, '_> {
    fn merge_collapse(&mut self, which: Collapse) {
        while self.pending.len() > 1 {
            let n = self.pending.len() - 2;
            let length = |at: usize| self.pending[at].length;
            // `RunInvariantEstablished`
            let is_established = |n: usize| n < 2 || length(n - 2) > length(n - 1) + length(n);
            let is_forced = which == Collapse::All || !is_established(n + 1) || !is_established(n);
            if !is_forced && length(n) > length(n + 1) {
                break;
            }
            let is_first_shorter = is_forced && n > 0 && length(n - 1) < length(n + 1);
            self.merge_at(if is_first_shorter { n - 1 } else { n });
        }
    }

    /// `MergeAt`
    fn merge_at(&mut self, at: usize) {
        let (first, second) = (self.pending[at], self.pending.remove(at + 1));
        self.pending[at].length += second.length;
        let (first_of_b, last_of_a) = (self.work[second.start], self.work[second.start - 1]);
        let run_a = &self.work[first.start..second.start];
        let in_place = Side::Right.gallop(run_a, first_of_b, 0, self.is_before);
        if in_place == first.length {
            return;
        }
        let run_b = &self.work[second.start..second.start + second.length];
        let b = Side::Left.gallop(run_b, last_of_a, second.length - 1, self.is_before);
        let a = first.length - in_place;
        match b {
            0 => {}
            _ if a <= b => self.merge_low(first.start + in_place, a, b),
            _ => self.merge_high(first.start + in_place, a, b),
        }
    }

    /// `MergeLow`: from the front. `a`, `b`: how many of each run are left; they end at `end`.
    fn merge_low(&mut self, start: usize, mut a: usize, mut b: usize) {
        let (work, is_before) = (&mut *self.work, &mut *self.is_before);
        let mut min_gallop = self.min_gallop;
        let end = start + a + b;
        let temp = work[start..start + a].to_vec();
        let count = temp.len();
        'merged: {
            work[end - a - b] = work[end - b];
            b -= 1;
            if b == 0 || a == 1 {
                break 'merged;
            }
            loop {
                let (mut wins_a, mut wins_b) = (0, 0);
                while wins_a < min_gallop && wins_b < min_gallop {
                    if is_before(work[end - b], temp[count - a]) {
                        work[end - a - b] = work[end - b];
                        (b, wins_a, wins_b) = (b - 1, 0, wins_b + 1);
                        if b == 0 {
                            break 'merged;
                        }
                    } else {
                        work[end - a - b] = temp[count - a];
                        (a, wins_a, wins_b) = (a - 1, wins_a + 1, 0);
                        if a == 1 {
                            break 'merged;
                        }
                    }
                }
                min_gallop += 1;
                loop {
                    min_gallop = (min_gallop - 1).max(1);
                    wins_a = Side::Right.gallop(&temp[count - a..], work[end - b], 0, is_before);
                    work[end - a - b..][..wins_a].copy_from_slice(&temp[count - a..][..wins_a]);
                    a -= wins_a;
                    if a <= 1 {
                        break 'merged;
                    }
                    work[end - a - b] = work[end - b];
                    b -= 1;
                    if b == 0 {
                        break 'merged;
                    }
                    wins_b = Side::Left.gallop(&work[end - b..end], temp[count - a], 0, is_before);
                    work.copy_within(end - b..end - b + wins_b, end - a - b);
                    b -= wins_b;
                    if b == 0 {
                        break 'merged;
                    }
                    work[end - a - b] = temp[count - a];
                    a -= 1;
                    if a == 1 {
                        break 'merged;
                    }
                    if wins_a < MIN_GALLOP_WINS && wins_b < MIN_GALLOP_WINS {
                        break;
                    }
                }
                min_gallop += 1;
            }
        }
        self.min_gallop = min_gallop;
        work.copy_within(end - b..end, end - a - b);
        work[end - a..end].copy_from_slice(&temp[count - a..]);
    }

    /// `MergeHigh`: from the back. `a`, `b`: how many of each run are left; they start at `start`.
    fn merge_high(&mut self, start: usize, mut a: usize, mut b: usize) {
        let (work, is_before) = (&mut *self.work, &mut *self.is_before);
        let mut min_gallop = self.min_gallop;
        let temp = work[start + a..start + a + b].to_vec();
        'merged: {
            work[start + a + b - 1] = work[start + a - 1];
            a -= 1;
            if a == 0 || b == 1 {
                break 'merged;
            }
            loop {
                let (mut wins_a, mut wins_b) = (0, 0);
                while wins_a < min_gallop && wins_b < min_gallop {
                    if is_before(temp[b - 1], work[start + a - 1]) {
                        work[start + a + b - 1] = work[start + a - 1];
                        (a, wins_a, wins_b) = (a - 1, wins_a + 1, 0);
                        if a == 0 {
                            break 'merged;
                        }
                    } else {
                        work[start + a + b - 1] = temp[b - 1];
                        (b, wins_a, wins_b) = (b - 1, 0, wins_b + 1);
                        if b == 1 {
                            break 'merged;
                        }
                    }
                }
                min_gallop += 1;
                loop {
                    min_gallop = (min_gallop - 1).max(1);
                    let run_a = &work[start..start + a];
                    wins_a = a - Side::Right.gallop(run_a, temp[b - 1], a - 1, is_before);
                    work.copy_within(start + a - wins_a..start + a, start + a - wins_a + b);
                    a -= wins_a;
                    if a == 0 {
                        break 'merged;
                    }
                    work[start + a + b - 1] = temp[b - 1];
                    b -= 1;
                    if b == 1 {
                        break 'merged;
                    }
                    let last_of_a = work[start + a - 1];
                    wins_b = b - Side::Left.gallop(&temp[..b], last_of_a, b - 1, is_before);
                    work[start + a + b - wins_b..start + a + b]
                        .copy_from_slice(&temp[b - wins_b..b]);
                    b -= wins_b;
                    if b <= 1 {
                        break 'merged;
                    }
                    work[start + a + b - 1] = work[start + a - 1];
                    a -= 1;
                    if a == 0 {
                        break 'merged;
                    }
                    if wins_a < MIN_GALLOP_WINS && wins_b < MIN_GALLOP_WINS {
                        break;
                    }
                }
                min_gallop += 1;
            }
        }
        self.min_gallop = min_gallop;
        work.copy_within(start..start + a, start + b);
        work[start..start + b].copy_from_slice(&temp[..b]);
    }
}
