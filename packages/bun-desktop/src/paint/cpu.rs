use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use super::blur::{self, mirror};
use super::border::{self, Border};
use super::gradient::{Geometry, Gradient, Spread};
use super::raster::{
    Clip, Coverage, IntRect, Layer, Paint, Path, Pixel, average_scale, blend_row, has_radii,
    inner_band, map_point, map_rect, premultiply, scale, transform,
};
use super::scene::{
    Frame, Scene, erases, filtered_bounds, has_graph, intersect, outset, tile_bounds, union,
};
use super::stretch::Stretch;
use super::warp::{self, Projection};
use super::{blend, digest, filter, graph};
use crate::abi::{
    self, BlendMode, Filter, GradientShape, GradientStop, Item, LineStyle, Rect, RoundedRect, Tile,
};
use crate::gfx::{self, Cap, Fill, Join, Pixmap, Transform};
use crate::hash::FastMap;
use crate::images::{self, Content};
use crate::text::{self, GlyphImage, GlyphPixels};

/// Identifies the image of a glyph that is neither rotated nor skewed.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct GlyphKey {
    pub face: u32,
    pub glyph: u32,
    /// In 64ths of a device pixel.
    size: u32,
    /// In quarters of a device pixel.
    shift: u8,
    hint: bool,
    color: u32,
}

impl GlyphKey {
    pub fn bits(self) -> u128 {
        u128::from(self.face) << 96
            | u128::from(self.glyph & 0xFF_FFFF) << 72
            | u128::from(self.size & 0xFF_FFFF) << 48
            | u128::from(self.shift) << 40
            | u128::from(self.hint) << 32
            | u128::from(self.color)
    }

    pub fn rasterize(self) -> Option<GlyphImage> {
        let shift = Transform::from_translate(f32::from(self.shift) / 4., 0.);
        text::rasterize(
            text::face(self.face)?,
            self.glyph,
            self.size as f32 / 64.,
            &shift,
            self.hint,
            self.color,
        )
    }
}

/// Places the glyphs of a run under a uniform scale.
pub struct GlyphPlacer {
    key: GlyphKey,
    matrix: Transform,
}

const LARGEST_HINTED: f32 = 48.;

impl GlyphPlacer {
    pub fn takes(matrix: &Transform) -> bool {
        matrix.kx == 0. && matrix.ky == 0. && matrix.sx > 0. && (matrix.sx - matrix.sy).abs() < 1e-4
    }

    pub fn new(
        frame: &Frame,
        matrix: &Transform,
        origin: [f32; 2],
        face: u32,
        size: f32,
        color: u32,
    ) -> Option<GlyphPlacer> {
        if !Self::takes(matrix) {
            return None;
        }
        let is_at_rest = !frame.snaps || frame.is_translation(matrix);
        let size = size * matrix.sx;
        let mut matrix = matrix.pre_translate(origin[0], origin[1]);
        matrix.ty = (matrix.ty + 0.5).floor();
        let key = GlyphKey {
            face,
            glyph: 0,
            // While a scale animates, few sizes are rasterized.
            size: if is_at_rest {
                (size * 64.).round() as u32
            } else {
                (size * 4.).round() as u32 * 16
            },
            shift: 0,
            hint: is_at_rest
                && frame.scale < 1.5
                && size <= LARGEST_HINTED
                && !cfg!(target_os = "macos"),
            color: text::ink_for(text::face(face)?, color),
        };
        Some(GlyphPlacer { key, matrix })
    }

    /// The same for all that place glyphs whole pixels apart.
    pub fn phase(&self) -> u64 {
        u64::from(self.matrix.sx.to_bits()) << 32
            | u64::from((self.matrix.tx - self.matrix.tx.floor()).to_bits())
    }

    /// The image, and the pixel that its origin goes to.
    pub fn place(&self, glyph: &crate::abi::Glyph) -> (GlyphKey, i32, i32) {
        let (x, y) = map_point(&self.matrix, glyph.x, glyph.y);
        let quarters = (x * 4. + 0.5).floor() as i32;
        let key = GlyphKey {
            glyph: glyph.id,
            shift: (quarters & 3) as u8,
            ..self.key
        };
        (key, quarters >> 2, (y + 0.5).floor() as i32)
    }
}

thread_local! {
    static STRETCHES: RefCell<FastMap<u128, Rc<Layer>>> = RefCell::default();
    static GLYPHS: RefCell<FastMap<GlyphKey, Option<Rc<GlyphImage>>>> = RefCell::default();
}

pub fn release_memory() {
    STRETCHES.take();
    GLYPHS.take();
}

pub fn cached_glyph(key: GlyphKey) -> Option<Rc<GlyphImage>> {
    GLYPHS.with_borrow_mut(|glyphs| {
        if glyphs.len() > 4096 {
            glyphs.clear();
        }
        glyphs
            .entry(key)
            .or_insert_with(|| key.rasterize().map(Rc::new))
            .clone()
    })
}

fn draw_glyph(layer: &mut Layer, image: &GlyphImage, x: i32, y: i32, clip: &Clip, color: u32) {
    let rect = image.rect.offset(x, y);
    match &image.pixels {
        GlyphPixels::Mask(mask) => {
            layer.fill(rect, Some(mask), clip, &Paint::Solid(premultiply(color)))
        }
        GlyphPixels::Color(source) => {
            let alpha = color as u8;
            let copy = |left: i32, top: i32, row: &mut [Pixel]| {
                row.copy_from_slice(source.row(top - y, left - x, left - x + row.len() as i32));
                if alpha != 255 {
                    row.iter_mut()
                        .for_each(|pixel| *pixel = scale(*pixel, alpha));
                }
            };
            layer.fill(rect, None, clip, &Paint::Shader(&copy));
        }
    }
}

