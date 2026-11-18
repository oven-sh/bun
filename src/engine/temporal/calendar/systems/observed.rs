use core::ffi::CStr;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_engine_date::MS_PER_DAY;
use bun_icu::calendar::{Calendar, Field};

use crate::calendar::year::{Months, Year};
use crate::{Error, Result};

const SHORT_MONTH_DAYS: u8 = 29;
const LONG_MONTHS_SHIFT: u32 = 8;
const LEAP_MONTH_SHIFT: u32 = LONG_MONTHS_SHIFT + 16;

/// What ICU says about `N` years in a row, each asked for once. It is asked about a day of the year that is not among
/// the first month's and is fewer than 256 days into it.
pub(super) struct Observations<const N: usize> {
    locale: &'static CStr,
    first_year: i32,
    /// Zero, or the day of the year of the day asked about, below the fields of `Months`.
    entries: [AtomicU32; N],
}

impl<const N: usize> Observations<N> {
    pub(super) const fn new(locale: &'static CStr, first_year: i32) -> Self {
        Observations {
            locale,
            first_year,
            entries: [const { AtomicU32::new(0) }; N],
        }
    }

    #[inline]
    pub(super) fn has_year(&self, number: i64) -> bool {
        (0..N as i64).contains(&(number - i64::from(self.first_year)))
    }

    #[inline]
    pub(super) fn first_day(&self, number: i32, day_in_year: i32) -> Result<i32> {
        let entry = self.entry(number, |observer| {
            observer.day_of_year(day_in_year).map(u32::from)
        })?;
        Ok(day_in_year + 1 - entry as i32)
    }

    #[inline]
    pub(super) fn lunar_year(&self, number: i32, day_in_year: i32) -> Result<Year> {
        let entry = self.entry(number, |observer| observer.lunar_year(day_in_year))?;
        let leap_month = (entry >> LEAP_MONTH_SHIFT) as u8;
        let months = Months {
            count: 12 + u8::from(leap_month != 0),
            leap_month,
            short_month_days: SHORT_MONTH_DAYS,
            long_months: (entry >> LONG_MONTHS_SHIFT) as u16,
        };
        Ok(Year {
            number,
            first_day: day_in_year + 1 - i32::from(entry as u8),
            days: months.days_before(months.count + 1),
            months,
        })
    }

    #[inline]
    fn entry(
        &self,
        number: i32,
        observe: impl FnOnce(&mut Observer) -> Option<u32>,
    ) -> Result<u32> {
        let slot = (self.entries)
            .get((number - self.first_year) as usize)
            .ok_or(Error::CalendarDataUnavailable)?;
        // Every thread that fills a slot writes the same value.
        match slot.load(Ordering::Relaxed) {
            0 => fill(slot, self.locale, observe),
            entry => Ok(entry),
        }
    }
}

#[cold]
fn fill(
    slot: &AtomicU32,
    locale: &CStr,
    observe: impl FnOnce(&mut Observer) -> Option<u32>,
) -> Result<u32> {
    const UTC: [u16; 3] = [b'U' as u16, b'T' as u16, b'C' as u16];
    let entry = Calendar::open(&UTC, locale)
        .ok()
        .and_then(|calendar| observe(&mut Observer(calendar)))
        .ok_or(Error::CalendarDataUnavailable)?;
    slot.store(entry, Ordering::Relaxed);
    Ok(entry)
}

struct Observer(Calendar);

const LUNAR_FIELDS: [Field; 3] = [Field::DayOfMonth, Field::Month, Field::IsLeapMonth];

impl Observer {
    fn read<const N: usize>(&mut self, epoch_day: i32, fields: [Field; N]) -> Option<[i32; N]> {
        let noon = (f64::from(epoch_day) + 0.5) * MS_PER_DAY;
        self.0.set_millis(noon).ok()?;
        let mut values = [0; N];
        for (value, field) in values.iter_mut().zip(fields) {
            *value = self.0.get(field).ok()?;
        }
        Some(values)
    }

    fn day_of_year(&mut self, epoch_day: i32) -> Option<u8> {
        let [day_of_year] = self.read(epoch_day, [Field::DayOfYear])?;
        u8::try_from(day_of_year).ok().filter(|&day| day != 0)
    }

    /// From month to month, so that the year starts where its first month does.
    fn lunar_new_year(&mut self, mut day_in_year: i32) -> Option<i32> {
        for _ in 0..13 {
            let [day, month, is_leap_month] = self.read(day_in_year, LUNAR_FIELDS)?;
            let start = day_in_year + 1 - day;
            if month == 0 && is_leap_month == 0 {
                return Some(start);
            }
            day_in_year = start - 15;
        }
        None
    }

    /// Looks at the middle of each month, far from the new moons that bound it.
    fn lunar_year(&mut self, day_in_year: i32) -> Option<u32> {
        let mut start = self.lunar_new_year(day_in_year)?;
        let day_of_year = u8::try_from(day_in_year + 1 - start).ok()?;
        let (mut long_months, mut leap_month) = (0u32, 0u32);
        for elapsed in 1..=13 {
            let middle = start + 45;
            let [day, month, is_leap_month] = self.read(middle, LUNAR_FIELDS)?;
            let next = middle + 1 - day;
            match next - start - i32::from(SHORT_MONTH_DAYS) {
                0 => {}
                1 => long_months |= 1 << (elapsed - 1),
                _ => return None,
            }
            if is_leap_month != 0 {
                leap_month = elapsed + 1;
            } else if month == 0 {
                let entry = leap_month << LEAP_MONTH_SHIFT
                    | long_months << LONG_MONTHS_SHIFT
                    | u32::from(day_of_year);
                return (elapsed == 12 + u32::from(leap_month != 0)).then_some(entry);
            }
            start = next;
        }
        None
    }
}
