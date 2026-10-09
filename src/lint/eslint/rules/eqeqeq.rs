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

/// The sorts of literals that oxlint tells apart, by how they are written. A template can have substitutions.
fn literal_type_of_oxlint(e: Expr) -> Option<&'static str> {
    match e.kind() {
        _ if e.is_parenthesized() => None,
        ExprKind::Template(_) => Some("template"),
        ExprKind::Null => Some("null"),
        ExprKind::Regex(_) => Some("regex"),
        _ => literal_type(e),
    }
}

impl Eqeqeq {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint sees nothing in parentheses.
        let is_seen = |it: Expr<'a>| !(is_oxlint && it.is_parenthesized());
        let is_null = [left, right].into_iter().any(|it| it.tag() == ExprTag::Null && is_seen(it));
        let is_typeof = [left, right].into_iter().any(|it| is_typeof(it) && is_seen(it));
        let literal_type: fn(Expr<'a>) -> Option<&'static str> =
            if is_oxlint { literal_type_of_oxlint } else { literal_type };
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
            // oxlint says it of every operator, and expects the operator without its last character.
            _ if is_oxlint && is_null && self.null == Null::Never => {
                let text = bin_op_text(op);
                text.get(..text.len().saturating_sub(1)).unwrap_or_default()
            }
            _ => return,
        };
        let Some(operator) = e.operator_span() else {
            return;
        };
        let actual = bin_op_text(op);
        // oxlint points at the whole of `a === null`, and changes nothing there.
        let is_whole = is_oxlint && !matches!(op, BinOp::EqEq | BinOp::NotEq);
        let report = cx
            .report(if is_whole { e.span() } else { operator }, UNEXPECTED)
            .data("expectedOperator", expected)
            .data("actualOperator", actual);
        if is_whole {
            return;
        }
        // oxlint replaces all that is between the operands.
        let change = |fixer: Fixer<'a>| match is_oxlint {
            true => fixer.replace(left.outer_span().between(right.outer_span()), [" ", expected, " "].concat()),
            false => fixer.replace(operator, expected),
        };
        // The change is safe if both sides are known to have the same type.
        if is_typeof || are_literals_of_same_type {
            report.fix(change);
        } else {
            report.suggest_with(
                REPLACE_OPERATOR,
                &[
                    ("expectedOperator", expected.as_bytes()),
                    ("actualOperator", actual.as_bytes()),
                ],
                change,
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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.binaries([BinOp::EqEq, BinOp::NotEq], Self::check);
        if self.null == Null::Never {
            on.binaries([BinOp::EqEqEq, BinOp::NotEqEq], Self::check);
        }
        if self.null == Null::Never && file.language().is_oxlint {
            let others = [
                BinOp::Add,
                BinOp::Sub,
                BinOp::Mul,
                BinOp::Div,
                BinOp::Rem,
                BinOp::Pow,
                BinOp::Shl,
                BinOp::Shr,
                BinOp::UShr,
                BinOp::BitAnd,
                BinOp::BitOr,
                BinOp::BitXor,
                BinOp::Lt,
                BinOp::Le,
                BinOp::Gt,
                BinOp::Ge,
                BinOp::In,
                BinOp::Instanceof,
            ];
            on.binaries(others, Self::check);
        }
    }
}
