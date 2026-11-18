//! Comparisons that give a value or decide on a jump.

use bun_engine_asm::{Cond, FloatCond, FloatWidth, Width};

use super::control::jump;
use super::float::with_float;
use super::form::Form;
use crate::machine::{Handler, Number, given, go, handlers, specialize};

pub(crate) trait Comparable: Number {
    /// With the number of a `Cond` or `FloatCond`.
    fn holds<const COND: u8>(lhs: Self, rhs: Self) -> bool;
}

impl Comparable for u32 {
    #[inline(always)]
    fn holds<const COND: u8>(lhs: Self, rhs: Self) -> bool {
        Cond::ALL[usize::from(COND)].holds32(lhs as i32, rhs as i32)
    }
}

impl Comparable for u64 {
    #[inline(always)]
    fn holds<const COND: u8>(lhs: Self, rhs: Self) -> bool {
        Cond::ALL[usize::from(COND)].holds64(lhs as i64, rhs as i64)
    }
}

impl Comparable for f32 {
    #[inline(always)]
    fn holds<const COND: u8>(lhs: Self, rhs: Self) -> bool {
        FloatCond::ALL[usize::from(COND)].holds(lhs.into(), rhs.into())
    }
}

impl Comparable for f64 {
    #[inline(always)]
    fn holds<const COND: u8>(lhs: Self, rhs: Self) -> bool {
        FloatCond::ALL[usize::from(COND)].holds(lhs, rhs)
    }
}

handlers! {
    fn compare[T: Comparable, const COND: u8, const FORM: Form](m, op) {
        let (lhs, rhs, last) = given!(m.inputs::<T, FORM>(op));
        m.produce(op.a, u32::from(T::holds::<COND>(lhs, rhs)));
        go!(m, last.next);
    }

    /// The slots are in `a` and `b`, or a constant of 16 bits in `b`.
    fn branch[T: Comparable, const COND: u8, const FORM: Form, const IS_BACKWARD: bool](m, op) {
        let (lhs, rhs, last) = given!(m.pair::<T, FORM>(op, || op.a, || op.b, || op.b as i16 as u32));
        if T::holds::<COND>(lhs, rhs) {
            jump!(m, op.imm, IS_BACKWARD);
        }
        go!(m, last.next);
    }
}

macro_rules! with_cond {
    ($cond:expr => $COND:ident, $body:expr) => {
        specialize!($cond => const $COND: Cond as u8 { Eq Ne Lt Ge Le Gt Below AboveEq BelowEq Above }, $body)
    };
}

/// Those of instructions, and their opposites.
macro_rules! with_float_cond {
    ($cond:expr => $COND:ident, $body:expr) => {
        specialize!($cond => const $COND: FloatCond as u8 {
            Eq NeOrUnordered Lt GeOrUnordered Le GtOrUnordered Gt LeOrUnordered Ge LtOrUnordered
        }, $body)
    };
}

pub(crate) fn for_int_compare(width: Width, cond: Cond, form: Form) -> Handler {
    with_cond!(cond => COND, specialize!(form => const FORM: Form { SlotSlot LastSlot SlotImm LastImm },
        match width {
            Width::W32 => compare::<u32, COND, FORM>,
            Width::W64 => compare::<u64, COND, FORM>,
        }
    ))
}

pub(crate) fn for_float_compare(width: FloatWidth, cond: FloatCond, form: Form) -> Handler {
    with_float!(width => T, with_float_cond!(cond => COND,
        specialize!(form => const FORM: Form { SlotSlot LastSlot SlotImm LastImm }, compare::<T, COND, FORM>)))
}

pub(crate) fn for_int_branch(width: Width, cond: Cond, form: Form, is_backward: bool) -> Handler {
    with_cond!(cond => COND, specialize!(is_backward => const IS_BACKWARD: bool,
        specialize!(form => const FORM: Form { SlotSlot LastSlot SlotImm LastImm SlotWide LastWide },
            match width {
                Width::W32 => branch::<u32, COND, FORM, IS_BACKWARD>,
                Width::W64 => branch::<u64, COND, FORM, IS_BACKWARD>,
            }
        )
    ))
}

pub(crate) fn for_float_branch(
    width: FloatWidth,
    cond: FloatCond,
    form: Form,
    is_backward: bool,
) -> Handler {
    with_float!(width => T, specialize!(is_backward => const IS_BACKWARD: bool,
        with_float_cond!(cond => COND,
            specialize!(form => const FORM: Form { SlotSlot LastSlot SlotWide LastWide },
                branch::<T, COND, FORM, IS_BACKWARD>))))
}
