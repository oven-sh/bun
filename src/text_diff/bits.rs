//! For a box with many edits: its edit distance, where its minimal diffs run, and how far a given number of edits gets.
//!
//! The LCS table (a column per element of `a`, a row per element of `b`) is computed in strips of 256 columns
//! (Hyyrö 2004). A strip keeps one bit per column, 0 where the LCS grows there, and takes in a row per step. `forward`
//! skips the blocks of 64 rows that no path of at most `bound` edits can touch.
//!
//! Two walks back from the end, one going left and one going up wherever that is minimal, give the outermost minimal
//! paths. All others run between them, and after any number of edits are on diagonals between theirs ([`Level`]).

use core::ops::Range;

use crate::Elem;

pub(crate) const WORDS: usize = 4;
pub(crate) const STRIP: usize = 64 * WORDS;
type Row = [u64; WORDS];

const ONES: Row = [u64::MAX; WORDS];
const ZEROS: Row = [0; WORDS];
/// `STRIP + 1` slots (slot 0 is for elements not in the strip), rounded up to a power of two: `% MASKS` then spares
/// bounds checks.
const MASKS: usize = 2 * STRIP;
/// `reach` charges for loading a strip as for this many blocks.
const SETUP_BLOCKS: usize = 2;
/// Blocks per strip in `guess`: four for the diagonal through the strip, one above it and three below.
const BAND: usize = WORDS + 4;

struct Strip {
    /// The blocks of 64 rows that were visited: `first..end`.
    first: u32,
    end: u32,
    /// Where they start in `carries` and in `saved`.
    start: u32,
    /// The LCS of the columns left of the strip and the rows above block `first`, as far as the visited blocks show it.
    lcs_top: u32,
}

pub(crate) enum Pass {
    /// The edit distance.
    Within(usize),
    /// More than the bound, which was certain after this many columns.
    Beyond(usize),
}

struct Masks(Box<[Row; MASKS]>);

impl Default for Masks {
    fn default() -> Self {
        Self(Box::new([ZEROS; MASKS]))
    }
}

#[derive(Default)]
pub(crate) struct Bits {
    /// The strip of this pass that `slot`, `masks` and `elements` describe. `None`: they are left from an earlier pass.
    loaded: Option<usize>,
    /// Element to index in `masks`; 0 for all but `elements`.
    slot: Vec<u16>,
    /// By slot: the strip's columns with the element. Slot 0 stays empty.
    masks: Masks,
    /// The strip's elements, each once.
    elements: Vec<u32>,
    strips: Vec<Strip>,
    /// Per block, whether the LCS grows with each row at the strip's last column; first row in the top bit.
    carries: Vec<u64>,
    /// The bits of the row above each block.
    saved: Vec<Row>,
    /// The rows of one block, the one above it first, each with a second row: 1 where the LCS grows from the row above.
    rows: Vec<(Row, Row)>,
}

/// One row. Takes the top bit out of `carries_in` and shifts the carry into `carries_out`. Returns the sums.
#[inline(always)]
fn step(v: &mut Row, mask: &Row, carries_in: &mut u64, carries_out: &mut u64) -> Row {
    let mut sum = ZEROS;
    let mut carry = *carries_in >> 63 != 0;
    *carries_in <<= 1;
    for w in 0..WORDS {
        (sum[w], carry) = (v[w] & mask[w]).carrying_add(v[w], carry);
    }
    *carries_out = *carries_out << 1 | u64::from(carry);
    for w in 0..WORDS {
        v[w] = (v[w] & !mask[w]) | sum[w];
    }
    sum
}

/// Up to 64 rows. Returns the carries out.
#[inline(never)]
fn block<T: Elem>(
    v: &mut Row,
    rows: &[T],
    slot: &[u16],
    masks: &[Row; MASKS],
    mut carries_in: u64,
) -> u64 {
    // Looked up first: the second loop has no registers to spare on x64.
    let mut of_row = [&masks[0]; 64];
    for (mask, &e) in of_row.iter_mut().zip(rows) {
        *mask = &masks[slot[e.id()] as usize % MASKS];
    }
    let mut row = *v;
    let mut out = 0u64;
    for mask in &of_row[..rows.len()] {
        step(&mut row, mask, &mut carries_in, &mut out);
    }
    *v = row;
    out << (64 - rows.len())
}

