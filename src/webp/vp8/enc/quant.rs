//! `quant_enc.c`: sets up the quantizers, and picks the prediction modes of a macroblock by rate and distortion.

use super::cost::Proba;
use super::dsp::{self, Coeffs, Lanes, Luma, Matrix, Matrix4x4, NUM_PRED_MODES};
use super::filter::filter_strength_from_delta;
use super::iterator::EncIterator;
use super::tables::{
    AC_TABLE, DC_TABLE, FIXED_COSTS_I4, FIXED_COSTS_I16, FIXED_COSTS_UV, NUM_BMODES,
    NUM_MB_SEGMENTS,
};
use super::{DError, Encoder, FILTER_STRENGTH, SNS_STRENGTH, SegmentInfo};
use crate::util::{Checked, SliceExt};

/// The neutral, lowest and highest useful values of the susceptibility of U and V.
const MID_ALPHA: i32 = 64;
const MIN_ALPHA: i32 = 30;
const MAX_ALPHA: i32 = 100;

/// Between `SNS_STRENGTH` and the exponent that modulates the quantizer. Less than 1.
const SNS_TO_DQ: f64 = 0.9;

/// The number of non-zero coefficients up to which a block is very flat, and complex predictions get a penalty.
const FLATNESS_LIMIT_I4: usize = 3;
const FLATNESS_LIMIT_UV: usize = 2;
/// Roughly one bit a block.
const FLATNESS_PENALTY: i64 = 140;

const RD_DISTO_MULT: i64 = 256;

fn mult_8b(a: i32, b: i32) -> i32 {
    (a * b + 128) >> 8
}

//------------------------------------------------------------------------------
// Quantization matrices

#[derive(Clone, Copy)]
enum MatrixType {
    LumaAc,
    LumaDc,
    Chroma,
}

/// Slightly raises the high frequencies.
const FREQ_SHARPENING: Matrix4x4<u16> = [
    [0, 30, 60, 90],
    [30, 60, 90, 90],
    [60, 90, 90, 90],
    [90, 90, 90, 90],
];
const SHARPEN_BITS: u32 = 11;

/// Returns the matrix for the steps `q_dc` and `q_ac`, and the average step.
fn expand_matrix(q_dc: u16, q_ac: u16, matrix_type: MatrixType) -> (Matrix, i32) {
    let (bias_dc, bias_ac) = match matrix_type {
        MatrixType::LumaAc => (96, 110),
        MatrixType::LumaDc => (96, 108),
        MatrixType::Chroma => (110, 115),
    };
    let mut m = Matrix {
        q: [[q_ac; 4]; 4],
        iq: [[Matrix::reciprocal(q_ac); 4]; 4],
        bias: [[Matrix::bias(bias_ac); 4]; 4],
        sharpen: match matrix_type {
            // The one for the DC is 0.
            MatrixType::LumaAc => {
                FREQ_SHARPENING.map(|row| row.map(|f| (f * q_ac) >> SHARPEN_BITS))
            }
            _ => [[0; 4]; 4],
        },
    };
    m.q[0][0] = q_dc;
    m.iq[0][0] = Matrix::reciprocal(q_dc);
    m.bias[0][0] = Matrix::bias(bias_dc);
    let sum = i32::from(q_dc) + 15 * i32::from(q_ac);
    (m, (sum + 8) >> 4)
}

fn dc_step(q: i32, max: i32) -> Checked<u16> {
    Ok(u16::from(DC_TABLE.at(q.clamp(0, max) as usize)?))
}

fn ac_step(q: i32) -> Checked<u16> {
    AC_TABLE.at(q.clamp(0, 127) as usize)
}

