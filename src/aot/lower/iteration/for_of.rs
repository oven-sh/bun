use bun_sema::check::aot::{CheckedType, GaveUp};
use bun_sema::hir::{ExprId, StmtId, StmtKind};

use crate::ir::generated::{BlockRole, IteratorCompletion, IteratorKind, TypeSiteKind};
use crate::ir::{ContentsSlot, Edge};
use crate::lower::control::{BreakTargetKind, CleanupLanding, CleanupPath};
use crate::lower::types::find_contents_type;
use crate::lower::{FileLowering, FunctionLowering};

pub(crate) fn lower_for_of(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) {
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
    let iterable = lowering.lower_loop_subject(statement, expr);
    let position = lowering.file.last_mapped_head_position(statement, left);
    lowering.set_position(position);
    let iterator = lowering.emit_iterator_open(iterable, kind, None);
    let blocks = lowering.begin_iteration_loop(statement);
    let step = lowering.emit_iterator_step(iterator, kind, None);
    lowering
        .builder
        .branch(step.done, Edge::to(blocks.after), Edge::to(blocks.body));
    lowering.continue_in(blocks.body);

    lowering.push_break_target(statement, BreakTargetKind::Loop, blocks.after);
    lowering.begin_cleanup(BlockRole::IterationCleanup, Some(iterator));
    lowering.push_continue_target(statement, blocks.header);
    let stepped = lowering.file.find_stepped_type(left, expr, kind);
    lowering.file.record_flow_into_assigned_head(left, stepped);
    let value = lowering.claim_contents_read(stepped, TypeSiteKind::Element, step.value);
    lowering.lower_iteration_body(statement, left, value, body);
    lowering.jump(blocks.header);
    lowering.pop_jump_target();

    lowering.set_position(position);
    lowering.end_cleanup_per_exit(CleanupLanding::KeepsException, &mut |lowering, path| {
        lowering.emit_iterator_close(iterator, kind, completion_of(path));
    });
    lowering.builder.seal(blocks.header);
    lowering.pop_jump_target();
    lowering.continue_in(blocks.after);
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_stepped_type(
        &mut self,
        left: StmtId,
        iterable: ExprId,
        kind: IteratorKind,
    ) -> CheckedType {
        let hir = self.hir;
        // The checker types a declared head by the iteration protocol, so a `Map` or a generator has an answer too.
        if let StmtKind::Var(declarations) = hir[left].kind
            && let Some(declaration) = declarations.iter().next()
        {
            return self.queries.binding_type(hir[declaration].pat);
        }
        let iterable = self.queries.expression_type(iterable)?;
        let element = find_contents_type(self, iterable, ContentsSlot::Element);
        let element = element.ok_or(GaveUp::Unresolved)?;
        match kind {
            IteratorKind::Sync => Ok(element),
            IteratorKind::Async => self.queries.awaited_type(element),
        }
    }

    // The type of a declared head is the stepped type itself. A target that is declared elsewhere has a type of its own.
    fn record_flow_into_assigned_head(&mut self, left: StmtId, stepped: CheckedType) {
        let hir = self.hir;
        let (StmtKind::Expr(target), Ok(stepped)) = (hir[left].kind, stepped) else {
            return;
        };
        self.record_assigned_type_flow(target, stepped);
    }
}

fn completion_of(path: CleanupPath) -> IteratorCompletion {
    match path {
        CleanupPath::Normal => IteratorCompletion::Normal,
        CleanupPath::Rethrow => IteratorCompletion::Throw,
        CleanupPath::Throw { .. } => unreachable!("an iterator close keeps the exception"),
    }
}
