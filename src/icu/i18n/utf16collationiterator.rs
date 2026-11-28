//! UTF-16 text for a `CollationIterator`. ICU4C: utf16collationiterator.cpp

use crate::common::normalizer2::get_nfd_instance;
use crate::common::normalizer2impl::get_fcd16;
use crate::common::sink::{TextBuf, US_STACKBUF_SIZE, WritableAlias};
use crate::common::slice_ext::SliceExt;
use crate::common::utf16;
use crate::common::utypes::*;
use crate::i18n::collationdata::CollationData;
use crate::i18n::collationfcd::{self, CacheLookup, SegmentCache};
use crate::i18n::collationiterator::{BufferId, INPUT_BUFFER, Text};
use crate::i18n::collationtrie::Mapping;

#[derive(Clone, Copy, PartialEq, Eq)]
enum CheckDirection {
    /// `segment_start..pos` has passed the check. `limit` is the end of the input.
    Forward,
    /// `pos..segment_limit` has passed the check. `start` is 0.
    Backward,
    /// `segment_start..segment_limit` has passed the check and equals `start..limit`, or it was normalized.
    InSegment,
}

/// Text that is checked for FCD incrementally and normalized where it fails.
pub(crate) struct FcdUtf16Text<'a> {
    raw: &'a [u16],
    /// True if `start`, `pos` and `limit` index `normalized` instead of `raw`.
    in_normalized: bool,
    start: usize,
    pos: usize,
    limit: usize,
    segment_start: usize,
    segment_limit: usize,
    /// The normalized segment. It is in `short` until a segment does not fit there.
    normalized: Vec<u16>,
    short: [u16; US_STACKBUF_SIZE],
    short_length: usize,
    cache: SegmentCache,
    check: CheckDirection,
}

impl<'a> FcdUtf16Text<'a> {
    #[inline(always)]
    pub(crate) fn new(raw: &'a [u16], pos: usize) -> Self {
        Self {
            limit: raw.len(),
            raw,
            in_normalized: false,
            start: pos,
            pos,
            segment_start: pos,
            segment_limit: 0,
            normalized: Vec::new(),
            short: [0; _],
            short_length: 0,
            cache: SegmentCache::default(),
            check: CheckDirection::Forward,
        }
    }

    fn normalized(&self) -> &[u16] {
        if self.normalized.capacity() == 0 {
            self.short.slice(..self.short_length)
        } else {
            &self.normalized
        }
    }

    #[inline(always)]
    fn unit(&self, index: usize) -> u16 {
        if self.in_normalized {
            self.normalized().at(index)
        } else {
            self.raw.at(index)
        }
    }

    /// Called when checking backward or at the end of a segment.
    fn switch_to_forward(&mut self) {
        if self.check == CheckDirection::Backward {
            (self.segment_start, self.start) = (self.pos, self.pos);
            if self.pos != self.segment_limit {
                self.check = CheckDirection::InSegment;
                return;
            }
        } else if self.in_normalized {
            let limit = self.segment_limit;
            (self.segment_start, self.start, self.pos, self.in_normalized) =
                (limit, limit, limit, false);
        }
        (self.limit, self.check) = (self.raw.len(), CheckDirection::Forward);
    }

    /// Called when checking forward or at the start of a segment.
    fn switch_to_backward(&mut self) {
        if self.check == CheckDirection::Forward {
            (self.segment_limit, self.limit) = (self.pos, self.pos);
            if self.pos != self.segment_start {
                self.check = CheckDirection::InSegment;
                return;
            }
        } else if self.in_normalized {
            let start = self.segment_start;
            (self.segment_limit, self.limit, self.pos, self.in_normalized) =
                (start, start, start, false);
        }
        (self.start, self.check) = (0, CheckDirection::Backward);
    }

    /// Enters the segment that starts at `pos`.
    fn next_segment(&mut self) -> Result<(), UErrorCode> {
        let from = self.pos;
        let cached = self.cache.lookup(&mut self.normalized, from, false);
        match cached.map_or_else(|| self.check_forward(), Ok)? {
            CacheLookup::Passed(limit) => (self.segment_limit, self.limit) = (limit, limit),
            CacheLookup::Decomposed(start, limit) => {
                self.enter_normalized(start, limit);
                self.pos = 0;
            }
        }
        self.check = CheckDirection::InSegment;
        Ok(())
    }

