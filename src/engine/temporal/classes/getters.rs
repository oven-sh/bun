//! The accessors that several classes have.

use super::prelude::*;
use crate::{CalendarDate, CalendarId, IsoDate, PlainTime};

pub(super) trait HasDate: Instance {
    fn calendar_id(&self) -> CalendarId;

    fn date(&self) -> IsoDate;
}

pub(super) trait HasTime: Instance {
    fn time(&self) -> PlainTime;
}

fn or_undefined(value: Option<impl Into<Value>>) -> Value {
    value.map_or(Value::UNDEFINED, Into::into)
}

macro_rules! getters {
    ($bound:ident { $($name:ident = |$cx:pat_param, $this:pat_param| $value:expr,)* }) => {$(
        #[native_abi]
        pub(super) fn $name<T: $bound>(
            cx: &mut Cx,
            this: Value,
            name: PropertyName<'_>,
        ) -> JsResult<Value> {
            let ($this, $cx) = (T::this_local(cx, this, name)?, &*cx);
            Ok($value.into())
        }
    )*};
}

#[inline(always)]
fn fields(cx: &Cx, this: &impl HasDate) -> JsResult<CalendarDate> {
    this.calendar_id().date(this.date()).or_throw(cx)
}

getters!(HasDate {
    calendar_id = |cx, this| JsString::from_name(cx, this.calendar_id().name()),
    era = |cx, this| {
        or_undefined(fields(cx, &this)?.era.map(|it| JsString::from_name(cx, it.era.code())))
    },
    era_year = |cx, this| or_undefined(fields(cx, &this)?.era.map(|it| it.year)),
    year = |cx, this| fields(cx, &this)?.year,
    month = |cx, this| fields(cx, &this)?.month,
    month_code = |cx, this| JsString::from_name(cx, fields(cx, &this)?.month_code()),
    day = |cx, this| fields(cx, &this)?.day,
    day_of_week = |_, this| this.date().day_of_week(),
    day_of_year = |cx, this| fields(cx, &this)?.day_of_year,
    week_of_year = |_, this| or_undefined(this.calendar_id().week(this.date()).map(|it| it.week)),
    year_of_week = |_, this| or_undefined(this.calendar_id().week(this.date()).map(|it| it.year)),
    days_in_week = |_, _| 7,
    days_in_month = |cx, this| fields(cx, &this)?.days_in_month,
    days_in_year = |cx, this| fields(cx, &this)?.days_in_year,
    months_in_year = |cx, this| fields(cx, &this)?.months_in_year,
    in_leap_year = |cx, this| fields(cx, &this)?.in_leap_year,
});

getters!(HasTime {
    hour = |_, this| this.time().hour(),
    minute = |_, this| this.time().minute(),
    second = |_, this| this.time().second(),
    millisecond = |_, this| this.time().millisecond(),
    microsecond = |_, this| this.time().microsecond(),
    nanosecond = |_, this| this.time().nanosecond(),
});
