//! The statements that don't have their own file.

use super::parameters::can_avoid_parentheses;
use super::semicolon::OptionalSemicolon;
use crate::js::comments::OwnedComments;
use crate::js::format::{identifier, name_without_comments};
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::js::trivia::comments_stay_between_head_and_body;
use crate::js::utils::expression::ExpressionLeftSide;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::statement_body::{
    FormatStatementBody, TrailingComments, write_comments_before_keyword,
    write_comments_before_token, write_space_before_body,
};
use crate::js::utils::typecast::{comments_of_expression, has_comments, is_cast_target};
use crate::prelude::*;
use crate::{format_args, write};

/// `;`, which is only printed where a statement is required: Prettier's `isMeaningfulEmptyStatement`.
#[inline(never)]
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

/// True if `statement` comes after the end of another statement, not after the head of one.
fn can_follow_a_statement(statement: Stmt<'_>) -> bool {
    !matches!(
        statement.ast_parent(),
        AstNodes::IfStatement(_)
            | AstNodes::DoWhileStatement(_)
            | AstNodes::WhileStatement(_)
            | AstNodes::ForStatement(_)
            | AstNodes::ForInStatement(_)
            | AstNodes::ForOfStatement(_)
            | AstNodes::WithStatement(_)
            | AstNodes::LabeledStatement(_)
    ) && statement.directive().is_none()
}

/// Without semicolons, true if a `(` printed before `e`, which [`expression_statement_needs_semicolon`] doesn't know
/// about, needs a `;` before it because `e` starts a statement. Prettier doesn't print one.
pub(crate) fn parenthesis_before_needs_semicolon<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let in_html = f.options().in_html;
    if !f.options().semicolons.is_as_needed()
        || in_html.is_inline_event_handler
        || in_html.root == HtmlRoot::VueEventBinding
    {
        return false;
    }
    let mut top = e;
    loop {
        match top.parent() {
            // The outer conditional prints its own `(` before this one.
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Cond { .. }) => return false,
            Node::Expr(parent)
                if (ExpressionLeftSide::from(parent).left()).is_some_and(|it| it.expr == top) =>
            {
                top = parent;
            }
            Node::Stmt(statement) => {
                return matches!(statement.kind(), StmtKind::Expr(it) if it == top)
                    && can_follow_a_statement(statement)
                    && !expression_statement_needs_semicolon(statement, top, f);
            }
            _ => return false,
        }
    }
}

/// Without semicolons, true if the statement has to start with a `;` so it isn't parsed as a continuation of the
/// previous line: it starts with `(`, `[`, `` ` ``, `+`, `-`, `/` or `<`.
pub(crate) fn expression_statement_needs_semicolon<'a>(
    statement: Stmt<'a>,
    expression: Expr<'a>,
    f: &Formatter<'a>,
) -> bool {
    if !can_follow_a_statement(statement) {
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
            && e.parens()
                .any(|parentheses| f.comments().is_cast_parenthesis(parentheses.start))
        {
            return true;
        }
        if current.is_assignment_target {
            return matches!(
                e.kind(),
                ExprKind::Array(_)
                    | ExprKind::As { .. }
                    | ExprKind::AsConst(_)
                    | ExprKind::Satisfies { .. }
            );
        }
        expression_needs_parentheses(e, f)
            || match e.kind() {
                ExprKind::Array(_)
                | ExprKind::Regex(_)
                | ExprKind::Jsx(_)
                | ExprKind::Template(_) => true,
                ExprKind::As { .. } | ExprKind::AsConst(_) => e.is_angle_bracket_assertion(),
                ExprKind::Fn(func) => func.is_arrow(),
                ExprKind::Unary { op, .. } => matches!(op, UnOp::Plus | UnOp::Minus),
                _ => false,
            }
    })
}

/// Like [`expression_statement_needs_semicolon`], for a statement that is copied verbatim from the source starting at
/// `start`. The copied text can start with a parenthesis that the printer would have dropped. Prettier's output for
/// `a = b⏎// prettier-ignore⏎(c).d()` calls `b`.
pub(crate) fn ignored_statement_needs_semicolon<'a>(
    statement: Stmt<'a>,
    start: u32,
    f: &Formatter<'a>,
) -> bool {
    let StmtKind::Expr(expression) = statement.kind() else {
        return false;
    };
    expression_statement_needs_semicolon(statement, expression, f)
        || (f.source_text().byte_at(start) == Some(b'(') && can_follow_a_statement(statement))
}

