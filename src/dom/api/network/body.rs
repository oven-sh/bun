//! <https://fetch.spec.whatwg.org/#body-mixin>

use bun_core::{EncodedSlice, strings};
use bun_jsc::webcore_types::Blob as JsBlob;
use bun_jsc::{
    ArrayBuffer, DOMFormData, EncodedSliceJsc, JSType, Strong, URLSearchParams, bun_string_jsc, cpp,
};
use bun_web::convert::blob_from_js;
use bun_web::exec;
use bun_web::mime::Mime;
use bun_web::net::body::{Chunk, Data, concat};
use bun_web::request::RequestBody;
use bun_web::runtime::create_blob;
use bun_web::streams::{self, Incoming, body_of_reader, chunk_to_js};

use super::headers::Guarded;
use super::*;

#[derive(Clone, Default)]
pub(crate) enum Content {
    #[default]
    Null,
    Data(Data),
    Incoming(Rc<Incoming>),
    /// What a stream of a script gives.
    Stream,
}

/// On its way from one object to another.
#[derive(Default)]
pub(crate) struct Body<'a> {
    pub(crate) content: Content,
    stream: Option<JsLocal<'a>>,
    /// Of the stream of who had it before.
    reader: Option<JsLocal<'a>>,
}

impl From<Content> for Body<'_> {
    fn from(content: Content) -> Self {
        Body {
            content,
            stream: None,
            reader: None,
        }
    }
}

impl From<Vec<u8>> for Body<'_> {
    fn from(bytes: Vec<u8>) -> Self {
        Content::Data(Data::Bytes(bytes.into())).into()
    }
}

pub(super) const TEXT: &[u8] = b"text/plain;charset=UTF-8";
pub(super) const URL_ENCODED: &[u8] = b"application/x-www-form-urlencoded;charset=UTF-8";

/// `None` if it is no `BufferSource`.
pub(super) fn unshared_buffer<'a>(
    cx: Cx<'_, 'a>,
    value: JsLocal<'a>,
) -> Result<'a, Option<ArrayBuffer>> {
    match value.to_js().as_array_buffer(cx.global()) {
        Some(buffer) if buffer.shared => {
            Err(type_error(&cx.heap, "The buffer must not be shared."))
        }
        buffer => Ok(buffer),
    }
}

pub(super) fn copy_of_buffer<'a>(
    cx: Cx<'_, 'a>,
    value: JsLocal<'a>,
) -> Result<'a, Option<Vec<u8>>> {
    Ok(unshared_buffer(cx, value)?.map(|it| concat(&[it.byte_slice()])))
}

pub(super) fn well_formed_utf8<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, Vec<u8>> {
    Ok(DomString::from_js(cx, value)?
        .to_utf8()
        .into_owned()
        .into_bytes())
}

