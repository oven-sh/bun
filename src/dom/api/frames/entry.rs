//! For the controls of a page.

use bun_web::host::ToGuest;
use bun_web::page::{Focused, News};

use super::*;
use crate::api::history::ForeignWindow;

pub(crate) fn local_contexts(ui: &Ui) -> impl Iterator<Item = &Context> {
    indexed(ui).filter_map(Frame::context)
}

/// What its host calls the page in it.
pub(crate) fn page_in(element: &Element) -> Option<u32> {
    Some(Frame::of(element)?.context()?.page())
}

pub(crate) fn windows_in_this_process(
    doc: &Doc,
) -> impl Iterator<Item = (&Element, Option<&Window>)> {
    Ui::of(doc)
        .into_iter()
        .flat_map(indexed)
        .filter(|it| it.kind != Kind::Remote)
        .map(|it| (it.element(), it.inner_window()))
}

fn focused(ui: &Ui) -> Option<&Frame> {
    ui.focused_frame().filter(|it| !it.is(Flags::CLOSED))
}

pub(crate) fn focused_frame(window: &Window) -> Focused {
    let Some(frame) = Ui::of(window.document()).and_then(focused) else {
        return Focused::Itself;
    };
    match (frame.context(), frame.inner_window().map(focused_frame)) {
        (None, _) => Focused::Guest {
            page: window.page,
            frame: frame.number,
        },
        (Some(context), None | Some(Focused::Itself)) => Focused::Page(context.page()),
        (_, Some(below)) => below,
    }
}

/// `None` if there is no document in this process.
pub(crate) fn window_to_edit<'a>(window: &'a Window, command: &str) -> Option<&'a Window> {
    let Some(frame) = Ui::of(window.document()).and_then(focused) else {
        return Some(window);
    };
    if frame.kind == Kind::Remote {
        host::tell_remote(frame, ToGuest::Edit(command.into()));
    }
    window_to_edit(frame.inner_window()?, command)
}

pub(crate) fn tell<'a>(cx: &mut Cx<'a>, outer: &'a Window, number: u32, news: News) {
    let Some(frame) = Frame::with_number(outer, number) else {
        return outer.tell_popup(cx, number, news);
    };
    match news {
        News::Loading => frame.loading(cx),
        News::Navigating => frame.navigating(),
        News::Finished { fires_load } => frame.finished(cx, fires_load),
        News::Measure => frame.measure(cx),
        News::UseWebEngine(url) => frame.use_web_engine(cx, &DomString::from_utf8(&url)),
        News::ShowImage(url) => frame.show_image(cx, &DomString::from_utf8(&url)),
        News::Focus => frame.focus(cx),
        News::Loaded(length) => frame.loaded(cx, length),
        News::Painted(image) => frame.painted(cx, image),
        News::Scroll(delta) => frame.scroll(cx, delta),
        News::Fullscreen(is_on) => frame.fullscreen(cx, is_on),
        News::Tab { is_backward } => frame.tab(cx, is_backward),
        News::Tooltip(text) => frame.tooltip(cx, &DomString::from_utf8(&text)),
        News::Message {
            path,
            origin,
            message,
        } => {
            if let Some(window) = js_Frame::peer(frame).and_then(ForeignWindow::from_value) {
                window.receive(cx, &path, &origin, message);
            }
        }
        News::Closed => {}
    }
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
