use bun_lint::prelude::*;
use bun_lint::types::{IdSet, NodeFlags, SyntaxKind, TsSymbol, Type};
use bun_lint::types::tsutils::{
    intersection_constituents, is_intrinsic_null_type, is_intrinsic_undefined_type,
    union_constituents,
};
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::utils::eslint_utils::{StaticValue, get_static_value};
use bun_lint::utils::is_assignment_target;
use bun_lint::utils::ts_utils::{is_assignee, is_static_member_access_of_value};
use smallvec::SmallVec;

/// Enforce the use of Array.prototype.find() over Array.prototype.filter() followed by [0] when
/// looking for a single result.
pub struct PreferFind;

const PREFER_FIND: Message =
    Message::new("preferFind", "Prefer .find(...) instead of .filter(...)[0].");
const PREFER_FIND_SUGGESTION: Message =
    Message::new("preferFindSuggestion", "Use .find(...) instead of .filter(...)[0].");

#[derive(Copy, Clone)]
struct FilterExpressionData {
    /// The `filter` of `.filter(..)`, the `'filter'` of `['filter'](..)`.
    filter_node: Span,
    is_bracket_syntax_for_filter: bool,
}

type FilterExpressions = SmallVec<[FilterExpressionData; 2]>;

/// Whether the type is a possibly nullable array or tuple, or a union thereof.
fn is_arrayish(ty: Type) -> bool {
    let mut is_at_least_one_arrayish_component = false;
    for union_part in union_constituents(ty) {
        if is_intrinsic_null_type(union_part) || is_intrinsic_undefined_type(union_part) {
            continue;
        }
        // `T[] & S[]` is not an array type for the checker.
        let is_array_or_intersection_thereof = intersection_constituents(union_part)
            .iter()
            .all(|intersection_part| intersection_part.is_array_type() || intersection_part.is_tuple_type());
        if !is_array_or_intersection_thereof {
            return false;
        }
        is_at_least_one_arrayish_component = true;
    }
    is_at_least_one_arrayish_component
}

/// Adds the calls of `Array.prototype.filter` whose result is the value of `node`. There are
/// several where it is a ternary. False if it can have another value.
fn parse_array_filter_expressions(mut node: Expr, found: &mut FilterExpressions) -> bool {
    loop {
        match node.kind() {
            // Only the last expression of `(a, b, [1, 2, 3].filter(condition))[0]` matters.
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => node = right,
            ExprKind::Cond { yes, no, .. } => {
                if !parse_array_filter_expressions(yes, found) {
                    return false;
                }
                node = no;
            }
            ExprKind::Call(call) if !call.is_optional() => {
                let callee = call.callee();
                let is_oxlint = node.file().language().is_oxlint;
                // ESLint has a `ChainExpression` around the callee of `(a?.filter)()`. tsgolint skips the parentheses.
                if !is_oxlint && callee.is_chain_root() {
                    return false;
                }
                let (object, filter_node, is_bracket_syntax_for_filter) = match callee.kind() {
                    ExprKind::Dot { obj, name, .. } => (obj, name.span(), false),
                    ExprKind::Index { obj, index, .. } => (obj, index.span(), true),
                    _ => return false,
                };
                let is_filter = match is_oxlint {
                    true => tsgolint_is_static_member_access_of_value(callee, b"filter"),
                    false => is_static_member_access_of_value(callee, &["filter"]),
                };
                if !is_filter || !is_arrayish(get_constrained_type_at_location(object)) {
                    return false;
                }
                found.push(FilterExpressionData {
                    filter_node,
                    is_bracket_syntax_for_filter,
                });
                return true;
            }
            _ => return false,
        }
    }
}

/// The index that `Array.prototype.at` makes of `value` is 0.
fn is_treated_as_zero_by_array_at(value: &StaticValue) -> bool {
    if matches!(value, StaticValue::Symbol(_)) {
        return false;
    }
    value.to_js_number().is_some_and(|as_number| as_number.is_nan() || as_number.trunc() == 0.0)
}

/// `array[value]` is the first element.
fn is_treated_as_zero_by_member_access(value: &StaticValue) -> bool {
    value.to_js_string().is_some_and(|text| &*text == b"0")
}

/// tsgolint's `staticValue`. It has no symbol: what the rule asks of one, it answers as for an
/// expression without a static value. Of a bigint it only asks whether it is zero.
#[derive(Copy, Clone)]
enum TsgolintStaticValue<'a> {
    String(&'a [u8]),
    Number(f64),
    Boolean(bool),
    Null,
    Undefined,
    BigInt { is_zero: bool },
}

