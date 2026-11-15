//! Entropy-coded pixels: literals, copies of earlier pixels and colors from the cache.

use core::hint::{cold_path, select_unpredictable};

use super::Rgba;
use super::bit_reader::BitReader;
use super::groups::{Group, Groups, Shortcut};
use super::huffman::{Entry, ROOT_BITS};
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossless::{
    LENGTH_CODES, LITERAL_CODES, MAX_CACHE_BITS, MAX_CODE_LENGTH, NEIGHBORS, color_cache_key,
};
use crate::vec;

const MAX_COPY_LEN: usize = 4096;
/// Short copies are made this many pixels at a time, whether or not that is too many.
const COPY_STEP: usize = 8;
/// How many pixels are read before the image grows again.
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
                let spare_bits = MAX_CACHE_BITS - bits;
                let mut cache = ColorCache { colors, spare_bits };
                read_pixels(&self.groups, reader, width, height, &mut cache)
            }
        }
    }
}

trait Cache {
    fn remember(&mut self, pixel: Rgba);
    /// The last `count` of `pixels`.
    fn remember_last<P: Pixel>(&mut self, pixels: &[P], count: usize);
    /// Remembers it as well.
    fn recall(&mut self, key: usize) -> Rgba;
}

struct NoCache;

impl Cache for NoCache {
    #[inline(always)]
    fn remember(&mut self, _: Rgba) {}

    #[inline(always)]
    fn remember_last<P: Pixel>(&mut self, _: &[P], _: usize) {}

    /// The alphabet has no keys.
    #[inline(always)]
    fn recall(&mut self, _: usize) -> Rgba {
        [0; 4]
    }
}

struct ColorCache {
    colors: Box<[Rgba; 1 << MAX_CACHE_BITS]>,
    /// How many zeros behind a key make it an index of `MAX_CACHE_BITS`.
    spare_bits: u32,
}

impl Cache for ColorCache {
    #[inline(always)]
    fn remember(&mut self, pixel: Rgba) {
        let argb = u32::from_be_bytes(pixel).rotate_right(8);
        let key = color_cache_key(argb, MAX_CACHE_BITS) & usize::MAX << self.spare_bits;
        *self.colors.at_mut(key) = pixel;
    }

    #[inline(always)]
    fn remember_last<P: Pixel>(&mut self, pixels: &[P], count: usize) {
        // A few more in front of them change nothing. The first is only there to compare with.
        let count = count.next_multiple_of(COPY_STEP) + 1;
        let Some([first, rest @ ..]) = pixels.get(pixels.len().wrapping_sub(count)..) else {
            cold_path();
            return pixels.iter().for_each(|it| self.remember(it.to_rgba()));
        };
        let mut last = *first;
        for step in rest.as_chunks().0 {
            if *step != [last; COPY_STEP] {
                step.iter().for_each(|it| self.remember(it.to_rgba()));
                [.., last] = *step;
            }
        }
    }

