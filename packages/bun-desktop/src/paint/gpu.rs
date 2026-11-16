use std::borrow::Cow;
use std::ops::Range;
use std::time::{Duration, Instant};

use gpui::{
    AtlasKey, AtlasTextureKind, AtlasTile, BorderStyle, Bounds, ContentMask, Corners, DevicePixels,
    Edges, Hsla, MonochromeSprite, PlatformAtlas, PolychromeSprite, Quad, ScaledPixels,
    SpriteAnimationId, TransformationMatrix, point, size,
};
use resvg::tiny_skia::{Pixmap, Transform};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::cpu::{self, GlyphKey, GlyphPlacer, Painter, gradient_axis};
use super::digest::{self, Digest};
use super::filter;
use super::raster::{
    Clip, IntRect, Layer, Paint, average_scale, has_radii, map_rect, multiply, premultiply,
};
use super::scene::{Frame, Scene, tile_bounds};
use super::software::{self, Atlas, Compositor};
use super::stretch::{STRETCHED, Stretch};
use crate::abi::{BlendMode, Filter, Glyph, Item, LineStyle, Rect, RoundedRect};
use crate::images::{self, Content};
use crate::text::{self, GlyphPixels};
use crate::webview;

/// What is rasterized in one piece, visible or not, so that scrolling finds it in the atlas.
const WHOLE_AREA: i64 = 512 * 512;
/// Beyond this many new pixels in one draw, an approximation does where there is one.
const BUDGET: i64 = 3 << 20;
const MAX_SIDE: i32 = 2048;
const GLYPHS_PER_MASK: usize = 24;

#[derive(Clone, Copy)]
pub enum Kind {
    Quad {
        color: u32,
        border_color: u32,
        border: [f32; 4],
    },
    Mask(AtlasTile, u32),
    Image(AtlasTile),
}

/// In device pixels.
#[derive(Clone, Copy)]
pub struct Primitive {
    pub bounds: Rect,
    pub clip: IntRect,
    pub radii: [f32; 4],
    pub opacity: f32,
    /// Neighbors with the same number but 0 may be drawn in any order.
    pub(super) run: u32,
    pub kind: Kind,
}

impl Primitive {
    pub(super) fn new(bounds: Rect, clip: IntRect, kind: Kind) -> Primitive {
        Primitive {
            bounds,
            clip,
            radii: [0.; 4],
            opacity: 1.,
            run: 0,
            kind,
        }
    }

    fn visible(&self) -> IntRect {
        IntRect::around(self.bounds).intersect(self.clip)
    }
}

#[derive(Clone, Copy)]
struct Sprite {
    tile: AtlasTile,
    /// Relative to the origin that it was rasterized for.
    rect: IntRect,
}

struct Raster {
    sprite: Option<Sprite>,
    last_used: u64,
    was_reused: bool,
}

/// What a window has in its atlas.
#[derive(Default)]
pub struct Cache {
    pub is_software: bool,
    draw: u64,
    glyphs: FxHashMap<GlyphKey, (Option<Sprite>, u64)>,
    rasters: FxHashMap<u128, Raster>,
    /// Layers by their key and opacity: since when they have looked like that, and the last draw in which they did.
    waiting: FxHashMap<(u128, u32), (Instant, u64)>,
    /// Of masks, and when they were last needed.
    opaque_parts: FxHashMap<u128, (Option<IntRect>, u64)>,
    primitives: Vec<Primitive>,
}

fn is_color(sprite: &Sprite) -> bool {
    sprite.tile.texture_id.kind == AtlasTextureKind::Polychrome
}

fn raster_key(kind: AtlasTextureKind, key: u128) -> AtlasKey {
    AtlasKey::Custom(kind, key | 1 << 127)
}

fn upload(
    atlas: &dyn PlatformAtlas,
    key: AtlasKey,
    width: usize,
    height: usize,
    bytes: &[u8],
) -> Option<AtlasTile> {
    let extent = size(DevicePixels(width as i32), DevicePixels(height as i32));
    let tile = atlas.get_or_insert_with(key, &mut || Ok(Some((extent, Cow::Borrowed(bytes)))));
    tile.ok().flatten()
}

fn bgra(layer: &Layer, rect: IntRect) -> Vec<u8> {
    let mut pixels = Vec::with_capacity(rect.area() as usize);
    for y in rect.top..rect.bottom {
        pixels.extend(
            layer
                .row(y, rect.left, rect.right)
                .iter()
                .map(|&[r, g, b, a]| [b, g, r, a]),
        );
    }
    pixels.into_flattened()
}

fn painted_rect(layer: &Layer) -> IntRect {
    let (mut painted, rect) = (IntRect::default(), layer.rect);
    for y in rect.top..rect.bottom {
        let row = layer.row(y, rect.left, rect.right);
        if let Some(first) = row.iter().position(|pixel| pixel[3] != 0) {
            let last = row.iter().rposition(|pixel| pixel[3] != 0).unwrap_or(first);
            painted = painted.union(IntRect::new(
                rect.left + first as i32,
                y,
                rect.left + last as i32 + 1,
                y + 1,
            ));
        }
    }
    painted
}

/// `part` is relative to the tile's origin.
fn part_of(tile: AtlasTile, part: IntRect) -> AtlasTile {
    let origin = tile.bounds.origin;
    AtlasTile {
        bounds: Bounds {
            origin: point(
                DevicePixels(origin.x.0 + part.left),
                DevicePixels(origin.y.0 + part.top),
            ),
            size: size(
                DevicePixels(part.width() as i32),
                DevicePixels(part.height() as i32),
            ),
        },
        ..tile
    }
}

/// With a copy of the edge around it, for the GPU to interpolate with.
fn padded(pixmap: &Pixmap) -> Option<Layer> {
    let rect = IntRect::new(0, 0, pixmap.width() as i32, pixmap.height() as i32);
    cpu::extend_edges(rect, pixmap, 1)
}

impl Cache {
    /// What is cached goes unless it is drawn again.
    pub fn expect_other_contents(&mut self) {
        self.rasters
            .values_mut()
            .for_each(|raster| raster.was_reused = false);
    }

    pub fn begin(&mut self, atlas: &Atlas, gpu: &dyn PlatformAtlas) {
        self.draw += 1;
        let mut was_cleared = false;
        let sentinel = AtlasKey::Custom(AtlasTextureKind::Monochrome, u128::MAX);
        let inserted = gpu.get_or_insert_with(sentinel, &mut || {
            was_cleared = true;
            Ok(Some((
                size(DevicePixels(1), DevicePixels(1)),
                Cow::Borrowed(&[0]),
            )))
        });
        if was_cleared || inserted.is_err() {
            self.clear(atlas);
        }
    }

    pub fn finish(&mut self, atlas: &Atlas, gpu: &dyn PlatformAtlas, scene: &mut gpui::Scene) {
        let mut last_color = (0, Hsla::transparent_black());
        let mut hsla = |color: u32| {
            if color != last_color.0 {
                last_color = (color, gpui::rgba(color).into());
            }
            last_color.1
        };
        let window = self
            .primitives
            .iter()
            .fold(IntRect::default(), |all, it| all.union(it.visible()));
        let mut stack = Stack::new(window);
        let hidden = software::last_to_hide(&self.primitives, window.outset(-1));
        for mut primitive in self.primitives.drain(..).skip(hidden) {
            if let Kind::Mask(tile, _) | Kind::Image(tile) = &mut primitive.kind {
                let Some(uploaded) = atlas.uploaded(*tile, gpu) else {
                    continue;
                };
                *tile = uploaded;
            }
            if let Some(order) = stack.place(&primitive) {
                insert(primitive, order, &mut hsla, scene);
            }
        }
        self.evict(atlas);
        atlas.unload(gpu);
    }

