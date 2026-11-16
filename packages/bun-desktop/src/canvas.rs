//! What `internal/desktop/dom/canvas.ts` draws on.

use std::cell::RefCell;
use std::rc::Rc;

use anyhow::{Context as _, Result, bail};
use image::codecs::{jpeg::JpegEncoder, png::PngEncoder, webp::WebPEncoder};
use image::{DynamicImage, RgbaImage};
use resvg::tiny_skia::{self, BlendMode, FilterQuality, Pattern, Pixmap, SpreadMode, Transform};
use rustc_hash::FxHashMap;
use serde_json::{Value, json};
use zeno::{Cap, Fill, Join, PathBuilder as _, Stroke};

use crate::abi::{self, Filter, FontSetting, GradientStop, Rect, RoundedRect, TextRun};
use crate::images::{self, Content};
use crate::paint::gradient::{Geometry, Gradient, Spread};
use crate::paint::raster::{
    Clip, Coverage, IntRect, Layer, Paint, Path, Pixel, blur_extent, demultiply, map_point,
    map_rect, premultiply, rounded_rect_path, scale,
};
use crate::paint::scene::{Frame, outset};
use crate::paint::{cpu, filter};
use crate::text::{self, Description, Line};
use crate::{bridge, surface};

#[derive(Clone)]
enum Style {
    Color(u32),
    Gradient(Rc<Gradient>),
    Pattern {
        tile: Rc<Pixmap>,
        repeats: [bool; 2],
        matrix: Transform,
    },
}

#[derive(Clone)]
struct State {
    matrix: Transform,
    fill: Style,
    stroke: Style,
    alpha: f32,
    mode: BlendMode,
    line_width: f32,
    cap: Cap,
    join: Join,
    miter_limit: f32,
    dashes: Vec<f32>,
    dash_offset: f32,
    shadow_offset: [f32; 2],
    shadow_blur: f32,
    shadow_color: u32,
    is_smooth: bool,
    filters: Vec<Filter>,
    clip: Clip,
}

struct Canvas {
    /// `None` without pixels.
    layer: Option<Layer>,
    version: u32,
    is_opaque: bool,
    state: State,
    saved: Vec<State>,
}

thread_local! {
    static CANVASES: RefCell<FxHashMap<u32, Rc<RefCell<Canvas>>>> = RefCell::default();
}

fn get(id: u32) -> Option<Rc<RefCell<Canvas>>> {
    CANVASES.with_borrow(|canvases| canvases.get(&id).cloned())
}

pub fn with_pixels<R>(id: u32, f: impl FnOnce(&Pixmap, u32) -> R) -> Option<R> {
    let canvas = get(id)?;
    let canvas = canvas.try_borrow().ok()?;
    Some(f(&canvas.layer.as_ref()?.pixmap, canvas.version))
}

type Texts<'a> = std::str::Split<'a, char>;

struct Reader<'a> {
    numbers: std::slice::Iter<'a, [u8; 8]>,
}

