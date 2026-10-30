//! `huf_decompress.c`: Huffman decoding of literals, one symbol (X1) or up to two symbols (X2) per table lookup, step by
//! step as the C code does it. What it makes of streams that do not end where they should depends on all of that.

use super::huf::Code;
use crate::common::bitstream::{BitDStream, DStreamStatus};
use crate::common::{HUF_SYMBOLVALUE_MAX, HUF_TABLELOG_MAX};
use crate::error::{Error, Result};
use crate::util::{BUG, SliceExt, highbit32, read_le16, read_le64};

/// Tables of this log are decoded by the loops that keep four streams in registers.
const HUF_DECODER_FAST_TABLELOG: u32 = 11;

const TABLE_SIZE: usize = 1 << HUF_TABLELOG_MAX;
const TABLE_MASK: usize = TABLE_SIZE - 1;
const NB_SYMBOLS: usize = HUF_SYMBOLVALUE_MAX as usize + 1;
const NB_RANKS: usize = HUF_TABLELOG_MAX as usize + 1;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum TableType {
    X1,
    X2,
}

/// `HUF_DTable`, of capacity `ZSTD_HUFFDTABLE_CAPACITY_LOG`.
struct ExactTable<Entry> {
    table_log: u32,
    /// - `u16`, `HUF_DEltX1`: the number of bits in the low byte, and the symbol above it.
    /// - `u32`, `HUF_DEltX2`: two symbols, then the number of bits, then how many of the symbols count.
    entries: [Entry; TABLE_SIZE],
}

impl<Entry: Copy + Default> ExactTable<Entry> {
    fn new() -> Self {
        Self {
            table_log: 0,
            entries: [Entry::default(); TABLE_SIZE],
        }
    }
}

#[inline(always)]
fn entry_x1(dt: &[u16; TABLE_SIZE], index: u64) -> u16 {
    dt.get(index as usize & TABLE_MASK).copied().unwrap_or(0)
}

#[inline(always)]
fn entry_x2(dt: &[u32; TABLE_SIZE], index: u64) -> u32 {
    dt.get(index as usize & TABLE_MASK).copied().unwrap_or(0)
}

// ── the four streams ──────────────────────────────────────────────────────

/// Where the four streams of `src` start, after the jump table, and where the last one ends.
struct Streams {
    start: [usize; 4],
    length: [usize; 4],
}

impl Streams {
    /// `src` has at least 10 bytes.
    fn new(src: &[u8]) -> Result<Self> {
        let length1 = usize::from(read_le16(src, 0)?);
        let length2 = usize::from(read_le16(src, 2)?);
        let length3 = usize::from(read_le16(src, 4)?);
        let length4 = src.len().wrapping_sub(length1 + length2 + length3 + 6);
        let start1 = 6;
        let start2 = start1 + length1;
        let start3 = start2 + length2;
        let start4 = start3 + length3;
        Ok(Self {
            start: [start1, start2, start3, start4],
            length: [length1, length2, length3, length4],
        })
    }

    fn open<'a>(&self, src: &'a [u8]) -> Result<[BitDStream<'a>; 4]> {
        let [s1, s2, s3, s4] = self.start;
        let [l1, l2, l3, l4] = self.length;
        Ok([
            BitDStream::new(src.span(s1, l1)?)?,
            BitDStream::new(src.span(s2, l2)?)?,
            BitDStream::new(src.span(s3, l3)?)?,
            BitDStream::new(src.span(s4, l4)?)?,
        ])
    }
}

/// `HUF_DecompressFastArgs`, with positions in the input and the output for pointers.
struct FastArgs {
    ip: [usize; 4],
    op: [usize; 4],
    bits: [u64; 4],
    /// Where each stream starts.
    iend: [usize; 4],
}

/// `HUF_initFastDStream`: the lowest set bit marks how much of the 64 bits is consumed.
#[inline]
fn init_fast_dstream(src: &[u8], ip: usize) -> Result<u64> {
    let value = read_le64(src, ip)?;
    let last_byte = (value >> 56) as u32;
    let bits_consumed = if last_byte != 0 {
        8 - highbit32(last_byte)
    } else {
        0
    };
    Ok((value | 1) << bits_consumed)
}

impl FastArgs {
    /// `HUF_DecompressFastArgs_init`. `None` if the input has to be decoded by the other loops.
    fn new(dst_size: usize, src: &[u8], table_log: u32) -> Result<Option<Self>> {
        if dst_size == 0 {
            return Ok(None);
        }
        if src.len() < 10 {
            return Err(Error::CorruptionDetected);
        }
        if table_log != HUF_DECODER_FAST_TABLELOG {
            return Ok(None);
        }
        let streams = Streams::new(src)?;
        if streams.length.iter().any(|&length| length < 8) {
            return Ok(None);
        }
        let [_, _, _, length4] = streams.length;
        if length4 > src.len() {
            return Err(Error::CorruptionDetected);
        }
        let [_, start2, start3, start4] = streams.start;
        let ip = [start2 - 8, start3 - 8, start4 - 8, src.len() - 8];
        let segment = dst_size.div_ceil(4);
        let op = [0, segment, 2 * segment, 3 * segment];
        if 3 * segment >= dst_size {
            return Ok(None);
        }
        let [ip0, ip1, ip2, ip3] = ip;
        Ok(Some(Self {
            ip,
            op,
            bits: [
                init_fast_dstream(src, ip0)?,
                init_fast_dstream(src, ip1)?,
                init_fast_dstream(src, ip2)?,
                init_fast_dstream(src, ip3)?,
            ],
            iend: streams.start,
        }))
    }