fn zeros_before(v: &Row, column: usize) -> usize {
    let (whole, rest) = (column / 64, column % 64);
    let part = v.get(whole).map_or(0, |word| !word & !(u64::MAX << rest));
    let zeros: u32 = v[..whole].iter().map(|word| word.count_zeros()).sum();
    (zeros + part.count_ones()) as usize
}

/// A length whose end `Bits::reach` cannot get to within `budget`: a row takes `WORDS` words, and a strip at least one block.
pub(crate) fn out_of_reach(budget: usize) -> usize {
    budget / WORDS.min(1 + SETUP_BLOCKS) + 1
}

/// How many rows are above the block that has row `b[y - 1]`.
fn top_of_block(y: usize) -> usize {
    (y - 1) / 64 * 64
}

/// Where minimal paths are after some number of edits.
#[derive(Clone, Copy, Default)]
pub(crate) struct Level {
    /// The lowest and the highest diagonal x - y.
    pub lo: i32,
    pub hi: i32,
    /// If `lo == hi`, all of them go through every x of `from..=to`, which may be empty.
    pub from: i32,
    pub to: i32,
}

impl Level {
    #[inline]
    pub(crate) fn is_shared(&self) -> bool {
        self.lo == self.hi && self.from <= self.to
    }
}

/// A place on a minimal path and the edits up to it.
#[derive(Clone, Copy)]
struct At {
    x: usize,
    y: usize,
    edits: usize,
}

impl Bits {
    pub(crate) fn reserve_ids(&mut self, ids: usize) {
        if self.slot.len() < ids {
            self.slot.resize(ids, 0);
        }
    }

    fn clear(&mut self) {
        self.loaded = None;
        self.strips.clear();
        self.carries.clear();
        self.saved.clear();
    }

    fn load_masks<T: Elem>(&mut self, s: usize, columns: &[T]) {
        if self.loaded.replace(s) == Some(s) {
            return;
        }
        for id in self.elements.drain(..) {
            self.slot[id as usize] = 0;
        }
        let masks = &mut *self.masks.0;
        for (i, &e) in columns.iter().enumerate() {
            let slot = &mut self.slot[e.id()];
            if *slot == 0 {
                self.elements.push(e.id() as u32);
                *slot = self.elements.len() as u16;
                masks[*slot as usize % MASKS] = ZEROS;
            }
            masks[*slot as usize % MASKS][i / 64 % WORDS] |= 1 << (i % 64);
        }
    }

    /// The carries into block `at` of strip `s`.
    #[inline]
    fn carries_into(&self, s: usize, at: u32) -> u64 {
        match s.checked_sub(1).map(|s| &self.strips[s]) {
            Some(left) if at < left.end => self.carries[(left.start + at - left.first) as usize],
            _ => 0,
        }
    }

    /// The edits of one path through the box, so never below the edit distance and often equal to it; `limit` if that is
    /// less.
    pub(crate) fn guess<T: Elem>(&mut self, a: &[T], b: &[T], limit: usize) -> usize {
        let blocks = b.len().div_ceil(64);
        self.clear();
        let (mut first, mut lcs_top, mut lcs_end) = (0usize, 0usize, 0usize);
        for (s, columns) in a.chunks(STRIP).enumerate() {
            let x = s * STRIP + columns.len();
            let carries = self.carries.len();
            let end = blocks.min(first + BAND);
            let mut cheapest = (usize::MAX, 0);
            self.sweep(columns, b, first..end, lcs_top, |y, lcs, _| {
                cheapest = cheapest.min((x + y - 2 * lcs, y));
                lcs_end = lcs;
                false
            });
            if cheapest.0 > limit {
                return limit;
            }
            // The next strip starts a block above the row that took the fewest edits.
            let next = (cheapest.1 / 64).saturating_sub(1);
            for word in &self.carries[carries..][..next - first] {
                lcs_top += word.count_ones() as usize;
            }
            first = next;
        }
        limit.min(a.len() + b.len() - 2 * lcs_end)
    }

