//! What embeds the window.

use bun_core::WTFStringImplStruct;

use super::view::FromContainer;
use super::*;
use crate::api::frames::Frame;
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
}

pub(super) fn from_container<'a>(cx: Cx<'_, 'a>, window: &'a Window) -> FromContainer {
    const DARK: u32 = 1 << 17;
    const HAS_SCHEME: u32 = 1 << 18;
    let container = Ui::of(window.document()).and_then(Ui::container);
    let bits = container.map_or(0, |it| it.color_scheme(cx));
    FromContainer {
        is_dark: (bits & HAS_SCHEME != 0).then_some(bits & DARK != 0),
        looks_dark: bits & DARK != 0,
        cannot_scroll: container.is_some_and(Frame::forbids_scrolling),
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
        Window::from_js(&cx.heap, window)
            .map_or(JSValue::NULL, |it| it.named(cx, &Atom::from_impl(name)))
    };
    // SAFETY: a lookup, which may run scripts, is calling.
    unsafe { JsScope::with(global.as_mut_ptr(), find) }
}