    /// `HUF_initRemainingDStream`
    fn remaining_dstream<'a>(
        &self,
        src: &'a [u8],
        stream: usize,
        segment_end: usize,
    ) -> Result<BitDStream<'a>> {
        if self.op.at(stream)? > segment_end {
            return Err(Error::CorruptionDetected);
        }
        let ip = self.ip.at(stream)?;
        if ip + 8 < self.iend.at(stream)? {
            return Err(Error::CorruptionDetected);
        }
        BitDStream::resume(src, ip, self.bits.at(stream)?.trailing_zeros())
    }

    /// How many rounds of at most 7 bytes the first stream has input for. The others start above it.
    #[inline]
    fn input_rounds(&self) -> usize {
        let [ip0, ..] = self.ip;
        ip0 / 7
    }

    #[inline]
    fn streams_are_ordered(&self) -> bool {
        self.ip.is_sorted()
    }
}

/// What both fast loops do to a stream after a round.
#[inline(always)]
fn reload_fast(src: &[u8], ip: &mut usize, bits: &mut u64) -> Result<()> {
    let ctz = bits.trailing_zeros();
    let nb_bits = ctz & 7;
    let nb_bytes = (ctz >> 3) as usize;
    *ip = ip.wrapping_sub(nb_bytes);
    *bits = (read_le64(src, *ip)? | 1) << nb_bits;
    Ok(())
}

/// Three parts of `segment_size` bytes, and the rest.
fn split_in_4(dst: &mut [u8], segment_size: usize) -> Result<[&mut [u8]; 4]> {
    let (part0, rest) = dst.split_at_mut_checked(segment_size).ok_or(BUG)?;
    let (part1, rest) = rest.split_at_mut_checked(segment_size).ok_or(BUG)?;
    let (part2, part3) = rest.split_at_mut_checked(segment_size).ok_or(BUG)?;
    Ok([part0, part1, part2, part3])
}

/// The end of each of the four parts of an output of `dst_size` bytes.
fn segment_ends(dst_size: usize) -> [usize; 4] {
    let segment = dst_size.div_ceil(4);
    [1, 2, 3, 4].map(|n| (n * segment).min(dst_size))
}

// ── X1 ────────────────────────────────────────────────────────────────────

/// `HUF_rescaleStats`
fn rescale_stats(
    huff_weight: &mut [u8],
    rank_val: &mut [u32; NB_RANKS],
    table_log: u32,
    target_table_log: u32,
) -> Result<u32> {
    if table_log > target_table_log {
        return Ok(table_log);
    }
    if table_log < target_table_log {
        let scale = (target_table_log - table_log) as usize;
        for weight in huff_weight {
            if *weight != 0 {
                *weight += scale as u8;
            }
        }
        let target = target_table_log as usize;
        rank_val.move_within(1, scale + 1, target - scale)?;
        rank_val.span_mut(1, scale)?.fill(0);
    }
    Ok(target_table_log)
}

/// `HUF_readDTableX1_wksp`, once the description of the table is read.
fn build_dtable_x1(dtable: &mut ExactTable<u16>, stats: &Code) -> Result<()> {
    let mut rank_val = stats.rank_stats;
    let mut rank_start = [0u32; NB_RANKS];
    let mut symbols = [0u8; NB_SYMBOLS];
    let mut huff_weight = stats.weights;
    let weights = huff_weight.sub_mut(..stats.nb_symbols as usize)?;

    // An X1 table takes half the room of an X2 table, so its log may be one more than the capacity.
    let max_table_log = HUF_TABLELOG_MAX + 1;
    let target_table_log = max_table_log.min(HUF_DECODER_FAST_TABLELOG);
    let table_log = rescale_stats(weights, &mut rank_val, stats.table_log, target_table_log)?;
    if table_log > max_table_log {
        return Err(Error::TableLogTooLarge);
    }
    dtable.table_log = table_log;

    // Sort the symbols by weight.
    let mut next_rank_start = 0u32;
    for (start, &count) in rank_start
        .iter_mut()
        .zip(&rank_val)
        .take(table_log as usize + 1)
    {
        *start = next_rank_start;
        next_rank_start += count;
    }
    for (symbol, &weight) in weights.iter().enumerate() {
        let start = rank_start.at_mut(usize::from(weight))?;
        symbols.put(*start as usize, symbol as u8)?;
        *start += 1;
    }

    let [rank0, ..] = rank_val;
    let mut symbol = rank0 as usize;
    let mut u_start = 0usize;
    for w in 1..=table_log {
        let symbol_count = rank_val.at(w as usize)? as usize;
        let length = (1usize << w) >> 1;
        let nb_bits = (table_log + 1 - w) as u16;
        for &byte in symbols.span(symbol, symbol_count)? {
            dtable
                .entries
                .span_mut(u_start, length)?
                .fill((u16::from(byte) << 8) | nb_bits);
            u_start += length;
        }
        symbol += symbol_count;
    }
    Ok(())
}

