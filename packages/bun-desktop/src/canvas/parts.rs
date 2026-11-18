//! Paths that are so long that several threads trace them.

use crate::abi::{Rect, Span};
use crate::abi_graphics::Verb;
use crate::gfx::Point;
use crate::paint::edges::{MAX_LENGTH, is_dense};
use crate::paint::raster::IntRect;

pub const LONG: usize = 4096;

pub struct Part {
    pub verbs: Span,
    /// Where it begins unless its verbs say so, and how far that is along the lines.
    pub from: Option<(Point, f64)>,
}

pub struct Parts {
    pub all: Vec<Part>,
    /// Polygons that make up for the lines that close the parts of a contour.
    pub links: Vec<Vec<Point>>,
    pub bounds: Rect,
}

#[derive(Clone, Copy)]
pub struct Stroke {
    pub width: f32,
    /// For each pixel.
    pub dashes: f32,
    /// Where it is cut, nothing shows of the caps.
    pub may_be_cut: bool,
}

/// The parts of a stroke overlap, so that all joins are there. `None` unless it pays and makes no difference.
pub fn split(words: &[u32], verbs: Span, area: IntRect, stroke: Option<Stroke>) -> Option<Parts> {
    const WORDS_PER_PART: u32 = 768;
    const DASHES_PER_PART: f64 = 1500.;
    const MAX_DASHES: f64 = 200_000.;
    let (mut rest, mut parts, mut links) = (&words[verbs.range()], Vec::new(), Vec::new());
    let (mut low, mut high, mut at, mut link) = (
        Point::new(f32::MAX, f32::MAX),
        Point::new(f32::MIN, f32::MIN),
        None::<Point>,
        Vec::new(),
    );
    let (mut part, mut along, mut rows, mut total, is_dashed) = (
        Part { verbs, from: None },
        0.,
        0.,
        0.,
        stroke.is_some_and(|it| it.dashes > 0.),
    );
    let pixels_per_part = DASHES_PER_PART / f64::from(stroke.map_or(0., |it| it.dashes));
    let mut next_cut = pixels_per_part;
    let mut cut = |part: &mut Part, end: u32, start: u32, from| {
        parts.push(Part {
            verbs: Span { end, ..part.verbs },
            ..std::mem::replace(
                part,
                Part {
                    verbs: Span { start, ..verbs },
                    from,
                },
            )
        })
    };
    loop {
        let start = verbs.end - rest.len() as u32;
        let (verb, is_long) = (
            Verb::read(&mut rest),
            start - part.verbs.start >= WORDS_PER_PART || total >= next_cut,
        );
        let (controls, to) = match verb {
            Some(Verb::Move(_)) | None => {
                if link.len() > 1 && stroke.is_none() {
                    link.extend(at);
                    links.push(std::mem::take(&mut link));
                }
                let Some(Verb::Move(to)) = verb else { break };
                if is_long || is_dashed && part.from.is_some() {
                    cut(&mut part, start, start, None);
                    next_cut = total + pixels_per_part;
                }
                link.clear();
                link.push(to.into());
                (at, along) = (None, 0.);
                ([to; 2], to)
            }
            Some(Verb::Line(to)) => ([to; 2], to),
            Some(Verb::Quad(a, to)) if !is_dashed => ([a; 2], to),
            Some(Verb::Cubic(a, b, to)) if !is_dashed => ([a, b], to),
            Some(Verb::Close)
                if (stroke.is_none() || link.len() <= 1)
                    && matches!(Verb::read(&mut { rest }), Some(Verb::Move(_)) | None) =>
            {
                continue;
            }
            Some(Verb::Arc {
                center: [x, y],
                radius,
                ..
            }) if link.len() <= 1 => {
                (rows, total, at) = (
                    rows + f64::from(radius * 4.),
                    total + f64::from(radius * 6.),
                    None,
                );
                link.clear();
                ([[x - radius, y - radius]; 2], [x + radius, y + radius])
            }
            _ => return None,
        };
        let to = Point::from(to);
        for it in [controls[0].into(), controls[1].into(), to] {
            (low, high) = (
                Point::new(low.x.min(it.x), low.y.min(it.y)),
                Point::new(high.x.max(it.x), high.y.max(it.y)),
            );
        }
        if let Some(from) = at {
            let length = f64::from((to - from).dot(to - from).sqrt());
            if is_long && !link.is_empty() && stroke.is_none_or(|it| it.may_be_cut && length > 0.1)
            {
                link.push(from);
                cut(
                    &mut part,
                    if stroke.is_some() {
                        verbs.end - rest.len() as u32
                    } else {
                        start
                    },
                    start,
                    Some((from, along)),
                );
                next_cut = total + pixels_per_part;
            }
            rows += f64::from(
                (controls[0][1] - from.y).abs()
                    + (controls[1][1] - controls[0][1]).abs()
                    + (to.y - controls[1][1]).abs(),
            );
            (along, total) = (along + length, total + length);
        }
        at = (!link.is_empty()).then_some(to);
    }
    parts.push(part);
    let bounds = Rect {
        x: low.x,
        y: low.y,
        width: high.x - low.x,
        height: high.y - low.y,
    };
    let (dashes, shown) = (
        total * f64::from(stroke.map_or(0., |it| it.dashes)),
        IntRect::around(bounds).intersect(area),
    );
    let rows = stroke.map_or(rows, |it| {
        rows * if is_dashed { 1. } else { 2. } + dashes * f64::from(it.width)
    });
    // Most of it is there to be seen.
    let is_near = (bounds.width * bounds.height) < shown.area() as f32 * 4.;
    (parts.len() > 1
        && is_near
        && dashes < MAX_DASHES
        && rows * 4. <= MAX_LENGTH as f64
        && is_dense((rows * 4.) as u64, shown)
        && area.width() <= crate::paint::edges::MAX_DENSE_WIDTH)
        .then_some(Parts {
            all: parts,
            links,
            bounds,
        })
}
