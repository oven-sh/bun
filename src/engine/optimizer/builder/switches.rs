//! Switches.

use bun_engine_bytecode::{IntCases, IntSwitchIndex, op};
use bun_engine_codegen::ir::Value as Ssa;
use bun_engine_vm::SpeculatedType as T;
use smallvec::SmallVec;

use super::Builder;
use super::comparisons::type_name_at;
use crate::graph::{ExitKind, Kind, TypeName};

type Cases = SmallVec<[(i64, u32); 16]>;

impl Builder<'_> {
    fn switch_on_integer(&mut self, key: Ssa, table: IntSwitchIndex) {
        let code_block = self.frame().code_block;
        let table = &code_block.body().int_switches()[table.index()];
        let mut cases: Cases = match &table.cases {
            IntCases::Dense { first, targets } => {
                (i64::from(*first)..).zip(targets.iter().copied()).collect()
            }
            IntCases::Sparse(cases) => (cases.iter())
                .map(|&(key, target)| (key.into(), target))
                .collect(),
        };
        cases.retain(|&mut (_, target)| target != table.default);
        self.switch(key, &cases, table.default);
    }

    pub(super) fn switch_int(&mut self, op: op::SwitchInt) {
        let value = self.get_value(op.value);
        let key = if self.is(value, T::INT32)
            || T::INT32.contains(self.expected(value)) && !self.has_exited(ExitKind::NotAnInteger)
        {
            self.as_index(value)
        } else {
            self.inspect(Kind::ExactInt32, value)
        };
        self.switch_on_integer(key, op.table);
    }

    pub(super) fn switch_char(&mut self, op: op::SwitchChar) {
        let value = self.get_value(op.value);
        let unit = (self.graph).inside(self.graph.root(value), Kind::StringFromUnit);
        let unit = unit.unwrap_or_else(|| self.inspect(Kind::OnlyUnit, value));
        self.switch_on_integer(unit, op.table);
    }

    pub(super) fn switch_string(&mut self, op: op::SwitchString) {
        let (code_block, value) = (self.frame().code_block, self.get_value(op.value));
        let table = &code_block.body().string_switches()[op.table.index()];
        let atoms = &code_block.code().string_switches[op.table.index()];
        let mut cases: Cases = (atoms.iter().zip(&table.targets))
            .map(|(atom, &target)| (atom.name().address() as i64, target))
            .collect();
        cases.sort_by_key(|&(address, _)| address);
        cases.dedup_by_key(|&mut (address, _)| address);
        cases.retain(|&mut (_, target)| target != table.default);
        let root = self.graph.root(value);
        if let Some(operand) = self.graph.inside(root, Kind::PlainTypeof) {
            return self.switch_on_type_name(root, operand, &cases, table.default);
        }
        let key = match self.graph.text_of_constant(value).and_then(|it| it.atom) {
            Some(atom) => self.word(atom),
            None => self.inspect(Kind::ExistingAtom, value),
        };
        self.switch(key, &cases, table.default);
    }

    fn switch_on_type_name(&mut self, found: Ssa, value: Ssa, cases: &Cases, default: u32) {
        let named = |&(atom, target): &(i64, u32)| Some((type_name_at(atom as usize)?, target));
        let cases: SmallVec<[(TypeName, u32); 8]> = cases.iter().filter_map(named).collect();
        let expected = self.expected(value);
        if let Some(name) = TypeName::of(expected).filter(|_| !self.has_exited(ExitKind::BadType)) {
            self.check_type(value, name.certain_types(expected));
            let case = cases.iter().find(|it| it.0 == name);
            return self.goto(self.target_at(case.map_or(default, |it| it.1)));
        }
        let keys: Cases = (cases.iter())
            .map(|&(name, target)| (self.graph.type_names[name as usize] as i64, target))
            .collect();
        self.switch(found, &keys, default);
    }
}
