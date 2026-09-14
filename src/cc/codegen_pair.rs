//! Code generation for the arithmetic types that live in memory as two halves: `__int128`
//! (low then high 64 bits) and `_Complex float` / `_Complex double` (real then imaginary).
//!
//! An expression of such a type evaluates to the address of an object, like a struct;
//! every operation loads the halves, computes, and stores the result in a fresh temporary.
//!
//! An expression of 128-bit integer type that creates no basic blocks is computed on its
//! halves as values (`Wide`), knowing which high halves are zero or copies of the sign
//! bit, and only put in memory where its address is needed: `(unsigned __int128)a * b` is
//! one `Mul` and one `UMulHigh`.
//!
//! 128-bit multiplication is `Mul` and `UMulHigh` of the low halves plus the cross terms;
//! division, remainder and the conversions to and from floating point call the compiler
//! runtime (`__divti3`, `__floattidf`, ...). Complex division scales by the larger part of
//! the divisor (Smith's method), so that finite operands do not overflow on the way.

use super::{Callee, FnGen, internal};
use crate::ast::*;
use crate::bir::{BinOp as CBin, ConvOp, Inst, MemKind, Ty, UnOp, V};
use crate::token::{Loc, Res, err};
use crate::types::Type;

/// What is known about the upper 64 bits of a 128-bit value.
#[derive(Clone, Copy)]
pub(super) enum High {
    Zero,
    /// Every bit is the top bit of the lower half: the value is a sign-extended i64.
    Sign,
    Value(V),
}

/// A 128-bit integer as two values of the current block.
#[derive(Clone, Copy)]
pub(super) struct Wide {
    pub(super) low: V,
    pub(super) high: High,
}

/// The two 64-bit parts of something that is two: the lower and upper half of a 128-bit integer
/// (as values, or as the BIR locals that hold them), or, in the order they have in memory, the
/// real and imaginary part of a complex number.
#[derive(Clone, Copy)]
pub(super) struct Halves {
    pub(super) low: V,
    pub(super) high: V,
}

/// The BIR operation of `&`, `|` or `^`.
fn bitwise(op: BinOp) -> CBin {
    match op {
        BinOp::And => CBin::And,
        BinOp::Or => CBin::Or,
        _ => CBin::Xor,
    }
}

impl FnGen<'_, '_> {
    /// Whether 128-bit `e` is computed by `gen_wide` without going through memory.
    pub(super) fn is_wide_operation(e: &Expr) -> bool {
        e.ty.is_int128()
            && !e.has_control_flow
            && match &e.kind {
                ExprKind::Binary(op, a, _) => {
                    a.ty.is_int128()
                        && matches!(
                            op,
                            BinOp::Add
                                | BinOp::Sub
                                | BinOp::Mul
                                | BinOp::And
                                | BinOp::Or
                                | BinOp::Xor
                                | BinOp::Shl
                                | BinOp::Shr
                        )
                }
                ExprKind::Cast(inner) => {
                    inner.ty.is_int128() || (inner.ty.is_integer() && !inner.ty.is_pair())
                }
                ExprKind::Neg(_) | ExprKind::BitNot(_) => true,
                _ => false,
            }
    }

    /// The BIR locals of `e` if it names a 128-bit variable kept as two halves.
    pub(super) fn halves_of(&self, e: &Expr) -> Option<Halves> {
        match e.kind {
            ExprKind::Local(id) => match self.locals[id as usize] {
                super::LocalPlace::Halves(halves) => Some(halves),
                _ => None,
            },
            _ => None,
        }
    }

    pub(super) fn set_halves(&mut self, locals: Halves, value: Wide) {
        let high_value = self.high_value(value);
        self.b.effect(Inst::LocalSet(locals.low, value.low));
        self.b.effect(Inst::LocalSet(locals.high, high_value));
    }

    /// The halves of 128-bit `e`, whatever it is: computed as values if it creates no
    /// basic blocks, read from the object it evaluates to otherwise.
    pub(super) fn gen_wide_any(&mut self, e: &Expr) -> Res<Wide> {
        if !e.has_control_flow {
            return self.gen_wide(e);
        }
        let address = self.gen_value(e)?;
        let Halves { low, high } = self.load_pair(address, e.ty.unatomic());
        Ok(Wide {
            low,
            high: High::Value(high),
        })
    }

    pub(super) fn high_value(&mut self, w: Wide) -> V {
        match w.high {
            High::Zero => self.b.const_i64(0),
            High::Sign => {
                let c63 = self.b.const_i32(63);
                self.b.bin(CBin::ShrS, w.low, c63)
            }
            High::Value(v) => v,
        }
    }

