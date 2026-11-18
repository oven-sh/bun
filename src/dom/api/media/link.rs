//! The web engine has the microphone, the speakers and the decoders, and a copy of what makes or takes sound while it does.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::ptr::NonNull;
use std::io::Write as _;
use std::rc::Rc;

use bun_collections::HashMap;
use bun_jsc::bindgen::{JsHeap, JsInterface, JsLocal, JsScope, Result};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{DOMExceptionCode, JSPromise, JSValue, Strong, Weak};

use bun_web::exec::with_realm;
use bun_web::held::Held;
use bun_web::media::Connection;

use super::{Cx, host, streams};
use crate::api::core::{Doc, Node, global_of};
use crate::api::realm::hold;

const IDLE_MILLISECONDS: f64 = 20_000.0;

/// An argument of a command.
#[derive(Clone, Copy)]
pub(crate) enum Arg<'s> {
    Null,
    Flag(bool),
    Number(f64),
    Text(&'s [u8]),
    Json(&'s [u8]),
    Object(u32),
    /// The value of a property of an object.
    Part(u32, &'static str),
    /// An entry of `parameters`.
    Parameter(u32, &'s [u8]),
    /// By the clock of that context.
    Time(f64, u32),
    Floats(&'s [u8]),
    Bytes(&'s [u8]),
    List(&'s [Arg<'s>]),
    Record(&'s [(&'static str, Arg<'s>)]),
}

impl From<u32> for Arg<'_> {
    fn from(number: u32) -> Self {
        Arg::Number(number.into())
    }
}

impl<'s> From<&'s str> for Arg<'s> {
    fn from(text: &'s str) -> Self {
        Arg::Text(text.as_bytes())
    }
}

impl Arg<'_> {
    pub(crate) fn floats(values: &[f32]) -> Arg<'_> {
        Arg::Floats(bun_core::cast_slice(values))
    }

    #[optimize(size)]
    fn write(self, out: &mut Vec<u8>) {
        let encoded = |out: &mut Vec<u8>, kind: &str, bytes| {
            let _ = write!(out, "{{\"{kind}\":\"");
            bun_base64::encode_append(out, bytes);
            write!(out, "\"}}")
        };
        let _ = match self {
            Arg::Number(number) if number.is_finite() => write!(out, "{number:e}"),
            Arg::Null | Arg::Number(_) => write!(out, "null"),
            Arg::Flag(flag) => write!(out, "{flag}"),
            Arg::Text(text) => write!(
                out,
                "{}",
                bun_core::fmt::format_json_string_utf8(text, Default::default())
            ),
            Arg::Json(json) => out.write_all(json),
            Arg::Object(id) => write!(out, "{{\"ref\":{id}}}"),
            Arg::Part(id, name) => write!(out, "{{\"ref\":{id},\"part\":\"{name}\"}}"),
            Arg::Parameter(id, name) => write!(
                out,
                "{{\"ref\":{id},\"key\":{}}}",
                bun_core::fmt::format_json_string_utf8(name, Default::default())
            ),
            Arg::Time(time, of) => write!(out, "{{\"time\":{time:e},\"of\":{of}}}"),
            Arg::Floats(bytes) => encoded(out, "floats", bytes),
            Arg::Bytes(bytes) => encoded(out, "bytes", bytes),
            Arg::List(items) => {
                out.push(b'[');
                for (at, item) in items.iter().enumerate() {
                    out.extend((at > 0).then_some(b','));
                    item.write(out);
                }
                write!(out, "]")
            }
            Arg::Record(members) => {
                out.push(b'{');
                for (at, (name, value)) in members.iter().enumerate() {
                    let _ = write!(out, "{}\"{name}\":", if at > 0 { "," } else { "" });
                    value.write(out);
                }
                write!(out, "}}")
            }
        };
    }
}

/// What the engine tells. It is only as honest as its process.
pub(crate) struct Message<'m> {
    pub(crate) kind: &'m [u8],
    pub(crate) parts: Vec<&'m [u8]>,
}

impl<'m> Message<'m> {
    pub(crate) fn text(&self, at: usize) -> &'m [u8] {
        self.parts.get(at).copied().unwrap_or_default()
    }

    pub(crate) fn number(&self, at: usize) -> f64 {
        crate::values::text(self.text(at))
            .parse()
            .unwrap_or(f64::NAN)
    }

    pub(crate) fn numbers(&self, at: usize) -> Vec<f64> {
        bun_core::strings::split(self.text(at), b",")
            .filter_map(|it| crate::values::text(it).parse().ok())
            .collect()
    }

    pub(crate) fn bytes(&self, at: usize) -> Vec<u8> {
        bun_base64::decode_alloc(self.text(at)).unwrap_or_default()
    }
}

