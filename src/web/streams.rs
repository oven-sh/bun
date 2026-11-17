//! Between bodies and `ReadableStream`.

use core::any::Any;
use core::cell::{Cell, RefCell};
use core::future::{Future, poll_fn};
use core::ptr::null;
use core::task::{Context, Poll, Waker};
use std::collections::VecDeque;
use std::rc::Rc;

use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal, JsPayload, JsScope, JsWrapper, to_js};
use bun_jsc::{
    JSGlobalObject, JSPromise, JSType, JSValue, JsResult, Strong, cpp, from_js_host_call,
    from_js_host_call_generic,
};

use crate::exec::{self, Either, Realm, Waiter};
use crate::net::body::{Body, Chunk, FOR_DATA, Read, Source, Writer, pipe};
use crate::net::response::{Answer, Cached, Protocol};
use crate::net::{NetError, Result};

/// So that a request ends of which nothing reads the response.
const MAX_READ_AHEAD: usize = 1 << 20;
const PIPE_CAPACITY: usize = 64 << 10;

pub fn chunk_to_js<'a>(
    heap: &JsHeap<'a>,
    chunk: Chunk,
) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
    match chunk {
        Chunk::Owned(bytes) if bytes.capacity() - bytes.len() <= bytes.len() / 8 => {
            heap.create_uint8_array_from_box(bytes.into())
        }
        bytes => heap.create_uint8_array(&bytes),
    }
}

pub fn error_to_js<'a>(cx: &mut JsScope<'a>, error: NetError) -> JsLocal<'a> {
    let global = cx.global();
    let value = global.create_error_instance(format_args!("{}", error.message()));
    if let Ok(code) = bun_jsc::bun_string_jsc::create_utf8_for_js(global, error.code().as_bytes()) {
        value.put(global, b"code", code);
    }
    value.put(
        global,
        b"errno",
        JSValue::js_number(f64::from(error as i32)),
    );
    JsLocal::new(&cx.heap, value)
}

/// What an error of the app comes to.
pub fn error_from_js<'a>(cx: &mut JsScope<'a>, error: JsLocal<'a>) -> NetError {
    let global = cx.global();
    let text = |name| {
        let value = Some(error.to_js())
            .filter(|it| it.is_object())?
            .get(global, name)
            .and_then(|it| it.map(|it| it.to_utf8(global)).transpose());
        value.map_err(|thrown| global.take_exception(thrown)).ok()?
    };
    text("message")
        .and_then(|it| NetError::from_message(&it))
        .or_else(|| text("code").map(|it| NetError::from_code(&it)))
        .unwrap_or(NetError::Failed)
}

/// A promise of the realm of `cx`, for what `convert` makes of the result.
pub fn promise_for<'a, T: 'static>(
    cx: &mut JsScope<'a>,
    future: impl Future<Output = T> + 'static,
    convert: impl for<'b> FnOnce(&mut JsScope<'b>, T) -> bindgen::Result<'b, JsLocal<'b>> + 'static,
) -> JsLocal<'a> {
    let (promise, steps) = promise_and_steps(cx, future, convert);
    exec::spawn(steps);
    promise
}

/// For a future that waits for scripts. The promise stays pending if the realm stops.
pub fn promise_while_running<'a, T: 'static>(
    cx: &mut JsScope<'a>,
    future: impl Future<Output = T> + 'static,
    convert: impl for<'b> FnOnce(&mut JsScope<'b>, T) -> bindgen::Result<'b, JsLocal<'b>> + 'static,
) -> JsLocal<'a> {
    let (promise, steps) = promise_and_steps(cx, future, convert);
    match crate::realm::Realm::of(cx.global()) {
        Some(realm) => realm.spawn(Box::pin(steps)),
        None => exec::spawn(steps),
    }
    promise
}

fn promise_and_steps<'a, T, F, C>(
    cx: &mut JsScope<'a>,
    future: F,
    convert: C,
) -> (JsLocal<'a>, impl Future<Output = ()> + use<T, F, C>)
where
    F: Future<Output = T>,
    C: for<'b> FnOnce(&mut JsScope<'b>, T) -> bindgen::Result<'b, JsLocal<'b>>,
{
    let (realm, promise) = (Realm::of(cx), JSPromise::create(cx.global()).to_js());
    let held = Strong::create(promise, cx.global());
    let steps = async move {
        let result = future.await;
        realm.enter(|cx| {
            let converted = convert(cx, result).map_err(|it| exec::caught(cx, it));
            let (global, Some(promise)) = (cx.global(), held.get().as_promise()) else {
                return;
            };
            let promise = JSPromise::opaque_mut(promise);
            let settled = match converted {
                Ok(value) => promise.resolve(global, value.to_js()),
                Err(reason) => promise.reject(global, Ok(reason.to_js())),
            };
            exec::report(cx, settled.map_err(Into::into));
        });
    };
    (JsLocal::new(&cx.heap, promise), steps)
}

