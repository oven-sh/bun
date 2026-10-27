//! `frame_dec.c`: reconstructs a row of macroblocks, filters it and hands over the rows that are final.

use super::dsp::{self, BPS, Edges, Thresholds, U_OFF, V_OFF, Y_OFF, YUV_SIZE, YuvB};
use super::io::{Emitter, Rows};
use super::{Decoder, FilterType, MbContext, MbData};
use crate::util::{Checked, SliceExt, try_vec};
use crate::vp8::common::{IntraMode, NUM_MB_SEGMENTS};
use crate::{DecodeError, Output, alpha};

/// How a macroblock is filtered.
#[derive(Clone, Copy, Default)]
pub(super) struct FInfo {
    /// 3 to 189, or 0 for no filtering.
    f_limit: u8,
    /// 1 to 63
    f_ilevel: u8,
    /// Whether the edges inside the macroblock are filtered too.
    pub(super) f_inner: bool,
    /// 0 to 2
    hev_thresh: u8,
}

/// The last row of a macroblock, for the prediction of the one below.
#[derive(Clone, Copy)]
struct TopSamples {
    y: [u8; 16],
    u: [u8; 8],
    v: [u8; 8],
}

pub(super) struct Frame<'a> {
    height: usize,
    mb_w: usize,
    mb_h: usize,
    pub(super) filter_type: FilterType,
    /// By segment, then by whether the macroblock is predicted in 4x4 blocks.
    pub(super) fstrengths: [[FInfo; 2]; NUM_MB_SEGMENTS],

    /// The modes of the 4x4 blocks above the current row of macroblocks, and to the left of the current macroblock.
    pub(super) intra_t: Vec<[IntraMode; 4]>,
    pub(super) intra_l: [IntraMode; 4],
    pub(super) mb_info: Vec<MbContext>,
    pub(super) left_info: MbContext,
    /// Empty without filtering.
    pub(super) f_info: Vec<FInfo>,
    pub(super) mb_data: Vec<MbData>,

    yuv_t: Vec<TopSamples>,
    yuv_b: YuvB,
    /// A row of macroblocks below `extra_y_rows` rows still to be filtered. Each element is one row of one macroblock.
    cache_y: Vec<[u8; 16]>,
    /// The same with half as many rows.
    cache_u: Vec<[u8; 8]>,
    cache_v: Vec<[u8; 8]>,

    alpha_data: Option<&'a [u8]>,
    emitter: Emitter,
}

/// Where the 4x4 blocks are in the work buffer.
#[rustfmt::skip]
const SCAN: [usize; 16] = [
    0,            4,            8,            12,
    4 * BPS,      4 + 4 * BPS,  8 + 4 * BPS,  12 + 4 * BPS,
    8 * BPS,      4 + 8 * BPS,  8 + 8 * BPS,  12 + 8 * BPS,
    12 * BPS,     4 + 12 * BPS, 8 + 12 * BPS, 12 + 12 * BPS,
];

#[inline]
fn do_transform(bits: u32, src: &[i16; 16], dst: &mut dsp::Block4) {
    match bits >> 30 {
        3 => dsp::transform_one(src, dst),
        2 => dsp::transform_ac3(src, dst),
        1 => dsp::transform_dc(src, dst),
        _ => {}
    }
}

/// `src` is the four blocks of the plane at `off`.
fn do_uv_transform(bits: u32, src: &[[i16; 16]], yuv_b: &mut YuvB, off: usize) -> Checked {
    if bits & 0xff == 0 {
        return Ok(());
    }
    let has_ac = bits & 0xaa != 0;
    for (src, at) in src.iter().zip([0, 4, 4 * BPS, 4 * BPS + 4]) {
        let dst = yuv_b.array_at_mut(off + at)?;
        if has_ac {
            dsp::transform_one(src, dst);
        } else if src[0] != 0 {
            dsp::transform_dc(src, dst);
        }
    }
    Ok(())
}

/// How many rows above a macroblock its filtering can change, or read in the case of the simple filter.
fn filter_extra_rows(filter_type: FilterType) -> usize {
    match filter_type {
        FilterType::Off => 0,
        FilterType::Simple => 2,
        FilterType::Complex => 8,
    }
}

