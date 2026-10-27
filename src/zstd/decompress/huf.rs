//! Huffman decoding of literals.
//!
//! Streams that end exactly where they should decode to the same thing whichever way it is done, so that is done in
//! the way that is fastest here. The others are left to [`huf_exact`](super::huf_exact).

use super::huf_exact::{self, TableType, select_decoder_x2};
use crate::common::bitstream::{BitDStream, DStreamStatus};
use crate::common::entropy::huf_read_stats;
use crate::common::{HUF_SYMBOLVALUE_MAX, HUF_TABLELOG_MAX};
use crate::error::{ErrorCode, Result};
use crate::util::{BUG, SliceExt, read_le16};

const NB_SYMBOLS: usize = HUF_SYMBOLVALUE_MAX as usize + 1;
const NB_RANKS: usize = HUF_TABLELOG_MAX as usize + 1;
const TABLE_SIZE: usize = 1 << HUF_TABLELOG_MAX;

/// The description of a Huffman code.
#[derive(Clone)]
pub(super) struct Code {
    /// A symbol of weight `w` has a code of `table_log + 1 - w` bits, or none if that is 0.
    pub(super) weights: [u8; NB_SYMBOLS],
    /// How many symbols have each weight.
    pub(super) rank_stats: [u32; NB_RANKS],
    pub(super) nb_symbols: u32,
    pub(super) table_log: u32,
}

/// The loop that decodes four streams at once takes a table of this log, or one more.
const FAST_LOG: u32 = 11;
/// From how many literals on that loop makes up for the time that it takes to fill such a table.
const FAST_MIN_LITERALS: usize = 768;
/// From how many literals on the larger table is considered.
const LARGE_MIN_LITERALS: usize = 1 << 14;

impl Code {
    /// How many symbols a lookup of `log` bits yields, in 65536ths, if symbols are as frequent as their codes are short.
    fn symbols_per_lookup(&self, log: u32) -> u64 {
        let table_log = self.table_log as usize;
        // For each number of bits, out of `1 << table_log`, how many symbols have a code no longer than that.
        let mut one = [0u64; NB_RANKS + 1];
        let mut share = [0u64; NB_RANKS + 1];
        let mut total = 0;
        for nb_bits in 1..=log as usize {
            let weight = (table_log + 1).wrapping_sub(nb_bits);
            let count = self.rank_stats.get(weight).copied().unwrap_or(0);
            let of_these = if weight == 0 {
                0
            } else {
                u64::from(count) << (weight - 1)
            };
            total += of_these;
            if let (Some(share), Some(one)) = (share.get_mut(nb_bits), one.get_mut(nb_bits)) {
                *share = of_these;
                *one = total;
            }
        }
        // The same for two symbols and for three, out of that squared and cubed.
        let after = |fits: &[u64; NB_RANKS + 1], room: usize| -> u64 {
            (1..room)
                .map(|nb_bits| {
                    share.get(nb_bits).copied().unwrap_or(0)
                        * fits.get(room - nb_bits).copied().unwrap_or(0)
                })
                .sum()
        };
        let mut two = [0u64; NB_RANKS + 1];
        for (room, two) in two.iter_mut().enumerate() {
            *two = after(&one, room);
        }
        let three = after(&two, log as usize);
        let two = two.get(log as usize).copied().unwrap_or(0);
        (1 << 16) + ((two << 16) >> (2 * table_log)) + ((three << 16) >> (3 * table_log))
    }

    /// How many bits to look up at once to decode `nb_literals`.
    fn best_log(&self, nb_literals: usize) -> u32 {
        if nb_literals < FAST_MIN_LITERALS {
            return self.table_log;
        }
        // The larger table takes twice the time to fill, half of the cache, and a refill for 4 lookups and not 5.
        if self.table_log > FAST_LOG
            || nb_literals >= LARGE_MIN_LITERALS
                && self.symbols_per_lookup(FAST_LOG + 1) * 4 > self.symbols_per_lookup(FAST_LOG) * 5
        {
            return FAST_LOG + 1;
        }
        FAST_LOG
    }
}

