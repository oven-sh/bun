//! The part of `zstd_compress.c` that turns the sequences and the literals of a block into its content.

use super::fse::{FseCTable, FseRepeat};
use super::huf::{self, HUF_OPTIMAL_DEPTH_THRESHOLD, HufFlags, HufRepeat};
use super::internal::{
    EntropyCTables, EntropyCTablesMetadata, FseCTables, FseCTablesMetadata, HufCTables,
    HufCTablesMetadata, LongLengthType, SeqChunk, SeqStore, Strategy, min_gain,
};
use super::literals::compress_literals;
use super::params::CCtxParams;
use super::sequences::{
    self, CodeCounts, CodeKind, LL_KIND, ML_KIND, OF_KIND, SeqCodes, SeqHistograms, build_ctable,
    cross_entropy_cost, encode_sequences, fse_bit_cost, select_encoding_type, summarize,
};
use super::{hist, huf::HufCTable};
use crate::common::{
    HUF_SYMBOLVALUE_MAX, LIT_HUF_LOG, LL_BITS, LL_DEFAULT_NORM, LL_DEFAULT_NORM_LOG, LONGNBSEQ,
    MINMATCH, ML_BITS, ML_DEFAULT_NORM, ML_DEFAULT_NORM_LOG, OF_DEFAULT_NORM, OF_DEFAULT_NORM_LOG,
    SymbolEncodingType, ZSTD_BLOCKHEADERSIZE,
};
use crate::error::{Error, Result};
use crate::util::{SliceExt, write_le16};

/// `ZSTD_literalsCompressionIsDisabled`
pub(crate) fn literals_compression_is_disabled(cctx_params: &CCtxParams) -> bool {
    cctx_params.c_params.strat() == Strategy::Fast && cctx_params.c_params.target_length > 0
}

/// `ZSTD_seqToCodes`, and the distributions of the codes.
fn seq_to_codes(store: &mut SeqStore, chunk: &SeqChunk) -> Result<SeqHistograms> {
    let range = chunk.seq_start..chunk.seq_end;
    store.make_room_for_codes()?;
    Ok(sequences::seq_to_codes(
        store.codes.sub_mut(range.clone())?,
        store.sequences.sub(range)?,
        chunk.long_length_type,
        chunk.long_length_pos as usize,
    ))
}

/// `ZSTD_symbolEncodingTypeStats_t`
struct SymbolEncodingTypeStats {
    ll_type: SymbolEncodingType,
    off_type: SymbolEncodingType,
    ml_type: SymbolEncodingType,
    /// Of the headers of the tables.
    size: usize,
    /// The size of the last header written for a table, 0 if there is none.
    last_count_size: usize,
}

/// The table of one kind of code in the previous block.
#[derive(Clone, Copy)]
struct PrevTable<'a> {
    table: &'a FseCTable,
    repeat_mode: FseRepeat,
}

/// The header of a table.
struct TableHeader {
    ty: SymbolEncodingType,
    size: usize,
}

/// Chooses how to encode `nb_seq` codes, the last of which is `last_code` and of which `count` is the distribution,
/// makes the table and writes its header.
fn build_table(
    kind: &CodeKind,
    prev: PrevTable<'_>,
    next_table: &mut FseCTable,
    next_repeat_mode: &mut FseRepeat,
    count: &mut CodeCounts,
    nb_seq: usize,
    last_code: u8,
    dst: &mut [u8],
    strategy: Strategy,
) -> Result<TableHeader> {
    let summary = summarize(count);
    let max = summary.max_symbol_value;
    *next_repeat_mode = prev.repeat_mode;
    let ty = select_encoding_type(
        next_repeat_mode,
        count,
        max,
        summary.largest,
        nb_seq,
        kind.fse_log,
        prev.table,
        kind.default_norm,
        kind.default_norm_log,
        // The predefined table has no code for the largest offsets.
        max <= kind.default_max,
        strategy,
    )?;
    let size = build_ctable(
        dst, next_table, kind, ty, count, max, nb_seq, last_code, prev.table,
    )?;
    Ok(TableHeader { ty, size })
}

