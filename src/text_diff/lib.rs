//! Line- and character-level diffing for test-runner output. [`tokens`] and
//! [`patch`] are `Bun.diff`.
//!
//! The core is Myers' O(ND) algorithm in its linear-space, bidirectional
//! ("middle snake") form, made unconditional-time-limit-free by bounding
//! *work* instead: every box first gets a cheap exact attempt; a box that
//! exceeds it is searched exhaustively up to a depth its size justifies, then
//! cut at a skeleton of unique, in-order common lines if it has a strong one,
//! and only past that cut greedily at the point of furthest progress. A box with
//! so many edits that Myers would be slow is searched with bit vectors instead
//! (`bits`), and cut at the same points. Lines that cannot match anything are
//! eliminated before the search, so in practice almost every input is solved
//! exactly and the rest degrade predictably instead of falling off a cliff.
//!
//! The semantic post-processing (`cleanup_semantic`) is a port of the
//! corresponding passes from diff-match-patch, operating on index ranges
//! instead of owned strings.
//
// diff-match-patch is Copyright 2018 The diff-match-patch Authors,
// licensed under the Apache License, Version 2.0.

mod bit_rows;
mod bits;
mod lines;
#[cfg(test)]
#[path = "../parsers/native_test_shims.rs"]
mod native_test_shims;
pub mod patch;
pub mod tokens;

use core::ops::Range;
use std::borrow::Cow;
use std::collections::BTreeMap;

use bits::{Bits, Level, Pass, STRIP};
use bun_core::strings::{
    count_char, index_of, index_of_char_usize as index_of_char, last_index_of_char,
};
use bun_wyhash::hash as hash_bytes;

/// `a[a_lo..a_hi]` was replaced by `b[b_lo..b_hi]`. Either range may be empty
/// (pure insertion / pure deletion) but not both. A list of hunks is sorted,
/// non-overlapping, and everything between consecutive hunks is equal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hunk {
    pub a_lo: usize,
    pub a_hi: usize,
    pub b_lo: usize,
    pub b_hi: usize,
}

impl Hunk {
    #[inline]
    pub fn deleted(&self) -> usize {
        self.a_hi - self.a_lo
    }
    #[inline]
    pub fn inserted(&self) -> usize {
        self.b_hi - self.b_lo
    }
    #[inline]
    fn is_single_edit(&self) -> bool {
        self.deleted() == 0 || self.inserted() == 0
    }
    #[inline]
    fn touches(&self, next: &Hunk) -> bool {
        self.a_hi == next.a_lo && self.b_hi == next.b_lo
    }
}

// ───────────────────────────── element types ─────────────────────────────

pub trait Elem: Copy + Eq {
    /// Whether the elements are token ids, to which the unique-token anchor split applies.
    const ANCHORED: bool = false;
    /// How many ids there are, if the type says so.
    const IDS: Option<usize> = None;
    /// The element as an index into a table.
    fn id(self) -> usize;
    fn is_newline(self) -> bool {
        false
    }
    /// Whether the element goes on with a character that an earlier element began. No hunk starts or ends before it.
    fn continues_character(self) -> bool {
        false
    }
    /// The first place of `needle` in `hay`. What the search costs is taken from `budget`; with none left it finds
    /// nothing.
    fn find(hay: &[Self], needle: &[Self], budget: &mut isize) -> Option<usize> {
        let (first, rest) = needle.split_first()?;
        let last = hay.len().checked_sub(needle.len())?;
        let mut at = 0;
        while at <= last && *budget > 0 {
            *budget -= 1;
            if hay[at] == *first {
                let same = Self::common_prefix(&hay[at + 1..], rest);
                *budget -= same as isize + 1;
                if same == rest.len() {
                    return Some(at);
                }
            }
            at += 1;
        }
        None
    }
    fn common_prefix(a: &[Self], b: &[Self]) -> usize {
        let n = a.len().min(b.len());
        let mut i = 0;
        while i < n && a[i] == b[i] {
            i += 1;
        }
        i
    }
    fn common_suffix(a: &[Self], b: &[Self]) -> usize {
        let n = a.len().min(b.len());
        let mut i = 0;
        while i < n && a[a.len() - 1 - i] == b[b.len() - 1 - i] {
            i += 1;
        }
        i
    }
}

/// How much of a needle is looked for first. `MemMemPickAnchors` (highway_strings.cpp) reads a longer one three times.
const NEEDLE_START: usize = 16;

fn index_of_by_start(hay: &[u8], needle: &[u8]) -> Option<usize> {
    // In a far longer `hay`, the rare bytes that `index_of` picks from the whole needle save more than they cost.
    // 4, because `half_match_around` looks for a quarter of the longer side.
    if needle.len() <= NEEDLE_START || hay.len() / 4 > needle.len() {
        return index_of(hay, needle);
    }
    let (start, rest) = needle.split_at(NEEDLE_START);
    let starts = &hay[..hay.len().checked_sub(rest.len())?];
    let mut from = 0;
    // Each try can read all of `rest`: without a limit this is quadratic if `start` is everywhere.
    for _ in 0..8 {
        let at = from + index_of(&starts[from..], start)?;
        if hay[at + start.len()..].starts_with(rest) {
            return Some(at);
        }
        from = at + 1;
    }
    Some(from + index_of(&hay[from..], needle)?)
}

impl Elem for u32 {
    const ANCHORED: bool = true;
    #[inline]
    fn id(self) -> usize {
        self as usize
    }
}

/// A code unit of UTF-16.
impl Elem for u16 {
    const IDS: Option<usize> = Some(1 << 16);
    #[inline]
    fn id(self) -> usize {
        self as usize
    }
    #[inline]
    fn continues_character(self) -> bool {
        (self & 0xFC00) == 0xDC00
    }
}

impl Elem for u8 {
    const IDS: Option<usize> = Some(1 << 8);
    #[inline]
    fn id(self) -> usize {
        self as usize
    }
    #[inline]
    fn is_newline(self) -> bool {
        self == b'\n'
    }
    #[inline]
    fn continues_character(self) -> bool {
        (self & 0xC0) == 0x80
    }
    fn find(hay: &[u8], needle: &[u8], budget: &mut isize) -> Option<usize> {
        if *budget <= 0 {
            return None;
        }
        let found = index_of_by_start(hay, needle);
        *budget -= found.map_or(hay.len(), |at| at + needle.len()) as isize;
        found
    }
    #[inline]
    fn common_prefix(a: &[u8], b: &[u8]) -> usize {
        let n = a.len().min(b.len());
        let (a, b) = (&a[..n], &b[..n]);
        let mut i = 0;
        // Block compare lowers to a couple of vector ops; then locate the
        // differing byte a word at a time.
        while i + 64 <= n && a[i..i + 64] == b[i..i + 64] {
            i += 64;
        }
        while i + 8 <= n {
            let x = u64::from_le_bytes(a[i..i + 8].try_into().unwrap())
                ^ u64::from_le_bytes(b[i..i + 8].try_into().unwrap());
            if x != 0 {
                return i + (x.trailing_zeros() / 8) as usize;
            }
            i += 8;
        }
        while i < n && a[i] == b[i] {
            i += 1;
        }
        i
    }
    #[inline]
    fn common_suffix(a: &[u8], b: &[u8]) -> usize {
        let n = a.len().min(b.len());
        let (a, b) = (&a[a.len() - n..], &b[b.len() - n..]);
        let mut i = 0;
        while i + 64 <= n && a[n - i - 64..n - i] == b[n - i - 64..n - i] {
            i += 64;
        }
        while i + 8 <= n {
            let x = u64::from_le_bytes(a[n - i - 8..n - i].try_into().unwrap())
                ^ u64::from_le_bytes(b[n - i - 8..n - i].try_into().unwrap());
            if x != 0 {
                return i + (x.leading_zeros() / 8) as usize;
            }
            i += 8;
        }
        while i < n && a[n - 1 - i] == b[n - 1 - i] {
            i += 1;
        }
        i
    }
}

// ───────────────────────────── Myers core ─────────────────────────────

const NONE: i32 = i32::MIN / 2;

type Point = (usize, usize);
/// (alo, ahi, blo, bhi): `a[alo..ahi]` × `b[blo..bhi]`.
type Rect = (usize, usize, usize, usize);

struct Sides<'a, T> {
    long: &'a [T],
    short: &'a [T],
}

enum Split {
    /// A point on an optimal path, and the edit distance.
    Exact(Point, usize),
    /// Out of depth: best forward point and best reverse point (either may
    /// coincide with a corner, in which case it is useless).
    Greedy(Point, Point),
}

/// How hard each box is searched. All limits count Myers "steps" (one
/// diagonal advanced by one edit), so behaviour is deterministic.
#[derive(Clone, Copy)]
pub(crate) struct Policy {
    /// Depth of the first, cheap exact attempt in every box. Edit distances up
    /// to about twice this are always solved exactly.
    pub probe: usize,
    /// The second, exhaustive attempt may spend about `exhaustive_per_elem`
    /// steps per element of the box, but no more than `exhaustive_quota`
    /// steps' worth of depth·size in total and never deeper than
    /// `exhaustive_max` — i.e. depth = min(max, √(per_elem·n), quota / n).
    /// The last term is what a fixed time limit on an O(ND) search amounts to.
    pub exhaustive_max: usize,
    pub exhaustive_per_elem: usize,
    pub exhaustive_quota: usize,
    /// Total steps for the whole diff, as `middle` would take them; once spent, unsolved boxes
    /// are emitted as wholesale replacements. Also the start of `Myers::drop_left`.
    pub work: usize,
    /// Not 0: before a box is searched it is cut as fast-diff cuts it (see
    /// `CharDiff::diff_as_fast_diff`), which may spend this many steps per
    /// element of the whole input, and `HALF_MATCH_FLOOR` more.
    pub half_match: usize,
}

struct Myers<'a, 's, T: Elem> {
    a: &'a [T],
    b: &'a [T],
    vf: &'s mut Vec<i32>,
    vb: &'s mut Vec<i32>,
    stack: &'s mut Vec<Job>,
    bits: &'s mut Option<Box<Bits>>,
    /// Where minimal paths of the boxes that `bits` solved are; see `Job::levels`.
    /// In coordinates of the whole of `a` and `b`.
    corridor: &'s mut Vec<Level>,
    /// Whether `bits` has room for every id of `a` and `b`.
    bits_fit: bool,
    /// Scratch for the ends of a box's two sides, back to front.
    reversed: [Vec<T>; 2],
    /// Elements of `a` per edit between the corners and the points where `middle` last gave up. Only chooses between
    /// `reach` and `middle`.
    pace: Option<usize>,
    policy: Policy,
    /// Steps left out of `policy.work`.
    work_left: isize,
    /// Steps left for `policy.half_match`.
    half_left: isize,
    /// Elements of reverse progress that cuts at the forward point may still throw away. The next box compares them
    /// again, and `work_left` does not count that.
    drop_left: isize,
    /// Scratch for the unique-token anchor split; sized by the largest id
    /// and only allocated if some box ever needs it.
    anchors: Option<Anchors>,
}

#[derive(Default)]
struct MyersScratch {
    vf: Vec<i32>,
    vb: Vec<i32>,
    stack: Vec<Job>,
    bits: Option<Box<Bits>>,
    corridor: Vec<Level>,
}

/// Scratch for the unique-token anchor split (line mode only).
struct Anchors {
    count_a: Vec<u32>,
    count_b: Vec<u32>,
    pos_b: Vec<u32>,
    pairs: Vec<(u32, u32)>,
    tails: Vec<u32>,
    prev: Vec<u32>,
}

impl Anchors {
    fn new(ids: usize) -> Self {
        Self {
            count_a: vec![0; ids],
            count_b: vec![0; ids],
            pos_b: vec![0; ids],
            pairs: Vec::new(),
            tails: Vec::new(),
            prev: Vec::new(),
        }
    }

    /// Queues the boxes between the longest run of `pairs` that is in order on both sides, if that is long enough.
    fn split(
        &mut self,
        (alo, ahi, blo, bhi): Rect,
        probe: usize,
        keep: usize,
        stack: &mut Vec<Job>,
    ) -> bool {
        let needed = ((ahi - alo).min(bhi - blo) / ANCHOR_COVERAGE).max(1);
        if self.pairs.len() < needed {
            return false;
        }

        // Longest increasing subsequence of `pairs` by b-position (a is
        // already increasing). tails[k] = index of the pair ending the best
        // run of length k+1; prev[] threads the chosen run back.
        self.tails.clear();
        self.prev.clear();
        self.prev.resize(self.pairs.len(), u32::MAX);
        for (idx, &(_, j)) in self.pairs.iter().enumerate() {
            let pos = self
                .tails
                .partition_point(|&t| self.pairs[t as usize].1 < j);
            if pos > 0 {
                self.prev[idx] = self.tails[pos - 1];
            }
            if pos == self.tails.len() {
                self.tails.push(idx as u32);
            } else {
                self.tails[pos] = idx as u32;
            }
        }
        let Some(&(mut cur)) = self.tails.last().filter(|_| self.tails.len() >= needed) else {
            return false;
        };
        // Reuse `tails` to hold the run itself, last to first.
        self.tails.clear();
        while cur != u32::MAX {
            self.tails.push(cur);
            cur = self.prev[cur as usize];
        }

        let (mut ea, mut eb) = (ahi, bhi);
        let mut push = |alo: usize, ahi: usize, blo: usize, bhi: usize| {
            if alo < ahi || blo < bhi {
                stack.push(Job::new((alo, blo), (ahi, bhi), probe, true, keep));
            }
        };
        for &pi in self.tails.iter() {
            let (i, j) = self.pairs[pi as usize];
            let (i, j) = (i as usize, j as usize);
            push(i + 1, ea, j + 1, eb);
            (ea, eb) = (i, j);
        }
        push(alo, ea, blo, eb);
        true
    }
}

/// A sub-box `a[alo..ahi] × b[blo..bhi]` still to be solved. There can be one for each anchor.
struct Job {
    alo: u32,
    ahi: u32,
    blo: u32,
    bhi: u32,
    probe: u32,
    /// Whether an exhaustive attempt is still allowed in this box; false
    /// below a greedy cut, where the result is approximate anyway.
    exhaustive: bool,
    /// For a box whose corners are on a minimal path of a box that `bits`
    /// solved: its first and last entry of `corridor`, which are as far apart
    /// as it has edits.
    levels: Option<(u32, u32)>,
    /// The box has at least this many edits.
    least: u32,
    /// How much of `corridor` this box and those below it on the stack need.
    keep: u32,
}

impl Job {
    fn new(
        (alo, blo): (usize, usize),
        (ahi, bhi): (usize, usize),
        probe: usize,
        exhaustive: bool,
        keep: usize,
    ) -> Self {
        Self {
            alo: alo as u32,
            ahi: ahi as u32,
            blo: blo as u32,
            bhi: bhi as u32,
            probe: probe as u32,
            exhaustive,
            levels: None,
            least: 0,
            keep: keep as u32,
        }
    }
}

impl<'a, 's, T: Elem> Myers<'a, 's, T> {
    fn new(a: &'a [T], b: &'a [T], sc: &'s mut MyersScratch, policy: Policy) -> Self {
        debug_assert!(a.len().max(b.len()) < MAX_LEN);
        let MyersScratch {
            vf,
            vb,
            stack,
            bits,
            corridor,
        } = sc;
        Self {
            a,
            b,
            vf,
            vb,
            stack,
            bits,
            corridor,
            bits_fit: false,
            reversed: [Vec::new(), Vec::new()],
            pace: None,
            policy,
            work_left: policy.work as isize,
            half_left: match policy.half_match {
                0 => 0,
                per_element => (per_element * (a.len() + b.len()) + HALF_MATCH_FLOOR) as isize,
            },
            drop_left: policy.work as isize,
            anchors: None,
        }
    }

