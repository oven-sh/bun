use bun_lint_oxlint::ast_util::{as_member_expression, get_member_expr};
use crate::unicorn::is_prototype_property;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `Array#reduce()` and `Array#reduceRight()`.
pub struct NoArrayReduce {
    allow_simple_operations: bool,
}

const NO_ARRAY_REDUCE: Message =
    Message::new("", "Don't use `Array#reduce()` and `Array#reduceRight()`, use `for` loops instead.");

/// `a + b`, `a < b`, not `a && b` and not in parentheses.
fn is_binary_expression(e: Expr) -> bool {
    !e.is_parenthesized()
        && matches!(e.kind(), ExprKind::Binary { op, left, .. }
            if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
                && left.tag() != ExprTag::PrivateIdentifier)
}

fn returns_binary_expression(stmt: Stmt) -> bool {
    matches!(stmt.kind(), StmtKind::Return(Some(argument)) if is_binary_expression(argument))
}

/// `(accumulator, element) => accumulator + element`
fn is_simple_operation(callback: Expr) -> bool {
    let Some(callback) = callback.as_fn().filter(|_| !callback.is_parenthesized()) else {
        return false;
    };
    if let FnBody::Expr(body) = callback.body() {
        return is_binary_expression(body);
    }
    let mut statements = callback.body_statements().into_iter().flatten().filter(|it| it.directive().is_none());
    let (Some(statement), None) = (statements.next(), statements.next()) else {
        return false;
    };
    match statement.kind() {
        StmtKind::Expr(e) => is_binary_expression(e),
        StmtKind::Block(body) => body.len() == 1 && body.first().is_some_and(returns_binary_expression),
        _ => returns_binary_expression(statement),
    }
}

impl Rule for NoArrayReduce {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-array-reduce", Kind::Suggestion);
    const ON: On = On::new().method_calls(&["reduce", "reduceRight", "call", "apply"]);
    /// `reduce`, `reduceRight`, `call`, `apply`
    type State<'a> = [Name<'a>; 4];

    fn new(options: &Options) -> Self {
        NoArrayReduce { allow_simple_operations: options.object(0).bool_or("allowSimpleOperations", true) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.find_name("reduce").is_some() || file.find_name("reduceRight").is_some())
            .then(|| ["reduce", "reduceRight", "call", "apply"].map(|it| file.name_of(it)))
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let Some(member) = get_member_expr(call.callee()) else {
            return;
        };
        let Some((obj, name, _)) = member.as_dot().filter(|it| cx.state.contains(&it.1.name())) else {
            return;
        };
        if call.is_optional() {
            return;
        }
        let is_reported = match name.bytes() {
            b"reduce" | b"reduceRight" => {
                matches!(call.args().len(), 1 | 2)
                    && call.args().first().is_some_and(|callback| {
                        callback.tag() != ExprTag::Spread
                            && !(self.allow_simple_operations && is_simple_operation(callback))
                    })
            }
            // `[].reduce.call(array, callback)`, `Array.prototype.reduce.apply(array, [callback])`
            b"call" | b"apply" => {
                !member.is_optional()
                    && as_member_expression(obj).is_some_and(|it| {
                        it.tag() == ExprTag::Dot
                            && (is_prototype_property(it, "reduce", "Array")
                                || is_prototype_property(it, "reduceRight", "Array"))
                    })
            }
            _ => false,
        };
        if is_reported {
            cx.report(name, NO_ARRAY_REDUCE);
        }
    }
}
