//! TrueType outlines.

use super::variations::{Coords, axis_scalar};
use super::work::spend;
use super::{Data, Font};
use crate::abi::Rect;
use crate::gfx::{Command, Path, PathBuilder as _, Point, Transform};

const PHANTOMS: usize = 4;
const MAX_POINTS: usize = 1 << 17;

#[derive(Clone, Copy)]
pub struct Glyf {
    glyf: Data,
    loca: Data,
    is_long: bool,
    gvar: Option<Data>,
}

#[derive(Default)]
pub struct Shape {
    pub points: Vec<Point>,
    pub is_on_curve: Vec<bool>,
    /// The index after the last point of each contour.
    pub ends: Vec<usize>,
    pub is_cubic: bool,
    glyphs: usize,
    /// `None` for whole font units.
    scale: Option<f32>,
}

fn snap(point: Point, scale: Option<f32>) -> Point {
    let snap = |it: f32| scale.map_or((it + 0.5).floor(), |scale| (it * scale * 64.).round() / 64.);
    Point::new(snap(point.x), snap(point.y))
}

struct Component {
    flags: u16,
    glyph: u16,
    arguments: [i32; 2],
    matrix: Transform,
}

fn components(glyph: Data) -> Option<Vec<Component>> {
    let (mut at, mut all) = (10, Vec::new());
    loop {
        let flags = spend(8).and(glyph.u16(at))?;
        let argument = |index: usize| match flags & 3 {
            0 => glyph.u8(at + 4 + index).map(i32::from),
            1 => glyph.u16(at + 4 + index * 2).map(i32::from),
            2 => glyph.u8(at + 4 + index).map(|it| i32::from(it as i8)),
            _ => glyph.i16(at + 4 + index * 2).map(i32::from),
        };
        let start = at + if flags & 1 != 0 { 8 } else { 6 };
        let number = |index: usize| Some(f32::from(glyph.i16(start + index * 2)?) / 16384.);
        let (matrix, count) = match flags {
            _ if flags & 8 != 0 => (Transform::from_scale(number(0)?, number(0)?), 1),
            _ if flags & 0x40 != 0 => (Transform::from_scale(number(0)?, number(1)?), 2),
            _ if flags & 0x80 != 0 => (
                Transform::from_row(number(0)?, number(1)?, number(2)?, number(3)?, 0., 0.),
                4,
            ),
            _ => (Transform::identity(), 0),
        };
        all.push(Component {
            flags,
            glyph: glyph.u16(at + 2)?,
            arguments: [argument(0)?, argument(1)?],
            matrix,
        });
        at = start + count * 2;
        if flags & 0x20 == 0 {
            return Some(all);
        }
    }
}

fn read_simple(glyph: Data, contours: usize, shape: &mut Shape) -> Option<()> {
    let first = shape.points.len();
    shape.ends.extend(
        glyph
            .part(10, contours * 2)?
            .u16s(0, contours)
            .map(|it| first + usize::from(it) + 1),
    );
    let count = if contours == 0 {
        0
    } else {
        shape.ends.last()? - first
    };
    spend(contours + count * 4)?;
    let mut at = 12 + contours * 2 + usize::from(glyph.u16(10 + contours * 2).unwrap_or(0));
    let mut flags = Vec::with_capacity(count);
    while flags.len() < count {
        let flag = glyph.u8(at)?;
        let more = if flag & 8 != 0 { glyph.u8(at + 1)? } else { 0 };
        at += if flag & 8 != 0 { 2 } else { 1 };
        flags.resize((flags.len() + 1 + usize::from(more)).min(count), flag);
    }
    shape.is_on_curve.extend(flags.iter().map(|it| it & 1 != 0));
    shape.points.resize(first + count, Point::ZERO);
    for (is_short, is_same) in [(2, 16), (4, 32)] {
        let mut value = 0;
        for (flag, point) in flags.iter().zip(&mut shape.points[first..]) {
            if flag & is_short != 0 {
                value += i32::from(glyph.u8(at)?) * if flag & is_same != 0 { 1 } else { -1 };
                at += 1;
            } else if flag & is_same == 0 {
                value += i32::from(glyph.i16(at)?);
                at += 2;
            }
            *if is_short == 2 {
                &mut point.x
            } else {
                &mut point.y
            } = value as f32;
        }
    }
    Some(())
}

