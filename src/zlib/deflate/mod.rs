//! Compression, byte for byte as by zlib-ng 2.3.3.

mod block;
mod chains;
mod greedy;
mod huffman;
mod lazy;
mod medium;
mod pending;
mod quick;
mod runs;
mod stored;
mod window;

use bun_core::vec::{BorrowedCursor, append_with};

use crate::checksum::{Checksum, adler32};
use crate::error::{Error, Result};
use crate::format::{
    DEFLATE_METHOD, FIXED_BLOCK, GZIP_ID, MAX_WINDOW_BITS, MIN_MATCH, MIN_WINDOW_BITS,
    ZLIB_HEADER_DIVISOR, ZLIB_PRESET_DICTIONARY,
};
use block::Block;
use chains::{Chains, Effort, Search};
use lazy::Lazy;
use pending::Pending;
use quick::QuickBlock;
use window::{MIN_LOOKAHEAD, Window};

/// What is put around the compressed data.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Container {
    Raw,
    Zlib,
    Gzip,
}

/// From 0, which does not compress, to 9.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Level(u8);

impl Level {
    pub const DEFAULT: Self = Self(6);
    pub const BEST: Self = Self(9);
}

impl TryFrom<i32> for Level {
    type Error = Error;

    /// -1 is the default, as in zlib.
    fn try_from(level: i32) -> Result<Self> {
        match level {
            -1 => Ok(Self::DEFAULT),
            0..=9 => Ok(Self(level as u8)),
            _ => Err(Error::InvalidParameter),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Strategy {
    Default,
    /// No short matches, from level 7 on.
    Filtered,
    HuffmanOnly,
    /// Only matches at a distance of 1.
    Rle,
    /// No dynamic blocks.
    Fixed,
}

impl TryFrom<i32> for Strategy {
    type Error = Error;

    /// zlib's numbers.
    fn try_from(strategy: i32) -> Result<Self> {
        Ok(match strategy {
            0 => Self::Default,
            1 => Self::Filtered,
            2 => Self::HuffmanOnly,
            3 => Self::Rle,
            4 => Self::Fixed,
            _ => return Err(Error::InvalidParameter),
        })
    }
}

/// From the weakest to the strongest.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Flush {
    None,
    /// Ends the block. Up to 7 bits of it are held back.
    Block,
    /// Adds an empty fixed block, which is enough for all of the input to be inflated.
    Partial,
    /// Adds an empty stored block, which ends at a byte boundary with `00 00 ff ff`.
    Sync,
    /// The same, and what follows does not refer to anything in front of it.
    Full,
    Finish,
}

/// Why a call returned.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    /// All of the input has been consumed, and the flush is complete.
    NeedsInput,
    /// The output is full. To be called again with the same flush.
    NeedsOutput,
    StreamEnd,
}

#[derive(Clone, Copy)]
pub struct Options {
    pub level: Level,
    pub strategy: Strategy,
    /// 9 to 15, or 8 in a zlib container, which is taken for 9.
    pub window_bits: u8,
    /// 1 to 9. A block has fewer than `64 << memory_level` symbols.
    pub memory_level: u8,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            level: Level::DEFAULT,
            strategy: Strategy::Default,
            window_bits: MAX_WINDOW_BITS,
            memory_level: 8,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Method {
    Stored,
    Quick,
    Greedy,
    Medium,
    Lazy,
}

#[derive(Clone, Copy)]
struct Tuning {
    method: Method,
    /// With `Method::Lazy`, a match that is so long is taken at once. With others it tells up to which length the
    /// positions in a match are hashed.
    max_lazy: u32,
    effort: Effort,
}

impl Level {
    fn tuning(self) -> Tuning {
        let (method, good_len, max_lazy, nice_len, max_chain) = match self.0 {
            0 => (Method::Stored, 0, 0, 0, 0),
            1 => (Method::Quick, 0, 0, 0, 0),
            2 => (Method::Greedy, 4, 4, 8, 4),
            3 => (Method::Medium, 4, 6, 16, 6),
            4 => (Method::Medium, 4, 12, 32, 24),
            5 => (Method::Medium, 8, 16, 32, 32),
            6 => (Method::Medium, 8, 16, 128, 128),
            7 => (Method::Lazy, 8, 32, 128, 256),
            8 => (Method::Lazy, 32, 128, 258, 1024),
            _ => (Method::Lazy, 32, 258, 258, 4096),
        };
        Tuning {
            method,
            max_lazy,
            effort: Effort {
                good_len,
                nice_len,
                max_chain,
                gives_up_early: self.0 < 5,
            },
        }
    }

