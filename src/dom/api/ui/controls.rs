//! What the host of a page does with it.

use core::cell::Cell;

use bun_jsc::bindgen::JsList;
use bun_jsc::{JSGlobalObject, JSString};
use bun_web::dom::{Left, Opening};
use bun_web::host::{Host, Rect};
use bun_web::input::{Extent, Input};
use bun_web::net::embedder::ClientId;
use bun_web::page::{self, Order, Outcome, Query, Search, Snapshot, Swap};

use super::prelude::*;
use super::{assistive, context_menu, surface};
use crate::api::editing::{self, By, Command, spelling};
use crate::api::events::{EventInit, fire};
use crate::api::history::entry as history;
use crate::api::loading::{append_html, end_html, load_html, load_xml, parse_html};
use crate::api::markup::{Parts, Purpose, snapshot};
use crate::api::window::Window;
use crate::api::{cssom, find, forms, frames, view};
use crate::generated_bindgen::controls::*;
use crate::generated_bindgen::find::Found;
use crate::generated_bindgen::forms::HTMLInputElement;
use crate::generated_bindgen::history::NavigationType;
use crate::generated_bindgen::view::ScrollBehavior;
use crate::generated_bindgen::window::js_DomWindow;

#[thread_local]
static LAST_SHEET: Cell<u32> = Cell::new(0);

fn fire_at_window(window: &Window, name: Known) {
    window.enter_as_task(|cx, window, _| _ = fire(cx, window, name, EventInit::default()));
}

fn edit(window: &Window, command: &str) {
    let both = frames::entry::window_to_edit(window, command)
        .zip(Command::from_name(&DomString::from_utf8(command)));
    both.into_iter().for_each(|(window, command)| {
        window.enter_as_task(|cx, _, ui| {
            _ = editing::execute(cx, ui, command, &DomString::default(), By::User)
        })
    });
}

fn insert_sheet<'a>(cx: &mut Cx<'a>, window: &'a Window, css: &[u8], is_of_user: bool) -> u32 {
    LAST_SHEET.update(|it| it + 1);
    cssom::inject_sheet(
        cx,
        window.document(),
        LAST_SHEET.get(),
        Some((css, is_of_user)),
    );
    LAST_SHEET.get()
}

fn remove_sheet<'a>(cx: &mut Cx<'a>, window: &'a Window, key: u32) {
    if key > 0 {
        cssom::inject_sheet(cx, window.document(), key, None);
    }
}

fn find<'a>(cx: &mut Cx<'a>, window: &'a Window, text: &[u8], search: Search) -> Found {
    find::find_in_page(
        cx,
        window.document(),
        text,
        search.is_forward,
        search.goes_on,
        search.matches_case,
        window.zoom(),
    )
}

fn selection_text<'a>(cx: &mut Cx<'a>, window: &'a Window) -> DomString {
    Ui::of(window.document())
        .map(|it| editing::selection::text(cx, it))
        .unwrap_or_default()
}

fn follow_container(window: &Window, takes_focus: bool) {
    let Some(container) = Ui::of(window.document()).and_then(Ui::container) else {
        return;
    };
    container.give_size_to(window);
    if takes_focus && container.is_focused() {
        window.enter_as_task(|cx, window, ui| {
            surface::handle_input(cx, window, ui, Input::Focus { direction: 0 })
        });
    }
}

