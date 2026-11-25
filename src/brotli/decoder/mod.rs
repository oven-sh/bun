//! Results and error codes are those of google/brotli 1.2, which `node:zlib` exposes.

mod bit_reader;
mod commands;
mod context_map;
mod huffman;
mod prefix_code;
mod ring_buffer;
#[cfg(test)]
#[path = "../tests/decoder/mod.rs"]
mod tests;

use crate::context::{ContextMode, DISTANCE_CONTEXTS, LITERAL_CONTEXTS};
use crate::format::{
    Alphabet, BLOCK_LENGTH_CODES, DistanceParams, LARGE_MAX_WINDOW_BITS, MAX_BLOCK_TYPES,
    MAX_DICTIONARY_SIZE, MIN_WINDOW_BITS, max_backward_distance,
};
use crate::{DecodeError, memory};
use bit_reader::{BitReader, Bits};
use bun_core::vec::{BorrowedCursor, append_with};
use bun_highway::brotli_decoder::{self as machine, Distance, Root, Symbol, SymbolLists};
use commands::{Command, Cursor, push_command_tree, push_distance_tree};
use context_map::ContextMap;
use huffman::{Forest, read_symbol};
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

#[derive(Clone, Copy, Default)]
enum State {
    #[default]
    StreamHeader,
    MetaBlockHeader,
    Metadata,
    BeginUncompressed,
    Uncompressed,
    Header(Part),
    Commands,
    Copy {
        distance: usize,
        length: usize,
    },
    CopyFromDictionary {
        offset: usize,
        length: usize,
    },
    RingLimit(Resume),
    MetaBlockDone,
    Done,
    Failed(DecodeError),
}

/// Of the header of a compressed meta-block.
#[derive(Clone, Copy)]
enum Part {
    BlockTypeCount(Category),
    BlockTypeCode(Category),
    BlockLengthCode(Category),
    FirstBlockLength(Category),
    DistanceParams,
    ContextModes(usize),
    LiteralContextMap,
    DistanceContextMap,
    Trees(Category),
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

/// Larger roots save following links, but take longer to fill and leave less of the cache. In text, all codes are like the first.
fn root_for_literals(first: &SymbolLists, trees: usize, is_text: bool, length: usize) -> Root {
    let [for_9, for_10] = match trees {
        2.. if !is_text => [0, 2],
        4.. => [4, 8],
        _ => [1, 2],
    };
    if length >= 2048 * trees && first.percent_beyond(Root::Bits9) >= for_10 {
        Root::Bits10
    } else if length >= 512 * trees && first.percent_beyond(Root::Bits8) >= for_9 {
        Root::Bits9
    } else {
        Root::Bits8
    }
}

fn root_for_commands(first: &SymbolLists, trees: usize, length: usize) -> Root {
    let percent = if length > 1 << 16 { 10 } else { 3 };
    if length >= 6000 * trees && first.percent_beyond(Root::Bits9) >= percent {
        Root::Bits10
    } else if length >= 2000 * trees && first.percent_beyond(Root::Bits8) >= 3 {
        Root::Bits9
    } else {
        Root::Bits8
    }
}

/// What the header of a compressed meta-block describes.
struct Codes {
    distance_params: DistanceParams,
    /// `None` for the block types that have one tree for all contexts.
    context_modes: [Option<ContextMode>; MAX_BLOCK_TYPES],
    literal_map: ContextMap,
    distance_map: ContextMap,
    reader: PrefixCodeReader,
    commands: Forest<machine::Command>,
    distances: Forest<Distance>,
    /// For everything else.
    symbols: Forest<Symbol>,
    first_literal_tree: usize,
    literal_root: Root,
    command_root: Root,
    /// Blocks in another mode are left to the slow loop.
    mode_in_trees: ContextMode,
}

impl Codes {
    fn new() -> Result<Box<Self>, Stop> {
        Box::try_new(Self {
            distance_params: DistanceParams::new(0, 0, false),
            context_modes: [None; _],
            literal_map: ContextMap::default(),
            distance_map: ContextMap::default(),
            reader: PrefixCodeReader::new()?,
            commands: Forest::default(),
            distances: Forest::default(),
            symbols: Forest::default(),
            first_literal_tree: 0,
            literal_root: Root::Bits8,
            command_root: Root::Bits8,
            mode_in_trees: ContextMode::Utf8,
        })
        .map_err(|_| DecodeError::AllocTreeGroups.into())
    }

