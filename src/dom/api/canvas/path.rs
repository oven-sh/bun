//! https://html.spec.whatwg.org/#building-paths

use core::f64::consts::{FRAC_PI_2, TAU};

use bun_jsc::JsCell;

use super::{Affine, Failure, are_finite};
use crate::abi::PathVerb;
use crate::generated_bindgen::canvas::{CanvasPath, Path2D, Path2DOrString, Radii, Radius};
use crate::generated_bindgen::geometry::{DOMMatrix2DInit, DOMPointInit};

type Point = [f64; 2];

/// The verbs have the points after `matrix`, which may change from one call to the next.
#[derive(Default)]
pub(super) struct Outline {
    pub(super) verbs: Vec<PathVerb>,
    pub(super) matrix: Affine,
    at: Point,
    start: Point,
}

#[derive(Default)]
pub(crate) struct Path {
    pub(super) outline: JsCell<Outline>,
}

fn narrow(point: Point) -> [f32; 2] {
    point.map(|it| it as f32)
}

fn widen(point: [f32; 2]) -> Point {
    point.map(f64::from)
}

pub(super) fn transformed(verb: PathVerb, matrix: &Affine) -> PathVerb {
    let map = |point| narrow(matrix.map(widen(point)));
    match verb {
        PathVerb::Move(to) => PathVerb::Move(map(to)),
        PathVerb::Line(to) => PathVerb::Line(map(to)),
        PathVerb::Cubic(a, b, to) => PathVerb::Cubic(map(a), map(b), map(to)),
        PathVerb::Close => PathVerb::Close,
    }
}

impl Outline {
    fn append(&mut self, verbs: impl IntoIterator<Item = PathVerb>) {
        for verb in verbs {
            match verb {
                PathVerb::Move(to) => (self.at, self.start) = (widen(to), widen(to)),
                PathVerb::Line(to) | PathVerb::Cubic(_, _, to) => self.at = widen(to),
                PathVerb::Close => self.at = self.start,
            }
            self.verbs.push(verb);
        }
        if self.verbs.last() == Some(&PathVerb::Close) {
            self.verbs.push(PathVerb::Move(narrow(self.start)));
        }
    }

    fn close(&mut self) {
        if !self.verbs.is_empty() {
            self.at = self.start;
            self.verbs
                .extend([PathVerb::Close, PathVerb::Move(narrow(self.start))]);
        }
    }

    #[inline]
    fn move_to(&mut self, to: Point) {
        self.at = self.matrix.map(to);
        self.start = self.at;
        self.verbs.push(PathVerb::Move(narrow(self.at)));
    }

    #[inline]
    fn line_to(&mut self, to: Point) {
        if self.verbs.is_empty() {
            return self.move_to(to);
        }
        self.at = self.matrix.map(to);
        self.verbs.push(PathVerb::Line(narrow(self.at)));
    }

    fn ensure_subpath(&mut self, at: Point) {
        if self.verbs.is_empty() {
            self.move_to(at);
        }
    }

    fn quadratic_to(&mut self, control: Point, to: Point) {
        self.ensure_subpath(control);
        let (control, from) = (self.matrix.map(control), self.at);
        self.at = self.matrix.map(to);
        let handle = |end: Point| {
            narrow([0, 1].map(|axis| end[axis] + (control[axis] - end[axis]) * (2.0 / 3.0)))
        };
        self.verbs.push(PathVerb::Cubic(
            handle(from),
            handle(self.at),
            narrow(self.at),
        ));
    }

    fn cubic_to(&mut self, first: Point, second: Point, to: Point) {
        self.ensure_subpath(first);
        self.at = self.matrix.map(to);
        self.verbs.push(PathVerb::Cubic(
            narrow(self.matrix.map(first)),
            narrow(self.matrix.map(second)),
            narrow(self.at),
        ));
    }

    fn arc_to(&mut self, [x1, y1]: Point, [x2, y2]: Point, radius: f64) {
        self.ensure_subpath([x1, y1]);
        let [x0, y0] = self.matrix.unmap(self.at);
        let ([ax, ay], [bx, by]) = ([x0 - x1, y0 - y1], [x2 - x1, y2 - y1]);
        let (length_a, length_b, cross) = (ax.hypot(ay), bx.hypot(by), ax * by - ay * bx);
        let is_bent = cross.abs() > 1e-9 * length_a * length_b;
        if radius == 0.0 || !is_bent {
            return self.line_to([x1, y1]);
        }
        let distance = radius / (cross.atan2(ax * bx + ay * by) / 2.0).tan().abs();
        let side = if cross < 0.0 { radius } else { -radius };
        let start = [x1 + ax / length_a * distance, y1 + ay / length_a * distance];
        let center = [
            start[0] + ay / length_a * side,
            start[1] - ax / length_a * side,
        ];
        let from = (start[1] - center[1]).atan2(start[0] - center[0]);
        let to = (y1 + by / length_b * distance - center[1])
            .atan2(x1 + bx / length_b * distance - center[0]);
        self.ellipse(center, [radius; 2], 0.0, from, to, cross > 0.0);
    }

