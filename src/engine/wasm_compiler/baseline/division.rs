//! Division of integers.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Shift};
use bun_engine_wasm_format::ValType;

use super::Function;
use super::cold::Cold;
use super::numeric::sign_extended;
use super::operand::{Operand, Place, untrusted};
use crate::abi::Trap;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Wanted {
    Quotient,
    Remainder,
}

/// `None` if the quotient does not fit. `rhs` is not zero.
fn fold(width: Width, sign: Sign, wanted: Wanted, lhs: u64, rhs: u64) -> Option<u64> {
    let (signed_lhs, signed_rhs) = (
        i128::from(sign_extended(lhs, width.size()) as i64),
        i128::from(sign_extended(rhs, width.size()) as i64),
    );
    match (sign, wanted) {
        (Sign::Unsigned, Wanted::Quotient) => Some(lhs / rhs),
        (Sign::Unsigned, Wanted::Remainder) => Some(lhs % rhs),
        (Sign::Signed, Wanted::Quotient) => {
            let quotient = signed_lhs / signed_rhs;
            (quotient < 1 << (width.bits() - 1)).then_some(quotient as u64)
        }
        (Sign::Signed, Wanted::Remainder) => Some((signed_lhs % signed_rhs) as u64),
    }
}

/// For `x` below 2^`precision`, `x / divisor` is `x * multiplier` without its low `32 + shift` bits (Granlund and
/// Montgomery, "Division by Invariant Integers using Multiplication"). The multiplier has up to 33 bits.
fn reciprocal(divisor: u32, precision: u32) -> (u64, u8) {
    let mut shift = (divisor - 1).ilog2() + 1;
    let (divisor, scale) = (u128::from(divisor), 1u128 << (32 + shift));
    let mut low = scale / divisor;
    let mut high = (scale + (1 << (32 + shift - precision))) / divisor;
    while low / 2 < high / 2 && shift > 0 {
        (low, high, shift) = (low / 2, high / 2, shift - 1);
    }
    (high as u64, shift as u8)
}

