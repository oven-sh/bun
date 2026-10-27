//! `zstd_compress_superblock.c`: a block written as several smaller ones, of about the size asked for.

use super::block_entropy::{additional_bits_of, build_block_entropy_stats, write_nb_seq};
use super::fse::FseCTable;
use super::internal::{
    CompressedBlockState, EntropyCTables, EntropyCTablesMetadata, FseCTables, FseCTablesMetadata,
    HufCTables, HufCTablesMetadata, SeqDef, SeqStore, no_compress_block, update_rep,
};
use super::literals::{compress_rle_literals_block, no_compress_literals};
use super::params::CCtxParams;
use super::sequences::{
    CodeCounts, SeqCodes, SeqHistograms, cross_entropy_cost, encode_sequences, fse_bit_cost,
    summarize,
};
use super::{hist, huf};
use crate::common::{
    BlockType, DEFAULT_MAX_OFF, HUF_SYMBOLVALUE_MAX, LL_BITS, LL_DEFAULT_NORM, LL_DEFAULT_NORM_LOG,
    MAX_LL, MAX_ML, MINMATCH, ML_BITS, ML_DEFAULT_NORM, ML_DEFAULT_NORM_LOG, OF_DEFAULT_NORM,
    OF_DEFAULT_NORM_LOG, SymbolEncodingType, ZSTD_BLOCKHEADERSIZE,
};
use crate::error::{ErrorCode, Result};
use crate::util::{SliceExt, write_le24, write_le32};

const ZSTD_TARGETCBLOCKSIZE_MIN: usize = 1340;

/// `ZSTD_compressSubBlock_literal`: the literals section of a sub-block. Returns its size, which is 0 if it could not
/// be compressed, and whether it holds the description of the Huffman table.
fn compress_sub_block_literal(
    huf_table: &huf::HufCTable,
    huf_metadata: &HufCTablesMetadata,
    literals: &[u8],
    dst: &mut [u8],
    write_entropy: bool,
) -> Result<(usize, bool)> {
    let lit_size = literals.len();
    let header = if write_entropy { 200 } else { 0 };
    let lh_size = 3
        + usize::from(lit_size >= (1 << 10) - header)
        + usize::from(lit_size >= (16 << 10) - header);
    let mut op = lh_size;
    let single_stream = lh_size == 3;
    let h_type = if write_entropy {
        huf_metadata.h_type
    } else {
        SymbolEncodingType::Repeat
    };
    let mut c_lit_size = 0usize;

    if lit_size == 0 || huf_metadata.h_type == SymbolEncodingType::Basic {
        return Ok((no_compress_literals(dst, literals)?, false));
    } else if huf_metadata.h_type == SymbolEncodingType::Rle {
        return Ok((compress_rle_literals_block(dst, literals)?, false));
    }

    if write_entropy && huf_metadata.h_type == SymbolEncodingType::Compressed {
        let description = huf_metadata
            .huf_des_buffer
            .sub(..huf_metadata.huf_des_size)?;
        dst.write_at(op, description)?;
        op += description.len();
        c_lit_size += description.len();
    }

    {
        let out = dst.sub_mut(op..)?;
        let c_size = if single_stream {
            huf::compress_1x_using_ctable(out, literals, huf_table)
        } else {
            huf::compress_4x_using_ctable(out, literals, huf_table)
        };
        let Ok(c_size @ 1..) = c_size else {
            return Ok((0, false));
        };
        op += c_size;
        c_lit_size += c_size;
        // With the table already written, literals that expand can still be left as they are.
        if !write_entropy && c_lit_size >= lit_size {
            return Ok((no_compress_literals(dst, literals)?, false));
        }
        // The size of the header was a guess.
        if lh_size < 3 + usize::from(c_lit_size >= 1 << 10) + usize::from(c_lit_size >= 16 << 10) {
            return Ok((no_compress_literals(dst, literals)?, false));
        }
    }

    let h_type = h_type as u32;
    let lit = lit_size as u32;
    let c_lit = c_lit_size as u32;
    match lh_size {
        3 => {
            let lhc = h_type + (u32::from(!single_stream) << 2) + (lit << 4) + (c_lit << 14);
            write_le24(dst, 0, lhc)?;
        }
        4 => {
            let lhc = h_type + (2 << 2) + (lit << 4) + (c_lit << 18);
            write_le32(dst, 0, lhc)?;
        }
        _ => {
            let lhc = h_type + (3 << 2) + (lit << 4) + (c_lit << 22);
            write_le32(dst, 0, lhc)?;
            dst.put(4, (c_lit_size >> 10) as u8)?;
        }
    }
    Ok((op, true))
}