/// True if the last comment before the token at `position` looks like a type cast, with or without a `(` after it.
pub(crate) fn follows_type_cast_comment(position: u32, f: &Formatter<'_>) -> bool {
    (f.comments().comments_directly_before(position).last())
        .is_some_and(|comment| comment.looks_like_type_cast())
}

/// Prettier's `isSingleJsxExpressionStatementInMarkdown`: a Markdown code block that contains only JSX.
fn is_single_jsx_statement_in_markdown<'a>(
    statement: Stmt<'a>,
    expression: Expr<'a>,
    f: &Formatter<'a>,
) -> bool {
    f.options().is_in_markdown
        && matches!(expression.kind(), ExprKind::Jsx(_))
        && matches!(statement.ast_parent(), AstNodes::Program(_))
        && f.file().body().len() == 1
}

/// Prettier's `shouldPrintSemicolon` for a statement that's the whole value of an HTML attribute. Returns `None` if it
/// isn't, so the statement ends like any other.
fn semicolon_for_only_statement_in_html<'a>(
    statement: Stmt<'a>,
    expression: Expr<'a>,
    f: &Formatter<'a>,
) -> Option<bool> {
    let in_html = f.options().in_html;
    if !(in_html.is_inline_event_handler || in_html.root == HtmlRoot::VueEventBinding)
        || f.file().body().len() != 1
        || !matches!(statement.ast_parent(), AstNodes::Program(_))
    {
        return None;
    }
    if in_html.is_inline_event_handler {
        return Some(false);
    }
    // `unwrapVueEventBindingTsNode`
    let mut expression = expression;
    while let ExprKind::As { expr, .. }
    | ExprKind::Satisfies { expr, .. }
    | ExprKind::Instantiation { expr, .. }
    | ExprKind::AsConst(expr)
    | ExprKind::NonNull(expr) = expression.kind()
    {
        expression = expr;
    }
    // A function, or a path to one, which Vue calls.
    Some(match expression.kind() {
        ExprKind::Fn(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => true,
        ExprKind::Ident(_) => expression.text() != b"undefined",
        _ => false,
    })
}

#[inline(never)]
pub(crate) fn write_expression_statement<'a>(
    statement: Stmt<'a>,
    expression: Expr<'a>,
    f: &mut Formatter<'a>,
) {
    if is_single_jsx_statement_in_markdown(statement, expression, f) {
        return write!(f, expression);
    }
    let semicolon_in_html = semicolon_for_only_statement_in_html(statement, expression, f);
    // Before a type cast comment, `FormatStatements` has already printed the `;`.
    if f.options().semicolons.is_as_needed()
        && semicolon_in_html.is_none()
        && expression_statement_needs_semicolon(statement, expression, f)
        && !follows_type_cast_comment(statement.span().start, f)
    {
        write!(f, ";");
    }
    write!(f, expression);
    match semicolon_in_html {
        None => write!(f, OptionalSemicolon),
        Some(true) => write!(f, ";"),
        Some(false) => {}
    }
}

#[inline(never)]
pub(crate) fn write_do_while_statement<'a>(
    statement: Stmt<'a>,
    body: Stmt<'a>,
    test: Expr<'a>,
    f: &mut Formatter<'a>,
) {
    // oxfmt keeps the comments before the `while` on their lines. Comments on the line of a non-block body break the
    // group: `do⏎  a; // comment⏎while (b);`
    let comments_stay = !f.is_quiet() && comments_stay_between_head_and_body(f);
    let trailing_comments = match (comments_stay, body.kind()) {
        (false, _) => TrailingComments::All,
        (true, StmtKind::Block(_)) => TrailingComments::None,
        (true, _) => TrailingComments::OnSameLine,
    };
    let format_body = FormatStatementBody::new(body).with_trailing_comments(trailing_comments);
    write!(f, group(&format_args!("do", format_body)));
    let needs_separator = !comments_stay
        || write_comments_before_keyword(
            f.comments().of_node(body.as_ast_nodes()).trailing,
            (f.comments().of_node(AstNodes::DoWhileStatement(statement))).dangling,
            f,
        );
    match (needs_separator, body.kind()) {
        (false, _) => {}
        (true, StmtKind::Block(_)) => write!(f, space()),
        (true, _) => write!(f, hard_line_break()),
    }
    write!(
        f,
        [
            "while",
            space(),
            "(",
            FormatCondition(test),
            ")",
            OptionalSemicolon
        ]
    );
}

/// `!(a || b)` or `!!(a || b)`
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

