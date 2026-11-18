//! Prediction, the loop filters and the transforms of the lossless format.
use super::{Rgba, rotate};
use bun_simd::{Int, Isa, Shuffle, Vector};
use core::array::from_fn;
use core::slice::{from_mut, from_ref};

pub use simd::{
    filter_normally, filter_simply, reconstruct_subblocks, undo_cross_color, undo_prediction,
};

type Bytes<const N: usize, I> = Vector<u8, N, I>;

/// The samples that the loop filter needs at both ends of each row. It leaves them as they are.
pub const ROW_SLACK: usize = 4;

/// How the loop filter treats a macroblock.
#[derive(Clone, Copy, Default)]
pub struct FilterStrength {
    /// For the edges inside of it, 4 less than for those around it. 0: it is left as it is.
    pub edge_limit: u8,
    pub interior_limit: u8,
    pub high_variance_threshold: u8,
    pub filters_inner_edges: bool,
}

/// One channel of a row of macroblocks, below some rows. All rows have a whole `stride`.
pub struct Plane<'a> {
    pub samples: &'a mut [u8],
    pub stride: usize,
    /// Where in `samples` the first macroblock starts.
    pub start: usize,
}

/// `H` rows, of which the last go through the macroblocks, from `ROW_SLACK` samples before those on.
struct Rows<'a, const H: usize> {
    samples: &'a mut [u8],
    stride: usize,
}

impl<'a> Plane<'a> {
    #[inline(always)]
    fn rows<const H: usize>(self, size: usize, count: usize) -> Option<Rows<'a, H>> {
        let len = 2 * ROW_SLACK + size * usize::from(u16::try_from(count).ok()?);
        // LLVM sees that no offset overflows.
        let stride = Some(self.stride).filter(|it| (len..usize::MAX / 32).contains(it))?;
        let start = self.start.checked_sub(stride * (H - size) + ROW_SLACK)?;
        let samples = self.samples.get_mut(start..)?.get_mut(..stride * H)?;
        Some(Rows { samples, stride })
    }
}

impl<const H: usize> Rows<'_, H> {
    /// Just macroblock `x`.
    #[inline(always)]
    fn cut(&mut self, size: usize, x: usize) -> Option<Rows<'_, H>> {
        let len = self.stride * (H - 1) + size + 2 * ROW_SLACK;
        let samples = self.samples.get_mut(size * x..)?.get_mut(..len)?;
        Some(Rows { samples, ..*self })
    }

    #[inline(always)]
    fn get<const N: usize, I: Isa>(&self, y: usize, x: usize) -> Bytes<N, I> {
        Vector::from_slice(&self.samples[y * self.stride + x..y * self.stride + x + N])
    }

    #[inline(always)]
    fn set<const N: usize, I: Isa>(&mut self, y: usize, x: usize, v: Bytes<N, I>) {
        v.copy_to_slice(&mut self.samples[y * self.stride + x..y * self.stride + x + N]);
    }
}

/// What the lanes along an edge are. Columns start 4 before the macroblock, rows for `along` too.
trait Planes<V> {
    /// One of 16 rows, in each 16 lanes. Only the first 8 samples count.
    fn across(&self, y: usize) -> V;
    /// 8 samples each for rows `y` and `y + 1`.
    fn set_across(&mut self, y: usize, v: V);
    fn along(&self, y: usize) -> V;
    fn set_along(&mut self, y: usize, v: V);
}

impl<I: Isa, const H: usize> Planes<Bytes<16, I>> for Rows<'_, H> {
    #[inline(always)]
    fn across(&self, y: usize) -> Bytes<16, I> {
        self.get(H - 16 + y, 0)
    }

    #[inline(always)]
    fn set_across(&mut self, y: usize, v: Bytes<16, I>) {
        self.set(H - 16 + y, 0, v.halves()[0]);
        self.set(H - 15 + y, 0, v.halves()[1]);
    }

    #[inline(always)]
    fn along(&self, y: usize) -> Bytes<16, I> {
        self.get(H + y - 20, 4)
    }

    #[inline(always)]
    fn set_along(&mut self, y: usize, v: Bytes<16, I>) {
        self.set(H + y - 20, 4, v);
    }
}

