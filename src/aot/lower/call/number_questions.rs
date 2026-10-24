use bun_sema::hir::{Chain, ExprId, ExprKind};
use smallvec::SmallVec;

use super::written_operands::find_locked_builtin;
use super::{Arguments, CallSite, emit_call};
use crate::builtins::id::BuiltinId;
use crate::ir::ValueId;
use crate::lower::expression::{self, lower_expression};
use crate::lower::{FileLowering, FunctionLowering, convert};

/// `Number.isFinite(operand)` and its like: false for whatever is no number, without a conversion.
pub(in crate::lower) fn find_number_question(
    file: &FileLowering<'_, '_, '_, '_>,
    call: ExprId,
) -> Option<(BuiltinId, ExprId)> {
    let hir = file.hir;
    let ExprKind::Call(site) = hir[call].kind else {
        return None;
    };
    let site = hir[site];
    let question = find_locked_builtin(file, site.callee)?;
    let asks_about_numbers = matches!(
        question,
        BuiltinId::NumberIsFinite
            | BuiltinId::NumberIsInteger
            | BuiltinId::NumberIsSafeInteger
            | BuiltinId::NumberIsNaN
    );
    let mut arguments = hir.ids(site.args);
    let (Some(operand), None) = (arguments.next(), arguments.next()) else {
        return None;
    };
    let is_plain = site.chain == Chain::No && !matches!(hir[operand].kind, ExprKind::Spread(_));
    (asks_about_numbers && is_plain).then_some((question, operand))
}

pub(in crate::lower) fn lower_operand_of_question(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    operand: ExprId,
) -> ValueId {
    let mut operands = [lower_expression(lowering, operand)];
    convert::convert_arguments(lowering, call, &mut operands);
    operands[0]
}

pub(in crate::lower) fn emit_number_question(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
    question: BuiltinId,
    number: ValueId,
) -> ValueId {
    let function = expression::emit_locked_builtin(lowering, question);
    let arguments = Arguments::Values(SmallVec::from_slice(&[number]));
    let answer = emit_call(lowering, function, None, arguments, CallSite::default());
    convert::claim_call_result(lowering, call, answer)
}
