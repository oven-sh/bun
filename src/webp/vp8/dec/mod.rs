//! `vp8_dec.c`: the lossy decoder. The headers, the coefficients and the main loop.

mod bit_reader;
mod dsp;
mod frame;
mod io;
mod quant;
mod tree;
mod upsampling;

use crate::riff::le24;
use crate::util::{Bug, Checked, SliceExt};
use crate::vp8::common::{
    IntraMode, MAX_NUM_PARTITIONS, MB_FEATURE_TREE_PROBS, NUM_MB_SEGMENTS, NUM_MODE_LF_DELTAS,
    NUM_REF_LF_DELTAS, SIGNATURE,
};
use crate::vp8::tables::{CAT3, CAT4, CAT5, CAT6, ZIGZAG};
use crate::{DecodeError, Output};
use bit_reader::BitReader;
use frame::Frame;
use quant::{Quant, QuantMatrix};
use tree::{Proba, TypeProbas};

pub(crate) use crate::vp8::common::FRAME_HEADER_SIZE;

/// `VP8GetInfo`: the width and the height, if `data` starts like a key frame that fits in `chunk_size` bytes.
pub(crate) fn get_info(data: &[u8], chunk_size: usize) -> Option<(u32, u32)> {
    let &[b0, b1, b2, s0, s1, s2, w0, w1, h0, h1] = data.first_chunk::<FRAME_HEADER_SIZE>()?;
    if [s0, s1, s2] != SIGNATURE {
        return None;
    }
    let bits = u32::from_le_bytes([b0, b1, b2, 0]);
    let is_key_frame = bits & 1 == 0;
    let profile = (bits >> 1) & 7;
    let is_shown = (bits >> 4) & 1 != 0;
    let partition_length = (bits >> 5) as usize;
    let width = u32::from(u16::from_le_bytes([w0, w1]) & 0x3fff);
    let height = u32::from(u16::from_le_bytes([h0, h1]) & 0x3fff);
    if !is_key_frame
        || profile > 3
        || !is_shown
        || partition_length >= chunk_size
        || width == 0
        || height == 0
    {
        return None;
    }
    Some((width, height))
}

struct SegmentHeader {
    use_segment: bool,
    /// Whether each macroblock says which segment it is in. Otherwise all are in the first.
    update_map: bool,
    /// Whether `quantizer` and `filter_strength` replace the frame's values rather than add to them.
    absolute_delta: bool,
    quantizer: [i8; NUM_MB_SEGMENTS],
    filter_strength: [i8; NUM_MB_SEGMENTS],
}

