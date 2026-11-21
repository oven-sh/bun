//! Locale and time zone of the host. The program must not change them while another thread is in here.

#[cfg(unix)]
pub(crate) use crate::sys::host_unix::*;
#[cfg(windows)]
pub(crate) use crate::sys::host_windows::*;

use crate::common::memory::{defer_oom, try_to_vec};
use crate::sys::ptr::c_bytes;
use bun_core::{Mutex, MutexGuard};
use std::ffi::c_char;

/// Copies a C string without its NUL. Returns `None` for null, or if allocation fails.
/// SAFETY: `text` is null or points to a NUL-terminated string.
pub(crate) unsafe fn cstr_to_vec(text: *const c_char) -> Option<Vec<u8>> {
    // SAFETY: `text` is not null, so it is NUL-terminated.
    (!text.is_null()).then(|| defer_oom(try_to_vec(unsafe { c_bytes(text) })))?
}

/// The global time zone state of the C library: `tzset` and `localtime_r` write `tzname` and `timezone`.
pub(crate) struct TzGlobals(());

impl TzGlobals {
    pub(crate) fn lock() -> MutexGuard<'static, Self> {
        static GLOBALS: Mutex<TzGlobals> = Mutex::new(TzGlobals(()));
        GLOBALS.lock()
    }
}
