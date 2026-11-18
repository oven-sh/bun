//! Arithmetic on integers and floats.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Rounding, Shift};
use bun_engine_wasm_format::opcode::{I32_ADD, I64_ADD, I64_EQZ};
use bun_engine_wasm_format::{
    FloatBinaryOp, FloatUnaryOp, IntBinaryOp, IntUnaryOp, ValType, VisitNumeric,
};

use super::condition::Relation;
use super::division::Wanted;
use super::operand::{Operand, Place};
use super::{Compiled, Function};
use crate::abi::Trap;

fn fold_binary(op: IntBinaryOp, lhs: u64, rhs: u64) -> u64 {
    match op {
        IntBinaryOp::Add => lhs.wrapping_add(rhs),
        IntBinaryOp::Sub => lhs.wrapping_sub(rhs),
        IntBinaryOp::Mul => lhs.wrapping_mul(rhs),
        IntBinaryOp::And => lhs & rhs,
        IntBinaryOp::Or => lhs | rhs,
        IntBinaryOp::Xor => lhs ^ rhs,
    }
}

fn fold_unary(width: Width, op: IntUnaryOp, value: u64) -> u32 {
    match op {
        IntUnaryOp::Clz => value.leading_zeros() - (64 - u32::from(width.bits())),
        IntUnaryOp::Ctz => value.trailing_zeros().min(width.bits().into()),
        IntUnaryOp::Popcnt => value.count_ones(),
    }
}

fn fold_shift(width: Width, shift: Shift, value: u64, amount: u32) -> u64 {
    macro_rules! shifted {
        ($unsigned:ty, $signed:ty) => {{
            let value = value as $unsigned;
            match shift {
                Shift::Left => value.wrapping_shl(amount),
                Shift::RightLogical => value.wrapping_shr(amount),
                Shift::RightArithmetic => (value as $signed).wrapping_shr(amount) as $unsigned,
                Shift::RotateLeft => value.rotate_left(amount),
                Shift::RotateRight => value.rotate_right(amount),
            }
        }};
    }
    match width {
        Width::W32 => shifted!(u32, i32).into(),
        Width::W64 => shifted!(u64, i64),
    }
}

#[inline(always)]
fn sum(width: Width, op: IntBinaryOp, local: u32, addend: i32, rhs: u64) -> Option<Operand> {
    match (width, op) {
        (Width::W32, IntBinaryOp::Add) => Operand::sum(local, addend.wrapping_add(rhs as i32)),
        (Width::W32, IntBinaryOp::Sub) => Operand::sum(local, addend.wrapping_sub(rhs as i32)),
        _ => None,
    }
}

pub(super) fn sign_extended(value: u64, from: Size) -> u64 {
    let above = 64 - from.bits();
    ((value as i64) << above >> above) as u64
}

