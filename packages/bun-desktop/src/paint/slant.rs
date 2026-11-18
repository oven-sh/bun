//! Rounded rectangles that are not upright.

use super::raster::{Coverage, IntRect, Pixel, fill_through, map_point, prefer_wide};
use super::scan::Floats;
use crate::abi::RoundedRect;
use crate::gfx::Transform;

const PARTS: f32 = 16.;

/// In device pixels, around the origin.
#[derive(Clone, Copy, PartialEq)]
pub struct Slant {
    /// The direction of the upper edge.
    pub along: [f32; 2],
    pub half: [f32; 2],
    /// In `PARTS` of a pixel.
    pub radii: [u16; 4],
}

impl Slant {
    /// With its center. `None` unless it is small, and the corners stay right angles or parts of circles.
    pub fn of(shape: &RoundedRect, matrix: &Transform) -> Option<(Slant, [f32; 2])> {
        const LARGEST: f32 = 128.;
        let (rect, x, y) = (
            shape.rect,
            matrix.sx.hypot(matrix.ky),
            matrix.kx.hypot(matrix.sy),
        );
        let half = [rect.width * x / 2., rect.height * y / 2.];
        ((matrix.sx * matrix.kx + matrix.ky * matrix.sy).abs() < x * y * 1e-4
            && half[0].max(half[1]) <= LARGEST)
            .then_some(())?;
        let [tl, tr, br, bl] = shape.radii.map(|[a, b]| {
            if (a * x).min(b * y) < 0.75 {
                [0.; 2]
            } else {
                [a * x, b * y]
            }
        });
        let radii = if matrix.sx * matrix.sy > matrix.kx * matrix.ky {
            [tl, tr, br, bl]
        } else {
            [bl, br, tr, tl]
        };
        radii
            .iter()
            .all(|[a, b]| (a - b).abs() < 0.05 && (*a == 0. || shape.smoothing == 0.))
            .then_some(())?;
        let slant = Slant {
            along: [matrix.sx / x, matrix.ky / x],
            half,
            radii: radii.map(|[it, _]| (it * PARTS + 0.5) as u16),
        };
        Some((
            slant,
            map_point(matrix, rect.x + rect.width / 2., rect.y + rect.height / 2.).into(),
        ))
    }

    pub fn radii(&self) -> [f32; 4] {
        self.radii.map(|it| f32::from(it) / PARTS)
    }

    /// How far from the center it can be seen.
    pub fn reach(&self) -> [f32; 2] {
        let ([cos, sin], [x, y]) = (self.along.map(f32::abs), self.half);
        [cos * x + sin * y + 1., sin * x + cos * y + 1.]
    }

    pub fn coverage(&self, [x, y]: [f32; 2], area: IntRect) -> Coverage {
        let mut coverage = Coverage::filled(area, 0);
        let rows = coverage
            .data
            .chunks_mut(area.width().max(1))
            .zip(area.top..);
        measure(
            rows.map(|(row, top)| (row, [area.left as f32 + 0.5 - x, top as f32 + 0.5 - y])),
            self,
        );
        coverage
    }
}

pub struct Gauge<F> {
    along: [f32; 2],
    steps: [F; 2],
    half: [F; 2],
    is_thin: bool,
    /// The center, from the origin towards the corner, and the radius.
    corners: [Option<[F; 3]>; 4],
    are_alike: bool,
    /// How far from the center of a pixel an edge crosses two opposite sides of it, and how far it crosses it at all.
    limits: [F; 2],
    /// Of the distance, and of the square of what goes beyond the first limit.
    factors: [F; 2],
}

impl<F: Floats> Gauge<F> {
    #[inline(always)]
    pub fn new(slant: &Slant) -> Self {
        let (all, [cos, sin], [x, y]) = (|it: f32| F::new([it; 8]), slant.along, slant.half);
        let (more, less) = (cos.abs().max(sin.abs()), cos.abs().min(sin.abs()).max(1e-3));
        Gauge {
            along: slant.along,
            steps: [cos, -sin].map(|step| F::new(std::array::from_fn(|it| it as f32 * step))),
            half: [all(x), all(y)],
            is_thin: x.min(y) < 0.75,
            corners: slant
                .radii()
                .map(|it| (it > 0.).then(|| [all(x - it), all(y - it), all(it)])),
            are_alike: slant.radii == [slant.radii[0]; 4],
            limits: [all((more - less) / 2.), all((more + less) / 2.)],
            factors: [all(1. / more), all(0.5 / (more * less))],
        }
    }

    /// How much of a pixel is behind an edge that its center is this far behind, less a half.
    #[inline(always)]
    fn behind(&self, distance: F) -> F {
        let zero = F::new([0.; 8]);
        let distance = distance.min(self.limits[1]).max(zero.sub(self.limits[1]));
        let (inside, outside) = (
            distance.sub(self.limits[0]).max(zero),
            zero.sub(distance).sub(self.limits[0]).max(zero),
        );
        distance.mul(self.factors[0]).sub(
            inside
                .sub(outside)
                .mul(inside.add(outside))
                .mul(self.factors[1]),
        )
    }

