use bun_lint::prelude::*;

/// Enforce comparing `typeof` expressions against valid strings.
pub struct ValidTypeof {
    require_string_literals: bool,
}

const INVALID_VALUE: Message = Message::new("invalidValue", "Invalid typeof comparison value.");
const NOT_STRING: Message =
    Message::new("notString", "Typeof comparisons should be to string literals.");
const SUGGEST_STRING: Message =
    Message::new("suggestString", "Use `\"{{type}}\"` instead of `{{type}}`.");

const VALID_TYPES: [&str; 8] = [
    "symbol",
    "undefined",
    "object",
    "boolean",
    "number",
    "string",
    "function",
    "bigint",
];

fn is_typeof_expression(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Unary { op: UnOp::Typeof, .. })
}

impl ValidTypeof {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !is_typeof_expression(e) {
            return;
        }
        let Node::Expr(parent) = e.parent() else {
            return;
        };
        let ExprKind::Binary {
            op: BinOp::EqEq | BinOp::EqEqEq | BinOp::NotEq | BinOp::NotEqEq,
            left,
            right,
        } = parent.kind()
        else {
            return;
        };
        let sibling = if left == e { right } else { left };
        match sibling.kind() {
            ExprKind::String(value) => {
                if !value.is_any(&VALID_TYPES) {
                    cx.report(sibling, INVALID_VALUE);
                }
            }
            ExprKind::Template(template) if template.exprs().is_empty() => {
                if !template.as_static().is_some_and(|value| value.is_any(&VALID_TYPES)) {
                    cx.report(sibling, INVALID_VALUE);
                }
            }
            ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::Regex(_)
                // For oxlint they are like any other expression.
                if !cx.language().is_oxlint =>
            {
                cx.report(sibling, INVALID_VALUE);
            }
            ExprKind::Ident(name) if name.is("undefined") && ast_utils::is_global_reference(sibling) => {
                let message = if self.require_string_literals { NOT_STRING } else { INVALID_VALUE };
                let report = cx.report(sibling, message);
                // What ESLint suggests is a fix in oxlint.
                if cx.language().is_oxlint {
                    report.fix(|fixer| fixer.replace(sibling, "\"undefined\""));
                    return;
                }
                report.suggest_with(SUGGEST_STRING, &[("type", "undefined".as_bytes())], |fixer| {
                    fixer.replace(sibling, "\"undefined\"")
                });
            }
            _ => {
                if self.require_string_literals && !is_typeof_expression(sibling) {
                    cx.report(sibling, NOT_STRING);
                }
            }
        }
    }
}

impl Rule for ValidTypeof {
    const META: Meta = Meta::eslint("valid-typeof", Kind::Problem)
        .has_suggestions()
        .recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ValidTypeof {
            require_string_literals: options.object(0).bool_or("requireStringLiterals", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Unary], Self::check);
    }
}
