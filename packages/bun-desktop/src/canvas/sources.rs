//! The glyphs and the images of a batch, for all threads.

use std::ops::Range;

use super::{Placed, gpu};
use crate::abi::{Rect, RoundedRect};
use crate::gfx::Transform;
use crate::hash::FastMap;
use crate::images::{self, Held};
use crate::paint::blend::{Mode, blend};
use crate::paint::cpu::{self, GlyphKey, GlyphPlacer};
use crate::paint::edges::{Edges, Shape};
use crate::paint::raster::{Clip, IntRect, Paint, Pixel, View, map_point, map_rect};
use crate::paint::scan::Scanner;
use crate::paint::scene::{Frame, intersect};
use crate::paint::slant::Slant;
use crate::paint::warp::{Samples, draw_samples, draw_samples_in_slant, draw_upright_samples};
use crate::text::{GlyphPixels, Line};

#[derive(Clone, Copy)]
struct Stamp {
    at: [i32; 2],
    /// In eights of pixels, and in rows.
    size: [u16; 2],
    first: u32,
}

impl Stamp {
    fn rect(self) -> IntRect {
        IntRect::new(
            self.at[0],
            self.at[1],
            self.at[0] + i32::from(self.size[0]) * 8,
            self.at[1] + i32::from(self.size[1]),
        )
    }
}

#[derive(Default)]
pub struct Glyphs {
    /// `None` if it has colors.
    known: FastMap<GlyphKey, Option<Stamp>>,
    masks: Vec<[u8; 8]>,
    stamps: Vec<Stamp>,
}

impl Glyphs {
    pub fn clear(&mut self) {
        const MAX_BYTES: usize = 1 << 20;
        const MAX_COUNT: usize = 1 << 12;
        self.stamps.clear();
        if size_of_val(&self.masks[..]) > MAX_BYTES || self.known.len() > MAX_COUNT {
            *self = Glyphs::default();
        }
    }

    pub fn bytes(&self) -> usize {
        size_of_val(&self.masks[..]) + size_of_val(&self.stamps[..])
    }

    fn keep(masks: &mut Vec<[u8; 8]>, key: GlyphKey) -> Option<Stamp> {
        let Some(image) = cpu::cached_glyph(key).filter(|it| !it.rect.is_empty()) else {
            return Some(Stamp {
                at: [0; 2],
                size: [0; 2],
                first: 0,
            });
        };
        let (GlyphPixels::Mask(mask), first, width) =
            (&image.pixels, masks.len(), image.rect.width())
        else {
            return None;
        };
        for row in mask.chunks_exact(width) {
            let start = masks.len();
            masks.resize(start + width.div_ceil(8), [0; 8]);
            masks[start..].as_flattened_mut()[..width].copy_from_slice(row);
        }
        Some(Stamp {
            at: [image.rect.left, image.rect.top],
            size: [width.div_ceil(8) as u16, image.rect.height() as u16],
            first: first as u32,
        })
    }

    /// Returns which they are, and what is around them.
    pub fn add(
        &mut self,
        line: &Line,
        matrix: &Transform,
        color: u32,
        clip: IntRect,
    ) -> Option<(Range<u32>, IntRect)> {
        const MAX_SIZE: f32 = 128.;
        if !GlyphPlacer::takes(matrix)
            || line.runs.iter().any(|it| it.0.size * matrix.sx > MAX_SIZE)
        {
            return None;
        }
        let (
            Glyphs {
                known,
                masks,
                stamps,
            },
            frame,
            mut bounds,
        ) = (self, Frame::new(1., false), IntRect::default());
        let first = stamps.len();
        for (face, glyphs) in &line.runs {
            let Some(placer) =
                GlyphPlacer::new(&frame, matrix, [0., 0.], face.id, face.size, color)
            else {
                continue;
            };
            let near = clip.outset((face.size * matrix.sx * 3.) as i32 + 2);
            for (key, x, y) in glyphs
                .iter()
                .map(|it| placer.place(it))
                .filter(|(_, x, y)| {
                    (near.left..near.right).contains(x) && (near.top..near.bottom).contains(y)
                })
            {
                let Some(stamp) = *known.entry(key).or_insert_with(|| Self::keep(masks, key))
                else {
                    stamps.truncate(first);
                    return None;
                };
                if stamp.size[0] > 0 {
                    let stamp = Stamp {
                        at: [stamp.at[0] + x, stamp.at[1] + y],
                        ..stamp
                    };
                    bounds = bounds.union(stamp.rect());
                    stamps.push(stamp);
                }
            }
        }
        Some((first as u32..stamps.len() as u32, bounds))
    }

