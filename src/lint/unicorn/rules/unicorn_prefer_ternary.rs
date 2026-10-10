use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint_oxlint::same_expression::{is_same_expression, is_same_inner_expression, is_same_member_expression};
use crate::unicorn::static_string_value;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;
use std::cell::OnceCell;

/// Prefers ternary expressions over simple `if`/`else` statements.
pub struct PreferTernary {
    only_single_line: bool,
}

const PREFER_TERNARY: Message = Message::new("", "Prefer ternary expressions over simple `if-else` statements.");

impl Rule for PreferTernary {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-ternary", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::If]);
    /// Where the line feeds of the file are.
    type State<'a> = OnceCell<Vec<u32>>;

    fn new(options: &Options) -> Self {
        PreferTernary { only_single_line: options.str(0) == Some("only-single-line") }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(OnceCell::new())
    }

    fn stmt<'a>(&self, if_statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::If { test, yes, no: Some(no) } = if_statement.kind() else {
            return;
        };
        let (consequent, alternate) = (get_node_body_statement(yes), get_node_body_statement(no));
        if !is_mergeable(consequent, alternate) || is_ternary_expression(test) || is_else_if_branch(if_statement) {
            return;
        }
        // What is long is not read: an `if` can be in a function that another `if` returns.
        let is_single_line = |span: Span| match span.len() {
            ..=256 => !strings::contains_char(cx.slice(span), b'\n'),
            _ => {
                let line_feeds = cx.state.get_or_init(|| line_feeds(cx.file().text()));
                line_feeds.get(line_feeds.partition_point(|it| *it < span.start)).is_none_or(|it| *it >= span.end)
            }
        };
        let span_of_body = |body: BodyNode| match body {
            BodyNode::Expression(expression) => expression.span(),
            BodyNode::Statement(statement) => statement.span(),
        };
        if !self.only_single_line
            || is_single_line(span_of_body(consequent))
                && is_single_line(span_of_body(alternate))
                && is_single_line(get_inner_expression(test).span())
        {
            cx.report(if_statement, PREFER_TERNARY);
        }
    }
}

fn line_feeds(text: &[u8]) -> Vec<u32> {
    let mut all = Vec::new();
    let mut at = 0;
    while let Some(found) = text.get(at..).and_then(|rest| strings::index_of_char_usize(rest, b'\n')) {
        all.push((at + found) as u32);
        at += found + 1;
    }
    all
}

#[derive(Copy, Clone)]
enum BodyNode<'a> {
    Statement(Stmt<'a>),
    /// Of an expression statement, without `as T` and the like.
    Expression(Expr<'a>),
}

/// What a branch does: the only statement in its braces that is not empty.
fn get_node_body_statement(statement: Stmt<'_>) -> BodyNode<'_> {
    let mut statement = statement;
    loop {
        match statement.kind() {
            StmtKind::Expr(expression) => return BodyNode::Expression(get_inner_expression(expression)),
            StmtKind::Block(body) => {
                let mut non_empty = body.iter().filter(|it| it.tag() != StmtTag::Empty);
                match (non_empty.next(), non_empty.next()) {
                    (Some(single), None) => statement = single,
                    _ => return BodyNode::Statement(statement),
                }
            }
            _ => return BodyNode::Statement(statement),
        }
    }
}

fn is_else_if_branch(if_statement: Stmt) -> bool {
    matches!(if_statement.parent(), Node::Stmt(parent)
        if matches!(parent.kind(), StmtKind::If { no, .. } if no == Some(if_statement)))
}

fn is_ternary_expression(expression: Expr) -> bool {
    get_inner_expression(expression).tag() == ExprTag::Cond
}

/// Both return, throw, yield, await, or assign to the same, and not a ternary expression.
fn is_mergeable<'a>(consequent: BodyNode<'a>, alternate: BodyNode<'a>) -> bool {
    let is_ternary = |it: Option<Expr>| it.is_some_and(is_ternary_expression);
    match (consequent, alternate) {
        (BodyNode::Statement(consequent), BodyNode::Statement(alternate)) => {
            match (consequent.kind(), alternate.kind()) {
                (StmtKind::Return(consequent), StmtKind::Return(alternate)) => {
                    !is_ternary(consequent) && !is_ternary(alternate)
                }
                (StmtKind::Throw(consequent), StmtKind::Throw(alternate)) => {
                    !is_ternary_expression(consequent) && !is_ternary_expression(alternate)
                }
                _ => false,
            }
        }
        (BodyNode::Expression(consequent), BodyNode::Expression(alternate)) => {
            match (consequent.kind(), alternate.kind()) {
                (ExprKind::Yield { value, star }, ExprKind::Yield { value: other_value, star: other_star }) => {
                    star == other_star && !is_ternary(value) && !is_ternary(other_value)
                }
                (ExprKind::Await(consequent), ExprKind::Await(alternate)) => {
                    !is_ternary_expression(consequent) && !is_ternary_expression(alternate)
                }
                (
                    ExprKind::Assign { op, target, value },
                    ExprKind::Assign { op: other_op, target: other_target, value: other_value },
                ) => {
                    op == other_op
                        && !is_ternary_expression(value)
                        && !is_ternary_expression(other_value)
                        && is_same_assignment_target(target, other_target)
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn is_same_assignment_target<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    let is_member = |it: Expr| matches!(it.tag(), ExprTag::Dot | ExprTag::Index);
    if let (Some(left), Some(right)) = (left.as_ident(), right.as_ident()) {
        return left == right;
    }
    if is_member(left) && is_member(right) {
        return match (
            member_static_property_name(left),
            member_static_property_name(right),
            left.object(),
            right.object(),
        ) {
            (Some(left_name), Some(right_name), Some(left_object), Some(right_object)) => {
                left_name == right_name && is_same_inner_expression(left_object, right_object)
            }
            _ => is_same_member_expression(left, right),
        };
    }
    // `(a as T) = b`
    let get_expression = |it: Expr<'a>| {
        it.operand()
            .filter(|_| matches!(it.tag(), ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull))
    };
    matches!((get_expression(left), get_expression(right)), (Some(left), Some(right))
        if !left.is_parenthesized() && !right.is_parenthesized() && is_same_expression(left, right))
}

/// Also of `a["b" + "c"]`.
fn member_static_property_name(member: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    match (static_property_name(member), member.kind()) {
        (Some(name), _) => Some(Cow::Borrowed(name.bytes())),
        (None, ExprKind::Index { index, .. }) => static_string_value(index).map(Cow::Owned),
        _ => None,
    }
}