    /// Marks every element of `a[a_rng]` / `b[b_rng]` that is not part of a
    /// longest common subsequence as changed.
    ///
    /// Each box gets a cheap exact attempt first. If that runs out of depth
    /// the exact search is retried with as much depth as the box size
    /// justifies; failing that (or if the box is too big to justify any), a
    /// box with a strong skeleton of unique, in-order common lines is cut at
    /// those; and only then is it cut greedily at the point of furthest
    /// progress. `search` charges these attempts and finds what they would
    /// find, but need not make them.
    fn run(
        &mut self,
        a_rng: Range<usize>,
        b_rng: Range<usize>,
        changed_a: &mut [bool],
        changed_b: &mut [bool],
    ) {
        let mut stack = core::mem::take(self.stack);
        stack.clear();
        stack.push(Job::new(
            (a_rng.start, b_rng.start),
            (a_rng.end, b_rng.end),
            self.policy.probe,
            true,
            0,
        ));
        while let Some(job) = stack.pop() {
            let [mut alo, mut ahi, mut blo, mut bhi] =
                [job.alo, job.ahi, job.blo, job.bhi].map(|it| it as usize);
            let [probe, least, keep] = [job.probe, job.least, job.keep].map(|it| it as usize);
            let levels = (job.levels).map(|(first, last)| (first as usize, last as usize));
            let exhaustive = job.exhaustive;
            self.corridor.truncate(keep);
            let p = T::common_prefix(&self.a[alo..ahi], &self.b[blo..bhi]);
            alo += p;
            blo += p;
            let s = T::common_suffix(&self.a[alo..ahi], &self.b[blo..bhi]);
            ahi -= s;
            bhi -= s;

            if alo == ahi {
                changed_b[blo..bhi].fill(true);
                continue;
            }
            if blo == bhi {
                changed_a[alo..ahi].fill(true);
                continue;
            }
            if ahi - alo == 1 {
                let x = self.a[alo];
                changed_b[blo..bhi].fill(true);
                match self.b[blo..bhi].iter().position(|&y| y == x) {
                    Some(j) => changed_b[blo + j] = false,
                    None => changed_a[alo] = true,
                }
                continue;
            }
            if bhi - blo == 1 {
                let y = self.b[blo];
                changed_a[alo..ahi].fill(true);
                match self.a[alo..ahi].iter().position(|&x| x == y) {
                    Some(i) => changed_a[alo + i] = false,
                    None => changed_b[blo] = true,
                }
                continue;
            }
            if self.policy.half_match > 0 {
                let (a, b) = (&self.a[alo..ahi], &self.b[blo..bhi]);
                if a.len() > b.len() {
                    if let Some(at) = T::find(a, b, &mut self.half_left) {
                        changed_a[alo..alo + at].fill(true);
                        changed_a[alo + at + b.len()..ahi].fill(true);
                        continue;
                    }
                } else if let Some(at) = T::find(b, a, &mut self.half_left) {
                    changed_b[blo..blo + at].fill(true);
                    changed_b[blo + at + a.len()..bhi].fill(true);
                    continue;
                }
                if let Some((in_a, in_b)) = half_match(a, b, &mut self.half_left) {
                    let before = (alo + in_a.start, blo + in_b.start);
                    let after = (alo + in_a.end, blo + in_b.end);
                    stack.push(Job::new((alo, blo), before, probe, exhaustive, keep));
                    stack.push(Job::new(after, (ahi, bhi), probe, exhaustive, keep));
                    continue;
                }
            }
            if self.work_left <= 0 {
                changed_a[alo..ahi].fill(true);
                changed_b[blo..bhi].fill(true);
                continue;
            }

            let bx = (alo, ahi, blo, bhi);
            let inside = |p: Point| p != (alo, blo) && p != (ahi, bhi);
            let (depth, fronts) = match self.search(bx, levels, least, probe, exhaustive) {
                Found::Split(at, levels) if inside(at) => {
                    let keep = self.corridor.len();
                    let mut halves = [
                        Job::new((alo, blo), at, probe, exhaustive, keep),
                        Job::new(at, (ahi, bhi), probe, exhaustive, keep),
                    ];
                    if let Some((first, last)) = levels {
                        let half = first + (last - first).div_ceil(2);
                        halves[0].levels = Some((first as u32, half as u32));
                        halves[1].levels = Some((half as u32, last as u32));
                    }
                    stack.extend(halves);
                    continue;
                }
                Found::Split(at, _) => {
                    debug_assert!(false, "middle snake ended on a corner");
                    (0, Some((at, at)))
                }
                Found::TooFar(depth, fronts) => (depth, fronts),
            };
            // Not below a greedy cut: the region is already approximate, and
            // re-scanning every sub-box would be quadratic.
            if T::ANCHORED && exhaustive && self.split_at_anchors(alo, ahi, blo, bhi, &mut stack) {
                continue;
            }
            let (f, r) = fronts.unwrap_or_else(|| self.fronts(bx, depth));
            self.pace = Some(pace(bx, depth, (f, r)));

            // Cut at whichever of the two points lie strictly inside the box
            // (both, if the forward one precedes the reverse one). If they cross:
            // the forward one until `drop_left` is spent, then the one that got further.
            let mut cuts = [(alo, blo); 4];
            let mut n = 1;
            let in_order = f.0 <= r.0 && f.1 <= r.1 && f != r;
            let forward = (f.0 - alo) + (f.1 - blo);
            let reverse = (ahi - r.0) + (bhi - r.1);
            if inside(f) && (in_order || self.drop_left > 0 || forward >= reverse) {
                cuts[n] = f;
                n += 1;
                if !in_order {
                    self.drop_left -= reverse as isize;
                }
            }
            if inside(r) && (n == 1 || in_order) {
                cuts[n] = r;
                n += 1;
            }
            if n == 1 {
                changed_a[alo..ahi].fill(true);
                changed_b[blo..bhi].fill(true);
                continue;
            }
            cuts[n] = (ahi, bhi);
            let probe = (probe / 2).max(MIN_PROBE);
            for c in 0..n {
                let mut job = Job::new(cuts[c], cuts[c + 1], probe, false, keep);
                // An outer part has at least `depth` edits: a greedy point is exactly that far from its corner, or
                // the search would have got further, and further from the other, as the box has over 2 * depth.
                if c == 0 || c + 1 == n {
                    job.least = depth as u32;
                }
                stack.push(job);
            }
        }
        *self.stack = stack;
    }

    /// Looks for the point at which `middle` would cut the box, as deep as the policy allows. However it is found,
    /// `work_left` falls by what `middle` would have taken.
    fn search(
        &mut self,
        bx: Rect,
        levels: Option<(usize, usize)>,
        least: usize,
        probe: usize,
        exhaustive: bool,
    ) -> Found {
        let (distance, at) = match levels {
            Some((first, last)) => (last - first, None),
            None => match self.solve(bx, least, probe, exhaustive) {
                Solved::Distance(distance, at) => (distance, at),
                Solved::TooFar(fronts) => return self.too_far(bx, probe, exhaustive, fronts),
            },
        };
        let half = distance.div_ceil(2);
        if half > probe {
            if half > self.second_depth(bx, probe, exhaustive) {
                return self.too_far(bx, probe, exhaustive, None);
            }
            self.work_left -= in_vain(probe);
        }
        self.work_left -= ((half + 1) * (half + 2 - distance % 2)) as isize;
        match (at, levels) {
            (Some(at), _) => Found::Split(at, None),
            (None, Some(levels)) => match self.split_in_corridor(bx, levels) {
                Some(at) => Found::Split(at, Some(levels)),
                None => match self.middle(bx, half) {
                    Split::Exact(at, _) => Found::Split(at, None),
                    Split::Greedy(f, r) => Found::TooFar(half, Some((f, r))),
                },
            },
            (None, None) => {
                let first = self.corridor.len();
                let levels = (first, first + distance);
                self.corridor.resize(levels.1 + 1, Level::default());
                let at = self.trace(bx, levels, first + half, distance % 2 == 0);
                Found::Split(at, Some(levels))
            }
        }
    }

    /// Charges the attempts that `middle` would have made in vain.
    fn too_far(
        &mut self,
        bx: Rect,
        probe: usize,
        exhaustive: bool,
        fronts: Option<(Point, Point)>,
    ) -> Found {
        let deep = self.second_depth(bx, probe, exhaustive);
        self.work_left -= in_vain(probe);
        if deep > probe {
            self.work_left -= in_vain(deep);
        }
        Found::TooFar(probe.max(deep), fronts)
    }

    /// The depth of the second, exhaustive attempt in a box. There is none if that is not above `probe`.
    fn second_depth(&self, (alo, ahi, blo, bhi): Rect, probe: usize, exhaustive: bool) -> usize {
        if !exhaustive {
            return 0;
        }
        let left = self.work_left - in_vain(probe);
        self.policy
            .exhaustive_depth((ahi - alo) + (bhi - blo))
            .min((left.max(0) as usize / 2).isqrt())
    }

    /// `middle` looks for the box's edit distance first, for about as long as `bits` would take.
    fn solve(&mut self, bx: Rect, least: usize, probe: usize, exhaustive: bool) -> Solved {
        let (n, m) = (bx.1 - bx.0, bx.3 - bx.2);
        let (long, short) = (n.max(m), n.min(m));
        let crossover = crossover(long, short);
        let least = least.max(long - short);
        let deepest = |me: &Self| probe.max(me.second_depth(bx, probe, exhaustive));
        // Close to the policy's depth, `bits` saves little if the search succeeds and is lost if it fails.
        let is_close = 2 * crossover > probe && 2 * crossover > deepest(self);
        let mut depth = if is_close { deepest(self) } else { crossover };
        let patience = match crossover * 5 / 2 {
            patience if patience <= probe => patience,
            patience => patience.min(deepest(self)),
        };
        let mut beyond = least.saturating_sub(1);
        let mut expected = least + least / 8;
        if least <= 2 * depth {
            match self.middle_with_patience(bx, &mut depth, patience) {
                Split::Exact(at, distance) => return Solved::Distance(distance, Some(at)),
                Split::Greedy(f, r) if depth == deepest(self) => {
                    return Solved::TooFar(Some((f, r)));
                }
                Split::Greedy(f, r) => {
                    let progress = (f.0 - bx.0) + (f.1 - bx.2) + (bx.1 - r.0) + (bx.3 - r.1);
                    expected = expected.max(2 * depth * (n + m) / progress.max(1));
                    beyond = beyond.max(2 * depth);
                }
            }
        }
        let mut limit = 2 * deepest(self);
        if beyond < limit && expected >= GUESS_FROM {
            let guess = self.guess(bx, limit);
            if guess < limit {
                (limit, expected) = (guess, guess);
            }
        }
        match self.measure(bx, beyond, expected, limit) {
            Some(distance) => Solved::Distance(distance, None),
            None => Solved::TooFar(None),
        }
    }

    /// The box's edit distance, which is above `beyond` and perhaps about `expected`, if it is at most `limit`.
    #[inline(never)]
    fn measure(
        &mut self,
        bx: Rect,
        mut beyond: usize,
        mut expected: usize,
        limit: usize,
    ) -> Option<usize> {
        let (n, m) = (bx.1 - bx.0, bx.3 - bx.2);
        let (long, delta) = (n.max(m), n.abs_diff(m));
        while beyond < limit {
            // Too low a bound usually shows early; too high a one makes every column cost more.
            let least = beyond + beyond.saturating_sub(delta) / 4 + (long / 64).min(1024) + 64;
            let bound = (expected + expected / 12 + 32)
                .clamp(least, 4 * beyond + least)
                .min(limit);
            match self.forward(bx, bound) {
                Pass::Within(distance) => return Some(distance),
                Pass::Beyond(x) => {
                    beyond = bound;
                    expected = delta + (bound - delta) * long / x;
                }
            }
        }
        None
    }

    /// The points that `middle` gives at this depth in a box of more than twice as many edits.
    fn fronts(&mut self, bx: Rect, depth: usize) -> (Point, Point) {
        let mut pace = || {
            let depth = depth.min(MIN_PROBE);
            self.pace.unwrap_or_else(|| match self.middle(bx, depth) {
                Split::Greedy(f, r) => pace(bx, depth, (f, r)),
                Split::Exact(..) => 0,
            })
        };
        if let Some(budget) = reach_budget(bx.1 - bx.0, depth, &mut pace)
            && let Some(fronts) = self.reach(bx, depth, budget)
        {
            return fronts;
        }
        match self.middle(bx, depth) {
            Split::Greedy(f, r) => (f, r),
            Split::Exact(at, _) => {
                debug_assert!(false, "the box has more than 2 * depth edits");
                (at, at)
            }
        }
    }

    /// What `fronts` returns, found by `bits`. `None` if `budget` words are not enough.
    fn reach(
        &mut self,
        (alo, ahi, blo, bhi): Rect,
        depth: usize,
        mut budget: usize,
    ) -> Option<(Point, Point)> {
        let (a, b) = (&self.a[alo..ahi], &self.b[blo..bhi]);
        let f = self.bits().reach(a, b, depth, &mut budget)?;
        let f = (alo + f.0, blo + f.1);
        for (copy, side) in self.reversed.iter_mut().zip([a, b]) {
            copy.clear();
            copy.extend(side.iter().rev().take(bits::out_of_reach(budget)));
        }
        let [a, b] = &self.reversed;
        let bits = self.bits.get_or_insert_default();
        let r = bits.reach(a, b, depth, &mut budget)?;
        Some((f, (ahi - r.0, bhi - r.1)))
    }

    fn bits(&mut self) -> &mut Bits {
        let bits = self.bits.get_or_insert_default();
        if !self.bits_fit {
            self.bits_fit = true;
            let elements = self.a.len() + self.b.len();
            bits.reserve_ids(T::IDS.filter(|&ids| ids <= elements).unwrap_or_else(|| {
                let ids = self.a.iter().chain(self.b).map(|e| e.id());
                ids.max().unwrap_or(0) + 1
            }));
        }
        bits
    }

