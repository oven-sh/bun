//! Tasks, callbacks and loads on behalf of a document.

use core::cell::Cell;

use bun_jsc::bindgen::{JsHeap, JsInterface as _, JsLocal, JsScope, Result};
use bun_jsc::job::JsThread;
use bun_jsc::{JSGlobalObject, JSObject, JSValue};
use bun_web::realm::{Realm, Scope};
use smallvec::SmallVec;

use super::core::{Atom, Doc, DocFlags, DomString, List, Node, seams};
pub(crate) use super::window::take_requests;
use crate::generated_bindgen::core::{
    AddEventListenerOptionsOrBoolean, DesktopAddEventListenerOptions as AddEventListenerOptions,
};
use crate::generated_bindgen::interim::js_NativeSteps;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

type Steps = dyn for<'a> FnOnce(Cx<'_, 'a>, &[JSValue]) -> Result<'a, ()>;

pub(crate) struct NativeSteps(Cell<Option<Box<Steps>>>);

/// The steps get `values`, and then the arguments.
pub(crate) fn once(
    heap: &JsHeap<'_>,
    values: &[JSValue],
    steps: impl for<'b> FnOnce(Cx<'_, 'b>, &[JSValue]) -> Result<'b, ()> + 'static,
) -> JSValue {
    fn run<'a>(
        cx: Cx<'_, 'a>,
        [steps, values]: [JsLocal<'a>; 2],
        _: u64,
        arguments: &[JsLocal<'a>],
    ) -> Result<'a, JSValue> {
        let values: SmallVec<[JSValue; 4]> = List::from_value(values.to_js())
            .values()
            .chain(arguments.iter().map(|it| it.to_js()))
            .collect();
        NativeSteps::from_js(&cx.heap, steps.to_js())
            .and_then(|it| it.0.take())
            .map_or(Ok(()), |it| it(cx, &values))?;
        Ok(JSValue::UNDEFINED)
    }
    let steps = js_NativeSteps::create(heap, NativeSteps(Cell::new(Some(Box::new(steps))))).to_js();
    heap.create_callback(
        run,
        [
            steps,
            List::from_fn(heap, values.len() as u32, |at| values[at as usize]).to_js(),
        ],
        0,
    )
    .to_js()
}

/// For what a job does when it is done.
pub(crate) fn in_realm_of(
    _: &JsThread<'_>,
    object: Option<JSValue>,
    steps: impl for<'b> FnOnce(Cx<'_, 'b>),
) {
    unsafe extern "C" {
        safe fn Bun__DOM__globalOf(cell: JSValue) -> *const JSGlobalObject;
    }
    if let Some(object) = object {
        // SAFETY: the event loop is the caller, and the object is alive.
        unsafe { JsScope::with(Bun__DOM__globalOf(object).cast_mut(), steps) };
    }
}

pub(crate) fn queue_task(
    document: &Doc,
    values: &[JSValue],
    steps: impl for<'b> FnOnce(Cx<'_, 'b>, &[JSValue]) -> Result<'b, ()> + 'static,
) {
    super::events::queue_task_for(document, values, Box::new(steps));
}

pub(crate) fn queue_task_after(
    document: &Doc,
    milliseconds: f64,
    values: &[JSValue],
    steps: impl for<'b> FnOnce(Cx<'_, 'b>, &[JSValue]) -> Result<'b, ()> + 'static,
) {
    super::events::queue_task_after(document, milliseconds, values, Box::new(steps));
}

fn listener<'a>(
    cx: Cx<'_, 'a>,
    event: JSValue,
    callback: JSValue,
) -> Option<(Atom, JsLocal<'a, JSObject>)> {
    Some((
        Atom::from_js_string(&cx.heap, JsLocal::new(&cx.heap, event).as_string()?).ok()?,
        JsLocal::new(&cx.heap, callback).as_any_object()?,
    ))
}

pub(crate) fn add_listener<'a>(
    cx: Cx<'_, 'a>,
    target: &'a Node,
    event: JSValue,
    callback: JSValue,
    once: bool,
) {
    if let Some((event, callback)) = listener(cx, event, callback) {
        let options = AddEventListenerOptions {
            capture: false,
            once,
            passive: None,
            signal: JsLocal::new(&cx.heap, JSValue::UNDEFINED),
        };
        let _ = target.add_event_listener(
            &cx.heap,
            &event,
            Some(callback),
            Some(AddEventListenerOptionsOrBoolean::Options(options)),
        );
    }
}

pub(crate) fn remove_listener<'a>(
    cx: Cx<'_, 'a>,
    target: &'a Node,
    event: JSValue,
    callback: JSValue,
) {
    if let Some((event, callback)) = listener(cx, event, callback) {
        target.remove_event_listener(&cx.heap, &event, Some(callback), None);
    }
}

impl Doc {
    pub(crate) fn has_page(&self) -> bool {
        self.is(DocFlags::HAS_PAGE)
    }

    pub(crate) fn is_fully_active(&self) -> bool {
        self.window().is_some_and(|it| !it.is_disposed())
    }
}

pub(crate) fn delay_load(_: Cx<'_, '_>, document: &Doc) {
    super::loading::delay_load(document);
}

pub(crate) fn allow_load(_: Cx<'_, '_>, document: &Doc) {
    super::loading::allow_load(document);
}

pub(crate) fn resolve<'a>(cx: Cx<'_, 'a>, document: &'a Doc, url: &DomString) -> Option<DomString> {
    document.parse_url(cx, url).map(|it| it.into_href())
}

pub(crate) use seams::current_document;

/// A worker has none.
pub(crate) fn shown_document<'a>(cx: Cx<'_, 'a>) -> Result<'a, Option<&'a Doc>> {
    match Realm::of(cx.global()).is_some_and(|it| it.scope() != Scope::Window) {
        true => Ok(None),
        false => current_document(cx).map(Some),
    }
}

pub(crate) use super::workers::font_scope;
