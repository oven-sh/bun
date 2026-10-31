//! `frame_dec.c`: reconstructs a row of macroblocks, filters it and hands over the rows that are final.

use super::dsp::{self, BPS, Edges, Thresholds, U_OFF, V_OFF, Y_OFF, YUV_SIZE, YuvB};
use super::io::{Emitter, Rows};
use super::{Decoder, FilterType, MbData};
use crate::util::{Checked, SliceExt, try_vec};
use crate::vp8::common::NUM_MB_SEGMENTS;
use crate::{Output, Result, alpha};

/// `VP8FInfo`: how a macroblock is filtered.
#[derive(Clone, Copy, Default)]
pub(super) struct FilterInfo {
    /// 3 to 189, or 0 for no filtering.
    limit: u8,
    /// 1 to 63
    interior_limit: u8,
    /// Whether the edges inside the macroblock are filtered too.
    pub(super) inner_edges: bool,
    /// 0 to 2
    hev_thresh: u8,
}

/// The last row of a macroblock, for the prediction of the one below.
#[derive(Clone, Copy, Default)]
struct TopSamples {
    y: [u8; 16],
    u: [u8; 8],
    v: [u8; 8],
}

pub(super) struct Frame {
    height: usize,
    mb_w: usize,
    mb_h: usize,
    pub(super) filter_type: FilterType,
    /// By segment, then by whether the macroblock is predicted in 4x4 blocks.
    pub(super) filter_strengths: [[FilterInfo; 2]; NUM_MB_SEGMENTS],

    /// The current row of macroblocks. `filter_info` is empty without filtering.
    pub(super) filter_info: Vec<FilterInfo>,
    pub(super) mb_data: Vec<MbData>,

    yuv_t: Vec<TopSamples>,
    yuv_b: YuvB,
    /// A row of macroblocks below `FilterType::extra_rows` rows of the one above. An element is a row of a macroblock.
    cache_y: Vec<[u8; 16]>,
    /// The chroma planes have half as many rows as `cache_y`.
    cache_u: Vec<[u8; 8]>,
    cache_v: Vec<[u8; 8]>,

    pub(super) emitter: Emitter,
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

fn precompute_filter_strengths(dec: &Decoder<'_>) -> [[FilterInfo; 2]; NUM_MB_SEGMENTS] {
    let hdr = &dec.filter_hdr;
    let mut strengths = [[FilterInfo::default(); 2]; NUM_MB_SEGMENTS];
    for (infos, &strength) in strengths.iter_mut().zip(&dec.segment_hdr.filter_strength) {
        let base_level = match (dec.segment_hdr.use_segment, dec.segment_hdr.absolute_delta) {
            (false, _) => hdr.level,
            (true, true) => i32::from(strength),
            (true, false) => i32::from(strength) + hdr.level,
        };
        for (info, i4x4) in infos.iter_mut().zip([false, true]) {
            let mode_lf_delta = if i4x4 { hdr.mode_lf_delta } else { 0 };
            let level = (base_level + hdr.ref_lf_delta + mode_lf_delta).clamp(0, 63);
            if level > 0 {
                let mut ilevel = level;
                if hdr.sharpness > 0 {
                    ilevel >>= if hdr.sharpness > 4 { 2 } else { 1 };
                    ilevel = ilevel.min(9 - hdr.sharpness);
                }
                let ilevel = ilevel.max(1);
                info.interior_limit = ilevel as u8;
                info.limit = (2 * level + ilevel) as u8;
                info.hev_thresh = match level {
                    40.. => 2,
                    15.. => 1,
                    _ => 0,
                };
            }
            info.inner_edges = i4x4;
        }
    }
    strengths
}

impl Frame {
    /// `VP8EnterCritical` and `VP8InitFrame`
    pub(super) fn new(dec: &Decoder<'_>) -> Result<Self> {
        let emitter = Emitter::new(dec.width, dec.height)?;
        let mb_w = dec.mb_w;
        let filter_type = dec.filter_hdr.filter_type;
        let extra_rows = filter_type.extra_rows();
        Ok(Self {
            height: dec.height,
            mb_w,
            mb_h: dec.mb_h,
            filter_type,
            filter_strengths: precompute_filter_strengths(dec),
            filter_info: match filter_type {
                FilterType::Off => Vec::new(),
                _ => try_vec(FilterInfo::default(), mb_w)?,
            },
            mb_data: try_vec(MbData::default(), mb_w)?,
            yuv_t: try_vec(TopSamples::default(), mb_w)?,
            yuv_b: [0; YUV_SIZE],
            cache_y: try_vec([0; 16], (16 + extra_rows) * mb_w)?,
            cache_u: try_vec([0; 8], (8 + extra_rows / 2) * mb_w)?,
            cache_v: try_vec([0; 8], (8 + extra_rows / 2) * mb_w)?,
            emitter,
        })
    }

