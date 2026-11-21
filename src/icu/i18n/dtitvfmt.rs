//! Formats two dates as an interval: "Jan 3 – 5, 2026". ICU4C: dtitvfmt.cpp

use crate::common::bytes::U16s;
use crate::common::locid::Locale;
use crate::common::memory::{self, Appendable, try_collect, try_concat, try_to_vec};
use crate::common::simpleformatter::{PatternParts, SimpleFormatter};
use crate::common::slice_ext::SliceExt;
use crate::common::unistr::UString;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::calendar::{Calendar, Field};
use crate::i18n::dtitvinf::{DateIntervalInfo, FieldWidths, IntervalField, SkeletonDifference};
use crate::i18n::dtptngen::{DateTimePatternGenerator, UDATPG_MATCH_NO_OPTIONS, get_skeleton};
use crate::i18n::formattedval_iterimpl::FormattedDateInterval;
use crate::i18n::fphdlimp::FieldPositionIteratorHandler;
use crate::i18n::gregoimp::UDate;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::smpdtfmt::{PatternItem, PatternItems, SimpleDateFormat};
use crate::i18n::timezone::TimeZone;
use crate::i18n::unicode::uformattedvalue::UFIELD_CATEGORY_DATE;
use std::borrow::Cow;
use std::cell::OnceCell;
use std::iter::repeat_n;

const QUOTE: u16 = b'\'' as u16;

/// The date fields and their skeleton letters, from the smallest field to the largest.
const DATE_FIELDS: [(IntervalField, u8); 4] = [
    (IntervalField::Date, b'd'),
    (IntervalField::Month, b'M'),
    (IntervalField::Year, b'y'),
    (IntervalField::Era, b'G'),
];

fn u8_or_zero(unit: u16) -> u8 {
    u8::try_from(unit).unwrap_or(0)
}

fn contains(text: &[u16], letter: u8) -> bool {
    text.contains(&u16::from(letter))
}

/// Yields the letter, the width and the end index of each field of `pattern`.
fn pattern_fields(pattern: &[u16]) -> impl Iterator<Item = (u8, usize, usize)> {
    let mut items = PatternItems::new(pattern);
    std::iter::from_fn(move || {
        loop {
            if let PatternItem::Field(letter, count) = items.next()? {
                return Some((letter, count, pattern.len() - items.rest.len()));
            }
        }
    })
}

/// Returns whether `pattern` displays neither `field` nor a smaller unit. A zone counts as an era, `B` as nothing.
fn is_field_unit_ignored(pattern: &[u16], field: IntervalField) -> bool {
    !pattern_fields(pattern).any(|(letter, ..)| {
        let unit = match letter {
            b'G' | b'O' | b'v' | b'z' => IntervalField::Era,
            b'U' | b'Y' | b'r' | b'y' => IntervalField::Year,
            b'L' | b'M' => IntervalField::Month,
            b'E' | b'c' | b'd' => IntervalField::Date,
            b'a' => IntervalField::AmPm,
            b'H' | b'K' | b'h' | b'k' => IntervalField::Hour,
            b'm' => IntervalField::Minute,
            b's' => IntervalField::Second,
            b'S' => IntervalField::Millisecond,
            _ => return false,
        };
        field as u8 <= unit as u8
    })
}

/// Finds the best patterns of a locale during one call.
struct BestPatterns<'a> {
    locale: &'a Locale,
    generator: OnceCell<Result<DateTimePatternGenerator, UErrorCode>>,
}

impl BestPatterns<'_> {
    fn get(&self, skeleton: &[u16]) -> Result<Vec<u16>, UErrorCode> {
        static PATTERNS: LocaleCache<Vec<u16>> = LocaleCache::new();
        if self.locale.is_bogus() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let skeleton = get_skeleton(skeleton)?;
        let name = self.locale.get_name().iter().copied();
        let key = try_collect(
            name.chain([0])
                .chain(skeleton.iter().flat_map(|unit| unit.to_le_bytes())),
        )?;
        let pattern = PATTERNS.get_or_create(&key, || {
            self.generator
                .get_or_init(|| DateTimePatternGenerator::create_instance(self.locale))
                .as_ref()
                .map_err(|&code| code)?
                .get_best_pattern(&skeleton, UDATPG_MATCH_NO_OPTIONS)
        })?;
        try_to_vec(&pattern)
    }
}

