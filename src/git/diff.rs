//! Line diff (Myers O(ND), linear space).
//!
//! Algorithm: E. Myers, "An O(ND) Difference Algorithm and Its Variations"
//! (1986), §4b — the divide-and-conquer "middle snake" formulation also used
//! by git's xdiff (`xdiffi.c:xdl_recs_cmp`). The implementation is iterative
//! (explicit work stack), allocation is O(N+M), and a per-split cost ceiling
//! ([`MYERS_MAX_COST`], mirroring xdiff's `mxcost` heuristic) bounds the
//! worst case: past it the sub-range degrades to a whole-range replacement
//! instead of an optimal diff.

/// Whole-input ceilings. Above either, the result is a single whole-file
/// hunk (see [`diff_lines`]); above the byte ceiling the contents are not
/// even split into lines (each side becomes one pseudo-line).
const MAX_DIFF_TOTAL_LINES: usize = 200_000;
const MAX_DIFF_TOTAL_BYTES: usize = 256 * 1024 * 1024;
/// Per-split edit-cost ceiling, after which the split is abandoned and the
/// sub-range reported as a full replacement (xdiff uses 256; a higher value
/// gives more minimal diffs at higher cost).
const MYERS_MAX_COST: usize = 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffOrigin {
    /// Line present in both inputs. `content` indexes `old`.
    Context,
    /// Line only in `new`. `content` indexes `new`.
    Add,
    /// Line only in `old`. `content` indexes `old`.
    Del,
}

/// One line of a hunk. `content` is a byte range into `old` for
/// `Context`/`Del` and into `new` for `Add`; it includes the trailing
/// newline when the source line has one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    pub origin: DiffOrigin,
    pub content: core::ops::Range<usize>,
}

/// A unified-diff hunk. `old_start`/`new_start` are 1-based line numbers
/// (0 when the corresponding side contributes 0 lines, matching the
/// `@@ -a,b +c,d @@` convention).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

/// Line-level diff of `old` against `new` with `context` lines of context.
/// Identical inputs yield no hunks.
pub fn diff_lines(old: &[u8], new: &[u8], context: u32) -> Vec<Hunk> {
    diff_lines_impl(
        old,
        new,
        context,
        MAX_DIFF_TOTAL_LINES,
        MAX_DIFF_TOTAL_BYTES,
    )
}

pub(crate) fn diff_lines_impl(
    old: &[u8],
    new: &[u8],
    context: u32,
    max_total_lines: usize,
    max_total_bytes: usize,
) -> Vec<Hunk> {
    if old == new {
        return Vec::new();
    }
    if old.len().saturating_add(new.len()) > max_total_bytes {
        // Whole-file replacement without splitting into lines: each side is
        // a single pseudo-"line" spanning all of its bytes.
        let mut lines = Vec::new();
        if !old.is_empty() {
            lines.push(DiffLine {
                origin: DiffOrigin::Del,
                content: 0..old.len(),
            });
        }
        if !new.is_empty() {
            lines.push(DiffLine {
                origin: DiffOrigin::Add,
                content: 0..new.len(),
            });
        }
        return vec![Hunk {
            old_start: u32::from(!old.is_empty()),
            old_lines: u32::from(!old.is_empty()),
            new_start: u32::from(!new.is_empty()),
            new_lines: u32::from(!new.is_empty()),
            lines,
        }];
    }

    let a = split_lines(old);
    let b = split_lines(new);
    let mut removed = vec![false; a.len()];
    let mut added = vec![false; b.len()];

    if a.len() + b.len() > max_total_lines {
        removed.fill(true);
        added.fill(true);
    } else {
        myers_mark(old, new, &a, &b, &mut removed, &mut added);
    }
    build_hunks(&a, &b, &removed, &added, context)
}

/// A line's byte range plus a cheap content hash used to short-circuit
/// inequality before the byte compare.
#[derive(Clone, Copy)]
struct Line {
    start: usize,
    end: usize,
    hash: u64,
}

