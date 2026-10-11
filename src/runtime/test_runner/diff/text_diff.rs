//! Line- and character-level diffing for test-runner output.
//!
//! The core is Myers' O(ND) algorithm in its linear-space, bidirectional
//! ("middle snake") form, made unconditional-time-limit-free by bounding
//! *work* instead: every box first gets a cheap exact attempt; a box that
//! exceeds it is searched exhaustively up to a depth its size justifies, then
//! cut at a skeleton of unique, in-order common lines if it has a strong one,
//! and only past that cut greedily at the point of furthest progress. Lines that cannot match anything are eliminated before the
//! search, so in practice almost every input is solved exactly and the rest
//! degrade predictably instead of falling off a cliff.
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
    /// Whether the unique-token anchor split applies (line ids only), and
    /// the element as a dense index for it.
    const ANCHORED: bool = false;
    fn id(self) -> usize {
        unreachable!()
    }
    fn is_newline(self) -> bool {
        false
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
    const ANCHORED: bool = true;
    #[inline]
    fn id(self) -> usize {
        self as usize
    }
}

impl Elem for u8 {
    #[inline]
    fn is_newline(self) -> bool {
        self == b'\n'
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

enum Split {
    /// A point on an optimal path.
    Exact(usize, usize),
    /// Out of budget: best forward point and best reverse point (either may
    /// coincide with a corner, in which case it is useless).
    Greedy((usize, usize), (usize, usize)),
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
    /// Total steps for the whole diff; once spent, unsolved boxes are emitted
    /// as wholesale replacements.
    pub work: usize,
}

struct Myers<'a, 's, T: Elem> {
    a: &'a [T],
    b: &'a [T],
    vf: &'s mut Vec<i32>,
    vb: &'s mut Vec<i32>,
    stack: &'s mut Vec<Job>,
    policy: Policy,
    /// Steps left out of `policy.work`.
    work_left: isize,
    /// Scratch for the unique-token anchor split; sized by the largest id
    /// and only allocated if some box ever needs it.
    anchors: Option<Anchors>,
}

#[derive(Default)]
struct MyersScratch {
    vf: Vec<i32>,
    vb: Vec<i32>,
    stack: Vec<Job>,
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
}

/// A sub-box `a[alo..ahi] × b[blo..bhi]` still to be solved.
struct Job {
    alo: usize,
    ahi: usize,
    blo: usize,
    bhi: usize,
    probe: usize,
    /// Whether an exhaustive attempt is still allowed in this box; false
    /// below a greedy cut, where the result is approximate anyway.
    exhaustive: bool,
}

impl Job {
    fn new(
        (alo, blo): (usize, usize),
        (ahi, bhi): (usize, usize),
        probe: usize,
        exhaustive: bool,
    ) -> Self {
        Self {
            alo,
            ahi,
            blo,
            bhi,
            probe,
            exhaustive,
        }
    }
}

impl<'a, 's, T: Elem> Myers<'a, 's, T> {
    fn new(a: &'a [T], b: &'a [T], sc: &'s mut MyersScratch, policy: Policy) -> Self {
        debug_assert!(a.len().max(b.len()) < MAX_LEN);
        let MyersScratch { vf, vb, stack } = sc;
        Self {
            a,
            b,
            vf,
            vb,
            stack,
            policy,
            work_left: policy.work as isize,
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
    /// progress.
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
        ));
        while let Some(Job {
            mut alo,
            mut ahi,
            mut blo,
            mut bhi,
            probe,
            exhaustive,
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

            let bx = (alo, ahi, blo, bhi);
            let (mut f, mut r) = match self.try_exact(bx, probe, probe, exhaustive, &mut stack) {
                None => continue,
                Some(fr) => fr,
            };
            // Below a greedy cut neither fallback is retried: the region is
            // already approximate, and re-scanning every sub-box would be
            // quadratic.
            if exhaustive {
                let n = (ahi - alo) + (bhi - blo);
                let depth = self
                    .policy
                    .exhaustive_depth(n)
                    .min((self.work_left.max(0) as usize / 2).isqrt());
                if depth > probe {
                    match self.try_exact(bx, depth, probe, true, &mut stack) {
                        None => continue,
                        Some(fr) => (f, r) = fr,
                    }
                }
                if T::ANCHORED && self.split_at_anchors(alo, ahi, blo, bhi, &mut stack) {
                    continue;
                }
            }

            let inside = |p: (usize, usize)| p != (alo, blo) && p != (ahi, bhi);
            // Cut at whichever of the two points lie strictly inside the box
            // (both, if the forward one precedes the reverse one).
            let mut cuts = [(alo, blo); 4];
            let mut n = 1;
            if inside(f) {
                cuts[n] = f;
                n += 1;
            }
            if inside(r) && (n == 1 || (f.0 <= r.0 && f.1 <= r.1 && f != r)) {
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
                stack.push(Job::new(cuts[c], cuts[c + 1], probe, false));
            }
        }
        *self.stack = stack;
    }

    /// Runs `middle` at `depth`; on success queues the two halves (searched at
    /// `probe`) and returns `None`, otherwise returns the greedy cut points.
    fn try_exact(
        &mut self,
        (alo, ahi, blo, bhi): (usize, usize, usize, usize),
        depth: usize,
        probe: usize,
        exhaustive: bool,
        stack: &mut Vec<Job>,
    ) -> Option<((usize, usize), (usize, usize))> {
        match self.middle(alo, ahi, blo, bhi, depth) {
            Split::Exact(x, y) if (x, y) != (alo, blo) && (x, y) != (ahi, bhi) => {
                stack.push(Job::new((alo, blo), (x, y), probe, exhaustive));
                stack.push(Job::new((x, y), (ahi, bhi), probe, exhaustive));
                None
            }
            Split::Exact(..) => {
                debug_assert!(false, "middle snake ended on a corner");
                Some(((alo, blo), (alo, blo)))
            }
            Split::Greedy(f, r) => Some((f, r)),
        }
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
        let probe = self.policy.probe;
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
        let needed = ((ahi - alo).min(bhi - blo) / ANCHOR_COVERAGE).max(1);
        if an.pairs.len() < needed {
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
        if an.tails.len() < needed {
            return false;
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
                stack.push(Job::new((alo, blo), (ahi, bhi), probe, true));
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
    /// `a[alo..ahi] × b[blo..bhi]`, giving up after `depth` steps from each
    /// end. The box must have no common prefix or suffix and both sides must
    /// be non-empty.
    fn middle(&mut self, alo: usize, ahi: usize, blo: usize, bhi: usize, depth: usize) -> Split {
        let a = &self.a[alo..ahi];
        let b = &self.b[blo..bhi];
        let n = a.len() as i32;
        let m = b.len() as i32;
        let delta = n - m;
        let dmax = (n + m + 1) / 2;
        let bmax = dmax.min(depth as i32);
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
                    let mut $x = if lo + 1 > hi { lo + 1 } else { hi };
                    if $x > lim {
                        // The further move runs off the grid; take the other,
                        // or failing that leave this diagonal where it was.
                        $x = if lo + 1 < hi { lo + 1 } else { hi };
                        if $x < 0 || $x > lim {
                            $x = $v[i];
                        }
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
                    self.work_left -= ($d as isize + 1) * ($d as isize + 1);
                    return Split::Exact(alo + x as usize, blo + (x - k) as usize);
                });
                walk!(vb, vf, $d, ra, rb, common_suffix, $rcheck, $d, |_x2, k2| {
                    let k = delta - k2;
                    let x = vf[(k + off) as usize];
                    self.work_left -= ($d as isize + 1) * ($d as isize + 2);
                    return Split::Exact(alo + x as usize, blo + (x - k) as usize);
                });
            };
        }

        let mut d: i32 = 0;
        if front {
            while d <= bmax {
                round!(d, true, false);
                d += 1;
            }
        } else {
            while d <= bmax {
                round!(d, false, true);
                d += 1;
            }
        }

        self.work_left -= (bmax as isize + 1) * (bmax as isize + 2);
        // With an unrestricted search the fronts always meet.
        debug_assert!(bmax < dmax);

        // Each diagonal still holds its furthest point; pick the one with the
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
        let (fx, fy) = best(vf);
        let (bx, by) = best(vb);
        Split::Greedy(
            (alo + fx as usize, blo + fy as usize),
            (alo + (n - bx) as usize, blo + (m - by) as usize),
        )
    }
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
        let h = hash_bytes(line);
        let tag = (h >> 32) as u32;
        let mut i = h as usize & self.mask;
        loop {
            let slot = &mut self.slots[i];
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

/// Splits `text` into lines (each keeping its `\n`; the last line may lack
/// one), interning each. Returns token ids and `lines + 1` byte offsets.
fn tokenize<'a>(
    text: &'a [u8],
    base: usize,
    interner: &mut Interner<'a>,
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
pub(crate) fn diff_lines(a: &[u8], b: &[u8]) -> Vec<Hunk> {
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
        slide_line_hunks(&mut hunks, a, b);
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
        slide_line_hunks(&mut hunks, a, b);
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
    let (na, nb) = (ta.len(), tb.len());

    // A line that never occurs on the other side cannot be part of any common
    // subsequence, so it is marked changed up front and left out of the
    // sequences handed to Myers. This preserves minimality while shrinking
    // both N and D — often to nothing.
    let uniq = interner.lines.len();
    drop(interner);
    let mut occ = vec![[0u32; 2]; uniq];
    for &t in &ta {
        occ[t as usize][0] += 1;
    }
    for &t in &tb {
        occ[t as usize][1] += 1;
    }
    let mut changed = vec![false; na + nb];
    let (changed_a, changed_b) = changed.split_at_mut(na);
    // Surviving tokens and their original indices.
    let mut ra: Vec<u32> = Vec::with_capacity(na);
    let mut map_a: Vec<u32> = Vec::with_capacity(na);
    for (i, &t) in ta.iter().enumerate() {
        if occ[t as usize][1] == 0 {
            changed_a[i] = true;
        } else {
            ra.push(t);
            map_a.push(i as u32);
        }
    }
    let mut rb: Vec<u32> = Vec::with_capacity(nb);
    let mut map_b: Vec<u32> = Vec::with_capacity(nb);
    for (j, &t) in tb.iter().enumerate() {
        if occ[t as usize][0] == 0 {
            changed_b[j] = true;
        } else {
            rb.push(t);
            map_b.push(j as u32);
        }
    }
    drop(occ);

    if !ra.is_empty() && !rb.is_empty() {
        let n = ra.len() + rb.len();
        let mut sc = MyersScratch::default();
        let mut rchanged = vec![false; n];
        let (rchanged_a, rchanged_b) = rchanged.split_at_mut(ra.len());
        let policy = Policy {
            work: LINES.work + n * LINE_WORK_PER_TOKEN,
            ..LINES
        };
        let mut myers = Myers::new(&ra[..], &rb[..], &mut sc, policy);
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

    let mut hunks = Vec::with_capacity(16);
    hunks_from_changed(&ta[..], &tb[..], changed_a, changed_b, &mut hunks);
    for h in &mut hunks {
        *h = Hunk {
            a_lo: offs_a[h.a_lo] as usize,
            a_hi: offs_a[h.a_hi] as usize,
            b_lo: offs_b[h.b_lo] as usize,
            b_hi: offs_b[h.b_hi] as usize,
        };
    }
    slide_line_hunks(&mut hunks, a, b);
    hunks
}

/// `cleanup_merge`'s slide pass applied to byte hunks that sit on line
/// boundaries (they only ever move by whole lines), repeated until stable.
fn slide_line_hunks(hunks: &mut Vec<Hunk>, a: &[u8], b: &[u8]) {
    while slide_single_edits(hunks, a, b, true) {
        let mut w = 1;
        for r in 1..hunks.len() {
            let h = hunks[r];
            if hunks[w - 1].a_hi == h.a_lo && hunks[w - 1].b_hi == h.b_lo {
                hunks[w - 1].a_hi = h.a_hi;
                hunks[w - 1].b_hi = h.b_hi;
            } else {
                hunks[w] = h;
                w += 1;
            }
        }
        hunks.truncate(w);
    }
}

/// diff-match-patch `diff_cleanupMerge`, second half: a pure insertion or
/// deletion that ends with the entire equality before it (or starts with the
/// entire equality after it) is slid over that equality so it touches the
/// neighbouring hunk or the edge, e.g. `A<ins>BA</ins>C` → `<ins>AB</ins>AC`.
/// With `whole_lines`, only slides that keep the hunk on line boundaries are
/// taken. Returns whether anything moved; joining is left to the caller.
fn slide_single_edits<T: Elem>(hunks: &mut [Hunk], a: &[T], b: &[T], whole_lines: bool) -> bool {
    let mut changed = false;
    for i in 0..hunks.len() {
        let h = hunks[i];
        if h.deleted() > 0 && h.inserted() > 0 {
            continue;
        }
        let prev_a = if i == 0 { 0 } else { hunks[i - 1].a_hi };
        let next_a = if i + 1 == hunks.len() {
            a.len()
        } else {
            hunks[i + 1].a_lo
        };
        let (before, after) = (h.a_lo - prev_a, next_a - h.a_hi);
        if before == 0 || after == 0 {
            continue;
        }
        let (seq, lo, hi) = if h.deleted() > 0 {
            (a, h.a_lo, h.a_hi)
        } else {
            (b, h.b_lo, h.b_hi)
        };
        let edit = &seq[lo..hi];
        let boundary = |at: usize| !whole_lines || at == lo || at == hi || seq[at - 1].is_newline();
        let by = if edit.len() >= before
            && edit.ends_with(&seq[lo - before..lo])
            && boundary(hi - before)
        {
            -(before as isize)
        } else if edit.len() >= after
            && edit.starts_with(&seq[hi..hi + after])
            && boundary(lo + after)
        {
            after as isize
        } else {
            continue;
        };
        let mv = |v: usize| (v as isize + by) as usize;
        hunks[i] = Hunk {
            a_lo: mv(h.a_lo),
            a_hi: mv(h.a_hi),
            b_lo: mv(h.b_lo),
            b_hi: mv(h.b_hi),
        };
        changed = true;
    }
    changed
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
};
const LINE_WORK_PER_TOKEN: usize = 32;
const CHARS: Policy = Policy {
    probe: 256,
    exhaustive_max: 2048,
    exhaustive_per_elem: 1024,
    exhaustive_quota: 40_000_000,
    work: 4_000_000,
};
const CHAR_WORK_PER_BYTE: usize = 2;

// ───────────────────────────── character mode ─────────────────────────────

/// Character-level differ with reusable scratch space.
#[derive(Default)]
pub(crate) struct CharDiff {
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
    pub(crate) fn diff(&mut self, a: &[u8], b: &[u8]) -> &[Hunk] {
        self.hunks.clear();
        self.whole(a, b);
        self.finish(a, b);
        &self.hunks
    }

    fn finish(&mut self, a: &[u8], b: &[u8]) {
        cleanup_merge(&mut self.hunks, a, b);
        // Semantic cleanup reasons about edit *lengths*, so it should see
        // whole characters; it can itself split a sequence again (common
        // prefix of `é`/`è` is a lead byte), hence the second pass.
        align_to_utf8(&mut self.hunks, a);
        cleanup_semantic(&mut self.hunks, &mut self.scratch, a, b, &mut self.kmp);
        align_to_utf8(&mut self.hunks, a);
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
        index_of(a, b).map(|i| (true, i))
    } else {
        index_of(b, a).map(|i| (false, i))
    }
}

// ───────────────────────── cleanup (diff-match-patch) ─────────────────────────

/// diff-match-patch `diff_cleanupMerge`: with hunks there is nothing to merge,
/// but two of its effects remain: common prefix/suffix inside a hunk is
/// factored out (joining hunks that come to touch), and single edits are slid
/// over a neighbouring equality they repeat (`slide_single_edits`).
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

        if !slide_single_edits(hunks, a, b, false) {
            return;
        }
    }
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
pub(crate) fn is_utf8_cont(s: &[u8], i: usize) -> bool {
    i < s.len() && (s[i] & 0xC0) == 0x80
}

/// Widens each hunk so that no edge falls inside a UTF-8 sequence. Edges only
/// ever move outward through the neighbouring equality (whose bytes are the
/// same on both sides), so the diff stays valid; a hunk just gains a shared
/// lead byte or two, and hunks whose separating equality is consumed merge.
fn align_to_utf8(hunks: &mut Vec<Hunk>, a: &[u8]) {
    let is_cont = is_utf8_cont;
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
    fn diff_slices<T: Elem>(a: &[T], b: &[T], probe: usize) -> Vec<Hunk> {
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
                work: usize::MAX >> 2,
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