    fn uses_rolling_hash(self) -> bool {
        self == Self::BEST
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Header {
        dictionary_id: Option<u32>,
    },
    Blocks,
    /// The last block has been written.
    Trailer,
    Done,
}

/// How far a method has got.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Progress {
    /// Input or room.
    NeedsMore,
    BlockDone,
    /// Not all of it has been handed out.
    LastBlockPending,
    LastBlockDone,
}

/// The buffers of one call.
struct Io<'a, 'b> {
    input: &'a [u8],
    out: BorrowedCursor<'b, u8>,
}

impl<'a> Io<'a, '_> {
    fn take_input(&mut self, max: usize) -> &'a [u8] {
        let taken;
        (taken, self.input) = self.input.split_at(max.min(self.input.len()));
        taken
    }

    fn is_full(&self) -> bool {
        self.out.capacity() == 0
    }
}

pub struct Deflater {
    container: Container,
    level: Level,
    strategy: Strategy,
    phase: Phase,
    has_started: bool,
    /// `None` if it was not completed.
    last_flush: Option<Flush>,
    checksum: Checksum,
    window: Window,
    chains: Chains,
    /// How often the window has slid at level 0, which leaves the chains alone. 2 stands for more, too.
    missed_slides: u8,
    block: Block,
    pending: Pending,
    quick_block: QuickBlock,
    lazy: Lazy,
}

impl Deflater {
    pub fn new(container: Container, options: Options) -> Result<Box<Self>> {
        let window_bits = match (options.window_bits, container) {
            (MIN_WINDOW_BITS, Container::Zlib) => MIN_WINDOW_BITS + 1,
            (bits @ 9..=MAX_WINDOW_BITS, _) => bits,
            _ => return Err(Error::InvalidParameter),
        };
        if !(1..=9).contains(&options.memory_level) {
            return Err(Error::InvalidParameter);
        }
        let block_size = 64 << options.memory_level;
        Box::try_new(Self {
            container,
            level: options.level,
            strategy: options.strategy,
            phase: Phase::Header {
                dictionary_id: None,
            },
            has_started: false,
            last_flush: None,
            checksum: Checksum::None,
            window: Window::new(window_bits)?,
            chains: Chains::new(1 << window_bits)?,
            missed_slides: 0,
            block: Block::new(block_size - 1)?,
            pending: Pending::new(4 * block_size)?,
            quick_block: QuickBlock::None,
            lazy: Lazy::default(),
        })
        .map_err(|_| Error::Alloc(bun_alloc::AllocError))
    }

    /// For another stream.
    pub fn reset(&mut self) {
        self.phase = Phase::Header {
            dictionary_id: None,
        };
        self.has_started = false;
        self.last_flush = None;
        self.checksum = Checksum::None;
        self.window.rewind();
        self.chains.reset();
        self.missed_slides = 0;
        self.block.clear();
        self.pending.clear();
        self.quick_block = QuickBlock::None;
        self.lazy = Lazy::default();
    }

    /// Before anything else. gzip has no dictionaries.
    pub fn set_dictionary(&mut self, dictionary: &[u8]) -> Result<()> {
        if self.has_started || self.window.end != 0 || self.container == Container::Gzip {
            return Err(Error::InvalidState);
        }
        if dictionary.is_empty() {
            return Ok(());
        }
        self.phase = Phase::Header {
            dictionary_id: (self.container == Container::Zlib).then(|| adler32(dictionary)),
        };
        let start = dictionary.len().saturating_sub(self.window.size as usize);
        self.window
            .append(dictionary.get(start..).unwrap_or_default());
        let end = self.window.end;
        self.chains.grow(end);
        self.window.position = end;
        self.window.start_block();
        self.window.leave_end_unhashed();
        let hashed = end - self.window.unhashed;
        if hashed != 0 && self.level.uses_rolling_hash() {
            self.chains.restart_rolling_hash(&self.window.bytes, 0);
        }
        self.hash_all(0, hashed);
        Ok(())
    }