/// `ZSTD_buildSequencesStatistics`: makes the tables for `nb_seq` sequences, which is not 0, the last of which has the
/// codes `last_codes`, and writes their headers to `dst`.
fn build_sequences_statistics(
    histograms: &mut SeqHistograms,
    nb_seq: usize,
    last_codes: SeqCodes,
    prev_entropy: &FseCTables,
    next_entropy: &mut FseCTables,
    dst: &mut [u8],
    strategy: Strategy,
) -> Result<SymbolEncodingTypeStats> {
    let mut op = 0usize;
    let mut last_count_size = 0;
    let mut written = |header: &TableHeader| {
        if header.ty == SymbolEncodingType::Compressed {
            last_count_size = header.size;
        }
        op += header.size;
        op
    };

    let ll = build_table(
        &LL_KIND,
        PrevTable {
            table: &prev_entropy.litlength_c_table,
            repeat_mode: prev_entropy.litlength_repeat_mode,
        },
        &mut next_entropy.litlength_c_table,
        &mut next_entropy.litlength_repeat_mode,
        &mut histograms.ll,
        nb_seq,
        last_codes.ll as u8,
        dst,
        strategy,
    )?;
    let op_of = written(&ll);
    let of = build_table(
        &OF_KIND,
        PrevTable {
            table: &prev_entropy.offcode_c_table,
            repeat_mode: prev_entropy.offcode_repeat_mode,
        },
        &mut next_entropy.offcode_c_table,
        &mut next_entropy.offcode_repeat_mode,
        &mut histograms.of,
        nb_seq,
        last_codes.of as u8,
        dst.sub_mut(op_of..)?,
        strategy,
    )?;
    let op_ml = written(&of);
    let ml = build_table(
        &ML_KIND,
        PrevTable {
            table: &prev_entropy.matchlength_c_table,
            repeat_mode: prev_entropy.matchlength_repeat_mode,
        },
        &mut next_entropy.matchlength_c_table,
        &mut next_entropy.matchlength_repeat_mode,
        &mut histograms.ml,
        nb_seq,
        last_codes.ml as u8,
        dst.sub_mut(op_ml..)?,
        strategy,
    )?;
    let size = written(&ml);
    Ok(SymbolEncodingTypeStats {
        ll_type: ll.ty,
        off_type: of.ty,
        ml_type: ml.ty,
        size,
        last_count_size,
    })
}

/// Writes how many sequences a block has. `dst` has room for 3 bytes. Returns how many it takes.
pub(crate) fn write_nb_seq(dst: &mut [u8], nb_seq: usize) -> Result<usize> {
    if nb_seq < 128 {
        dst.put(0, nb_seq as u8)?;
        Ok(1)
    } else if nb_seq < LONGNBSEQ {
        dst.put(0, ((nb_seq >> 8) + 0x80) as u8)?;
        dst.put(1, nb_seq as u8)?;
        Ok(2)
    } else {
        dst.put(0, 0xFF)?;
        write_le16(dst, 1, (nb_seq - LONGNBSEQ) as u16)?;
        Ok(3)
    }
}

/// `ZSTD_entropyCompressSeqStore_internal`: returns 0 if the block is better left uncompressed.
fn entropy_compress_seq_store_internal(
    dst: &mut [u8],
    store: &mut SeqStore,
    chunk: &SeqChunk,
    prev_entropy: &EntropyCTables,
    next_entropy: &mut EntropyCTables,
    cctx_params: &CCtxParams,
    sampled_literals: Option<&[u8]>,
) -> Result<usize> {
    const SUSPECT_UNCOMPRESSIBLE_LITERAL_RATIO: usize = 20;
    let strategy = cctx_params.c_params.strat();
    let nb_seq = chunk.nb_seq();
    let lit_size = chunk.lit_size();
    let mut op = 0usize;
    debug_assert!(sampled_literals.is_none() || nb_seq == 0);

    {
        let suspect_uncompressible = sampled_literals.is_none()
            && (nb_seq == 0 || lit_size / nb_seq >= SUSPECT_UNCOMPRESSIBLE_LITERAL_RATIO);
        op += compress_literals(
            dst,
            match sampled_literals {
                Some(literals) => literals,
                None => store.lit_buffer.sub(chunk.lit_start..chunk.lit_end)?,
            },
            &prev_entropy.huf,
            &mut next_entropy.huf,
            strategy,
            literals_compression_is_disabled(cctx_params),
            suspect_uncompressible,
        )?;
    }

    if dst.len() - op < 3 + 1 {
        return Err(Error::DstSizeTooSmall);
    }
    op += write_nb_seq(dst.sub_mut(op..)?, nb_seq)?;
    if nb_seq == 0 {
        next_entropy.fse.copy_from(&prev_entropy.fse);
        return Ok(op);
    }
    let (last_count_size, many_bits) = {
        let seq_head = op;
        op += 1;
        let mut histograms = seq_to_codes(store, chunk)?;
        let stats = build_sequences_statistics(
            &mut histograms,
            nb_seq,
            store.codes.at(chunk.seq_end - 1)?,
            &prev_entropy.fse,
            &mut next_entropy.fse,
            dst.sub_mut(op..)?,
            strategy,
        )?;
        dst.put(
            seq_head,
            (((stats.ll_type as u32) << 6)
                + ((stats.off_type as u32) << 4)
                + ((stats.ml_type as u32) << 2)) as u8,
        )?;
        op += stats.size;
        (stats.last_count_size, histograms.many_bits)
    };

    let range = chunk.seq_start..chunk.seq_end;
    let bitstream_size = encode_sequences(
        dst.sub_mut(op..)?,
        &next_entropy.fse,
        store.codes.sub(range.clone())?,
        store.sequences.sub(range)?,
        many_bits,
    )?;
    op += bitstream_size;
    // Decoders up to 1.3.4 fail on a table header with fewer than 4 bytes after it.
    if last_count_size != 0 && last_count_size + bitstream_size < 4 {
        return Ok(0);
    }
    Ok(op)
}