    pub fn finish_in_software(&mut self, compositor: &mut Compositor) {
        std::mem::swap(&mut self.primitives, &mut compositor.primitives);
        self.primitives.clear();
        self.evict(&compositor.atlas);
    }

    pub fn describe(&self) -> String {
        let pixels = |sprite: &Option<Sprite>| {
            sprite.map_or(0, |it| it.rect.area() * if is_color(&it) { 4 } else { 1 })
        };
        let glyphs: i64 = self.glyphs.values().map(|(sprite, _)| pixels(sprite)).sum();
        let rasters: i64 = self
            .rasters
            .values()
            .map(|raster| pixels(&raster.sprite))
            .sum();
        let new = self
            .rasters
            .values()
            .filter(|raster| !raster.was_reused && raster.last_used == self.draw);
        let new: i64 = new.map(|raster| pixels(&raster.sprite)).sum();
        format!(
            "glyphs {} KB, rasters {} KB of which {} KB are new",
            glyphs >> 10,
            rasters >> 10,
            new >> 10
        )
    }

    /// For a window that is not on screen.
    pub fn clear(&mut self, atlas: &dyn PlatformAtlas) {
        for (key, sprite) in self
            .rasters
            .iter()
            .filter_map(|(key, raster)| Some((*key, raster.sprite?)))
        {
            atlas.remove(&raster_key(sprite.tile.texture_id.kind, key));
        }
        for (key, (sprite, _)) in &self.glyphs {
            if let Some(sprite) = sprite {
                atlas.remove(&AtlasKey::Custom(sprite.tile.texture_id.kind, key.bits()));
            }
        }
        *self = Cache {
            is_software: self.is_software,
            ..Cache::default()
        };
    }

    fn evict(&mut self, atlas: &Atlas) {
        // The GPU may still be reading what the last frames used.
        const IN_FLIGHT: u64 = 3;
        const KEPT: u64 = 600;
        const MAX_BYTES: i64 = 32 << 20;
        const MAX_GLYPHS: usize = 8192;
        let draw = self.draw;
        self.waiting.retain(|_, (_, last_seen)| *last_seen == draw);
        if !draw.is_multiple_of(4) {
            return;
        }
        self.opaque_parts
            .retain(|_, (_, last_used)| draw - *last_used <= IN_FLIGHT);
        let bytes = |raster: &Raster| {
            raster
                .sprite
                .map_or(0, |it| it.rect.area() * if is_color(&it) { 4 } else { 1 })
        };
        let mut kept_for = KEPT;
        if self.rasters.values().map(bytes).sum::<i64>() > MAX_BYTES {
            let mut ages: Vec<_> = self
                .rasters
                .values()
                .map(|it| (draw - it.last_used, bytes(it)))
                .collect();
            ages.sort_unstable();
            let mut total = 0;
            let too_old = ages.iter().find(|(_, bytes)| {
                total += bytes;
                total > MAX_BYTES
            });
            kept_for = too_old.map_or(KEPT, |(age, _)| age.saturating_sub(1).max(IN_FLIGHT));
        }
        self.rasters.retain(|key, raster| {
            let keeps = draw - raster.last_used
                <= if raster.was_reused {
                    kept_for
                } else {
                    IN_FLIGHT
                };
            if let Some(sprite) = raster.sprite.filter(|_| !keeps) {
                atlas.remove(&raster_key(sprite.tile.texture_id.kind, *key));
            }
            keeps
        });
        atlas.release_memory();
        if self.glyphs.len() > MAX_GLYPHS {
            self.glyphs.retain(|key, (sprite, last_used)| {
                let keeps = draw - *last_used <= IN_FLIGHT;
                if let Some(sprite) = sprite.filter(|_| !keeps) {
                    atlas.remove(&AtlasKey::Custom(sprite.tile.texture_id.kind, key.bits()));
                }
                keeps
            });
        }
    }

    fn glyph(&mut self, key: GlyphKey, atlas: &dyn PlatformAtlas) -> Option<Sprite> {
        let entry = self.glyphs.entry(key).or_insert_with(|| {
            let sprite = key.rasterize().and_then(|image| {
                let (kind, bytes) = match image.pixels {
                    GlyphPixels::Mask(mask) => (AtlasTextureKind::Monochrome, mask),
                    GlyphPixels::Color(layer) => {
                        (AtlasTextureKind::Polychrome, bgra(&layer, layer.rect))
                    }
                };
                let (key, rect) = (AtlasKey::Custom(kind, key.bits()), image.rect);
                let tile = upload(atlas, key, rect.width(), rect.height(), &bytes)?;
                Some(Sprite { tile, rect })
            });
            (sprite, 0)
        });
        entry.1 = self.draw;
        entry.0
    }
}

fn scaled_bounds(rect: Rect) -> Bounds<ScaledPixels> {
    Bounds {
        origin: point(ScaledPixels(rect.x), ScaledPixels(rect.y)),
        size: size(ScaledPixels(rect.width), ScaledPixels(rect.height)),
    }
}

/// GPUI sorts what it draws by an order, and within that by the kind and the texture.
struct Stack {
    area: IntRect,
    columns: usize,
    cells: Vec<Cell>,
}

#[derive(Clone, Copy, Default)]
struct Cell {
    order: u32,
    batch: u32,
    /// All that is in it, if it is opaque.
    color: u32,
}

impl Stack {
    const CELL: i32 = 96;

    fn new(area: IntRect) -> Stack {
        let [columns, rows] =
            [area.width(), area.height()].map(|it| it.div_ceil(Self::CELL as usize));
        Stack {
            area,
            columns,
            cells: vec![Cell::default(); columns * rows],
        }
    }

    /// The order, unless it makes no difference.
    fn place(&mut self, primitive: &Primitive) -> Option<u32> {
        let (left, top) = (self.area.left, self.area.top);
        let touched = IntRect::around(primitive.bounds)
            .intersect(primitive.clip)
            .intersect(self.area);
        let range = |start: i32, end: i32| {
            (start / Self::CELL) as usize..((end + Self::CELL - 1) / Self::CELL) as usize
        };
        let columns = range(touched.left - left, touched.right - left);
        let rows = range(touched.top - top, touched.bottom - top);
        let (batch, color) = match primitive.kind {
            Kind::Quad { color, .. } if software::has_one_color(primitive) => (0, color),
            Kind::Quad { .. } => (0, 0),
            Kind::Mask(tile, _) => (1 << 16 | tile.texture_id.index, 0),
            Kind::Image(tile) => (2 << 16 | tile.texture_id.index, 0),
        };
        let (mut order, mut shows) = (0, color == 0);
        for cell in rows
            .clone()
            .flat_map(|row| &self.cells[row * self.columns..][columns.clone()])
        {
            order = order.max(cell.order + u32::from(batch < cell.batch));
            shows |= cell.color != color;
        }
        if !shows {
            return None;
        }
        let filled = if color == 0 {
            IntRect::default()
        } else {
            software::uniform_part(primitive)
        };
        for row in rows {
            for column in columns.clone() {
                let (x, y) = (
                    left + column as i32 * Self::CELL,
                    top + row as i32 * Self::CELL,
                );
                let rect = IntRect::new(x, y, x + Self::CELL, y + Self::CELL).intersect(self.area);
                let cell = &mut self.cells[row * self.columns + column];
                let is_flat = color != 0 && (cell.color == color || filled.contains(rect));
                *cell = Cell {
                    order,
                    batch,
                    color: if is_flat { color } else { 0 },
                };
            }
        }
        Some(order)
    }
}

