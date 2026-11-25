//! UTF-8 text for a `CollationIterator`. An ill-formed sequence is U+FFFD. ICU4C: utf8collationiterator.cpp

use crate::common::normalizer2::get_nfd_instance;
use crate::common::normalizer2impl::get_fcd16;
use crate::common::sink::{TextBuf, TextSink, WritableAlias};
use crate::common::slice_ext::SliceExt;
use crate::common::utypes::*;
use crate::common::{utf8, utf16};
use crate::i18n::collationdata::CollationData;
use crate::i18n::collationfcd::{
    CacheLookup, SegmentCache, has_tccc, is_fcd16_of_tibetan_composite_vowel, lead_or_bmp,
    may_have_lccc, maybe_tibetan_composite_vowel,
};
use crate::i18n::collationiterator::{BufferId, INPUT_BUFFER, Text};

/// Returns the code point at `*pos` and its CE32, and advances `*pos`.
#[inline(always)]
fn next_ce32(data: &CollationData, u8: &[u8], pos: &mut usize) -> Option<(u32, u32)> {
    let &b = u8.get(*pos)?;
    if utf8::is_single(b) {
        *pos += 1;
        return Some((u32::from(b), data.trie.get32_from_ascii(b)));
    }
    if (0xe0..0xf0).contains(&b)
        && let (Some(&t1), Some(&t2)) = (u8.get(*pos + 1), u8.get(*pos + 2))
        && utf8::is_valid_lead3_and_t1(b, t1)
        && t2.wrapping_sub(0x80) <= 0x3f
    {
        // U+0800..U+FFFF except surrogates
        let c = (u16::from(b & 0xf) << 12) | (u16::from(t1 & 0x3f) << 6) | u16::from(t2 - 0x80);
        *pos += 3;
        Some((u32::from(c), data.trie.get32_from_u16_single_lead(c)))
    } else if (0xc2..0xe0).contains(&b)
        && let Some(&t1) = u8.get(*pos + 1)
        && t1.wrapping_sub(0x80) <= 0x3f
    {
        // U+0080..U+07FF
        let t1 = t1 - 0x80;
        *pos += 2;
        Some((
            (u32::from(b & 0x1f) << 6) | u32::from(t1),
            data.trie.get32_from_utf8_2b(b, t1),
        ))
    } else {
        let c = utf8::next_or_fffd(u8, pos);
        Some((c, data.ce32(c)))
    }
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    /// `start..pos` passes the check.
    CheckFwd,
    /// `pos..limit` passes the check.
    CheckBwd,
    /// `start..limit` passes the check.
    InFcdSegment,
    /// `start..limit` has failed the check. `pos` is an index in `normalized`.
    InNormalized,
}

/// UTF-8 text that is checked for FCD incrementally and normalized where necessary.
pub(crate) struct FcdUtf8Text<'a> {
    u8: &'a [u8],
    pos: usize,
    state: State,
    start: usize,
    limit: usize,
    normalized: Vec<u16>,
    cache: SegmentCache,
}

impl<'a> FcdUtf8Text<'a> {
    #[inline(always)]
    pub(crate) fn new(text: &'a [u8], pos: usize) -> Self {
        Self {
            u8: text,
            pos,
            state: State::CheckFwd,
            start: pos,
            limit: 0,
            normalized: Vec::new(),
            cache: SegmentCache::default(),
        }
    }

    /// Returns whether there may be no FCD boundary after `c`, which ends at `pos`.
    #[inline(always)]
    fn may_fail_fcd_after(&self, c: u32) -> bool {
        has_tccc(lead_or_bmp(c)) && (maybe_tibetan_composite_vowel(c) || self.next_has_lccc())
    }

    fn next_has_lccc(&self) -> bool {
        self.pos != self.u8.len() && may_have_lccc(utf8::next_or_fffd(self.u8, &mut { self.pos }))
    }