fn precompute_filter_strengths(dec: &Decoder<'_>) -> [[FInfo; 2]; NUM_MB_SEGMENTS] {
    let hdr = &dec.filter_hdr;
    let mut fstrengths = [[FInfo::default(); 2]; NUM_MB_SEGMENTS];
    for (infos, &strength) in fstrengths.iter_mut().zip(&dec.segment_hdr.filter_strength) {
        let base_level = match (dec.segment_hdr.use_segment, dec.segment_hdr.absolute_delta) {
            (false, _) => hdr.level,
            (true, true) => i32::from(strength),
            (true, false) => i32::from(strength) + hdr.level,
        };
        for (info, i4x4) in infos.iter_mut().zip([false, true]) {
            let mut level = base_level;
            if hdr.use_lf_delta {
                level += hdr.ref_lf_delta[0];
                if i4x4 {
                    level += hdr.mode_lf_delta[0];
                }
            }
            let level = level.clamp(0, 63);
            if level > 0 {
                let mut ilevel = level;
                if hdr.sharpness > 0 {
                    ilevel >>= if hdr.sharpness > 4 { 2 } else { 1 };
                    ilevel = ilevel.min(9 - hdr.sharpness);
                }
                let ilevel = ilevel.max(1);
                info.f_ilevel = ilevel as u8;
                info.f_limit = (2 * level + ilevel) as u8;
                info.hev_thresh = match level {
                    40.. => 2,
                    15.. => 1,
                    _ => 0,
                };
            }
            info.f_inner = i4x4;
        }
    }
    fstrengths
}

impl<'a> Frame<'a> {
    /// `VP8EnterCritical` and `VP8InitFrame`
    pub(super) fn new(
        dec: &Decoder<'_>,
        alpha_data: Option<&'a [u8]>,
    ) -> Result<Self, DecodeError> {
        let emitter = Emitter::new(dec.width, dec.height)?;
        let mb_w = dec.mb_w;
        let filter_type = dec.filter_hdr.filter_type;
        let extra_rows = filter_extra_rows(filter_type);
        let top = TopSamples {
            y: [0; 16],
            u: [0; 8],
            v: [0; 8],
        };
        Ok(Self {
            height: dec.height,
            mb_w,
            mb_h: dec.mb_h,
            filter_type,
            fstrengths: precompute_filter_strengths(dec),
            intra_t: try_vec([IntraMode::Dc; 4], mb_w)?,
            intra_l: [IntraMode::Dc; 4],
            mb_info: try_vec(MbContext::default(), mb_w)?,
            left_info: MbContext::default(),
            f_info: match filter_type {
                FilterType::Off => Vec::new(),
                _ => try_vec(FInfo::default(), mb_w)?,
            },
            mb_data: try_vec(MbData::EMPTY, mb_w)?,
            yuv_t: try_vec(top, mb_w)?,
            yuv_b: [0; YUV_SIZE],
            cache_y: try_vec([0; 16], (16 + extra_rows) * mb_w)?,
            cache_u: try_vec([0; 8], (8 + extra_rows / 2) * mb_w)?,
            cache_v: try_vec([0; 8], (8 + extra_rows / 2) * mb_w)?,
            alpha_data,
            emitter,
        })
    }

    /// `VP8InitScanline`
    pub(super) fn init_scanline(&mut self) {
        self.left_info = MbContext::default();
        self.intra_l = [IntraMode::Dc; 4];
    }

