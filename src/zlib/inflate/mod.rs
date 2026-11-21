//! Decompression.

mod bits;
mod codes;
mod dynamic;
mod output;
mod tables;
mod window;

use core::cell::Cell;

use bun_core::strings;
use bun_core::vec::BorrowedCursor;
use bun_deflate::format::{DYNAMIC, MAX_MATCH_LEN, STATIC, STORED};
use bun_deflate::gzip;
use bun_highway::{adler32, crc32};

use crate::checksum::Checksum;
use crate::error::{Damage, Error, Result};
use crate::format::{
    DEFLATE_METHOD, GZIP_ID, MAX_WINDOW_BITS, MIN_WINDOW_BITS, ZLIB_HEADER_DIVISOR,
    ZLIB_PRESET_DICTIONARY,
};
use bits::{BitReader, HeldBits};
use codes::{FAST_INPUT, FAST_ROOM, Lap, LongestMatch, NoMatch, Reach, Step, Stop, Tape};
use dynamic::{Counts, DynamicCodes};
use output::{Growing, Output, Target};
use tables::Tables;
use window::{MAX_DISTANCE, SLACK, Window, whole_periods_len};

/// `inflate_to_vec()` is faster if the `Vec` has so much more capacity than the output needs.
pub const SPARE_CAPACITY: usize = SLACK;

/// What may be around the compressed data.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Container {
    Raw,
    Zlib,
    Gzip,
    ZlibOrGzip,
}

/// Why a call returned.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    /// All of the input has been consumed.
    NeedsInput,
    /// The output is full, and there is more to come.
    NeedsOutput,
    NeedsDictionary,
    /// Only from [`Inflater::inflate_block`].
    BlockEnd,
    /// What is left of the input does not belong to the stream.
    StreamEnd,
}

#[derive(Clone, Copy)]
enum State {
    Header,
    GzipFlags,
    GzipTimeAndSystem,
    GzipExtraLength,
    GzipExtra(u16),
    GzipName,
    GzipComment,
    GzipHeaderCrc,
    DictionaryId,
    Dictionary(u32),
    BlockBoundary,
    BlockHeader,
    Stored(u16),
    /// With the first of its lengths, as all 19 are too many bits for one go.
    CodeLengthCode(Counts, u8),
    CodeLengths(Counts),
    Codes {
        fixed: bool,
    },
    /// Fails when there is room for the match.
    TooFarBack,
    Checksum,
    Length,
    Done,
    Failed(Error),
}

pub struct Inflater {
    container: Container,
    window_bits: u8,
    verifies_adler32: bool,
    state: State,
    held: HeldBits,
    is_last_block: bool,
    gzip_flags: u8,
    gzip_header_crc: u32,
    checksum: Checksum,
    max_distance: usize,
    /// How much of the output of earlier calls a match may copy from.
    history: usize,
    /// Of the match that `window.pending()` is the rest of, or 0.
    pending_distance: usize,
    window: Window,
    run: Option<Run>,
    dynamic: DynamicCodes,
}

/// More periods leave a window that has nothing else as it is, so they are handed out without being written there.
#[derive(Clone, Copy)]
struct Run {
    repeated: LongestMatch,
    /// What has been read and not handed out.
    left: usize,
    /// How far the output is into a period.
    phase: usize,
}

fn current_tables(dynamic: &DynamicCodes, fixed: bool) -> Option<&Tables> {
    if fixed {
        Some(&tables::FIXED)
    } else {
        dynamic.tables()
    }
}

/// Of whole periods at the end of `bytes`, if there is more than one.
fn last_periods_len(bytes: &[u8], period: usize) -> Option<usize> {
    const REPEATED_LEN: usize = 256;
    let last = bytes.get(bytes.len().checked_sub(period + REPEATED_LEN)?..)?;
    last.starts_with(last.get(period..)?)
        .then(|| last.len() - last.len() % period)
}

/// Adds `len` bytes, for which there is room, to the whole periods that the last `periods_len` are.
fn append_periods(
    target: &mut impl Target,
    period: usize,
    mut periods_len: usize,
    mut len: usize,
    checksum: &mut Checksum,
) {
    /// And as much again that is being written.
    const CACHED_LEN: usize = 8 * 1024;
    while len != 0 {
        target.append_again(periods_len, len, checksum);
        len -= periods_len.min(len);
        periods_len = whole_periods_len(period, CACHED_LEN).min(2 * periods_len);
    }
}