/// `ZSTD_seqDecompressedSize`: how many bytes the `nb_seqs` sequences from `first` on stand for, with `lit_size` bytes
/// of literals.
fn seq_decompressed_size(
    seq_store: &SeqStore,
    first: usize,
    nb_seqs: usize,
    lit_size: usize,
) -> Result<usize> {
    let mut match_length_sum = 0usize;
    for n in first..first + nb_seqs {
        match_length_sum += seq_store.get_sequence_length(n)?.match_length as usize;
    }
    Ok(match_length_sum + lit_size)
}

/// `ZSTD_compressSubBlock_sequences`: the sequences section of a sub-block. Returns its size, which is 0 if it could
/// not be compressed, and whether it holds the descriptions of the tables.
fn compress_sub_block_sequences(
    fse_tables: &FseCTables,
    fse_metadata: &FseCTablesMetadata,
    sequences: &[SeqDef],
    codes: &[SeqCodes],
    dst: &mut [u8],
    write_entropy: bool,
) -> Result<(usize, bool)> {
    let nb_seq = sequences.len();
    if dst.len() < 3 + 1 {
        return Err(ErrorCode::DstSizeTooSmall);
    }
    let mut op = write_nb_seq(dst, nb_seq)?;
    if nb_seq == 0 {
        return Ok((op, false));
    }

    let seq_head = op;
    op += 1;

    if write_entropy {
        dst.put(
            seq_head,
            (((fse_metadata.ll_type as u32) << 6)
                + ((fse_metadata.of_type as u32) << 4)
                + ((fse_metadata.ml_type as u32) << 2)) as u8,
        )?;
        let tables = fse_metadata
            .fse_tables_buffer
            .sub(..fse_metadata.fse_tables_size)?;
        dst.write_at(op, tables)?;
        op += tables.len();
    } else {
        let repeat = SymbolEncodingType::Repeat as u32;
        dst.put(
            seq_head,
            ((repeat << 6) + (repeat << 4) + (repeat << 2)) as u8,
        )?;
    }

    let bitstream_size = encode_sequences(dst.sub_mut(op..)?, fse_tables, codes, sequences)?;
    op += bitstream_size;
    // Decoders up to 1.3.4 fail on a table header with fewer than 4 bytes after it,
    if write_entropy
        && fse_metadata.last_count_size != 0
        && fse_metadata.last_count_size + bitstream_size < 4
    {
        return Ok((0, false));
    }
    // and those up to 1.4.0 on a sequences section of fewer than 4 bytes.
    if op - seq_head < 4 {
        return Ok((0, false));
    }
    Ok((op, true))
}

/// What [`compress_sub_block`] wrote.
struct SubBlock {
    /// 0 if it could not be compressed.
    c_size: usize,
    lit_entropy_written: bool,
    seq_entropy_written: bool,
}

/// `ZSTD_compressSubBlock`
fn compress_sub_block(
    entropy: &EntropyCTables,
    entropy_metadata: &EntropyCTablesMetadata,
    sequences: &[SeqDef],
    literals: &[u8],
    codes: &[SeqCodes],
    dst: &mut [u8],
    write_lit_entropy: bool,
    write_seq_entropy: bool,
    last_block: bool,
) -> Result<SubBlock> {
    let mut result = SubBlock {
        c_size: 0,
        lit_entropy_written: false,
        seq_entropy_written: false,
    };
    let mut op = ZSTD_BLOCKHEADERSIZE;
    {
        let (c_lit_size, written) = compress_sub_block_literal(
            &entropy.huf.c_table,
            &entropy_metadata.huf_metadata,
            literals,
            dst.sub_mut(op..)?,
            write_lit_entropy,
        )?;
        result.lit_entropy_written = written;
        if c_lit_size == 0 {
            return Ok(result);
        }
        op += c_lit_size;
    }
    {
        let (c_seq_size, written) = compress_sub_block_sequences(
            &entropy.fse,
            &entropy_metadata.fse_metadata,
            sequences,
            codes,
            dst.sub_mut(op..)?,
            write_seq_entropy,
        )?;
        result.seq_entropy_written = written;
        if c_seq_size == 0 {
            return Ok(result);
        }
        op += c_seq_size;
    }
    let c_size = op - ZSTD_BLOCKHEADERSIZE;
    let c_block_header24 =
        u32::from(last_block) + ((BlockType::Compressed as u32) << 1) + ((c_size as u32) << 3);
    write_le24(dst, 0, c_block_header24)?;
    result.c_size = op;
    Ok(result)
}

