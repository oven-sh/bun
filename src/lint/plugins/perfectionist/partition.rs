//! `should-partition.ts`, `is-partition-comment.ts`, `get-comments-before.ts`, `get-lines-between.ts`. The partitions
//! that `sort-objects` starts at a spread, a rest element or a computed key are the rule's own.

use super::disabled::eslint_disabled_rules;
use super::options::{CommentMatcher, Configuration, PartitionByComment};
use bun_core::strings;
use bun_lint::prelude::*;

/// `shouldPartition`. `token_to_ignore_before` is `tokenValueToIgnoreBefore`. `Err` is the `SyntaxError` message of
/// a `partitionByComment` pattern, for the rule to `cx.throw`.
pub(crate) fn should_partition<'a, 'c>(
    file: &'a File<'a>,
    options: &'c Configuration,
    last: Option<Span>,
    node: Span,
    token_to_ignore_before: Option<&str>,
) -> Result<bool, &'c str> {
    if !matches!(options.partition_by_comment, PartitionByComment::Off)
        && has_partition_comment(
            file,
            &options.partition_by_comment,
            node,
            token_to_ignore_before,
        )?
    {
        return Ok(true);
    }
    Ok(match last {
        Some(last) => options.partition_by_new_line && lines_between(file, last, node) > 0,
        None => false,
    })
}

/// Upstream's `getLinesBetween`: the blank lines between the line `left` ends on and the line `right` starts on.
pub(crate) fn lines_between(file: &File<'_>, left: Span, right: Span) -> u32 {
    (file.line_of(left.end) + 1..file.line_of(right.start))
        .filter(|line| strings::is_all_js_whitespace(file.line_text(*line)))
        .count() as u32
}

/// Upstream's `hasPartitionComment`, over `getCommentsBefore`. `some` stops at the first partition comment, so a
/// pattern that does not compile is only an error when an earlier one has not matched.
fn has_partition_comment<'a, 'c>(
    file: &'a File<'a>,
    by_comment: &'c PartitionByComment,
    node: Span,
    token_to_ignore_before: Option<&str>,
) -> Result<bool, &'c str> {
    for comment in comments_before(file, node, token_to_ignore_before) {
        if is_partition_comment(comment, by_comment)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Upstream's `getCommentsBefore`.
fn comments_before<'a>(
    file: &'a File<'a>,
    node: Span,
    token_to_ignore_before: Option<&str>,
) -> RelevantComments<'a> {
    let comments = relevant_comments_before(file, node);
    if let Some(token_text) = token_to_ignore_before
        && comments.is_empty()
        && let Some(token) = file.token_before(node)
        && token.value() == token_text.as_bytes()
    {
        return relevant_comments_before(file, token.span());
    }
    comments
}

/// Upstream's `getRelevantCommentsBeforeNodeOrToken`: the comments directly before `at`, minus a shebang and minus
/// those that start on the line the token before them ends on, which are that token's trailing comments.
#[derive(Clone, Copy)]
struct RelevantComments<'a> {
    file: &'a File<'a>,
    comments: Tokens<'a>,
    /// The line the token before the comments ends on. `None` when only white space precedes them.
    token_line: Option<u32>,
}

fn relevant_comments_before<'a>(file: &'a File<'a>, at: Span) -> RelevantComments<'a> {
    let comments = file.comments_before(at);
    let mut probe = comments;
    let token_line = probe.next().and_then(|first| {
        let before = strings::trim_js_whitespace_end(file.slice(Span::new(0, first.start())));
        let end = u32::try_from(before.len()).ok()?;
        (end > 0).then(|| file.line_of(end))
    });
    RelevantComments {
        file,
        comments,
        token_line,
    }
}

impl RelevantComments<'_> {
    fn is_empty(mut self) -> bool {
        self.next().is_none()
    }
}

impl<'a> Iterator for RelevantComments<'a> {
    type Item = Token<'a>;

    fn next(&mut self) -> Option<Token<'a>> {
        loop {
            let comment = self.comments.next()?;
            if comment.kind() == TokenKind::Shebang {
                continue;
            }
            if let Some(line) = self.token_line
                && self.file.line_of(comment.start()) == line
            {
                continue;
            }
            return Some(comment);
        }
    }
}

/// Upstream's `isPartitionComment`. An `eslint-disable*` / `eslint-enable` comment never partitions.
pub(crate) fn is_partition_comment<'c>(
    comment: Token<'_>,
    by_comment: &'c PartitionByComment,
) -> Result<bool, &'c str> {
    let matcher = match by_comment {
        PartitionByComment::Off => return Ok(false),
        PartitionByComment::Any(matcher) => matcher,
        PartitionByComment::ByKind { block, line } => match comment.kind() {
            TokenKind::Block => block,
            TokenKind::Line => line,
            _ => return Ok(false),
        },
    };
    if eslint_disabled_rules(comment.comment_value()).is_some() {
        return Ok(false);
    }
    match matcher {
        CommentMatcher::Never => Ok(false),
        CommentMatcher::Always => Ok(true),
        CommentMatcher::Patterns(patterns) => {
            patterns.first_match(strings::trim_js_whitespace(comment.comment_value()))
        }
    }
}