    /// The halves of 128-bit `e`, which creates no basic blocks.
    pub(super) fn gen_wide(&mut self, e: &Expr) -> Res<Wide> {
        let loc = e.loc;
        if !self.tcx.stack_check.is_safe_to_recurse() {
            return err(loc, "expression is nested too deeply");
        }
        if Self::is_wide_operation(e) {
            match &e.kind {
                ExprKind::Cast(inner) if inner.ty.is_int128() => return self.gen_wide(inner),
                ExprKind::Cast(inner) => {
                    let signed = self.tcx.is_signed(&inner.ty);
                    let to = if signed { Type::LLong } else { Type::ULLong };
                    let v = self.gen_value(inner)?;
                    let low = self.convert(v, &inner.ty, &to, loc)?;
                    let high = if signed { High::Sign } else { High::Zero };
                    return Ok(Wide { low, high });
                }
                ExprKind::Binary(op @ (BinOp::Shl | BinOp::Shr), a, b) => {
                    let signed = self.tcx.is_signed(&a.ty);
                    let x = self.gen_wide(a)?;
                    if let ExprKind::IntLit(k) = b.kind {
                        return Ok(self.wide_shift_by(*op, x, (k & 127) as i32, signed));
                    }
                    let amount = self.gen_value(b)?;
                    let high = self.high_value(x);
                    let Halves { low, high } =
                        self.int128_shift(*op, Halves { low: x.low, high }, amount, signed);
                    return Ok(Wide {
                        low,
                        high: High::Value(high),
                    });
                }
                ExprKind::Binary(..) => {
                    // A chain of them: down the left operands by a loop.
                    let mut links: Vec<(BinOp, &Expr)> = Vec::new();
                    let mut innermost = e;
                    while let ExprKind::Binary(op, a, b) = &innermost.kind {
                        if matches!(op, BinOp::Shl | BinOp::Shr)
                            || !Self::is_wide_operation(innermost)
                        {
                            break;
                        }
                        links.push((*op, b));
                        innermost = a;
                    }
                    let mut x = self.gen_wide(innermost)?;
                    while let Some((op, right)) = links.pop() {
                        let y = self.gen_wide(right)?;
                        x = self.wide_binary(op, x, y);
                    }
                    return Ok(x);
                }
                ExprKind::Neg(a) => {
                    let zero = Wide {
                        low: self.b.const_i64(0),
                        high: High::Zero,
                    };
                    let x = self.gen_wide(a)?;
                    return Ok(self.wide_binary(BinOp::Sub, zero, x));
                }
                ExprKind::BitNot(a) => {
                    let x = self.gen_wide(a)?;
                    let ones = self.b.const_i64(-1);
                    let high = self.high_value(x);
                    let low = self.b.bin(CBin::Xor, x.low, ones);
                    let high = self.b.bin(CBin::Xor, high, ones);
                    return Ok(Wide {
                        low,
                        high: High::Value(high),
                    });
                }
                _ => {}
            }
        }
        if let ExprKind::Call { callee, args } = &e.kind {
            self.want_wide_result = true;
            self.wide_result = None;
            let result = self.gen_call(callee, args)?;
            self.want_wide_result = false;
            if let Some(Halves { low, high }) = self.wide_result.take() {
                return Ok(Wide {
                    low,
                    high: High::Value(high),
                });
            }
            let Some(address) = result else {
                return internal(loc, "a call without a result used as a 128-bit value");
            };
            let Halves { low, high } = self.load_pair(address, e.ty.unatomic());
            return Ok(Wide {
                low,
                high: High::Value(high),
            });
        }
        if let Some(Halves { low, high }) = self.halves_of(e) {
            return Ok(Wide {
                low: self.b.local_get(low),
                high: High::Value(self.b.local_get(high)),
            });
        }
        if let ExprKind::IntLit(v) = e.kind {
            let low = self.b.const_i64(v);
            let high = if v >= 0 { High::Zero } else { High::Sign };
            return Ok(Wide { low, high });
        }
        let address = self.gen_value(e)?;
        let Halves { low, high } = self.load_pair(address, e.ty.unatomic());
        Ok(Wide {
            low,
            high: High::Value(high),
        })
    }