    /// `false`, and nothing changes, if a block would have to be flushed first.
    pub fn set_params(&mut self, level: Level, strategy: Strategy) -> Result<bool> {
        let changes_method =
            strategy != self.strategy || level.tuning().method != self.level.tuning().method;
        if changes_method && self.has_started {
            if self.is_finishing() {
                return Err(Error::InvalidState);
            }
            if self.window.block_start != i64::from(self.window.end) {
                return Ok(false);
            }
        }
        if level != self.level {
            match core::mem::take(&mut self.missed_slides) {
                0 => {}
                1 => self.chains.slide(self.window.size),
                _ => self.chains.clear(),
            }
        }
        (self.level, self.strategy) = (level, strategy);
        Ok(true)
    }

    /// Goes as far as it can, and advances `input` past what it has consumed.
    pub fn deflate(
        &mut self,
        input: &mut &[u8],
        out: BorrowedCursor<'_, u8>,
        flush: Flush,
    ) -> Result<Status> {
        if self.is_finishing() && flush != Flush::Finish {
            return Err(Error::InvalidState);
        }
        if out.capacity() == 0 {
            return Ok(Status::NeedsOutput);
        }
        let mut io = Io { input, out };
        let result = self.run(&mut io, flush);
        *input = io.input;
        if self.pending.has_overflowed() {
            return Err(Error::Internal);
        }
        Ok(match result? {
            true => Status::StreamEnd,
            false if io.is_full() => {
                self.last_flush = None;
                Status::NeedsOutput
            }
            false => Status::NeedsInput,
        })
    }

    /// Like `deflate()` with exactly `room` bytes behind the end of `out`. At level 0 that decides where blocks end.
    pub fn deflate_limited(
        &mut self,
        input: &mut &[u8],
        out: &mut Vec<u8>,
        room: usize,
        flush: Flush,
    ) -> Result<Status> {
        out.try_reserve(room)?;
        append_with(out, room, |out| self.deflate(input, out, flush))
    }

    /// All of `input`, and the flush is complete. `out` grows as needed.
    pub fn deflate_to_vec(
        &mut self,
        mut input: &[u8],
        out: &mut Vec<u8>,
        flush: Flush,
    ) -> Result<()> {
        const MAX_GROWTH: usize = 64 * 1024;
        let growth = max_compressed_len(input.len()).min(MAX_GROWTH);
        loop {
            out.try_reserve(growth)?;
            let status = append_with(out, usize::MAX, |out| self.deflate(&mut input, out, flush))?;
            if status != Status::NeedsOutput {
                return Ok(());
            }
        }
    }

    fn is_finishing(&self) -> bool {
        matches!(self.phase, Phase::Trailer | Phase::Done)
    }

    /// Whether the stream has ended.
    fn run(&mut self, io: &mut Io<'_, '_>, flush: Flush) -> Result<bool> {
        let is_finishing = self.is_finishing();
        self.has_started = true;
        let last_flush = self.last_flush.replace(flush);
        if !self.pending.has_no_bytes() {
            self.pending.hand_out(&mut io.out);
            if io.is_full() {
                return Ok(false);
            }
        } else if io.input.is_empty() && Some(flush) <= last_flush && flush != Flush::Finish {
            return Ok(false);
        }
        if is_finishing && !io.input.is_empty() {
            return Err(Error::InputAfterFinish);
        }

        if let Phase::Header { dictionary_id } = self.phase {
            self.phase = Phase::Blocks;
            self.write_header(dictionary_id);
            self.pending.hand_out(&mut io.out);
            if !self.pending.has_no_bytes() {
                return Ok(false);
            }
        }

        if !is_finishing
            && (!io.input.is_empty() || self.window.lookahead() != 0 || flush != Flush::None)
        {
            match self.compress(io, flush) {
                Progress::NeedsMore => return Ok(false),
                Progress::LastBlockPending => {
                    self.phase = Phase::Trailer;
                    return Ok(false);
                }
                Progress::LastBlockDone => self.phase = Phase::Trailer,
                Progress::BlockDone => {
                    self.write_flush_marker(flush);
                    self.pending.hand_out(&mut io.out);
                }
            }
        }
        if flush != Flush::Finish {
            return Ok(false);
        }

        if self.phase == Phase::Trailer {
            self.phase = Phase::Done;
            match self.checksum {
                Checksum::None => {}
                Checksum::Adler32(adler) => self.pending.write_bytes(&adler.to_be_bytes()),
                Checksum::Crc32 { crc, len } => {
                    self.pending.write_bytes(&crc.to_le_bytes());
                    self.pending.write_bytes(&len.to_le_bytes());
                }
            }
            self.pending.hand_out(&mut io.out);
        }
        Ok(self.pending.has_no_bytes())
    }

