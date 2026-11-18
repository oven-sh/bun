use core::cell::Cell;
use core::cmp::Ordering;

use bun_engine_vm::JsBigInt;

use super::arguments::{
    require_object, require_string, text_value, to_calendar, to_epoch_nanoseconds, to_time_zone,
};
use super::fields::{read_own_fields, read_partial_fields};
use super::getters::{self, HasDate, HasTime};
use super::methods::{
    Compare, Difference, FromItem, add_duration_in_calendar, compare, from, since,
    to_locale_string, until, value_of,
};
use super::plain_time::to_optional_time;
use super::prelude::*;
use super::zone_names;
use crate::{
    CalendarId, DifferenceOperation, DifferenceOptions, Direction, Duration, FieldSet, InputError,
    IsoDate, OptionValue, PlainTime, Precision, PrecisionOptions, Result, RoundOptions, TextError,
    UnitOption, ZonedDateTime, ZonedDisplay, ZonedOptions,
};

static_table!(static CONSTRUCTOR_PROPERTIES = [
    function(names::from, from::<ZonedDateTime>, 1),
    function(names::compare, compare::<ZonedDateTime>, 2),
]);

static_table!(static PROTOTYPE_PROPERTIES = [
    function(names::with, with, 1),
    function(names::withPlainTime, with_plain_time, 0),
    function(names::withTimeZone, with_time_zone, 1),
    function(names::withCalendar, with_calendar, 1),
    function(names::add, add, 1),
    function(names::subtract, subtract, 1),
    function(names::until, until::<ZonedDateTime>, 1),
    function(names::since, since::<ZonedDateTime>, 1),
    function(names::round, round, 1),
    function(names::startOfDay, start_of_day, 0),
    function(names::getTimeZoneTransition, get_time_zone_transition, 1),
    function(names::equals, equals, 1),
    function(names::toInstant, to_instant, 0),
    function(names::toPlainDateTime, to_plain_date_time, 0),
    function(names::toPlainDate, to_plain_date, 0),
    function(names::toPlainTime, to_plain_time, 0),
    function(names::toString, to_string, 0),
    function(names::toJSON, to_json, 0),
    function(names::toLocaleString, to_locale_string::<ZonedDateTime>, 0),
    function(names::valueOf, value_of::<ZonedDateTime>, 0),
    getter(names::epochNanoseconds, epoch_nanoseconds),
    getter(names::timeZoneId, time_zone_id),
    getter(names::calendarId, getters::calendar_id::<ZonedDateTime>),
    getter(names::year, getters::year::<ZonedDateTime>),
    getter(names::month, getters::month::<ZonedDateTime>),
    getter(names::monthCode, getters::month_code::<ZonedDateTime>),
    getter(names::day, getters::day::<ZonedDateTime>),
    getter(names::hour, getters::hour::<ZonedDateTime>),
    getter(names::minute, getters::minute::<ZonedDateTime>),
    getter(names::second, getters::second::<ZonedDateTime>),
    getter(names::millisecond, getters::millisecond::<ZonedDateTime>),
    getter(names::microsecond, getters::microsecond::<ZonedDateTime>),
    getter(names::nanosecond, getters::nanosecond::<ZonedDateTime>),
    getter(names::offset, offset),
    getter(names::offsetNanoseconds, offset_nanoseconds),
    getter(names::dayOfWeek, getters::day_of_week::<ZonedDateTime>),
    getter(names::dayOfYear, getters::day_of_year::<ZonedDateTime>),
    getter(names::weekOfYear, getters::week_of_year::<ZonedDateTime>),
    getter(names::yearOfWeek, getters::year_of_week::<ZonedDateTime>),
    getter(names::hoursInDay, hours_in_day),
    getter(names::daysInWeek, getters::days_in_week::<ZonedDateTime>),
    getter(names::daysInMonth, getters::days_in_month::<ZonedDateTime>),
    getter(names::daysInYear, getters::days_in_year::<ZonedDateTime>),
    getter(names::monthsInYear, getters::months_in_year::<ZonedDateTime>),
    getter(names::inLeapYear, getters::in_leap_year::<ZonedDateTime>),
    getter(names::era, getters::era::<ZonedDateTime>),
    getter(names::eraYear, getters::era_year::<ZonedDateTime>),
    getter(names::epochMilliseconds, epoch_milliseconds),
    StaticProperty::string(symbols::toStringTag, names::temporalZonedDateTime),
]);

