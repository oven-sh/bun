//! https://fetch.spec.whatwg.org/#responses

use super::body::Body;
use crate::Bytes;
use crate::headers::{HeaderList, tokens};
use crate::referrer::ReferrerPolicy;
use crate::request::Destination;
use crate::service::{Reserved, Routing};
use crate::url::Url;

keywords! {
    pub enum Cached {
        No = b"",
        Local = b"local",
        Validated = b"validated",
    }
}

keywords! {
    pub enum Protocol {
        None = b"",
        Http1 = b"http/1.1",
        Http2 = b"h2",
    }
}

/// What a server, a cache or a handler has said, which nothing has checked yet.
pub struct Answer {
    pub status: u16,
    pub status_text: Bytes,
    pub headers: HeaderList,
    pub body: Body,
    pub cached: Cached,
    pub protocol: Protocol,
}

impl Answer {
    pub fn new(status: u16, status_text: &[u8], headers: HeaderList, body: Body) -> Answer {
        Answer {
            status,
            status_text: status_text.into(),
            headers,
            body,
            cached: Cached::No,
            protocol: Protocol::None,
        }
    }

    pub fn of_body(body: Body) -> Answer {
        Answer::new(200, b"", HeaderList::default(), body)
    }
}

pub fn is_redirect_status(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

pub fn is_null_body_status(status: u16) -> bool {
    matches!(status, 101 | 103 | 204 | 205 | 304)
}

pub fn is_ok_status(status: u16) -> bool {
    matches!(status, 200..=299)
}

keywords! {
    pub enum ResponseType {
        Basic = b"basic",
        Cors = b"cors",
        Opaque = b"opaque",
        OpaqueRedirect = b"opaqueredirect",
    }
}

crate::wire! {
    /// https://fetch.spec.whatwg.org/#fetch-timing-info, in milliseconds since the epoch.
    #[derive(Clone, Copy, Default)]
    pub struct Timing {
        pub start: f64,
        pub redirect_start: f64,
        pub redirect_end: f64,
        pub routing: Routing,
        pub fetch_start: f64,
        pub request_start: f64,
        pub response_start: f64,
    }
}

crate::wire! {
    /// All but the body of the internal response.
    #[derive(Clone)]
    pub struct Head {
        pub kind: ResponseType,
        pub url: Url,
        pub status: u16,
        pub status_text: Bytes,
        pub headers: HeaderList,
        pub redirects: u8,
        pub has_cross_origin_redirects: bool,
        pub includes_credentials: bool,
        /// What `*` exposes depends on it.
        pub has_credentials_mode_include: bool,
        pub allows_timing: bool,
        /// To the document that it becomes.
        pub exposes_redirects: bool,
        pub cached: Cached,
        pub protocol: Protocol,
        pub timing: Timing,
        /// That was sent.
        pub referrer: Option<Url>,
        /// The client that is made from it.
        pub reserved: Option<Reserved>,
        pub is_from_service_worker: bool,
        /// By the host, with what a service worker passes on without seeing it.
        pub kept_as: u32,
    }
}

impl Head {
    pub fn new(kind: ResponseType, url: Url, headers: HeaderList) -> Head {
        Head {
            kind,
            url,
            status: 200,
            status_text: Bytes::default(),
            headers,
            redirects: 0,
            has_cross_origin_redirects: false,
            includes_credentials: false,
            has_credentials_mode_include: false,
            allows_timing: false,
            exposes_redirects: false,
            cached: Cached::Local,
            protocol: Protocol::None,
            timing: Timing::default(),
            referrer: None,
            reserved: None,
            is_from_service_worker: false,
            kept_as: 0,
        }
    }

    /// From a page process.
    pub(crate) fn hide_secrets(&mut self, destination: Destination) {
        let is_media = matches!(destination, Destination::Audio | Destination::Video);
        let (exposed, is_hidden) = (
            self.exposed_headers(),
            self.kind == ResponseType::OpaqueRedirect,
        );
        let is_needed = |name: &[u8]| match &*name.to_ascii_lowercase() {
            b"access-control-expose-headers" | b"content-type" | b"referrer-policy" => true,
            b"content-encoding" | b"content-length" => self.allows_timing || is_media,
            b"content-range" => is_media,
            b"server-timing" => self.allows_timing,
            _ => false,
        };
        (self.headers).retain(|name, _| !is_hidden && (exposed.contains(name) || is_needed(name)));
    }

    pub fn referrer_policy(&self) -> ReferrerPolicy {
        ReferrerPolicy::from_header(&self.headers.get_or_empty(b"referrer-policy"))
    }

    pub fn is_cors_cross_origin(&self) -> bool {
        matches!(
            self.kind,
            ResponseType::Opaque | ResponseType::OpaqueRedirect
        )
    }

    /// Of the filtered response.
    pub fn exposed_headers(&self) -> HeaderList {
        if self.is_cors_cross_origin() {
            return HeaderList::default();
        }
        let listed = self
            .headers
            .get_or_empty(b"access-control-expose-headers")
            .to_ascii_lowercase();
        let listed = tokens(&listed).unwrap_or_default();
        let exposes_all = self.kind == ResponseType::Basic
            || (!self.has_credentials_mode_include && listed.contains(&&b"*"[..]));
        let is_exposed = |name: &[u8]| match name {
            b"set-cookie" | b"set-cookie2" => false,
            b"cache-control" | b"content-language" | b"content-length" | b"content-type"
            | b"expires" | b"last-modified" | b"pragma" => true,
            _ => exposes_all || listed.contains(&name),
        };
        self.headers
            .iter()
            .filter(|it| is_exposed(&it.0.to_ascii_lowercase()))
            .collect()
    }
}

crate::wire! {
    pub struct Response {
        pub head: Head,
        pub body: Option<Body>,
    }
}
