//! https://drafts.fxtf.org/compositing/

use super::raster::{Pixel, multiply};

#[derive(Clone, Copy, PartialEq)]
pub enum Mode {
    Clear,
    Source,
    Destination,
    SourceOver,
    DestinationOver,
    SourceIn,
    DestinationIn,
    SourceOut,
    DestinationOut,
    SourceAtop,
    DestinationAtop,
    Xor,
    Plus,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Multiply,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

type Color = [f32; 3];

/// `factors` gets the alpha of the source and of the backdrop, and gives how much there is of each.
fn composite(row: &mut [Pixel], source: &[Pixel], factors: impl Fn(u8, u8) -> (u8, u8)) {
    for (below, above) in row.iter_mut().zip(source) {
        let (a, b) = factors(above[3], below[3]);
        let sum = |it: usize| {
            u32::from(above[it]) * u32::from(a) + u32::from(below[it]) * u32::from(b) + 128
        };
        *below = std::array::from_fn(|it| ((sum(it) + (sum(it) >> 8)) >> 8).min(255) as u8);
    }
}

/// `blend` gets the colors of the source and of the backdrop, which are not premultiplied.
fn mix(row: &mut [Pixel], source: &[Pixel], blend: impl Fn(Color, Color) -> Color) {
    for (below, above) in row.iter_mut().zip(source).filter(|it| it.1[3] != 0) {
        let straight = |pixel: &Pixel| {
            std::array::from_fn(|it| (f32::from(pixel[it]) / f32::from(pixel[3].max(1))).min(1.))
        };
        let (blended, alpha) = (
            blend(straight(above), straight(below)),
            above[3] + multiply(below[3], 255 - above[3]),
        );
        let (a, b) = (f32::from(above[3]) / 255., f32::from(below[3]) / 255.);
        for it in 0..3 {
            let value = f32::from(above[it]) * (1. - b)
                + f32::from(below[it]) * (1. - a)
                + blended[it] * a * b * 255.;
            below[it] = ((value + 0.5) as u8).min(alpha);
        }
        below[3] = alpha;
    }
}

fn mix_channels(row: &mut [Pixel], source: &[Pixel], blend: impl Fn(f32, f32) -> f32) {
    mix(row, source, |above, below| {
        std::array::from_fn(|it| blend(above[it], below[it]))
    });
}

fn hard_light(s: f32, b: f32) -> f32 {
    if s <= 0.5 {
        2. * s * b
    } else {
        1. - 2. * (1. - s) * (1. - b)
    }
}

fn soft_light(s: f32, b: f32) -> f32 {
    match s <= 0.5 {
        true => b - (1. - 2. * s) * b * (1. - b),
        false => {
            b + (2. * s - 1.)
                * (if b <= 0.25 {
                    ((16. * b - 12.) * b + 4.) * b
                } else {
                    b.sqrt()
                } - b)
        }
    }
}

fn luminosity([r, g, b]: Color) -> f32 {
    0.3 * r + 0.59 * g + 0.11 * b
}

fn extremes([r, g, b]: Color) -> (f32, f32) {
    (r.min(g).min(b), r.max(g).max(b))
}

fn with_luminosity(color: Color, wanted: f32) -> Color {
    let color = color.map(|it| it + wanted - luminosity(color));
    let (low, high) = extremes(color);
    let color = if low < 0. {
        color.map(|it| wanted + (it - wanted) * wanted / (wanted - low))
    } else {
        color
    };
    if high > 1. {
        color.map(|it| wanted + (it - wanted) * (1. - wanted) / (high - wanted))
    } else {
        color
    }
}

fn with_saturation_of(color: Color, other: Color) -> Color {
    let ((low, high), (least, most)) = (extremes(color), extremes(other));
    color.map(|it| {
        if high > low {
            (it - low) * (most - least) / (high - low)
        } else {
            0.
        }
    })
}

pub fn blend(row: &mut [Pixel], source: &[Pixel], mode: Mode) {
    match mode {
        Mode::Clear => row.fill([0; 4]),
        Mode::Source => row.copy_from_slice(source),
        Mode::Destination => {}
        Mode::SourceOver => composite(row, source, |a, _| (255, 255 - a)),
        Mode::DestinationOver => composite(row, source, |_, b| (255 - b, 255)),
        Mode::SourceIn => composite(row, source, |_, b| (b, 0)),
        Mode::DestinationIn => composite(row, source, |a, _| (0, a)),
        Mode::SourceOut => composite(row, source, |_, b| (255 - b, 0)),
        Mode::DestinationOut => composite(row, source, |a, _| (0, 255 - a)),
        Mode::SourceAtop => composite(row, source, |a, b| (b, 255 - a)),
        Mode::DestinationAtop => composite(row, source, |a, b| (255 - b, a)),
        Mode::Xor => composite(row, source, |a, b| (255 - b, 255 - a)),
        Mode::Plus => composite(row, source, |_, _| (255, 255)),
        Mode::Screen => mix_channels(row, source, |s, b| s + b - s * b),
        Mode::Overlay => mix_channels(row, source, |s, b| hard_light(b, s)),
        Mode::Darken => mix_channels(row, source, f32::min),
        Mode::Lighten => mix_channels(row, source, f32::max),
        Mode::ColorDodge => mix_channels(row, source, |s, b| {
            if b == 0. { 0. } else { (b / (1. - s)).min(1.) }
        }),
        Mode::ColorBurn => mix_channels(row, source, |s, b| {
            if b == 1. {
                1.
            } else {
                1. - ((1. - b) / s).min(1.)
            }
        }),
        Mode::HardLight => mix_channels(row, source, hard_light),
        Mode::SoftLight => mix_channels(row, source, soft_light),
        Mode::Difference => mix_channels(row, source, |s, b| (s - b).abs()),
        Mode::Exclusion => mix_channels(row, source, |s, b| s + b - 2. * s * b),
        Mode::Multiply => mix_channels(row, source, |s, b| s * b),
        Mode::Hue => mix(row, source, |s, b| {
            with_luminosity(with_saturation_of(s, b), luminosity(b))
        }),
        Mode::Saturation => mix(row, source, |s, b| {
            with_luminosity(with_saturation_of(b, s), luminosity(b))
        }),
        Mode::Color => mix(row, source, |s, b| with_luminosity(s, luminosity(b))),
        Mode::Luminosity => mix(row, source, |s, b| with_luminosity(b, luminosity(s))),
    }
}
