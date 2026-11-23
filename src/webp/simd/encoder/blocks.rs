//! A block of 4x4 is four vectors, one per column or per row. 16 bytes have room for two blocks, whose lanes alternate:
//! a pair. Mostly these are two ways of predicting the same block. 32 bytes are two pairs side by side.

use super::super::common::*;
use super::types::*;
use bun_simd::prelude::*;

#[simd]
pub(crate) type W = Upto<B32, S>;
#[simd]
pub(crate) type V8 = Simd<u8, W<S>, S>;
#[simd]
pub(crate) type V16 = Simd<i16, W<S>, S>;
#[simd]
pub(crate) type V32 = Simd<i32, W<S>, S>;
#[simd]
pub(crate) type Quad = [V16<S>; 4];

#[simd]
pub(crate) const NEON: bool = has!(neon);
/// An index that gets zero.
pub(crate) const NONE: usize = 0x80;

#[simd]
pub(crate) const PAIRS_AT_ONCE: usize = W::<S>::BYTES / 16;

/// A constant `[[u8; 16]; $rows]` with `$f` as byte `$i` of row `$row`.
#[simd]
macro_rules! table {
    ($rows:literal, |$row:ident, $i:ident| $f:expr) => {
        const {
            let (mut rows, mut at) = ([[0u8; 16]; $rows], 0);
            while at < 16 * $rows {
                let ($row, $i): (usize, usize) = (at / 16, at % 16);
                rows[at / 16][at % 16] = $f as u8;
                at += 1;
            }
            rows
        }
    };
}
pub(crate) use table;

/// An expression for each vector of one or two quads.
#[simd]
macro_rules! each {
    ($q:expr, |$v:ident, $y:pat_param| $f:expr) => {{
        let q = $q;
        [
            {
                let ($v, $y) = (q[0], 0usize);
                $f
            },
            {
                let ($v, $y) = (q[1], 1usize);
                $f
            },
            {
                let ($v, $y) = (q[2], 2usize);
                $f
            },
            {
                let ($v, $y) = (q[3], 3usize);
                $f
            },
        ]
    }};
}
pub(crate) use each;

#[simd]
pub(crate) fn lookup16(bytes: V8<S>, indices: V8<S>) -> V16<S> {
    bytes.in_blocks().lookup_bytes_relaxed(indices).bitcast()
}

#[simd]
pub(crate) fn transposed(q: Quad<S>) -> Quad<S> {
    let (a, b) = (
        lower_as::<u32, _, _, S>(q[0], q[2]),
        lower_as::<u32, _, _, S>(q[1], q[3]),
    );
    let (c, d) = (
        upper_as::<u32, _, _, S>(q[0], q[2]),
        upper_as::<u32, _, _, S>(q[1], q[3]),
    );
    [
        lower_as::<u32, _, _, S>(a, b),
        upper_as::<u32, _, _, S>(a, b),
        lower_as::<u32, _, _, S>(c, d),
        upper_as::<u32, _, _, S>(c, d),
    ]
}

#[simd]
pub(crate) fn difference(a: Quad<S>, b: Quad<S>) -> Quad<S> {
    each!(a, |v, i| v - b[i])
}

/// The columns of a block, in both places of each pair.
#[simd]
pub(crate) fn columns(block: V8<S>) -> Quad<S> {
    let table = const { table!(4, |x, i| if i % 2 != 0 { NONE } else { 4 * x + i / 4 }) };
    each!(table, |row, _| lookup16(block, V8::repeat(&row)))
}

/// From two columns of a pair in each vector.
#[simd]
pub(crate) fn columns_of_two(left: V8<S>, right: V8<S>) -> Quad<S> {
    let ([a, b], [c, d]) = (
        left.in_blocks().interleave(V8::zero()),
        right.in_blocks().interleave(V8::zero()),
    );
    [a.bitcast(), b.bitcast(), c.bitcast(), d.bitcast()]
}

#[simd]
pub(crate) fn source_columns(source: &LumaSource, block: usize) -> Quad<S> {
    each!([0, 1, 2, 3], |x, _| V16::load_block(
        &source.columns[x][block]
    ))
}

