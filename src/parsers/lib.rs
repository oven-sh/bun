#![warn(unused_must_use)]
#![allow(unexpected_cfgs)]

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