/// `None` inside stands for all points.
fn read_point_numbers(data: Data, at: &mut usize) -> Option<Option<Vec<usize>>> {
    let first = usize::from(data.u8(*at)?);
    let count = if first & 0x80 != 0 {
        usize::from(data.u16(*at)? & 0x7fff)
    } else {
        first
    };
    *at += if first & 0x80 != 0 { 2 } else { 1 };
    let (mut numbers, mut last) = (Vec::with_capacity(count), 0);
    while numbers.len() < count {
        let control = data.u8(*at)?;
        *at += 1;
        for _ in 0..=control & 0x7f {
            last += if control & 0x80 != 0 {
                usize::from(data.u16(*at)?)
            } else {
                data.u8(*at)?.into()
            };
            *at += if control & 0x80 != 0 { 2 } else { 1 };
            numbers.push(last);
        }
    }
    numbers.truncate(count);
    Some((count > 0).then_some(numbers))
}

fn read_deltas(data: Data, at: &mut usize, count: usize) -> Option<Vec<f32>> {
    let mut deltas = Vec::with_capacity(count);
    while deltas.len() < count {
        let control = data.u8(*at)?;
        *at += 1;
        for _ in 0..=control & 0x3f {
            let (value, size) = match control >> 6 {
                0 => (i32::from(data.u8(*at)? as i8), 1),
                1 => (data.i16(*at)?.into(), 2),
                2 => (0, 0),
                _ => (data.u32(*at)? as i32, 4),
            };
            *at += size;
            deltas.push(value as f32);
        }
    }
    Some(deltas)
}

/// Infers the deltas that a contour lacks from those around them.
fn interpolate(points: &[Point], deltas: &mut [Option<Point>]) {
    let known: Vec<usize> = (0..deltas.len())
        .filter(|it| deltas[*it].is_some())
        .collect();
    for (&from, &to) in known.iter().zip(known.iter().cycle().skip(1)) {
        let (first, second) = (
            deltas[from].unwrap_or_default(),
            deltas[to].unwrap_or_default(),
        );
        let infer = |at: f32, a: (f32, f32), b: (f32, f32)| {
            let (low, high) = if a.0 <= b.0 { (a, b) } else { (b, a) };
            match at {
                _ if low.0 == high.0 => {
                    if low.1 == high.1 {
                        low.1
                    } else {
                        0.
                    }
                }
                _ if at <= low.0 => low.1,
                _ if at >= high.0 => high.1,
                _ => low.1 + (high.1 - low.1) * (at - low.0) / (high.0 - low.0),
            }
        };
        let mut index = (from + 1) % deltas.len();
        while index != to {
            let (point, a, b) = (points[index], points[from], points[to]);
            deltas[index] = Some(Point::new(
                infer(point.x, (a.x, first.x), (b.x, second.x)),
                infer(point.y, (a.y, first.y), (b.y, second.y)),
            ));
            index = (index + 1) % deltas.len();
        }
    }
}

impl Glyf {
    pub fn new(font: &Font) -> Option<Glyf> {
        let is_long = font.table(b"head")?.u16(50)? != 0;
        Some(Glyf {
            glyf: font.table(b"glyf")?,
            loca: font.table(b"loca")?,
            is_long,
            gvar: font.table(b"gvar"),
        })
    }

    fn glyph(&self, glyph: u32) -> Option<Data> {
        let offset = |index: usize| match self.is_long {
            true => self.loca.u32(index * 4).map(|it| it as usize),
            false => self.loca.u16(index * 2).map(|it| usize::from(it) * 2),
        };
        let start = offset(glyph as usize)?;
        self.glyf.part(
            start,
            offset(glyph as usize + 1)?
                .min(self.glyf.0.len())
                .checked_sub(start)?,
        )
    }

