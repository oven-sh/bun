//! Modes that predict 4x4 samples of luma.

use super::blocks::*;
use super::blocks::{NONE, table};
use super::types::*;
use bun_simd::prelude::*;

targets!(Upto<B32>);

/// RFC 6386 section 12.3. For each mode and sample: 0 to 12 for the average of three samples around that position of
/// the edge, 13 for the first sample of the edge, 16 and more for the average of two. The first two are made otherwise.
const SOURCES: [[[usize; 4]; 4]; 10] = [
    [[0; 4]; 4],
    [[0; 4]; 4],
    [[5, 6, 7, 8], [5, 6, 7, 8], [5, 6, 7, 8], [5, 6, 7, 8]],
    [[3, 3, 3, 3], [2, 2, 2, 2], [1, 1, 1, 1], [0, 0, 0, 0]],
    [[4, 5, 6, 7], [3, 4, 5, 6], [2, 3, 4, 5], [1, 2, 3, 4]],
    [
        [20, 21, 22, 23],
        [4, 5, 6, 7],
        [3, 20, 21, 22],
        [2, 4, 5, 6],
    ],
    [[6, 7, 8, 9], [7, 8, 9, 10], [8, 9, 10, 11], [9, 10, 11, 12]],
    [
        [21, 22, 23, 24],
        [6, 7, 8, 9],
        [22, 23, 24, 10],
        [7, 8, 9, 11],
    ],
    [
        [19, 4, 5, 6],
        [18, 3, 19, 4],
        [17, 2, 18, 3],
        [16, 1, 17, 2],
    ],
    [
        [18, 2, 17, 1],
        [17, 1, 16, 0],
        [16, 0, 13, 13],
        [13, 13, 13, 13],
    ],
];

/// No pair needs more than 16 of these. Each has a place of its own among those that the pair does need.
const fn needs(pair: usize, source: usize) -> bool {
    let mut i = 0;
    while i < 32 && SOURCES[2 * pair + i / 16][i / 4 % 4][i % 4] != source {
        i += 1;
    }
    i < 32
}

const fn place_of(pair: usize, source: usize) -> usize {
    if source == 0 {
        0
    } else {
        place_of(pair, source - 1) + needs(pair, source - 1) as usize
    }
}

const fn source_at(pair: usize, place: usize) -> usize {
    let mut source = 0;
    while source < 32 && !(needs(pair, source) && place_of(pair, source) == place) {
        source += 1;
    }
    source % 32
}

/// The sixth pair is the fifth again.
static PLACES: [[u8; 16]; 6] =
    const { table!(6, |pair, i| source_at(if pair < 4 { pair } else { 4 }, i)) };
/// By column and pair.
static COLUMNS: [[u8; 16]; 24] = const {
    table!(24, |row, i| {
        let (x, pair, y) = (row / 6, if row % 6 < 4 { row % 6 } else { 4 }, i / 4);
        let mode = 2 * pair + i / 2 % 2;
        if i % 2 != 0 || mode == 0 {
            NONE
        } else if mode == 1 {
            4 * x + y
        } else {
            place_of(pair, SOURCES[mode][y][x])
        }
    })
};

/// Runs the block for each group of modes. It is not a loop, so that the arrays become registers.
macro_rules! for_groups {
    ($i:ident in $groups:expr, $body:block) => {{
        let $i = 0;
        $body
    }
    if $groups > 1 {
        let $i = 1;
        $body
    }
    if $groups > 2 {
        let $i = 2;
        $body
    }};
}

