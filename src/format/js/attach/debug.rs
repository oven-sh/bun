//! For the tests, which compare this with what Prettier does.

use super::surrounding_nodes::AttachContext;
use super::{Marker, Options, Owner, Placement, attach};
use crate::js::ast_nodes::AST_KIND_NAMES;
use crate::js::comments::Comment;
use bun_lint::ast::File;
use std::io::Write;

/// A line for each comment: where it is, and what owns it. And one for each node that is ignored by a comment that another
/// node owns.
pub(crate) fn list<'a>(
    file: &'a File<'a>,
    comments: &[Comment],
    cast_parens: &[u32],
    options: Options,
    out: &mut Vec<u8>,
) {
    let attached = attach(file, comments, cast_parens, options);
    let cx = AttachContext::new(file, comments, cast_parens, options);
    let describe = |owner: Owner<'a>| {
        let name = match owner {
            Owner::Node(node) => AST_KIND_NAMES.get(node.kind() as usize).copied(),
            Owner::Name(_) => Some("Name"),
            Owner::CastParens(..) => Some("ParenthesizedExpression"),
        };
        (name.unwrap_or_default(), cx.span_of(owner))
    };
    let mut lines: Vec<(u32, Vec<u8>)> = Vec::new();
    for (comment, attachment) in comments.iter().zip(&attached.attachments) {
        if comment.is_merged_into_previous() || attachment.marker == Marker::InIgnoredNode {
            continue;
        }
        let (name, span) = describe(attachment.owner);
        let placement = match attachment.placement {
            Placement::Leading => "L",
            Placement::Trailing => "T",
            Placement::Dangling => "D",
        };
        let marker = match attachment.marker {
            Marker::None | Marker::InIgnoredNode => "-",
            Marker::CommentBeforeArrow => "commentBeforeArrow",
            Marker::Implements => "implements",
            Marker::Extends => "extends",
        };
        let unignore = match attachment.is_unignored {
            true => " unignore",
            false => "",
        };
        let mut line = Vec::new();
        let _ = write!(
            line,
            "C {} {} {placement} {name} {} {} {marker}{unignore}",
            comment.span.start, comment.span.end, span.start, span.end,
        );
        lines.push((comment.span.start, line));
    }
    for owner in &attached.ignored_nodes {
        let (name, span) = describe(*owner);
        let mut line = Vec::new();
        let _ = write!(line, "I {name} {} {}", span.start, span.end);
        lines.push((span.start, line));
    }
    crate::sort::sort_by_key(&mut lines, |line| line.0);
    for (_, line) in lines {
        out.extend_from_slice(&line);
        out.push(b'\n');
    }
}
