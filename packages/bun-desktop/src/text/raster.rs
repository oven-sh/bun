use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Arc, LazyLock, OnceLock};

use parking_lot::Mutex;
use resvg::tiny_skia::{self, FilterQuality, Pixmap, PixmapPaint, Transform};
use rustc_hash::FxHashMap;
use skrifa::bitmap::{BitmapData, BitmapGlyph, Origin};
use skrifa::color::{Brush, ColorPainter, CompositeMode, Extend};
use skrifa::instance::Size;
use skrifa::outline::{
    DrawSettings, Engine, HintingInstance, HintingOptions, OutlinePen, SmoothMode, Target,
};
use skrifa::raw::types::BoundingBox;
use skrifa::{GlyphId, MetadataProvider as _};
use zeno::PathBuilder as _;

use super::fonts::Face;
use crate::abi::{GradientStop, Rect, RoundedRect};
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

struct Pen(Path);

impl OutlinePen for Pen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to([x, y]);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to([x, y]);
    }

    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.0.quad_to([cx, cy], [x, y]);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.0.curve_to([cx0, cy0], [cx1, cy1], [x, y]);
    }

    fn close(&mut self) {
        self.0.close();
    }
}

/// Skrifa panics on some malformed fonts. The rest of the page is painted all the same.
fn despite_bad_font<R>(f: impl FnOnce() -> Option<R>) -> Option<R> {
    catch_unwind(AssertUnwindSafe(f)).ok().flatten()
}

static HINTERS: LazyLock<Mutex<FxHashMap<(u32, u32), Option<Arc<HintingInstance>>>>> =
    LazyLock::new(Mutex::default);

pub fn release_memory() {
    HINTERS.lock().clear();
}

/// Moves outlines vertically only, like FreeType's "slight" hinting.
fn hinter(face: &Face, size: f32) -> Option<Arc<HintingInstance>> {
    let mut hinters = HINTERS.lock();
    if hinters.len() > 64 {
        hinters.clear();
    }
    let hinter = hinters.entry((face.id, size.to_bits())).or_insert_with(|| {
        despite_bad_font(|| {
            let options = HintingOptions {
                engine: Engine::Auto(Some(face.file.glyph_styles())),
                target: Target::from(SmoothMode::Light),
            };
            let instance = HintingInstance::new(
                &face.file.outlines,
                Size::new(size),
                face.location(),
                options,
            );
            instance.ok().map(Arc::new)
        })
    });
    hinter.clone()
}

/// With y up.
fn outline(face: &Face, glyph: u32, size: Size, hinter: Option<&HintingInstance>) -> Path {
    let mut pen = Pen(Path::new());
    #[cfg(target_os = "macos")]
    if let Some(native) = face.file.native.as_ref().filter(|_| !face.file.has_color) {
        native.outline(
            glyph,
            size.ppem().map_or(1., |size| size / face.units_per_em()),
            &mut pen,
        );
        return pen.0;
    }
    if let Some(outline) = face.file.outlines.get(glyph.into()) {
        let settings = match hinter {
            Some(hinter) => DrawSettings::hinted(hinter, false),
            None => DrawSettings::unhinted(size, face.location()),
        };
        if despite_bad_font(|| outline.draw(settings, &mut pen).ok()).is_none() {
            pen.0.clear();
        }
    }
    pen.0
}

fn flip(face: &Face) -> Transform {
    Transform::from_row(1., 0., if face.skew { SKEW } else { 0. }, -1., 0., 0.)
}

/// With y down and the origin on the baseline.
pub fn glyph_path(face: &Face, glyph: u32, size: f32) -> Path {
    let flip = flip(face);
    let flip = zeno::Transform::new(flip.sx, flip.ky, flip.kx, flip.sy, 0., 0.);
    let path = outline(face, glyph, Size::new(size), None);
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
    let bounds = zeno::bounds(path, zeno::Fill::NonZero, None);
    Rect {
        x: bounds.min.x - outset,
        y: bounds.min.y - outset,
        width: bounds.width() + outset * 2.,
        height: bounds.height() + outset * 2.,
    }
}

