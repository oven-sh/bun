//! Compresses a whole input at once.

use crate::bit_writer::SLACK;
use crate::block::{Sequence, Stream};
use crate::block_splitter::MIN_BLOCK_LEN;
use crate::format::MAX_MATCH_LEN;
use crate::output::{Output, Sink};
use crate::parser::{Effort, GREEDY, LAZIER, LAZY, compress_fastest, compress_with_chains};
use crate::window::Window;
use crate::{Result, gzip, hash_chains, hash_lists, near_optimal, zlib};

/// From 0, which only stores, to [`Level::MAX`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Level(u8);

impl Level {
    pub const DEFAULT: Self = Self(6);
    pub const MAX: u8 = 12;

    pub fn new(level: i32) -> Option<Self> {
        let level = u8::try_from(level).ok()?;
        (level <= Self::MAX).then_some(Self(level))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Raw,
    Zlib,
    Gzip,
}

/// An output length with which [`Compressor::compress`] succeeds.
pub fn compress_bound(input_len: usize, format: Format) -> usize {
    const { assert!(gzip::TRAILER_LEN <= SLACK) };
    let header_len = match format {
        Format::Raw => 0,
        Format::Zlib => zlib::HEADER_LEN,
        Format::Gzip => gzip::HEADER_LEN,
    };
    let blocks = input_len.div_ceil(MIN_BLOCK_LEN).max(1);
    input_len.saturating_add(header_len + 5 * blocks + SLACK)
}

pub fn compress_to_vec(input: &[u8], format: Format, level: Level) -> Result<Vec<u8>> {
    let limit = compress_bound(input.len(), format);
    let mut vec = Vec::new();
    vec.try_reserve_exact(limit)?;
    let output = Output::Vec {
        vec: &mut vec,
        limit,
    };
    Compressor::default().compress(input, format, level, output)?;
    Ok(vec)
}

/// Memory that is kept from one input to the next.
#[derive(Default)]
pub struct Compressor {
    padded: Vec<u8>,
    sequences: Vec<Sequence>,
    table: hash_lists::Storage,
    chains: hash_chains::Storage,
    near_optimal: near_optimal::Storage,
}

impl Compressor {
    /// Returns how many bytes it wrote. It may take up to 8 bytes more room than that.
    #[inline(never)]
    pub fn compress(
        &mut self,
        input: &[u8],
        format: Format,
        Level(level): Level,
        output: Output<'_>,
    ) -> Result<usize> {
        bun_removable_features::removable_definition!(LibdeflateCompressor, Self::compress);
        let mut sink = Sink::new(output, 0);
        let mut wrap = |header: &[u8], trailer: &[u8]| {
            sink.write(0, header)?;
            let mut stream = Stream::new(&mut sink, header.len());
            self.deflate(level, input, &mut stream)?;
            let end = stream.end();
            sink.write(end, trailer)?;
            Ok(end + trailer.len())
        };
        let written = match format {
            Format::Raw => wrap(&[], &[]),
            Format::Zlib => wrap(&zlib::header(level), &zlib::trailer(input)),
            Format::Gzip => wrap(&gzip::header(level), &gzip::trailer(input)),
        };
        sink.finish(written.unwrap_or(0));
        written
    }

    fn deflate(&mut self, level: u8, input: &[u8], stream: &mut Stream<'_, '_>) -> Result<()> {
        // The higher the level, the more it is worth trying with very little.
        if level == 0 || input.len() <= usize::from(55 - 4 * level) {
            return stream.write_stored(input, true);
        }

        let window = Window::new(input, &mut self.padded)?;
        let sequences = &mut self.sequences;
        let (laziness, max_depth, nice_len) = match level {
            1 => return compress_fastest(window, &mut self.table, sequences, stream),
            2 => (GREEDY, 6, 10),
            3 => (GREEDY, 12, 14),
            4 => (GREEDY, 16, 30),
            5 => (LAZY, 16, 30),
            6 => (LAZY, 35, 65),
            7 => (LAZY, 100, 130),
            8 => (LAZIER, 300, MAX_MATCH_LEN),
            9 => (LAZIER, 600, MAX_MATCH_LEN),
            _ => {
                let storage = &mut self.near_optimal;
                return near_optimal::compress(level, window, storage, sequences, stream);
            }
        };
        let effort = Effort {
            max_depth,
            nice_len,
        };
        let chains = &mut self.chains;
        compress_with_chains(window, chains, sequences, laziness, effort, stream)
    }
}
