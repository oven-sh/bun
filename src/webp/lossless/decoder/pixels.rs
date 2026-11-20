//! Entropy-coded pixels: literals, copies of earlier pixels and colors from the cache.

use core::hint::cold_path;
use core::ops::Range;

use super::Rgba;
use super::bit_reader::BitReader;
use super::groups::{Group, Groups, Shortcut};
use super::huffman::{Entry, ROOT_BITS};
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossless::{
    LENGTH_CODES, LITERAL_CODES, MAX_CACHE_BITS, MAX_CODE_LENGTH, NEIGHBORS, color_cache_key,
};
use crate::slice::{self, InBounds, known};
use crate::vec;

const MAX_COPY_LEN: usize = 4096;
/// Short copies are made this many pixels at a time, whether or not that is too many.
const COPY_STEP: usize = 8;
/// What is short. Up to `MAX_CHUNKED_LEN` copies are made this many pixels at a time.
const MAX_STEPPED_LEN: usize = 4 * COPY_STEP;
/// For so few a call of `memcpy()` does not pay, least of all musl's.
const MAX_CHUNKED_LEN: usize = 4 * MAX_STEPPED_LEN;
/// Among so few it does not pay to look for steps that are all like the pixel before.
const FEW_STEPS: usize = 8;
/// How many pixels are read before the image grows again.
const GROWTH: usize = 8192;

/// What is kept of a pixel.
trait Pixel: Copy + Default {
    fn from_rgba(rgba: Rgba) -> Self;
}

impl Pixel for Rgba {
    #[inline(always)]
    fn from_rgba(rgba: Rgba) -> Self {
        rgba
    }
}

