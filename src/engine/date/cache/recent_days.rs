use core::cell::Cell;

use crate::fields::DateFields;
use crate::time_value::DAY;

/// A day that has one offset from its start to its end.
#[derive(Clone, Copy)]
pub(super) struct Day {
    pub(super) midnight: i64,
    pub(super) fields: DateFields,
}

/// The days that were asked about last.
pub(super) struct RecentDays([Cell<Day>; RecentDays::SLOTS]);

impl RecentDays {
    const SLOTS: usize = 16;
    /// The times from one multiple of two to this power up to the next share a slot. A day is in no more than three.
    const SHIFT: u32 = 26;

    pub(super) fn new() -> RecentDays {
        RecentDays(core::array::from_fn(|slot| Cell::new(Self::vacant(slot))))
    }

    /// A day whose times all belong in other slots.
    fn vacant(slot: usize) -> Day {
        Day {
            midnight: (slot as i64 + 1) << Self::SHIFT,
            fields: DateFields::EPOCH,
        }
    }

    pub(super) fn clear(&self) {
        for (slot, day) in self.0.iter().enumerate() {
            day.set(Self::vacant(slot));
        }
    }

    #[inline(always)]
    fn slot(&self, time: i64) -> &Cell<Day> {
        &self.0[(time >> Self::SHIFT) as usize % Self::SLOTS]
    }

    #[inline(always)]
    pub(super) fn find(&self, time: i64) -> Option<DateFields> {
        let day = self.slot(time).get();
        let since_midnight = time.wrapping_sub(day.midnight) as u64;
        (since_midnight < DAY as u64).then(|| day.fields.later(since_midnight as u32))
    }

    /// `time` is on `day`.
    #[inline(always)]
    pub(super) fn add(&self, time: i64, day: Day) {
        self.slot(time).set(day);
    }
}
