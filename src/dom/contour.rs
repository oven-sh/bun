//! `corner-shape` and `border-shape`

use crate::abi::{
    self, BlendMode, Item, LineStyle, Outline, Radii, Rect, RoundedRect, Span, Stroke,
};
use crate::background::Frame;
use crate::boxes::BoxId;
use crate::document::Document;
use crate::geometry::translation;
use crate::paint::{Painter, Space, alpha, square};
use crate::path::{Path, Point};
use crate::properties::{Id, Style};
use crate::segments::Layers;
use crate::shapes::Resolved;
use crate::types::*;
use crate::values::*;

/// The edge of a box that is not a rounded rectangle.
pub(crate) enum Contour {
    /// With the parameters of the superellipses.
    Corners(RoundedRect, [f32; 4]),
    /// With the width of the border.
    Stroked(Path, FillRule, f32),
    Filled([(Path, FillRule); 2]),
}

#[derive(Clone, Copy)]
pub(crate) enum Edge {
    /// So far outside of the border.
    Outer(f32),
    /// So far inside of the border.
    Inner(f32),
    /// At this fraction of the width of the border, from the outside.
    Within(f32),
    Content,
}

impl From<BoxArea> for Edge {
    fn from(area: BoxArea) -> Edge {
        match area {
            BoxArea::PaddingBox => Edge::Inner(0.0),
            BoxArea::ContentBox | BoxArea::FillBox => Edge::Content,
            _ => Edge::Outer(0.0),
        }
    }
}

fn superellipse(style: &Style, id: Id) -> f32 {
    let argument = style
        .other_if_set(id)
        .and_then(|it| it.strip_prefix("superellipse(")?.strip_suffix(')'));
    argument.and_then(|it| it.parse().ok()).unwrap_or(1.0)
}

/// So that corners that are opposite of each other do not overlap.
fn without_overlap(RoundedRect { rect, radii }: RoundedRect, shapes: [f32; 4]) -> Radii {
    let reach = |corner: usize, [x, y]: [f32; 2]| {
        let ([rx, ry], bulge) = (
            radii[corner],
            2.0 * (-f64::from(shapes[corner].min(0.0)).exp2()).exp2() as f32 - 1.0,
        );
        (rx * x + bulge * ry * y).max(bulge * rx * x + ry * y)
    };
    let factor = |a: usize, b: usize| {
        let axes = [
            [1.0, 0.0],
            [0.0, 1.0],
            [radii[a][1], radii[a][0]],
            [radii[b][1], radii[b][0]],
        ];
        axes.map(|it| (it[0] * rect.width + it[1] * rect.height) / (reach(a, it) + reach(b, it)))
            .into_iter()
            .fold(0.0, f32::max)
    };
    let pairs = [(0, 2), (1, 3)].into_iter().filter(|(a, b)| {
        shapes[*a].min(shapes[*b]) < 0.0 && radii[*a][0] > 0.0 && radii[*b][0] > 0.0
    });
    let scale = pairs.map(|(a, b)| factor(a, b)).fold(1.0, f32::min);
    radii.map(|it| it.map(|it| it * scale))
}

