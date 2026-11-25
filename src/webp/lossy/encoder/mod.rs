//! Pixels to VP8, as libwebp does it with method 4.

mod analysis;
mod bool_writer;
mod border;
mod candidates;
mod chroma;
mod cost;
mod header;
mod luma;
mod memo;
mod picture;
mod segments;
mod tokens;

use bun_highway::webp::Scratch;

use self::bool_writer::BoolWriter;
use self::cost::Costs;
use self::header::Modes;
use self::memo::Memo;
use self::picture::Picture;
use self::segments::{Coding, Segments};
use self::tokens::Tokens;
use super::{BlockType, CoefficientProbabilities, FRAME_HEADER_LEN, SEGMENTS};
use crate::array::At;
use crate::error::{Error, Result};
use crate::slice::InBounds;
use crate::vec;

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/frame_enc.c#L37
const MAX_MODES_COST: u64 = ((header::MAX_FIRST_PARTITION_LEN as u64 + 1) - 2048) << 11;

/// The payload of a `VP8 ` chunk, padded to an even length.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/frame_enc.c#L788
// It and its stages are out of line, so that their stack frames do not add up.
#[inline(never)]
pub(crate) fn encode(
    rgba: &[[u8; 4]],
    width: usize,
    height: usize,
    has_alpha: bool,
    quality: u8,
) -> Result<Vec<u8>> {
    let picture = Picture::new(rgba, width, height, has_alpha)?;
    let mut segments = Segments::new(analysis::analyze(&picture)?, quality);
    let mut costs = Costs::new()?;
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/webp_enc.c#L108
    let mut max_subblock_modes_cost = 256 * 16 * 16;
    loop {
        segments.start_pass();
        let codings = segments.codings(max_subblock_modes_cost)?;
        let mut pass = Pass {
            tokens: Tokens::new(segments.map.len())?,
            modes: vec::with_room(segments.map.len())?,
            modes_cost: segments.map_cost,
            max_edges: [0; SEGMENTS],
        };
        pass.run(&picture, &segments.map, &codings, &mut costs)?;
        let can_cut_down = max_subblock_modes_cost > 0;
        if !can_cut_down || pass.modes_cost <= MAX_MODES_COST {
            let probabilities = pass.tokens.probabilities();
            match pass.write_modes(&mut segments, &probabilities, width, height) {
                Err(Error::TooLarge) if can_cut_down && pass.has_subblock_modes() => {}
                out => {
                    drop(picture);
                    return pass.tokens.append_to(out?, &probabilities);
                }
            }
        }
        max_subblock_modes_cost /= 2;
    }
}

/// The outcome of going through all macroblocks.
struct Pass {
    tokens: Tokens,
    modes: Vec<Modes>,
    modes_cost: u64,
    max_edges: [u16; SEGMENTS],
}

