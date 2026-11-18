use std::hash::{Hash, Hasher};
use std::ops::Range;

use super::cpu::{self, Painter};
use super::raster::{IntRect, map_point, map_rect, transform};
use super::scene::{Scene, erases};
use super::stretch::Stretch;
use crate::abi::{Filter, GradientShape, Item, Outline, PathVerb, Rect, RoundedRect, Stroke, Tile};
use crate::gfx::Transform;
use crate::hash::SECRETS;
use crate::{images, parallel};

#[derive(Clone, Copy)]
struct Wide([u64; 2]);

impl Hasher for Wide {
    fn write(&mut self, bytes: &[u8]) {
        for chunk in bytes.chunks(8) {
            let mut word = [0; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            self.write_u64(u64::from_ne_bytes(word));
        }
    }

    fn write_u32(&mut self, value: u32) {
        self.write_u64(value.into());
    }

    fn write_u64(&mut self, value: u64) {
        for (lane, factor) in self
            .0
            .iter_mut()
            .zip([0x9E37_79B9_7F4A_7C15_u64, 0xC2B2_AE3D_27D4_EB4F])
        {
            let product = u128::from(*lane ^ value) * u128::from(factor);
            *lane = (product as u64 ^ (product >> 64) as u64).wrapping_add(factor);
        }
    }

    fn finish(&self) -> u64 {
        self.0[0]
    }
}

/// Of what is painted into an area, wherever the area is.
#[derive(Clone, Copy)]
pub struct Digest {
    hasher: Wide,
    origin: (f32, f32),
}

impl Digest {
    pub fn new(area: IntRect) -> Digest {
        let mut digest = Digest {
            hasher: Wide([SECRETS[0], SECRETS[1]]),
            origin: (area.left as f32, area.top as f32),
        };
        digest.value((area.width(), area.height()));
        digest
    }

    pub fn value(&mut self, value: impl Hash) {
        value.hash(&mut self.hasher);
    }

    pub fn lengths<const N: usize>(&mut self, lengths: [f32; N]) {
        self.value(lengths.map(|length| (length * 128. + 0.5f32.copysign(length)) as i32));
    }

    pub fn matrix(&mut self, matrix: &Transform) {
        self.value([matrix.sx, matrix.ky, matrix.kx, matrix.sy].map(f32::to_bits));
    }

    pub fn point(&mut self, matrix: &Transform, x: f32, y: f32) {
        let (x, y) = map_point(matrix, x, y);
        self.lengths([x - self.origin.0, y - self.origin.1]);
    }

    pub fn rect(&mut self, matrix: &Transform, rect: Rect) {
        self.point(matrix, rect.x, rect.y);
        self.lengths([rect.width, rect.height]);
    }

    pub fn shape(&mut self, matrix: &Transform, shape: &RoundedRect) {
        self.rect(matrix, shape.rect);
        shape
            .radii
            .into_iter()
            .for_each(|radius| self.lengths(radius));
        self.value(shape.smoothing.to_bits());
    }

    fn bits(&mut self, numbers: &[f32]) {
        numbers
            .iter()
            .for_each(|number| self.value(number.to_bits()));
    }

    fn placement(&mut self, matrix: &Transform) {
        self.matrix(matrix);
        self.point(matrix, 0., 0.);
    }

    fn verbs(&mut self, verbs: &[PathVerb], matrix: &Transform) {
        for verb in verbs {
            self.value(std::mem::discriminant(verb));
            match *verb {
                PathVerb::Move([x, y]) | PathVerb::Line([x, y]) => self.point(matrix, x, y),
                PathVerb::Cubic(a, b, c) => [a, b, c]
                    .into_iter()
                    .for_each(|[x, y]| self.point(matrix, x, y)),
                PathVerb::Close => {}
            }
        }
    }

    fn stroke(&mut self, scene: &Scene, stroke: &Stroke) {
        self.bits(&[stroke.width, stroke.miter_limit, stroke.dash_offset]);
        self.value((stroke.cap, stroke.join, scene.bytes(stroke.dashes)));
    }

    fn outline(&mut self, scene: &Scene, outline: &Outline, matrix: &Transform) {
        self.verbs(scene.verbs(outline.verbs), matrix);
        self.stroke(scene, &outline.stroke);
        self.value((outline.even_odd, outline.crisp, outline.how));
    }

