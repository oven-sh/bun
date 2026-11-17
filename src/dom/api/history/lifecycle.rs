//! From when a document has loaded to when it goes.

use super::navigate::Options;
use super::*;
use crate::api::events::{BeforeUnloadEvent, PageTransitionEvent, dispatch_for_document};
use crate::api::forms::restoration;
use crate::api::realm::client_of;
use crate::api::transition::{hand_over_transition, start_outbound_transition};
use crate::api::window::Is;
use crate::api::{frames, interim};

#[derive(Clone)]
pub(super) struct Refresh {
    seconds: f64,
    url: String,
}

fn skip_whitespace(text: &str) -> &str {
    text.trim_start_matches(|it: char| it.is_ascii_whitespace())
}

/// The time, and the URL if there is one.
fn parse_refresh(input: &str) -> Option<(f64, Option<&str>)> {
    let input = skip_whitespace(input);
    let after_digits = input.trim_start_matches(|it: char| it.is_ascii_digit());
    let digits = &input[..input.len() - after_digits.len()];
    if digits.is_empty() && !after_digits.starts_with('.') {
        return None;
    }
    let rest = after_digits.trim_start_matches(|it: char| it.is_ascii_digit() || it == '.');
    if rest
        .bytes()
        .next()
        .is_some_and(|it| !matches!(it, b';' | b',') && !it.is_ascii_whitespace())
    {
        return None;
    }
    let (seconds, rest) = (digits.parse().unwrap_or(0.0), skip_whitespace(rest));
    let rest = skip_whitespace(rest.strip_prefix([';', ',']).unwrap_or(rest));
    if rest.is_empty() {
        return Some((seconds, None));
    }
    let after_name = rest
        .get(..3)
        .filter(|it| it.eq_ignore_ascii_case("url"))
        .and_then(|_| skip_whitespace(&rest[3..]).strip_prefix('='));
    let given = after_name.map_or(rest, skip_whitespace);
    let unquoted = given.strip_prefix(['\'', '"']).map(|it| {
        &it[..strings::index_of_char_usize(it.as_bytes(), given.as_bytes()[0]).unwrap_or(it.len())]
    });
    Some((seconds, Some(unquoted.unwrap_or(given))))
}

impl History {
    /// <https://html.spec.whatwg.org/#shared-declarative-refresh-steps>
    pub(super) fn refresh<'a>(&'a self, cx: &mut Cx<'a>, input: &str) {
        let (window, Some((seconds, given))) = (
            self.window(),
            parse_refresh(input).filter(|_| self.refresh.borrow().is_none()),
        ) else {
            return;
        };
        let url = given.map_or_else(
            || Some(window.url()),
            |it| window.resolve(cx, &DomString::from_utf8(it)),
        );
        let Some(url) = url.filter(|it| !it.starts_with("javascript:")) else {
            return;
        };
        self.refresh.replace(Some(Refresh { seconds, url }));
        if window.document().ready_state() == ReadyState::Complete {
            self.start_refresh();
        }
    }

    pub(super) fn cancel_refresh(&self) {
        self.refresh.take();
    }

    /// Whether there was one.
    pub(super) fn cancel_immediate_refresh(&self) -> bool {
        self.refresh
            .borrow_mut()
            .take_if(|it| it.seconds == 0.0)
            .is_some()
    }

    fn start_refresh(&self) {
        let (doc, Some(Refresh { seconds, url })) =
            (self.window().document(), self.refresh.borrow().clone())
        else {
            return;
        };
        interim::queue_task_after(doc, seconds * 1000.0, &[doc.to_js()], move |cx, values| {
            let Some(window) = Doc::from_value(values[0]).and_then(Window::of) else {
                return Ok(());
            };
            let history = History::of(&cx.heap, window);
            if history.refresh.borrow().is_none() {
                return Ok(());
            }
            if url == window.url() && split_fragment(&url).1.is_none() {
                history.reload(cx, None);
            } else {
                history.navigate(
                    cx,
                    &url,
                    Options {
                        replace: seconds <= 1.0,
                        ..Default::default()
                    },
                    "",
                );
            }
            Ok(())
        });
    }

    /// `to` is `None` if the next document is of another origin.
    pub(super) fn will_swap<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        kind: NavigationType,
        to: Option<HistoryEntry>,
    ) -> u32 {
        let window = self.window();
        let may_transition =
            to.is_some() && kind != NavigationType::Reload && window.is(Is::REVEALED);
        let transition = if may_transition {
            start_outbound_transition(cx, window.document())
                .map_err(|it| cx.catch(it))
                .ok()
                .flatten()
        } else {
            None
        };
        if window.has_listeners(atom!("pageswap")) {
            let activation = to.map(|it| {
                NavigationActivation::new(
                    &cx.heap,
                    self,
                    Some(self.current()),
                    &self.known_as(HistoryEntry {
                        is_of_document: false,
                        ..it
                    }),
                    kind,
                )
            });
            let event = PageSwapEvent::new(window.realm(&cx.heap), activation, transition);
            dispatch(cx, window, event);
        }
        transition.map_or(0, |it| hand_over_transition(cx, it))
    }

    pub(super) fn known_as(&self, entry: HistoryEntry) -> Entry {
        self.find(&|it| it.id == entry.id)
            .unwrap_or_else(|| named(entry))
    }
}

