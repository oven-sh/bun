//! What media ask of the host of the page.

use core::cell::{Cell, RefCell};

use bun_jsc::JSPromise;
use bun_web::exec::oneshot;
use bun_web::host::{Level, Permission};
use bun_web::media::{self, Connection};

use super::*;
use crate::api::core::{DomString, Node, atom};
use crate::api::events::{EventInit, WindowTarget, fire, now};
use crate::api::realm::{Kept, client_of, promise_for};
use crate::api::ui::Ui;
use crate::api::window::Window;
use crate::generated_bindgen::window::{js_DomNavigator, js_DomWindow};

pub(super) fn string(heap: &JsHeap<'_>, utf8: &[u8]) -> JSValue {
    DomString::from_utf8(crate::values::text(utf8))
        .to_js(heap)
        .to_js()
}

/// In the realm of the document.
pub(super) fn connect<'a>(cx: Cx<'_, 'a>, document: JSValue) -> Box<dyn Connection> {
    let window = Node::from_js(&cx.heap, document)
        .and_then(Node::as_doc)
        .and_then(|it| it.last_window())
        .map(|it| Kept::new(cx, it.to_js()));
    let document = Kept::new(cx, document);
    let listener: media::Listener = Rc::new(move |line| {
        let line = line.map(<[u8]>::to_vec);
        document.queue_task(move |cx, document| {
            let Some(link) = Node::from_js(&cx.heap, document.to_js())
                .and_then(Node::as_doc)
                .map(|it| Link::of(&cx.heap, it))
            else {
                return;
            };
            let result = match line {
                Some(line) => link.receive(cx, &line),
                None => link.disconnect(cx),
            };
            bun_web::exec::report(cx, result);
        });
    });
    match window.filter(|_| bun_web::remote::is_page_process()) {
        Some(window) => Box::new(ThroughHost::new(window, listener)),
        None => media::connect(&listener),
    }
}

#[derive(Default)]
struct Listeners {
    all: RefCell<Vec<(u32, media::Listener)>>,
    last: Cell<u32>,
}

bun_ui::state!(fn listeners() -> Listeners);

struct ThroughHost {
    id: u32,
    window: Kept,
}

impl ThroughHost {
    fn new(window: Kept, listener: media::Listener) -> ThroughHost {
        listeners().last.update(|it| it + 1);
        let id = listeners().last.get();
        listeners().all.borrow_mut().push((id, listener));
        ThroughHost { id, window }
    }

    fn tell(&self, commands: Option<Vec<u8>>) {
        self.window.enter(|cx, it| {
            WindowTarget::from_js(&cx.heap, it.to_js())
                .map_or((), |it| it.host().media(self.id, commands))
        });
    }
}

impl Connection for ThroughHost {
    fn send(&self, commands: &[u8], _: [bool; 2]) {
        self.tell(Some(commands.to_vec()));
    }
}

impl Drop for ThroughHost {
    fn drop(&mut self) {
        listeners().all.borrow_mut().retain(|it| it.0 != self.id);
        self.tell(None);
    }
}

pub(crate) fn hear_from_host(connection: u32, line: Option<&[u8]>) {
    let listener = listeners()
        .all
        .borrow()
        .iter()
        .find(|it| it.0 == connection)
        .map(|it| Rc::clone(&it.1));
    listener.into_iter().for_each(|it| it(line));
}

/// What is about no object.
pub(super) fn heard<'a>(cx: Cx<'_, 'a>, document: &'a Doc, message: &Message<'_>) {
    let Some(window) = document.window() else {
        return;
    };
    match message.kind {
        b"devicechange" => drop(
            window
                .downcast::<Window>()
                .and_then(js_DomWindow::navigator)
                .and_then(js_DomNavigator::media_devices)
                .map(|it| fire(cx, it, atom!("devicechange"), EventInit::default())),
        ),
        b"failure" => window.host().console(
            Level::Warning,
            crate::values::text(message.text(0)).into(),
            0,
            String::new(),
        ),
        _ => {}
    }
}

pub(super) fn may_list_devices<'a>(_: Cx<'_, 'a>, document: &'a Doc, is_connected: bool) -> bool {
    let window = document
        .window()
        .filter(|_| is_connected || Ui::of(document).is_some_and(Ui::has_transient_activation));
    window.is_some_and(|it| {
        matches!(
            it.host()
                .permission_state("media".into(), Some("audio".into())),
            Permission::Granted
        )
    })
}

/// A promise for whether it is granted.
pub(super) fn request_microphone<'a>(
    cx: Cx<'_, 'a>,
    document: &'a Doc,
) -> Result<'a, JsLocal<'a, JSPromise>> {
    let (sender, answer) = oneshot();
    if let Some(it) = document.window() {
        it.host().microphone(|_, answer| sender.send(answer));
    }
    let promise = promise_for(cx, answer, |_, it| {
        Ok(matches!(it, Some(Permission::Granted)).into())
    });
    cx.promise_resolve(promise)
}

pub(super) fn plays_media<'a>(cx: Cx<'_, 'a>, document: &'a Doc) -> bool {
    document.has_page() && client_of(document.realm(&cx.heap)).is_some()
}

pub(super) fn is_visible<'a>(_: Cx<'_, 'a>, document: &'a Doc) -> bool {
    crate::api::window::Window::shows(document)
}

pub(super) fn request_animation_frame<'a>(cx: Cx<'_, 'a>, document: &'a Doc, callback: JSValue) {
    let window = document.window().and_then(|it| it.downcast::<Window>());
    if let (Some(window), Some(callback)) = (window, JsLocal::new(&cx.heap, callback).as_callable())
    {
        window.request_animation_frame(cx, callback, JsLocal::UNDEFINED);
    }
}

pub(crate) fn performance_now(realm: &JsHeap<'_>) -> f64 {
    WindowTarget::of_realm(realm).map_or(0.0, |it| now() - it.time_origin())
}
