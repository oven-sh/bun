//! <https://html.spec.whatwg.org/#navigation-and-session-history>, as far as it is up to a document.

mod context;
pub(crate) mod entry;
mod events;
mod foreign;
mod forms;
mod fragment;
mod host;
mod lifecycle;
mod location;
mod navigate;
mod navigation;
mod relatives;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_core::strings;
use bun_web::host::{HistoryChange, HistoryEntry, Serialized};
use bun_web::url::Url;

use crate::api::events::{
    Event, EventInit, HashChangeEvent, PopStateEvent, Trusted, dispatch, swap_top_level,
};
use crate::api::ui::prelude::*;
use crate::api::view;
use crate::api::window::Window;
use crate::generated_bindgen::history::*;
use crate::generated_bindgen::view::ScrollBehavior;
use crate::generated_bindgen::window::js_DomWindow;

pub(crate) use self::context::{Cluster, Context};
pub(crate) use self::events::*;
pub(crate) use self::foreign::{ForeignLocation, ForeignWindow, deliver_from_afar};
pub(crate) use self::forms::{Submission, encoding_of_form, plan_form_navigation};
pub(crate) use self::fragment::{
    has_target, indicate_text, indicated_element, targets_may_have_moved,
};
pub(crate) use self::location::Location;
pub(crate) use self::navigate::{LINK_STEPS, target_of_base};
pub(crate) use self::navigation::*;
pub(crate) use lifecycle::refresh_by_meta;

type Result<'a, T = ()> = bindgen::Result<'a, T>;
type Entry = Rc<RefCell<HistoryEntry>>;

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub(crate) struct Phase: u8 {
        const COMPLETELY_LOADED = 1;
        const UNLOADING = 1 << 1;
        const ABOUT_TO_SUBMIT = 1 << 2;
        /// The URL has got it without a navigation.
        const IGNORES_FRAGMENT = 1 << 3;
        const HAS_SHOWN_FRAGMENT = 1 << 4;
    }
}

impl Window {
    fn is_in(&self, phase: Phase) -> bool {
        self.phase.get().contains(phase)
    }

    fn set_phase(&self, phase: Phase, on: bool) {
        self.phase
            .update(|it| if on { it | phase } else { it - phase });
    }

    pub(crate) fn is_unloading(&self) -> bool {
        self.is_in(Phase::UNLOADING)
    }

    fn url(&self) -> String {
        self.document().url().to_utf8().into_owned()
    }

    fn has_activation(&self) -> bool {
        Ui::of(self.document()).is_some_and(Ui::has_transient_activation)
    }

    fn consume_activation<'a>(&'a self, cx: &mut Cx<'a>) -> bool {
        Ui::of(self.document()).is_some_and(|it| it.consume_activation(cx))
    }

    fn resolve<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString) -> Option<String> {
        Some(
            self.document()
                .parse_url(cx, url)?
                .href()
                .to_utf8()
                .into_owned(),
        )
    }

    /// Unless nothing has needed it.
    fn history_if_any(&self) -> Option<&History> {
        js_DomWindow::history(self).filter(|it| !it.entries.borrow().is_empty())
    }

    fn navigation(&self) -> Option<&Navigation> {
        js_DomWindow::navigation(self)
    }

    pub(crate) fn get_history<'a>(&'a self, heap: &JsHeap<'a>) -> &'a History {
        History::of(heap, self)
    }

    pub(crate) fn get_location<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Location {
        js_DomWindow::location(self).unwrap_or_else(|| {
            let location = Location::new(heap, self);
            js_DomWindow::set_location(self, Some(location));
            location
        })
    }

    pub(crate) fn get_navigation<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Navigation {
        self.navigation().unwrap_or_else(|| {
            let navigation = Navigation::new(heap, History::of(heap, self));
            js_DomWindow::set_navigation(self, Some(navigation));
            navigation
        })
    }
}

fn lossy(bytes: &[u8]) -> String {
    bun_ui::protocol::Text::lossy(bytes).into_string()
}

fn split_fragment(url: &str) -> (&str, Option<&str>) {
    match strings::index_of_char_usize(url.as_bytes(), b'#') {
        Some(at) => (&url[..at], Some(&url[at + 1..])),
        None => (url, None),
    }
}

fn differ_in_fragment_only(a: &str, b: &str) -> bool {
    let (a, b) = (split_fragment(a), split_fragment(b));
    a.0 == b.0 && a.1 != b.1
}

