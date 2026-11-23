//! The kernels of the decoder, and those for lossless tiles, on each target of this CPU, against the formulas, and the others against a record.

use bun_simd::target::Target;
use core::array::from_fn;

use super::*;

const ROUNDS: usize = if cfg!(miri) { 3 } else { 300 };

struct Noise(u32);

impl Noise {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }

    fn below(&mut self, end: usize) -> usize {
        self.next() as usize % end
    }

    fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| (self.next() >> 8) as u8).collect()
    }

    /// With runs.
    fn pixels(&mut self, len: usize) -> Vec<[u8; 4]> {
        let mut pixel = [0; 4];
        let mut next = |_| {
            if self.below(3) != 0 {
                return pixel;
            }
            pixel = self.next().to_le_bytes();
            pixel
        };
        (0..len).map(&mut next).collect()
    }
}

/// `round` returns `None` if the kernel or the CPU does not have the target.
fn on_each_target(mut round: impl FnMut(Target, &mut Noise) -> Option<()>) {
    let mut ran = false;
    for target in inverse_dct::targets() {
        let mut noise = Noise(1);
        ran |= (0..ROUNDS).all(|_| round(target, &mut noise).is_some());
    }
    assert!(ran);
}

#[test]
fn coefficients_become_residuals() {
    let pass = |[a, b, c, d]: [i32; 4]| {
        let (cos, sin) = (|it| it + ((it * 20091) >> 16), |it| (it * 35468) >> 16);
        let (inner, outer) = (sin(b) - cos(d), cos(b) + sin(d));
        [a + c + outer, a - c + inner, a - c - inner, a + c - outer]
    };
    on_each_target(|target, noise| {
        let mut rows = [[0; 64]; 6];
        rows.as_flattened_mut()
            .fill_with(|| noise.next() as i16 >> 5);
        let mut expected = rows;
        for row in &mut expected {
            for x in (0..16).step_by(4) {
                let columns =
                    [0, 1, 2, 3].map(|i| pass([0, 16, 32, 48].map(|y| row[y + x + i].into())));
                for y in 0..4 {
                    let [a, b, c, d] = columns.map(|it| it[y]);
                    let residuals = pass([a + 4, b, c, d]).map(|it| (it >> 3) as i16);
                    row[16 * y + x..][..4].copy_from_slice(&residuals);
                }
            }
        }
        inverse_dct::to(target, &mut rows, 0xff_ffff)?;
        assert_eq!(rows, expected);
        inverse_dct::to(target, &mut rows, 0)?;
        assert_eq!(rows, expected);
        Some(())
    });
}

#[test]
fn chroma_is_upsampled() {
    on_each_target(|target, noise| {
        let count = noise.below(100);
        let padded = count.next_multiple_of(ROW_STEP);
        let from = [(); 2].map(|()| noise.bytes(padded + 1));
        let [mut upper, mut lower] = [(); 2].map(|()| vec![0; 2 * padded]);
        upsample_rows::to(target, &from[0], &from[1], count, &mut upper, &mut lower)?;
        for (y, row) in [upper, lower].iter().enumerate() {
            for (x, &sample) in row[..2 * count].iter().enumerate() {
                let at =
                    |across, down: usize| u32::from(from[y ^ down][x / 2 + ((x % 2) ^ across)]);
                let sum = 9 * at(0, 0) + 3 * at(1, 0) + 3 * at(0, 1) + at(1, 1);
                assert_eq!(u32::from(sample), (sum + 8) / 16);
            }
        }
        Some(())
    });
}

