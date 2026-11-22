//! Formats time zones in the styles of date patterns. ICU4C: tzfmt.cpp

use crate::common::locid::Locale;
use crate::common::memory::{
    Appendable, defer_oom, get_or_try_init, try_concat, try_with_capacity,
};
use crate::common::putil::uprv_get_utc_time;
use crate::common::simpleformatter::ARG0;
use crate::common::sink::TextSink;
use crate::common::slice_ext::SliceExt;
use crate::common::unistr::{SmallUString, UStr, ustr};
use crate::common::utf16::{self, from_latin1};
use crate::common::utypes::*;
use crate::i18n::gregoimp::{U_MILLIS_PER_HOUR, U_MILLIS_PER_MINUTE, U_MILLIS_PER_SECOND, UDate};
use crate::i18n::numsys::NumberingSystem;
use crate::i18n::timezone::{TimeZone, UNKNOWN_ZONE_ID};
use crate::i18n::tzgnames::TimeZoneGenericNames;
use crate::i18n::tznames::{NameType, TimeZoneNames};
use crate::i18n::tzrule::TimeZoneRule;
use crate::i18n::zonemeta;
use std::sync::{Arc, OnceLock};

#[derive(Clone, Copy)]
pub(crate) enum ZoneStyle {
    Generic,
    Specific,
    LocalizedGmt,
    GenericLocation,
}

/// The forms of an offset such as "-0800".
#[derive(Clone, Copy)]
pub(crate) struct IsoStyle {
    pub(crate) has_colons: bool,
    pub(crate) has_z_for_zero: bool,
    pub(crate) omits_zero_minutes: bool,
    pub(crate) ignores_seconds: bool,
}

/// Holds a localized GMT format of most locales.
const USUAL_GMT_CAPACITY: usize = 16;
const MAX_OFFSET: u32 = 24 * U_MILLIS_PER_HOUR as u32;

const QUOTE: u16 = b'\'' as u16;
const SEMICOLON: u16 = b';' as u16;
const H: u16 = b'H' as u16;
const M: u16 = b'm' as u16;
const S: u16 = b's' as u16;

const DEFAULT_HOUR_FORMAT: [u16; 11] = from_latin1(b"+H:mm;-H:mm");
const DEFAULT_GMT_DIGITS: [u32; 10] = [0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39];

/// Returns hours, minutes and seconds, or `None` for 24 hours or more.
fn offset_fields(offset: i32) -> Option<[u32; 3]> {
    let seconds = offset.unsigned_abs() / U_MILLIS_PER_SECOND as u32;
    (offset.unsigned_abs() < MAX_OFFSET).then_some([
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60,
    ])
}

enum PatternItem {
    Text(SmallUString),
    Hour,
    Minute,
    Second,
}

// Sets of fields.
const HOUR: u8 = 1;
const MINUTE: u8 = 2;
const SECOND: u8 = 4;

/// The items of "+HH:mm:ss".
const USUAL_ITEM_COUNT: usize = 6;

/// `None` if the fields are not the required ones. Such a pattern formats nothing.
type OffsetPattern = Option<Vec<PatternItem>>;

fn parse_offset_pattern(mut pattern: &[u16], required: u8) -> Result<OffsetPattern, UErrorCode> {
    let (mut items, mut in_quote, mut fields) = (try_with_capacity(USUAL_ITEM_COUNT)?, false, 0);
    while let Some(&first) = pattern.first() {
        let is_syntax = |unit| unit == QUOTE || (!in_quote && matches!(unit, H | M | S));
        let (run, rest) = if is_syntax(first) {
            pattern.split_while(|&unit| unit == first)
        } else {
            pattern.split_while(|&unit| !is_syntax(unit))
        };
        pattern = rest;
        let (item, field) = match run {
            [H] | [H, H] if !in_quote => (PatternItem::Hour, HOUR),
            [M, M] if !in_quote => (PatternItem::Minute, MINUTE),
            [S, S] if !in_quote => (PatternItem::Second, SECOND),
            [H | M | S, ..] if !in_quote => return Err(U_ILLEGAL_ARGUMENT_ERROR),
            [QUOTE] => {
                in_quote = !in_quote;
                continue;
            }
            _ => {
                let (mut text, is_quotes) = (SmallUString::new(), first == QUOTE);
                text.set(run.slice(..run.len() >> u8::from(is_quotes)))?;
                in_quote ^= is_quotes && run.len() % 2 == 1;
                (PatternItem::Text(text), 0)
            }
        };
        items.add(item);
        fields |= field;
    }
    Ok((fields == required).then_some(items))
}

