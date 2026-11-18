//! https://html.spec.whatwg.org/#2dcontext

use core::cell::Cell;
use std::borrow::Cow;
use std::rc::Rc;

use bun_jsc::bindgen::{self, IntoError as _, JsHeap, JsInterface as _, JsLocal, JsScope, to_js};
use bun_jsc::{DOMExceptionCode, JSGlobalObject, JSValue, JsCell, JsResult};

use super::bitmap::{Bitmap, Source, area_of, convert, snapshot};
use super::image_data::ImageData;
use super::paint::{CanvasGradient, CanvasPattern, Color, Paint, Parsed, Shape, parse_six_digits};
use super::path::{Path, add_transformed};
use super::recorder::{List, add};
use super::text::{Font, Inherited, Spacing, TextMetrics, Variation, with_units};
use super::{Affine, Failure, are_finite, host};
use crate::abi::{self, Rect, Slice, Span};
use crate::abi_graphics::{self as wire, Command, Snapshot};
use crate::api::core::Element;
use crate::api::geometry::{DOMMatrix, DOMMatrix2DInit, Matrix};
use crate::generated_bindgen::canvas::{
    CanvasDirection, CanvasDrawing, CanvasFillRule, CanvasFontKerning, CanvasFontStretch,
    CanvasFontVariantCaps, CanvasImageSource, CanvasLineCap, CanvasLineJoin,
    CanvasRenderingContext2D, CanvasRenderingContext2DSettings as Settings, CanvasStyle,
    CanvasTextAlign, CanvasTextBaseline, CanvasTextRendering, ContextAttributes,
    GlobalCompositeOperation, ImageDataSettings, ImageSmoothingQuality, Path2D,
    PredefinedColorSpace, js_Canvas2D as js, js_CanvasGradient, js_CanvasPattern, js_TextMetrics,
};
use crate::name::Name;
use crate::platform::graphics;
use crate::properties::{Id, Prop, Value};
use crate::values::{Out, Str, text};

bitflags::bitflags! {
    /// The parts of the state that the library gets with one command each.
    #[derive(Clone, Copy, PartialEq, Eq)]
    struct Parts: u16 {
        const MATRIX = 1;
        const FILL = 1 << 1;
        const STROKE = 1 << 2;
        const COMPOSITING = 1 << 3;
        const PEN = 1 << 4;
        const SHADOW = 1 << 5;
        const SMOOTHING = 1 << 6;
        const FILTER = 1 << 7;
        const WIDTH = 1 << 8;
        const NONE = 0;
        const LINE = Self::PEN.bits() | Self::WIDTH.bits() | Self::MATRIX.bits();
        const EFFECTS = Self::COMPOSITING.bits() | Self::SHADOW.bits() | Self::FILTER.bits();
        const PLACED = Self::EFFECTS.bits() | Self::MATRIX.bits() | Self::SMOOTHING.bits();
    }
}

#[derive(Clone)]
enum Style {
    Color(Color),
    Paint(Rc<Paint>),
}

impl Style {
    fn version(&self) -> u32 {
        if let Style::Paint(paint) = self {
            paint.version.get()
        } else {
            0
        }
    }

    #[inline(always)]
    fn record(
        &self,
        list: &mut List,
        is_wide: bool,
        of_color: impl Fn(u32) -> Command,
        of_paint: impl Fn(Span) -> Command,
    ) {
        match self {
            Style::Color(color) => list.push(of_color(color.for_canvas(is_wide))),
            Style::Paint(paint) => {
                let paint = paint.record(list, is_wide);
                list.push(of_paint(paint));
            }
        }
    }
}

struct Filter {
    source: Box<[u8]>,
    functions: Vec<abi::Filter>,
}

/// https://html.spec.whatwg.org/#drawing-state
#[derive(Clone)]
struct State {
    matrix: Affine,
    /// For filling and for stroking.
    styles: [Style; 2],
    alpha: f64,
    operator: GlobalCompositeOperation,
    line_width: f64,
    miter_limit: f64,
    dash_offset: f64,
    cap: CanvasLineCap,
    join: CanvasLineJoin,
    dashes: Option<Rc<[f64]>>,
    shadow_x: f64,
    shadow_y: f64,
    shadow_blur: f64,
    shadow_color: Color,
    is_smooth: bool,
    quality: ImageSmoothingQuality,
    filter: Option<Rc<Filter>>,
    /// `None` is the default.
    font: Option<Rc<Font>>,
    kerning: CanvasFontKerning,
    stretch: CanvasFontStretch,
    caps: CanvasFontVariantCaps,
    rendering: CanvasTextRendering,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    direction: CanvasDirection,
    /// `None` is `inherit`.
    language: Option<Str>,
    letter_spacing: Spacing,
    word_spacing: Spacing,
    /// Since it was saved.
    changed: Parts,
    has_clipped: bool,
}

const FILL: usize = 0;
const STROKE: usize = 1;
const DEFAULT_FONT: &[u8] = b"10px sans-serif";
const MAX_SAVED: usize = 1 << 14;

macro_rules! same_variants {
    ($($from:ident => $to:ident { $($variant:ident),+ })+) => {$(
        impl From<$from> for wire::$to {
            fn from(value: $from) -> Self {
                match value { $($from::$variant => wire::$to::$variant),+ }
            }
        }
    )+};
}

same_variants! {
    CanvasLineCap => Cap { Butt, Round, Square }
    CanvasLineJoin => Join { Miter, Round, Bevel }
    CanvasTextBaseline => Baseline { Alphabetic, Top, Hanging, Middle, Ideographic, Bottom }
    GlobalCompositeOperation => Operator {
        SourceOver, SourceIn, SourceOut, SourceAtop, DestinationOver, DestinationIn, DestinationOut, DestinationAtop, Lighter,
        Copy, Xor, Multiply, Screen, Overlay, Darken, Lighten, ColorDodge, ColorBurn, HardLight, SoftLight, Difference,
        Exclusion, Hue, Saturation, Color, Luminosity, Clear
    }
}

