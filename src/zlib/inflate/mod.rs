//! Decompression.

mod bits;
mod codes;
mod tables;
mod window;

use bun_core::strings;
use bun_core::vec::{BorrowedBuf, BorrowedCursor, append_with};

use crate::checksum::{Checksum, adler32, crc32};
use crate::error::{Damage, Error, Result};
use crate::format::{
    CODE_LENGTH_ORDER, CODE_LENGTH_SYMBOLS, DEFLATE_METHOD, DISTANCE_SYMBOLS, DYNAMIC_BLOCK,
    END_OF_BLOCK, FIRST_LENGTH_SYMBOL, FIXED_BLOCK, GZIP_ID, LITERAL_LENGTH_SYMBOLS,
    MAX_CODE_LENGTH_BITS, MAX_WINDOW_BITS, MIN_WINDOW_BITS, REPEAT_FEW_ZEROS, REPEAT_MANY_ZEROS,
    REPEAT_PREVIOUS, STORED_BLOCK, ZLIB_HEADER_DIVISOR, ZLIB_PRESET_DICTIONARY, gzip_flag,
};
use bits::{BitReader, HeldBits};
use codes::{FAST_ROOM, Reach, Step, Stop};
use tables::{Coded, Tables};
use window::{MAX_DISTANCE, Window};

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
    CodeLengthCode(Counts),
    CodeLengths {
        counts: Counts,
        read: u16,
        last: u8,
    },
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

/// From the header of a dynamic block.
#[derive(Clone, Copy)]
struct Counts {
    literal_lengths: u16,
    distances: u8,
    code_lengths: u8,
    /// Read with the counts, as all 19 are too many bits for one go.
    first_code_length: u8,
}

/// An end-of-block code this long is a sign of a block that has enough symbols for better tables to pay off.
const LONG_BLOCK_END_BITS: usize = 10;

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
    /// Of the last dynamic block.
    tables: Option<Box<Tables>>,
    coded: Vec<Coded>,
}

/// The output of one call.
struct Output<'a, 'data> {
    buf: &'a mut BorrowedBuf<'data, u8>,
    /// So many bytes at its end did not come from the window.
    unrecorded: usize,
}