type Answered = dyn for<'a> FnOnce(Cx<'_, 'a>, JSValue, &Message<'_>) -> Result<'a, JSValue>;

struct Question {
    promise: Strong,
    subject: Strong,
    answered: Box<Answered>,
}

struct Known {
    object: Weak<()>,
    heard: for<'a> fn(Cx<'_, 'a>, JSValue, &Message<'_>) -> Result<'a, ()>,
    lost: for<'a> fn(Cx<'_, 'a>, JSValue) -> Result<'a, ()>,
}

#[derive(Default)]
pub(crate) struct Link {
    document: Weak<()>,
    /// What was copied in an earlier one is gone.
    era: Cell<u32>,
    last_id: Cell<u32>,
    outbox: RefCell<Vec<u8>>,
    connection: RefCell<Held<Connected>>,
    known: RefCell<HashMap<u32, Known>>,
    /// What keeps the engine running.
    busy: RefCell<HashMap<u32, Strong>>,
    questions: RefCell<HashMap<u32, Question>>,
    /// Changes when there is something to do.
    rest: Cell<u32>,
}

struct Connected(Box<dyn Connection>, std::rc::Weak<Link>);

impl Drop for Connected {
    fn drop(&mut self) {
        drop(
            self.1
                .upgrade()
                .map(|it| (it.busy.take(), it.questions.take())),
        );
    }
}

unsafe extern "C" fn flush_at_end_of_task(link: *mut c_void) -> bool {
    // SAFETY: the reference that `Link::send` gave up.
    let link = unsafe { Rc::from_raw(link.cast_const().cast::<Link>()) };
    while !link.outbox.borrow().is_empty() {
        // SAFETY: the event loop is the caller.
        unsafe {
            JsScope::with(VirtualMachine::get().global().as_mut_ptr(), |cx| {
                link.flush(cx)
            })
        };
    }
    false
}

pub(crate) fn window_has_closed(document: &Doc) {
    if let Some(link) = document.try_extra::<Rc<Link>>() {
        link.outbox.borrow_mut().clear();
        drop((
            link.busy.take(),
            link.questions.take(),
            link.connection.take().take(),
        ));
    }
}

impl Link {
    pub(crate) fn of(heap: &JsHeap<'_>, document: &Doc) -> Rc<Link> {
        let new = || {
            Rc::new(Link {
                document: Weak::create_passive(document.to_js(), global_of(heap)),
                era: Cell::new(1),
                ..Default::default()
            })
        };
        Rc::clone(document.extra_with(new))
    }

    pub(crate) fn document<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a Doc> {
        Node::from_js(heap, self.document.get()?)?.as_doc()
    }

    pub(super) fn is_connected(&self) -> bool {
        self.connection.borrow().borrow().is_some()
    }

    fn new_id(&self) -> u32 {
        self.last_id.set(self.last_id.get() + 1);
        self.last_id.get()
    }