impl State {
    #[optimize(size)]
    fn new() -> State {
        State {
            matrix: Affine::default(),
            styles: [const { Style::Color(Color::BLACK) }; 2],
            alpha: 1.0,
            operator: GlobalCompositeOperation::SourceOver,
            line_width: 1.0,
            miter_limit: 10.0,
            dash_offset: 0.0,
            cap: CanvasLineCap::Butt,
            join: CanvasLineJoin::Miter,
            dashes: None,
            shadow_x: 0.0,
            shadow_y: 0.0,
            shadow_blur: 0.0,
            shadow_color: Color::TRANSPARENT,
            is_smooth: true,
            quality: ImageSmoothingQuality::Low,
            filter: None,
            font: None,
            kerning: CanvasFontKerning::Auto,
            stretch: CanvasFontStretch::Normal,
            caps: CanvasFontVariantCaps::Normal,
            rendering: CanvasTextRendering::Auto,
            align: CanvasTextAlign::Start,
            baseline: CanvasTextBaseline::Alphabetic,
            direction: CanvasDirection::Inherit,
            language: None,
            letter_spacing: Spacing::default(),
            word_spacing: Spacing::default(),
            changed: Parts::NONE,
            has_clipped: false,
        }
    }

    fn has_paint(&self) -> bool {
        self.styles.iter().any(|it| matches!(it, Style::Paint(_)))
    }

    fn font_size(&self) -> f32 {
        self.font.as_ref().map_or(10.0, |it| it.size)
    }

    fn pen(&self) -> wire::Pen {
        wire::Pen {
            width: self.line_width as f32,
            miter_limit: self.miter_limit as f32,
            dash_offset: self.dash_offset as f32,
            cap: self.cap.into(),
            join: self.join.into(),
        }
    }

    fn dashes(&self) -> impl Iterator<Item = f32> {
        self.dashes
            .iter()
            .flat_map(|it| it.iter())
            .map(|it| *it as f32)
    }

    #[inline]
    fn record(&self, parts: Parts, list: &mut List, is_wide: bool) {
        if parts.contains(Parts::MATRIX) {
            list.push(Command::Transform(self.matrix.narrow()));
        }
        if parts.contains(Parts::FILL) {
            self.styles[FILL].record(list, is_wide, Command::FillColor, Command::FillPaint);
        }
        if parts.contains(Parts::STROKE) {
            self.styles[STROKE].record(list, is_wide, Command::StrokeColor, Command::StrokePaint);
        }
        if parts.contains(Parts::WIDTH) {
            list.push(Command::LineWidth(self.line_width as f32));
        }
        if parts.intersects(!(Parts::MATRIX | Parts::FILL | Parts::STROKE | Parts::WIDTH)) {
            self.record_others(parts, list, is_wide);
        }
    }

    fn record_others(&self, parts: Parts, list: &mut List, is_wide: bool) {
        if parts.contains(Parts::COMPOSITING) {
            list.push(Command::Compositing {
                alpha: self.alpha as f32,
                operator: self.operator.into(),
            });
        }
        if parts.contains(Parts::PEN) {
            let dashes = add(&mut list.dashes, self.dashes());
            list.push(Command::Pen {
                pen: self.pen(),
                dashes,
            });
        }
        if parts.contains(Parts::SHADOW) {
            let offset = [self.shadow_x as f32, self.shadow_y as f32];
            list.push(Command::Shadow {
                offset,
                blur: self.shadow_blur as f32,
                color: self.shadow_color.for_canvas(is_wide),
            });
        }
        if parts.contains(Parts::SMOOTHING) {
            list.push(Command::Smoothing(self.is_smooth));
        }
        if parts.contains(Parts::FILTER) {
            let filters = add(
                &mut list.filters,
                self.filter
                    .iter()
                    .flat_map(|it| it.functions.iter().copied()),
            );
            list.push(Command::Filters(filters));
        }
    }
}

#[repr(C)]
pub(crate) struct Context {
    pub(crate) base: Path,
    pub(crate) fields: js::Fields,
    pub(crate) bitmap: Rc<Bitmap>,
    settings: Settings,
    /// The last one is current.
    states: JsCell<Vec<State>>,
    /// How many of them have a gradient or a pattern. The field `savedStyles` has two values for each.
    saved_with_paint: Cell<u32>,
    /// What the library has another value for.
    stale: Cell<Parts>,
    recorded_versions: [Cell<u32>; 2],
    /// Where the list of that generation has the current path, if that has not grown since.
    recorded_path: Cell<Option<(u32, Span)>>,
    inherited: JsCell<Option<(u32, Inherited)>>,
    pub(super) has_placeholder: Cell<bool>,
    pub(super) will_present: Cell<bool>,
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        x: x as f32,
        y: y as f32,
        width: width as f32,
        height: height as f32,
    }
}

pub(super) fn normalized(x: i32, y: i32, width: i32, height: i32) -> [i64; 4] {
    let [x, y, width, height] = [x, y, width, height].map(i64::from);
    [
        x.min(x + width),
        y.min(y + height),
        width.abs(),
        height.abs(),
    ]
}

fn array_global<'h>(heap: &'h JsHeap<'_>) -> &'h JSGlobalObject {
    // SAFETY: the callers define and read the elements of a plain array that no script has.
    unsafe { heap.global() }
}

fn prepared(text: &[u8]) -> impl Iterator<Item = u8> {
    text.iter().filter(|it| **it != 0).map(|it| {
        if matches!(it, b'\t' | b'\n' | b'\x0c' | b'\r') {
            b' '
        } else {
            *it
        }
    })
}

impl Context {
    #[optimize(size)]
    pub(crate) fn new(size: [u32; 2], settings: Settings) -> Context {
        Context {
            base: Path::default(),
            fields: Default::default(),
            bitmap: Bitmap::new(
                size,
                !settings.alpha,
                settings.will_read_frequently,
                settings.color_space == PredefinedColorSpace::DisplayP3,
            ),
            settings,
            states: JsCell::new(vec![State::new()]),
            saved_with_paint: Cell::new(0),
            stale: Cell::new(Parts::NONE),
            recorded_versions: Default::default(),
            recorded_path: Cell::new(None),
            inherited: JsCell::default(),
            has_placeholder: Cell::new(false),
            will_present: Cell::new(false),
        }
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.bitmap.bytes()
    }

    /// https://html.spec.whatwg.org/#concept-canvas-set-bitmap-dimensions
    pub(crate) fn set_dimensions(&self, heap: &JsHeap<'_>, size: [u32; 2]) {
        let before = self.bitmap.bytes();
        self.bitmap.is_origin_clean.set(true);
        self.reset_to(size);
        heap.report_extra_memory(
            self.as_object(heap),
            self.bitmap.bytes().saturating_sub(before),
        );
    }

    #[inline]
    fn state(&self) -> &State {
        let states = self.states.get();
        &states[states.len() - 1]
    }

