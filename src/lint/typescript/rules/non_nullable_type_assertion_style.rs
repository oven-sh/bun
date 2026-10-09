use bun_lint::prelude::*;
use bun_lint::types::tsutils::{is_type_flag_set, is_union_type, union_constituents};
use bun_lint::types::{SyntaxKind, Type, TypeFlags};
use bun_lint::utils::ts_utils::{OperatorPrecedence, get_operator_precedence, ts_syntax_kind};
use rustc_hash::{FxHashMap, FxHashSet};

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

fn could_be_nullish(ty: Type, depth: u32) -> bool {
    if depth > 100 {
        return true;
    }
    if is_type_flag_set(ty, TypeFlags::TYPE_PARAMETER) {
        return ty.get_constraint().is_none_or(|constraint| could_be_nullish(constraint, depth + 1));
    }
    if is_union_type(ty) {
        return ty.types().iter().any(|part| could_be_nullish(part, depth + 1));
    }
    is_type_flag_set(ty, NULLISH)
}

fn same_type_without_nullish<'a>(asserted: Type<'a>, original: Type<'a>) -> bool {
    let (asserted_types, original_types) = (union_constituents(asserted), union_constituents(original));
    let non_nullish_original_types = || original_types.iter().filter(|&ty| !is_type_flag_set(ty, NULLISH));
    if non_nullish_original_types().count() == original_types.len() {
        return false;
    }
    if asserted_types.len() <= 16 || original_types.len() <= 16 {
        return asserted_types.iter().all(|asserted_type| {
            !could_be_nullish(asserted_type, 0) && non_nullish_original_types().any(|ty| ty == asserted_type)
        }) && non_nullish_original_types().all(|original_type| asserted_types.contains(original_type));
    }
    let non_nullish_originals: FxHashSet<Type<'a>> = non_nullish_original_types().collect();
    let asserted_set: FxHashSet<Type<'a>> = asserted_types.iter().collect();
    asserted_types
        .iter()
        .all(|asserted_type| !could_be_nullish(asserted_type, 0) && non_nullish_originals.contains(&asserted_type))
        && non_nullish_originals.iter().all(|original_type| asserted_set.contains(original_type))
}

impl Rule for NonNullableTypeAssertionStyle {
    const META: Meta = Meta::typescript("non-nullable-type-assertion-style", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    /// [`same_type_without_nullish`] of an asserted and an original type: all their constituents are gone through, and
    /// many assertions are about the same types.
    type State<'a> = FxHashMap<(Type<'a>, Type<'a>), bool>;

    fn new(_: &Options) -> Self {
        NonNullableTypeAssertionStyle
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> FxHashMap<(Type<'a>, Type<'a>), bool> {
        on.exprs([ExprTag::As], |_, node, cx| {
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
            let is_same = || same_type_without_nullish(asserted, original);
            if !*cx.state.entry((asserted, original)).or_insert_with(is_same) {
                return;
            }
            cx.report(node, PREFER_NON_NULL_ASSERTION).fix(|fixer| {
                let precedence = get_operator_precedence(ts_syntax_kind(expr), SyntaxKind::Unknown, false);
                let text = match precedence > OperatorPrecedence::Unary {
                    true => [expr.text(), b"!"].concat(),
                    false => [&b"("[..], expr.text(), b")!"].concat(),
                };
                fixer.replace(node, text)
            });
        });
        FxHashMap::default()
    }
}