    /// `x op y` for `+ - * & | ^`.
    pub(super) fn wide_binary(&mut self, op: BinOp, x: Wide, y: Wide) -> Wide {
        match op {
            BinOp::Add => {
                let low = self.b.bin(CBin::Add, x.low, y.low);
                let carry = self.b.bin(CBin::ULt, low, x.low);
                let carry = self.i32_to_i64(carry);
                let high = match (x.high, y.high) {
                    (High::Zero, High::Zero) => carry,
                    (High::Zero, _) => {
                        let h = self.high_value(y);
                        self.b.bin(CBin::Add, h, carry)
                    }
                    (_, High::Zero) => {
                        let h = self.high_value(x);
                        self.b.bin(CBin::Add, h, carry)
                    }
                    _ => {
                        let (hx, hy) = (self.high_value(x), self.high_value(y));
                        let sum = self.b.bin(CBin::Add, hx, hy);
                        self.b.bin(CBin::Add, sum, carry)
                    }
                };
                Wide {
                    low,
                    high: High::Value(high),
                }
            }
            BinOp::Sub => {
                let low = self.b.bin(CBin::Sub, x.low, y.low);
                let borrow = self.b.bin(CBin::ULt, x.low, y.low);
                let borrow = self.i32_to_i64(borrow);
                let (hx, hy) = (self.high_value(x), self.high_value(y));
                let high = match y.high {
                    High::Zero => hx,
                    _ => self.b.bin(CBin::Sub, hx, hy),
                };
                let high = self.b.bin(CBin::Sub, high, borrow);
                Wide {
                    low,
                    high: High::Value(high),
                }
            }
            BinOp::Mul => {
                let low = self.b.bin(CBin::Mul, x.low, y.low);
                let high = match (x.high, y.high) {
                    // Both zero-extended, or both sign-extended: the full product of the halves.
                    (High::Zero, High::Zero) => self.b.bin(CBin::UMulHigh, x.low, y.low),
                    (High::Sign, High::Sign) => self.b.bin(CBin::MulHigh, x.low, y.low),
                    _ => {
                        let mut high = self.b.bin(CBin::UMulHigh, x.low, y.low);
                        if !matches!(y.high, High::Zero) {
                            let hy = self.high_value(y);
                            let cross = self.b.bin(CBin::Mul, x.low, hy);
                            high = self.b.bin(CBin::Add, high, cross);
                        }
                        if !matches!(x.high, High::Zero) {
                            let hx = self.high_value(x);
                            let cross = self.b.bin(CBin::Mul, hx, y.low);
                            high = self.b.bin(CBin::Add, high, cross);
                        }
                        high
                    }
                };
                Wide {
                    low,
                    high: High::Value(high),
                }
            }
            _ => {
                let bit_op = bitwise(op);
                let low = self.b.bin(bit_op, x.low, y.low);
                let high = match (op, x.high, y.high) {
                    (BinOp::And, High::Zero, _) | (BinOp::And, _, High::Zero) => High::Zero,
                    (BinOp::Or | BinOp::Xor, High::Zero, other)
                    | (BinOp::Or | BinOp::Xor, other, High::Zero) => other,
                    _ => {
                        let (hx, hy) = (self.high_value(x), self.high_value(y));
                        High::Value(self.b.bin(bit_op, hx, hy))
                    }
                };
                // (`Sign` describes the low half it came with, not the new one.)
                let high = match high {
                    High::Sign => {
                        let from = if matches!(x.high, High::Sign) { x } else { y };
                        High::Value(self.high_value(from))
                    }
                    other => other,
                };
                Wide { low, high }
            }
        }
    }

    /// `x << k` or `x >> k` for a constant `k` in 0..128.
    fn wide_shift_by(&mut self, op: BinOp, x: Wide, k: i32, signed: bool) -> Wide {
        if k == 0 {
            return x;
        }
        let shift = |g: &mut Self, op: CBin, v: V, by: i32| -> V {
            if by == 0 {
                return v;
            }
            let by = g.b.const_i32(by);
            g.b.bin(op, v, by)
        };
        if op == BinOp::Shl {
            if k >= 64 {
                let low = self.b.const_i64(0);
                let high = shift(self, CBin::Shl, x.low, k - 64);
                return Wide {
                    low,
                    high: High::Value(high),
                };
            }
            let low = shift(self, CBin::Shl, x.low, k);
            let carried = shift(self, CBin::ShrU, x.low, 64 - k);
            let high = match x.high {
                High::Zero => carried,
                _ => {
                    let h = self.high_value(x);
                    let kept = shift(self, CBin::Shl, h, k);
                    self.b.bin(CBin::Or, kept, carried)
                }
            };
            return Wide {
                low,
                high: High::Value(high),
            };
        }
        let arithmetic = signed && !matches!(x.high, High::Zero);
        if k >= 64 {
            let low = match x.high {
                High::Zero => self.b.const_i64(0),
                _ => {
                    let h = self.high_value(x);
                    shift(
                        self,
                        if arithmetic { CBin::ShrS } else { CBin::ShrU },
                        h,
                        k - 64,
                    )
                }
            };
            let high = if arithmetic { High::Sign } else { High::Zero };
            return Wide { low, high };
        }
        let kept = shift(self, CBin::ShrU, x.low, k);
        match x.high {
            High::Zero => Wide {
                low: kept,
                high: High::Zero,
            },
            _ => {
                let h = self.high_value(x);
                let carried = shift(self, CBin::Shl, h, 64 - k);
                let low = self.b.bin(CBin::Or, kept, carried);
                let high = shift(self, if arithmetic { CBin::ShrS } else { CBin::ShrU }, h, k);
                Wide {
                    low,
                    high: High::Value(high),
                }
            }
        }
    }