impl Function<'_> {
    pub(super) fn divide(&mut self, width: Width, sign: Sign, wanted: Wanted) {
        let (rhs, lhs) = (self.pop(), self.pop());
        match (lhs.constant(), rhs.constant()) {
            (_, Some(0)) => self.trap(Trap::DivisionByZero),
            (Some(lhs), Some(rhs)) => match fold(width, sign, wanted, lhs, rhs) {
                Some(result) => self.push_lazy(Operand::int(width, result)),
                None => self.trap(Trap::IntegerOverflow),
            },
            (None, Some(divisor))
                if divisor.is_power_of_two()
                    && (sign == Sign::Unsigned || divisor >> (width.bits() - 1) == 0) =>
            {
                self.divide_by_power_of_two(width, sign, wanted, lhs, divisor);
            }
            (None, Some(divisor)) if width == Width::W32 && divisor != u32::MAX.into() => {
                self.divide_by_constant(sign, wanted, lhs, divisor as u32);
            }
            _ => self.divide_in_hardware(width, sign, wanted, lhs, rhs),
        }
    }

    /// The magnitude of the divisor is at least two.
    fn divide_by_constant(&mut self, sign: Sign, wanted: Wanted, lhs: Operand, divisor: u32) {
        let lhs = self.gpr(lhs);
        let quotient = self.take_gpr();
        let masm = &mut self.masm;
        match sign {
            Sign::Unsigned => {
                let (multiplier, shift) = reciprocal(divisor, 32);
                masm.mul64(quotient, lhs, Untrusted(multiplier as u32));
                if multiplier > u32::MAX.into() {
                    masm.add_shifted(Width::W64, quotient, lhs, quotient, Shift::RightLogical, 32);
                    masm.shr64(quotient, quotient, shift);
                } else {
                    masm.shr64(quotient, quotient, 32 + shift);
                }
            }
            Sign::Signed => {
                let (multiplier, shift) = reciprocal((divisor as i32).unsigned_abs(), 31);
                masm.sign_extend32_to_64(quotient, lhs);
                masm.mul64(quotient, quotient, Untrusted(multiplier));
                masm.sar64(quotient, quotient, 32 + shift);
                // That rounded down, so it is negative if the dividend is.
                let dst = self.take_gpr();
                let (width, shift) = (Width::W32, Shift::RightLogical);
                (self.masm).add_shifted(width, dst, quotient, quotient, shift, 31);
                return self.finish_division(wanted, lhs, dst, divisor, (divisor as i32) < 0);
            }
        }
        self.finish_division(wanted, lhs, quotient, divisor, false);
    }

    fn finish_division(
        &mut self,
        wanted: Wanted,
        lhs: Gpr,
        quotient: Gpr,
        divisor: u32,
        is_negated: bool,
    ) {
        if wanted == Wanted::Quotient {
            if is_negated {
                self.masm.neg32(quotient, quotient);
            }
            return self.push_register(ValType::I32, quotient);
        }
        let magnitude = match is_negated {
            true => divisor.wrapping_neg(),
            false => divisor,
        };
        (self.masm).mul32(quotient, quotient, Untrusted(magnitude));
        let dst = self.result_reusing(self.next(), lhs).gpr();
        self.masm.sub32(dst, lhs, quotient);
        self.push_register(ValType::I32, dst);
    }

    fn divide_by_power_of_two(
        &mut self,
        width: Width,
        sign: Sign,
        wanted: Wanted,
        lhs: Operand,
        divisor: u64,
    ) {
        let (lhs, log2) = (self.gpr(lhs), divisor.trailing_zeros() as u8);
        if sign == Sign::Unsigned || log2 == 0 {
            let dst = self.result_reusing(self.next(), lhs).gpr();
            match wanted {
                Wanted::Quotient => (self.masm).shift(Shift::RightLogical, width, dst, lhs, log2),
                Wanted::Remainder => self.masm.and(width, dst, lhs, divisor - 1),
            }
            return self.push_register(ValType::int(width), dst);
        }
        // Adding one less than the divisor to what is negative makes the shift round toward zero.
        let biased = self.take_gpr();
        let bits = width.bits();
        let masm = &mut self.masm;
        let sign = if log2 == 1 { lhs } else { biased };
        if log2 != 1 {
            masm.shift(Shift::RightArithmetic, width, biased, lhs, bits - 1);
        }
        masm.add_shifted(width, biased, lhs, sign, Shift::RightLogical, bits - log2);
        let dst = self.result_reusing(self.next(), lhs).gpr();
        match wanted {
            Wanted::Quotient => {
                (self.masm).shift(Shift::RightArithmetic, width, dst, biased, log2);
            }
            Wanted::Remainder => {
                (self.masm).and(width, biased, biased, divisor.wrapping_neg());
                self.masm.sub(width, dst, lhs, biased);
            }
        }
        self.push_register(ValType::int(width), dst);
    }

    fn divide_in_hardware(
        &mut self,
        width: Width,
        sign: Sign,
        wanted: Wanted,
        lhs: Operand,
        rhs: Operand,
    ) {
        let overwritten = MacroAssembler::DIVISION_CLOBBERS;
        let divisor = rhs.constant().map(|rhs| sign_extended(rhs, width.size()));
        self.claim(overwritten);
        let rhs = self.gpr_outside(rhs, overwritten);
        let mut natural = overwritten.gprs();
        let (quotient, remainder) = (natural.next(), natural.next());
        let lhs = match (self.locate(lhs).place(), quotient) {
            (Place::Constant(bits), Some(reg)) => {
                self.masm.move_int(width, reg, untrusted(bits));
                reg
            }
            (Place::Slot(_) | Place::Sum(..), Some(reg)) => {
                self.move_operand(reg.into(), lhs);
                reg
            }
            _ => self.gpr(lhs),
        };
        let natural = match wanted {
            Wanted::Quotient => quotient,
            Wanted::Remainder => remainder,
        };
        let dst = match natural {
            Some(reg) => self.result_reusing(self.next(), reg),
            None => self.result(self.next(), Bank::Gpr),
        };
        let dst = dst.gpr();

        if divisor.is_none() {
            let trap = self.trap_label(Trap::DivisionByZero);
            (self.masm).branch_test(width, TestCond::Zero, rhs, -1, trap);
        }
        let may_overflow = sign == Sign::Signed && divisor.is_none_or(|rhs| rhs == u64::MAX);
        let by_minus_one = may_overflow.then(|| {
            let entry = self.masm.new_label();
            self.masm.branch(width, Cond::Eq, rhs, -1, entry);
            entry
        });
        match wanted {
            Wanted::Quotient => self.masm.div(sign, width, dst, lhs, rhs),
            Wanted::Remainder => self.masm.rem(sign, width, dst, lhs, rhs),
        }
        if let Some(entry) = by_minus_one {
            let resume = self.masm.here();
            self.cold.push(match wanted {
                Wanted::Quotient => Cold::DivideByMinusOne {
                    entry,
                    resume,
                    width,
                    dst,
                    lhs,
                },
                Wanted::Remainder => Cold::MoveZero { entry, resume, dst },
            });
        }
        self.push_register(ValType::int(width), dst);
    }
}
