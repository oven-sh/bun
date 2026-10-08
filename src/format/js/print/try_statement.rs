use crate::js::format::{
    FormatTypeAnnotation, format_node_without_comments, write_declaration, write_trailing_comments_of,
};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::prelude::*;
use crate::write;

/// Whether one of `comments` starts or ends its line. Prettier's `handleTryStatementComments` moves
/// those into the next block.
fn has_comment_with_line_break(comments: &[Comment]) -> bool {
    comments.iter().any(|comment| comment.preceded_by_newline() || comment.followed_by_newline())
}

/// A block after `try`, `catch (e)` or `finally`. The comments after it are left to the caller.
fn write_block<'a>(block: Stmt<'a>, f: &mut Formatter<'a>) {
    match !f.is_quiet() && has_comment_with_line_break(f.comments().comments_before(block.span().start)) {
        // The comments before it are written in it.
        true => write_declaration(block, f),
        false => write!(f, FormatNodeWithoutTrailingComments(&block)),
    }
}

pub(crate) fn write_try_statement<'a>(
    statement: Stmt<'a>,
    block: Stmt<'a>,
    param: Option<VarDecl<'a>>,
    handler: Option<Stmt<'a>>,
    finalizer: Option<Stmt<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(f, ["try", space()]);
    write_block(block, f);

    if let Some(handler) = handler {
        write!(f, space());
        let node = AstNodes::CatchClause(statement);
        format_node_without_comments(node.span(), || node.parent(), f, |f| write_catch_clause(node, param, handler, f));
    }
    if let Some(finalizer) = finalizer {
        // `} /* comment */ finally {`
        if !f.is_quiet() {
            let comments = f.comments().comments_before(finalizer.span().start);
            if !has_comment_with_line_break(comments) {
                let mut position = handler.unwrap_or(block).span().end;
                let count = comments
                    .iter()
                    .take_while(|comment| {
                        let gap = f.source_text().slice_range(position, comment.span.start);
                        position = comment.span.end;
                        gap.trim_ascii().is_empty()
                    })
                    .count();
                write!(f, FormatTrailingComments::Comments(comments.get(..count).unwrap_or_default()));
            }
        }
        write!(f, [space(), "finally", space()]);
        write_block(finalizer, f);
    }
}

fn write_catch_clause<'a>(node: AstNodes<'a>, param: Option<VarDecl<'a>>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    // ```js
    // try {
    // } // comment
    // catch {
    // }
    // ```
    // A comment with a line break next to it goes to the start of the block, where
    // `write_block_statement` takes it from the cache. Any other stays before `catch`.
    let leading_comments = f.comments().comments_before(node.span().start);
    if has_comment_with_line_break(leading_comments) {
        if let Some(comments) = f.intern(&FormatLeadingComments::Comments(leading_comments)) {
            f.context_mut().cache_element(&node.span(), comments);
        }
    } else if !leading_comments.is_empty() {
        write!(f, [FormatTrailingComments::Comments(leading_comments), space()]);
    }

    write!(f, ["catch", space()]);
    if let Some(param) = param {
        format_node_without_comments(param.span(), || node, f, |f| write_catch_parameter(param, body, f));
        write!(f, space());
    }
    write_block(body, f);
}

/// `(e)`
fn write_catch_parameter<'a>(param: VarDecl<'a>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    let (pattern, type_annotation) = (param.pat(), param.ty().map(FormatTypeAnnotation));
    write!(f, "(");
    if f.is_quiet() {
        return write!(f, [pattern, type_annotation, ")"]);
    }

    let leading_comments = f.comments().comments_before(pattern.span().start);
    let leading_comment_with_break =
        leading_comments.iter().any(|comment| comment.is_line() || comment.followed_by_newline());
    // Those before the `)`, and of those after it the ones that start or end their line.
    let before_body = f.comments().comments_in_range(param.span().end, body.span().start);
    let count = f.comments().comments_before_character(param.span().end, b')').len().max(
        before_body.iter().rposition(|it| it.preceded_by_newline() || it.followed_by_newline()).map_or(0, |at| at + 1),
    );
    let trailing_comments = before_body.get(..count).unwrap_or_default();
    let trailing_comment_with_break =
        trailing_comments.iter().any(|comment| comment.is_line() || comment.preceded_by_newline());

    let content = format_with(|f| {
        write!(f, FormatLeadingComments::Comments(leading_comments));
        let previous_limit = f.comments_mut().limit_comments_up_to(param.span().end);
        write!(f, [pattern, type_annotation]);
        f.comments_mut().restore_view_limit(previous_limit);
        write!(f, FormatTrailingComments::Comments(trailing_comments));
    });
    match leading_comment_with_break || trailing_comment_with_break {
        true => write!(f, soft_block_indent(&content)),
        false => write!(f, content),
    }
    write_trailing_comments_of(AstNodes::CatchParameter(param), f);
    write!(f, ")");
}
