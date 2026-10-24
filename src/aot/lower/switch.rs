mod dispatch;
#[cfg(test)]
mod tests;

use bun_sema::atom::Atom;
use bun_sema::bind::SymbolId;
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{CaseId, ExprId, Span, StmtId};

use super::condition::TestedField;
use super::control::BreakTargetKind;
use super::typescript::to_constant;
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn lower_switch(
        &mut self,
        statement: StmtId,
        expr: ExprId,
        cases: Span<CaseId>,
    ) {
        let switched_by_kind = self.find_operand_switched_by_kind(expr, cases);
        let subject = match switched_by_kind {
            Some(operand) => Subject {
                value: self.lower_typeof_operand(operand),
                local: None,
                field: None,
            },
            None => Subject {
                value: self.lower_expression(expr),
                local: scope::find_tested_local(self, expr),
                field: self.find_tested_field(expr),
            },
        };
        let scope = self.enter_own_scope(statement);
        let after = self.create_block();
        self.push_break_target(statement, BreakTargetKind::Switch, after);

        let groups = self.create_clause_groups(cases);
        let hir = self.file.hir;
        let mut tests = Vec::with_capacity(cases.len());
        let mut default_target = after;
        for group in &groups {
            for index in group.first..group.end {
                match hir[cases.at(index as usize)].test.some() {
                    Some(expression) => tests.push(CaseTest {
                        expression,
                        constant: find_constant(self.file, expression),
                        target: group.body,
                    }),
                    None => default_target = group.body,
                }
            }
        }
        match switched_by_kind {
            Some(operand) => {
                let names = tests.iter().filter_map(|test| match test.constant {
                    FoldedValue::Constant(Constant::String(name)) => Some((name, test.target)),
                    _ => None,
                });
                let names: Vec<(Atom, BlockId)> = names.collect();
                self.jump_by_typeof(operand, subject.value, &names, default_target);
            }
            None => self.emit_dispatch(subject, &tests, default_target),
        }
        for (index, group) in groups.iter().enumerate() {
            self.continue_in(group.body);
            self.lower_statements(hir[cases.at(group.end as usize - 1)].body);
            let next = groups.get(index + 1).map_or(after, |next| next.body);
            self.jump(next);
        }

        self.pop_jump_target();
        self.continue_in(after);
        self.leave_own_scope(scope);
    }

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
}

fn find_constant(file: &mut FileLowering<'_, '_, '_, '_>, expression: ExprId) -> FoldedValue {
    let inner = file.skip_type_syntax(expression);
    let folded = match file.decisions().constant(file.hir, inner) {
        FoldedValue::Unknown => match file.queries.constant_enum_access(inner) {
            Ok(Some(value)) => FoldedValue::Constant(to_constant(value)),
            Ok(None) | Err(_) => FoldedValue::Unknown,
        },
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