/// Up to 23.
fn zlib_window_bits(header: [u8; 2]) -> Result<u8, Damage> {
    if !u16::from_be_bytes(header).is_multiple_of(ZLIB_HEADER_DIVISOR) {
        return Err(Damage::HeaderCheck);
    }
    if header[0] % 16 != DEFLATE_METHOD {
        return Err(Damage::UnknownMethod);
    }
    Ok(header[0] / 16 + MIN_WINDOW_BITS)
}

pub fn has_zlib_header(bytes: &[u8]) -> bool {
    let window_bits = bytes.first_chunk().copied().map(zlib_window_bits);
    matches!(window_bits, Some(Ok(..=MAX_WINDOW_BITS)))
}

impl Inflater {
    pub fn new(container: Container) -> Self {
        Self {
            container,
            window_bits: MAX_WINDOW_BITS,
            verifies_adler32: true,
            state: State::Header,
            held: HeldBits::default(),
            is_last_block: false,
            gzip_flags: 0,
            gzip_header_crc: 0,
            checksum: Checksum::None,
            max_distance: MAX_DISTANCE,
            history: 0,
            pending_distance: 0,
            window: Window::new(MAX_DISTANCE),
            run: None,
            dynamic: DynamicCodes::default(),
        }
    }

    /// For a stream that was written with a window of at most `1 << window_bits` bytes.
    pub fn with_window_bits(container: Container, window_bits: u8) -> Result<Self> {
        if !(MIN_WINDOW_BITS..=MAX_WINDOW_BITS).contains(&window_bits) {
            return Err(Error::InvalidParameter);
        }
        Ok(Self {
            window_bits,
            window: Window::new(1 << window_bits),
            ..Self::new(container)
        })
    }

    /// `window_bits` tells the container too, as for zlib's `inflateInit2()`.
    pub fn from_zlib_window_bits(window_bits: i32) -> Result<Self> {
        let container = match window_bits {
            -15..0 => Container::Raw,
            0..16 => Container::Zlib,
            16..32 => Container::Gzip,
            32..48 => Container::ZlibOrGzip,
            _ => return Err(Error::InvalidParameter),
        };
        match window_bits.unsigned_abs() % 16 {
            0 => Ok(Self::new(container)),
            bits => Self::with_window_bits(container, bits as u8),
        }
    }

    pub fn container(&self) -> Container {
        self.container
    }

    /// The trailer of a zlib stream still has to be there. To be called before anything is inflated.
    pub fn ignore_adler32(&mut self) {
        self.verifies_adler32 = false;
    }

    /// For another stream.
    pub fn reset(&mut self) {
        self.state = State::Header;
        self.held = HeldBits::default();
        self.is_last_block = false;
        self.checksum = Checksum::None;
        self.max_distance = MAX_DISTANCE;
        self.history = 0;
        self.pending_distance = 0;
        self.run = None;
        self.window.clear();
    }

    /// The same, if that is going to take a while.
    pub fn reset_and_wait(&mut self) {
        self.reset();
        self.window = Window::new(self.window_size());
        self.dynamic.free_memory();
    }

    /// After [`Status::NeedsDictionary`], or in front of a raw stream.
    pub fn set_dictionary(&mut self, dictionary: &[u8]) -> Result<()> {
        match self.state {
            State::Dictionary(id) if id != adler32(dictionary) => {
                return Err(Error::WrongDictionary);
            }
            State::Dictionary(_) => self.state = State::BlockBoundary,
            State::Header if self.container == Container::Raw => {}
            _ => return Err(Error::InvalidState),
        }
        self.history = (self.history + dictionary.len()).min(self.window_size());
        let recorded = self.window.record(dictionary, self.window_size());
        recorded.inspect_err(|&error| self.state = State::Failed(error))
    }

    /// Goes as far as it can, and advances `input` past what it has consumed. After an error only `reset()` helps.
    /// `out` is zeroed first unless it is initialized, and what is left of it afterwards may have been written to.
    pub fn inflate(&mut self, input: &mut &[u8], out: BorrowedCursor<'_, u8>) -> Result<Status> {
        self.inflate_to_cursor(input, out, false)
    }

