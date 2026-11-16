//! Draws what `flatten.rs` made of the scenes: the tiles that changed, and what has to be read back.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use crate::hash::FastMap;
use crate::small_vec::SmallVec;

use super::arena::{Arena, Block};
use super::flatten::{Kind, Primitive};
use super::raster::{
    IntRect, Layer, Pixel, blend_row, fill_row, fill_through, over, premultiply, scale, set_row,
};
#[cfg(any(test, not(target_os = "macos")))]
use crate::platform::{Painted, Pixels};

/// A part of a texture.
#[derive(Clone, Copy)]
pub struct Sprite {
    pub texture: u32,
    pub is_color: bool,
    /// Another one for each texture that there ever was.
    id: u32,
    pub part: IntRect,
}

pub(super) const TILE_WIDTH: i32 = 64;
pub(super) const TILE_HEIGHT: i32 = 16;

#[derive(Default)]
pub(super) struct Texture {
    pub width: usize,
    /// A byte for each pixel of a mask, and premultiplied BGRA otherwise.
    pub block: Option<Block>,
    is_opaque: bool,
}

impl Texture {
    pub fn data(&self) -> &[u8] {
        self.block.as_ref().map_or(&[], Block::bytes)
    }
}

#[derive(Default)]
pub(super) struct Textures {
    pub slots: Vec<Texture>,
    arena: Arena,
    free: Vec<u32>,
    last_id: u32,
}

#[derive(Default)]
pub struct Atlas(pub(super) RefCell<Textures>);

impl Atlas {
    pub fn insert(&self, is_color: bool, width: usize, height: usize, data: &[u8]) -> Sprite {
        let textures = &mut *self.0.borrow_mut();
        let is_opaque = is_color && data.as_chunks::<4>().0.iter().all(|it| it[3] == 255);
        let texture = textures.free.pop().unwrap_or_else(|| {
            textures.slots.push(Texture::default());
            textures.slots.len() as u32 - 1
        });
        textures.slots[texture as usize] = Texture {
            width,
            block: Some(textures.arena.store(data)),
            is_opaque,
        };
        textures.last_id += 1;
        Sprite {
            texture,
            is_color,
            id: textures.last_id,
            part: IntRect::new(0, 0, width as i32, height as i32),
        }
    }

    pub fn remove(&self, sprite: Sprite) {
        let textures = &mut *self.0.borrow_mut();
        textures.slots[sprite.texture as usize] = Texture::default();
        textures.free.push(sprite.texture);
    }

    pub fn release_memory(&self) {
        self.0.borrow_mut().arena.release_empty_chunks();
    }

    /// What the primitives look like in `area`, at `1 / reduction` of the resolution.
    pub fn snapshot(
        &self,
        primitives: &[Primitive],
        area: IntRect,
        reduction: usize,
    ) -> Option<Layer> {
        let (width, height) = (area.width(), area.height());
        let (columns, rows) = (width.div_ceil(reduction), height.div_ceil(reduction));
        let mut layer = Layer::new(IntRect::new(0, 0, columns as i32, rows as i32))?;
        let mut pixels = vec![[0; 4]; width * height];
        let textures = self.0.borrow();
        let mut band = Band::new(&mut pixels, width, area.left, area.top, &textures.slots);
        for primitive in &primitives[last_to_hide(primitives, area)..] {
            let visible = covered(primitive).intersect(area);
            if visible.is_empty() {
                continue;
            }
            band.paint(primitive, visible);
        }
        if reduction == 1 {
            layer
                .pixels_mut()
                .iter_mut()
                .zip(pixels)
                .for_each(|(to, [b, g, r, a])| *to = [r, g, b, a]);
            return Some(layer);
        }
        let mut sums = vec![[0u16; 4]; width];
        for (reduced, lines) in layer
            .pixels_mut()
            .chunks_mut(columns)
            .zip(pixels.chunks(width * reduction))
        {
            sums.fill([0; 4]);
            for line in lines.chunks(width) {
                let channels = sums.as_flattened_mut().iter_mut().zip(line.as_flattened());
                channels.for_each(|(sum, value)| *sum += u16::from(*value));
            }
            for (pixel, sums) in reduced.iter_mut().zip(sums.chunks(reduction)) {
                let count = (sums.len() * lines.len() / width) as u16;
                let average = |channel: usize| {
                    ((sums.iter().map(|it| it[channel]).sum::<u16>() + count / 2) / count) as u8
                };
                *pixel = [2, 1, 0, 3].map(average);
            }
        }
        Some(layer)
    }
}

/// Which is opaque.
pub fn has_one_color(primitive: &Primitive) -> bool {
    let Kind::Quad {
        color,
        border_color,
        border,
    } = primitive.kind
    else {
        return false;
    };
    color & 0xFF == 0xFF && primitive.opacity == 1. && (border == [0.; 4] || border_color == color)
}

pub fn last_to_hide(primitives: &[Primitive], area: IntRect) -> usize {
    let hides = |it: &Primitive| has_one_color(it) && uniform_part(it).contains(area);
    primitives.iter().rposition(hides).unwrap_or(0)
}

/// Changes with what `Atlas::snapshot` returns.
pub fn hash_of_snapshot(primitives: &[Primitive], area: IntRect) -> u64 {
    primitives[last_to_hide(primitives, area)..].iter().fold(
        pair(area.left, area.top),
        |hash, primitive| {
            let visible = covered(primitive).intersect(area);
            if visible.is_empty() {
                return hash;
            }
            let Summary { shape, y, .. } = Summary::of(primitive);
            [
                shape,
                y.to_bits().into(),
                pair(visible.left, visible.top),
                pair(visible.right, visible.bottom),
            ]
            .into_iter()
            .fold(hash, combine)
        },
    )
}

