use super::ZIGZAG;
use super::{
    BLUE_IN_LUMA, Block, CB_IN_GREEN, CHROMA_BIAS, CR_IN_GREEN, GROUP, HalfGroup, LUMA_BIAS,
    RED_IN_LUMA,
};
use super::{RowPair, Sums, V16, V32, alternating, in_column, weight_of};
use bun_simd::prelude::*;

#[simd]
type V8 = u8x32<S>;
/// How many pixels `split_rows` takes.
pub(crate) const STEP: usize = 32;
pub(crate) const HALF_ROW_STARTS: [usize; 3] = [0, 8, 8];
const ZERO: u8 = 0x80;
/// A register holds 64 bytes, which one instruction puts in any order.
#[simd]
pub(crate) const WIDE: bool = has!(icelake);

#[simd]
fn shuffle<W: Width>(bytes: Simd<u8, W, S>, from: [u8; 16]) -> Simd<u8, W, S> {
    bytes.in_blocks().lookup_bytes(Simd::repeat(&from))
}

#[simd]
pub(crate) fn hidden<T>(value: T) -> T {
    value
}

#[simd]
pub(crate) fn load_pairs(from: &Block) -> [RowPair<S>; 4] {
    [
        V16::load(&from.0),
        V16::load(&from.0[16..]),
        V16::load(&from.0[32..]),
        V16::load(&from.0[48..]),
    ]
}

#[simd]
pub(crate) fn store_pair(pair: RowPair<S>, to: &mut [i16; 16]) {
    pair.store(to)
}

#[simd]
pub(crate) fn sum_and_difference(a: RowPair<S>, b: RowPair<S>) -> [RowPair<S>; 2] {
    [a + b, a - b]
}

/// The sums have to fit.
#[simd]
pub(crate) fn weigh<W: Width>(
    rows: Simd<i16, W, S>,
    first: i16,
    second: i16,
    sums: Simd<i32, W, S>,
) -> Simd<i32, W, S> {
    rows.dot_add_relaxed::<i32>(alternating(first, second), sums)
}

#[simd]
pub(crate) fn weigh_by<W: Width>(
    rows: Simd<i16, W, S>,
    first: i16,
    second: i16,
) -> Simd<i32, W, S> {
    rows.dot(alternating(first, second))
}

/// The sums have to fit in 16 bits after the shift.
#[simd]
pub(crate) fn round_and_pair_up<W: Width>(
    first: Simd<i32, W, S>,
    second: Simd<i32, W, S>,
    shift: u32,
) -> Simd<i16, W, S> {
    let half = 1 << (shift - 1);
    ((first + half) >> shift)
        .bitcast()
        .alternate(((second + half) << (16 - shift)).bitcast())
}

#[simd]
pub(crate) fn shift_and_pack<W: Width>(
    a: Simd<i32, W, S>,
    b: Simd<i32, W, S>,
    shift: u32,
) -> Simd<i16, W, S> {
    (a >> shift).in_blocks().saturating_narrow(b >> shift)
}

/// For `weigh_columns`: the first 4 columns of both, then the others.
#[simd]
pub(crate) fn pack_rows(first: Sums<S>, second: Sums<S>) -> V16<S> {
    first.in_blocks().saturating_narrow(second)
}

#[simd]
pub(crate) struct Weights<const N: usize> {
    /// The coefficients from this row and this column on are zero.
    pub(crate) kept: usize,
    target: core::marker::PhantomData<S>,
}

#[simd]
impl<const N: usize> Weights<N, S> {
    pub(crate) fn new(_forward: bool, _zero: usize) -> Self {
        Self {
            kept: 8,
            target: core::marker::PhantomData,
        }
    }

    pub(crate) fn close_up(&self, rows: RowPair<S>) -> RowPair<S> {
        rows
    }

    /// The weight of coefficient `k` in `sample`, for `weigh`.
    pub(crate) fn of(&self, sample: usize, k: usize) -> i16 {
        weight_of(N, sample, k) * i16::from(k < self.kept)
    }

