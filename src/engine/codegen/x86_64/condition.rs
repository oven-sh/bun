//! Comparisons that branches, checks and selections do themselves.

use bun_engine_asm::x64::{Cc, FloatFlags};
use bun_engine_asm::{Cond, Sign, Size, VectorReduce, Width};

use super::address::{AddressParts, Matched};
use super::instruction::{Inst, Source, Stored, Test};
use crate::ir::{AccessFlags, Binary, Load, Op, Type, Unary, Value};
use crate::machine::{Lowering, Place, Role};

fn unsigned(cond: Cond) -> Cond {
    match cond {
        Cond::Lt => Cond::Below,
        Cond::Le => Cond::BelowEq,
        Cond::Gt => Cond::Above,
        Cond::Ge => Cond::AboveEq,
        _ => cond,
    }
}

impl Lowering<'_, Inst> {
    fn can_repeat(&self, value: Value) -> bool {
        self.is_in_this_block(value) || !self.is_materialized(value) && self.is_nearby(value)
    }

    fn is_boolean(&self, value: Value) -> bool {
        matches!(
            self.op(value),
            Op::Compare(..) | Op::FloatCompare(..) | Op::VectorReduce(VectorReduce::AnyTrue, _)
        )
    }

    /// Gives the operands of a test whether `condition` is not zero.
    pub(super) fn use_condition(&mut self, mut condition: Value, user: Value) -> Test {
        let mut is_inverted = false;
        let mut is_only_use = true;
        loop {
            if !self.can_repeat(condition) {
                break;
            }
            is_only_use &= self.use_count(condition) == 1;
            condition = match self.op(condition) {
                Op::Compare(cond @ (Cond::Eq | Cond::Ne), [lhs, rhs])
                    if self.int_constant(rhs) == Some(0) =>
                {
                    is_inverted ^= cond == Cond::Eq;
                    lhs
                }
                Op::Binary(Binary::Xor, [lhs, rhs])
                    if self.int_constant(rhs) == Some(1) && self.is_boolean(lhs) =>
                {
                    is_inverted ^= true;
                    lhs
                }
                Op::Unary(Unary::Widen(_), narrow) => narrow,
                Op::Compare(..)
                | Op::FloatCompare(..)
                | Op::VectorReduce(VectorReduce::AnyTrue, _) => {
                    return self.use_comparison(
                        condition,
                        is_inverted,
                        is_only_use.then_some(user),
                    );
                }
                Op::Binary(Binary::And, [lhs, rhs]) => {
                    let cc = if is_inverted { Cc::E } else { Cc::Ne };
                    return self.use_and(cc, lhs, rhs, is_only_use.then_some(user));
                }
                Op::Load { kind, .. } if is_only_use && self.can_absorb(condition, user) => {
                    let size = if let Load::Narrow(size, _) = kind {
                        size
                    } else {
                        self.type_of(condition).width().size()
                    };
                    let parts = self.parts_of_load(condition);
                    let cc = if is_inverted { Cc::E } else { Cc::Ne };
                    return self.use_memory_comparison(size, cc, condition, parts, Matched::Imm(0));
                }
                _ => break,
            };
        }
        self.use_value(condition, Role::Use, Place::RegisterOrMemory);
        Test::Zero(
            self.type_of(condition).width().size(),
            if is_inverted { Cc::E } else { Cc::Ne },
        )
    }

    /// `absorber` is the instruction that may take over the loads of the operands.
    pub(super) fn use_comparison(
        &mut self,
        comparison: Value,
        is_inverted: bool,
        absorber: Option<Value>,
    ) -> Test {
        match self.op(comparison) {
            Op::Compare(cond, [lhs, rhs]) => self.use_int_comparison(
                if is_inverted { cond.inverted() } else { cond },
                lhs,
                rhs,
                absorber,
            ),
            Op::FloatCompare(cond, [lhs, rhs]) => {
                let cond = if is_inverted { cond.inverted() } else { cond };
                let (flags, is_reversed) = FloatFlags::for_condition(cond, lhs == rhs);
                let (lhs, rhs) = if is_reversed { (rhs, lhs) } else { (lhs, rhs) };
                let matched = absorber.map_or(Matched::Value(rhs), |user| {
                    self.match_value_or_load(rhs, user)
                });
                self.use_register(lhs);
                Test::Float(
                    self.type_of(lhs).float_width(),
                    flags,
                    self.use_matched(matched, Role::Use),
                )
            }
            Op::VectorReduce(VectorReduce::AnyTrue, vector) => {
                self.use_register(vector);
                Test::Vector(if is_inverted { Cc::E } else { Cc::Ne })
            }
            _ => unreachable!("not a comparison"),
        }
    }

    fn use_memory_comparison(
        &mut self,
        size: Size,
        cc: Cc,
        load: Value,
        parts: AddressParts,
        rhs: Matched,
    ) -> Test {
        self.absorb(load);
        let address = self.use_parts(parts, Role::Use);
        let rhs = match rhs {
            Matched::Imm(imm) => Stored::Imm(imm),
            Matched::Value(value) | Matched::Load(value, _) => {
                self.use_register(value);
                Stored::Value
            }
        };
        Test::CompareMemory(size, cc, address, rhs)
    }

    fn use_int_comparison(
        &mut self,
        mut cond: Cond,
        mut lhs: Value,
        mut rhs: Value,
        absorber: Option<Value>,
    ) -> Test {
        if self.op(lhs).is_constant() {
            (cond, lhs, rhs) = (cond.commuted(), rhs, lhs);
        }
        let size = self.type_of(lhs).width().size();
        let imm = self.immediate(rhs);
        if let Some(user) = absorber {
            if let (
                Op::Load {
                    kind: Load::Narrow(narrow, sign),
                    ..
                },
                Some(imm),
            ) = (self.op(lhs), imm)
                && self.can_absorb(lhs, user)
            {
                let half = 1 << (narrow.bits() - 1);
                let narrow_cond = match sign {
                    Sign::Signed => (-half..half).contains(&imm).then_some(cond),
                    Sign::Unsigned => (0..2 * half).contains(&imm).then_some(unsigned(cond)),
                };
                if let Some(cond) = narrow_cond {
                    let parts = self.parts_of_load(lhs);
                    return self.use_memory_comparison(
                        narrow,
                        cond.into(),
                        lhs,
                        parts,
                        Matched::Imm(imm),
                    );
                }
            }
            if self.is_absorbable_load(lhs, user) {
                let parts = self.parts_of_load(lhs);
                let rhs = imm.map_or(Matched::Value(rhs), Matched::Imm);
                return self.use_memory_comparison(size, cond.into(), lhs, parts, rhs);
            }
            if self.is_absorbable_load(rhs, user) {
                let parts = self.parts_of_load(rhs);
                return self.use_memory_comparison(
                    size,
                    cond.commuted().into(),
                    rhs,
                    parts,
                    Matched::Value(lhs),
                );
            }
        }
        let against_zero = match (imm, cond) {
            (Some(0), Cond::Eq | Cond::BelowEq) => Some(Cc::E),
            (Some(0), Cond::Ne | Cond::Above) => Some(Cc::Ne),
            (Some(0), Cond::Lt) | (Some(-1), Cond::Le) => Some(Cc::S),
            (Some(0), Cond::Ge) | (Some(-1), Cond::Gt) => Some(Cc::Ns),
            (Some(0), _) => Some(cond.into()),
            _ => None,
        };
        self.use_value(lhs, Role::Use, Place::RegisterOrMemory);
        if let Some(cc) = against_zero {
            return Test::Zero(size, cc);
        }
        if let Some(imm) = imm {
            return Test::Compare(size, cond.into(), Source::Imm(imm));
        }
        self.use_register(rhs);
        Test::Compare(size, cond.into(), Source::Value)
    }

    fn use_bit_test(&mut self, width: Width, cc: Cc, value: Value, bit: Value) -> Test {
        self.use_register(value);
        self.use_register(bit);
        Test::Bit(
            width,
            if cc == Cc::E { Cc::Ae } else { Cc::B },
            Stored::Value,
        )
    }

    /// `cc` is `E` or `Ne`.
    fn use_and(&mut self, cc: Cc, lhs: Value, rhs: Value, absorber: Option<Value>) -> Test {
        let ty = self.type_of(lhs);
        let Some(mask) = self.constant_bits(rhs) else {
            for (value, other) in [(lhs, rhs), (rhs, lhs)] {
                if let Op::Binary(Binary::Shl, [one, bit]) = self.op(other)
                    && self.int_constant(one) == Some(1)
                    && self.can_repeat(other)
                {
                    return self.use_bit_test(ty.width(), cc, value, bit);
                }
                if absorber.is_some_and(|user| self.is_absorbable_load(value, user)) {
                    let parts = self.parts_of_load(value);
                    self.absorb(value);
                    let address = self.use_parts(parts, Role::Use);
                    self.use_register(other);
                    return Test::AndMemory(ty.width().size(), cc, address, Stored::Value);
                }
            }
            self.use_value(lhs, Role::Use, Place::RegisterOrMemory);
            self.use_register(rhs);
            return Test::And(ty.width().size(), cc, Stored::Value);
        };
        if let Op::Binary(Binary::Shr | Binary::Sar, [value, bit]) = self.op(lhs)
            && mask == 1
            && !self.op(bit).is_constant()
            && self.can_repeat(lhs)
        {
            return self.use_bit_test(ty.width(), cc, value, bit);
        }
        if let (Op::Load { kind, access, .. }, Some(user)) = (self.op(lhs), absorber)
            && self.can_absorb(lhs, user)
        {
            let loaded = if let Load::Narrow(size, _) = kind {
                size
            } else {
                ty.width().size()
            };
            let byte = mask.trailing_zeros() / 8 % 8;
            let is_within =
                matches!(kind, Load::Narrow(_, Sign::Unsigned)) || mask >> (loaded.bits() - 1) <= 1;
            let parts = self.parts_of_load(lhs);
            let chosen = match parts.plus(byte as i32) {
                Some(part)
                    if mask >> (byte * 8) <= 0xff
                        && byte < loaded.bytes().into()
                        && !access.has(AccessFlags::TRAPS) =>
                {
                    Some((Size::S8, part, (mask >> (byte * 8)) as i32))
                }
                _ if loaded == Size::S64 => i32::try_from(mask as i64)
                    .ok()
                    .map(|mask| (loaded, parts, mask)),
                _ => is_within.then_some((loaded, parts, mask as i32)),
            };
            if let Some((size, parts, mask)) = chosen {
                self.absorb(lhs);
                return Test::AndMemory(
                    size,
                    cc,
                    self.use_parts(parts, Role::Use),
                    Stored::Imm(mask),
                );
            }
        }
        self.use_value(lhs, Role::Use, Place::RegisterOrMemory);
        if mask <= 0xff {
            Test::And(Size::S8, cc, Stored::Imm(mask as i32))
        } else if mask <= u32::MAX.into() {
            Test::And(Size::S32, cc, Stored::Imm(mask as i32))
        } else if let Ok(mask) = i32::try_from(mask as i64) {
            Test::And(Size::S64, cc, Stored::Imm(mask))
        } else if mask.is_power_of_two() {
            Test::Bit(
                Width::W64,
                if cc == Cc::E { Cc::Ae } else { Cc::B },
                Stored::Imm(mask.ilog2() as i32),
            )
        } else {
            debug_assert!(ty == Type::I64);
            self.use_register(rhs);
            Test::And(Size::S64, cc, Stored::Value)
        }
    }
}