    /// Stores 128-bit `w` at `address`.
    pub(super) fn store_wide(&mut self, address: V, w: Wide) {
        let high = self.high_value(w);
        self.b.effect(Inst::Store(MemKind::I64, w.low, address, 0));
        self.b.effect(Inst::Store(MemKind::I64, high, address, 8));
    }

    /// Memory kind of one half, and the offset of the second half.
    fn pair_layout(ty: &Type) -> (MemKind, i64) {
        match ty.unatomic() {
            Type::ComplexFloat => (MemKind::F32, 4),
            Type::ComplexDouble => (MemKind::F64, 8),
            _ => (MemKind::I64, 8),
        }
    }

    pub(super) fn load_pair(&mut self, address: V, ty: &Type) -> Halves {
        let (kind, second) = Self::pair_layout(ty);
        Halves {
            low: self.b.load(kind, address, 0),
            high: self.b.load(kind, address, second),
        }
    }

    fn store_pair(&mut self, address: V, ty: &Type, first: V, second: V) {
        let (kind, offset) = Self::pair_layout(ty);
        self.b.effect(Inst::Store(kind, first, address, 0));
        self.b.effect(Inst::Store(kind, second, address, offset));
    }

    /// A temporary of type `ty` holding the two halves; returns its address.
    pub(super) fn make_pair(&mut self, ty: &Type, first: V, second: V) -> V {
        let object = self.temp_object(ty);
        self.store_pair(object, ty, first, second);
        object
    }

    /// An `IntLit` of 128-bit type: the sign-extended 64-bit value.
    pub(super) fn pair_literal(&mut self, ty: &Type, value: i64) -> V {
        let low = self.b.const_i64(value);
        let high = self.b.const_i64(value >> 63);
        self.make_pair(ty, low, high)
    }

    /// The value one: what `++` adds.
    pub(super) fn pair_one(&mut self, ty: &Type) -> V {
        let (re, im) = match ty.unatomic() {
            Type::ComplexFloat => (
                self.b.def(Inst::ConstF32(1f32.to_bits()), Ty::F32),
                self.zero(Ty::F32),
            ),
            Type::ComplexDouble => (
                self.b.def(Inst::ConstF64(1f64.to_bits()), Ty::F64),
                self.zero(Ty::F64),
            ),
            _ => return self.pair_literal(ty, 1),
        };
        self.make_pair(ty, re, im)
    }

    fn i32_to_i64(&mut self, v: V) -> V {
        self.b.un(UnOp::ZExt32, v)
    }

    /// Whether the value at `address` is non-zero, as exactly 0 or 1.
    pub(super) fn pair_truth(&mut self, address: V, ty: &Type) -> V {
        let Halves { low: a, high: b } = self.load_pair(address, ty);
        if ty.is_int128() {
            let any = self.b.bin(CBin::Or, a, b);
            let zero = self.b.const_i64(0);
            return self.b.bin(CBin::Ne, any, zero);
        }
        let zero = self.zero(self.b.value_ty(a));
        let real = self.b.bin(CBin::Ne, a, zero);
        let imag = self.b.bin(CBin::Ne, b, zero);
        self.b.bin(CBin::Or, real, imag)
    }

    /// Calls a compiler runtime function. Arguments are values (addresses for pair types).
    fn runtime_call(&mut self, name: &str, ret: &Type, args: &[(V, Type)], loc: Loc) -> Res<V> {
        let types: Vec<Type> = args.iter().map(|(_, t)| t.clone()).collect();
        let handles: Vec<V> = args.iter().map(|(v, _)| *v).collect();
        let index = self.m.runtime_extern(name, ret, &types, loc)?;
        match self.emit_call(
            Callee::Extern(index),
            ret,
            &types,
            types.len(),
            super::Arity::Fixed,
            super::SignatureOf::Callee,
            &handles,
            loc,
        )? {
            Some(v) => Ok(v),
            None => internal(loc, "runtime function without a result"),
        }
    }

    /// `a < b` on 128-bit values, as 0 or 1.
    fn int128_less(&mut self, a: Halves, b: Halves, signed: bool) -> V {
        let high_less = self
            .b
            .bin(if signed { CBin::Lt } else { CBin::ULt }, a.high, b.high);
        let high_equal = self.b.bin(CBin::Eq, a.high, b.high);
        let low_less = self.b.bin(CBin::ULt, a.low, b.low);
        let tie = self.b.bin(CBin::And, high_equal, low_less);
        self.b.bin(CBin::Or, high_less, tie)
    }

    /// `x op y` for a comparison of 128-bit values, as 0 or 1.
    pub(super) fn int128_compare(&mut self, op: BinOp, x: Halves, y: Halves, signed: bool) -> V {
        match op {
            BinOp::Eq | BinOp::Ne => {
                let low = self.b.bin(CBin::Xor, x.low, y.low);
                let high = self.b.bin(CBin::Xor, x.high, y.high);
                let differ = self.b.bin(CBin::Or, low, high);
                let zero = self.b.const_i64(0);
                self.b.bin(
                    if op == BinOp::Eq { CBin::Eq } else { CBin::Ne },
                    differ,
                    zero,
                )
            }
            BinOp::Lt => self.int128_less(x, y, signed),
            BinOp::Gt => self.int128_less(y, x, signed),
            BinOp::Le => {
                let greater = self.int128_less(y, x, signed);
                self.flip(greater)
            }
            _ => {
                let less = self.int128_less(x, y, signed);
                self.flip(less)
            }
        }
    }

