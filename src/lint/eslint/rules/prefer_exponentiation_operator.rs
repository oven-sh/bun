use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::{
    PRECEDENCE_EXPONENTIATION, as_member_expression, get_precedence_without_parentheses, parent_node,
};
use bun_lint::utils::eslint_utils::{ReferenceTracker, TraceMap};

/// Disallow the use of `Math.pow` in favor of the `**` operator.
pub struct PreferExponentiationOperator;

const USE_EXPONENTIATION: Message = Message::new(
    "useExponentiation",
    "Use the '**' operator instead of 'Math.pow'.",
);

const TRACE_MAP: TraceMap<'static, ()> =
    TraceMap::new(&[("Math", TraceMap::new(&[("pow", TraceMap::EMPTY.call(()))]))]);

fn precedence_of_exponentiation_expr() -> i32 {
    ast_utils::get_binary_operator_precedence(BinOp::Pow)
}

/// Whether `base` needs parentheses as the left operand of `**`, which is right-associative and
/// does not allow a unary operator directly before it.
fn does_base_need_parens(base: Expr) -> bool {
    ast_utils::get_precedence(base) <= precedence_of_exponentiation_expr() || is_unary_or_await(base)
}

/// An `UnaryExpression` or an `AwaitExpression`
fn is_unary_or_await(e: Expr) -> bool {
    match e.kind() {
        ExprKind::Await(_) => true,
        ExprKind::Unary { op, .. } => !matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
        _ => false,
    }
}

/// oxlint's `needs_parens_for_parent`
fn needs_parens_for_parent(node: Expr) -> bool {
    let Some(Node::Expr(parent)) = parent_node(node) else {
        return false;
    };
    match parent.kind() {
        ExprKind::Binary { op: BinOp::Pow, right, .. } => right != node,
        ExprKind::As { .. } | ExprKind::AsConst(_) => !parent.is_angle_bracket_assertion(),
        ExprKind::Satisfies { .. } => true,
        ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::Call(_)
        | ExprKind::TaggedTemplate(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. } => parent.span().start == node.span().start,
        _ => is_unary_or_await(parent),
    }
}

/// What oxlint makes of `Math.pow(base, exponent)`, which is `node`.
fn fix_as_oxlint<'a>(fixer: Fixer<'a>, node: Expr<'a>, base: Expr<'a>, exponent: Expr<'a>) -> Fix {
    let file = fixer.file();
    let is_at_most = |e: Expr, limit: u8| get_precedence_without_parentheses(e).is_some_and(|it| it <= limit);
    let mut expression = Vec::new();
    let base_needs_parens = is_unary_or_await(base) || is_at_most(base, PRECEDENCE_EXPONENTIATION);
    push_parenthesized_if(&mut expression, file.slice(base.outer_span()), base_needs_parens);
    expression.extend_from_slice(b" ** ");
    let exponent_needs_parens = is_at_most(exponent, PRECEDENCE_EXPONENTIATION - 1);
    push_parenthesized_if(&mut expression, file.slice(exponent.outer_span()), exponent_needs_parens);
    let mut replacement = Vec::new();
    push_parenthesized_if(&mut replacement, &expression, needs_parens_for_parent(node));
    fixer.replace(node, replacement)
}

fn does_exponent_need_parens(exponent: Expr) -> bool {
    ast_utils::get_precedence(exponent) < precedence_of_exponentiation_expr()
}

/// Whether a `**` expression in the place of `node` would need parentheses.
fn does_exponentiation_expression_need_parens(node: Expr) -> bool {
    // ESLint compares the operand, the arguments and the property of the parent with the call, and
    // never finds it there if a `ChainExpression` is around it.
    let is_in_chain_expression = node.is_chain_root();
    let needs_parens = match node.parent() {
        // Not for a decorator.
        Node::Class(class) => class.extends() == Some(node),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Binary { op, right, .. } => {
                op == BinOp::Pow && (right != node || is_in_chain_expression)
            }
            ExprKind::Call(call) | ExprKind::New(call) => {
                call.callee() == node || is_in_chain_expression
            }
            ExprKind::TaggedTemplate(call) => call.callee() == node,
            ExprKind::Index { obj, .. } => obj == node || is_in_chain_expression,
            // ESLint goes by the name of the type: `TSAsExpression`, but `TSTypeAssertion`.
            ExprKind::As { .. } | ExprKind::AsConst(_) => !parent.is_angle_bracket_assertion(),
            ExprKind::Unary { .. }
            | ExprKind::Await(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::Dot { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. } => true,
            _ => false,
        },
        _ => false,
    };
    needs_parens && !ast_utils::is_parenthesised(node)
}