pub fn rejection<'a>(cx: &mut JsScope<'a>, error: NetError) -> bindgen::Error<'a> {
    bindgen::Error::from_value(error_to_js(cx, error))
}

/// A body that has arrived on the thread of who will read it.
pub struct Incoming {
    came: (Cached, Protocol),
    source: RefCell<Body>,
    ahead: RefCell<VecDeque<Chunk>>,
    failure: Cell<Option<NetError>>,
    is_wanted: Cell<bool>,
    waiter: RefCell<Waiter>,
    held: Cell<Option<Box<dyn Any>>>,
}

impl Incoming {
    pub fn new(source: Body) -> Rc<Incoming> {
        Incoming::of(Answer::of_body(source))
    }

    fn of(answer: Answer) -> Rc<Incoming> {
        Rc::new(Incoming {
            came: (answer.cached, answer.protocol),
            source: answer.body.into(),
            ahead: RefCell::default(),
            failure: Cell::default(),
            is_wanted: Cell::default(),
            waiter: RefCell::default(),
            held: Cell::default(),
        })
    }

    fn take_if_unread(&self) -> Option<Answer> {
        let is_unread = self.failure.get().is_none()
            && self.ahead.borrow().is_empty()
            && !self.is_wanted.replace(true);
        is_unread.then(|| Answer {
            cached: self.came.0,
            protocol: self.came.1,
            ..Answer::of_body(self.source.take())
        })
    }

    pub fn hold_until_end(&self, held: Box<dyn Any>) {
        self.held.set(Some(held));
    }

    /// What has not been read.
    pub fn take(&self) -> Body {
        self.want();
        let ahead = self.ahead.take().into_iter().map(Body::from);
        match self.failure.get() {
            Some(failure) => Body::new(failure),
            None => ahead.chain([self.source.take()]).collect(),
        }
    }

    pub fn read_ahead(self: &Rc<Self>) {
        let mut size = 0;
        if self
            .poll_ahead(&mut Context::from_waker(Waker::noop()), &mut size)
            .is_pending()
        {
            let incoming = Rc::clone(self);
            exec::spawn_background(poll_fn(move |cx| incoming.poll_ahead(cx, &mut size)));
        }
    }

    fn poll_ahead(&self, cx: &mut Context<'_>, size: &mut usize) -> Poll<()> {
        while !self.is_wanted.get() && *size < MAX_READ_AHEAD {
            let Ok(Some(chunk)) = core::task::ready!(self.poll_source(cx)) else {
                break;
            };
            *size += chunk.len();
            self.ahead.borrow_mut().push_back(chunk);
        }
        Poll::Ready(())
    }

    fn poll_source(&self, cx: &mut Context<'_>) -> Poll<Read> {
        // The end of a body is told to scripts of the app.
        let mut source = self.source.take();
        let read = source.poll_read(cx);
        if let Some(failure) = self.failure.get() {
            return Poll::Ready(Err(failure));
        }
        match read {
            Poll::Ready(Err(error)) => self.failure.set(Some(error)),
            Poll::Pending => _ = self.waiter.borrow_mut().pending::<()>(cx),
            Poll::Ready(Ok(_)) => {}
        }
        if matches!(read, Poll::Ready(Err(_) | Ok(None))) {
            self.held.take();
        }
        self.source.replace(source);
        read
    }

    fn want(&self) {
        if !self.is_wanted.replace(true) {
            self.waiter.take().wake();
        }
    }

    pub fn poll_read(&self, cx: &mut Context<'_>) -> Poll<Read> {
        self.want();
        let ahead = self.ahead.borrow_mut().pop_front();
        ahead.map_or_else(|| self.poll_source(cx), |it| Poll::Ready(Ok(Some(it))))
    }

    pub async fn read(&self) -> Read {
        poll_fn(|cx| self.poll_read(cx)).await
    }