/// The patterns for one sign.
struct OffsetPatterns {
    h: OffsetPattern,
    hm: OffsetPattern,
    hms: OffsetPattern,
}

/// A pattern such as "+HH:mm", the index after its last H before "mm", and the index of "mm".
type HourFormat<'a> = (&'a [u16], usize, usize);

/// Splits "positive;negative".
fn split_hour_format(format: &[u16]) -> Option<[HourFormat<'_>; 2]> {
    fn find_fields(hm: &[u16]) -> Option<HourFormat<'_>> {
        let mm = hm.index_of(&[M, M])?;
        let last_h = hm.slice(..mm).iter().rposition(|&c| c == H)?;
        Some((hm, last_h + 1, mm))
    }
    let semicolon = format.index_of(&[SEMICOLON])?;
    Some([
        find_fields(format.slice(..semicolon))?,
        find_fields(format.slice(semicolon + 1..))?,
    ])
}

impl OffsetPatterns {
    /// Derives "+HH" and "+HH:mm:ss" from "+HH:mm".
    fn new((hm, after_h, mm): HourFormat) -> Result<Self, UErrorCode> {
        let mut pairs = hm.slice(..after_h).array_windows();
        let after_hours = pairs
            .rposition(|pair| *pair == [H, H])
            .map_or(after_h, |hh| hh + 2);
        let hms = try_concat(&[
            hm.slice(..mm + 2),
            hm.slice(after_h..mm),
            &[S, S],
            hm.slice(mm + 2..),
        ])?;
        Ok(Self {
            h: parse_offset_pattern(hm.slice(..after_hours), HOUR)?,
            hm: parse_offset_pattern(hm, HOUR | MINUTE)?,
            hms: parse_offset_pattern(&hms, HOUR | MINUTE | SECOND)?,
        })
    }
}

/// Fails if a pattern is `None` before the first pattern in which a field directly follows the hours.
fn check_offset_patterns(patterns: [&OffsetPattern; 6]) -> Result<(), UErrorCode> {
    for pattern in patterns {
        let items = pattern.as_ref().ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        let mut from_hours = items
            .iter()
            .skip_while(|item| !matches!(item, PatternItem::Hour));
        if !matches!(from_hours.nth(1), None | Some(PatternItem::Text(_))) {
            break;
        }
    }
    Ok(())
}

/// Removes single quotes. A doubled quote becomes one quote.
fn unquote(pattern: &[u16]) -> Result<Vec<u16>, UErrorCode> {
    let mut text = try_with_capacity(pattern.len())?;
    for run in pattern.runs_by(|a, b| (*a == QUOTE) == (*b == QUOTE)) {
        text.add_all(run.slice(..run.len() >> u8::from(run.first() == Some(&QUOTE))));
    }
    Ok(text)
}

fn to_code_points(digits: &[u16]) -> Option<[u32; 10]> {
    let mut code_points = [0; 10];
    code_points
        .iter_mut()
        .zip(utf16::code_points(digits))
        .for_each(|(slot, c)| *slot = c);
    (digits.count_char32() == 10).then_some(code_points)
}

pub(crate) struct TimeZoneFormat {
    locale: Locale,
    time_zone_names: Arc<TimeZoneNames>,
    time_zone_generic_names: OnceLock<Arc<TimeZoneGenericNames>>,
    gmt_pattern_prefix: Vec<u16>,
    gmt_pattern_suffix: Vec<u16>,
    positive_patterns: OffsetPatterns,
    negative_patterns: OffsetPatterns,
    gmt_offset_digits: [u32; 10],
}

