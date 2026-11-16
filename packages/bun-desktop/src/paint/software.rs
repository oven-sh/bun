//! Draws what `gpu.rs` made of the scenes: the tiles that changed where there is no GPU, and what has to be read back
//! where there is one.

use std::borrow::Cow;
use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use gpui::embed::{Painted, Pixels};
use gpui::{
    AtlasKey, AtlasTextureId, AtlasTextureKind, AtlasTile, Bounds, DevicePixels, PlatformAtlas,
    Size, TileId, point, size,
};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

use super::arena::{Arena, Block};
use super::gpu::{Kind, Primitive};
use super::raster::{
    IntRect, Layer, Pixel, blend_row, demultiply, fill_row, fill_through, over, premultiply, scale,
    set_row,
};

pub(super) const TILE_WIDTH: i32 = 64;
pub(super) const TILE_HEIGHT: i32 = 16;

#[derive(Default)]
pub(super) struct Texture {
    pub width: usize,
    /// A byte for each pixel of a mask, and premultiplied BGRA otherwise.
    pub block: Option<Block>,
    is_opaque: bool,
    key: Option<AtlasKey>,
    uploaded: Option<AtlasTile>,
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
    tiles: FxHashMap<AtlasKey, AtlasTile>,
    last_id: u32,
    to_unload: Vec<AtlasKey>,
}

#[derive(Default)]
pub struct Atlas(pub(super) RefCell<Textures>);

impl PlatformAtlas for Atlas {
    fn get_or_insert_with<'a>(
        &self,
        key: AtlasKey,
        build: &mut dyn FnMut() -> anyhow::Result<Option<(Size<DevicePixels>, Cow<'a, [u8]>)>>,
    ) -> anyhow::Result<Option<AtlasTile>> {
        let textures = &mut *self.0.borrow_mut();
        if let Some(tile) = textures.tiles.get(&key) {
            return Ok(Some(*tile));
        }
        let Some((extent, data)) = build()? else {
            return Ok(None);
        };
        let kind = key.texture_kind();
        let is_opaque = kind == AtlasTextureKind::Polychrome
            && data.as_chunks::<4>().0.iter().all(|it| it[3] == 255);
        let index = textures.free.pop().unwrap_or_else(|| {
            textures.slots.push(Texture::default());
            textures.slots.len() as u32 - 1
        });
        let (width, block) = (extent.width.0 as usize, Some(textures.arena.store(&data)));
        textures.slots[index as usize] = Texture {
            width,
            block,
            is_opaque,
            key: Some(key.clone()),
            uploaded: None,
        };
        textures.last_id += 1;
        let tile = AtlasTile {
            texture_id: AtlasTextureId { index, kind },
            tile_id: TileId(textures.last_id),
            padding: 0,
            bounds: Bounds::new(Default::default(), extent),
        };
        textures.tiles.insert(key, tile);
        Ok(Some(tile))
    }

    fn remove(&self, key: &AtlasKey) {
        let textures = &mut *self.0.borrow_mut();
        if let Some(tile) = textures.tiles.remove(key) {
            if std::mem::take(&mut textures.slots[tile.texture_id.index as usize])
                .uploaded
                .is_some()
            {
                textures.to_unload.push(key.clone());
            }
            textures.free.push(tile.texture_id.index);
        }
    }
}

impl Atlas {
    /// The same in the atlas of the GPU.
    pub fn uploaded(&self, tile: AtlasTile, gpu: &dyn PlatformAtlas) -> Option<AtlasTile> {
        const MAX_BYTES_KEPT: usize = 256 << 10;
        let texture = &mut self.0.borrow_mut().slots[tile.texture_id.index as usize];
        if texture.uploaded.is_none() {
            let data = texture.block.as_ref().map_or(&[][..], Block::bytes);
            let (mut bytes, mut pixels) = (Cow::Borrowed(data), data.len());
            if tile.texture_id.kind == AtlasTextureKind::Polychrome {
                pixels /= 4;
                if !texture.is_opaque {
                    bytes
                        .to_mut()
                        .as_chunks_mut()
                        .0
                        .iter_mut()
                        .for_each(|pixel| *pixel = demultiply(*pixel));
                }
            }
            let extent = size(
                DevicePixels(texture.width as i32),
                DevicePixels((pixels / texture.width.max(1)) as i32),
            );
            let mut build = || Ok(Some((extent, Cow::Borrowed(&*bytes))));
            texture.uploaded = gpu
                .get_or_insert_with(texture.key.clone()?, &mut build)
                .ok()
                .flatten();
            if texture.uploaded.is_some() && bytes.len() > MAX_BYTES_KEPT {
                (texture.width, texture.block) = (0, None);
            }
        }
        let whole = texture.uploaded?;
        Some(AtlasTile {
            bounds: Bounds::new(whole.bounds.origin + tile.bounds.origin, tile.bounds.size),
            ..whole
        })
    }