/// `(a * by_a + b * by_b + rounding) >> shift`
#[simd]
fn rotated(a: V16<S>, b: V16<S>, [by_a, by_b]: [i16; 2], rounding: i32, shift: u32) -> V16<S> {
    if S::NEON {
        // Adding and taking the upper halves is one instruction.
        let (up, factor) = if shift == 16 { (0, 1) } else { (15 - shift, 2) };
        let by = [by_a * factor, by_b * factor];
        let [lower, upper] = ((a << up).in_blocks()).weighted_add(b << up, by, [V32::zero(); 2]);
        let rounding = rounding << (16 - shift);
        return ((lower + rounding) >> 16)
            .cast::<i16>()
            .concat(((upper + rounding) >> 16).cast::<i16>());
    }
    let [lower, upper] = (a.in_blocks()).weighted_add(b, [by_a, by_b], [V32::splat(rounding); 2]);
    (lower >> shift)
        .in_blocks()
        .saturating_narrow(upper >> shift)
}

/// From columns to rows.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/enc.c#L165
#[simd]
pub(crate) fn forward_dct(r: Quad<S>) -> Quad<S> {
    let (a0, a1, a2, a3) = (r[0] + r[3], r[1] + r[2], r[1] - r[2], r[0] - r[3]);
    let r = transposed([
        (a0 + a1) << 3,
        rotated(a2, a3, [2217, 5352], 1812, 9),
        (a0 - a1) << 3,
        rotated(a2, a3, [-5352, 2217], 937, 9),
    ]);
    let (a0, a1, a2, a3) = (r[0] + r[3] + 7, r[1] + r[2], r[1] - r[2], r[0] - r[3]);
    [
        (a0 + a1) >> 4,
        // One more, except where a3 is zero.
        rotated(a2, a3, [2217, 5352], 12000 + (1 << 16), 16) + a3.simd_eq(0).to_simd::<i16>(),
        (a0 - a1) >> 4,
        rotated(a2, a3, [-5352, 2217], 51000, 16),
    ]
}

#[simd]
pub(crate) fn hadamard_pass(q: Quad<S>) -> Quad<S> {
    let (a0, a1, a2, a3) = (q[0] + q[2], q[1] + q[3], q[1] - q[3], q[0] - q[2]);
    [a0 + a1, a3 + a2, a3 - a2, a0 - a1]
}

/// RFC 6386 section 14.3.
#[simd]
pub(crate) fn inverse_wht_pass(q: Quad<S>) -> Quad<S> {
    let (a0, a1, a2, a3) = (q[0] + q[3], q[1] + q[2], q[1] - q[2], q[0] - q[3]);
    [a0 + a1, a3 + a2, a0 - a1, a3 - a2]
}

/// The Hadamard transform, from columns to rows in which the lanes of a pair do not alternate: columns 0, 2, 1 and 3 of
/// the first block, then those of the second.
#[simd]
pub(crate) fn spectrum(columns: Quad<S>) -> Quad<S> {
    let h = hadamard_pass(columns);
    let ([upper01, lower01], [upper23, lower23]) = (
        h[0].in_blocks().interleave(h[1]),
        h[2].in_blocks().interleave(h[3]),
    );
    let (sums01, sums23) = (upper01 + lower01, upper23 + lower23);
    let (differences01, differences23) = (upper01 - lower01, upper23 - lower23);
    let ([a0, a1], [a3, a2]) = (
        sums01.in_blocks().interleave(sums23),
        differences01.in_blocks().interleave(differences23),
    );
    [a0 + a1, a3 + a2, a3 - a2, a0 - a1]
}

/// Adds up the products over the four vectors and over each two lanes.
#[simd]
pub(crate) fn sums_of_products(a: Quad<S>, b: Quad<S>) -> V32<S> {
    let mut sums = PairSums::new();
    for i in 0..4 {
        sums.mul_add(a[i], b[i]);
    }
    sums.total()
}

/// In two lanes for each block.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L517
#[simd]
pub(crate) fn textures(spectrum: Quad<S>) -> V32<S> {
    let weights = [
        [38, 32, 20, 9],
        [32, 28, 17, 7],
        [20, 17, 10, 4],
        [9, 7, 4, 2],
    ];
    let weights = each!(weights, |w, _| V16::repeat(&[w[0], w[2], w[1], w[3]]));
    sums_of_products(each!(spectrum, |v, _| v.abs()), weights)
}

/// All that `add_pairs` made of the first operand, then what it made of the second.
#[simd]
pub(crate) fn in_order(sums: V32<S>) -> V32<S> {
    if const { S::PAIRS_AT_ONCE > 1 } {
        sums.bitcast::<u64>().swizzle_groups([0, 2, 1, 3]).bitcast()
    } else {
        sums
    }
}

/// 16 times the squared error, the transform being orthogonal, and the texture of each of the blocks of a pair.
#[simd]
pub(crate) fn measure(decoded: Quad<S>, source: &LumaSource, block: usize) -> [V32<S>; 2] {
    let spectrum = spectrum(decoded);
    let error = each!(spectrum, |v, y| v - V16::repeat(&source.spectra[y][block]));
    [sums_of_products(error, error), textures(spectrum)]
}

