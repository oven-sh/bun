//! <https://html.spec.whatwg.org/#cross-origin-objects>, and messages to windows.

use bun_jsc::{JSGlobalObject, JSObject};
use bun_web::origin::Origin;

use super::*;
use crate::api::core::by_name::call_directly;
use crate::api::events::queue_task_for;
use crate::api::frames::Frame;
use crate::api::messaging::bridge::{self, Envelope};
use crate::api::messaging::{MessageEvent, program, serialize};

type Objects<'a> = bindgen::JsList<'a, JsLocal<'a, JSObject>>;

unsafe extern "C" {
    safe fn Bun__DOM__createRemoteWindow(
        global: &JSGlobalObject,
        behind: JSValue,
        existing: JSValue,
    ) -> JSValue;
    safe fn Bun__DOM__createRemoteLocation(global: &JSGlobalObject, behind: JSValue) -> JSValue;
}

enum Place {
    ThisProcess,
    /// In the web engine: the indices of the frames that lead to it from that of an `<iframe>`.
    Frame(Box<[u32]>),
    /// In the web engine.
    Popup,
}

pub(crate) struct ForeignWindow(Place, bindgen::Interior);

#[derive(Default)]
pub(crate) struct ForeignLocation(bindgen::Interior);

fn check_target_origin<'a>(cx: &mut Cx<'a>, origin: &[u8]) -> Result<'a> {
    if matches!(origin, b"*" | b"/") || Url::parse(origin).is_some() {
        return Ok(());
    }
    Err(cx.heap.dom_exception(
        DomError::SyntaxError,
        format_args!(
            "Invalid target origin '{}' in a call to 'postMessage'.",
            lossy(origin)
        ),
    ))
}

/// `sender` may be the window of a program, whose ports are those of the runtime.
fn seal<'a>(
    cx: &mut Cx<'a>,
    sender: &'a Window,
    message: JsLocal<'a>,
    transfer: Objects<'a>,
) -> Result<'a, JSValue> {
    let moved = List::new(&cx.heap);
    for it in transfer.iter().map(JsLocal::to_js) {
        let it = if sender.document().is_of_program() {
            program::to_page(cx, it)?
        } else {
            it
        };
        moved.push(&cx.heap, it);
    }
    let message = serialize(
        cx,
        message.to_js(),
        (0..moved.len()).map(|at| moved.get(at)),
    )?;
    Ok(Envelope::new(&cx.heap, message).to_js())
}

/// From the web engine: the data, the origin, the path to the sender, and the ports, which are parked.
fn receive<'a>(
    cx: &mut Cx<'a>,
    [root, _]: [JsLocal<'a>; 2],
    _: u64,
    given: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let (Some(root), [data, origin, path, ports]) =
        (ForeignWindow::from_js(&cx.heap, root.to_js()), given)
    else {
        return Ok(JSValue::UNDEFINED);
    };
    let (target, path) = (root.outer(), List::from_script(&cx.heap, path.to_js()));
    let source = match root.0 {
        Place::Popup if !path.is_empty() => JSValue::NULL,
        Place::Popup => root.get_itself(),
        _ => root.at(
            &cx.heap,
            &path.values().map(JSValue::to_u32).collect::<Vec<_>>(),
        ),
    };
    let parked = List::from_script(&cx.heap, ports.to_js());
    let event: &Event = if target.document().is_of_program() {
        program::event_with_parked_ports(cx, data.to_js(), origin.to_js(), source, parked)?
    } else {
        let origin = DomString::from_js(cx, *origin)?;
        MessageEvent::with_parked_ports(
            target.realm(&cx.heap),
            *data,
            origin,
            source,
            (0..parked.len()).map(|at| parked.get(at).as_number()),
        )?
    };
    dispatch(cx, target, event);
    Ok(JSValue::UNDEFINED)
}

