use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::types::tsutils::{intersection_constituents, union_constituents};
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::utils::ts_utils::is_static_member_access_of_value;

/// Enforce using type parameter when calling `Array#reduce` instead of using a type assertion.
pub struct PreferReduceTypeParameter;

const PREFER_TYPE_PARAMETER: Message = Message::new(
    "preferTypeParameter",
    "Unnecessary assertion: Array#reduce accepts a type parameter for the default value.",
);

fn is_array_type(ty: Type) -> bool {
    union_constituents(ty).iter().all(|union_part| {
        intersection_constituents(union_part).iter().all(|t| t.is_array_type() || t.is_tuple_type())
    })
}

impl Rule for PreferReduceTypeParameter {
    const META: Meta = Meta::typescript("prefer-reduce-type-parameter", Kind::Problem)
        .fixable(Fixable::Code)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferReduceTypeParameter
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = node.kind() else {
            return;
        };
        let Some(second_arg) = call.args().get(1) else {
            return;
        };
        // `asserted_type` is `None` for `const`, which stands for the type of the expression.
        let (expression, type_annotation, asserted_type) = match second_arg.kind() {
            ExprKind::As { expr, ty } => (expr, ty.span(), Some(ty)),
            ExprKind::AsConst(expr) => match second_arg.const_keyword_span() {
                Some(keyword) => (expr, keyword, None),
                None => return,
            },
            _ => return,
        };
        let callee = call.callee();
        // ESLint has a `ChainExpression` around the callee of `(a?.reduce)()`.
        if callee.is_chain_root() {
            return;
        }
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = callee.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let is_reduce = match is_oxlint {
            // tsgolint asks the checker's `getAccessedPropertyName`.
            true => {
                // Not `(a?.reduce)(f, x)`, where the parentheses end the chain.
                !callee.is_chain_root()
                    && matches!(callee.file().type_checker().get_accessed_property_name(callee), Some(b"reduce"))
            }
            false => is_static_member_access_of_value(callee, &["reduce"]),
        };
        if !is_reduce {
            return;
        }
        // The fix would be a type error.
        let is_assertion_necessary =
            asserted_type.is_some_and(|asserted| !expression.ty().is_assignable_to(asserted.ty()));
        if is_assertion_necessary || !is_array_type(get_constrained_type_at_location(obj)) {
            return;
        }
        cx.report(second_arg, PREFER_TYPE_PARAMETER).fix(|fixer| {
            let file = fixer.file();
            let outer = second_arg.span();
            let (mut fixes, type_annotation) = if is_oxlint {
                // tsgolint makes `reduce<const>(..)`, which does not parse.
                let Some(asserted) = asserted_type else {
                    return Vec::new();
                };
                // For tsgolint a node begins where the token before it ends, and parentheses are nodes:
                // it removes `<T>` from the end of the token before it, or from the operand to the end of `as T`.
                let inner = expression.outer_span();
                let mut type_annotation = asserted.outer_span();
                type_annotation.start = file.end_of_token_before(type_annotation.start);
                let assertion = match second_arg.is_angle_bracket_assertion() {
                    true => {
                        let greater_than_end = file.end_of_token_before(inner.start);
                        Span::new(file.end_of_token_before(outer.start), greater_than_end)
                    }
                    false => Span::new(inner.end, type_annotation.end),
                };
                (vec![fixer.remove(assertion)], type_annotation)
            } else {
                let inner = expression.span();
                let fixes = vec![
                    fixer.remove(Span::new(outer.start, inner.start)),
                    fixer.remove(Span::new(inner.end, outer.end)),
                ];
                (fixes, type_annotation)
            };
            if call.type_args().is_empty() {
                let type_argument = [&b"<"[..], file.slice(type_annotation), b">"].concat();
                fixes.push(fixer.insert_after(callee, type_argument));
            }
            fixes
        });
    }
}