/// Prettier 3.9 prints `if (!(` on one line. oxfmt follows 3.8, which breaks after `if (`.
fn hugs_negated_condition(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// Prettier's `shouldInlineCondition`: a negated logical expression starts right after the statement's `(`, so its
/// operands are indented the same as without the `!`.
fn should_inline_condition<'a>(test: Expr<'a>, f: &Formatter<'a>) -> bool {
    is_negated_logical_expression(test)
        && hugs_negated_condition(f)
        && !has_comments(test, f)
        && !is_cast_target(test, f)
}

/// Prettier's `printIfOrWhileConditionOrWithStatementObject`: the content of the parentheses of an `if`, `while`, `do`
/// or `with`.
struct FormatCondition<'a>(Expr<'a>);

impl<'a> Format<'a> for FormatCondition<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let test = self.0;
        match should_inline_condition(test, f) {
            true => write!(f, test),
            false => write!(f, group(&soft_block_indent(&test))),
        }
    }
}

fn write_while_or_with_statement<'a>(
    keyword: &'static str,
    test: Expr<'a>,
    body: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    write!(
        f,
        group(&format_args!(
            keyword,
            space(),
            "(",
            FormatCondition(test),
            ")",
            FormatStatementBody::new(body)
        ))
    );
}

#[inline(never)]
pub(crate) fn write_while_statement<'a>(
    _statement: Stmt<'a>,
    test: Expr<'a>,
    body: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    write_while_or_with_statement("while", test, body, f);
}

#[inline(never)]
pub(crate) fn write_with_statement<'a>(
    _statement: Stmt<'a>,
    object: Expr<'a>,
    body: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    write_while_or_with_statement("with", object, body, f);
}

/// An item in a `for` head: a declaration without its `;`, or an expression.
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

impl Spanned for FormatForHead<'_> {
    fn span(&self) -> Span {
        match self.0.kind() {
            StmtKind::Expr(expression) => expression.span(),
            _ => self.0.span(),
        }
    }
}

impl<'a> FormatForHead<'a> {
    fn comments(self, f: &Formatter<'a>) -> OwnedComments<'a> {
        match self.0.kind() {
            StmtKind::Expr(expression) => comments_of_expression(expression, f),
            _ => f.comments().of_node(self.0.as_ast_nodes()),
        }
    }
}

/// True if the token before `comment` is the one-byte `token`.
fn follows_token(comment: Comment<'_>, token: u8, f: &Formatter<'_>) -> bool {
    let last_byte = comment.prev_token_end().checked_sub(1);
    last_byte.and_then(|at| f.source_text().byte_at(at)) == Some(token)
}

/// `comments` follow a `;` in a `for` head. Returns the ones on the `;`'s line, if the line ends after them.
fn comments_ending_line_of_semicolon<'a>(
    comments: CommentList<'a>,
    f: &Formatter<'a>,
) -> CommentList<'a> {
    match (comments.first()).is_some_and(|first| follows_token(first, b';', f)) {
        true => comments.split_at_end_of_line().0,
        false => CommentList::empty(),
    }
}

/// See `comments_stay_between_head_and_body`. Prints the content of a `for`'s parentheses when it has comments. Each
/// comment stays on its side of the two `;`. `dangling` holds the comments where the `for` has no initializer, test or
/// update.
///
/// ```js
/// for (a; /* comment */; /* comment */);
/// for (
///   a
///   // comment
///   ;
///   b; // comment
///   c
/// );
/// ```
#[cold]
#[inline(never)]
fn write_for_head_with_comments_in_place<'a>(
    (init, test, update): (Option<Stmt<'a>>, Option<Expr<'a>>, Option<Expr<'a>>),
    dangling: CommentList<'a>,
    f: &mut Formatter<'a>,
) {
    let source = f.source_text();
    let precedes_parenthesis =
        |comment: &Comment<'a>| source.byte_at(comment.next_token_start()) == Some(b')');
    let init_count = (dangling.iter())
        .take_while(|comment| follows_token(*comment, b'(', f))
        .count();
    let update_count = (dangling.iter().rev())
        .take_while(precedes_parenthesis)
        .count();
    let (in_init, rest) = dangling.split_at(init_count);
    let (in_test, in_update) = rest.split_at(rest.len().saturating_sub(update_count));

    let is_empty = init.is_none() && test.is_none() && update.is_none();
    let separator = (!is_empty).then_some(soft_line_break_or_space());

    // `a; /* comment */ // comment⏎b`: comments that end the `;`'s line trail `a`.
    let split_at_semicolon = |trailing: CommentList<'a>, f: &Formatter<'a>| {
        let count = (trailing.iter()).position(|comment| follows_token(comment, b';', f));
        trailing.split_at(count.unwrap_or(trailing.len()))
    };

    let init = init.map(FormatForHead);
    if let Some(init) = &init {
        write!(f, FormatNodeWithoutTrailingComments(init));
    }
    let (before_semicolon, after_semicolon) = match init {
        Some(init) => split_at_semicolon(init.comments(f).trailing, f),
        None => (in_init, CommentList::empty()),
    };
    write_comments_before_token(before_semicolon, f);
    let before_test = test.map_or(in_test, |test| comments_of_expression(test, f).leading);
    write!(
        f,
        [
            ";",
            FormatTrailingComments::Comments(after_semicolon),
            FormatTrailingComments::Comments(comments_ending_line_of_semicolon(before_test, f)),
            separator
        ]
    );

    if let Some(test) = &test {
        write!(f, FormatNodeWithoutTrailingComments(test));
    }
    let (before_semicolon, after_semicolon) = match test {
        Some(test) => split_at_semicolon(comments_of_expression(test, f).trailing, f),
        None => (in_test, CommentList::empty()),
    };

    write_comments_before_token(before_semicolon, f);
    let before_update = update.map_or(in_update, |update| {
        comments_of_expression(update, f).leading
    });
    write!(
        f,
        [
            ";",
            FormatTrailingComments::Comments(after_semicolon),
            FormatTrailingComments::Comments(comments_ending_line_of_semicolon(before_update, f))
        ]
    );

    match update {
        Some(update) => write!(f, [separator, update]),
        None => {
            write_comments_before_token(in_update, f);
        }
    }
}