impl Pass {
    #[inline(never)]
    fn run(
        &mut self,
        picture: &Picture,
        map: &[u8],
        codings: &[Coding; SEGMENTS],
        costs: &mut Costs,
    ) -> Result<()> {
        let [scratch] = &mut *vec::default_array::<Scratch, 1>()?;
        let mut memos = vec::default_array::<(Memo<_, _, _>, Memo<_, _, _>), SEGMENTS>()?;
        let outside = (luma::Neighbor::default(), chroma::Neighbor::default());
        let mut row_above = vec::filled(outside, picture.width)?;
        let refresh_interval = (map.len() / 8).max(96);
        let mut until_refresh = refresh_interval;
        for (row, map) in picture.rows().zip(map.chunks(picture.width.max(1))) {
            let (mut left, mut above_left) = (outside, (None, None));
            let (mut macroblocks, mut aboves) = (row.iter().zip(map), row_above.as_mut_slice());
            while let Some(above) = aboves.split_off_first_mut()
                && let Some((samples, &segment)) = macroblocks.next()
            {
                if until_refresh == 0 {
                    costs.update(&self.tokens.probabilities());
                    for (luma, chroma) in memos.iter_mut() {
                        luma.forget();
                        chroma.forget();
                    }
                    until_refresh = refresh_interval;
                } else {
                    until_refresh -= 1;
                }
                let above_right = aboves.first().and_then(|it| it.0.samples);
                let coding = codings.at(segment.into());
                let (luma, chroma) = memos.at_mut(segment.into());
                let costs = &*costs.levels;
                let around = luma::Around {
                    above: above.0,
                    left: left.0,
                    above_left: above_left.0,
                    above_right,
                };
                let luma = luma.get(&samples.luma, &around, |out| {
                    luma::choose(samples, &around, coding, costs, scratch, out);
                });
                let around = chroma::Around {
                    above: above.1,
                    left: left.1,
                    above_left: above_left.1,
                };
                let chroma = chroma.get(&samples.chroma, &around, |out| {
                    chroma::choose(samples, &around, coding, costs, &mut scratch.chroma, out);
                });
                above_left = (above.0.samples, above.1.samples);
                *above = (luma.bottom, chroma.bottom);
                left = (luma.right, chroma.right);
                self.record(luma, chroma, segment)?;
            }
        }
        Ok(())
    }

    fn record(&mut self, luma: &luma::Choice, chroma: &chroma::Choice, segment: u8) -> Result<()> {
        self.modes.push(Modes {
            luma: luma.mode,
            chroma: chroma.mode,
        });
        self.modes_cost += (luma.mode_cost + chroma.mode_cost) as u64;
        let max_edge = self.max_edges.at_mut(segment.into());
        *max_edge = luma.edge.max(*max_edge);
        match luma.mode {
            luma::Mode::Whole(_) => {
                let y2 = core::slice::from_ref(&luma.y2);
                self.tokens.record(BlockType::Y2, y2)?;
                self.tokens
                    .record(BlockType::LumaWithoutDc, &luma.residuals)?;
            }
            luma::Mode::Subblocks(_) => {
                self.tokens.record(BlockType::LumaWithDc, &luma.residuals)?;
            }
        }
        self.tokens.record(BlockType::Chroma, &chroma.residuals)
    }

    fn has_subblock_modes(&self) -> bool {
        let mut modes = self.modes.iter();
        modes.any(|it| matches!(it.luma, luma::Mode::Subblocks(_)))
    }

    /// The frame up to the end of the first partition.
    #[inline(never)]
    fn write_modes(
        &self,
        segments: &mut Segments,
        probabilities: &CoefficientProbabilities,
        width: usize,
        height: usize,
    ) -> Result<Vec<u8>> {
        let filter_level = segments.adjust_filter_levels(self.max_edges);
        let mut writer = BoolWriter::new(vec::filled(0, FRAME_HEADER_LEN)?);
        header::write_parameters(&mut writer, segments, filter_level, probabilities);
        header::write_modes(&mut writer, segments, &self.modes, width.div_ceil(16));
        let mut out = writer.finish()?;
        let frame_header = header::uncompressed(width, height, out.len() - FRAME_HEADER_LEN)?;
        out.set_chunk(0, frame_header);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lossy::{MacroblockMode, SubblockMode};

    #[test]
    fn one_macroblock_is_enough_to_have_subblock_modes() -> Result<()> {
        let chroma = MacroblockMode::Dc;
        let whole = luma::Mode::Whole(chroma);
        let subblocks = luma::Mode::Subblocks([[SubblockMode::Dc; 4]; 4]);
        for (lumas, expected) in [
            ([whole; 2], false),
            ([whole, subblocks], true),
            ([subblocks, whole], true),
            ([subblocks; 2], true),
        ] {
            let pass = Pass {
                tokens: Tokens::new(0)?,
                modes: lumas.map(|luma| Modes { luma, chroma }).into(),
                modes_cost: 0,
                max_edges: [0; SEGMENTS],
            };
            assert_eq!(pass.has_subblock_modes(), expected);
        }
        Ok(())
    }
}
