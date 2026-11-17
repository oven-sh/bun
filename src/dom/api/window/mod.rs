//! The global objects, and what they tell about the world outside of the document.

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{self, Callable, JsHeap, JsInterface as _, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSObject, JSValue, Strong};
use bun_web::host::{DialogAnswer, DialogKind};
use bun_web::realm::Realm;

use crate::api::core::*;
use crate::api::events::{self, WindowTarget};
use crate::api::range::{Selection, selection_of};
use crate::api::scheduler::Scheduler;
use crate::api::trusted::{Factory, Trusted};
use crate::generated_bindgen::window::*;

mod callbacks;
mod console;
mod navigator;
pub(crate) mod page;
mod pending;
mod printing;
mod rendering;
mod screen;
mod view;
mod worker;

pub(crate) use callbacks::IdleDeadline;
pub(crate) use console::Console;
pub(crate) use rendering::{Is, take_requests};
pub(crate) use screen::{Screen, VisualViewport, WindowControlsOverlay};
pub(crate) use worker::{WorkerGlobalScope, WorkerLocation};

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

unsafe extern "C" {
    safe fn Bun__WebGlobalObject__globalThis(global: &JSGlobalObject) -> JSValue;
}

#[repr(C)]
pub(crate) struct Window {
    pub(crate) base: WindowTarget,
    pub(crate) fields: js_DomWindow::Fields,
    view: Box<view::View>,
    rendering: Box<rendering::Rendering>,
    frames: callbacks::Frames,
    idle: callbacks::Idle,
    status: RefCell<DomString>,
    font_scope: Cell<u32>,
    pub(crate) name: RefCell<Option<String>>,
    pub(crate) phase: Cell<crate::api::history::Phase>,
}

impl WindowTarget {
    /// An isolated world has a global object of its own.
    fn realm_for<'h, 'a>(&self, caller: &'h JsHeap<'a>) -> &'h JsHeap<'a> {
        if WindowTarget::of_realm(caller).is_some_and(|it| core::ptr::eq(it, self)) {
            caller
        } else {
            self.realm(caller)
        }
    }

    /// <https://html.spec.whatwg.org/#api-base-url>
    pub(crate) fn base_url(&self) -> DomString {
        match self.downcast::<WorkerGlobalScope>() {
            Some(worker) => DomString::from_utf8(crate::values::text(worker.url().href())),
            None => self.doc().map(Doc::base_url).unwrap_or_default(),
        }
    }

    fn start_timer<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        handler: JsLocal<'a>,
        timeout: i32,
        arguments: &[JsLocal<'a>],
        repeats: bool,
    ) -> Result<'a, i32> {
        if handler.as_callable().is_some() {
            let global = global_of(self.realm_for(&cx.heap));
            return Ok(bun_web::timers::start(
                global,
                handler.to_js(),
                timeout,
                JsLocal::to_js_slice(arguments),
                repeats,
            )
            .inspect(|it| self.note_timer(&cx.heap, *it))?);
        }
        let sink = format!(
            "{} {}",
            if self.doc().is_some() {
                "Window"
            } else {
                "WorkerGlobalScope"
            },
            if repeats { "setInterval" } else { "setTimeout" }
        );
        let source = Trusted::Script.string_in_realm_of(cx, self, handler, &sink)?;
        let global = global_of(self.realm_for(&cx.heap));
        let Some(realm) =
            Realm::of(global).filter(|it| it.allows_eval(source.to_utf8().as_bytes()))
        else {
            return Ok(0);
        };
        let base = Some(realm.base_of_script())
            .filter(|it| !it.is_empty())
            .map_or_else(
                || self.base_url(),
                |it| DomString::from_utf8(crate::values::text(&it.to_utf8())),
            );
        let [source, url, base] =
            [source, self.base_url(), base].map(|it| it.to_js(&cx.heap).to_js());
        Ok(
            bun_web::timers::start(global, source, timeout, &[url, base], repeats)
                .inspect(|it| self.note_timer(&cx.heap, *it))?,
        )
    }
}

impl WindowOrWorkerGlobalScope {
    pub(crate) fn get_origin(&self, heap: &JsHeap<'_>) -> DomString {
        self.origin(heap)
    }

    pub(crate) fn get_is_secure_context(&self, heap: &JsHeap<'_>) -> bool {
        self.realm(heap).is_secure_context()
    }

    pub(crate) fn get_trusted_types<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Factory {
        Factory::for_realm(self.realm(heap))
    }

    pub(crate) fn get_cross_origin_isolated(&self, heap: &JsHeap<'_>) -> bool {
        Realm::of(global_of(self.realm(heap))).is_some_and(Realm::is_cross_origin_isolated)
    }

    pub(crate) fn report_error<'a>(&'a self, cx: Cx<'_, 'a>, error: JsLocal<'a>) {
        events::report_exception_to(cx, self, error.to_js());
    }

    pub(crate) fn set_timeout<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        handler: JsLocal<'a>,
        timeout: i32,
        arguments: &[JsLocal<'a>],
    ) -> Result<'a, i32> {
        self.start_timer(cx, handler, timeout, arguments, false)
    }

    pub(crate) fn set_interval<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        handler: JsLocal<'a>,
        timeout: i32,
        arguments: &[JsLocal<'a>],
    ) -> Result<'a, i32> {
        self.start_timer(cx, handler, timeout, arguments, true)
    }

    pub(crate) fn clear_timer<'a>(&'a self, cx: Cx<'_, 'a>, id: i32) {
        bun_web::timers::clear(global_of(self.realm_for(&cx.heap)), id);
    }
}