    pub fn bounds(&self, glyph: u32) -> Option<Rect> {
        let glyph = self.glyph(glyph)?;
        let [x, y, right, top] = [2, 4, 6, 8].map(|it| f32::from(glyph.i16(it).unwrap_or(0)));
        Some(Rect {
            x,
            y,
            width: right - x,
            height: top - y,
        })
    }

    /// For `points`, and then for the phantom points. `ends` are relative to `first`.
    fn deltas(
        &self,
        glyph: u32,
        coords: &Coords,
        points: &[Point],
        ends: &[usize],
        first: usize,
    ) -> Option<Vec<Point>> {
        let gvar = self.gvar.filter(|_| !coords.is_empty())?;
        let offset = |index: usize| match gvar.u16(14)? & 1 {
            0 => gvar.u16(20 + index * 2).map(|it| usize::from(it) * 2),
            _ => gvar.u32(20 + index * 4).map(|it| it as usize),
        };
        let (start, axes) = (
            offset(glyph as usize).filter(|_| Some(glyph) < gvar.u16(12).map(u32::from))?,
            usize::from(gvar.u16(4)?),
        );
        let data = gvar
            .at32(16)?
            .part(start, offset(glyph as usize + 1)?.checked_sub(start)?)?;
        let (count, mut header, mut at) = (data.u16(0)?, 4, usize::from(data.u16(2)?));
        let shared = if count & 0x8000 != 0 {
            read_point_numbers(data, &mut at)?
        } else {
            None
        };
        let mut total = vec![Point::ZERO; points.len() + PHANTOMS];
        for _ in 0..count & 0xfff {
            let (size, index) = (
                usize::from(data.u16(header)?),
                spend(1 + axes).and(data.u16(header + 2))?,
            );
            let [embedded, between] =
                [0x8000, 0x4000].map(|flag| if index & flag != 0 { axes * 2 } else { 0 });
            let peaks = if embedded > 0 {
                data.from(header + 4)?
            } else {
                gvar.at32(8)?.from(usize::from(index & 0xfff) * axes * 2)?
            };
            let limits = data.from(header + 4 + embedded)?;
            let scalar = (0..axes).try_fold(1., |scalar: f32, axis| {
                let peak = peaks.i16(axis * 2)?;
                let [start, end] = match between {
                    0 => [peak.min(0), peak.max(0)],
                    _ => [limits.i16(axis * 2)?, limits.i16(between + axis * 2)?],
                };
                Some(scalar * axis_scalar(coords.get(axis).map_or(0, |it| *it), [start, peak, end]))
            })?;
            let mut next = at;
            (header, at) = (header + 4 + embedded + between * 2, at + size);
            if scalar == 0. {
                continue;
            }
            let own = if index & 0x2000 != 0 {
                Some(read_point_numbers(data, &mut next)?)
            } else {
                None
            };
            let numbers = own.as_ref().unwrap_or(&shared);
            let count = numbers.as_ref().map_or(total.len(), Vec::len);
            spend(count + total.len() + ends.len())?;
            let (xs, ys) = (
                read_deltas(data, &mut next, count)?,
                read_deltas(data, &mut next, count)?,
            );
            let deltas = xs
                .into_iter()
                .zip(ys)
                .map(|(x, y)| Point::new(x, y) * scalar);
            let Some(numbers) = numbers else {
                total
                    .iter_mut()
                    .zip(deltas)
                    .for_each(|(sum, delta)| *sum = *sum + delta);
                continue;
            };
            let mut sparse = vec![None; total.len()];
            for (number, delta) in numbers.iter().zip(deltas) {
                sparse
                    .get_mut(*number)
                    .into_iter()
                    .for_each(|it| *it = Some(delta));
            }
            let mut start = 0;
            for end in ends.iter().map(|it| it - first) {
                interpolate(points.get(start..end)?, &mut sparse[start..end]);
                start = end;
            }
            total
                .iter_mut()
                .zip(sparse)
                .for_each(|(sum, delta)| *sum = *sum + delta.unwrap_or_default());
        }
        Some(total)
    }

