//! Metadata for zone IDs: canonical, IANA and short IDs, countries, meta zones. ICU4C: zonemeta.cpp

use crate::common::bytes::U16s;
use crate::common::cstring::until_nul;
use crate::common::maps::Map;
use crate::common::memory::{
    Appendable, check_oom, defer_oom, insert_within_capacity, oom_checked, try_to_vec,
};
use crate::common::uenum::StringEnumeration;
use crate::common::uinvchar::uprv_is_invariant_ustring;
use crate::common::umutex::{OnceBox, StaticMap};
use crate::common::uresimp::*;
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, U_MISSING_RESOURCE_ERROR, UErrorCode};
use crate::i18n::gregoimp::{
    U_MILLIS_PER_DAY, U_MILLIS_PER_HOUR, U_MILLIS_PER_MINUTE, UDate, grego,
};
use crate::i18n::timezone::{
    Key, Part, TZEnumeration, TimeZone, ZID_KEY_MAX, ZoneId, cached_part, invariant_c_string,
    is_same, zone_key,
};

const KEY_TYPE_DATA: &[u8] = b"keyTypeData";
const META_ZONES: &[u8] = b"metaZones";

/// From 1970-01-01 00:00 to 9999-12-31 23:59.
const DEFAULT_PERIOD: (UDate, UDate) = (0.0, 253_402_300_740_000.0);

/// A period in which a zone belongs to a meta zone.
struct MetaZonePeriod {
    mzid: &'static [u16],
    from: UDate,
    to: UDate,
}

/// The keys are the shared copies of IDs. A value is the canonical ID, once it is known.
static IDS: StaticMap<&'static [u16], Option<&'static [u16]>> = StaticMap::new();

/// Returns the shared copy of `id`.
fn intern_id(id: U16s) -> Result<&'static [u16], UErrorCode> {
    let find =
        |ids: &Map<&'static [u16], _>, id: &[u16]| ids.get_key_value(id).map(|(&shared, _)| shared);
    let id = ZoneId::from_data(id)?;
    if let Some(shared) = IDS.with_lock(|ids| find(ids, &id)) {
        return Ok(shared);
    }
    let new = try_to_vec(&id)?;
    let result = IDS.with_reserved(|ids| match find(ids, &new) {
        Some(shared) => (shared, Some(new)),
        None => {
            let id: &[u16] = Vec::leak(new);
            insert_within_capacity(ids, id, None);
            (id, None)
        }
    });
    result.map(|(shared, _unused)| shared)
}

fn string_by_key(table: &UResourceBundle, key: &[u8]) -> Option<U16s<'static>> {
    table.get_string_by_key(key).ok()
}

fn type_map() -> Option<&'static UResourceBundle> {
    static TYPE_MAP: Part = OnceBox::new();
    cached_part(&TYPE_MAP, KEY_TYPE_DATA, &[b"typeMap", b"timezone"]).ok()
}

/// Returns the canonical ID of a system zone ID.
pub(crate) fn get_canonical_cldr_id(tzid: &[u16]) -> Result<&'static [u16], UErrorCode> {
    if tzid.len() > ZID_KEY_MAX {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    let key = until_nul(tzid);
    // Only NULs may follow the key.
    if !uprv_is_invariant_ustring(key.iter().copied())
        || tzid.iter().skip(key.len()).any(|&unit| unit != 0)
    {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    if let Some(canonical) = IDS.get(key).flatten() {
        return Ok(canonical);
    }

    let (canonical, is_canonical) = find_canonical_id(tzid).ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
    let canonical = intern_id(canonical)?;
    let key = TimeZone::find_id(tzid).map(intern_id).transpose()?;
    check_oom()?;
    for id in key.into_iter().chain(is_canonical.then_some(canonical)) {
        IDS.with_lock(|ids| {
            ids.get_mut(id)
                .map(|cached| *cached.get_or_insert(canonical))
        });
    }
    Ok(canonical)
}

/// Returns the canonical ID, and whether to cache that ID as canonical itself.
fn find_canonical_id(tzid: &[u16]) -> Option<(U16s<'static>, bool)> {
    static TYPE_ALIAS: Part = OnceBox::new();
    let key = zone_key(tzid.iter().copied(), 1);
    let is_in_map = type_map().is_some_and(|map| map.get_value_by_key(&key).is_ok());
    if is_in_map && let Some(own) = TimeZone::find_id(tzid) {
        return Some((own, true));
    }
    let aliases = cached_part(&TYPE_ALIAS, KEY_TYPE_DATA, &[b"typeAlias", b"timezone"]).ok();
    let alias = |key: &[u8]| Some((string_by_key(aliases?, key)?, is_in_map));
    alias(&key).or_else(|| {
        let target = TimeZone::derefer_olson_link(tzid)?;
        Some(alias(&zone_key(target.iter(), 1)).unwrap_or((target, true)))
    })
}

pub(crate) fn get_canonical_cldr_id_of(tz: &TimeZone) -> Option<&'static [u16]> {
    match tz {
        TimeZone::Olson(zone) => Some(zone.canonical_id),
        TimeZone::Fixed { id, .. } => get_canonical_cldr_id(id).ok(),
    }
}

