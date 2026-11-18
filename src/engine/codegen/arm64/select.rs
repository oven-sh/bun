//! Chooses instructions.

use bun_engine_asm::arm64::{FloatFlags, Select};
use smallvec::SmallVec;

use super::address::{AddressParts, Neighbours};
use super::condition::Term;
use super::instruction::{Inst, ZERO};
use crate::ir::{Binary, Op, Type, Unary, Value};
use crate::machine::{Lowering, Role};

#[derive(Default)]
pub(crate) struct Selection {
    pub(super) neighbours: Neighbours,
    pub(super) terms: Vec<Term>,
    /// The load that comes first, both by address, and where they are.
    pub(super) waiting_loads: SmallVec<[(Value, [Value; 2], AddressParts); 2]>,
}

impl Lowering<'_, Inst> {
    pub(super) fn select(&mut self, value: Value) {
        match self.op(value) {
            Op::Load { .. } if self.select_load_pair(value) => {}
            Op::Store { .. } if self.select_store_pair(value) => {}
            Op::Unary(op, operand) => self.select_unary(value, op, operand),
            Op::Binary(op, [lhs, rhs]) if self.type_of(value).is_int() => {
                self.select_int_binary(value, op, lhs, rhs);
            }
            Op::Binary(op, [lhs, rhs]) => self.select_float_binary(value, op, lhs, rhs),
            Op::Compare(..) | Op::FloatCompare(..) => self.select_boolean(value),
            Op::Select([condition, then, or]) => self.select_choice(value, condition, then, or),
            Op::Wide(op, operands) => self.select_wide(value, op, operands),
            Op::MulWide(sign, [lhs, rhs]) => self.select_mul_wide(value, sign, lhs, rhs),
            Op::Load {
                kind,
                address,
                offset,
                access,
            } => self.select_load(value, kind, address, offset, access),
            Op::Store {
                kind,
                args: [stored, address],
                offset,
                access,
            } => self.select_store(kind, stored, address, offset, access),
            Op::LoadLane {
                lanes,
                lane,
                args,
                offset,
                ..
            } => self.select_load_lane(value, (lanes, lane), args, offset),
            Op::StoreLane {
                lanes,
                lane,
                args,
                offset,
                access,
            } => self.select_store_lane((lanes, lane), args, offset, access),
            Op::AtomicUpdate { op, size, args, .. } => {
                self.select_atomic_update(value, op, size, args);
            }
            Op::AtomicCompareExchange { size, args, .. } => {
                self.select_compare_exchange(value, size, args);
            }
            Op::Fence { reads, writes } => self.select_fence(reads, writes),
            Op::Check(condition, _) => self.select_jump(condition, |this, test| {
                this.exit_of(value, None);
                this.finish(Inst::Check(test));
            }),
            Op::Checked(op, [lhs, rhs], _) => self.select_checked(value, op, lhs, rhs),
            Op::Branch(condition) => {
                self.select_jump(condition, |this, test| this.finish(Inst::Branch(test)));
            }
            Op::JumpTable(index, _) => {
                self.use_or_zero(index, Role::Use);
                self.finish(Inst::JumpTable);
            }
            Op::VectorBinary(op, operands) if self.select_fused_vector(value, op, operands) => {}
            _ => {
                let instruction = self.match_vector(value);
                self.finish(Inst::Vector(instruction));
            }
        }
    }

    fn select_unary(&mut self, value: Value, op: Unary, operand: Value) {
        match op {
            Unary::Neg if self.type_of(value).is_int() => self.select_neg(value, operand),
            Unary::Neg => self.select_float_neg(value, operand),
            Unary::SignExtend(_) | Unary::Widen(_) => {
                let is_done = self.select_field(value);
                debug_assert!(is_done);
            }
            Unary::CountLeadingZeros => self.select_count_leading_zeros(value, operand),
            Unary::CountTrailingZeros => self.select_count_trailing_zeros(value, operand),
            Unary::SwapBytes(size) => self.select_swap_of_bytes(value, size, operand),
            Unary::FloatToInt(sign) | Unary::FloatToIntSaturating(sign) => {
                self.select_float_to_int(value, sign, operand);
            }
            Unary::Bitcast => self.select_bitcast(value, operand),
            Unary::IntToFloat(sign) => self.select_int_to_float(value, sign, operand),
            Unary::FloatToInt32Modular => {
                self.def(value);
                self.use_register(operand);
                self.finish(Inst::FloatToInt32Modular);
            }
            Unary::CanonicalizeNan => self.select_canonical_nan(value, operand),
            _ => self.select_shared(value),
        }
    }

    /// `value` as what the selection makes of another on the way, which is `NONE` for zero.
    fn changed_on_the_way(&self, value: Value, other: Value) -> Option<(Select, Value)> {
        if let Some(constant) = self.constant_bits(value) {
            let all = u64::MAX >> (64 - self.type_of(value).width().bits());
            let from = |known: u64| {
                [
                    (Select::Csinc, known.wrapping_add(1)),
                    (Select::Csinv, !known),
                    (Select::Csneg, known.wrapping_neg()),
                ]
                .into_iter()
                .find(|&(_, result)| result & all == constant && constant != 0)
            };
            let from_zero = from(0).map(|(op, _)| (op, Value::NONE));
            return from_zero.or_else(|| Some((from(self.constant_bits(other)?)?.0, other)));
        }
        if !self.has_one_use_nearby(value) {
            return None;
        }
        match self.op(value) {
            Op::Binary(Binary::Add, [inner, one]) if self.int_constant(one) == Some(1) => {
                Some((Select::Csinc, inner))
            }
            _ => (self.negated(value).map(|inner| (Select::Csneg, inner)))
                .or_else(|| Some((Select::Csinv, self.complemented(value)?))),
        }
    }

    fn select_choice(&mut self, value: Value, condition: Value, then: Value, or: Value) {
        let ty = self.type_of(value);
        let condition = self.match_condition(condition);
        self.def(value);
        let instruction = match condition.flags {
            flags if !ty.is_int() => {
                self.use_register(then);
                self.use_register(or);
                if ty == Type::V128 {
                    Inst::SelectVector(flags)
                } else {
                    Inst::SelectFloat(ty.float_width(), flags)
                }
            }
            FloatFlags::Either(first, second) => {
                self.use_or_zero(then, Role::Use);
                self.use_or_zero(or, Role::Use);
                Inst::SelectOnEither(ty.width(), first, second)
            }
            FloatFlags::One(cc) => {
                let (op, cc, first, second) = match self.changed_on_the_way(or, then) {
                    Some((op, or)) => (op, cc, then, or),
                    None => match self.changed_on_the_way(then, or) {
                        Some((op, then)) => (op, cc.inverted(), or, then),
                        None => (Select::Csel, cc, then, or),
                    },
                };
                self.use_or_zero(first, Role::Use);
                match second.expand() {
                    Some(second) => self.use_or_zero(second, Role::Use),
                    None => self.given(ZERO),
                }
                Inst::Select(op, ty.width(), cc)
            }
        };
        self.finish(instruction);
        self.finish_condition(&condition);
    }
}
