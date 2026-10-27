//! `vp8_dec.c`: the lossy decoder. The headers, the coefficients and the main loop.

mod bit_reader;
mod dsp;
mod frame;
mod io;
mod quant;
mod tree;
mod upsampling;

use crate::util::{Bug, Checked, SliceExt, try_vec};
use crate::vp8::common::{
    IntraMode, MB_FEATURE_TREE_PROBS, NUM_MB_SEGMENTS, NUM_PROBAS, SIGNATURE, inverse_wht,
};
use crate::vp8::tables::{CAT3, CAT4, CAT5, CAT6};
use crate::{Error, Info, Output, Result, alpha};
use bit_reader::BitReader;
use core::array;
use frame::Frame;
use quant::{Quant, QuantMatrix};
use tree::{Proba, TypeProbas};

pub(crate) use crate::vp8::common::FRAME_HEADER_SIZE;

const NUM_REF_LF_DELTAS: usize = 4;
const NUM_MODE_LF_DELTAS: usize = 4;
const MAX_NUM_PARTITIONS: usize = 8;

/// Where the coefficients of a block are, in the order of the bitstream.
const ZIGZAG: [u8; 16] = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15];

/// `VP8GetInfo`: the width and the height, if `data` starts like a key frame that fits in `chunk_size` bytes.
pub(crate) fn get_info(data: &[u8], chunk_size: usize) -> Option<Info> {
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
    Some(Info { width, height })
}

struct SegmentHeader {
    use_segment: bool,
    /// Whether `quantizer` and `filter_strength` replace the frame's values rather than add to them.
    absolute_delta: bool,
    quantizer: [i8; NUM_MB_SEGMENTS],
    filter_strength: [i8; NUM_MB_SEGMENTS],
    /// The probabilities of the segment of a macroblock. Without them all macroblocks are in the first segment.
    tree_probs: Option<[u8; MB_FEATURE_TREE_PROBS]>,
}

