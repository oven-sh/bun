use bun_lint::prelude::*;

/// Require the use of `===` and `!==`.
pub struct Eqeqeq {
    is_smart: bool,
    null: Null,
}

#[derive(PartialEq)]
enum Null {
    Always,
    Never,
    Ignore,
}

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Expected '{{expectedOperator}}' and instead saw '{{actualOperator}}'.",
);
const REPLACE_OPERATOR: Message = Message::new(
    "replaceOperator",
    "Use '{{expectedOperator}}' instead of '{{actualOperator}}'.",
);

fn is_typeof(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Unary { op: UnOp::Typeof, .. })
}

/// What `typeof node.value` is for ESLint's `Literal`, and for a template without substitutions.
fn literal_type(e: Expr) -> Option<&'static str> {
    Some(match e.kind() {
        ExprKind::String(_) => "string",
        ExprKind::Template(template) if template.exprs().is_empty() => "string",
        ExprKind::Number(_) => "number",
        ExprKind::True | ExprKind::False => "boolean",
        ExprKind::BigInt(_) => "bigint",
        ExprKind::Null | ExprKind::Regex(_) => "object",
        _ => return None,
    })
}

impl Eqeqeq {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        if !matches!(op, BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq) {
            return;
        }
        let is_null = matches!(left.kind(), ExprKind::Null) || matches!(right.kind(), ExprKind::Null);
        let is_typeof = is_typeof(left) || is_typeof(right);
        let are_literals_of_same_type =
            literal_type(left).is_some() && literal_type(left) == literal_type(right);
        let expected = match op {
            BinOp::EqEq | BinOp::NotEq => {
                if self.is_smart && (is_typeof || are_literals_of_same_type || is_null)
                    || is_null && self.null != Null::Always
                {
                    return;
                }
                if op == BinOp::EqEq { "===" } else { "!==" }
            }
            BinOp::EqEqEq | BinOp::NotEqEq if is_null && self.null == Null::Never => {
                if op == BinOp::EqEqEq { "==" } else { "!=" }
            }
            _ => return,
        };
        let Some(operator) = e.operator_span() else {
            return;
        };
        let actual = bin_op_text(op);
        let report = cx
            .report(operator, UNEXPECTED)
            .data("expectedOperator", expected)
            .data("actualOperator", actual);
        // The change is safe if both sides are known to have the same type.
        if is_typeof || are_literals_of_same_type {
            report.fix(|fixer| fixer.replace(operator, expected));
        } else {
            report.suggest_with(
                REPLACE_OPERATOR,
                &[
                    ("expectedOperator", expected.as_bytes()),
                    ("actualOperator", actual.as_bytes()),
                ],
                |fixer| fixer.replace(operator, expected),
            );
        }
    }
}

impl Rule for Eqeqeq {
    const META: Meta = Meta::eslint("eqeqeq", Kind::Suggestion)
        .fixable(Fixable::Code)
        .has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let mode = options.str(0).unwrap_or("always");
        Eqeqeq {
            is_smart: mode == "smart",
            null: match options.object(1).str("null") {
                _ if mode != "always" => Null::Ignore,
                Some("never") => Null::Never,
                Some("ignore") => Null::Ignore,
                _ => Null::Always,
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Binary], Self::check);
    }
}