    fn write_header(&mut self, dictionary_id: Option<u32>) {
        let is_fastest = self.level.0 < 2
            || matches!(
                self.strategy,
                Strategy::HuffmanOnly | Strategy::Rle | Strategy::Fixed
            );
        match self.container {
            Container::Raw => {}
            Container::Zlib => {
                let window_bits = self.window.size.ilog2() as u8;
                let method_and_window = (window_bits - MIN_WINDOW_BITS) << 4 | DEFLATE_METHOD;
                let mut flags = match self.level.0 {
                    _ if is_fastest => 0,
                    0..6 => 1,
                    6 => 2,
                    _ => 3,
                } << 6;
                if dictionary_id.is_some() {
                    flags |= ZLIB_PRESET_DICTIONARY;
                }
                let header = u16::from_be_bytes([method_and_window, flags]);
                let header = header + ZLIB_HEADER_DIVISOR - header % ZLIB_HEADER_DIVISOR;
                self.pending.write_bytes(&header.to_be_bytes());
                if let Some(id) = dictionary_id {
                    self.pending.write_bytes(&id.to_be_bytes());
                }
                self.checksum = Checksum::ZLIB;
            }
            Container::Gzip => {
                const SYSTEM: u8 = if cfg!(windows) {
                    10
                } else if cfg!(target_vendor = "apple") {
                    19
                } else {
                    3
                };
                let extra_flags = match self.level {
                    Level::BEST => 2,
                    _ if is_fastest => 4,
                    _ => 0,
                };
                self.pending.write_bytes(&GZIP_ID);
                self.pending
                    .write_bytes(&[DEFLATE_METHOD, 0, 0, 0, 0, 0, extra_flags, SYSTEM]);
                self.checksum = Checksum::GZIP;
            }
        }
    }

    fn compress(&mut self, io: &mut Io<'_, '_>, flush: Flush) -> Progress {
        let tuning = self.level.tuning();
        match (tuning.method, self.strategy) {
            (Method::Stored, _) => self.store(io, flush),
            (_, Strategy::HuffmanOnly) => self.compress_literals(io, flush),
            (_, Strategy::Rle) => self.compress_runs(io, flush),
            (Method::Quick, _) => self.compress_quickly(io, flush),
            (Method::Greedy, _) => self.compress_greedily(io, flush, tuning),
            (Method::Medium, _) => self.compress_medium(io, flush, tuning),
            (Method::Lazy, _) if self.level.uses_rolling_hash() => {
                self.compress_lazily::<true>(io, flush, tuning)
            }
            (Method::Lazy, _) => self.compress_lazily::<false>(io, flush, tuning),
        }
    }

    fn write_flush_marker(&mut self, flush: Flush) {
        match flush {
            Flush::Partial => self.pending.write_bits(2, |writer| {
                writer.put_block_type(FIXED_BLOCK, false);
                block::FIXED.put_end_of_block(writer);
            }),
            Flush::Sync => self.pending.write_stored_header(0, false),
            Flush::Full => {
                self.pending.write_stored_header(0, false);
                self.chains.clear();
                self.window.rewind();
            }
            Flush::None | Flush::Block | Flush::Finish => {}
        }
    }

