//! Generic zone names: "Pacific Time", "Los Angeles Time", "Mountain Time (Phoenix)". ICU4C: tzgnames.cpp

use crate::common::bytes::U16s;
use crate::common::locdspnm::region_name_or_code;
use crate::common::locid::Locale;
use crate::common::loclikely::ulocimp_add_likely_subtags;
use crate::common::maps::Map;
use crate::common::memory::{Appendable, try_map_insert, try_shared_result};
use crate::common::simpleformatter::SimpleFormatter;
use crate::common::slice_ext::SliceExt;
use crate::common::uloc::uloc_get_country;
use crate::common::umutex::Mutex;
use crate::common::unistr::from_units;
use crate::common::ustrcase::equals_ignoring_case;
use crate::common::utypes::UErrorCode;
use crate::i18n::gregoimp::{ONE_DAY, UDate};
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::timezone::{Key, TimeZone, is_same};
use crate::i18n::tznames::{NameType, TimeZoneNames};
use crate::i18n::zonemeta;
use std::sync::Arc;

const DST_CHECK_RANGE: f64 = 184.0 * ONE_DAY;

/// A zone, and for a partial location name the meta zone and whether the name is long.
type NameKey = (&'static [u16], Option<(&'static [u16], bool)>);

pub(crate) struct TimeZoneGenericNames {
    locale: Locale,
    time_zone_names: Arc<TimeZoneNames>,
    region_format: SimpleFormatter,
    fallback_format: SimpleFormatter,
    target_region: Key,
    /// Mutex order: before the lock of `time_zone_names`.
    cache: Mutex<Map<NameKey, Vec<u16>>>,
}

/// Returns the region of `locale`, or else its likely region.
fn target_region(locale: &Locale) -> Result<Key, UErrorCode> {
    if !locale.get_country().is_empty() {
        return Ok(Key::from_slice(locale.get_country()));
    }
    let likely = ulocimp_add_likely_subtags(locale.get_name())?;
    Ok(Key::from_slice(&uloc_get_country(&likely)?))
}

impl TimeZoneGenericNames {
    pub(crate) fn create_instance(locale: &Locale) -> Result<Arc<Self>, UErrorCode> {
        static INSTANCES: LocaleCache<TimeZoneGenericNames> = LocaleCache::new();
        INSTANCES.get_or_try_insert_with(locale.get_name(), || {
            try_shared_result(&mut Self::new(locale))
        })
    }

    fn new(locale: &Locale) -> Result<Self, UErrorCode> {
        let time_zone_names = TimeZoneNames::create_instance(locale)?;
        let format = |key: &[u8], arguments| {
            let pattern = time_zone_names.pattern(key)?;
            SimpleFormatter::with_pattern_min_max_arguments(&pattern, arguments, arguments)
        };
        Ok(Self {
            region_format: format(b"regionFormat", 1)?,
            fallback_format: format(b"fallbackFormat", 2)?,
            locale: locale.clone(),
            target_region: target_region(locale)?,
            time_zone_names,
            cache: Mutex::new(Map::default()),
        })
    }

    /// Appends the non-location name, or else the location name, or nothing.
    pub(crate) fn display_name(
        &self,
        tz: &TimeZone,
        is_long: bool,
        date: UDate,
        name: &mut Vec<u16>,
    ) {
        let Some(tzid) = zonemeta::get_canonical_cldr_id_of(tz) else {
            return;
        };
        let start = name.len();
        self.format_generic_non_location_name(tz, tzid, is_long, date, name);
        if name.len() == start {
            self.append_cached((tzid, None), name, &|new| self.location_name(tzid, new));
        }
    }

    fn append_cached(&self, key: NameKey, name: &mut Vec<u16>, make: &dyn Fn(&mut Vec<u16>)) {
        let cache = &mut self.cache.lock();
        if let Some(cached) = cache.get(&key) {
            return name.add_all(cached);
        }
        let mut new = Vec::new();
        make(&mut new);
        name.add_all(&new);
        // Fails after any failed allocation, so an incomplete name is not cached.
        _ = try_map_insert(cache, key, new);
    }

