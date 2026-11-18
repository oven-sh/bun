//! What hosts the documents of frames.

use bun_web::host::{Owner, ToFrame, ToGuest, Whereabouts};
use bun_web::input::{Action, Input, Mouse};

use super::*;
use crate::api::history::ForeignWindow;
use crate::api::ui::surface;
use crate::generated_bindgen::window::js_DomWindow;

fn text(value: &DomString) -> String {
    value.to_utf8().into_owned()
}

pub(super) fn tell_local(frame: &Frame, message: ToFrame) {
    if let Some(window) = frame.around().doc().last_window() {
        window.host().tell_frame(frame.number, message);
    }
}

pub(super) fn tell_remote(frame: &Frame, message: ToGuest) {
    if let Some(window) = frame.around().doc().last_window() {
        window.host().tell_guest(frame.number, message);
    }
}

pub(super) fn is_local(ui: &Ui, url: &DomString) -> bool {
    ui.doc()
        .last_window()
        .is_some_and(|it| it.host().is_local_frame(url.to_utf8().into_owned()))
}

pub(super) fn has_web_engine(ui: &Ui) -> bool {
    ui.doc()
        .last_window()
        .is_some_and(|it| it.host().has_web_engine())
}

/// In the whole tree.
pub(super) fn take_room(ui: &Ui) -> bool {
    const MAX_FRAMES: u32 = 1000;
    let is_full = ui
        .doc()
        .last_window()
        .is_some_and(|it| it.host().count_frames(1) > MAX_FRAMES);
    if is_full {
        give_room_back(ui);
    }
    !is_full
}

pub(super) fn give_room_back(ui: &Ui) {
    ui.doc()
        .last_window()
        .into_iter()
        .for_each(|it| _ = it.host().count_frames(-1));
}

pub(super) fn are_of_same_origin(a: &Ui, b: &Ui) -> bool {
    let [a, b] = [a, b].map(|it| it.doc().last_window().and_then(|it| it.host().origin_key()));
    a == b
}

pub(super) fn place_again(ui: &Ui) {
    Window::of(ui.doc())
        .into_iter()
        .for_each(Window::forget_layout);
}

fn owner(frame: &Frame) -> Box<Owner> {
    let attribute = |name| frame.element().attr(name).as_ref().map(text);
    Box::new(Owner {
        kind: text(&frame.element().local().to_dom_string()),
        name: text(&frame.name()),
        src: attribute(atom!("src")),
        has_srcdoc: frame.element().has_attr(atom!("srcdoc")),
        sandbox: attribute(atom!("sandbox")),
        allow: attribute(atom!("allow")),
        allows_fullscreen: frame.element().has_attr(atom!("allowfullscreen")),
        csp: attribute(atom!("csp")),
        is_indexed: frame.is_indexed(),
        forbids_scrolling: frame.forbids_scrolling(),
        margins: [atom!("marginwidth"), atom!("marginheight")].map(attribute),
    })
}

pub(super) fn owner_changed(frame: &Frame) {
    tell_local(frame, ToFrame::OwnerChanged(owner(frame)));
}

pub(super) fn connect<'a>(cx: &mut Cx<'a>, frame: &'a Frame) {
    let Some(outer) = frame.outer_window() else {
        return js_Frame::set_window(frame, JSValue::NULL);
    };
    match frame.kind {
        Kind::Blank => {
            let window = outer.open_empty_frame(cx);
            let parsed =
                crate::api::loading::parse_html(cx, window.document(), &DomString::default());
            bun_web::exec::report(cx, parsed);
            js_Frame::set_window(frame, window.window());
            frame.set_inner(Ui::of(window.document()));
            js_DomWindow::set_empty_frame(window, frame.element().to_js());
        }
        Kind::Local => {
            let before = CONNECTING.replace(frame.to_js());
            outer.host().create_frame(frame.number, owner(frame));
            CONNECTING.set(before);
        }
        Kind::Remote => {
            let window = ForeignWindow::of_frame(&cx.heap, outer, frame);
            js_Frame::set_window(frame, window.get_itself());
            js_Frame::set_peer(frame, window.to_js());
            outer
                .host()
                .create_guest(frame.number, frame.surface_scale());
        }
    }
}

pub(super) fn dispose(frame: &Frame) {
    match frame.kind {
        Kind::Blank => frame
            .inner_window()
            .into_iter()
            .for_each(|it| it.enter(|cx, it| it.close_page(cx))),
        Kind::Local => tell_local(frame, ToFrame::Remove),
        Kind::Remote => tell_remote(frame, ToGuest::Remove),
    }
}

