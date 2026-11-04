use crate::js::format::{FormatTypeAnnotation, format_node};
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::statement_body::{write_comments_before_keyword, write_space_before_body};
use crate::prelude::*;
use crate::write;

/// Prints `part`, which is followed by `catch` or `finally`, and the space before that keyword.
///
/// See [`comments_stay_between_head_and_body`]: oxfmt keeps the comments between the two on their lines. They're
/// `node`'s trailing comments, which `part` prints, plus `comments_before_keyword`.
fn write_part_before_keyword<'a>(
    part: &(impl Format<'a> + Spanned),
    node: AstNodes<'a>,
    comments_before_keyword: impl FnOnce(&Formatter<'a>) -> CommentList<'a>,
    f: &mut Formatter<'a>,
) {
    if f.is_quiet() || !comments_stay_between_head_and_body(f) {
        return write!(f, [part, space()]);
    }
    write!(f, FormatNodeWithoutTrailingComments(part));
    let trailing = f.comments().of_node(node).trailing;
    if write_comments_before_keyword(trailing, comments_before_keyword(f), f) {
        write!(f, space());
    }
}

#[inline(never)]
pub(crate) fn write_try_statement<'a>(
    statement: Stmt<'a>,
    block: Stmt<'a>,
    param: Option<VarDecl<'a>>,
    handler: Option<Stmt<'a>>,
    finalizer: Option<Stmt<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(f, "try");
    write_space_before_body(block.as_ast_nodes(), f);
    // oxfmt prints an ignored clause's comments like any other leading comments: `} // prettier-ignore⏎catch ( e ) {}`
    let before_catch = |f: &Formatter<'a>| {
        let owned = f.comments().of_node(AstNodes::CatchClause(statement));
        match owned.is_ignored {
            true => CommentList::empty(),
            false => owned.leading,
        }
    };
    let before_finally = |f: &Formatter<'a>| {
        f.comments()
            .of_node(AstNodes::TryStatement(statement))
            .dangling
    };
    match handler {
        Some(_) => write_part_before_keyword(&block, block.as_ast_nodes(), before_catch, f),
        None => write_part_before_keyword(&block, block.as_ast_nodes(), before_finally, f),
    }
    if let Some(body) = handler {
        let catch_clause = FormatCatchClause {
            statement,
            param,
            body,
        };
        match finalizer {
            Some(_) => {
                write_part_before_keyword(&catch_clause, catch_clause.node(), before_finally, f);
            }
            None => write!(f, catch_clause),
        }
    }
    if let Some(finalizer) = finalizer {
        write!(f, "finally");
        write_space_before_body(finalizer.as_ast_nodes(), f);
        write!(f, finalizer);
    }
}

/// `catch (e) {}`
#[derive(Copy, Clone)]
struct FormatCatchClause<'a> {
    /// The `try` statement.
    statement: Stmt<'a>,
    param: Option<VarDecl<'a>>,
    body: Stmt<'a>,
}

impl<'a> FormatCatchClause<'a> {
    fn node(self) -> AstNodes<'a> {
        AstNodes::CatchClause(self.statement)
    }
}

impl Spanned for FormatCatchClause<'_> {
    fn span(&self) -> Span {
        self.node().span()
    }
}

impl<'a> Format<'a> for FormatCatchClause<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_node(self.node(), f, |f| {
            write_catch_clause(self.param, self.body, f)
        });
    }
}

fn write_catch_clause<'a>(param: Option<VarDecl<'a>>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    write!(f, "catch");
    if let Some(param) = param {
        let node = AstNodes::CatchParameter(param);
        let parameter = format_with(|f| {
            format_node(node, f, |f| {
                write!(f, [param.pat(), param.ty().map(FormatTypeAnnotation)]);
            });
        });
        match !f.is_quiet() && has_comment_with_line_break(node, f) {
            true => write!(f, [space(), "(", soft_block_indent(&parameter), ")"]),
            false => write!(f, [space(), "(", parameter, ")"]),
        }
    }
    write_space_before_body(body.as_ast_nodes(), f);
    write!(f, body);
}

/// True if a comment on the catch parameter `node` is a line comment or has a line break between it and the parameter.
fn has_comment_with_line_break<'a>(node: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    let owned = f.comments().of_node(node);
    let mut leading = owned.leading.iter();
    let mut trailing = owned.trailing.iter();
    leading.any(|comment| comment.is_line() || comment.has_newline_after())
        || trailing.any(|comment| comment.is_line() || comment.has_newline_before())
}
