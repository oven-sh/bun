//! Comments that switch the rules of React off, which make the compiler leave a function alone: oxc's
//! `react_compiler/entrypoint/suppression.rs`, without the suppressions of Flow (`flow_suppressions: false`).
//!
//! `eslint-plugin-react-hooks` has the compiler look for none of these. It looks for comments of Flow itself, and drops single
//! diagnostics for them: [`remove_what_flow_suppresses`].

use crate::finding::{Detail, Finding, Suggestion};
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::tokens::{Token, TokenKind};
use bun_react_compiler::diagnostics::{CompilerSuggestionOperation, ErrorCategory};

/// From a comment that disables a rule to the one that enables it again. For `eslint-disable-next-line` both are the same
/// comment. For `eslint-disable` there is no `enable_comment`: see [`find_program_suppressions`].
#[derive(Copy, Clone)]
pub(crate) struct SuppressionRange<'a> {
    disable_comment: Token<'a>,
    enable_comment: Option<Token<'a>>,
}

/// The suppressions of a file. Each list is in the order of the file.
#[derive(Default)]
pub(crate) struct ProgramSuppressions<'a> {
    /// Those of `eslint-disable-next-line`.
    next_line: Vec<SuppressionRange<'a>>,
    /// Those of `eslint-disable`.
    block: Vec<SuppressionRange<'a>>,
}

/// The text of the comment without `//` or `/* */`, trimmed as `str::trim` does it. Of a `<!--` oxc takes two characters off
/// too, so that is never a suppression.
fn comment_value<'a>(comment: Token<'a>) -> &'a [u8] {
    let text = comment.text();
    let content = match comment.kind() {
        TokenKind::Block => text.get(2..text.len().saturating_sub(2)),
        _ => text.get(2..),
    };
    let content = content.unwrap_or_default();
    match std::str::from_utf8(content) {
        Ok(content) => content.trim().as_bytes(),
        Err(_) => content.trim_ascii(),
    }
}

/// Whether `value` is `eslint-` or `oxlint-`, `directive`, a blank, and what starts with one of `rule_names`.
fn matches_directive(value: &[u8], directive: &str, rule_names: &[&str]) -> bool {
    value
        .strip_prefix(b"eslint-")
        .or_else(|| value.strip_prefix(b"oxlint-"))
        .and_then(|rest| rest.strip_prefix(directive.as_bytes()))
        .and_then(|rest| rest.strip_prefix(b" "))
        .is_some_and(|rest| {
            rule_names
                .iter()
                .any(|name| rest.starts_with(name.as_bytes()))
        })
}

fn matches_eslint_disable_next_line(value: &[u8], rule_names: &[&str]) -> bool {
    matches_directive(value, "disable-next-line", rule_names)
}

fn matches_eslint_disable(value: &[u8], rule_names: &[&str]) -> bool {
    matches_directive(value, "disable", rule_names)
}

/// The compiler's `findProgramSuppressions`. There a range is complete, and the search for its end is over, as soon as it has
/// a comment that disables and a source. That is in the turn of the loop that finds the `eslint-disable`: no `eslint-enable`
/// ever ends a range, and nothing is carried from one comment to the next.
pub(crate) fn find_program_suppressions<'a>(
    file: &'a File<'a>,
    rule_names: &[&str],
) -> ProgramSuppressions<'a> {
    let mut suppressions = ProgramSuppressions {
        next_line: Vec::new(),
        block: Vec::new(),
    };
    for comment in file.comments() {
        if comment.kind() == TokenKind::Shebang {
            continue;
        }
        let value = comment_value(comment);
        if matches_eslint_disable_next_line(value, rule_names) {
            suppressions.next_line.push(SuppressionRange {
                disable_comment: comment,
                enable_comment: Some(comment),
            });
        } else if matches_eslint_disable(value, rule_names) {
            suppressions.block.push(SuppressionRange {
                disable_comment: comment,
                enable_comment: None,
            });
        }
    }
    suppressions
}

