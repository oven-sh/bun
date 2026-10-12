use bun_lint::prelude::*;
use bun_lint::types::utils::get_constrained_type_at_location;
use bun_lint::types::{Type, TypeFlags};
use bun_lint::utils::ts_utils::get_for_statement_head_loc;

/// Disallow iterating over an array with a for-in loop.
pub struct NoForInArray;

const FOR_IN_VIOLATION: Message = Message::new(
    "forInViolation",
    "For-in loops over arrays skips holes, returns indices as strings, and may visit the prototype chain or other enumerable properties. Use a more robust iteration method such as for-of or array.forEach instead.",
);

fn has_arrayish_length(ty: Type) -> bool {
    ty.get_property(b"length")
        .is_some_and(|length_property| length_property.get_type().has_flags(TypeFlags::NUMBER_LIKE))
}

fn is_array_like(ty: Type) -> bool {
    if ty.is_union_or_intersection() {
        return ty.types().iter().any(is_array_like);
    }
    ty.get_number_index_type().is_some() && has_arrayish_length(ty)
}

impl Rule for NoForInArray {
    const META: Meta = Meta::typescript("no-for-in-array", Kind::Problem)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().stmts(&[StmtTag::ForIn]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoForInArray
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::ForIn { expr: right, .. } = node.kind() else {
            return;
        };
        if is_array_like(get_constrained_type_at_location(right)) {
            cx.report(get_for_statement_head_loc(node), FOR_IN_VIOLATION);
        }
    }
}
