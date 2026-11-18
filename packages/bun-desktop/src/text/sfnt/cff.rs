//! PostScript outlines: `CFF ` and `CFF2`.

mod hints;

use self::hints::{Hints, Parameters};
use super::variations::{Coords, scalars};
use super::work::spend;
use super::{Data, Font};
use crate::gfx::{Command, Path, PathBuilder as _, Point};

#[derive(Clone, Copy, Default)]
struct Index {
    count: usize,
    size: usize,
    offsets: Data,
}

impl Index {
    /// With what follows it.
    fn read(data: Data, is_second: bool) -> Option<(Index, Data)> {
        let (count, start) = if is_second {
            (data.u32(0)? as usize, 4)
        } else {
            (data.u16(0)?.into(), 2)
        };
        if count == 0 {
            return Some((Index::default(), data.from(start)?));
        }
        let size = data.u8(start).filter(|it| (1..=4).contains(it))?.into();
        let index = Index {
            count,
            size,
            offsets: data.from(start + 1)?,
        };
        Some((index, index.offsets.from(index.offset(count)?)?))
    }

    fn offset(&self, index: usize) -> Option<usize> {
        let offset = self
            .offsets
            .part(index * self.size, self.size)?
            .0
            .iter()
            .fold(0, |all, it| all << 8 | usize::from(*it));
        Some((self.count + 1) * self.size - 1 + offset)
    }

    fn get(&self, index: usize) -> Option<Data> {
        let start = self.offset(Some(index).filter(|it| *it < self.count)?)?;
        self.offsets
            .part(start, self.offset(index + 1)?.checked_sub(start)?)
    }
}

/// With how many bytes it takes.
fn real(digits: Data) -> Option<(f64, usize)> {
    let mut text = String::new();
    for (at, digit) in digits
        .0
        .iter()
        .flat_map(|it| [it >> 4, it & 15])
        .enumerate()
        .take(64)
    {
        match digit {
            15 => return Some((text.parse().unwrap_or_default(), at / 2 + 1)),
            _ => {
                text += [
                    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "e", "e-", "", "-",
                ][usize::from(digit)]
            }
        }
    }
    None
}

/// The numbers and, as errors, the operators of a DICT.
fn tokens(dict: Data) -> impl Iterator<Item = Result<f64, u16>> {
    let mut at = 0;
    std::iter::from_fn(move || {
        let byte = spend(1).and(dict.u8(at))?;
        let (token, size) = match byte {
            12 => (Err(dict.u16(at)?), 2),
            28 => (Ok(dict.i16(at + 1)?.into()), 3),
            29 => (Ok((dict.u32(at + 1)? as i32).into()), 5),
            30 => real(dict.from(at + 1)?).map(|(value, size)| (Ok(value), size + 1))?,
            32..=246 => (Ok(f64::from(byte) - 139.), 1),
            247..=250 => (
                Ok(f64::from(byte - 247) * 256. + f64::from(dict.u8(at + 1)?) + 108.),
                2,
            ),
            251..=254 => (
                Ok(f64::from(byte - 251) * -256. - f64::from(dict.u8(at + 1)?) - 108.),
                2,
            ),
            _ => (Err(byte.into()), 1),
        };
        at += size;
        Some(token)
    })
}

/// The last two integers before an operator in a DICT.
fn operands(dict: Data, wanted: u16) -> Option<[usize; 2]> {
    let mut last = [0; 2];
    tokens(dict)
        .find(|token| {
            last = token.map_or(last, |it| [last[1], it as usize]);
            *token == Err(wanted)
        })?
        .err()?;
    Some(last)
}

#[derive(Clone, Copy)]
pub struct Cff {
    table: Data,
    is_second: bool,
    units_per_em: u16,
    top: Data,
    glyphs: Index,
    global: Index,
    fonts: Index,
    select: Option<Data>,
    store: Option<Data>,
}

impl Cff {
    pub fn new(font: &Font) -> Option<Cff> {
        let (table, is_second) = font
            .table(b"CFF2")
            .map(|it| (it, true))
            .or_else(|| Some((font.table(b"CFF ")?, false)))?;
        let after_header = table.from(table.u8(2)?.into())?;
        let (top, rest) = if is_second {
            (
                after_header.part(0, table.u16(3)?.into())?,
                after_header.from(table.u16(3)?.into())?,
            )
        } else {
            let (tops, strings) = Index::read(Index::read(after_header, false)?.1, false)?;
            (tops.get(0)?, Index::read(strings, false)?.1)
        };
        let follow = |operator: u16| table.from(operands(top, operator)?[1]);
        Some(Cff {
            table,
            is_second,
            units_per_em: font.units_per_em,
            top,
            glyphs: Index::read(follow(17)?, is_second)?.0,
            global: Index::read(rest, is_second)?.0,
            fonts: follow(0xc24)
                .and_then(|it| Index::read(it, is_second))
                .unwrap_or_default()
                .0,
            select: follow(0xc25),
            store: follow(24).and_then(|it| it.from(2)),
        })
    }