/// Maps a pattern letter to the skeleton letter that has its width: `L` to `M`.
fn skeleton_letter(letter: u8) -> u8 {
    if letter == b'L' { b'M' } else { letter }
}

/// The date and time letters of a skeleton, as given and normalized for the lookup in `intervalFormats`.
#[derive(Default)]
struct SkeletonParts {
    date: Vec<u16>,
    normalized_date: Vec<u16>,
    time: Vec<u16>,
    normalized_time: Vec<u16>,
}

impl SkeletonParts {
    /// Drops `O`. ICU4C: dtitvfmt.cpp, DateIntervalFormat::getDateTimeSkeleton
    fn of(skeleton: &[u16]) -> Result<Self, UErrorCode> {
        let mut parts = Self::default();
        let mut hour = None;
        for &letter in skeleton {
            match u8_or_zero(letter) {
                b'E' | b'd' | b'M' | b'y' => parts.date.add(letter),
                b'G' | b'Y' | b'L' | b'c' | b'U' | b'r' => {
                    parts.normalized_date.add(letter);
                    parts.date.add(letter);
                }
                b'h' | b'H' | b'k' | b'K' => {
                    parts.time.add(letter);
                    hour.get_or_insert(letter);
                }
                b'm' | b'z' | b'v' => parts.time.add(letter),
                b'a' | b's' | b'S' | b'B' => {
                    parts.time.add(letter);
                    parts.normalized_time.add(letter);
                }
                b'O' => {}
                _ => return Err(U_UNSUPPORTED_ERROR),
            }
        }

        let widths = FieldWidths::of(&parts.date);
        let [years, months, weekdays, days] = b"yMEd".map(|letter| widths.get(letter));
        for (letter, width) in [
            (b'y', years),
            (b'M', months.min(if months < 3 { 1 } else { 5 })),
            (b'E', weekdays.min(if weekdays <= 3 { 1 } else { 5 })),
            (b'd', days.min(1)),
        ] {
            parts
                .normalized_date
                .add_each(repeat_n(u16::from(letter), width as usize));
        }
        parts.normalized_time.add_each(hour);
        parts.normalized_time.add_each(
            b"mzv"
                .map(u16::from)
                .into_iter()
                .filter(|letter| parts.time.contains(letter)),
        );
        Ok(parts)
    }
}

/// The pattern for two dates whose largest difference is in one field.
#[derive(Default)]
enum IntervalPattern {
    /// Both dates are formatted with the single-date pattern.
    #[default]
    None,
    /// Both dates are formatted with this pattern.
    Fallback(Vec<u16>),
    /// `pattern[..split]` is for the first date, the rest, which may be empty, for the second.
    Parts { pattern: Vec<u16>, split: usize },
}

impl IntervalPattern {
    fn parts(pattern: Vec<u16>) -> Self {
        if pattern.is_empty() {
            return Self::None;
        }
        Self::Parts {
            split: split_pattern_into_2_part(&pattern),
            pattern,
        }
    }
}

/// Returns the length of the first part. `L` counts as `M` unless the second part then repeats a field.
fn split_pattern_into_2_part(pattern: &[u16]) -> usize {
    let split = first_repeated_field(pattern, b'M');
    let second = pattern.slice(split..);
    if first_repeated_field(second, b'M') == second.len() {
        split
    } else {
        first_repeated_field(pattern, b'L')
    }
}

/// Returns the start of the first field whose letter is repeated, or `pattern.len()`. `L` counts as `month`.
fn first_repeated_field(pattern: &[u16], month: u8) -> usize {
    let mut seen = 0u64;
    for (letter, count, end) in pattern_fields(pattern) {
        let bit = 1 << (if letter == b'L' { month } else { letter } & 63);
        if seen & bit != 0 {
            return end - count;
        }
        seen |= bit;
    }
    pattern.len()
}

fn replace_outside_quotes(pattern: &mut [u16], from: u8, to: u8) {
    pattern
        .split_mut(|&unit| unit == QUOTE)
        .step_by(2)
        .flatten()
        .filter(|unit| **unit == u16::from(from))
        .for_each(|unit| *unit = to.into());
}

