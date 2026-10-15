use bun_lint::prelude::*;
use bun_lint::types::tsutils::{is_type_flag_set, is_union_type, union_constituents};
use bun_lint::types::{SyntaxKind, Type, TypeFlags};
use bun_lint::utils::ts_utils::{OperatorPrecedence, get_operator_precedence, ts_syntax_kind};

/// Enforce non-null assertions over explicit type assertions.
pub struct NonNullableTypeAssertionStyle;

const PREFER_NON_NULL_ASSERTION: Message = Message::new(
    "preferNonNullAssertion",
    "Use a ! assertion to more succinctly remove null and undefined from the type.",
);

const NULLISH: TypeFlags = TypeFlags::NULL.union(TypeFlags::UNDEFINED);

fn is_loose(ty: Type) -> bool {
    is_type_flag_set(ty, TypeFlags::ANY | TypeFlags::UNKNOWN)
}

fn could_be_nullish(ty: Type) -> bool {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return true;
    }
    if is_type_flag_set(ty, TypeFlags::TYPE_PARAMETER) {
        return ty.get_constraint().is_none_or(could_be_nullish);
    }
    if is_union_type(ty) {
        return ty.types().iter().any(could_be_nullish);
    }
    is_type_flag_set(ty, NULLISH)
}

fn same_type_without_nullish<'a>(asserted: Type<'a>, original: Type<'a>) -> bool {
    let (asserted_types, original_types) = (union_constituents(asserted), union_constituents(original));
    let non_nullish_original_types = || original_types.iter().filter(|&ty| !is_type_flag_set(ty, NULLISH));
    if non_nullish_original_types().count() == original_types.len() {
        return false;
    }
    asserted_types.iter().all(|asserted_type| {
        !could_be_nullish(asserted_type) && non_nullish_original_types().any(|ty| ty == asserted_type)
    }) && non_nullish_original_types().all(|original_type| asserted_types.contains(original_type))
}

impl Rule for NonNullableTypeAssertionStyle {
    const META: Meta = Meta::typescript("non-nullable-type-assertion-style", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().exprs(&[ExprTag::As]);
    no_state!();

    fn new(_: &Options) -> Self {
        NonNullableTypeAssertionStyle
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::As { expr, ty } = node.kind() else {
            return;
        };
        let original = expr.ty();
        if is_loose(original) {
            return;
        }
        let asserted = ty.ty();
        if is_loose(asserted) {
            return;
        }
        if !same_type_without_nullish(asserted, original) {
            return;
        }
        cx.report(node, PREFER_NON_NULL_ASSERTION).fix(|fixer| {
            let precedence = get_operator_precedence(ts_syntax_kind(expr), SyntaxKind::Unknown, false);
            // tsgolint 7.0 leaves the parentheses of `(a) as B`, and the `<B>` of `<B>a`: it only changes what follows the operand.
            if fixer.file().language().is_oxlint {
                let file = fixer.file();
                let outer = expr.outer_span();
                let end = node.span().end.max(outer.end);
                // `a as B===c` is not to become `a!===c`, which is `a !== =c`.
                let next = end;
                let after: &[u8] = match file.slice(Span::new(next, next.saturating_add(1))) == b"=" {
                    true => b"! ",
                    false => b"!",
                };
                if expr.is_parenthesized() || precedence > OperatorPrecedence::Unary {
                    return fixer.replace(Span::new(outer.end, end), after);
                }
                return fixer.replace(Span::new(outer.start, end), [&b"("[..], file.slice(outer), b")", after].concat());
            }
            let text = match precedence > OperatorPrecedence::Unary {
                true => [expr.text(), b"!"].concat(),
                false => [&b"("[..], expr.text(), b")!"].concat(),
            };
            fixer.replace(node, text)
        });
    }
}
