//! The statements that do not have a file of their own.

use super::parameters::can_avoid_parentheses;
use super::program::ends_before_semicolon;
use super::semicolon::OptionalSemicolon;
use crate::js::format::identifier;
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::js::utils::expression::ExpressionLeftSide;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::statement_body::{FormatStatementBody, comments_before_else};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

/// `;`, which is only written where a statement has to be: Prettier's
/// `isMeaningfulEmptyStatement`.
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
            | AstNodes::LabeledStatement(_)
    ) {
        write!(f, ";");
    }
}

/// Without semicolons, whether the statement has to start with one so that it is not read as the
/// continuation of the line before: it starts with `(`, `[`, `` ` ``, `+`, `-`, `/` or `<`.
pub(crate) fn expression_statement_needs_semicolon<'a>(statement: Stmt<'a>, expression: Expr<'a>, f: &Formatter<'a>) -> bool {
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
    ) || statement.directive().is_some()
    {
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
        // `/** @type {T} */ (a).b` keeps its parentheses.
        if f.comments().has_type_cast_comments()
            && e.is_parenthesized()
            && e.parens().any(|parentheses| follows_type_cast_comment(parentheses.start, f))
        {
            return true;
        }
        if current.is_assignment_target {
            return matches!(
                e.kind(),
                ExprKind::Array(_) | ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. }
            );
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

/// Whether the last comment before `position` is a type cast comment.
pub(crate) fn follows_type_cast_comment(position: u32, f: &Formatter<'_>) -> bool {
    let comments = f.comments();
    comments.has_type_cast_comments()
        && comments
            .comments_before(position)
            .last()
            .or_else(|| comments.printed_comments().last())
            .is_some_and(|comment| {
                comments.is_type_cast_comment(comment)
                    && comment.span.end <= position
                    && f.source_text().all_bytes_match(comment.span.end, position, |b| b.is_ascii_whitespace())
            })
}

/// Prettier's `isSingleJsxExpressionStatementInMarkdown`: all of the code in a block in Markdown is JSX.
fn is_single_jsx_statement_in_markdown<'a>(statement: Stmt<'a>, expression: Expr<'a>, f: &Formatter<'a>) -> bool {
    f.options().is_in_markdown
        && matches!(expression.kind(), ExprKind::Jsx(_))
        && matches!(statement.ast_parent(), AstNodes::Program(_))
        && f.file().body().len() == 1
}

pub(crate) fn write_expression_statement<'a>(statement: Stmt<'a>, expression: Expr<'a>, f: &mut Formatter<'a>) {
    if is_single_jsx_statement_in_markdown(statement, expression, f) {
        return write!(f, expression);
    }
    // Before a type cast comment, `FormatStatements` has written the `;`.
    if f.options().semicolons.is_as_needed()
        && expression_statement_needs_semicolon(statement, expression, f)
        && !follows_type_cast_comment(statement.span().start, f)
    {
        write!(f, ";");
    }
    // `statement(); // prettier-ignore`
    if !f.is_quiet() && f.comments().has_trailing_suppression_comment(statement.span().end) {
        return write!(f, FormatSuppressedNode(statement.span()));
    }
    // Prettier's `handleParenthesizedExpressionTrailingComment`: `(a /* comment */);` is
    // `a; /* comment */`.
    write!(f, [FormatNodeWithoutTrailingComments(&expression), OptionalSemicolon]);
    if !f.is_quiet() {
        let end = f.comments().without_semicolon(statement.span()).end;
        write!(f, FormatTrailingComments::Comments(f.comments().comments_before(end)));
    }
}

pub(crate) fn write_do_while_statement<'a>(statement: Stmt<'a>, body: Stmt<'a>, test: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, group(&format_args!("do", FormatStatementBody::new(body))));
    match body.kind() {
        StmtKind::Block(_) => write!(f, space()),
        _ => write!(f, hard_line_break()),
    }
    let condition = FormatCondition {
        test,
        head: Head::EndsWith(statement),
    };
    write!(f, ["while", space(), "(", condition, ")", OptionalSemicolon]);
}

