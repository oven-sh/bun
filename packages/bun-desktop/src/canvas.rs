//! What `src/dom/api/canvas` draws on.

use std::cell::{Cell, RefCell};
use std::mem::MaybeUninit;
use std::ops::Range;
use std::rc::Rc;
use std::sync::{Arc, OnceLock};

use crate::abi::{self, Filter, GradientStop, Rect, Span, TextRun};
use crate::abi_graphics::{
    self as wire, Area, Baseline, Command, Pen, Snapshot, TextMetrics, TextStyle,
};
use crate::gfx::{self, Cap, Fill, Join, Pixmap, Point, Stroke, Transform, Walk as _};
use crate::hash::{FastMap, FastSet};
use crate::icc::Conversion;
use crate::images::{self, Content};
use crate::paint::batch::{self, Hides};
use crate::paint::blend::Mode as BlendMode;
use crate::paint::blur;
use crate::paint::edges::{Density, Edges, Shape};
use crate::paint::gradient::{Geometry, Gradient, Spread};
use crate::paint::raster::{
    Clip, Coverage, IntRect, Layer, Paint, Path, Pixel, Rows, View, are_opaque, average_scale,
    demultiply_row, map_point, map_rect, premultiply, scale, trace,
};
use crate::paint::scan::Scanner;
use crate::paint::scene::{Frame, intersect, outset};
use crate::paint::warp;
use crate::paint::{cpu, filter};
use crate::small_vec::SmallVec;
use crate::text::{self, Line};
use crate::{parallel, surface};

mod gpu;
mod outline;
mod parts;
mod sources;

use outline::Outline;
use sources::{Drawn, Glyphs, Images};

#[cfg(target_os = "macos")]
pub use gpu::picture;
pub use gpu::{do_chores, next_chore};