/// https://drafts.csswg.org/css-borders-4/#corner-shape-rendering
fn corner(
    outer: Point,
    to_start: Point,
    to_end: Point,
    shape: f32,
    [start_inset, end_inset]: [f32; 2],
    out: &mut Vec<Point>,
) {
    let at = |from: Point, terms: &[(Point, f32)]| {
        terms.iter().fold(from, |all, (it, by)| {
            [all[0] + it[0] * by, all[1] + it[1] * by]
        })
    };
    let [along_start, along_end] =
        [to_start, to_end].map(|it| it.map(|one| if one == 0.0 { 0.0 } else { one.signum() }));
    let clip_outer = at(outer, &[(along_end, start_inset), (along_start, end_inset)]);
    if shape == f32::INFINITY
        || to_start[0].hypot(to_start[1]) < 0.1
        || to_end[0].hypot(to_end[1]) < 0.1
    {
        return out.push(clip_outer);
    }
    let (is_concave, is_notch, curvature) = (
        shape < 0.0,
        shape < -8.0,
        f64::from(shape.abs()).exp2() as f32,
    );
    let convex_half = if is_notch {
        0.75
    } else {
        f64::from(-1.0 / curvature.min(2.0)).exp2() as f32
    };
    let half = if is_concave {
        1.0 - convex_half
    } else {
        convex_half
    };
    let control = [2.0 * half - 0.5, 1.5 - 2.0 * half];
    let [x, y] = [-control[1], control[0]].map(|it| it / control[0].hypot(control[1]));
    let offsets = [
        (along_start, -start_inset * x),
        (along_end, start_inset * y),
        (along_start, end_inset * y),
        (along_end, -end_inset * x),
    ];
    let (start, end) = (
        at(outer, &[(to_start, 1.0), offsets[0], offsets[1]]),
        at(outer, &[(to_end, 1.0), offsets[2], offsets[3]]),
    );
    let center = at(
        outer,
        &[(to_start, 1.0), (to_end, 1.0), offsets[3], offsets[0]],
    );
    let pivot = if is_concave {
        at(outer, &[offsets[1], offsets[2]])
    } else {
        center
    };
    let place = |x: f32, y: f32| {
        [0, 1].map(|it| pivot[it] + (end[it] - pivot[it]) * x + (start[it] - pivot[it]) * y)
    };
    let control = place(control[1], 1.0 - control[0]);
    let until_edge = |from: Point, along: Point| {
        let (axis, direction) = (
            usize::from(along[0] != 0.0),
            [control[0] - from[0], control[1] - from[1]],
        );
        if direction[axis].abs() < 1e-4 {
            from
        } else {
            at(
                from,
                &[(direction, (clip_outer[axis] - from[axis]) / direction[axis])],
            )
        }
    };
    out.push(until_edge(start, along_start));
    if is_notch {
        out.push(center);
    } else {
        const STEPS: usize = 48;
        out.extend((0..=STEPS).map(|step| {
            let (sin, cos) = (step as f32 / STEPS as f32 * core::f32::consts::FRAC_PI_2).sin_cos();
            let reach = (sin.powf(curvature) + cos.max(0.0).powf(curvature)).powf(-1.0 / curvature);
            let reach = if reach.is_finite() {
                reach
            } else {
                1.0 / sin.max(cos)
            };
            place(sin * reach, cos * reach)
        }));
    }
    out.push(until_edge(end, along_end));
}

/// What counts is where the winding number is positive.
fn corners(
    RoundedRect {
        rect,
        radii: [a, b, c, d],
    }: &RoundedRect,
    shapes: &[f32; 4],
    [top, right, bottom, left]: [f32; 4],
) -> Path {
    let mut points = Vec::new();
    let unit = |it: f32| it.max(1e-3);
    corner(
        [rect.x, rect.y],
        [0.0, unit(a[1])],
        [unit(a[0]), 0.0],
        shapes[0],
        [left, top],
        &mut points,
    );
    corner(
        [rect.right(), rect.y],
        [-unit(b[0]), 0.0],
        [0.0, unit(b[1])],
        shapes[1],
        [top, right],
        &mut points,
    );
    corner(
        [rect.right(), rect.bottom()],
        [0.0, -unit(c[1])],
        [-unit(c[0]), 0.0],
        shapes[2],
        [right, bottom],
        &mut points,
    );
    corner(
        [rect.x, rect.bottom()],
        [unit(d[0]), 0.0],
        [0.0, -unit(d[1])],
        shapes[3],
        [bottom, left],
        &mut points,
    );
    Path::polygon(points, true)
}

/// The side whose border `border-shape` takes after.
fn relevant_side(style: &Style) -> usize {
    let (l, [start, right, end, left]) = (&style.layout, style.text.writing_mode.sides());
    let styles = [
        l.border_top_style,
        l.border_right_style,
        l.border_bottom_style,
        l.border_left_style,
    ];
    let order = if style.is_rtl() {
        [start, right, end, left]
    } else {
        [start, left, end, right]
    };
    order
        .into_iter()
        .find(|it| styles[*it] != BorderStyle::None)
        .unwrap_or(start)
}

