use bun_lint_oxlint::ast_util::{as_member_expression, get_inner_expression, plain, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent style for element existence checks with `indexOf()`, `lastIndexOf()`, `findIndex()`, and
/// `findLastIndex()`.
pub struct ConsistentExistenceIndexCheck;

const CONSISTENT_EXISTENCE_INDEX_CHECK: Message = Message::new(
    "",
    "Prefer `{{replacement_operator}} -1` over `{{original_operator}} {{original_value}}` to check non-existence.",
);

const METHOD_NAMES: [&str; 4] = ["indexOf", "lastIndexOf", "findIndex", "findLastIndex"];

impl Rule for ConsistentExistenceIndexCheck {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "consistent-existence-index-check", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ConsistentExistenceIndexCheck
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&METHOD_NAMES) {
            return;
        }
        on.binaries([BinOp::Lt, BinOp::Gt, BinOp::Ge], |_, e, cx| {
            let ExprKind::Binary { op, left, right } = e.kind() else {
                return;
            };
            let (left, right) = (get_inner_expression(left), get_inner_expression(right));
            let is_number_0 = matches!(right.kind(), ExprKind::Number(value) if value == 0.0);
            let (replacement_operator, original_operator, original_value) = match op {
                BinOp::Lt if is_number_0 => ("===", "<", "0"),
                BinOp::Gt if is_negative_one(right) => ("!==", ">", "-1"),
                BinOp::Ge if is_number_0 => ("!==", ">=", "0"),
                _ => return,
            };
            if left.tag() == ExprTag::Ident
                && let Some(Node::VarDecl(declarator)) =
                    left.symbol().and_then(|it| it.declarations().next()).and_then(Declaration::node)
                && declarator.var_kind() == VarKind::Const
                && let Some(call) = declarator.init().and_then(plain).and_then(Expr::as_call)
                && as_member_expression(call.callee())
                    .and_then(static_property_name)
                    .is_some_and(|it| it.is_any(&METHOD_NAMES))
            {
                cx.report(e, CONSISTENT_EXISTENCE_INDEX_CHECK)
                    .data("replacement_operator", replacement_operator)
                    .data("original_operator", original_operator)
                    .data("original_value", original_value)
                    .fix(|fixer| {
                        Some([fixer.replace(e.operator_span()?, replacement_operator), fixer.replace(right, "-1")])
                    });
            }
        });
    }
}

/// `-1`, written like this.
fn is_negative_one(expression: Expr) -> bool {
    matches!(expression.kind(), ExprKind::Unary { op: UnOp::Minus, operand }
        if get_inner_expression(operand).tag() == ExprTag::Number && get_inner_expression(operand).text() == b"1")
}
