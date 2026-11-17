//! What the host of a page does with it.

use core::cell::Cell;

use bun_jsc::bindgen::{Callable, JsList};
use bun_jsc::{JSGlobalObject, JSObject, JSString};

use super::prelude::*;
use super::{assistive, context_menu, surface};
use crate::api::core::Agent;
use crate::api::editing::{self, By, Command, spelling};
use crate::api::events::{EventInit, fire, from_event_loop};
use crate::api::history::{ForeignWindow, entry as history};
use crate::api::loading::{append_html, came_with, end_html, load_html, load_xml, parse_html};
use crate::api::window::Window;
use crate::api::window::page::Home;
use crate::api::{cssom, find, forms, frames};
use crate::generated_bindgen::controls::*;
use crate::generated_bindgen::find::Found;
use crate::generated_bindgen::forms::HTMLInputElement;
use crate::generated_bindgen::history::{NavigateRequest, NavigationType};

#[derive(Default)]
pub(crate) struct PageControls(bindgen::Interior);

#[thread_local]
static LAST_SHEET: Cell<u32> = Cell::new(0);

pub(crate) fn create_page<'a>(cx: &mut Cx<'a>, tools: JsLocal<'a, JSObject>) -> &'a PageControls {
    let window = Window::open_page(cx, tools.to_js(), Home::SharedRealm, None);
    create_controls(&cx.heap, window)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__createPage(
    global: &JSGlobalObject,
    tools: JSValue,
    window: JSValue,
    base_url: JSValue,
    related: JSValue,
) -> JSValue {
    bun_web::exec::with_realm(global, |cx| {
        let home = if window.is_object() {
            Home::OwnRealm(window, Agent::from_js(&cx.heap, related))
        } else {
            Home::SharedRealm
        };
        let base_url = JsLocal::new(&cx.heap, base_url)
            .as_string()
            .and_then(|it| DomString::from_js_string(&cx.heap, it).ok());
        let window = Window::open_page(cx, tools, home, base_url);
        create_controls(&cx.heap, window).to_js()
    })
}

pub(crate) fn create_controls<'a>(heap: &JsHeap<'a>, window: &'a Window) -> &'a PageControls {
    let this = js_PageControls::create(window.realm(heap), PageControls::default());
    js_PageControls::set_window(this, Some(window));
    this
}

impl PageControls {
    fn window(&self) -> &Window {
        js_PageControls::window(self).expect("it is set")
    }

    fn doc(&self) -> &Doc {
        self.window().document()
    }

    fn ui(&self) -> Option<&Ui> {
        Ui::of(self.doc())
    }

    /// Nothing happens in a page that is gone.
    fn in_task<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        steps: &mut dyn for<'b> FnMut(&mut Cx<'b>, &'b Window, &'b Ui),
    ) {
        from_event_loop::<Window>(cx.global(), self.window().to_js(), |cx, window| {
            Ui::of(window.document())
                .into_iter()
                .for_each(|ui| steps(cx, window, ui))
        });
    }

    pub(crate) fn handle_event<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        event: JsLocal<'a, JSObject>,
    ) -> bindgen::Result<'a, ()> {
        let (event, kind) = (
            event.to_js(),
            NativeEvent::from_js(cx.global(), event.to_js())?.t,
        );
        self.in_task(cx, &mut |cx, window, ui| {
            surface::handle_event(cx, window, ui, kind, event)
        });
        Ok(())
    }

    pub(crate) fn render<'a>(&'a self, cx: &mut Cx<'a>) {
        self.in_task(cx, &mut |cx, window, _| window.render_in_container(cx));
    }

    pub(crate) fn environment_changed<'a>(&'a self, cx: &mut Cx<'a>) {
        self.window().environment_changed(cx);
    }

    pub(crate) fn online_changed<'a>(&'a self, cx: &mut Cx<'a>, is_online: bool) {
        self.in_task(cx, &mut |cx, window, _| {
            _ = fire(
                cx,
                window,
                if is_online {
                    atom!("online")
                } else {
                    atom!("offline")
                },
                EventInit::default(),
            )
        });
    }

    pub(crate) fn get_window(&self) -> JSValue {
        self.window().window()
    }

    pub(crate) fn current_window(&self) -> JSValue {
        self.get_window()
    }

    pub(crate) fn get_document(&self) -> &Doc {
        self.doc()
    }

    pub(crate) fn current_document(&self) -> &Doc {
        self.doc()
    }

    pub(crate) fn ready_state(&self) -> Atom {
        self.doc().ready_state().name()
    }

    pub(crate) fn load_html<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        source: JsLocal<'a, JSString>,
        goes_on: bool,
    ) -> bindgen::Result<'a, ()> {
        let source = DomString::from_js_string(&cx.heap, source)?;
        self.in_task(cx, &mut |cx, window, _| {
            load_html(cx, window.document(), &source, goes_on)
        });
        Ok(())
    }

    pub(crate) fn append_html<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        source: JsLocal<'a, JSString>,
    ) -> bindgen::Result<'a, bool> {
        let (source, mut is_wanted) = (DomString::from_js_string(&cx.heap, source)?, false);
        self.in_task(cx, &mut |cx, window, _| {
            is_wanted = append_html(cx, window.document(), &source)
        });
        Ok(is_wanted)
    }

    pub(crate) fn set_encoding(&self, name: DomString) {
        self.window()
            .document()
            .set_legacy_encoding(Some(name).filter(|it| !it.eq_str("utf-8")));
    }

    pub(crate) fn end_html<'a>(&'a self, cx: &mut Cx<'a>, is_complete: bool) {
        self.in_task(cx, &mut |cx, window, _| {
            end_html(cx, window.document(), is_complete)
        });
    }

    pub(crate) fn load_xml<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        source: JsLocal<'a, JSString>,
        content_type: DomString,
    ) -> bindgen::Result<'a, ()> {
        let source = DomString::from_js_string(&cx.heap, source)?;
        self.doc().set_content_type(content_type);
        self.in_task(cx, &mut |cx, window, _| {
            load_xml(cx, window.document(), &source)
        });
        Ok(())
    }

    pub(crate) fn confine(&self) {
        self.doc().confine();
    }

    pub(crate) fn parse_html<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        source: JsLocal<'a, JSString>,
    ) -> bindgen::Result<'a, ()> {
        DomString::from_js_string(&cx.heap, source).and_then(|it| parse_html(cx, self.doc(), &it))
    }

    pub(crate) fn came_with<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        script: JsLocal<'a, JSString>,
    ) -> bindgen::Result<'a, bool> {
        DomString::from_js_string(&cx.heap, script).map(|it| came_with(cx, self.doc(), &it))
    }

    pub(crate) fn flush_canvases<'a>(&'a self, cx: &mut Cx<'a>) {
        crate::api::canvas::present_canvases(cx);
    }

    pub(crate) fn attach<'a>(&'a self, cx: &mut Cx<'a>, surface: u32) {
        self.window().show_on(cx, surface);
    }

    pub(crate) fn dispose<'a>(&'a self, cx: &mut Cx<'a>) {
        self.window().close_page(cx);
    }

    pub(crate) fn renew<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        url: DomString,
        base_url: Option<DomString>,
    ) {
        self.window().renew(cx, url, base_url);
    }

    pub(crate) fn about_changed<'a>(&'a self, heap: &JsHeap<'a>, about: JsLocal<'a, JSObject>) {
        self.window().about_changed(heap, about.to_js());
    }

    pub(crate) fn set_url(&self, url: DomString) {
        self.window().set_url(url);
    }

    pub(crate) fn shared(&self) -> &Agent {
        self.doc().agent()
    }

    pub(crate) fn base_url(&self) -> DomString {
        self.doc().base_url()
    }

    pub(crate) fn check_style_attributes(&self) {
        self.doc()
            .set_doc_flags(DocFlags::CHECKS_STYLE_ATTRIBUTES, true);
    }

    pub(crate) fn is_active(&self) -> bool {
        self.ui().is_some_and(Ui::has_transient_activation)
    }

    pub(crate) fn has_been_active(&self) -> bool {
        self.ui()
            .is_some_and(|it| it.activation.has_been_active.get())
    }

    pub(crate) fn frames<'a>(&'a self, cx: &mut Cx<'a>) -> Vec<JSValue> {
        self.ui()
            .map(|it| frames::entry::contexts_of_local_frames(cx, it))
            .unwrap_or_default()
    }

    pub(crate) fn focused_frame<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        self.ui()
            .and_then(|it| {
                frames::entry::tell_focused_frame(cx, it, "focusedFrame", JSValue::UNDEFINED)
            })
            .unwrap_or(JSValue::UNDEFINED)
    }

    // ───────────────────────────── history ─────────────────────────────

    pub(crate) fn navigate<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        url: &[u8],
        request: &NavigateRequest<'a>,
        initiator: JsLocal<'a, JSObject>,
        origin: &[u8],
    ) {
        history::navigate_for(cx, self.window(), url, request, initiator, origin);
    }

    pub(crate) fn cross_origin_window<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        peer: JsLocal<'a, JSObject>,
        existing: JsLocal<'a>,
    ) -> JSValue {
        ForeignWindow::in_this_process(heap, self.window(), peer.to_js(), existing.to_js())
    }

    pub(crate) fn remote_window<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        peer: JsLocal<'a, JSObject>,
    ) -> JSValue {
        ForeignWindow::of_popup(cx, self.window(), peer.to_js())
    }

    pub(crate) fn pop_state<'a>(&'a self, cx: &mut Cx<'a>, url: &[u8], key: Option<&[u8]>) {
        self.in_task(cx, &mut |cx, window, _| {
            history::pop_state(cx, window, url, key)
        });
    }

    pub(crate) fn will_traverse<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        key: Option<&[u8]>,
        is_by_user: bool,
        proceed: JsLocal<'a, Callable>,
    ) -> bool {
        let (proceed, mut goes) = (proceed.to_js(), true);
        self.in_task(cx, &mut |cx, window, _| {
            goes = history::will_traverse(cx, window, key, is_by_user, proceed)
        });
        goes
    }

    pub(crate) fn keep_entries<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        keys: &[bun_core::Utf8Bytes<'static>],
    ) {
        self.in_task(cx, &mut |cx, window, _| {
            history::keep_entries(cx, window, keys)
        });
    }

    pub(crate) fn abort_navigation<'a>(&'a self, cx: &mut Cx<'a>) {
        self.in_task(cx, &mut |cx, window, _| {
            history::abort_navigation(cx, window)
        });
    }

    pub(crate) fn stop<'a>(&'a self, cx: &mut Cx<'a>) {
        self.in_task(cx, &mut |cx, window, _| window.stop(cx));
    }

    pub(crate) fn will_swap<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        kind: NavigationType,
        to: JsLocal<'a>,
    ) -> u32 {
        let (to, mut ticket) = (to.to_js(), 0);
        self.in_task(cx, &mut |cx, window, _| {
            ticket = history::will_swap(cx, window, kind, to)
        });
        ticket
    }

    pub(crate) fn before_unload<'a>(&'a self, cx: &mut Cx<'a>) -> bool {
        history::may_leave(cx, self.window())
    }

    // ───────────────────────────── what is in it ─────────────────────────────

    pub(crate) fn edit<'a>(&'a self, cx: &mut Cx<'a>, name: &DomString) {
        let given = name.to_js(&cx.heap).to_js();
        if self
            .ui()
            .and_then(|it| frames::entry::tell_focused_frame(cx, it, "edit", given))
            .is_none()
        {
            self.in_task(cx, &mut |cx, _, ui| {
                _ = Command::from_name(name)
                    .map(|it| editing::execute(cx, ui, it, &DomString::default(), By::User))
            });
        }
    }

    pub(crate) fn insert_text<'a>(&'a self, cx: &mut Cx<'a>, text: &DomString) {
        self.in_task(cx, &mut |cx, _, ui| {
            _ = editing::insert_text(cx, ui, text, atom!("insertText"), By::User)
        });
    }

    pub(crate) fn dictionary_changed<'a>(&'a self, cx: &mut Cx<'a>) {
        self.ui()
            .into_iter()
            .for_each(|it| spelling::check_again(cx, it));
    }

    pub(crate) fn insert_css<'a>(&'a self, cx: &mut Cx<'a>, css: &[u8]) -> Vec<u8> {
        LAST_SHEET.update(|it| it + 1);
        cssom::inject_sheet(cx, self.doc(), LAST_SHEET.get(), Some(css));
        LAST_SHEET.get().to_string().into_bytes()
    }

    pub(crate) fn remove_inserted_css<'a>(&'a self, cx: &mut Cx<'a>, key: u32) {
        if key > 0 {
            cssom::inject_sheet(cx, self.doc(), key, None);
        }
    }

    pub(crate) fn find<'a>(&'a self, cx: &mut Cx<'a>, text: &[u8], options: &FindOptions) -> Found {
        find::find_in_page(
            cx,
            self.doc(),
            text,
            options.forward,
            options.find_next,
            options.match_case,
            self.window().zoom(),
        )
    }

    pub(crate) fn stop_find<'a>(&'a self, cx: &mut Cx<'a>, action: &[u8]) {
        find::stop_finding(cx, self.doc(), action != b"clearSelection");
    }

    pub(crate) fn choose_files<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        input: &'a HTMLInputElement,
        chosen: JsList<'a, JsLocal<'a>>,
    ) {
        forms::entry::files_picked(cx, input, chosen);
    }

    pub(crate) fn describe_for_accessibility<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        node: &'a Node,
    ) -> bindgen::Result<'a, JSValue> {
        let [role, name] = assistive::computed_role_and_name(cx, node);
        let global = cx.global();
        Ok(bun_ui::object!(global, { "role": role, "name": name }))
    }

    pub(crate) fn accessibility_tree<'a>(&'a self, cx: &mut Cx<'a>) -> Vec<u8> {
        self.ui()
            .map(|it| assistive::inspect_accessibility(cx, it))
            .unwrap_or_default()
    }

    pub(crate) fn selection_text<'a>(&'a self, cx: &mut Cx<'a>) -> DomString {
        self.ui()
            .map(|it| editing::selection::text(cx, it))
            .unwrap_or_default()
    }

    pub(crate) fn hit_info<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        x: f64,
        y: f64,
    ) -> bindgen::Result<'a, JSValue> {
        let Some(ui) = self.ui() else {
            return Ok(JSValue::UNDEFINED);
        };
        let menu = Box::new(context_menu::describe_point(
            cx,
            ui,
            [x, y].map(|it| it / self.window().zoom()),
        ));
        Ok(bun_ui::value::IntoJs::into_js(menu, cx.global())?)
    }
}
