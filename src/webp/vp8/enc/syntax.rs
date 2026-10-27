//! `syntax_enc.c`: the frame header and the first partition.

use super::bit_writer::BitWriter;
use super::tree::{code_intra_modes, write_probas};
use super::{EncodeError, Encoder};
use crate::util::OutOfMemory;

const VP8_SIGNATURE: [u8; 3] = [0x9d, 0x01, 0x2a];
const VP8_MAX_PARTITION0_SIZE: usize = 1 << 19;
const VP8_FRAME_HEADER_SIZE: usize = 10;

/// Paragraph 9.1.
fn frame_header(
    enc: &Encoder<'_>,
    size0: usize,
) -> Result<[u8; VP8_FRAME_HEADER_SIZE], EncodeError> {
    if size0 >= VP8_MAX_PARTITION0_SIZE {
        return Err(EncodeError::Partition0Overflow);
    }
    // A key frame (1 bit), of profile 0 (3 bits), to be shown (1 bit), and the size of the first partition (19 bits).
    let [b0, b1, b2, _] = ((1 << 4) | ((size0 as u32) << 5)).to_le_bytes();
    let [s0, s1, s2] = VP8_SIGNATURE;
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

fn generate_partition0(enc: &Encoder<'_>) -> Result<Vec<u8>, EncodeError> {
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
    Ok(bw.finish()?)
}

/// `VP8EncWrite`: the payload of the `VP8 ` chunk. libwebp counts the padding to an even size as part of it.
pub(super) fn write(enc: &Encoder<'_>, tokens: &[u8]) -> Result<Vec<u8>, EncodeError> {
    let part0 = generate_partition0(enc)?;
    let header = frame_header(enc, part0.len())?;
    let size = header.len() + part0.len() + tokens.len();
    let mut out = Vec::new();
    out.try_reserve_exact(size + (size & 1))
        .map_err(|_| OutOfMemory)?;
    out.extend_from_slice(&header);
    out.extend_from_slice(&part0);
    out.extend_from_slice(tokens);
    if size & 1 != 0 {
        out.push(0);
    }
    Ok(out)
}
