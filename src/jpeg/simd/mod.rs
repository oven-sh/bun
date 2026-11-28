//! The transforms and color conversions, in the arithmetic of libjpeg-turbo (LICENSE.md). All targets give the same bytes.
//!
//! A kernel returns `None` if its slices are too short.

use bun_simd::prelude::*;

#[cfg_attr(target_arch = "aarch64", path = "neon.rs")]
#[cfg_attr(not(target_arch = "aarch64"), path = "x86.rs")]
mod arch;
#[cfg(not(target_arch = "aarch64"))]
mod wide;
use arch::*;

/// 8 by 8 coefficients: rows 0 and 4 interleaved, then 2 and 6, 1 and 3, 5 and 7. Columns go 0 2 4 6 1 3 5 7.
#[derive(Clone, Copy, PartialEq, Debug)]
#[repr(C, align(64))]
pub(crate) struct Block(pub(crate) [i16; 64]);

/// The Cb and Cr of a row of pixels.
#[derive(Clone, Copy)]
pub(crate) enum Chroma<'a> {
    Full {
        cb: &'a [u8],
        cr: &'a [u8],
    },
    /// One sample for two pixels. The rows start one sample early, with the left neighbor of the first, and have 8 in all to spare.
    HalfWidth {
        cb: &'a [u8],
        cr: &'a [u8],
    },
    /// One sample for 2 by 2 pixels: the nearest row of samples, then the next nearest. They start early too.
    HalfSize {
        cb: [&'a [u8]; 2],
        cr: [&'a [u8]; 2],
    },
}

/// The color kernels read and write whole groups of this many pixels.
pub(crate) const GROUP: usize = 32;
/// From each of `HALF_ROW_STARTS` on.
#[simd]
type HalfGroup = [u8x16<S>; 3];

#[simd]
type V16 = i16x16<S>;
#[simd]
type V32 = i32x8<S>;
/// One row of 8 sums of products.
#[simd]
type Sums = V32<S>;
/// Two rows of 8. x64 multiplies and adds neighboring lanes, so there they are interleaved.
#[simd]
type RowPair = V16<S>;

/// jidctint.c and jidctred.c, multiplied out: the weight of coefficient `k` in `sample` of `n` and, negated if `k` is
/// odd, in `n - 1 - sample`. Scaled by 2^(13 + extra_bits).
const fn weight_of(n: usize, sample: usize, k: usize) -> i16 {
    let basis: &[[i16; 8]] = match n {
        // The first weight is halved: 32768 does not fit in 16 bits.
        2 => &[[16384, 29692, 0, -10426, 0, 6967, 0, -5906]],
        3 => &[
            [8192, 10033, 5793, 0, 0, 0, 0, 0],
            [8192, 0, -11586, 0, 0, 0, 0, 0],
        ],
        4 => &[
            [16384, 20995, 15137, 7373, 0, -4926, -6270, -4176],
            [16384, 8697, -15137, -17799, 0, 11893, 6270, -1730],
        ],
        5 => &[
            [8192, 11019, 9372, 6810, 3580, 0, 0, 0],
            [8192, 6810, -3580, -11018, -9372, 0, 0, 0],
            [8192, 0, -11584, 0, 11584, 0, 0, 0],
        ],
        6 => &[
            [8192, 11190, 10033, 8192, 5793, 2998, 0, 0],
            [8192, 8192, 0, -8192, -11586, -8192, 0, 0],
            [8192, 2998, -10033, -8192, 5793, 11190, 0, 0],
        ],
        7 => &[
            [8192, 11295, 10438, 9058, 7223, 5027, 2578, 0],
            [8192, 9058, 2578, -5027, -10438, -11295, -7223, 0],
            [8192, 5027, -7223, -11295, -2578, 9058, 10438, 0],
            [8192, 0, -11585, 0, 11585, 0, -11585, 0],
        ],
        8 => &[
            [8192, 11363, 10703, 9633, 8192, 6437, 4433, 2260],
            [8192, 9633, 4433, -2259, -8192, -11362, -10704, -6436],
            [8192, 6437, -4433, -11362, -8192, 2261, 10704, 9633],
            [8192, 2260, -10703, -6436, 8192, 9633, -4433, -11363],
        ],
        10 => &[
            [8192, 11443, 11019, 10322, 9373, 8192, 6810, 5260],
            [8192, 10323, 6810, 1812, -3580, -8192, -11018, -11442],
            [8192, 8192, 0, -8192, -11586, -8192, 0, 8192],
            [8192, 5260, -6810, -11442, -3580, 8192, 11018, 1812],
            [8192, 1812, -11019, -5260, 9373, 8192, -6810, -10322],
        ],
        12 => &[
            [8192, 11487, 11190, 10703, 10033, 9192, 8192, 7053],
            [8192, 10703, 8192, 4433, 0, -4433, -8192, -10703],
            [8192, 9192, 2998, -4433, -10033, -11485, -8192, -1512],
            [8192, 7053, -2998, -10703, -10033, -1512, 8192, 11486],
            [8192, 4433, -8192, -10704, 0, 10704, 8192, -4433],
            [8192, 1513, -11190, -4433, 10033, 7053, -8192, -9191],
        ],
        _ => &[
            [8192, 11513, 11295, 10935, 10438, 9810, 9058, 8192],
            [8192, 10935, 9058, 6164, 2578, -1297, -5026, -8192],
            [8192, 9810, 5027, -1297, -7223, -10934, -11295, -8192],
            [8192, 8192, 0, -8192, -11586, -8192, 0, 8192],
            [8192, 6164, -5027, -11512, -7223, 3826, 11295, 8192],
            [8192, 3826, -9058, -9809, 2578, 11512, 5026, -8192],
            [8192, 1297, -11295, -3826, 10438, 6164, -9058, -8192],
        ],
    };
    if sample < basis.len() {
        basis[sample][k]
    } else {
        0
    }
}
const fn extra_bits(n: usize) -> u32 {
    (n == 2) as u32 * 2 + (n == 4) as u32
}
/// The coefficient of a row that is stored in column `x` of a block, and the inverse.
const fn in_column(x: usize) -> usize {
    x % 4 * 2 + x / 4
}
const fn column_of(k: usize) -> usize {
    k % 2 * 4 + k / 2
}

// Scaled by 2^16 (jccolor.c) and by 2^15 (jdcolor.c).
const RED_IN_LUMA: i16 = 19595;
const BLUE_IN_LUMA: i16 = 7471;
const CB_IN_GREEN: i16 = -11277;
const CR_IN_GREEN: i16 = -23401;
// Added to the weighted R, G and B before the low 16 bits are dropped.
const LUMA_BIAS: i32 = 32768;
const CHROMA_BIAS: i32 = (128 << 16) + 32767;
/// Subtracting 128 from each sample only changes coefficient 0.
const CENTERING: i32 = -((64 * 128) << 15);

/// For each coefficient in zigzag order: the storage position of its row and of its column.
const ZIGZAG: [[usize; 2]; 64] = {
    let nth_row = [0, 4, 2, 5, 1, 6, 3, 7];
    let (mut places, mut k, mut n) = ([[0; 2]; 64], 0, 0);
    while n < 15 * 15 {
        let (diagonal, i) = (n / 15, n % 15);
        if i <= diagonal {
            let row = if diagonal % 2 == 0 { diagonal - i } else { i };
            let column = diagonal - row;
            if row < 8 && column < 8 {
                places[k] = [nth_row[row], column_of(column)];
                k += 1;
            }
        }
        n += 1;
    }
    places
};

/// `first` in column 0 and `rest` in the others.
#[simd]
fn bias(first: i32, rest: i32) -> Sums<S> {
    i32x8::splat(rest).with_lane::<0>(first)
}

#[simd]
fn alternating<W: Width>(even: i16, odd: i16) -> Simd<i16, W, S> {
    Simd::splat(even).alternate(Simd::splat(odd))
}

/// Adds what rows 2 and 6 contribute to row `y`. Where that negates an earlier row's, the products are shared.
#[simd]
fn add_rows_26<const N: usize>(
    sums: Sums<S>,
    rows: RowPair<S>,
    weights: &Weights<N, S>,
    y: usize,
) -> Sums<S> {
    let other = N.div_ceil(2) - 1 - y;
    if other < y
        && weight_of(N, other, 2) == -weight_of(N, y, 2)
        && weight_of(N, other, 6) == -weight_of(N, y, 6)
    {
        return sums
            - weigh(
                rows,
                weights.of(other, 2),
                weights.of(other, 6),
                i32x8::zero(),
            );
    }
    weigh(rows, weights.of(y, 2), weights.of(y, 6), i32x8::zero()) + sums
}

/// In each block: 4 samples from `first` on, then those that mirror them.
#[simd]
fn inverse_rows<const N: usize>(weights: &Weights<N, S>, first: usize, rows: V16<S>) -> V16<S> {
    let [mut even, odd] = weights.weigh_columns(first, rows);
    if N == 2 {
        even += even;
    }
    shift_and_pack(even + odd, even - odd, 18 + extra_bits(N))
}

/// Orders two results of `inverse_rows`: two rows, or the outer and the inner samples of one.
#[simd]
fn left_to_right<const N: usize, W: Width>(
    first: Simd<i16, W, S>,
    second: Simd<i16, W, S>,
) -> Simd<u8, W, S> {
    let from = const {
        let (mut from, mut i) = ([0x80; 16], 0);
        while i < 16 {
            let x = i % if N <= 8 { 8 } else { 16 };
            if x < N {
                let (nearer, mirrored) = if 2 * x < N { (x, 0) } else { (N - 1 - x, 4) };
                from[i] = (i - x + nearer / 4 * 8 + nearer % 4 + mirrored) as u8;
            }
            i += 1;
        }
        from
    };
    first
        .in_blocks()
        .saturating_narrow::<u8>(second)
        .in_blocks()
        .lookup_bytes(Simd::repeat(&from))
}

/// For block `i`.
#[simd]
fn put<const N: usize, W: Width>(samples: Simd<u8, W, S>, row: &mut [u8], i: usize) -> Option<()> {
    let x = i.wrapping_mul(N);
    samples.store(row.get_mut(x..x.wrapping_add(W::BYTES))?);
    Some(())
}

/// The first `len` of `N` rows that are `stride` apart. With rows of the same length, one bounds check is enough for all.
#[simd]
fn rows_mut<const N: usize>(
    mut from: &mut [u8],
    stride: usize,
    len: usize,
) -> Option<[&mut [u8]; N]> {
    let mut rows = [(); N].map(|()| Default::default());
    unroll!(for y in 0..N {
        let len_left = from.len();
        let row = from.split_off_mut(..if y + 1 < N { stride } else { len_left })?;
        rows[y] = row.get_mut(..len)?;
    });
    Some(rows)
}

#[simd]
fn inverse_block<const N: usize>(
    block: &Block,
    steps: [RowPair<S>; 4],
    bias: Sums<S>,
    weights: &Weights<N, S>,
    out: &mut [&mut [u8]; N],
    i: usize,
) -> Option<()> {
    let (half, shift) = (N.div_ceil(2), 11 + extra_bits(N));
    let mut from = load_pairs(block);
    for (pair, step) in from.iter_mut().zip(steps) {
        *pair = weights.close_up(*pair * step);
    }
    // Row `y`, then row `N - 1 - y`, for each `y`.
    let mut rows = [steps[0]; 7];
    unroll!(for y in 0..7 {
        if const { y < N.div_ceil(2) } {
            let rows_04 = weigh_by(
                from[0],
                weight_of(N, y, 0),
                weight_of(N, y, 4) * i16::from(weights.kept > 4),
            );
            let mut even = add_rows_26(bias + rows_04, from[1], weights, y);
            if N == 2 {
                even += rows_04;
            }
            let odd = weigh(from[2], weights.of(y, 1), weights.of(y, 3), i32x8::zero());
            let odd = weigh(from[3], weights.of(y, 5), weights.of(y, 7), odd);
            rows[y] = pack_rows((even + odd) >> shift, (even - odd) >> shift);
        }
    });
    if const { N <= 8 && Native::<S>::BYTES == 16 } {
        unroll!(for y in 0..7 {
            if const { y < N.div_ceil(2) } {
                let [upper, lower] = inverse_rows(weights, 0, rows[y]).split();
                let [upper, lower] = left_to_right::<N, _, S>(upper, lower).split();
                put::<N, _, S>(upper, out[y], i)?;
                put::<N, _, S>(lower, out[N - 1 - y], i)?;
            }
        });
    } else if const { N <= 8 } {
        unroll!(for y in 0..4 {
            if const { y % 2 == 0 && y < N.div_ceil(2) } {
                let next = (y + 1).min(half - 1);
                let bytes = left_to_right::<N, _, S>(
                    inverse_rows(weights, 0, rows[y]),
                    inverse_rows(weights, 0, rows[next]),
                );
                let [upper, lower] = bytes.split();
                put::<N, _, S>(upper.split()[0], out[y], i)?;
                put::<N, _, S>(upper.split()[1], out[next], i)?;
                put::<N, _, S>(lower.split()[0], out[N - 1 - y], i)?;
                put::<N, _, S>(lower.split()[1], out[N - 1 - next], i)?;
            }
        });
    } else {
        unroll!(for y in 0..7 {
            if const { y < N.div_ceil(2) } {
                let bytes = left_to_right::<N, _, S>(
                    inverse_rows(weights, 0, rows[y]),
                    inverse_rows(weights, 4, rows[y]),
                );
                put::<N, _, S>(bytes.split()[0], out[y], i)?;
                put::<N, _, S>(bytes.split()[1], out[N - 1 - y], i)?;
            }
        });
    }
    Some(())
}

#[simd]
fn inverse<const N: usize>(
    blocks: &[Block],
    quant: &Block,
    out: &mut [u8],
    stride: usize,
) -> Option<()> {
    let shift = 11 + extra_bits(N);
    let (step, steps) = (i16x8::load(&quant.0), load_pairs(quant));
    // Through the weight of column 0 in the second pass, 16 rounds the result and 4096 adds 128.
    let bias = bias(
        ((4096 + 16) << shift) + (1 << (shift - 1)),
        1 << (shift - 1),
    );
    let mut out = rows_mut::<N, S>(
        out,
        stride,
        blocks.len() * N + if N <= 8 { 8 } else { 16 } - N,
    )?;

    // On arm64, a second load is faster than moves of what `zeros_in` has loaded.
    let (again, mask) = hidden((blocks, 0));

    let again = again.get(..blocks.len())?;
    for i in 0..blocks.len() {
        let (block, again) = (&blocks[i], &again[i]);
        let [is_smooth, is_flat] = zeros_in(block);
        // For small sizes the check costs as much as the transform.
        if N > 4 && is_flat {
            let mean = ((step * block.0[0]).saturating_add(4) >> 3) + 128;
            let row = mean.saturating_narrow::<u8>(mean).splat_lane::<0>();
            unroll!(for y in 0..N {
                if const { N <= 8 } {
                    put::<N, _, S>(row.split()[0], out[y], i)?
                } else {
                    put::<N, _, S>(row, out[y], i)?
                }
            });
            continue;
        }
        #[cfg(not(target_arch = "aarch64"))]
        if let Some(rows) = wide::inverse::<N, S>(block, quant, bias) {
            unroll!(for y in 0..4 {
                if const { y < N.div_ceil(2) } {
                    put::<N, _, S>(rows[y][0], out[y], i)?;
                    put::<N, _, S>(rows[y][1], out[N - 1 - y], i)?;
                }
            });
            continue;
        }
        let mut weights = Weights::<N, S>::new(false, i & mask);
        if N >= 8 && is_smooth {
            weights.kept = 4;
            inverse_block(again, steps, bias, &weights, &mut out, i)?;
            continue;
        }
        inverse_block(again, steps, bias, &weights, &mut out, i)?;
    }
    Some(())
}

#[simd]
macro_rules! for_sizes {
    ($name:ident($($targets:tt)*) $($n:literal)*) => {
        #[kernel($($targets)*)]
        #[inline(never)]
        fn $name(blocks: &[Block], quant: &Block, size: usize, out: &mut [u8], stride: usize) -> Option<()> {
            match size { $($n => inverse::<$n, S>(blocks, quant, out, stride),)* _ => None }
        }
    };
}
for_sizes!(inverse_usual(default) 3 4 5 6 7 8);
for_sizes!(inverse_other(Upto<B32>) 2 10 12 14);

/// Writes `size` by `size` samples for each of `blocks`, side by side, and 8 or 16 bytes of each row for the last.
/// `size` is 2 to 8, 10, 12 or 14.
#[inline(always)]
pub(crate) fn inverse_transform(
    blocks: &[Block],
    quant: &Block,
    size: usize,
    out: &mut [u8],
    stride: usize,
) -> Option<()> {
    match size {
        3..=8 => inverse_usual(blocks, quant, size, out, stride),
        _ => inverse_other(blocks, quant, size, out, stride),
    }
}

#[simd]
fn groups(row: &[u8], count: usize) -> Option<&[[u8; GROUP]]> {
    Some(row.get(..count * GROUP)?.as_chunks().0)
}

/// The samples for each group, with their neighbors. With slices of one length, no bounds checks are left.
struct HalfRow<'a>([&'a [[u8; GROUP / 2]]; 3]);

