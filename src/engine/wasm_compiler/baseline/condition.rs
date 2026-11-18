//! Comparisons that a branch or a `select` uses without a boolean in between.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, RegOrImm};
use bun_engine_wasm_format::opcode::{BR_IF, I32_EQZ, IF, SELECT, SELECT_TYPED};
use bun_engine_wasm_format::{ValKind, ValType};

use super::Function;
use super::operand::{Operand, Place, untrusted};

#[derive(Clone, Copy)]
pub(super) enum Relation {
    /// The left side is no constant, and at most one is in the frame.
    Compare(Width, Cond),
    /// Of a value, which is no constant, with a mask, which is not in the frame.
    Test(Width, TestCond),
    /// Both are in registers.
    Float(FloatWidth, FloatCond),
}

impl Relation {
    #[inline]
    fn inverted(self) -> Self {
        match self {
            Self::Compare(width, cond) => Self::Compare(width, cond.inverted()),
            Self::Test(width, cond) => Self::Test(width, cond.inverted()),
            Self::Float(width, cond) => Self::Float(width, cond.inverted()),
        }
    }
}

/// The last that was set up. The operands are located.
pub(super) struct Condition {
    relation: Relation,
    lhs: Operand,
    rhs: Operand,
    /// If it stands in for the operand at the top of the stack, what has to stay locked.
    deferred: Option<RegisterSet>,
}

const ALL_BITS: Operand = Operand::of_bits(ValType::I64, u64::MAX);

impl Condition {
    pub(super) const NONE: Self = Self {
        relation: Relation::Test(Width::W32, TestCond::NonZero),
        lhs: ALL_BITS,
        rhs: ALL_BITS,
        deferred: None,
    };
}

#[inline(always)]
fn mask(mask: Operand) -> RegOrImm {
    match mask.constant() {
        Some(bits @ (0..=0xffff | u64::MAX)) => bits.into(),
        Some(bits) => untrusted(bits),
        None => mask.register().gpr().into(),
    }
}