fn serialize<'a>(cx: &mut Cx<'a>, value: JsLocal<'a>) -> Result<'a, Serialized> {
    Ok(Serialized(
        value
            .to_js()
            .serialize(
                cx.global(),
                bun_jsc::SerializedFlags {
                    for_cross_process_transfer: false,
                    for_storage: true,
                },
            )?
            .data()
            .into(),
    ))
}

fn deserialize<'a>(
    heap: &JsHeap<'a>,
    window: &Window,
    stored: Option<Serialized>,
) -> Result<'a, JSValue> {
    Ok(stored.map_or(Ok(JSValue::UNDEFINED), |it| {
        JSValue::deserialize(&it.0, global_of(window.realm(heap)))
    })?)
}

/// No microtasks run before the caller is done.
fn dispatch_now<'a>(cx: &mut Cx<'a>, target: &'a EventTarget, event: &'a Event) -> bool {
    let was_at_top_level = swap_top_level(false);
    let proceeds = dispatch(cx, target, event);
    swap_top_level(was_at_top_level);
    proceeds
}

fn new_id() -> String {
    bun_jsc::virtual_machine::VirtualMachine::get()
        .rare_data()
        .next_uuid()
        .to_string()
}

/// It gets the names that it lacks.
fn named(mut entry: HistoryEntry) -> Entry {
    [&mut entry.key, &mut entry.id]
        .into_iter()
        .filter(|it| it.is_empty())
        .for_each(|it| *it = new_id());
    Rc::new(entry.into())
}

fn queue_task<'a, const N: usize>(
    window: &'a Window,
    values: [JSValue; N],
    steps: impl for<'b> FnOnce(&mut Cx<'b>, &'b Window, [JSValue; N]) + 'static,
) {
    let all: smallvec::SmallVec<[JSValue; 4]> =
        [window.to_js()].into_iter().chain(values).collect();
    crate::api::on_behalf::queue_task(window.document(), &all, |cx, all| {
        if let Some(window) = Window::from_value(all[0]) {
            steps(cx, window, core::array::from_fn(|at| all[at + 1]));
        }
        Ok(())
    });
}

/// <https://html.spec.whatwg.org/#can-have-its-url-rewritten>
fn can_rewrite_url(window: &Window, url: &str) -> bool {
    let (Some(url), Some(current)) = (
        Url::parse(url.as_bytes()),
        Url::parse(window.url().as_bytes()),
    ) else {
        return false;
    };
    if [Url::scheme, Url::username, Url::password, Url::host]
        .iter()
        .any(|part| part(&url) != part(&current))
    {
        return false;
    }
    let is_file = url.scheme() == b"file";
    !is_file && !url.host().is_empty() && !window.has_opaque_origin()
        || url.path() == current.path() && (is_file || url.search() == current.search())
}

enum Traversal {
    /// It goes on when it gets the ticket back.
    ByHost(u32),
    Own {
        url: String,
        key: String,
    },
}

#[derive(Default)]
pub(crate) struct History {
    traversal: RefCell<Option<Box<Traversal>>>,
    entries: RefCell<Vec<Entry>>,
    index: Cell<usize>,
    navigations: Cell<u32>,
    opens: Cell<u32>,
    text_directives: RefCell<Option<String>>,
    refresh: RefCell<Option<lifecycle::Refresh>>,
    planned: forms::Planned,
}

slots!(History = js_History { target: Element } [wrappers: NavigationHistoryEntry]);

impl History {
    fn of<'a>(heap: &JsHeap<'a>, window: &'a Window) -> &'a History {
        let history = js_DomWindow::history(window).unwrap_or_else(|| {
            let history = js_History::create(window.realm(heap), History::default());
            js_History::set_window(history, window.to_js());
            js_DomWindow::set_history(window, Some(history));
            history
        });
        history.up_to_date()
    }

    /// The window may have got another document.
    fn up_to_date(&self) -> &History {
        if self.entries.borrow().is_empty() {
            let (window, known) = (
                self.window(),
                self.window().host().history_entries().unwrap_or_default(),
            );
            let mut entries: Vec<_> = known.entries.into_iter().map(named).collect();
            if entries.is_empty() {
                entries.push(named(HistoryEntry::of(window.url())));
            }
            self.index
                .set((known.index as usize).min(entries.len() - 1));
            self.entries.replace(entries);
            self.text_directives
                .replace(Some(window.host().arrival().text_directives).filter(|it| !it.is_empty()));
        }
        self
    }

    fn window(&self) -> &Window {
        js_History::window(self)
            .and_then(Window::from_value)
            .expect("it is set first")
    }