impl TimeZoneFormat {
    pub(crate) fn create_instance(locale: &Locale) -> Result<Self, UErrorCode> {
        let time_zone_names = TimeZoneNames::create_instance(locale)?;
        let gmt_pattern = match time_zone_names.pattern(b"gmtFormat") {
            Ok(pattern) if !pattern.units().is_empty() => pattern.until_nul().try_to_vec()?,
            _ => ustr("GMT{0}"),
        };
        let arg0 = gmt_pattern
            .index_of(&ARG0)
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        let hour_format = time_zone_names.pattern(b"hourFormat")?;
        let hour_format = hour_format.until_nul().try_to_vec()?;
        let [plus, minus] = split_hour_format(&hour_format)
            .or_else(|| split_hour_format(&DEFAULT_HOUR_FORMAT))
            .ok_or(U_INTERNAL_PROGRAM_ERROR)?;
        let (plus, minus) = (OffsetPatterns::new(plus)?, OffsetPatterns::new(minus)?);
        check_offset_patterns([
            &plus.hm, &plus.hms, &minus.hm, &minus.hms, &plus.h, &minus.h,
        ])?;

        let ns = NumberingSystem::create_instance_for_locale(locale)?;
        let digits = to_code_points(ns.get_description()).filter(|_| !ns.is_algorithmic());
        Ok(Self {
            locale: locale.clone(),
            time_zone_names,
            time_zone_generic_names: OnceLock::new(),
            gmt_pattern_prefix: unquote(gmt_pattern.slice(..arg0))?,
            gmt_pattern_suffix: unquote(gmt_pattern.slice(arg0 + ARG0.len()..))?,
            positive_patterns: plus,
            negative_patterns: minus,
            gmt_offset_digits: digits.unwrap_or(DEFAULT_GMT_DIGITS),
        })
    }

    /// Appends the name of `tz` in `style`, or its offset if it has no such name.
    pub(crate) fn format(
        &self,
        style: ZoneStyle,
        is_long: bool,
        tz: &TimeZone,
        date: UDate,
        name: &mut Vec<u16>,
    ) {
        let Ok(offsets) = tz.get_offset(date, false) else {
            return;
        };
        let start = name.len();
        match style {
            ZoneStyle::Generic => self.format_generic(tz, is_long, date, name),
            ZoneStyle::Specific => {
                self.format_specific(tz, is_long, offsets.dst_savings != 0, date, name)
            }
            ZoneStyle::LocalizedGmt => {}
            ZoneStyle::GenericLocation => self.format_generic_location(tz, name),
        }
        if name.len() == start {
            self.format_offset_localized_gmt(offsets.total_offset(), is_long, name);
        }
    }

    fn generic_names(&self) -> Result<&Arc<TimeZoneGenericNames>, UErrorCode> {
        get_or_try_init(&self.time_zone_generic_names, || {
            TimeZoneGenericNames::create_instance(&self.locale)
        })
    }

    fn format_generic(&self, tz: &TimeZone, is_long: bool, date: UDate, name: &mut Vec<u16>) {
        if let Ok(names) = self.generic_names() {
            names.display_name(tz, is_long, date, name);
        }
    }

    #[cold]
    fn format_generic_location(&self, tz: &TimeZone, name: &mut Vec<u16>) {
        if let Ok(names) = self.generic_names()
            && let Some(tzid) = zonemeta::get_canonical_cldr_id_of(tz)
        {
            names.generic_location_name(tzid, name);
        }
    }

    pub(crate) fn format_exemplar_location(&self, tz: &TimeZone, name: &mut Vec<u16>) {
        let location = zonemeta::get_canonical_cldr_id_of(tz)
            .into_iter()
            .chain([&UNKNOWN_ZONE_ID[..]])
            .map(|id| self.time_zone_names.exemplar_location_name(id))
            .find(|location| !location.is_empty());
        name.add_all(&location.unwrap_or_else(|| ustr("Unknown")));
    }

    fn format_specific(
        &self,
        tz: &TimeZone,
        is_long: bool,
        is_daylight: bool,
        date: UDate,
        name: &mut Vec<u16>,
    ) {
        let name_type = match (is_long, is_daylight) {
            (true, false) => NameType::LongStandard,
            (true, true) => NameType::LongDaylight,
            (false, false) => NameType::ShortStandard,
            (false, true) => NameType::ShortDaylight,
        };
        if let Some(tzid) = zonemeta::get_canonical_cldr_id_of(tz) {
            let names = &self.time_zone_names;
            name.add_each(names.display_name(tzid, name_type, date).iter());
        }
    }