impl SegmentHeader {
    /// Paragraph 9.3. Also returns the probabilities of the segment of a macroblock.
    fn parse(br: &mut BitReader<'_>) -> (Self, [u8; MB_FEATURE_TREE_PROBS]) {
        let mut hdr = Self {
            use_segment: br.get(),
            update_map: false,
            absolute_delta: true,
            quantizer: [0; NUM_MB_SEGMENTS],
            filter_strength: [0; NUM_MB_SEGMENTS],
        };
        let mut proba = [255; MB_FEATURE_TREE_PROBS];
        if hdr.use_segment {
            hdr.update_map = br.get();
            if br.get() {
                hdr.absolute_delta = br.get();
                for quantizer in &mut hdr.quantizer {
                    *quantizer = if br.get() {
                        br.get_signed_value(7) as i8
                    } else {
                        0
                    };
                }
                for strength in &mut hdr.filter_strength {
                    *strength = if br.get() {
                        br.get_signed_value(6) as i8
                    } else {
                        0
                    };
                }
            }
            if hdr.update_map {
                for proba in &mut proba {
                    *proba = if br.get() { br.get_value(8) as u8 } else { 255 };
                }
            }
        }
        (hdr, proba)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FilterType {
    Off,
    Simple,
    Complex,
}

struct FilterHeader {
    filter_type: FilterType,
    /// 0 to 63
    level: i32,
    /// 0 to 7
    sharpness: i32,
    use_lf_delta: bool,
    ref_lf_delta: [i32; NUM_REF_LF_DELTAS],
    mode_lf_delta: [i32; NUM_MODE_LF_DELTAS],
}

impl FilterHeader {
    /// Paragraph 9.4
    fn parse(br: &mut BitReader<'_>) -> Self {
        let simple = br.get();
        let level = br.get_value(6) as i32;
        let mut hdr = Self {
            // Whatever the strengths of the segments are.
            filter_type: match (level, simple) {
                (0, _) => FilterType::Off,
                (_, true) => FilterType::Simple,
                (_, false) => FilterType::Complex,
            },
            level,
            sharpness: br.get_value(3) as i32,
            use_lf_delta: br.get(),
            ref_lf_delta: [0; NUM_REF_LF_DELTAS],
            mode_lf_delta: [0; NUM_MODE_LF_DELTAS],
        };
        if hdr.use_lf_delta && br.get() {
            for delta in hdr.ref_lf_delta.iter_mut().chain(&mut hdr.mode_lf_delta) {
                if br.get() {
                    *delta = br.get_signed_value(6);
                }
            }
        }
        hdr
    }
}

/// The readers of the token partitions.
struct Partitions<'a> {
    parts: [BitReader<'a>; MAX_NUM_PARTITIONS],
    /// There are 1, 2, 4 or 8.
    num_parts_minus_one: usize,
}

impl<'a> Partitions<'a> {
    /// Paragraph 9.5. `buf` is what follows the first partition.
    fn parse(br: &mut BitReader<'_>, buf: &'a [u8]) -> Result<Self, DecodeError> {
        let last_part = (1usize << br.get_value(2)) - 1;
        let Some((sizes, mut rest)) = buf.split_at_checked(3 * last_part) else {
            return Err(DecodeError::NotEnoughData);
        };
        let mut parts = [BitReader::new(&[]); MAX_NUM_PARTITIONS];
        for (p, part) in parts.iter_mut().enumerate().take(last_part) {
            let size = (le24(sizes, 3 * p)? as usize).min(rest.len());
            let (data, after) = rest.split_at_checked(size).ok_or(Bug)?;
            *part = BitReader::new(data);
            rest = after;
        }
        if rest.is_empty() {
            return Err(DecodeError::NotEnoughData);
        }
        parts.put(last_part, BitReader::new(rest))?;
        Ok(Self {
            parts,
            num_parts_minus_one: last_part,
        })
    }

    /// The partition of a row of macroblocks.
    fn of_row(&mut self, mb_y: usize) -> Checked<&mut BitReader<'a>> {
        self.parts.at_mut(mb_y & self.num_parts_minus_one)
    }
}

/// What the headers say, and the readers at the first macroblock.
struct Decoder<'a> {
    /// Of the first partition.
    br: BitReader<'a>,
    parts: Partitions<'a>,
    width: usize,
    height: usize,
    /// The size in macroblocks.
    mb_w: usize,
    mb_h: usize,
    segment_hdr: SegmentHeader,
    filter_hdr: FilterHeader,
    dqm: [QuantMatrix; NUM_MB_SEGMENTS],
    proba: Proba,
}

