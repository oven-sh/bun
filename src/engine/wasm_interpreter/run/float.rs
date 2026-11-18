//! Arithmetic on floats.

use core::ops::{Add, Div, Mul, Neg, Sub};

use bun_engine_asm::{FloatWidth, Rounding};
use bun_engine_codegen::ir::{Binary, Type, Unary, evaluate};
use bun_engine_wasm_format::{FloatBinaryOp, FloatUnaryOp};

use super::form::Form;
use crate::machine::{Handler, Number, given, go, handlers, specialize};

pub(crate) trait Float:
    Number
    + Add<Output = Self>
    + Sub<Output = Self>
    + Mul<Output = Self>
    + Div<Output = Self>
    + Neg<Output = Self>
    + Into<f64>
{
    const TYPE: Type;

    fn abs(self) -> Self;
    fn sqrt(self) -> Self;
}

macro_rules! floats {
    ($($type:ty => $ir:ident),*) => {$(
        impl Float for $type {
            const TYPE: Type = Type::$ir;

            #[inline(always)]
            fn abs(self) -> Self {
                self.abs()
            }

            #[inline(always)]
            fn sqrt(self) -> Self {
                self.sqrt()
            }
        }
    )*};
}

floats!(f32 => F32, f64 => F64);

const ADD: u8 = FloatBinaryOp::Add as u8;
const SUB: u8 = FloatBinaryOp::Sub as u8;
const MUL: u8 = FloatBinaryOp::Mul as u8;
const MIN: u8 = FloatBinaryOp::Min as u8;
const MAX: u8 = FloatBinaryOp::Max as u8;
const ABS: u8 = FloatUnaryOp::Abs as u8;
const NEG: u8 = FloatUnaryOp::Neg as u8;
const ROUNDINGS: [Rounding; 4] = {
    use Rounding::*;
    let all = [Down, Up, TowardZero, Nearest];
    assert!(all[1] as u8 == 1 && all[2] as u8 == 2 && all[3] as u8 == 3);
    all
};

handlers! {
    fn arithmetic[T: Float, const OP: u8, const FORM: Form](m, op) {
        let (lhs, rhs, last) = given!(m.inputs::<T, FORM>(op));
        let result = match OP {
            ADD => lhs + rhs,
            SUB => lhs - rhs,
            MUL => lhs * rhs,
            _ => lhs / rhs,
        };
        m.produce(op.a, result);
        go!(m, last.next);
    }

    fn square[T: Float](m, op) {
        let value = T::last(&m);
        m.produce(op.a, value * value);
    }

    fn selection[T: Float, const OP: u8](m, op) {
        let kind = match OP {
            MIN => Binary::Min,
            MAX => Binary::Max,
            _ => Binary::CopySign,
        };
        let bits = given!(evaluate::binary(kind, T::TYPE, m.get(op.b), m.get(op.c())));
        m.produce(op.a, T::from_slot(bits));
    }

    fn unary[T: Float, const OP: u8, const IS_LAST: bool](m, op) {
        let value = m.read::<T, IS_LAST>(op.b);
        let result = match OP {
            ABS => value.abs(),
            NEG => -value,
            _ => value.sqrt(),
        };
        m.produce(op.a, result);
    }

    fn round[T: Float, const ROUNDING: u8, const IS_LAST: bool](m, op) {
        let (kind, value) = (Unary::Round(ROUNDINGS[usize::from(ROUNDING)]), m.read::<T, IS_LAST>(op.b));
        let bits = given!(evaluate::unary(kind, T::TYPE, T::TYPE, value.to_slot()));
        m.produce(op.a, T::from_slot(bits));
    }
}

/// `$body` with the type for the width.
macro_rules! with_float {
    ($width:expr => $T:ident, $body:expr) => {
        match $width {
            FloatWidth::F32 => {
                type $T = f32;
                $body
            }
            FloatWidth::F64 => {
                type $T = f64;
                $body
            }
        }
    };
}

pub(crate) use with_float;

pub(crate) fn for_arithmetic(width: FloatWidth, op: FloatBinaryOp, form: Form) -> Handler {
    match form {
        Form::SlotWide | Form::LastWide => {
            specialize!(op => const OP: FloatBinaryOp as u8 { Add Sub Mul Div },
            specialize!(form => const FORM: Form { SlotWide LastWide }, arithmetic::<f64, OP, FORM>))
        }
        Form::SlotLast | Form::ImmSlot | Form::ImmLast => with_float!(width => T,
            specialize!(op => const OP: FloatBinaryOp as u8 { Sub Div },
                specialize!(form => const FORM: Form { SlotLast ImmSlot ImmLast }, arithmetic::<T, OP, FORM>))),
        _ => {
            with_float!(width => T, specialize!(op => const OP: FloatBinaryOp as u8 { Add Sub Mul Div },
            specialize!(form => const FORM: Form { SlotSlot LastSlot SlotImm LastImm }, arithmetic::<T, OP, FORM>)))
        }
    }
}

/// Of the last result.
pub(crate) fn for_square(width: FloatWidth) -> Handler {
    with_float!(width => T, square::<T>)
}

/// Both operands are in slots.
pub(crate) fn for_selection(width: FloatWidth, op: FloatBinaryOp) -> Handler {
    with_float!(width => T,
        specialize!(op => const OP: FloatBinaryOp as u8 { Min Max Copysign }, selection::<T, OP>))
}

pub(crate) fn for_unary(width: FloatWidth, op: FloatUnaryOp, is_last: bool) -> Handler {
    with_float!(width => T, specialize!(is_last => const IS_LAST: bool,
        specialize!(op => const OP: FloatUnaryOp as u8 { Abs Neg Sqrt }, unary::<T, OP, IS_LAST>)))
}

pub(crate) fn for_round(width: FloatWidth, rounding: Rounding, is_last: bool) -> Handler {
    with_float!(width => T, specialize!(is_last => const IS_LAST: bool,
        specialize!(rounding => const ROUNDING: Rounding as u8 { Down Up TowardZero Nearest },
            round::<T, ROUNDING, IS_LAST>)))
}
