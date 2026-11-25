//! Qualities 2 to 9 look up one candidate after the end of each match, and choose among the matches that overlap.

use bun_highway::brotli_quick::{
    self, Compressor, Format, Input, MAX_META_BLOCK_SIZE, MAX_WORD_ADDRESS, MIN_BEFORE,
    PADDING_AFTER, PADDING_BEFORE, Ready, Settings, UNKNOWN_DISTANCES, looks_binary,
};

use super::Operation;
use super::bit_stream::{MetaBlockKind, write_empty_last, write_header, write_uncompressed};
use super::bit_writer::BitWriter;
use super::params::Params;
use super::quick_words::WORDS;
use crate::context::{ContextLut, ContextMode};
use crate::dictionary;
use crate::format::{DistanceParams, INITIAL_DISTANCES};
use crate::memory::{self, AllocError, Result};

static FORMAT: Format = Format::new(
    &WORDS,
    &dictionary::WORDS,
    &[
        ContextLut::tables(ContextMode::Utf8),
        ContextLut::tables(ContextMode::Signed),
    ],
);

/// A meta-block of up to this size is stored as is.
const MAX_ALWAYS_STORED: usize = 2;
/// What `max_compressed_size` allows a header for.
const MIN_STORED: usize = 1 << 14;
/// Offsets have 31 bits.
const MAX_HISTORY: usize = 1 << 29;
/// Streams of these sizes are not copied if they come in one piece.
const BORROWED_SIZES: core::ops::Range<usize> = 1 << 16..1 << 25;

/// `size` is that of the dictionary and of the stream, as far as it is known.
fn settings(params: &Params, dictionary_size: usize, size: usize, next: &[u8]) -> Settings {
    let quality = params.quality;
    let history = size.min(params.max_backward_distance() + dictionary_size);
    let is_small = history < 8 << 10;
    let is_binary = size >= 600 && looks_binary(&next[..next.len().min(1 << 20)]);
    let (table_count, max_bits) = match quality {
        _ if is_small => (1, 13),
        ..4 => (1, 15),
        4 | 5 => (1, 16),
        6 => (1, 17),
        7 => (if history > 30_000 { 2 } else { 1 }, 17),
        8 => (2, 18),
        _ => (if history > 50_000 { 3 } else { 2 }, 18),
    };
    // Short meta-blocks gain nothing from contexts, and the search is a small part of what they take.
    let is_short = next.len() < 8 << 10;
    let table_count = 3.min(table_count + u32::from(is_short && !is_small && quality > 4));
    let is_sparse = quality < 5 && !is_short && !is_binary && history > 50_000;
    let is_large = history > 200_000 && table_count == 1;
    let gram = 5 + u32::from(is_large)
        - u32::from(is_small)
        - u32::from(is_binary && (quality > 3 || is_large));
    let gram = gram - u32::from(is_short && table_count == 3 && !is_binary);
    // Zeros tell little about a place.
    let sample = next.iter().step_by((next.len() / 256) | 1);
    let is_thin = is_binary && sample.len() * 7 < 10 * sample.filter(|&&byte| byte == 0).count();
    let gram = if is_thin && quality > 4 && table_count == 1 && !is_small {
        7
    } else {
        gram
    };
    let max_bits = max_bits + (history >> 23).bit_width() / 2;
    let bits = (history - 1).bit_width().clamp(8, max_bits);
    let distances = match params.distance {
        given if given.postfix_bits + given.direct_codes != 0 => [given; 3],
        _ => [u32::from(history > 100_000), 2, 0]
            .map(|postfix_bits| DistanceParams::new(postfix_bits, 0, params.large_window)),
    };
    let may_go_on = size > 2 * next.len();
    let reach = if may_go_on {
        params.max_backward_distance() + dictionary_size
    } else {
        history
    };
    let has_contexts = !params.disable_literal_context_modeling && (quality > 3 || is_sparse);
    Settings {
        table_bits: [bits.min(17 + max_bits.saturating_sub(18)), bits, bits],
        grams: [gram, gram + 6 - table_count, gram + 9],
        table_count,
        landmark_bits: match reach.bit_width() {
            bits if size >> 16 != 0 => bits.max(12) - 8,
            _ => 0,
        },
        seam_bits: if size < 6 << 10 || quality < 3 + u32::from(is_binary) {
            0
        } else {
            (bits - 4).min(13)
        },
        sparsity: if is_sparse {
            3 + u32::from(quality < 4)
        } else {
            0
        },
        few_matches: if quality < 5 { 64 } else { 8 },
        repeat_gain: match quality {
            3 | 4 if size < 600 => 32,
            ..5 => 0,
            5 => 10,
            _ => 32,
        },
        word_toll: match quality {
            _ if is_short => 32,
            ..7 => 400,
            _ => 120,
        },
        join_toll: match quality {
            ..4 => 24,
            4 => 12,
            _ => 6,
        },
        position_bits: (dictionary_size
            + (params.max_backward_distance() << u32::from(dictionary_size != 0)))
        .bit_width()
        .clamp(22, 30),
        max_backward: params.max_backward_distance() as u32,
        first_word: dictionary_size as u32 + 1,
        postfix_bits: distances.map(|it| it.postfix_bits),
        direct_codes: params.distance.direct_codes,
        distance_symbols: distances.map(|it| it.alphabet.size),
        distance_symbol_bits: distances.map(|it| it.alphabet.symbol_bits),
        max_trees: if has_contexts { 8 } else { 1 },
        min_insert: if quality > 4 || is_sparse { 0 } else { 12 },
        haste: match quality {
            ..3 => 200,
            3 | 4 => 40,
            _ => 20,
        },
        max_size: if quality < 5 { 785 } else { 790 },
    }
}