impl Reader<'_> {
    fn next(&mut self) -> Option<f64> {
        self.numbers.next().map(|bytes| f64::from_ne_bytes(*bytes))
    }

    fn integer(&mut self) -> Option<u32> {
        self.next().map(|number| number as u32)
    }

    fn floats<const N: usize>(&mut self) -> Option<[f32; N]> {
        let mut floats = [0.; N];
        for float in &mut floats {
            *float = self.next()? as f32;
        }
        Some(floats)
    }

    fn matrix(&mut self) -> Option<Transform> {
        let [a, b, c, d, e, f] = self.floats()?;
        Some(Transform::from_row(a, b, c, d, e, f))
    }

    fn rect(&mut self) -> Option<Rect> {
        let [x, y, width, height] = self.floats()?;
        Some(Rect {
            x: x.min(x + width),
            y: y.min(y + height),
            width: width.abs(),
            height: height.abs(),
        })
    }

    /// In device pixels.
    fn path(&mut self) -> Option<Path> {
        let (mut path, end) = (Path::new(), self.integer()? as usize);
        let end = self.numbers.len().checked_sub(end)?;
        while self.numbers.len() > end {
            match self.integer()? {
                0 => path.move_to(self.floats::<2>()?),
                1 => path.line_to(self.floats::<2>()?),
                2 => path.quad_to(self.floats::<2>()?, self.floats::<2>()?),
                3 => path.curve_to(
                    self.floats::<2>()?,
                    self.floats::<2>()?,
                    self.floats::<2>()?,
                ),
                _ => path.close(),
            };
        }
        Some(path)
    }

    fn style(&mut self) -> Option<Style> {
        let geometry = match self.integer()? {
            0 => return Some(Style::Color(self.integer()?)),
            1 => Geometry::Linear {
                from: self.floats()?,
                to: self.floats()?,
            },
            2 => Geometry::Radial {
                from: self.floats()?,
                to: self.floats()?,
            },
            3 => {
                let [start, x, y] = self.floats()?;
                Geometry::Sweep {
                    center: [x, y],
                    start,
                    span: std::f32::consts::TAU,
                }
            }
            _ => {
                let (id, repeats, matrix) = (
                    self.integer()?,
                    [self.integer()? != 0, self.integer()? != 0],
                    self.matrix()?,
                );
                let tile = PATTERNS.with_borrow(|patterns| patterns.get(&id).cloned());
                return Some(tile.map_or(Style::Color(0), |tile| Style::Pattern {
                    tile,
                    repeats,
                    matrix,
                }));
            }
        };
        let stops = (0..self.integer()?).map(|_| {
            Some(GradientStop {
                offset: self.next()? as f32,
                color: self.integer()?,
            })
        });
        let stops = stops.collect::<Option<Vec<_>>>()?;
        Some(match geometry {
            Geometry::Linear { from, to } if from == to => Style::Color(0),
            Geometry::Radial { from, to } if from == to => Style::Color(0),
            _ => Style::Gradient(Rc::new(Gradient::new(geometry, &stops, Spread::Pad, false))),
        })
    }

    fn filter(&mut self) -> Option<Filter> {
        let (kind, [amount]) = (self.integer()?, self.floats()?);
        Some(match kind {
            0 => Filter::Blur(amount),
            1 => Filter::Brightness(amount),
            2 => Filter::Contrast(amount),
            3 => Filter::Grayscale(amount),
            4 => Filter::HueRotate(amount),
            5 => Filter::Invert(amount),
            6 => Filter::Opacity(amount),
            7 => Filter::Saturate(amount),
            8 => Filter::Sepia(amount),
            _ => Filter::DropShadow {
                blur: amount,
                offset: self.floats()?,
                color: self.integer()?,
            },
        })
    }

    fn line(&mut self, text: &str) -> Option<(Line, u32, f32)> {
        let (font, [size, letter_spacing, word_spacing], direction) =
            (self.integer()?, self.floats()?, self.integer()?);
        let end = text.len() as u32;
        let run = TextRun {
            end,
            font,
            size,
            letter_spacing,
            word_spacing,
            word_break: abi::BREAK_NORMAL,
        };
        Some((Line::new(text, run, direction as u8), font, size))
    }
}

thread_local! {
    static PATTERNS: RefCell<FxHashMap<u32, Rc<Pixmap>>> = RefCell::default();
}

const MODES: [BlendMode; 27] = [
    BlendMode::SourceOver,
    BlendMode::SourceIn,
    BlendMode::SourceOut,
    BlendMode::SourceAtop,
    BlendMode::DestinationOver,
    BlendMode::DestinationIn,
    BlendMode::DestinationOut,
    BlendMode::DestinationAtop,
    BlendMode::Plus,
    BlendMode::Source,
    BlendMode::Xor,
    BlendMode::Multiply,
    BlendMode::Screen,
    BlendMode::Overlay,
    BlendMode::Darken,
    BlendMode::Lighten,
    BlendMode::ColorDodge,
    BlendMode::ColorBurn,
    BlendMode::HardLight,
    BlendMode::SoftLight,
    BlendMode::Difference,
    BlendMode::Exclusion,
    BlendMode::Hue,
    BlendMode::Saturation,
    BlendMode::Color,
    BlendMode::Luminosity,
    BlendMode::Clear,
];

fn with_alpha(color: u32, alpha: f32) -> u32 {
    color & !0xFF | ((color & 0xFF) as f32 * alpha).round() as u32
}

fn fade(row: &mut [Pixel], alpha: f32) {
    if alpha < 1. {
        let alpha = (alpha * 255.).round() as u8;
        row.iter_mut()
            .for_each(|pixel| *pixel = scale(*pixel, alpha));
    }
}

fn path_bounds(path: &Path) -> Rect {
    let bounds = zeno::bounds(path, Fill::NonZero, None);
    Rect {
        x: bounds.min.x,
        y: bounds.min.y,
        width: bounds.width(),
        height: bounds.height(),
    }
}

fn transformed(path: &Path, by: &Transform) -> Path {
    let by = zeno::Transform::new(by.sx, by.ky, by.kx, by.sy, by.tx, by.ty);
    path.iter().map(|command| command.transform(&by)).collect()
}

/// Without the segments that have no length, and the subpaths that have nothing else.
fn pruned(path: &Path) -> Path {
    use zeno::Command::{Close, CurveTo, LineTo, MoveTo, QuadTo};
    let (mut kept, mut at, mut start, mut has_segments) =
        (Path::new(), zeno::Point::ZERO, zeno::Point::ZERO, false);
    for command in path {
        let end = match *command {
            MoveTo(to) => {
                (at, start, has_segments) = (to, to, false);
                continue;
            }
            Close => {
                kept.extend(has_segments.then_some(Close));
                (at, has_segments) = (start, false);
                continue;
            }
            LineTo(to) if to != at => to,
            QuadTo(a, to) if a != at || to != at => to,
            CurveTo(a, b, to) if a != at || b != at || to != at => to,
            _ => continue,
        };
        kept.extend((!has_segments).then_some(MoveTo(at)));
        kept.push(*command);
        (at, has_segments) = (end, true);
    }
    kept
}