/// `HUF_decodeSymbolX1`
#[inline(always)]
fn decode_symbol_x1(bit_d: &mut BitDStream<'_>, dt: &[u16; TABLE_SIZE], dt_log: u32) -> u8 {
    let entry = entry_x1(dt, bit_d.look_bits_fast(dt_log));
    bit_d.skip_bits(u32::from(entry & 0xFF));
    (entry >> 8) as u8
}

/// `HUF_decodeStreamX1`: fills `out`.
#[inline]
fn decode_stream_x1(
    out: &mut [u8],
    bit_d: &mut BitDStream<'_>,
    dt: &[u16; TABLE_SIZE],
    dt_log: u32,
) {
    let end = out.len();
    let mut p = 0usize;
    if end > 3 {
        while (bit_d.reload() == DStreamStatus::Unfinished) & (p + 3 < end) {
            if let Ok(four) = out.array_at_mut::<4>(p) {
                for byte in four {
                    *byte = decode_symbol_x1(bit_d, dt, dt_log);
                }
            }
            p += 4;
        }
    } else {
        bit_d.reload();
    }
    for byte in out.get_mut(p..).unwrap_or_default() {
        *byte = decode_symbol_x1(bit_d, dt, dt_log);
    }
}

/// `HUF_decompress1X1_usingDTable_internal_body`
fn decompress_1x1_using_dtable(
    dst: &mut [u8],
    src: &[u8],
    dtable: &ExactTable<u16>,
) -> Result<usize> {
    let mut bit_d = BitDStream::new(src)?;
    decode_stream_x1(dst, &mut bit_d, &dtable.entries, dtable.table_log);
    if !bit_d.is_at_end() {
        return Err(Error::CorruptionDetected);
    }
    Ok(dst.len())
}

/// `HUF_decompress4X1_usingDTable_internal_body`
fn decompress_4x1_body(dst: &mut [u8], src: &[u8], dtable: &ExactTable<u16>) -> Result<usize> {
    if src.len() < 10 {
        return Err(Error::CorruptionDetected);
    }
    if dst.len() < 6 {
        return Err(Error::CorruptionDetected);
    }
    let dst_size = dst.len();
    let dt = &dtable.entries;
    let dt_log = dtable.table_log;
    let streams = Streams::new(src)?;
    let [_, _, _, length4] = streams.length;
    if length4 > src.len() {
        return Err(Error::CorruptionDetected);
    }
    let segment_size = dst_size.div_ceil(4);
    if 3 * segment_size > dst_size {
        return Err(Error::CorruptionDetected);
    }
    let [mut bit_d1, mut bit_d2, mut bit_d3, mut bit_d4] = streams.open(src)?;

    let [out1, out2, out3, out4] = split_in_4(dst, segment_size)?;
    // The four streams advance together, by `done`, and the last part is the shortest.
    let mut done = 0usize;
    if out4.len() >= 8 {
        let mut end_signal = true;
        while end_signal & (done + 3 < out4.len()) {
            let four1 = out1.array_at_mut::<4>(done)?;
            let four2 = out2.array_at_mut::<4>(done)?;
            let four3 = out3.array_at_mut::<4>(done)?;
            let four4 = out4.array_at_mut::<4>(done)?;
            for (((byte1, byte2), byte3), byte4) in
                four1.iter_mut().zip(four2).zip(four3).zip(four4)
            {
                *byte1 = decode_symbol_x1(&mut bit_d1, dt, dt_log);
                *byte2 = decode_symbol_x1(&mut bit_d2, dt, dt_log);
                *byte3 = decode_symbol_x1(&mut bit_d3, dt, dt_log);
                *byte4 = decode_symbol_x1(&mut bit_d4, dt, dt_log);
            }
            done += 4;
            end_signal &= bit_d1.reload_fast() == DStreamStatus::Unfinished;
            end_signal &= bit_d2.reload_fast() == DStreamStatus::Unfinished;
            end_signal &= bit_d3.reload_fast() == DStreamStatus::Unfinished;
            end_signal &= bit_d4.reload_fast() == DStreamStatus::Unfinished;
        }
    }

    decode_stream_x1(out1.sub_mut(done..)?, &mut bit_d1, dt, dt_log);
    decode_stream_x1(out2.sub_mut(done..)?, &mut bit_d2, dt, dt_log);
    decode_stream_x1(out3.sub_mut(done..)?, &mut bit_d3, dt, dt_log);
    decode_stream_x1(out4.sub_mut(done..)?, &mut bit_d4, dt, dt_log);

    if !(bit_d1.is_at_end() & bit_d2.is_at_end() & bit_d3.is_at_end() & bit_d4.is_at_end()) {
        return Err(Error::CorruptionDetected);
    }
    Ok(dst_size)
}

