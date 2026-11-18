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
} else if cfg!(target_os = "macos") {
    0.
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
        Pixels::Png(png) => {
            let (width, height, rgba) = crate::png_rows::decode(png, MAX_GLYPH_PIXELS as usize)?;
            images::pixmap_from_rgba(width, height, rgba)?
        }
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

fn to_linear(value: f32) -> f32 {
    match cfg!(target_os = "macos") {
        true if value <= 0.04045 => value / 12.92,
        true => ((value + 0.055) / 1.055).powf(2.4),
        false => value.powf(GAMMA),
    }
}

fn from_linear(value: f32) -> f32 {
    match cfg!(target_os = "macos") {
        true if value <= 0.003_130_8 => value * 12.92,
        true => 1.055 * value.powf(1. / 2.4) - 0.055,
        false => value.powf(1. / GAMMA),
    }
}

/// What the images of glyphs depend on.
pub fn ink_for(face: &Face, color: u32) -> u32 {
    match face.file.has_color {
        true => color | 0xFF,
        false if cfg!(target_os = "macos") && !face.is_smoothed => 0xFF,
        false => shade_for(color),
    }
}

/// 3 bits of luminance, as a shade of gray: `SkComputeLuminance` of `SkMaskGamma::CanonicalColor`.
fn shade_for(color: u32) -> u32 {
    let three_bits = |it: u32| it >> 5 << 5 | it >> 5 << 2 | it >> 6;
    let [r, g, b, _] = color
        .to_be_bytes()
        .map(|it| three_bits(u32::from(it >> u8::from(cfg!(target_os = "macos")))));
    (three_bits((r * 54 + g * 183 + b * 19) >> 8) * 0x0101_0100) | 0xFF
}

/// For the outlines of glyphs of so many pixels, which are as light as the glyphs.
pub fn correct_stroke(face: &Face, size: f32, color: u32, coverage: &mut [u8]) {
    const LARGEST: f32 = if cfg!(target_os = "macos") {
        161.
    } else {
        256.
    };
    if size <= LARGEST && (face.is_smoothed || !cfg!(target_os = "macos")) {
        correct(coverage, shade_for(color) >> 24);
    }
}

/// `SkTMaskGamma_build_correcting_lut`, which makes blending look as if it were done in linear light.
fn correct(coverage: &mut [u8], shade: u32) {
    static TABLES: [OnceLock<[u8; 256]>; 8] = [const { OnceLock::new() }; 8];
    let table = TABLES[shade as usize >> 5].get_or_init(|| {
        let source = shade as f32 / 255.;
        let (target, linear_source) = (1. - source, to_linear(source));
        let linear_target = to_linear(target);
        std::array::from_fn(|value| {
            let raw = value as f32 / 255.;
            let alpha = raw + (1. - raw) * CONTRAST * linear_target * raw;
            let blended = from_linear(linear_source * alpha + linear_target * (1. - alpha));
            ((blended - target) / (source - target) * 255. + 0.5) as u8
        })
    });
    coverage
        .iter_mut()
        .for_each(|value| *value = table[usize::from(*value)]);
}

/// How far a black rectangle on white reaches beyond the left and the right edge of `exact`, with a gamma of 2.
#[cfg(any(test, target_os = "macos"))]
pub fn growth_of_block(pixels: &[u32], columns: usize, exact: Rect) -> [f32; 2] {
    let ink = |pixel: &u32| 1. - (f32::from((pixel >> 8) as u8) / 255.).powi(2);
    let (left, right) =
        pixels[pixels.len() / columns / 2 * columns..][..columns].split_at(columns / 2);
    [
        exact.x - left.len() as f32 + left.iter().map(ink).sum::<f32>(),
        left.len() as f32 + right.iter().map(ink).sum::<f32>() - exact.x - exact.width,
    ]
}

/// With the left, upper, right and lower edges moved outwards by less than a pixel.
fn fill_grown(
    path: &Path,
    matrix: &Transform,
    [left, up, right, down]: [f32; 4],
    rect: IntRect,
) -> Coverage {
    const ROWS: usize = 4;
    let moves = [
        (0., 0.),
        (-left, -up),
        (right, -up),
        (-left, down),
        (right, down),
    ]
    .map(|(x, y)| matrix.post_translate(x, y).post_scale(1., ROWS as f32));
    let copies: Path = moves
        .iter()
        .flat_map(|by| path.iter().map(|it| it.transform(by)))
        .collect();
    let tall = IntRect::new(
        rect.left,
        rect.top * ROWS as i32,
        rect.right,
        rect.bottom * ROWS as i32,
    );
    let (tall, width) = (
        Coverage::of_path(&copies, Fill::NonZero, &Transform::identity(), tall),
        rect.width(),
    );
    let average = |rows: &[u8], x: usize| {
        ((0..ROWS)
            .map(|row| usize::from(rows[row * width + x]))
            .sum::<usize>()
            + ROWS / 2)
            / ROWS
    };
    Coverage {
        rect,
        data: tall
            .data
            .chunks_exact(width * ROWS)
            .flat_map(|rows| (0..width).map(move |x| average(rows, x) as u8))
            .collect(),
    }
}

/// `matrix` maps from the glyph's origin, with y down, to pixels. `hint` requires it not to scale. `foreground` is from `ink_for`.
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
    let scale = average_scale(&matrix);
    let growth = face
        .is_smoothed
        .then(|| super::catalog::smoothing(size * scale))
        .flatten()
        .filter(|_| size * scale <= 256.);
    let stroke = if face.embolden {
        embolden_width(size) + growth.map_or(0., |it| (it[0] + it[2]) / scale)
    } else {
        0.
    };
    let rect = device_bounds(path_bounds(&path, stroke), &matrix)?.outset(growth.is_some().into());
    let mut coverage = growth.map_or_else(
        || Coverage::of_path(&path, Fill::NonZero, &matrix, rect),
        |it| fill_grown(&path, &matrix, it, rect),
    );
    if face.embolden {
        coverage.unite(&Coverage::of_path(
            &path,
            Stroke::new(stroke),
            &matrix,
            rect,
        ));
    }
    if growth.is_some() || !cfg!(target_os = "macos") {
        correct(
            &mut coverage.data,
            if face.file.has_color {
                shade_for(foreground)
            } else {
                foreground
            } >> 24,
        );
    }
    Some(GlyphImage {
        rect,
        pixels: GlyphPixels::Mask(coverage.data),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gfx::PathBuilder as _;

    #[test]
    fn grows_by_what_is_measured() {
        let mut ring = Path::new();
        ring.move_to([2.5, 2.5])
            .line_to([12.5, 2.5])
            .line_to([12.5, 12.5])
            .line_to([2.5, 12.5])
            .close();
        let (solid, growth) = (ring.clone(), [0.125, 0.25, 0.375, 0.1875]);
        ring.move_to([5., 5.])
            .line_to([5., 10.])
            .line_to([10., 10.])
            .line_to([10., 5.])
            .close();
        let fill = |path| {
            fill_grown(
                path,
                &Transform::identity(),
                growth,
                IntRect::new(0, 0, 15, 15),
            )
            .data
        };
        let on_white =
            |it: u8| ((1. - f32::from(it) / 255.).sqrt() * 255.).round() as u32 * 0x01_0101;
        let pixels: Vec<_> = fill(&solid).into_iter().map(on_white).collect();
        let measured = growth_of_block(
            &pixels,
            15,
            Rect {
                x: 2.5,
                y: 2.5,
                width: 10.,
                height: 10.,
            },
        );
        assert!(
            measured
                .iter()
                .zip([growth[0], growth[2]])
                .all(|(a, b)| (a - b).abs() < 0.01),
            "{measured:?}"
        );
        assert_eq!(fill(&ring)[7 * 15..][4..11], [255, 96, 0, 0, 0, 32, 255]);
        assert_eq!(
            fill(&ring)[7..]
                .iter()
                .step_by(15)
                .skip(4)
                .take(7)
                .copied()
                .collect::<Vec<_>>(),
            [255, 48, 0, 0, 0, 64, 255]
        );
    }

    #[test]
    fn shades_are_those_of_chromium() {
        let shades = [
            0x000, 0xF00, 0x0F0, 0x00F, 0xFF0, 0x0FF, 0xF0F, 0xD22, 0x22D, 0x888, 0x800, 0x06C,
            0xE80, 0xFFF,
        ]
        .map(|it: u32| {
            shade_for((it >> 8) * 0x1100_0000 + (it >> 4 & 15) * 0x11_0000 + (it & 15) * 0x1100)
                >> 29
        });
        assert_eq!(
            shades,
            if cfg!(target_os = "macos") {
                [0, 0, 2, 0, 3, 2, 0, 0, 0, 2, 0, 1, 2, 3]
            } else {
                [0, 1, 5, 0, 7, 6, 2, 2, 1, 4, 0, 2, 4, 7]
            }
        );
    }
}
