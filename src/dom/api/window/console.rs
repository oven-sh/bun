//! <https://console.spec.whatwg.org/>

use bun_web::client::ScriptLocation;
use bun_web::host::{ConsoleAudience, Level, Logged};

use super::*;
use crate::api::events::{describe, stack_of, window_around};

type Data<'r, 'a> = &'r [JsLocal<'a>];

pub(crate) struct Console;

/// As `parseInt(text, 10)` or `parseFloat(text)`.
fn leading_number(text: &str, is_integer: bool) -> f64 {
    let text = text.trim_start();
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    if !is_integer && unsigned.starts_with("Infinity") {
        return if text.starts_with('-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    let length = unsigned
        .bytes()
        .take_while(|it| it.is_ascii_digit() || (!is_integer && b".eE+-".contains(it)))
        .count();
    let longest = text.len() - unsigned.len() + length;
    (1..=longest)
        .rev()
        .take(64)
        .find_map(|end| text[..end].parse().ok())
        .unwrap_or(f64::NAN)
}

/// <https://console.spec.whatwg.org/#formatter>
fn format(global: &JSGlobalObject, mut values: &[JSValue]) -> String {
    let mut text = String::new();
    let mut is_first = true;
    if let [pattern, rest @ ..] = values
        && pattern.is_string()
        && !rest.is_empty()
    {
        (values, is_first) = (rest, false);
        let pattern = describe(global, *pattern);
        let mut pattern = &*pattern;
        while let Some(at) = bun_core::strings::index_of_char_usize(pattern.as_bytes(), b'%') {
            let (before, after) = (&pattern[..at], &pattern[at + 1..]);
            text.push_str(before);
            pattern = after;
            match (after.bytes().next(), values) {
                (Some(b'%'), _) => text.push('%'),
                (
                    Some(specifier @ (b's' | b'd' | b'i' | b'f' | b'o' | b'O' | b'c')),
                    [value, rest @ ..],
                ) => {
                    values = rest;
                    match specifier {
                        b'c' => {}
                        b'd' | b'i' | b'f' => text.push_str(&describe(
                            global,
                            JSValue::js_number(leading_number(
                                &describe(global, *value),
                                specifier != b'f',
                            )),
                        )),
                        _ => text.push_str(&describe(global, *value)),
                    }
                }
                _ => {
                    text.push('%');
                    continue;
                }
            }
            pattern = &after[1..];
        }
        text.push_str(pattern);
    }
    for value in values {
        if !core::mem::take(&mut is_first) {
            text.push(' ');
        }
        text.push_str(&stack_of(global, *value).unwrap_or_else(|| describe(global, *value)));
    }
    text
}

unsafe extern "C" {
    safe fn Bun__Inspector__stack(realm: &JSGlobalObject, thrown: JSValue, most: u32) -> JSValue;
    safe fn Bun__Inspector__brief(realm: &JSGlobalObject, object: JSValue) -> JSValue;
}

const REMEMBERED: u32 = 128;

pub(crate) fn is_noted(audience: ConsoleAudience) -> bool {
    !matches!(audience, ConsoleAudience::Nobody | ConsoleAudience::App)
}

/// For an inspector. One that comes later gets no objects. `heap` is the realm of the values.
pub(crate) fn note<'a>(
    heap: &JsHeap<'a>,
    window: &'a WindowTarget,
    audience: ConsoleAudience,
    kind: &str,
    stack: JSValue,
    values: &[JSValue],
) {
    const LONGEST: usize = 1 << 13;
    let Some(holder) = window.downcast::<Window>() else {
        return;
    };
    let (realm, time) = (
        global_of(heap).to_js_value(),
        bun_web::time::wall_now() * 1e3,
    );
    let short = |it: &JSValue| {
        let it = if it.is_object() {
            Bun__Inspector__brief(global_of(heap), *it)
        } else {
            *it
        };
        if it.is_string() && it.as_string().length() > LONGEST {
            DomString::from_utf8("…").to_js(heap).to_js()
        } else {
            it
        }
    };
    let entry = List::with_capacity(heap, values.len() as u32 + 4);
    [
        realm,
        Atom::new(kind).to_js(heap).to_js(),
        JSValue::js_number(time),
        stack,
    ]
    .into_iter()
    .chain(values.iter().map(short))
    .for_each(|it| entry.push(heap, it));
    let log = js_DomWindow::log(holder)
        .filter(|_| kind != "clear")
        .map_or_else(|| List::new(heap), List::from_value);
    js_DomWindow::set_log(holder, log.to_js());
    if log.len() == 2 * REMEMBERED {
        log.remove_range(heap, 0, REMEMBERED);
    }
    log.push(heap, entry.to_js());
    if audience == ConsoleAudience::Inspector {
        window.host().link().inspect(Logged {
            realm,
            kind,
            time,
            stack,
            values,
        });
    }
}

fn window_in(value: JSValue) -> Option<&'static Window> {
    EventTarget::resolve(JsHeap::from_global(bun_ui::main_global()), value)?
        .as_window()?
        .downcast()
}

