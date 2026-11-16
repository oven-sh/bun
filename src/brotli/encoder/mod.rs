//! Makes the choices of google/brotli 1.2. The output depends on its numbers, and on the order of floating-point operations.
#![allow(clippy::indexing_slicing)] // No index is read from a stream.

mod bit_stream;
mod bit_writer;
mod block_splitter;
mod cluster;
mod command;
mod fragment;
mod hash;
mod histogram;
mod huffman;
mod input_block;
mod literal_contexts;
mod literal_cost;
mod log2;
mod match_finder;
mod matching;
mod meta_block;
mod params;
mod prepared_dictionary;
mod ring_buffer;
mod symbol_set;
mod windowed;
mod word_tables;
mod words;
mod zopfli;

pub use params::{MAX_QUALITY, MIN_QUALITY};

use bit_stream::write_metadata_header;
use bit_writer::BitWriter;
use fragment::Fragments;
use histogram::DISTANCE_SYMBOLS;
use huffman::{TreeBuilder, max_description_size};
use params::{Params, Requested};
use prepared_dictionary::PreparedDictionary;
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
    dictionary: Option<PreparedDictionary>,
    stream: Option<Stream>,
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
        let dictionary = match dictionary.len() {
            0 => None,
            1..=MAX_DICTIONARY_SIZE => Some(PreparedDictionary::new(dictionary).ok()?),
            _ => return None,
        };
        Some(Self {
            dictionary,
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
            none => none.insert(Stream::new(&self.requested, input.len())?),
        };
        let result = stream.compress(self.dictionary.as_ref(), operation, input, &mut output);
        if result == Err(EncodeError::OutOfMemory) {
            stream.state = State::OutOfMemory;
        }
        result
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
    Fragments(Fragments),
    Windowed(Windowed),
}

struct Stream {
    params: Params,
    state: State,
    method: Method,
    trees: TreeBuilder,
    writer: BitWriter,
    /// How many of the bytes in `writer` the caller has.
    delivered: usize,
    /// Where the stream header ends. It waits until something follows it.
    lone_header: Option<usize>,
}

impl Stream {
    fn new(requested: &Requested, first_input: usize) -> memory::Result<Self> {
        let params = Params::new(requested);
        let mut writer = BitWriter::default();
        try_reserve_for(first_input.min(params.block_size()), &mut writer)?;
        writer.write_bits(params.stream_header());
        Ok(Self {
            params,
            state: State::Processing,
            method: match params.quality {
                0 | 1 => Method::Fragments(Fragments::new(params.quality)),
                _ => Method::Windowed(Windowed::new(&params)),
            },
            trees: TreeBuilder::new()?,
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
        dictionary: Option<&PreparedDictionary>,
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

        loop {
            if let Method::Windowed(windowed) = &mut self.method
                && !is_metadata
                && !input.is_empty()
            {
                let room = windowed.room_in_block(&self.params);
                let (fits, rest) = input.split_at(room.min(input.len()));
                windowed.add_input(fits)?;
                *input = rest;
            }
            if !self.deliver(output) {
                return Ok(EncodeStatus::NeedsOutput);
            }
            match self.state {
                State::Processing => {
                    if !self.process(dictionary, operation, input)? {
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
                    self.end_block(dictionary, 0, Operation::Flush)?;
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

    /// Returns false if it waits for input.
    fn process(
        &mut self,
        dictionary: Option<&PreparedDictionary>,
        operation: Operation,
        input: &mut &[u8],
    ) -> memory::Result<bool> {
        let (is_ready, fragment_size) = match &self.method {
            Method::Windowed(windowed) => (windowed.room_in_block(&self.params) == 0, 0),
            Method::Fragments(_) => (!input.is_empty(), self.params.block_size()),
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
        let (trees, writer) = (&mut self.trees, &mut self.writer);
        match &mut self.method {
            Method::Fragments(method) => method.compress(fragment, is_last, trees, writer)?,
            Method::Windowed(_) => self.end_block(dictionary, rest.len(), operation)?,
        }
        *input = rest;
        match operation {
            Operation::Finish => self.state = State::Finished,
            Operation::Flush => self.state = State::Flushing,
            Operation::Process | Operation::EmitMetadata => {}
        }
        Ok(true)
    }

    fn end_block(
        &mut self,
        dictionary: Option<&PreparedDictionary>,
        more_input: usize,
        operation: Operation,
    ) -> memory::Result<()> {
        let Method::Windowed(windowed) = &mut self.method else {
            return Ok(());
        };
        if self.params.size_hint == 0 {
            self.params.size_hint = windowed.unprocessed() + more_input;
        }
        let (trees, writer) = (&mut self.trees, &mut self.writer);
        windowed.end_block(&self.params, dictionary, operation, trees, writer)
    }
}
