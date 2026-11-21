//! `unicode/ucal.h`

pub(crate) type UCalendarType = i32;
pub(crate) const UCAL_GREGORIAN: UCalendarType = 1;

pub(crate) type UCalendarDateFields = i32;
pub(crate) const UCAL_ERA: UCalendarDateFields = 0;
pub(crate) const UCAL_YEAR: UCalendarDateFields = 1;
pub(crate) const UCAL_MONTH: UCalendarDateFields = 2;
pub(crate) const UCAL_DATE: UCalendarDateFields = 5;
pub(crate) const UCAL_DAY_OF_YEAR: UCalendarDateFields = 6;
pub(crate) const UCAL_DAY_OF_WEEK: UCalendarDateFields = 7;
pub(crate) const UCAL_AM_PM: UCalendarDateFields = 9;
pub(crate) const UCAL_HOUR: UCalendarDateFields = 10;
pub(crate) const UCAL_HOUR_OF_DAY: UCalendarDateFields = 11;
pub(crate) const UCAL_MINUTE: UCalendarDateFields = 12;
pub(crate) const UCAL_SECOND: UCalendarDateFields = 13;
pub(crate) const UCAL_MILLISECOND: UCalendarDateFields = 14;
pub(crate) const UCAL_ZONE_OFFSET: UCalendarDateFields = 15;
pub(crate) const UCAL_DST_OFFSET: UCalendarDateFields = 16;
pub(crate) const UCAL_YEAR_WOY: UCalendarDateFields = 17;
pub(crate) const UCAL_EXTENDED_YEAR: UCalendarDateFields = 19;
pub(crate) const UCAL_JULIAN_DAY: UCalendarDateFields = 20;
pub(crate) const UCAL_IS_LEAP_MONTH: UCalendarDateFields = 22;
pub(crate) const UCAL_ORDINAL_MONTH: UCalendarDateFields = 23;
pub(crate) const UCAL_FIELD_COUNT: UCalendarDateFields = 24;

pub(crate) type UCalendarDaysOfWeek = i32;
pub(crate) const UCAL_SUNDAY: UCalendarDaysOfWeek = 1;
pub(crate) const UCAL_MONDAY: UCalendarDaysOfWeek = 2;
pub(crate) const UCAL_THURSDAY: UCalendarDaysOfWeek = 5;
pub(crate) const UCAL_SATURDAY: UCalendarDaysOfWeek = 7;

pub(crate) type UCalendarMonths = i32;
pub(crate) const UCAL_JANUARY: UCalendarMonths = 0;
pub(crate) const UCAL_FEBRUARY: UCalendarMonths = 1;
pub(crate) const UCAL_MARCH: UCalendarMonths = 2;
pub(crate) const UCAL_JULY: UCalendarMonths = 6;
pub(crate) const UCAL_DECEMBER: UCalendarMonths = 11;

pub(crate) type USystemTimeZoneType = i32;
pub(crate) const UCAL_ZONE_TYPE_CANONICAL: USystemTimeZoneType = 1;

pub(crate) type UCalendarDisplayNameType = i32;
pub(crate) const UCAL_STANDARD: UCalendarDisplayNameType = 0;
pub(crate) const UCAL_DST: UCalendarDisplayNameType = 2;

pub(crate) type UCalendarAttribute = i32;
pub(crate) const UCAL_FIRST_DAY_OF_WEEK: UCalendarAttribute = 1;

pub(crate) type UCalendarLimitType = i32;
pub(crate) const UCAL_LEAST_MAXIMUM: UCalendarLimitType = 3;
pub(crate) const UCAL_ACTUAL_MAXIMUM: UCalendarLimitType = 5;

pub(crate) type UCalendarWeekdayType = i32;
pub(crate) const UCAL_WEEKDAY: UCalendarWeekdayType = 0;
pub(crate) const UCAL_WEEKEND: UCalendarWeekdayType = 1;

pub(crate) type UTimeZoneTransitionType = i32;
pub(crate) const UCAL_TZ_TRANSITION_NEXT: UTimeZoneTransitionType = 0;
pub(crate) const UCAL_TZ_TRANSITION_PREVIOUS: UTimeZoneTransitionType = 2;
pub(crate) const UCAL_TZ_TRANSITION_PREVIOUS_INCLUSIVE: UTimeZoneTransitionType = 3;

pub(crate) type UTimeZoneLocalOption = i32;
pub(crate) const UCAL_TZ_LOCAL_FORMER: UTimeZoneLocalOption = 4;
pub(crate) const UCAL_TZ_LOCAL_LATTER: UTimeZoneLocalOption = 12;
