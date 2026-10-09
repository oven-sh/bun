//! What the React Compiler says of a function, with places in the text of the file.

use bun_lint::span::Span;
use bun_react_compiler::diagnostics::{CompilerSuggestionOperation, ErrorCategory};

/// One `CompilerDiagnostic` or `CompilerErrorDetail` of the compiler.
#[derive(Clone, Debug)]
pub struct Finding {
    pub category: ErrorCategory,
    pub reason: String,
    pub description: Option<String>,
    /// In the order in which the compiler added them. A `CompilerErrorDetail` has one, an
    /// [`Detail::Error`] without a message.
    pub details: Vec<Detail>,
    pub suggestions: Vec<Suggestion>,
    /// It was a `CompilerErrorDetail`: one place, no message of its own.
    pub is_error_detail: bool,
    /// oxc's `FunctionNode::diagnostic_span()` of the function that was compiled: where a diagnostic
    /// without a place of its own is reported.
    pub function_span: Option<Span>,
}

#[derive(Clone, Debug)]
pub enum Detail {
    Error {
        span: Option<Span>,
        message: Option<String>,
    },
    Hint {
        message: String,
    },
}

#[derive(Clone, Debug)]
pub struct Suggestion {
    pub op: CompilerSuggestionOperation,
    pub range: Span,
    pub description: String,
    /// `None` for `Remove`.
    pub text: Option<String>,
}
