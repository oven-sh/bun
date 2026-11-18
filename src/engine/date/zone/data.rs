//! The IANA time zone database as ICU compiles it: the bundle `zoneinfo64`.

use core::cmp::Ordering;
use core::ffi::CStr;

use bun_engine_text::Text;
use bun_icu::resource_bundle::ResourceBundle;
use bun_icu::{CText, Error};

use super::annual::{AnnualRule, YearlyMoment};
use super::rules::{Offset, SECONDS_PER_DAY, Transition, ZoneRules};
use crate::civil::days_from_civil;

fn section(key: &CStr) -> bun_icu::Result<ResourceBundle> {
    ResourceBundle::open_direct(c"zoneinfo64")?.by_key(key)
}

/// An array of strings, in the order of their code units.
pub(super) fn names() -> bun_icu::Result<ResourceBundle> {
    section(c"Names")
}

/// In `names`. Case matters.
pub(super) fn position_of(name: Text<'_>) -> Option<usize> {
    let names = names().ok()?;
    let mut range = 0..names.item_count();
    while !range.is_empty() {
        let middle = range.start.midpoint(range.end);
        match Text::Utf16(names.string_at(middle).ok()?).cmp(&name) {
            Ordering::Less => range.start = middle + 1,
            Ordering::Equal => return Some(middle),
            Ordering::Greater => range.end = middle,
        }
    }
    None
}

/// The position in `names` of the zone whose rules the one at `position` has.
pub(super) fn link_target(position: usize) -> usize {
    section(c"Zones")
        .and_then(|zones| zones.by_index(position)?.int())
        .map_or(position, |target| target.unsigned_abs() as usize)
}

/// Of a zone that is not a link. `None` if the data is not well formed.
#[cold]
pub(super) fn rules(position: usize) -> Option<ZoneRules> {
    let zone = section(c"Zones").ok()?.by_index(position).ok()?;

    let offsets = zone.by_key(c"typeOffsets").ok()?;
    let (offsets, _) = offsets.int_vector().ok()?.as_chunks();
    let offset_of_type = |index: u8| {
        let &[standard, savings] = offsets.get(usize::from(index))?;
        offset(standard, savings)
    };

    let wide = |&[high, low]: &[i32; 2]| i64::from(high) << 32 | i64::from(low as u32);
    let mut times = Vec::new();
    if let Some(early) = optional(&zone, c"transPre32")? {
        times.extend(early.int_vector().ok()?.as_chunks().0.iter().map(wide));
    }
    if let Some(middle) = optional(&zone, c"trans")? {
        times.extend(middle.int_vector().ok()?.iter().map(|&it| i64::from(it)));
    }
    if let Some(late) = optional(&zone, c"transPost32")? {
        times.extend(late.int_vector().ok()?.as_chunks().0.iter().map(wide));
    }
    if !times.is_sorted() || times.iter().any(|time| time.unsigned_abs() > 1 << 62) {
        return None;
    }

    let mut history = Vec::with_capacity(times.len());
    if let Some(types) = optional(&zone, c"typeMap")? {
        for (&time, &index) in times.iter().zip(types.binary().ok()?) {
            let offset = offset_of_type(index)?;
            history.push(Transition { time, offset });
        }
    }
    let annual = match optional(&zone, c"finalRule")? {
        Some(name) => Some(annual_rule(&zone, name.string().ok()?)?),
        None => None,
    };
    Some(ZoneRules {
        initial: offset_of_type(0)?,
        history,
        annual,
    })
}

fn optional(table: &ResourceBundle, key: &CStr) -> Option<Option<ResourceBundle>> {
    match table.by_key(key) {
        Ok(item) => Some(Some(item)),
        Err(Error::MISSING_RESOURCE) => Some(None),
        Err(_) => None,
    }
}

fn offset(standard: i32, savings: i32) -> Option<Offset> {
    let seconds = standard.checked_add(savings)?;
    (i64::from(seconds).abs() < SECONDS_PER_DAY).then_some(Offset {
        seconds,
        is_daylight: savings != 0,
    })
}

fn annual_rule(zone: &ResourceBundle, name: &[u16]) -> Option<AnnualRule> {
    let standard = zone.by_key(c"finalRaw").ok()?.int().ok()?;
    let year = zone.by_key(c"finalYear").ok()?.int().ok()?;
    let name: Vec<u8> = name.iter().map(|&unit| unit as u8).collect();
    let rule = section(c"Rules")
        .ok()?
        .by_key(&CText::new(&name).ok()?)
        .ok()?;
    let (&[start, end], &[savings]) = rule.int_vector().ok()?.as_chunks() else {
        return None;
    };
    if savings == 0 {
        return None;
    }
    Some(AnnualRule::new(
        days_from_civil(year, 1, 1) * SECONDS_PER_DAY,
        offset(standard, 0)?,
        offset(standard, savings)?,
        moment(start, standard, 0)?,
        moment(end, standard, savings)?,
    ))
}

/// `savings` is what the clock on the wall is ahead of standard time until the moment.
fn moment(encoded: [i32; 5], standard: i32, savings: i32) -> Option<YearlyMoment> {
    let [month @ 0..=11, day, week_day, time @ 0..=86_400, clock] = encoded else {
        return None;
    };
    let days_later = match (day, week_day) {
        // On the day, or on the first such week day from it on.
        (1..=31, -7..=0) => 0,
        // On the last such week day up to it.
        (-31..=-1, -7..=-1) => -6,
        _ => return None,
    };
    Some(YearlyMoment {
        month: month as u8 + 1,
        day: day.unsigned_abs() as u8,
        days_later,
        week_day: (week_day.unsigned_abs() as u8).checked_sub(1),
        seconds: match clock {
            0 => time.checked_sub(savings)?,
            1 => time,
            2 => time + standard,
            _ => return None,
        },
    })
}
