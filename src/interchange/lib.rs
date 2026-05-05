// ──────────────────────────────────────────────────────────────────────────
// B-2 UN-GATE
//   Phase-A draft bodies are progressively un-gated and made to compile.
//   Modules that remain blocked on lower-tier MOVE_DOWN symbols (chiefly
//   `bun_logger::js_ast`) keep a `#[cfg(any())]` gate on the affected items
//   only, with `// TODO(b2-blocked): bun_X::Y` markers.
// ──────────────────────────────────────────────────────────────────────────

#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]
#![allow(unused_assignments)]
#![allow(unexpected_cfgs)]
#![allow(clippy::all)]

// PORTING.md crate-map calls the string crate `bun_str`; the workspace package
// is `bun_string`. Alias once here so submodule `use bun_str::…` paths resolve.
extern crate bun_string as bun_str;

// ───── json ───────────────────────────────────────────────────────────────
// Blocked wholesale: depends on `bun_js_parser::js_lexer` (GENUINE same-tier
// cycle per CYCLEBREAK §interchange) plus `bun_logger::{js_ast,js_printer}`
// (MOVE_DOWN not yet landed in T2).
#[cfg(any())]
#[path = "json.rs"]
pub mod json_draft;

pub mod json {
    // TODO(b2-blocked): bun_logger::js_ast::Expr
    // TODO(b2-blocked): bun_logger::js_printer
    // TODO(b2-blocked): bun_js_parser::js_lexer (GENUINE cycle — needs js_lexer split)
    /// Opaque stub for `json::Expr` (re-export of `bun_logger::js_ast::Expr`).
    pub struct Expr(());
}

// ───── json5 ──────────────────────────────────────────────────────────────
#[path = "json5.rs"]
pub mod json5;

// ───── toml ───────────────────────────────────────────────────────────────
#[path = "toml.rs"]
pub mod toml;

// ───── yaml ───────────────────────────────────────────────────────────────
// Scanner + utility types compile against a local opaque `Expr` stub; the
// AST-producing parse_* fns remain gated on the js_ast MOVE_DOWN.
#[path = "yaml.rs"]
pub mod yaml;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/interchange/interchange.zig (4 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export crate root; submodules ported separately
// ──────────────────────────────────────────────────────────────────────────
