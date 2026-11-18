use crate::{IsoDate, MonthCode};

/// The months of a year in which each has one of two lengths, but for the last.
#[derive(Clone, Copy, Debug)]
pub(super) struct Months {
    pub(super) count: u8,
    /// The ordinal number of the leap month, or zero.
    pub(super) leap_month: u8,
    pub(super) short_month_days: u8,
    /// A bit for each month that has a day more, the lowest for the first.
    pub(super) long_months: u16,
}

/// A year of a calendar whose months are not those of ISO 8601. Months are ordinal numbers from 1.
#[derive(Clone, Copy, Debug)]
pub(super) struct Year {
    pub(super) number: i32,
    /// In days since the epoch.
    pub(super) first_day: i32,
    pub(super) days: u16,
    pub(super) months: Months,
}

/// A month of a year.
#[derive(Clone, Copy, Debug)]
pub(super) struct YearMonth {
    pub(super) year: Year,
    pub(super) month: u8,
}

impl Months {
    #[inline]
    pub(super) const fn days_before(self, month: u8) -> u16 {
        let elapsed = month as u16 - 1;
        let long_months = self.long_months & ((1 << elapsed) - 1);
        self.short_month_days as u16 * elapsed + long_months.count_ones() as u16
    }

    #[inline]
    pub(super) fn code(self, month: u8) -> MonthCode {
        let follows_insertion = self.leap_month != 0 && month >= self.leap_month;
        MonthCode::new(
            month - u8::from(follows_insertion),
            month == self.leap_month,
        )
    }

    /// YearContainsMonthCode and MonthCodeToOrdinal, for a code that the calendar has.
    #[inline]
    pub(super) fn ordinal(self, code: MonthCode) -> Option<u8> {
        if code.is_leap_month() {
            return (self.leap_month == code.number() + 1).then_some(self.leap_month);
        }
        Some(self.regular_ordinal(code))
    }

    /// For a month that is not a leap month, which every year has.
    #[inline]
    pub(super) fn regular_ordinal(self, code: MonthCode) -> u8 {
        let follows_insertion = self.leap_month != 0 && code.number() >= self.leap_month;
        code.number() + u8::from(follows_insertion)
    }
}

impl Year {
    #[inline]
    pub(super) fn end(self) -> i32 {
        self.first_day + i32::from(self.days)
    }

    pub(super) fn has_date_within_limits(self) -> bool {
        self.first_day <= IsoDate::MAX.epoch_days() && self.end() > IsoDate::MIN.epoch_days()
    }

    #[inline]
    pub(super) fn month(self, month: u8) -> YearMonth {
        debug_assert!((1..=self.months.count).contains(&month));
        YearMonth { year: self, month }
    }

    /// `epoch_day` is in the year.
    #[inline]
    pub(super) fn month_of_day(self, epoch_day: i32) -> YearMonth {
        let elapsed = (epoch_day - self.first_day) as u16;
        // No month has more than 31 days, and none but the last has fewer than 29.
        let at_least = (elapsed / 31) as u8 + 1;
        let is_next =
            at_least < self.months.count && elapsed >= self.months.days_before(at_least + 1);
        self.month(at_least + u8::from(is_next))
    }
}

impl YearMonth {
    #[inline]
    pub(super) fn first_day(self) -> i32 {
        self.year.first_day + i32::from(self.year.months.days_before(self.month))
    }

    #[inline]
    pub(super) fn days(self) -> u8 {
        let months = self.year.months;
        if self.month == months.count {
            return (self.year.days - months.days_before(self.month)) as u8;
        }
        months.short_month_days + (months.long_months >> (self.month - 1) & 1) as u8
    }

    #[inline]
    pub(super) fn code(self) -> MonthCode {
        self.year.months.code(self.month)
    }

    /// CalendarIntegersToISO
    #[inline]
    pub(super) fn iso_date(self, day: u8) -> IsoDate {
        IsoDate::from_epoch_days(self.first_day() + i32::from(day) - 1)
    }
}