impl<'a> Body<'a> {
    /// <https://fetch.spec.whatwg.org/#concept-bodyinit-extract>, but for streams.
    #[optimize(size)]
    pub(super) fn extract_data(
        cx: Cx<'_, 'a>,
        init: JsLocal<'a>,
    ) -> Result<'a, (Data, Option<Bytes>)> {
        let value = init.to_js();
        let unreadable = |cx: Cx<'_, 'a>| type_error(&cx.heap, "The blob cannot be read.");
        if let Some(blob) = value.as_class_ref::<JsBlob>() {
            let blob = blob_from_js(&blob).ok_or_else(|| unreadable(cx))?;
            return Ok((blob.data, Some(blob.mime).filter(|it| !it.is_empty())));
        }
        if let Some(bytes) = copy_of_buffer(cx, init)? {
            return Ok((Data::Bytes(bytes.into()), None));
        }
        if let Some(form) = DOMFormData::from_js(&value) {
            let (data, mime) = form_data::encode(&form).ok_or_else(|| unreadable(cx))?;
            return Ok((data, Some(mime.into())));
        }
        if let Some(parameters) = URLSearchParams::from_js(&value) {
            let mut text = Vec::new();
            parameters.to_string(&mut text, |text, it| text.extend_from_slice(&it.to_utf8()));
            return Ok((Data::Bytes(text.into()), Some(URL_ENCODED.into())));
        }
        Ok((
            Data::Bytes(well_formed_utf8(cx, init)?.into()),
            Some(TEXT.into()),
        ))
    }

    #[optimize(size)]
    pub(super) fn extract(
        cx: Cx<'_, 'a>,
        init: JsLocal<'a>,
        keepalive: bool,
    ) -> Result<'a, (Body<'a>, Option<Bytes>)> {
        if !streams::is_stream(init.to_js()) {
            return Body::extract_data(cx, init).map(|it| (Content::Data(it.0).into(), it.1));
        }
        if keepalive {
            return Err(type_error(
                &cx.heap,
                "A keepalive request cannot have a ReadableStream body.",
            ));
        }
        if streams::is_disturbed(init.to_js()) || streams::is_locked(init.to_js()) {
            return Err(type_error(&cx.heap, "The stream is disturbed or locked."));
        }
        Ok((
            Body {
                content: Content::Stream,
                stream: Some(init),
                reader: None,
            },
            None,
        ))
    }

    #[optimize(size)]
    pub(super) fn length(&self) -> Option<u64> {
        match &self.content {
            Content::Null => Some(0),
            Content::Data(data) => Some(data.len()),
            Content::Incoming(_) | Content::Stream => None,
        }
    }

    #[optimize(size)]
    fn reader(&mut self, cx: Cx<'_, 'a>) -> Result<'a, Option<JsLocal<'a>>> {
        if let Some(stream) = self.stream.take() {
            let reader = cpp::ReadableStream__acquireReader(cx.global(), stream.to_js())?;
            streams::mark_as_used(stream.to_js());
            self.reader = Some(JsLocal::new(&cx.heap, reader));
        }
        Ok(self.reader)
    }

    pub(super) fn cancel(mut self, cx: Cx<'_, 'a>, reason: JSValue) -> Result<'a> {
        let reader = self.reader(cx)?;
        Ok(reader.map_or(Ok(()), |it| {
            cpp::ReadableStreamReader__cancel(cx.global(), it.to_js(), reason)
        })?)
    }

    /// And the reader that it comes from.
    #[optimize(size)]
    pub(super) fn into_upload(
        mut self,
        cx: Cx<'_, 'a>,
    ) -> Result<'a, (Option<RequestBody>, Option<JsLocal<'a>>)> {
        let reader = self.reader(cx)?;
        Ok(match (self.content, reader) {
            (Content::Data(data), _) => (Some(RequestBody::Data(data)), None),
            (Content::Incoming(incoming), None) => {
                (Some(RequestBody::Stream(Some(incoming.take()))), None)
            }
            (_, reader) => (
                reader.map(|it| RequestBody::Stream(Some(body_of_reader(cx, it.to_js())))),
                reader,
            ),
        })
    }
}

/// Why what follows `signal` has not arrived.
pub(super) fn failure<'a>(cx: Cx<'_, 'a>, signal: Option<JSValue>) -> Error<'a> {
    match signal
        .and_then(|it| JsLocal::new(&cx.heap, it).as_abort_signal())
        .filter(|it| it.is_aborted())
    {
        Some(signal) => Error::from_value(JsLocal::new(&cx.heap, signal.reason(&cx.heap))),
        None => type_error(&cx.heap, "Failed to fetch"),
    }
}

pub(super) enum ReadError {
    Reason(Strong),
    NoBytes,
    /// With the signal that is followed.
    Network(Option<Strong>),
}

impl ReadError {
    #[optimize(size)]
    pub(super) fn into_error<'a>(self, cx: Cx<'_, 'a>) -> Error<'a> {
        match self {
            ReadError::Reason(reason) => Error::from_value(JsLocal::new(&cx.heap, reason.get())),
            ReadError::NoBytes => type_error(
                &cx.heap,
                "The chunks of a body have to be of type Uint8Array.",
            ),
            ReadError::Network(signal) => failure(cx, signal.map(|it| it.get())),
        }
    }
}

struct Reader(exec::Realm, Strong);

impl Reader {
    fn new(cx: Cx<'_, '_>, reader: JSValue) -> Reader {
        Reader(exec::Realm::of(cx), Strong::create(reader, cx.global()))
    }