fn rect_path(rect: Rect) -> Path {
    rounded_rect_path(&RoundedRect {
        rect,
        ..RoundedRect::default()
    })
}

fn sample(tile: &Pixmap, repeats: [bool; 2], x: f32, y: f32, is_smooth: bool) -> Pixel {
    let pixels: &[Pixel] = tile.data().as_chunks().0;
    let (width, height) = (tile.width() as i64, tile.height() as i64);
    let at = |x: i64, y: i64| {
        let x = if repeats[0] { x.rem_euclid(width) } else { x };
        let y = if repeats[1] { y.rem_euclid(height) } else { y };
        match (0..width).contains(&x) && (0..height).contains(&y) {
            true => pixels[(y * width + x) as usize],
            false => [0; 4],
        }
    };
    if !is_smooth {
        return at(x.floor() as i64, y.floor() as i64);
    }
    let (left, top) = ((x - 0.5).floor(), (y - 0.5).floor());
    let (dx, dy, left, top) = (x - 0.5 - left, y - 0.5 - top, left as i64, top as i64);
    let [a, b, c, d] = [
        at(left, top),
        at(left + 1, top),
        at(left, top + 1),
        at(left + 1, top + 1),
    ];
    std::array::from_fn(|channel| {
        let mix = |from: Pixel, to: Pixel| {
            f32::from(from[channel]) * (1. - dx) + f32::from(to[channel]) * dx
        };
        (mix(a, b) * (1. - dy) + mix(c, d) * dy + 0.5) as u8
    })
}

impl State {
    fn new(bounds: IntRect) -> State {
        State {
            matrix: Transform::identity(),
            fill: Style::Color(0xFF),
            stroke: Style::Color(0xFF),
            alpha: 1.,
            mode: BlendMode::SourceOver,
            line_width: 1.,
            cap: Cap::Butt,
            join: Join::Miter,
            miter_limit: 10.,
            dashes: Vec::new(),
            dash_offset: 0.,
            shadow_offset: [0.; 2],
            shadow_blur: 0.,
            shadow_color: 0,
            is_smooth: true,
            filters: Vec::new(),
            clip: Clip::new(bounds),
        }
    }

    fn has_shadow(&self) -> bool {
        self.shadow_color & 0xFF != 0 && (self.shadow_blur > 0. || self.shadow_offset != [0.; 2])
    }

