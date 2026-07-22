//! Port of `react_compiler_lowering` reading `bun_ast` directly.
//!
//! Upstream: `vendor/react-compiler/crates/react_compiler_lowering/src/`.
//! Control flow and pass ordering are kept 1:1; only AST reads change (see
//! the type-mapping table in `../DESIGN.md`).

mod build_hir;
mod find_context_identifiers;
mod hir_builder;

pub(crate) use build_hir::lower;
pub(crate) use hir_builder::{FunctionNode, };