pub(crate) fn refresh_by_meta<'a>(cx: &mut Cx<'a>, doc: &'a Doc, content: &DomString) {
    if let Some(window) =
        Window::of(doc).filter(|it| !it.host().is_sandboxed("allow-scripts".into()))
    {
        History::of(&cx.heap, window).refresh(cx, &content.to_utf8());
    }
}

pub(crate) fn scroll_on_load<'a>(cx: &mut Cx<'a>, window: &'a Window) {
    if window.host().restores_scroll() {
        return History::of(&cx.heap, window).restore_scroll(cx);
    }
    let arrival = window.host().arrival();
    if split_fragment(&window.url()).1.is_some() || !arrival.text_directives.is_empty() {
        History::of(&cx.heap, window).keep_fragment_in_view(cx, !arrival.loads_at_top);
    }
}

/// When the document has been parsed.
pub(crate) fn restore_controls<'a>(cx: &mut Cx<'a>, window: &'a Window) {
    if client_of(window.realm(&cx.heap))
        .is_some_and(|it| it.navigation_timing().1 == bun_web::timing::NavigationType::BackForward)
    {
        let saved =
            std::sync::Arc::clone(&History::of(&cx.heap, window).current().borrow().controls);
        if !saved.is_empty() {
            restoration::restore(cx, window.document(), &saved);
        }
    }
}

fn fire_transition<'a>(cx: &mut Cx<'a>, window: &'a Window, name: Known) {
    let event = PageTransitionEvent::new(window.realm(&cx.heap), name);
    dispatch_for_document(cx, window, event);
}

/// After `load`.
pub(crate) fn loaded<'a>(cx: &mut Cx<'a>, window: &'a Window) {
    fire_transition(cx, window, atom!("pageshow"));
    window.set_phase(Phase::COMPLETELY_LOADED, true);
    window
        .history_if_any()
        .into_iter()
        .for_each(History::start_refresh);
}

/// The window has another document.
pub(crate) fn renewed(window: &Window) {
    window.phase.take();
    if let Some(history) = window.history_if_any() {
        history.entries.take();
        history.refresh.take();
        history.set_target(None);
        history.set_wrappers(Refs::default());
        js_History::set_cached_state(history, JSValue::ZERO);
    }
}

/// False if the page wants to stay.
pub(crate) fn may_leave<'a>(cx: &mut Cx<'a>, window: &'a Window) -> bool {
    let event = BeforeUnloadEvent::new(window.realm(&cx.heap), Atom::of(atom!("beforeunload")));
    event.set(crate::api::events::EventFlags::TRUSTED);
    window.set_phase(Phase::UNLOADING, true);
    let agrees = dispatch(cx, window, event) && event.get_message(&cx.heap).is_empty()
        || window.host().is_sandboxed("allow-modals".into());
    let leaves = agrees && frames::may_be_unloaded(cx, window.document());
    window.set_phase(Phase::UNLOADING, false);
    leaves
}

/// As far as `pagehide`.
pub(crate) fn unload<'a>(cx: &mut Cx<'a>, window: &'a Window) {
    let history = window.history_if_any().or_else(|| {
        window
            .is(Is::PAINTED)
            .then(|| History::of(&cx.heap, window))
    });
    if let Some(history) = history {
        history.current().borrow_mut().controls = restoration::save(window.document()).into();
        history.remember_scroll();
    }
    let is_closed = || {
        Ui::of(window.document())
            .and_then(Ui::container)
            .is_some_and(|it| it.get_is_closed())
            || window.host().is_closed()
    };
    if let Some(navigation) = window.navigation().filter(|_| is_closed()) {
        navigation.abort(cx);
        navigation.give_up_traversal(cx, None, None);
    }
    window.set_phase(Phase::UNLOADING, true);
    fire_transition(cx, window, atom!("pagehide"));
}
