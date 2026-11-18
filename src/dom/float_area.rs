//! `shape-outside`

use std::rc::Rc;

use crate::abi::{GradientShape, Matrix, Rect, RoundedRect};
use crate::boxes::BoxId;
use crate::document::Document;
use crate::layout::Edges;
use crate::paint::{alpha, rounded};
use crate::shapes::{Resolved, resolve};
use crate::types::*;

/// What lines keep out of, relative to the margin box of a float.
pub(crate) enum FloatArea {
    Rounded(RoundedRect),
    /// With the margin around them.
    Edges(Vec<[[f32; 2]; 2]>, f32),
    /// One for each pixel.
    Rows(Rows),
}

type Rows = Rc<[Option<[f32; 2]>]>;

/// The last ones, with all that they are made from.
#[derive(Default)]
pub(crate) struct ImageShapes(Vec<((Image, u32, crate::color::Rgba, Matrix, [f32; 8]), Rows)>);

fn unite(a: Option<[f32; 2]>, b: Option<[f32; 2]>) -> Option<[f32; 2]> {
    a.zip(b)
        .map(|(a, b)| [a[0].min(b[0]), a[1].max(b[1])])
        .or(a)
        .or(b)
}

fn edge_between([a, b]: [[f32; 2]; 2], top: f32, bottom: f32) -> Option<[f32; 2]> {
    let [high, low] = if a[1] < b[1] { [a, b] } else { [b, a] };
    if low[1] <= top || high[1] >= bottom && !(top == bottom && high[1] == top) {
        return None;
    }
    let at = |y: f32| {
        high[0] + (low[0] - high[0]) * ((y - high[1]) / (low[1] - high[1])).clamp(0.0, 1.0)
    };
    Some([at(top).min(at(bottom)), at(top).max(at(bottom))])
}

impl FloatArea {
    /// From left to right, between `top` and `bottom`.
    pub(crate) fn across(&self, top: f32, bottom: f32) -> Option<[f32; 2]> {
        match self {
            FloatArea::Rounded(RoundedRect { rect, radii, .. }) => {
                if rect.is_empty()
                    || top >= rect.bottom()
                    || bottom <= rect.y && !(top == bottom && top == rect.y)
                {
                    return None;
                }
                let inset = |[rx, ry]: [f32; 2], into: f32| {
                    rx - rx * (1.0 - (1.0 - into / ry).powi(2)).max(0.0).sqrt()
                };
                let side = |upper: [f32; 2], lower: [f32; 2]| match () {
                    () if bottom < rect.y + upper[1] => inset(upper, bottom - rect.y),
                    () if top > rect.bottom() - lower[1] => inset(lower, rect.bottom() - top),
                    () => 0.0,
                };
                Some([
                    rect.x + side(radii[0], radii[3]),
                    rect.right() - side(radii[1], radii[2]),
                ])
            }
            FloatArea::Edges(edges, margin) => {
                let around = |[x, y]: [f32; 2]| {
                    let distance = (top - y).max(y - bottom).max(0.0);
                    let half = (distance < *margin)
                        .then(|| (margin * margin - distance * distance).sqrt())?;
                    Some([x - half, x + half])
                };
                let across = |&[a, b]: &[[f32; 2]; 2]| {
                    let scale = margin / (b[0] - a[0]).hypot(b[1] - a[1]);
                    let normal = [(b[1] - a[1]) * scale, (a[0] - b[0]) * scale];
                    let moved = |sign: f32| {
                        edge_between(
                            [a, b].map(|it| [it[0] + normal[0] * sign, it[1] + normal[1] * sign]),
                            top,
                            bottom,
                        )
                    };
                    [moved(1.0), moved(-1.0), around(a), around(b)]
                        .into_iter()
                        .fold(None, unite)
                };
                edges
                    .iter()
                    .filter(|[a, b]| a[1] != b[1])
                    .map(across)
                    .fold(None, unite)
            }
            FloatArea::Rows(rows) => {
                let (first, last) = (top.max(0.0) as usize, bottom.max(0.0) as usize);
                rows.iter()
                    .take(last.max(first + 1))
                    .skip(first)
                    .copied()
                    .fold(None, unite)
            }
        }
    }
}

