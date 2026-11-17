//! What is said to the host of the page with JS values. The rest is in `bun_web::host`.

use bun_jsc::JSGlobalObject;

use bun_web::client::ScriptLocation;

use super::navigate::{Options, Source};
use super::*;

use crate::api::events::{ErrorDescription, where_thrown};
use crate::api::loading::came_with;
use crate::api::ui::controls::create_controls;

pub(super) fn text(cx: &Cx<'_>, value: &str) -> JSValue {
    DomString::from_utf8(value).to_js(&cx.heap).to_js()
}

pub(super) fn create_remote_frame<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    frame: JSValue,
    receiver: JSValue,
) -> JSValue {
    window
        .ask_host(cx, "createRemoteFrame", &[frame, receiver])
        .unwrap_or(JSValue::UNDEFINED)
}

pub(super) fn run<'a>(cx: &mut Cx<'a>, steps: JSValue) {
    if steps.is_callable() {
        let result = steps.call(cx.global(), JSValue::UNDEFINED, &[]);
        bun_web::exec::report(cx, result.map(drop).map_err(Into::into));
    }
}

/// Pages that can reach each other have one.
pub(super) fn owner<'a>(cx: &mut Cx<'a>, window: &'a Window) -> Option<JSValue> {
    window.ask_host(cx, "owner", &[])
}

fn calling_window<'a>(cx: &mut Cx<'a>, callee: &'a Window, is_entry: bool) -> &'a Window {
    unsafe extern "C" {
        safe fn Bun__DOM__callingWindow(global: &JSGlobalObject, is_entry: bool) -> JSValue;
    }
    let window = owner(cx, callee).map(|_| Bun__DOM__callingWindow(cx.global(), is_entry));
    window
        .and_then(|it| WindowTarget::of(&cx.heap, it)?.downcast())
        .unwrap_or(callee)
}

/// <https://html.spec.whatwg.org/#concept-incumbent-global>
pub(super) fn caller<'a>(cx: &mut Cx<'a>, callee: &'a Window) -> &'a Window {
    calling_window(cx, callee, false)
}

/// <https://html.spec.whatwg.org/#entry-global-object>
pub(super) fn entry<'a>(cx: &mut Cx<'a>, callee: &'a Window) -> &'a Window {
    calling_window(cx, callee, true)
}

/// `NavigateRequest`, and what only the host reads.
fn describe<'a>(cx: &mut Cx<'a>, options: &Options<'a>) -> JSValue {
    let object = cx.heap.create_empty_object().to_js();
    let source = match options.source {
        Source::Other => "",
        Source::Form => "form",
        Source::Link => "link",
        Source::Script => "script",
    };
    let mut put = |name: &'static str, value: &dyn Fn(&Cx<'a>) -> Option<JSValue>| {
        if let Some(value) = value(cx) {
            object.put(cx.global(), name.as_bytes(), value);
        }
    };
    put("source", &|cx| Some(text(cx, source)));
    for (name, is) in [
        ("replace", options.replace),
        ("isByUser", options.is_by_user),
        ("hasActivation", options.has_activation),
        ("hasTextActivation", options.has_text_activation),
    ] {
        put(name, &|_| Some(is.into()));
    }
    for (name, value) in [
        ("download", &options.download),
        ("srcdoc", &options.srcdoc),
        ("referrerPolicy", &options.referrer_policy),
    ] {
        put(name, &|cx| Some(value.as_ref()?.to_js(&cx.heap).to_js()));
    }
    put("replaceIn", &|_| Some(options.replace_in?.to_js()));
    put("element", &|_| Some(options.element?.to_js()));
    put("initiator", &|_| options.initiator);
    put("navigationState", &|cx| {
        Some(
            cx.heap
                .create_buffer(&options.navigation_state.as_ref()?.0)
                .ok()?
                .to_js(),
        )
    });
    if let Some(post) = &options.post {
        put("method", &|cx| Some(text(cx, "POST")));
        put("formData", &|_| Some(post.form_data));
        put("body", &|_| Some(post.body));
        put("contentType", &|cx| Some(text(cx, &post.content_type)));
    }
    object
}

pub(super) fn navigate<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    url: &str,
    options: &Options<'a>,
    markup: Option<JSValue>,
) {
    let (url, options) = (text(cx, url), describe(cx, options));
    options.put(cx.global(), b"mayUnload", JSValue::TRUE);
    markup
        .into_iter()
        .for_each(|it| options.put(cx.global(), b"markup", it));
    window.ask_host(cx, "navigate", &[url, options]);
}