    /// For a meta-block of `length` bytes.
    #[inline(never)]
    fn read(
        &mut self,
        part: &mut Part,
        blocks: &mut [Blocks; 3],
        length: usize,
        large_window: bool,
        reader: &mut BitReader<'_>,
    ) -> Result<(), Stop> {
        loop {
            *part = match *part {
                Part::BlockTypeCount(category) => {
                    let type_count = reader.step(read_count)?;
                    *category.of(blocks) = Blocks {
                        type_count,
                        first_tree: self.symbols.len(),
                        ..Blocks::SINGLE
                    };
                    if type_count == 1 {
                        after_blocks_of(category)
                    } else {
                        Part::BlockTypeCode(category)
                    }
                }
                Part::BlockTypeCode(category) => {
                    let alphabet = Alphabet::new(category.of(blocks).type_count + 2);
                    self.symbols
                        .push_symbols(self.reader.read(alphabet, reader)?)?;
                    Part::BlockLengthCode(category)
                }
                Part::BlockLengthCode(category) => {
                    let code = self.reader.read(Alphabet::BLOCK_LENGTHS, reader)?;
                    self.symbols.push_symbols(code)?;
                    Part::FirstBlockLength(category)
                }
                Part::FirstBlockLength(category) => {
                    let blocks = category.of(blocks);
                    blocks.remaining =
                        reader.step(|bits| blocks.read_length(&self.symbols, bits))?;
                    after_blocks_of(category)
                }
                Part::DistanceParams => {
                    let bits = reader.read(6)?;
                    let (postfix_bits, direct_msb) = (bits % 4, bits / 4);
                    let direct_codes = direct_msb << postfix_bits;
                    self.distance_params =
                        DistanceParams::new(postfix_bits, direct_codes, large_window);
                    Part::ContextModes(0)
                }
                Part::ContextModes(next) => {
                    let count = Category::Literal.of(blocks).type_count as usize;
                    let modes = self.context_modes.iter_mut().enumerate();
                    for (index, mode) in modes.take(count).skip(next) {
                        *part = Part::ContextModes(index);
                        reader.refill_for(2);
                        *mode = Some(ContextMode::from_bits(reader.bits.read(2)?));
                    }
                    Part::LiteralContextMap
                }
                Part::LiteralContextMap => {
                    let size = Category::Literal.of(blocks).type_count as usize * LITERAL_CONTEXTS;
                    self.literal_map
                        .read(size, reader, &mut self.reader, &mut self.symbols)?;
                    let (modes, _) = self.context_modes.split_at_mut(size / LITERAL_CONTEXTS);
                    for (block_type, mode) in modes.iter_mut().enumerate() {
                        let map = self.literal_map.of::<LITERAL_CONTEXTS>(block_type);
                        mode.take_if(|_| *map == [map[0]; _]);
                    }
                    if let Some(&mode) = modes.iter().flatten().next() {
                        self.mode_in_trees = mode;
                    }
                    Part::DistanceContextMap
                }
                Part::DistanceContextMap => {
                    let size =
                        Category::Distance.of(blocks).type_count as usize * DISTANCE_CONTEXTS;
                    self.distance_map
                        .read(size, reader, &mut self.reader, &mut self.symbols)?;
                    self.first_literal_tree = self.symbols.len();
                    Part::Trees(Category::Literal)
                }
                Part::Trees(category) => {
                    self.read_trees(category, category.of(blocks).type_count, length, reader)?;
                    match category.next() {
                        Some(next) => Part::Trees(next),
                        None => return Ok(()),
                    }
                }
            };
        }
    }

