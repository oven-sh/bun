//! `dsp/enc.c`. A macroblock is kept as separate 4x4 blocks, and `Lanes` lets plain code run on many blocks at a time.

use core::iter::repeat_n;
use core::ops::{Add, Sub};

use super::tables::MAX_LEVEL;
use crate::util::{Bug, Checked};
use crate::vp8::common::{IntraMode, KC1, KC2, clip_8b, inverse_wht};

pub(super) type Matrix4x4<T> = [[T; 4]; 4];
/// 4x4 samples.
pub(super) type Block = Matrix4x4<u8>;
/// The 16 blocks of a 16x16 area, row by row.
pub(super) type Luma = [Block; 16];
/// The four blocks of the 8x8 U area, and those of V.
pub(super) type Chroma = [[Block; 4]; 2];
/// The coefficients of a block, or its 16 levels in zigzag order.
pub(super) type Coeffs = Matrix4x4<i16>;

/// `L` blocks interleaved: the first value of each, then the second... A branch-free loop over the blocks vectorizes.
#[derive(Clone)]
pub(super) struct Lanes<T, const L: usize>(Matrix4x4<[T; L]>);

impl<T: Copy + Default, const L: usize> Lanes<T, L> {
    pub(super) fn new() -> Self {
        Self([[[T::default(); L]; 4]; 4])
    }

    pub(super) fn at(&self, l: usize) -> Checked<Matrix4x4<T>> {
        if l < L { Ok(self.get(l)) } else { Err(Bug) }
    }

    /// Block `l`, which is less than `L`.
    #[inline(always)]
    fn get(&self, l: usize) -> Matrix4x4<T> {
        let value = |values: &[T; L]| values.get(l).copied().unwrap_or_default();
        map(self.0.each_ref().map(<[_; 4]>::each_ref), value)
    }

    #[inline(always)]
    fn set(&mut self, l: usize, block: Matrix4x4<T>) {
        let values = self.0.as_flattened_mut().iter_mut();
        for (values, &value) in values.zip(block.as_flattened()) {
            if let Some(dst) = values.get_mut(l) {
                *dst = value;
            }
        }
    }

    /// The first value of each block.
    pub(super) fn first(&self) -> &[T; L] {
        &self.0[0][0]
    }

    pub(super) fn first_mut(&mut self) -> &mut [T; L] {
        &mut self.0[0][0]
    }

    pub(super) fn from_blocks(blocks: &[Matrix4x4<T>]) -> Self {
        let mut lanes = Self::new();
        for (l, block) in blocks.iter().enumerate() {
            lanes.set(l, *block);
        }
        lanes
    }

    pub(super) fn to_blocks(&self) -> [Matrix4x4<T>; L] {
        let mut blocks = [[[T::default(); 4]; 4]; L];
        for (l, block) in blocks.iter_mut().enumerate() {
            *block = self.get(l);
        }
        blocks
    }

    /// `L` times the same block.
    pub(super) fn splat(block: &Matrix4x4<T>) -> Self {
        Self(map(*block, |value| [value; L]))
    }

    /// The blocks of each of `parts` in turn: `L` is `K * M`.
    pub(super) fn concat<const M: usize, const K: usize>(parts: [&Lanes<T, M>; K]) -> Self {
        let mut lanes = Self::new();
        for (k, part) in parts.into_iter().enumerate() {
            let values = lanes.0.as_flattened_mut().iter_mut();
            for (values, part) in values.zip(part.0.as_flattened()) {
                if let Some(dst) = values.as_chunks_mut().0.get_mut(k) {
                    *dst = *part;
                }
            }
        }
        lanes
    }
}

#[inline(always)]
fn map<A, R>(a: Matrix4x4<A>, f: impl Fn(A) -> R) -> Matrix4x4<R> {
    let [
        [a0, a1, a2, a3],
        [a4, a5, a6, a7],
        [a8, a9, a10, a11],
        [a12, a13, a14, a15],
    ] = a;
    [
        [f(a0), f(a1), f(a2), f(a3)],
        [f(a4), f(a5), f(a6), f(a7)],
        [f(a8), f(a9), f(a10), f(a11)],
        [f(a12), f(a13), f(a14), f(a15)],
    ]
}