    fn sides(&self, (alo, ahi, blo, bhi): Rect) -> Sides<'a, T> {
        let (a, b) = (&self.a[alo..ahi], &self.b[blo..bhi]);
        let (long, short) = if a.len() >= b.len() { (a, b) } else { (b, a) };
        Sides { long, short }
    }

    fn guess(&mut self, bx: Rect, limit: usize) -> usize {
        let Sides { long, short } = self.sides(bx);
        self.bits().guess(long, short, limit)
    }

    fn forward(&mut self, bx: Rect, bound: usize) -> Pass {
        let Sides { long, short } = self.sides(bx);
        self.bits().forward(long, short, bound)
    }

    /// After `forward` found the distance: fills in the box's levels of `corridor`, and returns the furthest point of
    /// level `half` on its highest (`even`) or lowest diagonal.
    fn trace(
        &mut self,
        (alo, ahi, blo, bhi): Rect,
        (first, last): (usize, usize),
        half: usize,
        even: bool,
    ) -> Point {
        let (a, b) = (&self.a[alo..ahi], &self.b[blo..bhi]);
        let corridor = &mut self.corridor[first..=last];
        let bits = self.bits.get_or_insert_default();
        let swapped = a.len() < b.len();
        let at = if swapped {
            bits.trace(b, a, half - first, !even, corridor)
        } else {
            bits.trace(a, b, half - first, even, corridor)
        };
        to_whole(corridor, at, (alo, blo), swapped)
    }

    /// The point at which `middle` would cut a box whose corners are on a minimal path of a box that `bits` solved.
    fn split_in_corridor(&mut self, bx: Rect, levels: (usize, usize)) -> Option<Point> {
        let (mut alo, mut ahi, mut blo, mut bhi) = bx;
        let half = levels.0 + (levels.1 - levels.0).div_ceil(2);
        let even = (levels.1 - levels.0) % 2 == 0;
        let shared = |e: &usize| self.corridor[*e].is_shared();
        // Only what lies between the points nearest `half` that all minimal paths share has to be searched.
        let first = (levels.0 + 1..=half).rfind(shared).unwrap_or(levels.0);
        if first > levels.0 {
            let c = self.corridor[first];
            (alo, blo) = (c.to as usize, (c.to - c.lo) as usize);
        }
        if first == half {
            let same = T::common_prefix(&self.a[alo..ahi], &self.b[blo..bhi]);
            return Some((alo + same, blo + same));
        }
        let last = (half + 1..levels.1).find(shared).unwrap_or(levels.1);
        if last < levels.1 {
            let c = self.corridor[last];
            (ahi, bhi) = (c.from as usize, (c.from - c.lo) as usize);
        }
        let bx = (alo, ahi, blo, bhi);
        let (n, m) = (ahi - alo, bhi - blo);
        let distance = last - first;
        if distance >= MIN_DISTANCE && n.min(m) > 0 {
            let steps: usize = self.corridor[first..=last]
                .iter()
                .enumerate()
                .map(|(e, c)| ((c.hi - c.lo) as usize / 2).min(e).min(distance - e))
                .sum();
            if steps * WORDS_PER_STEP > words(n.max(m), n.min(m), distance)
                && matches!(self.forward(bx, distance), Pass::Within(found) if found == distance)
            {
                return Some(self.trace(bx, (first, last), half, even));
            }
        }
        self.middle_in_corridor(bx, (first, last), half, even)
    }

    /// `middle` on the diagonals of the corridor alone, meeting at level `half`.
    fn middle_in_corridor(
        &mut self,
        (alo, ahi, blo, bhi): Rect,
        (first, last): (usize, usize),
        half: usize,
        even: bool,
    ) -> Option<Point> {
        let a = &self.a[alo..ahi];
        let b = &self.b[blo..bhi];
        let corridor = &self.corridor[first..=last];
        let (n, m) = (a.len() as i32, b.len() as i32);
        let delta = n - m;
        let distance = (last - first) as i32;
        let origin = alo as i32 - blo as i32;
        let (forward, reverse) = ((half - first) as i32, (last - half) as i32);
        let off = forward.max(reverse) + 1;
        let size = (2 * off + 1) as usize;
        macro_rules! walk {
            ($v:expr, $depth:expr, $a:expr, $b:expr, $snake:ident, |$d:ident| $range:expr) => {{
                $v.clear();
                $v.resize(size, NONE);
                let v = &mut $v[..size];
                v[off as usize] = T::$snake(a, b) as i32;
                let mut range = (0, 0);
                for $d in 1..=$depth {
                    let (lo, hi): (i32, i32) = $range;
                    let left = distance - $d;
                    range = (lo.max(-$d).max(delta - left), hi.min($d).min(delta + left));
                    let mut k = range.0;
                    while k <= range.1 {
                        let i = (k + off) as usize;
                        let mut x = (v[i - 1] + 1).max(v[i + 1]);
                        // If the further move leaves the grid, no minimal path is on this diagonal after this many edits.
                        if x >= 0 && x <= n && x - k <= m {
                            let y = x - k;
                            if x < n && y < m && $a.at(x as usize) == $b.at(y as usize) {
                                x += 1
                                    + T::$snake($a.from(x as usize + 1), $b.from(y as usize + 1))
                                        as i32;
                            }
                            v[i] = x;
                        }
                        k += 2;
                    }
                }
                range
            }};
        }
        let (lo, hi) = walk!(self.vf, forward, a, b, common_prefix, |d| {
            let c = corridor[d as usize];
            (c.lo - origin, c.hi - origin)
        });
        walk!(self.vb, reverse, Rev(a), Rev(b), common_suffix, |d| {
            let c = corridor[(distance - d) as usize];
            (delta + origin - c.hi, delta + origin - c.lo)
        });
        let meets = |k: &i32| {
            (delta - k).abs() <= reverse
                && self.vf[(k + off) as usize] + self.vb[(delta - k + off) as usize] >= n
        };
        let mut diagonals = (0..=(hi - lo) / 2).map(|i| lo + 2 * i);
        let k = match even {
            false => diagonals.find(meets),
            true => diagonals.rfind(meets),
        };
        debug_assert!(k.is_some(), "a minimal path runs through the corridor");
        let k = k?;
        let x = self.vf[(k + off) as usize];
        Some((alo + x as usize, blo + (x - k) as usize))
    }

    /// Patience-style split: tokens that occur exactly once on each side of
    /// the box, taken in their longest jointly-increasing run, are fixed as
    /// matches and the box is cut at each — but only if that run covers a
    /// good part of the box, since a sparse set of "unique" matches in mostly
    /// unrelated text is noise, not structure. Returns false if not applied.
    fn split_at_anchors(
        &mut self,
        alo: usize,
        ahi: usize,
        blo: usize,
        bhi: usize,
        stack: &mut Vec<Job>,
    ) -> bool {
        let (probe, keep) = (self.policy.probe, self.corridor.len());
        self.work_left -= ((ahi - alo) + (bhi - blo)) as isize;
        let (a, b) = (self.a, self.b);
        let an = self.anchors.get_or_insert_with(|| {
            Anchors::new(1 + a.iter().chain(b).map(|t| t.id()).max().unwrap_or(0))
        });
        for &t in &self.a[alo..ahi] {
            an.count_a[t.id()] += 1;
        }
        for (j, &t) in self.b[blo..bhi].iter().enumerate() {
            let id = t.id();
            an.count_b[id] += 1;
            an.pos_b[id] = (blo + j) as u32;
        }
        an.pairs.clear();
        for (i, &t) in self.a[alo..ahi].iter().enumerate() {
            let id = t.id();
            if an.count_a[id] == 1 && an.count_b[id] == 1 {
                an.pairs.push(((alo + i) as u32, an.pos_b[id]));
            }
        }
        for &t in &self.a[alo..ahi] {
            an.count_a[t.id()] = 0;
        }
        for &t in &self.b[blo..bhi] {
            an.count_b[t.id()] = 0;
        }
        an.split((alo, ahi, blo, bhi), probe, keep, stack)
    }

    /// Bidirectional search for a point on an optimal edit path through the box
    /// `a[alo..ahi] × b[blo..bhi]`, giving up after `depth` steps from each
    /// end. The box must have no common prefix or suffix and both sides must
    /// be non-empty.
    ///
    /// `bits` has to find the same points. With D edits in all and d = D / 2 rounded up, it is
    /// `Exact` if d ≤ `depth`: of the diagonals with a point d edits from the start and D - d
    /// from the end, the lowest if D is odd, the highest if even, and there the last point at
    /// most d edits from the start.
    ///
    /// Else each `Greedy` point is, of the points at most `depth` edits from its corner, the one
    /// past the most elements of `a` and `b` together; of several, the one past the fewest of
    /// `a`. (A diagonal can fall short of its furthest point only if a move leaves the grid,
    /// and then a point on that edge is further.)
    fn middle(&mut self, bx: Rect, mut depth: usize) -> Split {
        let patience = depth;
        self.middle_with_patience(bx, &mut depth, patience)
    }

    /// `middle`, which raises `depth` to `patience` if it has found few matches by then, as next to a block that was
    /// moved. Such steps take far less than `WORDS_PER_STEP`.
    fn middle_with_patience(
        &mut self,
        (alo, ahi, blo, bhi): Rect,
        depth: &mut usize,
        patience: usize,
    ) -> Split {
        let a = &self.a[alo..ahi];
        let b = &self.b[blo..bhi];
        let n = a.len() as i32;
        let m = b.len() as i32;
        let delta = n - m;
        let dmax = (n + m + 1) / 2;
        let bmax = dmax.min(patience as i32);
        // Diagonals k ∈ [-bmax-1, bmax+1] are addressable.
        let off = bmax + 1;
        let size = (2 * bmax + 3) as usize;
        self.vf.clear();
        self.vf.resize(size, NONE);
        self.vb.clear();
        self.vb.resize(size, NONE);
        let vf = &mut self.vf[..size];
        let vb = &mut self.vb[..size];
        vf[(off + 1) as usize] = 0;
        vb[(off + 1) as usize] = 0;
        // If the total length is odd the fronts can only meet during the
        // forward phase, otherwise only during the reverse phase.
        let front = delta & 1 != 0;
        let (ra, rb) = (Rev(a), Rev(b));

        // Both phases are the same walk; the reverse one runs on the mirrored
        // sequences (x = elements consumed from the end of `a`), so forward
        // diagonal k corresponds to reverse diagonal delta - k. `$check` is
        // whether paths of this phase can meet the other phase's paths, which
        // live on its diagonals |delta - k| ≤ $cd.
        macro_rules! walk {
            ($v:ident, $other:ident, $d:expr, $a:ident, $b:ident, $snake:ident, $check:literal, $cd:expr, |$x:ident, $k:ident| $found:expr) => {{
                let (mut $k, kmax) = diag_range($d, n, m);
                let (clo, chi) = (delta - $cd, delta + $cd);
                // x ≤ lim keeps (x, y) on the grid; lim = min(n, m + k).
                let mut lim = if n < m + $k { n } else { m + $k };
                let mut i = ($k + off) as usize;
                let mut lo = $v[i - 1];
                while $k <= kmax {
                    let hi = $v[i + 1];
                    // Furthest of: step right from diagonal k-1, step down from
                    // k+1. NONE stays negative through the +1.
                    // Next to a diagonal that has come to the edge of the grid, the
                    // edge takes one step more. No shortest path goes there.
                    let mut $x = if lo + 1 > hi { lo + 1 } else { hi };
                    if $x > lim {
                        $x = lim;
                    }
                    if $x >= 0 {
                        let y = $x - $k;
                        if $x < n && y < m && $a.at($x as usize) == $b.at(y as usize) {
                            $x += 1 + T::$snake($a.from($x as usize + 1), $b.from(y as usize + 1))
                                as i32;
                        }
                        $v[i] = $x;
                        if $check && $k >= clo && $k <= chi {
                            let x2 = $other[(delta - $k + off) as usize];
                            if x2 >= 0 && $x + x2 >= n {
                                $found
                            }
                        }
                    }
                    lo = hi;
                    $k += 2;
                    i += 2;
                    lim = if lim + 2 < n { lim + 2 } else { n };
                }
            }};
        }
        macro_rules! round {
            ($d:expr, $fcheck:literal, $rcheck:literal) => {
                walk!(vf, vb, $d, a, b, common_prefix, $fcheck, $d - 1, |x, k| {
                    let at = (alo + x as usize, blo + (x - k) as usize);
                    return Split::Exact(at, 2 * $d as usize - 1);
                });
                walk!(vb, vf, $d, ra, rb, common_suffix, $rcheck, $d, |_x2, k2| {
                    let k = delta - k2;
                    let x = vf[(k + off) as usize];
                    let at = (alo + x as usize, blo + (x - k) as usize);
                    return Split::Exact(at, 2 * $d as usize);
                });
            };
        }

        // Each diagonal holds its furthest point; pick the one with the
        // most progress (x + y = 2x - k) in each direction.
        let best = |v: &[i32]| {
            let mut best = (-1i32, 0i32, 0i32);
            for k in -bmax..=bmax {
                let x = v[(k + off) as usize];
                if x >= 0 && x - k <= m && 2 * x - k > best.0 {
                    best = (2 * x - k, x, x - k);
                }
            }
            (best.1, best.2)
        };

        let mut d: i32 = 0;
        let ((fx, fy), (bx, by)) = loop {
            let last = bmax.min(*depth as i32);
            if front {
                while d <= last {
                    round!(d, true, false);
                    d += 1;
                }
            } else {
                while d <= last {
                    round!(d, false, true);
                    d += 1;
                }
            }
            // With an unrestricted search the fronts always meet.
            debug_assert!(last < dmax);
            let (f, r) = (best(vf), best(vb));
            if last == bmax || f.0 + f.1 + r.0 + r.1 > 4 * last {
                break (f, r);
            }
            *depth = patience;
        };
        Split::Greedy(
            (alo + fx as usize, blo + fy as usize),
            (alo + (n - bx) as usize, blo + (m - by) as usize),
        )
    }
}

/// Moves what `Bits::trace` gave for a box to the box's place. `swapped`: it took `b` for `a`.
fn to_whole(corridor: &mut [Level], at: Point, (alo, blo): Point, swapped: bool) -> Point {
    let origin = alo as i32 - blo as i32;
    for c in corridor {
        if swapped {
            *c = Level {
                lo: -c.hi,
                hi: -c.lo,
                from: c.from - c.lo,
                to: c.to - c.lo,
            };
        }
        c.lo += origin;
        c.hi += origin;
        c.from += alo as i32;
        c.to += alo as i32;
    }
    let (x, y) = if swapped { (at.1, at.0) } else { at };
    (alo + x, blo + y)
}

enum Found {
    /// Where to cut the box, and its `levels`.
    Split(Point, Option<(usize, usize)>),
    /// The box has more than twice this many edits; the points `middle` gave at this
    /// depth, if it ran.
    TooFar(usize, Option<(Point, Point)>),
}

/// What `solve` found out about a box.
enum Solved {
    /// The edit distance, and the cut if `middle` found it.
    Distance(usize, Option<Point>),
    /// Past the policy's depth, with the points that `middle` gave if it went that deep.
    TooFar(Option<(Point, Point)>),
}

fn pace((alo, ahi, ..): Rect, depth: usize, (f, r): (Point, Point)) -> usize {
    ((f.0 - alo) + (ahi - r.0)) / (2 * depth + 1)
}

/// The steps of `middle` if it finds nothing within `depth`.
fn in_vain(depth: usize) -> isize {
    ((depth + 1) * (depth + 2)) as isize
}

/// Words that `bits` goes through in the time of one step of `middle`.
const WORDS_PER_STEP: usize = 7;

/// About how many words `Bits::forward` and `Bits::trace` take if the bound is the edit distance.
fn words(long: usize, short: usize, distance: usize) -> usize {
    let rows = short.min(distance / 2 + EXTRA_ROWS);
    long.div_ceil(STRIP) * rows * bits::WORDS + fixed_words(long, short)
}

/// The part of `words` that does not grow with the rows: for the masks of each strip, for the walks back along the
/// elements, and for each call.
fn fixed_words(long: usize, short: usize) -> usize {
    long.div_ceil(STRIP) * 2 * STRIP + (long + short) * 16 + 2048
}

/// `bits` is not worth its start for fewer edits.
const MIN_DISTANCE: usize = 64;
/// Rows of a strip that are computed besides those that a path can touch.
const EXTRA_ROWS: usize = 384;

/// With fewer edits expected, `Bits::guess` costs about as much as the passes it saves.
const GUESS_FROM: usize = 500;
/// Words that `Myers::reach` gets besides depth * depth. At `MIN_PROBE` the sum pays for about two strips from each corner.
const REACH_EXTRA: usize = 4096;

/// `middle` ends by this depth in every box of at most twice as many elements.
const SMALL_BOX_DEPTH: usize = 24;

/// The words that `reach` may spend in a box of so many columns, unless `middle` looks cheaper. That takes about
/// depth * depth steps of several words each, so a failed try adds little.
fn reach_budget(columns: usize, depth: usize, pace: &mut dyn FnMut() -> usize) -> Option<usize> {
    let budget = depth * depth + REACH_EXTRA;
    // All of so few columns take less than `middle`, so to stop half way would cost more.
    let whole = (columns / STRIP + 1) * (2 * depth + EXTRA_ROWS) * bits::WORDS;
    if whole <= 2 * depth * depth {
        return Some(budget.max(3 * whole));
    }
    let strips = 2 * (depth * pace() / STRIP + 1);
    (strips * (depth + EXTRA_ROWS) * bits::WORDS <= budget).then_some(budget)
}

/// The depth at which `middle` has taken as long as `bits` takes for `2 * depth` edits (`words`).
#[inline]
fn crossover(long: usize, short: usize) -> usize {
    if long + short <= 2 * SMALL_BOX_DEPTH {
        return SMALL_BOX_DEPTH;
    }
    const SCALE: f32 = WORDS_PER_STEP as f32;
    let per_row = (long.div_ceil(STRIP) * bits::WORDS) as f32;
    let fixed = fixed_words(long, short) as f32;
    let whole = (fixed + per_row * short as f32) / SCALE;
    let half = per_row * 0.5 / SCALE;
    let band = half + (half * half + (fixed + per_row * EXTRA_ROWS as f32) / SCALE).sqrt();
    whole.sqrt().min(band) as usize
}

/// Uniform element access for the two search directions: a slice read from
/// the front, or (`Rev`) from the back.
trait View<T: Elem>: Copy {
    fn at(self, i: usize) -> T;
    /// The elements after position `i`, in this view's direction, as a plain
    /// slice suitable for `common_prefix` (forward) / `common_suffix` (Rev).
    fn from(self, i: usize) -> Self::Slice;
    type Slice;
}
impl<'a, T: Elem> View<T> for &'a [T] {
    type Slice = &'a [T];
    #[inline(always)]
    fn at(self, i: usize) -> T {
        self[i]
    }
    #[inline(always)]
    fn from(self, i: usize) -> &'a [T] {
        &self[i..]
    }
}
#[derive(Clone, Copy)]
struct Rev<'a, T>(&'a [T]);
impl<'a, T: Elem> View<T> for Rev<'a, T> {
    type Slice = &'a [T];
    #[inline(always)]
    fn at(self, i: usize) -> T {
        self.0[self.0.len() - 1 - i]
    }
    #[inline(always)]
    fn from(self, i: usize) -> &'a [T] {
        &self.0[..self.0.len() - i]
    }
}

/// Positions are held as `i32` inside the search.
const MAX_LEN: usize = i32::MAX as usize / 4;

/// Probe depth below a greedy cut never drops under this.
const MIN_PROBE: usize = 64;
/// Anchors are used only if the in-order unique matches number at least
/// 1/ANCHOR_COVERAGE of the shorter side.
const ANCHOR_COVERAGE: usize = 4;

impl Policy {
    fn exhaustive_depth(&self, n: usize) -> usize {
        self.exhaustive_max
            .min(n.saturating_mul(self.exhaustive_per_elem).isqrt())
            .min(self.exhaustive_quota / n.max(1))
    }
}

