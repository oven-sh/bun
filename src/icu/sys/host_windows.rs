//! The calls that read the locale and the time zone of a Windows host. ICU4C: putil.cpp, wintz.cpp

use crate::sys::host::{TzGlobals, cstr_to_vec};
use std::convert::Infallible;
use std::ffi::{c_char, c_int, c_void};
use std::mem::offset_of;
use std::ptr::{null_mut, without_provenance_mut};

/// A wide string buffer of `N` units followed by a NUL, so that it is always NUL-terminated.
#[derive(Clone, Copy)]
#[repr(C)]
struct WideText<const N: usize> {
    units: [u16; N],
    nul: u16,
}

impl<const N: usize> WideText<N> {
    const EMPTY: Self = Self {
        units: [0; N],
        nul: 0,
    };

    /// Widens at most the first `N` bytes.
    fn from_bytes(bytes: &[u8]) -> Self {
        let mut text = Self::EMPTY;
        text.units
            .iter_mut()
            .zip(bytes)
            .for_each(|(unit, &c)| *unit = c.into());
        text
    }
}

const LOCALE_NAME_MAX_LENGTH: usize = 85;

pub(crate) type LocaleName = [u16; LOCALE_NAME_MAX_LENGTH];

/// `SYSTEMTIME`: year, month, day of the week, day, hour, minute, second, milliseconds.
pub(crate) type SystemTime = [u16; 8];

/// `TIME_ZONE_INFORMATION`
#[derive(Clone, Copy, Default)]
#[repr(C)]
pub(crate) struct TimeZoneInformation {
    pub bias: i32,
    pub standard_name: [u16; 32],
    pub standard_date: SystemTime,
    pub standard_bias: i32,
    pub daylight_name: [u16; 32],
    pub daylight_date: SystemTime,
    pub daylight_bias: i32,
}

/// `DYNAMIC_TIME_ZONE_INFORMATION`
#[repr(C)]
pub(crate) struct DynamicTimeZoneInformation {
    pub zone: TimeZoneInformation,
    pub time_zone_key_name: [u16; 128],
    pub dynamic_daylight_time_disabled: u8,
}

const _: () = {
    type Zone = TimeZoneInformation;
    type Dynamic = DynamicTimeZoneInformation;
    assert!(size_of::<Zone>() == 172 && align_of::<Zone>() == 4);
    assert!(offset_of!(Zone, standard_name) == 4 && offset_of!(Zone, standard_date) == 68);
    assert!(offset_of!(Zone, standard_bias) == 84 && offset_of!(Zone, daylight_name) == 88);
    assert!(offset_of!(Zone, daylight_date) == 152 && offset_of!(Zone, daylight_bias) == 168);
    assert!(size_of::<Dynamic>() == 432 && offset_of!(Dynamic, time_zone_key_name) == 172);
    assert!(offset_of!(Dynamic, dynamic_daylight_time_disabled) == 428);
};

/// `HKEY`: null, a predefined key, or a result of `RegOpenKeyExW`. Only `RegCloseKey` invalidates it.
#[derive(Clone, Copy)]
#[repr(transparent)]
struct Hkey(*mut c_void);

/// A pointer that can only be null.
type Null = Option<&'static Infallible>;

const TIME_ZONE_ID_INVALID: u32 = 0xffff_ffff;
const LOCALE_NAME_USER_DEFAULT: Null = None;
const LOCALE_SNAME: u32 = 0x5c;
const GEOCLASS_NATION: u32 = 16;
const GEO_ISO2: u32 = 4;
const HKEY_LOCAL_MACHINE: Hkey = Hkey(without_provenance_mut(
    0x8000_0002_u32 as i32 as isize as usize,
));
const KEY_READ: u32 = 0x2_0019;
const ERROR_SUCCESS: i32 = 0;
const REG_SZ: u32 = 1;

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn GetDynamicTimeZoneInformation(information: &mut DynamicTimeZoneInformation) -> u32;
    safe fn GetUserGeoID(geo_class: u32) -> i32;
    fn GetGeoInfoW(
        location: i32,
        geo_type: u32,
        data: *mut u16,
        count: c_int,
        lang_id: u16,
    ) -> c_int;
    fn GetLocaleInfoEx(locale: Null, lc_type: u32, data: *mut u16, count: c_int) -> c_int;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    safe fn RegOpenKeyExW(
        key: Hkey,
        sub_key: &KeyPath,
        options: u32,
        sam_desired: u32,
        result: &mut Hkey,
    ) -> i32;
    safe fn RegQueryInfoKeyW(
        key: Hkey,
        class: Null,
        class_length: Null,
        reserved: Null,
        sub_keys: &mut u32,
        max_sub_key_length: Null,
        max_class_length: Null,
        values: Null,
        max_value_name_length: Null,
        max_value_length: Null,
        security_descriptor: Null,
        last_write_time: Null,
    ) -> i32;
    fn RegEnumKeyExW(
        key: Hkey,
        index: u32,
        name: *mut u16,
        name_length: &mut u32,
        reserved: Null,
        class: Null,
        class_length: Null,
        last_write_time: Null,
    ) -> i32;
    fn RegQueryValueExW(
        key: Hkey,
        value_name: &WideText<3>,
        reserved: Null,
        value_type: &mut u32,
        data: *mut u8,
        data_size: &mut u32,
    ) -> i32;
    fn RegCloseKey(key: Hkey) -> i32;
}

