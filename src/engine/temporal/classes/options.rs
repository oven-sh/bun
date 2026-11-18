use super::arguments::to_string;
use super::prelude::*;
use crate::{
    DifferenceOptions, FractionalSecondDigits, OptionValue, Overflow, PrecisionOptions,
    RoundOptions, RoundingIncrement, ShowCalendar, UnitOption, ZonedOptions,
};

/// The `options` argument.
#[derive(Clone, Copy)]
pub(super) struct Options(Option<Gc<JsObject>>);

impl From<Gc<JsObject>> for Options {
    fn from(object: Gc<JsObject>) -> Options {
        Options(Some(object))
    }
}

impl Options {
    /// GetOptionsObject
    #[inline]
    pub(super) fn new(cx: &Cx, value: Value) -> JsResult<Options> {
        Options::or_throw(cx, value, Error::OptionsNotObjectOrUndefined)
    }

    #[inline]
    pub(super) fn or_throw(cx: &Cx, value: Value, not_object: Error) -> JsResult<Options> {
        if !value.is_undefined() && !value.is_object() {
            return Err(throw(cx, not_object));
        }
        Ok(Options(value.as_object()))
    }

    /// `None` for undefined.
    #[inline(always)]
    pub(super) fn get(self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Option<Value>> {
        let Some(object) = self.0 else {
            return Ok(None);
        };
        let value = get(cx, &object, name)?;
        Ok((!value.is_undefined()).then_some(value))
    }

    #[inline]
    pub(super) fn value<T: OptionValue>(self, cx: &mut Cx) -> JsResult<Option<T>> {
        let Some(value) = self.get(cx, T::PROPERTY)? else {
            return Ok(None);
        };
        let string = to_string(cx, value)?;
        T::parse(string.text()).or_throw(cx).map(Some)
    }

    #[inline]
    pub(super) fn value_or<T: OptionValue>(self, cx: &mut Cx, default: T) -> JsResult<T> {
        Ok(self.value(cx)?.unwrap_or(default))
    }

    #[inline]
    pub(super) fn overflow(self, cx: &mut Cx) -> JsResult<Overflow> {
        self.value_or(cx, Overflow::Constrain)
    }

    #[inline]
    pub(super) fn show_calendar(self, cx: &mut Cx) -> JsResult<ShowCalendar> {
        self.value_or(cx, ShowCalendar::Auto)
    }

    /// GetTemporalUnitValuedOption
    #[inline]
    pub(super) fn unit(self, cx: &mut Cx, name: PropertyName<'_>) -> JsResult<Option<UnitOption>> {
        let Some(value) = self.get(cx, name)? else {
            return Ok(None);
        };
        let string = to_string(cx, value)?;
        UnitOption::parse(string.text()).or_throw(cx).map(Some)
    }

    #[inline]
    fn rounding_increment(self, cx: &mut Cx) -> JsResult<RoundingIncrement> {
        match self.get(cx, names::roundingIncrement)? {
            Some(value) => RoundingIncrement::new(value.to_number(cx)?).or_throw(cx),
            None => Ok(RoundingIncrement::ONE),
        }
    }

    #[inline]
    pub(super) fn fractional_second_digits(self, cx: &mut Cx) -> JsResult<FractionalSecondDigits> {
        let Some(value) = self.get(cx, names::fractionalSecondDigits)? else {
            return Ok(FractionalSecondDigits::AUTO);
        };
        if let Some(number) = value.as_number() {
            return FractionalSecondDigits::from_number(number).or_throw(cx);
        }
        let string = to_string(cx, value)?;
        FractionalSecondDigits::parse(string.text()).or_throw(cx)
    }

    #[inline]
    pub(super) fn difference(self, cx: &mut Cx) -> JsResult<DifferenceOptions> {
        Ok(DifferenceOptions {
            largest_unit: self.unit(cx, names::largestUnit)?,
            rounding_increment: self.rounding_increment(cx)?,
            rounding_mode: self.value_or(cx, DifferenceOptions::default().rounding_mode)?,
            smallest_unit: self.unit(cx, names::smallestUnit)?,
        })
    }

    #[inline]
    pub(super) fn round(self, cx: &mut Cx) -> JsResult<RoundOptions> {
        Ok(RoundOptions {
            rounding_increment: self.rounding_increment(cx)?,
            rounding_mode: self.value_or(cx, RoundOptions::default().rounding_mode)?,
            smallest_unit: self.unit(cx, names::smallestUnit)?,
        })
    }

    #[inline]
    pub(super) fn precision(self, cx: &mut Cx) -> JsResult<PrecisionOptions> {
        Ok(PrecisionOptions {
            fractional_second_digits: self.fractional_second_digits(cx)?,
            rounding_mode: self.value_or(cx, PrecisionOptions::default().rounding_mode)?,
            smallest_unit: self.unit(cx, names::smallestUnit)?,
        })
    }

    #[inline]
    pub(super) fn zoned(self, cx: &mut Cx, default: ZonedOptions) -> JsResult<ZonedOptions> {
        Ok(ZonedOptions {
            disambiguation: self.value_or(cx, default.disambiguation)?,
            offset: self.value_or(cx, default.offset)?,
            overflow: self.value_or(cx, default.overflow)?,
        })
    }
}

/// GetOptionsObject and GetTemporalOverflowOption
#[inline]
pub(super) fn overflow_option(cx: &mut Cx, options: Value) -> JsResult<Overflow> {
    Options::new(cx, options)?.overflow(cx)
}

/// The argument of `round`, which can be the name of a unit.
pub(super) fn round_argument(cx: &mut Cx, value: Value, missing: Error) -> JsResult<RoundOptions> {
    if value.is_undefined() {
        return Err(throw(cx, missing));
    }
    match value.as_string() {
        Some(unit) => RoundOptions::from_smallest_unit(unit.view(cx)?.text()).or_throw(cx),
        None => Options::new(cx, value)?.round(cx),
    }
}
