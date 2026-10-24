use bun_lint::prelude::*;
use bun_lint_oxlint::no_negated_condition::{fix_conditional_expression, fix_if_statement};

/// Disallow negated conditions.
pub struct NoNegatedCondition;

const UNEXPECTED_NEGATED: Message =
    Message::new("unexpectedNegated", "Unexpected negated condition.");

/// ESLint's `isNegatedIf`
#[inline]
fn is_negated(test: Expr) -> bool {
    test.unary_op() == Some(UnOp::Not)
        || matches!(test.binary_op(), Some(BinOp::NotEq | BinOp::NotEqEq))
}

impl Rule for NoNegatedCondition {
    const META: Meta = Meta::eslint("no-negated-condition", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::If]).exprs(&[ExprTag::Cond]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoNegatedCondition
    }

    #[inline]
    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((test, yes, Some(no))) = stmt.as_if()
            && no.tag() != StmtTag::If
            && is_negated(test)
        {
            Self::report_if(stmt, (test, yes, no), cx);
        }
    }

    #[inline]
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((test, yes, no)) = e.as_cond()
            && is_negated(test)
        {
            Self::report_conditional(e, (test, yes, no), cx);
        }
    }
}

impl NoNegatedCondition {
    #[inline(never)]
    fn report_if<'a>(
        stmt: Stmt<'a>,
        (test, yes, no): (Expr<'a>, Stmt<'a>, Stmt<'a>),
        cx: &Cx<'a, Self>,
    ) {
        // oxlint points at the test, and has a fix.
        match cx.language().is_oxlint {
            true => {
                let report = cx.report(test, UNEXPECTED_NEGATED).called_with(stmt);
                report.fix(|fixer| fix_if_statement(fixer, test, yes, no))
            }
            false => cx.report(stmt, UNEXPECTED_NEGATED),
        };
    }

    #[inline(never)]
    fn report_conditional<'a>(
        e: Expr<'a>,
        (test, yes, no): (Expr<'a>, Expr<'a>, Expr<'a>),
        cx: &Cx<'a, Self>,
    ) {
        match cx.language().is_oxlint {
            true => {
                let report = cx.report(test, UNEXPECTED_NEGATED).called_with(e);
                report.fix(|fixer| fix_conditional_expression(fixer, e, test, yes, no))
            }
            false => cx.report(e, UNEXPECTED_NEGATED),
        };
    }
}
