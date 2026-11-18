use std::ops::Range;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use crate::gfx::{Pixmap, Transform};
use crate::hash::FastMap;
use crate::small_vec::SmallVec;

use super::blur::{MAX_SIGMA, MAX_SIGMA_OF_SHADOWS};
use super::cpu::{self, GlyphKey, GlyphPlacer, Painter, gradient_axis};
use super::digest::{self, Cells, Digest};
use super::memo::{Memo, Recall};
use super::raster::{
    Clip, Coverage, IntRect, Layer, average_scale, has_radii, map_point, map_rect, multiply,
    swap_red_and_blue,
};
use super::scene::{Frame, Scene, cross_fades, tile_bounds};
use super::software::{self, Atlas, Compositor, Sprite as Tile};
use super::stretch::{STRETCHED, Stretch};
use crate::abi::{BlendMode, Filter, Glyph, Item, LineStyle, Rect, RoundedRect};
use crate::images::{self, Content};
use crate::motion::sample;
use crate::sync::Mutex;
use crate::text::{self, GlyphPixels};
use crate::{parallel, webview};

/// What is rasterized in one piece, visible or not, so that scrolling finds it in the atlas.
const WHOLE_AREA: i64 = 512 * 512;
/// Beyond this many new pixels in one draw, an approximation does where there is one.
const BUDGET: i64 = 3 << 20;
const MAX_SIDE: i32 = 2048;
const GLYPHS_PER_MASK: usize = 24;
/// The GPU may still be reading what the last frames used.
const IN_FLIGHT: u64 = 3;
const MANY_ITEMS: usize = 64;

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Quad {
        color: u32,
        border_color: u32,
        border: [f32; 4],
    },
    Mask(Tile, u32),
    Image(Tile),
    /// A whole texture with `TURNED_EDGE` transparent pixels around what it shows.
    Turned {
        texture: u32,
        id: u32,
        to_texels: Transform,
    },
}

pub(super) const TURNED_EDGE: i32 = 2;

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

    pub(super) fn looks_like(&self, other: &Primitive) -> bool {
        (self.clip, self.bounds, self.kind, self.radii, self.opacity)
            == (
                other.clip,
                other.bounds,
                other.kind,
                other.radii,
                other.opacity,
            )
    }

    fn visible(&self) -> IntRect {
        IntRect::around(self.bounds).intersect(self.clip)
    }
}

#[derive(Clone, Copy)]
struct Sprite {
    tile: Tile,
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
    id: u64,
    draw: u64,
    glyphs: FastMap<GlyphKey, (Option<Sprite>, u64)>,
    rasters: FastMap<u128, Raster>,
    /// Layers by their key and opacity: since when they have looked like that, and the last draw in which they did.
    waiting: FastMap<(u128, u32), (Instant, u64)>,
    /// Of masks, and when they were last needed.
    opaque_parts: FastMap<u128, (Option<IntRect>, u64)>,
    primitives: Vec<Primitive>,
    /// Of this draw.
    pub lifted: Vec<Lifted>,
    /// The `contents` whose pixels are not needed again.
    pub known_contents: Vec<u128>,
}

/// A `PushTransform` or a `PushLayer` with what drives it.
#[derive(Clone, Copy)]
pub struct Mover<'a> {
    pub item: usize,
    /// How many others can be seen in it.
    pub inner: usize,
    pub reach: Rect,
    pub start: f64,
    pub cycle: f64,
    pub cycles: f64,
    pub samples: &'a [f32],
}

#[derive(Clone, PartialEq)]
pub struct Curve {
    /// The start, the cycle and the number of cycles.
    pub timing: [f64; 3],
    /// Like those of a driver.
    pub samples: Vec<f32>,
}

impl Curve {
    fn times(&self, other: &Curve) -> Option<Curve> {
        const STEPS: usize = 32;
        let ([a, a_lasts, 1.], [b, b_lasts, 1.]) = (self.timing, other.timing) else {
            return None;
        };
        let (from, to) = (a.min(b), (a + a_lasts).max(b + b_lasts));
        let at = |it: &Curve, position: f64| {
            sample::<2>(it.samples.as_chunks().0, position.clamp(0., 1.) as f32)
                .map_or(1., |it| it.0[1])
        };
        let product = |step: usize| {
            let position = step as f64 / STEPS as f64;
            let time = from + (to - from) * position;
            [
                position as f32,
                at(self, (time - a) / a_lasts) * at(other, (time - b) / b_lasts),
            ]
        };
        Some(Curve {
            samples: (0..=STEPS).flat_map(product).collect(),
            timing: [from, to - from, 1.],
        })
    }

    /// For what was painted with `matrix`, with the middle of `rect` as the origin.
    fn around(mut self, rect: IntRect, matrix: &Transform) -> Option<Curve> {
        const MAX_SCALE: f32 = 2.;
        let (inverse, x, y) = (
            matrix.invert()?,
            (rect.left + rect.right) as f32 / 2.,
            (rect.top + rect.bottom) as f32 / 2.,
        );
        for [_, a, b, c, d, e, f] in self.samples.as_chunks_mut().0 {
            let on_screen = matrix
                .pre_concat(Transform::from_row(*a, *b, *c, *d, *e, *f))
                .pre_concat(inverse);
            let it = on_screen.pre_translate(x, y).post_translate(-x, -y);
            let is_sharp = it.sx.hypot(it.ky).max(it.kx.hypot(it.sy)) <= MAX_SCALE;
            (is_sharp && it.sx * it.sy - it.kx * it.ky > 1e-3).then_some(())?;
            // What was lost to rounding is not another animation.
            let round = |value: f32, to: f32| (value * to).round() / to;
            [*a, *b, *c, *d] = [it.sx, it.ky, it.kx, it.sy].map(|it| round(it, 4096.));
            let only_moves = [*a, *b, *c, *d] == [1., 0., 0., 1.];
            [*e, *f] = [it.tx, it.ty].map(|it| round(it, if only_moves { 1. } else { 16. }));
        }
        Some(self)
    }
}

impl Mover<'_> {
    /// For as long as it stays where it is.
    pub fn identity(&self) -> [f64; 5] {
        [
            self.start,
            self.cycle,
            self.cycles,
            self.reach.x.into(),
            self.reach.y.into(),
        ]
    }
}