pub(super) fn bgra(color: u32, opacity: f32) -> Pixel {
    let [r, g, b, a] = premultiply(color);
    scale([b, g, r, a], alpha(opacity))
}

pub(super) fn alpha(fraction: f32) -> u8 {
    (fraction * 255. + 0.5) as u8
}

fn mix(a: Pixel, b: Pixel, fraction: u8) -> Pixel {
    const EVEN: u32 = 0x00FF_00FF;
    let (a, b) = (u32::from_ne_bytes(a), u32::from_ne_bytes(b));
    let weight = u32::from(fraction) + u32::from(fraction >> 7);
    let pair = |a: u32, b: u32| {
        ((a & EVEN) * (256 - weight) + (b & EVEN) * weight + 0x0080_0080) >> 8 & EVEN
    };
    (pair(a, b) | pair(a >> 8, b >> 8) << 8).to_ne_bytes()
}

/// The pixels whose centers are inside, as on a GPU.
fn covered(primitive: &Primitive) -> IntRect {
    IntRect::nearest(primitive.bounds).intersect(primitive.clip)
}

pub(super) fn border_of(primitive: &Primitive) -> [f32; 4] {
    match primitive.kind {
        Kind::Quad { border, .. } => border,
        _ => [0.; 4],
    }
}

pub(super) fn is_shaped(primitive: &Primitive) -> bool {
    primitive.radii != [0.; 4] || border_of(primitive) != [0.; 4]
}

/// How much of a pixel is inside of the outer edge, and outside of the inner one.
fn coverage(from_corner: [f32; 2], radius: f32, border: [f32; 2]) -> (u8, u8) {
    let border = border.map(|width| if width == 0. { -0.5 } else { width });
    let [u, v] = from_corner.map(|distance| distance + radius);
    let from_inner_corner = [from_corner[0] + border[0], from_corner[1] + border[1]];
    let length = |a: f32, b: f32| (a * a + b * b).sqrt();
    let outer = length(u.max(0.), v.max(0.)) + u.max(v).min(0.) - radius;
    let inner = if u <= 0. || v <= 0. {
        -from_inner_corner[0].max(from_inner_corner[1])
    } else if from_inner_corner[0] > 0. || from_inner_corner[1] > 0. {
        -1.
    } else if border[0] == border[1] {
        -(outer + border[0])
    } else {
        let radii = border.map(|width| (radius - width).max(0.));
        (length(u / radii[0], v / radii[1]) - 1.) * (radii[0] + radii[1]) * -0.5
    };
    (
        alpha((0.5 - outer).clamp(0., 1.)),
        alpha((0.5 - inner).clamp(0., 1.)),
    )
}

/// `coverage` for the pixels next to a corner. The last row and column go on like that.
struct Corner {
    side: usize,
    pixels: Vec<(u8, u8)>,
    /// For each row, how many pixels are not completely inside of both edges.
    curved: Vec<i32>,
}

fn corner(radius: f32, border: [f32; 2]) -> Rc<Corner> {
    thread_local! {
        static KNOWN: RefCell<FastMap<[u32; 3], Rc<Corner>>> = RefCell::default();
    }
    KNOWN.with_borrow_mut(|known| {
        if known.len() > 64 {
            known.clear();
        }
        let corner = known
            .entry([radius, border[0], border[1]].map(f32::to_bits))
            .or_insert_with(|| {
                let side = radius.max(border[0]).max(border[1]).ceil() as usize + 2;
                let at = |index: usize| {
                    coverage(
                        [index % side, index / side].map(|it| -0.5 - it as f32),
                        radius,
                        border,
                    )
                };
                Rc::new({
                    let pixels: Vec<_> = (0..side * side).map(at).collect();
                    let curved = |row: &[(u8, u8)]| match row
                        .iter()
                        .rposition(|it| *it != (255, 0))
                        .map_or(0, |it| it + 1)
                    {
                        all if all == side => i32::MAX / 2,
                        some => some as i32,
                    };
                    Corner {
                        side,
                        curved: pixels.chunks(side).map(curved).collect(),
                        pixels,
                    }
                })
            });
        corner.clone()
    })
}

struct Outline<'a> {
    primitive: &'a Primitive,
    /// Clockwise from the top left, if the edges are between pixels.
    corners: Option<[Rc<Corner>; 4]>,
}

