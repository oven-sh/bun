use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::types::tsutils::{
    intersection_constituents, is_intrinsic_null_type, is_intrinsic_undefined_type,
    union_constituents,
};
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::utils::eslint_utils::{StaticValue, get_static_value};
use bun_lint::utils::ts_utils::is_static_member_access_of_value;
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
                // ESLint has a `ChainExpression` around the callee of `(a?.filter)()`.
                if callee.is_chain_root() {
                    return false;
                }
                let (object, filter_node, is_bracket_syntax_for_filter) = match callee.kind() {
                    ExprKind::Dot { obj, name, .. } => (obj, name.span(), false),
                    ExprKind::Index { obj, index, .. } => (obj, index.span(), true),
                    _ => return false,
                };
                if !is_static_member_access_of_value(callee, &["filter"])
                    || !is_arrayish(get_constrained_type_at_location(object))
                {
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

impl PreferFind {
    /// `whole`: `object[0]`, `object.at(0)`
    fn report<'a>(
        cx: &Cx<'a, Self>,
        whole: Expr<'a>,
        object: Expr<'a>,
        filter_expressions: &FilterExpressions,
    ) {
        cx.report(whole, PREFER_FIND).suggest(PREFER_FIND_SUGGESTION, |fixer| {
            // The `.` of `(..).at(0)`, the `[` of `(..)[0]` or `(..)["at"](0)`.
            let token_to_start_deleting_from =
                fixer.file().tokens_after(object).find(|token| token.is(".") || token.is("["))?;
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
        if callee.is_optional()
            || callee.is_chain_root()
            || !is_static_member_access_of_value(callee, &["at"])
        {
            return;
        }
        let mut filter_expressions = FilterExpressions::new();
        if !parse_array_filter_expressions(object, &mut filter_expressions) {
            return;
        }
        let at_argument = get_static_value(argument, Some(cx.file().scope()));
        if at_argument.as_ref().is_some_and(is_treated_as_zero_by_array_at) {
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
        let property = get_static_value(index, Some(cx.file().scope()));
        if property.as_ref().is_some_and(is_treated_as_zero_by_member_access) {
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
