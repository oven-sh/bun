//! Comparisons and tests, whether they store their outcome or jump on it.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{RegOrImm, Src};
use bun_engine_bytecode::{Constant, Jump, Operand, Register};
use bun_engine_vm::{CellType, TypeFlags, Value};

use super::{Cold, Compiler};
use crate::emit::{Emit, FALSE, NULL, TRUE, UNDEFINED};
use crate::profiles::Likely;
use crate::registers::*;

/// What becomes of the outcome. The flag says that it is negated.
#[derive(Clone, Copy)]
pub(super) enum Use {
    Store(Register, bool),
    Jump(Jump, bool),
}

/// Where to go with each outcome, and which of the two places comes next.
#[derive(Clone, Copy)]
struct Exits {
    yes: Label,
    no: Label,
    next_is_yes: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Nullish,
    EqualNull,
    TypeofUndefined,
    Boolean,
    Number,
    Object,
    Cell(CellType),
    Function,
    TypeofObject,
}

fn float_condition(cond: Cond) -> FloatCond {
    match cond {
        Cond::Lt => FloatCond::Lt,
        Cond::Le => FloatCond::Le,
        Cond::Gt => FloatCond::Gt,
        Cond::Ge => FloatCond::Ge,
        _ => FloatCond::Eq,
    }
}

