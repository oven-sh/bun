//! Calendars: the time and the fields are computed from each other on demand. ICU4C: calendar.cpp

use crate::common::bytes::I32s;
use crate::common::locid::Locale;
use crate::common::loclikely::{
    ulocimp_get_region_for_supplemental_data, ulocimp_minimize_subtags,
};
use crate::common::memory::{Appendable, oom_checked, try_shared};
use crate::common::putil::uprv_get_utc_time;
use crate::common::slice_ext::SliceExt;
use crate::common::uenum::{Item, StringEnumeration};
use crate::common::uinvchar::{invariant_prefix, uprv_is_invariant_ustring};
use crate::common::uloc::{ulocimp_canonicalize, ulocimp_get_keyword_value};
use crate::common::uresdata::DataString;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::gregoimp::*;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::timezone::{LocalOptions, TimeZone, invariant_c_string, preloaded_zone_id};
use crate::i18n::unicode::ucal::*;
use crate::i18n::{cecal, chnsecal, gregocal, hebrwcal, indiancal, islamcal, persncal};
use bun_core::strings;
use std::ffi::CStr;
use std::ops::{Deref, DerefMut};
use std::sync::{Arc, OnceLock};

#[derive(Clone, Copy, PartialEq)]
#[repr(i32)]
pub(crate) enum Field {
    Era = UCAL_ERA,
    Year = UCAL_YEAR,
    Month = UCAL_MONTH,
    WeekOfYear = UCAL_WEEK_OF_YEAR,
    Date = UCAL_DATE,
    DayOfYear = UCAL_DAY_OF_YEAR,
    DayOfWeek = UCAL_DAY_OF_WEEK,
    AmPm = UCAL_AM_PM,
    Hour = UCAL_HOUR,
    HourOfDay = UCAL_HOUR_OF_DAY,
    Minute = UCAL_MINUTE,
    Second = UCAL_SECOND,
    Millisecond = UCAL_MILLISECOND,
    ZoneOffset = UCAL_ZONE_OFFSET,
    DstOffset = UCAL_DST_OFFSET,
    YearWoy = UCAL_YEAR_WOY,
    ExtendedYear = UCAL_EXTENDED_YEAR,
    JulianDay = UCAL_JULIAN_DAY,
    IsLeapMonth = UCAL_IS_LEAP_MONTH,
    /// Computed only by the Chinese and Dangi calendars.
    OrdinalMonth = UCAL_ORDINAL_MONTH,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum CalendarType {
    Gregorian,
    Japanese,
    Buddhist,
    Roc,
    Persian,
    IslamicCivil,
    Islamic,
    Hebrew,
    Chinese,
    Indian,
    Coptic,
    Ethiopic,
    EthiopicAmeteAlem,
    Iso8601,
    Dangi,
    IslamicUmalqura,
    IslamicTbla,
    IslamicRgsa,
}
use CalendarType::*;

impl CalendarType {
    /// In the order in which `keyword_values_for_locale` lists them.
    const ALL: [CalendarType; 18] = [
        Gregorian,
        Japanese,
        Buddhist,
        Roc,
        Persian,
        IslamicCivil,
        Islamic,
        Hebrew,
        Chinese,
        Indian,
        Coptic,
        Ethiopic,
        EthiopicAmeteAlem,
        Iso8601,
        Dangi,
        IslamicUmalqura,
        IslamicTbla,
        IslamicRgsa,
    ];

    pub(crate) fn name(self) -> &'static CStr {
        match self {
            Gregorian => c"gregorian",
            Japanese => c"japanese",
            Buddhist => c"buddhist",
            Roc => c"roc",
            Persian => c"persian",
            IslamicCivil => c"islamic-civil",
            Islamic => c"islamic",
            Hebrew => c"hebrew",
            Chinese => c"chinese",
            Indian => c"indian",
            Coptic => c"coptic",
            Ethiopic => c"ethiopic",
            EthiopicAmeteAlem => c"ethiopic-amete-alem",
            Iso8601 => c"iso8601",
            Dangi => c"dangi",
            IslamicUmalqura => c"islamic-umalqura",
            IslamicTbla => c"islamic-tbla",
            IslamicRgsa => c"islamic-rgsa",
        }
    }

    fn from_name(name: &[u8]) -> Option<CalendarType> {
        CalendarType::ALL
            .into_iter()
            .find(|calendar_type| name.eq_ignore_ascii_case(calendar_type.name().to_bytes()))
    }

    pub(crate) fn for_locale(locale: &Locale) -> Result<CalendarType, UErrorCode> {
        LocaleData::for_locale(locale).map(|data| data.calendar_type)
    }

    /// Returns the type named by the keyword `calendar`, or else the first preference of the region.
    fn for_locale_id(locale_id: &[u8]) -> CalendarType {
        let Ok(canonical) = ulocimp_canonicalize(locale_id) else {
            return Gregorian;
        };
        let named = ulocimp_get_keyword_value(&canonical, b"calendar")
            .ok()
            .and_then(|name| Self::from_name(&name));
        named
            .or_else(|| Self::preferred_in_region(&canonical))
            .unwrap_or(Gregorian)
    }

