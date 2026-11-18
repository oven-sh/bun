//! https://html.spec.whatwg.org/#building-paths

use core::f64::consts::{FRAC_PI_2, TAU};

use bun_jsc::JsCell;

use super::{Affine, Failure, are_finite};
use crate::abi::{PathVerb, Rect};
use crate::abi_graphics::Verb;
use crate::generated_bindgen::canvas::{CanvasPath, Path2D, Path2DOrString, Radii, Radius};
use crate::generated_bindgen::geometry::{DOMMatrix2DInit, DOMPointInit};

type Point = [f64; 2];

/// The verbs have the points after `matrix`, which may change from one call to the next.
#[derive(Default)]
pub(super) struct Outline {
    verbs: Vec<u32>,
    pub(super) matrix: Affine,
    /// Where the first so many words of `verbs` end, and where that contour began.
    known: (usize, [[f32; 2]; 2]),
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

pub(super) fn add_transformed(mut verbs: &[u32], matrix: &Affine, to: &mut Vec<u32>) {
    if matrix.0 == Affine::default().0 {
        return to.extend_from_slice(verbs);
    }
    let (map, mut is_first) = (|point| narrow(matrix.map(widen(point))), true);
    while let Some(verb) = Verb::read(&mut verbs) {
        match verb {
            Verb::Move(end) => Verb::Move(map(end)).write(to),
            Verb::Line(end) => Verb::Line(map(end)).write(to),
            Verb::Quad(a, end) => Verb::Quad(map(a), map(end)).write(to),
            Verb::Cubic(a, b, end) => Verb::Cubic(map(a), map(b), map(end)).write(to),
            Verb::Arc {
                center: [x, y],
                radius,
                from,
                sweep,
            } => {
                let sweep = if sweep.abs() == core::f32::consts::TAU {
                    TAU.copysign(sweep.into())
                } else {
                    sweep.into()
                };
                add_arc(
                    matrix.then([radius, 0.0, 0.0, radius, x, y].map(f64::from)),
                    from.into(),
                    sweep,
                    is_first,
                    to,
                );
            }
            Verb::RoundRect { rect, radius } => add_round_rect(
                matrix,
                [rect.x, rect.y, rect.width, rect.height].map(f64::from),
                [[radius.into(); 2]; 4],
                to,
            ),
            Verb::Close => Verb::Close.write(to),
        }
        is_first = false;
    }
}

/// For what single precision is not enough.
const LARGE: f64 = 4096.0;

#[inline]
fn within_turn(angle: f64) -> f64 {
    let rest = if angle.abs() < 1e9 {
        angle - (angle * (1.0 / TAU)).floor() * TAU
    } else {
        angle.rem_euclid(TAU)
    };
    if rest >= TAU {
        rest - TAU
    } else {
        rest.max(0.0)
    }
}

/// Of the unit circle.
#[inline(always)]
fn add_arc(place: Affine, from: f64, sweep: f64, is_first: bool, to: &mut Vec<u32>) {
    let [a, b, c, d, x, y] = place.0;
    let (radius, turn) = if b == 0.0 && a > 0.0 {
        (a, 0.0)
    } else {
        ((a * a + b * b).sqrt(), b.atan2(a))
    };
    match a == d && b == -c && radius > 0.0 && radius < LARGE {
        true => Verb::Arc {
            center: narrow([x, y]),
            radius: radius as f32,
            from: within_turn(from + turn) as f32,
            sweep: sweep as f32,
        }
        .write(to),
        false => add_curves(place, from, sweep, is_first, to),
    }
}

fn add_curves(place: Affine, from: f64, sweep: f64, is_first: bool, to: &mut Vec<u32>) {
    let (map, (mut v, mut u)) = (|point| narrow(place.map(point)), from.sin_cos());
    if is_first {
        Verb::Move(map([u, v]))
    } else {
        Verb::Line(map([u, v]))
    }
    .write(to);
    let count = (sweep.abs() / FRAC_PI_2).ceil();
    let handle = 4.0 / 3.0 * (sweep / count / 4.0).tan();
    for step in 1..=count as u8 {
        let first = [u - handle * v, v + handle * u];
        (v, u) = (from + sweep * f64::from(step) / count).sin_cos();
        Verb::Cubic(
            map(first),
            map([u + handle * v, v - handle * u]),
            map([u, v]),
        )
        .write(to);
    }
}

fn add_round_rect(
    matrix: &Affine,
    [x, y, width, height]: [f64; 4],
    [tl, tr, br, bl]: [[f64; 2]; 4],
    verbs: &mut Vec<u32>,
) {
    let (w, h) = (width.abs(), height.abs());
    let room = [
        w / (tl[0] + tr[0]),
        h / (tr[1] + br[1]),
        w / (br[0] + bl[0]),
        h / (tl[1] + bl[1]),
    ];
    let (scale, map) = (room.into_iter().fold(1.0, f64::min), |point| {
        narrow(matrix.map(point))
    });
    if let [a, 0.0, 0.0, d, ..] = matrix.0
        && a == d
        && a > 0.0
        && [tl, tr, br, bl] == [[tl[0]; 2]; 4]
    {
        let ([x, y], [width, height]) = (map([x, y]), narrow([width * a, height * a]));
        return Verb::RoundRect {
            rect: Rect {
                x,
                y,
                width,
                height,
            },
            radius: (tl[0] * scale * a) as f32,
        }
        .write(verbs);
    }
    let [sx, sy] = [width, height].map(|it| if it < 0.0 { -scale } else { scale });
    Verb::Move(map([x + tl[0] * sx, y])).write(verbs);
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
            |offset: Point, by: f64| map([corner[0] + offset[0] * by, corner[1] + offset[1] * by]);
        Verb::Line(along(from, 1.0)).write(verbs);
        Verb::Cubic(along(from, HANDLE), along(to, HANDLE), along(to, 1.0)).write(verbs);
    }
    Verb::Close.write(verbs);
    Verb::Move(map([x, y])).write(verbs);
}

