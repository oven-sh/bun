//! `long double` where it is the x87 format. A value of the type is an object in memory and an
//! expression of the type evaluates to that object's address, like a structure's; every
//! operation is one of the instruction sequences in `x87.rs`, given addresses.

use super::*;
use crate::extended::Extended;
use crate::x87::X87Op;

const TWO_TO_THE_63RD: Extended = Extended {
    sign_exponent: 16383 + 63,
    significand: 1 << 63,
};
const TWO_TO_THE_64TH: Extended = Extended {
    sign_exponent: 16383 + 64,
    significand: 1 << 63,
};
const ONE: Extended = Extended {
    sign_exponent: 16383,
    significand: 1 << 63,
};

impl FnGen<'_, '_> {
    /// One operation on the addresses in `operands`; the comparisons give an `int`.
    pub(super) fn x87(&mut self, operation: X87Op, operands: Vec<V>) -> Option<V> {
        let sequence = operation.sequence();
        let instruction = bir::InlineAsm {
            // It reads and writes memory, and the x87 stack between a call and its result.
            flags: 1,
            code: sequence.code.to_vec(),
            inputs: operands
                .into_iter()
                .zip(sequence.registers.iter().copied())
                .collect(),
            outputs: if sequence.result_in_rax {
                vec![(Ty::I32, 0)]
            } else {
                Vec::new()
            },
            clobbers: sequence.clobbers.to_vec(),
        };
        if sequence.result_in_rax {
            return Some(self.b.def(Inst::InlineAsm(Box::new(instruction)), Ty::I32));
        }
        self.b.effect(Inst::InlineAsm(Box::new(instruction)));
        None
    }

    /// Somewhere for a `long double` to be.
    pub(super) fn long_double_temp(&mut self) -> V {
        let slot = self.b.add_slot(16, 16);
        self.b.def(Inst::SlotAddr(slot), Ty::I64)
    }

    /// Eight bytes for the `double`, `float` or 64-bit integer side of a conversion.
    fn conversion_temp(&mut self) -> V {
        let slot = self.b.add_slot(8, 8);
        self.b.def(Inst::SlotAddr(slot), Ty::I64)
    }

    pub(super) fn long_double_constant(&mut self, value: Extended) -> V {
        let blob = self.m.blob(value.to_bytes().to_vec());
        let object = self.m.blob_object(blob);
        self.data_addr(object)
    }

    /// `a op b` of the two objects, in a new one.
    pub(super) fn long_double_binary(&mut self, op: BinOp, a: V, b: V, loc: Loc) -> Res<V> {
        let operation = match op {
            BinOp::Add => X87Op::Add,
            BinOp::Sub => X87Op::Sub,
            BinOp::Mul => X87Op::Mul,
            BinOp::Div => X87Op::Div,
            _ => return internal(loc, "a long double operation that is not arithmetic"),
        };
        let result = self.long_double_temp();
        self.x87(operation, vec![result, a, b]);
        Ok(result)
    }

    pub(super) fn long_double_negated(&mut self, a: V) -> V {
        let result = self.long_double_temp();
        self.x87(X87Op::Neg, vec![result, a]);
        result
    }

    pub(super) fn long_double_one(&mut self) -> V {
        self.long_double_constant(ONE)
    }

    /// A copy of the object at `a`, for when the original is about to change.
    pub(super) fn long_double_copy(&mut self, a: V) -> V {
        let copy = self.long_double_temp();
        let n = self.b.const_i64(16);
        self.b.effect(Inst::MemCopy(copy, a, n));
        copy
    }

    fn long_double_from_i64(&mut self, v: V) -> V {
        let source = self.conversion_temp();
        self.b.effect(Inst::Store(MemKind::I64, v, source, 0));
        let result = self.long_double_temp();
        self.x87(X87Op::FromI64, vec![result, source]);
        result
    }

    /// From the 64 bits `v` read as unsigned: the signed conversion plus 2^64 if that came out
    /// negative.
    fn long_double_from_u64(&mut self, v: V) -> V {
        let source = self.conversion_temp();
        self.b.effect(Inst::Store(MemKind::I64, v, source, 0));
        let zero = self.b.const_i64(0);
        let top_bit_set = self.b.bin(CBin::Lt, v, zero);
        let two_to_the_64th = self.b.def(Inst::ConstF32(0x5f80_0000), Ty::F32);
        let nothing = self.b.def(Inst::ConstF32(0), Ty::F32);
        let addend = self
            .b
            .def(Inst::Select(top_bit_set, two_to_the_64th, nothing), Ty::F32);
        let addend_at = self.conversion_temp();
        self.b
            .effect(Inst::Store(MemKind::F32, addend, addend_at, 0));
        let result = self.long_double_temp();
        self.x87(X87Op::FromI64Plus, vec![result, source, addend_at]);
        result
    }

