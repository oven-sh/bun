use bun_sema::check::aot::{CheckedType, GaveUp};
use bun_sema::hir::{ExprId, StmtId, StmtKind};

use super::loop_head::{
    begin_iteration_loop, last_mapped_head_position, lower_iteration_body, lower_loop_subject,
};
use super::{emit_iterator_close, emit_iterator_open, emit_iterator_step};
use crate::ir::generated::{BlockRole, IteratorCompletion, IteratorKind, TypeSiteKind};
use crate::ir::{ContentsSlot, Edge};
use crate::lower::control::{self, BreakTargetKind, CleanupLanding, CleanupPath};
use crate::lower::types::find_contents_type;
use crate::lower::{FileLowering, FunctionLowering, convert};

pub(super) fn lower_for_of(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) {
    let StmtKind::ForOf {
        left,
        expr,
        body,
        is_await,
    } = lowering.file.hir[statement].kind
    else {
        unreachable!("lower_for_of takes a ForOf statement");
    };
    let kind = match is_await {
        true => IteratorKind::Async,
        false => IteratorKind::Sync,
    };
    let iterable = lower_loop_subject(lowering, statement, expr);
    let position = last_mapped_head_position(lowering.file, statement, left);
    lowering.set_position(position);
    let iterator = emit_iterator_open(lowering, iterable, kind, None);
    let blocks = begin_iteration_loop(lowering, statement);
    let step = emit_iterator_step(lowering, iterator, kind, None);
    lowering
        .builder
        .branch(step.done, Edge::to(blocks.after), Edge::to(blocks.body));
    lowering.continue_in(blocks.body);

    control::push_break_target(lowering, statement, BreakTargetKind::Loop, blocks.after);
    control::begin_cleanup(lowering, BlockRole::IterationCleanup, Some(iterator));
    control::push_continue_target(lowering, statement, blocks.header);
    let stepped = find_stepped_type(lowering.file, left, expr, kind);
    record_flow_into_assigned_head(lowering.file, left, stepped);
    let value = convert::claim_contents_read(lowering, stepped, TypeSiteKind::Element, step.value);
    lower_iteration_body(lowering, statement, left, value, body);
    lowering.jump(blocks.header);
    control::pop_jump_target(lowering);

    lowering.set_position(position);
    control::end_cleanup_per_exit(
        lowering,
        CleanupLanding::KeepsException,
        &mut |lowering, path| {
            emit_iterator_close(lowering, iterator, kind, completion_of(path));
        },
    );
    lowering.builder.seal(blocks.header);
    control::pop_jump_target(lowering);
    lowering.continue_in(blocks.after);
}

fn find_stepped_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    left: StmtId,
    iterable: ExprId,
    kind: IteratorKind,
) -> CheckedType {
    let hir = file.hir;
    // The checker types a declared head by the iteration protocol, so a `Map` or a generator has an answer too.
    if let StmtKind::Var(declarations) = hir[left].kind
        && let Some(declaration) = declarations.iter().next()
    {
        return file.queries.binding_type(hir[declaration].pat);
    }
    let iterable = file.queries.expression_type(iterable)?;
    let element = find_contents_type(file, iterable, ContentsSlot::Element);
    let element = element.ok_or(GaveUp::Unresolved)?;
    match kind {
        IteratorKind::Sync => Ok(element),
        IteratorKind::Async => file.queries.awaited_type(element),
    }
}

// The type of a declared head is the stepped type itself. A target that is declared elsewhere has a type of its own.
fn record_flow_into_assigned_head(
    file: &mut FileLowering<'_, '_, '_, '_>,
    left: StmtId,
    stepped: CheckedType,
) {
    let hir = file.hir;
    let (StmtKind::Expr(target), Ok(stepped)) = (hir[left].kind, stepped) else {
        return;
    };
    convert::record_assigned_type_flow(file, target, stepped);
}

fn completion_of(path: CleanupPath) -> IteratorCompletion {
    match path {
        CleanupPath::Normal => IteratorCompletion::Normal,
        CleanupPath::Rethrow => IteratorCompletion::Throw,
        CleanupPath::Throw { .. } => unreachable!("an iterator close keeps the exception"),
    }
}
