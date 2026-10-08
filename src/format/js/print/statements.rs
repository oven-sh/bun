//! The statements that do not have a file of their own.

use super::parameters::can_avoid_parentheses;
use super::semicolon::OptionalSemicolon;
use crate::js::format::{identifier, write_trailing_comments_of};
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::js::utils::expression::ExpressionLeftSide;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::statement_body::FormatStatementBody;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{format_args, write};

/// `;`, which is only written where a statement has to be.
pub(crate) fn write_empty_statement<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    if matches!(
        statement.ast_parent(),
        AstNodes::DoWhileStatement(_)
            | AstNodes::IfStatement(_)
            | AstNodes::WhileStatement(_)
            | AstNodes::ForStatement(_)
            | AstNodes::ForInStatement(_)
            | AstNodes::ForOfStatement(_)
            | AstNodes::WithStatement(_)
    ) {
        write!(f, ";");
    }
}

/// Without semicolons, whether the statement has to start with one so that it is not read as the
/// continuation of the line before: it starts with `(`, `[`, `` ` ``, `+`, `-`, `/` or `<`.
fn expression_statement_needs_semicolon<'a>(statement: Stmt<'a>, expression: Expr<'a>, f: &Formatter<'a>) -> bool {
    if matches!(
        statement.ast_parent(),
        AstNodes::IfStatement(_)
            | AstNodes::DoWhileStatement(_)
            | AstNodes::WhileStatement(_)
            | AstNodes::ForStatement(_)
            | AstNodes::ForInStatement(_)
            | AstNodes::ForOfStatement(_)
            | AstNodes::WithStatement(_)
            | AstNodes::LabeledStatement(_)
    ) {
        return false;
    }
    match expression.kind() {
        // `a => {}` starts with a name.
        ExprKind::Fn(func) if func.is_arrow() => return !can_avoid_parentheses(func, f),
        ExprKind::New(_) | ExprKind::Await(_) | ExprKind::Yield { .. } => return false,
        _ => {}
    }

    ExpressionLeftSide::from(expression).iter().any(|current| {
        let e = current.expr;
        if current.is_assignment_target {
            return match e.kind() {
                ExprKind::Array(_) | ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. } => true,
                _ => false,
            };
        }
        expression_needs_parentheses(e, f)
            || match e.kind() {
                ExprKind::Array(_) | ExprKind::Regex(_) | ExprKind::Jsx(_) | ExprKind::Template(_) => true,
                ExprKind::As { .. } | ExprKind::AsConst(_) => e.is_angle_bracket_assertion(),
                ExprKind::Fn(func) => func.is_arrow(),
                ExprKind::Unary { op, .. } => matches!(op, UnOp::Plus | UnOp::Minus),
                _ => false,
            }
    })
}

pub(crate) fn write_expression_statement<'a>(statement: Stmt<'a>, expression: Expr<'a>, f: &mut Formatter<'a>) {
    if f.options().semicolons.is_as_needed() && expression_statement_needs_semicolon(statement, expression, f) {
        write!(f, ";");
    }
    // `statement(); // prettier-ignore`
    if !f.is_quiet() && f.comments().has_trailing_suppression_comment(statement.span().end) {
        return write!(f, FormatSuppressedNode(statement.span()));
    }
    write!(f, [expression, OptionalSemicolon]);
}

pub(crate) fn write_do_while_statement<'a>(_statement: Stmt<'a>, body: Stmt<'a>, test: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, group(&format_args!("do", FormatStatementBody::new(body))));
    match body.kind() {
        StmtKind::Block(_) => write!(f, space()),
        _ => write!(f, hard_line_break()),
    }
    write!(f, ["while", space(), "(", FormatCondition(test, &test), ")", OptionalSemicolon]);
}

/// The comments before a body that is an empty statement are written in the head:
/// `while (test) /* comment */ ;` becomes `while (test /* comment */);`.
struct FormatCommentForEmptyStatement<'a>(Stmt<'a>);

impl<'a> Format<'a> for FormatCommentForEmptyStatement<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() || !matches!(self.0.kind(), StmtKind::Empty) {
            return;
        }
        let comments = f.comments().comments_before(self.0.span().start);
        FormatTrailingComments::Comments(comments).fmt(f);
        write_trailing_comments_of(self.0.as_ast_nodes(), f);
    }
}