    fn flip(&mut self, truth: V) -> V {
        let one = self.b.const_i32(1);
        self.b.bin(CBin::Xor, truth, one)
    }

    /// A shift of the 128-bit value `a` by `amount` (an i32, taken modulo 128).
    fn int128_shift(&mut self, op: BinOp, a: Halves, amount: V, signed: bool) -> Halves {
        let Halves { low, high } = a;
        let c127 = self.b.const_i32(127);
        let n = self.b.bin(CBin::And, amount, c127);
        let c63 = self.b.const_i32(63);
        let m = self.b.bin(CBin::And, n, c63);
        let sixty_four = self.b.const_i32(64);
        let big = self.b.bin(CBin::UGe, n, sixty_four);
        let rest = self.b.bin(CBin::Sub, c63, m);
        let one = self.b.const_i32(1);
        let zero = self.b.const_i64(0);
        if op == BinOp::Shl {
            // The bits that cross from the low half: (low >> 1) >> (63 - m) avoids a shift by 64.
            let low_small = self.b.bin(CBin::Shl, low, m);
            let carried = self.b.bin(CBin::ShrU, low, one);
            let carried = self.b.bin(CBin::ShrU, carried, rest);
            let high_shifted = self.b.bin(CBin::Shl, high, m);
            let high_small = self.b.bin(CBin::Or, high_shifted, carried);
            let new_low = self.b.def(Inst::Select(big, zero, low_small), Ty::I64);
            let new_high = self
                .b
                .def(Inst::Select(big, low_small, high_small), Ty::I64);
            return Halves {
                low: new_low,
                high: new_high,
            };
        }
        let shift = if signed { CBin::ShrS } else { CBin::ShrU };
        let high_small = self.b.bin(shift, high, m);
        let carried = self.b.bin(CBin::Shl, high, one);
        let carried = self.b.bin(CBin::Shl, carried, rest);
        let low_shifted = self.b.bin(CBin::ShrU, low, m);
        let low_small = self.b.bin(CBin::Or, low_shifted, carried);
        let fill = if signed {
            self.b.bin(CBin::ShrS, high, c63)
        } else {
            zero
        };
        let new_low = self
            .b
            .def(Inst::Select(big, high_small, low_small), Ty::I64);
        let new_high = self.b.def(Inst::Select(big, fill, high_small), Ty::I64);
        Halves {
            low: new_low,
            high: new_high,
        }
    }

    /// `a op b` where both operands have pair type `ty` (a shift's `b` is an `int` value).
    /// Comparisons give an `int`; everything else the address of a new `ty`.
    pub(super) fn gen_pair_binary(&mut self, op: BinOp, ty: &Type, a: V, b: V, loc: Loc) -> Res<V> {
        if ty.is_complex() {
            return self.gen_complex_binary(op, ty, a, b, loc);
        }
        let signed = self.tcx.is_signed(ty);
        if matches!(op, BinOp::Shl | BinOp::Shr) {
            let halves = self.load_pair(a, ty);
            let Halves { low, high } = self.int128_shift(op, halves, b, signed);
            return Ok(self.make_pair(ty, low, high));
        }
        if matches!(op, BinOp::Div | BinOp::Rem) {
            let name = match (op, signed) {
                (BinOp::Div, true) => "__divti3",
                (BinOp::Div, false) => "__udivti3",
                (_, true) => "__modti3",
                (_, false) => "__umodti3",
            };
            return self.runtime_call(name, ty, &[(a, ty.clone()), (b, ty.clone())], loc);
        }
        let x = self.load_pair(a, ty);
        let y = self.load_pair(b, ty);
        let (low, high) = match op {
            BinOp::Add => {
                let low = self.b.bin(CBin::Add, x.low, y.low);
                let carry = self.b.bin(CBin::ULt, low, x.low);
                let carry = self.i32_to_i64(carry);
                let high = self.b.bin(CBin::Add, x.high, y.high);
                (low, self.b.bin(CBin::Add, high, carry))
            }
            BinOp::Sub => {
                let low = self.b.bin(CBin::Sub, x.low, y.low);
                let borrow = self.b.bin(CBin::ULt, x.low, y.low);
                let borrow = self.i32_to_i64(borrow);
                let high = self.b.bin(CBin::Sub, x.high, y.high);
                (low, self.b.bin(CBin::Sub, high, borrow))
            }
            BinOp::Mul => {
                let low = self.b.bin(CBin::Mul, x.low, y.low);
                let high = self.b.bin(CBin::UMulHigh, x.low, y.low);
                let cross1 = self.b.bin(CBin::Mul, x.low, y.high);
                let cross2 = self.b.bin(CBin::Mul, x.high, y.low);
                let high = self.b.bin(CBin::Add, high, cross1);
                (low, self.b.bin(CBin::Add, high, cross2))
            }
            BinOp::And | BinOp::Or | BinOp::Xor => {
                let bit_op = bitwise(op);
                (
                    self.b.bin(bit_op, x.low, y.low),
                    self.b.bin(bit_op, x.high, y.high),
                )
            }
            BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Gt | BinOp::Le | BinOp::Ge => {
                return Ok(self.int128_compare(op, x, y, signed));
            }
            BinOp::Shl | BinOp::Shr | BinOp::Div | BinOp::Rem => {
                return internal(loc, "128-bit operation handled above");
            }
        };
        Ok(self.make_pair(ty, low, high))
    }