fn setup_matrices(enc: &mut Encoder<'_>) -> Checked {
    for m in enc.dqm.iter_mut().take(enc.segment_hdr.num_segments) {
        let q = m.quant;
        let (q_i4, q_i16, q_uv);
        (m.y1, q_i4) = expand_matrix(dc_step(q, 127)?, ac_step(q)?, MatrixType::LumaAc);
        (m.y2, q_i16) = expand_matrix(
            dc_step(q, 127)? * 2,
            (ac_step(q)? * 155 / 100).max(8),
            MatrixType::LumaDc,
        );
        (m.uv, q_uv) = expand_matrix(
            dc_step(q + enc.dq_uv_dc, 117)?,
            ac_step(q + enc.dq_uv_ac)?,
            MatrixType::Chroma,
        );

        m.lambda_i4 = ((3 * q_i4 * q_i4) >> 7).max(1);
        m.lambda_i16 = (3 * q_i16 * q_i16).max(1);
        m.lambda_uv = ((3 * q_uv * q_uv) >> 6).max(1);
        m.lambda_mode = ((q_i4 * q_i4) >> 7).max(1);
        m.tlambda = ((SNS_STRENGTH * q_i4) >> 5).max(1);

        m.min_disto = 20 * i64::from(m.y1.q[0][0]);
        m.max_edge = 0;
    }
    Ok(())
}

//------------------------------------------------------------------------------
// Filtering parameters

/// Below this, filtering has next to no visible effect.
const FSTRENGTH_CUTOFF: i32 = 2;

fn setup_filter_strength(enc: &mut Encoder<'_>) -> Checked {
    let level0 = 5 * FILTER_STRENGTH;
    for m in &mut enc.dqm {
        let qstep = i32::from(ac_step(m.quant)?) >> 2;
        let base_strength = filter_strength_from_delta(qstep);
        // The less complex a segment, the less it is filtered.
        let f = base_strength * level0 / (256 + m.beta);
        m.fstrength = if f < FSTRENGTH_CUTOFF { 0 } else { f.min(63) };
    }
    enc.filter_level = enc.dqm[0].fstrength;
    Ok(())
}

//------------------------------------------------------------------------------

const MAX_DQ_UV: i32 = 6;
const MIN_DQ_UV: i32 = -4;

/// Maps the quality, where like for JPEG 0.75 is good, to a compression factor, where the middle is 0.5. As the size goes
/// roughly by the cube of the quantizer, it is the cube root of that.
fn quality_to_compression(c: f64) -> f64 {
    let linear_c = if c < 0.75 {
        c * (2.0 / 3.0)
    } else {
        2.0 * c - 1.0
    };
    linear_c.powf(1.0 / 3.0)
}

/// Merges the segments with the same parameters.
fn simplify_segments(enc: &mut Encoder<'_>) -> Checked {
    let mut map = [0u8, 1, 2, 3];
    let num_segments = enc.segment_hdr.num_segments.min(NUM_MB_SEGMENTS);
    let mut num_final_segments = 1;
    for s1 in 1..num_segments {
        let (quant, fstrength) = (enc.dqm.at_ref(s1)?.quant, enc.dqm.at_ref(s1)?.fstrength);
        let mut finals = enc.dqm.iter().take(num_final_segments);
        let found = finals.position(|s2| s2.quant == quant && s2.fstrength == fstrength);
        map.put(s1, found.unwrap_or(num_final_segments) as u8)?;
        if found.is_none() {
            if num_final_segments != s1 {
                let segment = enc.dqm.at_ref(s1)?.clone();
                enc.dqm.put(num_final_segments, segment)?;
            }
            num_final_segments += 1;
        }
    }
    if num_final_segments < num_segments {
        for mb in &mut enc.mb_info {
            mb.segment = map.at(usize::from(mb.segment))?;
        }
        enc.segment_hdr.num_segments = num_final_segments;
        // The header has the parameters of all four.
        let last = enc.dqm.at_ref(num_final_segments - 1)?.clone();
        enc.dqm
            .sub_mut(num_final_segments..num_segments)?
            .fill(last);
    }
    Ok(())
}