#[derive(Default)]
pub(super) struct Spare {
    compressor: brotli_quick::Spare,
    window: Vec<u8>,
}

impl Spare {
    pub(super) fn size(&self) -> usize {
        self.compressor.size() + self.window.capacity()
    }
}

pub(super) struct Quick {
    compressor: Compressor,
    /// The recent input, with padding at both ends. At first, the dictionary comes before it.
    window: Vec<u8>,
    origin: usize,
    dictionary_end: usize,
    base: u64,
    dictionary_size: usize,
    stream_offset: u32,
    /// Up to which size of the stream the settings are good.
    configured_for: usize,
    /// Offsets in the window.
    processed: usize,
    written: usize,
    /// How much of what counts as written waits to be stored as is, along with what follows if that does not shrink either.
    deferred: usize,
    /// A stream that continues another one does not know the context of its first two bytes, and stores them as is.
    bytes_without_context: Option<usize>,
}

impl Quick {
    pub(super) fn new(
        params: &Params,
        dictionary: &[u8],
        first_input: &[u8],
        spare: Spare,
    ) -> Result<Self> {
        let continues = params.stream_offset != 0;
        let distances = if continues {
            UNKNOWN_DISTANCES
        } else {
            INITIAL_DISTANCES
        };
        let past_window = params.distance.max_distance - params.max_backward_distance();
        // Much of the static dictionary is HTML.
        let is_markup = first_input.first() == Some(&b'<');
        let first_input = first_input.len();
        let tries_words = params.quality
            + u32::from(first_input < 2 << 10 || is_markup || params.window_bits < 13)
            + u32::from(first_input < 600)
            > 4
            && dictionary.len() + MAX_WORD_ADDRESS + 512 <= past_window;
        let usable = dictionary
            .len()
            .min(past_window - PADDING_BEFORE)
            .min(MAX_HISTORY);
        let start = PADDING_BEFORE + usable;
        let mut window = spare.window;
        if usable != 0 {
            window = memory::empty(start + first_input.min(params.block_size()) + PADDING_AFTER)?;
            window.extend([0; PADDING_BEFORE]);
            window.extend_from_slice(&dictionary[dictionary.len() - usable..]);
            window.extend([0; PADDING_AFTER]);
        }
        Ok(Self {
            compressor: Compressor::new(&FORMAT, distances, tries_words, spare.compressor),
            window,
            origin: PADDING_BEFORE,
            dictionary_end: if usable == 0 { 0 } else { start },
            base: (start as u64).wrapping_neg(),
            dictionary_size: dictionary.len(),
            stream_offset: params.stream_offset as u32,
            configured_for: 0,
            processed: start,
            written: start,
            deferred: 0,
            bytes_without_context: continues.then_some(2),
        })
    }

