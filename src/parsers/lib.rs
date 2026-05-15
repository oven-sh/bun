#![feature(allocator_api)]
// ──────────────────────────────────────────────────────────────────────────
// B-2 UN-GATE
//   Phase-A draft bodies are progressively un-gated and made to compile.
//   Modules that remain blocked on lower-tier MOVE_DOWN symbols (chiefly
//   `bun_ast::js_ast`) keep a `` gate on the affected items
//   only, with `// TODO(b2-blocked): bun_X::Y` markers.
// ──────────────────────────────────────────────────────────────────────────
#![allow(dead_code)]
#![allow(unused_imports)]
#![warn(unused_must_use)]
#![allow(unused_variables)]
#![allow(unused_assignments)]
#![allow(unexpected_cfgs)]
#![allow(clippy::all)]
// PORTING.md crate-map calls the string crate `bun_str`; the workspace package
// is `bun_string`. Alias once here so submodule `use bun_core::…` paths resolve.
#![warn(unreachable_pub)]
extern crate bun_core as bun_str;

// ───── json_lexer ─────────────────────────────────────────────────────────
// JSON-only subset of `bun_js_parser::js_lexer`, sliced from
// `src/js_parser/lexer.zig` with `is_json = true` arms taken. Breaks the
// GENUINE T4 cycle (`bun_js_parser` → `bun_interchange` → `bun_js_parser`)
// so `json.rs` can build without an upward dep. See module doc-comment.
// Crate-private: implementation detail of `json.rs`; no external consumers.
mod json_lexer;

// ───── json ───────────────────────────────────────────────────────────────
// Real port — wired against `crate::json_lexer` (the cycle-break above) and
// `bun_ast::js_ast`; resolves against the local lexer so `bun_js_parser`
// is not an upward dep.
#[path = "json.rs"]
pub mod json;

/// Zig-side import path is `bun.json` (the parser module). Downstream Rust
/// crates name it both `json` and `json_parser`; alias the latter here.
pub use json as json_parser;

// ───── json5 ──────────────────────────────────────────────────────────────
#[path = "json5.rs"]
pub mod json5;

// ───── toml ───────────────────────────────────────────────────────────────
#[path = "toml.rs"]
pub mod toml;

// ───── yaml ───────────────────────────────────────────────────────────────
#[path = "yaml.rs"]
pub mod yaml;

// ported from: src/interchange/interchange.zig