    pub fn filters(&mut self, scene: &Scene, matrix: &Transform, filters: &[Filter]) {
        for filter in filters {
            self.value(std::mem::discriminant(filter));
            match *filter {
                Filter::DropShadow {
                    offset: [x, y],
                    blur,
                    color,
                } => {
                    self.lengths([x, y, blur]);
                    self.value(color);
                }
                Filter::Blur(amount) | Filter::Brightness(amount) | Filter::Contrast(amount) => {
                    self.lengths([amount])
                }
                Filter::Grayscale(amount) | Filter::HueRotate(amount) | Filter::Invert(amount) => {
                    self.lengths([amount])
                }
                Filter::Opacity(amount) | Filter::Saturate(amount) | Filter::Sepia(amount) => {
                    self.lengths([amount])
                }
                Filter::Luminance { linear } => self.value(linear),
                Filter::Graph(region) => {
                    self.placement(matrix);
                    self.rect(matrix, region);
                }
                Filter::Primitive {
                    kind,
                    linear,
                    arguments,
                } => self.value((kind, linear, scene.bytes(arguments))),
            }
        }
    }

    pub fn item(&mut self, painter: &Painter, item: &Item, matrix: &Transform) {
        let scene = painter.scene;
        self.value(std::mem::discriminant(item));
        match *item {
            Item::PushTransform(_) | Item::PushVector(_) | Item::Input | Item::Pop => {}
            Item::PushClip(shape) => self.shape(matrix, &shape),
            Item::PushClipPath { verbs, even_odd } => {
                self.value(even_odd);
                self.verbs(scene.verbs(verbs), matrix);
            }
            Item::PushClipOutline(outline) => self.outline(scene, &outline, matrix),
            Item::Path { outline, color } => {
                self.outline(scene, &outline, matrix);
                self.value(color);
            }
            Item::Shade {
                bounds,
                from,
                to,
                matrix: by,
                stops,
                spread,
            } => {
                self.rect(matrix, bounds);
                self.placement(&matrix.pre_concat(transform(by)));
                self.bits([from, to].as_flattened());
                self.value(spread);
                scene
                    .stops(stops)
                    .iter()
                    .for_each(|stop| self.value((stop.offset.to_bits(), stop.color)));
            }
            Item::PushPattern {
                bounds,
                tile: Tile { rect, step },
                matrix: by,
            } => {
                self.rect(matrix, bounds);
                self.placement(&matrix.pre_concat(transform(by)));
                self.bits(&[rect.x, rect.y, rect.width, rect.height, step[0], step[1]]);
            }
            Item::PushProjection(by) => {
                self.placement(matrix);
                self.bits(&by);
            }
            Item::TextStroke {
                origin: [x, y],
                face,
                size,
                glyphs,
                color,
                stroke,
                ..
            } => {
                self.point(matrix, x, y);
                self.value((face, size.to_bits(), color));
                self.stroke(scene, &stroke);
                scene
                    .glyphs(glyphs)
                    .iter()
                    .for_each(|glyph| self.value((glyph.id, glyph.x.to_bits(), glyph.y.to_bits())));
            }
            Item::ImagePart {
                clip,
                tile,
                image,
                whole,
                part,
                pixelated,
            } => {
                self.rect(matrix, clip);
                self.rect(matrix, tile.rect);
                self.bits(&[
                    tile.step[0],
                    tile.step[1],
                    whole[0],
                    whole[1],
                    part.x,
                    part.y,
                    part.width,
                    part.height,
                ]);
                self.value((
                    image,
                    pixelated,
                    images::info(image, painter.frame).map(|info| info.version),
                ));
            }
            Item::PushLayer {
                bounds,
                opacity,
                blend,
                filters,
            } => {
                self.rect(matrix, bounds);
                self.value((opacity.to_bits(), blend));
                self.filters(scene, matrix, scene.filters(filters));
            }
            Item::Mask { luminance } => self.value(luminance),
            Item::Backdrop {
                shape,
                filters,
                opacity,
            } => {
                self.value(opacity.to_bits());
                self.shape(matrix, &shape);
                self.filters(scene, matrix, scene.filters(filters));
            }
            Item::Fill { shape, color } => {
                self.shape(matrix, &shape);
                self.value(color);
            }
            Item::Border {
                shape,
                widths,
                colors,
                styles,
            } => {
                self.shape(matrix, &shape);
                self.lengths(widths);
                self.value((colors, styles));
            }
            Item::Shadow {
                shape,
                shadow,
                radii,
                blur,
                color,
                inset,
                covered,
            } => {
                self.shape(matrix, &shape);
                self.shape(
                    matrix,
                    &RoundedRect {
                        rect: shadow,
                        radii,
                        ..shape
                    },
                );
                self.value((blur.to_bits(), color, inset, covered));
            }
            Item::Gradient {
                clip,
                tile,
                shape,
                stops,
                repeating,
            } => {
                self.shape(matrix, &clip);
                self.rect(matrix, tile.rect);
                self.lengths(tile.step);
                self.value((std::mem::discriminant(&shape), repeating));
                match shape {
                    GradientShape::Linear { from: a, to: b }
                    | GradientShape::Radial {
                        center: a,
                        radius: b,
                    } => self.lengths([a[0], a[1], b[0], b[1]]),
                    GradientShape::Conic {
                        center: [x, y],
                        angle,
                    } => self.lengths([x, y, angle]),
                }
                scene
                    .stops(stops)
                    .iter()
                    .for_each(|stop| self.value((stop.offset.to_bits(), stop.color)));
            }
            Item::Image {
                clip,
                tile,
                image,
                pixelated,
            } => {
                self.shape(matrix, &clip);
                self.rect(matrix, tile.rect);
                self.lengths(tile.step);
                self.value((
                    image,
                    pixelated,
                    images::info(image, painter.frame).map(|info| info.version),
                ));
            }
            Item::Svg {
                clip, rect, hash, ..
            } => {
                self.rect(matrix, clip);
                self.rect(matrix, rect);
                self.value(hash);
            }
            Item::Text {
                origin: [x, y],
                face,
                size,
                glyphs,
                color,
                blur,
                ..
            } => {
                self.point(matrix, x, y);
                self.value((face, size.to_bits(), color, blur.to_bits()));
                for glyph in scene.glyphs(glyphs) {
                    self.value((glyph.id, glyph.x.to_bits(), glyph.y.to_bits()));
                }
            }
            Item::Line { rect, color, style } => {
                self.rect(matrix, rect);
                self.value((color, style));
            }
            Item::Caret { rect, color } => {
                self.rect(matrix, rect);
                self.value((color, painter.frame.shows_caret));
            }
        }
    }

