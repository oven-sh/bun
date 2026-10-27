//! `lossless.c`, `lossless_common.h`: the 14 spatial predictors. Each guesses a pixel from its left, top-left, top
//! and top-right neighbours.

use crate::vp8l::format_constants::ARGB_BLACK;

/// `VP8LSubPixels`: the difference of each component, modulo 256.
#[inline]
pub(crate) const fn sub_pixels(a: u32, b: u32) -> u32 {
    let alpha_and_green = 0x00ff_00ffu32
        .wrapping_add(a & 0xff00_ff00)
        .wrapping_sub(b & 0xff00_ff00);
    let red_and_blue = 0xff00_ff00u32
        .wrapping_add(a & 0x00ff_00ff)
        .wrapping_sub(b & 0x00ff_00ff);
    (alpha_and_green & 0xff00_ff00) | (red_and_blue & 0x00ff_00ff)
}

#[inline]
const fn average2(a0: u32, a1: u32) -> u32 {
    (((a0 ^ a1) & 0xfefe_fefe) >> 1) + (a0 & a1)
}

#[inline]
const fn average3(a0: u32, a1: u32, a2: u32) -> u32 {
    average2(average2(a0, a2), a1)
}

#[inline]
const fn average4(a0: u32, a1: u32, a2: u32, a3: u32) -> u32 {
    average2(average2(a0, a1), average2(a2, a3))
}

/// Applies `f` to each of the four components.
#[inline]
fn per_component(a: u32, b: u32, c: u32, f: impl Fn(i32, i32, i32) -> i32) -> u32 {
    let [a0, a1, a2, a3] = a.to_le_bytes();
    let [b0, b1, b2, b3] = b.to_le_bytes();
    let [c0, c1, c2, c3] = c.to_le_bytes();
    let one = |a: u8, b: u8, c: u8| f(a.into(), b.into(), c.into()).clamp(0, 255) as u8;
    u32::from_le_bytes([
        one(a0, b0, c0),
        one(a1, b1, c1),
        one(a2, b2, c2),
        one(a3, b3, c3),
    ])
}

#[inline]
fn clamped_add_subtract_full(c0: u32, c1: u32, c2: u32) -> u32 {
    per_component(c0, c1, c2, |a, b, c| a + b - c)
}

#[inline]
fn clamped_add_subtract_half(c0: u32, c1: u32, c2: u32) -> u32 {
    per_component(average2(c0, c1), c2, 0, |a, b, _| a + (a - b) / 2)
}

/// Whichever of `a` and `b` is nearer to `a + b - c`, by the sum of the distances of the components.
#[inline]
fn select(a: u32, b: u32, c: u32) -> u32 {
    let pa_minus_pb: i32 = a
        .to_le_bytes()
        .into_iter()
        .zip(b.to_le_bytes())
        .zip(c.to_le_bytes())
        .map(|((a, b), c)| i32::from(b.abs_diff(c)) - i32::from(a.abs_diff(c)))
        .sum();
    if pa_minus_pb <= 0 { a } else { b }
}

#[inline]
pub(crate) fn predictor0(_left: u32, _top_left: u32, _top: u32, _top_right: u32) -> u32 {
    ARGB_BLACK
}

#[inline]
pub(crate) fn predictor1(left: u32, _top_left: u32, _top: u32, _top_right: u32) -> u32 {
    left
}

#[inline]
pub(crate) fn predictor2(_left: u32, _top_left: u32, top: u32, _top_right: u32) -> u32 {
    top
}

#[inline]
pub(crate) fn predictor3(_left: u32, _top_left: u32, _top: u32, top_right: u32) -> u32 {
    top_right
}

#[inline]
pub(crate) fn predictor4(_left: u32, top_left: u32, _top: u32, _top_right: u32) -> u32 {
    top_left
}

#[inline]
pub(crate) fn predictor5(left: u32, _top_left: u32, top: u32, top_right: u32) -> u32 {
    average3(left, top, top_right)
}

#[inline]
pub(crate) fn predictor6(left: u32, top_left: u32, _top: u32, _top_right: u32) -> u32 {
    average2(left, top_left)
}

#[inline]
pub(crate) fn predictor7(left: u32, _top_left: u32, top: u32, _top_right: u32) -> u32 {
    average2(left, top)
}

#[inline]
pub(crate) fn predictor8(_left: u32, top_left: u32, top: u32, _top_right: u32) -> u32 {
    average2(top_left, top)
}

#[inline]
pub(crate) fn predictor9(_left: u32, _top_left: u32, top: u32, top_right: u32) -> u32 {
    average2(top, top_right)
}

#[inline]
pub(crate) fn predictor10(left: u32, top_left: u32, top: u32, top_right: u32) -> u32 {
    average4(left, top_left, top, top_right)
}

#[inline]
pub(crate) fn predictor11(left: u32, top_left: u32, top: u32, _top_right: u32) -> u32 {
    select(top, left, top_left)
}

#[inline]
pub(crate) fn predictor12(left: u32, top_left: u32, top: u32, _top_right: u32) -> u32 {
    clamped_add_subtract_full(left, top, top_left)
}

#[inline]
pub(crate) fn predictor13(left: u32, top_left: u32, top: u32, _top_right: u32) -> u32 {
    clamped_add_subtract_half(left, top, top_left)
}