    fn check_forward(&mut self) -> Result<CacheLookup, UErrorCode> {
        let (raw, from) = (self.raw, self.pos);
        let (mut p, mut prev_cc) = (from, 0);
        let limit = loop {
            let mut q = p;
            let fcd16 = get_fcd16(utf16::next(raw, &mut p));
            let lead_cc = (fcd16 >> 8) as u8;
            if lead_cc == 0 && q != from {
                break q;
            }
            if lead_cc != 0
                && (prev_cc > lead_cc || collationfcd::is_fcd16_of_tibetan_composite_vowel(fcd16))
            {
                q = p;
                while p != raw.len() && get_fcd16(utf16::next(raw, &mut p)) > 0xff {
                    q = p;
                }
                return self.normalize(from, q, false);
            }
            prev_cc = fcd16 as u8;
            if p == raw.len() || prev_cc == 0 {
                break p;
            }
        };
        self.cache.insert_passed(from, limit, false);
        Ok(CacheLookup::Passed(limit))
    }

    /// Enters the segment that ends at `pos`.
    fn previous_segment(&mut self) -> Result<(), UErrorCode> {
        let from = self.pos;
        let cached = self.cache.lookup(&mut self.normalized, from, true);
        match cached.map_or_else(|| self.check_backward(), Ok)? {
            CacheLookup::Passed(start) => (self.segment_start, self.start) = (start, start),
            CacheLookup::Decomposed(start, limit) => {
                self.enter_normalized(start, limit);
                self.pos = self.limit;
            }
        }
        self.check = CheckDirection::InSegment;
        Ok(())
    }

    fn check_backward(&mut self) -> Result<CacheLookup, UErrorCode> {
        let (raw, from) = (self.raw, self.pos);
        let (mut p, mut next_cc) = (from, 0);
        let start = loop {
            let mut q = p;
            let mut fcd16 = get_fcd16(utf16::prev(raw, &mut p));
            let trail_cc = fcd16 as u8;
            if trail_cc == 0 && q != from {
                break q;
            }
            if (next_cc != 0 && trail_cc > next_cc)
                || collationfcd::is_fcd16_of_tibetan_composite_vowel(fcd16)
            {
                q = p;
                while fcd16 > 0xff && p != 0 {
                    fcd16 = get_fcd16(utf16::prev(raw, &mut p));
                    if fcd16 != 0 {
                        q = p;
                    }
                }
                return self.normalize(q, from, true);
            }
            next_cc = (fcd16 >> 8) as u8;
            if p == 0 || next_cc == 0 {
                break p;
            }
        };
        self.cache.insert_passed(from, start, true);
        Ok(CacheLookup::Passed(start))
    }

    fn normalize(
        &mut self,
        start: usize,
        limit: usize,
        is_backward: bool,
    ) -> Result<CacheLookup, UErrorCode> {
        self.cache.save_current(&mut self.normalized, limit - start);
        let segment = self.raw.slice(start..limit);
        if self.normalized.capacity() == 0 {
            let mut normalized = WritableAlias::new(&mut self.short, 0);
            get_nfd_instance().normalize(segment, &mut normalized)?;
            self.short_length = normalized.len();
            self.normalized = normalized.into_heap().unwrap_or_default();
        } else {
            get_nfd_instance().normalize(segment, &mut self.normalized)?;
        }
        self.cache.insert_decomposed(start, limit, is_backward);
        Ok(CacheLookup::Decomposed(start, limit))
    }

    /// Switches to `normalized`, which holds the input range `from..to`.
    fn enter_normalized(&mut self, from: usize, to: usize) {
        (self.segment_start, self.segment_limit) = (from, to);
        (self.start, self.limit, self.in_normalized) = (0, self.normalized().len(), true);
    }

    fn has_tccc_before(&self, index: usize) -> bool {
        match *self.raw.slice(..index) {
            [.., lead, trail] if utf16::is_trail(trail.into()) && utf16::is_lead(lead.into()) => {
                collationfcd::has_tccc(lead.into())
            }
            [.., unit] => collationfcd::has_tccc(unit.into()),
            [] => false,
        }
    }

