//! `lossless.c`: the predictors, on blocks of 16 bytes at a time, which the compiler turns into vector instructions.

/// The blue, green, red and alpha of a pixel.
pub(super) type Pixel = [u8; 4];

/// Four pixels.
pub(super) type Block = [u8; 16];

pub(super) const BLACK: Pixel = [0, 0, 0, 0xff];

/// `pixel`, followed by three pixels of no interest.
#[inline(always)]
pub(super) fn block_of(pixel: Pixel) -> Block {
    let [b, g, r, a] = pixel;
    [b, g, r, a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}

#[inline(always)]
pub(super) fn first_pixel(block: Block) -> Pixel {
    let [b, g, r, a, ..] = block;
    [b, g, r, a]
}

#[inline(always)]
fn zip_with(a: Block, b: Block, f: impl Fn(u8, u8) -> u8) -> Block {
    let mut out = [0; 16];
    for ((out, a), b) in out.iter_mut().zip(a).zip(b) {
        *out = f(a, b);
    }
    out
}

/// `VP8LAddPixels`
#[inline(always)]
pub(super) fn add_pixels(a: Block, b: Block) -> Block {
    zip_with(a, b, u8::wrapping_add)
}

#[inline(always)]
fn average2(a0: Block, a1: Block) -> Block {
    zip_with(a0, a1, |a0, a1| {
        ((u16::from(a0) + u16::from(a1)) >> 1) as u8
    })
}

#[inline(always)]
fn average3(a0: Block, a1: Block, a2: Block) -> Block {
    average2(average2(a0, a2), a1)
}

#[inline(always)]
fn average4(a0: Block, a1: Block, a2: Block, a3: Block) -> Block {
    average2(average2(a0, a1), average2(a2, a3))
}

/// `c0 + c1 - c2`, clamped to 0..=255.
#[inline(always)]
fn clamped_add_subtract_full(c0: Block, c1: Block, c2: Block) -> Block {
    let up = zip_with(c1, c2, u8::saturating_sub);
    let down = zip_with(c2, c1, u8::saturating_sub);
    zip_with(
        zip_with(c0, up, u8::saturating_add),
        down,
        u8::saturating_sub,
    )
}

/// `ave + (ave - c2) / 2`, clamped to 0..=255, where `ave` is the average of `c0` and `c1`.
#[inline(always)]
fn clamped_add_subtract_half(c0: Block, c1: Block, c2: Block) -> Block {
    zip_with(average2(c0, c1), c2, |ave, c2| {
        let diff = i16::from(ave) - i16::from(c2);
        // The division rounds towards zero.
        let half = (diff + ((diff >> 15) & 1)) >> 1;
        (i16::from(ave) + half).clamp(0, 255) as u8
    })
}

/// The sum over the channels of the first pixel of the absolute differences.
#[inline(always)]
fn distance(a: Block, b: Block) -> u32 {
    first_pixel(zip_with(a, b, u8::abs_diff))
        .into_iter()
        .map(u32::from)
        .sum()
}

/// `a` or `b`, whichever has the first pixel closer to that of `a + b - c`.
#[inline(always)]
fn select(a: Block, b: Block, c: Block) -> Block {
    if distance(b, c) <= distance(a, c) {
        a
    } else {
        b
    }
}

/// Whether `predict` looks at `left`.
pub(super) const fn uses_left(mode: u32) -> bool {
    matches!(mode, 1 | 5 | 6 | 7 | 10..=13)
}

/// `VP8LPredictors[mode]` for four pixels from their neighbors. Mode 11 is right for the first pixel only.
#[inline(always)]
pub(super) fn predict(
    mode: u32,
    left: Block,
    top_left: Block,
    top: Block,
    top_right: Block,
) -> Block {
    match mode {
        1 => left,
        2 => top,
        3 => top_right,
        4 => top_left,
        5 => average3(left, top, top_right),
        6 => average2(left, top_left),
        7 => average2(left, top),
        8 => average2(top_left, top),
        9 => average2(top, top_right),
        10 => average4(left, top_left, top, top_right),
        11 => select(top, left, top_left),
        12 => clamped_add_subtract_full(left, top, top_left),
        13 => clamped_add_subtract_half(left, top, top_left),
        _ => {
            let [b, g, r, a] = BLACK;
            [b, g, r, a, b, g, r, a, b, g, r, a, b, g, r, a]
        }
    }
}
