//! Draws what `flatten.rs` made of the scenes: the tiles that changed, and what has to be read back.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use crate::hash::FastMap;
use crate::small_vec::SmallVec;

use super::arena::{Arena, Block};
use super::flatten::{Kind, Primitive, TURNED_EDGE};
use super::raster::{
    IntRect, Layer, Outlined, Pixel, blend_row, blend_rows, fill_outlined, fill_row, fill_rows,
};
use super::raster::{
    fill_rows_through, map_point, over, premultiply, scale, set_rows, swap_red_and_blue,
};
use super::warp::{Samples, draw_samples};
use crate::abi::{Rect, smoothing_of_corners};
use crate::gfx::Transform;
#[cfg(any(test, not(target_os = "macos")))]
use crate::platform::{Painted, Pixels};

/// A part of a texture.
#[derive(Clone, Copy, PartialEq)]
pub struct Sprite {
    pub texture: u32,
    pub is_color: bool,
    /// Another one for each texture that there ever was.
    pub(super) id: u32,
    pub part: IntRect,
}

pub const TILE_WIDTH: i32 = 64;
pub const TILE_HEIGHT: i32 = 16;

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
    bytes: usize,
}

#[derive(Default)]
pub struct Atlas(pub(super) RefCell<Textures>);

impl Atlas {
    pub fn insert(&self, is_color: bool, width: usize, height: usize, data: &[u8]) -> Sprite {
        self.insert_with(is_color, [width, height], data.len(), |to| {
            to.copy_from_slice(data)
        })
    }

