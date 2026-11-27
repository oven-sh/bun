//! Which pixels are copied from earlier ones. All others are literals, or looked up in the color cache.

use core::ops::Range;

use super::cache;
use super::entropy::Cost;
use super::histogram::{CACHE, Histogram};
use super::matches::{MAX_LEN, MIN_LEN, Match, common_len};
use crate::error::Result;
use crate::lossless::Argb;
use crate::slice::known;
use crate::vec;

#[derive(Clone, Copy)]
pub(super) struct PixelCopy {
    to: u32,
    from: Match,
}

impl PixelCopy {
    pub(super) const fn new(to: usize, distance: usize, len: usize) -> Self {
        Self {
            to: to as u32,
            from: Match::new(distance, len),
        }
    }

    /// The position of the first pixel.
    const fn start(self) -> usize {
        self.to as usize
    }

    pub(super) const fn len(self) -> usize {
        self.from.len()
    }

    pub(super) const fn distance(self) -> usize {
        self.from.distance()
    }
}

#[inline(always)]
pub(super) fn push(copies: &mut Vec<PixelCopy>, copy: PixelCopy) -> Result<()> {
    copies.try_reserve(1)?;
    copies.push(copy);
    Ok(())
}

/// The pixels in front of each copy and behind the last one.
pub(super) fn gaps(copies: &[PixelCopy], pixels: usize) -> impl Iterator<Item = Range<usize>> {
    let starts = copies.iter().map(|copy| copy.start() + copy.len());
    let ends = copies.iter().map(|copy| copy.start());
    let bounds = [0].into_iter().chain(starts).zip(ends.chain([pixels]));
    bounds.map(|(start, end)| start..end)
}

/// Cuts each match where the one that follows gets farthest.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.c#L514
pub(super) fn greedy(matches: &[Match]) -> Result<Vec<PixelCopy>> {
    let mut copies = Vec::new();
    let mut at = 0;
    while let Some((found, after)) = matches.get(at..).and_then(<[_]>::split_first) {
        let reach = |next: &Match| if next.len() >= MIN_LEN { next.len() } else { 1 } as u32;
        let next_gets_to_end = |next| reach(next) as usize >= after.len();
        let mut len = 1;
        if found.len() >= MIN_LEN && !after.first().is_some_and(next_gets_to_end) {
            // The earlier cut wins among equals.
            let cuts = after.iter().take(found.len()).zip(1..);
            let keys = cuts.map(|(next, cut)| (cut + reach(next)) << 16 | u32::from(!(cut as u16)));
            len = usize::from(!(keys.fold(0, u32::max) as u16));
            if len > 1 {
                push(&mut copies, PixelCopy::new(at, found.distance(), len))?;
            }
        }
        at += len;
    }
    Ok(copies)
}

/// Only from the pixel to the left and from the row above.
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.c#L471
pub(super) fn runs(pixels: &[Argb], width: usize) -> Result<Vec<PixelCopy>> {
    let mut copies = Vec::new();
    let mut at = 1;
    while let Some(here @ [_, ..]) = pixels.get(at..) {
        let wanted = here.get(..MAX_LEN).unwrap_or(here);
        let len_at = |distance| match at.checked_sub(distance).and_then(|from| pixels.get(from..)) {
            Some(source) if source.first() == wanted.first() => common_len(source, wanted),
            _ => 0,
        };
        let (left, above) = (len_at(1), len_at(width));
        let (distance, len) = if left >= above {
            (1, left)
        } else {
            (width, above)
        };
        if len >= MIN_LEN {
            push(&mut copies, PixelCopy::new(at, distance, len))?;
            at += len;
        } else {
            at += 1;
        }
    }
    Ok(copies)
}

/// An image, and what `cache::bits_needed()` says about it.
#[derive(Clone, Copy)]
pub(super) struct Pixels<'a> {
    pub(super) argb: &'a [Argb],
    pub(super) cache_bits_needed: &'a [u8],
    pub(super) width: usize,
}