fn insert(
    primitive: Primitive,
    order: u32,
    hsla: &mut impl FnMut(u32) -> Hsla,
    scene: &mut gpui::Scene,
) {
    let bounds = scaled_bounds(primitive.bounds);
    let content_mask = ContentMask {
        bounds: scaled_bounds(primitive.clip.to_rect()),
    };
    let [top_left, top_right, bottom_right, bottom_left] = primitive.radii.map(ScaledPixels);
    let corner_radii = Corners {
        top_left,
        top_right,
        bottom_right,
        bottom_left,
    };
    match primitive.kind {
        Kind::Quad {
            color,
            border_color,
            border,
        } => {
            let [top, right, bottom, left] = border.map(ScaledPixels);
            scene.quads.push(Quad {
                order,
                border_style: BorderStyle::Solid,
                bounds,
                content_mask,
                background: hsla(color).opacity(primitive.opacity).into(),
                border_color: hsla(border_color).opacity(primitive.opacity),
                corner_radii,
                border_widths: Edges {
                    top,
                    right,
                    bottom,
                    left,
                },
            })
        }
        Kind::Mask(tile, color) => scene.monochrome_sprites.push(MonochromeSprite {
            order,
            animation: SpriteAnimationId::NONE,
            tile,
            bounds,
            content_mask,
            color: hsla(color).opacity(primitive.opacity),
            transformation: TransformationMatrix::unit(),
        }),
        Kind::Image(tile) => scene.polychrome_sprites.push(PolychromeSprite {
            order,
            pad: 0,
            tile,
            grayscale: false.into(),
            opacity: primitive.opacity,
            bounds,
            content_mask,
            corner_radii,
        }),
    }
}

fn solid(color: u32) -> Kind {
    Kind::Quad {
        color,
        border_color: 0,
        border: [0.; 4],
    }
}

fn map_shape(matrix: &Transform, shape: &RoundedRect) -> RoundedRect {
    RoundedRect {
        rect: map_rect(matrix, shape.rect),
        radii: shape.radii.map(|[x, y]| match x > 0. && y > 0. {
            true => [x * matrix.sx, y * matrix.sy],
            false => [0., 0.],
        }),
    }
}

/// `None` for radii that GPUI cannot draw.
fn circular_radii(shape: &RoundedRect) -> Option<[f32; 4]> {
    let largest = shape.rect.width.min(shape.rect.height) / 2. + 0.01;
    let is_simple = |[x, y]: &[f32; 2]| (x - y).abs() < 0.05 && *x <= largest;
    shape
        .radii
        .iter()
        .all(is_simple)
        .then(|| shape.radii.map(|[x, _]| x))
}

/// The pixels that the curves go through.
fn corner_rects(shape: &RoundedRect) -> [IntRect; 4] {
    let Rect {
        x,
        y,
        width,
        height,
    } = shape.rect;
    let [tl, tr, br, bl] = shape.radii;
    let corner = |x: f32, y: f32, [width, height]: [f32; 2]| {
        IntRect::around(Rect {
            x,
            y,
            width,
            height,
        })
    };
    [
        corner(x, y, tl),
        corner(x + width - tr[0], y, tr),
        corner(x + width - br[0], y + height - br[1], br),
        corner(x, y + height - bl[1], bl),
    ]
}

fn is_axis_aligned(matrix: &Transform) -> bool {
    matrix.kx.abs() < 1e-5 && matrix.ky.abs() < 1e-5 && matrix.sx > 0. && matrix.sy > 0.
}

fn is_identity(filter: &Filter) -> bool {
    match *filter {
        Filter::Blur(amount) | Filter::Grayscale(amount) | Filter::HueRotate(amount) => {
            amount == 0.
        }
        Filter::Invert(amount) | Filter::Sepia(amount) => amount == 0.,
        Filter::Brightness(amount) | Filter::Contrast(amount) | Filter::Saturate(amount) => {
            amount == 1.
        }
        Filter::Opacity(amount) => amount >= 1.,
        Filter::DropShadow { color, .. } => color & 0xFF == 0,
        Filter::Luminance { .. } | Filter::Graph(_) | Filter::Primitive { .. } => false,
    }
}

/// Where a scene goes in the window.
pub struct Placement {
    pub origin: (i32, i32),
    pub clip: IntRect,
    /// What is behind the scene.
    pub background: u32,
}

struct Flattener<'a> {
    painter: Painter<'a>,
    placement: &'a Placement,
    root: Transform,
    atlas: &'a Atlas,
    cache: &'a mut Cache,
    budget: i64,
    /// The first of the primitives of the layer that is being flattened, if it is not the root.
    layer_start: Option<usize>,
}

pub fn fill(cache: &mut Cache, rect: IntRect, color: u32) {
    if color & 0xFF != 0 {
        cache
            .primitives
            .push(Primitive::new(rect.to_rect(), rect, solid(color)));
    }
}

pub fn paint(
    scene: &Scene,
    frame: &Frame,
    placement: &Placement,
    atlas: &Atlas,
    cache: &mut Cache,
) {
    let (x, y) = placement.origin;
    let root = Transform::from_row(frame.scale, 0., 0., frame.scale, x as f32, y as f32);
    let mut flattener = Flattener {
        painter: Painter {
            scene,
            frame,
            limit: usize::MAX,
        },
        placement,
        root,
        atlas,
        cache,
        budget: BUDGET,
        layer_start: None,
    };
    flattener.range(0..scene.items.len(), &root, placement.clip);
    for (image, [width, height]) in scene.new_images.lock().drain(..) {
        images::expect(image, width * frame.scale, height * frame.scale);
    }
}