    fn private(&self, glyph: u32) -> Option<(Data, usize)> {
        let range = |select: Data,
                     count: usize,
                     start: usize,
                     size: usize,
                     first: &dyn Fn(usize) -> Option<u32>| {
            let after = Data::partition(count, |it| {
                first(start + it * size).is_some_and(|it| it <= glyph)
            });
            select.from(start + after.checked_sub(1)? * size)
        };
        let font = match self.select.map(|it| (it, it.u8(0))) {
            Some((select, Some(0))) => select.u8(1 + glyph as usize)?.into(),
            Some((select, Some(3))) => range(select, select.u16(1)?.into(), 3, 3, &|at| {
                select.u16(at).map(u32::from)
            })?
            .u8(2)?
            .into(),
            Some((select, _)) => {
                range(select, select.u32(1)? as usize, 5, 6, &|at| select.u32(at))?
                    .u16(4)?
                    .into()
            }
            None => 0,
        };
        let [size, offset] = operands(self.fonts.get(font).unwrap_or(self.top), 18)?;
        Some((self.table.part(offset, size)?, offset))
    }

    /// For `seac`, which names glyphs by their code in the standard encoding.
    fn standard_glyph(&self, code: usize) -> Option<usize> {
        const RUNS: [(usize, usize, usize); 14] = [
            (32, 126, 1),
            (161, 175, 96),
            (177, 180, 111),
            (182, 189, 115),
            (191, 191, 123),
            (193, 200, 124),
            (202, 203, 132),
            (205, 208, 134),
            (225, 225, 138),
            (227, 227, 139),
            (232, 235, 140),
            (241, 241, 144),
            (245, 245, 145),
            (248, 251, 146),
        ];
        let name = RUNS
            .iter()
            .find(|it| (it.0..=it.1).contains(&code))
            .map(|it| it.2 + code - it.0)?;
        let Some(charset) = operands(self.top, 15)
            .filter(|it| it[1] > 2)
            .and_then(|it| self.table.from(it[1]))
        else {
            return Some(name);
        };
        let (format, mut glyph, mut at) = (usize::from(charset.u8(0)?), 1, 1);
        while glyph < self.glyphs.count {
            spend(1)?;
            let more = [
                Some(0),
                charset.u8(at + 2).map(usize::from),
                charset.u16(at + 2).map(usize::from),
            ]
            .get(format)
            .copied()??;
            match name.checked_sub(charset.u16(at)?.into()) {
                Some(offset) if offset <= more => return Some(glyph + offset),
                _ => (glyph, at) = (glyph + 1 + more, at + 2 + format),
            }
        }
        None
    }

    pub fn outline(
        &self,
        glyph: u32,
        coords: &Coords,
        scale: f32,
        hinted_size: Option<f32>,
    ) -> Option<Path> {
        let private = self.private(glyph);
        let local = private.and_then(|(dict, offset)| {
            Index::read(
                self.table.from(offset + operands(dict, 19)?[1])?,
                self.is_second,
            )
        });
        let mut machine = Machine {
            cff: self,
            coords,
            scale,
            is_part: false,
            hints: None,
            local: local.unwrap_or_default().0,
            variations: private
                .and_then(|it| operands(it.0, 22))
                .map_or(0, |it| it[1]),
            stack: Vec::with_capacity(48),
            stems: 0,
            has_width: self.is_second,
            at: Point::ZERO,
            path: Path::new(),
        };
        if let Some(size) = hinted_size {
            machine.hints = Some(Hints::new(
                &machine.parameters(private?.0)?,
                size,
                self.units_per_em,
            ));
        }
        machine.run(self.glyphs.get(glyph as usize)?, 0)?;
        machine.close();
        Some(machine.path)
    }
}

struct Machine<'a> {
    cff: &'a Cff,
    coords: &'a Coords,
    scale: f32,
    local: Index,
    variations: usize,
    stack: Vec<f32>,
    stems: usize,
    has_width: bool,
    /// Of an accented glyph.
    is_part: bool,
    hints: Option<Hints>,
    at: Point,
    path: Path,
}