#[inline(never)]
pub(crate) fn write_for_statement<'a>(
    statement: Stmt<'a>,
    init: Option<Stmt<'a>>,
    test: Option<Expr<'a>>,
    update: Option<Expr<'a>>,
    body: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    let format_body = FormatStatementBody::new(body);
    let node = AstNodes::ForStatement(statement);
    let dangling = match f.is_quiet() {
        true => CommentList::empty(),
        false => f.comments().of_node(node).dangling,
    };
    if !f.is_quiet()
        && comments_stay_between_head_and_body(f)
        && (f.comments()).has_comment_in_span(Span::before(statement.span().start, body.span()))
    {
        let head = format_with(|f| {
            write_for_head_with_comments_in_place((init, test, update), dangling, f);
        });
        return write!(
            f,
            group(&format_args!(
                "for (",
                group(&soft_block_indent(&head)),
                ")",
                format_body
            ))
        );
    }
    // A comment in a head with nothing to attach to goes above the loop.
    if !dangling.is_empty() {
        write!(f, [dangling_comments(node), soft_line_break()]);
    }
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
                ";",
                soft_line_break_or_space(),
                test,
                ";",
                update.is_some().then_some(soft_line_break_or_space()),
                update,
            ))),
            ")",
            format_body
        ))
    );
}

/// See `comments_stay_between_head_and_body`: a line comment in the head of a `for (a in b)`, which doesn't break, is
/// printed before the `)`. Prettier prints it after the `{`.
fn boundary_before_parenthesis(f: &Formatter<'_>) -> Option<LineSuffixBoundary> {
    (!f.is_quiet() && comments_stay_between_head_and_body(f)).then_some(line_suffix_boundary())
}

#[inline(never)]
pub(crate) fn write_for_in_statement<'a>(
    _statement: Stmt<'a>,
    left: Stmt<'a>,
    right: Expr<'a>,
    body: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
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
            boundary_before_parenthesis(f),
            ")",
            FormatStatementBody::new(body)
        ))
    );
}

#[inline(never)]
pub(crate) fn write_for_of_statement<'a>(
    _statement: Stmt<'a>,
    left: Stmt<'a>,
    right: Expr<'a>,
    body: Stmt<'a>,
    is_await: bool,
    f: &mut Formatter<'a>,
) {
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
            boundary_before_parenthesis(f),
            ")",
            FormatStatementBody::new(body)
        ))
    );
}

