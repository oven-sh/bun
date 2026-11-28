use super::ZIGZAG;
use super::{
    BLUE_IN_LUMA, Block, CB_IN_GREEN, CHROMA_BIAS, CR_IN_GREEN, GROUP, HalfGroup, LUMA_BIAS,
    RED_IN_LUMA,
};
use super::{RowPair, Sums, V16, V32, alternating, column_of, in_column, weight_of};
use bun_simd::prelude::*;

#[simd]
type Row = i16x8<S>;
#[simd]
type Weight = i16x4<S>;
#[simd]
type V8 = u8x16<S>;
/// How many pixels `split_rows` takes.
pub(crate) const STEP: usize = 16;
pub(crate) const HALF_ROW_STARTS: [usize; 3] = [0, 1, 2];

/// Hides `value` from the optimizer. It goes through memory, so the call belongs in front of a loop.
#[simd]
pub(crate) fn hidden<T>(value: T) -> T {
    core::hint::black_box(value)
}

#[simd]
pub(crate) fn load_pairs(from: &Block) -> [RowPair<S>; 4] {
    let mut pairs = [V16::zero(); 4];
    for (pair, from) in pairs.iter_mut().zip(from.0.as_chunks::<16>().0) {
        let [first, second] = Row::load_interleaved(from);
        *pair = first.concat(second);
    }
    pairs
}

#[simd]
pub(crate) fn store_pair(pair: RowPair<S>, to: &mut [i16; 16]) {
    Row::store_interleaved(pair.split(), to)
}

/// Works on half rows, as `weigh` does. On whole rows, the compiler would compute both results again in halves.
#[simd]
pub(crate) fn sum_and_difference(a: RowPair<S>, b: RowPair<S>) -> [RowPair<S>; 2] {
    let ([[a0, a1], [a2, a3]], [[b0, b1], [b2, b3]]) = (quarters(a), quarters(b));
    [
        (a0 + b0).concat(a1 + b1).concat((a2 + b2).concat(a3 + b3)),
        (a0 - b0).concat(a1 - b1).concat((a2 - b2).concat(a3 - b3)),
    ]
}

#[simd]
fn quarters(rows: RowPair<S>) -> [[i16x4<S>; 2]; 2] {
    let [first, second] = rows.split();
    [first.split(), second.split()]
}

#[simd]
pub(crate) fn weigh(
    rows: RowPair<S>,
    first: Weight<S>,
    second: Weight<S>,
    sums: Sums<S>,
) -> Sums<S> {
    let ([a, b], [lower, upper]) = (rows.split(), sums.split());
    let ([a0, a1], [b0, b1]) = (a.split(), b.split());
    (lower + a0.cast_mul(first) + b0.cast_mul(second))
        .concat(upper + a1.cast_mul(first) + b1.cast_mul(second))
}

#[simd]
pub(crate) fn weigh_by(rows: RowPair<S>, first: i16, second: i16) -> Sums<S> {
    if let (8192 | 16384, 0) = (first, second) {
        return rows.widen::<i32>()[0] << first.ilog2();
    }
    if first != 8192 || second.abs() != 8192 {
        return weigh(
            rows,
            Weight::splat(first),
            Weight::splat(second),
            V32::zero(),
        );
    }
    let [a, b] = rows.widen::<i32>();
    (if second > 0 { a + b } else { a - b }) << 13
}

#[simd]
pub(crate) fn round_and_pair_up(first: Sums<S>, second: Sums<S>, shift: u32) -> RowPair<S> {
    first
        .rounding_shr(shift)
        .saturating_narrow(second.rounding_shr(shift))
}

/// `shift` is 16 or more.
#[simd]
pub(crate) fn shift_and_pack(a: V32<S>, b: V32<S>, shift: u32) -> V16<S> {
    let ([a0, a1], [b0, b1]) = (a.cast_unsigned().split(), b.cast_unsigned().split());
    let high = |v: u32x4<S>| (v >> 16).cast::<u16>();
    let [first, second] = [high(a0).concat(high(b0)), high(a1).concat(high(b1))];
    let high = first.concat(second).cast_signed();
    // Or the compiler makes one shift of both, which can't be part of the addition.
    (if shift > 18 { high.black_box() } else { high }) >> (shift - 16)
}

