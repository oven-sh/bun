//! Compresses a whole input at once.

use crate::bit_writer::SLACK;
use crate::block::Stream;
use crate::encoder::{Block, Effort, Method, Parser, Scratch, Window};
use crate::output::{Output, Sink};
use crate::{Error, Result, copy_prefix, gzip, zlib};

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

/// The last block may be shorter.
const MIN_BLOCK_LEN: usize = 5000;

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
    window: Window,
    parser: Parser,
    block: Block,
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

        let effort = match level {
            1..=4 => Effort::Low,
            5..=6 => Effort::Medium,
            7 => Effort::High,
            8..=9 => Effort::Highest,
            _ => Effort::Thorough(level - 9),
        };
        let min_len = if level == 1 { 4 } else { 3 };
        let method = Method::Matches { effort, min_len };
        let (window, block) = (&mut self.window, &mut self.block);
        window.size = 1 << 15;
        window.clear();
        block.clear();
        self.parser.clear();
        let parser = &mut self.parser;
        let (mut unread, mut unwritten) = (input, input);
        Scratch::lend(|scratch| {
            if Scratch::has_memory_for(method, input.len()) {
                scratch.lend_memory(window, parser, block);
                copy_prefix(window.extend(input.len()), input);
                let result = match parser.parse(method, window, true, false, scratch, block) {
                    Some(()) => stream.write_tokens(input, block, scratch, true),
                    None => Err(Error::InsufficientSpace),
                };
                scratch.take_memory(window, parser, block);
                return result;
            }
            window.try_reserve(input.len())?;
            block.try_reserve(usize::MAX, input.len())?;
            parser.try_reserve(method, window)?;
            loop {
                let (wanted, read);
                if !window.has_room_for_batch() {
                    window.drop_what_is_too_far();
                }
                wanted = Parser::wanted(window);
                (read, unread) = unread.split_at(wanted.min(unread.len()));
                copy_prefix(window.extend(read.len()), read);
                let start = window.position;
                if start == window.end {
                    return stream.write_tokens(unwritten, block, scratch, true);
                }
                if block.has_room(window.lookahead()) {
                    parser
                        .parse(method, window, unread.is_empty(), false, scratch, block)
                        .ok_or(Error::InsufficientSpace)?;
                    if !block.has_ended() {
                        continue;
                    }
                }
                let data;
                let len = (i64::from(start) - window.block_start) as usize;
                (data, unwritten) = unwritten.split_at(len.min(unwritten.len()));
                window.block_start = start.into();
                stream.write_tokens(data, block, scratch, false)?;
            }
        })?
    }
}
