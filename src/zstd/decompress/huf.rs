//! Huffman decoding of literals.
//!
//! Streams that end exactly where they should decode to the same thing whichever way it is done, so that is done in
//! the way that is fastest here. The others are left to [`huf_exact`](super::huf_exact).

use super::huf_exact::{self, TableType, select_decoder_x2};
use crate::common::entropy::huf_read_stats_wksp;
use crate::common::fse_decompress::Spread;
use crate::common::{HUF_SYMBOLVALUE_MAX, HUF_TABLELOG_MAX};
use crate::error::{Error, Result};
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

/// No fewer bits are looked up at once.
const MIN_LOG: u32 = 8;
/// How many are if there are enough literals to make up for the time that it takes to fill the table.
const FAST_LOG: u32 = 11;
/// How many literals are enough for that.
const FAST_MIN_LITERALS: usize = 2048;
/// From how many literals on the larger table is considered.
const LARGE_MIN_LITERALS: usize = 1 << 14;
/// The longest code of a table that yields one symbol to a lookup.
const SINGLE_MAX_LOG: u32 = 11;
/// Few literals are not worth a closer look at their code: from how many bits to a literal on few lookups of at most
/// `SINGLE_SMALL_LOG` bits would yield more than one.
const SINGLE_SMALL_MIN_BITS: usize = 5;
const SINGLE_SMALL_LOG: u32 = 9;

impl Code {
    /// How many symbols a lookup of `log` bits yields, in 65536ths, if symbols are as frequent as their codes are short.
    /// Without `thirds` a third symbol does not count, which takes less time.
    fn symbols_per_lookup(&self, log: u32, thirds: bool) -> u64 {
        let table_log = self.table_log as usize;
        // For each number of bits, out of `1 << table_log`, how many symbols have a code no longer than that.
        let mut one = [0u64; NB_RANKS + 1];
        let mut share = [0u64; NB_RANKS + 1];
        let mut total = 0;
        for nb_bits in 1..=log as usize {
            let of_these = match (table_log + 1).saturating_sub(nb_bits) {
                0 => 0,
                weight => {
                    u64::from(self.rank_stats.get(weight).copied().unwrap_or(0)) << (weight - 1)
                }
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
        if !thirds {
            return (1 << 16) + ((after(&one, log as usize) << 16) >> (2 * table_log));
        }
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
            return self.table_log.max(MIN_LOG);
        }
        // The larger table takes twice the time to fill, half of the cache, and a refill for 4 lookups and not 5.
        if self.table_log > FAST_LOG
            || nb_literals >= LARGE_MIN_LITERALS
                && self.symbols_per_lookup(FAST_LOG + 1, true) * 4
                    > self.symbols_per_lookup(FAST_LOG, true) * 5
        {
            return FAST_LOG + 1;
        }
        FAST_LOG
    }

    /// How many bits to look up at once to decode `nb_literals` from four streams of `nb_bytes` in all, and whether
    /// that is sooner done one to a lookup.
    fn best_form(&self, nb_literals: usize, nb_bytes: usize) -> (u32, bool) {
        let log = self.best_log(nb_literals);
        let single = if nb_literals < FAST_MIN_LITERALS {
            log <= SINGLE_SMALL_LOG && 8 * nb_bytes >= SINGLE_SMALL_MIN_BITS * nb_literals
        } else {
            // A lookup that can yield several symbols takes a quarter more time.
            self.table_log <= SINGLE_MAX_LOG && self.symbols_per_lookup(log, false) * 4 < 5 << 16
        };
        if single {
            (self.table_log.max(MIN_LOG), true)
        } else {
            (log, false)
        }
    }
}

/// What a lookup yields. From the lowest byte on: up to 3 symbols, then how many bits they take in 6 bits and how many
/// they are above. What is after the last symbol is not always 0: see [`single_entry`].
type Entry = u32;

const COUNT_SHIFT: u32 = 6;

/// What a symbol adds to an entry that has `index` symbols.
const fn entry(symbol: u8, index: u32, nb_bits: u32) -> Entry {
    ((symbol as u32) << (8 * index)) | ((nb_bits + (1 << COUNT_SHIFT)) << 24)
}

/// An entry of one symbol that also has its highest byte and then the symbol in the middle, where there is no symbol:
/// one read yields both, the former where a shift takes its count from. `Streams::decode_most_single` reads only that.
const fn single_entry(symbol: u8, nb_bits: u32) -> Entry {
    let entry = entry(symbol, 0, nb_bits);
    entry | (entry >> 16) | ((symbol as u32) << 16)
}

/// For each of `symbols`, `1 << run_log` entries that are `base` and the symbol times `unit`.
fn fill_runs(out: &mut [Entry], symbols: &[u8], run_log: u32, base: Entry, unit: Entry) {
    #[inline(always)]
    fn runs<const RUN: usize>(out: &mut [Entry], symbols: &[u8], base: Entry, unit: Entry) {
        let (out, _) = out.as_chunks_mut::<RUN>();
        for (run, &symbol) in out.iter_mut().zip(symbols) {
            *run = [base + u32::from(symbol) * unit; RUN];
        }
    }
    match run_log {
        0 => runs::<1>(out, symbols, base, unit),
        1 => runs::<2>(out, symbols, base, unit),
        2 => runs::<4>(out, symbols, base, unit),
        3 => runs::<8>(out, symbols, base, unit),
        _ => {
            for (run, &symbol) in out.chunks_exact_mut(1 << run_log).zip(symbols) {
                run.fill(base + u32::from(symbol) * unit);
            }
        }
    }
}

/// The symbols of a code in the order of their codes, which is by increasing weight.
struct Sorted {
    symbols: [u8; NB_SYMBOLS],
    /// Where the symbols of each weight start in `symbols`.
    class_start: [usize; NB_CLASSES],
    /// Where their entries start in a table.
    position: [usize; NB_CLASSES],
    /// How many bits index that table.
    log: u32,
    table_log: u32,
    /// The weight of the shortest code.
    max_weight: usize,
}

/// More than there are weights, and a power of 2.
const NB_CLASSES: usize = 16;

impl Sorted {
    fn new(code: &Code, log: u32) -> Result<Self> {
        let mut class_start = [0usize; NB_CLASSES];
        let mut position = [0usize; NB_CLASSES];
        let mut nb_sorted = 0usize;
        let mut filled = 0usize;
        let mut max_weight = 1;
        for (weight, &count) in code.rank_stats.iter().enumerate().skip(1) {
            class_start.put(weight, nb_sorted)?;
            position.put(weight, filled)?;
            if count != 0 {
                max_weight = weight;
            }
            nb_sorted += count as usize;
            filled += ((count as usize) << (weight - 1)) << (log - code.table_log);
        }
        class_start.sub_mut(NB_RANKS..)?.fill(nb_sorted);
        position.sub_mut(NB_RANKS..)?.fill(filled);

        // The symbols that have no code go after the others.
        let mut symbols = [0u8; NB_SYMBOLS];
        let mut cursor = class_start;
        cursor.put(0, nb_sorted)?;
        let mut place = |symbol: usize, weight: u8| {
            if let Some(at) = cursor.get_mut(usize::from(weight) % NB_CLASSES) {
                if let Some(slot) = symbols.get_mut(*at) {
                    *slot = symbol as u8;
                }
                *at += 1;
            }
        };
        let (eights, others) = code
            .weights
            .sub(..code.nb_symbols as usize)?
            .as_chunks::<8>();
        for (index, eight) in eights.iter().enumerate() {
            if *eight != [0; 8] {
                for (offset, &weight) in eight.iter().enumerate() {
                    place(8 * index + offset, weight);
                }
            }
        }
        for (offset, &weight) in others.iter().enumerate() {
            place(8 * eights.len() + offset, weight);
        }
        Ok(Self {
            symbols,
            class_start,
            position,
            log,
            table_log: code.table_log,
            max_weight,
        })
    }