#[inline(never)]
pub(crate) fn write_if_statement<'a>(
    statement: Stmt<'a>,
    test: Expr<'a>,
    consequent: Stmt<'a>,
    alternate: Option<Stmt<'a>>,
    f: &mut Formatter<'a>,
) {
    // `if (a) b; // comment⏎else c;`: oxfmt prints the comment outside the group, so it doesn't break the group. A
    // `prettier-ignore` comment stays with the statement it applies to.
    let comments_stay = !f.is_quiet() && comments_stay_between_head_and_body(f);
    let consequent_node = consequent.as_ast_nodes();
    let moves_trailing_comments =
        comments_stay && alternate.is_some() && !f.comments().is_ignored(consequent_node);
    write!(
        f,
        group(&format_args!(
            "if (",
            FormatCondition(test),
            ")",
            FormatStatementBody::new(consequent).with_trailing_comments(
                match moves_trailing_comments {
                    true => TrailingComments::None,
                    false => TrailingComments::All,
                }
            )
        ))
    );
    let Some(alternate) = alternate else {
        return;
    };

    let is_else_if = matches!(alternate.kind(), StmtKind::If { .. });
    let format_alternate = FormatStatementBody::new(alternate).with_forced_space(is_else_if);
    let is_after_comments_that_stay =
        write_up_to_else(statement, consequent, moves_trailing_comments, f);
    write!(
        f,
        [
            "else",
            is_after_comments_that_stay.then_some(line_suffix_boundary()),
            group(&format_alternate)
        ]
    );
}

/// Prints what's between the consequent and the `else`. Returns true if the comments there stay in place.
///
/// Not inlined: `if (a) {} else if (b) {} else ..` is nested, and inlining would add this function's stack use to every
/// level.
#[inline(never)]
fn write_up_to_else<'a>(
    statement: Stmt<'a>,
    consequent: Stmt<'a>,
    moves_trailing_comments: bool,
    f: &mut Formatter<'a>,
) -> bool {
    let is_consequent_block = matches!(consequent.kind(), StmtKind::Block(_));
    // The comments between the consequent and the `else`.
    let node = AstNodes::IfStatement(statement);
    let comments = match f.is_quiet() {
        true => CommentList::empty(),
        false => f.comments().of_node(node).dangling,
    };
    if !f.is_quiet() && comments_stay_between_head_and_body(f) {
        let trailing = match moves_trailing_comments {
            true => f.comments().of_node(consequent.as_ast_nodes()).trailing,
            false => CommentList::empty(),
        };
        let needs_separator = write_comments_before_keyword(trailing, comments, f);
        match (needs_separator, is_consequent_block) {
            (false, _) => {}
            (true, true) => write!(f, space()),
            (true, false) => write!(f, hard_line_break()),
        }
        return true;
    }

    if !is_consequent_block {
        write!(f, hard_line_break());
    }
    if let (Some(first), Some(last)) = (comments.first(), comments.last()) {
        let start = first.span().start as usize;
        if crate::text::is_previous_line_empty(f.source_text().as_bytes(), start) {
            write!(f, empty_line());
        } else if !first.has_newline_before() {
            write!(f, " ");
        } else if is_consequent_block {
            write!(f, hard_line_break());
        }
        write!(f, dangling_comments(node));
        match last.is_line() || last.has_newline_after() {
            true => write!(f, hard_line_break()),
            false => write!(f, space()),
        }
    } else if is_consequent_block {
        write!(f, space());
    }
    false
}

fn write_jump<'a>(keyword: &'static str, statement: Stmt<'a>, f: &mut Formatter<'a>) {
    write!(f, keyword);
    if let Some(label) = statement.label() {
        write!(f, [space(), identifier(label)]);
    }
    write!(f, OptionalSemicolon);
}

#[inline(never)]
pub(crate) fn write_continue_statement<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    write_jump("continue", statement, f);
}

#[inline(never)]
pub(crate) fn write_break_statement<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    write_jump("break", statement, f);
}

#[inline(never)]
pub(crate) fn write_labeled_statement<'a>(
    statement: Stmt<'a>,
    body: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    let Some(label) = statement.label() else {
        return;
    };
    let has_leading_comments =
        !f.is_quiet() && !f.comments().of_node(body.as_ast_nodes()).leading.is_empty();
    let is_only_semicolon = matches!(body.kind(), StmtKind::Empty) && !has_leading_comments;
    if f.is_quiet() || !comments_stay_between_head_and_body(f) {
        return write!(
            f,
            [
                identifier(label),
                ":",
                maybe_space(!is_only_semicolon),
                body
            ]
        );
    }

    // `a // comment⏎: b;` prints as `a: // comment⏎b;`
    let label_comments = f.comments().of_name(label.span().start);
    write!(
        f,
        [
            FormatLeadingComments::Comments(label_comments.leading),
            name_without_comments(label.span())
        ]
    );
    let follows_line_comment = write_comments_before_token(label_comments.trailing, f);
    write!(f, [":", follows_line_comment.then_some(hard_line_break())]);
    if !is_only_semicolon {
        write_space_before_body(body.as_ast_nodes(), f);
    }
    write!(f, body);
}