impl Pixels<'_> {
    fn left_by(&self, copies: &[PixelCopy]) -> impl Iterator<Item = Range<usize>> {
        gaps(copies, self.argb.len()).filter(|gap| gap.start != gap.end)
    }

    /// Each with the number of bits that it needs.
    #[inline(always)]
    pub(super) fn get(&self, range: Range<usize>) -> impl Iterator<Item = (Argb, u32)> {
        let argb = self.argb.get(range.start..range.end);
        let both = argb.zip(self.cache_bits_needed.get(range));
        let (argb, needed) = known(both).unwrap_or_default();
        let pairs = argb.iter().zip(needed);
        pairs.map(|(&argb, &needed)| (argb, needed.into()))
    }

    #[inline(always)]
    pub(super) fn count(&self, range: Range<usize>, cache_bits: u32, histogram: &mut Histogram) {
        for (argb, needed) in self.get(range) {
            if needed <= cache_bits {
                histogram.add(CACHE + cache::key(argb, cache_bits));
            } else {
                histogram.add_literal(argb);
            }
        }
    }
}

/// One way to code an image.
pub(super) struct Coding {
    pub(super) copies: Vec<PixelCopy>,
    pub(super) cache_bits: u32,
    pub(super) cost: Cost,
}

impl Coding {
    /// Sets `histogram`, which gets the distances in pixels, not their codes.
    pub(super) fn new(
        pixels: Pixels,
        copies: Vec<PixelCopy>,
        cache_bits: u32,
        histogram: &mut Histogram,
    ) -> Self {
        histogram.counts.fill(0);
        add_copies(histogram, &copies);
        for gap in pixels.left_by(&copies) {
            pixels.count(gap, cache_bits, histogram);
        }
        Self {
            copies,
            cache_bits,
            cost: histogram.cost(cache_bits),
        }
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/backward_references_enc.c#L755
    pub(super) fn with_best_cache(
        pixels: Pixels,
        copies: Vec<PixelCopy>,
        max_bits: u32,
        best_histogram: &mut Histogram,
    ) -> Result<Self> {
        if max_bits == 0 {
            return Ok(Self::new(pixels, copies, 0, best_histogram));
        }
        // By the number of bits needed, each pixel both as a literal and by its key in the largest cache.
        let mut by_need = vec::filled(Histogram::EMPTY, max_bits as usize)?;
        // It starts with those that need too many.
        let [histogram] = &mut *vec::array(Histogram::EMPTY)?;
        for gap in pixels.left_by(&copies) {
            for (argb, needed) in pixels.get(gap) {
                let to = by_need.get_mut(needed as usize - 1);
                let to = to.unwrap_or(&mut *histogram);
                to.add_literal(argb);
                to.add(CACHE + cache::key(argb, max_bits));
            }
        }

        let keys = || CACHE..CACHE + (1 << max_bits);
        histogram.get_mut(keys()).fill(0);
        add_copies(histogram, &copies);
        for literals in &by_need {
            let counts = histogram.get_mut(0..CACHE).iter_mut().zip(&literals.counts);
            counts.for_each(|(count, literals)| *count += literals);
        }
        *best_histogram = *histogram;
        let mut best = Self {
            copies,
            cache_bits: 0,
            cost: histogram.cost(0),
        };
        let mut hits: &[u32] = &[];
        for (cache_bits, new_hits) in (1..).zip(&mut by_need) {
            let counts = histogram.get_mut(0..CACHE).iter_mut().zip(&new_hits.counts);
            counts.for_each(|(count, new_hits)| *count -= new_hits);
            let new_hits = new_hits.get_mut(keys());
            let counts = new_hits.iter_mut().zip(hits);
            counts.for_each(|(count, old_hits)| *count += old_hits);
            hits = new_hits;
            let keys = histogram.get_mut(CACHE..CACHE + (1 << cache_bits));
            let longer_keys = hits.chunks(1 << (max_bits - cache_bits));
            for (count, counts) in keys.iter_mut().zip(longer_keys) {
                *count = counts.iter().sum();
            }
            let cost = histogram.cost(cache_bits);
            if cost < best.cost {
                (best.cache_bits, best.cost) = (cache_bits, cost);
                *best_histogram = *histogram;
            }
        }
        Ok(best)
    }
}

fn add_copies(histogram: &mut Histogram, copies: &[PixelCopy]) {
    for copy in copies {
        histogram.add_copy(copy.len(), copy.distance() as u32);
    }
}
