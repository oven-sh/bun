//! How coarsely the macroblocks of each segment are quantized, and how much they are filtered afterwards.

use bun_highway::webp::Quantizer;

use super::analysis::Analysis;
use super::cost::bit_cost;
use crate::array::At;
use crate::error::Result;
use crate::lossy::SEGMENTS;
use crate::lossy::tables::{AC_QUANTIZERS, DC_QUANTIZERS};
use crate::vec;

const MAX_FILTER_LEVEL: i32 = 63;
pub(super) const CHROMA_DC_DELTA: i8 = -2;

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L213
fn quantizer(steps: [u16; 2], biases: [u16; 2], sharpening: [[u16; 4]; 4]) -> Quantizer {
    let rows = |values: [u16; 2]| {
        let [dc, ac] = values.map(|it| [it as i16; 2]);
        [[dc, ac, ac, ac], [ac; 4]]
    };
    // For a step of 4, one less makes no difference.
    let reciprocals = steps.map(|step| ((1 << 17) / u32::from(step.max(4))).min(0x7fff) as u16);
    Quantizer {
        steps: rows(steps),
        reciprocals: rows(reciprocals),
        doubled_reciprocals: rows(reciprocals.map(|it| 2 * it)),
        limits: rows(biases.map(|bias| ((128 - bias) << 10) - 1)),
        sharpening: sharpening.map(|row| row.map(|it| [((it * steps[1]) >> 11) as i16; 2])),
    }
}

fn y2_ac_step(index: u8) -> u16 {
    (AC_QUANTIZERS.at(index.into()) * 155 / 100).max(8)
}

fn average_step([dc, ac]: [u16; 2]) -> i32 {
    i32::from(dc + 15 * ac + 8) >> 4
}

/// What the choice of modes for a macroblock goes by.
pub(super) struct Coding {
    pub(super) luma: Quantizer,
    pub(super) luma_without_dc: Quantizer,
    pub(super) y2: Quantizer,
    pub(super) chroma: Quantizer,
    pub(super) subblock_lambda: i32,
    pub(super) luma_lambda: i64,
    pub(super) chroma_lambda: i64,
    pub(super) mode_lambda: i64,
    pub(super) texture_lambda: i32,
    pub(super) min_distortion: i64,
    pub(super) diffuses_errors: bool,
    pub(super) max_subblock_modes_cost: i32,
}

impl Coding {
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L244
    fn new(index: u8, segments: &Segments, max_subblock_modes_cost: i32) -> Self {
        const SHARPENING: [[u16; 4]; 4] =
            [[0, 30, 60, 90], [30, 60, 90, 90], [60, 90, 90, 90], [90; 4]];
        let dc = |index: u8| u16::from(*DC_QUANTIZERS.at(index.into()));
        let ac = |index: u8| *AC_QUANTIZERS.at(index.into());
        let luma_steps = [dc(index), ac(index)];
        let y2_steps = [dc(index) * 2, y2_ac_step(index)];
        let chroma_steps = [
            dc(index.saturating_add_signed(CHROMA_DC_DELTA).min(117)),
            ac(index
                .saturating_add_signed(segments.chroma_ac_delta)
                .min(127)),
        ];
        let [luma_step, y2_step, chroma_step] =
            [luma_steps, y2_steps, chroma_steps].map(average_step);
        let luma = quantizer(luma_steps, [96, 110], SHARPENING);
        let mut luma_without_dc = luma;
        luma_without_dc.reciprocals[0][0] = [0; 2];
        Self {
            luma,
            luma_without_dc,
            y2: quantizer(y2_steps, [96, 108], [[0; 4]; 4]),
            chroma: quantizer(chroma_steps, [110, 115], [[0; 4]; 4]),
            subblock_lambda: ((3 * luma_step * luma_step) >> 7).max(1),
            luma_lambda: (3 * y2_step * y2_step).into(),
            chroma_lambda: ((3 * chroma_step * chroma_step) >> 6).max(1).into(),
            mode_lambda: ((luma_step * luma_step) >> 7).max(1).into(),
            texture_lambda: (50 * luma_step) >> 5,
            min_distortion: 20 * i64::from(dc(index)),
            diffuses_errors: segments.quality <= 98,
            max_subblock_modes_cost,
        }
    }
}

#[derive(Clone, Copy, Default)]
pub(super) struct Segment {
    quantizer_susceptibility: i8,
    filter_susceptibility: u8,
    pub(super) quantizer_index: u8,
    pub(super) filter_level: u8,
}

pub(super) struct Segments {
    pub(super) segments: [Segment; SEGMENTS],
    /// How many of them are different.
    pub(super) count: usize,
    pub(super) map: Vec<u8>,
    /// `None`: the map is not stored.
    pub(super) map_probabilities: Option<[u8; SEGMENTS - 1]>,
    pub(super) map_cost: u64,
    pub(super) chroma_ac_delta: i8,
    quality: u8,
}