define_class!(
    ZonedDateTime in Cell<ZonedDateTime>, "Temporal.ZonedDateTime", length 2, ZonedDateTimeValueOf,
    temporal_zoned_date_time_shape, init_temporal_zoned_date_time_shape,
    init_temporal_zoned_date_time_constructor,
    {
        #[inline(always)]
        fn this_local(cx: &Cx, value: Value, member: PropertyName<'_>) -> JsResult<ZonedDateTime> {
            let this = ZonedDateTime::this(cx, value, member)?;
            if this.knows_offset() {
                return Ok(this);
            }
            let this = this.with_known_offset();
            value.cast::<Object>().value.set(this);
            Ok(this)
        }
    }
);

fn options_of_from(cx: &mut Cx, options: Value) -> JsResult<ZonedOptions> {
    Options::or_throw(cx, options, Error::ZonedOptionsNotObject)?
        .zoned(cx, ZonedOptions::DEFAULT_FOR_FROM)
}

impl FromItem for ZonedDateTime {
    fn from_item(cx: &mut Cx, item: Value, options: Value) -> JsResult<ZonedDateTime> {
        let Some(object) = item.as_object() else {
            let string = require_string(cx, item, Error::NotConvertibleToZonedDateTime)?;
            let parsed = ZonedDateTime::parse(string.text()).or_throw(cx)?;
            let options = options_of_from(cx, options)?;
            return (parsed.finish(options.disambiguation, options.offset)).or_throw(cx);
        };
        if let Some(known) = ZonedDateTime::of(&object) {
            options_of_from(cx, options)?;
            return Ok(known);
        }
        let fields = read_own_fields(cx, &object, FieldSet::Zoned)?;
        ZonedDateTime::from_fields(&fields, options_of_from(cx, options)?).or_throw(cx)
    }
}

impl Compare for ZonedDateTime {
    fn compare(&self, other: &ZonedDateTime) -> Ordering {
        self.instant().cmp(&other.instant())
    }
}

impl Difference for ZonedDateTime {
    fn check_comparable(&self, other: &ZonedDateTime) -> Result<()> {
        self.check_same_calendar(other)
    }

    fn difference_from(
        &self,
        operation: DifferenceOperation,
        other: &ZonedDateTime,
        options: DifferenceOptions,
    ) -> Result<Duration> {
        self.difference(operation, other, options)
    }
}

impl HasDate for ZonedDateTime {
    #[inline(always)]
    fn calendar_id(&self) -> CalendarId {
        self.calendar()
    }

    #[inline(always)]
    fn date(&self) -> IsoDate {
        self.iso_date_time().date
    }
}

impl HasTime for ZonedDateTime {
    #[inline(always)]
    fn time(&self) -> PlainTime {
        self.iso_date_time().time
    }
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let out_of_range = TextError::ZonedDateTimeEpochNanoseconds;
    let instant = to_epoch_nanoseconds(cx, frame.argument(0), out_of_range)?;
    let Some(identifier) = frame.argument(1).as_string() else {
        return Err(throw(cx, Error::ZonedTimeZoneNotString));
    };
    let Some(time_zone) = zone_names::find(cx, identifier)? else {
        let identifier = identifier.view(cx)?;
        let error = InputError::Text(TextError::TimeZone, identifier.text());
        return Err(throw(cx, error));
    };
    let calendar = match frame.argument(2) {
        Value::UNDEFINED => CalendarId::Iso8601,
        given => {
            let name = require_string(cx, given, Error::ZonedCalendarNotString)?;
            CalendarId::canonicalize(name.text()).or_throw(cx)?
        }
    };
    ZonedDateTime::new(instant, time_zone, calendar).constructed(cx, frame)
}

#[native_abi]
fn with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, frame.this_value(), names::with)?;
    let fields = read_partial_fields(
        cx,
        frame.argument(0),
        FieldSet::PartialZoned,
        this.calendar(),
        Error::ZonedWithNotPartial,
    )?;
    let options = Options::new(cx, frame.argument(1))?.zoned(cx, ZonedOptions::DEFAULT_FOR_WITH)?;
    this.with(&fields, options).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn with_plain_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, frame.this_value(), names::withPlainTime)?;
    let time = to_optional_time(cx, frame.argument(0))?;
    this.with_plain_time(time).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn with_time_zone(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this(cx, frame.this_value(), names::withTimeZone)?;
    let time_zone = to_time_zone(cx, frame.argument(0))?;
    this.with_time_zone(time_zone).returned(cx)
}

#[native_abi]
fn with_calendar(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this(cx, frame.this_value(), names::withCalendar)?;
    let calendar = to_calendar(cx, frame.argument(0))?;
    this.with_calendar(calendar).returned(cx)
}

#[native_abi]
fn add(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration_in_calendar(
        cx,
        frame,
        names::add,
        |this: ZonedDateTime, by, overflow| this.add(by, overflow),
    )
}

