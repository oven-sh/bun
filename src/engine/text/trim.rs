use core::ops::Range;

use crate::{CodeUnit, Text, with_text};

impl<'a> Text<'a> {
    /// How many units at the start pass. For runs that are short, and tests of any kind.
    #[inline]
    pub fn leading_len(self, test: impl Fn(u16) -> bool) -> usize {
        with_text!(self, |units| units
            .iter()
            .position(|unit| !test(unit.to_u16()))
            .unwrap_or(units.len()))
    }

    /// How many units at the end pass.
    #[inline]
    pub fn trailing_len(self, test: impl Fn(u16) -> bool) -> usize {
        with_text!(self, |units| units
            .iter()
            .rev()
            .position(|unit| !test(unit.to_u16()))
            .unwrap_or(units.len()))
    }

    /// What is left without the units at both ends that pass.
    #[inline]
    pub fn trimmed_range(self, test: impl Fn(u16) -> bool + Copy) -> Range<usize> {
        let start = self.leading_len(test);
        start..self.len() - self.slice_from(start).trailing_len(test)
    }

    #[inline]
    pub fn trim_matches(self, test: impl Fn(u16) -> bool + Copy) -> Text<'a> {
        self.slice(self.trimmed_range(test))
    }
}