/// A picture in front of everything else, which the system moves or fades.
#[cfg_attr(
    not(target_os = "macos"),
    expect(dead_code, reason = "Core Animation does it")
)]
pub struct Lifted {
    pub item: usize,
    pub clip: IntRect,
    pub radius: f32,
    pub opacity: f32,
    pub rect: IntRect,
    /// `None` if there is nothing but what is lifted on its own.
    pub contents: Option<u128>,
    /// BGRA.
    pub pixels: Option<Vec<u8>>,
    pub fades: Option<Curve>,
    pub moves: Option<Curve>,
    origin: [f64; 5],
    is_clipped: bool,
    /// The run of an invisible primitive, which finds out what happens to it, and what was visible of that.
    marker: (u32, IntRect),
}

impl Lifted {
    fn follow_marker(&mut self, primitives: &[Primitive]) -> Option<()> {
        let mut found = primitives
            .iter()
            .enumerate()
            .filter(|(_, it)| it.run == self.marker.0);
        let (Some((index, it)), None) = (found.next(), found.next()) else {
            return None;
        };
        let has_shape = it.radii == [0.; 4]
            || it.radii == [it.radii[0]; 4] && self.clip == self.marker.1 && self.radius == 0.;
        (self.radius, self.opacity) = (self.radius + it.radii[0], self.opacity * it.opacity);
        (it.visible() == self.marker.1 && has_shape && is_uncovered(primitives, index))
            .then_some(())
    }
}

fn is_color(sprite: &Sprite) -> bool {
    sprite.tile.is_color
}

fn bgra(layer: &Layer, rect: IntRect) -> Vec<u8> {
    let mut pixels = Vec::with_capacity(rect.area() as usize);
    for y in rect.top..rect.bottom {
        pixels.extend(
            layer
                .row(y, rect.left, rect.right)
                .iter()
                .copied()
                .map(swap_red_and_blue),
        );
    }
    pixels.into_flattened()
}

fn painted_rect(layer: &Layer) -> IntRect {
    painted_part(layer, layer.rect)
}

fn painted_part(layer: &Layer, rect: IntRect) -> IntRect {
    let is_painted = |y: &i32| {
        layer
            .row(*y, rect.left, rect.right)
            .iter()
            .fold(0, |all, it| all | u32::from_le_bytes(*it))
            >> 24
            != 0
    };
    let (Some(top), Some(last)) = (
        (rect.top..rect.bottom).find(is_painted),
        (rect.top..rect.bottom).rfind(is_painted),
    ) else {
        return IntRect::default();
    };
    let (mut left, mut right) = (rect.right, rect.left);
    for y in top..=last {
        left = layer
            .row(y, rect.left, left)
            .iter()
            .position(|it| it[3] != 0)
            .map_or(left, |it| rect.left + it as i32);
        right = layer
            .row(y, right, rect.right)
            .iter()
            .rposition(|it| it[3] != 0)
            .map_or(right, |it| right + it as i32 + 1);
    }
    IntRect::new(left, top, right, last + 1)
}

/// `part` is relative to the tile's origin.
fn part_of(mut tile: Tile, part: IntRect) -> Tile {
    tile.part = part.offset(tile.part.left, tile.part.top);
    tile
}