/// Prettier's `shouldInlineCondition`: `!(a || b)` and `!!(a || b)` start right after the `(` of the
/// statement, so that the indentation is the same as without the `!`.
fn should_inline_condition<'a>(test: Expr<'a>, f: &Formatter<'a>) -> bool {
    fn logical_not_argument(e: Expr<'_>) -> Option<Expr<'_>> {
        match e.kind() {
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => Some(operand),
            _ => None,
        }
    }
    let Some(argument) = logical_not_argument(test) else {
        return false;
    };
    let argument = logical_not_argument(argument).unwrap_or(argument);
    matches!(argument.kind(), ExprKind::Binary { op, .. } if op.is_logical())
        && (f.is_quiet()
            || !(f.comments().has_comment_before(test.span().start)
                || f.comments().comments_after(test.span().end).first().is_some_and(|comment| {
                    f.source_text().slice_range(test.span().end, comment.span.start).trim_ascii().is_empty()
                })))
}

/// The condition `test` in the parentheses of a statement. The second field writes it.
struct FormatCondition<'a, 'b, T>(Expr<'a>, &'b T);

impl<'a, T: Format<'a>> Format<'a> for FormatCondition<'a, '_, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match should_inline_condition(self.0, f) {
            true => write!(f, self.1),
            false => write!(f, group(&soft_block_indent(self.1))),
        }
    }
}

struct FormatTestOfIfAndWhileStatement<'a>(Expr<'a>);

impl<'a> Format<'a> for FormatTestOfIfAndWhileStatement<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(f, FormatNodeWithoutTrailingComments(&self.0));
        if f.is_quiet() {
            return;
        }
        let comments = f.comments().comments_before_character(self.0.span().end, b')');
        if !comments.is_empty() {
            write!(f, [space(), FormatTrailingComments::Comments(comments)]);
        }
    }
}

pub(crate) fn write_while_statement<'a>(_statement: Stmt<'a>, test: Expr<'a>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    write!(
        f,
        group(&format_args!(
            "while",
            space(),
            "(",
            FormatCondition(
                test,
                &format_args!(FormatTestOfIfAndWhileStatement(test), FormatCommentForEmptyStatement(body))
            ),
            ")",
            FormatStatementBody::new(body)
        ))
    );
}

/// What is in the head of a `for`: a declaration without its `;`, or an expression.
#[derive(Copy, Clone)]
struct FormatForHead<'a>(Stmt<'a>);

impl<'a> Format<'a> for FormatForHead<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self.0.kind() {
            StmtKind::Expr(expression) => write!(f, expression),
            _ => write!(f, self.0),
        }
    }
}

pub(crate) fn write_for_statement<'a>(
    _statement: Stmt<'a>,
    init: Option<Stmt<'a>>,
    test: Option<Expr<'a>>,
    update: Option<Expr<'a>>,
    body: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    let format_body = FormatStatementBody::new(body);
    if init.is_none() && test.is_none() && update.is_none() {
        return write!(f, group(&format_args!("for", space(), "(;;)", format_body)));
    }
    write!(
        f,
        group(&format_args!(
            "for",
            space(),
            "(",
            group(&soft_block_indent(&format_args!(
                init.map(FormatForHead),
                (test.is_none() && update.is_none()).then_some(FormatCommentForEmptyStatement(body)),
                ";",
                soft_line_break_or_space(),
                test,
                update.is_none().then_some(FormatCommentForEmptyStatement(body)),
                ";",
                update.is_some().then_some(soft_line_break_or_space()),
                update,
                FormatCommentForEmptyStatement(body)
            ))),
            ")",
            format_body
        ))
    );
}

/// The comments on lines of their own between the left and the right side of `in` or `of` are
/// written before the statement.
fn write_own_line_comments_in_head<'a>(left: Stmt<'a>, right: Expr<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return;
    }
    let comments = f.comments().own_line_comments_before(right.span().start);
    if comments.first().is_some_and(|comment| comment.span.start > left.span().end) {
        write!(f, FormatLeadingComments::Comments(comments));
    }
}

