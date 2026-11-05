use bun_sema::hir::{Chain, ExprId, ExprKind};

use super::written_operands::find_locked_builtin;
use crate::builtins::id::BuiltinId;
use crate::ir::ValueId;
use crate::lower::{FileLowering, FunctionLowering};

impl FileLowering<'_, '_, '_, '_> {
    /// `Number.isFinite(operand)` and its like: false for whatever is no number, without a conversion.
    pub(in crate::lower) fn find_number_question(
        &self,
        call: ExprId,
    ) -> Option<(BuiltinId, ExprId)> {
        let hir = self.hir;
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let site = hir[site];
        let question = find_locked_builtin(self, site.callee)?;
        let asks_about_numbers = matches!(
            question,
            BuiltinId::NumberIsFinite
                | BuiltinId::NumberIsInteger
                | BuiltinId::NumberIsSafeInteger
                | BuiltinId::NumberIsNaN
        );
        let operand = self.find_only_argument(site)?;
        (asks_about_numbers && site.chain == Chain::No).then_some((question, operand))
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_operand_of_question(
        &mut self,
        call: ExprId,
        operand: ExprId,
    ) -> ValueId {
        let mut operands = [self.lower_expression(operand)];
        self.convert_arguments(call, &mut operands);
        operands[0]
    }

    pub(in crate::lower) fn emit_number_question(
        &mut self,
        call: ExprId,
        question: BuiltinId,
        number: ValueId,
    ) -> ValueId {
        let answer = self.emit_locked_call(question, None, &[number]);
        self.claim_call_result(call, answer)
    }
}
