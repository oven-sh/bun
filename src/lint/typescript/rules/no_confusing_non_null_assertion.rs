use bun_lint::prelude::*;

/// Disallow non-null assertion in locations that may be confusing.
pub struct NoConfusingNonNullAssertion;

const CONFUSING_ASSIGN: Message = Message::new(
    "confusingAssign",
    "Confusing combination of non-null assertion and assignment like `a! = b`, which looks very similar to `a != b`.",
);
const CONFUSING_EQUAL: Message = Message::new(
    "confusingEqual",
    "Confusing combination of non-null assertion and equality test like `a! == b`, which looks very similar to `a !== b`.",
);
const CONFUSING_OPERATOR: Message = Message::new(
    "confusingOperator",
    "Confusing combination of non-null assertion and `{{operator}}` operator like `a! {{operator}} b`, which might be misinterpreted as `!(a {{operator}} b)`.",
);
const NOT_NEED_IN_ASSIGN: Message = Message::new(
    "notNeedInAssign",
    "Remove unnecessary non-null assertion (!) in assignment left-hand side.",
);
const NOT_NEED_IN_EQUAL_TEST: Message = Message::new(
    "notNeedInEqualTest",
    "Remove unnecessary non-null assertion (!) in equality test.",
);
const NOT_NEED_IN_OPERATOR: Message = Message::new(
    "notNeedInOperator",
    "Remove possibly unnecessary non-null assertion (!) in the left operand of the `{{operator}}` operator.",
);
const WRAP_UP_LEFT: Message = Message::new(
    "wrapUpLeft",
    "Wrap the left-hand side in parentheses to avoid confusion with \"{{operator}}\" operator.",
);

impl Rule for NoConfusingNonNullAssertion {
    const META: Meta = Meta::typescript("no-confusing-non-null-assertion", Kind::Problem)
        .has_suggestions()
        .presets(Presets::STYLISTIC);
    const ON: On = On::new().exprs(&[ExprTag::Binary, ExprTag::Assign]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConfusingNonNullAssertion
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (!file.is_javascript()).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (left, operator) = match e.kind() {
            ExprKind::Binary {
                op: op @ (BinOp::EqEq | BinOp::EqEqEq | BinOp::In | BinOp::Instanceof),
                left,
                ..
            } => (left, bin_op_text(op)),
            ExprKind::Assign { op: None, target, .. } => (target, "="),
            _ => return,
        };
        // Nothing but the operator ends with a `!`. This also finds the one in `1 + two! === 3`.
        let end = left.span().end;
        if cx.text().get(end.wrapping_sub(1) as usize) != Some(&b'!') || left.is_parenthesized() {
            return;
        }
        // A default value in a destructuring assignment is an `AssignmentPattern`.
        if operator == "=" && utils::is_assignment_target(e) {
            return;
        }
        let bang = Span::new(end - 1, end);
        let data = [("operator", operator.as_bytes())];
        let wrap_up_left = move |fixer: Fixer<'a>| [fixer.insert_before(left, "("), fixer.insert_after(left, ")")];
        let message = match operator {
            "=" => CONFUSING_ASSIGN,
            "==" | "===" => CONFUSING_EQUAL,
            _ => CONFUSING_OPERATOR,
        };
        let report = cx.report(e, message).data("operator", operator);
        // `a?.b!` is a `ChainExpression`.
        if left.tag() != ExprTag::NonNull || left.is_in_optional_chain() {
            let report = match cx.language().is_oxlint && message.id == CONFUSING_EQUAL.id {
                true => report.help(
                    "Wrap left-hand side in parentheses to avoid putting non-null assertion `!` and `=` together.",
                ),
                false => report,
            };
            report.suggest_with(WRAP_UP_LEFT, &data, wrap_up_left);
            return;
        }
        match operator {
            "=" => report.suggest(NOT_NEED_IN_ASSIGN, |fixer| fixer.remove(bang)),
            "==" | "===" => report.suggest(NOT_NEED_IN_EQUAL_TEST, |fixer| fixer.remove(bang)),
            _ => report
                .suggest_with(NOT_NEED_IN_OPERATOR, &data, |fixer| fixer.remove(bang))
                .suggest_with(WRAP_UP_LEFT, &data, wrap_up_left),
        };
    }
}