impl Output<'_, '_> {
    #[inline]
    fn room(&self) -> usize {
        self.buf.capacity() - self.buf.len()
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
            window: Window::default(),
            tables: None,
            coded: Vec::new(),
        }
    }

    /// For a stream that was written with a window of at most `1 << window_bits` bytes.
    pub fn with_window_bits(container: Container, window_bits: u8) -> Result<Self> {
        if !(MIN_WINDOW_BITS..=MAX_WINDOW_BITS).contains(&window_bits) {
            return Err(Error::InvalidParameter);
        }
        Ok(Self {
            window_bits,
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
        self.window.clear();
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
        self.add_to_history(dictionary.len());
        let recorded = self.window.record(dictionary);
        recorded.inspect_err(|&error| self.state = State::Failed(error))
    }

    /// Goes as far as it can, and advances `input` past what it has consumed. After an error only `reset()` helps.
    pub fn inflate(&mut self, input: &mut &[u8], out: BorrowedCursor<'_, u8>) -> Result<Status> {
        self.step(input, out, false)
    }

    /// The same, but stops behind the header and behind each block, like zlib's `Z_BLOCK`.
    pub fn inflate_block(
        &mut self,
        input: &mut &[u8],
        out: BorrowedCursor<'_, u8>,
    ) -> Result<Status> {
        self.step(input, out, true)
    }

    /// Like `inflate()`. Appends at most `max` bytes to `out`, which grows as needed.
    pub fn inflate_to_vec(
        &mut self,
        input: &mut &[u8],
        out: &mut Vec<u8>,
        max: usize,
    ) -> Result<Status> {
        const MIN_GROWTH: usize = 4096;
        let end = out.len().saturating_add(max);
        loop {
            let left = end - out.len();
            if out.len() == out.capacity() && out.try_reserve(left.min(MIN_GROWTH)).is_err() {
                out.try_reserve_exact(left.min(MIN_GROWTH + out.len() / 8))?;
            }
            let status = append_with(out, left, |out| self.inflate(input, out))?;
            if status != Status::NeedsOutput || out.len() == end {
                return Ok(status);
            }
        }
    }

    fn step(
        &mut self,
        input: &mut &[u8],
        mut out: BorrowedCursor<'_, u8>,
        stops_at_block: bool,
    ) -> Result<Status> {
        let mut bits = BitReader::resume(self.held, input);
        let result = out.with_unfilled_buf(|buf| {
            let mut out = Output { buf, unrecorded: 0 };
            let result = self.run(&mut bits, &mut out, stops_at_block);
            self.hand_out(&mut out);
            self.add_to_history(out.buf.len());
            let status = result?;
            if !matches!(self.state, State::Checksum | State::Length | State::Done) {
                self.record(&mut out)?;
            }
            Ok(status)
        });
        match result {
            Ok(Status::NeedsInput) => {}
            Ok(_) => bits.unread(),
            Err(error) => self.state = State::Failed(error),
        }
        (self.held, *input) = bits.suspend();
        result
    }

    fn add_to_history(&mut self, len: usize) {
        self.history = self.history.saturating_add(len).min(1 << self.window_bits);
    }

    #[inline]
    fn hand_out(&mut self, out: &mut Output<'_, '_>) {
        let bytes = self.window.hand_out(out.room());
        if !bytes.is_empty() {
            self.checksum.update(bytes);
            out.buf.unfilled().append(bytes);
        }
    }

    #[inline]
    fn record(&mut self, out: &mut Output<'_, '_>) -> Result<()> {
        if out.unrecorded == 0 {
            return Ok(());
        }
        let start = out.buf.len() - core::mem::take(&mut out.unrecorded);
        self.window
            .record(out.buf.filled().get(start..).unwrap_or_default())
    }

    fn add_to_header_crc(&mut self, bytes: &[u8]) {
        if self.gzip_flags & gzip_flag::HEADER_CRC != 0 {
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
        out: &mut Output<'_, '_>,
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
            if out.room() != 0 && self.pending_distance > self.history {
                self.window.drop_pending();
                return Err(Damage::DistanceTooFarBack.into());
            }
            self.hand_out(out);
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
                    if flags & gzip_flag::RESERVED != 0 {
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
                State::GzipExtraLength if self.gzip_flags & gzip_flag::EXTRA == 0 => {
                    State::GzipName
                }
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
                    if !self.skip_gzip_string(gzip_flag::NAME, bits) {
                        return Ok(Status::NeedsInput);
                    }
                    State::GzipComment
                }
                State::GzipComment => {
                    if !self.skip_gzip_string(gzip_flag::COMMENT, bits) {
                        return Ok(Status::NeedsInput);
                    }
                    State::GzipHeaderCrc
                }
                State::GzipHeaderCrc => {
                    if self.gzip_flags & gzip_flag::HEADER_CRC != 0
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
                    if bytes.is_empty() {
                        return Ok(if out.room() == 0 {
                            Status::NeedsOutput
                        } else {
                            Status::NeedsInput
                        });
                    }
                    self.checksum.update(bytes);
                    out.buf.unfilled().append(bytes);
                    out.unrecorded += bytes.len();
                    State::Stored(left - bytes.len() as u16)
                }
                State::CodeLengthCode(counts) => {
                    let lengths = take!(3 * (u32::from(counts.code_lengths) - 1)) << 3;
                    self.start_dynamic_block(lengths | u64::from(counts.first_code_length))?;
                    State::CodeLengths {
                        counts,
                        read: 0,
                        last: 0,
                    }
                }
                State::CodeLengths { counts, read, last } => {
                    if !self.read_code_lengths(bits, counts, read, last)? {
                        return Ok(Status::NeedsInput);
                    }
                    self.build_tables(counts)?;
                    State::Codes { fixed: false }
                }
                State::Codes { fixed } => match self.decode_codes(bits, out, fixed)? {
                    Status::BlockEnd => State::BlockBoundary,
                    status => return Ok(status),
                },

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
    fn read_block_header(&mut self, bits: &mut BitReader<'_>) -> Result<Option<State>> {
        const TYPE_END: u32 = 3;
        const COUNTS_END: u32 = TYPE_END + 14;
        if !bits.has(TYPE_END) {
            return Ok(None);
        }
        let is_last = bits.buffer % 2 != 0;
        let state = match (bits.peek(TYPE_END) / 2) as u32 {
            STORED_BLOCK => {
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
            FIXED_BLOCK => {
                bits.skip(TYPE_END);
                State::Codes { fixed: true }
            }
            DYNAMIC_BLOCK => {
                if !bits.has(COUNTS_END) {
                    return Ok(None);
                }
                let field = |start: u32, len: u32| (bits.buffer >> start) as u8 % (1 << len);
                let literal_lengths = FIRST_LENGTH_SYMBOL + usize::from(field(TYPE_END, 5));
                let distances = 1 + field(TYPE_END + 5, 5);
                let code_lengths = 4 + field(TYPE_END + 10, 4);
                if literal_lengths > LITERAL_LENGTH_SYMBOLS
                    || usize::from(distances) > DISTANCE_SYMBOLS
                {
                    return Err(Damage::TooManySymbols.into());
                }
                let Some(header) = bits.take(COUNTS_END + 3) else {
                    return Ok(None);
                };
                State::CodeLengthCode(Counts {
                    literal_lengths: literal_lengths as u16,
                    distances,
                    code_lengths,
                    first_code_length: (header >> COUNTS_END) as u8,
                })
            }
            _ => return Err(Damage::BlockType.into()),
        };
        self.is_last_block = is_last;
        Ok(Some(state))
    }

    /// `lengths` has three bits for each code length symbol, in the order of the stream.
    fn start_dynamic_block(&mut self, lengths: u64) -> Result<()> {
        let tables = match &mut self.tables {
            Some(tables) => tables,
            None => {
                self.coded
                    .try_reserve_exact(LITERAL_LENGTH_SYMBOLS + DISTANCE_SYMBOLS)?;
                let tables = Box::try_new(Tables::EMPTY).map_err(|_| bun_alloc::AllocError)?;
                self.tables.insert(tables)
            }
        };
        #[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
        const SHIFTS: [u8; CODE_LENGTH_SYMBOLS] = {
            let mut shifts = [0; _];
            let mut rank = 0;
            while rank < CODE_LENGTH_SYMBOLS {
                shifts[CODE_LENGTH_ORDER[rank] as usize] = 3 * rank as u8;
                rank += 1;
            }
            shifts
        };
        self.coded.clear();
        for (symbol, shift) in (0..).zip(SHIFTS) {
            let bits = (lengths >> shift) as u8 % 8;
            if bits != 0 {
                self.coded.push(Coded::new(symbol, bits));
            }
        }
        let is_valid = tables.build_code_length(&self.coded);
        self.coded.clear();
        Ok(is_valid.then_some(()).ok_or(Damage::CodeLengthsSet)?)
    }

    /// Whether all have been read.
    fn read_code_lengths(
        &mut self,
        bits: &mut BitReader<'_>,
        counts: Counts,
        mut read: u16,
        mut last: u8,
    ) -> Result<bool> {
        const MAX_BITS: u32 = MAX_CODE_LENGTH_BITS as u32 + REPEAT_MANY_ZEROS.extra_bits;
        let tables = self.tables.as_deref().ok_or(Error::Internal)?;
        let total = counts.literal_lengths + u16::from(counts.distances);
        while read < total {
            if bits.count < MAX_BITS {
                bits.refill();
            }
            let entry = tables.code_length(bits.buffer);
            let symbol = entry.first_literal();
            if symbol < REPEAT_PREVIOUS.symbol {
                if entry.bits() > bits.count {
                    break;
                }
                bits.skip(entry.bits());
                if symbol != 0 {
                    self.coded.push(Coded::new(read, symbol));
                }
                (read, last) = (read + 1, symbol);
                continue;
            }
            let repeat = match symbol - REPEAT_PREVIOUS.symbol {
                0 => REPEAT_PREVIOUS,
                1 => REPEAT_FEW_ZEROS,
                _ => REPEAT_MANY_ZEROS,
            };
            if entry.bits() + repeat.extra_bits > bits.count {
                break;
            }
            bits.skip(entry.bits());
            let end = read + (repeat.min + bits.peek(repeat.extra_bits) as u32) as u16;
            bits.skip(repeat.extra_bits);
            if symbol != REPEAT_PREVIOUS.symbol {
                last = 0;
            } else if read == 0 {
                return Err(Damage::BitLengthRepeat.into());
            }
            if end > total {
                return Err(Damage::BitLengthRepeat.into());
            }
            if last != 0 {
                self.coded
                    .extend((read..end).map(|symbol| Coded::new(symbol, last)));
            }
            read = end;
        }
        self.state = State::CodeLengths { counts, read, last };
        Ok(read == total)
    }

    fn build_tables(&mut self, counts: Counts) -> Result<()> {
        let tables = self.tables.as_deref_mut().ok_or(Error::Internal)?;
        let below = |symbol: u16| self.coded.partition_point(|it| it.symbol() < symbol);
        let end_of_block = self.coded.get(below(END_OF_BLOCK as u16));
        let end_of_block = end_of_block
            .filter(|it| usize::from(it.symbol()) == END_OF_BLOCK)
            .ok_or(Damage::MissingEndOfBlock)?;
        let (literal_lengths, distances) = self.coded.split_at(below(counts.literal_lengths));
        let is_long = end_of_block.bits() >= LONG_BLOCK_END_BITS;
        if !tables.build_literal_length(literal_lengths, is_long) {
            return Err(Damage::LiteralLengthsSet.into());
        }
        if !tables.build_distance(distances, counts.literal_lengths) {
            return Err(Damage::DistancesSet.into());
        }
        Ok(())
    }

    /// As in zlib, a full output does not keep it from reading up to the first symbol that there is no room for.
    fn decode_codes(
        &mut self,
        bits: &mut BitReader<'_>,
        out: &mut Output<'_, '_>,
        fixed: bool,
    ) -> Result<Status> {
        self.record(out)?;
        loop {
            if self.window.is_lap_over() {
                self.hand_out(out);
                self.window.start_lap()?;
            }
            let room = out.room() - self.window.pending();
            if self.window.end >= self.window.limit() {
                self.window
                    .grow(room.min(bits.rest.len().saturating_mul(4)))?;
            }
            let tables = match &self.tables {
                _ if fixed => &tables::FIXED,
                Some(tables) => tables,
                None => return Err(Error::Internal),
            };
            let window = &mut self.window;
            let reach = Reach {
                max: self.max_distance,
                available: self.history + out.buf.len() + window.pending(),
                from: window.end,
            };
            let (full, limit) = (window.end.saturating_add(room), window.limit());
            let fast_limit = limit.min(full.saturating_sub(FAST_ROOM - 1));
            let (bytes, end) = (window.bytes.as_mut_slice(), &mut window.end);
            if *end < fast_limit {
                match codes::decode_fast(tables, bits, bytes, end, fast_limit, reach)? {
                    Stop::EndOfBlock => return Ok(Status::BlockEnd),
                    Stop::Limit(distance) => self.pending_distance = distance,
                }
            }
            while *end <= full && *end < limit {
                self.pending_distance = match codes::decode_one(tables, bits, bytes, end, reach)? {
                    Step::NeedsInput => return Ok(Status::NeedsInput),
                    Step::EndOfBlock => return Ok(Status::BlockEnd),
                    Step::Literal => 0,
                    Step::Match(distance) => distance,
                    Step::OutOfReach if *end < full => {
                        return Err(Damage::DistanceTooFarBack.into());
                    }
                    Step::OutOfReach => {
                        self.state = State::TooFarBack;
                        return Ok(Status::NeedsOutput);
                    }
                };
            }
            if *end > full {
                return Ok(Status::NeedsOutput);
            }
        }
    }
}