fn rasterize_bitmap(
    face: &Face,
    bitmap: &BitmapGlyph,
    size: f32,
    matrix: &Transform,
) -> Option<GlyphImage> {
    let pixmap = match bitmap.data {
        BitmapData::Png(png) => images::decode_pixmap(png)?,
        BitmapData::Bgra(bgra) => {
            let rgba = bgra
                .as_chunks()
                .0
                .iter()
                .flat_map(|[b, g, r, a]| [*r, *g, *b, *a]);
            Pixmap::from_vec(
                rgba.collect(),
                tiny_skia::IntSize::from_wh(bitmap.width, bitmap.height)?,
            )?
        }
        BitmapData::Mask(_) => return None,
    };
    let (unit, scale_x, scale_y) = (
        size / face.units_per_em(),
        size / bitmap.ppem_x,
        size / bitmap.ppem_y,
    );
    let (width, height) = (
        pixmap.width() as f32 * scale_x,
        pixmap.height() as f32 * scale_y,
    );
    let bearing = bitmap.bearing_y * unit + bitmap.inner_bearing_y * scale_y;
    let bounds = Rect {
        x: bitmap.bearing_x * unit + bitmap.inner_bearing_x * scale_x,
        y: match bitmap.placement_origin {
            Origin::TopLeft => -bearing,
            Origin::BottomLeft => -bearing - height,
        },
        width,
        height,
    };
    let device_scale = average_scale(matrix);
    let reduced = images::reduce(&pixmap, width * device_scale, height * device_scale);
    let pixmap = reduced.as_ref().unwrap_or(&pixmap);
    let mut layer = Layer::new(device_bounds(bounds, matrix)?)?;
    let placement = matrix
        .post_translate(-layer.rect.left as f32, -layer.rect.top as f32)
        .pre_translate(bounds.x, bounds.y)
        .pre_scale(
            width / pixmap.width() as f32,
            height / pixmap.height() as f32,
        );
    let paint = PixmapPaint {
        quality: FilterQuality::Bilinear,
        ..PixmapPaint::default()
    };
    layer
        .pixmap
        .draw_pixmap(0, 0, pixmap.as_ref(), &paint, placement, None);
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

    fn push_clip(&mut self, coverage: impl FnOnce(&Transform, IntRect) -> Coverage) {
        let clip = self.clips.last().cloned().unwrap_or_default();
        self.clips
            .push(clip.within(coverage(&self.matrix(), clip.rect)));
    }
}

