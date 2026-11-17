//! VP8 to pixels, a row of macroblocks at a time.

mod bool_reader;
mod header;
mod modes;
mod planes;
mod reconstruct;
mod residuals;

use bun_highway::webp::FilterStrength;

pub(crate) use self::header::Header;
use self::header::Parameters;
use self::modes::LumaMode;
use self::planes::Planes;
use self::reconstruct::{LastRow, Neighbors};
use self::residuals::{Context, Residuals};
use super::SubblockMode;
use crate::array::At;
use crate::error::Result;
use crate::vec;

/// What a macroblock leaves to the one below.
#[derive(Clone, Copy)]
struct Bottom {
    modes: [SubblockMode; 4],
    context: Context,
    samples: LastRow,
}

impl Header<'_> {
    /// `alpha` is the content of the ALPH chunk.
    pub(crate) fn decode(self, alpha: Option<&[u8]>) -> Result<Vec<[u8; 4]>> {
        let (width, height) = (usize::from(self.width), usize::from(self.height));
        let [columns, rows] = self.macroblocks();
        let mut parameters = Parameters::parse(&self)?;
        let mut memory = Vec::new();
        let mut planes = Planes::new(width, height, parameters.filter_type, alpha, &mut memory)?;
        let above_picture = Bottom {
            modes: [SubblockMode::Dc; 4],
            context: Context::default(),
            samples: LastRow::ABOVE_PICTURE,
        };
        let mut row_above = vec::filled(above_picture, columns)?;
        let mut strengths = vec::filled(FilterStrength::default(), columns)?;
        let mut residuals = Residuals::new();

        for y in 0..rows {
            let mut tokens = *parameters.token_partition(y);
            let mut modes_left = [SubblockMode::Dc; 4];
            let mut context_left = Context::default();
            let mut neighbors = Neighbors::new(y);
            let mut aboves = row_above.as_mut_slice();
            let mut row = strengths.iter_mut().enumerate();
            while let Some(above) = aboves.split_off_first_mut()
                && let Some((x, strength)) = row.next()
            {
                let reader = &mut parameters.modes;
                let segment = parameters.segment_probabilities;
                let segment = segment.map_or(0, |it| modes::read_segment(reader, it));
                let segment = parameters.segments.at(segment);
                let is_skipped = parameters
                    .skip_probability
                    .is_some_and(|it| reader.read(it));
                let luma_mode = modes::read_luma_mode(reader, &mut above.modes, &mut modes_left);
                let chroma_mode = modes::read_chroma_mode(reader);

                let has_y2 = matches!(luma_mode, LumaMode::Whole(_));
                residuals.clear();
                if is_skipped {
                    above.context.clear(has_y2);
                    context_left.clear(has_y2);
                } else {
                    residuals.read(
                        &mut tokens,
                        &parameters.probabilities,
                        &segment.quantizers,
                        has_y2,
                        &mut above.context,
                        &mut context_left,
                    );
                }
                *strength = *segment.filter_strengths.at(usize::from(!has_y2));
                strength.filters_inner_edges |= residuals.non_zero != 0;

                let samples = neighbors.reconstruct(
                    &mut above.samples,
                    aboves.first().map(|it| &it.samples),
                    &luma_mode,
                    chroma_mode,
                    &residuals,
                );
                planes.store(x, samples);
            }
            parameters.modes.check_not_past_end()?;
            tokens.check_not_past_end()?;
            *parameters.token_partition(y) = tokens;
            planes.finish_row(y, &strengths);
        }
        Ok(planes.into_pixels())
    }
}
