use bun_sema::hir::{Chain, ExprFlags, ExprId, ExprKind};

use super::{Evaluation, Tail};
use crate::ir::{BlockId, ValueId};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum ShortCircuit {
    Undefined,
    True,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn is_chain_root(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        let chain = match hir[expression].kind {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain,
            ExprKind::Call(call) => hir[call].chain,
            _ => Chain::No,
        };
        match chain {
            Chain::Start | Chain::Continue => true,
            Chain::No => false,
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_chain_base(
        &mut self,
        base: ExprId,
        exit: Option<BlockId>,
    ) -> ValueId {
        let hir = self.file.hir;
        let mut inner = base;
        while let ExprKind::NonNull(operand) = hir[inner].kind {
            if hir.expr_flags(inner).contains(ExprFlags::PARENTHESIZED) {
                break;
            }
            inner = operand;
        }
        match exit {
            Some(exit)
                if self.file.is_chain_root(inner)
                    && !hir.expr_flags(inner).contains(ExprFlags::PARENTHESIZED) =>
            {
                self.lower_expression_in(inner, Evaluation::in_chain(exit, Tail::No))
            }
            Some(_) | None => self.lower_expression(base),
        }
    }

    pub(in crate::lower) fn lower_in_chain(
        &mut self,
        short_circuit: ShortCircuit,
        body: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, BlockId) -> ValueId,
    ) -> ValueId {
        let exit = self.create_block();
        let join = self.create_block();
        let result = self.builder.create_variable(None);
        let value = body(self, exit);
        self.builder.write_variable(result, value);
        self.jump(join);
        self.continue_in(exit);
        let skipped = match short_circuit {
            ShortCircuit::Undefined => self.builder.undefined(),
            ShortCircuit::True => self.builder.boolean(true),
        };
        self.builder.write_variable(result, skipped);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }
}
