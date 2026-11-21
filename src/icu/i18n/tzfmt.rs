//! Formats time zones in the styles of date patterns. ICU4C: tzfmt.cpp

use crate::common::locid::Locale;
use crate::common::memory::{Appendable, defer_oom, get_or_try_init, try_concat, try_to_vec};
use crate::common::putil::uprv_get_utc_time;
use crate::common::simpleformatter::ARG0;
use crate::common::sink::TextSink;
use crate::common::slice_ext::SliceExt;
use crate::common::unistr::{SmallUString, UStr};
use crate::common::utf16;
use crate::common::utypes::*;
use crate::i18n::gregoimp::{U_MILLIS_PER_HOUR, U_MILLIS_PER_SECOND, UDate};
use crate::i18n::numsys::NumberingSystem;
use crate::i18n::timezone::TimeZone;
use crate::i18n::tzgnames::TimeZoneGenericNames;
use crate::i18n::tznames::{NameType, TimeZoneNames};
use crate::i18n::zonemeta;
use std::sync::{Arc, OnceLock};

#[derive(Clone, Copy)]
pub(crate) enum ZoneStyle {
    Generic,
    Specific,
    LocalizedGmt,
}

/// Holds a localized GMT format of most locales.
const USUAL_GMT_CAPACITY: usize = 16;
const MAX_OFFSET: u32 = 24 * U_MILLIS_PER_HOUR as u32;

const QUOTE: u16 = b'\'' as u16;
const SEMICOLON: u16 = b';' as u16;
const H: u16 = b'H' as u16;
const M: u16 = b'm' as u16;
const S: u16 = b's' as u16;

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

fn parse_offset_pattern(mut pattern: &[u16]) -> Result<Vec<PatternItem>, UErrorCode> {
    let mut items = Vec::new();
    while let Some(&first) = pattern.first() {
        let is_field = |unit| matches!(unit, H | M | S);
        let length = pattern
            .iter()
            .take_while(|&&unit| unit == first || !(is_field(unit) || is_field(first)))
            .count();
        let (run, rest) = (pattern.slice(..length), pattern.slice(length..));
        items.add(match run {
            [H] | [H, H] => PatternItem::Hour,
            [M, M] => PatternItem::Minute,
            [S, S] => PatternItem::Second,
            [H | M | S, ..] => return Err(U_ILLEGAL_ARGUMENT_ERROR),
            _ => {
                let mut text = SmallUString::new();
                text.set(run)?;
                PatternItem::Text(text)
            }
        });
        pattern = rest;
    }
    Ok(items)
}

/// The patterns for one sign.
struct OffsetPatterns {
    h: Vec<PatternItem>,
    hm: Vec<PatternItem>,
    hms: Vec<PatternItem>,
}

impl OffsetPatterns {
    /// Derives "+HH" and "+HH:mm:ss" from "+HH:mm".
    fn new(hm: &[u16]) -> Result<Self, UErrorCode> {
        let mm = hm.index_of(&[M, M]).ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        let last_h = hm.slice(..mm).iter().rposition(|&c| c == H);
        let after_h = last_h.ok_or(U_ILLEGAL_ARGUMENT_ERROR)? + 1;
        let hms = try_concat(&[
            hm.slice(..mm + 2),
            hm.slice(after_h..mm),
            &[S, S],
            hm.slice(mm + 2..),
        ])?;
        Ok(Self {
            h: parse_offset_pattern(hm.slice(..after_h))?,
            hm: parse_offset_pattern(hm)?,
            hms: parse_offset_pattern(&hms)?,
        })
    }
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
        let gmt_pattern = time_zone_names.pattern(b"gmtFormat")?;
        let arg0 = gmt_pattern
            .index_of(&ARG0)
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        let hour_format = time_zone_names.pattern(b"hourFormat")?;
        let semicolon = hour_format
            .index_of(&[SEMICOLON])
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
        if gmt_pattern.contains(&QUOTE) || hour_format.contains(&QUOTE) {
            return Err(U_UNSUPPORTED_ERROR);
        }

        let ns = NumberingSystem::create_instance_for_locale(locale)?;
        let digits = to_code_points(ns.get_description()).filter(|_| !ns.is_algorithmic());
        Ok(Self {
            locale: locale.clone(),
            time_zone_names,
            time_zone_generic_names: OnceLock::new(),
            gmt_pattern_prefix: try_to_vec(gmt_pattern.slice(..arg0))?,
            gmt_pattern_suffix: try_to_vec(gmt_pattern.slice(arg0 + ARG0.len()..))?,
            positive_patterns: OffsetPatterns::new(hour_format.slice(..semicolon))?,
            negative_patterns: OffsetPatterns::new(hour_format.slice(semicolon + 1..))?,
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
        }
        if name.len() == start {
            self.format_offset_localized_gmt(offsets.total_offset(), is_long, name);
        }
    }

    fn format_generic(&self, tz: &TimeZone, is_long: bool, date: UDate, name: &mut Vec<u16>) {
        if let Ok(names) = get_or_try_init(&self.time_zone_generic_names, || {
            TimeZoneGenericNames::create_instance(&self.locale)
        }) {
            names.display_name(tz, is_long, date, name);
        }
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
        let items = if seconds != 0 {
            &patterns.hms
        } else if minutes != 0 || is_long {
            &patterns.hm
        } else {
            &patterns.h
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

/// Returns the long name at the current time. ICU4C: timezone.cpp, TimeZone::getDisplayName
pub(crate) fn display_name(tz: &TimeZone, is_daylight: bool, locale: &Locale) -> Vec<u16> {
    let mut name = Vec::new();
    let Ok(names) = TimeZoneNames::create_instance(locale) else {
        return name;
    };
    if let Some(tzid) = zonemeta::get_canonical_cldr_id_of(tz) {
        let name_type = if is_daylight {
            NameType::LongDaylight
        } else {
            NameType::LongStandard
        };
        let now = uprv_get_utc_time();
        name.add_each(names.display_name(tzid, name_type, now).iter());
    }
    if name.is_empty()
        && let Ok(format) = TimeZoneFormat::create_instance(locale)
    {
        format.format_offset_localized_gmt(tz.current_offset(is_daylight), true, &mut name);
    }
    name
}