    fn class(&self, weight: usize) -> Result<&[u8]> {
        self.symbols
            .sub(self.class_start.at(weight)?..self.class_start.at(weight + 1)?)
    }

    fn nb_bits(&self, weight: usize) -> u32 {
        self.table_log + 1 - weight as u32
    }

    fn shortest(&self) -> u32 {
        self.nb_bits(self.max_weight)
    }

    /// The lowest weight of a code of at most `room` bits.
    fn min_weight(&self, room: u32) -> usize {
        (self.table_log as usize + 1)
            .saturating_sub(room as usize)
            .max(1)
    }

    /// Where the entries of the symbols of a weight start in a table that `room` bits index.
    fn position(&self, weight: usize, room: u32) -> Result<usize> {
        Ok(self.position.at(weight)? >> (self.log - room))
    }

    /// Fills a table that `room` bits index: each entry is `base`, which has `index` symbols, and the symbol that the
    /// bits start with if they hold all of its code. `next` is what the bits after that add: the table for `n` bits is
    /// there from `1 << n` on.
    fn fill(
        &self,
        out: &mut [Entry],
        room: u32,
        base: Entry,
        index: u32,
        next: Option<&[Entry]>,
    ) -> Result<()> {
        let min_weight = self.min_weight(room);
        out.sub_mut(..self.position(min_weight, room)?)?.fill(base);
        for weight in min_weight..=self.max_weight {
            let symbols = self.class(weight)?;
            let room_after = room - self.nb_bits(weight);
            let out = out.span_mut(self.position(weight, room)?, symbols.len() << room_after)?;
            let base = base + entry(0, index, self.nb_bits(weight));
            match next {
                Some(next) if room_after >= self.shortest() => {
                    let size = 1usize << room_after;
                    let next = next.span(size, size)?;
                    for (out, &symbol) in out.chunks_exact_mut(size).zip(symbols) {
                        let base = base + (u32::from(symbol) << (8 * index));
                        for (entry, next) in out.iter_mut().zip(next) {
                            *entry = base + next;
                        }
                    }
                }
                _ => fill_runs(out, symbols, room_after, base, 1 << (8 * index)),
            }
        }
        Ok(())
    }
}

/// `HUF_DTable`
#[derive(Clone)]
pub(crate) struct HufDTable {
    code: Code,
    /// The kind of table that the C code has.
    table_type: TableType,
    /// How many bits `table` is indexed with.
    log: u32,
    /// Every entry of `table` is a [`single_entry`].
    single: bool,
    /// [`Code::best_form`] for `FAST_MIN_LITERALS` and for `LARGE_MIN_LITERALS`, once it is asked for.
    best_forms: [Option<(u32, bool)>; 2],
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
            single: false,
            best_forms: [None; 2],
            table: [0; TABLE_SIZE],
        }
    }

    /// Reads the description of a table at the start of `src`, and returns its size. The table is to decode
    /// `nb_literals` with, from the rest of `src` if that is `four_streams`.
    fn read(
        &mut self,
        src: &[u8],
        table_type: TableType,
        nb_literals: usize,
        four_streams: bool,
        spread: &mut Spread,
    ) -> Result<usize> {
        let Code {
            weights,
            rank_stats,
            ..
        } = &mut self.code;
        let stats = huf_read_stats_wksp(weights, rank_stats, src, spread)?;
        self.code.nb_symbols = stats.nb_symbols;
        self.code.table_log = stats.table_log;
        self.table_type = table_type;
        self.best_forms = [None; 2];
        let nb_bytes = src.len().saturating_sub(stats.size);
        let (log, single) = self.best_form(nb_literals, nb_bytes, four_streams);
        self.build(log, single)?;
        Ok(stats.size)
    }

    /// [`Code::best_form`], which is for four streams.
    fn best_form(
        &mut self,
        nb_literals: usize,
        nb_bytes: usize,
        four_streams: bool,
    ) -> (u32, bool) {
        if !four_streams {
            return (self.code.best_log(nb_literals), false);
        }
        if nb_literals < FAST_MIN_LITERALS {
            return self.code.best_form(nb_literals, nb_bytes);
        }
        let [fast, large] = &mut self.best_forms;
        let best_form = if nb_literals < LARGE_MIN_LITERALS {
            fast
        } else {
            large
        };
        *best_form.get_or_insert_with(|| self.code.best_form(nb_literals, nb_bytes))
    }

    /// Makes the table fit to decode `nb_literals` of another block with, from `nb_bytes`.
    pub(crate) fn prepare(
        &mut self,
        nb_literals: usize,
        nb_bytes: usize,
        four_streams: bool,
    ) -> Result<()> {
        let (log, single) = self.best_form(nb_literals, nb_bytes, four_streams);
        let is_worth_it = match (self.single, single) {
            (true, true) => false,
            // Few literals do not make up for the time that it takes to fill a large table once more.
            (true, false) => nb_literals >= FAST_MIN_LITERALS || self.log <= SINGLE_SMALL_LOG,
            // The largest table is only made if its lookups yield enough.
            (false, true) => nb_literals >= FAST_MIN_LITERALS && self.log <= FAST_LOG,
            (false, false) => self.log < log,
        };
        if is_worth_it {
            self.build(log, single)?;
        }
        Ok(())
    }

    /// Fills `table` for lookups of `log` bits, which is at least as many as the longest code has.
    fn build(&mut self, log: u32, single: bool) -> Result<()> {
        self.log = log;
        self.single = single;
        let sorted = Sorted::new(&self.code, log)?;
        // The tables of what a third symbol adds end with the one for this many bits.
        let room = log.saturating_sub(2 * sorted.shortest());
        if single {
            self.fill_single(&sorted)
        } else if room < sorted.shortest() {
            self.fill(&sorted, &mut [])
        } else if room < 7 {
            self.fill(&sorted, &mut [0; 1 << 7])
        } else {
            self.fill(&sorted, &mut [0; TABLE_SIZE / 2])
        }
    }

    fn fill_single(&mut self, sorted: &Sorted) -> Result<()> {
        let log = sorted.log;
        for weight in 1..=sorted.max_weight {
            let symbols = sorted.class(weight)?;
            let nb_bits = sorted.nb_bits(weight);
            let room = log - nb_bits;
            let entries = self
                .table
                .span_mut(sorted.position(weight, log)?, symbols.len() << room)?;
            let base = single_entry(0, nb_bits);
            let unit = single_entry(1, nb_bits) - base;
            fill_runs(entries, symbols, room, base, unit);
        }
        Ok(())
    }

    fn fill(&mut self, sorted: &Sorted, thirds: &mut [Entry]) -> Result<()> {
        let log = sorted.log;
        // From how many bits on what a symbol leaves of a lookup holds another.
        let min_room = sorted.shortest();
        for room in min_room..=log.saturating_sub(2 * min_room) {
            sorted.fill(thirds.span_mut(1 << room, 1 << room)?, room, 0, 2, None)?;
        }
        for weight in 1..=sorted.max_weight {
            let symbols = sorted.class(weight)?;
            let nb_bits = sorted.nb_bits(weight);
            let room = log - nb_bits;
            let entries = self
                .table
                .span_mut(sorted.position(weight, log)?, symbols.len() << room)?;
            if room < min_room {
                fill_runs(entries, symbols, room, entry(0, 0, nb_bits), 1);
                continue;
            }
            let Some((&first_symbol, other_symbols)) = symbols.split_first() else {
                continue;
            };
            let size = 1usize << room;
            let (entries, other_entries) = entries.split_at_mut_checked(size).ok_or(BUG)?;
            sorted.fill(
                entries,
                room,
                entry(first_symbol, 0, nb_bits),
                1,
                Some(thirds),
            )?;
            for (copy, &symbol) in other_entries.chunks_exact_mut(size).zip(other_symbols) {
                let change = u32::from(symbol).wrapping_sub(u32::from(first_symbol));
                for (to, from) in copy.iter_mut().zip(&*entries) {
                    *to = from.wrapping_add(change);
                }
            }
        }
        Ok(())
    }

    /// One stream. Whether it is exactly `dst.len()` symbols.
    fn decode_1x(&self, dst: &mut [u8], src: &[u8]) -> bool {
        let Some(mut stream) = Stream::new(Part { src, out: dst }) else {
            return false;
        };
        stream.decode_most(&self.table, self.log);
        self.decode_tails(&mut [stream])
    }

    /// Four streams after their sizes. Whether each is exactly its share of `dst.len()` symbols.
    fn decode_4x(&self, dst: &mut [u8], src: &[u8]) -> bool {
        let Some(parts) = Part::split(dst, src) else {
            return false;
        };
        let Some(mut streams) = Streams::new(parts) else {
            return false;
        };
        if streams.0.iter().all(|stream| stream.bits != 0) {
            if self.single {
                self.decode_most_single(&mut streams);
            } else {
                self.decode_most(&mut streams);
            }
        }
        if !streams.0.iter().all(Stream::fits_tail) {
            return self.decode_stragglers(streams);
        }
        self.decode_4_tails(&mut streams)
    }

    #[inline(never)]
    fn decode_most(&self, streams: &mut Streams<'_>) {
        match self.log {
            8 => streams.decode_most::<8, 5>(&self.table),
            9 => streams.decode_most::<9, 5>(&self.table),
            10 => streams.decode_most::<10, 5>(&self.table),
            11 => streams.decode_most::<11, 5>(&self.table),
            _ => streams.decode_most::<12, 4>(&self.table),
        }
    }

    /// The same with a table where every entry is one symbol.
    #[inline(never)]
    fn decode_most_single(&self, streams: &mut Streams<'_>) {
        match self.log {
            8 => streams.decode_most_single::<8, 7>(&self.table),
            9 => streams.decode_most_single::<9, 6>(&self.table),
            10 => streams.decode_most_single::<10, 5>(&self.table),
            _ => streams.decode_most_single::<SINGLE_MAX_LOG, 5>(&self.table),
        }
    }

    /// The same for streams of which some have much left.
    #[inline(never)]
    fn decode_stragglers(&self, streams: Streams<'_>) -> bool {
        // Some streams get there before others, which go on four at a time all the same: with these.
        static NO_STREAM: [u8; 256] = [0x55; 256];
        let mut no_output = [[0u8; 512]; 4];
        let mut streams: Streams<'_> = streams;
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
            self.decode_most(&mut decoding);
        }
        self.decode_4_tails(&mut streams)
    }

    #[inline(never)]
    fn decode_4_tails(&self, streams: &mut Streams<'_>) -> bool {
        self.decode_tails(&mut streams.0)
    }

    /// Decodes what is left of streams. Whether each turns out to be exactly as many symbols as its output takes.
    #[inline(always)]
    fn decode_tails<const N: usize>(&self, streams: &mut [Stream<'_>; N]) -> bool {
        let mut tails = [const { Tail::new() }; N];
        for (tail, stream) in tails.iter_mut().zip(&*streams) {
            if !tail.set(stream) {
                return false;
            }
        }
        let shift = 64 - self.log;
        loop {
            let mut rounds = tails.each_ref().map(Tail::start_round);
            for _ in 0..Tail::LOOKUPS {
                for (tail, round) in tails.iter_mut().zip(&mut rounds) {
                    let index = (round.bits >> shift) as usize;
                    let entry = self.table.get(index % TABLE_SIZE).copied().unwrap_or(0);
                    round.bits <<= (entry >> 24) & 63;
                    if let Some(to) = tail.out.get_mut(round.op..round.op + 4) {
                        to.copy_from_slice(&entry.to_le_bytes());
                    }
                    round.op += (entry >> (24 + COUNT_SHIFT)) as usize;
                }
            }
            let mut more = false;
            for (tail, round) in tails.iter_mut().zip(&rounds) {
                more |= tail.end_round(round);
            }
            if !more {
                break;
            }
        }
        let mut exact = true;
        for (tail, stream) in tails.iter().zip(streams) {
            exact &= tail.get(stream, self.code.table_log);
        }
        exact
    }
}

