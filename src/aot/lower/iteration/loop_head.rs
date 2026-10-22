use bun_sema::hir::{ExprId, PatId, PatKind, StmtId, StmtKind, VarDeclId, VarKind};

use crate::ir::{BlockId, ValueId};
use crate::lower::{
    FileLowering, FunctionLowering, call, dispose, expression, pattern, scope, statement,
};

#[derive(Copy, Clone, Debug)]
pub(super) struct IterationLoop {
    pub(super) header: BlockId,
    pub(super) body: BlockId,
    pub(super) after: BlockId,
}

pub(super) fn lower_loop_subject(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    subject: ExprId,
) -> ValueId {
    let scope = lowering.file.bound.own_scope(statement);
    scope::enter_scope(lowering, scope);
    let value = expression::lower_expression(lowering, subject);
    scope::leave_scope(lowering, scope);
    let position = lowering.file.hir[statement].start;
    lowering.set_position(position);
    value
}

// JSC reports the calls of the iteration protocol at the end of what stands before `of`, which the source map takes back to this token.
pub(super) fn last_mapped_head_position(
    file: &FileLowering<'_, '_, '_, '_>,
    statement: StmtId,
    left: StmtId,
) -> u32 {
    let hir = file.hir;
    let position = match hir[left].kind {
        StmtKind::Var(declarations) => {
            let head = declarations.iter().next();
            head.and_then(|declaration| last_mapped_pattern_position(file, hir[declaration].pat))
        }
        StmtKind::Expr(target) => Some(call::last_mapped_position(file, target)),
        _ => None,
    };
    position.unwrap_or(hir[statement].start)
}

fn last_mapped_pattern_position(
    file: &FileLowering<'_, '_, '_, '_>,
    pattern: PatId,
) -> Option<u32> {
    let hir = file.hir;
    let last_of = |part: PatId, default: ExprId| match default.is_some() {
        true => Some(call::last_mapped_position(file, default)),
        false => last_mapped_pattern_position(file, part),
    };
    match hir[pattern].kind {
        PatKind::Missing => None,
        PatKind::Ident(_) => Some(hir[pattern].pos),
        PatKind::Array(elements) => {
            let mut elements = elements.iter().rev().map(|element| hir[element]);
            elements.find_map(|element| last_of(element.pat, element.default))
        }
        PatKind::Object(properties) => {
            let mut properties = properties.iter().rev().map(|property| hir[property]);
            properties.find_map(|property| last_of(property.value, property.default))
        }
    }
}

pub(super) fn begin_iteration_loop(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) -> IterationLoop {
    let header = scope::create_loop_header(lowering, statement);
    let body = lowering.create_block();
    let after = lowering.create_block();
    lowering.jump(header);
    lowering.builder.switch_to(header);
    lowering.builder.loop_hint();
    IterationLoop {
        header,
        body,
        after,
    }
}

pub(super) fn lower_iteration_body(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    left: StmtId,
    value: ValueId,
    body: StmtId,
) {
    let scope = lowering.file.bound.own_scope(statement);
    scope::enter_scope(lowering, scope);
    match lowering.file.hir[left].kind {
        StmtKind::Var(declarations) => match declarations.iter().next() {
            Some(declaration) => lower_declared_iteration(lowering, declaration, value, body),
            None => statement::lower_statement(lowering, body),
        },
        StmtKind::Expr(target) => {
            pattern::assign_pattern(lowering, target, value, None);
            statement::lower_statement(lowering, body);
        }
        StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Fn(_)
        | StmtKind::Class(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::Return(_)
        | StmtKind::If { .. }
        | StmtKind::For { .. }
        | StmtKind::ForIn { .. }
        | StmtKind::ForOf { .. }
        | StmtKind::While { .. }
        | StmtKind::DoWhile { .. }
        | StmtKind::Block(_)
        | StmtKind::Switch { .. }
        | StmtKind::Try { .. }
        | StmtKind::Throw(_)
        | StmtKind::Break(_)
        | StmtKind::Continue(_)
        | StmtKind::Labeled { .. }
        | StmtKind::Import(_)
        | StmtKind::ImportEquals(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportDefault(_)
        | StmtKind::ExportAssign(_)
        | StmtKind::ExportAsNamespace(_)
        | StmtKind::With { .. }
        | StmtKind::Directive { .. } => statement::lower_statement(lowering, body),
    }
    scope::leave_scope(lowering, scope);
}

fn lower_declared_iteration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: VarDeclId,
    value: ValueId,
    body: StmtId,
) {
    let head = lowering.file.hir[declaration];
    match head.kind {
        VarKind::Using | VarKind::AwaitUsing => {
            dispose::lower_loop_resource(lowering, declaration, value, &mut |lowering| {
                statement::lower_statement(lowering, body);
            });
        }
        VarKind::Var | VarKind::Let | VarKind::Const => {
            pattern::bind_pattern(lowering, head.pat, value, None);
            statement::lower_statement(lowering, body);
        }
    }
}