    fn read_trees(
        &mut self,
        category: Category,
        type_count: u32,
        length: usize,
        reader: &mut BitReader<'_>,
    ) -> Result<(), Stop> {
        match category {
            Category::Literal => {
                let (count, alphabet) = (self.literal_map.tree_count as usize, Alphabet::LITERALS);
                let parts = self.mode_in_trees.parts();
                let is_text = self.context_modes[0] == Some(ContextMode::Utf8);
                while self.symbols.len() < self.first_literal_tree + count {
                    let code = self.reader.read(alphabet, reader)?;
                    if self.symbols.len() == self.first_literal_tree {
                        self.literal_root = root_for_literals(code, count, is_text, length);
                        (self.symbols).try_reserve(count, alphabet.size, self.literal_root)?;
                    }
                    (self.symbols).push_literals(code, self.literal_root, parts)?;
                }
            }
            Category::Command => {
                let (count, alphabet) = (type_count as usize, Alphabet::COMMANDS);
                while self.commands.len() < count {
                    let code = self.reader.read(alphabet, reader)?;
                    if self.commands.len() == 0 {
                        self.command_root = root_for_commands(code, count, length);
                        (self.commands).try_reserve(count, alphabet.size, self.command_root)?;
                    }
                    push_command_tree(&mut self.commands, code, self.command_root)?;
                }
            }
            Category::Distance => {
                let count = self.distance_map.tree_count as usize;
                let alphabet = self.distance_params.alphabet;
                while self.distances.len() < count {
                    let code = self.reader.read(alphabet, reader)?;
                    if self.distances.len() == 0 {
                        (self.distances).try_reserve(count, alphabet.size, Root::Bits8)?;
                    }
                    push_distance_tree(&mut self.distances, code, &self.distance_params)?;
                }
            }
        }
        Ok(())
    }
}

/// The memory of a decoder that is done, for the next one. Less than 300 KiB.
#[derive(Default)]
pub struct SpareTables {
    codes: Option<Box<Codes>>,
    window: Vec<u8>,
}

#[derive(Default)]
pub struct Decoder {
    state: State,
    bits: Bits,
    allows_large_window: bool,
    large_window: bool,
    whole_window: bool,
    first_max_len: Option<usize>,
    /// See [`machine::MetaBlock`].
    padded_dictionary: Vec<u8>,
    max_backward_distance: usize,
    ring: RingBuffer,
    cursor: Cursor,

    is_last: bool,
    /// Of the meta-block, less the whole of what the current command began to write.
    remaining: isize,
    /// Not for streams without them.
    codes: Option<Box<Codes>>,
}

impl Decoder {
    /// `key` is a `BROTLI_DECODER_PARAM_*` of `node:zlib`. Fails once decoding has begun.
    pub fn set_parameter(&mut self, key: u32, value: u32) -> bool {
        if !matches!(self.state, State::StreamHeader) {
            return false;
        }
        match key {
            0 => self.whole_window = value != 0,
            1 => self.allows_large_window = value != 0,
            _ => return false,
        }
        true
    }

    /// `None` if the dictionary is above 1 GiB, or too large for the memory.
    pub fn with_dictionary(dictionary: &[u8]) -> Option<Self> {
        if dictionary.len() > MAX_DICTIONARY_SIZE {
            return None;
        }
        let mut decoder = Self::default();
        if !dictionary.is_empty() {
            let padded_len = dictionary.len() + machine::SLACK;
            decoder.padded_dictionary = memory::empty(padded_len).ok()?;
            decoder.padded_dictionary.extend_from_slice(dictionary);
            memory::resize(&mut decoder.padded_dictionary, padded_len, 0);
        }
        Some(decoder)
    }

    /// Does nothing in the middle of a stream.
    pub fn swap_tables(&mut self, spare: &mut SpareTables) {
        const MAX_BYTES: usize = 129 * 1024;
        if matches!(self.state, State::StreamHeader | State::Done) && !self.has_more_output() {
            core::mem::swap(&mut self.codes, &mut spare.codes);
            spare.codes.take_if(|it| {
                let with_extra_bits = it.commands.size_in_bytes() + it.distances.size_in_bytes();
                with_extra_bits + it.symbols.size_in_bytes() > MAX_BYTES
            });
            self.ring.swap_bytes(&mut spare.window);
            if spare.window.capacity() > MAX_BYTES {
                spare.window = Vec::new();
            }
        }
    }

