//! One exchange with a server, on the HTTP thread.

use core::future::poll_fn;
use core::sync::atomic::{AtomicBool, Ordering};
use core::task::{Context, Poll};
use std::io::Write as _;
use std::sync::Arc;

use bun_boringssl_sys::SSL;
use bun_core::strings;
use bun_http::browser::{Browser, Negotiation};
use bun_http::http_request_body::{Stream, StreamFraming};
use bun_http::http_thread::WriteMessageType;
use bun_http::ssl_config::SharedPtr as Tls;
use bun_http::{
    AsyncHTTP, CertificateInfo, FetchRedirect, FinishedRequest, HTTPClientResult,
    HTTPClientResultCallback, HTTPRequestBody, HTTPThread, Headers, Method, PoolOptions,
    ThreadSafeStreamBuffer, async_http, signals,
};
use bun_ptr::RefPtr;
use bun_threading::Guarded;

use super::body::{Body, Budget, Chunk, Data, Read, Share, SharedBytes, Source};
use super::chain;
use super::error::{NetError, Result};
use super::response::{Answer, Protocol};
use super::tls::Handshake;
use super::tunnel::Tunnel;
use crate::Bytes;
use crate::exec::{self, LocalFuture, Waiter};
use crate::headers::{HeaderList, is_token};
use crate::request::RequestBody;
use crate::url::Url;

const UPLOADED_PART: u64 = 64 << 10;

/// How much of a body has been sent.
#[derive(Clone, Default)]
pub struct Progress(Arc<Guarded<(Option<u64>, Waiter)>>);

impl Progress {
    fn report(&self, sent: u64) {
        let mut progress = self.0.lock();
        progress.0 = Some(sent);
        progress.1.wake();
    }

    pub async fn changed(&self) -> u64 {
        poll_fn(|cx| {
            let mut progress = self.0.lock();
            progress
                .0
                .take()
                .map_or_else(|| progress.1.pending(cx), Poll::Ready)
        })
        .await
    }
}

pub(super) struct Connection<'a> {
    /// The address, and the headers for it.
    pub proxy: Option<(Bytes, HeaderList)>,
    pub tunnel: Option<Arc<Guarded<Tunnel>>>,
    pub handshake: Option<Arc<Handshake>>,
    pub tls: Option<Tls>,
    pub pool: PoolOptions,
    pub ignores_certificate_errors: bool,
    /// Has the last word about the certificate.
    pub verify: Option<&'a dyn Fn(CertificateInfo) -> LocalFuture<'a, Result<()>>>,
    pub started: &'a dyn Fn(&Arc<Exchange>),
}

impl Connection<'_> {
    /// For what no session asks for.
    pub(super) fn direct() -> Self {
        Connection {
            proxy: None,
            tunnel: None,
            handshake: None,
            tls: None,
            pool: PoolOptions::default(),
            ignores_certificate_errors: false,
            verify: None,
            started: &|_| {},
        }
    }
}

#[derive(Default)]
struct State {
    id: u32,
    head: Option<Answer>,
    certificate: Option<CertificateInfo>,
    received: Vec<u8>,
    share: Option<Share>,
    end: Option<Result<()>>,
    is_http2: bool,
    can_upload: bool,
    receiver: Waiter,
    uploader: Waiter,
}

/// Has nothing of a VM, so it may outlive the thread that made it.
pub(super) struct Exchange {
    signals: signals::Store,
    url: Bytes,
    proxy: Bytes,
    method: Bytes,
    header_bytes: Vec<u8>,
    body: Option<SharedBytes>,
    tunnel: Option<Arc<Guarded<Tunnel>>>,
    handshake: Option<Arc<Handshake>>,
    has_approved_certificate: AtomicBool,
    state: Guarded<State>,
}

