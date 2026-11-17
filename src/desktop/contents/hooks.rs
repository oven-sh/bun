//! The functions that the realm of a page gets. Its scripts may get hold of them, and pass anything.

use bun_web::convert::token_for_path;
use bun_web::js_link::link_to;
use bun_web::trust;

use super::inspection::News;
use super::load::Initiator;
use super::page::Page;
use super::{
    Contents, Methods, NOTHING, Numbers as _, bind, callable_at, fields, frame, link, nothing,
    object_in, spread, text_at, text_if_any,
};
use crate::prelude::*;
use crate::realm::{methods_for_page, methods_of};
use crate::webview::embedded::Controls;

/// What stands for the files that the user or the app has chosen.
pub(crate) fn all_chosen(paths: JSValue) -> JsResult<JSValue> {
    let all = array(&[])?;
    with_elements(paths, |it| {
        it.iter()
            .try_for_each(|it| all.push(global(), token_for_path(global(), *it)))
    })?;
    Ok(all)
}

pub(super) fn with_files(event: JSValue) -> JsResult<JSValue> {
    let copy = spread(object!({}), event)?;
    copy.put(global(), b"paths", all_chosen(get(event, "paths")?)?);
    Ok(copy)
}

fn relative(page: &Page, other: Option<&Contents>) -> JsResult<JSValue> {
    match (other, page.agent()) {
        (Some(other), Some(agent)) if !page.is_disposed() => other.window_for(&agent),
        _ => Ok(JSValue::NULL),
    }
}

pub(super) fn show_context_menu(page: &Page, given: JSValue) -> JsResult<()> {
    let params = object!({
        "suggestedFilename": "",
        "selectionRect": Rect::default(),
        "selectionStartOffset": 0,
        "frameCharset": "UTF-8",
        "menuSourceType": "mouse",
        "mediaFlags": object!({}),
    });
    let about = object!({
        "frame": page.handle(),
        "pageURL": page.url(),
        "frameURL": "",
        "referrerPolicy": object!({ "url": "", "policy": "default" }),
    });
    announce(
        page.owner().to_js(),
        "context-menu",
        &[spread(spread(params, given)?, about)?],
    )
}

const OF_POPUP: Methods<Contents> = &[
    ("isClosed", |it, _| js(it.is_destroyed.get())),
    ("close", |it, _| {
        it.later(Contents::close_now);
        NOTHING
    }),
    ("focus", |it, _| {
        nothing(if it.is_destroyed.get() {
            Ok(())
        } else {
            it.focus_window()
        })
    }),
];

/// What `window.open()` returns.
fn open(page: &'static Page, given: &[JSValue]) -> JsResult<JSValue> {
    let (url, target) = (text_at(given, 0)?, text_at(given, 1)?);
    let name = if target.eq_ignore_ascii_case("_blank") {
        ""
    } else {
        &target
    };
    let more = [argument(given, 3), argument(given, 4)];
    let Some(opened) = page
        .contents()
        .open(page, &url, name, &text_at(given, 2)?, more)?
    else {
        return Ok(JSValue::NULL);
    };
    if opened.page().opener().is_some() {
        return opened.page().window();
    }
    let guest = opened.guest();
    if guest.is_none()
        && page.agent().is_some()
        && opened
            .opened_by()
            .is_some_and(|it| same(it, page.contents()))
    {
        return relative(page, Some(opened));
    }
    let popup = bind(object!({}), opened, OF_POPUP)?;
    let both = array(&[
        page.to_js(),
        guest.map_or(JSValue::UNDEFINED, JsInterface::to_js),
    ])?;
    let connect = function(both, move |both, given| {
        let page = Page::given(&[both.get_index(global(), 0)?], 0)?;
        let guest = cast::<crate::webview::remote::Remote>(both.get_index(global(), 1)?);
        let Some(guest) = guest.filter(|it| it.get_is_opened_by_page()) else {
            return Ok(JSValue::UNDEFINED);
        };
        let controls = Controls::create(
            page.to_js(),
            object!({
                "origin": function(array(&[0.into(), 0.into()])?, |it, _| Ok(it))?,
                "scale": function(1.into(), |it, _| Ok(it))?,
            }),
            argument(given, 0),
        )?;
        controls.open_popup(guest, &url, &target)?;
        methods_for_page(controls.to_js())
    })?;
    popup.put(global(), b"connect", connect);
    page.ask("remoteWindow", &[popup])
}

/// False if there is no such window yet.
fn navigate_other(page: &'static Page, given: &[JSValue]) -> JsResult<JSValue> {
    let (target, context, options) = (text_at(given, 0)?, page.contents(), argument(given, 2));
    let is_keyword = ["_self", "_parent", "_top"]
        .iter()
        .any(|it| target.eq_ignore_ascii_case(it));
    let found = if is_keyword || trust::trusts_all_frames() {
        context.choose(&target)?
    } else {
        None
    };
    let Some(found) = found else {
        return Ok(JSValue::FALSE);
    };
    if get(options, "becomesOpener")?.to_boolean() {
        fields::set_opened_by(found, Some(context));
    }
    text_if_any(argument(given, 1))?
        .map(|url| found.navigate(page, &url, options))
        .transpose()?;
    relative(page, Some(found))
}

