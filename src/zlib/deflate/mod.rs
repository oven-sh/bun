//! Compression, with the parameters and the flushes of zlib-ng 2.3.3.

mod pending;
mod stored;

use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};
use bun_deflate::encoder::{Block, Effort, Method, Parser, Scratch, Window};
use bun_deflate::gzip;
use bun_highway::adler32;

use crate::checksum::Checksum;
use crate::error::{Error, Result};
use crate::format::{
    DEFLATE_METHOD, MAX_STORED_LEN, MAX_WINDOW_BITS, MIN_WINDOW_BITS, ZLIB_HEADER_DIVISOR,
    ZLIB_PRESET_DICTIONARY,
};
use pending::Pending;

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

    /// Of those between which zlib-ng changes within a block.
    fn group(self) -> u8 {
        match self.0 {
            3..=6 => 3,
            level => level.min(7),
        }
    }
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
    /// 1 to 9. Below 8, fewer batches of 8 KiB make a block, and stored blocks are shorter.
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

/// `None` stores.
fn method(level: Level, strategy: Strategy) -> Option<Method> {
    let (effort, min_len) = match level.0 {
        0 => return None,
        1 if strategy != Strategy::Fixed => (Effort::Lowest, 4),
        3..=4 if strategy == Strategy::Fixed => (Effort::Medium, 4),
        1..=2 => (Effort::Lower, 4),
        3..=4 => (Effort::Low, 4),
        5..=6 => (Effort::Medium, 4),
        7..=8 => (Effort::High, 4),
        _ => (Effort::Highest, 3),
    };
    Some(match strategy {
        Strategy::HuffmanOnly => Method::Literals,
        Strategy::Rle => Method::Runs,
        Strategy::Filtered if level.0 >= 7 => Method::Matches { effort, min_len: 6 },
        _ => Method::Matches { effort, min_len },
    })
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
    parser: Parser,
    block: Block,
    pending: Pending,
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
            window: Window::new(window_bits),
            parser: Parser::default(),
            block: Block::default(),
            pending: Pending::new(256 << options.memory_level),
        })
        .map_err(|_| Error::Alloc(bun_alloc::AllocError))
    }

    /// Not before it is needed.
    fn allocate(&mut self) -> Result<()> {
        if !self.window.has_memory() {
            (self.block).try_reserve(self.pending.size() * 3 / 16, usize::MAX)?;
            let mut window = Window::new(self.window.size.ilog2() as u8);
            window.try_reserve(usize::MAX)?;
            if let Some(method) = method(self.level, self.strategy) {
                self.parser.try_reserve(method, &window)?;
            }
            self.window = window;
        }
        Ok(())
    }

    /// For another stream, for which it is like a new one with the last parameters.
    pub fn reset(&mut self) {
        self.phase = Phase::Header {
            dictionary_id: None,
        };
        self.has_started = false;
        self.last_flush = None;
        self.forget_history();
        self.block.clear();
        self.pending.clear();
    }

    /// Before anything else. gzip has no dictionaries.
    pub fn set_dictionary(&mut self, dictionary: &[u8]) -> Result<()> {
        if self.has_started || self.window.end != Window::START || self.container == Container::Gzip
        {
            return Err(Error::InvalidState);
        }
        if dictionary.is_empty() {
            return Ok(());
        }
        self.allocate()?;
        self.phase = Phase::Header {
            dictionary_id: (self.container == Container::Zlib).then(|| adler32(dictionary)),
        };
        let start = dictionary.len().saturating_sub(self.window.size as usize);
        let used = dictionary.get(start..).unwrap_or_default();
        self.add_history(used);
        Ok(())
    }

    /// `false`, and nothing changes, if a block would have to be flushed first.
    pub fn set_params(&mut self, level: Level, strategy: Strategy) -> Result<bool> {
        // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/deflate.c#L589
        let changes_method = strategy != self.strategy || level.group() != self.level.group();
        if changes_method && self.has_started {
            if self.is_finishing() {
                return Err(Error::InvalidState);
            }
            if self.window.block_start != i64::from(self.window.end) {
                return Ok(false);
            }
        }
        if let (Some(method), true) = (method(level, strategy), self.window.has_memory()) {
            self.parser.try_reserve(method, &self.window)?;
        }
        if level.0 == 0 && self.level.0 != 0 {
            self.window.drop_what_is_too_far();
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
        self.pending.result()?;
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

    /// Appends a stream, which has not started, for all of `input`.
    pub fn deflate_whole(&mut self, input: &[u8], out: &mut Vec<u8>) -> Result<()> {
        out.try_reserve_exact(expected_max_len(input.len(), self.container))?;
        self.deflate_to_vec(input, out, Flush::Finish)
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
            self.write_header(dictionary_id, io);
            if !self.pending.has_no_bytes() {
                return Ok(false);
            }
        }

        if !is_finishing
            && (!io.input.is_empty() || self.window.lookahead() != 0 || flush != Flush::None)
        {
            // After a refusal, it is tried again.
            self.last_flush = last_flush;
            let is_all = flush == Flush::Finish && !self.window.has_memory();
            let progress = match method(self.level, self.strategy) {
                Some(method) if is_all && Scratch::has_memory_for(method, io.input.len()) => {
                    Scratch::lend(|it| self.compress_short(io, method, it))??
                }
                Some(method) => {
                    self.allocate()?;
                    Scratch::lend(|it| self.compress(io, flush, method, it))??
                }
                None => self.allocate().map(|()| self.store(io, flush))?,
            };
            self.last_flush = Some(flush);
            match progress {
                Progress::NeedsMore => return Ok(false),
                Progress::LastBlockPending => {
                    self.phase = Phase::Trailer;
                    return Ok(false);
                }
                Progress::LastBlockDone => self.phase = Phase::Trailer,
                Progress::BlockDone => {
                    self.write_flush_marker(flush, io);
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
                Checksum::Adler32(adler) => {
                    self.pending.write_bytes(&adler.to_be_bytes(), &mut io.out)
                }
                Checksum::Crc32 { crc, len } => {
                    self.pending
                        .write_bytes(&gzip::trailer_for(crc, len), &mut io.out);
                }
            }
        }
        Ok(self.pending.has_no_bytes())
    }

    fn write_header(&mut self, dictionary_id: Option<u32>, io: &mut Io<'_, '_>) {
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
                self.pending.write_bytes(&header.to_be_bytes(), &mut io.out);
                if let Some(id) = dictionary_id {
                    self.pending.write_bytes(&id.to_be_bytes(), &mut io.out);
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
                    .write_bytes(&gzip::plain_header(effort, SYSTEM), &mut io.out);
                self.checksum = Checksum::GZIP;
            }
        }
    }

    fn compress(
        &mut self,
        io: &mut Io<'_, '_>,
        flush: Flush,
        method: Method,
        scratch: &mut Scratch,
    ) -> Result<Progress> {
        loop {
            if !io.input.is_empty() && !self.window.has_room_for_batch() {
                let end = self.window.position;
                let len = i64::from(end) - self.window.block_start;
                if len > self.window.size.into()
                    && self.block.may_be_stored(len)
                    && !self.flush_block(io, end, false, scratch)
                {
                    return Ok(Progress::NeedsMore);
                }
                self.window.drop_what_is_too_far();
            }
            let wanted = Parser::wanted(&self.window);
            let has_enough = wanted <= io.input.len();
            self.read_into_window(io, wanted);
            if !has_enough && flush == Flush::None {
                return Ok(Progress::NeedsMore);
            }
            let start = self.window.position;
            if start == self.window.end {
                return Ok(self.flush_rest(io, flush, scratch));
            }
            if self.block.has_room(self.window.lookahead()) {
                let is_fixed = self.strategy == Strategy::Fixed;
                let (window, block) = (&mut self.window, &mut self.block);
                (self.parser)
                    .parse(method, window, !has_enough, is_fixed, scratch, block)
                    .ok_or(Error::Internal)?;
                if !self.block.has_ended() {
                    continue;
                }
            }
            if !self.flush_block(io, start, false, scratch) {
                return Ok(Progress::NeedsMore);
            }
        }
    }

    /// A whole stream that makes one block, so that nothing has to be kept.
    fn compress_short(
        &mut self,
        io: &mut Io<'_, '_>,
        method: Method,
        scratch: &mut Scratch,
    ) -> Result<Progress> {
        scratch.lend_memory(&mut self.window, &mut self.parser, &mut self.block);
        let progress = self.compress(io, Flush::Finish, method, scratch);
        scratch.take_memory(&mut self.window, &mut self.parser, &mut self.block);
        progress
    }

    fn write_flush_marker(&mut self, flush: Flush, io: &mut Io<'_, '_>) {
        match flush {
            Flush::Partial => self.pending.write_empty_block(&mut io.out),
            Flush::Sync => self.pending.write_stored_header(0, false, &mut io.out),
            Flush::Full => {
                self.pending.write_stored_header(0, false, &mut io.out);
                self.forget_history();
            }
            Flush::None | Flush::Block | Flush::Finish => {}
        }
    }

    fn forget_history(&mut self) {
        self.window.clear();
        self.parser.clear();
    }

    /// What needs no compressing. There is room for it.
    fn add_history(&mut self, bytes: &[u8]) {
        let room = self.window.extend(bytes.len());
        Checksum::None.copy(bytes, BorrowedBuf::from(room).unfilled());
        self.window.position = self.window.end;
        self.window.start_block();
    }

    fn read_into_window(&mut self, io: &mut Io<'_, '_>, max: usize) {
        let input = io.take_input(max);
        let room = self.window.extend(input.len());
        self.checksum
            .copy(input, BorrowedBuf::from(room).unfilled());
    }

    /// If the block ends there.
    fn has_fixed_codes(&self, end: u32) -> bool {
        self.strategy == Strategy::Fixed
            || method(self.level, self.strategy)
                .is_some_and(|it| self.parser.has_no_time_for_codes(it, &self.window, end))
    }

    /// In whichever way is shortest. It covers the window up to `end`. Returns whether there is room left.
    fn flush_block(
        &mut self,
        io: &mut Io<'_, '_>,
        end: u32,
        is_last: bool,
        scratch: &mut Scratch,
    ) -> bool {
        let plan = self.block.plan(self.has_fixed_codes(end), scratch);
        let len = plan.bits.div_ceil(8) as usize;
        match self.window.block(end) {
            Some(source) if source.len() + 4 < len && source.len() <= MAX_STORED_LEN => {
                self.pending
                    .write_stored_block(source, is_last, &mut io.out);
            }
            _ => self.pending.write(len, &mut io.out, |out, bits| {
                self.block.write(plan, is_last, out, bits)
            }),
        }
        if is_last {
            self.pending.pad_to_byte_boundary(&mut io.out);
        }
        self.block.start_next();
        self.window.block_start = end.into();
        !io.is_full()
    }

    /// When all of the input is in the block.
    fn flush_rest(&mut self, io: &mut Io<'_, '_>, flush: Flush, scratch: &mut Scratch) -> Progress {
        if flush == Flush::Finish {
            return if self.flush_block(io, self.window.end, true, scratch) {
                Progress::LastBlockDone
            } else {
                Progress::LastBlockPending
            };
        }
        if self.block.is_empty() || self.flush_block(io, self.window.end, false, scratch) {
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
    Deflater::new(container, options)?.deflate_whole(input, out)
}