    /// The edit distance of `a` and `b` (`a.len() >= b.len()`) if it is at most `bound` (`>= a.len() - b.len()`).
    pub(crate) fn forward<T: Elem>(&mut self, a: &[T], b: &[T], bound: usize) -> Pass {
        debug_assert!(a.len() >= b.len() && !a.is_empty());
        let (n, m) = (a.len(), b.len());
        let delta = n - m;
        debug_assert!(bound >= delta);
        let blocks = m.div_ceil(64);
        self.clear();
        // The LCS of the columns so far and the rows above block `first`.
        let (mut first, mut lcs_top) = (0usize, 0usize);
        let mut edits = delta;
        for (s, columns) in a.chunks(STRIP).enumerate() {
            let x = s * STRIP + columns.len();
            let carries = self.carries.len();
            let end = blocks.min((x + (bound - delta) / 2) / 64 + 1);
            // Below the diagonal of the end, the least edits of a path through a point never fall to the left or down.
            self.sweep(columns, b, first..end, lcs_top, |y, lcs, _| {
                y + delta >= x && 2 * (y - lcs) + delta > bound
            });
            // Above it, they never fall upwards or to the right.
            let mut c = carries;
            let (mut next, mut lcs) = (first, lcs_top);
            while (next + 1) * 64 + delta <= x {
                lcs += self.carries[c].count_ones() as usize;
                c += 1;
                next += 1;
                if 2 * (x - lcs) > bound + delta {
                    (first, lcs_top) = (next, lcs);
                }
            }
            if x >= delta {
                let rest = x - delta - next * 64;
                if rest > 0 {
                    lcs += (self.carries[c] >> (64 - rest)).count_ones() as usize;
                }
                edits = 2 * (x - lcs) - delta;
                if edits > bound {
                    return Pass::Beyond(x);
                }
            }
        }
        Pass::Within(edits)
    }

    /// Of the points at most `edits` edits from the start, the one with the largest x + y; of several, the one with the
    /// smallest x. The edit distance has to be above `edits`. Each strip takes its words from `budget`; `None` once that
    /// runs out.
    pub(crate) fn reach<T: Elem>(
        &mut self,
        a: &[T],
        b: &[T],
        edits: usize,
        budget: &mut usize,
    ) -> Option<(usize, usize)> {
        let blocks = b.len().div_ceil(64);
        self.clear();
        let (mut first, mut lcs_top) = (0usize, 0usize);
        // Below this row no point of the column left of the strip is within `edits`.
        let mut last_row = edits;
        // The largest x + y is at least this.
        let mut reached = edits;
        for (s, columns) in a.chunks(STRIP).enumerate() {
            let carries = self.carries.len();
            self.sweep(columns, b, first..blocks, lcs_top, |y, mut lcs, v| {
                // A point past the end of `a` stands for the one as many rows down in the last column:
                // same x + y, no more edits.
                let mut x = (s + 1) * STRIP;
                let mut enough = y >= last_row;
                for word in v.iter().rev() {
                    // Going left, the edits fall by 1 at each 1 bit.
                    enough &= x + y > edits + 2 * lcs + word.count_ones() as usize;
                    x -= 64;
                    lcs -= word.count_zeros() as usize;
                    if x + y <= edits + 2 * lcs {
                        reached = reached.max(x + y);
                    }
                }
                enough
            });
            let visited = &self.carries[carries..];
            *budget = budget.checked_sub((visited.len() + SETUP_BLOCKS) * 64 * WORDS)?;
            let x = s * STRIP + columns.len();
            let (mut y, mut lcs) = (first * 64, lcs_top);
            let mut next = None;
            for word in visited {
                let grows = word.count_ones() as usize;
                // Going down, the edits fall by 1 in each row where the LCS grows.
                if x + y <= edits + 2 * lcs + grows {
                    next = next.or(Some((y / 64, lcs)));
                    last_row = y + 64;
                }
                y += 64;
                lcs += grows;
            }
            let Some(next) = next else { break };
            (first, lcs_top) = next;
        }
        Some(self.best_point(a, b, edits, reached))
    }

