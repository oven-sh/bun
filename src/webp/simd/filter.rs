//! The loop filter, RFC 6386 section 15. `v` has the samples across an edge, p3 p2 p1 p0 | q0 q1 q2 q3, with a lane for
//! each position along it.

use bun_simd::mem::RowsMut;
use bun_simd::prelude::*;

targets!(Upto<B32>);

/// How the loop filter treats a macroblock.
#[derive(Clone, Copy, Default)]
pub(crate) struct FilterStrength {
    /// For the edges inside of it, 4 less than for those around it. 0: it is left as it is.
    pub(crate) edge_limit: u8,
    pub(crate) interior_limit: u8,
    pub(crate) high_variance_threshold: u8,
    pub(crate) filters_inner_edges: bool,
}

/// One channel of a row of macroblocks, below some rows of the macroblocks above. Four samples are in front of each row.
pub(crate) struct Plane<'a> {
    pub(crate) samples: &'a mut [u8],
    pub(crate) stride: usize,
    /// Where in `samples` the first macroblock starts.
    pub(crate) start: usize,
}

/// How far the filters reach beyond the left edge of a macroblock.
const LEFT: usize = 4;

#[simd]
impl Plane<'_> {
    /// Macroblock `i` with the rows `above` it and the columns on its left. Its bounds check proves those of the rows.
    #[inline(always)]
    fn around(&mut self, size: usize, above: usize, i: usize) -> RowsMut<'_, u8> {
        let start = self.start - above * self.stride - LEFT + size * i;
        RowsMut::new(
            &mut self.samples[start..],
            self.stride,
            LEFT + size,
            above + size,
        )
    }
}

#[simd]
type V<W> = Simd<u8, W, S>;
#[simd]
type VI<W> = Simd<i8, W, S>;

#[simd]
fn signed<W: Width>(v: V<W, S>) -> VI<W, S> {
    (v ^ 0x80).cast_signed()
}

#[simd]
fn unsigned<W: Width>(v: VI<W, S>) -> V<W, S> {
    (v ^ i8::MIN).cast_unsigned()
}

#[simd]
fn is_within_edge_limit<W: Width>(v: &[V<W, S>], limit: u8) -> MaskOf<u8, W, S> {
    let inner = v[3].abs_diff(v[4]);
    inner
        .saturating_add(inner)
        .saturating_add(v[2].abs_diff(v[5]) >> 1)
        .simd_le(limit)
}

/// `outer + 3 * (q0 - p0)`. In this order the saturation on the way makes no difference.
#[simd]
fn base_delta<W: Width>(outer: VI<W, S>, p0: VI<W, S>, q0: VI<W, S>) -> VI<W, S> {
    let step = q0.saturating_sub(p0);
    step.saturating_add(step.saturating_add(step.saturating_add(outer)))
}

/// Returns what was taken from q0.
#[simd]
fn adjust_innermost<W: Width>(delta: VI<W, S>, p0: &mut VI<W, S>, q0: &mut VI<W, S>) -> VI<W, S> {
    let from_q = delta.saturating_add(4) >> 3;
    let to_p = delta.saturating_add(3) >> 3;
    (*p0, *q0) = (p0.saturating_add(to_p), q0.saturating_sub(from_q));
    from_q
}

#[simd]
fn simple_edge<W: Width>(v: &mut [V<W, S>], edge_limit: u8) {
    let is_filtered = is_within_edge_limit(v, edge_limit);
    let (mut p0, mut q0) = (signed(v[3]), signed(v[4]));
    let outer = signed(v[2]).saturating_sub(signed(v[5]));
    adjust_innermost(
        is_filtered.select(base_delta(outer, p0, q0), 0),
        &mut p0,
        &mut q0,
    );
    (v[3], v[4]) = (unsigned(p0), unsigned(q0));
}

/// Whether it is filtered, and whether it is smooth.
#[simd]
fn classify<W: Width>(
    v: &[V<W, S>],
    edge_limit: u8,
    strength: FilterStrength,
) -> [MaskOf<u8, W, S>; 2] {
    let variance = v[2].abs_diff(v[3]).simd_max(v[4].abs_diff(v[5]));
    let p_steps = v[0].abs_diff(v[1]).simd_max(v[1].abs_diff(v[2]));
    let q_steps = v[5].abs_diff(v[6]).simd_max(v[6].abs_diff(v[7]));
    let is_within_interior_limit = variance
        .simd_max(p_steps.simd_max(q_steps))
        .simd_le(strength.interior_limit);
    [
        is_within_interior_limit & is_within_edge_limit(v, edge_limit),
        variance.simd_le(strength.high_variance_threshold),
    ]
}