impl<'a> Decoder<'a> {
    /// `VP8GetHeaders`, of a frame that `get_info` accepts.
    fn get_headers(data: &'a [u8]) -> Result<Self, DecodeError> {
        let (header, buf) = data.split_first_chunk::<FRAME_HEADER_SIZE>().ok_or(Bug)?;
        let &[b0, b1, b2, _, _, _, w0, w1, h0, h1] = header;
        let partition_length = (u32::from_le_bytes([b0, b1, b2, 0]) >> 5) as usize;
        // The two bits above each are a scale for the display.
        let width = usize::from(u16::from_le_bytes([w0, w1]) & 0x3fff);
        let height = usize::from(u16::from_le_bytes([h0, h1]) & 0x3fff);

        let Some((first, buf)) = buf.split_at_checked(partition_length) else {
            return Err(DecodeError::NotEnoughData);
        };
        let mut br = BitReader::new(first);
        // The colour space and whether the decoder has to clamp.
        br.get_value(2);
        let (segment_hdr, segments) = SegmentHeader::parse(&mut br);
        if br.eof() {
            return Err(DecodeError::BitstreamError);
        }
        let filter_hdr = FilterHeader::parse(&mut br);
        if br.eof() {
            return Err(DecodeError::BitstreamError);
        }
        let parts = Partitions::parse(&mut br, buf)?;
        let dqm = quant::parse_quant(&mut br, &segment_hdr)?;
        // Whether the probabilities are kept for the next frame.
        br.get();
        let proba = Proba::parse(&mut br, segments)?;
        Ok(Self {
            br,
            parts,
            width,
            height,
            mb_w: width.div_ceil(16),
            mb_h: height.div_ceil(16),
            segment_hdr,
            filter_hdr,
            dqm,
            proba,
        })
    }
}

/// What the macroblocks above and to the left say about their coefficients.
#[derive(Clone, Copy, Default)]
struct MbContext {
    /// Whether the 4x4 blocks along the edge have coefficients: 4 bits for luma, 2 for U, 2 for V.
    nz: u8,
    /// The same for the block of the DCs of the last 16x16 macroblock.
    nz_dc: bool,
}

/// What it takes to reconstruct a macroblock.
#[derive(Clone)]
struct MbData {
    /// 16 luma blocks, 4 of U, 4 of V.
    coeffs: [[i16; 16]; 24],
    is_i4x4: bool,
    /// One mode for 16x16, or sixteen.
    imodes: [IntraMode; 16],
    uvmode: IntraMode,
    /// Two bits per block, the first block in the highest. 0: no coefficient, 1: only DC, 2: at most the first three,
    /// 3: more.
    non_zero_y: u32,
    non_zero_uv: u32,
    skip: bool,
    segment: u8,
}

impl MbData {
    const EMPTY: Self = Self {
        coeffs: [[0; 16]; 24],
        is_i4x4: false,
        imodes: [IntraMode::Dc; 16],
        uvmode: IntraMode::Dc,
        non_zero_y: 0,
        non_zero_uv: 0,
        skip: false,
        segment: 0,
    };
}

/// Paragraph 13.2: a coefficient of 2 or more.
#[inline]
fn get_large_value(br: &mut BitReader<'_>, p: &[u8; 11]) -> i32 {
    if !br.get_bit(p[3]) {
        if !br.get_bit(p[4]) {
            2
        } else {
            3 + i32::from(br.get_bit(p[5]))
        }
    } else if !br.get_bit(p[6]) {
        if !br.get_bit(p[7]) {
            5 + i32::from(br.get_bit(159))
        } else {
            let v = 7 + 2 * i32::from(br.get_bit(165));
            v + i32::from(br.get_bit(145))
        }
    } else {
        let (cat, tab) = if !br.get_bit(p[8]) {
            if !br.get_bit(p[9]) {
                (0, CAT3.as_slice())
            } else {
                (1, CAT4.as_slice())
            }
        } else if !br.get_bit(p[10]) {
            (2, CAT5.as_slice())
        } else {
            (3, CAT6.as_slice())
        };
        let v = tab
            .iter()
            .fold(0, |v, &prob| 2 * v + i32::from(br.get_bit(prob)));
        v + 3 + (8 << cat)
    }
}

/// Reads the coefficients of a block from the `n`th on. Returns the position of the last one that is not zero, plus one.
#[inline(always)]
fn get_coeffs(
    br: &mut BitReader<'_>,
    prob: &TypeProbas,
    ctx: usize,
    dq: Quant,
    n: usize,
    out: &mut [i16; 16],
) -> Checked<usize> {
    let p = prob.at_ref(n)?.at_ref(ctx)?;
    // Most blocks are empty.
    if !br.get_bit(p[0]) {
        return Ok(n);
    }
    get_more_coeffs(br, prob, p, dq, n, out)
}

