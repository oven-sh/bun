//! For each pixel, from where before it the longest run of pixels can be copied.

mod buckets;
mod hash;
mod near;

use core::hint::{Locality, prefetch_read};

use self::buckets::Buckets;
pub(super) use self::near::keep_near;
use super::Quality;
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossless::{Argb, NEIGHBORS};
use crate::slice::{InBounds, known};
use crate::vec;

const LEN_BITS: u32 = 12;
pub(super) const MAX_LEN: usize = (1 << LEN_BITS) - 1;
const MAX_DISTANCE: usize = (1 << (32 - LEN_BITS)) - NEIGHBORS.len();

/// A shorter copy tends to take more bits than the pixels.
pub(super) const MIN_LEN: usize = 4;

/// To stop looking for a longer match.
const LONG_ENOUGH: usize = 256;

/// How many positions before it is needed the CPU is told of what is unlikely to be in its cache.
const PREFETCH_DISTANCE: usize = 16;

#[inline(always)]
fn prefetch<T>(slice: &[T], index: usize) {
    prefetch_read(slice.as_ptr().wrapping_add(index), Locality::L1);
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Match(u32);

impl Match {
    pub(super) const NONE: Self = Self(0);

    #[inline(always)]
    pub(super) const fn new(distance: usize, len: usize) -> Self {
        Self((distance as u32) << LEN_BITS | len as u32)
    }

    #[inline(always)]
    pub(super) const fn distance(self) -> usize {
        (self.0 >> LEN_BITS) as usize
    }

    #[inline(always)]
    pub(super) const fn len(self) -> usize {
        self.0 as usize & MAX_LEN
    }
}

/// A bit for each pixel.
#[inline(always)]
pub(super) fn differences<const N: usize>(a: &[Argb; N], b: &[Argb; N]) -> u8 {
    let mut differ = 0;
    for (i, (a, b)) in a.iter().zip(b).enumerate() {
        differ |= u8::from(a != b) << i;
    }
    differ
}

/// How many pixels `a` and `b` start with in common.
#[inline(always)]
pub(super) fn common_len(a: &[Argb], b: &[Argb]) -> usize {
    let mut len = 0;
    for (a, b) in a.as_chunks::<4>().0.iter().zip(b.as_chunks().0) {
        match differences(a, b) {
            0 => len += 4,
            differ => return len + differ.trailing_zeros() as usize,
        }
    }
    let rest = a.iter().zip(b).skip(len);
    len + rest.take_while(|(a, b)| a == b).count()
}

/// How many pixels `a` and `b` end with in common.
#[inline(always)]
fn common_end_len(a: &[Argb], b: &[Argb]) -> usize {
    let (a_fours, b_fours) = (a.as_rchunks::<4>().1, b.as_rchunks().1);
    let mut len = 0;
    for (a, b) in a_fours.iter().rev().zip(b_fours.iter().rev()) {
        match differences(a, b) {
            0 => len += 4,
            differ => return len + (differ << 4).leading_zeros() as usize,
        }
    }
    let rest = a.iter().rev().zip(b.iter().rev()).skip(len);
    len + rest.take_while(|(a, b)| a == b).count()
}

/// The pixels from some position on, and anything where the image ends.
type Ahead = [Argb; MAX_LEN + 1];

/// What a match is looked for.
struct Target<'a> {
    at: usize,
    pixels: &'a Ahead,
    max_len: usize,
    /// How many earlier positions with the same hash to look at.
    tries: usize,
    /// The first position that is not too far away.
    earliest: usize,
}

impl Target<'_> {
    #[inline(always)]
    fn len_from(&self, source: &Ahead) -> usize {
        common_len(source, self.pixels).min(self.max_len)
    }
}

/// The last pixels and as much padding as `Ahead` takes.
fn padded_end(pixels: &[Argb]) -> Result<Vec<Argb>> {
    let last = pixels.part(pixels.len().saturating_sub(MAX_LEN)..);
    let mut end = vec::with_room(last.len() + MAX_LEN)?;
    end.extend_from_slice(last);
    // All different, so that comparing stops there.
    end.extend(0..MAX_LEN as Argb);
    Ok(end)
}

struct Image<'a> {
    pixels: &'a [Argb],
    width: usize,
    /// From `padded_end()`.
    end: &'a [Argb],
    of_last_pixel: &'a Ahead,
    max_tries: usize,
    max_distance: usize,
}

impl<'a> Image<'a> {
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.c#L241
    fn new(pixels: &'a [Argb], end: &'a [Argb], width: usize, quality: Quality) -> Option<Self> {
        let rows = match quality {
            Quality::Palette => 16,
            Quality::Alpha => 64,
            Quality::Picture => 256,
        };
        end.last_chunk().map(|of_last_pixel| Self {
            pixels,
            width,
            end,
            of_last_pixel,
            max_tries: 8 + quality as usize * quality as usize / 128,
            max_distance: (rows * width).min(MAX_DISTANCE),
        })
    }

    #[inline(always)]
    fn ahead(&self, at: usize) -> &Ahead {
        match self.pixels.get(at..).and_then(<[_]>::first_chunk) {
            Some(ahead) => ahead,
            None => self.ahead_near_the_end(at),
        }
    }