/// Only in the first `lanes`.
#[simd]
fn inner_edge<W: Width>(v: &mut [V<W, S>], strength: FilterStrength, lanes: usize) {
    let [is_filtered, is_smooth] = classify(v, strength.edge_limit, strength);
    let is_filtered = is_filtered & MaskOf::<u8, W, S>::first_n(lanes);
    let (p1, mut p0, mut q0, q1) = (signed(v[2]), signed(v[3]), signed(v[4]), signed(v[5]));
    let outer = is_smooth.select(0, p1.saturating_sub(q1));
    let from_q = adjust_innermost(
        is_filtered.select(base_delta(outer, p0, q0), 0),
        &mut p0,
        &mut q0,
    );
    let delta = is_smooth.select(from_q.rounding_shr(1), 0);
    (v[2], v[3]) = (unsigned(p1.saturating_add(delta)), unsigned(p0));
    (v[4], v[5]) = (unsigned(q0), unsigned(q1.saturating_sub(delta)));
}

#[simd]
fn macroblock_edge<W: Width>(v: &mut [V<W, S>], strength: FilterStrength) {
    let [is_filtered, is_smooth] = classify(v, strength.edge_limit.wrapping_add(4), strength);
    let (p1, mut p0, mut q0, q1) = (signed(v[2]), signed(v[3]), signed(v[4]), signed(v[5]));
    let delta = is_filtered.select(base_delta(p1.saturating_sub(q1), p0, q0), 0);
    adjust_innermost(is_smooth.select(0, delta), &mut p0, &mut q0);

    // (27, 18 and 9 times delta + 63) >> 7, the even lanes and the odd ones apart, in the upper half of 16 bits.
    let both = is_smooth.select(delta, 0).bitcast::<i16>();
    let even9 = (both << 8).mul_high_doubled(9 << 7);
    let odd9 = (both & -256).mul_high_doubled(9 << 7);
    let (mut even, mut odd) = (Simd::splat(63), Simd::splat(63));
    for (p, q, to) in [(signed(v[1]), signed(v[6]), 1), (p1, q1, 2), (p0, q0, 3)] {
        (even, odd) = (even + even9, odd + odd9);
        let by = (even >> 7)
            .bitcast::<i8>()
            .alternate((odd + odd).bitcast::<i8>());
        (v[to], v[7 - to]) = (
            unsigned(p.saturating_add(by)),
            unsigned(q.saturating_sub(by)),
        );
    }
}

/// Four of these with N = 16 transpose each 16 x 16 bytes.
#[simd]
fn shuffle<const N: usize, W: Width>(v: [V<W, S>; N]) -> [V<W, S>; N] {
    let mut out = v;
    for i in 0..N / 2 {
        [out[2 * i], out[2 * i + 1]] = v[i].in_blocks().interleave(v[i + N / 2]);
    }
    out
}

/// What the lanes along an edge are.
#[simd]
trait Planes {
    type W: Width;
    const HAS_LUMA: bool;
    /// For vertical edges: one of 16 rows, from column `x - LEFT`.
    fn load_across<X: Width>(&mut self, row: usize, x: usize) -> V<Self::W, S>;
    fn store_across<X: Width>(&mut self, v: V<Self::W, S>, row: usize, x: usize);
    /// Of each 16 bytes, the lower 8 to `row` and the others to the next.
    fn store_two_across(&mut self, v: V<Self::W, S>, row: usize, x: usize);
    /// For horizontal edges: number `i` of the `rows` from `first` on.
    fn load_along(&mut self, first: usize, rows: usize, i: usize) -> V<Self::W, S>;
    fn store_along(&mut self, v: V<Self::W, S>, first: usize, rows: usize, i: usize);
}

struct Luma<'a, const ABOVE: usize>(RowsMut<'a, u8>);

#[simd]
impl<const ABOVE: usize> Planes<S> for Luma<'_, ABOVE> {
    type W = B16;
    const HAS_LUMA: bool = true;
    fn load_across<X: Width>(&mut self, row: usize, x: usize) -> V<B16, S> {
        Simd::<u8, X, S>::load(self.0.at(x, ABOVE, X::BYTES, 16).row(row)).resize()
    }
    fn store_across<X: Width>(&mut self, v: V<B16, S>, row: usize, x: usize) {
        v.resize::<X>()
            .store(self.0.at(x, ABOVE, X::BYTES, 16).row(row));
    }
    fn store_two_across(&mut self, v: V<B16, S>, row: usize, x: usize) {
        let [lower, upper] = v.split();
        self.store_across::<B8>(lower.resize(), row, x);
        self.store_across::<B8>(upper.resize(), row + 1, x);
    }
    fn load_along(&mut self, first: usize, rows: usize, i: usize) -> V<B16, S> {
        Simd::load(self.0.at(LEFT, first, 16, rows).row(i))
    }
    fn store_along(&mut self, v: V<B16, S>, first: usize, rows: usize, i: usize) {
        v.store(self.0.at(LEFT, first, 16, rows).row(i));
    }
}