/// The rest of `get_coeffs` once it is known that there is a coefficient.
#[inline(never)]
fn get_more_coeffs<'a>(
    br: &mut BitReader<'_>,
    prob: &'a TypeProbas,
    mut p: &'a [u8; 11],
    dq: Quant,
    mut n: usize,
    out: &mut [i16; 16],
) -> Checked<usize> {
    loop {
        while !br.get_bit(p[1]) {
            n += 1;
            p = &prob.at_ref(n)?[0];
            if n == 16 {
                return Ok(16);
            }
        }
        let p_ctx = prob.at_ref(n + 1)?;
        let v = if !br.get_bit(p[2]) {
            p = &p_ctx[1];
            1
        } else {
            let v = get_large_value(br, p);
            p = &p_ctx[2];
            v
        };
        let dq = if n > 0 { dq[1] } else { dq[0] };
        // Too large a product is cut off.
        out.put(usize::from(ZIGZAG.at(n)?), (br.get_signed(v) * dq) as i16)?;
        n += 1;
        if n == 16 || !br.get_bit(p[0]) {
            return Ok(n);
        }
    }
}

#[inline]
fn nz_code_bits(nz_coeffs: u32, nz: usize, dc_nz: bool) -> u32 {
    let code = match nz {
        4.. => 3,
        2.. => 2,
        _ => u32::from(dc_nz),
    };
    (nz_coeffs << 2) | code
}

/// Returns whether all the coefficients are zero.
fn parse_residuals(
    proba: &Proba,
    q: &QuantMatrix,
    mb: &mut MbContext,
    left_mb: &mut MbContext,
    block: &mut MbData,
    token_br: &mut BitReader<'_>,
) -> Checked<bool> {
    let [i16_ac, i16_dc, chroma, i4] = &proba.bands;
    block.coeffs = [[0; 16]; 24];
    let (luma_coeffs, chroma_coeffs) = block.coeffs.halves_mut(16)?;

    let (first, ac_proba) = if !block.is_i4x4 {
        let mut dc = [0; 16];
        let ctx = usize::from(mb.nz_dc) + usize::from(left_mb.nz_dc);
        let nz = get_coeffs(token_br, i16_dc, ctx, q.y2_mat, 0, &mut dc)?;
        mb.nz_dc = nz > 0;
        left_mb.nz_dc = nz > 0;
        if nz > 1 {
            dsp::transform_wht(&dc, luma_coeffs);
        } else {
            let dc0 = ((i32::from(dc[0]) + 3) >> 3) as i16;
            for dst in luma_coeffs.iter_mut() {
                dst[0] = dc0;
            }
        }
        (1, i16_ac)
    } else {
        (0, i4)
    };

    let mut non_zero_y = 0;
    let mut tnz = u32::from(mb.nz & 0x0f);
    let mut lnz = u32::from(left_mb.nz & 0x0f);
    for row in luma_coeffs.as_chunks_mut::<4>().0 {
        let mut l = lnz & 1;
        let mut nz_coeffs = 0;
        for dst in row {
            let ctx = (l + (tnz & 1)) as usize;
            let nz = get_coeffs(token_br, ac_proba, ctx, q.y1_mat, first, dst)?;
            l = u32::from(nz > first);
            tnz = (tnz >> 1) | (l << 7);
            nz_coeffs = nz_code_bits(nz_coeffs, nz, dst[0] != 0);
        }
        tnz >>= 4;
        lnz = (lnz >> 1) | (l << 7);
        non_zero_y = (non_zero_y << 8) | nz_coeffs;
    }
    let mut out_t_nz = tnz;
    let mut out_l_nz = lnz >> 4;

    let mut non_zero_uv = 0;
    for (plane, ch) in chroma_coeffs.as_chunks_mut::<4>().0.iter_mut().zip([0, 2]) {
        let mut nz_coeffs = 0;
        let mut tnz = u32::from(mb.nz) >> (4 + ch);
        let mut lnz = u32::from(left_mb.nz) >> (4 + ch);
        for row in plane.as_chunks_mut::<2>().0 {
            let mut l = lnz & 1;
            for dst in row {
                let ctx = (l + (tnz & 1)) as usize;
                let nz = get_coeffs(token_br, chroma, ctx, q.uv_mat, 0, dst)?;
                l = u32::from(nz > 0);
                tnz = (tnz >> 1) | (l << 3);
                nz_coeffs = nz_code_bits(nz_coeffs, nz, dst[0] != 0);
            }
            tnz >>= 2;
            lnz = (lnz >> 1) | (l << 5);
        }
        non_zero_uv |= nz_coeffs << (4 * ch);
        out_t_nz |= (tnz << 4) << ch;
        out_l_nz |= (lnz & 0xf0) << ch;
    }
    mb.nz = out_t_nz as u8;
    left_mb.nz = out_l_nz as u8;

    block.non_zero_y = non_zero_y;
    block.non_zero_uv = non_zero_uv;
    Ok(non_zero_y | non_zero_uv == 0)
}