#[simd]
pub(crate) fn pack_rows(first: Sums<S>, second: Sums<S>) -> V16<S> {
    first.saturating_narrow(second)
}

/// Kept in registers, for multiplications by a lane.
#[simd]
pub(crate) struct Weights<const N: usize> {
    /// Each has two columns for 4 samples or, if `forward`, all columns for one.
    vectors: [Row<S>; 8],
    forward: bool,
    /// The coefficients from this row and this column on are zero.
    pub(crate) kept: usize,
}

const fn index_of(forward: bool, sample: usize, k: usize) -> usize {
    if forward {
        (8 * sample + column_of(k)) % 64
    } else {
        sample / 4 * 32 + 4 * column_of(k) + sample % 4
    }
}

const fn table(n: usize, forward: bool) -> [[i16; 8]; 8] {
    let (mut table, mut i) = ([[0; 8]; 8], 0);
    while i < 64 {
        let at = index_of(forward, i / 8, i % 8);
        table[at / 8][at % 8] = weight_of(n, i / 8, i % 8);
        i += 1;
    }
    table
}

/// No pair of vectors lies across a page.
#[repr(align(32))]
struct Tables([[[i16; 8]; 8]; 2]);

#[simd]
impl<const N: usize> Weights<N, S> {
    /// `zero` is 0, but [`hidden`]. With constant weights, the compiler would broadcast each to a register of its own,
    /// before the loop of the caller.
    pub(crate) fn new(forward: bool, zero: usize) -> Self {
        let tables = if forward {
            &const { Tables([table(N, true), [[0; 8]; 8]]) }
        } else {
            &const { Tables([table(N, false), [[0; 8]; 8]]) }
        };
        let table = &tables.0[zero % 2];
        let mut vectors = [Row::zero(); 8];
        for (vector, row) in vectors.iter_mut().zip(table) {
            *vector = Row::from(row);
        }
        Self {
            vectors,
            forward,
            kept: 8,
        }
    }

    /// Four columns fill the first half of a row.
    pub(crate) fn close_up(&self, rows: RowPair<S>) -> RowPair<S> {
        if self.kept > 4 {
            return rows;
        }
        let [kept, _] = rows.bitcast::<i32>().in_blocks().deinterleave(Simd::zero());
        kept.bitcast()
    }

    pub(crate) fn of(&self, sample: usize, k: usize) -> Weight<S> {
        let at = index_of(self.forward, sample, k);
        let vector = self.vectors[at / 8];
        Weight::splat(if weight_of(N, sample, k) == 0 || k >= self.kept {
            0
        } else {
            vector[at % 8]
        })
    }

    fn spread<const PAIR: usize>(&self, first: usize, rows: V16<S>) -> V32<S> {
        let [lower, upper] = self.vectors[first + PAIR].split();
        let one = |row: Row<S>| {
            // A weight that is zero for sample 0 is zero for all.
            let column = |x| {
                if weight_of(N, 0, in_column(x)) == 0 || in_column(x) >= self.kept {
                    0
                } else {
                    row[x - x / 4 * (8 - self.kept) / 2]
                }
            };
            upper.cast_mul::<i32>(column(2 * PAIR + 1)) + lower.cast_mul(column(2 * PAIR))
        };
        let [first, second] = rows.split();
        one(first).concat(one(second))
    }

    pub(crate) fn weigh_columns(&self, first: usize, rows: V16<S>) -> [V32<S>; 2] {
        [
            self.spread::<0>(first, rows) + self.spread::<1>(first, rows),
            self.spread::<2>(first, rows) + self.spread::<3>(first, rows),
        ]
    }

    pub(crate) fn transform_row(&self, samples: [u8; 8]) -> Sums<S> {
        let bytes = u8x8::from(samples);
        let (forward, backward) = (Row::from(bytes), Row::from(bytes.reverse()));
        let (sums, differences) = (forward + backward, forward - backward);
        let (mut even, mut odd) = (i32x4::zero(), i32x4::zero());
        unroll!(for i in 0..4 {
            let [lower, upper] = self.vectors[i].split();
            even += lower.cast_mul(sums[i]);
            odd += upper.cast_mul(differences[i]);
        });
        even.concat(odd)
    }
}

