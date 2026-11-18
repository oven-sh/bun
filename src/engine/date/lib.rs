//! Calendar arithmetic, time zones and date parsing.

#![forbid(unsafe_code)]
#![feature(float_conversions)]

mod cache;
mod civil;
mod fields;
mod format;
mod parse;
mod time_value;
mod zone;

pub use cache::DateCache;
pub use civil::{
    CivilDate, civil_from_days, day_of_year, days_from_civil, days_in_month, days_in_year,
    is_leap_year, week_day,
};
pub use fields::{BitField, Component, DateFields};
pub use format::{MAX_ISO_STRING_LENGTH, date_string, iso_string, utc_string, write_iso_string};
pub use parse::{parse_cookie_date, parse_date_as_utc};
pub use time_value::{
    MAX_TIME_VALUE, MS_PER_DAY, make_date, make_date_from_integers, make_day, make_full_year,
    make_time, ms_from_time, time_clip,
};
pub use zone::{Identifier, LocalOffsets, TimeZone, TimeZoneId, ZoneRules, set_time_zone_override};
