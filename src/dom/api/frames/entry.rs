//! For the controls of a page.

use super::*;

pub(crate) fn contexts_of_local_frames<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> Vec<JSValue> {
    let peers = indexed(ui)
        .filter(|it| it.kind == Kind::Local)
        .filter_map(js_Frame::peer)
        .filter(|it| it.is_object());
    peers
        .filter_map(|it| crate::api::core::by_name::member(cx.global(), it, "context"))
        .collect()
}

/// `None` if no frame has the focus.
pub(crate) fn tell_focused_frame<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    method: &str,
    argument: JSValue,
) -> Option<JSValue> {
    ui.focused_frame()
        .filter(|it| !it.is(Flags::CLOSED))
        .map(|it| host::tell_peer(cx, it, method, &[argument]))
}

pub(crate) fn frame_count(ui: &Ui) -> u32 {
    indexed(ui).count() as u32
}

pub(crate) fn fit_container<'a>(cx: &mut Cx<'a>, doc: &'a Doc) {
    Ui::of(doc)
        .and_then(Ui::container)
        .into_iter()
        .for_each(|it| it.fit(cx, crate::api::core::metadata::sizes_container(doc)));
}

/// Right after `load` at the window. The host tells the elements in documents of other origins.
pub(crate) fn fire_load_at_container<'a>(cx: &mut Cx<'a>, doc: &'a Doc) {
    let Some((ui, frame)) = Ui::of(doc).and_then(|it| Some((it, it.container()?))) else {
        return;
    };
    if frame.is_current() && !frame.is(Flags::CLOSED) && !plugins::is_plugin(frame.element()) {
        frame.set(Flags::HAS_FIRED_LOAD, true);
        match host::are_of_same_origin(ui, frame.around()) {
            true => _ = fire(cx, frame.element(), atom!("load"), PLAIN),
            false => frame.fire_load_later(cx),
        }
    }
}

pub(crate) fn is_in_frame(ui: &Ui) -> bool {
    ui.container().is_some()
}

pub(crate) fn close_frames<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    ui.frames()
        .iter()
        .filter(|it| it.is_current())
        .for_each(|it| close(cx, it.element()));
}
