//! `get-node-range.ts`, `make-order-fixes.ts`, `make-comment-after-fixes.ts`, `make-single-node-comment-after-fixes.ts`,
//! `make-fixes.ts`, `range-to-diff.ts`. One `Vec<Fix>` per list, merged by `IntoFix` as `mergeFixes` does.

use super::SortingNode;
use super::disabled::{Directive, eslint_disabled_rules};
use super::newlines;
use super::options::{Configuration, PartitionByComment};
use super::partition::is_partition_comment;
use bun_core::strings;
use bun_lint::prelude::*;

/// `addSafetySemicolonWhenInline`: `true` for interface and type literal members only.
#[derive(Clone, Copy)]
pub(crate) struct FixOptions {
    pub(crate) add_safety_semicolon_when_inline: bool,
}

/// Upstream's `rangeToDiff`: the `size` of a node, in UTF-16 units as ESTree ranges count, without a trailing `;` or
/// `,`.
pub(crate) fn range_to_diff(file: &File<'_>, span: Span) -> u32 {
    let text = file.slice(span);
    let punctuation = u32::from(matches!(text.last(), Some(b';' | b',')));
    strings::utf8_decoded_len_utf16(text).saturating_sub(punctuation)
}

/// `getNodeRange` without `ignoreHighestBlockComment` and `implicitDecorators`, which these rules never pass.
pub(crate) fn node_range<'a>(
    file: &'a File<'a>,
    node: &SortingNode<'a>,
    by_comment: &PartitionByComment,
) -> Span {
    let mut range = node.outer_span;
    if let Some(start) = highest_comment_start(file, node.span, by_comment) {
        range.start = range.start.min(start);
    }
    range
}

/// `computeHighestCommentStart` over `getCommentsBefore`. A `partitionByComment` pattern that does not compile
/// counts as not matching: the fix closure has no `Cx` to throw with.
fn highest_comment_start<'a>(
    file: &'a File<'a>,
    node: Span,
    by_comment: &PartitionByComment,
) -> Option<u32> {
    let token_before_line = file
        .token_before(node)
        .map(|token| file.line_of(token.end()));
    let mut previous_line = file.line_of(node.start);
    let mut highest = None;
    for comment in file.comments_before(node).rev() {
        if comment.kind() == TokenKind::Shebang
            || Some(file.line_of(comment.start())) == token_before_line
            || is_partition_comment(comment, by_comment).unwrap_or(false)
            || is_eslint_block_directive(comment)
            || file.line_of(comment.end()) != previous_line.saturating_sub(1)
        {
            break;
        }
        highest = Some(comment.start());
        previous_line = file.line_of(comment.start());
    }
    highest
}

/// An `eslint-disable` or `eslint-enable` comment, not `-line` or `-next-line`.
fn is_eslint_block_directive(comment: Token<'_>) -> bool {
    matches!(
        eslint_disabled_rules(comment.comment_value()),
        Some((Directive::Disable | Directive::Enable, _))
    )
}

/// `makeFixes` without `missedCommentAbove`, which none of these rules has. `sorted[i]` is the index into `nodes`
/// of the node that belongs at position `i`. `None` for a `newlinesBetween` no fix can hold (see [`Fixer::repeat`]).
pub(crate) fn make_fixes<'a>(
    fixer: Fixer<'a>,
    nodes: &[SortingNode<'a>],
    sorted: &[u32],
    config: &Configuration,
    options: FixOptions,
) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let mut fixes = Vec::new();
    order_fixes(file, nodes, sorted, config, options, &mut fixes);
    let order_fixes_len = fixes.len();
    comment_after_fixes(file, nodes, sorted, &mut fixes);
    if fixes.len() == order_fixes_len {
        newlines::newlines_between_fixes(fixer, nodes, sorted, config, &mut fixes)?;
    }
    Some(fixes)
}