unsafe extern "C" {
    safe fn _tzset();
    fn _get_tzname(length: &mut usize, name: *mut c_char, size: usize, index: c_int) -> c_int;
}

pub(crate) fn user_default_locale_name() -> Option<LocaleName> {
    let mut name: LocaleName = [0; _];
    // SAFETY: the buffer is passed with its length.
    let length = unsafe {
        GetLocaleInfoEx(
            LOCALE_NAME_USER_DEFAULT,
            LOCALE_SNAME,
            name.as_mut_ptr(),
            name.len() as c_int,
        )
    };
    (length > 0).then_some(name)
}

pub(crate) fn dynamic_time_zone_information() -> Option<DynamicTimeZoneInformation> {
    let mut information = DynamicTimeZoneInformation {
        zone: TimeZoneInformation::default(),
        time_zone_key_name: [0; _],
        dynamic_daylight_time_disabled: 0,
    };
    (GetDynamicTimeZoneInformation(&mut information) != TIME_ZONE_ID_INVALID).then_some(information)
}

/// Returns the ISO 3166 code of the user's region.
pub(crate) fn user_region() -> Option<[u16; 3]> {
    let (mut region, geo_id) = ([0; _], GetUserGeoID(GEOCLASS_NATION));
    // SAFETY: the buffer is passed with its length.
    let length = unsafe {
        GetGeoInfoW(
            geo_id,
            GEO_ISO2,
            region.as_mut_ptr(),
            region.len() as c_int,
            0,
        )
    };
    (length != 0).then_some(region)
}

const WINDOWS_MAX_REG_KEY_LENGTH: usize = 256;

pub(crate) type KeyName = [u16; WINDOWS_MAX_REG_KEY_LENGTH];
type KeyPath = WideText<WINDOWS_MAX_REG_KEY_LENGTH>;

/// An open registry key.
pub(crate) struct RegistryKey(Hkey);

impl RegistryKey {
    fn open(parent: Hkey, path: &KeyPath) -> Option<Self> {
        let mut key = Hkey(null_mut());
        (RegOpenKeyExW(parent, path, 0, KEY_READ, &mut key) == ERROR_SUCCESS).then(|| Self(key))
    }

    pub(crate) fn time_zones() -> Option<Self> {
        Self::open(
            HKEY_LOCAL_MACHINE,
            &KeyPath::from_bytes(br"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Time Zones"),
        )
    }

    pub(crate) fn count_sub_keys(&self) -> Option<u32> {
        let mut count = 0;
        let result = RegQueryInfoKeyW(
            self.0, None, None, None, &mut count, None, None, None, None, None, None, None,
        );
        (result == ERROR_SUCCESS).then_some(count)
    }

    /// Returns the name of the subkey and opens it.
    pub(crate) fn sub_key(&self, index: u32) -> Option<(KeyName, Self)> {
        let (mut name, mut length) = (KeyPath::EMPTY, WINDOWS_MAX_REG_KEY_LENGTH as u32);
        // SAFETY: `name.units` has `length` units.
        let result = unsafe {
            RegEnumKeyExW(
                self.0,
                index,
                name.units.as_mut_ptr(),
                &mut length,
                None,
                None,
                None,
                None,
            )
        };
        (result == ERROR_SUCCESS).then(|| Some((name.units, Self::open(self.0, &name)?)))?
    }

    /// Returns the type and the zero-padded data of a value.
    fn query<const N: usize>(&self, name: &[u8]) -> Option<(u32, [u16; N])> {
        let (name, mut value_type, mut data) = (WideText::from_bytes(name), 0, [0; N]);
        let mut size = size_of_val(&data) as u32;
        // SAFETY: `data` has `size` bytes.
        let result = unsafe {
            RegQueryValueExW(
                self.0,
                &name,
                None,
                &mut value_type,
                data.as_mut_ptr().cast(),
                &mut size,
            )
        };
        (result == ERROR_SUCCESS).then_some((value_type, data))
    }

    /// Returns the value "Std", or `None` if it is missing or not a string.
    pub(crate) fn standard_name(&self) -> Option<KeyName> {
        self.query(b"Std")
            .and_then(|(value_type, name)| (value_type == REG_SZ).then_some(name))
    }

    /// Returns `Bias`, and `StandardDate` followed by `DaylightDate`, of the value "TZI" (`REG_TZI_FORMAT`).
    pub(crate) fn tzi(&self) -> Option<(i32, [u16; 16])> {
        let (_, [low, high, _, _, _, _, dates @ ..]) = self.query::<22>(b"TZI")?;
        Some((i32::from(high) << 16 | i32::from(low), dates))
    }
}

impl Drop for RegistryKey {
    fn drop(&mut self) {
        // SAFETY: the key is open, and `self` is its only owner.
        unsafe { RegCloseKey(self.0) };
    }
}

impl TzGlobals {
    pub(crate) fn tzset(&mut self) {
        _tzset();
    }

    pub(crate) fn standard_tzname(&self) -> Option<Vec<u8>> {
        let mut name = [0; 256];
        // SAFETY: at most `name.len() - 1` bytes are written, so the last stays 0.
        unsafe {
            _get_tzname(&mut 0, name.as_mut_ptr(), name.len() - 1, 0);
            cstr_to_vec(name.as_ptr())
        }
    }
}