/// `HUF_decompress4X1_usingDTable_internal_fast_c_loop`
fn fast_loop_4x1(
    args: &mut FastArgs,
    dst: &mut [u8],
    src: &[u8],
    dt: &[u16; TABLE_SIZE],
) -> Result<()> {
    let [_, segment_size, ..] = args.op;
    let [part0, part1, part2, part3] = split_in_4(dst, segment_size)?;
    // How much of each part is written. It is the same for all of them.
    let mut done = 0usize;

    let [mut ip0, mut ip1, mut ip2, mut ip3] = args.ip;
    let [mut bits0, mut bits1, mut bits2, mut bits3] = args.bits;

    #[inline(always)]
    fn decode(bits: &mut u64, dt: &[u16; TABLE_SIZE]) -> u8 {
        let entry = entry_x1(dt, *bits >> 53);
        *bits <<= entry & 0x3F;
        (entry >> 8) as u8
    }

    loop {
        // Each round writes 5 bytes to each part, of which the last is the shortest, and reads at most 7 of each stream.
        let rounds = ((part3.len() - done) / 5).min(ip0 / 7);
        if rounds == 0 {
            break;
        }
        if !(ip0 <= ip1 && ip1 <= ip2 && ip2 <= ip3) {
            break;
        }
        let (out0, _) = part0.span_mut(done, rounds * 5)?.as_chunks_mut::<5>();
        let (out1, _) = part1.span_mut(done, rounds * 5)?.as_chunks_mut::<5>();
        let (out2, _) = part2.span_mut(done, rounds * 5)?.as_chunks_mut::<5>();
        let (out3, _) = part3.span_mut(done, rounds * 5)?.as_chunks_mut::<5>();
        for (((out0, out1), out2), out3) in out0.iter_mut().zip(out1).zip(out2).zip(out3) {
            for (((byte0, byte1), byte2), byte3) in out0.iter_mut().zip(out1).zip(out2).zip(out3) {
                *byte0 = decode(&mut bits0, dt);
                *byte1 = decode(&mut bits1, dt);
                *byte2 = decode(&mut bits2, dt);
                *byte3 = decode(&mut bits3, dt);
            }
            reload_fast(src, &mut ip0, &mut bits0)?;
            reload_fast(src, &mut ip1, &mut bits1)?;
            reload_fast(src, &mut ip2, &mut bits2)?;
            reload_fast(src, &mut ip3, &mut bits3)?;
        }
        done += rounds * 5;
    }

    args.ip = [ip0, ip1, ip2, ip3];
    args.bits = [bits0, bits1, bits2, bits3];
    args.op = args.op.map(|start| start + done);
    Ok(())
}

/// `HUF_decompress4X1_usingDTable_internal_fast`. `None` if the input has to be decoded by the other loop.
fn decompress_4x1_fast(
    dst: &mut [u8],
    src: &[u8],
    dtable: &ExactTable<u16>,
) -> Result<Option<usize>> {
    let Some(mut args) = FastArgs::new(dst.len(), src, dtable.table_log)? else {
        return Ok(None);
    };
    fast_loop_4x1(&mut args, dst, src, &dtable.entries)?;

    for (stream, segment_end) in segment_ends(dst.len()).into_iter().enumerate() {
        let mut bit_d = args.remaining_dstream(src, stream, segment_end)?;
        let out = dst.sub_mut(args.op.at(stream)?..segment_end)?;
        decode_stream_x1(out, &mut bit_d, &dtable.entries, HUF_DECODER_FAST_TABLELOG);
    }
    Ok(Some(dst.len()))
}

/// `HUF_decompress4X1_usingDTable_internal`
fn decompress_4x1_using_dtable(
    dst: &mut [u8],
    src: &[u8],
    dtable: &ExactTable<u16>,
) -> Result<usize> {
    if let Some(size) = decompress_4x1_fast(dst, src, dtable)? {
        return Ok(size);
    }
    decompress_4x1_body(dst, src, dtable)
}

// ── X2 ────────────────────────────────────────────────────────────────────

type RankValCol = [u32; NB_RANKS];

/// `HUF_buildDEltX2U32`
#[inline(always)]
fn build_delt_x2(symbol: u32, nb_bits: u32, base_seq: u32, level: u32) -> u32 {
    let seq = if level == 1 {
        symbol
    } else {
        base_seq + (symbol << 8)
    };
    seq + (nb_bits << 16) + (level << 24)
}

