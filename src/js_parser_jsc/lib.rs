#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod error;
pub use error::{Error, Result};

#[path = "Macro.rs"]
pub mod Macro;
#[path = "expr_jsc.rs"]
pub mod expr_jsc;

// Re-export the foreign `Expr` alongside its JSC extension trait so downstream
// callers can write `bun_js_parser_jsc::Expr` / `expr.to_js(global)` without
// also depending on `bun_js_parser` directly.
pub use expr_jsc::{ExprJsc, data_to_js, expr_to_js, string_to_js, value_string_to_js};