/// Sets the quantizers and the filter strengths of the segments.
pub(super) fn set_segment_params(enc: &mut Encoder<'_>) -> Checked {
    let num_segments = enc.segment_hdr.num_segments;
    let amp = SNS_TO_DQ * f64::from(SNS_STRENGTH) / 100.0 / 128.0;
    let c_base = quality_to_compression(f64::from(enc.quality) / 100.0);
    for m in enc.dqm.iter_mut().take(num_segments) {
        // The more a segment takes quantization, the more it gets.
        let expn = 1.0 - amp * f64::from(m.alpha);
        let c = c_base.powf(expn);
        m.quant = ((127.0 * (1.0 - c)) as i32).clamp(0, 127);
    }
    enc.base_quant = enc.dqm[0].quant;
    for m in enc.dqm.iter_mut().skip(num_segments) {
        m.quant = enc.base_quant;
    }

    // `uv_alpha` is mostly around 60, between 30 (bad) and 100 (U and V can be decimated more).
    let dq_uv_ac = (enc.uv_alpha - MID_ALPHA) * (MAX_DQ_UV - MIN_DQ_UV) / (MAX_ALPHA - MIN_ALPHA);
    enc.dq_uv_ac = (dq_uv_ac * SNS_STRENGTH / 100).clamp(MIN_DQ_UV, MAX_DQ_UV);
    // U and V react more to high quantizers: flat blocks appear.
    enc.dq_uv_dc = -4 * SNS_STRENGTH / 100;

    setup_filter_strength(enc)?;
    if num_segments > 1 {
        simplify_segments(enc)?;
    }
    setup_matrices(enc)
}

//------------------------------------------------------------------------------
// Scores

/// Rate and distortion.
#[derive(Clone, Copy)]
pub(super) struct Score {
    /// The distortion, and the spectral distortion.
    d: i64,
    sd: i64,
    /// The bits of the header, which go to the first partition.
    pub(super) h: i64,
    /// The bits of the coefficients.
    r: i64,
    score: i64,
    /// Which blocks have coefficients.
    nz: u32,
}

impl Score {
    /// Low enough to add to it.
    const MAX_COST: i64 = 0x7f_ffff_ffff_ffff;

    const fn new() -> Self {
        Self {
            d: 0,
            sd: 0,
            h: 0,
            r: 0,
            score: Self::MAX_COST,
            nz: 0,
        }
    }

    fn set_rd_score(&mut self, lambda: i32) {
        self.score = (self.r + self.h) * i64::from(lambda) + RD_DISTO_MULT * (self.d + self.sd);
    }

    fn add(&mut self, other: &Self) {
        self.d += other.d;
        self.sd += other.sd;
        self.r += other.r;
        self.h += other.h;
        self.nz |= other.nz;
        self.score += other.score;
    }
}

/// What is decided for a macroblock.
pub(super) struct ModeScore {
    pub(super) score: Score,
    /// The quantized levels.
    pub(super) y_dc_levels: Coeffs,
    pub(super) y_ac_levels: [Coeffs; 16],
    pub(super) uv_levels: [Coeffs; 8],
    pub(super) is_i16: bool,
    mode_uv: u8,
}

fn is_flat_source16(src: &Luma) -> bool {
    let first = src[0][0][0];
    let mut samples = src.as_flattened().as_flattened().iter();
    samples.all(|&sample| sample == first)
}

/// Whether at most `thresh` of the AC levels of some blocks are not zero, given their number in each block.
fn is_flat(non_zero_ac: &[u8], thresh: usize) -> bool {
    non_zero_ac
        .iter()
        .map(|&count| usize::from(count))
        .sum::<usize>()
        <= thresh
}

/// A bit for each block that has levels.
fn non_zero_bits(num_levels: &[u8]) -> u32 {
    let blocks = num_levels.iter().enumerate();
    blocks.fold(0, |nz, (n, &num_levels)| {
        nz | (u32::from(num_levels != 0) << n)
    })
}

//------------------------------------------------------------------------------
// Difference, transform, quantize, back-transform, add

struct Intra16 {
    mode: u8,
    score: Score,
    y_dc_levels: Coeffs,
    y_ac_levels: Lanes<i16, 16>,
    /// How many of them each block has up to the last one that is not zero.
    num_ac_levels: [u8; 16],
    out: Lanes<u8, 16>,
}

impl Intra16 {
    fn new() -> Self {
        Self {
            mode: 0,
            score: Score::new(),
            y_dc_levels: Coeffs::default(),
            y_ac_levels: Lanes::new(),
            num_ac_levels: [0; 16],
            out: Lanes::new(),
        }
    }

