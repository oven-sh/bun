//! A string that grows at both ends and has a field for each code unit. ICU4C: formatted_string_builder.cpp

use crate::common::memory::try_filled;
use crate::common::slice_ext::SliceExt;
use crate::common::utf16;
use crate::common::utypes::{U_INPUT_TOO_LONG_ERROR, UErrorCode};
use crate::i18n::unicode::uformattedvalue::{
    UFIELD_CATEGORY_NUMBER, UFIELD_CATEGORY_UNDEFINED, UFieldCategory,
};
use crate::i18n::unicode::unum::UNumberFormatFields;
use std::ops::Range;

const DEFAULT_CAPACITY: usize = 40;

/// The code units and their fields. The first array has one extra element, which only ever holds a NUL.
enum Storage {
    Inline([u16; DEFAULT_CAPACITY + 1], [Field; DEFAULT_CAPACITY]),
    Heap(Vec<u16>, Vec<Field>),
}

impl Storage {
    fn as_slices(&self) -> (&[u16], &[Field]) {
        match self {
            Self::Inline(chars, fields) => (chars, fields),
            Self::Heap(chars, fields) => (chars, fields),
        }
    }

    fn as_mut_slices(&mut self) -> (&mut [u16], &mut [Field]) {
        match self {
            Self::Inline(chars, fields) => (chars, fields),
            Self::Heap(chars, fields) => (chars, fields),
        }
    }

    fn capacity(&self) -> usize {
        self.as_slices().1.len()
    }

    /// Copies `count` elements of both arrays. Both ranges must be within the capacity.
    fn copy_within(&mut self, from: usize, to: usize, count: usize) {
        let (chars, fields) = self.as_mut_slices();
        chars.move_within(from..from + count, to);
        fields.move_within(from..from + count, to);
    }
}

/// A `UFieldCategory` in the upper four bits and a field of that category in the lower four.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Field(u8);

pub(crate) const UNDEFINED_FIELD: Field = Field::new(UFIELD_CATEGORY_UNDEFINED, 0);
/// Marks numeric characters that have no specific field.
pub(crate) const GENERAL_NUMERIC_FIELD: Field = Field::new(UFIELD_CATEGORY_UNDEFINED, 1);

impl Field {
    pub(crate) const fn new(category: UFieldCategory, field: i32) -> Self {
        Self((category << 4 | field) as u8)
    }

    pub(crate) const fn number(field: UNumberFormatFields) -> Self {
        Self::new(UFIELD_CATEGORY_NUMBER, field)
    }

    pub(crate) fn get_category(self) -> UFieldCategory {
        (self.0 >> 4).into()
    }

    pub(crate) fn get_field(self) -> i32 {
        (self.0 & 0xf).into()
    }

    pub(crate) fn is_numeric(self) -> bool {
        self.get_category() == UFIELD_CATEGORY_NUMBER || self == GENERAL_NUMERIC_FIELD
    }

    pub(crate) fn is_undefined(self) -> bool {
        self.get_category() == UFIELD_CATEGORY_UNDEFINED
    }
}

/// Ignores all changes after the first failure.
pub(crate) struct FormattedStringBuilder {
    storage: Storage,
    /// Index of the first code unit. `zero + length` does not exceed the capacity.
    zero: usize,
    length: usize,
    outcome: Result<(), UErrorCode>,
}

