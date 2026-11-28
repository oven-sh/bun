//! The output is the same on all CPUs.
#![allow(clippy::indexing_slicing)] // No index is read from a stream.

mod bit_stream;
mod bit_writer;
mod block_splitter;
mod cluster;
mod command;
mod fragment;
mod histogram;
mod huffman;
mod input_block;
mod log2;
mod matching;
mod meta_block;
mod optimal;
mod params;
mod prepared_dictionary;
mod quick;
mod quick_words;
mod ring_buffer;
mod symbol_set;
mod utf8;
mod windowed;
mod word_tables;
mod words;

pub use params::{MAX_QUALITY, MIN_QUALITY};

use bit_stream::write_metadata_header;
use bit_writer::BitWriter;
use fragment::Fragments;
use histogram::DISTANCE_SYMBOLS;
use huffman::{TreeBuilder, max_description_size};
use optimal::Optimal;
use params::{Params, Requested};
use quick::Quick;
use windowed::Windowed;

use crate::error::EncodeError;
use crate::format::{Alphabet, MAX_DICTIONARY_SIZE};
use crate::memory;
use bun_core::vec::BorrowedCursor;

const MAX_METADATA_SIZE: usize = 1 << 24;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    Process,
    /// Makes the output so far enough to decode the input so far.
    Flush,
    Finish,
    /// The input is for decoders to skip.
    EmitMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodeStatus {
    Done,
    /// Repeat the operation, with what is left of the input.
    NeedsOutput,
}

#[derive(Default)]
pub struct Encoder {
    requested: Requested,
    /// Until the stream starts.
    dictionary: Vec<u8>,
    spare: SpareMemory,
    stream: Option<Stream>,
}

/// What one encoder leaves to the next, which is at most 3 MiB. The output does not depend on it.
#[derive(Default)]
pub struct SpareMemory {
    quick: quick::Spare,
    optimal: Option<Optimal>,
    writer: BitWriter,
}

impl SpareMemory {
    const MAX_SIZE: usize = 3 << 20;
}

impl Encoder {
    pub fn with_quality(quality: i32) -> Self {
        Self {
            requested: Requested::with_quality(quality),
            ..Self::default()
        }
    }

    /// `None` if the dictionary is above 1 GiB, or too large for the memory.
    #[inline(never)]
    pub fn with_dictionary(dictionary: &[u8]) -> Option<Self> {
        bun_removable_features::removable_definition!(BrotliEncoder, Self::with_dictionary);
        if dictionary.len() > MAX_DICTIONARY_SIZE {
            return None;
        }
        let mut copy = memory::empty(dictionary.len()).ok()?;
        copy.extend_from_slice(dictionary);
        Some(Self {
            dictionary: copy,
            ..Self::default()
        })
    }

    /// `key` is one of `zlib.constants.BROTLI_PARAM_*`. Fails once the stream has begun.
    pub fn set_parameter(&mut self, key: u32, value: u32) -> bool {
        self.stream.is_none() && self.requested.set(key, value)
    }

    /// Advances `input` by what it consumed.
    #[inline(never)]
    pub fn compress(
        &mut self,
        operation: Operation,
        input: &mut &[u8],
        mut output: BorrowedCursor<'_, u8>,
    ) -> Result<EncodeStatus, EncodeError> {
        bun_removable_features::removable_definition!(BrotliEncoder, Self::compress);
        let stream = match &mut self.stream {
            Some(stream) => stream,
            none => {
                if operation == Operation::Finish {
                    self.requested.adapt_to(input);
                }
                let stream =
                    Stream::new(&self.requested, &self.dictionary, input, &mut self.spare)?;
                self.dictionary = Vec::new();
                none.insert(stream)
            }
        };
        let result = stream.compress(operation, input, &mut output);
        if result == Err(EncodeError::OutOfMemory) {
            stream.state = State::OutOfMemory;
        }
        result
    }

    /// Forgets the stream if it has begun.
    #[inline(never)]
    pub fn swap_memory(&mut self, spare: &mut SpareMemory) {
        bun_removable_features::removable_definition!(BrotliEncoder, Self::swap_memory);
        core::mem::swap(&mut self.spare, spare);
        if let Some(stream) = self.stream.take() {
            spare.writer = stream.writer;
            spare.writer.clear();
            match stream.method {
                Method::Fragments(..) => {}
                Method::Quick(quick) => spare.quick = quick.into_spare(),
                Method::Windowed(windowed) => spare.optimal = windowed.into_spare(),
            }
        }
        if spare.writer.capacity() > SpareMemory::MAX_SIZE / 6 {
            spare.writer = BitWriter::default();
        }
        if spare.quick.size() > SpareMemory::MAX_SIZE / 2 {
            spare.quick = quick::Spare::default();
        }
    }

