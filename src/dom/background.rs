//! Shadows, backgrounds and masks.

use crate::abi::{BlendMode, GradientShape, GradientStop, Item, Rect, RoundedRect, Span, Tile};
use crate::boxes::{BoxId, VIEWPORT};
use crate::color::Exact;
use crate::color::Rgba;
use crate::contour::Contour;
use crate::document::Document;
use crate::effects::{Areas, BLACK, Subject};
use crate::paint::{Painter, Space, alpha, blend_mode, square};
use crate::properties::{Id, Style};
use crate::svg_values::{ColorInterpolation, MaskType};
use crate::tree::Replaced;
use crate::types::*;
use crate::values::{AxisPosition, Interpolation, mix, mix_colors, with_cors};

#[derive(Clone, Copy)]
pub(crate) struct Frame {
    /// The border box.
    pub(crate) shape: RoundedRect,
    pub(crate) border: [f32; 4],
    pub(crate) padding: [f32; 4],
    pub(crate) scrolled: Option<BoxId>,
    /// Where all of an inline box would be, and its border and padding, if this is a slice of it.
    pub(crate) whole: Option<(Rect, [f32; 4], [f32; 4])>,
}

impl Frame {
    pub(crate) fn unsliced(&self) -> Frame {
        self.whole.map_or(*self, |(rect, border, padding)| Frame {
            shape: square(rect),
            border,
            padding,
            ..*self
        })
    }

    /// Where an opaque border hides it, the background does not go on to the edge, where it would shine through.
    fn background_area(&self, area: BoxArea, style: &Style, scale: f32) -> RoundedRect {
        if area != BoxArea::BorderBox
            || self.border.contains(&0.0)
            || self.shape.radii == [[0.0; 2]; 4]
            || style.background.border_image.0.is_some()
        {
            return self.area(area);
        }
        let (p, l) = (&style.paint, &style.layout);
        let styles = [
            l.border_top_style,
            l.border_right_style,
            l.border_bottom_style,
            l.border_left_style,
        ];
        let is_opaque = [p.border_top, p.border_right, p.border_bottom, p.border_left]
            .into_iter()
            .all(|it| alpha(it.resolve(style.color())) == 0xff);
        if !is_opaque
            || styles
                .iter()
                .any(|it| matches!(it, BorderStyle::Dotted | BorderStyle::Dashed))
        {
            return self.shape;
        }
        let part = if styles.contains(&BorderStyle::Double) {
            6.0
        } else {
            2.0
        };
        self.shape.shrunk(
            self.border
                .map(|it| ((it * scale + 0.01) / part).floor() / scale),
        )
    }

    pub(crate) fn area(&self, area: BoxArea) -> RoundedRect {
        match area {
            BoxArea::PaddingBox => self.shape.shrunk(self.border),
            BoxArea::ContentBox | BoxArea::FillBox => self
                .shape
                .shrunk([0, 1, 2, 3].map(|side| self.border[side] + self.padding[side])),
            _ => self.shape,
        }
    }
}

struct Placement<'a> {
    x: &'a AxisPosition,
    y: &'a AxisPosition,
    size: &'a BackgroundSize,
    repeat: Repeat,
}

pub(crate) fn fitted([width, height]: [f32; 2], ratio: Option<f32>, cover: bool) -> [f32; 2] {
    match ratio {
        None => [width, height],
        Some(ratio) if (width / height > ratio) == cover => [width, width / ratio],
        Some(ratio) => [height * ratio, height],
    }
}

pub(crate) fn concrete_size(
    specified: [Option<f32>; 2],
    natural: [Option<f32>; 2],
    ratio: Option<f32>,
    default: [f32; 2],
) -> [f32; 2] {
    match specified {
        [Some(width), Some(height)] => [width, height],
        [Some(width), None] => [
            width,
            ratio
                .map(|it| width / it)
                .or(natural[1])
                .unwrap_or(default[1]),
        ],
        [None, Some(height)] => [
            ratio
                .map(|it| height * it)
                .or(natural[0])
                .unwrap_or(default[0]),
            height,
        ],
        [None, None] if natural == [None; 2] => fitted(default, ratio, false),
        [None, None] => concrete_size(natural, natural, ratio, default),
    }
}

