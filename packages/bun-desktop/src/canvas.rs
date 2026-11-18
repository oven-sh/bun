//! What `src/dom/api/canvas` draws on.

use std::cell::RefCell;
use std::mem::MaybeUninit;
use std::rc::Rc;

use crate::abi::{self, Filter, GradientStop, PathVerb, Rect, RoundedRect, Span, TextRun};
use crate::abi_graphics::{
    self as wire, Area, Baseline, Command, Pen, Snapshot, TextMetrics, TextStyle,
};
use crate::gfx::{self, Cap, Fill, Join, PathBuilder as _, Pixmap, Point, Stroke, Transform};
use crate::hash::FastMap;
use crate::images::{self, Content};
use crate::paint::blend::Mode as BlendMode;
use crate::paint::blur;
use crate::paint::gradient::{Geometry, Gradient, Spread};
use crate::paint::raster::{
    Clip, Coverage, IntRect, Layer, Paint, Path, Pixel, Rows, demultiply, map_point, map_rect,
    premultiply, rounded_rect_path, scale,
};
use crate::paint::scene::{Frame, outset};
use crate::paint::warp;
use crate::paint::{cpu, filter};
use crate::text::{self, Line};
use crate::{parallel, surface};

enum Style {
    Color(u32),
    Gradient(Gradient),
    Pattern {
        tile: Rc<Pixmap>,
        repeats: [bool; 2],
        matrix: Transform,
    },
}

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
    clips: Vec<Clip>,
}

thread_local! {
    static CANVASES: RefCell<FastMap<u32, Rc<RefCell<Canvas>>>> = RefCell::default();
    /// The windows were not told yet.
    static CHANGED: RefCell<Vec<u32>> = RefCell::default();
}

fn get(id: u32) -> Option<Rc<RefCell<Canvas>>> {
    CANVASES.with_borrow(|canvases| canvases.get(&id).cloned())
}

pub fn with_pixels<R>(id: u32, f: impl FnOnce(&Pixmap, u32) -> R) -> Option<R> {
    let canvas = get(id)?;
    let canvas = canvas.try_borrow().ok()?;
    Some(f(&canvas.layer.as_ref()?.pixmap, canvas.version))
}