    pub(super) fn into_spare(mut self) -> Spare {
        self.window.clear();
        Spare {
            compressor: self.compressor.into_spare(),
            window: self.window,
        }
    }

    fn received(&self) -> usize {
        self.window.len().max(PADDING_BEFORE + PADDING_AFTER) - PADDING_AFTER
    }

    pub(super) fn unprocessed(&self) -> usize {
        self.received() - self.processed
    }

    pub(super) fn room_in_block(&self, params: &Params) -> usize {
        let room = params.block_size() - self.unprocessed();
        room.min(self.bytes_without_context.unwrap_or(room))
    }

    fn history(params: &Params) -> usize {
        MAX_HISTORY.min(1 << params.window_bits)
    }

    /// How far the window is filled before it moves.
    fn max_processed(&self, params: &Params) -> usize {
        let history = Self::history(params);
        self.origin.max(self.dictionary_end)
            + history
            + history.max(self.dictionary_end).clamp(1 << 17, MAX_HISTORY)
    }

    /// `input` fits in the block.
    pub(super) fn add_input(&mut self, params: &Params, input: &[u8]) -> Result<()> {
        if let Some(left) = &mut self.bytes_without_context {
            *left -= input.len();
        }
        let received = self.received();
        let needed = received + input.len() + PADDING_AFTER;
        if needed > self.window.capacity() {
            let capacity = if needed < params.block_size().min(1 << 16) {
                needed.max(2 * self.window.capacity())
            } else {
                self.max_processed(params) + params.block_size() + PADDING_AFTER
            };
            memory::try_reserve_total(&mut self.window, capacity)?;
        }
        memory::resize(&mut self.window, received, 0);
        self.window.extend_from_slice(input);
        self.window.extend([0; PADDING_AFTER]);
        Ok(())
    }

    /// Returns false if `input`, which ends the stream, has to be added block by block.
    pub(super) fn compress_whole(
        &mut self,
        params: &Params,
        input: &[u8],
        writer: &mut BitWriter,
    ) -> Result<bool> {
        if !self.window.is_empty()
            || params.stream_offset != 0
            || !BORROWED_SIZES.contains(&input.len())
        {
            return Ok(false);
        }
        (self.origin, self.base, self.processed, self.written) = (0, 0, 0, 0);
        self.prepare(params, input, input.len(), input.len())?;
        self.parse(input, input.len() - PADDING_AFTER, writer)?;
        self.close(input, input.len(), true, writer)?;
        self.compressor.pause();
        Ok(true)
    }

    /// Processes the input, and writes the meta-blocks that are ready.
    pub(super) fn end_block(
        &mut self,
        params: &Params,
        operation: Operation,
        writer: &mut BitWriter,
    ) -> Result<()> {
        let is_last = operation == Operation::Finish;
        let has_context_now = self.bytes_without_context.take_if(|n| *n == 0).is_some();
        let end = self.received();
        let moves = end >= self.max_processed(params);
        let goes_on = operation == Operation::Process && !has_context_now && !moves;
        let mut window = core::mem::take(&mut self.window);
        if self.compressor.is_paused() && end - self.written <= MAX_ALWAYS_STORED {
            let is_compressible = false;
            self.write(
                &window,
                &Ready {
                    end,
                    is_compressible,
                },
                is_last,
                writer,
            )?;
        } else {
            let size = (self.base.wrapping_add(end as u64)).min(1 << 30) as usize;
            if size > self.configured_for && !self.compressor.is_paused() {
                self.close(&window, self.processed, false, writer)?;
                self.compressor.pause();
            }
            if self.compressor.is_paused() {
                let expected = match operation {
                    Operation::Finish => size,
                    _ if size <= self.configured_for => size,
                    _ => params.size_hint.max(4 * size),
                };
                let limit = if goes_on { usize::MAX } else { end };
                self.prepare(params, &window, expected, limit)?;
            }
            self.parse(&window, end, writer)?;
            if !goes_on {
                self.close(&window, end, is_last, writer)?;
                self.compressor.pause();
                if operation == Operation::Flush {
                    self.compressor.shrink();
                }
            }
        }
        if !goes_on {
            self.store_deferred(&window, end, writer)?;
        }
        self.processed = end;
        if moves {
            let dropped = end - Self::history(params) - PADDING_BEFORE;
            window.copy_within(dropped.., 0);
            window.truncate(window.len() - dropped);
            (self.origin, self.dictionary_end) = (0, 0);
            self.base = self.base.wrapping_add(dropped as u64);
            self.processed -= dropped;
            self.written -= dropped;
        }
        self.window = window;
        Ok(())
    }