    fn is_active(&self) -> bool {
        !self.window().is_disposed()
    }

    fn current(&self) -> Entry {
        Rc::clone(&self.up_to_date().entries.borrow()[self.index.get()])
    }

    fn at_offset(&self, delta: i32) -> Option<Entry> {
        self.up_to_date()
            .entries
            .borrow()
            .get(self.index.get().checked_add_signed(delta as isize)?)
            .cloned()
    }

    fn find(&self, matches: &dyn Fn(&HistoryEntry) -> bool) -> Option<Entry> {
        self.up_to_date()
            .entries
            .borrow()
            .iter()
            .find(|it| matches(&it.borrow()))
            .cloned()
    }

    fn index_of(&self, entry: &Entry) -> Option<usize> {
        self.entries
            .borrow()
            .iter()
            .position(|it| Rc::ptr_eq(it, entry))
    }

    /// In place of those after the current one, which are the result.
    fn push(&self, entry: Entry) -> Vec<Entry> {
        self.index.update(|it| it + 1);
        self.entries
            .borrow_mut()
            .splice(self.index.get().., [entry])
            .collect()
    }

    fn wrapper_if_any(&self, entry: &Entry) -> Option<&NavigationHistoryEntry> {
        self.wrappers().iter().find(|it| it.stands_for(entry))
    }

    fn wrap<'a>(&'a self, heap: &JsHeap<'a>, entry: &Entry) -> &'a NavigationHistoryEntry {
        self.wrapper_if_any(entry).unwrap_or_else(|| {
            let wrapper = NavigationHistoryEntry::new(heap, self, entry);
            self.set_wrappers(self.wrappers().with(heap, wrapper));
            wrapper
        })
    }

