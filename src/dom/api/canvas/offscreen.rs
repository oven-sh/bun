//! https://html.spec.whatwg.org/#the-offscreencanvas-interface

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{IntoError as _, JsHeap, JsInterface as _, JsLocal, JsScope, Result};
use bun_jsc::{DOMExceptionCode, JSValue};
use bun_web::channel::Endpoint;

use super::Failure;
use super::bitmap::{MAX_AREA, Source, area_of, has_alpha, snapshot};
use super::context::Context;
use super::element::{Frame, commit};
use super::encoding::encode_in_parallel;
use super::host::{DEFAULT_SETTINGS, Kind, Mode};
use super::image_bitmap::ImageBitmap;
use super::text::Inherited;
use super::transfer::send_frame;
use crate::api::core::EventTarget;
use crate::api::webgl::Readback;
use crate::generated_bindgen::canvas::{
    HTMLCanvasElement, ImageEncodeOptions, OffscreenRenderingContextId as Id,
    js_OffscreenCanvas as js,
};

type Cx<'c, 'a> = &'c mut JsScope<'a>;

#[repr(C)]
pub(crate) struct OffscreenCanvas {
    pub(crate) base: EventTarget,
    pub(crate) fields: js::Fields,
    size: Cell<[u64; 2]>,
    mode: Cell<Mode>,
    is_detached: Cell<bool>,
    /// The way to the placeholder, after a transfer.
    frames: RefCell<Option<Endpoint>>,
    /// Of the placeholder, when that gave up control.
    pub(super) inherited: Option<Box<Inherited>>,
}

impl OffscreenCanvas {
    pub(crate) fn constructor(width: u64, height: u64) -> OffscreenCanvas {
        OffscreenCanvas {
            base: Default::default(),
            fields: Default::default(),
            size: Cell::new([width, height]),
            mode: Cell::default(),
            is_detached: Cell::new(false),
            frames: RefCell::default(),
            inherited: None,
        }
    }