    /// It does not touch the JS heap.
    #[optimize(size)]
    pub(crate) fn send(self: &Rc<Self>, command: &str, arguments: &[Arg<'_>]) {
        let mut outbox = self.outbox.borrow_mut();
        let is_first = outbox.is_empty();
        let _ = write!(outbox, "{}[\"{command}\"", if is_first { '[' } else { ',' });
        for argument in arguments {
            outbox.push(b',');
            argument.write(&mut outbox);
        }
        outbox.push(b']');
        let vm = VirtualMachine::get();
        if is_first && !vm.is_shutting_down() {
            let link = Rc::into_raw(Rc::clone(self)).cast_mut();
            if vm
                .event_loop()
                .deferred_tasks
                .post_task(NonNull::new(link.cast()), flush_at_end_of_task)
            {
                // SAFETY: it was queued already, with another reference.
                drop(unsafe { Rc::from_raw(link) });
            }
        }
    }

    #[optimize(size)]
    pub(crate) fn flush(self: &Rc<Self>, cx: Cx<'_, '_>) {
        let mut commands = self.outbox.take();
        let Some(document) = self
            .document(&cx.heap)
            .filter(|it| !commands.is_empty() && host::plays_media(cx, it))
        else {
            return;
        };
        commands.push(b']');
        if !self.is_connected() {
            let realm = document.realm(&cx.heap);
            let connection = with_realm(global_of(realm), |cx| host::connect(cx, document.to_js()));
            self.connection
                .replace(hold(realm, Connected(connection, Rc::downgrade(self))));
        }
        self.connection
            .borrow()
            .borrow()
            .iter()
            .for_each(|it| it.0.send(&commands, [true; 2]));
    }

    #[optimize(size)]
    pub(super) fn receive<'a>(self: &Rc<Self>, cx: Cx<'_, 'a>, line: &[u8]) -> Result<'a, ()> {
        let mut parts = bun_core::strings::split(line, b"\t");
        let id = parts
            .next()
            .and_then(|it| crate::values::text(it).parse().ok())
            .unwrap_or(0);
        let message = Message {
            kind: parts.next().unwrap_or_default(),
            parts: parts.collect(),
        };
        let question = self.questions.borrow_mut().remove(&id);
        if let Some(question) = question {
            self.rest_if_idle(&cx.heap);
            return question.settle(cx, &message);
        }
        if id == 0 {
            self.document(&cx.heap)
                .into_iter()
                .for_each(|it| host::heard(cx, it, &message));
            return Ok(());
        }
        let known = self
            .known
            .borrow()
            .get(&id)
            .and_then(|it| Some((it.object.get()?, it.heard)));
        known.map_or(Ok(()), |(object, heard)| heard(cx, object, &message))
    }

    #[optimize(size)]
    pub(crate) fn disconnect<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        self.rest.update(|it| it.wrapping_add(1));
        self.outbox.borrow_mut().clear();
        self.era.set(self.era.get() + 1);
        let (known, _busy, questions) =
            (self.known.take(), self.busy.take(), self.questions.take());
        drop(self.connection.take().take());
        for Known { object, lost, .. } in known.values() {
            object.get().map_or(Ok(()), |it| lost(cx, it))?;
        }
        for question in questions.values() {
            let error = cx.heap.create_dom_exception(
                DOMExceptionCode::AbortError,
                format_args!("The audio service has exited."),
            );
            question
                .promise(&cx.heap)
                .map_or(Ok(()), |it| it.reject(cx, error.to_js()))?;
        }
        Ok(())
    }

    fn rest_if_idle(self: &Rc<Self>, heap: &JsHeap<'_>) {
        self.rest.update(|it| it.wrapping_add(1));
        if let Some(document) = self
            .document(heap)
            .filter(|_| self.busy.borrow().is_empty() && self.questions.borrow().is_empty())
        {
            let (link, rest) = (Rc::clone(self), self.rest.get());
            super::queue_task_after(document, IDLE_MILLISECONDS, &[], move |cx, _| {
                if link.rest.get() == rest {
                    link.disconnect(cx)
                } else {
                    Ok(())
                }
            });
        }
    }

    /// The promise is for what `answered` makes of `subject` and the reply.
    #[optimize(size)]
    pub(crate) fn ask<'a>(
        self: &Rc<Self>,
        heap: &JsHeap<'a>,
        method: &str,
        arguments: &[Arg<'_>],
        subject: JSValue,
        answered: impl for<'b> FnOnce(Cx<'_, 'b>, JSValue, &Message<'_>) -> Result<'b, JSValue>
        + 'static,
    ) -> JsLocal<'a, JSPromise> {
        self.ask_boxed(heap, method, arguments, subject, Box::new(answered))
    }

    #[optimize(size)]
    fn ask_boxed<'a>(
        self: &Rc<Self>,
        heap: &JsHeap<'a>,
        method: &str,
        arguments: &[Arg<'_>],
        subject: JSValue,
        answered: Box<Answered>,
    ) -> JsLocal<'a, JSPromise> {
        let (id, promise, global) = (self.new_id(), heap.create_promise(), global_of(heap));
        let [held, subject] = [promise.to_js(), subject].map(|it| Strong::create(it, global));
        self.questions.borrow_mut().insert(
            id,
            Question {
                promise: held,
                subject,
                answered,
            },
        );
        self.rest_if_idle(heap);
        self.send("ask", &[id.into(), method.into(), Arg::List(arguments)]);
        promise
    }

    pub(crate) fn busy_objects(&self) -> Vec<JSValue> {
        self.busy.borrow().values().map(Strong::get).collect()
    }
}

