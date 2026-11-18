//! <https://websockets.spec.whatwg.org/>

use bun_jsc::webcore_types::Blob as JsBlob;
use bun_web::client::{Client, SocketRefusal};
use bun_web::convert::blob_from_js;
use bun_web::exec;
use bun_web::headers::is_token;
use bun_web::net::body::Chunk;
use bun_web::net::web_socket::{Closed, Kind, Outbox};
use bun_web::origin::Origin;
use bun_web::runtime::create_blob;

use super::body::{array_buffer, unshared_buffer};
use super::*;
use crate::api::messaging::MessageEvent;

#[repr(C)]
pub(crate) struct CloseEvent {
    pub(crate) base: Event,
    was_clean: bool,
    code: u16,
    reason: DomString,
}

impl CloseEvent {
    pub(crate) fn constructor(name: Atom, init: &DomCloseEventInit<'_>) -> CloseEvent {
        let base = Event::base(
            name,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        CloseEvent {
            base,
            was_clean: init.was_clean,
            code: init.code,
            reason: DomString::from(init.reason),
        }
    }

    pub(crate) fn get_was_clean(&self) -> bool {
        self.was_clean
    }

    pub(crate) fn get_code(&self) -> u16 {
        self.code
    }

    pub(crate) fn get_reason(&self, _: &JsHeap<'_>) -> &DomString {
        &self.reason
    }
}

const CONNECTING: u16 = 0;
const OPEN: u16 = 1;
const CLOSING: u16 = 2;
const CLOSED: u16 = 3;

#[repr(C)]
pub(crate) struct WebSocket {
    pub(crate) base: EventTarget,
    url: Url,
    state: Cell<u16>,
    binary_type: Cell<DomBinaryType>,
    origin: DomString,
    buffered: Cell<u64>,
    /// The subprotocol and the extensions.
    agreed: RefCell<(Bytes, Bytes)>,
    outbox: Outbox,
}

fn syntax_error<'a>(heap: &JsHeap<'a>, message: &str) -> Error<'a> {
    dom_error(heap, DomError::SyntaxError, message)
}

struct Running(Kept);

impl Running {
    fn queue(&self, steps: impl for<'a> FnOnce(Cx<'_, 'a>, &'a WebSocket) + 'static) {
        self.0.queue_task(|cx, this| {
            WebSocket::from_js(&cx.heap, this.to_js()).map_or((), |it| steps(cx, it))
        });
    }

    #[optimize(size)]
    async fn run(
        &self,
        client: &Client,
        url: Option<Url>,
        protocols: &[Bytes],
        outbox: &Outbox,
    ) -> Option<Closed> {
        let exec::Either::First(connected) =
            exec::race(client.connect_web_socket(&url?, protocols), outbox.closed()).await
        else {
            return None;
        };
        let connection = connected.ok()?;
        let agreed = (connection.protocol.clone(), connection.extensions.clone());
        self.queue(|cx, this| this.open(cx, agreed));
        let received = |kind, data| self.queue(move |cx, this| this.receive(cx, kind, data));
        let sent = |length| self.queue(move |_, this| this.buffered.update(|it| it - length));
        let closing = || self.queue(|_, this| this.state.set(CLOSING));
        connection.run(outbox, received, sent, closing).await
    }
}

