//! Methods for `Vec<u16>` and `[u16]`. Indexes are clamped, and an edit that fails to allocate changes nothing. ICU4C: unistr.cpp

use crate::common::memory::{self, defer_oom};
use crate::common::slice_ext::SliceExt;
use crate::common::utf16;
use crate::common::utypes::UErrorCode;
use std::ops::Deref;

/// A UTF-16 string that allocates only above `INLINE_CAPACITY` code units.
pub(crate) struct SmallUString(Repr);

enum Repr {
    Inline {
        length: u8,
        units: [u16; SmallUString::INLINE_CAPACITY],
    },
    Heap(Vec<u16>),
}

#[cfg(target_pointer_width = "64")]
const _: () = assert!(size_of::<SmallUString>() == size_of::<Vec<u16>>());

impl SmallUString {
    const INLINE_CAPACITY: usize = 7;

    pub(crate) const fn new() -> Self {
        Self(Repr::Inline {
            length: 0,
            units: [0; Self::INLINE_CAPACITY],
        })
    }

    pub(crate) fn set(&mut self, text: &[u16]) -> Result<(), UErrorCode> {
        self.set_to_units(text.iter().copied())
    }

    pub(crate) fn set_to_units(
        &mut self,
        text: impl ExactSizeIterator<Item = u16>,
    ) -> Result<(), UErrorCode> {
        self.0 = if text.len() <= Self::INLINE_CAPACITY {
            let (length, mut units) = (text.len() as u8, [0; Self::INLINE_CAPACITY]);
            units.iter_mut().zip(text).for_each(|(to, from)| *to = from);
            Repr::Inline { length, units }
        } else {
            Repr::Heap(memory::try_collect(text)?)
        };
        Ok(())
    }
}

impl Deref for SmallUString {
    type Target = [u16];

    #[inline]
    fn deref(&self) -> &[u16] {
        match &self.0 {
            Repr::Inline { length, units } => units.slice(..usize::from(*length)),
            Repr::Heap(units) => units,
        }
    }
}

/// Collects `units`. The result is empty if out of memory.
pub(crate) fn from_units(units: impl IntoIterator<Item = u16>) -> Vec<u16> {
    defer_oom(memory::try_collect(units)).unwrap_or_default()
}

/// Converts `s` to UTF-16. The result is empty if out of memory.
pub(crate) fn ustr(s: &str) -> Vec<u16> {
    from_units(s.encode_utf16())
}

/// `text == ustr(s)`, without allocating.
pub(crate) fn eq_str(text: &[u16], s: &str) -> bool {
    text.iter().copied().eq(s.encode_utf16())
}

/// Zero-extends each byte.
pub(crate) fn from_invariant(s: &[u8]) -> Vec<u16> {
    from_units(s.iter().map(|&c| u16::from(c)))
}

/// The methods of a `const UnicodeString &`.
pub(crate) trait UStr {
    /// Returns 0xFFFF if `offset` is out of range.
    fn char_at(&self, offset: usize) -> u16;
    /// Returns 0xFFFF if `offset` is out of range.
    fn char32_at(&self, offset: usize) -> u32;
    fn count_char32(&self) -> usize;
    fn index_of(&self, text: &[u16]) -> Option<usize>;
    /// `text` has no surrogates and is not empty.
    fn index_of_from(&self, text: &[u16], start: usize) -> Option<usize>;
    fn index_of_unit(&self, c: u16, start: usize) -> Option<usize>;
    fn temp_sub_string(&self, start: usize, length: usize) -> &[u16];
}

impl UStr for [u16] {
    #[inline]
    fn char_at(&self, offset: usize) -> u16 {
        self.get(offset).copied().unwrap_or(0xffff)
    }

    fn char32_at(&self, offset: usize) -> u32 {
        if offset < self.len() {
            utf16::get(self, offset)
        } else {
            0xffff
        }
    }

    fn count_char32(&self) -> usize {
        utf16::code_points(self).count()
    }

    fn index_of(&self, text: &[u16]) -> Option<usize> {
        self.index_of_from(text, 0)
    }

    fn index_of_from(&self, text: &[u16], start: usize) -> Option<usize> {
        (start..self.len()).find(|&at| self.slice(at..).starts_with(text))
    }

    fn index_of_unit(&self, c: u16, start: usize) -> Option<usize> {
        self.index_of_from(&[c], start)
    }

    fn temp_sub_string(&self, start: usize, length: usize) -> &[u16] {
        let rest = self.get(start..).unwrap_or_default();
        rest.get(..length).unwrap_or(rest)
    }
}

/// The methods that change a `UnicodeString &`.
pub(crate) trait UString {
    fn replace_range(&mut self, start: usize, length: usize, text: &[u16]);
    fn insert_at(&mut self, start: usize, text: &[u16]);
    fn find_and_replace(&mut self, old_text: &[u16], new_text: &[u16]);
    fn reverse_code_points(&mut self);
}

impl UString for Vec<u16> {
    #[cfg_attr(mordant, allow(error_collapsed_to_bool))] // The flag stays set.
    fn replace_range(&mut self, start: usize, length: usize, text: &[u16]) {
        let _ = defer_oom(memory::try_splice(
            self,
            start,
            start.saturating_add(length),
            text,
        ));
    }

    fn insert_at(&mut self, start: usize, text: &[u16]) {
        self.replace_range(start, 0, text);
    }

    fn find_and_replace(&mut self, old_text: &[u16], new_text: &[u16]) {
        let mut start = 0;
        while let Some(pos) = self.index_of_from(old_text, start) {
            self.replace_range(pos, old_text.len(), new_text);
            start = pos + new_text.len();
        }
    }

    fn reverse_code_points(&mut self) {
        self.reverse();
        // Restore the order of the code units in each surrogate pair.
        let mut i = 0;
        while i + 1 < self.len() {
            if utf16::is_trail(u32::from(self.at(i))) && utf16::is_lead(u32::from(self.at(i + 1))) {
                self.swap(i, i + 1);
                i += 2;
            } else {
                i += 1;
            }
        }
    }
}