    fn gen_complex_binary(&mut self, op: BinOp, ty: &Type, a: V, b: V, loc: Loc) -> Res<V> {
        self.gen_complex_mixed(op, ty, (a, true), (b, true), loc)
    }

    /// `a op b` in the complex type `ty`, where each operand is either a value of that type
    /// (its address, `true`) or a real number of its part type (`false`). A real operand
    /// stays real: `z * r` is two multiplications and `z / r` two divisions, which is what
    /// keeps infinities, signed zeros and large values what they should be (C11 G.5.1).
    pub(super) fn gen_complex_mixed(
        &mut self,
        op: BinOp,
        ty: &Type,
        (a, a_is_complex): (V, bool),
        (b, b_is_complex): (V, bool),
        loc: Loc,
    ) -> Res<V> {
        let mut parts = |v: V, is_complex: bool| -> (V, Option<V>) {
            if is_complex {
                let Halves { low, high } = self.load_pair(v, ty);
                (low, Some(high))
            } else {
                (v, None)
            }
        };
        let (a, a_im) = parts(a, a_is_complex);
        let (c, c_im) = parts(b, b_is_complex);
        let part = if matches!(ty.unatomic(), Type::ComplexFloat) {
            Ty::F32
        } else {
            Ty::F64
        };
        let (re, im) = match (op, a_im, c_im) {
            (BinOp::Add, b, d) => {
                let im = match (b, d) {
                    (Some(b), Some(d)) => self.b.bin(CBin::Add, b, d),
                    (Some(only), None) | (None, Some(only)) => only,
                    (None, None) => self.zero(part),
                };
                (self.b.bin(CBin::Add, a, c), im)
            }
            (BinOp::Sub, b, d) => {
                let im = match (b, d) {
                    (Some(b), Some(d)) => self.b.bin(CBin::Sub, b, d),
                    (Some(b), None) => b,
                    (None, Some(d)) => self.b.un(UnOp::Neg, d),
                    (None, None) => self.zero(part),
                };
                (self.b.bin(CBin::Sub, a, c), im)
            }
            (BinOp::Mul, Some(b), Some(d)) => {
                let ac = self.b.bin(CBin::Mul, a, c);
                let bd = self.b.bin(CBin::Mul, b, d);
                let ad = self.b.bin(CBin::Mul, a, d);
                let bc = self.b.bin(CBin::Mul, b, c);
                (self.b.bin(CBin::Sub, ac, bd), self.b.bin(CBin::Add, ad, bc))
            }
            (BinOp::Mul, Some(b), None) => {
                (self.b.bin(CBin::Mul, a, c), self.b.bin(CBin::Mul, b, c))
            }
            (BinOp::Mul, None, Some(d)) => {
                (self.b.bin(CBin::Mul, a, c), self.b.bin(CBin::Mul, a, d))
            }
            (BinOp::Div, Some(b), None) => {
                (self.b.bin(CBin::Div, a, c), self.b.bin(CBin::Div, b, c))
            }
            (BinOp::Div, b, Some(d)) => {
                let b = match b {
                    Some(b) => b,
                    None => self.zero(part),
                };
                if part == Ty::F32 {
                    // In double nothing a float can hold overflows or vanishes.
                    let [a, b, c, d] = [a, b, c, d].map(|v| self.b.un(UnOp::FPromote, v));
                    let (re, im) = self.complex_quotient(a, b, c, d, false);
                    (self.b.un(UnOp::FDemote, re), self.b.un(UnOp::FDemote, im))
                } else {
                    self.complex_quotient(a, b, c, d, true)
                }
            }
            (BinOp::Eq | BinOp::Ne, b, d) => {
                let b = match b {
                    Some(b) => b,
                    None => self.zero(part),
                };
                let d = match d {
                    Some(d) => d,
                    None => self.zero(part),
                };
                let (compare, combine) = if op == BinOp::Eq {
                    (CBin::Eq, CBin::And)
                } else {
                    (CBin::Ne, CBin::Or)
                };
                let re = self.b.bin(compare, a, c);
                let im = self.b.bin(compare, b, d);
                return Ok(self.b.bin(combine, re, im));
            }
            _ => return internal(loc, "unsupported complex operation"),
        };
        // C11 G.5.1: where both parts come out as NaNs there may be an infinity or a zero that
        // the operands stand for, which a function of the compiler's works out. (A real operand
        // needs none of it: the parts were multiplied or divided by it one by one.)
        let recovery = match (op, a_im, c_im) {
            (BinOp::Mul, Some(b), Some(d)) => Some((0, b, d)),
            (BinOp::Div, b, Some(d)) => Some((
                1,
                match b {
                    Some(b) => b,
                    None => self.zero(part),
                },
                d,
            )),
            _ => None,
        };
        let (Some((which, b, d)), Some(functions)) = (recovery, self.m.prog.complex_recovery)
        else {
            return Ok(self.make_pair(ty, re, im));
        };
        let function = functions[which + if part == Ty::F32 { 0 } else { 2 }];
        let Some(index) = self.m.func_index[function as usize] else {
            return internal(loc, "the functions for complex infinities are not there");
        };
        let size = self.tcx.size_of(ty).unwrap_or(16);
        let slot = self.temporary_slot_id(size, size / 2);
        let result = self.b.def(Inst::SlotAddr(slot), Ty::I64);
        self.store_pair(result, ty, re, im);
        let re_is_nan = self.b.bin(CBin::Ne, re, re);
        let im_is_nan = self.b.bin(CBin::Ne, im, im);
        let both = self.b.bin(CBin::And, re_is_nan, im_is_nan);
        let held = [a, b, c, d].map(|v| self.hold(v, true));
        let (slow, done) = (self.b.new_block(), self.b.new_block());
        self.b.terminate(Inst::Br(both, slow, done));
        self.b.switch_to(slow);
        let operands = held.map(|h| self.release(h));
        let part_ty = if part == Ty::F32 {
            Type::Float
        } else {
            Type::Double
        };
        let types = [part_ty.clone(), part_ty.clone(), part_ty.clone(), part_ty];
        let recovered = self.emit_call(
            Callee::Func(index),
            ty,
            &types,
            4,
            super::Arity::Fixed,
            super::SignatureOf::Callee,
            &operands,
            loc,
        )?;
        let Some(recovered) = recovered else {
            return internal(loc, "a complex result was expected");
        };
        let Halves { low, high } = self.load_pair(recovered, ty);
        let result_here = self.b.def(Inst::SlotAddr(slot), Ty::I64);
        self.store_pair(result_here, ty, low, high);
        self.b.terminate(Inst::Jump(done));
        self.b.switch_to(done);
        Ok(self.b.def(Inst::SlotAddr(slot), Ty::I64))
    }

