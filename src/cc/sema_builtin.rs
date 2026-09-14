//! Builtins that expand to ordinary expressions over unnamed locals: checked arithmetic,
//! rotates, `ffs`, and the ones that only look at their operands.

use super::Sema;
use crate::ast::*;
use crate::token::{Loc, Res, err};
use crate::types::Type;

/// Whether `a` and `b` are the same expression, one without side effects that reads no
/// volatile object: evaluating it once is as good as twice.
pub(crate) fn same_pure(a: &Expr, b: &Expr) -> bool {
    if a.ty != b.ty || a.ty.is_volatile() || a.ty.is_atomic() {
        return false;
    }
    match (&a.kind, &b.kind) {
        (ExprKind::IntLit(x), ExprKind::IntLit(y)) => x == y,
        (ExprKind::Local(x), ExprKind::Local(y)) => x == y,
        (ExprKind::Global(x), ExprKind::Global(y)) => x == y,
        (ExprKind::Member(p, x), ExprKind::Member(q, y)) => x == y && same_pure(p, q),
        (ExprKind::Cast(p), ExprKind::Cast(q))
        | (ExprKind::Neg(p), ExprKind::Neg(q))
        | (ExprKind::BitNot(p), ExprKind::BitNot(q))
        | (ExprKind::Deref(p), ExprKind::Deref(q))
        | (ExprKind::Decay(p), ExprKind::Decay(q)) => same_pure(p, q),
        (ExprKind::Binary(o, p1, p2), ExprKind::Binary(r, q1, q2)) => {
            o == r && same_pure(p1, q1) && same_pure(p2, q2)
        }
        (
            ExprKind::PtrAdd {
                ptr: p1,
                index: p2,
                scale: s,
                sub: u,
            },
            ExprKind::PtrAdd {
                ptr: q1,
                index: q2,
                scale: t,
                sub: v,
            },
        ) => s == t && u == v && same_pure(p1, q1) && same_pure(p2, q2),
        _ => false,
    }
}

/// Which floating type a builtin that has one spelling per type is for.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Precision {
    Single,
    Double,
}

/// Where the sign of the result comes from: nowhere (`fabs`: it is cleared) or the second
/// argument (`copysign`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SignFrom {
    Nowhere,
    SecondArgument,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum OverflowOp {
    Add,
    Sub,
    Mul,
}

/// An unnamed local.
struct Temp {
    local: LocalId,
    ty: Type,
}

impl Sema {
    /// An unnamed local, and the expression that gives it `value`.
    fn temp(&mut self, value: Expr, loc: Loc) -> Res<(Temp, Expr)> {
        let ty = value.ty.clone();
        let local = self.new_local(ty.clone());
        let target = self.mk(ExprKind::Local(local), ty.clone(), loc)?;
        let store = self.mk(
            ExprKind::Assign(Box::new(target), Box::new(value)),
            ty.clone(),
            loc,
        )?;
        Ok((Temp { local, ty }, store))
    }

    fn read(&self, temp: &Temp, loc: Loc) -> Res<Expr> {
        let place = self.mk(ExprKind::Local(temp.local), temp.ty.clone(), loc)?;
        self.rvalue(place)
    }

    fn needs_function(&self, name: &str, loc: Loc) -> Res<()> {
        if self.func.is_none() {
            return err(loc, format!("{name} is only supported inside functions"));
        }
        Ok(())
    }

    fn bits_of(&self, ty: &Type) -> u64 {
        self.tcx.size_of(ty).unwrap_or(0) * 8
    }

    /// `__builtin_{add,sub,mul}_overflow(a, b, &result)` and the variants with a fixed type:
    /// the operation is done in infinite precision, the result is stored wrapped to the type
    /// `result` points to, and the value says whether it did not fit.
    pub(crate) fn overflow_builtin(
        &mut self,
        op: OverflowOp,
        fixed: Option<&Type>,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        self.needs_function(name, loc)?;
        if args.len() != 3 {
            return err(loc, format!("{name} takes three arguments"));
        }
        let out = args.swap_remove(2);
        let b = args.swap_remove(1);
        let a = args.swap_remove(0);
        let (mut a, mut b, out) = (self.rvalue(a)?, self.rvalue(b)?, self.rvalue(out)?);
        if let Some(ty) = fixed {
            a = self.assign_convert(a, ty, loc, "passing an argument")?;
            b = self.assign_convert(b, ty, loc, "passing an argument")?;
        }
        let result_ty = match out.ty.pointee() {
            Some(pointee) => pointee.unatomic().clone(),
            None => return err(loc, format!("the last operand of {name} must be a pointer")),
        };
        for ty in [&a.ty, &b.ty, &result_ty] {
            if !ty.is_integer() || ty.is_int128() || *ty == Type::Bool {
                return err(
                    loc,
                    format!(
                        "{name} needs integer operands of at most 64 bits, not '{}'",
                        self.tcx.display(ty)
                    ),
                );
            }
        }
        let (a, b) = (self.promote(a)?, self.promote(b)?);
        let (a_signed, b_signed) = (self.tcx.is_signed(&a.ty), self.tcx.is_signed(&b.ty));
        let result_signed = self.tcx.is_signed(&result_ty);
        let same_wide = a.ty == b.ty && a.ty == result_ty && self.bits_of(&result_ty) == 64;
        let (ta, store_a) = self.temp(a, loc)?;
        let (tb, store_b) = self.temp(b, loc)?;
        let (tout, store_out) = self.temp(out, loc)?;

        let (compute, overflowed) = if same_wide {
            self.overflow_same_type(op, &ta, &tb, &tout, result_signed, loc)?
        } else {
            // A type that holds the exact result and every value of the result type.
            let narrow_operands = self.bits_of(&ta.ty) <= 32 && self.bits_of(&tb.ty) <= 32;
            let both_unsigned = !a_signed && !b_signed;
            let wide = if narrow_operands
                && (self.bits_of(&result_ty) <= 32 || result_signed)
                && !(op == OverflowOp::Mul && both_unsigned)
            {
                Type::LLong
            } else if op == OverflowOp::Mul && both_unsigned {
                Type::UInt128
            } else {
                Type::Int128
            };
            let x = self.read(&ta, loc)?;
            let x = self.convert(x, &wide, loc)?;
            let y = self.read(&tb, loc)?;
            let y = self.convert(y, &wide, loc)?;
            let exact = self.binary(Self::overflow_binop(op), x, y, loc)?;
            let (texact, store_exact) = self.temp(exact, loc)?;
            let wrapped = self.read(&texact, loc)?;
            let wrapped = self.convert(wrapped, &result_ty, loc)?;
            let pointer = self.read(&tout, loc)?;
            let target = self.deref(pointer, loc)?;
            let stored = self.assign(target, wrapped, loc)?;
            let back = self.convert(stored, &wide, loc)?;
            let exact = self.read(&texact, loc)?;
            let overflowed = self.binary(BinOp::Ne, back, exact, loc)?;
            (store_exact, overflowed)
        };
        let overflowed = self.convert(overflowed, &Type::Bool, loc)?;
        let mut e = self.comma(compute, overflowed, loc)?;
        for store in [store_out, store_b, store_a] {
            e = self.comma(store, e, loc)?;
        }
        Ok(e)
    }

