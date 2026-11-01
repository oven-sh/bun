//! Renders a compiler diagnostic the way eslint-plugin-react-hooks 7.1.1 reports it.
//!
//! The plugin makes one report at the diagnostic's first location, or none if that location is missing. Everything else
//! is text in the message, which is the compiler's `printErrorMessage(source, { eslint: true })`: a heading with the
//! reason, the description, and for each location a @babel/code-frame 7 frame with that location's message.
//!
//! The plugin parses `.ts` and `.tsx` files with Babel's parser and all others with hermes-parser, whose locations have
//! neither a file name nor an offset. So only `.ts` and `.tsx` files get the file name above each frame, and only there
//! do the dependency rules suggest a list.
//!
//! The compiler bundled with the plugin is written in TypeScript and is older than the one here. Where only the wording
//! or the order of a list differs, [`render`] produces the plugin's version.

use crate::finding::{Detail, Finding, Suggestion};
use crate::oxlint::{enclosing_property, find};
use bun_core::strings;
use bun_lint::ast::{BinOp, File};
use bun_lint::span::{Position, Span};
use bun_lint::utils::code_frame::{self, Frame, LineColumn};
use bun_lint::utils::sort;
use bun_react_compiler::diagnostics::{
    CompilerSuggestionOperation, ErrorCategory, format_category_heading,
};
use std::cmp::Ordering;
use std::io::Write;

pub(crate) struct Report {
    pub(crate) message: Vec<u8>,
    pub(crate) span: Span,
    pub(crate) suggestions: Vec<Suggested>,
}

/// An element of `suggest`: `range` is replaced by `text`.
pub(crate) struct Suggested {
    pub(crate) description: Vec<u8>,
    pub(crate) range: Span,
    pub(crate) text: Vec<u8>,
}

/// `None` if the plugin reports nothing.
pub(crate) fn render<'a>(file: &'a File<'a>, finding: &Finding) -> Option<Report> {
    let is_parsed_by_babel = file.path().ends_with(b".ts") || file.path().ends_with(b".tsx");
    let is_about_dependencies = matches!(
        finding.category,
        ErrorCategory::MemoDependencies | ErrorCategory::EffectExhaustiveDependencies
    );
    let has_list = is_parsed_by_babel || !is_about_dependencies;
    // The plugin doesn't say where a function accesses a ref.
    let is_plugin_detail = |it: &&Detail| {
        !matches!(it, Detail::Error { message: Some(detail_message), .. }
            if finding.category == ErrorCategory::Refs
                && matches!(&**detail_message, "The ref is accessed here" | "The ref is updated here"))
    };
    let details = finding.details.iter().filter(is_plugin_detail);
    let details = details.filter(|it| has_list || inferred_dependencies(it).is_none());
    let mut details: Vec<&Detail> = details.collect();
    if is_about_dependencies {
        let missing = (details.iter()).take_while(|it| missing_dependency(it).is_some());
        let missing = missing.count();
        sort::sort_by(details.get_mut(..missing)?, |a, b| {
            match (missing_dependency(a), missing_dependency(b)) {
                (Some(a), Some(b)) => compare_dependencies(a, b),
                _ => Ordering::Equal,
            }
        });
    }

    let first = details
        .iter()
        .position(|it| matches!(it, Detail::Error { .. }))?;
    let Some(Detail::Error { span: Some(at), .. }) = details.get(first) else {
        return None;
    };
    let at = plugin_span(file, finding, *at);
    let reason = plugin_reason(file, finding, at);
    let is_error_detail = is_error_detail(finding, reason);
    if is_error_detail {
        details = details.get(first..=first)?.to_vec();
    }

    let mut message = Vec::new();
    message.extend_from_slice(format_category_heading(finding.category).as_bytes());
    message.extend_from_slice(b": ");
    message.extend_from_slice(reason.as_bytes());
    if let Some(description) = &finding.description {
        message.extend_from_slice(b"\n\n");
        message.extend_from_slice(description.as_bytes());
        message.push(b'.');
    }
    for detail in details {
        let (span, label) = match detail {
            Detail::Hint { message: hint } => {
                message.extend_from_slice(b"\n\n");
                match inferred_dependencies(detail) {
                    Some(list) => {
                        message.extend_from_slice(INFERRED_DEPENDENCIES.as_bytes());
                        write_dependencies(&mut message, list);
                        message.push(b'`');
                    }
                    None => message.extend_from_slice(hint.as_bytes()),
                }
                continue;
            }
            Detail::Error { span: None, .. } => continue,
            Detail::Error {
                span: Some(span),
                message: label,
            } => (plugin_span(file, finding, *span), label.as_deref()),
        };
        // `CompilerError.invariant()` repeats the reason if there's no other message.
        let label = match label {
            _ if is_error_detail => reason,
            None if finding.category == ErrorCategory::Invariant => reason,
            label => label.unwrap_or_default(),
        };
        let (start, end) = (file.position(span.start), file.position(span.end));
        message.extend_from_slice(b"\n\n");
        if is_parsed_by_babel {
            write_path(&mut message, file.path());
            let _ = writeln!(message, ":{}:{}", start.line, start.column + 1);
        }
        if !write_frame(&mut message, file, start, end, label.as_bytes()) && !is_error_detail {
            message.extend_from_slice(label.as_bytes());
        }
        if is_error_detail {
            message.extend_from_slice(b"\n\n");
        }
    }

    let suggestions = (finding.suggestions.iter())
        .filter(|it| has_list || it.description != UPDATE_DEPENDENCIES)
        .map(suggested);
    let mut suggestions: Vec<Suggested> = suggestions.collect();
    if finding.category == ErrorCategory::Syntax
        && suggestions.is_empty()
        && matches!(
            reason,
            "Only object properties can be deleted" | "Throw expressions are not supported"
        )
    {
        suggestions.push(Suggested {
            description: b"Remove this line".to_vec(),
            range: at,
            text: Vec::new(),
        });
    }
    Some(Report {
        message,
        span: at,
        suggestions,
    })
}