    /// Appends a stream, which has not begun, for all of `input`.
    pub fn compress_whole(
        &mut self,
        mut input: &[u8],
        out: &mut Vec<u8>,
    ) -> Result<(), EncodeError> {
        let room = max_compressed_size(input.len());
        loop {
            out.try_reserve(room)
                .map_err(|_| EncodeError::OutOfMemory)?;
            let status = bun_core::vec::append_with(out, room, |out| {
                self.compress(Operation::Finish, &mut input, out)
            });
            if status? == EncodeStatus::Done {
                return Ok(());
            }
        }
    }
}

/// Enough for [`Encoder::with_quality`] to finish a stream in one call.
pub fn max_compressed_size(input_size: usize) -> usize {
    input_size.saturating_add(4 * (input_size >> 14) + 6)
}

/// Room for the meta-blocks of `input_size` bytes, before it turns out that they are too large.
fn try_reserve_for(input_size: usize, writer: &mut BitWriter) -> memory::Result<()> {
    const ONE_CODE_EACH: usize = max_description_size(Alphabet::LITERALS)
        + max_description_size(Alphabet::COMMANDS)
        + max_description_size(Alphabet::new(DISTANCE_SYMBOLS as u32));
    writer.try_reserve(2 * input_size + ONE_CODE_EACH)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Processing,
    Flushing,
    Finished,
    BeforeMetadata { size: usize },
    InMetadata { left: usize },
    OutOfMemory,
}

#[allow(clippy::large_enum_variant)] // There is one for each stream.
enum Method {
    Fragments(Fragments, TreeBuilder),
    Quick(Quick),
    Windowed(Windowed),
}

struct Stream {
    params: Params,
    state: State,
    method: Method,
    writer: BitWriter,
    /// How many of the bytes in `writer` the caller has.
    delivered: usize,
    /// Where the stream header ends. It waits until something follows it.
    lone_header: Option<usize>,
}

impl Stream {
    fn new(
        requested: &Requested,
        dictionary: &[u8],
        first_input: &[u8],
        spare: &mut SpareMemory,
    ) -> memory::Result<Self> {
        let params = Params::new(requested);
        let mut writer = core::mem::take(&mut spare.writer);
        try_reserve_for(first_input.len().min(params.block_size()), &mut writer)?;
        writer.write_bits(params.stream_header());
        Ok(Self {
            params,
            state: State::Processing,
            method: match params.quality {
                0 | 1 => Method::Fragments(Fragments::new(params.quality), TreeBuilder::new()?),
                2..=9 => Method::Quick(Quick::new(
                    &params,
                    dictionary,
                    first_input,
                    core::mem::take(&mut spare.quick),
                )?),
                _ => Method::Windowed(Windowed::new(&params, dictionary, spare.optimal.take())?),
            },
            lone_header: Some(writer.position()),
            writer,
            delivered: 0,
        })
    }

    fn pending(&self) -> &[u8] {
        &self.writer.complete_bytes()[self.delivered..]
    }

    /// Returns whether nothing is left.
    fn deliver(&mut self, output: &mut BorrowedCursor<'_, u8>) -> bool {
        if self.lone_header == Some(self.writer.position()) {
            return true;
        }
        self.lone_header = None;
        self.delivered += memory::append_what_fits(output, self.pending());
        let delivered_all = self.pending().is_empty();
        if delivered_all {
            self.delivered = 0;
            self.writer.forget_complete_bytes();
        }
        delivered_all
    }