/// `ZSTD_estimateSubBlockSize_literal`
fn estimate_sub_block_size_literal(
    literals: &[u8],
    huf: &HufCTables,
    huf_metadata: &HufCTablesMetadata,
    write_entropy: bool,
) -> usize {
    let mut count = [0u32; HUF_SYMBOLVALUE_MAX as usize + 1];
    let mut max_symbol_value = HUF_SYMBOLVALUE_MAX;
    const LITERAL_SECTION_HEADER_SIZE: usize = 3;
    match huf_metadata.h_type {
        SymbolEncodingType::Basic => literals.len(),
        SymbolEncodingType::Rle => 1,
        SymbolEncodingType::Compressed | SymbolEncodingType::Repeat => {
            if hist::count_wksp(&mut count, &mut max_symbol_value, literals).is_err() {
                return literals.len();
            }
            let mut c_lit_size_estimate =
                huf::estimate_compressed_size(&huf.c_table, &count, max_symbol_value);
            if write_entropy {
                c_lit_size_estimate += huf_metadata.huf_des_size;
            }
            c_lit_size_estimate + LITERAL_SECTION_HEADER_SIZE
        }
    }
}

/// `ZSTD_estimateSubBlockSize_symbolType`: `count` is the distribution of `nb_seq` codes.
fn estimate_sub_block_size_symbol_type(
    ty: SymbolEncodingType,
    count: &CodeCounts,
    nb_seq: usize,
    fse_c_table: &FseCTable,
    additional_bits: Option<&[u8]>,
    default_norm: &[i16],
    default_norm_log: u32,
    default_max: u32,
) -> usize {
    let max = summarize(count).max_symbol_value;
    let estimate_in_bits = match ty {
        SymbolEncodingType::Basic if max <= default_max => {
            cross_entropy_cost(default_norm, default_norm_log, count, max)
        }
        SymbolEncodingType::Basic => Err(ErrorCode::Generic),
        SymbolEncodingType::Rle => Ok(0),
        SymbolEncodingType::Compressed | SymbolEncodingType::Repeat => {
            fse_bit_cost(fse_c_table, count, max)
        }
    };
    let Ok(estimate_in_bits) = estimate_in_bits else {
        return nb_seq * 10;
    };
    (estimate_in_bits + additional_bits_of(count, additional_bits)) / 8
}

/// `ZSTD_estimateSubBlockSize_sequences`
fn estimate_sub_block_size_sequences(
    histograms: &SeqHistograms,
    nb_seq: usize,
    fse_tables: &FseCTables,
    fse_metadata: &FseCTablesMetadata,
    write_entropy: bool,
) -> usize {
    const SEQUENCES_SECTION_HEADER_SIZE: usize = 3;
    if nb_seq == 0 {
        return SEQUENCES_SECTION_HEADER_SIZE;
    }
    let mut c_seq_size_estimate = estimate_sub_block_size_symbol_type(
        fse_metadata.of_type,
        &histograms.of,
        nb_seq,
        &fse_tables.offcode_c_table,
        None,
        &OF_DEFAULT_NORM,
        OF_DEFAULT_NORM_LOG,
        DEFAULT_MAX_OFF,
    );
    c_seq_size_estimate += estimate_sub_block_size_symbol_type(
        fse_metadata.ll_type,
        &histograms.ll,
        nb_seq,
        &fse_tables.litlength_c_table,
        Some(&LL_BITS),
        &LL_DEFAULT_NORM,
        LL_DEFAULT_NORM_LOG,
        MAX_LL,
    );
    c_seq_size_estimate += estimate_sub_block_size_symbol_type(
        fse_metadata.ml_type,
        &histograms.ml,
        nb_seq,
        &fse_tables.matchlength_c_table,
        Some(&ML_BITS),
        &ML_DEFAULT_NORM,
        ML_DEFAULT_NORM_LOG,
        MAX_ML,
    );
    if write_entropy {
        c_seq_size_estimate += fse_metadata.fse_tables_size;
    }
    c_seq_size_estimate + SEQUENCES_SECTION_HEADER_SIZE
}

