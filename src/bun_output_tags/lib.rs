//! Single source of truth for Bun's `<tag>` → ANSI colour table **and** the
//! named ANSI escape constants used directly by REPL / diff-printer / multi-run
//! output. Zero-dep `#![no_std]` leaf so both the proc-macro crate and runtime
//! crates can import it without a cycle.
//!
//! Port of `color_map` from `src/bun_core/output.zig:965-1056`. Zig re-declares
//! the escapes per-file (repl.zig, printDiff.zig, multi_run.zig); the Rust port
//! collapses them onto [`ansi`].

#![no_std]

/// Named ANSI SGR escape sequences. One canonical literal per colour/attribute;
/// every other crate aliases this module rather than re-declaring the bytes.
///
/// `WHITE` is SGR 37 (normal). printDiff.zig:177 uses SGR 97 — that is
/// [`BRIGHT_WHITE`], kept distinct so diff output stays byte-identical.
pub mod ansi {
    pub const RESET: &str = "\x1b[0m";
    pub const BOLD: &str = "\x1b[1m";
    pub const DIM: &str = "\x1b[2m";
    pub const ITALIC: &str = "\x1b[3m";
    pub const UNDERLINE: &str = "\x1b[4m";
    pub const INVERT: &str = "\x1b[7m";
    pub const BLACK: &str = "\x1b[30m";
    pub const RED: &str = "\x1b[31m";
    pub const GREEN: &str = "\x1b[32m";
    pub const YELLOW: &str = "\x1b[33m";
    pub const BLUE: &str = "\x1b[34m";
    pub const MAGENTA: &str = "\x1b[35m";
    pub const CYAN: &str = "\x1b[36m";
    pub const WHITE: &str = "\x1b[37m";
    pub const BRIGHT_WHITE: &str = "\x1b[97m";
    pub const BG_RED: &str = "\x1b[41m";
    pub const BG_GREEN: &str = "\x1b[42m";
}

/// `(tag, ansi_escape)` pairs. 14 entries — linear scan in [`color_for`] is
/// intentional; this is only hit on `<tag>` markers in diagnostic-output paths.
pub const COLOR_TABLE: &[(&str, &str)] = &[
    ("b", ansi::BOLD),
    ("d", ansi::DIM),
    ("i", ansi::ITALIC),
    ("u", ansi::UNDERLINE),
    ("black", ansi::BLACK),
    ("red", ansi::RED),
    ("green", ansi::GREEN),
    ("yellow", ansi::YELLOW),
    ("blue", ansi::BLUE),
    ("magenta", ansi::MAGENTA),
    ("cyan", ansi::CYAN),
    ("white", ansi::WHITE),
    ("bgred", ansi::BG_RED),
    ("bggreen", ansi::BG_GREEN),
];

/// `</…>` / `<r>` reset sequence.
pub use ansi::RESET;

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
