//! The frames of a page.

use std::rc::{Rc, Weak};

use bun_jsc::Strong;

use super::connection::Connection;
use super::contents::Contents;
use super::engine::EngineSession;
use super::{Emit, Failure, Session, random_id, target_id_of};
use crate::contents::inspection;
use crate::prelude::*;
use crate::task;
use crate::value::Value;
use crate::webview::remote::Remote;
use crate::webview::remote::field;

struct Attached {
    target: Rc<str>,
    id: Rc<str>,
    session: Rc<dyn Session>,
}

struct Frame {
    object: Strong,
    attached: RefCell<Option<Attached>>,
}

impl Frame {
    fn element(&self) -> JSValue {
        let object = self.object.get();
        let place = match inspection::around(object) {
            Some(contents) => contents.place_of_element(),
            None => cast(object).and_then(Remote::place_of_element),
        };
        field(place.map(|[page, frame]| bun_web::dom::element_of_frame(page, frame)))
    }
}

pub(super) struct Frames {
    connection: Weak<Connection>,
    contents: Contents,
    emit: Emit,
    all: RefCell<Vec<Rc<Frame>>>,
    is_started: Cell<bool>,
}

impl Frames {
    pub(super) fn new(connection: Weak<Connection>, contents: Contents, emit: Emit) -> Rc<Frames> {
        Rc::new(Frames {
            connection,
            contents,
            emit,
            all: RefCell::default(),
            is_started: Cell::default(),
        })
    }

    pub(super) fn start(self: &Rc<Self>) -> JsResult<()> {
        self.is_started.set(true);
        self.update()
    }

    pub(super) fn update(self: &Rc<Self>) -> JsResult<()> {
        if !self.is_started.get() {
            return Ok(());
        }
        with_elements(self.contents.page().frames_if_any()?, |now| {
            let is_gone = |it: &mut Rc<Frame>| !now.contains(&it.object.get());
            let gone: Vec<_> = self.all.borrow_mut().extract_if(.., is_gone).collect();
            gone.iter().for_each(|it| self.detach(it));
            for object in now {
                if (self.all.borrow().iter()).any(|it| it.object.get() == *object) {
                    continue;
                }
                let frame = Rc::new(Frame {
                    object: keep(*object),
                    attached: RefCell::default(),
                });
                self.all.borrow_mut().push(Rc::clone(&frame));
                match cast::<Remote>(*object) {
                    Some(_) => self.attach_remote(frame),
                    None => self.attach_local(frame)?,
                }
            }
            Ok(())
        })
    }

    /// The connection, if `frame` is still there.
    fn connection_for(&self, frame: &Rc<Frame>) -> Option<Rc<Connection>> {
        let is_there = self.all.borrow().iter().any(|it| Rc::ptr_eq(it, frame));
        self.connection.upgrade().filter(|_| is_there)
    }

    fn announce(&self, connection: &Connection, frame: &Frame, it: Attached) {
        connection.add(Rc::clone(&it.id), Rc::clone(&it.session));
        let params = record! {
            "sessionId": &*it.id,
            "targetInfo": record! {
                "targetId": &*it.target,
                "type": "iframe",
                "title": "",
                "url": "",
                "attached": true,
                "parentFrameId": &*target_id_of(self.contents.object()),
            },
            "waitingForDebugger": false,
        };
        frame.attached.replace(Some(it));
        (self.emit)("Target.attachedToTarget", params);
    }

    fn attach_local(self: &Rc<Self>, frame: Rc<Frame>) -> JsResult<()> {
        let Some(contents) = inspection::around(frame.object.get()).map(Contents::new) else {
            return Ok(());
        };
        let frames = Rc::clone(self);
        later::soon(move |_| {
            if let Some(connection) = frames.connection_for(&frame) {
                let (id, target): (Rc<str>, _) =
                    (random_id().into(), target_id_of(contents.object()));
                let emit = connection.emitter(Some(Rc::clone(&id)));
                let session = connection.local(contents, emit)?;
                let attached = Attached {
                    target,
                    id,
                    session,
                };
                frames.announce(&connection, &frame, attached);
            }
            Ok(())
        });
        Ok(())
    }

    fn attach_remote(self: &Rc<Self>, frame: Rc<Frame>) {
        let frames = Rc::clone(self);
        task::spawn(async move { drop(frames.try_to_attach_remote(frame).await) });
    }

    async fn try_to_attach_remote(self: Rc<Self>, frame: Rc<Frame>) -> Result<(), Failure> {
        let (ours, added) = (target_id_of(self.contents.object()), task::Later::default());
        let (parent, found) = (Rc::clone(&ours), added.clone());
        let wait = move |method: &str, params: Value| {
            if method == "Page.frameAttached" && params["parentFrameId"].is(&parent) {
                found.set(Rc::from(params["frameId"].text()));
            }
        };
        let remote = Root::new(cast::<Remote>(frame.object.get()).ok_or("It is local")?);
        let connection = Weak::clone(&self.connection);
        let session = EngineSession::attach(connection, remote, ours, Rc::new(wait), true).await?;
        session.inspect("Page.enable", Value::empty()).await?;
        let params = record! { "expression": "document.querySelector('iframe')" };
        let element = session.inspect("Runtime.evaluate", params).await?;
        if element["result"]["objectId"].is_truthy() {
            let params = element["result"].pick(&["objectId"]);
            let described = session.inspect("DOM.describeNode", params).await?;
            if let Some(known) = described["node"]["frameId"].as_text() {
                added.set(known.into());
            }
        }
        let target: Rc<str> = added.await;
        session.inner.replace(Some(Rc::clone(&target)));
        let Some(connection) = self.connection_for(&frame) else {
            session.close();
            return Ok(());
        };
        let id = Rc::clone(&session.id);
        (session.emit).replace(connection.emitter(Some(Rc::clone(&id))));
        let (frames, old, again) = (Rc::clone(&self), Rc::clone(&session), Rc::clone(&frame));
        session.swapped_back.replace(Some(Box::new(move || {
            old.close();
            if frames.connection_for(&again).is_some() {
                frames.attach_remote(again);
            }
        })));
        let attached = Attached {
            target,
            id,
            session,
        };
        self.announce(&connection, &frame, attached);
        Ok(())
    }

    fn detach(&self, frame: &Frame) {
        let Some(it) = frame.attached.take() else {
            return;
        };
        it.session.close();
        if let Some(connection) = self.connection.upgrade() {
            connection.remove(&it.id);
        }
        let params = record! { "sessionId": &*it.id, "targetId": &*it.target };
        (self.emit)("Target.detachedFromTarget", params);
    }

    pub(super) fn id_of(&self, element: JSValue) -> JsResult<Option<Rc<str>>> {
        let all = self.all.borrow().clone();
        for frame in all {
            if frame.element() == element {
                let attached = frame.attached.borrow();
                return Ok(attached.as_ref().map(|it| Rc::clone(&it.target)));
            }
        }
        Ok(None)
    }

    pub(super) fn owner_of(&self, target: &str) -> JsResult<Option<JSValue>> {
        let is_it = |it: &&Rc<Frame>| {
            (it.attached.borrow().as_ref()).is_some_and(|it| *it.target == *target)
        };
        let found = self.all.borrow().iter().find(is_it).cloned();
        Ok(found.map(|it| it.element()))
    }

    pub(super) fn close(&self) {
        self.is_started.set(false);
        self.all.take().iter().for_each(|it| self.detach(it));
    }
}
