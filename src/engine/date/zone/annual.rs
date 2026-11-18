use super::rules::{Offset, SECONDS_PER_DAY, Side, Span};
use crate::civil::{
    CivilDate, civil_from_days, day_of_year, days_from_civil, days_in_month, is_leap_year, week_day,
};

/// A moment that every year has, such as 02:00 on the second Sunday of March.
#[derive(Clone, Copy)]
pub(super) struct YearlyMoment {
    /// From 1.
    pub(super) month: u8,
    /// The last day of the month if that is earlier.
    pub(super) day: u8,
    pub(super) days_later: i32,
    /// The first such day from then on. Sunday is 0.
    pub(super) week_day: Option<u8>,
    /// From midnight in standard time.
    pub(super) seconds: i32,
}

impl YearlyMoment {
    /// In a year as long as `year` that begins on `first_week_day`.
    #[inline(never)]
    fn seconds_into_year(self, year: i32, first_week_day: u8) -> i32 {
        let date = CivilDate {
            year,
            month: self.month,
            day: self.day.min(days_in_month(year, self.month)),
        };
        let mut days = i32::from(day_of_year(date)) - 1 + self.days_later;
        if let Some(week_day) = self.week_day {
            days += (i32::from(week_day) - i32::from(first_week_day) - days).rem_euclid(7);
        }
        days * SECONDS_PER_DAY as i32 + self.seconds
    }
}

/// Daylight saving time that starts and ends once in each year.
pub(super) struct AnnualRule {
    /// From when the rule applies, to instants and to local times alike.
    pub(super) start: i64,
    standard: i32,
    at_new_year: Offset,
    mid_year: Offset,
    /// When `mid_year` starts and ends, in seconds into the year in standard time. By whether it is a leap year and by the
    /// week day that it begins on.
    changes: [[[i32; 2]; 7]; 2],
}

impl AnnualRule {
    pub(super) fn new(
        start: i64,
        standard: Offset,
        daylight: Offset,
        daylight_start: YearlyMoment,
        daylight_end: YearlyMoment,
    ) -> AnnualRule {
        let (at_new_year, mid_year, moments) = if daylight_start.month > daylight_end.month {
            (daylight, standard, [daylight_end, daylight_start])
        } else {
            (standard, daylight, [daylight_start, daylight_end])
        };
        AnnualRule {
            start,
            standard: standard.seconds,
            at_new_year,
            mid_year,
            changes: [1999, 2000].map(|year| {
                [0, 1, 2, 3, 4, 5, 6].map(|first_week_day| {
                    moments.map(|moment| moment.seconds_into_year(year, first_week_day))
                })
            }),
        }
    }

    pub(super) fn span_at(&self, time: i64) -> Span {
        let span = self.span_in_year(time);
        Span {
            start: span.start.max(self.start),
            ..span
        }
    }

    pub(super) fn span_at_local(&self, local_time: i64, side: Side) -> Span {
        let shift = side.local_shift(self.at_new_year, self.mid_year);
        let span = self.span_in_year(local_time - shift);
        Span {
            start: (span.start + shift).max(self.start),
            end: span.end + shift,
            offset: span.offset,
        }
    }

    #[inline]
    fn span_in_year(&self, time: i64) -> Span {
        let standard = i64::from(self.standard);
        let year = civil_from_days((time + standard).div_euclid(SECONDS_PER_DAY) as i32).year;
        let first_day = days_from_civil(year, 1, 1);
        let is_leap = is_leap_year(year);
        let year_start = first_day * SECONDS_PER_DAY - standard;
        let year_end = year_start + (365 + i64::from(is_leap)) * SECONDS_PER_DAY;
        let [first, second] = self.changes[usize::from(is_leap)]
            [usize::from(week_day(first_day as i32))]
        .map(|seconds| year_start + i64::from(seconds));

        let (start, end, offset) = if time < first {
            (year_start, first, self.at_new_year)
        } else if time < second {
            (first, second, self.mid_year)
        } else {
            (first.max(second), year_end, self.at_new_year)
        };
        Span {
            start: start.max(year_start),
            end: end.min(year_end),
            offset,
        }
    }
}
