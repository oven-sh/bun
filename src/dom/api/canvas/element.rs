//! https://html.spec.whatwg.org/#the-canvas-element

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{
    Callable, IntoError as _, JsHeap, JsInterface as _, JsLocal, JsScope, Result,
};
use bun_web::channel::Endpoint;
use bun_web::held::Held;

use super::Failure;
use super::bitmap::{Bitmap, Owned, Source, Unencoded};
use super::context::Context;
use super::encoding::{data_url, encode_in_parallel};
use super::host::{self, DEFAULT_SETTINGS, Kind, Mode, Settings};
use super::offscreen::OffscreenCanvas;
use crate::api::core::steps::Steps;
use crate::api::core::{DomString, Edge, Element, Known, atom};
use crate::api::events::call_back;
use crate::api::graphics::can_draw;
use crate::api::images::show_replaced;
use crate::generated_bindgen::canvas::HTMLCanvasElement;
use crate::hints::non_negative_integer;
use crate::tree::Replaced;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

/// What an `OffscreenCanvas` has committed to its placeholder.
pub(super) enum Frame {
    Blank,
    Shared(Rc<Bitmap>),
    Copy {
        pixels: Owned,
        is_origin_clean: bool,
    },
}

impl Frame {
    fn id(&self) -> u32 {
        match self {
            Frame::Blank => 0,
            Frame::Shared(bitmap) => bitmap.id(),
            Frame::Copy { pixels, .. } => pixels.id(),
        }
    }

    fn is_origin_clean(&self) -> bool {
        match self {
            Frame::Blank => true,
            Frame::Shared(bitmap) => bitmap.is_origin_clean.get(),
            Frame::Copy {
                is_origin_clean, ..
            } => *is_origin_clean,
        }
    }
}

#[derive(Default)]
struct Canvas {
    mode: Cell<Mode>,
    committed: RefCell<Option<(Frame, [u32; 2])>>,
    /// From an `OffscreenCanvas` that was transferred.
    frames: RefCell<Held<Endpoint>>,
}

fn state(canvas: &Element) -> &Canvas {
    canvas.extra()
}

pub(super) fn size_of_element(canvas: &Element) -> [u32; 2] {
    [(atom!("width"), 300), (atom!("height"), 150)].map(|(name, default)| {
        canvas
            .with_attr(name, non_negative_integer)
            .flatten()
            .unwrap_or(default)
    })
}

fn context_of<'a>(heap: &JsHeap<'a>, canvas: &'a Element) -> Option<&'a Context> {
    Context::from_js(heap, canvas.edge(Edge::CanvasContext)?)
}

fn committed(canvas: &Element) -> Option<Source> {
    state(canvas)
        .committed
        .borrow()
        .as_ref()
        .map(|(frame, size)| Source::new(frame.id(), *size, frame.is_origin_clean()))
}

fn show<'a>(cx: Cx<'_, 'a>, canvas: &'a Element) {
    let id = committed(canvas)
        .map(|it| it.id)
        .filter(|it| *it != 0)
        .or_else(|| Some(context_of(&cx.heap, canvas)?.bitmap.id()));
    let [width, height] = size_of_element(canvas).map(f64::from);
    show_replaced(
        cx,
        canvas,
        Some(Replaced::new(
            id.unwrap_or(0),
            width,
            height,
            width / height,
        )),
    );
}

fn set_context<'a>(cx: Cx<'_, 'a>, canvas: &'a Element, context: &'a Context) -> &'a Context {
    canvas.set_edge(&cx.heap, Edge::CanvasContext, context.to_js());
    show(cx, canvas);
    context
}

/// What has the bitmap, even if no script has asked for a context.
fn backing<'a>(cx: Cx<'_, 'a>, canvas: &'a Element) -> &'a Context {
    context_of(&cx.heap, canvas).unwrap_or_else(|| {
        let made = Context::create(
            canvas.doc().heap(&cx.heap),
            canvas.to_js(),
            size_of_element(canvas),
            Kind::Element,
            &DEFAULT_SETTINGS,
        );
        set_context(cx, canvas, made)
    })
}

#[optimize(size)]
pub(super) fn commit<'a>(cx: Cx<'_, 'a>, canvas: &'a Element, frame: Frame, size: [u32; 2]) {
    let id = frame.id();
    let before = state(canvas).committed.replace(Some((frame, size)));
    if before.is_some_and(|it| (it.0.id(), it.1) == (id, size)) {
        return;
    }
    let reflect = cx.heap.create_callback(
        |cx, [canvas, _], size, _| {
            if let Some(canvas) = HTMLCanvasElement::from_js(&cx.heap, canvas.to_js()) {
                canvas.set_attr(cx, atom!("width"), DomString::from_integer(size >> 32));
                canvas.set_attr(cx, atom!("height"), DomString::from_integer(size as u32));
            }
            Ok(JSValue::UNDEFINED)
        },
        [canvas.to_js(), JSValue::UNDEFINED],
        u64::from(size[0]) << 32 | u64::from(size[1]),
    );
    cx.heap.queue_microtask(reflect, JSValue::UNDEFINED);
}

