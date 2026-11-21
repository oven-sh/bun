//! The time zone and the default locale of a Windows host. ICU4C: wintz.cpp, putil.cpp

use crate::common::cstring::until_nul;
use crate::common::memory::{defer_oom, try_concat, try_to_vec};
use crate::common::slice_ext::SliceExt;
use crate::common::uinvchar::{invariant_chars, uprv_is_invariant_ustring};
use crate::common::uloc::ulocimp_canonicalize;
use crate::common::uresimp::ures_open_direct;
use crate::sys::host::{
    self, DynamicTimeZoneInformation, KeyName, LocaleName, RegistryKey, TimeZoneInformation,
};
use std::fmt::NumBuffer;

/// Returns the name of the registry key that matches `zone`, an empty name if none does, `None` if a call fails.
fn key_name_of(zone: &TimeZoneInformation) -> Option<KeyName> {
    let all = RegistryKey::time_zones()?;
    for index in 0..all.count_sub_keys()? {
        let (name, key) = all.sub_key(index)?;
        // Several zones can have the same localized name.
        if until_nul(&key.standard_name()?) == until_nul(&zone.standard_name)
            && key.tzi().is_some_and(|(bias, dates)| {
                (bias, dates.as_slice())
                    == (
                        zone.bias,
                        [zone.standard_date, zone.daylight_date].as_flattened(),
                    )
            })
        {
            return Some(name);
        }
    }
    Some([0; _])
}

pub(crate) fn uprv_detect_windows_time_zone() -> Option<Vec<u8>> {
    let DynamicTimeZoneInformation {
        zone,
        time_zone_key_name,
        dynamic_daylight_time_disabled,
    } = host::dynamic_time_zone_information()?;
    let has_key_name = time_zone_key_name.at(0) != 0;

    // Daylight saving time is turned off.
    if dynamic_daylight_time_disabled != 0
        && zone.standard_date == zone.daylight_date
        && has_key_name == (zone.standard_date == [0; 8])
    {
        if zone.bias == 0 {
            return defer_oom(try_to_vec(b"Etc/UTC"));
        }
        let mut digits = NumBuffer::new();
        let hours = (zone.bias.unsigned_abs() / 60)
            .format_into(&mut digits)
            .as_bytes();
        if zone.bias % 60 == 0 && hours.len() <= 2 {
            return defer_oom(try_concat(&[
                b"Etc/GMT",
                if zone.bias < 0 { b"-" } else { b"+" },
                hours,
            ]));
        }
    }

    let mut name: KeyName = [0; _];
    if has_key_name {
        name.copy_at(0, &time_zone_key_name);
    } else {
        // Some remote desktop sessions provide only the localized name.
        name = key_name_of(&zone)?;
    }
    if !uprv_is_invariant_ustring(until_nul(&name).iter().copied()) {
        return None;
    }
    let regions = ures_open_direct(None, b"windowsZones")
        .and_then(|bundle| bundle.get_by_key(b"mapTimezones"))
        .and_then(|map| map.get_by_key(until_nul(&name.map(|unit| unit as u8))))
        .ok()?;
    let ids_for = |region: &[u8]| regions.get_string_by_key(region).ok();
    let ids =
        host::user_region().and_then(|region| ids_for(until_nul(&region.map(|unit| unit as u8))));
    let ids = ids.or_else(|| ids_for(b"001"))?;

    let first_length = ids
        .iter()
        .take_while(|&unit| unit != u16::from(b' '))
        .count();
    invariant_chars(ids.iter().take(first_length)).ok()
}

/// Converts a Windows locale name to a canonical locale ID.
pub(crate) fn default_locale_id(windows_locale: &LocaleName) -> Option<Vec<u8>> {
    const POSIX_LOCALE_CAPACITY: usize = 64;
    let name = windows_locale.map(|unit| {
        if unit == u16::from(b'_') {
            b'-'
        } else {
            unit as u8
        }
    });
    let id = ulocimp_canonicalize(until_nul(&name));
    id.ok().filter(|id| id.len() <= POSIX_LOCALE_CAPACITY)
}