    fn preferred_in_region(locale_id: &[u8]) -> Option<CalendarType> {
        let order = supplemental_data_for_region(b"calendarPreferenceData", locale_id).ok()?;
        let name = ures_get_string_by_index(&order, 0).ok().flatten()?;
        Self::from_name(&invariant_c_string(name.iter()))
            .filter(|_| uprv_is_invariant_ustring(name.iter()))
    }

    /// Returns the preferences of the region, followed by all other types unless `commonly_used`.
    pub(crate) fn keyword_values_for_locale(
        locale_id: &[u8],
        commonly_used: bool,
    ) -> Result<CalendarNames, UErrorCode> {
        let order = supplemental_data_for_region(b"calendarPreferenceData", locale_id)?;
        let mut values = Vec::new();
        for index in 0..order.get_size() {
            let name = ures_get_data_string_by_index(&order, index)?.unwrap_or(DataString::EMPTY);
            values.add_each(invariant_prefix(name.units().iter()));
            values.add(0);
        }
        if !commonly_used {
            let preferred = values.len();
            for other in CalendarType::ALL.map(CalendarType::name) {
                let name = other.to_bytes();
                if !strings::split(values.slice(..preferred), b"\0").any(|value| value == name) {
                    values.add_all(other.to_bytes_with_nul());
                }
            }
        }
        oom_checked(CalendarNames { values, current: 0 })
    }
}

pub(crate) struct CalendarNames {
    /// Each ends with NUL and can be empty.
    values: Vec<u8>,
    current: usize,
}

impl StringEnumeration for CalendarNames {
    fn next(&mut self) -> Result<Option<Item<'_>>, UErrorCode> {
        let value = CStr::from_bytes_until_nul(self.values.slice(self.current..)).ok();
        self.current += value.map_or(0, |value| value.count_bytes() + 1);
        Ok(value.map(Item::Chars))
    }
}

/// Returns the entry for the locale's region, or else for 001, which is at the top level if `table` is missing.
fn supplemental_data_for_region(
    table: &[u8],
    locale_id: &[u8],
) -> Result<UResourceBundle, UErrorCode> {
    let region = ulocimp_get_region_for_supplemental_data(locale_id, true)?;
    let mut bundle = ures_open_direct(None, b"supplementalData")?;
    let found = bundle.descend(table);
    match found.and_then(|()| bundle.get_by_key(&region)) {
        Err(U_MISSING_RESOURCE_ERROR) => bundle.get_by_key(b"001"),
        found => found,
    }
}

#[derive(Clone, Copy)]
struct WeekData {
    first_day_of_week: UCalendarDaysOfWeek,
    minimal_days_in_first_week: i32,
    weekend_onset: i8,
    weekend_cease: i8,
    /// Whether the weekend has the whole of these two days.
    onset_is_whole: bool,
    cease_is_whole: bool,
}

/// False if the language names a bundle that is not a locale, such as "plurals".
fn has_month_names(locale: &Locale) -> bool {
    let has_no_script =
        |minimal: Vec<u8>| Locale::create_from_name(&minimal).get_script().is_empty();
    let mut used = locale.clone();
    if locale.get_country().is_empty()
        || (!locale.get_script().is_empty()
            && ulocimp_minimize_subtags(locale.get_name()).is_ok_and(has_no_script))
    {
        _ = used.add_likely_subtags();
        used = Locale::from_parts(used.get_language(), used.get_country(), b"", b"");
    }
    ures_open(None, used.get_base_name())
        .and_then(|mut calendars| {
            // Without this key the calendar is looked up at the top level.
            _ = calendars.descend(b"calendar");
            calendars.get_by_key_with_fallback(b"gregorian")
        })
        .and_then(|gregorian| gregorian.get_by_key_with_fallback(b"monthNames"))
        .is_ok()
}

impl WeekData {
    const DEFAULT: WeekData = WeekData {
        first_day_of_week: UCAL_SUNDAY,
        minimal_days_in_first_week: 1,
        weekend_onset: UCAL_SATURDAY as i8,
        weekend_cease: UCAL_SUNDAY as i8,
        onset_is_whole: true,
        cease_is_whole: true,
    };

    fn from_resource(numbers: I32s) -> Option<WeekData> {
        let is_valid = numbers.len() == 6
            && [0, 1, 2, 4]
                .iter()
                .all(|&index| (1..=7).contains(&numbers.at(index)));
        is_valid.then(|| WeekData {
            first_day_of_week: numbers.at(0),
            minimal_days_in_first_week: numbers.at(1),
            weekend_onset: numbers.at(2) as i8,
            weekend_cease: numbers.at(4) as i8,
            onset_is_whole: numbers.at(3) == 0,
            cease_is_whole: numbers.at(5) >= U_MILLIS_PER_DAY,
        })
    }