    /// Returns whether there may be no FCD boundary before `c`, which starts at `pos`.
    fn may_fail_fcd_before(&self, c: u32) -> bool {
        may_have_lccc(c)
            && (maybe_tibetan_composite_vowel(c)
                || (self.pos != 0
                    && has_tccc(lead_or_bmp(utf8::prev_or_fffd(self.u8, &mut { self.pos })))))
    }

    /// Called in `CheckBwd`, which leads to a segment that may be empty, or at the end of a segment.
    fn switch_to_forward(&mut self) {
        if self.state == State::CheckBwd {
            (self.start, self.state) = (self.pos, State::InFcdSegment);
        } else {
            if self.state == State::InNormalized {
                (self.start, self.pos) = (self.limit, self.limit);
            }
            self.state = State::CheckFwd;
        }
    }

    /// Called in `CheckFwd`, which leads to a segment that may be empty, or at the start of a segment.
    fn switch_to_backward(&mut self) {
        if self.state == State::CheckFwd {
            (self.limit, self.state) = (self.pos, State::InFcdSegment);
        } else {
            if self.state == State::InNormalized {
                (self.limit, self.pos) = (self.start, self.start);
            }
            self.state = State::CheckBwd;
        }
    }

    /// Checks the segment that starts at `pos`, which is not the end of the text.
    fn find_next_segment(&mut self) -> Result<CacheLookup, UErrorCode> {
        let (mut limit, mut prev_cc, mut fails) = (self.pos, 0, false);
        while limit != self.u8.len() {
            let mut after = limit;
            let fcd16 = get_fcd16(utf8::next_or_fffd(self.u8, &mut after));
            let lead_cc = fcd16 >> 8;
            if lead_cc == 0 && limit != self.pos {
                break;
            }
            limit = after;
            fails |= prev_cc > lead_cc || is_fcd16_of_tibetan_composite_vowel(fcd16);
            // Every character with lccc != 0 has tccc != 0, so a failing segment extends to the next starter.
            prev_cc = fcd16 & 0xff;
            if prev_cc == 0 {
                break;
            }
        }
        if fails {
            return self.normalize(self.pos, limit, false);
        }
        self.cache.insert_passed(self.pos, limit, false);
        Ok(CacheLookup::Passed(limit))
    }

    /// Checks the segment that ends at `pos`, which is not 0.
    fn find_previous_segment(&mut self) -> Result<CacheLookup, UErrorCode> {
        let (mut start, mut next_cc, mut fails) = (self.pos, 0xff, false);
        while start != 0 && next_cc != 0 {
            let mut before = start;
            let fcd16 = get_fcd16(utf8::prev_or_fffd(self.u8, &mut before));
            let trail_cc = fcd16 & 0xff;
            if trail_cc == 0 && start != self.pos {
                break;
            }
            start = before;
            fails |= trail_cc > next_cc || is_fcd16_of_tibetan_composite_vowel(fcd16);
            next_cc = fcd16 >> 8;
        }
        if fails {
            return self.normalize(start, self.pos, true);
        }
        self.cache.insert_passed(self.pos, start, true);
        Ok(CacheLookup::Passed(start))
    }

    /// Decomposes `start..limit`, which is well-formed because all its characters have a non-zero FCD value.
    fn normalize(
        &mut self,
        start: usize,
        limit: usize,
        is_backward: bool,
    ) -> Result<CacheLookup, UErrorCode> {
        let mut stack_buffer = [0; 32];
        let mut segment = WritableAlias::new(&mut stack_buffer, 0);
        let mut i = start;
        while i < limit {
            segment.add_code_point(utf8::next_or_fffd(self.u8, &mut i));
        }
        if segment.is_bogus() {
            return Err(U_MEMORY_ALLOCATION_ERROR);
        }
        self.cache.save_current(&mut self.normalized, segment.len());
        get_nfd_instance()
            .normalize(segment.as_slice(), &mut self.normalized)
            .map(|()| {
                self.cache.insert_decomposed(start, limit, is_backward);
                CacheLookup::Decomposed(start, limit)
            })
    }

