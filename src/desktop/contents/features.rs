//! The third argument of `window.open()`.

use crate::prelude::*;
use crate::text::{split, split_once};

fn kind_of(name: &str) -> Option<fn(JSValue) -> bool> {
    Some(match name {
        "minWidth" | "minHeight" | "maxWidth" | "maxHeight" | "opacity" => JSValue::is_number,
        "title" | "titleBarStyle" | "backgroundColor" | "vibrancy" => JSValue::is_string,
        "show" | "center" | "useContentSize" | "frame" | "transparent" | "hasShadow"
        | "movable" | "closable" | "focusable" | "minimizable" | "maximizable"
        | "fullscreenable" | "alwaysOnTop" | "skipTaskbar" | "modal" | "acceptFirstMouse"
        | "autoHideMenuBar" | "resizable" => JSValue::is_boolean,
        _ => return None,
    })
}

/// Adds the options of a window that Electron takes from a page.
pub(super) fn add_options(options: JSValue, features: &str) -> JsResult<()> {
    for feature in split(features, ",") {
        let (name, value) = split_once(feature, "=").unwrap_or((feature, "yes"));
        let (name, value) = (name.trim(), crate::text::before(value, "=").trim());
        let value = match (value, value.parse::<i32>()) {
            (_, Ok(number)) => number.into(),
            ("yes" | "true", _) => JSValue::TRUE,
            ("no" | "false", _) => JSValue::FALSE,
            _ => js(value)?,
        };
        if kind_of(name).is_some_and(|is_of_it| is_of_it(value)) {
            options.put(global(), name.as_bytes(), value);
        }
    }
    Ok(())
}
