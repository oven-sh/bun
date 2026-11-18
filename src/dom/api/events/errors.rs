//! <https://html.spec.whatwg.org/#runtime-script-errors> and <https://html.spec.whatwg.org/#unhandled-promise-rejections>

use bun_core::strings;
use bun_jsc::JSGlobalObject;
use bun_jsc::bindgen::JsLocal;
use bun_web::client::ScriptLocation;
use bun_web::url::Url;

use super::page_events::PromiseRejectionEvent;
use super::*;
use crate::api::core::by_name::{call_directly, member};
use crate::api::realm::is_program;
use crate::api::realm::queue_task;

unsafe extern "C" {
    safe fn Bun__DesktopRealm__rememberRejection(global: &JSGlobalObject, promise: JSValue);
    safe fn Bun__DesktopRealm__isParseError(error: JSValue) -> bool;
    safe fn Bun__DesktopRealm__describeError(
        global: &JSGlobalObject,
        error: JSValue,
        text: &mut bun_core::String,
    ) -> bool;
    safe fn Bun__DesktopRealm__isHandled(promise: JSValue) -> bool;
    safe fn Bun__DesktopRealm__scriptsBehind(
        global: &JSGlobalObject,
        thrown: JSValue,
        value: JSValue,
        thrower: &mut bun_core::String,
        maker: &mut bun_core::String,
    );
    safe fn Bun__IsolatedWorld__pageOrItself(realm: &JSGlobalObject) -> &JSGlobalObject;
    safe fn Bun__IsolatedWorld__hasThrown(page: &JSGlobalObject, value: JSValue) -> bool;
}

/// Also for an isolated world, whose values it must not get.
fn window_around<'a>(realm: &JsHeap<'a>) -> Option<&'a WindowTarget> {
    WindowTarget::of(
        realm,
        Bun__IsolatedWorld__pageOrItself(global_of(realm)).to_js_value(),
    )
}

#[derive(Default)]
pub(super) struct Errors {
    is_reporting: Cell<bool>,
    /// The scripts of other origins that have not allowed this one to read them.
    muted: RefCell<Vec<Box<[u8]>>>,
}

/// `None` if it throws.
fn property(global: &JSGlobalObject, object: JSValue, name: &str) -> Option<JSValue> {
    object
        .get(global, name)
        .map_err(|_| global.clear_exception_except_termination())
        .ok()?
}

fn text_of(global: &JSGlobalObject, value: JSValue) -> Option<String> {
    let text = value
        .to_utf8(global)
        .map_err(|_| global.clear_exception_except_termination())
        .ok()?;
    Some(bstr::ByteSlice::to_str_lossy(&*text).into_owned())
}

pub(crate) fn stack_of(global: &JSGlobalObject, error: JSValue) -> Option<String> {
    let stack = error
        .is_error()
        .then(|| property(global, error, "stack"))??;
    stack.is_string().then(|| text_of(global, stack))?
}

/// As `String(value)`, or what can be told without a call if that throws.
pub(crate) fn describe(global: &JSGlobalObject, value: JSValue) -> String {
    if value.is_symbol() {
        return format!("Symbol({})", value.get_description(global));
    }
    text_of(global, value).unwrap_or_else(|| {
        let mut text = bun_core::String::EMPTY;
        match Bun__DesktopRealm__describeError(global, value, &mut text) {
            true => bstr::ByteSlice::to_str_lossy(&*text.to_utf8()).into_owned(),
            false => format!(
                "[object {}]",
                bstr::BStr::new(value.get_class_info_name().unwrap_or_default())
            ),
        }
    })
}