/// Green.
impl Pixel for u8 {
    #[inline(always)]
    fn from_rgba([_, green, ..]: Rgba) -> Self {
        green
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

    /// If `green_stands_alone()`.
    pub(super) fn read_greens(
        &self,
        reader: &mut BitReader,
        width: usize,
        height: usize,
    ) -> Result<Vec<u8>> {
        read_pixels(&self.groups, reader, width, height, &mut NoCache)
    }

    pub(super) fn read_pixels(
        &self,
        reader: &mut BitReader,
        width: usize,
        height: usize,
    ) -> Result<Vec<Rgba>> {
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

trait Cache<P> {
    fn remember(&mut self, pixel: Rgba);
    /// The last `count` of `pixels`.
    fn remember_last(&mut self, pixels: &[P], count: usize);
    /// Remembers it as well.
    fn recall(&mut self, key: usize) -> Rgba;
}

struct NoCache;

impl<P> Cache<P> for NoCache {
    #[inline(always)]
    fn remember(&mut self, _: Rgba) {}

    #[inline(always)]
    fn remember_last(&mut self, _: &[P], _: usize) {}

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

impl ColorCache {
    /// All but the first of `pixels`, which is there to compare with.
    #[inline(never)]
    fn remember_steps(&mut self, pixels: &[Rgba]) {
        let (mut last, steps) = (pixels.value(0), pixels.as_rchunks().1);
        for step in steps {
            if steps.len() <= FEW_STEPS || *step != [last; COPY_STEP] {
                step.iter().for_each(|&it| self.remember(it));
                [.., last] = *step;
            }
        }
    }
}

impl Cache<Rgba> for ColorCache {
    #[inline(always)]
    fn remember(&mut self, pixel: Rgba) {
        let argb = u32::from_be_bytes(pixel).rotate_right(8);
        let key = color_cache_key(argb, MAX_CACHE_BITS) & usize::MAX << self.spare_bits;
        *self.colors.at_mut(key) = pixel;
    }

    #[inline(always)]
    fn remember_last(&mut self, pixels: &[Rgba], count: usize) {
        if count >= COPY_STEP {
            // A few more in front of them change nothing.
            let start = pixels.len() - count.next_multiple_of(COPY_STEP);
            return self.remember_steps(pixels.part(start - 1..));
        }
        for &pixel in pixels.part(pixels.len() - count..) {
            self.remember(pixel);
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
    cache: &mut impl Cache<P>,
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
            if group.shortcut == Shortcut::Constant {
                pixels
                    .part_mut(start..end)
                    .fill(P::from_rgba(group.constant));
                cache.remember(group.constant);
                at = end;
            } else {
                at = read_run(group, tables, reader, &mut pixels, width, start..end, cache)?;
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

/// Reads the pixels of `run`, or more if a copy does not stop at its end. Returns where it got to. The reader has
/// `ROOT_BITS` at the start of a pixel.
// Out of line, so that the loop has the registers to itself.
#[inline(never)]
fn read_run<P: Pixel>(
    group: &Group,
    tables: &[Entry],
    shared_reader: &mut BitReader,
    pixels: &mut [P],
    width: usize,
    run: Range<usize>,
    cache: &mut impl Cache<P>,
) -> Result<usize> {
    let mut at = run.start;
    let reader = &mut { *shared_reader };
    while at < run.end {
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
        let pixel = if symbol < LITERAL_CODES {
            cache.remember(pixel.to_le_bytes());
            pixel.to_le_bytes()
        } else if let Some(key) = symbol.checked_sub(LITERAL_CODES + LENGTH_CODES) {
            cache.recall(key)
        } else {
            // Not rare, but the registers are better spent on the rest of the loop.
            cold_path();
            let count = read_prefixed(symbol - LITERAL_CODES, reader);
            let prefix = group.distance.read_byte(tables, reader) as usize;
            reader.ensure(18 + ROOT_BITS);
            let distance = distance(read_prefixed(prefix, reader), width);
            copy(pixels, at, distance, count, cache).ok_or(Error::InvalidLosslessBitstream)?;
            at += count;
            continue;
        };
        *pixels.get_mut(at).ok_or(Error::Internal)? = P::from_rgba(pixel);
        at += 1;
    }
    *shared_reader = *reader;
    Ok(at)
}

/// What a distance code stands for.
#[inline(always)]
fn distance(code: usize, width: usize) -> usize {
    match NEIGHBORS.get(code - 1) {
        Some(&(left, up)) => (i32::from(up) * width as i32 + i32::from(left)).max(1) as usize,
        None => code - NEIGHBORS.len(),
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
/// are changed: `pixels` end that far behind the image, or have room for any copy.
#[inline(always)]
fn copy<P: Pixel>(
    pixels: &mut [P],
    at: usize,
    distance: usize,
    count: usize,
    cache: &mut impl Cache<P>,
) -> Option<()> {
    if distance > at || count + COPY_STEP > pixels.len() - at {
        return None;
    }
    if distance == 1 {
        let reach = pixels.get_mut(at - 1..at + count.next_multiple_of(COPY_STEP));
        let reach = reach.and_then(<[_]>::split_first_mut);
        return reach.map(|(first, rest)| rest.as_chunks_mut().0.fill([*first; COPY_STEP]));
    }
    if distance == 2 {
        cold_path();
        let reach = pixels.get_mut(at - 2..at + count.next_multiple_of(COPY_STEP))?;
        let (&mut [a, b], rest) = reach.split_first_chunk_mut()?;
        let steps = rest.as_chunks_mut::<COPY_STEP>().0;
        steps.fill([a, b, a, b, a, b, a, b]);
        // The same pair again leaves the cache as it is.
        let done = pixels.get(..at + count);
        return done.map(|done| cache.remember_last(done, count % 2));
    }
    let copied = if count <= MAX_STEPPED_LEN {
        let (mut to, mut back) = (at, distance);
        loop {
            let copied = copy_step(pixels, to - back, to);
            to += back.min(COPY_STEP);
            if copied.is_none() || to >= at + count {
                break copied;
            }
            // What was there is there twice now.
            if back < COPY_STEP {
                back *= 2;
            }
        }
    } else {
        let reach = pixels.get_mut(at - distance..at + count + COPY_STEP);
        reach.map(|reach| repeat(reach, distance))
    };
    // The last `distance` pixels again leave the cache as it is, and what repeats counts the last time.
    let fresh = count.checked_sub(distance).unwrap_or(count).min(distance);
    let done = copied.and_then(|()| pixels.get(..at + count));
    done.map(|done| cache.remember_last(done, fresh))
}

#[inline(always)]
fn copy_step<P: Pixel>(pixels: &mut [P], from: usize, to: usize) -> Option<()> {
    let step = *pixels.get(from..)?.first_chunk::<COPY_STEP>()?;
    *pixels.get_mut(to..)?.first_chunk_mut()? = step;
    Some(())
}

/// Fills `pixels` with repetitions of the first `period`. The last `COPY_STEP` get anything.
#[inline(never)]
fn repeat<P: Pixel>(pixels: &mut [P], period: usize) {
    // For more, glibc uses `rep movsb`, which is slow on AMD CPUs from a little more than whole pages back.
    // https://bugs.launchpad.net/ubuntu/+source/glibc/+bug/2030515
    const PIECE_BYTES: usize = 2048;
    let piece = PIECE_BYTES / size_of::<P>();
    let mut done = period;
    while let Some((from, to)) = pixels.split_at_mut_checked(done)
        && to.len() > COPY_STEP
    {
        let len = done.min(to.len() - COPY_STEP);
        if len <= MAX_STEPPED_LEN {
            for from in (0..len).step_by(COPY_STEP) {
                known(copy_step(pixels, from, done + from));
            }
        } else if len <= MAX_CHUNKED_LEN {
            for start in (0..len).step_by(MAX_STEPPED_LEN) {
                let start = start.min(len - MAX_STEPPED_LEN);
                to.set_chunk::<MAX_STEPPED_LEN>(start, from.chunk(start));
            }
        } else {
            let pieces = from.part(..len).chunks(piece).zip(to.chunks_mut(piece));
            pieces.for_each(|(from, to)| slice::copy(from, to));
        }
        done *= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slice::checked;

    /// No cache, tiles of 4x4, and one symbol in each code.
    const ZEROS: [u8; 6] = [0x42, 0x44, 0x44, 0x44, 0x44, 0x04];

    #[test]
    fn nothing_is_read_without_a_code() -> Result<()> {
        let mut reader = BitReader::new(&ZEROS);
        let coding = Coding::read(&mut reader, 4, 4)?;
        let mut read = |height| coding.read_greens(&mut reader, 4, height);
        assert_eq!(read(4)?, [0; 16]);
        assert_eq!(read(5), Err(Error::Internal));
        Ok(())
    }

    #[test]
    fn nothing_is_read_without_room() -> Result<()> {
        let reader = &mut BitReader::new(&ZEROS);
        let coding = Coding::read(reader, 4, 4)?;
        let (group, tables, _) = coding.groups.at(0, 0, 4)?;
        let mut read = |run| read_run(group, tables, reader, &mut [0u8], 4, run, &mut NoCache);
        assert_eq!(read(0..1), Ok(1));
        assert_eq!(read(0..2), Err(Error::Internal));
        Ok(())
    }

    #[test]
    fn a_copy_repeats_what_is_in_front_of_it() {
        fn check<P: Pixel + PartialEq>(distance: usize, count: usize) {
            const START: usize = 3;
            let pixel = |i: usize| P::from_rgba([(i >> 8) as u8, (i % 251) as u8, 0, 0]);
            let (at, spare) = (START + distance, pixel(usize::MAX));
            let mut pixels = Vec::new();
            pixels.extend((0..at).map(pixel));
            pixels.resize(at + count + 2 * COPY_STEP, spare);
            let copied = checked(|| Ok(copy(&mut pixels, at, distance, count, &mut NoCache)));
            let (copies, rest) = pixels.part(at..).split_at(count);
            let expected = (0..count).map(|i| pixel(START + i % distance));
            assert!(
                copied == Ok(Some(()))
                    && expected.eq(copies.iter().copied())
                    && rest.ends_with(&[spare; COPY_STEP]),
                "{count} from {distance} back"
            );
        }
        let lens = || (1..70).chain([96, 97, 128, 129, 511, 513, 2047, 2049, MAX_COPY_LEN]);
        for (distance, count) in lens().flat_map(|it| lens().map(move |other| (it, other))) {
            check::<u8>(distance, count);
            check::<Rgba>(distance, count);
        }
    }

    #[test]
    fn a_copy_leaves_the_cache_as_its_pixels_one_by_one_do() -> Result<()> {
        const AT: usize = 200;
        let lens = || (1..40).chain([63, 64, 65, 71, 72, 73, 100, 199, AT]);
        for (bits, run) in [(1, 1), (1, 9), (3, 1), (3, 20), (MAX_CACHE_BITS, 1)] {
            let cache = |pixels: &[Rgba]| -> Result<_> {
                let (colors, spare_bits) = (vec::array([0; 4])?, MAX_CACHE_BITS - bits);
                let mut cache = ColorCache { colors, spare_bits };
                pixels.iter().for_each(|&it| cache.remember(it));
                Ok(cache)
            };
            for (distance, count) in lens().flat_map(|it| lens().map(move |other| (it, other))) {
                let mut pixels = Vec::new();
                pixels.extend((0..AT).map(|i| [1, ((i / run).pow(2) % 61) as u8, 2, 3]));
                pixels.resize(AT + count + COPY_STEP, [0; 4]);
                let mut actual = cache(pixels.part(..AT))?;
                let copied = checked(|| Ok(copy(&mut pixels, AT, distance, count, &mut actual)));
                let expected = cache(pixels.part(..AT + count))?;
                assert!(
                    copied == Ok(Some(())) && actual.colors == expected.colors,
                    "{count} from {distance} back"
                );
            }
        }
        Ok(())
    }

    #[test]
    fn nothing_is_copied_without_room() {
        let copy = |from, to| copy_step(&mut [0u8; COPY_STEP], from, to);
        assert_eq!(copy(0, 0), Some(()));
        for outside in [1, COPY_STEP + 1] {
            assert_eq!([copy(outside, 0), copy(0, outside)], [None; 2]);
        }
    }

    #[test]
    fn nothing_is_recalled_without_a_cache() {
        assert_eq!(Cache::<u8>::recall(&mut NoCache, 0), [0; 4]);
    }
}
