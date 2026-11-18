#![allow(clippy::large_types_passed_by_value)] // vectors live in registers
use super::rotate;
use bun_simd::{Isa, Shuffle};
use core::array::from_fn;

pub use simd::{
    analyze, convert, try_chroma_modes, try_diagonal_modes, try_luma_modes, try_straight_modes,
};

/// 4x4 samples, by column and row.
pub type Block = [[u8; 4]; 4];

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct Macroblock {
    pub luma: [Block; 16],
    /// U, then V.
    pub chroma: [Block; 8],
}

/// For each sample of chroma, 4 times the average of the pixels that it covers, below `1 << 14`.
#[derive(Default)]
pub struct LinearColors {
    /// By red, green or blue, row in a block, upper or lower blocks, and column.
    pub sums: [[[[u16; 8]; 2]; 4]; 3],
}

pub struct GammaTable {
    /// For each 512 steps of a sum.
    pub values: [u8; 32],
    /// The difference to the next value, below 128.
    pub slopes: [u8; 32],
}

/// The samples around the luma of a macroblock, or around its U and then its V.
pub struct Edges {
    pub above: [u8; 16],
    /// From the bottom up.
    pub left: [u8; 16],
    /// Of luma, only the first counts.
    pub above_left: [u8; 2],
    pub dc: [u8; 2],
}

/// `level = ((|coefficient| + sharpening) * reciprocal + bias) >> 17`
#[derive(Clone, Copy)]
#[repr(align(16))]
pub struct Quantizer {
    /// For the first row of a pair of blocks, and for the others.
    pub steps: [[i16; 8]; 2],
    reciprocals: [[i16; 8]; 2],
    /// The lower 16 bits.
    doubled_reciprocals: [[i16; 8]; 2],
    /// By row: the sharpening, which only luma has, plus the bias in reciprocals, rounded.
    offsets: [[i16; 8]; 4],
    /// Twice as much as so many reciprocals are above the bias.
    excesses: [[i16; 8]; 2],
}

impl Quantizer {
    /// `ExpandMatrix`. For DC and AC. `biases`: 256ths of a step, `sharpening`: 2048ths of that for AC.
    pub fn new(steps: [u16; 2], biases: [u8; 2], sharpening: [[u8; 4]; 4]) -> Self {
        let rows = |[dc, ac]: [i32; 2]| {
            [dc, ac].map(|first| from_fn(|i| (if i < 2 { first } else { ac }) as i16))
        };
        // Then it makes no difference that the reciprocal of 4 is one less than it should be.
        debug_assert!((0..2).all(|i| steps[i] > 4 || steps[i] == 4 && biases[i] % 64 > 4));
        debug_assert!(steps.iter().all(|&it| it <= 512));
        let (steps, biases) = (steps.map(i32::from), biases.map(|it| i32::from(it) << 9));
        let reciprocals = steps.map(|it| ((1 << 17) / it.max(4)).min(0x7FFF));
        let multiples = [0, 1].map(|i| (biases[i] + reciprocals[i] / 2) / reciprocals[i]);
        let offset = |y: usize, x: usize| {
            let (by, i) = (i32::from(sharpening[y][x]), (x + y).min(1));
            let more = (by * steps[1]) >> 11;
            // The level of zero is zero.
            debug_assert!(more * reciprocals[i] + biases[i] < 1 << 17);
            more + multiples[i]
        };
        Self {
            steps: rows(steps),
            reciprocals: rows(reciprocals),
            doubled_reciprocals: rows(reciprocals.map(|it| 2 * it)),
            offsets: from_fn(|y| from_fn(|i| offset(y, i / 2) as i16)),
            excesses: rows([0, 1].map(|i| 2 * (multiples[i] * reciprocals[i] - biases[i]))),
        }
    }

    /// Makes zero of the first coefficient.
    #[inline(always)]
    fn without_dc(mut self) -> Self {
        self.reciprocals[0][..2].fill(0);
        self.excesses[0][..2].fill(i16::MIN);
        self
    }
}

/// How many of the two blocks above and to the left have levels other than zero.
pub type Context = u8;

/// The highest magnitude that `Candidates::symbols` tells from the others.
pub const MAX_SYMBOL: u8 = 67;
/// The mode of a subblock is not DC, and no more than 3 levels behind the first are other than zero.
pub const IS_FLAT: u8 = 128;

/// A block with each of `2 * PAIRS` modes. Mode `m` is in pair `m / 2`, in the lower half if even.
#[repr(align(32))]
pub struct Candidates<const PAIRS: usize> {
    /// By row, pair and column.
    pub levels: [[[u32; 4]; PAIRS]; 4],
    /// By half of the zigzag, pair and place: `min(|level|, MAX_SYMBOL) + context * (MAX_SYMBOL + 1)`
    pub symbols: [[[u16; 8]; PAIRS]; 2],
    /// Of the decoded block: the bottom row from the left, then up the rest of the right column.
    pub edges: [[[u8; 8]; 2]; PAIRS],
}

impl<const PAIRS: usize> Default for Candidates<PAIRS> {
    fn default() -> Self {
        Self {
            levels: [[[0; _]; _]; _],
            symbols: [[[0; _]; _]; _],
            edges: [[[0; _]; _]; _],
        }
    }
}

/// The rows or the columns of a block, for one or two pairs.
#[derive(Default)]
#[repr(align(32))]
struct Kept([[[i16; 8]; 2]; 4]);

/// The luma of a macroblock as the kernels need it.
#[derive(Default)]
#[repr(align(32))]
pub struct LumaSource {
    columns: [[[i16; 8]; 16]; 4],
    spectra: [[[i16; 4]; 16]; 4],
    textures: [[i32; 2]; 16],
    /// The prediction and the coefficients of each block.
    kept: [[Kept; 2]; 16],
}

#[derive(Default)]
pub struct LumaCandidates {
    pub blocks: [Candidates<2>; 16],
    /// Without edges.
    pub y2: Candidates<2>,
    /// By half, pair, block and mode: `4 * (place behind the last level other than zero) + context`
    pub ends: [[[[u8; 2]; 8]; 2]; 2],
    /// By pair, 8 times the same.
    pub y2_ends: [[[u8; 2]; 8]; 2],
    pub squared_errors: [i32; 4],
    pub texture_differences: [i32; 4],
}

