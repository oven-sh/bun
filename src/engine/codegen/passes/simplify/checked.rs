//! Arithmetic that exits on overflow, and arithmetic of 128 bits.

use bun_engine_asm::Sign;

use super::Simplifier;
use super::facts::{Facts, greatest, least};
use super::numbering::unchecked;
use super::rewrite::Step;
use crate::ir::{Binary, Checked, Exit, Op, Type, Value, Wide};

impl Simplifier<'_> {
    pub(super) fn checked(
        &mut self,
        op: Checked,
        ty: Type,
        a: Value,
        b: Value,
        exit: Exit,
    ) -> Step {
        let (min, max) = Facts::exact_range(unchecked(op), self.facts(a), self.facts(b));
        let (lowest, highest) = (least(ty.width()).into(), greatest(ty.width()).into());
        if lowest <= min && max <= highest {
            return self.to_binary(unchecked(op), a, b);
        }
        if max < lowest || highest < min {
            self.hit();
            return Step::Exits(exit);
        }
        match (op, self.int(b)) {
            (Checked::Sub, None) if a == b => self.is_int(ty, 0),
            (Checked::Sub, Some(c)) if c != least(ty.width()) => {
                let negated = self.constant(ty, -c as u64);
                self.to(Op::Checked(Checked::Add, [a, negated], exit))
            }
            (Checked::Mul, Some(2)) => self.to(Op::Checked(Checked::Add, [a, a], exit)),
            (Checked::Mul, Some(-1)) => {
                let zero = self.constant(ty, 0);
                self.to(Op::Checked(Checked::Sub, [zero, a], exit))
            }
            _ => Step::Keep,
        }
    }

    pub(super) fn extract(&mut self, tuple: Value, position: u32) -> Step {
        let half = |wide: u128| (wide >> (64 * position)) as u64;
        match self.op(tuple) {
            Op::Wide(op, args @ [a_low, a_high, b_low, b_high]) => {
                match args.map(|arg| self.bits(arg)) {
                    [Some(a), Some(b), Some(c), Some(d)] => {
                        let (a, b) = (
                            u128::from(b) << 64 | u128::from(a),
                            u128::from(d) << 64 | u128::from(c),
                        );
                        let result = if op == Wide::Add {
                            a.wrapping_add(b)
                        } else {
                            a.wrapping_sub(b)
                        };
                        self.is_bits(Type::I64, half(result))
                    }
                    [_, _, low, _] => {
                        let op = if op == Wide::Add {
                            Binary::Add
                        } else {
                            Binary::Sub
                        };
                        if position == 1 && low == Some(0) {
                            self.to_binary(op, a_high, b_high)
                        } else if position == 0 && (low == Some(0) || self.once(tuple)) {
                            self.to_binary(op, a_low, b_low)
                        } else {
                            Step::Keep
                        }
                    }
                }
            }
            Op::MulWide(sign, [a, b]) => {
                let is_trivial = match (self.int(b), sign) {
                    (Some(c), _) if c == 0 || self.is_constant(a) => true,
                    (Some(c), Sign::Unsigned) => c.count_ones() == 1,
                    (Some(c), Sign::Signed) => c.count_ones() == 1 && c > 0,
                    (None, _) => false,
                };
                if !is_trivial && !self.once(tuple) {
                    return Step::Keep;
                }
                self.to_binary(
                    if position == 0 {
                        Binary::Mul
                    } else {
                        Binary::MulHigh(sign)
                    },
                    a,
                    b,
                )
            }
            _ => Step::Keep,
        }
    }
}
