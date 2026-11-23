//! Pixels to symbols to bits.

use core::convert::Infallible;
use core::ops::Range;

use super::bit_writer::BitWriter;
use super::copies::{self, Coding, PixelCopy, Pixels};
use super::groups::{self, Groups, TileHistograms};
use super::histogram::{Alphabet, BySymbol, CACHE, DISTANCE, Histogram, LENGTH, literal_symbols};
use super::huffman::{self, Word};
use super::matches::{self, Match};
use super::prefix::{Prefixed, distance_code};
use super::tiles::{self, Tiles};
use super::{Quality, cache, cheapest};
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossless::{Argb, MIN_TILE_BITS, TILE_BITS_BITS, subsampled};
use crate::slice::InBounds;
use crate::vec;

/// `histogram` is that of `first_attempt`, and used up.
fn improved(
    first_attempt: Coding,
    histogram: &mut Histogram,
    pixels: Pixels,
    matches: &[Match],
) -> Result<Coding> {
    let copies = cheapest::copies(pixels, matches, &first_attempt, histogram)?;
    let second_attempt = Coding::new(pixels, copies, first_attempt.cache_bits, histogram);
    Ok(if second_attempt.cost < first_attempt.cost {
        second_attempt
    } else {
        first_attempt
    })
}

/// `histogram` is to work in.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.c#L911
fn best_coding(
    pixels: Pixels,
    matches: &[Match],
    max_cache_bits: u32,
    quality: Quality,
    histogram: &mut Histogram,
) -> Result<Coding> {
    let mut coding = |it| Coding::with_best_cache(pixels, it, max_cache_bits, histogram);
    let runs = coding(copies::runs(pixels.argb, pixels.width)?)?;
    let greedy = coding(copies::greedy(matches)?)?;
    if runs.cost < greedy.cost {
        return Ok(runs);
    }
    drop(runs);
    match quality {
        Quality::Palette => Ok(greedy),
        Quality::Alpha | Quality::Picture => improved(greedy, histogram, pixels, matches),
    }
}

enum Piece {
    /// Pixels that are not copied.
    Alone(Range<usize>),
    Copied {
        len: usize,
        distance_code: u32,
    },
}

/// Calls `visit` with the column and row of a tile and something that starts in it, in the order of the pixels.
#[inline(always)]
fn for_each_piece<E>(
    pixels: Pixels,
    copies: &[PixelCopy],
    tile_bits: u32,
    mut visit: impl FnMut(usize, usize, Piece) -> Result<(), E>,
) -> Result<(), E> {
    let width = pixels.width.max(1);
    let (mut x, mut y) = (0, 0);
    let mut copies_left = copies.iter();
    for Range { mut start, end } in copies::gaps(copies, pixels.argb.len()) {
        while start < end {
            let column = x >> tile_bits;
            let len = (width.min((column + 1) << tile_bits) - x).min(end - start);
            visit(column, y >> tile_bits, Piece::Alone(start..start + len))?;
            start += len;
            x += len;
            if x == width {
                (x, y) = (0, y + 1);
            }
        }
        if let Some(copy) = copies_left.next() {
            let piece = Piece::Copied {
                len: copy.len(),
                distance_code: distance_code(copy.distance(), width),
            };
            visit(x >> tile_bits, y >> tile_bits, piece)?;
            x += copy.len();
            if x >= width {
                (x, y) = (x % width, y + x / width);
            }
        }
    }
    Ok(())
}