pub(crate) fn gradient_shape(
    kind: &GradientKind,
    [width, height]: [f32; 2],
) -> (GradientShape, f32) {
    let linear = |radians: f32| {
        let (sin, cos) = radians.sin_cos();
        let length = (width * sin).abs() + (height * cos).abs();
        let [x, y] = [sin * length / 2.0, -cos * length / 2.0];
        let (from, to) = (
            [width / 2.0 - x, height / 2.0 - y],
            [width / 2.0 + x, height / 2.0 + y],
        );
        (GradientShape::Linear { from, to }, length)
    };
    let sides = |[x, y]: [f32; 2], extent: Extent| {
        let pick = if matches!(extent, Extent::ClosestSide | Extent::ClosestCorner) {
            f32::min
        } else {
            f32::max
        };
        [
            pick(x.abs(), (width - x).abs()),
            pick(y.abs(), (height - y).abs()),
        ]
    };
    let radial = |center, radius: [f32; 2]| {
        (
            GradientShape::Radial {
                center,
                radius: radius.map(|it| it.max(0.001)),
            },
            if radius[1] > 0.0 { radius[0] } else { 0.0 },
        )
    };
    match kind {
        GradientKind::Angle(degrees) => linear(degrees.to_radians()),
        GradientKind::Corner(x, y) => linear((x * height).atan2(-y * width)),
        GradientKind::Circle(radius, center) => {
            let center = center.resolve(width, height);
            let radius = radius.unwrap_or_else(|extent| match (extent, sides(center, extent)) {
                (Extent::ClosestSide, [x, y]) => x.min(y),
                (Extent::FarthestSide, [x, y]) => x.max(y),
                (_, [x, y]) => x.hypot(y),
            });
            radial(center, [radius; 2])
        }
        GradientKind::Ellipse(radii, center) => {
            let center = center.resolve(width, height);
            radial(
                center,
                match radii {
                    Ok([x, y]) => [x.resolve(width), y.resolve(height)],
                    Err(extent @ (Extent::ClosestSide | Extent::FarthestSide)) => {
                        sides(center, *extent)
                    }
                    Err(extent) => sides(center, *extent).map(|it| it * core::f32::consts::SQRT_2),
                },
            )
        }
        GradientKind::Points(points, _) => (
            GradientShape::Linear {
                from: points[0].resolve(width, height),
                to: points[1].resolve(width, height),
            },
            1.0,
        ),
        GradientKind::Conic(angle, center) => (
            GradientShape::Conic {
                center: center.resolve(width, height),
                angle: *angle,
            },
            360.0,
        ),
    }
}

pub(crate) fn gradient_stops(
    gradient: &Gradient,
    length: f32,
    current: Rgba,
    out: &mut Vec<GradientStop>,
) {
    let steps = if gradient.interpolation.is_polar() {
        256
    } else {
        32
    };
    let fraction = |it: &crate::values::Lp| {
        if length > 0.0 {
            it.resolve(length) / length.max(0.001)
        } else {
            it.resolve(1.0) - it.resolve(0.0)
        }
    };
    let position = |stop: &Stop| Some(fraction(stop.position.as_ref()?).clamp(-1e9, 1e9));
    let colored = || gradient.stops.iter().filter(|it| it.color.is_some());
    let mut offsets = spread_positions(colored().map(position).collect()).into_iter();
    let (mut previous, mut hint): (Option<(GradientStop, Exact)>, Option<f32>) = (None, None);
    for stop in &gradient.stops {
        let Some(color) = stop.color else {
            hint = position(stop);
            continue;
        };
        let to = GradientStop {
            offset: offsets.next().unwrap_or(1.0),
            color: color.resolve(current.0),
        };
        let exact = color
            .exact(Some(current))
            .unwrap_or_else(|| Exact::legacy(0));
        let is_plain = gradient.interpolation == Interpolation::SRGB
            && exact.is_plain()
            && previous.is_none_or(|it| it.1.is_plain());
        if let Some((from, before)) =
            previous.filter(|it| it.0.offset < to.offset && (hint.is_some() || !is_plain))
        {
            let middle = hint.map_or(0.5, |it| {
                ((it - from.offset) / (to.offset - from.offset)).clamp(0.001, 0.999)
            });
            out.extend((0..=steps).map(|step| {
                let at = step as f32 / steps as f32;
                let t = at.powf(0.5f32.ln() / middle.ln());
                let color = match is_plain {
                    true => mix_colors(from.color, to.color, t),
                    false => gradient.interpolation.mix(&before, &exact, t).rgba(),
                };
                GradientStop {
                    offset: mix(from.offset, to.offset, at),
                    color,
                }
            }));
        }
        if is_plain || previous.is_none_or(|it| it.0.offset >= to.offset) {
            out.push(to);
        }
        (previous, hint) = (Some((to, exact)), None);
    }
}