/// `makeSuggestions`
fn suggested(suggestion: &Suggestion) -> Suggested {
    let text = suggestion.text.as_deref().unwrap_or_default();
    let mut sorted = Vec::new();
    match suggestion.description == UPDATE_DEPENDENCIES {
        true => write_dependencies(&mut sorted, text),
        false => sorted.extend_from_slice(text.as_bytes()),
    }
    let (range, text) = match suggestion.op {
        CompilerSuggestionOperation::InsertBefore => (Span::empty(suggestion.range.start), sorted),
        CompilerSuggestionOperation::InsertAfter => (Span::empty(suggestion.range.end), sorted),
        CompilerSuggestionOperation::Replace => (suggestion.range, sorted),
        CompilerSuggestionOperation::Remove => (suggestion.range, Vec::new()),
    };
    Suggested {
        description: suggestion.description.as_bytes().to_vec(),
        range,
        text,
    }
}

// ───────────────────────── where the plugin's compiler words things differently ─────────────────────────

/// For a computed key in a pattern, the plugin's compiler points at the whole property.
fn plugin_span<'a>(file: &'a File<'a>, finding: &Finding, at: Span) -> Span {
    let is_computed_key = finding.category == ErrorCategory::Todo
        && finding.reason
            == "(BuildHIR::lowerAssignment) Handle computed properties in ObjectPattern";
    match is_computed_key {
        true => enclosing_property(file, at).unwrap_or(at),
        false => at,
    }
}

