//! Compression, byte for byte as by zlib-ng 2.3.3.

mod block;
mod chains;
mod encoding;
mod greedy;
mod header;
mod huffman;
mod lazy;
mod matcher;
mod medium;
mod pending;
mod quick;
mod runs;
mod stored;
mod symbol;
mod window;

use bun_core::vec::{BorrowedCursor, append_with};
use bun_deflate::format::{MIN_MATCH_LEN, STATIC};
use bun_deflate::gzip;
use bun_highway::adler32;

use crate::checksum::Checksum;
use crate::error::{Error, Result};
use crate::format::{
    DEFLATE_METHOD, MAX_WINDOW_BITS, MIN_WINDOW_BITS, ZLIB_HEADER_DIVISOR, ZLIB_PRESET_DICTIONARY,
};
use block::Block;
use chains::{Chains, HASHED_LEN};
use lazy::Lazy;
use matcher::{Effort, Matcher};
use pending::{Bits, Pending};
use quick::QuickBlock;
use window::Window;

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
    /// So long a match is taken at once. Where all are, it limits those whose positions are hashed.
    max_lazy: u32,
    effort: Effort,
}

impl Tuning {
    #[inline(always)]
    fn matcher<'a>(&self, chains: &'a mut Chains, window: &'a Window) -> Matcher<'a> {
        Matcher {
            index: chains.over(&window.bytes),
            max_distance: window.max_distance(),
            effort: self.effort,
        }
    }
}

