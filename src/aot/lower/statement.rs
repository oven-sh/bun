mod declarations;
mod loops;

use bun_sema::hir::{ExprId, ExprKind, IdList, StmtId, StmtKind};

pub(crate) use self::declarations::lower_variable_declaration;
use super::control::{self, BreakTargetKind};
use super::{
    FunctionLowering, commonjs, condition, dispose, exception, expression, generator, iteration,
    module, scope, switch, typescript,
};
use crate::builtins::SourceDialect;
use crate::ir::BlockId;

pub(crate) fn lower_statements(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statements: IdList<StmtId>,
) {
    let hir = lowering.file.hir;
    for index in 0..statements.len {
        let statement = hir.id_at(statements, index as usize);
        if lowering.file.decisions().is_dead_stmt(statement) {
            continue;
        }
        if dispose::find_resource_declarations(hir, statement).is_some() {
            let rest = IdList::new(statements.start + index, statements.len - index);
            dispose::lower_statements_with_resources(lowering, rest);
            return;
        }
        lower_statement(lowering, statement);
    }
}

pub(crate) fn lower_file_statements(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) {
    let hir = lowering.file.hir;
    for statement in hir.ids(hir.body) {
        if module::is_moved_to_file_start(lowering.file, statement)
            && !lowering.file.decisions().is_dead_stmt(statement)
        {
            lower_statement_in_place(lowering, statement);
        }
    }
    lower_statements(lowering, hir.body);
}

pub(crate) fn lower_statement(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) {
    if !module::is_moved_to_file_start(lowering.file, statement) {
        lower_statement_in_place(lowering, statement);
    }
}