impl Function<'_> {
    /// Whether the instruction at `next` only asks if its operand of 32 bits is zero.
    #[inline(always)]
    pub(super) fn is_tested_at(&self, next: usize) -> bool {
        matches!(
            self.bytes.get(next),
            Some(&(BR_IF | IF | I32_EQZ | SELECT | SELECT_TYPED))
        )
    }

    #[inline(always)]
    pub(super) fn set_condition(&mut self, relation: Relation, lhs: Operand, rhs: Operand) {
        self.condition.relation = relation;
        self.condition.lhs = lhs;
        self.condition.rhs = rhs;
    }

    #[inline(always)]
    pub(super) fn invert_condition(&mut self) {
        self.condition.relation = self.condition.relation.inverted();
    }

    /// The next instruction takes it.
    #[inline(always)]
    pub(super) fn defer_condition(&mut self) {
        self.condition.deferred = Some(self.registers.locked);
    }

    #[inline(always)]
    pub(super) fn push_condition(&mut self, next: usize) {
        if self.is_tested_at(next) {
            self.defer_condition();
        } else {
            let result = self.boolean(next);
            self.push_register(ValType::I32, result);
        }
    }

    /// Whether the integer at the top of the stack is not zero. If that is not known, it is the condition.
    #[inline(always)]
    pub(super) fn pop_condition(&mut self, width: Width) -> Option<bool> {
        if let Some(locked) = self.condition.deferred.take() {
            self.registers.locked |= locked;
            return None;
        }
        let value = self.pop();
        if let Some(bits) = value.constant() {
            return Some(bits != 0);
        }
        let value = self.source(value);
        self.set_condition(Relation::Test(width, TestCond::NonZero), value, ALL_BITS);
        None
    }

    pub(super) fn branch_on_condition(&mut self, target: Label) {
        let (lhs, rhs) = (self.condition.lhs, self.condition.rhs);
        match self.condition.relation {
            Relation::Compare(width, cond) => {
                let (lhs, rhs) = (self.reg_or_mem(lhs), self.src(rhs));
                self.masm.branch(width, cond, lhs, rhs, target);
            }
            Relation::Test(width, cond) => {
                let value = self.reg_or_mem(lhs);
                self.masm.branch_test(width, cond, value, mask(rhs), target);
            }
            Relation::Float(width, cond) => {
                let (lhs, rhs) = (lhs.register().fpr(), rhs.register().fpr());
                self.masm.branch_float(width, cond, lhs, rhs, target);
            }
        }
    }

    #[inline(never)]
    fn boolean(&mut self, next: usize) -> Gpr {
        let (lhs, rhs) = (self.condition.lhs, self.condition.rhs);
        let dst = match lhs.place() {
            Place::Register(reg) if reg.bank() == Bank::Gpr => self.result_reusing(next, reg),
            _ => self.result(next, Bank::Gpr),
        };
        let dst = dst.gpr();
        match self.condition.relation {
            Relation::Compare(width, cond) => {
                let (lhs, rhs) = (self.reg_or_mem(lhs), self.src(rhs));
                self.masm.compare(width, cond, dst, lhs, rhs);
            }
            Relation::Test(width, cond) => {
                let value = self.reg_or_mem(lhs);
                self.masm.test(width, cond, dst, value, mask(rhs));
            }
            Relation::Float(width, cond) => {
                let (lhs, rhs) = (lhs.register().fpr(), rhs.register().fpr());
                self.masm.compare_float(width, cond, dst, lhs, rhs);
            }
        }
        dst
    }

    #[inline(always)]
    pub(super) fn compare_ints(&mut self, width: Width, cond: Cond, next: usize) {
        let (rhs, lhs) = (self.pop(), self.pop());
        let (cond, lhs, rhs) = match (lhs.constant(), rhs.constant()) {
            (Some(lhs), Some(rhs)) => {
                let holds = match width {
                    Width::W32 => cond.holds32(lhs as i32, rhs as i32),
                    Width::W64 => cond.holds64(lhs as i64, rhs as i64),
                };
                return self.push_lazy(Operand::int(Width::W32, holds.into()));
            }
            (Some(_), None) => (cond.commuted(), rhs, lhs),
            (None, _) => (cond, lhs, rhs),
        };
        let rhs = self.source(rhs);
        let lhs = match rhs.place() {
            Place::Slot(_) => Operand::in_register(lhs.ty(), self.register(lhs)),
            _ => self.source(lhs),
        };
        self.set_condition(Relation::Compare(width, cond), lhs, rhs);
        self.push_condition(next);
    }

    pub(super) fn select_value(&mut self, ty: Option<ValType>, next: usize) {
        if let Some(holds) = self.pop_condition(Width::W32) {
            return self.select_known(holds);
        }
        let (or, then) = (self.pop(), self.pop());
        let ty = ty.unwrap_or_else(|| then.ty());
        self.lock(then);
        let (or, then) = (self.register(or), self.register(then));
        let is_free = self.registers.free.contains(or);
        let reusable = if is_free { or } else { then };
        let (lhs, rhs) = (self.condition.lhs, self.condition.rhs);
        let dst = match (self.condition.relation, ty.kind()) {
            (Relation::Compare(width, cond), ValKind::I32 | ValKind::I64 | ValKind::Ref) => {
                let (cond, lhs, rhs) = match rhs.place() {
                    Place::Slot(_) => (cond.commuted(), rhs, lhs),
                    _ => (cond, lhs, rhs),
                };
                let (lhs, rhs) = (self.gpr(lhs), self.reg_or_imm(rhs));
                let dst = self.result_reusing(next, reusable);
                (self.masm).select(width, cond, dst.gpr(), lhs, rhs, then.gpr(), or.gpr());
                dst
            }
            (Relation::Float(width, cond), kind) if kind != ValKind::V128 => {
                let (lhs, rhs) = (lhs.register().fpr(), rhs.register().fpr());
                let dst = self.result_reusing(next, reusable);
                let masm = &mut self.masm;
                if dst.bank() == Bank::Gpr {
                    masm.select_on_float(width, cond, dst.gpr(), lhs, rhs, then.gpr(), or.gpr());
                } else {
                    let (dst, then, or) = (dst.fpr(), then.fpr(), or.fpr());
                    masm.select_float_on_float(width, cond, dst, lhs, rhs, then, or);
                }
                dst
            }
            (relation, kind) => {
                let (width, cond, value, bits) = match relation {
                    Relation::Test(width, cond) => (width, cond, self.gpr(lhs), mask(rhs)),
                    _ => {
                        let value = self.boolean(self.offset);
                        (Width::W32, TestCond::NonZero, value, mask(ALL_BITS))
                    }
                };
                let dst = self.result_reusing(next, reusable);
                let masm = &mut self.masm;
                match kind {
                    ValKind::V128 => {
                        let (dst, then, or) = (dst.fpr(), then.fpr(), or.fpr());
                        masm.select_vector_test(width, cond, dst, value, bits, then, or);
                    }
                    ValKind::F32 | ValKind::F64 => {
                        let (dst, then, or) = (dst.fpr(), then.fpr(), or.fpr());
                        masm.select_float_test(width, cond, dst, value, bits, then, or);
                    }
                    ValKind::I32 | ValKind::I64 | ValKind::Ref => {
                        masm.select_test(width, cond, dst.gpr(), value, bits, then.gpr(), or.gpr());
                    }
                }
                dst
            }
        };
        self.push_register(ty, dst);
    }

    fn select_known(&mut self, holds: bool) {
        let or = self.pop();
        if holds {
            return;
        }
        self.pop();
        match or.place() {
            Place::Slot(_) => {
                let reg = self.writable(or);
                self.push_register(or.ty(), reg);
            }
            _ => self.push(or),
        }
    }
}