    #[inline]
    fn with_state<R>(&self, change: impl FnOnce(&mut State) -> R) -> R {
        self.states.with_mut(|states| {
            let last = states.len() - 1;
            change(&mut states[last])
        })
    }

    #[optimize(size)]
    fn reset_to(&self, size: [u32; 2]) {
        self.states.set(vec![State::new()]);
        self.base.outline.set(Default::default());
        self.recorded_path.set(None);
        self.stale.set(Parts::NONE);
        self.saved_with_paint.set(0);
        for set in [
            js::set_fill_style,
            js::set_stroke_style,
            js::set_saved_styles,
        ] {
            set(self, JSValue::ZERO);
        }
        self.bitmap.reset(size);
        self.did_draw();
    }

    #[inline]
    pub(super) fn did_draw(&self) {
        if self.has_placeholder.get() && !self.will_present.replace(true) {
            self.bitmap.recorder().will_present(self);
        }
    }

    #[inline]
    fn change(&self, part: Parts, change: impl FnOnce(&mut State)) {
        self.with_state(|state| {
            change(state);
            state.changed |= part;
        });
        self.stale.set(self.stale.get() | part);
    }

    #[inline]
    fn set<T: PartialEq>(&self, part: Parts, field: impl Fn(&mut State) -> &mut T, value: T) {
        if self.with_state(|state| *field(state) != value) {
            self.change(part, |state| *field(state) = value);
        }
    }

    #[inline]
    fn draw(&self, needs: Parts, command: impl FnOnce(&mut List) -> Command) {
        self.bitmap.recorder().record(self.bitmap.id(), |list| {
            let due = self.stale.get() & needs;
            if !due.is_empty() {
                self.stale.set(self.stale.get() - due);
                self.state().record(due, list, self.bitmap.is_wide);
            }
            let command = command(list);
            list.push(command);
        });
        self.did_draw();
    }

    /// What drawing with that style depends on, besides `needs`.
    #[inline]
    fn painting(&self, style: usize, needs: Parts) -> Parts {
        let (part, style, recorded) = (
            [Parts::FILL, Parts::STROKE][style],
            &self.state().styles[style],
            &self.recorded_versions[style],
        );
        if let Style::Color(_) = style {
            return needs | part | Parts::EFFECTS;
        }
        if recorded.replace(style.version()) != style.version() {
            self.stale.set(self.stale.get() | part);
        }
        needs | part | Parts::PLACED
    }

    #[inline]
    fn record_path(&self, path: Option<&Path>, list: &mut List) -> Span {
        if let Some(path) = path {
            return list.add_part(|to| add_transformed(path.verbs(), &self.state().matrix, to));
        }
        let verbs = self.base.verbs();
        match self.recorded_path.get() {
            Some((generation, span))
                if generation == list.generation && span.range().len() == verbs.len() =>
            {
                span
            }
            _ => {
                let span = list.add_part(|to| match <&[u32; 6]>::try_from(verbs) {
                    Ok(line_or_arc) => to.extend_from_slice(line_or_arc),
                    Err(_) => to.extend_from_slice(verbs),
                });
                self.recorded_path.set(Some((list.generation, span)));
                span
            }
        }
    }

    fn with_verbs<R>(&self, path: Option<&Path>, read: impl FnOnce(Slice<u32>) -> R) -> R {
        let Some(path) = path else {
            return read(Slice::new(self.base.verbs()));
        };
        let mut verbs = Vec::new();
        add_transformed(path.verbs(), &self.state().matrix, &mut verbs);
        read(Slice::new(&verbs))
    }

    fn set_matrix(&self, matrix: Affine) {
        if are_finite(matrix.0) {
            self.change(Parts::MATRIX, |state| state.matrix = matrix);
            self.base.outline.with_mut(|path| path.matrix = matrix);
        }
    }

    /// Asked once for all the text of a task.
    #[optimize(size)]
    fn inherited<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, Inherited> {
        let generation = self.bitmap.recorder().generation();
        if let Some((known, inherited)) = self.inherited.get()
            && *known == generation
        {
            return Ok(inherited.clone());
        }
        let inherited = host::inherited(cx, self)?;
        self.inherited.set(Some((generation, inherited.clone())));
        Ok(inherited)
    }

    pub(crate) fn forget_inherited(&self) {
        self.inherited.set(None);
    }

