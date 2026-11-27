//! The script of [`tokens`](crate::tokens) for texts with few changed lines, without a number for each line.
//!
//! The rounds of `tokens::search` run on the texts themselves: a run of equal lines is compared as one piece, and the
//! lines in it are only counted.

use core::ops::Range;

use bun_core::strings::CodeUnits;

use crate::Hunk;
use crate::tokens::{LONG_LINE, Split, Unit, as_slice, as_slices, for_each_line_end, is_same};

const UNKNOWN: u32 = u32::MAX;

pub(crate) struct Lines<'a> {
    text: CodeUnits<'a>,
    /// The units and the lines between the common head and the common tail.
    units: usize,
    count: usize,
    /// By line after the common head. The last is `UNKNOWN`. Lines past the end of the text are empty.
    starts: Vec<u32>,
}

impl<'a> Lines<'a> {
    pub(crate) fn new<T: Unit>(text: &'a [T], changed: Range<usize>) -> Self {
        // Finding long lines is as fast as counting them.
        let (mut starts, mut at) = (Vec::with_capacity(16), changed.start);
        starts.push(at as u32);
        while at < changed.end && at - changed.start >= LONG_LINE * (starts.len() - 1) {
            at = Split::Lines.end(text, at);
            starts.push(at as u32);
        }
        let count = starts.len() - 1 + Split::Lines.count(&text[at..changed.end]);
        // With room for the first lines of the tail.
        starts.resize(count + 4, UNKNOWN);
        Self {
            text: T::units(text),
            units: changed.len(),
            count,
            starts,
        }
    }

    fn set_start(&mut self, line: usize, start: usize) {
        if self.starts.len() < line + 2 {
            self.starts.resize(2 * line + 2, UNKNOWN);
        }
        self.starts[line] = start as u32;
    }

    /// The start of `line` is known. After this, so is its end.
    #[inline]
    fn get(&mut self, line: usize) -> Range<usize> {
        let (text, start) = (self.text, self.starts[line] as usize);
        if self.starts[line + 1] == UNKNOWN {
            self.set_start(line + 1, as_slice!(text => Split::Lines.end(text, start)));
        }
        start..self.starts[line + 1] as usize
    }

    /// Finds the starts of all lines before the common tail.
    fn find_all(&mut self) {
        let starts = self.starts[..=self.count].iter();
        let known = starts.take_while(|&&start| start != UNKNOWN).count();
        let from = self.starts[known - 1] as usize;
        let to = self.starts[0] as usize + self.units;
        let (text, mut rest) = (self.text, self.starts[known..].iter_mut());
        let found = |end| {
            if let Some(start) = rest.next() {
                *start = (from + end) as u32;
            }
        };
        as_slice!(text => for_each_line_end(&text[from..to], found));
        self.starts[self.count] = to as u32;
    }

    /// The start of the first line, and the end of each line before the common tail.
    pub(crate) fn offsets(mut self) -> Vec<u32> {
        self.find_all();
        self.starts.truncate(self.count + 1);
        self.starts
    }

    /// Those that were not needed are `UNKNOWN`.
    pub(crate) fn starts(self) -> Vec<u32> {
        self.starts
    }
}

// Measured, in steps of the search. Times change little with them.
const ROUND_COST: usize = 20;
const COMPARE_COST: usize = 4;
const RUN_COST: usize = 16;
const ID_COST: usize = 8;
const TABLE_COST: usize = 64;
const UNITS_PER_STEP: usize = 64;

/// How many lines are equal from `x` and `y` on. After this, the ends of the first lines that differ are known.
#[inline(never)]
fn equal_lines(
    a: &mut Lines<'_>,
    b: &mut Lines<'_>,
    x: usize,
    y: usize,
    work: &mut usize,
) -> usize {
    let (in_a, in_b) = (a.get(x), b.get(y));
    if in_a.len() != in_b.len() {
        return 0;
    }
    *work += COMPARE_COST + in_a.len() / UNITS_PER_STEP;
    let (text_a, text_b, from_a, from_b) = (a.text, b.text, in_a.end, in_b.end);
    let (same, run) = as_slices!(text_a, text_b => {
        if !is_same(&text_a[in_a], &text_b[in_b]) {
            return 0;
        }
        let same = Split::Lines.common_head(&text_a[from_a..], &text_b[from_b..]);
        (same, 1 + Split::Lines.count(&text_a[from_a..from_a + same]))
    });
    a.set_start(x + run, from_a + same);
    b.set_start(y + run, from_b + same);
    let compared = same + a.get(x + run).len().min(b.get(y + run).len());
    *work += RUN_COST + compared / UNITS_PER_STEP;
    run
}

/// One round on one side of the goal, from the outside in. A point is a line of `along`, and adding `shift` gives the
/// line of `across`. Returns how far one more edit gets on the goal, or 0 if this side has no diagonal yet.
#[inline(always)]
fn side(
    along: &mut Lines<'_>,
    across: &mut Lines<'_>,
    before: &[u32],
    now: &mut [u32],
    mut shift: isize,
    work: &mut usize,
) -> usize {
    let mut towards = 0;
    for (&away, point) in before.iter().zip(now) {
        let mut at = towards.max(away);
        let (x, y) = (at as usize, (at as isize + shift) as usize);
        let (a, b) = (&along.starts[x..x + 2], &across.starts[y..y + 2]);
        // Lines of different lengths differ.
        if a[1].wrapping_sub(a[0]) == b[1].wrapping_sub(b[0]) || a[1].max(b[1]) == UNKNOWN {
            at += equal_lines(along, across, x, y, work) as u32;
        }
        *point = at;
        towards = at + 1;
        shift -= 1;
    }
    towards as usize
}

