//! Paths as scripts have described them.

use std::f32::consts::{FRAC_PI_2, TAU};

use crate::abi::Rect;
use crate::abi_graphics::Verb;
use crate::gfx::{Command, Path, Point, Walk};

#[derive(Clone, Copy)]
pub struct Outline<'a>(pub &'a [u32]);

impl Outline<'_> {
    pub fn path(self) -> Path {
        let mut path = Path::new();
        self.walk(|it| path.push(it));
        path
    }

    /// For what is not all of a contour.
    pub fn walk_from(self, start: Option<Point>, mut take: impl FnMut(Command)) {
        start.into_iter().for_each(|it| take(Command::MoveTo(it)));
        self.walk(take);
    }

    /// None of them if there is no room for all.
    #[inline(always)]
    pub fn verbs(mut self, room: &mut [Verb]) -> &[Verb] {
        let mut count = 0;
        while let Some(verb) = Verb::read(&mut self.0) {
            let Some(place) = room.get_mut(count) else {
                return &[];
            };
            (*place, count) = (verb, count + 1);
        }
        &room[..count]
    }
}

impl Walk for Outline<'_> {
    #[inline]
    fn take_lines(&mut self, points: &mut Vec<Point>) -> Option<bool> {
        let (mut rest, before, mut is_closed) = (self.0, points.len(), false);
        let Some(Verb::Move(first)) = Verb::read(&mut rest) else {
            return None;
        };
        points.push(first.into());
        loop {
            let left = rest;
            match Verb::read(&mut rest) {
                Some(Verb::Line(to)) if !is_closed => points.push(to.into()),
                Some(Verb::Close) => is_closed = true,
                Some(Verb::Move(_)) | None => {
                    self.0 = left;
                    return Some(is_closed);
                }
                _ => {
                    points.truncate(before);
                    return None;
                }
            }
        }
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    #[inline(always)]
    fn walk(self, mut take: impl FnMut(Command)) {
        let (mut rest, mut at, mut start, mut is_open) = (self.0, None, Point::ZERO, false);
        while let Some(verb) = Verb::read(&mut rest) {
            if !std::mem::replace(&mut is_open, true)
                && at.is_some()
                && !matches!(verb, Verb::Move(_) | Verb::RoundRect { .. })
            {
                take(Command::MoveTo(start));
            }
            let (command, end) = match verb {
                Verb::Move(to) => {
                    start = to.into();
                    (Command::MoveTo(start), start)
                }
                Verb::Line(to) => (Command::LineTo(to.into()), to.into()),
                Verb::Quad(control, to) => (Command::QuadTo(control.into(), to.into()), to.into()),
                Verb::Cubic(first, second, to) => (
                    Command::CurveTo(first.into(), second.into(), to.into()),
                    to.into(),
                ),
                Verb::Close => {
                    is_open = false;
                    (Command::Close, start)
                }
                Verb::RoundRect {
                    rect:
                        Rect {
                            x,
                            y,
                            width,
                            height,
                        },
                    radius,
                } => {
                    const HANDLE: f32 = 1. - 0.552_284_8;
                    let (across, down) = (
                        Point::new(radius.copysign(width), 0.),
                        Point::new(0., radius.copysign(height)),
                    );
                    (start, is_open) = (Point::new(x, y), false);
                    take(Command::MoveTo(start + across));
                    for (x, y, from, to) in [
                        (x + width, y, -across, down),
                        (x + width, y + height, -down, -across),
                        (x, y + height, across, -down),
                        (x, y, down, across),
                    ] {
                        let corner = Point::new(x, y);
                        take(Command::LineTo(corner + from));
                        take(Command::CurveTo(
                            corner + from * HANDLE,
                            corner + to * HANDLE,
                            corner + to,
                        ));
                    }
                    (Command::Close, start)
                }
                Verb::Arc {
                    center,
                    radius,
                    from,
                    sweep,
                } => {
                    let sweep = sweep.clamp(-TAU, TAU);
                    // What is rounded differently must not leave a very short line, whose joins would show.
                    let is_near = |a: Point, b: Point| {
                        (a.x - b.x).abs().max((a.y - b.y).abs()) < 0.002 + radius * 2e-6
                    };
                    let place = |(sin, cos): (f32, f32)| {
                        Point::from(center) + Point::new(cos, sin) * radius
                    };
                    let (mut before, count) = (from.sin_cos(), (sweep.abs() / FRAC_PI_2).ceil());
                    let mut first = place(before);
                    match at {
                        None => {
                            start = first;
                            take(Command::MoveTo(first));
                        }
                        Some(at) if is_near(at, first) => first = at,
                        Some(_) => take(Command::LineTo(first)),
                    }
                    let (handle, mut end) = (4. / 3. * (sweep / count / 4.).tan() * radius, first);
                    let (sin, cos) = (sweep / count).sin_cos();
                    for step in 1..=count as u32 {
                        let after = (
                            before.0 * cos + before.1 * sin,
                            before.1 * cos - before.0 * sin,
                        );
                        let (begin, exact) = (end, place(after));
                        end = match Verb::read(&mut { rest }) {
                            _ if step < count as u32 => exact,
                            _ if sweep.abs() == TAU => first,
                            Some(Verb::Line(next)) if is_near(exact, next.into()) => next.into(),
                            Some(Verb::Close) if is_near(exact, start) => start,
                            _ => exact,
                        };
                        take(Command::CurveTo(
                            begin + Point::new(-before.0, before.1) * handle,
                            end + Point::new(after.0, -after.1) * handle,
                            end,
                        ));
                        before = after;
                    }
                    at = Some(end);
                    continue;
                }
            };
            at = Some(end);
            take(command);
        }
    }
}