    fn input<'a>(&self, bytes: &'a [u8]) -> Input<'a> {
        Input {
            bytes,
            origin: self.origin,
            dictionary_end: self.dictionary_end,
            base: self.base,
            stream_offset: self.stream_offset,
        }
    }

    fn prepare(&mut self, params: &Params, bytes: &[u8], size: usize, limit: usize) -> Result<()> {
        let grows = size > self.configured_for;
        if grows {
            let next = &bytes[self.processed..bytes.len() - PADDING_AFTER];
            let known = size + self.dictionary_end;
            let settings = settings(params, self.dictionary_size, known, next);
            self.compressor
                .configure(&settings)
                .map_err(|_| AllocError)?;
            self.configured_for = if size > 200_000 { usize::MAX } else { size };
        }
        (self.compressor.resume(self.written, limit)).map_err(|_| AllocError)?;
        let first = self.origin.max(MIN_BEFORE);
        if grows && first < self.processed {
            let input = self.input(bytes);
            self.compressor.index(&input, first..self.processed);
        }
        Ok(())
    }

    fn parse(&mut self, bytes: &[u8], end: usize, writer: &mut BitWriter) -> Result<()> {
        loop {
            let stop = end.min(self.written + MAX_META_BLOCK_SIZE - PADDING_AFTER);
            if let Some(ready) = self.compressor.parse(&self.input(bytes), stop) {
                self.write(bytes, &ready, false, writer)?;
            } else if stop == end {
                return Ok(());
            } else {
                self.close(bytes, stop, false, writer)?;
            }
        }
    }

    fn close(
        &mut self,
        bytes: &[u8],
        end: usize,
        is_last: bool,
        writer: &mut BitWriter,
    ) -> Result<()> {
        loop {
            let ready = self.compressor.close(&self.input(bytes), end);
            self.write(bytes, &ready, is_last && ready.end == end, writer)?;
            if ready.end == end {
                return Ok(());
            }
        }
    }

    fn write(
        &mut self,
        bytes: &[u8],
        ready: &Ready,
        is_last: bool,
        writer: &mut BitWriter,
    ) -> Result<()> {
        let start = core::mem::replace(&mut self.written, ready.end);
        let length = ready.end - start;
        if ready.is_compressible {
            let kind = if is_last {
                MetaBlockKind::LastCompressed
            } else {
                MetaBlockKind::Compressed
            };
            let (position, deferred) = (writer.position(), self.deferred);
            self.store_deferred(bytes, start, writer)?;
            writer.try_reserve(self.compressor.max_written())?;
            write_header(writer, kind, length);
            let after_header = writer.position();
            writer.write_with(|buffer, at| self.compressor.write(length, buffer, at));
            if writer.position() != after_header
                && writer.position() - position <= 8 * (deferred + length)
            {
                if is_last {
                    writer.align();
                }
                return Ok(());
            }
            writer.rewind(position);
            self.deferred = deferred;
            self.compressor.forget_distances();
        }
        self.deferred += length;
        if is_last || self.deferred >= MIN_STORED {
            self.store_deferred(bytes, ready.end, writer)?;
        }
        if is_last {
            write_empty_last(writer);
        }
        Ok(())
    }

    fn store_deferred(&mut self, bytes: &[u8], end: usize, writer: &mut BitWriter) -> Result<()> {
        let length = core::mem::take(&mut self.deferred);
        if length != 0 {
            writer.try_reserve(length)?;
            write_uncompressed(writer, [&bytes[end - length..end], &[]]);
        }
        Ok(())
    }
}