pub(super) fn input(frame: &Frame, input: Input) {
    if frame.kind == Kind::Remote {
        if let Input::Mouse(Mouse {
            action: Action::Down,
            ..
        }) = input
        {
            tell_remote(frame, ToGuest::Moved(whereabouts(frame)));
        }
        return tell_remote(frame, ToGuest::Input(input));
    }
    if frame.is_apart() && !frame.context().is_some_and(Context::has_crashed) {
        return tell_local(frame, ToFrame::Input(input));
    }
    match (frame.inner_window(), input) {
        (Some(window), input) => {
            window.enter_as_task(|cx, window, ui| surface::handle_input(cx, window, ui, input))
        }
        (None, Input::Key(key)) => {
            if let Some(outer) = frame.outer_window().filter(|_| key.is_down) {
                outer.host().unhandled_key(key);
            }
            crate::api::ui::host::key_handled();
        }
        _ => {}
    }
}

// ───────────────────────────── in this process ─────────────────────────────

pub(super) fn window<'a>(cx: &mut Cx<'a>, frame: &'a Frame) -> JSValue {
    let both = frame.context().zip(
        frame
            .around()
            .doc()
            .last_window()
            .and_then(|it| it.downcast::<Window>()?.cluster()),
    );
    both.map_or(JSValue::NULL, |(context, cluster)| {
        context.window_for(&cx.heap, cluster)
    })
}

pub(super) fn document(frame: &Frame) -> Option<&Doc> {
    let (context, outer) = (frame.context()?, frame.outer_window()?);
    context
        .has_origin(outer.cluster()?)
        .then(|| Some(context.started_window(outer)?.document()))?
}

pub(super) fn name(frame: &Frame) -> DomString {
    frame
        .context()
        .map(|it| DomString::from_utf8(&it.name()))
        .unwrap_or_default()
}

pub(super) fn is_initial(frame: &Frame) -> bool {
    frame.context().is_some_and(|it| {
        it.window()
            .map_or_else(|| it.is_initial(), |it| it.host().is_initial())
    })
}

pub(super) fn set_initial_url(frame: &Frame, url: &DomString) {
    tell_local(frame, ToFrame::SetInitialUrl(text(url)));
}

pub(super) fn navigate_local(frame: &Frame, navigation: &Navigation) {
    tell_local(
        frame,
        ToFrame::Navigate {
            url: text(&navigation.url),
            srcdoc: navigation.srcdoc.as_ref().map(text),
            referrer_policy: text(&navigation.referrer_policy),
            blob: None,
        },
    );
}

pub(super) fn place_local(frame: &Frame, size: [f64; 2], is_visible: bool) {
    let (scale, is_news) = (frame.surface_scale(), |it| {
        frame.placement.replace(it) != it
    });
    if is_news(Some((size, scale, is_visible))) {
        tell_local(
            frame,
            ToFrame::Place {
                size,
                scale,
                is_visible,
            },
        );
        frame
            .inner_window()
            .into_iter()
            .for_each(|it| frame.give_size_to(it));
    }
}

pub(super) fn may_be_unloaded(frame: &Frame) -> bool {
    frame
        .inner_window()
        .is_none_or(|it| it.enter(crate::api::history::entry::may_leave))
}

pub(super) fn stop(frame: &Frame) {
    match frame.inner_window() {
        Some(window) => window.enter_as_task(|cx, window, _| window.stop(cx)),
        None => tell_local(frame, ToFrame::Stop),
    }
}

pub(super) fn environment_changed(frame: &Frame) {
    frame
        .inner_window()
        .into_iter()
        .for_each(|it| it.enter(|cx, it| it.environment_changed(cx)));
}

// ───────────────────────────── in the web engine ─────────────────────────────

fn whereabouts(frame: &Frame) -> Whereabouts {
    Whereabouts {
        area: frame.area(),
        origin: frame.origin(),
        scale: frame.surface_scale(),
    }
}

pub(super) fn navigate_remote(frame: &Frame, url: &DomString) {
    let all = frame
        .element()
        .attrs()
        .into_iter()
        .map(|(name, value)| (text(&name.local.to_dom_string()), value));
    let copied = all
        .filter(|it| remote::is_copied(&it.0))
        .map(|(name, value)| (name, text(&value)));
    tell_remote(
        frame,
        ToGuest::Navigate(copied.chain([("src".into(), text(url))]).collect()),
    );
}

pub(super) fn copy_attribute(frame: &Frame, name: &DomString, value: Option<&DomString>) {
    tell_remote(
        frame,
        ToGuest::Attribute {
            name: text(name),
            value: value.map(text),
        },
    );
}

pub(super) fn place_remote<'a>(
    cx: &mut Cx<'a>,
    frame: &'a Frame,
    size: [f64; 2],
    is_visible: bool,
) {
    let color_scheme = text(&DomString::from_latin1(&layout::computed(
        cx,
        frame.element(),
        "color-scheme",
    )));
    let is_visible = is_visible
        && frame
            .outer_window()
            .is_some_and(|it| it.environment().is_visible);
    tell_remote(
        frame,
        ToGuest::Place {
            size,
            is_visible,
            color_scheme,
            zoom: layout::zoom(frame.around().doc()),
            whereabouts: whereabouts(frame),
        },
    );
}
