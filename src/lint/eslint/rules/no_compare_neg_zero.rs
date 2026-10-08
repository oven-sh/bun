use bun_lint::prelude::*;

/// Disallow comparing against `-0`.
pub struct NoCompareNegZero;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Do not use the '{{operator}}' operator to compare against -0.",
);
const SUGGEST_REMOVE_MINUS: Message = Message::new(
    "suggestRemoveMinus",
    "Replace '-0' with '0' (keeps the current comparison behavior).",
);
const SUGGEST_OBJECT_IS: Message = Message::new(
    "suggestObjectIs",
    "Replace with 'Object.is()' (changes the comparison to distinguish -0 from +0).",
);
const SUGGEST_NOT_OBJECT_IS: Message = Message::new(
    "suggestNotObjectIs",
    "Replace with '!Object.is()' (changes the comparison to distinguish -0 from +0).",
);

fn is_neg_zero(e: Expr) -> bool {
    matches!(
        e.kind(),
        ExprKind::Unary { op: UnOp::Minus, operand }
            if matches!(operand.kind(), ExprKind::Number(value) if value == 0.0)
    )
}

/// Appends the text of `operand`, in parentheses where an argument needs them.
fn push_operand_text(text: &mut Vec<u8>, operand: Expr) {
    let is_sequence = matches!(operand.kind(), ExprKind::Binary { op: BinOp::Comma, .. });
    if is_sequence {
        text.push(b'(');
    }
    text.extend_from_slice(operand.text());
    if is_sequence {
        text.push(b')');
    }
}

impl NoCompareNegZero {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        if !matches!(
            op,
            BinOp::Gt
                | BinOp::Ge
                | BinOp::Lt
                | BinOp::Le
                | BinOp::EqEq
                | BinOp::EqEqEq
                | BinOp::NotEq
                | BinOp::NotEqEq
        ) {
            return;
        }
        let (left_is_neg_zero, right_is_neg_zero) = (is_neg_zero(left), is_neg_zero(right));
        if !left_is_neg_zero && !right_is_neg_zero {
            return;
        }
        let object_is = if op == BinOp::EqEqEq { SUGGEST_OBJECT_IS } else { SUGGEST_NOT_OBJECT_IS };
        cx.report(e, UNEXPECTED)
            .data("operator", bin_op_text(op))
            .suggest(SUGGEST_REMOVE_MINUS, |fixer| {
                let mut fixes = Vec::new();
                if left_is_neg_zero {
                    fixes.push(fixer.replace(left, "0"));
                }
                if right_is_neg_zero {
                    fixes.push(fixer.replace(right, "0"));
                }
                fixes
            })
            .suggest(object_is, |fixer| {
                let file = fixer.file();
                if !matches!(op, BinOp::EqEqEq | BinOp::NotEqEq) || file.comments_in(e).next().is_some() {
                    return None;
                }
                if file.global(b"Object").is_none() || Node::Expr(e).scope().resolve("Object").is_some() {
                    return None;
                }
                let mut text = Vec::new();
                if op == BinOp::NotEqEq {
                    text.push(b'!');
                }
                text.extend_from_slice(b"Object.is(");
                push_operand_text(&mut text, left);
                text.extend_from_slice(b", ");
                push_operand_text(&mut text, right);
                text.push(b')');
                Some(fixer.replace(e, text))
            });
    }
}

impl Rule for NoCompareNegZero {
    const META: Meta = Meta::eslint("no-compare-neg-zero", Kind::Problem)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCompareNegZero
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], Self::check);
    }
}