    #[cold]
    fn ahead_near_the_end(&self, at: usize) -> &Ahead {
        let not_in_end = self.pixels.len().saturating_sub(MAX_LEN);
        let ahead = self.end.get(at - not_in_end..);
        known(ahead.and_then(<[_]>::first_chunk)).unwrap_or(self.of_last_pixel)
    }

    /// From `at` back to `first` or a little further. Returns where to go on.
    #[inline(always)]
    fn find(
        &self,
        matches: &mut [Match],
        first: usize,
        mut at: usize,
        mut improve: impl FnMut(&[Match], &Target, Match) -> Match,
    ) -> usize {
        while at >= first.max(1) {
            let mut target = Target {
                at,
                pixels: self.ahead(at),
                // The last pixel is never copied.
                max_len: (self.pixels.len() - 1 - at).min(MAX_LEN),
                tries: self.max_tries - 2,
                earliest: at.saturating_sub(self.max_distance),
            };
            let mut found = Match::NONE;
            if let Some(from) = at.checked_sub(self.width) {
                target.tries -= 1;
                let above = self.ahead(from);
                if above.first() == target.pixels.first() {
                    found = Match::new(self.width, target.len_from(above));
                }
            }
            let left = self.ahead(at - 1);
            if left.first() == target.pixels.first() {
                let len = target.len_from(left);
                if len > found.len() {
                    found = Match::new(1, len);
                }
            }
            if found.len() < MAX_LEN {
                found = improve(matches, &target, found);
            }

            let (distance, len) = (found.distance(), found.len());
            let before_source = (at - distance).wrapping_sub(1);
            if distance == 0 || self.pixels.get(before_source) != left.first() {
                matches.set(at, found);
                at -= 1;
                continue;
            }
            // The pixels before may match at the same distance. Once that has been as long as a match gets for a while,
            // there may be one as long that is nearer.
            let along = match distance {
                1 => at,
                _ => 2 * MAX_LEN - len,
            };
            let source = (at - distance).saturating_sub(along)..at - distance;
            let start = at - common_end_len(self.pixels.part(..at), self.pixels.part(source));
            let along = matches.part_mut(start..=at);
            for (found, len) in along.iter_mut().rev().zip(len as u32..) {
                *found = Match::new(distance, len.min(MAX_LEN as u32) as usize);
            }
            at = start.saturating_sub(1);
        }
        at
    }

    /// Also returns how many links it took.
    fn find_by_links(
        &self,
        links_then_matches: &mut [Match],
        first: usize,
        at: usize,
    ) -> (usize, usize) {
        let mut followed = 0;
        let at = self.find(links_then_matches, first, at, |links, target, found| {
            if let Some(&Match(link)) = links.get(target.at.wrapping_sub(PREFETCH_DISTANCE)) {
                prefetch(links, link as usize);
                prefetch(self.pixels, link as usize);
            }
            let (mut distance, mut len) = (found.distance(), found.len());
            let mut link = links.value(target.at).0 as usize;
            let mut next = target.pixels.at(len);
            let mut tries = target.tries;
            while link > target.earliest
                && tries > 0
                && let Some(&Match(next_link)) = known(links.get(link - 1))
            {
                tries -= 1;
                let from = link - 1;
                link = next_link as usize;
                if self.pixels.get(from + len) != Some(next) {
                    continue;
                }
                let new_len = target.len_from(self.ahead(from));
                if new_len > len {
                    (distance, len) = (target.at - from, new_len);
                    next = target.pixels.at(len);
                    if len >= target.max_len.min(LONG_ENOUGH) {
                        break;
                    }
                }
            }
            followed += target.tries - tries;
            Match::new(distance, len)
        });
        (at, followed)
    }
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.c#L258
pub(super) fn find(pixels: &[Argb], width: usize, quality: Quality) -> Result<Vec<Match>> {
    const BETWEEN_CHECKS: usize = 4 * LONG_ENOUGH;
    const TOO_FEW_TO_SORT: usize = 1 << 13;
    let end = padded_end(pixels)?;
    let image = Image::new(pixels, &end, width, quality).ok_or(Error::Internal)?;
    let most_sorted = image.max_distance + (3 * image.max_distance).max(1 << 19);

    // From the back, where the links are not needed any more, they make way for the matches.
    let mut matches = hash::links(pixels)?;
    let mut buckets = Buckets::default();
    let mut at = pixels.len().saturating_sub(2);
    // Following a link tends to miss the CPU's cache. Sorting costs about as much as following two for each pixel.
    let mut saved_by_sorting = 0;
    while at > 0 {
        let first = at.saturating_sub(BETWEEN_CHECKS);
        let (next, followed) = image.find_by_links(&mut matches, first, at);
        saved_by_sorting = (saved_by_sorting + followed).saturating_sub(2 * (at - next));
        at = next;

        let start = (at + 1).saturating_sub(most_sorted);
        if at > TOO_FEW_TO_SORT && saved_by_sorting > (at - start) / 8 {
            buckets.fill(pixels, start..at + 1)?;
            let first = if start > 0 {
                start + image.max_distance
            } else {
                0
            };
            at = image.find(&mut matches, first, at, |_, target, found| {
                buckets.improve(&image, target, found)
            });
            saved_by_sorting /= 2;
        }
    }
    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn there_has_to_be_a_pixel() {
        assert_eq!(find(&[], 1, Quality::Picture).err(), Some(Error::Internal));
    }
}