/// `(magnitude * reciprocal + bias) >> 17`. The product is taken apart into the nearest multiple of `1 << 15` and the
/// rest.
#[simd]
pub(crate) fn level(
    magnitude: V16<S>,
    reciprocal: V16<S>,
    doubled_reciprocal: V16<S>,
    limit: V16<S>,
) -> V16<S> {
    let is_below = (magnitude * doubled_reciprocal).simd_lt(limit);
    // Here, in `context_symbols()` and in `decode()` a multiplication would do. With those, Skylake-SP lowers its clock.
    (magnitude.mul_q15_relaxed(reciprocal) + is_below.to_simd::<i16>()).rounding_shr_relaxed(2)
}

#[simd]
fn context_symbols(contexts: V8<S>) -> V8<S> {
    let table = const { table!(1, |_row, i| i % 3 * (MAX_SYMBOL as usize + 1)) };
    V8::repeat(&table[0])
        .in_blocks()
        .lookup_bytes_relaxed(contexts)
}

#[simd]
pub(crate) struct Quantized {
    /// What a decoder makes of the levels.
    pub(crate) coefficients: Quad<S>,
    /// For each block of a pair 8 bytes, of which the highest counts, or in the case of `ac_counts` the sum.
    pub(crate) ends: V8<S>,
    pub(crate) magnitudes: V8<S>,
    pub(crate) ac_counts: V8<S>,
}

/// Writes the levels of the pairs from `pair` on.
#[simd]
pub(crate) fn quantize<const SHARPENS: bool, const PAIRS: usize>(
    coefficients: Quad<S>,
    quantizer: &Quantizer,
    out: &mut Candidates<PAIRS>,
    pair: usize,
    context: u8,
) -> Quantized<S> {
    const ZIGZAG: [usize; 16] = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];
    let magnitudes = each!(coefficients, |v, y| {
        let it = if SHARPENS {
            v.abs() + V16::load_block(quantizer.sharpening[y].as_flattened())
        } else {
            v.abs()
        };
        let rows = [
            &quantizer.reciprocals,
            &quantizer.doubled_reciprocals,
            &quantizer.limits,
        ];
        let row = |i: usize| V16::load_block(rows[i][y.min(1)].as_flattened());
        level(it, row(0), row(1), row(2))
    });
    let order = const { table!(2, |half, i| 2 * ZIGZAG[8 * half + i / 2] + i % 2) };
    let end = const { table!(2, |half, i| 4 * (8 * half + i / 2 + 1)) };
    let upper = magnitudes[0]
        .in_blocks()
        .saturating_narrow::<u8>(magnitudes[1])
        .simd_min(MAX_SYMBOL);
    let lower = magnitudes[2]
        .in_blocks()
        .saturating_narrow::<u8>(magnitudes[3])
        .simd_min(MAX_SYMBOL);
    let first = upper
        .in_blocks()
        .concat_lookup_bytes(lower, V8::repeat(&order[0]));
    let second = upper
        .in_blocks()
        .concat_lookup_bytes(lower, V8::repeat(&order[1]));
    let (first_contexts, second_contexts) = (first.simd_min(2), second.simd_min(2));
    let (after_first, after_second) = (
        context_symbols(first_contexts),
        context_symbols(second_contexts),
    );
    let symbols = first
        + V8::splat(context * (MAX_SYMBOL + 1))
            .in_blocks()
            .shift_elements_left::<14>(after_first);
    symbols
        .bitcast()
        .store(out.symbols[0][pair..].as_flattened_mut());
    let symbols = second
        + after_first
            .in_blocks()
            .shift_elements_left::<14>(after_second);
    symbols
        .bitcast()
        .store(out.symbols[1][pair..].as_flattened_mut());
    // The minimum is zero for a zero, and otherwise the sum.
    let ends = (first_contexts + V8::repeat(&end[0]))
        .simd_min(after_first)
        .simd_max((second_contexts + V8::repeat(&end[1])).simd_min(after_second));
    Quantized {
        coefficients: each!(coefficients, |v, y| {
            let level = magnitudes[y].neg_if_negative_relaxed(v);
            level
                .bitcast()
                .store(out.levels[y][pair..].as_flattened_mut());
            level * V16::load_block(quantizer.steps[y.min(1)].as_flattened())
        }),
        ends,
        magnitudes: upper.simd_max(lower),
        ac_counts: first.simd_min(V8::repeat(&const { table!(1, |_row, i| i >= 2) }[0]))
            + second.simd_min(1),
    }
}