    fn overflow_binop(op: OverflowOp) -> BinOp {
        match op {
            OverflowOp::Add => BinOp::Add,
            OverflowOp::Sub => BinOp::Sub,
            OverflowOp::Mul => BinOp::Mul,
        }
    }

    /// Both operands and the result have the same 64-bit type. Returns the expression that
    /// stores the result, and the overflow test (to be evaluated after it).
    fn overflow_same_type(
        &mut self,
        op: OverflowOp,
        ta: &Temp,
        tb: &Temp,
        tout: &Temp,
        signed: bool,
        loc: Loc,
    ) -> Res<(Expr, Expr)> {
        let ty = ta.ty.clone();
        let unsigned = if signed {
            match ty {
                Type::Long => Type::ULong,
                _ => Type::ULLong,
            }
        } else {
            ty.clone()
        };
        // The wrapped result, computed without signed overflow.
        let x = self.read(ta, loc)?;
        let x = self.convert(x, &unsigned, loc)?;
        let y = self.read(tb, loc)?;
        let y = self.convert(y, &unsigned, loc)?;
        let wrapped = self.binary(Self::overflow_binop(op), x, y, loc)?;
        let wrapped = self.convert(wrapped, &ty, loc)?;
        let (tresult, store_result) = self.temp(wrapped, loc)?;
        let pointer = self.read(tout, loc)?;
        let target = self.deref(pointer, loc)?;
        let value = self.read(&tresult, loc)?;
        let stored = self.assign(target, value, loc)?;
        let compute = self.comma(store_result, stored, loc)?;

        let (a, b, r) = (
            self.read(ta, loc)?,
            self.read(tb, loc)?,
            self.read(&tresult, loc)?,
        );
        let zero = self.int_lit(0, ty.clone(), loc)?;
        let overflowed = match (op, signed) {
            (OverflowOp::Add, false) => self.binary(BinOp::Lt, r, a, loc)?,
            (OverflowOp::Sub, false) => self.binary(BinOp::Lt, a, b, loc)?,
            (OverflowOp::Add, true) => {
                // The operands have the same sign and the result has the other one.
                let r2 = self.read(&tresult, loc)?;
                let left = self.binary(BinOp::Xor, a, r, loc)?;
                let right = self.binary(BinOp::Xor, b, r2, loc)?;
                let both = self.binary(BinOp::And, left, right, loc)?;
                self.binary(BinOp::Lt, both, zero, loc)?
            }
            (OverflowOp::Sub, true) => {
                // The operands have different signs and the result has the sign of `b`.
                let a2 = self.read(ta, loc)?;
                let left = self.binary(BinOp::Xor, a, b, loc)?;
                let right = self.binary(BinOp::Xor, a2, r, loc)?;
                let both = self.binary(BinOp::And, left, right, loc)?;
                self.binary(BinOp::Lt, both, zero, loc)?
            }
            (OverflowOp::Mul, _) => {
                // The high half of the full product must be the sign extension of the low.
                let high = self.mk(ExprKind::Intrinsic(Intrinsic::MulHigh, vec![a, b]), ty, loc)?;
                let expected = if signed {
                    let shift = self.int_lit(63, Type::Int, loc)?;
                    self.binary(BinOp::Shr, r, shift, loc)?
                } else {
                    zero
                };
                self.binary(BinOp::Ne, high, expected, loc)?
            }
        };
        Ok((compute, overflowed))
    }

