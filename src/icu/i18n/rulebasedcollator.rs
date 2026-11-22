//! The collator: settings and comparison. ICU4C: rulebasedcollator.cpp

use crate::common::memory::try_make_mut;
use crate::common::normalizer2impl::{DECOMPOSITION_CAPACITY, NFC};
use crate::common::slice_ext::SliceExt;
use crate::common::uresdata::DataString;
use crate::common::utypes::*;
use crate::common::{utf8, utf16};
use crate::i18n::collationcompare::compare_up_to_quaternary;
use crate::i18n::collationdata::CollationData;
use crate::i18n::collationdatareader::CollationTailoring;
use crate::i18n::collationfastlatin::{self, CodeUnit};
use crate::i18n::collationiterator::{CollationIterator, Text};
use crate::i18n::collationsettings::{CollationSettings, strength};
use crate::i18n::unicode::ucol::*;
use crate::i18n::utf8collationiterator::FcdUtf8Text;
use crate::i18n::utf16collationiterator::FcdUtf16Text;
use std::cmp::Ordering;
use std::ops::Range;
use std::sync::Arc;

pub(crate) struct RuleBasedCollator {
    settings: Arc<CollationSettings>,
    tailoring: Arc<CollationTailoring>,
}

impl RuleBasedCollator {
    pub(crate) fn new(tailoring: Arc<CollationTailoring>) -> Self {
        Self {
            settings: Arc::clone(&tailoring.settings),
            tailoring,
        }
    }

    pub(crate) fn data(&self) -> &CollationData {
        &self.tailoring.data
    }

    pub(crate) fn rules(&self) -> DataString {
        self.tailoring.rules
    }

    /// Copies the settings on write, applies `change` and updates the fast Latin options.
    fn change_settings(
        &mut self,
        change: impl FnOnce(&mut CollationSettings, &CollationData) -> Result<(), UErrorCode>,
    ) -> Result<(), UErrorCode> {
        let (settings, data) = (try_make_mut(&mut self.settings)?, &*self.tailoring.data);
        change(settings, data)?;
        collationfastlatin::update_options(data, settings);
        Ok(())
    }

    pub(crate) fn attribute(&self, attr: UColAttribute) -> Result<UColAttributeValue, UErrorCode> {
        self.settings.attribute(attr)
    }

    pub(crate) fn set_attribute(
        &mut self,
        attr: UColAttribute,
        mut value: UColAttributeValue,
    ) -> Result<(), UErrorCode> {
        if value == UCOL_DEFAULT {
            value = self.tailoring.settings.attribute(attr)?;
        }
        if value == self.attribute(attr)? {
            return Ok(());
        }
        self.change_settings(|settings, _| settings.set_attribute(attr, value))
    }