    /// False at the end.
    #[optimize(size)]
    async fn read_into(&self, bytes: &mut Vec<u8>) -> core::result::Result<bool, ReadError> {
        let reading =
            self.0.enter(
                |cx| match cpp::ReadableStreamReader__read(cx.global(), self.1.get()) {
                    Ok(promise) => Ok(exec::settled(cx, JsLocal::new(&cx.heap, promise))),
                    Err(thrown) => Err(Strong::create(
                        exec::caught(cx, thrown.into()).to_js(),
                        cx.global(),
                    )),
                },
            );
        let chunk = reading
            .map_err(ReadError::Reason)?
            .await
            .map_err(ReadError::Reason)?;
        if cpp::ReadableStreamReader__isEnd(chunk.get()) {
            return Ok(false);
        }
        let view = Some(chunk.get())
            .filter(|it| it.js_type() == JSType::Uint8Array)
            .ok_or(ReadError::NoBytes)?;
        self.0.enter(|cx| {
            view.as_array_buffer(cx.global())
                .map(|it| bytes.extend_from_slice(it.byte_slice()))
        });
        Ok(true)
    }
}

/// The underlying source of the stream of a body.
pub(crate) struct BodySource {
    incoming: Option<Rc<Incoming>>,
    /// Of the signal.
    algorithm: Cell<Option<u32>>,
}

impl BodySource {
    #[optimize(size)]
    fn follow<'a>(&self, cx: Cx<'_, 'a>, stream: JSValue, signal: JSValue) -> Result<'a> {
        fn abort<'a>(
            cx: Cx<'_, 'a>,
            [stream, signal]: [JsLocal<'a>; 2],
            _: u64,
            _: &[JsLocal<'a>],
        ) -> Result<'a, JSValue> {
            let reason = signal
                .as_abort_signal()
                .map_or(JSValue::UNDEFINED, |it| it.reason(&cx.heap));
            cpp::ReadableStream__error(stream.to_js(), cx.global(), reason)?;
            Ok(JSValue::UNDEFINED)
        }
        let Some(followed) = JsLocal::new(&cx.heap, signal).as_abort_signal() else {
            return Ok(());
        };
        if followed.is_aborted() {
            let reason = followed.reason(&cx.heap);
            return Ok(cpp::ReadableStream__error(stream, cx.global(), reason)?);
        }
        js_BodySource::set_signal(self, signal);
        let algorithm = cx.heap.create_callback(abort, [stream, signal], 0);
        self.algorithm
            .set(Some(followed.add_algorithm(cx, algorithm)));
        Ok(())
    }

    fn stop_following(&self, heap: &JsHeap<'_>) {
        let signal =
            js_BodySource::signal(self).and_then(|it| JsLocal::new(heap, it).as_abort_signal());
        if let Some(it) = signal.zip(self.algorithm.take()) {
            it.0.remove_algorithm(it.1);
        }
    }

    #[optimize(size)]
    pub(crate) fn pull<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        controller: JsLocal<'a>,
    ) -> Result<'a, JSValue> {
        let (this, controller) = (
            Strong::create(self.to_js(), cx.global()),
            Strong::create(controller.to_js(), cx.global()),
        );
        let signal = js_BodySource::signal(self).map(|it| Strong::create(it, cx.global()));
        let (incoming, reader) = (
            self.incoming.clone(),
            js_BodySource::reader(self).map(|it| Reader::new(cx, it)),
        );
        let reading = async move {
            let mut bytes = Vec::new();
            match (incoming, reader) {
                (Some(incoming), _) => incoming
                    .read()
                    .await
                    .map_err(|_| ReadError::Network(signal)),
                (None, Some(reader)) => {
                    while bytes.is_empty() && reader.read_into(&mut bytes).await? {}
                    Ok(Some(Chunk::Owned(bytes)).filter(|it| !it.is_empty()))
                }
                (None, None) => Ok(None),
            }
        };
        Ok(streams::promise_while_running(
            cx,
            reading,
            move |cx, read: core::result::Result<_, ReadError>| {
                if !matches!(read, Ok(Some(_))) {
                    if let Some(it) = BodySource::from_js(&cx.heap, this.get()) {
                        it.stop_following(&cx.heap);
                    }
                }
                match read {
                    Ok(Some(chunk)) => {
                        let chunk = chunk_to_js(&cx.heap, chunk)?.to_js();
                        cpp::ReadableByteStreamController__enqueue(
                            cx.global(),
                            controller.get(),
                            chunk,
                        )?;
                    }
                    Ok(None) => {
                        cpp::ReadableByteStreamController__close(cx.global(), controller.get())?
                    }
                    Err(error) => return Err(error.into_error(cx)),
                }
                Ok(JsLocal::UNDEFINED)
            },
        )
        .to_js())
    }

    pub(crate) fn cancel<'a>(&'a self, cx: Cx<'_, 'a>, reason: JsLocal<'a>) -> Result<'a> {
        self.incoming.iter().for_each(|it| it.cancel());
        self.stop_following(&cx.heap);
        Ok(js_BodySource::reader(self).map_or(Ok(()), |it| {
            cpp::ReadableStreamReader__cancel(cx.global(), it, reason.to_js())
        })?)
    }
}