    /// `__builtin_rotate{left,right}{8,16,32,64}(x, n)`.
    pub(crate) fn rotate_builtin(
        &mut self,
        left: bool,
        bits: u32,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        self.needs_function(name, loc)?;
        if args.len() != 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        let ty = match bits {
            8 => Type::UChar,
            16 => Type::UShort,
            32 => Type::UInt,
            _ => Type::ULLong,
        };
        let n = args.swap_remove(1);
        let x = args.swap_remove(0);
        if bits >= 32 {
            let x = self.assign_convert(x, &ty, loc, "passing an argument")?;
            let n = self.rvalue(n)?;
            if !n.ty.is_integer() {
                return err(loc, format!("{name} needs an integer count"));
            }
            let n = self.convert(n, &Type::Int, loc)?;
            let op = if left {
                Intrinsic::RotL
            } else {
                Intrinsic::RotR
            };
            return self.mk(ExprKind::Intrinsic(op, vec![x, n]), ty, loc);
        }
        // Narrow values rotate inside a 32-bit one.
        let work = if bits < 32 { Type::UInt } else { ty.clone() };
        let x = self.assign_convert(x, &ty, loc, "passing an argument")?;
        let x = self.convert(x, &work, loc)?;
        let n = self.assign_convert(n, &ty, loc, "passing an argument")?;
        let n = self.convert(n, &Type::UInt, loc)?;
        let mask = self.int_lit(i64::from(bits - 1), Type::UInt, loc)?;
        let n = self.binary(BinOp::And, n, mask, loc)?;
        let (tx, store_x) = self.temp(x, loc)?;
        let (tn, store_n) = self.temp(n, loc)?;
        // `towards` is the named direction; the other shift brings in the bits that fell off.
        let count = self.read(&tn, loc)?;
        let other = if bits < 32 {
            let width = self.int_lit(i64::from(bits), Type::UInt, loc)?;
            self.binary(BinOp::Sub, width, count, loc)?
        } else {
            let zero = self.int_lit(0, Type::UInt, loc)?;
            let negated = self.binary(BinOp::Sub, zero, count, loc)?;
            let mask = self.int_lit(i64::from(bits - 1), Type::UInt, loc)?;
            self.binary(BinOp::And, negated, mask, loc)?
        };
        let (towards, away) = if left {
            (BinOp::Shl, BinOp::Shr)
        } else {
            (BinOp::Shr, BinOp::Shl)
        };
        let x1 = self.read(&tx, loc)?;
        let n1 = self.read(&tn, loc)?;
        let first = self.binary(towards, x1, n1, loc)?;
        let x2 = self.read(&tx, loc)?;
        let second = self.binary(away, x2, other, loc)?;
        let rotated = self.binary(BinOp::Or, first, second, loc)?;
        let rotated = self.convert(rotated, &ty, loc)?;
        let e = self.comma(store_n, rotated, loc)?;
        self.comma(store_x, e, loc)
    }

    /// `(x << n) | (x >> (W - n))` and `(x << (n & (W-1))) | (x >> (-n & (W-1)))` for an
    /// unsigned 32- or 64-bit `x`, and their mirror images: a rotation. `a` and `b` are the
    /// converted operands of `|`, `+` or `^` (all the same when no bit is in both).
    pub(crate) fn rotation(&self, a: &Expr, b: &Expr, loc: Loc) -> Option<Expr> {
        let (ExprKind::Binary(op_a, xa, na), ExprKind::Binary(op_b, xb, nb)) = (&a.kind, &b.kind)
        else {
            return None;
        };
        let (x, left_count, right_count) = match (op_a, op_b) {
            (BinOp::Shl, BinOp::Shr) => (xa, na, nb),
            (BinOp::Shr, BinOp::Shl) => (xa, nb, na),
            _ => return None,
        };
        let ty = a.ty.unqualified();
        let bits = match self.tcx.size_of(ty)? {
            4 => 32,
            8 => 64,
            _ => return None,
        };
        if !ty.is_integer()
            || self.tcx.is_signed(ty)
            || *ty != *b.ty.unqualified()
            || *xa.ty.unqualified() != *ty
            || *xb.ty.unqualified() != *ty
            || !same_pure(xa, xb)
        {
            return None;
        }
        // Conversions between integer types keep the bits of the count that matter.
        fn bare(mut e: &Expr) -> &Expr {
            while let ExprKind::Cast(inner) = &e.kind {
                if !e.ty.is_integer() || !inner.ty.is_integer() || matches!(e.ty, Type::Bool) {
                    break;
                }
                e = inner;
            }
            e
        }
        let is = |e: &Expr, value: i64| matches!(crate::constexpr::eval(bare(e), &self.tcx), Ok(crate::constexpr::Const::Int(v)) if v == value);
        // `count & (W-1)`, either way round: the count.
        let masked = |e: &Expr| -> Option<Expr> {
            let ExprKind::Binary(BinOp::And, p, q) = &bare(e).kind else {
                return None;
            };
            if is(q, bits - 1) {
                Some((**p).clone())
            } else if is(p, bits - 1) {
                Some((**q).clone())
            } else {
                None
            }
        };
        // `W - count`, `-count` or `0 - count`: the count.
        let complement = |e: &Expr, plain_width_only: bool| -> Option<Expr> {
            match &bare(e).kind {
                ExprKind::Binary(BinOp::Sub, p, q) if is(p, bits) => Some((**q).clone()),
                ExprKind::Binary(BinOp::Sub, p, q) if !plain_width_only && is(p, 0) => {
                    Some((**q).clone())
                }
                ExprKind::Neg(q) if !plain_width_only => Some((**q).clone()),
                _ => None,
            }
        };
        let same = |p: &Expr, q: &Expr| same_pure(bare(p), bare(q));
        // Two constants that add up to the width.
        let constant = |e: &Expr| match crate::constexpr::eval(bare(e), &self.tcx) {
            Ok(crate::constexpr::Const::Int(v)) => Some(v),
            _ => None,
        };
        if let (Some(l), Some(r)) = (constant(left_count), constant(right_count)) {
            if l > 0 && r > 0 && l + r == bits {
                return self
                    .mk(
                        ExprKind::Intrinsic(
                            Intrinsic::RotL,
                            vec![(**x).clone(), (**left_count).clone()],
                        ),
                        a.ty.clone(),
                        loc,
                    )
                    .ok();
            }
            return None;
        }
        // (count as written, rotates left)
        let found: Option<(&Expr, bool)> =
            if complement(right_count, true).is_some_and(|n| same(&n, left_count)) {
                Some((left_count, true))
            } else if complement(left_count, true).is_some_and(|n| same(&n, right_count)) {
                Some((right_count, false))
            } else {
                match (masked(left_count), masked(right_count)) {
                    (Some(l), Some(r)) if complement(&r, false).is_some_and(|n| same(&n, &l)) => {
                        Some((left_count, true))
                    }
                    (Some(l), Some(r)) if complement(&l, false).is_some_and(|n| same(&n, &r)) => {
                        Some((right_count, false))
                    }
                    _ => None,
                }
            };
        let (count, left) = found?;
        let op = if left {
            Intrinsic::RotL
        } else {
            Intrinsic::RotR
        };
        self.mk(
            ExprKind::Intrinsic(op, vec![(**x).clone(), count.clone()]),
            a.ty.clone(),
            loc,
        )
        .ok()
    }

