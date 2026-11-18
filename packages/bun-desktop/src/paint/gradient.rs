use super::raster::{Pixel, map_point};
use crate::abi::GradientStop;
use crate::gfx::Transform;

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

    /// For `vector/shader.h`. False if it has no colors, or too many.
    pub fn describe(&self, words: &mut Vec<[u32; 4]>, max_stops: usize) -> bool {
        let (Some(first), Some(last), true) = (
            self.stops.first(),
            self.stops.last(),
            self.stops.len() <= max_stops,
        ) else {
            return false;
        };
        let (kind, [a, b, c], [d, e, f]) = match self.geometry {
            Geometry::Linear {
                from: [a, b],
                to: [c, d],
            } => (0, [a, b, 0.], [c, d, 0.]),
            Geometry::Radial { from, to } => (1, from, to),
            Geometry::Sweep {
                center: [x, y],
                start,
                span,
            } => (2, [x, y, start], [x, y, span]),
        };
        words.extend(
            [[a, b, c, first.0], [d, e, f, last.0 - first.0]].map(|it| it.map(f32::to_bits)),
        );
        words.push([
            kind,
            self.spread as u32,
            self.stops.len() as u32,
            self.premultiplied.into(),
        ]);
        words.extend(
            self.stops
                .iter()
                .flat_map(|(offset, color)| [[offset.to_bits(); 4], color.map(f32::to_bits)]),
        );
        true
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
                    return (b != 0.).then_some(c / (2. * b)).filter(is_valid);
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

    /// For offsets that grow by `step` from one pixel to the next.
    fn shade_evenly(&self, first: f32, step: f32, row: &mut [Pixel]) {
        let mut start = 0;
        while start < row.len() {
            let offset = first + step * start as f32;
            let next = self.stops.partition_point(|stop| stop.0 <= offset);
            let edge = if step > 0. {
                self.stops.get(next)
            } else {
                next.checked_sub(1).map(|it| &self.stops[it])
            };
            let steps = edge.map_or(f32::MAX, |it| {
                if step > 0. {
                    ((it.0 - first) / step).ceil()
                } else {
                    ((it.0 - first) / step).floor() + 1.
                }
            });
            let end = (steps as usize).clamp(start + 1, row.len());
            let [from, to] = [offset, first + step * (end - 1) as f32];
            let inside = |it: f32| {
                it.max(next.checked_sub(1).map_or(f32::MIN, |it| self.stops[it].0))
                    .min(self.stops.get(next).map_or(f32::MAX, |it| it.0.next_down()))
            };
            let [a, b] = [from, inside(to)]
                .map(|it| self.color_at(it).map(|it| ((it + 0.5) * 65536.) as i32));
            let (mut color, by): (_, [i32; 4]) = (
                a,
                std::array::from_fn(|it| (b[it] - a[it]) / (end - start - 1).max(1) as i32),
            );
            for pixel in &mut row[start..end] {
                *pixel = color.map(|it| (it >> 16) as u8);
                color = std::array::from_fn(|it| color[it] + by[it]);
            }
            start = end;
        }
    }

    /// `inverse` maps device pixels to the gradient's space.
    pub fn shade(&self, inverse: &Transform, x: i32, y: i32, row: &mut [Pixel]) {
        if let (Geometry::Linear { from, to }, Spread::Pad) = (self.geometry, self.spread)
            && (self.premultiplied || self.stops.array_windows().all(|[a, b]| a.1[3] == b.1[3]))
        {
            let ((x, y), dx, dy) = (
                map_point(inverse, x as f32 + 0.5, y as f32 + 0.5),
                to[0] - from[0],
                to[1] - from[1],
            );
            let step = (inverse.sx * dx + inverse.ky * dy) / (dx * dx + dy * dy);
            if let Some(first) = self
                .offset_at(x, y)
                .filter(|it| it.is_finite() && step.is_finite())
            {
                return self.shade_evenly(first, step, row);
            }
        }
        for (index, pixel) in row.iter_mut().enumerate() {
            let (x, y) = map_point(inverse, (x + index as i32) as f32 + 0.5, y as f32 + 0.5);
            *pixel = self.pixel_at(x, y);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_row_is_like_its_pixels() {
        let stops = [
            (0.1, 0xFF00_00FF),
            (0.4, 0x00FF_0080),
            (0.4, 0x0000_FFFF),
            (0.41, 0),
            (0.9, 0xFFFF_FFFF),
        ]
        .map(|(offset, color)| GradientStop { offset, color });
        let gradient = Gradient::new(
            Geometry::Linear {
                from: [10., 5.],
                to: [250., 40.],
            },
            &stops,
            Spread::Pad,
            true,
        );
        for inverse in [
            Transform::identity(),
            Transform::from_row(-1., 0.3, 0.2, 1., 300., 0.),
            Transform::from_row(0., 0., 3., 1., 0., 0.),
        ] {
            for y in 0..60 {
                let mut row = [[0; 4]; 300];
                gradient.shade(&inverse, 0, y, &mut row);
                let differs = |(x, it): &(i32, Pixel)| {
                    let (x, y) = map_point(&inverse, *x as f32 + 0.5, y as f32 + 0.5);
                    gradient
                        .pixel_at(x, y)
                        .iter()
                        .zip(it)
                        .any(|(a, b)| a.abs_diff(*b) > 1)
                };
                assert_eq!((0..).zip(row).find(differs), None, "row {y}");
            }
        }
    }
}
