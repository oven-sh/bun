use super::raster::{Pixel, map_point, prefer_wide};
use super::scan::Floats;
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

/// From one color to another, along a line.
#[derive(Clone, Copy)]
pub struct Ramp {
    pub(super) ends: [[f32; 4]; 2],
    /// How much of the way the pixel at `origin` has come, and what a column and a row add to that.
    origin: [i32; 2],
    first: f32,
    pub(super) steps: [f32; 2],
}

impl Ramp {
    pub(super) fn at(&self, x: i32, y: i32) -> f32 {
        self.first
            + (x - self.origin[0]) as f32 * self.steps[0]
            + (y - self.origin[1]) as f32 * self.steps[1]
    }

    pub fn shade(&self, x: i32, y: i32, row: &mut [Pixel]) {
        shade_between(self.ends, self.at(x, y), self.steps[0], row);
    }
}

pub(super) struct Mixer<F> {
    start: [F; 4],
    by: [F; 4],
    steps: F,
}

impl<F: Floats> Mixer<F> {
    #[inline(always)]
    pub(super) fn new([from, to]: [[f32; 4]; 2], step: f32) -> Self {
        let all = |it: f32| F::new([it; 8]);
        Mixer {
            start: from.map(|it| all(it + 0.5)),
            by: [0, 1, 2, 3].map(|it| all(to[it] - from[it])),
            steps: F::new(std::array::from_fn(|it| it as f32 * step)),
        }
    }

    /// The first pixel is at `first` of the way from one to the other.
    #[inline(always)]
    pub(super) fn eight(&self, first: f32) -> [Pixel; 8] {
        let (Mixer { start, by, steps }, all) = (self, |it: f32| F::new([it; 8]));
        let progress = all(first).add(*steps).max(all(0.)).min(all(1.));
        let [r, g, b, a] = [
            start[0].add(by[0].mul(progress)).whole(),
            start[1].add(by[1].mul(progress)).whole(),
            start[2].add(by[2].mul(progress)).whole(),
            start[3].add(by[3].mul(progress)).whole(),
        ];
        let mut colors = [[0; 4]; 8];
        for (it, color) in colors.iter_mut().enumerate() {
            *color = (r[it] | g[it] << 8 | b[it] << 16 | a[it] << 24).to_le_bytes();
        }
        colors
    }
}

#[inline(always)]
pub(super) fn between<F: Floats>(ends: [[f32; 4]; 2], first: f32, step: f32, row: &mut [Pixel]) {
    let mixer = Mixer::<F>::new(ends, step);
    for (index, run) in row.chunks_mut(8).enumerate() {
        let colors = mixer.eight(first + (index * 8) as f32 * step);
        match run.first_chunk_mut() {
            Some(run) => *run = colors,
            None => run.copy_from_slice(&colors[..run.len()]),
        }
    }
}