pub(super) fn error_of(error: bun_http::Error, connect_errno: i32) -> NetError {
    use bun_http::Error::*;
    match error {
        Aborted | AbortedBeforeConnecting => NetError::Aborted,
        ConnectionRefused | FailedToOpenSocket => {
            match bun_errno::SystemErrno::init(i64::from(connect_errno)).map(NetError::of_errno) {
                Some(NetError::Failed) | None => NetError::ConnectionRefused,
                Some(known) => known,
            }
        }
        ConnectionClosed => NetError::ConnectionClosed,
        DNSResolveFailed | DNSResolutionFailed => NetError::NameNotResolved,
        Timeout => NetError::TimedOut,
        InvalidURL => NetError::InvalidUrl,
        ERR_TLS_CERT_ALTNAME_INVALID => NetError::CertCommonNameInvalid,
        Cert(error) => NetError::of_certificate(<&str>::from(error).as_bytes()),
        TLSHandshakeFailed => NetError::SslProtocolError,
        ProxyConnectFailed => NetError::TunnelConnectionFailed,
        InvalidHTTPResponse | MalformedHTTPResponse | UnexpectedData => {
            NetError::InvalidHttpResponse
        }
        InvalidContentLength => NetError::ResponseHeadersMultipleContentLength,
        HTTP2ContentLengthMismatch => NetError::ContentLengthMismatch,
        HTTP2ProtocolError
        | HTTP2FrameSizeError
        | HTTP2FlowControlError
        | HTTP2CompressionError
        | HTTP2StreamReset => NetError::Http2ProtocolError,
        Zlib(_) | Brotli(_) | Zstd(_) => NetError::ContentDecodingFailed,
        Sys(errno) => NetError::of_errno(errno),
        _ => NetError::Failed,
    }
}

impl Browser for Exchange {
    fn method(&self) -> &[u8] {
        &self.method
    }

    fn configure_tls(&self, ssl: &mut SSL, is_for_proxy: bool) {
        chain::refuse_distrusted(ssl);
        if let Some(handshake) = self.handshake.as_ref().filter(|_| !is_for_proxy) {
            handshake.install(ssl);
        }
    }

    fn tunnels(&self) -> bool {
        self.tunnel.is_some()
    }

    fn negotiate(&self, received: Option<&[u8]>) -> Negotiation {
        self.tunnel
            .as_ref()
            .map_or(Negotiation::Failed, |it| it.lock().negotiate(received))
    }

    fn take_approval_of_certificate(&self) -> bool {
        self.has_approved_certificate.swap(false, Ordering::Acquire)
    }

    fn informed(&self, _: &bun_http::Response) {}
}

impl Exchange {
    fn on_result(
        this: *mut Exchange,
        finished: Option<FinishedRequest>,
        mut result: HTTPClientResult<'_>,
    ) {
        drop(finished);
        // SAFETY: the reference that `send` has given to the HTTP thread, which is released below.
        let exchange = unsafe { &*this };
        let mut state = exchange.state.lock();
        if let Some(head) = result.metadata.take() {
            let headers = head
                .headers()
                .iter()
                .map(|it| (it.name(), it.value()))
                .collect();
            state.head = Some(Answer::new(
                head.status_code() as u16,
                head.status_text(),
                headers,
                Body::default(),
            ));
        }
        state.certificate = result
            .certificate_info
            .take()
            .or_else(|| state.certificate.take());
        state.is_http2 |= result.is_http2;
        state.can_upload |= result.can_stream;
        if state.end.is_none() {
            match result.fail {
                Some(error) => state.end = Some(Err(error_of(error, result.connect_errno))),
                None => {
                    let before = state.received.len();
                    result.body_into(&mut state.received);
                    let more = state.received.len() - before;
                    if let Some(Err(error)) = state.share.as_mut().map(|it| it.grow(more)) {
                        state.received = Vec::new();
                        exchange.end(&mut state, error);
                    }
                }
            }
        }
        if !result.has_more {
            state.end.get_or_insert(Ok(()));
        } else if state.received.len() >= signals::BODY_HIGH_WATER_MARK {
            exchange.signals.pause_receive();
        }
        state.receiver.wake();
        state.uploader.wake();
        drop(state);
        if !result.has_more {
            // SAFETY: there is no result after this one.
            drop(unsafe { Arc::from_raw(this) });
        }
    }