impl SegmentHeader {
    /// Paragraph 9.3
    fn parse(br: &mut BitReader<'_>) -> Self {
        let mut hdr = Self {
            use_segment: br.get(),
            absolute_delta: true,
            quantizer: [0; NUM_MB_SEGMENTS],
            filter_strength: [0; NUM_MB_SEGMENTS],
            tree_probs: None,
        };
        if hdr.use_segment {
            let update_map = br.get();
            if br.get() {
                hdr.absolute_delta = br.get();
                hdr.quantizer = array::from_fn(|_| br.get_optional_signed_value(7) as i8);
                hdr.filter_strength = array::from_fn(|_| br.get_optional_signed_value(6) as i8);
            }
            let mut proba = || if br.get() { br.get_value(8) as u8 } else { 255 };
            hdr.tree_probs = update_map.then(|| array::from_fn(|_| proba()));
        }
        hdr
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FilterType {
    Off,
    Simple,
    Complex,
}

impl FilterType {
    /// `kFilterExtraRows`: the luma rows above a macroblock that its filter reads. 4 rows of chroma make it 8 of luma.
    fn extra_rows(self) -> usize {
        match self {
            Self::Off => 0,
            Self::Simple => 2,
            Self::Complex => 8,
        }
    }
}

struct FilterHeader {
    filter_type: FilterType,
    /// 0 to 63
    level: i32,
    /// 0 to 7
    sharpness: i32,
    /// What intra prediction adds to the level: the only delta by reference frame that a key frame uses.
    ref_lf_delta: i32,
    /// What prediction in 4x4 blocks adds on top: the only delta by mode that a key frame uses.
    mode_lf_delta: i32,
}

impl FilterHeader {
    /// Paragraph 9.4
    fn parse(br: &mut BitReader<'_>) -> Self {
        let simple = br.get();
        let level = br.get_value(6) as i32;
        let sharpness = br.get_value(3) as i32;
        let use_lf_delta = br.get();
        let mut deltas = [0; NUM_REF_LF_DELTAS + NUM_MODE_LF_DELTAS];
        if use_lf_delta && br.get() {
            deltas = array::from_fn(|_| br.get_optional_signed_value(6));
        }
        Self {
            // A level of 0 turns the filter off, whatever the strengths of the segments are.
            filter_type: match (level, simple) {
                (0, _) => FilterType::Off,
                (_, true) => FilterType::Simple,
                (_, false) => FilterType::Complex,
            },
            level,
            sharpness,
            ref_lf_delta: deltas[0],
            mode_lf_delta: deltas[NUM_REF_LF_DELTAS],
        }
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
    fn parse(br: &mut BitReader<'_>, buf: &'a [u8]) -> Result<Self> {
        let last_part = (1usize << br.get_value(2)) - 1;
        let Some((sizes, mut rest)) = buf.split_at_checked(3 * last_part) else {
            return Err(Error::NotEnoughData);
        };
        let mut parts = [BitReader::new(&[]); MAX_NUM_PARTITIONS];
        for (part, &[s0, s1, s2]) in parts.iter_mut().zip(sizes.as_chunks().0) {
            let size = (u32::from_le_bytes([s0, s1, s2, 0]) as usize).min(rest.len());
            let (data, after) = rest.split_at_checked(size).ok_or(Bug)?;
            *part = BitReader::new(data);
            rest = after;
        }
        if rest.is_empty() {
            return Err(Error::NotEnoughData);
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

/// What the macroblocks above and to the left say about their coefficients.
#[derive(Clone, Copy, Default)]
struct MbContext {
    /// Whether the 4x4 blocks along the edge have coefficients: 4 bits for luma, 2 for U, 2 for V.
    nz: u8,
    /// Whether the block of the DCs of the last 16x16 macroblock has coefficients.
    nz_dc: bool,
}

/// What it takes to reconstruct a macroblock.
#[derive(Clone, Default)]
struct MbData {
    /// 16 luma blocks, 4 of U, 4 of V.
    coeffs: [[i16; 16]; 24],
    is_i4x4: bool,
    /// One mode for 16x16, or sixteen.
    imodes: [IntraMode; 16],
    uvmode: IntraMode,
    /// Two bits per block, first block highest. 0: no coefficient, 1: only DC, 2: at most the first three, 3: more.
    non_zero_y: u32,
    non_zero_uv: u32,
    skip: bool,
    segment: u8,
}

/// Paragraph 13.2: a coefficient of 2 or more.
#[inline]
fn get_large_value(br: &mut BitReader<'_>, p: &[u8; NUM_PROBAS]) -> i32 {
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
    mut p: &'a [u8; NUM_PROBAS],
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
        // Only the low 16 bits of the product are kept, as in libwebp.
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
    token_br: &mut BitReader<'_>,
    proba: &Proba,
    q: &QuantMatrix,
    top: &mut MbContext,
    left: &mut MbContext,
    mb: &mut MbData,
) -> Checked<bool> {
    let [i16_ac, i16_dc, chroma, i4] = &proba.coeffs;
    mb.coeffs = [[0; 16]; 24];
    let (luma_coeffs, chroma_coeffs) = mb.coeffs.split_at_mid(16)?;

    let (first, ac_proba) = if !mb.is_i4x4 {
        let mut dc = [0; 16];
        let ctx = usize::from(top.nz_dc) + usize::from(left.nz_dc);
        let nz = get_coeffs(token_br, i16_dc, ctx, q.y2_mat, 0, &mut dc)?;
        top.nz_dc = nz > 0;
        left.nz_dc = nz > 0;
        let dcs = if nz > 1 {
            inverse_wht(&dc)
        } else {
            [((i32::from(dc[0]) + 3) >> 3) as i16; 16]
        };
        for (dst, dc) in luma_coeffs.iter_mut().zip(dcs) {
            dst[0] = dc;
        }
        (1, i16_ac)
    } else {
        (0, i4)
    };

    let mut non_zero_y = 0;
    let mut tnz = u32::from(top.nz & 0x0f);
    let mut lnz = u32::from(left.nz & 0x0f);
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
        let mut tnz = u32::from(top.nz) >> (4 + ch);
        let mut lnz = u32::from(left.nz) >> (4 + ch);
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
    top.nz = out_t_nz as u8;
    left.nz = out_l_nz as u8;

    mb.non_zero_y = non_zero_y;
    mb.non_zero_uv = non_zero_uv;
    Ok(non_zero_y | non_zero_uv == 0)
}

/// `VP8DecodeMB`: the coefficients of macroblock `mb_x` of the current row.
fn decode_mb(
    token_br: &mut BitReader<'_>,
    proba: &Proba,
    dqm: &[QuantMatrix; NUM_MB_SEGMENTS],
    top: &mut MbContext,
    left: &mut MbContext,
    frame: &mut Frame,
    mb_x: usize,
) -> Checked {
    let mb = frame.mb_data.at_mut(mb_x)?;
    let skip = if mb.skip {
        left.nz = 0;
        top.nz = 0;
        if !mb.is_i4x4 {
            left.nz_dc = false;
            top.nz_dc = false;
        }
        mb.non_zero_y = 0;
        mb.non_zero_uv = 0;
        true
    } else {
        let q = dqm.at_ref(usize::from(mb.segment))?;
        parse_residuals(token_br, proba, q, top, left, mb)?
    };
    if frame.filter_type != FilterType::Off {
        let strengths = frame.filter_strengths.at_ref(usize::from(mb.segment))?;
        let info = frame.filter_info.at_mut(mb_x)?;
        *info = strengths.at(usize::from(mb.is_i4x4))?;
        info.inner_edges |= !skip;
    }
    Ok(())
}

/// What the headers say, and the readers at the first macroblock.
struct Decoder<'a> {
    /// The reader of the first partition.
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
    fn parse(data: &'a [u8]) -> Result<Self> {
        let (header, buf) = data.split_first_chunk::<FRAME_HEADER_SIZE>().ok_or(Bug)?;
        let &[b0, b1, b2, _, _, _, w0, w1, h0, h1] = header;
        let partition_length = (u32::from_le_bytes([b0, b1, b2, 0]) >> 5) as usize;
        // The two bits above each are a scale for the display.
        let width = usize::from(u16::from_le_bytes([w0, w1]) & 0x3fff);
        let height = usize::from(u16::from_le_bytes([h0, h1]) & 0x3fff);

        let Some((first, buf)) = buf.split_at_checked(partition_length) else {
            return Err(Error::NotEnoughData);
        };
        let mut br = BitReader::new(first);
        // The color space and whether the decoder has to clamp.
        br.get_value(2);
        let segment_hdr = SegmentHeader::parse(&mut br);
        if br.eof() {
            return Err(Error::BitstreamError);
        }
        let filter_hdr = FilterHeader::parse(&mut br);
        if br.eof() {
            return Err(Error::BitstreamError);
        }
        let parts = Partitions::parse(&mut br, buf)?;
        let dqm = quant::parse(&mut br, &segment_hdr)?;
        // Whether the probabilities are kept for the next frame.
        br.get();
        let proba = Proba::parse(&mut br)?;
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

    /// `ParseFrame`: each row of macroblocks is parsed, then reconstructed, filtered and written.
    fn parse_frame(
        mut self,
        alpha: Option<&[u8]>,
        frame: &mut Frame,
        output: &mut Output<'_>,
    ) -> Result<()> {
        let (proba, dqm) = (&self.proba, &self.dqm);
        let (tree_probs, skip_p) = (self.segment_hdr.tree_probs, proba.skip_p);
        // The modes of the 4x4 blocks, and the coefficients, along the lower edge of the row of macroblocks above.
        let mut intra_t = try_vec([IntraMode::Dc; 4], self.mb_w)?;
        let mut top_ctx = try_vec(MbContext::default(), self.mb_w)?;
        for mb_y in 0..self.mb_h {
            let mut intra_l = [IntraMode::Dc; 4];
            for (top, mb) in intra_t.iter_mut().zip(&mut frame.mb_data) {
                tree::parse_intra_mode(&mut self.br, tree_probs, skip_p, top, &mut intra_l, mb)?;
            }
            if self.br.eof() {
                return Err(Error::NotEnoughData);
            }
            let token_br = self.parts.of_row(mb_y)?;
            let mut left = MbContext::default();
            for (mb_x, top) in top_ctx.iter_mut().enumerate() {
                decode_mb(token_br, proba, dqm, top, &mut left, frame, mb_x)?;
                if token_br.eof() {
                    return Err(Error::NotEnoughData);
                }
            }
            // libwebp decodes alpha a few rows at a time unless the levels are pre-processed, and fails the same images.
            if mb_y == 0
                && let Some(alpha) = alpha
            {
                let plane = alpha::dec::decode(alpha, self.width, self.height)?;
                frame.emitter.set_alpha(plane);
            }
            frame.reconstruct_row(mb_y)?;
            frame.finish_row(mb_y, output)?;
        }
        Ok(())
    }
}

/// `VP8GetHeaders`, `VP8Decode`. `data` goes from the frame header to the end of the file. `alpha`: the `ALPH` payload.
pub(crate) fn decode(data: &[u8], alpha: Option<&[u8]>, output: &mut Output<'_>) -> Result<()> {
    let dec = Decoder::parse(data)?;
    output.check(dec.width, dec.height)?;
    let mut frame = Frame::new(&dec)?;
    dec.parse_frame(alpha, &mut frame, output)
}