pub fn blend_mode(mode: BlendMode) -> blend::Mode {
    use blend::Mode as To;
    match mode {
        BlendMode::Normal | BlendMode::FromBackdrop => To::SourceOver,
        BlendMode::Multiply => To::Multiply,
        BlendMode::Screen => To::Screen,
        BlendMode::Overlay => To::Overlay,
        BlendMode::Darken => To::Darken,
        BlendMode::Lighten => To::Lighten,
        BlendMode::ColorDodge => To::ColorDodge,
        BlendMode::ColorBurn => To::ColorBurn,
        BlendMode::HardLight => To::HardLight,
        BlendMode::SoftLight => To::SoftLight,
        BlendMode::Difference => To::Difference,
        BlendMode::Exclusion => To::Exclusion,
        BlendMode::Hue => To::Hue,
        BlendMode::Saturation => To::Saturation,
        BlendMode::Color => To::Color,
        BlendMode::Luminosity => To::Luminosity,
        BlendMode::PlusLighter => To::Plus,
        BlendMode::DestinationOut => To::DestinationOut,
        BlendMode::DestinationIn => To::DestinationIn,
        BlendMode::SourceIn => To::SourceIn,
        BlendMode::SourceOut => To::SourceOut,
        BlendMode::Xor => To::Xor,
    }
}

/// The gradient, and the transform from its space to the tile's.
pub fn css_gradient(
    shape: GradientShape,
    stops: &[GradientStop],
    repeating: bool,
) -> (Gradient, Transform) {
    let (geometry, matrix) = match shape {
        GradientShape::Linear { from, to } => {
            (Geometry::Linear { from, to }, Transform::identity())
        }
        GradientShape::Radial { center, radius } => {
            let [x, y] = radius.map(|radius| radius.max(1e-4));
            let geometry = Geometry::Radial {
                from: [0.; 3],
                to: [0., 0., 1.],
            };
            (
                geometry,
                Transform::from_row(x, 0., 0., y, center[0], center[1]),
            )
        }
        GradientShape::Conic { center, angle } => {
            let (start, span) = ((angle - 90.).to_radians(), std::f32::consts::TAU);
            (
                Geometry::Sweep {
                    center,
                    start,
                    span,
                },
                Transform::identity(),
            )
        }
    };
    let spread = if repeating {
        Spread::Repeat
    } else {
        Spread::Pad
    };
    (Gradient::new(geometry, stops, spread, true), matrix)
}

/// Draws all of `pixmap` into `rect`.
pub fn draw_pixmap(
    target: &mut Layer,
    pixmap: &Pixmap,
    rect: Rect,
    matrix: &Transform,
    smooth: bool,
) {
    let (width, height) = (pixmap.width() as f32, pixmap.height() as f32);
    let (mapped, is_near) = (map_rect(matrix, rect), |a: f32, b: f32| {
        (a - b).abs() < 0.01
    });
    if matrix.kx == 0.
        && matrix.ky == 0.
        && matrix.sx > 0.
        && matrix.sy > 0.
        && is_near(mapped.width, width)
        && is_near(mapped.height, height)
        && is_near(mapped.x, mapped.x.round())
        && is_near(mapped.y, mapped.y.round())
    {
        let all = IntRect::nearest(Rect {
            width,
            height,
            ..mapped
        });
        let shown = all.intersect(target.rect);
        for y in (shown.top..shown.bottom).filter(|_| !shown.is_empty()) {
            let start = (y - all.top) as usize * all.width() + (shown.left - all.left) as usize;
            blend_row(
                target.row_mut(y, shown.left, shown.right),
                &pixmap.data().as_chunks().0[start..start + shown.width()],
                255,
            );
        }
        return;
    }
    let placement = Transform::from_row(
        rect.width / width,
        0.,
        0.,
        rect.height / height,
        rect.x,
        rect.y,
    );
    warp::draw(target, pixmap, rect, placement, matrix, smooth);
}

/// The origins of the tiles along an axis that touch `start..start + length`.
pub fn tile_origins(
    origin: f32,
    size: f32,
    step: f32,
    start: f32,
    length: f32,
) -> impl Iterator<Item = f32> + Clone {
    let (first, last) = match step > 0. {
        true => (
            ((start - size - origin) / step).floor() + 1.,
            ((start + length - origin) / step).ceil() - 1.,
        ),
        false => (0., 0.),
    };
    (first as i64..=last as i64).map(move |index| origin + index as f32 * step)
}

#[derive(Clone, Copy)]
pub struct Painter<'a> {
    pub scene: &'a Scene,
    pub frame: &'a Frame,
    pub left_out: &'a [usize],
}