    /// `group` is a special reorder code.
    pub(crate) fn set_max_variable(&mut self, group: UColReorderCode) -> Result<(), UErrorCode> {
        if group > UCOL_REORDER_CODE_CURRENCY {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        if group == UCOL_REORDER_CODE_FIRST + self.settings.max_variable() {
            return Ok(());
        }
        self.change_settings(|settings, data| {
            settings.set_max_variable(group - UCOL_REORDER_CODE_FIRST);
            settings.variable_top = data.last_primary_for_group(group);
            Ok(())
        })
    }

    pub(crate) fn reorder_code_count(&self) -> usize {
        self.settings.reorder_code_count
    }

    /// Requires the reordering of the tailoring, whose table stays if `codes` are its own.
    pub(crate) fn set_reorder_codes(&mut self, codes: &[i32]) -> Result<(), UErrorCode> {
        if self
            .tailoring
            .reorder_codes
            .iter()
            .eq(codes.iter().copied())
        {
            return Ok(());
        }
        self.change_settings(|settings, data| settings.set_reordering(data, codes))
    }

    /// `c` is a code point or a UTF-16 code unit.
    fn is_unsafe(&self, c: u32) -> bool {
        self.data()
            .is_unsafe_backward(c, self.settings.is_numeric())
    }

    /// The start of the digits before `limit`, or 0 if the first may end a contraction. `previous` steps back from an index.
    fn start_of_number(&self, limit: usize, previous: impl Fn(&mut usize) -> u32) -> usize {
        let (mut start, mut index) = (limit, limit);
        while index > 0
            && let c = previous(&mut index)
            && self.data().is_digit(c)
        {
            start = if self.data().is_unsafe_backward(c, false) {
                0
            } else {
                index
            };
        }
        start
    }

    pub(crate) fn compare<U: Unit>(
        &self,
        left: &[U],
        right: &[U],
    ) -> Result<UCollationResult, UErrorCode> {
        if std::ptr::eq(left, right) {
            return Ok(UCOL_EQUAL);
        }
        let equal_prefix_length = equal_prefix_length(left, right);
        if left.get(equal_prefix_length) == right.get(equal_prefix_length) {
            return Ok(UCOL_EQUAL);
        }
        let start = U::back_up(self, left, right, equal_prefix_length);
        let (data, settings) = (self.data(), &*self.settings);
        if let Some(order) = collationfastlatin::compare_first(settings, left, right, start) {
            return Ok(order as UCollationResult);
        }
        let is_latin = |s: &[U]| s.get(start).is_none_or(|&unit| unit.into() <= U::LATIN_MAX);
        if settings.fast_latin_options >= 0
            && is_latin(left)
            && is_latin(right)
            && let Ok(order) = collationfastlatin::compare(
                data,
                settings,
                left.slice(start..),
                right.slice(start..),
            )
        {
            return Ok(order as UCollationResult);
        }
        // Perf: the smaller frame is worth a call for UTF-16 only.
        if size_of::<U>() == 1 {
            self.compare_ces(left, right, start)
        } else {
            self.compare_ces_out_of_line(left, right, start)
        }
    }

    #[inline(never)]
    fn compare_ces_out_of_line<U: Unit>(
        &self,
        left: &[U],
        right: &[U],
        start: usize,
    ) -> Result<UCollationResult, UErrorCode> {
        self.compare_ces(left, right, start)
    }

    #[inline(always)]
    fn compare_ces<U: Unit>(
        &self,
        left: &[U],
        right: &[U],
        start: usize,
    ) -> Result<UCollationResult, UErrorCode> {
        let (data, settings) = (self.data(), &*self.settings);
        // The iterators get the whole text: prefix matching looks back into the equal prefix.
        let mut order = compare_up_to_quaternary(
            &mut CollationIterator::new(settings.is_numeric(), U::text(left, start)),
            &mut CollationIterator::new(settings.is_numeric(), U::text(right, start)),
            data,
            settings,
        )?;
        if order.is_eq() && strength(settings.options) >= UCOL_IDENTICAL {
            order = compare_identical(left.slice(start..), right.slice(start..))?;
        }
        Ok(order as UCollationResult)
    }
}

#[cold]
pub(crate) fn compare_identical<U: Unit>(left: &[U], right: &[U]) -> Result<Ordering, UErrorCode> {
    compare_nfd(&mut U::text(left, 0), &mut U::text(right, 0))
}

#[inline(always)]
fn equal_prefix_length<U: PartialEq>(left: &[U], right: &[U]) -> usize {
    let common_length = left.len().min(right.len());
    left.iter()
        .zip(right)
        .position(|(l, r)| l != r)
        .unwrap_or(common_length)
}

/// The differences between comparing UTF-16 and UTF-8.
pub(crate) trait Unit: CodeUnit {
    /// The highest first code unit for which fast Latin comparison is tried.
    const LATIN_MAX: u32;

    fn text(s: &[Self], start: usize) -> impl Text;

    /// Moves `index` back to the start of a contraction, a reordering sequence or a number.
    fn back_up(collator: &RuleBasedCollator, left: &[Self], right: &[Self], index: usize) -> usize;
}

impl Unit for u16 {
    const LATIN_MAX: u32 = collationfastlatin::LATIN_MAX;

    fn text(s: &[u16], start: usize) -> impl Text {
        FcdUtf16Text::new(s, start)
    }