/// FNV-1a, 64-bit (public domain; Fowler/Noll/Vo). Only used to make line
/// inequality cheap — equality still byte-compares.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn split_lines(data: &[u8]) -> Vec<Line> {
    let mut out = Vec::new();
    let mut start = 0;
    while start < data.len() {
        let end = match memchr::memchr(b'\n', &data[start..]) {
            Some(nl) => start + nl + 1,
            None => data.len(),
        };
        out.push(Line {
            start,
            end,
            hash: fnv1a(&data[start..end]),
        });
        start = end;
    }
    out
}

struct Myers<'a> {
    old: &'a [u8],
    new: &'a [u8],
    a: &'a [Line],
    b: &'a [Line],
    /// Forward / backward furthest-reaching x (resp. u) per diagonal,
    /// indexed by `k + offset`.
    vf: Vec<isize>,
    vb: Vec<isize>,
    offset: isize,
}

impl Myers<'_> {
    #[inline]
    fn eq(&self, ai: usize, bj: usize) -> bool {
        let la = self.a[ai];
        let lb = self.b[bj];
        la.hash == lb.hash && self.old[la.start..la.end] == self.new[lb.start..lb.end]
    }
}

fn myers_mark(
    old: &[u8],
    new: &[u8],
    a: &[Line],
    b: &[Line],
    removed: &mut [bool],
    added: &mut [bool],
) {
    let size = a.len() + b.len() + 4;
    let offset = (a.len() + b.len() + 1) as isize;
    let mut m = Myers {
        old,
        new,
        a,
        b,
        vf: vec![0; 2 * size],
        vb: vec![0; 2 * size],
        offset,
    };
    let mut work: Vec<(usize, usize, usize, usize)> = vec![(0, a.len(), 0, b.len())];
    while let Some((mut a0, mut a1, mut b0, mut b1)) = work.pop() {
        while a0 < a1 && b0 < b1 && m.eq(a0, b0) {
            a0 += 1;
            b0 += 1;
        }
        while a1 > a0 && b1 > b0 && m.eq(a1 - 1, b1 - 1) {
            a1 -= 1;
            b1 -= 1;
        }
        if a0 == a1 {
            added[b0..b1].fill(true);
            continue;
        }
        if b0 == b1 {
            removed[a0..a1].fill(true);
            continue;
        }
        match middle_point(&mut m, a0, a1, b0, b1) {
            // With prefix and suffix stripped and both sides non-empty, the
            // edit distance is >= 2, so the returned point is strictly
            // inside the rectangle and both sub-problems are strictly
            // smaller. The guard makes termination unconditional anyway.
            Some((x, y)) if (x, y) != (a0, b0) && (x, y) != (a1, b1) => {
                work.push((a0, x, b0, y));
                work.push((x, a1, y, b1));
            }
            _ => {
                removed[a0..a1].fill(true);
                added[b0..b1].fill(true);
            }
        }
    }
}

