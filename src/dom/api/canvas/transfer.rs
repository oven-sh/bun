//! The serialization and transfer steps of `ImageBitmap` and `OffscreenCanvas`.

use core::any::Any;

use bun_jsc::bindgen::{IntoError as _, JsHeap, JsInterface as _, JsLocal, JsScope, Result};
use bun_jsc::{DOMExceptionCode, JSType, JSValue};
use bun_web::channel::{Arrival, Endpoint, Message, Serialized, Transferred};

use super::Failure;
use super::bitmap::{Owned, Source, area_of, snapshot};
use super::context::Context;
use super::element::{Frame, commit, frames_of};
use super::image_bitmap::ImageBitmap;
use super::offscreen::OffscreenCanvas;
use crate::api::messaging::listen;
use crate::api::realm::hold;
use crate::generated_bindgen::canvas::HTMLCanvasElement;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

/// An id of the library, for any thread.
struct Pixels {
    id: u32,
    size: [u32; 2],
    is_origin_clean: bool,
}

impl Pixels {
    fn adopt(mut self) -> Owned {
        Owned::adopt(core::mem::take(&mut self.id))
    }
}

impl Drop for Pixels {
    fn drop(&mut self) {
        drop(Owned::adopt(self.id));
    }
}

enum Moved {
    ImageBitmap(Pixels),
    OffscreenCanvas {
        size: [u64; 2],
        placeholder: Option<Endpoint>,
    },
}

fn cloneable(bitmap: &ImageBitmap) -> core::result::Result<Source, Failure> {
    let refused = Failure::Dom(
        DOMExceptionCode::DataCloneError,
        "The ImageBitmap is detached, or not origin-clean.",
    );
    bitmap
        .source()
        .ok()
        .filter(|it| it.is_origin_clean)
        .ok_or(refused)
}

impl ImageBitmap {
    #[optimize(size)]
    pub(crate) fn serialize<'a>(&'a self, cx: Cx<'_, 'a>, _: bool) -> Result<'a, JSValue> {
        let source = cloneable(self).map_err(|it| it.into_error(&cx.heap))?;
        let pixels = source
            .read()
            .ok_or_else(|| cx.heap.range_error(format_args!("Out of memory")))?;
        let pixels = cx
            .heap
            .create_typed_array_from_box(JSType::Uint8Array, pixels)?
            .to_js();
        let parts = [
            pixels,
            JSValue::js_number(self.get_width().into()),
            JSValue::js_number(self.get_height().into()),
        ];
        cx.heap
            .create_array(parts, |heap, it| Ok(JsLocal::new(heap, it)))
            .map(JsLocal::to_js)
    }

    #[optimize(size)]
    pub(crate) fn deserialize<'a>(cx: Cx<'_, 'a>, parts: JsLocal<'a>) -> Result<'a, JSValue> {
        let mut part = |at| parts.to_js().get_index(cx.global(), at);
        let (data, size) = (part(0)?, [part(1)?.to_u32(), part(2)?.to_u32()]);
        let data = data.as_array_buffer(cx.global());
        let whole = data
            .as_ref()
            .map(|it| it.byte_slice())
            .filter(|it| it.len() as u64 == area_of(size) * 4);
        Ok(ImageBitmap::create(
            &cx.heap,
            whole.map_or_else(|| Owned::adopt(0), |it| Owned::from_pixels(size, it)),
            size,
            true,
        )
        .to_js())
    }
}

pub(crate) enum Transferable<'a> {
    ImageBitmap(&'a ImageBitmap),
    OffscreenCanvas(&'a OffscreenCanvas),
}

impl<'a> Transferable<'a> {
    pub(crate) fn of(
        heap: &JsHeap<'a>,
        object: JSValue,
    ) -> Option<core::result::Result<Transferable<'a>, Failure>> {
        match ImageBitmap::from_js(heap, object) {
            Some(bitmap) => Some(cloneable(bitmap).map(|_| Transferable::ImageBitmap(bitmap))),
            None => OffscreenCanvas::from_js(heap, object).map(|it| {
                it.require_transferable()
                    .map(|()| Transferable::OffscreenCanvas(it))
            }),
        }
    }

    pub(crate) fn transfer(self, cx: Cx<'_, 'a>) -> Box<dyn Any + Send> {
        Box::new(match self {
            Transferable::ImageBitmap(bitmap) => {
                let size = [bitmap.get_width(), bitmap.get_height()];
                Moved::ImageBitmap(Pixels {
                    id: bitmap.detach().map_or(0, Owned::into_id),
                    size,
                    is_origin_clean: true,
                })
            }
            Transferable::OffscreenCanvas(canvas) => {
                let (size, element, endpoint) = canvas.detach();
                Moved::OffscreenCanvas {
                    size,
                    placeholder: endpoint.or_else(|| element.map(|it| accept_frames(cx, it))),
                }
            }
        })
    }
}

pub(crate) fn receive<'a>(heap: &JsHeap<'a>, moved: Box<dyn Any + Send>) -> JSValue {
    match moved.downcast().map(|it| *it) {
        Ok(Moved::ImageBitmap(pixels)) => {
            let size = pixels.size;
            ImageBitmap::create(heap, pixels.adopt(), size, true).to_js()
        }
        Ok(Moved::OffscreenCanvas { size, placeholder }) => {
            OffscreenCanvas::received(heap, size, placeholder).to_js()
        }
        Err(_) => JSValue::NULL,
    }
}

fn accept_frames<'a>(cx: Cx<'_, 'a>, placeholder: &'a HTMLCanvasElement) -> Endpoint {
    let (ours, theirs) = Endpoint::pair();
    listen(cx, &ours, placeholder.to_js(), frame_arrived);
    frames_of(placeholder).replace(hold(&cx.heap, ours));
    theirs
}

fn frame_arrived<'a>(cx: Cx<'_, 'a>, placeholder: JsLocal<'a>) {
    let Some(placeholder) = HTMLCanvasElement::from_js(&cx.heap, placeholder.to_js()) else {
        return;
    };
    let arrival = frames_of(placeholder)
        .borrow()
        .borrow()
        .as_ref()
        .and_then(Endpoint::take);
    match arrival {
        Some(Arrival::Message(mut message)) => {
            let Some(Transferred::Canvas(frame)) = message.transferred.pop() else {
                return;
            };
            let Ok(frame) = frame.downcast::<Pixels>() else {
                return;
            };
            let (size, is_origin_clean) = (frame.size, frame.is_origin_clean);
            commit(
                cx,
                placeholder,
                if frame.id == 0 {
                    Frame::Blank
                } else {
                    Frame::Copy {
                        pixels: frame.adopt(),
                        is_origin_clean,
                    }
                },
                size,
            );
        }
        Some(Arrival::Closed) => drop(frames_of(placeholder).take().take()),
        None => {}
    }
}

pub(super) fn send_frame(placeholder: &Endpoint, context: Option<&Context>, size: [u32; 2]) {
    let source = context.map(|it| it.bitmap.source());
    let is_origin_clean = source.as_ref().is_none_or(|it| it.is_origin_clean);
    let id = source
        .filter(|it| !it.is_empty())
        .map_or(0, |it| snapshot(it.whole()).into_id());
    let transferred = vec![Transferred::Canvas(Box::new(Pixels {
        id,
        size,
        is_origin_clean,
    }))];
    if let Some(value) = Serialized::immediate(JSValue::UNDEFINED) {
        placeholder.send(Message {
            value,
            transferred,
            kind: 0,
        });
    }
}