#[derive(Clone)]
enum Style {
    Color(u32),
    Gradient(Arc<Gradient>),
    Pattern {
        tile: Arc<Pixmap>,
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
    pen: Pen,
    dashes: Vec<f32>,
    shadow_offset: [f32; 2],
    shadow_blur: f32,
    shadow_color: u32,
    is_smooth: bool,
    /// Of the canvas.
    is_wide: bool,
    filters: Vec<Filter>,
    clip: Clip,
    /// What is not in the mask of `clip` yet.
    put_off: Option<Rc<gpu::ClipPath>>,
}

struct Canvas {
    /// `None` without pixels.
    layer: Option<Layer>,
    version: u32,
    /// Since `take_changes`.
    changed: IntRect,
    is_opaque: bool,
    is_read_often: bool,
    state: State,
    clips: Vec<SavedClip>,
    accelerated: Option<Box<gpu::Accelerated>>,
    known: gpu::Known,
    load: gpu::Load,
    /// For the rest of the frame, which may hide it.
    waiting: Option<Box<Batch>>,
    experience: batch::Experience,
}

thread_local! {
    static CANVASES: RefCell<FastMap<u32, Rc<RefCell<Canvas>>>> = RefCell::default();
    /// The windows were not told yet.
    static CHANGED: RefCell<FastSet<u32>> = RefCell::default();
    static BATCH: Cell<Batch> = Cell::default();
    static LINES: RefCell<Lines> = RefCell::default();
}

fn get(id: u32) -> Option<Rc<RefCell<Canvas>>> {
    CANVASES.with_borrow(|canvases| canvases.get(&id).cloned())
}

/// With its pixels in the layer.
fn settled(id: u32) -> Option<Rc<RefCell<Canvas>>> {
    get(id).inspect(|it| {
        it.try_borrow_mut()
            .into_iter()
            .for_each(|mut it| it.settle())
    })
}

pub fn release_memory() {
    gpu::stop();
    batch::release_memory();
    BATCH.take();
    LINES.take();
}

pub fn size_and_version(id: u32) -> Option<((u32, u32), u32)> {
    let canvas = get(id)?;
    let canvas = canvas.try_borrow().ok()?;
    canvas.layer.as_ref().map(|it| {
        (
            (it.rect.right as u32, it.rect.bottom as u32),
            canvas.version,
        )
    })
}

pub fn is_wide(id: u32) -> bool {
    WIDE.with_borrow(|it| it.contains(&id))
}

pub fn with_pixels<R>(id: u32, f: impl FnOnce(&Pixmap, u32) -> R) -> Option<R> {
    let canvas = settled(id)?;
    let canvas = canvas.try_borrow().ok()?;
    Some(f(&canvas.layer.as_ref()?.pixmap, canvas.version))
}

/// They are copied if the canvas changes.
pub fn share(id: u32) -> Option<Pixmap> {
    let canvas = settled(id)?;
    let mut canvas = canvas.try_borrow_mut().ok()?;
    let pixmap = &mut canvas.layer.as_mut()?.pixmap;
    pixmap.allow_sharing();
    pixmap.shared()
}

thread_local! {
    static LAST_TO_WAIT: Cell<u32> = const { Cell::new(0) };
    static PATTERNS: RefCell<FastMap<u32, Arc<Pixmap>>> = RefCell::default();
    /// The canvases and the tiles that are in Display P3.
    static WIDE: RefCell<FastSet<u32>> = RefCell::default();
}

/// Of anything that has such a number.
pub fn release(id: u32) {
    CANVASES.with_borrow_mut(|canvases| canvases.remove(&id));
    PATTERNS.with_borrow_mut(|patterns| patterns.remove(&id));
    WIDE.with_borrow_mut(|it| it.remove(&id));
    images::release(id);
    gpu::forget(id);
}

/// `f` gets the size, the area, and its rows.
pub fn take_changes(
    id: u32,
    everything: bool,
    f: impl FnOnce([u32; 2], [u32; 4], &mut dyn Iterator<Item = &[Pixel]>),
) -> Option<()> {
    let canvas = settled(id)?;
    let canvas = &mut *canvas.borrow_mut();
    let changed = std::mem::take(&mut canvas.changed);
    let Some(layer) = &canvas.layer else {
        f([0; 2], [0; 4], &mut std::iter::empty());
        return Some(());
    };
    let area = Some(if everything {
        layer.rect
    } else {
        changed.intersect(layer.rect)
    })
    .filter(|it| !it.is_empty())
    .unwrap_or_default();
    let numbers = [
        area.left,
        area.top,
        area.right - area.left,
        area.bottom - area.top,
    ]
    .map(|it| it as u32);
    let mut narrow = layer.copy(area).filter(|_| canvas.state.is_wide);
    narrow
        .iter_mut()
        .for_each(|it| Conversion::between(false).apply(it.pixels_mut()));
    let (size, layer) = (
        [layer.pixmap.width(), layer.pixmap.height()],
        narrow.as_ref().unwrap_or(layer),
    );
    f(
        size,
        numbers,
        &mut (area.top..area.bottom).map(|y| layer.row(y, area.left, area.right)),
    );
    Some(())
}

pub fn set_wide(id: u32, is_now: bool) {
    if is_wide(id) != is_now {
        images::note_wide();
        WIDE.with_borrow_mut(|it| {
            if is_now {
                it.insert(id)
            } else {
                it.remove(&id)
            }
        });
        get(id).inspect(|it| it.borrow_mut().state.is_wide = is_now);
    }
}

/// What another process has drawn.
pub fn show(id: u32, size: [u32; 2], [left, top]: [u32; 2], pixels: Option<Pixmap>) {
    let canvas = CANVASES.with_borrow_mut(|canvases| {
        canvases
            .entry(id)
            .or_insert_with(|| Rc::new(RefCell::new(Canvas::new(false, false, false))))
            .clone()
    });
    let mut canvas = canvas.borrow_mut();
    let [left, top, width, height] = [left, top, size[0], size[1]].map(|it| it as i32);
    let all = IntRect::new(0, 0, width, height);
    let part = pixels.map(|it| Layer {
        rect: IntRect::new(
            left,
            top,
            left + it.width() as i32,
            top + it.height() as i32,
        ),
        pixmap: it,
    });
    match part {
        Some(part) if part.rect == all => canvas.layer = Some(part),
        part => {
            if canvas.layer.as_ref().is_none_or(|it| it.rect != all) {
                canvas.reset(size);
            }
            if let (Some(layer), Some(part)) = (&mut canvas.layer, part) {
                layer.replace(&part, &Clip::new(part.rect));
            }
        }
    }
    (canvas.version, canvas.changed) = (canvas.version.wrapping_add(1), all);
    drop(canvas);
    surface::image_changed(id);
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
    color & !0xFF | ((color & 0xFF) as f32 * alpha + 0.5) as u32
}

#[inline]
fn pixel_of(color: u32, alpha: f32) -> Pixel {
    let color = if alpha == 1. {
        color
    } else {
        with_alpha(color, alpha)
    };
    if color & 0xFF == 0xFF {
        color.to_be_bytes()
    } else {
        scale((color | 0xFF).to_be_bytes(), color as u8)
    }
}

fn fade(row: &mut [Pixel], alpha: f32) {
    if alpha < 1. {
        let alpha = (alpha * 255.).round() as u8;
        row.iter_mut()
            .for_each(|pixel| *pixel = scale(*pixel, alpha));
    }
}

fn path_bounds(path: &Path) -> Rect {
    gfx::bounds(path)
}

/// Where a very long side ends is not known.
fn around(bounds: Rect) -> IntRect {
    const LONG: f32 = 1e6;
    const FAR: i32 = 1 << 28;
    let mut pixels = IntRect::around(bounds);
    if bounds.width > LONG {
        (pixels.left, pixels.right) = (-FAR, FAR);
    }
    if bounds.height > LONG {
        (pixels.top, pixels.bottom) = (-FAR, FAR);
    }
    pixels
}

fn transformed(path: &Path, by: &Transform) -> Path {
    path.iter().map(|command| command.transform(by)).collect()
}

/// Without the segments that have no length, and the subpaths that have nothing else.
fn prune(path: impl gfx::Walk, kept: &mut Path) {
    use gfx::Command::{Close, CurveTo, LineTo, MoveTo, QuadTo};
    let (mut at, mut start, mut has_segments) = (Point::ZERO, Point::ZERO, false);
    path.walk(|command| {
        let end = match command {
            MoveTo(to) => return (at, start, has_segments) = (to, to, false),
            Close => {
                kept.extend(has_segments.then_some(Close));
                return (at, has_segments) = (start, false);
            }
            LineTo(to) if to != at => to,
            QuadTo(a, to) if a != at || to != at => to,
            CurveTo(a, b, to) if a != at || b != at || to != at => to,
            _ => return,
        };
        kept.extend((!has_segments).then_some(MoveTo(at)));
        kept.push(command);
        (at, has_segments) = (end, true);
    });
}

fn rect_commands(
    Rect {
        x,
        y,
        width,
        height,
    }: Rect,
) -> [gfx::Command; 6] {
    let line = |x, y| gfx::Command::LineTo(Point::new(x, y));
    [
        gfx::Command::MoveTo(Point::new(x, y)),
        line(x + width, y),
        line(x + width, y + height),
        line(x, y + height),
        line(x, y),
        gfx::Command::Close,
    ]
}

fn is_upright_rect(path: &[gfx::Command]) -> bool {
    use gfx::Command::{Close, LineTo, MoveTo};
    let [MoveTo(a), LineTo(b), LineTo(c), LineTo(d), ref rest @ ..] = *path else {
        return false;
    };
    matches!(rest, [] | [Close] | [Close, MoveTo(_)])
        && ([a.y, b.x, c.y, d.x] == [b.y, c.x, d.y, a.x]
            || [a.x, b.y, c.x, d.y] == [b.x, c.y, d.x, a.y])
}

fn rect_path(rect: Rect) -> Path {
    rect_commands(rect).into()
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

impl Style {
    /// What the weight of text depends on.
    fn shade(&self) -> u32 {
        match self {
            Style::Color(color) => *color,
            Style::Gradient(gradient) => gradient.average(),
            Style::Pattern { .. } => 0xFF,
        }
    }

    fn with_paint(&self, matrix: &Transform, alpha: f32, is_smooth: bool, f: impl FnOnce(&Paint)) {
        match self {
            Style::Color(color) => f(&Paint::Solid(premultiply(with_alpha(*color, alpha)))),
            Style::Gradient(gradient) => {
                let Some(inverse) = matrix.invert() else {
                    return;
                };
                f(&Paint::Shader(&|x, y, row| {
                    gradient.shade(&inverse, x, y, row);
                    fade(row, alpha);
                }))
            }
            Style::Pattern {
                tile,
                repeats,
                matrix: by,
            } => {
                let Some(inverse) = matrix.pre_concat(*by).invert() else {
                    return;
                };
                f(&Paint::Shader(&|left, y, row| {
                    for (x, pixel) in (left..).zip(row.iter_mut()) {
                        let (x, y) = map_point(&inverse, x as f32 + 0.5, y as f32 + 0.5);
                        *pixel = sample(tile, *repeats, x, y, is_smooth);
                    }
                    fade(row, alpha);
                }))
            }
        }
    }
}

type SavedClip = (Clip, Option<Rc<gpu::ClipPath>>);

enum Onto<'a> {
    Layer(&'a mut Layer),
    /// One that is just large enough.
    NewLayer(&'a mut Option<Layer>),
}

impl<'a> Onto<'a> {
    fn for_area(self, area: IntRect) -> Option<&'a mut Layer> {
        match self {
            Onto::Layer(it) => Some(it),
            Onto::NewLayer(it) => Layer::new(area).map(|new| it.insert(new)),
        }
    }
}

impl State {
    fn new(bounds: IntRect, is_wide: bool) -> State {
        State {
            matrix: Transform::identity(),
            fill: Style::Color(0xFF),
            stroke: Style::Color(0xFF),
            alpha: 1.,
            mode: BlendMode::SourceOver,
            pen: Pen {
                width: 1.,
                miter_limit: 10.,
                dash_offset: 0.,
                cap: wire::Cap::Butt,
                join: wire::Join::Miter,
            },
            dashes: Vec::new(),
            shadow_offset: [0.; 2],
            shadow_blur: 0.,
            shadow_color: 0,
            is_smooth: true,
            filters: Vec::new(),
            clip: Clip::new(bounds),
            put_off: None,
            is_wide,
        }
    }

    fn has_shadow(&self) -> bool {
        self.shadow_color & 0xFF != 0 && (self.shadow_blur > 0. || self.shadow_offset != [0.; 2])
    }

    fn pen(&self) -> Stroke<'_> {
        stroke(self.pen, &self.dashes)
    }

    fn with_paint(&self, style: &Style, f: impl FnOnce(&Paint)) {
        style.with_paint(&self.matrix, self.alpha, self.is_smooth, f);
    }

    /// For drawing something with these bounds.
    fn clip_for(&self, bounds: IntRect) -> Clip {
        if self.mode == BlendMode::Clear {
            self.clip.within_rect(bounds)
        } else {
            self.clip.clone()
        }
    }

    fn has_effects(&self) -> bool {
        self.has_shadow() || !self.filters.is_empty()
    }

    /// `draw` paints with source-over inside of `bounds`, which are in device pixels.
    fn compose(&self, target: Onto, bounds: Rect, draw: impl FnOnce(&mut Layer, &Clip)) {
        let bounds = around(bounds);
        if self.mode == BlendMode::SourceOver && !self.has_effects() {
            let clip = self.clip.within_rect(bounds);
            return target
                .for_area(clip.rect)
                .into_iter()
                .next()
                .map_or((), |it| draw(it, &clip));
        }
        let (sigma, [dx, dy]) = (
            (self.shadow_blur / 2.).min(blur::MAX_SIGMA_OF_SHADOWS),
            self.shadow_offset
                .map(|offset| offset.round().clamp(-1e8, 1e8) as i32),
        );
        let filter_reach = cpu::filter_reach(&self.filters, &Transform::identity());
        let shadow_reach = if self.has_shadow() {
            blur::extent(sigma)
        } else {
            0
        };
        let mut needed = self.clip.rect;
        if self.has_shadow() {
            needed = needed.union(needed.offset(-dx, -dy).outset(shadow_reach));
        }
        let (area, filtered) = (
            bounds.intersect(needed.outset(filter_reach)),
            bounds.outset(filter_reach),
        );
        let affected = if self.has_shadow() {
            filtered.union(filtered.offset(dx, dy).outset(shadow_reach))
        } else {
            filtered
        };
        let Some(target) = target.for_area(affected.intersect(self.clip.rect)) else {
            return;
        };
        let mut blend = |source: &Layer| match self.mode {
            BlendMode::SourceOver => target.draw(source, None, &self.clip),
            mode => target.draw_with_mode(source, mode, &self.clip_for(source.rect)),
        };
        let Some(mut source) = Layer::new(area).or_else(|| Layer::new(IntRect::new(-1, -1, 0, 0)))
        else {
            return;
        };
        draw(&mut source, &Clip::new(area));
        filter::apply(
            &mut source,
            &self.filters,
            &Transform::identity(),
            needed,
            &Frame::new(1., false),
        );
        if self.has_shadow()
            && let cast = source.rect.offset(dx, dy)
            && let Some(mut shadow) =
                Layer::new(cast.outset(shadow_reach).intersect(self.clip.rect))
                    .or_else(|| Layer::new(IntRect::new(-1, -1, 0, 0)))
        {
            let shape = Coverage {
                rect: cast,
                ..source.alpha()
            }
            .blurred(sigma, shadow.rect);
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
    fn fill_path(&self, target: Onto, path: &Path, rule: Fill) {
        self.compose(target, path_bounds(path), |layer, clip| {
            self.with_paint(&self.fill, |paint| {
                layer.fill_path(path, rule, &Transform::identity(), clip, paint)
            });
        });
    }

    /// `path` is in the space of `matrix`.
    fn stroke_path(&self, target: Onto, path: &Path, glyphs: Option<(&text::Face, f32)>) {
        let mut kept = Path::new();
        prune(path.iter().copied(), &mut kept);
        let path = &kept;
        let reach = self.pen.width
            * if self.pen.join == wire::Join::Miter {
                self.pen.miter_limit.max(1.5)
            } else {
                1.5
            }
            / 2.;
        self.compose(
            target,
            outset(map_rect(&self.matrix, outset(path_bounds(path), reach)), 1.),
            |layer, clip| {
                let Some((face, size)) = glyphs else {
                    return self.with_paint(&self.stroke, |paint| {
                        layer.fill_path(path, self.pen(), &self.matrix, clip, paint)
                    });
                };
                let mut coverage = Coverage::of_path(path, self.pen(), &self.matrix, clip.rect);
                text::correct_stroke(face, size, self.stroke.shade(), &mut coverage.data);
                self.with_paint(&self.stroke, |paint| {
                    layer.fill_coverage(&coverage, clip, paint)
                });
            },
        );
    }

    fn fill_rect(&self, target: Onto, rect: Rect) {
        let device = map_rect(&self.matrix, rect);
        let pixels = IntRect::nearest(device);
        if let (Style::Color(color), BlendMode::SourceOver, None) =
            (&self.fill, self.mode, &self.clip.mask)
            && !self.matrix.has_skew()
            && !self.has_effects()
        {
            let Some(target) = target.for_area(IntRect::around(device).intersect(self.clip.rect))
            else {
                return;
            };
            return target.fill_rect(
                device,
                premultiply(with_alpha(*color, self.alpha)),
                self.clip.rect,
            );
        }
        if self.matrix.has_skew() || pixels.to_rect() != device {
            return self.fill_path(
                target,
                &transformed(&rect_path(rect), &self.matrix),
                Fill::NonZero,
            );
        }
        if let (Style::Color(color), false) = (
            &self.fill,
            self.mode == BlendMode::SourceOver || self.has_effects(),
        ) {
            let Some(target) = target.for_area(pixels.intersect(self.clip.rect)) else {
                return;
            };
            return target.combine(
                pixels,
                &Rows::Same(premultiply(with_alpha(*color, self.alpha))),
                self.mode,
                &self.clip_for(pixels),
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
        target.combine(
            clip.rect,
            &Rows::Same([0, 0, 0, if is_opaque { 255 } else { 0 }]),
            BlendMode::Source,
            &clip,
        );
    }

    fn draw_text(&self, target: Onto, line: &Line, size: f32, matrix: Transform, strokes: bool) {
        if strokes {
            let Some(inverse) = self.matrix.invert() else {
                return;
            };
            let face = line.runs.first().and_then(|it| text::face(it.0.id));
            return self.stroke_path(
                target,
                &transformed(&line.path(), &inverse.pre_concat(matrix)),
                face.zip(Some(size * average_scale(&matrix))),
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
                    draw(&mut shape, &Clip::new(clip.rect), style.shade());
                    self.with_paint(style, |paint| {
                        layer.fill_coverage(&shape.alpha(), clip, paint)
                    });
                }
            },
        );
    }

    /// `from` is in an image of `size`.
    fn draw_image(&self, target: Onto, content: Content, size: [f32; 2], from: Rect, to: Rect) {
        let pixels = if let Content::Pixels(it) = content {
            [it.width() as f32, it.height() as f32]
        } else {
            size
        };
        let (
            Placed {
                from,
                part,
                placement,
                shift,
            },
            all,
        ) = (
            Placed::new(&self.matrix, size, pixels, from, to),
            Rect {
                x: 0.,
                y: 0.,
                width: pixels[0],
                height: pixels[1],
            },
        );
        let (is_copy, [dx, dy], is_masked) = (
            shift.is_some(),
            shift.unwrap_or_default(),
            self.mode == BlendMode::SourceOver && self.clip.mask.is_some(),
        );
        if let (Content::Pixels(pixmap), true) =
            (&content, is_copy && !is_masked && !self.has_effects())
        {
            let (rect, by) = (
                part.offset(dx, dy),
                (self.alpha.min(1.) * 255.).round() as u8,
            );
            let Some(target) = target.for_area(rect.intersect(self.clip.rect)) else {
                return;
            };
            return target.combine(
                rect,
                &Rows::Of(pixmap, [dx, dy], by),
                self.mode,
                &self.clip_for(rect),
            );
        }
        self.compose(target, map_rect(&placement, from), |layer, clip| {
            let pixmap = match content {
                Content::Pixels(pixmap) => pixmap,
                Content::Svg(svg) => {
                    let Some(mut drawn) = Layer::new(clip.rect) else {
                        return;
                    };
                    svg.draw(&mut drawn, all, &placement, &Frame::new(1., false));
                    if self.is_wide {
                        Conversion::between(true).apply(drawn.pixels_mut());
                    }
                    drawn.scale_alpha(self.alpha);
                    let shape =
                        Coverage::of_path(&rect_path(from), Fill::NonZero, &placement, clip.rect);
                    return layer.draw(&drawn, Some(&shape), clip);
                }
            };
            if is_copy {
                let pixels: &[Pixel] = pixmap.data().as_chunks().0;
                let copy = |x: i32, y: i32, row: &mut [Pixel]| {
                    let start = (y - dy) as usize * pixmap.width() as usize + (x - dx) as usize;
                    row.copy_from_slice(&pixels[start..start + row.len()]);
                    fade(row, self.alpha);
                };
                return layer.fill(part.offset(dx, dy), None, clip, &Paint::Shader(&copy));
            }
            // What is around the part does not bleed into it.
            let is_all = part.to_rect() == all;
            let cropped = if is_all {
                None
            } else {
                pixmap.cropped(part.left, part.top, part.right, part.bottom)
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
            let stretch = Transform::from_row(
                stretch_x,
                0.,
                0.,
                stretch_y,
                part.left as f32,
                part.top as f32,
            );
            let Some(mut drawn) = Layer::new(clip.rect) else {
                return;
            };
            warp::draw(
                &mut drawn,
                pixmap,
                from,
                stretch,
                &placement,
                self.is_smooth,
            );
            drawn.scale_alpha(self.alpha);
            layer.draw(&drawn, None, clip);
        });
    }

    fn draw(&self, target: Onto, command: Command, list: &Owned) {
        match command {
            Command::Fill { verbs, is_even_odd } => {
                self.fill_path(target, &list.path(verbs), fill_rule(is_even_odd))
            }
            Command::Stroke { verbs } => {
                if let Some(inverse) = self.matrix.invert() {
                    self.stroke_path(target, &transformed(&list.path(verbs), &inverse), None);
                }
            }
            Command::FillRect(rect) => self.fill_rect(target, upright(rect)),
            Command::StrokeRect(rect) => self.stroke_path(target, &rect_path(upright(rect)), None),
            Command::Text {
                text,
                style,
                at,
                alignment,
                max_width,
                strokes,
            } => {
                let (line, matrix) = place_text(
                    &list.text[text.range()],
                    &style,
                    &self.matrix,
                    at,
                    alignment,
                    max_width,
                );
                self.draw_text(target, &line, style.size, matrix, strokes);
            }
            Command::Image {
                image,
                size,
                from,
                to,
            } => {
                if self.mode == BlendMode::Source {
                    allow_sharing(image);
                }
                images::with_first_frame(image, |content, _| {
                    self.draw_image(target, content, size, upright(from), upright(to))
                });
            }
            _ => {}
        }
    }
}

/// Where a part of an image goes.
struct Placed {
    /// In its pixels, and within them.
    from: Rect,
    part: IntRect,
    placement: Transform,
    /// If that is all, and by whole pixels.
    shift: Option<[i32; 2]>,
}

impl Placed {
    #[inline]
    fn new(matrix: &Transform, size: [f32; 2], pixels: [f32; 2], from: Rect, to: Rect) -> Placed {
        let (x, y) = (pixels[0] / size[0], pixels[1] / size[1]);
        let from = Rect {
            x: from.x * x,
            y: from.y * y,
            width: from.width * x,
            height: from.height * y,
        };
        let (x, y, origin) = (
            to.width / from.width,
            to.height / from.height,
            matrix.map(Point::new(to.x, to.y)),
        );
        let scaled = Transform::from_row(
            matrix.sx * x,
            matrix.ky * x,
            matrix.kx * y,
            matrix.sy * y,
            0.,
            0.,
        );
        let back = scaled.map(Point::new(from.x, from.y));
        let placement = scaled.post_translate(origin.x - back.x, origin.y - back.y);
        let from = intersect(
            from,
            Rect {
                x: 0.,
                y: 0.,
                width: pixels[0],
                height: pixels[1],
            },
        );
        let (part, dx, dy) = (
            IntRect::around(from),
            placement.tx.round(),
            placement.ty.round(),
        );
        let is_copy = frame_is_unscaled(&placement)
            && (placement.tx - dx).abs() + (placement.ty - dy).abs() < 1e-3
            && part.to_rect() == from
            && dx.abs().max(dy.abs()) < 1e9;
        Placed {
            from,
            part,
            placement,
            shift: is_copy.then_some([dx as i32, dy as i32]),
        }
    }
}

fn frame_is_unscaled(matrix: &Transform) -> bool {
    !matrix.has_skew() && (matrix.sx - 1.).abs() < 1e-5 && (matrix.sy - 1.).abs() < 1e-5
}

fn fill_rule(is_even_odd: bool) -> Fill {
    if is_even_odd {
        Fill::EvenOdd
    } else {
        Fill::NonZero
    }
}

fn matrix([a, b, c, d, e, f]: abi::Matrix) -> Transform {
    Transform::from_row(a, b, c, d, e, f)
}

fn upright(
    Rect {
        x,
        y,
        width,
        height,
    }: Rect,
) -> Rect {
    Rect {
        x: x.min(x + width),
        y: y.min(y + height),
        width: width.abs(),
        height: height.abs(),
    }
}

fn pixels([x, y, width, height]: Area) -> IntRect {
    IntRect {
        left: x,
        top: y,
        right: x.saturating_add(width),
        bottom: y.saturating_add(height),
    }
}

fn line(text: &str, style: &TextStyle) -> Line {
    let TextStyle {
        font,
        size,
        letter_spacing,
        word_spacing,
        ..
    } = *style;
    let run = TextRun {
        end: text.len() as u32,
        font,
        size,
        letter_spacing,
        word_spacing,
        word_break: abi::BREAK_NORMAL,
    };
    Line::new(text, run, style.is_right_to_left.into())
}

/// What was drawn recently, with `baseline_offset`.
#[derive(Default)]
struct Lines {
    fonts: u32,
    known: FastMap<Box<[u8]>, Vec<Shaped>>,
}

type Shaped = (TextStyle, Rc<Line>, f32);

fn place_text(
    text: &[u8],
    style: &TextStyle,
    matrix: &Transform,
    [x, y]: [f32; 2],
    alignment: f32,
    max_width: f32,
) -> (Rc<Line>, Transform) {
    const MAX_KNOWN: usize = 2048;
    const MAX_STYLES: usize = 4;
    const MAX_LENGTH: usize = 200;
    let (line, offset) = LINES.with_borrow_mut(|Lines { fonts, known }| {
        if std::mem::replace(fonts, text::generation()) != *fonts || known.len() > MAX_KNOWN {
            known.clear();
        }
        if let Some((_, line, offset)) = known
            .get(text)
            .and_then(|it| it.iter().find(|it| it.0 == *style))
        {
            return (line.clone(), *offset);
        }
        let line = Rc::new(line(std::str::from_utf8(text).unwrap_or_default(), style));
        let offset = baseline_offset(&text::levels(style.font, style.size), style.baseline);
        if text.len() <= MAX_LENGTH {
            let styles = known.entry(text.into()).or_default();
            styles.truncate(MAX_STYLES - 1);
            styles.insert(0, (*style, line.clone(), offset));
        }
        (line, offset)
    });
    let squeeze = if line.width > max_width {
        max_width / line.width
    } else {
        1.
    };
    let matrix = matrix
        .pre_translate(x - line.width * squeeze * alignment, y + offset)
        .pre_scale(squeeze, 1.);
    (line, matrix)
}

/// From the y coordinate that was given down to the alphabetic baseline.
fn baseline_offset(levels: &text::Levels, baseline: Baseline) -> f32 {
    match baseline {
        Baseline::Alphabetic => levels.alphabetic,
        Baseline::Top => levels.em_ascent,
        Baseline::Hanging => levels.hanging,
        Baseline::Middle => (levels.em_ascent - levels.em_descent) / 2.,
        Baseline::Ideographic => levels.ideographic,
        Baseline::Bottom => -levels.em_descent,
    }
}

enum Figure {
    Fill(Span, Fill),
    Stroke(Span, Pen),
    StrokeRect(Rect, Pen),
    TurnedRect(Rect),
    FillPart(Span, Option<Point>),
    /// With the offset of the dashes.
    StrokePart(Span, Option<Point>, f32),
    /// In `Batch::links`.
    LastPart(Range<u32>, IntRect, Fill),
    /// In pixels, as are those below.
    Rect(Rect),
    AlignedRect(IntRect),
    Disc([f32; 2], f32),
    Clear(IntRect),
    Glyphs(Range<u32>, IntRect),
    /// The ink has the opacity.
    Image(Drawn),
}

enum Ink {
    Solid(Pixel),
    /// In `Batch::styles`.
    Style(u32),
}

struct Job {
    figure: Figure,
    ink: Ink,
    /// In `Batch::settings`.
    setting: u32,
}

type PutOffClip = (Arc<gpu::Mask>, OnceLock<Clip>);

/// What changes less often.
#[derive(Clone)]
struct Setting {
    matrix: Transform,
    inverse: Option<Transform>,
    /// With what is missing of it, and all.
    clip: (Clip, Option<PutOffClip>),
    dashes: Vec<f32>,
    alpha: f32,
    is_smooth: bool,
    mode: BlendMode,
    /// In `Batch::lists`.
    list: u32,
}

impl Setting {
    #[inline]
    fn clip(&self) -> &Clip {
        match &self.clip {
            (clip, None) => clip,
            (clip, Some((mask, all))) => all.get_or_init(|| mask.get().within_rect(clip.rect)),
        }
    }
}

/// What has no effects waits here for more of its kind.
#[derive(Default)]
struct Batch {
    shared: Shared,
    lists: Vec<Rc<Owned>>,
    has_setting: bool,
    /// The one that clips, because it is what is filled.
    ignores_path: bool,
    /// That are only kept for the jobs, at most.
    bytes: usize,
}

#[derive(Default)]
struct Shared {
    jobs: Vec<Job>,
    settings: Vec<Setting>,
    styles: Vec<Style>,
    links: Path,
    /// For the parts of strokes, by the first job that it is for.
    pens: Vec<(usize, Pen)>,
    glyphs: Glyphs,
    images: Images,
}

impl Batch {
    const MAX_BYTES: usize = 8 << 20;

    #[inline]
    fn add(&mut self, state: &State, figure: Figure, style: &Style, list: &Rc<Owned>) {
        let ink = match style {
            Style::Color(color) => Ink::Solid(pixel_of(*color, state.alpha)),
            style => {
                self.shared.styles.push(style.clone());
                Ink::Style(self.shared.styles.len() as u32 - 1)
            }
        };
        self.add_in(state, figure, ink, list);
    }

    #[inline]
    fn add_in(&mut self, state: &State, figure: Figure, ink: Ink, list: &Rc<Owned>) {
        let Shared { jobs, settings, .. } = &mut self.shared;
        if !std::mem::replace(&mut self.has_setting, true) {
            if !self.lists.last().is_some_and(|it| Rc::ptr_eq(it, list)) {
                self.bytes += if self.lists.is_empty() {
                    0
                } else {
                    list.bytes()
                };
                self.lists.push(list.clone());
            }
            let State {
                matrix,
                alpha,
                is_smooth,
                mode,
                ..
            } = *state;
            let missing = state
                .put_off
                .as_ref()
                .filter(|_| !self.ignores_path)
                .map(|it| it.mask(&state.clip));
            self.bytes += missing
                .as_ref()
                .filter(|it| Arc::strong_count(it) == 2)
                .map_or(0, |_| state.clip.rect.area() as usize);
            let known = settings.last().and_then(|it| it.clip.0.mask.as_ref());
            let mask = state
                .clip
                .mask
                .as_ref()
                .filter(|it| !known.is_some_and(|known| Arc::ptr_eq(known, it)));
            self.bytes += size_of_val(&state.dashes[..]) + mask.map_or(0, |it| it.data.len());
            settings.push(Setting {
                matrix,
                inverse: matrix.invert(),
                clip: (state.clip.clone(), missing.map(|it| (it, OnceLock::new()))),
                dashes: state.dashes.clone(),
                alpha,
                is_smooth,
                mode,
                list: self.lists.len() as u32 - 1,
            });
        }
        jobs.push(Job {
            figure,
            ink,
            setting: settings.len() as u32 - 1,
        });
    }

    /// False unless it is better that way.
    #[cold]
    fn add_in_parts(
        &mut self,
        state: &State,
        verbs: Span,
        rule: Option<Fill>,
        list: &Rc<Owned>,
    ) -> bool {
        let (pen, scale, period) = (
            state.pen,
            state.matrix.sx.abs(),
            state.dashes.iter().sum::<f32>(),
        );
        let stroke = parts::Stroke {
            width: pen.width * scale,
            dashes: if period > 0. {
                state.dashes.len() as f32 / 2. / period / scale
            } else {
                0.
            },
            may_be_cut: pen.cap == wire::Cap::Butt
                || (pen.cap, pen.join) == (wire::Cap::Round, wire::Join::Round),
        };
        if rule.is_none()
            && (state.matrix.has_skew() || scale != state.matrix.sy.abs() || scale == 0.)
        {
            return false;
        }
        let Some(parts) = parts::split(
            &list.parts,
            verbs,
            state.clip.rect,
            rule.is_none().then_some(stroke),
        ) else {
            return false;
        };
        self.shared
            .pens
            .extend(rule.is_none().then_some((self.shared.jobs.len(), pen)));
        for part in parts.all {
            let (from, along) = part.from.unzip();
            let offset = (f64::from(pen.dash_offset) + along.unwrap_or(0.) / f64::from(scale))
                .rem_euclid(period.max(f32::MIN_POSITIVE).into()) as f32;
            self.add_in(
                state,
                if rule.is_some() {
                    Figure::FillPart(part.verbs, from)
                } else {
                    Figure::StrokePart(part.verbs, from, offset)
                },
                Ink::Solid([0; 4]),
                list,
            );
        }
        let first = self.shared.links.len() as u32;
        for link in parts.links {
            self.shared
                .links
                .extend(link.iter().enumerate().map(|(index, it)| {
                    if index == 0 {
                        gfx::Command::MoveTo(*it)
                    } else {
                        gfx::Command::LineTo(*it)
                    }
                }));
        }
        let reach = if rule.is_some() {
            0.
        } else {
            stroke.width
                * if pen.join == wire::Join::Miter {
                    pen.miter_limit.max(1.5)
                } else {
                    1.5
                }
                / 2.
        };
        let figure = Figure::LastPart(
            first..self.shared.links.len() as u32,
            around(outset(parts.bounds, reach + 10.)),
            rule.unwrap_or(Fill::NonZero),
        );
        self.add(
            state,
            figure,
            if rule.is_some() {
                &state.fill
            } else {
                &state.stroke
            },
            list,
        );
        true
    }

    fn is_full(&self) -> bool {
        let [all, largest] = self.shared.images.bytes;
        self.bytes + self.shared.glyphs.bytes() > Self::MAX_BYTES
            || all - largest > Self::MAX_BYTES * 3
    }

    fn paint(&mut self, canvas: &mut Canvas) {
        if self.shared.jobs.is_empty() && self.shared.images.is_empty() {
            return self.shared.glyphs.clear();
        }
        if let Some(layer) = &mut canvas.layer {
            let parts: SmallVec<_, 4> = self.lists.iter().map(|it| &it.parts[..]).collect();
            canvas.changed = canvas.changed.union(batch::paint(
                layer,
                &(&self.shared, &parts[..]),
                &mut canvas.experience,
            ));
        }
        self.clear();
    }

    fn clear(&mut self) {
        let Shared {
            jobs,
            settings,
            styles,
            links,
            pens,
            glyphs,
            images,
        } = &mut self.shared;
        jobs.clear();
        links.clear();
        pens.clear();
        settings.clear();
        styles.clear();
        glyphs.clear();
        images.clear();
        self.lists.clear();
        (self.has_setting, self.bytes) = (false, 0);
    }
}

fn stroke(pen: Pen, dashes: &[f32]) -> Stroke<'_> {
    let (cap, join) = (
        [Cap::Butt, Cap::Round, Cap::Square][pen.cap as usize],
        [Join::Miter, Join::Round, Join::Bevel][pen.join as usize],
    );
    Stroke {
        width: pen.width,
        cap,
        join,
        miter_limit: pen.miter_limit,
        dashes,
        dash_offset: pen.dash_offset,
    }
}

impl batch::Jobs for (&Shared, &[&[u32]]) {
    fn len(&self) -> usize {
        self.0.jobs.len()
    }

    fn trace(&self, job: usize, area: IntRect, edges: &mut Edges, room: &mut batch::Room) -> Shape {
        let (index, job, path) = (job, &self.0.jobs[job], &mut room.path);
        let setting @ Setting {
            matrix,
            inverse,
            dashes,
            list,
            ..
        } = &self.0.settings[job.setting as usize];
        let clip = setting.clip();
        let verbs = |it: Span| Outline(&self.1[*list as usize][it.range()]);
        let (area, identity) = (area.intersect(clip.rect), Transform::identity());
        path.clear();
        edges.density = if matches!(
            job.figure,
            Figure::FillPart(..) | Figure::StrokePart(..) | Figure::LastPart(..)
        ) {
            Density::Always
        } else {
            Density::IfItPays
        };
        let (style, matrix) = match job.figure {
            Figure::FillPart(span, from) => {
                verbs(span).walk_from(from, |it| path.push(it));
                return trace(
                    edges,
                    &mut room.stroke,
                    path,
                    Fill::NonZero.into(),
                    &identity,
                    area,
                )
                .into_part(None);
            }
            Figure::StrokePart(span, from, dash_offset) => {
                let (pen, mut all) = (
                    self.0.pens[self.0.pens.partition_point(|it| it.0 <= index) - 1].1,
                    Path::new(),
                );
                verbs(span).walk_from(from, |it| all.push(it));
                inverse
                    .iter()
                    .for_each(|it| prune(all.iter().map(|command| command.transform(it)), path));
                return trace(
                    edges,
                    &mut room.stroke,
                    path,
                    stroke(Pen { dash_offset, ..pen }, dashes).into(),
                    matrix,
                    area,
                )
                .into_part(None);
            }
            Figure::LastPart(ref links, around, _) => {
                let links = &self.0.links[links.start as usize..links.end as usize];
                return trace(
                    edges,
                    &mut room.stroke,
                    links,
                    Fill::NonZero.into(),
                    &identity,
                    area.intersect(around),
                )
                .into_part(Some(area.intersect(around)));
            }
            Figure::Fill(span, rule) => {
                verbs(span).walk(|it| path.push(it));
                (rule.into(), &identity)
            }
            Figure::Stroke(span, pen) => {
                match inverse {
                    Some(_) if *matrix == identity => prune(verbs(span), path),
                    Some(inverse) => prune(verbs(span).transformed(inverse), path),
                    None => {}
                }
                (stroke(pen, dashes).into(), matrix)
            }
            Figure::StrokeRect(rect, pen) => {
                prune(rect_commands(rect).into_iter(), path);
                (stroke(pen, dashes).into(), matrix)
            }
            Figure::TurnedRect(rect) => {
                path.extend(rect_commands(rect));
                (Fill::NonZero.into(), matrix)
            }
            Figure::Rect(rect) => {
                return Shape::blank(IntRect::around(rect).outset(1).intersect(area));
            }
            Figure::Disc([x, y], radius) => {
                return Shape::blank(
                    IntRect::around(outset(
                        Rect {
                            x,
                            y,
                            width: 0.,
                            height: 0.,
                        },
                        radius + 0.5,
                    ))
                    .intersect(area),
                );
            }
            Figure::Image(_) if setting.mode.clears_backdrop() => return Shape::blank(area),
            Figure::AlignedRect(rect)
            | Figure::Clear(rect)
            | Figure::Glyphs(_, rect)
            | Figure::Image(Drawn::Copy(.., rect)) => return Shape::blank(rect.intersect(area)),
            Figure::Image(Drawn::Picture(picture)) => {
                let picture = &self.0.images.pictures[picture as usize];
                if !picture.needs_edges(clip) {
                    return Shape::blank(
                        IntRect::around(map_rect(&picture.placement, picture.from)).intersect(area),
                    );
                }
                path.extend(rect_commands(picture.from));
                (Fill::NonZero.into(), &picture.placement)
            }
        };
        trace(edges, &mut room.stroke, path, style, matrix, area)
    }

    fn paint(
        &self,
        job: usize,
        edges: &Edges,
        shape: &Shape,
        scanner: &mut Scanner,
        on: &mut View,
    ) {
        if !shape.area.overlaps(on.rect) {
            return;
        }
        let job = &self.0.jobs[job];
        let setting = &self.0.settings[job.setting as usize];
        let mut draw = |paint: &Paint| match (&job.figure, paint) {
            (Figure::Rect(rect), Paint::Solid(color)) => {
                on.fill_rect(*rect, *color, setting.clip().rect)
            }
            (Figure::Clear(_), Paint::Solid(color)) => on.set(shape.area, *color),
            (&Figure::Disc(center, radius), _) => on.fill_disc(
                center,
                radius,
                shape.area,
                setting.clip(),
                (paint, setting.mode),
                &mut Default::default(),
            ),
            (&Figure::Image(Drawn::Copy(source, corner, rect)), Paint::Solid([.., by]))
                if setting.mode != BlendMode::SourceOver =>
            {
                shape.area.without(rect).for_each(|it| on.set(it, [0; 4]));
                self.0.images.combine(
                    source,
                    corner,
                    shape.area.intersect(rect),
                    *by,
                    setting.mode,
                    on,
                );
            }
            (Figure::AlignedRect(_), _) if setting.mode != BlendMode::SourceOver => {
                on.combine_rect(shape.area, setting.clip(), paint, setting.mode)
            }
            _ if setting.mode != BlendMode::SourceOver => {
                on.combine_shape(edges, shape, scanner, setting.clip(), paint, setting.mode)
            }
            (Figure::AlignedRect(_), _) => on.fill(shape.area, None, setting.clip(), paint),
            (Figure::Glyphs(which, _), Paint::Solid(color)) => {
                self.0
                    .glyphs
                    .paint(which.clone(), *color, setting.clip(), on)
            }
            (&Figure::Image(Drawn::Copy(source, corner, _)), Paint::Solid([.., by])) => self
                .0
                .images
                .copy(source, corner, shape.area, *by, setting.clip(), on),
            (&Figure::Image(Drawn::Picture(picture)), Paint::Solid([.., by])) => self
                .0
                .images
                .paint(picture, *by, setting.clip(), (edges, shape, scanner), on),
            _ => on.fill_shape(edges, shape, scanner, setting.clip(), paint),
        };
        match job.ink {
            Ink::Solid(color) => draw(&Paint::Solid(color)),
            Ink::Style(style) => self.0.styles[style as usize].with_paint(
                &setting.matrix,
                setting.alpha,
                setting.is_smooth,
                draw,
            ),
        }
    }

    fn paint_parts(
        &self,
        job: usize,
        parts: &[(&Edges, &Shape)],
        scanner: &mut Scanner,
        on: &mut View,
    ) {
        let (job, Some((_, last))) = (&self.0.jobs[job], parts.last()) else {
            return;
        };
        let (setting, is_even_odd) = (
            &self.0.settings[job.setting as usize],
            matches!(
                job.figure,
                Figure::Fill(_, Fill::EvenOdd) | Figure::LastPart(.., Fill::EvenOdd)
            ),
        );
        let mut draw = |paint: &Paint| {
            on.combine_samples(
                parts,
                is_even_odd,
                last.area,
                scanner,
                setting.clip(),
                (paint, setting.mode),
            )
        };
        match job.ink {
            Ink::Solid(color) => draw(&Paint::Solid(color)),
            Ink::Style(style) => self.0.styles[style as usize].with_paint(
                &setting.matrix,
                setting.alpha,
                setting.is_smooth,
                draw,
            ),
        }
    }

    fn is_part(&self, job: usize) -> bool {
        matches!(
            self.0.jobs[job].figure,
            Figure::FillPart(..) | Figure::StrokePart(..)
        )
    }

    #[inline]
    fn weight(&self, job: usize) -> usize {
        let job = &self.0.jobs[job];
        match job.figure {
            Figure::Fill(span, _) | Figure::FillPart(span, _) => span.range().len() / 2,
            Figure::Stroke(span, _) | Figure::StrokePart(span, ..) => {
                span.range().len()
                    * if self.0.settings[job.setting as usize].dashes.is_empty() {
                        1
                    } else {
                        16
                    }
            }
            _ => usize::from(self.0.settings[job.setting as usize].clip.1.is_some()) * 32,
        }
    }

    fn cost(&self, job: usize, shape: &Shape) -> u64 {
        let (job, area) = (&self.0.jobs[job], shape.area.area() as u64);
        let inside = match (&job.ink, &job.figure) {
            (Ink::Style(_), _) => area * 2,
            (
                _,
                Figure::Stroke(..)
                | Figure::StrokeRect(..)
                | Figure::FillPart(..)
                | Figure::StrokePart(..),
            ) => 0,
            (_, Figure::Image(Drawn::Picture(_))) => area,
            _ if area >= parallel::MANY_PIXELS as u64 => area * 3 / 4,
            (_, Figure::Glyphs(..) | Figure::Image(_) | Figure::Disc(..)) => area / 3,
            _ => area / 8,
        };
        100 + u64::from(shape.length) * 4 + inside
    }

    fn hides(&self, job: usize, shape: &Shape) -> Hides {
        const WIDE: f32 = 6.;
        const LARGE: i64 = 200;
        let job = &self.0.jobs[job];
        let setting = &self.0.settings[job.setting as usize];
        let is_opaque = match job.ink {
            Ink::Solid(color) => color[3] == 255,
            Ink::Style(style) => {
                setting.alpha == 1.
                    && matches!(&self.0.styles[style as usize], Style::Gradient(it) if it.is_opaque())
                    && setting.inverse.is_some()
            }
        };
        match job.figure {
            Figure::Clear(rect) => Hides::Rect(rect),
            _ if !is_opaque
                || setting.clip().mask.is_some()
                || setting.mode != BlendMode::SourceOver =>
            {
                Hides::Nothing
            }
            Figure::Disc(center, radius) => Hides::Disc(center, radius - 0.5),
            Figure::AlignedRect(rect) => Hides::Rect(rect),
            Figure::Rect(Rect {
                x,
                y,
                width,
                height,
            }) => Hides::Rect(IntRect::new(
                x.ceil() as i32,
                y.ceil() as i32,
                (x + width).floor() as i32,
                (y + height).floor() as i32,
            )),
            Figure::Fill(..) | Figure::TurnedRect(_) if shape.area.area() >= LARGE => Hides::Inside,
            Figure::Stroke(_, pen) | Figure::StrokeRect(_, pen)
                if pen.width * average_scale(&setting.matrix) >= WIDE =>
            {
                Hides::Inside
            }
            _ => Hides::Nothing,
        }
    }
}

/// `wire::Commands`, for another thread.
pub struct Owned {
    commands: Vec<u32>,
    parts: Vec<u32>,
    stops: Vec<GradientStop>,
    filters: Vec<Filter>,
    dashes: Vec<f32>,
    text: Vec<u8>,
    is_partial: bool,
}

impl Owned {
    /// # Safety
    /// The slices are alive.
    pub unsafe fn new(from: &wire::Commands) -> Owned {
        // SAFETY: the caller's contract.
        unsafe {
            Owned {
                commands: from.commands.get().to_vec(),
                parts: from.parts.get().to_vec(),
                stops: from.stops.get().to_vec(),
                filters: from.filters.get().to_vec(),
                dashes: from.dashes.get().to_vec(),
                text: from.text.get().to_vec(),
                is_partial: from.is_partial,
            }
        }
    }

    fn path(&self, verbs: Span) -> Path {
        self.outline(verbs).path()
    }

    #[inline]
    fn outline(&self, verbs: Span) -> Outline<'_> {
        Outline(&self.parts[verbs.range()])
    }

    /// With where they are.
    #[inline]
    fn commands(&self, range: Range<usize>) -> impl Iterator<Item = (Range<usize>, Command)> {
        let (end, mut rest) = (range.end, &self.commands[range]);
        std::iter::from_fn(move || {
            let (start, command) = (end - rest.len(), Command::read(&mut rest)?);
            Some((start..end - rest.len(), command))
        })
    }

    fn style(&self, paint: Span, is_wide: bool) -> Style {
        let Some(paint) = wire::Paint::read(&mut &self.parts[paint.range()]) else {
            return Style::Color(0);
        };
        let (geometry, stops) = match paint {
            wire::Paint::Linear { from, to, .. } if from == to => return Style::Color(0),
            wire::Paint::Radial { from, to, .. } if from == to => return Style::Color(0),
            wire::Paint::Linear { from, to, stops } => (Geometry::Linear { from, to }, stops),
            wire::Paint::Radial { from, to, stops } => (Geometry::Radial { from, to }, stops),
            wire::Paint::Conic {
                center,
                start,
                stops,
            } => (
                Geometry::Sweep {
                    center,
                    start,
                    span: std::f32::consts::TAU,
                },
                stops,
            ),
            wire::Paint::Pattern {
                tile,
                repeats,
                matrix: to,
            } => {
                let (fits, tile) = (
                    self::is_wide(tile) == is_wide,
                    PATTERNS.with_borrow(|patterns| patterns.get(&tile).cloned()),
                );
                let tile = if fits {
                    tile
                } else {
                    tile.and_then(|it| images::converted(&it, is_wide))
                        .map(Arc::new)
                };
                return tile.map_or(Style::Color(0), |tile| Style::Pattern {
                    tile,
                    repeats,
                    matrix: matrix(to),
                });
            }
        };
        Style::Gradient(Arc::new(Gradient::new(
            geometry,
            &self.stops[stops.range()],
            Spread::Pad,
            false,
        )))
    }

    /// Those that it may change.
    pub fn canvases(&self) -> impl Iterator<Item = u32> {
        self.commands(0..self.commands.len()).filter_map(|it| {
            if let Command::Select(id) | Command::Release(id) = it.1 {
                Some(id)
            } else {
                None
            }
        })
    }

    pub fn bytes(&self) -> usize {
        size_of_val(&self.commands[..])
            + size_of_val(&self.parts[..])
            + size_of_val(&self.stops[..])
            + size_of_val(&self.dashes[..])
            + self.text.len()
    }

    pub fn run(self: Rc<Self>) {
        let (mut selected, mut current, mut is_marked, mut batch) =
            (0, None::<Rc<RefCell<Canvas>>>, false, BATCH.take());
        let pause = |canvas: &RefCell<Canvas>, batch: &mut Batch, next: usize| {
            let canvas = &mut *canvas.borrow_mut();
            batch.paint(canvas);
            canvas.pause(&self, next);
        };
        let mut next = 0;
        while let Some((place, command)) = self.commands(next..self.commands.len()).next() {
            next = place.end;
            if let (
                Command::Create { .. }
                | Command::Snapshot(_)
                | Command::Release(_)
                | Command::Select(_),
                Some(canvas),
            ) = (command, &current)
            {
                pause(canvas, &mut batch, place.start);
            }
            match command {
                Command::Create {
                    id,
                    size,
                    is_opaque,
                    is_read_often,
                    is_wide,
                } => {
                    if is_wide {
                        images::note_wide();
                        WIDE.with_borrow_mut(|it| it.insert(id));
                    }
                    let mut canvas = Canvas::new(is_opaque, is_read_often, is_wide);
                    canvas.reset(size);
                    CANVASES.with_borrow_mut(|canvases| {
                        canvases.insert(id, Rc::new(RefCell::new(canvas)))
                    });
                }
                Command::Snapshot(wanted) => keep_snapshot(wanted),
                Command::Release(id) => release(id),
                Command::DropFontScope(scope) => crate::text::drop_font_scope(scope),
                Command::Select(id) => {
                    (selected, current, is_marked) = (id, get(id), false);
                    current.iter().for_each(|it| {
                        it.borrow_mut().select(
                            id,
                            place.end,
                            self.is_partial && crate::host::thread::has_jobs(),
                        )
                    });
                    if let Some(waiting) = current
                        .as_ref()
                        .and_then(|it| it.borrow_mut().waiting.take())
                    {
                        batch = *waiting;
                        batch.has_setting = false;
                        batch.shared.images.forget();
                    }
                }
                command => {
                    let Some(canvas) = &current else { continue };
                    let canvas = &mut *canvas.borrow_mut();
                    if canvas.run(selected, command, &self, place, &mut batch) {
                        if !std::mem::replace(&mut is_marked, true) {
                            CHANGED.with_borrow_mut(|changed| changed.insert(selected));
                        }
                        next = canvas.carry_on(&self, next);
                    }
                }
            }
        }
        if let Some(canvas) = current {
            if self.is_partial
                && canvas.borrow().experience.much_was_hidden
                && !batch.shared.jobs.is_empty()
                && batch.shared.images.bytes[0] <= Batch::MAX_BYTES
            {
                get(LAST_TO_WAIT.replace(selected))
                    .inspect(|it| it.borrow_mut().paint_what_waits());
                canvas.borrow_mut().waiting = Some(Box::new(std::mem::take(&mut batch)));
            }
            pause(&canvas, &mut batch, self.commands.len());
        }
        if !self.is_partial {
            batch.shared.images.end_frame();
        }
        BATCH.set(batch);
        if !self.is_partial {
            let changed = CHANGED.take();
            changed
                .iter()
                .filter_map(|it| get(*it))
                .for_each(|it| it.borrow_mut().end_frame());
            surface::images_changed(&changed);
        }
    }
}

fn clipped(clip: &Clip, path: &Path, rule: Fill) -> Clip {
    let bounds = path_bounds(path);
    let area = around(bounds).intersect(clip.rect);
    if IntRect::around(bounds).to_rect() == bounds && is_upright_rect(path) {
        return clip.within_rect(area);
    }
    let coverage = Coverage::of_path(path, rule, &Transform::identity(), area);
    match coverage.data.iter().all(|value| *value == 255) {
        true => clip.within_rect(coverage.rect),
        false => clip.within(coverage),
    }
}

impl State {
    fn clips_to_rect(&self) -> bool {
        self.clip.mask.is_none() && self.put_off.is_none()
    }

    /// Whether there was anything.
    fn clip_to_what_was_put_off(&mut self) -> bool {
        self.put_off
            .take()
            .map(|it| self.clip = it.mask(&self.clip).get().within_rect(self.clip.rect))
            .is_some()
    }
}

impl Canvas {
    fn new(is_opaque: bool, is_read_often: bool, is_wide: bool) -> Canvas {
        let (changed, state) = (IntRect::default(), State::new(IntRect::default(), is_wide));
        Canvas {
            layer: None,
            version: 0,
            changed,
            is_opaque,
            is_read_often,
            state,
            clips: Vec::new(),
            accelerated: None,
            known: Default::default(),
            load: Default::default(),
            waiting: None,
            experience: Default::default(),
        }
    }

    fn paint_what_waits(&mut self) {
        if let Some(mut batch) = self.waiting.take() {
            batch.paint(self);
            batch.shared.images.end_frame();
            BATCH.set(*batch);
        }
    }

    fn reset(&mut self, [width, height]: [u32; 2]) {
        let bounds = IntRect::new(0, 0, width.min(1 << 16) as i32, height.min(1 << 16) as i32);
        self.accelerated = None;
        self.layer = Layer::new(bounds);
        self.layer
            .iter_mut()
            .filter(|_| self.is_opaque)
            .for_each(|it| it.pixels_mut().fill([0, 0, 0, 255]));
        (self.state, self.clips, self.changed) =
            (State::new(bounds, self.state.is_wide), Vec::new(), bounds);
    }

    fn replace(&mut self, pixels: Layer) {
        self.paint_what_waits();
        self.changed = self.changed.union(pixels.rect);
        match &mut self.layer {
            Some(layer) if layer.rect == pixels.rect => *layer = pixels,
            Some(layer) => layer.replace(&pixels, &Clip::new(pixels.rect)),
            None => {}
        }
    }

    /// Whether it draws.
    #[inline]
    fn run(
        &mut self,
        id: u32,
        command: Command,
        list: &Rc<Owned>,
        place: Range<usize>,
        batch: &mut Batch,
    ) -> bool {
        let state = &mut self.state;
        batch.has_setting &= match command {
            Command::Transform(_)
            | Command::Compositing { .. }
            | Command::Smoothing(_)
            | Command::Clip { .. }
            | Command::RestoreClip => false,
            Command::Pen { dashes, .. } => list.dashes[dashes.range()] == state.dashes,
            _ => true,
        };
        self.known.forget(&command);
        match command {
            Command::Transform(to) => state.matrix = matrix(to),
            Command::FillColor(color) => state.fill = Style::Color(color),
            Command::StrokeColor(color) => state.stroke = Style::Color(color),
            Command::LineWidth(width) => state.pen.width = width,
            Command::FillPaint(paint) => state.fill = list.style(paint, state.is_wide),
            Command::StrokePaint(paint) => state.stroke = list.style(paint, state.is_wide),
            Command::Compositing { alpha, operator } => {
                (state.alpha, state.mode) = (alpha, MODES[operator as usize])
            }
            Command::Pen { pen, dashes } => {
                state.pen = pen;
                list.dashes[dashes.range()].clone_into(&mut state.dashes);
            }
            Command::Shadow {
                offset,
                blur,
                color,
            } => {
                (state.shadow_offset, state.shadow_blur, state.shadow_color) = (offset, blur, color)
            }
            Command::Smoothing(is_smooth) => state.is_smooth = is_smooth,
            Command::Filters(filters) => {
                list.filters[filters.range()].clone_into(&mut state.filters)
            }
            Command::Clip {
                verbs,
                is_even_odd,
                saves,
            } => {
                self.clips
                    .extend(saves.then(|| (state.clip.clone(), state.put_off.clone())));
                if !state.put_off_clip(
                    list,
                    verbs,
                    fill_rule(is_even_odd),
                    self.accelerated.as_ref().map(|_| &mut self.known.masked),
                ) {
                    state.clip = clipped(&state.clip, &list.path(verbs), fill_rule(is_even_odd));
                }
            }
            Command::RestoreClip => self
                .clips
                .pop()
                .into_iter()
                .for_each(|it| (state.clip, state.put_off) = it),
            mut command => {
                if let Command::Image { image, .. } = &mut command {
                    let converted = images::in_space(*image, state.is_wide);
                    if converted != *image {
                        self.note_use(std::mem::replace(image, converted));
                    }
                }
                self.version = self.version.wrapping_add(1);
                if self.accelerated.is_some() && self.draw_on_gpu(id, command, list, place.clone())
                {
                    return true;
                }
                if batch.is_full() {
                    batch.paint(self);
                }
                if let Command::Reset(size) = command {
                    batch.clear();
                    self.reset(size);
                    self.select(id, place.start, false);
                } else if self.accelerated.is_some() || !self.put_off(id, command, batch, list) {
                    if self.state.clip_to_what_was_put_off() {
                        batch.has_setting = false;
                        self.known.forget(&Command::RestoreClip);
                    }
                    batch.paint(self);
                    self.draw(id, command, list);
                }
                return true;
            }
        }
        false
    }

    /// False if it has to be drawn now.
    #[inline]
    fn put_off(&self, id: u32, command: Command, batch: &mut Batch, list: &Rc<Owned>) -> bool {
        let (Some(target), state) = (&self.layer, &self.state) else {
            return false;
        };
        let (is_shared, is_over) = (
            target.pixmap.is_shared(),
            state.mode == BlendMode::SourceOver,
        );
        let is_plain = is_over && state.clips_to_rect() && matches!(state.fill, Style::Color(_));
        let (figure, style) = match command {
            Command::ClearRect(rect) => {
                let device = map_rect(&state.matrix, upright(rect));
                let pixels = IntRect::nearest(device);
                if state.matrix.has_skew()
                    || pixels.to_rect() != device
                    || !state.clips_to_rect()
                    || is_shared
                {
                    return false;
                }
                if pixels.intersect(state.clip.rect) == target.rect {
                    batch.clear();
                }
                batch.add_in(
                    state,
                    Figure::Clear(pixels),
                    Ink::Solid([0, 0, 0, if self.is_opaque { 255 } else { 0 }]),
                    list,
                );
                return true;
            }
            _ if state.has_effects() || self.is_opaque && state.mode.may_open() => return false,
            Command::Image {
                image,
                size,
                from,
                to,
            } if image != id
                && (is_over
                    || !matches!(state.mode, BlendMode::Source | BlendMode::Clear)
                        && state.clips_to_rect()) =>
            {
                let drawn = batch.shared.images.add(
                    image,
                    size,
                    [upright(from), upright(to)],
                    &state.matrix,
                    [state.is_smooth, state.is_wide],
                    &mut batch.bytes,
                );
                let Some(drawn) = drawn.filter(|it| is_over || matches!(it, Drawn::Copy(..)))
                else {
                    return false;
                };
                batch.add_in(
                    state,
                    Figure::Image(drawn),
                    Ink::Solid([0, 0, 0, (state.alpha.min(1.) * 255. + 0.5) as u8]),
                    list,
                );
                return true;
            }
            _ if state.mode.clears_backdrop() => return false,
            Command::Text { .. } if !is_over => return false,
            Command::Fill { verbs, is_even_odd }
                if verbs.range().len() > parts::LONG
                    && batch.add_in_parts(state, verbs, Some(fill_rule(is_even_odd)), list) =>
            {
                return true;
            }
            Command::Stroke { verbs }
                if verbs.range().len()
                    > parts::LONG / if state.dashes.is_empty() { 1 } else { 32 }
                    && batch.add_in_parts(state, verbs, None, list) =>
            {
                return true;
            }
            Command::Fill { verbs, is_even_odd } => {
                const FEW_WORDS: usize = 16;
                const RADII: Range<f32> = 1. ..40.;
                let mut room = [wire::Verb::Close; 5];
                let figure = match if verbs.range().len() <= FEW_WORDS {
                    list.outline(verbs).verbs(&mut room)
                } else {
                    &[]
                } {
                    &[
                        wire::Verb::Arc {
                            center,
                            radius,
                            sweep,
                            ..
                        },
                    ]
                    | &[
                        wire::Verb::Arc {
                            center,
                            radius,
                            sweep,
                            ..
                        },
                        wire::Verb::Close,
                    ] if sweep.abs() >= std::f32::consts::TAU && RADII.contains(&radius) => {
                        Some(Figure::Disc(center, (radius * radius - 1. / 12.).sqrt()))
                    }
                    verbs if is_plain => gpu::parallelogram(verbs)
                        .filter(|[a, b, c]| a.y == b.y && b.x == c.x || a.x == b.x && b.y == c.y)
                        .map(|[a, _, c]| {
                            Figure::Rect(upright(Rect {
                                x: a.x,
                                y: a.y,
                                width: c.x - a.x,
                                height: c.y - a.y,
                            }))
                        }),
                    _ => None,
                };
                (
                    figure.unwrap_or(Figure::Fill(verbs, fill_rule(is_even_odd))),
                    &state.fill,
                )
            }
            Command::Text {
                text,
                style,
                at,
                alignment,
                max_width,
                strokes: false,
            } => {
                let Style::Color(color) = state.fill else {
                    return false;
                };
                let (line, matrix) = place_text(
                    &list.text[text.range()],
                    &style,
                    &state.matrix,
                    at,
                    alignment,
                    max_width,
                );
                let color = with_alpha(color, state.alpha);
                let Some((which, bounds)) =
                    batch
                        .shared
                        .glyphs
                        .add(&line, &matrix, color, state.clip.rect)
                else {
                    return false;
                };
                batch.add_in(
                    state,
                    Figure::Glyphs(which, bounds),
                    Ink::Solid(premultiply(color)),
                    list,
                );
                return true;
            }
            Command::Stroke { verbs } => (Figure::Stroke(verbs, state.pen), &state.stroke),
            Command::StrokeRect(rect) => {
                (Figure::StrokeRect(upright(rect), state.pen), &state.stroke)
            }
            Command::FillRect(_) if is_shared => return false,
            Command::FillRect(rect)
                if is_over
                    && let Some(path) =
                        state.clip_within(gpu::corners(upright(rect), &state.matrix))
                    && let Some(verbs) = path.verbs_in(list) =>
            {
                (batch.has_setting, batch.ignores_path) = (false, true);
                batch.add(state, Figure::Fill(verbs, path.rule), &state.fill, list);
                (batch.has_setting, batch.ignores_path) = (false, false);
                return true;
            }
            Command::FillRect(rect) => {
                let device = map_rect(&state.matrix, upright(rect));
                let figure = match IntRect::nearest(device) {
                    _ if state.matrix.has_skew() => Figure::TurnedRect(upright(rect)),
                    _ if is_plain => Figure::Rect(device),
                    pixels if pixels.to_rect() == device => Figure::AlignedRect(pixels),
                    _ => Figure::TurnedRect(upright(rect)),
                };
                (figure, &state.fill)
            }
            _ => return false,
        };
        batch.add(state, figure, style, list);
        true
    }

    fn draw(&mut self, id: u32, command: Command, list: &Owned) {
        let (Some(target), state) = (&mut self.layer, &self.state) else {
            return;
        };
        self.changed = self.changed.union(match command {
            Command::Erase => target.rect,
            Command::ClearRect(rect) => IntRect::around(map_rect(&state.matrix, upright(rect))),
            Command::FillRect(rect) | Command::Image { to: rect, .. }
                if state.mode == BlendMode::SourceOver && !state.has_effects() =>
            {
                IntRect::around(map_rect(&state.matrix, upright(rect))).outset(1)
            }
            _ => state.clip.rect,
        });
        match command {
            Command::Erase => State::new(target.rect, false).clear_rect(
                target,
                target.rect.to_rect(),
                self.is_opaque,
            ),
            Command::ClearRect(rect) => state.clear_rect(target, upright(rect), self.is_opaque),
            Command::Image {
                image,
                size,
                from,
                to,
            } if image == id => {
                target.pixmap.allow_sharing();
                let Some(before) = target.pixmap.shared() else {
                    return;
                };
                state.draw_image(
                    Onto::Layer(target),
                    Content::Pixels(&before),
                    size,
                    upright(from),
                    upright(to),
                );
            }
            command => state.draw(Onto::Layer(target), command, list),
        }
        if self.is_opaque && state.mode != BlendMode::SourceOver {
            target
                .pixels_mut()
                .iter_mut()
                .for_each(|pixel| pixel[3] = 255);
        }
    }
}

pub fn measure(text: &[u8], style: &TextStyle) -> TextMetrics {
    let (line, levels) = (
        line(std::str::from_utf8(text).unwrap_or_default(), style),
        text::levels(style.font, style.size),
    );
    let (ink, shift) = (line.ink_bounds(), baseline_offset(&levels, style.baseline));
    TextMetrics {
        width: line.width,
        ink_left: -ink.x,
        ink_right: ink.x + ink.width,
        ink_ascent: -ink.y - shift,
        ink_descent: ink.y + ink.height + shift,
        font_ascent: levels.ascent - shift,
        font_descent: levels.descent + shift,
        em_ascent: levels.em_ascent - shift,
        em_descent: levels.em_descent + shift,
        hanging: levels.hanging - shift,
        alphabetic: levels.alphabetic - shift,
        ideographic: levels.ideographic - shift,
    }
}

/// Whether anything is painted in a very small pixel around the point, so that the edge counts as inside.
fn covers<'a>(
    path: &Path,
    style: impl Into<gfx::Style<'a>>,
    matrix: Transform,
    [x, y]: [f32; 2],
) -> bool {
    const SAMPLES: f32 = 64.;
    let zoom = Transform::from_row(
        SAMPLES,
        0.,
        0.,
        SAMPLES,
        0.5 - x * SAMPLES,
        0.5 - y * SAMPLES,
    );
    let coverage = Coverage::of_path(
        path,
        style,
        &zoom.pre_concat(matrix),
        IntRect::new(0, 0, 1, 1),
    );
    coverage.data.first().is_some_and(|it| *it != 0)
}

pub fn is_in_path(point: [f32; 2], verbs: &[u32], is_even_odd: bool) -> bool {
    const FAR: f32 = 1e30;
    let path = Outline(verbs)
        .path()
        .iter()
        .map(|it| it.map(|it| Point::new(it.x.clamp(-FAR, FAR), it.y.clamp(-FAR, FAR))))
        .collect();
    covers(&path, fill_rule(is_even_odd), Transform::identity(), point)
}

pub fn is_in_stroke(
    point: [f32; 2],
    verbs: &[u32],
    to: abi::Matrix,
    pen: Pen,
    dashes: &[f32],
) -> bool {
    let matrix = matrix(to);
    matrix.invert().is_some_and(|inverse| {
        covers(
            &transformed(&Outline(verbs).path(), &inverse),
            stroke(pen, dashes),
            matrix,
            point,
        )
    })
}

fn allow_sharing(id: u32) {
    if let Some(canvas) = settled(id)
        && let Ok(mut canvas) = canvas.try_borrow_mut()
        && let Some(layer) = &mut canvas.layer
    {
        layer.pixmap.allow_sharing();
    }
}

fn keep_snapshot(mut wanted: Snapshot) {
    if wanted.is_tile {
        wanted.source = images::in_space(wanted.source, wanted.is_wide);
    } else {
        wanted.is_wide = images::is_wide(wanted.source);
    }
    allow_sharing(wanted.source);
    let Some(pixmap) =
        images::with_first_frame(wanted.source, |content, _| snapshot(content, &wanted)).flatten()
    else {
        return;
    };
    if wanted.is_tile {
        PATTERNS.with_borrow_mut(|patterns| patterns.insert(wanted.id, Arc::new(pixmap)));
        WIDE.with_borrow_mut(|it| it.extend(wanted.is_wide.then_some(wanted.id)));
    } else {
        let widen = images::widen(wanted.source)
            .filter(|_| !wanted.are_straight[0])
            .and_then(|it| it.then(move |whole| snapshot(Content::Pixels(whole), &wanted)));
        images::insert_as(wanted.id, pixmap, wanted.is_wide, widen);
    }
}

/// All of an image or a canvas.
pub fn copy(source: u32, to: [u32; 2]) -> Option<Pixmap> {
    let (size, is_wide) = (to.map(|it| it as f32), images::is_wide(source));
    let part = Rect {
        x: 0.,
        y: 0.,
        width: size[0],
        height: size[1],
    };
    let wanted = Snapshot {
        id: 0,
        source,
        size,
        part,
        to,
        flips: false,
        is_smooth: true,
        is_sharpened: false,
        are_straight: [false; 2],
        is_tile: false,
        is_wide,
    };
    allow_sharing(source);
    images::with_first_frame(source, |content, _| snapshot(content, &wanted))?
}

fn snapshot(content: Content, wanted: &Snapshot) -> Option<Pixmap> {
    let (mut copy, [from, to]) = (draw_snapshot(content, wanted)?, wanted.are_straight);
    if from != to && copy.data().as_chunks::<4>().0.iter().any(|it| it[3] != 255) {
        let pixels = copy.data_mut().as_chunks_mut().0;
        if to {
            demultiply_row(pixels)
        } else {
            pixels
                .iter_mut()
                .for_each(|it| *it = premultiply(u32::from_be_bytes(*it)))
        }
    }
    Some(copy)
}

fn draw_snapshot(content: Content, wanted: &Snapshot) -> Option<Pixmap> {
    const MAX_SHARPENED_WIDTH: i32 = 1 << 16;
    if let (Content::Pixels(it), false) = (content, wanted.flips)
        && wanted.part
            == (Rect {
                x: 0.,
                y: 0.,
                width: wanted.size[0],
                height: wanted.size[1],
            })
        && [it.width(), it.height()] == wanted.to
        && let Some(shared) = it.shared()
    {
        return Some(shared);
    }
    let [width, height] = wanted.to.map(|it| i32::try_from(it).unwrap_or(0));
    let mut target = Layer::new(IntRect::new(0, 0, width, height))?;
    if let (Content::Pixels(it), false, true) = (
        content,
        wanted.flips,
        wanted.is_sharpened && !wanted.are_straight[0] && width <= MAX_SHARPENED_WIDTH,
    ) {
        let (all, part) = (
            IntRect::new(0, 0, it.width() as i32, it.height() as i32),
            IntRect::around(wanted.part),
        );
        let grows = width as usize > part.width() && height as usize > part.height();
        if grows
            && wanted.size == [all.right as f32, all.bottom as f32]
            && all.contains(part)
            && !part.is_empty()
        {
            images::enlarge(it, part, &mut target.pixmap);
            return Some(target.pixmap);
        }
    }
    let (mut state, to) = (
        State::new(target.rect, wanted.is_wide),
        target.rect.to_rect(),
    );
    state.is_smooth = wanted.is_smooth;
    if wanted.flips {
        state.matrix = Transform::from_row(1., 0., 0., -1., 0., to.height);
    }
    let draw = |content, target: &mut Layer| {
        state.draw_image(Onto::Layer(target), content, wanted.size, wanted.part, to)
    };
    draw(content, &mut target);
    if let (Content::Pixels(it), [true, _]) = (content, wanted.are_straight) {
        let (mut colors, mut drawn) = (
            Pixmap::from_vec(it.data().to_vec(), it.width(), it.height())?,
            Layer::new(target.rect)?,
        );
        colors
            .data_mut()
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .for_each(|it| it[3] = 255);
        draw(Content::Pixels(&colors), &mut drawn);
        let pairs = target
            .pixmap
            .data_mut()
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(drawn.pixels());
        pairs.for_each(|(to, from)| to[..3].copy_from_slice(&from[..3]));
    }
    Some(target.pixmap)
}

/// The pixels of a canvas, for another thread.
pub struct Loan {
    layer: Layer,
    is_opaque: bool,
    /// What is elsewhere is out of date.
    known: IntRect,
}

pub fn lend(id: u32, area: Area) -> Option<Loan> {
    let canvas = get(id)?;
    let canvas = &mut *canvas.borrow_mut();
    let known = canvas.fetch(pixels(area));
    let layer = canvas.layer.as_mut()?;
    layer.pixmap.allow_sharing();
    Some(Loan {
        layer: Layer {
            rect: layer.rect,
            pixmap: layer.pixmap.shared()?,
        },
        is_opaque: canvas.is_opaque,
        known,
    })
}

/// If that takes no waiting for the GPU.
pub fn lend_unasked(id: u32, area: Area) -> Option<Loan> {
    get(id).filter(|it| it.borrow().accelerated.is_none())?;
    lend(id, area)
}

impl Loan {
    pub fn has(&self, area: Area) -> bool {
        let wanted = self.layer.rect.intersect(pixels(area));
        wanted.is_empty() || self.known.contains(wanted)
    }

    pub fn area(&self) -> Area {
        let IntRect {
            left,
            top,
            right,
            bottom,
        } = self.known;
        [left, top, right - left, bottom - top]
    }

    pub fn is_all_in(&self, area: Area) -> bool {
        self.layer.rect == pixels(area)
    }

    /// Returns what the canvas has to be given.
    pub fn replace(&mut self, rgba: Vec<u8>) -> Option<Pixmap> {
        let IntRect { right, bottom, .. } = self.layer.rect;
        self.layer.pixmap = premultiplied([0, 0, right, bottom], rgba, self.is_opaque)?;
        self.layer.pixmap.allow_sharing();
        self.known = self.layer.rect;
        self.layer.pixmap.shared()
    }

    /// Premultiplied colors are those on black. False if it has not written everything.
    pub fn read(&self, area: Area, is_on_black: bool, rgba: &mut [MaybeUninit<Pixel>]) -> bool {
        let (layer, wanted) = (&self.layer, pixels(area));
        let shared = layer.rect.intersect(wanted);
        if shared.is_empty() {
            return false;
        }
        if shared != wanted || wanted.area() != rgba.len() as i64 {
            rgba.fill(MaybeUninit::new([0; 4]));
        }
        let (width, above) = (area[2] as usize, (shared.top - wanted.top) as usize);
        parallel::in_bands(
            &mut rgba[above * width..][..shared.height() * width],
            width,
            shared.area(),
            |first, band| {
                let copy = |to: &mut [MaybeUninit<Pixel>], from| {
                    let to = to.write_copy_of_slice(from);
                    if !(is_on_black || self.is_opaque || are_opaque(from)) {
                        demultiply_row(to);
                    }
                };
                if (shared.width(), layer.rect.width()) == (width, width) {
                    let from =
                        &layer.pixels()[(shared.top as usize + first) * width..][..band.len()];
                    return band
                        .chunks_mut(4096)
                        .zip(from.chunks(4096))
                        .for_each(|(to, from)| copy(to, from));
                }
                for (row, y) in band
                    .chunks_exact_mut(width)
                    .zip(shared.top + first as i32..)
                {
                    copy(
                        &mut row[(shared.left - wanted.left) as usize..][..shared.width()],
                        layer.row(y, shared.left, shared.right),
                    );
                }
            },
        );
        true
    }
}

pub fn part_of(rgba: &[u8], area: Area, part: Area) -> Vec<u8> {
    if area == part {
        return rgba.to_vec();
    }
    let [left, top] = [0, 1].map(|axis| (i64::from(part[axis]) - i64::from(area[axis])) as usize);
    let rows = rgba
        .chunks(area[2] as usize * 4)
        .skip(top)
        .take(part[3] as usize);
    let mut copy = Vec::with_capacity(part[2] as usize * part[3] as usize * 4);
    rows.for_each(|row| copy.extend_from_slice(&row[left * 4..][..part[2] as usize * 4]));
    copy
}

pub fn premultiplied(area: Area, mut rgba: Vec<u8>, is_opaque: bool) -> Option<Pixmap> {
    if is_opaque {
        rgba.as_chunks_mut::<4>()
            .0
            .iter_mut()
            .for_each(|pixel| pixel[3] = 255);
        return Pixmap::from_vec(rgba, area[2] as u32, area[3] as u32);
    }
    images::pixmap_from_rgba(area[2] as u32, area[3] as u32, rgba)
}

/// `pixmap` is told whether the canvas is opaque.
pub fn write(id: u32, area: Area, pixmap: impl FnOnce(bool) -> Option<Pixmap>) {
    let Some(canvas) = get(id) else { return };
    let mut canvas = canvas.borrow_mut();
    let (rect, pixmap) = (pixels(area), pixmap(canvas.is_opaque));
    if let Some(pixels) = pixmap.and_then(|pixmap| canvas.write_on_gpu(Layer { rect, pixmap })) {
        canvas.replace(pixels);
    }
    canvas.version = canvas.version.wrapping_add(1);
    CHANGED.with_borrow_mut(|changed| changed.insert(id));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi_graphics::Verb;
    use crate::paint::vector;

    fn run(all: Vec<Command>, verbs: &[Verb]) {
        let (mut commands, mut parts, stops, filters, dashes, text) = Default::default();
        all.into_iter().for_each(|it| it.write(&mut commands));
        verbs.iter().for_each(|it| it.write(&mut parts));
        Rc::new(Owned {
            commands,
            parts,
            stops,
            filters,
            dashes,
            text,
            is_partial: false,
        })
        .run();
    }

    fn step(id: u32, number: u32) {
        let at = |x: u32, y: u32| [(number * 7 % 50 + x) as f32, (number * 11 % 30 + y) as f32];
        let (verbs, all) = (
            [
                Verb::Move(at(0, 0)),
                Verb::Line(at(30, 5)),
                Verb::Line(at(9, 25)),
                Verb::Close,
            ],
            Span { start: 0, end: 10 },
        );
        let mut commands = vec![
            Command::Select(id),
            Command::FillColor(number.wrapping_mul(0x9E37_79B9) | 0x60),
        ];
        commands.extend(match number % 40 {
            3 => Some(Command::Clip {
                verbs: all,
                is_even_odd: false,
                saves: true,
            }),
            6 => Some(Command::RestoreClip),
            9 => Some(Command::Transform([1., 0., 0., 1., 3., 2.])),
            12 => Some(Command::ClearRect(Rect {
                x: -9.,
                y: -9.,
                width: 99.,
                height: 99.,
            })),
            15 => Some(Command::Compositing {
                alpha: 0.5,
                operator: wire::Operator::DestinationAtop,
            }),
            16 => Some(Command::Compositing {
                alpha: 0.9,
                operator: wire::Operator::SourceOver,
            }),
            30 => Some(Command::Reset([80, 60])),
            _ => None,
        });
        commands.push(Command::Fill {
            verbs: all,
            is_even_odd: false,
        });
        commands.extend(std::iter::repeat_n(
            Command::FillRect(Rect {
                x: number as f32,
                y: 50.,
                width: 2.,
                height: 9.,
            }),
            if number % 40 == 25 { 4000 } else { 1 },
        ));
        run(commands, &verbs);
    }

    /// One thread has it.
    #[test]
    fn the_gpu_fails() {
        vector::tests::IS_ON.set(true);
        if vector::is_ready() {
            what_is_drawn_again_does_not_show_later_pixels();
            nothing_is_lost();
        }
    }

    fn nothing_is_lost() {
        for steps in 1..45 {
            for id in [1, 2] {
                run(
                    vec![Command::Create {
                        id,
                        size: [80, 60],
                        is_opaque: false,
                        is_read_often: id == 2,
                        is_wide: false,
                    }],
                    &[],
                );
                (0..steps).for_each(|it| step(id, it));
            }
            assert!(get(1).unwrap().borrow().accelerated.is_some());
            vector::tests::FAILS.set(true);
            let [recovered, expected] =
                [1, 2].map(|id| with_pixels(id, |it, _| it.data().to_vec()).unwrap());
            vector::tests::FAILS.set(false);
            vector::tests::forgive();
            let off = recovered
                .iter()
                .zip(&expected)
                .filter(|(a, b)| a.abs_diff(**b) > 40)
                .count();
            assert!(off * 100 < expected.len(), "{off} after {steps}");
        }
        run(
            vec![Command::Create {
                id: 1,
                size: [80, 60],
                is_opaque: false,
                is_read_often: false,
                is_wide: false,
            }],
            &[],
        );
        step(1, 0);
        let before = with_pixels(1, |it, _| it.data().to_vec());
        assert!(
            gpu::rest(gpu::REST_AFTER)
                && !gpu::rest(Default::default())
                && get(1).unwrap().borrow().accelerated.is_none()
        );
        assert!(before == with_pixels(1, |it, _| it.data().to_vec()));
        step(1, 1);
        assert!(get(1).unwrap().borrow().accelerated.is_some());
        release_memory();
    }

    fn what_is_drawn_again_does_not_show_later_pixels() {
        let all = Rect {
            x: 0.,
            y: 0.,
            width: 8.,
            height: 8.,
        };
        run(
            [1, 2]
                .map(|id| Command::Create {
                    id,
                    size: [8, 8],
                    is_opaque: false,
                    is_read_often: id == 2,
                    is_wide: false,
                })
                .into(),
            &[],
        );
        run(
            vec![
                Command::Select(1),
                Command::Image {
                    image: 2,
                    size: [8., 8.],
                    from: all,
                    to: all,
                },
                Command::Select(2),
                Command::FillRect(all),
            ],
            &[],
        );
        assert!(get(1).unwrap().borrow().accelerated.is_some());
        vector::tests::FAILS.set(true);
        assert_eq!(
            with_pixels(1, |it, _| it.data().iter().all(|it| *it == 0)),
            Some(true)
        );
        vector::tests::FAILS.set(false);
        vector::tests::forgive();
    }

    #[test]
    fn arcs_are_a_turn_at_most() {
        let area = IntRect::new(0, 0, 9, 9);
        for sweep in [-1e12, 1e12, f32::INFINITY, f32::NAN] {
            let (mut words, mut scene) = (Vec::new(), vector::Scene::new(area, false));
            Verb::Arc {
                center: [5., 5.],
                radius: 3.,
                from: 0.,
                sweep,
            }
            .write(&mut words);
            assert!(Outline(&words).path().len() <= 5);
            assert!(!scene.pie(
                vector::Arc {
                    center: Point::new(5., 5.),
                    radius: 3.,
                    from: 0.,
                    sweep
                },
                true,
                vector::Ink::solid([255; 4])
            ));
        }
    }

    #[test]
    fn what_was_put_off_counts_as_a_change() {
        run(
            vec![Command::Create {
                id: 1,
                size: [80, 60],
                is_opaque: false,
                is_read_often: true,
                is_wide: false,
            }],
            &[],
        );
        take_changes(1, false, |_, _, _| {});
        step(1, 0);
        take_changes(1, false, |_, [x, y, width, height], _| {
            assert_eq!([x, y, width, height], [0, 0, 39, 60])
        });
    }

    #[test]
    fn what_is_held_for_a_batch_is_limited() {
        let (mut batch, all) = (
            Batch::default(),
            Rect {
                x: 0.,
                y: 0.,
                width: 2048.,
                height: 2048.,
            },
        );
        let is_full = [0, 0, 1, 2].map(|it| {
            images::insert_as(7000 + it, Pixmap::new(2048, 2048).unwrap(), false, None);
            batch.shared.images.add(
                7000 + it,
                [2048.; 2],
                [all; 2],
                &Transform::identity(),
                [true, false],
                &mut batch.bytes,
            );
            batch.is_full()
        });
        (7000..7003).for_each(images::release);
        assert_eq!(is_full, [false, false, false, true]);
    }

    #[test]
    fn only_one_batch_waits() {
        let create = |id| Command::Create {
            id,
            size: [if id == 3 { 4096 } else { 8 }, 1024],
            is_opaque: false,
            is_read_often: true,
            is_wide: false,
        };
        run(vec![create(1), create(2), create(3)], &[]);
        let (area, size) = (
            Rect {
                x: 0.,
                y: 0.,
                width: 8.,
                height: 8.,
            },
            [4096., 1024.],
        );
        let waiting = [
            (1, Command::FillRect(area)),
            (2, Command::FillRect(area)),
            (
                1,
                Command::Image {
                    image: 3,
                    size,
                    from: area,
                    to: area,
                },
            ),
        ]
        .map(|(id, command)| {
            let mut commands = Vec::new();
            [Command::Select(id), command]
                .iter()
                .for_each(|it| it.write(&mut commands));
            get(id).unwrap().borrow_mut().experience.much_was_hidden = true;
            Rc::new(Owned {
                commands,
                parts: Vec::new(),
                stops: Vec::new(),
                filters: Vec::new(),
                dashes: Vec::new(),
                text: Vec::new(),
                is_partial: true,
            })
            .run();
            [1, 2].map(|it| get(it).unwrap().borrow().waiting.is_some())
        });
        assert_eq!(waiting, [[true, false], [false, true], [false, true]]);
        assert_eq!(
            [1, 2].map(|it| with_pixels(it, |it, _| it.data()[3])),
            [Some(255); 2]
        );
    }

    #[test]
    fn paths_that_are_too_long_are_left_out() {
        let split = |count: u32, height: i32| {
            let mut words = Vec::new();
            (0..count)
                .map(|it| [(it % 64) as f32, (it % 2) as f32 * height as f32])
                .enumerate()
                .for_each(|(at, it)| {
                    if at == 0 {
                        Verb::Move(it)
                    } else {
                        Verb::Line(it)
                    }
                    .write(&mut words)
                });
            parts::split(
                &words,
                Span {
                    start: 0,
                    end: words.len() as u32,
                },
                IntRect::new(0, 0, 64, height),
                None,
            )
            .is_some()
        };
        assert_eq!([split(8000, 16384), split(9000, 16384)], [true, false]);
        let verbs: Vec<_> = (0..400_000)
            .map(|it| [(it * 7 % 64) as f32, (it % 2 * 9) as f32])
            .enumerate()
            .map(|(at, it)| {
                if at == 0 {
                    Verb::Move(it)
                } else {
                    Verb::Line(it)
                }
            })
            .collect();
        let (all, after) = (
            Span {
                start: 0,
                end: verbs.len() as u32 * 3,
            },
            Rect {
                x: 0.,
                y: 9.,
                width: 1.,
                height: 1.,
            },
        );
        run(
            vec![
                Command::Create {
                    id: 1,
                    size: [64, 10],
                    is_opaque: false,
                    is_read_often: true,
                    is_wide: false,
                },
                Command::Select(1),
                Command::Fill {
                    verbs: all,
                    is_even_odd: false,
                },
                Command::FillRect(after),
            ],
            &verbs,
        );
        assert_eq!(
            with_pixels(1, |it, _| it.data().iter().filter(|it| **it != 0).count()),
            Some(1)
        );
    }

    #[test]
    fn parts_add_up() {
        let at = |it: u32| {
            [
                (it.wrapping_mul(0x9E37_79B9) >> 16 & 255) as f32 * 1.3 - 20.,
                (it.wrapping_mul(0x85EB_CA6B) >> 16 & 255) as f32 - 20.,
            ]
        };
        let contour = |first: u32, count: u32| {
            std::iter::once(Verb::Move(at(first))).chain((first + 1..first + count).map(
                move |it| {
                    if it % 5 == 0 {
                        Verb::Quad(at(it + 7), at(it))
                    } else {
                        Verb::Line(at(it))
                    }
                },
            ))
        };
        let verbs: Vec<_> = contour(0, 900)
            .chain([Verb::Close])
            .chain(contour(1000, 30))
            .chain(contour(2000, 900))
            .collect();
        let mut words = Vec::new();
        verbs.iter().for_each(|it| it.write(&mut words));
        let (all, area) = (
            Span {
                start: 0,
                end: words.len() as u32,
            },
            IntRect::new(0, 0, 300, 200),
        );
        assert_eq!(
            parts::split(&words, all, area, None).map(|it| (it.all.len(), it.links.len())),
            Some((9, 3))
        );
        for is_even_odd in [false, true] {
            run(
                vec![
                    Command::Create {
                        id: 1,
                        size: [300, 200],
                        is_opaque: false,
                        is_read_often: true,
                        is_wide: false,
                    },
                    Command::Select(1),
                    Command::Fill {
                        verbs: all,
                        is_even_odd,
                    },
                ],
                &verbs,
            );
            let (mut edges, mut whole) = (Edges::default(), Layer::new(area).unwrap());
            edges.density = Density::Always;
            let mut shape = trace(
                &mut edges,
                &mut Default::default(),
                &Outline(&words).path(),
                Fill::NonZero.into(),
                &Transform::identity(),
                area,
            );
            edges.index(&mut shape);
            for mut band in whole.view().split(32) {
                band.combine_samples(
                    &[(&edges, &shape)],
                    is_even_odd,
                    area,
                    &mut Default::default(),
                    &Clip::new(area),
                    (&Paint::Solid([0, 0, 0, 255]), BlendMode::SourceOver),
                );
            }
            let exact = Coverage::of_path(
                &Outline(&words).path(),
                fill_rule(is_even_odd),
                &Transform::identity(),
                area,
            );
            let off = whole
                .pixels()
                .iter()
                .zip(&exact.data)
                .map(|(a, b)| u32::from(a[3].abs_diff(*b)))
                .sum::<u32>()
                / exact.data.len() as u32;
            assert!(
                with_pixels(1, |it, _| it.data() == whole.pixmap.data()).unwrap() && off < 24,
                "{off}"
            );
        }
    }
}
