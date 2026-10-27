//! `lossless.c`: the 14 predictors of a pixel from its left, top-left, top and top-right neighbors.

/// One pixel or several next to each other, in the form that suits the decoder or the encoder.
pub(crate) trait Pixels: Copy {
    const BLACK: Self;
    fn average2(a0: Self, a1: Self) -> Self;
    /// `a` or `b`, whichever is closer to `a + b - c` by the sum of the distances of the channels.
    fn select(a: Self, b: Self, c: Self) -> Self;
    /// `c0 + c1 - c2`, clamped to 0..=255.
    fn clamped_add_subtract_full(c0: Self, c1: Self, c2: Self) -> Self;
    /// `ave + (ave - c2) / 2`, clamped to 0..=255, where `ave` is the average of `c0` and `c1`.
    fn clamped_add_subtract_half(c0: Self, c1: Self, c2: Self) -> Self;
}

#[inline(always)]
fn average3<P: Pixels>(a0: P, a1: P, a2: P) -> P {
    P::average2(P::average2(a0, a2), a1)
}

#[inline(always)]
fn average4<P: Pixels>(a0: P, a1: P, a2: P, a3: P) -> P {
    P::average2(P::average2(a0, a1), P::average2(a2, a3))
}

/// Whether `predict` looks at `left`.
pub(crate) const fn uses_left(mode: u32) -> bool {
    matches!(mode, 1 | 5 | 6 | 7 | 10..=13)
}

/// `VP8LPredictors[mode]`
#[inline(always)]
pub(crate) fn predict<P: Pixels>(mode: u32, left: P, top_left: P, top: P, top_right: P) -> P {
    match mode {
        1 => left,
        2 => top,
        3 => top_right,
        4 => top_left,
        5 => average3(left, top, top_right),
        6 => P::average2(left, top_left),
        7 => P::average2(left, top),
        8 => P::average2(top_left, top),
        9 => P::average2(top, top_right),
        10 => average4(left, top_left, top, top_right),
        11 => P::select(top, left, top_left),
        12 => P::clamped_add_subtract_full(left, top, top_left),
        13 => P::clamped_add_subtract_half(left, top, top_left),
        _ => P::BLACK,
    }
}
