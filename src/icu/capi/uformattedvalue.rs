//! `unicode/uformattedvalue.h`. All `UFormatted*` handle types are aliases of `UFormattedValue`.

use crate::capi::ffi::{self, ErrorCode, LocalHandle, Mut, Out, Owned, Ref, UBool, UChar};
use crate::capi::ulistformatter;
use crate::common::memory;
use crate::common::utypes::*;
use crate::i18n::formattedvalue::{ConstrainedFieldPosition, FormattedValue};
use crate::i18n::listformatter::ULISTFMT_ELEMENT_FIELD;
use crate::i18n::number_fluent::UFormattedNumberData;
use crate::i18n::numrange_impl::UFormattedNumberRangeData;
use crate::i18n::unicode::uformattedvalue::*;
use bun_icu_macros::capi;
use std::ptr::null;

/// "UCF" in ASCII.
pub(crate) const UCFPOS_MAGIC: i32 = 0x5543_4600;
/// "UFV" in ASCII.
pub(crate) const UFMTVAL_MAGIC: i32 = 0x5546_5600;

#[repr(C)]
pub(crate) struct UConstrainedFieldPosition {
    magic: i32,
    position: ConstrainedFieldPosition,
}

#[repr(C)]
pub(crate) struct UFormattedValue {
    magic: i32,
    /// The magic number of the C type that was opened, such as `UFormattedList`.
    kind: i32,
    pub(crate) value: Value,
}

/// Numbers and ranges are formatted in place. Other values are replaced by each call, with an error if it fails.
pub(crate) enum Value {
    Number(UFormattedNumberData),
    Range(UFormattedNumberRangeData),
    Other(Result<Box<dyn FormattedValue + Send + Sync>, UErrorCode>),
}

impl UFormattedValue {
    /// Creates a result whose reads fail with `U_INVALID_STATE_ERROR` until `set` is called.
    pub(crate) fn new_unset(kind: i32) -> Self {
        Self::new(kind, Value::Other(Err(U_INVALID_STATE_ERROR)))
    }

    /// Implements `*_openResult`. Allocates first, so that the value is built in place.
    pub(crate) fn open(kind: i32, value: impl FnOnce() -> Value, ec: ErrorCode<'_>) -> *mut Self {
        ec.open(|_, _| {
            let uninit = memory::try_box_uninit()?;
            Ok(LocalHandle::new(Box::write(
                uninit,
                Self::new(kind, value()),
            )))
        })
    }

    fn new(kind: i32, value: Value) -> Self {
        Self {
            magic: UFMTVAL_MAGIC,
            kind,
            value,
        }
    }

    pub(crate) fn validate(handle: Ref<'_, Self>, kind: i32) -> Result<&Self, UErrorCode> {
        let value = handle.get()?;
        if value.kind == kind {
            Ok(value)
        } else {
            Err(U_INVALID_FORMAT_ERROR)
        }
    }

    pub(crate) fn validate_mut(handle: Mut<'_, Self>, kind: i32) -> Result<&mut Self, UErrorCode> {
        let value = handle.get_mut()?;
        if value.kind == kind {
            Ok(value)
        } else {
            Err(U_INVALID_FORMAT_ERROR)
        }
    }

    /// Implements `*_closeResult`. Ignores a handle of another kind.
    pub(crate) fn close(handle: Owned<'_, Self>, kind: i32) {
        if Self::validate(handle.cast_const(), kind).is_ok() {
            handle.close()
        }
    }

    /// Stores the value, or the error, which later reads report. Returns the error.
    pub(crate) fn set<T: FormattedValue + Send + Sync + 'static>(
        &mut self,
        value: Result<T, UErrorCode>,
    ) -> Result<(), UErrorCode> {
        self.value = Value::Other(value.and_then(|value| Ok(memory::try_box(value)? as _)));
        self.formatted().map(drop)
    }

    fn formatted(&self) -> Result<&dyn FormattedValue, UErrorCode> {
        match &self.value {
            Value::Number(number) => Ok(&number.base),
            Value::Range(range) => Ok(&range.base),
            Value::Other(Ok(other)) => Ok(&**other),
            Value::Other(Err(code)) => Err(*code),
        }
    }
}