fn average(stops: &[GradientStop]) -> u32 {
    let (mut sums, mut total) = ([0.0; 4], 0.0);
    for [from, to] in stops.array_windows() {
        let (weight, [a, b]) = (
            to.offset - from.offset,
            [from, to].map(|it| it.color.to_be_bytes()),
        );
        (0..4).for_each(|it| sums[it] += weight * (f32::from(a[it]) + f32::from(b[it])) / 2.0);
        total += weight;
    }
    u32::from_be_bytes(sums.map(|it| (it / total).round() as u8))
}

/// An image that can be painted.
#[derive(Clone, Copy)]
pub(crate) struct Ready<'a> {
    image: &'a Image,
    pub(crate) id: u32,
    pub(crate) natural: [Option<f32>; 2],
    pub(crate) ratio: Option<f32>,
    /// The size of one of its pixels.
    pub(crate) unit: f32,
    is_mask: bool,
}

impl Document {
    pub(crate) fn ready<'a>(&self, image: &'a Image, style: &Style) -> Option<Ready<'a>> {
        self.ready_as(image, style, false)
    }

    fn ready_as<'a>(&self, image: &'a Image, style: &Style, is_mask: bool) -> Option<Ready<'a>> {
        let (image, resolution) = image.chosen(self.environment.scale * self.environment.zoom)?;
        let unit = style.zoom / resolution;
        Some(match image {
            Image::Url(url) => {
                let loaded = if is_mask {
                    self.oriented_image(&with_cors(url), style)
                } else {
                    self.oriented_image(url, style)
                }
                .filter(|it| it.image != 0)?;
                Ready {
                    image,
                    id: loaded.image,
                    natural: loaded.size.map(|it| Some(it? * unit)),
                    ratio: loaded.ratio,
                    unit,
                    is_mask,
                }
            }
            Image::Fade(fade) => {
                let [a, b] = fade
                    .0
                    .each_ref()
                    .map(|it| self.ready_as(it.as_ref()?, style, is_mask));
                let natural =
                    [0, 1].map(|axis| Some(mix(a?.natural[axis]?, b?.natural[axis]?, fade.1)));
                Ready {
                    image,
                    id: 0,
                    natural,
                    ratio: natural[0].zip(natural[1]).map(|it| it.0 / it.1),
                    unit,
                    is_mask,
                }
            }
            _ => Ready {
                image,
                id: 0,
                natural: [None; 2],
                ratio: None,
                unit,
                is_mask,
            },
        })
    }
}

