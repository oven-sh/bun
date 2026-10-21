//! The helpers that the ports of oxlint's rules are written with: its `ast_util.rs` and `utils`, and the `oxc_ast`,
//! `oxc_codegen` and `oxc_semantic` methods they call, ported to `bun_lint`'s AST handles.
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
