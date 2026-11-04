#[cfg(test)]
mod tests;

use bun_sema::bind::Binding;
use bun_sema::hir::{ExprId, ExprKind};

use crate::ir::generated::FunctionFlags;
use crate::ir::{PositionFlags, TypeTable, ValueId};
use crate::lower::FunctionLowering;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // In a checked file the conversions at the edges carry what the checker says, so only what the uses of a value add to an `any` is left.
    pub(super) fn expect_inferred_type(&mut self, expression: ExprId, value: ValueId) -> ValueId {
        let type_of_position = match self.file.hir[expression].kind {
            ExprKind::Ident(_) => match self.file.bound.binding(expression) {
                Binding::Symbol(symbol) => {
                    let position = self.file.binding_position(symbol);
                    if position.flags.contains(PositionFlags::IS_FROM_COMPILER) {
                        return value;
                    }
                    position.ty
                }
                Binding::Arguments(_) => return value,
                Binding::CommonJs(_) | Binding::Free => TypeTable::ANYTHING,
            },
            ExprKind::This if self.is_this_of_module() => return value,
            ExprKind::This => {
                let function = self.builder.function();
                match function.flags.contains(FunctionFlags::HAS_THIS) {
                    true => function.this_type.ty,
                    false => TypeTable::ANYTHING,
                }
            }
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
            | ExprKind::ImportCall { .. } => TypeTable::ANYTHING,
            // The engine derives the type of every other expression by itself.
            _ => return value,
        };
        let Ok(inferred) = self.file.queries.predicted_expression_type(expression) else {
            return value;
        };
        if self.file.is_checked() && self.file.queries.expression_type(expression) == Ok(inferred) {
            return value;
        }
        let position = self.file.hir[expression].pos;
        let expected = self.file.map_type_at(inferred, position).ty;
        let says_nothing = expected == TypeTable::ANYTHING || expected == TypeTable::NEVER;
        if says_nothing || expected == type_of_position {
            return value;
        }
        self.expect_type(value, expected)
    }
}
