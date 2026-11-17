//! What hosts the documents of frames.

use super::input::Event;
use super::*;
use crate::api::core::by_name::{call_directly, member};
use crate::generated_bindgen::window::js_DomWindow;

fn number(value: impl Into<f64>) -> JSValue {
    JSValue::js_number(value.into())
}

fn string(cx: &Cx<'_>, value: &DomString) -> JSValue {
    value.to_js(&cx.heap).to_js()
}

pub(super) fn tell_peer<'a>(
    cx: &mut Cx<'a>,
    frame: &'a Frame,
    method: &str,
    arguments: &[JSValue],
) -> JSValue {
    js_Frame::peer(frame)
        .filter(|it| it.is_object())
        .map_or(JSValue::UNDEFINED, |it| {
            call_directly(cx, it, method, arguments)
        })
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

fn open_empty<'a>(cx: &mut Cx<'a>, outer: &'a Window) -> JSValue {
    let window = outer.open_empty_frame(cx);
    let parsed = crate::api::loading::parse_html(cx, window.document(), &DomString::default());
    bun_web::exec::report(cx, parsed);
    crate::api::ui::controls::create_controls(&cx.heap, window).to_js()
}

pub(super) fn connect<'a>(cx: &mut Cx<'a>, frame: &'a Frame) {
    let peer = match frame.kind {
        Kind::Blank => frame
            .around()
            .doc()
            .last_window()
            .and_then(|it| it.downcast())
            .map_or(JSValue::UNDEFINED, |it| open_empty(cx, it)),
        Kind::Local => frame
            .outer_window()
            .and_then(|it| it.ask_host(cx, "createLocalFrame", &[frame.to_js()]))
            .unwrap_or(JSValue::UNDEFINED),
        Kind::Remote => {
            let [window, peer] = frame.outer_window().map_or([JSValue::NULL; 2], |it| {
                crate::api::history::ForeignWindow::of_frame(cx, it, frame)
            });
            js_Frame::set_window(frame, window);
            return js_Frame::set_peer(frame, peer);
        }
    };
    js_Frame::set_peer(frame, peer);
    let get = |cx: &mut Cx<'a>, name: &'static str| member(cx.global(), peer, name);
    match frame.kind {
        Kind::Local => frame
            .image
            .set(get(cx, "image").map_or(0, |it| it.as_number() as u32)),
        _ => js_Frame::set_window(frame, get(cx, "window").unwrap_or(JSValue::NULL)),
    }
    if frame.kind == Kind::Blank {
        let window = frame.window(cx);
        let doc = WindowTarget::of(&cx.heap, window).and_then(WindowTarget::doc);
        frame.set_inner(doc.and_then(Ui::of));
        doc.and_then(Window::of)
            .into_iter()
            .for_each(|it| js_DomWindow::set_empty_frame(it, frame.element().to_js()));
    }
}

pub(super) fn dispose<'a>(cx: &mut Cx<'a>, frame: &'a Frame) {
    tell_peer(cx, frame, "dispose", &[]);
}

pub(super) fn input<'a>(cx: &mut Cx<'a>, frame: &'a Frame, event: Event<'a>) {
    tell_peer(cx, frame, "input", &[event.0.to_js()]);
}

// ───────────────────────────── in this process ─────────────────────────────

pub(super) fn window<'a>(cx: &mut Cx<'a>, frame: &'a Frame) -> JSValue {
    tell_peer(cx, frame, "window", &[])
}

pub(super) fn document<'a>(cx: &mut Cx<'a>, frame: &'a Frame) -> Option<&'a Doc> {
    Doc::from_value(tell_peer(cx, frame, "document", &[]))
}

pub(super) fn name<'a>(cx: &mut Cx<'a>, frame: &'a Frame) -> DomString {
    let name = tell_peer(cx, frame, "name", &[]);
    JsLocal::new(&cx.heap, name)
        .as_string()
        .and_then(|it| DomString::from_js_string(&cx.heap, it).ok())
        .unwrap_or_default()
}

pub(super) fn is_initial<'a>(cx: &mut Cx<'a>, frame: &'a Frame) -> bool {
    tell_peer(cx, frame, "isInitial", &[]).to_boolean()
}

pub(super) fn set_initial_url<'a>(cx: &mut Cx<'a>, frame: &'a Frame, url: &DomString) {
    let url = string(cx, url);
    tell_peer(cx, frame, "setInitialUrl", &[url]);
}

pub(super) fn navigate_local<'a>(cx: &mut Cx<'a>, frame: &'a Frame, navigation: &Navigation) {
    let srcdoc = navigation
        .srcdoc
        .as_ref()
        .map_or(JSValue::UNDEFINED, |it| string(cx, it));
    let arguments = [
        string(cx, &navigation.url),
        srcdoc,
        string(cx, &navigation.referrer_policy),
    ];
    tell_peer(cx, frame, "navigate", &arguments);
}

pub(super) fn place_local<'a>(
    cx: &mut Cx<'a>,
    frame: &'a Frame,
    [width, height]: [f64; 2],
    is_visible: bool,
) {
    tell_peer(
        cx,
        frame,
        "place",
        &[
            number(width),
            number(height),
            number(frame.surface_scale()),
            is_visible.into(),
        ],
    );
}

pub(super) fn may_be_unloaded<'a>(cx: &mut Cx<'a>, frame: &'a Frame) -> bool {
    tell_peer(cx, frame, "beforeUnload", &[]).to_boolean()
}

pub(super) fn stop<'a>(cx: &mut Cx<'a>, frame: &'a Frame) {
    tell_peer(cx, frame, "stop", &[]);
}

pub(super) fn environment_changed<'a>(cx: &mut Cx<'a>, frame: &'a Frame) {
    tell_peer(cx, frame, "environmentChanged", &[]);
}

// ───────────────────────────── in the web engine ─────────────────────────────

pub(super) fn navigate_remote<'a>(cx: &mut Cx<'a>, frame: &'a Frame, url: &DomString) {
    let attributes = JSValue::create_empty_object(cx.global(), 4);
    for (name, value) in frame.element().attrs() {
        let name = name.local.to_dom_string();
        if remote::is_copied(&name.to_utf8()) {
            let value = string(cx, &value);
            attributes.put(cx.global(), name.to_utf8().as_bytes(), value);
        }
    }
    let value = string(cx, url);
    attributes.put(cx.global(), b"src", value);
    tell_peer(cx, frame, "navigate", &[attributes]);
}

pub(super) fn copy_attribute<'a>(
    cx: &mut Cx<'a>,
    frame: &'a Frame,
    name: &DomString,
    value: Option<&DomString>,
) {
    let arguments = [
        string(cx, name),
        value.map_or(JSValue::NULL, |it| string(cx, it)),
    ];
    tell_peer(cx, frame, "attribute", &arguments);
}

pub(super) fn place_remote<'a>(
    cx: &mut Cx<'a>,
    frame: &'a Frame,
    [width, height]: [f64; 2],
    is_visible: bool,
) {
    let scheme = DomString::from_latin1(&layout::computed(cx, frame.element(), "color-scheme"));
    let is_visible = is_visible
        && frame
            .outer_window()
            .is_some_and(|it| it.environment().is_visible);
    let arguments = [
        number(width),
        number(height),
        is_visible.into(),
        string(cx, &scheme),
        number(layout::zoom(frame.around().doc())),
    ];
    tell_peer(cx, frame, "place", &arguments);
}

pub(super) fn exit_fullscreen<'a>(cx: &mut Cx<'a>, frame: &'a Frame) {
    tell_peer(cx, frame, "exitFullscreen", &[]);
}
