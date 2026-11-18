//! https://fetch.spec.whatwg.org/#requests

use std::sync::Arc;

use bun_threading::Guarded;

use crate::Bytes;
use crate::csp::Metadata;
use crate::headers::HeaderList;
use crate::net::body::{Blob, Body, Data};
use crate::origin::Origin;
use crate::referrer::ReferrerPolicy;
use crate::service::Handler;
use crate::url::Url;
use crate::wire::{self, Wire};

keywords! {
    pub enum Destination {
        Empty = b"",
        Audio = b"audio",
        AudioWorklet = b"audioworklet",
        Document = b"document",
        Embed = b"embed",
        Font = b"font",
        Frame = b"frame",
        Iframe = b"iframe",
        Image = b"image",
        Json = b"json",
        Manifest = b"manifest",
        Object = b"object",
        PaintWorklet = b"paintworklet",
        Report = b"report",
        Script = b"script",
        ServiceWorker = b"serviceworker",
        SharedWorker = b"sharedworker",
        Style = b"style",
        Text = b"text",
        Track = b"track",
        Video = b"video",
        Worker = b"worker",
        Xslt = b"xslt",
    }
}

impl Destination {
    pub fn is_script_like(self) -> bool {
        use Destination::*;
        matches!(
            self,
            AudioWorklet | PaintWorklet | Script | ServiceWorker | SharedWorker | Worker
        )
    }

    pub fn is_navigation(self) -> bool {
        use Destination::*;
        matches!(self, Document | Embed | Frame | Iframe | Object)
    }
}

keywords! {
    pub enum Mode {
        Navigate = b"navigate",
        SameOrigin = b"same-origin",
        NoCors = b"no-cors",
        Cors = b"cors",
        WebSocket = b"websocket",
    }
}

keywords! {
    pub enum Credentials {
        Omit = b"omit",
        SameOrigin = b"same-origin",
        Include = b"include",
    }
}

keywords! {
    pub enum CacheMode {
        Default = b"default",
        NoStore = b"no-store",
        Reload = b"reload",
        NoCache = b"no-cache",
        ForceCache = b"force-cache",
        OnlyIfCached = b"only-if-cached",
    }
}

keywords! {
    pub enum Redirect {
        Follow = b"follow",
        Error = b"error",
        Manual = b"manual",
    }
}

keywords! {
    pub enum InitiatorType {
        Audio = b"audio",
        Beacon = b"beacon",
        Body = b"body",
        Css = b"css",
        EarlyHints = b"early-hints",
        Embed = b"embed",
        EventSource = b"eventsource",
        Fetch = b"fetch",
        Font = b"font",
        Frame = b"frame",
        Icon = b"icon",
        Iframe = b"iframe",
        Image = b"image",
        Img = b"img",
        Input = b"input",
        Link = b"link",
        Navigation = b"navigation",
        Object = b"object",
        Other = b"other",
        Ping = b"ping",
        Script = b"script",
        Track = b"track",
        Use = b"use",
        Video = b"video",
        XmlHttpRequest = b"xmlhttprequest",
    }
}

pub enum RequestBody {
    Data(Data),
    /// `None` once it has been sent.
    Stream(Option<Body>),
    /// What is sent once the server has switched protocols.
    Upgrade(Arc<Guarded<Option<Body>>>),
}

/// Only the host switches protocols.
impl Wire for RequestBody {
    fn write(self, to: &mut wire::Writer) {
        match self {
            RequestBody::Data(data) => Ok(data),
            streamed => Err(streamed.open()),
        }
        .write(to);
    }

    fn read(from: &mut wire::Reader<'_>) -> wire::Result<RequestBody> {
        Ok(match Wire::read(from)? {
            Ok(data) => RequestBody::Data(data),
            Err(body) => RequestBody::Stream(Some(body)),
        })
    }
}

