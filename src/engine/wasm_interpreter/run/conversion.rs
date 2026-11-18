//! From one type of number to another.

use bun_engine_asm::{FloatWidth, Sign, Width};
use bun_engine_codegen::ir::{Type, Unary, evaluate};

use super::float::{Float, with_float};
use crate::machine::Number;
use crate::machine::{Handler, attempt, given, handlers, specialize};

const fn sign(is_signed: bool) -> Sign {
    if is_signed {
        Sign::Signed
    } else {
        Sign::Unsigned
    }
}

const fn int(is_wide: bool) -> Type {
    if is_wide { Type::I64 } else { Type::I32 }
}

trait FromInt: Float {
    fn from_signed(value: i64) -> Self;
    fn from_unsigned(value: u64) -> Self;
}

macro_rules! from_int {
    ($($type:ty),*) => {$(
        impl FromInt for $type {
            #[inline(always)]
            fn from_signed(value: i64) -> Self {
                value as Self
            }

            #[inline(always)]
            fn from_unsigned(value: u64) -> Self {
                value as Self
            }
        }
    )*};
}

from_int!(f32, f64);

handlers! {
    fn truncate[T: Float, const IS_SIGNED: bool, const IS_WIDE: bool, const IS_LAST: bool](m, op) {
        let bits = Number::to_slot(m.read::<T, IS_LAST>(op.b));
        let result = evaluate::unary(Unary::FloatToInt(sign(IS_SIGNED)), T::TYPE, int(IS_WIDE), bits);
        m.produce(op.a, attempt!(result, TruncationOutOfRange));
    }

    fn saturate[T: Float, const IS_SIGNED: bool, const IS_WIDE: bool, const IS_LAST: bool](m, op) {
        let kind = Unary::FloatToIntSaturating(sign(IS_SIGNED));
        let bits = Number::to_slot(m.read::<T, IS_LAST>(op.b));
        m.produce(op.a, given!(evaluate::unary(kind, T::TYPE, int(IS_WIDE), bits)));
    }

    #[allow(private_bounds, reason = "it is called through its address")]
    fn convert[T: FromInt, const IS_SIGNED: bool, const IS_WIDE: bool, const IS_LAST: bool](m, op) {
        let bits = m.read::<u64, IS_LAST>(op.b);
        let result = match (IS_SIGNED, IS_WIDE) {
            (true, true) => T::from_signed(bits as i64),
            (true, false) => T::from_signed((bits as i32).into()),
            (false, true) => T::from_unsigned(bits),
            (false, false) => T::from_signed((bits as u32).into()),
        };
        m.produce(op.a, result);
    }

    fn demote[const IS_LAST: bool](m, op) {
        let value = m.read::<f64, IS_LAST>(op.b);
        m.produce(op.a, value as f32);
    }

    fn promote[const IS_LAST: bool](m, op) {
        let value = m.read::<f32, IS_LAST>(op.b);
        m.produce(op.a, f64::from(value));
    }
}

macro_rules! choose {
    ($handler:ident, $float:expr, $sign:expr, $int:expr, $is_last:expr) => {
        with_float!($float => T,
            specialize!($sign == Sign::Signed => const IS_SIGNED: bool,
                specialize!($int == Width::W64 => const IS_WIDE: bool,
                    specialize!($is_last => const IS_LAST: bool, $handler::<T, IS_SIGNED, IS_WIDE, IS_LAST>))))
    };
}

pub(crate) fn for_truncate(from: FloatWidth, sign: Sign, to: Width, is_last: bool) -> Handler {
    choose!(truncate, from, sign, to, is_last)
}

pub(crate) fn for_saturate(from: FloatWidth, sign: Sign, to: Width, is_last: bool) -> Handler {
    choose!(saturate, from, sign, to, is_last)
}

pub(crate) fn for_convert(sign: Sign, from: Width, to: FloatWidth, is_last: bool) -> Handler {
    choose!(convert, to, sign, from, is_last)
}

pub(crate) fn for_demote(is_last: bool) -> Handler {
    specialize!(is_last => const IS_LAST: bool, demote::<IS_LAST>)
}

pub(crate) fn for_promote(is_last: bool) -> Handler {
    specialize!(is_last => const IS_LAST: bool, promote::<IS_LAST>)
}