impl Outline<'_> {
    fn of(primitive: &Primitive) -> Outline<'_> {
        const MAX_SIDE: f32 = 128.;
        let (bounds, radii, [top, right, bottom, left]) =
            (primitive.bounds, primitive.radii, border_of(primitive));
        let is_aligned = [bounds.x, bounds.y, bounds.width, bounds.height]
            .iter()
            .all(|it| it.fract() == 0.);
        let is_small = radii
            .iter()
            .chain(&[top, right, bottom, left])
            .all(|it| *it <= MAX_SIDE);
        let borders = [[left, top], [right, top], [right, bottom], [left, bottom]];
        let corners = (is_aligned && is_small)
            .then(|| [0, 1, 2, 3].map(|index| corner(radii[index], borders[index])));
        Outline { primitive, corners }
    }

    /// The columns of a row in which `coverage` is the same.
    fn middle(&self, y: i32) -> Range<i32> {
        let (straight, bounds) = (middle_of_row(self.primitive, y), self.primitive.bounds);
        let Some(known) = &self.corners else {
            return straight;
        };
        let (below_top, above_bottom) = (
            y - bounds.y as i32,
            (bounds.y + bounds.height) as i32 - 1 - y,
        );
        let (row, corners) = if below_top < above_bottom {
            (below_top, [0, 1])
        } else {
            (above_bottom, [3, 2])
        };
        let [left, right] = corners
            .map(|index| known[index].curved[(row.max(0) as usize).min(known[index].side - 1)]);
        let inside = bounds.x as i32 + left..(bounds.x + bounds.width) as i32 - right;
        if inside.len() > straight.len() {
            inside
        } else {
            straight
        }
    }

    /// Calls `f` with the `coverage` of each of the columns.
    #[inline(always)]
    fn visit(&self, y: i32, columns: impl Iterator<Item = i32>, mut f: impl FnMut(i32, (u8, u8))) {
        let bounds = self.primitive.bounds;
        let half = [bounds.width / 2., bounds.height / 2.];
        let from_center = y as f32 + 0.5 - bounds.y - half[1];
        let (from_edge, corners) = (
            from_center.abs() - half[1],
            if from_center < 0. { [0, 1] } else { [3, 2] },
        );
        if let Some(known) = &self.corners {
            let rows = corners.map(|index| {
                let Corner { side, pixels, .. } = &*known[index];
                &pixels[(-from_edge as usize).min(side - 1) * side..][..*side]
            });
            let (first, last) = (bounds.x as i32, (bounds.x + bounds.width) as i32 - 1);
            for x in columns {
                let (row, column) = if x - first < last - x {
                    (rows[0], x - first)
                } else {
                    (rows[1], last - x)
                };
                f(x, row[(column as usize).min(row.len() - 1)]);
            }
            return;
        }
        let [top, right, bottom, left] = border_of(self.primitive);
        let across = if from_center < 0. { top } else { bottom };
        for x in columns {
            let from_center = x as f32 + 0.5 - bounds.x - half[0];
            let (corner, border) = if from_center < 0. {
                (corners[0], left)
            } else {
                (corners[1], right)
            };
            f(
                x,
                coverage(
                    [from_center.abs() - half[0], from_edge],
                    self.primitive.radii[corner],
                    [border, across],
                ),
            );
        }
    }
}

/// The columns of a row that are between the corners.
fn middle_of_row(primitive: &Primitive, y: i32) -> Range<i32> {
    let (bounds, [tl, tr, br, bl], [_, right, _, left]) =
        (primitive.bounds, primitive.radii, border_of(primitive));
    let (below_top, above_bottom) = (
        y as f32 - bounds.y,
        bounds.y + bounds.height - (y + 1) as f32,
    );
    let curve = |upper: f32, lower: f32| match () {
        _ if below_top < upper => upper,
        _ if above_bottom < lower => lower,
        _ => 0.,
    };
    let start = (bounds.x + curve(tl, bl).max(left)).ceil() as i32 + 1;
    start..((bounds.x + bounds.width - curve(tr, br).max(right)).floor() as i32 - 1).max(start)
}

/// Where a quad has the same color everywhere.
pub fn uniform_part(primitive: &Primitive) -> IntRect {
    let ([tl, tr, br, bl], [top, right, bottom, left]) = (primitive.radii, border_of(primitive));
    let all = IntRect::nearest(primitive.bounds);
    if !is_shaped(primitive) {
        return all.intersect(primitive.clip);
    }
    let inset = |width: f32| width.ceil() as i32 + 1;
    let (top, bottom) = (inset(top.max(tl).max(tr)), inset(bottom.max(bl).max(br)));
    IntRect::new(
        all.left + inset(left),
        all.top + top,
        all.right - inset(right),
        all.bottom - bottom,
    )
    .intersect(primitive.clip)
}

/// Some rows of the window.
pub(super) struct Band<'a> {
    pixels: &'a mut [Pixel],
    width: usize,
    left: i32,
    top: i32,
    textures: &'a [Texture],
    colors: Vec<Pixel>,
    texels: Vec<Pixel>,
    columns: Vec<(u32, u32, u8)>,
}

/// The two texels that each pixel is between, and how far it is from the first.
fn samples(
    first_texel: i32,
    texels: i32,
    limit: usize,
    start: f32,
    extent: f32,
) -> impl Fn(i32) -> (u32, u32, u8) {
    let step = texels as f32 / extent;
    move |pixel| {
        let position = first_texel as f32 + (pixel as f32 + 0.5 - start) * step - 0.5;
        let (before, clamp) = (position.floor(), |texel: f32| {
            (texel.max(0.) as u32).min(limit as u32 - 1)
        });
        (clamp(before), clamp(before + 1.), alpha(position - before))
    }
}

