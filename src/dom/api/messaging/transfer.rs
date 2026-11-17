//! <https://html.spec.whatwg.org/#transferable-objects>

use bun_jsc::bindgen::IntoError as _;
use bun_jsc::{JSType, MarkedArgumentBuffer, cpp};
use bun_web::channel::Transferred;
use bun_web::streams;

use super::*;
use crate::api::canvas;
use crate::order::Order as _;

fn data_clone_error<'a>(heap: &JsHeap<'a>, message: &str) -> bindgen::Error<'a> {
    dom_error(heap, DomError::DataCloneError, message)
}

enum Transferable<'a> {
    Port(&'a MessagePort),
    ReadableStream(JSValue),
    WritableStream(JSValue),
    TransformStream(JSValue, JSValue),
    Canvas(canvas::Transferable<'a>),
}

impl<'a> Transferable<'a> {
    fn of(cx: Cx<'_, 'a>, object: JSValue) -> Result<'a, Transferable<'a>> {
        let is_locked = |it| streams::is_locked(it) || cpp::WritableStream__isLocked(it);
        let (found, is_available) = if let Some(port) = MessagePort::from_js(&cx.heap, object) {
            (Transferable::Port(port), port.endpoint.borrow().is_some())
        } else if streams::is_stream(object) {
            (Transferable::ReadableStream(object), !is_locked(object))
        } else if cpp::WritableStream__is(object) {
            (Transferable::WritableStream(object), !is_locked(object))
        } else if let Some((readable, writable)) = streams::ends_of_transform(object) {
            (
                Transferable::TransformStream(readable, writable),
                !is_locked(readable) && !is_locked(writable),
            )
        } else {
            let refused =
                || data_clone_error(&cx.heap, "An object in the list cannot be transferred.");
            (
                Transferable::Canvas(
                    canvas::Transferable::of(&cx.heap, object)
                        .ok_or_else(refused)?
                        .map_err(|it| it.into_error(&cx.heap))?,
                ),
                true,
            )
        };
        if is_available {
            Ok(found)
        } else {
            Err(data_clone_error(
                &cx.heap,
                "An object in the list cannot be transferred.",
            ))
        }
    }

    fn transfer(self, cx: Cx<'_, 'a>) -> Result<'a, Transferred> {
        Ok(match self {
            Transferable::Port(port) => Transferred::Port(
                port.detach()
                    .ok_or_else(|| data_clone_error(&cx.heap, "The port is already detached."))?,
            ),
            Transferable::ReadableStream(stream) => {
                Transferred::ReadableStream(StreamEnd::drain(cx, stream)?)
            }
            Transferable::WritableStream(stream) => {
                Transferred::WritableStream(StreamEnd::fill(cx, stream)?)
            }
            Transferable::TransformStream(readable, writable) => Transferred::TransformStream {
                readable: StreamEnd::drain(cx, readable)?,
                writable: StreamEnd::fill(cx, writable)?,
            },
            Transferable::Canvas(it) => Transferred::Canvas(it.transfer(cx)),
        })
    }
}

/// <https://html.spec.whatwg.org/#structuredserializewithtransfer>. The caller keeps `transfer` alive.
pub(crate) fn serialize<'a>(
    cx: Cx<'_, 'a>,
    value: JSValue,
    transfer: impl ExactSizeIterator<Item = JSValue>,
) -> Result<'a, Message> {
    if transfer.len() == 0 {
        return Ok(Serialized::new(cx.global(), value, &[], &[])?.into());
    }
    let (buffers, objects): (Vec<_>, Vec<_>) =
        transfer.partition(|it| it.js_type() == JSType::ArrayBuffer);
    let mut sorted: Vec<_> = objects.iter().map(|it| it.encoded()).collect();
    sorted.order_by(Ord::cmp);
    if !sorted.is_sorted_by(|a, b| a < b) {
        return Err(data_clone_error(
            &cx.heap,
            "An object is in the transfer list twice.",
        ));
    }
    objects
        .iter()
        .try_for_each(|it| Transferable::of(cx, *it).map(drop))?;
    let value = Serialized::new(cx.global(), value, &buffers, &objects)?;
    let transferred = objects
        .iter()
        .map(|it| Transferable::of(cx, *it)?.transfer(cx))
        .collect::<Result<'a, _>>()?;
    Ok(Message {
        value,
        transferred,
        kind: 0,
    })
}