impl Segments {
    pub(super) fn new(analysis: Analysis, quality: u8) -> Self {
        Self {
            segments: core::array::from_fn(|i| Segment {
                quantizer_susceptibility: *analysis.quantizer_susceptibilities.at(i),
                filter_susceptibility: *analysis.filter_susceptibilities.at(i),
                ..Segment::default()
            }),
            count: SEGMENTS,
            map: analysis.map,
            map_probabilities: None,
            map_cost: 0,
            chroma_ac_delta: ((analysis.chroma_susceptibility - 64) * 10 / 70 / 2).min(6) as i8,
            quality,
        }
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L406
    pub(super) fn start_pass(&mut self) {
        let quality = f64::from(self.quality) / 100.0;
        let linear = if quality < 0.75 {
            quality * (2.0 / 3.0)
        } else {
            2.0 * quality - 1.0
        };
        let compression = linear.powf(1.0 / 3.0);
        for segment in self.segments.iter_mut().take(self.count) {
            let exponent =
                1.0 - 0.9 * 50.0 / 100.0 / 128.0 * f64::from(segment.quantizer_susceptibility);
            segment.quantizer_index = (127.0 * (1.0 - compression.powf(exponent))) as u8;
        }
        let base = self.segments[0].quantizer_index;
        for segment in self.segments.iter_mut().skip(self.count) {
            segment.quantizer_index = base;
        }
        for segment in &mut self.segments {
            let step = i32::from(AC_QUANTIZERS.at(segment.quantizer_index.into()) >> 2);
            let susceptibility = i32::from(segment.filter_susceptibility);
            let level = step.min(MAX_FILTER_LEVEL) * 300 / (256 + susceptibility);
            segment.filter_level = if level < 2 {
                0
            } else {
                level.min(MAX_FILTER_LEVEL) as u8
            };
        }
        self.merge_equals();
        self.count_map();
    }

    pub(super) fn codings(&self, max_subblock_modes_cost: i32) -> Result<Box<[Coding; SEGMENTS]>> {
        let mut codings = vec::with_room(SEGMENTS)?;
        for segment in &self.segments {
            let index = segment.quantizer_index;
            codings.push(Coding::new(index, self, max_subblock_modes_cost));
        }
        vec::boxed(codings)
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/quant_enc.c#L366
    fn merge_equals(&mut self) {
        let mut merged = [0; SEGMENTS];
        let mut count = 0;
        for (segment, merged) in self.segments.into_iter().zip(&mut merged).take(self.count) {
            let equal = self.segments.iter().take(count).position(|other| {
                (other.quantizer_index, other.filter_level)
                    == (segment.quantizer_index, segment.filter_level)
            });
            *merged = equal.unwrap_or(count) as u8;
            if equal.is_none() {
                *self.segments.at_mut(count) = segment;
                count += 1;
            }
        }
        if count < self.count {
            for segment in &mut self.map {
                *segment = *merged.at((*segment).into());
            }
            let last = *self.segments.at(count.saturating_sub(1));
            self.segments
                .iter_mut()
                .skip(count)
                .for_each(|it| *it = last);
            self.count = count;
        }
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/frame_enc.c#L203
    fn count_map(&mut self) {
        if self.count == 1 {
            return;
        }
        let mut counts = [0; SEGMENTS];
        for &segment in &self.map {
            *counts.at_mut(segment.into()) += 1;
        }
        let [c0, c1, c2, c3]: [u32; SEGMENTS] = counts;
        let branches = [(c0 + c1, c2 + c3), (c0, c1), (c2, c3)];
        let probabilities = branches.map(|(zeros, ones)| {
            let total = zeros + ones;
            (255 * zeros + total / 2).checked_div(total).unwrap_or(255) as u8
        });
        let costs = branches
            .into_iter()
            .zip(probabilities)
            .map(|((zeros, ones), probability)| {
                zeros * u32::from(bit_cost(false, probability))
                    + ones * u32::from(bit_cost(true, probability))
            });
        self.map_cost = costs.map(u64::from).sum();
        self.map_probabilities = (probabilities != [255; SEGMENTS - 1]).then_some(probabilities);
        if self.map_probabilities.is_none() {
            self.map.fill(0);
        }
    }

    /// Raises the filter levels to what it takes to smooth out `max_edges`. Returns the highest.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/filter_enc.c#L220
    pub(super) fn adjust_filter_levels(&mut self, max_edges: [u16; SEGMENTS]) -> u8 {
        for (segment, max_edge) in self.segments.iter_mut().zip(max_edges) {
            let delta = (i32::from(max_edge) * i32::from(y2_ac_step(segment.quantizer_index))) >> 3;
            segment.filter_level = segment.filter_level.max(delta.min(MAX_FILTER_LEVEL) as u8);
        }
        self.segments
            .iter()
            .map(|it| it.filter_level)
            .fold(0, u8::max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_and_levels_have_limits() {
        let segments = |quality, filter_susceptibility| {
            let analysis = Analysis {
                map: Vec::new(),
                quantizer_susceptibilities: [0; SEGMENTS],
                filter_susceptibilities: [filter_susceptibility; SEGMENTS],
                chroma_susceptibility: 255,
            };
            let mut segments = Segments::new(analysis, quality);
            segments.start_pass();
            segments
        };
        let level =
            |quality, susceptibility| segments(quality, susceptibility).segments[0].filter_level;
        assert_eq!([level(0, 255), level(0, 0), level(100, 0)], [36, 63, 0]);
        let segments = segments(0, 255);
        assert_eq!(segments.chroma_ac_delta, 6);
        let [[dc, ac, ..], _] = Coding::new(127, &segments, 0).chroma.steps;
        assert_eq!([dc, ac], [[132; 2], [284; 2]]);
    }
}
