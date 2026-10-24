use bun_sema::hir::{ExprId, ExprKind};

use super::{Arguments, Callee};
use crate::builtins::{EvaluatedText, EvaluatedTextForm};
use crate::ir::{BlockId, Edge, FunctionKey, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::expression::Tail;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_evaluated_text_call(
        &mut self,
        call: ExprId,
        text: &EvaluatedText,
        exit: Option<BlockId>,
    ) -> ValueId {
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
        let Some(function) = self.file.evaluated_function(call) else {
            return self.emit_ordinary(call, is_construct, callee, arguments);
        };
        let compiled = self.file.reference_function(FunctionKey::Source(function));

        self.set_position(self.file.last_mapped_position(site.callee));
        let expected = self.emit_locked_builtin(text.callee.id);
        let test = self.builder.strict_eq(callee.function, expected);
        let matches = self.create_block();
        let differs = self.create_block();
        let join = self.create_block();
        let result = self.builder.create_variable(None);
        let other_callee = Callee {
            function: self.builder.add_edge_result(differs),
            key: None,
            ..callee
        };
        let differs_edge = Edge::with_proofs(differs, &[0]);
        self.builder.branch(test, Edge::to(matches), differs_edge);

        self.continue_in(matches);
        let closure = self.builder.new_closure(compiled, &[]);
        let evaluated = match text.form {
            EvaluatedTextForm::FunctionBody => closure,
            EvaluatedTextForm::Script => super::emit_call(self, closure, None, &[]),
        };
        self.builder.write_variable(result, evaluated);
        self.jump(join);

        self.continue_in(differs);
        let ordinary = self.emit_ordinary(call, is_construct, other_callee, arguments);
        self.builder.write_variable(result, ordinary);
        self.jump(join);

        self.continue_in(join);
        self.builder.read_variable(result)
    }

    fn emit_ordinary(
        &mut self,
        call: ExprId,
        is_construct: bool,
        callee: Callee,
        arguments: Arguments,
    ) -> ValueId {
        if is_construct {
            self.emit_new_expression(call, callee, arguments)
        } else {
            self.emit_call_expression(call, callee, arguments, Tail::No)
        }
    }
}
