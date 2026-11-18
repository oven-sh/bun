//! The text that a formatter produced, and what each span of it stands for.

use core::ops::Range;
use core::ptr::NonNull;

use crate::Result;
use crate::error::Status;
use crate::ffi::{borrowed, call, open};

bun_opaque::opaque_ffi! {
    pub(crate) struct UFormattedValue;
    struct UConstrainedFieldPosition;
    pub(crate) struct UFieldPositionIterator;
}

icu_functions! {
    fn ufmtval_getString(value: *const UFormattedValue, length: &mut i32, status: &mut Status) -> *const u16;
    fn ufmtval_nextPosition(value: *const UFormattedValue, position: *mut UConstrainedFieldPosition, status: &mut Status) -> i8;
    fn ucfpos_open(status: &mut Status) -> *mut UConstrainedFieldPosition;
    fn ucfpos_close(position: *mut UConstrainedFieldPosition);
    fn ucfpos_constrainCategory(position: *mut UConstrainedFieldPosition, category: i32, status: &mut Status);
    fn ucfpos_constrainField(position: *mut UConstrainedFieldPosition, category: i32, field: i32, status: &mut Status);
    fn ucfpos_getCategory(position: *const UConstrainedFieldPosition, status: &mut Status) -> i32;
    fn ucfpos_getField(position: *const UConstrainedFieldPosition, status: &mut Status) -> i32;
    fn ucfpos_getIndexes(position: *const UConstrainedFieldPosition, start: &mut i32, end: &mut i32, status: &mut Status);
    fn ufieldpositer_open(status: &mut Status) -> *mut UFieldPositionIterator;
    fn ufieldpositer_close(positions: *mut UFieldPositionIterator);
    fn ufieldpositer_next(positions: *mut UFieldPositionIterator, start: &mut i32, end: &mut i32) -> i32;
}

/// Says which enumeration the number of a field belongs to.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Category(i32);

impl Category {
    pub const DATE: Category = Category(1);
    pub const NUMBER: Category = Category(2);
    pub const LIST: Category = Category(3);
    /// Field 0 is the start and field 1 is the end.
    pub const DATE_INTERVAL_SPAN: Category = Category(0x1005);
    /// Field 0 is the start and field 1 is the end.
    pub const NUMBER_RANGE_SPAN: Category = Category(0x1002);
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Field {
    pub category: Category,
    pub field: i32,
    pub range: Range<usize>,
}

fn range(start: i32, end: i32) -> Range<usize> {
    usize::try_from(start).unwrap_or(0)..usize::try_from(end).unwrap_or(0)
}

/// A view of the result object that `'a` borrows.
#[derive(Clone, Copy)]
pub struct FormattedValue<'a>(&'a UFormattedValue);

impl<'a> FormattedValue<'a> {
    /// # Safety
    /// `function` returns a view of a result that nothing formats into or closes during `'a`.
    pub(crate) unsafe fn new(
        function: impl FnOnce(&mut Status) -> *const UFormattedValue,
    ) -> Result<FormattedValue<'a>> {
        let value = open(|status| function(status).cast_mut())?;
        // SAFETY: the caller's.
        Ok(FormattedValue(unsafe { value.as_ref() }))
    }

    pub fn text(self) -> Result<&'a [u16]> {
        let mut length = 0;
        // SAFETY: the result is open.
        let text = call(|status| unsafe { ufmtval_getString(self.0, &mut length, status) })?;
        // SAFETY: the result owns the text.
        Ok(unsafe { borrowed(text, length) })
    }

    /// Fields nest. A span comes before the fields inside it.
    pub fn fields(self) -> Result<Fields<'a>> {
        // SAFETY: it takes nothing but the status.
        let position = open(|status| unsafe { ucfpos_open(status) })?;
        Ok(Fields {
            value: self,
            position,
        })
    }

    pub fn fields_in(self, category: Category) -> Result<Fields<'a>> {
        let fields = self.fields()?;
        // SAFETY: the position is open.
        call(|status| unsafe {
            ucfpos_constrainCategory(fields.position.as_ptr(), category.0, status)
        })?;
        Ok(fields)
    }

    pub fn fields_matching(self, category: Category, field: i32) -> Result<Fields<'a>> {
        let fields = self.fields()?;
        // SAFETY: the position is open.
        call(|status| unsafe {
            ucfpos_constrainField(fields.position.as_ptr(), category.0, field, status)
        })?;
        Ok(fields)
    }
}

pub struct Fields<'a> {
    value: FormattedValue<'a>,
    /// Holds indices into `value`, and is never used with another.
    position: NonNull<UConstrainedFieldPosition>,
}

impl Fields<'_> {
    pub fn next(&mut self) -> Result<Option<Field>> {
        let position = self.position.as_ptr();
        // SAFETY: the result and the position are open, and each call does nothing once the status is a failure.
        call(|status| unsafe {
            if ufmtval_nextPosition(self.value.0, position, status) == 0 {
                return None;
            }
            let (mut start, mut end) = (0, 0);
            ucfpos_getIndexes(position, &mut start, &mut end, status);
            Some(Field {
                category: Category(ucfpos_getCategory(position, status)),
                field: ucfpos_getField(position, status),
                range: range(start, end),
            })
        })
    }
}

impl Drop for Fields<'_> {
    fn drop(&mut self) {
        // SAFETY: this is the only owner of an open object.
        unsafe { ucfpos_close(self.position.as_ptr()) }
    }
}

icu_handle! {
    /// The fields of text that a formatter wrote to a buffer, as numbers of the formatter's own enumeration.
    pub struct FieldPositions(UFieldPositionIterator), ufieldpositer_close
}

impl FieldPositions {
    /// `function` fills the list.
    pub(crate) fn collect<T>(
        function: impl FnOnce(*mut UFieldPositionIterator) -> Result<T>,
    ) -> Result<(T, FieldPositions)> {
        // SAFETY: it takes nothing but the status.
        let positions = open(|status| unsafe { ufieldpositer_open(status) }).map(FieldPositions)?;
        Ok((function(positions.0.as_ptr())?, positions))
    }
}

impl Iterator for FieldPositions {
    type Item = (i32, Range<usize>);

    fn next(&mut self) -> Option<Self::Item> {
        let (mut start, mut end) = (0, 0);
        // SAFETY: the list is open.
        let field = unsafe { ufieldpositer_next(self.0.as_ptr(), &mut start, &mut end) };
        (field >= 0).then(|| (field, range(start, end)))
    }
}
