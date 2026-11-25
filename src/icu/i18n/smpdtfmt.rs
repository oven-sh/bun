//! Formats a date with a pattern such as `EEEE, d MMMM y 'at' HH:mm`. ICU4C: smpdtfmt.cpp

use crate::common::bytes::U16s;
use crate::common::locid::Locale;
use crate::common::maps::Set;
use crate::common::memory::{self, Appendable, TryClone, get_or_try_init};
use crate::common::simpleformatter::SimpleFormatter;
use crate::common::sink::{TextBuf, US_STACKBUF_SIZE, WritableAlias};
use crate::common::slice_ext::{SliceExt, to_index, to_int32};
use crate::common::udata::searches_files;
use crate::common::uhash::hash_code;
use crate::common::uinvchar::invariant_prefix;
use crate::common::unicode::uloc::ULOC_KEYWORD_AND_VALUES_CAPACITY;
use crate::common::unicode::ures::{URES_ARRAY, URES_STRING};
use crate::common::unistr::UStr;
use crate::common::uresimp::*;
use crate::common::utf16::from_latin1;
use crate::common::utypes::*;
use crate::i18n::calendar::{Calendar, CalendarType, Field, SharedCalendar};
use crate::i18n::datefmt_numbers::DateNumberFormat;
use crate::i18n::dayperiodrules::{DayPeriod, DayPeriodRules};
use crate::i18n::dtfmtsym::{DateFormatSymbols, List, Name, Widths};
use crate::i18n::dtptngen::{DateTimePatternGenerator, UDATPG_MATCH_NO_OPTIONS};
use crate::i18n::fphdlimp::FieldPositionIteratorHandler;
use crate::i18n::gregoimp::UDate;
use crate::i18n::hebrwcal;
use crate::i18n::plurrule::PluralRules;
use crate::i18n::standardplural::PluralForm;
use crate::i18n::timezone::TimeZone;
use crate::i18n::tzfmt::{self, IsoStyle, TimeZoneFormat, ZoneStyle};
use crate::i18n::unicode::udat::*;
use bun_core::strings;
use std::sync::{Arc, OnceLock};

const QUOTE: u16 = b'\'' as u16;
/// 年
const HAN_YEAR_CHAR: u16 = 0x5e74;
const MAX_INT_COUNT: usize = 10;

// Indexes into `DateTimePatterns`, whose first four items are the time patterns.
const DATE_OFFSET: usize = 4;
pub(crate) const DATE_TIME: usize = 8;
const DATE_TIME_OFFSET: usize = 9;

/// The letters of fields. `l` is ignored, and all others are errors.
const PATTERN_CHARS: &[u8] = b"GyMdkHmsSEDFwWahKzYeugAZvcLQqVUOXxrbB";
const DEFAULT_PATTERN: [u16; 13] = from_latin1(b"yMMdd hh:mm a");
const JPANYEAR: &[u8] = b"numbers=jpanyear";

fn is_syntax_char(ch: u16) -> bool {
    matches!(ch, 0x41..=0x5a | 0x61..=0x7a)
}

pub(crate) enum PatternItem<'a> {
    /// An unquoted ASCII letter and its repeat count.
    Field(u8, usize),
    Literal(&'a [u16]),
}

pub(crate) struct PatternItems<'a> {
    pub(crate) rest: &'a [u16],
    in_quote: bool,
}

impl<'a> PatternItems<'a> {
    pub(crate) fn new(pattern: &'a [u16]) -> Self {
        Self {
            rest: pattern,
            in_quote: false,
        }
    }
}

impl<'a> Iterator for PatternItems<'a> {
    type Item = PatternItem<'a>;

    fn next(&mut self) -> Option<PatternItem<'a>> {
        loop {
            match *self.rest {
                [] => return None,
                [QUOTE, QUOTE, ref rest @ ..] => {
                    self.rest = rest;
                    return Some(PatternItem::Literal(&[QUOTE]));
                }
                [QUOTE, ref rest @ ..] => (self.rest, self.in_quote) = (rest, !self.in_quote),
                [letter, ..] if !self.in_quote && is_syntax_char(letter) => {
                    let count = self.rest.iter().take_while(|&&unit| unit == letter).count();
                    self.rest = self.rest.slice(count..);
                    return Some(PatternItem::Field(letter as u8, count));
                }
                _ => {
                    let is_text =
                        |&unit: &u16| unit != QUOTE && (self.in_quote || !is_syntax_char(unit));
                    let (text, rest) = self.rest.split_while(is_text);
                    self.rest = rest;
                    return Some(PatternItem::Literal(text));
                }
            }
        }
    }
}