/// `ZSTD_needSequenceEntropyTables`
fn need_sequence_entropy_tables(fse_metadata: &FseCTablesMetadata) -> bool {
    [
        fse_metadata.ll_type,
        fse_metadata.ml_type,
        fse_metadata.of_type,
    ]
    .iter()
    .any(|ty| matches!(ty, SymbolEncodingType::Compressed | SymbolEncodingType::Rle))
}

/// `countLiterals`
fn count_literals(seq_store: &SeqStore, first: usize, seq_count: usize) -> Result<usize> {
    let mut total = 0usize;
    for n in first..first + seq_count {
        total += seq_store.get_sequence_length(n)?.lit_length as usize;
    }
    Ok(total)
}

const BYTESCALE: usize = 256;

/// `sizeBlockSequences`: how many of the sequences `sp`, of which there is at least one, fit the budget.
fn size_block_sequences(
    sp: &[SeqDef],
    target_budget: usize,
    avg_lit_cost: usize,
    avg_seq_cost: usize,
    first_sub_block: bool,
) -> Result<usize> {
    let (first, rest) = sp.split_first().ok_or(ErrorCode::Generic)?;
    // The first sub-block also has the tables.
    let header_size = usize::from(first_sub_block) * 120 * BYTESCALE;
    let mut budget = header_size;
    budget += usize::from(first.lit_length) * avg_lit_cost + avg_seq_cost;
    if budget > target_budget {
        return Ok(1);
    }
    let mut in_size =
        usize::from(first.lit_length) + usize::from(first.ml_base) + MINMATCH as usize;

    let mut n = 1;
    for seq in rest {
        budget += usize::from(seq.lit_length) * avg_lit_cost + avg_seq_cost;
        in_size += usize::from(seq.lit_length) + usize::from(seq.ml_base) + MINMATCH as usize;
        // Only stop where the sub-block is expected to compress.
        if budget > target_budget && budget < in_size * BYTESCALE {
            break;
        }
        n += 1;
    }
    Ok(n)
}