    /// The point for `reach`, in the blocks that it visited. Its x + y is at least `reached` and has the parity of `edits`.
    fn best_point<T: Elem>(
        &mut self,
        a: &[T],
        b: &[T],
        edits: usize,
        reached: usize,
    ) -> (usize, usize) {
        // Starts at least 2 below the answer, so that the loop sets `best_x`; else at `edits`, which needs no match.
        let mut sum = edits + ((reached - edits) & !1).saturating_sub(2);
        let mut best_x = edits.saturating_sub(b.len());
        for s in 0..self.strips.len() {
            let x0 = s * STRIP;
            let columns = &a[x0..a.len().min(x0 + STRIP)];
            let x1 = x0 + columns.len();
            let excess = |sum: usize, y: usize, lcs: usize, v: &Row| {
                let x = sum.saturating_sub(y).clamp(x0, x1);
                (x + y).saturating_sub(edits + 2 * (lcs + zeros_before(v, x - x0)))
            };
            let strip = &self.strips[s];
            let mut lcs_below = strip.lcs_top as usize;
            for at in strip.first..strip.end {
                let top = at as usize * 64;
                let last = b.len().min(top + 64);
                let (mut v, mut carries) = (self.row_above(s, at), self.carries_into(s, at));
                let mut lcs = lcs_below;
                lcs_below += carries.count_ones() as usize;
                if !(x0 + top..=x1 + last).contains(&sum) {
                    continue;
                }
                // Along one sum the edits fall by at most 2 from one row to the next.
                let mut skip = excess(sum, top, lcs, &v) / 2;
                if skip > last - top {
                    continue;
                }
                self.load_masks(s, columns);
                let masks = &*self.masks.0;
                for (y, e) in (top + 1..).zip(&b[top..last]) {
                    lcs += (carries >> 63) as usize;
                    let mask = &masks[self.slot[e.id()] as usize % MASKS];
                    step(&mut v, mask, &mut carries, &mut 0);
                    skip = skip.saturating_sub(1);
                    if skip > 0 {
                        continue;
                    }
                    let within = |sum: usize| {
                        (x0 + y + 1..=x1 + y).contains(&sum) && excess(sum, y, lcs, &v) == 0
                    };
                    // If a point is within `edits`, so is the one before it on its diagonal, which is looked at
                    // earlier: the sum grows by 2 at a time.
                    if within(sum + 2) {
                        sum += 2;
                        best_x = sum - y;
                    } else if sum < best_x + y && within(sum) {
                        best_x = sum - y;
                    } else {
                        skip = excess(sum, y, lcs, &v) / 2;
                    }
                }
            }
        }
        debug_assert!(sum < a.len() + b.len(), "the end is within `edits`");
        (best_x, sum - best_x)
    }

    /// Computes `blocks` of the next strip; stops after the block for which `enough(rows, lcs, bits of the last row)` holds.
    #[inline(always)]
    fn sweep<T: Elem>(
        &mut self,
        columns: &[T],
        b: &[T],
        blocks: Range<usize>,
        lcs_top: usize,
        mut enough: impl FnMut(usize, usize, &Row) -> bool,
    ) {
        let (s, first, end) = (self.strips.len(), blocks.start as u32, blocks.end as u32);
        self.load_masks(s, columns);
        let start = self.carries.len() as u32;
        let (mut v, mut lcs) = (ONES, lcs_top);
        let mut at = first;
        while at < end {
            self.saved.push(v);
            let y = at as usize * 64;
            let rows = &b[y..b.len().min(y + 64)];
            let carries_in = self.carries_into(s, at);
            let masks = &*self.masks.0;
            let out = block(&mut v, rows, &self.slot, masks, carries_in);
            self.carries.push(out);
            lcs += out.count_ones() as usize;
            at += 1;
            if enough(y + rows.len(), lcs, &v) {
                break;
            }
        }
        self.strips.push(Strip {
            first,
            end: at,
            start,
            lcs_top: lcs_top as u32,
        });
    }

    fn row_above(&self, s: usize, at: u32) -> Row {
        let strip = &self.strips[s];
        self.saved[(strip.start + at - strip.first) as usize]
    }

    /// Puts row `top` into `rows`. Returns it, and the carries into the rows below.
    fn start_rows(&mut self, s: usize, top: usize, last: usize) -> (Row, u64) {
        debug_assert!(top.is_multiple_of(64) && top < last && last <= top + 64);
        let at = (top / 64) as u32;
        let v = self.row_above(s, at);
        self.rows.clear();
        self.rows.push((v, ZEROS));
        (v, self.carries_into(s, at))
    }

    /// Recomputes rows `top..=last` of strip `s`, all of one block. The strip's masks have to be loaded.
    fn fill_rows<T: Elem>(&mut self, b: &[T], s: usize, top: usize, last: usize) {
        let (mut v, mut carries_in) = self.start_rows(s, top, last);
        let masks = &*self.masks.0;
        for e in &b[top..last] {
            let mask = &masks[self.slot[e.id()] as usize % MASKS];
            let old = v;
            let sum = step(&mut v, mask, &mut carries_in, &mut 0);
            let mut out = ZEROS;
            for w in 0..WORDS {
                out[w] = old[w] & (mask[w] | !sum[w]);
            }
            self.rows.push((v, out));
        }
    }