    pub fn range(
        &mut self,
        painter: &Painter,
        range: Range<usize>,
        matrix: &Transform,
        area: IntRect,
    ) {
        let scene = painter.scene;
        for index in scene
            .children(range)
            .filter(|it| !painter.left_out.contains(it))
        {
            let item = &scene.items[index];
            let is_marker = matches!(item, Item::Mask { .. } | Item::Input);
            if !erases(item)
                && !is_marker
                && !IntRect::around(map_rect(matrix, scene.bounds(index))).overlaps(area)
            {
                continue;
            }
            self.item(painter, item, matrix);
            scene
                .border_over(index)
                .into_iter()
                .for_each(|it| self.lengths(it));
            let inside = index + 1..scene.end(index).saturating_sub(1);
            match *item {
                Item::PushTransform(by) => {
                    let matrix = painter.frame.concat(matrix, by);
                    self.matrix(&matrix);
                    self.range(painter, inside, &matrix, area);
                }
                Item::PushLayer { filters, .. } => {
                    let reach = cpu::filter_reach(scene.filters(filters), matrix);
                    self.range(painter, inside, matrix, area.outset(reach));
                }
                Item::PushVector(by) => {
                    let matrix = matrix.pre_concat(transform(by));
                    self.matrix(&matrix);
                    self.range(painter, inside, &matrix, area);
                }
                Item::PushPattern { .. } | Item::PushProjection(_) => {
                    let origin = std::mem::take(&mut self.origin);
                    self.range(
                        painter,
                        inside,
                        &Transform::from_scale(16., 16.),
                        IntRect::default().outset(1 << 24),
                    );
                    self.origin = origin;
                }
                Item::PushClip(_) | Item::PushClipPath { .. } | Item::PushClipOutline(_) => {
                    self.range(painter, inside, matrix, area)
                }
                _ => continue,
            }
            self.value(0xFFu8);
        }
    }

    pub fn finish(self) -> u128 {
        u128::from(self.hasher.0[0]) << 64 | u128::from(self.hasher.0[1])
    }
}

/// The digests of the cells of a grid.
pub struct Cells {
    /// The corner of the cell in column and row 0.
    origin: [i32; 2],
    /// Columns and rows.
    pub shown: IntRect,
    start: Digest,
    /// `None` if there is nothing in it.
    digests: Vec<Option<Digest>>,
    /// How many items are in it.
    loads: Vec<u32>,
}

impl Cells {
    const SIZE: [i32; 2] = [256, 128];

    pub fn new(origin: [i32; 2], area: IntRect, matrix: &Transform) -> Cells {
        let mut start = Digest::new(IntRect::new(origin[0], origin[1], origin[0], origin[1]));
        start.matrix(matrix);
        let mut cells = Cells {
            origin,
            shown: IntRect::default(),
            start,
            digests: Vec::new(),
            loads: Vec::new(),
        };
        cells.shown = cells.touched(area);
        cells
    }

    fn touched(&self, area: IntRect) -> IntRect {
        let ([x, y], [width, height]) = (self.origin, Cells::SIZE);
        let (column, row) = (
            |it: i32| (it - x).div_euclid(width),
            |it: i32| (it - y).div_euclid(height),
        );
        IntRect::new(
            column(area.left),
            row(area.top),
            column(area.right - 1) + 1,
            row(area.bottom - 1) + 1,
        )
    }