impl RequestBody {
    /// For one attempt to send it.
    pub(crate) fn take(&mut self) -> RequestBody {
        match self {
            RequestBody::Data(data) => RequestBody::Data(data.clone()),
            RequestBody::Stream(body) => RequestBody::Stream(body.take()),
            RequestBody::Upgrade(body) => RequestBody::Upgrade(Arc::clone(body)),
        }
    }

    pub fn open(self) -> Body {
        match self {
            RequestBody::Data(data) => data.open(),
            RequestBody::Stream(body) => body.unwrap_or_default(),
            RequestBody::Upgrade(_) => Body::default(),
        }
    }
}

crate::wire! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Navigation {
        Other,
        Reload,
        History,
    }

    /// What a page may decide about a request. Who it is made for is not part of that.
    pub struct Request {
        pub url: Url,
        pub method: Bytes,
        pub headers: HeaderList,
        /// Those of the user agent, which need no preflight.
        pub cors_exempt_headers: HeaderList,
        pub body: Option<RequestBody>,
        pub destination: Destination,
        pub mode: Mode,
        pub credentials: Credentials,
        pub cache: CacheMode,
        pub redirect: Redirect,
        pub referrer: Option<Url>,
        pub referrer_policy: ReferrerPolicy,
        pub metadata: Metadata,
        /// Without it, there is no resource timing entry.
        pub initiator_type: Option<InitiatorType>,
        /// What a `blob:` URL stood for when it was parsed.
        pub blob: Option<Blob>,
        /// Unlike other credentials.
        pub omits_cookies: bool,
        pub uses_preflight: bool,
        pub is_image_set: bool,
        pub has_user_activation: bool,
        pub blocks_rendering: bool,
        pub keepalive: bool,
        pub navigation: Navigation,
        /// Of a navigation.
        pub starter: Option<Starter>,
        /// A service worker passes on a request for a script or a document.
        pub may_become_code: bool,
        pub is_only_for_service_worker: bool,
        /// If it is not that of the client.
        pub handler: Option<Handler>,
    }
}

/// It still counts if a service worker passes the request on.
#[derive(Clone)]
pub struct Starter {
    /// `None` is the user, or the app.
    pub(crate) origin: Option<Origin>,
    pub(crate) has_tainted_origin: bool,
    /// Those that have been asked for.
    pub(crate) urls: Vec<Url>,
    pub(crate) destination: Destination,
    pub(crate) has_user_activation: bool,
}

crate::wire!(impl never Starter);

impl Request {
    pub fn new(
        url: Url,
        destination: Destination,
        mode: Mode,
        credentials: Credentials,
    ) -> Request {
        Request {
            url,
            method: b"GET"[..].into(),
            headers: HeaderList::default(),
            cors_exempt_headers: HeaderList::default(),
            body: None,
            destination,
            mode,
            credentials,
            cache: CacheMode::Default,
            redirect: Redirect::Follow,
            referrer: None,
            referrer_policy: ReferrerPolicy::Empty,
            metadata: Metadata::default(),
            initiator_type: None,
            blob: None,
            omits_cookies: false,
            uses_preflight: false,
            is_image_set: false,
            has_user_activation: false,
            blocks_rendering: false,
            keepalive: false,
            navigation: Navigation::Other,
            starter: None,
            may_become_code: false,
            is_only_for_service_worker: false,
            handler: None,
        }
    }

    pub(crate) fn without_body(&self) -> Request {
        Request {
            url: self.url.clone(),
            method: self.method.clone(),
            headers: self.headers.clone(),
            cors_exempt_headers: self.cors_exempt_headers.clone(),
            body: None,
            referrer: self.referrer.clone(),
            metadata: self.metadata.clone(),
            blob: self.blob.clone(),
            starter: self.starter.clone(),
            handler: None,
            ..*self
        }
    }

    pub(crate) fn has_streamed_body(&self) -> bool {
        matches!(self.body, Some(RequestBody::Stream(_)))
    }
}