/// 8 lanes of U, then 8 of V.
struct Chroma<'a>([RowsMut<'a, u8>; 2]);

#[simd]
impl Planes<S> for Chroma<'_> {
    type W = B16;
    const HAS_LUMA: bool = false;
    fn load_across<X: Width>(&mut self, row: usize, x: usize) -> V<B16, S> {
        Simd::<u8, B8, S>::load(self.0[row / 8].at(x, 4, 8, 8).row(row % 8)).resize()
    }
    fn store_across<X: Width>(&mut self, v: V<B16, S>, row: usize, x: usize) {
        v.split()[0].store(self.0[row / 8].at(x, 4, 8, 8).row(row % 8));
    }
    fn store_two_across(&mut self, v: V<B16, S>, row: usize, x: usize) {
        let [lower, upper] = v.split();
        self.store_across::<B8>(lower.resize(), row, x);
        self.store_across::<B8>(upper.resize(), row + 1, x);
    }
    fn load_along(&mut self, first: usize, rows: usize, i: usize) -> V<B16, S> {
        let u = Simd::<u8, B8, S>::load(self.0[0].at(LEFT, first, 8, rows).row(i));
        u.concat(Simd::load(self.0[1].at(LEFT, first, 8, rows).row(i)))
    }
    fn store_along(&mut self, v: V<B16, S>, first: usize, rows: usize, i: usize) {
        let [u, v] = v.split();
        u.store(self.0[0].at(LEFT, first, 8, rows).row(i));
        v.store(self.0[1].at(LEFT, first, 8, rows).row(i));
    }
}

#[simd]
impl<A: Planes<S, W = B16>, B: Planes<S, W = B16>> Planes<S> for (&mut A, &mut B) {
    type W = B32;
    const HAS_LUMA: bool = true;
    fn load_across<X: Width>(&mut self, row: usize, x: usize) -> V<B32, S> {
        self.0
            .load_across::<X>(row, x)
            .concat(self.1.load_across::<X>(row, x))
    }
    fn store_across<X: Width>(&mut self, v: V<B32, S>, row: usize, x: usize) {
        let [a, b] = v.split();
        self.0.store_across::<X>(a, row, x);
        self.1.store_across::<X>(b, row, x);
    }
    fn store_two_across(&mut self, v: V<B32, S>, row: usize, x: usize) {
        let [a, b] = v.split();
        self.0.store_two_across(a, row, x);
        self.1.store_two_across(b, row, x);
    }
    fn load_along(&mut self, first: usize, rows: usize, i: usize) -> V<B32, S> {
        self.0
            .load_along(first, rows, i)
            .concat(self.1.load_along(first, rows, i))
    }
    fn store_along(&mut self, v: V<B32, S>, first: usize, rows: usize, i: usize) {
        let [a, b] = v.split();
        self.0.store_along(a, first, rows, i);
        self.1.store_along(b, first, rows, i);
    }
}

/// `filter` gets the four columns to the left of `edge` and the four to the right.
#[simd]
fn at_vertical_edge<P: Planes<S>>(planes: &mut P, edge: usize, filter: impl Fn(&mut [V<P::W, S>])) {
    let mut v = [Simd::zero(); 8];
    unroll!(for i in 0..8 {
        v[i] = planes
            .load_across::<B8>(i, edge)
            .in_blocks()
            .interleave(planes.load_across::<B8>(i + 8, edge))[0];
    });
    v = shuffle(shuffle(shuffle(v)));
    filter(&mut v);
    v = shuffle(shuffle(shuffle(v)));
    unroll!(for i in 0..8 {
        planes.store_two_across(v[i], 2 * i, edge);
    });
}

/// `filter` gets columns 0 to 15, of which chroma has half.
#[simd]
fn at_inner_vertical_edges<P: Planes<S>>(planes: &mut P, filter: impl Fn(&mut [V<P::W, S>])) {
    let mut v = [Simd::zero(); 16];
    unroll!(for i in 0..16 {
        v[i] = planes.load_across::<B16>(i, LEFT);
    });
    v = shuffle(shuffle(shuffle(shuffle(v))));
    filter(&mut v);
    v = shuffle(shuffle(shuffle(shuffle(v))));
    unroll!(for i in 0..16 {
        planes.store_across::<B16>(v[i], i, LEFT);
    });
}