    /// Enters the segment at `pos`.
    fn enter_segment(&mut self, is_backward: bool) -> Result<(), UErrorCode> {
        let segment = match self
            .cache
            .lookup(&mut self.normalized, self.pos, is_backward)
        {
            Some(segment) => segment,
            None if is_backward => self.find_previous_segment()?,
            None => self.find_next_segment()?,
        };
        match segment {
            CacheLookup::Passed(end) => {
                *(if is_backward {
                    &mut self.start
                } else {
                    &mut self.limit
                }) = end;
                self.state = State::InFcdSegment;
            }
            CacheLookup::Decomposed(start, limit) => {
                (self.start, self.limit, self.state) = (start, limit, State::InNormalized);
                self.pos = if is_backward {
                    self.normalized.len()
                } else {
                    0
                };
            }
        }
        Ok(())
    }
}

impl Text for FcdUtf8Text<'_> {
    /// Returns lead surrogates inside a normalized segment.
    fn next_ce32(&mut self, data: &CollationData) -> Result<Option<(u32, u32)>, UErrorCode> {
        loop {
            match self.state {
                State::CheckFwd => {
                    let before = self.pos;
                    let Some((c, ce32)) = next_ce32(data, self.u8, &mut self.pos) else {
                        return Ok(None);
                    };
                    if !self.may_fail_fcd_after(c) {
                        return Ok(Some((c, ce32)));
                    }
                    self.pos = before;
                    self.enter_segment(false)?;
                }
                State::InFcdSegment if self.pos != self.limit => {
                    return Ok(next_ce32(data, self.u8, &mut self.pos));
                }
                State::InNormalized if self.pos != self.normalized.len() => {
                    let c = self.normalized.at(self.pos);
                    self.pos += 1;
                    return Ok(Some((
                        u32::from(c),
                        data.trie.get32_from_u16_single_lead(c),
                    )));
                }
                _ => self.switch_to_forward(),
            }
        }
    }

    fn next_trail_surrogate(&mut self) -> Option<u32> {
        let trail = self
            .normalized
            .get(self.pos)
            .map(|&unit| u32::from(unit))
            .filter(|&unit| utf16::is_trail(unit));
        self.pos += usize::from(trail.is_some());
        trail
    }

    fn next(&mut self) -> Result<Option<u32>, UErrorCode> {
        loop {
            match self.state {
                State::CheckFwd => {
                    if self.pos == self.u8.len() {
                        return Ok(None);
                    }
                    let before = self.pos;
                    let c = utf8::next_or_fffd(self.u8, &mut self.pos);
                    if !self.may_fail_fcd_after(c) {
                        return Ok(Some(c));
                    }
                    self.pos = before;
                    self.enter_segment(false)?;
                }
                State::InFcdSegment if self.pos != self.limit => {
                    return Ok(Some(utf8::next_or_fffd(self.u8, &mut self.pos)));
                }
                State::InNormalized if self.pos != self.normalized.len() => {
                    return Ok(Some(utf16::next(&self.normalized, &mut self.pos)));
                }
                _ => self.switch_to_forward(),
            }
        }
    }

    fn previous(&mut self) -> Result<Option<u32>, UErrorCode> {
        loop {
            match self.state {
                State::CheckBwd => {
                    if self.pos == 0 {
                        return Ok(None);
                    }
                    let after = self.pos;
                    let c = utf8::prev_or_fffd(self.u8, &mut self.pos);
                    if !self.may_fail_fcd_before(c) {
                        return Ok(Some(c));
                    }
                    self.pos = after;
                    self.enter_segment(true)?;
                }
                State::InFcdSegment if self.pos != self.start => {
                    return Ok(Some(utf8::prev_or_fffd(self.u8, &mut self.pos)));
                }
                State::InNormalized if self.pos != 0 => {
                    return Ok(Some(utf16::prev(&self.normalized, &mut self.pos)));
                }
                _ => self.switch_to_backward(),
            }
        }
    }

    fn position(&self) -> (BufferId, usize) {
        if self.state == State::InNormalized {
            ((self.start, self.limit), self.pos)
        } else {
            (INPUT_BUFFER, self.pos)
        }
    }
}
