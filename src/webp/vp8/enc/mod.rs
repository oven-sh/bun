//! `webp_enc.c`, `vp8i_enc.h`, with the configuration of `WebPEncodeRGBA` (the default preset, method 4) folded in.

mod analysis;
mod bit_writer;
mod cost;
mod dsp;
mod filter;
mod frame;
mod iterator;
mod picture;
mod quant;
mod syntax;
mod tables;
mod token;
mod tree;

use cost::Proba;
use dsp::QuantMatrix;
use picture::Picture;

use crate::container::Image;
use crate::util::{Checked, SliceExt, try_vec};
use crate::vp8::common::NUM_MB_SEGMENTS;
use crate::{Error, Input, Result};

const SNS_STRENGTH: i32 = 50;
const FILTER_STRENGTH: i32 = 60;
/// The highest quality at which the quantization errors on the DC of U and V go to the next blocks.
const ERROR_DIFFUSION_QUALITY: f32 = 98.0;

struct SegmentHeader {
    /// With a single segment, segments are not used.
    num_segments: usize,
    /// Whether each macroblock says which segment it is in.
    update_map: bool,
    /// The cost of the segments of all the macroblocks, in 1/256 bit.
    map_cost: u64,
}

#[derive(Clone, Copy, Default)]
struct MbInfo {
    /// Whether the luma is predicted as one 16x16 block rather than as 16 4x4 blocks.
    is_i16: bool,
    uv_mode: u8,
    segment: u8,
    /// The susceptibility to quantization.
    alpha: u8,
}

#[derive(Clone, Default)]
struct SegmentInfo {
    y1: QuantMatrix,
    y2: QuantMatrix,
    uv: QuantMatrix,
    /// The susceptibility to quantization, -127 to 127. The lower, the lower the risk of blur.
    alpha: i32,
    /// The susceptibility to filtering, 0 to 255.
    beta: i32,
    quant: i32,
    /// The strength of the loop filter.
    fstrength: i32,
    /// The largest step between 4x4 blocks seen in a macroblock with DC coefficients only.
    max_edge: i32,
    /// The distortion from which a macroblock counts for `max_edge`.
    min_disto: i64,
    lambda_i16: i32,
    lambda_i4: i32,
    lambda_uv: i32,
    lambda_mode: i32,
    tlambda: i32,
}

/// The errors on the DC of U and V that a macroblock passes on to the next: `[u or v][first or second block]`.
type DError = [[i8; 2]; 2];

struct Encoder<'a> {
    pic: &'a Picture,
    quality: f32,
    segment_hdr: SegmentHeader,
    /// The filter level of the frame header.
    filter_level: i32,
    /// The size in macroblocks.
    mb_w: usize,
    mb_h: usize,
    dqm: [SegmentInfo; NUM_MB_SEGMENTS],
    /// The susceptibility of U and V to quantization.
    uv_alpha: i32,
    /// What all segments add to their quantizer for the AC of U and V.
    dq_uv_ac: i32,
    proba: Proba,
    /// How much the modes of an i4x4 macroblock may cost, to keep the first partition within its limit.
    max_i4_header_bits: i32,
    mb_info: Vec<MbInfo>,
    /// The prediction modes of the 4x4 blocks, after a row and a column of `IntraMode::Dc`.
    preds: Vec<u8>,
    /// `4 * mb_w + 1`
    preds_w: usize,
}

impl<'a> Encoder<'a> {
    fn new(pic: &'a Picture, quality: f32) -> Result<Self> {
        let mb_w = pic.width.div_ceil(16);
        let mb_h = pic.height.div_ceil(16);
        let preds_w = 4 * mb_w + 1;
        Ok(Self {
            pic,
            quality,
            segment_hdr: SegmentHeader {
                num_segments: NUM_MB_SEGMENTS,
                update_map: true,
                map_cost: 0,
            },
            filter_level: 0,
            mb_w,
            mb_h,
            dqm: Default::default(),
            uv_alpha: 0,
            dq_uv_ac: 0,
            proba: Proba::new(),
            // 16 bits a 4x4 block: `partition_limit` is 0.
            max_i4_header_bits: 256 * 16 * 16,
            mb_info: try_vec(MbInfo::default(), mb_w * mb_h)?,
            preds: try_vec(0, preds_w * (4 * mb_h + 1))?,
            preds_w,
        })
    }

    /// Where the mode of the first 4x4 block of a macroblock is in `preds`.
    fn preds_pos(&self, x: usize, y: usize) -> usize {
        (4 * y + 1) * self.preds_w + 4 * x + 1
    }

    fn mb_mut(&mut self, x: usize, y: usize) -> Checked<&mut MbInfo> {
        self.mb_info.at_mut(y * self.mb_w + x)
    }

    /// Records the modes of a macroblock: those of its 4x4 blocks, or 16 times that of the whole.
    fn set_intra_modes(
        &mut self,
        x: usize,
        y: usize,
        is_i16: bool,
        modes: &[u8; 16],
        uv_mode: u8,
    ) -> Checked {
        let pos = self.preds_pos(x, y);
        let rows = self.preds.sub_mut(pos..)?.chunks_mut(self.preds_w);
        for (preds, modes) in rows.zip(modes.as_chunks::<4>().0) {
            preds.write_at(0, modes)?;
        }
        let mb = self.mb_mut(x, y)?;
        mb.is_i16 = is_i16;
        mb.uv_mode = uv_mode;
        Ok(())
    }
}

/// `WebPEncodeRGBA`, without the container.
pub(crate) fn encode(input: &Input<'_>, quality: f32) -> Result<Image> {
    if !(0.0..=100.0).contains(&quality) {
        return Err(Error::InvalidConfiguration);
    }
    let mut pic = Picture::import(input)?;
    // `exact` is off.
    pic.cleanup_transparent_area()?;

    let mut enc = Encoder::new(&pic, quality)?;
    analysis::analyze(&mut enc)?;
    let alpha = match &pic.a {
        Some(alpha) => Some(crate::alpha::enc::encode(alpha, pic.width, pic.height)?),
        None => None,
    };
    let tokens = frame::token_loop(&mut enc)?;
    Ok(Image {
        width: pic.width,
        height: pic.height,
        bitstream: syntax::write(&enc, tokens)?,
        is_lossless: false,
        alpha,
        lossless_has_alpha: false,
    })
}