    fn pen(&self) -> Stroke<'_> {
        let mut pen = Stroke::new(self.line_width);
        pen.cap(self.cap)
            .join(self.join)
            .miter_limit(self.miter_limit)
            .dash(&self.dashes, self.dash_offset);
        pen
    }

    fn with_paint(&self, style: &Style, f: impl FnOnce(&Paint)) {
        match style {
            Style::Color(color) => f(&Paint::Solid(premultiply(with_alpha(*color, self.alpha)))),
            Style::Gradient(gradient) => {
                let Some(inverse) = self.matrix.invert() else {
                    return;
                };
                f(&Paint::Shader(&|x, y, row| {
                    gradient.shade(&inverse, x, y, row);
                    fade(row, self.alpha);
                }))
            }
            Style::Pattern {
                tile,
                repeats,
                matrix,
            } => {
                let Some(inverse) = self.matrix.pre_concat(*matrix).invert() else {
                    return;
                };
                f(&Paint::Shader(&|left, y, row| {
                    for (x, pixel) in (left..).zip(row.iter_mut()) {
                        let (x, y) = map_point(&inverse, x as f32 + 0.5, y as f32 + 0.5);
                        *pixel = sample(tile, *repeats, x, y, self.is_smooth);
                    }
                    fade(row, self.alpha);
                }))
            }
        }
    }

    /// `draw` paints with source-over inside of `bounds`, which are in device pixels.
    fn compose(&self, target: &mut Layer, bounds: Rect, draw: impl FnOnce(&mut Layer, &Clip)) {
        let bounds = IntRect::around(bounds);
        if self.mode == BlendMode::SourceOver && !self.has_shadow() && self.filters.is_empty() {
            return draw(target, &self.clip.within_rect(bounds));
        }
        let (sigma, [dx, dy]) = (
            self.shadow_blur / 2.,
            self.shadow_offset.map(|offset| offset.round() as i32),
        );
        let filter_reach = cpu::filter_reach(&self.filters, &Transform::identity());
        let shadow_reach = if self.has_shadow() {
            blur_extent(sigma)
        } else {
            0
        };
        let mut needed = self.clip.rect;
        if self.has_shadow() {
            needed = needed.union(needed.offset(-dx, -dy).outset(shadow_reach));
        }
        let area = bounds
            .outset(filter_reach + shadow_reach)
            .intersect(needed.outset(filter_reach));
        let affects_everything = matches!(
            self.mode,
            BlendMode::SourceIn
                | BlendMode::SourceOut
                | BlendMode::DestinationIn
                | BlendMode::DestinationAtop
                | BlendMode::Source
        );
        let mut blend = |source: &Layer| match self.mode {
            BlendMode::SourceOver => target.draw(source, None, &self.clip),
            mode if affects_everything => target.draw_with_mode(source, mode, &self.clip),
            mode => target.draw_with_mode(source, mode, &self.clip.within_rect(source.rect)),
        };
        let Some(mut source) = Layer::new(area).or_else(|| Layer::new(IntRect::new(-1, -1, 0, 0)))
        else {
            return;
        };
        draw(&mut source, &Clip::new(area.intersect(bounds)));
        filter::apply(&mut source, &self.filters, &Transform::identity());
        if self.has_shadow()
            && let Some(mut shadow) = Layer::new(area.offset(dx, dy))
        {
            let mut shape = source.alpha();
            shape.blur(sigma);
            shape.rect = shadow.rect;
            shadow.fill_coverage(
                &shape,
                &Clip::new(shape.rect),
                &Paint::Solid(premultiply(self.shadow_color)),
            );
            blend(&shadow);
        }
        blend(&source);
    }

    /// `path` is in device pixels.
    fn fill_path(&self, target: &mut Layer, path: &Path, rule: Fill) {
        self.compose(target, path_bounds(path), |layer, clip| {
            let coverage = Coverage::of_path(path, rule, &Transform::identity(), clip.rect);
            self.with_paint(&self.fill, |paint| {
                layer.fill_coverage(&coverage, clip, paint)
            });
        });
    }

    /// `path` is in the space of `matrix`.
    fn stroke_path(&self, target: &mut Layer, path: &Path) {
        let path = &pruned(path);
        let reach = self.line_width
            * if self.join == Join::Miter {
                self.miter_limit.max(1.5)
            } else {
                1.5
            }
            / 2.;
        self.compose(
            target,
            outset(map_rect(&self.matrix, outset(path_bounds(path), reach)), 1.),
            |layer, clip| {
                let coverage = Coverage::of_path(path, self.pen(), &self.matrix, clip.rect);
                self.with_paint(&self.stroke, |paint| {
                    layer.fill_coverage(&coverage, clip, paint)
                });
            },
        );
    }

    fn fill_rect(&self, target: &mut Layer, rect: Rect) {
        let device = map_rect(&self.matrix, rect);
        let pixels = IntRect::nearest(device);
        if self.matrix.has_skew() || pixels.to_rect() != device {
            return self.fill_path(
                target,
                &transformed(&rect_path(rect), &self.matrix),
                Fill::NonZero,
            );
        }
        self.compose(target, device, |layer, clip| {
            self.with_paint(&self.fill, |paint| {
                layer.fill(pixels.intersect(clip.rect), None, clip, paint)
            })
        });
    }

    fn clear_rect(&self, target: &mut Layer, rect: Rect, is_opaque: bool) {
        let device = map_rect(&self.matrix, rect);
        let mut clip = self.clip.within_rect(IntRect::around(device));
        if self.matrix.has_skew() || IntRect::nearest(device).to_rect() != device {
            clip = clip.within(Coverage::of_path(
                &rect_path(rect),
                Fill::NonZero,
                &self.matrix,
                clip.rect,
            ));
        }
        if let Some(mut blank) = Layer::new(clip.rect) {
            if is_opaque {
                blank.pixels_mut().fill([0, 0, 0, 255]);
            }
            target.replace(&blank, &clip);
        }
    }

    fn draw_text(
        &self,
        target: &mut Layer,
        line: &Line,
        size: f32,
        matrix: Transform,
        strokes: bool,
    ) {
        if strokes {
            let Some(inverse) = self.matrix.invert() else {
                return;
            };
            return self.stroke_path(
                target,
                &transformed(&line.path(), &inverse.pre_concat(matrix)),
            );
        }
        let bounds = Rect {
            x: -size,
            y: -size * 2.,
            width: line.width + size * 2.,
            height: size * 3.,
        };
        let frame = Frame::new(1., false);
        let draw = |layer: &mut Layer, clip: &Clip, color: u32| {
            for (face, glyphs) in &line.runs {
                cpu::draw_glyphs(
                    layer,
                    &frame,
                    glyphs,
                    [0., 0.],
                    face.id,
                    face.size,
                    color,
                    &matrix,
                    clip,
                );
            }
        };
        self.compose(
            target,
            map_rect(&matrix, bounds),
            |layer, clip| match &self.fill {
                Style::Color(color) => draw(layer, clip, with_alpha(*color, self.alpha)),
                style => {
                    let Some(mut shape) = Layer::new(clip.rect) else {
                        return;
                    };
                    draw(&mut shape, &Clip::new(clip.rect), 0xFF);
                    self.with_paint(style, |paint| {
                        layer.fill_coverage(&shape.alpha(), clip, paint)
                    });
                }
            },
        );
    }

    /// `from` is in an image of `size`.
    fn draw_image(
        &self,
        target: &mut Layer,
        content: Content,
        mut size: [f32; 2],
        mut from: Rect,
        to: Rect,
    ) {
        if let Content::Pixels(pixmap) = &content {
            let pixels = [pixmap.width() as f32, pixmap.height() as f32];
            let (x, y) = (pixels[0] / size[0], pixels[1] / size[1]);
            (size, from) = (
                pixels,
                Rect {
                    x: from.x * x,
                    y: from.y * y,
                    width: from.width * x,
                    height: from.height * y,
                },
            );
        }
        let placement = (self.matrix.pre_translate(to.x, to.y))
            .pre_scale(to.width / from.width, to.height / from.height)
            .pre_translate(-from.x, -from.y);
        let all = Rect {
            x: 0.,
            y: 0.,
            width: size[0],
            height: size[1],
        };
        let from = crate::paint::scene::intersect(from, all);
        self.compose(target, map_rect(&placement, from), |layer, clip| {
            let pixmap = match content {
                Content::Pixels(pixmap) => pixmap,
                Content::Svg(svg) => {
                    let Some(mut drawn) = Layer::new(clip.rect) else {
                        return;
                    };
                    svg.draw(&mut drawn, all, &placement);
                    drawn.scale_alpha(self.alpha);
                    let shape =
                        Coverage::of_path(&rect_path(from), Fill::NonZero, &placement, clip.rect);
                    return layer.draw(&drawn, Some(&shape), clip);
                }
            };
            let part = IntRect::around(from);
            let (dx, dy) = (placement.tx.round(), placement.ty.round());
            let is_copy = frame_is_unscaled(&placement)
                && (placement.tx - dx).abs() + (placement.ty - dy).abs() < 1e-3;
            if is_copy && part.to_rect() == from {
                let (pixels, dx, dy): (&[Pixel], _, _) =
                    (pixmap.data().as_chunks().0, dx as i32, dy as i32);
                let copy = |x: i32, y: i32, row: &mut [Pixel]| {
                    let start = (y - dy) as usize * pixmap.width() as usize + (x - dx) as usize;
                    row.copy_from_slice(&pixels[start..start + row.len()]);
                    fade(row, self.alpha);
                };
                return layer.fill(part.offset(dx, dy), None, clip, &Paint::Shader(&copy));
            }
            // What is around the part does not bleed into it.
            let crop = tiny_skia::IntRect::from_ltrb(part.left, part.top, part.right, part.bottom);
            let is_all = part.to_rect() == all;
            let cropped = if is_all {
                None
            } else {
                crop.and_then(|crop| pixmap.clone_rect(crop))
            };
            let pixmap = cropped.as_ref().unwrap_or(pixmap);
            let (scale_x, scale_y) = placement.get_scale();
            let (width, height) = (part.width() as f32, part.height() as f32);
            let reduced = self
                .is_smooth
                .then(|| images::reduce(pixmap, width * scale_x, height * scale_y))
                .flatten();
            let pixmap = reduced.as_ref().unwrap_or(pixmap);
            let (stretch_x, stretch_y) = (
                width / pixmap.width() as f32,
                height / pixmap.height() as f32,
            );
            let paint = tiny_skia::Paint {
                shader: Pattern::new(
                    pixmap.as_ref(),
                    SpreadMode::Pad,
                    if self.is_smooth {
                        FilterQuality::Bilinear
                    } else {
                        FilterQuality::Nearest
                    },
                    self.alpha,
                    Transform::from_row(
                        stretch_x,
                        0.,
                        0.,
                        stretch_y,
                        part.left as f32,
                        part.top as f32,
                    ),
                ),
                ..tiny_skia::Paint::default()
            };
            let rect = tiny_skia::Rect::from_xywh(from.x, from.y, from.width, from.height);
            let (Some(mut drawn), Some(rect)) = (Layer::new(clip.rect), rect) else {
                return;
            };
            let matrix = placement.post_translate(-clip.rect.left as f32, -clip.rect.top as f32);
            drawn.pixmap.fill_rect(rect, &paint, matrix, None);
            layer.draw(&drawn, None, clip);
        });
    }
}