/// What a request and a response have in common. The stream is only made for who asks for it.
pub(crate) struct Message {
    pub(crate) headers: Rc<Guarded>,
    content: RefCell<Content>,
    is_consumed: Cell<bool>,
}

#[derive(Clone, Copy)]
enum As {
    ArrayBuffer,
    Blob,
    Bytes,
    FormData,
    Json,
    Text,
}

pub(super) fn array_buffer<'a>(heap: &JsHeap<'a>, bytes: Chunk) -> Result<'a, JSValue> {
    Ok(heap
        .create_typed_array_from_box(JSType::ArrayBuffer, bytes.into_vec().into())?
        .to_js())
}

/// <https://infra.spec.whatwg.org/#parse-json-bytes-to-a-javascript-value>
pub(super) fn parse_json<'a>(cx: Cx<'_, 'a>, bytes: &[u8]) -> Result<'a, JSValue> {
    if strings::first_non_ascii(bytes).is_none() {
        return Ok(EncodedSlice::latin1(bytes).to_json_object(cx.global())?);
    }
    Ok(EncodedSlice::utf8(decode_utf8(bytes).as_bytes()).to_json_object(cx.global())?)
}

/// <https://encoding.spec.whatwg.org/#utf-8-decode>
fn decode_utf8(bytes: &[u8]) -> std::borrow::Cow<'_, str> {
    bstr::ByteSlice::to_str_lossy(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes))
}

#[optimize(size)]
fn package<'a>(cx: Cx<'_, 'a>, bytes: Chunk, how: As, mime: Option<Mime>) -> Result<'a, JSValue> {
    Ok(match (how, bytes) {
        (As::ArrayBuffer, bytes) => array_buffer(&cx.heap, bytes)?,
        (As::Blob, bytes) => create_blob(
            cx.global(),
            bytes.into_vec(),
            &mime.map(|it| it.serialize()).unwrap_or_default(),
        ),
        (As::Bytes, bytes) => chunk_to_js(&cx.heap, bytes)?.to_js(),
        (As::FormData, bytes) => form_data::decode(cx, &bytes, mime.as_ref())?,
        (As::Json, bytes) => parse_json(cx, &bytes)?,
        (As::Text, Chunk::Owned(bytes)) if strings::first_non_ascii(&bytes).is_none() => {
            bun_string_jsc::owned_latin1_into_js(cx.global(), bytes)?
        }
        (As::Text, bytes) => cx
            .heap
            .create_utf8_string(decode_utf8(&bytes).as_bytes())?
            .to_js(),
    })
}

impl Message {
    pub(super) fn new(headers: Rc<Guarded>) -> Message {
        Message {
            headers,
            content: RefCell::default(),
            is_consumed: Cell::new(false),
        }
    }

    pub(super) fn set_body(&self, body: Body<'_>) {
        self.content.replace(body.content);
        js_Message::set_stream(self, body.stream.map_or(JSValue::ZERO, JsLocal::to_js));
        js_Message::set_reader(self, body.reader.map_or(JSValue::ZERO, JsLocal::to_js));
    }

    pub(super) fn has_body(&self) -> bool {
        !matches!(*self.content.borrow(), Content::Null)
    }