#[test]
fn yuv_becomes_rgba() {
    on_each_target(|target, noise| {
        let width = 1 + noise.below(100);
        let padded = width.next_multiple_of(ROW_STEP);
        let yuva = [(); 4].map(|()| noise.bytes(padded));
        let mut expected = vec![[7; 4]];
        expected.extend((0..width).map(|x| {
            let times = |plane: usize, factor| (i32::from(yuva[plane][x]) * factor) >> 8;
            let clamped = |it: i32| (it >> 6).clamp(0, 255) as u8;
            let luma = times(0, 19077);
            [
                clamped(luma + times(2, 26149) - 14234),
                clamped(luma - times(1, 6419) - times(2, 13320) + 8708),
                clamped(luma + times(1, 33050) - 17685),
                yuva[3][x],
            ]
        }));
        let [y, u, v, alpha] = &yuva;
        let mut rgba = Vec::with_capacity(1 + padded);
        rgba.push([7; 4]);
        append_row::to(target, y, u, v, alpha, &mut rgba, width)?;
        assert_eq!((&rgba, rgba.capacity()), (&expected, 1 + padded));
        rgba[1..].fill([0; 4]);
        replace_row::to(target, y, u, v, alpha, &mut rgba[1..])?;
        assert_eq!(rgba, expected);
        Some(())
    });
}

#[test]
#[should_panic]
fn rgba_does_not_grow() {
    append_rgba([&[0; ROW_STEP]; 4], &mut Vec::new(), 1);
}

/// RFC 9649 section 3.5.1.
fn predicted(mode: u8, around: [[u8; 4]; 4]) -> [u8; 4] {
    let distance = |from: usize| -> u32 {
        let channels = around[from].iter().zip(around[1]);
        channels.map(|(a, b)| u32::from(a.abs_diff(b))).sum()
    };
    let average = |a, b| (a + b) / 2;
    [0, 1, 2, 3].map(|i| {
        let [l, tl, t, tr] = around.map(|it| i32::from(it[i]));
        let channel = match mode {
            1 => l,
            2 => t,
            3 => tr,
            4 => tl,
            5 => average(average(l, tr), t),
            6 => average(l, tl),
            7 => average(l, t),
            8 => average(tl, t),
            9 => average(t, tr),
            10 => average(average(l, tl), average(t, tr)),
            11 if distance(2) < distance(0) => l,
            11 => t,
            12 => l + t - tl,
            13 => average(l, t) + (average(l, t) - tl) / 2,
            _ => [0, 0, 0, 255][i],
        };
        channel.clamp(0, 255) as u8
    })
}

#[test]
fn prediction_is_undone() {
    on_each_target(|target, noise| {
        let (width, bits) = (1 + noise.below(80), noise.below(6) as u32);
        let (mut row, mut above) = (noise.pixels(width), noise.pixels(width));
        let mut tiles = noise.pixels(((width - 1) >> bits) + 1);
        // Select after each of the others, where little decides.
        if noise.below(2) == 0 {
            let all = row.iter_mut().chain(&mut above).flatten();
            all.for_each(|it| *it &= 1);
            let second = tiles.iter_mut().skip(1).step_by(2);
            second.for_each(|it| it[1] = 11);
        }
        let mut expected = row.clone();
        for x in 0..width {
            let tr = *above.get(x + 1).unwrap_or(&expected[0]);
            let prediction = match x.checked_sub(1) {
                Some(left) => predicted(
                    tiles[x >> bits][1] & 15,
                    [expected[left], above[left], above[x], tr],
                ),
                None => above[0],
            };
            expected[x] = [0, 1, 2, 3].map(|i| row[x][i].wrapping_add(prediction[i]));
        }
        undo_prediction::to(target, &mut row, &above, &tiles, bits)?;
        assert_eq!(row, expected);
        Some(())
    });
}

/// RFC 9649 section 3.5.2.
#[test]
fn cross_color_is_undone() {
    on_each_target(|target, noise| {
        let (width, bits) = (noise.below(80), noise.below(6) as u32);
        let (mut row, tiles) = (noise.pixels(width), noise.pixels(width.div_ceil(1 << bits)));
        let delta = |by: u8, of: u8| ((i32::from(by as i8) * i32::from(of as i8)) >> 5) as u8;
        let mut expected = row.clone();
        for (x, [red, green, blue, _]) in expected.iter_mut().enumerate() {
            let [red_to_blue, green_to_blue, green_to_red, _] = tiles[x >> bits];
            *red = red.wrapping_add(delta(green_to_red, *green));
            *blue = blue.wrapping_add(delta(green_to_blue, *green));
            *blue = blue.wrapping_add(delta(red_to_blue, *red));
        }
        undo_cross_color::to(target, &mut row, &tiles, bits)?;
        assert_eq!(row, expected);
        Some(())
    });
}

