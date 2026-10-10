use bun_lint::prelude::*;

/// Disallow bitwise operators.
pub struct NoBitwise {
    /// The bit `i` is set if `BITWISE_OPERATORS[i]` is allowed.
    allowed: u16,
    int32_hint: bool,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected use of '{{operator}}'.");

const BITWISE_OPERATORS: [&str; 13] =
    ["^", "|", "&", "<<", ">>", ">>>", "^=", "|=", "&=", "<<=", ">>=", ">>>=", "~"];

const ASSIGNMENTS: usize = 6;
const BIT_NOT: usize = 12;

/// The index of the binary operator in `BITWISE_OPERATORS`.
fn index_of(op: BinOp) -> Option<usize> {
    Some(match op {
        BinOp::BitXor => 0,
        BinOp::BitOr => 1,
        BinOp::BitAnd => 2,
        BinOp::Shl => 3,
        BinOp::Shr => 4,
        BinOp::UShr => 5,
        _ => return None,
    })
}

impl Rule for NoBitwise {
    const META: Meta = Meta::eslint("no-bitwise", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Binary, ExprTag::Assign, ExprTag::Unary]);
    no_state!();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        let mut allowed = 0;
        for operator in object.strings("allow") {
            if let Some(index) = BITWISE_OPERATORS.iter().position(|it| *it == operator) {
                allowed |= 1 << index;
            }
        }
        NoBitwise {
            allowed,
            int32_hint: object.bool_or("int32Hint", false),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let index = match e.kind() {
            ExprKind::Binary { op, right, .. } => {
                let Some(index) = index_of(op) else {
                    return;
                };
                if self.int32_hint
                    && op == BinOp::BitOr
                    && matches!(right.kind(), ExprKind::Number(value) if value == 0.0)
                {
                    return;
                }
                index
            }
            ExprKind::Assign { op: Some(op), .. } => match index_of(op) {
                Some(index) => index + ASSIGNMENTS,
                None => return,
            },
            ExprKind::Unary { op: UnOp::BitNot, .. } => BIT_NOT,
            _ => return,
        };
        if self.allowed & (1 << index) == 0 {
            cx.report(e, UNEXPECTED).data("operator", BITWISE_OPERATORS[index]);
        }
    }
}