    /// After `forward` gave `Within(distance)`: fills `corridor[0..=distance]` with where minimal paths are after so many
    /// edits, and returns the furthest point after `half` edits on the highest (`high`) or lowest of their diagonals.
    pub(crate) fn trace<T: Elem>(
        &mut self,
        a: &[T],
        b: &[T],
        half: usize,
        high: bool,
        corridor: &mut [Level],
    ) -> (usize, usize) {
        let distance = corridor.len() - 1;
        corridor.fill(Level {
            to: a.len() as i32,
            ..Level::default()
        });
        let end = At {
            x: a.len(),
            y: b.len(),
            edits: distance,
        };
        let (mut lo, mut hi) = (end, end);
        let (mut lo_half, mut hi_half) = (end, end);
        macro_rules! edit {
            ($at:ident, $axis:ident, $side:tt, $half:ident) => {{
                let level = &mut corridor[$at.edits];
                level.$side = $at.x as i32 - $at.y as i32;
                level.from = level.from.max($at.x as i32);
                $at.edits -= 1;
                $at.$axis -= 1;
                let level = &mut corridor[$at.edits];
                level.to = level.to.min($at.x as i32);
                if $at.edits == half {
                    $half = $at;
                }
            }};
        }
        for s in (0..self.strips.len()).rev() {
            let x0 = s * STRIP;
            let columns = &a[x0..a.len().min(x0 + STRIP)];
            let strip_top = self.strips[s].first as usize * 64;
            self.load_masks(s, columns);
            loop {
                let y_of = |p: At| if p.x > x0 { p.y } else { 0 };
                let last = y_of(lo).max(y_of(hi));
                if last <= strip_top {
                    break;
                }
                let top = top_of_block(last);
                self.fill_rows(b, s, top, last);
                let rows = &self.rows[..];
                while lo.x > x0 && lo.y > top {
                    let i = lo.x - x0 - 1;
                    if rows[lo.y - top].0[i / 64 % WORDS] >> (i % 64) & 1 != 0 {
                        edit!(lo, x, lo, lo_half);
                    } else if a[lo.x - 1] == b[lo.y - 1] {
                        lo.x -= 1;
                        lo.y -= 1;
                    } else {
                        edit!(lo, y, lo, lo_half);
                    }
                }
                while hi.x > x0 && hi.y > top {
                    let i = hi.x - x0 - 1;
                    if rows[hi.y - top].1[i / 64 % WORDS] >> (i % 64) & 1 == 0 {
                        edit!(hi, y, hi, hi_half);
                    } else if a[hi.x - 1] == b[hi.y - 1] {
                        hi.x -= 1;
                        hi.y -= 1;
                    } else {
                        edit!(hi, x, hi, hi_half);
                    }
                }
            }
            while lo.x > x0 {
                edit!(lo, x, lo, lo_half);
            }
            while hi.x > x0 {
                edit!(hi, x, hi, hi_half);
            }
        }
        while lo.y > 0 {
            edit!(lo, y, lo, lo_half);
        }
        while hi.y > 0 {
            edit!(hi, y, hi, hi_half);
        }
        debug_assert!(lo.edits == 0 && hi.edits == 0);
        let from = if high { hi_half } else { lo_half };
        self.furthest(a, b, from.x, from.y)
    }

    /// The last point on the diagonal of (x, y) that takes no more edits. (x, y) has to be on a minimal path.
    fn furthest<T: Elem>(
        &mut self,
        a: &[T],
        b: &[T],
        mut x: usize,
        mut y: usize,
    ) -> (usize, usize) {
        loop {
            let same = T::common_prefix(&a[x..], &b[y..]);
            x += same;
            y += same;
            if x == a.len() || y == b.len() {
                return (x, y);
            }
            let s = x / STRIP;
            let strip = &self.strips[s];
            let strip_end = b.len().min(strip.end as usize * 64);
            if y < strip.first as usize * 64 || y >= strip_end {
                return (x, y);
            }
            let x0 = s * STRIP;
            let columns = &a[x0..a.len().min(x0 + STRIP)];
            let top = top_of_block(y + 1);
            let last = strip_end.min(top + 64);
            self.load_masks(s, columns);
            self.fill_rows(b, s, top, last);
            while x < x0 + columns.len() && y < last {
                let i = x - x0;
                let (w, bit) = (i / 64 % WORDS, i % 64);
                let across = !self.rows[y - top].0[w] >> bit & 1;
                let down = self.rows[y + 1 - top].1[w] >> bit & 1;
                if across + down == 0 {
                    return (x, y);
                }
                x += 1;
                y += 1;
            }
        }
    }
}