pub(crate) struct SimpleDateFormat {
    /// Cloned for each call with a `UDate`. C can modify it through the pointer from `udat_getCalendar`.
    pub(crate) calendar: SharedCalendar,
    pub(crate) pattern: Vec<u16>,
    /// `pattern` is empty, because an allocation has failed while it was applied.
    pattern_is_lost: bool,
    /// Such a format only tells its pattern, because the data can name numbering systems for the fields of a style.
    is_from_styles: bool,
    locale: Locale,
    symbols: Arc<DateFormatSymbols>,
    number_format: DateNumberFormat,
    /// Writes 元 for the first year of a Japanese era.
    japanese_year_format: OnceLock<DateNumberFormat>,
    time_zone_format: OnceLock<Arc<TimeZoneFormat>>,
}

/// Reads an item of `DateTimePatterns`: a pattern, or an array of a pattern and numbering systems.
fn pattern_at(
    patterns: &UResourceBundle,
    index: usize,
) -> Result<(Vec<u16>, Option<U16s<'static>>), UErrorCode> {
    let item = patterns.get_by_index(index)?;
    // Index 0 of a string is the string itself.
    let pattern = ures_get_unicode_string_by_index(&item, 0);
    match item.get_type() {
        URES_STRING => Ok((pattern?, None)),
        URES_ARRAY => {
            let numbers = ures_get_string_by_index(&item, 1)?.unwrap_or_default();
            Ok((pattern?, Some(numbers)))
        }
        _ => Err(U_INVALID_FORMAT_ERROR),
    }
}

/// `keyword` is like "numbers=hebr". Ignores the script and the keywords of `locale`.
fn format_with_keyword(locale: &Locale, keyword: &[u8]) -> Result<DateNumberFormat, UErrorCode> {
    DateNumberFormat::for_field(&Locale::from_parts(
        locale.get_language(),
        locale.get_country(),
        locale.get_variant(),
        keyword,
    ))
}