fn lower_statement_in_place(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) {
    let left_out = lowering
        .file
        .inputs
        .library_functions
        .left_out_declarations();
    if left_out.is_statement_left_out(lowering.file.file, statement) {
        return;
    }
    if commonjs::is_erased(lowering.file, statement) {
        return;
    }
    let stmt = lowering.file.hir[statement];
    if !lowering.enter_nesting(stmt.start) {
        return;
    }
    lowering.set_position(stmt.start);
    match stmt.kind {
        StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Directive { .. }
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Import(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportAsNamespace(_) => {}
        StmtKind::Expr(expression) => {
            if !commonjs::try_lower_exports_statement(lowering, expression) {
                expression::lower_expression_for_effect(lowering, expression);
            }
        }
        StmtKind::Var(declarations) => {
            for declaration in declarations.iter() {
                lower_variable_declaration(lowering, declaration);
            }
        }
        StmtKind::Fn(function) => {
            declarations::lower_function_statement(lowering, statement, function);
        }
        StmtKind::Class(class) => declarations::lower_class_statement(lowering, statement, class),
        StmtKind::Enum(declaration) => typescript::lower_enum(lowering, declaration),
        StmtKind::Module(declaration) => typescript::lower_namespace(lowering, declaration),
        StmtKind::ImportEquals(declaration) => {
            typescript::lower_import_equals(lowering, declaration);
        }
        StmtKind::ExportAssign(expression) => {
            typescript::lower_export_assignment(lowering, expression);
        }
        StmtKind::ExportDefault(expression) => {
            module::lower_export_default(lowering, statement, expression);
        }
        StmtKind::Return(expression) => lower_return(lowering, expression),
        StmtKind::If { test, yes, no } => lower_if(lowering, test, yes, no),
        StmtKind::For { .. } => loops::lower_for(lowering, statement),
        StmtKind::While { .. } => loops::lower_while(lowering, statement),
        StmtKind::DoWhile { .. } => loops::lower_do_while(lowering, statement),
        StmtKind::ForIn { .. } => iteration::lower_for_in(lowering, statement),
        StmtKind::ForOf { .. } => iteration::lower_for_of(lowering, statement),
        StmtKind::Switch { .. } => switch::lower_switch(lowering, statement),
        StmtKind::Try { .. } => exception::lower_try(lowering, statement),
        StmtKind::Throw(_) => exception::lower_throw(lowering, statement),
        StmtKind::Break(_) => control::lower_break(lowering, statement),
        StmtKind::Continue(_) => control::lower_continue(lowering, statement),
        StmtKind::Block(statements) => lower_block(lowering, statement, statements),
        StmtKind::Labeled { body, .. } => lower_labeled(lowering, statement, body),
        StmtKind::With { object, body } => lower_with(lowering, statement, object, body),
    }
    lowering.leave_nesting();
}

fn lower_block(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    statements: IdList<StmtId>,
) {
    let scope = lowering.file.bound.own_scope(statement);
    if scope.is_none() {
        lower_statements(lowering, statements);
        return;
    }
    scope::enter_scope(lowering, scope);
    lower_statements(lowering, statements);
    scope::leave_scope(lowering, scope);
}

fn lower_return(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, expression: ExprId) {
    if expression.is_none() {
        control::emit_empty_return(lowering);
        return;
    }
    // Nobody gets what the body of a module returns.
    if commonjs::drops_returned_value(lowering) {
        expression::lower_expression_for_effect(lowering, expression);
        control::emit_empty_return(lowering);
        return;
    }
    let value = expression::lower_tail_expression(lowering, expression);
    let value = generator::prepare_return_value(lowering, value);
    control::emit_return(lowering, value, Some(expression));
}

fn lower_if(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    test: ExprId,
    yes: StmtId,
    no: StmtId,
) {
    let decisions = lowering.file.decisions();
    let has_live_else = no.is_some() && !decisions.is_dead_stmt(no);
    if decisions.is_dead_stmt(yes) {
        expression::lower_expression_for_effect(lowering, test);
        if has_live_else {
            lower_statement(lowering, no);
        }
        return;
    }
    if no.is_some() && !has_live_else {
        expression::lower_expression_for_effect(lowering, test);
        lower_statement(lowering, yes);
        return;
    }

    let then_block = create_block_of_arm(lowering, yes);
    let after = lowering.create_block();
    if no.is_none() {
        condition::lower_condition(lowering, test, then_block, after);
        lower_if_arm(lowering, then_block, yes, after);
    } else {
        let else_block = create_block_of_arm(lowering, no);
        condition::lower_condition(lowering, test, then_block, else_block);
        lower_if_arm(lowering, then_block, yes, after);
        lower_if_arm(lowering, else_block, no, after);
    }
    lowering.continue_in(after);
}

fn create_block_of_arm(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    arm: StmtId,
) -> BlockId {
    if is_marked_unlikely(lowering, arm) {
        lowering.create_unlikely_block()
    } else {
        lowering.create_block()
    }
}

fn is_marked_unlikely(lowering: &FunctionLowering<'_, '_, '_, '_, '_>, arm: StmtId) -> bool {
    if lowering.file.source.dialect() != SourceDialect::Runtime {
        return false;
    }
    let hir = lowering.file.hir;
    let StmtKind::Block(statements) = hir[arm].kind else {
        return false;
    };
    if statements.len == 0 {
        return false;
    }
    let (StmtKind::Expr(first) | StmtKind::Directive { expr: first, .. }) =
        hir[hir.id_at(statements, 0)].kind
    else {
        return false;
    };
    let ExprKind::String(text) = hir[first].kind else {
        return false;
    };
    lowering.file.queries.atom_bytes(text) == b"unlikely"
}

fn lower_if_arm(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    block: BlockId,
    statement: StmtId,
    after: BlockId,
) {
    lowering.continue_in(block);
    lower_statement(lowering, statement);
    lowering.jump(after);
}

fn lower_labeled(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    body: StmtId,
) {
    let after = lowering.create_block();
    control::push_break_target(lowering, statement, BreakTargetKind::Label, after);
    lower_statement(lowering, body);
    control::pop_jump_target(lowering);
    lowering.jump(after);
    lowering.continue_in(after);
}

fn lower_with(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    object: ExprId,
    body: StmtId,
) {
    let value = expression::lower_expression(lowering, object);
    let object = lowering.builder.to_object(value, None);
    let scope = lowering.file.bound.own_scope(statement);
    scope::enter_with_scope(lowering, scope, object);
    lower_statement(lowering, body);
    scope::leave_scope(lowering, scope);
}