/// Diagonals worth visiting at step `d`: `[-d, d]` clipped to the grid
/// (`-m ≤ k ≤ n`), keeping k ≡ d (mod 2).
#[inline]
fn diag_range(d: i32, n: i32, m: i32) -> (i32, i32) {
    let mut lo = -d;
    if lo < -m {
        lo = -m + ((d - m) & 1);
    }
    let mut hi = d;
    if hi > n {
        hi = n - ((d - n) & 1);
    }
    (lo, hi)
}

/// fast-diff's `diff_halfMatch_`: a run that `a` and `b` share and that is at least
/// half as long as the longer of them, as its place in each. It is looked for
/// around two quarters of the longer one, so it is not always found, and what is
/// left on its two sides is not always a minimal diff.
fn half_match<T: Elem>(
    a: &[T],
    b: &[T],
    budget: &mut isize,
) -> Option<(Range<usize>, Range<usize>)> {
    let a_is_longer = a.len() > b.len();
    let (long, short) = if a_is_longer { (a, b) } else { (b, a) };
    if long.len() < 4 || short.len() * 2 < long.len() {
        return None;
    }
    let second_quarter = half_match_around(long, short, long.len().div_ceil(4), budget);
    let third_quarter = half_match_around(long, short, long.len().div_ceil(2), budget);
    let (in_long, in_short) = match (second_quarter, third_quarter) {
        (Some(one), Some(other)) if one.0.len() <= other.0.len() => other,
        (one, other) => one.or(other)?,
    };
    Some(if a_is_longer {
        (in_long, in_short)
    } else {
        (in_short, in_long)
    })
}

/// The longest run that `long` and `short` share and that has the quarter of
/// `long` from `at` on in it, if it is at least half of `long`: its place in each.
fn half_match_around<T: Elem>(
    long: &[T],
    short: &[T],
    at: usize,
    budget: &mut isize,
) -> Option<(Range<usize>, Range<usize>)> {
    let seed = &long[at..at + long.len() / 4];
    let mut best = (0..0, 0..0);
    let mut from = 0;
    while let Some(found) = T::find(&short[from..], seed, budget) {
        let found = from + found;
        let after = T::common_prefix(&long[at..], &short[found..]);
        let before = T::common_suffix(&long[..at], &short[..found]);
        *budget -= (before + after) as isize;
        if best.0.len() < before + after {
            best = (at - before..at + after, found - before..found + after);
        }
        from = found + 1;
    }
    (best.0.len() * 2 >= long.len()).then_some(best)
}

/// Collects maximal runs of changed elements into hunks. `changed_a` and
/// `changed_b` must have the same number of unchanged elements.
fn hunks_from_changed<T: Elem>(
    a: &[T],
    b: &[T],
    changed_a: &[bool],
    changed_b: &[bool],
    out: &mut Vec<Hunk>,
) {
    let (n, m) = (changed_a.len(), changed_b.len());
    let (mut i, mut j) = (0usize, 0usize);
    while i < n || j < m {
        if i < n && j < m && !changed_a[i] && !changed_b[j] {
            i += 1;
            j += 1;
            continue;
        }
        let (a_lo, b_lo) = (i, j);
        while i < n && changed_a[i] {
            i += 1;
        }
        while j < m && changed_b[j] {
            j += 1;
        }
        debug_assert!(i > a_lo || j > b_lo);
        push_trimmed(
            a,
            b,
            Hunk {
                a_lo,
                a_hi: i,
                b_lo,
                b_hi: j,
            },
            out,
        );
    }
}

fn push_trimmed<T: Elem>(a: &[T], b: &[T], mut h: Hunk, out: &mut Vec<Hunk>) {
    let p = T::common_prefix(&a[h.a_lo..h.a_hi], &b[h.b_lo..h.b_hi]);
    h.a_lo += p;
    h.b_lo += p;
    let s = T::common_suffix(&a[h.a_lo..h.a_hi], &b[h.b_lo..h.b_hi]);
    h.a_hi -= s;
    h.b_hi -= s;
    if h.a_lo < h.a_hi || h.b_lo < h.b_hi {
        out.push(h);
    }
}

// ───────────────────────────── line mode ─────────────────────────────

/// Open-addressing table from line content to dense id. A slot is the top 32 bits
/// of the hash plus the id, and candidates are confirmed by comparing the lines.
struct Interner<K> {
    slots: Vec<(u32, u32)>,
    mask: usize,
    lines: Vec<K>,
    /// The lines, with their hashes, whose first `PROBES` slots were taken by others. Slots are never freed, so a
    /// later search for such a line ends up here too.
    overflow: BTreeMap<(u64, K), u32>,
}

trait Key: Copy + Ord {
    fn hash(self) -> u64;
}

impl Key for &[u8] {
    #[inline(always)]
    fn hash(self) -> u64 {
        hash_bytes(self)
    }
}

const EMPTY: u32 = u32::MAX;
const PROBES: usize = 64;

impl<K: Key> Interner<K> {
    fn with_capacity(lines: usize) -> Self {
        let cap = (lines * 2).max(16).next_power_of_two();
        Self {
            slots: vec![(0, EMPTY); cap],
            mask: cap - 1,
            lines: Vec::with_capacity(lines),
            overflow: BTreeMap::new(),
        }
    }

    #[inline]
    fn intern(&mut self, line: K) -> u32 {
        let h = line.hash();
        let tag = (h >> 32) as u32;
        let mut i = h as usize & self.mask;
        for _ in 0..PROBES {
            let slot = &mut self.slots[i];
            if slot.1 == EMPTY {
                let id = self.lines.len() as u32;
                *slot = (tag, id);
                self.lines.push(line);
                if self.lines.len() * 2 > self.slots.len() {
                    self.grow();
                }
                return id;
            }
            if slot.0 == tag && self.lines[slot.1 as usize] == line {
                return slot.1;
            }
            i = (i + 1) & self.mask;
        }
        self.intern_in_overflow(h, line)
    }

    #[cold]
    fn intern_in_overflow(&mut self, hash: u64, line: K) -> u32 {
        *self.overflow.entry((hash, line)).or_insert_with(|| {
            self.lines.push(line);
            self.lines.len() as u32 - 1
        })
    }

    /// The next id, for a line that is new and that the caller finds again by itself.
    #[inline]
    fn push_new(&mut self, line: K) -> u32 {
        self.lines.push(line);
        self.lines.len() as u32 - 1
    }

    #[cold]
    fn grow(&mut self) {
        let mut grown = Self::with_capacity(self.lines.len() * 2);
        for &line in &self.lines {
            grown.intern(line);
        }
        *self = grown;
    }

    fn find(&self, line: K) -> Option<u32> {
        let h = line.hash();
        let tag = (h >> 32) as u32;
        let mut i = h as usize & self.mask;
        for _ in 0..PROBES {
            let slot = self.slots[i];
            if slot.1 == EMPTY {
                return None;
            }
            if slot.0 == tag && self.lines[slot.1 as usize] == line {
                return Some(slot.1);
            }
            i = (i + 1) & self.mask;
        }
        self.overflow.get(&(h, line)).copied()
    }
}

/// Splits `text` into lines (each keeping its `\n`; the last line may lack
/// one), interning each. Returns token ids and `lines + 1` byte offsets.
fn tokenize<'a>(
    text: &'a [u8],
    base: usize,
    interner: &mut Interner<&'a [u8]>,
    ids: &mut Vec<u32>,
    offs: &mut Vec<u32>,
) {
    // Pass 1: line boundaries, a word at a time.
    let first = offs.len();
    offs.push(base as u32);
    line_ends(text, base, offs);
    if offs.last() != Some(&((base + text.len()) as u32)) {
        offs.push((base + text.len()) as u32);
    }
    // Pass 2: hash and intern. Kept separate so the table probes of
    // consecutive lines can overlap instead of waiting on the newline scan.
    ids.reserve(offs.len() - first - 1);
    let mut start = 0;
    for &end in &offs[first + 1..] {
        let end = end as usize - base;
        ids.push(interner.intern(&text[start..end]));
        start = end;
    }
}

/// Appends `base + i + 1` for every `\n` at `text[i]`.
fn line_ends(text: &[u8], base: usize, out: &mut Vec<u32>) {
    let mut at = 0;
    while let Some(i) = index_of_char(&text[at..], b'\n') {
        at += i + 1;
        out.push((base + at) as u32);
    }
}

/// Line-level diff. Returned hunks are byte offsets into `a` and `b`, always
/// falling on line boundaries.
pub fn diff_lines(a: &[u8], b: &[u8]) -> Vec<Hunk> {
    // Byte-wise common prefix/suffix, snapped back to line boundaries, so the
    // (typically large) unchanged head and tail are never tokenized.
    let p = u8::common_prefix(a, b);
    if p == a.len() && p == b.len() {
        return Vec::new();
    }
    if a.len().max(b.len()) >= MAX_LEN {
        return vec![Hunk {
            a_lo: 0,
            a_hi: a.len(),
            b_lo: 0,
            b_hi: b.len(),
        }];
    }
    let head = if p > 0 && a[p - 1] == b'\n' {
        p
    } else {
        last_index_of_char(&a[..p], b'\n').map_or(0, |i| i + 1)
    };
    let s = u8::common_suffix(&a[head..], &b[head..]);
    let (mut a_end, mut b_end) = (a.len() - s, b.len() - s);
    let a_at_line_start = a_end == head || a[a_end - 1] == b'\n';
    let b_at_line_start = b_end == head || b[b_end - 1] == b'\n';
    if !(a_at_line_start && b_at_line_start) {
        match index_of_char(&a[a_end..], b'\n') {
            Some(i) => {
                a_end += i + 1;
                b_end += i + 1;
            }
            None => {
                a_end = a.len();
                b_end = b.len();
            }
        }
    }

    // One side's middle empty, or a single line: no search needed. This is
    // the common case (one line changed/added/removed) and skips all the
    // allocation below.
    let (ma, mb) = (&a[head..a_end], &b[head..b_end]);
    if ma.is_empty() || mb.is_empty() {
        let mut hunks = vec![Hunk {
            a_lo: head,
            a_hi: a_end,
            b_lo: head,
            b_hi: b_end,
        }];
        slide_edits(&mut hunks, a, b, Unit::Line);
        return hunks;
    }
    let single = |m: &[u8]| match index_of_char(m, b'\n') {
        None => true,
        Some(i) => i + 1 == m.len(),
    };
    if single(ma) || single(mb) {
        let mut hunks = if single(ma) {
            one_vs_lines(ma, mb, head, false)
        } else {
            one_vs_lines(mb, ma, head, true)
        };
        slide_edits(&mut hunks, a, b, Unit::Line);
        return hunks;
    }

    let est_a = count_char(ma, b'\n') + 1;
    let est_b = count_char(mb, b'\n') + 1;
    let mut interner = Interner::with_capacity(est_a + est_b);
    let mut ta: Vec<u32> = Vec::with_capacity(est_a);
    let mut tb: Vec<u32> = Vec::with_capacity(est_b);
    let mut offs_a: Vec<u32> = Vec::with_capacity(est_a + 1);
    let mut offs_b: Vec<u32> = Vec::with_capacity(est_b + 1);
    tokenize(ma, head, &mut interner, &mut ta, &mut offs_a);
    tokenize(mb, head, &mut interner, &mut tb, &mut offs_b);
    let uniq = interner.lines.len();
    drop(interner);

    let mut hunks = diff_shared_tokens(&ta, &tb, uniq, &search_bounded);
    for h in &mut hunks {
        *h = Hunk {
            a_lo: offs_a[h.a_lo] as usize,
            a_hi: offs_a[h.a_hi] as usize,
            b_lo: offs_b[h.b_lo] as usize,
            b_hi: offs_b[h.b_hi] as usize,
        };
    }
    slide_edits(&mut hunks, a, b, Unit::Line);
    hunks
}

/// A token that never occurs on the other side cannot be part of any common
/// subsequence, so it is marked changed up front and left out of the sequences
/// handed to `search`. This preserves minimality while shrinking both N and D —
/// often to nothing. Every token is below `uniq`; hunks are token indices.
fn diff_shared_tokens(
    ta: &[u32],
    tb: &[u32],
    uniq: usize,
    search: &dyn Fn(&[u32], &[u32], &mut [bool], &mut [bool]),
) -> Vec<Hunk> {
    let (na, nb) = (ta.len(), tb.len());
    let mut occurs = vec![[false; 2]; uniq];
    for &t in ta {
        occurs[t as usize][0] = true;
    }
    for &t in tb {
        occurs[t as usize][1] = true;
    }
    let mut changed = vec![false; na + nb];
    let (changed_a, changed_b) = changed.split_at_mut(na);
    let ra = without_unshared(ta, changed_a, &occurs, 1);
    let rb = without_unshared(tb, changed_b, &occurs, 0);
    drop(occurs);

    // A token that survives does so on both sides.
    if !ra.is_empty() {
        let mut rchanged = vec![false; ra.len() + rb.len()];
        let (rchanged_a, rchanged_b) = rchanged.split_at_mut(ra.len());
        search(&ra, &rb, rchanged_a, rchanged_b);
        // The tokens that are not marked yet are the ones that were searched, in order.
        for (changed, rchanged) in [(&mut *changed_a, rchanged_a), (&mut *changed_b, rchanged_b)] {
            let mut at = 0;
            for c in changed {
                let survived = !*c;
                *c |= rchanged.get(at) == Some(&true);
                at += usize::from(survived);
            }
        }
    }

    let mut hunks = Vec::with_capacity(16);
    hunks_from_changed(ta, tb, changed_a, changed_b, &mut hunks);
    hunks
}

/// `tokens` without those that do not occur on side `other`, which are marked in `changed`.
fn without_unshared<'a>(
    tokens: &'a [u32],
    changed: &mut [bool],
    occurs: &[[bool; 2]],
    other: usize,
) -> Cow<'a, [u32]> {
    let mut kept = 0;
    for (&t, changed) in tokens.iter().zip(&mut *changed) {
        *changed = !occurs[t as usize][other];
        kept += usize::from(!*changed);
    }
    if kept == tokens.len() {
        return Cow::Borrowed(tokens);
    }
    let (mut rest, mut len) = (vec![0; kept], 0);
    for (&t, &changed) in tokens.iter().zip(&*changed) {
        let Some(slot) = rest.get_mut(len) else { break };
        *slot = t;
        len += usize::from(!changed);
    }
    Cow::Owned(rest)
}

fn search_bounded(a: &[u32], b: &[u32], changed_a: &mut [bool], changed_b: &mut [bool]) {
    let policy = Policy {
        work: LINES.work + (a.len() + b.len()) * LINE_WORK_PER_TOKEN,
        ..LINES
    };
    Myers::new(a, b, &mut MyersScratch::default(), policy).run(
        0..a.len(),
        0..b.len(),
        changed_a,
        changed_b,
    );
}

/// Hunks for a one-line middle `one` against a multi-line middle `many`, both
/// starting at byte `base` of their texts. `swapped` means `one` is from b.
fn one_vs_lines(one: &[u8], many: &[u8], base: usize, swapped: bool) -> Vec<Hunk> {
    let mk = |o_lo: usize, o_hi: usize, m_lo: usize, m_hi: usize| {
        if swapped {
            Hunk {
                a_lo: base + m_lo,
                a_hi: base + m_hi,
                b_lo: base + o_lo,
                b_hi: base + o_hi,
            }
        } else {
            Hunk {
                a_lo: base + o_lo,
                a_hi: base + o_hi,
                b_lo: base + m_lo,
                b_hi: base + m_hi,
            }
        }
    };
    let mut start = 0;
    while start < many.len() {
        let end = index_of_char(&many[start..], b'\n').map_or(many.len(), |i| start + i + 1);
        if many[start..end] == *one {
            let mut hunks = Vec::with_capacity(2);
            if start > 0 {
                hunks.push(mk(0, 0, 0, start));
            }
            if end < many.len() {
                hunks.push(mk(one.len(), one.len(), end, many.len()));
            }
            return hunks;
        }
        start = end;
    }
    vec![mk(0, one.len(), 0, many.len())]
}