impl Painter<'_> {
    /// The pixels of a rectangle whose edges are on pixels.
    fn aligned(&self, shape: &RoundedRect, matrix: &Transform) -> Option<IntRect> {
        if has_radii(shape) || matrix.kx != 0. || matrix.ky != 0. {
            return None;
        }
        let mapped = map_rect(matrix, shape.rect);
        let edges = [
            mapped.x,
            mapped.y,
            mapped.x + mapped.width,
            mapped.y + mapped.height,
        ];
        (edges.iter().all(|edge| (edge - edge.round()).abs() < 0.01))
            .then(|| IntRect::nearest(mapped))
    }

    pub fn clip_to(&self, shape: &RoundedRect, matrix: &Transform, clip: &Clip) -> Clip {
        match self.aligned(shape, matrix) {
            Some(rect) => clip.within_rect(rect),
            None => {
                let area = IntRect::around(map_rect(matrix, shape.rect)).intersect(clip.rect);
                let inside = inner_band(shape, matrix);
                if inside.contains(area) {
                    return clip.within_rect(area);
                }
                let open = inside.intersect(clip.open);
                Clip {
                    open,
                    ..clip.within(Coverage::of_shape(shape, matrix, area))
                }
            }
        }
    }

    /// `Stretch::render`, possibly from when it was somewhere else.
    pub fn recall(&self, stretch: &Stretch, matrix: &Transform) -> Option<Rc<Layer>> {
        const MAX_PIXELS: i64 = 1 << 20;
        let key = digest::of_stretch(self, stretch, matrix);
        if let Some(known) = STRETCHES.with_borrow(|known| known.get(&key).cloned()) {
            return Some(known);
        }
        let layer = Rc::new(stretch.render(self, matrix)?);
        STRETCHES.with_borrow_mut(|known| {
            if known.values().map(|layer| layer.rect.area()).sum::<i64>() > MAX_PIXELS
                || known.len() > 64
            {
                known.clear();
            }
            known.insert(key, layer.clone());
        });
        Some(layer)
    }

    fn fill_shape(
        &self,
        layer: &mut Layer,
        shape: &RoundedRect,
        matrix: &Transform,
        clip: &Clip,
        paint: &Paint,
    ) {
        let clip = self.clip_to(shape, matrix, clip);
        layer.fill(clip.rect, None, &clip, paint);
    }

    pub fn paint(&self, range: Range<usize>, layer: &mut Layer, matrix: &Transform, clip: &Clip) {
        let (end, mut done) = (range.end, usize::MAX);
        for index in self.scene.children(range) {
            let area =
                IntRect::around(map_rect(matrix, self.scene.bounds(index))).intersect(clip.rect);
            if (!area.is_empty() || erases(&self.scene.items[index]))
                && !self.left_out.contains(&index)
                && index != done
            {
                if (index % 8 == 0 || area.area() > 1 << 12 || self.scene.end(index) > index + 1)
                    && self.frame.is_overdue()
                {
                    return;
                }
                match index + 1 < end && self.fill_with_border(index, layer, matrix, clip).is_some()
                {
                    true => done = index + 1,
                    false => self.paint_item(index, layer, matrix, clip, area),
                }
            }
        }
    }

    /// One on top of the other, which leaves no gap between them.
    fn fill_with_border(
        &self,
        index: usize,
        layer: &mut Layer,
        matrix: &Transform,
        clip: &Clip,
    ) -> Option<()> {
        let widths = self.scene.border_over(index)?;
        let [Item::Fill { shape, color }, Item::Border { colors, .. }] =
            *self.scene.items[index..].first_chunk()?
        else {
            return None;
        };
        let mut present = (0..4).filter(|it| widths[*it] > 0.).map(|it| colors[it]);
        let border = present.next()?;
        (color & 0xFF == 0xFF
            && present.all(|it| it == border)
            && (!widths.contains(&0.) || self.frame.is_translation(matrix)))
        .then_some(())?;
        let shape = self.frame.snap_shape(&shape);
        self.fill_shape(
            layer,
            &shape,
            matrix,
            clip,
            &Paint::Solid(premultiply(border)),
        );
        self.fill_shape(
            layer,
            &border::inset(&shape, widths.map(|it| self.frame.snap_width(it))),
            matrix,
            clip,
            &Paint::Solid(premultiply(color)),
        );
        Some(())
    }

    fn paint_item(
        &self,
        index: usize,
        layer: &mut Layer,
        matrix: &Transform,
        clip: &Clip,
        area: IntRect,
    ) {
        let (scene, frame) = (self.scene, self.frame);
        match &scene.items[index] {
            Item::PushClip(shape) => {
                let clip = self.clip_to(&frame.snap_shape(shape), matrix, &clip.within_rect(area));
                self.paint(scene.content(index), layer, matrix, &clip);
            }
            Item::PushClipPath { verbs, even_odd } => {
                let rule = if *even_odd {
                    Fill::EvenOdd
                } else {
                    Fill::NonZero
                };
                let clip = clip.within(Coverage::of_path(&scene.path(*verbs), rule, matrix, area));
                self.paint(scene.content(index), layer, matrix, &clip);
            }
            Item::PushClipOutline(outline) => {
                self.paint(
                    scene.content(index),
                    layer,
                    matrix,
                    &clip.within(self.cover(outline, matrix, area)),
                );
            }
            Item::PushTransform(by) if !frame.snaps => self.snapping(true, |painter| {
                painter.paint(
                    scene.content(index),
                    layer,
                    &painter.frame.concat(matrix, *by),
                    clip,
                );
            }),
            Item::PushTransform(by) => self.paint(
                scene.content(index),
                layer,
                &frame.concat(matrix, *by),
                clip,
            ),
            Item::PushVector(by) => self.snapping(false, |painter| {
                painter.paint(
                    scene.content(index),
                    layer,
                    &matrix.pre_concat(transform(*by)),
                    clip,
                );
            }),
            Item::PushPattern {
                bounds,
                tile,
                matrix: by,
            } => {
                let bounds = RoundedRect {
                    rect: frame.snap(*bounds),
                    ..RoundedRect::default()
                };
                let clip = self.clip_to(&bounds, matrix, &clip.within_rect(area));
                warp::repeat(
                    layer,
                    &clip,
                    tile,
                    &matrix.pre_concat(transform(*by)),
                    true,
                    |cell, matrix| {
                        self.snapping(false, |painter| {
                            painter.paint(scene.content(index), cell, matrix, &Clip::new(cell.rect))
                        });
                    },
                );
            }
            Item::PushProjection(by) => {
                let projection = Projection::from(matrix).after(&Projection(*by));
                warp::project(
                    layer,
                    &clip.within_rect(area),
                    &projection,
                    scene.content_bounds(index),
                    |flat, matrix| {
                        self.paint(scene.content(index), flat, matrix, &Clip::new(flat.rect));
                    },
                );
            }
            Item::PushLayer {
                blend: BlendMode::FromBackdrop,
                ..
            } => {
                let Some(mut group) = layer.copy(
                    area.outset(self.reach_of_backdrops(scene.content(index), matrix))
                        .intersect(layer.rect),
                ) else {
                    return;
                };
                self.paint(scene.content(index), &mut group, matrix, &Clip::new(area));
                if self.mask(&mut group, index, matrix, area).is_some() {
                    layer.draw(&group, None, clip);
                }
            }
            Item::PushLayer {
                opacity,
                blend: BlendMode::Normal,
                filters,
                ..
            } if let [Item::Path { outline, color }, Item::Pop] =
                &scene.items[index + 1..scene.end(index)]
                && scene.filters(*filters).is_empty() =>
            {
                let color = scale(
                    premultiply(*color),
                    (opacity.clamp(0., 1.) * 255.).round() as u8,
                );
                self.fill_outline(layer, outline, matrix, clip, area, color);
            }
            Item::PushLayer { opacity, blend, .. } => {
                let group = self.render_layer(index, matrix, area).map(|mut group| {
                    group.scale_alpha(*opacity);
                    group
                });
                match (blend, group) {
                    (BlendMode::Normal, Some(group)) => layer.draw(&group, None, clip),
                    (_, group) if erases(&scene.items[index]) => {
                        if let Some(group) = group.or_else(|| Layer::new(clip.rect)) {
                            layer.draw_with_mode(&group, blend_mode(*blend), clip);
                        }
                    }
                    (_, Some(group)) => {
                        layer.draw_with_mode(&group, blend_mode(*blend), &clip.within_rect(area))
                    }
                    (_, None) => {}
                }
            }
            Item::Shadow { .. } | Item::Border { .. } => {
                match Stretch::of(self, index, matrix, matrix) {
                    Some(stretch) => stretch.paint(self, layer, matrix, &clip.within_rect(area)),
                    None => self.paint_leaf(&scene.items[index], layer, matrix, clip, area),
                }
            }
            Item::Fill { shape, color } if let Some(widths) = scene.border_over(index) => {
                let hidden = widths.map(|it| frame.snap_width(it) / 2.);
                self.fill_shape(
                    layer,
                    &border::inset(&frame.snap_shape(shape), hidden),
                    matrix,
                    clip,
                    &Paint::Solid(premultiply(*color)),
                )
            }
            item => self.paint_leaf(item, layer, matrix, clip, area),
        }
    }

    fn snapping(&self, snaps: bool, paint: impl FnOnce(&Painter)) {
        let frame = Frame {
            snaps,
            ..self.frame.rescaled(1.)
        };
        paint(&Painter {
            frame: &frame,
            ..*self
        });
        frame
            .next_change
            .get()
            .into_iter()
            .for_each(|time| self.frame.changes_at(time));
    }

    fn with_stroke<R>(&self, stroke: &abi::Stroke, f: impl FnOnce(gfx::Stroke) -> R) -> R {
        let dashes = self.scene.floats(stroke.dashes);
        let cap = match stroke.cap {
            abi::CAP_ROUND => Cap::Round,
            abi::CAP_SQUARE => Cap::Square,
            _ => Cap::Butt,
        };
        let join = match stroke.join {
            abi::JOIN_ROUND => Join::Round,
            abi::JOIN_BEVEL => Join::Bevel,
            _ => Join::Miter,
        };
        let abi::Stroke {
            width,
            miter_limit,
            dash_offset,
            ..
        } = *stroke;
        f(gfx::Stroke {
            width,
            cap,
            join,
            miter_limit,
            dashes: &dashes,
            dash_offset,
        })
    }

    fn cover_stroke(
        &self,
        path: &Path,
        stroke: &abi::Stroke,
        matrix: &Transform,
        area: IntRect,
    ) -> Coverage {
        self.with_stroke(stroke, |it| Coverage::of_path(path, it, matrix, area))
    }

    fn fill_outline(
        &self,
        layer: &mut Layer,
        outline: &abi::Outline,
        matrix: &Transform,
        clip: &Clip,
        area: IntRect,
        color: Pixel,
    ) {
        let paint = Paint::Solid(color);
        if outline.how != 0 || outline.crisp {
            return layer.fill_coverage(&self.cover(outline, matrix, area), clip, &paint);
        }
        let (path, clip) = (self.scene.path(outline.verbs), clip.within_rect(area));
        match (outline.stroke.width > 0., outline.even_odd) {
            (true, _) => self.with_stroke(&outline.stroke, |it| {
                layer.fill_path(&path, it, matrix, &clip, &paint)
            }),
            (_, true) => layer.fill_path(&path, Fill::EvenOdd, matrix, &clip, &paint),
            (_, false) => layer.fill_path(&path, Fill::NonZero, matrix, &clip, &paint),
        }
    }

    fn cover(&self, outline: &abi::Outline, matrix: &Transform, area: IntRect) -> Coverage {
        let path = self.scene.path(outline.verbs);
        let stroke = (outline.stroke.width > 0.)
            .then(|| self.cover_stroke(&path, &outline.stroke, matrix, area));
        let fill = || match (outline.how & abi::OUTLINE_POSITIVE != 0, outline.even_odd) {
            (true, _) => Coverage::of_positive_path(&path, matrix, area),
            (_, true) => Coverage::of_path(&path, Fill::EvenOdd, matrix, area),
            (_, false) => Coverage::of_path(&path, Fill::NonZero, matrix, area),
        };
        let mut coverage = match stroke {
            Some(stroke)
                if outline.how & (abi::OUTLINE_WITH_STROKE | abi::OUTLINE_WITHOUT_STROKE) == 0 =>
            {
                stroke
            }
            Some(stroke) => {
                let mut coverage = fill();
                if outline.how & abi::OUTLINE_WITH_STROKE != 0 {
                    coverage.add(&stroke)
                } else {
                    coverage.remove(&stroke)
                }
                coverage
            }
            None => fill(),
        };
        if outline.how & abi::OUTLINE_INVERSE != 0 {
            coverage.invert();
        }
        if outline.crisp {
            coverage.harden();
        }
        coverage
    }

    /// `area` is what the item may touch of `clip`.
    pub fn paint_leaf(
        &self,
        item: &Item,
        layer: &mut Layer,
        matrix: &Transform,
        clip: &Clip,
        area: IntRect,
    ) {
        let (scene, frame) = (self.scene, self.frame);
        match item {
            Item::PushClip(_)
            | Item::PushClipPath { .. }
            | Item::PushTransform(_)
            | Item::PushLayer { .. } => {}
            Item::PushClipOutline(_)
            | Item::PushVector(_)
            | Item::PushPattern { .. }
            | Item::PushProjection(_) => {}
            Item::Mask { .. } | Item::Input | Item::Pop => {}
            Item::Path { outline, color } => {
                self.fill_outline(layer, outline, matrix, clip, area, premultiply(*color));
            }
            Item::Shade {
                from,
                to,
                matrix: by,
                stops,
                spread,
                ..
            } => {
                let geometry = match from[2] < 0. && to[2] < 0. {
                    true => Geometry::Linear {
                        from: [from[0], from[1]],
                        to: [to[0], to[1]],
                    },
                    false => Geometry::Radial {
                        from: *from,
                        to: *to,
                    },
                };
                let spread =
                    [Spread::Pad, Spread::Repeat, Spread::Reflect][usize::from(*spread).min(2)];
                let gradient = Gradient::new(geometry, scene.stops(*stops), spread, false);
                let Some(inverse) = matrix.pre_concat(transform(*by)).invert() else {
                    return;
                };
                layer.fill(
                    area,
                    None,
                    clip,
                    &Paint::Shader(&|x, y, row| gradient.shade(&inverse, x, y, row)),
                );
            }
            Item::TextStroke {
                origin,
                face,
                size,
                glyphs,
                color,
                stroke,
                ..
            } => {
                let Some(face) = text::face(*face) else {
                    return;
                };
                let paths = scene.glyphs(*glyphs).iter().flat_map(|glyph| {
                    let place = Transform::from_translate(origin[0] + glyph.x, origin[1] + glyph.y);
                    text::glyph_path(face, glyph.id, *size)
                        .into_iter()
                        .map(move |command| command.transform(&place))
                });
                let (path, clip): (Path, _) = (paths.collect(), clip.within_rect(area));
                let mut coverage = self.cover_stroke(&path, stroke, matrix, clip.rect);
                text::correct_stroke(
                    face,
                    size * average_scale(matrix),
                    *color,
                    &mut coverage.data,
                );
                layer.fill_coverage(&coverage, &clip, &Paint::Solid(premultiply(*color)));
            }
            Item::ImagePart {
                clip: bounds,
                tile,
                image,
                whole,
                part,
                pixelated,
            } => {
                let bounds = RoundedRect {
                    rect: frame.snap(*bounds),
                    ..RoundedRect::default()
                };
                let clip = self.clip_to(&bounds, matrix, &clip.within_rect(area));
                images::with(*image, frame, |content| match content {
                    Content::Pixels(pixmap) => warp::repeat_part(
                        layer, &clip, tile, matrix, pixmap, *whole, *part, !pixelated,
                    ),
                    Content::Svg(image) => {
                        warp::repeat(layer, &clip, tile, matrix, !pixelated, |cell, matrix| {
                            let (x, y) =
                                (tile.rect.width / part.width, tile.rect.height / part.height);
                            let matrix = matrix
                                .pre_translate(tile.rect.x, tile.rect.y)
                                .pre_scale(x, y)
                                .pre_translate(-part.x, -part.y);
                            image.draw(
                                cell,
                                Rect {
                                    x: 0.,
                                    y: 0.,
                                    width: whole[0],
                                    height: whole[1],
                                },
                                &matrix,
                                frame,
                            );
                        })
                    }
                });
            }
            Item::Backdrop {
                shape,
                filters,
                opacity,
            } => {
                let filters = scene.filters(*filters);
                let reach = filter_reach(filters, matrix);
                let behind = IntRect::nearest(map_rect(matrix, frame.snap_shape(shape).rect))
                    .intersect(area.outset(reach));
                if let Some(mut backdrop) = layer.copy(behind.intersect(layer.rect)) {
                    self.filter_backdrop(&mut backdrop, filters, matrix);
                    backdrop.scale_alpha(*opacity);
                    layer.draw(
                        &backdrop,
                        None,
                        &self.clip_to(&frame.snap_shape(shape), matrix, clip),
                    );
                }
            }
            Item::Fill { shape, color } => self.fill_shape(
                layer,
                &frame.snap_shape(shape),
                matrix,
                clip,
                &Paint::Solid(premultiply(*color)),
            ),
            Item::Border {
                shape,
                widths,
                colors,
                styles,
            } => {
                let border = Border {
                    shape: &frame.snap_shape(shape),
                    widths: widths.map(|width| frame.snap_width(width)),
                    colors: *colors,
                    styles: *styles,
                };
                border.paint(layer, matrix, frame.scale, clip, area);
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
                let (shape, rect) = snap_shadow(frame, shape, shadow);
                let shadow = RoundedRect {
                    rect,
                    radii: *radii,
                    ..shape
                };
                let sigma = (blur / 2. * average_scale(matrix)).min(blur::MAX_SIGMA_OF_SHADOWS);
                let casts = IntRect::around(map_rect(matrix, shadow.rect))
                    .outset(1)
                    .intersect(area.outset(blur::extent(sigma)));
                let mut coverage = match sigma > 0. {
                    true => Coverage::of_shape(&shadow, matrix, casts).blurred(sigma, area),
                    false => Coverage::of_shape(&shadow, matrix, area),
                };
                let paint = Paint::Solid(premultiply(*color));
                if *inset {
                    coverage.invert();
                    layer.fill_coverage(&coverage, &self.clip_to(&shape, matrix, clip), &paint);
                } else {
                    match covered {
                        true => coverage.clear(inner_band(&shape, matrix).outset(-2)),
                        false => coverage.subtract(&Coverage::of_shape(&shape, matrix, area)),
                    }
                    layer.fill_coverage(&coverage, &clip.within_rect(area), &paint);
                }
            }
            Item::Gradient {
                clip: shape,
                tile,
                shape: geometry,
                stops,
                repeating,
            } => {
                let (gradient, to_tile) = css_gradient(*geometry, scene.stops(*stops), *repeating);
                let (Some(to_local), Some(from_tile)) = (matrix.invert(), to_tile.invert()) else {
                    return;
                };
                let Tile { rect, step } = snap_tile(frame, tile);
                let shape = frame.snap_shape(shape);
                let painted = tile_bounds(&shape, &Tile { rect, step });
                let fills_shape = painted == shape.rect;
                let wrap = |at: f32, step: f32, length: f32| match step > 0. {
                    true => at.rem_euclid(step),
                    false if fills_shape => at.max(0.).min(length),
                    false => at,
                };
                let shade_all = |left: i32, top: i32, row: &mut [Pixel]| {
                    for (column, pixel) in (left..).zip(row) {
                        let (x, y) = map_point(&to_local, column as f32 + 0.5, top as f32 + 0.5);
                        let (x, y) = (
                            wrap(x - rect.x, step[0], rect.width),
                            wrap(y - rect.y, step[1], rect.height),
                        );
                        let is_inside =
                            (0. ..=rect.width).contains(&x) && (0. ..=rect.height).contains(&y);
                        let (x, y) = map_point(&from_tile, x, y);
                        *pixel = if is_inside {
                            gradient.pixel_at(x, y)
                        } else {
                            [0; 4]
                        };
                    }
                };
                let axis = gradient_axis(item).filter(|_| !matrix.has_skew());
                let mut clip = clip.within_rect(area);
                if axis.is_some() && !fills_shape {
                    clip = clip.within_rect(IntRect::nearest(map_rect(matrix, painted)));
                }
                let mut every_row = vec![
                    [0; 4];
                    if axis == Some(false) {
                        clip.rect.width()
                    } else {
                        0
                    }
                ];
                shade_all(
                    clip.rect.left,
                    (clip.rect.top + clip.rect.bottom) / 2,
                    &mut every_row,
                );
                let shade = |left: i32, top: i32, row: &mut [Pixel]| match axis {
                    Some(true) => {
                        shade_all(left + row.len() as i32 / 2, top, &mut row[..1]);
                        row.fill(row[0]);
                    }
                    Some(false) => row.copy_from_slice(
                        &every_row[(left - clip.rect.left) as usize..][..row.len()],
                    ),
                    None => shade_all(left, top, row),
                };
                self.fill_shape(layer, &shape, matrix, &clip, &Paint::Shader(&shade));
            }
            Item::Image {
                clip: shape,
                tile,
                image,
                pixelated,
            } => {
                let (shape, tile, clip) = (
                    frame.snap_shape(shape),
                    snap_tile(frame, tile),
                    clip.within_rect(area),
                );
                let cuts = tile.step != [0.; 2] || shape.rect != tile.rect || has_radii(&shape);
                let clip = if cuts {
                    self.clip_to(&shape, matrix, &clip)
                } else {
                    clip
                };
                let Some(mut drawn) = Layer::new(clip.rect) else {
                    return;
                };
                let (scale_x, scale_y) = matrix.get_scale();
                let draw = |content: Content| {
                    self.draw_tiles(&mut drawn, content, &tile, &shape, matrix, !pixelated)
                };
                match pixelated {
                    true => images::with(*image, frame, draw),
                    false => {
                        let reduced = |whole| {
                            images::reduced_size(
                                whole,
                                tile.rect.width * scale_x,
                                tile.rect.height * scale_y,
                            )
                        };
                        images::with_size(
                            *image,
                            frame,
                            |whole| images::size_to_draw(*image, frame, matrix, reduced(whole)),
                            draw,
                        )
                    }
                };
                layer.draw(&drawn, None, &clip);
            }
            Item::Svg { .. } => {}
            Item::Text {
                blur, bounds, size, ..
            } if *blur > 0. => {
                let sigma = (blur / 2. * average_scale(matrix)).min(blur::MAX_SIGMA_OF_SHADOWS);
                let casts = IntRect::around(map_rect(matrix, outset(*bounds, size * 0.5)))
                    .intersect(area.outset(blur::extent(sigma)));
                let Some(mut text) = Layer::new(casts) else {
                    return;
                };
                self.draw_text(item, &mut text, matrix, &Clip::new(casts));
                text.blurred([sigma; 2], area)
                    .iter()
                    .for_each(|shadow| layer.draw(shadow, None, clip));
            }
            Item::Text { .. } => self.draw_text(item, layer, matrix, clip),
            Item::Line { rect, color, style } => {
                let paint = Paint::Solid(premultiply(*color));
                let lines = decoration_rects(frame, *rect, *style);
                match style {
                    LineStyle::None => {}
                    LineStyle::Dotted | LineStyle::Dashed | LineStyle::Wavy => {
                        let coverage = border::decoration(*rect, *style, matrix, frame.scale, area);
                        layer.fill_coverage(&coverage, clip, &paint);
                    }
                    _ => {
                        for rect in lines {
                            let shape = RoundedRect {
                                rect,
                                ..RoundedRect::default()
                            };
                            self.fill_shape(layer, &shape, matrix, clip, &paint);
                        }
                    }
                }
            }
            Item::Caret { rect, color } => {
                if frame.shows_caret {
                    let shape = RoundedRect {
                        rect: frame.snap(*rect),
                        ..RoundedRect::default()
                    };
                    self.fill_shape(
                        layer,
                        &shape,
                        matrix,
                        clip,
                        &Paint::Solid(premultiply(*color)),
                    );
                }
            }
        }
    }

    /// Filtered and masked, without the opacity. It covers at least `area`.
    pub fn render_layer(&self, index: usize, matrix: &Transform, area: IntRect) -> Option<Layer> {
        let Item::PushLayer {
            bounds, filters, ..
        } = self.scene.items[index]
        else {
            return None;
        };
        let filters = self.scene.filters(filters);
        let render = |group: &mut Layer, matrix: &Transform, wanted: IntRect| {
            let content = layer_clip(bounds, matrix).intersect(group.rect);
            self.paint(
                self.scene.content(index),
                group,
                matrix,
                &Clip::new(content),
            );
            self.filter(group, filters, matrix, index, wanted);
        };
        let render_all = |group: &mut Layer, matrix: &Transform| render(group, matrix, group.rect);
        let mut group;
        if !has_graph(filters) {
            let reach = filter_reach(filters, matrix)
                + self.reach_of_backdrops(self.scene.content(index), matrix);
            let mut needed = area.outset(reach);
            if filters
                .iter()
                .any(|filter| matches!(filter, Filter::Blur(_) | Filter::DropShadow { .. }))
            {
                needed = needed.intersect(layer_clip(
                    intersect(bounds, self.scene.content_bounds(index)),
                    matrix,
                ));
            }
            group = Layer::new(needed).or_else(|| Layer::new(area))?;
            render(&mut group, matrix, area);
            if !group.rect.contains(area) {
                group = group.copy(area)?;
            }
        } else if matrix.has_skew() {
            group = Layer::new(area)?;
            warp::project(
                &mut group,
                &Clip::new(area),
                &Projection::from(matrix),
                self.scene.bounds(index),
                render_all,
            );
        } else {
            let content = intersect(bounds, self.scene.content_bounds(index));
            let regions =
                (1..=filters.len()).map(|count| filtered_bounds(content, &filters[..count]));
            let everything =
                IntRect::around(map_rect(matrix, regions.fold(Rect::default(), union)));
            group = Layer::new(everything.intersect(area.outset(GRAPH_REACH)).union(area))?;
            render_all(&mut group, matrix);
        }
        self.mask(&mut group, index, matrix, area)?;
        Some(group)
    }

    fn mask(
        &self,
        group: &mut Layer,
        index: usize,
        matrix: &Transform,
        area: IntRect,
    ) -> Option<()> {
        if let Some((range, luminance)) = self.scene.mask(index) {
            let mut mask = Layer::new(area)?;
            self.paint(range, &mut mask, matrix, &Clip::new(area));
            group.keep(&mask, luminance);
        }
        Some(())
    }

    pub fn reach_of_backdrops(&self, range: Range<usize>, matrix: &Transform) -> i32 {
        let items = self.scene.items[range]
            .iter()
            .filter(|_| self.scene.has_backdrops);
        let reach = |item: &Item| match item {
            Item::Backdrop { filters, .. } => filter_reach(self.scene.filters(*filters), matrix),
            _ => 0,
        };
        items.map(reach).max().unwrap_or(0)
    }

    /// It may grow.
    pub fn filter_backdrop(&self, backdrop: &mut Layer, filters: &[Filter], matrix: &Transform) {
        let side = backdrop.rect.width().max(backdrop.rect.height()) as i32;
        if filters
            .iter()
            .any(|filter| matches!(filter, Filter::DropShadow { .. } | Filter::Graph(_)))
            && let Some(extended) = mirror_edges(backdrop, filter_reach(filters, matrix).min(side))
        {
            *backdrop = extended;
        }
        for run in filters.split_inclusive(|filter| matches!(filter, Filter::Blur(_))) {
            match run {
                [before @ .., Filter::Blur(sigma)] => {
                    self.filter(backdrop, before, matrix, usize::MAX, backdrop.rect);
                    backdrop.blur_mirrored(sigma * average_scale(matrix));
                }
                _ => self.filter(backdrop, run, matrix, usize::MAX, backdrop.rect),
            }
        }
    }

    /// `index` is that of the layer.
    fn filter(
        &self,
        layer: &mut Layer,
        mut filters: &[Filter],
        matrix: &Transform,
        index: usize,
        wanted: IntRect,
    ) {
        if !has_graph(filters) {
            return filter::apply(layer, filters, matrix, wanted, self.frame);
        }
        while let Some((first, rest)) = filters.split_first() {
            filters = rest;
            let Filter::Graph(region) = first else {
                filter::apply(
                    layer,
                    std::slice::from_ref(first),
                    matrix,
                    layer.rect,
                    self.frame,
                );
                continue;
            };
            let count = rest
                .iter()
                .take_while(|filter| matches!(filter, Filter::Primitive { .. }))
                .count();
            graph::apply(
                layer,
                *region,
                &rest[..count],
                self,
                matrix,
                &|position, target| {
                    let range = Some(index)
                        .filter(|index| *index != usize::MAX)
                        .and_then(|index| self.scene.input(index, position));
                    range.into_iter().for_each(|range| {
                        self.paint(range, target, matrix, &Clip::new(target.rect))
                    });
                },
            );
            filters = &rest[count..];
        }
    }

    fn draw_tiles(
        &self,
        target: &mut Layer,
        content: Content,
        tile: &Tile,
        shape: &RoundedRect,
        matrix: &Transform,
        smooth: bool,
    ) {
        const MAX_TILES: usize = 1 << 16;
        let Tile { mut rect, mut step } = *tile;
        let draw = |target: &mut Layer, rect: Rect, matrix: &Transform| match content {
            Content::Pixels(pixmap) => draw_pixmap(target, pixmap, rect, matrix, smooth),
            Content::Svg(image) => image.draw(target, rect, matrix, self.frame),
        };
        if step == [0., 0.] {
            if let Content::Svg(_) = content {
                let bounds = RoundedRect {
                    rect,
                    ..RoundedRect::default()
                };
                let clip = self.clip_to(&bounds, matrix, &Clip::new(target.rect));
                let Some(mut inside) = Layer::new(clip.rect) else {
                    return;
                };
                draw(&mut inside, rect, matrix);
                return target.draw(&inside, None, &clip);
            }
            return draw(target, rect, matrix);
        }
        let (scale_x, scale_y) = matrix.get_scale();
        let (width, height) = (
            (rect.width * scale_x).round().max(1.),
            (rect.height * scale_y).round().max(1.),
        );
        let Some(mut cell) = Layer::new(IntRect::new(0, 0, width as i32, height as i32)) else {
            return;
        };
        draw(
            &mut cell,
            Rect {
                x: 0.,
                y: 0.,
                width,
                height,
            },
            &Transform::identity(),
        );
        if step == [rect.width, rect.height]
            && [rect.width * scale_x, rect.height * scale_y] == [width, height]
            && width * height < 256.
        {
            let [columns, rows] = [width, height].map(|it| (64. / it).ceil());
            let Some(mut many) = Layer::new(IntRect::new(
                0,
                0,
                (width * columns) as i32,
                (height * rows) as i32,
            )) else {
                return;
            };
            for (x, y) in (0..rows as u32).flat_map(|y| {
                (0..columns as u32).map(move |x| (x as f32 * width, y as f32 * height))
            }) {
                draw_pixmap(
                    &mut many,
                    &cell.pixmap,
                    Rect {
                        x,
                        y,
                        width,
                        height,
                    },
                    &Transform::identity(),
                    false,
                );
            }
            (cell, step) = (many, [step[0] * columns, step[1] * rows]);
            [rect.width, rect.height] = step;
        }
        let visible = matrix.invert().map_or(shape.rect, |inverse| {
            map_rect(&inverse, target.rect.to_rect())
        });
        let visible = super::scene::intersect(visible, tile_bounds(shape, tile));
        let columns = tile_origins(rect.x, rect.width, step[0], visible.x, visible.width);
        let rows = tile_origins(rect.y, rect.height, step[1], visible.y, visible.height);
        let cells = rows.flat_map(|y| columns.clone().map(move |x| (x, y)));
        for (x, y) in cells.take(MAX_TILES) {
            draw_pixmap(
                target,
                &cell.pixmap,
                self.frame.snap(Rect { x, y, ..rect }),
                matrix,
                smooth,
            );
        }
    }

    fn draw_text(&self, item: &Item, layer: &mut Layer, matrix: &Transform, clip: &Clip) {
        let Item::Text {
            origin,
            face,
            size,
            glyphs,
            color,
            ..
        } = *item
        else {
            return;
        };
        draw_glyphs(
            layer,
            self.frame,
            self.scene.glyphs(glyphs),
            origin,
            face,
            size,
            color,
            matrix,
            clip,
        );
    }
}

