//! Modes that predict a macroblock as a whole.

use super::super::common::*;
use super::blocks::*;
use super::types::*;
use bun_simd::prelude::*;
use core::mem::MaybeUninit;

targets!(Upto<B32>);

/// RFC 6386 section 12.2. The first pair is DC and TrueMotion, the second vertical and horizontal. A sample is the sum
/// of a part that depends on the row and one that depends on the column.
///
/// `STEP` is how far to the right of the first pair in a vector the second is. If that is zero it has the next modes.
#[simd]
struct Predictor {
    from_left: [V16<S>; 4],
    from_above: [V16<S>; 16],
}

#[simd]
impl Predictor<S> {
    /// With this added, 255 is the highest number there is.
    const BIAS: i16 = 32767 - 255;

    fn new<const STEP: usize>(edges: &Edges, pair: usize, is_chroma: bool) -> Self {
        let left_at = V8::repeat(
            &const { table!(1, |_row, i| if i % 4 == 2 { 3 - i / 4 } else { NONE }) }[0],
        );
        let above_at = &const {
            table!(
                2,
                |row, i| if i % 4 == (if row != 0 && STEP == 0 { 0 } else { 2 }) {
                    row * STEP
                } else {
                    NONE
                }
            )
        };
        let is_first = &const { table!(2, |row, _i| if row != 0 && STEP == 0 { 0 } else { 255 }) };
        let (above_at, is_first) = (
            V8::load(above_at[pair..].as_flattened()),
            V8::load(is_first[pair..].as_flattened()),
        );
        let (left, above) = (V8::load_block(&edges.left), V8::load_block(&edges.above));
        let from_left = each!([0, 1, 2, 3], |y, _| {
            let plane = if is_chroma { y / 2 } else { 0 };
            let offsets = V16::splat(edges.dc[plane] as i16)
                .alternate(V16::splat(-(edges.above_left[plane] as i16)));
            let start = if is_chroma { 4 * (y ^ 1) } else { 12 - 4 * y };
            lookup16(left, left_at + (start as u8)) + ((offsets & is_first.bitcast()) + Self::BIAS)
        });
        let mut from_above = [V16::zero(); 16];
        for x in 0..16 {
            from_above[x] = lookup16(above, above_at + (x as u8));
        }
        Self {
            from_left,
            from_above,
        }
    }

    fn predict(&self, x: usize, y: usize) -> Quad<S> {
        each!([0, 1, 2, 3], |i, _| {
            let sum = self.from_left[y]
                .saturating_add(self.from_above[4 * x + i])
                .bitcast::<u16>();
            sum.saturating_sub(Self::BIAS as u16).bitcast()
        })
    }

    fn luma(&self, block: usize) -> Quad<S> {
        self.predict(block % 4, block / 4)
    }

    fn chroma(&self, block: usize) -> Quad<S> {
        self.predict(block / 4 * 2 + block % 2, block / 2)
    }
}

/// The two numbers for each pair that are in the lower and in the upper half of its lanes.
#[simd]
fn store_halves(v: V32<S>, lower: &mut [i32; 4], upper: &mut [i32; 4], pair: usize) {
    let [first, second] = in_order(v).split();
    first.store(&mut lower[2 * pair..]);
    second.store(&mut upper[2 * pair..]);
}

#[simd]
fn load_blocks(blocks: &[Block]) -> V8<S> {
    V8::load(blocks.as_flattened().as_flattened())
}

/// Here a pair is two blocks next to each other.
#[simd]
fn prepare_textures(luma: &[Block; 16], out: &mut LumaSource, block: usize) -> V32<S> {
    let (first, second) = (
        load_blocks(&luma[block..]),
        load_blocks(&luma[block + S::PAIRS_AT_ONCE..]),
    );
    let [first, second] = first.as_u128s().interleave(second);
    let [left, right] = first.in_blocks().interleave(second);
    let spectrum = spectrum(columns_of_two(left, right));
    each!(spectrum, |v, y| v
        .store(out.spectra[y][block..].as_flattened_mut()));
    textures(spectrum)
}

#[simd]
fn prepare(luma: &[Block; 16], out: &mut LumaSource) {
    for block in (0..16).step_by(S::PAIRS_AT_ONCE) {
        each!(columns(load_blocks(&luma[block..])), |v, x| v
            .store(out.columns[x][block..].as_flattened_mut()));
    }
    for block in (0..16).step_by(4 * S::PAIRS_AT_ONCE) {
        let sums = prepare_textures(luma, out, block)
            .in_blocks()
            .add_pairs(prepare_textures(luma, out, block + 2 * S::PAIRS_AT_ONCE));
        in_order(sums).store(&mut out.textures[block..]);
    }
}

