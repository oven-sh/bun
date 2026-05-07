#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// B-2: Phase-A draft modules un-gated. Fn bodies / items that depend on
// lower-tier symbols not yet available are individually re-gated inside the
// module with `` and a `// TODO(b2-blocked): bun_X::Y` marker.

#[path = "expr_jsc.rs"]
pub mod expr_jsc;
#[path = "Macro.rs"]
pub mod Macro;

// Re-export the foreign `Expr` alongside its JSC extension trait so downstream
// callers can write `bun_js_parser_jsc::Expr` / `expr.to_js(global)` without
// also depending on `bun_js_parser` directly.
pub use bun_js_parser::Expr;
pub use expr_jsc::{data_to_js, expr_to_js, string_to_js, value_string_to_js, ExprJsc};