    unsafe fn on_shutdown(this: *mut ()) {
        // SAFETY: in place of the last result.
        let exchange = unsafe { Arc::from_raw(this.cast::<Exchange>()) };
        exchange
            .state
            .lock()
            .end
            .get_or_insert(Err(NetError::Aborted));
    }

    fn on_drain(this: *mut Exchange) {
        // SAFETY: only called while the request is in flight.
        unsafe { &*this }.state.lock().uploader.wake();
    }

    pub(super) fn is_for_loopback(&self) -> bool {
        Url::parse(&self.url).is_some_and(|it| it.is_loopback())
    }

    pub(super) fn abort(&self, reason: NetError) {
        let mut state = self.state.lock();
        if state.end.is_none() {
            self.end(&mut state, reason);
        }
    }

    fn end(&self, state: &mut State, reason: NetError) {
        state.end = Some(Err(reason));
        self.signals.aborted.store(true, Ordering::Relaxed);
        HTTPThread::schedule_shutdown(state.id);
        state.receiver.wake();
        state.uploader.wake();
    }
}

struct Download(Arc<Exchange>);

impl Source for Download {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        let mut state = self.0.state.lock();
        if !state.received.is_empty() {
            if self.0.signals.unpause_receive() {
                HTTPThread::schedule_receive_resume(state.id);
            }
            return Poll::Ready(Ok(Some(Chunk::Owned(core::mem::take(&mut state.received)))));
        }
        match state.end {
            Some(end) => Poll::Ready(end.map(|()| None)),
            None => state.receiver.pending(cx),
        }
    }

    fn expect_read_to_end(&mut self, budget: &'static Budget) {
        self.0.state.lock().share = Some(Share::of(budget));
        if self.0.signals.receive_all() {
            HTTPThread::schedule_receive_resume(self.0.state.lock().id);
        }
    }
}

impl Drop for Download {
    fn drop(&mut self) {
        self.0.signals.abandon();
        self.0.state.lock().share = None;
        self.0.abort(NetError::Aborted);
    }
}

struct Upload {
    exchange: Arc<Exchange>,
    buffer: RefPtr<ThreadSafeStreamBuffer>,
    length: Option<u64>,
    is_upgraded: bool,
}

impl Upload {
    /// `None` if the exchange is over.
    async fn drained(&self) -> Option<()> {
        poll_fn(|cx| {
            // In the order in which the HTTP thread takes them.
            let buffer = self.buffer.lock();
            let mut state = self.exchange.state.lock();
            match state.end {
                Some(_) => Poll::Ready(None),
                None if state.can_upload && buffer.buffer.is_empty() => Poll::Ready(Some(())),
                None => state.uploader.pending(cx),
            }
        })
        .await
    }

    async fn ended(&self) {
        poll_fn(|cx| {
            let mut state = self.exchange.state.lock();
            if state.end.is_some() {
                Poll::Ready(())
            } else {
                state.uploader.pending(cx)
            }
        })
        .await;
    }