    /// What two columns of one of `rows` add to the 4 samples from `i` on, and then what the two do that are 4 further.
    fn spread<const LANE: usize>(&self, i: usize, rows: V16<S>) -> V32<S> {
        if LANE % 2 * 4 >= self.kept {
            return V32::zero();
        }
        let weights = const {
            let (mut weights, mut j) = ([[0; 16]; 2], 0);
            while j < 32 {
                let (sample, x) = (j / 16 * 4 + j / 2 % 4, j / 8 % 2 * 4 + LANE % 2 * 2 + j % 2);
                weights[j / 16][j % 16] = weight_of(N, sample, in_column(x));
                j += 1;
            }
            weights
        };
        let pair = rows.bitcast::<i32>().in_blocks().splat_lane::<LANE>();
        pair.bitcast::<i16>().dot(weights[i / 4])
    }

    /// What the even and what the odd coefficients add to the 4 samples from `i` on, with a row in each block.
    pub(crate) fn weigh_columns(&self, i: usize, rows: V16<S>) -> [V32<S>; 2] {
        let first = self.spread::<0>(i, rows) + self.spread::<1>(i, rows);
        let second = self.spread::<2>(i, rows) + self.spread::<3>(i, rows);
        first.as_u128s().interleave(second)
    }

    pub(crate) fn transform_row(&self, samples: [u8; 8]) -> Sums<S> {
        transform_rows_in(V8::repeat(&samples))
    }
}

/// The DCT of the 8 samples that each 32 bytes repeat: even coefficients from the sums of mirrored samples, odd ones from
/// their differences.
#[simd]
pub(crate) fn transform_rows_in<W: Width>(bytes: Simd<u8, W, S>) -> Simd<i32, W, S> {
    let weights = |first| Simd::from_fn(|i| weight_of(8, first + i % 2, in_column(i / 2 % 8)));
    let signs = Simd::from_fn(|i| if i & 17 == 17 { -1i8 } else { 1 });
    let outer = shuffle(bytes, [0, 7, 1, 6, 0, 7, 1, 6, 0, 7, 1, 6, 0, 7, 1, 6]);
    let inner = shuffle(bytes, [2, 5, 3, 4, 2, 5, 3, 4, 2, 5, 3, 4, 2, 5, 3, 4]);
    let sums = outer.saturating_dot::<i16>(signs).dot::<i32>(weights(0));
    inner
        .saturating_dot::<i16>(signs)
        .dot_add_relaxed::<i32>(weights(2), sums)
}

/// A group, in the order in which `store_rgba` has the least to do.
#[simd]
type Widened = i16x32<S>;
/// Cb or Cr less 128.
#[simd]
pub(crate) type Centered = Widened<S>;

/// Which of the group is in a lane, if one register holds it. Else the first 8 of each 16 come first.
const fn pixel_in(lane: usize) -> usize {
    lane / 4 % 2 * 16 + lane / 8 * 4 + lane % 4
}

#[simd]
fn widen(samples: &[u8; GROUP]) -> Widened<S> {
    if const { S::WIDE } {
        let padded = V8::from(samples).concat(V8::zero());
        return padded
            .swizzle(|i| [pixel_in(i / 2), GROUP][i % 2])
            .bitcast();
    }
    let [lower, upper] = V8::from(samples).in_blocks().widen::<i16>();
    lower.concat(upper)
}

#[simd]
fn green_offset(cb: Widened<S>, cr: Widened<S>) -> Widened<S> {
    let [lower, upper] = array::map(cb.in_blocks().interleave(cr), |both| {
        weigh(both, CB_IN_GREEN, CR_IN_GREEN, Simd::splat(1 << 14))
    });
    shift_and_pack(lower, upper, 15)
}

/// `weight` is from 1 to 2, scaled by 2^14.
#[simd]
fn red_or_blue(y: Widened<S>, chroma: Widened<S>, weight: i32) -> Widened<S> {
    y + chroma + chroma.mul_q15_relaxed((2 * weight - 32768) as i16)
}

