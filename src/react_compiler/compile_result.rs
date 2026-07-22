//! Port of `react_compiler/entrypoint/compile_result.rs`.

#![allow(
    unreachable_pub,
    reason = "ported types consumed by sibling stubs not yet wired"
)]

use crate::diagnostics::{CompilerError, SourceLocation};

/// Source location with index and filename fields for logger event serialization.
/// Matches the Babel SourceLocation format that the TS compiler emits in logger events.
#[derive(Debug, Clone)]
pub struct LoggerSourceLocation {
    pub start: LoggerPosition,
    pub end: LoggerPosition,
    pub filename: Option<String>,
    pub identifier_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LoggerPosition {
    pub line: u32,
    pub column: u32,
    pub index: Option<u32>,
}

impl LoggerSourceLocation {
    /// Create from a diagnostics SourceLocation, adding index and filename.
    pub fn from_loc(
        loc: &SourceLocation,
        filename: Option<&str>,
        start_index: Option<u32>,
        end_index: Option<u32>,
    ) -> Self {
        Self {
            start: LoggerPosition {
                line: loc.start.line,
                column: loc.start.column,
                index: start_index,
            },
            end: LoggerPosition {
                line: loc.end.line,
                column: loc.end.column,
                index: end_index,
            },
            filename: filename.map(|s| s.to_string()),
            identifier_name: None,
        }
    }

    /// Create from a diagnostics SourceLocation without index or filename.
    pub fn from_loc_simple(loc: &SourceLocation) -> Self {
        Self {
            start: LoggerPosition {
                line: loc.start.line,
                column: loc.start.column,
                index: None,
            },
            end: LoggerPosition {
                line: loc.end.line,
                column: loc.end.column,
                index: None,
            },
            filename: None,
            identifier_name: None,
        }
    }
}

/// A variable rename from lowering, serialized for the JS shim.
#[derive(Debug, Clone)]
pub struct BindingRenameInfo {
    pub original: String,
    pub renamed: String,
    pub declaration_start: u32,
}

/// Main result type returned by the compile function.
///
/// Upstream returns the rewritten Babel `File` AST by value; the Bun port
/// rewrites `bun_ast::G::Fn` bodies in place, so this carries no AST.
pub enum CompileOutput {
    /// No components/hooks found, or all opted out.
    Unchanged,
    /// At least one function was compiled; bodies were rewritten in place.
    Changed {
        diagnostics: Vec<CompileDiagnostic>,
        events: Vec<LoggerEvent>,
        ordered_log: Vec<OrderedLogItem>,
        /// Bindings the lowerer renamed; the caller must patch references in
        /// the surrounding (uncompiled) scope.
        renames: Vec<BindingRenameInfo>,
    },
    /// `panic_threshold` escalated a compile error to fatal. Carries the logger
    /// events emitted for earlier functions in the file so the caller can flush
    /// them before throwing.
    Error {
        error: CompilerError,
        events: Vec<LoggerEvent>,
        ordered_log: Vec<OrderedLogItem>,
    },
}

pub struct CompileDiagnostic {
}

/// An item in the ordered log, which can be either a logger event or a debug entry.
#[derive(Debug, Clone)]
#[allow(
    clippy::large_enum_variant,
    reason = "LoggerEvent is from vendored react_compiler_hir; boxing would diverge from upstream's by-value shape"
)]
pub enum OrderedLogItem {
    Event { event: LoggerEvent },
    Debug { entry: DebugLogEntry },
}

/// Serializable error detail — flat plain object matching the TS
/// `formatDetailForLogging()` output. All fields are direct properties.
#[derive(Debug, Clone)]
pub struct CompilerErrorDetailInfo {
    pub category: String,
    pub reason: String,
    pub description: Option<String>,
    pub severity: String,
    pub suggestions: Option<Vec<LoggerSuggestionInfo>>,
    pub details: Option<Vec<CompilerErrorItemInfo>>,
    pub loc: Option<LoggerSourceLocation>,
}

/// Serializable suggestion info for logger events.
#[derive(Debug, Clone)]
pub struct LoggerSuggestionInfo {
    pub description: String,
    pub op: LoggerSuggestionOp,
    pub range: (usize, usize),
    pub text: Option<String>,
}

/// Numeric enum matching TS `CompilerSuggestionOperation`.
/// Serialized as the numeric discriminant (0-3), not the variant name.
#[derive(Debug, Clone, Copy)]
pub enum LoggerSuggestionOp {
    InsertBefore = 0,
    InsertAfter = 1,
    Remove = 2,
    Replace = 3,
}

/// Individual error or hint item within a CompilerErrorDetailInfo.
#[derive(Debug, Clone)]
pub struct CompilerErrorItemInfo {
    pub kind: String,
    pub loc: Option<LoggerSourceLocation>,
    /// Serialized as `null` when None (not omitted), matching TS behavior.
    pub message: Option<String>,
}

/// Debug log entry for debugLogIRs support.
/// Currently only supports the 'debug' variant (string values).
#[derive(Debug, Clone)]
pub struct DebugLogEntry {
    pub kind: &'static str,
    pub name: String,
    pub value: String,
}

impl DebugLogEntry {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            kind: "debug",
            name: name.into(),
            value: value.into(),
        }
    }
}

/// Logger events emitted during compilation.
/// These are returned to JS for the logger callback.
#[derive(Debug, Clone)]
pub enum LoggerEvent {
    CompileSuccess {
        fn_loc: Option<LoggerSourceLocation>,
        fn_name: Option<String>,
        memo_slots: u32,
        memo_blocks: u32,
        memo_values: u32,
        pruned_memo_blocks: u32,
        pruned_memo_values: u32,
    },
    CompileError {
        detail: CompilerErrorDetailInfo,
        fn_loc: Option<LoggerSourceLocation>,
    },
    /// Serializes as `kind: "CompileError"` (same tag as `CompileError`); this
    /// variant exists only to force fnLoc-before-detail field order.
    CompileErrorWithLoc {
        fn_loc: LoggerSourceLocation,
        detail: CompilerErrorDetailInfo,
    },
    CompileSkip {
        fn_loc: Option<LoggerSourceLocation>,
        reason: String,
        loc: Option<LoggerSourceLocation>,
    },
    CompileUnexpectedThrow {
        fn_loc: Option<LoggerSourceLocation>,
        data: String,
    },
    PipelineError {
        fn_loc: Option<LoggerSourceLocation>,
        data: String,
    },
}