impl<'a> Band<'a> {
    pub fn new(
        pixels: &'a mut [Pixel],
        width: usize,
        left: i32,
        top: i32,
        textures: &'a [Texture],
    ) -> Band<'a> {
        Band {
            pixels,
            width,
            left,
            top,
            textures,
            colors: Vec::new(),
            texels: Vec::new(),
            columns: Vec::new(),
        }
    }

    fn span(&self, y: i32, area: IntRect) -> Range<usize> {
        let start = (y - self.top) as usize * self.width;
        start + (area.left - self.left) as usize..start + (area.right - self.left) as usize
    }

    fn quad(&mut self, primitive: &Primitive, color: Pixel, border_color: Pixel, area: IntRect) {
        if !is_shaped(primitive) {
            for y in area.top..area.bottom {
                let span = self.span(y, area);
                fill_row(&mut self.pixels[span], color);
            }
            return;
        }
        let outline = Outline::of(primitive);
        let color_for = |coverage: (u8, u8)| match coverage {
            (0, _) => [0; 4],
            (255, 0) => color,
            (outer, inner) => scale(over(color, scale(border_color, inner)), outer),
        };
        for y in area.top..area.bottom {
            let span = self.span(y, area);
            let row = &mut self.pixels[span];
            let middle = outline.middle(y);
            let (start, end) = (
                middle.start.clamp(area.left, area.right),
                middle.end.clamp(area.left, area.right),
            );
            outline.visit(
                y,
                (area.left..start).chain(end..area.right),
                |x, coverage| {
                    let (pixel, color) = (&mut row[(x - area.left) as usize], color_for(coverage));
                    if color != [0; 4] {
                        *pixel = if color[3] == 255 {
                            color
                        } else {
                            over(*pixel, color)
                        };
                    }
                },
            );
            outline.visit(y, (start..end).take(1), |_, coverage| {
                fill_row(
                    &mut row[(start - area.left) as usize..(end - area.left) as usize],
                    color_for(coverage),
                );
            });
        }
    }

    fn mask(&mut self, primitive: &Primitive, texture: &Texture, color: Pixel, area: IntRect) {
        let (left, top) = (primitive.bounds.x as i32, primitive.bounds.y as i32);
        for y in area.top..area.bottom {
            let (span, start) = (
                self.span(y, area),
                (y - top) as usize * texture.width + (area.left - left) as usize,
            );
            fill_through(
                &mut self.pixels[span],
                color,
                &texture.data()[start..start + area.width()],
            );
        }
    }

    fn image(&mut self, primitive: &Primitive, tile: &Sprite, texture: &Texture, area: IntRect) {
        let (bounds, part) = (primitive.bounds, tile.part);
        let texels = texture.data().as_chunks::<4>().0;
        let texel_row = |row: u32| &texels[row as usize * texture.width..][..texture.width];
        let column_at = samples(
            part.left,
            part.width() as i32,
            texture.width,
            bounds.x,
            bounds.width,
        );
        let row_at = samples(
            part.top,
            part.height() as i32,
            texels.len() / texture.width,
            bounds.y,
            bounds.height,
        );
        let is_aligned = bounds.width == part.width() as f32 && bounds.x.fract() == 0.;
        let (opacity, is_shaped) = (alpha(primitive.opacity), is_shaped(primitive));
        let outline = is_shaped.then(|| Outline::of(primitive));
        self.columns.clear();
        if !is_aligned && (part.width() as i32) > 1 {
            self.columns.extend((area.left..area.right).map(&column_at));
        }
        for y in area.top..area.bottom {
            let (above, below, down) = if (part.height() as i32) == 1 {
                (part.top as u32, 0, 0)
            } else {
                row_at(y)
            };
            let (above, below, span) = (texel_row(above), texel_row(below), self.span(y, area));
            let (row, colors) = (&mut self.pixels[span], &mut self.colors);
            let first = (part.left + area.left - bounds.x as i32) as usize;
            if is_aligned && down == 0 && !is_shaped {
                match texture.is_opaque && opacity == 255 {
                    true => row.copy_from_slice(&above[first..first + row.len()]),
                    false => blend_row(row, &above[first..first + row.len()], opacity),
                }
                continue;
            }
            let texel = |column: usize| {
                if down == 0 {
                    above[column]
                } else {
                    mix(above[column], below[column], down)
                }
            };
            if (part.width() as i32) == 1 && !is_shaped {
                fill_row(row, scale(texel(part.left as usize), opacity));
                continue;
            }
            colors.clear();
            if is_aligned {
                colors.extend((first..first + row.len()).map(texel));
            } else if (part.width() as i32) == 1 {
                colors.resize(row.len(), texel(part.left as usize));
            } else if let (Some(&(first, ..)), Some(&(_, last, _))) =
                (self.columns.first(), self.columns.last())
                && (last - first) as usize <= row.len()
            {
                self.texels.clear();
                self.texels
                    .extend((first as usize..=last as usize).map(texel));
                let texel = |column: u32| self.texels[(column - first) as usize];
                colors.extend(
                    self.columns
                        .iter()
                        .map(|&(a, b, by)| mix(texel(a), texel(b), by)),
                );
            } else {
                colors.extend(
                    self.columns
                        .iter()
                        .map(|&(a, b, by)| mix(texel(a as usize), texel(b as usize), by)),
                );
            }
            if let Some(outline) = &outline {
                let middle = outline.middle(y);
                let (start, end) = (
                    middle.start.clamp(area.left, area.right),
                    middle.end.clamp(area.left, area.right),
                );
                outline.visit(
                    y,
                    (area.left..start).chain(end..area.right),
                    |x, (outer, _)| {
                        let color = &mut colors[(x - area.left) as usize];
                        *color = scale(*color, outer);
                    },
                );
                outline.visit(y, (start..end).take(1), |_, (outer, _)| {
                    if outer != 255 {
                        let middle =
                            &mut colors[(start - area.left) as usize..(end - area.left) as usize];
                        middle
                            .iter_mut()
                            .for_each(|color| *color = scale(*color, outer));
                    }
                });
            }
            blend_row(row, colors, opacity);
        }
    }

    fn paint(&mut self, primitive: &Primitive, area: IntRect) {
        let textures = self.textures;
        let texture =
            |tile: &Sprite| Some(&textures[tile.texture as usize]).filter(|it| it.width > 0);
        match &primitive.kind {
            Kind::Quad {
                color,
                border_color,
                ..
            } => self.quad(
                primitive,
                bgra(*color, primitive.opacity),
                bgra(*border_color, primitive.opacity),
                area,
            ),
            Kind::Mask(tile, color) => {
                let color = bgra(*color, primitive.opacity);
                texture(tile)
                    .into_iter()
                    .for_each(|texture| self.mask(primitive, texture, color, area))
            }
            Kind::Image(tile) => texture(tile)
                .into_iter()
                .for_each(|it| self.image(primitive, tile, it, area)),
        }
    }
}

