//! A zone of the tz database. It borrows its arrays from zoneinfo64 and caches nothing. ICU4C: olsontz.cpp

use crate::common::bytes::I32s;
use crate::common::putil::uprv_get_utc_time;
use crate::common::resource::{ResourceTable, ResourceValue};
use crate::common::slice_ext::SliceExt;
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, U_MISSING_RESOURCE_ERROR, UErrorCode};
use crate::i18n::gregoimp::{
    U_MILLIS_PER_DAY, U_MILLIS_PER_HOUR, U_MILLIS_PER_SECOND, UDate, grego,
};
use crate::i18n::simpletz::SimpleRules;
use crate::i18n::timezone::{LocalOptions, TimeZone};
use crate::i18n::tzrule::{TimeZoneRule, TimeZoneTransition};
use crate::i18n::zonemeta;
use std::ops::Range;

const SECONDS_PER_DAY: i64 = 24 * 60 * 60;
const MAX_LENGTH: usize = i16::MAX as usize;

type Word = [u8; 4];
type Pair = [Word; 2];

fn words(numbers: I32s<'static>) -> &'static [Word] {
    numbers.as_bytes().as_chunks().0
}

fn pairs(numbers: I32s<'static>) -> &'static [Pair] {
    words(numbers).as_chunks().0
}

fn millis(seconds: i32) -> i32 {
    seconds.wrapping_mul(U_MILLIS_PER_SECOND)
}

fn part(zone: &ResourceTable, key: &[u8]) -> Result<ResourceValue, UErrorCode> {
    zone.get(key).ok_or(U_MISSING_RESOURCE_ERROR)
}

fn int_vector(zone: &ResourceTable, key: &[u8]) -> Result<I32s<'static>, UErrorCode> {
    part(zone, key)?.get_int_vector()
}

struct History {
    /// The times in seconds. Indexes run through the three slices in this order. A pair has the high word first.
    pre32: &'static [Pair],
    times32: &'static [Word],
    post32: &'static [Pair],
    /// The raw offset and the DST savings of each type, in seconds. Type 0 applies before the first transition.
    type_offsets: &'static [Pair],
    /// The type of each transition. Its length is the number of transitions.
    type_map: &'static [u8],
}

impl History {
    fn new(zone: &ResourceTable) -> Result<Self, UErrorCode> {
        let times = |key: &[u8], step| match int_vector(zone, key) {
            Ok(times) if times.len() <= MAX_LENGTH && times.len().is_multiple_of(step) => Ok(times),
            Ok(_) => Err(U_INVALID_FORMAT_ERROR),
            Err(U_MISSING_RESOURCE_ERROR) => Ok(I32s::EMPTY),
            Err(code) => Err(code),
        };
        let (pre32, times32) = (pairs(times(b"transPre32", 2)?), words(times(b"trans", 1)?));
        let post32 = pairs(times(b"transPost32", 2)?);
        // A zone with too many transitions has none.
        let total = pre32.len() + times32.len() + post32.len();
        let count = if total <= MAX_LENGTH { total } else { 0 };
        let type_offsets = int_vector(zone, b"typeOffsets")?;
        if !(2..MAX_LENGTH).contains(&type_offsets.len()) || !type_offsets.len().is_multiple_of(2) {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        let mut type_map: &[u8] = &[];
        if count > 0 {
            type_map = part(zone, b"typeMap")?.get_binary()?;
            if type_map.len() != count {
                return Err(U_INVALID_FORMAT_ERROR);
            }
        }
        Ok(Self {
            pre32,
            times32,
            post32,
            type_offsets: pairs(type_offsets),
            type_map,
        })
    }

    fn count(&self) -> usize {
        self.type_map.len()
    }

    #[inline(always)]
    fn seconds(&self, index: usize) -> i64 {
        match self.times32.get(index.wrapping_sub(self.pre32.len())) {
            Some(&time) => i32::from_ne_bytes(time).into(),
            None => self.seconds64(index),
        }
    }

    fn seconds64(&self, index: usize) -> i64 {
        let [high, low] = match self.pre32.get(index) {
            Some(&time) => time,
            None => self
                .post32
                .at(index.wrapping_sub(self.pre32.len() + self.times32.len())),
        };
        i64::from(i32::from_ne_bytes(high)) << 32 | i64::from(u32::from_ne_bytes(low))
    }

    fn time(&self, index: usize) -> UDate {
        self.seconds(index) as f64 * f64::from(U_MILLIS_PER_SECOND)
    }

    /// Returns the last index before `end` for whose time in seconds `predicate` holds. The times need not be sorted.
    fn rfind(&self, end: usize, predicate: impl Fn(i64) -> bool) -> Option<usize> {
        let (start32, end32) = (
            end.min(self.pre32.len()),
            end.min(self.pre32.len() + self.times32.len()),
        );
        let find64 =
            |mut range: Range<usize>| range.rfind(|&index| predicate(self.seconds64(index)));
        let times32 = self.times32.slice(..end32 - start32);
        let find32 = || {
            (0..times32.len())
                .rfind(|&index| predicate(i32::from_ne_bytes(times32.at(index)).into()))
        };
        find64(end32..end)
            .or_else(|| find32().map(|index| start32 + index))
            .or_else(|| find64(0..start32))
    }

    /// Returns the raw offset and the DST savings, in seconds, after the first `passed` transitions.
    fn offsets_after(&self, passed: usize) -> (i32, i32) {
        let type_index = self
            .type_map
            .get(passed.wrapping_sub(1))
            .map_or(0, |&it| usize::from(it));
        let [raw, dst] = self
            .type_offsets
            .get(type_index)
            .copied()
            .unwrap_or_default();
        (i32::from_ne_bytes(raw), i32::from_ne_bytes(dst))
    }

    fn rule_after(&self, passed: usize) -> TimeZoneRule {
        let (raw, dst) = self.offsets_after(passed);
        TimeZoneRule {
            raw_offset: millis(raw),
            dst_savings: millis(dst),
        }
    }

    /// Returns the offset in seconds that converts the time of a transition to wall time.
    fn wall_offset(&self, index: usize, options: LocalOptions) -> i32 {
        let ((raw_before, dst_before), (raw_after, dst_after)) =
            (self.offsets_after(index), self.offsets_after(index + 1));
        let (before, after) = (
            raw_before.wrapping_add(dst_before),
            raw_after.wrapping_add(dst_after),
        );
        let is_gap = after.wrapping_sub(before) >= 0;
        if options.picks_latter(is_gap) == is_gap {
            before
        } else {
            after
        }
    }

    /// Returns the index of the last transition that has taken effect at the wall time `seconds`.
    fn last_at_wall_time(&self, seconds: f64, options: LocalOptions) -> Option<usize> {
        let mut index = self.count();
        loop {
            index = self.rfind(index, |time| {
                seconds >= time.saturating_sub(SECONDS_PER_DAY) as f64
            })?;
            let mut time = self.seconds(index);
            // False only if the difference wraps.
            if seconds >= time.wrapping_sub(SECONDS_PER_DAY) as f64 {
                time = time.wrapping_add(self.wall_offset(index, options).into());
            }
            if seconds >= time as f64 {
                return Some(index);
            }
        }
    }

    /// `date` is a wall time if `local` is `Some`.
    fn offsets_at(&self, date: UDate, local: Option<LocalOptions>) -> TimeZoneRule {
        let seconds = date / f64::from(U_MILLIS_PER_SECOND);
        let last = match local {
            _ if self.count() == 0 => None,
            Some(options) => self.last_at_wall_time(seconds, options),
            None if seconds < self.seconds(0) as f64 => None,
            None => self.rfind(self.count(), |time| seconds >= time as f64),
        };
        self.rule_after(last.map_or(0, |last| last + 1))
    }

    /// Returns the index of the first transition to a type other than 0.
    fn first_index(&self) -> usize {
        self.type_map
            .iter()
            .take_while(|&&type_index| type_index == 0)
            .count()
    }

    fn transition(&self, index: usize) -> TimeZoneTransition {
        TimeZoneTransition {
            time: self.time(index),
            from: self.rule_after(index),
            to: self.rule_after(index + 1),
        }
    }

    /// The data can contain transitions that change nothing.
    fn changes_offsets(&self, index: usize) -> bool {
        self.rule_after(index) != self.rule_after(index + 1)
    }
}

/// The rules that apply from the start of `start_year` on.
struct FinalZone {
    rules: SimpleRules,
    start_year: i32,
    start: UDate,
}

impl FinalZone {
    fn new(zone: &ResourceTable) -> Result<Option<Self>, UErrorCode> {
        let find = || {
            let rule = part(zone, b"finalRule")?.get_string()?;
            Ok((
                rule,
                part(zone, b"finalRaw")?.get_int()?,
                part(zone, b"finalYear")?.get_int()?,
            ))
        };
        let (rule, raw, start_year) = match find() {
            Err(U_MISSING_RESOURCE_ERROR) => return Ok(None),
            found => found?,
        };
        let numbers = TimeZone::load_rule(rule)
            .ok()
            .filter(|numbers| numbers.len() == 11);
        let numbers = numbers.ok_or(U_INVALID_FORMAT_ERROR)?;
        // No overflow: a resource integer has 28 bits.
        let start = (grego::fields_to_day(start_year, 0, 1) * i64::from(U_MILLIS_PER_DAY)) as f64;
        SimpleRules::new(millis(raw), numbers).map(|rules| {
            Some(Self {
                rules,
                start_year,
                start,
            })
        })
    }

    /// Returns the time and the target rule of the first transition.
    fn first_start(&self) -> Option<(UDate, TimeZoneRule)> {
        let Some(rules) = self.rules.annual_rules(self.start_year) else {
            return Some((
                self.start,
                TimeZoneRule::standard_time(self.rules.raw_offset),
            ));
        };
        rules
            .next_transition(self.start)
            .map(|transition| (transition.time, transition.to))
    }
}

pub(crate) struct OlsonTimeZone {
    pub(crate) canonical_id: &'static [u16],
    history: History,
    final_zone: Option<FinalZone>,
}

impl OlsonTimeZone {
    pub(crate) fn new(zone: &ResourceTable, id: &[u16]) -> Result<Self, UErrorCode> {
        Ok(Self {
            history: History::new(zone)?,
            final_zone: FinalZone::new(zone)?,
            canonical_id: zonemeta::get_canonical_cldr_id(id)?,
        })
    }

    fn final_rules_at(&self, date: UDate) -> Option<&SimpleRules> {
        self.final_zone
            .as_ref()
            .filter(|zone| date >= zone.start)
            .map(|zone| &zone.rules)
    }

    pub(crate) fn get_offset(&self, date: UDate, local: bool) -> Result<TimeZoneRule, UErrorCode> {
        match self.final_rules_at(date) {
            Some(rules) => rules.get_offset(date, local),
            None => Ok(self
                .history
                .offsets_at(date, local.then_some(LocalOptions::DEFAULT))),
        }
    }

    pub(crate) fn get_offset_from_local(
        &self,
        date: UDate,
        options: LocalOptions,
    ) -> Result<TimeZoneRule, UErrorCode> {
        match self.final_rules_at(date) {
            Some(rules) => rules.get_offset_from_local(date, options),
            None => Ok(self.history.offsets_at(date, Some(options))),
        }
    }

    /// Returns the raw offset at the current time.
    pub(crate) fn get_raw_offset(&self) -> i32 {
        let now = uprv_get_utc_time();
        self.final_rules_at(now).map_or_else(
            || self.history.offsets_at(now, None).raw_offset,
            |rules| rules.raw_offset,
        )
    }

    /// Returns whether DST is observed at any time in the current year.
    fn use_daylight_time(&self) -> bool {
        let now = uprv_get_utc_time();
        if let Some(rules) = self.final_rules_at(now) {
            return rules.use_daylight_time();
        }
        let Ok(year) = grego::time_to_year(now) else {
            return false;
        };
        let start_of = |year| grego::fields_to_day(year, 0, 1) * SECONDS_PER_DAY;
        let (start, limit) = (start_of(year), start_of(year + 1));
        let is_daylight_after = |passed| self.history.offsets_after(passed).1 != 0;
        // The times after `last` are before this year and meet neither condition.
        let last = self
            .history
            .rfind(self.history.count(), |time| time >= start);
        for index in 0..last.map_or(0, |last| last + 1) {
            let time = self.history.seconds(index);
            if time >= limit {
                break;
            }
            if time >= start
                && (is_daylight_after(index + 1) || (time > start && is_daylight_after(index)))
            {
                return true;
            }
        }
        false
    }

    /// Returns 0 if DST is not observed in the current year.
    pub(crate) fn current_dst_savings(&self) -> i32 {
        match &self.final_zone {
            _ if !self.use_daylight_time() => 0,
            Some(zone) => zone.rules.dst_savings,
            None => U_MILLIS_PER_HOUR,
        }
    }

    fn first_final_transition(&self, (time, to): (UDate, TimeZoneRule)) -> TimeZoneTransition {
        TimeZoneTransition {
            time,
            from: self.history.rule_after(self.history.count()),
            to,
        }
    }

    /// Returns the final zone, if any, with its first start. `None` if it never starts: the zone has no transitions.
    fn final_start(&self) -> Option<Option<(&FinalZone, (UDate, TimeZoneRule))>> {
        match &self.final_zone {
            Some(zone) => zone.first_start().map(|first| Some((zone, first))),
            None => Some(None),
        }
    }

    pub(crate) fn get_next_transition(&self, base: UDate) -> Option<TimeZoneTransition> {
        let (history, final_start) = (&self.history, self.final_start()?);
        if let Some((zone, start)) = final_start
            && base >= start.0
        {
            return zone
                .rules
                .annual_rules(zone.start_year)?
                .next_transition(base);
        }
        let (first, count) = (history.first_index(), history.count());
        let Some(past) = (first..count).rfind(|&index| base >= history.time(index)) else {
            return (first < count).then(|| history.transition(first));
        };
        match (past + 1..count).find(|&index| history.changes_offsets(index)) {
            Some(next) => Some(history.transition(next)),
            None => final_start.map(|(_, start)| self.first_final_transition(start)),
        }
    }

    pub(crate) fn get_previous_transition(
        &self,
        base: UDate,
        inclusive: bool,
    ) -> Option<TimeZoneTransition> {
        let history = &self.history;
        if let Some((zone, start)) = self.final_start()? {
            if inclusive && base == start.0 {
                return Some(self.first_final_transition(start));
            }
            if base > start.0 {
                return match zone.rules.annual_rules(zone.start_year) {
                    Some(rules) => rules.previous_transition(base, inclusive),
                    None => Some(self.first_final_transition(start)),
                };
            }
        }
        let first = history.first_index();
        let is_previous = |&index: &usize| {
            let time = history.time(index);
            (base > time || (inclusive && base == time))
                && (index == first || history.changes_offsets(index))
        };
        (first..history.count())
            .rfind(is_previous)
            .map(|index| history.transition(index))
    }
}