impl<I: Isa> Planes<Bytes<16, I>> for [Rows<'_, 12>; 2] {
    #[inline(always)]
    fn across(&self, y: usize) -> Bytes<16, I> {
        self[y / 8].get(4 + y % 8, 0)
    }

    #[inline(always)]
    fn set_across(&mut self, y: usize, v: Bytes<16, I>) {
        self[y / 8].set(4 + y % 8, 0, v.halves()[0]);
        self[y / 8].set(5 + y % 8, 0, v.halves()[1]);
    }

    #[inline(always)]
    fn along(&self, y: usize) -> Bytes<16, I> {
        Bytes::<16, I>::from_halves([self[0].get(y, 4), self[1].get(y, 4)])
    }

    #[inline(always)]
    fn set_along(&mut self, y: usize, v: Bytes<16, I>) {
        self[0].set(y, 4, v.halves()[0]);
        self[1].set(y, 4, v.halves()[1]);
    }
}

impl<I: Isa> Planes<Bytes<32, I>> for (Rows<'_, 20>, [Rows<'_, 12>; 2]) {
    #[inline(always)]
    fn across(&self, y: usize) -> Bytes<32, I> {
        Bytes::<32, I>::from_halves([self.0.across(y), self.1.across(y)])
    }

    #[inline(always)]
    fn set_across(&mut self, y: usize, v: Bytes<32, I>) {
        self.0.set_across(y, v.halves()[0]);
        self.1.set_across(y, v.halves()[1]);
    }

    #[inline(always)]
    fn along(&self, y: usize) -> Bytes<32, I> {
        let chroma = if y < 12 { self.1.along(y) } else { 0.into() };
        Bytes::<32, I>::from_halves([self.0.along(y), chroma])
    }

    #[inline(always)]
    fn set_along(&mut self, y: usize, v: Bytes<32, I>) {
        if y < 12 {
            self.1.set_along(y, v.halves()[1]);
        }
        self.0.set_along(y, v.halves()[0]);
    }
}

/// L L K J I X A B C D E F G H H: up the last column of a subblock, then along a row from `CORNER` on.
struct Edge<const CORNER: usize>;

impl<const CORNER: usize> Shuffle<16> for Edge<CORNER> {
    const FROM: [usize; 16] = from_fn(const |i| match i {
        0..5 => [15, 15, 11, 7, 3][i],
        5..14 if CORNER + i < 21 => 11 + CORNER + i,
        _ => 16 + if CORNER + 8 < 16 { CORNER + 8 } else { 15 },
    });
}

/// The last 4 bytes come from the second vector.
struct WithLast;

impl Shuffle<4> for WithLast {
    const FROM: [usize; 4] = [0, 1, 2, 7];
}

/// The index that looks up a zero.
const X: u8 = 0x80;
const TRUE_MOTION: u8 = 1;