pub(crate) fn write_for_in_statement<'a>(
    _statement: Stmt<'a>,
    left: Stmt<'a>,
    right: Expr<'a>,
    body: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    write_own_line_comments_in_head(left, right, f);
    write!(
        f,
        group(&format_args!(
            "for",
            space(),
            "(",
            FormatForHead(left),
            space(),
            "in",
            space(),
            right,
            FormatCommentForEmptyStatement(body),
            ")",
            FormatStatementBody::new(body)
        ))
    );
}

pub(crate) fn write_for_of_statement<'a>(
    _statement: Stmt<'a>,
    left: Stmt<'a>,
    right: Expr<'a>,
    body: Stmt<'a>,
    is_await: bool,
    f: &mut Formatter<'a>,
) {
    write_own_line_comments_in_head(left, right, f);
    write!(
        f,
        group(&format_args!(
            "for",
            is_await.then_some(format_args!(space(), "await")),
            space(),
            "(",
            FormatForHead(left),
            space(),
            "of",
            space(),
            right,
            ")",
            FormatStatementBody::new(body)
        ))
    );
}

pub(crate) fn write_if_statement<'a>(
    _statement: Stmt<'a>,
    test: Expr<'a>,
    consequent: Stmt<'a>,
    alternate: Option<Stmt<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(
        f,
        group(&format_args!(
            "if",
            space(),
            "(",
            FormatCondition(test, &FormatTestOfIfAndWhileStatement(test)),
            ")",
            FormatStatementBody::new(consequent),
        ))
    );
    let Some(alternate) = alternate else {
        return;
    };
    let alternate_start = alternate.span().start;
    let comments = f.comments().comments_before(alternate_start);

    let has_line_comment = comments.iter().any(|comment| comment.is_line());
    // The comments are before the `else`.
    let has_dangling_comments = !f.is_quiet()
        && comments.last().or(f.comments().printed_comments().last()).is_some_and(|last_comment| {
            f.source_text().slice_range(last_comment.span.end, alternate_start).trim_ascii() == b"else"
        });

    let else_on_same_line =
        matches!(consequent.kind(), StmtKind::Block(_)) && (!has_line_comment || !has_dangling_comments);
    if else_on_same_line {
        write!(f, [space(), has_dangling_comments.then(line_suffix_boundary)]);
    } else {
        write!(f, hard_line_break());
    }

    if has_dangling_comments && let Some(first_comment) = comments.first() {
        if f.lines_before(first_comment.span) > 1 {
            write!(f, empty_line());
        }
        write!(
            f,
            FormatDanglingComments::Comments {
                comments,
                indent: DanglingIndentMode::None
            }
        );
        match has_line_comment {
            true => write!(f, hard_line_break()),
            false => write!(f, space()),
        }
    }

    let is_else_if = matches!(alternate.kind(), StmtKind::If { .. });
    write!(
        f,
        [
            "else",
            line_suffix_boundary(),
            group(&FormatStatementBody::new(alternate).with_forced_space(is_else_if))
        ]
    );
}

fn write_jump<'a>(keyword: &'static str, statement: Stmt<'a>, f: &mut Formatter<'a>) {
    write!(f, keyword);
    if let Some(label) = statement.label() {
        write!(f, [space(), identifier(label, statement.as_ast_nodes())]);
    }
    write!(f, OptionalSemicolon);
}

pub(crate) fn write_continue_statement<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    write_jump("continue", statement, f);
}

pub(crate) fn write_break_statement<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    write_jump("break", statement, f);
}

pub(crate) fn write_with_statement<'a>(_statement: Stmt<'a>, object: Expr<'a>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    write!(f, group(&format_args!("with", space(), "(", FormatCondition(object, &object), ")", FormatStatementBody::new(body))));
}

pub(crate) fn write_labeled_statement<'a>(statement: Stmt<'a>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    let comments = f.comments().line_comments_before(body.span().start);
    FormatLeadingComments::Comments(comments).fmt(f);

    if let Some(label) = statement.label() {
        write!(f, identifier(label, statement.as_ast_nodes()));
    }
    write!(f, ":");
    if matches!(body.kind(), StmtKind::Empty) {
        let empty_comments = f.comments().comments_before(statement.span().end);
        write!(f, [FormatTrailingComments::Comments(empty_comments), maybe_space(!empty_comments.is_empty()), ";"]);
    } else {
        write!(f, [space(), body]);
    }
}
