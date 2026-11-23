//! RGBA to YUV.

use super::blocks::*;
use super::types::*;
use bun_simd::prelude::*;

targets!(Upto<B32>);

/// `(a * by[0] + b * by[1] + c * by[2] + d * by[3] + rounding) >> shift`, where the lanes of `a` and `b` alternate and
/// those of `c` and `d`.
#[simd]
fn mixed(ab: V16<S>, cd: V16<S>, by: [i16; 4], rounding: i32, shift: u32) -> V32<S> {
    let mut sums = PairSums::new();
    sums.mul_add(ab, V16::repeat(&[by[0], by[1]]));
    sums.mul_add(cd, V16::repeat(&[by[2], by[3]]));
    (sums.total() + rounding) >> shift
}

/// `indices` are below 32.
#[simd]
fn lookup32(table: &[u8; 32], indices: V8<S>) -> V8<S> {
    V8::load_block(table)
        .in_blocks()
        .concat_lookup_bytes_relaxed(V8::load_block(&table[16..]), indices)
}

/// `4 * value + ((slope * fraction + 64) >> 7)`
#[simd]
fn interpolated(value: V8<S>, slope: V8<S>, sum: V16<S>) -> V16<S> {
    (value.bitcast() << 2) + slope.bitcast::<i16>().mul_q15_relaxed(sum & 511)
}

#[simd]
fn chroma_row([r, g, b]: [V16<S>; 3]) -> [V16<S>; 2] {
    const U: [i16; 4] = [-9719, -19081, 28800, 1 << 14];
    const V: [i16; 4] = [28800, -24116, -4684, 1 << 14];
    // Multiplied by 1 << 14 this is (128 << 18) + (1 << 17).
    let offset = V16::splat((128 << 4) + (1 << 3));
    let ([rg0, rg1], [b0, b1]) = (
        r.in_blocks().interleave(g),
        b.in_blocks().interleave(offset),
    );
    [
        mixed(rg0, b0, U, 0, 18)
            .in_blocks()
            .saturating_narrow::<i16>(mixed(rg1, b1, U, 0, 18)),
        mixed(rg0, b0, V, 0, 18)
            .in_blocks()
            .saturating_narrow::<i16>(mixed(rg1, b1, V, 0, 18)),
    ]
}

/// Two rows, whose samples alternate.
#[simd]
fn chroma_rows(colors: &LinearColors, gamma: &GammaTable, y: usize, half: usize) -> [V16<S>; 2] {
    let [mut upper, mut lower] = [[V16::zero(); 3]; 2];
    for i in 0..3 {
        let a = Simd::<u16, W<S>, S>::load(colors.sums[i][y][half..].as_flattened()).cast_signed();
        let b =
            Simd::<u16, W<S>, S>::load(colors.sums[i][y + 1][half..].as_flattened()).cast_signed();
        let indices = (a >> 9).in_blocks().saturating_narrow::<u8>(b >> 9);
        let (values, slopes, zero) = (
            lookup32(&gamma.values, indices),
            lookup32(&gamma.slopes, indices),
            V8::zero(),
        );
        let (values, slopes) = (
            values.in_blocks().interleave(zero),
            zero.in_blocks().interleave(slopes),
        );
        (upper[i], lower[i]) = (
            interpolated(values[0], slopes[0], a),
            interpolated(values[1], slopes[1], b),
        );
    }
    let ([u, v], [lower_u, lower_v]) = (chroma_row(upper), chroma_row(lower));
    [u | lower_u << 8, v | lower_v << 8]
}

#[simd]
fn store(rows01: V16<S>, rows23: V16<S>, to: &mut [Block]) {
    let [left, right] = rows01.interleave(rows23);
    let to = to.as_flattened_mut().as_flattened_mut();
    left.store_bytes(to);
    right.store_bytes(&mut to[W::<S>::BYTES..]);
}

/// Luma from the rows of `pixels`, and chroma from `colors`.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/yuv.h#L206
#[kernel]
#[inline(never)]
pub(crate) fn convert(
    pixels: &[&[[u8; 4]; 16]; 16],
    colors: &LinearColors,
    gamma: &GammaTable,
    out: &mut Macroblock,
) {
    let greens = V8::repeat(
        &const { table!(1, |_row, i| if i % 2 != 0 { NONE } else { i / 4 * 4 + 1 }) }[0],
    );
    let by_column = V8::repeat(&const { table!(1, |_row, i| i % 4 * 4 + i / 4) }[0]);
    for block in (0..16).step_by(S::PAIRS_AT_ONCE) {
        let rows = each!([0, 1, 2, 3], |y, _| {
            let rgba = V8::load(pixels[block / 4 * 4 + y][block % 4 * 4..].as_flattened());
            // The factor for green does not fit 15 bits.
            mixed(
                rgba.bitcast() & 255,
                lookup16(rgba, greens),
                [16839, 6420, 16529, 16530],
                (16 << 16) + (1 << 15),
                16,
            )
        });
        let rows = rows[0]
            .in_blocks()
            .saturating_narrow::<i16>(rows[1])
            .in_blocks()
            .saturating_narrow::<u8>(rows[2].in_blocks().saturating_narrow::<i16>(rows[3]));
        rows.in_blocks()
            .lookup_bytes(by_column)
            .store(out.luma[block..].as_flattened_mut().as_flattened_mut());
    }
    for half in (0..2).step_by(S::PAIRS_AT_ONCE) {
        let ([u01, v01], [u23, v23]) = (
            chroma_rows(colors, gamma, 0, half),
            chroma_rows(colors, gamma, 2, half),
        );
        store(u01, u23, &mut out.chroma[2 * half..]);
        store(v01, v23, &mut out.chroma[4 + 2 * half..]);
    }
}
