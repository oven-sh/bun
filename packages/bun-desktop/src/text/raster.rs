use std::cell::Cell;
use std::sync::OnceLock;

use super::fonts::Face;
use super::hint;
pub use super::hint::release_memory;
use super::sfnt::bitmap::{self, Bitmap, Pixels};
use super::sfnt::color::{self, Drawing, Shape, Stop};
use super::sfnt::work;
use crate::abi::{GradientStop, Rect, RoundedRect};
use crate::gfx::{self, Fill, Pixmap, Stroke, Transform};
use crate::images;
use crate::paint::edges;
use crate::paint::gradient::{Geometry, Gradient, Spread};
use crate::paint::raster::{
    Clip, Coverage, IntRect, Layer, Paint, Path, average_scale, map_rect, premultiply,
};

const SKEW: f32 = 0.25;
/// Those of Skia in Chromium.
const GAMMA: f32 = if cfg!(target_os = "windows") {
    2.2
} else {
    1.2
};
const CONTRAST: f32 = if cfg!(target_os = "windows") {
    0.5
} else {
    0.2
};
const MAX_GLYPH_PIXELS: i64 = 1 << 24;

pub enum GlyphPixels {
    Mask(Vec<u8>),
    Color(Layer),
}

pub struct GlyphImage {
    /// Relative to the pixel that the glyph's origin is in.
    pub rect: IntRect,
    pub pixels: GlyphPixels,
}

/// With y up.
fn outline(face: &Face, glyph: u32, scale: f32) -> Path {
    #[cfg(target_os = "macos")]
    if let Some(native) = face.file.native.as_ref().filter(|_| !face.file.has_color) {
        let mut path = Path::new();
        native.outline(glyph, scale, &mut path);
        return path;
    }
    face.file
        .font
        .outline(glyph, face.coords, scale)
        .unwrap_or_default()
}

fn flip(face: &Face) -> Transform {
    Transform::from_row(1., 0., if face.skew { SKEW } else { 0. }, -1., 0., 0.)
}

/// With y down and the origin on the baseline.
pub fn glyph_path(face: &Face, glyph: u32, size: f32) -> Path {
    let flip = flip(face);
    let path = outline(
        face,
        glyph,
        (size * 64.).trunc() / 64. / face.units_per_em(),
    );
    path.iter()
        .map(|command| command.transform(&flip))
        .collect()
}

/// The stroke that Skia adds to an outline.
fn embolden_width(size: f32) -> f32 {
    let progress = ((size - 9.) / (36. - 9.)).clamp(0., 1.);
    size * (1. / 24. + (1. / 32. - 1. / 24.) * progress)
}

fn device_bounds(bounds: Rect, matrix: &Transform) -> Option<IntRect> {
    Some(IntRect::around(map_rect(matrix, bounds)))
        .filter(|rect| (1..MAX_GLYPH_PIXELS).contains(&rect.area()))
}

fn path_bounds(path: &Path, outset: f32) -> Rect {
    crate::paint::scene::outset(gfx::bounds(path), outset)
}

fn rasterize_bitmap(bitmap: Bitmap, size: f32, matrix: &Transform) -> Option<GlyphImage> {
    let pixmap = match bitmap.pixels {
        Pixels::Png(png) => images::decode_pixmap(png)?,
        Pixels::Bgra(bgra) => {
            let rgba = bgra
                .as_chunks()
                .0
                .iter()
                .flat_map(|[b, g, r, a]| [*r, *g, *b, *a]);
            Pixmap::from_vec(rgba.collect(), bitmap.size[0], bitmap.size[1])?
        }
    };
    let (width, height) = (bitmap.bounds.width * size, bitmap.bounds.height * size);
    let bounds = Rect {
        x: bitmap.bounds.x * size,
        y: bitmap.bounds.y * size,
        width,
        height,
    };
    let device_scale = average_scale(matrix);
    let reduced = images::reduce(&pixmap, width * device_scale, height * device_scale);
    let pixmap = reduced.as_ref().unwrap_or(&pixmap);
    let mut layer = Layer::new(device_bounds(bounds, matrix)?)?;
    crate::paint::cpu::draw_pixmap(&mut layer, pixmap, bounds, matrix, true);
    Some(GlyphImage {
        rect: layer.rect,
        pixels: GlyphPixels::Color(layer),
    })
}

struct ColorGlyphPainter<'a> {
    face: &'a Face,
    foreground: u32,
    matrices: Vec<Transform>,
    clips: Vec<Clip>,
    layers: Vec<Layer>,
}