/// With a copy of the edge around it, for the GPU to interpolate with.
/// Whether what is in a layer is added up, which would be too bright on what is behind the layer.
fn is_isolating(scene: &Scene, contents: Range<usize>) -> bool {
    scene
        .children(contents)
        .any(|index| match &scene.items[index] {
            item @ Item::PushLayer { .. } => cross_fades(item),
            Item::PushClip(_) | Item::PushTransform(_) => is_isolating(scene, scene.content(index)),
            _ => false,
        })
}

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

    pub fn begin(&mut self) {
        static LAST: AtomicU64 = AtomicU64::new(0);
        if self.draw == 0 {
            self.id = LAST.fetch_add(1, Ordering::Relaxed) + 1;
        }
        self.draw += 1;
        self.primitives.clear();
        self.lifted.clear();
    }

    pub fn finish(&mut self, compositor: &mut Compositor) {
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

    fn evicts(&self) -> bool {
        self.draw.is_multiple_of(4)
    }

    fn evict(&mut self, atlas: &Atlas) {
        const KEPT: u64 = 600;
        const MAX_BYTES: i64 = 32 << 20;
        const MAX_GLYPHS: usize = 8192;
        let draw = self.draw;
        self.waiting.retain(|_, (_, last_seen)| *last_seen == draw);
        if !self.evicts() {
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
        self.rasters.retain(|_, raster| {
            let keeps = draw - raster.last_used
                <= if raster.was_reused {
                    kept_for
                } else {
                    IN_FLIGHT
                };
            if let Some(sprite) = raster.sprite.filter(|_| !keeps) {
                atlas.remove(sprite.tile);
            }
            keeps
        });
        atlas.release_memory();
        if self.glyphs.len() > MAX_GLYPHS {
            self.glyphs.retain(|_, (sprite, last_used)| {
                let keeps = draw - *last_used <= IN_FLIGHT;
                if let Some(sprite) = sprite.filter(|_| !keeps) {
                    atlas.remove(sprite.tile);
                }
                keeps
            });
        }
    }

    fn glyph(&mut self, key: GlyphKey, atlas: &Atlas) -> Option<Sprite> {
        let entry = self.glyphs.entry(key).or_insert_with(|| {
            let sprite = key.rasterize().map(|image| {
                let (is_color, bytes) = match image.pixels {
                    GlyphPixels::Mask(mask) => (false, mask),
                    GlyphPixels::Color(layer) => (true, bgra(&layer, layer.rect)),
                };
                let rect = image.rect;
                Sprite {
                    tile: atlas.insert(is_color, rect.width(), rect.height(), &bytes),
                    rect,
                }
            });
            (sprite, 0)
        });
        entry.1 = self.draw;
        entry.0
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

/// Whether its edge follows that of the border, in the outer half.
fn ends_in_border(background: &Primitive, rect: Rect, radii: [f32; 4], width: f32) -> bool {
    let (inner, near) = (background.bounds, |a: f32, b: f32| (a - b).abs() < 0.01);
    let by = inner.x - rect.x;
    (0. ..=width / 2. + 0.01).contains(&by)
        && near(inner.y - rect.y, by)
        && near(rect.width - inner.width, by * 2.)
        && near(rect.height - inner.height, by * 2.)
        && background
            .radii
            .iter()
            .zip(radii)
            .all(|(inner, outer)| near(*inner, (outer - by).max(0.)))
}

/// `None` for radii that are not circular.
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

fn is_within_curve(shape: &RoundedRect, corner: usize, area: IntRect) -> bool {
    let (
        Rect {
            x,
            y,
            width,
            height,
        },
        [rx, ry],
    ) = (shape.rect, shape.radii[corner]);
    let across = if matches!(corner, 0 | 3) {
        x + rx - area.left as f32
    } else {
        area.right as f32 - (x + width - rx)
    };
    let down = if corner < 2 {
        y + ry - area.top as f32
    } else {
        area.bottom as f32 - (y + height - ry)
    };
    (across / rx).powi(2) + (down / ry).powi(2) < 0.99
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
pub struct Placement<'a> {
    pub movers: &'a [Mover<'a>],
    /// Sorted indices of items.
    pub in_motion: &'a [usize],
    pub origin: (i32, i32),
    pub clip: IntRect,
}

struct Flattener<'a> {
    painter: Painter<'a>,
    placement: &'a Placement<'a>,
    atlas: &'a Atlas,
    cache: &'a mut Cache,
    memo: Option<&'a mut Memo>,
    budget: i64,
    /// The first of the primitives of the layer that is being flattened, if it is not the root.
    layer_start: Option<usize>,
    /// Beyond it, the CPU paints what the primitives leave out.
    flattened: IntRect,
}

const CARET: u32 = u32::MAX;

const MAX_LIFTED: u32 = 64;

fn is_marker(primitive: &Primitive) -> bool {
    (CARET - MAX_LIFTED..CARET).contains(&primitive.run)
}

fn is_uncovered(primitives: &[Primitive], index: usize) -> bool {
    let rect = primitives[index].visible();
    primitives[index + 1..].iter().all(|it| match it.kind {
        _ if is_marker(it) => true,
        Kind::Quad { color, border, .. } if color & 0xFF == 0 => {
            let edge = border.into_iter().chain(it.radii).fold(0., f32::max).ceil() as i32 + 1;
            !it.visible().overlaps(rect) || IntRect::around(it.bounds).outset(-edge).contains(rect)
        }
        _ => !it.visible().overlaps(rect),
    })
}

/// Removes the caret if it could as well be in front of everything, and returns where it is and its color.
#[cfg(target_os = "macos")]
pub fn lift_caret(primitives: &mut Vec<Primitive>) -> Option<(IntRect, u32)> {
    let index = primitives.iter().position(|it| it.run == CARET)?;
    let caret = primitives[index];
    let Kind::Quad { color, .. } = caret.kind else {
        return None;
    };
    let is_plain = caret.opacity == 1.
        && caret.radii == [0.; 4]
        && IntRect::around(caret.bounds) == IntRect::nearest(caret.bounds);
    let is_whole = primitives[index + 1..].iter().all(|it| it.run != CARET);
    (is_plain && is_whole && is_uncovered(primitives, index)).then(|| primitives.remove(index))?;
    Some((caret.visible(), color))
}

/// Returns the identities of those that have to stay where they are.
#[cfg(target_os = "macos")]
pub fn lift(primitives: &mut Vec<Primitive>, lifted: &mut [Lifted]) -> Vec<[f64; 5]> {
    let refused = lifted
        .iter_mut()
        .filter_map(|it| it.follow_marker(primitives).is_none().then_some(it.origin))
        .collect();
    if !lifted.is_empty() {
        primitives.retain(|it| !is_marker(it));
    }
    refused
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
    let mut memo = scene.memo.as_ref().map(|it| it.lock());
    memo.iter_mut()
        .for_each(|it| it.begin((cache.id, cache.draw), scene.items.len()));
    let mut flattener = Flattener {
        painter: Painter {
            scene,
            frame,
            left_out: &[],
        },
        placement,
        atlas,
        cache,
        memo: memo.as_deref_mut(),
        budget: BUDGET,
        layer_start: None,
        flattened: IntRect::new(i32::MIN, i32::MIN, i32::MAX, i32::MAX),
    };
    flattener.range(0..scene.items.len(), &root, placement.clip);
    if let Some(memo) = memo.as_mut().filter(|_| cache.evicts()) {
        memo.tidy(cache.draw - IN_FLIGHT, |key, last_used| {
            if let Some(raster) = cache.rasters.get_mut(&key) {
                raster.was_reused |= raster.last_used < last_used;
                raster.last_used = raster.last_used.max(last_used);
            }
        });
    }
    images::expect_all(
        scene
            .new_images
            .lock()
            .drain(..)
            .map(|(image, size)| (image, size.map(|it| it * frame.scale))),
    );
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

    fn is_provisional(&mut self) {
        self.memo.iter_mut().for_each(|it| it.is_provisional());
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
        self.memo.iter_mut().for_each(|it| it.needs(key));
        if let Some(raster) = self.cache.rasters.get_mut(&key) {
            raster.was_reused |= raster.last_used != draw;
            raster.last_used = draw;
            return raster.sprite;
        }
        let sprite = crate::guard("error", None, || render(&self.painter)).and_then(|layer| {
            self.budget -= layer.rect.area();
            let rect = if trims {
                painted_rect(&layer).intersect(origin)
            } else {
                layer.rect
            };
            (!rect.is_empty()).then_some(())?;
            let bytes = bgra(&layer, rect);
            let tile = self.atlas.insert(true, rect.width(), rect.height(), &bytes);
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
        self.memo.iter_mut().for_each(|it| it.needs(key));
        let raster = self.cache.rasters.entry(key).or_insert_with(|| {
            let images = placed().filter_map(|(key, x, y)| Some((cpu::cached_glyph(key)?, x, y)));
            let images: SmallVec<_, GLYPHS_PER_MASK> = images.collect();
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
            let tile =
                (!rect.is_empty()).then(|| atlas.insert(false, rect.width(), rect.height(), &mask));
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

    /// So that a change or a move does not take all of it to be painted again.
    fn rasterize_cells(
        &mut self,
        index: usize,
        [x, y]: [f32; 2],
        matrix: &Transform,
        clip: IntRect,
    ) {
        let (
            Painter {
                scene,
                frame,
                left_out,
            },
            bounds,
        ) = (self.painter, self.device_bounds(index, matrix));
        let (range, (x, y)) = (index..scene.end(index), map_point(matrix, x, y));
        let origin = IntRect::nearest(Rect {
            x,
            y,
            width: 0.,
            height: 0.,
        });
        let mut cells = Cells::new([origin.left, origin.top], bounds.intersect(clip), matrix);
        cells.range(&self.painter, range.clone(), matrix);
        let shown = cells.shown;
        let row = |row| {
            (shown.left..shown.right)
                .filter_map(|column| cells.at(column, row, bounds))
                .collect::<Vec<_>>()
        };
        let rows: Vec<_> = (shown.top..shown.bottom).map(row).collect();
        let missing = rows.iter().map(|row| {
            row.iter()
                .filter(|it| !self.cache.rasters.contains_key(&it.0))
                .copied()
                .collect::<Vec<_>>()
        });
        let mut bands: Vec<_> = missing.filter(|it| !it.is_empty()).collect();
        let around = |band: &[(u128, IntRect)]| {
            band.iter()
                .fold(IntRect::default(), |all, it| all.union(it.1))
        };
        let area: i64 = bands.iter().flatten().map(|it| it.1.area()).sum();
        let needs_this_thread = |item: &Item| {
            matches!(
                item,
                Item::Image { .. } | Item::ImagePart { .. } | Item::Caret { .. }
            )
        };
        let is_shared = area >= WHOLE_AREA / 2
            && parallel::threads() > 1
            && !scene.items[range.clone()].iter().any(needs_this_thread);
        if !is_shared {
            bands.dedup_by(|next, band| {
                let (all, more) = (around(band), around(next));
                let joins = (all.left, all.right, all.bottom) == (more.left, more.right, more.top)
                    && all.height() < MAX_SIDE as usize;
                band.extend(next.iter().filter(|_| joins));
                joins
            });
        }
        let paint = |frame: &Frame, band: &[(u128, IntRect)]| {
            let layer = crate::guard("error", None, || {
                let mut layer = Layer::new(around(band))?;
                Painter {
                    scene,
                    frame,
                    left_out,
                }
                .paint(range.clone(), &mut layer, matrix, &Clip::new(around(band)));
                Some(layer)
            });
            let cut = |&(key, cell): &(u128, IntRect)| {
                let part = layer
                    .as_ref()
                    .map(|it| (it, painted_part(it, cell)))
                    .filter(|it| !it.1.is_empty());
                (
                    key,
                    part.map(|(layer, rect)| {
                        (rect.offset(-cell.left, -cell.top), bgra(layer, rect))
                    }),
                )
            };
            band.iter().map(cut).collect::<Vec<_>>()
        };
        let mut painted = Mutex::new(Vec::new());
        match is_shared {
            true => {
                let jobs: Vec<_> = bands
                    .iter()
                    .map(|band| (frame.rescaled(1.), band))
                    .collect();
                parallel::for_each(jobs.into_iter(), |(frame, band)| {
                    let cells = paint(&frame, band);
                    painted.lock().extend(cells);
                });
            }
            false => bands
                .iter()
                .for_each(|band| painted.get_mut().extend(paint(frame, band))),
        }
        self.budget -= area;
        for (key, part) in painted.get_mut().drain(..) {
            let sprite = part.map(|(rect, bytes)| Sprite {
                tile: self.atlas.insert(true, rect.width(), rect.height(), &bytes),
                rect,
            });
            self.cache.rasters.insert(
                key,
                Raster {
                    sprite,
                    last_used: self.cache.draw,
                    was_reused: false,
                },
            );
        }
        let run = self.next_run();
        for (key, cell) in rows.into_iter().flatten() {
            if let Some(sprite) = self.raster(key, cell, false, |_| None) {
                let bounds = sprite.rect.offset(cell.left, cell.top).to_rect();
                self.push(Primitive {
                    run,
                    ..Primitive::new(bounds, clip, Kind::Image(sprite.tile))
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
        if !(self.painter.scene.reads_backdrop(index) && self.paint_over_scene(index, matrix, clip))
        {
            self.rasterize(
                index,
                matrix,
                self.area_to_rasterize(index, matrix, clip),
                clip,
            );
        }
    }

    /// What the primitives from `first` on draw in `area`, inside of `shape`.
    fn cut_out(&mut self, first: usize, shape: &RoundedRect, area: IntRect) -> Option<Sprite> {
        let (mut digest, render) = self.snapshot(first, area, 1);
        digest.shape(&Transform::identity(), shape);
        let key = digest.finish();
        let rendered = (!self.cache.rasters.contains_key(&key))
            .then(render)
            .flatten();
        self.raster(key, area, true, |_| {
            let (mut inside, all) = (
                Layer::new(area)?,
                Layer {
                    rect: area,
                    ..rendered?
                },
            );
            inside.draw(
                &all,
                Some(&Coverage::of_shape(shape, &Transform::identity(), area)),
                &Clip::new(area),
            );
            Some(inside)
        })
    }

    /// Replaces what the primitives from `first` on draw in `holes` with what the CPU paints there.
    fn patch(
        &mut self,
        first: usize,
        holes: &[IntRect],
        shape: &RoundedRect,
        index: usize,
        matrix: &Transform,
        clip: IntRect,
    ) {
        if holes.is_empty() {
            return;
        }
        let reads_backdrop = self.painter.scene.reads_backdrop(index);
        let cut: SmallVec<_, 4> = holes
            .iter()
            .filter(|_| reads_backdrop)
            .filter_map(|hole| Some((self.cut_out(first, shape, *hole)?, hole)))
            .collect();
        for primitive in self.cache.primitives.split_off(first) {
            let visible = primitive.visible();
            let mut pieces: SmallVec<IntRect, 4> = SmallVec::from_iter([visible]);
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
        for (sprite, hole) in cut {
            self.push(Primitive::new(
                sprite.rect.offset(hole.left, hole.top).to_rect(),
                clip,
                Kind::Image(sprite.tile),
            ));
        }
        for hole in holes.iter().filter(|_| !reads_backdrop) {
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
            let touches = [0, 1, 2, 3]
                .map(|it| corners[it].overlaps(visible) && !is_within_curve(shape, it, visible));
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
        let mut holes: SmallVec<IntRect, 4> = SmallVec::new();
        for corner in (0..4).filter(|corner| is_touched[*corner]) {
            // Neighbors can share a row or a column of pixels.
            let mut pieces: SmallVec<IntRect, 4> =
                SmallVec::from_iter([corners[corner].intersect(clip)]);
            for known in &holes {
                pieces = pieces
                    .into_iter()
                    .flat_map(|piece| piece.without(*known))
                    .collect();
            }
            holes.extend(pieces);
        }
        self.patch(first, &holes, shape, index, matrix, clip);
    }

    fn range(&mut self, range: Range<usize>, matrix: &Transform, clip: IntRect) {
        for index in self.painter.scene.children(range) {
            let bounds = self.device_bounds(index, matrix);
            if bounds.overlaps(clip) {
                self.item_or_memo(index, matrix, clip, clip.contains(bounds));
            }
        }
    }

    fn item_or_memo(&mut self, index: usize, matrix: &Transform, clip: IntRect, is_inside: bool) {
        let (scene, first) = (self.painter.scene, self.cache.primitives.len());
        // A border may be merged with the fill before it.
        let is_worth_it = !scene.changes(index)
            && !matches!(
                scene.items[index],
                Item::Fill { .. } | Item::Border { .. } | Item::Line { .. }
            );
        let records = match self.memo.as_mut().filter(|_| is_worth_it) {
            Some(memo) => {
                match memo.recall(index, matrix, clip, is_inside, &mut self.cache.primitives) {
                    Recall::Done => return,
                    Recall::Moves => false,
                    Recall::Unknown => memo.start_recording(),
                }
            }
            None => false,
        };
        self.item(index, matrix, clip);
        if let Some(memo) = self.memo.as_mut().filter(|_| records) {
            memo.finish_recording(
                index..scene.end(index),
                matrix,
                clip,
                is_inside,
                &self.cache.primitives,
                first,
            );
        }
    }

    fn leave_out(&mut self, mover: &Mover, matrix: &Transform, clip: IntRect) -> Option<()> {
        let (scene, index, number) = (self.painter.scene, mover.item, self.cache.lifted.len());
        let needs_its_place = |item: &Item| match item {
            Item::PushLayer { blend, .. } => *blend != BlendMode::Normal,
            _ => matches!(item, Item::Backdrop { .. } | Item::Caret { .. }),
        };
        let inside = scene
            .children(scene.content(index))
            .map(|child| self.device_bounds(child, matrix));
        let fades = matches!(scene.items[index], Item::PushLayer { .. });
        let rect = if fades {
            self.device_bounds(index, matrix)
        } else {
            inside.fold(IntRect::default(), IntRect::union).outset(2)
        };
        let rect = IntRect {
            right: rect.left
                + (rect.width() as i32)
                    .max(1)
                    .cast_unsigned()
                    .next_multiple_of(16) as i32,
            ..rect
        };
        let swept =
            IntRect::around(map_rect(matrix, mover.reach)).outset(if fades { 0 } else { 2 });
        let visible = swept.intersect(clip);
        (self.flattened.contains(swept) || self.flattened.contains(visible.outset(1)))
            .then_some(())?;
        let is_worth_it = visible.area() <= WHOLE_AREA || mover.cycle * mover.cycles >= 2000.;
        let is_small = rect.area() <= 2 * WHOLE_AREA
            && rect.width().max(rect.height()) <= 4 * MAX_SIDE as usize;
        let is_possible = is_small && number + mover.inner < MAX_LIFTED as usize && is_worth_it;
        (is_possible && !visible.is_empty()).then_some(())?;
        (!scene.items[index..scene.end(index)]
            .iter()
            .any(needs_its_place))
        .then_some(())?;
        let curve = Curve {
            timing: [mover.start, mover.cycle, mover.cycles],
            samples: mover.samples.to_vec(),
        };
        let marker = (CARET - 1 - (number + mover.inner) as u32, visible);
        let (mut inner, mut has_contents) = (Vec::new(), true);
        if mover.inner > 0 {
            let inside = match scene.items[index] {
                Item::PushLayer {
                    bounds, filters, ..
                } => {
                    (scene.filters(filters).is_empty() && scene.mask(index).is_none())
                        .then_some(())?;
                    clip.intersect(cpu::layer_clip(bounds, matrix))
                }
                _ => rect,
            };
            let first = self.cache.primitives.len();
            self.range(scene.content(index), matrix, inside);
            let primitives = self.cache.primitives.split_off(first);
            inner = self.cache.lifted.split_off(number);
            (inner.len() == mover.inner).then_some(())?;
            has_contents = !primitives.iter().all(is_marker);
            for it in &mut inner {
                it.follow_marker(&primitives)?;
                it.marker = marker;
                if fades {
                    it.fades = Some(
                        it.fades
                            .as_ref()
                            .map_or(Some(curve.clone()), |own| own.times(&curve))?,
                    );
                } else {
                    (!it.is_clipped && it.radius == 0.).then_some(())?;
                    (it.moves, it.clip) = (Some(curve.clone().around(it.rect, matrix)?), visible);
                }
            }
        }
        let left_out: Vec<_> = inner.iter().map(|it| it.item).collect();
        let painter = &Painter {
            left_out: &left_out,
            ..self.painter
        };
        let mut digest = Digest::new(rect);
        digest.matrix(matrix);
        if let Item::PushLayer {
            bounds, filters, ..
        } = scene.items[index]
        {
            let needed = rect.outset(cpu::filter_reach(scene.filters(filters), matrix));
            digest.value(
                cpu::layer_clip(bounds, matrix)
                    .intersect(needed)
                    .offset(-rect.left, -rect.top),
            );
            digest.filters(scene, matrix, scene.filters(filters));
            digest.range(painter, index + 1..scene.end(index) - 1, matrix, needed);
        } else {
            digest.range(painter, scene.content(index), matrix, rect);
        }
        let contents = has_contents.then(|| digest.finish());
        let origin = mover.identity();
        let (fading, moves) = if fades {
            (Some(curve), None)
        } else {
            (None, Some(curve.around(rect, matrix)?))
        };
        let pixels = match contents.is_none_or(|it| self.cache.known_contents.contains(&it)) {
            true => None,
            false if fades => Some(bgra(&painter.render_layer(index, matrix, rect)?, rect)),
            false => {
                let mut layer = Layer::new(rect)?;
                painter.paint(scene.content(index), &mut layer, matrix, &Clip::new(rect));
                Some(bgra(&layer, rect))
            }
        };
        self.cache.primitives.push(Primitive {
            run: marker.0,
            ..Primitive::new(swept.to_rect(), clip, solid(0))
        });
        self.cache.lifted.extend(inner);
        let (item, clip, is_clipped, radius, opacity) = (index, visible, visible != swept, 0., 1.);
        self.cache.lifted.push(Lifted {
            item,
            clip,
            radius,
            opacity,
            rect,
            contents,
            pixels,
            fades: fading,
            moves,
            origin,
            is_clipped,
            marker,
        });
        Some(())
    }

    /// What is turning is painted once, upright.
    fn turn(&mut self, index: usize, matrix: &Transform, clip: IntRect) -> Option<()> {
        const MAX_STEP: f32 = 4.;
        let Painter { scene, frame, .. } = self.painter;
        let next = self.placement.in_motion.binary_search(&index).ok()? + 1;
        (self
            .placement
            .in_motion
            .get(next)
            .is_none_or(|it| *it >= scene.end(index))
            && !scene.reads_backdrop(index))
        .then_some(())?;
        let (x, y) = matrix.get_scale();
        let scale = frame.scale * (x.max(y) / frame.scale / 1.1).log2().ceil().exp2();
        let upright = Transform::from_scale(scale, scale);
        let to_upright = upright.pre_concat(matrix.invert()?);
        let area = IntRect::around(map_rect(&upright, scene.content_bounds(index)));
        let steps = [to_upright.sx, to_upright.kx, to_upright.ky, to_upright.sy];
        let is_small =
            area.area() <= WHOLE_AREA && area.width().max(area.height()) <= MAX_SIDE as usize;
        (is_small && steps.iter().all(|it| it.abs() <= MAX_STEP)).then_some(())?;
        let mut digest = Digest::new(area);
        digest.matrix(&upright);
        digest.range(&self.painter, scene.content(index), &upright, area);
        digest.value("upright");
        let sprite = self.raster(digest.finish(), area, false, |painter| {
            let mut layer = Layer::new(area)?;
            painter.paint(scene.content(index), &mut layer, &upright, &Clip::new(area));
            layer.copy(
                Some(painted_rect(&layer))
                    .filter(|it| !it.is_empty())?
                    .outset(TURNED_EDGE),
            )
        });
        if let Some(Sprite { tile, rect }) = sprite {
            let rect = rect.offset(area.left, area.top);
            let bounds = IntRect::around(map_rect(
                &matrix.pre_scale(1. / scale, 1. / scale),
                rect.outset(1 - TURNED_EDGE).to_rect(),
            ));
            let to_texels = to_upright.post_translate(-rect.left as f32, -rect.top as f32);
            self.push(Primitive::new(
                bounds.to_rect(),
                clip,
                Kind::Turned {
                    texture: tile.texture,
                    id: tile.id,
                    to_texels,
                },
            ));
        }
        Some(())
    }

    /// `matrix` is axis aligned.
    fn item(&mut self, index: usize, matrix: &Transform, clip: IntRect) {
        let Painter { scene, frame, .. } = self.painter;
        let first = self.cache.primitives.len();
        if let Some(mover) = self.placement.movers.iter().find(|it| it.item == index)
            && self.leave_out(mover, matrix, clip).is_some()
        {
            return;
        }
        match scene.items[index] {
            Item::PushClip(shape) => {
                let shape = map_shape(matrix, &frame.snap_shape(&shape));
                let inside = clip.intersect(IntRect::nearest(shape.rect));
                self.range(scene.content(index), matrix, inside);
                self.round(first, &shape, index, matrix, clip);
            }
            Item::PushTransform(by) => match frame.concat(matrix, by) {
                inner if is_axis_aligned(&inner) => self.range(scene.content(index), &inner, clip),
                inner if self.turn(index, &inner, clip).is_some() => {}
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
                self.backdrop(&shape, scene.filters(filters), matrix, clip);
                self.fade(first, opacity);
                if self.cache.primitives[first..]
                    .iter()
                    .all(|it| it.radii == [0.; 4])
                {
                    self.round(first, &shape, index, matrix, clip);
                }
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
            Item::Svg { .. } => {}
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
                self.is_provisional();
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
                    self.push(Primitive {
                        run: CARET,
                        ..Primitive::new(map_rect(matrix, frame.snap(rect)), clip, solid(color))
                    });
                }
            }
            Item::PushVector([.., x, y])
                if self.device_bounds(index, matrix).area()
                    > WHOLE_AREA
                        / if scene.end(index) - index > MANY_ITEMS {
                            4
                        } else {
                            1
                        }
                    && self
                        .painter
                        .reach_of_backdrops(index..scene.end(index), matrix)
                        == 0
                    && !scene.reads_backdrop(index) =>
            {
                self.rasterize_cells(index, [x, y], matrix, clip)
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
                if let (Item::Fill { color: fill, .. }, Some(last)) = (
                    scene.items[index.saturating_sub(1)],
                    self.cache.primitives.last_mut(),
                ) && matches!(last.kind, Kind::Quad { color, border: [0., 0., 0., 0.], .. } if color == fill && fill & 0xFF != 0)
                    && last.clip == clip
                    && ((last.bounds, last.radii) == (rect, radii)
                        || color & 0xFF == 0xFF && ends_in_border(last, rect, radii, top))
                {
                    (last.bounds, last.radii, last.kind) = (
                        rect,
                        radii,
                        Kind::Quad {
                            color: fill,
                            border_color: color,
                            border,
                        },
                    );
                    return;
                }
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
        let scales_from = 64.;
        let raster_matrix = match self.painter.scene.items[index] {
            Item::Shadow {
                blur,
                covered: true,
                inset: false,
                ..
            } if blur * frame.scale >= scales_from => {
                let scale = frame.scale
                    / ((blur * frame.scale).min(MAX_SIGMA_OF_SHADOWS * 2.) / 8.).floor();
                Transform::from_scale(scale, scale)
            }
            Item::Shadow { blur: 2.0.., .. } if !frame.is_translation(matrix) => {
                Transform::from_scale(frame.scale, frame.scale)
            }
            _ => *matrix,
        };
        let stretch = Stretch::of(&self.painter, index, &raster_matrix, matrix);
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
        let (columns, rows) = images::size_to_draw(
            image,
            frame,
            matrix,
            images::reduced_size(size, width, height),
        );
        let area = IntRect::new(0, 0, columns as i32, rows as i32);
        let mut digest = Digest::new(area);
        digest.value((image, info.version));
        let sprite = self.raster(digest.finish(), area, false, |_| {
            images::with_size(
                image,
                frame,
                |_| (columns, rows),
                |content| match content {
                    Content::Pixels(pixmap) => padded(pixmap),
                    Content::Svg(_) => None,
                },
            )?
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
                Some(Layer {
                    rect: tile,
                    pixmap: view
                        .pixmap
                        .cropped(tile.left, tile.top, tile.right, tile.bottom)?,
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
        if software::alpha(opacity) == 0 {
            let inside = self.cache.primitives.split_off(first);
            self.cache.primitives.extend(
                inside
                    .into_iter()
                    .filter(|it| it.run == CARET || is_marker(it)),
            );
        }
    }

    fn overlap(&self, first: usize) -> bool {
        const MAX_COMPARED: usize = 48;
        let mut seen: SmallVec<(u32, IntRect), 16> = SmallVec::new();
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
                + self
                    .painter
                    .reach_of_backdrops(scene.content(index), matrix),
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
            self.is_provisional();
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
                self.is_provisional();
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
        if blend != BlendMode::Normal && self.paint_over_scene(index, matrix, clip) {
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
            let outer = self.flattened;
            self.flattened = outer.intersect(opaque);
            self.range(scene.content(index), matrix, opaque.intersect(inside));
            self.flattened = outer;
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
        let isolates = scene.has_cross_fades && is_isolating(scene, scene.content(index));
        if !((is_filtered || isolates || mask.is_some())
            && self.rasterize_layer(index, matrix, clip, false))
        {
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

    /// The primitives from `first` on, at `1 / reduction` of the resolution.
    fn snapshot(
        &self,
        first: usize,
        area: IntRect,
        reduction: i32,
    ) -> (Digest, impl FnOnce() -> Option<Layer> + use<'_>) {
        let mut digest = Digest::new(area);
        let (atlas, primitives) = (self.atlas, &self.cache.primitives[first..]);
        digest.value((reduction, software::hash_of_snapshot(primitives, area)));
        (digest, move || {
            atlas.snapshot(primitives, area, reduction as usize)
        })
    }

    /// For what blends with the pixels under it, which only the CPU can read.
    fn paint_over_scene(&mut self, index: usize, matrix: &Transform, clip: IntRect) -> bool {
        let (mut area, end) = (
            self.device_bounds(index, matrix).intersect(clip),
            self.painter.scene.end(index),
        );
        if area.area() <= WHOLE_AREA
            && matches!(self.painter.scene.items[index], Item::PushLayer { blend, .. } if blend != BlendMode::FromBackdrop)
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
        let needed = area
            .outset(self.painter.reach_of_backdrops(index..end, matrix))
            .intersect(self.placement.clip);
        let (mut digest, render) = self.snapshot(self.layer_start.unwrap_or(0), needed, 1);
        digest.value(area);
        digest.matrix(matrix);
        digest.range(&self.painter, index..end, matrix, area);
        let key = digest.finish();
        if !self.can_afford(key, needed)
            || needed.width().max(needed.height()) > MAX_SIDE as usize * 2
        {
            return false;
        }
        let rendered = (!self.cache.rasters.contains_key(&key))
            .then(render)
            .flatten();
        let sprite = self.raster(key, area, false, |painter| {
            let mut all = Layer {
                rect: needed,
                ..rendered?
            };
            let behind = all.copy(area)?;
            painter.paint(index..end, &mut all, matrix, &Clip::new(area));
            let mut painted = if needed == area { all } else { all.copy(area)? };
            painted.take_out(&behind);
            Some(painted)
        });
        if let Some(sprite) = sprite {
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
        let (sigma, shown) = (
            filters.iter().map(blur).fold(0., f32::max),
            IntRect::nearest(shape.rect).intersect(self.placement.clip),
        );
        let sides = [shown.width(), shown.height()];
        // What is left of a row or a column would weigh too much in an average.
        let fits = |by: &i32| {
            sides.iter().any(|it| *it as f32 > sigma.min(MAX_SIGMA))
                || sides.iter().all(|it| it % *by as usize == 0)
        };
        let reduction = (1..=((sigma / 2.) as i32).clamp(1, 8))
            .rfind(fits)
            .unwrap_or(1);
        let (mut digest, render) = self.snapshot(first, shown, reduction);
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
        let sprite = self.raster(key, IntRect::default(), false, |painter| {
            let (mut layer, factor) = (rendered?, 1. / reduction as f32);
            let behind = layer.rect;
            painter.filter_backdrop(&mut layer, filters, &matrix.post_scale(factor, factor));
            cpu::mirror_edges(&layer.copy(behind)?, 1)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi::{Outline, PathVerb, Span, Stroke};

    fn shape(x: f32, y: f32, width: f32, height: f32, radius: f32) -> RoundedRect {
        RoundedRect {
            rect: Rect {
                x,
                y,
                width,
                height,
            },
            radii: [[radius; 2]; 4],
        }
    }

    fn layer(opacity: f32) -> Item {
        Item::PushLayer {
            bounds: shape(0., 0., 400., 4000., 0.).rect,
            opacity,
            blend: BlendMode::Normal,
            filters: Span::default(),
        }
    }

    fn flatten(scene: &Scene, cache: &mut Cache, compositor: &mut Compositor) -> Vec<Primitive> {
        let placement = Placement {
            movers: &[],
            in_motion: &[],
            origin: (3, 5),
            clip: IntRect::new(0, 0, 800, 600),
        };
        cache.begin();
        paint(
            scene,
            &Frame::new(2., true),
            &placement,
            &compositor.atlas,
            cache,
        );
        cache.finish(compositor);
        compositor.primitives.clone()
    }

    #[test]
    fn leaves_out_what_cannot_be_seen() {
        let mut scene = Scene::default();
        for opacity in [0.001, 0.01] {
            scene.items.extend([
                layer(opacity),
                Item::Fill {
                    shape: shape(0., 0., 20., 20., 0.),
                    color: 0xFF,
                },
                Item::Pop,
            ]);
        }
        scene.index();
        let shown = flatten(&scene, &mut Cache::default(), &mut Compositor::default());
        assert_eq!(
            shown.iter().map(|it| it.opacity).collect::<Vec<_>>(),
            [0.01]
        );
    }

    /// A header, rows that scroll, of which one fades, and a footer. With the indices of what scrolls and of what fades.
    fn page(rows: &[u32]) -> (Vec<Item>, Vec<PathVerb>, [usize; 2]) {
        let (mut items, mut verbs, mut fading) = (Vec::new(), Vec::new(), 0);
        let mut row = |items: &mut Vec<Item>, y: f32, it: u32| {
            let (card, color, start) = (
                shape(10., y, 200., 30., (it % 3 * 4) as f32),
                it << 8 | 0xFF,
                verbs.len() as u32,
            );
            verbs.extend([
                PathVerb::Move([12., y + 2.]),
                PathVerb::Line([30., y + 2.]),
                PathVerb::Line([12., y + (it % 20) as f32 + 5.]),
                PathVerb::Close,
            ]);
            let outline = Outline {
                verbs: Span {
                    start,
                    end: verbs.len() as u32,
                },
                bounds: shape(10., y, 22., 30., 0.).rect,
                ..Outline::default()
            };
            items.push(Item::Shadow {
                shape: card,
                shadow: card,
                blur: 4.,
                color,
                inset: false,
                covered: false,
            });
            items.extend([
                Item::PushClip(card),
                Item::Fill {
                    shape: shape(0., y - 5., 300., 20., 0.),
                    color,
                },
                Item::Path { outline, color },
                Item::Pop,
            ]);
        };
        row(&mut items, 4., 1);
        items.extend([
            Item::PushClip(shape(0., 40., 400., 200., 0.)),
            Item::PushTransform([1., 0., 0., 1., 0., 0.]),
        ]);
        let scrolling = items.len() - 1;
        items.push(Item::PushClip(shape(0., 0., 400., 4000., 0.)));
        for (index, it) in rows.iter().enumerate().skip(1) {
            row(&mut items, 40. + index as f32 * 36., *it);
        }
        items.push(Item::Pop);
        fading += items.len();
        items.push(layer(1.));
        row(&mut items, 40., rows[0]);
        items.extend([Item::Pop; 3]);
        row(&mut items, 250., 2);
        (items, verbs, [scrolling, fading])
    }

    #[test]
    fn remembers_what_it_would_flatten_again() {
        let (mut scene, mut spare, mut cache, mut compositor) = (
            Scene::default(),
            Scene::default(),
            Cache::default(),
            Compositor::default(),
        );
        let (mut rows, mut state, mut driven, mut scrolled) = (vec![7; 12], 1u32, [0; 2], 0.);
        for step in 0..400 {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let pick = state >> 16;
            if step == 0 || pick % 4 == 0 {
                match pick / 4 % 3 {
                    0 => rows.push(pick),
                    1 if rows.len() > 8 => drop(rows.remove(pick as usize % rows.len())),
                    _ => rows[pick as usize % 8] = pick,
                }
                let (items, verbs, indices) = page(&rows);
                spare.set_list(items, verbs);
                scene.replace(&[Item::PushClip(shape(0., 0., 400., 300., 0.))], &mut spare);
                driven = indices.map(|it| it + 1);
                scene.set_driven(driven.into_iter());
            }
            scrolled = [
                scrolled,
                scrolled,
                scrolled - 7.5,
                (pick % 200) as f32 * -0.25,
            ][(pick / 16 % 4) as usize];
            scene.items[driven[0]] = Item::PushTransform([1., 0., 0., 1., 0., scrolled]);
            scene.items[driven[1]] = layer([1., 0.5, 0.001][(pick / 64 % 3) as usize]);
            scene.index_around(vec![driven[0]]);
            let remembered = flatten(&scene, &mut cache, &mut compositor);
            let area = IntRect::new(0, 0, 500, 600);
            let shown = compositor.atlas.snapshot(&remembered, area, 1).unwrap();
            let (memo, mut other) = (scene.memo.take(), Compositor::default());
            let fresh = flatten(&scene, &mut Cache::default(), &mut other);
            scene.memo = memo;
            let outline = |all: &[Primitive]| {
                all.iter()
                    .map(|it| (it.bounds, it.clip, it.run, it.radii, it.opacity))
                    .collect::<Vec<_>>()
            };
            assert!(outline(&remembered) == outline(&fresh), "step {step}");
            assert!(
                shown.pixels() == other.atlas.snapshot(&fresh, area, 1).unwrap().pixels(),
                "step {step}"
            );
        }
    }

    fn triangles(moved: usize) -> Scene {
        let mut scene = Scene::default();
        scene
            .items
            .push(Item::PushVector([1., 0., 0., 1., 7., -40.]));
        for index in 0..200 {
            let (x, y) = (
                (index * 37 % 800) as f32 + if index == moved { 9.5 } else { 0.25 },
                (index * 53 % 600) as f32,
            );
            let start = scene.verbs.len() as u32;
            scene.verbs.extend([
                PathVerb::Move([x, y]),
                PathVerb::Line([x + 60., y + 20.5]),
                PathVerb::Line([x + 10., y + 90.]),
                PathVerb::Close,
            ]);
            let stroke = Stroke {
                width: (index % 2 * 3) as f32,
                miter_limit: 4.,
                ..Stroke::default()
            };
            let bounds = Rect {
                x: x - 6.,
                y: y - 6.,
                width: 72.,
                height: 102.,
            };
            let outline = Outline {
                verbs: Span {
                    start,
                    end: start + 4,
                },
                bounds,
                stroke,
                ..Outline::default()
            };
            scene.items.push(Item::Path {
                outline,
                color: (index as u32).wrapping_mul(0x9E37_79B9) | 0x80,
            });
        }
        scene.index();
        scene
    }

    #[test]
    fn a_large_drawing_is_painted_again_where_it_changes() {
        let (atlas, mut cache, frame, clip) = (
            Atlas::default(),
            Cache::default(),
            Frame::new(1., false),
            IntRect::new(0, 0, 800, 600),
        );
        let placement = Placement {
            movers: &[],
            in_motion: &[],
            origin: (0, 0),
            clip,
        };
        let mut counts = Vec::new();
        for moved in [usize::MAX, 77] {
            let (scene, mut whole) = (triangles(moved), Layer::new(clip).unwrap());
            cache.begin();
            paint(&scene, &frame, &placement, &atlas, &mut cache);
            Painter {
                scene: &scene,
                frame: &frame,
                left_out: &[],
            }
            .paint(
                0..scene.items.len(),
                &mut whole,
                &Transform::identity(),
                &Clip::new(clip),
            );
            let shown = atlas.snapshot(&cache.primitives, clip, 1).unwrap();
            assert!(
                shown
                    .pixmap
                    .data()
                    .iter()
                    .zip(whole.pixmap.data())
                    .all(|(a, b)| a.abs_diff(*b) <= 2)
            );
            counts.push(cache.rasters.len());
        }
        assert!(counts[0] > 16 && (1..=4).contains(&(counts[1] - counts[0])));
    }
}