/// `numbers` is like "y=jpanyear;d=hanidays" or "hebr". ICU4C: smpdtfmt.cpp, SimpleDateFormat::processOverrideString
#[cold]
fn check_numbering_systems(locale: &Locale, numbers: U16s) -> Result<(), UErrorCode> {
    const KEY: &[u8] = b"numbers=";
    // Names with the same hash code count as one.
    let mut checked = Set::default();
    for item in numbers.try_to_vec()?.split(|&unit| unit == u16::from(b';')) {
        let equals = item.index_of(&[b'='.into()]);
        let is_field = |letter| strings::contains_char(PATTERN_CHARS, letter);
        if equals.is_some() && !u8::try_from(item.at(0)).is_ok_and(is_field) {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        let name = item.slice(equals.map_or(0, |at| at + 1)..);
        if memory::try_set_insert(&mut checked, hash_code(name))? {
            // A name that is too long is ignored.
            let fits = KEY.len() + name.len() <= ULOC_KEYWORD_AND_VALUES_CAPACITY as usize;
            let name = invariant_prefix(name.iter().copied()).filter(|_| fits);
            format_with_keyword(
                locale,
                &memory::try_collect(KEY.iter().copied().chain(name))?,
            )?;
        }
    }
    Ok(())
}

/// Opens `calendar/<type>/<key>`, falling back to the Gregorian calendar.
fn calendar_resource(
    bundle: &UResourceBundle,
    calendar_type: CalendarType,
    key: &[u8],
) -> Result<UResourceBundle, UErrorCode> {
    let of_type = |calendar_type: CalendarType| {
        let path = memory::try_concat(&[b"calendar/", calendar_type.name().to_bytes(), b"/", key])?;
        bundle.get_by_key_with_fallback(&path)
    };
    match of_type(calendar_type) {
        Err(U_MISSING_RESOURCE_ERROR) if calendar_type != CalendarType::Gregorian => {
            of_type(CalendarType::Gregorian)
        }
        found => found,
    }
}

/// Reserves enough for `apply_pattern` not to allocate for a short pattern.
fn copy_pattern(pattern: &[u16]) -> Result<Vec<u16>, UErrorCode> {
    let mut copy = memory::try_with_capacity(pattern.len().max(US_STACKBUF_SIZE))?;
    copy.add_all(pattern);
    Ok(copy)
}

/// Returns `Some` if `bundle_locale` has another language or region, or `locale` has the keyword `rg` or `hours`.
fn time_pattern_from_generator(
    locale: &Locale,
    bundle_locale: &Locale,
    time_style: usize,
) -> Option<Vec<u16>> {
    let has_keyword = |name: &[u8]| {
        locale
            .get_keyword_value(name)
            .is_ok_and(|value| !value.is_empty())
    };
    let base = Locale::from_name(locale.get_base_name());
    let is_needed = has_keyword(b"rg")
        || has_keyword(b"hours")
        || (!base.get_country().is_empty() && base.get_country() != bundle_locale.get_country())
        || base.get_language() != bundle_locale.get_language();
    if !is_needed {
        return None;
    }
    let skeleton = b"jmmsszzzz".map(u16::from);
    let skeleton = skeleton.slice(..[9, 6, 5, 3].at(time_style));
    DateTimePatternGenerator::create_instance_no_std_pat(locale)
        .ok()?
        .get_best_pattern(skeleton, UDATPG_MATCH_NO_OPTIONS)
        .ok()
        .filter(|pattern| !pattern.is_empty())
}

impl TryClone for SimpleDateFormat {
    fn try_clone(&self) -> Result<Self, UErrorCode> {
        Ok(Self {
            calendar: self.calendar.clone(),
            pattern: copy_pattern(&self.pattern)?,
            locale: self.locale.clone(),
            symbols: Arc::clone(&self.symbols),
            number_format: self.number_format.for_another_user()?,
            japanese_year_format: self.japanese_year_format.clone(),
            time_zone_format: self.time_zone_format.clone(),
            ..*self
        })
    }
}

impl SimpleDateFormat {
    pub(crate) fn with_pattern(
        pattern: &[u16],
        locale: &Locale,
        zone: TimeZone,
    ) -> Result<Self, UErrorCode> {
        let calendar = Calendar::for_locale(Some(zone), locale)?;
        let calendar_type = calendar.calendar_type();
        let format = Self {
            symbols: DateFormatSymbols::shared(locale, calendar_type)?,
            number_format: DateNumberFormat::for_locale(locale)?,
            calendar: calendar.into(),
            pattern: copy_pattern(pattern)?,
            pattern_is_lost: false,
            is_from_styles: false,
            locale: locale.clone(),
            japanese_year_format: OnceLock::new(),
            time_zone_format: OnceLock::new(),
        };
        // Loaded now, so that clones share it.
        format.year_format(calendar_type, pattern);
        Ok(format)
    }

    /// A style is a number from `UDAT_FULL` to `UDAT_SHORT`. At least one is `Some`.
    pub(crate) fn with_styles(
        time_style: Option<usize>,
        date_style: Option<usize>,
        locale: &Locale,
        zone: TimeZone,
    ) -> Result<Self, UErrorCode> {
        let mut format = Self::with_pattern(&[], locale, zone)?;
        format.is_from_styles = true;
        format.pattern = format
            .pattern_of_styles(time_style, date_style)
            .or_else(|_| memory::try_to_vec(&DEFAULT_PATTERN))?;
        Ok(format)
    }

    // ICU4C: smpdtfmt.cpp, SimpleDateFormat::construct
    fn pattern_of_styles(
        &self,
        time_style: Option<usize>,
        date_style: Option<usize>,
    ) -> Result<Vec<u16>, UErrorCode> {
        let (locale, calendar_type) = (&self.locale, self.calendar.calendar_type());
        let bundle = ures_open(None, locale.get_base_name())?;
        let patterns = calendar_resource(&bundle, calendar_type, b"DateTimePatterns")?;
        if patterns.get_size() <= DATE_TIME {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        let time = time_style.map(|style| {
            let bundle_locale = Locale::from_name(patterns.get_valid_locale().to_bytes());
            time_pattern_from_generator(locale, &bundle_locale, style)
                .map_or_else(|| pattern_at(&patterns, style), |time| Ok((time, None)))
        });
        let date = date_style.map(|style| (style, pattern_at(&patterns, DATE_OFFSET + style)));
        let ((pattern, numbers), time_numbers) = match (time, date) {
            (None, None) => return Err(U_INVALID_FORMAT_ERROR),
            (Some(only), None) | (None, Some((_, only))) => (only?, None),
            (Some(time), Some((style, date))) => {
                let ((time, time_numbers), (date, date_numbers)) = (time?, date?);
                let joining =
                    match calendar_resource(&bundle, calendar_type, b"DateTimePatterns%atTime") {
                        Ok(at_time) if at_time.get_size() >= 4 => {
                            ures_get_unicode_string_by_index(&at_time, style)
                        }
                        _ if patterns.get_size() >= DATE_TIME_OFFSET + 4 => {
                            ures_get_unicode_string_by_index(&patterns, DATE_TIME_OFFSET + style)
                        }
                        _ => ures_get_unicode_string_by_index(&patterns, DATE_TIME),
                    }?;
                let joining = SimpleFormatter::with_pattern_min_max_arguments(&joining, 2, 2)?;
                let joined = joining.format_to_vec(&[&time, &date]);
                ((joined, date_numbers), time_numbers)
            }
        };
        if searches_files()? {
            if numbers.is_none() && self.wants_japanese_year(calendar_type, &pattern) {
                format_with_keyword(locale, JPANYEAR)?;
            }
            for numbers in numbers.into_iter().chain(time_numbers) {
                check_numbering_systems(locale, numbers)?;
            }
        }
        Ok(pattern)
    }

    /// Returns `None` if the pattern is lost.
    pub(crate) fn to_pattern(&self) -> Option<&[u16]> {
        (!self.pattern_is_lost).then_some(&self.pattern)
    }

    pub(crate) fn apply_pattern(&mut self, pattern: &[u16]) {
        self.pattern.assign(pattern);
        self.pattern_is_lost = memory::is_oom();
        if self.pattern_is_lost {
            self.pattern.clear();
        }
    }

    #[inline]
    fn wants_japanese_year(&self, calendar_type: CalendarType, pattern: &[u16]) -> bool {
        calendar_type == CalendarType::Japanese
            && self.locale.get_language() == b"ja"
            && pattern.contains(&HAN_YEAR_CHAR)
    }

    fn year_format(&self, calendar_type: CalendarType, pattern: &[u16]) -> &DateNumberFormat {
        let make = || format_with_keyword(&self.locale, JPANYEAR);
        if self.wants_japanese_year(calendar_type, pattern)
            && let Ok(numbers) = get_or_try_init(&self.japanese_year_format, make)
        {
            return numbers;
        }
        &self.number_format
    }

    fn time_zone_format(&self) -> Result<&TimeZoneFormat, UErrorCode> {
        let make = || memory::try_shared_result(&mut TimeZoneFormat::create_instance(&self.locale));
        get_or_try_init(&self.time_zone_format, make).map(|format| &**format)
    }

    pub(crate) fn check_supports(&self, date: UDate) -> Result<(), UErrorCode> {
        if self.is_from_styles || date.is_nan() {
            return Err(U_UNSUPPORTED_ERROR);
        }
        Ok(())
    }

    /// After a failure `append_to` has the text up to the field that failed, and one more unit.
    pub(crate) fn format(
        &self,
        date: UDate,
        append_to: &mut dyn TextBuf,
        handler: Option<&mut FieldPositionIteratorHandler>,
    ) -> Result<(), UErrorCode> {
        let mut calendar = Calendar::clone(&self.calendar);
        let completed = calendar.set_time(date).and_then(|()| calendar.complete());
        let calendar = completed.map(|()| &calendar);
        self.format_with_pattern(&self.pattern, calendar, append_to, handler)
    }

    /// `calendar` has the type of `self.calendar` and computed fields, or is the error from computing them.
    pub(crate) fn format_with_pattern(
        &self,
        pattern: &[u16],
        calendar: Result<&Calendar, UErrorCode>,
        append_to: &mut dyn TextBuf,
        mut handler: Option<&mut FieldPositionIteratorHandler>,
    ) -> Result<(), UErrorCode> {
        let mut writer = Writer {
            format: self,
            pattern,
            text: append_to,
        };
        let mut items = PatternItems::new(pattern);
        while let Some(item) = items.next() {
            let (letter, count) = match item {
                PatternItem::Literal(text @ ([_] | [_, _])) => {
                    text.iter().for_each(|&unit| writer.text.add(unit));
                    continue;
                }
                PatternItem::Literal(text) => {
                    writer.text.add_all(text);
                    continue;
                }
                PatternItem::Field(letter, count) => (letter, count),
            };
            let begin = writer.text.len();
            let written = writer.field(letter, count, calendar).and_then(|written| {
                if let Some(handler) = &mut handler {
                    handler.add_attribute(written.0, to_int32(begin), to_int32(writer.text.len()));
                }
                written.1
            });
            if written.is_err() {
                match *items.rest {
                    [QUOTE, QUOTE, ..] => writer.text.add(QUOTE),
                    [unit, ..] if unit != QUOTE && !is_syntax_char(unit) => writer.text.add(unit),
                    _ => {}
                }
                return written;
            }
        }
        Ok(())
    }
}

type Written = Result<(), UErrorCode>;

struct Writer<'a> {
    format: &'a SimpleDateFormat,
    pattern: &'a [u16],
    text: &'a mut dyn TextBuf,
}

impl Writer<'_> {
    /// The position of the field is recorded after an inner error. ICU4C: smpdtfmt.cpp, SimpleDateFormat::subFormat
    fn field(
        &mut self,
        letter: u8,
        count: usize,
        cal: Result<&Calendar, UErrorCode>,
    ) -> Result<(UDateFormatField, Written), UErrorCode> {
        let symbols = &*self.format.symbols;
        let Ok(cal) = cal else {
            return self.rare_field(letter, count, cal);
        };
        let get = |field| cal.internal_get(field);
        let or_if_0 = |hour, last| if hour == 0 { last } else { hour };
        let is_chinese = matches!(
            cal.calendar_type(),
            CalendarType::Chinese | CalendarType::Dangi
        );
        let (field, number) = match (letter, count) {
            (b'G', _) if is_chinese => {
                let numbers = &self.format.number_format;
                let written = numbers.format(self.text, get(Field::Era), 1, 9);
                return Ok((UDAT_ERA_FIELD, written));
            }
            (b'G', _) => {
                let written = self.name(&symbols.eras, count, get(Field::Era));
                return Ok((UDAT_ERA_FIELD, written));
            }
            (b'y', _) => {
                let numbers = self.format.year_format(cal.calendar_type(), self.pattern);
                let written = self.year(numbers, count, get(Field::Year));
                return Ok((UDAT_YEAR_FIELD, written));
            }
            (b'Y', _) => {
                let written = self.year(&self.format.number_format, count, get(Field::YearWoy));
                return Ok((UDAT_YEAR_WOY_FIELD, written));
            }
            (b'U', _) => {
                let written = self.year_name(count, get(Field::Year));
                return Ok((UDAT_YEAR_NAME_FIELD, written));
            }
            (b'M', _) => return Ok((UDAT_MONTH_FIELD, self.month(false, count, cal))),
            (b'L', _) => return Ok((UDAT_STANDALONE_MONTH_FIELD, self.month(true, count, cal))),
            (b'E', ..=5) => {
                let written = self.name(&symbols.weekdays.format, count, get(Field::DayOfWeek) - 1);
                return Ok((UDAT_DAY_OF_WEEK_FIELD, written));
            }
            (b'c', 3..=5) => {
                let names = &symbols.weekdays.standalone;
                let written = self.name(names, count, get(Field::DayOfWeek) - 1);
                return Ok((UDAT_STANDALONE_DAY_FIELD, written));
            }
            (b'a', _) => {
                let written = self.name(&symbols.am_pm, count, get(Field::AmPm));
                return Ok((UDAT_AM_PM_FIELD, written));
            }
            (b'B', _) => {
                let written = self.flexible_day_period(count, Ok(cal));
                return Ok((UDAT_FLEXIBLE_DAY_PERIOD_FIELD, written));
            }
            (b'z', _) => {
                let written = self.zone(ZoneStyle::Specific, count, cal);
                return Ok((UDAT_TIMEZONE_FIELD, written));
            }
            (b'v', 1 | 4) => {
                let written = self.zone(ZoneStyle::Generic, count, cal);
                return Ok((UDAT_TIMEZONE_GENERIC_FIELD, written));
            }
            (b'O', 1 | 4) => {
                let written = self.zone(ZoneStyle::LocalizedGmt, count, cal);
                return Ok((UDAT_TIMEZONE_LOCALIZED_GMT_OFFSET_FIELD, written));
            }
            (b'r', _) if is_chinese => (UDAT_RELATED_YEAR_FIELD, get(Field::ExtendedYear)),
            (b'd', ..=2) => (UDAT_DATE_FIELD, get(Field::Date)),
            (b'H', _) => (UDAT_HOUR_OF_DAY0_FIELD, get(Field::HourOfDay)),
            (b'k', _) => (UDAT_HOUR_OF_DAY1_FIELD, or_if_0(get(Field::HourOfDay), 24)),
            (b'K', _) => (UDAT_HOUR0_FIELD, get(Field::Hour)),
            (b'h', _) => (UDAT_HOUR1_FIELD, or_if_0(get(Field::Hour), 12)),
            (b'm', _) => (UDAT_MINUTE_FIELD, get(Field::Minute)),
            (b's', _) => (UDAT_SECOND_FIELD, get(Field::Second)),
            (b'S', 1) => (UDAT_FRACTIONAL_SECOND_FIELD, get(Field::Millisecond) / 100),
            (b'S', 2) => (UDAT_FRACTIONAL_SECOND_FIELD, get(Field::Millisecond) / 10),
            (b'S', 3) => (UDAT_FRACTIONAL_SECOND_FIELD, get(Field::Millisecond)),
            _ => return self.rare_field(letter, count, Ok(cal)),
        };
        let numbers = &self.format.number_format;
        let written = numbers.format(self.text, number, count, MAX_INT_COUNT);
        Ok((field, written))
    }

    /// Writes the fields that no linked pattern has, and those that do without the calendar if it has failed.
    #[cold]
    fn rare_field(
        &mut self,
        letter: u8,
        count: usize,
        cal: Result<&Calendar, UErrorCode>,
    ) -> Result<(UDateFormatField, Written), UErrorCode> {
        match letter {
            // An empty field has no position.
            b'l' => return Ok((UDAT_MONTH_FIELD, Ok(()))),
            b'b' => {
                let written = self.day_period(None, count, cal);
                return Ok((UDAT_AM_PM_MIDNIGHT_NOON_FIELD, written));
            }
            b'B' => {
                let written = self.flexible_day_period(count, cal);
                return Ok((UDAT_FLEXIBLE_DAY_PERIOD_FIELD, written));
            }
            _ => {}
        }
        let (cal, symbols, numbers) = (cal?, &*self.format.symbols, &self.format.number_format);
        let get = |field| cal.internal_get(field);
        let field = match letter {
            b'd' => UDAT_DATE_FIELD,
            b'S' => UDAT_FRACTIONAL_SECOND_FIELD,
            b'E' => UDAT_DAY_OF_WEEK_FIELD,
            b'D' => UDAT_DAY_OF_YEAR_FIELD,
            b'F' => UDAT_DAY_OF_WEEK_IN_MONTH_FIELD,
            b'w' => UDAT_WEEK_OF_YEAR_FIELD,
            b'W' => UDAT_WEEK_OF_MONTH_FIELD,
            b'e' => UDAT_DOW_LOCAL_FIELD,
            b'u' => UDAT_EXTENDED_YEAR_FIELD,
            b'g' => UDAT_JULIAN_DAY_FIELD,
            b'A' => UDAT_MILLISECONDS_IN_DAY_FIELD,
            b'Z' => UDAT_TIMEZONE_RFC_FIELD,
            b'v' => UDAT_TIMEZONE_GENERIC_FIELD,
            b'c' => UDAT_STANDALONE_DAY_FIELD,
            b'Q' => UDAT_QUARTER_FIELD,
            b'q' => UDAT_STANDALONE_QUARTER_FIELD,
            b'V' => UDAT_TIMEZONE_SPECIAL_FIELD,
            b'O' => UDAT_TIMEZONE_LOCALIZED_GMT_OFFSET_FIELD,
            b'X' => UDAT_TIMEZONE_ISO_FIELD,
            b'x' => UDAT_TIMEZONE_ISO_LOCAL_FIELD,
            b'r' => UDAT_RELATED_YEAR_FIELD,
            _ => return Err(U_INVALID_FORMAT_ERROR),
        };
        let (number, min_digits) = match (letter, count) {
            (b'd', _) if get(Field::Date) > 0 => {
                return Ok((field, self.day_of_month(get(Field::Date))));
            }
            (b'd', _) => (get(Field::Date), count),
            (b'S', _) => {
                let written = numbers
                    .format(self.text, get(Field::Millisecond), 3, MAX_INT_COUNT)
                    .and_then(|()| numbers.format(self.text, 0, count - 3, MAX_INT_COUNT));
                return Ok((field, written));
            }
            (b'c', ..3) => (cal.local_day_of_week(), 1),
            (b'e', ..3) => (cal.local_day_of_week(), count),
            (b'E' | b'c' | b'e', _) => {
                let names = match count {
                    6 => symbols.short_weekdays.get(letter == b'c'),
                    _ => of_width(symbols.weekdays.get(letter == b'c'), count),
                };
                return Ok((field, self.name_in(*names, get(Field::DayOfWeek) - 1)));
            }
            (b'Q' | b'q', ..3) => (get(Field::Month) / 3 + 1, count),
            (b'Q' | b'q', _) => {
                let names = symbols.quarters.get(letter == b'q');
                return Ok((field, self.name(names, count.min(5), get(Field::Month) / 3)));
            }
            (b'D', _) => (get(Field::DayOfYear), count),
            (b'F', _) => (get(Field::Date).wrapping_sub(1) / 7 + 1, count),
            (b'w', _) => (get(Field::WeekOfYear), count),
            (b'W', _) => (cal.week_number(get(Field::Date)), count),
            (b'u', _) => (get(Field::ExtendedYear), count),
            (b'g', _) => (get(Field::JulianDay), count),
            (b'A', _) => (cal.millis_in_day(), count),
            (b'r', _) => (cal.related_year()?, count),
            _ => return Ok((field, self.rare_zone(letter, count, cal))),
        };
        let written = numbers.format(self.text, number, min_digits, MAX_INT_COUNT);
        Ok((field, written))
    }

    fn name(&mut self, names: &Widths<List>, count: usize, index: i32) -> Written {
        self.name_in(*of_width(names, count), index)
    }

    #[inline]
    fn name_in(&mut self, names: List, index: i32) -> Written {
        let name = self.format.symbols.name_in(names, to_index(index));
        self.text.add_all(name.unwrap_or_default());
        Ok(())
    }

    fn year(&mut self, numbers: &DateNumberFormat, count: usize, year: i32) -> Written {
        let max_digits = if count == 2 { 2 } else { MAX_INT_COUNT };
        numbers.format(self.text, year, count, max_digits)
    }

    fn year_name(&mut self, count: usize, year: i32) -> Written {
        let names = self.format.symbols.year_names;
        if names.exists() && year <= to_int32(names.len()) {
            self.name_in(names, year.wrapping_sub(1))
        } else {
            self.year(&self.format.number_format, count, year)
        }
    }

    fn month(&mut self, is_standalone: bool, count: usize, cal: &Calendar) -> Written {
        let mut month = cal.internal_get(Field::Month);
        if cal.calendar_type() == CalendarType::Hebrew {
            match (
                hebrwcal::is_leap_year(cal.internal_get(Field::Year)),
                count,
                month,
            ) {
                // Adar II
                (true, 3.., 6) => month = 13,
                (false, ..3, 6..) => month -= 1,
                _ => {}
            }
        }
        let symbols = &*self.format.symbols;
        let leap = symbols
            .leap_month_patterns
            .as_ref()
            .filter(|_| cal.internal_get(Field::IsLeapMonth) != 0);
        if !(3..=5).contains(&count) {
            let mut buffer = [0; 16];
            let mut number = WritableAlias::new(&mut buffer, 0);
            let numbers = &self.format.number_format;
            numbers.format(&mut number, month.wrapping_add(1), count, MAX_INT_COUNT)?;
            return self.append_month(number.as_slice(), leap.map(|leap| leap.numeric));
        }
        let names = *of_width(symbols.months.get(is_standalone), count);
        let pattern = leap.map(|leap| *of_width(leap.names.get(is_standalone), count));
        symbols
            .name_in(names, to_index(month))
            .map_or(Ok(()), |name| self.append_month(name, pattern))
    }

    fn append_month(&mut self, month: &[u16], leap_month_pattern: Option<Name>) -> Written {
        let Some(pattern) =
            leap_month_pattern.and_then(|pattern| self.format.symbols.name(pattern))
        else {
            self.text.add_all(month);
            return Ok(());
        };
        SimpleFormatter::with_pattern_min_max_arguments(pattern, 1, 1)?.format(&[month], self.text);
        Ok(())
    }

    fn zone(&mut self, style: ZoneStyle, count: usize, cal: &Calendar) -> Written {
        let (zone, time, mut name) = (cal.time_zone()?, cal.internal_get_time(), Vec::new());
        self.format
            .time_zone_format()?
            .format(style, count >= 4, zone, time, &mut name);
        self.text.add_all(&name);
        Ok(())
    }

    /// Some counts of letters write nothing.
    fn rare_zone(&mut self, letter: u8, count: usize, cal: &Calendar) -> Written {
        let format = self.format.time_zone_format()?;
        let (zone, time, mut name) = (cal.time_zone()?, cal.internal_get_time(), Vec::new());
        let iso = |has_z_for_zero, count| IsoStyle {
            has_colons: matches!(count, 3 | 5),
            has_z_for_zero,
            omits_zero_minutes: count == 1,
            ignores_seconds: count <= 3,
        };
        match (letter, count) {
            (b'Z', ..=3) => tzfmt::format_iso_offset(iso(false, 4), zone, time, &mut name),
            (b'Z', 5) => tzfmt::format_iso_offset(iso(true, 5), zone, time, &mut name),
            (b'Z', _) => format.format(ZoneStyle::LocalizedGmt, true, zone, time, &mut name),
            (b'V', 1) => tzfmt::format_short_id(zone, &mut name),
            (b'V', 2) => zone.append_id(&mut name),
            (b'V', 3) => format.format_exemplar_location(zone, &mut name),
            (b'V', 4) => format.format(ZoneStyle::GenericLocation, true, zone, time, &mut name),
            (b'X' | b'x', ..=5) => {
                tzfmt::format_iso_offset(iso(letter == b'X', count), zone, time, &mut name);
            }
            _ => {}
        }
        self.text.add_all(&name);
        Ok(())
    }

    /// Writes the name of the day, else its ordinal number, else its number.
    fn day_of_month(&mut self, day: i32) -> Written {
        let symbols = &*self.format.symbols;
        let names = &symbols.day_of_month_names;
        let non_empty = |list, index| symbols.name_in(list, index).filter(|it| !it.is_empty());
        if let Some(name) = non_empty(names.cardinal, to_index(day)) {
            self.text.add_all(name);
            return Ok(());
        }
        let rules = PluralRules::ordinal_without_ranges(&self.format.locale).ok();
        let pattern = rules.and_then(|rules| {
            [rules.select_double(day.into()), PluralForm::Other]
                .into_iter()
                .find_map(|form| non_empty(names.ordinal, form.index()))
        });
        let (mut number, mut ordinal) = (Vec::new(), Vec::new());
        let numbers = &self.format.number_format;
        let mut written = numbers.format(&mut number, day, 1, MAX_INT_COUNT);
        if let Some(pattern) = pattern {
            written = written
                .and_then(|()| SimpleFormatter::with_pattern_min_max_arguments(pattern, 0, 1))
                .map(|formatter| formatter.format(&[&number], &mut ordinal));
        }
        self.text.add_all(if ordinal.is_empty() {
            &number
        } else {
            &ordinal
        });
        written
    }

    fn has_field(&self, letter: u8) -> bool {
        self.pattern
            .split(|&unit| unit == QUOTE)
            .step_by(2)
            .any(|unquoted| unquoted.contains(&letter.into()))
    }

    #[inline(always)]
    fn flexible_day_period(&mut self, count: usize, cal: Result<&Calendar, UErrorCode>) -> Written {
        match DayPeriodRules::get_instance(self.format.locale.get_base_name())? {
            None => self.am_pm(count, cal),
            rules => self.day_period(rules, count, cal),
        }
    }

    /// Without rules there is only noon. Falls back to AM and PM. The hour is 0 if the calendar has failed.
    #[inline(always)]
    fn day_period(
        &mut self,
        rules: Option<&DayPeriodRules>,
        count: usize,
        cal: Result<&Calendar, UErrorCode>,
    ) -> Written {
        let symbols = &*self.format.symbols;
        let get = |field| cal.map_or(0, |cal| cal.internal_get(field));
        let hour = get(Field::HourOfDay);
        let is_noon = hour == 12
            && rules.is_none_or(DayPeriodRules::has_noon)
            && (get(Field::Minute) == 0 || !self.has_field(b'm'))
            && (get(Field::Second) == 0 || !self.has_field(b's'));
        // AM and PM are out of bounds of `names`.
        let names = of_width(&symbols.day_periods, if count > 5 { 4 } else { count });
        let name_of = |DayPeriod(index)| symbols.name(*names.get(usize::from(index))?);
        let noon = is_noon.then_some(DayPeriod::NOON).and_then(name_of);
        match noon.or_else(|| rules?.day_period_for_hour(hour).and_then(name_of)) {
            Some(name) => {
                self.text.add_all(name);
                cal.map(drop)
            }
            None => self.am_pm(count, cal),
        }
    }

    fn am_pm(&mut self, count: usize, cal: Result<&Calendar, UErrorCode>) -> Written {
        let names = &self.format.symbols.am_pm;
        self.name(names, count, cal?.internal_get(Field::AmPm))
    }
}

fn of_width<T>(widths: &Widths<T>, count: usize) -> &T {
    match count {
        4 => &widths.wide,
        5 => &widths.narrow,
        _ => &widths.abbreviated,
    }
}
