//! Comments that disable the React rules, which make the compiler skip a function. This is oxc's
//! `react_compiler/entrypoint/suppression.rs`, without Flow suppressions (`flow_suppressions: false`).
//!
//! `eslint-plugin-react-hooks` doesn't have the compiler look for any of these. It looks for Flow comments itself and
//! drops individual diagnostics because of them: [`remove_flow_suppressed`].

use crate::finding::{Detail, Finding, Suggestion};
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::tokens::{Token, TokenKind};
use bun_react_compiler::diagnostics::{CompilerSuggestionOperation, ErrorCategory};

/// From the comment that disables a rule to the one that enables it again. For `eslint-disable-next-line` both are the
/// same comment. For `eslint-disable` there's no `enable_comment`: see [`find_program_suppressions`].
#[derive(Copy, Clone)]
pub(crate) struct SuppressionRange<'a> {
    disable_comment: Token<'a>,
    enable_comment: Option<Token<'a>>,
}

/// A file's suppressions. Each list is in file order.
#[derive(Default)]
pub(crate) struct ProgramSuppressions<'a> {
    /// From `eslint-disable-next-line`.
    next_line: Vec<SuppressionRange<'a>>,
    /// From `eslint-disable`.
    block: Vec<SuppressionRange<'a>>,
}

/// The comment's text without `//` or `/* */`, trimmed like `str::trim`. oxc also strips two characters from a `<!--`,
/// so that's never a suppression.
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

/// True if `value` is `eslint-` or `oxlint-`, then `directive`, a space, and text that starts with one of `rule_names`.
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

/// The compiler's `findProgramSuppressions`. There, a range counts as complete as soon as it has a disable comment and
/// a source, which is already true in the loop iteration that finds the `eslint-disable`. So no `eslint-enable` ever
/// ends a range, and no state carries over from one comment to the next.
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
    /// The suppressions that are inside the function or wrap it, in file order. One without an end always qualifies,
    /// whether it's before or after the function.
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
        // A single comment can't wrap a function, so only those that start inside it are candidates.
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

/// True if one of the matches of `/\$FlowFixMe\[([^\]]*)\]/g` is for one of the two rules.
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

/// The plugin's `getFlowSuppressions` and `hasFlowSuppression`. A diagnostic isn't reported if it starts on the line
/// after the end of a comment with `$FlowFixMe[react-rule-hook]` or `$FlowFixMe[react-rule-unsafe-ref]`. This applies
/// to every file, Flow or not.
pub(crate) fn remove_flow_suppressed<'a>(file: &'a File<'a>, diagnostics: &mut Vec<Finding>) {
    if diagnostics.is_empty() || !strings::contains(file.text(), b"$FlowFixMe[react-rule-") {
        return;
    }
    let suppresses = |comment: &Token<'a>| has_flow_suppression(comment.text());
    // In file order, so it's sorted.
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
