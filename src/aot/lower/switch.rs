mod dispatch;
#[cfg(test)]
mod tests;

use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{CaseId, ExprId, Span, StmtId, StmtKind};
use bun_sema::types::EnumValue;

use super::condition::TestedField;
use super::control::BreakTargetKind;
use super::{FileLowering, FunctionLowering, scope};
use crate::ir::{BlockId, ValueId};

struct ClauseGroup {
    first: u32,
    end: u32,
    body: BlockId,
}

#[derive(Copy, Clone)]
struct CaseTest {
    expression: ExprId,
    constant: FoldedValue,
    target: BlockId,
}

#[derive(Copy, Clone)]
struct Subject {
    value: ValueId,
    local: Option<SymbolId>,
    field: Option<TestedField>,
}

impl Subject {
    fn is_narrowed_on_edges(self) -> bool {
        self.local.is_some() || self.field.is_some()
    }
}

pub(in crate::lower) fn lower_switch(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) {
    let StmtKind::Switch { expr, cases } = lowering.file.hir[statement].kind else {
        unreachable!("lower_switch takes a Switch statement");
    };
    let switched_by_kind = lowering.find_operand_switched_by_kind(expr, cases);
    let subject = match switched_by_kind {
        Some(operand) => Subject {
            value: lowering.lower_typeof_operand(operand),
            local: None,
            field: None,
        },
        None => Subject {
            value: lowering.lower_expression(expr),
            local: scope::find_tested_local(lowering, expr),
            field: lowering.find_tested_field(expr),
        },
    };
    let scope = lowering.file.bound.own_scope(statement);
    if scope.is_some() {
        lowering.enter_scope(scope);
    }
    let after = lowering.create_block();
    lowering.push_break_target(statement, BreakTargetKind::Switch, after);

    let groups = lowering.create_clause_groups(cases);
    let (tests, default_target) = lowering.file.collect_case_tests(cases, &groups, after);
    match switched_by_kind {
        Some(operand) => {
            let names: Vec<(Atom, BlockId)> = tests.iter().filter_map(find_written_name).collect();
            lowering.jump_by_typeof(operand, subject.value, &names, default_target);
        }
        None => lowering.emit_dispatch(subject, &tests, default_target),
    }
    lowering.lower_clause_groups(cases, &groups, after);

    lowering.pop_jump_target();
    lowering.continue_in(after);
    if scope.is_some() {
        lowering.leave_scope(scope);
    }
}

fn find_written_name(test: &CaseTest) -> Option<(Atom, BlockId)> {
    match test.constant {
        FoldedValue::Constant(Constant::String(name)) => Some((name, test.target)),
        _ => None,
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    /// `switch (typeof operand)` where every case is a written text: the operand.
    fn find_operand_switched_by_kind(
        &mut self,
        subject: ExprId,
        cases: Span<CaseId>,
    ) -> Option<ExprId> {
        let operand = self.find_typeof_operand(subject)?;
        let hir = self.file.hir;
        let is_written_text = cases.iter().all(|case| match hir[case].test.some() {
            Some(test) => matches!(
                find_constant(self.file, test),
                FoldedValue::Constant(Constant::String(_))
            ),
            None => true,
        });
        is_written_text.then_some(operand)
    }

    fn create_clause_groups(&mut self, cases: Span<CaseId>) -> Vec<ClauseGroup> {
        let hir = self.file.hir;
        let mut groups = Vec::new();
        let mut first = 0;
        while first < cases.len {
            let mut end = first + 1;
            while end < cases.len && hir[cases.at(end as usize - 1)].body.is_empty() {
                end += 1;
            }
            let body = self.create_block();
            groups.push(ClauseGroup { first, end, body });
            first = end;
        }
        groups
    }

    fn lower_clause_groups(&mut self, cases: Span<CaseId>, groups: &[ClauseGroup], after: BlockId) {
        let hir = self.file.hir;
        for (index, group) in groups.iter().enumerate() {
            self.continue_in(group.body);
            self.lower_statements(hir[cases.at(group.end as usize - 1)].body);
            let next = groups.get(index + 1).map_or(after, |next| next.body);
            self.jump(next);
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn collect_case_tests(
        &mut self,
        cases: Span<CaseId>,
        groups: &[ClauseGroup],
        after: BlockId,
    ) -> (Vec<CaseTest>, BlockId) {
        let hir = self.hir;
        let mut tests = Vec::with_capacity(cases.len());
        let mut default_target = after;
        for group in groups {
            for index in group.first..group.end {
                match hir[cases.at(index as usize)].test.some() {
                    Some(expression) => tests.push(CaseTest {
                        expression,
                        constant: find_constant(self, expression),
                        target: group.body,
                    }),
                    None => default_target = group.body,
                }
            }
        }
        (tests, default_target)
    }

    fn find_enum_constant(&mut self, access: ExprId) -> FoldedValue {
        match self.queries.constant_enum_access(access) {
            Ok(Some(EnumValue::Number(bits))) => {
                FoldedValue::Constant(Constant::Number(f64::from_bits(bits)))
            }
            Ok(Some(EnumValue::String(text))) => FoldedValue::Constant(Constant::String(text)),
            Ok(None) | Err(_) => FoldedValue::Unknown,
        }
    }
}

fn find_constant(file: &mut FileLowering<'_, '_, '_, '_>, expression: ExprId) -> FoldedValue {
    let inner = file.skip_type_syntax(expression);
    let folded = match file.decisions().constant(file.hir, inner) {
        FoldedValue::Unknown => file.find_enum_constant(inner),
        folded @ (FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_)) => folded,
    };
    match folded {
        FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant)
            if !file.passes_every_assertion(expression, constant) =>
        {
            FoldedValue::Unknown
        }
        _ => folded,
    }
}