/// Adapts a pattern for `best_skeleton` to `skeleton`: restores z, K and k, and widens fields.
fn adjust_field_width(
    skeleton: &[u16],
    best_skeleton: &[u16],
    pattern: U16s,
) -> Result<Vec<u16>, UErrorCode> {
    let pattern = &mut pattern.try_to_vec()?;
    for (letter, substitute) in [(b'z', b'v'), (b'K', b'h'), (b'k', b'H')] {
        if contains(skeleton, letter) {
            replace_outside_quotes(pattern, substitute, letter);
        }
    }

    let (widths, mut best_widths) = (FieldWidths::of(skeleton), FieldWidths::of(best_skeleton));
    // `best_skeleton` never contains `a`, but its patterns may.
    best_widths.set(b'a', 1);
    let (mut adjusted, mut copied) = (memory::try_with_capacity(pattern.len())?, 0);
    for (letter, count, end) in pattern_fields(pattern) {
        let (width, best_width) = (
            widths.get(skeleton_letter(letter)),
            best_widths.get(skeleton_letter(letter)),
        );
        if best_width as usize == count && width > best_width {
            adjusted.add_all(pattern.slice(copied..end));
            adjusted.add_each(repeat_n(u16::from(letter), (width - best_width) as usize));
            copied = end;
        }
    }
    adjusted.add_all(pattern.slice(copied..));
    Ok(adjusted)
}

/// Replaces the day period and the hour, which follows it, with the locale's hour letter and a day period for h and K.
fn normalize_hour<'a>(
    skeleton: &'a [u16],
    best: &BestPatterns,
) -> Result<Cow<'a, [u16]>, UErrorCode> {
    let is_hour = |&unit: &u16| matches!(u8_or_zero(unit), b'h' | b'H' | b'k' | b'K');
    let is_day_period = |&unit: &u16| matches!(u8_or_zero(unit), b'a' | b'B');
    let (before, rest) = skeleton.split_while(|unit| !is_hour(unit) && !is_day_period(unit));
    let (day_period, rest) = rest.split_while(is_day_period);
    let (hour, after) = rest.split_while(is_hour);
    let Some(&requested) = hour.first() else {
        return Ok(Cow::Borrowed(skeleton));
    };

    let converted = best.get(&[requested])?;
    let is_shown = |&wanted: &u8| pattern_fields(&converted).any(|(letter, ..)| letter == wanted);
    let hour_letter = b"hKk".iter().copied().find(is_shown).unwrap_or(b'H');
    let day_period_letter = match day_period {
        _ if is_shown(&b'B') => b'B',
        &[letter, ..] => letter as u8,
        [] => b'a',
    };
    let length = match (hour_letter, day_period.len().max(hour.len())) {
        (b'H' | b'k', _) => 1,
        (_, 5..) => 6,
        (_, 3..) => 4,
        _ => 2,
    };
    let mut hour_and_day_period = [u16::from(day_period_letter); 6];
    hour_and_day_period[0] = u16::from(hour_letter);
    try_concat(&[before, hour_and_day_period.slice(..length), after]).map(Cow::Owned)
}

/// Loads the Gregorian pattern that combines a date and a time.
fn load_date_time_format(locale: &Locale) -> Result<Vec<u16>, UErrorCode> {
    const DATE_TIME: usize = 8;
    ures_open(None, locale.get_base_name())
        .and_then(|found| found.get_by_key(b"calendar"))
        .and_then(|found| found.get_by_key_with_fallback(b"gregorian"))
        .and_then(|found| found.get_by_key_with_fallback(b"DateTimePatterns"))
        .and_then(|found| ures_get_unicode_string_by_index(&found, DATE_TIME))
}

/// The fallback patterns for two times on the same day: a single date and a time range.
struct DatePlusTimeRange {
    date_pattern: Vec<u16>,
    time_pattern: Vec<u16>,
    date_time_format: PatternParts,
}

#[derive(Default)]
struct IntervalPatterns {
    by_field: [IntervalPattern; IntervalField::ALL.len()],
    date_plus_time_range: Option<DatePlusTimeRange>,
}

struct IntervalPatternsBuilder<'a> {
    info: &'a DateIntervalInfo,
    best: &'a BestPatterns<'a>,
    skeleton: &'a [u16],
    patterns: IntervalPatterns,
}

