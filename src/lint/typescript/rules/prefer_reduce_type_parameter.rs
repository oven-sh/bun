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

impl PreferReduceTypeParameter {
    fn check<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
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
        let is_reduce = match callee.kind() {
            // tsgolint goes by the type of a name in the brackets, not by what it is initialized with.
            ExprKind::Index { index, .. } if index.tag() == ExprTag::Ident && cx.language().is_oxlint => {
                index.ty().string_value() == Some(&b"reduce"[..])
            }
            _ => is_static_member_access_of_value(callee, &["reduce"]),
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
            let (mut outer, inner) = (second_arg.span(), expression.span());
            let mut type_annotation = type_annotation;
            // For tsgolint a node begins where the token before it ends.
            let file = fixer.file();
            if file.language().is_oxlint {
                type_annotation.start = file.end_of_token_before(type_annotation.start);
                if outer.start < inner.start {
                    outer.start = file.end_of_token_before(outer.start);
                }
            }
            let mut fixes = vec![
                fixer.remove(Span::new(outer.start, inner.start)),
                fixer.remove(Span::new(inner.end, outer.end)),
            ];
            if call.type_args().is_empty() {
                let type_argument = [&b"<"[..], fixer.file().slice(type_annotation), b">"].concat();
                fixes.push(fixer.insert_after(callee, type_argument));
            }
            fixes
        });
    }
}

impl Rule for PreferReduceTypeParameter {
    const META: Meta = Meta::typescript("prefer-reduce-type-parameter", Kind::Problem)
        .fixable(Fixable::Code)
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferReduceTypeParameter
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Call], Self::check);
    }
}
