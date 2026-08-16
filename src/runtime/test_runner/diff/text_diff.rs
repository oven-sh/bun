//! Line- and character-level diffing for test-runner output.
//!
//! The core is Myers' O(ND) algorithm in its linear-space, bidirectional
//! ("middle snake") form. Instead of a wall-clock timeout, each middle-snake
//! search has a work budget: once the forward and reverse fronts have each
//! advanced `budget` steps without meeting, the box is split at the points of
//! furthest progress and each part is solved independently. That keeps the
//! worst case near-linear while producing a minimal diff whenever the edit
//! distance inside a box is within budget — which, after unique-line
//! elimination, is almost always.
//!
//! The semantic post-processing (`cleanup_semantic`) is a port of the
//! corresponding passes from diff-match-patch, operating on index ranges
//! instead of owned strings.
//
// diff-match-patch is Copyright 2018 The diff-match-patch Authors,
// licensed under the Apache License, Version 2.0.

use core::ops::Range;

use bun_core::strings::{
    count_char, index_of, index_of_char_usize as index_of_char, last_index_of_char,
};
use bun_wyhash::hash as hash_bytes;

/// `a[a_lo..a_hi]` was replaced by `b[b_lo..b_hi]`. Either range may be empty
/// (pure insertion / pure deletion) but not both. A list of hunks is sorted,
/// non-overlapping, and everything between consecutive hunks is equal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Hunk {
    pub a_lo: usize,
    pub a_hi: usize,
    pub b_lo: usize,
    pub b_hi: usize,
}

impl Hunk {
    #[inline]
    pub(crate) fn deleted(&self) -> usize {
        self.a_hi - self.a_lo
    }
    #[inline]
    pub(crate) fn inserted(&self) -> usize {
        self.b_hi - self.b_lo
    }
}

// ───────────────────────────── element types ─────────────────────────────