#[expect(clippy::too_many_arguments)]
pub fn draw_glyphs(
    layer: &mut Layer,
    frame: &Frame,
    glyphs: &[crate::abi::Glyph],
    origin: [f32; 2],
    face: u32,
    size: f32,
    color: u32,
    matrix: &Transform,
    clip: &Clip,
) {
    if let Some(placer) = GlyphPlacer::new(frame, matrix, origin, face, size, color) {
        let reach = (size * matrix.sx * 3.) as i32 + 2;
        for (key, x, y) in glyphs.iter().map(|glyph| placer.place(glyph)) {
            if IntRect::new(x, y, x + 1, y + 1)
                .outset(reach)
                .overlaps(clip.rect)
                && let Some(image) = cached_glyph(key)
            {
                draw_glyph(layer, &image, x, y, clip, color);
            }
        }
    } else if let Some(face) = text::face(face) {
        let is_turned =
            matrix.sx.abs() + matrix.sy.abs() < 1e-4 && (matrix.kx + matrix.ky).abs() < 1e-4;
        let hints = is_turned
            && (matrix.kx.abs() - 1.).abs() < 1e-4
            && size <= LARGEST_HINTED
            && !cfg!(target_os = "macos");
        for glyph in glyphs {
            let mut matrix = matrix.pre_translate(origin[0] + glyph.x, origin[1] + glyph.y);
            if is_turned {
                (matrix.tx, matrix.ty) = (
                    (matrix.tx + 0.5).floor(),
                    (matrix.ty * 4. + 0.5).floor() / 4.,
                );
            }
            if let Some(image) = text::rasterize(
                face,
                glyph.id,
                size,
                &matrix,
                hints,
                text::ink_for(face, color),
            ) {
                draw_glyph(layer, &image, 0, 0, clip, color);
            }
        }
    }
}