/// DC, TrueMotion, vertical and horizontal. Fills `source`. `non_zero_around` is for the blocks above and those to the
/// left. `ac` has to make zero of the first coefficient.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L778
#[kernel]
#[inline(never)]
pub(crate) fn try_luma_modes(
    samples: &Macroblock,
    edges: &Edges,
    non_zero_around: [[bool; 4]; 2],
    y2_context: u8,
    ac: &Quantizer,
    y2: &Quantizer,
    source: &mut LumaSource,
    out: &mut LumaCandidates,
) -> LumaSaturation {
    prepare(&samples.luma, source);
    let (mut magnitudes, mut y2_magnitudes) = (V8::zero(), V8::zero());
    for pair in (0..2).step_by(S::PAIRS_AT_ONCE) {
        let predictor = Predictor::new::<0>(edges, pair, false);
        let mut ends = [V8::zero(); 16];
        let mut blocks = [const { MaybeUninit::uninit() }; 16];
        let mut blocks = Output::new(&mut blocks);
        for block in 0..16 {
            let prediction = predictor.luma(block);
            let coefficients = forward_dct(difference(source_columns(source, block), prediction));
            let quantized =
                quantize::<true, _, S>(coefficients, ac, &mut out.blocks[block], pair, 0);
            ends[block] = quantized.ends;
            magnitudes = magnitudes.simd_max(quantized.magnitudes);
            blocks.push_one((quantized.coefficients, prediction, coefficients[0]));
        }
        let blocks = blocks.into_filled();

        // Above the first row, to the left of the upper two rows and to the left of the lower two.
        let at = const {
            table!(3, |row, i| if row == 0 {
                i / 2 % 4
            } else if i % 8 < 2 {
                2 + 2 * row + i / 8
            } else {
                NONE
            })
        };
        let around = |at| {
            flags(non_zero_around)
                .in_blocks()
                .lookup_bytes(V8::repeat(at))
        };
        let (upper_ends, lower_ends) = (
            reduced::<false, S>(&ends[..8]),
            reduced::<false, S>(&ends[8..]),
        );
        let (upper, lower) = (upper_ends.simd_min(1), lower_ends.simd_min(1));
        let left_of_upper = (upper.bitcast::<u64>() << 16).bitcast() | around(&at[1]);
        let left_of_lower = (lower.bitcast::<u64>() << 16).bitcast() | around(&at[2]);
        let above_upper = lower_as::<u64, _, _, S>(around(&at[0]), upper);
        let above_lower = upper.in_blocks().shift_elements_left::<8>(lower);
        set_contexts::<1, S>(
            above_upper + left_of_upper,
            upper_ends,
            &mut out.blocks[..8],
            &mut out.ends[0],
            pair,
        );
        set_contexts::<1, S>(
            above_lower + left_of_lower,
            lower_ends,
            &mut out.blocks[8..],
            &mut out.ends[1],
            pair,
        );

        let dcs = each!([0, 1, 2, 3], |x, _| dcs_of(
            blocks[x].2,
            blocks[4 + x].2,
            blocks[8 + x].2,
            blocks[12 + x].2
        ));
        let halved = each!(hadamard_pass(transposed(hadamard_pass(dcs))), |v, _| v >> 1);
        let quantized = quantize::<false, _, S>(halved, y2, &mut out.y2, pair, y2_context);
        let y2_ends = reduced::<false, S>(&[quantized.ends]).simd_max(y2_context);
        y2_ends.store(out.y2_ends[pair..].as_flattened_mut().as_flattened_mut());
        y2_magnitudes = y2_magnitudes.simd_max(quantized.magnitudes);
        let mut columns = transposed(inverse_wht_pass(quantized.coefficients));
        columns[0] += 3;
        each!(inverse_wht_pass(columns), |v, x| {
            set_dc::<0, S>(&mut blocks[x].0[0], v >> 3);
            set_dc::<1, S>(&mut blocks[4 + x].0[0], v >> 3);
            set_dc::<2, S>(&mut blocks[8 + x].0[0], v >> 3);
            set_dc::<3, S>(&mut blocks[12 + x].0[0], v >> 3);
        });

        let (mut errors, mut differences) = (V32::zero(), V32::zero());
        for i in (0..16).step_by(2) {
            let a = measure(
                decode(blocks[i].0, blocks[i].1, &mut out.blocks[i], pair),
                source,
                i,
            );
            let b = measure(
                decode(
                    blocks[i + 1].0,
                    blocks[i + 1].1,
                    &mut out.blocks[i + 1],
                    pair,
                ),
                source,
                i + 1,
            );
            let originals = V32::splat(source.textures[i])
                .in_blocks()
                .interleave(V32::splat(source.textures[i + 1]))[0];
            differences += (a[1].in_blocks().add_pairs(b[1])
                - originals.in_blocks().interleave(originals)[0])
                .abs()
                >> 5;
            errors += a[0] + b[0];
        }
        errors = errors.in_blocks().add_pairs(errors) >> 4;
        differences += differences.swizzle_groups([2, 3, 0, 1]);
        store_halves(
            lower_as::<u64, _, _, S>(errors, differences),
            &mut out.squared_errors,
            &mut out.texture_differences,
            pair,
        );
    }
    LumaSaturation {
        blocks: is_saturated(magnitudes),
        y2: is_saturated(y2_magnitudes),
    }
}