impl<'a> Painter<'a> {
    pub(crate) fn draw(
        &mut self,
        ready: &Ready,
        clip: RoundedRect,
        tile: Tile,
        style: &Style,
        space: &Space,
    ) {
        let cell = Rect {
            x: 0.0,
            y: 0.0,
            ..tile.rect
        };
        match ready.image {
            Image::Gradient(gradient) => {
                let ((shape, length), start) = (
                    gradient_shape(&gradient.kind, [cell.width, cell.height]),
                    self.out.stops.len() as u32,
                );
                gradient_stops(gradient, length, style.ink.color, &mut self.out.stops);
                let has_no_size = length == 0.0 && matches!(shape, GradientShape::Radial { .. });
                if let all @ [first, .., last] = &self.out.stops[start as usize..]
                    && (has_no_size || gradient.repeating && first.offset == last.offset)
                {
                    let color = if gradient.repeating && first.offset < last.offset {
                        average(all)
                    } else {
                        last.color
                    };
                    self.out.stops.truncate(start as usize);
                    self.out
                        .stops
                        .extend([0.0, 1.0].map(|offset| GradientStop { offset, color }));
                }
                let stops = Span {
                    start,
                    end: self.out.stops.len() as u32,
                };
                let GradientKind::Points(points, Some(radii)) = &gradient.kind else {
                    return self.emit(
                        &Item::Gradient {
                            clip,
                            tile,
                            shape,
                            stops,
                            repeating: gradient.repeating,
                        },
                        space,
                    );
                };
                let [from, to] = [0, 1]
                    .map(|it| (points[it].resolve(cell.width, cell.height), radii[it]))
                    .map(|([x, y], radius)| [x, y, radius]);
                self.tiled(clip, tile, space, |painter, space| {
                    painter.emit(
                        &Item::Shade {
                            bounds: cell,
                            from,
                            to,
                            matrix: IDENTITY,
                            stops,
                            spread: 0,
                        },
                        space,
                    )
                });
            }
            Image::Fade(fade) => self.tiled(clip, tile, space, |painter, space| {
                let outer =
                    painter.begin_group(cell, 1.0, BlendMode::Normal, Span::default(), space);
                for (image, share) in fade.0.iter().zip([1.0 - fade.1, fade.1]) {
                    let Some(ready) = image
                        .as_ref()
                        .and_then(|it| painter.document.ready_as(it, style, ready.is_mask))
                    else {
                        continue;
                    };
                    let inner = painter.begin_group(
                        cell,
                        share,
                        BlendMode::PlusLighter,
                        Span::default(),
                        space,
                    );
                    painter.draw(
                        &ready,
                        square(cell),
                        Tile {
                            rect: cell,
                            step: [0.0; 2],
                        },
                        style,
                        space,
                    );
                    painter.end_group(inner);
                }
                painter.end_group(outer);
            }),
            _ => self.draw_image(clip, tile, ready.id, style, space),
        }
    }

    /// `part` of the image, whose size is `whole`, in each tile.
    pub(crate) fn draw_part(
        &mut self,
        ready: &Ready,
        whole: [f32; 2],
        part: Rect,
        clip: Rect,
        tile: Tile,
        style: &Style,
        space: &Space,
    ) {
        if ready.id != 0 && !crate::embedded::is_vector(ready.id) {
            return self.emit(
                &Item::ImagePart {
                    clip,
                    tile,
                    image: ready.id,
                    whole,
                    part,
                    pixelated: style.is_pixelated(),
                },
                space,
            );
        }
        self.tiled(square(clip), tile, space, |painter, space| {
            let ([x, y], mut inside) = (
                [tile.rect.width / part.width, tile.rect.height / part.height],
                *space,
            );
            let rect = Rect::new([0.0, 0.0, whole[0], whole[1]]);
            painter.vector([x, 0.0, 0.0, y, -part.x * x, -part.y * y], &mut inside);
            painter.draw(
                ready,
                square(rect),
                Tile {
                    rect,
                    step: [0.0; 2],
                },
                style,
                &inside,
            );
        });
    }