/// What a lookup yields: up to 3 symbols, then a byte with how many bits they take in its low 6 bits and how many they
/// are above.
type Entry = [u8; 4];

const COUNT_SHIFT: u32 = 6;

/// As a number, what a symbol adds to an entry that has `index` symbols.
const fn entry(symbol: u8, index: u32, nb_bits: u32) -> u32 {
    ((symbol as u32) << (8 * index)) | ((nb_bits + (1 << COUNT_SHIFT)) << 24)
}

/// `HUF_DTable`
#[derive(Clone)]
pub(crate) struct HufDTable {
    code: Code,
    /// The kind of table that the C code has.
    table_type: TableType,
    /// How many bits `table` is indexed with.
    log: u32,
    table: [Entry; TABLE_SIZE],
}

impl HufDTable {
    pub(crate) const fn new() -> Self {
        Self {
            code: Code {
                weights: [0; NB_SYMBOLS],
                rank_stats: [0; NB_RANKS],
                nb_symbols: 0,
                table_log: 0,
            },
            table_type: TableType::X1,
            log: 0,
            table: [[0; 4]; TABLE_SIZE],
        }
    }

    /// Reads the description of a table at the start of `src`, and returns its size. The table is to decode
    /// `nb_literals` with.
    fn read(&mut self, src: &[u8], table_type: TableType, nb_literals: usize) -> Result<usize> {
        let stats = huf_read_stats(&mut self.code.weights, &mut self.code.rank_stats, src)?;
        self.code.nb_symbols = stats.nb_symbols;
        self.code.table_log = stats.table_log;
        self.table_type = table_type;
        self.build(self.code.best_log(nb_literals))?;
        Ok(stats.size)
    }

    /// Makes the table fit to decode `nb_literals` with.
    pub(crate) fn prepare(&mut self, nb_literals: usize) -> Result<()> {
        if self.log < FAST_LOG && nb_literals >= FAST_MIN_LITERALS {
            self.build(self.code.table_log.max(FAST_LOG))?;
        }
        Ok(())
    }

