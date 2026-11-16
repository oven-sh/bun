use resvg::tiny_skia::Transform;

use super::raster::{Pixel, map_point};
use crate::abi::GradientStop;

#[derive(Clone, Copy)]
pub enum Geometry {
    Linear {
        from: [f32; 2],
        to: [f32; 2],
    },
    /// Between two circles.
    Radial {
        from: [f32; 3],
        to: [f32; 3],
    },
    /// Radians, clockwise from the positive x axis.
    Sweep {
        center: [f32; 2],
        start: f32,
        span: f32,
    },
}

#[derive(Clone, Copy, PartialEq)]
pub enum Spread {
    Pad,
    Repeat,
    Reflect,
}

pub struct Gradient {
    geometry: Geometry,
    spread: Spread,
    /// CSS interpolates premultiplied colors, and a canvas does not.
    premultiplied: bool,
    stops: Vec<(f32, [f32; 4])>,
}

impl Gradient {
    pub fn new(
        geometry: Geometry,
        stops: &[GradientStop],
        spread: Spread,
        premultiplied: bool,
    ) -> Gradient {
        let stops = stops.iter().map(|stop| {
            let [r, g, b, a] = stop.color.to_be_bytes().map(f32::from);
            let scale = if premultiplied { a / 255. } else { 1. };
            (stop.offset, [r * scale, g * scale, b * scale, a])
        });
        Gradient {
            geometry,
            spread,
            premultiplied,
            stops: stops.collect(),
        }
    }

    /// Premultiplied, from 0 to 255.
    pub fn color_at(&self, mut offset: f32) -> [f32; 4] {
        let (Some(first), Some(last)) = (self.stops.first(), self.stops.last()) else {
            return [0.; 4];
        };
        let period = last.0 - first.0;
        if self.spread != Spread::Pad && period > 0. {
            let turns = (offset - first.0) / period;
            let fraction = turns - turns.floor();
            let is_reflected = self.spread == Spread::Reflect && turns.floor().rem_euclid(2.) == 1.;
            offset = first.0
                + period
                    * if is_reflected {
                        1. - fraction
                    } else {
                        fraction
                    };
        }
        let next = self.stops.partition_point(|stop| stop.0 <= offset);
        let color = match (
            next.checked_sub(1).map(|index| self.stops[index]),
            self.stops.get(next),
        ) {
            (Some((from, a)), Some((to, b))) => {
                let progress = (offset - from) / (to - from);
                std::array::from_fn(|channel| a[channel] + (b[channel] - a[channel]) * progress)
            }
            (Some(_), None) => last.1,
            (None, _) => first.1,
        };
        let scale = if self.premultiplied {
            1.
        } else {
            color[3] / 255.
        };
        [
            color[0] * scale,
            color[1] * scale,
            color[2] * scale,
            color[3],
        ]
    }

    fn offset_at(&self, x: f32, y: f32) -> Option<f32> {
        match self.geometry {
            Geometry::Linear { from, to } => {
                let (dx, dy) = (to[0] - from[0], to[1] - from[1]);
                let length = dx * dx + dy * dy;
                Some(if length > 0. {
                    ((x - from[0]) * dx + (y - from[1]) * dy) / length
                } else {
                    1.
                })
            }
            Geometry::Radial { from, to } => {
                let (cx, cy, dr) = (to[0] - from[0], to[1] - from[1], to[2] - from[2]);
                let (px, py) = (x - from[0], y - from[1]);
                let a = cx * cx + cy * cy - dr * dr;
                let b = px * cx + py * cy + from[2] * dr;
                let c = px * px + py * py - from[2] * from[2];
                let is_valid = |offset: &f32| from[2] + offset * dr >= 0.;
                if a.abs() < 1e-9 {
                    return (b != 0.).then(|| c / (2. * b)).filter(is_valid);
                }
                let root = (b * b - a * c).sqrt();
                let (one, other) = ((b + root) / a, (b - root) / a);
                [one.max(other), one.min(other)].into_iter().find(is_valid)
            }
            Geometry::Sweep {
                center,
                start,
                span,
            } => {
                let angle = (y - center[1]).atan2(x - center[0]) - start;
                Some(angle.rem_euclid(std::f32::consts::TAU) / span)
            }
        }
    }

    pub fn pixel_at(&self, x: f32, y: f32) -> Pixel {
        let color = self
            .offset_at(x, y)
            .map_or([0.; 4], |offset| self.color_at(offset));
        color.map(|channel| (channel + 0.5) as u8)
    }

    /// `inverse` maps device pixels to the gradient's space.
    pub fn shade(&self, inverse: &Transform, x: i32, y: i32, row: &mut [Pixel]) {
        for (index, pixel) in row.iter_mut().enumerate() {
            let (x, y) = map_point(inverse, (x + index as i32) as f32 + 0.5, y as f32 + 0.5);
            *pixel = self.pixel_at(x, y);
        }
    }
}