/// `ZSTD_entropyCompressSeqStore`: the content of a compressed block for `chunk`, which stands for `block_size` bytes.
/// Returns 0 if the block is better left uncompressed. A block without sequences can have its literals in
/// `sampled_literals` instead of the store, if [`huf::samples_are_incompressible`] has been asked and is false for them.
pub(crate) fn entropy_compress_seq_store(
    store: &mut SeqStore,
    chunk: &SeqChunk,
    prev_entropy: &EntropyCTables,
    next_entropy: &mut EntropyCTables,
    cctx_params: &CCtxParams,
    dst: &mut [u8],
    block_size: usize,
    sampled_literals: Option<&[u8]>,
) -> Result<usize> {
    let c_size = match entropy_compress_seq_store_internal(
        dst,
        store,
        chunk,
        prev_entropy,
        next_entropy,
        cctx_params,
        sampled_literals,
    ) {
        // There is room for the block as it is.
        Err(Error::DstSizeTooSmall) if block_size <= dst.len() => return Ok(0),
        c_size => c_size?,
    };
    let max_c_size = block_size.wrapping_sub(min_gain(block_size, cctx_params.c_params.strat()));
    if c_size >= max_c_size {
        return Ok(0);
    }
    Ok(c_size)
}

/// What the C code has for the size of something that failed: an error code, which is more than any size.
fn size_or_error(size: Result<usize>) -> usize {
    size.unwrap_or_else(|code| 0usize.wrapping_sub(code as usize))
}