    /// The same, but stops behind the header and behind each block, like zlib's `Z_BLOCK`.
    pub fn inflate_block(
        &mut self,
        input: &mut &[u8],
        out: BorrowedCursor<'_, u8>,
    ) -> Result<Status> {
        self.inflate_to_cursor(input, out, true)
    }

    fn inflate_to_cursor(
        &mut self,
        input: &mut &[u8],
        mut out: BorrowedCursor<'_, u8>,
        stops_at_block: bool,
    ) -> Result<Status> {
        out.ensure_init();
        out.with_unfilled_buf(|buf| self.step(input, buf, stops_at_block))
    }

    /// Like `inflate()` with room for `max` bytes behind the end of `out`, which grows as needed.
    pub fn inflate_to_vec(
        &mut self,
        input: &mut &[u8],
        out: &mut Vec<u8>,
        max: usize,
    ) -> Result<Status> {
        self.step(input, Growing::new(out, max), false)
    }

    /// The same, if more input is going to take a while.
    pub fn inflate_to_vec_and_wait(
        &mut self,
        input: &mut &[u8],
        out: &mut Vec<u8>,
        max: usize,
    ) -> Result<Status> {
        let status = self.inflate_to_vec(input, out, max)?;
        if status == Status::NeedsInput {
            self.wait_for_input();
        }
        Ok(status)
    }

    fn window_size(&self) -> usize {
        1 << self.window_bits
    }

    /// How much of what has been handed out is still needed.
    fn reach(&self) -> usize {
        self.history.min(self.max_distance)
    }

    #[inline(never)]
    fn step(
        &mut self,
        input: &mut &[u8],
        target: impl Target,
        stops_at_block: bool,
    ) -> Result<Status> {
        let mut bits = BitReader::resume(self.held, input);
        let mut out = Output {
            target,
            unrecorded: 0,
            unchecked: 0,
        };
        let result = self.fill(&mut bits, &mut out, stops_at_block);
        match result {
            Ok(Status::NeedsInput) => {}
            Ok(_) => bits.unread(),
            Err(error) => self.state = State::Failed(error),
        }
        (self.held, *input) = bits.suspend();
        result
    }

    #[inline(always)]
    fn fill(
        &mut self,
        bits: &mut BitReader<'_>,
        out: &mut Output<impl Target>,
        stops_at_block: bool,
    ) -> Result<Status> {
        if let State::Failed(error) = self.state {
            return Err(error);
        }
        if self.run.is_none() {
            self.window.resume(self.reach())?;
        }
        let status = loop {
            let result = self.run(bits, out, stops_at_block);
            self.hand_out(out);
            let status = result?;
            if status != Status::NeedsOutput || !out.target.grow()? {
                break status;
            }
        };
        let kept = self.window_size();
        self.history = self.history.saturating_add(out.len()).min(kept);
        if !matches!(self.state, State::Checksum | State::Length | State::Done) {
            self.record(out, kept)?;
        }
        // A server has many streams that wait between blocks.
        if let (Status::NeedsInput, State::BlockHeader) = (status, self.state) {
            self.wait_for_input();
        }
        Ok(status)
    }

    #[inline(always)]
    fn wait_for_input(&mut self) {
        self.window.shrink(self.reach());
        if let State::BlockHeader | State::Stored(_) | State::Codes { fixed: true } = self.state {
            self.dynamic.free_memory();
        }
    }

    #[inline(always)]
    fn hand_out(&mut self, out: &mut Output<impl Target>) {
        if self.window.pending() | out.unchecked != 0 {
            self.hand_out_pending(out);
        }
    }

    fn hand_out_pending(&mut self, out: &mut Output<impl Target>) {
        out.check(&mut self.checksum);
        let bytes = self.window.hand_out(out.room());
        out.target.append(bytes, &mut self.checksum);
    }

    #[inline]
    fn record(&mut self, out: &mut Output<impl Target>, max: usize) -> Result<()> {
        if out.unrecorded == 0 {
            return Ok(());
        }
        let start = out.len() - core::mem::take(&mut out.unrecorded);
        self.window
            .record(out.target.filled().get(start..).unwrap_or_default(), max)
    }

    fn add_to_header_crc(&mut self, bytes: &[u8]) {
        if self.gzip_flags & gzip::HAS_HEADER_CRC != 0 {
            self.gzip_header_crc = crc32(self.gzip_header_crc, bytes);
        }
    }