    fn dispose_of<'a>(&'a self, cx: &mut Cx<'a>, entry: &Entry) {
        if let Some(wrapper) = self.wrapper_if_any(entry) {
            self.set_wrappers(self.wrappers().without(&cx.heap, wrapper));
            let event = Event::new(wrapper.realm(&cx.heap), atom!("dispose"), PLAIN);
            dispatch_now(cx, wrapper, event);
        }
    }

    /// What hosts the page has a list of its own, which outlives the page.
    fn save(&self, entry: &Entry, change: HistoryChange) {
        let entry = entry.borrow().clone();
        self.window().host().history_changed(entry, change);
    }

    fn set_url(&self, url: &str) {
        let (doc, text) = (self.window().document(), DomString::from_utf8(url));
        if split_fragment(url).1 != split_fragment(&self.window().url()).1 {
            self.window().set_phase(Phase::IGNORES_FRAGMENT, true);
        }
        if doc.base_url() == doc.url() {
            doc.set_base_url(text.clone());
            doc.engine(|engine, _| engine.base_url = url.as_bytes().into());
        }
        doc.set_url(text);
        js_History::set_cached_state(self, JSValue::ZERO);
    }

    fn remember_scroll(&self) {
        let (entry, scroll) = (
            self.current(),
            crate::api::ui::layout::viewport_scroll(self.window().document()),
        );
        entry.borrow_mut().scroll = Some(scroll);
        self.save(&entry, HistoryChange::Update);
    }

    fn restore_scroll<'a>(&'a self, cx: &mut Cx<'a>) {
        let (doc, entry) = (self.window().document(), self.current());
        let HistoryEntry {
            scroll,
            restores_scroll,
            ..
        } = *entry.borrow();
        if !restores_scroll
            || doc.ready_state() != ReadyState::Complete
                && self.window().host().arrival().loads_at_top
        {
            return;
        }
        match scroll {
            Some(to) => view::jump_viewport(cx, doc, to, ScrollBehavior::Instant),
            None => _ = self.scroll_to_fragment(cx, true),
        }
    }

    /// <https://html.spec.whatwg.org/#url-and-history-update-steps>
    fn commit<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        url: &str,
        replaces: bool,
        state: Option<Serialized>,
        navigation_state: Option<Serialized>,
    ) {
        let from = self.current();
        if !replaces {
            self.remember_scroll();
        }
        let key = if replaces {
            from.borrow().key.clone()
        } else {
            String::new()
        };
        let entry = named(HistoryEntry {
            key,
            state,
            navigation_state,
            restores_scroll: from.borrow().restores_scroll,
            ..HistoryEntry::of(url.into())
        });
        let dropped = match replaces {
            true => vec![core::mem::replace(
                &mut self.entries.borrow_mut()[self.index.get()],
                Rc::clone(&entry),
            )],
            false => self.push(Rc::clone(&entry)),
        };
        self.set_url(url);
        self.save(
            &entry,
            if replaces {
                HistoryChange::Replace
            } else {
                HistoryChange::Push
            },
        );
        if let Some(navigation) = self.window().navigation() {
            navigation.committed(
                cx,
                &from,
                Some(if replaces {
                    NavigationType::Replace
                } else {
                    NavigationType::Push
                }),
                &dropped,
            );
        }
    }

    fn fire_hash_change(&self, old: String, new: String) {
        if differ_in_fragment_only(&old, &new) {
            queue_task(self.window(), [], move |cx, window, []| {
                let event = HashChangeEvent::new(
                    window.realm(&cx.heap),
                    DomString::from_utf8(&old),
                    DomString::from_utf8(&new),
                );
                dispatch(cx, window, event);
            });
        }
    }

    fn state<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        if let Some(state) = js_History::cached_state(self) {
            return Ok(state);
        }
        let stored = self.current().borrow().state.clone();
        let state = if stored.is_some() {
            deserialize(heap, self.window(), stored)?
        } else {
            JSValue::NULL
        };
        js_History::set_cached_state(self, state);
        Ok(state)
    }

    fn proceed<'a>(&'a self, cx: &mut Cx<'a>) {
        match self.traversal.take().map(|it| *it) {
            Some(Traversal::ByHost(ticket)) => self.window().host().proceed(ticket),
            Some(Traversal::Own { url, key }) => self.pop_state(cx, &url, &key),
            None => {}
        }
    }

    /// False if the page stays where it is.
    fn will_traverse<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        key: &str,
        is_by_user: bool,
        traversal: Traversal,
    ) -> bool {
        self.traversal.replace(Some(traversal.into()));
        let entry = self.find(&|it| it.key == key);
        self.remember_scroll();
        let proceeds = match (entry, self.window().navigation()) {
            (Some(entry), Some(navigation)) => navigation.fire_for_traversal(cx, entry, is_by_user),
            _ => true,
        };
        if proceeds {
            self.proceed(cx);
        }
        proceeds
            || self
                .window()
                .navigation()
                .is_some_and(Navigation::is_under_way)
    }

    /// It has gone to another entry of the same document, or to a fragment.
    fn pop_state<'a>(&'a self, cx: &mut Cx<'a>, url: &str, key: &str) {
        let (window, from) = (self.window(), self.current());
        let (old, known) = (
            window.url(),
            self.find(&|it| it.key == key)
                .and_then(|it| self.index_of(&it)),
        );
        match known {
            Some(index) => self.index.set(index),
            None => {
                self.push(named(HistoryEntry {
                    key: key.into(),
                    ..HistoryEntry::of(url.into())
                }));
                self.save(&self.current(), HistoryChange::Update);
            }
        }
        self.set_url(url);
        let navigation = window.navigation();
        if let Some(navigation) = navigation {
            navigation.committed(
                cx,
                &from,
                Some(if known.is_some() {
                    NavigationType::Traverse
                } else {
                    NavigationType::Push
                }),
                &[],
            );
        }
        let state = self
            .state(&cx.heap)
            .or_else(|it| cx.catch(it).map(|_| JSValue::NULL))
            .unwrap_or(JSValue::NULL);
        let event = PopStateEvent::new(window.realm(&cx.heap), state);
        dispatch(cx, window, event);
        if !navigation.is_some_and(Navigation::suppresses_scroll) {
            self.restore_scroll(cx);
        }
        self.fire_hash_change(old, url.into());
    }

    fn traverse<'a>(&'a self, cx: &mut Cx<'a>, delta: i32) {
        if delta == 0 {
            return self.reload(cx, None);
        }
        if self.window().host().traverse(delta) {
            return;
        }
        queue_task(self.window(), [], move |cx, window, []| {
            let history = History::of(&cx.heap, window);
            let Some(entry) = history.at_offset(delta) else {
                return;
            };
            let HistoryEntry { url, key, .. } = entry.borrow().clone();
            history.will_traverse(cx, &key.clone(), false, Traversal::Own { url, key });
        });
    }

    /// A frame has pushed an entry, or the program has removed some.
    fn keep_entries<'a>(&'a self, cx: &mut Cx<'a>, keeps: &dyn Fn(&str) -> bool) {
        let current = self.current();
        let (kept, dropped): (Vec<_>, Vec<_>) = self
            .entries
            .take()
            .into_iter()
            .partition(|it| Rc::ptr_eq(it, &current) || keeps(&it.borrow().key));
        self.entries.replace(kept);
        self.index.set(self.index_of(&current).unwrap_or(0));
        for it in &dropped {
            let key = it.borrow().key.clone();
            self.window()
                .navigation()
                .into_iter()
                .for_each(|navigation| navigation.give_up_traversal(cx, Some(&key), None));
            self.dispose_of(cx, it);
        }
    }

    fn require_active<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        match self.is_active() {
            true => Ok(()),
            false => Err(dom_error(
                heap,
                DomError::SecurityError,
                "May not use a History object associated with a Document that is not fully active",
            )),
        }
    }

    pub(crate) fn get_length<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a, u32> {
        self.require_active(&cx.heap)?;
        Ok(self
            .window()
            .host()
            .history_length()
            .unwrap_or_else(|| self.up_to_date().entries.borrow().len() as u32))
    }

    pub(crate) fn get_scroll_restoration<'a>(
        &'a self,
        cx: &mut Cx<'a>,
    ) -> Result<'a, ScrollRestoration> {
        self.require_active(&cx.heap)?;
        Ok(if self.current().borrow().restores_scroll {
            ScrollRestoration::Auto
        } else {
            ScrollRestoration::Manual
        })
    }

    pub(crate) fn set_scroll_restoration<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        value: ScrollRestoration,
    ) -> Result<'a> {
        self.require_active(&cx.heap)?;
        let entry = self.current();
        entry.borrow_mut().restores_scroll = value == ScrollRestoration::Auto;
        self.save(&entry, HistoryChange::Update);
        Ok(())
    }

    pub(crate) fn get_state<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a, JSValue> {
        self.require_active(&cx.heap)?;
        self.state(&cx.heap)
    }

    pub(crate) fn go<'a>(&'a self, cx: &mut Cx<'a>, delta: i32) -> Result<'a> {
        self.require_active(&cx.heap)?;
        self.traverse(cx, delta);
        Ok(())
    }

    pub(crate) fn back<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a> {
        self.go(cx, -1)
    }

    pub(crate) fn forward<'a>(&'a self, cx: &mut Cx<'a>) -> Result<'a> {
        self.go(cx, 1)
    }

    /// <https://html.spec.whatwg.org/#shared-history-push/replace-state-steps>
    fn change_state<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        data: JsLocal<'a>,
        given: Option<DomString>,
        replaces: bool,
    ) -> Result<'a> {
        self.require_active(&cx.heap)?;
        let (window, stored) = (self.window(), serialize(cx, data)?);
        let url = match given.as_ref().filter(|it| !it.is_empty()) {
            Some(given) => window.resolve(cx, given),
            None => Some(window.url()),
        };
        let Some(url) = url.filter(|it| can_rewrite_url(window, it)) else {
            let given = given.unwrap_or_default();
            return Err(cx.heap.dom_exception(
                DomError::SecurityError,
                format_args!(
                    "A history state object with URL '{}' cannot be created in this document.",
                    given.to_utf8()
                ),
            ));
        };
        if window
            .navigation()
            .is_some_and(Navigation::is_nested_too_deep)
        {
            return Err(dom_error(
                &cx.heap,
                DomError::SecurityError,
                "Too many calls to the History API.",
            ));
        }
        let replaces = replaces || window.host().is_initial();
        let kind = if replaces {
            NavigationType::Replace
        } else {
            NavigationType::Push
        };
        if window.navigation().is_none_or(|it| {
            it.fire(
                cx,
                Intent {
                    classic_state: Some(stored.clone()),
                    ..Intent::new(kind, &url, true)
                },
            )
        }) {
            self.commit(cx, &url, replaces, Some(stored), None);
        }
        Ok(())
    }

    pub(crate) fn push_state<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        data: JsLocal<'a>,
        _: DomString,
        url: Option<DomString>,
    ) -> Result<'a> {
        self.change_state(cx, data, url, false)
    }

    pub(crate) fn replace_state<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        data: JsLocal<'a>,
        _: DomString,
        url: Option<DomString>,
    ) -> Result<'a> {
        self.change_state(cx, data, url, true)
    }
}

pub(crate) fn traverse<'a>(cx: &mut Cx<'a>, doc: &'a Doc, delta: i32) {
    Window::of(doc)
        .into_iter()
        .for_each(|it| History::of(&cx.heap, it).traverse(cx, delta));
}
