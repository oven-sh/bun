//! Localized names of zones and meta zones: "Pacific Standard Time", "PST", "Los Angeles". ICU4C: tznames_impl.cpp

use crate::common::bytes::U16s;
use crate::common::locid::Locale;
use crate::common::maps::Map;
use crate::common::memory::{try_map_insert, try_shared_result};
use crate::common::resource::{ResourceSink, ResourceValue};
use crate::common::slice_ext::SliceExt;
use crate::common::umutex::Mutex;
use crate::common::unistr::from_units;
use crate::common::uresdata::DataString;
use crate::common::uresimp::*;
use crate::common::utf16::from_latin1;
use crate::common::utypes::{U_INTERNAL_PROGRAM_ERROR, UErrorCode};
use crate::i18n::gregoimp::UDate;
use crate::i18n::locale_cache::LocaleCache;
use crate::i18n::timezone::{ZID_KEY_MAX, invariant_c_string, preloaded_zone_id, zone_key};
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

const MZ_PREFIX: [u16; 5] = from_latin1(b"meta:");
const MZID_MAX: usize = ZID_KEY_MAX - MZ_PREFIX.len();

type Names = [Option<U16s<'static>>; KEYS.len()];

#[derive(Default)]
struct NamesLoader {
    names: Names,
    /// Also set by the no-inheritance marker, which leaves the name absent.
    is_found: [bool; KEYS.len()],
}

impl ResourceSink for NamesLoader {
    /// Keeps the first name of each type: the most specific bundle comes first.
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        for (key, value) in value.get_table()?.iter() {
            if let Some(index) = KEYS.iter().position(|&name| name == key)
                && !self.is_found.at(index)
            {
                if !value.is_no_inheritance_marker() {
                    let name = value.get_data_string()?.until_nul();
                    self.names.set(index, Some(name));
                }
                self.is_found.set(index, true);
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
        let names = Self {
            zone_strings: bundle.get_by_key_with_fallback(b"zoneStrings")?,
            loaded: Mutex::new(LoadedNames::default()),
        };
        if let Some(tzid) = preloaded_zone_id()? {
            names.load_strings(tzid)?;
        }
        Ok(names)
    }

    /// Caches the names of a zone and of its meta zones.
    #[cold]
    fn load_strings(&self, tzid: &'static [u16]) -> Result<(), UErrorCode> {
        if tzid.len() > ZID_KEY_MAX {
            return Err(U_INTERNAL_PROGRAM_ERROR);
        }
        self.time_zone_display_name(tzid, NameType::LongGeneric);
        for mzid in zonemeta::meta_zone_ids(tzid) {
            if mzid.len() > MZID_MAX {
                return Err(U_INTERNAL_PROGRAM_ERROR);
            }
            self.meta_zone_display_name(mzid, NameType::LongGeneric);
        }
        Ok(())
    }

    /// Returns a pattern such as "gmtFormat".
    pub(crate) fn pattern(&self, key: &[u8]) -> Result<DataString, UErrorCode> {
        self.zone_strings.get_string_by_key_with_fallback(key)
    }

    /// Ignores errors.
    fn load(&self, key: &[u8]) -> Names {
        let mut loader = NamesLoader::default();
        _ = ures_get_all_items_with_fallback(&self.zone_strings, key, &mut loader);
        loader.names
    }

    /// The empty ID has no names but a location.
    fn load_time_zone(&self, tzid: &[u16]) -> Names {
        let mut names = Names::default();
        if tzid.len() <= ZID_KEY_MAX {
            names = self.load(&zone_key(tzid.iter().copied(), 0));
        }
        if tzid.is_empty() {
            names.slice_mut(1..).fill(None);
        }
        names
    }

    fn load_meta_zone(&self, mzid: &[u16]) -> Names {
        if mzid.len() > MZID_MAX {
            return Names::default();
        }
        self.load(&invariant_c_string(MZ_PREFIX.iter().chain(mzid).copied()))
    }

    fn find(
        &self,
        loaded: &mut NamesById,
        id: &'static [u16],
        load: fn(&Self, &[u16]) -> Names,
        name_type: NameType,
    ) -> Option<U16s<'static>> {
        if let Some(names) = loaded.get(id) {
            return names.at(name_type as usize);
        }
        let names = load(self, id);
        // Fails after any failed allocation, so incomplete names are not cached.
        _ = try_map_insert(loaded, id, names);
        names.at(name_type as usize)
    }

    fn time_zone_name(
        &self,
        loaded: &mut LoadedNames,
        tzid: &'static [u16],
        name_type: NameType,
    ) -> Option<U16s<'static>> {
        self.find(
            &mut loaded.time_zones,
            tzid,
            Self::load_time_zone,
            name_type,
        )
    }

    fn meta_zone_name(
        &self,
        loaded: &mut LoadedNames,
        mzid: &'static [u16],
        name_type: NameType,
    ) -> U16s<'static> {
        self.find(
            &mut loaded.meta_zones,
            mzid,
            Self::load_meta_zone,
            name_type,
        )
        .unwrap_or_default()
    }

    pub(crate) fn time_zone_display_name(
        &self,
        tzid: &'static [u16],
        name_type: NameType,
    ) -> U16s<'static> {
        self.time_zone_name(&mut self.loaded.lock(), tzid, name_type)
            .unwrap_or_default()
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
        if let Some(own) = own.filter(|own| !own.is_empty()) {
            return own;
        }
        zonemeta::get_metazone_id(tzid, date).map_or(U16s::EMPTY, |mzid| {
            self.meta_zone_name(loaded, mzid, name_type)
        })
    }

    /// Falls back to the last segment of the ID if the zone has a country.
    pub(crate) fn exemplar_location_name(&self, tzid: &'static [u16]) -> Vec<u16> {
        let name = self.time_zone_name(&mut self.loaded.lock(), tzid, NameType::ExemplarLocation);
        if name.is_some()
            || tzid.len() > ZID_KEY_MAX
            || zonemeta::get_canonical_country(tzid).is_none()
        {
            return from_units(name.unwrap_or_default().iter());
        }
        let slash = tzid.iter().rposition(|&unit| unit == u16::from(b'/'));
        let slash = slash.filter(|&slash| slash > 0);
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