/// Find one point on a minimal edit path through the rectangle
/// `[a0,a1) x [b0,b1)`. Requires `a0 < a1`, `b0 < b1`, `a[a0] != b[b0]` and
/// `a[a1-1] != b[b1-1]` (prefix/suffix already stripped), which guarantees
/// the answer is not a corner. Returns `None` past the cost ceiling.
fn middle_point(
    m: &mut Myers<'_>,
    a0: usize,
    a1: usize,
    b0: usize,
    b1: usize,
) -> Option<(usize, usize)> {
    let n = (a1 - a0) as isize;
    let mm = (b1 - b0) as isize;
    let delta = n - mm;
    let odd = delta.rem_euclid(2) == 1;
    // ceil((n+m)/2); both are positive and bounded by the line ceilings.
    let max_d = (n + mm + 1) / 2;
    let limit = max_d.min(MYERS_MAX_COST as isize);
    let off = m.offset;
    m.vf[(off + 1) as usize] = 0;
    m.vb[(off + 1) as usize] = 0;
    for d in 0..=limit {
        // Forward pass.
        let mut k = -d;
        while k <= d {
            let i = (off + k) as usize;
            let mut x = if k == -d || (k != d && m.vf[i - 1] < m.vf[i + 1]) {
                m.vf[i + 1]
            } else {
                m.vf[i - 1] + 1
            };
            let mut y = x - k;
            while x < n && y < mm && m.eq(a0 + x as usize, b0 + y as usize) {
                x += 1;
                y += 1;
            }
            m.vf[i] = x;
            // Overlap check against the backward (d-1)-paths.
            if odd && (k - delta).abs() < d {
                let bi = (off + (delta - k)) as usize;
                if m.vf[i] + m.vb[bi] >= n {
                    return Some((a0 + x as usize, b0 + y as usize));
                }
            }
            k += 2;
        }
        // Backward pass. `u`/`v` count backward from (a1, b1); the backward
        // diagonal `k = u - v` relates to a forward diagonal `delta - k`.
        let mut k = -d;
        while k <= d {
            let i = (off + k) as usize;
            let mut u = if k == -d || (k != d && m.vb[i - 1] < m.vb[i + 1]) {
                m.vb[i + 1]
            } else {
                m.vb[i - 1] + 1
            };
            let mut v = u - k;
            while u < n && v < mm && m.eq(a1 - 1 - u as usize, b1 - 1 - v as usize) {
                u += 1;
                v += 1;
            }
            m.vb[i] = u;
            // Overlap check against the forward d-paths just computed.
            if !odd && (delta - k).abs() <= d {
                let fi = (off + (delta - k)) as usize;
                if m.vb[i] + m.vf[fi] >= n {
                    return Some((a1 - u as usize, b1 - v as usize));
                }
            }
            k += 2;
        }
    }
    None
}

fn build_hunks(
    a: &[Line],
    b: &[Line],
    removed: &[bool],
    added: &[bool],
    context: u32,
) -> Vec<Hunk> {
    // Maximal change groups: `[i0,i1)` removed from old, `[j0,j1)` added to
    // new, anchored at the same point of the common subsequence.
    let mut groups: Vec<(usize, usize, usize, usize)> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    while i < a.len() || j < b.len() {
        if i < a.len() && j < b.len() && !removed[i] && !added[j] {
            i += 1;
            j += 1;
            continue;
        }
        let (i0, j0) = (i, j);
        while i < a.len() && removed[i] {
            i += 1;
        }
        while j < b.len() && added[j] {
            j += 1;
        }
        groups.push((i0, i, j0, j));
    }
    if groups.is_empty() {
        return Vec::new();
    }

    let context = context as usize;
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut g = 0;
    while g < groups.len() {
        // A hunk covers a run of groups whose surrounding context overlaps.
        let mut last = g;
        while last + 1 < groups.len() && groups[last + 1].0 - groups[last].1 <= 2 * context {
            last += 1;
        }
        let (first_i0, _, first_j0, _) = groups[g];
        let (_, last_i1, _, last_j1) = groups[last];
        let lead = first_i0.min(context);
        let trail = context.min(a.len() - last_i1);
        let hunk_i = first_i0 - lead;
        let hunk_j = first_j0 - lead;

        let mut lines: Vec<DiffLine> = Vec::new();
        let mut push = |origin: DiffOrigin, line: Line| {
            lines.push(DiffLine {
                origin,
                content: line.start..line.end,
            });
        };
        for line in &a[hunk_i..first_i0] {
            push(DiffOrigin::Context, *line);
        }
        for gg in g..=last {
            let (i0, i1, j0, j1) = groups[gg];
            for line in &a[i0..i1] {
                push(DiffOrigin::Del, *line);
            }
            for line in &b[j0..j1] {
                push(DiffOrigin::Add, *line);
            }
            // Inter-group context (identical on both sides).
            let next_i0 = if gg == last { i1 } else { groups[gg + 1].0 };
            for line in &a[i1..next_i0] {
                push(DiffOrigin::Context, *line);
            }
        }
        for line in &a[last_i1..last_i1 + trail] {
            push(DiffOrigin::Context, *line);
        }

        let old_count = (last_i1 + trail) - hunk_i;
        let new_count = (last_j1 + trail) - hunk_j;
        hunks.push(Hunk {
            old_start: hunk_start(hunk_i, old_count),
            old_lines: old_count as u32,
            new_start: hunk_start(hunk_j, new_count),
            new_lines: new_count as u32,
            lines,
        });
        g = last + 1;
    }
    hunks
}