/// For each mode and sample: a lane of the averages of 3 or, from 16 on, of 2. The last has that of 8.
static SOURCES: [[u8; 16]; 10] = [
    [31; 16],
    [0; 16],
    [5, 6, 7, 8, 5, 6, 7, 8, 5, 6, 7, 8, 5, 6, 7, 8],
    [3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0],
    [4, 5, 6, 7, 3, 4, 5, 6, 2, 3, 4, 5, 1, 2, 3, 4],
    [21, 22, 23, 24, 4, 5, 6, 7, 3, 21, 22, 23, 2, 4, 5, 6],
    [6, 7, 8, 9, 7, 8, 9, 10, 8, 9, 10, 11, 9, 10, 11, 12],
    [22, 23, 24, 25, 6, 7, 8, 9, 23, 24, 25, 10, 7, 8, 9, 11],
    [20, 4, 5, 6, 19, 3, 20, 4, 18, 2, 19, 3, 17, 1, 18, 2],
    [19, 2, 18, 1, 18, 1, 17, 0, 17, 0, 16, 16, 16, 16, 16, 16],
];

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    use isa::x128::{I16, I32, U8, U32, U64};
    use isa::x256;

    const IS_NARROW: bool = isa::U8::LEN == 16;

    #[bun_simd::foreach_width(x128, x256)]
    mod width {
        use isa::{I8, I16, Mask, U8, U32, U64};
        const N: usize = U8::LEN;

        #[inline(always)]
        fn signed(v: U8) -> I8 {
            (v ^ 0x80).bitcast()
        }

        #[inline(always)]
        fn unsigned(v: I8) -> U8 {
            v.bitcast::<U8>() ^ 0x80
        }

        #[inline(always)]
        fn is_within(limit: U8, [p1, p0, q0, q1]: [U8; 4]) -> Mask<u8, N> {
            let inner = p0.abs_diff(q0);
            let step = inner.saturating_add(inner);
            step.saturating_add(p1.abs_diff(q1) >> 1).simd_le(limit)
        }

        /// `outer + 3 * (q0 - p0)`. In this order, the saturation on the way makes no difference.
        #[inline(always)]
        fn base_delta(outer: I8, p0: I8, q0: I8) -> I8 {
            let step = q0.saturating_sub(p0);
            step.saturating_add(step.saturating_add(step.saturating_add(outer)))
        }

        /// Returns what it takes from `q0`.
        #[inline(always)]
        fn adjust(delta: I8, p0: &mut I8, q0: &mut I8) -> I8 {
            let from_q = delta.saturating_add(4) >> 3;
            *p0 = p0.saturating_add(delta.saturating_add(3) >> 3);
            *q0 = q0.saturating_sub(from_q);
            from_q
        }

        /// RFC 6386, 15. `v` starts with p3 p2 p1 p0 q0 q1 q2 q3, the samples across an edge.
        #[inline(always)]
        fn simple_edge(v: &mut [U8], limit: u8) {
            let is_filtered = is_within(limit.into(), [v[2], v[3], v[4], v[5]]).cast();
            let [p1, mut p0, mut q0, q1] = [signed(v[2]), signed(v[3]), signed(v[4]), signed(v[5])];
            let delta = base_delta(p1.saturating_sub(q1), p0, q0);
            adjust(is_filtered.select(delta, 0), &mut p0, &mut q0);
            (v[3], v[4]) = (unsigned(p0), unsigned(q0));
        }

        /// Whether to filter, and whether the variance is low.
        #[inline(always)]
        fn classify(v: &[U8], limit: U8, strength: FilterStrength) -> [Mask<i8, N>; 2] {
            let variance = v[2].abs_diff(v[3]).simd_max(v[4].abs_diff(v[5]));
            let p_steps = v[0].abs_diff(v[1]).simd_max(v[1].abs_diff(v[2]));
            let q_steps = v[5].abs_diff(v[6]).simd_max(v[6].abs_diff(v[7]));
            let steps = variance.simd_max(p_steps.simd_max(q_steps));
            let is_inside = steps.simd_le(strength.interior_limit);
            [
                (is_inside & is_within(limit, [v[2], v[3], v[4], v[5]])).cast(),
                variance.simd_le(strength.high_variance_threshold).cast(),
            ]
        }

        /// Changes nothing where `limit` is zero.
        #[inline(always)]
        fn inner_edge(v: &mut [U8], limit: U8, strength: FilterStrength) {
            let [is_filtered, is_smooth] = classify(v, limit, strength);
            let [p1, mut p0, mut q0, q1] = [signed(v[2]), signed(v[3]), signed(v[4]), signed(v[5])];
            let delta = base_delta(is_smooth.select(0, p1.saturating_sub(q1)), p0, q0);
            let from_q = adjust(is_filtered.select(delta, 0), &mut p0, &mut q0);
            // `(from_q + 1) >> 1`
            let half = unsigned(from_q).average_round(U8::zero()).bitcast::<I8>() - 64;
            let half = is_smooth.select(half, 0);
            (v[2], v[3]) = (unsigned(p1.saturating_add(half)), unsigned(p0));
            (v[4], v[5]) = (unsigned(q0), unsigned(q1.saturating_sub(half)));
        }

        #[inline(always)]
        fn macroblock_edge(v: &mut [U8], limit: u8, strength: FilterStrength) {
            let [is_filtered, is_smooth] = classify(v, limit.into(), strength);
            let [p1, mut p0, mut q0, q1] = [signed(v[2]), signed(v[3]), signed(v[4]), signed(v[5])];
            let delta = is_filtered.select(base_delta(p1.saturating_sub(q1), p0, q0), 0);
            adjust(is_smooth.select(0, delta), &mut p0, &mut q0);
            let (lower, upper) = I8::zero().interleave_in_blocks(is_smooth.select(delta, 0));
            // `-((by * delta + 63) >> 7)`
            let less = |by: i16| {
                let times = |v: I8| v.bitcast::<I16>().mul_q15((-by).into());
                I8::pack(times(lower), times(upper))
            };
            let [by_27, by_18, by_9] = [less(27), less(18), less(9)];
            v[1] = unsigned(signed(v[1]).saturating_sub(by_9));
            v[2] = unsigned(p1.saturating_sub(by_18));
            v[3] = unsigned(p0.saturating_sub(by_27));
            v[4] = unsigned(q0.saturating_add(by_27));
            v[5] = unsigned(q1.saturating_add(by_18));
            v[6] = unsigned(signed(v[6]).saturating_add(by_9));
        }

        /// Changes nothing unless it `is_edge`.
        #[inline(always)]
        fn outer<const READ: usize>(v: &mut [U8], is_edge: bool, strength: FilterStrength) {
            let limit = strength.edge_limit.wrapping_add(4) * u8::from(is_edge);
            match READ {
                2 => simple_edge(v, limit),
                _ => macroblock_edge(v, limit, strength),
            }
        }

        /// Up to 3 edges, of which those in `for_chroma` go through all planes.
        #[inline(always)]
        fn inner<const READ: usize>(v: &mut [U8], for_chroma: [bool; 3], strength: FilterStrength) {
            let limit = U8::splat(strength.edge_limit);
            let for_luma = U8::iota().simd_lt(16).select(limit, 0);
            #[rustc_unroll(full)]
            for i in 0..v.len() / 4 - 1 {
                let limit = if for_chroma[i] { limit } else { for_luma };
                match READ {
                    2 => simple_edge(&mut v[4 * i..], strength.edge_limit),
                    _ => inner_edge(&mut v[4 * i..], limit, strength),
                }
            }
        }

        /// Returns the first columns of the macroblock.
        #[inline(always)]
        fn left_edge<const READ: usize>(
            at: &mut impl Planes<U8>,
            strength: FilterStrength,
        ) -> [U8; 4] {
            let mut v = [U8::zero(); 8];
            #[rustc_unroll(full)]
            for y in 0..8 {
                v[y] = at.across(y).interleave_in_blocks(at.across(y + 8)).0;
            }
            rotate(&mut v, 3);
            outer::<READ>(&mut v, true, strength);
            let columns = [v[4], v[5], v[6], v[7]];
            rotate(&mut v, 3);
            #[rustc_unroll(full)]
            for i in 0..8 {
                at.set_across(2 * i, v[i]);
            }
            columns
        }

        /// For `ROWS` rows. The simple filter reads 2 samples to each side of an edge, the other 4.
        #[inline(always)]
        pub fn filter<const ROWS: usize, const READ: usize>(
            at: &mut impl Planes<U8>,
            strength: FilterStrength,
            has: [bool; 2],
        ) {
            match strength.filters_inner_edges {
                true => edges::<ROWS, READ>(at, strength, has),
                false => edges::<4, READ>(at, strength, has),
            }
        }

        #[inline(always)]
        fn edges<const ROWS: usize, const READ: usize>(
            at: &mut impl Planes<U8>,
            strength: FilterStrength,
            [has_left, has_above]: [bool; 2],
        ) {
            if has_left && ROWS < 16 {
                left_edge::<READ>(at, strength);
            }
            let mut v = [U8::zero(); ROWS];
            #[rustc_unroll(full)]
            for y in 0..ROWS {
                v[y] = at.along(4 + y);
            }
            if ROWS > 4 {
                // Next to luma, the columns of V follow those of U.
                rotate(&mut v, 4);
                if has_left && ROWS == 16 {
                    let (columns, is_luma) =
                        (left_edge::<READ>(at, strength), U8::iota().simd_lt(16));
                    #[rustc_unroll(full)]
                    for x in 0..READ - 1 {
                        let of_v = columns[x].bitcast::<U64>().swap_pairs().bitcast::<U8>();
                        (v[x], v[ROWS / 2 + x]) =
                            (columns[x], is_luma.select(v[ROWS / 2 + x], of_v));
                    }
                }
                inner::<READ>(&mut v, [true, false, true], strength);
                rotate(&mut v, ROWS.ilog2() as usize);
            }
            // With all rows in registers, a branch costs more than the first row of a picture saves.
            if has_above || ROWS > 4 {
                let mut both = [v[0], v[1], v[2], v[3], v[0], v[1], v[2], v[3]];
                #[rustc_unroll(full)]
                for y in 4 - READ..4 {
                    both[y] = at.along(y);
                }
                outer::<READ>(&mut both, has_above, strength);
                #[rustc_unroll(full)]
                for y in 5 - READ..4 {
                    at.set_along(y, both[y]);
                }
                [v[0], v[1], v[2], v[3]] = [both[4], both[5], both[6], both[7]];
            }
            inner::<READ>(&mut v, [true, false, false], strength);
            #[rustc_unroll(full)]
            for y in 0..if ROWS > 4 { ROWS } else { READ - 1 } {
                at.set_along(4 + y, v[y]);
            }
        }

        /// Returns what is left of `row`.
        #[inline(always)]
        pub fn undo_cross_color(row: &mut [u8], factors: [I16; 2]) -> &mut [u8] {
            let (steps, rest) = row.as_chunks_mut();
            #[rustc_unroll(never)]
            for step in steps {
                cross_color(U8::load(step), factors).store(step);
            }
            rest
        }

        /// `(color * factor) >> 5` is the upper half of `(color << 8) * (factor << 3)`.
        #[inline(always)]
        pub fn cross_color(mut pixels: U8, [from_green, from_red]: [I16; 2]) -> U8 {
            const GREENS: [u8; 16] = [X, 1, X, 1, X, 5, X, 5, X, 9, X, 9, X, 13, X, 13];
            let delta = |colors: I16, by| (colors.mul_high(by) & 0xFF).bitcast::<U8>();
            pixels += delta(pixels.lookup(U8::repeat(GREENS)).bitcast(), from_green);
            pixels + delta((pixels.bitcast::<U32>() << 24).bitcast(), from_red)
        }
    }

    /// RFC 6386, 12.3. Returns four rows of four. The modes are too hard to guess for a branch.
    #[inline(always)]
    fn subblock(edge: U8, mode: u8, residuals: &[i16; 64], x: usize) -> U8 {
        let pick = |lanes| edge.lookup(U8::from_array(lanes));
        let next = U8::zero().shift_in::<15>(edge);
        let after_next = U8::zero().shift_in::<14>(edge);
        let outer = edge.average_round(after_next) - ((edge ^ after_next) & 1);
        let eight = pick([X, X, X, X, X, X, X, X, 1, 2, 3, 4, 6, 7, 8, 9]);
        let of_eight = (U64::sums_of_8(eight) + 4) << 53;
        let of_two = edge.average_round(next).bitcast::<U32>();
        let of_two = of_two.shuffle::<WithLast>(of_eight.bitcast()).bitcast();
        let sources = U8::load(&SOURCES[usize::from(mode.min(9))]);
        let directional = outer.average_round(next).lookup2(of_two, sources);

        let above = pick([6, 7, 8, 9, 6, 7, 8, 9, 6, 7, 8, 9, 6, 7, 8, 9]);
        let left = pick([4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
        let corner = pick([5; 16]);
        let (up, down) = (left.saturating_sub(corner), corner.saturating_sub(left));
        let true_motion = above.saturating_add(up).saturating_sub(down);
        let is_true_motion = U8::splat(mode).simd_eq(TRUE_MOTION);
        let predicted = is_true_motion.select(true_motion, directional);

        let row = |y: usize| isa::Vector::<_, 4>::from_slice(&residuals[16 * y + 4 * x..]);
        let (upper, lower) = predicted.interleave(U8::zero());
        U8::pack(
            I16::from_halves([row(0), row(1)]) + upper.bitcast::<I16>(),
            I16::from_halves([row(2), row(3)]) + lower.bitcast::<I16>(),
        )
    }

    /// `left` has the sample in the corner, the 16 below it and 3 more. `modes` are those of libwebp.
    #[export]
    pub fn reconstruct_subblocks(
        above: &[u8; 16],
        above_right: [u8; 4],
        left: &[u8; 20],
        modes: &[[u8; 4]; 4],
        residuals: &[[i16; 64]; 4],
        samples: &mut [[u8; 16]; 16],
    ) {
        const LEFT: [u8; 16] = [4, 4, 3, 2, 1, 0, X, X, X, X, X, X, X, X, X, X];
        const ABOVE: [u8; 16] = [X, X, X, X, X, X, 0, 1, 2, 3, 4, 5, 6, 7, 7, X];
        const ABOVE_RIGHT: [u8; 16] = [X, X, X, X, X, X, X, X, X, X, 0, 1, 2, 3, 3, X];
        // All rows of subblocks have this at their right end.
        let beyond = pixel(above_right).lookup(U8::load(&ABOVE_RIGHT));
        let mut top = U8::load(above);
        #[rustc_unroll(never)]
        for y in 0..4 {
            let column = U64::from_first(u64::from_le_bytes(*left[4 * y..].first_chunk().unwrap()));
            let column = column.bitcast::<U8>().lookup(U8::load(&LEFT));
            let block = |x: usize, edge| subblock(edge, modes[y][x], &residuals[y], x);
            let a = block(0, column | top.lookup(U8::load(&ABOVE)));
            let b = block(1, a.shuffle::<Edge<3>>(top));
            let c = block(2, b.shuffle::<Edge<7>>(top));
            let keep = U8::iota().simd_lt(10);
            let d = block(3, keep.select(c.shuffle::<Edge<11>>(top), beyond));
            let mut rows = [a, b, c, d].map(|it| it.bitcast::<U32>());
            rotate(&mut rows, 2);
            for i in 0..4 {
                rows[i].bitcast::<U8>().store(&mut samples[4 * y + i]);
            }
            top = rows[3].bitcast();
        }
    }

    /// For a macroblock of each strength. Unless `has_above`, the first row is that of the picture.
    #[export]
    #[must_use]
    #[allow(
        clippy::large_unopt_stack_frames,
        reason = "all profiles optimize this crate"
    )]
    pub fn filter_normally(
        planes: [Plane<'_>; 3],
        strengths: &[FilterStrength],
        has_above: bool,
    ) -> Option<()> {
        let ([y, u, v], count) = (planes, strengths.len());
        let mut y = y.rows::<20>(16, count)?;
        let (mut u, mut v) = (u.rows(8, count)?, v.rows(8, count)?);
        for (x, &strength) in strengths.iter().enumerate() {
            if strength.edge_limit == 0 {
                continue;
            }
            let mut both = (y.cut(16, x)?, [u.cut(8, x)?, v.cut(8, x)?]);
            let has = [x != 0, has_above];
            if IS_NARROW {
                width::x128::filter::<16, 4>(&mut both.0, strength, has);
                width::x128::filter::<8, 4>(&mut both.1, strength, has);
            } else {
                width::x256::filter::<16, 4>(&mut both, strength, has);
            }
        }
        Some(())
    }

    /// The same for luma alone, which needs 2 rows above and not 4.
    #[export]
    #[must_use]
    pub fn filter_simply(
        y: Plane<'_>,
        strengths: &[FilterStrength],
        has_above: bool,
    ) -> Option<()> {
        let mut y = y.rows::<18>(16, strengths.len())?;
        for (x, &strength) in strengths.iter().enumerate() {
            if strength.edge_limit != 0 {
                width::x128::filter::<16, 2>(&mut y.cut(16, x)?, strength, [x != 0, has_above]);
            }
        }
        Some(())
    }

    #[inline(always)]
    fn pixel(it: Rgba) -> U8 {
        U32::from_first(u32::from_le_bytes(it)).bitcast()
    }

    #[inline(always)]
    fn first(v: U8) -> Rgba {
        *v.to_array().first_chunk().unwrap()
    }

    /// In steps of `N` bytes. Leaves all slices with the rest.
    #[inline(always)]
    fn add_steps<const N: usize, const MODE: u8>(row: &mut &mut [u8], [tl, t, tr]: &mut [&[u8]; 3])
    where
        u8: Int<N>,
    {
        let (steps, a, b, c);
        (steps, *row) = core::mem::take(row).as_chunks_mut();
        ((a, *tl), (b, *t), (c, *tr)) = (tl.as_chunks(), t.as_chunks(), tr.as_chunks());
        #[rustc_unroll(never)]
        for i in 0..steps.len() {
            let load = |bytes| isa::Vector::load(bytes);
            let [tl, t, tr] = [load(&a[i]), load(&b[i]), load(&c[i])];
            let predicted = match MODE {
                2 => t,
                3 => tr,
                4 => tl,
                8 => !(!tl).average_round(!t),
                9 => !(!t).average_round(!tr),
                _ => Vector::from_array(const { from_fn(const |i| [0, 0, 0, 255][i % 4]) }),
            };
            (predicted + load(&steps[i])).store(&mut steps[i]);
        }
    }

    #[inline(always)]
    fn add_above<const MODE: u8>(mut row: &mut [u8], [tl, t, tr]: [&[Rgba]; 3]) {
        let above = &mut [tl.as_flattened(), t.as_flattened(), tr.as_flattened()];
        add_steps::<32, MODE>(&mut row, above);
        add_steps::<16, MODE>(&mut row, above);
        add_steps::<4, MODE>(&mut row, above);
    }

    /// The first of four pixels, the sum of the first two and so on.
    #[inline(always)]
    fn running_sums(pixels: &[Rgba; 4]) -> U8 {
        let sums = U8::from_slice(pixels.as_flattened());
        let sums = sums + sums.shift_elements_right::<4>(0);
        sums + sums.shift_elements_right::<8>(0)
    }

    #[inline(always)]
    fn repeat(v: U8, lane: usize) -> U8 {
        U32::splat(v.bitcast::<U32>()[lane]).bitcast()
    }

    #[inline(always)]
    fn add_left(row: &mut [Rgba], left: Rgba) {
        let (mut left, (steps, rest)) = (repeat(pixel(left), 0), row.as_chunks_mut());
        #[rustc_unroll(never)]
        for step in steps {
            let sums = running_sums(step);
            (sums + left).copy_to_slice(step.as_flattened_mut());
            left += repeat(sums, 3);
        }
        #[rustc_unroll(never)]
        for it in rest {
            left += pixel(*it);
            *it = first(left);
        }
    }

    /// From L, TL, T and TR with all bits inverted, so that rounding down becomes rounding up.
    #[inline(always)]
    fn average<const MODE: u8>([l, tl, t, tr]: [U8; 4]) -> U8 {
        match MODE {
            5 => l.average_round(tr).average_round(t),
            6 => l.average_round(tl),
            7 => l.average_round(t),
            10 => l.average_round(tl).average_round(t.average_round(tr)),
            _ => {
                let middle = l.average_round(t);
                let (up, down) = (
                    middle.saturating_sub(tl) >> 1,
                    tl.saturating_sub(middle) >> 1,
                );
                middle.saturating_add(up).saturating_sub(down)
            }
        }
    }

    #[inline(always)]
    fn add_average<const MODE: u8>(row: &mut [Rgba], left: Rgba, above: [&[Rgba]; 3]) {
        // LLVM would invert in general registers.
        let ones = U8::splat(0xFF).opaque();
        let inverted = |it| pixel(it) ^ ones;
        let [&[tl, ..], &[t, ..], tr] = above else {
            return;
        };
        let [mut left, mut tl, mut t] = [inverted(left), inverted(tl), inverted(t)];
        #[rustc_unroll(2)]
        for i in 0..row.len() {
            let tr = inverted(tr[i]);
            left = average::<MODE>([left, tl, t, tr]) - pixel(row[i]);
            // For AArch64, LLVM would join two pixels in a register to save a store.
            row[i] = first(match cfg!(target_arch = "aarch64") {
                true => (left ^ ones).opaque(),
                false => left ^ ones,
            });
            [tl, t] = [t, tr];
        }
    }

    #[inline(always)]
    fn gradient<const MODE: u8>(l: U8, [tl, t, it]: [Rgba; 3]) -> U8 {
        let [tl, t, it] = [pixel(tl), pixel(t), pixel(it)];
        if MODE == 12 {
            let (up, down) = (t.saturating_sub(tl), tl.saturating_sub(t));
            return l.saturating_add(up).saturating_sub(down) + it;
        }
        let [from_l, from_t]: [I32; 2] = [
            U32::sums_of_4_abs_diffs(l, tl).bitcast(),
            U32::sums_of_4_abs_diffs(t, tl).bitcast(),
        ];
        let [with_l, with_t]: [I32; 2] = [(l + it).bitcast(), (t + it).bitcast()];
        from_l.simd_gt(from_t).select(with_l, with_t).bitcast()
    }

    /// For the predictors that give L if TL is T.
    #[inline(always)]
    fn add_gradient<const MODE: u8>(row: &mut [Rgba], left: Rgba, [tl, t, _]: [&[Rgba]; 3]) {
        let (mut left, (steps, rest)) = (pixel(left), row.as_chunks_mut());
        let ((tl, tl_rest), (t, t_rest)) = (tl.as_chunks::<4>(), t.as_chunks::<4>());
        for i in 0..steps.len() {
            let (step, tl, t) = (&mut steps[i], &tl[i], &t[i]);
            let load = |pixels: &[Rgba; 4]| U8::from_slice(pixels.as_flattened());
            if load(t).simd_eq(load(tl)).all() {
                let pixels = running_sums(step) + repeat(left, 0);
                pixels.copy_to_slice(step.as_flattened_mut());
                left = U8::zero().shift_in::<4>(pixels);
                continue;
            }
            for i in 0..4 {
                left = gradient::<MODE>(left, [tl[i], t[i], step[i]]);
                step[i] = first(left);
            }
        }
        #[rustc_unroll(never)]
        for i in 0..rest.len() {
            left = gradient::<MODE>(left, [tl_rest[i], t_rest[i], rest[i]]);
            rest[i] = first(left);
        }
    }

    /// `above` has TL, T and TR for each pixel.
    #[inline(always)]
    #[allow(
        clippy::trivially_copy_pass_by_ref,
        reason = "on Neoverse the load waits for the wider store, and not all modes need it"
    )]
    fn undo_mode(mode: u8, row: &mut [Rgba], left: &Rgba, above: [&[Rgba]; 3]) {
        match mode & 15 {
            1 => add_left(row, *left),
            2 => add_above::<2>(row.as_flattened_mut(), above),
            3 => add_above::<3>(row.as_flattened_mut(), above),
            4 => add_above::<4>(row.as_flattened_mut(), above),
            5 => add_average::<5>(row, *left, above),
            6 => add_average::<6>(row, *left, above),
            7 => add_average::<7>(row, *left, above),
            8 => add_above::<8>(row.as_flattened_mut(), above),
            9 => add_above::<9>(row.as_flattened_mut(), above),
            10 => add_average::<10>(row, *left, above),
            11 => add_gradient::<11>(row, *left, above),
            12 => add_gradient::<12>(row, *left, above),
            13 => add_average::<13>(row, *left, above),
            // With an arm for each value, the jump needs no check.
            0 | 14 | 15 => add_above::<0>(row.as_flattened_mut(), above),
            _ => unreachable!(),
        }
    }

    /// For a row below the first. The second byte of a tile is the mode for `1 << tile_bits` pixels.
    #[export]
    #[must_use]
    pub fn undo_prediction(
        row: &mut [Rgba],
        mut above: &[Rgba],
        tiles: &[Rgba],
        tile_bits: u32,
    ) -> Option<()> {
        let size = 1usize
            .checked_shl(tile_bits)
            .filter(|_| row.len() == above.len())?;
        let last_mode = tiles.get(row.len().checked_sub(1)? >> tile_bits)?[1];
        let start = first(pixel(*row.first()?) + pixel(*above.first()?));
        row[0] = start;
        let (end, mut rest) = row.split_last_mut()?;
        let (mut len, mut tiles) = (size - (1 & (size - 1)), tiles.get(1 >> tile_bits..)?.iter());
        while rest.len() > 1 {
            let (left, part) = rest.split_first_mut()?;
            len = len.min(part.len());
            let window = above.get(..len + 2)?;
            let around = [&window[..len], &window[1..][..len], &window[2..]];
            undo_mode(tiles.next()?[1], &mut part[..len], left, around);
            (rest, above, len) = (&mut rest[len..], &above[len..], size);
        }
        // At the top right of the last pixel is the first one of its own row.
        if let ([left], [tl, t]) = (rest, above) {
            undo_mode(
                last_mode,
                from_mut(end),
                left,
                [tl, t, &start].map(from_ref),
            );
        }
        Some(())
    }

    /// A tile has the factors red to blue, green to blue and green to red for `1 << tile_bits` pixels.
    #[export]
    #[must_use]
    pub fn undo_cross_color(mut row: &mut [Rgba], tiles: &[Rgba], tile_bits: u32) -> Option<()> {
        let size = 1usize.checked_shl(tile_bits)?;
        for tile in tiles {
            let len = size.min(row.len());
            let mut part = row.split_off_mut(..len)?.as_flattened_mut();
            let pick = |lanes| x256::U8::repeat(*tile).lookup(x256::U8::repeat(lanes));
            let [from_green, from_red] = [pick([X, 2, X, 1]), pick([X, X, X, 0])];
            let by: [x256::I16; 2] = [from_green.bitcast(), from_red.bitcast()];
            let by = [by[0] >> 5, by[1] >> 5];
            if !IS_NARROW {
                part = width::x256::undo_cross_color(part, by);
            }
            let by = [by[0].halves()[0], by[1].halves()[0]];
            for it in width::x128::undo_cross_color(part, by).as_chunks_mut().0 {
                *it = first(width::x128::cross_color(pixel(*it), by));
            }
            if row.is_empty() {
                return Some(());
            }
        }
        row.is_empty().then_some(())
    }
}