impl Window {
    fn new(base: WindowTarget) -> Window {
        Window {
            base,
            fields: Default::default(),
            view: Default::default(),
            rendering: Default::default(),
            frames: Default::default(),
            idle: Default::default(),
            status: Default::default(),
            font_scope: 0.into(),
            name: Default::default(),
            phase: Default::default(),
        }
    }

    pub(crate) fn of(doc: &Doc) -> Option<&Window> {
        doc.last_window()?.downcast()
    }

    pub(crate) fn get_scheduler<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Scheduler {
        Scheduler::new(heap, self)
    }

    pub(crate) fn document(&self) -> &Doc {
        self.doc().expect("it is shown before scripts run")
    }

    pub(crate) fn get_itself(&self, heap: &JsHeap<'_>) -> JSValue {
        match WindowTarget::of_realm(heap).is_some_and(|it| core::ptr::eq(it, &raw const self.base))
        {
            true => Bun__WebGlobalObject__globalThis(global_of(heap)),
            false => self.window(),
        }
    }

    pub(crate) fn get_custom_elements(&self, _: &JsHeap<'_>) -> JSValue {
        self.document()
            .registry()
            .map_or(JSValue::NULL, |it| it.to_js())
    }

    pub(crate) fn get_bar<'a>(&'a self, heap: &JsHeap<'a>) -> &'a BarProp {
        let bar = js_BarProp::create(self.realm(heap), Default::default());
        js_BarProp::set_window(bar, Some(self));
        bar
    }

    pub(crate) fn get_status(&self, _: &JsHeap<'_>) -> DomString {
        self.status.borrow().clone()
    }

    pub(crate) fn set_status(&self, _: &JsHeap<'_>, status: DomString) {
        self.status.replace(status);
    }

    pub(crate) fn get_origin_agent_cluster(&self) -> bool {
        false
    }

    pub(crate) fn get_external<'a>(&'a self, heap: &JsHeap<'a>) -> &'a External {
        js_External::create(self.realm(heap), Default::default())
    }

    pub(crate) fn get_current_event(&self, _: &JsHeap<'_>) -> JSValue {
        Some(self.event())
            .filter(|it| !it.is_empty())
            .unwrap_or(JSValue::UNDEFINED)
    }

    fn show_dialog<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        kind: DialogKind,
        message: &DomString,
        initial: &DomString,
    ) -> Result<'a, DialogAnswer> {
        crate::api::performance::note_modal_dialog(self.realm(&cx.heap));
        match self.host().dialog(
            kind,
            message.to_utf8().into_owned(),
            initial.to_utf8().into_owned(),
        ) {
            DialogAnswer::Unsupported => Err(cx
                .global()
                .throw(format_args!(
                    "{}() is not supported.",
                    crate::values::text(kind.as_bytes())
                ))
                .into()),
            answer => Ok(answer),
        }
    }

    pub(crate) fn alert<'a>(&'a self, cx: Cx<'_, 'a>, message: &DomString) -> Result<'a> {
        self.show_dialog(cx, DialogKind::Alert, message, &DomString::default())
            .map(drop)
    }

    pub(crate) fn confirm<'a>(&'a self, cx: Cx<'_, 'a>, message: &DomString) -> Result<'a, bool> {
        Ok(matches!(
            self.show_dialog(cx, DialogKind::Confirm, message, &DomString::default())?,
            DialogAnswer::Accepted
        ))
    }

    pub(crate) fn prompt<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        message: &DomString,
        initial: &DomString,
    ) -> Result<'a, Option<DomString>> {
        Ok(
            match self.show_dialog(cx, DialogKind::Prompt, message, initial)? {
                DialogAnswer::Text(text) => Some(DomString::from_utf8(&text)),
                _ => None,
            },
        )
    }

    pub(crate) fn do_nothing(&self) {}

    pub(crate) fn get_selection<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a Selection> {
        Some(selection_of(heap, self.document()))
    }

    pub(crate) fn find<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        text: &[u8],
        is_case_sensitive: bool,
        is_backward: bool,
        wraps: bool,
    ) -> bool {
        !pending::is_container_inert(cx, self)
            && crate::api::find::find_and_select(
                cx,
                self.document(),
                text,
                is_case_sensitive,
                is_backward,
                wraps,
            )
    }
}

macro_rules! of_window {
    ($($Type:ident $js:ident)*) => {$(
        impl $Type {
            fn window(&self) -> &Window {
                $js::window(self).expect("set when it is made")
            }
        }
    )*};
}
use of_window;

of_window!(BarProp js_BarProp);

impl BarProp {
    pub(crate) fn get_visible(&self, _: Cx<'_, '_>) -> bool {
        !self.window().is_disposed() && !self.window().host().is_popup()
    }
}

impl External {
    pub(crate) fn do_nothing(&self) {}
}