impl HTMLCanvasElement {
    pub(super) fn source<'a>(&'a self, cx: Cx<'_, 'a>) -> Source {
        match committed(self) {
            Some(source) if source.id != 0 => source,
            None if state(self).mode.get() == Mode::BitmapRenderer => {
                backing(cx, self).bitmap.source()
            }
            blank => {
                let source = backing(cx, self).bitmap.source();
                Source {
                    size: blank.map_or_else(|| size_of_element(self).map(f64::from), |it| it.size),
                    ..source
                }
            }
        }
    }

    pub(crate) fn get_width(&self) -> u32 {
        size_of_element(self)[0]
    }

    pub(crate) fn get_height(&self) -> u32 {
        size_of_element(self)[1]
    }

    fn set_side<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Known,
        value: u32,
        default: u32,
    ) -> Result<'a, ()> {
        if state(self).mode.get() == Mode::Placeholder {
            return Err(
                Failure::invalid_state("Control was transferred to an OffscreenCanvas.")
                    .into_error(&cx.heap),
            );
        }
        self.set_attr(
            cx,
            name,
            DomString::from_integer(if value > i32::MAX as u32 {
                default
            } else {
                value
            }),
        );
        Ok(())
    }

    pub(crate) fn set_width<'a>(&'a self, cx: Cx<'_, 'a>, value: u32) -> Result<'a, ()> {
        self.set_side(cx, atom!("width"), value, 300)
    }

    pub(crate) fn set_height<'a>(&'a self, cx: Cx<'_, 'a>, value: u32) -> Result<'a, ()> {
        self.set_side(cx, atom!("height"), value, 150)
    }

    #[optimize(size)]
    fn to_encode<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        mime_type: &[u8],
        quality: JsLocal<'a>,
    ) -> Result<'a, Option<Unencoded>> {
        let context = match committed(self) {
            None => backing(cx, self),
            Some(source) => {
                let copy = Context::create(
                    &cx.heap,
                    JSValue::UNDEFINED,
                    source.size.map(|it| it as u32),
                    Kind::Element,
                    &DEFAULT_SETTINGS,
                );
                copy.draw_source(&source, None, [0.0; 2], None);
                copy
            }
        };
        context
            .bitmap
            .require_origin_clean()
            .map_err(|it| it.into_error(&cx.heap))?;
        Ok(context
            .bitmap
            .to_encode(mime_type, quality.to_js().get_number()))
    }

    pub(crate) fn get_context<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        id: &[u8],
        settings: &Settings,
    ) -> Result<'a, JSValue> {
        let (it, wanted) = (state(self), Mode::of(id));
        if it.mode.get() == Mode::Placeholder {
            return Err(
                Failure::invalid_state("Control was transferred to an OffscreenCanvas.")
                    .into_error(&cx.heap),
            );
        }
        if it.mode.get() == Mode::None && wanted != Mode::None && can_draw() {
            let made = Context::create(
                self.doc().heap(&cx.heap),
                self.to_js(),
                size_of_element(self),
                Kind::Element,
                wanted.takes(settings),
            );
            set_context(cx, self, made);
            it.mode.set(wanted);
        }
        Ok(
            match context_of(&cx.heap, self).filter(|_| it.mode.get() == wanted) {
                Some(context) => context.exposed(self.doc().heap(&cx.heap), wanted),
                None => JSValue::NULL,
            },
        )
    }

    pub(crate) fn to_data_url<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        mime_type: &[u8],
        quality: JsLocal<'a>,
    ) -> Result<'a, Vec<u8>> {
        self.to_encode(cx, mime_type, quality).map(data_url)
    }

    pub(crate) fn to_blob<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        callback: JsLocal<'a, Callable>,
        mime_type: &[u8],
        quality: JsLocal<'a>,
    ) -> Result<'a, ()> {
        let pixels = self.to_encode(cx, mime_type, quality)?;
        let then = cx.heap.create_callback(
            |cx, [canvas, callback], _, blob| {
                let window = HTMLCanvasElement::from_js(&cx.heap, canvas.to_js())
                    .and_then(|it| it.doc().window());
                call_back(
                    cx,
                    window,
                    callback.to_js(),
                    JSValue::UNDEFINED,
                    &[blob[0].to_js()],
                );
                Ok(JSValue::UNDEFINED)
            },
            [self.to_js(), callback.to_js()],
            0,
        );
        encode_in_parallel(cx, pixels).react(&cx.heap, Some(then), None);
        Ok(())
    }

    pub(crate) fn transfer_control_to_offscreen<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
    ) -> Result<'a, &'a OffscreenCanvas> {
        if state(self).mode.get() != Mode::None {
            return Err(
                Failure::invalid_state("The canvas already has a rendering context.")
                    .into_error(&cx.heap),
            );
        }
        state(self).mode.set(Mode::Placeholder);
        let inherited = host::inherited_from(cx, Some(self))?;
        Ok(OffscreenCanvas::controlling(
            self.doc().heap(&cx.heap),
            size_of_element(self).map(u64::from),
            self,
            inherited,
        ))
    }
}

pub(super) fn frames_of(placeholder: &Element) -> &RefCell<Held<Endpoint>> {
    &state(placeholder).frames
}

pub(crate) static CANVAS_STEPS: Steps = Steps {
    rendered: Some(show),
    attribute_changed: Some(
        |cx, canvas, change| match change.name.known_without_namespace() {
            atom!("dir") | atom!("lang") => context_of(&cx.heap, canvas)
                .into_iter()
                .for_each(Context::forget_inherited),
            atom!("width") | atom!("height") => {
                if let Some(context) = context_of(&cx.heap, canvas)
                    .filter(|_| state(canvas).mode.get() != Mode::BitmapRenderer)
                {
                    context.set_dimensions(&cx.heap, size_of_element(canvas));
                }
                show(cx, canvas);
            }
            _ => {}
        },
    ),
    ..Steps::NONE
};