    fn reconstruct_row(&mut self, mb_y: usize) -> Checked {
        let extra_rows = filter_extra_rows(self.filter_type);
        let yuv_b = &mut self.yuv_b;

        // There is nothing to the left of the first macroblock.
        for j in 0..16 {
            yuv_b.put(Y_OFF + j * BPS - 1, 129)?;
        }
        for j in 0..8 {
            yuv_b.put(U_OFF + j * BPS - 1, 129)?;
            yuv_b.put(V_OFF + j * BPS - 1, 129)?;
        }
        if mb_y > 0 {
            yuv_b[Y_OFF - 1 - BPS] = 129;
            yuv_b[U_OFF - 1 - BPS] = 129;
            yuv_b[V_OFF - 1 - BPS] = 129;
        } else {
            // Nor above the first row. It stays as it is for the whole row.
            yuv_b
                .sub_mut(Y_OFF - BPS - 1..)?
                .sub_mut(..16 + 4 + 1)?
                .fill(127);
            yuv_b
                .sub_mut(U_OFF - BPS - 1..)?
                .sub_mut(..8 + 1)?
                .fill(127);
            yuv_b
                .sub_mut(V_OFF - BPS - 1..)?
                .sub_mut(..8 + 1)?
                .fill(127);
        }

        for (mb_x, block) in self.mb_data.iter().enumerate() {
            // The last columns of the previous macroblock become the left samples, with the top left one.
            if mb_x > 0 {
                for j in 0..17 {
                    yuv_b.move_within(Y_OFF - BPS + j * BPS + 12, Y_OFF - BPS + j * BPS - 4, 4)?;
                }
                for j in 0..9 {
                    yuv_b.move_within(U_OFF - BPS + j * BPS + 4, U_OFF - BPS + j * BPS - 4, 4)?;
                    yuv_b.move_within(V_OFF - BPS + j * BPS + 4, V_OFF - BPS + j * BPS - 4, 4)?;
                }
            }
            if mb_y > 0 {
                let top_yuv = self.yuv_t.at_ref(mb_x)?;
                yuv_b.write_at(Y_OFF - BPS, &top_yuv.y)?;
                yuv_b.write_at(U_OFF - BPS, &top_yuv.u)?;
                yuv_b.write_at(V_OFF - BPS, &top_yuv.v)?;
            }

            let mut bits = block.non_zero_y;
            if block.is_i4x4 {
                const TOP_RIGHT: usize = Y_OFF - BPS + 16;
                if mb_y > 0 {
                    let top_right = match self.yuv_t.get(mb_x + 1) {
                        Some(next) => *next.y.array_at(0)?,
                        None => [self.yuv_t.at_ref(mb_x)?.y[15]; 4],
                    };
                    yuv_b.write_at(TOP_RIGHT, &top_right)?;
                }
                // The blocks of the last column all use the samples above the next macroblock.
                for j in 1..4 {
                    yuv_b.move_within(TOP_RIGHT, TOP_RIGHT + j * 4 * BPS, 4)?;
                }
                for ((&mode, coeffs), at) in block.imodes.iter().zip(&block.coeffs).zip(SCAN) {
                    dsp::predict_luma4(mode, yuv_b.array_at_mut(Y_OFF + at - BPS - 1)?);
                    do_transform(bits, coeffs, yuv_b.array_at_mut(Y_OFF + at)?);
                    bits <<= 2;
                }
            } else {
                dsp::predict_block::<16>(block.imodes[0], mb_y > 0, mb_x > 0, yuv_b, Y_OFF)?;
                if bits != 0 {
                    for (coeffs, at) in block.coeffs.iter().zip(SCAN) {
                        do_transform(bits, coeffs, yuv_b.array_at_mut(Y_OFF + at)?);
                        bits <<= 2;
                    }
                }
            }

            let bits_uv = block.non_zero_uv;
            dsp::predict_block::<8>(block.uvmode, mb_y > 0, mb_x > 0, yuv_b, U_OFF)?;
            dsp::predict_block::<8>(block.uvmode, mb_y > 0, mb_x > 0, yuv_b, V_OFF)?;
            do_uv_transform(bits_uv, block.coeffs.sub(16..20)?, yuv_b, U_OFF)?;
            do_uv_transform(bits_uv >> 8, block.coeffs.sub(20..24)?, yuv_b, V_OFF)?;

            if mb_y + 1 < self.mb_h {
                let top_yuv = self.yuv_t.at_mut(mb_x)?;
                top_yuv.y = *yuv_b.array_at(Y_OFF + 15 * BPS)?;
                top_yuv.u = *yuv_b.array_at(U_OFF + 7 * BPS)?;
                top_yuv.v = *yuv_b.array_at(V_OFF + 7 * BPS)?;
            }

            let mut at = extra_rows * self.mb_w + mb_x;
            for j in 0..16 {
                self.cache_y.put(at, *yuv_b.array_at(Y_OFF + j * BPS)?)?;
                at += self.mb_w;
            }
            let mut at = extra_rows / 2 * self.mb_w + mb_x;
            for j in 0..8 {
                self.cache_u.put(at, *yuv_b.array_at(U_OFF + j * BPS)?)?;
                self.cache_v.put(at, *yuv_b.array_at(V_OFF + j * BPS)?)?;
                at += self.mb_w;
            }
        }
        Ok(())
    }

