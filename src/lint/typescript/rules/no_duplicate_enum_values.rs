use bun_lint::prelude::*;
use bun_lint::utils::text::{number_to_string, string_to_number};
use smallvec::SmallVec;

/// Disallow duplicate enum member values.
pub struct NoDuplicateEnumValues;

const DUPLICATE_VALUE: Message =
    Message::new("duplicateValue", "Duplicate enum member value {{value}}.");

#[derive(Copy, Clone)]
enum Value<'a> {
    Number(f64),
    String(Name<'a>),
}

impl Value<'_> {
    /// `Object.is`
    fn is(self, other: Self) -> bool {
        match (self, other) {
            (Value::Number(a), Value::Number(b)) => a.to_bits() == b.to_bits(),
            (Value::String(a), Value::String(b)) => a == b,
            _ => false,
        }
    }
}

fn member_value(initializer: Expr<'_>) -> Option<Value<'_>> {
    match initializer.kind() {
        ExprKind::String(value) => Some(Value::String(value)),
        ExprKind::Number(value) => Some(Value::Number(value)),
        ExprKind::Template(template) => template.as_static().map(Value::String),
        ExprKind::Unary {
            op: op @ (UnOp::Minus | UnOp::Plus),
            operand,
        } => {
            let inner = match member_value(operand)? {
                Value::Number(value) => value,
                Value::String(value) => string_to_number(value.bytes()),
            };
            if inner.is_nan() {
                return None;
            }
            Some(Value::Number(if op == UnOp::Minus { -inner } else { inner }))
        }
        _ => None,
    }
}

impl Rule for NoDuplicateEnumValues {
    const META: Meta = Meta::typescript("no-duplicate-enum-values", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDuplicateEnumValues
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Enum], |_, stmt, cx| {
            let StmtKind::Enum(declaration) = stmt.kind() else {
                return;
            };
            let mut seen: SmallVec<[Value<'a>; 8]> = SmallVec::new();
            for member in declaration.members() {
                let Some(value) = member.init().and_then(member_value) else {
                    continue;
                };
                if !seen.iter().any(|it| it.is(value)) {
                    seen.push(value);
                    continue;
                }
                let report = cx.report(member, DUPLICATE_VALUE);
                match value {
                    Value::Number(value) => report.data("value", number_to_string(value)),
                    Value::String(value) => report.data("value", value),
                };
            }
        });
    }
}
