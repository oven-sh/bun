use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::static_property_name_or_regex;

/// Disallow the unary operators `++` and `--`.
pub struct NoPlusplus {
    allow_for_loop_afterthoughts: bool,
}

const UNEXPECTED_UNARY_OP: Message =
    Message::new("unexpectedUnaryOp", "Unary operator '{{operator}}' used.");

/// ESLint's `isForLoopAfterthought`: `e` is the update of a `for`, or an operand of comma operators
/// that are.
fn is_for_loop_afterthought<'a>(e: Expr<'a>, known: &mut AncestorMemo<'a, bool>) -> bool {
    // For oxlint it can as well be the `init` or the test of a `for` that has an update.
    let is_oxlint = e.file().language().is_oxlint;
    let found = known.find(Node::Expr(e), |at, parent| match parent {
        Node::Expr(parent) if matches!(parent.kind(), ExprKind::Binary { op: BinOp::Comma, .. }) => None,
        Node::Stmt(parent) if is_oxlint => Some(matches!(parent.kind(), StmtKind::For { update: Some(_), .. })),
        Node::Stmt(parent) => {
            Some(matches!(parent.kind(), StmtKind::For { update: Some(update), .. } if Node::Expr(update) == at))
        }
        _ => Some(false),
    });
    found == Some(true)
}

impl Rule for NoPlusplus {
    const META: Meta = Meta::eslint("no-plusplus", Kind::Suggestion);
    /// `is_for_loop_afterthought`
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(options: &Options) -> Self {
        NoPlusplus {
            allow_for_loop_afterthoughts: options.object(0).bool_or("allowForLoopAfterthoughts", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.exprs([ExprTag::Unary], |rule, e, cx| {
            let ExprKind::Unary {
                op: op @ (UnOp::PreInc | UnOp::PostInc | UnOp::PreDec | UnOp::PostDec),
                operand,
            } = e.kind()
            else {
                return;
            };
            if rule.allow_for_loop_afterthoughts && is_for_loop_afterthought(e, &mut cx.state) {
                return;
            }
            let mut report = cx.report(e, UNEXPECTED_UNARY_OP).data("operator", un_op_text(op));
            if cx.language().is_oxlint {
                report = report.data("sign", if matches!(op, UnOp::PreInc | UnOp::PostInc) { "+" } else { "-" });
            }
            // What oxlint suggests for a name, and for a property whose name is known.
            let has_name = operand.tag() == ExprTag::Ident || static_property_name_or_regex(operand).is_some();
            if cx.language().is_oxlint && has_name {
                let operator: &[u8] = if matches!(op, UnOp::PreInc | UnOp::PostInc) { b" += 1" } else { b" -= 1" };
                report.fix(|fixer| fixer.replace(e, [operand.text(), operator].concat()));
            }
        });
        AncestorMemo::default()
    }
}