impl ForeignWindow {
    fn new<'a>(
        heap: &JsHeap<'a>,
        place: Place,
        outer: &'a Window,
        peer: JSValue,
        existing: JSValue,
    ) -> &'a ForeignWindow {
        let this = js_ForeignWindow::create(heap, ForeignWindow(place, Default::default()));
        js_ForeignWindow::set_outer(this, outer.to_js());
        js_ForeignWindow::set_peer(this, peer);
        js_ForeignWindow::set_itself(
            this,
            Bun__DOM__createRemoteWindow(global_of(heap), this.to_js(), existing),
        );
        this
    }

    /// `existing` has stood for a window of the same origin.
    pub(crate) fn in_this_process<'a>(
        heap: &JsHeap<'a>,
        seen_by: &'a Window,
        peer: JSValue,
        existing: JSValue,
    ) -> JSValue {
        ForeignWindow::new(heap, Place::ThisProcess, seen_by, peer, existing).get_itself()
    }

    /// What `window.open()` returns.
    pub(crate) fn of_popup<'a>(cx: &mut Cx<'a>, opener: &'a Window, peer: JSValue) -> JSValue {
        let this = ForeignWindow::new(&cx.heap, Place::Popup, opener, peer, JSValue::UNDEFINED);
        let receiver = this.receiver(cx);
        js_ForeignWindow::set_engine(this, this.ask(cx, "connect", &[receiver]));
        this.get_itself()
    }

    /// The window, and what controls the frame.
    pub(crate) fn of_frame<'a>(
        cx: &mut Cx<'a>,
        outer: &'a Window,
        frame: &'a Frame,
    ) -> [JSValue; 2] {
        let this = ForeignWindow::new(
            outer.realm(&cx.heap),
            Place::Frame(Box::default()),
            outer,
            JSValue::UNDEFINED,
            JSValue::UNDEFINED,
        );
        js_ForeignWindow::set_frame(this, frame.to_js());
        js_ForeignWindow::set_known(this, List::from_fn(&cx.heap, 1, |_| this.to_js()).to_js());
        let receiver = this.receiver(cx);
        let engine = host::create_remote_frame(cx, outer, frame.to_js(), receiver);
        js_ForeignWindow::set_engine(this, engine);
        [this.get_itself(), engine]
    }

    fn receiver<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        self.outer()
            .realm(&cx.heap)
            .create_callback(receive, [self.to_js(), JSValue::UNDEFINED], 0)
            .to_js()
    }

    fn outer(&self) -> &Window {
        js_ForeignWindow::outer(self)
            .and_then(Window::from_value)
            .expect("it is set first")
    }

    fn frame(&self) -> &Frame {
        js_ForeignWindow::frame(self)
            .and_then(Frame::from_value)
            .expect("it is set first")
    }

    fn ask<'a>(&'a self, cx: &mut Cx<'a>, name: &str, arguments: &[JSValue]) -> JSValue {
        call_directly(
            cx,
            js_ForeignWindow::peer(self).unwrap_or_default(),
            name,
            arguments,
        )
    }

    fn ask_for_window<'a>(&'a self, cx: &mut Cx<'a>, name: &str) -> JSValue {
        Some(self.ask(cx, name, &[]))
            .filter(|it| it.is_object())
            .unwrap_or(JSValue::NULL)
    }

    fn tell_engine<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        name: &str,
        first: JSValue,
        second: JSValue,
    ) -> Result<'a> {
        let Some(engine) = js_ForeignWindow::engine(self).filter(|it| it.is_object()) else {
            return Ok(());
        };
        let path = if let Place::Frame(path) = &self.0 {
            &**path
        } else {
            &[]
        };
        let path = cx
            .heap
            .create_array(path.iter(), |heap, it| Ok(JsLocal::new(heap, (*it).into())))?
            .to_js();
        call_directly(cx, engine, name, &[path, first, second]);
        Ok(())
    }

    /// Another one in the same `<iframe>`.
    fn at<'a>(&'a self, heap: &JsHeap<'a>, path: &[u32]) -> JSValue {
        let known = List::from_value(js_ForeignWindow::known(self).unwrap_or_default());
        let found = known
            .values()
            .filter_map(|it| ForeignWindow::from_js(heap, it))
            .find(|it| matches!(&it.0, Place::Frame(of) if **of == *path));
        let make = || {
            let made = ForeignWindow::new(
                self.outer().realm(heap),
                Place::Frame(path.into()),
                self.outer(),
                JSValue::UNDEFINED,
                JSValue::UNDEFINED,
            );
            js_ForeignWindow::set_frame(made, self.frame().to_js());
            js_ForeignWindow::set_engine(made, js_ForeignWindow::engine(self).unwrap_or_default());
            js_ForeignWindow::set_known(made, known.to_js());
            known.push(heap, made.to_js());
            made
        };
        found.unwrap_or_else(make).get_itself()
    }

    fn caller<'a>(&'a self, cx: &mut Cx<'a>) -> &'a Window {
        let of_realm = WindowTarget::of_realm(&cx.heap)
            .and_then(|it| it.downcast())
            .unwrap_or_else(|| self.outer());
        host::caller(cx, of_realm)
    }

    fn navigate<'a>(&'a self, cx: &mut Cx<'a>, given: &DomString, replaces: bool) -> Result<'a> {
        let source = if let Place::ThisProcess = self.0 {
            self.caller(cx)
        } else {
            self.outer()
        };
        let Some(url) = source.resolve(cx, given) else {
            return Err(cx.heap.dom_exception(
                DomError::SyntaxError,
                format_args!("'{}' is not a valid URL.", given.to_utf8()),
            ));
        };
        let url = host::text(cx, &url);
        let Place::ThisProcess = self.0 else {
            let method = host::text(cx, if replaces { "replace" } else { "assign" });
            return self.tell_engine(cx, "location", method, url);
        };
        let source = host::owner(cx, source).unwrap_or(JSValue::UNDEFINED);
        if self
            .ask(cx, "navigate", &[source, url, replaces.into()])
            .to_boolean()
        {
            return Ok(());
        }
        Err(cx.heap.dom_exception(
            DomError::SecurityError,
            format_args!(
                "The current window does not have permission to navigate the target frame."
            ),
        ))
    }

    fn child<'a>(&'a self, cx: &mut Cx<'a>, key: JSValue) -> JSValue {
        match &self.0 {
            Place::ThisProcess => self.ask(cx, "child", &[key]),
            _ if key.is_number() && key.to_u32() < self.get_length(cx) => {
                self.at(&cx.heap, &[key.to_u32()])
            }
            _ => JSValue::UNDEFINED,
        }
    }

    pub(crate) fn get_itself(&self) -> JSValue {
        js_ForeignWindow::itself(self).unwrap_or_default()
    }

    pub(crate) fn get_location<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        js_ForeignWindow::location(self).unwrap_or_else(|| {
            let realm = self.outer().realm(heap);
            let behind = js_ForeignLocation::create(realm, ForeignLocation::default());
            js_ForeignLocation::set_window(behind, self.to_js());
            let made = Bun__DOM__createRemoteLocation(global_of(realm), behind.to_js());
            js_ForeignWindow::set_location(self, made);
            made
        })
    }

    pub(crate) fn set_location<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString) -> Result<'a> {
        self.navigate(cx, url, false)
    }

    pub(crate) fn close<'a>(&'a self, cx: &mut Cx<'a>) {
        if !matches!(self.0, Place::Frame(_)) {
            let source = self.caller(cx);
            let source = host::owner(cx, source).unwrap_or(JSValue::UNDEFINED);
            self.ask(cx, "close", &[source]);
        }
    }

    pub(crate) fn get_closed<'a>(&'a self, cx: &mut Cx<'a>) -> bool {
        if let Place::Frame(_) = self.0 {
            self.frame().get_is_closed()
        } else {
            self.ask(cx, "isClosed", &[]).to_boolean()
        }
    }

    pub(crate) fn focus<'a>(&'a self, cx: &mut Cx<'a>) {
        match self.0 {
            Place::Frame(_) => self.frame().focus_element(cx),
            _ => _ = self.ask(cx, "focus", &[]),
        }
    }

    pub(crate) fn blur(&self) {}

    pub(crate) fn get_length<'a>(&'a self, cx: &mut Cx<'a>) -> u32 {
        match &self.0 {
            Place::ThisProcess => {
                self.ask(cx, "length", &[]).get_number().unwrap_or_default() as u32
            }
            Place::Frame(path) if path.is_empty() => self.frame().get_length(),
            _ => 0,
        }
    }

    pub(crate) fn get_top<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        match self.0 {
            Place::ThisProcess => self.ask_for_window(cx, "top"),
            Place::Frame(_) => self.outer().get_top(cx),
            Place::Popup => self.get_itself(),
        }
    }

    pub(crate) fn get_opener<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        match self.0 {
            Place::ThisProcess => self.ask_for_window(cx, "opener"),
            Place::Frame(_) => JSValue::NULL,
            Place::Popup => self.outer().get_itself(&cx.heap),
        }
    }

    pub(crate) fn get_parent<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        match &self.0 {
            Place::ThisProcess => self.ask_for_window(cx, "parent"),
            Place::Frame(path) => path.split_last().map_or_else(
                || self.outer().get_itself(&cx.heap),
                |(_, above)| self.at(&cx.heap, above),
            ),
            Place::Popup => self.get_itself(),
        }
    }

    pub(crate) fn post_message<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        message: JsLocal<'a>,
        target_origin: &[u8],
        transfer: Objects<'a>,
    ) -> Result<'a> {
        check_target_origin(cx, target_origin)?;
        let (envelope, origin) = (
            seal(cx, self.outer(), message, transfer)?,
            host::text(cx, &lossy(target_origin)),
        );
        if let Place::ThisProcess = self.0 {
            let source = self.caller(cx);
            let source = host::owner(cx, source).unwrap_or(JSValue::UNDEFINED);
            self.ask(cx, "postMessage", &[source, envelope, origin]);
        } else if !self.get_closed(cx) {
            self.tell_engine(cx, "post", envelope, origin)?;
        }
        Ok(())
    }

    pub(crate) fn post_message_with<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        message: JsLocal<'a>,
        options: &WindowPostMessageOptions<'a>,
    ) -> Result<'a> {
        self.post_message(cx, message, options.target_origin, options.transfer)
    }
}