impl ColorGlyphPainter<'_> {
    fn color(&self, index: u16, alpha: f32) -> u32 {
        let [r, g, b, a] = self
            .face
            .palette_color(index)
            .unwrap_or(self.foreground.to_be_bytes());
        u32::from_be_bytes([r, g, b, (f32::from(a) * alpha).round() as u8])
    }

    fn matrix(&self) -> Transform {
        self.matrices.last().copied().unwrap_or_default()
    }

    fn spend(&self) {
        work::spend(
            self.layers
                .last()
                .map_or(0, |it| it.rect.width() * it.rect.height() / 64),
        );
    }

    fn push_clip(&mut self, coverage: impl FnOnce(&Transform, IntRect) -> Coverage) {
        self.spend();
        let clip = self.clips.last().cloned().unwrap_or_default();
        self.clips
            .push(clip.within(coverage(&self.matrix(), clip.rect)));
    }
}

impl color::Painter for ColorGlyphPainter<'_> {
    fn push_transform(&mut self, by: Transform) {
        self.matrices.push(self.matrix().pre_concat(by));
    }

    fn pop_transform(&mut self) {
        self.matrices.pop();
    }

    fn push_clip_glyph(&mut self, glyph: u32) {
        let path = outline(self.face, glyph, 1.);
        self.push_clip(|matrix, area| Coverage::of_path(&path, Fill::NonZero, matrix, area));
    }

    fn push_clip_box(&mut self, rect: Rect) {
        let shape = RoundedRect {
            rect,
            ..RoundedRect::default()
        };
        self.push_clip(|matrix, area| Coverage::of_shape(&shape, matrix, area));
    }

    fn pop_clip(&mut self) {
        self.clips.pop();
    }

    fn fill(&mut self, color: u16, alpha: f32) {
        self.spend();
        let paint = Paint::Solid(premultiply(self.color(color, alpha)));
        if let (Some(layer), Some(clip)) = (self.layers.last_mut(), self.clips.last()) {
            layer.fill(clip.rect, None, clip, &paint);
        }
    }

    fn fill_gradient(&mut self, shape: Shape, stops: &[Stop], extend: u8) {
        self.spend();
        let geometry = match shape {
            Shape::Linear([from, to]) => Geometry::Linear {
                from: [from.x, from.y],
                to: [to.x, to.y],
            },
            Shape::Radial([(a, from), (b, to)]) => Geometry::Radial {
                from: [a.x, a.y, from],
                to: [b.x, b.y, to],
            },
            Shape::Sweep(center, [start, end]) => Geometry::Sweep {
                center: [center.x, center.y],
                start: start.min(end),
                span: (end - start).abs(),
            },
        };
        let stop = |it: &Stop| GradientStop {
            offset: it.offset,
            color: self.color(it.color, it.alpha),
        };
        let mut stops: Vec<_> = stops.iter().map(stop).collect();
        if matches!(shape, Shape::Sweep(_, [start, end]) if end < start) {
            stops.reverse();
            stops
                .iter_mut()
                .for_each(|stop| stop.offset = 1. - stop.offset);
        }
        let spread = match extend {
            1 => Spread::Repeat,
            2 => Spread::Reflect,
            _ => Spread::Pad,
        };
        let gradient = Gradient::new(geometry, &stops, spread, true);
        let inverse = self.matrix().invert();
        if let (Some(layer), Some(clip), Some(inverse)) =
            (self.layers.last_mut(), self.clips.last(), inverse)
        {
            layer.fill(
                clip.rect,
                None,
                clip,
                &Paint::Shader(&|x, y, row| gradient.shade(&inverse, x, y, row)),
            );
        }
    }

    fn push_layer(&mut self) {
        self.spend();
        self.layers.extend(Layer::new(self.layers[0].rect));
    }

    fn pop_layer(&mut self, mode: u8) {
        use crate::paint::blend::Mode::{self, *};
        const MODES: [Mode; 28] = [
            Clear,
            Source,
            Destination,
            SourceOver,
            DestinationOver,
            SourceIn,
            DestinationIn,
            SourceOut,
            DestinationOut,
            SourceAtop,
            DestinationAtop,
            Xor,
            Plus,
            Screen,
            Overlay,
            Darken,
            Lighten,
            ColorDodge,
            ColorBurn,
            HardLight,
            SoftLight,
            Difference,
            Exclusion,
            Multiply,
            Hue,
            Saturation,
            Color,
            Luminosity,
        ];
        let mode = *MODES.get(usize::from(mode)).unwrap_or(&SourceOver);
        if self.layers.len() > 1
            && let Some(layer) = self.layers.pop()
            && let (Some(below), Some(clip)) = (self.layers.last_mut(), self.clips.last())
        {
            below.draw_with_mode(&layer, mode, clip);
        }
    }
}

