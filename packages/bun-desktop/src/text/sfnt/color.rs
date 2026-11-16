//! Glyphs that are drawings: `COLR` and `CPAL`.

use std::f32::consts::PI;

use super::variations::{Coords, Deltas};
use super::{Data, Font};
use crate::abi::Rect;
use crate::gfx::{Point, Transform};

pub const FOR_LIGHT_BACKGROUND: u32 = 1;
pub const FOR_DARK_BACKGROUND: u32 = 2;

pub fn palette_count(font: &Font) -> u16 {
    font.table(b"CPAL").and_then(|it| it.u16(4)).unwrap_or(0)
}

pub fn palette_kind(font: &Font, palette: u16) -> Option<u32> {
    let table = font.table(b"CPAL").filter(|it| it.u16(0) == Some(1))?;
    table
        .at32(12 + usize::from(table.u16(4)?) * 2)?
        .u32(usize::from(palette) * 4)
}

pub fn palette_color(font: &Font, palette: u16, index: u16) -> Option<[u8; 4]> {
    let table = font
        .table(b"CPAL")
        .filter(|it| Some(index) < it.u16(2) && Some(palette) < it.u16(4))?;
    let [blue, green, red, alpha] = table
        .at32(8)?
        .array((usize::from(table.u16(12 + usize::from(palette) * 2)?) + usize::from(index)) * 4)?;
    Some([red, green, blue, alpha])
}

#[derive(Clone, Copy)]
pub struct Stop {
    pub offset: f32,
    pub color: u16,
    pub alpha: f32,
}

#[derive(Clone, Copy)]
pub enum Shape {
    Linear([Point; 2]),
    Radial([(Point, f32); 2]),
    /// In radians, counterclockwise.
    Sweep(Point, [f32; 2]),
}

pub trait Painter {
    fn push_transform(&mut self, by: Transform);
    fn pop_transform(&mut self);
    fn push_clip_glyph(&mut self, glyph: u32);
    fn push_clip_box(&mut self, bounds: Rect);
    fn pop_clip(&mut self);
    fn fill(&mut self, color: u16, alpha: f32);
    /// The stops go from 0 to 1. `extend` is 0 to pad, 1 to repeat and 2 to reflect.
    fn fill_gradient(&mut self, shape: Shape, stops: &[Stop], extend: u8);
    fn push_layer(&mut self);
    fn pop_layer(&mut self, mode: u8);
}

pub struct Drawing<'a> {
    table: Data,
    glyph: u32,
    coords: &'a Coords,
    deltas: Option<Deltas>,
}

/// The record that starts with `glyph`, or else the one before where it would be.
fn last_from(list: Data, count: usize, size: usize, glyph: u32) -> Option<Data> {
    let after = Data::partition(count, |it| {
        list.u16(it * size).is_some_and(|it| u32::from(it) <= glyph)
    });
    list.from(after.checked_sub(1)? * size)
}