/// Whether `source` may.
pub(super) fn navigate_from<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    source: &'a Window,
    url: &str,
    options: &Options<'a>,
) -> bool {
    let arguments = [
        owner(cx, source).unwrap_or(JSValue::UNDEFINED),
        text(cx, url),
        describe(cx, options),
    ];
    window
        .ask_host(cx, "navigateFrom", &arguments)
        .is_some_and(JSValue::to_boolean)
}

/// The window, or false if there is none of that name. `None` if windows have no names.
pub(super) fn navigate_other<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    target: &str,
    url: Option<&str>,
    options: &Options<'a>,
    becomes_opener: bool,
) -> Option<JSValue> {
    let arguments = [
        text(cx, target),
        url.map_or(JSValue::NULL, |it| text(cx, it)),
        describe(cx, options),
    ];
    arguments[2].put(cx.global(), b"becomesOpener", becomes_opener.into());
    window.ask_host(cx, "navigateOther", &arguments)
}

/// For a window that shares the realm.
fn create_popup<'a>(
    cx: &mut Cx<'a>,
    [opener, _]: [JsLocal<'a>; 2],
    _: u64,
    given: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let both = Window::from_js(&cx.heap, opener.to_js()).zip(given.first());
    Ok(both.map_or(JSValue::UNDEFINED, |(opener, tools)| {
        create_controls(&cx.heap, opener.open_beside(tools.to_js())).to_js()
    }))
}

pub(super) fn open<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    url: &str,
    target: &str,
    features: &str,
    options: &Options<'a>,
) -> JSValue {
    let create_page = window
        .realm(&cx.heap)
        .create_callback(create_popup, [window.to_js(), JSValue::UNDEFINED], 0)
        .to_js();
    let arguments = [
        text(cx, url),
        text(cx, target),
        text(cx, features),
        create_page,
        describe(cx, options),
    ];
    window
        .ask_host(cx, "open", &arguments)
        .filter(|it| it.is_object())
        .unwrap_or(JSValue::NULL)
}

/// False if it has no list of entries.
pub(super) fn traverse_to<'a>(
    cx: &mut Cx<'a>,
    navigation: &'a Navigation,
    window: &'a Window,
    key: &str,
) -> bool {
    let fail = crate::api::interim::once(&cx.heap, &[navigation.to_js()], {
        let key = key.to_owned();
        move |cx, values| {
            let name = DomString::from_js(cx, JsLocal::new(&cx.heap, values[1]))?;
            let error = [
                ("SecurityError", DomError::SecurityError),
                ("InvalidStateError", DomError::InvalidStateError),
            ]
            .into_iter()
            .find(|it| name.eq_str(it.0))
            .map(|it| it.1);
            Navigation::from_value(values[0])
                .into_iter()
                .for_each(|it| it.give_up_traversal(cx, Some(&key), error));
            Ok(())
        }
    });
    let key = text(cx, key);
    window.ask_host(cx, "traverseTo", &[key, fail]).is_some()
}

/// What the script comes to.
pub(super) fn run_javascript_url<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    source: &DomString,
    initiator: JSValue,
) -> JSValue {
    let doc = window.document();
    let frame = crate::api::frames::container(doc);
    let arguments = [
        source.to_js(&cx.heap).to_js(),
        initiator,
        frame.map_or(JSValue::UNDEFINED, |it| it.to_js()),
    ];
    let is_allowed = doc.runs_scripts()
        && if doc.is_of_program() {
            came_with(cx, doc, source)
        } else {
            window.ask_host(cx, "allowsJavaScriptUrl", &arguments) == Some(JSValue::TRUE)
        };
    if !is_allowed {
        return JSValue::UNDEFINED;
    }
    crate::api::loading::run_javascript_url(cx, window.document(), source.clone())
}

pub(super) fn describe_error<'a>(
    cx: &mut Cx<'a>,
    window: &'a Window,
    error: JSValue,
) -> ErrorDescription {
    let global = cx.global();
    let at = if error.is_error() {
        where_thrown(global, error, None)
    } else {
        ScriptLocation::now(global)
    };
    let filename = if at.url.is_empty() {
        window.document().url()
    } else {
        DomString::from_utf8(&lossy(&at.url))
    };
    ErrorDescription {
        message: DomString::from_utf8(&crate::api::events::describe(global, error)),
        filename,
        lineno: at.line,
        colno: at.column,
    }
}

/// Of what it has told.
pub(super) fn entry_from<'a>(cx: &mut Cx<'a>, value: JsLocal<'a>) -> Option<HistoryEntry> {
    HistoryEntry::from_script(cx.global(), value.to_js())
}