#[unsafe(no_mangle)]
fn __bun_dom_recall_log(window: JSValue, visit: &mut dyn FnMut(Logged<'_>)) {
    let Some(log) = window_in(window).and_then(js_DomWindow::log) else {
        return;
    };
    for entry in List::from_value(log).values().take(2 * REMEMBERED as usize) {
        let all: Vec<_> = List::from_value(entry).values().collect();
        visit(Logged {
            realm: all[0],
            kind: &describe(bun_ui::main_global(), all[1]),
            time: all[2].as_number(),
            stack: all[3],
            values: &all[4..],
        });
        entry.ensure_still_alive();
    }
}

#[unsafe(no_mangle)]
fn __bun_dom_forget_log(window: JSValue) {
    window_in(window).inspect(|it| js_DomWindow::set_log(it, JSValue::ZERO));
}

/// `method` is what the inspector calls it.
fn write<'a>(
    cx: Cx<'_, 'a>,
    level: Option<Level>,
    method: &str,
    first: Option<&str>,
    data: Data<'_, 'a>,
) {
    let Some(window) = window_around(&cx.heap) else {
        return;
    };
    let audience = window.host().console_audience();
    if audience == ConsoleAudience::Nobody {
        return;
    }
    let first = first.map(|it| DomString::from_utf8(it).to_js(&cx.heap).to_js());
    let all: smallvec::SmallVec<[JSValue; 8]> = first
        .into_iter()
        .chain(data.iter().map(|it| it.to_js()))
        .collect();
    if is_noted(audience) {
        let stack = if audience == ConsoleAudience::Inspector {
            Bun__Inspector__stack(cx.global(), JSValue::ZERO, 200)
        } else {
            JSValue::UNDEFINED
        };
        note(&cx.heap, window, audience, method, stack, &all);
        Realm::of(cx.global())
            .filter(|_| method.starts_with("startGroup"))
            .inspect(|it| it.console_groups.update(|it| it.saturating_add(1)));
    }
    if let Some(level) = level.filter(|_| audience != ConsoleAudience::Posterity) {
        let (at, message) = (ScriptLocation::now(cx.global()), format(cx.global(), &all));
        let message = if method == "assert" {
            format!("Assertion failed: {message}")
        } else {
            message
        };
        window.host().console(
            level,
            message,
            at.line,
            bstr::ByteSlice::to_str_lossy(&*at.url).into_owned(),
        );
    }
    first.into_iter().for_each(JSValue::ensure_still_alive);
}

fn write_elapsed<'a>(cx: Cx<'_, 'a>, label: &[u8], data: Data<'_, 'a>) {
    let start =
        Realm::of(cx.global()).and_then(|it| it.console_timers.borrow().get(label).copied());
    if let Some(start) = start {
        write(
            cx,
            Some(Level::Info),
            "timeEnd",
            Some(&format!(
                "{}: {} ms",
                crate::values::text(label),
                events::now() - start
            )),
            data,
        );
    }
}

macro_rules! loggers {
    ($($name:ident $level:ident $method:literal)*) => {$(
        pub(crate) fn $name<'a>(cx: Cx<'_, 'a>, data: Data<'_, 'a>) {
            write(cx, Some(Level::$level), $method, None, data);
        }
    )*};
}

impl Console {
    loggers! {
        log Info "log" info Info "info" debug Debug "debug" warn Warning "warning" error Error "error" trace Info "trace" dir Info "dir"
        dirxml Info "dirxml" table Info "table" group Info "startGroup" group_collapsed Info "startGroupCollapsed"
    }

    pub(crate) fn nothing() {}

    pub(crate) fn clear(cx: Cx<'_, '_>) {
        write(cx, None, "clear", Some("console.clear"), &[]);
    }

    pub(crate) fn group_end(cx: Cx<'_, '_>) {
        if Realm::of(cx.global()).is_some_and(|it| {
            it.console_groups
                .replace(it.console_groups.get().saturating_sub(1))
                > 0
        }) {
            write(cx, None, "endGroup", Some("console.groupEnd"), &[]);
        }
    }

    pub(crate) fn assert<'a>(cx: Cx<'_, 'a>, condition: bool, data: Data<'_, 'a>) {
        if !condition {
            write(
                cx,
                Some(Level::Error),
                "assert",
                data.is_empty().then_some("console.assert"),
                data,
            );
        }
    }

    pub(crate) fn count(cx: Cx<'_, '_>, label: &[u8]) {
        let Some(realm) = Realm::of(global_of(&cx.heap)) else {
            return;
        };
        let count = realm
            .console_counts
            .borrow()
            .get(label)
            .map_or(1, |it| it + 1);
        realm
            .console_counts
            .borrow_mut()
            .insert(label.into(), count);
        write(
            cx,
            Some(Level::Info),
            "count",
            Some(&format!("{}: {count}", crate::values::text(label))),
            &[],
        );
    }

    pub(crate) fn count_reset(cx: Cx<'_, '_>, label: &[u8]) {
        Realm::of(cx.global()).map(|it| it.console_counts.borrow_mut().remove(label));
    }

    pub(crate) fn time(cx: Cx<'_, '_>, label: &[u8]) {
        if let Some(realm) =
            Realm::of(cx.global()).filter(|it| !it.console_timers.borrow().contains_key(label))
        {
            realm
                .console_timers
                .borrow_mut()
                .insert(label.into(), events::now());
        }
    }

    pub(crate) fn time_log<'a>(cx: Cx<'_, 'a>, label: &[u8], data: Data<'_, 'a>) {
        write_elapsed(cx, label, data);
    }

    pub(crate) fn time_end(cx: Cx<'_, '_>, label: &[u8]) {
        write_elapsed(cx, label, &[]);
        Realm::of(cx.global()).map(|it| it.console_timers.borrow_mut().remove(label));
    }
}