    fn compress(
        &mut self,
        operation: Operation,
        input: &mut &[u8],
        output: &mut BorrowedCursor<'_, u8>,
    ) -> Result<EncodeStatus, EncodeError> {
        let is_metadata = operation == Operation::EmitMetadata;
        match self.state {
            State::OutOfMemory => return Err(EncodeError::OutOfMemory),
            State::Processing if is_metadata && input.len() <= MAX_METADATA_SIZE => {
                self.state = State::BeforeMetadata { size: input.len() };
            }
            State::BeforeMetadata { size: left } | State::InMetadata { left }
                if is_metadata && left == input.len() => {}
            State::Processing if !is_metadata => {}
            State::Flushing | State::Finished if !is_metadata && input.is_empty() => {}
            _ => return Err(EncodeError::InvalidOperation),
        }

        if let Method::Quick(quick) = &mut self.method
            && operation == Operation::Finish
            && quick.compress_whole(&self.params, input, &mut self.writer)?
        {
            *input = &[];
            self.state = State::Finished;
        }
        loop {
            if !is_metadata && !input.is_empty() {
                let room = self.room_in_block().unwrap_or(0);
                let (fits, rest) = input.split_at(room.min(input.len()));
                match &mut self.method {
                    Method::Fragments(..) => {}
                    Method::Quick(quick) => quick.add_input(&self.params, fits)?,
                    Method::Windowed(windowed) => windowed.add_input(fits)?,
                }
                *input = rest;
            }
            if !self.deliver(output) {
                return Ok(EncodeStatus::NeedsOutput);
            }
            match self.state {
                State::Processing => {
                    if !self.process(operation, input)? {
                        return Ok(EncodeStatus::Done);
                    }
                }
                State::Flushing if self.writer.is_at_byte_boundary() => {
                    self.state = State::Processing;
                    if operation == Operation::Flush {
                        return Ok(EncodeStatus::Done);
                    }
                }
                // Pads the output to a byte boundary.
                State::Flushing => write_metadata_header(&mut self.writer, 0),
                State::BeforeMetadata { size } => {
                    self.end_block(0, Operation::Flush)?;
                    write_metadata_header(&mut self.writer, size);
                    self.state = State::InMetadata { left: size };
                }
                State::InMetadata { left } => {
                    let written = memory::append_what_fits(output, input);
                    *input = &input[written..];
                    if written < left {
                        let left = left - written;
                        self.state = State::InMetadata { left };
                        return Ok(EncodeStatus::NeedsOutput);
                    }
                    self.state = State::Processing;
                    return Ok(EncodeStatus::Done);
                }
                State::Finished => return Ok(EncodeStatus::Done),
                State::OutOfMemory => return Err(EncodeError::OutOfMemory),
            }
        }
    }

    fn room_in_block(&self) -> Option<usize> {
        match &self.method {
            Method::Fragments(..) => None,
            Method::Quick(quick) => Some(quick.room_in_block(&self.params)),
            Method::Windowed(windowed) => Some(windowed.room_in_block(&self.params)),
        }
    }

    /// Returns false if it waits for input.
    fn process(&mut self, operation: Operation, input: &mut &[u8]) -> memory::Result<bool> {
        let (is_ready, fragment_size) = match self.room_in_block() {
            Some(room) => (room == 0, 0),
            None => (!input.is_empty(), self.params.block_size()),
        };
        if !is_ready && operation == Operation::Process {
            return Ok(false);
        }
        let (fragment, rest) = input.split_at(input.len().min(fragment_size));
        let operation = if rest.is_empty() {
            operation
        } else {
            Operation::Process
        };
        let is_last = operation == Operation::Finish;
        let writer = &mut self.writer;
        match &mut self.method {
            Method::Fragments(method, trees) => {
                method.compress(fragment, is_last, trees, writer)?
            }
            _ => self.end_block(rest.len(), operation)?,
        }
        *input = rest;
        match operation {
            Operation::Finish => self.state = State::Finished,
            Operation::Flush => self.state = State::Flushing,
            Operation::Process | Operation::EmitMetadata => {}
        }
        Ok(true)
    }

    fn end_block(&mut self, more_input: usize, operation: Operation) -> memory::Result<()> {
        let (params, writer) = (&mut self.params, &mut self.writer);
        let mut hint_at = |unprocessed| {
            if params.size_hint == 0 {
                params.size_hint = unprocessed + more_input;
            }
        };
        match &mut self.method {
            Method::Fragments(..) => Ok(()),
            Method::Quick(quick) => {
                hint_at(quick.unprocessed());
                quick.end_block(params, operation, writer)
            }
            Method::Windowed(windowed) => {
                hint_at(windowed.unprocessed());
                windowed.end_block(params, operation, writer)
            }
        }
    }
}