fn gradient_alpha(
    gradient: &Gradient,
    color: crate::color::Rgba,
    [width, height]: [usize; 2],
) -> Vec<u8> {
    let ((shape, length), mut stops) = (
        crate::background::gradient_shape(&gradient.kind, [width as f32, height as f32]),
        Vec::new(),
    );
    crate::background::gradient_stops(gradient, length, color, &mut stops);
    let (Some(first), Some(last)) = (stops.first(), stops.last()) else {
        return Vec::new();
    };
    let pixel = |index: usize| {
        let [x, y] = [(index % width) as f32 + 0.5, (index / width) as f32 + 0.5];
        let mut t = match shape {
            GradientShape::Linear { from, to } => {
                ((x - from[0]) * (to[0] - from[0]) + (y - from[1]) * (to[1] - from[1]))
                    / (length * length)
            }
            GradientShape::Radial { center, radius } => {
                ((x - center[0]) / radius[0]).hypot((y - center[1]) / radius[1])
            }
            GradientShape::Conic { center, angle } => {
                ((x - center[0]).atan2(center[1] - y).to_degrees() - angle).rem_euclid(360.0)
                    / 360.0
            }
        };
        if gradient.repeating && last.offset > first.offset {
            t = first.offset + (t - first.offset).rem_euclid(last.offset - first.offset);
        }
        let next = stops.partition_point(|it| it.offset <= t);
        let [a, b] = [next.saturating_sub(1), next.min(stops.len() - 1)].map(|it| stops[it]);
        let [from, to] = [a, b].map(|it| alpha(it.color) as f32);
        (from
            + if b.offset > a.offset {
                (to - from) * (t - a.offset) / (b.offset - a.offset)
            } else {
                0.0
            })
        .round() as u8
    };
    (0..width * height).map(pixel).collect()
}