#[test]
fn the_filters_stay_within_the_macroblocks_and_the_rows_above() {
    on_each_target(|target, noise| {
        let strength = FilterStrength {
            edge_limit: 250,
            interior_limit: 255,
            high_variance_threshold: 100,
            filters_inner_edges: true,
        };
        let strengths = vec![strength; 1 + noise.below(3)];
        let strides = [16, 8, 8].map(|size| 4 + size * strengths.len());
        let before = [(20, 0), (12, 1), (12, 2)].map(|(rows, i)| noise.bytes(rows * strides[i]));
        let mut after = before.clone();
        let [y, u, v] = after.each_mut().map(Vec::as_mut_slice);
        let mut planes = [(y, 0), (u, 1), (v, 2)].map(|(samples, i)| Plane {
            samples,
            stride: strides[i],
            start: 4 * strides[i] + 4,
        });
        filter_normally::to(target, &mut planes, &strengths, true)?;
        filter_simply::to(target, &mut planes[0], &strengths, true)?;
        for ((before, after), stride) in before.iter().zip(&after).zip(strides) {
            assert_eq!(before[..stride], after[..stride]);
            let mut rows = before.chunks(stride).zip(after.chunks(stride));
            assert!(before != after && rows.all(|(a, b)| a[..4] == b[..4]));
        }
        Some(())
    });
}

#[test]
fn the_costs_of_tiles_are_counted() {
    on_each_target(|target, noise| {
        let counts: [u16; 256] =
            core::array::from_fn(|_| (noise.next() >> noise.below(32)) as u16 >> 4);
        let bits = non_zero::to(target, &counts)?;
        assert!((0..256).all(|i| (bits[i / 64] >> (i % 64) & 1 != 0) == (counts[i] != 0)));

        let weights: [u32; 16] = core::array::from_fn(|_| noise.next() >> 1);
        let both = |i: usize| u64::from(counts[1 + i]) + u64::from(counts[255 - i]);
        let sum = (0..16).map(|i| (u64::from(weights[i]) * both(i) + 50) / 100);
        let parts = [weights.map(|it| it / 100), weights.map(|it| it % 100)];
        assert_eq!(
            weigh_ends::baseline(counts.last_chunk()?, &parts),
            sum.sum()
        );

        let [green, red, blue] = [(); 3].map(|()| [(); 8].map(|()| (noise.next() << 8) as i16));
        let (blue, count) = (blue.map(|it| it >> 8 & 255), *counts.first_chunk()?);
        let [from_green, from_red] = [(); 2].map(|()| noise.next() as i8);
        let [mut found, mut expected] = [[[0; 256]; 2]; 2];
        for i in 0..8 {
            let delta = |by: i8, color: i16| (i16::from(by) * (color >> 8)) >> 5;
            let rests = [red[i] >> 8, blue[i] - delta(from_red, red[i])];
            for (expected, rest) in expected.iter_mut().zip(rests) {
                expected[usize::from((rest - delta(from_green, green[i])) as u8)] += count[i];
            }
        }
        let colors = [EightColors {
            green,
            red,
            blue,
            count,
        }];
        count_rests::baseline::<true>(&colors, from_green, from_red, &mut found[0]);
        count_rests::baseline::<false>(&colors, from_green, from_red, &mut found[1]);
        assert_eq!(found, expected);
        Some(())
    });
}

struct Checksum(u64);