    fn ellipse(
        &mut self,
        [x, y]: Point,
        [rx, ry]: [f64; 2],
        rotation: f64,
        from: f64,
        to: f64,
        is_counterclockwise: bool,
    ) {
        let sweep = match if is_counterclockwise {
            from - to
        } else {
            to - from
        } {
            TAU.. => TAU,
            sweep @ ..0.0 => TAU - (-sweep % TAU),
            sweep => sweep,
        };
        let sweep = if is_counterclockwise { -sweep } else { sweep };
        let (sin, cos) = if rotation == 0.0 {
            (0.0, 1.0)
        } else {
            rotation.sin_cos()
        };
        let place = Affine([rx * cos, rx * sin, -ry * sin, ry * cos, x, y]);
        let (mut v, mut u) = from.sin_cos();
        self.line_to(place.map([u, v]));
        let count = (sweep.abs() / FRAC_PI_2).ceil();
        let handle = 4.0 / 3.0 * (sweep / count / 4.0).tan();
        for step in 1..=count as u8 {
            let first = [u - handle * v, v + handle * u];
            (v, u) = (from + sweep * f64::from(step) / count).sin_cos();
            self.cubic_to(
                place.map(first),
                place.map([u + handle * v, v - handle * u]),
                place.map([u, v]),
            );
        }
    }

    fn rect(&mut self, x: f64, y: f64, width: f64, height: f64) {
        self.move_to([x, y]);
        self.line_to([x + width, y]);
        self.line_to([x + width, y + height]);
        self.line_to([x, y + height]);
        self.close();
    }

    fn round_rect(
        &mut self,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        [tl, tr, br, bl]: [[f64; 2]; 4],
    ) {
        let (w, h) = (width.abs(), height.abs());
        let room = [
            w / (tl[0] + tr[0]),
            h / (tr[1] + br[1]),
            w / (br[0] + bl[0]),
            h / (tl[1] + bl[1]),
        ];
        let scale = room.into_iter().fold(1.0, f64::min);
        let [sx, sy] = [width, height].map(|it| if it < 0.0 { -scale } else { scale });
        self.move_to([x + tl[0] * sx, y]);
        for (corner, from, to) in [
            ([x + width, y], [-tr[0] * sx, 0.0], [0.0, tr[1] * sy]),
            (
                [x + width, y + height],
                [0.0, -br[1] * sy],
                [-br[0] * sx, 0.0],
            ),
            ([x, y + height], [bl[0] * sx, 0.0], [0.0, -bl[1] * sy]),
            ([x, y], [0.0, tl[1] * sy], [tl[0] * sx, 0.0]),
        ] {
            const HANDLE: f64 = 1.0 - 0.552_284_749_8;
            let along =
                |offset: Point, by: f64| [corner[0] + offset[0] * by, corner[1] + offset[1] * by];
            self.line_to(along(from, 1.0));
            self.cubic_to(along(from, HANDLE), along(to, HANDLE), along(to, 1.0));
        }
        self.close();
        self.move_to([x, y]);
    }
}

const NEGATIVE_RADIUS: Failure = Failure::index_size("The radius provided is negative.");

impl CanvasPath {
    #[inline]
    fn build<const N: usize>(&self, arguments: [f64; N], build: impl FnOnce(&mut Outline)) {
        if are_finite(arguments) {
            self.outline.with_mut(build);
        }
    }

    pub(crate) fn close_path(&self) {
        self.outline.with_mut(Outline::close);
    }

    pub(crate) fn move_to(&self, x: f64, y: f64) {
        self.build([x, y], |path| path.move_to([x, y]));
    }

    pub(crate) fn line_to(&self, x: f64, y: f64) {
        self.build([x, y], |path| path.line_to([x, y]));
    }

    pub(crate) fn quadratic_curve_to(&self, cpx: f64, cpy: f64, x: f64, y: f64) {
        self.build([cpx, cpy, x, y], |path| {
            path.quadratic_to([cpx, cpy], [x, y])
        });
    }

