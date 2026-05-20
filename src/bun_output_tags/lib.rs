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
    pub const STRIKETHROUGH: &str = "\x1b[9m";
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

/// Byte-slice views of [`ansi`] for callers that write into `&[u8]` buffers
/// (md ANSI renderer, stack-frame colour codes). `str::as_bytes` is a `const
/// fn`, so each constant is the *same* static storage as its `&str` twin —
/// no second copy of the escape bytes is emitted.
pub mod ansi_b {
    use super::ansi;
    pub const RESET: &[u8] = ansi::RESET.as_bytes();
    pub const BOLD: &[u8] = ansi::BOLD.as_bytes();
    pub const DIM: &[u8] = ansi::DIM.as_bytes();
    pub const ITALIC: &[u8] = ansi::ITALIC.as_bytes();
    pub const UNDERLINE: &[u8] = ansi::UNDERLINE.as_bytes();
    pub const INVERT: &[u8] = ansi::INVERT.as_bytes();
    pub const STRIKETHROUGH: &[u8] = ansi::STRIKETHROUGH.as_bytes();
    pub const BLACK: &[u8] = ansi::BLACK.as_bytes();
    pub const RED: &[u8] = ansi::RED.as_bytes();
    pub const GREEN: &[u8] = ansi::GREEN.as_bytes();
    pub const YELLOW: &[u8] = ansi::YELLOW.as_bytes();
    pub const BLUE: &[u8] = ansi::BLUE.as_bytes();
    pub const MAGENTA: &[u8] = ansi::MAGENTA.as_bytes();
    pub const CYAN: &[u8] = ansi::CYAN.as_bytes();
    pub const WHITE: &[u8] = ansi::WHITE.as_bytes();
    pub const BRIGHT_WHITE: &[u8] = ansi::BRIGHT_WHITE.as_bytes();
    pub const BG_RED: &[u8] = ansi::BG_RED.as_bytes();
    pub const BG_GREEN: &[u8] = ansi::BG_GREEN.as_bytes();
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