#[native_abi]
fn subtract(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    add_duration_in_calendar(
        cx,
        frame,
        names::subtract,
        |this: ZonedDateTime, by, overflow| this.subtract(by, overflow),
    )
}

#[native_abi]
fn round(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, frame.this_value(), names::round)?;
    let options = match frame.argument(0).as_string() {
        Some(unit) => RoundOptions {
            smallest_unit: Some(UnitOption::parse(unit.view(cx)?.text()).or_throw(cx)?),
            ..RoundOptions::default()
        },
        None => {
            let object = require_object(cx, frame.argument(0), Error::ZonedRoundWithoutOptions)?;
            Options::from(object).round(cx)?
        }
    };
    this.round(options).or_throw(cx)?.returned(cx)
}

#[native_abi]
fn start_of_day(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, frame.this_value(), names::startOfDay)?;
    this.start_of_day().or_throw(cx)?.returned(cx)
}

#[native_abi]
fn get_time_zone_transition(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this(cx, frame.this_value(), names::getTimeZoneTransition)?;
    let argument = frame.argument(0);
    if argument.is_undefined() {
        return Err(throw(cx, Error::MissingDirectionArgument));
    }
    let direction = match argument.as_string() {
        Some(direction) => Direction::parse(direction.view(cx)?.text()).or_throw(cx)?,
        None => Options::or_throw(cx, argument, Error::DirectionNotObjectOrString)?
            .value(cx)?
            .ok_or(Error::MissingDirectionOption)
            .or_throw(cx)?,
    };
    match this.time_zone_transition(direction) {
        Some(transition) => transition.returned(cx),
        None => Ok(Value::NULL),
    }
}

#[native_abi]
fn equals(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this(cx, frame.this_value(), names::equals)?;
    let other = ZonedDateTime::from_argument(cx, frame.argument(0))?;
    Ok(this.equals(&other).into())
}

#[native_abi]
fn to_instant(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this(cx, frame.this_value(), names::toInstant)?;
    this.instant().returned(cx)
}

#[native_abi]
fn to_plain_date_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, frame.this_value(), names::toPlainDateTime)?;
    this.to_plain_date_time().returned(cx)
}

#[native_abi]
fn to_plain_date(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, frame.this_value(), names::toPlainDate)?;
    this.to_plain_date().returned(cx)
}

#[native_abi]
fn to_plain_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, frame.this_value(), names::toPlainTime)?;
    this.time().returned(cx)
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, frame.this_value(), names::toString)?;
    let options = Options::new(cx, frame.argument(0))?;
    let calendar = options.show_calendar(cx)?;
    let fractional_second_digits = options.fractional_second_digits(cx)?;
    let offset = options.value_or(cx, ZonedDisplay::AUTO.offset)?;
    let precision = PrecisionOptions {
        fractional_second_digits,
        rounding_mode: options.value_or(cx, PrecisionOptions::default().rounding_mode)?,
        smallest_unit: options.unit(cx, names::smallestUnit)?,
    };
    let display = ZonedDisplay {
        calendar,
        offset,
        time_zone: options.value_or(cx, ZonedDisplay::AUTO.time_zone)?,
    };
    let precision = ZonedDateTime::precision(precision).or_throw(cx)?;
    text_value(cx, &this.to_text(precision, display))
}

#[native_abi]
fn to_json(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, frame.this_value(), names::toJSON)?;
    text_value(cx, &this.to_text(Precision::AUTO, ZonedDisplay::AUTO))
}

#[native_abi]
fn epoch_nanoseconds(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    let this = ZonedDateTime::this(cx, this, name)?;
    Ok(JsBigInt::from_small(cx, this.instant().epoch_nanoseconds()).into())
}

#[native_abi]
fn epoch_milliseconds(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    let this = ZonedDateTime::this(cx, this, name)?;
    Ok(this.instant().epoch_milliseconds().into())
}

#[native_abi]
fn time_zone_id(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    let this = ZonedDateTime::this(cx, this, name)?;
    Ok(zone_names::identifier(cx, this.time_zone()).into())
}

#[native_abi]
fn offset(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, this, name)?;
    text_value(cx, &this.offset_text())
}

#[native_abi]
fn offset_nanoseconds(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, this, name)?;
    Ok(this.offset_nanoseconds().into())
}

#[native_abi]
fn hours_in_day(cx: &mut Cx, this: Value, name: PropertyName<'_>) -> JsResult<Value> {
    let this = ZonedDateTime::this_local(cx, this, name)?;
    Ok(this.hours_in_day().or_throw(cx)?.into())
}
