//! Jumps, switches and checks.

use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{DebugHook, IntCases, IntSwitchIndex, op};
use bun_engine_text::StringImpl;
use bun_engine_vm::{CellType, CodeBlock, JsString, TypeFlags, Vm};
use smallvec::SmallVec;

use super::{Compiler, metadata};
use crate::emit::{Emit, at};
use crate::registers::*;

impl Compiler<'_> {
    pub(super) fn goto(&mut self, op: op::Goto) {
        let target = self.target(op.target);
        self.m.jump(target);
    }

    pub(super) fn jump_if_builtin(&mut self, op: op::JumpIfBuiltin) {
        let target = self.target(op.target);
        self.load_both(op.value.into(), op.builtin);
        self.m.branch64(Cond::Eq, T0, T1, target);
        self.m.store32(metadata(op.metadata, 0), 1);
    }

    /// On the low half of `T0`.
    fn switch_on_int32(&mut self, table: IntSwitchIndex) {
        let table = &self.body.int_switches()[table.index()];
        let default = self.label_at(table.default);
        match &table.cases {
            IntCases::Dense { first, targets } => {
                let labels: SmallVec<[Label; 32]> =
                    targets.iter().map(|&it| self.label_at(it)).collect();
                self.m.sub32(T0, T0, Untrusted(*first));
                (self.m).branch32(Cond::AboveEq, T0, labels.len() as u32, default);
                self.m.jump_table(T0, &labels);
            }
            IntCases::Sparse(cases) => {
                let keys: SmallVec<[(i64, Label); 16]> = (cases.iter())
                    .map(|&(key, target)| (key.into(), self.label_at(target)))
                    .collect();
                self.search(Width::W32, T0, &keys, default);
            }
        }
    }

    pub(super) fn switch_int(&mut self, op: op::SwitchInt) {
        let slow = self.slow();
        self.load(T0, op.value);
        self.m.branch_if_not_int32(T0, slow);
        self.switch_on_int32(op.table);
    }

    /// Leaves its `StringImpl` in `T1`.
    fn load_resolved_string(&mut self, otherwise: Label) {
        let slow = self.slow();
        self.m.branch_if_not_cell(T0, otherwise);
        self.m.branch_if_not_type(T0, CellType::String, otherwise);
        self.m.load64(T1, at(T0, JsString::OFFSET_OF_FIBER));
        (self.m).branch_test32(TestCond::NonZero, T1, JsString::IS_ROPE, slow);
    }

    pub(super) fn switch_char(&mut self, op: op::SwitchChar) {
        let default = self.label_at(self.body.int_switches()[op.table.index()].default);
        self.load(T0, op.value);
        self.load_resolved_string(default);
        (self.m).branch32(Cond::Ne, at(T1, StringImpl::OFFSET_OF_LENGTH), 1, default);
        self.m.move32(T2, 0);
        self.m.load_code_unit(T0, T1, T2, T3);
        self.switch_on_int32(op.table);
    }

    pub(super) fn switch_string(&mut self, op: op::SwitchString) {
        let table = &self.body.string_switches()[op.table.index()];
        let atoms = &self.code.string_switches[op.table.index()];
        let mut keys: SmallVec<[(i64, Label); 16]> = (atoms.iter().zip(&table.targets))
            .map(|(atom, &target)| (atom.name().address() as i64, self.label_at(target)))
            .collect();
        keys.sort_by_key(|&(address, _)| address);
        keys.dedup_by_key(|&mut (address, _)| address);
        let (default, found) = (self.label_at(table.default), self.m.new_label());
        let find = self.find_atom(found);
        self.load(T0, op.value);
        self.m.branch_if_not_cell(T0, default);
        self.m.branch_if_not_type(T0, CellType::String, default);
        self.m.branch_unless_flag(T0, TypeFlags::PER_CELL_BIT, find);
        self.m.load64(T1, at(T0, JsString::OFFSET_OF_FIBER));
        self.m.bind(found);
        self.search(Width::W64, T1, &keys, default);
    }

    pub(super) fn cover(&mut self, op: op::Cover) {
        self.m.load64(T1, metadata(op.metadata, 0));
        self.m.add64_to_memory(at(T1, 0), 1);
        self.pass_on_incoming();
    }

    pub(super) fn debug(&mut self, op: op::Debug) {
        if op.hook == DebugHook::DidReachDebuggerStatement {
            return self.call_slow_path();
        }
        let slow = self.slow();
        (self.m).load32(T0, at(VM, Vm::OFFSET_OF_STEPPING_DEBUGGER_COUNT));
        (self.m).or32(
            T0,
            T0,
            at(CODE_BLOCK, CodeBlock::OFFSET_OF_DEBUGGER_REQUESTS),
        );
        self.m.branch_if_not_zero32(T0, slow);
    }

    pub(super) fn throw_if_not_object(&mut self, op: op::ThrowIfNotObject) {
        self.slow_unless_object(op.value);
        self.keep(op.value);
    }

    pub(super) fn throw_if_nullish(&mut self, op: op::ThrowIfNullish) {
        let slow = self.slow();
        self.load(T0, op.value);
        self.m.branch_if_null_or_undefined(T0, T1, slow);
        self.keep(op.value);
    }
}