fn frame_is_unscaled(matrix: &Transform) -> bool {
    !matrix.has_skew() && (matrix.sx - 1.).abs() < 1e-5 && (matrix.sy - 1.).abs() < 1e-5
}

fn fill_rule(even_odd: u32) -> Fill {
    if even_odd != 0 {
        Fill::EvenOdd
    } else {
        Fill::NonZero
    }
}

/// From the y coordinate that was given down to the alphabetic baseline.
fn baseline_offset(baseline: u32, font: u32, size: f32) -> f32 {
    let ((em_ascent, em_descent), metrics) = (text::em_box(font, size), text::metrics(font, size));
    match baseline {
        1 => em_ascent,
        2 => metrics.ascent * 0.8,
        3 => (em_ascent - em_descent) / 2.,
        4 => -metrics.descent,
        5 => -em_descent,
        _ => 0.,
    }
}

impl Canvas {
    fn reset(&mut self, width: u32, height: u32) {
        let bounds = IntRect::new(0, 0, width.min(1 << 16) as i32, height.min(1 << 16) as i32);
        self.layer = Layer::new(bounds);
        if let Some(layer) = self.layer.as_mut().filter(|_| self.is_opaque) {
            layer.pixels_mut().fill([0, 0, 0, 255]);
        }
        (self.state, self.saved) = (State::new(bounds), Vec::new());
        self.version = self.version.wrapping_add(1);
    }

