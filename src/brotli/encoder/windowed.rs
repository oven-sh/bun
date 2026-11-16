//! Qualities 2 and above collect the input in blocks, and join the commands of several blocks in a meta-block.

use super::bit_stream::{
    MetaBlockKind, write_empty_last, write_full_meta_block, write_plain_meta_block,
    write_uncompressed,
};
use super::bit_writer::BitWriter;
use super::command::{Command, Commands};
use super::histogram::bits_entropy;
use super::huffman::TreeBuilder;
use super::input_block::InputBlock;
use super::literal_contexts;
use super::literal_cost::is_mostly_utf8;
use super::match_finder::MatchFinder;
use super::meta_block::{MetaBlock, Source};
use super::params::Params;
use super::prepared_dictionary::PreparedDictionary;
use super::ring_buffer::RingBuffer;
use super::{Operation, try_reserve_for};
use crate::context::ContextMode;
use crate::format::{INITIAL_DISTANCES, LITERAL_SYMBOLS};
use crate::memory::Result;

/// Fits a position in 32 bits. The first 3 GiB are continuous. Then it goes back to 1 GiB every 2 GiB.
fn wrap(position: u64) -> usize {
    const GIB: u64 = 1 << 30;
    if position < 3 * GIB {
        position as usize
    } else {
        (GIB + (position - GIB) % (2 * GIB)) as usize
    }
}

/// A meta-block of up to this size is stored as is.
const MAX_ALWAYS_STORED: usize = 2;

pub(super) struct Windowed {
    ring: RingBuffer,
    /// Depends on the size hint, which the first block may set.
    finder: Option<MatchFinder>,
    commands: Commands,
    /// As they are after the meta-blocks that were written.
    written_distances: [i32; 4],
    /// How much of the input has commands.
    processed: u64,
    /// How much of the input is in meta-blocks.
    written: u64,
    /// The last one first.
    last_written_bytes: [u8; 2],
    positions_wrapped: bool,
    /// A stream that continues another one does not know the context of its first two bytes, and stores them as is.
    bytes_without_context: Option<usize>,
}

impl Windowed {
    pub(super) fn new(params: &Params) -> Self {
        let continues = params.stream_offset != 0;
        let distances = if continues {
            // Negative whatever a short code adds.
            [-16; 4]
        } else {
            INITIAL_DISTANCES.map(u32::cast_signed)
        };
        Self {
            ring: RingBuffer::new(params.ring_buffer_bits(), params.block_bits),
            finder: None,
            commands: Commands::new(distances),
            written_distances: distances,
            processed: 0,
            written: 0,
            last_written_bytes: [0; 2],
            positions_wrapped: false,
            bytes_without_context: continues.then_some(2),
        }
    }

    pub(super) fn unprocessed(&self) -> usize {
        (self.ring.received() - self.processed) as usize
    }

    fn has_unwritten_input(&self) -> bool {
        self.ring.received() != self.written
    }

    pub(super) fn room_in_block(&self, params: &Params) -> usize {
        let room = params.block_size() - self.unprocessed();
        room.min(self.bytes_without_context.unwrap_or(room))
    }

    /// `input` fits in the block.
    pub(super) fn add_input(&mut self, input: &[u8]) -> Result<()> {
        if let Some(left) = &mut self.bytes_without_context {
            *left -= input.len();
        }
        self.ring.write(input)
    }

    /// Processes the input, and writes a meta-block if it is time.
    pub(super) fn end_block(
        &mut self,
        params: &Params,
        dictionary: Option<&PreparedDictionary>,
        operation: Operation,
        trees: &mut TreeBuilder,
        writer: &mut BitWriter,
    ) -> Result<()> {
        let is_last = operation == Operation::Finish;
        let has_context_now = self.bytes_without_context.take_if(|n| *n == 0).is_some();
        if is_last && self.ring.received() - self.written <= MAX_ALWAYS_STORED as u64 {
            self.processed = self.ring.received();
        } else if self.unprocessed() != 0 {
            self.add_commands(params, dictionary, is_last)?;
        }
        if operation == Operation::Process && !has_context_now && self.can_wait(params) {
            return Ok(());
        }
        if self.has_unwritten_input() {
            self.commands.end_with_pending_literals();
            self.write_meta_block(params, is_last, trees, writer)
        } else {
            if is_last {
                write_empty_last(writer);
            }
            Ok(())
        }
    }