    /// Returns which blocks have levels.
    fn reconstruct(&mut self, src: &Lanes<u8, 16>, pred: &Lanes<u8, 16>, dqm: &SegmentInfo) -> u32 {
        let mut tmp = Lanes::new();
        dsp::ftransform(src, pred, &mut tmp);
        let mut dc_tmp = dsp::ftransform_wht(tmp.first());
        self.y_dc_levels = dsp::quantize_one(&mut dc_tmp, &dqm.y2);
        *tmp.first_mut() = [0; 16];
        dsp::quantize(&mut tmp, &dqm.y1, &mut self.y_ac_levels);
        *tmp.first_mut() = dsp::transform_wht(&dc_tmp);
        dsp::itransform(pred, &tmp, &mut self.out);
        self.num_ac_levels = dsp::num_levels(&self.y_ac_levels);
        non_zero_bits(&self.num_ac_levels)
            | (u32::from(self.y_dc_levels != Coeffs::default()) << 24)
    }
}

//------------------------------------------------------------------------------
// DC-error diffusion

/// The errors of the second, third and fourth block of U, and of V.
type BlockErrors = [[i8; 3]; 2];

/// The shares, out of 16, of the error that go to the block below and to the one on the right. A little under the whole
/// of it, which would make a chessboard of colors at the lowest qualities.
const C1: i32 = 7;
const C2: i32 = 8;
const DSHIFT: u32 = 4;
/// Errors are stored halved, to fit an `i8`.
const DSCALE: u32 = 1;

/// Quantizes `v` and returns the error.
fn quantize_single(v: &mut i16, mtx: &Matrix) -> i32 {
    let abs = i32::from(*v).abs();
    let level = dsp::quantdiv(abs as u32, u32::from(mtx.iq[0][0]), mtx.bias[0][0]);
    let quantized = level * i32::from(mtx.q[0][0]);
    let err = abs - quantized;
    let (quantized, err) = if *v < 0 {
        (-quantized, -err)
    } else {
        (quantized, err)
    };
    *v = quantized as i16;
    err >> DSCALE
}

/// `dc` has the DC coefficients of the four blocks of U, then of V.
fn correct_dc_values(
    top_derr: DError,
    left_derr: DError,
    mtx: &Matrix,
    dc: &mut [i16; 8],
) -> BlockErrors {
    //         | top[0] | top[1]
    // --------+--------+---------
    // left[0] |  dc[0]    dc[1]  <->   err0 err1
    // left[1] |  dc[2]    dc[3]        err2 err3
    let mut derr = [[0; 3]; 2];
    let planes = dc.as_chunks_mut::<4>().0.iter_mut().zip(&mut derr);
    for (([c0, c1, c2, c3], derr), (top, left)) in planes.zip(top_derr.into_iter().zip(left_derr)) {
        let ([top0, top1], [left0, left1]) = (top.map(i32::from), left.map(i32::from));
        let diffuse = |c: &mut i16, above: i32, before: i32| {
            *c = (i32::from(*c) + ((C1 * above + C2 * before) >> (DSHIFT - DSCALE))) as i16;
            quantize_single(c, mtx)
        };
        let err0 = diffuse(c0, top0, left0);
        let err1 = diffuse(c1, top1, err0);
        let err2 = diffuse(c2, err0, left1);
        let err3 = diffuse(c3, err1, err2);
        // An error is at most the quantizer step, which is at most 132.
        *derr = [err1 as i8, err2 as i8, err3 as i8];
    }
    derr
}

fn store_diffusion_errors(it: &mut EncIterator, derr: BlockErrors) -> Checked {
    let Some(top_derr) = &mut it.top_derr else {
        return Ok(());
    };
    let top_derr = top_derr.at_mut(it.x)?;
    for ((top, left), [err1, err2, err3]) in top_derr.iter_mut().zip(&mut it.left_derr).zip(derr) {
        let three_quarters = ((3 * i32::from(err3)) >> 2) as i8;
        *left = [err1, three_quarters];
        *top = [err2, err3 - three_quarters];
    }
    Ok(())
}

//------------------------------------------------------------------------------
// Reconstruct with each mode, and pick the one with the lowest rate + lambda * distortion.