#[unsafe(no_mangle)]
fn __bun_dom_obey(page: u32, order: Order) {
    let Some(window) = Window::of_page(page) else {
        return;
    };
    match order {
        Order::Input { input } => {
            window.enter_as_task(|cx, window, ui| surface::handle_input(cx, window, ui, input))
        }
        Order::AbortNavigation {} => {
            window.enter_as_task(|cx, window, _| history::abort_navigation(cx, window))
        }
        Order::Activate {} => Ui::of(window.document())
            .into_iter()
            .for_each(|it| it.note_user_activation(false)),
        Order::AdjustSelection { start, end } => {
            window.enter_as_task(|cx, _, ui| _ = editing::selection::adjust(cx, ui, [start, end]))
        }
        Order::ConsumeActivation {} => window.enter(|cx, window| {
            Ui::of(window.document())
                .into_iter()
                .for_each(|it| it.forget_activation(cx))
        }),
        Order::DictionaryChanged {} => window.enter(|cx, window| {
            Ui::of(window.document())
                .into_iter()
                .for_each(|it| spelling::check_again(cx, it))
        }),
        Order::Edit { command } => edit(window, &command),
        Order::EndHtml { is_complete } => {
            window.enter_as_task(|cx, window, _| end_html(cx, window.document(), is_complete))
        }
        Order::EnvironmentChanged {} => window.enter(|cx, window| window.environment_changed(cx)),
        Order::ExitFullscreen {} => {
            window.enter_as_task(|cx, _, ui| _ = super::fullscreen::exit_fully(cx, ui))
        }
        Order::FireAtNotification { id, event } => {
            crate::api::site::fire_at_notification(id, &event)
        }
        Order::FollowContainer { takes_focus } => follow_container(window, takes_focus),
        Order::Frame { frame, news } => {
            window.enter(|cx, window| frames::entry::tell(cx, window, frame, news))
        }
        Order::InsertText { text } => window.enter_as_task(|cx, _, ui| {
            _ = editing::insert_text(
                cx,
                ui,
                &DomString::from_utf8(&text),
                atom!("insertText"),
                By::User,
            )
        }),
        Order::KeepEntries { keys } => {
            window.enter_as_task(|cx, window, _| history::keep_entries(cx, window, &keys))
        }
        Order::LoadHtml { source, goes_on } => window.enter_as_task(|cx, window, _| {
            load_html(
                cx,
                window.document(),
                &DomString::from_utf8(&source),
                goes_on,
            )
        }),
        Order::LoadXml {
            source,
            content_type,
        } => {
            window
                .document()
                .set_content_type(DomString::from_utf8(&content_type));
            window.enter_as_task(|cx, window, _| {
                load_xml(cx, window.document(), &DomString::from_utf8(&source))
            });
        }
        Order::Media { connection, line } => {
            crate::api::media::hear_from_host(connection, line.as_deref())
        }
        Order::Message {
            sender,
            origin,
            token,
            message,
        } => crate::api::history::deliver_from_afar(window, sender, origin, token, message),
        Order::Moved { position } => {
            window.enter_as_task(|cx, _, ui| frames::apart::moved(cx, ui, position))
        }
        Order::Navigate {
            wish,
            is_by_other_origin,
        } => {
            window.enter(|cx, window| history::navigate_for(cx, window, *wish, is_by_other_origin))
        }
        Order::OnlineChanged { is_online } => fire_at_window(
            window,
            if is_online {
                atom!("online")
            } else {
                atom!("offline")
            },
        ),
        Order::PopState { url, key } => window.enter_as_task(|cx, window, _| {
            history::pop_state(cx, window, &url, &key.unwrap_or_default())
        }),
        Order::PrintingChanged { is_over } => fire_at_window(
            window,
            if is_over {
                atom!("afterprint")
            } else {
                atom!("beforeprint")
            },
        ),
        Order::RemoveSheet { key } => window.enter(|cx, window| remove_sheet(cx, window, key)),
        Order::Renew { about } => window.enter(|cx, window| window.renew(cx, &about)),
        Order::ScrollVertically { top } => window.enter_as_task(|cx, window, _| {
            view::jump_viewport(cx, window.document(), [0.0, top], ScrollBehavior::Instant)
        }),
        Order::SetEncoding { name } => window
            .document()
            .set_legacy_encoding((name != "utf-8").then(|| DomString::from_utf8(&name))),
        Order::SetUrl { url } => window.set_url(DomString::from_utf8(&url)),
        Order::StayEmpty {} => window.enter(|cx, window| {
            let parsed = parse_html(cx, window.document(), &DomString::default());
            bun_web::exec::report(cx, parsed);
        }),
        Order::Stop {} => window.enter_as_task(|cx, window, _| window.stop(cx)),
        Order::StopFinding { keeps_selection } => {
            window.enter(|cx, window| find::stop_finding(cx, window.document(), keeps_selection))
        }
    }
}

fn take_snapshot<'a>(cx: &mut Cx<'a>, window: &'a Window, purpose: &page::Purpose) -> Snapshot {
    let purpose = match purpose {
        page::Purpose::Print => Purpose::Print,
        page::Purpose::Archive => Purpose::Archive,
        page::Purpose::Save(folder) => Purpose::Save(folder),
    };
    let mut parts = Parts::default();
    let markup = snapshot(cx, window.document(), window.page, purpose, &mut parts)
        .map_err(|it| bun_web::exec::report(cx, Err(it)))
        .unwrap_or_default();
    Snapshot {
        markup: markup.to_utf8().into_owned(),
        resources: parts.resources,
        frames: parts.frames,
    }
}