    /// `__builtin_ffs{,l,ll}(x)`: one plus the index of the lowest set bit, or zero.
    pub(crate) fn ffs_builtin(
        &mut self,
        ty: &Type,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        self.needs_function(name, loc)?;
        if args.len() != 1 {
            return err(loc, format!("{name} takes one argument"));
        }
        let x = self.assign_convert(args.swap_remove(0), ty, loc, "passing an argument")?;
        let (tx, store_x) = self.temp(x, loc)?;
        let test = self.read(&tx, loc)?;
        let operand = self.read(&tx, loc)?;
        let index = self.mk(
            ExprKind::Intrinsic(Intrinsic::Ctz, vec![operand]),
            Type::Int,
            loc,
        )?;
        let one = self.int_lit(1, Type::Int, loc)?;
        let found = self.binary(BinOp::Add, index, one, loc)?;
        let zero = self.int_lit(0, Type::Int, loc)?;
        let chosen = self.conditional(test, found, zero, loc)?;
        self.comma(store_x, chosen, loc)
    }

    /// The floating operand of a classification builtin: `float` stays, anything else
    /// arithmetic becomes `double`. Returns it with the unsigned type of the same size.
    fn float_operand(&self, e: Expr, name: &str, loc: Loc) -> Res<(Expr, Type)> {
        if matches!(e.ty, Type::Float) {
            return Ok((e, Type::UInt));
        }
        if !e.ty.is_arith() || e.ty.is_pair() {
            return err(
                loc,
                format!(
                    "{name} needs a floating operand, not '{}'",
                    self.tcx.display(&e.ty)
                ),
            );
        }
        let e = self.convert(e, &Type::Double, loc)?;
        Ok((e, Type::ULLong))
    }

    fn bits_of_float(&self, e: Expr, bits_ty: &Type, loc: Loc) -> Res<Expr> {
        self.mk(
            ExprKind::Intrinsic(Intrinsic::Bitcast, vec![e]),
            bits_ty.clone(),
            loc,
        )
    }

    /// `__builtin_isnan`, `isinf`, `isinf_sign`, `isfinite`, `isnormal`, `signbit`: tests on
    /// the bits of the operand, which is evaluated once.
    pub(crate) fn classify_builtin(
        &mut self,
        which: &str,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        self.needs_function(name, loc)?;
        if args.len() != 1 {
            return err(loc, format!("{name} takes one argument"));
        }
        let x = self.rvalue(args.swap_remove(0))?;
        if x.ty.is_long_double() {
            return self.classify_long_double(which, x, loc);
        }
        let (x, bits_ty) = self.float_operand(x, name, loc)?;
        let single = bits_ty == Type::UInt;
        let (sign, infinity, smallest_normal): (u64, u64, u64) = if single {
            (0x8000_0000, 0x7f80_0000, 0x0080_0000)
        } else {
            (1 << 63, 0x7ff0_0000_0000_0000, 0x0010_0000_0000_0000)
        };
        let bits = self.bits_of_float(x, &bits_ty, loc)?;
        let (tbits, store) = self.temp(bits, loc)?;
        let constant = |sema: &Sema, v: u64| sema.int_lit(v as i64, bits_ty.clone(), loc);
        let magnitude = |sema: &mut Sema| -> Res<Expr> {
            let all = sema.read(&tbits, loc)?;
            let mask = constant(sema, sign - 1)?;
            sema.binary(BinOp::And, all, mask, loc)
        };
        let infinity_bits = constant(self, infinity)?;
        let test = match which {
            "isnan" => {
                let m = magnitude(self)?;
                self.binary(BinOp::Gt, m, infinity_bits, loc)?
            }
            "isinf" => {
                let m = magnitude(self)?;
                self.binary(BinOp::Eq, m, infinity_bits, loc)?
            }
            "isfinite" => {
                let m = magnitude(self)?;
                self.binary(BinOp::Lt, m, infinity_bits, loc)?
            }
            "isnormal" => {
                let m = magnitude(self)?;
                let low = constant(self, smallest_normal)?;
                let above = self.binary(BinOp::Ge, m, low, loc)?;
                let m = magnitude(self)?;
                let below = self.binary(BinOp::Lt, m, infinity_bits, loc)?;
                self.logical(true, above, below, loc)?
            }
            "signbit" => {
                let all = self.read(&tbits, loc)?;
                let mask = constant(self, sign)?;
                let bit = self.binary(BinOp::And, all, mask, loc)?;
                let zero = constant(self, 0)?;
                self.binary(BinOp::Ne, bit, zero, loc)?
            }
            // 1 for +inf, -1 for -inf, 0 otherwise.
            _ => {
                let m = magnitude(self)?;
                let is_infinite = self.binary(BinOp::Eq, m, infinity_bits, loc)?;
                let all = self.read(&tbits, loc)?;
                let mask = constant(self, sign)?;
                let bit = self.binary(BinOp::And, all, mask, loc)?;
                let zero = constant(self, 0)?;
                let negative = self.binary(BinOp::Ne, bit, zero, loc)?;
                let minus = self.int_lit(-1, Type::Int, loc)?;
                let plus = self.int_lit(1, Type::Int, loc)?;
                let signed = self.conditional(negative, minus, plus, loc)?;
                let none = self.int_lit(0, Type::Int, loc)?;
                self.conditional(is_infinite, signed, none, loc)?
            }
        };
        self.comma(store, test, loc)
    }