/// `ZSTD_buildBlockEntropyStats_literals`: makes the table for the literals `src`, and its description in
/// `huf_metadata`. Returns the size of the description.
fn build_block_entropy_stats_literals(
    src: &[u8],
    prev_huf: &HufCTables,
    next_huf: &mut HufCTables,
    huf_metadata: &mut HufCTablesMetadata,
    literals_compression_is_disabled: bool,
    huf_flags: HufFlags,
) -> Result<usize> {
    const COMPRESS_LITERALS_SIZE_MIN: usize = 63;
    let mut count = [0u32; HUF_SYMBOLVALUE_MAX as usize + 1];
    let src_size = src.len();
    let mut max_symbol_value = HUF_SYMBOLVALUE_MAX;
    let mut repeat = prev_huf.repeat_mode;

    next_huf.copy_from(prev_huf);

    if literals_compression_is_disabled {
        huf_metadata.h_type = SymbolEncodingType::Basic;
        return Ok(0);
    }

    let min_lit_size = if prev_huf.repeat_mode == HufRepeat::Valid {
        6
    } else {
        COMPRESS_LITERALS_SIZE_MIN
    };
    if src_size <= min_lit_size {
        huf_metadata.h_type = SymbolEncodingType::Basic;
        return Ok(0);
    }

    let largest = hist::count_wksp(&mut count, &mut max_symbol_value, src)?;
    if largest == src_size {
        huf_metadata.h_type = SymbolEncodingType::Rle;
        return Ok(0);
    }
    if largest <= (src_size >> 7) + 4 {
        huf_metadata.h_type = SymbolEncodingType::Basic;
        return Ok(0);
    }

    if repeat == HufRepeat::Check
        && !huf::validate_ctable(&prev_huf.c_table, &count, max_symbol_value)
    {
        repeat = HufRepeat::None;
    }

    next_huf.c_table = HufCTable::new();
    let huff_log = huf::optimal_table_log(
        LIT_HUF_LOG,
        src_size,
        max_symbol_value,
        &mut next_huf.c_table,
        &count,
        huf_flags,
    );
    let huff_log =
        huf::build_ctable(&mut next_huf.c_table, &count, max_symbol_value, huff_log)? as u32;

    let new_c_size = huf::estimate_compressed_size(&next_huf.c_table, &count, max_symbol_value);
    let h_size_result = huf::write_ctable(
        &mut huf_metadata.huf_des_buffer,
        &next_huf.c_table,
        max_symbol_value,
        huff_log,
    );
    let h_size = size_or_error(h_size_result);
    if repeat != HufRepeat::None {
        let old_c_size = huf::estimate_compressed_size(&prev_huf.c_table, &count, max_symbol_value);
        if old_c_size < src_size
            && (old_c_size <= h_size.wrapping_add(new_c_size)
                || h_size.wrapping_add(12) >= src_size)
        {
            next_huf.copy_from(prev_huf);
            huf_metadata.h_type = SymbolEncodingType::Repeat;
            return Ok(0);
        }
    }
    if new_c_size.wrapping_add(h_size) >= src_size {
        next_huf.copy_from(prev_huf);
        huf_metadata.h_type = SymbolEncodingType::Basic;
        return Ok(0);
    }
    huf_metadata.h_type = SymbolEncodingType::Compressed;
    next_huf.repeat_mode = HufRepeat::Check;
    h_size_result
}

/// `ZSTD_buildBlockEntropyStats_sequences`: makes the tables for the sequences of `chunk`, and their description in
/// `fse_metadata`. Returns the distributions of the codes.
fn build_block_entropy_stats_sequences(
    store: &mut SeqStore,
    chunk: &SeqChunk,
    prev_entropy: &FseCTables,
    next_entropy: &mut FseCTables,
    cctx_params: &CCtxParams,
    fse_metadata: &mut FseCTablesMetadata,
) -> Result<SeqHistograms> {
    let mut histograms = seq_to_codes(store, chunk)?;
    let stats = if chunk.nb_seq() != 0 {
        build_sequences_statistics(
            &mut histograms,
            chunk.nb_seq(),
            store.codes.at(chunk.seq_end - 1)?,
            prev_entropy,
            next_entropy,
            &mut fse_metadata.fse_tables_buffer,
            cctx_params.c_params.strat(),
        )?
    } else {
        next_entropy.litlength_repeat_mode = FseRepeat::None;
        next_entropy.offcode_repeat_mode = FseRepeat::None;
        next_entropy.matchlength_repeat_mode = FseRepeat::None;
        SymbolEncodingTypeStats {
            ll_type: SymbolEncodingType::Basic,
            off_type: SymbolEncodingType::Basic,
            ml_type: SymbolEncodingType::Basic,
            size: 0,
            last_count_size: 0,
        }
    };
    fse_metadata.ll_type = stats.ll_type;
    fse_metadata.of_type = stats.off_type;
    fse_metadata.ml_type = stats.ml_type;
    fse_metadata.last_count_size = stats.last_count_size;
    fse_metadata.fse_tables_size = stats.size;
    Ok(histograms)
}

/// `ZSTD_buildBlockEntropyStats`: makes the tables for `chunk` in `next_entropy`, and what it takes to write them in
/// `entropy_metadata`. Returns the distributions of the codes of the sequences.
pub(crate) fn build_block_entropy_stats(
    store: &mut SeqStore,
    chunk: &SeqChunk,
    prev_entropy: &EntropyCTables,
    next_entropy: &mut EntropyCTables,
    cctx_params: &CCtxParams,
    entropy_metadata: &mut EntropyCTablesMetadata,
) -> Result<SeqHistograms> {
    let huf_flags = HufFlags {
        optimal_depth: cctx_params.c_params.strat() >= HUF_OPTIMAL_DEPTH_THRESHOLD,
        ..HufFlags::default()
    };
    entropy_metadata.huf_metadata.huf_des_size = build_block_entropy_stats_literals(
        store.lit_buffer.sub(chunk.lit_start..chunk.lit_end)?,
        &prev_entropy.huf,
        &mut next_entropy.huf,
        &mut entropy_metadata.huf_metadata,
        literals_compression_is_disabled(cctx_params),
        huf_flags,
    )?;
    build_block_entropy_stats_sequences(
        store,
        chunk,
        &prev_entropy.fse,
        &mut next_entropy.fse,
        cctx_params,
        &mut entropy_metadata.fse_metadata,
    )
}