/// `f` of each value of `a` and the one of `b` at the same place.
#[inline(always)]
fn map2<A, B, R>(a: Matrix4x4<A>, b: Matrix4x4<B>, f: impl Fn(A, B) -> R) -> Matrix4x4<R> {
    let [
        [a0, a1, a2, a3],
        [a4, a5, a6, a7],
        [a8, a9, a10, a11],
        [a12, a13, a14, a15],
    ] = a;
    let [
        [b0, b1, b2, b3],
        [b4, b5, b6, b7],
        [b8, b9, b10, b11],
        [b12, b13, b14, b15],
    ] = b;
    [
        [f(a0, b0), f(a1, b1), f(a2, b2), f(a3, b3)],
        [f(a4, b4), f(a5, b5), f(a6, b6), f(a7, b7)],
        [f(a8, b8), f(a9, b9), f(a10, b10), f(a11, b11)],
        [f(a12, b12), f(a13, b13), f(a14, b14), f(a15, b15)],
    ]
}

/// `f(f(f(a, b), c)...)` of all the values.
#[inline(always)]
fn fold<T>(m: Matrix4x4<T>, f: impl Fn(T, T) -> T) -> T {
    let [
        [a0, a1, a2, a3],
        [a4, a5, a6, a7],
        [a8, a9, a10, a11],
        [a12, a13, a14, a15],
    ] = m;
    let quad = |a, b, c, d| f(f(a, b), f(c, d));
    quad(
        quad(a0, a1, a2, a3),
        quad(a4, a5, a6, a7),
        quad(a8, a9, a10, a11),
        quad(a12, a13, a14, a15),
    )
}

#[inline(always)]
fn sum<T: Add<Output = T>>(m: Matrix4x4<T>) -> T {
    fold(m, T::add)
}

#[inline(always)]
fn transpose<T>(m: Matrix4x4<T>) -> Matrix4x4<T> {
    let [
        [a0, a1, a2, a3],
        [b0, b1, b2, b3],
        [c0, c1, c2, c3],
        [d0, d1, d2, d3],
    ] = m;
    [
        [a0, b0, c0, d0],
        [a1, b1, c1, d1],
        [a2, b2, c2, d2],
        [a3, b3, c3, d3],
    ]
}

/// Applies `f` to each row.
#[inline(always)]
fn rows<T>([r0, r1, r2, r3]: Matrix4x4<T>, f: impl Fn([T; 4]) -> [T; 4]) -> Matrix4x4<T> {
    [f(r0), f(r1), f(r2), f(r3)]
}

/// Applies `f` to each column.
#[inline(always)]
fn cols<T>(m: Matrix4x4<T>, f: impl Fn([T; 4]) -> [T; 4]) -> Matrix4x4<T> {
    transpose(rows(transpose(m), f))
}

/// `f` of something for each row and something for each column.
#[inline(always)]
fn outer<A: Copy, B: Copy, R>(rows: [A; 4], cols: [B; 4], f: impl Fn(A, B) -> R) -> Matrix4x4<R> {
    rows.map(|row| cols.map(|col| f(row, col)))
}

fn matrix_of<T: Copy + Default>(values: &[T; 16]) -> Matrix4x4<T> {
    let mut m = [[T::default(); 4]; 4];
    m.as_flattened_mut().copy_from_slice(values);
    m
}

fn values_of<T: Copy + Default>(m: &Matrix4x4<T>) -> [T; 16] {
    let mut values = [T::default(); 16];
    values.copy_from_slice(m.as_flattened());
    values
}

// Transforms (paragraph 14.4), on 16 bits wherever the values fit, like libwebp's SIMD code.

/// `(a * k) >> 16`
#[inline(always)]
fn mulhi(a: i16, k: i16) -> i16 {
    ((i32::from(a) * i32::from(k)) >> 16) as i16
}

/// `(a * (65536 + KC1)) >> 16`: `a * sqrt(2) * cos(pi / 8)`.
#[inline(always)]
fn mul1(a: i16) -> i16 {
    mulhi(a, KC1 as i16) + a
}