/// The parentheses after the keyword of a statement.
#[derive(Copy, Clone)]
enum Head<'a> {
    /// They are followed by the body of the statement.
    Before(Stmt<'a>),
    /// `do .. while (..);`
    EndsWith(Stmt<'a>),
}

impl<'a> Head<'a> {
    /// A position after the `)` and before the first comment after it. That comment is not in the
    /// head: it leads the body, or trails the statement.
    fn end(self, f: &Formatter<'a>) -> u32 {
        match self {
            Head::Before(body) => {
                let mut end = body.span().start;
                for comment in f.comments().comments_before(end).iter().rev() {
                    if f.source_text().bytes_contain(comment.span.end, end, b')') {
                        break;
                    }
                    end = comment.span.start;
                }
                end
            }
            Head::EndsWith(statement) => f.comments().without_semicolon(statement.span()).end,
        }
    }
}

/// Writes what is in the head of a statement. Meanwhile the comments after the `)` are hidden.
struct FormatInHead<'a, 'b, T>(Head<'a>, &'b T);

impl<'a, T: Format<'a>> Format<'a> for FormatInHead<'a, '_, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            return self.1.fmt(f);
        }
        let end = self.0.end(f);
        let previous_limit = f.comments_mut().limit_comments_up_to(end);
        self.1.fmt(f);
        f.comments_mut().restore_view_limit(previous_limit);
    }
}

/// Prettier's `shouldInlineCondition`, but for the comments: `!(a || b)` and `!!(a || b)` start
/// right after the `(` of the statement, so that the indentation is the same as without the `!`.
fn is_negated_logical_expression(test: Expr<'_>) -> bool {
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
}

/// Prettier 3.9 writes `if (!(` on one line. oxfmt follows 3.8, which breaks after `if (`.
fn hugs_negated_condition(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// Prettier's `printIfOrWhileConditionOrWithStatementObject`: all there is in the head of an `if`,
/// a `while`, a `do` or a `with`.
struct FormatCondition<'a> {
    test: Expr<'a>,
    head: Head<'a>,
}

impl<'a> Format<'a> for FormatCondition<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let test = self.test;
        if f.is_quiet() {
            return match is_negated_logical_expression(test) && hugs_negated_condition(f) {
                true => write!(f, test),
                false => write!(f, group(&soft_block_indent(&test))),
            };
        }

        let end = self.head.end(f);
        let has_comments = f.comments().has_comment_before(test.span().start)
            || f.comments().has_comment_in_range(test.span().end, end);
        // All comments between the condition and the `)` trail the condition.
        let content = format_with(|f| {
            let previous_limit = f.comments_mut().limit_comments_up_to(end);
            write!(f, FormatNodeWithoutTrailingComments(&test));
            let comments = f.comments().unprinted_comments();
            write!(f, FormatTrailingComments::Comments(comments));
            f.comments_mut().restore_view_limit(previous_limit);
        });
        match !has_comments && is_negated_logical_expression(test) && hugs_negated_condition(f) {
            true => write!(f, content),
            false => write!(f, group(&soft_block_indent(&content))),
        }
    }
}

fn write_while_or_with_statement<'a>(keyword: &'static str, test: Expr<'a>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    let condition = FormatCondition {
        test,
        head: Head::Before(body),
    };
    write!(f, group(&format_args!(keyword, space(), "(", condition, ")", FormatStatementBody::new(body))));
}

pub(crate) fn write_while_statement<'a>(_statement: Stmt<'a>, test: Expr<'a>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    write_while_or_with_statement("while", test, body, f);
}

pub(crate) fn write_with_statement<'a>(_statement: Stmt<'a>, object: Expr<'a>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    write_while_or_with_statement("with", object, body, f);
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
            FormatInHead(
                Head::Before(body),
                &group(&soft_block_indent(&format_args!(
                    init.map(FormatForHead),
                    ";",
                    soft_line_break_or_space(),
                    test,
                    ";",
                    update.is_some().then_some(soft_line_break_or_space()),
                    update,
                )))
            ),
            ")",
            format_body
        ))
    );
}

