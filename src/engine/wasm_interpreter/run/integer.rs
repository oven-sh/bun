//! Arithmetic on integers.

use core::marker::ConstParamTy;

use bun_engine_asm::{Sign, Size, Width};
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::IntUnaryOp;

use super::form::Form;
use crate::machine::{Handler, Number, attempt, given, go, handlers, specialize};

#[derive(Clone, Copy, PartialEq, Eq, ConstParamTy)]
pub(crate) enum Binary {
    Add,
    Mul,
    And,
    Or,
    Xor,
    Sub,
    Shl,
    ShrU,
    ShrS,
    Rotl,
    Rotr,
    DivS,
    DivU,
    RemS,
    RemU,
}

impl Binary {
    pub(crate) fn is_commutative(self) -> bool {
        matches!(
            self,
            Self::Add | Self::Mul | Self::And | Self::Or | Self::Xor
        )
    }

    /// Whether the first operand can be in the record.
    pub(crate) fn takes_constant_first(self) -> bool {
        matches!(self, Self::Sub | Self::Shl | Self::ShrU)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, ConstParamTy)]
pub(crate) enum Unary {
    Clz,
    Ctz,
    Popcnt,
    Extend8,
    Extend16,
    Extend32,
}

impl From<IntUnaryOp> for Unary {
    fn from(op: IntUnaryOp) -> Self {
        match op {
            IntUnaryOp::Clz => Self::Clz,
            IntUnaryOp::Ctz => Self::Ctz,
            IntUnaryOp::Popcnt => Self::Popcnt,
        }
    }
}

impl Unary {
    pub(crate) fn sign_extending(from: Size) -> Self {
        match from {
            Size::S8 => Self::Extend8,
            Size::S16 => Self::Extend16,
            Size::S32 | Size::S64 => Self::Extend32,
        }
    }
}

pub(crate) trait Int: Number {
    fn binary(op: Binary, lhs: Self, rhs: Self) -> Result<Self, Trap>;
    fn unary(op: Unary, value: Self) -> Self;
}

macro_rules! ints {
    ($($unsigned:ty, $signed:ty;)*) => {$(
        impl Int for $unsigned {
            #[inline(always)]
            fn binary(op: Binary, lhs: Self, rhs: Self) -> Result<Self, Trap> {
                let (signed, amount) = (lhs as $signed, rhs as u32);
                Ok(match op {
                    Binary::Add => lhs.wrapping_add(rhs),
                    Binary::Mul => lhs.wrapping_mul(rhs),
                    Binary::And => lhs & rhs,
                    Binary::Or => lhs | rhs,
                    Binary::Xor => lhs ^ rhs,
                    Binary::Sub => lhs.wrapping_sub(rhs),
                    Binary::Shl => lhs.wrapping_shl(amount),
                    Binary::ShrU => lhs.wrapping_shr(amount),
                    Binary::ShrS => signed.wrapping_shr(amount) as Self,
                    Binary::Rotl => lhs.rotate_left(amount % Self::BITS),
                    Binary::Rotr => lhs.rotate_right(amount % Self::BITS),
                    _ if rhs == 0 => return Err(Trap::DivisionByZero),
                    Binary::DivS => {
                        let quotient = signed.checked_div(rhs as $signed);
                        quotient.ok_or(Trap::IntegerOverflow)? as Self
                    }
                    Binary::DivU => lhs / rhs,
                    Binary::RemS => signed.wrapping_rem(rhs as $signed) as Self,
                    Binary::RemU => lhs % rhs,
                })
            }

            #[inline(always)]
            fn unary(op: Unary, value: Self) -> Self {
                match op {
                    Unary::Clz => value.leading_zeros().into(),
                    Unary::Ctz => value.trailing_zeros().into(),
                    Unary::Popcnt => value.count_ones().into(),
                    Unary::Extend8 => value as i8 as Self,
                    Unary::Extend16 => value as i16 as Self,
                    Unary::Extend32 => value as i32 as Self,
                }
            }
        }
    )*};
}