    fn image(
        &mut self,
        ready: &Ready,
        placement: &Placement,
        area: Rect,
        clip: RoundedRect,
        style: &Style,
        space: &Space,
    ) {
        let snapped = self.snap_rect(area);
        let (extent, whole) = ([area.width, area.height], [snapped.width, snapped.height]);
        let (mut size, is_auto) = match placement.size {
            BackgroundSize::Cover => (fitted(whole, ready.ratio, true), [false; 2]),
            BackgroundSize::Contain => {
                let size = fitted(whole, ready.ratio, false);
                (
                    [0, 1].map(|it| {
                        if size[it] == whole[it] {
                            size[it]
                        } else {
                            self.snap(size[it]).max(1.0)
                        }
                    }),
                    [false; 2],
                )
            }
            BackgroundSize::Explicit(width, height) => {
                let specified = [(width, extent[0]), (height, extent[1])]
                    .map(|(it, basis)| Some(it.0.as_ref()?.0.resolve(basis)));
                (
                    concrete_size(specified, ready.natural, ready.ratio, whole),
                    specified.map(|it| it.is_none()),
                )
            }
        };
        if size[0] <= 0.0 || size[1] <= 0.0 || clip.rect.is_empty() {
            return;
        }
        let (repeat, mut origin, mut step) = (
            [placement.repeat.0, placement.repeat.1],
            [snapped.x, snapped.y],
            [0.0; 2],
        );
        let available = [extent[0] - size[0], extent[1] - size[1]];
        for axis in (0..2).filter(|it| repeat[*it] == RepeatKind::Round && whole[*it] > 0.0) {
            let rounded = whole[axis] / (whole[axis] / size[axis]).round().max(1.0);
            if is_auto[1 - axis] && repeat[1 - axis] != RepeatKind::Round {
                size[1 - axis] *= rounded / size[axis];
            }
            size[axis] = rounded;
        }
        for axis in 0..2 {
            let fitting = (whole[axis] / size[axis] + 1e-4).floor();
            if repeat[axis] == RepeatKind::Space && fitting >= 2.0 {
                step[axis] = (whole[axis] - size[axis]) / (fitting - 1.0);
                continue;
            }
            let (offset, [start, end]) = (
                [placement.x, placement.y][axis].0.resolve(available[axis]),
                clip.rect.span(axis),
            );
            let repeats = matches!(repeat[axis], RepeatKind::Repeat | RepeatKind::Round);
            origin[axis] = if repeats {
                origin[axis] + offset
            } else {
                self.snap([area.x, area.y][axis] + offset)
            };
            if repeats && !(origin[axis] <= start && origin[axis] + size[axis] >= end) {
                step[axis] = size[axis];
            }
        }
        self.draw(
            ready,
            clip,
            Tile {
                rect: Rect::new([origin[0], origin[1], size[0], size[1]]),
                step,
            },
            style,
            space,
        );
    }

    fn background_layer(
        &mut self,
        style: &Style,
        index: usize,
        area: Rect,
        clip: RoundedRect,
        space: &Space,
    ) {
        let b = &style.background;
        let Some(ready) = b.image[index]
            .0
            .as_ref()
            .and_then(|it| self.document.ready(it, style))
        else {
            return;
        };
        let placement = Placement {
            x: b.x.at(index),
            y: b.y.at(index),
            size: b.size.at(index),
            repeat: *b.repeat.at(index),
        };
        self.image(&ready, &placement, area, clip, style, space);
    }

    fn blended(
        &mut self,
        style: &Style,
        index: usize,
        bounds: Rect,
        space: &Space,
        paint: impl FnOnce(&mut Self),
    ) {
        let blend = blend_mode(*style.background.blend.at(index));
        let group = (blend != BlendMode::Normal)
            .then(|| self.begin_group(bounds, 1.0, blend, Span::default(), space));
        paint(self);
        group.into_iter().for_each(|outer| self.end_group(outer));
    }

    fn fixed_area(&mut self, space: &Space) -> Rect {
        self.leave_scrolling_to_engine(space);
        self.depends_on_outside();
        self.document.client_box(VIEWPORT)
    }

    fn isolate_backgrounds(&mut self, style: &Style, bounds: Rect, space: &Space) -> Option<u32> {
        style
            .background
            .blend
            .iter()
            .any(|it| *it != Blend::Normal)
            .then(|| self.begin_group(bounds, 1.0, BlendMode::Normal, Span::default(), space))
    }

    /// `root` is the frame of the root element.
    fn is_in_transform(&self) -> bool {
        let tree = &self.document.tree;
        let mut styles = core::iter::once(self.painted_node)
            .chain(tree.flat_ancestors(self.painted_node))
            .filter_map(|it| tree.style(it));
        styles.any(|it| {
            it.has_transform()
                || it
                    .effects
                    .will_change
                    .0
                    .contains(crate::properties::WillChange::TRANSFORM)
        })
    }

    pub(crate) fn canvas_background(
        &mut self,
        style: &Style,
        viewport: Rect,
        root: &Frame,
        space: &Space,
    ) {
        let group = self.isolate_backgrounds(style, viewport, space);
        self.fill(
            square(viewport),
            style.paint.background_color.resolve(style.color()),
            space,
        );
        for index in (0..style.background.image.len())
            .rev()
            .filter(|it| style.background.image[*it].0.is_some())
        {
            let is_fixed = *style.background.attachment.at(index) == Attachment::Fixed;
            let area = if is_fixed {
                self.fixed_area(space)
            } else {
                root.area(*style.background.origin.at(index)).rect
            };
            self.blended(style, index, viewport, space, |painter| {
                painter.background_layer(style, index, area, square(viewport), space)
            });
        }
        group.into_iter().for_each(|it| self.end_group(it));
    }

