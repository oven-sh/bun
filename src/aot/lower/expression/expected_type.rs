#[cfg(test)]
mod tests;

use bun_sema::bind::{Binding, SymbolId};
use bun_sema::hir::{ExprId, ExprKind};

use crate::ir::generated::FunctionFlags;
use crate::ir::{PositionFlags, TypeId, TypeTable, ValueId};
use crate::lower::{FunctionLowering, function, positions, types};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ValueOrigin {
    DerivedByEngine,
    Binding(SymbolId),
    This,
    Unknown,
}

fn classify_origin(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueOrigin {
    match lowering.file.hir[expression].kind {
        ExprKind::Ident(_) => match lowering.file.bound.binding(expression) {
            Binding::Symbol(symbol) => ValueOrigin::Binding(symbol),
            Binding::Arguments(_) => ValueOrigin::DerivedByEngine,
            Binding::CommonJs(_) | Binding::Free => ValueOrigin::Unknown,
        },
        ExprKind::This => match function::is_this_of_module(lowering) {
            true => ValueOrigin::DerivedByEngine,
            false => ValueOrigin::This,
        },
        ExprKind::TaggedTemplate(_)
        | ExprKind::Array(_)
        | ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::Call(_)
        | ExprKind::New(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::As { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. } => ValueOrigin::Unknown,
        ExprKind::Missing
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Template { .. }
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Unary { .. }
        | ExprKind::Binary { .. }
        | ExprKind::Assign { .. }
        | ExprKind::Cond { .. }
        | ExprKind::Spread(_)
        | ExprKind::Satisfies { .. }
        | ExprKind::Instantiation { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => ValueOrigin::DerivedByEngine,
    }
}

fn find_type_of_position(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    origin: ValueOrigin,
) -> TypeId {
    match origin {
        ValueOrigin::Binding(symbol) => positions::binding_position(lowering.file, symbol).ty,
        ValueOrigin::This => {
            let function = lowering.builder.function();
            match function.flags.contains(FunctionFlags::HAS_THIS) {
                true => function.this_type.ty,
                false => TypeTable::ANYTHING,
            }
        }
        ValueOrigin::DerivedByEngine | ValueOrigin::Unknown => TypeTable::ANYTHING,
    }
}

// In a checked file the conversions at the edges carry what the checker says, so only what the uses of a value add to an `any` is left.
pub(super) fn expect_inferred_type(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    value: ValueId,
) -> ValueId {
    let origin = classify_origin(lowering, expression);
    if origin == ValueOrigin::DerivedByEngine {
        return value;
    }
    if let ValueOrigin::Binding(symbol) = origin
        && positions::binding_position(lowering.file, symbol)
            .flags
            .contains(PositionFlags::IS_FROM_COMPILER)
    {
        return value;
    }
    let Ok(inferred) = lowering.file.queries.predicted_expression_type(expression) else {
        return value;
    };
    if lowering.file.is_checked()
        && lowering.file.queries.expression_type(expression) == Ok(inferred)
    {
        return value;
    }
    let position = lowering.file.hir[expression].pos;
    let expected = types::map_type_at(lowering.file, inferred, position).ty;
    let says_nothing = expected == TypeTable::ANYTHING || expected == TypeTable::NEVER;
    if says_nothing || expected == find_type_of_position(lowering, origin) {
        return value;
    }
    lowering.expect_type(value, expected)
}
