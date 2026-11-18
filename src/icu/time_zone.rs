//! Identifiers of time zones.

use core::ffi::{CStr, c_char};
use core::{mem, ptr};
use std::sync::PoisonError;

use crate::argument::zone_id_length;
use crate::enumeration::UEnumeration;
use crate::error::Status;
use crate::ffi::filled;
use crate::{Buffer, Enumeration, Result};

pub const MAX_ID_LENGTH: usize = 128;

icu_functions! {
    fn ucal_getDefaultTimeZone(out: *mut u16, capacity: i32, status: &mut Status) -> i32;
    fn ucal_getHostTimeZone(out: *mut u16, capacity: i32, status: &mut Status) -> i32;
    fn ucal_getCanonicalTimeZoneID(
        id: *const u16,
        length: i32,
        out: *mut u16,
        capacity: i32,
        is_system: *mut i8,
        status: &mut Status,
    ) -> i32;
    #[cfg(not(system_icucore))]
    fn ucal_getIanaTimeZoneID(id: *const u16, length: i32, out: *mut u16, capacity: i32, status: &mut Status) -> i32;
    fn ucal_openTimeZoneIDEnumeration(kind: i32, region: *const c_char, offset: *const i32, status: &mut Status) -> *mut UEnumeration;
}

const UCAL_ZONE_TYPE_CANONICAL: i32 = 1;

/// The zone that the system is set to, under a name that need not be known to ICU.
pub fn host() -> Result<Buffer<u16>> {
    #[expect(clippy::disallowed_types, reason = "bun_threading is above this crate")]
    static HAS_DEFAULT: std::sync::Mutex<bool> = std::sync::Mutex::new(false);

    // The detection is for one thread at a time. ICU runs it too, once, for its default zone: the first call here is that
    // run or waits for it.
    let mut has_default = HAS_DEFAULT.lock().unwrap_or_else(PoisonError::into_inner);
    let detect = if mem::replace(&mut *has_default, true) {
        ucal_getHostTimeZone
    } else {
        ucal_getDefaultTimeZone
    };
    // SAFETY: `out` has room for `capacity`, and no other detection is running.
    filled(|out, capacity, status| unsafe { detect(out, capacity, status) })
}

/// The name that CLDR files the zone under (`Asia/Calcutta`), or the normal form of an offset (`GMT+05:30`).
pub fn canonical_id(id: &[u16]) -> Result<Buffer<u16>> {
    let length = zone_id_length(id)?;
    // SAFETY: `id` has `length` units, `out` has room for `capacity`, and `is_system` is optional.
    filled(|out, capacity, status| unsafe {
        ucal_getCanonicalTimeZoneID(id.as_ptr(), length, out, capacity, ptr::null_mut(), status)
    })
}

/// The name that the IANA database files the zone under (`Asia/Kolkata`).
#[cfg(not(system_icucore))]
pub fn iana_id(id: &[u16]) -> Result<Buffer<u16>> {
    let length = zone_id_length(id)?;
    // SAFETY: `id` has `length` units, and `out` has room for `capacity`.
    filled(|out, capacity, status| unsafe {
        ucal_getIanaTimeZoneID(id.as_ptr(), length, out, capacity, status)
    })
}

/// New in ICU 74, which is later than the oldest library of macOS.
#[cfg(system_icucore)]
pub fn iana_id(_: &[u16]) -> Result<Buffer<u16>> {
    Err(crate::Error::UNSUPPORTED)
}

/// Those that are their own `canonical_id`, of one region or of all.
pub fn canonical_ids(region: Option<&CStr>) -> Result<Enumeration> {
    let region = region.map_or(ptr::null(), CStr::as_ptr);
    // SAFETY: `region` is terminated or absent, and the offset is optional.
    Enumeration::open(|status| unsafe {
        ucal_openTimeZoneIDEnumeration(UCAL_ZONE_TYPE_CANONICAL, region, ptr::null(), status)
    })
}