fn position(
    ptr: Ref<'_, UConstrainedFieldPosition>,
) -> Result<&ConstrainedFieldPosition, UErrorCode> {
    Ok(&ptr.get()?.position)
}

fn position_mut(
    ptr: Mut<'_, UConstrainedFieldPosition>,
) -> Result<&mut ConstrainedFieldPosition, UErrorCode> {
    Ok(&mut ptr.get_mut()?.position)
}

#[capi]
fn ucfpos_open(ec: ErrorCode) -> *mut UConstrainedFieldPosition {
    let position = UConstrainedFieldPosition {
        magic: UCFPOS_MAGIC,
        position: Default::default(),
    };
    ec.open_always(|_| LocalHandle::boxed(position))
}

#[capi]
fn ucfpos_reset(ptr: Mut<UConstrainedFieldPosition>, ec: ErrorCode) {
    ec.run_no_alloc((), |_, _| {
        position_mut(ptr).map(ConstrainedFieldPosition::reset)
    })
}

#[capi]
fn ucfpos_close(ptr: Owned<UConstrainedFieldPosition>) {
    ptr.close()
}

/// Accepts only `UFIELD_CATEGORY_DATE_INTERVAL_SPAN`.
#[capi]
fn ucfpos_constrainCategory(ptr: Mut<UConstrainedFieldPosition>, category: i32, ec: ErrorCode) {
    ec.run_no_alloc((), |_, _| match category {
        UFIELD_CATEGORY_DATE_INTERVAL_SPAN => {
            position_mut(ptr).map(|position| position.constrain_category(category))
        }
        _ => Err(U_UNSUPPORTED_ERROR),
    })
}

/// Accepts only `ULISTFMT_ELEMENT_FIELD` of `UFIELD_CATEGORY_LIST`.
#[capi]
fn ucfpos_constrainField(
    ptr: Mut<UConstrainedFieldPosition>,
    category: i32,
    field: i32,
    ec: ErrorCode,
) {
    ec.run_no_alloc((), |_, _| match (category, field) {
        (UFIELD_CATEGORY_LIST, ULISTFMT_ELEMENT_FIELD) => {
            position_mut(ptr).map(|position| position.constrain_field(category, field))
        }
        _ => Err(U_UNSUPPORTED_ERROR),
    })
}

#[capi]
fn ucfpos_getCategory(ptr: Ref<UConstrainedFieldPosition>, ec: ErrorCode) -> i32 {
    ec.run_no_alloc(UFIELD_CATEGORY_UNDEFINED, |_, _| {
        Ok(position(ptr)?.category())
    })
}

#[capi]
fn ucfpos_getField(ptr: Ref<UConstrainedFieldPosition>, ec: ErrorCode) -> i32 {
    ec.run_no_alloc(0, |_, _| Ok(position(ptr)?.field()))
}

#[capi]
fn ucfpos_getIndexes(
    ptr: Ref<UConstrainedFieldPosition>,
    p_start: Out<i32>,
    p_limit: Out<i32>,
    ec: ErrorCode,
) {
    ec.run_no_alloc((), |cx, _| {
        let position = position(ptr)?;
        cx.store(p_start, position.start());
        cx.store(p_limit, position.limit());
        Ok(())
    })
}

#[capi]
fn ufmtval_getString(
    ufmtval: Ref<UFormattedValue>,
    p_length: Out<i32>,
    ec: ErrorCode,
) -> *const UChar {
    ec.run(null(), |cx, _| {
        let text = ufmtval.get()?.formatted()?.terminated_text();
        cx.store(p_length, ffi::to_int32(text.len() - 1));
        Ok(text.as_ptr())
    })
}

/// A list needs a constraint.
#[capi]
fn ufmtval_nextPosition(
    ufmtval: Ref<UFormattedValue>,
    ucfpos: Mut<UConstrainedFieldPosition>,
    ec: ErrorCode,
) -> UBool {
    ec.run(0, |_, _| {
        let value = ufmtval.get()?;
        let position = position_mut(ucfpos)?;
        if value.kind == ulistformatter::MAGIC && !position.is_constrained() {
            return Err(U_UNSUPPORTED_ERROR);
        }
        Ok(value.formatted()?.next_position(position).into())
    })
}
