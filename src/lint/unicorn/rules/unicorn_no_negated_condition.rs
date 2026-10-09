use bun_lint_oxlint::text::trim_start;
use crate::unicorn::could_be_asi_hazard;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow negated conditions.
pub struct NoNegatedCondition;

const NO_NEGATED_CONDITION: Message = Message::new("", "Unexpected negated condition.");

impl Rule for NoNegatedCondition {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-negated-condition", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNegatedCondition
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::If], |_, if_stmt, cx| {
            if let StmtKind::If { test, yes: consequent, no: Some(alternate) } = if_stmt.kind()
                && alternate.tag() != StmtTag::If
                && is_negated_expression(test)
            {
                cx.report(test, NO_NEGATED_CONDITION).fix(|fixer| {
                    let mut fixes = Vec::with_capacity(3);
                    fixes.extend(invert_test(fixer, test));
                    push_swap_statement_branches(&mut fixes, fixer, consequent, alternate);
                    fixes
                });
            }
        });
        on.exprs([ExprTag::Cond], |_, e, cx| {
            if let ExprKind::Cond { test, yes, no } = e.kind()
                && is_negated_expression(test)
            {
                cx.report(test, NO_NEGATED_CONDITION).fix(|fixer| fix_conditional_expression(fixer, e, test, yes, no));
            }
        });
    }
}

/// `!a`, `a != b`, `a !== b`
fn is_negated_expression(expr: Expr) -> bool {
    matches!(
        expr.kind(),
        ExprKind::Unary { op: UnOp::Not, .. } | ExprKind::Binary { op: BinOp::NotEq | BinOp::NotEqEq, .. }
    )
}

fn invert_test<'a>(fixer: Fixer<'a>, negated_test: Expr<'a>) -> Option<Fix> {
    let operator = negated_test.operator_span()?;
    Some(match negated_test.binary_op() {
        Some(BinOp::NotEq) => fixer.replace(operator, "=="),
        Some(_) => fixer.replace(operator, "==="),
        None => fixer.remove(operator),
    })
}

fn push_swap_statement_branches<'a>(fixes: &mut Vec<Fix>, fixer: Fixer<'a>, consequent: Stmt<'a>, alternate: Stmt<'a>) {
    let is_block = |it: Stmt| it.tag() == StmtTag::Block;
    if consequent.text() == alternate.text() && is_block(consequent) == is_block(alternate) {
        return;
    }
    // What is not a block gets braces, for the `;` that is not written and the `else` that would belong to another
    // `if`.
    let in_block = |it: Stmt<'a>| if is_block(it) { it.text().to_vec() } else { [b"{", it.text(), b"}"].concat() };
    fixes.extend([fixer.replace(consequent, in_block(alternate)), fixer.replace(alternate, in_block(consequent))]);
}

fn fix_conditional_expression<'a>(
    fixer: Fixer<'a>,
    e: Expr<'a>,
    test: Expr<'a>,
    yes: Expr<'a>,
    no: Expr<'a>,
) -> Vec<Fix> {
    let file = fixer.file();
    let mut fixes = Vec::with_capacity(8);
    if let ExprKind::Unary { operand: argument, .. } = test.kind() {
        // What the expression starts with without the `!`.
        let after_bang = file.slice(test.span().shrink(1, 0));
        let first_significant = text::first_code_point(trim_start(after_bang));
        let starts_with_any = |all: &[u8]| first_significant.is_some_and(|c| all.iter().any(|it| u32::from(*it) == c));
        let needs_restricted_parens = file.line_of(test.span().start + 1) != file.line_of(test.span().end)
            && !test.is_parenthesized()
            && !e.is_parenthesized()
            && match e.parent() {
                Node::Stmt(parent) => matches!(parent.tag(), StmtTag::Return | StmtTag::Throw),
                Node::Expr(parent) => parent.tag() == ExprTag::Yield,
                _ => false,
            };
        let before = file.text().get(..e.span().start as usize).unwrap_or_default();
        let needs_space_before = !needs_restricted_parens
            && text::last_code_point(before).is_some_and(text::is_identifier_part)
            && (first_significant.is_some_and(text::is_identifier_part) || starts_with_any(b"\\([`/+-."));
        let needs_asi_semi =
            !needs_restricted_parens && !needs_space_before && starts_with_any(b"([`+-/") && could_be_asi_hazard(e);
        let prefix: &[u8] = match (needs_asi_semi, needs_space_before, needs_restricted_parens) {
            (true, ..) => b";",
            (_, true, _) => b" ",
            (.., true) => b"(",
            _ => b"",
        };
        if !prefix.is_empty() {
            fixes.push(fixer.insert_before(e, prefix));
        }
        if needs_restricted_parens {
            fixes.push(fixer.insert_after(e, ")"));
        }
        if (matches!(argument.tag(), ExprTag::Object | ExprTag::Class)
            || argument.as_fn().is_some_and(|it| !it.is_arrow()))
            && is_expression_statement_start(e)
        {
            let argument_span = argument.outer_span();
            fixes.extend([fixer.insert_before(argument_span, "("), fixer.insert_after(argument_span, ")")]);
        }
    }
    fixes.extend(invert_test(fixer, test));
    let (cons_span, alt_span) = (yes.outer_span(), no.outer_span());
    let (cons_src, alt_src) = (file.slice(cons_span), file.slice(alt_span));
    if cons_src != alt_src {
        // `for (a ? b : c in d;;)` is something else.
        let is_for_statement_init = || {
            !e.is_parenthesized()
                && matches!(e.parent(), Node::Stmt(parent)
                    if matches!(parent.kind(), StmtKind::For { init: Some(init), .. }
                        if matches!(init.kind(), StmtKind::Expr(init) if init == e)))
        };
        let new_alt = if yes.binary_op() == Some(BinOp::In)
            && !yes.is_parenthesized()
            && yes.left().is_some_and(|it| it.tag() != ExprTag::PrivateIdentifier)
            && is_for_statement_init()
        {
            [b"(", cons_src, b")"].concat()
        } else {
            cons_src.to_vec()
        };
        fixes.extend([fixer.replace(cons_span, alt_src), fixer.replace(alt_span, new_alt)]);
    }
    fixes
}

/// Whether a statement starts with it.
fn is_expression_statement_start(e: Expr) -> bool {
    for ancestor in Node::Expr(e).ancestors() {
        match ancestor {
            Node::Stmt(statement) => {
                return statement.tag() == StmtTag::Expr && statement.span().start == e.span().start;
            }
            // It is not what the statement starts with either.
            Node::Expr(outer) if outer.span().start != e.span().start => return false,
            Node::Expr(outer) => match outer.tag() {
                ExprTag::Binary
                | ExprTag::Assign
                | ExprTag::Cond
                | ExprTag::As
                | ExprTag::AsConst
                | ExprTag::Satisfies
                | ExprTag::NonNull
                | ExprTag::Instantiation => {}
                _ => return false,
            },
            _ => return false,
        }
    }
    false
}