    pub(crate) fn bezier_curve_to(
        &self,
        cp1x: f64,
        cp1y: f64,
        cp2x: f64,
        cp2y: f64,
        x: f64,
        y: f64,
    ) {
        self.build([cp1x, cp1y, cp2x, cp2y, x, y], |path| {
            path.cubic_to([cp1x, cp1y], [cp2x, cp2y], [x, y])
        });
    }

    pub(crate) fn arc_to(
        &self,
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        radius: f64,
    ) -> Result<(), Failure> {
        if radius < 0.0 && are_finite([x1, y1, x2, y2, radius]) {
            return Err(NEGATIVE_RADIUS);
        }
        self.build([x1, y1, x2, y2, radius], |path| {
            path.arc_to([x1, y1], [x2, y2], radius)
        });
        Ok(())
    }

    pub(crate) fn rect(&self, x: f64, y: f64, w: f64, h: f64) {
        self.build([x, y, w, h], |path| path.rect(x, y, w, h));
    }

    pub(crate) fn round_rect(
        &self,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        radii: Option<Radii>,
    ) -> Result<(), Failure> {
        if !are_finite([x, y, w, h]) {
            return Ok(());
        }
        let of_point = |it: &DOMPointInit| [it.x, it.y];
        let of_radius = |it: &Radius| match it {
            Radius::Point(point) => of_point(point),
            Radius::Number(radius) => [*radius; 2],
        };
        let list: smallvec::SmallVec<[[f64; 2]; 4]> = match radii {
            None => smallvec::smallvec![[0.0; 2]],
            Some(Radii::Number(radius)) => smallvec::smallvec![[radius; 2]],
            Some(Radii::Point(point)) => smallvec::smallvec![of_point(&point)],
            Some(Radii::List(list)) => list.iter().map(of_radius).collect(),
        };
        let corners = match list[..] {
            [all] => [all; 4],
            [a, b] => [a, b, a, b],
            [a, b, c] => [a, b, c, b],
            [a, b, c, d] => [a, b, c, d],
            _ => return Err(Failure::Range("Between one and four radii are necessary.")),
        };
        for radius in list {
            if !are_finite(radius) {
                return Ok(());
            }
            if radius[0] < 0.0 || radius[1] < 0.0 {
                return Err(Failure::Range("The radius provided is negative."));
            }
        }
        self.outline
            .with_mut(|path| path.round_rect(x, y, w, h, corners));
        Ok(())
    }

    pub(crate) fn arc(
        &self,
        x: f64,
        y: f64,
        radius: f64,
        from: f64,
        to: f64,
        is_counterclockwise: bool,
    ) -> Result<(), Failure> {
        self.ellipse(x, y, radius, radius, 0.0, from, to, is_counterclockwise)
    }

    pub(crate) fn ellipse(
        &self,
        x: f64,
        y: f64,
        rx: f64,
        ry: f64,
        rotation: f64,
        from: f64,
        to: f64,
        is_counterclockwise: bool,
    ) -> Result<(), Failure> {
        if !are_finite([x, y, rx, ry, rotation, from, to]) {
            return Ok(());
        }
        if rx < 0.0 || ry < 0.0 {
            return Err(NEGATIVE_RADIUS);
        }
        self.outline.with_mut(|path| {
            path.ellipse([x, y], [rx, ry], rotation, from, to, is_counterclockwise)
        });
        Ok(())
    }
}

impl Path {
    pub(super) fn verbs(&self) -> &[PathVerb] {
        &self.outline.get().verbs
    }
}

impl Path2D {
    pub(crate) fn constructor(path: Option<Path2DOrString<'_>>) -> Path {
        let mut outline = Outline::default();
        match path {
            None => {}
            Some(Path2DOrString::Path(path)) => outline.append(path.verbs().iter().copied()),
            Some(Path2DOrString::Data(data)) => {
                outline.append(crate::path::Path::parse(crate::values::text(data)).verbs)
            }
        }
        Path {
            outline: JsCell::new(outline),
        }
    }

    pub(crate) fn add_path(
        &self,
        path: &Path2D,
        transform: &DOMMatrix2DInit,
    ) -> Result<(), Failure> {
        let matrix = Affine::from_init(transform)?;
        if are_finite(matrix.0) {
            let verbs: Vec<_> = path
                .verbs()
                .iter()
                .map(|it| transformed(*it, &matrix))
                .collect();
            self.outline.with_mut(|outline| outline.append(verbs));
        }
        Ok(())
    }
}