impl Function<'_> {
    /// Of what follows an instruction of one byte.
    #[inline(always)]
    pub(super) fn next(&self) -> usize {
        self.offset + 1
    }

    #[inline(always)]
    fn binary(&mut self, width: Width, op: IntBinaryOp) {
        let (mut rhs, mut lhs) = (self.pop(), self.pop());
        match (lhs.place(), rhs.place()) {
            (Place::Constant(lhs), Place::Constant(rhs)) => {
                return self.push_lazy(Operand::int(width, fold_binary(op, lhs, rhs)));
            }
            (Place::Constant(0), _) if op == IntBinaryOp::Sub => {
                return self.negate(width, rhs);
            }
            (Place::Local(local), Place::Constant(rhs))
                if let Some(sum) = sum(width, op, local, 0, rhs) =>
            {
                self.source(lhs);
                return self.push_lazy(sum);
            }
            (Place::Sum(local, addend), Place::Constant(rhs))
                if let Some(sum) = sum(width, op, local, addend, rhs) =>
            {
                return self.push_lazy(sum);
            }
            (Place::Register(_), _) => {}
            (Place::Constant(_), _) | (_, Place::Register(_)) if op != IntBinaryOp::Sub => {
                core::mem::swap(&mut lhs, &mut rhs);
            }
            _ => {}
        }
        let rhs = self.source(rhs);
        let next = self.next();
        if op == IntBinaryOp::And && self.is_only_tested(width, next) {
            return self.defer_test(width, lhs, rhs);
        }
        let lhs = self.gpr(lhs);
        let dst = self.result_reusing(next, lhs).gpr();
        let src = self.src(rhs);
        match op {
            IntBinaryOp::Add => self.masm.add(width, dst, lhs, src),
            IntBinaryOp::Sub => self.masm.sub(width, dst, lhs, src),
            IntBinaryOp::Mul => match rhs.constant() {
                Some(factor) if factor.is_power_of_two() => {
                    let amount = factor.trailing_zeros() as u8;
                    self.masm.shift(Shift::Left, width, dst, lhs, amount);
                }
                _ => self.masm.mul(width, dst, lhs, src),
            },
            IntBinaryOp::And => match rhs.constant() {
                Some(mask @ (0..=0xffff | 0xffff_ffff)) => {
                    self.masm.and(width, dst, lhs, mask);
                }
                _ => self.masm.and(width, dst, lhs, src),
            },
            IntBinaryOp::Or => self.masm.or(width, dst, lhs, src),
            IntBinaryOp::Xor => self.masm.xor(width, dst, lhs, src),
        }
        self.push_register(ValType::int(width), dst);
    }

    /// Does the work of the next instruction too, if that adds.
    #[inline(always)]
    fn add_shifted(&mut self, width: Width, amount: u8) -> bool {
        let add = match width {
            Width::W32 => I32_ADD,
            Width::W64 => I64_ADD,
        };
        if self.bytes[self.next()] != add {
            return false;
        }
        let operands = &self.stack[self.stack.len() - 2..];
        if operands.iter().any(|value| value.constant().is_some()) {
            return false;
        }
        let (rhs, lhs) = (self.pop_gpr(), self.pop_gpr());
        let is_free = self.registers.free.contains(rhs);
        let reusable = if is_free { rhs } else { lhs };
        let dst = self.result_reusing(self.next() + 1, reusable).gpr();
        (self.masm).add_shifted(width, dst, lhs, rhs, Shift::Left, amount);
        self.push_register(ValType::int(width), dst);
        self.is_next_done = true;
        true
    }

    #[inline(always)]
    fn is_only_tested(&self, width: Width, next: usize) -> bool {
        match width {
            Width::W32 => self.is_tested_at(next),
            Width::W64 => self.bytes[next] == I64_EQZ,
        }
    }

    #[inline(never)]
    fn defer_test(&mut self, width: Width, lhs: Operand, rhs: Operand) {
        let (value, mask) = match rhs.place() {
            Place::Slot(_) => (rhs, Operand::in_register(lhs.ty(), self.register(lhs))),
            _ => (self.source(lhs), rhs),
        };
        self.set_condition(Relation::Test(width, TestCond::NonZero), value, mask);
        self.defer_condition();
    }

    #[inline(never)]
    fn negate(&mut self, width: Width, value: Operand) {
        let src = self.gpr(value);
        let dst = self.result_reusing(self.next(), src).gpr();
        self.masm.neg(width, dst, src);
        self.push_register(ValType::int(width), dst);
    }

    /// From an integer to an integer.
    #[inline(always)]
    fn int_to_int(
        &mut self,
        to: Width,
        fold: impl FnOnce(u64) -> u64,
        emit: impl FnOnce(&mut MacroAssembler, Gpr, Gpr),
    ) -> Compiled {
        let value = self.pop();
        if let Some(bits) = value.constant() {
            self.push_lazy(Operand::int(to, fold(bits)));
            return Ok(());
        }
        let src = self.gpr(value);
        let dst = self.result_reusing(self.next(), src).gpr();
        emit(&mut self.masm, dst, src);
        self.push_register(ValType::int(to), dst);
        Ok(())
    }

    #[inline(always)]
    fn float_to_float(
        &mut self,
        to: FloatWidth,
        emit: impl FnOnce(&mut MacroAssembler, Fpr, Fpr),
    ) -> Compiled {
        let src = self.pop_fpr();
        let dst = self.result_reusing(self.next(), src).fpr();
        emit(&mut self.masm, dst, src);
        self.push_register(ValType::float(to), dst);
        Ok(())
    }

    fn reinterpret(&mut self, to: ValType, bank: Bank) -> Compiled {
        let value = self.pop();
        if let Place::Constant(_) | Place::Slot(_) = value.place() {
            self.push(value.with_type(to));
            return Ok(());
        }
        self.lock(value);
        let value = match value.place() {
            Place::Sum(..) => self.source(value),
            _ => self.locate(value),
        };
        let dst = self.result(self.next(), bank);
        match (value.place(), to) {
            (Place::Register(src), ValType::I32) => {
                self.masm.move_f32_to_bits(dst.gpr(), src.fpr());
            }
            (Place::Register(src), ValType::I64) => {
                self.masm.move_f64_to_bits(dst.gpr(), src.fpr());
            }
            (Place::Register(src), ValType::F32) => {
                self.masm.move_bits_to_f32(dst.fpr(), src.gpr());
            }
            (Place::Register(src), _) => self.masm.move_bits_to_f64(dst.fpr(), src.gpr()),
            _ => self.move_operand(dst, value.with_type(to)),
        }
        self.push_register(to, dst);
        Ok(())
    }

    fn wide(&mut self, emit: fn(&mut MacroAssembler, [Gpr; 2], [Gpr; 2], [Gpr; 2])) -> Compiled {
        let (rhs_high, rhs_low) = (self.pop_gpr(), self.pop_gpr());
        let (lhs_high, lhs_low) = (self.pop_gpr(), self.pop_gpr());
        let dst = [self.reuse(lhs_low).gpr(), self.reuse(lhs_high).gpr()];
        emit(
            &mut self.masm,
            dst,
            [lhs_low, lhs_high],
            [rhs_low, rhs_high],
        );
        self.push_register(ValType::I64, dst[0]);
        self.push_register(ValType::I64, dst[1]);
        Ok(())
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitNumeric for Function<'_> {
    #[inline(always)]
    fn i32_const(&mut self, value: i32) -> Compiled {
        self.push_lazy(Operand::int(Width::W32, value as u64));
        Ok(())
    }

    #[inline(always)]
    fn i64_const(&mut self, value: i64) -> Compiled {
        self.push_lazy(Operand::int(Width::W64, value as u64));
        Ok(())
    }

    #[inline]
    fn f32_const(&mut self, bits: u32) -> Compiled {
        self.push_lazy(Operand::of_bits(ValType::F32, bits.into()));
        Ok(())
    }

    #[inline]
    fn f64_const(&mut self, bits: u64) -> Compiled {
        self.push_lazy(Operand::of_bits(ValType::F64, bits));
        Ok(())
    }

    #[inline(never)]
    fn int_eqz(&mut self, width: Width) -> Compiled {
        match self.pop_condition(width) {
            Some(holds) => self.push_lazy(Operand::int(Width::W32, (!holds).into())),
            None => {
                self.invert_condition();
                self.push_condition(self.next());
            }
        }
        Ok(())
    }

    #[inline(never)]
    fn int_compare(&mut self, width: Width, cond: Cond) -> Compiled {
        self.compare_ints(width, cond, self.next());
        Ok(())
    }

    #[inline(never)]
    fn int_unary(&mut self, width: Width, op: IntUnaryOp) -> Compiled {
        self.int_to_int(
            width,
            |value| fold_unary(width, op, value).into(),
            |masm, dst, src| match op {
                IntUnaryOp::Clz => masm.count_leading_zeros(width, dst, src),
                IntUnaryOp::Ctz => masm.count_trailing_zeros(width, dst, src),
                IntUnaryOp::Popcnt => masm.count_ones(width, dst, src),
            },
        )
    }

    #[inline(never)]
    fn int_binary(&mut self, width: Width, op: IntBinaryOp) -> Compiled {
        if !core::mem::take(&mut self.is_next_done) {
            self.binary(width, op);
        }
        Ok(())
    }

    #[inline(never)]
    fn int_div(&mut self, width: Width, sign: Sign) -> Compiled {
        self.divide(width, sign, Wanted::Quotient);
        Ok(())
    }

    #[inline(never)]
    fn int_rem(&mut self, width: Width, sign: Sign) -> Compiled {
        self.divide(width, sign, Wanted::Remainder);
        Ok(())
    }

    #[inline(never)]
    fn int_shift(&mut self, width: Width, shift: Shift) -> Compiled {
        let amount = self.pop();
        if let Some(amount) = amount.constant() {
            if shift == Shift::Left && self.add_shifted(width, amount as u8 % width.bits()) {
                return Ok(());
            }
            return self.int_to_int(
                width,
                |value| fold_shift(width, shift, value, amount as u32),
                |masm, dst, src| masm.shift(shift, width, dst, src, amount as u8),
            );
        }
        let amount = self.gpr(amount);
        let src = self.pop_gpr();
        let dst = self.result_reusing(self.next(), src).gpr();
        self.masm.shift(shift, width, dst, src, amount);
        self.push_register(ValType::int(width), dst);
        Ok(())
    }

    #[inline(never)]
    fn int_sign_extend(&mut self, width: Width, from: Size) -> Compiled {
        self.int_to_int(
            width,
            |value| sign_extended(value, from),
            |masm, dst, src| masm.extend(from, Sign::Signed, width, dst, src),
        )
    }

    #[inline(never)]
    fn float_compare(&mut self, width: FloatWidth, cond: FloatCond) -> Compiled {
        let (rhs, lhs) = (self.pop_fpr(), self.pop_fpr());
        let operand = |reg| Operand::in_register(ValType::float(width), reg);
        self.set_condition(Relation::Float(width, cond), operand(lhs), operand(rhs));
        self.push_condition(self.next());
        Ok(())
    }

    #[inline(never)]
    fn float_unary(&mut self, width: FloatWidth, op: FloatUnaryOp) -> Compiled {
        self.float_to_float(width, |masm, dst, src| match op {
            FloatUnaryOp::Abs => masm.abs_float(width, dst, src),
            FloatUnaryOp::Neg => masm.neg_float(width, dst, src),
            FloatUnaryOp::Sqrt => masm.sqrt_float(width, dst, src),
        })
    }

    #[inline(never)]
    fn float_round(&mut self, width: FloatWidth, rounding: Rounding) -> Compiled {
        self.float_to_float(width, |masm, dst, src| {
            masm.round_float(rounding, width, dst, src);
        })
    }

    #[inline(never)]
    fn float_binary(&mut self, width: FloatWidth, op: FloatBinaryOp) -> Compiled {
        let (rhs, lhs) = (self.pop_fpr(), self.pop_fpr());
        let free = self.registers.free;
        let reusable = if free.contains(lhs) { lhs } else { rhs };
        let dst = self.result_reusing(self.next(), reusable).fpr();
        match op {
            FloatBinaryOp::Add => self.masm.add_float(width, dst, lhs, rhs),
            FloatBinaryOp::Sub => self.masm.sub_float(width, dst, lhs, rhs),
            FloatBinaryOp::Mul => self.masm.mul_float(width, dst, lhs, rhs),
            FloatBinaryOp::Div => self.masm.div_float(width, dst, lhs, rhs),
            FloatBinaryOp::Min => self.masm.min_float(width, dst, lhs, rhs),
            FloatBinaryOp::Max => self.masm.max_float(width, dst, lhs, rhs),
            FloatBinaryOp::Copysign => self.masm.copysign_float(width, dst, lhs, rhs),
        }
        self.push_register(ValType::float(width), dst);
        Ok(())
    }

    #[inline(never)]
    fn i32_wrap_i64(&mut self) -> Compiled {
        if let Place::Slot(_) = self.top().place() {
            self.narrow_top(ValType::I32);
            return Ok(());
        }
        self.int_to_int(
            Width::W32,
            |value| value,
            |masm, dst, src| masm.move32(dst, src),
        )
    }

    #[inline(never)]
    fn i64_extend_i32(&mut self, sign: Sign) -> Compiled {
        match (sign, self.top().place()) {
            (Sign::Unsigned, Place::Register(_)) => {
                self.narrow_top(ValType::I64);
                Ok(())
            }
            (Sign::Unsigned, _) => self.int_to_int(
                Width::W64,
                |value| value,
                |masm, dst, src| masm.move64(dst, src),
            ),
            (Sign::Signed, _) => self.int_sign_extend(Width::W64, Size::S32),
        }
    }

    #[inline(never)]
    fn truncate_float(&mut self, from: FloatWidth, sign: Sign, to: Width) -> Compiled {
        let src = self.pop_fpr();
        let dst = self.result(self.next(), Bank::Gpr).gpr();
        let trap = self.trap_label(Trap::TruncationOutOfRange);
        (self.masm).truncate_float_or_branch(from, sign, to, dst, src, trap);
        self.push_register(ValType::int(to), dst);
        Ok(())
    }

    #[inline(never)]
    fn truncate_float_saturating(&mut self, from: FloatWidth, sign: Sign, to: Width) -> Compiled {
        let src = self.pop_fpr();
        let dst = self.result(self.after_prefixed_opcode(), Bank::Gpr).gpr();
        (self.masm).truncate_float_saturating(from, sign, to, dst, src);
        self.push_register(ValType::int(to), dst);
        Ok(())
    }

    #[inline(never)]
    fn convert_int_to_float(&mut self, sign: Sign, from: Width, to: FloatWidth) -> Compiled {
        let src = self.pop_gpr();
        let dst = self.result(self.next(), Bank::Fpr).fpr();
        match (sign, from) {
            (Sign::Unsigned, Width::W32) => {
                (self.masm).convert_int_to_float(Sign::Signed, Width::W64, to, dst, src);
            }
            _ => self.masm.convert_int_to_float(sign, from, to, dst, src),
        }
        self.push_register(ValType::float(to), dst);
        Ok(())
    }

    #[inline(never)]
    fn f32_demote_f64(&mut self) -> Compiled {
        self.float_to_float(FloatWidth::F32, MacroAssembler::convert_f64_to_f32)
    }

    #[inline(never)]
    fn f64_promote_f32(&mut self) -> Compiled {
        self.float_to_float(FloatWidth::F64, MacroAssembler::convert_f32_to_f64)
    }

    fn reinterpret_float_as_int(&mut self, width: FloatWidth) -> Compiled {
        self.reinterpret(ValType::int(width.width()), Bank::Gpr)
    }

    fn reinterpret_int_as_float(&mut self, width: FloatWidth) -> Compiled {
        self.reinterpret(ValType::float(width), Bank::Fpr)
    }

    fn i64_add128(&mut self) -> Compiled {
        self.wide(MacroAssembler::add128)
    }

    fn i64_sub128(&mut self) -> Compiled {
        self.wide(MacroAssembler::sub128)
    }

    fn i64_mul_wide(&mut self, sign: Sign) -> Compiled {
        let overwritten = MacroAssembler::DIVISION_CLOBBERS;
        let (rhs, lhs) = (self.pop(), self.pop());
        self.claim(overwritten);
        let rhs = self.gpr_outside(rhs, overwritten);
        let lhs = self.gpr(lhs);
        let mut natural = overwritten.gprs();
        let low = natural.next().unwrap_or_else(|| self.take_gpr());
        let high = natural.next().unwrap_or_else(|| self.take_gpr());
        self.masm.mul_wide64(sign, low, high, lhs, rhs);
        self.push_register(ValType::I64, low);
        self.push_register(ValType::I64, high);
        Ok(())
    }
}