/// Whether any magnitude is `MAX_SYMBOL` or more.
#[derive(Clone, Copy)]
pub struct LumaSaturation {
    pub blocks: bool,
    pub y2: bool,
}

#[derive(Default)]
pub struct SubblockCandidates {
    /// There are 10 modes.
    pub block: Candidates<6>,
    /// By mode, times 256.
    pub distortions: [i32; 16],
    /// By mode, as in `LumaCandidates`, plus `IS_FLAT`.
    pub ends: [u8; 32],
}

#[derive(Default)]
pub struct ChromaCandidates {
    pub blocks: [Candidates<2>; 8],
    pub ends: [[[u8; 2]; 8]; 2],
    /// How many levels are neither the first of a block nor zero. By pair, 8 times the same.
    pub ac_counts: [[[u8; 2]; 8]; 2],
    pub squared_errors: [i32; 4],
    /// Of blocks 1 and 2, then of block 3 and something else: by pair, block, plane and mode.
    pub dc_errors: [[[[[i16; 2]; 2]; 2]; 2]; 2],
    kept: [[Kept; 2]; 8],
}

/// Room for the kernels to write to.
#[derive(Default)]
pub struct Scratch {
    pub source: LumaSource,
    pub luma: LumaCandidates,
    pub subblock: SubblockCandidates,
    pub chroma: ChromaCandidates,
}

/// For DC and TrueMotion prediction, how the coefficients spread over 32 bins.
#[derive(Clone, Copy, Default)]
pub struct Histograms {
    pub highest_count: [u32; 2],
    pub last_bin: [u32; 2],
}

/// The index for a zero.
const Z: u16 = 128;

const ZIGZAG: [[u16; 8]; 2] = [[0, 1, 4, 8, 5, 2, 3, 6], [9, 12, 13, 10, 7, 11, 14, 15]];

/// Above and to the left of the upper 8 of luma, the lower 8 and chroma. From 16 on: other blocks.
const NEIGHBORS: [[[u8; 16]; 2]; 3] = [
    [
        [16, 16, 17, 17, 18, 18, 19, 19, 0, 1, 2, 3, 4, 5, 6, 7],
        [20, 20, 0, 1, 2, 3, 4, 5, 21, 21, 8, 9, 10, 11, 12, 13],
    ],
    [
        [24, 25, 26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7],
        [22, 22, 0, 1, 2, 3, 4, 5, 23, 23, 8, 9, 10, 11, 12, 13],
    ],
    [
        [16, 16, 17, 17, 0, 1, 2, 3, 18, 18, 19, 19, 8, 9, 10, 11],
        [20, 20, 0, 1, 21, 21, 4, 5, 22, 22, 8, 9, 23, 23, 12, 13],
    ],
];

/// RFC 6386, 12.3, from mode 2 on: the average of 3 samples around `i`, or of 2 up to `i - 16`.
#[rustfmt::skip]
const SUBBLOCK_SOURCES: [[[u16; 4]; 4]; 10] = [
    [[Z; 4]; 4],
    [[0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15]],
    [[5, 6, 7, 8]; 4],
    [[3; 4], [2; 4], [1; 4], [0; 4]],
    [[4, 5, 6, 7], [3, 4, 5, 6], [2, 3, 4, 5], [1, 2, 3, 4]],
    [[21, 22, 23, 24], [4, 5, 6, 7], [3, 21, 22, 23], [2, 4, 5, 6]],
    [[6, 7, 8, 9], [7, 8, 9, 10], [8, 9, 10, 11], [9, 10, 11, 12]],
    [[22, 23, 24, 25], [6, 7, 8, 9], [23, 24, 25, 10], [7, 8, 9, 11]],
    [[20, 4, 5, 6], [19, 3, 20, 4], [18, 2, 19, 3], [17, 1, 18, 2]],
    [[19, 2, 18, 1], [18, 1, 17, 0], [17, 0, 16, 16], [16; 4]],
];

/// From the third pair of modes on, 8 positions from here are enough. The sixth is the fifth again.
const STARTS: [u16; 6] = [0, 0, 1, 5, 0, 0];

const WINDOWS: [[u8; 16]; 6] =
    from_fn(const |pair| from_fn(const |i| (STARTS[pair] as usize + i % 8 + i / 8 * 16) as u8));

/// By column and pair: the places in the window.
const SUBBLOCK_COLUMNS: [[[u16; 8]; 6]; 4] = from_fn(const |x| {
    from_fn(const |pair| {
        from_fn(const |i| {
            let source = SUBBLOCK_SOURCES[2 * (pair - pair / 5) + i % 2][i / 2][x];
            source - STARTS[pair] - if source & 16 != 0 { 8 } else { 0 }
        })
    })
});

/// In each block of 16 bytes, the last 2 of the first vector come before those of the second.
struct ShiftIn;

impl<const N: usize> Shuffle<N> for ShiftIn {
    const FROM: [usize; N] = from_fn(const |i| if i % 16 < 2 { i + 14 } else { N + i - 2 });
}

/// The lanes of the `group`-th vector.
#[inline(always)]
fn lanes<T, const K: usize, const M: usize>(pairs: &[[T; K]], group: usize) -> &[T; M] {
    &pairs.as_flattened().as_chunks().0[group]
}