fn combine(hash: u64, value: u64) -> u64 {
    let product = u128::from(hash ^ value) * 0x9E37_79B9_7F4A_7C15;
    (product as u64 ^ (product >> 64) as u64).wrapping_add(0x2545_F491_4F6C_DD1D)
}

fn pair(a: impl Into<i64>, b: impl Into<i64>) -> u64 {
    (a.into() as u64) << 32 | u64::from(b.into() as u32)
}

/// What is needed of a primitive to tell whether a tile has changed.
#[derive(PartialEq)]
pub(super) struct Summary {
    pub area: IntRect,
    y: f32,
    /// Of all that does not change when it moves up or down.
    shape: u64,
    /// The rows that look the same, and a hash of that.
    band: Range<i32>,
    band_shape: u64,
    uniform: IntRect,
    color: Pixel,
    /// It does not show on top of `color`.
    has_one_color: bool,
}

impl Summary {
    pub fn of(primitive: &Primitive) -> Summary {
        let floats = |[a, b, c, d]: [f32; 4]| {
            [
                pair(a.to_bits(), b.to_bits()),
                pair(c.to_bits(), d.to_bits()),
            ]
        };
        let of_tile = |tile: Sprite, color: u32| {
            let part = tile.part;
            [
                pair(tile.id, color),
                pair(part.left, part.top),
                pair(part.width() as i32, part.height() as i32),
            ]
        };
        let (bounds, mut band, mut uniform, mut color) =
            (primitive.bounds, 0..0, IntRect::default(), [0; 4]);
        let kind = match primitive.kind {
            Kind::Mask(tile, color) => of_tile(tile, color),
            Kind::Image(tile) => {
                if tile.part.height() == 1 && !is_shaped(primitive) {
                    band = i32::MIN..i32::MAX;
                }
                of_tile(tile, 0)
            }
            Kind::Quad {
                color: fill,
                border_color,
                border,
            } => {
                (uniform, color) = (uniform_part(primitive), bgra(fill, primitive.opacity));
                band = if is_shaped(primitive) {
                    uniform.top..uniform.bottom
                } else {
                    i32::MIN..i32::MAX
                };
                let [a, b] = floats(border);
                [pair(fill, border_color), a, !b]
            }
        };
        let across = pair(bounds.x.to_bits(), bounds.width.to_bits());
        let band_shape = kind
            .into_iter()
            .fold(combine(primitive.opacity.to_bits().into(), across), combine);
        let shape = floats(primitive.radii)
            .into_iter()
            .fold(band_shape ^ u64::from(bounds.height.to_bits()), combine);
        Summary {
            area: covered(primitive),
            y: bounds.y,
            shape,
            band,
            band_shape,
            uniform,
            color,
            has_one_color: has_one_color(primitive),
        }
    }
}

pub(super) struct Grid {
    pub window: IntRect,
    pub columns: usize,
}

impl Grid {
    pub fn columns_of(&self, area: IntRect) -> Range<i32> {
        area.left / TILE_WIDTH..(area.right - 1) / TILE_WIDTH + 1
    }

    pub fn rows_of(&self, area: IntRect) -> Range<i32> {
        area.top / TILE_HEIGHT..(area.bottom - 1) / TILE_HEIGHT + 1
    }

    /// The columns and the rows of the tiles that have nothing outside of `area`.
    fn inside(&self, area: IntRect) -> (Range<i32>, Range<i32>) {
        let range = |start: i32, end: i32, limit: i32, side: i32| {
            (start.max(0) + side - 1) / side..if end >= limit {
                (limit + side - 1) / side
            } else {
                end.max(0) / side
            }
        };
        let columns = range(area.left, area.right, self.window.right, TILE_WIDTH);
        let rows = range(area.top, area.bottom, self.window.bottom, TILE_HEIGHT);
        if columns.is_empty() {
            (0..0, 0..0)
        } else {
            (columns, rows)
        }
    }

    pub fn rect(&self, row: i32, columns: Range<i32>) -> IntRect {
        let (left, right) = (columns.start * TILE_WIDTH, columns.end * TILE_WIDTH);
        IntRect::new(left, row * TILE_HEIGHT, right, (row + 1) * TILE_HEIGHT).intersect(self.window)
    }

    pub fn around(&self, is_included: impl Fn(usize) -> bool) -> IntRect {
        let [mut rows, mut columns] = [(); 2].map(|()| Range {
            start: i32::MAX,
            end: 0,
        });
        for row in self.rows_of(self.window) {
            let is_included =
                |column: &i32| is_included(row as usize * self.columns + *column as usize);
            let mut all = self.columns_of(self.window);
            let Some(first) = all.find(is_included) else {
                continue;
            };
            let last = all.rfind(is_included).unwrap_or(first);
            (rows, columns) = (
                rows.start.min(row)..row + 1,
                columns.start.min(first)..columns.end.max(last + 1),
            );
        }
        if rows.is_empty() {
            return IntRect::default();
        }
        self.rect(rows.start, columns.clone())
            .union(self.rect(rows.end - 1, columns))
    }

    /// From the top to the bottom. What has the same columns does not have the same rows.
    pub fn areas(&self, is_included: impl Fn(usize) -> bool) -> Vec<IntRect> {
        let mut areas: Vec<IntRect> = Vec::new();
        for row in self.rows_of(self.window) {
            self.runs(row, self.columns_of(self.window), &is_included, |run| {
                let continues = |it: &&mut IntRect| {
                    (it.left, it.right, it.bottom) == (run.left, run.right, run.top)
                };
                match areas.iter_mut().find(continues) {
                    Some(above) => above.bottom = run.bottom,
                    None => areas.push(run),
                }
            });
        }
        areas
    }