    fn long_double_to_i64(&mut self, a: V) -> V {
        let result = self.conversion_temp();
        self.x87(X87Op::ToI64, vec![result, a]);
        self.b.load(MemKind::I64, result, 0)
    }

    /// Converts to or from `long double`; one of the two types is it.
    pub(super) fn long_double_convert(&mut self, v: V, from: &Type, to: &Type, loc: Loc) -> Res<V> {
        if from.is_long_double() && to.is_long_double() {
            return Ok(v);
        }
        if to.is_long_double() {
            return Ok(match from {
                Type::Float | Type::Double => {
                    let single = matches!(from, Type::Float);
                    let source = self.conversion_temp();
                    let kind = if single { MemKind::F32 } else { MemKind::F64 };
                    self.b.effect(Inst::Store(kind, v, source, 0));
                    let result = self.long_double_temp();
                    let operation = if single {
                        X87Op::FromF32
                    } else {
                        X87Op::FromF64
                    };
                    self.x87(operation, vec![result, source]);
                    result
                }
                Type::Int128 | Type::UInt128 => {
                    // high * 2^64 + low, where only the sum can round.
                    let low = self.b.load(MemKind::I64, v, 0);
                    let high = self.b.load(MemKind::I64, v, 8);
                    let high = if matches!(from, Type::Int128) {
                        self.long_double_from_i64(high)
                    } else {
                        self.long_double_from_u64(high)
                    };
                    let scale = self.long_double_constant(TWO_TO_THE_64TH);
                    let high = self.long_double_binary(BinOp::Mul, high, scale, loc)?;
                    let low = self.long_double_from_u64(low);
                    self.long_double_binary(BinOp::Add, high, low, loc)?
                }
                _ if from.is_integer() => {
                    let unsigned = !self.tcx.is_signed(from);
                    if unsigned && self.tcx.size_of(from) == Some(8) {
                        self.long_double_from_u64(v)
                    } else {
                        let wide = if unsigned { Type::ULLong } else { Type::LLong };
                        let v = self.convert(v, from, &wide, loc)?;
                        self.long_double_from_i64(v)
                    }
                }
                _ => return internal(loc, "a conversion to long double from a type that has none"),
            });
        }
        Ok(match to {
            Type::Float | Type::Double => {
                let single = matches!(to, Type::Float);
                let result = self.conversion_temp();
                let operation = if single { X87Op::ToF32 } else { X87Op::ToF64 };
                self.x87(operation, vec![result, v]);
                let kind = if single { MemKind::F32 } else { MemKind::F64 };
                self.b.load(kind, result, 0)
            }
            Type::Bool => {
                let zero = self.long_double_constant(Extended::ZERO);
                let Some(equal) = self.x87(X87Op::Equal, vec![v, zero]) else {
                    return internal(loc, "a comparison without a result");
                };
                let one = self.b.const_i32(1);
                self.b.bin(CBin::Xor, equal, one)
            }
            Type::Int128 | Type::UInt128 => {
                return err(
                    loc,
                    "converting a 'long double' to '__int128' is not supported yet",
                );
            }
            _ if to.is_integer() => {
                let unsigned = !self.tcx.is_signed(to);
                if unsigned && self.tcx.size_of(to) == Some(8) {
                    // Below 2^63 the signed conversion is it; from there up, that of what is
                    // above 2^63 with the top bit put back.
                    let limit = self.long_double_constant(TWO_TO_THE_63RD);
                    let Some(small) = self.x87(X87Op::Less, vec![v, limit]) else {
                        return internal(loc, "a comparison without a result");
                    };
                    let direct = self.long_double_to_i64(v);
                    let reduced = self.long_double_binary(BinOp::Sub, v, limit, loc)?;
                    let reduced = self.long_double_to_i64(reduced);
                    let top = self.b.const_i64(i64::MIN);
                    let restored = self.b.bin(CBin::Xor, reduced, top);
                    self.b.def(Inst::Select(small, direct, restored), Ty::I64)
                } else {
                    let v = self.long_double_to_i64(v);
                    self.convert(v, &Type::LLong, to, loc)?
                }
            }
            _ => return internal(loc, "a conversion from long double to a type that has none"),
        })
    }
}
