//! <https://console.spec.whatwg.org/>

use bun_web::client::ScriptLocation;
use bun_web::host::{ConsoleAudience, Level};

use super::*;
use crate::api::events::{describe, stack_of};

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

/// `method` is what the inspector calls it.
fn write<'a>(cx: Cx<'_, 'a>, level: Level, method: &str, first: Option<&str>, data: Data<'_, 'a>) {
    let Some(window) = WindowTarget::of_realm(&cx.heap) else {
        return;
    };
    let audience = window.host().console_audience();
    if audience == ConsoleAudience::Nobody {
        return;
    }
    let text = |it: &str| DomString::from_utf8(it).to_js(&cx.heap).to_js();
    let (name, method, first) = (method, text(method), first.map(text));
    let all: Vec<JSValue> = [method]
        .into_iter()
        .chain(first)
        .chain(data.iter().map(|it| it.to_js()))
        .collect();
    let (at, message) = (
        ScriptLocation::now(cx.global()),
        format(cx.global(), &all[1..]),
    );
    if audience == ConsoleAudience::Inspector {
        window
            .host()
            .link()
            .inspect(bun_web::host::Inspected::Console {
                method: name,
                values: &all[1..],
            });
    }
    method.ensure_still_alive();
    first.into_iter().for_each(JSValue::ensure_still_alive);
    window.host().console(
        level,
        message,
        at.line,
        bstr::ByteSlice::to_str_lossy(&*at.url).into_owned(),
    );
}

fn write_elapsed<'a>(cx: Cx<'_, 'a>, label: &[u8], data: Data<'_, 'a>) {
    let start =
        Realm::of(cx.global()).and_then(|it| it.console_timers.borrow().get(label).copied());
    if let Some(start) = start {
        write(
            cx,
            Level::Info,
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
            write(cx, Level::$level, $method, None, data);
        }
    )*};
}

impl Console {
    loggers! {
        log Info "log" info Info "info" debug Debug "debug" warn Warning "warning" error Error "error" trace Info "trace" dir Info "dir"
        dirxml Info "dirxml" table Info "table" group Info "startGroup" group_collapsed Info "startGroupCollapsed"
    }

    pub(crate) fn nothing() {}

    pub(crate) fn assert<'a>(cx: Cx<'_, 'a>, condition: bool, data: Data<'_, 'a>) {
        if !condition {
            write(
                cx,
                Level::Error,
                "assert",
                Some(if data.is_empty() {
                    "Assertion failed: console.assert"
                } else {
                    "Assertion failed:"
                }),
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
            Level::Info,
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