/// `VP8DecodeMB`: the coefficients of macroblock `mb_x` of the current row.
fn decode_mb(
    proba: &Proba,
    dqm: &[QuantMatrix; NUM_MB_SEGMENTS],
    frame: &mut Frame<'_>,
    mb_x: usize,
    token_br: &mut BitReader<'_>,
) -> Checked {
    let left = &mut frame.left_info;
    let mb = frame.mb_info.at_mut(mb_x)?;
    let block = frame.mb_data.at_mut(mb_x)?;
    let skip = if proba.skip_p.is_some() && block.skip {
        left.nz = 0;
        mb.nz = 0;
        if !block.is_i4x4 {
            left.nz_dc = false;
            mb.nz_dc = false;
        }
        block.non_zero_y = 0;
        block.non_zero_uv = 0;
        true
    } else {
        let q = dqm.at_ref(usize::from(block.segment))?;
        parse_residuals(proba, q, mb, left, block, token_br)?
    };
    if frame.filter_type != FilterType::Off {
        let strengths = frame.fstrengths.at_ref(usize::from(block.segment))?;
        let finfo = frame.f_info.at_mut(mb_x)?;
        *finfo = strengths.at(usize::from(block.is_i4x4))?;
        finfo.f_inner |= !skip;
    }
    Ok(())
}

impl Decoder<'_> {
    /// `ParseFrame`: each row of macroblocks is parsed, then reconstructed, filtered and written.
    fn parse_frame(
        mut self,
        frame: &mut Frame<'_>,
        output: &mut Output<'_>,
    ) -> Result<(), DecodeError> {
        for mb_y in 0..self.mb_h {
            let update_map = self.segment_hdr.update_map;
            for (top, block) in frame.intra_t.iter_mut().zip(&mut frame.mb_data) {
                let left = &mut frame.intra_l;
                tree::parse_intra_mode(&mut self.br, &self.proba, update_map, top, left, block)?;
            }
            if self.br.eof() {
                return Err(DecodeError::NotEnoughData);
            }
            let token_br = self.parts.of_row(mb_y)?;
            for mb_x in 0..self.mb_w {
                decode_mb(&self.proba, &self.dqm, frame, mb_x, token_br)?;
                if token_br.eof() {
                    return Err(DecodeError::NotEnoughData);
                }
            }
            frame.init_scanline();
            frame.process_row(mb_y, output)?;
        }
        Ok(())
    }
}

/// `VP8GetHeaders` and `VP8Decode`. `data` starts at the frame header and goes on to the end of the file. `alpha` is
/// the payload of the `ALPH` chunk.
pub(crate) fn decode(
    data: &[u8],
    alpha: Option<&[u8]>,
    output: &mut Output<'_>,
) -> Result<(), DecodeError> {
    let dec = Decoder::get_headers(data)?;
    output.check(dec.width, dec.height)?;
    let mut frame = Frame::new(&dec, alpha)?;
    dec.parse_frame(&mut frame, output)
}
