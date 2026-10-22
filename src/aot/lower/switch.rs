mod dispatch;
#[cfg(test)]
mod tests;

use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{CaseId, ExprId, Span, StmtId, StmtKind};
use bun_sema::types::EnumValue;

use super::condition::{self, TestedField};
use super::control::{self, BreakTargetKind};
use super::{FileLowering, FunctionLowering, expression, operator, scope, statement};
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
    let switched_by_kind = find_operand_switched_by_kind(lowering, expr, cases);
    let subject = match switched_by_kind {
        Some(operand) => Subject {
            value: operator::lower_typeof_operand(lowering, operand),
            local: None,
            field: None,
        },
        None => Subject {
            value: expression::lower_expression(lowering, expr),
            local: scope::find_tested_local(lowering, expr),
            field: condition::find_tested_field(lowering, expr),
        },
    };
    let scope = lowering.file.bound.own_scope(statement);
    if scope.is_some() {
        scope::enter_scope(lowering, scope);
    }
    let after = lowering.create_block();
    control::push_break_target(lowering, statement, BreakTargetKind::Switch, after);

    let groups = create_clause_groups(lowering, cases);
    let (tests, default_target) = collect_case_tests(lowering.file, cases, &groups, after);
    match switched_by_kind {
        Some(operand) => {
            let names: Vec<(Atom, BlockId)> = tests.iter().filter_map(find_written_name).collect();
            condition::jump_by_typeof(lowering, operand, subject.value, &names, default_target);
        }
        None => dispatch::emit_dispatch(lowering, subject, &tests, default_target),
    }
    lower_clause_groups(lowering, cases, &groups, after);

    control::pop_jump_target(lowering);
    lowering.continue_in(after);
    if scope.is_some() {
        scope::leave_scope(lowering, scope);
    }
}

fn find_written_name(test: &CaseTest) -> Option<(Atom, BlockId)> {
    match test.constant {
        FoldedValue::Constant(Constant::String(name)) => Some((name, test.target)),
        FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_) | FoldedValue::Unknown => None,
    }
}

/// `switch (typeof operand)` where every case is a written text: the operand.
fn find_operand_switched_by_kind(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: ExprId,
    cases: Span<CaseId>,
) -> Option<ExprId> {
    let operand = condition::find_typeof_operand(lowering, subject)?;
    let hir = lowering.file.hir;
    let is_written_text = cases.iter().all(|case| match hir[case].test.some() {
        Some(test) => matches!(
            find_constant(lowering.file, test),
            FoldedValue::Constant(Constant::String(_))
        ),
        None => true,
    });
    is_written_text.then_some(operand)
}

fn create_clause_groups(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    cases: Span<CaseId>,
) -> Vec<ClauseGroup> {
    let hir = lowering.file.hir;
    let mut groups = Vec::new();
    let mut first = 0;
    while first < cases.len {
        let mut end = first + 1;
        while end < cases.len && hir[cases.at(end as usize - 1)].body.is_empty() {
            end += 1;
        }
        let body = lowering.create_block();
        groups.push(ClauseGroup { first, end, body });
        first = end;
    }
    groups
}

fn collect_case_tests(
    file: &mut FileLowering<'_, '_, '_, '_>,
    cases: Span<CaseId>,
    groups: &[ClauseGroup],
    after: BlockId,
) -> (Vec<CaseTest>, BlockId) {
    let hir = file.hir;
    let mut tests = Vec::with_capacity(cases.len());
    let mut default_target = after;
    for group in groups {
        for index in group.first..group.end {
            match hir[cases.at(index as usize)].test.some() {
                Some(expression) => tests.push(CaseTest {
                    expression,
                    constant: find_constant(file, expression),
                    target: group.body,
                }),
                None => default_target = group.body,
            }
        }
    }
    (tests, default_target)
}

fn find_constant(file: &mut FileLowering<'_, '_, '_, '_>, expression: ExprId) -> FoldedValue {
    let inner = expression::skip_type_syntax(file, expression);
    let folded = match file.decisions().constant(file.hir, inner) {
        FoldedValue::Unknown => find_enum_constant(file, inner),
        folded @ (FoldedValue::Constant(_) | FoldedValue::ConstantOutsideDeadZone(_)) => folded,
    };
    match folded {
        FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant)
            if !expression::passes_every_assertion(file, expression, constant) =>
        {
            FoldedValue::Unknown
        }
        FoldedValue::Constant(_)
        | FoldedValue::ConstantOutsideDeadZone(_)
        | FoldedValue::Unknown => folded,
    }
}

fn find_enum_constant(file: &mut FileLowering<'_, '_, '_, '_>, access: ExprId) -> FoldedValue {
    match file.queries.constant_enum_access(access) {
        Ok(Some(EnumValue::Number(bits))) => {
            FoldedValue::Constant(Constant::Number(f64::from_bits(bits)))
        }
        Ok(Some(EnumValue::String(text))) => FoldedValue::Constant(Constant::String(text)),
        Ok(None) | Err(_) => FoldedValue::Unknown,
    }
}

fn lower_clause_groups(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    cases: Span<CaseId>,
    groups: &[ClauseGroup],
    after: BlockId,
) {
    let hir = lowering.file.hir;
    for (index, group) in groups.iter().enumerate() {
        lowering.continue_in(group.body);
        statement::lower_statements(lowering, hir[cases.at(group.end as usize - 1)].body);
        let next = groups.get(index + 1).map_or(after, |next| next.body);
        lowering.jump(next);
    }
}