    // ICU4C: calendar.cpp, Calendar::setWeekData
    fn load(locale: &Locale) -> Result<WeekData, UErrorCode> {
        const DAYS: [&[u8]; 7] = [b"sun", b"mon", b"tue", b"wed", b"thu", b"fri", b"sat"];
        if !has_month_names(locale) {
            return Ok(WeekData::DEFAULT);
        }
        let Ok(numbers) = supplemental_data_for_region(b"weekData", locale.get_name()) else {
            return Ok(WeekData::DEFAULT);
        };
        let mut week = numbers
            .get_int_vector()
            .ok()
            .and_then(WeekData::from_resource)
            .ok_or(U_INVALID_FORMAT_ERROR)?;
        let first_day = locale.get_keyword_value(b"fw").unwrap_or_default();
        if let Some((_, day)) = DAYS
            .into_iter()
            .zip(UCAL_SUNDAY..)
            .find(|&(name, _)| name == first_day)
        {
            week.first_day_of_week = day;
        }
        Ok(week)
    }
}

struct LocaleData {
    calendar_type: CalendarType,
    week: WeekData,
}

impl LocaleData {
    fn load(locale: &Locale) -> Result<LocaleData, UErrorCode> {
        // The order in which canonical IDs are cached shows if links lead to links.
        preloaded_zone_id()?;
        let calendar_type = CalendarType::for_locale_id(locale.get_name());
        let mut week = WeekData::load(locale)?;
        match calendar_type {
            Iso8601 => {
                // A keyword that cannot be read counts as present.
                let lacks = |keyword: &[u8]| {
                    locale
                        .get_keyword_value(keyword)
                        .is_ok_and(|value| value.is_empty())
                };
                if lacks(b"fw") && lacks(b"rg") {
                    week.first_day_of_week = UCAL_MONDAY;
                }
                week.minimal_days_in_first_week = 4;
            }
            // Loaded now, so that computing fields never allocates.
            Japanese => _ = gregocal::japanese_eras()?,
            _ => {}
        }
        Ok(LocaleData {
            calendar_type,
            week,
        })
    }

    fn for_locale(locale: &Locale) -> Result<Arc<LocaleData>, UErrorCode> {
        static CACHE: LocaleCache<LocaleData> = LocaleCache::new();
        CACHE.get_or_create(locale.get_name(), || Self::load(locale))
    }
}

#[inline]
pub(crate) fn checked_add32(a: i32, b: i32) -> Result<i32, UErrorCode> {
    a.checked_add(b).ok_or(U_ILLEGAL_ARGUMENT_ERROR)
}

#[inline]
pub(crate) fn checked_f64_to_i32(value: f64) -> Result<i32, UErrorCode> {
    if value >= f64::from(i32::MIN) && value <= f64::from(i32::MAX) {
        Ok(value as i32)
    } else {
        Err(U_ILLEGAL_ARGUMENT_ERROR)
    }
}

/// The extended year of the Hebrew, Chinese and Dangi calendars is clamped to this magnitude.
pub(crate) const LAST_YEAR: i32 = 5_000_000;

const FIELD_COUNT: usize = UCAL_FIELD_COUNT as usize;

const DATE_FIELDS: [Field; 6] = [
    Field::Era,
    Field::Year,
    Field::Month,
    Field::Date,
    Field::DayOfYear,
    Field::ExtendedYear,
];

const UNSET: i8 = 0;
const INTERNALLY_SET: i8 = 1;
const MINIMUM_USER_STAMP: i8 = 2;

/// Perf: a clone copies more than 128 bytes with `memcpy`, and a shorter array with a slow `rep movs`.
#[derive(Clone, Copy, Default)]
struct Fields {
    values: [i32; FIELD_COUNT],
    /// The order in which fields were set: `UNSET`, `INTERNALLY_SET`, or a number from `MINIMUM_USER_STAMP` up.
    stamps: [i8; FIELD_COUNT],
    gregorian_date: grego::Fields,
}

/// Cloning does not allocate.
#[derive(Clone)]
pub(crate) struct Calendar {
    fields: Fields,
    time: UDate,
    /// Without a zone the calendar has only week data.
    zone: Option<Arc<TimeZone>>,
    week: WeekData,
    pub(crate) cutover: gregocal::Cutover,
    calendar_type: CalendarType,
    next_stamp: i8,
    is_time_set: bool,
    /// The fields were computed from `time`. Implies `is_time_set`.
    are_fields_set: bool,
    /// The time was set last. The fields must be computed before one of them is set.
    are_fields_virtually_set: bool,
}

/// A calendar to which C has a pointer. `const` functions compute on a copy and publish it, so threads can share it.
pub(crate) struct SharedCalendar {
    base: Calendar,
    timed: OnceLock<Calendar>,
    complete: OnceLock<Calendar>,
}

impl SharedCalendar {
    /// Returns the calendar with its time computed.
    #[inline]
    pub(crate) fn timed(&self) -> Result<&Calendar, UErrorCode> {
        let newest = &**self;
        if newest.is_time_set {
            Ok(newest)
        } else {
            publish(newest, |copy| copy.time().map(drop), &self.timed)
        }
    }