    #[inline(always)]
    fn back_up(
        collator: &RuleBasedCollator,
        left: &[u16],
        right: &[u16],
        mut index: usize,
    ) -> usize {
        let is_unsafe_at =
            |s: &[u16], index: usize| s.get(index).is_some_and(|&c| collator.is_unsafe(c.into()));
        if index > 0 && (is_unsafe_at(left, index) || is_unsafe_at(right, index)) {
            index -= 1;
            while index > 0 && is_unsafe_at(left, index) {
                index -= 1;
            }
        }
        let may_be_digit = |s: &[u16]| s.get(index).is_some_and(|&c| c >= 0x660);
        if collator.settings.is_numeric() && (may_be_digit(left) || may_be_digit(right)) {
            index = collator.start_of_number(index, |index| utf16::prev(left, index));
        }
        index
    }
}

impl Unit for u8 {
    const LATIN_MAX: u32 = collationfastlatin::LATIN_MAX_UTF8_LEAD;

    fn text(s: &[u8], start: usize) -> impl Text {
        FcdUtf8Text::new(s, start)
    }

    #[inline(always)]
    fn back_up(collator: &RuleBasedCollator, left: &[u8], right: &[u8], mut index: usize) -> usize {
        let is_trail_at = |s: &[u8], index: usize| s.get(index).is_some_and(|&b| utf8::is_trail(b));
        if index > 0 && (is_trail_at(left, index) || is_trail_at(right, index)) {
            index -= 1;
            while index > 0 && is_trail_at(left, index) {
                index -= 1;
            }
        }
        let is_unsafe_at = |s: &[u8], mut index: usize| {
            index != s.len() && collator.is_unsafe(utf8::next_or_fffd(s, &mut index))
        };
        if index > 0 && (is_unsafe_at(left, index) || is_unsafe_at(right, index)) {
            while collator.is_unsafe(utf8::prev_or_fffd(left, &mut index)) && index > 0 {}
        }
        // U+0660 is D9 A0.
        let may_be_digit = |s: &[u8]| s.get(index).is_some_and(|&b| b >= 0xd9);
        if collator.settings.is_numeric() && (may_be_digit(left) || may_be_digit(right)) {
            index = collator.start_of_number(index, |index| utf8::prev_or_fffd(left, index));
        }
        index
    }
}

struct NfdIterator<'t> {
    text: &'t mut dyn Text,
    decomposition: [u16; DECOMPOSITION_CAPACITY],
    /// The unread part of `decomposition`.
    unread: Range<usize>,
}

impl<'t> NfdIterator<'t> {
    fn new(text: &'t mut dyn Text) -> Self {
        Self {
            text,
            decomposition: Default::default(),
            unread: Range::default(),
        }
    }

    fn next_code_point(&mut self) -> Result<Option<u32>, UErrorCode> {
        if !self.unread.is_empty() {
            return Ok(Some(utf16::next(
                &self.decomposition,
                &mut self.unread.start,
            )));
        }
        self.text.next()
    }

    /// Returns the weight of `c`, which was read last. The end of the text sorts lowest, then U+FFFE.
    fn decomposed(&mut self, c: Option<u32>) -> i64 {
        let Some(c) = c else { return -2 };
        if c == 0xfffe {
            return -1;
        }
        // A code point from `decomposition` does not decompose further.
        let Some(length) = NFC.get_decomposition(c, &mut self.decomposition) else {
            return c.into();
        };
        self.unread = 0..length;
        utf16::next(&self.decomposition, &mut self.unread.start).into()
    }
}

/// The identical level. ICU4C: rulebasedcollator.cpp, compareNFDIter
fn compare_nfd(left: &mut dyn Text, right: &mut dyn Text) -> Result<Ordering, UErrorCode> {
    let (mut left, mut right) = (NfdIterator::new(left), NfdIterator::new(right));
    loop {
        let (left_cp, right_cp) = (left.next_code_point()?, right.next_code_point()?);
        if left_cp == right_cp {
            if left_cp.is_none() {
                return Ok(Ordering::Equal);
            }
            continue;
        }
        let order = left.decomposed(left_cp).cmp(&right.decomposed(right_cp));
        if order.is_ne() {
            return Ok(order);
        }
    }
}