impl Outline {
    #[inline]
    pub(super) fn clear(&mut self) {
        self.verbs.clear();
        self.known.0 = 0;
    }

    fn at(&mut self) -> Point {
        let (mut rest, [mut at, mut start], mut is_first) =
            (&self.verbs[self.known.0..], self.known.1, self.known.0 == 0);
        while let Some(verb) = Verb::read(&mut rest) {
            match verb {
                Verb::Move(to) => (at, start) = (to, to),
                Verb::Line(to) | Verb::Quad(_, to) | Verb::Cubic(_, _, to) => at = to,
                Verb::Arc {
                    center: [x, y],
                    radius,
                    from,
                    sweep,
                } => {
                    let point = |angle: f32| [x + radius * angle.cos(), y + radius * angle.sin()];
                    (at, start) = (
                        point(from + sweep),
                        if is_first { point(from) } else { start },
                    );
                }
                Verb::RoundRect { rect, .. } => (at, start) = ([rect.x, rect.y], [rect.x, rect.y]),
                Verb::Close => at = start,
            }
            is_first = false;
        }
        self.known = (self.verbs.len(), [at, start]);
        widen(at)
    }

    #[inline]
    fn close(&mut self) {
        if !self.verbs.is_empty() {
            Verb::Close.write(&mut self.verbs);
        }
    }

    #[inline(always)]
    fn map(&self, point: Point) -> [f32; 2] {
        narrow(self.matrix.map(point))
    }

    #[inline]
    fn move_to(&mut self, to: Point) {
        Verb::Move(self.map(to)).write(&mut self.verbs);
    }

    #[inline]
    fn line_to(&mut self, to: Point) {
        match self.verbs.is_empty() {
            true => Verb::Move(self.map(to)).write(&mut self.verbs),
            false => Verb::Line(self.map(to)).write(&mut self.verbs),
        }
    }

    #[inline]
    fn ensure_subpath(&mut self, at: Point) {
        if self.verbs.is_empty() {
            self.move_to(at);
        }
    }

    #[inline]
    fn quadratic_to(&mut self, control: Point, to: Point) {
        self.ensure_subpath(control);
        Verb::Quad(self.map(control), self.map(to)).write(&mut self.verbs);
    }