    /// Returns the calendar with its time and its fields computed.
    #[inline]
    pub(crate) fn completed(&self) -> Result<&Calendar, UErrorCode> {
        let newest = &**self;
        if newest.are_fields_set {
            Ok(newest)
        } else {
            publish(newest, Calendar::complete, &self.complete)
        }
    }

    /// Perf: the offsets are all that is asked of most Gregorian calendars, whose other fields cannot fail.
    pub(crate) fn get(&self, field: Field) -> Result<i32, UErrorCode> {
        let newest = &**self;
        let is_offset = matches!(field, Field::ZoneOffset | Field::DstOffset);
        if is_offset && newest.is_time_set && newest.calendar_type == Gregorian {
            let offsets = newest.time_zone()?.get_offset(newest.time, false)?;
            return Ok(if let Field::ZoneOffset = field {
                offsets.raw_offset
            } else {
                offsets.dst_savings
            });
        }
        self.completed().map(|cal| cal.internal_get(field))
    }

    #[inline(never)]
    fn settle(&mut self) {
        if let Some(timed) = self.timed.take() {
            self.base = timed;
        }
        if let Some(complete) = self.complete.take() {
            self.base = complete;
        }
    }
}

fn publish<'a>(
    newest: &Calendar,
    compute: fn(&mut Calendar) -> Result<(), UErrorCode>,
    cell: &'a OnceLock<Calendar>,
) -> Result<&'a Calendar, UErrorCode> {
    let mut copy = newest.clone();
    compute(&mut copy)?;
    Ok(cell.get_or_init(|| copy))
}

/// Returns the newest state.
impl Deref for SharedCalendar {
    type Target = Calendar;

    #[inline]
    fn deref(&self) -> &Calendar {
        self.complete
            .get()
            .or_else(|| self.timed.get())
            .unwrap_or(&self.base)
    }
}

impl DerefMut for SharedCalendar {
    #[inline]
    fn deref_mut(&mut self) -> &mut Calendar {
        if self.complete.get().is_some() || self.timed.get().is_some() {
            self.settle();
        }
        &mut self.base
    }
}

impl From<Calendar> for SharedCalendar {
    fn from(base: Calendar) -> Self {
        Self {
            base,
            timed: OnceLock::new(),
            complete: OnceLock::new(),
        }
    }
}

impl Clone for SharedCalendar {
    fn clone(&self) -> Self {
        Calendar::clone(self).into()
    }
}

// What depends on the type.
impl Calendar {
    /// Returns the number of the last month, which counts from 0.
    pub(crate) fn last_month(&self) -> i32 {
        match self.calendar_type {
            Coptic | Ethiopic | EthiopicAmeteAlem | Hebrew => 12,
            _ => 11,
        }
    }

    pub(crate) fn days_in_shortest_year(&self) -> i32 {
        match self.calendar_type {
            Hebrew | Chinese | Dangi => 353,
            Islamic | IslamicCivil | IslamicTbla | IslamicUmalqura | IslamicRgsa => 354,
            _ => 365,
        }
    }

    /// Returns the Julian day of `day` in `month`, or in the year if `month` is `None`.
    fn julian_day_of(&self, eyear: i32, month: Option<i32>, day: i32) -> Result<i32, UErrorCode> {
        let (is_day_of_year, month) = (month.is_none(), month.unwrap_or(0));
        let is_leap_month = !is_day_of_year && self.internal_get(Field::IsLeapMonth) != 0;
        let day_before_month = match self.calendar_type {
            Gregorian | Buddhist | Roc | Japanese | Iso8601 => {
                return self
                    .cutover
                    .julian_day_of(eyear, month, day, is_day_of_year);
            }
            Coptic | Ethiopic | EthiopicAmeteAlem => cecal::month_start(self, eyear, month),
            Hebrew => hebrwcal::month_start(eyear, month)?,
            Indian => indiancal::month_start(eyear, month)?,
            Islamic | IslamicRgsa => return Err(U_UNSUPPORTED_ERROR),
            IslamicCivil | IslamicTbla | IslamicUmalqura => {
                islamcal::month_start(self, eyear, month)?
            }
            Persian => persncal::month_start(eyear, month)?,
            Chinese | Dangi => chnsecal::month_start(self, eyear, month, is_leap_month)?.into(),
        };
        checked_add32(day, day_before_month as i32)
    }

    /// The fields must be computed.
    fn month_length(&self) -> Result<i32, UErrorCode> {
        let (eyear, month) = (
            self.internal_get(Field::ExtendedYear),
            self.internal_get(Field::Month),
        );
        Ok(match self.calendar_type {
            Gregorian | Buddhist | Roc | Japanese | Iso8601 => {
                grego::days_in_month(self.cutover.is_leap_year(eyear), month).into()
            }
            Coptic | Ethiopic | EthiopicAmeteAlem => {
                (cecal::month_start(self, eyear, month + 1)
                    - cecal::month_start(self, eyear, month)) as i32
            }
            Hebrew => hebrwcal::month_length(eyear, month)?,
            Indian => indiancal::month_length(eyear, month),
            Islamic | IslamicRgsa => return Err(U_UNSUPPORTED_ERROR),
            IslamicCivil | IslamicTbla => islamcal::civil::month_length(eyear, month),
            IslamicUmalqura => islamcal::umalqura::month_length(eyear, month),
            Persian => persncal::month_length(eyear, month),
            Chinese | Dangi => chnsecal::month_length(self, eyear, month)?,
        })
    }