/// <https://html.spec.whatwg.org/#structureddeserializewithtransfer>: the value, and a frozen array of the ports if
/// there are any.
pub(crate) fn receive<'a>(
    cx: Cx<'_, 'a>,
    Message {
        value, transferred, ..
    }: Message,
) -> Result<'a, (JSValue, JSValue)> {
    if transferred.is_empty() {
        return Ok((value.deserialize(cx.global(), &[])?, JSValue::ZERO));
    }
    MarkedArgumentBuffer::new(|roots| {
        let mut objects = Vec::with_capacity(transferred.len());
        for transferred in transferred {
            let object = match transferred {
                Transferred::Port(endpoint) => MessagePort::new(&cx.heap, endpoint).to_js(),
                Transferred::ReadableStream(endpoint) => StreamEnd::readable(cx, endpoint)?,
                Transferred::WritableStream(endpoint) => StreamEnd::writable(cx, endpoint)?,
                Transferred::TransformStream { readable, writable } => {
                    let (readable, writable) = (
                        StreamEnd::readable(cx, readable)?,
                        StreamEnd::writable(cx, writable)?,
                    );
                    cpp::TransformStream__createFromEnds(cx.global(), readable, writable)
                }
                Transferred::Canvas(it) => canvas::receive(&cx.heap, it),
            };
            roots.append(object);
            objects.push(object);
        }
        let value = value.deserialize(cx.global(), &objects)?;
        objects.retain(|it| MessagePort::is(*it));
        Ok((value, frozen(&cx.heap, objects.into_iter())?))
    })
}

impl CloningScope {
    pub(crate) fn structured_clone<'a>(
        &self,
        cx: Cx<'_, 'a>,
        value: JsLocal<'a>,
        options: &SerializeOptions<'a>,
    ) -> Result<'a, JSValue> {
        if options.transfer.is_empty() {
            return Ok(cpp::Bun__structuredClone(cx.global(), value.to_js())?);
        }
        let message = serialize(
            cx,
            value.to_js(),
            options.transfer.iter().map(JsLocal::to_js),
        )?;
        Ok(receive(cx, message)?.0)
    }
}

const CHUNK: u8 = 0;
const CLOSE: u8 = 1;
const ERROR: u8 = 2;
const PULL: u8 = 3;

/// <https://streams.spec.whatwg.org/#transferrable-streams>
pub(crate) struct StreamEnd(Held<Endpoint>, bindgen::Interior);

impl StreamEnd {
    fn new<'a>(cx: Cx<'_, 'a>, endpoint: Endpoint, is_readable: bool) -> Result<'a, JSValue> {
        let this = js_StreamEnd::create(
            &cx.heap,
            StreamEnd(hold(&cx.heap, endpoint), Default::default()),
        );
        let stream = cpp::Stream__createForValues(cx.global(), this.to_js(), is_readable)?;
        js_StreamEnd::set_stream(this, stream);
        js_StreamEnd::set_pulled(
            this,
            if is_readable {
                JSValue::ZERO
            } else {
                cx.heap.create_promise().to_js()
            },
        );
        if let Some(it) = this.0.borrow().as_ref() {
            listen(cx, it, this.to_js(), StreamEnd::arrived);
        }
        Ok(stream)
    }

    fn readable<'a>(cx: Cx<'_, 'a>, endpoint: Endpoint) -> Result<'a, JSValue> {
        StreamEnd::new(cx, endpoint, true)
    }

    fn writable<'a>(cx: Cx<'_, 'a>, endpoint: Endpoint) -> Result<'a, JSValue> {
        StreamEnd::new(cx, endpoint, false)
    }

    fn drain<'a>(cx: Cx<'_, 'a>, readable: JSValue) -> Result<'a, Endpoint> {
        let (own, other) = Endpoint::pair();
        let writable = StreamEnd::writable(cx, own)?;
        cpp::ReadableStream__pipeTo(cx.global(), readable, writable)?;
        Ok(other)
    }

    fn fill<'a>(cx: Cx<'_, 'a>, writable: JSValue) -> Result<'a, Endpoint> {
        let (own, other) = Endpoint::pair();
        let readable = StreamEnd::readable(cx, own)?;
        cpp::ReadableStream__pipeTo(cx.global(), readable, writable)?;
        Ok(other)
    }

    fn send(&self, kind: u8, value: Option<Serialized>) {
        let message = value
            .or_else(|| Serialized::immediate(JSValue::UNDEFINED))
            .map(|it| Message { kind, ..it.into() });
        if let Some(it) = self.0.borrow().as_ref().zip(message) {
            it.0.send(it.1);
        }
    }