/// `HUF_fillDTableX2ForWeight`
fn fill_dtable_x2_for_weight(
    dtable_rank: &mut [u32],
    symbols: &[u8],
    nb_bits: u32,
    table_log: u32,
    base_seq: u32,
    level: u32,
) -> Result<()> {
    let length = 1usize << (table_log.wrapping_sub(nb_bits) & 0x1F);
    let entries = dtable_rank.sub_mut(..length * symbols.len())?;
    for (entries, &symbol) in entries.chunks_exact_mut(length).zip(symbols) {
        entries.fill(build_delt_x2(u32::from(symbol), nb_bits, base_seq, level));
    }
    Ok(())
}

/// `HUF_fillDTableX2Level2`
fn fill_dtable_x2_level2(
    dtable: &mut [u32],
    target_log: u32,
    consumed_bits: u32,
    rank_val: &RankValCol,
    min_weight: usize,
    max_weight1: usize,
    sorted_symbols: &[u8; NB_SYMBOLS],
    rank_start: &[u32; NB_RANKS + 2],
    nb_bits_baseline: u32,
    base_seq: u32,
) -> Result<()> {
    // The codes that are too long for a second symbol to fit hold the first symbol alone.
    if min_weight > 1 {
        let length = 1usize << (target_log.wrapping_sub(consumed_bits) & 0x1F);
        let skip_size = rank_val.at(min_weight)? as usize;
        let filled = match length {
            2 | 4 => length,
            _ => skip_size.next_multiple_of(8),
        };
        let first_symbol = base_seq;
        dtable
            .sub_mut(..filled)?
            .fill(build_delt_x2(first_symbol, consumed_bits, 0, 1));
    }

    for w in min_weight..max_weight1 {
        let begin = rank_start.at(w)? as usize;
        let end = rank_start.at(w + 1)? as usize;
        let nb_bits = nb_bits_baseline - w as u32;
        let total_bits = nb_bits + consumed_bits;
        fill_dtable_x2_for_weight(
            dtable.sub_mut(rank_val.at(w)? as usize..)?,
            sorted_symbols.sub(begin..end)?,
            total_bits,
            target_log,
            base_seq,
            2,
        )?;
    }
    Ok(())
}

/// `HUF_fillDTableX2`
fn fill_dtable_x2(
    dtable: &mut [u32; TABLE_SIZE],
    target_log: u32,
    sorted_list: &[u8; NB_SYMBOLS],
    rank_start: &[u32; NB_RANKS + 2],
    rank_val_origin: &[RankValCol; HUF_TABLELOG_MAX as usize],
    max_weight: u32,
    nb_bits_baseline: u32,
) -> Result<()> {
    let [rank_val, ..] = rank_val_origin;
    let scale_log = nb_bits_baseline as i32 - target_log as i32;
    let min_bits = nb_bits_baseline - max_weight;
    let w_end = max_weight as usize + 1;

    for w in 1..w_end {
        let begin = rank_start.at(w)? as usize;
        let end = rank_start.at(w + 1)? as usize;
        let nb_bits = nb_bits_baseline - w as u32;

        if target_log.wrapping_sub(nb_bits) >= min_bits {
            // Enough room for a second symbol.
            let mut start = rank_val.at(w)? as usize;
            let length = 1usize << (target_log.wrapping_sub(nb_bits) & 0x1F);
            let min_weight = (nb_bits as i32 + scale_log).max(1) as usize;
            for &symbol in sorted_list.sub(begin..end)? {
                fill_dtable_x2_level2(
                    dtable.sub_mut(start..)?,
                    target_log,
                    nb_bits,
                    rank_val_origin.get(nb_bits as usize).ok_or(BUG)?,
                    min_weight,
                    w_end,
                    sorted_list,
                    rank_start,
                    nb_bits_baseline,
                    u32::from(symbol),
                )?;
                start += length;
            }
        } else {
            fill_dtable_x2_for_weight(
                dtable.sub_mut(rank_val.at(w)? as usize..)?,
                sorted_list.sub(begin..end)?,
                nb_bits,
                target_log,
                0,
                1,
            )?;
        }
    }
    Ok(())
}

