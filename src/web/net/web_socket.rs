//! https://www.rfc-editor.org/rfc/rfc6455

use core::cell::RefCell;
use core::future::poll_fn;
use core::task::Poll;
use core::time::Duration;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::Arc;

use bun_core::strings;
use bun_http::websocket::{Opcode, is_valid_close_code};
use bun_http_jsc::websocket_client::websocket_deflate::{Params, PerMessageDeflate};
use bun_sha_hmac::sha::evp::SHA1;
use bun_threading::Guarded;
use bun_ui::BoxedLocal as _;

use super::body::{Body, Chunk, Data, Writer, prefault};
use super::error::{NetError, Result};
use super::response::Response;
use crate::Bytes;
use crate::exec::{self, Either, Waiter};
use crate::headers::{digits, split};
use crate::request::{CacheMode, Credentials, Destination, Mode, Redirect, Request, RequestBody};
use crate::url::Url;

const MAX_MESSAGE: usize = 1 << 30;
const WORTH_COMPRESSING: usize = 860;
const GOING_AWAY: u16 = 1001;
const PROTOCOL_ERROR: u16 = 1002;
const NO_STATUS: u16 = 1005;
const INVALID_DATA: u16 = 1007;
const TOO_BIG: u16 = 1009;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Text,
    Binary,
}

impl Kind {
    fn opcode(self) -> Opcode {
        match self {
            Kind::Text => Opcode::Text,
            Kind::Binary => Opcode::Binary,
        }
    }
}

pub struct Closed {
    pub code: u16,
    pub reason: Vec<u8>,
}

enum Queued {
    Message(Kind, Data),
    /// And the length of their payloads.
    Frames(Vec<u8>, u64),
    Close(Vec<u8>),
}

#[derive(Default)]
struct Pending {
    queue: VecDeque<Queued>,
    is_compressed: bool,
    sender: Waiter,
}

/// What is to be sent, in order.
#[derive(Clone, Default)]
pub struct Outbox(Rc<RefCell<Pending>>);

impl Outbox {
    fn push(&self, queued: Queued) {
        let mut outbox = self.0.borrow_mut();
        outbox.queue.push_back(queued);
        outbox.sender.wake();
    }

    pub fn send(&self, kind: Kind, data: Data) {
        self.push(Queued::Message(kind, data));
    }

    pub fn send_bytes(&self, kind: Kind, payload: &[u8]) {
        const AT_ONCE: usize = 256 << 10;
        let mut outbox = self.0.borrow_mut();
        let compresses = outbox.is_compressed && payload.len() >= WORTH_COMPRESSING;
        match outbox.queue.back_mut() {
            Some(Queued::Frames(frames, length))
                if !compresses && frames.len() + payload.len() <= AT_ONCE =>
            {
                append_frame(frames, kind.opcode(), false, payload);
                *length += payload.len() as u64;
            }
            _ => {
                drop(outbox);
                self.push(match compresses {
                    true => Queued::Message(kind, Data::Bytes(payload.to_vec().into())),
                    false => {
                        Queued::Frames(frame(kind.opcode(), false, payload), payload.len() as u64)
                    }
                });
            }
        }
    }

    pub fn close(&self, code: Option<u16>, reason: &[u8]) {
        self.push(Queued::Close(
            code.map(|it| [&it.to_be_bytes(), reason].concat())
                .unwrap_or_default(),
        ));
    }

    async fn next(&self) -> Queued {
        poll_fn(|cx| {
            let mut outbox = self.0.borrow_mut();
            outbox
                .queue
                .pop_front()
                .map_or_else(|| outbox.sender.pending(cx), Poll::Ready)
        })
        .await
    }

    /// While there is no connection yet.
    pub async fn closed(&self) {
        while !matches!(self.next().await, Queued::Close(_)) {}
    }
}

pub struct Handshake {
    key: Vec<u8>,
}

crate::wire! {
    pub struct Accepted {
        protocol: Bytes,
        extensions: Option<Bytes>,
        downlink: Body,
    }
}