/// `(a * KC2) >> 16`: `a * sqrt(2) * sin(pi / 8)`.
#[inline(always)]
fn mul2(a: i16) -> i16 {
    mulhi(a, (KC2 - 65536) as i16) + a
}

/// `pred` plus the inverse transform of `coeffs`. 16 bits do: twice 8 * 255 plus 14.8 * 880 of quantization error.
#[inline(always)]
fn itransform_block(pred: Block, coeffs: Coeffs) -> Block {
    let pass = |[in0, in1, in2, in3]: [i16; 4]| {
        let a = in0 + in2;
        let b = in0 - in2;
        let c = mul2(in1) - mul1(in3);
        let d = mul1(in1) + mul2(in3);
        [a + d, b + c, b - c, a - d]
    };
    let tmp = cols(coeffs, pass);
    let residual = rows(tmp, |[dc, in1, in2, in3]| pass([dc + 4, in1, in2, in3]));
    map2(pred, residual, |pred, residual| {
        (i16::from(pred) + (residual >> 3)).clamp(0, 255) as u8
    })
}

pub(super) fn itransform<const L: usize>(
    pred: &Lanes<u8, L>,
    coeffs: &Lanes<i16, L>,
    out: &mut Lanes<u8, L>,
) {
    for l in 0..L {
        out.set(l, itransform_block(pred.get(l), coeffs.get(l)));
    }
}

/// `(a * ka + b * kb + rounder) >> shift`
#[inline(always)]
fn madd(a: i16, ka: i32, b: i16, kb: i32, rounder: i32, shift: u32) -> i16 {
    ((i32::from(a) * ka + i32::from(b) * kb + rounder) >> shift) as i16
}

/// The transform of `src - pred`.
#[inline(always)]
fn ftransform_block(src: Block, pred: Block) -> Coeffs {
    // -255 to 255.
    let d = map2(src, pred, |src, pred| i16::from(src) - i16::from(pred));
    // -8160 to 8160.
    let tmp = rows(d, |[d0, d1, d2, d3]| {
        let a0 = d0 + d3;
        let a1 = d1 + d2;
        let a2 = d1 - d2;
        let a3 = d0 - d3;
        [
            (a0 + a1) * 8,
            madd(a2, 2217, a3, 5352, 1812, 9),
            (a0 - a1) * 8,
            madd(a3, 2217, a2, -5352, 937, 9),
        ]
    });
    cols(tmp, |[t0, t1, t2, t3]| {
        let a0 = t0 + t3;
        let a1 = t1 + t2;
        let a2 = t1 - t2;
        let a3 = t0 - t3;
        [
            (a0 + a1 + 7) >> 4,
            madd(a2, 2217, a3, 5352, 12000, 16) + i16::from(a3 != 0),
            (a0 - a1 + 7) >> 4,
            madd(a3, 2217, a2, -5352, 51000, 16),
        ]
    })
}

pub(super) fn ftransform<const L: usize>(
    src: &Lanes<u8, L>,
    pred: &Lanes<u8, L>,
    out: &mut Lanes<i16, L>,
) {
    for l in 0..L {
        out.set(l, ftransform_block(src.get(l), pred.get(l)));
    }
}

#[inline(always)]
fn hadamard_pass<T: Copy + Add<Output = T> + Sub<Output = T>>(
    [in0, in1, in2, in3]: [T; 4],
) -> [T; 4] {
    let a0 = in0 + in2;
    let a1 = in1 + in3;
    let a2 = in1 - in3;
    let a3 = in0 - in2;
    [a0 + a1, a3 + a2, a3 - a2, a0 - a1]
}

/// The Walsh-Hadamard transform of the DC coefficients of the 16 blocks of a macroblock.
pub(super) fn ftransform_wht(dc: &[i16; 16]) -> Coeffs {
    let dc = map(matrix_of(dc), i32::from);
    map(cols(rows(dc, hadamard_pass), hadamard_pass), |v| {
        (v >> 1) as i16
    })
}

/// The inverse of `ftransform_wht`.
pub(super) fn transform_wht(coeffs: &Coeffs) -> [i16; 16] {
    inverse_wht(&values_of(coeffs))
}

// Intra predictions