#[unsafe(no_mangle)]
fn __bun_dom_answer(page: u32, query: Query) -> Option<Outcome> {
    let (window, mut outcome) = (Window::of_page(page)?, None);
    match query {
        Query::AppendHtml { source } => window.enter_as_task(|cx, window, _| {
            outcome = Some(Outcome::AppendHtml(append_html(
                cx,
                window.document(),
                &DomString::from_utf8(&source),
            )))
        }),
        Query::BeforeUnload {} => {
            outcome = Some(Outcome::BeforeUnload(!window.enter(history::may_leave)))
        }
        Query::Dispose {} => window.enter(|cx, window| window.close_page(cx)),
        Query::Find { text, search } => {
            let Found {
                matches,
                active,
                rect,
            } = window.enter(|cx, window| find(cx, window, text.as_bytes(), search));
            outcome = Some(Outcome::Find(page::Found {
                matches,
                active,
                area: Rect {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                },
            }));
        }
        Query::FocusedFrame {} => {
            outcome = Some(Outcome::FocusedFrame(frames::entry::focused_frame(window)))
        }
        Query::HitInfo { x, y } => {
            let menu = window.enter(|cx, window| {
                Some(Box::new(context_menu::describe_point(
                    cx,
                    Ui::of(window.document())?,
                    [x, y].map(|it| it / window.zoom()),
                )))
            });
            outcome = Some(Outcome::HitInfo(menu));
        }
        Query::InsertSheet { css, is_of_user } => {
            outcome = Some(Outcome::InsertSheet(window.enter(|cx, window| {
                insert_sheet(cx, window, css.as_bytes(), is_of_user)
            })))
        }
        Query::Render {} => window.enter_as_task(|cx, window, ui| {
            surface::handle_input(cx, window, ui, Input::Frame { is_urgent: true })
        }),
        Query::SelectionText {} => {
            outcome =
                Some(Outcome::SelectionText(window.enter(|cx, window| {
                    selection_text(cx, window).to_utf8().into_owned()
                })))
        }
        Query::Snapshot { purpose } => {
            outcome = Some(Outcome::Snapshot(
                window.enter(|cx, window| take_snapshot(cx, window, &purpose)),
            ))
        }
        Query::WillSwap { how, to } => {
            let how = match how {
                Swap::Push => NavigationType::Push,
                Swap::Replace => NavigationType::Replace,
                Swap::Reload => NavigationType::Reload,
                Swap::Traverse => NavigationType::Traverse,
            };
            window.enter_as_task(|cx, window, _| {
                outcome = Some(Outcome::WillSwap(history::will_swap(
                    cx,
                    window,
                    how,
                    to.map(|it| *it),
                )))
            });
        }
        Query::WillTraverse {
            key,
            is_by_user,
            ticket,
        } => {
            outcome = Some(Outcome::WillTraverse(true));
            window.enter_as_task(|cx, window, _| {
                outcome = Some(Outcome::WillTraverse(history::will_traverse(
                    cx, window, &key, is_by_user, ticket,
                )))
            });
        }
    }
    outcome
}

// ───────────────────────────── in the same process ─────────────────────────────

#[derive(Default)]
pub(crate) struct PageControls(bindgen::Interior);

fn create_controls<'a>(heap: &JsHeap<'a>, window: &'a Window) -> &'a PageControls {
    let this = js_PageControls::create(window.realm(heap), PageControls::default());
    js_PageControls::set_window(this, Some(window));
    this
}

pub(crate) fn create_page<'a>(cx: &mut Cx<'a>, it: &PageForTests) -> &'a PageControls {
    let window = Window::open_page(
        cx,
        Opening {
            surface: it.surface,
            font_scope: it.font_scope,
            ..Opening::new(Host::nobody(), JSValue::UNDEFINED)
        },
        None,
    );
    create_controls(&cx.heap, window)
}

#[unsafe(no_mangle)]
fn __bun_dom_open_page(
    realm: &JSGlobalObject,
    opening: Opening,
    global: Option<JSValue>,
) -> JSValue {
    bun_web::exec::with_realm(realm, |cx| {
        let window = Window::open_page(cx, opening, global);
        create_controls(&cx.heap, window).to_js()
    })
}