impl Level {
    // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate.c#L102
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

/// What may be in the chains.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Hashed {
    Nothing,
    /// The window is still as it was when the hashes were computed.
    FirstInput,
    More,
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
    hashed: Hashed,
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
            hashed: Hashed::Nothing,
            missed_slides: 0,
            block: Block::new(block_size - 1)?,
            pending: Pending::new(4 * block_size)?,
            quick_block: QuickBlock::None,
            lazy: Lazy::default(),
        })
        .map_err(|_| Error::Alloc(bun_alloc::AllocError))
    }

    /// For another stream, for which it is like a new one with the last parameters.
    pub fn reset(&mut self) {
        self.phase = Phase::Header {
            dictionary_id: None,
        };
        self.has_started = false;
        self.last_flush = None;
        self.forget_history();
        self.window.forget_bytes();
        self.chains.start_over();
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
        let used = dictionary.get(start..).unwrap_or_default();
        self.window.append(used, &mut Checksum::None);
        let end = self.window.end;
        self.chains.grow(end);
        self.window.position = end;
        self.window.start_block();
        self.window.leave_end_unhashed();
        let hashed = end - self.window.unhashed;
        if hashed != 0 && self.level.uses_rolling_hash() {
            self.chains.over(&self.window.bytes).restart_rolling_hash(0);
        }
        self.hash_all(0, hashed);
        self.hashed = Hashed::More;
        Ok(())
    }

    /// `false`, and nothing changes, if a block would have to be flushed first.
    pub fn set_params(&mut self, level: Level, strategy: Strategy) -> Result<bool> {
        // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate.c#L589
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
            if self.hashed == Hashed::FirstInput {
                self.hashed = Hashed::More;
            }
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
        if result? {
            Ok(Status::StreamEnd)
        } else if io.is_full() {
            self.last_flush = None;
            Ok(Status::NeedsOutput)
        } else if flush == Flush::Finish {
            Err(Error::Internal)
        } else {
            Ok(Status::NeedsInput)
        }
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
        // A flush that fills the output is done again.
        let marker_len = if flush == Flush::Finish { 0 } else { 6 };
        let growth = expected_max_len(input.len(), self.container).min(MAX_GROWTH) + marker_len;
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
        // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate.c#L753
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
                    self.pending.write_bytes(&gzip::trailer_for(crc, len));
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
                // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/zutil.h#L115
                const SYSTEM: u8 = if cfg!(windows) {
                    10
                } else if cfg!(target_vendor = "apple") {
                    19
                } else {
                    3
                };
                let effort = match self.level {
                    Level::BEST => 2,
                    _ if is_fastest => 4,
                    _ => 0,
                };
                self.pending
                    .write_bytes(&gzip::plain_header(effort, SYSTEM));
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
            (Method::Medium, _) if tuning.effort.gives_up_early => {
                self.compress_medium::<false>(io, flush, tuning)
            }
            (Method::Medium, _) => self.compress_medium::<true>(io, flush, tuning),
            (Method::Lazy, _) if self.level.uses_rolling_hash() => {
                self.compress_lazily::<true>(io, flush, tuning)
            }
            (Method::Lazy, _) => self.compress_lazily::<false>(io, flush, tuning),
        }
    }

    fn write_flush_marker(&mut self, flush: Flush) {
        match flush {
            Flush::Partial => {
                self.pending.put(Bits::block_header(STATIC, false));
                self.pending.put(encoding::FIXED.end_of_block());
            }
            Flush::Sync => self.pending.write_stored_header(0, false),
            Flush::Full => {
                self.pending.write_stored_header(0, false);
                self.forget_history();
            }
            Flush::None | Flush::Block | Flush::Finish => {}
        }
    }

    fn forget_history(&mut self) {
        /// Up to here it is faster than zeroing all 128 KB.
        const MAX_REHASHED: u32 = 2048;
        match core::mem::replace(&mut self.hashed, Hashed::Nothing) {
            Hashed::Nothing => {}
            Hashed::FirstInput if self.window.end <= MAX_REHASHED => {
                let len = (self.window.end + HASHED_LEN - 1) as usize;
                let hashed = self.window.bytes.get(..len).unwrap_or_default();
                self.chains.clear_hashes_of(hashed);
            }
            _ => self.chains.clear(),
        }
        self.window.rewind();
    }

    fn hash_all(&mut self, start: u32, len: u32) {
        let mut index = self.chains.over(&self.window.bytes);
        if self.level.uses_rolling_hash() {
            index.insert_all::<true>(start, len);
        } else {
            index.insert_all::<false>(start, len);
        }
    }

    fn read_into_window(&mut self, io: &mut Io<'_, '_>) {
        let input = io.take_input(self.window.room());
        self.window.append(input, &mut self.checksum);
    }

    /// There is `MIN_LOOKAHEAD` afterwards, or no more input.
    fn fill_window(&mut self, io: &mut Io<'_, '_>) {
        // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate.c#L1175
        if self.window.position >= self.window.slide_position() {
            self.window.slide(self.window.size);
            self.lazy.slide(self.window.size);
            self.chains.slide(self.window.size);
            self.hashed = Hashed::More;
        }
        if io.input.is_empty() {
            return;
        }
        let is_first = self.window.end == 0 && self.hashed == Hashed::Nothing;
        self.hashed = if is_first && !self.level.uses_rolling_hash() {
            Hashed::FirstInput
        } else {
            Hashed::More
        };
        self.read_into_window(io);
        self.chains.grow(self.window.end);

        let (lookahead, unhashed) = (self.window.lookahead(), self.window.unhashed);
        if lookahead + unhashed >= MIN_MATCH_LEN as u32 {
            let start = self.window.position - unhashed;
            let mut index = self.chains.over(&self.window.bytes);
            if self.level.uses_rolling_hash() {
                index.restart_rolling_hash(start);
            } else if start != 0 {
                index.insert_at(start - 1);
            }
            let len = unhashed - u32::from(lookahead == 1);
            if len != 0 {
                self.hash_all(start, len);
                self.window.unhashed -= len;
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

    /// `step` goes no further than the position it is given. Both return `false` if input or room is wanted.
    #[inline(always)]
    fn in_stretches(
        &mut self,
        io: &mut Io<'_, '_>,
        flush: Flush,
        lookahead: u32,
        mut step: impl FnMut(&mut Self, &mut Io<'_, '_>, u32) -> bool,
    ) -> bool {
        loop {
            match self.next_stretch(io, flush, lookahead) {
                Stretch::Until(stop) if step(self, io, stop) => {}
                Stretch::Until(_) | Stretch::NeedsInput => return false,
                Stretch::End => return true,
            }
        }
    }

    /// The same for a `fill` that also stops when the block is full.
    #[inline(always)]
    fn fill_blocks(
        &mut self,
        io: &mut Io<'_, '_>,
        flush: Flush,
        lookahead: u32,
        mut fill: impl FnMut(&mut Self, u32),
    ) -> bool {
        self.in_stretches(io, flush, lookahead, |this, io, stop| {
            fill(this, stop);
            !this.block.is_full() || this.flush_block(io, false)
        })
    }

    /// Whether there is room left.
    fn flush_block(&mut self, io: &mut Io<'_, '_>, is_last: bool) -> bool {
        let only_fixed = self.strategy == Strategy::Fixed;
        self.block
            .write(&mut self.pending, self.window.block(), only_fixed, is_last);
        if is_last {
            self.pending.pad_to_byte_boundary();
        }
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

/// Enough for nearly any input, with the largest window.
fn expected_max_len(input_len: usize, container: Container) -> usize {
    // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate.c#L725
    let block = if input_len < 9 { 5 } else { 3 };
    let container = match container {
        Container::Raw => 0,
        Container::Zlib => 6,
        Container::Gzip => 18,
    };
    input_len.saturating_add(input_len.div_ceil(8) + block + container)
}

/// Appends a whole stream to `out`.
pub fn compress(
    input: &[u8],
    out: &mut Vec<u8>,
    container: Container,
    options: Options,
) -> Result<()> {
    let mut deflater = Deflater::new(container, options)?;
    out.try_reserve_exact(expected_max_len(input.len(), container))?;
    deflater.deflate_to_vec(input, out, Flush::Finish)
}

enum Stretch {
    Until(u32),
    NeedsInput,
    /// There is a flush, and nothing is left.
    End,
}