impl Handshake {
    /// https://websockets.spec.whatwg.org/#concept-websocket-establish
    pub fn start(url: &Url, protocols: &[Bytes], frames: Body) -> (Handshake, Request) {
        let url = url.with_scheme(if url.scheme() == b"ws" {
            b"http"
        } else {
            b"https"
        });
        let mut request = Request::new(
            url,
            Destination::Empty,
            Mode::WebSocket,
            Credentials::Include,
        );
        let headers = &mut request.headers;
        let mut nonce = [0; 16];
        bun_boringssl_sys::rand_bytes(&mut nonce);
        let key = bun_base64::encode_alloc(&nonce);
        for (name, value) in [
            ("Connection", "Upgrade"),
            ("Pragma", "no-cache"),
            ("Cache-Control", "no-cache"),
            ("Upgrade", "websocket"),
            ("Sec-WebSocket-Version", "13"),
        ] {
            headers.set(name.as_bytes(), value.as_bytes());
        }
        headers.set(b"Sec-WebSocket-Key", &key);
        headers.set(
            b"Sec-WebSocket-Extensions",
            b"permessage-deflate; client_max_window_bits",
        );
        headers.set_if_absent(b"Sec-WebSocket-Protocol", &protocols.join(&b", "[..]));
        (request.cache, request.redirect) = (CacheMode::NoStore, Redirect::Error);
        request.body = Some(RequestBody::Upgrade(Arc::new(Guarded::new(Some(frames)))));
        (Handshake { key }, request)
    }

    pub fn finish(
        self,
        Response { head, body }: Response,
        protocols: &[Bytes],
    ) -> Result<Accepted> {
        let (headers, mut hash) = (&head.headers, [0; 20]);
        SHA1::hash(
            &[&self.key, &b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"[..]].concat(),
            &mut hash,
        );
        let (protocol, extensions) = (
            headers.get(b"sec-websocket-protocol"),
            headers.get(b"sec-websocket-extensions"),
        );
        let is_accepted = head.status == 101
            && headers
                .get_or_empty(b"upgrade")
                .eq_ignore_ascii_case(b"websocket")
            && split(&headers.get_or_empty(b"connection"), b',')
                .any(|it| it.eq_ignore_ascii_case(b"upgrade"))
            && *headers.get_or_empty(b"sec-websocket-accept") == *bun_base64::encode_alloc(&hash)
            && protocol.as_ref().map_or(protocols.is_empty(), |chosen| {
                protocols.iter().any(|it| **it == **chosen)
            });
        Ok(Accepted {
            protocol: protocol.unwrap_or_default().into(),
            extensions: extensions.map(Into::into),
            downlink: body.filter(|_| is_accepted).ok_or(NetError::Failed)?,
        })
    }
}

impl Accepted {
    /// `uplink` writes the frames that the handshake was started with.
    pub fn connect(self, uplink: Writer) -> Result<Connection> {
        let deflate = (self.extensions.as_deref())
            .map(|it| parse_deflate(it).ok_or(NetError::Failed))
            .transpose()?;
        Ok(Connection {
            protocol: self.protocol,
            extensions: self.extensions.unwrap_or_default(),
            deflate: deflate.map(|it| PerMessageDeflate::init(it, false).into()),
            downlink: self.downlink.into(),
            uplink: Some(uplink),
        })
    }
}

/// https://www.rfc-editor.org/rfc/rfc7692#section-7.1
fn parse_deflate(extensions: &[u8]) -> Option<Params> {
    let (mut parts, mut parameters, mut seen) =
        (split(extensions, b';'), Params::default(), Vec::new());
    (parts.next()? == b"permessage-deflate").then_some(())?;
    for part in parts {
        let (name, value) = strings::split_once_char(part, b'=').map_or((part, None), |it| {
            (it.0.trim_ascii(), Some(strings::trim(it.1, b" \t\"")))
        });
        let bits = || {
            value
                .filter(|it| !it.starts_with(b"0"))
                .and_then(digits)
                .filter(|it| matches!(it, 8..=15))
                .map(|it| it as u8)
        };
        match (name, value) {
            _ if seen.contains(&name) => return None,
            (b"server_no_context_takeover", None) => parameters.server_no_context_takeover = 1,
            (b"client_no_context_takeover", None) => parameters.client_no_context_takeover = 1,
            (b"server_max_window_bits", _) => parameters.server_max_window_bits = bits()?,
            (b"client_max_window_bits", _) => parameters.client_max_window_bits = bits()?,
            _ => return None,
        }
        seen.push(name);
    }
    Some(parameters)
}

pub struct Connection {
    pub protocol: Bytes,
    pub extensions: Bytes,
    deflate: Option<RefCell<Box<PerMessageDeflate>>>,
    /// Until nothing more may be sent.
    uplink: Option<Writer>,
    downlink: RefCell<Body>,
}

fn next_mask() -> [u8; 4] {
    thread_local! {
        static MASKS: Box<RefCell<Vec<[u8; 4]>>> = Box::default();
    }
    MASKS.with_borrow_mut(|masks| {
        if masks.is_empty() {
            masks.resize(64, [0; 4]);
            bun_boringssl_sys::rand_bytes(masks.as_flattened_mut());
        }
        masks.pop().unwrap_or_default()
    })
}

fn append_frame(out: &mut Vec<u8>, opcode: Opcode, is_compressed: bool, payload: &[u8]) {
    let mask = next_mask();
    out.push(0x80 | u8::from(is_compressed) << 6 | opcode as u8);
    match payload.len() {
        length @ ..=125 => out.push(0x80 | length as u8),
        length @ ..=0xffff => out.extend([0xfe].into_iter().chain((length as u16).to_be_bytes())),
        length => out.extend([0xff].into_iter().chain((length as u64).to_be_bytes())),
    }
    out.extend(mask);
    // SAFETY: that many bytes are written, and none is read.
    unsafe {
        bun_core::vec::fill_spare(out, payload.len(), |room| {
            bun_highway::fill_with_skip_mask(mask, room, payload, false);
            (payload.len(), ())
        });
    }
}

fn frame(opcode: Opcode, is_compressed: bool, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 14);
    prefault(out.spare_capacity_mut());
    append_frame(&mut out, opcode, is_compressed, payload);
    out
}