    fn parse_color<'a>(
        &self,
        cx: &mut JsScope<'a>,
        source: &[u8],
    ) -> bindgen::Result<'a, Option<Color>> {
        Ok(match Color::parse(source) {
            None => None,
            Some(Parsed::Color(color)) => Some(color),
            Some(Parsed::OfCurrent(color)) => {
                Some(Color::resolve(&color, host::inherited(cx, self)?.color))
            }
        })
    }

    fn style<'a>(&self, heap: &JsHeap<'a>, index: usize) -> bindgen::Result<'a, JsLocal<'a>> {
        match &self.state().styles[index] {
            Style::Color(color) => to_js::utf8(heap, color.serialize()),
            Style::Paint(_) => Ok(JsLocal::new(heap, self.style_object(index))),
        }
    }

    fn style_object(&self, index: usize) -> JSValue {
        [js::fill_style, js::stroke_style][index](self).unwrap_or(JSValue::UNDEFINED)
    }

    fn set_style_object(&self, index: usize, object: JSValue) {
        [js::set_fill_style, js::set_stroke_style][index](self, object);
    }

    #[inline(always)]
    fn set_style<'a>(
        &self,
        cx: &mut JsScope<'a>,
        index: usize,
        value: CanvasStyle<'a>,
    ) -> bindgen::Result<'a, ()> {
        if let (CanvasStyle::Color(source), Style::Color(old)) =
            (&value, &self.state().styles[index])
            && let Some(rgba) = source
                .flat_latin1()
                .and_then(|it| parse_six_digits(it.characters()))
        {
            if !old.is(rgba) {
                self.change([Parts::FILL, Parts::STROKE][index], |state| {
                    if let Style::Color(old) = &mut state.styles[index] {
                        *old = Color::plain(rgba);
                    }
                });
            }
            return Ok(());
        }
        self.set_any_style(cx, index, value)
    }

    fn set_any_style<'a>(
        &self,
        cx: &mut JsScope<'a>,
        index: usize,
        value: CanvasStyle<'a>,
    ) -> bindgen::Result<'a, ()> {
        let part = [Parts::FILL, Parts::STROKE][index];
        let (paint, object) = match value {
            CanvasStyle::Gradient(it) => (&it.0, it.to_js()),
            CanvasStyle::Pattern(it) => (&it.0, it.to_js()),
            CanvasStyle::Color(source) => {
                let Some(color) = self.parse_color(cx, source.view(&cx.heap)?.to_utf8().slice())?
                else {
                    return Ok(());
                };
                match &self.state().styles[index] {
                    Style::Color(old) if *old == color => return Ok(()),
                    Style::Color(_) => {}
                    Style::Paint(_) => self.set_style_object(index, JSValue::ZERO),
                }
                self.change(part, |state| state.styles[index] = Style::Color(color));
                return Ok(());
            }
        };
        if !paint.is_origin_clean {
            self.bitmap.is_origin_clean.set(false);
        }
        if !matches!(&self.state().styles[index], Style::Paint(old) if Rc::ptr_eq(old, paint)) {
            self.set_style_object(index, object);
            self.change(part, |state| {
                state.styles[index] = Style::Paint(Rc::clone(paint))
            });
        }
        Ok(())
    }

    fn save_style_objects(&self, heap: &JsHeap<'_>) -> JsResult<()> {
        let (global, at) = (array_global(heap), self.saved_with_paint.get() * 2);
        let objects = match js::saved_styles(self) {
            Some(objects) => objects,
            None => {
                let objects = JSValue::create_empty_array(global, 0)?;
                js::set_saved_styles(self, objects);
                objects
            }
        };
        objects.put_index(global, at, self.style_object(FILL))?;
        objects.put_index(global, at + 1, self.style_object(STROKE))?;
        self.saved_with_paint.update(|it| it + 1);
        Ok(())
    }

    fn restore_style_objects(&self, heap: &JsHeap<'_>) -> JsResult<()> {
        let (global, Some(objects)) = (array_global(heap), js::saved_styles(self)) else {
            return Ok(());
        };
        self.saved_with_paint.update(|it| it - 1);
        for index in [FILL, STROKE] {
            let at = self.saved_with_paint.get() * 2 + index as u32;
            self.set_style_object(index, objects.get_direct_index(global, at)?);
            objects.put_index(global, at, JSValue::UNDEFINED)?;
        }
        Ok(())
    }

    #[inline]
    fn fill_path(&self, path: Option<&Path>, rule: CanvasFillRule) {
        let is_even_odd = rule == CanvasFillRule::Evenodd;
        self.draw(self.painting(FILL, Parts::NONE), |list| Command::Fill {
            verbs: self.record_path(path, list),
            is_even_odd,
        });
    }

    #[inline]
    fn stroke_path(&self, path: Option<&Path>) {
        self.draw(self.painting(STROKE, Parts::LINE), |list| Command::Stroke {
            verbs: self.record_path(path, list),
        });
    }

    fn clip_to(&self, path: Option<&Path>, rule: CanvasFillRule) {
        let saves = self.states.get().len() > 1
            && !self.with_state(|state| core::mem::replace(&mut state.has_clipped, true));
        self.bitmap.recorder().record(self.bitmap.id(), |list| {
            let verbs = self.record_path(path, list);
            list.push(Command::Clip {
                verbs,
                is_even_odd: rule == CanvasFillRule::Evenodd,
                saves,
            });
        });
    }

    fn is_in_path(&self, path: Option<&Path>, x: f64, y: f64, rule: CanvasFillRule) -> bool {
        let Some(graphics) = graphics().filter(|_| are_finite([x, y])) else {
            return false;
        };
        // SAFETY: the verbs outlive the call.
        self.with_verbs(path, |verbs| unsafe {
            (graphics.is_in_path)(
                &[x as f32, y as f32],
                verbs,
                rule == CanvasFillRule::Evenodd,
            )
        })
    }

    #[optimize(size)]
    fn is_in_stroke(&self, path: Option<&Path>, x: f64, y: f64) -> bool {
        let Some(graphics) = graphics().filter(|_| are_finite([x, y])) else {
            return false;
        };
        let state = self.state();
        let (matrix, dashes) = (state.matrix.narrow(), state.dashes().collect::<Vec<_>>());
        // SAFETY: the verbs and the dashes outlive the call.
        self.with_verbs(path, |verbs| unsafe {
            (graphics.is_in_stroke)(
                &[x as f32, y as f32],
                verbs,
                &matrix,
                state.pen(),
                Slice::new(&dashes),
            )
        })
    }

    #[optimize(size)]
    fn draw_focus<'a>(
        &self,
        cx: &mut JsScope<'a>,
        path: Option<&Path>,
        element: &'a Element,
    ) -> bindgen::Result<'a, ()> {
        if host::is_focused(cx, self, element) {
            let (ring, parts) = (
                Color::plain(0x1010_10ff),
                Parts::STROKE | Parts::PEN | Parts::COMPOSITING | Parts::SHADOW,
            );
            self.draw(Parts::MATRIX | Parts::FILTER, |list| {
                State {
                    line_width: 2.0,
                    styles: [Style::Color(ring), Style::Color(ring)],
                    ..State::new()
                }
                .record(parts, list, self.bitmap.is_wide);
                Command::Stroke {
                    verbs: self.record_path(path, list),
                }
            });
            self.stale.set(self.stale.get() | parts);
        }
        Ok(())
    }

    /// With how much of the text is left of the x coordinate.
    fn text_style<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> bindgen::Result<'a, Option<(wire::TextStyle, f32)>> {
        let inherited = self.inherited(cx)?;
        let state = self.state();
        let Some(font) = state
            .font
            .clone()
            .or_else(|| Font::parse_cached(DEFAULT_FONT))
        else {
            return Ok(None);
        };
        let language = state.language.clone().unwrap_or(inherited.language);
        let is_right_to_left = match state.direction {
            CanvasDirection::Inherit => inherited.is_right_to_left,
            direction => direction == CanvasDirection::Rtl,
        };
        let alignment = match state.align {
            CanvasTextAlign::Center => 0.5,
            CanvasTextAlign::Left => 0.0,
            CanvasTextAlign::Right => 1.0,
            align => f32::from((align == CanvasTextAlign::End) != is_right_to_left),
        };
        let mut style = wire::TextStyle {
            font: 0,
            size: font.size,
            letter_spacing: state
                .letter_spacing
                .resolve(font.size, inherited.root_font_size),
            word_spacing: state
                .word_spacing
                .resolve(font.size, inherited.root_font_size),
            is_right_to_left,
            baseline: state.baseline.into(),
        };
        let variation = Variation {
            canvas: self.bitmap.id(),
            scope: inherited.font_scope,
            language: Name::new(language.as_bytes()),
            kerning: state.kerning,
            stretch: state.stretch,
            caps: state.caps,
            is_smoothed: inherited.is_smoothed
                && (state.rendering != CanvasTextRendering::GeometricPrecision
                    || !self.settings.alpha),
        };
        style.font = match font.known_id(variation) {
            Some(id) => id,
            None => {
                host::use_font(cx, self, &font)?;
                font.describe(variation, &language)
            }
        };
        Ok(Some((style, alignment)))
    }

    fn draw_text<'a>(
        &self,
        cx: &mut JsScope<'a>,
        style_index: usize,
        text: &[u8],
        at: [f64; 2],
        max_width: Option<f64>,
    ) -> bindgen::Result<'a, ()> {
        if !are_finite(at) || max_width.is_some_and(|it| !(it > 0.0 && it.is_finite())) {
            return Ok(());
        }
        let Some((style, alignment)) = self.text_style(cx)? else {
            return Ok(());
        };
        let strokes = style_index == STROKE;
        self.draw(
            self.painting(
                style_index,
                if strokes { Parts::LINE } else { Parts::MATRIX },
            ),
            |list| Command::Text {
                text: add(&mut list.text, prepared(text)),
                style,
                at: at.map(|it| it as f32),
                alignment,
                max_width: max_width.map_or(f32::INFINITY, |it| it as f32),
                strokes,
            },
        );
        Ok(())
    }

    /// `None` is all of the image, and its size.
    pub(super) fn draw_source(
        &self,
        image: &Source,
        from: Option<[f64; 4]>,
        at: [f64; 2],
        size: Option<[f64; 2]>,
    ) {
        let (orientation, mut whole) = (image.ignored_orientation, image.size);
        if orientation > 4 {
            whole.reverse();
        }
        let ([sx, sy, sw, sh], [dx, dy], [dw, dh]) = (
            from.unwrap_or([0.0, 0.0, whole[0], whole[1]]),
            at,
            size.unwrap_or(whole),
        );
        if !are_finite([sx, sy, sw, sh, dx, dy, dw, dh]) || [sw, sh, dw, dh].contains(&0.0) {
            return;
        }
        if !image.is_origin_clean {
            self.bitmap.is_origin_clean.set(false);
        }
        let command = |from, to| Command::Image {
            image: image.id,
            size: image.size.map(|it| it as f32),
            from,
            to,
        };
        if orientation < 2 {
            return self.draw(Parts::PLACED, |_| {
                command(rect(sx, sy, sw, sh), rect(dx, dy, dw, dh))
            });
        }
        let [flips_x, flips_y] = [[2, 3, 7, 8], [3, 4, 6, 7]].map(|it| it.contains(&orientation));
        let (left, x, e) = if flips_x {
            (whole[0] - sx - sw, -1.0, dx + dw)
        } else {
            (sx, 1.0, dx)
        };
        let (top, y, f) = if flips_y {
            (whole[1] - sy - sh, -1.0, dy + dh)
        } else {
            (sy, 1.0, dy)
        };
        let (turn, from, to) = match orientation > 4 {
            true => (
                [0.0, y, x, 0.0, e, f],
                rect(top, left, sh, sw),
                rect(0.0, 0.0, dh, dw),
            ),
            false => (
                [x, 0.0, 0.0, y, e, f],
                rect(left, top, sw, sh),
                rect(0.0, 0.0, dw, dh),
            ),
        };
        self.draw(Parts::PLACED, |list| {
            list.push(Command::Transform(self.state().matrix.then(turn).narrow()));
            command(from, to)
        });
        self.stale.set(self.stale.get() | Parts::MATRIX);
    }

    fn draw_image_source<'a>(
        &self,
        cx: &mut JsScope<'a>,
        image: CanvasImageSource<'a>,
        from: Option<[f64; 4]>,
        at: [f64; 2],
        size: Option<[f64; 2]>,
    ) -> bindgen::Result<'a, ()> {
        if let Some(image) = host::check_usability(cx, Some(self), image)? {
            self.draw_source(&image, from, at, size);
        }
        Ok(())
    }

    fn put<'a>(
        &self,
        heap: &JsHeap<'a>,
        image: &'a ImageData,
        at: [i32; 2],
        [x, y, width, height]: [i64; 4],
    ) -> Result<(), Failure> {
        let size = image.size;
        let (left, top, right, bottom) = (
            x.max(0),
            y.max(0),
            (x + width).min(size[0].into()),
            (y + height).min(size[1].into()),
        );
        image.with_pixels(heap, |rgba| {
            if left < right && top < bottom {
                let mut rgba = Cow::Borrowed(rgba);
                if image.is_wide() != self.bitmap.is_wide {
                    convert(rgba.to_mut(), self.bitmap.is_wide);
                }
                self.bitmap.write(
                    at,
                    size,
                    [left, top, right - left, bottom - top].map(|it| it as i32),
                    &rgba,
                );
            }
        })?;
        self.did_draw();
        Ok(())
    }
}