    #[inline]
    fn cubic_to(&mut self, first: Point, second: Point, to: Point) {
        self.ensure_subpath(first);
        Verb::Cubic(self.map(first), self.map(second), self.map(to)).write(&mut self.verbs);
    }

    fn arc_to(&mut self, [x1, y1]: Point, [x2, y2]: Point, radius: f64) {
        self.ensure_subpath([x1, y1]);
        let at = self.at();
        let [x0, y0] = self.matrix.unmap(at);
        let ([ax, ay], [bx, by]) = ([x0 - x1, y0 - y1], [x2 - x1, y2 - y1]);
        let (length_a, length_b, cross) = (ax.hypot(ay), bx.hypot(by), ax * by - ay * bx);
        let is_bent = cross.abs() > 1e-6 * length_a * length_b;
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
        self.any_ellipse(center, [radius; 2], 0.0, from, to, cross > 0.0);
    }

    fn any_ellipse(
        &mut self,
        center: Point,
        radii: [f64; 2],
        rotation: f64,
        from: f64,
        to: f64,
        is_counterclockwise: bool,
    ) {
        self.ellipse(center, radii, rotation, from, to, is_counterclockwise);
    }

    #[inline(always)]
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
            sweep @ ..0.0 => TAU - within_turn(-sweep),
            sweep => sweep,
        };
        let (sin, cos) = if rotation == 0.0 {
            (0.0, 1.0)
        } else {
            rotation.sin_cos()
        };
        let place = self
            .matrix
            .then([rx * cos, rx * sin, -ry * sin, ry * cos, x, y]);
        add_arc(
            place,
            from,
            if is_counterclockwise { -sweep } else { sweep },
            self.verbs.is_empty(),
            &mut self.verbs,
        );
    }

    fn rect(&mut self, x: f64, y: f64, width: f64, height: f64) {
        self.move_to([x, y]);
        self.line_to([x + width, y]);
        self.line_to([x + width, y + height]);
        self.line_to([x, y + height]);
        self.close();
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
            .with_mut(|path| add_round_rect(&path.matrix, [x, y, w, h], corners, &mut path.verbs));
        Ok(())
    }

    #[inline]
    pub(crate) fn arc(
        &self,
        x: f64,
        y: f64,
        radius: f64,
        from: f64,
        to: f64,
        is_counterclockwise: bool,
    ) -> Result<(), Failure> {
        if !are_finite([x, y, radius, from, to]) {
            return Ok(());
        }
        if radius < 0.0 {
            return Err(NEGATIVE_RADIUS);
        }
        self.outline
            .with_mut(|path| path.ellipse([x, y], [radius; 2], 0.0, from, to, is_counterclockwise));
        Ok(())
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
            path.any_ellipse([x, y], [rx, ry], rotation, from, to, is_counterclockwise)
        });
        Ok(())
    }
}

impl Path {
    #[inline]
    pub(super) fn verbs(&self) -> &[u32] {
        &self.outline.get().verbs
    }
}

impl Path2D {
    pub(crate) fn constructor(path: Option<Path2DOrString<'_>>) -> Path {
        let mut outline = Outline::default();
        match path {
            None => {}
            Some(Path2DOrString::Path(path)) => outline.verbs.extend_from_slice(path.verbs()),
            Some(Path2DOrString::Data(data)) => {
                for verb in crate::path::Path::parse(crate::values::text(data)).verbs {
                    let verb = match verb {
                        PathVerb::Move(to) => Verb::Move(to),
                        PathVerb::Line(to) => Verb::Line(to),
                        PathVerb::Cubic(first, second, to) => Verb::Cubic(first, second, to),
                        PathVerb::Close => Verb::Close,
                    };
                    verb.write(&mut outline.verbs);
                }
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
            let mut verbs = Vec::new();
            if let Some(Verb::Arc {
                center: [x, y],
                radius,
                from,
                ..
            }) = Verb::read(&mut path.verbs())
            {
                Verb::Move(narrow(
                    matrix.map(widen([x + radius * from.cos(), y + radius * from.sin()])),
                ))
                .write(&mut verbs);
            }
            add_transformed(path.verbs(), &matrix, &mut verbs);
            self.outline
                .with_mut(|outline| outline.verbs.append(&mut verbs));
        }
        Ok(())
    }
}
