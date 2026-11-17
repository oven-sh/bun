//! How a window comes about, gets another document, and goes.

use super::*;
use crate::api::core::by_name::member;
use crate::api::events::{Event, EventInit, dispatch_for_document, fire, now};
use crate::api::frames::entry::{close_frames, is_in_frame};
use crate::api::history::entry::{renewed, unload};
use crate::api::ui::Ui;
use crate::api::ui::entry::{attach_ui, cancel_gestures, detach_ui};
use crate::api::ui::prelude::Refs;

unsafe extern "C" {
    safe fn Bun__DOM__createOtherWindow(global: &JSGlobalObject) -> JSValue;
}

/// Above those of surfaces and workers.
#[thread_local]
static LAST_FONT_SCOPE: Cell<u32> = Cell::new(0x6000_0000);

/// Where the scripts of a window run.
#[derive(Clone, Copy)]
pub(crate) enum Home<'a> {
    /// It is the global object. The agent is that of other windows of its origin.
    OwnRealm(JSValue, Option<&'a Agent>),
    SharedRealm,
}

impl Window {
    /// `tools` is what its host has handed over.
    pub(crate) fn open_page<'a>(
        cx: Cx<'_, 'a>,
        tools: JSValue,
        home: Home<'a>,
        base_url: Option<DomString>,
    ) -> &'a Window {
        let (object, related) = match home {
            Home::OwnRealm(global, related) => (global, related),
            Home::SharedRealm => (Bun__DOM__createOtherWindow(cx.global()), None),
        };
        related.into_iter().for_each(|it| it.serve(&cx.heap));
        let link = member(cx.global(), tools, "link").unwrap_or(tools);
        let this = WindowTarget::create(
            &cx.heap,
            object,
            [tools, link],
            now(),
            related.is_some(),
            |heap, base| js_DomWindow::create(heap, Window::new(base)),
        );
        let [surface, font_scope] =
            ["surface", "fontScope"].map(|it| this.tool(it).map(|it| it.as_number() as u32));
        this.font_scope
            .set(font_scope.or(surface).unwrap_or_default());
        Agent::of(&cx.heap).offer_window(this);
        let url = this
            .text_of_tool(cx, "url")
            .unwrap_or_else(|| "about:blank".into());
        let base_url = base_url.filter(|_| url.to_utf8().starts_with("about:"));
        this.show_new_document(cx, url, base_url)
            .create_registry(&cx.heap);
        match surface.unwrap_or_default() {
            0 => this.environment_changed(cx),
            surface => this.show_on(cx, surface),
        }
        this
    }

    /// For an `<iframe>` that has nothing to load.
    pub(crate) fn open_empty_frame<'a>(&'a self, cx: Cx<'_, 'a>) -> &'a Window {
        let tools = JSValue::create_empty_object_with_null_prototype(cx.global());
        for (name, from) in [
            ("link", "linkOfBlankFrames"),
            ("linkOfBlankFrames", "linkOfBlankFrames"),
        ] {
            self.tool(from)
                .into_iter()
                .for_each(|it| tools.put(cx.global(), name.as_bytes(), it));
        }
        LAST_FONT_SCOPE.update(|it| it + 1);
        tools.put(cx.global(), b"fontScope", LAST_FONT_SCOPE.get().into());
        let made = self.open_beside(tools);
        made.document().forbid_scripts(self.document());
        made
    }

    /// In the realm that outlives those of frames.
    pub(crate) fn open_beside(&self, tools: JSValue) -> &Window {
        let doc = self.document();
        let made = bun_web::exec::with_realm(doc.agent().global(), |cx| {
            Window::open_page(cx, tools, Home::SharedRealm, Some(doc.base_url())).to_js()
        });
        // SAFETY: what has just been made.
        unsafe { Window::from_js_unchecked(made) }
    }

    fn text_of_tool<'a>(&'a self, cx: Cx<'_, 'a>, name: &str) -> Option<DomString> {
        DomString::from_js_string(
            &cx.heap,
            JsLocal::new(&cx.heap, self.tool(name)?).as_string()?,
        )
        .ok()
    }

    fn show_new_document<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        url: DomString,
        base_url: Option<DomString>,
    ) -> &'a Doc {
        let old = self.doc().and_then(Ui::of);
        let doc = Doc::new_for_window(cx, self.font_scope.get(), url);
        self.show(&cx.heap, doc);
        attach_ui(cx, doc, old);
        old.into_iter().for_each(detach_ui);
        if let Some(base_url) = base_url {
            doc.engine(|engine, _| engine.base_url = base_url.to_utf8().as_bytes().into());
            doc.set_base_url(base_url.clone());
            doc.set_inherited_base_url(Some(base_url));
        }
        doc.set_legacy_encoding(
            self.text_of_tool(cx, "encoding")
                .filter(|it| !it.eq_str("utf-8")),
        );
        doc.set_content_type(
            self.text_of_tool(cx, "contentType")
                .unwrap_or_else(|| "text/html".into()),
        );
        doc.set_last_modified(self.text_of_tool(cx, "lastModified"));
        if let Some(language) = self.text_of_tool(cx, "language") {
            doc.engine(|engine, _| engine.set_language(language.to_utf8().as_bytes()));
        }
        doc
    }

    pub(crate) fn about_changed(&self, heap: &JsHeap<'_>, about: JSValue) {
        for name in ["encoding", "contentType", "lastModified", "language"] {
            self.tools().put(
                global_of(heap),
                name.as_bytes(),
                member(global_of(heap), about, name).unwrap_or(JSValue::UNDEFINED),
            );
        }
    }

    /// The first document of a window leaves it to the next one of the same origin.
    pub(crate) fn renew<'a>(&'a self, cx: Cx<'_, 'a>, url: DomString, base_url: Option<DomString>) {
        let old = self.document();
        if let Some(ui) = Ui::of(old) {
            cancel_gestures(cx, ui);
            close_frames(cx, ui);
        }
        let children = Refs::collect(&cx.heap, old.children());
        replace_all(cx, None, old);
        old.leave_window();
        self.show_new_document(cx, url, base_url)
            .create_registry(&cx.heap);
        children
            .iter()
            .for_each(|it| insert(cx, it, old, None, Observers::Suppress));
        self.toggle(Is::REVEALED, false);
        renewed(self);
        self.forget_layout();
        self.show_on(cx, self.surface());
    }

    pub(crate) fn show_on<'a>(&'a self, cx: Cx<'_, 'a>, surface: u32) {
        let is_off = bun_ui::is_headless(bun_ui::main_global()).unwrap_or(true);
        let is_outermost = !Ui::of(self.document()).is_some_and(is_in_frame);
        if is_outermost {
            bun_ui::surfaces::send_frames_to(
                cx.global(),
                surface,
                self.to_js(),
                super::rendering::display_wants_frame,
            );
        }
        self.attach(cx, surface, !is_off && is_outermost);
    }

    pub(crate) fn set_url(&self, url: DomString) {
        let doc = self.document();
        doc.engine(|engine, _| engine.base_url = url.to_utf8().as_bytes().into());
        doc.set_base_url(url.clone());
        doc.set_url(url);
    }

    pub(crate) fn close_page<'a>(&'a self, cx: Cx<'_, 'a>) {
        if self.is_disposed() {
            return;
        }
        unload(cx, self);
        let doc = self.document();
        if self.is(Is::VISIBLE) {
            self.toggle(Is::VISIBLE, false);
            fire(
                cx,
                doc,
                atom!("visibilitychange"),
                EventInit {
                    bubbles: true,
                    ..Default::default()
                },
            );
        }
        if self.has_listeners(atom!("unload")) {
            dispatch_for_document(
                cx,
                self,
                Event::new(self.realm(&cx.heap), atom!("unload"), EventInit::default()),
            );
        }
        let ui = Ui::of(doc);
        if let Some(ui) = ui {
            cancel_gestures(cx, ui);
            close_frames(cx, ui);
        }
        crate::api::images::dispose_pictures(cx, doc);
        if let Some(library) = bun_ui::loaded() {
            (library.drop_font_scope)(self.font_scope.get());
        }
        self.stop_rendering(&cx.heap);
        bun_ui::surfaces::send_no_frames_to(self.to_js());
        self.dispose();
        crate::api::loading::window_has_closed(doc);
        crate::api::media::window_has_closed(doc);
        ui.into_iter().for_each(detach_ui);
    }
}
