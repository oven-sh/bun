//! What the decoder and the encoder agree on: `common_dec.h`, and the parts of `dsp/dec.c` that the encoder uses too.

/// Prediction modes. All ten are for 4x4 luma blocks; whole macroblocks, luma and chroma, use the first four.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum IntraMode {
    #[default]
    Dc,
    TrueMotion,
    Vertical,
    Horizontal,
    DownRight,
    VerticalRight,
    DownLeft,
    VerticalLeft,
    HorizontalDown,
    HorizontalUp,
}

pub(crate) const NUM_BMODES: usize = 10;

/// Paragraph 9.1: three bytes of flags and the size of the first partition, `SIGNATURE`, the width and the height.
pub(crate) const FRAME_HEADER_SIZE: usize = 10;
pub(crate) const SIGNATURE: [u8; 3] = [0x9d, 0x01, 0x2a];

pub(crate) const MB_FEATURE_TREE_PROBS: usize = 3;
pub(crate) const NUM_MB_SEGMENTS: usize = 4;

/// 0: luma AC of a 16x16 macroblock, 1: its DC, 2: chroma, 3: luma of a 4x4 macroblock.
pub(crate) const NUM_TYPES: usize = 4;
pub(crate) const NUM_BANDS: usize = 8;
pub(crate) const NUM_CTX: usize = 3;
pub(crate) const NUM_PROBAS: usize = 11;
/// The 16 coefficients of a block, and the position after the last one.
pub(crate) const NUM_POSITIONS: usize = 16 + 1;

/// One value for each coefficient probability.
pub(crate) type Probas<T> = [[[[T; NUM_PROBAS]; NUM_CTX]; NUM_BANDS]; NUM_TYPES];

#[inline(always)]
pub(crate) fn clip_8b(v: i32) -> u8 {
    v.clamp(0, 255) as u8
}

/// The factors of the inverse DCT (paragraph 14.4) times 65536: `sqrt(2) * cos(pi / 8) - 1` and `sqrt(2) * sin(pi / 8)`.
pub(crate) const KC1: i32 = 20091;
pub(crate) const KC2: i32 = 35468;

/// `TransformWHT_C` (paragraph 14.3): from the block of the DCs to the DC of each of the 16 blocks of a macroblock.
pub(crate) fn inverse_wht(input: &[i16; 16]) -> [i16; 16] {
    #[rustfmt::skip]
    let [
        i0,  i1,  i2,  i3,
        i4,  i5,  i6,  i7,
        i8,  i9,  i10, i11,
        i12, i13, i14, i15,
    ] = input.map(i32::from);
    let pass = |in0: i32, in1: i32, in2: i32, in3: i32| {
        let a0 = in0 + in3;
        let a1 = in1 + in2;
        let a2 = in1 - in2;
        let a3 = in0 - in3;
        [a0 + a1, a3 + a2, a0 - a1, a3 - a2]
    };
    let [a0, a1, a2, a3] = pass(i0, i4, i8, i12);
    let [b0, b1, b2, b3] = pass(i1, i5, i9, i13);
    let [c0, c1, c2, c3] = pass(i2, i6, i10, i14);
    let [d0, d1, d2, d3] = pass(i3, i7, i11, i15);
    let rows = [
        pass(a0 + 3, b0, c0, d0),
        pass(a1 + 3, b1, c1, d1),
        pass(a2 + 3, b2, c2, d2),
        pass(a3 + 3, b3, c3, d3),
    ];
    let mut out = [0; 16];
    for (out, v) in out.iter_mut().zip(rows.as_flattened()) {
        *out = (v >> 3) as i16;
    }
    out
}