/// `ZSTD_estimateBlockSize_literal`
fn estimate_block_size_literal(
    literals: &[u8],
    huf: &HufCTables,
    huf_metadata: &HufCTablesMetadata,
    write_entropy: bool,
) -> usize {
    let mut count = [0u32; HUF_SYMBOLVALUE_MAX as usize + 1];
    let mut max_symbol_value = HUF_SYMBOLVALUE_MAX;
    let lit_size = literals.len();
    let literal_section_header_size =
        3 + usize::from(lit_size >= 1 << 10) + usize::from(lit_size >= 16 << 10);
    let single_stream = lit_size < 256;

    match huf_metadata.h_type {
        SymbolEncodingType::Basic => lit_size,
        SymbolEncodingType::Rle => 1,
        SymbolEncodingType::Compressed | SymbolEncodingType::Repeat => {
            if hist::count_wksp(&mut count, &mut max_symbol_value, literals).is_err() {
                return lit_size;
            }
            let mut c_lit_size_estimate =
                huf::estimate_compressed_size(&huf.c_table, &count, max_symbol_value);
            if write_entropy {
                c_lit_size_estimate += huf_metadata.huf_des_size;
            }
            if !single_stream {
                // The jump table.
                c_lit_size_estimate += 6;
            }
            c_lit_size_estimate + literal_section_header_size
        }
    }
}

/// `ZSTD_estimateBlockSize_symbolType`: `count` is the distribution of `nb_seq` codes.
fn estimate_block_size_symbol_type(
    ty: SymbolEncodingType,
    count: &CodeCounts,
    nb_seq: usize,
    fse_c_table: &FseCTable,
    additional_bits: Option<&[u8]>,
    default_norm: &[i16],
    default_norm_log: u32,
) -> Result<usize> {
    let max = summarize(count).max_symbol_value;
    let estimate_in_bits = match ty {
        SymbolEncodingType::Basic => cross_entropy_cost(default_norm, default_norm_log, count, max),
        SymbolEncodingType::Rle => Ok(0),
        SymbolEncodingType::Compressed | SymbolEncodingType::Repeat => {
            fse_bit_cost(fse_c_table, count, max)
        }
    };
    let Ok(estimate_in_bits) = estimate_in_bits else {
        return Ok(nb_seq * 10);
    };
    Ok((estimate_in_bits + additional_bits_of(count, additional_bits)) >> 3)
}

/// How many bits follow the codes counted in `count`: as many as the code itself says, or as `additional_bits` does.
pub(crate) fn additional_bits_of(count: &CodeCounts, additional_bits: Option<&[u8]>) -> usize {
    match additional_bits {
        Some(bits) => (count.iter().zip(bits))
            .map(|(&count, &bits)| count as usize * usize::from(bits))
            .sum(),
        None => (count.iter().enumerate())
            .map(|(code, &count)| count as usize * code)
            .sum(),
    }
}

/// `ZSTD_estimateBlockSize_sequences`
fn estimate_block_size_sequences(
    histograms: &SeqHistograms,
    nb_seq: usize,
    fse_tables: &FseCTables,
    fse_metadata: &FseCTablesMetadata,
    write_entropy: bool,
) -> Result<usize> {
    let sequences_section_header_size =
        1 + 1 + usize::from(nb_seq >= 128) + usize::from(nb_seq >= LONGNBSEQ);
    let mut c_seq_size_estimate = estimate_block_size_symbol_type(
        fse_metadata.of_type,
        &histograms.of,
        nb_seq,
        &fse_tables.offcode_c_table,
        None,
        &OF_DEFAULT_NORM,
        OF_DEFAULT_NORM_LOG,
    )?;
    c_seq_size_estimate += estimate_block_size_symbol_type(
        fse_metadata.ll_type,
        &histograms.ll,
        nb_seq,
        &fse_tables.litlength_c_table,
        Some(&LL_BITS),
        &LL_DEFAULT_NORM,
        LL_DEFAULT_NORM_LOG,
    )?;
    c_seq_size_estimate += estimate_block_size_symbol_type(
        fse_metadata.ml_type,
        &histograms.ml,
        nb_seq,
        &fse_tables.matchlength_c_table,
        Some(&ML_BITS),
        &ML_DEFAULT_NORM,
        ML_DEFAULT_NORM_LOG,
    )?;
    if write_entropy {
        c_seq_size_estimate += fse_metadata.fse_tables_size;
    }
    Ok(c_seq_size_estimate + sequences_section_header_size)
}