/// `HUF_readDTableX2_wksp`, once the description of the table is read.
fn build_dtable_x2(dtable: &mut ExactTable<u32>, stats: &Code) -> Result<()> {
    let mut rank_val = [[0u32; NB_RANKS]; HUF_TABLELOG_MAX as usize];
    let rank_stats = stats.rank_stats;
    // `rank_start0[w + 1]` is where the symbols of weight `w` start, until sorting moves it to where they end.
    let mut rank_start0 = [0u32; NB_RANKS + 2];
    let mut sorted_symbol = [0u8; NB_SYMBOLS];
    let weight_list = stats.weights;
    let mut max_table_log = HUF_TABLELOG_MAX;
    let table_log = stats.table_log;

    if table_log > max_table_log {
        return Err(Error::TableLogTooLarge);
    }
    if table_log <= HUF_DECODER_FAST_TABLELOG && max_table_log > HUF_DECODER_FAST_TABLELOG {
        max_table_log = HUF_DECODER_FAST_TABLELOG;
    }

    let mut max_w = table_log as usize;
    while rank_stats.at(max_w)? == 0 {
        max_w = max_w.checked_sub(1).ok_or(BUG)?;
    }

    let mut next_rank_start = 0u32;
    for w in 1..=max_w {
        rank_start0.put(w + 1, next_rank_start)?;
        next_rank_start += rank_stats.at(w)?;
    }
    // The symbols of weight 0 go to the end.
    rank_start0.put(1, next_rank_start)?;
    rank_start0.put(max_w + 2, next_rank_start)?;

    for (symbol, &weight) in weight_list
        .iter()
        .enumerate()
        .take(stats.nb_symbols as usize)
    {
        let start = rank_start0.at_mut(usize::from(weight) + 1)?;
        sorted_symbol.put(*start as usize, symbol as u8)?;
        *start += 1;
    }
    rank_start0.put(1, 0)?;

    {
        let rescale = (max_table_log - table_log) as i32 - 1;
        let mut next_rank_val = 0u32;
        let [rank_val0, ..] = &mut rank_val;
        for w in 1..=max_w {
            rank_val0.put(w, next_rank_val)?;
            next_rank_val += rank_stats.at(w)? << (w as i32 + rescale);
        }
        let rank_val0 = *rank_val0;
        let min_bits = table_log + 1 - max_w as u32;
        for consumed in min_bits..(max_table_log - min_bits + 1) {
            let rank_val_col = rank_val.get_mut(consumed as usize).ok_or(BUG)?;
            for (shifted, &val) in rank_val_col.iter_mut().zip(&rank_val0).skip(1).take(max_w) {
                *shifted = val >> consumed;
            }
        }
    }

    fill_dtable_x2(
        &mut dtable.entries,
        max_table_log,
        &sorted_symbol,
        &rank_start0,
        &rank_val,
        max_w as u32,
        table_log + 1,
    )?;

    dtable.table_log = max_table_log;
    Ok(())
}

/// `HUF_decodeSymbolX2`: writes two bytes at `pos` and returns how many of them count.
#[inline(always)]
fn decode_symbol_x2(
    out: &mut [u8],
    pos: usize,
    bit_d: &mut BitDStream<'_>,
    dt: &[u32; TABLE_SIZE],
    dt_log: u32,
) -> Result<usize> {
    let entry = entry_x2(dt, bit_d.look_bits_fast(dt_log));
    *out.array_at_mut(pos)? = (entry as u16).to_le_bytes();
    bit_d.skip_bits((entry >> 16) & 0xFF);
    Ok((entry >> 24) as usize)
}

/// `HUF_decodeLastSymbolX2`
#[inline(always)]
fn decode_last_symbol_x2(
    out: &mut [u8],
    pos: usize,
    bit_d: &mut BitDStream<'_>,
    dt: &[u32; TABLE_SIZE],
    dt_log: u32,
) -> Result<()> {
    let entry = entry_x2(dt, bit_d.look_bits_fast(dt_log));
    out.put(pos, entry as u8)?;
    let nb_bits = (entry >> 16) & 0xFF;
    if entry >> 24 == 1 {
        bit_d.skip_bits(nb_bits);
    } else if bit_d.bits_consumed < u64::BITS {
        bit_d.skip_bits(nb_bits);
        // The code of the second symbol, which is not wanted, may be cut off.
        if bit_d.bits_consumed > u64::BITS {
            bit_d.bits_consumed = u64::BITS;
        }
    }
    Ok(())
}

/// `HUF_decodeStreamX2`: fills `out` and returns its length.
#[inline]
fn decode_stream_x2(
    out: &mut [u8],
    bit_d: &mut BitDStream<'_>,
    dt: &[u32; TABLE_SIZE],
    dt_log: u32,
) -> Result<usize> {
    let end = out.len();
    let mut p = 0usize;

    if end >= 8 {
        if dt_log <= 11 {
            while (bit_d.reload() == DStreamStatus::Unfinished) & (p + 9 < end) {
                for _ in 0..5 {
                    p += decode_symbol_x2(out, p, bit_d, dt, dt_log)?;
                }
            }
        } else {
            while (bit_d.reload() == DStreamStatus::Unfinished) & (p + 7 < end) {
                for _ in 0..4 {
                    p += decode_symbol_x2(out, p, bit_d, dt, dt_log)?;
                }
            }
        }
    } else {
        bit_d.reload();
    }

    if end - p >= 2 {
        while (bit_d.reload() == DStreamStatus::Unfinished) & (p + 2 <= end) {
            p += decode_symbol_x2(out, p, bit_d, dt, dt_log)?;
        }
        while p + 2 <= end {
            p += decode_symbol_x2(out, p, bit_d, dt, dt_log)?;
        }
    }

    if p < end {
        decode_last_symbol_x2(out, p, bit_d, dt, dt_log)?;
        p += 1;
    }
    Ok(p)
}

/// `HUF_decompress1X2_usingDTable_internal_body`
fn decompress_1x2_using_dtable(
    dst: &mut [u8],
    src: &[u8],
    dtable: &ExactTable<u32>,
) -> Result<usize> {
    let mut bit_d = BitDStream::new(src)?;
    decode_stream_x2(dst, &mut bit_d, &dtable.entries, dtable.table_log)?;
    if !bit_d.is_at_end() {
        return Err(Error::CorruptionDetected);
    }
    Ok(dst.len())
}