pub(crate) fn get_iana_id(tzid: &[u16]) -> Result<ZoneId, UErrorCode> {
    static IANA_MAP: Part = OnceBox::new();
    let canonical = get_canonical_cldr_id(tzid)?;
    if canonical.len() <= ZID_KEY_MAX + 1
        && let Ok(map) = cached_part(&IANA_MAP, KEY_TYPE_DATA, &[b"ianaMap", b"timezone"])
        && let Some(iana) = string_by_key(map, &zone_key(canonical.iter().copied(), 0))
    {
        return ZoneId::from_data(iana);
    }
    Ok(ZoneId::Static(canonical))
}

/// Returns the region of a zone, or `None` if the region is unknown, empty or "001".
pub(crate) fn get_canonical_country(tzid: &[u16]) -> Option<Key> {
    let region = TimeZone::get_region(tzid).ok()?;
    (!region.is_empty() && !region.eq_bytes(b"001")).then(|| invariant_c_string(region.iter()))
}

/// Returns whether `tzid` is the only zone of `country`, or else its primary zone.
pub(crate) fn is_primary_zone(tzid: &[u16], country: &[u8]) -> bool {
    static HAS_SINGLE_ZONE: StaticMap<[Option<u8>; 2], bool> = StaticMap::new();
    static PRIMARY_ZONES: Part = OnceBox::new();
    let country = country.get(..2).unwrap_or(country);
    let key = [0, 1].map(|index| country.get(index).copied());
    let count_zones = || {
        let count = TZEnumeration::canonical()?.in_region(country)?.count();
        HAS_SINGLE_ZONE.get_or_insert_with(key, || count == Ok(1))
    };
    let is_tzid = |primary| {
        is_same(primary, tzid)
            || TimeZone::get_canonical_id(tzid).is_ok_and(|id| is_same(primary, &id))
    };
    let is_primary = || {
        cached_part(&PRIMARY_ZONES, META_ZONES, &[b"primaryZones"])
            .is_ok_and(|zones| string_by_key(zones, country).is_some_and(is_tzid))
    };
    HAS_SINGLE_ZONE
        .get(&key)
        .map_or_else(count_zones, Ok)
        .is_ok_and(|single| single || is_primary())
}