/// Cb or Cr less 128.
#[simd]
pub(crate) type Centered = [i8x16<S>; 2];

#[simd]
fn centered(samples: V8<S>) -> i8x16<S> {
    (samples ^ 128).cast_signed()
}

#[simd]
pub(crate) fn center(samples: &[u8; GROUP]) -> Centered<S> {
    [
        centered(V8::load(samples)),
        centered(V8::load(&samples[16..])),
    ]
}

/// (3 * sample + before + 1) / 4 and (3 * sample + after + 2) / 4
#[simd]
pub(crate) fn upsample([before, sample, after]: HalfGroup<S>) -> Centered<S> {
    let even = centered(sample.midpoint(sample.midpoint_up(before)));
    let odd = centered(sample.midpoint_up(sample.midpoint(after)));
    even.interleave(odd)
}

/// For `upsample2`. With a constant, the compiler would shift and add, which takes twice as many instructions as
/// multiplying.
#[simd]
pub(crate) fn least_weight() -> u8 {
    hidden(1 << 4)
}

/// Scaled by 16, so that the result is the high byte of each sum.
#[simd]
pub(crate) fn upsample2(near: HalfGroup<S>, far: HalfGroup<S>, least_weight: u8) -> Centered<S> {
    let add = |at: usize, [near_weight, far_weight]: [u8; 2], sums: u16x16<S>| {
        sums + near[at].cast_mul(near_weight) + far[at].cast_mul(far_weight)
    };
    // Hidden, or the compiler adds the constant in a step of its own.
    let odd = u16x16::splat((7 << 4) + (128 << 8)) + near[1].cast_mul(9 << 4);
    let odd = odd.black_box() + far[1].cast_mul(3 << 4);
    // Never saturates. The compiler would reassociate a plain addition and copy the sums.
    let even = odd.cast_signed().saturating_add(1 << 4).cast_unsigned();
    let [even, odd] = [
        add(0, [3 << 4, least_weight], even),
        add(2, [3 << 4, least_weight], odd),
    ];
    even.bitcast::<i8>().transpose_pairs(odd.bitcast())[1].split()
}

/// These 16-bit weights give the results of jdcolor.c for all samples.
#[simd]
pub(crate) fn store_rgba(
    luma: &[u8; GROUP],
    cb: Centered<S>,
    cr: Centered<S>,
    out: &mut [u8; 4 * GROUP],
) {
    for i in 0..2 {
        let y = V16::from(V8::load(&luma[16 * i..]));
        let (cb, cr) = (V16::from(cb[i]) << 1, V16::from(cr[i]) << 1);
        let green = (1 << 15) + cb.cast_mul::<i32>(CB_IN_GREEN) + cr.cast_mul(CR_IN_GREEN);
        let r = (y + cr.mul_q15(22971)).saturating_cast();
        let g = (y + (green >> 16).cast::<i16>()).saturating_cast();
        let b = (y + cb.mul_q15(29033)).saturating_cast();
        V8::store_interleaved([r, g, b, V8::splat(255)], &mut out[64 * i..]);
    }
}

#[simd]
fn chroma_sums(halved: V16<S>, other: V16<S>, weight: i16) -> u16x8<S> {
    let sum = halved + (other.mul_q15_relaxed(weight) >> 1);
    (((CHROMA_BIAS >> 8) as u16 - sum.cast_unsigned()) >> 8)
        .cast::<u8>()
        .sum_groups::<u16>()
}

/// Stores the luma. Returns the sums of Cb and of Cr for each pair of pixels.
#[simd]
fn split_row(rgba: &[u8; 4 * STEP], luma: &mut [u8; STEP]) -> [u16x8<S>; 2] {
    let [r, g8, b, _] = V8::load_interleaved(rgba);
    // The weights of R, G and B add up to 1 or to 0, so two differences are enough.
    let g = V16::from(g8);
    let (g_less_r, g_less_b) = ((g - V16::from(r)) << 7, (g - V16::from(b)) << 7);
    let [lower, upper] = (g_less_r.cast_mul::<i32>(-RED_IN_LUMA)
        + g_less_b.cast_mul(-BLUE_IN_LUMA))
    .bitcast::<u16>()
    .split();
    let y = lower.deinterleave(upper)[1];
    (g8 + ((y + ((LUMA_BIAS >> 9) as u16)) >> 7).cast::<u8>()).store(luma);
    // These weights are adjusted, so that the rounding multiplication gives the truncated product.
    [
        chroma_sums(g_less_b, g_less_r, -22116),
        chroma_sums(g_less_r, g_less_b, -10658),
    ]
}

