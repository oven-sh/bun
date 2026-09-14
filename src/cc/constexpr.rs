//! Constant expression evaluation over the typed AST.
//!
//! Used for integer constant expressions (array sizes, case labels, enumerators,
//! `_Static_assert`), for folding, and for initializers of objects with static storage
//! duration, where the result may be an address constant (symbol + addend) that becomes
//! a data relocation.

use crate::ast::*;
use crate::extended::Extended;
use crate::token::{Loc, Res, err};
use crate::types::{Type, TypeCtx};

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum AddrBase {
    Global(GlobalId),
    Func(FuncId),
    Str(StrId),
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Const {
    /// Wrapped to the expression's type (see `Sema::wrap_int`).
    Int(i64),
    Float(f64),
    LongDouble(Extended),
    Addr {
        base: AddrBase,
        offset: i64,
    },
}

pub(crate) const NOT_CONSTANT: &str = "expression is not a compile-time constant";

fn not_constant<T>(loc: Loc) -> Res<T> {
    err(loc, NOT_CONSTANT)
}

pub(crate) fn wrap(value: i64, ty: &Type, tcx: &TypeCtx) -> i64 {
    if matches!(ty, Type::Bool) {
        return i64::from(value != 0);
    }
    let size = tcx.size_of(ty).unwrap_or(8);
    if size >= 8 {
        return value;
    }
    let shift = 64 - size * 8;
    if tcx.is_signed(ty) {
        (value << shift) >> shift
    } else {
        ((value as u64) << shift >> shift) as i64
    }
}

/// C float-to-integer conversion of a constant; `None` when the value is out of range
/// (undefined behaviour, so it is left for run time).
pub(crate) fn float_to_int(v: f64, to: &Type, tcx: &TypeCtx) -> Option<i64> {
    if matches!(to, Type::Bool) {
        return Some(i64::from(v != 0.0));
    }
    let t = v.trunc();
    if !t.is_finite() {
        return None;
    }
    // A 128-bit literal is its sign-extended 64-bit value, so that is what has to hold it.
    let bits = tcx.size_of(to)? * 8;
    let (min, max) = match (tcx.is_signed(to), bits) {
        (true, 128) => (-(2f64.powi(63)), 2f64.powi(63)),
        (false, 128) => (0.0, 2f64.powi(63)),
        (true, _) => (-(2f64.powi(bits as i32 - 1)), 2f64.powi(bits as i32 - 1)),
        (false, _) => (0.0, 2f64.powi(bits as i32)),
    };
    if t < min || t >= max {
        return None;
    }
    Some(if tcx.is_signed(to) {
        t as i64
    } else {
        t as u64 as i64
    })
}

/// The two 64-bit halves of a 128-bit value, high and low. Taking them apart is what is meant:
/// a 64-bit constant holds the low half, whatever the high one was.
pub(crate) fn halves_of_i128(value: i128) -> (u64, u64) {
    let bits = value as u128;
    ((bits >> 64) as u64, (bits & u128::from(u64::MAX)) as u64)
}

/// A `long double` constant truncated to the integer type `to`, when it fits.
pub(crate) fn long_double_to_int(v: Extended, to: &Type, tcx: &TypeCtx) -> Option<i64> {
    if matches!(to, Type::Bool) {
        return Some(i64::from(!v.is_zero()));
    }
    let value = v.to_i128()?;
    // A 128-bit literal is its sign-extended 64-bit value, so that is what has to hold it.
    let bits = (tcx.size_of(to)? * 8) as u32;
    let (min, max) = match (tcx.is_signed(to), bits) {
        (true, 128) => (i128::from(i64::MIN), i128::from(i64::MAX)),
        (false, 128) => (0, i128::from(i64::MAX)),
        (true, _) => (-(1i128 << (bits - 1)), (1i128 << (bits - 1)) - 1),
        (false, _) => (0, (1i128 << bits) - 1),
    };
    let (_, low_bits) = halves_of_i128(value);
    (min..=max)
        .contains(&value)
        .then_some(low_bits.cast_signed())
}

pub(crate) fn long_double_compare(op: BinOp, x: Extended, y: Extended) -> bool {
    match (x.compare(y), op) {
        (None, op) => op == BinOp::Ne,
        (Some(order), BinOp::Eq) => order.is_eq(),
        (Some(order), BinOp::Ne) => order.is_ne(),
        (Some(order), BinOp::Lt) => order.is_lt(),
        (Some(order), BinOp::Le) => order.is_le(),
        (Some(order), BinOp::Gt) => order.is_gt(),
        (Some(order), _) => order.is_ge(),
    }
}

fn int_to_long_double(v: i64, from: &Type, tcx: &TypeCtx) -> Extended {
    if tcx.is_signed(from) {
        Extended::from_i128(i128::from(v))
    } else {
        Extended::from_u128(u128::from(v as u64))
    }
}

fn to_f64(v: i64, from: &Type, tcx: &TypeCtx) -> f64 {
    if tcx.is_signed(from) {
        v as f64
    } else {
        v as u64 as f64
    }
}

/// The integer `v` of type `from` converted to the floating type `to`, rounded once.
pub(crate) fn int_to_float(v: i64, from: &Type, to: &Type, tcx: &TypeCtx) -> f64 {
    match (matches!(to, Type::Float), tcx.is_signed(from)) {
        (true, true) => f64::from(v as f32),
        (true, false) => f64::from(v as u64 as f32),
        (false, _) => to_f64(v, from, tcx),
    }
}

/// What an operation on `x` and `y` folds to: the processor makes the NaN of an invalid
/// operation (`0.0 / 0.0`) negative, a compiler that folds it makes it positive, and `NAN` is
/// spelled that way by C libraries.
fn folded(result: f64, x: f64, y: f64) -> f64 {
    if result.is_nan() && !x.is_nan() && !y.is_nan() {
        f64::NAN
    } else {
        result
    }
}

fn round_to(v: f64, ty: &Type) -> f64 {
    if matches!(ty, Type::Float) {
        f64::from(v as f32)
    } else {
        v
    }
}

/// The address of an lvalue expression, if it is an address constant.
fn eval_addr(e: &Expr, tcx: &TypeCtx) -> Res<Const> {
    if !tcx.stack_check.is_safe_to_recurse() {
        return err(e.loc, "expression is nested too deeply");
    }
    match &e.kind {
        ExprKind::Global(id) => Ok(Const::Addr {
            base: AddrBase::Global(*id),
            offset: 0,
        }),
        ExprKind::StrLit(id) => Ok(Const::Addr {
            base: AddrBase::Str(*id),
            offset: 0,
        }),
        ExprKind::Func(id) => Ok(Const::Addr {
            base: AddrBase::Func(*id),
            offset: 0,
        }),
        ExprKind::Deref(p) => eval(p, tcx),
        ExprKind::Member(base, off) => match eval_addr(base, tcx)? {
            Const::Addr { base, offset } => Ok(Const::Addr {
                base,
                offset: offset.wrapping_add(*off as i64),
            }),
            // `&((struct S *)0)->m`, the offsetof idiom.
            Const::Int(v) => Ok(Const::Int(v.wrapping_add(*off as i64))),
            Const::Float(_) | Const::LongDouble(_) => not_constant(e.loc),
        },
        _ => not_constant(e.loc),
    }
}

/// Whether `e` is computed in 128 bits, which `eval_int128` does.
fn is_wide(e: &Expr) -> bool {
    let ty = &e.ty;
    // 128-bit values other than literals are not folded.
    let mut wide = ty.is_int128() && !matches!(e.kind, ExprKind::IntLit(_));
    // (An address or a member of a 128-bit object is not a 128-bit computation; a conversion
    // from one to a floating type has an arm of its own in `eval_one`.)
    e.for_each_child(|c| wide |= ty.is_integer() && c.ty.is_int128());
    wide
}

pub(crate) fn eval(e: &Expr, tcx: &TypeCtx) -> Res<Const> {
    if !tcx.stack_check.is_safe_to_recurse() {
        return err(e.loc, "expression is nested too deeply");
    }
    // `p ? a : q ? b : ...`: on to the operand that is chosen, by a loop.
    let mut e = e;
    while let ExprKind::Cond(c, a, b) = &e.kind {
        if is_wide(e) {
            break;
        }
        e = if truthy(eval(c, tcx)?) { a } else { b };
    }
    // `a + b + c + ...` is `((a + b) + c) + ...`: down the left operands by a loop, and up again
    // with the values.
    let mut chain: Vec<&Expr> = Vec::new();
    let mut innermost = e;
    while let ExprKind::Binary(_, a, _) | ExprKind::LogAnd(a, _) | ExprKind::LogOr(a, _) =
        &innermost.kind
    {
        if is_wide(innermost) {
            break;
        }
        chain.push(innermost);
        innermost = a;
    }
    let mut value = eval_one(innermost, tcx, None)?;
    while let Some(link) = chain.pop() {
        value = eval_one(link, tcx, Some(value))?;
    }
    Ok(value)
}

/// `e`, of which the left operand is `left` if that is known already.
fn eval_one(e: &Expr, tcx: &TypeCtx, left: Option<Const>) -> Res<Const> {
    let ty = &e.ty;
    if is_wide(e) {
        // Computed in 128 bits; a result that is not itself 128 bits wide, or fits in 64,
        // is an ordinary integer constant (`(__int128)-1 < 0`, `sizeof(x) * (__int128)2`).
        return match eval_int128(e, tcx) {
            Some(v) if ty.is_int128() => match i64::try_from(v) {
                Ok(v) => Ok(Const::Int(v)),
                Err(_) => not_constant(e.loc),
            },
            // `eval_int128` reduced it to the width of `ty`, 64 bits at most: a constant is
            // those bits.
            Some(v) => Ok(Const::Int(halves_of_i128(v).1.cast_signed())),
            None => not_constant(e.loc),
        };
    }
    match &e.kind {
        ExprKind::IntLit(v) => Ok(Const::Int(*v)),
        ExprKind::FloatLit(v) => Ok(Const::Float(*v)),
        ExprKind::LongDoubleLit(v) => Ok(Const::LongDouble(*v)),
        ExprKind::AddrOf(inner) | ExprKind::Decay(inner) => eval_addr(inner, tcx),
        ExprKind::Cast(inner) if ty.is_long_double() && inner.ty.is_int128() => {
            match eval_int128(inner, tcx) {
                Some(v) if !tcx.is_signed(&inner.ty) => {
                    Ok(Const::LongDouble(Extended::from_u128(v as u128)))
                }
                Some(v) => Ok(Const::LongDouble(Extended::from_i128(v))),
                None => not_constant(e.loc),
            }
        }
        ExprKind::Cast(inner) if ty.is_float() && inner.ty.is_int128() => {
            // One rounding, from all 128 bits.
            let Some(v) = eval_int128(inner, tcx) else {
                return not_constant(e.loc);
            };
            Ok(Const::Float(
                match (matches!(ty, Type::Float), tcx.is_signed(&inner.ty)) {
                    (true, true) => f64::from(v as f32),
                    (true, false) => f64::from(v as u128 as f32),
                    (false, true) => v as f64,
                    (false, false) => v as u128 as f64,
                },
            ))
        }
        ExprKind::Cast(inner) => {
            let v = eval(inner, tcx)?;
            let from = &inner.ty;
            match v {
                Const::Int(i) => {
                    if ty.is_integer() || ty.is_ptr() {
                        Ok(Const::Int(wrap(i, ty, tcx)))
                    } else if ty.is_float() {
                        Ok(Const::Float(int_to_float(i, from, ty, tcx)))
                    } else if ty.is_long_double() {
                        Ok(Const::LongDouble(int_to_long_double(i, from, tcx)))
                    } else {
                        not_constant(e.loc)
                    }
                }
                Const::LongDouble(v) => {
                    if ty.is_long_double() {
                        Ok(Const::LongDouble(v))
                    } else if matches!(ty, Type::Float) {
                        Ok(Const::Float(f64::from(v.to_f32())))
                    } else if matches!(ty, Type::Double | Type::LongDouble64) {
                        Ok(Const::Float(v.to_f64()))
                    } else if ty.is_integer() && !ty.is_int128() {
                        match long_double_to_int(v, ty, tcx) {
                            Some(i) => Ok(Const::Int(i)),
                            None => err(
                                e.loc,
                                "floating constant is out of range for the integer type",
                            ),
                        }
                    } else {
                        not_constant(e.loc)
                    }
                }
                Const::Float(f) => {
                    if ty.is_float() {
                        Ok(Const::Float(round_to(f, ty)))
                    } else if ty.is_long_double() {
                        Ok(Const::LongDouble(Extended::from_f64(f)))
                    } else if ty.is_integer() {
                        match float_to_int(f, ty, tcx) {
                            Some(i) => Ok(Const::Int(i)),
                            None => err(
                                e.loc,
                                "floating constant is out of range for the integer type",
                            ),
                        }
                    } else {
                        not_constant(e.loc)
                    }
                }
                Const::Addr { .. } => {
                    // An address survives casts between pointers and pointer-sized integers,
                    // and is not null.
                    if matches!(ty, Type::Bool) {
                        Ok(Const::Int(1))
                    } else if ty.is_ptr() || (ty.is_integer() && tcx.size_of(ty) == Some(8)) {
                        Ok(v)
                    } else {
                        not_constant(e.loc)
                    }
                }
            }
        }
        ExprKind::Neg(a) => match eval(a, tcx)? {
            Const::Int(v) => Ok(Const::Int(wrap(v.wrapping_neg(), ty, tcx))),
            Const::Float(v) => Ok(Const::Float(-v)),
            Const::LongDouble(v) => Ok(Const::LongDouble(v.negated())),
            Const::Addr { .. } => not_constant(e.loc),
        },
        ExprKind::BitNot(a) => match eval(a, tcx)? {
            Const::Int(v) => Ok(Const::Int(wrap(!v, ty, tcx))),
            _ => not_constant(e.loc),
        },
        ExprKind::LogNot(a) => Ok(Const::Int(i64::from(!truthy(eval(a, tcx)?)))),
        ExprKind::LogAnd(a, b) => {
            if !truthy(left.map_or_else(|| eval(a, tcx), Ok)?) {
                return Ok(Const::Int(0));
            }
            Ok(Const::Int(i64::from(truthy(eval(b, tcx)?))))
        }
        ExprKind::LogOr(a, b) => {
            if truthy(left.map_or_else(|| eval(a, tcx), Ok)?) {
                return Ok(Const::Int(1));
            }
            Ok(Const::Int(i64::from(truthy(eval(b, tcx)?))))
        }
        ExprKind::Cond(c, a, b) => {
            if truthy(eval(c, tcx)?) {
                eval(a, tcx)
            } else {
                eval(b, tcx)
            }
        }
        ExprKind::Binary(op, a, b) => {
            let va = left.map_or_else(|| eval(a, tcx), Ok)?;
            let vb = eval(b, tcx)?;
            match (va, vb) {
                (Const::Int(x), Const::Int(y)) => eval_int_binary(*op, x, y, &a.ty, ty, tcx, e.loc),
                (Const::Float(x), Const::Float(y)) => Ok(match op {
                    BinOp::Add => Const::Float(folded(round_to(x + y, ty), x, y)),
                    BinOp::Sub => Const::Float(folded(round_to(x - y, ty), x, y)),
                    BinOp::Mul => Const::Float(folded(round_to(x * y, ty), x, y)),
                    BinOp::Div => Const::Float(folded(round_to(x / y, ty), x, y)),
                    BinOp::Eq => Const::Int(i64::from(x == y)),
                    BinOp::Ne => Const::Int(i64::from(x != y)),
                    BinOp::Lt => Const::Int(i64::from(x < y)),
                    BinOp::Le => Const::Int(i64::from(x <= y)),
                    BinOp::Gt => Const::Int(i64::from(x > y)),
                    BinOp::Ge => Const::Int(i64::from(x >= y)),
                    _ => return not_constant(e.loc),
                }),
                (Const::LongDouble(x), Const::LongDouble(y)) => {
                    let result = match op {
                        BinOp::Add => x.add(y),
                        BinOp::Sub => x.sub(y),
                        BinOp::Mul => x.mul(y),
                        BinOp::Div => x.div(y),
                        _ => return not_constant(e.loc),
                    };
                    // As for `double`: an invalid operation folds to the positive NaN.
                    let invalid = result.is_nan() && !x.is_nan() && !y.is_nan();
                    Ok(Const::LongDouble(if invalid {
                        Extended::NAN
                    } else {
                        result
                    }))
                }
                // An address that was converted to an integer as wide as it is still moves by
                // what is added to it.
                (Const::Addr { base, offset }, Const::Int(n))
                    if matches!(op, BinOp::Add | BinOp::Sub) && tcx.size_of(ty) == Some(8) =>
                {
                    let n = if *op == BinOp::Sub {
                        n.wrapping_neg()
                    } else {
                        n
                    };
                    Ok(Const::Addr {
                        base,
                        offset: offset.wrapping_add(n),
                    })
                }
                (Const::Int(n), Const::Addr { base, offset })
                    if *op == BinOp::Add && tcx.size_of(ty) == Some(8) =>
                {
                    Ok(Const::Addr {
                        base,
                        offset: offset.wrapping_add(n),
                    })
                }
                // The address of an object or a function is not the null pointer, and two places
                // in one object compare as their offsets do.
                (Const::Addr { .. }, Const::Int(0)) | (Const::Int(0), Const::Addr { .. })
                    if matches!(op, BinOp::Eq | BinOp::Ne) =>
                {
                    Ok(Const::Int(i64::from(*op == BinOp::Ne)))
                }
                (
                    Const::Addr {
                        base: x_base,
                        offset: x,
                    },
                    Const::Addr {
                        base: y_base,
                        offset: y,
                    },
                ) if x_base == y_base && op.is_compare() => Ok(Const::Int(i64::from(match op {
                    BinOp::Eq => x == y,
                    BinOp::Ne => x != y,
                    BinOp::Lt => x < y,
                    BinOp::Le => x <= y,
                    BinOp::Gt => x > y,
                    _ => x >= y,
                }))),
                _ => not_constant(e.loc),
            }
        }
        ExprKind::Intrinsic(
            op @ (Intrinsic::Clz
            | Intrinsic::Ctz
            | Intrinsic::Popcount
            | Intrinsic::Bswap
            | Intrinsic::RotL
            | Intrinsic::RotR),
            operands,
        ) => {
            // What GCC and Clang fold too; the bit counts of zero are left for run time.
            let Some(operand) = operands.first() else {
                return not_constant(e.loc);
            };
            let bits = tcx.size_of(&operand.ty).unwrap_or(8) as u32 * 8;
            let Const::Int(v) = eval(operand, tcx)? else {
                return not_constant(e.loc);
            };
            let mask = if bits >= 64 {
                u64::MAX
            } else {
                (1u64 << bits) - 1
            };
            let v = v as u64 & mask;
            let count = match operands.get(1).map(|n| eval(n, tcx)).transpose()? {
                Some(Const::Int(n)) => n as u32 % bits,
                Some(_) => return not_constant(e.loc),
                None => 0,
            };
            let rotated_left = |by: u32| {
                if by == 0 {
                    v
                } else {
                    ((v << by) | (v >> (bits - by))) & mask
                }
            };
            let result = match op {
                Intrinsic::Clz if v != 0 => u64::from(v.leading_zeros() - (64 - bits)),
                Intrinsic::Ctz if v != 0 => u64::from(v.trailing_zeros()),
                Intrinsic::Popcount => u64::from(v.count_ones()),
                Intrinsic::Bswap => v.swap_bytes() >> (64 - bits),
                Intrinsic::RotL => rotated_left(count),
                Intrinsic::RotR => rotated_left((bits - count) % bits),
                _ => return not_constant(e.loc),
            };
            Ok(Const::Int(wrap(result as i64, ty, tcx)))
        }
        ExprKind::Intrinsic(Intrinsic::X87(operation), operands) => {
            use crate::x87::X87Op;
            let [a, b] = operands.as_slice() else {
                return not_constant(e.loc);
            };
            let (Const::LongDouble(x), Const::LongDouble(y)) = (eval(a, tcx)?, eval(b, tcx)?)
            else {
                return not_constant(e.loc);
            };
            let op = match operation {
                X87Op::Less => BinOp::Lt,
                X87Op::LessEq => BinOp::Le,
                X87Op::Equal => BinOp::Eq,
                _ => return not_constant(e.loc),
            };
            Ok(Const::Int(i64::from(long_double_compare(op, x, y))))
        }
        ExprKind::PtrAdd {
            ptr,
            index,
            scale,
            sub,
        } => {
            let Const::Int(i) = eval(index, tcx)? else {
                return not_constant(e.loc);
            };
            let delta = i.wrapping_mul(*scale as i64);
            let delta = if *sub { delta.wrapping_neg() } else { delta };
            match eval(ptr, tcx)? {
                Const::Addr { base, offset } => Ok(Const::Addr {
                    base,
                    offset: offset.wrapping_add(delta),
                }),
                Const::Int(p) => Ok(Const::Int(p.wrapping_add(delta))),
                Const::Float(_) | Const::LongDouble(_) => not_constant(e.loc),
            }
        }
        ExprKind::PtrDiff { a, b, scale } => {
            let scale = (*scale).max(1) as i64;
            match (eval(a, tcx)?, eval(b, tcx)?) {
                (Const::Int(x), Const::Int(y)) => Ok(Const::Int(x.wrapping_sub(y) / scale)),
                (
                    Const::Addr {
                        base: ba,
                        offset: oa,
                    },
                    Const::Addr {
                        base: bb,
                        offset: ob,
                    },
                ) if ba == bb => Ok(Const::Int(oa.wrapping_sub(ob) / scale)),
                _ => not_constant(e.loc),
            }
        }
        _ => not_constant(e.loc),
    }
}

/// The value of a constant expression of integer type, computed in 128 bits.
pub(crate) fn eval_int128(e: &Expr, tcx: &TypeCtx) -> Option<i128> {
    if !tcx.stack_check.is_safe_to_recurse() {
        return None;
    }
    // The value an integer of type `ty` stands for when its bits are `v`.
    let fit = |v: i128, ty: &Type| -> i128 {
        if matches!(ty, Type::Bool) {
            return i128::from(v != 0);
        }
        match tcx.size_of(ty) {
            Some(16) if tcx.is_signed(ty) => v,
            Some(16) => v,
            Some(size) if size < 16 => {
                let shift = 128 - size as u32 * 8;
                if tcx.is_signed(ty) {
                    (v << shift) >> shift
                } else {
                    ((v as u128) << shift >> shift) as i128
                }
            }
            _ => v,
        }
    };
    if !e.ty.is_integer() {
        return None;
    }
    let value = match &e.kind {
        ExprKind::IntLit(v) => i128::from(*v),
        ExprKind::Cast(inner) if inner.ty.is_integer() => eval_int128(inner, tcx)?,
        ExprKind::Cast(inner) if inner.ty.is_float() => match eval(inner, tcx).ok()? {
            // Out of the type's range the conversion is undefined, and left to run time.
            Const::Float(v) if tcx.is_signed(&e.ty) && v.abs() < 2f64.powi(127) => v as i128,
            Const::Float(v) if !tcx.is_signed(&e.ty) && v > -1.0 && v < 2f64.powi(128) => {
                v as u128 as i128
            }
            _ => return None,
        },
        ExprKind::Cast(inner) if inner.ty.is_long_double() => match eval(inner, tcx).ok()? {
            Const::LongDouble(v) => v.to_i128()?,
            _ => return None,
        },
        ExprKind::Neg(a) => eval_int128(a, tcx)?.wrapping_neg(),
        ExprKind::BitNot(a) => !eval_int128(a, tcx)?,
        ExprKind::LogNot(a) => i128::from(eval_int128(a, tcx)? == 0),
        ExprKind::LogAnd(a, b) => {
            i128::from(eval_int128(a, tcx)? != 0 && eval_int128(b, tcx)? != 0)
        }
        ExprKind::LogOr(a, b) => i128::from(eval_int128(a, tcx)? != 0 || eval_int128(b, tcx)? != 0),
        ExprKind::Cond(c, a, b) => {
            if eval_int128(c, tcx)? != 0 {
                eval_int128(a, tcx)?
            } else {
                eval_int128(b, tcx)?
            }
        }
        ExprKind::Binary(op, a, b) if op.is_compare() => {
            if !a.ty.is_integer() || !b.ty.is_integer() {
                return None;
            }
            let (x, y) = (eval_int128(a, tcx)?, eval_int128(b, tcx)?);
            // Both operands have the same type after the usual conversions.
            let order = if tcx.is_signed(&a.ty) {
                x.cmp(&y)
            } else {
                (x as u128).cmp(&(y as u128))
            };
            i128::from(match op {
                BinOp::Eq => order.is_eq(),
                BinOp::Ne => order.is_ne(),
                BinOp::Lt => order.is_lt(),
                BinOp::Le => order.is_le(),
                BinOp::Gt => order.is_gt(),
                _ => order.is_ge(),
            })
        }
        ExprKind::Binary(op, a, b) if !op.is_compare() => {
            let (x, y) = (eval_int128(a, tcx)?, eval_int128(b, tcx)?);
            let unsigned = !tcx.is_signed(&a.ty);
            match op {
                BinOp::Add => x.wrapping_add(y),
                BinOp::Sub => x.wrapping_sub(y),
                BinOp::Mul => x.wrapping_mul(y),
                BinOp::And => x & y,
                BinOp::Or => x | y,
                BinOp::Xor => x ^ y,
                BinOp::Shl if (0..128).contains(&y) => x.wrapping_shl(y as u32),
                BinOp::Shr if (0..128).contains(&y) && unsigned && a.ty.is_int128() => {
                    ((x as u128) >> y) as i128
                }
                BinOp::Shr if (0..128).contains(&y) => x >> y,
                BinOp::Div | BinOp::Rem if y != 0 => match (op, unsigned && a.ty.is_int128()) {
                    (BinOp::Div, true) => ((x as u128) / (y as u128)) as i128,
                    (BinOp::Div, false) => x.wrapping_div(y),
                    (_, true) => ((x as u128) % (y as u128)) as i128,
                    (_, false) => x.wrapping_rem(y),
                },
                _ => return None,
            }
        }
        _ => return None,
    };
    Some(fit(value, &e.ty))
}

/// A complex number.
#[derive(Clone, Copy)]
pub(crate) struct Complex {
    pub(crate) re: f64,
    pub(crate) im: f64,
}

/// The value of a constant complex expression.
pub(crate) fn eval_complex(e: &Expr, tcx: &TypeCtx) -> Option<Complex> {
    if !tcx.stack_check.is_safe_to_recurse() {
        return None;
    }
    let real = |e: &Expr| -> Option<f64> {
        match eval(e, tcx).ok()? {
            Const::Float(v) => Some(v),
            Const::Int(v) => Some(to_f64(v, &e.ty, tcx)),
            Const::LongDouble(_) | Const::Addr { .. } => None,
        }
    };
    let single = matches!(e.ty, Type::ComplexFloat);
    let round = |v: f64| if single { f64::from(v as f32) } else { v };
    let Complex { re, im } = match &e.kind {
        ExprKind::ComplexMake(re, im) => Complex {
            re: real(re)?,
            im: real(im)?,
        },
        ExprKind::Cast(inner) if inner.ty.is_complex() => eval_complex(inner, tcx)?,
        ExprKind::Neg(inner) => {
            let Complex { re, im } = eval_complex(inner, tcx)?;
            Complex { re: -re, im: -im }
        }
        ExprKind::BitNot(inner) => {
            let Complex { re, im } = eval_complex(inner, tcx)?;
            Complex { re, im: -im }
        }
        ExprKind::Binary(op, x, y) if e.ty.is_complex() => {
            // A real operand has no imaginary part, which is not the same as a zero one.
            let operand = |e: &Expr| -> Option<(f64, Option<f64>)> {
                if e.ty.is_complex() {
                    let Complex { re, im } = eval_complex(e, tcx)?;
                    Some((re, Some(im)))
                } else {
                    Some((real(e)?, None))
                }
            };
            let (a, b) = operand(x)?;
            let (c, d) = operand(y)?;
            match (op, b, d) {
                (BinOp::Add, b, d) => Complex {
                    re: a + c,
                    im: match (b, d) {
                        (Some(b), Some(d)) => b + d,
                        (Some(only), None) | (None, Some(only)) => only,
                        (None, None) => 0.0,
                    },
                },
                (BinOp::Sub, b, d) => Complex {
                    re: a - c,
                    im: match (b, d) {
                        (Some(b), Some(d)) => b - d,
                        (Some(b), None) => b,
                        (None, Some(d)) => -d,
                        (None, None) => 0.0,
                    },
                },
                (BinOp::Mul, Some(b), Some(d)) => Complex {
                    re: round(a * c) - round(b * d),
                    im: round(a * d) + round(b * c),
                },
                (BinOp::Mul, Some(b), None) => Complex {
                    re: a * c,
                    im: b * c,
                },
                (BinOp::Mul, None, Some(d)) => Complex {
                    re: a * c,
                    im: a * d,
                },
                (BinOp::Div, Some(b), None) => Complex {
                    re: a / c,
                    im: b / c,
                },
                (BinOp::Div, b, Some(d)) => {
                    let b = b.unwrap_or(0.0);
                    if single {
                        // In double nothing a float can hold overflows or vanishes.
                        let scale = c * c + d * d;
                        Complex {
                            re: (a * c + b * d) / scale,
                            im: (b * c - a * d) / scale,
                        }
                    } else if c.abs() >= d.abs() {
                        // Smith's method: nothing in between is squared.
                        let ratio = d / c;
                        let denominator = c + d * ratio;
                        Complex {
                            re: (a + b * ratio) / denominator,
                            im: (b - a * ratio) / denominator,
                        }
                    } else {
                        let ratio = c / d;
                        let denominator = d + c * ratio;
                        Complex {
                            re: (a * ratio + b) / denominator,
                            im: (b * ratio - a) / denominator,
                        }
                    }
                }
                _ => return None,
            }
        }
        _ => return None,
    };
    Some(Complex {
        re: round(re),
        im: round(im),
    })
}

fn truthy(c: Const) -> bool {
    match c {
        Const::Int(v) => v != 0,
        Const::Float(v) => v != 0.0,
        Const::LongDouble(v) => !v.is_zero(),
        Const::Addr { .. } => true,
    }
}

/// `operand_ty` is the (common) type of the operands, `result_ty` the type of the result.
fn eval_int_binary(
    op: BinOp,
    x: i64,
    y: i64,
    operand_ty: &Type,
    result_ty: &Type,
    tcx: &TypeCtx,
    loc: Loc,
) -> Res<Const> {
    let signed = tcx.is_signed(operand_ty);
    let bits = tcx.size_of(operand_ty).unwrap_or(8) * 8;
    let (ux, uy) = (x as u64, y as u64);
    let raw: i64 = match op {
        BinOp::Add => x.wrapping_add(y),
        BinOp::Sub => x.wrapping_sub(y),
        BinOp::Mul => x.wrapping_mul(y),
        BinOp::Div | BinOp::Rem => {
            if y == 0 {
                return err(loc, "division by zero in a constant expression");
            }
            match (op, signed) {
                (BinOp::Div, true) => x.wrapping_div(y),
                (BinOp::Div, false) => (ux / uy) as i64,
                (_, true) => x.wrapping_rem(y),
                (_, false) => (ux % uy) as i64,
            }
        }
        BinOp::And => x & y,
        BinOp::Or => x | y,
        BinOp::Xor => x ^ y,
        BinOp::Shl | BinOp::Shr => {
            if y < 0 || y as u64 >= bits {
                return err(loc, "shift count is out of range in a constant expression");
            }
            match (op, signed) {
                (BinOp::Shl, _) => ((ux) << y) as i64,
                (_, true) => x >> y,
                (_, false) => (ux >> y) as i64,
            }
        }
        BinOp::Eq => i64::from(x == y),
        BinOp::Ne => i64::from(x != y),
        BinOp::Lt => i64::from(if signed { x < y } else { ux < uy }),
        BinOp::Le => i64::from(if signed { x <= y } else { ux <= uy }),
        BinOp::Gt => i64::from(if signed { x > y } else { ux > uy }),
        BinOp::Ge => i64::from(if signed { x >= y } else { ux >= uy }),
    };
    Ok(Const::Int(wrap(raw, result_ty, tcx)))
}