macro_rules! attributes {
    ($($get:ident $set:ident: $Type:ty = $field:ident in $part:ident $(if $is_valid:expr)?;)+) => {
        impl CanvasDrawing {$(
            pub(crate) fn $get(&self) -> $Type {
                self.state().$field
            }

            pub(crate) fn $set(&self, value: $Type) {
                $(if !$is_valid(value) {
                    return;
                })?
                self.set(Parts::$part, |state| &mut state.$field, value);
            }
        )+}
    };
}

attributes! {
    get_global_alpha set_global_alpha: f64 = alpha in COMPOSITING if |it| (0.0..=1.0).contains(&it);
    get_global_composite_operation set_global_composite_operation: GlobalCompositeOperation = operator in COMPOSITING;
    get_image_smoothing_enabled set_image_smoothing_enabled: bool = is_smooth in SMOOTHING;
    get_image_smoothing_quality set_image_smoothing_quality: ImageSmoothingQuality = quality in NONE;
    get_shadow_offset_x set_shadow_offset_x: f64 = shadow_x in SHADOW if f64::is_finite;
    get_shadow_offset_y set_shadow_offset_y: f64 = shadow_y in SHADOW if f64::is_finite;
    get_shadow_blur set_shadow_blur: f64 = shadow_blur in SHADOW if |it| (0.0..f64::INFINITY).contains(&it);
    get_line_width set_line_width: f64 = line_width in WIDTH if |it: f64| it > 0.0 && it.is_finite();
    get_line_cap set_line_cap: CanvasLineCap = cap in PEN;
    get_line_join set_line_join: CanvasLineJoin = join in PEN;
    get_miter_limit set_miter_limit: f64 = miter_limit in PEN if |it: f64| it > 0.0 && it.is_finite();
    get_line_dash_offset set_line_dash_offset: f64 = dash_offset in PEN if f64::is_finite;
    get_text_align set_text_align: CanvasTextAlign = align in NONE;
    get_text_baseline set_text_baseline: CanvasTextBaseline = baseline in NONE;
    get_direction set_direction: CanvasDirection = direction in NONE;
    get_font_kerning set_font_kerning: CanvasFontKerning = kerning in NONE;
    get_font_stretch set_font_stretch: CanvasFontStretch = stretch in NONE;
    get_font_variant_caps set_font_variant_caps: CanvasFontVariantCaps = caps in NONE;
    get_text_rendering set_text_rendering: CanvasTextRendering = rendering in NONE;
}