/// Quantizes `dcs`, and returns half of the error that makes.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L866
#[simd]
fn diffuse(dcs: &mut V16<S>, error_above: V16<S>, error_left: V16<S>, q: &Quantizer) -> V16<S> {
    let corrected = *dcs + error_left + ((error_above * 7) >> 3);
    let level = level(
        corrected.abs(),
        V16::splat(q.reciprocals[0][0][0]),
        V16::splat(q.doubled_reciprocals[0][0][0]),
        V16::splat(q.limits[0][0][0]),
    );
    *dcs = (level * q.steps[0][0][0]).neg_if_negative_relaxed(corrected);
    (corrected - *dcs) >> 1
}

/// The sums, in lanes that alternate like those of a pair.
#[simd]
fn squares(q: Quad<S>) -> V32<S> {
    let add = |a: V16<S>, b, sums| a.in_blocks().weighted_add(b, [a, b], sums);
    let [lower, upper] = add(q[2], q[3], add(q[0], q[1], [V32::zero(); 2]));
    lower + upper
}

/// `errors_around`, from above and from the left, are passed on from one DC to the next. They are by block and plane,
/// each twice. Returns whether any magnitude is `MAX_SYMBOL` or more.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L935
#[kernel]
#[inline(never)]
pub(crate) fn try_chroma_modes(
    samples: &Macroblock,
    edges: &Edges,
    non_zero_around: [[bool; 4]; 2],
    quantizer: &Quantizer,
    errors_around: Option<&[[i16; 8]; 2]>,
    out: &mut ChromaCandidates,
) -> bool {
    let mut magnitudes = V8::zero();
    for pair in (0..2).step_by(S::PAIRS_AT_ONCE) {
        let predictor = Predictor::new::<0>(edges, pair, true);
        // Not arrays of zeros that are filled in: LLVM keeps the zeros. `array::from_fn` leaves a copy.
        let mut blocks = [const { MaybeUninit::uninit() }; 8];
        let mut blocks = Output::new(&mut blocks);
        for block in 0..8 {
            let (original, prediction) = (
                columns(V8::load_block(samples.chroma[block].as_flattened())),
                predictor.chroma(block),
            );
            blocks.push_one([
                forward_dct(difference(original, prediction)),
                prediction,
                original,
            ]);
        }
        let blocks = blocks.into_filled();

        if let Some([above, left]) = errors_around {
            let (lower, upper) = (lower_as::<u64, i16, W<S>, S>, upper_as::<u64, i16, W<S>, S>);
            let (above, left) = (V16::load_block(above), V16::load_block(left));
            // U and V of one block in the lower half, and of another in the upper.
            let mut dcs0 = dcs_of(
                blocks[0][0][0],
                blocks[4][0][0],
                blocks[0][0][0],
                blocks[4][0][0],
            );
            let mut dcs12 = dcs_of(
                blocks[1][0][0],
                blocks[5][0][0],
                blocks[2][0][0],
                blocks[6][0][0],
            );
            let mut dcs3 = dcs_of(
                blocks[3][0][0],
                blocks[7][0][0],
                blocks[3][0][0],
                blocks[7][0][0],
            );
            let errors0 = diffuse(&mut dcs0, above, left, quantizer);
            let errors12 = diffuse(
                &mut dcs12,
                lower(upper(above, above), errors0),
                upper(lower(errors0, errors0), left),
                quantizer,
            );
            let errors3 = diffuse(&mut dcs3, errors12, upper(errors12, errors12), quantizer);
            errors12.store(
                out.dc_errors[0][pair..]
                    .as_flattened_mut()
                    .as_flattened_mut()
                    .as_flattened_mut(),
            );
            errors3.store(
                out.dc_errors[1][pair..]
                    .as_flattened_mut()
                    .as_flattened_mut()
                    .as_flattened_mut(),
            );
            set_dc::<0, S>(&mut blocks[0][0][0], dcs0);
            set_dc::<1, S>(&mut blocks[4][0][0], dcs0);
            set_dc::<0, S>(&mut blocks[1][0][0], dcs12);
            set_dc::<1, S>(&mut blocks[5][0][0], dcs12);
            set_dc::<2, S>(&mut blocks[2][0][0], dcs12);
            set_dc::<3, S>(&mut blocks[6][0][0], dcs12);
            set_dc::<0, S>(&mut blocks[3][0][0], dcs3);
            set_dc::<1, S>(&mut blocks[7][0][0], dcs3);
        }

        let (mut errors, mut ends, mut ac_counts) = (V32::zero(), [V8::zero(); 8], V8::zero());
        for block in 0..8 {
            let quantized = quantize::<false, _, S>(
                blocks[block][0],
                quantizer,
                &mut out.blocks[block],
                pair,
                0,
            );
            ends[block] = quantized.ends;
            magnitudes = magnitudes.simd_max(quantized.magnitudes);
            ac_counts += quantized.ac_counts;
            let e = difference(
                decode(
                    quantized.coefficients,
                    blocks[block][1],
                    &mut out.blocks[block],
                    pair,
                ),
                blocks[block][2],
            );
            errors += squares(e);
        }
        errors += errors.swizzle_groups([2, 3, 0, 1]);
        store_halves(errors, &mut out.squared_errors, &mut [0; 4], pair);
        reduced::<true, S>(&[ac_counts])
            .store(out.ac_counts[pair..].as_flattened_mut().as_flattened_mut());

        let above_at = const {
            table!(1, |_row, i| if i % 8 < 4 {
                i / 8 * 2 + i / 2 % 2
            } else {
                NONE
            })
        };
        let left_at = const { table!(1, |_row, i| if i % 4 < 2 { 4 + i / 4 } else { NONE }) };
        let around = |at| {
            flags(non_zero_around)
                .in_blocks()
                .lookup_bytes(V8::repeat(at))
        };
        let all_ends = reduced::<false, S>(&ends);
        let non_zero = all_ends.simd_min(1);
        let above = (non_zero.bitcast::<u64>() << 32).bitcast() | around(&above_at[0]);
        let left = (non_zero.bitcast::<u32>() << 16).bitcast() | around(&left_at[0]);
        set_contexts::<0, S>(above + left, all_ends, &mut out.blocks, &mut out.ends, pair);
    }
    is_saturated(magnitudes)
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/enc.c#L50
#[simd]
fn histograms<const BLOCKS: usize, const GROUPS: usize>(
    blocks: &[Block; BLOCKS],
    edges: &Edges,
) -> Histograms {
    let predictor = Predictor::new::<4>(edges, 0, BLOCKS == 8);
    let mut last = V8::zero();
    let bins: [_; GROUPS] = array::from_fn(
        #[inline(always)]
        |i| {
            let block = i * S::PAIRS_AT_ONCE;
            let prediction = if BLOCKS == 8 {
                predictor.chroma(block)
            } else {
                predictor.luma(block)
            };
            let c = each!(
                forward_dct(difference(
                    columns(load_blocks(&blocks[block..])),
                    prediction
                )),
                |v, _| v.abs() >> 3
            );
            let bins = [
                c[0].in_blocks().saturating_narrow::<u8>(c[1]).simd_min(31),
                c[2].in_blocks().saturating_narrow::<u8>(c[3]).simd_min(31),
            ];
            last = last.simd_max(bins[0].simd_max(bins[1]));
            bins
        },
    );
    let last_bin = [
        (last.bitcast::<u16>() & 255).reduce_max() as u32,
        (last.bitcast::<u16>() >> 8).reduce_max() as u32,
    ];

    // Until what is left would not fill a bin higher than the highest.
    let (mut highest_count, mut bin) = ([0; 2], V8::zero());
    let mut left = const { [16 * BLOCKS as u32; 2] };
    while left[0] > highest_count[0] || left[1] > highest_count[1] {
        let mut counts = V8::zero();
        for &it in bins.as_flattened() {
            counts -= it.simd_eq(bin).to_simd::<u8>();
        }
        let (even, odd) = (counts.bitcast::<u16>() & 255, counts.bitcast::<u16>() >> 8);
        let both = (even.bitcast::<u8>().sum_groups::<u64>()
            | odd.bitcast::<u8>().sum_groups::<u64>() << 32)
            .reduce_sum();
        for i in 0..2 {
            let count = (both >> (32 * i)) as u32;
            (highest_count[i], left[i]) =
                (highest_count[i].max(count), left[i].wrapping_sub(count));
        }
        bin += 1;
    }
    Histograms {
        highest_count,
        last_bin,
    }
}

/// For luma and chroma.
#[kernel]
#[inline(never)]
pub(crate) fn analyze(
    samples: &Macroblock,
    luma_edges: &Edges,
    chroma_edges: &Edges,
) -> [Histograms; 2] {
    if S::PAIRS_AT_ONCE > 1 {
        [
            histograms::<_, 8, S>(&samples.luma, luma_edges),
            histograms::<_, 4, S>(&samples.chroma, chroma_edges),
        ]
    } else {
        [
            histograms::<_, 16, S>(&samples.luma, luma_edges),
            histograms::<_, 8, S>(&samples.chroma, chroma_edges),
        ]
    }
}
