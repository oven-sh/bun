//! `zstd_compress_literals.c`: the literals section of a block.

use super::huf::{self, HUF_OPTIMAL_DEPTH_THRESHOLD, HufFlags, HufRepeat};
use super::internal::{HufCTables, Strategy, min_gain};
use crate::common::{HUF_SYMBOLVALUE_MAX, LIT_HUF_LOG, SymbolEncodingType};
use crate::error::{ErrorCode, Result};
use crate::util::{SliceExt, write_le16, write_le24, write_le32};

/// The header of a section of raw or run-length encoded literals. Returns its size.
fn write_short_header(dst: &mut [u8], ty: SymbolEncodingType, src_size: usize) -> Result<usize> {
    let fl_size = 1 + usize::from(src_size > 31) + usize::from(src_size > 4095);
    let ty = ty as u32;
    let src_size = src_size as u32;
    match fl_size {
        1 => dst.put(0, (ty + (src_size << 3)) as u8)?,
        2 => write_le16(dst, 0, (ty + (1 << 2) + (src_size << 4)) as u16)?,
        _ => write_le24(dst, 0, ty + (3 << 2) + (src_size << 4))?,
    }
    Ok(fl_size)
}

/// `ZSTD_noCompressLiterals`
pub(crate) fn no_compress_literals(dst: &mut [u8], src: &[u8]) -> Result<usize> {
    let fl_size = 1 + usize::from(src.len() > 31) + usize::from(src.len() > 4095);
    if src.len() + fl_size > dst.len() {
        return Err(ErrorCode::DstSizeTooSmall);
    }
    write_short_header(dst, SymbolEncodingType::Basic, src.len())?;
    dst.write_at(fl_size, src)?;
    Ok(src.len() + fl_size)
}

/// `ZSTD_compressRleLiteralsBlock`: `src` is one byte repeated, and `dst` has room for 4 bytes.
pub(crate) fn compress_rle_literals_block(dst: &mut [u8], src: &[u8]) -> Result<usize> {
    let fl_size = write_short_header(dst, SymbolEncodingType::Rle, src.len())?;
    dst.put(fl_size, src.at(0)?)?;
    Ok(fl_size + 1)
}

/// `ZSTD_minLiteralsToCompress`: fewer literals than this are not worth a try.
fn min_literals_to_compress(strategy: Strategy, huf_repeat: HufRepeat) -> usize {
    let shift = (9 - strategy as i32).min(3);
    if huf_repeat == HufRepeat::Valid {
        6
    } else {
        8 << shift
    }
}

/// `ZSTD_compressLiterals`
pub(crate) fn compress_literals(
    dst: &mut [u8],
    src: &[u8],
    prev_huf: &HufCTables,
    next_huf: &mut HufCTables,
    strategy: Strategy,
    disable_literal_compression: bool,
    suspect_uncompressible: bool,
) -> Result<usize> {
    let src_size = src.len();
    let lh_size = 3 + usize::from(src_size >= 1 << 10) + usize::from(src_size >= 16 << 10);
    let mut single_stream = src_size < 256;
    let mut h_type = SymbolEncodingType::Compressed;

    next_huf.clone_from(prev_huf);

    if disable_literal_compression {
        return no_compress_literals(dst, src);
    }
    if src_size < min_literals_to_compress(strategy, prev_huf.repeat_mode) {
        return no_compress_literals(dst, src);
    }

    if dst.len() < lh_size + 1 {
        return Err(ErrorCode::DstSizeTooSmall);
    }
    let c_lit_size = {
        let mut repeat = prev_huf.repeat_mode;
        let flags = HufFlags {
            prefer_repeat: strategy < Strategy::Lazy && src_size <= 1024,
            optimal_depth: strategy >= HUF_OPTIMAL_DEPTH_THRESHOLD,
            suspect_uncompressible,
        };
        if repeat == HufRepeat::Valid && lh_size == 3 {
            single_stream = true;
        }
        let huf_compress = if single_stream {
            huf::compress_1x_repeat
        } else {
            huf::compress_4x_repeat
        };
        let c_lit_size = huf_compress(
            dst.sub_mut(lh_size..)?,
            src,
            HUF_SYMBOLVALUE_MAX,
            LIT_HUF_LOG,
            &mut next_huf.c_table,
            &mut repeat,
            flags,
        );
        if repeat != HufRepeat::None {
            h_type = SymbolEncodingType::Repeat;
        }
        c_lit_size
    };

    let min_gain = min_gain(src_size, strategy);
    let c_lit_size = match c_lit_size {
        Ok(size) if size != 0 && size < src_size.wrapping_sub(min_gain) => size,
        _ => {
            next_huf.clone_from(prev_huf);
            return no_compress_literals(dst, src);
        }
    };
    if c_lit_size == 1 {
        // With few literals, a size of 1 can also be that of a Huffman stream.
        let first = src.at(0)?;
        if src_size >= 8 || src.iter().all(|&b| b == first) {
            next_huf.clone_from(prev_huf);
            return compress_rle_literals_block(dst, src);
        }
    }

    if h_type == SymbolEncodingType::Compressed {
        next_huf.repeat_mode = HufRepeat::Check;
    }

    let h_type = h_type as u32;
    let src_size = src_size as u32;
    let c_lit = c_lit_size as u32;
    match lh_size {
        3 => {
            let lhc = h_type + (u32::from(!single_stream) << 2) + (src_size << 4) + (c_lit << 14);
            write_le24(dst, 0, lhc)?;
        }
        4 => {
            let lhc = h_type + (2 << 2) + (src_size << 4) + (c_lit << 18);
            write_le32(dst, 0, lhc)?;
        }
        _ => {
            let lhc = h_type + (3 << 2) + (src_size << 4) + (c_lit << 22);
            write_le32(dst, 0, lhc)?;
            dst.put(4, (c_lit_size >> 10) as u8)?;
        }
    }
    Ok(lh_size + c_lit_size)
}