    /// Returns where the phantom points are: left, right, top and bottom.
    fn load(
        &self,
        font: &Font,
        id: u32,
        coords: &Coords,
        depth: u32,
        shape: &mut Shape,
    ) -> Option<[Point; PHANTOMS]> {
        let (glyph, first, first_end) = (self.glyph(id)?, shape.points.len(), shape.ends.len());
        shape.glyphs += 1;
        (depth < 16 && first < MAX_POINTS && shape.glyphs < 4096).then_some(())?;
        let left = f32::from(glyph.i16(2).unwrap_or(0))
            - f32::from(font.horizontal.bearing(id).unwrap_or(0));
        let (width, height) = (
            font.horizontal.advance(id).unwrap_or(0),
            font.vertical.advance(id).unwrap_or(0),
        );
        let mut phantoms = [
            Point::new(left, 0.),
            Point::new(left + f32::from(width), 0.),
            Point::ZERO,
            Point::new(0., -f32::from(height)),
        ];
        let mut move_phantoms = |deltas: &[Point]| {
            phantoms
                .iter_mut()
                .rev()
                .zip(deltas.iter().rev())
                .for_each(|(it, by)| *it = *it + *by)
        };
        if let Ok(contours) = usize::try_from(glyph.i16(0).unwrap_or(0)) {
            read_simple(glyph, contours, shape).or(glyph.0.is_empty().then_some(()))?;
            if let Some(deltas) = self.deltas(
                id,
                coords,
                &shape.points[first..],
                &shape.ends[first_end..],
                first,
            ) {
                shape.points[first..]
                    .iter_mut()
                    .zip(&deltas)
                    .for_each(|(point, by)| *point = *point + *by);
                move_phantoms(&deltas);
            }
            shape.points[first..]
                .iter_mut()
                .for_each(|it| *it = snap(*it, shape.scale));
            return Some(phantoms);
        }
        let components = components(glyph)?;
        let deltas = self
            .deltas(id, coords, &vec![Point::ZERO; components.len()], &[], 0)
            .unwrap_or_default();
        move_phantoms(&deltas);
        for (
            index,
            Component {
                flags,
                glyph,
                arguments: [a, b],
                matrix,
            },
        ) in components.into_iter().enumerate()
        {
            let start = shape.points.len();
            let inner = self.load(font, glyph.into(), coords, depth + 1, shape)?;
            if flags & 0x200 != 0 {
                phantoms = inner;
            }
            spend(shape.points.len() - start)?;
            let grid = if shape.scale.is_some() { 64. } else { 1. };
            let product =
                |a: f32, b: f32| (f64::from(a) * f64::from(b) * grid).round() as f32 / grid as f32;
            for it in &mut shape.points[start..] {
                *it = Point::new(
                    product(it.x, matrix.sx) + product(it.y, matrix.kx),
                    product(it.x, matrix.ky) + product(it.y, matrix.sy),
                );
            }
            let offset = if flags & 2 == 0 {
                *shape.points.get(first + a as usize)? - *shape.points.get(start + b as usize)?
            } else {
                let scale = if flags & 0x1800 == 0x800 {
                    [matrix.sx.hypot(matrix.kx), matrix.ky.hypot(matrix.sy)]
                } else {
                    [1.; 2]
                };
                snap(
                    Point::new(a as f32 * scale[0], b as f32 * scale[1])
                        + deltas.get(index).copied().unwrap_or_default(),
                    shape.scale,
                )
            };
            shape.points[start..]
                .iter_mut()
                .for_each(|it| *it = *it + offset);
        }
        Some(phantoms)
    }

