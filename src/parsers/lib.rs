#![warn(unused_must_use)]
#![allow(unexpected_cfgs)]
// `Vec<T, bun_alloc::AstAlloc>` (the AST's PropertyList / ExprNodeList) is
// built directly by the JSON parser.
#![feature(allocator_api)]

// ───── json ───────────────────────────────────────────────────────────────
// Two-stage JSON/JSONC parser:
//   `json_index`  — stage 1: the structural indexer (Highway SIMD kernel with
//                   a comment/single-quote-aware scalar fallback)
//   `json_stage2` — stage 2: recursive descent over the index array
//   `json`        — the public entry points + options
pub mod json_index;
mod json_stage2;

// Native shims so `cargo test -p bun_parsers` links without Bun's C++ side
// (see scripts/bench-json-rust.sh --test).
#[cfg(test)]
mod native_test_shims;

#[path = "json.rs"]
pub mod json;

/// Downstream Rust crates name it both `json` and `json_parser`; alias the
/// latter here.
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