impl IntervalPatternsBuilder<'_> {
    // ICU4C: dtitvfmt.cpp, DateIntervalFormat::initializePattern
    fn initialize(&mut self) -> Result<(), UErrorCode> {
        let best = self.best;
        let mut parts = SkeletonParts::of(&normalize_hour(self.skeleton, best)?)?;
        let found =
            self.set_separate_date_time_patterns(&parts.normalized_date, &parts.normalized_time)?;
        if parts.time.is_empty() {
            return Ok(());
        }
        if parts.date.is_empty() {
            // Times on different days are formatted with their dates.
            parts.time.insert_at(0, &b"yMd".map(u16::from));
            let pattern = best.get(&parts.time)?;
            for field in [
                IntervalField::Date,
                IntervalField::Month,
                IntervalField::Year,
            ] {
                self.set_pattern(field, IntervalPattern::Fallback(try_to_vec(&pattern)?));
            }
            parts.time.insert_at(0, &[b'G'.into()]);
            return self.set_fallback_pattern(IntervalField::Era, &parts.time);
        }

        let format = load_date_time_format(best.locale)?;
        if found {
            // A difference in a field that the skeleton lacks adds the field to the pattern.
            let mut skeleton = try_to_vec(self.skeleton)?;
            for (field, letter) in DATE_FIELDS {
                if !contains(&parts.date, letter) {
                    skeleton.insert_at(0, &[letter.into()]);
                    self.set_fallback_pattern(field, &skeleton)?;
                }
            }
            self.concat_single_date_to_time_intervals(&format, &best.get(&parts.date)?)?;
        }
        self.patterns.date_plus_time_range = Some(DatePlusTimeRange {
            date_pattern: best.get(&parts.normalized_date)?,
            time_pattern: best.get(&parts.normalized_time)?,
            date_time_format: PatternParts::new(&format)?,
        });
        Ok(())
    }

    fn set_pattern(&mut self, field: IntervalField, pattern: IntervalPattern) {
        self.patterns.by_field.set(field as usize, pattern);
    }

    fn set_fallback_pattern(
        &mut self,
        field: IntervalField,
        skeleton: &[u16],
    ) -> Result<(), UErrorCode> {
        self.set_pattern(field, IntervalPattern::Fallback(self.best.get(skeleton)?));
        Ok(())
    }

    /// Returns whether the data has a skeleton with the fields of `time`, or of `date` if `time` is empty.
    fn set_separate_date_time_patterns(
        &mut self,
        date: &[u16],
        time: &[u16],
    ) -> Result<bool, UErrorCode> {
        let skeleton = if time.is_empty() { date } else { time };
        let (best_skeleton, difference) = self.info.best_skeleton(skeleton)?;
        if difference == SkeletonDifference::Fields {
            return Ok(false);
        }
        if time.is_empty() {
            self.set_date_patterns(skeleton, best_skeleton, difference)?;
        } else {
            self.set_time_patterns(skeleton, best_skeleton)?;
        }
        Ok(true)
    }

    // ICU4C: dtitvfmt.cpp, DateIntervalFormat::setIntervalPattern
    fn set_date_patterns(
        &mut self,
        skeleton: &[u16],
        best_skeleton: &[u16],
        difference: SkeletonDifference,
    ) -> Result<(), UErrorCode> {
        let info = self.info;
        let (mut skeleton, mut best) = (try_to_vec(skeleton)?, try_to_vec(best_skeleton)?);
        // The vectors begin with `prefix` added letters, 0 or 1. Once `extended`, added letters accumulate.
        let (mut prefix, mut extended) = (0, false);
        for (field, letter) in DATE_FIELDS {
            let mut pattern = info.interval_pattern(best.slice(prefix..), field);
            let mut extended_match = None;
            if pattern.is_empty() {
                if is_field_unit_ignored(best.slice(prefix..), field) {
                    continue;
                }
                // "dMMM" has no pattern for different years, but "ydMMM" or its best match may have one.
                skeleton.replace_range(0, prefix, &[letter.into()]);
                best.replace_range(0, prefix, &[letter.into()]);
                prefix = usize::from(!extended);
                pattern = info.interval_pattern(&best, field);
                if pattern.is_empty() && difference == SkeletonDifference::None {
                    extended_match = Some(info.best_skeleton(&best)?)
                        .filter(|found| found.1 != SkeletonDifference::Fields);
                    pattern = extended_match
                        .map_or(pattern, |found| info.interval_pattern(found.0, field));
                }
            }
            if pattern.is_empty() {
                continue;
            }
            let matched = extended_match.map_or_else(|| best.slice(prefix..), |found| found.0);
            self.set_adjusted_pattern(field, skeleton.slice(prefix..), matched, pattern)?;
            if field == IntervalField::Month {
                (prefix, extended) = (0, prefix == 1);
            }
        }
        Ok(())
    }

    fn set_time_patterns(
        &mut self,
        skeleton: &[u16],
        best_skeleton: &[u16],
    ) -> Result<(), UErrorCode> {
        for field in [
            IntervalField::Minute,
            IntervalField::Hour,
            IntervalField::AmPm,
        ] {
            let mut pattern = self.info.interval_pattern(best_skeleton, field);
            // 24-hour skeletons may lack an AM/PM pattern.
            if pattern.is_empty()
                && field == IntervalField::AmPm
                && !is_field_unit_ignored(best_skeleton, field)
            {
                pattern = self
                    .info
                    .interval_pattern(best_skeleton, IntervalField::Hour);
            }
            self.set_adjusted_pattern(field, skeleton, best_skeleton, pattern)?;
        }
        Ok(())
    }

    fn set_adjusted_pattern(
        &mut self,
        field: IntervalField,
        skeleton: &[u16],
        best_skeleton: &[u16],
        pattern: U16s,
    ) -> Result<(), UErrorCode> {
        let pattern = adjust_field_width(skeleton, best_skeleton, pattern)?;
        self.set_pattern(field, IntervalPattern::parts(pattern));
        Ok(())
    }

    fn concat_single_date_to_time_intervals(
        &mut self,
        format: &[u16],
        date: &[u16],
    ) -> Result<(), UErrorCode> {
        let format = SimpleFormatter::with_pattern_min_max_arguments(format, 2, 2)?;
        for interval in self
            .patterns
            .by_field
            .slice_mut(IntervalField::AmPm as usize..)
        {
            if let IntervalPattern::Parts { pattern, .. } = interval {
                *interval = IntervalPattern::parts(format.format_to_vec(&[pattern, date]));
            }
        }
        Ok(())
    }
}

