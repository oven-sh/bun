//! What fonts ask of the page, which a worker has too.

use core::cell::RefCell;
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsInterface, JsLocal, JsScope};
use bun_ui::protocol::Request;
use bun_web::realm::Realm;
use bun_web::request::Destination;

use super::FontFace;
use crate::api::core::Doc;
use crate::api::interim::once;
use crate::api::loading::{load_subresource, when_loaded};

/// `promise` is not rejected.
fn then<'a>(
    cx: &mut JsScope<'a>,
    promise: JSValue,
    [face, doc]: [JSValue; 2],
    steps: impl for<'b> FnOnce(&mut JsScope<'b>, &'b FontFace, &'b Doc, JSValue) + 'static,
) {
    let callback = once(&cx.heap, &[face, doc], |cx, values| {
        // SAFETY: what is captured.
        let (face, doc) = unsafe {
            (
                FontFace::from_js_unchecked(values[0]),
                Doc::from_js_unchecked(values[1]),
            )
        };
        steps(cx, face, doc, values[2]);
        Ok(())
    });
    if let Ok(promise) = cx.promise_resolve(promise) {
        promise.react(
            &cx.heap,
            JsLocal::new(&cx.heap, callback).as_callable(),
            None,
        );
    }
}

/// On another thread, if that takes a while.
pub(super) fn decode<'a>(
    cx: &mut JsScope<'a>,
    face_and_doc: [JSValue; 2],
    bytes: Rc<[u8]>,
    steps: impl for<'b> FnOnce(&mut JsScope<'b>, &'b FontFace, &'b Doc, Rc<[u8]>) + 'static,
) {
    let decoded = decode_elsewhere(cx.global(), &bytes);
    then(cx, decoded, face_and_doc, move |cx, face, doc, _| {
        steps(cx, face, doc, bytes)
    });
}

fn decode_elsewhere(global: &bun_jsc::JSGlobalObject, bytes: &[u8]) -> JSValue {
    let is_slow = crate::font_face::ui()
        .is_some_and(|it| matches!((it.decode_font)(bytes.into()).get(), Ok(false)));
    // A worker gets no replies.
    let decoded = match is_slow && global.bun_vm().is_main_thread.get() {
        true => bun_ui::queue::promise_of(global, Request::DecodeFont(bytes.into()), |_, _| {
            Ok(JSValue::UNDEFINED)
        }),
        false => Ok(JSValue::UNDEFINED),
    };
    decoded.unwrap_or(JSValue::UNDEFINED)
}

/// For the windows that have the realm of who has opened them, and its policies.
#[derive(Default)]
struct Fetched(RefCell<Vec<(Box<str>, Rc<[u8]>)>>);

pub(super) fn fetch<'a>(
    cx: &mut JsScope<'a>,
    face: &'a FontFace,
    doc: &'a Doc,
    url: &str,
    steps: impl for<'b> FnOnce(&mut JsScope<'b>, &'b FontFace, &'b Doc, Option<Rc<[u8]>>) + 'static,
) {
    const MAX_KEPT: usize = 4;
    let kept = Realm::of(doc.global())
        .filter(|_| doc.window().is_some_and(|it| !it.is_frame()))
        .map(Realm::extra::<Fetched>);
    if let Some(bytes) = kept.as_ref().and_then(|it| {
        it.0.borrow()
            .iter()
            .find(|it| *it.0 == *url)
            .map(|it| Rc::clone(&it.1))
    }) {
        return decode(
            cx,
            [face.to_js(), doc.to_js()],
            bytes,
            |cx, face, doc, bytes| steps(cx, face, doc, Some(bytes)),
        );
    }
    let (loading, url) = (
        load_subresource(cx, doc, url.as_bytes(), Destination::Font, None),
        Box::from(url),
    );
    when_loaded(
        doc,
        face.to_js(),
        loading,
        |cx, doc, face, loaded| match loaded.map(|it| Rc::<[u8]>::from(&*it.bytes)) {
            Some(bytes) => {
                if let Some(kept) = kept.filter(|it| it.0.borrow().len() < MAX_KEPT) {
                    kept.0.borrow_mut().push((url, Rc::clone(&bytes)));
                }
                decode(cx, [face, doc.to_js()], bytes, |cx, face, doc, bytes| {
                    steps(cx, face, doc, Some(bytes))
                });
            }
            // SAFETY: what was given.
            None => steps(cx, unsafe { FontFace::from_js_unchecked(face) }, doc, None),
        },
    );
}

pub(super) fn queue_task<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    values: [JSValue; 2],
    steps: for<'b> fn(&mut JsScope<'b>, [JSValue; 2]),
) {
    crate::api::ui::host::queue_task(cx, doc, values, steps);
}