/// What is left of a stream that is close to its start or whose output is close to its end, where decoding can go too
/// far: that is made up for afterwards.
struct Tail {
    /// Zeroes, then the start of the stream.
    src: [u8; Self::PADDING + Self::MAX_SRC],
    /// How many bits are left to read of `src`.
    position: u32,
    out: [u8; Self::MAX_SYMBOLS + Self::ROUND_SYMBOLS],
    /// How much of `out` is written.
    op: u32,
}

/// A few lookups between two reads of a stream.
struct Round {
    /// What is left of 64 bits, from the highest bit on, then a bit set.
    bits: u64,
    /// How many of the 64 bits were read before.
    skipped: u32,
    /// How much of the output is written.
    op: usize,
}

impl Tail {
    const LOOKUPS: usize = 4;
    /// How many bytes a round can write.
    const ROUND_SYMBOLS: usize = 3 * Self::LOOKUPS + 1;
    /// No less than a round can read, and 8 bytes.
    const PADDING: usize = 16;
    const MAX_SRC: usize = 64;
    const MAX_SYMBOLS: usize = 128;

    const fn new() -> Self {
        Self {
            src: [0; _],
            position: 0,
            out: [0; _],
            op: 0,
        }
    }

    /// Takes what is left of a stream, if it is not too much and the stream has an end mark.
    fn set(&mut self, stream: &Stream<'_>) -> bool {
        let Some(&last) = stream.src.last() else {
            return false;
        };
        if last == 0 || !stream.fits_tail() {
            return false;
        }
        let end = stream.end();
        let src = self.src.get_mut(Self::PADDING..).unwrap_or_default();
        if let (Some(to), Some(from)) = (
            src.first_chunk_mut::<{ Self::MAX_SRC }>(),
            stream.src.first_chunk::<{ Self::MAX_SRC }>(),
        ) {
            *to = *from;
        } else if let (Some(to), Some(from)) = (src.get_mut(..end), stream.src.get(..end)) {
            to.copy_from_slice(from);
        }
        let consumed = if stream.bits == 0 {
            last.leading_zeros() + 1
        } else {
            stream.bits.trailing_zeros()
        };
        self.position = 8 * (Self::PADDING + end) as u32 - consumed;
        true
    }

