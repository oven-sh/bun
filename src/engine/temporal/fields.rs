//! PrepareCalendarFields and ToTemporalTimeRecord. The caller gets each property of `Fields::properties` in turn, converts
//! it as `Field::conversion` says, and hands it over.

use bun_engine_date::TimeZone;
use bun_engine_text::{PropertyName, Text, names};

use crate::calendar::DateFields;
use crate::integer::saturate;
use crate::{
    CalendarId, Error, InputError, IsoDateTime, MonthCode, Overflow, PlainTime, Result, TextError,
    parse, to_integer_with_truncation,
};

/// In alphabetical order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Field {
    Day,
    Era,
    EraYear,
    Hour,
    Microsecond,
    Millisecond,
    Minute,
    Month,
    MonthCode,
    Nanosecond,
    Offset,
    Second,
    TimeZone,
    Year,
}

/// What to do with a value that is not `undefined`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Conversion {
    /// ToNumber, then `Fields::set_number`.
    Number,
    /// ToString, then `Fields::set_text`.
    String,
    /// ToPrimitive with the hint `string`, then `Fields::set_text` if the result is a string, and the error if not.
    PrimitiveString(Error),
    /// ToTemporalTimeZoneIdentifier, then `Fields::set_time_zone`.
    TimeZone,
}

impl Field {
    const ALL: [Field; 14] = [
        Field::Day,
        Field::Era,
        Field::EraYear,
        Field::Hour,
        Field::Microsecond,
        Field::Millisecond,
        Field::Minute,
        Field::Month,
        Field::MonthCode,
        Field::Nanosecond,
        Field::Offset,
        Field::Second,
        Field::TimeZone,
        Field::Year,
    ];

    pub const fn property(self) -> PropertyName<'static> {
        match self {
            Field::Day => names::day,
            Field::Era => names::era,
            Field::EraYear => names::eraYear,
            Field::Hour => names::hour,
            Field::Microsecond => names::microsecond,
            Field::Millisecond => names::millisecond,
            Field::Minute => names::minute,
            Field::Month => names::month,
            Field::MonthCode => names::monthCode,
            Field::Nanosecond => names::nanosecond,
            Field::Offset => names::offset,
            Field::Second => names::second,
            Field::TimeZone => names::timeZone,
            Field::Year => names::year,
        }
    }

    pub const fn conversion(self) -> Conversion {
        match self {
            Field::Era => Conversion::String,
            Field::MonthCode => Conversion::PrimitiveString(Error::MonthCodeNotString),
            Field::Offset => Conversion::PrimitiveString(Error::OffsetNotString),
            Field::TimeZone => Conversion::TimeZone,
            _ => Conversion::Number,
        }
    }

    const fn bit(self) -> u16 {
        1 << self as u8
    }
}

/// Which properties an object is read for.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FieldSet {
    /// For `PlainDate` and `PlainMonthDay`.
    Date,
    DateTime,
    Time,
    YearMonth,
    /// For ToTemporalZonedDateTime.
    Zoned,
    /// For `ZonedDateTime.prototype.with`.
    PartialZoned,
    RelativeTo,
    /// For `PlainYearMonth.prototype.toPlainDate`.
    Day,
    /// For `PlainMonthDay.prototype.toPlainDate`.
    Year,
}

impl FieldSet {
    const fn bits(self) -> u16 {
        const YEAR: u16 = Field::Era.bit() | Field::EraYear.bit() | Field::Year.bit();
        const YEAR_MONTH: u16 = YEAR | Field::Month.bit() | Field::MonthCode.bit();
        const DATE: u16 = YEAR_MONTH | Field::Day.bit();
        const TIME: u16 = Field::Hour.bit()
            | Field::Minute.bit()
            | Field::Second.bit()
            | Field::Millisecond.bit()
            | Field::Microsecond.bit()
            | Field::Nanosecond.bit();
        match self {
            FieldSet::Date => DATE,
            FieldSet::DateTime => DATE | TIME,
            FieldSet::Time => TIME,
            FieldSet::YearMonth => YEAR_MONTH,
            FieldSet::Zoned | FieldSet::RelativeTo => {
                DATE | TIME | Field::Offset.bit() | Field::TimeZone.bit()
            }
            FieldSet::PartialZoned => DATE | TIME | Field::Offset.bit(),
            FieldSet::Day => Field::Day.bit(),
            FieldSet::Year => YEAR,
        }
    }

    const fn has_offset(self) -> bool {
        self.bits() & Field::Offset.bit() != 0
    }
}

/// A Calendar Fields Record, and the calendar that it is in.
#[derive(Clone, Copy, Debug)]
pub struct Fields {
    set: FieldSet,
    pub(crate) calendar: CalendarId,
    pub(crate) date: DateFields,
    /// From the hour to the nanosecond.
    time: [Option<i16>; 6],
    pub(crate) offset_nanoseconds: Option<i64>,
    pub(crate) time_zone: Option<TimeZone>,
}

impl Fields {
    #[inline]
    pub fn new(set: FieldSet, calendar: CalendarId) -> Fields {
        Fields {
            set,
            calendar,
            date: DateFields::default(),
            time: [None; 6],
            offset_nanoseconds: None,
            time_zone: None,
        }
    }