    /// Of neighbors in a row for whose index `is_included` holds.
    fn runs(
        &self,
        row: i32,
        columns: Range<i32>,
        is_included: impl Fn(usize) -> bool,
        mut f: impl FnMut(IntRect),
    ) {
        let mut start = columns.start;
        for column in columns.start..=columns.end {
            if column == columns.end || !is_included(row as usize * self.columns + column as usize)
            {
                if start < column {
                    f(self.rect(row, start..column));
                }
                start = column + 1;
            }
        }
    }
}

#[derive(Clone, Copy, Default)]
pub(super) struct Tile {
    pub hash: u64,
    /// The primitives before this one amount to `base`.
    pub first: u32,
    base: Pixel,
    pub is_flat: bool,
}

impl Tile {
    #[cfg(any(test, target_os = "macos"))]
    pub fn is_opaque(&self) -> bool {
        self.base[3] == 255
    }

    fn flat(base: Pixel, first: usize) -> Tile {
        Tile {
            hash: combine(0, u32::from_ne_bytes(base).into()),
            first: first as u32,
            base,
            is_flat: true,
        }
    }
}

/// What is in each tile if everything is `down` pixels lower. Only right for those in `wanted`.
pub(super) fn survey(summaries: &[Summary], grid: &Grid, down: i32, wanted: IntRect) -> Vec<Tile> {
    let mut tiles = vec![Tile::default(); grid.columns * grid.rows_of(grid.window).len()];
    survey_again(&mut tiles, summaries, grid, down, wanted);
    tiles
}

/// `wanted` is made of whole tiles.
fn survey_again(
    tiles: &mut [Tile],
    summaries: &[Summary],
    grid: &Grid,
    down: i32,
    wanted: IntRect,
) {
    let hides_all =
        |it: &Summary| it.color[3] == 255 && it.uniform.offset(0, down).contains(wanted);
    let backdrop = summaries.iter().rposition(hides_all);
    let empty = backdrop.map_or(Tile::flat([0; 4], 0), |index| {
        Tile::flat(summaries[index].color, index + 1)
    });
    let columns = grid.columns_of(wanted);
    for row in grid.rows_of(wanted) {
        tiles[row as usize * grid.columns..][columns.start as usize..columns.end as usize]
            .fill(empty);
    }
    for (index, summary) in summaries.iter().enumerate().skip(empty.first as usize) {
        let area = summary.area.offset(0, down).intersect(grid.window);
        let visited = area.intersect(wanted);
        if visited.is_empty() {
            continue;
        }
        let (all, color) = (grid.columns_of(visited), summary.color);
        let placed = combine(summary.shape, (summary.y + down as f32).to_bits().into());
        if summary.band.is_empty() && summary.uniform.is_empty() && !summary.has_one_color {
            let value = combine(
                combine(placed, pair(area.left, area.right)),
                pair(area.top, area.bottom),
            );
            for row in grid.rows_of(visited) {
                for tile in
                    &mut tiles[row as usize * grid.columns..][all.start as usize..all.end as usize]
                {
                    (tile.hash, tile.is_flat) = (combine(tile.hash, value), false);
                }
            }
            continue;
        }
        let (filled_columns, filled_rows) = grid.inside(summary.uniform.offset(0, down));
        let filled_columns = filled_columns.start.clamp(all.start, all.end)
            ..filled_columns.end.clamp(all.start, all.end);
        for row in grid.rows_of(visited) {
            let (top, bottom) = (
                area.top.max(row * TILE_HEIGHT),
                area.bottom.min((row + 1) * TILE_HEIGHT),
            );
            let is_in_band = summary.band.start <= top - down && bottom - down <= summary.band.end;
            let value = combine(
                if is_in_band {
                    summary.band_shape
                } else {
                    placed
                },
                pair(top, bottom),
            );
            let value = combine(value, pair(area.left, area.right));
            let filled = if filled_rows.contains(&row) {
                filled_columns.clone()
            } else {
                all.end..all.end
            };
            let tiles =
                &mut tiles[row as usize * grid.columns..][all.start as usize..all.end as usize];
            let (before, rest) = tiles.split_at_mut((filled.start - all.start) as usize);
            let (inside, after) = rest.split_at_mut(filled.len());
            for tile in before.iter_mut().chain(after) {
                if tile.is_flat && summary.has_one_color && tile.base == color {
                    tile.first = index as u32 + 1;
                } else {
                    (tile.hash, tile.is_flat) = (combine(tile.hash, value), false);
                }
            }
            if color[3] == 255 {
                inside.fill(Tile::flat(color, index + 1));
                continue;
            }
            for tile in inside {
                if tile.is_flat {
                    *tile = Tile::flat(over(tile.base, color), index + 1);
                } else if color[3] != 0 {
                    tile.hash = combine(tile.hash, u32::from_ne_bytes(color).into());
                }
            }
        }
    }
}

/// The columns of pixels where what is behind may show.
#[cfg(target_os = "macos")]
pub fn see_through(primitives: &[Primitive], all: IntRect) -> Range<i32> {
    let is_opaque = |it: &&Primitive| matches!(it.kind, Kind::Quad { color, .. } if bgra(color, it.opacity)[3] == 255);
    let walls = primitives
        .iter()
        .filter(is_opaque)
        .map(uniform_part)
        .filter(|it| it.top <= all.top && it.bottom >= all.bottom);
    walls.fold(all.left..all.right, |open, wall| {
        match (wall.left <= open.start, wall.right >= open.end) {
            (_, true) => open.start..open.end.min(wall.left).max(open.start),
            (true, _) => open.start.max(wall.right)..open.end,
            _ => open,
        }
    })
}