    /// Whether the zero at the end has been found.
    fn skip_gzip_string(&mut self, flag: u8, bits: &mut BitReader<'_>) -> bool {
        if self.gzip_flags & flag == 0 {
            return true;
        }
        bits.unread();
        let end = strings::index_of_char_usize(bits.rest, 0);
        let skipped = bits.take_bytes(end.map_or(usize::MAX, |end| end + 1));
        self.add_to_header_crc(skipped);
        end.is_some()
    }

    fn run(
        &mut self,
        bits: &mut BitReader<'_>,
        out: &mut Output<impl Target>,
        stops_at_block: bool,
    ) -> Result<Status> {
        macro_rules! take {
            ($count:expr) => {
                match bits.take($count) {
                    Some(bits) => bits,
                    None => return Ok(Status::NeedsInput),
                }
            };
        }

        if self.window.pending() != 0 {
            if out.room() != 0 && self.pending_distance > self.history + out.len() {
                self.window.drop_pending();
                return Err(Damage::DistanceTooFarBack.into());
            }
            self.hand_out_pending(out);
            if self.window.pending() != 0 {
                return Ok(Status::NeedsOutput);
            }
        }

        loop {
            self.state = match self.state {
                State::Header if self.container == Container::Raw => State::BlockHeader,
                State::Header => {
                    let header = (take!(16) as u16).to_le_bytes();
                    if header == GZIP_ID && self.container != Container::Zlib {
                        State::GzipFlags
                    } else {
                        self.read_zlib_header(header)?
                    }
                }
                State::GzipFlags => {
                    let [method, flags] = (take!(16) as u16).to_le_bytes();
                    if method != DEFLATE_METHOD {
                        return Err(Damage::UnknownMethod.into());
                    }
                    if flags & gzip::RESERVED != 0 {
                        return Err(Damage::UnknownHeaderFlags.into());
                    }
                    (self.gzip_flags, self.gzip_header_crc) = (flags, 0);
                    self.add_to_header_crc(&GZIP_ID);
                    self.add_to_header_crc(&[method, flags]);
                    State::GzipTimeAndSystem
                }
                State::GzipTimeAndSystem => {
                    let [fields @ .., _, _] = take!(48).to_le_bytes();
                    self.add_to_header_crc(&fields);
                    State::GzipExtraLength
                }
                State::GzipExtraLength if self.gzip_flags & gzip::HAS_EXTRA == 0 => State::GzipName,
                State::GzipExtraLength => {
                    let len = take!(16) as u16;
                    self.add_to_header_crc(&len.to_le_bytes());
                    State::GzipExtra(len)
                }
                State::GzipExtra(left) => {
                    let skipped = bits.take_bytes(left.into());
                    self.add_to_header_crc(skipped);
                    let left = left - skipped.len() as u16;
                    if left != 0 {
                        self.state = State::GzipExtra(left);
                        return Ok(Status::NeedsInput);
                    }
                    State::GzipName
                }
                State::GzipName => {
                    if !self.skip_gzip_string(gzip::HAS_NAME, bits) {
                        return Ok(Status::NeedsInput);
                    }
                    State::GzipComment
                }
                State::GzipComment => {
                    if !self.skip_gzip_string(gzip::HAS_COMMENT, bits) {
                        return Ok(Status::NeedsInput);
                    }
                    State::GzipHeaderCrc
                }
                State::GzipHeaderCrc => {
                    if self.gzip_flags & gzip::HAS_HEADER_CRC != 0
                        && take!(16) as u16 != self.gzip_header_crc as u16
                    {
                        return Err(Damage::HeaderCrc.into());
                    }
                    self.checksum = Checksum::GZIP;
                    State::BlockBoundary
                }
                State::DictionaryId => State::Dictionary((take!(32) as u32).swap_bytes()),
                State::Dictionary(_) => return Ok(Status::NeedsDictionary),

                State::BlockBoundary if stops_at_block => {
                    self.state = State::BlockHeader;
                    return Ok(Status::BlockEnd);
                }
                State::BlockBoundary | State::BlockHeader if self.is_last_block => {
                    bits.skip_to_byte_boundary();
                    self.hand_out(out);
                    State::Checksum
                }
                State::BlockBoundary | State::BlockHeader => {
                    self.state = State::BlockHeader;
                    match self.read_block_header(bits)? {
                        Some(state) => state,
                        None => return Ok(Status::NeedsInput),
                    }
                }
                State::Stored(0) => State::BlockBoundary,
                State::Stored(left) => {
                    self.hand_out(out);
                    let bytes = bits.take_bytes(out.room().min(left.into()));
                    out.target.append(bytes, &mut self.checksum);
                    out.unrecorded += bytes.len();
                    let left = left - bytes.len() as u16;
                    if left != 0 {
                        self.state = State::Stored(left);
                        return Ok(if out.room() == 0 {
                            Status::NeedsOutput
                        } else {
                            Status::NeedsInput
                        });
                    }
                    State::BlockBoundary
                }
                State::CodeLengthCode(counts, first) => {
                    let others = take!(counts.code_length_bits() - 3);
                    self.dynamic.start(others << 3 | u64::from(first))?;
                    State::CodeLengths(counts)
                }
                State::CodeLengths(counts) => {
                    if !self.dynamic.read_lengths(bits, counts)? {
                        return Ok(Status::NeedsInput);
                    }
                    self.dynamic.build_tables(counts, bits.rest.len())?;
                    State::Codes { fixed: false }
                }
                State::Codes { fixed } => {
                    let before = out.len() + self.window.pending();
                    let status = self.decode_codes(bits, out, fixed)?;
                    let after = out.len() + self.window.pending();
                    self.dynamic.add_decoded(after - before);
                    if status != Status::BlockEnd {
                        return Ok(status);
                    }
                    State::BlockBoundary
                }

                State::TooFarBack if out.room() == 0 => return Ok(Status::NeedsOutput),
                State::TooFarBack => return Err(Damage::DistanceTooFarBack.into()),

                State::Checksum if self.container == Container::Raw => State::Done,
                State::Checksum => {
                    let expected = take!(32) as u32;
                    let (is_right, next) = match self.checksum {
                        Checksum::None => (true, State::Done),
                        Checksum::Adler32(adler) => (expected.swap_bytes() == adler, State::Done),
                        Checksum::Crc32 { crc, .. } => (expected == crc, State::Length),
                    };
                    if !is_right {
                        return Err(Damage::DataCheck.into());
                    }
                    next
                }
                State::Length => {
                    let expected = take!(32) as u32;
                    if matches!(self.checksum, Checksum::Crc32 { len, .. } if len != expected) {
                        return Err(Damage::LengthCheck.into());
                    }
                    State::Done
                }
                State::Done => return Ok(Status::StreamEnd),
                State::Failed(error) => return Err(error),
            };
        }
    }