impl Piece {
    #[inline(always)]
    fn count(self, pixels: Pixels, cache_bits: u32, histogram: &mut Histogram) {
        match self {
            Self::Alone(range) => pixels.count(range, cache_bits, histogram),
            Self::Copied { len, distance_code } => histogram.add_copy(len, distance_code),
        }
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L701
    #[inline(always)]
    fn write(self, pixels: Pixels, cache_bits: u32, words: &BySymbol<u32>, writer: &mut BitWriter) {
        let word = |symbol| Word(*words.at(symbol));
        match self {
            Self::Alone(range) => {
                for (argb, needed) in pixels.get(range) {
                    if needed <= cache_bits {
                        word(CACHE + cache::key(argb, cache_bits)).write(0, 0, writer);
                    } else {
                        let [green, red, blue, alpha] = literal_symbols(argb).map(word);
                        green.write(red.bits(), red.len(), writer);
                        blue.write(alpha.bits(), alpha.len(), writer);
                    }
                }
            }
            Self::Copied { len, distance_code } => {
                for (alphabet, number) in [(LENGTH, len as u32), (DISTANCE, distance_code)] {
                    let prefixed = Prefixed::new(number);
                    let word = word(alphabet + prefixed.symbol);
                    word.write(prefixed.extra, prefixed.extra_len, writer);
                }
            }
        }
    }
}

/// Replaces the count of each symbol by its `Word`. Returns how many bits the pixels are going to take.
fn write_codes(
    histograms: &mut [Histogram],
    cache_bits: u32,
    writer: &mut BitWriter,
) -> Result<usize> {
    let alphabets = Alphabet::all(cache_bits);
    let [largest, ..] = alphabets;
    let mut builder = huffman::Builder::new(largest.len)?;
    let mut bits = 0;
    for histogram in histograms {
        bits += histogram.extra_bits();
        for alphabet in alphabets {
            bits += builder.write_code(histogram.get_mut(alphabet.symbols()), writer);
        }
    }
    Ok(bits as usize)
}

/// The parameters of a transform, or the groups of the tiles.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L769
pub(super) fn write_subimage(
    argb: &[Argb],
    width: usize,
    quality: Quality,
    writer: &mut BitWriter,
) -> Result<()> {
    const ONE_TILE: u32 = usize::BITS / 2;
    let pixels = Pixels {
        argb,
        cache_bits_needed: &cache::bits_needed(argb, 0)?,
        width,
    };
    let matches = matches::find(argb, width, quality)?;
    let [histogram] = &mut *vec::array(Histogram::EMPTY)?;
    let copies = best_coding(pixels, &matches, 0, quality, histogram)?.copies;
    histogram.counts.fill(0);
    let Ok(()) = for_each_piece::<Infallible>(pixels, &copies, ONE_TILE, |_, _, piece| {
        piece.count(pixels, 0, histogram);
        Ok(())
    });
    writer.append_flag(false);
    let bits = write_codes(core::slice::from_mut(histogram), 0, writer)?;
    writer.make_room(bits);
    writer.check()?;
    for_each_piece(pixels, &copies, ONE_TILE, |_, _, piece| {
        piece.write(pixels, 0, &histogram.counts, writer);
        Ok(())
    })
}

pub(super) fn write_tiles(tiles: &Tiles, quality: Quality, writer: &mut BitWriter) -> Result<()> {
    writer.append((tiles.bits - MIN_TILE_BITS).into(), TILE_BITS_BITS);
    write_subimage(&tiles.pixels, tiles.per_row, quality, writer)
}

fn tile_histograms(
    pixels: Pixels,
    coding: &Coding,
    height: usize,
    bits: u32,
) -> Result<TileHistograms> {
    let tiles = tiles::count(pixels.width, height, bits);
    let mut histograms = TileHistograms::new(tiles, coding.cache_bits)?;
    let mut row = vec::filled(Histogram::EMPTY, subsampled(pixels.width, bits))?;
    let mut finish_rows_above = |y: usize, row: &mut [Histogram]| -> Result<()> {
        while histograms.len() < y * row.len() {
            row.iter_mut().try_for_each(|tile| histograms.push(tile))?;
        }
        Ok(())
    };
    for_each_piece::<Error>(pixels, &coding.copies, bits, |x, y, piece| {
        finish_rows_above(y, &mut row)?;
        row.update(x, |tile| piece.count(pixels, coding.cache_bits, tile));
        Ok(())
    })?;
    finish_rows_above(subsampled(height, bits), &mut row)?;
    Ok(histograms)
}

/// How the image itself is coded, once it is transformed.
#[derive(Clone, Copy)]
pub(super) struct Options {
    pub(super) quality: Quality,
    /// For the tiles that can have their own prefix codes.
    pub(super) tile_bits: u32,
    pub(super) max_cache_bits: u32,
    /// Whether to see what comes of copying from nearby only.
    pub(super) tries_near_copies: bool,
}

/// A stream that has everything but the pixels.
struct Unfinished {
    writer: BitWriter,
    missing_bits: usize,
    copies: Vec<PixelCopy>,
    cache_bits: u32,
    /// With words for counts.
    groups: Groups,
}

impl Unfinished {
    fn new(
        mut writer: BitWriter,
        pixels: Pixels,
        coding: Coding,
        height: usize,
        options: Options,
    ) -> Result<Self> {
        let cache_bits = coding.cache_bits;
        let histograms = tile_histograms(pixels, &coding, height, options.tile_bits)?;
        let mut groups = groups::find(&histograms, options.quality)?;
        drop(histograms);

        writer.append_flag(cache_bits > 0);
        if cache_bits > 0 {
            writer.append(cache_bits.into(), 4);
        }
        writer.append_flag(groups.histograms.len() > 1);
        if groups.histograms.len() > 1 {
            let mut tiles = Tiles::new(pixels.width, height, options.tile_bits)?;
            let pixel = |&group| Argb::from(group) << 8;
            tiles.pixels.extend(groups.of_tiles.iter().map(pixel));
            tiles.merge();
            write_tiles(&tiles, options.quality, &mut writer)?;
        }
        let missing_bits = write_codes(&mut groups.histograms, cache_bits, &mut writer)?;
        writer.check()?;
        Ok(Self {
            writer,
            missing_bits,
            copies: coding.copies,
            cache_bits,
            groups,
        })
    }