    fn add_commands(
        &mut self,
        params: &Params,
        dictionary: Option<&PreparedDictionary>,
        is_last: bool,
    ) -> Result<()> {
        let (position, length) = (wrap(self.processed), self.unprocessed());
        let window = self.ring.window();
        let block = InputBlock::new(window, position, length, is_last, params, dictionary);
        let finder = match &mut self.finder {
            Some(finder) => finder,
            none => none.insert(MatchFinder::new(&block)?),
        };
        let covered = self.commands.extend_last(&block, self.processed);
        finder.add_commands(&block, covered, self.positions_wrapped, &mut self.commands)?;
        self.processed = self.ring.received();
        self.positions_wrapped = wrap(self.processed) < block.position;
        Ok(())
    }

    fn can_wait(&self, params: &Params) -> bool {
        const MAX_SYMBOLS_WITHOUT_BLOCK_SPLITS: usize = 0x2FFF;
        let max_size = params.max_meta_block_size();
        let (literals, commands) = (self.commands.literal_count, self.commands.list.len());
        (self.processed - self.written) as usize + params.block_size() <= max_size
            && (params.quality >= 4 || literals + commands < MAX_SYMBOLS_WITHOUT_BLOCK_SPLITS)
            && literals.max(commands) < max_size / 8
    }

    fn write_meta_block(
        &mut self,
        params: &Params,
        is_last: bool,
        trees: &mut TreeBuilder,
        writer: &mut BitWriter,
    ) -> Result<()> {
        let source = Source {
            window: self.ring.window(),
            start: wrap(self.written),
            length: (self.processed - self.written) as usize,
            literal_count: self.commands.literal_count,
            before: self.last_written_bytes,
        };
        try_reserve_for(source.length, writer)?;
        let start = writer.position();
        let mut compressed = is_worth_compressing(&source, &self.commands);
        if compressed {
            let commands = &mut self.commands.list;
            write_compressed(&source, commands, params, is_last, trees, writer)?;
            compressed = writer.position() / 8 <= source.length + 4;
        }
        if !compressed {
            writer.rewind(start);
            self.commands.last_distances = self.written_distances;
            write_uncompressed(writer, source.window.parts(source.start, source.length));
            if is_last {
                write_empty_last(writer);
            }
        }

        let end = source.start + source.length;
        self.last_written_bytes = match source.length {
            1 => [source.window.byte(end - 1), source.before[0]],
            _ => [source.window.byte(end - 1), source.window.byte(end - 2)],
        };
        self.written = self.processed;
        self.written_distances = self.commands.last_distances;
        self.commands.list.clear();
        self.commands.literal_count = 0;
        Ok(())
    }
}

fn is_worth_compressing(source: &Source<'_>, commands: &Commands) -> bool {
    const SAMPLE_RATE: usize = 13;
    const MIN_ENTROPY: f64 = 7.92;
    let size = source.length as f64;
    if source.length <= MAX_ALWAYS_STORED {
        return false;
    }
    if commands.list.len() >= (source.length >> 8) + 2
        || commands.literal_count as f64 <= 0.99 * size
    {
        return true;
    }
    let mut histogram = [0; LITERAL_SYMBOLS];
    for offset in (0..source.length).step_by(SAMPLE_RATE) {
        histogram[usize::from(source.window.byte(source.start + offset))] += 1;
    }
    bits_entropy(&histogram) <= size * MIN_ENTROPY * (1.0 / SAMPLE_RATE as f64)
}

fn write_compressed(
    source: &Source<'_>,
    commands: &mut [Command],
    params: &Params,
    is_last: bool,
    trees: &mut TreeBuilder,
    writer: &mut BitWriter,
) -> Result<()> {
    let kind = if is_last {
        MetaBlockKind::LastCompressed
    } else {
        MetaBlockKind::Compressed
    };
    if params.quality < 4 {
        write_plain_meta_block(source, commands, params, kind, trees, writer)?;
    } else {
        let mut context_mode = ContextMode::Utf8;
        let mut block = if params.quality < 10 {
            let groups =
                literal_contexts::choose(source.window, source.start, source.length, params);
            MetaBlock::build_greedy(source, commands, params, groups)?
        } else {
            if !is_mostly_utf8(source.window.parts(source.start, source.length)) {
                context_mode = ContextMode::Signed;
            }
            MetaBlock::build(source, commands, params, context_mode)?
        };
        block.smooth_histograms();
        write_full_meta_block(
            source.length,
            commands,
            &block,
            context_mode,
            kind,
            trees,
            writer,
        )?;
    }
    if is_last {
        writer.align();
    }
    Ok(())
}