impl WebSocket {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        url: &DomString,
        protocols: Protocols<'a>,
    ) -> Result<'a, &'a Self> {
        let heap = &cx.heap;
        let protocols: Vec<Bytes> = match protocols {
            Protocols::One(one) => vec![(*one).into()],
            Protocols::List(list) => list
                .iter()
                .map(|it| {
                    Ok(DomString::from_js_string(heap, it)?
                        .to_utf8()
                        .as_bytes()
                        .into())
                })
                .collect::<Result<'a, _>>()?,
        };
        let parsed = parse_url(heap, url).ok_or_else(|| {
            heap.dom_exception(
                DomError::SyntaxError,
                format_args!("The URL '{}' is invalid.", url.to_utf8()),
            )
        })?;
        let url = match parsed.scheme() {
            b"http" => parsed.with_scheme(b"ws"),
            b"https" => parsed.with_scheme(b"wss"),
            b"ws" | b"wss" => parsed,
            _ => {
                return Err(syntax_error(
                    heap,
                    "The URL's scheme must be either 'http', 'https', 'ws', or 'wss'.",
                ));
            }
        };
        if url.fragment().is_some() {
            return Err(syntax_error(
                heap,
                "The URL of a WebSocket cannot have a fragment.",
            ));
        }
        let is_distinct = |(at, it): (usize, &Bytes)| {
            is_token(it)
                && !protocols[..at]
                    .iter()
                    .any(|other| other.eq_ignore_ascii_case(it))
        };
        if !protocols.iter().enumerate().all(is_distinct) {
            return Err(syntax_error(
                heap,
                "The subprotocols have to be distinct tokens.",
            ));
        }
        let client = client_of(heap);
        let allowed = match client.as_ref().map(|it| it.check_web_socket(url.clone())) {
            Some(Err(SocketRefusal::MixedContent)) => {
                return Err(dom_error(
                    heap,
                    DomError::SecurityError,
                    "An insecure WebSocket may not be opened from a page loaded over HTTPS.",
                ));
            }
            checked => checked.and_then(|it| it.ok()),
        };
        let (state, outbox) = (
            Cell::new(if allowed.is_some() || client.is_none() {
                CONNECTING
            } else {
                CLOSED
            }),
            Outbox::default(),
        );
        let (url, binary_type) = (
            allowed.clone().unwrap_or(url),
            Cell::new(DomBinaryType::Blob),
        );
        let origin = DomString::from_latin1(Origin::of(&url).as_bytes());
        let this = structure.create(
            heap,
            WebSocket {
                base: Default::default(),
                url,
                origin,
                state,
                binary_type,
                buffered: Cell::default(),
                agreed: RefCell::default(),
                outbox: outbox.clone(),
            },
        );
        if let Some(client) = client {
            let running = Running(Kept::new(cx, this.to_js()));
            spawn(&cx.heap, async move {
                let closed = running.run(&client, allowed, &protocols, &outbox).await;
                running.queue(|cx, this| this.end(cx, closed));
            });
        }
        Ok(this)
    }

    fn open<'a>(&'a self, cx: Cx<'_, 'a>, agreed: (Bytes, Bytes)) {
        if self.state.get() == CONNECTING {
            self.agreed.replace(agreed);
            self.state.set(OPEN);
            fire(cx, self, atom!("open"), EventInit::default());
        }
    }

    #[optimize(size)]
    fn receive<'a>(&'a self, cx: Cx<'_, 'a>, kind: Kind, data: Vec<u8>) {
        if self.state.get() != OPEN {
            return;
        }
        let data = match (kind, self.binary_type.get()) {
            (Kind::Text, _) => {
                bun_jsc::bun_string_jsc::owned_utf8_into_js(cx.global(), data).map_err(Into::into)
            }
            (Kind::Binary, DomBinaryType::Blob) => Ok(create_blob(cx.global(), data, b"")),
            (Kind::Binary, DomBinaryType::ArrayBuffer) => {
                array_buffer(&cx.heap, Chunk::Owned(data))
            }
        };
        let received = data.map(|it| {
            _ = dispatch(
                cx,
                self,
                MessageEvent::new(
                    &cx.heap,
                    atom!("message").into(),
                    it,
                    self.origin.clone(),
                    DomString::default(),
                ),
            )
        });
        exec::report(cx, received);
    }

    /// `None` if it was not closed cleanly.
    #[optimize(size)]
    fn end<'a>(&'a self, cx: Cx<'_, 'a>, closed: Option<Closed>) {
        self.state.set(CLOSED);
        if closed.is_none() {
            fire(cx, self, atom!("error"), EventInit::default());
        }
        let base = Event::base(atom!("close"), EventInit::default(), Trusted::Yes);
        let (was_clean, Closed { code, reason }) = (
            closed.is_some(),
            closed.unwrap_or(Closed {
                code: 1006,
                reason: Vec::new(),
            }),
        );
        let reason = DomString::from_utf8(&bstr::ByteSlice::to_str_lossy(&*reason));
        dispatch(
            cx,
            self,
            js_DomCloseEvent::create(
                &cx.heap,
                CloseEvent {
                    base,
                    was_clean,
                    code,
                    reason,
                },
            ),
        );
    }

    pub(crate) fn get_url<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(self.url.href())
    }

    pub(crate) fn get_ready_state(&self) -> u16 {
        self.state.get()
    }

    pub(crate) fn get_buffered_amount(&self) -> f64 {
        self.buffered.get() as f64
    }

    pub(crate) fn get_protocol<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(&self.agreed.borrow().0)
    }

    pub(crate) fn get_extensions<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(&self.agreed.borrow().1)
    }

    pub(crate) fn get_binary_type(&self) -> DomBinaryType {
        self.binary_type.get()
    }

    pub(crate) fn set_binary_type(&self, value: DomBinaryType) {
        self.binary_type.set(value);
    }

    #[optimize(size)]
    pub(crate) fn close<'a>(
        &self,
        heap: &JsHeap<'a>,
        code: Option<u16>,
        reason: Option<&[u8]>,
    ) -> Result<'a> {
        if !matches!(code, None | Some(1000 | 3000..=4999)) {
            return Err(dom_error(
                heap,
                DomError::InvalidAccessError,
                "The close code must be either 1000, or between 3000 and 4999.",
            ));
        }
        if reason.is_some_and(|it| it.len() > 123) {
            return Err(syntax_error(
                heap,
                "The close reason must not be greater than 123 UTF-8 bytes.",
            ));
        }
        if self.state.get() < CLOSING {
            self.state.set(CLOSING);
            self.outbox.close(
                code.or_else(|| reason.map(|_| 1000)),
                reason.unwrap_or_default(),
            );
        }
        Ok(())
    }

    fn send_by<'a>(
        &self,
        heap: &JsHeap<'a>,
        length: u64,
        send: impl FnOnce(&Outbox),
    ) -> Result<'a> {
        if self.state.get() == CONNECTING {
            return Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "Still in CONNECTING state.",
            ));
        }
        self.buffered.update(|it| it + length);
        if self.state.get() == OPEN {
            send(&self.outbox);
        }
        Ok(())
    }

    #[optimize(size)]
    pub(crate) fn send<'a>(&self, cx: Cx<'_, 'a>, data: JsLocal<'a>) -> Result<'a> {
        if let Some(blob) = data.to_js().as_class_ref::<JsBlob>() {
            let data = blob_from_js(&blob)
                .ok_or_else(|| type_error(&cx.heap, "The blob cannot be read."))?
                .data;
            self.send_by(&cx.heap, data.len(), |it| it.send(Kind::Binary, data))
        } else if let Some(buffer) = unshared_buffer(cx, data)? {
            self.send_by(&cx.heap, buffer.byte_slice().len() as u64, |it| {
                it.send_bytes(Kind::Binary, buffer.byte_slice())
            })
        } else {
            let text = DomString::from_js(cx, data)?;
            let text = text.to_utf8();
            self.send_by(&cx.heap, text.len() as u64, |it| {
                it.send_bytes(Kind::Text, text.as_bytes())
            })
        }
    }
}