impl ForeignLocation {
    fn window(&self) -> &ForeignWindow {
        js_ForeignLocation::window(self)
            .and_then(ForeignWindow::from_value)
            .expect("it is set first")
    }

    /// It is left out of the descriptor.
    pub(crate) fn get_href<'a>(&'a self, _: &mut Cx<'a>) -> Result<'a, DomString> {
        Ok(DomString::default())
    }

    pub(crate) fn set_href<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString) -> Result<'a> {
        self.window().set_location(cx, url)
    }

    pub(crate) fn replace<'a>(&'a self, cx: &mut Cx<'a>, url: &DomString) -> Result<'a> {
        self.window().navigate(cx, url, true)
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__membersOfForeignObject(realm: &JSGlobalObject, behind: JSValue) -> JSValue {
    let heap = JsHeap::from_global(realm);
    if ForeignWindow::is(behind) {
        js_ForeignWindow::CLASS.prototype(heap)
    } else {
        js_ForeignLocation::CLASS.prototype(heap)
    }
}

/// By index or by name. How many there are for `undefined`.
#[unsafe(no_mangle)]
extern "C" fn Bun__DOM__childOfForeignObject(
    realm: &JSGlobalObject,
    behind: JSValue,
    key: JSValue,
) -> JSValue {
    let find = |cx: &mut Cx<'_>| match ForeignWindow::from_js(&cx.heap, behind) {
        Some(window) if key.is_undefined() => window.get_length(cx).into(),
        Some(window) => window.child(cx, key),
        None => JSValue::UNDEFINED,
    };
    // SAFETY: a script is calling.
    unsafe { bindgen::JsScope::with(realm.as_mut_ptr(), find) }
}