    /// `__builtin_fpclassify(nan, infinite, normal, subnormal, zero, x)`.
    pub(crate) fn fpclassify_builtin(
        &mut self,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        self.needs_function(name, loc)?;
        if args.len() != 6 {
            return err(loc, format!("{name} takes six arguments"));
        }
        let x = self.rvalue(args.swap_remove(5))?;
        if x.ty.is_long_double() {
            let (tx, store) = self.temp(x, loc)?;
            let mut classes = Vec::with_capacity(5);
            for class in args {
                classes.push(self.assign_convert(class, &Type::Int, loc, "passing an argument")?);
            }
            let [nan, infinite, normal, subnormal, zero]: [Expr; 5] = match classes.try_into() {
                Ok(classes) => classes,
                Err(_) => return err(loc, "missing argument"),
            };
            let no_exponent = self.long_double_exponent_is(&tx, BinOp::Eq, 0, loc)?;
            let no_significand = self.long_double_fraction_is_zero(&tx, false, loc)?;
            let is_zero = self.logical(true, no_exponent, no_significand, loc)?;
            let is_subnormal = self.long_double_exponent_is(&tx, BinOp::Eq, 0, loc)?;
            let is_normal = self.long_double_exponent_is(&tx, BinOp::Ne, 0x7fff, loc)?;
            let is_infinite = self.long_double_fraction_is_zero(&tx, true, loc)?;
            let tail = self.conditional(is_infinite, infinite, nan, loc)?;
            let tail = self.conditional(is_normal, normal, tail, loc)?;
            let tail = self.conditional(is_subnormal, subnormal, tail, loc)?;
            let chosen = self.conditional(is_zero, zero, tail, loc)?;
            return self.comma(store, chosen, loc);
        }
        let (x, bits_ty) = self.float_operand(x, name, loc)?;
        let single = bits_ty == Type::UInt;
        let (sign, infinity, smallest_normal): (u64, u64, u64) = if single {
            (0x8000_0000, 0x7f80_0000, 0x0080_0000)
        } else {
            (1 << 63, 0x7ff0_0000_0000_0000, 0x0010_0000_0000_0000)
        };
        let bits = self.bits_of_float(x, &bits_ty, loc)?;
        let mask = self.int_lit((sign - 1) as i64, bits_ty.clone(), loc)?;
        let magnitude = self.binary(BinOp::And, bits, mask, loc)?;
        let (tm, store) = self.temp(magnitude, loc)?;
        let mut classes = args.into_iter();
        let mut next = |sema: &Sema| -> Res<Expr> {
            match classes.next() {
                Some(e) => sema.assign_convert(e, &Type::Int, loc, "passing an argument"),
                None => err(loc, "missing argument"),
            }
        };
        let (nan, infinite, normal, subnormal, zero) = (
            next(self)?,
            next(self)?,
            next(self)?,
            next(self)?,
            next(self)?,
        );
        let compare = |sema: &mut Sema, op: BinOp, to: u64| -> Res<Expr> {
            let m = sema.read(&tm, loc)?;
            let k = sema.int_lit(to as i64, bits_ty.clone(), loc)?;
            sema.binary(op, m, k, loc)
        };
        let is_zero = compare(self, BinOp::Eq, 0)?;
        let is_subnormal = compare(self, BinOp::Lt, smallest_normal)?;
        let is_normal = compare(self, BinOp::Lt, infinity)?;
        let is_infinite = compare(self, BinOp::Eq, infinity)?;
        let tail = self.conditional(is_infinite, infinite, nan, loc)?;
        let tail = self.conditional(is_normal, normal, tail, loc)?;
        let tail = self.conditional(is_subnormal, subnormal, tail, loc)?;
        let chosen = self.conditional(is_zero, zero, tail, loc)?;
        self.comma(store, chosen, loc)
    }

    /// The 16 bits of the `long double` variable `temp` that hold its sign and exponent, as an
    /// lvalue.
    fn long_double_sign_exponent(&self, temp: &Temp, loc: Loc) -> Res<Expr> {
        let object = self.mk(ExprKind::Local(temp.local), temp.ty.clone(), loc)?;
        self.mk(ExprKind::Member(Box::new(object), 8), Type::UShort, loc)
    }

    /// Its exponent field compared with `value`.
    fn long_double_exponent_is(&self, temp: &Temp, op: BinOp, value: i64, loc: Loc) -> Res<Expr> {
        let word = self.long_double_sign_exponent(temp, loc)?;
        let mask = self.int_lit(0x7fff, Type::Int, loc)?;
        let exponent = self.binary(BinOp::And, word, mask, loc)?;
        let value = self.int_lit(value, Type::Int, loc)?;
        self.binary(op, exponent, value, loc)
    }

    /// Whether its significand is zero, with or without the explicit integer bit.
    fn long_double_fraction_is_zero(
        &self,
        temp: &Temp,
        below_integer_bit: bool,
        loc: Loc,
    ) -> Res<Expr> {
        let object = self.mk(ExprKind::Local(temp.local), temp.ty.clone(), loc)?;
        let significand = self.mk(ExprKind::Member(Box::new(object), 0), Type::ULLong, loc)?;
        let significand = if below_integer_bit {
            let one = self.int_lit(1, Type::Int, loc)?;
            self.binary(BinOp::Shl, significand, one, loc)?
        } else {
            self.rvalue(significand)?
        };
        let zero = self.int_lit(0, Type::ULLong, loc)?;
        self.binary(BinOp::Eq, significand, zero, loc)
    }