    fn read_zlib_header(&mut self, header: [u8; 2]) -> Result<State> {
        if self.container == Container::Gzip {
            return Err(Damage::HeaderCheck.into());
        }
        let window_bits = zlib_window_bits(header)?;
        if window_bits > self.window_bits {
            return Err(Damage::WindowSize.into());
        }
        // As with zlib's INFLATE_STRICT, which Node.js is built without.
        self.max_distance = 1 << window_bits;
        if self.verifies_adler32 {
            self.checksum = Checksum::ZLIB;
        }
        Ok(if header[1] & ZLIB_PRESET_DICTIONARY != 0 {
            State::DictionaryId
        } else {
            State::BlockBoundary
        })
    }

    /// Takes nothing if it returns `None`, for want of input.
    #[inline(always)]
    fn read_block_header(&mut self, bits: &mut BitReader<'_>) -> Result<Option<State>> {
        const TYPE_END: u32 = 3;
        const COUNTS_END: u32 = TYPE_END + Counts::BITS;
        /// Of a fixed block that has nothing but its end, which is 7 zeros.
        const EMPTY_END: u32 = TYPE_END + 7;
        if !bits.has(TYPE_END) {
            return Ok(None);
        }
        let is_last = bits.buffer % 2 != 0;
        let state = match (bits.peek(TYPE_END) / 2) as u32 {
            STORED => {
                let padded = TYPE_END + (bits.count - TYPE_END) % 8;
                if !bits.has(padded + 32) {
                    return Ok(None);
                }
                bits.skip(padded);
                let (len, complement) = (bits.buffer as u16, (bits.buffer >> 16) as u16);
                bits.skip(32);
                if len != !complement {
                    return Err(Damage::StoredLengths.into());
                }
                State::Stored(len)
            }
            STATIC if bits.has(EMPTY_END) && bits.peek(EMPTY_END) >> TYPE_END == 0 => {
                bits.skip(EMPTY_END);
                State::BlockBoundary
            }
            STATIC => {
                bits.skip(TYPE_END);
                State::Codes { fixed: true }
            }
            DYNAMIC => {
                if !bits.has(COUNTS_END) {
                    return Ok(None);
                }
                let counts = Counts::new(bits.buffer >> TYPE_END)?;
                let Some(header) = bits.take(COUNTS_END + 3) else {
                    return Ok(None);
                };
                State::CodeLengthCode(counts, (header >> COUNTS_END) as u8)
            }
            _ => return Err(Damage::BlockType.into()),
        };
        self.is_last_block = is_last;
        Ok(Some(state))
    }

