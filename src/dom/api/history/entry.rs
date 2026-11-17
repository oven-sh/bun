//! For the controls of a page.

use bun_jsc::JSObject;

use super::navigate::{Options, Post, Source};
use super::*;
use crate::values::text;

pub(crate) use super::lifecycle::{
    loaded, may_leave, renewed, restore_controls, scroll_on_load, unload,
};

pub(crate) fn navigate_for<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    url: &[u8],
    it: &NavigateRequest<'a>,
    initiator: JsLocal<'a, JSObject>,
    origin: &[u8],
) {
    let options = Options {
        replace: it.replace,
        replace_in: it.replace_in,
        source: match it.source {
            b"form" => Source::Form,
            b"link" => Source::Link,
            b"script" => Source::Script,
            _ => Source::Other,
        },
        element: it.element,
        is_by_user: it.is_by_user,
        has_text_activation: it.has_text_activation,
        post: it.content_type.as_ref().map(|kind| Post {
            form_data: it.form_data.to_js(),
            body: it.body.to_js(),
            content_type: text(kind).into(),
        }),
        download: it.download.clone(),
        initiator: Some(initiator.to_js()),
        is_by_other_origin: window
            .host()
            .origin()
            .is_none_or(|it| it.as_bytes() != origin),
        srcdoc: it.srcdoc.clone(),
        no_document: Some(it.no_document.to_js()),
        referrer_policy: it.referrer_policy.clone(),
        ..Default::default()
    };
    History::of(&cx.heap, window).navigate(cx, text(url), options, "");
}

pub(crate) fn pop_state<'a>(cx: &mut Cx<'a>, window: &'a Window, url: &[u8], key: Option<&[u8]>) {
    History::of(&cx.heap, window).pop_state(cx, text(url), text(key.unwrap_or_default()));
}

pub(crate) fn will_traverse<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    key: Option<&[u8]>,
    is_by_user: bool,
    proceed: JSValue,
) -> bool {
    History::of(&cx.heap, window).will_traverse(cx, key.unwrap_or_default(), is_by_user, proceed)
}

pub(crate) fn keep_entries<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    keys: &[bun_core::Utf8Bytes<'static>],
) {
    window.history_if_any().into_iter().for_each(|it| {
        it.keep_entries(cx, &|key| {
            keys.iter().any(|it| it.as_ref() == key.as_bytes())
        })
    });
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
    to: JSValue,
) -> u32 {
    let to = JsLocal::new(&cx.heap, to);
    let to = host::entry_from(cx, to);
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
