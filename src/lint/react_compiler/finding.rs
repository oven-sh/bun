//! The React Compiler's diagnostics for a function, with spans into the file's text.

use bun_lint::span::Span;
use bun_react_compiler::diagnostics::{CompilerSuggestionOperation, ErrorCategory};

/// One of the compiler's `CompilerDiagnostic`s or `CompilerErrorDetail`s.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finding {
    pub category: ErrorCategory,
    pub reason: String,
    pub description: Option<String>,
    /// In the order the compiler added them. A `CompilerErrorDetail` has exactly one, a
    /// [`Detail::Error`] without a message.
    pub details: Vec<Detail>,
    pub suggestions: Vec<Suggestion>,
    /// True if it was a `CompilerErrorDetail`, which has one span and no separate message.
    pub is_error_detail: bool,
    /// oxc's `FunctionNode::diagnostic_span()` for the compiled function. A diagnostic without a
    /// span is reported there.
    pub function_span: Option<Span>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Detail {
    Error {
        span: Option<Span>,
        message: Option<String>,
    },
    Hint {
        message: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Suggestion {
    pub op: CompilerSuggestionOperation,
    pub range: Span,
    pub description: String,
    /// `None` for `Remove`.
    pub text: Option<String>,
}