impl Flattener<'_> {
    fn push(&mut self, primitive: Primitive) {
        if !primitive.visible().is_empty() {
            self.cache.primitives.push(primitive);
        }
    }

    fn next_run(&self) -> u32 {
        self.cache.primitives.len() as u32 + 1
    }

    fn can_afford(&self, key: u128, area: IntRect) -> bool {
        area.area() <= self.budget || self.cache.rasters.contains_key(&key)
    }

    /// The sprite's rectangle is relative to `origin`.
    fn raster(
        &mut self,
        key: u128,
        origin: IntRect,
        trims: bool,
        render: impl FnOnce(&Painter) -> Option<Layer>,
    ) -> Option<Sprite> {
        let draw = self.cache.draw;
        if let Some(raster) = self.cache.rasters.get_mut(&key) {
            raster.was_reused |= raster.last_used != draw;
            raster.last_used = draw;
            return raster.sprite;
        }
        let sprite = render(&self.painter).and_then(|layer| {
            self.budget -= layer.rect.area();
            let rect = if trims {
                painted_rect(&layer).intersect(origin)
            } else {
                layer.rect
            };
            (!rect.is_empty()).then_some(())?;
            let bytes = bgra(&layer, rect);
            let key = raster_key(AtlasTextureKind::Polychrome, key);
            let tile = upload(self.atlas, key, rect.width(), rect.height(), &bytes)?;
            Some(Sprite {
                tile,
                rect: rect.offset(-origin.left, -origin.top),
            })
        });
        self.cache.rasters.insert(
            key,
            Raster {
                sprite,
                last_used: draw,
                was_reused: false,
            },
        );
        sprite
    }

    fn push_raster(
        &mut self,
        key: u128,
        area: IntRect,
        clip: IntRect,
        render: impl FnOnce(&Painter) -> Option<Layer>,
    ) {
        if let Some(sprite) = self.raster(key, area, true, render) {
            let bounds = sprite.rect.offset(area.left, area.top).to_rect();
            self.push(Primitive::new(bounds, clip, Kind::Image(sprite.tile)));
        }
    }

    /// Everything that follows is faster with few primitives.
    fn glyph_mask(
        &mut self,
        placer: &GlyphPlacer,
        glyphs: &[Glyph],
        (color, run): (u32, u32),
        clip: IntRect,
        reach: i32,
    ) {
        let (Some(first), Some(last)) = (glyphs.first(), glyphs.last()) else {
            return;
        };
        let ((key, left, top), (_, right, _)) = (placer.place(first), placer.place(last));
        if left.max(right) < clip.left - reach || left.min(right) > clip.right + reach {
            return;
        }
        let placed = || {
            glyphs
                .iter()
                .map(|glyph| placer.place(glyph))
                .map(|(key, x, y)| (key, x - left, y - top))
        };
        let mut digest = Digest::new(IntRect::default());
        digest.value(key.bits());
        digest.value(placer.phase());
        for glyph in glyphs {
            digest.value(
                u64::from(glyph.id) << 32
                    ^ u64::from(glyph.x.to_bits())
                    ^ u64::from(glyph.y.to_bits()) << 29,
            );
        }
        let (key, draw, atlas) = (digest.finish(), self.cache.draw, self.atlas);
        let raster = self.cache.rasters.entry(key).or_insert_with(|| {
            let images = placed().filter_map(|(key, x, y)| Some((cpu::cached_glyph(key)?, x, y)));
            let images: SmallVec<[_; GLYPHS_PER_MASK]> = images.collect();
            let rect = images
                .iter()
                .fold(IntRect::default(), |all, (image, x, y)| {
                    all.union(image.rect.offset(*x, *y))
                });
            let mut mask = vec![0u8; rect.area() as usize];
            for (image, x, y) in &images {
                let GlyphPixels::Mask(coverage) = &image.pixels else {
                    continue;
                };
                let start = (image.rect.top + y - rect.top) as usize * rect.width()
                    + (image.rect.left + x - rect.left) as usize;
                for (to, from) in mask[start..]
                    .chunks_mut(rect.width())
                    .zip(coverage.chunks(image.rect.width()))
                {
                    to.iter_mut()
                        .zip(from)
                        .for_each(|(to, from)| *to += multiply(255 - *to, *from));
                }
            }
            let key = raster_key(AtlasTextureKind::Monochrome, key);
            let tile = (!rect.is_empty())
                .then(|| upload(atlas, key, rect.width(), rect.height(), &mask))
                .flatten();
            Raster {
                sprite: tile.map(|tile| Sprite { tile, rect }),
                last_used: draw,
                was_reused: false,
            }
        });
        raster.was_reused |= raster.last_used != draw;
        raster.last_used = draw;
        if let Some(sprite) = raster.sprite {
            let bounds = sprite.rect.offset(left, top).to_rect();
            self.push(Primitive {
                run,
                ..Primitive::new(bounds, clip, Kind::Mask(sprite.tile, color))
            });
        }
    }

    fn device_bounds(&self, index: usize, matrix: &Transform) -> IntRect {
        IntRect::around(map_rect(matrix, self.painter.scene.bounds(index)))
    }

    /// Paints `area` of an item or a group with the CPU.
    fn rasterize(&mut self, index: usize, matrix: &Transform, area: IntRect, clip: IntRect) {
        let range = index..self.painter.scene.end(index);
        for top in (area.top..area.bottom).step_by(MAX_SIDE as usize) {
            for left in (area.left..area.right).step_by(MAX_SIDE as usize) {
                let piece =
                    IntRect::new(left, top, left + MAX_SIDE, top + MAX_SIDE).intersect(area);
                let mut digest = Digest::new(piece);
                digest.matrix(matrix);
                digest.range(&self.painter, range.clone(), matrix, piece);
                self.push_raster(digest.finish(), piece, clip, |painter| {
                    let mut layer = Layer::new(piece)?;
                    painter.paint(range.clone(), &mut layer, matrix, &Clip::new(piece));
                    Some(layer)
                });
            }
        }
    }

    fn area_to_rasterize(&self, index: usize, matrix: &Transform, clip: IntRect) -> IntRect {
        let bounds = self.device_bounds(index, matrix);
        let is_small =
            bounds.area() <= WHOLE_AREA && bounds.width().max(bounds.height()) <= MAX_SIDE as usize;
        if is_small {
            bounds
        } else {
            bounds.intersect(clip)
        }
    }

    fn rasterize_all(&mut self, index: usize, matrix: &Transform, clip: IntRect) {
        self.rasterize(
            index,
            matrix,
            self.area_to_rasterize(index, matrix, clip),
            clip,
        );
    }

    /// Replaces what the primitives from `first` on draw in `holes` with what the CPU paints there.
    fn patch(
        &mut self,
        first: usize,
        holes: &[IntRect],
        index: usize,
        matrix: &Transform,
        clip: IntRect,
    ) {
        if holes.is_empty() {
            return;
        }
        for primitive in self.cache.primitives.split_off(first) {
            let visible = primitive.visible();
            let mut pieces: SmallVec<[IntRect; 4]> = SmallVec::from_elem(visible, 1);
            for hole in holes.iter().filter(|hole| hole.overlaps(visible)) {
                pieces = pieces
                    .into_iter()
                    .flat_map(|piece| piece.without(*hole))
                    .collect();
            }
            (self.cache.primitives).extend(
                pieces
                    .into_iter()
                    .map(|clip| Primitive { clip, ..primitive }),
            );
        }
        for hole in holes {
            self.rasterize(index, matrix, *hole, clip);
        }
    }

    /// Clips the primitives from `first` on, which are clipped to the rectangle of `shape`, to its curves.
    fn round(
        &mut self,
        first: usize,
        shape: &RoundedRect,
        index: usize,
        matrix: &Transform,
        clip: IntRect,
    ) {
        if !has_radii(shape) {
            return;
        }
        let (corners, radii, rect) = (corner_rects(shape), circular_radii(shape), shape.rect);
        let mut is_touched = [false; 4];
        for primitive in &mut self.cache.primitives[first..] {
            let visible = primitive.visible();
            let touches = corners.map(|corner| corner.overlaps(visible));
            if touches == [false; 4] {
                continue;
            }
            let (bounds, near) = (primitive.bounds, |a: f32, b: f32| (a - b).abs() < 0.02);
            let is_same = near(bounds.x, rect.x)
                && near(bounds.y, rect.y)
                && near(bounds.width, rect.width)
                && near(bounds.height, rect.height);
            let covers = IntRect::nearest(bounds).contains(IntRect::nearest(rect));
            match (primitive.kind, radii) {
                (Kind::Quad { .. } | Kind::Image(_), Some(radii))
                    if is_same
                        && (0..4).all(|corner| primitive.radii[corner] + 0.02 >= radii[corner]) => {
                }
                (
                    Kind::Quad {
                        border: [0., 0., 0., 0.],
                        ..
                    },
                    Some(radii),
                ) if covers && primitive.radii == [0.; 4] => {
                    (primitive.bounds, primitive.radii) = (rect, radii);
                }
                (Kind::Image(_), Some(radii)) if is_same && primitive.radii == [0.; 4] => {
                    primitive.radii = radii
                }
                _ => (0..4).for_each(|corner| is_touched[corner] |= touches[corner]),
            }
        }
        let mut holes: SmallVec<[IntRect; 4]> = SmallVec::new();
        for corner in (0..4).filter(|corner| is_touched[*corner]) {
            // Neighbors can share a row or a column of pixels.
            let mut pieces: SmallVec<[IntRect; 4]> =
                SmallVec::from_elem(corners[corner].intersect(clip), 1);
            for known in &holes {
                pieces = pieces
                    .into_iter()
                    .flat_map(|piece| piece.without(*known))
                    .collect();
            }
            holes.extend(pieces);
        }
        self.patch(first, &holes, index, matrix, clip);
    }

    fn range(&mut self, range: Range<usize>, matrix: &Transform, clip: IntRect) {
        for index in self.painter.scene.children(range) {
            if self.device_bounds(index, matrix).overlaps(clip) {
                self.item(index, matrix, clip);
            }
        }
    }

    /// `matrix` is axis aligned.
    fn item(&mut self, index: usize, matrix: &Transform, clip: IntRect) {
        let Painter { scene, frame, .. } = self.painter;
        let first = self.cache.primitives.len();
        match scene.items[index] {
            Item::PushClip(shape) => {
                let shape = map_shape(matrix, &frame.snap_shape(&shape));
                let inside = clip.intersect(IntRect::nearest(shape.rect));
                self.range(scene.content(index), matrix, inside);
                self.round(first, &shape, index, matrix, clip);
            }
            Item::PushTransform(by) => match frame.concat(matrix, by) {
                inner if is_axis_aligned(&inner) => self.range(scene.content(index), &inner, clip),
                _ => self.rasterize_all(index, matrix, clip),
            },
            Item::PushLayer { .. } => self.layer(index, matrix, clip),
            Item::Mask { .. } | Item::Input | Item::Pop => {}
            Item::Backdrop {
                shape,
                filters,
                opacity,
            } => {
                let shape = map_shape(matrix, &frame.snap_shape(&shape));
                self.backdrop(index, &shape, scene.filters(filters), matrix, clip);
                self.fade(first, opacity);
            }
            Item::Fill { shape, color } => {
                let shape = map_shape(matrix, &frame.snap_shape(&shape));
                match circular_radii(&shape) {
                    _ if color & 0xFF == 0 => {}
                    Some(radii) => self.push(Primitive {
                        radii,
                        ..Primitive::new(shape.rect, clip, solid(color))
                    }),
                    None => self.stretch_box(index, matrix, clip),
                }
            }
            Item::Border { .. } => self.border(index, matrix, clip),
            Item::Shadow { color, .. } if color & 0xFF == 0 => {}
            Item::Shadow { .. } => self.stretch_box(index, matrix, clip),
            Item::Gradient { clip: shape, .. } | Item::Image { clip: shape, .. } => {
                let shape = map_shape(matrix, &frame.snap_shape(&shape));
                let inside = clip.intersect(IntRect::nearest(shape.rect));
                match self.stretch_gradient(index, matrix, inside)
                    || self.image(index, matrix, inside)
                {
                    true => self.round(first, &shape, index, matrix, clip),
                    false => self.rasterize_all(index, matrix, clip),
                }
            }
            Item::Svg {
                clip: bounds,
                rect,
                source,
                hash,
            } => {
                let Some(tree) = images::inline_svg(hash, scene.bytes(source)) else {
                    return;
                };
                let svg_matrix = cpu::svg_matrix(&tree, cpu::snap_origin(frame, rect), matrix);
                let painted =
                    IntRect::around(map_rect(&svg_matrix, images::svg_bounds(&tree))).outset(1);
                let clip = clip.intersect(IntRect::nearest(map_rect(matrix, frame.snap(bounds))));
                let area = if painted.area() <= WHOLE_AREA {
                    painted
                } else {
                    painted.intersect(clip)
                };
                let mut digest = Digest::new(area);
                digest.matrix(&svg_matrix);
                digest.point(&svg_matrix, 0., 0.);
                digest.value(hash);
                self.push_raster(digest.finish(), area, clip, |_| {
                    let mut layer = Layer::new(area)?;
                    super::svg::draw(&mut layer, &tree, &svg_matrix);
                    Some(layer)
                });
            }
            Item::Text {
                origin,
                face,
                size,
                glyphs,
                color,
                blur: 0.,
                ..
            } => {
                let Some(placer) = GlyphPlacer::new(frame, matrix, origin, face, size, color)
                else {
                    return self.rasterize_all(index, matrix, clip);
                };
                let (run, reach) = (self.next_run(), (size * matrix.sx * 3.) as i32 + 2);
                if text::face(face).is_some_and(|face| !face.file.has_color) {
                    let pieces = scene.glyphs(glyphs).chunks(GLYPHS_PER_MASK);
                    return pieces.for_each(|piece| {
                        self.glyph_mask(&placer, piece, (color, run), clip, reach)
                    });
                }
                for (key, x, y) in scene.glyphs(glyphs).iter().map(|glyph| placer.place(glyph)) {
                    if !(clip.left - reach..clip.right + reach).contains(&x) {
                        continue;
                    }
                    let Some(sprite) = self.cache.glyph(key, self.atlas) else {
                        continue;
                    };
                    let (kind, opacity) = match is_color(&sprite) {
                        true => (Kind::Image(sprite.tile), f32::from(color as u8) / 255.),
                        false => (Kind::Mask(sprite.tile, color), 1.),
                    };
                    let bounds = sprite.rect.offset(x, y).to_rect();
                    self.push(Primitive {
                        run,
                        opacity,
                        ..Primitive::new(bounds, clip, kind)
                    });
                }
            }
            Item::Line {
                style: LineStyle::None,
                ..
            } => {}
            Item::Line {
                style: LineStyle::Dotted | LineStyle::Dashed | LineStyle::Wavy,
                ..
            } => self.rasterize_all(index, matrix, clip),
            Item::Line { rect, color, style } => {
                for line in cpu::decoration_rects(frame, rect, style) {
                    self.push(Primitive::new(map_rect(matrix, line), clip, solid(color)));
                }
            }
            Item::Caret { rect, color } => {
                if frame.shows_caret {
                    self.push(Primitive::new(
                        map_rect(matrix, frame.snap(rect)),
                        clip,
                        solid(color),
                    ));
                }
            }
            Item::PushClipPath { .. }
            | Item::PushClipOutline(_)
            | Item::PushVector(_)
            | Item::PushPattern { .. }
            | Item::PushProjection(_)
            | Item::Path { .. }
            | Item::Shade { .. }
            | Item::Text { .. }
            | Item::TextStroke { .. }
            | Item::ImagePart { .. } => self.rasterize_all(index, matrix, clip),
        }
    }

    fn border(&mut self, index: usize, matrix: &Transform, clip: IntRect) {
        let Painter { scene, frame, .. } = self.painter;
        let Item::Border {
            shape,
            widths,
            colors,
            styles,
        } = scene.items[index]
        else {
            return;
        };
        let shape = map_shape(matrix, &frame.snap_shape(&shape));
        let border: [f32; 4] = std::array::from_fn(|side| match styles[side] {
            LineStyle::None => 0.,
            _ => frame.snap_width(widths[side]) * if side % 2 == 0 { matrix.sy } else { matrix.sx },
        });
        let mut present = (0..4).filter(|side| border[*side] > 0.);
        let Some(color) = present.clone().next().map(|side| colors[side]) else {
            return;
        };
        let [top, right, bottom, left] = border;
        let rect = shape.rect;
        if present
            .clone()
            .all(|side| styles[side] == LineStyle::Solid && colors[side] == color)
        {
            if !has_radii(&shape) {
                let (y, height) = (rect.y + top, rect.height - top - bottom);
                for side in [
                    Rect {
                        height: top,
                        ..rect
                    },
                    Rect {
                        y: y + height,
                        height: bottom,
                        ..rect
                    },
                    Rect {
                        x: rect.x,
                        y,
                        width: left,
                        height,
                    },
                    Rect {
                        x: rect.x + rect.width - right,
                        y,
                        width: right,
                        height,
                    },
                ] {
                    self.push(Primitive::new(side, clip, solid(color)));
                }
                return;
            }
            if let Some(radii) = circular_radii(&shape).filter(|_| border == [top; 4]) {
                let kind = Kind::Quad {
                    color: 0,
                    border_color: color,
                    border,
                };
                return self.push(Primitive {
                    radii,
                    ..Primitive::new(rect, clip, kind)
                });
            }
        }
        if !present.any(|side| matches!(styles[side], LineStyle::Dotted | LineStyle::Dashed)) {
            return self.stretch_box(index, matrix, clip);
        }
        let bounds = self.device_bounds(index, matrix);
        let reach = shape
            .radii
            .as_flattened()
            .iter()
            .chain(&border)
            .fold(0f32, |a, b| a.max(*b))
            .ceil() as i32
            + 3;
        for piece in bounds
            .without(bounds.outset(-reach))
            .filter(|piece| piece.overlaps(clip))
        {
            self.rasterize(index, matrix, piece, clip);
        }
    }

    fn stretch_box(&mut self, index: usize, matrix: &Transform, clip: IntRect) {
        let frame = self.painter.frame;
        // The GPU scales a blurred shadow as well as the CPU would.
        let scales_from = if self.cache.is_software { 64. } else { 16. };
        let raster_matrix = match self.painter.scene.items[index] {
            Item::Shadow {
                blur,
                covered: true,
                inset: false,
                ..
            } if blur * frame.scale >= scales_from => {
                let scale = frame.scale / (blur * frame.scale / 8.).floor();
                Transform::from_scale(scale, scale)
            }
            Item::Shadow { blur: 2.0.., .. } if !frame.is_translation(matrix) => {
                Transform::from_scale(frame.scale, frame.scale)
            }
            _ => *matrix,
        };
        let stretch = Stretch::of(&self.painter, index, &raster_matrix);
        let stretch =
            stretch.filter(|it| it.area.width().max(it.area.height()) <= MAX_SIDE as usize);
        let (Some(stretch), Some(inverse)) = (stretch, raster_matrix.invert()) else {
            return self.rasterize_all(index, matrix, clip);
        };
        let (key, area) = (
            digest::of_stretch(&self.painter, &stretch, &raster_matrix),
            stretch.area,
        );
        let Some(sprite) = self.raster(key, area, false, |painter| {
            stretch.render(painter, &raster_matrix)
        }) else {
            return;
        };
        let (run, to_device) = (
            self.next_run(),
            (raster_matrix != *matrix).then(|| matrix.pre_concat(inverse)),
        );
        for (mut from, mut to) in stretch.pieces() {
            if to_device.is_some() {
                // The edge, which is transparent, is what gets interpolated with.
                let inside = from.intersect(area.outset(-1));
                to.left += inside.left - from.left;
                to.top += inside.top - from.top;
                to.right += inside.right - from.right;
                to.bottom += inside.bottom - from.bottom;
                from = inside;
            }
            let bounds =
                to_device.map_or(to.to_rect(), |to_device| map_rect(&to_device, to.to_rect()));
            let tile = part_of(sprite.tile, from.offset(-area.left, -area.top));
            self.push(Primitive {
                run,
                ..Primitive::new(bounds, clip, Kind::Image(tile))
            });
        }
    }

    /// A gradient that only changes along one axis.
    fn stretch_gradient(&mut self, index: usize, matrix: &Transform, clip: IntRect) -> bool {
        let Painter { scene, frame, .. } = self.painter;
        let mut item = scene.items[index];
        let Some(is_vertical) = gradient_axis(&item) else {
            return false;
        };
        let Item::Gradient {
            clip: shape, tile, ..
        } = &mut item
        else {
            return false;
        };
        let snapped = tile_bounds(&frame.snap_shape(shape), &cpu::snap_tile(frame, tile));
        let mut bounds = IntRect::nearest(map_rect(matrix, snapped));
        if bounds.width().max(bounds.height()) > MAX_SIDE as usize {
            bounds = bounds.intersect(clip);
        }
        let across = if is_vertical {
            bounds.width()
        } else {
            bounds.height()
        };
        if across < STRETCHED as usize
            || bounds.width().max(bounds.height()) > MAX_SIDE as usize * 4
        {
            return false;
        }
        shape.radii = Default::default();
        let (area, part) = match is_vertical {
            true => (
                IntRect {
                    right: bounds.left + STRETCHED,
                    ..bounds
                },
                IntRect::new(1, 0, 2, bounds.height() as i32),
            ),
            false => (
                IntRect {
                    bottom: bounds.top + STRETCHED,
                    ..bounds
                },
                IntRect::new(0, 1, bounds.width() as i32, 2),
            ),
        };
        let mut digest = Digest::new(area);
        digest.matrix(matrix);
        digest.item(&self.painter, &item, matrix);
        digest.value("stretched");
        let sprite = self.raster(digest.finish(), area, false, |painter| {
            let mut layer = Layer::new(area)?;
            painter.paint_leaf(&item, &mut layer, matrix, &Clip::new(area), area);
            Some(layer)
        });
        if let Some(sprite) = sprite {
            self.push(Primitive::new(
                bounds.to_rect(),
                clip,
                Kind::Image(part_of(sprite.tile, part)),
            ));
        }
        true
    }

    fn image(&mut self, index: usize, matrix: &Transform, clip: IntRect) -> bool {
        const LARGEST: f32 = 4096.;
        let Painter { scene, frame, .. } = self.painter;
        let Item::Image {
            tile,
            image,
            pixelated,
            ..
        } = scene.items[index]
        else {
            return false;
        };
        if tile.step != [0., 0.] {
            return false;
        }
        let bounds = map_rect(matrix, frame.snap(tile.rect));
        if webview::with(image, |view, _| {
            self.web_page(image, view, matrix, bounds, clip)
        }) == Some(true)
        {
            return true;
        }
        let Some(info) = images::info(image, frame) else {
            return true;
        };
        let Some(size) = info.size else { return false };
        let is_unscaled = |(columns, rows): (u32, u32)| {
            (columns as f32 - bounds.width).abs() < 0.01
                && (rows as f32 - bounds.height).abs() < 0.01
        };
        if pixelated && !is_unscaled(size) {
            return false;
        }
        let (width, height) = (bounds.width.min(LARGEST), bounds.height.min(LARGEST));
        let (columns, rows) = images::reduced_size(size, width, height);
        let area = IntRect::new(0, 0, columns as i32, rows as i32);
        let mut digest = Digest::new(area);
        digest.value((image, info.version));
        let sprite = self.raster(digest.finish(), area, false, |_| {
            images::with_size(image, frame, width, height, |content| match content {
                Content::Pixels(pixmap) => padded(pixmap),
                Content::Svg(_) => None,
            })?
        });
        let Some(sprite) = sprite else {
            return info.is_deferred;
        };
        let (mut bounds, mut part) = (bounds, area.offset(1, 1));
        if is_unscaled((columns, rows)) {
            let (all, shown) = (
                IntRect::nearest(bounds),
                IntRect::nearest(bounds).intersect(clip),
            );
            (bounds, part) = (shown.to_rect(), shown.offset(1 - all.left, 1 - all.top));
        }
        self.push(Primitive::new(
            bounds,
            clip,
            Kind::Image(part_of(sprite.tile, part)),
        ));
        true
    }

    /// In pieces, of which few change. It is not stretched while it catches up with the size of its box.
    fn web_page(
        &mut self,
        id: u32,
        view: &webview::View,
        matrix: &Transform,
        bounds: Rect,
        clip: IntRect,
    ) -> bool {
        if (matrix.sx - view.scale).abs() > 0.001 || (matrix.sy - view.scale).abs() > 0.001 {
            return false;
        }
        let all = IntRect::nearest(bounds);
        for (tile, version) in view.tiles() {
            let shown = tile.offset(all.left, all.top).intersect(clip);
            if shown.is_empty() {
                continue;
            }
            let mut digest = Digest::new(tile);
            digest.value((id, version, tile.left, tile.top));
            let sprite = self.raster(digest.finish(), tile, false, |_| {
                let part = resvg::tiny_skia::IntRect::from_ltrb(
                    tile.left,
                    tile.top,
                    tile.right,
                    tile.bottom,
                )?;
                Some(Layer {
                    rect: tile,
                    pixmap: view.pixmap.clone_rect(part)?,
                })
            });
            if let Some(sprite) = sprite {
                let part = shown.offset(-all.left - tile.left, -all.top - tile.top);
                self.push(Primitive::new(
                    shown.to_rect(),
                    clip,
                    Kind::Image(part_of(sprite.tile, part)),
                ));
            }
        }
        true
    }

    fn fade(&mut self, first: usize, opacity: f32) {
        self.cache.primitives[first..]
            .iter_mut()
            .for_each(|primitive| primitive.opacity *= opacity);
    }

    fn overlap(&self, first: usize) -> bool {
        const MAX_COMPARED: usize = 48;
        let mut seen: SmallVec<[(u32, IntRect); 16]> = SmallVec::new();
        for primitive in &self.cache.primitives[first..] {
            let is_full = seen.len() == MAX_COMPARED;
            match seen.last_mut() {
                Some((run, rect)) if *run != 0 && *run == primitive.run => {
                    *rect = rect.union(primitive.visible())
                }
                _ if is_full => return true,
                _ => seen.push((primitive.run, primitive.visible())),
            }
        }
        (1..seen.len()).any(|index| {
            seen[..index]
                .iter()
                .any(|(_, earlier)| earlier.overlaps(seen[index].1))
        })
    }

    /// Whether it was. With `is_optional`, a large layer waits until it has stopped changing.
    fn rasterize_layer(
        &mut self,
        index: usize,
        matrix: &Transform,
        clip: IntRect,
        is_optional: bool,
    ) -> bool {
        const SMALL: i64 = 160 * 160;
        const SETTLED_AFTER: Duration = Duration::from_millis(120);
        let Painter { scene, frame, .. } = self.painter;
        let Item::PushLayer {
            bounds,
            opacity,
            filters,
            ..
        } = scene.items[index]
        else {
            return false;
        };
        let area = self.area_to_rasterize(index, matrix, clip);
        let needed = area.outset(
            cpu::filter_reach(scene.filters(filters), matrix)
                + self.painter.reach_of_backdrops(index, matrix),
        );
        let mut digest = Digest::new(area);
        digest.matrix(matrix);
        digest.value(
            cpu::layer_clip(bounds, matrix)
                .intersect(needed)
                .offset(-area.left, -area.top),
        );
        digest.filters(scene, matrix, scene.filters(filters));
        digest.range(
            &self.painter,
            index + 1..scene.end(index) - 1,
            matrix,
            needed,
        );
        let key = digest.finish();
        if !self.can_afford(key, area) || area.width().max(area.height()) > MAX_SIDE as usize * 2 {
            return false;
        }
        if is_optional && area.area() > SMALL && !self.cache.rasters.contains_key(&key) {
            let (since, draw) = self
                .cache
                .waiting
                .entry((key, opacity.to_bits()))
                .or_insert((frame.now, 0));
            *draw = self.cache.draw;
            if frame.now < *since + SETTLED_AFTER {
                frame.changes_at(*since + SETTLED_AFTER);
                return false;
            }
        }
        self.push_raster(key, area, clip, |painter| {
            painter.render_layer(index, matrix, area)
        });
        true
    }

    fn layer(&mut self, index: usize, matrix: &Transform, clip: IntRect) {
        let scene = self.painter.scene;
        let Item::PushLayer { opacity, blend, .. } = scene.items[index] else {
            return;
        };
        if opacity <= 0. {
            return;
        }
        if blend != BlendMode::Normal && self.replace_with_scene(index, matrix, clip) {
            return;
        }
        let first = self.cache.primitives.len();
        let outer = self.layer_start.replace(first);
        self.contents_of_layer(index, matrix, clip);
        self.layer_start = outer;
    }

    fn contents_of_layer(&mut self, index: usize, matrix: &Transform, clip: IntRect) {
        let (scene, first) = (self.painter.scene, self.cache.primitives.len());
        let Item::PushLayer {
            bounds,
            opacity,
            filters,
            ..
        } = scene.items[index]
        else {
            return;
        };
        let inside = clip.intersect(cpu::layer_clip(bounds, matrix));
        let is_filtered = !scene.filters(filters).iter().all(is_identity);
        let mask = scene.mask(index);
        if let Some((mask, false)) = mask.clone().filter(|_| !is_filtered && opacity >= 1.)
            && let visible = self.device_bounds(index, matrix).intersect(clip)
            && let Some((opaque, outline)) = self.opaque_part(mask, matrix, visible)
        {
            self.range(scene.content(index), matrix, opaque.intersect(inside));
            self.round(first, &outline, index, matrix, opaque.intersect(clip));
            for piece in visible.without(opaque) {
                let mut digest = Digest::new(piece);
                digest.matrix(matrix);
                digest.range(&self.painter, index..scene.end(index), matrix, piece);
                self.push_raster(digest.finish(), piece, clip, |painter| {
                    painter.render_layer(index, matrix, piece)
                });
            }
            return;
        }
        if !((is_filtered || mask.is_some()) && self.rasterize_layer(index, matrix, clip, false)) {
            self.range(scene.content(index), matrix, inside);
            if opacity < 1. && self.overlap(first) {
                let separate = self.cache.primitives.split_off(first);
                if !self.rasterize_layer(index, matrix, clip, true) {
                    self.cache.primitives.extend(separate);
                }
            }
        }
        self.fade(first, opacity);
    }

    /// Where a mask that fades the edges of a large area changes nothing.
    fn opaque_part(
        &mut self,
        mask: Range<usize>,
        matrix: &Transform,
        area: IntRect,
    ) -> Option<(IntRect, RoundedRect)> {
        const SMALL: i64 = 128 * 128;
        let outline = match self.painter.scene.items[mask.clone()] {
            [Item::Fill { shape, .. } | Item::Gradient { clip: shape, .. }] => {
                map_shape(matrix, &self.painter.frame.snap_shape(&shape))
            }
            _ => RoundedRect::default(),
        };
        let is_simple = |item: &Item| match item {
            Item::Fill { shape, .. } | Item::PushClip(shape) => {
                !has_radii(shape) || mask.len() == 1
            }
            Item::Gradient { clip, .. } => {
                (!has_radii(clip) || mask.len() == 1) && gradient_axis(item).is_some()
            }
            Item::PushTransform([_, b, c, ..]) => [*b, *c] == [0.; 2],
            Item::PushLayer { filters, .. } => filters.start == filters.end,
            item => matches!(item, Item::Pop),
        };
        if area.area() <= SMALL || !self.painter.scene.items[mask.clone()].iter().all(is_simple) {
            return None;
        }
        let mut digest = Digest::new(area);
        digest.matrix(matrix);
        digest.range(&self.painter, mask.clone(), matrix, area);
        let key = digest.finish();
        let known = self.cache.opaque_parts.get(&key).map(|(part, _)| *part);
        let part = known.unwrap_or_else(|| {
            Some(
                self.find_opaque_part(mask, matrix, area, &outline)?
                    .offset(-area.left, -area.top),
            )
        });
        self.cache.opaque_parts.insert(key, (part, self.cache.draw));
        Some((part?.offset(area.left, area.top), outline))
    }

    fn find_opaque_part(
        &self,
        mask: Range<usize>,
        matrix: &Transform,
        area: IntRect,
        outline: &RoundedRect,
    ) -> Option<IntRect> {
        let longest_opaque = |line: IntRect| {
            let mut layer = Layer::new(line)?;
            self.painter
                .paint(mask.clone(), &mut layer, matrix, &Clip::new(line));
            let (mut best, mut start) = (0..0, 0);
            for (at, pixel) in (1..).zip(layer.pixels()) {
                if pixel[3] != 255 {
                    start = at;
                } else if at - start > best.end - best.start {
                    best = start..at;
                }
            }
            Some(best).filter(|best| !best.is_empty())
        };
        let x = (area.left + area.right) / 2;
        let rows = longest_opaque(IntRect {
            left: x,
            right: x + 1,
            ..area
        })?;
        let (top, bottom) = (area.top + rows.start, area.top + rows.end);
        let [tl, tr, br, bl] = corner_rects(outline);
        let lines = match has_radii(outline) {
            true => [
                top.max(tl.bottom).max(tr.bottom),
                bottom.min(bl.top).min(br.top) - 1,
            ],
            false => [top, bottom - 1],
        };
        (lines[0] <= lines[1]).then_some(())?;
        let [above, below] = lines.map(|y| {
            longest_opaque(IntRect {
                top: y,
                bottom: y + 1,
                ..area
            })
        });
        let (above, below) = (above?, below?);
        let (left, right) = (above.start.max(below.start), above.end.min(below.end));
        let part = IntRect::new(area.left + left, top, area.left + right, bottom);
        (part.area() * 2 > area.area()).then_some(part)
    }

    /// Everything before the item, at `1 / reduction` of the resolution.
    fn scene_before(
        &self,
        first: usize,
        limit: usize,
        area: IntRect,
        reduction: i32,
    ) -> (Digest, impl FnOnce() -> Option<Layer> + use<'_>) {
        let painter = Painter {
            limit,
            ..self.painter
        };
        let mut digest = Digest::new(area);
        let (atlas, primitives) = (self.atlas, &self.cache.primitives[first..]);
        digest.value((reduction, software::hash_of_snapshot(primitives, area)));
        let (factor, background) = (1. / reduction as f32, self.placement.background);
        let matrix = self
            .root
            .post_translate(-area.left as f32, -area.top as f32)
            .post_scale(factor, factor);
        (digest, move || {
            if let Some(layer) = atlas.snapshot(primitives, area, reduction as usize) {
                return Some(layer);
            }
            let frame = painter.frame.rescaled(factor);
            let side = |length: usize| length.div_ceil(reduction as usize) as i32;
            let mut layer =
                Layer::new(IntRect::new(0, 0, side(area.width()), side(area.height())))?;
            let clip = Clip::new(layer.rect);
            layer.fill(
                clip.rect,
                None,
                &clip,
                &Paint::Solid(premultiply(background)),
            );
            Painter {
                frame: &frame,
                ..painter
            }
            .paint(0..painter.scene.items.len(), &mut layer, &matrix, &clip);
            Some(layer)
        })
    }

    /// For what blends with the pixels under it, which only the CPU can read.
    fn replace_with_scene(&mut self, index: usize, matrix: &Transform, clip: IntRect) -> bool {
        let (mut area, end) = (
            self.device_bounds(index, matrix).intersect(clip),
            self.painter.scene.end(index),
        );
        if area.area() <= WHOLE_AREA
            && !matches!(
                self.painter.scene.items[index],
                Item::PushLayer {
                    blend: BlendMode::FromBackdrop,
                    ..
                }
            )
        {
            let mut digest = Digest::new(area);
            digest.matrix(matrix);
            digest.range(&self.painter, index..end, matrix, area);
            let painted = self.raster(digest.finish(), area, true, |painter| {
                painter.render_layer(index, matrix, area)
            });
            let Some(painted) = painted else { return true };
            area = painted.rect.offset(area.left, area.top);
        }
        let (mut digest, render) = self.scene_before(0, index, area, 1);
        digest.matrix(matrix);
        digest.range(&self.painter, index..end, matrix, area);
        let key = digest.finish();
        if !self.can_afford(key, area) || area.width().max(area.height()) > MAX_SIDE as usize * 2 {
            return false;
        }
        let mut rendered = (!self.cache.rasters.contains_key(&key))
            .then(render)
            .flatten();
        if let Some(layer) = &mut rendered {
            let (matrix, clip) = (
                matrix.post_translate(-area.left as f32, -area.top as f32),
                Clip::new(layer.rect),
            );
            self.painter.paint(index..end, layer, &matrix, &clip);
        }
        if let Some(sprite) = self.raster(key, IntRect::default(), false, |_| rendered) {
            self.push(Primitive::new(
                area.to_rect(),
                clip,
                Kind::Image(sprite.tile),
            ));
        }
        true
    }

    fn backdrop(
        &mut self,
        index: usize,
        shape: &RoundedRect,
        filters: &[Filter],
        matrix: &Transform,
        clip: IntRect,
    ) {
        let first = self.layer_start.unwrap_or(0);
        if filters.iter().all(is_identity) || self.layer_start == Some(self.cache.primitives.len())
        {
            return;
        }
        let blur = |filter: &Filter| {
            if let Filter::Blur(sigma) = filter {
                sigma * average_scale(matrix)
            } else {
                0.
            }
        };
        let reduction = ((filters.iter().map(blur).fold(0., f32::max) / 2.) as i32).clamp(1, 8);
        let shown = IntRect::nearest(shape.rect).intersect(self.placement.clip);
        let reach = cpu::filter_reach(filters, matrix);
        let (mut digest, render) = self.scene_before(first, index, shown, reduction);
        digest.filters(self.painter.scene, matrix, filters);
        let key = digest.finish();
        let reduced = |length: usize| length.div_ceil(reduction as usize) as i32;
        if shown.is_empty()
            || !self.can_afford(
                key,
                IntRect::new(0, 0, reduced(shown.width()), reduced(shown.height())),
            )
        {
            return;
        }
        let rendered = (!self.cache.rasters.contains_key(&key))
            .then(render)
            .flatten();
        let sprite = self.raster(key, IntRect::default(), false, |_| {
            let (behind, factor) = (rendered?, 1. / reduction as f32);
            let mut layer = cpu::mirror_edges(&behind, reach / reduction + 1)?;
            filter::apply(&mut layer, filters, &matrix.post_scale(factor, factor));
            layer.copy(behind.rect.outset(1))
        });
        let Some(sprite) = sprite else { return };
        let part = IntRect::new(
            1,
            1,
            1 + reduced(shown.width()),
            1 + reduced(shown.height()),
        );
        let radii = circular_radii(shape).filter(|_| shown == IntRect::nearest(shape.rect));
        let primitive = Primitive::new(
            shown.to_rect(),
            clip,
            Kind::Image(part_of(sprite.tile, part)),
        );
        self.push(Primitive {
            radii: radii.unwrap_or_default(),
            ..primitive
        });
    }
}