/// `makeOrderFixes` without `doesNodeEndWithExpression`, which is never true of a member of these rules' lists.
fn order_fixes<'a>(
    file: &'a File<'a>,
    nodes: &[SortingNode<'a>],
    sorted: &[u32],
    config: &Configuration,
    options: FixOptions,
    fixes: &mut Vec<Fix>,
) {
    let by_comment = &config.partition_by_comment;
    for (i, node) in nodes.iter().enumerate() {
        let Some(&sorted_index) = sorted.get(i) else {
            break;
        };
        if sorted_index as usize == i {
            continue;
        }
        let Some(sorted_node) = nodes.get(sorted_index as usize) else {
            continue;
        };
        let mut code = file
            .slice(node_range(file, sorted_node, by_comment))
            .to_vec();
        if options.add_safety_semicolon_when_inline {
            let sorted_text = file.slice(sorted_node.span);
            let ends_with_safe_character = matches!(sorted_text.last(), Some(b';' | b','));
            let next_token = file.token_after(node.span);
            let is_next_token_safe_character = next_token
                .is_some_and(|token| token.is_punctuator(";") || token.is_punctuator(","));
            let is_next_token_on_same_line = next_token
                .is_some_and(|token| file.line_of(token.start()) == file.line_of(node.span.end));
            if !ends_with_safe_character
                && !is_next_token_safe_character
                && is_next_token_on_same_line
            {
                code.push(b';');
            }
        }
        fixes.push(Fix {
            span: node_range(file, node, by_comment),
            text: code,
        });
    }
}

/// Upstream's `makeCommentAfterFixes`: for each node that moves, the comment that trails the node taking its place
/// moves along.
fn comment_after_fixes<'a>(
    file: &'a File<'a>,
    nodes: &[SortingNode<'a>],
    sorted: &[u32],
    fixes: &mut Vec<Fix>,
) {
    for (i, node) in nodes.iter().enumerate() {
        let Some(&sorted_index) = sorted.get(i) else {
            break;
        };
        if sorted_index as usize == i {
            continue;
        }
        let Some(sorted_node) = nodes.get(sorted_index as usize) else {
            continue;
        };
        single_node_comment_after_fixes(file, sorted_node.span, node.span, fixes);
    }
}

/// Upstream's `makeSingleNodeCommentAfterFixes`: removes the comment that trails `sorted` on its line and inserts
/// it after `node`, or after the `,` or `:` that follows `node` on its line.
fn single_node_comment_after_fixes<'a>(
    file: &'a File<'a>,
    sorted: Span,
    node: Span,
    fixes: &mut Vec<Fix>,
) {
    let Some(comment) = comment_after(file, sorted) else {
        return;
    };
    if file.line_of(node.start) == file.line_of(sorted.end) {
        return;
    }
    let Some(token_before) = file.token_before(comment) else {
        return;
    };
    let removed = Span::new(token_before.end(), comment.end());
    fixes.push(Fix {
        span: removed,
        text: Vec::new(),
    });

    let insert_after = node_to_insert_after(file, node);
    let mut text = file.slice(removed).to_vec();
    if comment.kind() == TokenKind::Line
        && file
            .token_after(insert_after)
            .is_some_and(|token| file.line_of(token.start()) == file.line_of(insert_after.end))
    {
        text.push(b'\n');
    }
    fixes.push(Fix {
        span: Span::empty(insert_after.end),
        text,
    });
}

/// Upstream's `computeNodeToInsertAfter`.
fn node_to_insert_after<'a>(file: &'a File<'a>, node: Span) -> Span {
    match file.token_after(node) {
        Some(token)
            if (token.is_punctuator(",") || token.is_punctuator(":"))
                && file.line_of(token.end()) == file.line_of(node.end) =>
        {
            token.span()
        }
        _ => node,
    }
}

/// Upstream's `getCommentAfter`: the comment that follows `node` on the line it ends on, past a `,`, `;` or `:`.
fn comment_after<'a>(file: &'a File<'a>, node: Span) -> Option<Token<'a>> {
    let token = file.tokens_after(node).with_comments().find(|token| {
        !(token.is_punctuator(",") || token.is_punctuator(";") || token.is_punctuator(":"))
    })?;
    let is_comment = matches!(token.kind(), TokenKind::Block | TokenKind::Line);
    (is_comment && file.line_of(node.end) == file.line_of(token.end())).then_some(token)
}