/// A byte for each, in the first 8 of each 16.
#[simd]
pub(crate) fn flags(flags: [[bool; 4]; 2]) -> V8<S> {
    let word = |it| u64::from(u32::from_le_bytes(array::map(it, u8::from)));
    let [low, high] = array::map(flags, word);
    Simd::<u64, W<S>, S>::splat(low | high << 32).bitcast()
}

#[simd]
pub(crate) fn is_saturated(magnitudes: V8<S>) -> bool {
    magnitudes.simd_eq(MAX_SYMBOL).any()
}

#[simd]
fn merged<const ADDS: bool>(a: V8<S>, b: V8<S>) -> V8<S> {
    let (lower, upper) = (
        lower_as::<u16, _, _, S>(a, b),
        upper_as::<u16, _, _, S>(a, b),
    );
    if ADDS {
        lower + upper
    } else {
        lower.simd_max(upper)
    }
}

/// Makes one byte of the 8 that each block has in `v[0]`, then in `v[1]` and so on. The last is repeated until there are 8.
#[simd]
pub(crate) fn reduced<const ADDS: bool>(v: &[V8<S>]) -> V8<S> {
    let last = v.len() - 1;
    let two = each!([0, 1, 2, 3], |i, _| merged::<ADDS, S>(
        v[last.min(i)],
        v[last.min(i + 4)]
    ));
    merged::<ADDS, S>(
        merged::<ADDS, S>(two[0], two[2]),
        merged::<ADDS, S>(two[1], two[3]),
    )
}

/// Puts the `contexts` of 8 blocks into their symbols at position `FIRST`, and into the ends of those that are empty.
#[simd]
pub(crate) fn set_contexts<const FIRST: usize>(
    contexts: V8<S>,
    ends: V8<S>,
    blocks: &mut [Candidates<2>],
    out_ends: &mut [[[u8; 2]; 8]; 2],
    pair: usize,
) {
    let place = const {
        table!(8, |block, i| if i / 2 == FIRST {
            2 * block + i % 2
        } else {
            NONE
        })
    };
    ends.simd_max(contexts)
        .store(out_ends[pair..].as_flattened_mut().as_flattened_mut());
    let symbols = context_symbols(contexts);
    for i in 0..8 {
        let to = blocks[i].symbols[0][pair..].as_flattened_mut();
        let before = Simd::<u16, W<S>, S>::load(to).bitcast::<u8>();
        (before + symbols.in_blocks().lookup_bytes(V8::repeat(&place[i])))
            .bitcast()
            .store(to);
    }
}

/// From rows of coefficients to columns of samples, whose edges are written.
#[simd]
pub(crate) fn decode<const PAIRS: usize>(
    coefficients: Quad<S>,
    prediction: Quad<S>,
    out: &mut Candidates<PAIRS>,
    pair: usize,
) -> Quad<S> {
    let mut half_way = transposed(inverse_dct_pass(coefficients));
    half_way[0] += 4;
    let sums = each!(inverse_dct_pass(half_way), |v, i| (v >> 3) + prediction[i]);
    let (left, right) = (
        sums[0].in_blocks().saturating_narrow::<u8>(sums[1]),
        sums[2].in_blocks().saturating_narrow::<u8>(sums[3]),
    );
    let edges = const {
        table!(1, |_row, i| {
            let at = if i % 8 < 6 { i % 8 } else { 6 };
            let (x, y) = if at < 3 { (at, 3) } else { (3, 6 - at) };
            x * 8 + y * 2 + i / 8
        })
    };
    left.in_blocks()
        .concat_lookup_bytes(right, V8::repeat(&edges[0]))
        .store(out.edges[pair..].as_flattened_mut().as_flattened_mut());
    columns_of_two(left, right)
}

/// The first lanes of each pair, which is where the DC is in the first row.
#[simd]
pub(crate) fn dcs_of(a: V16<S>, b: V16<S>, c: V16<S>, d: V16<S>) -> V16<S> {
    lower_as::<u64, _, _, S>(
        lower_as::<u32, _, _, S>(a, b),
        lower_as::<u32, _, _, S>(c, d),
    )
}

#[simd]
pub(crate) fn set_dc<const LANE: usize>(row: &mut V16<S>, dcs: V16<S>) {
    let is_first = MaskOf::<u32, W<S>, S>::from_bitmask(0x11);
    *row = is_first
        .select(
            dcs.bitcast().in_blocks().splat_lane::<LANE>(),
            row.bitcast::<u32>(),
        )
        .bitcast();
}