    /// `(a + bi) / (c + di)` on doubles. `scaled`: by Smith's method, which divides by the
    /// larger of `c` and `d` first so that nothing in between is squared.
    fn complex_quotient(&mut self, a: V, b: V, c: V, d: V, scaled: bool) -> (V, V) {
        if !scaled {
            let cc = self.b.bin(CBin::Mul, c, c);
            let dd = self.b.bin(CBin::Mul, d, d);
            let scale = self.b.bin(CBin::Add, cc, dd);
            let ac = self.b.bin(CBin::Mul, a, c);
            let bd = self.b.bin(CBin::Mul, b, d);
            let bc = self.b.bin(CBin::Mul, b, c);
            let ad = self.b.bin(CBin::Mul, a, d);
            let re = self.b.bin(CBin::Add, ac, bd);
            let im = self.b.bin(CBin::Sub, bc, ad);
            return (
                self.b.bin(CBin::Div, re, scale),
                self.b.bin(CBin::Div, im, scale),
            );
        }
        // |c| >= |d|, on the bits without their signs.
        let magnitude = |this: &mut Self, v: V| {
            let bits = this.b.conv(ConvOp::Bitcast, Ty::I64, v);
            let mask = this.b.const_i64(i64::MAX);
            this.b.bin(CBin::And, bits, mask)
        };
        let (mc, md) = (magnitude(self, c), magnitude(self, d));
        let c_is_larger = self.b.bin(CBin::UGe, mc, md);
        let larger = self.b.def(Inst::Select(c_is_larger, c, d), Ty::F64);
        let smaller = self.b.def(Inst::Select(c_is_larger, d, c), Ty::F64);
        let ratio = self.b.bin(CBin::Div, smaller, larger);
        let scaled_smaller = self.b.bin(CBin::Mul, smaller, ratio);
        let denominator = self.b.bin(CBin::Add, larger, scaled_smaller);
        let ar = self.b.bin(CBin::Mul, a, ratio);
        let br = self.b.bin(CBin::Mul, b, ratio);
        // c larger: (a + b r, b - a r); d larger: (a r + b, b r - a).
        let re_c = self.b.bin(CBin::Add, a, br);
        let re_d = self.b.bin(CBin::Add, ar, b);
        let im_c = self.b.bin(CBin::Sub, b, ar);
        let im_d = self.b.bin(CBin::Sub, br, a);
        let re = self.b.def(Inst::Select(c_is_larger, re_c, re_d), Ty::F64);
        let im = self.b.def(Inst::Select(c_is_larger, im_c, im_d), Ty::F64);
        (
            self.b.bin(CBin::Div, re, denominator),
            self.b.bin(CBin::Div, im, denominator),
        )
    }