    /// The classification builtins on an x87 `long double`, whose bits are in memory anyway.
    fn classify_long_double(&mut self, which: &str, x: Expr, loc: Loc) -> Res<Expr> {
        let (tx, store) = self.temp(x, loc)?;
        let negative = |sema: &Sema| -> Res<Expr> {
            let word = sema.long_double_sign_exponent(&tx, loc)?;
            let mask = sema.int_lit(0x8000, Type::Int, loc)?;
            let bit = sema.binary(BinOp::And, word, mask, loc)?;
            let zero = sema.int_lit(0, Type::Int, loc)?;
            sema.binary(BinOp::Ne, bit, zero, loc)
        };
        let all_ones = self.long_double_exponent_is(&tx, BinOp::Eq, 0x7fff, loc)?;
        let test = match which {
            "isnan" => {
                let infinite = self.long_double_fraction_is_zero(&tx, true, loc)?;
                let not_infinite = self.log_not(infinite, loc)?;
                self.logical(true, all_ones, not_infinite, loc)?
            }
            "isinf" => {
                let infinite = self.long_double_fraction_is_zero(&tx, true, loc)?;
                self.logical(true, all_ones, infinite, loc)?
            }
            "isfinite" => self.log_not(all_ones, loc)?,
            "isnormal" => {
                let some = self.long_double_exponent_is(&tx, BinOp::Ne, 0, loc)?;
                let not_all = self.log_not(all_ones, loc)?;
                self.logical(true, some, not_all, loc)?
            }
            "signbit" => negative(self)?,
            // 1 for +inf, -1 for -inf, 0 otherwise.
            _ => {
                let fraction = self.long_double_fraction_is_zero(&tx, true, loc)?;
                let is_infinite = self.logical(true, all_ones, fraction, loc)?;
                let negative = negative(self)?;
                let minus = self.int_lit(-1, Type::Int, loc)?;
                let plus = self.int_lit(1, Type::Int, loc)?;
                let signed = self.conditional(negative, minus, plus, loc)?;
                let none = self.int_lit(0, Type::Int, loc)?;
                self.conditional(is_infinite, signed, none, loc)?
            }
        };
        self.comma(store, test, loc)
    }

    /// `__builtin_fabsl(x)` / `__builtin_copysignl(x, y)` on an x87 `long double`: a copy of
    /// `x` with its sign bit rewritten.
    pub(crate) fn sign_builtin_long_double(
        &mut self,
        sign_from: SignFrom,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        self.needs_function(name, loc)?;
        let copysign = sign_from == SignFrom::SecondArgument;
        let wanted = if copysign { 2 } else { 1 };
        if args.len() != wanted {
            return err(loc, format!("{name} takes {wanted} argument(s)"));
        }
        let long_double = self.tcx.target.long_double_type();
        let from = if copysign {
            Some(args.swap_remove(1))
        } else {
            None
        };
        let x = self.assign_convert(
            args.swap_remove(0),
            &long_double,
            loc,
            "passing an argument",
        )?;
        let (tx, store_x) = self.temp(x, loc)?;
        let word = self.long_double_sign_exponent(&tx, loc)?;
        let keep = self.int_lit(0x7fff, Type::Int, loc)?;
        let mut bits = self.binary(BinOp::And, word, keep, loc)?;
        let mut stores = store_x;
        if let Some(y) = from {
            let y = self.assign_convert(y, &long_double, loc, "passing an argument")?;
            let (ty, store_y) = self.temp(y, loc)?;
            stores = self.comma(stores, store_y, loc)?;
            let word = self.long_double_sign_exponent(&ty, loc)?;
            let mask = self.int_lit(0x8000, Type::Int, loc)?;
            let sign_of_y = self.binary(BinOp::And, word, mask, loc)?;
            bits = self.binary(BinOp::Or, bits, sign_of_y, loc)?;
        }
        let target = self.long_double_sign_exponent(&tx, loc)?;
        let rewrite = self.assign(target, bits, loc)?;
        let result = self.read(&tx, loc)?;
        let rewritten = self.comma(rewrite, result, loc)?;
        self.comma(stores, rewritten, loc)
    }

    /// `__builtin_fabs{,f}(x)` / `__builtin_copysign{,f}(x, y)`: on the bits.
    pub(crate) fn sign_builtin(
        &mut self,
        precision: Precision,
        sign_from: SignFrom,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        let copysign = sign_from == SignFrom::SecondArgument;
        let wanted = if copysign { 2 } else { 1 };
        if args.len() != wanted {
            return err(loc, format!("{name} takes {wanted} argument(s)"));
        }
        let (float_ty, bits_ty, sign): (Type, Type, u64) = if precision == Precision::Single {
            (Type::Float, Type::UInt, 0x8000_0000)
        } else {
            (Type::Double, Type::ULLong, 1 << 63)
        };
        let from = if copysign {
            Some(args.swap_remove(1))
        } else {
            None
        };
        let x = self.assign_convert(args.swap_remove(0), &float_ty, loc, "passing an argument")?;
        let bits = self.bits_of_float(x, &bits_ty, loc)?;
        let keep = self.int_lit((sign - 1) as i64, bits_ty.clone(), loc)?;
        let mut result = self.binary(BinOp::And, bits, keep, loc)?;
        if let Some(y) = from {
            let y = self.assign_convert(y, &float_ty, loc, "passing an argument")?;
            let ybits = self.bits_of_float(y, &bits_ty, loc)?;
            let mask = self.int_lit(sign as i64, bits_ty, loc)?;
            let sign_of_y = self.binary(BinOp::And, ybits, mask, loc)?;
            result = self.binary(BinOp::Or, result, sign_of_y, loc)?;
        }
        self.mk(
            ExprKind::Intrinsic(Intrinsic::Bitcast, vec![result]),
            float_ty,
            loc,
        )
    }