/// `at name (url:line:column)` or `at url:line:column`
fn location_of_frame(frame: &[u8]) -> Option<ScriptLocation> {
    let (rest, column) =
        strings::rsplit_once_char(frame.strip_suffix(b")").unwrap_or(frame), b':')?;
    let (rest, line) = strings::rsplit_once_char(rest, b':')?;
    let url = &rest[strings::last_index_of_any(rest, b"( ")? + 1..];
    let (scheme, _) = strings::split_once_char(url, b':')?;
    let is_scheme = scheme.first().is_some_and(u8::is_ascii_lowercase)
        && scheme
            .iter()
            .all(|it| it.is_ascii_alphanumeric() || matches!(it, b'_' | b'+' | b'.' | b'-'));
    (is_scheme && !matches!(scheme, b"internal" | b"native" | b"node")).then_some(())?;
    let number = |digits: &[u8]| core::str::from_utf8(digits).ok()?.parse().ok();
    Some(ScriptLocation {
        url: url.into(),
        line: number(line)?,
        column: number(column)?,
    })
}

fn location_of_source(global: &JSGlobalObject, error: JSValue) -> Option<ScriptLocation> {
    let url = property(global, error, "sourceURL").filter(|it| it.is_string())?;
    let url = text_of(global, url).filter(|it| !it.starts_with("internal:"))?;
    let [line, column] = ["line", "column"].map(|it| {
        property(global, error, it)
            .and_then(JSValue::get_number)
            .unwrap_or_default() as u32
    });
    Some(ScriptLocation {
        url: url.as_bytes().into(),
        line,
        column,
    })
}

/// Not what `eval()` and the like throw, which is located where they are called.
fn is_about_parsing(global: &JSGlobalObject, error: JSValue) -> bool {
    let names = |url: &[u8], stack: &[u8]| {
        !strings::contains(stack, b"\n    at ")
            || strings::contains(stack, &[b"at <parse> (", url, b":"].concat())
    };
    Bun__DesktopRealm__isParseError(error)
        && location_of_source(global, error).is_some_and(|it| {
            Url::parse(&it.url).is_some()
                && stack_of(global, error).is_none_or(|stack| names(&it.url, stack.as_bytes()))
        })
}

/// Whether `error` says that the script at `url` could not be parsed.
pub(crate) fn is_parse_error_of(global: &JSGlobalObject, error: JSValue, url: &[u8]) -> bool {
    is_about_parsing(global, error)
        && location_of_source(global, error).is_some_and(|it| *it.url == *url)
}

/// `thrown` is the `JSC::Exception`, if there is one.
pub(crate) fn where_thrown(
    global: &JSGlobalObject,
    value: JSValue,
    thrown: Option<JSValue>,
) -> ScriptLocation {
    if !value.is_error() {
        return ScriptLocation::of_exception(global, thrown.unwrap_or(value));
    }
    let in_stack = stack_of(global, value)
        .filter(|_| !is_about_parsing(global, value))
        .and_then(|it| strings::split(it.as_bytes(), b"\n").find_map(location_of_frame));
    in_stack
        .or_else(|| location_of_source(global, value))
        .unwrap_or_default()
}