fn plugin_reason<'a, 'f>(file: &'a File<'a>, finding: &'f Finding, at: Span) -> &'f str {
    match (finding.category, finding.reason.as_str()) {
        (
            ErrorCategory::Todo,
            reason @ "Logical assignment operators (||=, &&=, ??=) are not yet supported",
        ) => match find(file, at, |node| node.as_expr()?.assign_op()?) {
            Some(BinOp::Or) => {
                "(BuildHIR::lowerExpression) Handle ||= operators in AssignmentExpression"
            }
            Some(BinOp::And) => {
                "(BuildHIR::lowerExpression) Handle &&= operators in AssignmentExpression"
            }
            Some(BinOp::Nullish) => {
                "(BuildHIR::lowerExpression) Handle ??= operators in AssignmentExpression"
            }
            _ => reason,
        },
        (
            ErrorCategory::Todo,
            "UpdateExpression where argument is a global is not yet supported",
        ) => "(BuildHIR::lowerExpression) Support UpdateExpression where argument is a global",
        (_, reason) => reason,
    }
}

/// True if the plugin's compiler makes this a `CompilerErrorDetail` rather than a `CompilerDiagnostic`. That has one
/// location, where the reason is repeated, and its message ends with an empty line. Here, anything thrown is a
/// diagnostic, whatever it is in the plugin's compiler.
fn is_error_detail(finding: &Finding, reason: &str) -> bool {
    match finding.category {
        ErrorCategory::Invariant => matches!(
            reason,
            "(BuildHIR::lowerAssignment) Could not find binding for declaration."
                | "(BuildHIR::lowerExpression) Found an invalid UpdateExpression without a previously reported error"
                | "Unexpected compiled functions when module scope opt-out is present"
        ),
        ErrorCategory::Todo => {
            !matches!(
                reason,
                "Support duplicate fbt tags"
                    | "Support destructuring of context variables"
                    | "ValidateContextVariableLValues: unhandled instruction variant"
            ) && !reason.starts_with("Important source location ")
                && !(reason.starts_with("Handle ") && reason.ends_with(" parameters"))
        }
        ErrorCategory::Gating => true,
        _ => finding.is_error_detail,
    }
}

// ──────────────────────────────── dependency lists ───────────────────────────────

const INFERRED_DEPENDENCIES: &str = "Inferred dependencies: `";
const UPDATE_DEPENDENCIES: &str = "Update dependencies";

/// The `[a, b.c]` in the hint that lists the inferred dependencies.
fn inferred_dependencies(detail: &Detail) -> Option<&str> {
    let Detail::Hint { message } = detail else {
        return None;
    };
    message
        .strip_prefix(INFERRED_DEPENDENCIES)?
        .strip_suffix('`')
}

fn missing_dependency(detail: &Detail) -> Option<&[u8]> {
    let Detail::Error {
        message: Some(message),
        ..
    } = detail
    else {
        return None;
    };
    let rest = message.strip_prefix("Missing dependency `")?.as_bytes();
    rest.get(..strings::index_of_char_usize(rest, b'`')?)
}

/// The variable and properties of `a.b?.c`, each with a flag for whether it follows a `?.`.
fn parts(dependency: &[u8]) -> Vec<(bool, &[u8])> {
    let mut is_optional = false;
    let parts = strings::split(dependency, b".").map(|part| {
        let (name, is_next_optional) = match part.split_last() {
            Some((b'?', name)) => (name, true),
            _ => (part, false),
        };
        (std::mem::replace(&mut is_optional, is_next_optional), name)
    });
    parts.collect()
}

/// The plugin's order for inferred dependencies, which compares names with `localeCompare`. The compiler here sorts
/// them by bytes.
fn compare_dependencies(a: &[u8], b: &[u8]) -> Ordering {
    let (a, b) = (parts(a), parts(b));
    if let (Some(a), Some(b)) = (a.first(), b.first())
        && a.1 != b.1
    {
        return strings::locale_compare(a.1, b.1);
    }
    if a.len() != b.len() {
        return a.len().cmp(&b.len());
    }
    for (a, b) in a.iter().zip(&b) {
        if a.0 != b.0 {
            return b.0.cmp(&a.0);
        }
        if a.1 != b.1 {
            return strings::locale_compare(a.1, b.1);
        }
    }
    Ordering::Equal
}

/// Writes `list`, which looks like `[a, b.c]`, sorted in that order.
fn write_dependencies(out: &mut Vec<u8>, list: &str) {
    let Some(inner) = list.strip_prefix('[').and_then(|it| it.strip_suffix(']')) else {
        return out.extend_from_slice(list.as_bytes());
    };
    let mut all: Vec<&[u8]> = strings::split(inner.as_bytes(), b", ").collect();
    sort::sort_by(&mut all, |a, b| compare_dependencies(a, b));
    out.push(b'[');
    out.extend_from_slice(&all.join(&b", "[..]));
    out.push(b']');
}

// ───────────────────────────── the frame ─────────────────────────────

/// ESLint's `context.filename`, with the platform's path separators.
fn write_path(out: &mut Vec<u8>, path: &[u8]) {
    let from = out.len();
    out.extend_from_slice(path);
    if cfg!(windows) {
        for byte in out.iter_mut().skip(from).filter(|byte| **byte == b'/') {
            *byte = b'\\';
        }
    }
}

const LINES_ABOVE: u32 = 2;
const LINES_BELOW: u32 = 3;
/// A range with more lines than this only shows its start and end.
const MAX_LINES: u32 = 10;
const ABBREVIATED_LINES: u32 = 5;

/// `printCodeFrame`. Returns false without writing anything where that throws.
fn write_frame(
    out: &mut Vec<u8>,
    file: &File,
    start: Position,
    end: Position,
    message: &[u8],
) -> bool {
    let frame_position = |at: Position| LineColumn {
        line: at.line,
        column: Some(at.column + 1),
    };
    let frame = Frame {
        start: frame_position(start),
        end: Some(frame_position(end)),
        message,
        lines_above: LINES_ABOVE,
        lines_below: LINES_BELOW,
    };
    if end.line.saturating_sub(start.line) < MAX_LINES {
        return code_frame::write(out, file, &frame);
    }
    // Upstream cuts by rendered rows, and a line inside the range renders as two. Rendering N lines gives at least N
    // rows, which are then trimmed to N.
    let (first_rows, last_rows) = (
        LINES_ABOVE + ABBREVIATED_LINES,
        LINES_BELOW + ABBREVIATED_LINES,
    );
    let top = start.line.saturating_sub(LINES_ABOVE + 1) + 1;
    let bottom = file.line_count().min(end.line + LINES_BELOW);
    let from = out.len();
    if !code_frame::write_rows_of(out, file, &frame, &(top..top + first_rows)) {
        return false;
    }
    let rendered = out.get(from..).unwrap_or_default();
    let gutter = strings::index_of_char_usize(rendered, b'|').unwrap_or(0);
    let mut head_len = 0;
    for _ in 0..first_rows {
        let rest = rendered.get(head_len..).unwrap_or_default();
        head_len += strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len()) + 1;
    }
    out.truncate(from + head_len - 1);
    out.push(b'\n');
    out.resize(out.len() + gutter, b' ');
    out.extend_from_slice("…\n".as_bytes());

    let from = out.len();
    let tail_lines = bottom.saturating_sub(last_rows - 1)..bottom + 1;
    code_frame::write_rows_of(out, file, &frame, &tail_lines);
    let mut tail_start = out.len();
    for _ in 0..last_rows {
        let before = out.get(from..tail_start).unwrap_or_default();
        match strings::last_index_of_char(before, b'\n') {
            Some(at) => tail_start = from + at,
            None => return true,
        }
    }
    out.drain(from..=tail_start);
    true
}