type Fallible<'a, T = ()> = bindgen::Result<'a, T>;

impl CanvasDrawing {
    pub(crate) fn get_context_attributes(&self) -> ContextAttributes {
        let Settings {
            alpha,
            color_space,
            color_type,
            desynchronized,
            will_read_frequently,
        } = self.settings;
        ContextAttributes {
            alpha,
            color_space,
            color_type,
            desynchronized,
            will_read_frequently,
        }
    }

    pub(crate) fn save<'a>(&self, heap: &JsHeap<'a>) -> JsResult<()> {
        if self.states.get().len() > MAX_SAVED {
            return Ok(());
        }
        if self.state().has_paint() {
            self.save_style_objects(heap)?;
        }
        let copy = State {
            changed: Parts::NONE,
            has_clipped: false,
            ..self.state().clone()
        };
        self.states.with_mut(|states| states.push(copy));
        Ok(())
    }

    pub(crate) fn restore<'a>(&self, heap: &JsHeap<'a>) -> JsResult<()> {
        let (
            depth,
            &State {
                changed,
                has_clipped,
                ..
            },
            had_paint,
        ) = (
            self.states.get().len(),
            self.state(),
            self.state().has_paint(),
        );
        if depth == 1 {
            return Ok(());
        }
        self.states.with_mut(|states| states.truncate(depth - 1));
        self.base
            .outline
            .with_mut(|path| path.matrix = self.state().matrix);
        self.stale.set(self.stale.get() | changed);
        if has_clipped {
            self.bitmap
                .recorder()
                .record(self.bitmap.id(), |list| list.push(Command::RestoreClip));
        }
        if self.state().has_paint() {
            return self.restore_style_objects(heap);
        }
        if had_paint {
            [FILL, STROKE]
                .into_iter()
                .for_each(|it| self.set_style_object(it, JSValue::ZERO));
        }
        Ok(())
    }

    pub(crate) fn reset(&self) {
        self.reset_to(self.bitmap.size());
    }

    pub(crate) fn is_context_lost(&self) -> bool {
        false
    }

    pub(crate) fn scale(&self, x: f64, y: f64) {
        self.transform(x, 0.0, 0.0, y, 0.0, 0.0);
    }

    pub(crate) fn rotate(&self, angle: f64) {
        let (sin, cos) = angle.sin_cos();
        self.transform(cos, sin, -sin, cos, 0.0, 0.0);
    }

    pub(crate) fn translate(&self, x: f64, y: f64) {
        self.transform(1.0, 0.0, 0.0, 1.0, x, y);
    }

    pub(crate) fn transform(&self, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) {
        self.set_matrix(self.state().matrix.then([a, b, c, d, e, f]));
    }

    pub(crate) fn get_transform<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, JSValue> {
        Ok(DOMMatrix::new(&cx.heap, Matrix::from_2d(self.state().matrix.0)).to_js())
    }

    pub(crate) fn set_transform(&self, a: f64, b: f64, c: f64, d: f64, e: f64, f: f64) {
        self.set_matrix(Affine([a, b, c, d, e, f]));
    }

    pub(crate) fn set_transform_to(&self, transform: &DOMMatrix2DInit) -> Result<(), Failure> {
        Affine::from_init(transform).map(|it| self.set_matrix(it))
    }

    pub(crate) fn reset_transform(&self) {
        self.set_matrix(Affine::default());
    }

    pub(crate) fn get_stroke_style<'a>(&self, heap: &JsHeap<'a>) -> Fallible<'a, JsLocal<'a>> {
        self.style(heap, STROKE)
    }

    pub(crate) fn set_stroke_style<'a>(
        &self,
        cx: &mut JsScope<'a>,
        value: CanvasStyle<'a>,
    ) -> Fallible<'a> {
        self.set_style(cx, STROKE, value)
    }

    pub(crate) fn get_fill_style<'a>(&self, heap: &JsHeap<'a>) -> Fallible<'a, JsLocal<'a>> {
        self.style(heap, FILL)
    }

    pub(crate) fn set_fill_style<'a>(
        &self,
        cx: &mut JsScope<'a>,
        value: CanvasStyle<'a>,
    ) -> Fallible<'a> {
        self.set_style(cx, FILL, value)
    }

    pub(crate) fn create_linear_gradient<'a>(
        &self,
        heap: &JsHeap<'a>,
        x0: f64,
        y0: f64,
        x1: f64,
        y1: f64,
    ) -> &'a CanvasGradient {
        js_CanvasGradient::create(
            heap,
            CanvasGradient::new(Shape::Linear(
                [x0 as f32, y0 as f32],
                [x1 as f32, y1 as f32],
            )),
        )
    }

    pub(crate) fn create_radial_gradient<'a>(
        &self,
        heap: &JsHeap<'a>,
        x0: f64,
        y0: f64,
        r0: f64,
        x1: f64,
        y1: f64,
        r1: f64,
    ) -> Result<&'a CanvasGradient, Failure> {
        if r0 < 0.0 || r1 < 0.0 {
            return Err(Failure::index_size("The radius provided is less than 0."));
        }
        let [from, to] = [[x0, y0, r0], [x1, y1, r1]].map(|circle| circle.map(|it| it as f32));
        Ok(js_CanvasGradient::create(
            heap,
            CanvasGradient::new(Shape::Radial(from, to)),
        ))
    }

    pub(crate) fn create_conic_gradient<'a>(
        &self,
        heap: &JsHeap<'a>,
        start: f64,
        x: f64,
        y: f64,
    ) -> &'a CanvasGradient {
        js_CanvasGradient::create(
            heap,
            CanvasGradient::new(Shape::Conic([x as f32, y as f32], start as f32)),
        )
    }

    pub(crate) fn create_pattern<'a>(
        &self,
        cx: &mut JsScope<'a>,
        image: CanvasImageSource<'a>,
        repetition: &[u8],
    ) -> Fallible<'a, Option<&'a CanvasPattern>> {
        let image = host::check_usability(cx, Some(self), image)?;
        let repeats = match repetition {
            b"" | b"repeat" => [true, true],
            b"repeat-x" => [true, false],
            b"repeat-y" => [false, true],
            b"no-repeat" => [false, false],
            _ => {
                return Err(Failure::Dom(
                    DOMExceptionCode::SyntaxError,
                    "The provided type is not a repetition.",
                )
                .into_error(&cx.heap));
            }
        };
        Ok(image.map(|image| {
            let wanted = Snapshot {
                is_tile: true,
                is_wide: self.bitmap.is_wide,
                ..image.whole()
            };
            let bytes = area_of(wanted.to).saturating_mul(4) as usize;
            js_CanvasPattern::create(
                &cx.heap,
                CanvasPattern::new(snapshot(wanted), bytes, repeats, image.is_origin_clean),
            )
        }))
    }

    pub(crate) fn get_shadow_color(&self) -> Out {
        self.state().shadow_color.serialize()
    }

    pub(crate) fn set_shadow_color<'a>(&self, cx: &mut JsScope<'a>, value: &[u8]) -> Fallible<'a> {
        if let Some(color) = self.parse_color(cx, value)? {
            self.set(Parts::SHADOW, |state| &mut state.shadow_color, color);
        }
        Ok(())
    }

    pub(crate) fn get_filter(&self) -> &[u8] {
        self.state()
            .filter
            .as_ref()
            .map_or(b"none", |it| &it.source)
    }

    pub(crate) fn set_filter<'a>(&self, cx: &mut JsScope<'a>, value: &[u8]) -> Fallible<'a> {
        if value == b"none" {
            self.change(Parts::FILTER, |state| state.filter = None);
            return Ok(());
        }
        let inherited = self.inherited(cx)?;
        let parsed = with_units(
            self.state().font_size(),
            inherited.root_font_size,
            |units| Prop::Long(Id::Filter).parse(value, units, false),
        );
        if let Some(Value::Filter(filters)) =
            parsed.as_deref().and_then(<[_]>::first).map(Value::typed)
        {
            let functions = filters
                .0
                .iter()
                .filter_map(|it| it.function(1.0, inherited.color))
                .collect();
            self.change(Parts::FILTER, |state| {
                state.filter = Some(Rc::new(Filter {
                    source: value.trim_ascii().into(),
                    functions,
                }))
            });
        }
        Ok(())
    }

    pub(crate) fn clear_rect(&self, x: f64, y: f64, w: f64, h: f64) {
        if are_finite([x, y, w, h]) {
            self.draw(Parts::MATRIX, |_| Command::ClearRect(rect(x, y, w, h)));
        }
    }

    pub(crate) fn fill_rect(&self, x: f64, y: f64, w: f64, h: f64) {
        if are_finite([x, y, w, h]) {
            self.draw(self.painting(FILL, Parts::MATRIX), |_| {
                Command::FillRect(rect(x, y, w, h))
            });
        }
    }

    pub(crate) fn stroke_rect(&self, x: f64, y: f64, w: f64, h: f64) {
        if are_finite([x, y, w, h]) {
            self.draw(self.painting(STROKE, Parts::LINE), |_| {
                Command::StrokeRect(rect(x, y, w, h))
            });
        }
    }

    pub(crate) fn begin_path(&self) {
        self.base.outline.with_mut(|path| path.clear());
        self.recorded_path.set(None);
    }

    pub(crate) fn fill(&self, rule: CanvasFillRule) {
        self.fill_path(None, rule);
    }

    pub(crate) fn fill_given(&self, path: &Path2D, rule: CanvasFillRule) {
        self.fill_path(Some(path), rule);
    }

    pub(crate) fn stroke(&self, path: Option<&Path2D>) {
        match path {
            None => self.stroke_path(None),
            Some(path) => self.stroke_given(path),
        }
    }

    #[inline(never)]
    fn stroke_given(&self, path: &Path2D) {
        self.stroke_path(Some(path));
    }

    pub(crate) fn clip(&self, rule: CanvasFillRule) {
        self.clip_to(None, rule);
    }

    pub(crate) fn clip_given(&self, path: &Path2D, rule: CanvasFillRule) {
        self.clip_to(Some(path), rule);
    }

    pub(crate) fn is_point_in_path(&self, x: f64, y: f64, rule: CanvasFillRule) -> bool {
        self.is_in_path(None, x, y, rule)
    }

    pub(crate) fn is_point_in_given_path(
        &self,
        path: &Path2D,
        x: f64,
        y: f64,
        rule: CanvasFillRule,
    ) -> bool {
        self.is_in_path(Some(path), x, y, rule)
    }

    pub(crate) fn is_point_in_stroke(&self, x: f64, y: f64) -> bool {
        self.is_in_stroke(None, x, y)
    }

    pub(crate) fn is_point_in_given_stroke(&self, path: &Path2D, x: f64, y: f64) -> bool {
        self.is_in_stroke(Some(path), x, y)
    }

    pub(crate) fn fill_text<'a>(
        &self,
        cx: &mut JsScope<'a>,
        text: &[u8],
        x: f64,
        y: f64,
        max_width: Option<f64>,
    ) -> Fallible<'a> {
        self.draw_text(cx, FILL, text, [x, y], max_width)
    }

    pub(crate) fn stroke_text<'a>(
        &self,
        cx: &mut JsScope<'a>,
        text: &[u8],
        x: f64,
        y: f64,
        max_width: Option<f64>,
    ) -> Fallible<'a> {
        self.draw_text(cx, STROKE, text, [x, y], max_width)
    }

    pub(crate) fn measure_text<'a>(
        &self,
        cx: &mut JsScope<'a>,
        text: &[u8],
    ) -> Fallible<'a, &'a TextMetrics> {
        let mut metrics = wire::TextMetrics::default();
        if let (Some((style, alignment)), Some(graphics)) = (self.text_style(cx)?, graphics()) {
            let text: smallvec::SmallVec<[u8; 128]> = prepared(text).collect();
            // SAFETY: a live slice.
            metrics = unsafe { (graphics.measure)(Slice::new(&text), style) };
            metrics.ink_left += metrics.width * alignment;
            metrics.ink_right -= metrics.width * alignment;
        }
        Ok(js_TextMetrics::create(&cx.heap, TextMetrics(metrics)))
    }

    pub(crate) fn draw_image<'a>(
        &self,
        cx: &mut JsScope<'a>,
        image: CanvasImageSource<'a>,
        dx: f64,
        dy: f64,
    ) -> Fallible<'a> {
        self.draw_image_source(cx, image, None, [dx, dy], None)
    }

    pub(crate) fn draw_image_sized<'a>(
        &self,
        cx: &mut JsScope<'a>,
        image: CanvasImageSource<'a>,
        dx: f64,
        dy: f64,
        dw: f64,
        dh: f64,
    ) -> Fallible<'a> {
        self.draw_image_source(cx, image, None, [dx, dy], Some([dw, dh]))
    }

    pub(crate) fn draw_image_part<'a>(
        &self,
        cx: &mut JsScope<'a>,
        image: CanvasImageSource<'a>,
        sx: f64,
        sy: f64,
        sw: f64,
        sh: f64,
        dx: f64,
        dy: f64,
        dw: f64,
        dh: f64,
    ) -> Fallible<'a> {
        self.draw_image_source(cx, image, Some([sx, sy, sw, sh]), [dx, dy], Some([dw, dh]))
    }

    pub(crate) fn create_image_data<'a>(
        &self,
        heap: &JsHeap<'a>,
        sw: i32,
        sh: i32,
        settings: &ImageDataSettings,
    ) -> Fallible<'a, &'a ImageData> {
        ImageData::blank(
            heap,
            [sw.unsigned_abs(), sh.unsigned_abs()],
            settings,
            self.settings.color_space,
        )
    }

    pub(crate) fn create_image_data_like<'a>(
        &self,
        heap: &JsHeap<'a>,
        image: &'a ImageData,
    ) -> Fallible<'a, &'a ImageData> {
        image.blank_like(heap)
    }

    pub(crate) fn get_image_data<'a>(
        &self,
        heap: &JsHeap<'a>,
        sx: i32,
        sy: i32,
        sw: i32,
        sh: i32,
        settings: &ImageDataSettings,
    ) -> Fallible<'a, &'a ImageData> {
        if sw == 0 || sh == 0 {
            return Err(Failure::index_size("The source width or height is 0.").into_error(heap));
        }
        self.bitmap
            .require_origin_clean()
            .map_err(|it| it.into_error(heap))?;
        let area =
            normalized(sx, sy, sw, sh).map(|it| it.clamp(i32::MIN.into(), i32::MAX.into()) as i32);
        let size = [sw.unsigned_abs(), sh.unsigned_abs()];
        ImageData::from_pixels(
            heap,
            size,
            self.bitmap.read(area, false),
            settings,
            self.settings.color_space,
        )
    }

    pub(crate) fn put_image_data<'a>(
        &self,
        heap: &JsHeap<'a>,
        image: &'a ImageData,
        dx: i32,
        dy: i32,
    ) -> Result<(), Failure> {
        self.put(
            heap,
            image,
            [dx, dy],
            [0, 0, image.size[0].into(), image.size[1].into()],
        )
    }

    pub(crate) fn put_image_data_part<'a>(
        &self,
        heap: &JsHeap<'a>,
        image: &'a ImageData,
        dx: i32,
        dy: i32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<(), Failure> {
        self.put(heap, image, [dx, dy], normalized(x, y, width, height))
    }

    pub(crate) fn set_line_dash(&self, mut segments: Vec<f64>) {
        if segments.iter().all(|it| (0.0..f64::INFINITY).contains(it)) {
            if segments.len() % 2 == 1 {
                segments.extend_from_within(..);
            }
            self.change(Parts::PEN, |state| {
                state.dashes = (!segments.is_empty()).then(|| segments.into())
            });
        }
    }

    pub(crate) fn get_line_dash(&self) -> Vec<f64> {
        self.state().dashes.as_deref().unwrap_or_default().to_vec()
    }

    pub(crate) fn get_lang(&self) -> &[u8] {
        self.state()
            .language
            .as_deref()
            .unwrap_or("inherit")
            .as_bytes()
    }

    pub(crate) fn set_lang(&self, value: &[u8]) {
        self.with_state(|state| state.language = (value != b"inherit").then(|| text(value).into()));
    }

    pub(crate) fn get_font(&self) -> &[u8] {
        self.state()
            .font
            .as_ref()
            .map_or(DEFAULT_FONT, |it| &it.serialized)
    }

    pub(crate) fn set_font<'a>(&self, cx: &mut JsScope<'a>, value: &[u8]) -> Fallible<'a> {
        if value == self.get_font() {
            return Ok(());
        }
        let Some(mut font) = Font::parse_cached(value) else {
            return Ok(());
        };
        if font.is_relative {
            font = Font::parse(value, Some(&host::inherited(cx, self)?)).map_or(font, Rc::new);
        }
        self.with_state(|state| {
            (state.stretch, state.caps, state.font) = (font.stretch, font.caps, Some(font))
        });
        Ok(())
    }

    pub(crate) fn get_letter_spacing(&self) -> Out {
        self.state().letter_spacing.serialize()
    }

    pub(crate) fn set_letter_spacing(&self, value: &[u8]) {
        Spacing::parse(value)
            .into_iter()
            .for_each(|it| self.with_state(|state| state.letter_spacing = it));
    }

    pub(crate) fn get_word_spacing(&self) -> Out {
        self.state().word_spacing.serialize()
    }

    pub(crate) fn set_word_spacing(&self, value: &[u8]) {
        Spacing::parse(value)
            .into_iter()
            .for_each(|it| self.with_state(|state| state.word_spacing = it));
    }
}

impl CanvasRenderingContext2D {
    pub(crate) fn draw_focus_if_needed<'a>(
        &self,
        cx: &mut JsScope<'a>,
        element: &'a Element,
    ) -> Fallible<'a> {
        self.draw_focus(cx, None, element)
    }

    pub(crate) fn draw_given_focus_if_needed<'a>(
        &self,
        cx: &mut JsScope<'a>,
        path: &'a Path2D,
        element: &'a Element,
    ) -> Fallible<'a> {
        self.draw_focus(cx, Some(path), element)
    }
}