    fn set(&mut self, operation: u32, reader: &mut Reader) -> Option<()> {
        let state = &mut self.state;
        match operation {
            1 => self.saved.push(state.clone()),
            2 => *state = self.saved.pop()?,
            3 => state.matrix = reader.matrix()?,
            4 => state.fill = reader.style()?,
            5 => state.stroke = reader.style()?,
            6 => state.alpha = reader.next()? as f32,
            7 => state.mode = *MODES.get(reader.integer()? as usize)?,
            8 => {
                [state.line_width, state.miter_limit, state.dash_offset] = reader.floats()?;
                state.cap = *[Cap::Butt, Cap::Round, Cap::Square].get(reader.integer()? as usize)?;
                state.join =
                    *[Join::Miter, Join::Round, Join::Bevel].get(reader.integer()? as usize)?;
                state.dashes = (0..reader.integer()?)
                    .map(|_| Some(reader.next()? as f32))
                    .collect::<Option<_>>()?;
            }
            9 => {
                (state.shadow_offset, [state.shadow_blur]) = (reader.floats()?, reader.floats()?);
                state.shadow_color = reader.integer()?;
            }
            10 => state.is_smooth = reader.integer()? != 0,
            11 => {
                state.filters = (0..reader.integer()?)
                    .map(|_| reader.filter())
                    .collect::<Option<_>>()?
            }
            _ => {
                let (rule, path) = (fill_rule(reader.integer()?), reader.path()?);
                let area = IntRect::around(path_bounds(&path)).intersect(state.clip.rect);
                let coverage = Coverage::of_path(&path, rule, &Transform::identity(), area);
                state.clip = match coverage.data.iter().all(|value| *value == 255) {
                    true => state.clip.within_rect(coverage.rect),
                    false => state.clip.within(coverage),
                };
            }
        }
        Some(())
    }

    fn draw(
        &mut self,
        id: u32,
        operation: u32,
        reader: &mut Reader,
        texts: &mut Texts,
    ) -> Option<()> {
        let mut nothing = None;
        let target = match &mut self.layer {
            Some(layer) => layer,
            None => nothing.insert(Layer::new(IntRect::new(-1, -1, 0, 0))?),
        };
        let state = &self.state;
        match operation {
            13 => {
                let rule = fill_rule(reader.integer()?);
                state.fill_path(target, &reader.path()?, rule);
            }
            14 => {
                let path = reader.path()?;
                if let Some(inverse) = state.matrix.invert() {
                    state.stroke_path(target, &transformed(&path, &inverse));
                }
            }
            15 => state.fill_rect(target, reader.rect()?),
            16 => state.stroke_path(target, &rect_path(reader.rect()?)),
            17 => state.clear_rect(target, reader.rect()?, self.is_opaque),
            18 | 19 => {
                let (line, font, size) = reader.line(texts.next()?)?;
                let ([x, y, alignment, max_width], baseline) =
                    (reader.floats()?, reader.integer()?);
                let squeeze = if line.width > max_width {
                    max_width / line.width
                } else {
                    1.
                };
                let (x, y) = (
                    x - line.width * squeeze * alignment,
                    y + baseline_offset(baseline, font, size),
                );
                let matrix = state.matrix.pre_translate(x, y).pre_scale(squeeze, 1.);
                state.draw_text(target, &line, size, matrix, operation == 19);
            }
            20 => {
                let (image, size, from, to) = (
                    reader.integer()?,
                    reader.floats()?,
                    reader.rect()?,
                    reader.rect()?,
                );
                if image == id {
                    let copy = target.pixmap.clone();
                    state.draw_image(target, Content::Pixels(&copy), size, from, to);
                } else {
                    let draw =
                        |content: Content, _| state.draw_image(target, content, size, from, to);
                    images::with_first_frame(image, draw);
                }
            }
            _ => return None,
        }
        Some(())
    }
}

/// `text` has what the operations write, separated by U+0000.
pub fn draw(numbers: &[u8], text: &[u8]) {
    let mut texts = std::str::from_utf8(text).unwrap_or_default().split('\0');
    let mut reader = Reader {
        numbers: numbers.as_chunks().0.iter(),
    };
    let (mut id, mut current) = (0, None);
    let mut changed: Vec<u32> = Vec::new();
    let mut run = || {
        while let Some(operation) = reader.integer() {
            if operation == 0 {
                id = reader.integer()?;
                current = get(id);
                continue;
            }
            let canvas = &mut *current.as_ref()?.borrow_mut();
            if operation <= 12 {
                canvas.set(operation, &mut reader)?;
                continue;
            }
            if !changed.contains(&id) {
                changed.push(id);
            }
            canvas.version = canvas.version.wrapping_add(1);
            canvas.draw(id, operation, &mut reader, &mut texts)?;
        }
        Some(())
    };
    bridge::report(run().context("could not draw on a canvas"));
    changed.into_iter().for_each(surface::image_changed);
}