fn write_frame(uplink: &Writer, opcode: Opcode, is_compressed: bool, payload: &[u8]) {
    uplink.write(Chunk::Owned(frame(opcode, is_compressed, payload)));
}

struct Frame<'a> {
    is_final: bool,
    is_compressed: bool,
    opcode: Opcode,
    payload: &'a [u8],
}

/// And what follows it. The error is the code to close with.
fn parse_frame(bytes: &[u8]) -> core::result::Result<Option<(Frame<'_>, &[u8])>, u16> {
    let Some((&[first, second], rest)) = bytes.split_first_chunk() else {
        return Ok(None);
    };
    let (opcode, is_final) = (Opcode::from_raw(first & 15), first & 0x80 != 0);
    if first & 0x30 != 0
        || second & 0x80 != 0
        || (opcode.is_control() && (!is_final || second > 125))
    {
        return Err(PROTOCOL_ERROR);
    }
    let length = match second {
        126 => rest
            .split_first_chunk()
            .map(|it| (u16::from_be_bytes(*it.0).into(), it.1)),
        127 => rest
            .split_first_chunk()
            .map(|it| (u64::from_be_bytes(*it.0), it.1)),
        length => Some((length.into(), rest)),
    };
    let Some((length, rest)) = length else {
        return Ok(None);
    };
    if length > MAX_MESSAGE as u64 {
        return Err(TOO_BIG);
    }
    Ok(rest
        .split_at_checked(length as usize)
        .map(|(payload, rest)| {
            (
                Frame {
                    is_final,
                    is_compressed: first & 0x40 != 0,
                    opcode,
                    payload,
                },
                rest,
            )
        }))
}

fn parse_close(payload: &[u8]) -> core::result::Result<Closed, u16> {
    match payload
        .split_first_chunk()
        .map(|it| (u16::from_be_bytes(*it.0), it.1))
    {
        None if payload.is_empty() => Ok(Closed {
            code: NO_STATUS,
            reason: Vec::new(),
        }),
        Some((code, reason)) if is_valid_close_code(code) => {
            if strings::is_valid_utf8(reason) {
                Ok(Closed {
                    code,
                    reason: reason.to_vec(),
                })
            } else {
                Err(INVALID_DATA)
            }
        }
        _ => Err(PROTOCOL_ERROR),
    }
}

