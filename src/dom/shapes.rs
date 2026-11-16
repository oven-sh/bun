//! `<basic-shape>`

use core::fmt::Write;

use crate::abi::{PathVerb, Rect, RoundedRect};
use crate::paint::{square, with_corners};
use crate::path::Path;
use crate::types::*;
use crate::values::*;

pub(crate) enum Resolved {
    Rounded(RoundedRect),
    Path(Path, FillRule),
}

impl Resolved {
    pub(crate) fn scaled(self, by: f32) -> Resolved {
        let matrix = crate::svg::scaling(by, by);
        match self {
            _ if by == 1.0 => self,
            Resolved::Rounded(it) => Resolved::Rounded(RoundedRect {
                rect: it.rect.transformed(&matrix),
                radii: it.radii.map(|it| it.map(|it| it * by)),
            }),
            Resolved::Path(path, rule) => Resolved::Path(path.transformed(&matrix), rule),
        }
    }

    pub(crate) fn into_path(self) -> (Path, FillRule) {
        match self {
            Resolved::Rounded(shape) => (Path::rounded_rect(&shape), FillRule::Nonzero),
            Resolved::Path(path, rule) => (path, rule),
        }
    }
}

pub(crate) fn resolve(shape: &Shape, reference: &RoundedRect, zoom: f32) -> Resolved {
    let Rect {
        x,
        y,
        width,
        height,
    } = reference.rect;
    match shape {
        Shape::Box | Shape::Url(_) | Shape::Image(_) => Resolved::Rounded(*reference),
        Shape::Inset(sides, corners) => {
            let mut sides = [0, 1, 2, 3].map(|side| sides[side].resolve([height, width][side % 2]));
            for (axis, length) in [(0, height), (1, width)] {
                let sum = sides[axis] + sides[axis + 2];
                if sum > length {
                    [axis, axis + 2]
                        .into_iter()
                        .for_each(|side| sides[side] *= length / sum);
                }
            }
            let rect = reference.rect.shrunk(sides);
            Resolved::Rounded(corners.as_ref().map_or_else(
                || square(rect),
                |it| with_corners(rect, [width, height], it.each_ref()),
            ))
        }
        Shape::Ellipse(radii, center, is_circle) => {
            let center = center.resolve(width, height);
            let sides = [
                [center[0].abs(), (width - center[0]).abs()],
                [center[1].abs(), (height - center[1]).abs()],
            ];
            let [rx, ry] = [0, 1].map(|axis| {
                let candidates = if *is_circle {
                    sides.as_flattened()
                } else {
                    &sides[axis]
                };
                match &radii[axis] {
                    Ok(it) if *is_circle => {
                        it.resolve(width.hypot(height) / core::f32::consts::SQRT_2)
                    }
                    Ok(it) => it.resolve([width, height][axis]),
                    Err(Extent::FarthestSide) => candidates.iter().copied().fold(0.0, f32::max),
                    Err(_) => candidates.iter().copied().fold(f32::MAX, f32::min),
                }
            });
            let rect = Rect::new([x + center[0] - rx, y + center[1] - ry, rx * 2.0, ry * 2.0]);
            Resolved::Rounded(RoundedRect {
                rect,
                radii: [[rx, ry]; 4],
            })
        }
        Shape::Polygon(rule, points, radius) => {
            let points: Vec<_> = points
                .iter()
                .map(|it| it.resolve(width, height))
                .map(|it| [x + it[0], y + it[1]])
                .collect();
            Resolved::Path(
                if *radius > 0.0 {
                    rounded_polygon(&points, *radius)
                } else {
                    Path::polygon(points, true)
                },
                *rule,
            )
        }
        Shape::Commands(rule, commands) => Resolved::Path(
            commands
                .path(width, height)
                .transformed(&[1.0, 0.0, 0.0, 1.0, x, y]),
            *rule,
        ),
        Shape::Path(rule, data) => Resolved::Path(
            Path::parse(data).transformed(&[zoom, 0.0, 0.0, zoom, x, y]),
            *rule,
        ),
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Anchor {
    Start,
    End,
    Origin,
}

type Spot = (Position, Anchor);

/// In `shape()`.
#[derive(Clone, PartialEq)]
enum Command {
    Move(Spot),
    Line(Spot),
    /// Along the axis.
    Straight(usize, Lp, Anchor),
    Curve(Spot, Vec<Spot>),
    Smooth(Spot, Option<Spot>),
    Arc {
        to: Spot,
        radii: Vec<Lp>,
        is_clockwise: bool,
        is_large: bool,
        degrees: f32,
    },
    Close,
}

#[derive(Clone, PartialEq)]
pub(crate) struct Commands(Position, Vec<Command>);

fn command(p: &mut P, cx: &Ctx) -> Option<Command> {
    let anchor = |p: &mut P| {
        if keyword(p, "by") {
            Some(Anchor::Start)
        } else {
            keyword(p, "to").then_some(Anchor::Origin)
        }
    };
    let end = |p: &mut P| anchor(p).and_then(|anchor| Some((Position::parse(p, cx)?, anchor)));
    let control = |p: &mut P, default: Anchor| {
        let position = Position::parse(p, cx)?;
        let anchors = [
            ("start", Anchor::Start),
            ("end", Anchor::End),
            ("origin", Anchor::Origin),
        ];
        Some((
            position,
            if keyword(p, "from") {
                anchors.into_iter().find(|it| keyword(p, it.0))?.1
            } else {
                default
            },
        ))
    };
    Some(match () {
        () if keyword(p, "move") => Command::Move(end(p)?),
        () if keyword(p, "line") => Command::Line(end(p)?),
        () if keyword(p, "close") => Command::Close,
        () if keyword(p, "curve") => {
            let to = end(p).filter(|_| keyword(p, "with"))?;
            let mut controls = vec![control(p, to.1)?];
            controls.extend(if delim(p, b'/') {
                control(p, to.1)
            } else {
                None
            });
            Command::Curve(to, controls)
        }
        () if keyword(p, "smooth") => {
            let to = end(p)?;
            let with = if keyword(p, "with") {
                control(p, to.1)
            } else {
                None
            };
            Command::Smooth(to, with)
        }
        () if keyword(p, "arc") => {
            let to = end(p).filter(|_| keyword(p, "of"))?;
            let radii = core::iter::from_fn(|| Lp::parse(p, cx)).collect();
            let (mut sweep, mut size, mut angle) = (None, None, None);
            for _ in 0..3 {
                sweep = sweep.or_else(|| ["ccw", "cw"].into_iter().position(|it| keyword(p, it)));
                size =
                    size.or_else(|| ["small", "large"].into_iter().position(|it| keyword(p, it)));
                if angle.is_none() && keyword(p, "rotate") {
                    angle = Some(degrees(p, cx)?);
                }
            }
            Command::Arc {
                to,
                radii,
                is_clockwise: sweep == Some(1),
                is_large: size == Some(1),
                degrees: angle.unwrap_or(0.0),
            }
        }
        () => {
            let axis = ["hline", "vline"]
                .into_iter()
                .position(|it| keyword(p, it))?;
            let anchor = anchor(p)?;
            let edges = [
                &["left", "top", "x-start", "y-start"][..],
                &["center"],
                &["right", "bottom", "x-end", "y-end"],
            ];
            let edge = edges
                .into_iter()
                .position(|names| names.iter().any(|it| keyword(p, it)));
            Command::Straight(
                axis,
                edge.map(|it| Lp::Fraction(it as f32 / 2.0))
                    .or_else(|| Lp::parse(p, cx))?,
                anchor,
            )
        }
    })
}

impl Commands {
    pub(crate) fn parse(p: &mut P, cx: &Ctx) -> Option<Commands> {
        let start = keyword(p, "from")
            .then(|| Position::parse(p, cx))?
            .filter(|_| comma(p))?;
        Some(Commands(start, commas(p, |p| command(p, cx))?))
    }

    fn path(&self, width: f32, height: f32) -> Path {
        let mut start = self.0.resolve(width, height);
        let (mut at, mut data) = (start, format!("M{} {}", start[0], start[1]));
        for command in &self.1 {
            let place = |(position, anchor): &Spot, end: [f32; 2]| {
                let ([x, y], from) = (
                    position.resolve(width, height),
                    [at, end, [0.0; 2]][*anchor as usize],
                );
                [x + from[0], y + from[1]]
            };
            let (letter, controls, to): (_, Vec<_>, _) = match command {
                Command::Move(to) => ('M', Vec::new(), place(to, at)),
                Command::Line(to) => ('L', Vec::new(), place(to, at)),
                Command::Straight(axis, length, anchor) => {
                    let mut to = at;
                    to[*axis] = length.resolve([width, height][*axis])
                        + if *anchor == Anchor::Start {
                            at[*axis]
                        } else {
                            0.0
                        };
                    ('L', Vec::new(), to)
                }
                Command::Curve(to, with) => (
                    ['Q', 'C'][with.len() - 1],
                    with.iter()
                        .flat_map(|it| place(it, place(to, at)))
                        .collect(),
                    place(to, at),
                ),
                Command::Smooth(to, with) => (
                    if with.is_some() { 'S' } else { 'T' },
                    with.iter()
                        .flat_map(|it| place(it, place(to, at)))
                        .collect(),
                    place(to, at),
                ),
                Command::Arc {
                    to,
                    radii,
                    is_clockwise,
                    is_large,
                    degrees,
                } => {
                    let [x, y] = match &radii[..] {
                        [x, y] => [x.resolve(width), y.resolve(height)],
                        radii => {
                            [radii.first().map_or(0.0, |it| {
                                it.resolve(width.hypot(height) / core::f32::consts::SQRT_2)
                            }); 2]
                        }
                    };
                    (
                        'A',
                        vec![
                            x,
                            y,
                            *degrees,
                            f32::from(*is_large),
                            f32::from(*is_clockwise),
                        ],
                        place(to, at),
                    )
                }
                Command::Close => {
                    data.push('Z');
                    at = start;
                    continue;
                }
            };
            data.push(letter);
            controls
                .iter()
                .chain(&to)
                .for_each(|it| _ = write!(data, "{it} "));
            (at, start) = (to, if letter == 'M' { to } else { start });
        }
        Path::parse(&data)
    }
}

/// With arcs for corners.
fn rounded_polygon(points: &[[f32; 2]], radius: f32) -> Path {
    let (mut path, count) = (Path::default(), points.len());
    for index in 0..count {
        let [before, corner, after] = [count - 1, 0, 1].map(|by| points[(index + by) % count]);
        let [a, b] = [before, after].map(|it| [it[0] - corner[0], it[1] - corner[1]]);
        let ([from, to], cross) = (
            [a, b].map(|it| it[0].hypot(it[1])),
            a[0] * b[1] - a[1] * b[0],
        );
        let half = (cross.abs().atan2(a[0] * b[0] + a[1] * b[1]) / 2.0).tan();
        let cut = if cross.abs() > 1e-6 {
            (radius / half).min(from / 2.0).min(to / 2.0)
        } else {
            0.0
        };
        let [start, end] = [(a, from), (b, to)].map(|(it, length)| {
            [0, 1].map(|axis| corner[axis] + it[axis] * cut / length.max(1e-6))
        });
        path.verbs.push(if index == 0 {
            PathVerb::Move(start)
        } else {
            PathVerb::Line(start)
        });
        if cut > 0.0 {
            path.arc(start, [cut * half; 2], 0.0, false, cross < 0.0, end);
        }
    }
    path.verbs.push(PathVerb::Close);
    path
}