#[simd]
pub(crate) fn split_rows(
    rgba: [&[u8; 4 * STEP]; 2],
    [y0, y1]: [&mut [u8; STEP]; 2],
    cb: &mut [u8; STEP / 2],
    cr: &mut [u8; STEP / 2],
) {
    let (upper, lower) = (split_row(rgba[0], y0), split_row(rgba[1], y1));
    let bias = alternating(1, 2).cast_unsigned();
    ((upper[0] + lower[0] + bias) >> 2).cast::<u8>().store(cb);
    ((upper[1] + lower[1] + bias) >> 2).cast::<u8>().store(cr);
}

/// Whether all is zero from row 4 and from column 4 on, and whether all is but the first.
/// Scalar, because the vector units are the bottleneck. LLVM leaves it so for `u128`.
#[simd]
pub(crate) fn zeros_in(block: &Block) -> [bool; 2] {
    let [a, b, c, d, e, f, g, h] = array::from_fn(|i| {
        u128::from_le_bytes(Row::load(&block.0[8 * i..]).bitcast::<u8>().to_array())
    });
    let (even, odd) = (a & !0xffff | b | c | d, e | f);
    let high = even & !0xffff_0000_ffff | odd >> 64 | g | h;
    [high == 0, even | odd | g | h == 0]
}

/// Of each 8 coefficients in zigzag order, 4 are in the first half of these rows and 4 in the second.
const ROW_ORDER: [usize; 8] = [0, 3, 5, 6, 1, 2, 4, 7];

/// For each half: the positions of its coefficients in zigzag order, then their bits in a byte of the mask.
static HALVES: [u8; 128] = {
    let (mut from_and_bit, mut found, mut k) = ([0; 128], [0; 2], 0);
    while k < 64 {
        let mut nth = 0;
        while ROW_ORDER[nth] != ZIGZAG[k][0] {
            nth += 1;
        }
        let at = nth / 4 * 32 + found[nth / 4];
        found[nth / 4] += 1;
        from_and_bit[at] = (nth % 4 * 8 + ZIGZAG[k][1]) as u8;
        from_and_bit[64 + at] = 1 << (k % 8);
        k += 1;
    }
    from_and_bit
};

#[simd]
fn mask_pairs(first: u8x32<S>, second: u8x32<S>, bits: u8) -> V8<S> {
    let (in_first, in_second) = (u8x32::load(&HALVES[64..]), u8x32::load(&HALVES[96..]));
    let first = (first & bits).simd_ne(0).to_simd();
    let second = (second & bits).simd_ne(0).to_simd();
    let [lower, upper] = (in_first.bit_select(first, second) & (in_first | in_second)).split();
    lower.add_pairs(upper)
}

#[simd]
pub(crate) fn store_masks<const MASKS: usize>(pairs: [RowPair<S>; 4], masks: &mut [u64; MASKS]) {
    let row = |i: usize| {
        let [even, odd] = pairs[ROW_ORDER[i] / 2].split();
        if ROW_ORDER[i] % 2 == 0 { even } else { odd }
    };
    let pack = |i: usize| row(i).saturating_narrow::<i8>(row(i + 1)).cast_unsigned();
    let first = pack(0)
        .concat(pack(2))
        .swizzle_dyn_relaxed(u8x32::load(&HALVES));
    let second = pack(4)
        .concat(pack(6))
        .swizzle_dyn_relaxed(u8x32::load(&HALVES[32..]));
    let [a, b, c, d] = if MASKS == 4 {
        [
            mask_pairs(first, second, 1),
            mask_pairs(first, second, 2),
            mask_pairs(first, second, 4),
            mask_pairs(first, second, 0x80),
        ]
    } else {
        [mask_pairs(first, second, 0xff); 4]
    };
    let all = a
        .add_pairs(b)
        .concat(c.add_pairs(d))
        .bitcast::<u64>()
        .to_array();
    *masks = *all.first_chunk().unwrap_or(masks);
}