const LINES: Policy = Policy {
    probe: 512,
    exhaustive_max: 4096,
    exhaustive_per_elem: 2048,
    exhaustive_quota: 60_000_000,
    work: 24_000_000,
    half_match: 0,
};
const LINE_WORK_PER_TOKEN: usize = 32;
const CHARS: Policy = Policy {
    probe: 256,
    exhaustive_max: 2048,
    exhaustive_per_elem: 1024,
    exhaustive_quota: 40_000_000,
    work: 4_000_000,
    half_match: 0,
};
const CHAR_WORK_PER_BYTE: usize = 2;
/// Of 7,566 pairs of a source file and the same file formatted, half spend 3 steps
/// per element on fast-diff's shortcuts, one in a thousand 30. Long runs of one
/// character would spend as many as they have elements.
///
/// A file that is indented anew is far from its formatted text. With the bounds of
/// `CHARS` 35 of 8,042 such pairs are cut greedily, with 4 times as much 15, with 16
/// times none: the dearest, of 93 KB, takes 52 million steps.
const AS_FAST_DIFF: Policy = Policy {
    probe: CHARS.probe,
    exhaustive_max: 16 * CHARS.exhaustive_max,
    exhaustive_per_elem: 16 * CHARS.exhaustive_per_elem,
    exhaustive_quota: 16 * CHARS.exhaustive_quota,
    work: 16 * CHARS.work,
    half_match: 64,
};
const HALF_MATCH_FLOOR: usize = 64 << 10;

// ───────────────────────────── character mode ─────────────────────────────

/// Character-level differ with reusable scratch space.
#[derive(Default)]
pub struct CharDiff {
    hunks: Vec<Hunk>,
    scratch: Vec<Hunk>,
    myers: MyersScratch,
    changed_a: Vec<bool>,
    changed_b: Vec<bool>,
    kmp: Vec<u32>,
}

impl CharDiff {
    /// Character-level diff with diff-match-patch's semantic cleanup applied,
    /// for highlighting within a modified line/block. Hunks are byte offsets
    /// and fall on UTF-8 sequence boundaries if the inputs are valid UTF-8.
    pub fn diff(&mut self, a: &[u8], b: &[u8]) -> &[Hunk] {
        self.hunks.clear();
        self.whole(a, b);
        self.finish(a, b);
        &self.hunks
    }

    /// The diff that `diff(a, b)` of the package fast-diff 1.3.0 gives, for output
    /// that has to be cut where that cuts it: of several equal elements it takes
    /// the same one. The search is the same as in [`Self::diff`] and chooses alike;
    /// fast-diff first looks in every box whether the shorter side is in the longer
    /// one, and for a run that is half of the longer one. No semantic cleanup.
    ///
    /// fast-diff compares code units of UTF-16: for the same result `a` and `b` are
    /// such, or bytes of ASCII. Two hunks can touch.
    ///
    /// It differs from fast-diff where the work is bounded here (texts that are far
    /// apart, on which fast-diff is quadratic), and in 2 of 10,902 pairs of a file
    /// and the same file formatted, because fast-diff merges after every box.
    pub fn diff_as_fast_diff<T: Elem>(&mut self, a: &[T], b: &[T]) -> &[Hunk] {
        let hunks = &mut self.hunks;
        hunks.clear();
        let p = T::common_prefix(a, b);
        let s = T::common_suffix(&a[p..], &b[p..]);
        let (ma, mb) = (&a[p..a.len() - s], &b[p..b.len() - s]);
        if a.len().max(b.len()) >= MAX_LEN {
            push_nonempty(
                hunks,
                Hunk {
                    a_lo: 0,
                    a_hi: ma.len(),
                    b_lo: 0,
                    b_hi: mb.len(),
                },
            );
        } else {
            let (changed_a, changed_b) = (&mut self.changed_a, &mut self.changed_b);
            changed_a.clear();
            changed_a.resize(ma.len(), false);
            changed_b.clear();
            changed_b.resize(mb.len(), false);
            let policy = Policy {
                work: AS_FAST_DIFF.work + (ma.len() + mb.len()) * CHAR_WORK_PER_BYTE,
                ..AS_FAST_DIFF
            };
            Myers::new(ma, mb, &mut self.myers, policy).run(
                0..ma.len(),
                0..mb.len(),
                changed_a,
                changed_b,
            );
            hunks_from_changed(ma, mb, changed_a, changed_b, hunks);
        }
        for h in hunks.iter_mut() {
            *h = Hunk {
                a_lo: h.a_lo + p,
                a_hi: h.a_hi + p,
                b_lo: h.b_lo + p,
                b_hi: h.b_hi + p,
            };
        }
        cleanup_merge(hunks, a, b);
        align_to_characters(hunks, a);
        hunks
    }

    fn finish(&mut self, a: &[u8], b: &[u8]) {
        cleanup_merge(&mut self.hunks, a, b);
        // Semantic cleanup reasons about edit *lengths*, so it should see
        // whole characters; it can itself split a sequence again (common
        // prefix of `é`/`è` is a lead byte), hence the second pass.
        align_to_characters(&mut self.hunks, a);
        cleanup_semantic(&mut self.hunks, &mut self.scratch, a, b, &mut self.kmp);
        align_to_characters(&mut self.hunks, a);
    }

    /// Raw hunks for `a` vs `b`, before cleanup. If the work cap is hit the
    /// unsolved remainder comes back as wholesale replacements.
    fn whole(&mut self, a: &[u8], b: &[u8]) {
        let hunks = &mut self.hunks;
        let p = u8::common_prefix(a, b);
        if p == a.len() && p == b.len() {
            return;
        }
        let s = u8::common_suffix(&a[p..], &b[p..]);
        let (ma, mb) = (&a[p..a.len() - s], &b[p..b.len() - s]);
        let whole = Hunk {
            a_lo: 0,
            a_hi: ma.len(),
            b_lo: 0,
            b_hi: mb.len(),
        };
        if ma.is_empty() || mb.is_empty() {
            hunks.push(whole);
        } else if let Some((long_is_a, at)) = contains(ma, mb) {
            // The shorter side appears verbatim inside the longer one.
            let (ga, gb) = if long_is_a { (at, 0) } else { (0, at) };
            let common = ma.len().min(mb.len());
            push_nonempty(
                hunks,
                Hunk {
                    a_lo: 0,
                    a_hi: ga,
                    b_lo: 0,
                    b_hi: gb,
                },
            );
            push_nonempty(
                hunks,
                Hunk {
                    a_lo: ga + common,
                    a_hi: ma.len(),
                    b_lo: gb + common,
                    b_hi: mb.len(),
                },
            );
        } else if ma.len() == 1 || mb.len() == 1 || a.len().max(b.len()) >= MAX_LEN {
            hunks.push(whole);
        } else {
            let (changed_a, changed_b) = (&mut self.changed_a, &mut self.changed_b);
            changed_a.clear();
            changed_a.resize(ma.len(), false);
            changed_b.clear();
            changed_b.resize(mb.len(), false);
            let policy = Policy {
                work: CHARS.work + (ma.len() + mb.len()) * CHAR_WORK_PER_BYTE,
                ..CHARS
            };
            Myers::new(ma, mb, &mut self.myers, policy).run(
                0..ma.len(),
                0..mb.len(),
                changed_a,
                changed_b,
            );
            hunks_from_changed(ma, mb, changed_a, changed_b, hunks);
        }
        for h in hunks.iter_mut() {
            *h = Hunk {
                a_lo: h.a_lo + p,
                a_hi: h.a_hi + p,
                b_lo: h.b_lo + p,
                b_hi: h.b_hi + p,
            };
        }
    }
}

fn push_nonempty(hunks: &mut Vec<Hunk>, h: Hunk) {
    if h.a_lo < h.a_hi || h.b_lo < h.b_hi {
        hunks.push(h);
    }
}

/// If the shorter of `a`/`b` occurs inside the longer: (longer is a, offset).
fn contains(a: &[u8], b: &[u8]) -> Option<(bool, usize)> {
    if a.len() >= b.len() {
        index_of_by_start(a, b).map(|i| (true, i))
    } else {
        index_of_by_start(b, a).map(|i| (false, i))
    }
}

// ───────────────────────── cleanup (diff-match-patch) ─────────────────────────

/// What a hunk's edges may not fall inside of.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Unit {
    Element,
    Line,
}

/// diff-match-patch `diff_cleanupMerge`: the common prefix and suffix inside a hunk are factored out, hunks that
/// touch are joined, and single edits are slid (`slide_edits`).
fn cleanup_merge<T: Elem>(hunks: &mut Vec<Hunk>, a: &[T], b: &[T]) {
    trim_and_join(hunks, a, b, Unit::Element);
    slide_edits(hunks, a, b, Unit::Element);
}

/// Slides single edits over a neighbouring equality they repeat (`slide_single_edit`), then trims and joins, in
/// passes until nothing moves.
fn slide_edits<T: Elem>(hunks: &mut Vec<Hunk>, a: &[T], b: &[T], unit: Unit) {
    let slide_all = |hunks: &mut [Hunk]| {
        (0..hunks.len()).fold(false, |moved, at| {
            slide_single_edit(hunks, at, (at.wrapping_sub(1), at + 1), a, b, unit) | moved
        })
    };
    // Most diffs end within two passes, which allocate nothing.
    if slide_all(hunks) {
        trim_and_join(hunks, a, b, unit);
        if slide_all(hunks) {
            join_slid_edits(hunks, a, b, unit);
        }
    }
}

fn trim_and_join<T: Elem>(hunks: &mut Vec<Hunk>, a: &[T], b: &[T], unit: Unit) {
    let mut w = 0;
    for r in 0..hunks.len() {
        let h = trimmed(hunks[r], a, b, unit);
        if h.deleted() == 0 && h.inserted() == 0 {
            continue;
        }
        if w > 0 && hunks[w - 1].touches(&h) {
            (hunks[w - 1].a_hi, hunks[w - 1].b_hi) = (h.a_hi, h.b_hi);
        } else {
            hunks[w] = h;
            w += 1;
        }
    }
    hunks.truncate(w);
}

/// The later passes. The equalities around a hunk only grow until it is joined, so an edit that did not slide once
/// does not slide later. After the first of these, a pass visits only the hunks that the pass before it changed.
#[cold]
fn join_slid_edits<T: Elem>(hunks: &mut Vec<Hunk>, a: &[T], b: &[T], unit: Unit) {
    let mut list = HunkList::new(hunks);
    let mut visit: Vec<usize> = (0..list.hunks.len()).collect();
    loop {
        let mut kept = 0;
        for k in 0..visit.len() {
            let mut at = visit[k];
            let h = trimmed(list.hunks[at], a, b, unit);
            list.hunks[at] = h;
            if h.deleted() == 0 && h.inserted() == 0 {
                list.remove(at);
                continue;
            }
            let (prev, next) = list.links[at];
            if list.hunks.get(prev).is_some_and(|prev| prev.touches(&h)) {
                list.join(prev, at);
                at = prev;
            }
            // If `next` is visited too, it is trimmed first.
            if visit.get(k + 1) != Some(&next)
                && list.hunks.get(next).is_some_and(|next| h.touches(next))
            {
                list.join(at, next);
            }
            if h.is_single_edit() && visit[..kept].last() != Some(&at) {
                visit[kept] = at;
                kept += 1;
            }
        }
        visit.truncate(kept);

        let mut moved = false;
        visit.retain(|&at| {
            let slid = slide_single_edit(list.hunks, at, list.links[at], a, b, unit);
            moved |= slid;
            slid || !list.hunks[at].is_single_edit()
        });
        if !moved {
            break;
        }
    }
    hunks.retain(|h| h.deleted() > 0 || h.inserted() > 0);
}

/// Lines are not trimmed: their common start or end can be part of a line.
fn trimmed<T: Elem>(mut h: Hunk, a: &[T], b: &[T], unit: Unit) -> Hunk {
    if unit == Unit::Element && !h.is_single_edit() {
        let p = T::common_prefix(&a[h.a_lo..h.a_hi], &b[h.b_lo..h.b_hi]);
        h.a_lo += p;
        h.b_lo += p;
        let s = T::common_suffix(&a[h.a_lo..h.a_hi], &b[h.b_lo..h.b_hi]);
        h.a_hi -= s;
        h.b_hi -= s;
    }
    h
}

/// Hunks that can be removed without moving the others. A removed one is left empty.
struct HunkList<'h> {
    hunks: &'h mut [Hunk],
    /// The indices of the hunks before and after each, out of bounds if there is none.
    links: Vec<(usize, usize)>,
}

impl<'h> HunkList<'h> {
    fn new(hunks: &'h mut [Hunk]) -> Self {
        let links = (0..hunks.len()).map(|i| (i.wrapping_sub(1), i + 1));
        Self {
            links: links.collect(),
            hunks,
        }
    }

    fn remove(&mut self, at: usize) {
        let h = &mut self.hunks[at];
        (h.a_hi, h.b_hi) = (h.a_lo, h.b_lo);
        let (prev, next) = self.links[at];
        if let Some(links) = self.links.get_mut(prev) {
            links.1 = next;
        }
        if let Some(links) = self.links.get_mut(next) {
            links.0 = prev;
        }
    }

    fn join(&mut self, first: usize, second: usize) {
        let Hunk { a_hi, b_hi, .. } = self.hunks[second];
        (self.hunks[first].a_hi, self.hunks[first].b_hi) = (a_hi, b_hi);
        self.remove(second);
    }
}

/// A pure insertion or deletion that ends with the entire equality before it (or starts with the entire equality
/// after it) is slid over that equality so it touches the neighbouring hunk or the edge, e.g. `A<ins>BA</ins>C` →
/// `<ins>AB</ins>AC`. `prev` and `next` are as in `HunkList::links`. Returns whether it moved.
#[inline]
fn slide_single_edit<T: Elem>(
    hunks: &mut [Hunk],
    at: usize,
    (prev, next): (usize, usize),
    a: &[T],
    b: &[T],
    unit: Unit,
) -> bool {
    const BLOCK: usize = 512;

    let h = hunks[at];
    if !h.is_single_edit() {
        return false;
    }
    let before = h.a_lo - hunks.get(prev).map_or(0, |prev| prev.a_hi);
    let after = hunks.get(next).map_or(a.len(), |next| next.a_lo) - h.a_hi;
    if before == 0 || after == 0 {
        return false;
    }
    let (seq, lo, hi) = if h.deleted() > 0 {
        (a, h.a_lo, h.a_hi)
    } else {
        (b, h.b_lo, h.b_hi)
    };
    let edit = &seq[lo..hi];
    let boundary =
        |at: usize| unit == Unit::Element || at == lo || at == hi || seq[at - 1].is_newline();
    // From the end: when an edit moves right pass after pass, the start of the equality can match each time.
    let ends_with_before = || {
        let end = edit[edit.len() - before..].rchunks(BLOCK);
        end.eq(seq[lo - before..lo].rchunks(BLOCK))
    };
    let by = if edit.len() >= before && ends_with_before() && boundary(hi - before) {
        -(before as isize)
    } else if edit.len() >= after && edit.starts_with(&seq[hi..hi + after]) && boundary(lo + after)
    {
        after as isize
    } else {
        return false;
    };
    let mv = |v: usize| (v as isize + by) as usize;
    hunks[at] = Hunk {
        a_lo: mv(h.a_lo),
        a_hi: mv(h.a_hi),
        b_lo: mv(h.b_lo),
        b_hi: mv(h.b_hi),
    };
    true
}

/// diff-match-patch `diff_cleanupSemantic`, `diff_cleanupSemanticLossless`
/// and the overlap-extraction pass, over byte ranges.
fn cleanup_semantic(
    hunks: &mut Vec<Hunk>,
    scratch: &mut Vec<Hunk>,
    a: &[u8],
    b: &[u8],
    kmp: &mut Vec<u32>,
) {
    // 1. An equality no longer than the edits on either side of it is noise:
    //    fold it into one larger edit.
    let mut changed = false;
    let mut w = 0;
    for r in 0..hunks.len() {
        let mut cur = hunks[r];
        while w > 0 {
            let l = hunks[w - 1];
            let gap = cur.a_lo - l.a_hi;
            if gap <= l.deleted().max(l.inserted()) && gap <= cur.deleted().max(cur.inserted()) {
                cur = Hunk {
                    a_lo: l.a_lo,
                    a_hi: cur.a_hi,
                    b_lo: l.b_lo,
                    b_hi: cur.b_hi,
                };
                w -= 1;
                changed = true;
            } else {
                break;
            }
        }
        hunks[w] = cur;
        w += 1;
    }
    hunks.truncate(w);
    if changed {
        cleanup_merge(hunks, a, b);
    }

    // 2. Slide single edits sideways to the most semantically pleasing spot.
    //    e.g. `The c<ins>at c</ins>ame.` → `The <ins>cat </ins>came.`
    cleanup_semantic_lossless(hunks, a, b);

    // 3. `<del>abcxxx</del><ins>xxxdef</ins>` → `<del>abc</del>xxx<ins>def</ins>`
    //    (and the mirror case) when the overlap is at least half of either edit.
    let out = scratch;
    out.clear();
    for &h in hunks.iter() {
        let (del, ins) = (&a[h.a_lo..h.a_hi], &b[h.b_lo..h.b_hi]);
        if del.is_empty() || ins.is_empty() {
            out.push(h);
            continue;
        }
        let fwd = common_overlap(del, ins, kmp);
        let rev = common_overlap(ins, del, kmp);
        if fwd >= rev {
            if fwd > 0 && (fwd * 2 >= del.len() || fwd * 2 >= ins.len()) {
                push_nonempty(
                    out,
                    Hunk {
                        a_lo: h.a_lo,
                        a_hi: h.a_hi - fwd,
                        b_lo: h.b_lo,
                        b_hi: h.b_lo,
                    },
                );
                push_nonempty(
                    out,
                    Hunk {
                        a_lo: h.a_hi,
                        a_hi: h.a_hi,
                        b_lo: h.b_lo + fwd,
                        b_hi: h.b_hi,
                    },
                );
                continue;
            }
        } else if rev * 2 >= del.len() || rev * 2 >= ins.len() {
            push_nonempty(
                out,
                Hunk {
                    a_lo: h.a_lo,
                    a_hi: h.a_lo,
                    b_lo: h.b_lo,
                    b_hi: h.b_hi - rev,
                },
            );
            push_nonempty(
                out,
                Hunk {
                    a_lo: h.a_lo + rev,
                    a_hi: h.a_hi,
                    b_lo: h.b_hi,
                    b_hi: h.b_hi,
                },
            );
            continue;
        }
        out.push(h);
    }
    core::mem::swap(hunks, out);
}