impl Checksum {
    fn add<T: Copy + Into<i64>>(&mut self, values: &[T]) {
        for &it in values {
            self.0 = (self.0 ^ it.into() as u64).wrapping_mul(0x100_0000_01b3);
        }
    }

    fn add_levels<const PAIRS: usize>(&mut self, it: &Candidates<PAIRS>, pairs: usize) {
        (it.levels.iter()).for_each(|row| self.add(row[..pairs].as_flattened()));
        (it.symbols.iter()).for_each(|half| self.add(half[..pairs].as_flattened()));
        let edges = it.edges[..pairs].as_flattened();
        edges.iter().for_each(|edge| self.add(&edge[..7]));
    }
}

fn checksum_of_the_encoder(target: Target) -> Option<u64> {
    let (mut noise, mut sum, mut out) = (Noise(1), Checksum(0), Scratch::default());
    let gamma = GammaTable {
        values: from_fn(|i| 8 * i as u8),
        slopes: from_fn(|i| 7 + u8::from(i % 3 == 0)),
    };
    for round in 0..30_000 {
        let colors = LinearColors {
            sums: from_fn(|_| from_fn(|_| from_fn(|_| from_fn(|_| noise.below(1 << 14) as u16)))),
        };
        let pixels: [[_; 16]; 16] = from_fn(|_| from_fn(|_| noise.next().to_le_bytes()));
        let mut samples = Macroblock::default();
        convert::to(target, &pixels.each_ref(), &colors, &gamma, &mut samples)?;
        sum.add(samples.luma.as_flattened().as_flattened());
        sum.add(samples.chroma.as_flattened().as_flattened());

        let (base, spread) = (noise.below(256), [1, 2, 5, 30, 256, 900][round % 6]);
        let mut sample = || {
            (base + noise.below(spread))
                .saturating_sub(spread / 2)
                .min(255) as u8
        };
        samples.luma = from_fn(|_| from_fn(|_| from_fn(|_| sample())));
        samples.chroma = from_fn(|_| from_fn(|_| from_fn(|_| sample())));
        let [luma_edges, chroma_edges] = [(); 2].map(|()| Edges {
            above: from_fn(|_| sample()),
            left: from_fn(|_| sample()),
            above_left: from_fn(|_| sample()),
            dc: from_fn(|_| sample()),
        });
        let edge = u128::from_le_bytes(from_fn(|_| sample())) >> 24;
        for it in analyze::to(target, &samples, &luma_edges, &chroma_edges)? {
            sum.add([it.highest_count, it.last_bin].as_flattened());
        }

        let most = [1, 9, 150][round / 6 % 3];
        let [luma, y2, chroma] = [(4, 90), (8, 0), (4, 0)].map(|(least, sharpening)| {
            let rows = |[dc, ac]: [usize; 2]| {
                [[dc, ac, ac, ac], [ac; 4]].map(|row| row.map(|it| [it as i16; 2]))
            };
            let steps = [(); 2].map(|()| least + noise.below(most));
            let reciprocals = steps.map(|it| ((1 << 17) / it).min(0x7fff));
            let sharpening = |at: usize| [((sharpening.min(30 * at) * steps[1]) >> 11) as i16; 2];
            Quantizer {
                steps: rows(steps),
                reciprocals: rows(reciprocals),
                doubled_reciprocals: rows(reciprocals.map(|it| 2 * it)),
                limits: rows([(32 << 10) - 1, (18 << 10) - 1]),
                sharpening: from_fn(|y| from_fn(|x| sharpening(x + y))),
            }
        });
        let mut ac = luma;
        ac.reciprocals[0][0] = [0; 2];
        let around = from_fn(|_| from_fn(|_| noise.below(2) == 0));
        let (context, source) = (noise.below(3) as u8, &mut out.source);

        let (edges, to) = (&luma_edges, &mut out.luma);
        let is_saturated = try_luma_modes::to(
            target, &samples, edges, around, context, &ac, &y2, source, to,
        )?;
        sum.add(&[is_saturated.blocks, is_saturated.y2]);
        (to.blocks.iter().chain([&to.y2])).for_each(|it| sum.add_levels(it, 2));
        sum.add(to.ends.as_flattened().as_flattened().as_flattened());
        sum.add(to.y2_ends.as_flattened().as_flattened());
        sum.add([to.squared_errors, to.texture_differences].as_flattened());

        let (index, lambda, to) = (noise.below(16), noise.below(250) as i32, &mut out.subblock);
        sum.add(&[
            try_straight_modes::to(target, edge, context, index, source, &luma, lambda, to)?,
            try_diagonal_modes::to(target, edge, context, index, source, &luma, lambda, to)?,
        ]);
        sum.add_levels(&to.block, 5);
        sum.add(&to.distortions[..10]);
        sum.add(&to.ends[..10]);

        let errors: [[[i16; 2]; 4]; 2] = from_fn(|_| from_fn(|_| [noise.below(99) as i16 - 49; 2]));
        let errors = errors.map(|it| from_fn(|i| it.as_flattened()[i]));
        let (errors, to) = ((round % 5 != 0).then_some(&errors), &mut out.chroma);
        let edges = &chroma_edges;
        let is_saturated =
            try_chroma_modes::to(target, &samples, edges, around, &chroma, errors, to)?;
        sum.add(&[is_saturated]);
        to.blocks.iter().for_each(|it| sum.add_levels(it, 2));
        sum.add(to.ends.as_flattened().as_flattened());
        sum.add(to.ac_counts.as_flattened().as_flattened());
        sum.add(&to.squared_errors);
        sum.add(to.dc_errors[0].as_flattened().as_flattened().as_flattened());
        (to.dc_errors[1].iter()).for_each(|pair| sum.add(pair[0].as_flattened()));
    }
    Some(sum.0)
}