/// `HUF_decompress4X2_usingDTable_internal_body`
fn decompress_4x2_body(dst: &mut [u8], src: &[u8], dtable: &ExactTable<u32>) -> Result<usize> {
    if src.len() < 10 {
        return Err(Error::CorruptionDetected);
    }
    if dst.len() < 6 {
        return Err(Error::CorruptionDetected);
    }
    let oend = dst.len();
    let dt = &dtable.entries;
    let dt_log = dtable.table_log;
    let streams = Streams::new(src)?;
    let [_, _, _, length4] = streams.length;
    if length4 > src.len() {
        return Err(Error::CorruptionDetected);
    }
    let segment_size = oend.div_ceil(4);
    let op_start2 = segment_size;
    let op_start3 = 2 * segment_size;
    let op_start4 = 3 * segment_size;
    if op_start4 > oend {
        return Err(Error::CorruptionDetected);
    }
    let [mut bit_d1, mut bit_d2, mut bit_d3, mut bit_d4] = streams.open(src)?;
    let (mut op1, mut op2, mut op3, mut op4) = (0, op_start2, op_start3, op_start4);

    // A damaged stream can run over the start of the next part, so the parts are not split here.
    if oend - op4 >= 8 {
        let mut end_signal = true;
        while end_signal & (op4 + 7 < oend) {
            for _ in 0..4 {
                op1 += decode_symbol_x2(dst, op1, &mut bit_d1, dt, dt_log)?;
            }
            for _ in 0..4 {
                op2 += decode_symbol_x2(dst, op2, &mut bit_d2, dt, dt_log)?;
            }
            end_signal &= bit_d1.reload_fast() == DStreamStatus::Unfinished;
            end_signal &= bit_d2.reload_fast() == DStreamStatus::Unfinished;
            for _ in 0..4 {
                op3 += decode_symbol_x2(dst, op3, &mut bit_d3, dt, dt_log)?;
            }
            for _ in 0..4 {
                op4 += decode_symbol_x2(dst, op4, &mut bit_d4, dt, dt_log)?;
            }
            end_signal &= bit_d3.reload_fast() == DStreamStatus::Unfinished;
            end_signal &= bit_d4.reload_fast() == DStreamStatus::Unfinished;
        }
    }

    if op1 > op_start2 || op2 > op_start3 || op3 > op_start4 {
        return Err(Error::CorruptionDetected);
    }

    decode_stream_x2(dst.sub_mut(op1..op_start2)?, &mut bit_d1, dt, dt_log)?;
    decode_stream_x2(dst.sub_mut(op2..op_start3)?, &mut bit_d2, dt, dt_log)?;
    decode_stream_x2(dst.sub_mut(op3..op_start4)?, &mut bit_d3, dt, dt_log)?;
    decode_stream_x2(dst.sub_mut(op4..oend)?, &mut bit_d4, dt, dt_log)?;

    if !(bit_d1.is_at_end() & bit_d2.is_at_end() & bit_d3.is_at_end() & bit_d4.is_at_end()) {
        return Err(Error::CorruptionDetected);
    }
    Ok(oend)
}

/// `HUF_decompress4X2_usingDTable_internal_fast_c_loop`
fn fast_loop_4x2(
    args: &mut FastArgs,
    dst: &mut [u8],
    src: &[u8],
    dt: &[u32; TABLE_SIZE],
) -> Result<()> {
    let [_, end0, end1, end2] = args.op;
    let oend = [end0, end1, end2, dst.len()];

    #[inline(always)]
    fn decode(
        dst: &mut [u8],
        op: &mut usize,
        bits: &mut u64,
        dt: &[u32; TABLE_SIZE],
    ) -> Result<()> {
        let entry = entry_x2(dt, *bits >> 53);
        *dst.array_at_mut(*op)? = (entry as u16).to_le_bytes();
        *bits <<= (entry >> 16) & 0x3F;
        *op += (entry >> 24) as usize;
        Ok(())
    }

    loop {
        // Each round writes at most 10 bytes to each part and reads at most 7 of each stream.
        let mut rounds = args.input_rounds();
        for (&end, &op) in oend.iter().zip(&args.op) {
            rounds = rounds.min((end - op) / 10);
        }
        if rounds == 0 {
            break;
        }
        if !args.streams_are_ordered() {
            break;
        }
        let [mut op0, mut op1, mut op2, mut op3] = args.op;
        let [mut ip0, mut ip1, mut ip2, mut ip3] = args.ip;
        let [mut bits0, mut bits1, mut bits2, mut bits3] = args.bits;
        let olimit = op3 + rounds * 5;
        loop {
            for _ in 0..5 {
                decode(dst, &mut op0, &mut bits0, dt)?;
                decode(dst, &mut op1, &mut bits1, dt)?;
                decode(dst, &mut op2, &mut bits2, dt)?;
                decode(dst, &mut op3, &mut bits3, dt)?;
            }
            reload_fast(src, &mut ip0, &mut bits0)?;
            reload_fast(src, &mut ip1, &mut bits1)?;
            reload_fast(src, &mut ip2, &mut bits2)?;
            reload_fast(src, &mut ip3, &mut bits3)?;
            if op3 >= olimit {
                break;
            }
        }
        args.op = [op0, op1, op2, op3];
        args.ip = [ip0, ip1, ip2, ip3];
        args.bits = [bits0, bits1, bits2, bits3];
    }
    Ok(())
}