/// Where a comment between two nodes is. See [`comment_placements`].
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum CommentPlacement {
    /// It starts its line: it leads the following node.
    OwnLine,
    /// It ends its line: it trails the preceding node.
    EndOfLine,
    /// A token is between it and the following node: it trails the preceding node.
    BeforeToken,
    /// It leads the following node.
    BeforeNode,
}

impl CommentPlacement {
    pub(crate) fn leads(self) -> bool {
        matches!(self, CommentPlacement::OwnLine | CommentPlacement::BeforeNode)
    }
}

/// What Prettier's `attachComments` does with `comments`: all the comments between a node and the
/// next one, which starts at `following_start`. Of the handlers, only the one for type cast comments
/// is heeded.
pub(crate) fn comment_placements(
    comments: &[Comment],
    following_start: u32,
    f: &Formatter<'_>,
) -> SmallVec<[CommentPlacement; 8]> {
    let source = f.source_text();
    let is_blank = |start: u32, end: u32| source.all_bytes_match(start, end, |b| matches!(b, b' ' | b'\t'));
    let mut placements: SmallVec<[CommentPlacement; 8]> = SmallVec::new();

    // A comment behind one that starts the line counts as starting it.
    let mut previous: Option<(&Comment, bool)> = None;
    for comment in comments {
        let starts_line = comment.preceded_by_newline()
            || previous.is_some_and(|(previous, starts_line)| {
                starts_line && is_blank(previous.span.end, comment.span.start)
            });
        placements.push(match starts_line {
            true => CommentPlacement::OwnLine,
            false => CommentPlacement::BeforeToken,
        });
        previous = Some((comment, starts_line));
    }

    // The same for the end of the line.
    let (mut ends_line, mut next_start) = (false, following_start);
    let mut gap_end = Some(following_start);
    for (comment, placement) in comments.iter().zip(&mut placements).rev() {
        ends_line = comment.followed_by_newline() || (ends_line && is_blank(comment.span.end, next_start));
        next_start = comment.span.start;
        if *placement == CommentPlacement::OwnLine {
            continue;
        }
        if ends_line {
            // Prettier's `handleClosureTypeCastComments`
            *placement = match f.comments().is_type_cast_comment(comment) {
                true => CommentPlacement::BeforeNode,
                false => CommentPlacement::EndOfLine,
            };
            continue;
        }
        gap_end = gap_end
            .filter(|&end| source.all_bytes_match(comment.span.end, end, |b| b.is_ascii_whitespace() || b == b'('))
            .map(|_| comment.span.start);
        if gap_end.is_some() {
            *placement = CommentPlacement::BeforeNode;
        }
    }
    placements
}

/// `left in right`, `left of right`
struct FormatForInOrOfHead<'a> {
    left: Stmt<'a>,
    keyword: &'static str,
    right: Expr<'a>,
}

impl<'a> Format<'a> for FormatForInOrOfHead<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (left, right) = (FormatForHead(self.left), self.right);
        if f.is_quiet() {
            return write!(f, [left, space(), self.keyword, space(), right]);
        }

        let previous_limit = f.comments_mut().limit_comments_up_to(self.left.span().end);
        write!(f, left);
        f.comments_mut().restore_view_limit(previous_limit);

        // A comment that leads `right` can be before one that trails `left`.
        let comments = f.comments().comments_before(right.span().start);
        let leads: SmallVec<[bool; 8]> =
            comment_placements(comments, right.span().start, f).iter().map(|it| it.leads()).collect();

        let trailing_count = leads.iter().take_while(|leads| !**leads).count();
        if leads.iter().skip(trailing_count).all(|leads| *leads) {
            let trailing = comments.get(..trailing_count).unwrap_or_default();
            return write!(f, [FormatTrailingComments::Comments(trailing), space(), self.keyword, space(), right]);
        }
        for (comment, _) in comments.iter().zip(&leads).filter(|(_, leads)| !**leads) {
            write!(f, FormatTrailingComments::Comments(std::slice::from_ref(comment)));
        }
        write!(f, [space(), self.keyword, space()]);
        for (comment, _) in comments.iter().zip(&leads).filter(|(_, leads)| **leads) {
            write!(f, FormatLeadingComments::Comments(std::slice::from_ref(comment)));
        }
        write!(f, right);
    }
}

