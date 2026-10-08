use bun_lint::prelude::*;

/// Disallow the unary operators `++` and `--`.
pub struct NoPlusplus {
    allow_for_loop_afterthoughts: bool,
}

const UNEXPECTED_UNARY_OP: Message =
    Message::new("unexpectedUnaryOp", "Unary operator '{{operator}}' used.");

/// ESLint's `isForLoopAfterthought`: `e` is the update of a `for`, or an operand of comma operators
/// that are.
fn is_for_loop_afterthought(e: Expr) -> bool {
    let mut at = e;
    loop {
        match at.parent() {
            Node::Expr(parent) if matches!(parent.kind(), ExprKind::Binary { op: BinOp::Comma, .. }) => {
                at = parent;
            }
            Node::Stmt(parent) => {
                return matches!(parent.kind(), StmtKind::For { update: Some(update), .. } if update == at);
            }
            _ => return false,
        }
    }
}

impl Rule for NoPlusplus {
    const META: Meta = Meta::eslint("no-plusplus", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoPlusplus {
            allow_for_loop_afterthoughts: options.object(0).bool_or("allowForLoopAfterthoughts", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Unary], |rule, e, cx| {
            let ExprKind::Unary {
                op: op @ (UnOp::PreInc | UnOp::PostInc | UnOp::PreDec | UnOp::PostDec),
                ..
            } = e.kind()
            else {
                return;
            };
            if rule.allow_for_loop_afterthoughts && is_for_loop_afterthought(e) {
                return;
            }
            cx.report(e, UNEXPECTED_UNARY_OP).data("operator", un_op_text(op));
        });
    }
}
