//! What the ports of oxlint's rules are written with: its `ast_util.rs` and `utils`, and the methods of `oxc_ast`, `oxc_codegen` and
//! `oxc_semantic` that they call, on the handles of `bun_lint`.
//! https://github.com/oxc-project/oxc (Copyright VoidZero Inc. and contributors, MIT License)

#![forbid(unsafe_code)]
#![deny(clippy::iter_over_hash_type)]

pub mod ast_util;
pub mod codegen;
pub mod hash_order;
pub mod import;
pub mod module_record;
pub mod no_negated_condition;
pub mod regex_flags;
pub mod regex_pattern;
pub mod same_expression;
pub mod text;
