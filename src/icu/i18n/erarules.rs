//! The eras of a calendar, from supplementalData. ICU4C: erarules.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::bytes::U16s;
use crate::common::memory::{try_push, try_resize};
use crate::common::slice_ext::{SliceExt, to_index};
use crate::common::uinvchar::invariant_prefix;
use crate::common::uresdata::strtol;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use std::ops::Range;

const MAX_CAL_ID_LENGTH: usize = 31;

type TypeName = ArrayVec<u8, MAX_CAL_ID_LENGTH>;

/// The year in 16 bits, then the 1-based month and the day in 8 bits each.
type Date = i32;
const NO_ERA: Date = 0;
/// 1 January -32768. The start of an era without `start`.
const EARLIEST: Date = i32::MIN | 0x0101;

fn encode_date(year: i16, month: i32, day: i32) -> Date {
    i32::from(year) << 16 | month << 8 | day
}

/// Returns the start date of an era, and false if the era is tentative.
fn read_era(era: &mut UResourceBundle) -> Result<(Date, bool), UErrorCode> {
    let (mut start, mut has_name) = (EARLIEST, true);
    while era.has_next() {
        let item = era.get_next_resource()?;
        match item.get_key() {
            Some(b"start") => {
                let fields = item.get_int_vector()?;
                if fields.len() != 3 {
                    return Err(U_INVALID_FORMAT_ERROR);
                }
                let (Ok(year), month @ 1..=12, day @ 1..=31) =
                    (i16::try_from(fields.at(0)), fields.at(1), fields.at(2))
                else {
                    return Err(U_INVALID_FORMAT_ERROR);
                };
                start = encode_date(year, month, day);
            }
            Some(b"named") => {
                has_name &= !item.get_string()?.slice_clamped(0..5).eq_bytes(b"false");
            }
            _ => {}
        }
    }
    Ok((start, has_name))
}

struct Eras {
    cal_type: TypeName,
    /// By era code, with `NO_ERA` in gaps. The last element is never `NO_ERA`.
    starts: Vec<Date>,
    min_era: usize,
}

impl Eras {
    /// Returns the eras of one calendar type, and the type that it inherits from.
    fn load(
        cal_type: TypeName,
        include_tentative_era: bool,
    ) -> Result<(Eras, Option<TypeName>), UErrorCode> {
        let mut calendar = ures_open_direct(None, b"supplementalData")?;
        calendar.descend(b"calendarData")?;
        calendar.descend(&cal_type)?;
        let mut eras = calendar.get_by_key(b"eras")?;
        let mut starts = Vec::new();
        let mut first_tentative = usize::MAX;
        while eras.has_next() {
            let mut era = eras.get_next_resource()?;
            let (number @ 0..=0x7fff, true) = strtol(era.get_key().unwrap_or_default()) else {
                return Err(U_INVALID_FORMAT_ERROR);
            };
            let number = number as usize;
            if number >= starts.len() {
                try_resize(&mut starts, number + 1, NO_ERA)?;
            }
            if starts.at(number) != NO_ERA {
                return Err(U_INVALID_FORMAT_ERROR);
            }
            let (start, has_name) = read_era(&mut era)?;
            starts.set(number, start);
            if !has_name {
                first_tentative = first_tentative.min(number);
            } else if number >= first_tentative {
                return Err(U_INVALID_FORMAT_ERROR);
            }
        }

        if !include_tentative_era {
            starts.truncate(first_tentative);
            while starts.pop_if(|start| *start == NO_ERA).is_some() {}
        }
        let eras = Eras {
            cal_type,
            min_era: starts.iter().take_while(|&&start| start == NO_ERA).count(),
            starts,
        };
        let inherited = calendar.get_string_by_key(b"inheritEras").ok();
        let to_name = |name| TypeName::from_iter_truncated(invariant_prefix(U16s::iter(name)));
        Ok((eras, inherited.map(to_name)))
    }

    /// Returns the era of a date, or `None` if the date is before all eras.
    #[inline]
    fn era_code(&self, date: Date) -> Option<usize> {
        let has_begun = |&start: &Date| start != NO_ERA && start <= date;
        let mut starts = self.starts.slice(self.min_era..).iter();
        // If the last era has no start, the eras are in reverse order.
        let found = if self.starts.last() == Some(&EARLIEST) {
            starts.position(has_begun)
        } else {
            starts.rposition(has_begun)
        };
        found.map(|index| self.min_era + index)
    }
}

pub(crate) struct EraRules {
    own: Eras,
    /// The chain of inherited eras, nearest first. They apply to dates before the eras of `own`.
    inherited: Vec<Eras>,
}

impl EraRules {
    pub(crate) fn load(
        cal_type: &[u8],
        include_tentative_era: bool,
    ) -> Result<EraRules, UErrorCode> {
        let (own, mut next) = Eras::load(TypeName::from_slice(cal_type), include_tentative_era)?;
        let mut rules = EraRules {
            own,
            inherited: Vec::new(),
        };
        while let Some(cal_type) = next {
            if rules.all().any(|eras| eras.cal_type == cal_type) {
                return Err(U_INVALID_FORMAT_ERROR);
            }
            let eras;
            (eras, next) = Eras::load(cal_type, include_tentative_era)?;
            try_push(&mut rules.inherited, eras)?;
        }
        Ok(rules)
    }

    fn all(&self) -> impl Iterator<Item = &Eras> {
        std::iter::once(&self.own).chain(&self.inherited)
    }

    /// Returns the greatest era code plus 1.
    pub(crate) fn code_count(&self) -> usize {
        self.own.starts.len()
    }

    /// Returns the calendar type and the types that it inherits from, each with its era codes.
    pub(crate) fn calendar_types(&self) -> impl Iterator<Item = (&[u8], Range<usize>)> {
        self.all()
            .map(|eras| (eras.cal_type.as_slice(), eras.min_era..eras.starts.len()))
    }

    fn get_min_era_code(&self) -> usize {
        self.inherited.last().unwrap_or(&self.own).min_era
    }

    /// Fails for an inherited code that falls into a gap of nearer codes.
    pub(crate) fn get_start_year(&self, era_code: i32) -> Result<i32, UErrorCode> {
        let era_code = to_index(era_code);
        let eras = self
            .all()
            .find(|eras| era_code >= eras.min_era || era_code < self.get_min_era_code());
        match eras.and_then(|eras| eras.starts.get(era_code)) {
            None | Some(&NO_ERA) => Err(U_ILLEGAL_ARGUMENT_ERROR),
            Some(&EARLIEST) => Ok(-1),
            Some(start) => Ok(start >> 16),
        }
    }

    /// Returns the era of a Gregorian date. `month` is 1-based.
    pub(crate) fn get_era_code(&self, year: i32, month: i32, day: i32) -> i32 {
        let date = match i16::try_from(year) {
            Ok(year) => encode_date(year, month, day),
            Err(_) if year.is_negative() => EARLIEST,
            Err(_) => Date::MAX,
        };
        self.all()
            .find_map(|eras| eras.era_code(date))
            .unwrap_or_else(|| self.get_min_era_code()) as i32
    }
}
