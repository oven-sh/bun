use bun_highway::text as kernels;

use crate::block::{self, Units, WINDOW};
use crate::search::SHORT;
use crate::search_units::{Experience, Forward, Searcher, candidates};
use crate::{CodeUnit, Text, equal_units, with_text};

/// The indices of the matches of a needle that do not overlap, from the start. The empty needle is at every index
/// up to the length.
#[derive(Clone)]
pub struct Matches<'a> {
    haystack: Text<'a>,
    needle: Text<'a>,
    /// Where the search goes on, if below `places`.
    next: usize,
    /// At how many indices the needle fits.
    places: usize,
    /// A bit for each match from `base` that is found and not returned yet.
    found: u64,
    base: usize,
    experience: Experience,
}

impl<'a> Text<'a> {
    #[inline(always)]
    pub fn matches(self, needle: Text<'a>) -> Matches<'a> {
        self.matches_from(needle, 0)
    }

    /// As if the search had got to `start`.
    #[inline(always)]
    pub fn matches_from(self, needle: Text<'a>, start: usize) -> Matches<'a> {
        Matches {
            haystack: self,
            needle,
            next: start,
            places: (self.len() + 1).saturating_sub(needle.len()),
            found: 0,
            base: 0,
            experience: Experience::new(needle.len()),
        }
    }
}

impl Matches<'_> {
    /// Leaves `found` zero only if there are no more.
    #[inline(never)]
    fn find_more(&mut self) {
        let is_over = match self.needle.len() {
            0 => {
                (self.base, self.found) = (self.next, 1);
                self.next += 1;
                return;
            }
            1 => with_text!(self.haystack, |units| self.find_units(units)),
            _ => with_text!(self.haystack, |haystack| with_text!(
                self.needle,
                |needle| { self.find_needles(haystack, needle) }
            )),
        }
        .is_none();
        if is_over {
            self.next = self.places;
        }
    }

    #[inline(always)]
    fn find_units<T: CodeUnit>(&mut self, units: &[T]) -> Option<()> {
        let unit = T::from_u16(self.needle.at(0))?;
        loop {
            self.base = self.next;
            self.next = units.len().min(self.base + WINDOW);
            self.found = block::window_mask(Units(&units[self.base..self.next], |it| it == unit));
            if self.found != 0 || self.next == units.len() {
                return Some(());
            }
            let start = self.next.min(units.len() - SHORT);
            self.next = start + kernels::find_unit(&units[start..], unit)?;
        }
    }

    #[inline(always)]
    fn find_needles<H: CodeUnit, N: CodeUnit>(
        &mut self,
        haystack: &[H],
        needle: &[N],
    ) -> Option<()> {
        let (base, end) = (self.next, self.places.min(self.next + WINDOW));
        let mut left = candidates(haystack, needle, self.experience.offsets, base..end)?;
        let (mut found, mut free) = (0, 0);
        while left != 0 {
            let bit = left.trailing_zeros() as usize;
            left &= left - 1;
            if bit >= free && equal_units(&haystack[base + bit..][..needle.len()], needle) {
                found |= 1 << bit;
                free = bit + needle.len();
            }
        }
        (self.base, self.found, self.next) = (base, found, end.max(base + free));
        if found == 0 && end < self.places {
            let mut searcher = Searcher::<N, Forward>::with_experience(needle, self.experience);
            self.base = searcher.find(haystack, end)?;
            (self.found, self.next) = (1, self.base + needle.len());
            self.experience = searcher.experience;
        }
        Some(())
    }
}

impl Iterator for Matches<'_> {
    type Item = usize;

    #[inline(always)]
    fn next(&mut self) -> Option<usize> {
        if self.found == 0 {
            if self.next >= self.places {
                return None;
            }
            self.find_more();
            if self.found == 0 {
                return None;
            }
        }
        let bit = self.found.trailing_zeros() as usize;
        self.found &= self.found - 1;
        Some(self.base + bit)
    }

    fn count(mut self) -> usize {
        let mut count = self.found.count_ones() as usize;
        while self.next < self.places {
            self.found = 0;
            self.find_more();
            count += self.found.count_ones() as usize;
        }
        count
    }
}