/// The state of one formatting call. The fields of the calendars are computed.
struct IntervalWriter<'a> {
    formatter: &'a Fields,
    from: &'a Calendar,
    to: &'a Calendar,
    text: Vec<u16>,
    handler: FieldPositionIteratorHandler,
}

impl IntervalWriter<'_> {
    fn format_date(&mut self, pattern: &[u16], calendar: &Calendar) -> Result<(), UErrorCode> {
        self.formatter.date_format.format_with_pattern(
            pattern,
            Ok(calendar),
            &mut self.text,
            Some(&mut self.handler),
        )
    }

    fn format_range(&mut self, pattern: &[u16]) -> Result<(), UErrorCode> {
        let [before, between, after] = self.formatter.fallback.pieces();
        self.text.add_all(before);
        self.format_date(pattern, self.from)?;
        self.text.add_all(between);
        self.format_date(pattern, self.to)?;
        self.text.add_all(after);
        Ok(())
    }

    /// Writes the time range for {0} and the first date for {1}.
    fn format_date_plus_time_range(
        &mut self,
        patterns: &DatePlusTimeRange,
    ) -> Result<(), UErrorCode> {
        let [before, between, after] = patterns.date_time_format.pieces();
        self.text.add_all(before);
        if patterns.date_time_format.order.is_lt() {
            self.format_range(&patterns.time_pattern)?;
            self.text.add_all(between);
            self.format_date(&patterns.date_pattern, self.from)?;
        } else {
            self.format_date(&patterns.date_pattern, self.from)?;
            self.text.add_all(between);
            self.format_range(&patterns.time_pattern)?;
        }
        self.text.add_all(after);
        Ok(())
    }

    /// Returns false if a single date is written. ICU4C: dtitvfmt.cpp, DateIntervalFormat::formatImpl
    fn format(&mut self) -> Result<bool, UErrorCode> {
        let formatter = self.formatter;
        let single_pattern = &formatter.date_format.pattern;
        let Some((field, interval)) = formatter.largest_difference(self.from, self.to) else {
            return self.format_date(single_pattern, self.from).map(|()| false);
        };
        let full_pattern = match interval {
            IntervalPattern::Parts { pattern, split } => {
                self.format_date(pattern.slice(..*split), self.from)?;
                self.format_date(pattern.slice(*split..), self.to)?;
                return Ok(true);
            }
            IntervalPattern::None if is_field_unit_ignored(single_pattern, field) => {
                return self.format_date(single_pattern, self.from).map(|()| false);
            }
            IntervalPattern::None => single_pattern,
            IntervalPattern::Fallback(pattern) => pattern,
        };
        let on_same_day = field as usize >= IntervalField::AmPm as usize;
        match &formatter.patterns.date_plus_time_range {
            Some(patterns) if on_same_day => self.format_date_plus_time_range(patterns),
            _ => self.format_range(full_pattern),
        }
        .map(|()| true)
    }
}

