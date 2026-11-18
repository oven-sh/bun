//! <https://html.spec.whatwg.org/#cross-origin-objects>, and messages to windows.

use bun_jsc::{JSGlobalObject, JSObject};
use bun_web::channel::Message;
use bun_web::host::ToGuest;
use bun_web::origin::Origin;
use bun_web::page::News;
use bun_web::tasks::{self, Priority, Work};

use super::navigate::Options;
use super::*;
use crate::api::events::queue_task_for;
use crate::api::frames::Frame;
use crate::api::messaging::for_host::{self, Envelope};
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
    /// As the documents of that origin see it.
    ThisProcess(Rc<Cluster>),
    /// In the web engine: the indices of the frames that lead to it from that of an `<iframe>`.
    Frame(Box<[u32]>),
    /// In the web engine.
    Popup { number: u32, is_closed: Cell<bool> },
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
) -> Result<'a, Message> {
    let moved = List::new(&cx.heap);
    for it in transfer.iter().map(JsLocal::to_js) {
        let it = if sender.document().is_of_program() {
            program::to_page(cx, it)?
        } else {
            it
        };
        moved.push(&cx.heap, it);
    }
    serialize(
        cx,
        message.to_js(),
        (0..moved.len()).map(|at| moved.get(at)),
    )
}

/// To a window in this process that has relatives.
fn post(target: &Window, source: &Window, message: Message, target_origin: &[u8]) {
    let (Some(from), Some(sender)) = (source.cluster(), source.context()) else {
        return;
    };
    let wanted = match target_origin {
        b"*" => None,
        b"/" => Some(from.origin().to_owned()),
        url => Some(
            Url::parse(url)
                .map(|it| lossy(Origin::of(&it).as_bytes()))
                .unwrap_or_default(),
        ),
    };
    let work = move |global: &JSGlobalObject, values: &[JSValue]| {
        let (Some(target), Some(source), Some(sender)) = (
            Window::from_value(values[0]),
            Window::from_value(values[1]),
            Context::from_value(values[2]),
        ) else {
            return Ok(());
        };
        let heap = JsHeap::from_global(global);
        let Some(cluster) = target.cluster().filter(|it| {
            !target.is_disposed() && wanted.is_none_or(|wanted| wanted == it.origin())
        }) else {
            return Ok(());
        };
        let token = crate::api::realm::last_client_of(source.realm(heap))
            .map(|it| DomString::from_latin1(&it.token))
            .unwrap_or_default();
        let (origin, sender) = (source.origin(heap), sender.window_for(heap, cluster));
        target.enter(|cx, target| {
            for_host::deliver_message(cx, target.window(), message, origin, sender, token)
        });
        Ok(())
    };
    tasks::post(
        bun_ui::main_global(),
        Priority::Visible,
        Work::Once(Box::new(work)),
        &[target.to_js(), source.to_js(), sender.to_js()],
    );
}