impl WindowTarget {
    fn tell_host<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        message: String,
        at: &ScriptLocation,
        error: JSValue,
        is_rejection: bool,
    ) {
        if is_program(global_of(self.realm(&cx.heap))) {
            return print_error(cx, error);
        }
        let url = bstr::ByteSlice::to_str_lossy(&*at.url).into_owned();
        if self.host().console_audience() == bun_web::host::ConsoleAudience::Inspector {
            let text = DomString::from_utf8(&message).to_js(&cx.heap).to_js();
            let is_of_world =
                !core::ptr::eq(Bun__IsolatedWorld__pageOrItself(cx.global()), cx.global());
            self.host()
                .link()
                .inspect(bun_web::host::Inspected::Exception {
                    text: &message,
                    url: &url,
                    line: at.line,
                    column: at.column,
                    error: if is_of_world { text } else { error },
                });
        }
        self.host().uncaught(
            message,
            url,
            at.line,
            at.column,
            stack_of(cx.global(), error).unwrap_or_default(),
            is_rejection,
        );
    }

    pub(crate) fn report_error_at<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        message: String,
        at: &ScriptLocation,
        error: JSValue,
    ) {
        if self.is_disposed() {
            return;
        }
        if self.has_listeners(atom!("error")) && !self.errors().is_reporting.replace(true) {
            let event = ErrorEvent::of_script(
                self.realm(&cx.heap),
                DomString::from_utf8(&message),
                at,
                error,
            );
            let is_unhandled = dispatch(cx, self, event);
            self.errors().is_reporting.set(false);
            if !is_unhandled {
                return;
            }
        }
        self.tell_host(cx, message, at, error, false);
    }

    /// <https://html.spec.whatwg.org/#report-an-exception>. `script` is the URL of what was running, if nothing else tells.
    pub(crate) fn report_exception<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        exception: JSValue,
        thrown: Option<JSValue>,
        script: &[u8],
    ) {
        let realm = self.realm(&cx.heap);
        let target = (!is_program(global_of(realm)))
            .then(|| WindowTarget::of_realm(realm))
            .flatten()
            .unwrap_or(self);
        if target.has_muted_errors(script)
            || target.is_muted(cx.global(), thrown.unwrap_or(exception), exception)
        {
            return target.report_error_at(
                cx,
                "Script error.".into(),
                &ScriptLocation::default(),
                JSValue::NULL,
            );
        }
        let mut at = where_thrown(cx.global(), exception, thrown);
        if at.url.is_empty() {
            at.url = script.into();
        }
        let message = format!("Uncaught {}", describe(cx.global(), exception));
        if Bun__IsolatedWorld__hasThrown(global_of(self.realm(&cx.heap)), exception) {
            return target.tell_host(cx, message, &at, exception, false);
        }
        target.report_error_at(cx, message, &at, exception);
    }

    pub(crate) fn mute_errors(&self, script: &[u8]) {
        if !self.has_muted_errors(script) {
            self.errors().muted.borrow_mut().push(script.into());
        }
    }

    fn has_muted_errors(&self, script: &[u8]) -> bool {
        self.errors()
            .muted
            .borrow()
            .iter()
            .any(|it| **it == *script)
    }

    /// Reading `value` would show it to `Error.prepareStackTrace`. `thrown` is empty for what is running.
    fn is_muted(&self, global: &JSGlobalObject, thrown: JSValue, value: JSValue) -> bool {
        !self.errors().muted.borrow().is_empty() && {
            let (mut thrower, mut maker) = (bun_core::String::EMPTY, bun_core::String::EMPTY);
            Bun__DesktopRealm__scriptsBehind(global, thrown, value, &mut thrower, &mut maker);
            [thrower, maker]
                .iter()
                .any(|it| self.has_muted_errors(&it.to_utf8()))
        }
    }

    fn is_global_of(&self, realm: &JsHeap<'_>) -> bool {
        core::ptr::eq(global_of(self.realm(realm)), global_of(realm))
    }

    /// False if it was canceled.
    fn fire_rejection_event<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        name: Known,
        promise: JSValue,
        reason: JSValue,
    ) -> bool {
        !self.has_listeners(name)
            || dispatch(
                cx,
                self,
                PromiseRejectionEvent::trusted(self.realm(&cx.heap), name, promise, reason),
            )
    }
}