impl ColorPainter for ColorGlyphPainter<'_> {
    fn push_transform(&mut self, by: skrifa::color::Transform) {
        let by = Transform::from_row(by.xx, by.yx, by.xy, by.yy, by.dx, by.dy);
        self.matrices.push(self.matrix().pre_concat(by));
    }

    fn pop_transform(&mut self) {
        self.matrices.pop();
    }

    fn push_clip_glyph(&mut self, glyph: GlyphId) {
        let path = outline(self.face, glyph.to_u32(), Size::unscaled(), None);
        self.push_clip(|matrix, area| Coverage::of_path(&path, zeno::Fill::NonZero, matrix, area));
    }

    fn push_clip_box(&mut self, bounds: BoundingBox<f32>) {
        let shape = RoundedRect {
            rect: box_rect(bounds),
            ..RoundedRect::default()
        };
        self.push_clip(|matrix, area| Coverage::of_shape(&shape, matrix, area));
    }

    fn pop_clip(&mut self) {
        self.clips.pop();
    }

    fn fill(&mut self, brush: Brush<'_>) {
        let (geometry, stops, extend) = match brush {
            Brush::Solid {
                palette_index,
                alpha,
            } => {
                let paint = Paint::Solid(premultiply(self.color(palette_index, alpha)));
                if let (Some(layer), Some(clip)) = (self.layers.last_mut(), self.clips.last()) {
                    layer.fill(clip.rect, None, clip, &paint);
                }
                return;
            }
            Brush::LinearGradient {
                p0,
                p1,
                color_stops,
                extend,
            } => {
                let (from, to) = ([p0.x, p0.y], [p1.x, p1.y]);
                (Geometry::Linear { from, to }, color_stops, extend)
            }
            Brush::RadialGradient {
                c0,
                r0,
                c1,
                r1,
                color_stops,
                extend,
            } => {
                let (from, to) = ([c0.x, c0.y, r0], [c1.x, c1.y, r1]);
                (Geometry::Radial { from, to }, color_stops, extend)
            }
            Brush::SweepGradient {
                c0,
                start_angle,
                end_angle,
                color_stops,
                extend,
            } => {
                // The angles are clockwise with y up, which is the other way around.
                let (start, span) = (
                    -end_angle.to_radians(),
                    (end_angle - start_angle).to_radians(),
                );
                (
                    Geometry::Sweep {
                        center: [c0.x, c0.y],
                        start,
                        span,
                    },
                    color_stops,
                    extend,
                )
            }
        };
        let mut stops: Vec<_> = (stops.iter())
            .map(|stop| GradientStop {
                offset: stop.offset,
                color: self.color(stop.palette_index, stop.alpha),
            })
            .collect();
        if matches!(geometry, Geometry::Sweep { .. }) {
            stops.reverse();
            stops
                .iter_mut()
                .for_each(|stop| stop.offset = 1. - stop.offset);
        }
        let spread = match extend {
            Extend::Repeat => Spread::Repeat,
            Extend::Reflect => Spread::Reflect,
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

    fn push_layer(&mut self, _: CompositeMode) {
        self.layers.extend(Layer::new(self.layers[0].rect));
    }

    fn pop_layer_with_mode(&mut self, mode: CompositeMode) {
        use tiny_skia::BlendMode as To;
        let mode = match mode {
            CompositeMode::Clear => To::Clear,
            CompositeMode::Src => To::Source,
            CompositeMode::Dest => To::Destination,
            CompositeMode::DestOver => To::DestinationOver,
            CompositeMode::SrcIn => To::SourceIn,
            CompositeMode::DestIn => To::DestinationIn,
            CompositeMode::SrcOut => To::SourceOut,
            CompositeMode::DestOut => To::DestinationOut,
            CompositeMode::SrcAtop => To::SourceAtop,
            CompositeMode::DestAtop => To::DestinationAtop,
            CompositeMode::Xor => To::Xor,
            CompositeMode::Plus => To::Plus,
            CompositeMode::Screen => To::Screen,
            CompositeMode::Overlay => To::Overlay,
            CompositeMode::Darken => To::Darken,
            CompositeMode::Lighten => To::Lighten,
            CompositeMode::ColorDodge => To::ColorDodge,
            CompositeMode::ColorBurn => To::ColorBurn,
            CompositeMode::HardLight => To::HardLight,
            CompositeMode::SoftLight => To::SoftLight,
            CompositeMode::Difference => To::Difference,
            CompositeMode::Exclusion => To::Exclusion,
            CompositeMode::Multiply => To::Multiply,
            CompositeMode::HslHue => To::Hue,
            CompositeMode::HslSaturation => To::Saturation,
            CompositeMode::HslColor => To::Color,
            CompositeMode::HslLuminosity => To::Luminosity,
            _ => To::SourceOver,
        };
        if self.layers.len() > 1
            && let Some(layer) = self.layers.pop()
            && let (Some(below), Some(clip)) = (self.layers.last_mut(), self.clips.last())
        {
            below.draw_with_mode(&layer, mode, clip);
        }
    }
}

fn box_rect(bounds: BoundingBox<f32>) -> Rect {
    Rect {
        x: bounds.x_min,
        y: bounds.y_min,
        width: bounds.x_max - bounds.x_min,
        height: bounds.y_max - bounds.y_min,
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
    let Some(color_glyph) = font.color_glyphs().get(glyph.into()) else {
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
        let strike = Size::new(size * average_scale(matrix));
        return rasterize_bitmap(
            face,
            &font.bitmap_strikes().glyph_for_size(strike, glyph.into())?,
            size,
            matrix,
        );
    };
    let em = face.units_per_em();
    let matrix = matrix
        .pre_concat(flip(face))
        .pre_scale(size / em, size / em);
    let bounds = color_glyph
        .bounding_box(face.location(), Size::unscaled())
        .map(box_rect);
    let bounds = bounds.unwrap_or(Rect {
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
    color_glyph.paint(face.location(), &mut painter).ok()?;
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
    let [r, g, b, _] = color
        .to_be_bytes()
        .map(|channel| (f32::from(channel) / 255.).powf(GAMMA));
    let luminance =
        ((r * 0.2126 + g * 0.7152 + b * 0.0722).powf(1. / GAMMA) * 255.).round() as u32 >> 5;
    (luminance << 5 | luminance << 2 | luminance >> 1) * 0x0101_0100 | 0xFF
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

/// `matrix` maps from the glyph's origin, with y down, to pixels. `hint` requires it to be a translation.
pub fn rasterize(
    face: &Face,
    glyph: u32,
    size: f32,
    matrix: &Transform,
    hint: bool,
    foreground: u32,
) -> Option<GlyphImage> {
    if face.file.has_color
        && let Some(image) =
            despite_bad_font(|| rasterize_color(face, glyph, size, matrix, foreground))
    {
        return Some(image);
    }
    let hinter = if hint { hinter(face, size) } else { None };
    let path = outline(face, glyph, Size::new(size), hinter.as_deref());
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
            zeno::Stroke::new(stroke),
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