    async fn run(self, mut body: Body, observer: Option<Progress>) -> Option<()> {
        // A server need not wait for the body, and must not hide that there is none.
        let exec::Either::First(start) = exec::race(body.peek(1), self.ended()).await else {
            return None;
        };
        start
            .inspect_err(|error| self.exchange.abort(*error))
            .ok()?;
        let mut sent = 0;
        loop {
            self.drained().await?;
            if let Some(observer) = &observer {
                observer.report(sent);
            }
            let exec::Either::First(read) = exec::race(body.read(), self.ended()).await else {
                return None;
            };
            let (id, is_http2) = {
                let state = self.exchange.state.lock();
                (state.id, state.is_http2)
            };
            let is_chunked = !is_http2 && !self.is_upgraded && self.length.is_none();
            let chunk = read.inspect_err(|error| self.exchange.abort(*error)).ok()?;
            sent += chunk.as_ref().map_or(0, |it| it.len() as u64);
            if self.length.is_some_and(|it| {
                if chunk.is_some() {
                    sent > it
                } else {
                    sent < it
                }
            }) {
                self.exchange.abort(NetError::UploadFileChanged);
                return None;
            }
            let bytes = chunk.as_deref().unwrap_or_default();
            let buffered = &mut self.buffer.lock().buffer.list;
            if is_chunked {
                let _ = write!(buffered, "{:x}\r\n", bytes.len());
            }
            buffered.extend_from_slice(bytes);
            if is_chunked {
                buffered.extend_from_slice(b"\r\n");
            }
            if chunk.is_none() {
                HTTPThread::schedule_request_write(id, WriteMessageType::End);
                return Some(());
            }
            HTTPThread::schedule_request_write(id, WriteMessageType::Data);
        }
    }
}

impl Drop for Upload {
    fn drop(&mut self) {
        self.buffer.clear_drain_callback();
    }
}

struct Parts(SharedBytes);

impl Source for Parts {
    fn poll_read(&mut self, _: &mut Context<'_>) -> Poll<Read> {
        let part = self.0.slice(0..UPLOADED_PART as usize);
        self.0 = self.0.slice(part.len()..self.0.len());
        Poll::Ready(Ok(Some(Chunk::Shared(part)).filter(|it| !it.is_empty())))
    }
}

fn to_http(list: &HeaderList) -> Result<Headers> {
    let mut headers = Headers::default();
    for (name, value) in list.combined() {
        if !is_token(name) || strings::index_of_any(&value, b"\r\n\0").is_some() {
            return Err(NetError::Failed);
        }
        headers.append(name, &value);
    }
    Ok(headers)
}

