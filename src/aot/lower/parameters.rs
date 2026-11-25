mod arguments;
mod binding;

pub(in crate::lower) use binding::parameter_symbols;

use bun_sema::atom::known;
use bun_sema::bind::{Binding, Bound, CodeUnit, FunctionFlags};
use bun_sema::hir::{self, Call, Chain, ExprId, ExprKind, Flags, FnId, NodeData};

pub(in crate::lower) fn find_function_whose_arguments_are_counted(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    access: ExprId,
) -> Option<FnId> {
    let ExprKind::Dot {
        obj,
        name,
        chain: Chain::No,
        ..
    } = hir[access].kind
    else {
        return None;
    };
    let object = hir.skip_type_assertions(obj);
    if name != known::length || !matches!(hir[object].kind, ExprKind::Ident(_)) {
        return None;
    }
    let Binding::Arguments(CodeUnit::Function(function)) = bound.binding(object) else {
        return None;
    };
    let other_ways = FunctionFlags::HANDS_ARGUMENTS_ON
        | FunctionFlags::HAS_DIRECT_EVAL
        | FunctionFlags::HAS_ARGUMENTS_VARIABLE;
    let is_counted = !bound.function_flags(function).intersects(other_ways)
        && !hir[function]
            .flags
            .intersects(Flags::ASYNC | Flags::GENERATOR)
        && bound.dynamic_lookup_scope(NodeData::Expr(object)).is_none();
    is_counted.then_some(function)
}

pub(in crate::lower) fn literal_argument_position(hir: &hir::File<'_>, call: &Call) -> Option<u32> {
    let mut arguments = hir.ids(call.args);
    let (Some(argument), None) = (arguments.next(), arguments.next()) else {
        return None;
    };
    let ExprKind::Number(number) = hir[argument].kind else {
        return None;
    };
    let value = hir.numbers[number as usize];
    let position = value as u32;
    (f64::from(position) == value).then_some(position)
}
