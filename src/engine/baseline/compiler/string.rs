//! Operators on strings, and on whatever else is no number.

use bun_engine_asm::prelude::*;
use bun_engine_bytecode::{Operand, Register, op};
use bun_engine_vm::{Arithmetic, CellType, call, operators};

use super::arithmetic::Binary;
use super::{Compiler, metadata, slot};
use crate::emit::Emit;
use crate::profiles::Likely;
use crate::registers::*;

impl Compiler<'_> {
    fn call_operator(&mut self, thunk: usize) {
        self.store_call_site();
        self.m.call_address(thunk);
    }

    fn throw(&mut self) -> Label {
        self.m.external_address(call::throw_from_frame())
    }

    /// The same for one that returns zero if it has thrown.
    fn call_throwing_operator(&mut self, thunk: usize) {
        self.call_operator(thunk);
        let throw = self.throw();
        self.m.branch_if_zero64(T0, throw);
    }

    pub(super) fn binary_operator(&mut self, op: Binary, thunk: usize) {
        let Some(word) = op.profile else {
            return self.call_slow_path();
        };
        self.load(ARGUMENTS[1], op.lhs);
        self.load(ARGUMENTS[2], op.rhs);
        self.m.compute_address(ARGUMENTS[3], metadata(word, 0));
        self.call_throwing_operator(thunk);
        self.store_result(op.dst);
    }

    pub(super) fn concatenate(&mut self, op: op::Concatenate) {
        self.m.compute_address(ARGUMENTS[1], slot(op.first));
        self.m.move32(ARGUMENTS[2], op.count);
        self.call_throwing_operator(self.thunks.concatenate);
        self.store_result(op.dst);
    }

    pub(super) fn type_of(&mut self, dst: Register, value: Operand) {
        self.load(ARGUMENTS[1], value);
        self.call_operator(self.thunks.type_of);
        self.store_result(dst);
    }

    /// Of `T0`.
    fn convert_to_string(&mut self) {
        self.m.move64(ARGUMENTS[1], T0);
        self.call_throwing_operator(self.thunks.to_string);
    }

    pub(super) fn to_string(&mut self, dst: Register, value: Operand) {
        let store = self.m.new_label();
        self.load(T0, value);
        if let Likely::Int32 | Likely::Double | Likely::Boolean = self.likely(value) {
            self.convert_to_string();
        } else {
            let other = self.cold_alone(store, |c, cold| {
                c.convert_to_string();
                c.m.jump(cold.resume);
            });
            self.m.branch_if_not_cell(T0, other);
            self.m.branch_if_not_type(T0, CellType::String, other);
        }
        self.m.bind(store);
        self.store_result(dst);
    }

    /// Where it has been something other than a number.
    pub(super) fn any_to_number(&mut self, dst: Register, value: Operand, word: u32) {
        let store = self.m.new_label();
        self.load(T0, value);
        if (self.profiles.arithmetic(word)).contains(Arithmetic::LHS_INT32) {
            self.assume(word, Arithmetic::LHS_INT32);
            self.m.branch_if_int32(T0, store);
        }
        self.m.move64(ARGUMENTS[1], T0);
        self.m.compute_address(ARGUMENTS[2], metadata(word, 0));
        self.call_throwing_operator(self.thunks.to_number);
        self.m.bind(store);
        self.store_result(dst);
    }

    /// Leaves what is to be compared with what, and how.
    pub(super) fn compare_any(
        &mut self,
        lhs: Operand,
        rhs: Operand,
        cond: Cond,
    ) -> (Cond, Gpr, i32) {
        self.load(ARGUMENTS[1], lhs);
        self.load(ARGUMENTS[2], rhs);
        self.call_operator(self.thunks.compare);
        let throw = self.throw();
        self.m.branch32(Cond::Eq, T0, operators::THREW, throw);
        match cond {
            Cond::Lt | Cond::Le => (cond, T0, 0),
            Cond::Gt => (Cond::Eq, T0, 1),
            _ => (Cond::BelowEq, T0, 1),
        }
    }

    /// Where to go with the string in `T0` if it is not known to be an atom. It comes back with the address of the atom
    /// in `T1`.
    pub(super) fn find_atom(&mut self, resume: Label) -> Label {
        self.cold_alone(resume, |c, cold| {
            c.m.move64(ARGUMENTS[1], T0);
            c.call_throwing_operator(c.thunks.find_atom);
            c.m.move64(T1, T0);
            c.m.jump(cold.resume);
        })
    }
}