/// Only natives call these.
const LINKED: Methods<Page> = &[
    ("consoleCalled", |it, given| match given {
        [kind, values @ ..] => nothing(
            it.contents()
                .notify(News::Console(&text_of(*kind)?, values)),
        ),
        [] => Ok(JSValue::UNDEFINED),
    }),
    ("allowsJavaScriptUrl", |it, given| {
        let (source, initiator) = (argument(given, 0), cast(argument(given, 1)).unwrap_or(it));
        let frame = match it.parent() {
            Some(parent) if same(parent, initiator) => argument(given, 2),
            _ => JSValue::UNDEFINED,
        };
        js(initiator.allows_javascript_url(source, frame)?
            && (same(it, initiator)
                || it.policy_allows_javascript_url(source, JSValue::UNDEFINED)?))
    }),
    ("createRemoteFrame", |it, given| {
        let element = methods_of(argument(given, 0))?;
        methods_for_page(Controls::create(it.to_js(), element, argument(given, 1))?.to_js())
    }),
    ("exception", |it, given| {
        nothing(it.contents().notify(News::Exception {
            text: &text_at(given, 0)?,
            url: &text_at(given, 1)?,
            line: argument(given, 2).as_u32(),
            column: argument(given, 3).as_u32(),
            error: argument(given, 4),
        }))
    }),
    ("getOpener", |it, _| {
        let opened_by = it
            .contents()
            .opened_by()
            .filter(|_| link::knows_other_windows(it));
        opened_by.map_or_else(
            || it.opener().map_or(Ok(JSValue::NULL), Page::window),
            |other| relative(it, Some(other)),
        )
    }),
    ("navigate", |it, given| {
        let options = argument(given, 1);
        let named = cast::<Page>(get(options, "initiator")?)
            .filter(|named| !named.is_disposed() && it.agent().is_some_and(|it| it.has(named)));
        nothing(it.contents().wish(
            it,
            &text_at(given, 0)?,
            options,
            Initiator::of(named.unwrap_or(it)),
        ))
    }),
    ("open", open),
    ("traverseTo", |it, given| {
        let (key, fail) = (text_at(given, 0)?, keep(callable_at(given, 1)?));
        it.later(move |it| match it.contents().traverse_to(&key)? {
            Some(name) => call(fail.get(), &[js(name)?]).map(drop),
            None => Ok(()),
        });
        NOTHING
    }),
];

const LINKED_OF_RELATIVES: Methods<Page> = &[
    ("container", |it, _| {
        object_in(fields::element(it.contents()))
            .map_or(Ok(JSValue::UNDEFINED), |it| get(it, "handle"))
    }),
    ("createLocalFrame", |it, given| {
        frame::create(it, methods_of(argument(given, 0))?)
    }),
    ("frameElement", |it, _| {
        match it
            .parent()
            .is_some_and(|parent| parent.origin_key() == it.origin_key())
        {
            true => it.contents().ask_element("self", &[]),
            false => Ok(JSValue::NULL),
        }
    }),
    ("navigateFrom", |it, given| {
        js(it.contents().navigate(
            it.relative_given(given)?,
            &text_at(given, 1)?,
            argument(given, 2),
        )?)
    }),
    ("owner", |it, _| Ok(it.to_js())),
    ("parent", |it, _| {
        relative(it, it.contents().parent().or_else(|| Some(it.contents())))
    }),
    ("postMessage", |it, given| {
        nothing(it.post_message(it.relative_given(given)?, given))
    }),
];

const TOP: Methods<Page> = &[("top", |it, _| relative(it, Some(it.owner())))];

/// If the windows that it opens are too.
const OF_OPENERS: Methods<Page> = &[("disown", |it, _| {
    fields::set_opened_by(it.contents(), None);
    NOTHING
})];

const OF_TARGETS: Methods<Page> = &[("navigateOther", navigate_other)];

pub(super) fn about_document(page: &Page, into: JSValue) -> JsResult<JSValue> {
    page.loaded()
        .unwrap_or_default()
        .describe(into)
        .map(|()| into)
}

fn linked(page: &Page) -> JsResult<JSValue> {
    let host = bind(link::of_window(page), page, LINKED)?;
    if page.agent().is_some() {
        bind(bind(host, page, LINKED_OF_RELATIVES)?, page, TOP)?;
        if link::knows_other_windows(page) {
            bind(host, page, OF_OPENERS)?;
        }
        if link::knows_other_windows(page) || page.contents().is_frame() {
            bind(host, page, OF_TARGETS)?;
        }
    }
    Ok(link_to(host))
}

pub(super) fn of_document(page: &Page) -> JsResult<JSValue> {
    let contents = page.contents();
    let hooks = object!({
        "link": linked(page)?,
        "linkOfBlankFrames": link_to(link::of_blank_frames(page)),
        "surface": if contents.guest().is_some() { 0 } else { contents.surface },
        "url": page.url(),
    });
    about_document(page, hooks)
}