/// Whether the inner edge is no rounded rectangle.
fn curves_cross(
    RoundedRect {
        rect,
        radii: [a, b, c, d],
    }: &RoundedRect,
    [top, right, bottom, left]: [f32; 4],
) -> bool {
    let crosses = |length: f32, [start, end]: [f32; 2], radii: [f32; 2]| {
        (radii[0] - start).max(0.0) + (radii[1] - end).max(0.0)
            > (length - start - end).max(0.0) + 0.5
    };
    [[a[0], b[0]], [d[0], c[0]]]
        .into_iter()
        .any(|it| crosses(rect.width, [left, right], it))
        || [[a[1], d[1]], [b[1], c[1]]]
            .into_iter()
            .any(|it| crosses(rect.height, [top, bottom], it))
}

fn border_shapes(style: &Style, frame: &Frame) -> Option<(Resolved, Option<Resolved>)> {
    let (source, cx) = (
        style.other_if_set(Id::BorderShape)?,
        Ctx {
            zoom: style.zoom,
            ..Ctx::dummy()
        },
    );
    let one = |p: &mut P| {
        Some((
            function(p).and_then(|name| nested(p, |p| shape(name, p, &cx)))?,
            BoxArea::parse(p, &cx),
        ))
    };
    let (first, second) = parse_all(source.as_bytes(), |p| Some((one(p)?, one(p))))?;
    let resolve = |shape: &Shape, reference: RoundedRect| {
        crate::shapes::resolve(shape, &square(reference.rect), style.zoom)
    };
    Some(match second {
        Some(second) => (
            resolve(&first.0, frame.area(first.1.unwrap_or(BoxArea::BorderBox))),
            Some(resolve(
                &second.0,
                frame.area(second.1.unwrap_or(BoxArea::PaddingBox)),
            )),
        ),
        None => (
            resolve(
                &first.0,
                first.1.map_or_else(
                    || frame.shape.shrunk(frame.border.map(|it| it / 2.0)),
                    |it| frame.area(it),
                ),
            ),
            None,
        ),
    })
}

/// The outer edge of the `border-shape`, if it is a rounded rectangle.
pub(crate) fn rounded_border_shape(style: &Style, frame: &Frame) -> Option<RoundedRect> {
    let (Resolved::Rounded(shape), inner) = border_shapes(style, frame)? else {
        return None;
    };
    let by = if inner.is_some() {
        0.0
    } else {
        style.border()[relevant_side(style)] / 2.0
    };
    Some(RoundedRect {
        rect: shape.rect.grown(by),
        radii: shape
            .radii
            .map(|it| it.map(|it| if it > 0.0 { it + by } else { 0.0 })),
    })
}

impl Contour {
    pub(crate) fn of(style: &Style, frame: &Frame) -> Option<Contour> {
        if style.other_if_set(Id::BorderShape).is_some() {
            let (outer, inner) = border_shapes(style, frame)?;
            let (path, rule) = outer.into_path();
            return Some(match inner {
                Some(inner) => Contour::Filled([(path, rule), inner.into_path()]),
                None => Contour::Stroked(path, rule, style.border()[relevant_side(style)]),
            });
        }
        let ids = [
            Id::CornerTopLeftShape,
            Id::CornerTopRightShape,
            Id::CornerBottomRightShape,
            Id::CornerBottomLeftShape,
        ];
        (frame.shape.radii != Radii::default()).then_some(())?;
        if ids.iter().all(|it| style.other_if_set(*it).is_none()) {
            let has_padding = style.background.clip.contains(&BoxArea::ContentBox);
            let insets = [0, 1, 2, 3]
                .map(|it| frame.border[it] + if has_padding { frame.padding[it] } else { 0.0 });
            return curves_cross(&frame.shape, insets)
                .then_some(Contour::Corners(frame.shape, [1.0; 4]));
        }
        let shapes = ids.map(|it| superellipse(style, it));
        let matters = (0..4).any(|it| shapes[it] != 1.0 && frame.shape.radii[it] != [0.0; 2]);
        matters.then(|| {
            Contour::Corners(
                RoundedRect {
                    radii: without_overlap(frame.shape, shapes),
                    ..frame.shape
                },
                shapes,
            )
        })
    }