pub fn layer_clip(bounds: Rect, matrix: &Transform) -> IntRect {
    IntRect::around(map_rect(matrix, bounds)).outset(1)
}

const GRAPH_REACH: i32 = 1024;
const MAX_REACH: i32 = 4096;

pub fn filter_reach(filters: &[Filter], matrix: &Transform) -> i32 {
    let scale = average_scale(matrix);
    let reach = |filter: &Filter| match *filter {
        Filter::Blur(sigma) => blur::extent(sigma * scale),
        Filter::DropShadow {
            offset: [x, y],
            blur,
            ..
        } => blur::extent(blur * scale) + (x.abs().max(y.abs()) * scale).ceil().min(4096.) as i32,
        Filter::Graph(_) => GRAPH_REACH,
        _ => 0,
    };
    filters
        .iter()
        .map(reach)
        .fold(0, |all, it| (all + it).min(MAX_REACH))
}

/// `source` covers `rect`.
pub fn mirror_edges(source: &Layer, by: i32) -> Option<Layer> {
    let (rect, mut extended) = (source.rect, Layer::new(source.rect.outset(by))?);
    let columns: Vec<_> = (-by..rect.width() as i32 + by)
        .map(|x| mirror(x, rect.width()))
        .collect();
    for (y, row) in (-by..).zip(extended.pixels_mut().chunks_mut(columns.len())) {
        let from = source.row(
            rect.top + mirror(y, rect.height()) as i32,
            rect.left,
            rect.right,
        );
        row.iter_mut()
            .zip(&columns)
            .for_each(|(pixel, column)| *pixel = from[*column]);
    }
    Some(extended)
}

