use bun_sema::hir::{ExprId, PatId, PatKind, StmtId, StmtKind, VarDeclId, VarKind};

use crate::ir::{BlockId, ValueId};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, Debug)]
pub(super) struct IterationLoop {
    pub(super) header: BlockId,
    pub(super) body: BlockId,
    pub(super) after: BlockId,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_loop_subject(&mut self, statement: StmtId, subject: ExprId) -> ValueId {
        let scope = self.file.bound.own_scope(statement);
        self.enter_scope(scope);
        let value = self.lower_expression(subject);
        self.leave_scope(scope);
        let position = self.file.hir[statement].start;
        self.set_position(position);
        value
    }

    pub(super) fn begin_iteration_loop(&mut self, statement: StmtId) -> IterationLoop {
        let header = self.create_loop_header(statement);
        let body = self.create_block();
        let after = self.create_block();
        self.jump(header);
        self.builder.switch_to(header);
        self.builder.loop_hint();
        IterationLoop {
            header,
            body,
            after,
        }
    }

    pub(super) fn lower_iteration_body(
        &mut self,
        statement: StmtId,
        left: StmtId,
        value: ValueId,
        body: StmtId,
    ) {
        let scope = self.file.bound.own_scope(statement);
        self.enter_scope(scope);
        match self.file.hir[left].kind {
            StmtKind::Var(declarations) => match declarations.iter().next() {
                Some(declaration) => lower_declared_iteration(self, declaration, value, body),
                None => self.lower_statement(body),
            },
            StmtKind::Expr(target) => {
                self.assign_pattern(target, value, None);
                self.lower_statement(body);
            }
            _ => self.lower_statement(body),
        }
        self.leave_scope(scope);
    }
}

impl FileLowering<'_, '_, '_, '_> {
    // JSC reports the calls of the iteration protocol at the end of what stands before `of`, which the source map takes back to this token.
    pub(super) fn last_mapped_head_position(&self, statement: StmtId, left: StmtId) -> u32 {
        let hir = self.hir;
        let position = match hir[left].kind {
            StmtKind::Var(declarations) => {
                let head = declarations.iter().next();
                head.and_then(|declaration| self.last_mapped_pattern_position(hir[declaration].pat))
            }
            StmtKind::Expr(target) => Some(self.last_mapped_position(target)),
            _ => None,
        };
        position.unwrap_or(hir[statement].start)
    }

    fn last_mapped_pattern_position(&self, pattern: PatId) -> Option<u32> {
        let hir = self.hir;
        let last_of = |part: PatId, default: ExprId| match default.is_some() {
            true => Some(self.last_mapped_position(default)),
            false => self.last_mapped_pattern_position(part),
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
            lowering.lower_loop_resource(declaration, value, &mut |lowering| {
                lowering.lower_statement(body);
            });
        }
        VarKind::Var | VarKind::Let | VarKind::Const => {
            lowering.bind_pattern(head.pat, value, None);
            lowering.lower_statement(body);
        }
    }
}
