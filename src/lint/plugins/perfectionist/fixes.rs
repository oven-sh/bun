//! The fix that puts a node list in order: `get-node-range.ts`, `make-order-fixes.ts`, `make-comment-after-fixes.ts`,
//! `make-single-node-comment-after-fixes.ts`, `make-fixes.ts`, `range-to-diff.ts`. The fixes of one list are returned
//! as one `Vec<Fix>`, which `IntoFix` merges exactly as upstream's `mergeFixes` does, and every message of the list
//! gets the same merged fix.

use super::SortingNode;
use super::disabled::{Directive, eslint_disabled_rules};
use super::newlines;
use super::options::{Configuration, PartitionByComment};
use super::partition::is_partition_comment;
use bun_core::strings;
use bun_lint::prelude::*;

/// What a rule decides about its fixes, beyond the options: the `addSafetySemicolonWhenInline` of its sorting
/// nodes. It is `true` for interface and type literal members, whose text can end without a `;`, and `false` for
/// the others.
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

/// Upstream's `getNodeRange`: the node with its parentheses and the comments directly above it, down to the first
/// comment that is a partition comment under `by_comment` (`PartitionByComment::Off` where upstream passes no
/// options), an `eslint-disable` or `eslint-enable`, or has a blank line below it.
///
/// `ignoreHighestBlockComment` and `implicitDecorators` are `sort-decorators`' and `sort-classes`'; these rules never
/// pass them.
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

/// Upstream's `computeHighestCommentStart` over `getCommentsBefore`: walks up from the node through the comments
/// that end on the line right above the previous one. A comment on the same line as the token before it trails
/// that token and is not above the node.
///
/// A `partitionByComment` pattern that does not compile is not an error here: `shouldPartition` has tested every
/// comment above every node before anything is sorted, and thrown if one reached that pattern.
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

/// Upstream's `makeFixes` for these rules: the order fixes, with the comment-after fixes if there are any, else with
/// the newlines fixes if there are any. `sorted` is `sortNodesExcludingEslintDisabled(true)`: the index into `nodes`
/// of the node that belongs at each position. None of the four rules has a `missedCommentAbove` message, so there
/// is nothing after the order fixes.
pub(crate) fn make_fixes<'a>(
    file: &'a File<'a>,
    nodes: &[SortingNode<'a>],
    sorted: &[u32],
    config: &Configuration,
    options: FixOptions,
) -> Vec<Fix> {
    let mut fixes = Vec::new();
    order_fixes(file, nodes, sorted, config, options, &mut fixes);
    let order_fixes_len = fixes.len();
    comment_after_fixes(file, nodes, sorted, &mut fixes);
    if fixes.len() == order_fixes_len {
        newlines::newlines_between_fixes(file, nodes, sorted, config, &mut fixes);
    }
    fixes
}

/// Upstream's `makeOrderFixes`: each node's range gets the text of the node sorted into its place, plus a `;` where
/// that text would otherwise run into a token on the same line.
///
/// Upstream also adds the `;` when the sorted node `doesNodeEndWithExpression` and an expression continuation
/// follows; that is true only of variable declarations and class fields, never of a member of these rules' lists.
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
fn node_to_insert_after(file: &File<'_>, node: Span) -> Span {
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