    #[inline(always)]
    fn between(&self, half: F, from_center: F) -> F {
        self.behind(half.sub(from_center)).add(if self.is_thin {
            self.behind(half.add(from_center))
        } else {
            F::new([0.5; 8])
        })
    }

    /// From 0 to 255, of the pixel whose center is there and the next seven.
    #[inline(always)]
    pub fn coverage(&self, [x, y]: [f32; 2]) -> F {
        let ([cos, sin], zero) = (self.along, F::new([0.; 8]));
        let (right, down) = (
            F::new([x * cos + y * sin; 8]).add(self.steps[0]),
            F::new([y * cos - x * sin; 8]).add(self.steps[1]),
        );
        let (left, up) = (zero.sub(right), zero.sub(down));
        let far = [left.max(right), up.max(down)];
        let mut covered = self
            .between(self.half[0], far[0])
            .mul(self.between(self.half[1], far[1]));
        if !self.are_alike || self.corners[0].is_some() {
            let towards = if self.are_alike {
                [far; 4]
            } else {
                [[left, up], [right, up], [right, down], [left, down]]
            };
            let mut distance = F::new([1.; 8]);
            for (corner, [across, along]) in self
                .corners
                .iter()
                .zip(towards)
                .take(if self.are_alike { 1 } else { 4 })
            {
                if let Some([x, y, radius]) = *corner {
                    let (x, y) = (across.sub(x).max(zero), along.sub(y).max(zero));
                    distance = distance.min(radius.sub(x.mul(x).add(y.mul(y)).sqrt()));
                }
            }
            covered = covered.min(self.behind(distance).add(F::new([0.5; 8])));
        }
        covered.mul(F::new([255.; 8])).add(F::new([0.5; 8]))
    }

    #[inline(always)]
    pub fn measure<'a>(&self, rows: impl Iterator<Item = (&'a mut [u8], [f32; 2])>) {
        for (row, [x, y]) in rows {
            for (index, run) in row.chunks_mut(8).enumerate() {
                run.copy_from_slice(
                    &self.coverage([x + (index * 8) as f32, y]).bytes()[..run.len()],
                );
            }
        }
    }
}

pub struct Disc<F> {
    steps: F,
    reach: F,
}

impl<F: Floats> Disc<F> {
    #[inline(always)]
    pub fn new(radius: f32) -> Self {
        Disc {
            steps: F::new(std::array::from_fn(|it| it as f32)),
            reach: F::new([radius + 0.5; 8]),
        }
    }

    /// Like `Gauge::coverage`.
    #[inline(always)]
    pub fn coverage(&self, [x, y]: [f32; 2]) -> F {
        let (x, all) = (F::new([x; 8]).add(self.steps), |it: f32| F::new([it; 8]));
        self.reach
            .sub(x.mul(x).add(all(y * y)).sqrt())
            .max(all(0.))
            .min(all(1.))
            .mul(all(255.))
            .add(all(0.5))
    }

    #[inline(always)]
    pub fn measure(&self, row: &mut [u8], [x, y]: [f32; 2]) {
        for (index, run) in row.chunks_mut(8).enumerate() {
            run.copy_from_slice(&self.coverage([x + (index * 8) as f32, y]).bytes()[..run.len()]);
        }
    }
}

pub fn measure_disc(row: &mut [u8], center: [f32; 2], radius: f32) {
    prefer_wide!(measure_disc(row, center, radius));
    Disc::<[f32; 8]>::new(radius).measure(row, center);
}

/// Like `fill`.
pub fn fill_disc<'a>(
    rows: impl Iterator<Item = (&'a mut [Pixel], [f32; 2])>,
    radius: f32,
    color: Pixel,
) {
    prefer_wide!(fill_disc(rows, radius, color));
    let disc = Disc::<[f32; 8]>::new(radius);
    for (row, [x, y]) in rows {
        for (index, run) in row.chunks_mut(8).enumerate() {
            fill_through(
                run,
                color,
                &disc.coverage([x + (index * 8) as f32, y]).bytes()[..run.len()],
            );
        }
    }
}

fn measure<'a>(rows: impl Iterator<Item = (&'a mut [u8], [f32; 2])>, slant: &Slant) {
    prefer_wide!(measure_slant(rows, slant));
    Gauge::<[f32; 8]>::new(slant).measure(rows);
}

/// With each row comes the center of its first pixel.
pub fn fill<'a>(
    rows: impl Iterator<Item = (&'a mut [Pixel], [f32; 2])>,
    slant: &Slant,
    color: Pixel,
) {
    prefer_wide!(fill_slant(rows, slant, color));
    let gauge = Gauge::<[f32; 8]>::new(slant);
    for (row, [x, y]) in rows {
        for (index, run) in row.chunks_mut(8).enumerate() {
            fill_through(
                run,
                color,
                &gauge.coverage([x + (index * 8) as f32, y]).bytes()[..run.len()],
            );
        }
    }
}