    pub fn paint(&self, which: Range<u32>, color: Pixel, clip: &Clip, on: &mut View) {
        for stamp in &self.stamps[which.start as usize..which.end as usize] {
            on.fill_eights(
                stamp.rect(),
                &self.masks[stamp.first as usize..]
                    [..usize::from(stamp.size[0]) * usize::from(stamp.size[1])],
                clip,
                color,
            );
        }
    }
}

/// A part of an image that is not just copied.
pub struct Picture {
    source: u32,
    part: IntRect,
    /// To the pixels of the part.
    inverse: Transform,
    pub from: Rect,
    pub placement: Transform,
    is_smooth: bool,
    slant: Option<(Slant, [f32; 2])>,
}

impl Picture {
    /// In a clip that is a rectangle.
    pub fn needs_edges(&self, clip: &Clip) -> bool {
        clip.mask.is_some() || self.placement.has_skew() && self.slant.is_none()
    }
}

pub enum Drawn {
    /// The source, where its corner goes, and what is drawn on.
    Copy(u32, [i32; 2], IntRect),
    Picture(u32),
}

#[derive(Default)]
pub struct Images {
    held: Vec<Held>,
    /// Of the images as they were: all together, and the largest one.
    pub bytes: [usize; 2],
    /// By the number of the image and the variant.
    found: FastMap<(u32, u32), Option<u32>>,
    last: Option<((u32, u32), Option<u32>)>,
    /// How often those without pixels were asked for.
    drawings: u32,
    pub pictures: Vec<Picture>,
}

const HAS_MARGIN: u32 = 1 << 30;
const IS_DRAWING: u32 = 1 << 31;

impl Images {
    pub fn clear(&mut self) {
        self.held.clear();
        self.bytes = [0; 2];
        self.pictures.clear();
        self.forget();
    }

    pub fn is_empty(&self) -> bool {
        self.found.is_empty()
    }

    pub fn end_frame(&mut self) {
        self.drawings = 0;
    }

    /// They may have changed.
    pub fn forget(&mut self) {
        self.found.clear();
        self.last = None;
    }

    fn find(&mut self, image: u32, variant: u32, bytes: &mut usize) -> Option<u32> {
        let key = (image, variant);
        if let Some((_, known)) = self.last.filter(|it| it.0 == key) {
            return known;
        }
        let found = *self.found.entry(key).or_insert_with(|| {
            let held = match variant {
                0 => images::hold(image),
                IS_DRAWING.. => {
                    images::hold_drawing(image, (variant >> 12 & 0xFFF, variant & 0xFFF))
                }
                _ => images::hold_with_margin(image, |(width, height)| {
                    (
                        (width >> (variant & 255)).max(1),
                        (height >> (variant >> 8 & 255)).max(1),
                    )
                }),
            }?;
            match variant {
                0 => {
                    self.bytes = [
                        self.bytes[0] + held.bytes(),
                        self.bytes[1].max(held.bytes()),
                    ]
                }
                _ => *bytes += held.bytes(),
            }
            self.held.push(held);
            Some(self.held.len() as u32 - 1)
        });
        self.last = Some((key, found));
        found
    }

    fn size(&self, source: u32, margin: u32) -> [f32; 2] {
        let pixmap = &self.held[source as usize];
        [pixmap.width() - margin, pixmap.height() - margin].map(|it| it as f32)
    }