impl Machine<'_> {
    fn parameters(&mut self, private: Data) -> Option<Parameters> {
        let mut parameters = Parameters::new();
        for token in tokens(private) {
            match token {
                Ok(value) => self.stack.push(value as f32),
                Err(23) => self.blend()?,
                Err(operator) => parameters.set(operator, &std::mem::take(&mut self.stack)),
            }
        }
        self.stack.clear();
        Some(parameters)
    }

    fn close(&mut self) {
        let start = self
            .path
            .iter()
            .rfind(|it| matches!(it, Command::MoveTo(_)))
            .copied();
        self.path.pop_if(|last| matches!((*last, start), (Command::LineTo(to), Some(Command::MoveTo(from))) if to == from));
        if self
            .path
            .pop_if(|last| matches!(last, Command::MoveTo(_)))
            .is_none()
            && !matches!(self.path.last(), None | Some(Command::Close))
        {
            self.path.close();
        }
    }

    fn drop_width(&mut self, is_there: bool) {
        if !std::mem::replace(&mut self.has_width, true) && is_there {
            self.stack.remove(0);
        }
    }

    /// Like FreeType, it drops fractions of font units unless it hints.
    fn scaled(&mut self, point: Point) -> Point {
        if let Some(hints) = &mut self.hints {
            return hints.apply([point.x, point.y]).into();
        }
        let snap = |it: f32| ((it + 1. / 2048.).floor() * self.scale * 64.).round() / 64.;
        Point::new(snap(point.x), snap(point.y))
    }

    fn line(&mut self, x: f32, y: f32) {
        let units = |it: Point| [it.x, it.y].map(|it| (it + 1. / 2048.).floor());
        let from = units(self.at);
        self.at = self.at + Point::new(x, y);
        let to = self.scaled(self.at);
        let is_empty = match (&self.hints, self.path.last()) {
            (None, _) => units(self.at) == from,
            (
                _,
                Some(Command::MoveTo(last) | Command::LineTo(last) | Command::CurveTo(.., last)),
            ) => *last == to,
            _ => false,
        };
        if !is_empty {
            self.path.push(Command::LineTo(to));
        }
    }

    fn curve(&mut self, [a, b, c, d, e, f]: [f32; 6]) {
        let first = self.at + Point::new(a, b);
        let second = first + Point::new(c, d);
        self.at = second + Point::new(e, f);
        let [first, second, end] = [first, second, self.at].map(|it| self.scaled(it));
        self.path.push(Command::CurveTo(first, second, end));
    }

    fn draw(&mut self, operator: u16, stack: &[f32]) -> Option<()> {
        match operator {
            4 | 21 | 22 => {
                self.close();
                let (last, before) = stack.split_last()?;
                self.at = self.at
                    + Point::from(
                        [
                            [0., *last],
                            [before.last().map_or(0., |it| *it), *last],
                            [*last, 0.],
                        ][usize::from(operator.saturating_sub(20))],
                    );
                let to = self.scaled(self.at);
                self.path.push(Command::MoveTo(to));
            }
            5 => stack
                .as_chunks()
                .0
                .iter()
                .for_each(|&[x, y]| self.line(x, y)),
            6 | 7 => (operator..).zip(stack).for_each(|(turn, by)| {
                if turn % 2 == 0 {
                    self.line(*by, 0.)
                } else {
                    self.line(0., *by)
                }
            }),
            8 => stack.as_chunks().0.iter().for_each(|it| self.curve(*it)),
            24 | 25 => {
                let (first, last) =
                    stack.split_at(
                        stack
                            .len()
                            .checked_sub(if operator == 24 { 2 } else { 6 })?,
                    );
                self.draw(if operator == 24 { 8 } else { 5 }, first);
                self.draw(if operator == 24 { 5 } else { 8 }, last);
            }
            26 | 27 => {
                let (first, curves) = stack.as_rchunks();
                let mut across = first.first().map_or(0., |it| *it);
                for &[a, b, c, d] in curves {
                    self.curve(if operator == 26 {
                        [across, a, b, c, 0., d]
                    } else {
                        [a, across, b, c, d, 0.]
                    });
                    across = 0.;
                }
            }
            30 | 31 => {
                let (curves, last) = stack.as_chunks();
                for (index, &[a, b, c, d]) in curves.iter().enumerate() {
                    let across = last
                        .first()
                        .filter(|_| index + 1 == curves.len())
                        .map_or(0., |it| *it);
                    self.curve(if (usize::from(operator) + index) % 2 == 0 {
                        [0., a, b, c, d, across]
                    } else {
                        [a, 0., b, c, across, d]
                    });
                }
            }
            0xc22 => {
                let [a, b, c, d, e, f, g] = *stack.first_chunk()?;
                self.curve([a, 0., b, c, d, 0.]);
                self.curve([e, 0., f, -c, g, 0.]);
            }
            0xc23 => self.draw(8, stack.get(..12)?)?,
            0xc24 => {
                let [a, b, c, d, e, f, g, h, i] = *stack.first_chunk()?;
                self.curve([a, b, c, d, e, 0.]);
                self.curve([f, 0., g, h, i, -(b + d + h)]);
            }
            0xc25 => {
                let [a, b, c, d, e, f, g, h, i, j, k] = *stack.first_chunk()?;
                let (x, y) = (a + c + e + g + i, b + d + f + h + j);
                self.curve([a, b, c, d, e, f]);
                self.curve(if x.abs() > y.abs() {
                    [g, h, i, j, k, -y]
                } else {
                    [g, h, i, j, -x, k]
                });
            }
            _ => {}
        }
        Some(())
    }

    fn blend(&mut self) -> Option<()> {
        let (count, scalars) = (
            self.stack.pop()? as usize,
            scalars(self.cff.store?, self.variations, self.coords)?.collect::<Vec<_>>(),
        );
        let start = self
            .stack
            .len()
            .checked_sub(count.checked_mul(scalars.len() + 1)?)?;
        let (values, deltas) = self.stack[start..].split_at_mut(count);
        for (value, deltas) in values.iter_mut().zip(deltas.chunks(scalars.len().max(1))) {
            *value += deltas
                .iter()
                .zip(&scalars)
                .map(|(delta, scalar)| delta * scalar)
                .sum::<f32>();
        }
        self.stack.truncate(start + count);
        Some(())
    }

    /// Returns whether the glyph goes on.
    fn run(&mut self, code: Data, depth: u32) -> Option<bool> {
        let mut at = 0;
        while let Some(byte) = code.u8(at) {
            (self.stack.len() <= 513 && depth <= 10).then_some(())?;
            let (value, size) = match byte {
                28 => (code.i16(at + 1)?.into(), 3),
                32..=246 => (f32::from(byte) - 139., 1),
                247..=250 => (
                    f32::from(byte - 247) * 256. + f32::from(code.u8(at + 1)?) + 108.,
                    2,
                ),
                251..=254 => (
                    f32::from(byte - 251) * -256. - f32::from(code.u8(at + 1)?) - 108.,
                    2,
                ),
                255 => (code.fixed(at + 1)?, 5),
                _ => (0., 0),
            };
            if size > 0 {
                self.stack.push(value);
                at += size;
                continue;
            }
            spend(8 + self.stack.len() * 8)?;
            let operator = if byte == 12 {
                code.u16(at)?
            } else {
                byte.into()
            };
            at += if byte == 12 { 2 } else { 1 };
            match operator {
                10 | 29 => {
                    let routines = if operator == 10 {
                        self.local
                    } else {
                        self.cff.global
                    };
                    let bias = if routines.count < 1240 {
                        107
                    } else if routines.count < 33900 {
                        1131
                    } else {
                        32768
                    };
                    let routine = routines
                        .get(usize::try_from(i64::from(self.stack.pop()? as i32) + bias).ok()?)?;
                    if !self.run(routine, depth + 1)? {
                        return Some(false);
                    }
                    continue;
                }
                11 => return Some(true),
                14 => {
                    self.drop_width(self.stack.len() % 4 == 1);
                    if let (&[x, y, base, accent], false) =
                        (&self.stack[..], std::mem::replace(&mut self.is_part, true))
                    {
                        self.stack.clear();
                        for (code, origin) in [(accent, Point::new(x, y)), (base, Point::ZERO)] {
                            (self.at, self.stems, self.has_width) = (origin, 0, false);
                            self.hints.iter_mut().for_each(Hints::clear);
                            self.run(
                                self.cff
                                    .glyphs
                                    .get(self.cff.standard_glyph(code as usize)?)?,
                                0,
                            )?;
                        }
                    }
                    return Some(false);
                }
                15 => self.variations = self.stack.pop()? as usize,
                16 => {
                    self.blend()?;
                    continue;
                }
                1 | 3 | 18 | 19 | 20 | 23 => {
                    self.drop_width(self.stack.len() % 2 == 1);
                    self.stems += self.stack.len() / 2;
                    let mask = code
                        .part(
                            at,
                            if matches!(operator, 19 | 20) {
                                self.stems.div_ceil(8)
                            } else {
                                0
                            },
                        )?
                        .0;
                    at += mask.len();
                    match (&mut self.hints, operator) {
                        (Some(hints), 1 | 18) => hints.add_stems(&self.stack),
                        (Some(hints), 19 | 20) => hints.set_mask(mask, operator == 20),
                        _ => {}
                    }
                }
                _ => {
                    if matches!(operator, 4 | 21 | 22) {
                        self.drop_width(self.stack.len() > if operator == 21 { 2 } else { 1 });
                    }
                    let stack = std::mem::take(&mut self.stack);
                    self.draw(operator, &stack)?;
                    self.stack = stack;
                }
            }
            self.stack.clear();
        }
        Some(true)
    }
}