/// Returns the periods of `tzid` in the order of the data.
#[inline]
fn meta_zone_periods(tzid: &'static [u16]) -> Option<&'static [MetaZonePeriod]> {
    static PERIODS: StaticMap<&'static [u16], &'static [MetaZonePeriod]> = StaticMap::new();
    PERIODS.get(tzid).or_else(|| {
        let periods = oom_checked(load_meta_zone_periods(tzid)?).ok()?;
        defer_oom(PERIODS.get_or_insert_with(tzid, || Vec::leak(periods)))
    })
}

/// Returns the meta zone of each period of `tzid`.
pub(crate) fn meta_zone_ids(tzid: &'static [u16]) -> impl Iterator<Item = &'static [u16]> {
    let periods = meta_zone_periods(tzid).unwrap_or_default();
    periods.iter().map(|period| period.mzid)
}

/// Returns the meta zone of `tzid` at `date`.
pub(crate) fn get_metazone_id(tzid: &'static [u16], date: UDate) -> Option<&'static [u16]> {
    meta_zone_periods(tzid)?
        .iter()
        .find(|period| period.from <= date && period.to > date)
        .map(|period| period.mzid)
        .filter(|mzid| !mzid.is_empty())
}

/// Skips invalid periods. Returns `None` if no period is valid.
fn load_meta_zone_periods(tzid: &[u16]) -> Option<Vec<MetaZonePeriod>> {
    static METAZONE_INFO: Part = OnceBox::new();
    let info = cached_part(&METAZONE_INFO, META_ZONES, &[b"metazoneInfo"]).ok()?;
    let canonical = get_canonical_cldr_id(tzid).ok()?;
    let mut periods = info
        .get_by_key(&zone_key(canonical.iter().copied(), 0))
        .ok()?;

    let count = periods.get_size();
    let entry = |_| {
        let period = periods.get_next_resource().ok()?;
        let string = |index| ures_get_string_by_index(&period, index).ok()?;
        let date = |index| string(index).and_then(parse_date);
        let mzid = string(0)?;
        let (from, to) = if period.get_size() >= 3 {
            (date(1)?, date(2)?)
        } else {
            DEFAULT_PERIOD
        };
        Some(MetaZonePeriod {
            mzid: defer_oom(intern_id(mzid))?,
            from,
            to,
        })
    };
    let mut valid = Vec::new();
    valid.add_each((0..count).filter_map(entry));
    (!valid.is_empty()).then_some(valid)
}

/// Parses "yyyy-MM-dd HH:mm" or "yyyy-MM-dd".
fn parse_date(text: U16s) -> Option<UDate> {
    if text.len() != 16 && text.len() != 10 {
        return None;
    }
    // A missing field is 0.
    let number = |start: usize, end: usize| {
        let mut digits = text.slice_clamped(start..end).iter();
        digits.try_fold(0, |value, unit| {
            (0x30..=0x39)
                .contains(&unit)
                .then(|| 10 * value + i32::from(unit - 0x30))
        })
    };
    let day = grego::fields_to_day(number(0, 4)?, number(5, 7)? - 1, number(8, 10)?);
    let millis = number(11, 13)? * U_MILLIS_PER_HOUR + number(14, 16)? * U_MILLIS_PER_MINUTE;
    Some((day * i64::from(U_MILLIS_PER_DAY) + i64::from(millis)) as UDate)
}

fn map_timezones() -> Option<&'static UResourceBundle> {
    static MAP_TIMEZONES: Part = OnceBox::new();
    cached_part(&MAP_TIMEZONES, META_ZONES, &[b"mapTimezones"]).ok()
}

/// Returns the reference zone of `mzid` for `region`, or else for "001".
pub(crate) fn get_zone_id_by_metazone(mzid: &[u16], region: &[u8]) -> Option<U16s<'static>> {
    let zones = map_timezones()
        .filter(|_| mzid.len() <= ZID_KEY_MAX)?
        .get_by_key(&invariant_c_string(mzid.iter().copied()))
        .ok()?;
    if let 2 | 3 = region.len() {
        match zones.get_string_by_key(region) {
            Err(U_MISSING_RESOURCE_ERROR) => {}
            found => return found.ok(),
        }
    }
    string_by_key(&zones, b"001")
}

/// Returns whether `mzid` is a key of the table of reference zones.
pub(crate) fn is_listed_meta_zone(mzid: &[u16]) -> bool {
    let key = invariant_c_string(mzid.iter().copied());
    key.len() == mzid.len() && map_timezones().is_some_and(|map| map.get_value_by_key(&key).is_ok())
}

/// Returns the BCP 47 type of a system zone, such as "uslax".
pub(crate) fn get_short_id_of(tz: &TimeZone) -> Option<U16s<'static>> {
    match tz {
        TimeZone::Olson(zone) => {
            string_by_key(type_map()?, &zone_key(zone.canonical_id.iter().copied(), 1))
        }
        TimeZone::Fixed { .. } => None,
    }
}
