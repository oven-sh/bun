use bun_lint::prelude::*;
use bun_lint::types::utils::{
    get_constrained_type_at_location, get_type_name, is_type_array_type_or_union_of_array_types,
};
use bun_lint::utils::ts_utils::is_static_member_access_of_value;

/// Require `Array#sort` and `Array#toSorted` calls to always provide a `compareFunction`.
pub struct RequireArraySortCompare {
    ignore_string_arrays: bool,
}

const REQUIRE_COMPARE: Message = Message::new("requireCompare", "Require 'compare' argument.");

/// Whether `node` is an array of which all elements are strings.
fn is_string_array_node(node: Expr) -> bool {
    let ty = get_constrained_type_at_location(node);
    (ty.is_array_type() || ty.is_tuple_type())
        && ty.get_type_arguments().iter().all(|arg| {
            get_type_name(arg.get_base_constraint_of_type().unwrap_or(arg)) == b"string"
        })
}

impl RequireArraySortCompare {
    fn check<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = node.kind() else {
            return;
        };
        if !call.args().is_empty() {
            return;
        }
        let callee = call.callee();
        let is_oxlint = cx.language().is_oxlint;
        let Some(obj) = callee.object() else {
            return;
        };
        // `(a?.sort)()` calls a `ChainExpression`.
        let is_sort = !callee.is_chain_root()
            && match is_oxlint {
                true => matches!(callee.file().type_checker().get_accessed_property_name(callee), Some(b"sort" | b"toSorted")),
                false => is_static_member_access_of_value(callee, &["sort", "toSorted"]),
            };
        if !is_sort {
            return;
        }
        if self.ignore_string_arrays && is_string_array_node(obj) {
            return;
        }
        if is_type_array_type_or_union_of_array_types(get_constrained_type_at_location(obj)) {
            cx.report(node, REQUIRE_COMPARE);
        }
    }
}

impl Rule for RequireArraySortCompare {
    const META: Meta = Meta::typescript("require-array-sort-compare", Kind::Problem).requires_types();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    no_state!();

    fn new(options: &Options) -> Self {
        RequireArraySortCompare {
            ignore_string_arrays: options.object(0).bool_or("ignoreStringArrays", true),
        }
    }

    fn expr<'a>(&self, expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.check(expr, cx);
    }
}