    pub fn load(&self, pixels: IntRect) -> u32 {
        let IntRect { left, top, .. } = self
            .touched(pixels)
            .offset(-self.shown.left, -self.shown.top);
        self.loads[top as usize * self.shown.width() + left as usize]
    }

    /// With its pixels, as far as they are `within`.
    pub fn at(&self, column: i32, row: i32, within: IntRect) -> Option<(u128, IntRect)> {
        let mut digest = self.digests[(row - self.shown.top) as usize * self.shown.width()
            + (column - self.shown.left) as usize]?;
        let ([x, y], [width, height]) = (self.origin, Cells::SIZE);
        let pixels = IntRect::new(0, 0, width, height)
            .offset(column * width, row * height)
            .intersect(within.offset(-x, -y));
        digest.value(pixels);
        Some((digest.finish(), pixels.offset(x, y)))
    }

    /// `shares` if other threads can help.
    pub fn range(
        &mut self,
        painter: &Painter,
        range: Range<usize>,
        matrix: &Transform,
        shares: bool,
    ) {
        let (mut digests, mut loads) = (
            vec![None; self.shown.area() as usize],
            vec![0; self.shown.area() as usize],
        );
        self.children(painter, range, matrix, shares, &mut |cells, value| {
            let cells = cells.offset(-self.shown.left, -self.shown.top);
            for at in (cells.top..cells.bottom)
                .map(|row| row as usize * self.shown.width() + cells.left as usize)
                .flat_map(|it| it..it + cells.width())
            {
                digests[at].get_or_insert(self.start).value(value);
                loads[at] += 1;
            }
        });
        (self.digests, self.loads) = (digests, loads);
    }

    fn children(
        &self,
        painter: &Painter,
        range: Range<usize>,
        matrix: &Transform,
        shares: bool,
        add: &mut dyn FnMut(IntRect, u128),
    ) {
        const MANY: usize = 256;
        let Painter {
            scene,
            frame,
            left_out,
        } = *painter;
        if !shares || scene.children(range.clone()).nth(MANY).is_none() {
            return self.items(painter, scene.children(range), matrix, shares, add);
        }
        let all: Vec<_> = scene.children(range).collect();
        let mut parts: Vec<_> = all
            .chunks(all.len().div_ceil(parallel::threads() * 2))
            .map(|it| (it, frame.rescaled(1.), Vec::new()))
            .collect();
        parallel::for_each(parts.iter_mut(), |(part, frame, found)| {
            self.items(
                &Painter {
                    scene,
                    frame,
                    left_out,
                },
                part.iter().copied(),
                matrix,
                false,
                &mut |cells, value| found.push((cells, value)),
            );
        });
        parts
            .into_iter()
            .flat_map(|it| it.2)
            .for_each(|(cells, value)| add(cells, value));
    }

    fn items(
        &self,
        painter: &Painter,
        all: impl Iterator<Item = usize>,
        matrix: &Transform,
        shares: bool,
        add: &mut dyn FnMut(IntRect, u128),
    ) {
        let scene = painter.scene;
        for index in all.filter(|it| !painter.left_out.contains(it)) {
            let (item, bounds) = (
                &scene.items[index],
                IntRect::around(map_rect(matrix, scene.bounds(index))),
            );
            let cells = if erases(item) {
                self.shown
            } else {
                self.touched(bounds).intersect(self.shown)
            };
            if cells.is_empty() || bounds.is_empty() && !erases(item) {
                continue;
            }
            let inner = match *item {
                Item::PushTransform(by) => Some(painter.frame.concat(matrix, by)),
                Item::PushVector(by) => Some(matrix.pre_concat(transform(by))),
                Item::PushLayer { filters, .. }
                    if scene.filters(filters).is_empty() && scene.mask(index).is_none() =>
                {
                    Some(*matrix)
                }
                Item::PushClip(_) | Item::PushClipPath { .. } | Item::PushClipOutline(_) => {
                    Some(*matrix)
                }
                _ => None,
            };
            let mut digest = self.start;
            let Some(inner) = inner else {
                digest.range(
                    painter,
                    index..scene.end(index),
                    matrix,
                    IntRect::default().outset(1 << 24),
                );
                add(cells, digest.finish());
                continue;
            };
            digest.item(painter, item, matrix);
            digest.matrix(&inner);
            add(cells, digest.finish());
            self.children(painter, scene.content(index), &inner, shares, add);
            add(cells, 0);
        }
    }
}

pub fn of_stretch(painter: &Painter, stretch: &Stretch, matrix: &Transform) -> u128 {
    let mut digest = Digest::new(stretch.area);
    digest.matrix(matrix);
    digest.item(painter, &stretch.item, matrix);
    digest.value("stretched");
    digest.finish()
}
