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
use self::reconstruct::Neighbors;
use self::residuals::{Context, Residuals};
use super::SubblockMode;
use crate::array::At;
use crate::error::Result;
use crate::vec;

impl Header<'_> {
    /// `alpha` is the content of the ALPH chunk.
    pub(crate) fn decode(self, alpha: Option<&[u8]>) -> Result<Vec<[u8; 4]>> {
        let (width, height) = (usize::from(self.width), usize::from(self.height));
        let columns = width.div_ceil(16);
        let mut parameters = Parameters::parse(&self)?;
        let mut memory = Vec::new();
        let mut planes = Planes::new(width, height, parameters.filter_type, alpha, &mut memory)?;
        let mut neighbors = Neighbors::new(columns)?;
        let mut contexts_above = vec::filled(([SubblockMode::Dc; 4], Context::default()), columns)?;
        let mut strengths = vec::filled(FilterStrength::default(), columns)?;
        let mut residuals = Residuals::new();

        for y in 0..height.div_ceil(16) {
            let mut tokens = *parameters.token_partition(y);
            let mut modes_left = [SubblockMode::Dc; 4];
            let mut context_left = Context::default();
            neighbors.start_row(y);
            let row = contexts_above.iter_mut().zip(&mut strengths);
            for (x, ((modes_above, context_above), strength)) in row.enumerate() {
                let reader = &mut parameters.modes;
                let segment = parameters.segment_probabilities;
                let segment = segment.map_or(0, |it| modes::read_segment(reader, it));
                let segment = parameters.segments.at(segment);
                let is_skipped = parameters
                    .skip_probability
                    .is_some_and(|it| reader.read(it));
                let luma_mode = modes::read_luma_mode(reader, modes_above, &mut modes_left);
                let chroma_mode = modes::read_chroma_mode(reader);

                let has_y2 = matches!(luma_mode, LumaMode::Whole(_));
                residuals.clear();
                if is_skipped {
                    context_above.clear(has_y2);
                    context_left.clear(has_y2);
                } else {
                    residuals.read(
                        &mut tokens,
                        &parameters.probabilities,
                        &segment.quantizers,
                        has_y2,
                        context_above,
                        &mut context_left,
                    );
                }
                *strength = *segment.filter_strengths.at(usize::from(!has_y2));
                strength.filters_inner_edges |= residuals.non_zero != 0;

                let samples = neighbors.reconstruct(x, &luma_mode, chroma_mode, &residuals)?;
                planes.store(x, samples)?;
            }
            parameters.modes.check_not_past_end()?;
            tokens.check_not_past_end()?;
            *parameters.token_partition(y) = tokens;
            planes.finish_row(y, &strengths)?;
        }
        Ok(planes.into_pixels())
    }
}