    /// `bytes` counts what is only kept for this.
    pub fn add(
        &mut self,
        image: u32,
        size: [f32; 2],
        [from, to]: [Rect; 2],
        matrix: &Transform,
        [is_smooth, is_wide]: [bool; 2],
        bytes: &mut usize,
    ) -> Option<Drawn> {
        const MAX_SIDE: f32 = 32000.;
        const FEW_DRAWINGS: u32 = 8;
        let (mut source, mut margin, mut is_smooth) = (self.find(image, 0, bytes), 0, is_smooth);
        if source.is_none() && !is_wide {
            let (pixels, fits) = gpu::pixels_for_drawing(
                &Placed::new(matrix, size, size, from, to).placement,
                size,
            )?;
            self.drawings += 1;
            if fits || self.drawings > FEW_DRAWINGS {
                (source, margin, is_smooth) = (
                    self.find(
                        image,
                        IS_DRAWING | (pixels[0] as u32) << 12 | pixels[1] as u32,
                        bytes,
                    ),
                    1,
                    true,
                );
            }
        }
        let (mut source, pixels) = source.map(|it| (it, self.size(it, margin)))?;
        let Placed {
            from,
            mut part,
            placement,
            shift,
        } = Placed::new(matrix, size, pixels, from, to);
        if from.width.min(from.height) <= 0.01 {
            return None;
        }
        if let Some([x, y]) = shift {
            return Some(Drawn::Copy(source, [x, y], part.offset(x, y)));
        }
        let mut inverse = placement.invert()?;
        let halvings = <[f32; 2]>::from(placement.get_scale())
            .map(|it| gpu::halvings(it) * u32::from(is_smooth));
        if is_smooth
            && margin == 0
            && (halvings != [0; 2]
                || placement.has_skew()
                    && (part.right as f32 >= pixels[0] || part.bottom as f32 >= pixels[1]))
        {
            source = self.find(image, HAS_MARGIN | halvings[0] | halvings[1] << 8, bytes)?;
            let has = self.size(source, 1);
            let [x, y] = [has[0] / pixels[0], has[1] / pixels[1]];
            let slack = |start: f32, length: f32| [start + 0.001, (length - 0.002).max(0.)];
            let ([left, width], [top, height]) = (
                slack(from.x * x, from.width * x),
                slack(from.y * y, from.height * y),
            );
            part = IntRect::around(intersect(
                Rect {
                    x: left,
                    y: top,
                    width,
                    height,
                },
                Rect {
                    x: 0.,
                    y: 0.,
                    width: has[0],
                    height: has[1],
                },
            ));
            inverse = inverse.post_scale(x, y);
        }
        inverse = inverse.post_translate(-part.left as f32, -part.top as f32);
        let reach = map_rect(
            &inverse,
            IntRect::around(map_rect(&placement, from))
                .outset(16)
                .to_rect(),
        );
        let is_near = [
            reach.x,
            reach.y,
            reach.x + reach.width,
            reach.y + reach.height,
        ]
        .iter()
        .all(|it| it.abs() < MAX_SIDE);
        if part.is_empty() || !is_near || pixels[0] > MAX_SIDE {
            return None;
        }
        let slant = (placement.has_skew() && is_smooth)
            .then(|| {
                Slant::of(
                    &RoundedRect {
                        rect: from,
                        ..RoundedRect::default()
                    },
                    &placement,
                )
            })
            .flatten();
        self.pictures.push(Picture {
            source,
            part,
            inverse,
            from,
            placement,
            is_smooth,
            slant,
        });
        Some(Drawn::Picture(self.pictures.len() as u32 - 1))
    }

    pub fn copy(
        &self,
        source: u32,
        [x, y]: [i32; 2],
        area: IntRect,
        by: u8,
        clip: &Clip,
        on: &mut View,
    ) {
        let pixmap = &*self.held[source as usize];
        if clip.mask.is_none() {
            return on.blend(area, pixmap, [x, y], by);
        }
        let copy = |left: i32, top: i32, row: &mut [Pixel]| {
            row.copy_from_slice(
                &pixmap.data().as_chunks().0
                    [(top - y) as usize * pixmap.width() as usize + (left - x) as usize..]
                    [..row.len()],
            );
            super::fade(row, f32::from(by) / 255.);
        };
        on.fill(area, None, clip, &Paint::Shader(&copy));
    }

    pub fn combine(
        &self,
        source: u32,
        [x, y]: [i32; 2],
        area: IntRect,
        by: u8,
        mode: Mode,
        on: &mut View,
    ) {
        let (pixmap, area, mut faded) = (
            &*self.held[source as usize],
            area.intersect(on.rect),
            Vec::new(),
        );
        if area.is_empty() {
            return;
        }
        let pixels = pixmap.data().as_chunks().0
            [(area.top - y) as usize * pixmap.width() as usize..]
            .chunks_exact(pixmap.width() as usize);
        for (row, mut above) in on
            .rows_mut(area)
            .zip(pixels.map(|it| &it[(area.left - x) as usize..][..area.width()]))
        {
            if by != 255 {
                above.clone_into(&mut faded);
                super::fade(&mut faded, f32::from(by) / 255.);
                above = &faded;
            }
            blend(row, above, mode);
        }
    }

