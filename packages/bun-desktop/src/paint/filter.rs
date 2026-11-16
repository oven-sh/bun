use resvg::tiny_skia::Transform;

use super::graph;
use super::raster::{Clip, Layer, Paint, average_scale, demultiply, multiply, premultiply};
use crate::abi::Filter;

/// https://drafts.fxtf.org/filter-effects/#ShorthandEquivalents: three rows, each with an offset.
fn color_matrix(filter: Filter) -> Option<[[f32; 4]; 3]> {
    let diagonal = |slope: f32, offset: f32| {
        [
            [slope, 0., 0., offset],
            [0., slope, 0., offset],
            [0., 0., slope, offset],
        ]
    };
    let towards = |target: [[f32; 3]; 3], amount: f32| {
        std::array::from_fn(|row| {
            let identity = |column: usize| if row == column { 1. - amount } else { 0. };
            let cell = |column: usize| target[row][column] * amount + identity(column);
            [cell(0), cell(1), cell(2), 0.]
        })
    };
    Some(match filter {
        Filter::Brightness(amount) => diagonal(amount, 0.),
        Filter::Contrast(amount) => diagonal(amount, 0.5 - amount * 0.5),
        Filter::Invert(amount) => diagonal(1. - amount.min(1.) * 2., amount.min(1.)),
        Filter::Grayscale(amount) => towards([[0.2126, 0.7152, 0.0722]; 3], amount.min(1.)),
        Filter::Saturate(amount) => towards([[0.213, 0.715, 0.072]; 3], 1. - amount),
        Filter::Sepia(amount) => towards(
            [
                [0.393, 0.769, 0.189],
                [0.349, 0.686, 0.168],
                [0.272, 0.534, 0.131],
            ],
            amount.min(1.),
        ),
        Filter::HueRotate(degrees) => {
            let (sin, cos) = degrees.to_radians().sin_cos();
            let cell = |base: f32, c: f32, s: f32| base + cos * c + sin * s;
            [
                [
                    cell(0.213, 0.787, -0.213),
                    cell(0.715, -0.715, -0.715),
                    cell(0.072, -0.072, 0.928),
                    0.,
                ],
                [
                    cell(0.213, -0.213, 0.143),
                    cell(0.715, 0.285, 0.140),
                    cell(0.072, -0.072, -0.283),
                    0.,
                ],
                [
                    cell(0.213, -0.213, -0.787),
                    cell(0.715, -0.715, 0.715),
                    cell(0.072, 0.928, 0.072),
                    0.,
                ],
            ]
        }
        _ => return None,
    })
}

pub fn apply(layer: &mut Layer, filters: &[Filter], matrix: &Transform) {
    let scale = average_scale(matrix);
    for filter in filters {
        match *filter {
            Filter::Blur(sigma) => layer.blur(sigma * scale),
            Filter::Opacity(amount) => layer.scale_alpha(amount),
            Filter::Luminance { linear } => {
                if linear {
                    graph::convert(layer, true);
                }
                for pixel in layer.pixels_mut() {
                    let [r, g, b, _] = pixel.map(f32::from);
                    *pixel = [
                        0,
                        0,
                        0,
                        (0.2125 * r + 0.7154 * g + 0.0721 * b).round() as u8,
                    ];
                }
            }
            Filter::DropShadow {
                offset: [x, y],
                blur,
                color,
            } => {
                let Some(mut result) = Layer::new(layer.rect) else {
                    continue;
                };
                let mut shadow = layer.alpha();
                shadow.blur(blur * scale);
                let (dx, dy) = (matrix.sx * x + matrix.kx * y, matrix.ky * x + matrix.sy * y);
                shadow.rect = shadow.rect.offset(dx.round() as i32, dy.round() as i32);
                let clip = Clip::new(layer.rect);
                result.fill_coverage(&shadow, &clip, &Paint::Solid(premultiply(color)));
                result.draw(layer, None, &clip);
                *layer = result;
            }
            filter => {
                let Some(rows) = color_matrix(filter) else {
                    continue;
                };
                for pixel in layer.pixels_mut().iter_mut().filter(|pixel| pixel[3] != 0) {
                    let [r, g, b, _] = demultiply(*pixel).map(f32::from);
                    for (channel, row) in rows.iter().enumerate() {
                        let value = r * row[0] + g * row[1] + b * row[2] + row[3] * 255.;
                        pixel[channel] = multiply((value + 0.5) as u8, pixel[3]);
                    }
                }
            }
        }
    }
}