impl Question {
    fn promise<'a>(&self, heap: &JsHeap<'a>) -> Option<JsLocal<'a, JSPromise>> {
        JsLocal::new(heap, self.promise.get()).as_promise()
    }

    fn settle<'a>(self, cx: Cx<'_, 'a>, message: &Message<'_>) -> Result<'a, ()> {
        let Some(promise) = self.promise(&cx.heap) else {
            return Ok(());
        };
        if message.kind != b"reply" {
            let error = streams::error_from(cx, message.text(0), message.text(1), message.text(2))?;
            return promise.reject(cx, error);
        }
        match (self.answered)(cx, self.subject.get(), message) {
            Ok(value) => promise.resolve(cx, value),
            Err(error) => {
                let error = cx.catch(error)?;
                promise.reject(cx, error)
            }
        }
    }
}

/// What names the copy of an object.
pub(crate) struct Remote {
    pub(crate) link: Rc<Link>,
    pub(crate) id: u32,
    era: Cell<u32>,
}

impl Remote {
    pub(crate) fn new(link: Rc<Link>) -> Remote {
        Remote {
            id: link.new_id(),
            link,
            era: Cell::new(0),
        }
    }

    pub(crate) fn object(&self) -> Arg<'static> {
        Arg::Object(self.id)
    }

    pub(crate) fn is_copied(&self) -> bool {
        self.era.get() == self.link.era.get()
    }

    /// The next copy replaces this one.
    pub(crate) fn outdate(&self) {
        self.era.set(0);
    }

    #[optimize(size)]
    pub(crate) fn send(&self, command: &str, arguments: &[Arg<'_>]) {
        self.link
            .send(command, &[&[self.id.into()], arguments].concat());
    }

    pub(crate) fn invoke(&self, method: &str, arguments: &[Arg<'_>]) {
        if self.is_copied() {
            self.link.send(
                "call",
                &[self.object(), method.into(), Arg::List(arguments)],
            );
        }
    }

    pub(crate) fn set(&self, name: &str, value: Arg<'_>) {
        if self.is_copied() {
            self.link.send("set", &[self.object(), name.into(), value]);
        }
    }

    fn forget(&self) {
        let is_known = self.link.known.borrow_mut().remove(&self.id).is_some();
        if is_known {
            self.send("drop", &[]);
        }
        self.outdate();
    }
}

impl Drop for Remote {
    fn drop(&mut self) {
        self.forget();
    }
}

pub(crate) trait Mirrored: JsInterface + Sized {
    fn remote(&self) -> &Remote;

    fn create<'a>(&'a self, heap: &JsHeap<'a>);

    fn heard<'a>(&'a self, _: Cx<'_, 'a>, _: &Message<'_>) -> Result<'a, ()> {
        Ok(())
    }

    fn lost<'a>(&'a self, _: Cx<'_, 'a>) -> Result<'a, ()> {
        Ok(())
    }

    /// Copies what it leads to.
    fn copied<'a>(&'a self, _: &JsHeap<'a>) {}

    /// Whether it had no copy.
    #[optimize(size)]
    fn copy_alone<'a>(&'a self, heap: &JsHeap<'a>) -> bool {
        let remote = self.remote();
        if remote.is_copied() {
            return false;
        }
        remote.era.set(remote.link.era.get());
        let known = Known {
            object: Weak::create_passive(self.to_js(), global_of(heap)),
            heard: |cx, it, message| {
                Self::from_js(&cx.heap, it).map_or(Ok(()), |it| it.heard(cx, message))
            },
            lost: |cx, it| Self::from_js(&cx.heap, it).map_or(Ok(()), |it| it.lost(cx)),
        };
        remote.link.known.borrow_mut().insert(remote.id, known);
        self.create(heap);
        true
    }

    fn copy<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Remote {
        if self.copy_alone(heap) {
            self.copied(heap);
        }
        self.remote()
    }

    #[optimize(size)]
    fn set_busy(&self, heap: &JsHeap<'_>, is_busy: bool) {
        let Remote { link, id, .. } = self.remote();
        if is_busy
            && link
                .document(heap)
                .and_then(Doc::last_window)
                .is_none_or(|it| !it.is_disposed())
        {
            let held = Strong::create(self.to_js(), global_of(heap));
            link.busy.borrow_mut().insert(*id, held);
        } else if link.busy.borrow_mut().remove(id).is_none() {
            return;
        }
        link.rest_if_idle(heap);
    }

    fn drop_copy(&self, heap: &JsHeap<'_>) {
        self.set_busy(heap, false);
        self.remote().forget();
    }
}