    /// `-x`, or `~x` (bitwise not of an integer, conjugate of a complex number).
    pub(super) fn gen_pair_unary(
        &mut self,
        negate: bool,
        ty: &Type,
        address: V,
        loc: Loc,
    ) -> Res<V> {
        let Halves {
            low: first,
            high: second,
        } = self.load_pair(address, ty);
        if ty.is_complex() {
            let im = self.b.un(UnOp::Neg, second);
            let re = if negate {
                self.b.un(UnOp::Neg, first)
            } else {
                first
            };
            return Ok(self.make_pair(ty, re, im));
        }
        if negate {
            let zero = self.pair_literal(ty, 0);
            return self.gen_pair_binary(BinOp::Sub, ty, zero, address, loc);
        }
        let ones = self.b.const_i64(-1);
        let low = self.b.bin(CBin::Xor, first, ones);
        let high = self.b.bin(CBin::Xor, second, ones);
        Ok(self.make_pair(ty, low, high))
    }

    /// A conversion in which `from` or `to` is a pair type.
    pub(super) fn gen_pair_convert(&mut self, v: V, from: &Type, to: &Type, loc: Loc) -> Res<V> {
        if from == to || (from.is_int128() && to.is_int128()) {
            return Ok(v);
        }
        match (from.is_pair(), to.is_pair()) {
            // complex <-> complex precision.
            (true, true) if from.is_complex() && to.is_complex() => {
                let Halves { low: re, high: im } = self.load_pair(v, from);
                let op = if matches!(to, Type::ComplexDouble) {
                    UnOp::FPromote
                } else {
                    UnOp::FDemote
                };
                let (re, im) = (self.b.un(op, re), self.b.un(op, im));
                Ok(self.make_pair(to, re, im))
            }
            (true, true) => internal(
                loc,
                "conversion between a 128-bit integer and a complex number",
            ),
            (true, false) if from.is_int128() => {
                if matches!(to, Type::Bool) {
                    return Ok(self.pair_truth(v, from));
                }
                if to.is_float() {
                    let signed = self.tcx.is_signed(from);
                    let name = match (to, signed) {
                        (Type::Float, true) => "__floattisf",
                        (Type::Float, false) => "__floatuntisf",
                        (_, true) => "__floattidf",
                        (_, false) => "__floatuntidf",
                    };
                    return self.runtime_call(name, to, &[(v, from.clone())], loc);
                }
                let low = self.b.load(MemKind::I64, v, 0);
                self.convert(low, &Type::ULLong, to, loc)
            }
            (true, false) => {
                // The sema only asks for the real part of a complex number through
                // `ComplexPart`, and for its truth through a comparison.
                internal(loc, "direct conversion from a complex number")
            }
            (false, true) if to.is_int128() => {
                if from.is_float() {
                    let signed = self.tcx.is_signed(to);
                    let name = match (from, signed) {
                        (Type::Float, true) => "__fixsfti",
                        (Type::Float, false) => "__fixunssfti",
                        (_, true) => "__fixdfti",
                        (_, false) => "__fixunsdfti",
                    };
                    return self.runtime_call(name, to, &[(v, from.clone())], loc);
                }
                let signed = self.tcx.is_signed(from) && !from.is_ptr();
                let wide = if signed { Type::LLong } else { Type::ULLong };
                let low = self.convert(v, from, &wide, loc)?;
                let high = if signed {
                    let c63 = self.b.const_i32(63);
                    self.b.bin(CBin::ShrS, low, c63)
                } else {
                    self.b.const_i64(0)
                };
                Ok(self.make_pair(to, low, high))
            }
            _ => internal(
                loc,
                "conversion to a complex number that is not a ComplexMake",
            ),
        }
    }

    /// `__real__ z` / `__imag__ z` of a complex value at `address`.
    pub(super) fn complex_part_offset(ty: &Type, imag: bool) -> i64 {
        if imag { Self::pair_layout(ty).1 } else { 0 }
    }

    pub(super) fn gen_complex_make(&mut self, e: &Expr, re: &Expr, im: &Expr) -> Res<V> {
        let first = self.gen_value(re)?;
        let held = self.hold(first, im.has_control_flow);
        let second = self.gen_value(im)?;
        let first = self.release(held);
        Ok(self.make_pair(&e.ty, first, second))
    }
}