#[simd]
impl<'a> HalfRow<'a> {
    fn new(row: &'a [u8], groups: usize) -> Option<Self> {
        let len = groups * (GROUP / 2);
        let row = row.get(..len + HALF_ROW_STARTS[2])?;
        let from = |i: usize| row[HALF_ROW_STARTS[i]..][..len].as_chunks().0;
        Some(Self([from(0), from(1), from(2)]))
    }
    fn at(&self, group: usize) -> HalfGroup<S> {
        let load = |i: usize| u8x16::from(self.0[i][group]);
        [load(0), load(1), load(2)]
    }
}

#[simd]
fn push_rgba(y: &[u8; GROUP], cb: Centered<S>, cr: Centered<S>, out: &mut Output<'_, [u8; 4]>) {
    let mut pixels = [0; 4 * GROUP];
    store_rgba(y, cb, cr, &mut pixels);
    out.push(pixels.as_chunks().0);
}

#[simd]
fn append_groups(
    y: &[u8],
    width: usize,
    out: &mut Vec<[u8; 4]>,
    convert: impl FnOnce(&[[u8; GROUP]], &mut Output<'_, [u8; 4]>) -> Option<()>,
) -> Option<()> {
    let y = groups(y, width.checked_add(GROUP - 1)? / GROUP)?;
    let room = y.len() * GROUP;
    if out.capacity() - out.len() < room {
        return None;
    }
    let out = &mut Output::append(out, room);
    let done = convert(y, out);
    out.truncate(width);
    done
}

#[kernel]
#[inline(never)]
fn ycc444_to_rgba(
    y: &[u8],
    cb: &[u8],
    cr: &[u8],
    width: usize,
    out: &mut Vec<[u8; 4]>,
) -> Option<()> {
    append_groups(y, width, out, |y, out| {
        let (cb, cr) = (groups(cb, y.len())?, groups(cr, y.len())?);
        for i in 0..y.len() {
            push_rgba(&y[i], center(&cb[i]), center(&cr[i]), out);
        }
        Some(())
    })
}

#[kernel]
#[inline(never)]
fn ycc422_to_rgba(
    y: &[u8],
    cb: &[u8],
    cr: &[u8],
    width: usize,
    out: &mut Vec<[u8; 4]>,
) -> Option<()> {
    append_groups(y, width, out, |y, out| {
        let (cb, cr) = (HalfRow::new(cb, y.len())?, HalfRow::new(cr, y.len())?);
        for i in 0..y.len() {
            push_rgba(&y[i], upsample(cb.at(i)), upsample(cr.at(i)), out);
        }
        Some(())
    })
}

#[kernel]
#[inline(never)]
fn ycc420_to_rgba(
    y: &[u8],
    cb_near: &[u8],
    cb_far: &[u8],
    cr_near: &[u8],
    cr_far: &[u8],
    width: usize,
    out: &mut Vec<[u8; 4]>,
) -> Option<()> {
    append_groups(y, width, out, |y, out| {
        let count = y.len();
        let (cb_near, cb_far) = (HalfRow::new(cb_near, count)?, HalfRow::new(cb_far, count)?);
        let (cr_near, cr_far) = (HalfRow::new(cr_near, count)?, HalfRow::new(cr_far, count)?);
        let weight = least_weight();
        for i in 0..count {
            let (cb, cr) = (
                upsample2(cb_near.at(i), cb_far.at(i), weight),
                upsample2(cr_near.at(i), cr_far.at(i), weight),
            );
            push_rgba(&y[i], cb, cr, out);
        }
        Some(())
    })
}

/// Appends `width` pixels to `out`. Its spare capacity and all rows have to cover whole groups.
#[inline(always)]
pub(crate) fn ycc_to_rgba(
    y: &[u8],
    chroma: &Chroma<'_>,
    width: usize,
    out: &mut Vec<[u8; 4]>,
) -> Option<()> {
    match *chroma {
        Chroma::Full { cb, cr } => ycc444_to_rgba(y, cb, cr, width, out),
        Chroma::HalfWidth { cb, cr } => ycc422_to_rgba(y, cb, cr, width, out),
        Chroma::HalfSize { cb, cr } => ycc420_to_rgba(y, cb[0], cb[1], cr[0], cr[1], width, out),
    }
}

/// A sample of `cb` and `cr` is the average of 2 by 2 pixels. The rows of `y` are twice `chroma_stride` apart.
#[kernel]
#[inline(never)]
pub(crate) fn rgba_to_ycc420(
    rgba: &[[u8; 4]],
    rgba_stride: usize,
    groups: usize,
    row_pairs: usize,
    y: &mut [u8],
    cb: &mut [u8],
    cr: &mut [u8],
    chroma_stride: usize,
) -> Option<()> {
    let width = groups * GROUP;
    for pair in 0..row_pairs {
        let at = pair * chroma_stride;
        let pixels = |row: usize| {
            Some(
                rgba.get(row * rgba_stride..)?
                    .get(..width)?
                    .as_flattened()
                    .as_chunks::<{ 4 * STEP }>()
                    .0,
            )
        };
        let (y0, y1) = y
            .get_mut(4 * at..)?
            .split_at_mut_checked(2 * chroma_stride)?;
        let (y0, y1) = (y0.get_mut(..width)?, y1.get_mut(..width)?);
        let luma = y0
            .as_chunks_mut::<STEP>()
            .0
            .iter_mut()
            .zip(y1.as_chunks_mut::<STEP>().0);
        let cb = cb
            .get_mut(at..)?
            .get_mut(..width / 2)?
            .as_chunks_mut::<{ STEP / 2 }>()
            .0;
        let cr = cr
            .get_mut(at..)?
            .get_mut(..width / 2)?
            .as_chunks_mut::<{ STEP / 2 }>()
            .0;
        let pixels = pixels(2 * pair)?.iter().zip(pixels(2 * pair + 1)?);
        for ((((upper, lower), (y0, y1)), cb), cr) in pixels.zip(luma).zip(cb).zip(cr) {
            split_rows([upper, lower], [y0, y1], cb, cr);
        }
    }
    Some(())
}

#[simd]
fn transform_rows(weights: &Weights<8, S>, first: [u8; 8], second: [u8; 8]) -> RowPair<S> {
    round_and_pair_up(
        weights.transform_row(first),
        weights.transform_row(second),
        11,
    )
}

/// The coefficients in row `k`, from rows 0 and 1 and, if there are more, rows 3 and 2.
#[simd]
fn transform_column(weights: &Weights<8, S>, from: &[RowPair<S>], k: usize) -> i32x8<S> {
    let outer = weigh(from[0], weights.of(0, k), weights.of(1, k), i32x8::zero());
    match from.get(1) {
        Some(&rows) => weigh(rows, weights.of(3, k), weights.of(2, k), outer),
        None => outer,
    }
}

#[simd]
fn transform_columns(
    weights: &Weights<8, S>,
    from: &[RowPair<S>],
    [a, b]: [usize; 2],
) -> RowPair<S> {
    round_and_pair_up(
        transform_column(weights, from, a),
        transform_column(weights, from, b),
        15,
    )
}

/// The levels, and what the masks are made of.
#[simd]
fn quantize<const MASKS: usize, W: Width>(
    coefficients: Simd<i16, W, S>,
    reciprocals: Simd<i16, W, S>,
    scales: Simd<i16, W, S>,
) -> [Simd<i16, W, S>; 2] {
    let sign = coefficients >> 15;
    // One less if negative, so that halves round away from 0.
    let doubled = coefficients + coefficients + sign;
    let levels = doubled.mul_q15_relaxed(reciprocals).mul_q15_relaxed(scales);
    // The low two bits, 4 if any higher bit is set, and the sign in bit 7.
    let magnitude = levels.abs();
    let bits = magnitude.simd_min(magnitude & 3 | 4) | sign & -128;
    [levels, if MASKS == 4 { bits } else { levels }]
}

/// Fills `blocks` from 8 rows of samples, `stride` bytes apart.
#[kernel]
#[inline(never)]
pub(crate) fn forward_transform<const MASKS: usize>(
    samples: &[u8],
    stride: usize,
    // A coefficient `c` becomes `(2 * c - (c < 0)) * divisors[0] / 2^15 * divisors[1] / 2^15`, rounded after each division.
    divisors: &[Block; 2],
    blocks: &mut [Block],
    // A bit for each coefficient, in zigzag order: nonzero or, in four masks, magnitude bit 0, bit 1, higher bits, and `c < 0`.
    masks: &mut [[u64; MASKS]],
) -> Option<()> {
    const { assert!(MASKS == 1 || MASKS == 4) };
    let centering = bias(CENTERING, 0);
    let loaded = [load_pairs(&divisors[0]), load_pairs(&divisors[1])];
    let (count, mask) = (blocks.len(), hidden(0));
    let masks = masks.get_mut(..count)?;
    let mut rows: [&[[u8; 8]]; 8] = [&[]; 8];
    unroll!(for y in 0..8 {
        rows[y] = samples.get(y * stride..)?.as_chunks().0.get(..count)?;
    });

    for (i, (block, masks)) in blocks.iter_mut().zip(masks).enumerate() {
        #[cfg(not(target_arch = "aarch64"))]
        if const { S::WIDE } {
            wide::forward(array::map(rows, |it| it[i]), divisors, block, masks);
            continue;
        }
        let weights = Weights::<8, S>::new(true, i & mask);
        let rows01 = transform_rows(&weights, rows[0][i], rows[1][i]);
        let rows76 = transform_rows(&weights, rows[7][i], rows[6][i]);
        let rows32 = transform_rows(&weights, rows[3][i], rows[2][i]);
        let rows45 = transform_rows(&weights, rows[4][i], rows[5][i]);
        let [sums01, differences01] = sum_and_difference(rows01, rows76);
        let [sums32, differences32] = sum_and_difference(rows32, rows45);
        let [for04, for26] = sum_and_difference(sums01, sums32);
        let for_odd = [differences01, differences32];
        let mut pairs = [
            round_and_pair_up(
                weigh_by(for04, 8192, 8192) + centering,
                weigh_by(for04, 8192, -8192),
                15,
            ),
            transform_columns(&weights, &[for26], [2, 6]),
            transform_columns(&weights, &for_odd, [1, 3]),
            transform_columns(&weights, &for_odd, [5, 7]),
        ];
        // In memory. On arm64 they would take half of the registers.
        let (reciprocals, scales) = (&loaded[i & mask & 1], &loaded[i & mask & 1 ^ 1]);
        unroll!(for i in 0..4 {
            let [levels, bits] = quantize::<MASKS, _, S>(pairs[i], reciprocals[i], scales[i]);
            store_pair(levels, &mut block.0.as_chunks_mut().0[i]);
            pairs[i] = bits;
        });
        store_masks(pairs, masks);
    }
    Some(())
}