/// The step between the 4x4 blocks, from the first three AC coefficients of their DCs.
fn max_delta(dcs: &Coeffs) -> i32 {
    let [[_, v0, v1, _], [v2, ..], ..] = dcs.map(|row| row.map(|dc| i32::from(dc).abs()));
    v0.max(v1).max(v2)
}

/// `src_tt` is what `ttransform` makes of the source. Returns the one of the two `Intra16` that has the result.
fn pick_best_intra16<'a>(
    it: &mut EncIterator,
    dqm: &SegmentInfo,
    proba: &Proba,
    (src, src_tt): (&Lanes<u8, 16>, &[i32; 16]),
    [mut cur, mut best]: [&'a mut Intra16; 2],
) -> Checked<&'a Intra16> {
    let preds = dsp::intra16_preds(
        (it.x > 0).then_some(&it.y_left),
        (it.y > 0).then_some(it.y_top()?),
    );
    let mut flat = is_flat_source16(&it.y_in);
    for ((mode, pred), fixed_cost) in preds.iter().enumerate().zip(FIXED_COSTS_I16) {
        cur.mode = mode as u8;
        let nz = cur.reconstruct(src, pred, dqm);
        let tdisto = src_tt.iter().zip(dsp::ttransform(&cur.out));
        let tdisto = tdisto.map(|(&src, out)| dsp::disto4x4(src, out)).sum();
        let cost = it.get_cost_luma16(
            proba,
            &cur.y_dc_levels,
            &cur.y_ac_levels,
            &cur.num_ac_levels,
        )?;
        cur.score = Score {
            d: i64::from(dsp::sse(src, &cur.out).iter().sum::<i32>()),
            sd: i64::from(mult_8b(dqm.tlambda, tdisto)),
            h: i64::from(fixed_cost),
            r: i64::from(cost),
            score: 0,
            nz,
        };
        if flat {
            // Refine the first impression, which was on the samples: are there AC levels?
            flat = nz & 0xffff == 0;
            if flat {
                // On a very flat block, what matters is a very low distortion.
                cur.score.d *= 2;
                cur.score.sd *= 2;
            }
        }
        cur.score.set_rd_score(dqm.lambda_i16);
        if mode == 0 || cur.score.score < best.score.score {
            core::mem::swap(&mut cur, &mut best);
        }
    }
    best.score.set_rd_score(dqm.lambda_mode);
    Ok(best)
}

struct Intra4 {
    score: Score,
    modes: [u8; 16],
    y_ac_levels: [Coeffs; 16],
    out: Luma,
}