    /// In the order that they are read.
    #[inline]
    pub fn properties(&self) -> impl Iterator<Item = Field> + use<> {
        let mut bits = self.set.bits();
        if !self.calendar.has_eras() {
            bits &= !(Field::Era.bit() | Field::EraYear.bit());
        }
        core::iter::from_fn(move || {
            let field = Field::ALL.get(bits.trailing_zeros() as usize)?;
            bits &= bits - 1;
            Some(*field)
        })
    }

    /// For a value that is `undefined`.
    #[inline]
    pub fn skip(&self, field: Field) -> Result<()> {
        if field == Field::TimeZone && self.set == FieldSet::Zoned {
            return Err(Error::MissingTimeZone);
        }
        Ok(())
    }

    #[inline]
    pub fn set_number(&mut self, field: Field, number: f64) -> Result<()> {
        let worded = |plain, zoned| if self.set.has_offset() { zoned } else { plain };
        let positive =
            |not_finite, not_positive| match to_integer_with_truncation(number, not_finite)? {
                ..=0 => Err(not_positive),
                integer => Ok(Some(saturate(integer))),
            };
        let time_index = match field {
            Field::Day => {
                let error = worded(Error::DayNotPositive, Error::DayPropertyNotPositive);
                self.date.day = match self.set {
                    FieldSet::Day => {
                        positive(Error::DayPropertyNotFinite, Error::DayPropertyBelowOne)?
                    }
                    _ => positive(error, error)?,
                };
                return Ok(());
            }
            Field::Month => {
                let error = worded(Error::MonthNotPositive, Error::MonthPropertyNotPositive);
                self.date.month = positive(error, error)?;
                return Ok(());
            }
            Field::EraYear => {
                let error = worded(Error::EraYearNotFinite, Error::EraYearPropertyNotFinite);
                self.date.era_year = Some(to_integer_with_truncation(number, error)?);
                return Ok(());
            }
            Field::Year => {
                let error = worded(Error::YearNotFinite, Error::YearPropertyNotFinite);
                self.date.year = Some(to_integer_with_truncation(number, error)?);
                return Ok(());
            }
            Field::Hour => 0,
            Field::Minute => 1,
            Field::Second => 2,
            Field::Millisecond => 3,
            Field::Microsecond => 4,
            Field::Nanosecond => 5,
            Field::Era | Field::MonthCode | Field::Offset | Field::TimeZone => {
                unreachable!("{field:?} is not a number")
            }
        };
        if !number.is_finite() {
            return Err(Error::TimeFieldNotFinite);
        }
        self.time[time_index] = Some(number as i16);
        Ok(())
    }

    pub fn set_text<'a>(&mut self, field: Field, text: Text<'a>) -> Result<(), InputError<'a>> {
        match field {
            Field::Era => self.date.era = Some(self.calendar.find_era(text)),
            Field::MonthCode => self.date.month_code = Some(MonthCode::parse(text)?),
            Field::Offset => {
                let offset = parse::utc_offset(text);
                self.offset_nanoseconds =
                    Some(offset.ok_or(InputError::Text(TextError::Offset, text))?);
            }
            _ => unreachable!("{field:?} is not a string"),
        }
        Ok(())
    }

    #[inline]
    pub fn set_time_zone(&mut self, time_zone: TimeZone) {
        self.time_zone = Some(time_zone);
    }

    /// The last step where the fields are `partial`, and of ToTemporalTimeRecord.
    pub fn require_any(&self) -> Result<()> {
        if self.date != DateFields::default()
            || self.time != [None; 6]
            || self.offset_nanoseconds.is_some()
        {
            return Ok(());
        }
        Err(match self.set {
            FieldSet::Time => Error::NoTimeFields,
            FieldSet::DateTime => Error::NoDateTimeFields,
            FieldSet::PartialZoned => Error::NoZonedFields,
            _ => Error::NoDateFields,
        })
    }

    /// RegulateTime, with the fields that are not set taken from `base`.
    #[inline]
    pub(crate) fn time_over(&self, base: PlainTime, overflow: Overflow) -> Result<PlainTime> {
        let mut fields = base.fields();
        for (field, given) in fields.iter_mut().zip(self.time) {
            *field = given.map_or(*field, i32::from);
        }
        PlainTime::regulate(fields, overflow)
    }

    /// InterpretTemporalDateTimeFields
    pub(crate) fn date_time(&self, overflow: Overflow) -> Result<IsoDateTime> {
        Ok(IsoDateTime {
            date: self.calendar.date_from_fields(&self.date, overflow)?,
            time: self.time_over(PlainTime::MIDNIGHT, overflow)?,
        })
    }

    /// InterpretTemporalDateTimeFields, with the fields that are not set taken from `base`.
    pub(crate) fn date_time_over(
        &self,
        base: IsoDateTime,
        overflow: Overflow,
    ) -> Result<IsoDateTime> {
        let date = DateFields::of_date(self.calendar, base.date)?.merged(&self.date);
        Ok(IsoDateTime {
            date: self.calendar.date_from_fields(&date, overflow)?,
            time: self.time_over(base.time, overflow)?,
        })
    }
}