    /// <https://streams.spec.whatwg.org/#abstract-opdef-packandpostmessagehandlingerror>
    fn post<'a>(&self, cx: Cx<'_, 'a>, kind: u8, value: JSValue) -> Result<'a> {
        let error = match Serialized::new(cx.global(), value, &[], &[]) {
            Ok(value) => {
                self.send(kind, Some(value));
                return Ok(());
            }
            Err(error) => cx.catch(error.into())?,
        };
        self.send(ERROR, Some(Serialized::new(cx.global(), error, &[], &[])?));
        self.0.take();
        Err(bindgen::Error::from_value(JsLocal::new(&cx.heap, error)))
    }

    fn accept<'a>(&self, cx: Cx<'_, 'a>, message: &Message) -> Result<'a> {
        let (stream, pulled) = (
            js_StreamEnd::stream(self).unwrap_or(JSValue::UNDEFINED),
            js_StreamEnd::pulled(self),
        );
        let (kind, value) = match message.value.deserialize(cx.global(), &[]) {
            Ok(value) => (message.kind, value),
            Err(error) => {
                cx.catch(error.into())?;
                let error = cx.catch(data_clone_error(&cx.heap, "A chunk could not be cloned."))?;
                self.post(cx, ERROR, error)?;
                (ERROR, error)
            }
        };
        match kind {
            CHUNK => cpp::ReadableStream__enqueueValue(cx.global(), stream, value)?,
            CLOSE => cpp::ReadableStream__closeValues(cx.global(), stream)?,
            ERROR => cpp::Stream__errorValues(cx.global(), stream, value)?,
            _ => {}
        }
        if matches!(kind, CLOSE | ERROR) {
            self.0.take();
        }
        pulled
            .and_then(|it| JsLocal::new(&cx.heap, it).as_promise())
            .map_or(Ok(()), |it| it.resolve(cx, JSValue::UNDEFINED))
    }

    fn arrived<'a>(cx: Cx<'_, 'a>, this: JsLocal<'a>) {
        let Some(this) = StreamEnd::from_js(&cx.heap, this.to_js()) else {
            return;
        };
        let arrival = this.0.borrow().as_ref().and_then(Endpoint::take);
        match arrival {
            Some(Arrival::Message(message)) => {
                let accepted = this.accept(cx, &message);
                exec::report(cx, accepted);
            }
            Some(Arrival::Closed) => drop(this.0.take()),
            None => {}
        }
    }

    pub(crate) fn pull(&self) {
        self.send(PULL, None);
    }

    pub(crate) fn cancel<'a>(&self, cx: Cx<'_, 'a>, reason: JsLocal<'a>) -> Result<'a> {
        self.post(cx, ERROR, reason.to_js())?;
        self.0.take();
        Ok(())
    }

    pub(crate) fn write<'a>(&self, cx: Cx<'_, 'a>, chunk: JsLocal<'a>) -> Result<'a, JSValue> {
        fn pulled<'a>(
            cx: Cx<'_, 'a>,
            [this, chunk]: [JsLocal<'a>; 2],
            _: u64,
            _: &[JsLocal<'a>],
        ) -> Result<'a, JSValue> {
            let Some(this) = StreamEnd::from_js(&cx.heap, this.to_js()) else {
                return Ok(JSValue::UNDEFINED);
            };
            let written =
                js_StreamEnd::written(this).and_then(|it| JsLocal::new(&cx.heap, it).as_promise());
            js_StreamEnd::set_pulled(this, cx.heap.create_promise().to_js());
            match this.post(cx, CHUNK, chunk.to_js()) {
                Ok(()) => written.map_or(Ok(()), |it| it.resolve(cx, JSValue::UNDEFINED))?,
                Err(error) => cx
                    .catch(error)
                    .and_then(|error| written.map_or(Ok(()), |it| it.reject(cx, error)))?,
            }
            Ok(JSValue::UNDEFINED)
        }
        let written = cx.heap.create_promise().to_js();
        js_StreamEnd::set_written(self, written);
        let promise =
            js_StreamEnd::pulled(self).and_then(|it| JsLocal::new(&cx.heap, it).as_promise());
        if let Some(it) = promise {
            it.react(
                &cx.heap,
                Some(
                    cx.heap
                        .create_callback(pulled, [self.to_js(), chunk.to_js()], 0),
                ),
                None,
            );
        }
        Ok(written)
    }

    pub(crate) fn close(&self) {
        self.send(CLOSE, None);
        self.0.take();
    }
}