/// Returns the 4x4 predictions, if they beat the score of the 16x16 one.
fn pick_best_intra4(
    it: &mut EncIterator,
    enc: &Encoder<'_>,
    dqm: &SegmentInfo,
    src_tt: &[i32; 16],
    score_i16: i64,
) -> Checked<Option<Intra4>> {
    if enc.max_i4_header_bits == 0 {
        return Ok(None);
    }
    let preds_pos = enc.preds_pos(it.x, it.y);
    let mut best = Intra4 {
        score: Score::new(),
        modes: [0; 16],
        y_ac_levels: Default::default(),
        out: Luma::default(),
    };
    let mut total_header_bits = 0;
    // The cost of saying that the macroblock is i4x4: `bit_cost(false, 145)`.
    best.score.h = 211;
    best.score.set_rd_score(dqm.lambda_mode);
    let (mut tmp, mut levels, mut out) = (Lanes::new(), Lanes::new(), Lanes::new());
    it.start_i4()?;
    loop {
        let i4 = it.i4;
        let (x, y) = (i4 & 3, i4 >> 2);
        let src_tt = src_tt.at(i4)?;
        let left = match x {
            0 => enc.preds.at(preds_pos + y * enc.preds_w - 1)?,
            _ => best.modes.at(i4 - 1)?,
        };
        let top = match y {
            0 => enc.preds.at(preds_pos - enc.preds_w + x)?,
            _ => best.modes.at(i4 - 4)?,
        };
        let mode_costs: &[u16; NUM_BMODES] = FIXED_COSTS_I4
            .at_ref(usize::from(top))?
            .at_ref(usize::from(left))?;

        // Reconstruct with all the modes at once.
        let src = Lanes::<u8, 16>::splat(it.y_in.at_ref(i4)?);
        let preds = dsp::intra4_preds(it.i4_edge()?);
        dsp::ftransform(&src, &preds, &mut tmp);
        dsp::quantize(&mut tmp, &dqm.y1, &mut levels);
        dsp::itransform(&preds, &tmp, &mut out);
        let distortions = dsp::sse(&src, &out).into_iter().zip(dsp::ttransform(&out));
        let counts = dsp::num_levels(&levels)
            .into_iter()
            .zip(dsp::count_non_zero_ac(&levels));

        let mut rd_i4 = Score::new();
        let mut best_mode = None;
        for ((mode, &mode_cost), ((d, out_tt), (num_levels, non_zero_ac))) in
            mode_costs.iter().enumerate().zip(distortions.zip(counts))
        {
            let mut rd_tmp = Score {
                d: i64::from(d),
                sd: i64::from(mult_8b(dqm.tlambda, dsp::disto4x4(src_tt, out_tt))),
                h: i64::from(mode_cost),
                // Keep complex modes from mispredicting a flat area.
                r: if mode > 0 && is_flat(&[non_zero_ac], FLATNESS_LIMIT_I4) {
                    FLATNESS_PENALTY
                } else {
                    0
                },
                score: 0,
                nz: u32::from(num_levels != 0) << i4,
            };
            rd_tmp.set_rd_score(dqm.lambda_i4);
            if best_mode.is_some() && rd_tmp.score >= rd_i4.score {
                continue;
            }
            let levels = levels.at(mode)?;
            rd_tmp.r += i64::from(it.get_cost_luma4(&enc.proba, &levels, num_levels)?);
            rd_tmp.set_rd_score(dqm.lambda_i4);
            if best_mode.is_none() || rd_tmp.score < rd_i4.score {
                rd_i4 = rd_tmp;
                best_mode = Some(mode);
                best.y_ac_levels.put(i4, levels)?;
            }
        }
        rd_i4.set_rd_score(dqm.lambda_mode);
        best.score.add(&rd_i4);
        if best.score.score >= score_i16 {
            return Ok(None);
        }
        total_header_bits += rd_i4.h;
        if total_header_bits > i64::from(enc.max_i4_header_bits) {
            return Ok(None);
        }
        let best_mode = best_mode.unwrap_or(0);
        let best_block = out.at(best_mode)?;
        best.out.put(i4, best_block)?;
        best.modes.put(i4, best_mode as u8)?;
        let non_zero = u8::from(rd_i4.nz != 0);
        it.top_nz.put(x, non_zero)?;
        it.left_nz.put(y, non_zero)?;
        if !it.rotate_i4(&best_block)? {
            return Ok(Some(best));
        }
    }
}