    /// `text` paints the mask for `background-clip: text`.
    fn clipped(
        &mut self,
        style: &Style,
        frame: &Frame,
        contour: Option<&Contour>,
        area: BoxArea,
        space: &Space,
        text: &mut dyn FnMut(&mut Self),
        paint: &mut dyn FnMut(&mut Self, RoundedRect, &Space),
    ) {
        let is_masked = matches!(
            area,
            BoxArea::Text | BoxArea::BorderArea | BoxArea::BorderAreaAndText
        );
        let bounds = contour.map_or(frame.shape.rect, |it| it.bounds(frame, 0.0));
        let (group, mut inside) = (
            is_masked
                .then(|| self.begin_group(bounds, 1.0, BlendMode::Normal, Span::default(), space)),
            *space,
        );
        match contour {
            None => paint(
                self,
                frame.background_area(area, style, self.document.environment.scale),
                space,
            ),
            Some(contour) if contour.is_collapsed() => {}
            Some(contour) => {
                match area {
                    BoxArea::BorderArea | BoxArea::BorderAreaAndText => {
                        inside.visible = inside.visible.intersection(&bounds)
                    }
                    BoxArea::BorderBox => self.clip_inside(
                        contour,
                        frame,
                        contour.end_of_background(style),
                        &mut inside,
                    ),
                    _ => self.clip_inside(contour, frame, area.into(), &mut inside),
                }
                paint(self, square(inside.visible), &inside);
            }
        }
        if let Some(outer) = group {
            self.marker(&Item::Mask { luminance: false });
            if area != BoxArea::BorderArea {
                text(self);
            }
            if area != BoxArea::Text {
                self.border_in(style, frame, [BLACK; 4], space);
            }
            self.end_group(outer);
        }
    }

    pub(crate) fn background(
        &mut self,
        style: &Style,
        frame: &Frame,
        contour: Option<&Contour>,
        space: &Space,
        text: &mut dyn FnMut(&mut Self),
    ) {
        let b = &style.background;
        let (color, last) = (
            style.paint.background_color.resolve(style.color()),
            b.image.len() - 1,
        );
        if contour.is_none() && !style.paints().contains(crate::properties::Paints::LAYERS) {
            self.fill(
                frame.background_area(BoxArea::BorderBox, style, self.document.environment.scale),
                color,
                space,
            );
        } else if style.has_background() {
            let group = self.isolate_backgrounds(style, frame.shape.rect, space);
            let local = |index: usize| {
                frame
                    .scrolled
                    .filter(|_| *b.attachment.at(index) == Attachment::Local)
            };
            let clip = |index: usize| match b.clip.at(index).0 {
                BoxArea::BorderBox if local(index).is_some() => BoxArea::PaddingBox,
                area => area,
            };
            let scrolled = |painter: &mut Self, id: BoxId, rect: Rect| {
                let (range, offset) = (
                    painter.document.scroll_range(id),
                    painter
                        .document
                        .scroll_offset(painter.document.boxes[id].node),
                );
                rect.shrunk([range[1][0], -range[0][1], -range[1][1], range[0][0]])
                    .moved(offset.map(|it| -it))
            };
            let within = |painter: &mut Self, index: usize, shape: RoundedRect| match local(index)
                .filter(|_| clip(index) == BoxArea::ContentBox)
            {
                Some(id) => square(
                    scrolled(painter, id, shape.rect)
                        .intersection(&frame.area(BoxArea::PaddingBox).rect),
                ),
                None => shape,
            };
            if alpha(color) > 0 {
                self.clipped(
                    style,
                    frame,
                    contour,
                    clip(last),
                    space,
                    text,
                    &mut |painter, shape, space| {
                        let shape = within(painter, last, shape);
                        painter.fill(shape, color, space);
                    },
                );
            }
            for index in (0..=last).rev().filter(|it| b.image[*it].0.is_some()) {
                let mut area = frame.unsliced().area(*b.origin.at(index)).rect;
                if let Some(id) = local(index) {
                    area = scrolled(self, id, area);
                } else if *b.attachment.at(index) == Attachment::Fixed && !self.is_in_transform() {
                    area = self.fixed_area(space);
                }
                self.blended(
                    style,
                    index,
                    contour.map_or(frame.shape.rect, |it| it.bounds(frame, 0.0)),
                    space,
                    |painter| {
                        painter.clipped(
                            style,
                            frame,
                            contour,
                            clip(index),
                            space,
                            text,
                            &mut |painter, shape, space| {
                                let shape = within(painter, index, shape);
                                painter.background_layer(style, index, area, shape, space);
                            },
                        );
                    },
                );
            }
            group.into_iter().for_each(|it| self.end_group(it));
        }
    }