    fn finished_len(&self) -> usize {
        self.writer.len_with(self.missing_bits)
    }

    fn finish(mut self, pixels: Pixels, tile_bits: u32) -> Result<Vec<u8>> {
        self.writer.make_room(self.missing_bits);
        self.writer.check()?;
        let tiles_per_row = subsampled(pixels.width, tile_bits);
        for_each_piece::<Error>(pixels, &self.copies, tile_bits, |x, y, piece| {
            let group = self.groups.of_tiles.value(y * tiles_per_row + x);
            let words = self.groups.histograms.get(usize::from(group));
            let words = &words.ok_or(Error::Internal)?.counts;
            piece.write(pixels, self.cache_bits, words, &mut self.writer);
            Ok(())
        })?;
        self.writer.finish()
    }
}

/// Adds the image that comes last in a stream.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L862
pub(super) fn finish_with(
    writer: BitWriter,
    argb: &[Argb],
    width: usize,
    height: usize,
    options: Options,
) -> Result<Vec<u8>> {
    let max_cache_bits = options.max_cache_bits;
    let mut matches = matches::find(argb, width, options.quality)?;
    let pixels = Pixels {
        argb,
        cache_bits_needed: &cache::bits_needed(argb, max_cache_bits)?,
        width,
    };
    let [histogram] = &mut *vec::array(Histogram::EMPTY)?;
    let coding = best_coding(pixels, &matches, max_cache_bits, options.quality, histogram)?;
    if !options.tries_near_copies {
        drop(matches);
        let stream = Unfinished::new(writer, pixels, coding, height, options)?;
        return stream.finish(pixels, options.tile_bits);
    }
    let first = Unfinished::new(writer.try_clone()?, pixels, coding, height, options)?;

    matches::keep_near(&mut matches, argb, width)?;
    let greedy = copies::greedy(&matches)?;
    let greedy = Coding::with_best_cache(pixels, greedy, max_cache_bits, histogram)?;
    let coding = improved(greedy, histogram, pixels, &matches)?;
    let second = Unfinished::new(writer, pixels, coding, height, options)?;
    let smaller = if second.finished_len() < first.finished_len() {
        second
    } else {
        first
    };
    smaller.finish(pixels, options.tile_bits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_written_without_a_code() -> Result<()> {
        let stream = Unfinished {
            writer: BitWriter::default(),
            missing_bits: 0,
            copies: Vec::new(),
            cache_bits: 0,
            groups: Groups {
                of_tiles: vec::filled(0, 1)?,
                histograms: Vec::new(),
            },
        };
        let pixels = Pixels {
            argb: &[0],
            cache_bits_needed: &[1],
            width: 1,
        };
        assert_eq!(stream.finish(pixels, 2), Err(Error::Internal));
        Ok(())
    }
}