fn shade_between(ends: [[f32; 4]; 2], first: f32, step: f32, row: &mut [Pixel]) {
    prefer_wide!(shade_between(ends, first, step, row));
    between::<[f32; 8]>(ends, first, step, row);
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

    /// Of the stops, without alpha.
    pub fn average(&self) -> u32 {
        let [r, g, b] = [0, 1, 2].map(|at| {
            (self.stops.iter().map(|it| it.1[at]).sum::<f32>() / self.stops.len() as f32 + 0.5)
                as u8
        });
        u32::from_be_bytes([r, g, b, 255])
    }

    /// Everywhere.
    pub fn is_opaque(&self) -> bool {
        let covers_all = match self.geometry {
            Geometry::Radial { from, to } => {
                (to[0] - from[0]).hypot(to[1] - from[1]) < (to[2] - from[2]).abs() * 0.99
            }
            _ => true,
        };
        covers_all && !self.stops.is_empty() && self.stops.iter().all(|it| it.1[3] == 255.)
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
        if let [(from, a), (to, b)] = self.stops[..]
            && to - from > 1e-3
        {
            let scale = if self.premultiplied { 1. } else { a[3] / 255. };
            return shade_between(
                [a, b].map(|[r, g, b, a]| [r * scale, g * scale, b * scale, a]),
                (first - from) / (to - from),
                step / (to - from),
                row,
            );
        }
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

    /// If that is all it is. It is most exact near `origin`.
    pub fn ramp(&self, inverse: &Transform, origin: [i32; 2]) -> Option<Ramp> {
        let (Geometry::Linear { from, to }, Spread::Pad, &[(start, a), (end, b)]) =
            (self.geometry, self.spread, &self.stops[..])
        else {
            return None;
        };
        let ((x, y), dx, dy) = (
            map_point(inverse, origin[0] as f32 + 0.5, origin[1] as f32 + 0.5),
            to[0] - from[0],
            to[1] - from[1],
        );
        let steps = [
            inverse.sx * dx + inverse.ky * dy,
            inverse.kx * dx + inverse.sy * dy,
        ]
        .map(|it| it / (dx * dx + dy * dy) / (end - start));
        let (first, scale) = (
            (self.offset_at(x, y)? - start) / (end - start),
            if self.premultiplied { 1. } else { a[3] / 255. },
        );
        let is_plain = (self.premultiplied || a[3] == b[3])
            && end - start > 1e-3
            && (first + steps[0] + steps[1]).is_finite();
        is_plain.then(|| Ramp {
            ends: [a, b].map(|[r, g, b, a]| [r * scale, g * scale, b * scale, a]),
            origin,
            first,
            steps,
        })
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
    fn a_ramp_is_like_its_rows() {
        use super::super::raster::{Clip, IntRect, Layer, Paint};
        use crate::gfx::{Command::*, Fill, Point};
        let at = Point::new;
        let path = [
            MoveTo(at(0., 0.)),
            CurveTo(at(90., -40.), at(120., 70.), at(60., 50.)),
            LineTo(at(3., 61.)),
            LineTo(at(30., 30.)),
            Close,
        ];
        for (colors, turn, rect) in [
            (
                [0xFF00_00FF, 0x0040_FFFF],
                0.3f32,
                IntRect::new(-7, -20, 86, 90),
            ),
            (
                [0xFF00_0080, 0x00FF_0080],
                -0.9,
                IntRect::new(10, -60, 53, 33),
            ),
        ] {
            let stops = [(0.2, colors[0]), (0.7, colors[1])]
                .map(|(offset, color)| GradientStop { offset, color });
            let gradient = Gradient::new(
                Geometry::Linear {
                    from: [0., 10.],
                    to: [90., 40.],
                },
                &stops,
                Spread::Pad,
                false,
            );
            let matrix =
                Transform::from_row(turn.cos(), turn.sin(), -turn.sin(), turn.cos(), 4.4, 1.3);
            let inverse = matrix.invert().unwrap();
            let ramp = gradient
                .ramp(&inverse, [rect.left + 5, rect.top + 9])
                .unwrap();
            let [a, b] = [
                Paint::Ramp(&ramp),
                Paint::Shader(&|x, y, row| gradient.shade(&inverse, x, y, row)),
            ]
            .map(|paint| {
                let mut layer = Layer::new(rect).unwrap();
                layer.fill(
                    rect,
                    None,
                    &Clip::new(rect),
                    &Paint::Solid([9, 80, 30, 200]),
                );
                layer.fill_path(&path, Fill::NonZero, &matrix, &Clip::new(rect), &paint);
                layer
            });
            assert!(
                a.pixels()
                    .as_flattened()
                    .iter()
                    .zip(b.pixels().as_flattened())
                    .all(|(a, b)| a.abs_diff(*b) <= 2)
            );
        }
    }

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
        let gradients = [&stops[..], &stops[..2], &stops[3..]].map(|it| {
            Gradient::new(
                Geometry::Linear {
                    from: [10., 5.],
                    to: [250., 40.],
                },
                it,
                Spread::Pad,
                true,
            )
        });
        let inverses = [
            Transform::identity(),
            Transform::from_row(-1., 0.3, 0.2, 1., 300., 0.),
            Transform::from_row(0., 0., 3., 1., 0., 0.),
        ];
        for (gradient, inverse) in gradients
            .iter()
            .flat_map(|it| inverses.map(|inverse| (it, inverse)))
        {
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