    fn year_length(&self, eyear: i32) -> Result<i32, UErrorCode> {
        Ok(match self.calendar_type {
            Gregorian | Buddhist | Roc | Japanese | Iso8601 => {
                365 + i32::from(self.cutover.is_leap_year(eyear))
            }
            Coptic | Ethiopic | EthiopicAmeteAlem => cecal::year_length(eyear),
            Hebrew => hebrwcal::year_length(eyear)?,
            Indian => indiancal::year_length(eyear),
            Islamic | IslamicRgsa => islamcal::year_length(eyear),
            IslamicCivil | IslamicTbla => islamcal::civil::year_length(eyear),
            IslamicUmalqura => islamcal::umalqura::year_length(eyear),
            Persian => persncal::year_length(eyear),
            Chinese | Dangi => chnsecal::year_length(self, eyear)?,
        })
    }

    /// Sets the era, the years, the months, the day of the month and the day of the year.
    fn compute_date_fields(&mut self, julian_day: i32) -> Result<(), UErrorCode> {
        match self.calendar_type {
            Gregorian | Iso8601 => gregocal::compute_fields(self, julian_day),
            Buddhist => gregocal::compute_buddhist_fields(self, julian_day),
            Roc => gregocal::compute_roc_fields(self, julian_day),
            Japanese => gregocal::compute_japanese_fields(self, julian_day)?,
            Coptic | Ethiopic | EthiopicAmeteAlem => cecal::compute_fields(self, julian_day)?,
            Hebrew => hebrwcal::compute_fields(self, julian_day),
            Indian => indiancal::compute_fields(self, julian_day),
            Islamic | IslamicRgsa => islamcal::compute_fields(self, julian_day),
            IslamicCivil | IslamicTbla => islamcal::civil::compute_fields(self, julian_day),
            IslamicUmalqura => islamcal::umalqura::compute_fields(self, julian_day),
            Persian => persncal::compute_fields(self, julian_day),
            Chinese | Dangi => chnsecal::compute_fields(self, julian_day)?,
        }
        Ok(())
    }

    pub(crate) fn add(&mut self, field: Field, amount: i32) -> Result<(), UErrorCode> {
        if amount == 0 && (self.calendar_type, field) != (Hebrew, Field::Month) {
            return Ok(());
        }
        self.complete()?;
        match (self.calendar_type, field) {
            (Gregorian | Buddhist | Roc | Japanese | Iso8601, _) => Err(U_UNSUPPORTED_ERROR),
            (Hebrew, Field::Month) => hebrwcal::add_months(self, amount),
            (Chinese | Dangi, Field::Month) => chnsecal::add_months(self, amount),
            (_, Field::ExtendedYear | Field::Month) => {
                self.set(field, checked_add32(self.internal_get(field), amount)?);
                self.pin_date()
            }
            (_, Field::Date) => self.add_days(amount),
            _ => Err(U_UNSUPPORTED_ERROR),
        }
    }

    fn add_days(&mut self, amount: i32) -> Result<(), UErrorCode> {
        let (time, offset) = (self.time, self.total_offset());
        self.set_time(time + f64::from(amount) * ONE_DAY)?;
        self.complete()?;
        if self.total_offset() == offset {
            Ok(())
        } else {
            self.restore_wall_time(time, offset)
        }
    }

    fn total_offset(&self) -> i32 {
        self.internal_get(Field::DstOffset)
            .wrapping_add(self.internal_get(Field::ZoneOffset))
    }

    /// Goes back to the wall time of `old_time`. If the zone skips it, the later of the two candidates stays.
    #[cold]
    fn restore_wall_time(&mut self, old_time: UDate, old_offset: i32) -> Result<(), UErrorCode> {
        let wall_time = day_and_millis(old_time + f64::from(old_offset)).1;
        let (time, change) = (self.time, old_offset.wrapping_sub(self.total_offset()));
        let adjustment = change.signum() * (change.wrapping_abs() % U_MILLIS_PER_DAY);
        if self.millis_in_day() == wall_time || adjustment == 0 {
            return Ok(());
        }
        self.set_time(time + f64::from(adjustment))?;
        self.complete()?;
        if self.millis_in_day() != wall_time && adjustment < 0 {
            self.set_time(time)?;
        }
        Ok(())
    }

    /// Returns the related Gregorian year. The fields must be computed.
    pub(crate) fn related_year(&self) -> Result<i32, UErrorCode> {
        let year = self.internal_get(Field::ExtendedYear);
        let difference = match self.calendar_type {
            Islamic | IslamicCivil | IslamicTbla | IslamicUmalqura | IslamicRgsa => {
                return Ok(islamcal::related_year(year));
            }
            Coptic => 284,
            Ethiopic | EthiopicAmeteAlem => 8,
            Hebrew => -3760,
            Indian => 79,
            Persian => 622,
            _ => 0,
        };
        checked_add32(year, difference)
    }