    /// `__builtin_isgreater` and the other comparisons that never raise "invalid":
    /// the ordinary comparisons, since nothing here looks at floating-point exceptions.
    pub(crate) fn compare_builtin(
        &mut self,
        which: &str,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        self.needs_function(name, loc)?;
        if args.len() != 2 {
            return err(loc, format!("{name} takes two arguments"));
        }
        let y = self.rvalue(args.swap_remove(1))?;
        let x = self.rvalue(args.swap_remove(0))?;
        if !x.ty.is_arith() || !y.ty.is_arith() {
            return err(loc, format!("{name} needs arithmetic operands"));
        }
        let (tx, store_x) = self.temp(x, loc)?;
        let (ty, store_y) = self.temp(y, loc)?;
        let op = |sema: &mut Sema, op: BinOp| -> Res<Expr> {
            let a = sema.read(&tx, loc)?;
            let b = sema.read(&ty, loc)?;
            sema.binary(op, a, b, loc)
        };
        let test = match which {
            "isgreater" => op(self, BinOp::Gt)?,
            "isgreaterequal" => op(self, BinOp::Ge)?,
            "isless" => op(self, BinOp::Lt)?,
            "islessequal" => op(self, BinOp::Le)?,
            "islessgreater" => {
                let less = op(self, BinOp::Lt)?;
                let greater = op(self, BinOp::Gt)?;
                self.logical(false, less, greater, loc)?
            }
            // isunordered: one of them is not equal to itself.
            _ => {
                let a1 = self.read(&tx, loc)?;
                let a2 = self.read(&tx, loc)?;
                let b1 = self.read(&ty, loc)?;
                let b2 = self.read(&ty, loc)?;
                let a_nan = self.binary(BinOp::Ne, a1, a2, loc)?;
                let b_nan = self.binary(BinOp::Ne, b1, b2, loc)?;
                self.logical(false, a_nan, b_nan, loc)?
            }
        };
        let e = self.comma(store_y, test, loc)?;
        self.comma(store_x, e, loc)
    }

    /// `__builtin_clrsb{,l,ll}(x)`: how many bits below the sign bit are copies of it.
    pub(crate) fn clrsb_builtin(
        &mut self,
        ty: &Type,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        self.needs_function(name, loc)?;
        if args.len() != 1 {
            return err(loc, format!("{name} takes one argument"));
        }
        let bits = self.bits_of(ty) as i64;
        let unsigned = ty.to_unsigned();
        let x = self.assign_convert(args.swap_remove(0), ty, loc, "passing an argument")?;
        let (tx, store) = self.temp(x, loc)?;
        // x ^ (x >> (bits - 1)) clears the sign copies; shifting a 1 in keeps clz defined.
        let a = self.read(&tx, loc)?;
        let b = self.read(&tx, loc)?;
        let shift = self.int_lit(bits - 1, Type::Int, loc)?;
        let spread = self.binary(BinOp::Shr, b, shift, loc)?;
        let mixed = self.binary(BinOp::Xor, a, spread, loc)?;
        let mixed = self.convert(mixed, &unsigned, loc)?;
        let one = self.int_lit(1, Type::Int, loc)?;
        let shifted = self.binary(BinOp::Shl, mixed, one, loc)?;
        let low = self.int_lit(1, unsigned.clone(), loc)?;
        let guarded = self.binary(BinOp::Or, shifted, low, loc)?;
        let guarded = self.convert(guarded, &unsigned, loc)?;
        let count = self.mk(
            ExprKind::Intrinsic(Intrinsic::Clz, vec![guarded]),
            Type::Int,
            loc,
        )?;
        self.comma(store, count, loc)
    }

    /// `__builtin_bitreverse{8,16,32,64}(x)`.
    pub(crate) fn bitreverse_builtin(
        &mut self,
        bits: u32,
        name: &str,
        mut args: Vec<Expr>,
        loc: Loc,
    ) -> Res<Expr> {
        if args.len() != 1 {
            return err(loc, format!("{name} takes one argument"));
        }
        let (ty, work) = match bits {
            8 => (Type::UChar, Type::UInt),
            16 => (Type::UShort, Type::UInt),
            32 => (Type::UInt, Type::UInt),
            _ => (Type::ULLong, Type::ULLong),
        };
        let x = self.assign_convert(args.swap_remove(0), &ty, loc, "passing an argument")?;
        let mut x = self.convert(x, &work, loc)?;
        // Swap neighbouring bits, pairs, nibbles, then the bytes.
        for (shift, mask) in [
            (1u32, 0x5555_5555_5555_5555u64),
            (2, 0x3333_3333_3333_3333),
            (4, 0x0f0f_0f0f_0f0f_0f0f),
        ] {
            self.needs_function(name, loc)?;
            let (tx, store) = self.temp(x, loc)?;
            let m = self.int_lit(mask as i64, work.clone(), loc)?;
            let a = self.read(&tx, loc)?;
            let by = self.int_lit(i64::from(shift), Type::Int, loc)?;
            let down = self.binary(BinOp::Shr, a, by, loc)?;
            let low = self.binary(BinOp::And, down, m, loc)?;
            let m = self.int_lit(mask as i64, work.clone(), loc)?;
            let b = self.read(&tx, loc)?;
            let kept = self.binary(BinOp::And, b, m, loc)?;
            let by = self.int_lit(i64::from(shift), Type::Int, loc)?;
            let high = self.binary(BinOp::Shl, kept, by, loc)?;
            let swapped = self.binary(BinOp::Or, low, high, loc)?;
            x = self.comma(store, swapped, loc)?;
        }
        let x = self.convert(x, &work, loc)?;
        let swapped = match bits {
            8 => x,
            16 => {
                let x = self.convert(x, &Type::UShort, loc)?;
                self.mk(
                    ExprKind::Intrinsic(Intrinsic::Bswap, vec![x]),
                    Type::UShort,
                    loc,
                )?
            }
            _ => self.mk(ExprKind::Intrinsic(Intrinsic::Bswap, vec![x]), work, loc)?,
        };
        self.convert(swapped, &ty, loc)
    }

    /// `__builtin_constant_p(e)`: numbers and string literals. The address of an object is
    /// not one for GCC, and neither is it here. (GCC also says yes to `x && 0` and `x * 0`;
    /// like Clang, this says no: only "no" is always a safe answer.)
    pub(crate) fn constant_p(&self, e: &Expr) -> bool {
        if matches!(e.kind, ExprKind::StrLit(_)) {
            return true;
        }
        match crate::constexpr::eval(e, &self.tcx) {
            Ok(
                crate::constexpr::Const::Int(_)
                | crate::constexpr::Const::Float(_)
                | crate::constexpr::Const::LongDouble(_),
            ) => true,
            Ok(crate::constexpr::Const::Addr { .. }) => {
                let mut inner = e;
                while let ExprKind::Decay(x) | ExprKind::Cast(x) | ExprKind::AddrOf(x) = &inner.kind
                {
                    inner = x;
                }
                matches!(inner.kind, ExprKind::StrLit(_))
            }
            Err(_) => false,
        }
    }