pub(crate) trait Elem: Copy + Eq {
    /// Dense id for anchor bookkeeping; `None` disables anchoring.
    fn id(self) -> Option<usize> {
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

impl Elem for u32 {
    #[inline]
    fn id(self) -> Option<usize> {
        Some(self as usize)
    }
}

impl Elem for u8 {
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

const NONE: isize = isize::MIN / 2;

enum Split {
    /// A point on an optimal path.
    Exact(usize, usize),
    /// Out of budget: best forward point and best reverse point (either may
    /// coincide with a corner, in which case it is useless).
    Greedy((usize, usize), (usize, usize)),
}

struct Myers<'a, 's, T: Elem> {
    a: &'a [T],
    b: &'a [T],
    vf: &'s mut Vec<isize>,
    vb: &'s mut Vec<isize>,
    /// Total diagonal-steps left before remaining boxes are given up on.
    work_left: isize,
    budget: (usize, usize),
    anchors: Option<Anchors>,
}

#[derive(Default)]
struct MyersScratch {
    vf: Vec<isize>,
    vb: Vec<isize>,
    changed_a: Vec<bool>,
    changed_b: Vec<bool>,
}

/// Scratch for the unique-token anchor fallback (line mode only).
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
}

struct Job {
    alo: usize,
    ahi: usize,
    blo: usize,
    bhi: usize,
    budget: usize,
}

impl<'a, 's, T: Elem> Myers<'a, 's, T> {
    /// `budget` is the (floor, ceiling) for the per-box search depth; `work_cap`
    /// bounds the total.
    fn new(
        a: &'a [T],
        b: &'a [T],
        vf: &'s mut Vec<isize>,
        vb: &'s mut Vec<isize>,
        budget: (usize, usize),
        work_cap: usize,
        anchors: Option<Anchors>,
    ) -> Self {
        Self {
            a,
            b,
            vf,
            vb,
            work_left: work_cap as isize,
            budget,
            anchors,
        }
    }

    fn budget_for(&self, n: usize) -> usize {
        budget_for(n, self.budget.0, self.budget.1)
    }

    /// Marks every element of `a[a_rng]` / `b[b_rng]` that is not part of a
    /// longest common subsequence as changed.
    fn run(
        &mut self,
        a_rng: Range<usize>,
        b_rng: Range<usize>,
        changed_a: &mut [bool],
        changed_b: &mut [bool],
    ) {
        let budget = self.budget_for(a_rng.len() + b_rng.len());
        let mut stack: Vec<Job> = vec![Job {
            alo: a_rng.start,
            ahi: a_rng.end,
            blo: b_rng.start,
            bhi: b_rng.end,
            budget,
        }];
        while let Some(Job {
            mut alo,
            mut ahi,
            mut blo,
            mut bhi,
            budget,
        }) = stack.pop()
        {
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
            if self.work_left <= 0 {
                changed_a[alo..ahi].fill(true);
                changed_b[blo..bhi].fill(true);
                continue;
            }

            match self.middle(alo, ahi, blo, bhi, budget) {
                Split::Exact(x, y) => {
                    stack.push(Job {
                        alo: x,
                        ahi,
                        blo: y,
                        bhi,
                        budget,
                    });
                    stack.push(Job {
                        alo,
                        ahi: x,
                        blo,
                        bhi: y,
                        budget,
                    });
                }
                Split::Greedy(f, r) => {
                    if self.anchors.is_some()
                        && self.split_at_anchors(alo, ahi, blo, bhi, &mut stack)
                    {
                        continue;
                    }
                    // Past this point the result is approximate anyway, so
                    // spend less looking for exact sub-solutions.
                    let budget = (budget / 2).max(MIN_BUDGET);
                    let inside =
                        |(x, y): (usize, usize)| (x, y) != (alo, blo) && (x, y) != (ahi, bhi);
                    match (inside(f), inside(r)) {
                        (true, true) if f.0 <= r.0 && f.1 <= r.1 && f != r => {
                            stack.push(Job {
                                alo: r.0,
                                ahi,
                                blo: r.1,
                                bhi,
                                budget,
                            });
                            stack.push(Job {
                                alo: f.0,
                                ahi: r.0,
                                blo: f.1,
                                bhi: r.1,
                                budget,
                            });
                            stack.push(Job {
                                alo,
                                ahi: f.0,
                                blo,
                                bhi: f.1,
                                budget,
                            });
                        }
                        (true, _) => {
                            stack.push(Job {
                                alo: f.0,
                                ahi,
                                blo: f.1,
                                bhi,
                                budget,
                            });
                            stack.push(Job {
                                alo,
                                ahi: f.0,
                                blo,
                                bhi: f.1,
                                budget,
                            });
                        }
                        (false, true) => {
                            stack.push(Job {
                                alo: r.0,
                                ahi,
                                blo: r.1,
                                bhi,
                                budget,
                            });
                            stack.push(Job {
                                alo,
                                ahi: r.0,
                                blo,
                                bhi: r.1,
                                budget,
                            });
                        }
                        (false, false) => {
                            changed_a[alo..ahi].fill(true);
                            changed_b[blo..bhi].fill(true);
                        }
                    }
                }
            }
        }
    }

    /// Patience-style fallback: tokens that occur exactly once on each side of
    /// the box, taken in their longest jointly-increasing run, are fixed as
    /// matches and the box is cut at each. Returns false if there are none.
    fn split_at_anchors(
        &mut self,
        alo: usize,
        ahi: usize,
        blo: usize,
        bhi: usize,
        stack: &mut Vec<Job>,
    ) -> bool {
        let bud = self.budget;
        let an = self.anchors.as_mut().unwrap();
        for &t in &self.a[alo..ahi] {
            an.count_a[t.id().unwrap()] += 1;
        }
        for (j, &t) in self.b[blo..bhi].iter().enumerate() {
            let id = t.id().unwrap();
            an.count_b[id] += 1;
            an.pos_b[id] = (blo + j) as u32;
        }
        an.pairs.clear();
        for (i, &t) in self.a[alo..ahi].iter().enumerate() {
            let id = t.id().unwrap();
            if an.count_a[id] == 1 && an.count_b[id] == 1 {
                an.pairs.push(((alo + i) as u32, an.pos_b[id]));
            }
        }
        for &t in &self.a[alo..ahi] {
            an.count_a[t.id().unwrap()] = 0;
        }
        for &t in &self.b[blo..bhi] {
            an.count_b[t.id().unwrap()] = 0;
        }
        if an.pairs.is_empty() {
            return false;
        }

        // Longest increasing subsequence of `pairs` by b-position (a is
        // already increasing). tails[k] = index of the pair ending the best
        // run of length k+1; prev[] threads the chosen run back.
        an.tails.clear();
        an.prev.clear();
        an.prev.resize(an.pairs.len(), u32::MAX);
        for (idx, &(_, j)) in an.pairs.iter().enumerate() {
            let pos = an.tails.partition_point(|&t| an.pairs[t as usize].1 < j);
            if pos > 0 {
                an.prev[idx] = an.tails[pos - 1];
            }
            if pos == an.tails.len() {
                an.tails.push(idx as u32);
            } else {
                an.tails[pos] = idx as u32;
            }
        }
        // Reuse `tails` to hold the run itself, last to first.
        let mut cur = *an.tails.last().unwrap();
        an.tails.clear();
        while cur != u32::MAX {
            an.tails.push(cur);
            cur = an.prev[cur as usize];
        }

        let (mut ea, mut eb) = (ahi, bhi);
        let mut push = |alo: usize, ahi: usize, blo: usize, bhi: usize| {
            if alo < ahi || blo < bhi {
                stack.push(Job {
                    alo,
                    ahi,
                    blo,
                    bhi,
                    budget: budget_for(ahi - alo + bhi - blo, bud.0, bud.1),
                });
            }
        };
        for &pi in an.tails.iter() {
            let (i, j) = an.pairs[pi as usize];
            let (i, j) = (i as usize, j as usize);
            push(i + 1, ea, j + 1, eb);
            (ea, eb) = (i, j);
        }
        push(alo, ea, blo, eb);
        true
    }

    /// Bidirectional search for a point on an optimal edit path through the box
    /// `a[alo..ahi] × b[blo..bhi]`. The box must have no common prefix or
    /// suffix and both sides must be non-empty.
    fn middle(&mut self, alo: usize, ahi: usize, blo: usize, bhi: usize, budget: usize) -> Split {
        let a = &self.a[alo..ahi];
        let b = &self.b[blo..bhi];
        let n = a.len() as isize;
        let m = b.len() as isize;
        let delta = n - m;
        let dmax = (n + m + 1) / 2;
        let bmax = dmax.min(budget as isize);
        // Diagonals k ∈ [-bmax-1, bmax+1] are addressable.
        let off = bmax + 1;
        let size = (2 * bmax + 3) as usize;
        self.vf.clear();
        self.vf.resize(size, NONE);
        self.vb.clear();
        self.vb.resize(size, NONE);
        let vf = &mut self.vf[..];
        let vb = &mut self.vb[..];
        vf[(off + 1) as usize] = 0;
        vb[(off + 1) as usize] = 0;
        // If the total length is odd the fronts can only meet during the
        // forward phase, otherwise only during the reverse phase.
        let front = delta & 1 != 0;

        let mut best_f = (-1isize, 0isize, 0isize);
        let mut best_b = (-1isize, 0isize, 0isize);

        // SAFETY (all unchecked indexing below): k, k±1, k2, k2±1 lie in
        // [-bmax-1, bmax+1] so `+ off` is in-bounds for vf/vb; x∈[0,n], y∈[0,m].
        let mut d: isize = 0;
        while d <= bmax {
            // Forward: vf[k] = furthest x on diagonal k (= x - y) at cost d.
            let (mut k, kmax) = diag_range(d, n, m);
            while k <= kmax {
                let i = (k + off) as usize;
                let (mut x, right, down) = unsafe {
                    (
                        *vf.get_unchecked(i),
                        *vf.get_unchecked(i - 1) + 1,
                        *vf.get_unchecked(i + 1),
                    )
                };
                if right >= 0 && right <= n && right - k <= m && right > x {
                    x = right;
                }
                if down >= 0 && down - k <= m && down > x {
                    x = down;
                }
                if x >= 0 {
                    let mut y = x - k;
                    if x < n
                        && y < m
                        && unsafe { *a.get_unchecked(x as usize) == *b.get_unchecked(y as usize) }
                    {
                        let s = 1 + T::common_prefix(&a[x as usize + 1..], &b[y as usize + 1..])
                            as isize;
                        x += s;
                        y += s;
                    }
                    unsafe { *vf.get_unchecked_mut(i) = x };
                    if x + y > best_f.0 {
                        best_f = (x + y, x, y);
                    }
                    if front {
                        let k2 = delta - k;
                        if k2.abs() < d {
                            let x2 = unsafe { *vb.get_unchecked((k2 + off) as usize) };
                            if x2 >= 0 && x >= n - x2 {
                                self.work_left -= (d + 1) * (d + 1);
                                return Split::Exact(alo + x as usize, blo + y as usize);
                            }
                        }
                    }
                }
                k += 2;
            }

            // Reverse: vb[k2] = furthest x2 (elements consumed from the end
            // of `a`) on reverse diagonal k2 (= x2 - y2) at cost d.
            let (mut k2, k2max) = diag_range(d, n, m);
            while k2 <= k2max {
                let i = (k2 + off) as usize;
                let (mut x2, right, down) = unsafe {
                    (
                        *vb.get_unchecked(i),
                        *vb.get_unchecked(i - 1) + 1,
                        *vb.get_unchecked(i + 1),
                    )
                };
                if right >= 0 && right <= n && right - k2 <= m && right > x2 {
                    x2 = right;
                }
                if down >= 0 && down - k2 <= m && down > x2 {
                    x2 = down;
                }
                if x2 >= 0 {
                    let mut y2 = x2 - k2;
                    if x2 < n
                        && y2 < m
                        && unsafe {
                            *a.get_unchecked((n - 1 - x2) as usize)
                                == *b.get_unchecked((m - 1 - y2) as usize)
                        }
                    {
                        let s = 1 + T::common_suffix(
                            &a[..(n - 1 - x2) as usize],
                            &b[..(m - 1 - y2) as usize],
                        ) as isize;
                        x2 += s;
                        y2 += s;
                    }
                    unsafe { *vb.get_unchecked_mut(i) = x2 };
                    if x2 + y2 > best_b.0 {
                        best_b = (x2 + y2, x2, y2);
                    }
                    if !front {
                        let k = delta - k2;
                        if k.abs() <= d {
                            let x = unsafe { *vf.get_unchecked((k + off) as usize) };
                            if x >= 0 && x >= n - x2 {
                                self.work_left -= (d + 1) * (d + 2);
                                return Split::Exact(alo + x as usize, blo + (x - k) as usize);
                            }
                        }
                    }
                }
                k2 += 2;
            }
            d += 1;
        }

        self.work_left -= (bmax + 1) * (bmax + 2);
        // With an unrestricted search the fronts always meet.
        debug_assert!(bmax < dmax);

        let (_, fx, fy) = best_f;
        let (_, bx2, by2) = best_b;
        Split::Greedy(
            (alo + fx as usize, blo + fy as usize),
            (alo + (n - bx2) as usize, blo + (m - by2) as usize),
        )
    }
}

const MIN_BUDGET: usize = 64;

/// Diagonals worth visiting at step `d`: `[-d, d]` clipped to the grid
/// (`-m ≤ k ≤ n`), keeping k ≡ d (mod 2).
#[inline]
fn diag_range(d: isize, n: isize, m: isize) -> (isize, isize) {
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

/// Per-box search depth before falling back to heuristics: enough that an
/// edit distance up to ~2·budget inside one box is solved exactly.
fn budget_for(n: usize, floor: usize, ceil: usize) -> usize {
    let mut s = 16usize;
    while s * s < n {
        s *= 2;
    }
    s.clamp(floor, ceil)
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

/// Open-addressing table from line content to dense id. Sized up front (the
/// line count is known) so it never rehashes; a slot is the top 32 bits of the
/// hash plus the id, and candidates are confirmed by comparing bytes.
struct Interner<'a> {
    slots: Vec<(u32, u32)>,
    mask: usize,
    lines: Vec<&'a [u8]>,
}

const EMPTY: u32 = u32::MAX;

impl<'a> Interner<'a> {
    fn with_capacity(lines: usize) -> Self {
        let cap = (lines * 2).max(16).next_power_of_two();
        Self {
            slots: vec![(0, EMPTY); cap],
            mask: cap - 1,
            lines: Vec::with_capacity(lines),
        }
    }

    #[inline]
    fn intern(&mut self, line: &'a [u8]) -> u32 {
        let h = hash_line(line);
        let tag = (h >> 32) as u32;
        let mut i = h as usize & self.mask;
        loop {
            // SAFETY: i is masked to the table size.
            let slot = unsafe { self.slots.get_unchecked_mut(i) };
            if slot.1 == EMPTY {
                let id = self.lines.len() as u32;
                *slot = (tag, id);
                self.lines.push(line);
                return id;
            }
            if slot.0 == tag && self.lines[slot.1 as usize] == line {
                return slot.1;
            }
            i = (i + 1) & self.mask;
        }
    }
}

#[inline]
fn hash_line(line: &[u8]) -> u64 {
    #[inline(always)]
    fn fold(a: u64, b: u64) -> u64 {
        let p = (a as u128).wrapping_mul(b as u128);
        (p as u64) ^ ((p >> 64) as u64)
    }
    const K0: u64 = 0x243F_6A88_85A3_08D3;
    const K1: u64 = 0x1319_8A2E_0370_7344;
    let n = line.len();
    if n > 16 {
        return hash_bytes(line);
    }
    let (lo, hi) = if n >= 8 {
        (
            u64::from_le_bytes(line[..8].try_into().unwrap()),
            u64::from_le_bytes(line[n - 8..].try_into().unwrap()),
        )
    } else if n >= 4 {
        (
            u32::from_le_bytes(line[..4].try_into().unwrap()) as u64,
            u32::from_le_bytes(line[n - 4..].try_into().unwrap()) as u64,
        )
    } else {
        let mut buf = [0u8; 4];
        buf[..n].copy_from_slice(line);
        (u32::from_le_bytes(buf) as u64, 0)
    };
    fold(lo ^ K0, hi ^ K1 ^ n as u64)
}

/// Splits `text` into lines (each keeping its `\n`; the last line may lack
/// one), interning each. Returns token ids and `lines + 1` byte offsets.
fn tokenize<'a>(
    text: &'a [u8],
    base: usize,
    interner: &mut Interner<'a>,
    ids: &mut Vec<u32>,
    offs: &mut Vec<u32>,
) {
    let mut start = 0;
    offs.push(base as u32);
    while start < text.len() {
        let end = match next_newline(text, start) {
            Some(i) => i + 1,
            None => text.len(),
        };
        ids.push(interner.intern(&text[start..end]));
        offs.push((base + end) as u32);
        start = end;
    }
}

/// Position of the first `\n` at or after `from`. Most lines are short, so
/// probe a few words inline before handing off to the SIMD search.
#[inline]
fn next_newline(text: &[u8], from: usize) -> Option<usize> {
    const NL: u64 = 0x0A0A_0A0A_0A0A_0A0A;
    const LO: u64 = 0x0101_0101_0101_0101;
    const HI: u64 = 0x8080_8080_8080_8080;
    let mut i = from;
    let stop = (from + 32).min(text.len());
    while i + 8 <= stop {
        let x = u64::from_le_bytes(text[i..i + 8].try_into().unwrap()) ^ NL;
        let z = x.wrapping_sub(LO) & !x & HI;
        if z != 0 {
            return Some(i + (z.trailing_zeros() / 8) as usize);
        }
        i += 8;
    }
    index_of_char(&text[i..], b'\n').map(|p| i + p)
}

/// Line-level diff. Returned hunks are byte offsets into `a` and `b`, always
/// falling on line boundaries.
pub(crate) fn diff_lines(a: &[u8], b: &[u8]) -> Vec<Hunk> {
    // Byte-wise common prefix/suffix, snapped back to line boundaries, so the
    // (typically large) unchanged head and tail are never tokenized.
    let p = u8::common_prefix(a, b);
    if p == a.len() && p == b.len() {
        return Vec::new();
    }
    if a.len().max(b.len()) >= u32::MAX as usize {
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

    let est_a = count_char(&a[head..a_end], b'\n') + 1;
    let est_b = count_char(&b[head..b_end], b'\n') + 1;
    let mut interner = Interner::with_capacity(est_a + est_b);
    let mut ta: Vec<u32> = Vec::with_capacity(est_a);
    let mut tb: Vec<u32> = Vec::with_capacity(est_b);
    let mut offs_a: Vec<u32> = Vec::with_capacity(est_a + 1);
    let mut offs_b: Vec<u32> = Vec::with_capacity(est_b + 1);
    tokenize(&a[head..a_end], head, &mut interner, &mut ta, &mut offs_a);
    tokenize(&b[head..b_end], head, &mut interner, &mut tb, &mut offs_b);

    // A line that never occurs on the other side cannot be part of any common
    // subsequence, so it is marked changed up front and left out of the
    // sequences handed to Myers. This preserves minimality while shrinking
    // both N and D — often to nothing.
    let uniq = interner.lines.len();
    drop(interner);
    let mut occ_a = vec![0u32; uniq];
    let mut occ_b = vec![0u32; uniq];
    for &t in &ta {
        occ_a[t as usize] += 1;
    }
    for &t in &tb {
        occ_b[t as usize] += 1;
    }
    let mut changed_a = vec![false; ta.len()];
    let mut changed_b = vec![false; tb.len()];
    let mut ra: Vec<u32> = Vec::new();
    let mut rb: Vec<u32> = Vec::new();
    let mut map_a: Vec<u32> = Vec::new();
    let mut map_b: Vec<u32> = Vec::new();
    for (i, &t) in ta.iter().enumerate() {
        if occ_b[t as usize] == 0 {
            changed_a[i] = true;
        } else {
            ra.push(t);
            map_a.push(i as u32);
        }
    }
    for (j, &t) in tb.iter().enumerate() {
        if occ_a[t as usize] == 0 {
            changed_b[j] = true;
        } else {
            rb.push(t);
            map_b.push(j as u32);
        }
    }
    drop((occ_a, occ_b));

    if !ra.is_empty() && !rb.is_empty() {
        let n = ra.len() + rb.len();
        let mut sc = MyersScratch::default();
        let MyersScratch {
            vf,
            vb,
            changed_a: rchanged_a,
            changed_b: rchanged_b,
        } = &mut sc;
        rchanged_a.resize(ra.len(), false);
        rchanged_b.resize(rb.len(), false);
        let mut myers = Myers::new(
            &ra[..],
            &rb[..],
            vf,
            vb,
            LINE_BUDGET,
            LINE_WORK_PER_TOKEN * n + LINE_WORK_BASE,
            Some(Anchors::new(uniq)),
        );
        myers.run(0..ra.len(), 0..rb.len(), rchanged_a, rchanged_b);
        for (ri, &c) in rchanged_a.iter().enumerate() {
            if c {
                changed_a[map_a[ri] as usize] = true;
            }
        }
        for (rj, &c) in rchanged_b.iter().enumerate() {
            if c {
                changed_b[map_b[rj] as usize] = true;
            }
        }
    } else {
        changed_a.fill(true);
        changed_b.fill(true);
    }

    let mut hunks = Vec::new();
    hunks_from_changed(&ta[..], &tb[..], &changed_a, &changed_b, &mut hunks);
    cleanup_merge(&mut hunks, &ta, &tb);

    for h in &mut hunks {
        *h = Hunk {
            a_lo: offs_a[h.a_lo] as usize,
            a_hi: offs_a[h.a_hi] as usize,
            b_lo: offs_b[h.b_lo] as usize,
            b_hi: offs_b[h.b_hi] as usize,
        };
    }
    hunks
}

const LINE_BUDGET: (usize, usize) = (256, 1024);
const LINE_WORK_PER_TOKEN: usize = 64;
const LINE_WORK_BASE: usize = 4 << 20;
const CHAR_BUDGET: (usize, usize) = (128, 256);
const CHAR_WORK_PER_BYTE: usize = 4;
const CHAR_WORK_BASE: usize = 64 << 10;

// ───────────────────────────── character mode ─────────────────────────────

/// Character-level differ with reusable scratch space.
#[derive(Default)]
pub(crate) struct CharDiff {
    hunks: Vec<Hunk>,
    myers: MyersScratch,
    kmp: Vec<u32>,
}

impl CharDiff {
    /// Character-level diff with diff-match-patch's semantic cleanup applied,
    /// for highlighting within a modified line/block. Hunks are byte offsets
    /// and fall on UTF-8 sequence boundaries if the inputs are valid UTF-8.
    pub(crate) fn diff(&mut self, a: &[u8], b: &[u8]) -> &[Hunk] {
        self.hunks.clear();
        let lines = count_char(a, b'\n');
        let paired = lines > 0 && lines == count_char(b, b'\n');
        // A large block whose sides have the same number of lines is almost
        // always N independently-modified lines; diffing them pairwise is
        // linear-time and immune to matches bleeding across lines. Smaller
        // blocks are diffed whole (exactly), falling back to pairwise only if
        // that blows the work cap.
        if !(paired && a.len() + b.len() > PAIRWISE_ABOVE) {
            if self.whole(a, b, 0, 0) || !paired {
                self.finish(a, b);
                return &self.hunks;
            }
            self.hunks.clear();
        }
        let (mut sa, mut sb) = (0, 0);
        while sa < a.len() || sb < b.len() {
            let ea = index_of_char(&a[sa..], b'\n').map_or(a.len(), |i| sa + i + 1);
            let eb = index_of_char(&b[sb..], b'\n').map_or(b.len(), |i| sb + i + 1);
            self.whole(&a[sa..ea], &b[sb..eb], sa, sb);
            (sa, sb) = (ea, eb);
        }
        self.finish(a, b);
        &self.hunks
    }

    fn finish(&mut self, a: &[u8], b: &[u8]) {
        cleanup_merge(&mut self.hunks, a, b);
        // Semantic cleanup reasons about edit *lengths*, so it should see
        // whole characters; it can itself split a sequence again (common
        // prefix of `é`/`è` is a lead byte), hence the second pass.
        align_to_utf8(&mut self.hunks, a);
        cleanup_semantic(&mut self.hunks, a, b, &mut self.kmp);
        align_to_utf8(&mut self.hunks, a);
    }

    /// Appends hunks for `a` vs `b`, offset by `(oa, ob)`. Returns false if
    /// the work cap was hit (the hunks are then valid but coarse).
    fn whole(&mut self, a: &[u8], b: &[u8], oa: usize, ob: usize) -> bool {
        let hunks = &mut self.hunks;
        let first = hunks.len();
        let mut complete = true;
        let p = u8::common_prefix(a, b);
        if p == a.len() && p == b.len() {
            return true;
        }
        let s = u8::common_suffix(&a[p..], &b[p..]);
        let (ahi, bhi) = (a.len() - s, b.len() - s);
        let (ma, mb) = (&a[p..ahi], &b[p..bhi]);
        if ma.is_empty() || mb.is_empty() {
            hunks.push(Hunk {
                a_lo: p,
                a_hi: ahi,
                b_lo: p,
                b_hi: bhi,
            });
        } else if let Some((long_is_a, at)) = contains(ma, mb) {
            // The shorter side appears verbatim inside the longer one.
            if long_is_a {
                push_nonempty(
                    hunks,
                    Hunk {
                        a_lo: p,
                        a_hi: p + at,
                        b_lo: p,
                        b_hi: p,
                    },
                );
                push_nonempty(
                    hunks,
                    Hunk {
                        a_lo: p + at + mb.len(),
                        a_hi: ahi,
                        b_lo: bhi,
                        b_hi: bhi,
                    },
                );
            } else {
                push_nonempty(
                    hunks,
                    Hunk {
                        a_lo: p,
                        a_hi: p,
                        b_lo: p,
                        b_hi: p + at,
                    },
                );
                push_nonempty(
                    hunks,
                    Hunk {
                        a_lo: ahi,
                        a_hi: ahi,
                        b_lo: p + at + ma.len(),
                        b_hi: bhi,
                    },
                );
            }
        } else if ma.len() == 1 || mb.len() == 1 {
            hunks.push(Hunk {
                a_lo: p,
                a_hi: ahi,
                b_lo: p,
                b_hi: bhi,
            });
        } else {
            let n = ma.len() + mb.len();
            let MyersScratch {
                vf,
                vb,
                changed_a,
                changed_b,
            } = &mut self.myers;
            changed_a.clear();
            changed_a.resize(a.len(), false);
            changed_b.clear();
            changed_b.resize(b.len(), false);
            let mut myers = Myers::new(
                a,
                b,
                vf,
                vb,
                CHAR_BUDGET,
                CHAR_WORK_PER_BYTE * n + CHAR_WORK_BASE,
                None,
            );
            myers.run(p..ahi, p..bhi, changed_a, changed_b);
            complete = myers.work_left > 0;
            hunks_from_changed(a, b, changed_a, changed_b, hunks);
        }
        if oa != 0 || ob != 0 {
            for h in &mut hunks[first..] {
                *h = Hunk {
                    a_lo: h.a_lo + oa,
                    a_hi: h.a_hi + oa,
                    b_lo: h.b_lo + ob,
                    b_hi: h.b_hi + ob,
                };
            }
        }
        complete
    }
}

const PAIRWISE_ABOVE: usize = 16 << 10;

fn push_nonempty(hunks: &mut Vec<Hunk>, h: Hunk) {
    if h.a_lo < h.a_hi || h.b_lo < h.b_hi {
        hunks.push(h);
    }
}

/// If the shorter of `a`/`b` occurs inside the longer: (longer is a, offset).
fn contains(a: &[u8], b: &[u8]) -> Option<(bool, usize)> {
    let (long, short, long_is_a) = if a.len() >= b.len() {
        (a, b, true)
    } else {
        (b, a, false)
    };
    let at = if long.len() <= 64 {
        // Not worth setting up a SIMD searcher for.
        let (n, f) = (short.len(), short[0]);
        (0..=long.len() - n).find(|&i| long[i] == f && long[i..i + n] == *short)
    } else {
        index_of(long, short)
    };
    at.map(|i| (long_is_a, i))
}

// ───────────────────────── cleanup (diff-match-patch) ─────────────────────────

/// diff-match-patch `diff_cleanupMerge`: with hunks there is nothing to merge,
/// but two of its effects remain: common prefix/suffix inside a hunk is
/// factored out, and a pure insertion/deletion that can swallow the entire
/// equality before (after) it is shifted to do so, joining the neighbouring
/// hunk. e.g. `A<ins>BA</ins>C` → `<ins>AB</ins>AC`.
fn cleanup_merge<T: Elem>(hunks: &mut Vec<Hunk>, a: &[T], b: &[T]) {
    loop {
        let mut w = 0;
        for r in 0..hunks.len() {
            let mut h = hunks[r];
            if h.a_lo < h.a_hi && h.b_lo < h.b_hi {
                let p = T::common_prefix(&a[h.a_lo..h.a_hi], &b[h.b_lo..h.b_hi]);
                h.a_lo += p;
                h.b_lo += p;
                let s = T::common_suffix(&a[h.a_lo..h.a_hi], &b[h.b_lo..h.b_hi]);
                h.a_hi -= s;
                h.b_hi -= s;
                if h.a_lo == h.a_hi && h.b_lo == h.b_hi {
                    continue;
                }
            }
            if w > 0 && hunks[w - 1].a_hi == h.a_lo && hunks[w - 1].b_hi == h.b_lo {
                hunks[w - 1].a_hi = h.a_hi;
                hunks[w - 1].b_hi = h.b_hi;
            } else {
                hunks[w] = h;
                w += 1;
            }
        }
        hunks.truncate(w);

        let mut changed = false;
        for i in 0..hunks.len() {
            let h = hunks[i];
            let (prev_a, prev_b) = if i == 0 {
                (0, 0)
            } else {
                (hunks[i - 1].a_hi, hunks[i - 1].b_hi)
            };
            let (next_a, next_b) = if i + 1 == hunks.len() {
                (a.len(), b.len())
            } else {
                (hunks[i + 1].a_lo, hunks[i + 1].b_lo)
            };
            debug_assert_eq!(h.a_lo - prev_a, h.b_lo - prev_b);
            debug_assert_eq!(next_a - h.a_hi, next_b - h.b_hi);
            let before = h.a_lo - prev_a;
            let after = next_a - h.a_hi;
            // Only single edits with an equality on both sides.
            if before == 0 || after == 0 || (h.deleted() > 0 && h.inserted() > 0) {
                continue;
            }
            let (seq, lo, hi) = if h.deleted() > 0 {
                (a, h.a_lo, h.a_hi)
            } else {
                (b, h.b_lo, h.b_hi)
            };
            let edit = &seq[lo..hi];
            if edit.len() >= before && edit[edit.len() - before..] == seq[lo - before..lo] {
                hunks[i] = Hunk {
                    a_lo: h.a_lo - before,
                    a_hi: h.a_hi - before,
                    b_lo: h.b_lo - before,
                    b_hi: h.b_hi - before,
                };
                changed = true;
            } else if edit.len() >= after && edit[..after] == seq[hi..hi + after] {
                hunks[i] = Hunk {
                    a_lo: h.a_lo + after,
                    a_hi: h.a_hi + after,
                    b_lo: h.b_lo + after,
                    b_hi: h.b_hi + after,
                };
                changed = true;
            }
        }
        if !changed {
            return;
        }
    }
}

/// diff-match-patch `diff_cleanupSemantic`, `diff_cleanupSemanticLossless`
/// and the overlap-extraction pass, over byte ranges.
fn cleanup_semantic(hunks: &mut Vec<Hunk>, a: &[u8], b: &[u8], kmp: &mut Vec<u32>) {
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
    let mut out: Vec<Hunk> = Vec::with_capacity(hunks.len());
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
                    &mut out,
                    Hunk {
                        a_lo: h.a_lo,
                        a_hi: h.a_hi - fwd,
                        b_lo: h.b_lo,
                        b_hi: h.b_lo,
                    },
                );
                push_nonempty(
                    &mut out,
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
                &mut out,
                Hunk {
                    a_lo: h.a_lo,
                    a_hi: h.a_lo,
                    b_lo: h.b_lo,
                    b_hi: h.b_hi - rev,
                },
            );
            push_nonempty(
                &mut out,
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
    *hunks = out;
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
        let is_cont = |i: usize| i < seq.len() && (seq[i] & 0xC0) == 0x80;
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
    let n = x.len().min(y.len());
    if n == 0 {
        return 0;
    }
    let x = &x[x.len() - n..];
    let y = &y[..n];
    if x == y {
        return n;
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

/// Widens each hunk so that no edge falls inside a UTF-8 sequence. Edges only
/// ever move outward through the neighbouring equality (whose bytes are the
/// same on both sides), so the diff stays valid; a hunk just gains a shared
/// lead byte or two, and hunks whose separating equality is consumed merge.
fn align_to_utf8(hunks: &mut Vec<Hunk>, a: &[u8]) {
    #[inline]
    fn is_cont(s: &[u8], i: usize) -> bool {
        i < s.len() && (s[i] & 0xC0) == 0x80
    }
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

    /// Minimal-ish edit script between two sequences as a hunk list.
    fn diff_slices<T: Elem>(a: &[T], b: &[T], budget_floor: usize) -> Vec<Hunk> {
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
        let (changed_a, changed_b) = (&mut sc.changed_a, &mut sc.changed_b);
        changed_a.resize(a.len(), false);
        changed_b.resize(b.len(), false);
        let mut myers = Myers::new(
            a,
            b,
            &mut sc.vf,
            &mut sc.vb,
            (budget_floor, budget_floor),
            usize::MAX >> 1,
            None,
        );
        myers.run(p..ahi, p..bhi, changed_a, changed_b);
        hunks_from_changed(a, b, changed_a, changed_b, &mut hunks);
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
            let hunks = diff_slices(&a, &b, 1024);
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
            let hunks = diff_slices(&a, &b, 2);
            let kept = check_script(&a, &b, &hunks);
            let opt = lcs_len(&a, &b);
            assert!(kept <= opt);
            assert!(kept * 10 >= opt * 7, "kept {kept} of {opt}");
        }
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
}