    /// The shape is blank if no edges are needed.
    pub fn paint(
        &self,
        picture: u32,
        by: u8,
        clip: &Clip,
        (edges, shape, scanner): (&Edges, &Shape, &mut Scanner),
        on: &mut View,
    ) {
        let picture @ &Picture {
            source,
            part,
            ref inverse,
            from,
            ref placement,
            is_smooth,
            ref slant,
        } = &self.pictures[picture as usize];
        let (pixmap, fixed) = (&*self.held[source as usize], |it: f32| {
            (it * 65536.).round() as i32
        });
        let (width, is_upright) = (pixmap.width() as usize, !placement.has_skew());
        let texels = &pixmap.data().as_chunks().0[part.top as usize * width + part.left as usize..];
        let samples = Samples {
            texels,
            width,
            step: [fixed(inverse.sx), fixed(inverse.ky)],
            last: [part.width(), part.height()].map(|it| (it as i32 - 1) << 16),
        };
        let start = |x: i32, y: i32| {
            let (u, v) = map_point(inverse, x as f32 + 0.5, y as f32 + 0.5);
            [fixed(u), fixed(v)].map(|it| {
                if is_smooth {
                    it - (1 << 15) + (if is_upright { 1 << 7 } else { 1 << 8 })
                } else {
                    it
                }
            })
        };
        let shade = |x: i32, y: i32, row: &mut [Pixel]| {
            if is_smooth {
                row.fill([0; 4]);
                let row = std::iter::once((row, start(x, y)));
                return if is_upright {
                    draw_upright_samples(row, &samples, by)
                } else {
                    draw_samples(row, &samples, by)
                };
            }
            let [mut u, mut v] = start(x, y);
            for pixel in &mut *row {
                *pixel = texels[(v.clamp(0, samples.last[1]) >> 16) as usize * width
                    + (u.clamp(0, samples.last[0]) >> 16) as usize];
                (u, v) = (u + samples.step[0], v + samples.step[1]);
            }
            super::fade(row, f32::from(by) / 255.);
        };
        if picture.needs_edges(clip) {
            return on.fill_shape(edges, shape, scanner, clip, &Paint::Shader(&shade));
        }
        if let Some((slant, [x, y])) = slant {
            let area = on.widened(shape.area, clip.rect);
            let rows = on.rows_mut(area).zip(area.top..).map(|(row, top)| {
                (
                    row,
                    [area.left as f32 + 0.5 - x, top as f32 + 0.5 - y],
                    start(area.left, top),
                )
            });
            return draw_samples_in_slant(rows, slant, &samples, by);
        }
        let (all, area) = (map_rect(placement, from), shape.area.intersect(on.rect));
        // With how much of a pixel is covered, in 256ths.
        let pieces = |start: f32, length: f32| {
            let [start, end] = [start, start + length].map(|it| (it * 256.).round() as i32);
            let (first, last) = ((start + 255) >> 8, end >> 8);
            match first <= last {
                true => [
                    (first - 1, first, (first << 8) - start),
                    (first, last, 256),
                    (last, last + 1, end - (last << 8)),
                ],
                false => [(last, first, end - start), (0, 0, 0), (0, 0, 0)],
            }
        };
        for (top, bottom, down) in pieces(all.y, all.height) {
            for (left, right, across) in pieces(all.x, all.width) {
                let (piece, covered) = (
                    IntRect {
                        left,
                        top,
                        right,
                        bottom,
                    }
                    .intersect(area),
                    (across * down * 255 + (1 << 15)) >> 16,
                );
                if piece.is_empty() || covered == 0 {
                } else if is_smooth {
                    draw_upright_samples(
                        on.rows_mut(piece)
                            .zip(piece.top..)
                            .map(|(row, y)| (row, start(piece.left, y))),
                        &samples,
                        ((covered * i32::from(by) + 127) / 255) as u8,
                    );
                } else {
                    let shape = (covered < 255).then(|| vec![covered as u8; piece.area() as usize]);
                    on.fill(piece, shape.as_deref(), clip, &Paint::Shader(&shade));
                }
            }
        }
    }
}