    pub(crate) fn frame(
        &mut self,
        style: &Style,
        frame: &Frame,
        has_background: bool,
        space: &Space,
        text: &mut dyn FnMut(&mut Self),
    ) {
        if style.is_bare() {
            return;
        }
        let (b, shadows, contour) = (
            &style.background,
            &style.paint.box_shadow.0,
            Contour::of(style, frame),
        );
        let (color, last) = (
            style.paint.background_color.resolve(style.color()),
            b.image.len() - 1,
        );
        let visible = || {
            shadows
                .iter()
                .rev()
                .map(|it| (it, it.color.resolve(style.color())))
                .filter(|it| alpha(it.1) > 0)
        };
        let covered =
            has_background && alpha(color) == 0xff && b.clip.at(last).0 == BoxArea::BorderBox;
        let simple = contour
            .as_ref()
            .and_then(|_| crate::contour::rounded_border_shape(style, frame));
        for (it, color) in visible().filter(|it| !it.0.inset) {
            let shape = simple.unwrap_or(frame.shape);
            let mut shadow = shape.spread(it.spread);
            shadow.rect = shadow.rect.moved(it.offset);
            if let Some(contour) = contour.as_ref().filter(|_| simple.is_none()) {
                self.contoured_shadow(contour, frame, it, color, space);
            } else if !shadow.rect.is_empty() && (it.blur > 0.0 || shadow != shape) {
                self.emit(
                    &Item::Shadow {
                        shape,
                        shadow: shadow.rect,
                        radii: shadow.radii,
                        blur: it.blur,
                        color,
                        inset: false,
                        covered,
                    },
                    space,
                );
            }
        }
        if has_background {
            self.background(style, frame, contour.as_ref(), space, text);
        }
        for (it, color) in visible().filter(|it| it.0.inset) {
            let shape = frame.area(BoxArea::PaddingBox);
            let mut shadow = shape.spread(-it.spread);
            shadow.rect = shadow.rect.moved(it.offset);
            if let Some(contour) = &contour {
                self.contoured_shadow(contour, frame, it, color, space);
            } else if it.blur > 0.0 || shadow != shape {
                self.emit(
                    &Item::Shadow {
                        shape,
                        shadow: shadow.rect,
                        radii: shadow.radii,
                        blur: it.blur,
                        color,
                        inset: true,
                        covered: false,
                    },
                    space,
                );
            }
        }
    }