    #[inline(always)]
    fn recall(&mut self, key: usize) -> Rgba {
        let pixel = *self.colors.at(key << self.spare_bits);
        // Only the zeros from the start are not where they belong. One branch, which is not taken.
        if u32::from_le_bytes(pixel) | u32::from(key == 0) == 0 {
            cold_path();
            self.remember(pixel);
        }
        pixel
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
    let (mut x, mut y, mut at) = (0, 0, 0);
    reader.refill();
    while at < len && !reader.is_past_end() {
        let goal = len.min(at + GROWTH);
        pixels.resize(len.min(goal + MAX_COPY_LEN) + COPY_STEP, P::default());
        while at < goal {
            let (group, tables, count) = groups.at(x, y, width)?;
            let (start, end) = (at, goal.min(at + count));
            while at < end {
                let run = pixels.get_mut(at..end).ok_or(Error::Internal)?;
                let (count, prefix) = read_singles(group, tables, reader, run, cache);
                at += count;
                if at == end {
                    break;
                }
                let count = read_prefixed(prefix, reader);
                let prefix = group.distance.read_byte(tables, reader) as usize;
                reader.ensure(18 + ROOT_BITS);
                let distance = distance(read_prefixed(prefix, reader), width);
                if distance > at || count > len - at {
                    return Err(Error::InvalidLosslessBitstream);
                }
                copy(&mut pixels, at, distance, count, cache).ok_or(Error::Internal)?;
                at += count;
            }
            x += at - start;
            while x >= width {
                x -= width;
                y += 1;
            }
        }
    }
    if reader.is_past_end() {
        return Err(Error::UnexpectedEof);
    }
    pixels.truncate(len);
    Ok(pixels)
}

/// Fills `run` up to the first copy. Returns how far it got and, unless that is the end, the prefix of the copy's
/// length. The reader has `ROOT_BITS` at the start of a pixel.
// Out of line, so that the loop has the registers to itself.
#[inline(never)]
fn read_singles<P: Pixel>(
    group: &Group,
    tables: &[Entry],
    shared_reader: &mut BitReader,
    run: &mut [P],
    cache: &mut impl Cache,
) -> (usize, usize) {
    if group.shortcut == Shortcut::Constant {
        run.fill(P::from_rgba(group.constant));
        cache.remember(group.constant);
        return (run.len(), 0);
    }
    let reader = &mut { *shared_reader };
    for (count, place) in run.iter_mut().enumerate() {
        // From before the refill, which the first lookup then does not have to wait for.
        let bits = reader.peek();
        reader.refill();
        let mut pixel = u32::from_le_bytes(group.constant);
        let symbol = if group.shortcut == Shortcut::Packed {
            let packed = group.packed(bits);
            reader.skip(packed.len.into());
            pixel = u32::from_le_bytes(packed.pixel);
            packed.symbol.into()
        } else {
            let symbol = group.green.read(bits, tables, reader);
            if symbol < LITERAL_CODES {
                pixel |= (symbol as u32) << 8;
                if group.shortcut != Shortcut::GreenOnly {
                    pixel |= group.red.read_byte(tables, reader);
                    pixel |= group.blue.read_byte(tables, reader) << 16;
                    if group.shortcut != Shortcut::ConstantAlpha {
                        reader.ensure(MAX_CODE_LENGTH as u32 + ROOT_BITS);
                        pixel |= group.alpha.read_byte(tables, reader) << 24;
                    }
                }
            }
            symbol
        };
        *place = P::from_rgba(if symbol < LITERAL_CODES {
            cache.remember(pixel.to_le_bytes());
            pixel.to_le_bytes()
        } else if let Some(key) = symbol.checked_sub(LITERAL_CODES + LENGTH_CODES) {
            cache.recall(key)
        } else {
            *shared_reader = *reader;
            return (count, symbol - LITERAL_CODES);
        });
    }
    *shared_reader = *reader;
    (run.len(), 0)
}

/// What a distance code stands for.
#[inline(always)]
fn distance(code: usize, width: usize) -> usize {
    let (left, up) = *NEIGHBORS.at((code - 1).min(NEIGHBORS.len() - 1));
    let neighbor = i32::from(up) * width as i32 + i32::from(left);
    select_unpredictable(
        code > NEIGHBORS.len(),
        code.wrapping_sub(NEIGHBORS.len()),
        neighbor.max(1) as usize,
    )
}

/// A length or a distance code, 1 or more, from its prefix and the extra bits.
#[inline(always)]
fn read_prefixed(symbol: usize, reader: &mut BitReader) -> usize {
    let extra_bits = (symbol as u32).saturating_sub(2) / 2;
    let first = select_unpredictable(symbol < 2, symbol, (2 + symbol % 2) << extra_bits);
    first + reader.take(extra_bits) as usize + 1
}

/// `count` pixels from `distance` back to `at`, which may repeat what it has just written. Up to `COPY_STEP` more
/// are changed.
#[inline(always)]
fn copy<P: Pixel>(
    pixels: &mut [P],
    at: usize,
    distance: usize,
    count: usize,
    cache: &mut impl Cache,
) -> Option<()> {
    if distance == 1 {
        let room = count.next_multiple_of(COPY_STEP);
        let (first, rest) = pixels.get_mut(at - 1..at + room)?.split_first_mut()?;
        rest.as_chunks_mut().0.fill([*first; COPY_STEP]);
        return Some(());
    }
    if distance >= COPY_STEP && count <= 4 * COPY_STEP {
        let mut rest = pixels.get_mut(at - distance..)?;
        let mut left = count;
        loop {
            let step = *rest.first_chunk::<COPY_STEP>()?;
            *rest.get_mut(distance..)?.first_chunk_mut()? = step;
            if left <= COPY_STEP {
                break;
            }
            left -= COPY_STEP;
            rest = rest.get_mut(COPY_STEP..)?;
        }
    } else {
        repeat(pixels.get_mut(at - distance..at + count)?, distance)?;
    }
    // What repeats counts the last time.
    cache.remember_last(pixels.get(..at + count)?, count.min(distance));
    Some(())
}

/// Fills `pixels` with repetitions of the first `period`.
#[inline(always)]
fn repeat<P: Pixel>(pixels: &mut [P], period: usize) -> Option<()> {
    let mut done = period;
    while done < pixels.len() {
        let (from, to) = pixels.split_at_mut_checked(done)?;
        let count = from.len().min(to.len());
        to.get_mut(..count)?.copy_from_slice(from.get(..count)?);
        done += count;
    }
    Some(())
}