    /// `row` has RGBA. The pixels at the edge are repeated `edge` times.
    pub fn insert_rows<'a>(
        &self,
        [width, height]: [usize; 2],
        edge: usize,
        row: impl Fn(usize) -> &'a [Pixel],
    ) -> Sprite {
        let size = [width + edge * 2, height + edge * 2];
        self.insert_with(true, size, size[0] * size[1] * 4, |to| {
            for (y, to) in to.as_chunks_mut().0.chunks_exact_mut(size[0]).enumerate() {
                to[edge..]
                    .iter_mut()
                    .zip(row(y.saturating_sub(edge).min(height - 1)))
                    .for_each(|(to, from)| *to = swap_red_and_blue(*from));
                let ends = [to[edge], to[edge + width - 1]];
                to[..edge].fill(ends[0]);
                to[edge + width..].fill(ends[1]);
            }
        })
    }

    fn insert_with(
        &self,
        is_color: bool,
        [width, height]: [usize; 2],
        len: usize,
        write: impl FnOnce(&mut [u8]),
    ) -> Sprite {
        let textures = &mut *self.0.borrow_mut();
        let block = textures.arena.store(len, write);
        let is_opaque =
            is_color
                && block.bytes().as_chunks::<4>().0.chunks(64).all(|it| {
                    it.iter().fold(!0, |all, it| all & u32::from_le_bytes(*it)) >> 24 == 255
                });
        let texture = textures.free.pop().unwrap_or_else(|| {
            textures.slots.push(Texture::default());
            textures.slots.len() as u32 - 1
        });
        textures.slots[texture as usize] = Texture {
            width,
            block: Some(block),
            is_opaque,
        };
        textures.last_id += 1;
        textures.bytes += len;
        Sprite {
            texture,
            is_color,
            id: textures.last_id,
            part: IntRect::new(0, 0, width as i32, height as i32),
        }
    }

    pub fn remove(&self, sprite: Sprite) {
        let textures = &mut *self.0.borrow_mut();
        textures.bytes -= std::mem::take(&mut textures.slots[sprite.texture as usize])
            .data()
            .len();
        textures.free.push(sprite.texture);
    }

    pub fn is_full(&self) -> bool {
        self.0.borrow().bytes > if cfg!(test) { 64 << 20 } else { 2 << 30 }
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
        gives_up: impl Fn() -> bool,
    ) -> Option<Layer> {
        let (width, height) = (area.width(), area.height());
        let (columns, rows) = (width.div_ceil(reduction), height.div_ceil(reduction));
        let mut layer = Layer::new(IntRect::new(0, 0, columns as i32, rows as i32))?;
        let mut pixels = vec![[0; 4]; width * height];
        let textures = self.0.borrow();
        let (mut band, mut unchecked) = (
            Band::new(&mut pixels, width, area.left, area.top, &textures.slots),
            0,
        );
        for primitive in &primitives[last_to_hide(primitives, area)..] {
            let visible = covered(primitive).intersect(area);
            if visible.is_empty() {
                continue;
            }
            unchecked += visible.area() + 1024;
            if unchecked > 1 << 20 && std::mem::take(&mut unchecked) > 0 && gives_up() {
                return None;
            }
            band.paint(primitive, visible);
        }
        if reduction == 1 {
            layer
                .pixels_mut()
                .iter_mut()
                .zip(pixels)
                .for_each(|(to, from)| *to = swap_red_and_blue(from));
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

/// From the curve of `RoundedRect::smooth_corners`, for a point that is close to it.
fn smooth_distance([x, y]: [f32; 2], radius: f32, smoothing: [f32; 2]) -> f32 {
    let (along, depth, smoothing) = if x <= y {
        (-x, -y, smoothing[0])
    } else {
        (-y, -x, smoothing[1])
    };
    let left = radius * (1. + smoothing) - along;
    if left <= 0. || depth >= radius || radius <= 0. {
        return -depth;
    }
    let ((sin, cos), [u, v]) = (
        (smoothing * std::f32::consts::FRAC_PI_4).sin_cos(),
        [radius - along, radius - depth],
    );
    if u * cos >= v * sin {
        return (u * u + v * v).sqrt() - radius;
    }
    let (near, rest, rise) = (
        radius * (smoothing + sin / (1. + cos)),
        radius * sin * cos / (1. + cos),
        radius * (1. - cos),
    );
    let (at, speed) = (
        |t: f32| near * t * (2. - t) + rest * t * t * t,
        |t: f32| 2. * near * (1. - t) + 3. * rest * t * t,
    );
    let first = 1. - (1. - left / (near + rest)).max(0.).sqrt();
    let t = (0..2).fold(first, |t, _| (t + (left - at(t)) / speed(t)).clamp(0., 1.));
    let slope = 3. * rise * t * t / speed(t);
    (rise * t * t * t + (left - at(t)) * slope - depth) / (1. + slope * slope).sqrt()
}

/// For each corner, of the outer and of the inner edge.
fn smoothing_of(primitive: &Primitive) -> [[[f32; 2]; 2]; 4] {
    if primitive.smoothing == 0. {
        return Default::default();
    }
    let (Rect { width, height, .. }, [a, b, c, d], [top, right, bottom, left]) =
        (primitive.bounds, primitive.radii, border_of(primitive));
    let inner = [
        a - top.max(left),
        b - top.max(right),
        c - bottom.max(right),
        d - bottom.max(left),
    ]
    .map(|it| it.max(0.));
    let outer = smoothing_of_corners([width, height], primitive.radii, primitive.smoothing);
    let inner = smoothing_of_corners(
        [width - left - right, height - top - bottom],
        inner,
        primitive.smoothing,
    );
    [0, 1, 2, 3].map(|it| [outer[it], inner[it]])
}

/// How much of a pixel is inside of the outer edge, and outside of the inner one.
fn coverage(
    from_corner: [f32; 2],
    radius: f32,
    border: [f32; 2],
    smoothing: [[f32; 2]; 2],
) -> [u8; 2] {
    let border = border.map(|width| if width == 0. { -0.5 } else { width });
    if smoothing != [[0.; 2]; 2] {
        let inner = smooth_distance(
            [from_corner[0] + border[0], from_corner[1] + border[1]],
            radius - border[0].max(border[1]),
            smoothing[1],
        );
        return [smooth_distance(from_corner, radius, smoothing[0]), -inner]
            .map(|it| alpha((0.5 - it).clamp(0., 1.)));
    }
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
    [outer, inner].map(|it| alpha((0.5 - it).clamp(0., 1.)))
}

/// `coverage` for the pixels next to a corner. The last row and column go on like that.
struct Corner {
    side: usize,
    /// Each row from the edge inwards, and then back.
    pixels: Vec<[u8; 2]>,
    /// For each row, how many pixels are not like the last one.
    curved: Vec<i32>,
}

impl Corner {
    fn row(&self, index: i32) -> (&[[u8; 2]], i32) {
        let index = (index.max(0) as usize).min(self.side - 1);
        (
            &self.pixels[index * self.side * 2..][..self.side * 2],
            self.curved[index],
        )
    }
}

fn corner(radius: f32, border: [f32; 2], smoothing: [[f32; 2]; 2]) -> Rc<Corner> {
    thread_local! {
        static KNOWN: RefCell<FastMap<[u32; 7], Rc<Corner>>> = RefCell::default();
    }
    KNOWN.with_borrow_mut(|known| {
        if known.len() > 64 {
            known.clear();
        }
        let [[a, b], [c, d]] = smoothing;
        let corner = known
            .entry([radius, border[0], border[1], a, b, c, d].map(f32::to_bits))
            .or_insert_with(|| {
                let side = (radius * (1. + a.max(b).max(c).max(d)))
                    .max(border[0])
                    .max(border[1])
                    .ceil() as usize
                    + 2;
                let at = |column: usize, row: usize| {
                    coverage(
                        [column, row].map(|it| -0.5 - it as f32),
                        radius,
                        border,
                        smoothing,
                    )
                };
                let pixels: Vec<_> = (0..side)
                    .flat_map(|row| {
                        (0..side)
                            .chain((0..side).rev())
                            .map(move |column| at(column, row))
                    })
                    .collect();
                let curved = |row: &[[u8; 2]]| {
                    row[..side]
                        .iter()
                        .rposition(|it| *it != row[side])
                        .map_or(0, |it| it as i32 + 1)
                };
                Rc::new(Corner {
                    side,
                    curved: pixels.chunks(side * 2).map(curved).collect(),
                    pixels,
                })
            });
        corner.clone()
    })
}

struct Outline<'a> {
    primitive: &'a Primitive,
    smoothing: [[[f32; 2]; 2]; 4],
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
        let (borders, smoothing) = (
            [[left, top], [right, top], [right, bottom], [left, bottom]],
            smoothing_of(primitive),
        );
        let corners = (is_aligned && is_small).then(|| {
            let (first, look) = (corner(radii[0], borders[0], smoothing[0]), |it: usize| {
                (radii[it], borders[it], smoothing[it])
            });
            let other = |it: usize| {
                if look(it) == look(0) {
                    first.clone()
                } else {
                    corner(radii[it], borders[it], smoothing[it])
                }
            };
            [0, 1, 2, 3].map(other)
        });
        Outline {
            primitive,
            smoothing,
            corners,
        }
    }

    /// The columns of a row in which `coverage` is the same.
    fn middle(&self, y: i32) -> Range<i32> {
        let Some(known) = &self.corners else {
            return middle_of_row(self.primitive, y);
        };
        let all = IntRect::nearest(self.primitive.bounds);
        let [(_, left), (_, right)] = rows_of_corners(known, all, y);
        all.left + left..all.right - right
    }

    /// Calls `f` with the `coverage` of each of the columns.
    #[inline(always)]
    fn visit(&self, y: i32, columns: impl Iterator<Item = i32>, mut f: impl FnMut(i32, [u8; 2])) {
        let bounds = self.primitive.bounds;
        let half = [bounds.width / 2., bounds.height / 2.];
        let from_center = y as f32 + 0.5 - bounds.y - half[1];
        let (from_edge, corners) = (
            from_center.abs() - half[1],
            if from_center < 0. { [0, 1] } else { [3, 2] },
        );
        if let Some(known) = &self.corners {
            let rows =
                corners.map(|index| &known[index].row(-from_edge as i32).0[..known[index].side]);
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
                    self.smoothing[corner],
                ),
            );
        }
    }
}