    /// Fills `table` for lookups of `log` bits, which is at least as many as the longest code has.
    fn build(&mut self, log: u32) -> Result<()> {
        let Code {
            weights,
            rank_stats,
            nb_symbols,
            table_log,
        } = &self.code;
        let max_weight = *table_log as usize;
        self.log = log;

        // The symbols by increasing weight, which is the order of their codes. `class_start[w]` is where those of
        // weight `w` start, and `position[w]` where their entries start in the table.
        let mut sorted = [0u8; NB_SYMBOLS];
        let mut class_start = [0usize; NB_RANKS + 1];
        let mut position = [0usize; NB_RANKS + 1];
        let mut nb_sorted = 0usize;
        let mut filled = 0usize;
        for weight in 1..=max_weight + 1 {
            class_start.put(weight, nb_sorted)?;
            position.put(weight, filled)?;
            let count = rank_stats.get(weight).copied().unwrap_or(0) as usize;
            nb_sorted += count;
            filled += count << (weight as u32 - 1 + log - table_log);
        }
        let mut cursor = class_start;
        for (symbol, &weight) in weights.iter().enumerate().take(*nb_symbols as usize) {
            if weight != 0 {
                let at = cursor.at_mut(usize::from(weight))?;
                sorted.put(*at, symbol as u8)?;
                *at += 1;
            }
        }
        let class =
            |weight: usize| sorted.sub(class_start.at(weight)?..class_start.at(weight + 1)?);
        let nb_bits = |weight: usize| table_log + 1 - weight as u32;
        // The lowest weight of a code of at most `room` bits.
        let min_weight = |room: u32| (max_weight + 1).saturating_sub(room as usize).max(1);

        // What follows a symbol in an index is an index into a smaller table of the same code, where the codes that are
        // too long for it come first. For each size, from `size` on: what a third symbol adds to an entry.
        let mut thirds = [0u32; TABLE_SIZE / 2];
        let shortest = nb_bits(max_weight);
        for room in shortest..=log.saturating_sub(2 * shortest) {
            let thirds = thirds.span_mut(1 << room, 1 << room)?;
            for weight in min_weight(room)..=max_weight {
                let run = 1usize << (room - nb_bits(weight));
                let symbols = class(weight)?;
                let thirds =
                    thirds.span_mut(position.at(weight)? >> (log - room), run * symbols.len())?;
                for (thirds, &symbol) in thirds.chunks_exact_mut(run).zip(symbols) {
                    thirds.fill(entry(symbol, 2, nb_bits(weight)));
                }
            }
        }

        for weight in 1..=max_weight {
            let Some((&first_symbol, other_symbols)) = class(weight)?.split_first() else {
                continue;
            };
            let first_bits = nb_bits(weight);
            let room = log - first_bits;
            let size = 1usize << room;
            let entries = self
                .table
                .span_mut(position.at(weight)?, size * (1 + other_symbols.len()))?;
            let (entries, other_entries) = entries.split_at_mut_checked(size).ok_or(BUG)?;

            let first = entry(first_symbol, 0, first_bits);
            entries
                .sub_mut(..position.at(min_weight(room))? >> first_bits)?
                .fill(first.to_le_bytes());
            for second_weight in min_weight(room)..=max_weight {
                let room = room - nb_bits(second_weight);
                let size = 1usize << room;
                let symbols = class(second_weight)?;
                let thirds = thirds.span(size, size)?;
                let entries = entries.span_mut(
                    position.at(second_weight)? >> first_bits,
                    size * symbols.len(),
                )?;
                for (entries, &symbol) in entries.chunks_exact_mut(size).zip(symbols) {
                    let two = first + entry(symbol, 1, nb_bits(second_weight));
                    for (entry, third) in entries.iter_mut().zip(thirds) {
                        *entry = (two + third).to_le_bytes();
                    }
                }
            }

            for (copy, &symbol) in other_entries.chunks_exact_mut(size).zip(other_symbols) {
                for (to, from) in copy.iter_mut().zip(&*entries) {
                    let [_, second, third, meta] = *from;
                    *to = [symbol, second, third, meta];
                }
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn entry(&self, index: u64) -> Entry {
        self.table
            .get(index as usize & (TABLE_SIZE - 1))
            .copied()
            .unwrap_or_default()
    }

    /// Fills `out` from a stream. Whether that takes exactly what is left of the stream.
    fn decode_stream(&self, out: &mut [u8], bit_d: &mut BitDStream<'_>) -> bool {
        let log = self.log;
        let mut rest = &mut *out;
        // Four lookups take at most 48 bits.
        while rest.len() >= 16 && bit_d.reload() == DStreamStatus::Unfinished {
            let mut done = 0usize;
            for _ in 0..4 {
                let entry = self.entry(bit_d.look_bits_fast(log));
                let [.., meta] = entry;
                bit_d.skip_bits(u32::from(meta & 63));
                if let Some(to) = rest.get_mut(done..done + 4) {
                    to.copy_from_slice(&entry);
                }
                done += usize::from(meta >> COUNT_SHIFT);
            }
            rest = rest.get_mut(done..).unwrap_or_default();
        }
        for byte in rest {
            bit_d.reload();
            let [symbol, ..] = self.entry(bit_d.look_bits_fast(log));
            let weight = self
                .code
                .weights
                .get(usize::from(symbol))
                .copied()
                .unwrap_or(0);
            bit_d.skip_bits(self.code.table_log + 1 - u32::from(weight));
            *byte = symbol;
        }
        bit_d.is_at_end()
    }

    /// One stream. Whether it is exactly `dst.len()` symbols.
    fn decode_1x(&self, dst: &mut [u8], src: &[u8]) -> bool {
        match BitDStream::new(src) {
            Ok(mut bit_d) => self.decode_stream(dst, &mut bit_d),
            Err(_) => false,
        }
    }

    /// Four streams after their sizes. Whether each is exactly its share of `dst.len()` symbols.
    fn decode_4x(&self, dst: &mut [u8], src: &[u8]) -> bool {
        let Some(parts) = Part::split(dst, src) else {
            return false;
        };
        let Some(mut streams) = Streams::new(parts) else {
            return false;
        };
        let mut no_output = [[0u8; 512]; 4];
        if self.log >= FAST_LOG {
            self.decode_most(&mut streams, &mut no_output);
        }
        let mut exact = true;
        for stream in streams.0 {
            let Ok(mut bit_d) = stream.bit_d() else {
                return false;
            };
            let out = stream.out.get_mut(stream.op as usize..).unwrap_or_default();
            exact &= self.decode_stream(out, &mut bit_d);
        }
        exact
    }

    /// Decodes each stream until it is close to its start, or its output to its end.
    fn decode_most<'a>(&self, streams: &mut Streams<'a>, no_output: &'a mut [[u8; 512]; 4]) {
        // Some streams get there before others, which go on four at a time all the same: with these.
        static NO_STREAM: [u8; 256] = [0x55; 256];
        let mut decoding = Streams(no_output.each_mut().map(|out| Stream {
            src: &NO_STREAM,
            ip: 0,
            bits: 0,
            out,
            op: 0,
        }));
        for (slot, stream) in decoding.0.iter_mut().zip(&mut streams.0) {
            core::mem::swap(slot, stream);
        }
        // `streams[i]` is in `decoding`.
        let mut left = [true; 4];
        loop {
            for ((stream, done), left) in decoding.0.iter_mut().zip(&mut streams.0).zip(&mut left) {
                if stream.has_most_left() {
                    continue;
                }
                if *left {
                    *left = false;
                    core::mem::swap(stream, done);
                }
                stream.ip = NO_STREAM.len() as u32 - 8;
                stream.bits = 1;
                stream.op = 0;
                stream.has_most_left();
            }
            if left == [false; 4] {
                break;
            }
            match self.log {
                11 => decoding.decode_most::<11, 5>(&self.table),
                _ => decoding.decode_most::<12, 4>(&self.table),
            }
        }
    }
}

/// A stream, and where its symbols go.
struct Part<'a> {
    src: &'a [u8],
    out: &'a mut [u8],
}

impl<'a> Part<'a> {
    /// `None` if the sizes at the start of `src` are not those of four streams.
    fn split(dst: &'a mut [u8], src: &'a [u8]) -> Option<[Self; 4]> {
        let (sizes, src) = src.split_first_chunk::<6>()?;
        let (src0, src) = src.split_at_checked(usize::from(read_le16(sizes, 0).ok()?))?;
        let (src1, src) = src.split_at_checked(usize::from(read_le16(sizes, 2).ok()?))?;
        let (src2, src3) = src.split_at_checked(usize::from(read_le16(sizes, 4).ok()?))?;
        let segment = dst.len().div_ceil(4);
        let (dst0, dst) = dst.split_at_mut_checked(segment)?;
        let (dst1, dst) = dst.split_at_mut_checked(segment)?;
        let (dst2, dst3) = dst.split_at_mut_checked(segment)?;
        Some(
            [(src0, dst0), (src1, dst1), (src2, dst2), (src3, dst3)]
                .map(|(src, out)| Self { src, out }),
        )
    }
}

/// What two rounds of lookups between reloads can write, as far as the compiler can tell.
const WINDOW: usize = 32;

/// Reads the 64 bits from where a stream is. Whether there are as many.
#[inline(always)]
fn reload(src: &[u8], ip: &mut u32, bits: &mut u64) -> bool {
    let consumed = bits.trailing_zeros();
    // Wraps around before the start.
    let from = ip.wrapping_sub(consumed >> 3);
    let Some(Ok(container)) = src
        .get(from as usize..from as usize + 8)
        .map(<[u8; 8]>::try_from)
    else {
        return false;
    };
    *ip = from;
    *bits = (u64::from_le_bytes(container) | 1) << (consumed & 7);
    true
}

/// A stream that is being decoded.
struct Stream<'a> {
    src: &'a [u8],
    /// Where in `src` `bits` was read.
    ip: u32,
    /// What is left to read of 64 bits, from the highest bit on, then a bit set. 0 if the stream is shorter than that:
    /// nothing is read of it yet.
    bits: u64,
    out: &'a mut [u8],
    /// How much of `out` is written.
    op: u32,
}