pub(crate) enum Followed {
    /// The starts of the lines at the ends of each hunk are known.
    Found(Vec<Hunk>),
    TooFar,
    /// Numbering the lines looks faster.
    GaveUp,
}

/// The hunks count lines from the end of the common head.
pub(crate) fn follow(a: &mut Lines<'_>, b: &mut Lines<'_>, max_edits: usize) -> Followed {
    let (n, m) = (a.count, b.count);
    // If most of these differ, finding that out takes longer than numbering them.
    if (9..=32).contains(&(n + m)) {
        return Followed::GaveUp;
    }
    // How many more lines `a` has, and `b`.
    let (up, down) = (n.saturating_sub(m), m.saturating_sub(n));
    let surplus = up + down;
    let by_ids = ID_COST * (n + m) + (a.units + b.units) / UNITS_PER_STEP + TABLE_COST;
    let trial = by_ids / 32;
    // A point is kept for each step, so this also bounds the memory.
    let budget = by_ids.min(2 * (n + m) + (1 << 21));
    // The first round reads `surplus` lines. If that is many, one pass finds them faster.
    if surplus > trial && surplus <= max_edits {
        a.find_all();
        b.find_all();
    }
    let steps = |rounds: usize| rounds.saturating_mul(rounds + surplus + ROUND_COST);
    // `surplus` zeros, then two lists for each round: x on one side of the goal, y on the other. Both end with the
    // goal. All are kept, so that `backtrack` compares nothing.
    let mut points = Vec::with_capacity(surplus * 2 + 64);
    let (mut round, mut work) = (0, 0);
    loop {
        let width = surplus + 2 * round;
        if width > max_edits {
            return Followed::TooFar;
        }
        let start = points.len().max(surplus);
        points.resize(start + width + 2, 0);
        let (before, now) = points[start - width..].split_at_mut(width);
        let (left, right) = before.split_at(up + round);
        let (below, above) = now.split_at_mut(up + round + 1);
        let deleted = side(a, b, left, below, (round + down) as isize, &mut work);
        let inserted = side(b, a, right, above, (round + up) as isize, &mut work);
        let mut x = deleted.max((inserted + up).saturating_sub(down));
        if x < n {
            x += equal_lines(a, b, x, x + down - up, &mut work);
        }
        if x >= n {
            return Followed::Found(backtrack(
                &points,
                up as isize,
                down as isize,
                round as isize,
            ));
        }
        (below[up + round], above[down + round]) = (x as u32, (x + down - up) as u32);
        round += 1;
        work += width + ROUND_COST;
        // After `trial` steps, the progress tells how many rounds to expect.
        if work > trial {
            // Later only the last half of the rounds counts: a long run at the start says little about the rest.
            let (since, from) = match round / 2 {
                half if half > 0 && work > budget / 8 => {
                    let goal = (half + 1) * (surplus + half) + up + half;
                    (half, points[goal] as usize)
                }
                _ => (0, up),
            };
            let rounds = since + (round - since) * (n - from) / (x - from + 1);
            let rounds = rounds.min((max_edits - surplus) / 2);
            let expected = steps(rounds).saturating_mul(work) / steps(round);
            if expected.max(work) > budget {
                return Followed::GaveUp;
            }
        }
    }
}

/// The hunks of the path that ends on the goal in `round`.
fn backtrack(points: &[u32], up: isize, down: isize, mut round: isize) -> Vec<Hunk> {
    let delta = up - down;
    // The x of the point on the diagonal that is `off` from the goal, or -1.
    let furthest = |round: isize, off: isize| {
        let (first, width, shift) = if off <= 0 {
            (0, up + round, 0)
        } else {
            (up + round + 1, down + round, delta + off)
        };
        if round < 0 || off.abs() > width {
            return -1;
        }
        let start = (round + 1) * (up + down + round);
        points[(start + first + width - off.abs()) as usize] as isize + shift
    };
    let mut hunks = Vec::<Hunk>::with_capacity(round as usize + 1);
    let mut off = 0;
    while round > 0 || off != -delta {
        let left = (round - isize::from(off > 0), off - 1);
        let right = (round - isize::from(off < 0), off + 1);
        let (from_left, from_right) = (furthest(left.0, left.1), furthest(right.0, right.1));
        let x = from_right.max(from_left + 1);
        let (x, y) = (x as usize, (x - delta - off) as usize);
        let hunk = match hunks.last_mut() {
            Some(hunk) if hunk.a_lo == x => hunk,
            _ => hunks.push_mut(Hunk {
                a_lo: x,
                a_hi: x,
                b_lo: y,
                b_hi: y,
            }),
        };
        if from_left < from_right {
            hunk.b_lo -= 1;
            (round, off) = right;
        } else {
            hunk.a_lo -= 1;
            (round, off) = left;
        }
    }
    hunks.reverse();
    hunks
}