    /// Appends "GMT-08:00" if `is_long`, else "GMT-8".
    #[cfg_attr(mordant, allow(error_collapsed_to_bool))] // The flag stays set.
    fn format_offset_localized_gmt(&self, offset: i32, is_long: bool, name: &mut Vec<u16>) {
        let Some([hours, minutes, seconds]) = offset_fields(offset) else {
            return;
        };
        let patterns = if offset >= 0 {
            &self.positive_patterns
        } else {
            &self.negative_patterns
        };
        let pattern = if seconds != 0 {
            &patterns.hms
        } else if minutes != 0 || is_long {
            &patterns.hm
        } else {
            &patterns.h
        };
        let Some(items) = pattern else {
            return;
        };

        let _ = defer_oom(name.reserve_append(USUAL_GMT_CAPACITY));
        name.add_all(&self.gmt_pattern_prefix);
        for item in items {
            match item {
                PatternItem::Text(text) => name.add_all(text),
                PatternItem::Hour => self.append_offset_digits(name, hours, is_long),
                PatternItem::Minute => self.append_offset_digits(name, minutes, true),
                PatternItem::Second => self.append_offset_digits(name, seconds, true),
            }
        }
        name.add_all(&self.gmt_pattern_suffix);
    }

    fn append_offset_digits(&self, name: &mut Vec<u16>, n: u32, is_padded: bool) {
        if n >= 10 || is_padded {
            name.add_code_point(self.gmt_offset_digits.at(n as usize / 10));
        }
        name.add_code_point(self.gmt_offset_digits.at(n as usize % 10));
    }
}

pub(crate) fn format_iso_offset(style: IsoStyle, tz: &TimeZone, date: UDate, name: &mut Vec<u16>) {
    let Ok(offset) = tz.get_offset(date, false).map(TimeZoneRule::total_offset) else {
        return;
    };
    let resolution = if style.ignores_seconds {
        U_MILLIS_PER_MINUTE
    } else {
        U_MILLIS_PER_SECOND
    };
    if style.has_z_for_zero && offset.unsigned_abs() < resolution as u32 {
        return name.add(b'Z'.into());
    }
    let Some(fields) = offset_fields(offset) else {
        return;
    };
    let field_count = match fields {
        [_, _, seconds] if seconds != 0 && !style.ignores_seconds => 3,
        [_, 0, _] if style.omits_zero_minutes => 1,
        _ => 2,
    };
    name.add(if offset <= -resolution { b'-' } else { b'+' }.into());
    for (index, field) in fields.into_iter().take(field_count).enumerate() {
        if index > 0 && style.has_colons {
            name.add(b':'.into());
        }
        name.add_all(&[field / 10, field % 10].map(|digit| u16::from(b'0') + digit as u16));
    }
}

/// Appends the BCP 47 type of `tz`.
pub(crate) fn format_short_id(tz: &TimeZone, name: &mut Vec<u16>) {
    match zonemeta::get_short_id_of(tz) {
        Some(short_id) => name.add_each(short_id.iter()),
        None => name.add_all(&from_latin1(b"unk")),
    }
}

/// Returns the long name at the current time. ICU4C: timezone.cpp, TimeZone::getDisplayName
pub(crate) fn display_name(tz: &TimeZone, is_daylight: bool, locale: &Locale) -> Vec<u16> {
    let mut name = Vec::new();
    let Ok(names) = TimeZoneNames::create_instance(locale) else {
        return name;
    };
    // A missing canonical ID is the empty ID, which can have a meta zone.
    let tzid = zonemeta::get_canonical_cldr_id_of(tz).unwrap_or_default();
    let name_type = if is_daylight {
        NameType::LongDaylight
    } else {
        NameType::LongStandard
    };
    let now = uprv_get_utc_time();
    name.add_each(names.display_name(tzid, name_type, now).iter());
    if name.is_empty()
        && let Ok(format) = TimeZoneFormat::create_instance(locale)
    {
        format.format_offset_localized_gmt(tz.current_offset(is_daylight), true, &mut name);
    }
    name
}
