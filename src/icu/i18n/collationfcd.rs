//! The fast path of the FCD check, and a cache of checked segments. ICU4C: collationfcd.h

use crate::common::memory::{best_effort, drop_out_of_line, try_box, try_resize};
use crate::common::slice_ext::SliceExt;
use crate::common::utf16;
use crate::i18n::collationfcd_data::{LCCC_BITS, LCCC_INDEX, TCCC_BITS, TCCC_INDEX};

#[inline(always)]
fn has_bit(index: &[u8; 2048], bits: &[u32], c: u32) -> bool {
    index
        .get((c >> 5) as usize)
        .is_some_and(|&i| (bits.at(i.into()) & (1 << (c & 0x1f))) != 0)
}

/// True for all trail surrogates, and for a lead surrogate if any of its code points has lccc != 0.
#[inline(always)]
pub(crate) fn has_lccc(c: u32) -> bool {
    c >= 0x300 && has_bit(&LCCC_INDEX, &LCCC_BITS, c)
}

/// False for trail surrogates. There is a boundary between two units unless the first `has_tccc` and the second `has_lccc`.
#[inline(always)]
pub(crate) fn has_tccc(c: u32) -> bool {
    c >= 0xc0 && has_bit(&TCCC_INDEX, &TCCC_BITS, c)
}

#[inline(always)]
pub(crate) fn lead_or_bmp(c: u32) -> u32 {
    if c <= 0xffff {
        c
    } else {
        utf16::lead(c).into()
    }
}

#[inline(always)]
pub(crate) fn may_have_lccc(c: u32) -> bool {
    has_lccc(lead_or_bmp(c))
}

/// Matches U+0F73, U+0F75 and U+0F81, which must be decomposed even if they pass the check, and a few others.
#[inline(always)]
pub(crate) fn maybe_tibetan_composite_vowel(c: u32) -> bool {
    (c & 0x1f_ff01) == 0xf01
}

pub(crate) fn is_fcd16_of_tibetan_composite_vowel(fcd16: u16) -> bool {
    fcd16 == 0x8182 || fcd16 == 0x8184
}

/// The last long segments of a text, which discontiguous contraction matching reads again and again.
#[derive(Default)]
pub(crate) struct SegmentCache(Option<Box<CachedSegments>>);

impl Drop for SegmentCache {
    #[inline(always)]
    fn drop(&mut self) {
        drop_out_of_line(&mut self.0);
    }
}

#[derive(Default)]
struct CachedSegments {
    /// The segment in the normalization buffer of the text.
    current: Option<Decomposed>,
    /// The segment in `previous_normalized`.
    previous: Option<Decomposed>,
    previous_normalized: Vec<u16>,
    /// The position at which the check started, and the other end of the segment.
    passed_forward: Option<(usize, usize)>,
    passed_backward: Option<(usize, usize)>,
}

#[derive(Clone, Copy)]
struct Decomposed {
    /// The direction matters: from the middle of a run of marks the two directions find different segments.
    is_backward: bool,
    start: usize,
    limit: usize,
}

pub(crate) enum CacheLookup {
    /// The other end of a segment that passes the check.
    Passed(usize),
    /// The start and the limit of the segment that is now in the normalization buffer.
    Decomposed(usize, usize),
}

/// Minimum length of a cached segment, in code units.
const MIN_CACHED_LENGTH: usize = 32;

impl SegmentCache {
    /// Returns the cached segment at `pos` in this direction. May swap `normalized`, which must not be in use.
    pub(crate) fn lookup(
        &mut self,
        normalized: &mut Vec<u16>,
        pos: usize,
        is_backward: bool,
    ) -> Option<CacheLookup> {
        let segments = self.0.as_deref_mut()?;
        let matches = |segment: &Decomposed| {
            segment.is_backward == is_backward
                && pos
                    == if is_backward {
                        segment.limit
                    } else {
                        segment.start
                    }
        };
        if segments.previous.as_ref().is_some_and(matches) {
            std::mem::swap(&mut segments.current, &mut segments.previous);
            std::mem::swap(normalized, &mut segments.previous_normalized);
        }
        if let Some(current) = segments.current.filter(matches) {
            return Some(CacheLookup::Decomposed(current.start, current.limit));
        }
        // Going forward, a segment has the same limit from any position in it.
        let passed = if is_backward {
            segments.passed_backward.filter(|passed| passed.0 == pos)
        } else {
            segments
                .passed_forward
                .filter(|passed| (passed.0..passed.1).contains(&pos))
        };
        passed.map(|passed| CacheLookup::Passed(passed.1))
    }

    /// Returns `None` for a short segment, which is cheaper to compute again, or if allocation fails.
    fn segments_for(&mut self, from: usize, to: usize) -> Option<&mut CachedSegments> {
        if from.abs_diff(to) < MIN_CACHED_LENGTH {
            return None;
        }
        if self.0.is_none() {
            self.0 = best_effort(|| try_box(CachedSegments::default()));
        }
        self.0.as_deref_mut()
    }

    pub(crate) fn insert_passed(&mut self, from: usize, to: usize, is_backward: bool) {
        if let Some(segments) = self.segments_for(from, to) {
            *(if is_backward {
                &mut segments.passed_backward
            } else {
                &mut segments.passed_forward
            }) = Some((from, to));
        }
    }

    /// Saves a cached segment before `normalized` is overwritten with `units` units, unless allocation fails.
    pub(crate) fn save_current(&mut self, normalized: &mut Vec<u16>, units: usize) {
        if let Some(segments) = self.0.as_deref_mut()
            && let Some(current) = segments.current.take()
            && best_effort(|| try_resize(&mut segments.previous_normalized, units, 0)).is_some()
        {
            std::mem::swap(normalized, &mut segments.previous_normalized);
            segments.previous = Some(current);
        }
    }

    pub(crate) fn insert_decomposed(&mut self, start: usize, limit: usize, is_backward: bool) {
        if let Some(segments) = self.segments_for(start, limit) {
            segments.current = Some(Decomposed {
                is_backward,
                start,
                limit,
            });
        }
    }
}