    pub(super) fn reconstruct_row(&mut self, mb_y: usize) -> Checked {
        let extra_rows = self.filter_type.extra_rows();
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
            // There is nothing above the first row of macroblocks. No macroblock of the row overwrites this.
            *yuv_b.array_at_mut(Y_OFF - BPS - 1)? = [127; 1 + 16 + 4];
            *yuv_b.array_at_mut(U_OFF - BPS - 1)? = [127; 1 + 8];
            *yuv_b.array_at_mut(V_OFF - BPS - 1)? = [127; 1 + 8];
        }

        for (mb_x, mb) in self.mb_data.iter().enumerate() {
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

            let mut bits = mb.non_zero_y;
            if mb.is_i4x4 {
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
                for ((&mode, coeffs), at) in mb.imodes.iter().zip(&mb.coeffs).zip(SCAN) {
                    dsp::predict_luma4(mode, yuv_b.array_at_mut(Y_OFF + at - BPS - 1)?);
                    do_transform(bits, coeffs, yuv_b.array_at_mut(Y_OFF + at)?);
                    bits <<= 2;
                }
            } else {
                dsp::predict_block::<16>(mb.imodes[0], mb_y > 0, mb_x > 0, yuv_b, Y_OFF)?;
                if bits != 0 {
                    for (coeffs, at) in mb.coeffs.iter().zip(SCAN) {
                        do_transform(bits, coeffs, yuv_b.array_at_mut(Y_OFF + at)?);
                        bits <<= 2;
                    }
                }
            }

            let bits_uv = mb.non_zero_uv;
            dsp::predict_block::<8>(mb.uvmode, mb_y > 0, mb_x > 0, yuv_b, U_OFF)?;
            dsp::predict_block::<8>(mb.uvmode, mb_y > 0, mb_x > 0, yuv_b, V_OFF)?;
            do_uv_transform(bits_uv, mb.coeffs.sub(16..20)?, yuv_b, U_OFF)?;
            do_uv_transform(bits_uv >> 8, mb.coeffs.sub(20..24)?, yuv_b, V_OFF)?;

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
        let extra_rows = self.filter_type.extra_rows();
        let info = self.filter_info.at(mb_x)?;
        let y_dst = &mut self.cache_y;
        let y_at = extra_rows * stride + mb_x;
        let limit = info.limit;
        if limit == 0 {
            return Ok(());
        }
        // The vertical edges first, and in each direction the edge of the macroblock before those inside it.
        if self.filter_type == FilterType::Simple {
            let inner = info.inner_edges.then_some(limit);
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
                ithresh: info.interior_limit,
                hev_thresh: info.hev_thresh,
            };
            let inner = info.inner_edges.then(|| thresholds(limit));
            let outer = (mb_x > 0).then(|| thresholds(limit + 4));
            dsp::h_filter16(y_dst, y_at, stride, Edges { outer, inner })?;
            dsp::h_filter8(u_dst, v_dst, uv_at, stride, Edges { outer, inner })?;
            let outer = (mb_y > 0).then(|| thresholds(limit + 4));
            dsp::v_filter16(y_dst, y_at, stride, Edges { outer, inner })?;
            dsp::v_filter8(u_dst, v_dst, uv_at, stride, Edges { outer, inner })?;
        }
        Ok(())
    }

    /// Filters the row and writes what no later filtering changes, with as many rows of `alpha`.
    pub(super) fn finish_row(
        &mut self,
        mb_y: usize,
        alpha: Option<&mut alpha::dec::Decoder<'_>>,
        output: &mut Output<'_>,
    ) -> Result<()> {
        let mb_w = self.mb_w;
        let (y_stride, uv_stride) = (16 * mb_w, 8 * mb_w);
        let extra_rows = self.filter_type.extra_rows();
        let is_last_row = mb_y + 1 >= self.mb_h;

        if self.filter_type != FilterType::Off {
            for mb_x in 0..mb_w {
                self.do_filter(mb_x, mb_y)?;
            }
        }

        let (y_start, y_offset, uv_offset) = if mb_y == 0 {
            (0, extra_rows * y_stride, extra_rows / 2 * uv_stride)
        } else {
            (16 * mb_y - extra_rows, 0, 0)
        };
        let y_end = if is_last_row {
            self.height
        } else {
            16 * (mb_y + 1) - extra_rows
        };
        let rows = Rows {
            y: self.cache_y.as_flattened().sub(y_offset..)?,
            u: self.cache_u.as_flattened().sub(uv_offset..)?,
            v: self.cache_v.as_flattened().sub(uv_offset..)?,
            y_stride,
            uv_stride,
            alpha: match alpha {
                Some(alpha) => Some(alpha.next_rows(y_end - y_start)?),
                None => None,
            },
            first_row: y_start,
            num_rows: y_end - y_start,
        };
        self.emitter.put(&rows, output)?;
        if !is_last_row {
            self.cache_y.move_within(16 * mb_w, 0, extra_rows * mb_w)?;
            self.cache_u
                .move_within(8 * mb_w, 0, extra_rows / 2 * mb_w)?;
            self.cache_v
                .move_within(8 * mb_w, 0, extra_rows / 2 * mb_w)?;
        }
        Ok(())
    }
}
