//! `$FlowFixMe` comments. `eslint-plugin-react-hooks` looks for them itself and drops individual diagnostics because of
//! them: [`remove_flow_suppressed`]. oxlint doesn't (`flow_suppressions: false`).
//!
//! Comments that disable the React rules play no part in either. The compiler validates hooks and memoization
//! dependencies itself, and then it doesn't look for them.

use crate::finding::{Detail, Finding};
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::tokens::Token;

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