    pub(crate) fn set_gregorian_change(&mut self, date: UDate) -> Result<(), UErrorCode> {
        if !matches!(self.calendar_type, Gregorian | Iso8601) {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let mut work = self.clone();
        work.cutover = gregocal::Cutover::PAPAL;
        work.set_time(date)?;
        self.cutover = gregocal::Cutover::new(date, work.get(Field::ExtendedYear)?);
        self.are_fields_set = false;
        Ok(())
    }
}

impl Calendar {
    pub(crate) fn for_locale(
        zone: Option<TimeZone>,
        locale: &Locale,
    ) -> Result<Calendar, UErrorCode> {
        let data = LocaleData::for_locale(locale)?;
        Ok(Calendar {
            calendar_type: data.calendar_type,
            fields: Fields::default(),
            next_stamp: MINIMUM_USER_STAMP,
            time: uprv_get_utc_time(),
            zone: zone.map(try_shared).transpose()?,
            is_time_set: true,
            are_fields_set: false,
            are_fields_virtually_set: true,
            week: data.week,
            cutover: gregocal::Cutover::PAPAL,
        })
    }

    pub(crate) fn calendar_type(&self) -> CalendarType {
        self.calendar_type
    }

    #[inline]
    fn time(&mut self) -> Result<UDate, UErrorCode> {
        if !self.is_time_set {
            self.time = self.compute_time()?;
            self.is_time_set = true;
        }
        Ok(self.time)
    }

    pub(crate) fn set_time(&mut self, millis: UDate) -> Result<(), UErrorCode> {
        if millis.is_nan() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        self.clear();
        self.time = millis.clamp(MIN_MILLIS, MAX_MILLIS);
        self.is_time_set = true;
        self.are_fields_virtually_set = true;
        Ok(())
    }

    #[inline]
    pub(crate) fn get(&mut self, field: Field) -> Result<i32, UErrorCode> {
        self.complete()?;
        Ok(self.internal_get(field))
    }

    pub(crate) fn set(&mut self, field: Field, value: i32) {
        if self.are_fields_virtually_set && !self.are_fields_set {
            _ = self.compute_fields();
        }
        self.is_time_set = false;
        self.are_fields_set = false;
        self.are_fields_virtually_set = false;
        self.set_field(field, value);
        debug_assert!(self.next_stamp < i8::MAX);
        self.set_stamp(field, self.next_stamp);
        self.next_stamp = self.next_stamp.saturating_add(1);
    }

    pub(crate) fn clear(&mut self) {
        self.fields.values = [0; FIELD_COUNT];
        self.fields.stamps = [UNSET; FIELD_COUNT];
        self.next_stamp = MINIMUM_USER_STAMP;
        self.is_time_set = false;
        self.are_fields_set = false;
        self.are_fields_virtually_set = false;
    }

    #[inline]
    pub(crate) fn complete(&mut self) -> Result<(), UErrorCode> {
        if !self.are_fields_set {
            self.time()?;
            self.compute_fields()?;
            self.are_fields_set = true;
        }
        Ok(())
    }

    pub(crate) fn set_time_zone(&mut self, zone: TimeZone) -> Result<(), UErrorCode> {
        self.zone = Some(try_shared(zone)?);
        self.are_fields_set = false;
        Ok(())
    }

    pub(crate) fn share_time_zone_of(&mut self, other: &Calendar) {
        self.zone = other.zone.as_ref().map(Arc::clone);
        self.are_fields_set = false;
    }

    #[inline]
    pub(crate) fn time_zone(&self) -> Result<&TimeZone, UErrorCode> {
        self.zone.as_deref().ok_or(U_UNSUPPORTED_ERROR)
    }

    /// Returns whether both are clones of one calendar whose zone and cutover have not changed.
    pub(crate) fn has_settings_of(&self, other: &Calendar) -> bool {
        self.zone.as_ref().map(Arc::as_ptr) == other.zone.as_ref().map(Arc::as_ptr)
            && self.cutover == other.cutover
    }

    pub(crate) fn first_day_of_week(&self) -> UCalendarDaysOfWeek {
        self.week.first_day_of_week
    }

    pub(crate) fn day_of_week_type(&self, day: UCalendarDaysOfWeek) -> UCalendarWeekdayType {
        let [onset, cease] = [self.week.weekend_onset, self.week.weekend_cease].map(i32::from);
        let is_outside = if onset <= cease {
            day < onset || day > cease
        } else {
            day < onset && day > cease
        };
        if is_outside {
            UCAL_WEEKDAY
        } else if day == onset && !self.week.onset_is_whole {
            UCAL_WEEKEND_ONSET
        } else if day != onset && day == cease && !self.week.cease_is_whole {
            UCAL_WEEKEND_CEASE
        } else {
            UCAL_WEEKEND
        }
    }