/// For each sample from the second on: `weight * (3 * sample + before)`, then `weight * (3 * sample + after)`.
#[simd]
fn blend_across(row: HalfGroup<S>, weight: i8) -> Widened<S> {
    let bytes = row[0].concat(row[1]);
    let neighbors = if const { S::WIDE } {
        let sample = |i| pixel_in(i / 2).div_ceil(2) + i % 2;
        bytes
            .resize::<B64>()
            .swizzle(|i| sample(i) + sample(i) / 16 * 8)
    } else {
        shuffle(bytes, [0, 1, 1, 2, 1, 2, 2, 3, 2, 3, 3, 4, 3, 4, 4, 5]).concat(shuffle(
            bytes,
            [4, 5, 5, 6, 5, 6, 6, 7, 6, 7, 7, 8, 7, 8, 8, 9],
        ))
    };
    neighbors.saturating_dot(i8x64::repeat(&[weight, 3 * weight, 3 * weight, weight]))
}

#[simd]
pub(crate) fn center(samples: &[u8; GROUP]) -> Widened<S> {
    widen(samples) - 128
}

#[simd]
pub(crate) fn upsample(row: HalfGroup<S>) -> Widened<S> {
    (blend_across(row, 1) + alternating(1 - (128 << 2), 2 - (128 << 2))) >> 2
}

#[simd]
pub(crate) fn least_weight() -> i8 {
    1
}

#[simd]
pub(crate) fn upsample2(near: HalfGroup<S>, far: HalfGroup<S>, least_weight: i8) -> Widened<S> {
    let sums = blend_across(near, 3) + blend_across(far, least_weight);
    (sums + alternating(8 - (128 << 4), 7 - (128 << 4))) >> 4
}

/// These 16-bit weights give the results of jdcolor.c for all samples.
#[simd]
pub(crate) fn store_rgba(
    luma: &[u8; GROUP],
    cb: Widened<S>,
    cr: Widened<S>,
    out: &mut [u8; 4 * GROUP],
) {
    let y = widen(luma);
    let rgb = [
        red_or_blue(y, cr, 22971),
        y + green_offset(cb, cr),
        red_or_blue(y, cb, 29033),
    ];
    if const { S::WIDE } {
        let pack = |a: Widened<S>, b| a.in_blocks().saturating_narrow::<u8>(b);
        let [rg, ba] = pack(rgb[0], rgb[2])
            .in_blocks()
            .interleave(pack(rgb[1], Simd::splat(255)));
        let [first, second] = rg.bitcast::<u16>().in_blocks().interleave(ba.bitcast());
        return first.concat(second).store_bytes(out);
    }
    let [r, g, b] = array::map(rgb, |it| {
        it.split()[0].in_blocks().saturating_narrow(it.split()[1])
    });
    V8::store_interleaved([r, g, b, V8::splat(255)], out);
}

/// Returns the luma times 2^16, and adds Cb and Cr, 16 bits each, to `chroma`.
#[simd]
pub(crate) fn split<W: Width>(
    pixels: Simd<u8, W, S>,
    chroma: &mut Simd<i16, W, S>,
) -> Simd<i32, W, S> {
    let rb = pixels.widen_even::<i16>();
    let gg = shuffle(pixels, array::from_fn(|i| [i as u8 & !3 | 1, ZERO][i % 2])).bitcast();
    // 38470 and 32768 do not fit in 16 bits, so the first is split in halves and the second negated.
    let y = weigh(gg, 19235, 19235, Simd::splat(LUMA_BIAS));
    let cb = CHROMA_BIAS - weigh(rb, 11059, -32768, weigh_by(gg, 21709, 0));
    let cr = CHROMA_BIAS - weigh(rb, -32768, 5329, weigh_by(gg, 27439, 0));
    *chroma += cb.bitcast().transpose_pairs(cr.bitcast())[1];
    weigh(rb, RED_IN_LUMA, BLUE_IN_LUMA, y)
}

/// Undoes the interleaving of blocks that packing 4 vectors of 32-bit lanes causes.
#[simd]
fn in_vector_order(packed: V8<S>) -> V8<S> {
    let v = packed.bitcast::<u32>();
    v.interleave(v.as_u128s().swap_pairs())[0].bitcast()
}

