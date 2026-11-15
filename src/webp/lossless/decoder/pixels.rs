//! Entropy-coded pixels: literals, copies of earlier pixels and colors from the cache.

use super::Rgba;
use super::bit_reader::BitReader;
use super::groups::{Group, Groups, Shortcut};
use super::huffman::Entry;
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossless::{
    LENGTH_CODES, LITERAL_CODES, MAX_CACHE_BITS, MAX_CODE_LENGTH, NEIGHBORS, color_cache_key,
};
use crate::vec;

const MAX_COPY_LEN: usize = 4096;
/// Short copies are made this many pixels at a time, whether or not that is too many.
const COPY_STEP: usize = 8;
/// By how many pixels the image grows at least.
const GROWTH: usize = 8192;

/// What is kept of a pixel.
pub(super) trait Pixel: Copy + Default + PartialEq {
    fn from_rgba(rgba: Rgba) -> Self;
    fn to_rgba(self) -> Rgba;
}

impl Pixel for Rgba {
    #[inline(always)]
    fn from_rgba(rgba: Rgba) -> Self {
        rgba
    }

    #[inline(always)]
    fn to_rgba(self) -> Rgba {
        self
    }
}

/// Green.
impl Pixel for u8 {
    #[inline(always)]
    fn from_rgba([_, green, ..]: Rgba) -> Self {
        green
    }

    #[inline(always)]
    fn to_rgba(self) -> Rgba {
        [0, self, 0, 0]
    }
}

/// How the pixels of an image are coded.
pub(super) struct Coding {
    /// 0: no color cache.
    cache_bits: u32,
    groups: Groups,
}

/// The data of a transform or the entropy image.
pub(super) fn read_subimage(
    reader: &mut BitReader,
    width: usize,
    height: usize,
) -> Result<Vec<Rgba>> {
    let cache_bits = read_cache_bits(reader)?;
    let groups = Groups::read_one(reader, cache_bits)?;
    Coding { cache_bits, groups }.read_pixels(reader, width, height)
}

fn read_cache_bits(reader: &mut BitReader) -> Result<u32> {
    if !reader.read_flag() {
        return Ok(0);
    }
    match reader.read(4) {
        bits @ 1..=MAX_CACHE_BITS => Ok(bits),
        _ => Err(Error::InvalidLosslessBitstream),
    }
}

impl Coding {
    /// That of the main image.
    pub(super) fn read(reader: &mut BitReader, width: usize, height: usize) -> Result<Self> {
        let cache_bits = read_cache_bits(reader)?;
        let groups = if reader.read_flag() {
            Groups::read_many(reader, cache_bits, width, height)?
        } else {
            Groups::read_one(reader, cache_bits)?
        };
        Ok(Self { cache_bits, groups })
    }

    /// Whether green can be told without keeping track of the other channels.
    pub(super) fn green_stands_alone(&self) -> bool {
        self.cache_bits == 0
    }

    pub(super) fn read_pixels<P: Pixel>(
        &self,
        reader: &mut BitReader,
        width: usize,
        height: usize,
    ) -> Result<Vec<P>> {
        match self.cache_bits {
            0 => read_pixels(&self.groups, reader, width, height, &mut NoCache),
            bits => {
                let colors = vec::array([0; 4])?;
                let mut cache = ColorCache { colors, bits };
                read_pixels(&self.groups, reader, width, height, &mut cache)
            }
        }
    }
}

trait Cache {
    fn remember(&mut self, pixel: Rgba);
    fn recall(&self, key: usize) -> Rgba;

    /// All but the first, which does not have to be, and those that are like the one before.
    #[inline(always)]
    fn remember_changes<P: Pixel>(&mut self, pixels: &[P]) {
        let [first, rest @ ..] = pixels else { return };
        let (steps, rest) = rest.as_chunks::<COPY_STEP>();
        let mut last = *first;
        for step in steps {
            if *step != [last; COPY_STEP] {
                step.iter().for_each(|it| self.remember(it.to_rgba()));
                [.., last] = *step;
            }
        }
        rest.iter().for_each(|it| self.remember(it.to_rgba()));
    }
}

struct NoCache;

impl Cache for NoCache {
    #[inline(always)]
    fn remember(&mut self, _: Rgba) {}

    /// The alphabet has no keys.
    #[inline(always)]
    fn recall(&self, _: usize) -> Rgba {
        [0; 4]
    }
}

struct ColorCache {
    colors: Box<[Rgba; 1 << MAX_CACHE_BITS]>,
    /// 1 to `MAX_CACHE_BITS`.
    bits: u32,
}

impl Cache for ColorCache {
    #[inline(always)]
    fn remember(&mut self, pixel: Rgba) {
        let argb = u32::from_be_bytes(pixel).rotate_right(8);
        *self.colors.at_mut(color_cache_key(argb, self.bits)) = pixel;
    }

    #[inline(always)]
    fn recall(&self, key: usize) -> Rgba {
        *self.colors.at(key)
    }
}