fn pick_best_uv(
    it: &mut EncIterator,
    dqm: &SegmentInfo,
    proba: &Proba,
    rd: &mut ModeScore,
) -> Checked {
    let [dc, tm, ve, he] = &dsp::intra_chroma_preds(
        (it.x > 0).then_some([&it.u_left, &it.v_left]),
        (it.y > 0).then_some(it.uv_top()?),
    );

    // Reconstruct with the four modes at once: eight blocks each.
    let src = &Lanes::<u8, 8>::from_blocks(it.uv_in.as_flattened());
    let src = Lanes::<u8, 32>::concat([src; NUM_PRED_MODES]);
    let preds = Lanes::concat([dc, tm, ve, he]);
    let (mut tmp, mut levels, mut out) = (Lanes::new(), Lanes::new(), Lanes::new());
    dsp::ftransform(&src, &preds, &mut tmp);
    let mut derr = [[[0; 3]; 2]; NUM_PRED_MODES];
    if let Some(top_derr) = &it.top_derr {
        let top_derr = top_derr.at(it.x)?;
        let dcs = tmp.first_mut().as_chunks_mut().0.iter_mut();
        for (dc, derr) in dcs.zip(&mut derr) {
            *derr = correct_dc_values(top_derr, it.left_derr, &dqm.uv, dc);
        }
    }
    dsp::quantize(&mut tmp, &dqm.uv, &mut levels);
    dsp::itransform(&preds, &tmp, &mut out);
    let distortions = dsp::sse(&src, &out);
    let non_zero_ac = dsp::count_non_zero_ac(&levels);
    let num_levels = dsp::num_levels(&levels);

    let modes = FIXED_COSTS_UV.into_iter().enumerate();
    let modes = modes.zip(distortions.as_chunks::<8>().0);
    let modes = modes.zip(num_levels.as_chunks::<8>().0);
    let modes = modes.zip(non_zero_ac.as_chunks::<8>().0);
    let mut rd_best = Score::new();
    for ((((mode, fixed_cost), distortions), mode_num_levels), non_zero_ac) in modes {
        let mut rd_uv = Score {
            d: i64::from(distortions.iter().sum::<i32>()),
            // No texture distortion here: it tends to flatten areas.
            sd: 0,
            h: i64::from(fixed_cost),
            r: i64::from(it.get_cost_uv(proba, &levels, &num_levels, 8 * mode)?),
            score: 0,
            nz: non_zero_bits(mode_num_levels) << 16,
        };
        if mode > 0 && is_flat(non_zero_ac, FLATNESS_LIMIT_UV) {
            rd_uv.r += FLATNESS_PENALTY * 8;
        }
        rd_uv.set_rd_score(dqm.lambda_uv);
        if mode == 0 || rd_uv.score < rd_best.score {
            rd_best = rd_uv;
            rd.mode_uv = mode as u8;
        }
    }
    rd.score.add(&rd_best);
    let first_block = 8 * usize::from(rd.mode_uv);
    let blocks = rd.uv_levels.iter_mut().zip(it.uv_out.as_flattened_mut());
    for (n, (uv_levels, uv_out)) in (first_block..).zip(blocks) {
        *uv_levels = levels.at(n)?;
        *uv_out = out.at(n)?;
    }
    store_diffusion_errors(it, derr.at(usize::from(rd.mode_uv))?)
}

/// Picks the modes of the current macroblock and fills the levels.
pub(super) fn decimate(enc: &mut Encoder<'_>, it: &mut EncIterator) -> Checked<ModeScore> {
    let segment = usize::from(enc.mb_mut(it.x, it.y)?.segment);
    let dqm = enc.dqm.at_ref(segment)?;
    let src = Lanes::from_blocks(&it.y_in);
    let src_tt = dsp::ttransform(&src);

    let mut trials = [Intra16::new(), Intra16::new()];
    let i16 = pick_best_intra16(it, dqm, &enc.proba, (&src, &src_tt), trials.each_mut())?;
    // A blocky macroblock, with nothing but DCs, and a fairly high distortion: record the step between its blocks, for the
    // filter to be strong enough to smooth it out.
    let max_edge = ((i16.score.nz & 0x100_ffff) == 0x100_0000 && i16.score.d > dqm.min_disto)
        .then(|| max_delta(&i16.y_dc_levels));
    let i4 = pick_best_intra4(it, enc, dqm, &src_tt, i16.score.score)?;
    let mut rd = ModeScore {
        score: i16.score,
        y_dc_levels: i16.y_dc_levels,
        y_ac_levels: Default::default(),
        uv_levels: Default::default(),
        is_i16: i4.is_none(),
        mode_uv: 0,
    };
    let modes = match i4 {
        Some(i4) => {
            rd.score = i4.score;
            rd.y_ac_levels = i4.y_ac_levels;
            it.y_out = i4.out;
            i4.modes
        }
        None => {
            rd.y_ac_levels = i16.y_ac_levels.to_blocks();
            it.y_out = i16.out.to_blocks();
            [i16.mode; 16]
        }
    };
    pick_best_uv(it, dqm, &enc.proba, &mut rd)?;

    if let Some(max_edge) = max_edge {
        let dqm = enc.dqm.at_mut(segment)?;
        dqm.max_edge = dqm.max_edge.max(max_edge);
    }
    enc.set_intra_modes(it.x, it.y, rd.is_i16, &modes, rd.mode_uv)?;
    Ok(rd)
}