impl WindowMessaging {
    /// <https://html.spec.whatwg.org/#window-post-message-steps>
    pub(crate) fn post_message<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        message: JsLocal<'a>,
        target_origin: &[u8],
        transfer: Objects<'a>,
    ) -> Result<'a> {
        check_target_origin(cx, target_origin)?;
        let source = host::caller(cx, self);
        let envelope = if self.document().is_of_program() {
            program::seal(cx, message, transfer)?
        } else {
            seal(cx, self, message, transfer)?
        };
        if let Some(owner) = host::owner(cx, self).and_then(|_| host::owner(cx, source)) {
            let origin = host::text(cx, &lossy(target_origin));
            self.ask_host(cx, "postMessage", &[owner, envelope, origin]);
            return Ok(());
        }
        let source = WindowTarget::of_realm(&cx.heap)
            .and_then(|it| it.downcast::<Window>())
            .unwrap_or(self);
        let origin = source.origin(&cx.heap);
        if Url::parse(target_origin)
            .map(|it| Origin::of(&it))
            .is_some_and(|it| it.is_opaque() || it.as_bytes() != origin.to_utf8().as_bytes())
        {
            return Ok(());
        }
        let values = [
            self.window(),
            envelope,
            origin.to_js(&cx.heap).to_js(),
            source.window(),
        ];
        queue_task_for(self.document(), &values, Box::new(deliver));
        Ok(())
    }

    pub(crate) fn post_message_with<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        message: JsLocal<'a>,
        options: &WindowPostMessageOptions<'a>,
    ) -> Result<'a> {
        self.post_message(cx, message, options.target_origin, options.transfer)
    }
}

fn deliver<'a>(cx: &mut Cx<'a>, values: &[JSValue]) -> Result<'a> {
    let Some(envelope) = Envelope::from_js(&cx.heap, values[1]) else {
        let event = program::unseal(cx, values[1], values[2], values[3])?;
        WindowTarget::of(&cx.heap, values[0])
            .into_iter()
            .for_each(|it| _ = dispatch(cx, it, event));
        return Ok(());
    };
    let [target, origin, source] = [0, 2, 3].map(|at| JsLocal::new(&cx.heap, values[at]));
    let origin = DomString::from_js(cx, origin)?;
    bridge::deliver(cx, target, envelope, origin, source);
    Ok(())
}