/// The order of the 16x16 and of the chroma predictions.
pub(super) const DC_PRED: usize = IntraMode::Dc as usize;
pub(super) const TM_PRED: usize = IntraMode::TrueMotion as usize;
pub(super) const V_PRED: usize = IntraMode::Vertical as usize;
pub(super) const H_PRED: usize = IntraMode::Horizontal as usize;
pub(super) const NUM_PRED_MODES: usize = 4;

/// The samples around a square. `left` starts with the top left one. A side is absent on the edge of the picture.
struct Border<'a> {
    left: Option<&'a [u8]>,
    top: Option<&'a [u8]>,
}

impl Border<'_> {
    fn dc(&self) -> u8 {
        let sum = |side: &[u8]| side.iter().map(|&v| u32::from(v)).sum::<u32>();
        let (dc, count) = match (self.top, self.left.and_then(<[u8]>::split_first)) {
            (Some(top), Some((_, left))) => (sum(top) + sum(left), 2 * top.len()),
            (Some(side), None) | (None, Some((_, side))) => (2 * sum(side), 2 * side.len()),
            (None, None) => return 0x80,
        };
        ((dc + count as u32 / 2) / (count as u32).max(1)) as u8
    }

    fn top_left(&self) -> u8 {
        self.left.and_then(<[u8]>::first).copied().unwrap_or(0)
    }
}

/// `out[i][l]` is `quads[l][i]`.
fn spread<'a, const L: usize>(quads: impl Iterator<Item = &'a [u8; 4]>) -> [[u8; L]; 4] {
    let mut out = [[0; L]; 4];
    let [out0, out1, out2, out3] = &mut out;
    let lanes = out0.iter_mut().zip(out1).zip(out2).zip(out3);
    for ((((out0, out1), out2), out3), quad) in lanes.zip(quads) {
        [*out0, *out1, *out2, *out3] = *quad;
    }
    out
}

