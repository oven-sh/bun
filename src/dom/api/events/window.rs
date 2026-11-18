//! What stands behind a global object.

use core::cell::OnceCell;
use std::rc::{Rc, Weak};

use bun_jsc::{JSGlobalObject, Strong};
use bun_web::held::Held;
use bun_web::host::{Browser, Host};
use bun_web::net::fetch::Controller;
use bun_web::origin::Origin;
use bun_web::url::Url;

use super::errors::Errors;
use super::*;
use crate::api::core::{Agent, global_of, global_of_cell};
use crate::api::realm::{hold, last_client_of};
use crate::generated_bindgen::events::js_WindowTarget;

unsafe extern "C" {
    safe fn Bun__DOM__targetBehind(global: &JSGlobalObject, object: JSValue) -> JSValue;
    safe fn Bun__DOM__realmOfWindow(window: JSValue) -> *const JSGlobalObject;
    safe fn Bun__DOM__putBehind(window: JSValue, target: JSValue);
    safe fn Bun__DOM__targetOfRealmOfCallback(
        global: &JSGlobalObject,
        callback: JSValue,
    ) -> JSValue;
}

#[thread_local]
static HAS_FRAMES: Cell<bool> = Cell::new(false);

/// Whether what listens may be of another realm than what it listens to.
#[inline]
pub(super) fn has_frames() -> bool {
    HAS_FRAMES.get()
}

#[repr(C)]
pub(crate) struct WindowTarget {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_WindowTarget::Fields,
    time_origin: Cell<f64>,
    is_frame: bool,
    is_disposed: Cell<bool>,
    outside: Box<Outside>,
}

struct Outside {
    host: Host,
    browser: OnceCell<Browser>,
    languages: RefCell<Vec<String>>,
    errors: Errors,
    /// If it shares the realm, which goes on without it.
    timers: RefCell<Vec<i32>>,
    fetches: RefCell<Vec<Controller>>,
    held: RefCell<Vec<Weak<RefCell<Option<Strong>>>>>,
}

impl WindowTarget {
    /// `extend` gets the realm of `window`. `host` is what `link` needs to be alive.
    fn unattached(link: Host, time_origin: f64, is_frame: bool) -> WindowTarget {
        let outside = Outside {
            host: link,
            browser: OnceCell::new(),
            languages: vec!["en-US".into()].into(),
            errors: Errors::default(),
            timers: Default::default(),
            fetches: Default::default(),
            held: Default::default(),
        };
        WindowTarget {
            base: Default::default(),
            fields: Default::default(),
            time_origin: time_origin.into(),
            is_frame,
            is_disposed: false.into(),
            outside: outside.into(),
        }
    }