fn describe_font(arguments: &Value) -> u32 {
    let mut families = Vec::new();
    for family in arguments["families"].as_array().into_iter().flatten() {
        families.extend((family[1] == true).then_some(abi::GENERIC_FAMILY));
        families.extend(
            family[0]
                .as_str()
                .unwrap_or("")
                .bytes()
                .filter(|byte| *byte > abi::GENERIC_FAMILY),
        );
        families.push(0);
    }
    let number = |key: &str, otherwise: f32| {
        arguments[key]
            .as_f64()
            .map_or(otherwise, |number| number as f32)
    };
    let features = arguments["features"].as_array().into_iter().flatten();
    let tags = features.filter_map(|tag| tag.as_str()?.as_bytes().try_into().ok());
    text::describe(Description {
        scope: number("scope", 0.) as u32,
        stretch: number("stretch", 100.),
        style: number("style", 0.) as u8,
        kerning: arguments["kerning"] != false,
        features: tags.map(|tag| FontSetting { tag, value: 1. }).collect(),
        language: arguments["language"].as_str().unwrap_or("").into(),
        ..Description::new(&families, number("weight", 400.))
    })
}

/// From the operands of `Reader::line` and the baseline to the fields of `TextMetrics`.
pub fn measure(numbers: &[f64; 12], text: &[u8]) -> Option<[f64; 12]> {
    let numbers = numbers.map(f64::to_ne_bytes);
    let mut reader = Reader {
        numbers: numbers.iter(),
    };
    let (line, font, size) = reader.line(std::str::from_utf8(text).ok()?)?;
    let shift = baseline_offset(reader.integer()?, font, size);
    let (ink, (em_ascent, em_descent), metrics) = (
        line.ink_bounds(),
        text::em_box(font, size),
        text::metrics(font, size),
    );
    let fields = [
        line.width,
        -ink.x,
        ink.x + ink.width,
        -ink.y - shift,
        ink.y + ink.height + shift,
        metrics.ascent - shift,
        metrics.descent + shift,
        em_ascent - shift,
        em_descent + shift,
        metrics.ascent * 0.8 - shift,
        0. - shift,
        -metrics.descent - shift,
    ];
    Some(fields.map(f64::from))
}

/// `[x, y, evenOdd, path]`, or with `stroke`, `[x, y, matrix, the operands of operation 8, path]`.
fn hit_test(numbers: &[u8], strokes: bool) -> Option<bool> {
    const SAMPLES: f32 = 64.;
    let mut reader = Reader {
        numbers: numbers.as_chunks().0.iter(),
    };
    let [x, y] = reader.floats()?;
    // Whether anything is painted in a very small pixel around the point, so that the edge counts as inside.
    let zoom = Transform::from_row(
        SAMPLES,
        0.,
        0.,
        SAMPLES,
        0.5 - x * SAMPLES,
        0.5 - y * SAMPLES,
    );
    let pixel = IntRect::new(0, 0, 1, 1);
    let coverage = if strokes {
        let mut canvas = Canvas {
            layer: None,
            version: 0,
            is_opaque: false,
            state: State::new(pixel),
            saved: Vec::new(),
        };
        canvas.set(3, &mut reader)?;
        canvas.set(8, &mut reader)?;
        let path = transformed(&reader.path()?, &canvas.state.matrix.invert()?);
        Coverage::of_path(
            &path,
            canvas.state.pen(),
            &zoom.pre_concat(canvas.state.matrix),
            pixel,
        )
    } else {
        let rule = fill_rule(reader.integer()?);
        Coverage::of_path(&reader.path()?, rule, &zoom, pixel)
    };
    Some(*coverage.data.first()? != 0)
}

fn encode(
    width: u32,
    height: u32,
    premultiplied: Vec<u8>,
    format: &str,
    quality: f64,
) -> Result<Value> {
    let mut bytes = Vec::new();
    let mut image =
        RgbaImage::from_raw(width, height, premultiplied).context("the canvas is empty")?;
    if format == "image/jpeg" {
        // Premultiplied colors are those on black.
        let encoder = JpegEncoder::new_with_quality(
            &mut bytes,
            (quality * 100.).round().clamp(1., 100.) as u8,
        );
        DynamicImage::from(image)
            .into_rgb8()
            .write_with_encoder(encoder)?;
    } else {
        image
            .pixels_mut()
            .for_each(|pixel| pixel.0 = demultiply(pixel.0));
        match format {
            "image/webp" => image.write_with_encoder(WebPEncoder::new_lossless(&mut bytes))?,
            _ => image.write_with_encoder(PngEncoder::new(&mut bytes))?,
        }
    }
    Ok(bridge::put_blob(bytes).into())
}

fn area(arguments: &Value) -> IntRect {
    let number = |key: &str| arguments[key].as_f64().unwrap_or(0.) as f32;
    IntRect::nearest(Rect {
        x: number("x"),
        y: number("y"),
        width: number("width"),
        height: number("height"),
    })
}

