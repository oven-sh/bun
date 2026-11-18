use bun_engine_macros::direct_form;
use bun_engine_number::math;

use super::operand::{Negatable, SmallExponent, ToInt32, ToNumber};
use super::outcome::{Ranged, Real, Same};
use crate::{Gc, GlobalObject};

#[direct_form]
fn int32_itself(_: i32) -> Same<0>;

#[direct_form]
fn number_itself(_: ToNumber) -> Same<0>;

macro_rules! unary {
    ($($name:ident)*) => {$(
        #[direct_form(pure)]
        fn $name(x: ToNumber) -> f64 {
            math::$name(x.0)
        }
    )*};
}

unary! {
    abs sign ceil floor round trunc sqrt fround f16round
    acos acosh asin asinh atan atanh cbrt cos cosh exp expm1 log log10 log1p log2 sin sinh tan tanh
}

macro_rules! binary {
    ($($name:ident)*) => {$(
        #[direct_form(pure)]
        fn $name(x: ToNumber, y: ToNumber) -> f64 {
            math::$name(x.0, y.0)
        }
    )*};
}

binary!(atan2 hypot max min pow);

#[direct_form(pure)]
fn hypot3(x: ToNumber, y: ToNumber, z: ToNumber) -> f64 {
    math::hypot3(x.0, y.0, z.0)
}

#[direct_form(pure)]
fn pow_by_squaring(base: ToNumber, exponent: SmallExponent) -> f64 {
    math::pow_by_squaring(base.0, exponent.0 as u32)
}

#[direct_form(pure)]
fn abs_of_int32(x: Negatable) -> Ranged<0, { i32::MAX }> {
    Ranged::new(x.0.wrapping_abs())
}

#[direct_form(pure)]
fn sign_of_int32(x: i32) -> Ranged<-1, 1> {
    x.cmp(&0).into()
}

#[direct_form(pure)]
fn max_of_int32(x: i32, y: i32) -> i32 {
    x.max(y)
}

#[direct_form(pure)]
fn min_of_int32(x: i32, y: i32) -> i32 {
    x.min(y)
}

#[direct_form(pure)]
pub fn imul(x: ToInt32, y: ToInt32) -> i32 {
    x.0.wrapping_mul(y.0)
}

#[direct_form(pure)]
pub fn clz32(x: ToInt32) -> Ranged<0, 32> {
    Ranged::new(x.0.leading_zeros() as i32)
}

#[direct_form(writes(RANDOM))]
pub fn random(global: Gc<GlobalObject>) -> Real {
    let mut state = global.random_state().get();
    let result = state.next_f64();
    global.random_state().set(state);
    Real::new(result)
}