    pub fn has_more_output(&self) -> bool {
        !matches!(self.state, State::Failed(_)) && self.ring.unflushed_len() != 0
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

    /// Appends the stream that `input` starts with and returns its length. After `None`, it is as it was, and what `out` got is of no use.
    pub fn decompress_whole(
        &mut self,
        input: &[u8],
        out: &mut Vec<u8>,
        max: usize,
    ) -> Option<usize> {
        if !matches!(self.state, State::StreamHeader) || self.bits.count() != 0 {
            return None;
        }
        let mut rest = input;
        let status = self.begin_in(&mut rest, out, out.len().saturating_add(max));
        if status == Ok(DecodeStatus::Finished) {
            return Some(input.len() - rest.len());
        }
        self.start_over();
        None
    }

    /// [`decompress`](Self::decompress) to the end of `out`. It may ask for output before that is `max_len` long.
    pub fn decompress_appending(
        &mut self,
        input: &mut &[u8],
        out: &mut Vec<u8>,
        max_len: usize,
    ) -> Result<DecodeStatus, DecodeError> {
        const MIN_ROOM: usize = 4096;
        /// The caller does not seem to take output before the end.
        const PILED_UP: usize = 256 * 1024;
        let max_len = max_len.max(out.len());
        let mut has_memory = true;
        if matches!(self.state, State::StreamHeader) && self.bits.count() == 0 {
            let (whole_input, len) = (*input, out.len());
            match self.begin_in(input, out, max_len) {
                Ok(DecodeStatus::Finished) => return Ok(DecodeStatus::Finished),
                Ok(status) => {
                    has_memory = self.ring.go_on_after(out, self.whole_window).is_ok();
                    if has_memory && status == DecodeStatus::NeedsInput {
                        return Ok(status);
                    }
                }
                // Which one it is may depend on the ring.
                Err(_) => {
                    self.start_over();
                    out.truncate(len);
                    *input = whole_input;
                }
            }
        }
        let announced = match self.state {
            State::Metadata => 0,
            _ => self.remaining.max(0) as usize,
        };
        let (ready, room) = (self.ring.unflushed_len(), max_len - out.len());
        let soon = ready + announced.min(input.len().saturating_mul(8));
        let mut wanted = soon.max(MIN_ROOM).min(room);
        let limit_moves = max_len > *self.first_max_len.get_or_insert(max_len);
        if out.len() >= PILED_UP && wanted > out.capacity() - out.len() {
            let all = ready + announced.min(32 * out.len()) + MIN_ROOM;
            wanted = wanted.max(if limit_moves { all } else { all.min(room) });
        }
        let mut reserves = |more| out.try_reserve(more).is_ok();
        if !has_memory || !(reserves(wanted) || reserves(MIN_ROOM.min(room))) {
            self.state = State::Failed(DecodeError::AllocRingBuffer2);
        }
        append_with(out, room, |output| self.decompress(input, output))
    }

    fn start_over(&mut self) {
        *self = Self {
            allows_large_window: self.allows_large_window,
            whole_window: self.whole_window,
            padded_dictionary: core::mem::take(&mut self.padded_dictionary),
            ..Self::default()
        };
    }

    fn begin_in(
        &mut self,
        input: &mut &[u8],
        out: &mut Vec<u8>,
        max_len: usize,
    ) -> Result<DecodeStatus, DecodeError> {
        self.ring.begin_in(out, max_len, input.len());
        let status = append_with(out, 0, |nowhere| self.decompress(input, nowhere));
        self.ring.give_back(out);
        status
    }

    fn run(
        &mut self,
        reader: &mut BitReader<'_>,
        output: &mut BorrowedCursor<'_, u8>,
    ) -> Result<(), Stop> {
        // With short buffers, calls tend to end in the state that they begin in.
        match self.state {
            State::Commands => self.state = self.decode_commands(reader, output)?,
            State::Uncompressed => self.state = self.copy_uncompressed(reader)?,
            State::RingLimit(resume) => {
                self.state = self.move_ring_limit(resume, reader, output)?
            }
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
                        reader.step(|bits| read_window_bits(bits, self.allows_large_window))?;
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
                State::BeginUncompressed => {
                    self.begin_meta_block(DecodeError::AllocRingBuffer1)?;
                    State::Uncompressed
                }
                State::Uncompressed => self.copy_uncompressed(reader)?,
                State::Header(part) => {
                    let codes = match &mut self.codes {
                        Some(codes) => codes,
                        none => none.insert(Codes::new()?),
                    };
                    let (mut part, blocks) = (part, &mut self.cursor.blocks);
                    let length = self.remaining as usize;
                    let result = codes.read(&mut part, blocks, length, self.large_window, reader);
                    self.state = State::Header(part);
                    result?;
                    self.begin_meta_block(DecodeError::AllocRingBuffer2)?;
                    self.ring.grow(self.unread(reader))?;
                    self.cursor.command = Command::default();
                    State::Commands
                }
                State::Commands => self.decode_commands(reader, output)?,
                State::Copy { distance, length } => {
                    let length = length - self.ring.copy_part(distance, length)?;
                    self.resume_below_limit(Resume::Copy { distance, length })
                }
                State::CopyFromDictionary { offset, length } => {
                    let bytes = self
                        .padded_dictionary
                        .get(offset..offset + length)
                        .ok_or(Stop::UNREACHABLE)?;
                    let copied = self.ring.append(bytes)?;
                    self.resume_below_limit(Resume::CopyFromDictionary {
                        offset: offset + copied,
                        length: length - copied,
                    })
                }
                State::RingLimit(resume) => self.move_ring_limit(resume, reader, output)?,
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
                State::BeginUncompressed
            } else {
                State::Header(Part::BlockTypeCount(Category::Literal))
            };
            Ok((is_last, length + 1, next))
        })?;
        self.is_last = is_last;
        self.remaining = length as isize;
        if let Some(codes) = &mut self.codes {
            codes.commands.clear();
            codes.distances.clear();
            codes.symbols.clear();
        }
        if matches!(next, State::Metadata | State::BeginUncompressed)
            && !reader.skip_to_byte_boundary()
        {
            return Err(DecodeError::Padding1.into());
        }
        Ok(next)
    }

