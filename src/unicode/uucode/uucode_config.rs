//! Build-time uucode table configuration.
//! Selects which Unicode properties the vendored `uucode` library should
//! compute into its lookup tables. See this directory's CLAUDE.md.

use super::config;
// TODO(port): path reaches into vendored third-party `../uucode_lib/src/x/config.x.zig`.
// Phase B decides whether `uucode_lib` is its own crate or a module under `bun_unicode`;
// the `src` segment is the Zig package root and likely collapses.
use crate::uucode_lib::src::x::config_x;

use config_x::grapheme_break_no_control;

pub const TABLES: &[config::Table] = &[
    config::Table {
        name: b"buildtime",
        extensions: &[
            grapheme_break_no_control,
        ],
        fields: &[
            // TODO(port): requires `.field()` to be a `const fn` on the extension type
            grapheme_break_no_control.field(b"grapheme_break_no_control"),
        ],
    },
];

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/unicode/uucode/uucode_config.zig (16 lines)
//   confidence: medium
//   todos:      2
//   notes:      build-time-only config for vendored uucode codegen; Table field types & uucode_lib crate path TBD in Phase B
// ──────────────────────────────────────────────────────────────────────────
