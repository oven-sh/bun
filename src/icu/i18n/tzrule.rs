//! The rules and transitions of a zone. ICU4C: tzrule.cpp

use crate::i18n::gregoimp::{U_MILLIS_PER_DAY, UDate, double_to_int32, grego};
use crate::i18n::unicode::ucal::UCAL_FEBRUARY;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum DateRuleType {
    /// March 11.
    Dom,
    /// The second Sunday in March.
    Dow,
    /// The first Sunday on or after March 8.
    DowGeqDom,
    /// The last Sunday on or before March 14.
    DowLeqDom,
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum TimeRuleType {
    Wall,
    Standard,
    Utc,
}

#[derive(Clone, Copy)]
pub(crate) struct DateTimeRule {
    pub(crate) date_type: DateRuleType,
    pub(crate) month: i8,
    /// The day of the month. For `Dow` the week of the month, counted from the end if negative.
    pub(crate) day: i8,
    pub(crate) day_of_week: i8,
    pub(crate) millis: i32,
    pub(crate) time_type: TimeRuleType,
}

/// In milliseconds.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct TimeZoneRule {
    pub(crate) raw_offset: i32,
    pub(crate) dst_savings: i32,
}

impl TimeZoneRule {
    pub(crate) fn standard_time(raw_offset: i32) -> Self {
        Self {
            raw_offset,
            dst_savings: 0,
        }
    }

    pub(crate) fn total_offset(self) -> i32 {
        self.raw_offset.wrapping_add(self.dst_savings)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct TimeZoneTransition {
    pub(crate) time: UDate,
    pub(crate) from: TimeZoneRule,
    pub(crate) to: TimeZoneRule,
}

/// Takes effect once a year from `start_year` on. `previous` is the rule before it, `year` the year of `base`.
pub(crate) struct AnnualTimeZoneRule {
    pub(crate) offsets: TimeZoneRule,
    pub(crate) rule: DateTimeRule,
    pub(crate) start_year: i32,
}

impl AnnualTimeZoneRule {
    // ICU4C: tzrule.cpp, AnnualTimeZoneRule::getStartInYear
    fn start_in(&self, year: i32, previous: TimeZoneRule) -> UDate {
        let (rule, month, day) = (
            &self.rule,
            i32::from(self.rule.month),
            i32::from(self.rule.day),
        );
        let (day_of_month, after) = match rule.date_type {
            DateRuleType::Dom | DateRuleType::DowGeqDom => (day, true),
            DateRuleType::Dow if day > 0 => (7 * day - 6, true),
            DateRuleType::Dow => (
                i32::from(grego::month_length(year, month)) + 7 * (day + 1),
                false,
            ),
            DateRuleType::DowLeqDom
                if month == UCAL_FEBRUARY && day == 29 && !grego::is_leap_year(year) =>
            {
                (28, false)
            }
            DateRuleType::DowLeqDom => (day, false),
        };
        let mut rule_day = grego::fields_to_day(year, month, day_of_month) as f64;
        if rule.date_type != DateRuleType::Dom {
            // The day overflows `i32` after about the year 5,800,000.
            let delta = i32::from(rule.day_of_week) - grego::day_of_week(double_to_int32(rule_day));
            rule_day += f64::from(match after {
                true if delta < 0 => delta + 7,
                false if delta > 0 => delta - 7,
                _ => delta,
            });
        }
        let mut start = rule_day * f64::from(U_MILLIS_PER_DAY) + f64::from(rule.millis);
        if rule.time_type != TimeRuleType::Utc {
            start -= f64::from(previous.raw_offset);
        }
        if rule.time_type == TimeRuleType::Wall {
            start -= f64::from(previous.dst_savings);
        }
        start
    }

    pub(crate) fn next_start(&self, base: UDate, year: i32, previous: TimeZoneRule) -> UDate {
        if year < self.start_year {
            return self.start_in(self.start_year, previous);
        }
        let start = self.start_in(year, previous);
        if start <= base {
            self.start_in(year + 1, previous)
        } else {
            start
        }
    }

    pub(crate) fn previous_start(
        &self,
        base: UDate,
        year: i32,
        previous: TimeZoneRule,
        inclusive: bool,
    ) -> Option<UDate> {
        if year < self.start_year {
            return None;
        }
        let start = self.start_in(year, previous);
        if start > base || (!inclusive && start == base) {
            (year > self.start_year).then(|| self.start_in(year - 1, previous))
        } else {
            Some(start)
        }
    }
}
