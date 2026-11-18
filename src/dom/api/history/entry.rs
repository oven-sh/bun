//! For the controls of a page.

use bun_web::host::Wish;

use super::navigate::{Options, Post};
use super::*;
use crate::values::text;

pub(crate) use super::lifecycle::{
    loaded, may_leave, renewed, restore_controls, scroll_on_load, unload,
};

pub(crate) fn navigate_for<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    it: Wish,
    is_by_other_origin: bool,
) {
    let string = |it: Option<String>| it.map(|it| DomString::from_utf8(&it));
    let options = Options {
        replace: it.replaces,
        source: it.source,
        is_by_user: it.is_by_user,
        has_text_activation: it.has_text_activation,
        post: it.post.map(|sent| Post {
            form_data: None,
            sent,
        }),
        download: string(it.download),
        initiator: Some(it.initiator.and_then(Window::of_page).unwrap_or(window)),
        is_by_other_origin,
        srcdoc: string(it.srcdoc),
        fires_load_otherwise: it.fires_load_otherwise,
        referrer_policy: string(it.referrer_policy),
        ..Default::default()
    };
    History::of(&cx.heap, window).navigate(cx, &it.url, options, "");
}

pub(crate) fn pop_state<'a>(cx: &mut Cx<'a>, window: &'a Window, url: &str, key: &str) {
    History::of(&cx.heap, window).pop_state(cx, url, key);
}

pub(crate) fn will_traverse<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    key: &str,
    is_by_user: bool,
    ticket: u32,
) -> bool {
    History::of(&cx.heap, window).will_traverse(cx, key, is_by_user, Traversal::ByHost(ticket))
}

pub(crate) fn keep_entries<'a>(cx: &mut Cx<'a>, window: &'a Window, keys: &[String]) {
    window
        .history_if_any()
        .into_iter()
        .for_each(|it| it.keep_entries(cx, &|key| keys.iter().any(|it| it == key)));
}

pub(crate) fn abort_navigation<'a>(cx: &mut Cx<'a>, window: &'a Window) {
    window
        .history_if_any()
        .into_iter()
        .for_each(|it| it.abort_navigation(cx));
}

pub(crate) fn will_swap<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    kind: NavigationType,
    to: Option<HistoryEntry>,
) -> u32 {
    History::of(&cx.heap, window).will_swap(cx, kind, to)
}

pub(crate) fn refresh<'a>(cx: &mut Cx<'a>, window: &'a Window, input: &[u8]) {
    History::of(&cx.heap, window).refresh(cx, text(input));
}

pub(crate) fn replace_url<'a>(cx: &mut Cx<'a>, window: &'a Window, url: &[u8]) {
    let history = History::of(&cx.heap, window);
    let HistoryEntry {
        state,
        navigation_state,
        ..
    } = history.current().borrow().clone();
    history.commit(cx, text(url), true, state, navigation_state);
}