impl FormattedStringBuilder {
    pub(crate) fn new() -> Self {
        let storage = Storage::Inline(
            [0; DEFAULT_CAPACITY + 1],
            [UNDEFINED_FIELD; DEFAULT_CAPACITY],
        );
        Self {
            storage,
            zero: DEFAULT_CAPACITY / 2,
            length: 0,
            outcome: Ok(()),
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.length
    }

    pub(crate) fn code_point_count(&self) -> usize {
        utf16::code_points(self.chars()).count()
    }

    pub(crate) fn chars(&self) -> &[u16] {
        self.storage
            .as_slices()
            .0
            .slice(self.zero..self.zero + self.length)
    }

    pub(crate) fn fields(&self) -> &[Field] {
        self.storage
            .as_slices()
            .1
            .slice(self.zero..self.zero + self.length)
    }

    /// Includes the unit after the text, which is a NUL after `new`, `clear` and `write_terminator`.
    pub(crate) fn chars_with_nul(&self) -> &[u16] {
        self.storage
            .as_slices()
            .0
            .slice(self.zero..self.zero + self.length + 1)
    }

    pub(crate) fn first_code_point(&self) -> Option<u32> {
        self.code_point_at(0)
    }

    pub(crate) fn last_code_point(&self) -> Option<u32> {
        self.code_point_before(self.length)
    }

    pub(crate) fn code_point_at(&self, index: usize) -> Option<u32> {
        (index < self.length).then(|| utf16::get(self.chars(), index))
    }

    pub(crate) fn code_point_before(&self, mut index: usize) -> Option<u32> {
        (index > 0).then(|| {
            utf16::back_1(self.chars(), &mut index);
            utf16::get(self.chars(), index)
        })
    }

    pub(crate) fn clear(&mut self) {
        (self.zero, self.length, self.outcome) = (self.storage.capacity() / 2, 0, Ok(()));
        self.write_nul();
    }

    /// Returns the first failure since `new` or `clear`.
    pub(crate) fn outcome(&self) -> Result<(), UErrorCode> {
        self.outcome
    }

    pub(crate) fn add_all(&mut self, text: &[u16], field: Field) {
        self.insert(self.length, text, field);
    }

    /// All `insert*` methods return the number of code units inserted, which is 0 after a failure.
    pub(crate) fn insert_code_point(
        &mut self,
        index: usize,
        code_point: u32,
        field: Field,
    ) -> usize {
        if code_point <= 0xffff {
            self.insert_unit(index, code_point as u16, field)
        } else {
            self.insert_units(
                index,
                &[utf16::lead(code_point), utf16::trail(code_point)],
                field,
            )
        }
    }

    pub(crate) fn insert_code_point_repeated(
        &mut self,
        index: usize,
        code_point: u32,
        field: Field,
        times: usize,
    ) -> usize {
        let units = utf16::length(code_point);
        let (chars, fields) = self.prepare_for_insert(index, units.saturating_mul(times));
        if units == 1 {
            chars.fill(code_point as u16);
        } else {
            chars
                .as_chunks_mut()
                .0
                .fill([utf16::lead(code_point), utf16::trail(code_point)]);
        }
        fields.fill(field);
        fields.len()
    }

    pub(crate) fn insert(&mut self, index: usize, text: &[u16], field: Field) -> usize {
        match *text {
            [] => 0,
            [unit] => self.insert_unit(index, unit, field),
            _ => self.insert_units(index, text, field),
        }
    }

    fn insert_unit(&mut self, index: usize, unit: u16, field: Field) -> usize {
        let Some(position) = self.prepare_at_end(index, 1) else {
            return self.insert_units(index, &[unit], field);
        };
        let (chars, fields) = self.storage.as_mut_slices();
        chars.set(position, unit);
        fields.set(position, field);
        1
    }

    fn insert_units(&mut self, index: usize, text: &[u16], field: Field) -> usize {
        let (chars, fields) = self.prepare_for_insert(index, text.len());
        chars.copy_at(0, text.slice(..chars.len()));
        fields.fill(field);
        fields.len()
    }

    #[inline]
    pub(crate) fn insert_builder(&mut self, index: usize, other: &FormattedStringBuilder) -> usize {
        self.outcome = self.outcome.and(other.outcome);
        if other.length == 0 {
            0
        } else {
            self.insert_nonempty_builder(index, other)
        }
    }

    #[inline(never)]
    fn insert_nonempty_builder(&mut self, index: usize, other: &FormattedStringBuilder) -> usize {
        let (chars, fields) = self.prepare_for_insert(index, other.length);
        chars.copy_at(0, other.chars().slice(..chars.len()));
        fields.copy_at(0, other.fields().slice(..fields.len()));
        fields.len()
    }

    /// Writes a NUL after the text. After a failure the extra element of the storage has room for it.
    pub(crate) fn write_terminator(&mut self) {
        self.length -= self.open_gap(self.length, 1).len();
        self.write_nul();
    }

    fn write_nul(&mut self) {
        self.storage
            .as_mut_slices()
            .0
            .set(self.zero + self.length, 0);
    }

    /// Opens a gap of `count` code units at `index` and returns it. The slices are empty after a failure.
    #[inline]
    fn prepare_for_insert(&mut self, index: usize, count: usize) -> (&mut [u16], &mut [Field]) {
        let gap = self.open_gap(index, count);
        let (chars, fields) = self.storage.as_mut_slices();
        (chars.slice_mut(gap.clone()), fields.slice_mut(gap))
    }

    #[inline]
    fn open_gap(&mut self, index: usize, count: usize) -> Range<usize> {
        match self.prepare_at_end(index, count) {
            Some(start) => start..start + count,
            None => self.open_gap_by_moving(index, count),
        }
    }

    #[cold]
    fn open_gap_by_moving(&mut self, index: usize, count: usize) -> Range<usize> {
        self.outcome = self
            .outcome
            .and_then(|()| self.prepare_for_insert_helper(index, count));
        let start = self.zero + index;
        if self.outcome.is_ok() {
            start..start + count
        } else {
            Range::default()
        }
    }

    /// Opens the gap if it is at either end and fits in the spare capacity. Returns its index in the storage.
    #[inline(always)]
    fn prepare_at_end(&mut self, index: usize, count: usize) -> Option<usize> {
        self.outcome.ok()?;
        if index == 0 && count <= self.zero {
            self.zero -= count;
        } else if index != self.length || count > self.storage.capacity() - self.zero - self.length
        {
            return None;
        }
        self.length += count;
        Some(self.zero + index)
    }

    fn prepare_for_insert_helper(&mut self, index: usize, count: usize) -> Result<(), UErrorCode> {
        debug_assert!(index <= self.length);
        let (capacity, zero, head) = (self.storage.capacity(), self.zero, index.min(self.length));
        let tail = self.length - head;
        let new_length = self.length.saturating_add(count);
        if new_length > capacity {
            if new_length > i32::MAX as usize / 2 {
                return Err(U_INPUT_TOO_LONG_ERROR);
            }
            let new_capacity = new_length * 2;
            let mut chars = try_filled(0, new_capacity + 1)?;
            let mut fields = try_filled(UNDEFINED_FIELD, new_capacity)?;
            let new_zero = new_length / 2;
            chars.copy_at(new_zero, self.chars().slice(..head));
            chars.copy_at(new_zero + head + count, self.chars().slice(head..));
            fields.copy_at(new_zero, self.fields().slice(..head));
            fields.copy_at(new_zero + head + count, self.fields().slice(head..));
            (self.storage, self.zero) = (Storage::Heap(chars, fields), new_zero);
        } else if head <= tail && count <= zero {
            // Move only the shorter part if there is space, so that many insertions near an end take linear time.
            self.zero = zero - count;
            self.storage.copy_within(zero, self.zero, head);
        } else if head > tail && count <= capacity - zero - self.length {
            self.storage
                .copy_within(zero + head, zero + head + count, tail);
        } else {
            self.zero = (capacity - new_length) / 2;
            self.storage.copy_within(zero, self.zero, self.length);
            self.storage
                .copy_within(self.zero + head, self.zero + head + count, tail);
        }
        self.length = new_length;
        Ok(())
    }

    pub(crate) fn remove(&mut self, start: usize, end: usize) {
        if self.outcome.is_err() {
            return;
        }
        debug_assert!(start <= end && end <= self.length);
        let end = end.min(self.length);
        let start = start.min(end);
        self.storage
            .copy_within(self.zero + end, self.zero + start, self.length - end);
        self.length -= end - start;
    }

    pub(crate) fn content_equals(&self, other: &FormattedStringBuilder) -> bool {
        self.chars() == other.chars() && self.fields() == other.fields()
    }
}
