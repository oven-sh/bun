//! The final rules of a zone: a raw offset and at most one pair of annual rules. ICU4C: simpletz.cpp

use crate::common::bytes::I32s;
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, UErrorCode};
use crate::i18n::gregoimp::{U_MILLIS_PER_DAY, U_MILLIS_PER_SECOND, UDate, grego};
use crate::i18n::timezone::LocalOptions;
use crate::i18n::tzrule::{
    AnnualTimeZoneRule, DateRuleType, DateTimeRule, TimeRuleType, TimeZoneRule, TimeZoneTransition,
};
use crate::i18n::unicode::ucal::{UCAL_DECEMBER, UCAL_JANUARY, UCAL_SATURDAY};
use std::cmp::Ordering;

pub(crate) struct SimpleRules {
    pub(crate) raw_offset: i32,
    pub(crate) dst_savings: i32,
    start_and_end: Option<(DateTimeRule, DateTimeRule)>,
}

/// Decodes month, day, day of the week, seconds and time mode. The signs select the type, and day 0 means no rule.
fn decode_rule(numbers: I32s) -> Result<Option<DateTimeRule>, UErrorCode> {
    const LEAP_YEAR: i32 = 0;
    let (month, day, day_of_week) = (
        numbers.at(0) as i8,
        numbers.at(1) as i8,
        numbers.at(2) as i8,
    );
    if day == 0 {
        return Ok(None);
    }
    let millis = numbers.at(3).wrapping_mul(U_MILLIS_PER_SECOND);
    let time_type = match numbers.at(4) {
        0 => TimeRuleType::Wall,
        1 => TimeRuleType::Standard,
        2 => TimeRuleType::Utc,
        _ => return Err(U_ILLEGAL_ARGUMENT_ERROR),
    };
    let days = 1..=grego::month_length(LEAP_YEAR, month.into());
    let (date_type, day, days) = match day_of_week {
        0 => (DateRuleType::Dom, day, days),
        1.. => (DateRuleType::Dow, day, -5..=5),
        _ if day > 0 => (DateRuleType::DowGeqDom, day, days),
        _ => (DateRuleType::DowLeqDom, day.wrapping_neg(), days),
    };
    // -128 stays negative and passes the range check.
    let day_of_week = day_of_week.wrapping_abs();
    let is_valid = (UCAL_JANUARY..=UCAL_DECEMBER).contains(&month.into())
        && (0..=U_MILLIS_PER_DAY).contains(&millis)
        && i32::from(day_of_week) <= UCAL_SATURDAY
        && days.contains(&day);
    let rule = DateTimeRule {
        date_type,
        month,
        day,
        day_of_week,
        millis,
        time_type,
    };
    is_valid
        .then_some(Some(rule))
        .ok_or(U_ILLEGAL_ARGUMENT_ERROR)
}

/// Compares `date` plus `delta` milliseconds with the time at which `rule` takes effect in the year of `date`.
fn compare_to_rule(date: &grego::Fields, delta: i32, rule: &DateTimeRule) -> Ordering {
    let (mut month, mut day, mut day_of_week) = (
        i32::from(date.month),
        i32::from(date.dom),
        i32::from(date.dow),
    );
    let length = i32::from(grego::month_length(date.year, month));
    let mut millis = date.mid.wrapping_add(delta);
    // The month can become -1 or 12.
    while millis >= U_MILLIS_PER_DAY {
        millis -= U_MILLIS_PER_DAY;
        day_of_week = 1 + day_of_week % 7;
        (month, day) = if day < length {
            (month, day + 1)
        } else {
            (month + 1, 1)
        };
    }
    while millis < 0 {
        millis += U_MILLIS_PER_DAY;
        day_of_week = 1 + (day_of_week + 5) % 7;
        day -= 1;
        if day < 1 {
            day = grego::previous_month_length(date.year, month).into();
            month -= 1;
        }
    }
    if month != i32::from(rule.month) {
        return month.cmp(&rule.month.into());
    }
    let (rule_day, weekday) = (length.min(rule.day.into()), i32::from(rule.day_of_week));
    let rule_day = match rule.date_type {
        DateRuleType::Dom => rule_day,
        DateRuleType::Dow if rule_day > 0 => {
            1 + (rule_day - 1) * 7 + (7 + weekday - (day_of_week - day + 1)) % 7
        }
        DateRuleType::Dow => {
            length + (rule_day + 1) * 7 - (7 + (day_of_week + length - day) - weekday) % 7
        }
        DateRuleType::DowGeqDom => rule_day + (49 + weekday - rule_day - day_of_week + day) % 7,
        DateRuleType::DowLeqDom => rule_day - (49 - weekday + rule_day + day_of_week - day) % 7,
    };
    (day, millis).cmp(&(rule_day, rule.millis))
}

