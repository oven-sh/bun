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

impl NoBitwise {
    /// `index`: of the operator of `e` in `BITWISE_OPERATORS`.
    fn check<'a>(&self, e: Expr<'a>, index: usize, cx: &Cx<'a, Self>) {
        if self.allowed & (1 << index) == 0 {
            cx.report(e, UNEXPECTED).data("operator", BITWISE_OPERATORS[index]);
        }
    }
}

impl Rule for NoBitwise {
    const META: Meta = Meta::eslint("no-bitwise", Kind::Suggestion);
    const ON: On = On::new()
        .exprs(&[ExprTag::Assign])
        .binaries(&[BinOp::BitXor, BinOp::BitOr, BinOp::BitAnd, BinOp::Shl, BinOp::Shr, BinOp::UShr])
        .unaries(&[UnOp::BitNot]);
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
        if let Some(Some(op)) = e.assign_op()
            && let Some(index) = index_of(op)
        {
            self.check(e, index + ASSIGNMENTS, cx);
        }
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((op, _, right)) = e.as_binary()
            && let Some(index) = index_of(op)
            && !(self.int32_hint && op == BinOp::BitOr && right.as_number() == Some(0.0))
        {
            self.check(e, index, cx);
        }
    }

    fn unary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(e, BIT_NOT, cx);
    }
}