    pub(super) fn has_source(&self) -> bool {
        matches!(*self.content.borrow(), Content::Null | Content::Data(_))
    }

    fn is_used(&self) -> bool {
        self.is_consumed.get() || js_Message::stream(self).is_some_and(streams::is_disturbed)
    }

    pub(crate) fn is_unusable(&self) -> bool {
        self.is_used() || js_Message::stream(self).is_some_and(streams::is_locked)
    }

    pub(super) fn check_usable<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        if self.is_unusable() {
            Err(type_error(
                heap,
                "The body is locked, or it has already been read.",
            ))
        } else {
            Ok(())
        }
    }

    #[optimize(size)]
    pub(super) fn stream<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Option<JSValue>> {
        if let Some(stream) = js_Message::stream(self) {
            return Ok(Some(stream));
        }
        let global = self.realm(&cx.heap);
        // With room for a byte it hears of an end that nobody reads.
        let (incoming, signal, high_water_mark) = match &*self.content.borrow() {
            Content::Null => return Ok(None),
            Content::Data(data) => (Some(Incoming::new(data.open())), None, 0.0),
            Content::Incoming(incoming) => {
                (Some(Rc::clone(incoming)), js_Message::followed(self), 1.0)
            }
            Content::Stream => (None, None, 0.0),
        };
        let stream = if self.is_consumed.get() {
            streams::used_stream(global_of(global))?
        } else {
            let source = js_BodySource::create(
                global,
                BodySource {
                    incoming,
                    algorithm: Cell::new(None),
                },
            );
            js_BodySource::set_reader(source, js_Message::reader(self).unwrap_or_default());
            let stream = cpp::ReadableStream__createForBytes(
                global_of(global),
                source.to_js(),
                high_water_mark,
            )?;
            signal.map_or(Ok(()), |it| source.follow(cx, stream, it))?;
            stream
        };
        js_Message::set_stream(self, stream);
        Ok(Some(stream))
    }

    /// For who uses it from now on.
    #[optimize(size)]
    pub(crate) fn take_body<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Body<'a>> {
        self.notice_abort(&cx.heap);
        let local = |it| JsLocal::new(&cx.heap, it);
        let mut body = Body {
            content: self.content.borrow().clone(),
            stream: js_Message::stream(self).map(local),
            reader: js_Message::reader(self).map(local),
        };
        if let (Some(reader), false) = (body.reader(cx)?, self.has_source()) {
            body = Body {
                content: Content::Stream,
                stream: None,
                reader: Some(reader),
            };
        } else {
            body.reader = None;
        }
        self.is_consumed.set(self.has_body());
        Ok(body)
    }

    /// <https://fetch.spec.whatwg.org/#concept-body-clone>
    #[optimize(size)]
    pub(super) fn clone_body<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, Body<'a>> {
        self.check_usable(&cx.heap)?;
        if self.has_source() && js_Message::stream(self).is_none() {
            return Ok(self.content.borrow().clone().into());
        }
        let Some(stream) = self.stream(cx)? else {
            return Ok(Body::default());
        };
        let (own, other) = streams::tee(cx.global(), stream)?;
        js_Message::set_stream(self, own);
        let content = if self.has_source() {
            self.content.borrow().clone()
        } else {
            Content::Stream
        };
        Ok(Body {
            content,
            stream: Some(JsLocal::new(&cx.heap, other)),
            reader: None,
        })
    }

    pub(super) fn abort_body(&self) {
        if let Content::Incoming(incoming) = &*self.content.borrow() {
            incoming.cancel();
        }
    }

    /// The signal does not tell those that have arrived.
    #[optimize(size)]
    fn notice_abort(&self, heap: &JsHeap<'_>) -> bool {
        let is_aborted = js_Message::followed(self)
            .and_then(|it| JsLocal::new(heap, it).as_abort_signal())
            .is_some_and(|it| it.is_aborted());
        if is_aborted {
            self.abort_body();
        }
        is_aborted && matches!(*self.content.borrow(), Content::Incoming(_))
    }

    #[optimize(size)]
    pub(super) fn read_all<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
    ) -> Result<'a, impl Future<Output = core::result::Result<Chunk, ReadError>> + use<>> {
        self.check_usable(&cx.heap)?;
        if self.notice_abort(&cx.heap) {
            return Err(failure(cx, js_Message::followed(self)));
        }
        let local = |it| JsLocal::new(&cx.heap, it);
        let mut body = Body {
            content: Content::Null,
            stream: js_Message::stream(self).map(local),
            reader: js_Message::reader(self).map(local),
        };
        let reader = body.reader(cx)?.map(|it| Reader::new(cx, it.to_js()));
        let (content, signal) = (
            self.content.borrow().clone(),
            js_Message::followed(self).map(|it| Strong::create(it, cx.global())),
        );
        self.is_consumed.set(self.has_body());
        Ok(async move {
            match (reader, content) {
                (Some(reader), _) => {
                    let mut bytes = Vec::new();
                    while reader.read_into(&mut bytes).await? {}
                    Ok(Chunk::Owned(bytes))
                }
                (None, Content::Incoming(incoming)) => incoming
                    .read_to_end()
                    .await
                    .map_err(|_| ReadError::Network(signal)),
                (None, Content::Data(data)) => data
                    .open()
                    .read_to_end()
                    .await
                    .map_err(|_| ReadError::Network(signal)),
                (None, Content::Null | Content::Stream) => Ok(Chunk::Owned(Vec::new())),
            }
        })
    }

    #[optimize(size)]
    fn consume<'a>(&'a self, cx: Cx<'_, 'a>, how: As) -> Result<'a, JSValue> {
        if !core::ptr::eq(global_of(self.realm(&cx.heap)), cx.global()) {
            let this = self.to_js();
            let consumed = exec::with_realm(global_of(self.realm(&cx.heap)), |cx| {
                let this = Message::from_js(&cx.heap, this).expect("it is one");
                this.consume(cx, how)
                    .map_err(|it| exec::caught(cx, it).to_js())
            });
            return consumed.map_err(|it| Error::from_value(JsLocal::new(&cx.heap, it)));
        }
        let mime = matches!(how, As::Blob | As::FormData)
            .then(|| self.headers.list().mime())
            .flatten();
        let at_hand = match &*self.content.borrow() {
            Content::Null => Some(Chunk::Owned(Vec::new())),
            Content::Data(Data::Bytes(bytes)) if js_Message::stream(self).is_none() => {
                Some(Chunk::Shared(bytes.clone()))
            }
            _ => None,
        };
        let reading = self.read_all(cx)?;
        if let Some(bytes) = at_hand {
            let value = package(cx, bytes, how, mime)?;
            return Ok(cx.promise_resolve(value)?.to_js());
        }
        let packaging = streams::promise_while_running(cx, reading, move |cx, read| {
            let bytes = read.map_err(|it| it.into_error(cx))?;
            package(cx, bytes, how, mime).map(|it| JsLocal::new(&cx.heap, it))
        });
        Ok(packaging.to_js())
    }
}

