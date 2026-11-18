//! Operands of which only some bits count.

use bun_engine_asm::Sign;

use super::Simplifier;
use super::facts::{all_ones, low_bits, up_to_highest};
use crate::ir::Binary::{Add, And, Or, Sar, Shr, Sub, Xor};
use crate::ir::{AccessFlags, Load, Op, Type, Unary, Value};

impl Simplifier<'_> {
    /// A value that agrees with `value` in the demanded bits and takes less to compute.
    pub(super) fn strip(&mut self, value: Value, demanded: u64) -> Option<Value> {
        match self.op(value) {
            Op::Binary(And, [a, b]) => {
                self.strip_neutral(a, b, |facts| demanded & !facts.ones == 0)
            }
            Op::Binary(Or | Xor, [a, b]) => {
                self.strip_neutral(a, b, |facts| demanded & facts.possible() == 0)
            }
            Op::Binary(Add, [a, b]) => self.strip_neutral(a, b, |facts| {
                up_to_highest(demanded) & facts.possible() == 0
            }),
            Op::Binary(Sub, [a, b]) => (up_to_highest(demanded) & self.facts(b).possible() == 0)
                .then(|| {
                    self.hit();
                    a
                }),
            Op::Binary(Sar, [a, amount]) if self.once(value) => {
                let width = self.type_of(value).width();
                let copied = self.int(amount)? as u32 % u32::from(width.bits());
                (demanded & !(all_ones(width) >> copied) == 0).then(|| {
                    self.hit();
                    self.make_binary(Shr, a, amount)
                })
            }
            Op::Unary(Unary::SignExtend(size), a) if demanded >> size.bits() == 0 => {
                self.hit();
                Some(a)
            }
            Op::Unary(Unary::Widen(sign), a) if demanded >> 32 == 0 => {
                if let Some(wide) = self.as_unary(Unary::Wrap, a) {
                    self.hit();
                    return Some(wide);
                }
                (sign == Sign::Signed).then(|| {
                    self.hit();
                    self.make_widen(Sign::Unsigned, a)
                })
            }
            Op::Unary(Unary::Wrap, a) if self.once(value) => {
                let stripped = self.strip(a, demanded)?;
                self.hit();
                Some(self.make_wrap(stripped))
            }
            Op::Load {
                kind: Load::Narrow(size, Sign::Signed),
                address,
                offset,
                access,
            } if demanded >> size.bits() == 0
                && self.once(value)
                && !access.has(AccessFlags::ATOMIC) =>
            {
                self.hit();
                let kind = Load::Narrow(size, Sign::Unsigned);
                Some(self.load_instead(
                    value,
                    Op::Load {
                        kind,
                        address,
                        offset,
                        access,
                    },
                    Type::I32,
                ))
            }
            _ => None,
        }
    }

    fn strip_neutral(
        &mut self,
        a: Value,
        b: Value,
        is_neutral: impl Fn(super::Facts) -> bool,
    ) -> Option<Value> {
        if is_neutral(self.facts(b)) {
            self.hit();
            return Some(a);
        }
        (!self.is_constant(b) && is_neutral(self.facts(a))).then(|| {
            self.hit();
            b
        })
    }

    pub(super) fn strip_above(&mut self, value: Value, bits: u8) -> Option<Value> {
        self.strip(value, low_bits(bits.into()))
    }
}