    fn hash_all(&mut self, start: u32, len: u32) {
        let window = self.window.bytes.as_slice();
        if self.level.uses_rolling_hash() {
            self.chains.insert_all::<true>(window, start, len);
        } else {
            self.chains.insert_all::<false>(window, start, len);
        }
    }

    fn read_into_window(&mut self, io: &mut Io<'_, '_>) {
        let input = io.take_input(self.window.room());
        self.checksum.update(self.window.append(input));
    }

    /// Until there is `MIN_LOOKAHEAD`, or no more input.
    fn fill_window(&mut self, io: &mut Io<'_, '_>) {
        loop {
            if self.window.position >= self.window.slide_position() {
                self.window.slide(self.window.size);
                self.lazy.slide(self.window.size);
                self.chains.slide(self.window.size);
            }
            if io.input.is_empty() {
                return;
            }
            self.read_into_window(io);
            self.chains.grow(self.window.end);

            let (lookahead, unhashed) = (self.window.lookahead(), self.window.unhashed);
            if lookahead + unhashed >= MIN_MATCH as u32 {
                let start = self.window.position - unhashed;
                if self.level.uses_rolling_hash() {
                    self.chains.restart_rolling_hash(&self.window.bytes, start);
                } else if start != 0 {
                    self.chains.insert::<false>(&self.window.bytes, start - 1);
                }
                let len = unhashed - u32::from(lookahead == 1);
                self.hash_all(start, len);
                self.window.unhashed -= len;
            }
            if lookahead >= MIN_LOOKAHEAD || io.input.is_empty() {
                return;
            }
        }
    }

    /// The position from which on it has to be asked again. If there is none, how to go on.
    fn next_stretch(&mut self, io: &mut Io<'_, '_>, flush: Flush, wanted: u32) -> Stretch {
        if self.window.lookahead() < wanted {
            self.fill_window(io);
            if self.window.lookahead() < wanted && flush == Flush::None {
                return Stretch::NeedsInput;
            }
            if self.window.lookahead() == 0 {
                return Stretch::End;
            }
        }
        let with_lookahead = (self.window.end + 1).saturating_sub(wanted);
        if flush == Flush::None || !io.input.is_empty() {
            return Stretch::Until(with_lookahead);
        }
        let without = self.window.end.min(self.window.slide_position());
        Stretch::Until(with_lookahead.max(without))
    }

    fn search(&self, tuning: Tuning) -> Search {
        Search {
            position: self.window.position,
            lookahead: self.window.lookahead(),
            max_distance: self.window.max_distance(),
            effort: tuning.effort,
        }
    }

    /// Whether there is room left.
    fn flush_block(&mut self, io: &mut Io<'_, '_>, is_last: bool) -> bool {
        let only_fixed = self.strategy == Strategy::Fixed;
        self.block
            .write(&mut self.pending, self.window.block(), only_fixed, is_last);
        self.window.start_block();
        self.pending.hand_out(&mut io.out);
        !io.is_full()
    }

    /// When all of the input is in the block.
    fn flush_rest(&mut self, io: &mut Io<'_, '_>, flush: Flush) -> Progress {
        if flush == Flush::Finish {
            return if self.flush_block(io, true) {
                Progress::LastBlockDone
            } else {
                Progress::LastBlockPending
            };
        }
        if self.block.is_empty() || self.flush_block(io, false) {
            Progress::BlockDone
        } else {
            Progress::NeedsMore
        }
    }
}

/// With the largest window: 9 bits for a byte, the start and end of a block, and gzip's header and trailer.
fn max_compressed_len(len: usize) -> usize {
    len.saturating_add(len / 8).saturating_add(6 + 18)
}

/// Appends a whole stream to `out`.
pub fn compress(
    input: &[u8],
    out: &mut Vec<u8>,
    container: Container,
    options: Options,
) -> Result<()> {
    let mut deflater = Deflater::new(container, options)?;
    out.try_reserve_exact(max_compressed_len(input.len()))?;
    deflater.deflate_to_vec(input, out, Flush::Finish)
}

enum Stretch {
    Until(u32),
    NeedsInput,
    /// There is a flush, and nothing is left.
    End,
}