/// Unified-diff start convention: 1-based first line, except a zero-length
/// side reports the line BEFORE the hunk (0 at the very top).
fn hunk_start(zero_based: usize, count: usize) -> u32 {
    if count == 0 {
        zero_based as u32
    } else {
        (zero_based + 1) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(old: &[u8], new: &[u8], context: u32) -> Vec<Hunk> {
        diff_lines(old, new, context)
    }

    /// Re-apply `hunks` to `old`; the result must equal `new`. This is the
    /// core correctness property of any diff.
    fn apply(old: &[u8], new: &[u8], hunks: &[Hunk]) -> Vec<u8> {
        let lines = split_lines(old);
        let mut out = Vec::new();
        let mut cursor = 0usize; // old line index
        for hunk in hunks {
            let hunk_first = if hunk.old_lines == 0 {
                hunk.old_start as usize
            } else {
                hunk.old_start as usize - 1
            };
            assert!(hunk_first >= cursor, "hunks overlap or are unordered");
            for line in &lines[cursor..hunk_first] {
                out.extend_from_slice(&old[line.start..line.end]);
            }
            cursor = hunk_first;
            for dl in &hunk.lines {
                match dl.origin {
                    DiffOrigin::Context => {
                        let l = lines[cursor];
                        assert_eq!(
                            &old[l.start..l.end],
                            &old[dl.content.clone()],
                            "context line mismatch"
                        );
                        out.extend_from_slice(&old[l.start..l.end]);
                        cursor += 1;
                    }
                    DiffOrigin::Del => {
                        let l = lines[cursor];
                        assert_eq!(&old[l.start..l.end], &old[dl.content.clone()]);
                        cursor += 1;
                    }
                    DiffOrigin::Add => out.extend_from_slice(&new[dl.content.clone()]),
                }
            }
        }
        for line in &lines[cursor..] {
            out.extend_from_slice(&old[line.start..line.end]);
        }
        out
    }

    fn check(old: &[u8], new: &[u8], context: u32) -> Vec<Hunk> {
        let hunks = d(old, new, context);
        assert_eq!(
            apply(old, new, &hunks),
            new,
            "round-trip failed for {:?} -> {:?}",
            bstr::BStr::new(old),
            bstr::BStr::new(new)
        );
        hunks
    }

    #[test]
    fn split_lines_shapes() {
        assert!(split_lines(b"").is_empty());
        let one = split_lines(b"a");
        assert_eq!(one.len(), 1);
        assert_eq!((one[0].start, one[0].end), (0, 1));
        let nl = split_lines(b"\n");
        assert_eq!(nl.len(), 1);
        assert_eq!((nl[0].start, nl[0].end), (0, 1));
        let two = split_lines(b"a\nbc");
        assert_eq!(two.len(), 2);
        assert_eq!((two[1].start, two[1].end), (2, 4));
    }

    #[test]
    fn identical_inputs_no_hunks() {
        assert!(d(b"", b"", 3).is_empty());
        assert!(d(b"a\nb\n", b"a\nb\n", 3).is_empty());
        assert!(d(b"no newline", b"no newline", 0).is_empty());
    }

    #[test]
    fn pure_insertion_into_empty() {
        let hunks = check(b"", b"a\nb\n", 3);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!(
            (h.old_start, h.old_lines, h.new_start, h.new_lines),
            (0, 0, 1, 2)
        );
        assert_eq!(
            h.lines.iter().map(|l| l.origin).collect::<Vec<_>>(),
            vec![DiffOrigin::Add, DiffOrigin::Add]
        );
    }

    #[test]
    fn pure_deletion_to_empty() {
        let hunks = check(b"a\nb\n", b"", 3);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!(
            (h.old_start, h.old_lines, h.new_start, h.new_lines),
            (1, 2, 0, 0)
        );
    }

    #[test]
    fn single_line_change_with_context() {
        let old = b"a\nb\nc\nd\ne\n";
        let new = b"a\nb\nX\nd\ne\n";
        let hunks = check(old, new, 1);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!(
            (h.old_start, h.old_lines, h.new_start, h.new_lines),
            (2, 3, 2, 3)
        );
        let kinds: Vec<DiffOrigin> = h.lines.iter().map(|l| l.origin).collect();
        assert_eq!(
            kinds,
            vec![
                DiffOrigin::Context,
                DiffOrigin::Del,
                DiffOrigin::Add,
                DiffOrigin::Context
            ]
        );
        assert_eq!(&old[h.lines[1].content.clone()], b"c\n");
        assert_eq!(&new[h.lines[2].content.clone()], b"X\n");
    }

    #[test]
    fn zero_context_two_hunks() {
        let old = b"1\n2\n3\n4\n5\n6\n7\n8\n";
        let new = b"1\nTWO\n3\n4\n5\n6\nSEVEN\n8\n";
        let hunks = check(old, new, 0);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].old_start, 2);
        assert_eq!(hunks[1].old_start, 7);
        for h in &hunks {
            assert_eq!((h.old_lines, h.new_lines), (1, 1));
        }
    }

    #[test]
    fn nearby_changes_merge_into_one_hunk() {
        let old = b"1\n2\n3\n4\n5\n6\n7\n8\n";
        let new = b"1\nTWO\n3\n4\n5\n6\nSEVEN\n8\n";
        // 4 unchanged lines between the two changes; 2*context >= 4 merges.
        assert_eq!(check(old, new, 2).len(), 1);
        assert_eq!(check(old, new, 1).len(), 2);
    }

    #[test]
    fn no_trailing_newline_lines() {
        let hunks = check(b"a\nb", b"a\nB", 3);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].lines.len(), 3);
        // Trailing-context clamp at end of file.
        check(b"a\nb\n", b"a\nb\nc", 5);
        check(b"x", b"", 3);
        check(b"", b"x", 3);
    }

    /// "abc" -> "abd"-style minimal scripts: exactly one del + one add.
    #[test]
    fn minimal_script_for_single_substitution() {
        let hunks = check(b"a\nb\nc\n", b"a\nb\nd\n", 0);
        assert_eq!(hunks.len(), 1);
        let kinds: Vec<DiffOrigin> = hunks[0].lines.iter().map(|l| l.origin).collect();
        assert_eq!(kinds, vec![DiffOrigin::Del, DiffOrigin::Add]);
    }

    /// The classic Myers paper example: a=ABCABBA, b=CBABAC has edit
    /// distance 5; a minimal diff therefore has exactly 5 +/- lines.
    #[test]
    fn myers_paper_example_is_minimal() {
        let old = b"A\nB\nC\nA\nB\nB\nA\n";
        let new = b"C\nB\nA\nB\nA\nC\n";
        let hunks = check(old, new, 0);
        let edits: usize = hunks
            .iter()
            .flat_map(|h| h.lines.iter())
            .filter(|l| l.origin != DiffOrigin::Context)
            .count();
        assert_eq!(edits, 5);
    }

    #[test]
    fn common_prefix_and_suffix_are_context_only() {
        let old = b"p1\np2\nmid\ns1\ns2\n";
        let new = b"p1\np2\nMID\ns1\ns2\n";
        let hunks = check(old, new, 2);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_lines, 5);
    }

    /// Deterministic pseudo-random sequences over a tiny alphabet: the
    /// applied diff must always reproduce `new`. Exercises every branch of
    /// the middle-snake search (odd/even delta, empty sides, long snakes).
    #[test]
    fn randomized_round_trip_property() {
        let mut seed: u64 = 0x243f_6a88_85a3_08d3;
        let mut rng = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for case in 0..400 {
            let n = (rng() % 24) as usize;
            let m = (rng() % 24) as usize;
            let alphabet = 1 + (rng() % 4) as u8;
            let mut old = Vec::new();
            for _ in 0..n {
                old.push(b'a' + (rng() % u64::from(alphabet)) as u8);
                old.push(b'\n');
            }
            let mut new = Vec::new();
            for _ in 0..m {
                new.push(b'a' + (rng() % u64::from(alphabet)) as u8);
                new.push(b'\n');
            }
            let context = (rng() % 4) as u32;
            let hunks = diff_lines(&old, &new, context);
            assert_eq!(
                apply(&old, &new, &hunks),
                new,
                "case {case}: {:?} -> {:?} ctx {context}",
                bstr::BStr::new(&old),
                bstr::BStr::new(&new)
            );
        }
    }

    /// Above the line ceiling everything is reported changed, but the
    /// apply-property still holds.
    #[test]
    fn line_limit_falls_back_to_whole_file() {
        let old = b"a\nb\nc\nd\n";
        let new = b"a\nX\nc\nd\n";
        let hunks = diff_lines_impl(old, new, 0, 2, MAX_DIFF_TOTAL_BYTES);
        assert_eq!(apply(old, new, &hunks), new);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!((h.old_lines, h.new_lines), (4, 4));
        assert!(h.lines.iter().all(|l| l.origin != DiffOrigin::Context));
    }

    /// Above the byte ceiling the inputs are not split into lines at all.
    #[test]
    fn byte_limit_yields_single_pseudo_lines() {
        let old = b"old contents\nwith lines\n";
        let new = b"new\n";
        let hunks = diff_lines_impl(old, new, 3, MAX_DIFF_TOTAL_LINES, 8);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!(
            (h.old_start, h.old_lines, h.new_start, h.new_lines),
            (1, 1, 1, 1)
        );
        assert_eq!(h.lines.len(), 2);
        assert_eq!(h.lines[0].origin, DiffOrigin::Del);
        assert_eq!(h.lines[0].content, 0..old.len());
        assert_eq!(h.lines[1].origin, DiffOrigin::Add);
        assert_eq!(h.lines[1].content, 0..new.len());
        // One empty side.
        let hunks = diff_lines_impl(b"", b"123456789", 3, MAX_DIFF_TOTAL_LINES, 4);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_lines, 0);
        assert_eq!(hunks[0].lines.len(), 1);
    }

    /// A pathological input (every line distinct on both sides) is bounded
    /// by the cost ceiling and still round-trips.
    #[test]
    fn pathological_all_different_is_bounded_and_correct() {
        let mut old = Vec::new();
        let mut new = Vec::new();
        for i in 0..3000u32 {
            old.extend_from_slice(format!("o{i}\n").as_bytes());
            new.extend_from_slice(format!("n{i}\n").as_bytes());
        }
        let hunks = diff_lines(&old, &new, 3);
        assert_eq!(apply(&old, &new, &hunks), new);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_lines, 3000);
        assert_eq!(hunks[0].new_lines, 3000);
    }

    /// An interleaved worst case for the divide-and-conquer recursion.
    #[test]
    fn alternating_lines_round_trip() {
        let mut old = Vec::new();
        let mut new = Vec::new();
        for i in 0..200u32 {
            old.extend_from_slice(format!("common{i}\n").as_bytes());
            old.extend_from_slice(format!("only-old{i}\n").as_bytes());
            new.extend_from_slice(format!("only-new{i}\n").as_bytes());
            new.extend_from_slice(format!("common{i}\n").as_bytes());
        }
        let hunks = diff_lines(&old, &new, 1);
        assert_eq!(apply(&old, &new, &hunks), new);
    }
}
