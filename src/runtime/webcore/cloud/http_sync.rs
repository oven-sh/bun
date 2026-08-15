//! A blocking HTTP round-trip on Bun's HTTP thread with a hard deadline,
//! for credential endpoints (IMDS, ECS, STS, SSO, GCP metadata). Runs on a
//! work-pool thread (or, for synchronous `presign`, the JS thread); never
//! follows redirects for link-local metadata endpoints.

use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;

use bun_core::MutableString;
use bun_http::{
    AsyncHTTP, FetchRedirect, HTTPClientResult, HTTPClientResultCallback, Headers, HeadersExt,
    Method,
};
use bun_picohttp as picohttp;
use bun_threading::{Condvar, Guarded};
use bun_url::URL;

pub struct Request<'a> {
    pub method: Method,
    pub url: &'a [u8],
    pub headers: &'a [(&'a [u8], &'a [u8])],
    pub body: &'a [u8],
    pub timeout_ms: u32,
    pub follow_redirects: bool,
    /// `https_proxy` to tunnel through, already filtered for `NO_PROXY`.
    pub proxy: Option<&'a [u8]>,
    pub reject_unauthorized: bool,
    /// Set from another thread (VM teardown) to abandon the request early.
    pub cancel: Option<&'a AtomicBool>,
}

pub struct Response {
    pub status: u32,
    pub body: Vec<u8>,
    headers: Vec<(Box<[u8]>, Box<[u8]>)>,
}

impl Response {
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| &**v)
    }
}

#[derive(Debug)]
pub enum Error {
    Timeout,
    Cancelled,
    Http(bun_http::Error),
    NoResponse,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Error::Timeout => f.write_str("request timed out"),
            Error::Cancelled => f.write_str("cancelled"),
            Error::Http(e) => write!(f, "{}", bstr::BStr::new(e.name().as_bytes())),
            Error::NoResponse => f.write_str("connection closed without a response"),
        }
    }
}

struct Channel {
    slot: Guarded<Option<HTTPClientResult<'static>>>,
    cv: Condvar,
    response_buffer: MutableString,
}

fn on_result(this: *mut Channel, _http: *mut AsyncHTTP<'static>, mut result: HTTPClientResult<'_>) {
    if result.has_more {
        // Progress signals are not wired, so only the terminal callback should
        // arrive; ignore anything else defensively.
        return;
    }
    // SAFETY: `this` is the heap `Channel` owned by `fetch`, alive until it
    // has read the slot (which happens-after this write).
    unsafe {
        result.body_into(&mut (*this).response_buffer.list);
        let mut g = (*this).slot.lock();
        *g = Some(result.detach_lifetime());
        (*this).cv.notify_one();
    }
}

/// Which headers the caller wants copied out of the response.
const KEPT_HEADERS: &[&[u8]] = &[
    b"content-type",
    b"location",
    b"x-aws-ec2-metadata-token-ttl-seconds",
    b"metadata-flavor",
];

pub fn fetch(req: &Request<'_>) -> Result<Response, Error> {
    bun_http::http_thread::init(&Default::default());

    let pico: Vec<picohttp::Header> = req
        .headers
        .iter()
        .map(|(k, v)| picohttp::Header::new(k, v))
        .collect();
    let headers = Headers::from_pico_http_headers(&pico);
    let signals = bun_http::signals::Store::default();
    let url = URL::parse(req.url);
    let proxy = req.proxy.filter(|p| !p.is_empty()).map(URL::parse);

    let channel = bun_core::heap::into_raw(Box::new(Channel {
        slot: Guarded::new(None),
        cv: Condvar::new(),
        response_buffer: MutableString::default(),
    }));

    let mut http = AsyncHTTP::init(
        req.method,
        url,
        headers.entries.clone().expect("OOM"),
        &headers.buf,
        req.body,
        HTTPClientResultCallback::new::<Channel>(channel, on_result),
        if req.follow_redirects {
            FetchRedirect::Follow
        } else {
            FetchRedirect::Manual
        },
        bun_http::async_http::Options {
            http_proxy: proxy,
            reject_unauthorized: Some(req.reject_unauthorized),
            disable_keepalive: Some(true),
            signals: Some(bun_http::Signals {
                aborted: Some(core::ptr::NonNull::from(&signals.aborted)),
                ..Default::default()
            }),
            idle_timeout_seconds: Some(req.timeout_ms.div_ceil(1000).max(1)),
            ..Default::default()
        },
    );
    let async_http_id = http.async_http_id;

    if req.cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
        http.clear_data();
        // SAFETY: never scheduled; sole owner.
        drop(unsafe { bun_core::heap::take(channel) });
        return Err(Error::Cancelled);
    }
    let mut batch = bun_threading::thread_pool::Batch::default();
    http.schedule(&mut batch);
    // SAFETY (thread door): `channel`/`http` hold no VM or JS state, and this
    // function does not return until the HTTP thread's single callback has
    // fired, so nothing outlives the caller (a `bun_jsc::Job` body holding a
    // Ticket, or the JS thread itself).
    bun_http::HTTPThread::schedule(batch);

    let deadline = std::time::Instant::now() + Duration::from_millis(u64::from(req.timeout_ms));
    let mut aborted = false;
    let mut cancelled = false;
    // SAFETY: `channel` is live until `heap::take` below; the HTTP thread only
    // touches it inside `on_result`, whose last action is the notify.
    let result = unsafe {
        let ch = &*channel;
        let mut g = ch.slot.lock();
        loop {
            if let Some(r) = g.take() {
                break r;
            }
            let now = std::time::Instant::now();
            if !cancelled && req.cancel.is_some_and(|c| c.load(Ordering::Relaxed)) {
                cancelled = true;
            }
            if now >= deadline || cancelled {
                if !aborted {
                    aborted = true;
                    signals.aborted.store(true, Ordering::Relaxed);
                    bun_http::http_thread().schedule_shutdown_by_id(async_http_id);
                }
                // The abort makes the HTTP thread call back promptly; wait for
                // it so the channel/request/headers outlive every access.
                ch.cv.wait_guarded(&mut g);
            } else {
                // Wake at least every 250ms to notice cancellation.
                let remaining = (deadline - now).min(Duration::from_millis(250));
                let _ = ch.cv.timed_wait_guarded(
                    &mut g,
                    remaining.as_nanos().min(u128::from(u64::MAX)) as u64,
                );
            }
        }
    };
    // SAFETY: sole owner; callback completed.
    let channel = unsafe { bun_core::heap::take(channel) };
    http.clear_data();

    if cancelled {
        return Err(Error::Cancelled);
    }
    if aborted {
        return Err(Error::Timeout);
    }
    if let Some(err) = result.fail {
        return Err(Error::Http(err));
    }
    let Some(metadata) = result.metadata else {
        return Err(Error::NoResponse);
    };
    let mut kept = Vec::new();
    for h in metadata.response.headers.list.iter() {
        let name = h.name();
        if KEPT_HEADERS.iter().any(|k| name.eq_ignore_ascii_case(k)) {
            kept.push((Box::from(name), Box::from(h.value())));
        }
    }
    Ok(Response {
        status: metadata.response.status_code,
        body: channel.response_buffer.list,
        headers: kept,
    })
}