impl<'a> Drawing<'a> {
    pub fn new(font: &Font, glyph: u32, coords: &'a Coords) -> Option<Drawing<'a>> {
        let table = font.table(b"COLR")?;
        let deltas = table
            .at32(30)
            .filter(|_| table.u16(0) == Some(1) && !coords.is_empty());
        let drawing = Drawing {
            table,
            glyph,
            coords,
            deltas: deltas.map(|store| Deltas {
                store,
                map: table.at32(26),
            }),
        };
        (drawing.root(glyph).is_some() || drawing.layers().is_some()).then_some(drawing)
    }

    fn root(&self, glyph: u32) -> Option<Data> {
        let list = self
            .table
            .at32(14)
            .filter(|_| self.table.u16(0) == Some(1))?;
        let record = last_from(list.from(4)?, list.u32(0)? as usize, 6, glyph)
            .filter(|it| it.u16(0).map(u32::from) == Some(glyph))?;
        list.from(record.u32(2)? as usize)
    }

    fn layers(&self) -> Option<Data> {
        let record = last_from(
            self.table.at32(4)?,
            self.table.u16(2)?.into(),
            6,
            self.glyph,
        );
        let record = record.filter(|it| it.u16(0).map(u32::from) == Some(self.glyph))?;
        self.table.at32(8)?.part(
            usize::from(record.u16(2)?) * 4,
            usize::from(record.u16(4)?) * 4,
        )
    }

    /// `N` numbers of 16 bits, which the index of their deltas may follow.
    fn numbers<const N: usize>(&self, data: Data, at: usize, varies: bool) -> Option<[f32; N]> {
        let base = data
            .part(at, N * 2)
            .map(|_| data.u32(at + N * 2).filter(|_| varies))?;
        Some(std::array::from_fn(|it| {
            f32::from(data.i16(at + it * 2).unwrap_or(0)) + self.delta(base, it)
        }))
    }

    fn delta(&self, base: Option<u32>, index: usize) -> f32 {
        let base = base.filter(|it| *it != u32::MAX);
        base.and_then(|base| {
            self.deltas?
                .get(base.checked_add(index as u32)?, self.coords)
        })
        .unwrap_or(0.)
    }

    fn clip_of(&self, glyph: u32) -> Option<Rect> {
        let list = self.table.at32(22).filter(|_| self.root(glyph).is_some())?;
        let record = last_from(list.from(5)?, list.u32(1)? as usize, 7, glyph)
            .filter(|it| it.u16(2).map(u32::from) >= Some(glyph))?;
        let bounds = list.from(record.u24(4)? as usize)?;
        let [x, y, right, top] = self.numbers(bounds, 1, bounds.u8(0) == Some(2))?;
        Some(Rect {
            x,
            y,
            width: right - x,
            height: top - y,
        })
    }

    /// In font units, with y up.
    pub fn bounds(&self) -> Option<Rect> {
        self.clip_of(self.glyph)
    }

    pub fn paint(&self, painter: &mut impl Painter) -> Option<()> {
        if self.root(self.glyph).is_some() {
            return self.paint_glyph(self.glyph, painter, 0, &mut 0);
        }
        for layer in self
            .layers()?
            .0
            .as_chunks::<4>()
            .0
            .iter()
            .map(|it| Data(it))
        {
            painter.push_clip_glyph(layer.u16(0)?.into());
            painter.fill(layer.u16(2)?, 1.);
            painter.pop_clip();
        }
        Some(())
    }

    fn paint_glyph(
        &self,
        glyph: u32,
        painter: &mut impl Painter,
        depth: u32,
        count: &mut u32,
    ) -> Option<()> {
        let clip = self.clip_of(glyph).map(|it| painter.push_clip_box(it));
        self.visit(self.root(glyph)?, painter, depth, count)?;
        clip.into_iter().for_each(|()| painter.pop_clip());
        Some(())
    }

    fn gradient(&self, paint: Data, format: u8, painter: &mut impl Painter) -> Option<()> {
        let (line, varies) = (paint.at24(1)?, format % 2 == 1);
        let stop = |at: usize| {
            let base = line.u32(at + 6).filter(|_| varies);
            let [offset, alpha] = [0, 1].map(|it| {
                (f32::from(line.i16(at + it * 4).unwrap_or(0)) + self.delta(base, it)) / 16384.
            });
            Some(Stop {
                offset,
                color: line.u16(at + 2)?,
                alpha,
            })
        };
        let stops =
            (0..usize::from(line.u16(1)?)).map(|it| stop(3 + it * if varies { 10 } else { 6 }));
        let (mut stops, extend) = (stops.collect::<Option<Vec<_>>>()?, line.u8(0)?);
        stops.sort_by(|a, b| a.offset.total_cmp(&b.offset));
        let (Some(&first), Some(&last)) = (stops.first(), stops.last()) else {
            return Some(());
        };
        if first.offset == last.offset {
            if stops.len() == 1 {
                painter.fill(first.color, first.alpha);
            }
            if stops.len() == 1 || matches!(extend, 1 | 2) {
                return Some(());
            }
            stops.push(Stop {
                offset: last.offset + 1.,
                ..last
            });
        }
        let ends = [first.offset, stops[stops.len() - 1].offset];
        stops
            .iter_mut()
            .for_each(|it| it.offset = (it.offset - ends[0]) / (ends[1] - ends[0]));
        let shape = if format >= 8 {
            let [x, y, start, end] = self.numbers(paint, 4, varies)?;
            if start == end && matches!(extend, 1 | 2) {
                return Some(());
            }
            Shape::Sweep(
                Point::new(x, y),
                ends.map(|t| ((start + (end - start) * t) / 16384. + 1.) * PI),
            )
        } else if format >= 6 {
            let [x0, y0, r0, x1, y1, r1] = self.numbers(paint, 4, varies)?;
            let [r0, r1] = [(r0, 8), (r1, 14)]
                .map(|(radius, at)| radius + if paint.i16(at) < Some(0) { 65536. } else { 0. });
            Shape::Radial(ends.map(|t| {
                (
                    Point::new(x0, y0).lerp(Point::new(x1, y1), t),
                    r0 + (r1 - r0) * t,
                )
            }))
        } else {
            let [x0, y0, x1, y1, x2, y2] = self.numbers(paint, 4, varies)?;
            let (from, along, across) = (
                Point::new(x0, y0),
                Point::new(x1 - x0, y1 - y0),
                Point::new(y2 - y0, x0 - x2),
            );
            if along.dot(across) == 0. {
                painter.fill(first.color, first.alpha);
                return Some(());
            }
            Shape::Linear(
                ends.map(|t| from + across * (along.dot(across) / across.dot(across) * t)),
            )
        };
        painter.fill_gradient(shape, &stops, extend);
        Some(())
    }

    fn transform(&self, paint: Data, format: u8) -> Option<Transform> {
        let varies = format % 2 == 1;
        if format < 14 {
            let matrix = paint.at24(4)?;
            let base = matrix
                .part(0, 24)
                .map(|_| matrix.u32(24).filter(|_| varies))?;
            let [sx, ky, kx, sy, tx, ty] = [0, 1, 2, 3, 4, 5]
                .map(|it| matrix.fixed(it * 4).unwrap_or(0.) + self.delta(base, it) / 65536.);
            return Some(Transform {
                sx,
                ky,
                kx,
                sy,
                tx,
                ty,
            });
        }
        let [a, b, c, d] = match format & !1 {
            14 | 16 | 28 => self.numbers(paint, 4, varies).map(|[a, b]| [a, b, 0., 0.]),
            20 | 24 => self.numbers(paint, 4, varies).map(|[a]| [a, a, 0., 0.]),
            22 | 26 => self.numbers(paint, 4, varies).map(|[a, x, y]| [a, a, x, y]),
            _ => self.numbers(paint, 4, varies),
        }?;
        let (x, y) = (a / 16384., b / 16384.);
        let matrix = match format {
            14 | 15 => Transform::from_translate(a, b),
            16..24 => Transform::from_scale(x, y),
            24..28 => Transform::from_row(
                (x * PI).cos(),
                (x * PI).sin(),
                -(x * PI).sin(),
                (x * PI).cos(),
                0.,
                0.,
            ),
            _ => Transform::from_row(1., (y * PI).tan(), (-x * PI).tan(), 1., 0., 0.),
        };
        Some(
            Transform::from_translate(c, d)
                .pre_concat(matrix)
                .pre_translate(-c, -d),
        )
    }

    fn visit(
        &self,
        paint: Data,
        painter: &mut impl Painter,
        depth: u32,
        count: &mut u32,
    ) -> Option<()> {
        const SOURCE_OVER: u8 = 3;
        *count += 1;
        match paint.u8(0).filter(|_| depth < 64 && *count < 1 << 14)? {
            1 => {
                let (list, first) = (self.table.at32(18)?, paint.u32(2)? as usize);
                for index in first..first + usize::from(paint.u8(1)?) {
                    self.visit(list.at32(4 + index * 4)?, painter, depth + 1, count)?;
                }
            }
            format @ (2 | 3) => painter.fill(
                paint.u16(1)?,
                self.numbers::<1>(paint, 3, format == 3)?[0] / 16384.,
            ),
            format @ 4..=9 => self.gradient(paint, format, painter)?,
            10 => {
                painter.push_clip_glyph(paint.u16(4)?.into());
                self.visit(paint.at24(1)?, painter, depth + 1, count)?;
                painter.pop_clip();
            }
            11 => self.paint_glyph(paint.u16(1)?.into(), painter, depth + 1, count)?,
            format @ 12..=31 => {
                painter.push_transform(self.transform(paint, format)?);
                self.visit(paint.at24(1)?, painter, depth + 1, count)?;
                painter.pop_transform();
            }
            32 => {
                painter.push_layer();
                self.visit(paint.at24(5)?, painter, depth + 1, count)?;
                painter.push_layer();
                self.visit(paint.at24(1)?, painter, depth + 1, count)?;
                painter.pop_layer(paint.u8(4)?);
                painter.pop_layer(SOURCE_OVER);
            }
            _ => return None,
        }
        Some(())
    }
}
