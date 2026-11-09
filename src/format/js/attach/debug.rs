//! Debug output for the tests, which compare it with Prettier's attachments.

use super::surrounding_nodes::AttachContext;
use super::{Marker, Options, Owner, Placement, attach};
use crate::js::ast_nodes::AST_KIND_NAMES;
use bun_lint::ast::comments::NodeOrName;
use bun_lint::ast::{File, Node};
use std::io::Write;

/// Writes one line per comment with its span and its owner, plus one line per node that's ignored by a comment another
/// node owns.
pub(crate) fn list<'a>(
    file: &'a File<'a>,
    cast_parens: &[u32],
    options: Options,
    out: &mut Vec<u8>,
) {
    let attached = attach(file, cast_parens, options);
    let cx = AttachContext::new(file, cast_parens, options);
    let describe = |owner: Owner<'a>| {
        let name = match owner {
            Owner::Node(node) => AST_KIND_NAMES.get(node.kind() as usize).copied(),
            Owner::Name(_) => Some("Name"),
            Owner::CastParens(..) => Some("ParenthesizedExpression"),
        };
        (name.unwrap_or_default(), cx.span_of(owner))
    };
    let mut lines: Vec<(u32, Vec<u8>)> = Vec::new();
    for (comment, attachment) in file.comments_by_id().zip(&attached.attachments) {
        if attachment.marker == Marker::InIgnoredNode {
            continue;
        }
        let (name, span) = describe(attachment.owner);
        let placement = match attachment.placement {
            Placement::Leading => "L",
            Placement::Trailing => "T",
            Placement::Dangling => "D",
        };
        let marker = match attachment.marker {
            Marker::None | Marker::InIgnoredNode | Marker::ClosingFragment => "-",
            Marker::CommentBeforeArrow => "commentBeforeArrow",
            Marker::Implements => "implements",
            Marker::Extends => "extends",
            Marker::Mixins => "mixins",
        };
        let unignore = match attachment.is_unignored {
            true => " unignore",
            false => "",
        };
        let mut line = Vec::new();
        let _ = write!(
            line,
            "C {} {} {placement} {name} {} {} {marker}{unignore}",
            comment.span().start,
            comment.span().end,
            span.start,
            span.end,
        );
        lines.push((comment.span().start, line));
    }
    // The nodes that the parser recorded, to debug a wrong owner.
    for comment in file.comments_by_id() {
        let describe = |node: Option<NodeOrName<'a>>| match node {
            None => "-".to_owned(),
            Some(NodeOrName::Name(start)) => format!("name@{start}"),
            Some(NodeOrName::Node(node)) => {
                let kind = match node {
                    Node::File(_) => "File",
                    Node::Expr(_) => "Expr",
                    Node::Stmt(_) => "Stmt",
                    Node::Type(_) => "Type",
                    Node::Pat(_) => "Pat",
                    Node::PatProp(_) => "PatProp",
                    Node::PatElem(_) => "PatElem",
                    Node::Func(_) => "Func",
                    Node::Param(_) => "Param",
                    Node::TypeParam(_) => "TypeParam",
                    Node::Class(_) => "Class",
                    Node::Member(_) => "Member",
                    Node::Prop(_) => "Prop",
                    Node::VarDecl(_) => "VarDecl",
                    Node::Case(_) => "Case",
                    Node::EnumMember(_) => "EnumMember",
                    Node::ImportSpec(_) => "ImportSpec",
                    Node::ExportSpec(_) => "ExportSpec",
                    Node::TupleElem(_) => "TupleElem",
                };
                format!("{kind}@{}..{}", node.span().start, node.span().end)
            }
        };
        let line = format!(
            "P {} tokens {}..{} enclosing {} preceding {} following {}",
            comment.span().start,
            comment.prev_token_end(),
            comment.next_token_start(),
            describe(comment.enclosing_node().map(NodeOrName::Node)),
            describe(comment.preceding_node()),
            describe(comment.following_node()),
        );
        lines.push((comment.span().start, line.into_bytes()));
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