fn rasterize_color(
    face: &Face,
    glyph: u32,
    size: f32,
    matrix: &Transform,
    foreground: u32,
) -> Option<GlyphImage> {
    let font = &face.file.font;
    let Some(drawing) = Drawing::new(font, glyph, face.coords) else {
        #[cfg(target_os = "macos")]
        if let Some(native) = &face.file.native
            && (matrix.kx, matrix.ky, matrix.sx) == (0., 0., matrix.sy)
            && let Some(layer) = native.draw(glyph, size * matrix.sx, matrix.tx, matrix.ty)
        {
            return Some(GlyphImage {
                rect: layer.rect,
                pixels: GlyphPixels::Color(layer),
            });
        }
        return rasterize_bitmap(
            bitmap::find(font, glyph, size * average_scale(matrix))?,
            size,
            matrix,
        );
    };
    let em = face.units_per_em();
    let matrix = matrix
        .pre_concat(flip(face))
        .pre_scale(size / em, size / em);
    let bounds = drawing.bounds().unwrap_or(Rect {
        x: -em * 0.25,
        y: -em * 0.5,
        width: face.advance(glyph, em) + em * 0.5,
        height: em * 1.75,
    });
    let rect = device_bounds(bounds, &matrix)?;
    let mut painter = ColorGlyphPainter {
        face,
        foreground,
        matrices: vec![matrix],
        clips: vec![Clip::new(rect)],
        layers: vec![Layer::new(rect)?],
    };
    drawing.paint(&mut painter)?;
    Some(GlyphImage {
        rect,
        pixels: GlyphPixels::Color(painter.layers.swap_remove(0)),
    })
}

/// What the image of a glyph without colors of its own depends on: 3 bits of luminance, as a shade of gray.
pub fn shade_for(color: u32) -> u32 {
    if cfg!(target_os = "macos") {
        return 0xFF;
    }
    thread_local! {
        static KNOWN: [Cell<(u32, u32)>; 64] = const { [const { Cell::new((0, 0xFF)) }; 64] };
    }
    KNOWN.with(|known| {
        let (rgb, known) = (
            color >> 8,
            &known[((color >> 8).wrapping_mul(0x9E37_79B9) >> 26) as usize],
        );
        if known.get().0 != rgb {
            let [r, g, b, _] = color
                .to_be_bytes()
                .map(|channel| (f32::from(channel) / 255.).powf(GAMMA));
            let luminance = ((r * 0.2126 + g * 0.7152 + b * 0.0722).powf(1. / GAMMA) * 255.).round()
                as u32
                >> 5;
            known.set((
                rgb,
                ((luminance << 5 | luminance << 2 | luminance >> 1) * 0x0101_0100) | 0xFF,
            ));
        }
        known.get().1
    })
}

/// `SkTMaskGamma_build_correcting_lut`, which makes blending look as if it were done in linear light.
fn correct(coverage: &mut [u8], color: u32) {
    if cfg!(target_os = "macos") {
        return;
    }
    static TABLES: [OnceLock<[u8; 256]>; 8] = [const { OnceLock::new() }; 8];
    let shade = shade_for(color) >> 24;
    let table = TABLES[shade as usize >> 5].get_or_init(|| {
        let source = shade as f32 / 255.;
        let (target, linear_source) = (1. - source, source.powf(GAMMA));
        let linear_target = target.powf(GAMMA);
        std::array::from_fn(|value| {
            let raw = value as f32 / 255.;
            let alpha = raw + (1. - raw) * CONTRAST * linear_target * raw;
            let blended = (linear_source * alpha + linear_target * (1. - alpha)).powf(1. / GAMMA);
            ((blended - target) / (source - target) * 255. + 0.5) as u8
        })
    });
    coverage
        .iter_mut()
        .for_each(|value| *value = table[usize::from(*value)]);
}

/// `matrix` maps from the glyph's origin, with y down, to pixels. `hint` requires it not to scale.
pub fn rasterize(
    face: &Face,
    glyph: u32,
    size: f32,
    matrix: &Transform,
    hint: bool,
    foreground: u32,
) -> Option<GlyphImage> {
    if face.file.has_color
        && let Some(image) = rasterize_color(face, glyph, size, matrix, foreground)
    {
        return Some(image);
    }
    let hinted = hint.then(|| hint::outline(face, glyph, size)).flatten();
    let path = hinted.unwrap_or_else(|| {
        outline(
            face,
            glyph,
            (size * 64.).trunc() / 64. / face.units_per_em(),
        )
    });
    if path.is_empty() {
        return None;
    }
    let matrix = matrix.pre_concat(flip(face));
    let stroke = if face.embolden {
        embolden_width(size)
    } else {
        0.
    };
    let rect = device_bounds(path_bounds(&path, stroke), &matrix)?;
    let mut coverage = edges::fill(&path, false, &matrix, rect);
    if face.embolden {
        coverage.unite(&Coverage::of_path(
            &path,
            Stroke::new(stroke),
            &matrix,
            rect,
        ));
    }
    correct(&mut coverage.data, foreground);
    Some(GlyphImage {
        rect,
        pixels: GlyphPixels::Mask(coverage.data),
    })
}