    pub(super) fn controlling<'a>(
        heap: &JsHeap<'a>,
        [width, height]: [u64; 2],
        placeholder: &'a HTMLCanvasElement,
        inherited: Inherited,
    ) -> &'a OffscreenCanvas {
        let canvas = js::create(
            heap,
            OffscreenCanvas {
                inherited: Some(Box::new(inherited)),
                ..OffscreenCanvas::constructor(width, height)
            },
        );
        js::set_placeholder(canvas, Some(placeholder));
        canvas
    }

    pub(super) fn received<'a>(
        heap: &JsHeap<'a>,
        [width, height]: [u64; 2],
        placeholder: Option<Endpoint>,
    ) -> &'a OffscreenCanvas {
        js::create(
            heap,
            OffscreenCanvas {
                frames: placeholder.into(),
                ..OffscreenCanvas::constructor(width, height)
            },
        )
    }

    pub(super) fn require_transferable(&self) -> core::result::Result<(), Failure> {
        match (self.is_detached.get(), self.mode.get()) {
            (true, _) => Err(Failure::Dom(
                DOMExceptionCode::DataCloneError,
                "The OffscreenCanvas is detached.",
            )),
            (false, Mode::None) => Ok(()),
            _ => Err(Failure::invalid_state(
                "An OffscreenCanvas that has a rendering context cannot be transferred.",
            )),
        }
    }

    pub(super) fn detach(&self) -> ([u64; 2], Option<&HTMLCanvasElement>, Option<Endpoint>) {
        self.is_detached.set(true);
        (self.size.take(), js::placeholder(self), self.frames.take())
    }

    pub(super) fn bitmap_size(&self) -> [u32; 2] {
        self.size.get().map(|it| it.try_into().unwrap_or(u32::MAX))
    }

    fn require_attached(&self) -> core::result::Result<(), Failure> {
        if self.is_detached.get() {
            Err(Failure::invalid_state("The OffscreenCanvas is detached."))
        } else {
            Ok(())
        }
    }

    fn kind(&self) -> Kind {
        Kind::Offscreen {
            has_placeholder: js::placeholder(self).is_some() || self.frames.borrow().is_some(),
        }
    }

    fn backing<'a>(&'a self, heap: &JsHeap<'a>, wanted: Readback) -> &'a Context {
        js::context(self)
            .map(|it| it.up_to_date(wanted))
            .unwrap_or_else(|| {
                let context = Context::create(
                    self.realm(heap),
                    self.to_js(),
                    self.bitmap_size(),
                    self.kind(),
                    &DEFAULT_SETTINGS,
                );
                js::set_context(self, Some(context));
                context
            })
    }

    pub(crate) fn source<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        wanted: Readback,
    ) -> core::result::Result<Source, Failure> {
        self.require_attached()
            .map(|()| self.backing(heap, wanted).bitmap.source())
    }

    #[optimize(size)]
    pub(super) fn update_placeholder<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        let context = js::context(self);
        let size = context.map_or_else(|| self.bitmap_size(), |it| it.shown().size());
        match js::placeholder(self) {
            Some(element) => commit(
                cx,
                element,
                context.map_or(Frame::Blank, |it| {
                    Frame::Shared(std::rc::Rc::clone(it.shown()))
                }),
                size,
            ),
            None => self
                .frames
                .borrow()
                .iter()
                .for_each(|it| send_frame(it, context, size)),
        }
        Ok(())
    }

    fn resize<'a>(&'a self, cx: Cx<'_, 'a>, axis: usize, length: u64) -> Result<'a, ()> {
        self.require_attached()
            .map_err(|it| it.into_error(&cx.heap))?;
        let mut size = self.size.get();
        size[axis] = length;
        self.size.set(size);
        match js::context(self) {
            Some(context) => {
                context.set_dimensions(&cx.heap, self.bitmap_size());
                Ok(())
            }
            None => self.update_placeholder(cx),
        }
    }

    pub(crate) fn get_width(&self) -> f64 {
        self.size.get()[0] as f64
    }

    pub(crate) fn set_width<'a>(&'a self, cx: Cx<'_, 'a>, width: u64) -> Result<'a, ()> {
        self.resize(cx, 0, width)
    }

    pub(crate) fn get_height(&self) -> f64 {
        self.size.get()[1] as f64
    }

    pub(crate) fn set_height<'a>(&'a self, cx: Cx<'_, 'a>, height: u64) -> Result<'a, ()> {
        self.resize(cx, 1, height)
    }

    pub(crate) fn get_context<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        id: Id,
        options: JsLocal<'a>,
    ) -> Result<'a, JSValue> {
        let wanted = match id {
            Id::TwoD => Mode::TwoD,
            Id::Bitmaprenderer => Mode::BitmapRenderer,
            Id::Webgl => Mode::WebGl,
            Id::Webgl2 => Mode::WebGl2,
            Id::Webgpu => Mode::None,
        };
        let settings = wanted.settings(cx, options.to_js())?;
        self.require_attached()
            .map_err(|it| it.into_error(&cx.heap))?;
        if self.mode.get() == Mode::None
            && wanted != Mode::None
            && let Some(made) = Context::create_for(
                cx,
                wanted,
                self,
                self.bitmap_size(),
                self.kind(),
                &settings,
                options.to_js(),
            )?
            && self.mode.get() == Mode::None
        {
            js::set_context(self, Some(made));
            self.mode.set(wanted);
        }
        Ok(js::context(self)
            .filter(|_| self.mode.get() == wanted)
            .map_or(JSValue::NULL, |it| it.exposed(self.realm(&cx.heap), wanted)))
    }

    #[optimize(size)]
    pub(crate) fn transfer_to_image_bitmap<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> core::result::Result<&'a ImageBitmap, Failure> {
        if self.mode.get() == Mode::None {
            return Err(Failure::invalid_state(
                "Cannot transfer an ImageBitmap from an OffscreenCanvas with no context",
            ));
        }
        let context = self.backing(heap, Readback::Transfer);
        let (source, size) = (context.bitmap.source(), context.bitmap.size());
        if !(1..=MAX_AREA).contains(&area_of(size)) {
            return Err(Failure::Dom(
                DOMExceptionCode::UnknownError,
                "ImageBitmap construction failed",
            ));
        }
        let bitmap = ImageBitmap::create(
            self.realm(heap),
            snapshot(source.whole()),
            size,
            source.is_origin_clean,
        );
        if self.mode.get() == Mode::BitmapRenderer {
            context.set_dimensions(heap, self.bitmap_size());
        } else {
            context.bitmap.erase();
            context.did_draw();
        }
        Ok(bitmap)
    }

    pub(crate) fn convert_to_blob<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        options: &ImageEncodeOptions<'a>,
    ) -> Result<'a, JSValue> {
        let context = self
            .require_attached()
            .map(|()| {
                self.backing(
                    &cx.heap,
                    if has_alpha(options.r#type) {
                        Readback::AsDrawn
                    } else {
                        Readback::Premultiplied
                    },
                )
            })
            .and_then(|it| {
                it.bitmap.require_origin_clean()?;
                if let [0, _] | [_, 0] = self.size.get() {
                    Err(Failure::index_size(
                        "The size of the OffscreenCanvas is zero.",
                    ))
                } else {
                    Ok(it)
                }
            });
        let pixels = context
            .map_err(|it| it.into_error(&cx.heap))?
            .bitmap
            .to_encode(options.r#type, options.quality);
        let result = cx.heap.create_promise();
        let then = cx.heap.create_callback(
            |cx, [result, _], _, blob| {
                let Some(result) = result.as_promise() else {
                    return Ok(JSValue::UNDEFINED);
                };
                if blob[0].to_js().is_null() {
                    let error = cx.heap.create_dom_exception(
                        DOMExceptionCode::EncodingError,
                        format_args!("Encoding of the source image has failed."),
                    );
                    result.reject(cx, error.to_js())?;
                } else {
                    result.resolve(cx, blob[0].to_js())?;
                }
                Ok(JSValue::UNDEFINED)
            },
            [result.to_js(), JSValue::UNDEFINED],
            0,
        );
        encode_in_parallel(cx, pixels).react(&cx.heap, Some(then), None);
        Ok(result.to_js())
    }
}
