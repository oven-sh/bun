//! Maps an hour to a day period, such as "in the morning" or "at night". ICU4C: dayperiodrules.cpp

use crate::common::bytes::U16s;
use crate::common::maps::Map;
use crate::common::memory::try_map_insert;
use crate::common::resource::{ResourceTable, ResourceValue};
use crate::common::slice_ext::{SliceExt, to_index};
use crate::common::uloc::uloc_get_parent;
use crate::common::umutex::OnceBox;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::dtfmtsym::DAY_PERIOD_KEYS;
use crate::i18n::timezone::invariant_c_string;

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

type RulesByName = Map<&'static [u8], DayPeriodRules>;

impl DayPeriodRules {
    /// Returns the rules of the locale, or of its nearest parent that has rules.
    pub(crate) fn get_instance(base_name: &[u8]) -> Result<&'static Self, UErrorCode> {
        static BY_LOCALE: OnceBox<Result<RulesByName, UErrorCode>> = OnceBox::new();
        let by_locale = BY_LOCALE.get_or_init_caching_err(load)?;
        let mut name = base_name;
        while !name.is_empty() {
            if let Some(rules) = by_locale.get(name) {
                return Ok(rules);
            }
            name = uloc_get_parent(name);
        }
        by_locale.get(&b"root"[..]).ok_or(U_MISSING_RESOURCE_ERROR)
    }

    pub(crate) fn has_noon(&self) -> bool {
        self.has_noon
    }

    pub(crate) fn day_period_for_hour(&self, hour: i32) -> Option<DayPeriod> {
        self.day_period_for_hour.at(to_index(hour))
    }

    fn read(periods: &ResourceValue) -> Result<Self, UErrorCode> {
        let mut rules = Self::default();
        for (key, definition) in periods.get_table()?.iter() {
            let period = DayPeriod::from_key(key).ok_or(U_INVALID_FORMAT_ERROR)?;
            rules.add(period, &definition.get_table()?)?;
        }
        if rules.day_period_for_hour.contains(&None) {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        Ok(rules)
    }

    /// A period is either `at` an hour, or lasts `from` an hour until `before` another, which may be past midnight.
    fn add(&mut self, period: DayPeriod, definition: &ResourceTable) -> Result<(), UErrorCode> {
        let hour = |key: &[u8]| parse_hour(definition.get(key)?.get_string().ok()?);
        match (period, hour(b"at"), hour(b"from"), hour(b"before")) {
            (DayPeriod::MIDNIGHT, Some(0), None, None) => {}
            (DayPeriod::NOON, Some(12), None, None) => self.has_noon = true,
            (_, None, Some(start), Some(limit)) => {
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
            _ => return Err(U_INVALID_FORMAT_ERROR),
        }
        Ok(())
    }
}

fn load() -> Result<RulesByName, UErrorCode> {
    let bundle = ures_open_direct(None, b"dayPeriods")?;
    let table = |key: &[u8]| bundle.get_by_key(key)?.get_value().get_table();
    let (mut by_set, mut by_locale) = (RulesByName::default(), RulesByName::default());
    for (set, periods) in table(b"rules")?.iter() {
        try_map_insert(&mut by_set, set, DayPeriodRules::read(&periods)?)?;
    }
    for (locale, set) in table(b"locales")?.iter() {
        let rules = by_set.get(&*invariant_c_string(set.get_string()?.iter()));
        let rules = *rules.ok_or(U_INVALID_FORMAT_ERROR)?;
        try_map_insert(&mut by_locale, locale, rules)?;
    }
    Ok(by_locale)
}

/// Parses "06:00" as 6.
fn parse_hour(time: U16s) -> Option<u16> {
    let digit = |index| Some(time.get(index)?.wrapping_sub(0x30)).filter(|&digit| digit <= 9);
    let hour = 10 * digit(0)? + digit(1)?;
    time.slice(2..).eq_bytes(b":00").then_some(hour)
}