    fn do_filter(&mut self, mb_x: usize, mb_y: usize) -> Checked {
        let stride = self.mb_w;
        let extra_rows = filter_extra_rows(self.filter_type);
        let f_info = self.f_info.at(mb_x)?;
        let y_dst = &mut self.cache_y;
        let y_at = extra_rows * stride + mb_x;
        let ilevel = f_info.f_ilevel;
        let limit = f_info.f_limit;
        if limit == 0 {
            return Ok(());
        }
        // The vertical edges first, and in each direction the edge of the macroblock before those inside it.
        if self.filter_type == FilterType::Simple {
            let inner = f_info.f_inner.then_some(limit);
            let outer = (mb_x > 0).then_some(limit + 4);
            dsp::simple_h_filter16(y_dst, y_at, stride, Edges { outer, inner })?;
            let outer = (mb_y > 0).then_some(limit + 4);
            dsp::simple_v_filter16(y_dst, y_at, stride, Edges { outer, inner })?;
        } else {
            let u_dst = &mut self.cache_u;
            let v_dst = &mut self.cache_v;
            let uv_at = extra_rows / 2 * stride + mb_x;
            let thresholds = |thresh| Thresholds {
                thresh,
                ithresh: ilevel,
                hev_thresh: f_info.hev_thresh,
            };
            let inner = f_info.f_inner.then(|| thresholds(limit));
            let outer = (mb_x > 0).then(|| thresholds(limit + 4));
            dsp::h_filter16(y_dst, y_at, stride, Edges { outer, inner })?;
            dsp::h_filter8(u_dst, v_dst, uv_at, stride, Edges { outer, inner })?;
            let outer = (mb_y > 0).then(|| thresholds(limit + 4));
            dsp::v_filter16(y_dst, y_at, stride, Edges { outer, inner })?;
            dsp::v_filter8(u_dst, v_dst, uv_at, stride, Edges { outer, inner })?;
        }
        Ok(())
    }

    /// Filters the row and writes what no later filtering changes.
    fn finish_row(&mut self, mb_y: usize, output: &mut Output<'_>) -> Result<(), DecodeError> {
        let y_stride = 16 * self.mb_w;
        let uv_stride = 8 * self.mb_w;
        let extra_y_rows = filter_extra_rows(self.filter_type);
        let ysize = extra_y_rows * y_stride;
        let uvsize = extra_y_rows / 2 * uv_stride;
        let is_first_row = mb_y == 0;
        let is_last_row = mb_y + 1 >= self.mb_h;

        if self.filter_type != FilterType::Off {
            for mb_x in 0..self.mb_w {
                self.do_filter(mb_x, mb_y)?;
            }
        }

        let mut y_start = mb_y * 16;
        let mut y_end = (mb_y + 1) * 16;
        let (mut y_offset, mut uv_offset) = (ysize, uvsize);
        if !is_first_row {
            y_start -= extra_y_rows;
            (y_offset, uv_offset) = (0, 0);
        }
        if !is_last_row {
            y_end -= extra_y_rows;
        }
        let y_end = y_end.min(self.height);
        // libwebp decodes alpha a few rows at a time, but ends up asking for every row, so this fails the same images.
        if let Some(alpha_data) = self.alpha_data.take() {
            let plane = alpha::dec::decode(alpha_data, self.emitter.width(), self.height)?;
            self.emitter.set_alpha(plane);
        }
        let rows = Rows {
            y: self.cache_y.as_flattened().sub(y_offset..)?,
            u: self.cache_u.as_flattened().sub(uv_offset..)?,
            v: self.cache_v.as_flattened().sub(uv_offset..)?,
            y_stride,
            uv_stride,
            mb_y: y_start,
            mb_h: y_end - y_start,
        };
        self.emitter.put(&rows, output)?;
        if !is_last_row {
            let (mb_w, extra_uv_rows) = (self.mb_w, extra_y_rows / 2);
            self.cache_y
                .move_within(16 * mb_w, 0, extra_y_rows * mb_w)?;
            self.cache_u
                .move_within(8 * mb_w, 0, extra_uv_rows * mb_w)?;
            self.cache_v
                .move_within(8 * mb_w, 0, extra_uv_rows * mb_w)?;
        }
        Ok(())
    }

    /// `VP8ProcessRow`
    pub(super) fn process_row(
        &mut self,
        mb_y: usize,
        output: &mut Output<'_>,
    ) -> Result<(), DecodeError> {
        self.reconstruct_row(mb_y)?;
        self.finish_row(mb_y, output)
    }
}