#[inline(always)]
fn room<T, const K: usize, const M: usize>(pairs: &mut [[T; K]], group: usize) -> &mut [T; M] {
    &mut pairs.as_flattened_mut().as_chunks_mut().0[group]
}

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    use crate::webp::dct::simd::this_target::inverse_dct_pass;
    use isa::{I16, I32, U8, U16, U32, U64, Vector, x128};

    const N: usize = U8::LEN;
    const _: () = assert!(N <= 32, "4 or 6 modes at a time do not fill 64 bytes");
    /// 16 bytes have a row or column of two blocks, whose lanes alternate: mostly of two modes.
    const PAIRS: usize = N / 16;
    const HAS_WIDENING_MUL: bool = PAIRS == 1 && isa::Isa::HAS_INTERLEAVED_MEMORY;

    /// The rows or the columns of the blocks.
    type Quad = [I16; 4];

    /// Keeps LLVM from taking apart what is one instruction on NEON.
    #[inline(always)]
    fn opaque(it: I16) -> I16 {
        if !HAS_WIDENING_MUL {
            return it;
        }
        I16::repeat(x128::I16::from_slice(&it.to_array()).opaque().to_array())
    }

    /// For the first pair.
    #[inline(always)]
    fn widening_mul(a: I16, b: I16) -> Vector<i32, 8> {
        x128::I16::from_slice(&a.to_array()).widening_mul(Vector::from_slice(&b.to_array()))
    }

    #[inline(always)]
    fn load(from: &Kept) -> Quad {
        from_fn(|i| I16::load(lanes(&from.0[i], 0)))
    }

    #[inline(always)]
    fn store(quad: Quad, to: &mut Kept) {
        for i in 0..4 {
            quad[i].store(room(&mut to.0[i], 0));
        }
    }

    /// Zero-extends what it finds.
    #[inline(always)]
    fn lookup16(bytes: U8, indices: U16) -> I16 {
        bytes.lookup((indices | Z << 8).bitcast()).bitcast()
    }

    #[inline(always)]
    fn widened(bytes: U8) -> [I16; 2] {
        let (lower, upper) = bytes.interleave_in_blocks(U8::zero());
        [lower.bitcast(), upper.bitcast()]
    }

    #[inline(always)]
    fn even_and_odd(bytes: U8) -> [I16; 2] {
        let pairs: U16 = bytes.bitcast();
        [(pairs & 255).bitcast(), (pairs >> 8).bitcast()]
    }

    #[inline(always)]
    fn zip64(a: I16, b: I16) -> [I16; 2] {
        let (lower, upper) = a.bitcast::<U64>().interleave_in_blocks(b.bitcast());
        [lower.bitcast(), upper.bitcast()]
    }

    /// The first 8 bytes of each pair, then the others.
    #[inline(always)]
    fn in_order(it: I32) -> I32 {
        let [first, second] = it.bitcast::<U64>().halves();
        U64::from_halves(first.interleave(second).into()).bitcast()
    }

    #[inline(always)]
    fn transposed(quad: Quad) -> Quad {
        let mut pairs: [U32; 4] = quad.map(|it| it.bitcast());
        rotate(&mut pairs, 2);
        pairs.map(|it| it.bitcast())
    }

    #[inline(always)]
    fn difference(a: Quad, b: Quad) -> Quad {
        from_fn(|i| a[i] - b[i])
    }

    /// In both places of each pair.
    #[inline(always)]
    fn columns_of(block: U8) -> Quad {
        from_fn(|x| lookup16(block, U16::repeat([0, 0, 1, 1, 2, 2, 3, 3]) + 4 * x as u16))
    }

    /// From two columns of a pair in each vector.
    #[inline(always)]
    fn columns_of_pair([left, right]: [U8; 2]) -> Quad {
        let ([c0, c1], [c2, c3]) = (widened(left), widened(right));
        [c0, c1, c2, c3]
    }

    /// `(a * x + b * y + rounding) >> shift`. The sum, and `a`, `b` `<< (15 - shift)`, must not overflow.
    #[inline(always)]
    fn mixed(a: I16, b: I16, [x, y]: [i16; 2], rounding: i32, shift: u32) -> I16 {
        if HAS_WIDENING_MUL {
            // Adding and taking the upper halves is one instruction.
            let (up, times) = if shift < 16 { (15 - shift, 2) } else { (0, 1) };
            let [x, y] = [I16::splat(x * times), I16::splat(y * times)];
            let sums = widening_mul(a << up, x) + widening_mul(b << up, y);
            let upper_halves = ((sums + (rounding << up) * i32::from(times)) >> 16).cast();
            return I16::repeat(upper_halves.to_array()) >> shift.saturating_sub(16);
        }
        let (lower, upper) = a.interleave_in_blocks(b);
        let sums = |ab| (I32::pairwise_dot(ab, I16::repeat([x, y])) + rounding) >> shift;
        I16::pack(sums(lower), sums(upper))
    }

    /// From columns to rows. `FTransform_C` of libwebp.
    #[inline(always)]
    fn forward_dct([r0, r1, r2, r3]: Quad) -> Quad {
        let [a0, a1, a2, a3] = [r0 + r3, r1 + r2, r1 - r2, r0 - r3];
        let [r0, r1, r2, r3] = transposed([
            (a0 + a1) << 3,
            mixed(a2, a3, [2217, 5352], 1812, 9),
            (a0 - a1) << 3,
            mixed(a2, a3, [-5352, 2217], 937, 9),
        ]);
        let [a0, a1, a2, a3] = [r0 + r3 + 7, r1 + r2, r1 - r2, r0 - r3];
        [
            (a0 + a1) >> 4,
            // One more, except where `a3` is zero.
            mixed(a2, a3, [2217, 5352], 12000 + (1 << 16), 16) + a3.simd_eq(0).to_vector(),
            (a0 - a1) >> 4,
            mixed(a2, a3, [-5352, 2217], 51000, 16),
        ]
    }

    /// RFC 6386 section 14.3, in either direction.
    #[inline(always)]
    fn hadamard_pass([q0, q1, q2, q3]: Quad) -> Quad {
        let [a0, a1, a2, a3] = [q0 + q2, q1 + q3, q1 - q3, q0 - q2];
        [a0 + a1, a3 + a2, a3 - a2, a0 - a1]
    }

    /// From columns to rows that have columns 0, 2, 1 and 3 of one block, then those of the other.
    #[inline(always)]
    fn spectrum_of(columns: Quad) -> Quad {
        let [h0, h1, h2, h3] = hadamard_pass(columns);
        let (upper01, lower01) = h0.interleave_in_blocks(h1);
        let (upper23, lower23) = h2.interleave_in_blocks(h3);
        let (a0, a1) = (upper01 + lower01).interleave_in_blocks(upper23 + lower23);
        let (a3, a2) = (upper01 - lower01).interleave_in_blocks(upper23 - lower23);
        [a0 + a1, a3 + a2, a3 - a2, a0 - a1]
    }

    /// In each 16 bytes, the sums of each two lanes of `a`, then those of `b`.
    #[inline(always)]
    fn pairwise_sums(a: I32, b: I32) -> I32 {
        let (even, odd) = a.deinterleave_in_blocks(b);
        opaque((even + odd).bitcast()).bitcast()
    }

    /// Over all vectors and each two lanes.
    #[inline(always)]
    fn sums_of_products<const K: usize>(a: [I16; K], b: [I16; K]) -> I32 {
        if HAS_WIDENING_MUL {
            let sums = (0..K).fold(Vector::zero(), |sum, i| sum + widening_mul(a[i], b[i]));
            let [lower, upper] = sums.halves().map(|it| I32::repeat(it.to_array()));
            return pairwise_sums(lower, upper);
        }
        (0..K).fold(I32::zero(), |sum, i| sum + I32::pairwise_dot(a[i], b[i]))
    }

    /// In two lanes for each block. `TTransform` of libwebp.
    #[inline(always)]
    fn textures_of(spectrum: Quad) -> I32 {
        let weights = [
            [38, 20, 32, 9],
            [32, 17, 28, 7],
            [20, 10, 17, 4],
            [9, 4, 7, 2],
        ];
        let weights = weights.map(|it| opaque(I16::repeat(it)));
        sums_of_products(spectrum.map(|it| it.abs()), weights)
    }

    /// 16 times the squared error, the transform being orthogonal, and the change in texture.
    #[inline(always)]
    fn measure(decoded: Quad, source: &LumaSource, block: usize) -> [I32; 2] {
        let spectrum = spectrum_of(decoded);
        let error = from_fn(|y| spectrum[y] - I16::repeat(source.spectra[y][block]));
        let texture = textures_of(spectrum) - I32::repeat(source.textures[block]);
        [sums_of_products::<4>(error, error), texture]
    }

    /// The magnitude. `row` loads from the quantizer.
    #[inline(always)]
    fn level(it: I16, by: &Quantizer, y: usize, row: impl Fn([i16; 8]) -> I16) -> I16 {
        let (it, y) = (it.abs() + row(by.offsets[y]), y.min(1));
        // The product is taken apart into the nearest multiple of `1 << 15` and the rest.
        let rest = it * row(by.doubled_reciprocals[y]);
        (it.mul_q15(row(by.reciprocals[y])) + rest.simd_lt(row(by.excesses[y])).to_vector()) >> 2
    }

    /// No product: 46 of 32 bytes in 64 cycles lower the clock rate of Skylake to Cascade Lake.
    #[inline(always)]
    fn context_symbols(contexts: U8) -> U8 {
        const MULTIPLES: [u8; 16] = from_fn(const |i| (i % 3) as u8 * (MAX_SYMBOL + 1));
        U8::repeat(MULTIPLES).lookup(contexts)
    }

    struct Quantized {
        /// What a decoder makes of the levels.
        coefficients: Quad,
        /// 8 bytes for each block, of which the highest counts.
        ends: U8,
        magnitudes: U8,
        /// 8 bytes for each block, to add up.
        ac_counts: U8,
    }

    #[inline(always)]
    fn quantize<const ALL: usize>(
        coefficients: Quad,
        quantizer: &Quantizer,
        context: Context,
        out: &mut Candidates<ALL>,
        group: usize,
    ) -> Quantized {
        let magnitudes: Quad = from_fn(|y| level(coefficients[y], quantizer, y, I16::repeat));
        let upper = U8::pack(magnitudes[0], magnitudes[1]).simd_min(MAX_SYMBOL);
        let lower = U8::pack(magnitudes[2], magnitudes[3]).simd_min(MAX_SYMBOL);
        let (mut before, mut ends) = (context_symbols(U8::splat(context)), U8::zero());
        let [first, second] = from_fn(|half| {
            let places = U16::repeat(ZIGZAG[half]) * 0x0202 + 0x0100;
            let symbols = upper.lookup2(lower, places.bitcast());
            let contexts = symbols.simd_min(2);
            let after = context_symbols(contexts);
            let both: U16 = (symbols + before.shuffle::<ShiftIn>(after)).bitcast();
            both.store(room(&mut out.symbols[half], group));
            // The minimum is zero for a zero, and otherwise the sum.
            let behind = (U16::repeat([1, 2, 3, 4, 5, 6, 7, 8]) + 8 * half as u16) * 0x0404;
            ends = ends.simd_max(after.simd_min(contexts + behind.bitcast::<U8>()));
            before = after;
            symbols
        });
        let coefficients = from_fn(|y| {
            let levels = magnitudes[y].mul_sign(coefficients[y]);
            U32::store(levels.bitcast(), room(&mut out.levels[y], group));
            levels * I16::repeat(quantizer.steps[y.min(1)])
        });
        let is_ac: U8 = (U16::repeat([0, 1, 1, 1, 1, 1, 1, 1]) * 0x0101).bitcast();
        Quantized {
            coefficients,
            ends,
            magnitudes: upper.simd_max(lower),
            ac_counts: first.simd_min(is_ac) + second.simd_min(1),
        }
    }

    /// One byte of the 8 that each block has in `all[0]`, in `all[1]` and so on. The last repeats.
    #[inline(always)]
    fn reduced<const K: usize>(all: [U8; K], combine: impl Fn(U8, U8) -> U8) -> U8 {
        let merged = |a: U8, b: U8| {
            let (lower, upper) = a.bitcast::<U16>().interleave_in_blocks(b.bitcast());
            combine(lower.bitcast(), upper.bitcast())
        };
        let two = |i: usize| merged(all[i.min(K - 1)], all[(i + 4).min(K - 1)]);
        merged(merged(two(0), two(2)), merged(two(1), two(3)))
    }

    /// Adds them to first symbols and empty ends. `others`, like the result: 1 for `end >= 4`, else 0.
    #[inline(always)]
    fn set_contexts(
        ends: [U8; 8],
        (kind, others): (usize, [U8; 2]),
        blocks: &mut [Candidates<2>; 8],
        out_ends: &mut [[[u8; 2]; 8]; 2],
        group: usize,
    ) -> U8 {
        let ends = reduced(ends, U8::simd_max);
        let non_zero = ends.simd_min(1);
        let of = |side: usize| non_zero.lookup2(others[side], U8::repeat(NEIGHBORS[kind][side]));
        let contexts = of(0) + of(1);
        let ends = ends.simd_max(contexts);
        ends.store(room(out_ends.as_flattened_mut(), group));
        let (symbols, mut place) = (context_symbols(contexts), [Z << 8 | Z; 8]);
        #[rustc_unroll(full)]
        for i in 0..8 {
            place[usize::from(kind < 2)] = 0x0100 + 0x0202 * i as u16;
            let symbol: U16 = symbols.lookup(U16::repeat(place).bitcast()).bitcast();
            let to = room(&mut blocks[i].symbols[0], group);
            (U16::load(to) + symbol).store(to);
        }
        non_zero
    }

    /// From rows of coefficients to the left and the right two columns of samples.
    #[inline(always)]
    fn decode<const ALL: usize>(
        coefficients: Quad,
        prediction: Quad,
        out: &mut Candidates<ALL>,
        group: usize,
    ) -> [U8; 2] {
        let mut columns = transposed(inverse_dct_pass(coefficients));
        columns[0] += 4;
        let residual = inverse_dct_pass(columns);
        let [s0, s1, s2, s3] = from_fn(|x| (residual[x] >> 3) + prediction[x]);
        let (left, right) = (U8::pack(s0, s1), U8::pack(s2, s3));
        let edges = [6, 14, 22, 30, 28, 26, 24, 24, 7, 15, 23, 31, 29, 27, 25, 25];
        let edges = left.lookup2(right, U8::repeat(edges));
        edges.store(room(out.edges.as_flattened_mut(), group));
        [left, right]
    }

    /// The `nth` two lanes of each pair in the place of the DC, and zeros.
    #[inline(always)]
    fn as_dc(dcs: I16, nth: usize) -> I16 {
        const PLACES: [[u32; 4]; 4] =
            from_fn(const |i| [0x0302_0100 + 0x0404_0404 * i as u32, !0, !0, !0]);
        let bytes: U8 = dcs.bitcast();
        bytes.lookup(U32::repeat(PLACES[nth]).bitcast()).bitcast()
    }

    /// RFC 6386 section 12.2. A sample is the sum of a part for the row and one for the column.
    struct Predictor<const IS_CHROMA: bool> {
        from_left: Quad,
        from_above: [Quad; 4],
    }

    impl<const IS_CHROMA: bool> Predictor<IS_CHROMA> {
        /// With this added, 255 is the highest number there is.
        const BIAS: i16 = i16::MAX - 255;

        /// Pairs: DC and TrueMotion, vertical and horizontal, the first again, and one block further.
        #[inline(always)]
        fn new(edges: &Edges, group: usize) -> Self {
            const ABOVE: [[[u16; 2]; 4]; 4] = [[[Z, 0]; 4], [[0, Z]; 4], [[Z, 0]; 4], [[Z, 4]; 4]];
            const HAS_OFFSETS: [[i16; 8]; 4] = [[-1; 8], [0; 8], [-1; 8], [-1; 8]];
            let (left, above) = (U8::repeat(edges.left), U8::repeat(edges.above));
            let from_left = from_fn(|y| {
                let (plane, flip) = if IS_CHROMA { (y / 2, 1) } else { (0, 3) };
                let [dc, corner] = [edges.dc[plane], edges.above_left[plane]].map(i16::from);
                let offsets = I16::repeat([dc, -corner]) & I16::load(lanes(&HAS_OFFSETS, group));
                let indices = U16::repeat([Z, 3, Z, 2, Z, 1, Z, 0]) + 4 * (y ^ flip) as u16;
                lookup16(left, indices) + (offsets + Self::BIAS)
            });
            let first = U16::load(lanes(ABOVE.as_flattened(), group));
            let step = if group < 2 / PAIRS { 1 } else { PAIRS };
            let column = |x, i| lookup16(above, first + (4 * (x / step * step) + i) as u16);
            let from_above = from_fn(|x| from_fn(|i| column(x, i)));
            Self {
                from_left,
                from_above,
            }
        }

        #[inline(always)]
        fn predict(&self, block: usize) -> Quad {
            let (x, y) = match IS_CHROMA {
                true => (block / 4 * 2 + block % 2, block / 2),
                false => (block % 4, block / 4),
            };
            let sums = self.from_above[x].map(|it| self.from_left[y].saturating_add(it));
            sums.map(|it| U16::saturating_sub(it.bitcast(), Self::BIAS as u16).bitcast())
        }
    }

    #[inline(always)]
    fn prepare(luma: &[Block; 16], out: &mut LumaSource) {
        for i in 0..8 / PAIRS {
            let [a, b] = [2 * i, 2 * i + 1].map(|it| U8::load(lanes(luma.as_flattened(), it)));
            // Here a pair is two blocks.
            let spectrum = spectrum_of(columns_of_pair(a.interleave_in_blocks(b).into()));
            let spectrum: Quad = spectrum.map(|it| in_order(it.bitcast()).bitcast());
            let (a, b) = (columns_of(a), columns_of(b));
            for k in 0..4 {
                a[k].store(room(&mut out.columns[k], 2 * i));
                b[k].store(room(&mut out.columns[k], 2 * i + 1));
                spectrum[k].store(room(&mut out.spectra[k], i));
            }
            textures_of(spectrum).store(room(&mut out.textures, i));
        }
    }

    #[inline(always)]
    fn original(source: &LumaSource, block: usize) -> Quad {
        from_fn(|x| I16::repeat(source.columns[x][block]))
    }

    /// Adds the two halves of each pair: the sums for `a`, and those for `b`.
    #[inline(always)]
    fn by_mode(a: I32, b: I32) -> [Vector<i32, { N / 8 }>; 2] {
        let [lower, upper]: [I32; 2] = zip64(a.bitcast(), b.bitcast()).map(|it| it.bitcast());
        in_order(lower + upper).halves()
    }

    #[inline(always)]
    fn bytes(flags: [[bool; 4]; 2]) -> U8 {
        U32::repeat(flags.map(|it| u32::from_le_bytes(it.map(u8::from)))).bitcast()
    }

    /// `PickBestIntra16`: DC, TrueMotion, vertical, horizontal. Fills `source`. Around: above, left.
    #[export]
    pub fn try_luma_modes(
        samples: &Macroblock,
        edges: &Edges,
        non_zero_around: [[bool; 4]; 2],
        y2_context: Context,
        quantizer: &Quantizer,
        y2: &Quantizer,
        source: &mut LumaSource,
        out: &mut LumaCandidates,
    ) -> LumaSaturation {
        prepare(&samples.luma, source);
        let (ac, [mut magnitudes, mut y2_magnitudes]) = (&quantizer.without_dc(), [U8::zero(); 2]);
        for group in 0..2 / PAIRS {
            let predictor = Predictor::<false>::new(edges, group);
            let blocks: [_; 16] = from_fn(|i| {
                let prediction = predictor.predict(i);
                store(prediction, &mut source.kept[i][0]);
                let coefficients = forward_dct(difference(original(source, i), prediction));
                let it = quantize(coefficients, ac, 0, &mut out.blocks[i], group);
                store(it.coefficients, &mut source.kept[i][1]);
                magnitudes = magnitudes.simd_max(it.magnitudes);
                (coefficients[0], it.ends)
            });

            let mut around = [bytes(non_zero_around); 2];
            #[rustc_unroll(full)]
            for half in 0..2 {
                let ends = from_fn(|i| blocks[8 * half + i].1);
                let (blocks, to) = (&mut out.blocks.as_chunks_mut().0[half], &mut out.ends[half]);
                around[0] = set_contexts(ends, (half, around), blocks, to, group);
            }

            let dcs = from_fn(|x| transposed(from_fn(|y| blocks[4 * y + x].0))[0]);
            let halved = hadamard_pass(transposed(hadamard_pass(dcs))).map(|it| it >> 1);
            let it = quantize(halved, y2, y2_context, &mut out.y2, group);
            let y2_ends = reduced([it.ends], U8::simd_max).simd_max(y2_context);
            y2_ends.store(room(out.y2_ends.as_flattened_mut(), group));
            y2_magnitudes = y2_magnitudes.simd_max(it.magnitudes);
            let mut columns = transposed(hadamard_pass(it.coefficients));
            columns[0] += 3;
            let dcs = hadamard_pass(columns).map(|it| it >> 3);

            let [mut errors, mut differences] = [I32::zero(); 2];
            for two in 0..8 {
                let mut measured = [[I32::zero(); 2]; 2];
                #[rustc_unroll(full)]
                for i in [2 * two, 2 * two + 1] {
                    let [before, mut rows] = source.kept[i].each_ref().map(|it| load(it));
                    rows[0] += as_dc(dcs[i % 4], i / 4);
                    let decoded = decode(rows, before, &mut out.blocks[i], group);
                    measured[i % 2] = measure(columns_of_pair(decoded), source, i);
                }
                let [a, b] = measured;
                errors += pairwise_sums(a[0], b[0]);
                differences += pairwise_sums(a[1], b[1]).abs() >> 5;
            }
            let [errors, differences] = by_mode(errors, differences);
            (errors >> 4).store(&mut out.squared_errors.as_chunks_mut().0[group]);
            differences.store(&mut out.texture_differences.as_chunks_mut().0[group]);
        }
        let [blocks, y2] = [magnitudes, y2_magnitudes].map(|it| it.simd_eq(MAX_SYMBOL).any());
        LumaSaturation { blocks, y2 }
    }

    /// What it takes to quantize `dcs`, and half of the error. `CorrectDCValues` of libwebp.
    #[inline(always)]
    fn diffuse(dcs: I16, error_above: I16, error_left: I16, quantizer: &Quantizer) -> [I16; 2] {
        let corrected = dcs + error_left + ((error_above * 7) >> 3);
        let of_dc = |row: [i16; 8]| I16::splat(row[0]);
        let level = level(corrected, quantizer, 0, of_dc);
        let quantized = (level * of_dc(quantizer.steps[0])).mul_sign(corrected);
        [quantized - dcs, (corrected - quantized) >> 1]
    }

    /// Around: above, left. Errors: by block and plane, twice. True if a level reaches `MAX_SYMBOL`.
    #[export]
    pub fn try_chroma_modes(
        samples: &Macroblock,
        edges: &Edges,
        non_zero_around: [[bool; 4]; 2],
        quantizer: &Quantizer,
        errors_around: Option<&[[i16; 8]; 2]>,
        out: &mut ChromaCandidates,
    ) -> bool {
        let original = |i: usize| U32::repeat(samples.chroma[i].map(u32::from_le_bytes)).bitcast();
        let mut magnitudes = U8::zero();
        for group in 0..2 / PAIRS {
            let predictor = Predictor::<true>::new(edges, group);
            let first_rows: [_; 8] = from_fn(|i| {
                let prediction = predictor.predict(i);
                store(prediction, &mut out.kept[i][0]);
                let coefficients = forward_dct(difference(columns_of(original(i)), prediction));
                store(coefficients, &mut out.kept[i][1]);
                coefficients[0]
            });

            if let Some(&[above, left]) = errors_around {
                // U and V of one block in the lower half, and of another in the upper.
                let dcs = |a, b| transposed([a, 4 + a, b, 4 + b].map(|i| first_rows[i]))[0];
                let (above, left) = (I16::repeat(above), I16::repeat(left));
                let [to0, e0] = diffuse(dcs(0, 0), above, left, quantizer);
                let above = zip64(zip64(above, above)[1], e0)[0];
                let left = zip64(zip64(e0, e0)[0], left)[1];
                let [to12, e12] = diffuse(dcs(1, 2), above, left, quantizer);
                let [to3, e3] = diffuse(dcs(3, 3), e12, zip64(e12, e12)[1], quantizer);
                for (to, errors) in out.dc_errors.iter_mut().zip([e12, e3]) {
                    errors.store(room(to.as_flattened_mut().as_flattened_mut(), group));
                }
                for i in 0..8 {
                    let (change, nth) = [(to0, 0), (to12, 0), (to12, 2), (to3, 0)][i % 4];
                    let row = first_rows[i] + as_dc(change, nth + i / 4);
                    row.store(room(&mut out.kept[i][1].0[0], 0));
                }
            }

            let (mut errors, mut ac_counts) = ([I32::zero(); 2], U8::zero());
            let ends = from_fn(|i| {
                let [prediction, rows] = out.kept[i].each_ref().map(|it| load(it));
                let it = quantize(rows, quantizer, 0, &mut out.blocks[i], group);
                magnitudes = magnitudes.simd_max(it.magnitudes);
                ac_counts += it.ac_counts;
                let decoded = decode(it.coefficients, prediction, &mut out.blocks[i], group);
                let (decoded, samples) = (decoded.map(|it| even_and_odd(it)), widened(original(i)));
                for mode in 0..2 {
                    let error = from_fn(|half| decoded[half][mode] - samples[half]);
                    errors[mode] += sums_of_products::<2>(error, error);
                }
                it.ends
            });
            let (lower, upper) = errors[0].interleave_in_blocks(errors[1]);
            let [errors, _] = by_mode(lower + upper, lower);
            errors.store(&mut out.squared_errors.as_chunks_mut().0[group]);
            let ac_counts = reduced([ac_counts], |a, b| a + b);
            ac_counts.store(room(out.ac_counts.as_flattened_mut(), group));
            let around = [bytes(non_zero_around); 2];
            set_contexts(ends, (2, around), &mut out.blocks, &mut out.ends, group);
        }
        magnitudes.simd_eq(MAX_SYMBOL).any()
    }

    /// `PickBestIntra4`. Returns the highest end, or 255 if a level reaches `MAX_SYMBOL`.
    #[inline(always)]
    fn try_modes<const FIRST: usize, const GROUPS: usize>(
        edge: u128,
        context: Context,
        block: usize,
        source: &LumaSource,
        quantizer: &Quantizer,
        texture_weight: i32,
        out: &mut SubblockCandidates,
    ) -> u8 {
        let (block, edge) = (block % 16, U8::repeat(edge.to_le_bytes()));
        let at = U8::iota() & 15;
        let before = edge.lookup(at.saturating_sub(1));
        let after = edge.lookup((at + 1).simd_min(12));
        let outer = before.average_round(after) - ((before ^ after) & 1);
        let (of_three, of_two) = (outer.average_round(edge), before.average_round(edge));
        let next_to = [0, 1, 2, 3, 5, 6, 7, 8];
        let sum: I16 = U64::sums_of_8(edge.lookup(U8::repeat(next_to))).bitcast();
        let dc: U8 = ((sum + 4) >> 3).bitcast();
        let part = |indices| lookup16(edge, indices);
        let left = part(U16::repeat([3, 2, 1, 0])) - part(U16::splat(4));
        let above = |x| part(U16::repeat([5, 5, 5, 5, 6, 6, 6, 6]) + x);
        let true_motion = U8::pack(left + above(0), left + above(2));

        // Step by step for all modes, rather than mode by mode: each step waits for the one before.
        let [mut predictions, mut quads] = [[[I16::zero(); 4]; GROUPS]; 2];
        #[rustc_unroll(full)]
        for i in 0..GROUPS {
            let places = |x: usize| U16::load(lanes(&SUBBLOCK_COLUMNS[x], FIRST + i));
            let (mut from, mut dcs) = (of_three, I16::zero());
            if FIRST == 0 {
                let is_first_pair = (U8::iota() + (N * i) as u8).simd_lt(16);
                from = is_first_pair.select(true_motion, from);
                dcs = lookup16(dc, places(0) ^ Z);
            } else {
                from = from.lookup2(of_two, U8::load(lanes(&WINDOWS, FIRST + i)));
            }
            predictions[i] = from_fn(|x| lookup16(from, places(x)) | dcs);
            quads[i] = forward_dct(difference(original(source, block), predictions[i]));
        }
        let ([mut ends, mut ac_counts], mut magnitudes) = ([[U8::zero(); GROUPS]; 2], U8::zero());
        #[rustc_unroll(full)]
        for i in 0..GROUPS {
            let it = quantize(quads[i], quantizer, context, &mut out.block, FIRST + i);
            (quads[i], ends[i], ac_counts[i]) = (it.coefficients, it.ends, it.ac_counts);
            magnitudes = magnitudes.simd_max(it.magnitudes);
        }

        let ends = reduced(ends, U8::simd_max).simd_max(context);
        let may_be_flat = (U8::iota() + FIRST as u8).simd_ne(0).select(IS_FLAT, 0);
        // From 4 on, the difference is not negative.
        let is_flat = (reduced(ac_counts, |a, b| a + b) - 4) & may_be_flat;
        let mut flagged: U16 = (ends | is_flat).bitcast();
        if PAIRS == 2 {
            let [first, second] = flagged.halves();
            flagged = U16::from_halves(first.interleave(second).into());
        }
        let flagged = x128::U8::from_slice(&flagged.bitcast::<U8>().to_array());
        flagged.copy_to_slice(&mut out.ends[2 * PAIRS * FIRST..]);
        let last_end = (ends | magnitudes.simd_eq(MAX_SYMBOL).to_vector()).reduce_max();

        #[rustc_unroll(full)]
        for i in 0..GROUPS {
            let decoded = decode(quads[i], predictions[i], &mut out.block, FIRST + i);
            quads[i] = columns_of_pair(decoded);
        }
        let mut measured = [[I32::zero(); 2]; GROUPS];
        #[rustc_unroll(full)]
        for i in 0..GROUPS {
            measured[i] = measure(quads[i], source, block);
        }
        #[rustc_unroll(full)]
        for i in 0..GROUPS.div_ceil(2) {
            let (a, b) = (measured[2 * i], measured[(2 * i + 1).min(GROUPS - 1)]);
            // Both fit 15 bits.
            let difference: I16 = (pairwise_sums(a[1], b[1]).abs() >> 5).bitcast();
            let weighted = I32::pairwise_dot(difference, I32::splat(texture_weight).bitcast());
            let distortions = ((pairwise_sums(a[0], b[0]) << 4) + 128 + weighted) & -256;
            let to = &mut out.distortions[2 * PAIRS * (FIRST + 2 * i)..];
            in_order(distortions).copy_to_slice(to);
        }
        last_end
    }

    /// The first 4 modes. `edge`, from the lowest byte: 4 up the left, the corner, 8 to the right.
    #[export]
    pub fn try_straight_modes(
        edge: u128,
        context: Context,
        block: usize,
        source: &LumaSource,
        quantizer: &Quantizer,
        texture_weight: i32,
        out: &mut SubblockCandidates,
    ) -> u8 {
        try_modes::<0, { 2 / PAIRS }>(edge, context, block, source, quantizer, texture_weight, out)
    }

    /// The same for the other 6 modes. What `out` has for the first 4 stays.
    #[export]
    pub fn try_diagonal_modes(
        edge: u128,
        context: Context,
        block: usize,
        source: &LumaSource,
        quantizer: &Quantizer,
        texture_weight: i32,
        out: &mut SubblockCandidates,
    ) -> u8 {
        const FIRST: usize = 2 / PAIRS;
        try_modes::<FIRST, { 4 - PAIRS }>(
            edge,
            context,
            block,
            source,
            quantizer,
            texture_weight,
            out,
        )
    }

    /// U and V of one row. For each, the factors of red, green and blue add up to zero.
    #[inline(always)]
    fn chroma_of([r, g, b]: [I16; 3]) -> [I16; 2] {
        let plane = |factors| mixed(b - r, b - g, factors, (128 << 18) + (1 << 17), 18);
        [plane([9719, 19081]), plane([-28800, 24116])]
    }

    /// U and V of the rows `y` and `y + 1`, whose samples alternate.
    #[inline(always)]
    fn chroma_rows(colors: &LinearColors, gamma: &GammaTable, y: usize, group: usize) -> [I16; 2] {
        let mut rgb = [[I16::zero(); 3]; 2];
        #[rustc_unroll(full)]
        for color in 0..3 {
            let row = |y: usize| U16::load(lanes(&colors.sums[color][y], group));
            let sums: [I16; 2] = [row(y).bitcast(), row(y + 1).bitcast()];
            let indices = U8::pack(sums[0] >> 9, sums[1] >> 9);
            let [values, slopes] = [&gamma.values, &gamma.slopes].map(|table| {
                let [lower, upper] = [0, 1].map(|i| U8::repeat::<16>(table.as_chunks().0[i]));
                lower.lookup2(upper, indices)
            });
            let slopes: [U8; 2] = U8::zero().interleave_in_blocks(slopes).into();
            for i in 0..2 {
                // `(slope * fraction + 64) >> 7`
                let more = slopes[i].bitcast::<I16>().mul_q15(sums[i] & 511);
                rgb[i][color] = (widened(values)[i] << 2) + more;
            }
        }
        let ([u, v], [next_u, next_v]) = (chroma_of(rgb[0]), chroma_of(rgb[1]));
        [u | next_u << 8, v | next_v << 8]
    }

    /// Luma from the rows of `pixels`, and chroma from `colors`. yuv.h of libwebp.
    #[export]
    pub fn convert(
        pixels: &[&[[u8; 4]; 16]; 16],
        colors: &LinearColors,
        gamma: &GammaTable,
        out: &mut Macroblock,
    ) {
        for group in 0..16 / PAIRS {
            let (y, x) = (group / (4 / PAIRS), group % (4 / PAIRS));
            let [r0, r1, r2, r3] = from_fn(|i| {
                let rgba = U8::load(lanes(pixels[4 * y + i], x));
                let green = lookup16(rgba, U16::repeat([1, 1, 5, 5, 9, 9, 13, 13]));
                // The factor for green does not fit 15 bits.
                let factors = [[16839, 6420], [16529, 16530]].map(I16::repeat);
                let sums = sums_of_products([even_and_odd(rgba)[0], green], factors);
                (sums + ((16 << 16) + (1 << 15))) >> 16
            });
            let rows = U8::pack(I16::pack(r0, r1), I16::pack(r2, r3));
            let by_column = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
            let block = rows.lookup(U8::repeat(by_column));
            block.store(room(out.luma.as_flattened_mut(), group));
        }
        for group in 0..2 / PAIRS {
            let upper = chroma_rows(colors, gamma, 0, group);
            let lower = chroma_rows(colors, gamma, 2, group);
            for (plane, to) in out.chroma.as_chunks_mut::<4>().0.iter_mut().enumerate() {
                let (first, second) = upper[plane].interleave(lower[plane]);
                U8::store(first.bitcast(), room(to.as_flattened_mut(), 2 * group));
                U8::store(second.bitcast(), room(to.as_flattened_mut(), 2 * group + 1));
            }
        }
    }

    /// `CollectHistogram_C` of libwebp.
    #[inline(always)]
    fn histograms<const IS_CHROMA: bool, const GROUPS: usize>(
        blocks: &[Block],
        edges: &Edges,
    ) -> Histograms {
        let (predictor, mut last) = (Predictor::<IS_CHROMA>::new(edges, 2 / PAIRS), U8::zero());
        let bins: [_; GROUPS] = from_fn(|group| {
            let columns = columns_of(U8::load(lanes(blocks.as_flattened(), group)));
            let residual = difference(columns, predictor.predict(group * PAIRS));
            let [c0, c1, c2, c3] = forward_dct(residual).map(|it| it.abs() >> 3);
            let [upper, lower] = [U8::pack(c0, c1), U8::pack(c2, c3)].map(|it| it.simd_min(31));
            last = last.simd_max(upper.simd_max(lower));
            [upper, lower]
        });

        // Until what is left would not fill a bin higher than the highest.
        let (mut highest_count, mut left) = ([0; 2], [(16 * GROUPS * PAIRS) as u32; 2]);
        let mut bin = U8::zero();
        while left[0] > highest_count[0] || left[1] > highest_count[1] {
            let mut counts = U8::zero();
            for it in bins.as_flattened() {
                counts -= it.simd_eq(bin).to_vector();
            }
            let [even, odd] = even_and_odd(counts).map(|it| U64::sums_of_8(it.bitcast::<U8>()));
            let both = (even | odd << 32).reduce_sum();
            for i in 0..2 {
                let count = (both >> (32 * i)) as u32;
                highest_count[i] = count.max(highest_count[i]);
                left[i] -= count;
            }
            bin += 1;
        }
        Histograms {
            highest_count,
            last_bin: even_and_odd(last).map(|it| it.reduce_max() as u32),
        }
    }

    /// For luma and chroma.
    #[export]
    pub fn analyze(samples: &Macroblock, luma: &Edges, chroma: &Edges) -> [Histograms; 2] {
        [
            histograms::<false, { 16 / PAIRS }>(&samples.luma, luma),
            histograms::<true, { 8 / PAIRS }>(&samples.chroma, chroma),
        ]
    }
}
