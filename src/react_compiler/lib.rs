//! React Compiler integration for Bun — direct lowering.
//!
//! See [`DESIGN.md`](./DESIGN.md). This crate ports the upstream
//! AST-boundary code (`react_compiler_lowering`, `codegen_reactive_function`,
//! `react_compiler::entrypoint`) to read and write `bun_ast` directly, and
//! depends on the vendored HIR-level crates unmodified.

#![feature(allocator_api)]

pub mod collections;
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
mod imports;
mod options;

pub mod codegen;
pub mod lowering;
pub(crate) mod pipeline;
pub mod program;

pub use compile_result::{CompileDiagnostic, CompileOutput};
pub use options::ReactCompilerOptions;
pub use program::{
    CompileResult, Host, JsxImportKind, PendingCompile, ReactCompilerState, SymbolHost,
    collect_import_bindings, finish, has_module_scope_opt_out, maybe_compile_pending,
};