    /// `space` has the units of the style, and `user` those of the subject.
    pub(crate) fn mask_layers(&mut self, subject: &Subject<'a, '_>, scaled: &Space, space: &Space) {
        let (document, style) = (subject.document, subject.style);
        let m = &style.mask;
        for index in (0..m.image.len()).rev() {
            let blend = match m.composite.at(index) {
                _ if index == m.image.len() - 1 => BlendMode::Normal,
                MaskComposite::Add => BlendMode::Normal,
                MaskComposite::Intersect => BlendMode::SourceIn,
                MaskComposite::Subtract => BlendMode::SourceOut,
                MaskComposite::Exclude => BlendMode::Xor,
            };
            let reference = match &m.image[index].0 {
                Some(Image::Url(url)) => Some(subject.mask_element(url))
                    .filter(|it| it.is_some() || document.fragment_of(url).is_some()),
                _ => None,
            };
            let element = reference.as_ref().and_then(Option::as_ref);
            let start = self.out.filters.len() as u32;
            if match m.mode.at(index) {
                MaskMode::MatchSource => {
                    element.is_some_and(|it| it.style.shape.mask_type == MaskType::Luminance)
                }
                mode => *mode == MaskMode::Luminance,
            } {
                let linear = element.is_some_and(|it| {
                    it.style.svg.color_interpolation == ColorInterpolation::LinearRgb
                });
                self.out
                    .filters
                    .push(crate::abi::Filter::Luminance { linear });
            }
            let (filters, space) = (
                Span {
                    start,
                    end: self.out.filters.len() as u32,
                },
                if reference.is_some() { space } else { scaled },
            );
            let image = m.image[index]
                .0
                .as_ref()
                .filter(|_| reference.is_none())
                .and_then(|it| document.ready_as(it, style, true));
            let (mut clip, mut inside) = (square(space.visible), *space);
            if *m.clip.at(index) != BoxArea::NoClip {
                clip = subject.area(*m.clip.at(index));
            }
            if blend != BlendMode::Normal && filters.end == start && reference.is_none() {
                if image.is_none() {
                    continue;
                }
                self.clip(clip, &mut inside);
                clip = square(clip.rect);
            }
            let space = &inside;
            let group = (blend != BlendMode::Normal || filters.end > start)
                .then(|| self.begin_group(space.visible, 1.0, blend, filters, space));
            if let Some(element) = element {
                self.svg_mask(element, &subject.user_space(), space);
            } else if let Some(image) = image {
                let placement = Placement {
                    x: m.x.at(index),
                    y: m.y.at(index),
                    size: m.size.at(index),
                    repeat: *m.repeat.at(index),
                };
                let text = document
                    .own_box(subject.node)
                    .filter(|_| *m.clip.at(index) == BoxArea::Text);
                let group = text.map(|it| {
                    (
                        it,
                        self.begin_group(clip.rect, 1.0, BlendMode::Normal, Span::default(), space),
                    )
                });
                let area = match &subject.areas {
                    Areas::Css(frame, _) if frame.whole.is_some() => {
                        frame.unsliced().area(*m.origin.at(index))
                    }
                    _ => subject.area(*m.origin.at(index)),
                };
                self.image(&image, &placement, area.rect, clip, style, space);
                if let Some((text, outer)) = group {
                    self.marker(&Item::Mask { luminance: false });
                    self.text_mask(text, space);
                    self.end_group(outer);
                }
            }
            group.into_iter().for_each(|outer| self.end_group(outer));
        }
        if let (Some(image), Areas::Css(frame, _)) = (
            style.parse_other::<Image>(Id::WebkitMaskBoxImageSource),
            &subject.areas,
        ) {
            self.nine_pieces(&image, crate::nine_pieces::MASK, style, frame, scaled);
        }
    }
}

impl Replaced {
    /// What `object-view-box` leaves of it, and where that is in fractions of the whole.
    pub(crate) fn at_resolution(self, resolution: f32) -> Replaced {
        Replaced {
            size: self
                .size
                .map(|it| Some((it? / resolution).min(crate::values::MAX_LENGTH))),
            ..self
        }
    }

    pub(crate) fn viewed(self, style: &Style) -> (Replaced, Rect) {
        let view = || {
            let ([Some(width), Some(height)], _) =
                (self.size, style.other_if_set(Id::ObjectViewBox)?)
            else {
                return None;
            };
            let shape = style.parse_other::<ClipPath>(Id::ObjectViewBox)?.0?;
            let Shape::Inset(sides, _) = &shape.0 else {
                return None;
            };
            let sides = [0, 1, 2, 3].map(|side| {
                sides[side].resolve([height, width][side % 2] * style.zoom) / style.zoom
            });
            let view = Some(Rect::new([0.0, 0.0, width, height]).shrunk(sides))
                .filter(|it| !it.is_empty() && width > 0.0 && height > 0.0)?;
            let viewed = Replaced {
                size: [Some(view.width), Some(view.height)],
                ratio: Some(view.width / view.height),
                ..self
            };
            Some((
                viewed,
                view.transformed(&crate::svg::scaling(1.0 / width, 1.0 / height)),
            ))
        };
        view().unwrap_or_else(|| (self, Rect::new([0.0, 0.0, 1.0, 1.0])))
    }
}

impl Style {
    pub(crate) fn has_background(&self) -> bool {
        alpha(self.paint.background_color.resolve(self.color())) > 0
            || self.background.image.iter().any(|it| it.0.is_some())
    }
}