/// The four predictions of `L` blocks, which make up one square of `N` blocks a side for each of `borders`.
fn intra_preds<const L: usize, const N: usize>(
    borders: &[Border<'_>],
) -> [Lanes<u8, L>; NUM_PRED_MODES] {
    let fill = |value: u8| Lanes([[[value; L]; 4]; 4]);
    let per_block = |value: fn(&Border<'_>) -> u8| {
        let mut values = [0; L];
        let blocks = borders
            .iter()
            .flat_map(|border| repeat_n(value(border), N * N));
        values
            .iter_mut()
            .zip(blocks)
            .for_each(|(dst, value)| *dst = value);
        values
    };
    // What each block has above each of its columns, and on the left of each of its rows.
    let tops = borders.iter().filter_map(|border| border.top);
    let tops = tops.flat_map(|top| top.as_chunks().0.iter().cycle().take(N * N));
    let lefts = borders
        .iter()
        .filter_map(|border| Some(border.left?.split_first()?.1));
    let lefts = lefts.flat_map(|left| left.as_chunks().0.iter().flat_map(|quad| [quad; N]));
    let (top, left) = (spread::<L>(tops), spread::<L>(lefts));
    let has_top = borders.iter().all(|border| border.top.is_some());
    let has_left = borders.iter().all(|border| border.left.is_some());

    let dc = Lanes([[per_block(|border| border.dc()); 4]; 4]);
    let ve = match has_top {
        true => Lanes(outer(left, top, |_, top| top)),
        false => fill(127),
    };
    let he = match has_left {
        true => Lanes(outer(left, top, |left, _| left)),
        false => fill(129),
    };
    let tm = match (has_left, has_top) {
        (true, true) => {
            let top_left = per_block(|border| border.top_left());
            Lanes(outer(left, top, |left, top| {
                let mut out = top_left;
                for ((out, left), top) in out.iter_mut().zip(left).zip(top) {
                    *out = clip_8b(i32::from(top) + i32::from(left) - i32::from(*out));
                }
                out
            }))
        }
        (true, false) => he.clone(),
        // The missing left samples count as 129, like the top left one, which leaves the top samples.
        (false, true) => ve.clone(),
        (false, false) => fill(129),
    };
    [dc, tm, ve, he]
}

/// The four 16x16 predictions. `left` starts with the top left sample.
pub(super) fn intra16_preds(
    left: Option<&[u8; 17]>,
    top: Option<&[u8; 16]>,
) -> [Lanes<u8, 16>; NUM_PRED_MODES] {
    intra_preds::<16, 4>(&[Border {
        left: left.map(<[u8; 17]>::as_slice),
        top: top.map(<[u8; 16]>::as_slice),
    }])
}

/// The four chroma predictions, from the samples around U and those around V.
pub(super) fn intra_chroma_preds(
    left: Option<[&[u8; 9]; 2]>,
    top: Option<[&[u8; 8]; 2]>,
) -> [Lanes<u8, 8>; NUM_PRED_MODES] {
    let [u_left, v_left] = left.map_or([None; 2], |left| left.map(|left| Some(left.as_slice())));
    let [u_top, v_top] = top.map_or([None; 2], |top| top.map(|top| Some(top.as_slice())));
    let border = |left, top| Border { left, top };
    intra_preds::<8, 2>(&[border(u_left, u_top), border(v_left, v_top)])
}

/// The ten `B_*_PRED` predictions and six blocks of padding. `edge`: left from the bottom up, top left, top, top right.
pub(super) fn intra4_preds(edge: &[u8; 13]) -> Lanes<u8, 16> {
    let [l, k, j, i, x, a, b, c, d, e, f, g, h] = edge.map(u32::from);
    let avg3 = |a: u32, b: u32, c: u32| ((a + 2 * b + c + 2) >> 2) as u8;
    let avg2 = |a: u32, b: u32| ((a + b + 1) >> 1) as u8;

    let (xab, abc, bcd, cde) = (avg3(x, a, b), avg3(a, b, c), avg3(b, c, d), avg3(c, d, e));
    let (def, efg, fgh, ghh) = (avg3(d, e, f), avg3(e, f, g), avg3(f, g, h), avg3(g, h, h));
    let (xij, ijk, jkl, kll) = (avg3(x, i, j), avg3(i, j, k), avg3(j, k, l), avg3(k, l, l));
    let axi = avg3(a, x, i);
    let (xa, ab, bc, cd, de) = (avg2(x, a), avg2(a, b), avg2(b, c), avg2(c, d), avg2(d, e));
    let (ix, ji, kj, lk) = (avg2(i, x), avg2(j, i), avg2(k, j), avg2(l, k));

    let dc = [[((4 + a + b + c + d + i + j + k + l) >> 3) as u8; 4]; 4];
    let tm = outer([i, j, k, l], [a, b, c, d], |left, top| {
        clip_8b(left as i32 + top as i32 - x as i32)
    });
    let ve = [[xab, abc, bcd, cde]; 4];
    let he = [[xij; 4], [ijk; 4], [jkl; 4], [kll; 4]];
    let rd = [
        [axi, xab, abc, bcd],
        [xij, axi, xab, abc],
        [ijk, xij, axi, xab],
        [jkl, ijk, xij, axi],
    ];
    let vr = [
        [xa, ab, bc, cd],
        [axi, xab, abc, bcd],
        [xij, xa, ab, bc],
        [ijk, axi, xab, abc],
    ];
    let ld = [
        [abc, bcd, cde, def],
        [bcd, cde, def, efg],
        [cde, def, efg, fgh],
        [def, efg, fgh, ghh],
    ];
    let vl = [
        [ab, bc, cd, de],
        [abc, bcd, cde, def],
        [bc, cd, de, efg],
        [bcd, cde, def, fgh],
    ];
    let hd = [
        [ix, axi, xab, abc],
        [ji, xij, ix, axi],
        [kj, ijk, ji, xij],
        [lk, jkl, kj, ijk],
    ];
    let l = l as u8;
    let hu = [
        [ji, ijk, kj, jkl],
        [kj, jkl, lk, kll],
        [lk, kll, l, l],
        [l, l, l, l],
    ];
    Lanes::from_blocks(&[dc, tm, ve, he, rd, vr, ld, vl, hd, hu])
}

// Metrics

/// The sum of the squared differences between each block of `a` and that of `b`.
pub(super) fn sse<const L: usize>(a: &Lanes<u8, L>, b: &Lanes<u8, L>) -> [i32; L] {
    let mut squares = Lanes::<u16, L>::new();
    for l in 0..L {
        let square = |a: u8, b: u8| u16::from(a.abs_diff(b)) * u16::from(a.abs_diff(b));
        squares.set(l, map2(a.get(l), b.get(l), square));
    }
    let mut out = [0; L];
    for (l, out) in out.iter_mut().enumerate() {
        *out = sum(map(squares.get(l), i32::from));
    }
    out
}

const WEIGHT_Y: Matrix4x4<u16> = [
    [38, 32, 20, 9],
    [32, 28, 17, 7],
    [20, 17, 10, 4],
    [9, 7, 4, 2],
];

/// The weighted sum of the absolute values of the Hadamard transform of each block.
pub(super) fn ttransform<const L: usize>(blocks: &Lanes<u8, L>) -> [i32; L] {
    let mut transformed = Lanes::<u16, L>::new();
    for l in 0..L {
        let block = map(blocks.get(l), i16::from);
        let values = cols(rows(block, hadamard_pass), hadamard_pass);
        transformed.set(l, map(values, i16::unsigned_abs));
    }
    let mut out = [0; L];
    for (l, out) in out.iter_mut().enumerate() {
        let weighted = |value, weight| i32::from(value) * i32::from(weight);
        *out = sum(map2(transformed.get(l), WEIGHT_Y, weighted));
    }
    out
}

/// The texture distortion between two blocks, from what `ttransform` says of each.
#[inline]
pub(super) fn disto4x4(sum1: i32, sum2: i32) -> i32 {
    (sum2 - sum1).abs() >> 5
}

// Susceptibility, from the histogram of the coefficients

const MAX_COEFF_THRESH: u16 = 31;

pub(super) struct Histogram {
    pub(super) max_value: i32,
    pub(super) last_non_zero: i32,
}

/// One histogram for every `N` blocks.
pub(super) fn collect_histograms<const L: usize, const N: usize>(
    src: &Lanes<u8, L>,
    pred: &Lanes<u8, L>,
) -> impl Iterator<Item = Histogram> {
    let mut coeffs = Lanes::new();
    ftransform(src, pred, &mut coeffs);
    let mut bins = Lanes::<u8, L>::new();
    for l in 0..L {
        let bin = |coeff: i16| (coeff.unsigned_abs() >> 3).min(MAX_COEFF_THRESH) as u8;
        bins.set(l, map(coeffs.get(l), bin));
    }
    (0..L / N).map(move |i| {
        // Most coefficients fall in a few bins: four counters in turn keep increments from waiting on each other.
        let mut distributions = [[0u16; MAX_COEFF_THRESH as usize + 1]; 4];
        for bins in &bins.0 {
            for (bins, distribution) in bins.iter().zip(&mut distributions) {
                for &bin in bins.iter().skip(i * N).take(N) {
                    if let Some(count) = distribution.get_mut(usize::from(bin)) {
                        *count += 1;
                    }
                }
            }
        }
        let mut histo = Histogram {
            max_value: 0,
            last_non_zero: 1,
        };
        let [d0, d1, d2, d3] = &distributions;
        for (k, (((d0, d1), d2), d3)) in d0.iter().zip(d1).zip(d2).zip(d3).enumerate() {
            let value = i32::from(d0 + d1 + d2 + d3);
            if value > 0 {
                histo.max_value = histo.max_value.max(value);
                histo.last_non_zero = k as i32;
            }
        }
        histo
    })
}

// Quantization

const QFIX: u32 = 17;

#[derive(Clone, Default)]
pub(super) struct Matrix {
    /// The quantizer steps.
    pub(super) q: Matrix4x4<u16>,
    /// Their reciprocals, in fixed point.
    pub(super) iq: Matrix4x4<u16>,
    /// The rounding bias.
    pub(super) bias: Matrix4x4<u32>,
    /// What to add to the high frequencies, to sharpen a little.
    pub(super) sharpen: Matrix4x4<u16>,
}

impl Matrix {
    pub(super) const fn bias(b: u32) -> u32 {
        b << (QFIX - 8)
    }

    pub(super) const fn reciprocal(q: u16) -> u16 {
        ((1 << QFIX) / q as u32) as u16
    }
}

#[inline(always)]
pub(super) fn quantdiv(n: u32, iq: u32, bias: u32) -> i32 {
    ((n * iq + bias) >> QFIX) as i32
}

#[inline(always)]
fn zigzag<T>(m: Matrix4x4<T>) -> Matrix4x4<T> {
    let [
        [a0, a1, a2, a3],
        [a4, a5, a6, a7],
        [a8, a9, a10, a11],
        [a12, a13, a14, a15],
    ] = m;
    [
        [a0, a1, a4, a8],
        [a5, a2, a3, a6],
        [a9, a12, a13, a10],
        [a7, a11, a14, a15],
    ]
}

#[inline(always)]
fn unzigzag<T>(m: Matrix4x4<T>) -> Matrix4x4<T> {
    let [
        [a0, a1, a4, a8],
        [a5, a2, a3, a6],
        [a9, a12, a13, a10],
        [a7, a11, a14, a15],
    ] = m;
    [
        [a0, a1, a2, a3],
        [a4, a5, a6, a7],
        [a8, a9, a10, a11],
        [a12, a13, a14, a15],
    ]
}

/// The levels, in zigzag order.
#[inline(always)]
fn quantize_block(coeffs: Coeffs, mtx: &Matrix) -> Coeffs {
    let abs = map2(coeffs, mtx.sharpen, |coeff, sharpen| {
        coeff.unsigned_abs() + sharpen
    });
    let scaled = map2(abs, mtx.iq, |abs, iq| u32::from(abs) * u32::from(iq));
    let levels = map2(scaled, mtx.bias, |scaled, bias| {
        (((scaled + bias) >> QFIX) as i16).min(MAX_LEVEL as i16)
    });
    let signed = |level: i16, coeff: i16| if coeff < 0 { -level } else { level };
    zigzag(map2(levels, coeffs, signed))
}

/// What the decoder makes of the levels.
#[inline(always)]
fn dequantize_block(levels: Coeffs, mtx: &Matrix) -> Coeffs {
    map2(unzigzag(levels), mtx.q, |level, q| {
        level.wrapping_mul(q as i16)
    })
}

/// Replaces `coeffs` by what the decoder will make of the levels, which go to `levels`.
pub(super) fn quantize<const L: usize>(
    coeffs: &mut Lanes<i16, L>,
    mtx: &Matrix,
    levels: &mut Lanes<i16, L>,
) {
    for l in 0..L {
        levels.set(l, quantize_block(coeffs.get(l), mtx));
    }
    for l in 0..L {
        coeffs.set(l, dequantize_block(levels.get(l), mtx));
    }
}

/// `quantize` for a single block.
pub(super) fn quantize_one(coeffs: &mut Coeffs, mtx: &Matrix) -> Coeffs {
    let levels = quantize_block(*coeffs, mtx);
    *coeffs = dequantize_block(levels, mtx);
    levels
}

/// How many of the levels of each block are not zero, the first one aside.
pub(super) fn count_non_zero_ac<const L: usize>(levels: &Lanes<i16, L>) -> [u8; L] {
    let mut out = [0; L];
    for (l, out) in out.iter_mut().enumerate() {
        let mut non_zero = map(levels.get(l), |level| u8::from(level != 0));
        non_zero[0][0] = 0;
        *out = sum(non_zero);
    }
    out
}

/// How many levels a block has up to the last one that is not zero.
#[inline(always)]
pub(super) fn num_levels_block(levels: Coeffs) -> u8 {
    const COUNTS: Matrix4x4<u8> = [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16],
    ];
    let counts = map2(
        levels,
        COUNTS,
        |level, count| if level != 0 { count } else { 0 },
    );
    fold(counts, u8::max)
}

pub(super) fn num_levels<const L: usize>(levels: &Lanes<i16, L>) -> [u8; L] {
    let mut out = [0; L];
    for (l, out) in out.iter_mut().enumerate() {
        *out = num_levels_block(levels.get(l));
    }
    out
}