pub(super) async fn send(
    url: &Url,
    method: &[u8],
    headers: &HeaderList,
    body: Option<RequestBody>,
    observer: Option<&Progress>,
    connection: Connection<'_>,
) -> Result<Answer> {
    let (mut upgrade, mut upgraded) = (None, None);
    let (bytes, streamed) = match body {
        None => (None, None),
        Some(RequestBody::Upgrade(body)) => {
            upgrade = Some(body);
            (None, Some((Body::default(), None)))
        }
        Some(RequestBody::Stream(body)) => (None, Some((body.ok_or(NetError::Failed)?, None))),
        Some(RequestBody::Data(data)) => match data {
            Data::Bytes(bytes) if observer.is_none() || bytes.len() as u64 <= UPLOADED_PART => {
                (Some(bytes), None)
            }
            Data::Bytes(bytes) => (
                None,
                Some((Body::new(Parts(bytes.clone())), Some(bytes.len() as u64))),
            ),
            _ if observer.is_none() => (Some(data.open().read_to_end().await?.into_shared()), None),
            _ => (None, Some((data.open(), Some(data.len())))),
        },
    };
    let (proxy, proxy_headers) = match connection.proxy {
        Some((proxy, headers)) => (proxy, Some(to_http(&headers)?)),
        None => (Bytes::default(), None),
    };
    let Headers {
        entries,
        buf: header_bytes,
    } = to_http(headers)?;
    let mut exchange = Arc::new(Exchange {
        signals: signals::Store::default(),
        url: url.without_fragment().into(),
        proxy,
        method: method.into(),
        header_bytes,
        body: bytes,
        tunnel: connection.tunnel,
        handshake: connection.handshake,
        has_approved_certificate: AtomicBool::new(false),
        state: Guarded::default(),
    });
    let mut signals = Arc::get_mut(&mut exchange)
        .ok_or(NetError::Failed)?
        .signals
        .to_with_backpressure();
    signals.cert_errors = signals.cert_errors.filter(|_| connection.verify.is_some());
    for it in [
        &exchange.signals.header_progress,
        &exchange.signals.response_body_streaming,
        &exchange.signals.cert_errors,
    ] {
        it.store(true, Ordering::Relaxed);
    }
    let of_http_thread = Arc::into_raw(Arc::clone(&exchange)).cast_mut();
    // SAFETY: that reference is released after the request, which borrows from it.
    let borrowed: &'static Exchange = unsafe { &*of_http_thread };
    let mut request = AsyncHTTP::init(
        Method::which(method).unwrap_or(Method::POST),
        bun_url::URL::parse(&borrowed.url),
        entries,
        &borrowed.header_bytes,
        borrowed.body.as_deref().unwrap_or_default(),
        HTTPClientResultCallback::new_with_release(
            of_http_thread,
            Exchange::on_result,
            Exchange::on_shutdown,
        ),
        FetchRedirect::Manual,
        async_http::Options {
            http_proxy: (!borrowed.proxy.is_empty()).then(|| bun_url::URL::parse(&borrowed.proxy)),
            proxy_headers,
            signals: Some(signals),
            disable_timeout: Some(true),
            reject_unauthorized: Some(!connection.ignores_certificate_errors),
            tls_props: connection.tls,
            pool: connection.pool,
            ..Default::default()
        },
    );
    request.client.remaining_redirect_count = 0;
    request.client.browser = Some(borrowed);
    let id = request.async_http_id;
    exchange.state.lock().id = id;
    (exchange.handshake.iter()).for_each(|it| it.request_id.store(id, Ordering::Relaxed));
    if let Some((body, length)) = streamed {
        let buffer = ThreadSafeStreamBuffer::new(Exchange::on_drain, of_http_thread);
        let framing = StreamFraming {
            content_length: length,
            transfer_encoding: None,
        };
        request.client.flags.is_streaming_request_body = true;
        request.request_body = HTTPRequestBody::Stream(Stream {
            buffer: Some(buffer.clone()),
            ended: false,
            framing,
        });
        let (upload, observer) = (
            Upload {
                exchange: Arc::clone(&exchange),
                buffer,
                length,
                is_upgraded: upgrade.is_some(),
            },
            observer.cloned(),
        );
        if upload.is_upgraded {
            upgraded = Some(upload);
        } else {
            exec::spawn(async move {
                upload.run(body, observer).await;
            });
        }
    }
    bun_http::http_thread::init(&Default::default());
    HTTPThread::schedule([request]);
    (connection.started)(&exchange);

    let download = Download(exchange);
    let head = loop {
        let url = &download.0.url;
        let progress = poll_fn(|cx| {
            let mut state = download.0.state.lock();
            if let Some(certificate) = state.certificate.take() {
                return Poll::Ready(Ok(Err(certificate)));
            }
            match (state.head.take(), state.end) {
                (Some(head), _) => Poll::Ready(Ok(Ok(head))),
                (None, Some(end)) => Poll::Ready(Err(match end {
                    Err(NetError::ConnectionClosed) if !url.starts_with(b"http:") => {
                        NetError::ConnectionClosed
                    }
                    Ok(()) | Err(NetError::ConnectionClosed) => NetError::EmptyResponse,
                    Err(error) => error,
                })),
                (None, None) => state.receiver.pending(cx),
            }
        });
        match progress.await? {
            Ok(head) => break head,
            Err(certificate) => {
                connection.verify.ok_or(NetError::CertAuthorityInvalid)?(certificate).await?;
                (download.0.has_approved_certificate).store(true, Ordering::Release);
                HTTPThread::schedule_cert_check_resume(id);
            }
        }
    };
    if let Some((upload, body)) = upgraded.zip(upgrade).filter(|_| head.status == 101) {
        let body = body.lock().take().unwrap_or_default();
        exec::spawn_background(async move {
            upload.run(body, None).await;
        });
    }
    let protocol = if download.0.state.lock().is_http2 {
        Protocol::Http2
    } else {
        Protocol::Http1
    };
    Ok(Answer {
        protocol,
        body: Body::new(download),
        ..head
    })
}