macro_rules! consumers {
    ($($name:ident: $how:ident,)*) => {
        $(pub(crate) fn $name<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
            self.consume(cx, As::$how)
        })*
    };
}

impl DomBody {
    consumers! { array_buffer: ArrayBuffer, blob: Blob, bytes: Bytes, form_data: FormData, json: Json, text: Text, }

    pub(crate) fn get_headers<'a>(&self, heap: &JsHeap<'a>) -> &'a Headers {
        js_DomHeaders::create(heap, Headers::sharing(&self.headers))
    }

    pub(crate) fn get_body<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
    ) -> Result<'a, Option<JsLocal<'a, JSObject>>> {
        Ok(self
            .stream(cx)?
            .and_then(|it| JsLocal::new(&cx.heap, it).as_any_object()))
    }

    pub(crate) fn get_body_used(&self, _: &JsHeap<'_>) -> bool {
        self.is_used()
    }

    #[optimize(size)]
    pub(crate) fn text_stream<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JsLocal<'a, JSObject>> {
        self.check_usable(&cx.heap)?;
        let stream = match self.stream(cx)? {
            Some(stream) => streams::decoded_stream(cx.global(), stream)?,
            None => streams::empty_stream(cx.global())?,
        };
        JsLocal::new(&cx.heap, stream)
            .as_any_object()
            .ok_or_else(|| failure(cx, None))
    }
}