    /// Returns whether there may be no FCD boundary after `c`, the input unit at `pos`.
    #[inline(always)]
    fn may_fail_fcd_after(&self, c: u16) -> bool {
        collationfcd::has_tccc(c.into())
            && (collationfcd::maybe_tibetan_composite_vowel(c.into())
                || self
                    .raw
                    .get(self.pos + 1)
                    .is_some_and(|&next| collationfcd::has_lccc(next.into())))
    }

    #[inline(always)]
    fn next_unit(&mut self) -> Result<Option<u16>, UErrorCode> {
        loop {
            if self.check == CheckDirection::Forward {
                let Some(&c) = self.raw.get(self.pos) else {
                    return Ok(None);
                };
                if !self.may_fail_fcd_after(c) {
                    self.pos += 1;
                    return Ok(Some(c));
                }
                self.next_segment()?;
            } else if self.check == CheckDirection::Backward || self.pos == self.limit {
                self.switch_to_forward();
                continue;
            }
            self.pos += 1;
            return Ok(Some(self.unit(self.pos - 1)));
        }
    }

    fn previous_unit(&mut self) -> Result<Option<u16>, UErrorCode> {
        loop {
            if self.check == CheckDirection::Backward {
                let Some(&c) = self.raw.slice(..self.pos).last() else {
                    return Ok(None);
                };
                if !collationfcd::has_lccc(c.into())
                    || !(collationfcd::maybe_tibetan_composite_vowel(c.into())
                        || self.has_tccc_before(self.pos - 1))
                {
                    self.pos -= 1;
                    return Ok(Some(c));
                }
                self.previous_segment()?;
            } else if self.check == CheckDirection::Forward || self.pos == self.start {
                self.switch_to_backward();
                continue;
            }
            self.pos -= 1;
            return Ok(Some(self.unit(self.pos)));
        }
    }
}

impl Text for FcdUtf16Text<'_> {
    #[inline(always)]
    fn next_ce32(&mut self, data: &CollationData) -> Result<Option<(u32, Mapping)>, UErrorCode> {
        Ok(self
            .next_unit()?
            .map(|c| (u32::from(c), data.trie.mapping_of_u16_single_lead(c))))
    }

    fn next_trail_surrogate(&mut self) -> Option<u32> {
        let trail = (self.pos != self.limit)
            .then(|| u32::from(self.unit(self.pos)))
            .filter(|&c| utf16::is_trail(c));
        self.pos += usize::from(trail.is_some());
        trail
    }

    fn is_before_lccc_zero(&self) -> bool {
        // Moving back would change `Forward` to `InSegment`, which reads the same units up to its limit.
        let is_checked = |unit| match self.check {
            CheckDirection::Forward => !self.may_fail_fcd_after(unit),
            CheckDirection::InSegment => !self.in_normalized && self.pos != self.limit,
            CheckDirection::Backward => false,
        };
        self.raw
            .get(self.pos)
            .is_some_and(|&unit| !collationfcd::has_lccc(unit.into()) && is_checked(unit))
    }

    fn next(&mut self) -> Result<Option<u32>, UErrorCode> {
        let Some(c) = self.next_unit()?.map(u32::from) else {
            return Ok(None);
        };
        let trail = if utf16::is_lead(c) {
            self.next_trail_surrogate()
        } else {
            None
        };
        Ok(Some(
            trail.map_or(c, |trail| utf16::get_supplementary(c, trail)),
        ))
    }

    fn previous(&mut self) -> Result<Option<u32>, UErrorCode> {
        let Some(c) = self.previous_unit()?.map(u32::from) else {
            return Ok(None);
        };
        if utf16::is_trail(c) && self.pos != self.start {
            let lead = u32::from(self.unit(self.pos - 1));
            if utf16::is_lead(lead) {
                self.pos -= 1;
                return Ok(Some(utf16::get_supplementary(lead, c)));
            }
        }
        Ok(Some(c))
    }

    fn position(&self) -> (BufferId, usize) {
        if self.in_normalized {
            ((self.segment_start, self.segment_limit), self.pos)
        } else {
            (INPUT_BUFFER, self.pos)
        }
    }
}