#[simd]
fn split_row(rgba: &[u8; 4 * STEP], luma: &mut [u8; STEP], chroma: &mut [V16<S>; 4]) {
    let y: [_; 4] = array::from_fn(|i| split(V8::load(&rgba[i * 32..]), &mut chroma[i]) >> 16);
    let (lower, upper) = (
        y[0].in_blocks().saturating_narrow::<i16>(y[1]),
        y[2].in_blocks().saturating_narrow(y[3]),
    );
    in_vector_order(lower.in_blocks().saturating_narrow(upper)).store(luma);
}

#[simd]
pub(crate) fn split_rows(
    rgba: [&[u8; 4 * STEP]; 2],
    [y0, y1]: [&mut [u8; STEP]; 2],
    cb: &mut [u8; STEP / 2],
    cr: &mut [u8; STEP / 2],
) {
    if const { S::WIDE } {
        return super::wide::split_rows(rgba, [y0, y1], cb, cr);
    }
    let mut chroma = [V16::zero(); 4];
    split_row(rgba[0], y0, &mut chroma);
    split_row(rgba[1], y1, &mut chroma);
    let bias = V16::repeat(&[1, 1, 2, 2]);
    let lower = (chroma[0]
        .bitcast::<i32>()
        .in_blocks()
        .add_pairs(chroma[1].bitcast())
        .bitcast()
        + bias)
        >> 2;
    let upper = (chroma[2]
        .bitcast::<i32>()
        .in_blocks()
        .add_pairs(chroma[3].bitcast())
        .bitcast()
        + bias)
        >> 2;
    let both = in_vector_order(lower.in_blocks().saturating_narrow(upper));
    let [even, odd] = both.deinterleave(both);
    even.split()[0].store(cb);
    odd.split()[0].store(cr);
}

/// For each 16 of the 64 bytes that a block is packed to: the shuffle that takes its coefficients to zigzag order.
static ZIGZAG_FROM: [[u8; 64]; 4] = {
    let (mut from, mut k) = ([[ZERO; 64]; 4], 0);
    while k < 64 {
        let [row, column] = ZIGZAG[k];
        from[row / 2][k] = (2 * column + row % 2) as u8;
        k += 1;
    }
    from
};

/// One mask of the nonzero lanes or, for four, one each for bits 0, 1 and 2 and the sign.
#[simd]
pub(crate) fn store_masks<const MASKS: usize>(pairs: [RowPair<S>; 4], masks: &mut [u64; MASKS]) {
    let first = pairs[0]
        .in_blocks()
        .saturating_narrow::<i8>(pairs[1])
        .bitcast::<u64>();
    let second = pairs[2]
        .in_blocks()
        .saturating_narrow::<i8>(pairs[3])
        .bitcast::<u64>();
    // Each pair in both blocks.
    let ([a, b], [c, d]) = (first.deinterleave(first), second.deinterleave(second));
    let packed = [a, b, c, d];
    let mut found = [0; 4];
    for at in [0, 32] {
        let mut zigzag = i8x32::zero();
        for pair in 0..4 {
            zigzag |= packed[pair]
                .in_blocks()
                .lookup_bytes(V8::load(&ZIGZAG_FROM[pair][at..]))
                .bitcast();
        }
        if MASKS == 4 {
            found[0] |= zigzag.all_bits(1).to_bitmask() << at;
            found[1] |= zigzag.all_bits(2).to_bitmask() << at;
            found[2] |= zigzag.all_bits(4).to_bitmask() << at;
            found[3] |= zigzag.is_negative().to_bitmask() << at;
        } else {
            found[0] |= zigzag.simd_ne(0).to_bitmask() << at;
        }
    }
    *masks = *found.first_chunk().unwrap_or(masks);
}

/// Whether all is zero from row 4 and from column 4 on, and whether all is but the first.
#[simd]
pub(crate) fn zeros_in(block: &Block) -> [bool; 2] {
    let [a, b, c, d] = load_pairs(block);
    let even = a.with_lane::<0>(0) | b;
    let in_even = even & V16::repeat(&[0, -1, 0, -1, -1, -1, -1, -1]);
    let high = in_even | c & V16::repeat(&[0, 0, 0, 0, -1, -1, -1, -1]) | d;
    [high == 0, even | c | d == 0]
}