fn cleanup_semantic_lossless(hunks: &mut Vec<Hunk>, a: &[u8], b: &[u8]) {
    // In-place compaction: `hunks[..w]` is output, `hunks[r..]` input.
    let mut w = 0;
    for r in 0..hunks.len() {
        let h = hunks[r];
        let (prev_a, prev_b) = if w == 0 {
            (0, 0)
        } else {
            (hunks[w - 1].a_hi, hunks[w - 1].b_hi)
        };
        let next_a = if r + 1 == hunks.len() {
            a.len()
        } else {
            hunks[r + 1].a_lo
        };
        debug_assert_eq!(h.a_lo - prev_a, h.b_lo - prev_b);
        let before = h.a_lo - prev_a;
        let after = next_a - h.a_hi;
        if before == 0 || after == 0 || (h.deleted() > 0 && h.inserted() > 0) {
            hunks[w] = h;
            w += 1;
            continue;
        }
        // Work in the coordinates of whichever side holds the edit text; the
        // other side's (empty) range moves in lockstep.
        let (seq, mut lo, mut hi) = if h.deleted() > 0 {
            (a, h.a_lo, h.a_hi)
        } else {
            (b, h.b_lo, h.b_hi)
        };
        let orig_lo = lo;
        let eq1_start = lo - before;
        let eq2_end = hi + after;

        // First, shift the edit as far left as possible (staying on a
        // character boundary; `hi` moves with `lo` through identical bytes so
        // checking one side is enough).
        let is_cont = |i: usize| is_utf8_cont(seq, i);
        let mut shift = u8::common_suffix(&seq[eq1_start..lo], &seq[lo..hi]);
        while shift > 0 && is_cont(lo - shift) {
            shift -= 1;
        }
        lo -= shift;
        hi -= shift;

        // Second, step character by character right, looking for the best fit.
        let mut best = (
            lo,
            semantic_score(&seq[eq1_start..lo], &seq[lo..hi])
                + semantic_score(&seq[lo..hi], &seq[hi..eq2_end]),
        );
        while hi < eq2_end && seq[lo] == seq[hi] {
            lo += 1;
            hi += 1;
            if is_cont(lo) {
                continue;
            }
            let score = semantic_score(&seq[eq1_start..lo], &seq[lo..hi])
                + semantic_score(&seq[lo..hi], &seq[hi..eq2_end]);
            // The >= encourages trailing rather than leading whitespace on edits.
            if score >= best.1 {
                best = (lo, score);
            }
        }

        let delta = best.0 as isize - orig_lo as isize;
        let mv = |v: usize| (v as isize + delta) as usize;
        let h = Hunk {
            a_lo: mv(h.a_lo),
            a_hi: mv(h.a_hi),
            b_lo: mv(h.b_lo),
            b_hi: mv(h.b_hi),
        };
        if r + 1 < hunks.len() && h.a_hi == hunks[r + 1].a_lo && h.b_hi == hunks[r + 1].b_lo {
            // Joined the next hunk: fold into it and let it be processed in turn.
            hunks[r + 1].a_lo = h.a_lo;
            hunks[r + 1].b_lo = h.b_lo;
        } else if w > 0 && hunks[w - 1].a_hi == h.a_lo && hunks[w - 1].b_hi == h.b_lo {
            hunks[w - 1].a_hi = h.a_hi;
            hunks[w - 1].b_hi = h.b_hi;
        } else {
            hunks[w] = h;
            w += 1;
        }
    }
    hunks.truncate(w);
}

/// Scores how good a boundary between `one` and `two` is; 6 (best) to 0.
fn semantic_score(one: &[u8], two: &[u8]) -> u32 {
    if one.is_empty() || two.is_empty() {
        // Edges are the best.
        return 6;
    }
    let char1 = one[one.len() - 1];
    let char2 = two[0];
    let non_alphanumeric1 = !char1.is_ascii_alphanumeric();
    let non_alphanumeric2 = !char2.is_ascii_alphanumeric();
    let whitespace1 = non_alphanumeric1 && char1.is_ascii_whitespace();
    let whitespace2 = non_alphanumeric2 && char2.is_ascii_whitespace();
    let line_break1 = whitespace1 && char1.is_ascii_control();
    let line_break2 = whitespace2 && char2.is_ascii_control();
    let blank_line1 = line_break1 && (one.ends_with(b"\n\n") || one.ends_with(b"\n\r\n"));
    let blank_line2 = line_break2
        && (two.starts_with(b"\n\n")
            || two.starts_with(b"\r\n\n")
            || two.starts_with(b"\n\r\n")
            || two.starts_with(b"\r\n\r\n"));

    if blank_line1 || blank_line2 {
        5
    } else if line_break1 || line_break2 {
        4
    } else if non_alphanumeric1 && !whitespace1 && whitespace2 {
        // End of sentence.
        3
    } else if whitespace1 || whitespace2 {
        2
    } else if non_alphanumeric1 || non_alphanumeric2 {
        1
    } else {
        0
    }
}

/// Length of the longest suffix of `x` that is a prefix of `y`, in O(|x|+|y|).
fn common_overlap(x: &[u8], y: &[u8], fail: &mut Vec<u32>) -> usize {
    // Overlap extraction is cosmetic; don't build megabyte automata for it.
    let n = x.len().min(y.len()).min(OVERLAP_MAX);
    if n == 0 {
        return 0;
    }
    let x = &x[x.len() - n..];
    let y = &y[..n];
    if x == y {
        return n;
    }
    if n <= 16 {
        // Not worth building an automaton for.
        return (1..n).rev().find(|&k| x[n - k..] == y[..k]).unwrap_or(0);
    }
    // KMP failure function of `y`, then run `x` through the automaton.
    fail.clear();
    fail.resize(n, 0);
    let mut k = 0usize;
    for i in 1..n {
        while k > 0 && y[i] != y[k] {
            k = fail[k - 1] as usize;
        }
        if y[i] == y[k] {
            k += 1;
        }
        fail[i] = k as u32;
    }
    k = 0;
    for &c in x {
        while k > 0 && c != y[k] {
            k = fail[k - 1] as usize;
        }
        if c == y[k] {
            k += 1;
        }
        if k == n {
            k = fail[k - 1] as usize;
        }
    }
    k
}

const OVERLAP_MAX: usize = 64 << 10;

/// Whether `s[i]` exists and is a UTF-8 continuation byte.
pub fn is_utf8_cont(s: &[u8], i: usize) -> bool {
    i < s.len() && (s[i] & 0xC0) == 0x80
}

/// Widens each hunk so that no edge falls inside a UTF-8 sequence or a surrogate
/// pair. Edges only
/// ever move outward through the neighbouring equality (whose bytes are the
/// same on both sides), so the diff stays valid; a hunk just gains a shared
/// lead byte or two, and hunks whose separating equality is consumed merge.
fn align_to_characters<T: Elem>(hunks: &mut Vec<Hunk>, a: &[T]) {
    let is_cont = |a: &[T], i: usize| a.get(i).is_some_and(|it| it.continues_character());
    let mut w = 0;
    let mut r = 0;
    while r < hunks.len() {
        let mut h = hunks[r];
        r += 1;
        let floor = if w == 0 { 0 } else { hunks[w - 1].a_hi };
        while h.a_lo > floor && is_cont(a, h.a_lo) {
            h.a_lo -= 1;
            h.b_lo -= 1;
        }
        loop {
            let ceil = if r < hunks.len() {
                hunks[r].a_lo
            } else {
                a.len()
            };
            while h.a_hi < ceil && is_cont(a, h.a_hi) {
                h.a_hi += 1;
                h.b_hi += 1;
            }
            if r < hunks.len() && h.a_hi == hunks[r].a_lo {
                debug_assert_eq!(h.b_hi, hunks[r].b_lo);
                h.a_hi = hunks[r].a_hi;
                h.b_hi = hunks[r].b_hi;
                r += 1;
                continue;
            }
            break;
        }
        hunks[w] = h;
        w += 1;
    }
    hunks.truncate(w);
}