    /// The path, its rule unless that is "positive", and by how much it grows.
    pub(crate) fn edge(&self, frame: &Frame, edge: Edge) -> (Path, Option<FillRule>, f32) {
        match (self, edge) {
            (Contour::Corners(shape, shapes), _) => {
                let insets = match edge {
                    Edge::Outer(by) => [-by; 4],
                    Edge::Inner(by) => frame.border.map(|it| it + by),
                    Edge::Within(fraction) => frame.border.map(|it| it * fraction),
                    Edge::Content => [0, 1, 2, 3].map(|it| frame.border[it] + frame.padding[it]),
                };
                (
                    if shape.rect.shrunk(insets).is_empty() {
                        Path::default()
                    } else {
                        corners(shape, shapes, insets)
                    },
                    None,
                    0.0,
                )
            }
            (Contour::Stroked(path, rule, width), _) => (
                path.clone(),
                Some(*rule),
                match edge {
                    Edge::Outer(by) => width / 2.0 + by,
                    Edge::Inner(by) => -width / 2.0 - by,
                    Edge::Within(fraction) => width * (0.5 - fraction),
                    Edge::Content => -width / 2.0,
                },
            ),
            (Contour::Filled([(path, rule), _]), Edge::Outer(by)) => {
                (path.clone(), Some(*rule), by)
            }
            (Contour::Filled([_, (path, rule)]), _) => (
                path.clone(),
                Some(*rule),
                if let Edge::Inner(by) = edge { -by } else { 0.0 },
            ),
        }
    }

    pub(crate) fn is_collapsed(&self) -> bool {
        matches!(self, Contour::Stroked(path, ..) | Contour::Filled([_, (path, _)]) if path.bounds().is_none_or(|it| it.is_empty()))
    }

    /// Whether what ends in the middle of the border looks like it ends at either edge.
    pub(crate) fn is_hidden_by_border(&self, style: &Style) -> bool {
        let (p, l, widths) = (&style.paint, &style.layout, style.border());
        let is_opaque = |side: usize| {
            alpha(
                [p.border_top, p.border_right, p.border_bottom, p.border_left][side]
                    .resolve(style.color()),
            ) == 0xff
                && widths[side] >= 2.0
        };
        match self {
            Contour::Stroked(..) => is_opaque(relevant_side(style)),
            Contour::Filled(_) => false,
            Contour::Corners(..) => {
                let styles = [
                    l.border_top_style,
                    l.border_right_style,
                    l.border_bottom_style,
                    l.border_left_style,
                ];
                (0..4).all(is_opaque)
                    && styles == [BorderStyle::Solid; 4]
                    && style.background.border_image.0.is_none()
            }
        }
    }

    /// With `background-clip: border-box`
    pub(crate) fn end_of_background(&self, style: &Style) -> Edge {
        let p = &style.paint;
        match self {
            Contour::Filled(_)
                if alpha(
                    [p.border_top, p.border_right, p.border_bottom, p.border_left]
                        [relevant_side(style)]
                    .resolve(style.color()),
                ) == 0xff =>
            {
                Edge::Inner(-1.0)
            }
            Contour::Filled(_) => Edge::Inner(0.0),
            _ if self.is_hidden_by_border(style) => Edge::Within(0.5),
            _ => Edge::Outer(0.0),
        }
    }

    pub(crate) fn bounds(&self, frame: &Frame, by: f32) -> Rect {
        let (path, _, grows) = self.edge(frame, Edge::Outer(by));
        path.bounds()
            .unwrap_or_default()
            .grown(grows.max(0.0) * if path.has_corners() { MITER_REACH } else { 1.0 })
    }
}

impl Document {
    /// Whether the border is painted again over what it clips, which leaves no seam.
    pub(crate) fn covers_contents(&self, id: BoxId, contour: &Contour) -> bool {
        let it = &self.boxes[id];
        matches!(contour, Contour::Stroked(..))
            && !it.overflow.contains(&Overflow::Visible)
            && !it.is_replaced()
            && it.style.is_visible()
            && contour.is_hidden_by_border(&it.style)
            && !self
                .layers(id)
                .intersects(Layers::HAS_LEVEL | Layers::HAS_RAISED)
    }
}