/// How many are the same at the start, and what is left without them and those that are the same at the end.
fn differing<'a>(
    before: &'a [Summary],
    after: &'a [Summary],
) -> (usize, &'a [Summary], &'a [Summary]) {
    let start = before.iter().zip(after).take_while(|(a, b)| a == b).count();
    let (before, after) = (&before[start..], &after[start..]);
    let end = before
        .iter()
        .rev()
        .zip(after.iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    (
        start,
        &before[..before.len() - end],
        &after[..after.len() - end],
    )
}

/// How far down most of what moved did.
pub(super) fn movement(before: &[Summary], after: &[Summary]) -> Option<i32> {
    const SAMPLES: usize = 12;
    let (_, before, after) = differing(before, after);
    let mut votes: SmallVec<(i32, u32), 32> = SmallVec::new();
    for sample in after
        .iter()
        .step_by(after.len() / SAMPLES + 1)
        .filter(|sample| sample.band.is_empty())
    {
        let same = before
            .iter()
            .filter(|it| it.shape == sample.shape)
            .map(|it| sample.y - it.y);
        let Some(down) = same
            .min_by(|a, b| a.abs().total_cmp(&b.abs()))
            .filter(|down| *down != 0.)
        else {
            continue;
        };
        match votes
            .iter_mut()
            .find(|(candidate, _)| *candidate as f32 == down)
        {
            Some((_, count)) => *count += 1,
            None => votes.push((down as i32, 1)),
        }
    }
    votes
        .into_iter()
        .filter(|(_, count)| *count >= 3)
        .max_by_key(|(_, count)| *count)
        .map(|(down, _)| down)
}

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Action {
    Keep,
    /// From the buffer that is shown.
    #[cfg(any(test, target_os = "macos"))]
    Copy,
    Move,
    Paint,
}

pub(super) struct Plan<'a> {
    pub grid: &'a Grid,
    pub primitives: &'a [Primitive],
    pub summaries: &'a [Summary],
    pub tiles: &'a [Tile],
    pub actions: &'a [Action],
    /// For each row.
    pub has_changes: Vec<bool>,
}

impl Plan<'_> {
    /// `area` is made of whole tiles.
    pub fn paint(&self, band: &mut Band, area: IntRect) {
        let Plan {
            grid,
            tiles,
            actions,
            has_changes,
            ..
        } = self;
        for row in grid.rows_of(area).filter(|row| has_changes[*row as usize]) {
            let (first, columns) = (row as usize * grid.columns, grid.columns_of(area));
            let mut column = columns.start;
            while column < columns.end {
                let (start, base) = (column, tiles[first + column as usize].base);
                let is_same =
                    |tile: usize| actions[tile] == Action::Paint && tiles[tile].base == base;
                column = (start..columns.end)
                    .find(|it| !is_same(first + *it as usize))
                    .unwrap_or(columns.end);
                let rect = grid.rect(row, start..column);
                for y in (rect.top..rect.bottom).filter(|_| start < column) {
                    let span = band.span(y, rect);
                    set_row(&mut band.pixels[span], base);
                }
                column = column.max(start + 1);
            }
        }
        for (index, (primitive, summary)) in self.primitives.iter().zip(self.summaries).enumerate()
        {
            let visible = summary.area.intersect(area);
            if visible.is_empty() {
                continue;
            }
            let is_needed =
                |tile: usize| actions[tile] == Action::Paint && tiles[tile].first <= index as u32;
            for row in grid
                .rows_of(visible)
                .filter(|row| has_changes[*row as usize])
            {
                grid.runs(row, grid.columns_of(visible), is_needed, |run| {
                    band.paint(primitive, run.intersect(visible))
                });
            }
        }
    }
}

#[derive(Default)]
pub struct Compositor {
    pub atlas: Atlas,
    pub primitives: Vec<Primitive>,
    pub(super) shown: Vec<Summary>,
    /// The survey of `shown`.
    pub(super) tiles: Vec<Tile>,
    pub(super) window: IntRect,
    #[cfg(any(test, not(target_os = "macos")))]
    capacity: (usize, usize),
    /// For each tile, a hash of what is in it. The one that is shown comes first.
    #[cfg(any(test, not(target_os = "macos")))]
    buffers: SmallVec<(u64, Vec<u64>), 3>,
}

impl Compositor {
    /// While `window` is that of `shown`.
    pub(super) fn survey(&mut self, summaries: &[Summary], grid: &Grid) -> Vec<Tile> {
        let mut tiles = std::mem::take(&mut self.tiles);
        if self.shown.is_empty()
            || self.window != grid.window
            || tiles.len() != grid.columns * grid.rows_of(grid.window).len()
        {
            return survey(summaries, grid, 0, grid.window);
        }
        let (start, before, after) = differing(&self.shown, summaries);
        let cover = |all: IntRect, it: &Summary| all.union(it.area);
        let changed = match before.len() == after.len() {
            true => before
                .iter()
                .zip(after)
                .filter(|(a, b)| a != b)
                .fold(IntRect::default(), |all, (a, b)| cover(cover(all, a), b)),
            false => before.iter().chain(after).fold(IntRect::default(), cover),
        };
        if before.len() != after.len() {
            let more = (after.len() as u32).wrapping_sub(before.len() as u32);
            tiles
                .iter_mut()
                .filter(|it| it.first as usize > start)
                .for_each(|it| it.first = it.first.wrapping_add(more));
        }
        let changed = changed.intersect(grid.window);
        if !changed.is_empty() {
            let (columns, rows) = (grid.columns_of(changed), grid.rows_of(changed));
            let changed = grid
                .rect(rows.start, columns.clone())
                .union(grid.rect(rows.end - 1, columns));
            survey_again(&mut tiles, summaries, grid, 0, changed);
        }
        tiles
    }