    /// `__builtin_frame_address(level)` / `__builtin_return_address(level)`: a frame starts
    /// with the caller's frame pointer, then the return address.
    pub(crate) fn frame_builtin(&self, return_address: bool, level: u32, loc: Loc) -> Res<Expr> {
        if self.func.is_none() {
            return err(loc, "a frame address is only available inside a function");
        }
        let pointer = Type::Void.ptr_to();
        let slot = pointer.clone().ptr_to();
        let mut frame = self.mk(
            ExprKind::Intrinsic(Intrinsic::FrameAddress, Vec::new()),
            pointer,
            loc,
        )?;
        for _ in 0..level {
            let link = self.cast(frame, &slot, loc)?;
            let link = self.deref(link, loc)?;
            frame = self.rvalue(link)?;
        }
        if !return_address {
            return Ok(frame);
        }
        let words = self.cast(frame, &slot, loc)?;
        let one = self.int_lit(1, Type::Int, loc)?;
        let at = self.binary(BinOp::Add, words, one, loc)?;
        let place = self.deref(at, loc)?;
        self.rvalue(place)
    }

    /// `__builtin_cpu_supports("feature")` on x86-64: asks `cpuid`. Features that need
    /// vector state wider than 128 bits (avx and everything built on it) are never reported,
    /// since code that uses them cannot be compiled here; unknown names are not supported.
    pub(crate) fn cpu_supports(&mut self, feature: &[u8], loc: Loc) -> Res<Expr> {
        // (leaf, register: 0 eax 1 ebx 2 ecx 3 edx, bit)
        let bit: Option<(u32, usize, u32)> = match feature {
            b"cmov" => Some((1, 3, 15)),
            b"mmx" => Some((1, 3, 23)),
            b"sse" => Some((1, 3, 25)),
            b"sse2" => Some((1, 3, 26)),
            b"sse3" => Some((1, 2, 0)),
            b"pclmul" => Some((1, 2, 1)),
            b"ssse3" => Some((1, 2, 9)),
            b"sse4.1" => Some((1, 2, 19)),
            b"sse4.2" => Some((1, 2, 20)),
            b"movbe" => Some((1, 2, 22)),
            b"popcnt" => Some((1, 2, 23)),
            b"aes" => Some((1, 2, 25)),
            b"rdrnd" => Some((1, 2, 30)),
            b"bmi" => Some((7, 1, 3)),
            b"bmi2" => Some((7, 1, 8)),
            b"rdseed" => Some((7, 1, 18)),
            b"adx" => Some((7, 1, 19)),
            b"sha" => Some((7, 1, 29)),
            b"lzcnt" | b"abm" => Some((0x8000_0001, 2, 5)),
            b"sse4a" => Some((0x8000_0001, 2, 6)),
            _ => None,
        };
        let x86 = self.tcx.target.arch == crate::types::Arch::X86_64;
        let (Some((leaf, register, bit)), true, true) = (bit, x86, self.func.is_some()) else {
            return self.int_lit(0, Type::Int, loc);
        };
        let unsigned = Type::UInt;
        let results = Type::Array(std::rc::Rc::new(unsigned.clone()), Some(4));
        let local = self.new_local(results.clone());
        let query = |sema: &mut Sema, leaf: u32| -> Res<Expr> {
            let leaf = sema.int_lit(i64::from(leaf), unsigned.clone(), loc)?;
            let zero = sema.int_lit(0, unsigned.clone(), loc)?;
            let place = sema.mk(ExprKind::Local(local), results.clone(), loc)?;
            let address = sema.addr_of(place, loc)?;
            sema.mk(
                ExprKind::Intrinsic(Intrinsic::CpuId, vec![leaf, zero, address]),
                Type::Void,
                loc,
            )
        };
        let read = |sema: &mut Sema, index: usize| -> Res<Expr> {
            let array = sema.mk(ExprKind::Local(local), results.clone(), loc)?;
            let index = sema.int_lit(index as i64, Type::Int, loc)?;
            let element = sema.index(array, index, loc)?;
            sema.rvalue(element)
        };
        // The highest leaf of the range (basic or extended) comes first.
        let highest = query(self, leaf & 0x8000_0000)?;
        let reported = read(self, 0)?;
        let wanted = self.int_lit(i64::from(leaf), unsigned.clone(), loc)?;
        let exists = self.binary(BinOp::Ge, reported, wanted, loc)?;
        let ask = query(self, leaf)?;
        let value = read(self, register)?;
        let shift = self.int_lit(i64::from(bit), Type::Int, loc)?;
        let shifted = self.binary(BinOp::Shr, value, shift, loc)?;
        let one = self.int_lit(1, unsigned, loc)?;
        let flag = self.binary(BinOp::And, shifted, one, loc)?;
        let flag = self.convert(flag, &Type::Int, loc)?;
        let yes = self.comma(ask, flag, loc)?;
        let no = self.int_lit(0, Type::Int, loc)?;
        let answer = self.conditional(exists, yes, no, loc)?;
        self.comma(highest, answer, loc)
    }

    /// Evaluates every operand for its side effects: `__builtin_prefetch`.
    pub(crate) fn discard_all(&self, args: Vec<Expr>, loc: Loc) -> Res<Expr> {
        let mut result: Option<Expr> = None;
        for arg in args {
            let arg = self.rvalue(arg)?;
            let dropped = self.cast(arg, &Type::Void, loc)?;
            result = Some(match result {
                Some(before) => self.comma(before, dropped, loc)?,
                None => dropped,
            });
        }
        match result {
            Some(e) => Ok(e),
            None => {
                let zero = self.int_lit(0, Type::Int, loc)?;
                self.cast(zero, &Type::Void, loc)
            }
        }
    }
}
