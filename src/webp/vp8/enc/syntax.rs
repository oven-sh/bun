//! `syntax_enc.c`: the frame header and the first partition.

use super::Encoder;
use super::bit_writer::BitWriter;
use super::tree::{code_intra_modes, write_probas};
use crate::vp8::common::{FRAME_HEADER_SIZE, SIGNATURE};
use crate::{Error, Result};

const VP8_MAX_PARTITION0_SIZE: usize = 1 << 19;

/// Paragraph 9.1.
fn frame_header(enc: &Encoder<'_>, size0: usize) -> Result<[u8; FRAME_HEADER_SIZE]> {
    if size0 >= VP8_MAX_PARTITION0_SIZE {
        return Err(Error::Partition0Overflow);
    }
    // A key frame (1 bit), of profile 0 (3 bits), to be shown (1 bit), and the size of the first partition (19 bits).
    let [b0, b1, b2, _] = ((1 << 4) | ((size0 as u32) << 5)).to_le_bytes();
    let [s0, s1, s2] = SIGNATURE;
    let [w0, w1] = (enc.pic.width as u16).to_le_bytes();
    let [h0, h1] = (enc.pic.height as u16).to_le_bytes();
    Ok([b0, b1, b2, s0, s1, s2, w0, w1, h0, h1])
}

fn put_segment_header(bw: &mut BitWriter, enc: &Encoder<'_>) {
    let hdr = &enc.segment_hdr;
    if bw.put_bit_uniform(hdr.num_segments > 1) {
        bw.put_bit_uniform(hdr.update_map);
        // The quantizers and the filter strengths are always there,
        bw.put_bit_uniform(true);
        // as absolute values (paragraph 9.3).
        bw.put_bit_uniform(true);
        for dqm in &enc.dqm {
            bw.put_signed_bits(dqm.quant, 7);
        }
        for dqm in &enc.dqm {
            bw.put_signed_bits(dqm.fstrength, 6);
        }
        if hdr.update_map {
            for proba in enc.proba.segments {
                if bw.put_bit_uniform(proba != 255) {
                    bw.put_bits(u32::from(proba), 8);
                }
            }
        }
    }
}

fn put_filter_header(bw: &mut BitWriter, level: i32) {
    // Not the simple filter.
    bw.put_bit_uniform(false);
    bw.put_bits(level as u32, 6);
    // Sharpness.
    bw.put_bits(0, 3);
    // No deltas by reference frame or mode.
    bw.put_bit_uniform(false);
}

fn put_quant(bw: &mut BitWriter, enc: &Encoder<'_>) {
    bw.put_bits(enc.base_quant as u32, 7);
    // What to add for the DC of Y1, the DC of Y2 and the AC of Y2.
    bw.put_signed_bits(0, 4);
    bw.put_signed_bits(0, 4);
    bw.put_signed_bits(0, 4);
    bw.put_signed_bits(enc.dq_uv_dc, 4);
    bw.put_signed_bits(enc.dq_uv_ac, 4);
}

fn generate_partition0(enc: &Encoder<'_>) -> Result<Vec<u8>> {
    // About 7 bits a macroblock.
    let mut bw = BitWriter::new(enc.mb_w * enc.mb_h * 7 / 8)?;
    // The color space, and the clamping type.
    bw.put_bit_uniform(false);
    bw.put_bit_uniform(false);

    put_segment_header(&mut bw, enc);
    put_filter_header(&mut bw, enc.filter_level);
    // One token partition.
    bw.put_bits(0, 2);
    put_quant(&mut bw, enc);
    // The probabilities are for this frame only.
    bw.put_bit_uniform(false);
    write_probas(&mut bw, &enc.proba);
    code_intra_modes(enc, &mut bw)?;
    bw.finish()
}

/// `VP8EncWrite`: the payload of the `VP8 ` chunk, in pieces. libwebp counts the padding to an even size as part of it.
pub(super) fn write(enc: &Encoder<'_>, mut tokens: Vec<u8>) -> Result<Vec<Vec<u8>>> {
    let part0 = generate_partition0(enc)?;
    let header = frame_header(enc, part0.len())?;
    if (header.len() + part0.len() + tokens.len()) & 1 != 0 {
        tokens.try_reserve_exact(1)?;
        tokens.push(0);
    }
    Ok(vec![header.to_vec(), part0, tokens])
}