impl<'a> ProgramSuppressions<'a> {
    /// The suppressions that are within the function or wrap it, in the order of the file. One without an end does so
    /// wherever it is, before or after the function.
    pub(crate) fn filter_suppressions_that_affect_function(
        &self,
        fn_start: u32,
        fn_end: u32,
    ) -> Vec<SuppressionRange<'a>> {
        let affects = |suppression: &&SuppressionRange| {
            let disable_start = suppression.disable_comment.start();
            let enable_end = suppression.enable_comment.map(Token::end);
            (disable_start > fn_start && enable_end.is_none_or(|end| end < fn_end))
                || (disable_start < fn_start && enable_end.is_none_or(|end| end > fn_end))
        };
        // One comment does not wrap a function: only those that start in it are candidates.
        let first = self
            .next_line
            .partition_point(|it| it.disable_comment.start() <= fn_start);
        let after = self
            .next_line
            .partition_point(|it| it.disable_comment.start() < fn_end);
        let mut next_line = self
            .next_line
            .get(first..after)
            .unwrap_or_default()
            .iter()
            .filter(affects)
            .peekable();

        let mut suppressions_in_scope = Vec::new();
        for block in self.block.iter().filter(affects) {
            let is_before =
                |it: &&SuppressionRange| it.disable_comment.start() < block.disable_comment.start();
            while let Some(suppression) = next_line.next_if(is_before) {
                suppressions_in_scope.push(*suppression);
            }
            suppressions_in_scope.push(*block);
        }
        suppressions_in_scope.extend(next_line);
        suppressions_in_scope
    }
}

/// The compiler's `suppressionsToCompilerError`. oxc keeps the texts but not the suggestion.
pub(crate) fn suppressions_to_diagnostics(suppressions: &[SuppressionRange]) -> Vec<Finding> {
    let diagnostic = |suppression: &SuppressionRange| {
        let comment = suppression.disable_comment;
        Finding {
            category: ErrorCategory::Suppression,
            reason: "React Compiler has skipped optimizing this component because one or more React ESLint rules were \
                     disabled"
                .to_owned(),
            description: Some(format!(
                "React Compiler only works when your components follow all the rules of React, disabling them may result \
                 in unexpected or incorrect behavior. Found suppression `{}`",
                bun_core::BStr::new(comment_value(comment))
            )),
            details: vec![Detail::Error {
                span: Some(comment.span()),
                message: Some("Found React rule suppression".to_owned()),
            }],
            suggestions: vec![Suggestion {
                op: CompilerSuggestionOperation::Remove,
                range: comment.span(),
                description: "Remove the ESLint suppression and address the React error".to_owned(),
                text: None,
            }],
            is_error_detail: false,
            function_span: None,
        }
    };
    suppressions.iter().map(diagnostic).collect()
}

/// Of the matches of `/\$FlowFixMe\[([^\]]*)\]/g`, one is for the two rules.
fn has_flow_suppression(mut comment: &[u8]) -> bool {
    const START: &[u8] = b"$FlowFixMe[";
    while let Some(start) = strings::index_of(comment, START) {
        let code = comment.get(start + START.len()..).unwrap_or_default();
        let Some(end) = strings::index_of_char_usize(code, b']') else {
            return false;
        };
        if matches!(
            code.get(..end),
            Some(b"react-rule-hook" | b"react-rule-unsafe-ref")
        ) {
            return true;
        }
        comment = code.get(end + 1..).unwrap_or_default();
    }
    false
}

/// The plugin's `getFlowSuppressions` and `hasFlowSuppression`: a diagnostic that starts on the line after the one on which a
/// comment with `$FlowFixMe[react-rule-hook]` or `$FlowFixMe[react-rule-unsafe-ref]` ends is not reported. In any file, of Flow or
/// not.
pub(crate) fn remove_what_flow_suppresses<'a>(file: &'a File<'a>, diagnostics: &mut Vec<Finding>) {
    if diagnostics.is_empty() || !strings::contains(file.text(), b"$FlowFixMe[react-rule-") {
        return;
    }
    let suppresses = |comment: &Token<'a>| has_flow_suppression(comment.text());
    // In the order of the file.
    let lines: Vec<u32> = (file.comments().filter(suppresses))
        .map(|comment| file.line_of(comment.end()))
        .collect();
    // The compiler's `primaryLocation()`
    let primary_location = |diagnostic: &Finding| {
        let first = diagnostic.details.iter().find_map(|detail| match detail {
            Detail::Error { span, .. } => Some(*span),
            Detail::Hint { .. } => None,
        });
        first.flatten()
    };
    diagnostics.retain(|diagnostic| {
        primary_location(diagnostic).is_none_or(|span| {
            let line_before = file.line_of(span.start).saturating_sub(1);
            lines.binary_search(&line_before).is_err()
        })
    });
}