    fn begin_meta_block(&mut self, refusal: DecodeError) -> Result<(), Stop> {
        (self.ring).begin_meta_block(self.remaining as usize, self.whole_window, refusal)
    }

    /// See [`RingBuffer::make_room`].
    fn unread(&self, reader: &BitReader<'_>) -> Option<usize> {
        (!self.is_last).then_some(reader.input().len())
    }

    #[inline(always)]
    fn copy_uncompressed(&mut self, reader: &mut BitReader<'_>) -> Result<State, Stop> {
        let mut wanted = self.ring.room().min(self.remaining as usize);
        let available = reader.input().len() + size_of::<u64>();
        (self.ring).make_room(wanted.min(available), self.unread(reader))?;
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
        Ok(if self.ring.room() == 0 && self.ring.has_final_size() {
            State::RingLimit(Resume::Uncompressed)
        } else {
            State::MetaBlockDone
        })
    }

    #[inline(always)]
    fn move_ring_limit(
        &mut self,
        resume: Resume,
        reader: &BitReader<'_>,
        output: &mut BorrowedCursor<'_, u8>,
    ) -> Result<State, Stop> {
        if self.ring.is_full() || self.ring.is_lent() {
            match self.flush(output) {
                // A ring that can still grow does not have to be emptied.
                Err(Stop::NeedsOutput) if !self.ring.has_final_size() => {}
                result => result?,
            }
        }
        self.ring.grow(self.unread(reader))?;
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

fn after_blocks_of(category: Category) -> Part {
    category
        .next()
        .map_or(Part::DistanceParams, Part::BlockTypeCount)
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
