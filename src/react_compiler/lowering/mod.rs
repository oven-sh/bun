//! Port of `react_compiler_lowering` reading `bun_ast` directly.
//!
//! Upstream: `vendor/react-compiler/crates/react_compiler_lowering/src/`.
//! Control flow and pass ordering are kept 1:1; only AST reads change (see
//! the type-mapping table in `../DESIGN.md`).
//!
//! Two callers hand it a tree: the parser, after its visit pass, and `bun lint`, which makes one of
//! the function it lints (`src/lint/react_compiler/convert.rs`). A shape that is read here has to
//! be made there.

mod build_hir;
mod find_context_identifiers;
mod hir_builder;

pub(crate) use build_hir::lower;
pub use hir_builder::FunctionNode;
pub(crate) use hir_builder::convert_loc;
