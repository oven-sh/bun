//! What `src/dom/api/canvas` draws on.

use std::cell::{Cell, RefCell};
use std::mem::MaybeUninit;
use std::rc::Rc;
use std::sync::Arc;

use crate::abi::{self, Filter, GradientStop, PathVerb, Rect, Span, TextRun};
use crate::abi_graphics::{
    self as wire, Area, Baseline, Command, Pen, Snapshot, TextMetrics, TextStyle,
};
use crate::gfx::{self, Cap, Fill, Join, Pixmap, Point, Stroke, Transform};
use crate::hash::{FastMap, FastSet};
use crate::images::{self, Content};
use crate::paint::blend::Mode as BlendMode;
use crate::paint::edges::{Edges, Shape};
use crate::paint::gradient::{Geometry, Gradient, Spread};
use crate::paint::raster::{
    Clip, Coverage, IntRect, Layer, Paint, Path, Pixel, Rows, View, demultiply_row, map_point,
    map_rect, premultiply, scale, trace,
};
use crate::paint::scan::Scanner;
use crate::paint::scene::{Frame, intersect, outset};
use crate::paint::warp;
use crate::paint::{batch, blur};
use crate::paint::{cpu, filter};
use crate::text::{self, Line};
use crate::{parallel, surface};

mod gpu;

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
    filters: Vec<Filter>,
    clip: Clip,
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
    clips: Vec<Clip>,
    accelerated: Option<Box<gpu::Accelerated>>,
    known: gpu::Known,
    load: gpu::Load,
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

pub fn with_pixels<R>(id: u32, f: impl FnOnce(&Pixmap, u32) -> R) -> Option<R> {
    let canvas = settled(id)?;
    let canvas = canvas.try_borrow().ok()?;
    Some(f(&canvas.layer.as_ref()?.pixmap, canvas.version))
}

thread_local! {
    static PATTERNS: RefCell<FastMap<u32, Arc<Pixmap>>> = RefCell::default();
}

/// Of anything that has such a number.
pub fn release(id: u32) {
    CANVASES.with_borrow_mut(|canvases| canvases.remove(&id));
    PATTERNS.with_borrow_mut(|patterns| patterns.remove(&id));
    images::release(id);
    gpu::forget(id);
}

/// `f` gets the size, the area, and its rows.
pub fn take_changes(
    id: u32,
    everything: bool,
    f: impl FnOnce([u32; 2], [u32; 4], &mut dyn Iterator<Item = &[Pixel]>),
) -> Option<()> {
    let canvas = get(id)?;
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
    f(
        [layer.pixmap.width(), layer.pixmap.height()],
        numbers,
        &mut (area.top..area.bottom).map(|y| layer.row(y, area.left, area.right)),
    );
    Some(())
}