/// To the realm of `cx`. The page does not hear of the errors of an isolated world.
pub(crate) fn report_to_realm(
    cx: Cx<'_, '_>,
    exception: JSValue,
    thrown: Option<JSValue>,
    script: &[u8],
) {
    let Some(window) = window_around(&cx.heap) else {
        return;
    };
    if window.is_global_of(&cx.heap) {
        return window.report_exception(cx, exception, thrown, script);
    }
    let (at, message) = (
        where_thrown(cx.global(), exception, thrown),
        format!("Uncaught {}", describe(cx.global(), exception)),
    );
    window.tell_host(cx, message, &at, exception, false);
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__reportException(
    global: &JSGlobalObject,
    exception: JSValue,
    thrown: JSValue,
) {
    // SAFETY: the engine is calling, where scripts may run.
    unsafe {
        JsScope::with(global.as_mut_ptr(), |cx| {
            report_to_realm(cx, exception, Some(thrown).filter(|it| !it.is_empty()), b"")
        })
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__promiseWasRejected(
    global: &JSGlobalObject,
    promise: JSValue,
    reason: JSValue,
) {
    fn notify<'a>(
        cx: Cx<'_, 'a>,
        [promise, reason]: [JsLocal<'a>; 2],
        _: u64,
        _: &[JsLocal<'a>],
    ) -> bindgen::Result<'a, JSValue> {
        if !Bun__DesktopRealm__isHandled(promise.to_js()) {
            notify_about_rejection(&cx.heap, promise.to_js(), reason.to_js());
        }
        Ok(JSValue::UNDEFINED)
    }
    let heap = JsHeap::from_global(global);
    if !WindowTarget::of_realm(heap).is_some_and(|it| {
        it.is_muted(global, reason, reason) || it.is_muted(global, JSValue::ZERO, reason)
    }) {
        bun_web::tasks::after_microtasks(
            global,
            heap.create_callback(notify, [promise, reason], 0).to_js(),
        );
    }
}

/// <https://html.spec.whatwg.org/#notify-about-rejected-promises>, for one of them
fn notify_about_rejection(heap: &JsHeap<'_>, promise: JSValue, reason: JSValue) {
    queue_task(heap, [promise, reason], |cx, values| {
        let ([promise, reason], Some(window)) =
            (values.map(|it| it.to_js()), window_around(&cx.heap))
        else {
            return;
        };
        if Bun__DesktopRealm__isHandled(promise) {
            return;
        }
        let at = where_thrown(cx.global(), reason, None);
        let is_of_page = window.is_global_of(&cx.heap);
        if !is_of_page
            || window.fire_rejection_event(cx, atom!("unhandledrejection"), promise, reason)
        {
            let message = format!("Uncaught (in promise) {}", describe(cx.global(), reason));
            window.tell_host(cx, message, &at, reason, true);
        }
        if is_of_page && !Bun__DesktopRealm__isHandled(promise) {
            Bun__DesktopRealm__rememberRejection(cx.global(), promise);
        }
    });
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__rejectionWasHandled(
    global: &JSGlobalObject,
    promise: JSValue,
    reason: JSValue,
) {
    queue_task(
        JsHeap::from_global(global),
        [promise, reason],
        |cx, [promise, reason]| {
            WindowTarget::of_realm(&cx.heap).map(|it| {
                it.fire_rejection_event(
                    cx,
                    atom!("rejectionhandled"),
                    promise.to_js(),
                    reason.to_js(),
                )
            });
        },
    );
}

pub(super) fn report<'a>(cx: Cx<'_, 'a>, window: Option<&'a WindowTarget>, exception: JSValue) {
    match window.or_else(|| WindowTarget::of_realm_or_program(&cx.heap)) {
        Some(window) => window.report_exception(cx, exception, None, b""),
        None => print_error(cx, exception),
    }
}

/// With the console of a program, which hands its own functions to what it prints.
pub(super) fn print_error(cx: Cx<'_, '_>, error: JSValue) {
    unsafe extern "C" {
        safe fn Bun__DesktopRealm__isOfPage(value: JSValue) -> bool;
    }
    let error = if Bun__DesktopRealm__isOfPage(error) {
        DomString::from_utf8(&describe(cx.global(), error))
            .to_js(&cx.heap)
            .to_js()
    } else {
        error
    };
    let program = bun_ui::main_global();
    member(program, program.to_js_value(), "console")
        .map(|it| call_directly(cx, it, "error", &[error]));
}
