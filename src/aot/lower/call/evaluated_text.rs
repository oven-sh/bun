use bun_sema::hir::{Call, Chain, ExprId, ExprKind};
use smallvec::SmallVec;

use super::{Arguments, CallSite, Callee};
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
        let callee = self.lower_site_callee(site, is_construct, exit);
        let arguments = self.lower_arguments(site.args);
        let Some(function) = self.file.evaluated_function(call) else {
            return self.emit_ordinary(call, is_construct, callee, arguments);
        };
        let compiled = self.file.reference_function(FunctionKey::Source(function));

        let position = self.file.last_mapped_position(site.callee);
        self.set_position(position);
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
            EvaluatedTextForm::Script => {
                let no_arguments = Arguments::Values(SmallVec::new());
                super::emit_call(self, closure, None, no_arguments, CallSite::default())
            }
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

    fn lower_site_callee(
        &mut self,
        site: Call,
        is_construct: bool,
        exit: Option<BlockId>,
    ) -> Callee {
        if is_construct {
            return Callee {
                function: self.lower_expression(site.callee),
                this: None,
                key: None,
                name: self.file.find_callee_name(site.callee),
            };
        }
        let mut callee = self.lower_callee(site.callee, exit);
        match site.chain {
            Chain::Start => {
                let exit = exit.expect("an optional call has the exit of its chain");
                callee.function =
                    self.branch_if_expression_nullish(site.callee, callee.function, exit);
            }
            Chain::No | Chain::Continue => {}
        }
        callee
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