fn push_parenthesized_if(out: &mut Vec<u8>, text: &[u8], should_parenthesize: bool) {
    if should_parenthesize {
        out.push(b'(');
    }
    out.extend_from_slice(text);
    if should_parenthesize {
        out.push(b')');
    }
}

fn fix<'a>(fixer: Fixer<'a>, node: Expr<'a>, call: Call<'a>) -> Option<Fix> {
    let file = fixer.file();
    let args = call.args();
    let (Some(base), Some(exponent), 2) = (args.get(0), args.get(1), args.len()) else {
        return None;
    };
    if base.tag() == ExprTag::Spread
        || exponent.tag() == ExprTag::Spread
        || file.comments_in(node).next().is_some()
    {
        return None;
    }
    if file.language().is_oxlint {
        return Some(fix_as_oxlint(fixer, node, base, exponent));
    }
    let should_parenthesize_base = does_base_need_parens(base);
    let should_parenthesize_exponent = does_exponent_need_parens(exponent);
    let is_start_of_expression_statement = ast_utils::is_start_of_expression_statement(node);
    let mut should_parenthesize_all = does_exponentiation_expression_need_parens(node);
    let first_token_of_base = file.first_token(base)?;

    // A statement that starts with `function`, `class` or `{` is not an expression statement.
    if !should_parenthesize_all && !should_parenthesize_base && is_start_of_expression_statement {
        let first = first_token_of_base;
        should_parenthesize_all = ast_utils::is_opening_brace_token(&first)
            || first.is_keyword("function")
            || first.is_keyword("class")
            || matches!(first.kind(), TokenKind::Identifier | TokenKind::Keyword)
                && first.is("async")
                && file.token_after(first).is_some_and(|second| second.is_keyword("function"));
    }

    let (mut prefix, mut suffix) = ("", "");
    if !should_parenthesize_all {
        // a+Math.pow(++b, c) -> a+ ++b**c
        if !should_parenthesize_base
            && let Some(token_before) = file.token_before(node)
            && token_before.end() == node.span().start
            && !ast_utils::can_tokens_be_adjacent(token_before, first_token_of_base)
        {
            prefix = " ";
        }
        // Math.pow(a, b)in c -> a**b in c
        if !should_parenthesize_exponent
            && let Some(token_after) = file.token_after(node)
            && token_after.start() == node.span().end
            && !ast_utils::can_tokens_be_adjacent(file.last_token(exponent)?, token_after)
        {
            suffix = " ";
        }
    }

    let mut expression = Vec::new();
    push_parenthesized_if(&mut expression, base.text(), should_parenthesize_base);
    expression.extend_from_slice(b"**");
    push_parenthesized_if(&mut expression, exponent.text(), should_parenthesize_exponent);

    let continues_previous_line = should_parenthesize_all
        || matches!(expression.first(), Some(b'(' | b'[' | b'/' | b'`'));
    if prefix.is_empty()
        && is_start_of_expression_statement
        && continues_previous_line
        && ast_utils::needs_preceding_semicolon(node)
    {
        prefix = ";";
    }

    let mut replacement = prefix.as_bytes().to_vec();
    push_parenthesized_if(&mut replacement, &expression, should_parenthesize_all);
    replacement.extend_from_slice(suffix.as_bytes());
    Some(fixer.replace(node, replacement))
}

impl PreferExponentiationOperator {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        for reference in ReferenceTracker::new(cx.file()).iterate_global_references(&TRACE_MAP) {
            let (Some(node), Some(call)) = (reference.expr(), reference.call()) else {
                continue;
            };
            // oxlint wants two arguments, and `Math.pow` written out, with nothing in parentheses.
            let object = as_member_expression(call.callee()).and_then(Expr::object);
            let is_written_out = object.is_some_and(|it| !it.is_parenthesized() && !it.is_chain_root());
            if cx.language().is_oxlint && !(is_written_out && call.args().len() == 2) {
                continue;
            }
            cx.report(node, USE_EXPONENTIATION).fix(|fixer| fix(fixer, node, call));
        }
    }
}

impl Rule for PreferExponentiationOperator {
    const META: Meta =
        Meta::eslint("prefer-exponentiation-operator", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferExponentiationOperator
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_exprs([ExprTag::Call]) {
            on.finish(Self::check);
        }
    }
}
