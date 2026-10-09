use bun_lint_oxlint::ast_util::{call_expr_method_callee_info, get_inner_expression, is_method_call};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `includes()` over `indexOf()` when checking for existence/non-existence.
pub struct PreferIncludes;

const PREFER_INCLUDES: Message =
    Message::new("", "Prefer `includes()` over `indexOf()` when checking for existence or non-existence.");

#[derive(Copy, Clone)]
enum ComparisonKind {
    /// `indexOf(...) != -1`, `!== -1`
    ExistsOrUndefined,
    /// `indexOf(...) > -1`, `>= 0`
    ExistsOnly,
    /// `indexOf(...) == -1`, `=== -1`, `< 0`
    NotExistsOnly,
}

fn is_raw_number(e: Expr, raw: &[u8]) -> bool {
    e.tag() == ExprTag::Number && e.text() == raw
}

fn is_negative_one(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Unary { op: UnOp::Minus, operand } if is_raw_number(operand, b"1"))
}

impl Rule for PreferIncludes {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-includes", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferIncludes
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("indexOf") {
            return;
        }
        let operators = [BinOp::NotEqEq, BinOp::NotEq, BinOp::Gt, BinOp::EqEqEq, BinOp::EqEq, BinOp::Ge, BinOp::Lt];
        on.binaries(operators, |_, e, cx| {
            let ExprKind::Binary { op, left, right } = e.kind() else {
                return;
            };
            let Some(call) = left.as_call() else {
                return;
            };
            let comparison_kind = match op {
                BinOp::NotEqEq | BinOp::NotEq if is_negative_one(right) => ComparisonKind::ExistsOrUndefined,
                BinOp::Gt if is_negative_one(right) => ComparisonKind::ExistsOnly,
                BinOp::EqEqEq | BinOp::EqEq if is_negative_one(right) => ComparisonKind::NotExistsOnly,
                BinOp::Ge if is_raw_number(right, b"0") => ComparisonKind::ExistsOnly,
                BinOp::Lt if is_raw_number(right, b"0") => ComparisonKind::NotExistsOnly,
                _ => return,
            };
            if !is_method_call(call, None, Some(&["indexOf"]), None, Some(2)) {
                return;
            }
            let Some((callee_span, _)) = call_expr_method_callee_info(call) else {
                return;
            };
            cx.report(callee_span, PREFER_INCLUDES).suggest(PREFER_INCLUDES, |fixer| {
                let (file, member) = (fixer.file(), get_inner_expression(call.callee()));
                let has_optional_chain = call.is_optional() || member.is_optional();
                let mut replacement = Vec::new();
                if !has_optional_chain && matches!(comparison_kind, ComparisonKind::NotExistsOnly) {
                    replacement.push(b'!');
                }
                replacement.extend_from_slice(file.slice(member.object()?.outer_span()));
                let method: &[u8] = if member.is_optional() { b"?.includes" } else { b".includes" };
                let open: &[u8] = if call.is_optional() { b"?.(" } else { b"(" };
                replacement.extend_from_slice(method);
                replacement.extend_from_slice(open);
                for (i, argument) in call.args().iter().enumerate() {
                    if i != 0 {
                        replacement.extend_from_slice(b", ");
                    }
                    replacement.extend_from_slice(file.slice(argument.outer_span()));
                }
                replacement.push(b')');
                if has_optional_chain {
                    let comparison = match comparison_kind {
                        ComparisonKind::ExistsOrUndefined => " !== false",
                        ComparisonKind::ExistsOnly => " === true",
                        ComparisonKind::NotExistsOnly => " === false",
                    };
                    replacement.extend_from_slice(comparison.as_bytes());
                }
                Some(fixer.replace(e, replacement))
            });
        });
    }
}