    pub async fn read_to_end(&self) -> Result<Chunk> {
        self.source.borrow_mut().expect_read_to_end(&FOR_DATA);
        let Some(first) = self.read().await? else {
            return Ok(Chunk::Owned(Vec::new()));
        };
        let Some(second) = self.read().await? else {
            return Ok(first);
        };
        let mut all = [&*first, &*second].concat();
        while let Some(more) = self.read().await? {
            all.extend_from_slice(&more);
        }
        Ok(Chunk::Owned(all))
    }

    pub fn cancel(&self) {
        self.failure.set(Some(NetError::Aborted));
        drop((self.source.take(), self.ahead.take(), self.held.take()));
        self.waiter.take().wake();
    }
}

/// The underlying source of a stream.
pub struct IncomingBody(pub Rc<Incoming>);

impl IncomingBody {
    pub(crate) fn pull<'a>(
        &self,
        cx: &mut JsScope<'a>,
        controller: JsLocal<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        let (incoming, controller) = (
            Rc::clone(&self.0),
            Strong::create(controller.to_js(), cx.global()),
        );
        Ok(promise_for(
            cx,
            async move { incoming.read().await },
            move |cx, read| {
                match read {
                    Ok(Some(chunk)) => {
                        let chunk = chunk_to_js(&cx.heap, chunk)?;
                        cpp::ReadableByteStreamController__enqueue(
                            cx.global(),
                            controller.get(),
                            chunk.to_js(),
                        )?;
                    }
                    Ok(None) => {
                        cpp::ReadableByteStreamController__close(cx.global(), controller.get())?
                    }
                    Err(error) => {
                        let error = error_to_js(cx, error);
                        cpp::ReadableByteStreamController__error(
                            cx.global(),
                            controller.get(),
                            error.to_js(),
                        )?;
                    }
                }
                Ok(JsLocal::UNDEFINED)
            },
        ))
    }

    pub(crate) fn cancel(&self) {
        self.0.cancel();
    }

    pub(crate) fn read<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        let incoming = Rc::clone(&self.0);
        Ok(promise_for(
            cx,
            async move { incoming.read().await },
            |cx, read| {
                let chunk = read.map_err(|it| rejection(cx, it))?;
                let done = to_js::bool(&cx.heap, chunk.is_none())?;
                let value = chunk.map_or(Ok(JsLocal::UNDEFINED), |it| {
                    chunk_to_js(&cx.heap, it).map(JsLocal::as_value)
                })?;
                to_js::record(&cx.heap, [("done", done), ("value", value)], to_js::any)
            },
        ))
    }

    pub(crate) fn read_all<'a>(&self, cx: &mut JsScope<'a>) -> bindgen::Result<'a, JsLocal<'a>> {
        let incoming = Rc::clone(&self.0);
        Ok(promise_for(
            cx,
            async move { incoming.read_to_end().await },
            |cx, all| {
                let all = all.map_err(|it| rejection(cx, it))?;
                chunk_to_js(&cx.heap, all).map(JsLocal::as_value)
            },
        ))
    }

    pub(crate) fn get_body<'a>(
        &self,
        this: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> bindgen::Result<'a, JSValue> {
        Ok(cpp::ReadableStream__createForBytes(
            cx.global(),
            this.to_js(),
            0.0,
        )?)
    }
}

/// Of the body of `answer`.
pub fn stream_of<'a>(cx: &mut JsScope<'a>, answer: Answer) -> bindgen::Result<'a, JSValue> {
    let source = IncomingBody(Incoming::of(answer)).into_js(&cx.heap);
    Ok(cpp::ReadableStream__createForBytes(
        cx.global(),
        source.to_js(),
        0.0,
    )?)
}

/// `None` if nobody wants any more.
async fn pump(realm: &Realm, reader: &Strong, writer: &Writer) -> Option<Result<()>> {
    loop {
        writer.ready().await.then_some(())?;
        let reading =
            realm.enter(
                |cx| match cpp::ReadableStreamReader__read(cx.global(), reader.get()) {
                    Ok(promise) => Some(exec::settled(cx, JsLocal::new(&cx.heap, promise))),
                    Err(thrown) => (exec::caught(cx, thrown.into()), None).1,
                },
            );
        let Some(reading) = reading else {
            return Some(Err(NetError::Failed));
        };
        let Either::First(read) = exec::race(reading, writer.abandoned()).await else {
            return None;
        };
        let chunk = match read {
            Ok(chunk) if cpp::ReadableStreamReader__isEnd(chunk.get()) => return Some(Ok(())),
            Ok(chunk) => chunk,
            Err(reason) => {
                return Some(Err(realm.enter(|cx| {
                    error_from_js(cx, JsLocal::new(&cx.heap, reason.get()))
                })));
            }
        };
        let view = Some(chunk.get()).filter(|it| it.js_type() == JSType::Uint8Array);
        let bytes = view.and_then(|it| {
            realm.enter(|cx| Some(it.as_array_buffer(cx.global())?.byte_slice().to_vec()))
        });
        let Some(bytes) = bytes else {
            writer.fail(NetError::Failed);
            return None;
        };
        writer.write(Chunk::Owned(bytes));
    }
}