/// `filter` gets `READ` of the four rows above an edge, from row `first` on, and of the four below. It changes up to
/// `CHANGED` of each.
#[simd]
fn at_horizontal_edge<const READ: usize, const CHANGED: usize, P: Planes<S>>(
    planes: &mut P,
    first: usize,
    filter: impl Fn(&mut [V<P::W, S>]),
) {
    let mut v = [Simd::zero(); 8];
    unroll!(for i in 0..8 {
        if i < 2 * READ {
            v[4 - READ + i] = planes.load_along(first, 2 * READ, i);
        }
    });
    filter(&mut v);
    unroll!(for i in 0..8 {
        if (READ - CHANGED..READ + CHANGED).contains(&i) {
            planes.store_along(v[4 - READ + i], first, 2 * READ, i);
        }
    });
}

/// Returns `flag`, and hides from rustc that it was tested before. It would duplicate the code between
/// the two tests.
#[simd]
fn asked_again(flag: bool) -> bool {
    u8::from(flag) != 0
}

/// All but the two lower horizontal edges of luma.
#[simd]
fn most_edges<P: Planes<S>>(
    planes: &mut P,
    strength: FilterStrength,
    has_left: bool,
    has_above: bool,
) {
    if has_left {
        at_vertical_edge(planes, 0, |v| macroblock_edge(v, strength));
    }
    if strength.filters_inner_edges {
        if P::HAS_LUMA {
            at_inner_vertical_edges(planes, |v| {
                inner_edge(v, strength, P::W::BYTES);
                inner_edge(&mut v[4..], strength, 16);
                inner_edge(&mut v[8..], strength, 16);
            });
        } else {
            at_vertical_edge(planes, 4, |v| inner_edge(v, strength, 16));
        }
    }
    if has_above {
        at_horizontal_edge::<4, 3, _, S>(planes, 0, |v| macroblock_edge(v, strength));
    }
    if asked_again(strength.filters_inner_edges) {
        at_horizontal_edge::<4, 2, _, S>(planes, 4, |v| inner_edge(v, strength, P::W::BYTES));
    }
}

/// The normal filter, for as many macroblocks as there are `strengths`. Four rows are above them. Unless `has_above`,
/// the edge to those is that of the picture.
#[kernel]
pub(crate) fn filter_normally(
    planes: &mut [Plane<'_>; 3],
    strengths: &[FilterStrength],
    has_above: bool,
) {
    let [y, u, v] = planes;
    assert!(u.stride == v.stride);
    for (i, &strength) in strengths.iter().enumerate() {
        if strength.edge_limit == 0 {
            continue;
        }
        let mut luma = Luma::<4>(y.around(16, 4, i));
        let mut chroma = Chroma([u.around(8, 4, i), v.around(8, 4, i)]);
        // If the registers hold both.
        if Native::<S>::BYTES * S::REGISTERS >= 512 {
            most_edges(&mut (&mut luma, &mut chroma), strength, i != 0, has_above);
        } else {
            most_edges(&mut luma, strength, i != 0, has_above);
            most_edges(&mut chroma, strength, i != 0, has_above);
        }
        if strength.filters_inner_edges {
            at_horizontal_edge::<4, 2, _, S>(&mut luma, 8, |v| inner_edge(v, strength, 16));
            at_horizontal_edge::<4, 2, _, S>(&mut luma, 12, |v| inner_edge(v, strength, 16));
        }
    }
}

/// The simple one, which is for luma alone and needs two rows.
#[kernel]
pub(crate) fn filter_simply(y: &mut Plane<'_>, strengths: &[FilterStrength], has_above: bool) {
    for (i, &strength) in strengths.iter().enumerate() {
        if strength.edge_limit == 0 {
            continue;
        }
        let mut luma = Luma::<2>(y.around(16, 2, i));
        let (outer, inner) = (strength.edge_limit.wrapping_add(4), strength.edge_limit);
        if i != 0 {
            at_vertical_edge(&mut luma, 0, |v| simple_edge(v, outer));
        }
        if strength.filters_inner_edges {
            at_inner_vertical_edges(&mut luma, |v| {
                simple_edge(v, inner);
                simple_edge(&mut v[4..], inner);
                simple_edge(&mut v[8..], inner);
            });
        }
        if has_above {
            at_horizontal_edge::<2, 1, _, S>(&mut luma, 0, |v| simple_edge(v, outer));
        }
        if asked_again(strength.filters_inner_edges) {
            for edge in (4..16).step_by(4) {
                at_horizontal_edge::<2, 1, _, S>(&mut luma, edge, |v| simple_edge(v, inner));
            }
        }
    }
}