impl SimpleRules {
    /// Decodes the eleven numbers of a rule of zoneinfo64: start rule, end rule, savings in seconds.
    pub(crate) fn new(raw_offset: i32, numbers: I32s) -> Result<Self, UErrorCode> {
        let start_and_end = decode_rule(numbers)?.zip(decode_rule(numbers.slice(5..))?);
        match numbers.at(10).wrapping_mul(U_MILLIS_PER_SECOND) {
            0 => Err(U_ILLEGAL_ARGUMENT_ERROR),
            dst_savings => Ok(Self {
                raw_offset,
                dst_savings,
                start_and_end,
            }),
        }
    }

    pub(crate) fn use_daylight_time(&self) -> bool {
        self.start_and_end.is_some()
    }

    /// Returns the DST savings at a local standard time.
    fn savings_at(&self, time: UDate) -> Result<i32, UErrorCode> {
        let date = grego::time_to_fields(time)?;
        let Some((start, end)) = self.start_and_end.as_ref().filter(|_| date.year >= 0) else {
            return Ok(0);
        };
        let compare = |rule: &DateTimeRule, savings| {
            let delta = match rule.time_type {
                TimeRuleType::Wall => savings,
                TimeRuleType::Standard => 0,
                TimeRuleType::Utc => self.raw_offset.wrapping_neg(),
            };
            compare_to_rule(&date, delta, rule)
        };
        // Northern hemisphere: DST between start and end. Southern: after the start or before the end.
        let (is_southern, has_started) = (start.month > end.month, compare(start, 0).is_ge());
        let is_daylight = if is_southern == has_started {
            has_started
        } else {
            compare(end, self.dst_savings).is_lt()
        };
        Ok(if is_daylight { self.dst_savings } else { 0 })
    }

    fn offsets_with(&self, dst_savings: i32) -> TimeZoneRule {
        TimeZoneRule {
            raw_offset: self.raw_offset,
            dst_savings,
        }
    }

    pub(crate) fn get_offset(&self, date: UDate, local: bool) -> Result<TimeZoneRule, UErrorCode> {
        let first = self.savings_at(if local {
            date
        } else {
            date + f64::from(self.raw_offset)
        })?;
        let savings = if local && first != 0 {
            self.savings_at(date - f64::from(first))
        } else {
            Ok(first)
        };
        savings.map(|savings| self.offsets_with(savings))
    }

    pub(crate) fn get_offset_from_local(
        &self,
        date: UDate,
        options: LocalOptions,
    ) -> Result<TimeZoneRule, UErrorCode> {
        let mut savings = self.savings_at(date)?;
        if !options.picks_latter(savings > 0) {
            savings = self.savings_at(date - f64::from(self.dst_savings))?;
        }
        Ok(self.offsets_with(savings))
    }

    /// Returns the rules that apply from `start_year` on, or `None` if the zone has no DST.
    pub(crate) fn annual_rules(&self, start_year: i32) -> Option<AnnualRules> {
        let annual = |dst_savings, rule| AnnualTimeZoneRule {
            offsets: self.offsets_with(dst_savings),
            rule,
            start_year,
        };
        self.start_and_end.map(|(start, end)| AnnualRules {
            std: annual(0, end),
            dst: annual(self.dst_savings, start),
        })
    }
}

fn year_of(time: UDate) -> i32 {
    grego::time_to_year(time).unwrap_or(0)
}

/// The rules for the start of standard time and of daylight saving time.
pub(crate) struct AnnualRules {
    std: AnnualTimeZoneRule,
    dst: AnnualTimeZoneRule,
}

impl AnnualRules {
    fn to_std(&self, time: UDate) -> TimeZoneTransition {
        TimeZoneTransition {
            time,
            from: self.dst.offsets,
            to: self.std.offsets,
        }
    }

    fn to_dst(&self, time: UDate) -> TimeZoneTransition {
        TimeZoneTransition {
            time,
            from: self.std.offsets,
            to: self.dst.offsets,
        }
    }

    /// Returns `None` if both rules take effect at the same time.
    pub(crate) fn next_transition(&self, base: UDate) -> Option<TimeZoneTransition> {
        let year = year_of(base);
        let std = self.std.next_start(base, year, self.dst.offsets);
        let dst = self.dst.next_start(base, year, self.std.offsets);
        if std < dst {
            Some(self.to_std(std))
        } else {
            (dst < std).then(|| self.to_dst(dst))
        }
    }

    /// Requires `base` to be later than the first transition.
    pub(crate) fn previous_transition(
        &self,
        base: UDate,
        inclusive: bool,
    ) -> Option<TimeZoneTransition> {
        let year = year_of(base);
        let std = self
            .std
            .previous_start(base, year, self.dst.offsets, inclusive);
        let dst = self
            .dst
            .previous_start(base, year, self.std.offsets, inclusive);
        // `None` compares less than `Some`.
        if std > dst {
            std.map(|std| self.to_std(std))
        } else {
            dst.filter(|_| dst > std).map(|dst| self.to_dst(dst))
        }
    }
}