/// `Corner::row` on the left and on the right, each of which has half of the width.
fn rows_of_corners(known: &[Rc<Corner>; 4], all: IntRect, y: i32) -> [(&[[u8; 2]], i32); 2] {
    let (below_top, above_bottom, half) =
        (y - all.top, all.bottom - 1 - y, (all.right - all.left) / 2);
    let (row, [left, right]) = if below_top < above_bottom {
        (below_top, [0, 1])
    } else {
        (above_bottom, [3, 2])
    };
    let (left, right) = (known[left].row(row), known[right].row(row));
    [
        (left.0, left.1.min(half)),
        (right.0, right.1.min(all.right - all.left - half)),
    ]
}

/// The columns of a row that are between the corners.
fn middle_of_row(primitive: &Primitive, y: i32) -> Range<i32> {
    let (bounds, [tl, tr, br, bl], [_, right, _, left]) =
        (primitive.bounds, primitive.reach(), border_of(primitive));
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
    let ([tl, tr, br, bl], [top, right, bottom, left]) = (primitive.reach(), border_of(primitive));
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

    fn rows(&mut self, area: IntRect) -> impl Iterator<Item = &mut [Pixel]> {
        let (start, width) = (self.span(area.top, area).start, area.width());
        self.pixels[start..]
            .chunks_mut(self.width)
            .take(area.height())
            .map(move |row| &mut row[..width])
    }

    fn quad(&mut self, primitive: &Primitive, color: Pixel, border_color: Pixel, area: IntRect) {
        if !is_shaped(primitive) {
            return fill_rows(self.rows(area), color);
        }
        let (outline, colors, all) = (
            Outline::of(primitive),
            Outlined::new(color, border_color),
            IntRect::nearest(primitive.bounds),
        );
        let mut straight = IntRect {
            top: area.bottom,
            ..area
        };
        if let Some(known @ [a, b, c, d]) = &outline.corners {
            let top = area.top.max(all.top + a.side.max(b.side) as i32 - 1);
            let between = IntRect {
                top,
                bottom: area.bottom.min(all.bottom - c.side.max(d.side) as i32 + 1),
                ..area
            };
            if !between.is_empty() {
                straight = between;
                let [(left, before), (right, after)] = rows_of_corners(known, all, top);
                let (left, middle, right) = (
                    &left[..before as usize],
                    left[left.len() / 2],
                    &right[right.len() - after as usize..],
                );
                let runs = |it| {
                    <[[u8; 2]]>::chunk_by(it, PartialEq::eq).map(|it| (it.len() as i32, it[0]))
                };
                let mut x = all.left;
                for (length, coverage) in runs(left)
                    .chain([(all.right - all.left - before - after, middle)])
                    .chain(runs(right))
                {
                    let part = IntRect {
                        left: x,
                        right: x + length,
                        ..straight
                    }
                    .intersect(straight);
                    if !part.is_empty() {
                        fill_rows(self.rows(part), colors.at(coverage));
                    }
                    x += length;
                }
            }
        }
        for y in (area.top..straight.top).chain(straight.bottom..area.bottom) {
            let span = self.span(y, area);
            let row = &mut self.pixels[span];
            if let Some(known) = &outline.corners {
                let [(left, before), (right, after)] = rows_of_corners(known, all, y);
                let [start, end] = [all.left + before, all.right - after]
                    .map(|it| it.clamp(area.left, area.right));
                let (first, rest) = row.split_at_mut((start - area.left) as usize);
                let (middle, last) = rest.split_at_mut((end - start) as usize);
                if !first.is_empty() {
                    fill_outlined(first, &colors, &left[(area.left - all.left) as usize..]);
                }
                fill_row(middle, colors.at(left[left.len() / 2]));
                if !last.is_empty() {
                    fill_outlined(
                        last,
                        &colors,
                        &right[right.len() - (all.right - end) as usize..],
                    );
                }
                continue;
            }
            let middle = outline.middle(y);
            let (start, end) = (
                middle.start.clamp(area.left, area.right),
                middle.end.clamp(area.left, area.right),
            );
            outline.visit(
                y,
                (area.left..start).chain(end..area.right),
                |x, coverage| {
                    let pixel = &mut row[(x - area.left) as usize];
                    *pixel = colors.over(*pixel, coverage);
                },
            );
            outline.visit(y, (start..end).take(1), |_, coverage| {
                fill_row(
                    &mut row[(start - area.left) as usize..(end - area.left) as usize],
                    colors.at(coverage),
                );
            });
        }
    }

    fn mask(&mut self, primitive: &Primitive, texture: &Texture, color: Pixel, area: IntRect) {
        let (left, top) = (primitive.bounds.x as i32, primitive.bounds.y as i32);
        let start = (area.top - top) as usize * texture.width + (area.left - left) as usize;
        fill_rows_through(
            self.rows(area)
                .zip(texture.data()[start..].chunks(texture.width)),
            color,
        );
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
        let repeats = part.height() == 1;
        if is_aligned
            && !is_shaped
            && (repeats || bounds.height == part.height() as f32 && bounds.y.fract() == 0.)
        {
            let top = if repeats {
                part.top
            } else {
                part.top + area.top - bounds.y as i32
            };
            let start =
                top as usize * texture.width + (part.left + area.left - bounds.x as i32) as usize;
            let step = if repeats { 0 } else { texture.width };
            let rows = self
                .rows(area)
                .zip((0..).map(|row| &texels[start + row * step..][..area.width()]));
            return match texture.is_opaque && opacity == 255 {
                true => rows.for_each(|(row, colors)| row.copy_from_slice(colors)),
                false => blend_rows(rows, opacity),
            };
        }
        let step = [
            part.width() as f32 / bounds.width,
            part.height() as f32 / bounds.height,
        ];
        let (rows, fixed) = (texels.len() / texture.width, |it: f32| (it * 65536.) as i32);
        if !is_aligned
            && !is_shaped
            && step.iter().all(|it| (0.5..=2.).contains(it))
            && texture.width.max(rows) < 1 << 15
            && texture.width.min(rows) > 1
        {
            let at = |first: i32, pixel: i32, start: f32, step: f32| {
                fixed(first as f32 + (pixel as f32 + 0.5 - start) * step - 0.5) + (1 << 9)
            };
            let left = at(part.left, area.left, bounds.x, step[0]);
            let last = [texture.width, rows].map(|it| ((it as i32 - 1) << 16) - 1);
            let rows = self
                .rows(area)
                .zip(area.top..)
                .map(|(row, y)| (row, [left, at(part.top, y, bounds.y, step[1])]));
            return draw_samples(
                rows,
                &Samples {
                    texels,
                    width: texture.width,
                    step: [fixed(step[0]), 0],
                    last,
                },
                opacity,
            );
        }
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
                    |x, [outer, _]| {
                        let color = &mut colors[(x - area.left) as usize];
                        *color = scale(*color, outer);
                    },
                );
                outline.visit(y, (start..end).take(1), |_, [outer, _]| {
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

    fn turned(&mut self, texture: &Texture, to_texels: &Transform, opacity: u8, area: IntRect) {
        let texels = texture.data().as_chunks::<4>().0;
        let last =
            [texture.width, texels.len() / texture.width.max(1)].map(|it| it as i32 - TURNED_EDGE);
        if last[0].min(last[1]) <= 0 {
            return;
        }
        let (steps, fixed) = ([to_texels.sx, to_texels.ky], |it: f32| (it * 65536.) as i32);
        let (per_step, width) = (
            steps.map(|it| 1. / if it == 0. { 1e-9 } else { it }),
            area.width() as f32,
        );
        let rows = self.rows(area).zip(area.top..).filter_map(|(row, y)| {
            let (u, v) = map_point(to_texels, area.left as f32 + 0.5, y as f32 + 0.5);
            let first = [u - 0.5, v - 0.5];
            let [across, down] = [0, 1].map(|axis| {
                [-first[axis], last[axis] as f32 - first[axis]].map(|it| it * per_step[axis])
            });
            let start = across[0]
                .min(across[1])
                .max(down[0].min(down[1]))
                .clamp(0., width) as usize;
            let end = across[0]
                .max(across[1])
                .min(down[0].max(down[1]))
                .ceil()
                .clamp(0., width) as usize;
            let [u, v] = [0, 1].map(|axis| fixed(first[axis] + steps[axis] * start as f32));
            Some((row.get_mut(start..end)?, [u.saturating_add(1 << 9), v]))
        });
        draw_samples(
            rows,
            &Samples {
                texels,
                width: texture.width,
                step: steps.map(fixed),
                last: last.map(|it| it << 16),
            },
            opacity,
        );
    }

    fn paint(&mut self, primitive: &Primitive, area: IntRect) {
        if area.is_empty() {
            return;
        }
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
            Kind::Turned {
                texture, to_texels, ..
            } => self.turned(
                &textures[*texture as usize],
                to_texels,
                alpha(primitive.opacity),
                area,
            ),
            Kind::Pending(_) => {}
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

const NOWHERE: [i32; 2] = [i32::MAX, i32::MIN];
const EVERYWHERE: [i32; 2] = [i32::MIN, i32::MAX];

fn between_edges(primitive: &Primitive) -> [[i32; 2]; 2] {
    let (bounds, [tl, tr, br, bl], [top, right, bottom, left]) =
        (primitive.bounds, primitive.reach(), border_of(primitive));
    let between = |start: f32, length: f32, first: f32, second: f32| match (first.max(second) + 2.)
        * 2.
        < length
    {
        true => [
            ((start + first).ceil() as i32).saturating_add(1),
            ((start + length - second).floor() as i32).saturating_sub(1),
        ],
        false => NOWHERE,
    };
    [
        between(
            bounds.x,
            bounds.width,
            left.max(tl).max(bl),
            right.max(tr).max(br),
        ),
        between(
            bounds.y,
            bounds.height,
            top.max(tl).max(tr),
            bottom.max(bl).max(br),
        ),
    ]
}

/// What is needed of a primitive to tell whether a tile has changed.
#[derive(Clone, PartialEq)]
pub(super) struct Summary {
    pub area: IntRect,
    y: f32,
    /// Of all that does not change when it moves up or down.
    shape: u64,
    /// Of all that does not change with the bounds.
    look: u64,
    /// The left and the right edge, and the height.
    extent: [f32; 3],
    /// For the columns and for the rows: from where the first edge, and up to where the second one makes no difference.
    free: [[i32; 2]; 2],
    uniform: IntRect,
    color: Pixel,
    /// It does not show on top of `color`.
    has_one_color: bool,
}

impl Summary {
    fn hides(&self, area: IntRect) -> bool {
        self.color[3] == 255 && self.uniform.contains(area)
    }

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
        let (bounds, mut free, mut uniform, mut color) =
            (primitive.bounds, [NOWHERE; 2], IntRect::default(), [0; 4]);
        let kind = match primitive.kind {
            Kind::Pending(_) => [0; 3],
            Kind::Mask(tile, color) => of_tile(tile, color),
            Kind::Image(tile) => {
                let is_shaped = is_shaped(primitive);
                free = [tile.part.width(), tile.part.height()].map(|it| {
                    if it == 1 && !is_shaped {
                        EVERYWHERE
                    } else {
                        NOWHERE
                    }
                });
                of_tile(tile, 0)
            }
            Kind::Turned {
                id, to_texels: it, ..
            } => {
                let [a, b] = floats([it.sx, it.ky, it.kx, it.sy]);
                [
                    combine(a, id.into()),
                    b,
                    pair(it.tx.to_bits(), it.ty.to_bits()),
                ]
            }
            Kind::Quad {
                color: fill,
                border_color,
                border,
            } => {
                (uniform, color) = (uniform_part(primitive), bgra(fill, primitive.opacity));
                free = if is_shaped(primitive) {
                    between_edges(primitive)
                } else {
                    [EVERYWHERE; 2]
                };
                let [a, b] = floats(border);
                [pair(fill, border_color), a, !b]
            }
        };
        let look = kind.into_iter().chain(floats(primitive.radii)).fold(
            pair(primitive.smoothing.to_bits(), primitive.opacity.to_bits()),
            combine,
        );
        let shape = combine(
            look ^ u64::from(bounds.height.to_bits()),
            pair(bounds.x.to_bits(), bounds.width.to_bits()),
        );
        let extent = [bounds.x, bounds.x + bounds.width, bounds.height];
        Summary {
            area: covered(primitive),
            y: bounds.y,
            shape,
            look,
            extent,
            free,
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
        self.areas_in(self.rows_of(self.window), is_included)
    }

    fn areas_in(
        &self,
        rows: impl Iterator<Item = i32>,
        is_included: impl Fn(usize) -> bool,
    ) -> Vec<IntRect> {
        let mut areas: Vec<IntRect> = Vec::new();
        for row in rows {
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

pub(super) fn tiles_in(grid: &Grid, area: IntRect) -> impl Iterator<Item = usize> {
    let columns = grid.columns_of(area);
    grid.rows_of(area).flat_map(move |row| {
        columns
            .clone()
            .map(move |column| row as usize * grid.columns + column as usize)
    })
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
    let backdrop = summaries
        .iter()
        .rposition(|it| it.hides(wanted.offset(0, -down)));
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
        let y = summary.y + down as f32;
        if summary.free == [NOWHERE; 2] && summary.uniform.is_empty() && !summary.has_one_color {
            let placed = combine(summary.shape, y.to_bits().into());
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
        let edges = |free: [i32; 2], [first, second]: [f32; 2], start: i32, end: i32| {
            pair(
                if start < free[0] {
                    first.to_bits()
                } else {
                    u32::MAX
                },
                if end > free[1] {
                    second.to_bits()
                } else {
                    u32::MAX
                },
            )
        };
        let ([columns, rows], [left, right, height]) = (summary.free, summary.extent);
        let same = (area.left.max(columns[0]), area.right.min(columns[1]));
        for row in grid.rows_of(visited) {
            let (top, bottom) = (
                area.top.max(row * TILE_HEIGHT),
                area.bottom.min((row + 1) * TILE_HEIGHT),
            );
            let value = combine(
                combine(
                    summary.look,
                    edges(rows, [y, y + height], top - down, bottom - down),
                ),
                pair(top, bottom),
            );
            let filled = if filled_rows.contains(&row) {
                filled_columns.clone()
            } else {
                all.end..all.end
            };
            let tiles =
                &mut tiles[row as usize * grid.columns..][all.start as usize..all.end as usize];
            let (before, rest) = tiles.split_at_mut((filled.start - all.start) as usize);
            let (inside, after) = rest.split_at_mut(filled.len());
            for (column, tile) in (all.start..).zip(before).chain((filled.end..).zip(after)) {
                let (start, end) = (column * TILE_WIDTH, (column + 1) * TILE_WIDTH);
                if tile.is_flat && summary.has_one_color && tile.base == color {
                    tile.first = index as u32 + 1;
                } else if same.0 <= start && end <= same.1 {
                    (tile.hash, tile.is_flat) = (combine(tile.hash, value), false);
                } else {
                    let (start, end) = (area.left.max(start), area.right.min(end));
                    let value = combine(
                        combine(value, edges(columns, [left, right], start, end)),
                        pair(start, end),
                    );
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
        .filter(|sample| sample.free[1] == NOWHERE)
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
    #[cfg(any(test, not(target_os = "macos")))]
    fn areas(&self) -> Vec<IntRect> {
        let rows = self
            .grid
            .rows_of(self.grid.window)
            .filter(|row| self.has_changes[*row as usize]);
        self.grid
            .areas_in(rows, |tile| self.actions[tile] == Action::Paint)
    }

    fn clear(&self, band: &mut Band, rows: Range<i32>, columns: &Range<i32>) {
        let Plan {
            grid,
            tiles,
            actions,
            has_changes,
            ..
        } = self;
        for row in rows.filter(|row| has_changes[*row as usize]) {
            let (first, mut column) = (row as usize * grid.columns, columns.start);
            while column < columns.end {
                let (start, base) = (column, tiles[first + column as usize].base);
                let is_same =
                    |tile: usize| actions[tile] == Action::Paint && tiles[tile].base == base;
                column = (start..columns.end)
                    .find(|it| !is_same(first + *it as usize))
                    .unwrap_or(columns.end);
                if start < column {
                    set_rows(band.rows(grid.rect(row, start..column)), base);
                }
                column = column.max(start + 1);
            }
        }
    }

    /// `area` is made of whole tiles.
    pub fn paint(&self, band: &mut Band, area: IntRect) {
        let Plan {
            grid,
            tiles,
            actions,
            has_changes,
            ..
        } = self;
        let (mut uncleared, columns) = (grid.rows_of(area), grid.columns_of(area));
        for (index, (primitive, summary)) in self.primitives.iter().zip(self.summaries).enumerate()
        {
            let visible = summary.area.intersect(area);
            if visible.is_empty() {
                continue;
            }
            let is_needed =
                |tile: usize| actions[tile] == Action::Paint && tiles[tile].first <= index as u32;
            let mut above = IntRect::default();
            for row in grid
                .rows_of(visible)
                .filter(|row| has_changes[*row as usize])
            {
                grid.runs(row, grid.columns_of(visible), is_needed, |run| {
                    if (above.left, above.right, above.bottom) == (run.left, run.right, run.top) {
                        above.bottom = run.bottom;
                    } else {
                        band.paint(
                            primitive,
                            std::mem::replace(&mut above, run).intersect(visible),
                        );
                    }
                    // As late as possible, for the pixels to be in the cache when they are painted over.
                    if row >= uncleared.start {
                        self.clear(
                            band,
                            std::mem::replace(&mut uncleared.start, row + 1)..row + 1,
                            &columns,
                        );
                    }
                });
            }
            band.paint(primitive, above.intersect(visible));
        }
        self.clear(band, uncleared, &columns);
    }
}

#[derive(Default)]
pub struct Compositor {
    pub atlas: Atlas,
    pub primitives: Vec<Primitive>,
    pub(super) shown: Vec<Summary>,
    /// What `shown` was made of, unless it is empty.
    summarized: Vec<Primitive>,
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
    pub(super) fn summarize(&self) -> Vec<Summary> {
        let (known, shown) = (&self.summarized, &self.shown);
        let more = known.len().wrapping_sub(self.primitives.len());
        let find = |index: usize, it: &Primitive| {
            known
                .get(index)
                .filter(|known| known.looks_like(it))
                .and(shown.get(index))
        };
        let of = |(index, it): (usize, _)| {
            find(index, it)
                .or_else(|| find(index.wrapping_add(more), it))
                .map_or_else(|| Summary::of(it), Summary::clone)
        };
        self.primitives.iter().enumerate().map(of).collect()
    }

    pub(super) fn show(&mut self, summaries: Vec<Summary>) {
        self.summarized.clone_from(&self.primitives);
        self.shown = summaries;
    }

    /// While `window` is that of `shown`. With the area outside of which the tiles are as they were.
    pub(super) fn survey(&mut self, summaries: &[Summary], grid: &Grid) -> (Vec<Tile>, IntRect) {
        let mut tiles = std::mem::take(&mut self.tiles);
        if self.shown.is_empty()
            || self.window != grid.window
            || tiles.len() != grid.columns * grid.rows_of(grid.window).len()
        {
            return (survey(summaries, grid, 0, grid.window), grid.window);
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
        (tiles, changed)
    }

    #[cfg(any(test, not(target_os = "macos")))]
    pub fn paint(&mut self, pixels: Pixels) -> Painted {
        const WORK_PER_THREAD: i64 = 2400 << 10;
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
        let summaries = self.summarize();
        let (tiles, surveyed) = self.survey(&summaries, grid);
        let before = std::mem::replace(&mut self.window, window);
        if std::mem::replace(&mut self.capacity, (width, height)) != (width, height) {
            self.buffers.clear();
        }
        let known = self.buffers.iter().position(|(id, _)| *id == pixels.id);
        let (mut hashes, mut found) = (Vec::new(), None);
        if known == Some(0) && surveyed != window {
            hashes = std::mem::take(&mut self.buffers[0].1);
            let actions = found.insert(vec![Action::Keep; hashes.len()]);
            for tile in tiles_in(grid, surveyed) {
                if std::mem::replace(&mut hashes[tile], tiles[tile].hash) != tiles[tile].hash {
                    actions[tile] = Action::Paint;
                }
            }
        } else {
            hashes.extend(tiles.iter().map(|tile| tile.hash));
            let hidden = grid.columns_of(window).end as usize..;
            hashes
                .chunks_mut(grid.columns)
                .for_each(|row| row[hidden.clone()].fill(UNKNOWN));
        }
        let rows = match (&found, grid.rows_of(surveyed)) {
            (None, _) => 0..hashes.len(),
            (Some(_), _) if surveyed.is_empty() => 0..0,
            (Some(_), rows) => rows.start as usize * grid.columns..rows.end as usize * grid.columns,
        };
        let compare = |buffer: Option<usize>| -> Vec<_> {
            let painted = buffer
                .and_then(|index| self.buffers.get(index))
                .map_or(&[][..], |(_, hashes)| hashes);
            let (mut actions, mut painted) = (
                vec![Action::Keep; hashes.len()],
                painted.chunks(grid.columns),
            );
            for (actions, row) in actions
                .chunks_mut(grid.columns)
                .zip(hashes.chunks(grid.columns))
            {
                let painted = painted.next().unwrap_or_default();
                if row == painted {
                    continue;
                }
                for (tile, action) in actions.iter_mut().enumerate() {
                    *action = if row[tile] == UNKNOWN || painted.get(tile) == Some(&row[tile]) {
                        Action::Keep
                    } else {
                        Action::Paint
                    };
                }
            }
            actions
        };
        let mut actions = found.unwrap_or_else(|| compare(known));
        let count = |actions: &[Action]| {
            actions[rows.clone()]
                .iter()
                .filter(|it| **it == Action::Paint)
                .count()
        };
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
        let mut moved = if down == 0 {
            Vec::new()
        } else {
            grid.areas(|tile| actions[tile] == Action::Move)
        };
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

        let (atlas, primitives) = (self.atlas.0.borrow(), &self.primitives);
        let textures = &atlas.slots[..];
        let has_changes = (0..)
            .step_by(grid.columns)
            .zip(actions.chunks(grid.columns))
            .map(|(first, row)| rows.contains(&first) && row.contains(&Action::Paint))
            .collect();
        let plan = &Plan {
            grid,
            primitives,
            summaries: &summaries,
            tiles: &tiles,
            actions: &actions,
            has_changes,
        };
        let mut areas = plan.areas();
        let changed = areas
            .iter()
            .fold(IntRect::default(), |all, it| all.union(*it));
        let paint_band = |top: i32, pixels: &mut [Pixel]| {
            let rows = IntRect {
                top,
                bottom: top + (pixels.len() / width) as i32,
                ..window
            }
            .intersect(changed);
            if !rows.is_empty() {
                plan.paint(&mut Band::new(pixels, width, 0, top, textures), rows);
            }
        };
        let work_for = |(primitive, summary): (&Primitive, &Summary)| match primitive.kind {
            Kind::Quad { .. } | Kind::Pending(_) => 0,
            Kind::Mask(..) | Kind::Image(_) => summary.area.intersect(changed).area() * 2,
            Kind::Turned { .. } => summary.area.intersect(changed).area() * 8,
        };
        let painted = count(&actions) as i64 * i64::from(TILE_WIDTH * TILE_HEIGHT);
        let work = painted
            + primitives.iter().zip(&summaries).map(work_for).sum::<i64>() * painted
                / changed.area().max(1);
        if work <= WORK_PER_THREAD {
            paint_band(0, pixels.data);
        } else {
            let bands =
                (work / WORK_PER_THREAD + 1).min(crate::parallel::threads() as i64 * 3) as usize;
            let rows = grid.rows_of(changed).len().div_ceil(bands) * TILE_HEIGHT as usize;
            let bands = pixels.data[changed.top as usize * width..changed.bottom as usize * width]
                .chunks_mut(rows * width)
                .enumerate();
            crate::parallel::for_each(bands, |(index, pixels)| {
                paint_band(changed.top + (index * rows) as i32, pixels)
            });
        }

        if known != Some(0) {
            let actions = compare(Some(0));
            areas = grid.areas(|tile| actions[tile] == Action::Paint);
        }
        drop(atlas);
        self.buffers.retain(|(id, _)| *id != pixels.id);
        self.buffers.truncate(2);
        self.buffers.insert(0, (pixels.id, hashes));
        self.show(summaries);
        self.tiles = tiles;
        Painted {
            moved,
            moved_by: down,
            areas,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quarter_turn_moves_whole_pixels() {
        let texel = |x: u8, y: u8| {
            if (2..14).contains(&x) && (2..4).contains(&y) {
                [x, 0, x, 200 + y]
            } else {
                [0; 4]
            }
        };
        let (atlas, area) = (Atlas::default(), IntRect::new(0, 0, 6, 16));
        let tile = atlas.insert(
            true,
            16,
            6,
            &(0..96)
                .flat_map(|it| texel(it % 16, it / 16))
                .collect::<Vec<_>>(),
        );
        let kind = Kind::Turned {
            texture: tile.texture,
            id: tile.id,
            to_texels: Transform::from_row(0., -1., 1., 0., 0., 6.),
        };
        let shown = atlas
            .snapshot(
                &[Primitive::new(area.to_rect(), area, kind)],
                area,
                1,
                || false,
            )
            .unwrap();
        assert_eq!(
            shown.pixels(),
            (0..96)
                .map(|it| texel(it / 6, 5 - it % 6))
                .collect::<Vec<_>>()
        );
    }
}
