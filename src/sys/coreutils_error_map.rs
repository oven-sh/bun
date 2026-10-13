use std::sync::LazyLock;

use enum_map::EnumMap;

use crate::SystemErrno;

/// This map is derived off of what coreutils uses in printing errors. This is
/// equivalent to `strerror`, but as strings with constant lifetime.
//
// Built once at first access via `LazyLock`. The per-OS (name → message)
// string tables themselves live canonically in
// `bun_core::coreutils_error_map` (a `comptime_string_map!` keyed by errno
// *name*); here
// we just project that table onto the platform's typed `SystemErrno` enum so
// callers get an O(1) `EnumMap` index. Variants whose names have no entry in
// the bun_core table fall back to `UNKNOWN`.
pub(crate) static COREUTILS_ERROR_MAP: LazyLock<EnumMap<SystemErrno, &'static str>> =
    LazyLock::new(|| {
        let map = EnumMap::from_fn(|errno: SystemErrno| {
            bun_core::coreutils_error_map::get_by_name(<&'static str>::from(errno))
                .unwrap_or(UNKNOWN)
        });

        // sanity check
        debug_assert!(map[SystemErrno::ENOENT] == "No such file or directory");

        map
    });

/// Sentinel default for errnos with no coreutils label. Stored by pointer
/// identity in `COREUTILS_ERROR_MAP` so `get()` can distinguish "unmapped"
/// from a real entry.
const UNKNOWN: &str = "unknown error";

/// The
/// `EnumMap` is total, so we treat the `UNKNOWN` sentinel as `None` so callers
/// can fall through (they format `"unknown error {errno}"`).
#[inline]
pub fn get(errno: SystemErrno) -> Option<&'static str> {
    let s = COREUTILS_ERROR_MAP[errno];
    if core::ptr::eq(s.as_ptr(), UNKNOWN.as_ptr()) {
        None
    } else {
        Some(s)
    }
}