const MITER_LIMIT: f32 = 1000.0;
const MITER_REACH: f32 = 20.0;

impl Painter<'_> {
    fn edge_outline(
        &mut self,
        contour: &Contour,
        frame: &Frame,
        edge: Edge,
        offset: [f32; 2],
    ) -> Outline {
        let (path, rule, grows) = contour.edge(frame, edge);
        let outline = self.outline_of(
            &path.transformed(&translation(offset)),
            rule.unwrap_or(FillRule::Nonzero),
        );
        let how = match grows {
            _ if rule.is_none() => abi::OUTLINE_POSITIVE,
            0.0 => 0,
            ..0.0 => abi::OUTLINE_WITHOUT_STROKE,
            _ => abi::OUTLINE_WITH_STROKE,
        };
        let stroke = Stroke {
            width: grows.abs() * 2.0,
            miter_limit: MITER_LIMIT,
            ..Stroke::default()
        };
        Outline {
            bounds: outline.bounds.grown(grows.max(0.0) * MITER_REACH),
            stroke,
            how,
            ..outline
        }
    }

    pub(crate) fn clip_inside(
        &mut self,
        contour: &Contour,
        frame: &Frame,
        edge: Edge,
        space: &mut Space,
    ) {
        let outline = self.edge_outline(contour, frame, edge, [0.0; 2]);
        space.visible = space.visible.intersection(&outline.bounds.grown(1.0));
        self.link(&Item::PushClipOutline(outline), space);
        if let (Edge::Content, false) = (edge, matches!(contour, Contour::Corners(..))) {
            self.clip(square(frame.area(BoxArea::ContentBox).rect), space);
        }
    }

    pub(crate) fn clip_outside(
        &mut self,
        contour: &Contour,
        frame: &Frame,
        edge: Edge,
        space: &mut Space,
    ) {
        let outline = self.edge_outline(contour, frame, edge, [0.0; 2]);
        self.link(
            &Item::PushClipOutline(Outline {
                bounds: space.visible.grown(1.0),
                how: outline.how | abi::OUTLINE_INVERSE,
                ..outline
            }),
            space,
        );
    }

    fn band(
        &mut self,
        contour: &Contour,
        frame: &Frame,
        [outer, inner]: [Edge; 2],
        space: &Space,
    ) -> Space {
        let mut inside = *space;
        self.clip_inside(contour, frame, outer, &mut inside);
        self.clip_outside(contour, frame, inner, &mut inside);
        inside
    }

    pub(crate) fn contoured_shadow(
        &mut self,
        contour: &Contour,
        frame: &Frame,
        shadow: &Shadow,
        color: u32,
        space: &Space,
    ) {
        let mut inside = *space;
        let edge = if shadow.inset {
            Edge::Inner(shadow.spread)
        } else {
            Edge::Outer(shadow.spread)
        };
        let mut outline = self.edge_outline(contour, frame, edge, shadow.offset);
        if shadow.inset {
            self.clip_inside(contour, frame, Edge::Inner(0.0), &mut inside);
            (outline.bounds, outline.how) = (
                inside.visible.grown(shadow.blur * 1.5 + 1.0),
                outline.how | abi::OUTLINE_INVERSE,
            );
        } else {
            self.clip_outside(contour, frame, Edge::Outer(0.0), &mut inside);
        }
        let start = self.out.filters.len() as u32;
        self.out
            .filters
            .extend((shadow.blur > 0.0).then_some(abi::Filter::Blur(shadow.blur / 2.0)));
        let group = (shadow.blur > 0.0).then(|| {
            self.begin_group(
                outline.bounds,
                1.0,
                BlendMode::Normal,
                Span {
                    start,
                    end: start + 1,
                },
                &inside,
            )
        });
        self.emit(&Item::Path { outline, color }, &inside);
        group.into_iter().for_each(|it| self.end_group(it));
    }

    /// Between two edges.
    fn uniform_line(
        &mut self,
        contour: &Contour,
        frame: &Frame,
        at: impl Fn(f32) -> Edge,
        width: f32,
        style: LineStyle,
        color: u32,
        space: &Space,
    ) {
        if let LineStyle::Dashed | LineStyle::Dotted = style {
            let (path, ..) = contour.edge(frame, at(0.5));
            let (is_dotted, length) = (style == LineStyle::Dotted, path.length());
            let period = length
                / (length / (width * if is_dotted { 2.0 } else { 3.0 }))
                    .round()
                    .max(1.0);
            let dashes = self.floats(if is_dotted {
                [0.0, period]
            } else {
                [period * 2.0 / 3.0, period / 3.0]
            });
            let stroke = Stroke {
                width,
                miter_limit: 4.0,
                dashes,
                cap: if is_dotted {
                    abi::CAP_ROUND
                } else {
                    abi::CAP_BUTT
                },
                ..Stroke::default()
            };
            let outline = self.outline_of(&path, FillRule::Nonzero);
            return self.emit(
                &Item::Path {
                    outline: Outline {
                        bounds: outline.bounds.grown(width * 2.0),
                        stroke,
                        ..outline
                    },
                    color,
                },
                space,
            );
        }
        let bands: &[[f32; 2]] = if style == LineStyle::Double && width >= 3.0 {
            &[[0.0, 1.0 / 3.0], [2.0 / 3.0, 1.0]]
        } else {
            &[[0.0, 1.0]]
        };
        for band in bands {
            let inside = self.band(contour, frame, band.map(&at), space);
            self.fill(square(inside.visible), color, &inside);
        }
    }

    pub(crate) fn contoured_outline(
        &mut self,
        contour: &Contour,
        frame: &Frame,
        offset: f32,
        width: f32,
        style: LineStyle,
        color: u32,
        space: &Space,
    ) {
        self.uniform_line(
            contour,
            frame,
            |at| Edge::Outer(offset + width * (1.0 - at)),
            width,
            style,
            color,
            space,
        );
    }

    pub(crate) fn contoured_border(
        &mut self,
        contour: &Contour,
        frame: &Frame,
        style: &Style,
        colors: [u32; 4],
        styles: [LineStyle; 4],
        space: &Space,
    ) {
        let color = colors[relevant_side(style)];
        match contour {
            Contour::Stroked(path, rule, width) if *width > 0.0 && alpha(color) > 0 => {
                let outline = self.outline_of(path, *rule);
                let stroke = Stroke {
                    width: *width,
                    miter_limit: MITER_LIMIT,
                    ..Stroke::default()
                };
                self.emit(
                    &Item::Path {
                        outline: Outline {
                            bounds: outline.bounds.grown(width * MITER_REACH),
                            stroke,
                            ..outline
                        },
                        color,
                    },
                    space,
                );
            }
            Contour::Stroked(..) => {}
            Contour::Filled(_) => {
                let inside = self.band(contour, frame, [Edge::Outer(0.0), Edge::Inner(0.0)], space);
                self.fill(square(inside.visible), color, &inside);
            }
            Contour::Corners(shape, _) => {
                let (widths, rect) = (frame.border, shape.rect);
                let mut shown = (0..4).filter(|it| widths[*it] > 0.0);
                let Some(first) = shown.next() else { return };
                let is_plain = matches!(
                    styles[first],
                    LineStyle::Solid | LineStyle::Double | LineStyle::Dashed | LineStyle::Dotted
                );
                if is_plain
                    && shown.all(|it| (colors[it], styles[it]) == (colors[first], styles[first]))
                {
                    return self.uniform_line(
                        contour,
                        frame,
                        Edge::Within,
                        widths[first],
                        styles[first],
                        colors[first],
                        space,
                    );
                }
                let inside = self.band(contour, frame, [Edge::Outer(0.0), Edge::Inner(0.0)], space);
                let scale = (rect.width / (widths[1] + widths[3]))
                    .min(rect.height / (widths[0] + widths[2]));
                self.emit(
                    &Item::Border {
                        shape: square(rect),
                        widths: widths.map(|it| it * scale),
                        colors,
                        styles,
                    },
                    &inside,
                );
            }
        }
    }
}
