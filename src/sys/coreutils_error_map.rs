use std::sync::LazyLock;

use enum_map::EnumMap;

use crate::SystemErrno;

/// This map is derived off of what coreutils uses in printing errors. This is
/// equivalent to `strerror`, but as strings with constant lifetime.
//
// PORT NOTE: Zig builds this at comptime via `@hasField`/`@field` reflection over
// `SystemErrno`. Rust has no struct-field reflection, so we build it once at first
// access via `LazyLock`. The per-OS (name → message) string tables themselves
// live canonically in `bun_core::coreutils_error_map` (a `phf::Map` keyed by
// errno *name*); here we just project that table onto the platform's typed
// `SystemErrno` enum so callers get an O(1) `EnumMap` index. Variants whose
// names have no entry in the bun_core table fall back to `UNKNOWN`, matching
// the Zig `@hasField` filter.
pub static COREUTILS_ERROR_MAP: LazyLock<EnumMap<SystemErrno, &'static str>> =
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
pub const UNKNOWN: &str = "unknown error";

/// Spec: Zig `coreutils_error_map.get(errno)` returns `?[]const u8`. The Rust
/// `EnumMap` is total, so we treat the `UNKNOWN` sentinel as `None` to preserve
/// the Zig fallthrough behaviour (callers format `"unknown error {errno}"`).
#[inline]
pub fn get(errno: SystemErrno) -> Option<&'static str> {
    let s = COREUTILS_ERROR_MAP[errno];
    if core::ptr::eq(s.as_ptr(), UNKNOWN.as_ptr()) {
        None
    } else {
        Some(s)
    }
}

// ported from: src/sys/coreutils_error_map.zig