/// `HUF_decompress4X2_usingDTable_internal_fast`. `None` if the input has to be decoded by the other loop.
fn decompress_4x2_fast(
    dst: &mut [u8],
    src: &[u8],
    dtable: &ExactTable<u32>,
) -> Result<Option<usize>> {
    let Some(mut args) = FastArgs::new(dst.len(), src, dtable.table_log)? else {
        return Ok(None);
    };
    fast_loop_4x2(&mut args, dst, src, &dtable.entries)?;

    for (stream, segment_end) in segment_ends(dst.len()).into_iter().enumerate() {
        let mut bit_d = args.remaining_dstream(src, stream, segment_end)?;
        let out = dst.sub_mut(args.op.at(stream)?..segment_end)?;
        decode_stream_x2(out, &mut bit_d, &dtable.entries, HUF_DECODER_FAST_TABLELOG)?;
    }
    Ok(Some(dst.len()))
}

/// `HUF_decompress4X2_usingDTable_internal`
fn decompress_4x2_using_dtable(
    dst: &mut [u8],
    src: &[u8],
    dtable: &ExactTable<u32>,
) -> Result<usize> {
    if let Some(size) = decompress_4x2_fast(dst, src, dtable)? {
        return Ok(size);
    }
    decompress_4x2_body(dst, src, dtable)
}

// ── choosing between X1 and X2 ────────────────────────────────────────────

/// `algoTime`: for each sixteenth of compression ratio, the time to build a table and to decode 256 bytes, for X1 and X2.
#[rustfmt::skip]
const ALGO_TIME: [[(u32, u32); 2]; 16] = [
    [(   0,   0), (   1,   1)],
    [(   0,   0), (   1,   1)],
    [( 150, 216), ( 381, 119)],
    [( 170, 205), ( 514, 112)],
    [( 177, 199), ( 539, 110)],
    [( 197, 194), ( 644, 107)],
    [( 221, 192), ( 735, 107)],
    [( 256, 189), ( 881, 106)],
    [( 359, 188), (1167, 109)],
    [( 582, 187), (1570, 114)],
    [( 688, 187), (1712, 122)],
    [( 825, 186), (1965, 136)],
    [( 976, 185), (2131, 150)],
    [(1180, 186), (2070, 175)],
    [(1377, 185), (1731, 202)],
    [(1412, 185), (1695, 202)],
];

/// `HUF_selectDecoder`: whether X2 is expected to be the faster one. `dst_size` is not 0.
pub(super) fn select_decoder_x2(dst_size: usize, src_size: usize) -> Result<bool> {
    let q = if src_size >= dst_size {
        15
    } else {
        src_size * 16 / dst_size
    };
    let d256 = (dst_size >> 8) as u32;
    let [(table0, decode0), (table1, decode1)] = ALGO_TIME.at(q)?;
    let dtime0 = table0 + decode0 * d256;
    let mut dtime1 = table1 + decode1 * d256;
    // A small advantage to the algorithm that uses less memory.
    dtime1 += dtime1 >> 5;
    Ok(dtime1 < dtime0)
}

/// `HUF_decompress1X_usingDTable`
#[cold]
#[inline(never)]
pub(super) fn decompress_1x(
    dst: &mut [u8],
    src: &[u8],
    code: &Code,
    table_type: TableType,
) -> Result<usize> {
    match table_type {
        TableType::X1 => {
            let mut dtable = ExactTable::new();
            build_dtable_x1(&mut dtable, code)?;
            decompress_1x1_using_dtable(dst, src, &dtable)
        }
        TableType::X2 => {
            let mut dtable = ExactTable::new();
            build_dtable_x2(&mut dtable, code)?;
            decompress_1x2_using_dtable(dst, src, &dtable)
        }
    }
}

/// `HUF_decompress4X_usingDTable`
#[cold]
#[inline(never)]
pub(super) fn decompress_4x(
    dst: &mut [u8],
    src: &[u8],
    code: &Code,
    table_type: TableType,
) -> Result<usize> {
    match table_type {
        TableType::X1 => {
            let mut dtable = ExactTable::new();
            build_dtable_x1(&mut dtable, code)?;
            decompress_4x1_using_dtable(dst, src, &dtable)
        }
        TableType::X2 => {
            let mut dtable = ExactTable::new();
            build_dtable_x2(&mut dtable, code)?;
            decompress_4x2_using_dtable(dst, src, &dtable)
        }
    }
}