impl Document {
    /// `size` is that of the margin box.
    pub(crate) fn float_area(
        &self,
        id: BoxId,
        margin: Edges,
        size: [f32; 2],
        basis: f32,
    ) -> Option<Box<FloatArea>> {
        const MOST_PIXELS: f32 = (1 << 24) as f32;
        let it = &self.boxes[id];
        let ((shape, area), mode) = (it.style.rare.shape_outside.0.0.as_deref()?, it.turned);
        let [margin, border, padding] =
            [margin.to_array(), it.border(), it.inset(basis).to_array()]
                .map(|it| mode.physical_sides(&it));
        let ([width, height], grown) = (
            mode.turn_axes(size),
            it.style.rare.shape_margin.0.resolve(basis).max(0.0),
        );
        let outline = rounded(
            Rect::new([0.0, 0.0, width, height]).shrunk(margin),
            &it.style,
        );
        let turn = invert(&mode.to_physical(size))?;
        let reference = match area {
            BoxArea::PaddingBox => outline.shrunk(border),
            BoxArea::ContentBox => outline.shrunk(padding),
            BoxArea::MarginBox => outline.outset(margin),
            _ => outline,
        };
        let insets = match area {
            BoxArea::PaddingBox => border,
            BoxArea::ContentBox => padding,
            BoxArea::MarginBox => margin.map(|it| -it),
            _ => [0.0; 4],
        };
        if let Some(path) = matches!(shape, Shape::Box)
            .then(|| crate::contour::shaped_corners(&it.style, outline, insets))
            .flatten()
        {
            const TOUCHING: f32 = 1.0 / 64.0;
            let RoundedRect {
                rect,
                radii: [a, b, c, d],
                ..
            } = reference;
            let down = |x: f32, upper: [f32; 2], lower: [f32; 2]| {
                [
                    [x, rect.y + upper[1] - TOUCHING],
                    [x, rect.bottom() - lower[1] + TOUCHING],
                ]
            };
            let along = |y: f32, left: [f32; 2], right: [f32; 2]| {
                [
                    [rect.x + left[0] - TOUCHING, y],
                    [rect.right() - right[0] + TOUCHING, y],
                ]
            };
            let sides = [
                down(rect.x, a, d),
                down(rect.right(), b, c),
                along(rect.y, a, b),
                along(rect.bottom(), d, c),
            ];
            let inside = |[x, y]: [f32; 2]| {
                [
                    x.max(rect.x).min(rect.right()),
                    y.max(rect.y).min(rect.bottom()),
                ]
            };
            let edges = path
                .pieces()
                .iter()
                .map(|it| [it.from, it.to].map(inside))
                .chain(sides)
                .map(|it| it.map(|it| apply(&turn, it)))
                .collect();
            return Some(Box::new(FloatArea::Edges(edges, grown)));
        }
        Some(Box::new(
            match (shape, resolve(shape, &reference, it.style.zoom)) {
                (Shape::Image(image), _) => {
                    let content = outline.shrunk(padding).rect;
                    let mut extent = [content.width, content.height];
                    let loaded = if let Image::Url(url) = image {
                        Some(self.shape_image(url, it.node)?)
                    } else {
                        None
                    };
                    if let Some(loaded) = loaded.filter(|_| !it.is_replaced()) {
                        extent = crate::background::concrete_size(
                            [None; 2],
                            loaded.size.map(|size| Some(size? * it.style.zoom)),
                            loaded.ratio,
                            extent,
                        );
                    }
                    if extent[0] * extent[1] > MOST_PIXELS
                        || size[0].max(1.0) * size[1] > MOST_PIXELS
                    {
                        return None;
                    }
                    let (pixels, threshold) = (
                        extent.map(|it| it.round() as usize),
                        it.style.rare.shape_threshold.0 * 255.0,
                    );
                    let key = (
                        image.clone(),
                        self.svg_changes,
                        it.style.ink.color,
                        turn,
                        [
                            content.x, content.y, extent[0], extent[1], size[0], size[1],
                            threshold, grown,
                        ],
                    );
                    if let Some(known) = self.image_shapes.borrow().0.iter().find(|it| it.0 == key)
                    {
                        return Some(Box::new(FloatArea::Rows(Rc::clone(&known.1))));
                    }
                    let alphas = match image {
                        Image::Gradient(gradient) => {
                            gradient_alpha(gradient, it.style.ink.color, pixels)
                        }
                        _ => self.image_alpha(loaded?.image, pixels),
                    };
                    let mut rows = vec![None; size[1].ceil().max(0.0) as usize];
                    for (y, line) in alphas.chunks(pixels[0].max(1)).enumerate() {
                        let mut covered =
                            (0..line.len()).filter(|x| f32::from(line[*x]) > threshold);
                        let ends = if turn[1] == 0.0 {
                            [covered.next(), covered.next_back()]
                        } else {
                            [None; 2]
                        };
                        for x in ends
                            .into_iter()
                            .flatten()
                            .chain(covered.take(if turn[1] == 0.0 { 0 } else { usize::MAX }))
                        {
                            let [x, y] = apply(
                                &turn,
                                [
                                    content.x.round() + x as f32 + 0.5,
                                    content.y.round() + y as f32 + 0.5,
                                ],
                            );
                            if let Some(row) = rows.get_mut(y as usize).filter(|_| y >= 0.0) {
                                *row = unite(*row, Some([x - 0.5, x + 0.5]));
                            }
                        }
                    }
                    let reach = grown
                        .ceil()
                        .min(size[0].hypot(size[1]))
                        .min(MOST_PIXELS / size[1].max(1.0))
                        as usize;
                    let around = |y: usize| {
                        let near = rows
                            .iter()
                            .enumerate()
                            .take(y + reach + 1)
                            .skip(y.saturating_sub(reach));
                        let half = |at: usize| {
                            ((reach * reach - at.abs_diff(y).pow(2)) as f32)
                                .sqrt()
                                .floor()
                        };
                        near.map(|(at, row)| {
                            row.map(|[left, right]| [left - half(at), right + half(at)])
                        })
                        .fold(None, unite)
                    };
                    let (rows, known): (Rows, _) = (
                        (0..rows.len()).map(around).collect(),
                        &mut self.image_shapes.borrow_mut().0,
                    );
                    known.truncate(7);
                    known.insert(0, (key, Rc::clone(&rows)));
                    FloatArea::Rows(rows)
                }
                (_, Resolved::Rounded(RoundedRect { rect, radii, .. })) => {
                    let (turned, mut turned_radii) = (rect.transformed(&turn), radii);
                    for (corner, radius) in
                        [[0.0, 0.0], [width, 0.0], [width, height], [0.0, height]]
                            .into_iter()
                            .zip(radii)
                    {
                        let (far, [x, y]) = (
                            apply(&turn, [width / 2.0, height / 2.0]),
                            apply(&turn, corner),
                        );
                        turned_radii
                            [[[0, 1], [3, 2]][usize::from(y > far[1])][usize::from(x > far[0])]] =
                            mode.turn_axes(radius);
                    }
                    FloatArea::Rounded(RoundedRect {
                        rect: turned.grown(grown),
                        radii: turned_radii.map(|it| it.map(|it| it + grown)),
                        smoothing: 0.0,
                    })
                }
                (_, Resolved::Path(path, _)) => FloatArea::Edges(
                    path.pieces()
                        .iter()
                        .map(|it| [it.from, it.to].map(|it| apply(&turn, it)))
                        .collect(),
                    grown,
                ),
            },
        ))
    }
}
