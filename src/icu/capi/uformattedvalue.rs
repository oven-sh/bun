//! `unicode/uformattedvalue.h`. All `UFormatted*` handle types are aliases of `UFormattedValue`.

use crate::capi::ffi::{self, ErrorCode, NonNullHandle, Out, UBool, UChar};
use crate::common::memory;
use crate::common::utypes::*;
use crate::i18n::formattedvalue::{ConstrainedFieldPosition, FormattedValue};
use crate::i18n::listformatter::ULISTFMT_ELEMENT_FIELD;
use crate::i18n::number_fluent::UFormattedNumberData;
use crate::i18n::numrange_impl::UFormattedNumberRangeData;
use crate::i18n::unicode::uformattedvalue::*;
use bun_icu_macros::capi;
use std::ptr::null;

pub(crate) type UConstrainedFieldPosition = ConstrainedFieldPosition;

/// Numbers and ranges are formatted in place. Other values are replaced by each call, with an error if it fails.
pub(crate) enum UFormattedValue {
    Number(UFormattedNumberData),
    Range(UFormattedNumberRangeData),
    Other(Result<Box<dyn FormattedValue + Send + Sync>, UErrorCode>),
}

impl UFormattedValue {
    /// Creates a result whose reads fail with `U_INVALID_STATE_ERROR` until `set` is called.
    pub(crate) fn new_unset() -> Self {
        Self::Other(Err(U_INVALID_STATE_ERROR))
    }

    /// Allocates first, so that the value is built in place.
    pub(crate) fn open(value: impl FnOnce() -> Self, ec: ErrorCode<'_>) -> Option<Box<Self>> {
        ec.run(None, |_| {
            let uninit = memory::try_box_uninit()?;
            Ok(Some(Box::write(uninit, value())))
        })
    }

    /// Stores the value, or the error, which later reads report. Returns the error.
    pub(crate) fn set<T: FormattedValue + Send + Sync + 'static>(
        &mut self,
        value: Result<T, UErrorCode>,
    ) -> Result<(), UErrorCode> {
        *self = Self::Other(value.and_then(|value| Ok(memory::try_box(value)? as _)));
        self.formatted().map(drop)
    }

    fn formatted(&self) -> Result<&dyn FormattedValue, UErrorCode> {
        match self {
            Self::Number(number) => Ok(&number.base),
            Self::Range(range) => Ok(&range.base),
            Self::Other(Ok(other)) => Ok(&**other),
            Self::Other(Err(code)) => Err(*code),
        }
    }
}

#[capi]
fn ucfpos_open(ec: ErrorCode) -> Option<Box<UConstrainedFieldPosition>> {
    ec.open(|| Ok(ConstrainedFieldPosition::default()))
}

#[capi]
fn ucfpos_reset(ptr: Option<&mut UConstrainedFieldPosition>, ec: ErrorCode) {
    ec.run_no_alloc((), |_| ptr.non_null().map(ConstrainedFieldPosition::reset))
}

#[capi]
fn ucfpos_close(ptr: Option<Box<UConstrainedFieldPosition>>) {
    drop(ptr);
}

/// Accepts only `UFIELD_CATEGORY_DATE_INTERVAL_SPAN`.
#[capi]
fn ucfpos_constrainCategory(
    ptr: Option<&mut UConstrainedFieldPosition>,
    category: i32,
    ec: ErrorCode,
) {
    ec.run_no_alloc((), |_| match category {
        UFIELD_CATEGORY_DATE_INTERVAL_SPAN => ptr
            .non_null()
            .map(|position| position.constrain_category(category)),
        _ => Err(U_UNSUPPORTED_ERROR),
    })
}

/// Accepts only `ULISTFMT_ELEMENT_FIELD` of `UFIELD_CATEGORY_LIST`.
#[capi]
fn ucfpos_constrainField(
    ptr: Option<&mut UConstrainedFieldPosition>,
    category: i32,
    field: i32,
    ec: ErrorCode,
) {
    ec.run_no_alloc((), |_| match (category, field) {
        (UFIELD_CATEGORY_LIST, ULISTFMT_ELEMENT_FIELD) => ptr
            .non_null()
            .map(|position| position.constrain_field(category, field)),
        _ => Err(U_UNSUPPORTED_ERROR),
    })
}

#[capi]
fn ucfpos_getCategory(ptr: Option<&UConstrainedFieldPosition>, ec: ErrorCode) -> i32 {
    ec.run_no_alloc(UFIELD_CATEGORY_UNDEFINED, |_| {
        Ok(ptr.non_null()?.category())
    })
}

#[capi]
fn ucfpos_getField(ptr: Option<&UConstrainedFieldPosition>, ec: ErrorCode) -> i32 {
    ec.run_no_alloc(0, |_| Ok(ptr.non_null()?.field()))
}

#[capi]
fn ucfpos_getIndexes(
    ptr: Option<&UConstrainedFieldPosition>,
    p_start: Out<i32>,
    p_limit: Out<i32>,
    ec: ErrorCode,
) {
    ec.run_no_alloc((), |_| {
        let position = ptr.non_null()?;
        p_start.set(position.start());
        p_limit.set(position.limit());
        Ok(())
    })
}

#[capi]
fn ufmtval_getString(
    ufmtval: Option<&UFormattedValue>,
    p_length: Out<i32>,
    ec: ErrorCode,
) -> *const UChar {
    ec.run(null(), |_| {
        let text = ufmtval.non_null()?.formatted()?.terminated_text();
        p_length.set(ffi::to_int32(text.len() - 1));
        Ok(text.as_ptr())
    })
}

/// A list needs a constraint.
#[capi]
fn ufmtval_nextPosition(
    ufmtval: Option<&UFormattedValue>,
    ucfpos: Option<&mut UConstrainedFieldPosition>,
    ec: ErrorCode,
) -> UBool {
    ec.run(0, |_| {
        let (value, position) = (ufmtval.non_null()?, ucfpos.non_null()?);
        Ok(value.formatted()?.next_position(position).into())
    })
}