/// A part of an image, a canvas or `blob` (RGBA), at another size.
fn snapshot(id: u32, arguments: &Value) -> Result<Pixmap> {
    let number = |key: &str| arguments[key].as_f64().unwrap_or(0.) as f32;
    let size = [number("sourceWidth"), number("sourceHeight")];
    let to = Rect {
        x: 0.,
        y: 0.,
        width: number("toWidth"),
        height: number("toHeight"),
    };
    let mut target = Layer::new(IntRect::nearest(to)).context("the image is empty or too large")?;
    let mut state = State::new(target.rect);
    state.is_smooth = arguments["pixelated"] != true;
    if arguments["flipY"] == true {
        state.matrix = Transform::from_row(1., 0., 0., -1., 0., to.height);
    }
    let mut draw = |content: Content, _| {
        state.draw_image(&mut target, content, size, area(arguments).to_rect(), to)
    };
    if arguments["blob"].is_u64() {
        let pixmap = images::pixmap_from_rgba(
            size[0] as u32,
            size[1] as u32,
            bridge::blob(&arguments["blob"])?,
        );
        draw(Content::Pixels(&pixmap.context("the image is empty")?), 0);
    } else {
        images::with_first_frame(id, draw);
    }
    Ok(target.pixmap)
}

pub fn command(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    let number = |key: &str| arguments[key].as_u64().unwrap_or(0) as u32;
    let id = number("id");
    match name {
        "create" => {
            let (state, is_opaque) = (State::new(IntRect::default()), arguments["opaque"] == true);
            let mut canvas = Canvas {
                layer: None,
                version: 0,
                is_opaque,
                state,
                saved: Vec::new(),
            };
            canvas.reset(number("width"), number("height"));
            let id = images::next_id();
            CANVASES.with_borrow_mut(|canvases| canvases.insert(id, Rc::new(RefCell::new(canvas))));
            return Ok(id.into());
        }
        "release" => {
            CANVASES.with_borrow_mut(|canvases| canvases.remove(&id));
            PATTERNS.with_borrow_mut(|patterns| patterns.remove(&id));
            return Ok(Value::Null);
        }
        "font" => return Ok(describe_font(arguments).into()),
        "hitTest" => {
            return Ok(json!(hit_test(
                &bridge::blob(&arguments["blob"])?,
                arguments["stroke"] == true
            )));
        }
        "bitmap" => return Ok(images::insert(snapshot(id, arguments)?).into()),
        "pattern" => {
            let (tile, pattern) = (Rc::new(snapshot(id, arguments)?), images::next_id());
            PATTERNS.with_borrow_mut(|patterns| patterns.insert(pattern, tile));
            return Ok(pattern.into());
        }
        _ => {}
    }
    let canvas = get(id).context("the canvas was released")?;
    let mut canvas = canvas.borrow_mut();
    match name {
        "erase" => {
            let blank = if canvas.is_opaque {
                [0, 0, 0, 255]
            } else {
                [0; 4]
            };
            canvas
                .layer
                .iter_mut()
                .for_each(|layer| layer.pixels_mut().fill(blank));
            canvas.version = canvas.version.wrapping_add(1);
        }
        "resize" => canvas.reset(number("width"), number("height")),
        "getImageData" => {
            let copy = match &canvas.layer {
                Some(layer) => layer.copy(area(arguments)),
                None => Layer::new(area(arguments)),
            };
            return Ok(bridge::put_blob(images::straight_rgba(
                &copy.context("the area is too large")?,
            ))
            .into());
        }
        "putImageData" => {
            let (rect, mut rgba) = (area(arguments), bridge::blob(&arguments["blob"])?);
            if canvas.is_opaque {
                rgba.as_chunks_mut::<4>()
                    .0
                    .iter_mut()
                    .for_each(|pixel| pixel[3] = 255);
            }
            let pixmap = images::pixmap_from_rgba(rect.width() as u32, rect.height() as u32, rgba);
            if let (Some(layer), Some(pixmap)) = (&mut canvas.layer, pixmap) {
                layer.replace(
                    &Layer { rect, pixmap },
                    &Clip::new(area(&arguments["dirty"])),
                );
            }
            canvas.version = canvas.version.wrapping_add(1);
        }
        "encode" => {
            let pixmap = canvas
                .layer
                .as_ref()
                .context("the canvas is empty")?
                .pixmap
                .clone();
            let (format, quality) = (
                arguments["type"].as_str().unwrap_or("").to_owned(),
                arguments["quality"].as_f64(),
            );
            let work = move || {
                encode(
                    pixmap.width(),
                    pixmap.height(),
                    pixmap.take(),
                    &format,
                    quality.unwrap_or(0.92),
                )
            };
            let Some(reply) = reply else { return work() };
            bridge::in_background(reply, work);
            return Ok(Value::Null);
        }
        _ => bail!("unknown command canvas.{name}"),
    }
    drop(canvas);
    surface::image_changed(id);
    Ok(Value::Null)
}
