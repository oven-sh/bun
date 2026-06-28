#![warn(unused_must_use)]
#![allow(unexpected_cfgs)]

// ───── json_lexer ─────────────────────────────────────────────────────────
// JSON-only subset of `bun_js_parser::js_lexer`. Breaks the
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

/// Downstream Rust crates name it both `json` and `json_parser`; alias the
/// latter here.
pub use json as json_parser;

// ───── json_simd ──────────────────────────────────────────────────────────
// simdjson-style two-stage strict-JSON parser. Stage 1 lives in
// `highway_json.cpp`; stage 2 here.
#[path = "json_simd.rs"]
pub mod json_simd;

// ───── json_cursor ────────────────────────────────────────────────────────
// On-demand cursor over stage-1 indices for sparse reads (npm packuments,
// package.json name/version).
#[path = "json_cursor.rs"]
pub mod json_cursor;

// ───── json5 ──────────────────────────────────────────────────────────────
#[path = "json5.rs"]
pub mod json5;

// ───── toml ───────────────────────────────────────────────────────────────
#[path = "toml.rs"]
pub mod toml;

// ───── yaml ───────────────────────────────────────────────────────────────
#[path = "yaml.rs"]
pub mod yaml;