    pub fn advance_delta(
        &self,
        font: &Font,
        glyph: u32,
        axis: usize,
        coords: &Coords,
    ) -> Option<f32> {
        let [left, right, top, bottom] =
            self.load(font, glyph, coords, 0, &mut Shape::default())?;
        Some(match axis {
            0 => right.x - left.x - f32::from(font.horizontal.advance(glyph)?),
            _ => top.y - bottom.y - f32::from(font.vertical.advance(glyph)?),
        })
    }

    pub fn shape(
        &self,
        font: &Font,
        glyph: u32,
        coords: &Coords,
        scale: Option<f32>,
    ) -> Option<Shape> {
        let mut shape = Shape {
            scale,
            ..Shape::default()
        };
        let origin = snap(self.load(font, glyph, coords, 0, &mut shape)?[0], scale);
        shape.points.iter_mut().for_each(|it| it.x -= origin.x);
        Some(shape)
    }
}

impl Shape {
    #[cfg(not(target_os = "macos"))]
    pub fn from_cubic(path: &[Command]) -> Shape {
        let mut shape = Shape {
            is_cubic: true,
            ..Shape::default()
        };
        for command in path {
            let (points, start): (&[Point], _) = match command {
                Command::MoveTo(to) | Command::LineTo(to) => {
                    (&[*to], shape.ends.last().map_or(0, |it| *it))
                }
                Command::QuadTo(a, to) => (&[*a, *a, *to], 0),
                Command::CurveTo(a, b, to) => (&[*a, *b, *to], 0),
                Command::Close => (&[], shape.ends.last().map_or(0, |it| *it)),
            };
            shape.points.extend(points);
            shape
                .is_on_curve
                .extend((1..=points.len()).map(|it| it == points.len()));
            if points.is_empty() {
                if shape.points.len() > start + 1 && shape.points.last() == shape.points.get(start)
                {
                    shape.points.pop();
                    shape.is_on_curve.pop();
                }
                shape.ends.push(shape.points.len());
            }
        }
        shape
    }

    pub fn path(&self) -> Option<Path> {
        let between = |a: Point, b: Point| {
            Point::new(
                ((a.x + b.x) * 32.).trunc() / 64.,
                ((a.y + b.y) * 32.).trunc() / 64.,
            )
        };
        let (mut path, mut start) = (
            Path::with_capacity(self.points.len() + self.ends.len() * 2),
            0,
        );
        for &end in &self.ends {
            let (points, is_on_curve) =
                (self.points.get(start..end)?, &self.is_on_curve[start..end]);
            start = end;
            let Some(last) = points.len().checked_sub(1) else {
                continue;
            };
            let (begin, rest) = match (is_on_curve[0], is_on_curve[last]) {
                (true, _) => (points[0], 1..last + 1),
                (_, true) => (points[last], 0..last),
                _ => (between(points[0], points[last]), 0..last + 1),
            };
            path.move_to(begin);
            if self.is_cubic {
                let mut at = 1;
                while at <= last {
                    let point = |offset: usize| *points.get(at + offset).unwrap_or(&begin);
                    path.push(if is_on_curve[at] {
                        Command::LineTo(point(0))
                    } else {
                        Command::CurveTo(point(0), point(1), point(2))
                    });
                    at += if is_on_curve[at] { 1 } else { 3 };
                }
                path.close();
                continue;
            }
            let mut control = None;
            for index in rest {
                let point = points[index];
                path.extend(match (control, is_on_curve[index]) {
                    (None, true) => Some(Command::LineTo(point)),
                    (Some(control), true) => Some(Command::QuadTo(control, point)),
                    (Some(control), false) => {
                        Some(Command::QuadTo(control, between(control, point)))
                    }
                    (None, false) => None,
                });
                control = (!is_on_curve[index]).then_some(point);
            }
            path.extend(control.map(|control| Command::QuadTo(control, begin)));
            path.close();
        }
        Some(path)
    }
}
