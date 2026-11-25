//! Maps an hour to a day period, such as "in the morning" or "at night". ICU4C: dayperiodrules.cpp

use crate::common::bytes::U16s;
use crate::common::maps::Map;
use crate::common::memory::{try_map_insert, try_push};
use crate::common::resource::ResourceValue;
use crate::common::slice_ext::{SliceExt, to_index};
use crate::common::uinvchar::append_invariant_chars;
use crate::common::uloc::uloc_get_parent;
use crate::common::umutex::OnceBox;
use crate::common::unicode::ures::URES_STRING;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::dtfmtsym::DAY_PERIOD_KEYS;

/// An index into `DAY_PERIOD_KEYS`. AM and PM are the two values after its end.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct DayPeriod(pub(crate) u8);

impl DayPeriod {
    const MIDNIGHT: Self = Self(0);
    pub(crate) const NOON: Self = Self(1);

    fn from_key(key: &[u8]) -> Option<Self> {
        let keys = DAY_PERIOD_KEYS.into_iter().chain([&b"am"[..], b"pm"]);
        (0..)
            .map(Self)
            .zip(keys)
            .find(|&(_, known)| known == key)
            .map(|(period, _)| period)
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct DayPeriodRules {
    has_noon: bool,
    day_period_for_hour: [Option<DayPeriod>; 24],
}

/// `None` for a locale whose rule set does not exist.
type RulesByLocale = Map<&'static [u8], Option<DayPeriodRules>>;

impl DayPeriodRules {
    /// Returns the rules of the locale, or of its nearest parent that is mapped to a rule set.
    #[inline(always)]
    pub(crate) fn get_instance(base_name: &[u8]) -> Result<Option<&'static Self>, UErrorCode> {
        static BY_LOCALE: OnceBox<Result<RulesByLocale, UErrorCode>> = OnceBox::new();
        let by_locale = BY_LOCALE.get_or_init_caching_err(load)?;
        let mut name = base_name;
        while !name.is_empty() {
            if let Some(rules) = by_locale.get(name) {
                return Ok(rules.as_ref());
            }
            name = uloc_get_parent(name);
        }
        Ok(by_locale.get(&b"root"[..]).and_then(Option::as_ref))
    }

    pub(crate) fn has_noon(&self) -> bool {
        self.has_noon
    }

    pub(crate) fn day_period_for_hour(&self, hour: i32) -> Option<DayPeriod> {
        self.day_period_for_hour.at(to_index(hour))
    }

    fn add(&mut self, period: DayPeriod, cutoffs: &Cutoffs) -> Result<(), UErrorCode> {
        let allowed_at = match period {
            DayPeriod::MIDNIGHT => 1,
            DayPeriod::NOON => 1 << 12,
            _ => 0,
        };
        if cutoffs.at & !allowed_at != 0 {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        self.has_noon |= period == DayPeriod::NOON && cutoffs.at != 0;

        let mut starts = cutoffs.from;
        while starts != 0 {
            let start = starts.trailing_zeros();
            starts &= starts - 1;
            // The search wraps around, and includes `start` itself only if `start` is 0.
            let (later, earlier) = (
                cutoffs.before >> start >> 1 << start << 1,
                cutoffs.before & ((1 << start.max(1)) - 1),
            );
            let limit = match (later, earlier) {
                (0, 0) => return Err(U_INVALID_FORMAT_ERROR),
                (0, limits) | (limits, _) => limits.trailing_zeros(),
            };
            for (hour, entry) in (0..).zip(&mut self.day_period_for_hour) {
                if if start <= limit {
                    start <= hour && hour < limit
                } else {
                    start <= hour || hour < limit
                } {
                    *entry = Some(period);
                }
            }
        }
        Ok(())
    }
}

/// What a parent bundle has replaces what its child has.
fn load() -> Result<RulesByLocale, UErrorCode> {
    let bundle = ures_open_direct(None, b"dayPeriods")?;
    bundle.get_by_key_with_fallback(b"rules")?;
    let (mut sets, mut locale_tables) = (Map::default(), Vec::new());
    ures_get_all_items_with_fallback(&bundle, b"", &mut |top: &ResourceValue| {
        let top = top.get_table()?;
        if let Some(rules) = top.get(b"rules") {
            sets = read_rules(&rules)?;
        }
        match top.get(b"locales") {
            Some(locales) => try_push(&mut locale_tables, locales.get_table()?),
            None => Ok(()),
        }
    })?;
    let (mut by_locale, mut name) = (RulesByLocale::default(), Vec::new());
    for (locale, set) in locale_tables.iter().flat_map(|locales| locales.iter()) {
        name.clear();
        append_invariant_chars(&mut name, set.get_string()?.iter())?;
        let rules = sets.get(&parse_set_number(&name)?).copied();
        try_map_insert(&mut by_locale, locale, rules)?;
    }
    Ok(by_locale)
}

fn read_rules(rules: &ResourceValue) -> Result<Map<i32, DayPeriodRules>, UErrorCode> {
    let mut sets = Map::<i32, DayPeriodRules>::default();
    for (name, periods) in rules.get_table()?.iter() {
        let number @ 0.. = parse_set_number(name)? else {
            return Err(U_INVALID_FORMAT_ERROR);
        };
        // "set7" and "set07" are the same set.
        let mut set = sets.get(&number).copied().unwrap_or_default();
        for (key, definition) in periods.get_table()?.iter() {
            let period = DayPeriod::from_key(key).ok_or(U_INVALID_FORMAT_ERROR)?;
            set.add(period, &Cutoffs::read(&definition)?)?;
        }
        if set.day_period_for_hour.contains(&None) {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        try_map_insert(&mut sets, number, set)?;
    }
    Ok(sets)
}

/// Parses "set12" as 12, up to a NUL. The number 0 is invalid.
fn parse_set_number(name: &[u8]) -> Result<i32, UErrorCode> {
    let digits = name.strip_prefix(b"set").ok_or(U_INVALID_FORMAT_ERROR)?;
    let add = |number: i32, digit: &u8| {
        let value = digit.is_ascii_digit().then(|| i32::from(digit - b'0'))?;
        Some(number.wrapping_mul(10).wrapping_add(value))
    };
    digits
        .iter()
        .take_while(|&&digit| digit != 0)
        .try_fold(0, add)
        .filter(|&number| number != 0)
        .ok_or(U_INVALID_FORMAT_ERROR)
}

/// Parses "6:00" and "06:00" as 6. The maximum is "24:00".
fn parse_hour(time: U16s) -> Option<u16> {
    let digit = |index| Some(time.get(index)?.wrapping_sub(0x30)).filter(|&digit| digit <= 9);
    let hour = match time.len() {
        4 => digit(0)?,
        5 => 10 * digit(0)? + digit(1)?,
        _ => return None,
    };
    (hour <= 24 && time.slice(time.len() - 3..).eq_bytes(b":00")).then_some(hour)
}

/// The definition of a period, with one bit for each of the hours 0 to 24.
#[derive(Default)]
struct Cutoffs {
    before: u32,
    from: u32,
    at: u32,
}

impl Cutoffs {
    fn read(definition: &ResourceValue) -> Result<Self, UErrorCode> {
        let mut cutoffs = Self::default();
        for (cutoff_type, hours) in definition.get_table()?.iter() {
            if hours.get_type() == URES_STRING {
                cutoffs.add(cutoff_type, &hours)?;
            } else {
                hours
                    .get_array()?
                    .iter()
                    .try_for_each(|hour| cutoffs.add(cutoff_type, &hour))?;
            }
        }
        Ok(cutoffs)
    }

    fn add(&mut self, cutoff_type: &[u8], time: &ResourceValue) -> Result<(), UErrorCode> {
        let hours = match cutoff_type {
            b"before" => &mut self.before,
            b"from" | b"after" => &mut self.from,
            b"at" => &mut self.at,
            _ => return Err(U_INVALID_FORMAT_ERROR),
        };
        *hours |= 1 << parse_hour(time.get_string()?).ok_or(U_INVALID_FORMAT_ERROR)?;
        Ok(())
    }
}
