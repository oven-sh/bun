//! How a window comes about, gets another document, and goes.

use bun_web::dom::Opening;
use bun_web::host::Host;
use bun_web::page::About;

use super::*;
use crate::api::events::{Event, EventInit, dispatch_for_document, fire, from_event_loop, now};
use crate::api::frames::entry::{close_frames, is_in_frame};
use crate::api::history::Context;
use crate::api::history::entry::{renewed, unload};
use crate::api::performance;
use crate::api::ui::Ui;
use crate::api::ui::entry::{attach_ui, cancel_gestures, detach_ui};
use crate::api::ui::prelude::Refs;

unsafe extern "C" {
    safe fn Bun__DOM__createOtherWindow(global: &JSGlobalObject) -> JSValue;
}

/// Above those of surfaces and workers.
#[thread_local]
static LAST_FONT_SCOPE: Cell<u32> = Cell::new(0x6000_0000);

impl Window {
    /// `global` is the global object of the realm, if the window is to be that.
    pub(crate) fn open_page<'a>(
        cx: Cx<'_, 'a>,
        it: Opening,
        global: Option<JSValue>,
    ) -> &'a Window {
        let (object, time_origin) = match global {
            Some(global) => (global, performance::navigation_start(&cx.heap)),
            None => (Bun__DOM__createOtherWindow(cx.global()), now()),
        };
        let context = Context::with_id(it.context);
        let related = context
            .filter(|_| it.has_relatives)
            .and_then(Context::agent);
        related.into_iter().for_each(|it| it.serve(&cx.heap));
        let this = WindowTarget::create(
            object,
            it.host_needs,
            it.host,
            time_origin,
            related.is_some(),
            |heap, base| js_DomWindow::create(heap, Window::new(base, it.page)),
        );
        this.font_scope.set(it.font_scope.unwrap_or(it.surface));
        context
            .into_iter()
            .for_each(|context| this.settle_in(&cx.heap, context, it.has_relatives));
        Agent::of(&cx.heap).offer_window(this);
        let base_url = it
            .about
            .base_url
            .clone()
            .filter(|_| it.about.url.starts_with("about:"));
        this.show_new_document(
            cx,
            &About {
                base_url,
                ..it.about
            },
        )
        .create_registry(&cx.heap);
        this.enlist(&cx.heap);
        match it.surface {
            0 => this.environment_changed(cx),
            surface => this.show_on(cx, surface),
        }
        this
    }

    /// For an `<iframe>` that has nothing to load.
    pub(crate) fn open_empty_frame<'a>(&'a self, _: Cx<'_, 'a>) -> &'a Window {
        LAST_FONT_SCOPE.update(|it| it + 1);
        let host = Host::of_blank_frame_in(self.host());
        let made = self.open_beside(Opening {
            font_scope: Some(LAST_FONT_SCOPE.get()),
            ..Opening::new(host, self.what_host_needs())
        });
        made.document().forbid_scripts(self.document());
        made
    }

    /// In the realm that outlives those of frames.
    pub(crate) fn open_beside(&self, mut it: Opening) -> &Window {
        let doc = self.document();
        it.about.base_url = Some(doc.base_url().to_utf8().into_owned());
        let made = bun_web::exec::with_realm(doc.agent().global(), |cx| {
            Window::open_page(cx, it, None).to_js()
        });
        // SAFETY: what has just been made.
        unsafe { Window::from_js_unchecked(made) }
    }

    /// In its realm.
    pub(crate) fn enter<R>(&self, steps: impl for<'b> FnOnce(Cx<'_, 'b>, &'b Window) -> R) -> R {
        bun_web::exec::with_realm(global_of_cell(self), |cx| {
            // SAFETY: it is one.
            steps(cx, unsafe { Window::from_js_unchecked(self.to_js()) })
        })
    }

    /// Nothing happens in a page that is gone.
    pub(crate) fn enter_as_task(&self, steps: impl for<'b> FnOnce(Cx<'_, 'b>, &'b Window, &'b Ui)) {
        from_event_loop::<Window>(global_of_cell(self), self.to_js(), |cx, window| {
            if let Some(ui) = Ui::of(window.document()) {
                steps(cx, window, ui);
            }
        });
    }

    pub(crate) fn apply_policy(&self, heap: &JsHeap<'_>, is_for_new_document: bool) {
        if self.document().has_realm(heap) {
            crate::api::trusted::apply_policy(self.realm(heap), is_for_new_document);
        }
        if self
            .document()
            .own_client(heap)
            .is_some_and(|it| it.policies().csp.restricts_style_attributes())
        {
            self.document()
                .set_doc_flags(DocFlags::CHECKS_STYLE_ATTRIBUTES, true);
        }
    }

    /// What the response asks for before there is anything in the document.
    pub(crate) fn follow_response(
        &self,
        heap: &JsHeap<'_>,
        links: &[u8],
        is_for_new_document: bool,
    ) {
        self.apply_policy(heap, is_for_new_document);
        self.document()
            .own_client(heap)
            .into_iter()
            .for_each(|it| it.follow_links(links));
    }

    fn show_new_document<'a>(&'a self, cx: Cx<'_, 'a>, about: &About) -> &'a Doc {
        let text = |it: &Option<String>| it.as_deref().map(DomString::from_utf8);
        let old = self.doc().and_then(Ui::of);
        let doc = Doc::new_for_window(cx, self.font_scope.get(), DomString::from_utf8(&about.url));
        self.show(&cx.heap, doc);
        attach_ui(cx, doc, old);
        old.into_iter().for_each(detach_ui);
        if let Some(base_url) = text(&about.base_url) {
            doc.engine(|engine, _| engine.base_url = base_url.to_utf8().as_bytes().into());
            doc.set_base_url(base_url.clone());
            doc.set_inherited_base_url(Some(base_url));
        }
        doc.set_legacy_encoding(text(&about.encoding).filter(|it| !it.eq_str("utf-8")));
        doc.set_content_type(text(&about.content_type).unwrap_or_else(|| "text/html".into()));
        doc.set_last_modified(text(&about.last_modified));
        if let Some(language) = &about.language {
            doc.engine(|engine, _| engine.set_language(language.as_bytes()));
        }
        doc
    }

    /// The first document of a window leaves it to the next one of the same origin.
    pub(crate) fn renew<'a>(&'a self, cx: Cx<'_, 'a>, about: &About) {
        let old = self.document();
        if let Some(ui) = Ui::of(old) {
            cancel_gestures(cx, ui);
            close_frames(cx, ui);
        }
        let children = Refs::collect(&cx.heap, old.children());
        replace_all(cx, None, old);
        old.leave_window();
        performance::renewed(self.realm(&cx.heap), self);
        self.show_new_document(cx, about).create_registry(&cx.heap);
        children
            .iter()
            .for_each(|it| insert(cx, it, old, None, Observers::Suppress));
        self.toggle(Is::REVEALED, false);
        renewed(self);
        self.forget_layout();
        self.show_on(cx, self.surface());
        self.follow_response(&cx.heap, &about.links, true);
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
        self.attach(
            cx,
            surface,
            !is_off
                && is_outermost
                && !Ui::of(self.document()).is_some_and(crate::api::frames::apart::is_apart),
        );
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
        let start = bun_web::time::monotonic_now();
        if self.has_listeners(atom!("unload")) {
            dispatch_for_document(
                cx,
                self,
                Event::new(self.realm(&cx.heap), atom!("unload"), EventInit::default()),
            );
        }
        doc.own_client(&cx.heap)
            .inspect(|it| it.has_unloaded(start));
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
        self.resign();
        crate::api::loading::window_has_closed(doc);
        crate::api::media::window_has_closed(doc);
        ui.into_iter().for_each(detach_ui);
    }
}