    #[inline]
    pub(crate) fn internal_get(&self, field: Field) -> i32 {
        self.fields.values.at(field as usize)
    }

    #[inline]
    pub(crate) fn internal_set(&mut self, field: Field, value: i32) {
        self.set_field(field, value);
        self.set_stamp(field, INTERNALLY_SET);
    }

    /// Sets the era to 0 and both years to `year`.
    #[inline]
    pub(crate) fn set_date_fields(&mut self, year: i32, month: i32, day: i32, day_of_year: i32) {
        self.internal_set(Field::Era, 0);
        self.internal_set(Field::Year, year);
        self.internal_set(Field::ExtendedYear, year);
        self.internal_set(Field::Month, month);
        self.internal_set(Field::Date, day);
        self.internal_set(Field::DayOfYear, day_of_year);
    }

    #[inline]
    fn set_field(&mut self, field: Field, value: i32) {
        self.fields.values.set(field as usize, value);
    }

    #[inline]
    fn stamp(&self, field: Field) -> i8 {
        self.fields.stamps.at(field as usize)
    }

    #[inline]
    fn set_stamp(&mut self, field: Field, stamp: i8) {
        self.fields.stamps.set(field as usize, stamp);
    }

    #[inline]
    pub(crate) fn internal_get_time(&self) -> UDate {
        self.time
    }

    /// Returns the date in the proleptic Gregorian calendar, which is computed before the fields.
    #[inline]
    pub(crate) fn gregorian_date(&self) -> grego::Fields {
        self.fields.gregorian_date
    }

    pub(crate) fn days_in_month(&self) -> Result<i32, UErrorCode> {
        let mut work = self.clone();
        work.go_to_first(Field::Date)?;
        work.month_length()
    }

    pub(crate) fn days_in_year(&self) -> Result<i32, UErrorCode> {
        let mut work = self.clone();
        work.go_to_first(Field::DayOfYear)?;
        work.year_length(work.internal_get(Field::ExtendedYear))
    }

    /// Goes to the start of the day on which `field` is 1.
    #[inline(always)]
    fn go_to_first(&mut self, field: Field) -> Result<(), UErrorCode> {
        self.set(field, 1);
        for time_field in [
            Field::HourOfDay,
            Field::Minute,
            Field::Second,
            Field::Millisecond,
        ] {
            self.set_field(time_field, 0);
        }
        self.complete()
    }

    /// Clamps the day of the month to the length of the month.
    pub(crate) fn pin_date(&mut self) -> Result<(), UErrorCode> {
        let last = self.days_in_month()?;
        if self.internal_get(Field::Date) > last {
            self.set(Field::Date, last);
        }
        Ok(())
    }
}

// Computing the fields from the time.
impl Calendar {
    fn compute_fields(&mut self) -> Result<(), UErrorCode> {
        let offsets = self.time_zone()?.get_offset(self.time, false)?;
        let local_millis = self.time + f64::from(offsets.total_offset());

        self.fields.stamps = [INTERNALLY_SET; FIELD_COUNT];
        self.next_stamp = MINIMUM_USER_STAMP;
        // They stay unset if `compute_date_fields` fails.
        for field in DATE_FIELDS {
            self.set_stamp(field, UNSET);
        }

        let (days, millis_in_day) = day_and_millis(local_millis);
        let julian_day = checked_f64_to_i32(days + f64::from(EPOCH_START_AS_JULIAN_DAY))?;
        self.set_field(Field::JulianDay, julian_day);
        self.fields.gregorian_date = grego::julian_day_to_fields(julian_day)?;
        self.set_field(Field::DayOfWeek, self.fields.gregorian_date.dow.into());
        self.compute_date_fields(julian_day)?;
        self.compute_week_of_year()?;

        let seconds = millis_in_day / U_MILLIS_PER_SECOND;
        let minutes = seconds / 60;
        let hour = minutes / 60;
        let am_pm = hour / 12;
        self.set_field(Field::Millisecond, millis_in_day % U_MILLIS_PER_SECOND);
        self.set_field(Field::Second, seconds - 60 * minutes);
        self.set_field(Field::Minute, minutes - 60 * hour);
        self.set_field(Field::HourOfDay, hour);
        self.set_field(Field::AmPm, am_pm);
        self.set_field(Field::Hour, hour - 12 * am_pm);
        self.set_field(Field::ZoneOffset, offsets.raw_offset);
        self.set_field(Field::DstOffset, offsets.dst_savings);
        Ok(())
    }