/// What another process has drawn.
pub fn show(id: u32, size: [u32; 2], [left, top]: [u32; 2], pixels: Option<Pixmap>) {
    let canvas = CANVASES.with_borrow_mut(|canvases| {
        canvases
            .entry(id)
            .or_insert_with(|| Rc::new(RefCell::new(Canvas::new(false, false))))
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
    gfx::bounds(path)
}

fn transformed(path: &Path, by: &Transform) -> Path {
    path.iter().map(|command| command.transform(by)).collect()
}

/// Without the segments that have no length, and the subpaths that have nothing else.
fn prune(path: impl Iterator<Item = gfx::Command>, kept: &mut Path) {
    use gfx::Command::{Close, CurveTo, LineTo, MoveTo, QuadTo};
    let (mut at, mut start, mut has_segments) = (Point::ZERO, Point::ZERO, false);
    for command in path {
        let end = match command {
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
        kept.push(command);
        (at, has_segments) = (end, true);
    }
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
    fn new(bounds: IntRect) -> State {
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
        let bounds = IntRect::around(bounds);
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
    fn stroke_path(&self, target: Onto, path: &Path) {
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
                self.with_paint(&self.stroke, |paint| {
                    layer.fill_path(path, self.pen(), &self.matrix, clip, paint)
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
                    self.stroke_path(target, &transformed(&list.path(verbs), &inverse));
                }
            }
            Command::FillRect(rect) => self.fill_rect(target, upright(rect)),
            Command::StrokeRect(rect) => self.stroke_path(target, &rect_path(upright(rect))),
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
        let placement = matrix
            .pre_translate(to.x, to.y)
            .pre_scale(to.width / from.width, to.height / from.height)
            .pre_translate(-from.x, -from.y);
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
            && part.to_rect() == from;
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

#[inline]
fn command(verb: &PathVerb) -> gfx::Command {
    match *verb {
        PathVerb::Move(to) => gfx::Command::MoveTo(to.into()),
        PathVerb::Line(to) => gfx::Command::LineTo(to.into()),
        PathVerb::Cubic(a, b, to) => gfx::Command::CurveTo(a.into(), b.into(), to.into()),
        PathVerb::Close => gfx::Command::Close,
    }
}

fn path(verbs: &[PathVerb]) -> Path {
    verbs.iter().map(command).collect()
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
    /// In pixels, as are those below.
    Rect(Rect),
    AlignedRect(IntRect),
    Clear(IntRect),
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

/// What changes less often.
#[derive(Clone)]
struct Setting {
    matrix: Transform,
    inverse: Option<Transform>,
    clip: Clip,
    dashes: Vec<f32>,
    alpha: f32,
    is_smooth: bool,
}

/// What is drawn with source-over and without effects waits here for more of its kind.
#[derive(Default)]
struct Batch {
    jobs: Vec<Job>,
    settings: Vec<Setting>,
    styles: Vec<Style>,
    has_setting: bool,
    /// That are only kept for the jobs, at most.
    bytes: usize,
}

impl Batch {
    const MAX_BYTES: usize = 4 << 20;

    fn add(&mut self, state: &State, figure: Figure, style: &Style) {
        if !std::mem::replace(&mut self.has_setting, true) {
            let State {
                matrix,
                alpha,
                is_smooth,
                ..
            } = *state;
            let known = self.settings.last().and_then(|it| it.clip.mask.as_ref());
            let mask = state
                .clip
                .mask
                .as_ref()
                .filter(|it| !known.is_some_and(|known| Arc::ptr_eq(known, it)));
            self.bytes += size_of_val(&state.dashes[..]) + mask.map_or(0, |it| it.data.len());
            self.settings.push(Setting {
                matrix,
                inverse: matrix.invert(),
                clip: state.clip.clone(),
                dashes: state.dashes.clone(),
                alpha,
                is_smooth,
            });
        }
        let ink = match style {
            Style::Color(color) => Ink::Solid(premultiply(with_alpha(*color, state.alpha))),
            style => {
                self.styles.push(style.clone());
                Ink::Style(self.styles.len() as u32 - 1)
            }
        };
        self.jobs.push(Job {
            figure,
            ink,
            setting: self.settings.len() as u32 - 1,
        });
    }

    fn paint(&mut self, canvas: &mut Canvas, list: &Owned) {
        if let Some(layer) = canvas.layer.as_mut().filter(|_| !self.jobs.is_empty()) {
            batch::paint(layer, &(&*self, list));
            canvas.changed = self
                .settings
                .iter()
                .fold(canvas.changed, |all, it| all.union(it.clip.rect));
        }
        self.clear();
    }

    fn clear(&mut self) {
        self.jobs.clear();
        self.settings.clear();
        self.styles.clear();
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

impl batch::Jobs for (&Batch, &Owned) {
    fn len(&self) -> usize {
        self.0.jobs.len()
    }

    fn trace(&self, job: usize, area: IntRect, edges: &mut Edges, room: &mut batch::Room) -> Shape {
        let (job, verbs, path) = (
            &self.0.jobs[job],
            |it: Span| self.1.verbs[it.range()].iter().map(command),
            &mut room.path,
        );
        let Setting {
            matrix,
            inverse,
            clip,
            dashes,
            ..
        } = &self.0.settings[job.setting as usize];
        let (area, identity) = (area.intersect(clip.rect), Transform::identity());
        path.clear();
        let (style, matrix) = match job.figure {
            Figure::Fill(span, rule) => {
                path.extend(verbs(span));
                (rule.into(), &identity)
            }
            Figure::Stroke(span, pen) => {
                match inverse {
                    Some(_) if *matrix == identity => prune(verbs(span), path),
                    Some(inverse) => prune(verbs(span).map(|it| it.transform(inverse)), path),
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
            Figure::AlignedRect(rect) | Figure::Clear(rect) => {
                return Shape::blank(rect.intersect(area));
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
        let job = &self.0.jobs[job];
        let setting = &self.0.settings[job.setting as usize];
        let mut draw = |paint: &Paint| match (&job.figure, paint) {
            (Figure::Rect(rect), Paint::Solid(color)) => {
                on.fill_rect(*rect, *color, setting.clip.rect)
            }
            (Figure::Clear(_), Paint::Solid(color)) => on.set(shape.area, *color),
            (Figure::AlignedRect(_), _) => on.fill(shape.area, None, &setting.clip, paint),
            _ => on.fill_shape(edges, shape, scanner, &setting.clip, paint),
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

    fn cost(&self, job: usize, shape: &Shape) -> u64 {
        let (job, area) = (&self.0.jobs[job], shape.area.area() as u64);
        let inside = match (&job.ink, &job.figure) {
            (Ink::Style(_), _) => area * 2,
            (_, Figure::Stroke(..) | Figure::StrokeRect(..)) => 0,
            _ => area / 8,
        };
        100 + u64::from(shape.length) * 4 + inside
    }
}

/// `wire::Commands`, for another thread.
pub struct Owned {
    commands: Vec<Command>,
    verbs: Vec<PathVerb>,
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
                verbs: from.verbs.get().to_vec(),
                stops: from.stops.get().to_vec(),
                filters: from.filters.get().to_vec(),
                dashes: from.dashes.get().to_vec(),
                text: from.text.get().to_vec(),
                is_partial: from.is_partial,
            }
        }
    }

    fn path(&self, verbs: Span) -> Path {
        path(&self.verbs[verbs.range()])
    }

    fn style(&self, paint: wire::Paint) -> Style {
        let (geometry, stops) = match paint {
            wire::Paint::Color(color) => return Style::Color(color),
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
                let tile = PATTERNS.with_borrow(|patterns| patterns.get(&tile).cloned());
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

    pub fn len(&self) -> usize {
        self.commands.len()
    }

    /// Those that it may change.
    pub fn canvases(&self) -> impl Iterator<Item = u32> {
        self.commands.iter().filter_map(|it| {
            if let Command::Select(id) | Command::Release(id) = it {
                Some(*id)
            } else {
                None
            }
        })
    }

    fn bytes(&self) -> usize {
        size_of_val(&self.commands[..])
            + size_of_val(&self.verbs[..])
            + size_of_val(&self.stops[..])
            + size_of_val(&self.dashes[..])
            + self.text.len()
    }

    pub fn run(self: Rc<Self>) {
        let (mut selected, mut current, mut is_marked, mut batch) =
            (0, None::<Rc<RefCell<Canvas>>>, false, BATCH.take());
        let pause = |canvas: &RefCell<Canvas>, batch: &mut Batch, next: usize| {
            let canvas = &mut *canvas.borrow_mut();
            batch.paint(canvas, &self);
            canvas.pause(&self, next);
        };
        for (index, command) in self.commands.iter().enumerate() {
            if let (
                Command::Create { .. }
                | Command::Snapshot(_)
                | Command::Release(_)
                | Command::Select(_),
                Some(canvas),
            ) = (command, &current)
            {
                pause(canvas, &mut batch, index);
            }
            match *command {
                Command::Create {
                    id,
                    size,
                    is_opaque,
                    is_read_often,
                } => {
                    let mut canvas = Canvas::new(is_opaque, is_read_often);
                    canvas.reset(size);
                    CANVASES.with_borrow_mut(|canvases| {
                        canvases.insert(id, Rc::new(RefCell::new(canvas)))
                    });
                }
                Command::Snapshot(wanted) => match snapshot(&wanted) {
                    Some(tile) if wanted.is_tile => drop(
                        PATTERNS
                            .with_borrow_mut(|patterns| patterns.insert(wanted.id, Arc::new(tile))),
                    ),
                    Some(pixmap) => images::insert_as(wanted.id, pixmap),
                    None => {}
                },
                Command::Release(id) => release(id),
                Command::DropFontScope(scope) => crate::text::drop_font_scope(scope),
                Command::Select(id) => {
                    (selected, current, is_marked) = (id, get(id), false);
                    current
                        .iter()
                        .for_each(|it| it.borrow_mut().select(id, index + 1));
                }
                command => {
                    let Some(canvas) = &current else { continue };
                    if canvas
                        .borrow_mut()
                        .run(selected, command, &self, index, &mut batch)
                        && !std::mem::replace(&mut is_marked, true)
                    {
                        CHANGED.with_borrow_mut(|changed| changed.insert(selected));
                    }
                }
            }
        }
        current
            .into_iter()
            .for_each(|it| pause(&it, &mut batch, self.commands.len()));
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

impl State {
    fn clip_to(&mut self, path: &Path, rule: Fill) -> Clip {
        let bounds = path_bounds(path);
        let area = IntRect::around(bounds).intersect(self.clip.rect);
        if IntRect::around(bounds).to_rect() == bounds && is_upright_rect(path) {
            let clip = self.clip.within_rect(area);
            return std::mem::replace(&mut self.clip, clip);
        }
        let coverage = Coverage::of_path(path, rule, &Transform::identity(), area);
        let clip = match coverage.data.iter().all(|value| *value == 255) {
            true => self.clip.within_rect(coverage.rect),
            false => self.clip.within(coverage),
        };
        std::mem::replace(&mut self.clip, clip)
    }
}

impl Canvas {
    fn new(is_opaque: bool, is_read_often: bool) -> Canvas {
        let (changed, state) = (IntRect::default(), State::new(IntRect::default()));
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
        (self.state, self.clips, self.changed) = (State::new(bounds), Vec::new(), bounds);
    }

    fn replace(&mut self, pixels: Layer) {
        self.changed = self.changed.union(pixels.rect);
        match &mut self.layer {
            Some(layer) if layer.rect == pixels.rect => *layer = pixels,
            Some(layer) => layer.replace(&pixels, &Clip::new(pixels.rect)),
            None => {}
        }
    }

    /// Whether it draws.
    fn run(
        &mut self,
        id: u32,
        command: Command,
        list: &Rc<Owned>,
        index: usize,
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
            Command::FillPaint(paint) => state.fill = list.style(paint),
            Command::StrokePaint(paint) => state.stroke = list.style(paint),
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
                let before = state.clip_to(&list.path(verbs), fill_rule(is_even_odd));
                self.clips.extend(saves.then_some(before));
            }
            Command::RestoreClip => self
                .clips
                .pop()
                .into_iter()
                .for_each(|clip| state.clip = clip),
            command => {
                self.version = self.version.wrapping_add(1);
                if self.accelerated.is_some() && self.draw_on_gpu(id, command, list, index) {
                    return true;
                }
                if batch.bytes > Batch::MAX_BYTES {
                    batch.paint(self, list);
                }
                if let Command::Reset(size) = command {
                    batch.clear();
                    self.reset(size);
                    self.select(id, index);
                } else if self.accelerated.is_some() || !self.put_off(command, batch) {
                    batch.paint(self, list);
                    self.draw(id, command, list);
                }
                return true;
            }
        }
        false
    }

    /// False if it has to be drawn now.
    fn put_off(&self, command: Command, batch: &mut Batch) -> bool {
        let (Some(target), state) = (&self.layer, &self.state) else {
            return false;
        };
        let is_shared = target.pixmap.is_shared();
        let (figure, style) = match command {
            Command::ClearRect(rect) => {
                let device = map_rect(&state.matrix, upright(rect));
                let pixels = IntRect::nearest(device);
                if state.matrix.has_skew()
                    || pixels.to_rect() != device
                    || state.clip.mask.is_some()
                    || is_shared
                {
                    return false;
                }
                if pixels.intersect(state.clip.rect) == target.rect {
                    batch.clear();
                }
                batch.add(state, Figure::Clear(pixels), &Style::Color(0));
                batch.jobs.last_mut().into_iter().for_each(|it| {
                    it.ink = Ink::Solid([0, 0, 0, if self.is_opaque { 255 } else { 0 }])
                });
                return true;
            }
            _ if state.mode != BlendMode::SourceOver || state.has_effects() => return false,
            Command::Fill { verbs, is_even_odd } => {
                (Figure::Fill(verbs, fill_rule(is_even_odd)), &state.fill)
            }
            Command::Stroke { verbs } => (Figure::Stroke(verbs, state.pen), &state.stroke),
            Command::StrokeRect(rect) => {
                (Figure::StrokeRect(upright(rect), state.pen), &state.stroke)
            }
            Command::FillRect(_) if is_shared => return false,
            Command::FillRect(rect) => {
                let device = map_rect(&state.matrix, upright(rect));
                let figure = match (&state.fill, IntRect::nearest(device)) {
                    _ if state.matrix.has_skew() => Figure::TurnedRect(upright(rect)),
                    (Style::Color(_), _) if state.clip.mask.is_none() => Figure::Rect(device),
                    (_, pixels) if pixels.to_rect() == device => Figure::AlignedRect(pixels),
                    _ => Figure::TurnedRect(upright(rect)),
                };
                (figure, &state.fill)
            }
            _ => return false,
        };
        batch.add(state, figure, style);
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
            Command::Erase => {
                State::new(target.rect).clear_rect(target, target.rect.to_rect(), self.is_opaque)
            }
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

pub fn is_in_path(point: [f32; 2], verbs: &[PathVerb], is_even_odd: bool) -> bool {
    covers(
        &path(verbs),
        fill_rule(is_even_odd),
        Transform::identity(),
        point,
    )
}

pub fn is_in_stroke(
    point: [f32; 2],
    verbs: &[PathVerb],
    to: abi::Matrix,
    pen: Pen,
    dashes: &[f32],
) -> bool {
    let matrix = matrix(to);
    matrix.invert().is_some_and(|inverse| {
        covers(
            &transformed(&path(verbs), &inverse),
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

fn snapshot(wanted: &Snapshot) -> Option<Pixmap> {
    allow_sharing(wanted.source);
    let is_whole = !wanted.flips
        && wanted.part
            == Rect {
                x: 0.,
                y: 0.,
                width: wanted.size[0],
                height: wanted.size[1],
            };
    let shared = images::with_first_frame(wanted.source, |content, _| match content {
        Content::Pixels(it) if is_whole && [it.width(), it.height()] == wanted.to => it.shared(),
        _ => None,
    });
    shared.flatten().or_else(|| draw_snapshot(wanted))
}

fn draw_snapshot(wanted: &Snapshot) -> Option<Pixmap> {
    let [width, height] = wanted.to.map(|it| i32::try_from(it).unwrap_or(0));
    let mut target = Layer::new(IntRect::new(0, 0, width, height))?;
    let (mut state, to) = (State::new(target.rect), target.rect.to_rect());
    state.is_smooth = wanted.is_smooth;
    if wanted.flips {
        state.matrix = Transform::from_row(1., 0., 0., -1., 0., to.height);
    }
    images::with_first_frame(wanted.source, |content, _| {
        state.draw_image(
            Onto::Layer(&mut target),
            content,
            wanted.size,
            wanted.part,
            to,
        )
    });
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

impl Loan {
    pub fn has(&self, area: Area) -> bool {
        let wanted = self.layer.rect.intersect(pixels(area));
        wanted.is_empty() || self.known.contains(wanted)
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
                    if !is_on_black {
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
    use crate::paint::vector;

    fn run(commands: Vec<Command>, verbs: &[PathVerb]) {
        let (stops, filters, dashes, text) = Default::default();
        Rc::new(Owned {
            commands,
            verbs: verbs.into(),
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
                PathVerb::Move(at(0, 0)),
                PathVerb::Line(at(30, 5)),
                PathVerb::Line(at(9, 25)),
                PathVerb::Close,
            ],
            Span { start: 0, end: 4 },
        );
        let mut commands = vec![
            Command::Select(id),
            Command::FillPaint(wire::Paint::Color(number.wrapping_mul(0x9E37_79B9) | 0x60)),
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
    fn what_was_put_off_counts_as_a_change() {
        run(
            vec![Command::Create {
                id: 1,
                size: [80, 60],
                is_opaque: false,
                is_read_often: true,
            }],
            &[],
        );
        take_changes(1, false, |_, _, _| {});
        step(1, 0);
        take_changes(1, false, |_, area, _| assert_eq!(area, [0, 0, 80, 60]));
    }
}
