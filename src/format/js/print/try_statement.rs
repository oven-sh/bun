use crate::js::format::{
    FormatTypeAnnotation, format_node_without_comments, write_declaration, write_trailing_comments_of,
};
use crate::prelude::*;
use crate::write;

/// A block after `try`, `catch (e)` or `finally`. A comment on a line of its own before it is
/// written in it.
fn write_block<'a>(block: Stmt<'a>, f: &mut Formatter<'a>) {
    match f.comments().has_leading_own_line_comment(block.span().start) {
        true => write_declaration(block, f),
        false => write!(f, block),
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
    if leading_comments.iter().any(|comment| comment.preceded_by_newline() || comment.followed_by_newline()) {
        if let Some(comments) = f.intern(&FormatLeadingComments::Comments(leading_comments)) {
            f.context_mut().cache_element(&node.span(), comments);
        }
    } else if !leading_comments.is_empty() {
        write!(f, [FormatTrailingComments::Comments(leading_comments), space()]);
    }

    write!(f, ["catch", space()]);
    if let Some(param) = param {
        format_node_without_comments(param.span(), || node, f, |f| write_catch_parameter(param, f));
        write!(f, space());
    }
    write_block(body, f);
}

/// `(e)`
fn write_catch_parameter<'a>(param: VarDecl<'a>, f: &mut Formatter<'a>) {
    let (pattern, type_annotation) = (param.pat(), param.ty().map(FormatTypeAnnotation));
    write!(f, "(");
    if f.is_quiet() {
        return write!(f, [pattern, type_annotation, ")"]);
    }

    let leading_comments = f.comments().comments_before(pattern.span().start);
    let leading_comment_with_break =
        leading_comments.iter().any(|comment| comment.is_line() || comment.followed_by_newline());
    let trailing_comments = f.comments().comments_before_character(param.span().end, b')');
    let trailing_comment_with_break =
        trailing_comments.iter().any(|comment| comment.is_line() || comment.preceded_by_newline());

    if leading_comment_with_break || trailing_comment_with_break {
        write!(
            f,
            soft_block_indent(&format_with(|f| {
                write!(f, FormatLeadingComments::Comments(leading_comments));
                let printed_len_before_pattern = f.comments().printed_comments().len();
                write!(f, [pattern, type_annotation]);
                // Unless they have been written with the pattern.
                if f.comments().printed_comments().len() - printed_len_before_pattern != trailing_comments.len() {
                    write!(f, FormatTrailingComments::Comments(trailing_comments));
                }
            }))
        );
    } else {
        write!(f, [pattern, type_annotation]);
    }
    write_trailing_comments_of(AstNodes::CatchParameter(param), f);
    write!(f, ")");
}