/// tsgolint's `toNumber`
fn tsgolint_to_number(value: TsgolintStaticValue) -> Option<f64> {
    match value {
        TsgolintStaticValue::Number(n) => Some(n),
        TsgolintStaticValue::String(s) => Some(bun_core::fmt::js_string_to_number(s)),
        TsgolintStaticValue::Boolean(b) => Some(f64::from(u8::from(b))),
        TsgolintStaticValue::Null => Some(0.0),
        TsgolintStaticValue::Undefined => Some(f64::NAN),
        TsgolintStaticValue::BigInt { .. } => None,
    }
}

/// tsgolint's `getStaticValue`, which is not that of eslint-utils: `undefined`, `NaN` and `Infinity`
/// are told by their text, a variable is followed if the value declaration of the checker's symbol
/// is a `const` with an initializer, and of the operators only `+`, `-`, `as`, `<T>` and `!` are known.
fn tsgolint_get_static_value<'a>(
    node: Expr<'a>,
    visited: &mut IdSet<TsSymbol<'a>>,
) -> Option<TsgolintStaticValue<'a>> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return None;
    }
    match node.kind() {
        ExprKind::String(text) => Some(TsgolintStaticValue::String(text.bytes())),
        ExprKind::Template(template) => Some(TsgolintStaticValue::String(template.as_static()?.bytes())),
        ExprKind::Number(n) => Some(TsgolintStaticValue::Number(n)),
        ExprKind::True => Some(TsgolintStaticValue::Boolean(true)),
        ExprKind::False => Some(TsgolintStaticValue::Boolean(false)),
        ExprKind::Null => Some(TsgolintStaticValue::Null),
        ExprKind::BigInt(_) => {
            let digits = match node.text() {
                [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', digits @ ..] => digits,
                digits => digits,
            };
            let is_zero = digits.iter().all(|c| matches!(c, b'0' | b'_' | b'n'));
            Some(TsgolintStaticValue::BigInt { is_zero })
        }
        ExprKind::Ident(name) => {
            match name.bytes() {
                b"undefined" => return Some(TsgolintStaticValue::Undefined),
                b"NaN" => return Some(TsgolintStaticValue::Number(f64::NAN)),
                b"Infinity" => return Some(TsgolintStaticValue::Number(f64::INFINITY)),
                _ => {}
            }
            let symbol = node.ts_symbol()?;
            if visited.contains(symbol) {
                return None;
            }
            // tsgolint's `getConstInitializer`
            let declaration = symbol.value_declaration()?;
            if declaration.kind() != SyntaxKind::VariableDeclaration || !declaration.flags().contains(NodeFlags::CONST)
            {
                return None;
            }
            let initializer = declaration.initializer()?.to_ast()?.as_expr()?;
            visited.insert(symbol);
            let value = tsgolint_get_static_value(initializer, visited);
            visited.remove(symbol);
            value
        }
        ExprKind::Unary {
            op: op @ (UnOp::Minus | UnOp::Plus),
            operand,
        } => {
            let operand = tsgolint_get_static_value(operand, visited)?;
            Some(match (op, operand) {
                (UnOp::Minus, TsgolintStaticValue::BigInt { .. }) => operand,
                (UnOp::Minus, _) => TsgolintStaticValue::Number(-tsgolint_to_number(operand)?),
                _ => TsgolintStaticValue::Number(tsgolint_to_number(operand)?),
            })
        }
        ExprKind::As { expr, .. } | ExprKind::AsConst(expr) | ExprKind::NonNull(expr) => {
            tsgolint_get_static_value(expr, visited)
        }
        _ => None,
    }
}

/// tsgolint's `isStaticMemberAccessOfValue`, for a `value` that is not what a number, a boolean,
/// `null` or `undefined` is as a property name.
fn tsgolint_is_static_member_access_of_value(node: Expr, value: &[u8]) -> bool {
    match node.kind() {
        ExprKind::Dot { name, .. } => name.bytes() == value,
        ExprKind::Index { index, .. } => matches!(
            tsgolint_get_static_value(index, &mut IdSet::new()),
            Some(TsgolintStaticValue::String(name)) if name == value
        ),
        _ => false,
    }
}

/// tsgolint's `isTreatedAsZeroByArrayAt`
fn tsgolint_is_treated_as_zero_by_array_at(value: TsgolintStaticValue) -> bool {
    tsgolint_to_number(value).is_some_and(|as_number| as_number.is_nan() || as_number.trunc() == 0.0)
}

