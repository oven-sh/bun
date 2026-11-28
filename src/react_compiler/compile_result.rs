//! Port of `react_compiler/entrypoint/compile_result.rs`.

use crate::diagnostics::CompilerError;

/// Main result type returned by the compile function.
///
/// Upstream returns the rewritten Babel `File` AST by value; the Bun port
/// rewrites `bun_ast::G::Fn` bodies in place, so this carries no AST.
pub enum CompileOutput {
    /// No components/hooks found, or all opted out.
    Unchanged,
    /// At least one function was compiled; bodies were rewritten in place.
    Changed { diagnostics: Vec<CompileDiagnostic> },
    /// `panic_threshold` escalated a compile error to fatal.
    Error { error: CompilerError },
}

pub struct CompileDiagnostic {}