#[unsafe(no_mangle)]
fn __bun_dom_open_page_beside(opener: u32, opening: Opening, client: ClientId) -> Option<JSValue> {
    let (heap, opener) = (
        JsHeap::from_global(bun_ui::main_global()),
        Window::of_page(opener)?,
    );
    let window = opener.open_beside(opening);
    js_DomWindow::set_opened_beside(window, opener.to_js());
    crate::api::loading::for_host::lend_client(heap, window.document(), client, opener.document());
    Some(create_controls(heap, window).to_js())
}

#[unsafe(no_mangle)]
fn __bun_dom_follow_response(page: u32, links: &[u8]) {
    Window::of_page(page).into_iter().for_each(|it| {
        it.follow_response(JsHeap::from_global(bun_ui::main_global()), links, false)
    });
}

#[unsafe(no_mangle)]
fn __bun_dom_window_of(controls: JSValue) -> JSValue {
    PageControls::from_value(controls).map_or(JSValue::UNDEFINED, PageControls::get_window)
}

#[unsafe(no_mangle)]
fn __bun_dom_leave_relatives(controls: JSValue) -> Left {
    PageControls::from_value(controls)
        .map(|it| it.window().leave_cluster())
        .unwrap_or_default()
}

impl PageControls {
    fn window(&self) -> &Window {
        js_PageControls::window(self).expect("it is set")
    }

    fn doc(&self) -> &Doc {
        self.window().document()
    }

    pub(crate) fn get_id(&self) -> u32 {
        self.window().page
    }

    pub(crate) fn resize(&self, _: &mut Cx<'_>, width: f64, height: f64, scale: f64) {
        self.window().enter_as_task(|cx, window, ui| {
            surface::handle_input(
                cx,
                window,
                ui,
                Input::Resize {
                    extent: Extent {
                        size: [width, height],
                        scale,
                    },
                    is_quiet: false,
                },
            )
        });
    }

    pub(crate) fn render(&self, _: &mut Cx<'_>) {
        self.window()
            .enter_as_task(|cx, window, _| window.render_in_container(cx));
    }

    pub(crate) fn environment_changed<'a>(&'a self, cx: &mut Cx<'a>) {
        self.window().environment_changed(cx);
    }

    pub(crate) fn get_window(&self) -> JSValue {
        self.window().window()
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
    ) -> bindgen::Result<'a, ()> {
        let source = DomString::from_js_string(&cx.heap, source)?;
        self.window()
            .enter_as_task(|cx, window, _| load_html(cx, window.document(), &source, false));
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

    pub(crate) fn flush_canvases<'a>(&'a self, cx: &mut Cx<'a>) {
        crate::api::canvas::present_canvases(cx);
    }

    pub(crate) fn attach<'a>(&'a self, cx: &mut Cx<'a>, surface: u32) {
        self.window().show_on(cx, surface);
    }

    pub(crate) fn dispose<'a>(&'a self, cx: &mut Cx<'a>) {
        self.window().close_page(cx);
    }

    pub(crate) fn set_url(&self, url: DomString) {
        self.window().set_url(url);
    }

    pub(crate) fn select_frame<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        selector: JsLocal<'a, JSString>,
    ) -> bindgen::Result<'a, u32> {
        Ok(self
            .doc()
            .query_selector(cx, selector)?
            .and_then(frames::entry::page_in)
            .unwrap_or_default())
    }

    pub(crate) fn edit(&self, _: &mut Cx<'_>, name: &[u8]) {
        edit(self.window(), crate::values::text(name));
    }

    pub(crate) fn insert_css<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        css: &[u8],
        is_of_user: bool,
    ) -> Vec<u8> {
        insert_sheet(cx, self.window(), css, is_of_user)
            .to_string()
            .into_bytes()
    }

    pub(crate) fn remove_inserted_css<'a>(&'a self, cx: &mut Cx<'a>, key: u32) {
        remove_sheet(cx, self.window(), key);
    }

    pub(crate) fn find<'a>(&'a self, cx: &mut Cx<'a>, text: &[u8], options: &FindOptions) -> Found {
        find(
            cx,
            self.window(),
            text,
            Search {
                is_forward: options.forward,
                goes_on: options.find_next,
                matches_case: options.match_case,
            },
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
        Ui::of(self.doc())
            .map(|it| assistive::inspect_accessibility(cx, it))
            .unwrap_or_default()
    }

    pub(crate) fn selection_text<'a>(&'a self, cx: &mut Cx<'a>) -> DomString {
        selection_text(cx, self.window())
    }
}
