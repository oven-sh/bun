use bun_sema::hir::{ExprId, ExprKind, FnBody, FnId};

use crate::builtins::SourceDialect;
use crate::ir::FunctionId;
use crate::ir::generated::RuntimeErrorKind;
use crate::lower::module::{self, LibraryFunctionForm};
use crate::lower::{FileLowering, FunctionLowering};

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn lower_source_function(&mut self, function: FunctionId, source: FnId) {
        let returned = self.function_positions(source).returned;
        let top = self.bound.fns[source.idx()].scope;
        let mut lowering = FunctionLowering::begin(self, function);
        lowering.returned = returned;
        lowering.count_function(source);
        match module::library_function_form(lowering.file, source) {
            Some(LibraryFunctionForm::NakedConstructor) => {
                let new_target = lowering.builder.new_target();
                let new_target = new_target.expect("a constructor takes new.target");
                lowering.scopes.entry_this = Some(new_target);
            }
            Some(LibraryFunctionForm::Method | LibraryFunctionForm::Constructor) | None => {}
        }
        lowering.lower_parameters(source);
        lowering.emit_coroutine_start();
        lowering.count_generator_body(source);
        lowering.emit_fast_path(source);
        lowering.begin_self_tail_loop(source);
        lowering.lower_function_body(source);
        lowering.end_self_tail_loop();
        lowering.leave_scope(top);
        lowering.finish();
    }

    pub(crate) fn lower_left_out_function(&mut self, function: FunctionId) {
        let name = self.function_header(function).name;
        let kind = match self.source.dialect() {
            SourceDialect::Program => RuntimeErrorKind::OmittedFromExecutable,
            SourceDialect::Runtime => RuntimeErrorKind::FunctionNotCompiled,
        };
        let mut lowering = FunctionLowering::begin(self, function);
        let error = lowering.builder.new_runtime_error(kind, name);
        lowering.builder.throw(error);
        lowering.finish();
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_function_body(&mut self, source: FnId) {
        match self.file.hir[source].body {
            FnBody::Block(statements) => {
                self.give_list_to_scope(self.file.bound.fns[source.idx()].scope, statements);
                self.lower_statements(statements);
                self.emit_empty_return();
            }
            FnBody::Expr(expression) => {
                let value = match self.is_body_of_evaluation(source, expression) {
                    true => self.lower_expression(expression),
                    false => self.lower_tail_expression(expression),
                };
                self.emit_return(value, Some(expression));
            }
            FnBody::None => {}
        }
    }

    /// The loader writes an arrow function around the text of a direct eval. Nothing in a text is in a tail position.
    fn is_body_of_evaluation(&self, source: FnId, body: ExprId) -> bool {
        let hir = self.file.hir;
        let known = &hir.known_evaluations;
        let after = known.partition_point(|it| it.first_expression.0 <= body.0);
        after.checked_sub(1).is_some_and(|it| {
            let root = hir.skip_type_assertions(known[it].function);
            known[it].is_called() && matches!(hir[root].kind, ExprKind::Fn(it) if it == source)
        })
    }
}