    fn start_run(&self, bits: &mut BitReader<'_>, fixed: bool) -> Option<Run> {
        let repeated = LongestMatch::peek(current_tables(&self.dynamic, fixed)?, bits)?;
        // A lap is longer than any window, so this holds in later calls, too.
        let is_in_reach = repeated.distance <= self.max_distance.min(self.window_size());
        (is_in_reach && self.window.has_period(repeated.distance)).then_some(Run {
            repeated,
            left: 0,
            phase: 0,
        })
    }

    /// Whether it has ended.
    fn continue_run(
        &mut self,
        run: &mut Run,
        bits: &mut BitReader<'_>,
        out: &mut Output<impl Target>,
    ) -> bool {
        run.left = run.repeated.take_all(bits, run.left, out.room());
        let periods = self.window.periods(run.repeated.distance);
        while let len @ 1.. = run.left.min(out.room()) {
            let piece = periods.get(run.phase..).unwrap_or_default();
            let piece = piece.get(..len).unwrap_or(piece);
            out.target.append(piece, &mut self.checksum);
            run.left -= piece.len();
            run.phase = (run.phase + piece.len()) % run.repeated.distance;
        }
        run.left == 0
    }

    /// `false` if there is no room for what comes first.
    fn start_lap(
        &mut self,
        bits: &mut BitReader<'_>,
        out: &mut Output<impl Target>,
        fixed: bool,
    ) -> Result<bool> {
        self.hand_out(out);
        let Some(mut run) = self.run.take().or_else(|| self.start_run(bits, fixed)) else {
            return self.window.start_lap().map(|()| true);
        };
        if !self.continue_run(&mut run, bits, out) {
            self.run = Some(run);
            return Ok(false);
        }
        self.window.start_lap()?;
        self.window
            .record_part_of_period(run.repeated.distance, run.phase)?;
        Ok(true)
    }

    /// What follows stored blocks at the end of the input is often too little to need them. Whether it has ended.
    fn end_block_without_window(
        &mut self,
        bits: &mut BitReader<'_>,
        out: &mut Output<impl Target>,
        fixed: bool,
    ) -> bool {
        out.check(&mut self.checksum);
        while bits.rest.len() < FAST_INPUT
            && let Some(tables) = current_tables(&self.dynamic, fixed)
            && let Some(taken) = codes::take_unless_match(tables, bits, out.room())
        {
            let NoMatch::Literal(literals) = taken else {
                return true;
            };
            out.target.append(&literals[..1], &mut self.checksum);
            out.unrecorded += 1;
        }
        false
    }

    /// Whether all that a match may copy from is in the output, or about to be.
    #[inline(always)]
    fn is_all_in_output(&self, out: &Output<impl Target>) -> bool {
        self.history == 0 || out.len() + self.window.pending() >= self.max_distance
    }

