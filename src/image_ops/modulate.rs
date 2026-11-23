use super::Pixel;
use bun_simd::prelude::*;

targets!(Upto<B32>);

#[simd]
fn adjust(pixels: u8xN<S>, brightness: f32, saturation: f32) -> u8xN<S> {
    let v = pixels.bitcast::<i32>();
    let (r, g, b) = (v & 255, v >> 8 & 255, v >> 16 & 255);
    let (r, g, b) = (r.cast::<f32>(), g.cast::<f32>(), b.cast::<f32>());
    // Rec.601
    let luma = r.mul_add_relaxed(0.299, g.mul_add_relaxed(0.587, b * 0.114));
    let mut adjusted = v & (255 << 24);
    for (channel, shift) in [(r, 0), (g, 8), (b, 16)] {
        let channel = (channel - luma).mul_add_relaxed(saturation, luma) * brightness + 0.5;
        adjusted |= channel.simd_clamp_relaxed(0.0, 255.0).cast_relaxed::<i32>() << shift;
    }
    adjusted.bitcast()
}

/// The model of Sharp's `modulate`: linear, without gamma correction.
#[kernel]
pub(crate) fn modulate(pixels: &mut [Pixel], brightness: f32, saturation: f32) {
    let (chunks, rest) = pixels
        .as_flattened_mut()
        .as_chunks_mut::<{ u8xN::<S>::LANES }>();
    for chunk in chunks {
        adjust(u8xN::load(chunk), brightness, saturation).store(chunk);
    }
    adjust(u8xN::load_or_default(rest), brightness, saturation).store_partial(rest);
}
