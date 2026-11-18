//! `<img>` and what else shows an image.

mod exif;
mod host;
mod img;
mod others;
mod pictures;
mod source_set;

use core::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope, Result};

use crate::api::core::{Doc, DomString, Edge, Element, Known, Node, atom};
use crate::api::events::{fire, now};
use crate::api::on_behalf::*;
pub(crate) use host::*;
use img::settle_decoding;
pub(crate) use img::{
    IMG_STEPS, SOURCE_STEPS, is_supported as is_supported_type, load_lazy_images, load_when_near,
    loaded_at, preload_url, reselect_auto_sized_images, reselect_images, selected_url,
};
pub(crate) use others::*;
pub(crate) use pictures::{Contents, Cors, Picture, Pictures, Used};

type Cx<'c, 'a> = &'c mut JsScope<'a>;

/// With the steps in a microtask.
fn later<'a>(heap: &JsHeap<'a>, element: &'a Element, steps: for<'b> fn(Cx<'_, 'b>, &'b Element)) {
    fn run<'a>(
        cx: Cx<'_, 'a>,
        [element, _]: [JsLocal<'a>; 2],
        steps: u64,
        _: &[JsLocal<'a>],
    ) -> Result<'a, JSValue> {
        // SAFETY: what `later` has cast.
        let steps = unsafe {
            core::mem::transmute::<usize, for<'b> fn(Cx<'_, 'b>, &'b Element)>(steps as usize)
        };
        element_in(&cx.heap, element.to_js())
            .into_iter()
            .for_each(|it| steps(cx, it));
        Ok(JSValue::UNDEFINED)
    }
    heap.queue_microtask(
        heap.create_callback(
            run,
            [element.to_js(), JSValue::UNDEFINED],
            steps as usize as u64,
        ),
        JSValue::UNDEFINED,
    );
}

/// All of it if it has no `end`.
fn before(text: &str, end: u8) -> &str {
    &text[..bun_core::strings::index_of_char_usize(text.as_bytes(), end).unwrap_or(text.len())]
}

fn element_in<'a>(heap: &JsHeap<'a>, value: JSValue) -> Option<&'a Element> {
    Node::from_js(heap, value)?.as_element()
}

/// In CSS pixels.
fn natural_size(contents: Option<&Contents>, density: f64) -> [f64; 2] {
    let Some(Contents {
        size: [width, height],
        ratio,
        ..
    }) = contents
    else {
        return [0.0; 2];
    };
    let known = |it: f64| Some(it).filter(|it| !it.is_nan());
    let size = match (
        known(*width),
        known(*height),
        Some(*ratio).filter(|it| *it > 0.0),
    ) {
        (Some(width), Some(height), _) => [width / density, height / density],
        (Some(width), None, ratio) => [
            width / density,
            ratio.map_or(150.0, |it| width / it / density),
        ],
        (None, Some(height), ratio) => [
            ratio.map_or(300.0, |it| height * it / density),
            height / density,
        ],
        (None, None, Some(ratio)) if ratio > 2.0 => [300.0, 300.0 / ratio],
        (None, None, ratio) => [150.0 * ratio.unwrap_or(2.0), 150.0],
    };
    size.map(|it| (it + 0.5).floor())
}

pub(crate) fn dispose_pictures<'a>(cx: Cx<'_, 'a>, document: &'a Doc) {
    img::abandon_decoding(cx, document);
    Pictures::of(&cx.heap, document).dispose();
}