/// `ZSTD_compressSubBlock_multi`
fn compress_sub_block_multi(
    seq_store: &SeqStore,
    histograms: &SeqHistograms,
    prev_c_block: &CompressedBlockState,
    next_c_block: &mut CompressedBlockState,
    entropy_metadata: &EntropyCTablesMetadata,
    cctx_params: &CCtxParams,
    dst: &mut [u8],
    src: &[u8],
    last_block: bool,
) -> Result<usize> {
    let sequences = seq_store.sequences.as_slice();
    let nb_seqs = sequences.len();
    let mut sp = 0usize;
    let literals = seq_store.literals();
    let nb_literals = literals.len();
    let mut lp = 0usize;
    let mut ip = 0usize;
    let mut op = 0usize;
    let target_c_block_size = ZSTD_TARGETCBLOCKSIZE_MIN.max(cctx_params.target_c_block_size);
    let mut write_lit_entropy =
        entropy_metadata.huf_metadata.h_type == SymbolEncodingType::Compressed;
    let mut write_seq_entropy = true;
    let codes = |from: usize, count: usize| seq_store.codes.span(from, count);

    if nb_seqs > 0 {
        let est_lit_size = estimate_sub_block_size_literal(
            literals,
            &next_c_block.entropy.huf,
            &entropy_metadata.huf_metadata,
            write_lit_entropy,
        );
        let est_block_size = estimate_sub_block_size_sequences(
            histograms,
            nb_seqs,
            &next_c_block.entropy.fse,
            &entropy_metadata.fse_metadata,
            write_seq_entropy,
        ) + est_lit_size
            + ZSTD_BLOCKHEADERSIZE;
        let avg_lit_cost = (est_lit_size * BYTESCALE)
            .checked_div(nb_literals)
            .unwrap_or(BYTESCALE);
        let avg_seq_cost = ((est_block_size - est_lit_size) * BYTESCALE) / nb_seqs;
        let nb_sub_blocks =
            ((est_block_size + target_c_block_size / 2) / target_c_block_size).max(1);
        let avg_block_budget = (est_block_size * BYTESCALE) / nb_sub_blocks;
        if est_block_size > src.len() {
            return Ok(0);
        }

        for n in 0..nb_sub_blocks - 1 {
            let seq_count = size_block_sequences(
                sequences.sub(sp..)?,
                avg_block_budget,
                avg_lit_cost,
                avg_seq_cost,
                n == 0,
            )?;
            // The last sequences go with the last literals.
            if sp + seq_count == nb_seqs {
                break;
            }
            let lit_size = count_literals(seq_store, sp, seq_count)?;
            let decompressed_size = seq_decompressed_size(seq_store, sp, seq_count, lit_size)?;
            let sub_block = compress_sub_block(
                &next_c_block.entropy,
                entropy_metadata,
                sequences.span(sp, seq_count)?,
                literals.span(lp, lit_size)?,
                codes(sp, seq_count)?,
                dst.sub_mut(op..)?,
                write_lit_entropy,
                write_seq_entropy,
                false,
            )?;
            if sub_block.c_size > 0 && sub_block.c_size < decompressed_size {
                ip += decompressed_size;
                lp += lit_size;
                op += sub_block.c_size;
                if sub_block.lit_entropy_written {
                    write_lit_entropy = false;
                }
                if sub_block.seq_entropy_written {
                    write_seq_entropy = false;
                }
                sp += seq_count;
            }
        }
    }

    {
        let lit_size = nb_literals - lp;
        let seq_count = nb_seqs - sp;
        let decompressed_size = seq_decompressed_size(seq_store, sp, seq_count, lit_size)?;
        let sub_block = compress_sub_block(
            &next_c_block.entropy,
            entropy_metadata,
            sequences.span(sp, seq_count)?,
            literals.span(lp, lit_size)?,
            codes(sp, seq_count)?,
            dst.sub_mut(op..)?,
            write_lit_entropy,
            write_seq_entropy,
            last_block,
        )?;
        if sub_block.c_size > 0 && sub_block.c_size < decompressed_size {
            ip += decompressed_size;
            op += sub_block.c_size;
            if sub_block.lit_entropy_written {
                write_lit_entropy = false;
            }
            if sub_block.seq_entropy_written {
                write_seq_entropy = false;
            }
            sp += seq_count;
        }
    }

    if write_lit_entropy {
        // The table was not written, so the next block cannot use it again.
        next_c_block
            .entropy
            .huf
            .copy_from(&prev_c_block.entropy.huf);
    }
    if write_seq_entropy && need_sequence_entropy_tables(&entropy_metadata.fse_metadata) {
        // Neither were these, and there is no going back to the previous ones.
        return Ok(0);
    }

    if ip < src.len() {
        // What did not compress.
        op += no_compress_block(dst.sub_mut(op..)?, src.sub(ip..)?, last_block)?;
        if sp < nb_seqs {
            // The sequences that were dropped did not update the repeat offsets.
            let mut rep = prev_c_block.rep;
            for (n, seq) in sequences.sub(..sp)?.iter().enumerate() {
                let ll0 = seq_store.get_sequence_length(n)?.lit_length == 0;
                update_rep(&mut rep, seq.off_base, ll0);
            }
            next_c_block.rep = rep;
        }
    }
    Ok(op)
}

/// `ZSTD_compressSuperBlock`: writes the block `src`, of which `seq_store` has the sequences, header included. Returns
/// 0 if it is better left uncompressed.
pub(crate) fn compress_super_block(
    seq_store: &mut SeqStore,
    prev_c_block: &CompressedBlockState,
    next_c_block: &mut CompressedBlockState,
    cctx_params: &CCtxParams,
    dst: &mut [u8],
    src: &[u8],
    last_block: bool,
) -> Result<usize> {
    let mut entropy_metadata = EntropyCTablesMetadata::new();
    let whole = seq_store.whole();
    let histograms = build_block_entropy_stats(
        seq_store,
        &whole,
        &prev_c_block.entropy,
        &mut next_c_block.entropy,
        cctx_params,
        &mut entropy_metadata,
    )?;
    compress_sub_block_multi(
        seq_store,
        &histograms,
        prev_c_block,
        next_c_block,
        &entropy_metadata,
        cctx_params,
        dst,
        src,
        last_block,
    )
}
