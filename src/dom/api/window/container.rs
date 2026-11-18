//! What embeds the window.

use bun_core::WTFStringImplStruct;

use super::view::FromContainer;
use super::*;
use crate::api::ui::Ui;

pub(super) fn measure_container<'a>(cx: Cx<'_, 'a>, window: &'a Window) {
    Ui::of(window.document())
        .and_then(Ui::container)
        .into_iter()
        .for_each(|it| it.measure(cx));
}

pub(super) fn is_container_inert<'a>(cx: Cx<'_, 'a>, window: &'a Window) -> bool {
    Ui::of(window.document())
        .and_then(Ui::container)
        .is_some_and(|it| it.is_inert(cx))
        || window
            .environment()
            .container
            .as_ref()
            .is_some_and(|it| it.looks.is_inert)
}

pub(super) fn from_container<'a>(cx: Cx<'_, 'a>, window: &'a Window) -> FromContainer {
    match Ui::of(window.document()).and_then(Ui::container) {
        Some(it) => FromContainer::new(it.color_scheme(cx), it.forbids_scrolling(), it.is_object()),
        None => window
            .environment()
            .container
            .as_ref()
            .map(FromContainer::from)
            .unwrap_or_default(),
    }
}

impl FromContainer {
    fn new(color_scheme: u32, cannot_scroll: bool, is_object: bool) -> FromContainer {
        const DARK: u32 = 1 << 17;
        const HAS_SCHEME: u32 = 1 << 18;
        FromContainer {
            is_dark: (color_scheme & HAS_SCHEME != 0).then_some(color_scheme & DARK != 0),
            looks_dark: color_scheme & DARK != 0,
            cannot_scroll,
            is_object,
        }
    }
}

impl From<&bun_web::host::Container> for FromContainer {
    fn from(it: &bun_web::host::Container) -> FromContainer {
        FromContainer::new(it.looks.color_scheme, it.forbids_scrolling, it.is_object)
    }
}

/// <https://html.spec.whatwg.org/#named-access-on-the-window-object>
#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__namedInWindow(
    global: &JSGlobalObject,
    window: JSValue,
    name: &WTFStringImplStruct,
) -> JSValue {
    let find = |cx: Cx<'_, '_>| {
        Window::from_js(&cx.heap, window).map_or(JSValue::NULL, |it| {
            Atom::with_impl(name, |name| it.named(cx, name))
        })
    };
    // SAFETY: a lookup, which may run scripts, is calling.
    unsafe { JsScope::with(global.as_mut_ptr(), find) }
}
