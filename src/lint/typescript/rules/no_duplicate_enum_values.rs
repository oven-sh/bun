use bun_lint::prelude::*;
use bun_lint::utils::text::{number_to_string, string_to_number};
use rustc_hash::{FxHashMap, FxHashSet};
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

impl Value<'_> {
    /// The same for two values if and only if [`Value::is`] holds.
    fn key(self) -> (bool, u64) {
        match self {
            Value::Number(value) => (false, value.to_bits()),
            Value::String(value) => (true, u64::from(value.atom().0)),
        }
    }
}

fn member_value(initializer: Expr<'_>) -> Option<Value<'_>> {
    let (mut operand, mut has_sign, mut is_negated) = (initializer, false, false);
    while let ExprKind::Unary {
        op: op @ (UnOp::Minus | UnOp::Plus),
        operand: inner,
    } = operand.kind()
    {
        (operand, has_sign) = (inner, true);
        is_negated ^= op == UnOp::Minus;
    }
    let value = match operand.kind() {
        ExprKind::String(value) => Value::String(value),
        ExprKind::Number(value) => Value::Number(value),
        ExprKind::Template(template) => Value::String(template.as_static()?),
        _ => return None,
    };
    if !has_sign {
        return Some(value);
    }
    let number = match value {
        Value::Number(value) => value,
        Value::String(value) => string_to_number(value.bytes()),
    };
    (!number.is_nan()).then_some(Value::Number(if is_negated { -number } else { number }))
}

fn report<'a>(place: Span, value: Value<'a>, cx: &mut Cx<'a, NoDuplicateEnumValues>) {
    let report = cx.report(place, DUPLICATE_VALUE);
    match value {
        Value::Number(value) => report.data("value", number_to_string(value)),
        Value::String(value) => report.data("value", value),
    };
}

/// oxlint looks at the numbers and the strings that are written as such, and points at the value that is repeated: the
/// first of the numbers, the string before this one.
fn check_as_oxlint<'a>(declaration: Enum<'a>, cx: &mut Cx<'a, NoDuplicateEnumValues>) {
    let mut seen: FxHashMap<(bool, u64), Span> = FxHashMap::default();
    for member in declaration.members() {
        let Some(initializer) = member.init().filter(|it| !it.is_parenthesized()) else {
            continue;
        };
        let value = match initializer.kind() {
            ExprKind::Number(value) => Value::Number(value),
            ExprKind::String(value) => Value::String(value),
            _ => continue,
        };
        let here = initializer.span();
        let before = seen.entry(value.key()).or_insert(here);
        if *before != here {
            let place = *before;
            if matches!(value, Value::String(_)) {
                *before = here;
            }
            report(place, value, cx);
        }
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
            if cx.language().is_oxlint {
                return check_as_oxlint(declaration, cx);
            }
            let mut seen: SmallVec<[Value<'a>; 8]> = SmallVec::new();
            // All of them, as soon as they are more than a few.
            let mut keys: FxHashSet<(bool, u64)> = FxHashSet::default();
            for member in declaration.members() {
                let Some(value) = member.init().and_then(member_value) else {
                    continue;
                };
                if seen.len() == 16 && keys.is_empty() {
                    keys.extend(seen.iter().map(|it| it.key()));
                }
                let is_new = match keys.is_empty() {
                    true => !seen.iter().any(|it| it.is(value)),
                    false => keys.insert(value.key()),
                };
                if is_new {
                    if keys.is_empty() {
                        seen.push(value);
                    }
                    continue;
                }
                report(member.span(), value, cx);
            }
        });
    }
}
