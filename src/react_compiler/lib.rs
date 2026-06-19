//! React Compiler integration for Bun — direct lowering.
//!
//! See [`DESIGN.md`](./DESIGN.md). This crate ports the upstream
//! AST-boundary code (`react_compiler_lowering`, `codegen_reactive_function`,
//! `react_compiler::entrypoint`) to read and write `bun_ast` directly, and
//! depends on the vendored HIR-level crates unmodified.

#![allow(dead_code, unused_imports, unused_variables)]

pub mod diagnostics;
pub mod hir;
pub mod inference;
pub mod optimization;
pub mod reactive_scopes;
pub mod ssa;
pub mod typeinference;
pub mod utils;
pub mod validation;

pub use hir::environment;
pub use hir::environment_config::EnvironmentConfig;

mod compile_result;
mod gating;
mod imports;
mod options;
mod suppression;

pub mod codegen;
pub mod lowering;
pub mod pipeline;
pub mod program;

pub use compile_result::{CompileDiagnostic, CompileOutput};
pub use options::ReactCompilerOptions;
pub use program::{
    Host, JsxImportKind, ReactCompilerState, SymbolHost, finish, has_module_scope_opt_out,
    maybe_compile_expr, maybe_compile_function,
};