/// tsgolint's `isTreatedAsZeroByMemberAccess`
fn tsgolint_is_treated_as_zero_by_member_access(value: TsgolintStaticValue) -> bool {
    match value {
        TsgolintStaticValue::String(text) => text == b"0",
        TsgolintStaticValue::Number(n) => n == 0.0,
        TsgolintStaticValue::BigInt { is_zero } => is_zero,
        _ => false,
    }
}

impl PreferFind {
    /// `whole`: `object[0]`, `object.at(0)`
    fn report<'a>(
        cx: &Cx<'a, Self>,
        whole: Expr<'a>,
        object: Expr<'a>,
        filter_expressions: &FilterExpressions,
    ) {
        let is_oxlint = cx.language().is_oxlint;
        cx.report(whole, PREFER_FIND).suggest(PREFER_FIND_SUGGESTION, |fixer| {
            // tsgolint also suggests `a.find(f) = 1` and `a.find(f)++`, which do not parse.
            if is_oxlint && (is_assignee(whole) || is_assignment_target(whole)) {
                return None;
            }
            // The `.` of `(..).at(0)`, the `[` of `(..)[0]` or `(..)["at"](0)`, the `?.` of `(..)?.at(0)`.
            let token_to_start_deleting_from = fixer
                .file()
                .tokens_after(object)
                .find(|token| !token.is(")"))
                .filter(|token| token.is(".") || token.is("[") || token.is("?."))?;
            let mut fixes: Vec<Fix> = filter_expressions
                .iter()
                .map(|filter_expression| {
                    let find = match filter_expression.is_bracket_syntax_for_filter {
                        true => "\"find\"",
                        false => "find",
                    };
                    fixer.replace(filter_expression.filter_node, find)
                })
                .collect();
            fixes.push(fixer.remove(Span::new(token_to_start_deleting_from.start(), whole.span().end)));
            // `(filtered.at)(0)`: no suggestion.
            if is_oxlint && whole.callee().is_some_and(|callee| callee.is_parenthesized()) {
                return None;
            }
            Some(fixes)
        });
    }

    /// `filtered.at(0)`
    fn check_call<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = node.kind() else {
            return;
        };
        let (Some(argument), 1) = (call.args().first(), call.args().len()) else {
            return;
        };
        let callee = call.callee();
        let (ExprKind::Dot { obj: object, .. } | ExprKind::Index { obj: object, .. }) = callee.kind()
        else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let is_at = match is_oxlint {
            // tsgolint only minds the `?.` of the call, `a.at?.(0)`, and skips the parentheses of the callee.
            true => !call.is_optional() && tsgolint_is_static_member_access_of_value(callee, b"at"),
            false => {
                !callee.is_optional() && !callee.is_chain_root() && is_static_member_access_of_value(callee, &["at"])
            }
        };
        if !is_at {
            return;
        }
        let mut filter_expressions = FilterExpressions::new();
        if !parse_array_filter_expressions(object, &mut filter_expressions) {
            return;
        }
        let is_zero = match is_oxlint {
            true => tsgolint_get_static_value(argument, &mut IdSet::new())
                .is_some_and(tsgolint_is_treated_as_zero_by_array_at),
            false => get_static_value(argument, Some(cx.file().scope()))
                .as_ref()
                .is_some_and(is_treated_as_zero_by_array_at),
        };
        if is_zero {
            Self::report(cx, node, object, &filter_expressions);
        }
    }

    /// `filtered[0]`
    fn check_member<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Index {
            obj: object,
            index,
            chain,
        } = node.kind()
        else {
            return;
        };
        if chain == Chain::Start {
            return;
        }
        let mut filter_expressions = FilterExpressions::new();
        if !parse_array_filter_expressions(object, &mut filter_expressions) {
            return;
        }
        let is_zero = match cx.language().is_oxlint {
            true => tsgolint_get_static_value(index, &mut IdSet::new())
                .is_some_and(tsgolint_is_treated_as_zero_by_member_access),
            false => get_static_value(index, Some(cx.file().scope()))
                .as_ref()
                .is_some_and(is_treated_as_zero_by_member_access),
        };
        if is_zero {
            Self::report(cx, node, object, &filter_expressions);
        }
    }
}

impl Rule for PreferFind {
    const META: Meta = Meta::typescript("prefer-find", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Call, ExprTag::Index]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferFind
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            ExprTag::Call => self.check_call(node, cx),
            ExprTag::Index => self.check_member(node, cx),
            _ => {}
        }
    }
}