    #[cfg(any(test, not(target_os = "macos")))]
    pub fn paint(&mut self, pixels: Pixels) -> Painted {
        const TILES_PER_THREAD: usize = 2400;
        const MAX_THREADS: usize = 4;
        const WORTH_MOVING: usize = 32;
        const UNKNOWN: u64 = 0;
        let (width, height) = (pixels.width, pixels.data.len() / pixels.width);
        let extent = |shown: i32, tile: i32, limit: usize| {
            ((shown.max(1) + tile - 1) / tile * tile).min(limit as i32)
        };
        let (right, bottom) = pixels.shown;
        let window = IntRect::new(
            0,
            0,
            extent(right, TILE_WIDTH, width),
            extent(bottom, TILE_HEIGHT, height),
        );
        let grid = &Grid {
            window,
            columns: width.div_ceil(TILE_WIDTH as usize),
        };
        let summaries: Vec<_> = self.primitives.iter().map(Summary::of).collect();
        let tiles = self.survey(&summaries, grid);
        let mut hashes: Vec<_> = tiles.iter().map(|tile| tile.hash).collect();
        let hidden = grid.columns_of(window).end as usize..;
        hashes
            .chunks_mut(grid.columns)
            .for_each(|row| row[hidden.clone()].fill(UNKNOWN));
        let before = std::mem::replace(&mut self.window, window);
        if std::mem::replace(&mut self.capacity, (width, height)) != (width, height) {
            self.buffers.clear();
        }
        let known = self.buffers.iter().position(|(id, _)| *id == pixels.id);
        let compare = |buffer: Option<usize>| -> Vec<_> {
            let painted = buffer
                .and_then(|index| self.buffers.get(index))
                .map_or(&[][..], |(_, hashes)| hashes);
            let tiles = hashes.iter().enumerate();
            tiles
                .map(|(tile, it)| {
                    if *it == UNKNOWN || painted.get(tile) == Some(it) {
                        Action::Keep
                    } else {
                        Action::Paint
                    }
                })
                .collect()
        };
        let mut actions = compare(known);
        let count = |actions: &[Action]| actions.iter().filter(|it| **it == Action::Paint).count();
        let can_move = known == Some(0) && count(&actions) >= WORTH_MOVING;
        let down = can_move
            .then(|| movement(&self.shown, &summaries))
            .flatten()
            .unwrap_or(0);
        if down != 0 {
            let changed = grid.around(|tile| actions[tile] == Action::Paint);
            let moved = survey(&self.shown, grid, down, changed);
            for (row, column) in grid
                .rows_of(changed)
                .flat_map(|row| grid.columns_of(changed).map(move |column| (row, column)))
            {
                let tile = row as usize * grid.columns + column as usize;
                // Few large areas are less work for the platform than many small ones.
                let is_worth_it =
                    pixels.platform_moves || actions[tile] == Action::Paint && !tiles[tile].is_flat;
                if is_worth_it
                    && moved[tile].hash == hashes[tile]
                    && before.contains(grid.rect(row, column..column + 1).offset(0, -down))
                {
                    actions[tile] = Action::Move;
                }
            }
        }
        let mut moved = grid.areas(|tile| actions[tile] == Action::Move);
        if down > 0 {
            moved.reverse();
        }
        for area in moved.iter().filter(|_| !pixels.platform_moves) {
            for row in 0..area.height() as i32 {
                let y = if down > 0 {
                    area.bottom - 1 - row
                } else {
                    area.top + row
                };
                let (from, to) = ((y - down) as usize * width, y as usize * width);
                pixels.data.copy_within(
                    from + area.left as usize..from + area.right as usize,
                    to + area.left as usize,
                );
            }
        }

        let (textures, primitives) = (&self.atlas.0.borrow().slots[..], &self.primitives);
        let has_changes = actions
            .chunks(grid.columns)
            .map(|row| row.contains(&Action::Paint))
            .collect();
        let plan = &Plan {
            grid,
            primitives,
            summaries: &summaries,
            tiles: &tiles,
            actions: &actions,
            has_changes,
        };
        let paint_band = |top: i32, pixels: &mut [Pixel]| {
            let rows = IntRect {
                top,
                bottom: top + (pixels.len() / width) as i32,
                ..window
            };
            plan.paint(&mut Band::new(pixels, width, 0, top, textures), rows);
        };
        let threads = count(&actions).div_ceil(TILES_PER_THREAD).min(MAX_THREADS);
        if threads > 0 {
            let rows = grid.rows_of(window).len().div_ceil(threads) * TILE_HEIGHT as usize;
            let mut bands = (0..)
                .step_by(rows)
                .zip(pixels.data[..window.bottom as usize * width].chunks_mut(rows * width));
            std::thread::scope(|scope| {
                let first = bands.next();
                for (top, pixels) in bands {
                    scope.spawn(move || paint_band(top, pixels));
                }
                first
                    .into_iter()
                    .for_each(|(top, pixels)| paint_band(top, pixels));
            });
        }

        if known != Some(0) {
            actions = compare(Some(0));
        }
        let areas = grid.areas(|tile| actions[tile] == Action::Paint);
        self.buffers.retain(|(id, _)| *id != pixels.id);
        self.buffers.truncate(2);
        self.buffers.insert(0, (pixels.id, hashes));
        (self.shown, self.tiles) = (summaries, tiles);
        Painted {
            moved,
            moved_by: down,
            areas,
        }
    }
}