impl<'a> Stream<'a> {
    fn new(Part { src, out }: Part<'a>) -> Option<Self> {
        let mut stream = Self {
            src,
            ip: 0,
            bits: 0,
            out,
            op: 0,
        };
        if let Some(container) = src.last_chunk() {
            let container = u64::from_le_bytes(*container);
            // The highest bit set marks the end of the stream.
            if container >> 56 == 0 {
                return None;
            }
            stream.ip = src.len() as u32 - 8;
            stream.bits = (container | 1) << (container.leading_zeros() + 1);
        }
        Some(stream)
    }

    /// Whether the stream is far enough from its start and its output from its end for `Streams::decode_most`, for
    /// which it then is ready.
    fn has_most_left(&mut self) -> bool {
        self.bits != 0
            && self.op as usize + WINDOW <= self.out.len()
            && reload(self.src, &mut self.ip, &mut self.bits)
    }

    fn bit_d(&self) -> Result<BitDStream<'a>> {
        if self.bits == 0 {
            return BitDStream::new(self.src);
        }
        BitDStream::resume(self.src, self.ip as usize, self.bits.trailing_zeros())
    }
}

struct Streams<'a>([Stream<'a>; 4]);

impl<'a> Streams<'a> {
    fn new([part0, part1, part2, part3]: [Part<'a>; 4]) -> Option<Self> {
        Some(Self([
            Stream::new(part0)?,
            Stream::new(part1)?,
            Stream::new(part2)?,
            Stream::new(part3)?,
        ]))
    }

    /// Decodes for as long as no stream is close to its start and no output to its end. `LOOKUPS` of `LOG` bits are at
    /// most 57 bits.
    fn decode_most<const LOG: u32, const LOOKUPS: usize>(&mut self, table: &[Entry; TABLE_SIZE]) {
        #[inline(always)]
        fn lookup<const LOG: u32>(
            table: &[Entry; TABLE_SIZE],
            bits: &mut u64,
            window: &mut [u8; WINDOW],
            done: &mut usize,
        ) {
            if let Some(entry) = table.get((*bits >> (64 - LOG)) as usize) {
                let [.., meta] = *entry;
                *bits <<= meta & 63;
                if let Some(to) = window.get_mut(*done..*done + 4) {
                    to.copy_from_slice(entry);
                }
                *done += usize::from(meta >> COUNT_SHIFT);
            }
        }

        #[inline(always)]
        fn window(out: &mut [u8], op: u32) -> Option<&mut [u8; WINDOW]> {
            out.get_mut(op as usize..op as usize + WINDOW)?
                .as_mut_array()
        }

        let [s0, s1, s2, s3] = &mut self.0;
        let (mut bits0, mut bits1, mut bits2, mut bits3) = (s0.bits, s1.bits, s2.bits, s3.bits);
        let (mut ip0, mut ip1, mut ip2, mut ip3) = (s0.ip, s1.ip, s2.ip, s3.ip);
        let (mut op0, mut op1, mut op2, mut op3) = (s0.op, s1.op, s2.op, s3.op);
        loop {
            let (Some(window0), Some(window1), Some(window2), Some(window3)) = (
                window(s0.out, op0),
                window(s1.out, op1),
                window(s2.out, op2),
                window(s3.out, op3),
            ) else {
                break;
            };
            let (mut done0, mut done1, mut done2, mut done3) = (0, 0, 0, 0);
            for _ in 0..LOOKUPS {
                lookup::<LOG>(table, &mut bits0, window0, &mut done0);
                lookup::<LOG>(table, &mut bits1, window1, &mut done1);
                lookup::<LOG>(table, &mut bits2, window2, &mut done2);
                lookup::<LOG>(table, &mut bits3, window3, &mut done3);
            }
            let mut more = reload(s0.src, &mut ip0, &mut bits0)
                && reload(s1.src, &mut ip1, &mut bits1)
                && reload(s2.src, &mut ip2, &mut bits2)
                && reload(s3.src, &mut ip3, &mut bits3);
            if more {
                for _ in 0..LOOKUPS {
                    lookup::<LOG>(table, &mut bits0, window0, &mut done0);
                    lookup::<LOG>(table, &mut bits1, window1, &mut done1);
                    lookup::<LOG>(table, &mut bits2, window2, &mut done2);
                    lookup::<LOG>(table, &mut bits3, window3, &mut done3);
                }
                more = reload(s0.src, &mut ip0, &mut bits0)
                    && reload(s1.src, &mut ip1, &mut bits1)
                    && reload(s2.src, &mut ip2, &mut bits2)
                    && reload(s3.src, &mut ip3, &mut bits3);
            }
            op0 += done0 as u32;
            op1 += done1 as u32;
            op2 += done2 as u32;
            op3 += done3 as u32;
            if !more {
                break;
            }
        }
        (s0.bits, s1.bits, s2.bits, s3.bits) = (bits0, bits1, bits2, bits3);
        (s0.ip, s1.ip, s2.ip, s3.ip) = (ip0, ip1, ip2, ip3);
        (s0.op, s1.op, s2.op, s3.op) = (op0, op1, op2, op3);
    }
}

/// `HUF_readDTableX2_wksp`. Returns the size of the table's description in `src`.
pub(crate) fn read_dtable_x2(dtable: &mut HufDTable, src: &[u8]) -> Result<usize> {
    dtable.read(src, TableType::X2, usize::MAX)
}

/// `HUF_decompress1X_usingDTable`
pub(crate) fn decompress_1x_using_dtable(
    dst: &mut [u8],
    src: &[u8],
    dtable: &HufDTable,
) -> Result<usize> {
    if dtable.decode_1x(dst, src) {
        return Ok(dst.len());
    }
    huf_exact::decompress_1x(dst, src, &dtable.code, dtable.table_type)
}

/// `HUF_decompress1X1_DCtx_wksp`
pub(crate) fn decompress_1x1(dtable: &mut HufDTable, dst: &mut [u8], src: &[u8]) -> Result<usize> {
    let h_size = dtable.read(src, TableType::X1, dst.len())?;
    if h_size >= src.len() {
        return Err(ErrorCode::SrcSizeWrong);
    }
    decompress_1x_using_dtable(dst, src.sub(h_size..)?, dtable)
}

/// `HUF_decompress4X_usingDTable`
pub(crate) fn decompress_4x_using_dtable(
    dst: &mut [u8],
    src: &[u8],
    dtable: &HufDTable,
) -> Result<usize> {
    if dtable.decode_4x(dst, src) {
        return Ok(dst.len());
    }
    huf_exact::decompress_4x(dst, src, &dtable.code, dtable.table_type)
}

/// `HUF_decompress4X_hufOnly_wksp`
pub(crate) fn decompress_4x_huf_only(
    dtable: &mut HufDTable,
    dst: &mut [u8],
    src: &[u8],
) -> Result<usize> {
    if dst.is_empty() {
        return Err(ErrorCode::DstSizeTooSmall);
    }
    if src.is_empty() {
        return Err(ErrorCode::CorruptionDetected);
    }
    let table_type = if select_decoder_x2(dst.len(), src.len())? {
        TableType::X2
    } else {
        TableType::X1
    };
    let h_size = dtable.read(src, table_type, dst.len())?;
    if h_size >= src.len() {
        return Err(ErrorCode::SrcSizeWrong);
    }
    decompress_4x_using_dtable(dst, src.sub(h_size..)?, dtable)
}