thread_local! {
    static PATTERNS: RefCell<FastMap<u32, Rc<Pixmap>>> = RefCell::default();
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
fn pruned(path: &Path) -> Path {
    use gfx::Command::{Close, CurveTo, LineTo, MoveTo, QuadTo};
    let (mut kept, mut at, mut start, mut has_segments) =
        (Path::new(), Point::ZERO, Point::ZERO, false);
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
        let State {
            line_width: width,
            cap,
            join,
            miter_limit,
            dash_offset,
            ..
        } = *self;
        Stroke {
            width,
            cap,
            join,
            miter_limit,
            dashes: &self.dashes,
            dash_offset,
        }
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
    fn compose(&self, target: &mut Layer, bounds: Rect, draw: impl FnOnce(&mut Layer, &Clip)) {
        let bounds = IntRect::around(bounds);
        if self.mode == BlendMode::SourceOver && !self.has_effects() {
            return draw(target, &self.clip.within_rect(bounds));
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
        let area = bounds.intersect(needed.outset(filter_reach));
        let mut blend = |source: &Layer| match self.mode {
            BlendMode::SourceOver => target.draw(source, None, &self.clip),
            mode => target.draw_with_mode(source, mode, &self.clip_for(source.rect)),
        };
        let Some(mut source) = Layer::new(area).or_else(|| Layer::new(IntRect::new(-1, -1, 0, 0)))
        else {
            return;
        };
        draw(&mut source, &Clip::new(area));
        filter::apply(&mut source, &self.filters, &Transform::identity(), needed);
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
        if let (Style::Color(color), BlendMode::SourceOver, None) =
            (&self.fill, self.mode, &self.clip.mask)
            && !self.matrix.has_skew()
            && !self.has_effects()
        {
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
        let (part, dx, dy) = (
            IntRect::around(from),
            placement.tx.round(),
            placement.ty.round(),
        );
        let is_copy = frame_is_unscaled(&placement)
            && (placement.tx - dx).abs() + (placement.ty - dy).abs() < 1e-3
            && part.to_rect() == from;
        let (dx, dy, is_masked) = (
            dx as i32,
            dy as i32,
            self.mode == BlendMode::SourceOver && self.clip.mask.is_some(),
        );
        if let (Content::Pixels(pixmap), true) =
            (&content, is_copy && !is_masked && !self.has_effects())
        {
            let (rect, by) = (
                part.offset(dx, dy),
                (self.alpha.min(1.) * 255.).round() as u8,
            );
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
                    svg.draw(&mut drawn, all, &placement);
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

fn path(verbs: &[PathVerb]) -> Path {
    let mut path = Path::with_capacity(verbs.len());
    for verb in verbs {
        match *verb {
            PathVerb::Move(to) => path.move_to(to),
            PathVerb::Line(to) => path.line_to(to),
            PathVerb::Cubic(a, b, to) => path.curve_to(a, b, to),
            PathVerb::Close => path.close(),
        };
    }
    path
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
        Style::Gradient(Gradient::new(
            geometry,
            &self.stops[stops.range()],
            Spread::Pad,
            false,
        ))
    }

    pub fn len(&self) -> usize {
        self.commands.len()
    }

    pub fn run(&self) {
        let (mut selected, mut current, mut is_marked) = (0, None, false);
        for command in &self.commands {
            match *command {
                Command::Create {
                    id,
                    size,
                    is_opaque,
                } => {
                    let state = State::new(IntRect::default());
                    let mut canvas = Canvas {
                        layer: None,
                        version: 0,
                        is_opaque,
                        state,
                        clips: Vec::new(),
                    };
                    canvas.reset(size);
                    CANVASES.with_borrow_mut(|canvases| {
                        canvases.insert(id, Rc::new(RefCell::new(canvas)))
                    });
                }
                Command::Snapshot(wanted) => match snapshot(&wanted) {
                    Some(tile) if wanted.is_tile => drop(
                        PATTERNS
                            .with_borrow_mut(|patterns| patterns.insert(wanted.id, Rc::new(tile))),
                    ),
                    Some(pixmap) => images::insert_as(wanted.id, pixmap),
                    None => {}
                },
                Command::Release(id) => {
                    CANVASES.with_borrow_mut(|canvases| canvases.remove(&id));
                    PATTERNS.with_borrow_mut(|patterns| patterns.remove(&id));
                    images::release(id);
                }
                Command::DropFontScope(scope) => crate::text::drop_font_scope(scope),
                Command::Select(id) => (selected, current, is_marked) = (id, get(id), false),
                command => {
                    let Some(canvas) = &current else { continue };
                    if canvas.borrow_mut().run(selected, command, self)
                        && !std::mem::replace(&mut is_marked, true)
                    {
                        CHANGED.with_borrow_mut(|changed| {
                            changed.extend((!changed.contains(&selected)).then_some(selected))
                        });
                    }
                }
            }
        }
        if !self.is_partial {
            CHANGED.take().into_iter().for_each(surface::image_changed);
        }
    }
}

impl State {
    fn set_pen(&mut self, pen: Pen, dashes: &[f32]) {
        (self.line_width, self.miter_limit, self.dash_offset) =
            (pen.width, pen.miter_limit, pen.dash_offset);
        self.cap = [Cap::Butt, Cap::Round, Cap::Square][pen.cap as usize];
        self.join = [Join::Miter, Join::Round, Join::Bevel][pen.join as usize];
        dashes.clone_into(&mut self.dashes);
    }

    fn clip_to(&mut self, path: &Path, rule: Fill) -> Clip {
        let area = IntRect::around(path_bounds(path)).intersect(self.clip.rect);
        let coverage = Coverage::of_path(path, rule, &Transform::identity(), area);
        let clip = match coverage.data.iter().all(|value| *value == 255) {
            true => self.clip.within_rect(coverage.rect),
            false => self.clip.within(coverage),
        };
        std::mem::replace(&mut self.clip, clip)
    }
}

impl Canvas {
    fn reset(&mut self, [width, height]: [u32; 2]) {
        let bounds = IntRect::new(0, 0, width.min(1 << 16) as i32, height.min(1 << 16) as i32);
        self.layer = Layer::new(bounds);
        if let Some(layer) = self.layer.as_mut().filter(|_| self.is_opaque) {
            layer.pixels_mut().fill([0, 0, 0, 255]);
        }
        (self.state, self.clips) = (State::new(bounds), Vec::new());
    }

    /// Whether it draws.
    fn run(&mut self, id: u32, command: Command, list: &Owned) -> bool {
        let state = &mut self.state;
        match command {
            Command::Transform(to) => state.matrix = matrix(to),
            Command::FillPaint(paint) => state.fill = list.style(paint),
            Command::StrokePaint(paint) => state.stroke = list.style(paint),
            Command::Compositing { alpha, operator } => {
                (state.alpha, state.mode) = (alpha, MODES[operator as usize])
            }
            Command::Pen { pen, dashes } => state.set_pen(pen, &list.dashes[dashes.range()]),
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
                self.draw(id, command, list);
                return true;
            }
        }
        false
    }

    fn draw(&mut self, id: u32, command: Command, list: &Owned) {
        if let Command::Reset(size) = command {
            return self.reset(size);
        }
        let (Some(target), state) = (&mut self.layer, &self.state) else {
            return;
        };
        match command {
            Command::Erase => {
                State::new(target.rect).clear_rect(target, target.rect.to_rect(), self.is_opaque)
            }
            Command::Fill { verbs, is_even_odd } => {
                state.fill_path(target, &list.path(verbs), fill_rule(is_even_odd))
            }
            Command::Stroke { verbs } => {
                if let Some(inverse) = state.matrix.invert() {
                    state.stroke_path(target, &transformed(&list.path(verbs), &inverse));
                }
            }
            Command::FillRect(rect) => state.fill_rect(target, upright(rect)),
            Command::StrokeRect(rect) => state.stroke_path(target, &rect_path(upright(rect))),
            Command::ClearRect(rect) => state.clear_rect(target, upright(rect), self.is_opaque),
            Command::Text {
                text,
                style,
                at: [x, y],
                alignment,
                max_width,
                strokes,
            } => {
                let line = line(
                    std::str::from_utf8(&list.text[text.range()]).unwrap_or_default(),
                    &style,
                );
                let squeeze = if line.width > max_width {
                    max_width / line.width
                } else {
                    1.
                };
                let (x, y) = (
                    x - line.width * squeeze * alignment,
                    y + baseline_offset(&text::levels(style.font, style.size), style.baseline),
                );
                state.draw_text(
                    target,
                    &line,
                    style.size,
                    state.matrix.pre_translate(x, y).pre_scale(squeeze, 1.),
                    strokes,
                );
            }
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
                    target,
                    Content::Pixels(&before),
                    size,
                    upright(from),
                    upright(to),
                );
            }
            Command::Image {
                image,
                size,
                from,
                to,
            } => {
                if state.mode == BlendMode::Source {
                    allow_sharing(image);
                }
                images::with_first_frame(image, |content, _| {
                    state.draw_image(target, content, size, upright(from), upright(to))
                });
            }
            _ => {}
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
    let (mut state, matrix) = (State::new(IntRect::default()), matrix(to));
    state.set_pen(pen, dashes);
    matrix.invert().is_some_and(|inverse| {
        covers(
            &transformed(&path(verbs), &inverse),
            state.pen(),
            matrix,
            point,
        )
    })
}

fn allow_sharing(id: u32) {
    if let Some(canvas) = get(id)
        && let Some(layer) = &mut canvas.borrow_mut().layer
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
        state.draw_image(&mut target, content, wanted.size, wanted.part, to)
    });
    Some(target.pixmap)
}

/// Premultiplied colors are those on black. False if it has not written everything.
pub fn read(id: u32, area: Area, is_on_black: bool, rgba: &mut [MaybeUninit<Pixel>]) -> bool {
    let (canvas, wanted) = (get(id), pixels(area));
    let canvas = canvas.as_ref().map(|it| it.borrow());
    let layer = canvas.as_ref().and_then(|it| it.layer.as_ref());
    let shared = layer.map_or_else(IntRect::default, |it| it.rect.intersect(wanted));
    let Some(layer) = layer.filter(|_| !shared.is_empty()) else {
        return false;
    };
    if shared != wanted || wanted.area() != rgba.len() as i64 {
        rgba.fill(MaybeUninit::new([0; 4]));
    }
    let (width, above) = (area[2] as usize, (shared.top - wanted.top) as usize);
    parallel::in_bands(
        &mut rgba[above * width..][..shared.height() * width],
        width,
        shared.area(),
        |first, band| {
            for (row, y) in band
                .chunks_exact_mut(width)
                .zip(shared.top + first as i32..)
            {
                let (to, from) = (
                    &mut row[(shared.left - wanted.left) as usize..][..shared.width()],
                    layer.row(y, shared.left, shared.right),
                );
                let to = to.write_copy_of_slice(from);
                if !is_on_black
                    && from
                        .iter()
                        .fold(!0, |all, pixel| all & u32::from_le_bytes(*pixel))
                        >> 24
                        != 255
                {
                    to.iter_mut().for_each(|it| *it = demultiply(*it));
                }
            }
        },
    );
    true
}

pub fn part_of(rgba: &[u8], area: Area, part: Area) -> Vec<u8> {
    let [left, top] = [0, 1].map(|axis| (i64::from(part[axis]) - i64::from(area[axis])) as usize);
    let rows = rgba
        .chunks(area[2] as usize * 4)
        .skip(top)
        .take(part[3] as usize);
    let mut copy = Vec::with_capacity(part[2] as usize * part[3] as usize * 4);
    rows.for_each(|row| copy.extend_from_slice(&row[left * 4..][..part[2] as usize * 4]));
    copy
}

pub fn write(id: u32, area: Area, mut rgba: Vec<u8>) {
    let Some(canvas) = get(id) else { return };
    let mut canvas = canvas.borrow_mut();
    if canvas.is_opaque {
        rgba.as_chunks_mut::<4>()
            .0
            .iter_mut()
            .for_each(|pixel| pixel[3] = 255);
    }
    let (rect, pixmap) = (
        pixels(area),
        images::pixmap_from_rgba(area[2] as u32, area[3] as u32, rgba),
    );
    if let (Some(layer), Some(pixmap)) = (&mut canvas.layer, pixmap) {
        layer.replace(&Layer { rect, pixmap }, &Clip::new(rect));
    }
    canvas.version = canvas.version.wrapping_add(1);
    CHANGED.with_borrow_mut(|changed| changed.extend((!changed.contains(&id)).then_some(id)));
}
