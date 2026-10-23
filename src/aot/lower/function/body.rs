use bun_sema::hir::{FnBody, FnId};

use crate::builtins::SourceDialect;
use crate::ir::FunctionId;
use crate::ir::generated::RuntimeErrorKind;
use crate::lower::module::{self, LibraryFunctionForm};
use crate::lower::{
    FileLowering, FunctionLowering, control, expression, generator, known_function, parameters,
    positions, scope, statement,
};

pub(crate) fn lower_source_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    source: FnId,
) {
    let returned = positions::function_positions(file, source).returned;
    let top = file.bound.fns[source.idx()].scope;
    let mut lowering = FunctionLowering::begin(file, function);
    lowering.returned = returned;
    bind_naked_constructor_this(&mut lowering, source);
    parameters::lower_parameters(&mut lowering, source);
    generator::emit_coroutine_start(&mut lowering);
    known_function::emit_fast_path(&mut lowering, source);
    lower_function_body(&mut lowering, source);
    scope::leave_scope(&mut lowering, top);
    lowering.finish();
}

// Nothing that the build sees names the function.
pub(crate) fn lower_left_out_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
) {
    let name = file.function_header(function).name;
    let kind = match file.source.dialect() {
        SourceDialect::Program => RuntimeErrorKind::LeftOutOfExecutable,
        SourceDialect::Runtime => RuntimeErrorKind::FunctionNotCompiled,
    };
    let mut lowering = FunctionLowering::begin(file, function);
    let error = lowering.builder.new_runtime_error(kind, name);
    lowering.builder.throw(error);
    lowering.finish();
}

fn bind_naked_constructor_this(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, source: FnId) {
    match module::library_function_form(lowering.file, source) {
        Some(LibraryFunctionForm::NakedConstructor) => {
            let new_target = lowering.builder.new_target();
            let new_target = new_target.expect("a constructor takes new.target");
            lowering.scopes.set_entry_this(new_target);
        }
        Some(LibraryFunctionForm::Method | LibraryFunctionForm::Constructor) | None => {}
    }
}

pub(crate) fn lower_function_body(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    source: FnId,
) {
    match lowering.file.hir[source].body {
        FnBody::Block(statements) => {
            statement::lower_statements(lowering, statements);
            control::emit_empty_return(lowering);
        }
        FnBody::Expr(expression) => {
            let value = expression::lower_tail_expression(lowering, expression);
            control::emit_return(lowering, value, Some(expression));
        }
        FnBody::None => {}
    }
}
