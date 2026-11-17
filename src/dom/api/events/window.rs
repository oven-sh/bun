//! What stands behind a global object.

use core::cell::OnceCell;

use bun_jsc::JSGlobalObject;
use bun_web::host::{Browser, Host};
use bun_web::origin::Origin;
use bun_web::url::Url;

use super::errors::Errors;
use super::*;
use crate::api::core::by_name::member;
use crate::api::core::{Agent, global_of_cell};
use crate::api::realm::last_client_of;
use crate::generated_bindgen::events::js_WindowTarget;

unsafe extern "C" {
    safe fn Bun__DOM__targetBehind(global: &JSGlobalObject, object: JSValue) -> JSValue;
    safe fn Bun__DOM__realmOfWindow(window: JSValue) -> *const JSGlobalObject;
    safe fn Bun__DOM__putBehind(window: JSValue, target: JSValue);
    safe fn Bun__RealmBridge__hostBehind(global: &JSGlobalObject, link: JSValue) -> JSValue;
    fn Bun__RealmBridge__callHost(
        global: &JSGlobalObject,
        host: JSValue,
        name: &bun_core::String,
        arguments: *const JSValue,
        count: usize,
    );
    fn Bun__RealmBridge__askHost(
        global: &JSGlobalObject,
        host: JSValue,
        name: *const u8,
        length: usize,
        arguments: *const JSValue,
        count: usize,
    ) -> JSValue;
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
    time_origin: f64,
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
}

impl WindowTarget {
    /// `extend` gets the realm of `window`.
    pub(crate) fn create<'a, T: core::ops::Deref<Target = WindowTarget>>(
        heap: &JsHeap<'a>,
        window: JSValue,
        [tools, link]: [JSValue; 2],
        time_origin: f64,
        is_frame: bool,
        extend: impl FnOnce(&JsHeap<'a>, WindowTarget) -> &'a T,
    ) -> &'a T {
        let host = Bun__RealmBridge__hostBehind(global_of(heap), link);
        // SAFETY: a field holds `host`.
        WindowTarget::with_host(
            window,
            [tools, host],
            unsafe { Host::of(host) },
            time_origin,
            is_frame,
            extend,
        )
    }

    pub(crate) fn with_host<'a, T: core::ops::Deref<Target = WindowTarget>>(
        window: JSValue,
        [tools, host]: [JSValue; 2],
        link: Host,
        time_origin: f64,
        is_frame: bool,
        extend: impl FnOnce(&JsHeap<'a>, WindowTarget) -> &'a T,
    ) -> &'a T {
        let outside = Outside {
            host: link,
            browser: OnceCell::new(),
            languages: vec!["en-US".into()].into(),
            errors: Errors::default(),
            timers: Default::default(),
        };
        let made = WindowTarget {
            base: Default::default(),
            fields: Default::default(),
            time_origin,
            is_frame,
            is_disposed: false.into(),
            outside: outside.into(),
        };
        // SAFETY: `window` holds its realm, and a heap is a global object.
        let this = extend(unsafe { &*Bun__DOM__realmOfWindow(window).cast() }, made);
        js_WindowTarget::set_window(this, window);
        js_WindowTarget::set_tools(this, tools);
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

    /// What its host has handed over.
    pub(crate) fn tools(&self) -> JSValue {
        field(js_WindowTarget::tools(self))
    }

    pub(crate) fn tool(&self, name: &str) -> Option<JSValue> {
        member(global_of_cell(self), self.tools(), name)
    }

    /// <https://dom.spec.whatwg.org/#window-current-event>
    pub(crate) fn event(&self) -> JSValue {
        field(js_WindowTarget::event(self))
    }

    pub(super) fn set_event(&self, event: JSValue) {
        js_WindowTarget::set_event(self, event);
    }

    pub(crate) fn time_origin(&self) -> f64 {
        self.time_origin
    }

    /// <https://w3c.github.io/hr-time/#dfn-relative-high-resolution-coarse-time>
    pub(crate) fn coarse_time(&self, time: f64) -> f64 {
        ((time - self.time_origin) * 10.0).floor() / 10.0
    }

    pub(crate) fn host(&self) -> &Host {
        &self.outside.host
    }

    /// For what has objects in it. `None` if the host does not listen.
    pub(crate) fn ask_host(
        &self,
        _: Cx<'_, '_>,
        question: &'static str,
        values: &[JSValue],
    ) -> Option<JSValue> {
        let (realm, host) = (self.doc()?.global(), js_WindowTarget::host(self)?);
        // SAFETY: slices
        Some(unsafe {
            Bun__RealmBridge__askHost(
                realm,
                host,
                question.as_ptr(),
                question.len(),
                values.as_ptr(),
                values.len(),
            )
        })
        .filter(|it| !it.is_empty())
    }

    /// It gets handles for the objects among `values`.
    pub(crate) fn tell_inspector(&self, cx: Cx<'_, '_>, message: &'static str, values: &[JSValue]) {
        // SAFETY: a slice
        unsafe {
            Bun__RealmBridge__callHost(
                cx.global(),
                field(js_WindowTarget::host(self)),
                &bun_core::String::static_(message),
                values.as_ptr(),
                values.len(),
            )
        }
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
    }

    pub(crate) fn note_timer(&self, heap: &JsHeap<'_>, id: i32) {
        if WindowTarget::of_realm(self.realm(heap)).is_some_and(|it| core::ptr::eq(it, self)) {
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
    pending::report(cx, window, exception);
}