impl Connection {
    /// The error is the code to close with, if there is still someone to tell.
    async fn receive(
        &self,
        uplink: &Writer,
        received: impl Fn(Kind, Vec<u8>),
    ) -> core::result::Result<Closed, Option<u16>> {
        let (mut downlink, mut buffered) = (self.downlink.take(), Vec::new());
        let mut message: Option<(Kind, bool, Vec<u8>)> = None;
        let result = 'read: loop {
            let Ok(Some(chunk)) = downlink.read().await else {
                break Err(None);
            };
            if buffered.is_empty() {
                buffered = chunk.into_vec();
            } else {
                buffered.extend_from_slice(&chunk);
            }
            let mut rest = &buffered[..];
            loop {
                let (frame, after) = match parse_frame(rest) {
                    Ok(Some(parsed)) => parsed,
                    Ok(None) => break,
                    Err(code) => break 'read Err(Some(code)),
                };
                rest = after;
                let may_be_compressed =
                    self.deflate.is_some() && matches!(frame.opcode, Opcode::Text | Opcode::Binary);
                match (frame.opcode, &mut message) {
                    _ if frame.is_compressed && !may_be_compressed => {
                        break 'read Err(Some(PROTOCOL_ERROR));
                    }
                    (Opcode::Close, _) => break 'read parse_close(frame.payload).map_err(Some),
                    (Opcode::Ping, _) => write_frame(uplink, Opcode::Pong, false, frame.payload),
                    (Opcode::Pong, _) => {}
                    (Opcode::Text, None) => {
                        message = Some((Kind::Text, frame.is_compressed, frame.payload.to_vec()))
                    }
                    (Opcode::Binary, None) => {
                        message = Some((Kind::Binary, frame.is_compressed, frame.payload.to_vec()))
                    }
                    (Opcode::Continue, Some((.., data)))
                        if data.len() + frame.payload.len() <= MAX_MESSAGE =>
                    {
                        data.extend_from_slice(frame.payload)
                    }
                    _ => break 'read Err(Some(PROTOCOL_ERROR)),
                }
                let Some((kind, is_compressed, mut data)) =
                    message.take_if(|_| frame.is_final && !frame.opcode.is_control())
                else {
                    continue;
                };
                if let Some(deflate) = self.deflate.as_ref().filter(|_| is_compressed) {
                    let compressed = core::mem::take(&mut data);
                    if deflate
                        .borrow_mut()
                        .decompress(&compressed, &mut data, MAX_MESSAGE)
                        .is_err()
                    {
                        break 'read Err(Some(PROTOCOL_ERROR));
                    }
                    data.shrink_to_fit();
                }
                if kind == Kind::Text && !strings::is_valid_utf8(&data) {
                    break 'read Err(Some(INVALID_DATA));
                }
                received(kind, data);
            }
            let read = buffered.len() - rest.len();
            buffered.drain(..read);
        };
        self.downlink.replace(downlink);
        result
    }

    /// Until the frame that closes is sent.
    async fn send(&self, uplink: &Writer, outbox: &Outbox, sent: impl Fn(u64)) -> Result<()> {
        outbox.0.borrow_mut().is_compressed = self.deflate.is_some();
        loop {
            // What is queued meanwhile goes out together.
            uplink
                .ready()
                .await
                .then_some(())
                .ok_or(NetError::ConnectionClosed)?;
            let (kind, data) = match outbox.next().await {
                Queued::Message(kind, data) => (kind, data),
                Queued::Frames(frames, length) => {
                    uplink.write(Chunk::Owned(frames));
                    sent(length);
                    continue;
                }
                Queued::Close(payload) => {
                    write_frame(uplink, Opcode::Close, false, &payload);
                    return Ok(());
                }
            };
            let (opcode, bytes) = (kind.opcode(), data.open().read_to_end().await?);
            if let Some(deflate) = self
                .deflate
                .as_ref()
                .filter(|_| bytes.len() >= WORTH_COMPRESSING)
            {
                let mut compressed = Vec::new();
                deflate
                    .borrow_mut()
                    .compress(&bytes, &mut compressed)
                    .map_err(|_| NetError::Failed)?;
                write_frame(uplink, opcode, true, &compressed);
            } else {
                write_frame(uplink, opcode, false, &bytes);
            }
            sent(data.len());
        }
    }

    /// `None` unless it is closed cleanly.
    pub async fn run(
        mut self,
        outbox: &Outbox,
        received: impl Fn(Kind, Vec<u8>),
        sent: impl Fn(u64),
        closing: impl FnOnce(),
    ) -> Option<Closed> {
        const CLOSING_HANDSHAKE: Duration = Duration::from_secs(20);
        let (uplink, mut has_sent_close) = (self.uplink.as_ref()?, false);
        let sending = async {
            if self.send(uplink, outbox, sent).await.is_ok() {
                has_sent_close = true;
                exec::sleep(CLOSING_HANDSHAKE).await;
            }
        };
        let outcome = exec::race(self.receive(uplink, received), sending).await;
        let (reply, closed) = match outcome {
            Either::First(Ok(closed)) => (Some(closed.code), Some(closed)),
            Either::First(Err(code)) => (code, None),
            Either::Second(()) => (None, None),
        };
        if let Some(code) = reply.filter(|_| !has_sent_close) {
            closing();
            write_frame(
                uplink,
                Opcode::Close,
                false,
                &code.to_be_bytes()[..if code == NO_STATUS { 0 } else { 2 }],
            );
        }
        let (uplink, downlink) = (self.uplink.take(), self.downlink.take());
        if reply.is_some() {
            linger(uplink, downlink).await;
        }
        closed
    }
}

/// It is for the server to close the connection.
async fn linger(_uplink: Option<Writer>, mut downlink: Body) {
    let discarding = async { while let Ok(Some(_)) = downlink.read().await {} };
    exec::race(discarding, exec::sleep(Duration::from_secs(2))).await;
}

impl Drop for Connection {
    fn drop(&mut self) {
        if let Some(uplink) = self.uplink.take() {
            write_frame(&uplink, Opcode::Close, false, &GOING_AWAY.to_be_bytes());
            exec::spawn_background(linger(Some(uplink), self.downlink.take()));
        }
    }
}
