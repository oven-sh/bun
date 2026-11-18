//! The `Temporal` object.
//!
//! Each class has a type for what its instances hold, with a method for each of its functions that takes the arguments
//! after their conversion. Checks that come between two reads of a property are functions of their own. Only `classes`
//! knows of objects.

#![forbid(unsafe_code)]
#![feature(negative_impls)]
#![allow(improper_ctypes_definitions)]

mod calendar;
mod classes;
mod duration;
mod error;
mod fields;
mod format;
mod input_error;
mod instant;
mod integer;
mod internal_duration;
mod iso_date;
mod iso_date_time;
mod option_values;
mod parse;
mod plain_date;
mod plain_date_time;
mod plain_month_day;
mod plain_time;
mod plain_year_month;
mod ratio;
mod relative_duration;
mod relative_rounding;
mod relative_to;
mod rounding;
mod settings;
mod time_duration;
mod time_zone;
mod unit;
mod unresolved_zoned;
mod zoned_date_time;

pub use calendar::{CalendarDate, CalendarId, Era, EraYear};
pub use classes::{
    TemporalValue, initialize_slot, instant_from_epoch_milliseconds, to_temporal_date,
    to_temporal_date_time, to_temporal_duration, to_temporal_instant, to_temporal_time,
};
pub use duration::{Duration, PartialDuration};
pub use error::{Error, ErrorKind, Result};
pub use fields::{Conversion, Field, FieldSet, Fields};
pub use format::IsoText;
pub use input_error::{InputError, NumberError, TextError};
pub use instant::Instant;
pub use integer::to_integer_with_truncation;
pub use iso_date::{IsoDate, IsoWeek};
pub use iso_date_time::IsoDateTime;
pub use option_values::{
    Direction, Disambiguation, OffsetOption, OptionValue, Overflow, RoundingMode, ShowCalendar,
    ShowOffset, ShowTimeZone,
};
pub use plain_date::{ParsedPlainDate, PlainDate};
pub use plain_date_time::{ParsedPlainDateTime, PlainDateTime};
pub use plain_month_day::{ParsedPlainMonthDay, PlainMonthDay};
pub use plain_time::PlainTime;
pub use plain_year_month::{ParsedPlainYearMonth, PlainYearMonth};
pub use relative_duration::DurationRoundOptions;
pub use relative_to::RelativeTo;
pub use rounding::RoundingIncrement;
pub use settings::{
    DifferenceOperation, DifferenceOptions, FractionalSecondDigits, Precision, PrecisionOptions,
    RoundOptions,
};
pub use time_zone::{find_time_zone, parse_time_zone};
pub use unit::{Unit, UnitOption};
pub use unresolved_zoned::UnresolvedZonedDateTime;
pub use zoned_date_time::{ZonedDateTime, ZonedDisplay, ZonedOptions};

use calendar::MonthCode;
use internal_duration::{DateDuration, InternalDuration};
use time_duration::TimeDuration;