    /// Whether neither the start of the stream nor the end of `out` is reached.
    fn has_more(&self) -> bool {
        self.position > 8 * Self::PADDING as u32 && self.op as usize <= Self::MAX_SYMBOLS
    }

    #[inline(always)]
    fn start_round(&self) -> Round {
        let end = (self.position as usize).div_ceil(8);
        let container = self
            .src
            .get(end.wrapping_sub(8)..end)
            .and_then(|bytes| bytes.try_into().ok())
            .map_or(0, u64::from_le_bytes);
        let skipped = self.position.wrapping_neg() & 7;
        Round {
            bits: (container | 1) << skipped,
            skipped,
            op: self.op as usize,
        }
    }

    /// Returns whether there is to be another round.
    #[inline(always)]
    fn end_round(&mut self, round: &Round) -> bool {
        if !self.has_more() {
            return false;
        }
        self.op = round.op as u32;
        self.position -= round.bits.trailing_zeros() - round.skipped;
        self.has_more()
    }

    /// Completes the output of the stream. Whether the stream is exactly as many symbols as its output takes.
    fn get(&self, stream: &mut Stream<'_>, table_log: u32) -> bool {
        let out = stream.out.get_mut(stream.op as usize..).unwrap_or_default();
        let Some(symbols) = self.out.get(..out.len()) else {
            return false;
        };
        out.copy_from_slice(symbols);
        // Zeroes are the longest code.
        let nb_bits = (8 * Self::PADDING as u32).wrapping_sub(self.position);
        let nb_symbols = self.op.wrapping_sub(out.len() as u32);
        !self.has_more() && u64::from(nb_bits) == u64::from(nb_symbols) * u64::from(table_log)
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

    /// Where what is left of `src` ends.
    fn end(&self) -> usize {
        if self.bits == 0 {
            self.src.len()
        } else {
            self.ip as usize + 8
        }
    }

    fn fits_tail(&self) -> bool {
        self.end() <= Tail::MAX_SRC && self.out.len() - self.op as usize <= Tail::MAX_SYMBOLS
    }

    /// Decodes until the stream is close to its start, or its output to its end.
    fn decode_most(&mut self, table: &[Entry; TABLE_SIZE], log: u32) {
        const LOOKUPS: usize = 4;
        if self.bits == 0 {
            return;
        }
        let shift = 64 - log;
        // With nothing else to do in the meantime, what counts is how soon the next lookup can start. So more bits
        // come from where the last ones came from, which is known ahead of time.
        let consumed = self.bits.trailing_zeros();
        // Where the bytes after those that `bits` was read from end.
        let mut next = self.ip as usize;
        let Some(Ok(container)) = self.src.get(next..next + 8).map(<[u8; 8]>::try_from) else {
            return;
        };
        // The next bits, from the highest on: `valid` of them, or somewhat more.
        let mut bits = u64::from_le_bytes(container) << consumed;
        let mut valid = 64 - consumed;
        let mut op = self.op as usize;
        while let Some(window) = (self.out.get_mut(op..op + 3 * LOOKUPS + 1))
            .and_then(|window| window.as_mut_array::<{ 3 * LOOKUPS + 1 }>())
            && next >= 16
            && let Some(Ok(more)) = self.src.get(next - 8..next).map(<[u8; 8]>::try_from)
        {
            bits |= u64::from_le_bytes(more) >> (valid & 63);
            let nb_bytes = (63 - (valid & 63)) >> 3;
            next -= nb_bytes as usize;
            valid += 8 * nb_bytes;
            let mut done = 0;
            for _ in 0..LOOKUPS {
                let entry = table.get((bits >> shift) as usize).copied().unwrap_or(0);
                let nb_bits = (entry >> 24) & 63;
                bits <<= nb_bits;
                valid = valid.wrapping_sub(nb_bits);
                if let Some(to) = window.get_mut(done..done + 4) {
                    to.copy_from_slice(&entry.to_le_bytes());
                }
                done += (entry >> (24 + COUNT_SHIFT)) as usize;
            }
            op += done;
        }
        let position = 8 * next + valid as usize;
        let end = position.div_ceil(8);
        if let Some(Ok(container)) =
            (self.src.get(end.wrapping_sub(8)..end)).map(<[u8; 8]>::try_from)
        {
            self.ip = (end - 8) as u32;
            self.bits = (u64::from_le_bytes(container) | 1) << ((8 * end - position) & 63);
            self.op = op as u32;
        }
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
    /// most 55 bits.
    #[inline(always)]
    fn decode_most<const LOG: u32, const LOOKUPS: usize>(&mut self, table: &[Entry; TABLE_SIZE]) {
        #[inline(always)]
        fn lookup<const LOG: u32>(
            table: &[Entry; TABLE_SIZE],
            bits: &mut u64,
            window: &mut [u8; WINDOW],
            done: &mut usize,
        ) {
            let index = (*bits >> (64 - LOG)) as usize;
            // The highest byte of the entry, read on its own where that is simple: the next lookup waits for it.
            let nb_bits = if cfg!(target_endian = "little") {
                bun_pod::bytes_of(table).get(4 * index + 3).copied()
            } else {
                table.get(index).map(|entry| (entry >> 24) as u8)
            };
            if let (Some(entry), Some(nb_bits)) = (table.get(index), nb_bits) {
                *bits <<= nb_bits & 63;
                if let Some(to) = window.get_mut(*done..*done + 4) {
                    to.copy_from_slice(&entry.to_le_bytes());
                }
                *done += (entry >> (24 + COUNT_SHIFT)) as usize;
            }
        }

        /// `LOOKUPS` in each stream. Not a loop: one that is not unrolled checks `done` at every turn.
        #[inline(always)]
        fn round<const LOG: u32, const LOOKUPS: usize>(
            table: &[Entry; TABLE_SIZE],
            bits: [&mut u64; 4],
            windows: &mut [&mut [u8; WINDOW]; 4],
            done: &mut [usize; 4],
        ) {
            let [bits0, bits1, bits2, bits3] = bits;
            let [window0, window1, window2, window3] = windows;
            let [done0, done1, done2, done3] = done;
            let mut lookups = || {
                lookup::<LOG>(table, bits0, window0, done0);
                lookup::<LOG>(table, bits1, window1, done1);
                lookup::<LOG>(table, bits2, window2, done2);
                lookup::<LOG>(table, bits3, window3, done3);
            };
            lookups();
            lookups();
            lookups();
            lookups();
            if LOOKUPS > 4 {
                lookups();
            }
        }

        #[inline(always)]
        fn window(out: &mut [u8], op: u32) -> Option<&mut [u8; WINDOW]> {
            out.get_mut(op as usize..op as usize + WINDOW)?
                .as_mut_array()
        }

        const { assert!((LOOKUPS == 4 || LOOKUPS == 5) && LOG as usize * LOOKUPS <= 55) };
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
            let mut windows = [window0, window1, window2, window3];
            let mut done = [0; 4];
            round::<LOG, LOOKUPS>(
                table,
                [&mut bits0, &mut bits1, &mut bits2, &mut bits3],
                &mut windows,
                &mut done,
            );
            let mut more = reload(s0.src, &mut ip0, &mut bits0)
                && reload(s1.src, &mut ip1, &mut bits1)
                && reload(s2.src, &mut ip2, &mut bits2)
                && reload(s3.src, &mut ip3, &mut bits3);
            if more {
                round::<LOG, LOOKUPS>(
                    table,
                    [&mut bits0, &mut bits1, &mut bits2, &mut bits3],
                    &mut windows,
                    &mut done,
                );
                more = reload(s0.src, &mut ip0, &mut bits0)
                    && reload(s1.src, &mut ip1, &mut bits1)
                    && reload(s2.src, &mut ip2, &mut bits2)
                    && reload(s3.src, &mut ip3, &mut bits3);
            }
            let [done0, done1, done2, done3] = done;
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

    /// The same with a table where every entry is one symbol. `LOOKUPS` of `LOG` bits are at most 56 bits.
    #[inline(always)]
    fn decode_most_single<const LOG: u32, const LOOKUPS: usize>(
        &mut self,
        table: &[Entry; TABLE_SIZE],
    ) {
        #[inline(always)]
        fn lookup<const LOG: u32>(
            table: &[Entry; TABLE_SIZE],
            bits: &mut u64,
            to: Option<&mut u8>,
        ) {
            let index = (*bits >> (64 - LOG)) as usize;
            let middle = if cfg!(target_endian = "little") {
                (bun_pod::bytes_of(table).get(4 * index + 1..))
                    .and_then(|bytes| bytes.first_chunk())
                    .map(|bytes| u16::from_le_bytes(*bytes))
            } else {
                table.get(index).map(|entry| (entry >> 8) as u16)
            };
            if let (Some(to), Some(middle)) = (to, middle) {
                *bits <<= middle & 63;
                *to = (middle >> 8) as u8;
            }
        }

        #[inline(always)]
        fn rounds<'a, const LOOKUPS: usize>(stream: &'a mut Stream<'_>) -> &'a mut [[u8; LOOKUPS]] {
            let left = stream.out.get_mut(stream.op as usize..).unwrap_or_default();
            left.as_chunks_mut().0
        }

        const { assert!(LOOKUPS <= 7 && LOG as usize * LOOKUPS <= 56) };
        let [s0, s1, s2, s3] = &mut self.0;
        let (mut bits0, mut bits1, mut bits2, mut bits3) = (s0.bits, s1.bits, s2.bits, s3.bits);
        let (mut ip0, mut ip1, mut ip2, mut ip3) = (s0.ip, s1.ip, s2.ip, s3.ip);
        let (src0, src1, src2, src3) = (s0.src, s1.src, s2.src, s3.src);
        let mut nb_rounds = 0;
        for (((out0, out1), out2), out3) in rounds::<LOOKUPS>(s0)
            .iter_mut()
            .zip(rounds::<LOOKUPS>(s1))
            .zip(rounds::<LOOKUPS>(s2))
            .zip(rounds::<LOOKUPS>(s3))
        {
            // A stream that is not reloaded yet can have as few as 55 bits.
            if !(reload(src0, &mut ip0, &mut bits0)
                && reload(src1, &mut ip1, &mut bits1)
                && reload(src2, &mut ip2, &mut bits2)
                && reload(src3, &mut ip3, &mut bits3))
            {
                break;
            }
            let mut lookups = |index: usize| {
                lookup::<LOG>(table, &mut bits0, out0.get_mut(index));
                lookup::<LOG>(table, &mut bits1, out1.get_mut(index));
                lookup::<LOG>(table, &mut bits2, out2.get_mut(index));
                lookup::<LOG>(table, &mut bits3, out3.get_mut(index));
            };
            lookups(0);
            lookups(1);
            lookups(2);
            lookups(3);
            lookups(4);
            lookups(5);
            lookups(6);
            nb_rounds += 1;
        }
        (s0.bits, s1.bits, s2.bits, s3.bits) = (bits0, bits1, bits2, bits3);
        (s0.ip, s1.ip, s2.ip, s3.ip) = (ip0, ip1, ip2, ip3);
        for stream in &mut self.0 {
            stream.op += nb_rounds * LOOKUPS as u32;
        }
    }
}

/// `HUF_readDTableX2_wksp`. Returns the size of the table's description in `src`.
pub(crate) fn read_dtable_x2(
    dtable: &mut HufDTable,
    src: &[u8],
    spread: &mut Spread,
) -> Result<usize> {
    dtable.read(src, TableType::X2, usize::MAX, false, spread)
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
pub(crate) fn decompress_1x1(
    dtable: &mut HufDTable,
    dst: &mut [u8],
    src: &[u8],
    spread: &mut Spread,
) -> Result<usize> {
    let h_size = dtable.read(src, TableType::X1, dst.len(), false, spread)?;
    if h_size >= src.len() {
        return Err(Error::SrcSizeWrong);
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
    spread: &mut Spread,
) -> Result<usize> {
    if dst.is_empty() {
        return Err(Error::DstSizeTooSmall);
    }
    if src.is_empty() {
        return Err(Error::CorruptionDetected);
    }
    let table_type = if select_decoder_x2(dst.len(), src.len())? {
        TableType::X2
    } else {
        TableType::X1
    };
    let h_size = dtable.read(src, table_type, dst.len(), true, spread)?;
    if h_size >= src.len() {
        return Err(Error::SrcSizeWrong);
    }
    decompress_4x_using_dtable(dst, src.sub(h_size..)?, dtable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::huf::{
        HufCTable, build_ctable, compress_1x_using_ctable, compress_4x_using_ctable, write_ctable,
    };

    #[test]
    fn a_table_is_made_to_suit_each_block() -> Result<()> {
        let mut state = 5u32;
        let mut random = move || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state >> 8
        };
        // Few enough for codes of 8 bits at most that are not all as long. The lowest have the shortest codes.
        const MAX_SYMBOL: u32 = 199;
        let counts: [u32; MAX_SYMBOL as usize + 1] = core::array::from_fn(|symbol| {
            let rank = MAX_SYMBOL + 1 - symbol as u32;
            rank * rank * rank / 256 + 1
        });
        // How many literals, by how much they are lowered, and whether they are in four streams.
        let blocks = [
            (300, 0, true),
            (300, 3, true),
            (FAST_MIN_LITERALS, 0, true),
            (300, 3, true),
            (FAST_MIN_LITERALS, 0, false),
            (300, 0, false),
            (LARGE_MIN_LITERALS, 3, true),
            (200, 3, false),
            (LARGE_MIN_LITERALS, 0, true),
        ];
        // Miri takes a minute for 10,000 literals.
        let (blocks, longest_codes, firsts, max_damaged) = if cfg!(miri) {
            (blocks.sub(..5)?, 11..=11, [0].as_slice(), 300)
        } else {
            (
                blocks.sub(..)?,
                8..=12,
                [0, 6, 8].as_slice(),
                FAST_MIN_LITERALS,
            )
        };
        // From which kind of table to which one a block went on with the code of the block before.
        let mut changes = [[0; 2]; 2];
        let mut dtable = HufDTable::new();
        for (max_nb_bits, &first) in
            longest_codes.flat_map(|log| firsts.iter().map(move |first| (log, first)))
        {
            let mut ctable = HufCTable::new();
            let table_log = build_ctable(&mut ctable, &counts, MAX_SYMBOL, max_nb_bits)?;
            assert_eq!(table_log, max_nb_bits as usize);
            let mut description = [0; NB_SYMBOLS];
            let size = write_ctable(&mut description, &ctable, MAX_SYMBOL, max_nb_bits)?;
            let description = description.sub(..size)?;

            for (index, &(nb_literals, shift, four_streams)) in
                blocks.iter().skip(first).chain(blocks).enumerate()
            {
                let literals: Vec<u8> = (0..nb_literals)
                    .map(|_| {
                        (((random() & 255).min(random() & 255) * MAX_SYMBOL / 256) >> shift) as u8
                    })
                    .collect();
                let mut streams = vec![0; 2 * nb_literals];
                let size = if four_streams {
                    compress_4x_using_ctable(&mut streams, &literals, &ctable)?
                } else {
                    compress_1x_using_ctable(&mut streams, &literals, &ctable)?
                };
                streams.truncate(size);
                if index == 0 {
                    let src = [description, &streams].concat();
                    let spread = &mut Spread::new();
                    let read = dtable.read(&src, TableType::X1, nb_literals, four_streams, spread);
                    assert_eq!(read, Ok(description.len()));
                } else {
                    let was_single = dtable.single;
                    dtable.prepare(nb_literals, size, four_streams)?;
                    *changes
                        .at_mut(usize::from(was_single))?
                        .at_mut(usize::from(dtable.single))? += 1;
                }
                let mut decoded = vec![0; nb_literals];
                assert!(if four_streams {
                    dtable.decode_4x(&mut decoded, &streams)
                } else {
                    dtable.decode_1x(&mut decoded, &streams)
                });
                assert_eq!(decoded, literals);

                // Streams that do not end where they should, some much shorter than the others.
                let nb_damaged = match four_streams && nb_literals <= max_damaged {
                    true if cfg!(miri) => 2,
                    true => 6,
                    false => 0,
                };
                for _ in 0..nb_damaged {
                    let mut damaged = streams.clone();
                    let at = random() as usize % if random() % 2 == 0 { 6 } else { size };
                    *damaged.at_mut(at)? ^= 1 << (random() % 8);
                    let mut exact = vec![0; nb_literals];
                    let result =
                        huf_exact::decompress_4x(&mut exact, &damaged, &dtable.code, TableType::X1);
                    assert_eq!(
                        decompress_4x_using_dtable(&mut decoded, &damaged, &dtable),
                        result
                    );
                    assert!(result.is_err() || decoded == exact);
                }
            }
        }
        assert!(changes.as_flattened().iter().all(|&count| count > 0));
        Ok(())
    }
}