    /// Appends a name such as "Germany Time" or "Los Angeles Time", or nothing if the zone has no country.
    fn location_name(&self, tzid: &'static [u16], name: &mut Vec<u16>) {
        if let Some(country) = zonemeta::get_canonical_country(tzid) {
            let is_primary = zonemeta::is_primary_zone(tzid, &country);
            let location = self.country_or_city(tzid, is_primary.then_some(&country));
            self.region_format.format(&[&location], name);
        }
    }

    /// Returns the display name of `country`, or else the exemplar city of `tzid`.
    fn country_or_city(&self, tzid: &'static [u16], country: Option<&Key>) -> Vec<u16> {
        match country {
            Some(country) => region_name_or_code(&self.locale, country),
            None => self.time_zone_names.exemplar_location_name(tzid),
        }
    }

    // ICU4C: tzgnames.cpp, TZGNCore::formatGenericNonLocationName
    fn format_generic_non_location_name(
        &self,
        tz: &TimeZone,
        tzid: &'static [u16],
        is_long: bool,
        date: UDate,
        name: &mut Vec<u16>,
    ) {
        let (generic_type, standard_type) = if is_long {
            (NameType::LongGeneric, NameType::LongStandard)
        } else {
            (NameType::ShortGeneric, NameType::ShortStandard)
        };
        let names = &self.time_zone_names;
        let own = names.time_zone_display_name(tzid, generic_type);
        if !own.is_empty() {
            return name.add_each(own.iter());
        }

        let Some(mzid) = zonemeta::get_metazone_id(tzid, date) else {
            return;
        };
        let Ok(offsets) = tz.get_offset(date, false) else {
            return;
        };
        let mz_name = names.meta_zone_display_name(mzid, generic_type);
        let use_standard = offsets.dst_savings == 0
            && !tz
                .get_previous_transition(date, true)
                .is_some_and(|before| {
                    date - before.time < DST_CHECK_RANGE && before.from.dst_savings != 0
                })
            && !tz.get_next_transition(date).is_some_and(|after| {
                after.time - date < DST_CHECK_RANGE && after.to.dst_savings != 0
            });
        if use_standard {
            // Use the standard name unless it equals the generic name. `name` is the scratch space for both.
            let start = name.len();
            name.add_each(names.display_name(tzid, standard_type, date).iter());
            let end = name.len();
            name.add_each(mz_name.iter());
            let differs =
                end > start && !equals_ignoring_case(name.slice(start..end), name.slice(end..));
            name.truncate(if differs { end } else { start });
            if differs {
                return;
            }
        }
        if mz_name.is_empty() {
            return;
        }

        let golden_id = zonemeta::get_zone_id_by_metazone(mzid, &self.target_region);
        if let Some(golden_id) = golden_id.filter(|&id| !id.is_empty() && !is_same(id, tzid)) {
            // Compare at wall time: the transitions of the golden zone may be at another instant.
            let golden_zone = TimeZone::create_time_zone(&from_units(golden_id.iter()));
            let wall = date + f64::from(offsets.raw_offset) + f64::from(offsets.dst_savings);
            let Ok(golden) = golden_zone.get_offset(wall, true) else {
                return;
            };
            if golden != offsets {
                return self.append_cached((tzid, Some((mzid, is_long))), name, &|new| {
                    self.partial_location_name(tzid, mzid, mz_name, new)
                });
            }
        }
        name.add_each(mz_name.iter());
    }

    /// Appends a name such as "Pacific Time (Canada)".
    fn partial_location_name(
        &self,
        tzid: &'static [u16],
        mzid: &[u16],
        mz_name: U16s,
        name: &mut Vec<u16>,
    ) {
        let country = zonemeta::get_canonical_country(tzid);
        let is_golden = |country: &&Key| {
            zonemeta::get_zone_id_by_metazone(mzid, country).is_some_and(|id| is_same(id, tzid))
        };
        let mut location = self.country_or_city(tzid, country.as_ref().filter(is_golden));
        if location.is_empty() && country.is_none() {
            location.add_all(tzid);
        }
        self.fallback_format
            .format(&[&location, &from_units(mz_name.iter())], name);
    }
}