// ───────────────────────────── tests ─────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn diff_chars(a: &[u8], b: &[u8]) -> Vec<Hunk> {
        CharDiff::default().diff(a, b).to_vec()
    }

    const UNLIMITED: usize = usize::MAX >> 2;

    /// Minimal-ish edit script between two sequences as a hunk list.
    fn diff_slices<T: Elem>(a: &[T], b: &[T], probe: usize, work: usize) -> Vec<Hunk> {
        let mut hunks = Vec::new();
        let p = T::common_prefix(a, b);
        if p == a.len() && p == b.len() {
            return hunks;
        }
        let s = T::common_suffix(&a[p..], &b[p..]);
        let (ahi, bhi) = (a.len() - s, b.len() - s);
        if p == ahi || p == bhi {
            hunks.push(Hunk {
                a_lo: p,
                a_hi: ahi,
                b_lo: p,
                b_hi: bhi,
            });
            return hunks;
        }
        let mut sc = MyersScratch::default();
        let mut changed_a = vec![false; a.len()];
        let mut changed_b = vec![false; b.len()];
        let mut myers = Myers::new(
            a,
            b,
            &mut sc,
            Policy {
                probe,
                exhaustive_max: probe,
                exhaustive_per_elem: 0,
                exhaustive_quota: 0,
                work,
                half_match: 0,
            },
        );
        myers.run(p..ahi, p..bhi, &mut changed_a, &mut changed_b);
        hunks_from_changed(a, b, &changed_a, &changed_b, &mut hunks);
        hunks
    }

    fn lcs_len<T: Eq>(a: &[T], b: &[T]) -> usize {
        let mut prev = vec![0usize; b.len() + 1];
        let mut cur = vec![0usize; b.len() + 1];
        for i in 0..a.len() {
            for j in 0..b.len() {
                cur[j + 1] = if a[i] == b[j] {
                    prev[j] + 1
                } else {
                    prev[j + 1].max(cur[j])
                };
            }
            core::mem::swap(&mut prev, &mut cur);
        }
        prev[b.len()]
    }

    fn check_script<T: Elem + core::fmt::Debug>(a: &[T], b: &[T], hunks: &[Hunk]) -> usize {
        let (mut pa, mut pb) = (0, 0);
        let mut kept = 0;
        for h in hunks {
            assert!(h.a_lo >= pa && h.b_lo >= pb, "{hunks:?}");
            assert_eq!(h.a_lo - pa, h.b_lo - pb, "{hunks:?}");
            assert_eq!(&a[pa..h.a_lo], &b[pb..h.b_lo]);
            kept += h.a_lo - pa;
            assert!(h.a_lo < h.a_hi || h.b_lo < h.b_hi);
            pa = h.a_hi;
            pb = h.b_hi;
        }
        assert_eq!(a.len() - pa, b.len() - pb);
        assert_eq!(&a[pa..], &b[pb..]);
        kept + a.len() - pa
    }

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    #[test]
    fn find_gives_the_first_place_and_charges_for_it() {
        let mut rng = Rng(1977);
        let mut found = 0;
        for iter in 0..4000 {
            let (letters, run) = ([1, 2, 3, 40][iter % 4], [1, 4, 40][iter % 3]);
            let mut hay = Vec::new();
            for _ in 0..rng.below(120) {
                let letter = rng.below(letters) as u8;
                hay.resize(hay.len() + 1 + rng.below(run) as usize, letter);
            }
            let from = rng.below(hay.len() as u64 + 1) as usize;
            let mut needle = hay[from..hay.len().min(from + rng.below(60) as usize)].to_vec();
            needle.push(rng.below(letters) as u8);
            let budget = rng.below(6 * hay.len() as u64 + 2) as isize - 1;

            let starts = (hay.len() + 1).saturating_sub(needle.len());
            let places = || (0..starts).map(|at| &hay[at..at + needle.len()]);
            let first = places().position(|place| place == needle);
            let mut left = budget;
            let expected = first.filter(|_| budget > 0);
            assert_eq!(u8::find(&hay, &needle, &mut left), expected);
            let read = first.map_or(hay.len(), |at| at + needle.len()) as isize;
            assert_eq!(left, budget - if budget > 0 { read } else { 0 });

            let mut expected_left = budget;
            let expected = places().position(|place| {
                let same = place.iter().zip(&needle).take_while(|(x, y)| x == y);
                let same = same.count();
                let is_paid = expected_left > 0;
                expected_left -= if is_paid { 1 + same as isize } else { 0 };
                is_paid && same == needle.len()
            });
            let units = |it: &[u8]| it.iter().map(|&e| u16::from(e) << 8).collect::<Vec<_>>();
            let mut left = budget;
            let at = u16::find(&units(&hay), &units(&needle), &mut left);
            assert_eq!((at, left), (expected, expected_left));
            found += usize::from(at.is_some());
        }
        assert!((1000..3000).contains(&found));

        let hay = [&[b'a'; 18][..], b"b"].concat();
        assert_eq!(u8::find(&hay, &hay[1..], &mut 100), Some(1));
    }

    #[test]
    fn myers_is_minimal_on_random_input() {
        let mut rng = Rng(0x9E3779B97F4A7C15);
        for iter in 0..3000 {
            let alpha = 1 + rng.below(6) as u32;
            let n = rng.below(40) as usize;
            let a: Vec<u32> = (0..n).map(|_| rng.below(alpha as u64) as u32).collect();
            let mut b = a.clone();
            for _ in 0..rng.below(8) {
                match rng.below(3) {
                    0 if !b.is_empty() => {
                        let i = rng.below(b.len() as u64) as usize;
                        b.remove(i);
                    }
                    1 => {
                        let i = rng.below(b.len() as u64 + 1) as usize;
                        b.insert(i, rng.below(alpha as u64) as u32);
                    }
                    _ if !b.is_empty() => {
                        let i = rng.below(b.len() as u64) as usize;
                        b[i] = rng.below(alpha as u64) as u32;
                    }
                    _ => {}
                }
            }
            let hunks = diff_slices(&a, &b, 1024, UNLIMITED);
            let kept = check_script(&a, &b, &hunks);
            assert_eq!(
                kept,
                lcs_len(&a, &b),
                "iter {iter}: {a:?} vs {b:?} → {hunks:?}"
            );
        }
    }

    #[test]
    fn myers_with_tiny_budget_is_still_valid() {
        let mut rng = Rng(12345);
        for _ in 0..500 {
            let n = 50 + rng.below(200) as usize;
            let a: Vec<u32> = (0..n).map(|_| rng.below(3) as u32).collect();
            let b: Vec<u32> = (0..n).map(|_| rng.below(3) as u32).collect();
            let hunks = diff_slices(&a, &b, 2, UNLIMITED);
            let kept = check_script(&a, &b, &hunks);
            let opt = lcs_len(&a, &b);
            assert!(kept <= opt);
            assert!(kept * 10 >= opt * 7, "kept {kept} of {opt}");
        }
    }

    /// What `search` does, by `middle` alone: where to cut or else the two fronts, and `work_left` then.
    fn search_by_middle<T: Elem>(
        m: &mut Myers<T>,
        bx: Rect,
        exhaustive: bool,
    ) -> (Result<Point, (Point, Point)>, isize) {
        let (mut depth, mut left) = (m.policy.probe, m.work_left);
        loop {
            match m.middle(bx, depth) {
                Split::Exact(at, distance) => {
                    let half = distance.div_ceil(2);
                    let round = half + 2 - distance % 2;
                    return (Ok(at), left - ((half + 1) * round) as isize);
                }
                Split::Greedy(f, r) => {
                    left -= ((depth + 1) * (depth + 2)) as isize;
                    let n = (bx.1 - bx.0) + (bx.3 - bx.2);
                    let deep = (left.max(0) as usize / 2).isqrt();
                    let deep = deep.min(m.policy.exhaustive_depth(n));
                    if !exhaustive || depth != m.policy.probe || deep <= depth {
                        return (Err((f, r)), left);
                    }
                    depth = deep;
                }
            }
        }
    }

    fn check_reach<T: Elem>(m: &mut Myers<T>, bx: Rect, depth: usize) {
        let Split::Greedy(f, r) = m.middle(bx, depth) else {
            panic!("the box has more than 2 * depth edits");
        };
        assert_eq!(m.reach(bx, depth, usize::MAX), Some((f, r)));
    }

    #[test]
    fn bits_reaches_as_far_as_middle() {
        let mut sc = MyersScratch::default();
        let mut check = |a: &[u16], b: &[u16], depths: Range<usize>| {
            let mut m = Myers::new(a, b, &mut sc, CHARS);
            for depth in depths {
                check_reach(&mut m, (0, a.len(), 0, b.len()), depth);
            }
        };
        let short_texts: Vec<Vec<u16>> = (2u16..1 << 7)
            .map(|n| (0..n.ilog2()).map(|i| n >> i & 1).collect())
            .collect();
        for a in &short_texts {
            for b in &short_texts {
                if a[0] != b[0] && a.last() != b.last() {
                    let distance = a.len() + b.len() - 2 * lcs_len(a, b);
                    check(a, b, 0..distance.div_ceil(2));
                }
            }
        }
        // The best point is next to the corner of a block.
        let text = |parts: [Range<u16>; 3]| parts.into_iter().flatten().collect::<Vec<_>>();
        for shift in [0, 64] {
            for end in [254, 255, 256, 280] {
                let a = text([1000..1001 + shift, 0..end - shift, 2000..2200]);
                let b = text([999..1000, 0..end - shift, 3000..3200]);
                let depth = shift as usize + 2;
                check(&a, &b, depth..depth + 1);
                check(&b, &a, depth..depth + 1);
            }
        }
        // The last block has one row.
        let a = text([1000..1001, 7..8, 2000..2600]);
        check(&a, &text([999..1000, 7..8, 3000..3063]), 318..319);
    }

    #[test]
    fn reach_gives_the_same_points_or_runs_out() {
        let least_budget = |a: &[u8], b: &[u8], depth: usize| {
            let bx = (0, a.len(), 0, b.len());
            let mut sc = MyersScratch::default();
            let mut m = Myers::new(a, b, &mut sc, CHARS);
            check_reach(&mut m, bx, depth);
            let fronts = m.reach(bx, depth, usize::MAX);
            (0..60_000).step_by(256).find(|&budget| {
                let found = m.reach(bx, depth, budget);
                assert!(found.is_none() || found == fronts);
                found.is_some()
            })
        };
        // From each corner 12 strips of one block, which is the least that a strip takes.
        assert_eq!(least_budget(&[1; 6000], &[2; 10], 2900), Some(2 * 12 * 768));

        let mut rng = Rng(64);
        let shared: Vec<u8> = (0..3000).map(|_| rng.below(20) as u8).collect();
        let a = [
            &[100; 30],
            &shared[..],
            &[101; 9000],
            &shared[..],
            &[102; 30],
        ]
        .concat();
        let b = [
            &[200; 30],
            &shared[..],
            &[201; 9000],
            &shared[..],
            &[202; 30],
        ]
        .concat();
        assert!(least_budget(&a, &b, 64).is_some());
    }

    /// Cuts a box all the way down with `bits`. Each cut has to be that of `middle`, and at a random depth and budget
    /// `search` has to do what `search_by_middle` does, and `reach` what `middle` does.
    fn check_cuts<T: Elem>(a: &[T], b: &[T], slack: usize, rng: &mut Rng) {
        let mut sc = MyersScratch::default();
        let mut m = Myers::new(a, b, &mut sc, CHARS);
        let no_limit = a.len() + b.len();
        let mut boxes = vec![((0, 0), (a.len(), b.len()), None)];
        while let Some(((mut alo, mut blo), (mut ahi, mut bhi), levels)) = boxes.pop() {
            let same = T::common_prefix(&a[alo..ahi], &b[blo..bhi]);
            (alo, blo) = (alo + same, blo + same);
            let same = T::common_suffix(&a[alo..ahi], &b[blo..bhi]);
            (ahi, bhi) = (ahi - same, bhi - same);
            if alo == ahi || blo == bhi {
                continue;
            }
            let bx = (alo, ahi, blo, bhi);
            let Split::Exact(expected, distance) = m.middle(bx, no_limit) else {
                panic!("an unlimited search ends");
            };
            let half = distance.div_ceil(2);
            let (at, first) = match levels {
                Some((first, last)) => {
                    assert_eq!(last - first, distance);
                    (m.split_in_corridor(bx, (first, last)).unwrap(), first)
                }
                None => {
                    assert!(m.guess(bx, no_limit) >= distance);
                    if distance > (ahi - alo).abs_diff(bhi - blo) {
                        assert!(matches!(m.forward(bx, distance - 1), Pass::Beyond(_)));
                    }
                    let pass = m.forward(bx, distance + slack);
                    assert!(matches!(pass, Pass::Within(found) if found == distance));
                    let first = m.corridor.len();
                    let last = first + distance;
                    m.corridor.resize(last + 1, Level::default());
                    let at = m.trace(bx, (first, last), first + half, distance % 2 == 0);
                    (at, first)
                }
            };
            assert_eq!(at, expected);
            m.policy.probe = 1 + rng.below(60) as usize;
            m.policy.exhaustive_max = [half, rng.below(200) as usize][rng.below(2) as usize];
            m.work_left = rng.below(60_000) as isize;
            let exhaustive = rng.below(4) > 0;
            let probe = m.policy.probe;
            let expected = search_by_middle(&mut m, bx, exhaustive);
            let least = rng.below(distance as u64 + 1) as usize;
            let found = match m.search(bx, levels, least, probe, exhaustive) {
                Found::Split(at, _) => Ok(at),
                Found::TooFar(_, Some(fronts)) => Err(fronts),
                Found::TooFar(depth, None) => Err(m.fronts(bx, depth)),
            };
            assert_eq!((found, m.work_left), expected);
            check_reach(&mut m, bx, rng.below(half as u64) as usize);
            boxes.push(((alo, blo), at, Some((first, first + half))));
            boxes.push((at, (ahi, bhi), Some((first + half, first + distance))));
        }
    }

    #[test]
    fn guess_follows_similar_texts_and_is_at_most_the_limit() {
        let mut rng = Rng(500);
        let mut text = || (0..3000).map(|_| rng.below(20) as u8).collect::<Vec<_>>();
        let (a, unrelated) = (text(), text());
        let similar: Vec<u8> = a.chunks(10).flat_map(|it| &it[1..]).copied().collect();
        let mut bits = Bits::default();
        bits.reserve_ids(20);
        assert_eq!(bits.guess(&a, &similar, 1000), 300);
        assert_eq!(bits.guess(&a, &unrelated, 1000), 1000);
    }

    #[test]
    fn bits_cuts_where_middle_does() {
        let mut rng = Rng(2004);
        for iter in 0..600 {
            let letters = [2, 4, 20, 300, 2000][iter % 5];
            let n = rng.below(if iter % 16 == 0 { 1500 } else { 400 }) as usize;
            let mut a: Vec<u16> = (0..n).map(|_| rng.below(letters) as u16).collect();
            if letters == 2000 {
                a = (0..2 * n as u16).collect();
            }
            let mut b = a.clone();
            if iter % 7 == 0 {
                b.rotate_left(n / 3);
            }
            if iter % 3 == 0 {
                let m = rng.below(400);
                b = (0..m).map(|_| rng.below(letters) as u16).collect();
            }
            for _ in 0..rng.below(150) {
                let at = rng.below(b.len() as u64 + 1) as usize;
                let end = b.len().min(at + rng.below(8) as usize);
                let new = if iter % 11 == 1 { 0 } else { rng.below(5) };
                let new = (0..new).map(|_| rng.below(letters) as u16);
                b.splice(at..end, new);
            }
            let slack = [0, rng.below(200) as usize][iter % 2];
            check_cuts(&a, &b, slack, &mut rng);
            let ids = |units: &[u16]| {
                units
                    .iter()
                    .map(|&unit| u32::from(unit))
                    .collect::<Vec<_>>()
            };
            check_cuts(&ids(&a), &ids(&b), slack, &mut rng);
        }
    }

    /// A sum of what `run` marks as changed and of the work it leaves.
    fn sum_of_run<T: Elem>(a: &[T], b: &[T], policy: Policy) -> u64 {
        let mut sc = MyersScratch::default();
        let (mut ca, mut cb) = (vec![false; a.len()], vec![false; b.len()]);
        let mut m = Myers::new(a, b, &mut sc, policy);
        m.run(0..a.len(), 0..b.len(), &mut ca, &mut cb);
        let marks = ca.iter().chain(&cb).map(|&changed| u64::from(changed));
        let left = [m.work_left, m.half_left, m.drop_left].map(|left| left as u64);
        let all = left.into_iter().chain(marks);
        all.fold(0, |sum, it| (sum ^ it).wrapping_mul(0x100_0000_01b3))
    }

    /// The sums are those of a `run` that has no `bits`.
    #[test]
    fn bits_changes_nothing_where_the_search_gives_up() {
        let mut rng = Rng(1986);
        let mut sums = [0u64; 3];
        for iter in 0..240 {
            let letters = [2, 4, 20, 250][iter % 4];
            // All edits but one close together: the limit is reached in a part of a box that is within it.
            let dense = iter % 3 == 0;
            let n = if dense { 2500 } else { 300 } + rng.below(1200);
            let unique = iter % 8 == 7;
            let mut next = |i| if unique { i } else { rng.below(letters) } as u32;
            let a: Vec<u32> = (0..n).map(&mut next).collect();
            let mut b = a.clone();
            b.rotate_left(if iter % 6 == 1 { n as usize / 4 } else { 0 });
            b.remove(0);
            for _ in 0..rng.below(n / 2) {
                let span = b.len() as u64 / if dense { 10 } else { 1 };
                let at = b.len() - rng.below(span + 1) as usize;
                let end = b.len().min(at + rng.below(4) as usize);
                let new = rng.below(4);
                let new = (0..new).map(|_| rng.below(letters) as u32);
                b.splice(at..end, new);
            }
            let (probe, max, per_elem) = if dense { (24, 50, 8) } else { (120, 400, 100) };
            let policy = Policy {
                probe: 8 + rng.below(probe) as usize,
                exhaustive_max: 400 - rng.below(max) as usize,
                exhaustive_per_elem: 12 + rng.below(per_elem) as usize,
                work: rng.below(300_000) as usize,
                ..CHARS
            };
            let as_fast_diff = Policy {
                half_match: AS_FAST_DIFF.half_match,
                ..policy
            };
            let bytes = |v: &[u32]| v.iter().map(|&e| e as u8).collect::<Vec<_>>();
            let units = |v: &[u32]| v.iter().map(|&e| e as u16).collect::<Vec<_>>();
            let found = [
                sum_of_run(&a, &b, policy),
                sum_of_run(&bytes(&a), &bytes(&b), policy),
                sum_of_run(&units(&a), &units(&b), as_fast_diff),
            ];
            for (sum, found) in sums.iter_mut().zip(found) {
                *sum = sum.rotate_left(7) ^ found;
            }
        }
        let expected = [
            0xb84b_f17a_acf5_5fa3,
            0x1cf4_6d7d_fdef_8d15,
            0x2c0f_11cd_fad2_19af,
        ];
        assert_eq!(sums, expected);
    }

    #[test]
    fn overlap() {
        let k = &mut Vec::new();
        assert_eq!(common_overlap(b"", b"abcd", k), 0);
        assert_eq!(common_overlap(b"abc", b"abcd", k), 3);
        assert_eq!(common_overlap(b"123456", b"abcd", k), 0);
        assert_eq!(common_overlap(b"123456xxx", b"xxxabcd", k), 3);
        assert_eq!(common_overlap(b"fi", "\u{fb01}i".as_bytes(), k), 0);
        assert_eq!(common_overlap(b"aaaa", b"aaab", k), 3);
        assert_eq!(common_overlap(b"xabab", b"ababx", k), 4);
        assert_eq!(common_overlap(b"abc", b"cd", k), 1);
        assert_eq!(common_overlap(b"abcb", b"cbcb", k), 2);
        assert_eq!(common_overlap(b"zaa", b"aab", k), 2);
    }

    #[test]
    fn prefix_suffix_swar() {
        let a = b"0123456789abcdefghijklmnopqrstuvwxyz";
        for i in 0..a.len() {
            let mut b = a.to_vec();
            b[i] ^= 1;
            assert_eq!(u8::common_prefix(a, &b), i);
            assert_eq!(u8::common_suffix(a, &b), a.len() - 1 - i);
        }
        assert_eq!(u8::common_prefix(a, &a[..20]), 20);
        assert_eq!(u8::common_suffix(a, &a[10..]), 26);
    }

    /// `trim_and_join` and `slide_edits` with passes that visit every hunk.
    fn cleanup_merge_all(hunks: &mut Vec<Hunk>, a: &[u8], b: &[u8], unit: Unit) {
        loop {
            let mut joined: Vec<Hunk> = Vec::new();
            let mut one = Vec::new();
            for &h in hunks.iter() {
                match unit {
                    Unit::Element => push_trimmed(a, b, h, &mut one),
                    Unit::Line => one.push(h),
                }
                match (joined.last_mut(), one.pop()) {
                    (Some(last), Some(h)) if (last.a_hi, last.b_hi) == (h.a_lo, h.b_lo) => {
                        (last.a_hi, last.b_hi) = (h.a_hi, h.b_hi);
                    }
                    (_, h) => joined.extend(h),
                }
            }
            *hunks = joined;
            let mut moved = false;
            for i in 0..hunks.len() {
                moved |= slide_single_edit(hunks, i, (i.wrapping_sub(1), i + 1), a, b, unit);
            }
            if !moved {
                return;
            }
        }
    }

    #[test]
    fn cleanup_merge_skips_only_hunks_that_stay() {
        let mut rng = Rng(7);
        for iter in 0..40_000 {
            let (unit, words): (_, &[&str]) = match iter % 2 {
                0 => (Unit::Element, &["a", "a", "b", "c"]),
                _ => (Unit::Line, &["a\n", "a\n", "ba\n", "c\n"]),
            };
            let words = &words[..2 + rng.below(3) as usize];
            let (mut a, mut b, mut hunks) = (Vec::new(), Vec::new(), Vec::new());
            for part in rng.below(2)..rng.below(24) {
                let mut text = |min: u64, max: u64| -> Vec<u8> {
                    let len = min + rng.below(max - min + 1);
                    let words = (0..len).map(|_| words[rng.below(words.len() as u64) as usize]);
                    words.collect::<String>().into_bytes()
                };
                let (a_lo, b_lo) = (a.len(), b.len());
                if part % 2 == 0 {
                    let same = text(0, 2);
                    a.extend(&same);
                    b.extend(&same);
                    continue;
                }
                let (one, other) = (text(1, 5), text(1, 3));
                match rng.below(5) {
                    0 | 1 => a.extend(one),
                    2 | 3 => b.extend(one),
                    _ => {
                        a.extend(one);
                        b.extend(other);
                    }
                }
                let (a_hi, b_hi) = (a.len(), b.len());
                hunks.push(Hunk {
                    a_lo,
                    a_hi,
                    b_lo,
                    b_hi,
                });
            }
            let mut expected = hunks.clone();
            cleanup_merge_all(&mut expected, &a, &b, unit);
            trim_and_join(&mut hunks, &a, &b, unit);
            slide_edits(&mut hunks, &a, &b, unit);
            check_script(&a, &b, &hunks);
            assert_eq!(hunks, expected, "iter {iter}");
        }
    }

    #[test]
    fn interner_finds_lines_that_got_no_slot() {
        let count = 2 * PROBES;
        let mask = Interner::<&[u8]>::with_capacity(count).mask;
        let lines: Vec<String> = (0..)
            .map(|i| format!("{i}\n"))
            .filter(|line| hash_bytes(line.as_bytes()) as usize & mask == 0)
            .take(count + 1)
            .collect();
        let (known, unknown) = (&lines[..count], &lines[count]);
        // With no capacity it grows, up to the same size.
        for capacity in [count, 0] {
            let mut interner = Interner::with_capacity(capacity);
            for _ in 0..2 {
                let ids = known.iter().map(|line| interner.intern(line.as_bytes()));
                assert!(ids.eq(0..count as u32));
            }
            assert_eq!((interner.mask, interner.overflow.len()), (mask, PROBES));
            let found = known.iter().map(|line| interner.find(line.as_bytes()));
            assert!(found.eq((0..count as u32).map(Some)));
            assert_eq!(interner.find(unknown.as_bytes()), None);
        }
    }

    fn text(parts: &[(&str, usize)]) -> Vec<u8> {
        let parts = parts.iter().map(|&(part, n)| part.repeat(n));
        parts.collect::<String>().into_bytes()
    }

    #[test]
    fn greedy_cut_drops_the_reverse_point_until_that_has_cost_the_budget() {
        let a = text(&[("c", 10_000), ("x", 20_000), ("d", 1)]);
        let b = text(&[("d", 1), ("x", 20_000), ("c", 1)]);
        let kept = |work| check_script(&a, &b, &diff_slices(&a, &b, MIN_PROBE, work));
        assert_eq!(kept(UNLIMITED), 1);
        assert!(kept(80_000) >= 20_000 - MIN_PROBE);
    }

    #[test]
    fn greedy_cut_past_the_budget() {
        // Unique ids cut the diff in two. The first part spends the budget.
        let kept_after = |a: &[(&str, usize)], b: &[(&str, usize)]| {
            let ids = |first: &[(&str, usize)], second| -> Vec<u32> {
                let [first, second] = [first, second].map(|it| text(it).into_iter().map(u32::from));
                first.chain(1000..21_000).chain(second).collect()
            };
            let a = ids(&[("c", 10_000), ("x", 20_000), ("d", 1)], a);
            let b = ids(&[("d", 1), ("x", 20_000), ("c", 1)], b);
            check_script(&a, &b, &diff_slices(&a, &b, 128, 400_000))
        };
        let before = 20_000 - MIN_PROBE + 20_000;
        // The forward point got further.
        let a = [("d", 1), ("x", 20_000), ("c", 10_000)];
        let b = [("c", 1), ("x", 20_000), ("d", 1)];
        assert!(kept_after(&a, &b) >= before + 20_000);
        // The reverse point got further, but both are taken.
        let a = [("c", 100), ("y", 50), ("c", 1000), ("x", 5000), ("d", 1)];
        let b = [("y", 50), ("e", 1000), ("x", 5000), ("e", 1)];
        assert!(kept_after(&a, &b) >= before + 5050);
    }

    #[test]
    fn greedy_cut_at_both_points_drops_nothing() {
        let a = text(&[("c", 1000), ("x", 1000), ("d", 1), ("z", 60_000), ("e", 1)]);
        let b = text(&[("d", 1), ("x", 1000), ("c", 100), ("z", 60_000), ("f", 1)]);
        assert_eq!(
            diff_slices(&a, &b, MIN_PROBE, 100_000),
            diff_slices(&a, &b, MIN_PROBE, UNLIMITED)
        );
    }

    fn render(a: &[u8], b: &[u8], hunks: &[Hunk]) -> String {
        let mut s = String::new();
        let mut pa = 0;
        for h in hunks {
            s.push_str(core::str::from_utf8(&a[pa..h.a_lo]).unwrap());
            if h.deleted() > 0 {
                s.push_str("<del>");
                s.push_str(core::str::from_utf8(&a[h.a_lo..h.a_hi]).unwrap());
                s.push_str("</del>");
            }
            if h.inserted() > 0 {
                s.push_str("<ins>");
                s.push_str(core::str::from_utf8(&b[h.b_lo..h.b_hi]).unwrap());
                s.push_str("</ins>");
            }
            pa = h.a_hi;
        }
        s.push_str(core::str::from_utf8(&a[pa..]).unwrap());
        s
    }

    #[test]
    fn chars() {
        assert_eq!(
            render(b"abc", b"ab123c", &diff_chars(b"abc", b"ab123c")),
            "ab<ins>123</ins>c"
        );
        assert_eq!(
            render(
                b"The cat came.",
                b"The came.",
                &diff_chars(b"The cat came.", b"The came.")
            ),
            "The <del>cat </del>came."
        );
        // Overlap elimination.
        assert_eq!(
            render(
                b"1abcxxxx2",
                b"1xxxxdef2",
                &diff_chars(b"1abcxxxx2", b"1xxxxdef2")
            ),
            "1<del>abc</del>xxxx<ins>def</ins>2"
        );
        // UTF-8 boundaries.
        let (x, y) = ("Hello 👋 世界 🌎!", "Hello 👋 世界 🌍!");
        assert_eq!(
            render(
                x.as_bytes(),
                y.as_bytes(),
                &diff_chars(x.as_bytes(), y.as_bytes())
            ),
            "Hello 👋 世界 <del>🌎</del><ins>🌍</ins>!"
        );
        let (x, y) = ("Line 3: Привет", "Line 3: Здравствуйте");
        assert_eq!(
            render(
                x.as_bytes(),
                y.as_bytes(),
                &diff_chars(x.as_bytes(), y.as_bytes())
            ),
            "Line 3: <del>Привет</del><ins>Здравствуйте</ins>"
        );
    }

    /// What fast-diff 1.3.0 gives. Without its shortcuts the search cuts each of the first three elsewhere.
    #[test]
    fn as_fast_diff() {
        for (a, b, expected) in [
            (
                "aab ;;;b a;",
                "ab ;;ba;",
                "<del>a</del>ab ;;<del>;</del>b<del> </del>a;",
            ),
            (
                ",aba aa;a;",
                ",aa a;ba;",
                ",a<del>b</del>a a<del>a</del>;<ins>b</ins>a;",
            ),
            (
                "b   ,,,,  ",
                "    ,,,  ",
                "<del>b</del>   <del>,</del><ins> </ins>,,,  ",
            ),
            ("  x\n", "    x\n", "<ins>  </ins>  x\n"),
            ("abc", "abc", "abc"),
            ("", "abc", "<ins>abc</ins>"),
        ] {
            let (a, b) = (a.as_bytes(), b.as_bytes());
            assert_eq!(
                render(a, b, CharDiff::default().diff_as_fast_diff(a, b)),
                expected
            );
        }
        let units = |text: &str| text.encode_utf16().collect::<Vec<u16>>();
        let hunk = |a_lo, a_hi, b_lo, b_hi| Hunk {
            a_lo,
            a_hi,
            b_lo,
            b_hi,
        };
        assert_eq!(
            CharDiff::default().diff_as_fast_diff(&units("é  = 1"), &units("é = 1;")),
            [hunk(2, 3, 2, 2), hunk(6, 6, 5, 6)]
        );
        // The two differ in the second half of a surrogate pair.
        assert_eq!(
            CharDiff::default().diff_as_fast_diff(&units("a = 😀;"), &units("a = 😁;")),
            [hunk(4, 6, 4, 6)]
        );
        // Quadratic for fast-diff.
        let blanks = |first: usize, second: usize| {
            [" ".repeat(first), " ".repeat(second)]
                .join("x")
                .into_bytes()
        };
        let (a, b) = (blanks(300_000, 300_000), blanks(299_993, 300_005));
        check_script(&a, &b, CharDiff::default().diff_as_fast_diff(&a, &b));
    }

    #[test]
    fn lines() {
        let a = b"a\nb\nc\nd\n";
        let b = b"a\nB\nc\nd\ne";
        let hunks = diff_lines(a, b);
        assert_eq!(
            render(a, b, &hunks),
            "a\n<del>b\n</del><ins>B\n</ins>c\nd\n<ins>e</ins>"
        );
        let a = b"x\ny";
        let b = b"x\ny\nz";
        assert_eq!(
            render(a, b, &diff_lines(a, b)),
            "x\n<del>y</del><ins>y\nz</ins>"
        );
        let a = b"q\nx";
        let b = b"z\nq\nx";
        assert_eq!(render(a, b, &diff_lines(a, b)), "<ins>z\n</ins>q\nx");
    }

    fn split_lines(t: &[u8]) -> Vec<&[u8]> {
        let mut v = Vec::new();
        let mut s = 0;
        for (i, &c) in t.iter().enumerate() {
            if c == b'\n' {
                v.push(&t[s..=i]);
                s = i + 1;
            }
        }
        if s < t.len() {
            v.push(&t[s..]);
        }
        v
    }

    #[test]
    fn lines_random_optimal_and_aligned() {
        let mut rng = Rng(0xABCDEF);
        let vocab: [&[u8]; 6] = [b"a\n", b"b\n", b"}\n", b"\n", b"long line here\n", b"x"];
        for iter in 0..4000 {
            let make = |rng: &mut Rng| -> Vec<u8> {
                let n = rng.below(12) as usize;
                let mut t = Vec::new();
                for i in 0..n {
                    // "x" (no newline) only allowed last
                    let mut k = rng.below(vocab.len() as u64) as usize;
                    if i + 1 != n && k == 5 {
                        k = 0;
                    }
                    t.extend_from_slice(vocab[k]);
                }
                t
            };
            let a = make(&mut rng);
            let b = if rng.below(3) == 0 {
                make(&mut rng)
            } else {
                // small mutation of a at line granularity
                let mut ls: Vec<&[u8]> = split_lines(&a);
                for _ in 0..1 + rng.below(3) {
                    match rng.below(3) {
                        0 if !ls.is_empty() => {
                            let i = rng.below(ls.len() as u64) as usize;
                            ls.remove(i);
                        }
                        1 => {
                            let i = rng.below(ls.len() as u64 + 1) as usize;
                            let i = i.min(ls.len().saturating_sub(1));
                            ls.insert(i, vocab[rng.below(5) as usize]);
                        }
                        _ => {}
                    }
                }
                ls.concat()
            };
            let hunks = diff_lines(&a, &b);
            let kept_bytes = check_script(&a[..], &b[..], &hunks);
            let _ = kept_bytes;
            // boundaries on line starts
            for h in &hunks {
                for (t, lo, hi) in [(&a, h.a_lo, h.a_hi), (&b, h.b_lo, h.b_hi)] {
                    for p in [lo, hi] {
                        assert!(
                            p == 0 || p == t.len() || t[p - 1] == b'\n',
                            "iter {iter}: {:?} vs {:?}: {hunks:?}",
                            bstr::BStr::new(&a),
                            bstr::BStr::new(&b)
                        );
                    }
                }
            }
            // optimal in lines
            let (la, lb) = (split_lines(&a), split_lines(&b));
            let mut kept_lines = 0;
            let mut pa = 0;
            for h in &hunks {
                kept_lines += split_lines(&a[pa..h.a_lo]).len();
                pa = h.a_hi;
            }
            kept_lines += split_lines(&a[pa..]).len();
            assert_eq!(
                kept_lines,
                lcs_len(&la, &lb),
                "iter {iter}: {:?} vs {:?}: {hunks:?}",
                bstr::BStr::new(&a),
                bstr::BStr::new(&b)
            );
        }
    }

    #[test]
    fn chars_random_valid_utf8_boundaries() {
        let mut rng = Rng(77);
        let alphabet = [
            "a", "b", " ", "\n", "é", "è", "世", "🌍", "🌎", ".", "ab", "文", "本", "字", "符",
            "串", "测", "Пр", "и",
        ];
        let mut cd = CharDiff::default();
        for iter in 0..4000 {
            let make = |rng: &mut Rng, n: usize| -> String {
                (0..n)
                    .map(|_| alphabet[rng.below(alphabet.len() as u64) as usize])
                    .collect()
            };
            let n = rng.below(20) as usize;
            let a = make(&mut rng, n);
            let b = if rng.below(2) == 0 {
                let n = rng.below(20) as usize;
                make(&mut rng, n)
            } else {
                let mut cs: Vec<char> = a.chars().collect();
                for _ in 0..1 + rng.below(3) {
                    if !cs.is_empty() && rng.below(2) == 0 {
                        let i = rng.below(cs.len() as u64) as usize;
                        cs.remove(i);
                    } else {
                        let i = rng.below(cs.len() as u64 + 1) as usize;
                        cs.insert(
                            i,
                            alphabet[rng.below(alphabet.len() as u64) as usize]
                                .chars()
                                .next()
                                .unwrap(),
                        );
                    }
                }
                cs.into_iter().collect()
            };
            let hunks = cd.diff(a.as_bytes(), b.as_bytes()).to_vec();
            check_script(a.as_bytes(), b.as_bytes(), &hunks);
            for h in &hunks {
                assert!(
                    a.is_char_boundary(h.a_lo) && a.is_char_boundary(h.a_hi),
                    "iter {iter}: {a:?} vs {b:?}: {hunks:?}"
                );
                assert!(
                    b.is_char_boundary(h.b_lo) && b.is_char_boundary(h.b_hi),
                    "iter {iter}: {a:?} vs {b:?}: {hunks:?}"
                );
            }
        }
    }

    #[test]
    fn work_cap_gives_valid_coarse_result() {
        // Two long unrelated byte strings: the search must give up within the
        // work cap and still return a valid (if coarse) script.
        let mut rng = Rng(99);
        let a: Vec<u8> = (0..20_000).map(|_| b'a' + rng.below(20) as u8).collect();
        let b: Vec<u8> = (0..20_000).map(|_| b'a' + rng.below(20) as u8).collect();
        let mut sc = MyersScratch::default();
        let (mut ca, mut cb) = (vec![false; a.len()], vec![false; b.len()]);
        let policy = Policy {
            probe: 64,
            exhaustive_max: 64,
            exhaustive_per_elem: 0,
            exhaustive_quota: 0,
            work: 200_000,
            half_match: 0,
        };
        let mut m = Myers::new(&a[..], &b[..], &mut sc, policy);
        m.run(0..a.len(), 0..b.len(), &mut ca, &mut cb);
        assert!(m.work_left <= 0, "cap should have been reached");
        let mut hunks = Vec::new();
        hunks_from_changed(&a[..], &b[..], &ca, &cb, &mut hunks);
        check_script(&a[..], &b[..], &hunks);
        // And the production char policy on the same input terminates with a
        // valid script too.
        let hunks = diff_chars(&a, &b);
        check_script(&a[..], &b[..], &hunks);
    }

    /// The sums are those of a `run` that has no `bits`.
    #[test]
    fn bits_changes_nothing_in_boxes_of_twice_the_probe() {
        for (seed, n, m, probe, sum) in [
            (128, 1500, 1500, 2 * MIN_PROBE, 0x6cdd_3485_7249_1a57),
            (11, 360, 361, 2 * MIN_PROBE - 1, 0xf882_9b5c_c8c6_8926),
        ] {
            let mut rng = Rng(seed);
            let mut text = |len| (0..len).map(|_| rng.below(4) as u8).collect::<Vec<_>>();
            let policy = Policy {
                probe,
                exhaustive_max: 0,
                ..CHARS
            };
            assert_eq!(sum_of_run(&text(n), &text(m), policy), sum);
        }
    }

    #[test]
    fn line_policy_is_exact_on_hard_medium_input() {
        // ~3k lines over a 5-letter alphabet with 60% random edits: no unique
        // anchors, edit distance far beyond the probe depth — the exhaustive
        // attempt must still find the true LCS.
        let mut rng = Rng(7);
        let n = 3000;
        let a: Vec<u32> = (0..n).map(|_| rng.below(5) as u32).collect();
        let mut b = a.clone();
        for _ in 0..n * 6 / 10 {
            let i = rng.below(b.len() as u64) as usize;
            match rng.below(3) {
                0 => {
                    b.remove(i);
                }
                1 => b.insert(i, rng.below(5) as u32),
                _ => b[i] = rng.below(5) as u32,
            }
        }
        let ta: String = a.iter().map(|x| format!("{x}\n")).collect();
        let tb: String = b.iter().map(|x| format!("{x}\n")).collect();
        let hunks = diff_lines(ta.as_bytes(), tb.as_bytes());
        check_script(ta.as_bytes(), tb.as_bytes(), &hunks);
        let mut kept = 0;
        let mut pa = 0;
        for h in &hunks {
            kept += split_lines(&ta.as_bytes()[pa..h.a_lo]).len();
            pa = h.a_hi;
        }
        kept += split_lines(&ta.as_bytes()[pa..]).len();
        assert_eq!(kept, lcs_len(&a, &b));
    }
}
