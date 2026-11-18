//! The steps that the methods of several classes have in common.

use core::cmp::Ordering;

use super::duration::with_duration;
use super::fields::read_partial_fields;
use super::getters::HasDate;
use super::options::overflow_option;
use super::prelude::*;
use crate::{DifferenceOperation, DifferenceOptions, Duration, FieldSet, Fields, Overflow, Result};

/// A class whose methods convert their arguments to it.
pub(super) trait FromItem: Instance {
    /// ToTemporalDate and the like.
    fn from_item(cx: &mut Cx, item: Value, options: Value) -> JsResult<Self>;

    #[inline(always)]
    fn from_argument(cx: &mut Cx, item: Value) -> JsResult<Self> {
        match Self::of_value(item) {
            Some(value) => Ok(value),
            None => Self::from_item(cx, item, Value::UNDEFINED),
        }
    }
}

pub(super) trait Compare: FromItem {
    fn compare(&self, other: &Self) -> Ordering;
}

pub(super) trait Difference: FromItem {
    fn check_comparable(&self, _other: &Self) -> Result<()> {
        Ok(())
    }

    fn difference_from(
        &self,
        operation: DifferenceOperation,
        other: &Self,
        options: DifferenceOptions,
    ) -> Result<Duration>;
}

#[native_abi]
pub(super) fn from<T: FromItem>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    T::from_item(cx, frame.argument(0), frame.argument(1))?.returned(cx)
}

#[native_abi]
pub(super) fn compare<T: Compare>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let one = T::from_argument(cx, frame.argument(0))?;
    let two = T::from_argument(cx, frame.argument(1))?;
    Ok((one.compare(&two) as i32).into())
}

#[native_abi]
pub(super) fn equals<T: FromItem + PartialEq>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = T::this(cx, frame.this_value(), names::equals)?;
    let other = T::from_argument(cx, frame.argument(0))?;
    Ok((this == other).into())
}

#[native_abi]
pub(super) fn until<T: Difference>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    difference::<T>(cx, frame, names::until, DifferenceOperation::Until)
}

#[native_abi]
pub(super) fn since<T: Difference>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    difference::<T>(cx, frame, names::since, DifferenceOperation::Since)
}

fn difference<T: Difference>(
    cx: &mut Cx,
    frame: &CallFrame,
    member: PropertyName<'_>,
    operation: DifferenceOperation,
) -> JsResult<Value> {
    let this = T::this(cx, frame.this_value(), member)?;
    let other = T::from_argument(cx, frame.argument(0))?;
    this.check_comparable(&other).or_throw(cx)?;
    let options = Options::new(cx, frame.argument(1))?.difference(cx)?;
    (this.difference_from(operation, &other, options))
        .or_throw(cx)?
        .returned(cx)
}

/// `add` or `subtract` of a class that takes no options.
#[inline(always)]
pub(super) fn add_duration<T: Instance>(
    cx: &mut Cx,
    frame: &CallFrame,
    member: PropertyName<'_>,
    operation: impl FnOnce(T, &Duration) -> Result<T>,
) -> JsResult<Value> {
    let this = T::this(cx, frame.this_value(), member)?;
    with_duration(cx, frame.argument(0), |cx, duration| {
        operation(this, duration).or_throw(cx)?.returned(cx)
    })
}

/// `add` or `subtract` of a class that has a calendar.
#[inline(always)]
pub(super) fn add_duration_in_calendar<T: Instance>(
    cx: &mut Cx,
    frame: &CallFrame,
    member: PropertyName<'_>,
    operation: impl FnOnce(T, &Duration, Overflow) -> Result<T>,
) -> JsResult<Value> {
    let this = T::this(cx, frame.this_value(), member)?;
    with_duration(cx, frame.argument(0), |cx, duration| {
        let overflow = overflow_option(cx, frame.argument(1))?;
        (operation(this, duration, overflow))
            .or_throw(cx)?
            .returned(cx)
    })
}

/// `with` of a plain type that has a calendar.
#[inline(always)]
pub(super) fn with_fields<T: HasDate>(
    cx: &mut Cx,
    frame: &CallFrame,
    set: FieldSet,
    not_partial: Error,
    operation: impl FnOnce(T, &Fields, Overflow) -> Result<T>,
) -> JsResult<Value> {
    let this = T::this(cx, frame.this_value(), names::with)?;
    let fields = read_partial_fields(cx, frame.argument(0), set, this.calendar_id(), not_partial)?;
    let overflow = overflow_option(cx, frame.argument(1))?;
    (operation(this, &fields, overflow))
        .or_throw(cx)?
        .returned(cx)
}

#[native_abi]
pub(super) fn to_locale_string<T: Instance>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    T::this(cx, frame.this_value(), names::toLocaleString)?;
    let this = frame.this_value().cast();
    (cx.hooks().temporal_to_locale_string)(cx, this, frame.argument(0), frame.argument(1))
}

#[native_abi]
pub(super) fn value_of<T: Instance>(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(throw(cx, T::VALUE_OF))
}
