//! Results and error codes are those of google/brotli 1.2, which `node:zlib` exposes.

mod bit_reader;
mod commands;
mod context_map;
mod huffman;
mod prefix_code;
mod ring_buffer;

use crate::context::{ContextLut, ContextMode, DISTANCE_CONTEXTS, LITERAL_CONTEXTS};
use crate::format::{
    Alphabet, BLOCK_LENGTH_CODES, DistanceParams, LARGE_MAX_WINDOW_BITS, MAX_BLOCK_TYPES,
    MAX_DICTIONARY_SIZE, MIN_WINDOW_BITS, max_backward_distance,
};
use crate::{DecodeError, memory};
use bit_reader::{BitReader, Bits};
use bun_core::vec::BorrowedCursor;
use commands::{Command, Cursor, push_command_tree, push_distance_tree};
use context_map::ContextMap;
use huffman::{Forest, Ranges, Root, Symbol, read_symbol};
use prefix_code::PrefixCodeReader;
use ring_buffer::RingBuffer;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeStatus {
    /// What is left of the input is not part of the stream.
    Finished,
    /// All of the input is used up. See [`Decoder::has_more_output`].
    NeedsInput,
    NeedsOutput,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Stop {
    NeedsInput,
    NeedsOutput,
    Failed(DecodeError),
}

impl Stop {
    const UNREACHABLE: Self = Self::Failed(DecodeError::Unreachable);
}

impl From<DecodeError> for Stop {
    fn from(error: DecodeError) -> Self {
        Self::Failed(error)
    }
}

#[derive(Clone, Copy)]
enum Category {
    Literal,
    Command,
    Distance,
}

impl Category {
    fn next(self) -> Option<Self> {
        match self {
            Self::Literal => Some(Self::Command),
            Self::Command => Some(Self::Distance),
            Self::Distance => None,
        }
    }

    fn of<T>(self, [literal, command, distance]: &mut [T; 3]) -> &mut T {
        match self {
            Self::Literal => literal,
            Self::Command => command,
            Self::Distance => distance,
        }
    }
}

#[derive(Clone, Copy)]
enum State {
    StreamHeader,
    MetaBlockHeader,
    Metadata,
    Uncompressed,
    BlockTypeCount(Category),
    BlockTypeCode(Category),
    BlockLengthCode(Category),
    FirstBlockLength(Category),
    DistanceParams,
    ContextModes(usize),
    LiteralContextMap,
    DistanceContextMap,
    Trees(Category),
    Commands,
    Copy { distance: usize, length: usize },
    CopyFromDictionary { offset: usize, length: usize },
    RingLimit(Resume),
    MetaBlockDone,
    Done,
    Failed(DecodeError),
}

/// What comes after [`State::RingLimit`].
#[derive(Clone, Copy)]
enum Resume {
    Uncompressed,
    Commands,
    Copy { distance: usize, length: usize },
    CopyFromDictionary { offset: usize, length: usize },
}

/// RFC 7932 section 6, for one category.
#[derive(Clone, Copy)]
struct Blocks {
    type_count: u32,
    /// The tree for the types. The one for the lengths comes next.
    first_tree: usize,
    last_types: [u32; 2],
    remaining: u32,
}

impl Blocks {
    const SINGLE: Self = Self {
        type_count: 1,
        first_tree: 0,
        last_types: [1, 0],
        remaining: 1 << 24,
    };

    fn current(&self) -> usize {
        self.last_types[1] as usize
    }

    #[inline(always)]
    fn read_length(&self, forest: &Forest<Symbol>, bits: &mut Bits) -> Result<u32, Stop> {
        let symbol = read_symbol(forest.tree(self.first_tree + 1)?, bits)?;
        let code = BLOCK_LENGTH_CODES
            .get(symbol as usize)
            .ok_or(Stop::UNREACHABLE)?;
        Ok(u32::from(code.base) + bits.read(u32::from(code.extra_bits))?)
    }

    #[inline(always)]
    fn switch(&mut self, forest: &Forest<Symbol>, reader: &mut BitReader<'_>) -> Result<(), Stop> {
        core::hint::cold_path();
        reader.refill();
        let taken = self.switch_with(forest, reader.bits)?;
        reader.bits.skip_known(taken);
        Ok(())
    }

    /// Returns how many of `bits` it took.
    #[inline(never)]
    fn switch_with(&mut self, forest: &Forest<Symbol>, bits: Bits) -> Result<u32, Stop> {
        if self.type_count == 1 {
            return Err(DecodeError::BlockSwitch.into());
        }
        let mut rest = bits;
        let symbol = read_symbol(forest.tree(self.first_tree)?, &mut rest)?;
        let length = self.read_length(forest, &mut rest)?;
        let [second_last, last] = self.last_types;
        let mut next = match symbol {
            0 => second_last,
            1 => last + 1,
            _ => symbol - 2,
        };
        if next >= self.type_count {
            next -= self.type_count;
        }
        self.last_types = [last, next];
        self.remaining = length;
        Ok(bits.count() - rest.count())
    }
}

/// Of output for each literal tree. With less, the larger tables take more time to fill than they save.
const BYTES_FOR_WIDE_ROOT: usize = 512;

pub struct Decoder {
    state: State,
    bits: Bits,
    large_window: bool,
    whole_window: bool,
    dictionary: Vec<u8>,
    max_backward_distance: usize,
    ring: RingBuffer,
    cursor: Cursor,

    is_last: bool,
    /// Of the meta-block, less the whole of what the current command began to write.
    remaining: isize,
    distance_params: DistanceParams,
    /// `None` for the block types that have one tree for all contexts.
    context_modes: [Option<ContextMode>; MAX_BLOCK_TYPES],
    literal_map: ContextMap,
    distance_map: ContextMap,
    codes: PrefixCodeReader,
    /// For commands and distances.
    ranges: Forest<Ranges>,
    /// For everything else.
    symbols: Forest<Symbol>,
    first_trees: [usize; 3],
    literal_root: Root,
    /// Blocks in another mode are left to the slow loop.
    lut_in_trees: &'static ContextLut,
}

impl Default for Decoder {
    fn default() -> Self {
        Self {
            state: State::StreamHeader,
            bits: Bits::default(),
            large_window: false,
            whole_window: false,
            dictionary: Vec::new(),
            max_backward_distance: 0,
            ring: RingBuffer::default(),
            cursor: Cursor::default(),
            is_last: false,
            remaining: 0,
            distance_params: DistanceParams::new(0, 0, false),
            context_modes: [None; MAX_BLOCK_TYPES],
            literal_map: ContextMap::default(),
            distance_map: ContextMap::default(),
            codes: PrefixCodeReader::new(),
            ranges: Forest::default(),
            symbols: Forest::default(),
            first_trees: [0; 3],
            literal_root: Root::Narrow,
            lut_in_trees: ContextMode::Utf8.lut(),
        }
    }
}

impl Decoder {
    /// `key` is a `BROTLI_DECODER_PARAM_*` of `node:zlib`. Fails once decoding has begun.
    pub fn set_parameter(&mut self, key: u32, value: u32) -> bool {
        if !matches!(self.state, State::StreamHeader) {
            return false;
        }
        match key {
            0 => self.whole_window = value != 0,
            1 => self.large_window = value != 0,
            _ => return false,
        }
        true
    }

    /// `None` if the dictionary is above 1 GiB, or too large for the memory.
    pub fn with_dictionary(dictionary: &[u8]) -> Option<Self> {
        if dictionary.len() > MAX_DICTIONARY_SIZE {
            return None;
        }
        Some(Self {
            dictionary: memory::copied(dictionary).ok()?,
            ..Self::default()
        })
    }

    pub fn has_more_output(&self) -> bool {
        !matches!(self.state, State::Failed(_)) && self.ring.has_unflushed()
    }

    /// Advances `input` by what it consumed. After an error, every call returns that error.
    #[inline(never)]
    pub fn decompress(
        &mut self,
        input: &mut &[u8],
        mut output: BorrowedCursor<'_, u8>,
    ) -> Result<DecodeStatus, DecodeError> {
        bun_removable_features::removable_definition!(BrotliDecoder, Self::decompress);
        let mut reader = BitReader::new(self.bits, input);
        let mut result = self.run(&mut reader, &mut output);
        if result == Err(Stop::NeedsInput)
            && let Err(failure @ Stop::Failed(_)) = self.flush(&mut output)
        {
            result = Err(failure);
        }
        let (bits, used) = reader.finish(input.len(), result != Err(Stop::NeedsInput));
        self.bits = bits;
        *input = input.split_at(used).1;
        match result {
            Ok(()) => Ok(DecodeStatus::Finished),
            Err(Stop::NeedsInput) => Ok(DecodeStatus::NeedsInput),
            Err(Stop::NeedsOutput) => Ok(DecodeStatus::NeedsOutput),
            Err(Stop::Failed(error)) => {
                self.state = State::Failed(error);
                Err(error)
            }
        }
    }

    fn run(
        &mut self,
        reader: &mut BitReader<'_>,
        output: &mut BorrowedCursor<'_, u8>,
    ) -> Result<(), Stop> {
        // With short buffers, calls tend to end in the state that they begin in.
        match self.state {
            State::Commands => self.state = self.decode_commands(reader)?,
            State::Uncompressed => self.state = self.copy_uncompressed(reader)?,
            State::RingLimit(resume) => self.state = self.move_ring_limit(resume, output)?,
            State::Done => return self.flush(output),
            _ => {}
        }
        self.run_on(reader, output)
    }

    #[inline(never)]
    fn run_on(
        &mut self,
        reader: &mut BitReader<'_>,
        output: &mut BorrowedCursor<'_, u8>,
    ) -> Result<(), Stop> {
        loop {
            self.state = match self.state {
                State::StreamHeader => {
                    let (window_bits, large_window) =
                        reader.step(|bits| read_window_bits(bits, self.large_window))?;
                    self.large_window = large_window;
                    self.max_backward_distance = max_backward_distance(window_bits);
                    self.ring.set_window_bits(window_bits);
                    State::MetaBlockHeader
                }
                State::MetaBlockHeader => self.read_meta_block_header(reader)?,
                State::Metadata => {
                    self.remaining -=
                        reader.take_buffered_bytes(self.remaining as usize).1 as isize;
                    if self.remaining != 0 {
                        self.remaining -= reader.take_bytes(self.remaining as usize).len() as isize;
                        if self.remaining != 0 {
                            return Err(Stop::NeedsInput);
                        }
                    }
                    State::MetaBlockDone
                }
                State::Uncompressed => self.copy_uncompressed(reader)?,
                State::BlockTypeCount(category) => {
                    let type_count = reader.step(read_count)?;
                    *category.of(&mut self.cursor.blocks) = Blocks {
                        type_count,
                        first_tree: self.symbols.len(),
                        ..Blocks::SINGLE
                    };
                    if type_count == 1 {
                        after_blocks_of(category)
                    } else {
                        State::BlockTypeCode(category)
                    }
                }
                State::BlockTypeCode(category) => {
                    let alphabet = Alphabet::new(self.type_count(category) as u32 + 2);
                    self.symbols
                        .push_symbols(self.codes.read(alphabet, reader)?)?;
                    State::BlockLengthCode(category)
                }
                State::BlockLengthCode(category) => {
                    let code = self.codes.read(Alphabet::BLOCK_LENGTHS, reader)?;
                    self.symbols.push_symbols(code)?;
                    State::FirstBlockLength(category)
                }
                State::FirstBlockLength(category) => {
                    let blocks = category.of(&mut self.cursor.blocks);
                    blocks.remaining =
                        reader.step(|bits| blocks.read_length(&self.symbols, bits))?;
                    after_blocks_of(category)
                }
                State::DistanceParams => {
                    let bits = reader.read(6)?;
                    let (postfix_bits, direct_msb) = (bits % 4, bits / 4);
                    let direct_codes = direct_msb << postfix_bits;
                    self.distance_params =
                        DistanceParams::new(postfix_bits, direct_codes, self.large_window);
                    State::ContextModes(0)
                }
                State::ContextModes(next) => {
                    let count = self.type_count(Category::Literal);
                    let modes = self.context_modes.iter_mut().enumerate();
                    for (index, mode) in modes.take(count).skip(next) {
                        self.state = State::ContextModes(index);
                        reader.refill_for(2);
                        *mode = Some(ContextMode::from_bits(reader.bits.read(2)?));
                    }
                    State::LiteralContextMap
                }
                State::LiteralContextMap => {
                    let size = self.type_count(Category::Literal) * LITERAL_CONTEXTS;
                    self.literal_map
                        .read(size, reader, &mut self.codes, &mut self.symbols)?;
                    let maps = self.literal_map.trees.as_chunks::<LITERAL_CONTEXTS>().0;
                    let has_one_tree = self.literal_map.tree_count == 1;
                    for (mode, map) in self.context_modes.iter_mut().zip(maps) {
                        mode.take_if(|_| has_one_tree || *map == [map[0]; _]);
                    }
                    let modes = self.context_modes.iter().take(maps.len());
                    if let Some(mode) = modes.flatten().next() {
                        self.lut_in_trees = mode.lut();
                    }
                    State::DistanceContextMap
                }
                State::DistanceContextMap => {
                    let size = self.type_count(Category::Distance) * DISTANCE_CONTEXTS;
                    self.distance_map
                        .read(size, reader, &mut self.codes, &mut self.symbols)?;
                    let literals = self.literal_map.tree_count as usize;
                    let commands = self.type_count(Category::Command);
                    let distances = self.distance_map.tree_count as usize;
                    self.literal_root = if self.remaining as usize >= literals * BYTES_FOR_WIDE_ROOT
                    {
                        Root::Wide
                    } else {
                        Root::Narrow
                    };
                    let bytes = literals * Alphabet::LITERALS.size as usize;
                    let ranges = commands * Alphabet::COMMANDS.size as usize
                        + distances * self.distance_params.alphabet.size as usize;
                    (self.symbols.try_reserve(literals, bytes, self.literal_root))
                        .and_then(|()| {
                            (self.ranges).try_reserve(commands + distances, ranges, Root::Narrow)
                        })
                        .map_err(|_| DecodeError::AllocTreeGroups)?;
                    self.first_trees = [self.symbols.len(), 0, commands];
                    State::Trees(Category::Literal)
                }
                State::Trees(category) => {
                    self.read_trees(category, reader)?;
                    match category.next() {
                        Some(next) => State::Trees(next),
                        None => {
                            self.ring
                                .begin_meta_block(self.remaining as usize, self.whole_window)
                                .map_err(|_| DecodeError::AllocRingBuffer2)?;
                            self.ring.grow();
                            self.cursor.command = Command::default();
                            State::Commands
                        }
                    }
                }
                State::Commands => self.decode_commands(reader)?,
                State::Copy { distance, length } => {
                    let length = length - self.ring.copy_part(distance, length)?;
                    self.resume_below_limit(Resume::Copy { distance, length })
                }
                State::CopyFromDictionary { offset, length } => {
                    let bytes = self
                        .dictionary
                        .get(offset..offset + length)
                        .ok_or(Stop::UNREACHABLE)?;
                    let copied = self.ring.append(bytes)?;
                    self.resume_below_limit(Resume::CopyFromDictionary {
                        offset: offset + copied,
                        length: length - copied,
                    })
                }
                State::RingLimit(resume) => self.move_ring_limit(resume, output)?,
                State::MetaBlockDone => {
                    if self.remaining < 0 {
                        return Err(DecodeError::BlockLength2.into());
                    }
                    if !self.is_last {
                        State::MetaBlockHeader
                    } else if reader.skip_to_byte_boundary() {
                        State::Done
                    } else {
                        return Err(DecodeError::Padding2.into());
                    }
                }
                State::Done => return self.flush(output),
                State::Failed(error) => return Err(error.into()),
            };
        }
    }

    fn type_count(&mut self, category: Category) -> usize {
        category.of(&mut self.cursor.blocks).type_count as usize
    }

    fn read_meta_block_header(&mut self, reader: &mut BitReader<'_>) -> Result<State, Stop> {
        let (is_last, length, next) = reader.step(|bits| {
            let is_last = bits.read_flag()?;
            if is_last && bits.read_flag()? {
                return Ok((is_last, 0, State::MetaBlockDone));
            }
            let nibbles = bits.read(2)? + 4;
            if nibbles == 7 {
                return Ok((is_last, read_metadata_length(bits)?, State::Metadata));
            }
            let length = bits.read(nibbles * 4)?;
            if nibbles > 4 && length >> ((nibbles - 1) * 4) == 0 {
                return Err(DecodeError::ExuberantNibble.into());
            }
            let next = if !is_last && bits.read_flag()? {
                State::Uncompressed
            } else {
                State::BlockTypeCount(Category::Literal)
            };
            Ok((is_last, length + 1, next))
        })?;
        self.is_last = is_last;
        self.remaining = length as isize;
        self.ranges.clear();
        self.symbols.clear();
        if matches!(next, State::Metadata | State::Uncompressed) && !reader.skip_to_byte_boundary()
        {
            return Err(DecodeError::Padding1.into());
        }
        if matches!(next, State::Uncompressed) {
            self.ring
                .begin_meta_block(length as usize, self.whole_window)
                .map_err(|_| DecodeError::AllocRingBuffer1)?;
        }
        Ok(next)
    }

    fn read_trees(&mut self, category: Category, reader: &mut BitReader<'_>) -> Result<(), Stop> {
        let first = *category.of(&mut self.first_trees);
        match category {
            Category::Literal => {
                while self.symbols.len() < first + self.literal_map.tree_count as usize {
                    let code = self.codes.read(Alphabet::LITERALS, reader)?;
                    (self.symbols).push_literals(code, self.literal_root, self.lut_in_trees)?;
                }
            }
            Category::Command => {
                while self.ranges.len() < first + self.type_count(category) {
                    let code = self.codes.read(Alphabet::COMMANDS, reader)?;
                    push_command_tree(&mut self.ranges, code)?;
                }
            }
            Category::Distance => {
                while self.ranges.len() < first + self.distance_map.tree_count as usize {
                    let code = self.codes.read(self.distance_params.alphabet, reader)?;
                    push_distance_tree(&mut self.ranges, code, &self.distance_params)?;
                }
            }
        }
        Ok(())
    }

    #[inline(always)]
    fn copy_uncompressed(&mut self, reader: &mut BitReader<'_>) -> Result<State, Stop> {
        let room = self.ring.size() - self.ring.position;
        let mut wanted = room.min(self.remaining as usize);
        let (buffered, count) = reader.take_buffered_bytes(wanted);
        if count != 0 {
            self.ring.append(buffered.split_at(count).0)?;
            self.remaining -= count as isize;
            wanted -= count;
        }
        if wanted != 0 {
            let copied = self.ring.append(reader.take_bytes(wanted))?;
            self.remaining -= copied as isize;
            if copied < wanted {
                return Err(Stop::NeedsInput);
            }
        }
        Ok(if self.ring.is_at_window_end() {
            State::RingLimit(Resume::Uncompressed)
        } else {
            State::MetaBlockDone
        })
    }

    #[inline(always)]
    fn move_ring_limit(
        &mut self,
        resume: Resume,
        output: &mut BorrowedCursor<'_, u8>,
    ) -> Result<State, Stop> {
        if self.ring.position >= self.ring.size() {
            match self.flush(output) {
                // A ring that can still grow does not have to be emptied.
                Err(Stop::NeedsOutput) if !self.ring.is_at_window_end() => {}
                result => result?,
            }
        }
        self.ring.grow();
        Ok(self.resume(resume))
    }

    fn flush(&mut self, output: &mut BorrowedCursor<'_, u8>) -> Result<(), Stop> {
        if self.remaining < 0 {
            return Err(DecodeError::BlockLength1.into());
        }
        self.ring.flush(output)
    }

    fn resume_below_limit(&self, resume: Resume) -> State {
        if self.ring.position >= self.ring.limit() {
            State::RingLimit(resume)
        } else {
            self.resume(resume)
        }
    }

    fn resume(&self, resume: Resume) -> State {
        match resume {
            Resume::Uncompressed => State::Uncompressed,
            Resume::Commands if self.cursor.command.unwritten_literals != 0 => State::Commands,
            Resume::Copy { distance, length } if length != 0 => State::Copy { distance, length },
            Resume::CopyFromDictionary { offset, length } if length != 0 => {
                State::CopyFromDictionary { offset, length }
            }
            _ if self.remaining <= 0 => State::MetaBlockDone,
            _ => State::Commands,
        }
    }
}

fn after_blocks_of(category: Category) -> State {
    category
        .next()
        .map_or(State::DistanceParams, State::BlockTypeCount)
}

/// Returns whether the stream has a large window, too.
fn read_window_bits(bits: &mut Bits, allow_large: bool) -> Result<(u32, bool), Stop> {
    if !bits.read_flag()? {
        return Ok((16, false));
    }
    let n = bits.read(3)?;
    if n != 0 {
        return Ok((17 + n, false));
    }
    match bits.read(3)? {
        0 => Ok((17, false)),
        1 if allow_large && !bits.read_flag()? => {
            let window_bits = bits.read(6)?;
            if (MIN_WINDOW_BITS..=LARGE_MAX_WINDOW_BITS).contains(&window_bits) {
                Ok((window_bits, true))
            } else {
                Err(DecodeError::WindowBits.into())
            }
        }
        1 => Err(DecodeError::WindowBits.into()),
        n => Ok((8 + n, false)),
    }
}

fn read_metadata_length(bits: &mut Bits) -> Result<u32, Stop> {
    if bits.read_flag()? {
        return Err(DecodeError::Reserved.into());
    }
    let bytes = bits.read(2)?;
    if bytes == 0 {
        return Ok(0);
    }
    let length = bits.read(bytes * 8)?;
    if bytes > 1 && length >> ((bytes - 1) * 8) == 0 {
        return Err(DecodeError::ExuberantMetaNibble.into());
    }
    Ok(length + 1)
}

/// A number in `1..=256`.
fn read_count(bits: &mut Bits) -> Result<u32, Stop> {
    if !bits.read_flag()? {
        return Ok(1);
    }
    let n = bits.read(3)?;
    Ok((1 << n) + bits.read(n)? + 1)
}