impl ForeignWindow {
    fn new<'a>(
        heap: &JsHeap<'a>,
        place: Place,
        outer: &Window,
        existing: JSValue,
    ) -> &'a ForeignWindow {
        let this = js_ForeignWindow::create(heap, ForeignWindow(place, Default::default()));
        js_ForeignWindow::set_outer(this, outer.to_js());
        js_ForeignWindow::set_itself(
            this,
            Bun__DOM__createRemoteWindow(global_of(heap), this.to_js(), existing),
        );
        this
    }

    /// `existing` has stood for a window of the same origin.
    pub(super) fn in_this_process(
        heap: &JsHeap<'_>,
        seen_by: &Window,
        context: &Context,
        cluster: &Rc<Cluster>,
        existing: JSValue,
    ) -> JSValue {
        let this = ForeignWindow::new(
            heap,
            Place::ThisProcess(Rc::clone(cluster)),
            seen_by,
            existing,
        );
        js_ForeignWindow::set_context(this, context.to_js());
        this.get_itself()
    }

    /// What `window.open()` returns.
    pub(super) fn of_popup<'a>(heap: &JsHeap<'a>, opener: &'a Window, number: u32) -> JSValue {
        let this = ForeignWindow::new(
            opener.realm(heap),
            Place::Popup {
                number,
                is_closed: false.into(),
            },
            opener,
            JSValue::UNDEFINED,
        );
        js_DomWindow::set_popups(opener, opener.popups().with(heap, this).to_field());
        this.get_itself()
    }

    pub(crate) fn of_frame<'a>(
        heap: &JsHeap<'a>,
        outer: &'a Window,
        frame: &'a Frame,
    ) -> &'a ForeignWindow {
        let this = ForeignWindow::new(
            outer.realm(heap),
            Place::Frame(Box::default()),
            outer,
            JSValue::UNDEFINED,
        );
        js_ForeignWindow::set_frame(this, frame.to_js());
        js_ForeignWindow::set_known(this, List::from_fn(heap, 1, |_| this.to_js()).to_js());
        this
    }

    /// From the web engine.
    pub(crate) fn receive<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        path: &[u32],
        origin: &str,
        message: Message,
    ) {
        let (target, origin) = (self.outer(), DomString::from_utf8(origin));
        let source = match self.0 {
            Place::Popup { .. } if !path.is_empty() => JSValue::NULL,
            Place::Popup { .. } => self.get_itself(),
            _ => self.at(&cx.heap, path),
        };
        if target.document().is_of_program() {
            let dispatched = program::event_of(cx, message, &origin, source)
                .map(|it| _ = dispatch(cx, target, it));
            return bun_web::exec::report(cx, dispatched);
        }
        if let Some(event) = MessageEvent::of(cx, message, origin, DomString::default()) {
            event.set_source(source);
            dispatch(cx, target, event);
        }
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

    fn context(&self) -> &Context {
        js_ForeignWindow::context(self)
            .and_then(Context::from_value)
            .expect("it is set first")
    }

    fn relative<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        cluster: &Rc<Cluster>,
        other: Option<&Context>,
    ) -> JSValue {
        other
            .filter(|_| !self.context().is_closed())
            .map_or(JSValue::NULL, |it| it.window_for(heap, cluster))
    }

    fn tell_engine(&self, message: impl FnOnce(Vec<u32>) -> ToGuest) {
        match &self.0 {
            Place::ThisProcess(_) => {}
            Place::Frame(path) => self
                .outer()
                .host()
                .tell_guest(self.frame().number(), message(path.to_vec())),
            Place::Popup { number, .. } => {
                self.outer().host().tell_guest(*number, message(Vec::new()))
            }
        }
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
            );
            js_ForeignWindow::set_frame(made, self.frame().to_js());
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
        let source = if let Place::ThisProcess(_) = self.0 {
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
        let Place::ThisProcess(cluster) = &self.0 else {
            self.tell_engine(|path| ToGuest::Location {
                path,
                url,
                replaces,
            });
            return Ok(());
        };
        if cluster.has(source)
            && host::navigate_from(
                self.context(),
                source,
                &url,
                &Options {
                    replace: replaces,
                    ..Default::default()
                },
            )
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
            Place::ThisProcess(cluster) => {
                let name = JsLocal::new(&cx.heap, key)
                    .as_string()
                    .and_then(|it| DomString::from_js_string(&cx.heap, it).ok());
                let found = match name {
                    Some(name) => self
                        .context()
                        .children()
                        .find(|it| it.name() == name.to_utf8()),
                    None => key
                        .get_number()
                        .and_then(|it| self.context().children().nth(it as usize)),
                };
                found.map_or(JSValue::UNDEFINED, |it| it.window_for(&cx.heap, cluster))
            }
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
        match &self.0 {
            Place::ThisProcess(cluster) => Some(self.caller(cx))
                .filter(|it| cluster.has(it))
                .into_iter()
                .for_each(|it| it.host().close_window(self.context().id())),
            Place::Frame(_) => {}
            Place::Popup { .. } => self.tell_engine(|_| ToGuest::Close),
        }
    }

    pub(crate) fn get_closed<'a>(&'a self, _: &mut Cx<'a>) -> bool {
        match &self.0 {
            Place::ThisProcess(_) => self.context().is_closed(),
            Place::Frame(_) => self.frame().is_closed(),
            Place::Popup { is_closed, .. } => is_closed.get(),
        }
    }

    pub(crate) fn focus<'a>(&'a self, cx: &mut Cx<'a>) {
        match self.0 {
            Place::ThisProcess(_) => match self.context().container() {
                Some(container) => container.focus(cx),
                None => self.caller(cx).host().focus_other(self.context().id()),
            },
            Place::Frame(_) => self.frame().focus_element(cx),
            Place::Popup { .. } => self.tell_engine(|_| ToGuest::Focus),
        }
    }

    pub(crate) fn blur(&self) {}

    pub(crate) fn get_length<'a>(&'a self, _: &mut Cx<'a>) -> u32 {
        match &self.0 {
            Place::ThisProcess(_) => self.context().children().count() as u32,
            Place::Frame(path) if path.is_empty() => self.frame().length(),
            _ => 0,
        }
    }

    pub(crate) fn get_top<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        match &self.0 {
            Place::ThisProcess(cluster) => {
                self.relative(&cx.heap, cluster, Some(self.context().top()))
            }
            Place::Frame(_) => self.outer().get_top(cx),
            Place::Popup { .. } => self.get_itself(),
        }
    }

    pub(crate) fn get_opener<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        match &self.0 {
            Place::ThisProcess(cluster) => {
                self.relative(&cx.heap, cluster, self.context().opened_by())
            }
            Place::Frame(_) => JSValue::NULL,
            Place::Popup { .. } => self.outer().get_itself(&cx.heap),
        }
    }

    pub(crate) fn get_parent<'a>(&'a self, cx: &mut Cx<'a>) -> JSValue {
        match &self.0 {
            Place::ThisProcess(cluster) => {
                self.relative(&cx.heap, cluster, Some(self.context().parent_or_itself()))
            }
            Place::Frame(path) => path.split_last().map_or_else(
                || self.outer().get_itself(&cx.heap),
                |(_, above)| self.at(&cx.heap, above),
            ),
            Place::Popup { .. } => self.get_itself(),
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
        let message = seal(cx, self.outer(), message, transfer)?;
        if let Place::ThisProcess(cluster) = &self.0 {
            let source =
                Some(self.caller(cx)).filter(|it| cluster.has(it) && !self.context().has_crashed());
            if let Some((target, source)) =
                source.and_then(|it| Some((self.context().started_window(it)?, it)))
            {
                post(target, source, message, target_origin);
            }
        } else if !self.get_closed(cx) {
            self.tell_engine(|path| ToGuest::Post {
                path,
                message,
                target_origin: lossy(target_origin),
            });
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

impl Window {
    fn popups(&self) -> Refs<'_, ForeignWindow> {
        Refs::from_field(js_DomWindow::popups(self))
    }

    pub(crate) fn tell_popup<'a>(&'a self, cx: &mut Cx<'a>, wanted: u32, news: News) {
        let Some(popup) = self
            .popups()
            .iter()
            .find(|it| matches!(it.0, Place::Popup { number, .. } if number == wanted))
        else {
            return;
        };
        match (news, &popup.0) {
            (
                News::Message {
                    path,
                    origin,
                    message,
                },
                _,
            ) => popup.receive(cx, &path, &origin, message),
            (News::Closed, Place::Popup { is_closed, .. }) => {
                is_closed.set(true);
                js_DomWindow::set_popups(self, self.popups().without(&cx.heap, popup).to_field());
            }
            _ => {}
        }
    }
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
        if let Some(cluster) = self.cluster().filter(|_| source.cluster().is_some()) {
            let message = seal(cx, self, message, transfer)?;
            if cluster.has(source) {
                post(self, source, message, target_origin);
            }
            return Ok(());
        }
        let envelope = if self.document().is_of_program() {
            program::seal(cx, message, transfer)?
        } else {
            seal(cx, self, message, transfer).map(|it| Envelope::new(&cx.heap, it).to_js())?
        };
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
    for_host::deliver(cx, target, envelope, origin, source);
    Ok(())
}
