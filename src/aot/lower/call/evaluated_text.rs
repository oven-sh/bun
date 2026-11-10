use bun_sema::hir::{ExprId, ExprKind};

use super::{Arguments, Callee};
use crate::builtins::EvaluatedText;
use crate::ir::{BlockId, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::expression::Tail;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_evaluated_text_call(
        &mut self,
        call: ExprId,
        text: &EvaluatedText,
        exit: Option<BlockId>,
        tail: Tail<'_>,
    ) -> ValueId {
        debug_assert_eq!(text.call, call, "the text belongs to another call");
        let hir = self.file.hir;
        let (ExprKind::Call(site) | ExprKind::New(site)) = hir[call].kind else {
            unreachable!("evaluated text is an argument of a Call or a New expression");
        };
        let site = hir[site];
        let is_construct = matches!(hir[call].kind, ExprKind::New(_));
        let callee = if is_construct {
            let function = self.lower_expression(site.callee);
            Callee::without_key(function, None, self.file.find_callee_name(site.callee))
        } else {
            let mut callee = self.lower_callee(site.callee, exit, None);
            callee.function = self.leave_chain_if_nullish(site, callee.function, exit);
            callee
        };
        let arguments = self.lower_arguments(site.args);
        self.emit_ordinary(call, is_construct, callee, arguments, tail)
    }

    fn emit_ordinary(
        &mut self,
        call: ExprId,
        is_construct: bool,
        callee: Callee,
        arguments: Arguments,
        tail: Tail<'_>,
    ) -> ValueId {
        if is_construct {
            self.emit_new_expression(call, callee, arguments)
        } else {
            self.emit_call_expression(call, callee, arguments, tail)
        }
    }
}
