use bun_sema::hir::{FnBody, FnId};

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
        lowering.emit_fast_path(source);
        lowering.lower_function_body(source);
        lowering.leave_scope(top);
        lowering.finish();
    }

    // Nothing that the build sees names the function.
    pub(crate) fn lower_left_out_function(&mut self, function: FunctionId) {
        let name = self.function_header(function).name;
        let kind = match self.source.dialect() {
            SourceDialect::Program => RuntimeErrorKind::LeftOutOfExecutable,
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
                self.lower_statements(statements);
                self.emit_empty_return();
            }
            FnBody::Expr(expression) => {
                let value = self.lower_tail_expression(expression);
                self.emit_return(value, Some(expression));
            }
            FnBody::None => {}
        }
    }
}