ints! {
    u32, i32;
    u64, i64;
}

fn join(low: u64, high: u64) -> u128 {
    u128::from(low) | u128::from(high) << 64
}

handlers! {
    fn binary[T: Int, const OP: Binary, const FORM: Form](m, op) {
        let (lhs, rhs, last) = given!(m.inputs::<T, FORM>(op));
        m.produce(op.a, attempt!(T::binary(OP, lhs, rhs)));
        go!(m, last.next);
    }

    fn unary[T: Int, const OP: Unary, const IS_LAST: bool](m, op) {
        let value = m.read::<T, IS_LAST>(op.b);
        m.produce(op.a, T::unary(OP, value));
    }

    fn wrap[const IS_LAST: bool](m, op) {
        let value = m.read::<u32, IS_LAST>(op.b);
        m.produce(op.a, value);
    }

    /// The results take the places of the first operands, from `imm` on.
    fn add_or_sub128[const ADDS: bool](m, op) {
        let [a, b, c, d] = given!(given!(m.range(op.imm, 4)).first_chunk());
        let (lhs, rhs) = (join(a.get(), b.get()), join(c.get(), d.get()));
        let result = if ADDS { lhs.wrapping_add(rhs) } else { lhs.wrapping_sub(rhs) };
        a.set(result as u64);
        b.set((result >> 64) as u64);
    }

    fn mul_wide[const IS_SIGNED: bool](m, op) {
        let [a, b] = given!(given!(m.range(op.imm, 2)).first_chunk());
        let product = if IS_SIGNED {
            (i128::from(a.get() as i64) * i128::from(b.get() as i64)) as u128
        } else {
            u128::from(a.get()) * u128::from(b.get())
        };
        a.set(product as u64);
        b.set((product >> 64) as u64);
    }
}

fn binary_of<T: Int>(op: Binary, form: Form) -> Handler {
    match form {
        Form::SlotLast => specialize!(op => const OP: Binary {
            Sub Shl ShrU ShrS Rotl Rotr DivS DivU RemS RemU
        }, binary::<T, OP, { Form::SlotLast }>),
        Form::ImmSlot | Form::ImmLast => specialize!(op => const OP: Binary { Sub Shl ShrU },
            specialize!(form => const FORM: Form { ImmSlot ImmLast }, binary::<T, OP, FORM>)),
        _ => specialize!(op => const OP: Binary {
            Add Mul And Or Xor Sub Shl ShrU ShrS Rotl Rotr DivS DivU RemS RemU
        }, specialize!(form => const FORM: Form { SlotSlot LastSlot SlotImm LastImm }, binary::<T, OP, FORM>)),
    }
}

pub(crate) fn for_binary(width: Width, op: Binary, form: Form) -> Handler {
    match (width, form) {
        (Width::W32, _) => binary_of::<u32>(op, form),
        (Width::W64, Form::SlotWide | Form::LastWide) => {
            specialize!(op => const OP: Binary { Add Mul And Or Xor },
                specialize!(form => const FORM: Form { SlotWide LastWide }, binary::<u64, OP, FORM>))
        }
        (Width::W64, _) => binary_of::<u64>(op, form),
    }
}

pub(crate) fn for_unary(width: Width, op: Unary, is_last: bool) -> Handler {
    specialize!(is_last => const IS_LAST: bool, match width {
        Width::W32 => specialize!(op => const OP: Unary { Clz Ctz Popcnt Extend8 Extend16 },
            unary::<u32, OP, IS_LAST>),
        Width::W64 => specialize!(op => const OP: Unary { Clz Ctz Popcnt Extend8 Extend16 Extend32 },
            unary::<u64, OP, IS_LAST>),
    })
}

pub(crate) fn for_wrap(is_last: bool) -> Handler {
    specialize!(is_last => const IS_LAST: bool, wrap::<IS_LAST>)
}

pub(crate) fn for_mul_wide(sign: Sign) -> Handler {
    specialize!(sign == Sign::Signed => const IS_SIGNED: bool, mul_wide::<IS_SIGNED>)
}