/// The shadow keeps its distance from the edges of the box.
pub fn snap_shadow(frame: &Frame, shape: &RoundedRect, shadow: &Rect) -> (RoundedRect, Rect) {
    let snapped = frame.snap_shape(shape);
    let rect = Rect {
        x: shadow.x + snapped.rect.x - shape.rect.x,
        y: shadow.y + snapped.rect.y - shape.rect.y,
        width: (shadow.width + snapped.rect.width - shape.rect.width).max(0.),
        height: (shadow.height + snapped.rect.height - shape.rect.height).max(0.),
    };
    (snapped, rect)
}

pub fn snap_tile(frame: &Frame, tile: &Tile) -> Tile {
    let (snapped, unless_adjoining) = (
        frame.snap(tile.rect),
        |size: f32, step: f32, snapped: f32| {
            if (size - step).abs() < 0.001 {
                step
            } else {
                snapped
            }
        },
    );
    let (width, height) = (
        unless_adjoining(tile.rect.width, tile.step[0], snapped.width),
        unless_adjoining(tile.rect.height, tile.step[1], snapped.height),
    );
    Tile {
        rect: Rect {
            width,
            height,
            ..snapped
        },
        step: tile.step,
    }
}

/// The second one is empty unless the line is double.
pub fn decoration_rects(frame: &Frame, rect: Rect, style: LineStyle) -> [Rect; 2] {
    let first = Rect {
        y: (rect.y * frame.scale + 0.5).floor() / frame.scale,
        height: frame.snap_width(rect.height),
        ..rect
    };
    let second = Rect {
        y: ((rect.y + rect.height) * frame.scale + 1.5).floor() / frame.scale,
        ..first
    };
    [
        first,
        if style == LineStyle::Double {
            second
        } else {
            Rect::default()
        },
    ]
}

/// Whether the colors change from top to bottom or from left to right, if it is only one of them.
pub fn gradient_axis(item: &Item) -> Option<bool> {
    let Item::Gradient {
        tile,
        shape: GradientShape::Linear { from, to },
        ..
    } = item
    else {
        return None;
    };
    let has_no_gaps = |step: f32, length: f32| step == 0. || (step - length).abs() < 0.01;
    if (from[0] - to[0]).abs() < 1e-3 && has_no_gaps(tile.step[0], tile.rect.width) {
        Some(true)
    } else if (from[1] - to[1]).abs() < 1e-3 && has_no_gaps(tile.step[1], tile.rect.height) {
        Some(false)
    } else {
        None
    }
}