    /// Leaves the window out. `None` if it takes the window to go on.
    #[inline(always)]
    fn decode_to_output(
        &mut self,
        bits: &mut BitReader<'_>,
        out: &mut Output<impl Target>,
        fixed: bool,
    ) -> Result<Option<Status>> {
        /// So that the checksum finds it in the cache.
        const STEP: usize = 16 * 1024;
        let pending = self.window.pending();
        if out.room() < pending + SLACK {
            out.target.grow_early(bits.rest.len());
        }
        // After several calls there is likely to be another, for which the window has to catch up.
        let worthwhile = match (self.history, out.unrecorded) {
            (1.., 0) => 2 * MAX_DISTANCE,
            _ => SLACK,
        };
        if out.room() < pending + worthwhile {
            return Ok(None);
        }
        if pending != 0 {
            self.hand_out_pending(out);
        }
        let tables = current_tables(&self.dynamic, fixed).ok_or(Error::Internal)?;
        // Not before a step has brought the checksum up to date, nor behind periods that have ended, as many are short.
        let mut looks_for_periods = false;
        while let (room @ SLACK.., start) = (out.room(), out.len()) {
            let result = if looks_for_periods
                && let Some(repeated) = LongestMatch::peek(tables, bits)
                && repeated.distance <= self.max_distance
                && let Some(periods_len) = last_periods_len(out.target.filled(), repeated.distance)
            {
                debug_assert_eq!(out.unchecked, 0);
                let len = repeated.take_all(bits, 0, room - MAX_MATCH_LEN);
                let (target, checksum) = (&mut out.target, &mut self.checksum);
                append_periods(target, repeated.distance, periods_len, len, checksum);
                looks_for_periods = len > room - MAX_MATCH_LEN;
                Ok(None)
            } else {
                let history = start.min(self.max_distance);
                let reach = Reach {
                    max: self.max_distance,
                    available: history,
                    from: history,
                };
                let distance = Cell::from_mut(&mut self.pending_distance);
                let result = out
                    .target
                    .decode(tables, bits, room.min(STEP), reach, distance);
                out.unchecked += out.len() - start;
                looks_for_periods = true;
                result
            };
            out.unrecorded += out.len() - start;
            let status = result?;
            if status.is_none() || out.unchecked >= STEP / 2 {
                out.check(&mut self.checksum);
            }
            if status.is_some() {
                return Ok(status);
            }
            if out.room() < SLACK {
                out.target.grow_early(bits.rest.len());
            }
        }
        Ok(None)
    }

    /// As in zlib, a full output does not keep it from reading up to the first symbol that there is no room for.
    fn decode_codes(
        &mut self,
        bits: &mut BitReader<'_>,
        out: &mut Output<impl Target>,
        fixed: bool,
    ) -> Result<Status> {
        loop {
            if out.unrecorded == 0
                && self.window.is_lap_over()
                && !self.start_lap(bits, out, fixed)?
            {
                return Ok(Status::NeedsOutput);
            }
            if self.is_all_in_output(out)
                && let Some(status) = self.decode_to_output(bits, out, fixed)?
            {
                return Ok(status);
            }
            if out.unrecorded != 0 {
                if self.end_block_without_window(bits, out, fixed) {
                    return Ok(Status::BlockEnd);
                }
                self.record(out, MAX_DISTANCE)?;
                continue;
            }
            let room = out.room() - self.window.pending();
            if self.window.end >= self.window.limit() {
                self.window
                    .grow(room.min(bits.rest.len().saturating_mul(4)))?;
            }
            let tables = current_tables(&self.dynamic, fixed).ok_or(Error::Internal)?;
            let window = &mut self.window;
            let reach = Reach {
                max: self.max_distance,
                available: self.history + out.len() + window.pending(),
                from: window.end,
            };
            let (full, limit) = (window.end.saturating_add(room), window.limit());
            let fast_limit = limit.min(full.saturating_sub(FAST_ROOM - 1));
            if window.end < fast_limit && bits.rest.len() >= FAST_INPUT {
                let filled = out.target.filled().as_ptr_range().end.addr();
                let offset = filled.wrapping_sub(window.pending_address());
                let distance = Cell::from_mut(&mut self.pending_distance);
                let slice = window.bytes_and_end();
                let stop = codes::decode_to_slice(
                    tables, bits, slice, fast_limit, offset, reach, distance,
                )?;
                if let Stop::EndOfBlock = stop {
                    return Ok(Status::BlockEnd);
                }
            }
            let mut lap = Lap::new(window.bytes_and_end(), limit, None)?;
            while lap.position() <= full && lap.room() >= SLACK {
                self.pending_distance = match codes::decode_one(tables, bits, &mut lap, reach)? {
                    Step::NeedsInput => return Ok(Status::NeedsInput),
                    Step::EndOfBlock => return Ok(Status::BlockEnd),
                    Step::Literal => 0,
                    Step::Match(distance) => distance,
                    Step::OutOfReach if lap.position() < full => {
                        return Err(Damage::DistanceTooFarBack.into());
                    }
                    Step::OutOfReach => {
                        self.state = State::TooFarBack;
                        return Ok(Status::NeedsOutput);
                    }
                };
            }
            if lap.position() > full {
                return Ok(Status::NeedsOutput);
            }
        }
    }
}
