//! Single source of truth for Bun's `<tag>` → ANSI colour table.
//!
//! Port of `color_map` from `src/bun_core/output.zig:965-1056`. The Zig spec
//! has exactly one `color_map` and one `prettyFmt`; in Rust the compile-time
//! rewriter must live in a `proc-macro = true` crate (`bun_core_macros`) which
//! cannot export non-macro items, and the runtime rewriter lives in `bun_core`
//! which the macro crate cannot depend on. This zero-dep leaf crate is the
//! shared lookup both sides import so the table is defined once.

#![no_std]

/// `(tag, ansi_escape)` pairs. 14 entries — linear scan in [`color_for`] is
/// intentional; this is only hit on `<tag>` markers in diagnostic-output paths.
pub const COLOR_TABLE: &[(&str, &str)] = &[
    ("b", "\x1b[1m"),
    ("d", "\x1b[2m"),
    ("i", "\x1b[3m"),
    ("u", "\x1b[4m"),
    ("black", "\x1b[30m"),
    ("red", "\x1b[31m"),
    ("green", "\x1b[32m"),
    ("yellow", "\x1b[33m"),
    ("blue", "\x1b[34m"),
    ("magenta", "\x1b[35m"),
    ("cyan", "\x1b[36m"),
    ("white", "\x1b[37m"),
    ("bgred", "\x1b[41m"),
    ("bggreen", "\x1b[42m"),
];

/// `</…>` / `<r>` reset sequence.
pub const RESET: &str = "\x1b[0m";

/// ANSI escape for a `<tag>` body. `None` → unknown tag.
#[inline]
pub fn color_for(name: &str) -> Option<&'static str> {
    for &(k, v) in COLOR_TABLE {
        if k == name {
            return Some(v);
        }
    }
    None
}

/// Byte-slice form of [`color_for`] for callers working over `&[u8]` templates
/// (mirrors Zig's `ComptimeStringMap.get`).
#[inline]
pub fn color_for_bytes(name: &[u8]) -> Option<&'static str> {
    for &(k, v) in COLOR_TABLE {
        if k.as_bytes() == name {
            return Some(v);
        }
    }
    None
}