    // ICU4C: calendar.cpp, Calendar::computeWeekFields
    fn compute_week_of_year(&mut self) -> Result<(), UErrorCode> {
        let (first_day, minimal_days) = (
            self.week.first_day_of_week,
            self.week.minimal_days_in_first_week,
        );
        let day_of_week = self.internal_get(Field::DayOfWeek);
        let rel_dow = (day_of_week + 7 - first_day) % 7;
        let eyear = self.internal_get(Field::ExtendedYear);
        let day_of_year = self.internal_get(Field::DayOfYear);
        let mut year_woy = eyear;
        let rel_dow_jan1 = (day_of_week + 7001 - first_day).wrapping_sub(day_of_year) % 7;
        let mut week_of_year = day_of_year.wrapping_add(rel_dow_jan1 - 1) / 7
            + i32::from(7 - rel_dow_jan1 >= minimal_days);

        if week_of_year == 0 {
            // The last week of the previous year.
            year_woy = eyear.wrapping_sub(1);
            week_of_year = self.week_number(day_of_year.wrapping_add(self.year_length(year_woy)?));
        } else {
            let last_doy = self.year_length(eyear)?;
            if day_of_year >= last_doy.wrapping_sub(5) {
                let last_rel_dow = rel_dow
                    .wrapping_add(last_doy)
                    .wrapping_sub(day_of_year)
                    .rem_euclid(7);
                if 6 - last_rel_dow >= minimal_days
                    && day_of_year.wrapping_add(7 - rel_dow) > last_doy
                {
                    // The first week of the next year.
                    (week_of_year, year_woy) = (1, eyear.wrapping_add(1));
                }
            }
        }
        self.set_field(Field::WeekOfYear, week_of_year);
        self.set_field(Field::YearWoy, year_woy);
        Ok(())
    }

    /// Returns the week of the calendar's day, given its number in a month or a year. 0 is before the first week.
    pub(crate) fn week_number(&self, day_of_period: i32) -> i32 {
        let period_start = (self.internal_get(Field::DayOfWeek) - self.week.first_day_of_week + 1)
            .wrapping_sub(day_of_period)
            .rem_euclid(7);
        day_of_period.wrapping_add(period_start - 1) / 7
            + i32::from(7 - period_start >= self.week.minimal_days_in_first_week)
    }

    /// Returns 1 for the first day of the week.
    pub(crate) fn local_day_of_week(&self) -> i32 {
        (self.internal_get(Field::DayOfWeek) + 7 - self.week.first_day_of_week) % 7 + 1
    }

    pub(crate) fn millis_in_day(&self) -> i32 {
        let get = |field| self.internal_get(field);
        ((get(Field::HourOfDay) * 60 + get(Field::Minute)) * 60 + get(Field::Second))
            * U_MILLIS_PER_SECOND
            + get(Field::Millisecond)
    }
}

// Computing the time from the fields.
impl Calendar {
    fn compute_time(&mut self) -> Result<UDate, UErrorCode> {
        let julian_day = self.compute_julian_day()?;
        let get = |field| f64::from(self.internal_get(field));
        let millis_in_day = ((get(Field::HourOfDay) * 60.0 + get(Field::Minute)) * 60.0
            + get(Field::Second))
            * 1000.0
            + get(Field::Millisecond);
        let wall = grego::julian_day_to_millis(julian_day) + millis_in_day;
        let offsets = self
            .time_zone()?
            .get_offset_from_local(wall, LocalOptions::DEFAULT)?;
        Ok(wall - f64::from(offsets.total_offset()))
    }

    /// Returns `alternate_field` if it is newer, else `default_field`.
    fn newer_field(&self, default_field: Field, alternate_field: Field) -> Field {
        if self.stamp(alternate_field) > self.stamp(default_field) {
            alternate_field
        } else {
            default_field
        }
    }

    /// Fields are unset after `compute_date_fields` has failed, which no Gregorian calendar does.
    fn get_or(&self, field: Field, default: i32) -> Result<i32, UErrorCode> {
        match (self.stamp(field), self.calendar_type) {
            (UNSET, Gregorian | Buddhist | Roc | Japanese | Iso8601) => Err(U_UNSUPPORTED_ERROR),
            (UNSET, _) => Ok(default),
            _ => Ok(self.internal_get(field)),
        }
    }

    // ICU4C: calendar.cpp, Calendar::computeJulianDay
    fn compute_julian_day(&mut self) -> Result<i32, UErrorCode> {
        let stamp = self.stamp(Field::JulianDay);
        if stamp >= MINIMUM_USER_STAMP && DATE_FIELDS.iter().all(|&it| self.stamp(it) <= stamp) {
            return Ok(self.internal_get(Field::JulianDay));
        }
        let day_field = self.newer_field(Field::Date, Field::DayOfYear);
        let is_by_era = self.stamp(Field::Era).max(self.stamp(Field::Year)) >= MINIMUM_USER_STAMP;
        // In these two calendars the year equals the extended year.
        if self.stamp(day_field) == UNSET
            || (is_by_era && !matches!(self.calendar_type, EthiopicAmeteAlem | Hebrew))
        {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let year = self.get_or(self.newer_field(Field::ExtendedYear, Field::Year), 1)?;
        self.internal_set(Field::ExtendedYear, year);
        if year > i32::MAX / 400 {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let month = match day_field {
            Field::Date => Some(self.get_or(Field::Month, 0)?),
            _ => None,
        };
        self.julian_day_of(year, month, self.internal_get(day_field))
    }
}