/// Locks `stream`.
pub fn body_of_stream<'a>(cx: &mut JsScope<'a>, stream: JSValue) -> bindgen::Result<'a, Answer> {
    let global = cx.global();
    let reader = cpp::ReadableStream__acquireReader(global, stream)?;
    if let Some(answer) = cpp::ReadableStream__sourceOfBytes(stream)
        .as_class_ref::<IncomingBody>()
        .and_then(|it| it.0.take_if_unread())
    {
        return Ok(answer);
    }
    Ok(Answer::of_body(body_of_reader(cx, reader)))
}

pub fn body_of_reader(cx: &mut JsScope<'_>, reader: JSValue) -> Body {
    let reader = Strong::create(reader, cx.global());
    let (realm, (writer, body)) = (Realm::of(cx), pipe(PIPE_CAPACITY));
    exec::spawn_background(async move {
        match pump(&realm, &reader, &writer).await {
            Some(end) => writer.end(end),
            None => realm.enter(|cx| {
                let canceled = cpp::ReadableStreamReader__cancel(
                    cx.global(),
                    reader.get(),
                    JSValue::UNDEFINED,
                );
                exec::report(cx, canceled.map_err(Into::into));
            }),
        }
    });
    body
}

unsafe extern "C" {
    safe fn ReadableStream__is(value: JSValue) -> bool;
    safe fn ReadableStream__isDisturbed(value: JSValue, _: *const JSGlobalObject) -> bool;
    safe fn ReadableStream__isLocked(value: JSValue, _: *const JSGlobalObject) -> bool;
    safe fn ReadableStream__markConsumedAsBody(value: JSValue, _: *const JSGlobalObject);
    safe fn ReadableStream__empty(global: &JSGlobalObject) -> JSValue;
    safe fn ReadableStream__used(global: &JSGlobalObject, is_consumed: bool) -> JSValue;
    safe fn ReadableStream__textDecodeFrom(global: &JSGlobalObject, source: JSValue) -> JSValue;
    safe fn ReadableStream__tee(
        stream: JSValue,
        global: &JSGlobalObject,
        first: &mut JSValue,
        second: &mut JSValue,
    ) -> bool;
    safe fn TransformStream__ends(
        value: JSValue,
        readable: &mut JSValue,
        writable: &mut JSValue,
    ) -> bool;
}

pub fn is_stream(value: JSValue) -> bool {
    ReadableStream__is(value)
}

pub fn is_disturbed(stream: JSValue) -> bool {
    ReadableStream__isDisturbed(stream, null())
}

pub fn is_locked(stream: JSValue) -> bool {
    ReadableStream__isLocked(stream, null())
}

pub fn mark_as_used(stream: JSValue) {
    ReadableStream__markConsumedAsBody(stream, null());
}

pub fn empty_stream(global: &JSGlobalObject) -> JsResult<JSValue> {
    from_js_host_call(global, || ReadableStream__empty(global))
}

pub fn used_stream(global: &JSGlobalObject) -> JsResult<JSValue> {
    from_js_host_call(global, || ReadableStream__used(global, true))
}

pub fn decoded_stream(global: &JSGlobalObject, bytes: JSValue) -> JsResult<JSValue> {
    from_js_host_call(global, || ReadableStream__textDecodeFrom(global, bytes))
}

pub fn tee(global: &JSGlobalObject, stream: JSValue) -> JsResult<(JSValue, JSValue)> {
    let mut branches = (JSValue::UNDEFINED, JSValue::UNDEFINED);
    from_js_host_call_generic(global, || {
        ReadableStream__tee(stream, global, &mut branches.0, &mut branches.1)
    })?;
    Ok(branches)
}

/// `None` if it is no `TransformStream`.
pub fn ends_of_transform(value: JSValue) -> Option<(JSValue, JSValue)> {
    let mut ends = (JSValue::UNDEFINED, JSValue::UNDEFINED);
    TransformStream__ends(value, &mut ends.0, &mut ends.1).then_some(ends)
}