fn checksum_of_the_filters(target: Target) -> Option<u64> {
    let (mut noise, mut sum) = (Noise(1), Checksum(0));
    for round in 0..4000 {
        let strengths: [_; 3] = from_fn(|_| {
            let level = noise.below([2, 9, 64][round % 3]);
            let interior_limit = level.min(1 + noise.below(63)) as u8;
            FilterStrength {
                edge_limit: 2 * level as u8 + interior_limit,
                interior_limit,
                high_variance_threshold: noise.below(3) as u8,
                filters_inner_edges: noise.below(2) == 0,
            }
        });
        // Blocks that differ by a step, with some grain.
        let (base, step, grain) = (noise.below(256), 1 << noise.below(7), 1 << noise.below(6));
        let mut samples = [16, 8, 8, 16].map(|size| {
            let blocks: [[_; 13]; 6] = from_fn(|_| from_fn(|_| base + noise.below(step)));
            let stride = 4 + 3 * size;
            let sample = |i: usize| blocks[i / stride / 4][i % stride / 4] + noise.below(grain);
            let all = (0..(4 + size) * stride + 4).map(sample);
            (all.map(|it| it.min(255) as u8).collect::<Vec<_>>(), stride)
        });
        let [y, u, v, mut alone] = samples.each_mut().map(|(samples, stride)| Plane {
            samples,
            stride: *stride,
            start: 4 * *stride + 4,
        });
        filter_normally::to(target, &mut [y, u, v], &strengths, round % 4 != 0)?;
        filter_simply::to(target, &mut alone, &strengths, round % 4 != 0)?;
        samples.iter().for_each(|it| sum.add(&it.0));
    }
    Some(sum.0)
}

#[test]
#[cfg_attr(miri, ignore = "takes too long")]
fn the_encoder_and_the_filters_compute_as_recorded() {
    for target in convert::targets() {
        let found = checksum_of_the_encoder(target);
        assert_eq!(found, Some(629318912704782459), "{target:?}");
        let found = checksum_of_the_filters(target);
        assert_eq!(found, Some(13676906706241761236), "{target:?}");
    }
}
