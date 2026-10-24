#[cfg(test)]
mod tests;

use bun_sema::bind::{Binding, SymbolId};
use bun_sema::hir::{ExprId, ExprKind};

use crate::ir::generated::FunctionFlags;
use crate::ir::{PositionFlags, TypeId, TypeTable, ValueId};
use crate::lower::FunctionLowering;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ValueOrigin {
    DerivedByEngine,
    Binding(SymbolId),
    This,
    Unknown,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn classify_origin(&self, expression: ExprId) -> ValueOrigin {
        match self.file.hir[expression].kind {
            ExprKind::Ident(_) => match self.file.bound.binding(expression) {
                Binding::Symbol(symbol) => ValueOrigin::Binding(symbol),
                Binding::Arguments(_) => ValueOrigin::DerivedByEngine,
                Binding::CommonJs(_) | Binding::Free => ValueOrigin::Unknown,
            },
            ExprKind::This => match self.is_this_of_module() {
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
            _ => ValueOrigin::DerivedByEngine,
        }
    }

    fn find_type_of_position(&mut self, origin: ValueOrigin) -> TypeId {
        match origin {
            ValueOrigin::Binding(symbol) => self.file.binding_position(symbol).ty,
            ValueOrigin::This => {
                let function = self.builder.function();
                match function.flags.contains(FunctionFlags::HAS_THIS) {
                    true => function.this_type.ty,
                    false => TypeTable::ANYTHING,
                }
            }
            ValueOrigin::DerivedByEngine | ValueOrigin::Unknown => TypeTable::ANYTHING,
        }
    }

    // In a checked file the conversions at the edges carry what the checker says, so only what the uses of a value add to an `any` is left.
    pub(super) fn expect_inferred_type(&mut self, expression: ExprId, value: ValueId) -> ValueId {
        let origin = self.classify_origin(expression);
        if origin == ValueOrigin::DerivedByEngine {
            return value;
        }
        if let ValueOrigin::Binding(symbol) = origin
            && self
                .file
                .binding_position(symbol)
                .flags
                .contains(PositionFlags::IS_FROM_COMPILER)
        {
            return value;
        }
        let Ok(inferred) = self.file.queries.predicted_expression_type(expression) else {
            return value;
        };
        if self.file.is_checked() && self.file.queries.expression_type(expression) == Ok(inferred) {
            return value;
        }
        let position = self.file.hir[expression].pos;
        let expected = self.file.map_type_at(inferred, position).ty;
        let says_nothing = expected == TypeTable::ANYTHING || expected == TypeTable::NEVER;
        if says_nothing || expected == self.find_type_of_position(origin) {
            return value;
        }
        self.expect_type(value, expected)
    }
}
