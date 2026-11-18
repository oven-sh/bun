//! Goes where a table says for a unit.

use bun_engine_asm::prelude::*;
use bun_engine_regexp::program::Case;

use crate::frame::CONSTANT;
use crate::generator::Generator;

/// Conditional branches are predicted better than a jump through a table.
const CASES_COMPARED: usize = 64;
const MAX_UNITS_PER_CASE: usize = 24;

impl Generator<'_> {
    /// The unit is in the first temporary register, and not below the first case.
    pub(crate) fn switch(&mut self, cases: &[Case]) {
        let unit = self.frame.temporary(0);
        match cases {
            [only] => self.masm.jump(self.label(only.target)),
            [below, inner @ .., above]
                if cases.len() > CASES_COMPARED
                    && usize::from(above.first - inner[0].first)
                        <= cases.len() * MAX_UNITS_PER_CASE =>
            {
                let label = self.label(above.target);
                self.masm
                    .branch32(Cond::AboveEq, unit, u32::from(above.first), label);
                let (first, label) = (u32::from(inner[0].first), self.label(below.target));
                (self.masm).branch_sub32(ResultCond::Carry, unit, unit, first, label);
                self.switch_by_table(inner, above.first);
            }
            _ => {
                let (lower, upper) = cases.split_at(middle(cases));
                let boundary = u32::from(upper[0].first);
                if let [only] = upper {
                    let label = self.label(only.target);
                    self.masm.branch32(Cond::AboveEq, unit, boundary, label);
                    return self.switch(lower);
                }
                if let [only] = lower {
                    let label = self.label(only.target);
                    self.masm.branch32(Cond::Below, unit, boundary, label);
                    return self.switch(upper);
                }
                let is_upper = self.masm.new_label();
                self.masm.branch32(Cond::AboveEq, unit, boundary, is_upper);
                self.switch(lower);
                self.masm.bind(is_upper);
                self.switch(upper);
            }
        }
    }

    /// The register has the distance from the first case, and the unit is below `end`.
    fn switch_by_table(&mut self, cases: &[Case], end: u16) {
        let mut targets: Vec<_> = cases.iter().map(|case| case.target).collect();
        targets.sort_unstable();
        targets.dedup();
        let mut indices = Vec::with_capacity(usize::from(end - cases[0].first));
        let ends = cases[1..].iter().map(|case| case.first).chain([end]);
        for (case, end) in cases.iter().zip(ends) {
            let index = targets.partition_point(|&it| it < case.target) as u16;
            indices.resize(usize::from(end - cases[0].first), index);
        }
        let table = self.tables.add_words(indices.into_boxed_slice());
        let labels: Vec<Label> = targets.iter().map(|&it| self.label(it)).collect();
        let index = self.frame.temporary(0);
        self.masm.move64(CONSTANT, table);
        (self.masm).load16(index, Address::indexed(CONSTANT, index, Scale::Two, 0));
        self.masm.jump_table(index, &labels);
    }
}

/// Splits the weight in half, but not so unevenly that the tree gets deep.
fn middle(cases: &[Case]) -> usize {
    let total: u32 = cases.iter().map(|case| u32::from(case.weight)).sum();
    let mut below = 0;
    let is_past_half = |case: &Case| {
        below += u32::from(case.weight);
        below * 2 > total + u32::from(case.weight)
    };
    let middle = cases.iter().position(is_past_half).unwrap_or(cases.len());
    let margin = (cases.len() / 8).max(1);
    middle.clamp(margin, cases.len() - margin)
}