    pub(crate) fn create<'a, T: core::ops::Deref<Target = WindowTarget>>(
        window: JSValue,
        host: JSValue,
        link: Host,
        time_origin: f64,
        is_frame: bool,
        extend: impl FnOnce(&JsHeap<'a>, WindowTarget) -> &'a T,
    ) -> &'a T {
        // SAFETY: `window` holds its realm.
        let heap = JsHeap::from_global(unsafe { &*Bun__DOM__realmOfWindow(window) });
        let this = extend(heap, WindowTarget::unattached(link, time_origin, is_frame));
        js_WindowTarget::set_window(this, window);
        js_WindowTarget::set_host(this, host);
        Bun__DOM__putBehind(window, this.to_js());
        HAS_FRAMES.set(has_frames() || is_frame);
        this
    }

    pub(crate) fn show(&self, heap: &JsHeap<'_>, doc: &Doc) {
        if let Some(it) = self.doc() {
            it.set_doc_flags(DocFlags::HAS_PAGE, false);
        }
        js_WindowTarget::set_document(self, Some(doc));
        doc.set_edge(heap, Edge::Window, self.to_js());
        doc.set_doc_flags(DocFlags::HAS_PAGE, true);
        doc.names_were_exposed(heap);
    }

    pub(crate) fn of<'a>(heap: &JsHeap<'a>, window: JSValue) -> Option<&'a WindowTarget> {
        WindowTarget::from_js(heap, Bun__DOM__targetBehind(global_of(heap), window))
    }

    pub(crate) fn of_realm<'a>(heap: &JsHeap<'a>) -> Option<&'a WindowTarget> {
        WindowTarget::of(heap, JSValue::UNDEFINED)
    }

    pub(crate) fn of_realm_or_program<'a>(heap: &JsHeap<'a>) -> Option<&'a WindowTarget> {
        WindowTarget::of_realm(heap).or_else(|| Agent::existing(heap)?.window())
    }

    pub(super) fn of_callback<'a>(
        heap: &JsHeap<'a>,
        callback: JSValue,
    ) -> Option<&'a WindowTarget> {
        WindowTarget::from_js(
            heap,
            Bun__DOM__targetOfRealmOfCallback(global_of(heap), callback),
        )
    }

    pub(crate) fn window(&self) -> JSValue {
        field(js_WindowTarget::window(self))
    }

    /// A worker has none.
    pub(crate) fn doc(&self) -> Option<&Doc> {
        js_WindowTarget::document(self)
    }

    /// <https://dom.spec.whatwg.org/#window-current-event>
    pub(crate) fn event(&self) -> JSValue {
        field(js_WindowTarget::event(self))
    }

    pub(super) fn set_event(&self, event: JSValue) {
        js_WindowTarget::set_event(self, event);
    }

    pub(crate) fn time_origin(&self) -> f64 {
        self.time_origin.get()
    }

    pub(crate) fn set_time_origin(&self, time: f64) {
        self.time_origin.set(time);
    }

    /// <https://w3c.github.io/hr-time/#dfn-relative-high-resolution-coarse-time>
    pub(crate) fn coarse_time(&self, time: f64) -> f64 {
        ((time - self.time_origin()) * 10.0).floor() / 10.0
    }

    pub(crate) fn host(&self) -> &Host {
        &self.outside.host
    }

    pub(crate) fn what_host_needs(&self) -> JSValue {
        field(js_WindowTarget::host(self))
    }

    pub(super) fn errors(&self) -> &Errors {
        &self.outside.errors
    }

    pub(crate) fn browser(&self) -> &Browser {
        self.outside.browser.get().unwrap_or_else(|| {
            let browser = self.host().browser();
            self.outside.browser.get_or_init(|| browser)
        })
    }

    /// Serialized.
    pub(crate) fn origin(&self, heap: &JsHeap<'_>) -> DomString {
        let of_url = || {
            self.doc()
                .and_then(|it| Url::parse(it.url().to_utf8().as_bytes()))
                .map_or_else(Origin::new_opaque, |it| Origin::of(&it))
        };
        DomString::from_latin1(
            last_client_of(self.realm(heap))
                .map_or_else(of_url, |it| it.origin())
                .as_bytes(),
        )
    }

    pub(crate) fn languages(&self) -> Vec<String> {
        self.outside.languages.borrow().clone()
    }

    pub(crate) fn language(&self) -> String {
        self.outside.languages.borrow()[0].clone()
    }

    /// Whether they are new.
    pub(crate) fn set_languages(&self, languages: Vec<String>) -> bool {
        !languages.is_empty() && *self.outside.languages.borrow() != languages && {
            self.outside.languages.replace(languages);
            true
        }
    }

    pub(crate) fn is_disposed(&self) -> bool {
        self.is_disposed.get()
    }

    pub(crate) fn is_frame(&self) -> bool {
        self.is_frame
    }

    pub(super) fn is_removed_frame(&self) -> bool {
        self.is_frame && self.is_disposed()
    }

    pub(crate) fn dispose(&self) {
        self.is_disposed.set(true);
        self.outside
            .timers
            .take()
            .into_iter()
            .for_each(|it| bun_web::timers::clear(global_of_cell(self), it));
        self.outside
            .fetches
            .take()
            .iter()
            .for_each(Controller::abort);
        self.outside
            .held
            .take()
            .iter()
            .filter_map(Weak::upgrade)
            .for_each(|it| drop(it.take()));
        bun_web::tasks::cancel_delayed_tasks_about(global_of_cell(self), self.to_js());
    }

    pub(crate) fn shares_realm(&self, heap: &JsHeap<'_>) -> bool {
        !WindowTarget::of_realm(self.realm(heap)).is_some_and(|it| core::ptr::eq(it, self))
    }

    /// Until it is disposed of.
    pub(super) fn hold(&self, heap: &JsHeap<'_>, value: JSValue) -> Held<Strong> {
        let held = hold(heap, Strong::create(value, global_of(heap)));
        if self.shares_realm(heap) {
            let mut all = self.outside.held.borrow_mut();
            if all.len() == all.capacity() {
                all.retain(|it| it.strong_count() > 0);
            }
            all.push(Rc::downgrade(&held));
        }
        held
    }

    pub(crate) fn note_fetch(&self, controller: &Controller) {
        if self.is_disposed() {
            return controller.abort();
        }
        let mut all = self.outside.fetches.borrow_mut();
        if all.len() == all.capacity() {
            all.retain(Controller::is_in_use);
        }
        all.push(controller.clone());
    }

    pub(crate) fn note_timer(&self, heap: &JsHeap<'_>, id: i32) {
        if !self.shares_realm(heap) {
            return;
        }
        if self.is_disposed() {
            return bun_web::timers::clear(global_of_cell(self), id);
        }
        let mut all = self.outside.timers.borrow_mut();
        if all.len() == all.capacity() {
            all.retain(|it| bun_web::timers::is_active(global_of_cell(self), *it));
        }
        all.push(id);
    }
}

impl Doc {
    /// The one that it was shown in, if it no longer is.
    pub(crate) fn last_window(&self) -> Option<&WindowTarget> {
        // SAFETY: what `attach` has put there.
        self.edge(Edge::Window)
            .map(|it| unsafe { WindowTarget::from_js_unchecked(it) })
    }

    #[inline]
    pub(crate) fn window(&self) -> Option<&WindowTarget> {
        if self.is(DocFlags::HAS_PAGE) {
            self.last_window()
        } else {
            None
        }
    }
}

/// Whether the global object of the realm is a worker's, or has a document that is fully active.
pub(crate) fn is_fully_active(realm: &JsHeap<'_>) -> bool {
    !WindowTarget::of_realm(realm).is_some_and(WindowTarget::is_disposed)
}

pub(crate) fn report_exception(cx: Cx<'_, '_>, exception: JSValue) {
    let window = WindowTarget::of_realm(&cx.heap);
    errors::report(cx, window, exception);
}