/// `ZSTD_buildEntropyStatisticsAndEstimateSubBlockSize`: about how large a block for `chunk` would be. Overwrites
/// `next_entropy`.
pub(crate) fn build_entropy_statistics_and_estimate_sub_block_size(
    store: &mut SeqStore,
    chunk: &SeqChunk,
    prev_entropy: &EntropyCTables,
    next_entropy: &mut EntropyCTables,
    cctx_params: &CCtxParams,
    entropy_metadata: &mut EntropyCTablesMetadata,
) -> Result<usize> {
    let histograms = build_block_entropy_stats(
        store,
        chunk,
        prev_entropy,
        next_entropy,
        cctx_params,
        entropy_metadata,
    )?;
    let literals_size = estimate_block_size_literal(
        store.lit_buffer.sub(chunk.lit_start..chunk.lit_end)?,
        &next_entropy.huf,
        &entropy_metadata.huf_metadata,
        entropy_metadata.huf_metadata.h_type == SymbolEncodingType::Compressed,
    );
    let seq_size = estimate_block_size_sequences(
        &histograms,
        chunk.nb_seq(),
        &next_entropy.fse,
        &entropy_metadata.fse_metadata,
        true,
    )?;
    Ok(seq_size + literals_size + ZSTD_BLOCKHEADERSIZE)
}

/// `ZSTD_countSeqStoreLiteralsBytes`
pub(crate) fn count_seq_store_literals_bytes(store: &SeqStore, chunk: &SeqChunk) -> Result<usize> {
    let sequences = store.sequences.sub(chunk.seq_start..chunk.seq_end)?;
    let mut literals_bytes: usize = sequences
        .iter()
        .map(|seq| usize::from(seq.lit_length))
        .sum();
    if chunk.long_length_type == LongLengthType::LiteralLength
        && (chunk.long_length_pos as usize) < sequences.len()
    {
        literals_bytes += 0x10000;
    }
    Ok(literals_bytes)
}

/// `ZSTD_countSeqStoreMatchBytes`
pub(crate) fn count_seq_store_match_bytes(store: &SeqStore, chunk: &SeqChunk) -> Result<usize> {
    let sequences = store.sequences.sub(chunk.seq_start..chunk.seq_end)?;
    let mut match_bytes: usize = (sequences.iter())
        .map(|seq| usize::from(seq.ml_base) + MINMATCH as usize)
        .sum();
    if chunk.long_length_type == LongLengthType::MatchLength
        && (chunk.long_length_pos as usize) < sequences.len()
    {
        match_bytes += 0x10000;
    }
    Ok(match_bytes)
}

/// `ZSTD_deriveSeqStoreChunk`: the sequences of `store` from `start_idx` to `end_idx`.
pub(crate) fn derive_seq_store_chunk(
    store: &SeqStore,
    start_idx: usize,
    end_idx: usize,
) -> Result<SeqChunk> {
    let mut result = store.whole();
    if start_idx > 0 {
        result.seq_end = start_idx;
        result.lit_start += count_seq_store_literals_bytes(store, &result)?;
    }
    if store.long_length_type != LongLengthType::None {
        let long_length_pos = store.long_length_pos as usize;
        if long_length_pos < start_idx || long_length_pos > end_idx {
            result.long_length_type = LongLengthType::None;
        } else {
            result.long_length_pos -= start_idx as u32;
        }
    }
    result.seq_start = start_idx;
    result.seq_end = end_idx;
    if end_idx != store.sequences.len() {
        // Only the last chunk has the literals that follow the last sequence.
        result.lit_end = result.lit_start + count_seq_store_literals_bytes(store, &result)?;
    }
    Ok(result)
}
