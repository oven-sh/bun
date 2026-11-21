//! The eras of a calendar, from supplementalData. ICU4C: erarules.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::memory::try_resize;
use crate::common::slice_ext::SliceExt;
use crate::common::uinvchar::invariant_prefix;
use crate::common::uresdata::strtol;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use std::ops::Range;

type TypeName = ArrayVec<u8, 31>;

/// The year in 16 bits, then the 1-based month and the day in 8 bits each.
type Date = i32;
const NO_ERA: Date = 0;
/// 1 January -32768. The start of an era without `start`.
const EARLIEST: Date = i32::MIN | 0x0101;

fn encode_date(year: i16, month: i32, day: i32) -> Date {
    i32::from(year) << 16 | month << 8 | day
}

fn read_start(era: &UResourceBundle) -> Result<Date, UErrorCode> {
    let fields = match era.get_by_key(b"start") {
        Err(U_MISSING_RESOURCE_ERROR) => return Ok(EARLIEST),
        start => start?.get_int_vector()?,
    };
    if fields.len() != 3 {
        return Err(U_INVALID_FORMAT_ERROR);
    }
    let (Ok(year), month @ 1..=12, day @ 1..=31) =
        (i16::try_from(fields.at(0)), fields.at(1), fields.at(2))
    else {
        return Err(U_INVALID_FORMAT_ERROR);
    };
    Ok(encode_date(year, month, day))
}

fn open_calendar(cal_type: &[u8]) -> Result<UResourceBundle, UErrorCode> {
    let mut calendar = ures_open_direct(None, b"supplementalData")?;
    _ = calendar.descend(b"calendarData")?;
    _ = calendar.descend(cal_type)?;
    Ok(calendar)
}

/// Returns the start dates by era code, with `NO_ERA` in gaps.
fn read_starts(calendar: &UResourceBundle) -> Result<Vec<Date>, UErrorCode> {
    let mut eras = calendar.get_by_key(b"eras")?;
    let mut starts = Vec::new();
    while eras.has_next() {
        let era = eras.get_next_resource()?;
        let (number @ 0..=0x7fff, true) = strtol(era.get_key().unwrap_or_default()) else {
            return Err(U_INVALID_FORMAT_ERROR);
        };
        let number = number as usize;
        if number >= starts.len() {
            try_resize(&mut starts, number + 1, NO_ERA)?;
        }
        starts.set(number, read_start(&era)?);
    }
    Ok(starts)
}

pub(crate) struct EraRules {
    cal_type: TypeName,
    starts: Vec<Date>,
    min_era: usize,
    /// The type whose eras apply to earlier dates, and the number of its era codes.
    inherited: Option<(TypeName, usize)>,
}

impl EraRules {
    pub(crate) fn load(cal_type: &[u8]) -> Result<EraRules, UErrorCode> {
        let calendar = open_calendar(cal_type)?;
        let starts = read_starts(&calendar)?;
        let mut inherited = None;
        if let Ok(name) = calendar.get_string_by_key(b"inheritEras") {
            let name = TypeName::from_iter_truncated(invariant_prefix(name.iter()));
            let count = read_starts(&open_calendar(&name)?)?.len();
            inherited = Some((name, count));
        }
        Ok(EraRules {
            cal_type: TypeName::from_slice(cal_type),
            min_era: starts.iter().take_while(|&&start| start == NO_ERA).count(),
            starts,
            inherited,
        })
    }

    /// Returns the greatest era code plus 1.
    pub(crate) fn code_count(&self) -> usize {
        self.starts.len()
    }

    /// Returns the calendar type and the type that it inherits from, each with its era codes.
    pub(crate) fn calendar_types(&self) -> impl Iterator<Item = (&[u8], Range<usize>)> {
        let inherited = self.inherited.iter();
        std::iter::once((self.cal_type.as_slice(), self.min_era..self.code_count()))
            .chain(inherited.map(|(name, count)| (name.as_slice(), 0..*count)))
    }

    /// Returns the code and the first year of the era of a date, or `None` before the first era. `month` is 1-based.
    pub(crate) fn era_at(&self, year: i32, month: i32, day: i32) -> Option<(i32, i32)> {
        let date = match i16::try_from(year) {
            Ok(year) => encode_date(year, month, day),
            Err(_) if year.is_negative() => EARLIEST,
            Err(_) => Date::MAX,
        };
        let era = self.min_era
            + self
                .starts
                .slice(self.min_era..)
                .iter()
                .rposition(|&start| start != NO_ERA && start <= date)?;
        Some((era as i32, self.starts.at(era) >> 16))
    }
}
