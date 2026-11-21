//! Localized names of zones and meta zones: "Pacific Standard Time", "PST", "Los Angeles". ICU4C: tznames_impl.cpp

use crate::common::bytes::U16s;
use crate::common::locid::Locale;
use crate::common::maps::Map;
use crate::common::memory::{try_map_insert, try_shared_result};
use crate::common::resource::{ResourceSink, ResourceValue};
use crate::common::slice_ext::SliceExt;
use crate::common::umutex::Mutex;
use crate::common::unistr::from_units;
use crate::common::uresimp::*;
use crate::common::utypes::UErrorCode;
use crate::i18n::gregoimp::UDate;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::timezone::{Key, invariant_c_string, zone_key};
use crate::i18n::zonemeta;
use std::sync::Arc;

#[derive(Clone, Copy)]
pub(crate) enum NameType {
    ExemplarLocation,
    LongGeneric,
    LongStandard,
    LongDaylight,
    ShortGeneric,
    ShortStandard,
    ShortDaylight,
}

/// In the order of `NameType`.
const KEYS: [&[u8]; 7] = [b"ec", b"lg", b"ls", b"ld", b"sg", b"ss", b"sd"];

/// The no-inheritance marker is stored as an empty name.
#[derive(Clone, Copy, Default)]
struct Names([Option<U16s<'static>>; KEYS.len()]);

impl ResourceSink for Names {
    /// Keeps the first name of each type: the most specific bundle comes first.
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        for (key, value) in value.get_table()?.iter() {
            if let Some((found @ None, _)) =
                self.0.iter_mut().zip(KEYS).find(|&(_, name)| name == key)
            {
                *found = Some(if value.is_no_inheritance_marker() {
                    U16s::EMPTY
                } else {
                    value.get_data_string()?.until_nul()
                });
            }
        }
        Ok(())
    }
}

type NamesById = Map<&'static [u16], Names>;

#[derive(Default)]
struct LoadedNames {
    time_zones: NamesById,
    meta_zones: NamesById,
}

/// Every getter returns an empty name if the data has none.
pub(crate) struct TimeZoneNames {
    zone_strings: UResourceBundle,
    loaded: Mutex<LoadedNames>,
}

impl TimeZoneNames {
    pub(crate) fn create_instance(locale: &Locale) -> Result<Arc<Self>, UErrorCode> {
        static INSTANCES: LocaleCache<TimeZoneNames> = LocaleCache::new();
        let name = locale.get_name();
        INSTANCES.get_or_try_insert_with(name, || try_shared_result(&mut Self::new(name)))
    }

    fn new(locale_name: &[u8]) -> Result<Self, UErrorCode> {
        let bundle = ures_open(Some(U_ICUDATA_ZONE), locale_name)?;
        Ok(Self {
            zone_strings: bundle.get_by_key_with_fallback(b"zoneStrings")?,
            loaded: Mutex::new(LoadedNames::default()),
        })
    }

    /// Returns a pattern such as "gmtFormat".
    pub(crate) fn pattern(&self, key: &[u8]) -> Result<Vec<u16>, UErrorCode> {
        let pattern = self.zone_strings.get_string_by_key_with_fallback(key)?;
        pattern.until_nul().try_to_vec()
    }

    fn find(
        &self,
        loaded: &mut NamesById,
        id: &'static [u16],
        key: fn(&[u16]) -> Key,
        name_type: NameType,
    ) -> U16s<'static> {
        if let Some(names) = loaded.get(id) {
            return names.0.at(name_type as usize).unwrap_or_default();
        }
        let mut names = Names::default();
        _ = ures_get_all_items_with_fallback(&self.zone_strings, &key(id), &mut names);
        // Fails after any failed allocation, so incomplete names are not cached.
        _ = try_map_insert(loaded, id, names);
        names.0.at(name_type as usize).unwrap_or_default()
    }

    fn time_zone_name(
        &self,
        loaded: &mut LoadedNames,
        tzid: &'static [u16],
        name_type: NameType,
    ) -> U16s<'static> {
        let key = |tzid: &[u16]| zone_key(tzid.iter().copied(), 0);
        self.find(&mut loaded.time_zones, tzid, key, name_type)
    }

    fn meta_zone_name(
        &self,
        loaded: &mut LoadedNames,
        mzid: &'static [u16],
        name_type: NameType,
    ) -> U16s<'static> {
        let key =
            |mzid: &[u16]| invariant_c_string(b"meta:".map(u16::from).iter().chain(mzid).copied());
        self.find(&mut loaded.meta_zones, mzid, key, name_type)
    }

    pub(crate) fn time_zone_display_name(
        &self,
        tzid: &'static [u16],
        name_type: NameType,
    ) -> U16s<'static> {
        self.time_zone_name(&mut self.loaded.lock(), tzid, name_type)
    }

    pub(crate) fn meta_zone_display_name(
        &self,
        mzid: &'static [u16],
        name_type: NameType,
    ) -> U16s<'static> {
        self.meta_zone_name(&mut self.loaded.lock(), mzid, name_type)
    }

    /// Returns the name of the zone, or else the name of its meta zone at `date`.
    pub(crate) fn display_name(
        &self,
        tzid: &'static [u16],
        name_type: NameType,
        date: UDate,
    ) -> U16s<'static> {
        let loaded = &mut self.loaded.lock();
        let own = self.time_zone_name(loaded, tzid, name_type);
        if !own.is_empty() {
            return own;
        }
        zonemeta::get_metazone_id(tzid, date).map_or(U16s::EMPTY, |mzid| {
            self.meta_zone_name(loaded, mzid, name_type)
        })
    }

    /// Falls back to the last segment of the ID if the zone has a country.
    pub(crate) fn exemplar_location_name(&self, tzid: &'static [u16]) -> Vec<u16> {
        let name = self.time_zone_display_name(tzid, NameType::ExemplarLocation);
        if !name.is_empty() || zonemeta::get_canonical_country(tzid).is_none() {
            return from_units(name.iter());
        }
        let slash = tzid.iter().rposition(|&unit| unit == u16::from(b'/'));
        let segment = slash.map_or(&[][..], |slash| tzid.slice(slash + 1..));
        from_units(segment.iter().map(|&unit| {
            if unit == u16::from(b'_') {
                u16::from(b' ')
            } else {
                unit
            }
        }))
    }
}