    pub fn release_memory(&self) {
        self.0.borrow_mut().arena.release_empty_chunks();
    }

    pub fn unload(&self, gpu: &dyn PlatformAtlas) {
        self.0
            .borrow_mut()
            .to_unload
            .drain(..)
            .for_each(|key| gpu.remove(&key));
    }

    /// What the primitives look like in `area`, at `1 / reduction` of the resolution, unless only the GPU knows.
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
            if let Kind::Mask(tile, _) | Kind::Image(tile) = primitive.kind {
                (textures.slots[tile.texture_id.index as usize].width > 0).then_some(())?;
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

/// `fs_quad` in GPUI's shaders: how much of a pixel is inside of the outer edge, and outside of the inner one.
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
}

fn corner(radius: f32, border: [f32; 2]) -> Rc<Corner> {
    thread_local! {
        static KNOWN: RefCell<FxHashMap<[u32; 3], Rc<Corner>>> = RefCell::default();
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
                Rc::new(Corner {
                    side,
                    pixels: (0..side * side).map(at).collect(),
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
                let Corner { side, pixels } = &*known[index];
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

/// The columns of a row in which `coverage` is the same.
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
            let middle = middle_of_row(primitive, y);
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

    fn image(&mut self, primitive: &Primitive, tile: &AtlasTile, texture: &Texture, area: IntRect) {
        let (bounds, Bounds { origin, size }) = (primitive.bounds, tile.bounds);
        let texels = texture.data().as_chunks::<4>().0;
        let texel_row = |row: u32| &texels[row as usize * texture.width..][..texture.width];
        let column_at = samples(
            origin.x.0,
            size.width.0,
            texture.width,
            bounds.x,
            bounds.width,
        );
        let row_at = samples(
            origin.y.0,
            size.height.0,
            texels.len() / texture.width,
            bounds.y,
            bounds.height,
        );
        let is_aligned = bounds.width == size.width.0 as f32 && bounds.x.fract() == 0.;
        let (opacity, is_shaped) = (alpha(primitive.opacity), is_shaped(primitive));
        let outline = is_shaped.then(|| Outline::of(primitive));
        self.columns.clear();
        if !is_aligned && size.width.0 > 1 {
            self.columns.extend((area.left..area.right).map(&column_at));
        }
        for y in area.top..area.bottom {
            let (above, below, down) = if size.height.0 == 1 {
                (origin.y.0 as u32, 0, 0)
            } else {
                row_at(y)
            };
            let (above, below, span) = (texel_row(above), texel_row(below), self.span(y, area));
            let (row, colors) = (&mut self.pixels[span], &mut self.colors);
            let first = (origin.x.0 + area.left - bounds.x as i32) as usize;
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
            if size.width.0 == 1 && !is_shaped {
                fill_row(row, scale(texel(origin.x.0 as usize), opacity));
                continue;
            }
            colors.clear();
            if is_aligned {
                colors.extend((first..first + row.len()).map(texel));
            } else if size.width.0 == 1 {
                colors.resize(row.len(), texel(origin.x.0 as usize));
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
                let middle = middle_of_row(primitive, y);
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
        let texture = |tile: &AtlasTile| {
            Some(&textures[tile.texture_id.index as usize]).filter(|it| it.width > 0)
        };
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
        let of_tile = |tile: AtlasTile, color: u32| {
            let Bounds { origin, size } = tile.bounds;
            [
                pair(tile.tile_id.0, color),
                pair(origin.x.0, origin.y.0),
                pair(size.width.0, size.height.0),
            ]
        };
        let (bounds, mut band, mut uniform, mut color) =
            (primitive.bounds, 0..0, IntRect::default(), [0; 4]);
        let kind = match primitive.kind {
            Kind::Mask(tile, color) => of_tile(tile, color),
            Kind::Image(tile) => {
                if tile.bounds.size.height.0 == 1 && !is_shaped(primitive) {
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

#[derive(Clone, Copy)]
pub(super) struct Tile {
    pub hash: u64,
    /// The primitives before this one amount to `base`.
    pub first: u32,
    base: Pixel,
    pub is_flat: bool,
}

impl Tile {
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
    let hides_all =
        |it: &Summary| it.color[3] == 255 && it.uniform.offset(0, down).contains(wanted);
    let backdrop = summaries.iter().rposition(hides_all);
    let empty = backdrop.map_or(Tile::flat([0; 4], 0), |index| {
        Tile::flat(summaries[index].color, index + 1)
    });
    let mut tiles = vec![empty; grid.columns * grid.rows_of(grid.window).len()];
    for (index, summary) in summaries.iter().enumerate().skip(empty.first as usize) {
        let area = summary.area.offset(0, down).intersect(grid.window);
        let visited = area.intersect(wanted);
        if visited.is_empty() {
            continue;
        }
        let (filled_columns, filled_rows) = grid.inside(summary.uniform.offset(0, down));
        let (all, color) = (grid.columns_of(visited), summary.color);
        let filled_columns = filled_columns.start.clamp(all.start, all.end)
            ..filled_columns.end.clamp(all.start, all.end);
        let placed = combine(summary.shape, (summary.y + down as f32).to_bits().into());
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
    tiles
}

/// How far down most of what moved did.
pub(super) fn movement(before: &[Summary], after: &[Summary]) -> Option<i32> {
    const SAMPLES: usize = 24;
    let mut votes: SmallVec<[(i32, u32); 32]> = SmallVec::new();
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
    pub(super) window: IntRect,
    capacity: (usize, usize),
    /// For each tile, a hash of what is in it. The one that is shown comes first.
    buffers: SmallVec<[(u64, Vec<u64>); 3]>,
}

impl Compositor {
    pub fn paint(&mut self, pixels: Pixels) -> Painted {
        const TILES_PER_THREAD: usize = 2400;
        const MAX_THREADS: usize = 4;
        const WORTH_MOVING: usize = 32;
        const UNKNOWN: u64 = 0;
        let (width, height) = (pixels.width, pixels.data.len() / pixels.width);
        let extent = |shown: i32, tile: i32, limit: usize| {
            ((shown.max(1) + tile - 1) / tile * tile).min(limit as i32)
        };
        let (right, bottom) = (pixels.shown.width.0, pixels.shown.height.0);
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
        let tiles = survey(&summaries, grid, 0, window);
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
            let changed = grid.areas(|tile| actions[tile] == Action::Paint);
            let changed = changed.into_iter().fold(IntRect::default(), IntRect::union);
            let moved = survey(&self.shown, grid, down, changed);
            for (tile, action) in actions.iter_mut().enumerate() {
                let (row, column) = ((tile / grid.columns) as i32, (tile % grid.columns) as i32);
                let source = || grid.rect(row, column..column + 1).offset(0, -down);
                if *action == Action::Paint
                    && !tiles[tile].is_flat
                    && moved[tile].hash == hashes[tile]
                    && before.contains(source())
                {
                    *action = Action::Move;
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
        let bounds = |it: &IntRect| {
            let extent = size(
                DevicePixels(it.width() as i32),
                DevicePixels(it.height() as i32),
            );
            Bounds::new(point(DevicePixels(it.left), DevicePixels(it.top)), extent)
        };
        let areas = grid
            .areas(|tile| actions[tile] == Action::Paint)
            .iter()
            .map(bounds)
            .collect();
        self.buffers.retain(|(id, _)| *id != pixels.id);
        self.buffers.truncate(2);
        self.buffers.insert(0, (pixels.id, hashes));
        self.shown = summaries;
        Painted {
            moved: moved.iter().map(bounds).collect(),
            moved_by: down,
            areas,
        }
    }
}
