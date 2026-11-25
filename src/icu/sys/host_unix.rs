//! The calls that read the locale and the time zone of a POSIX host. ICU4C: putil.cpp

use crate::sys::host::{TzGlobals, cstr_to_vec};
use libc::tm;
use std::ffi::c_char;
use std::ptr::null;
use std::sync::atomic::{AtomicPtr, Ordering::Relaxed};

unsafe extern "C" {
    safe fn localtime_r(time: &i64, result: &mut tm) -> *mut tm;
    safe fn tzset();
    safe static tzname: [AtomicPtr<c_char>; 2];
}

pub(crate) fn messages_locale() -> Option<Vec<u8>> {
    // SAFETY: with a null locale the call only queries; it returns null or a C string.
    unsafe { cstr_to_vec(libc::setlocale(libc::LC_MESSAGES, null())) }
}

impl TzGlobals {
    pub(crate) fn tzset(&mut self) {
        tzset();
    }

    /// Returns `tzname[0]` and `tzname[1]`, empty if null.
    pub(crate) fn tzname(&self) -> [Vec<u8>; 2] {
        // SAFETY: each pointer is null or a C string, which is not freed while the time zone is unchanged. The loads
        // are atomic because the program's own `tzset` or `localtime_r` may store the pointers on another thread.
        tzname
            .each_ref()
            .map(|name| unsafe { cstr_to_vec(name.load(Relaxed)) }.unwrap_or_default())
    }

    /// Whether daylight saving time is in effect at `time`, in seconds since 1970.
    pub(crate) fn is_dst(&mut self, time: i32) -> bool {
        let mut local: tm = bun_core::ffi::zeroed();
        localtime_r(&time.into(), &mut local);
        local.tm_isdst > 0
    }

    /// Seconds west of UTC.
    #[cfg(not(any(target_env = "musl", target_os = "freebsd")))]
    pub(crate) fn timezone(&mut self) -> i32 {
        unsafe extern "C" {
            #[cfg_attr(target_env = "gnu", link_name = "__timezone")]
            safe static timezone: std::sync::atomic::AtomicIsize;
        }
        timezone.load(Relaxed) as i32
    }

    /// Seconds west of UTC.
    #[cfg(any(target_env = "musl", target_os = "freebsd"))]
    pub(crate) fn timezone(&mut self) -> i32 {
        unsafe extern "C" {
            safe fn gmtime_r(time: &i64, result: &mut tm) -> *mut tm;
            safe fn mktime(time: &mut tm) -> i64;
        }
        let now = bun_core::time::timestamp();
        let [mut local, mut utc] = [localtime_r, gmtime_r].map(|convert| {
            let mut time: tm = bun_core::ffi::zeroed();
            convert(&now, &mut time);
            time
        });
        let dst_offset = if local.tm_isdst != 0 { 3600 } else { 0 };
        let local = mktime(&mut local);
        (mktime(&mut utc).wrapping_sub(local) as i32).wrapping_add(dst_offset)
    }
}

/// Returns the environment variable `TZ`.
#[cfg(not(target_os = "android"))]
pub(crate) fn tz_setting() -> Option<Vec<u8>> {
    use crate::common::memory::{defer_oom, try_to_vec};
    defer_oom(try_to_vec(bun_core::getenv_z(bun_core::zstr!("TZ"))?))
}

/// Returns the system property that replaces `TZ`, empty if it is not set.
#[cfg(target_os = "android")]
pub(crate) fn tz_setting() -> Option<Vec<u8>> {
    let mut value = [0; libc::PROP_VALUE_MAX as usize + 1];
    // SAFETY: the function writes at most `PROP_VALUE_MAX` bytes, so the last byte of `value` stays 0.
    unsafe {
        libc::__system_property_get(c"persist.sys.timezone".as_ptr(), value.as_mut_ptr());
        cstr_to_vec(value.as_ptr())
    }
}