fn read_pixels<P: Pixel>(
    groups: &Groups,
    reader: &mut BitReader,
    width: usize,
    height: usize,
    cache: &mut impl Cache,
) -> Result<Vec<P>> {
    let len = width * height;
    let mut pixels = vec::with_room(len + COPY_STEP)?;
    let mut run = Run {
        reader: *reader,
        second_tables: &groups.second_tables,
        distances: core::array::from_fn(|code| neighbor_distance(code, width)),
        len,
    };
    let (mut x, mut y, mut at) = (0, 0, 0);
    while at < len {
        let (group, tile_end) = groups.at(x, y)?;
        let end = at + tile_end.min(width) - x;
        if pixels.len() < (end + MAX_COPY_LEN).min(len + COPY_STEP) {
            if run.reader.is_past_end() {
                return Err(Error::UnexpectedEof);
            }
            let room = end + MAX_COPY_LEN + GROWTH;
            pixels.resize(room.min(len + COPY_STEP), P::default());
        }
        let next = run.read(group, &mut pixels, at, end, cache)?;
        x += next - at;
        at = next;
        while x >= width {
            x -= width;
            y += 1;
        }
    }
    *reader = run.reader;
    if reader.is_past_end() {
        return Err(Error::UnexpectedEof);
    }
    pixels.truncate(len);
    Ok(pixels)
}

fn neighbor_distance(code: usize, width: usize) -> u32 {
    let (left, up) = NEIGHBORS.get(code).copied().unwrap_or_default();
    (i32::from(up) * width as i32 + i32::from(left)).max(1) as u32
}

struct Run<'a, 'b> {
    reader: BitReader<'a>,
    second_tables: &'b [Entry],
    /// What the lowest distance codes stand for.
    distances: [u32; NEIGHBORS.len()],
    /// Of the image.
    len: usize,
}

impl Run<'_, '_> {
    /// Reads pixels from `at` to `end`, or further if a copy does not stop there. Returns where it got to.
    #[inline(always)]
    fn read<P: Pixel>(
        &mut self,
        group: &Group,
        pixels: &mut [P],
        mut at: usize,
        end: usize,
        cache: &mut impl Cache,
    ) -> Result<usize> {
        if group.shortcut == Shortcut::Constant {
            let run = pixels.get_mut(at..end).ok_or(Error::Internal)?;
            run.fill(P::from_rgba(group.constant));
            cache.remember(group.constant);
            return Ok(end);
        }
        let tables = self.second_tables;
        let reader = &mut self.reader;
        while at < end {
            reader.refill();
            let mut literal = group.constant;
            let symbol = if group.shortcut == Shortcut::Packed {
                let packed = group.packed(reader.peek());
                reader.skip(packed.len.into());
                literal = packed.pixel;
                packed.symbol.into()
            } else {
                let symbol = group.green.read(tables, reader);
                if symbol < LITERAL_CODES {
                    let [red, green, blue, alpha] = &mut literal;
                    *green = symbol as u8;
                    if group.shortcut != Shortcut::GreenOnly {
                        *red = group.red.read(tables, reader) as u8;
                        *blue = group.blue.read(tables, reader) as u8;
                        if group.shortcut != Shortcut::ConstantAlpha {
                            reader.ensure(MAX_CODE_LENGTH as u32);
                            *alpha = group.alpha.read(tables, reader) as u8;
                        }
                    }
                }
                symbol
            };
            let pixel = if symbol < LITERAL_CODES {
                literal
            } else if let Some(key) = symbol.checked_sub(LITERAL_CODES + LENGTH_CODES) {
                cache.recall(key)
            } else {
                let count = read_prefixed(symbol - LITERAL_CODES, reader);
                let symbol = group.distance.read(tables, reader);
                reader.ensure(18);
                let code = read_prefixed(symbol, reader);
                let distance = match self.distances.get(code - 1) {
                    Some(&distance) => distance as usize,
                    None => code - self.distances.len(),
                };
                if distance > at || count > self.len - at {
                    return Err(Error::InvalidLosslessBitstream);
                }
                copy(pixels, at, distance, count).ok_or(Error::Internal)?;
                // What repeats counts the last time. The pixel in front has been remembered.
                let unique = at + count - count.min(distance);
                let copied = pixels.get(unique - 1..at + count).ok_or(Error::Internal)?;
                cache.remember_changes(copied);
                at += count;
                continue;
            };
            cache.remember(pixel);
            *pixels.get_mut(at).ok_or(Error::Internal)? = P::from_rgba(pixel);
            at += 1;
        }
        Ok(at)
    }
}

/// A length or a distance code, 1 or more, from its prefix and the extra bits.
#[inline(always)]
fn read_prefixed(symbol: usize, reader: &mut BitReader) -> usize {
    if symbol < 4 {
        return symbol + 1;
    }
    let extra_bits = (symbol as u32 - 2) / 2;
    ((2 + symbol % 2) << extra_bits) + reader.take(extra_bits) as usize + 1
}

/// `count` pixels from `distance` back to `at`, which may repeat what it has just written. Up to `COPY_STEP` more
/// are changed.
#[inline(always)]
fn copy<P: Pixel>(pixels: &mut [P], at: usize, distance: usize, count: usize) -> Option<()> {
    if distance >= COPY_STEP && count <= 4 * COPY_STEP {
        for to in (at..at + count).step_by(COPY_STEP) {
            let step = *pixels.get(to - distance..)?.first_chunk::<COPY_STEP>()?;
            *pixels.get_mut(to..)?.first_chunk_mut()? = step;
        }
        return Some(());
    }
    copy_long(pixels.get_mut(at - distance..at + count)?, distance)
}

/// Fills `pixels` with repetitions of the first `period`.
fn copy_long<P: Pixel>(pixels: &mut [P], period: usize) -> Option<()> {
    if period == 1 {
        let (first, rest) = pixels.split_first_mut()?;
        rest.fill(*first);
        return Some(());
    }
    let mut done = period;
    while done < pixels.len() {
        let (from, to) = pixels.split_at_mut_checked(done)?;
        let count = from.len().min(to.len());
        to.get_mut(..count)?.copy_from_slice(from.get(..count)?);
        done += count;
    }
    Some(())
}