pub(crate) fn write_for_in_statement<'a>(
    _statement: Stmt<'a>,
    left: Stmt<'a>,
    right: Expr<'a>,
    body: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    let head = FormatForInOrOfHead {
        left,
        keyword: "in",
        right,
    };
    write!(
        f,
        group(&format_args!(
            "for",
            space(),
            "(",
            FormatInHead(Head::Before(body), &head),
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
    let head = FormatForInOrOfHead {
        left,
        keyword: "of",
        right,
    };
    write!(
        f,
        group(&format_args!(
            "for",
            is_await.then_some(format_args!(space(), "await")),
            space(),
            "(",
            FormatInHead(Head::Before(body), &head),
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
    let condition = FormatCondition {
        test,
        head: Head::Before(consequent),
    };
    write!(f, group(&format_args!("if (", condition, ")", FormatStatementBody::new(consequent))));
    let Some(alternate) = alternate else {
        return;
    };

    let is_consequent_block = matches!(consequent.kind(), StmtKind::Block(_));
    if !is_consequent_block {
        write!(f, hard_line_break());
    }
    let comments = match f.is_quiet() {
        true => &[][..],
        false => comments_before_else(consequent, alternate, f),
    };
    if let (Some(first), Some(last)) = (comments.first(), comments.last()) {
        match f.lines_before(first.span) {
            0 => write!(f, " "),
            1 => write!(f, is_consequent_block.then_some(hard_line_break())),
            _ => write!(f, empty_line()),
        }
        write!(
            f,
            FormatDanglingComments::Comments {
                comments,
                indent: DanglingIndentMode::None
            }
        );
        let is_else_on_next_line = match block_comments_stay_before_else(f) {
            true => comments.iter().any(|comment| comment.is_line()),
            false => last.followed_by_newline(),
        };
        match is_else_on_next_line {
            true => write!(f, hard_line_break()),
            false => write!(f, space()),
        }
    } else if is_consequent_block {
        write!(f, space());
    }

    let is_else_if = matches!(alternate.kind(), StmtKind::If { .. });
    write!(f, ["else", group(&FormatStatementBody::new(alternate).with_forced_space(is_else_if))]);
}

/// oxfmt writes `/* comment */ else` on one line, wherever the `else` is in the source.
fn block_comments_stay_before_else(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
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

pub(crate) fn write_labeled_statement<'a>(statement: Stmt<'a>, body: Stmt<'a>, f: &mut Formatter<'a>) {
    let Some(label) = statement.label() else {
        return;
    };
    let body_start = body.span().start;
    let is_empty = matches!(body.kind(), StmtKind::Empty);
    if !f.comments().has_comment_before(body_start) {
        return write!(f, [source_text(label.span()), ":", maybe_space(!is_empty), body]);
    }

    // Prettier's `handleLabeledStatementComments`: a comment that starts or ends its line goes
    // before the label.
    let comments = f.comments().comments_before(body_start);
    let placements = comment_placements(comments, body_start, f);
    let all = || comments.iter().map(std::slice::from_ref).zip(placements.iter().copied());
    let before_label =
        || all().filter(|(_, it)| matches!(it, CommentPlacement::OwnLine | CommentPlacement::EndOfLine));
    if before_label().any(|(comment, _)| comment.first().is_some_and(|it| f.comments().is_suppression_comment(it))) {
        let span = f.comments().without_semicolon(statement.span());
        return write!(f, [FormatSuppressedNode(span), ends_before_semicolon(statement).then_some(OptionalSemicolon)]);
    }
    for (comment, _) in before_label() {
        write!(f, FormatLeadingComments::Comments(comment));
    }
    write!(f, source_text(label.span()));
    for (comment, _) in all().filter(|(_, placement)| *placement == CommentPlacement::BeforeToken) {
        write!(f, FormatTrailingComments::Comments(comment));
    }
    write!(f, [":", maybe_space(!is_empty || placements.contains(&CommentPlacement::BeforeNode))]);
    for (comment, _) in all().filter(|(_, placement)| *placement == CommentPlacement::BeforeNode) {
        write!(f, FormatLeadingComments::Comments(comment));
    }
    write!(f, body);
}
