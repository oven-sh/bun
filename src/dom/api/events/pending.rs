//! What dispatching needs of the rest.

use super::*;
use crate::api::core::by_name::{call_directly, member};

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
        DomString::from_utf8(&super::errors::describe(cx.global(), error))
            .to_js(&cx.heap)
            .to_js()
    } else {
        error
    };
    let program = bun_ui::main_global();
    member(program, program.to_js_value(), "console")
        .map(|it| call_directly(cx, it, "error", &[error]));
}

pub(super) fn can_activate(element: &Element) -> bool {
    crate::api::forms::can_activate(element)
}

pub(super) fn pre_activate<'a>(cx: Cx<'_, 'a>, element: &'a Element) -> JSValue {
    element
        .kind()
        .steps()
        .pre_activate
        .map_or(JSValue::UNDEFINED, |step| step(cx, element))
}

pub(super) fn activate<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    event: &'a Event,
    origin: &'a Node,
    saved: JSValue,
) {
    if let Some(step) = element.kind().steps().activate {
        step(cx, element, event, origin, saved);
    }
}

pub(super) fn cancel_activate<'a>(cx: Cx<'_, 'a>, element: &'a Element, saved: JSValue) {
    if let Some(step) = element.kind().steps().cancel_activate {
        step(cx, element, saved);
    }
}
