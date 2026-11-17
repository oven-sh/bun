//! What the app has a say in. All of it is on the main thread.

use std::sync::Arc;

use bun_http::CertificateInfo;

use super::auth::{AuthScheme, Login};
use super::body::SharedBytes;
use super::cookies::Change;
use super::error::{NetError, Result};
use super::response::{Answer, Cached};
use super::tls::ClientIdentity;
use crate::Bytes;
use crate::exec::LocalFuture;
use crate::headers::HeaderList;
use crate::origin::Origin;
use crate::request::{Destination, RequestBody};
use crate::url::Url;

keywords! {
    pub enum RequestEvent {
        BeforeRequest = b"onBeforeRequest",
        BeforeSendHeaders = b"onBeforeSendHeaders",
        SendHeaders = b"onSendHeaders",
        HeadersReceived = b"onHeadersReceived",
        ResponseStarted = b"onResponseStarted",
        BeforeRedirect = b"onBeforeRedirect",
        Completed = b"onCompleted",
        ErrorOccurred = b"onErrorOccurred",
    }
}

keywords! {
    pub enum ResourceType {
        MainFrame = b"mainFrame",
        SubFrame = b"subFrame",
        Stylesheet = b"stylesheet",
        Script = b"script",
        Image = b"image",
        Font = b"font",
        Object = b"object",
        Xhr = b"xhr",
        Ping = b"ping",
        CspReport = b"cspReport",
        Media = b"media",
        WebSocket = b"webSocket",
        Other = b"other",
    }
}

/// Names a document or a worker.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct ClientId(pub u32);

#[derive(Clone)]
pub struct About {
    pub id: u32,
    pub url: Url,
    pub method: Bytes,
    pub client: Option<ClientId>,
    pub origin: Option<Origin>,
    /// `None` for a request of the app.
    pub destination: Option<Destination>,
    pub resource_type: ResourceType,
    pub referrer: Option<Url>,
    pub is_inspected: bool,
}

#[derive(Clone)]
pub struct Received {
    pub status: u16,
    pub status_text: Bytes,
    pub headers: HeaderList,
    pub cached: Cached,
}

#[derive(Default)]
pub struct Details {
    pub upload: Option<SharedBytes>,
    pub request_headers: Option<HeaderList>,
    pub received: Option<Received>,
    pub redirect_url: Option<Url>,
    pub outcome: Option<Result<()>>,
}

#[derive(Default)]
pub struct Decision {
    pub cancels: bool,
    pub redirect_url: Option<Bytes>,
    pub headers: Option<HeaderList>,
    pub status_line: Option<Bytes>,
}

pub struct Outgoing {
    pub url: Url,
    pub method: Bytes,
    pub headers: HeaderList,
    pub body: Option<RequestBody>,
}

/// With another path, if there is one.
pub type Network = Box<dyn Fn(Option<&[u8]>) -> LocalFuture<'static, Result<Answer>>>;

pub enum Paused {
    Continue(Outgoing),
    Fulfill(Answer),
}

#[derive(Clone, Copy)]
pub enum Verdict {
    Accept,
    Refuse,
    AsVerified,
}

pub struct Prompt {
    pub is_proxy: bool,
    pub scheme: AuthScheme,
    pub peer: Url,
    pub realm: Bytes,
    pub is_first_attempt: bool,
    pub headers: HeaderList,
}

keywords! {
    pub enum AnsweredBy {
        App = b"app",
        Cache = b"cache",
        Network = b"network",
        WebEngine = b"web-engine",
    }
}

pub struct Answered {
    pub by: AnsweredBy,
    pub duration: f64,
    pub outcome: core::result::Result<(u16, HeaderList), NetError>,
}

keywords! {
    pub enum SiteData {
        Cache = b"\"cache\"",
        Cookies = b"\"cookies\"",
        Storage = b"\"storage\"",
    }
}

pub trait Embedder {
    fn tell(&self, event: RequestEvent, about: &About, details: Details);
    fn ask(
        &self,
        event: RequestEvent,
        about: &About,
        details: Details,
    ) -> LocalFuture<'static, Result<Decision>>;
    fn handle_protocol(
        &self,
        about: &About,
        request: Outgoing,
    ) -> LocalFuture<'static, Result<Answer>>;
    fn serve(
        &self,
        about: &About,
        headers: &HeaderList,
        network: Network,
    ) -> LocalFuture<'static, Result<Option<Answer>>>;
    fn send_by_web_engine(&self, request: Outgoing) -> LocalFuture<'static, Result<Answer>>;
    /// For the first time.
    fn network_is_used(&self);
    /// `error` is what is wrong with it.
    fn verify_certificate(
        &self,
        certificate: &CertificateInfo,
        error: Option<NetError>,
    ) -> LocalFuture<'static, Result<Verdict>>;
    fn excuses_certificate(
        &self,
        about: &About,
        certificate: &CertificateInfo,
        error: NetError,
    ) -> LocalFuture<'static, Result<bool>>;
    /// The position in `candidates`.
    fn select_client_certificate(
        &self,
        about: &About,
        candidates: &[Arc<ClientIdentity>],
    ) -> LocalFuture<'static, Result<Option<usize>>>;
    fn log_in(&self, about: &About, prompt: Prompt) -> LocalFuture<'static, Result<Option<Login>>>;
    /// In the PEM format.
    fn system_authorities(&self) -> Vec<Bytes>;
    fn answered(&self, about: &About, report: Answered);
    fn pause(&self, about: &About, request: Outgoing) -> LocalFuture<'static, Result<Paused>>;
    fn keep_body(&self, about: &About, body: SharedBytes);
    /// Of a module that is part of the program without being compiled.
    fn source_of(&self, url: &Url) -> LocalFuture<'static, Result<Option<Vec<u8>>>>;
    fn cookie_changed(&self, change: &Change);
    /// Those of another program whose profile this is, once.
    fn encrypt(&self, bytes: &[u8]) -> Option<Vec<u8>>;
    fn decrypt(&self, bytes: &[u8]) -> Option<Vec<u8>>;
}