/// Boxed because `Fields` is too large to move on a small stack.
pub(crate) struct DateIntervalFormat(Box<Fields>);

struct Fields {
    /// Has the single-date pattern and the calendar that each call clones.
    date_format: SimpleDateFormat,
    patterns: IntervalPatterns,
    fallback: PatternParts,
}

impl Fields {
    /// Returns the largest field in which the calendars differ, and its pattern.
    fn largest_difference(
        &self,
        from: &Calendar,
        to: &Calendar,
    ) -> Option<(IntervalField, &IntervalPattern)> {
        let differ = |field: Field| from.internal_get(field) != to.internal_get(field);
        IntervalField::ALL
            .into_iter()
            .zip(&self.patterns.by_field)
            .find(|&(field, pattern)| {
                differ(field.calendar_field())
                    || field == IntervalField::Month
                        && differ(Field::OrdinalMonth)
                        && self.shows_leap_month(pattern)
            })
    }

    /// Returns whether both dates are formatted with a month or a weekday.
    fn shows_leap_month(&self, months: &IntervalPattern) -> bool {
        let shows = |pattern: &[u16]| {
            pattern_fields(pattern).any(|(letter, ..)| matches!(letter, b'M' | b'L' | b'E' | b'c'))
        };
        match months {
            IntervalPattern::None => shows(&self.date_format.pattern),
            IntervalPattern::Fallback(pattern) => shows(pattern),
            IntervalPattern::Parts { pattern, split } => {
                shows(pattern.slice(..*split)) && shows(pattern.slice(*split..))
            }
        }
    }
}

impl DateIntervalFormat {
    pub(crate) fn create_instance(
        skeleton: &[u16],
        locale: &Locale,
        zone: TimeZone,
    ) -> Result<Self, UErrorCode> {
        if get_skeleton(skeleton)? != skeleton {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let info = DateIntervalInfo::for_locale(locale)?;
        let fallback = PatternParts::new(&info.fallback_pattern)?;
        if fallback.order.is_ge() {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let best = BestPatterns {
            locale,
            generator: OnceCell::new(),
        };
        let date_format = SimpleDateFormat::with_pattern(&best.get(skeleton)?, locale, zone)?;
        let mut builder = IntervalPatternsBuilder {
            info: &info,
            best: &best,
            skeleton,
            patterns: IntervalPatterns::default(),
        };
        builder.initialize()?;
        Ok(Self(Box::write(
            memory::try_box_uninit()?,
            Fields {
                date_format,
                patterns: builder.patterns,
                fallback,
            },
        )))
    }

    pub(crate) fn format_to_value(
        &self,
        from: UDate,
        to: UDate,
    ) -> Result<FormattedDateInterval, UErrorCode> {
        let calendar: &Calendar = &self.0.date_format.calendar;
        let (mut from_calendar, mut to_calendar) = (calendar.clone(), calendar.clone());
        from_calendar.set_time(from)?;
        to_calendar.set_time(to)?;
        from_calendar.complete()?;
        to_calendar.complete()?;
        self.format_calendars_to_value(&from_calendar, &to_calendar)
    }

    /// The calendars are complete.
    pub(crate) fn format_calendars_to_value(
        &self,
        from: &Calendar,
        to: &Calendar,
    ) -> Result<FormattedDateInterval, UErrorCode> {
        if !from.has_settings_of(to)
            || from.calendar_type() != self.0.date_format.calendar.calendar_type()
        {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let mut writer = IntervalWriter {
            formatter: &self.0,
            from,
            to,
            text: Vec::new(),
            handler: FieldPositionIteratorHandler::with_category(UFIELD_CATEGORY_DATE),
        };
        let is_range = writer.format()?;
        FormattedDateInterval::new(writer.text, writer.handler.finish()?, is_range)
    }
}