#[simd]
fn by_mode(v: V8<S>) -> u8x16<S> {
    let v = v.bitcast::<u16>();
    if const { S::PAIRS_AT_ONCE > 1 } {
        v.block::<0>().interleave(v.block::<1>())[0].bitcast()
    } else {
        v.block::<0>().bitcast()
    }
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L830
#[simd]
fn try_modes<const FIRST: usize, const END: usize>(
    edge: u128,
    context: u8,
    index: usize,
    source: &LumaSource,
    quantizer: &Quantizer,
    texture_lambda: i32,
    out: &mut SubblockCandidates,
) -> u8 {
    let block = index % 16;

    let around = const {
        table!(3, |row, i| if i > 12 || i + row == 0 {
            0
        } else if i + row > 13 {
            12
        } else {
            i + row - 1
        })
    };
    let edge = Simd::<u64, W<S>, S>::repeat(&[edge as u64, (edge >> 64) as u64]).bitcast::<u8>();
    let before = edge.in_blocks().lookup_bytes(V8::repeat(&around[0]));
    let at = edge.in_blocks().lookup_bytes(V8::repeat(&around[1]));
    let after = edge.in_blocks().lookup_bytes(V8::repeat(&around[2]));
    let outer = before.midpoint(after);
    let (of_three, of_two) = (outer.midpoint_up(at), at.midpoint_up(after));

    let next_to = const { table!(1, |_row, i| if i < 8 { i + i / 4 } else { NONE }) };
    let dc = (edge
        .in_blocks()
        .lookup_bytes(V8::repeat(&next_to[0]))
        .sum_groups::<u64>()
        .bitcast::<i16>()
        + 4)
        >> 3;
    // By column: above, the corner, and left twice over.
    let parts = const {
        table!(4, |row, i| if i % 2 != 0 {
            NONE
        } else {
            [5 + i / 8, 7 + i / 8, 4, 3 - i / 2 % 4][row]
        })
    };
    let parts = each!(parts, |row, _| lookup16(edge, V8::repeat(&row)));
    let left = parts[3] - parts[2];
    let true_motion = (left + parts[0])
        .in_blocks()
        .saturating_narrow::<u8>(left + parts[1]);

    let original = source_columns(source, block);
    // Step by step for all modes, rather than mode by mode: each step has to wait for the one before it.
    let groups = (END - FIRST).div_ceil(S::PAIRS_AT_ONCE);
    let [mut predictions, mut quads] = [[[V16::zero(); 4]; 3]; 2];
    let [mut errors, mut textures] = [[V32::zero(); 3]; 2];
    let [mut ends, mut ac_counts] = [[V8::zero(); 3]; 2];
    let mut magnitudes = V8::zero();
    for_groups!(i in groups, {
        let pair = FIRST + i * S::PAIRS_AT_ONCE;
        let mut sources = of_three.in_blocks().concat_lookup_bytes(of_two, V8::load(PLACES[pair..].as_flattened()));
        let mut dcs = V16::zero();
        if pair == 0 {
            sources = sources.with_block::<0>(true_motion.block::<0>());
            let dc_at = const { table!(2, |pair, i| if pair != 0 || i % 4 != 0 { NONE } else { 0 }) };
            dcs = lookup16(dc.bitcast(), V8::load(dc_at.as_flattened()));
        }
        predictions[i] = each!([0, 1, 2, 3], |x, _| lookup16(sources, V8::load(COLUMNS[6 * x + pair..].as_flattened())) | dcs);
        quads[i] = forward_dct(difference(original, predictions[i]));
    });
    for_groups!(i in groups, {
        let quantized = quantize::<true, _, S>(quads[i], quantizer, &mut out.block, FIRST + i * S::PAIRS_AT_ONCE, context);
        (quads[i], ends[i], ac_counts[i]) = (quantized.coefficients, quantized.ends, quantized.ac_counts);
        magnitudes = magnitudes.simd_max(quantized.magnitudes);
    });
    let all_ends = by_mode(reduced::<false, S>(&ends[..groups]).simd_max(context));
    // From 4 on, the difference is not negative.
    let flags = const { table!(1, |_row, i| if i + FIRST != 0 { 128 } else { 0 }) };
    let is_flat = (by_mode(reduced::<true, S>(&ac_counts[..groups])) - 4) & flags[0];
    (all_ends | is_flat).store(&mut out.ends[2 * FIRST..]);
    let last_end = if is_saturated(magnitudes) {
        255
    } else {
        all_ends.reduce_max()
    };
    for_groups!(i in groups, {
        quads[i] = decode(quads[i], predictions[i], &mut out.block, FIRST + i * S::PAIRS_AT_ONCE);
    });
    for_groups!(i in groups, {
        [errors[i], textures[i]] = measure(quads[i], source, block);
    });
    for_groups!(a in groups, {
        if a % 2 == 0 {
            let b = (a + 1).min(groups - 1);
            let difference = textures[a].in_blocks().add_pairs(textures[b]) - source.textures[block];
            // Both fit 15 bits.
            let weighted = (difference.abs() >> 5).bitcast::<i16>().dot::<i32>(V32::splat(texture_lambda).bitcast());
            let distortions = (errors[a].in_blocks().add_pairs(errors[b]) << 4) + ((weighted + 128) & -256);
            in_order(distortions).store(&mut out.distortions[2 * (FIRST + a * S::PAIRS_AT_ONCE)..]);
        }
    });
    last_end
}

/// The first 4 modes, numbered as in libwebp. Returns the highest of their ends, or `u8::MAX` if any magnitude is
/// `MAX_SYMBOL` or more.
///
/// `edge` has 13 samples, from the lowest byte: up along the left, around the corner and to the right. `context` is how
/// many of the blocks above and to the left have levels other than zero.
#[kernel]
#[inline(never)]
pub(crate) fn try_straight_modes(
    edge: u128,
    context: u8,
    index: usize,
    source: &LumaSource,
    quantizer: &Quantizer,
    texture_lambda: i32,
    out: &mut SubblockCandidates,
) -> u8 {
    try_modes::<0, 2, S>(edge, context, index, source, quantizer, texture_lambda, out)
}

/// The same for the other 6 modes. What `out` has for the first 4 stays.
#[kernel]
#[inline(never)]
pub(crate) fn try_diagonal_modes(
    edge: u128,
    context: u8,
    index: usize,
    source: &LumaSource,
    quantizer: &Quantizer,
    texture_lambda: i32,
    out: &mut SubblockCandidates,
) -> u8 {
    try_modes::<2, 5, S>(edge, context, index, source, quantizer, texture_lambda, out)
}