impl Compiler<'_> {
    pub(super) fn is_known_boolean(&self, value: Operand) -> bool {
        self.is_incoming_boolean && self.incoming.is_some_and(|it| value == it)
    }

    /// Runs `test`, which leaves through one of the exits or falls into the one that comes next.
    fn with_exits(&mut self, used: Use, test: impl FnOnce(&mut Self, Exits)) {
        match used {
            Use::Jump(target, is_negated) => {
                let (target, end) = (self.target(target), self.end());
                let (yes, no) = if is_negated {
                    (end, target)
                } else {
                    (target, end)
                };
                let next_is_yes = is_negated;
                test(
                    self,
                    Exits {
                        yes,
                        no,
                        next_is_yes,
                    },
                );
            }
            Use::Store(dst, is_negated) => {
                let (yes, no, store) = (self.m.new_label(), self.m.new_label(), self.m.new_label());
                let next_is_yes = true;
                test(
                    self,
                    Exits {
                        yes,
                        no,
                        next_is_yes,
                    },
                );
                self.m.bind(yes);
                self.m.move32(T0, Value::boolean(!is_negated).to_bits());
                self.m.jump(store);
                self.m.bind(no);
                self.m.move32(T0, Value::boolean(is_negated).to_bits());
                self.m.bind(store);
                self.store_result(dst);
                self.carries_boolean = true;
            }
        }
    }

    fn exit(&mut self, exits: Exits, outcome: bool) {
        if outcome != exits.next_is_yes {
            self.m.jump(if outcome { exits.yes } else { exits.no });
        }
    }

    /// The last step of a test.
    fn exit_on(&mut self, exits: Exits, width: Width, cond: Cond, lhs: Gpr, rhs: impl Into<Src>) {
        if exits.next_is_yes {
            self.m.branch(width, cond.inverted(), lhs, rhs, exits.no);
        } else {
            self.m.branch(width, cond, lhs, rhs, exits.yes);
        }
    }

    fn exit_on_test(
        &mut self,
        exits: Exits,
        width: Width,
        cond: TestCond,
        value: Gpr,
        mask: impl Into<RegOrImm>,
    ) {
        if exits.next_is_yes {
            (self.m).branch_test(width, cond.inverted(), value, mask, exits.no);
        } else {
            self.m.branch_test(width, cond, value, mask, exits.yes);
        }
    }

    /// Calls a stub that leaves 0 or 1 in `T0`, or more if it does not know.
    fn ask(&mut self, exits: Exits, thunk: fn(&mut Compiler<'_>, &Cold)) -> Label {
        let cold = self.cold_until(exits.yes, thunk);
        self.set_other_exit(exits.no);
        cold
    }

    fn set_other_exit(&mut self, label: Label) {
        if let Some(cold) = self.cold.last_mut() {
            cold.other = label;
        }
    }

    fn act_on_answer(&mut self, cold: &Cold) {
        self.m.branch32(Cond::Eq, T0, 1, cold.resume);
        self.m.branch_if_zero32(T0, cold.other);
        self.m.jump(cold.slow);
    }

    pub(super) fn relation(
        &mut self,
        mut lhs: Operand,
        mut rhs: Operand,
        mut cond: Cond,
        used: Use,
    ) {
        if self.int32_constant(lhs).is_some() {
            (lhs, rhs, cond) = (rhs, lhs, cond.commuted());
        }
        let likely = [self.likely(lhs), self.likely(rhs)];
        if likely.contains(&Likely::Double) {
            let slow = self.slow();
            self.load_both(lhs, rhs);
            self.m.number_to_double(F0, T0, T2, slow);
            self.m.number_to_double(F1, T1, T2, slow);
            return self.with_exits(used, |c, exits| {
                let cond = float_condition(cond);
                if exits.next_is_yes {
                    c.m.branch_f64(cond.inverted(), F0, F1, exits.no);
                } else {
                    c.m.branch_f64(cond, F0, F1, exits.yes);
                }
            });
        }
        if likely.contains(&Likely::Cell) && cond != Cond::Eq {
            let (cond, result, than) = self.compare_any(lhs, rhs, cond);
            return self.with_exits(used, |c, exits| {
                c.exit_on(exits, Width::W32, cond, result, than);
            });
        }
        let constant = self.int32_constant(rhs);
        self.with_exits(used, |c, exits| {
            let other = match cond {
                Cond::Lt => c.ask(exits, |c, cold| c.compare_doubles(cold, FloatCond::Lt)),
                Cond::Le => c.ask(exits, |c, cold| c.compare_doubles(cold, FloatCond::Le)),
                Cond::Gt => c.ask(exits, |c, cold| c.compare_doubles(cold, FloatCond::Gt)),
                Cond::Ge => c.ask(exits, |c, cold| c.compare_doubles(cold, FloatCond::Ge)),
                _ => c.ask(exits, |c, cold| {
                    c.m.call_address(c.thunks.loose_equal);
                    c.act_on_answer(cold);
                }),
            };
            c.load_both(lhs, rhs);
            match constant {
                Some(constant) => {
                    c.m.branch_if_not_int32(T0, other);
                    c.exit_on(exits, Width::W32, cond, T0, Untrusted(constant));
                }
                None => {
                    c.m.branch_unless_both_int32(T0, T1, T2, other);
                    c.exit_on(exits, Width::W32, cond, T0, T1);
                }
            }
        });
    }

    fn compare_doubles(&mut self, cold: &Cold, cond: FloatCond) {
        self.m.call_address(self.thunks.to_doubles);
        self.m.branch_if_zero32(T2, cold.slow);
        self.m.branch_f64(cond, F0, F1, cold.resume);
        self.m.jump(cold.other);
    }

    pub(super) fn unsigned_relation(&mut self, lhs: Operand, rhs: Operand, cond: Cond, used: Use) {
        self.load_both(lhs, rhs);
        self.with_exits(used, |c, exits| c.exit_on(exits, Width::W32, cond, T0, T1));
    }

    pub(super) fn identical(&mut self, mut lhs: Operand, mut rhs: Operand, used: Use) {
        if lhs.as_constant().is_some() {
            (lhs, rhs) = (rhs, lhs);
        }
        let immediate = self.immediate(rhs);
        match immediate {
            Some(_) => self.load(T0, lhs),
            None => self.load_both(lhs, rhs),
        }
        let rhs = immediate.unwrap_or(RegOrImm::Reg(T1));
        self.with_exits(used, |c, exits| {
            c.exit_on(exits, Width::W64, Cond::Eq, T0, rhs)
        });
        if let Use::Jump(..) = used {
            self.keep(lhs);
        }
    }

    pub(super) fn strict_equal(&mut self, mut lhs: Operand, mut rhs: Operand, used: Use) {
        if lhs.as_constant().is_some() {
            (lhs, rhs) = (rhs, lhs);
        }
        let is_atom = matches!(self.constant(rhs), Some(Constant::String(_)));
        let constant = self.int32_constant(rhs);
        let likely = [self.likely(lhs), self.likely(rhs)];
        self.with_exits(used, |c, exits| {
            let other = c.ask(exits, |c, cold| {
                c.m.call_address(c.thunks.strict_equal);
                c.act_on_answer(cold);
            });
            c.load_both(lhs, rhs);
            if let Some(constant) = constant {
                c.m.branch_if_not_int32(T0, other);
                c.exit_on(exits, Width::W32, Cond::Eq, T0, Untrusted(constant));
            } else if is_atom {
                c.m.branch64(Cond::Eq, T0, T1, exits.yes);
                c.m.jump(other);
            } else if likely.contains(&Likely::Cell) {
                c.m.or64(T2, T0, T1);
                c.m.branch_if_not_cell(T2, other);
                c.m.branch64(Cond::Eq, T0, T1, exits.yes);
                c.m.branch_if_cell_is_no_object(T0, other);
                c.exit(exits, false);
            } else {
                c.m.branch_unless_both_int32(T0, T1, T2, other);
                c.exit_on(exits, Width::W32, Cond::Eq, T0, T1);
            }
        });
    }

    pub(super) fn truth(&mut self, value: Operand, used: Use) {
        let (is_boolean, likely) = (self.is_known_boolean(value), self.likely(value));
        self.load(T0, value);
        self.with_exits(used, |c, exits| {
            if is_boolean {
                c.exit_on_test(exits, Width::W32, TestCond::NonZero, T0, 1);
                return c.keep(value);
            }
            let other = c.ask(exits, |c, cold| {
                c.m.call_address(c.thunks.to_boolean);
                c.act_on_answer(cold);
            });
            match likely {
                Likely::Int32 => {
                    c.m.branch_if_not_int32(T0, other);
                    c.exit_on_test(exits, Width::W32, TestCond::NonZero, T0, -1);
                }
                Likely::Cell => {
                    c.m.branch_if_not_cell(T0, other);
                    c.m.branch_if_cell_is_no_object(T0, other);
                    c.m.branch_if_flag(T0, TypeFlags::MASQUERADES_AS_UNDEFINED, other);
                    c.exit(exits, true);
                }
                _ if exits.next_is_yes => {
                    c.m.branch64(Cond::Eq, T0, FALSE, exits.no);
                    c.m.branch64(Cond::Ne, T0, TRUE, other);
                }
                _ => {
                    c.m.branch64(Cond::Eq, T0, TRUE, exits.yes);
                    c.m.branch64(Cond::Ne, T0, FALSE, other);
                }
            }
        });
    }

    pub(super) fn kind(&mut self, value: Operand, kind: Kind, used: Use) {
        self.load(T0, value);
        self.with_exits(used, |c, exits| match kind {
            Kind::Nullish => {
                c.m.and64(T1, T0, !Value::UNDEFINED_TAG);
                c.exit_on(exits, Width::W64, Cond::Eq, T1, NULL);
            }
            Kind::EqualNull | Kind::TypeofUndefined => {
                let (slow, no_cell) = (c.slow(), c.m.new_label());
                c.m.branch_if_not_cell(T0, no_cell);
                c.m.branch_if_flag(T0, TypeFlags::MASQUERADES_AS_UNDEFINED, slow);
                c.m.jump(exits.no);
                c.m.bind(no_cell);
                if kind == Kind::EqualNull {
                    c.m.and64(T1, T0, !Value::UNDEFINED_TAG);
                    c.exit_on(exits, Width::W64, Cond::Eq, T1, NULL);
                } else {
                    c.exit_on(exits, Width::W64, Cond::Eq, T0, UNDEFINED);
                }
            }
            Kind::Boolean => {
                c.m.xor64(T1, T0, FALSE);
                c.exit_on(exits, Width::W64, Cond::BelowEq, T1, 1);
            }
            Kind::Number => c.exit_on_test(exits, Width::W64, TestCond::NonZero, T0, NUMBER_TAG),
            Kind::Object | Kind::Cell(_) => {
                c.m.branch_if_not_cell(T0, exits.no);
                c.m.branch_if_empty(T0, exits.no);
                c.m.load8(T1, crate::emit::cell_type(T0));
                let (cond, expected) = match kind {
                    Kind::Cell(expected) => (Cond::Eq, expected),
                    _ => (Cond::AboveEq, CellType::Object),
                };
                c.exit_on(exits, Width::W32, cond, T1, i32::from(expected.0));
            }
            Kind::Function => {
                let slow = c.slow();
                c.m.branch_if_not_cell(T0, exits.no);
                c.m.branch_if_type(T0, CellType::Function, exits.yes);
                c.m.branch_if_flag(T0, TypeFlags::OVERRIDES_CALL_DATA, slow);
                c.exit(exits, false);
            }
            Kind::TypeofObject => {
                let slow = c.slow();
                let special = TypeFlags::OVERRIDES_CALL_DATA | TypeFlags::MASQUERADES_AS_UNDEFINED;
                c.m.branch64(Cond::Eq, T0, NULL, exits.yes);
                c.m.branch_if_not_cell(T0, exits.no);
                c.m.branch_if_type(T0, CellType::Function, exits.no);
                c.m.branch_if_flag(T0, special, slow);
                c.m.load8(T1, crate::emit::cell_type(T0));
                let first = i32::from(CellType::Object.0);
                c.exit_on(exits, Width::W32, Cond::AboveEq, T1, first);
            }
        });
        if let Use::Jump(..) = used {
            self.keep(value);
        }
    }
}
