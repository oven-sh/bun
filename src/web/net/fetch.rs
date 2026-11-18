//! https://fetch.spec.whatwg.org/#fetching

use core::future::{Future, poll_fn};
use core::pin::pin;
use core::task::{Context, Poll, ready};
use std::rc::Rc;
use std::sync::Arc;

use bun_core::strings;
use bun_threading::Guarded;

use super::auth::Login;
use super::body::{Body, Chunk, Data, Read, Source};
use super::checks::{self, Allowed, EmbedderPolicy};
use super::cookies;
use super::embedder::{
    About, Answered, AnsweredBy, ClientId, Details, Outgoing, Paused, Received, RequestEvent,
    ResourceType, SiteData,
};
use super::error::{NetError, Result};
use super::http::Progress;
use super::response::{
    Answer, Cached, Head, Response, ResponseType, Timing, is_null_body_status, is_ok_status,
    is_redirect_status,
};
use super::schemes;
use super::session::{Session, next_request_id};
use super::transaction::{self, Requester};
use crate::exec::{LocalFuture, Waiter};
use crate::headers::{HeaderList, split};
use crate::integrity::bytes_match_metadata;
use crate::origin::{Origin, Site, is_potentially_trustworthy};
use crate::referrer::ReferrerPolicy;
use crate::request::{
    CacheMode, Credentials, Destination, InitiatorType, Mode, Redirect, Request, RequestBody,
};
use crate::scheme::{Privileges, privileges_of};
use crate::storage::{Kinds, Origins};
use crate::time::{monotonic_now, wall_now};
use crate::url::Url;
use crate::{Bytes, mime, sniff};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// The rules of the web do not apply.
    App {
        bypasses_handlers: bool,
    },
    Page,
    PageWithoutWebSecurity,
}

#[derive(Clone, Copy, Default)]
pub struct Isolation {
    pub enforced: EmbedderPolicy,
    pub reported: EmbedderPolicy,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IsolationKind {
    Embedder,
    Document,
}

/// Who a request is made for, which a page has no say in.
pub struct Initiator {
    pub role: Role,
    /// `None` is the user, or the app.
    pub origin: Option<Origin>,
    /// The origins of the documents that it is in, the outermost last.
    pub ancestors: Vec<Origin>,
    pub client: Option<ClientId>,
    pub user_agent: Bytes,
    pub accept_language: Bytes,
    pub upgrades_insecure_requests: bool,
    pub prohibits_mixed_content: bool,
    pub blocks_all_mixed_content: bool,
    pub embedder_policy: Isolation,
    pub document_isolation_policy: Isolation,
    pub is_inspected: bool,
}

impl Initiator {
    pub fn new(
        role: Role,
        origin: Option<Origin>,
        user_agent: &[u8],
        accept_language: &[u8],
    ) -> Initiator {
        Initiator {
            role,
            origin,
            ancestors: Vec::new(),
            client: None,
            user_agent: user_agent.into(),
            accept_language: accept_language.into(),
            upgrades_insecure_requests: false,
            prohibits_mixed_content: false,
            blocks_all_mixed_content: false,
            embedder_policy: Isolation::default(),
            document_isolation_policy: Isolation::default(),
            is_inspected: false,
        }
    }
}

/// Gets the size of the body.
pub type EndOfBody = Box<dyn FnOnce(&Head, Result<u64>) + Send>;

pub trait Observer {
    /// Before it is upgraded.
    fn will_check(&self, _: &Request, _first: Option<&Url>) {}

    /// `first` is there after a redirect.
    fn allows(&self, _: &Request, _first: Option<&Url>) -> bool {
        true
    }

    fn blocked_as_mixed_content(&self, _: &Request, _first: Option<&Url>) {}

    fn follows<'a>(
        &'a self,
        _status: u16,
        _method: &'a [u8],
        _target: &'a Url,
        _: &'a HeaderList,
    ) -> LocalFuture<'a, bool> {
        Box::pin(core::future::ready(true))
    }

    fn violated(&self, _: IsolationKind, _: &Request, _first: &Url, _is_enforced: bool) {}

    fn end_of_body(&self) -> Option<EndOfBody> {
        None
    }
}

impl Observer for () {}

/// https://fetch.spec.whatwg.org/#fetch-controller
#[derive(Clone, Default)]
pub struct Controller {
    aborted: Arc<Guarded<(bool, Waiter)>>,
    body: Arc<Guarded<Option<Arriving>>>,
    pub upload: Option<Progress>,
}

impl Controller {
    pub fn with_upload_progress() -> Controller {
        Controller {
            upload: Some(Progress::default()),
            ..Controller::default()
        }
    }

    pub fn abort(&self) {
        let mut aborted = self.aborted.lock();
        aborted.0 = true;
        aborted.1.wake();
        drop(aborted);
        let body = self.body.lock().take();
        drop(body);
    }

    pub fn is_aborted(&self) -> bool {
        self.aborted.lock().0
    }

    pub fn is_in_use(&self) -> bool {
        Arc::strong_count(&self.aborted) > 1
    }

    fn unless_aborted<T>(
        &self,
        cx: &mut Context<'_>,
        poll: impl FnOnce(&mut Context<'_>) -> Poll<Result<T>>,
    ) -> Poll<Result<T>> {
        if self.is_aborted() {
            return Poll::Ready(Err(NetError::Aborted));
        }
        if let Poll::Ready(result) = poll(cx) {
            return Poll::Ready(result);
        }
        let mut aborted = self.aborted.lock();
        if aborted.0 {
            Poll::Ready(Err(NetError::Aborted))
        } else {
            aborted.1.pending(cx)
        }
    }

    pub async fn aborted(&self) {
        let _ = self.race(core::future::pending::<Result<()>>()).await;
    }

    pub async fn race<T>(&self, future: impl Future<Output = Result<T>>) -> Result<T> {
        let mut future = pin!(future);
        poll_fn(|cx| self.unless_aborted(cx, |cx| future.as_mut().poll(cx))).await
    }
}

fn resource_type(request: &Request, role: Role) -> ResourceType {
    use Destination::*;
    match request.destination {
        _ if matches!(role, Role::App { .. }) => ResourceType::Other,
        _ if request.mode == Mode::WebSocket => ResourceType::WebSocket,
        Empty
            if matches!(
                request.initiator_type,
                Some(InitiatorType::Beacon | InitiatorType::Ping)
            ) =>
        {
            ResourceType::Ping
        }
        Empty | Json | Text => ResourceType::Xhr,
        Document => ResourceType::MainFrame,
        Frame | Iframe => ResourceType::SubFrame,
        Style | Xslt => ResourceType::Stylesheet,
        Image => ResourceType::Image,
        Font => ResourceType::Font,
        Audio | Video | Track => ResourceType::Media,
        Object | Embed => ResourceType::Object,
        Report => ResourceType::CspReport,
        Manifest => ResourceType::Other,
        Script | Worker | SharedWorker | ServiceWorker | AudioWorklet | PaintWorklet => {
            ResourceType::Script
        }
    }
}

fn is_local(url: &Url) -> bool {
    matches!(url.scheme(), b"data" | b"blob")
}

fn is_get_or_head(method: &[u8]) -> bool {
    matches!(method, b"GET" | b"HEAD")
}

/// From the cache or the network.
#[derive(Clone)]
struct Transfer {
    session: Arc<Session>,
    url: Url,
    method: Bytes,
    body: Arc<Guarded<Option<RequestBody>>>,
    requester: Arc<Requester>,
    upload: Option<Progress>,
    /// And the partition of the cache.
    cache: Option<(CacheMode, Bytes)>,
    by: Arc<Guarded<AnsweredBy>>,
}

impl Transfer {
    async fn connect(self, headers: HeaderList) -> Result<Answer> {
        let body = self.body.lock().as_mut().map(RequestBody::take);
        let is_for_web_engine = !matches!(body, Some(RequestBody::Upgrade(_)))
            && self.session.is_for_web_engine(&self.url);
        let request = Outgoing {
            url: self.url,
            method: self.method,
            headers,
            body,
        };
        if is_for_web_engine {
            *self.by.lock() = AnsweredBy::WebEngine;
            return self
                .session
                .consult(move |it| it.send_by_web_engine(request))
                .await;
        }
        *self.by.lock() = AnsweredBy::Network;
        transaction::send(
            &self.session,
            request,
            &self.requester,
            self.upload.as_ref(),
        )
        .await
    }

    async fn run(self, headers: HeaderList) -> Result<Answer> {
        let Some((mode, partition)) = &self.cache else {
            return self.connect(headers).await;
        };
        *self.by.lock() = AnsweredBy::Cache;
        let connecting = self.clone();
        let connect = Rc::new(move |headers| {
            Box::pin(connecting.clone().connect(headers)) as LocalFuture<'static, _>
        });
        self.session
            .cache
            .exchange(partition, &self.url, &self.method, headers, *mode, connect)
            .await
    }

    /// What can run code is only taken from the app.
    async fn serve(
        self,
        about: &About,
        headers: HeaderList,
        needs_web_engine: &mut bool,
    ) -> Result<Answer> {
        let (told, asked, transfer) = (about.clone(), headers.clone(), self.clone());
        let own = self.session.consult(move |it| {
            let passed = asked.clone();
            let network = move |path: Option<&[u8]>| {
                let elsewhere = path.filter(|it| *it != transfer.url.path());
                let moved = elsewhere.map(|it| Transfer {
                    url: transfer.url.with_path(it),
                    cache: None,
                    ..transfer.clone()
                });
                Box::pin(
                    moved
                        .unwrap_or_else(|| transfer.clone())
                        .run(passed.clone()),
                ) as LocalFuture<'static, _>
            };
            it.serve(&told, &asked, Box::new(network))
        });
        if let Some(own) = own.await? {
            return Ok(own);
        }
        let destination = about.destination.unwrap_or(Destination::Empty);
        if !destination.is_navigation()
            && !destination.is_script_like()
            && !matches!(destination, Destination::Style | Destination::Xslt)
        {
            return self.run(headers).await;
        }
        if destination == Destination::Document && *self.method == *b"GET" {
            let answer = self.run(headers).await?;
            if (is_redirect_status(answer.status) && answer.headers.contains(b"location"))
                || answer.headers.is_attachment()
            {
                return Ok(answer);
            }
        }
        *needs_web_engine = matches!(destination, Destination::Document | Destination::Iframe);
        Err(NetError::BlockedByClient)
    }
}

pub struct Failure {
    pub error: NetError,
    /// It is a document that only the web engine may show.
    pub needs_web_engine: bool,
}

struct Fetch<'a> {
    session: &'a Arc<Session>,
    initiator: &'a Initiator,
    observer: &'a dyn Observer,
    controller: &'a Controller,
    request: Request,
    id: u32,
    /// Those that have been asked for.
    urls: Vec<Url>,
    referrer: Option<Url>,
    tainting: ResponseType,
    has_tainted_origin: bool,
    allows_timing: bool,
    /// The headers of the redirects of a navigation.
    redirects: Vec<HeaderList>,
    timing: Timing,
    needs_web_engine: bool,
}

impl Fetch<'_> {
    fn is_checked(&self) -> bool {
        self.initiator.role == Role::Page
    }

    fn navigates(&self) -> bool {
        self.is_checked() && self.request.mode == Mode::Navigate
    }

    fn is_for_socket(&self) -> bool {
        self.request.mode == Mode::WebSocket
    }

    fn is_same_origin(&self) -> bool {
        self.initiator
            .origin
            .as_ref()
            .is_some_and(|it| it.is_origin_of(&self.request.url))
    }

    fn serialized_origin(&self) -> &[u8] {
        self.initiator
            .origin
            .as_ref()
            .filter(|_| !self.has_tainted_origin)
            .map_or(b"null", Origin::as_bytes)
    }

    fn about(&self) -> About {
        About {
            id: self.id,
            url: match self.request.url.scheme() {
                b"http" if self.is_for_socket() => self.request.url.with_scheme(b"ws"),
                _ if self.is_for_socket() => self.request.url.with_scheme(b"wss"),
                _ => self.request.url.clone(),
            },
            method: self.request.method.clone(),
            client: self.initiator.client,
            origin: self.initiator.origin.clone(),
            destination: (!matches!(self.initiator.role, Role::App { .. }))
                .then_some(self.request.destination),
            resource_type: resource_type(&self.request, self.initiator.role),
            referrer: self.referrer.clone(),
            is_inspected: self.initiator.is_inspected,
        }
    }

    fn block_or_upgrade_insecure(&mut self) -> Result<()> {
        let (request, initiator) = (&mut self.request, self.initiator);
        if let Some(upgraded) =
            checks::upgrade_insecure(&request.url).filter(|_| initiator.upgrades_insecure_requests)
        {
            request.url = upgraded;
        }
        if initiator.prohibits_mixed_content && checks::is_insecure(&request.url) {
            let is_upgradable = matches!(
                request.destination,
                Destination::Image | Destination::Audio | Destination::Video
            );
            if !is_upgradable || request.is_image_set || initiator.blocks_all_mixed_content {
                (self.observer).blocked_as_mixed_content(request, self.urls.first());
                return Err(NetError::AccessDenied);
            }
            if let Some(upgraded) =
                checks::upgrade_insecure(&request.url).filter(|it| !it.has_address())
            {
                request.url = upgraded;
            }
        }
        Ok(())
    }

    fn taint(&mut self) -> Result<()> {
        let Request {
            url,
            mode,
            destination,
            redirect,
            ..
        } = &self.request;
        if matches!(mode, Mode::Navigate | Mode::WebSocket) || url.scheme() == b"data" {
            return Ok(());
        }
        let privileges = privileges_of(url.scheme());
        let lacks_fetch = !url.is_http()
            && *destination == Destination::Empty
            && !privileges.contains(Privileges::SUPPORT_FETCH_API);
        if self.tainting == ResponseType::Basic && self.is_same_origin() {
            return if lacks_fetch && !matches!(url.scheme(), b"blob" | b"file") {
                Err(NetError::AccessDenied)
            } else {
                Ok(())
            };
        }
        if url.scheme() == b"blob" {
            let is_of_opaque = self
                .initiator
                .origin
                .as_ref()
                .is_some_and(Origin::is_opaque)
                && Origin::of(url).is_opaque();
            return if is_of_opaque {
                Ok(())
            } else {
                Err(NetError::Failed)
            };
        }
        if url.scheme() == b"file" || lacks_fetch {
            return Err(NetError::AccessDenied);
        }
        self.tainting = match mode {
            Mode::NoCors if *redirect == Redirect::Follow => ResponseType::Opaque,
            Mode::Cors if url.is_http() || privileges.contains(Privileges::CORS_ENABLED) => {
                ResponseType::Cors
            }
            _ => return Err(NetError::Failed),
        };
        Ok(())
    }

    fn includes_credentials(&self) -> bool {
        let Initiator {
            embedder_policy,
            document_isolation_policy,
            ..
        } = self.initiator;
        let is_credentialless = [embedder_policy, document_isolation_policy]
            .iter()
            .any(|it| it.enforced == EmbedderPolicy::Credentialless);
        match self.request.credentials {
            Credentials::Omit => false,
            Credentials::SameOrigin => self.tainting == ResponseType::Basic,
            Credentials::Include => !is_credentialless || self.tainting != ResponseType::Opaque,
        }
    }

    fn cookie_context(&self) -> cookies::Context {
        let (url, initiator) = (&self.request.url, self.initiator);
        let is_top_level_navigation = self.request.destination == Destination::Document;
        let outermost = initiator
            .ancestors
            .last()
            .or(initiator.origin.as_ref())
            .filter(|_| !is_top_level_navigation);
        cookies::Context {
            is_same_site: !self.is_checked()
                || initiator
                    .origin
                    .iter()
                    .chain(&initiator.ancestors)
                    .all(|it| it.is_same_site_with(url)),
            is_top_level_navigation,
            has_safe_method: is_get_or_head(&self.request.method),
            is_for_script: false,
            top_level_site: outermost.map_or_else(|| Site::of(url), Site::of_origin),
        }
    }

    fn add_common_headers(&self, headers: &mut HeaderList) {
        let (request, origin) = (&self.request, &self.initiator.origin);
        headers.set_if_absent(b"User-Agent", &self.initiator.user_agent);
        let accepted = match request.metadata.is_prefetch {
            true => Destination::Document,
            false => request.destination,
        };
        headers.set_if_absent(b"Accept", checks::default_accept(accepted));
        headers.set_if_absent(b"Accept-Language", &self.initiator.accept_language);
        headers.set_if_absent(b"Referer", self.referrer.as_ref().map_or(b"", Url::href));
        if !self.is_checked() || !is_potentially_trustworthy(&request.url) {
            return;
        }
        let site: &[u8] = match origin {
            None => b"none",
            Some(origin) if self.urls.iter().all(|it| origin.is_origin_of(it)) => b"same-origin",
            Some(origin) if self.urls.iter().all(|it| origin.is_same_site_with(it)) => b"same-site",
            Some(_) => b"cross-site",
        };
        headers.set(
            b"Sec-Fetch-Dest",
            if request.destination == Destination::Empty {
                b"empty"
            } else {
                request.destination.as_bytes()
            },
        );
        headers.set(b"Sec-Fetch-Mode", request.mode.as_bytes());
        headers.set(b"Sec-Fetch-Site", site);
        if self.navigates() && (request.has_user_activation || origin.is_none()) {
            headers.set(b"Sec-Fetch-User", b"?1");
        }
    }

    /// https://fetch.spec.whatwg.org/#append-a-request-origin-header
    fn origin_header(&self) -> Option<&[u8]> {
        use ReferrerPolicy::*;
        let origin = self.initiator.origin.as_ref()?;
        if self.is_for_socket() {
            return Some(self.serialized_origin());
        }
        if self.tainting != ResponseType::Cors && is_get_or_head(&self.request.method) {
            return None;
        }
        let is_hidden = self.is_checked()
            && self.request.mode != Mode::Cors
            && match self.request.referrer_policy {
                NoReferrer => true,
                SameOrigin => !self.is_same_origin(),
                Origin | OriginWhenCrossOrigin | UnsafeUrl => false,
                Empty | NoReferrerWhenDowngrade | StrictOrigin | StrictOriginWhenCrossOrigin => {
                    origin.is_https() && self.request.url.scheme() != b"https"
                }
            };
        Some(if is_hidden {
            b"null"
        } else {
            self.serialized_origin()
        })
    }

    async fn send(
        &mut self,
        request: Outgoing,
        includes_credentials: bool,
        partition: Option<Bytes>,
    ) -> Result<Answer> {
        let (session, role) = (self.session, self.initiator.role);
        let about = About {
            method: request.method.clone(),
            ..self.about()
        };
        if role
            != (Role::App {
                bypasses_handlers: true,
            })
            && !self.is_for_socket()
            && session.handles(request.url.scheme())
        {
            let about = About {
                referrer: self.request.referrer.clone(),
                ..about
            };
            return session
                .consult(move |it| it.handle_protocol(&about, request))
                .await;
        }
        match request.url.scheme() {
            b"file" => return schemes::fetch_file(&request.url, &request.headers).await,
            b"data" => return schemes::fetch_data(&request.url),
            b"blob" => {
                return schemes::fetch_blob(
                    self.request.blob.clone(),
                    &request.method,
                    &request.headers,
                );
            }
            b"http" | b"https" => {}
            _ => return Err(NetError::UnknownUrlScheme),
        }
        let (by, started) = (Arc::new(Guarded::new(AnsweredBy::App)), monotonic_now());
        let requester = Requester {
            about: about.clone(),
            includes_credentials,
            logs_in: includes_credentials && self.tainting != ResponseType::Cors,
            prompts: self.request.destination != Destination::Image
                || self.cookie_context().top_level_site == Site::of(&request.url),
            login: Login::of_url(&request.url),
        };
        let transfer = Transfer {
            session: Arc::clone(session),
            url: request.url.without_credentials(),
            method: request.method,
            body: Arc::new(Guarded::new(request.body)),
            requester: Arc::new(requester),
            upload: self.controller.upload.clone(),
            cache: partition.map(|it| (self.request.cache, it)),
            by: Arc::clone(&by),
        };
        let answer = if !matches!(role, Role::App { .. })
            && !self.is_for_socket()
            && session.serves(&transfer.url)
        {
            transfer
                .serve(&about, request.headers, &mut self.needs_web_engine)
                .await
        } else {
            transfer.run(request.headers).await
        };
        if session.settings.read().reports_answers {
            let outcome = answer
                .as_ref()
                .map(|it| (it.status, it.headers.clone()))
                .map_err(|it| *it);
            let report = Answered {
                by: *by.lock(),
                duration: monotonic_now() - started,
                outcome,
            };
            session.notify(move |it| it.answered(&about, report));
        }
        answer
    }

    /// https://fetch.spec.whatwg.org/#cors-preflight-fetch
    async fn preflight(&mut self) -> Result<()> {
        let request = &self.request;
        let (names, includes_credentials) = (
            checks::cors_unsafe_names(&request.headers),
            request.credentials == Credentials::Include,
        );
        if checks::is_cors_safelisted_method(&request.method)
            && names.is_empty()
            && !request.uses_preflight
        {
            return Ok(());
        }
        let key = Bytes::from(
            [
                self.cookie_context().top_level_site.as_bytes(),
                b" ",
                self.serialized_origin(),
                b" ",
                request.url.href(),
                &[u8::from(includes_credentials)],
            ]
            .concat(),
        );
        let covers = |it: &Allowed, method: &[u8]| it.covers(method, &names, includes_credentials);
        if self
            .session
            .preflights
            .lock()
            .get(&key)
            .is_some_and(|it| it.until > wall_now() && covers(it, &request.method))
        {
            return Ok(());
        }
        let mut headers: HeaderList = [
            ("Origin", self.serialized_origin()),
            ("Accept", b"*/*"),
            ("Access-Control-Request-Method", &request.method),
        ]
        .into_iter()
        .collect();
        headers.set_if_absent(b"Access-Control-Request-Headers", &names.join(&b","[..]));
        self.add_common_headers(&mut headers);
        let asked = Outgoing {
            url: request.url.clone(),
            method: b"OPTIONS"[..].into(),
            headers,
            body: None,
        };
        let answer = self.send(asked, false, None).await?;
        let allowed = Allowed::parse(&answer.headers, wall_now())
            .filter(|it| is_ok_status(answer.status) && covers(it, &self.request.method))
            .filter(|_| {
                checks::cors_check(
                    &answer.headers,
                    self.serialized_origin(),
                    includes_credentials,
                )
            })
            .ok_or(NetError::Failed)?;
        let mut known = self.session.preflights.lock();
        if known.len() >= 1024 {
            known.clear();
        }
        known.insert(key, allowed);
        Ok(())
    }

    async fn exchange(
        &mut self,
        headers: &HeaderList,
        includes_credentials: bool,
        partition: Option<&Bytes>,
    ) -> Result<Answer> {
        let body = self.request.body.as_mut().map(RequestBody::take);
        let mut request = Outgoing {
            url: self.request.url.clone(),
            method: self.request.method.clone(),
            headers: headers.clone(),
            body,
        };
        if !self.initiator.is_inspected || self.is_for_socket() {
            return self
                .send(request, includes_credentials, partition.cloned())
                .await;
        }
        let about = self.about();
        let mut answer = match self
            .session
            .consult(move |it| it.pause(&about, request))
            .await?
        {
            Paused::Fulfill(answer) => answer,
            Paused::Continue(changed) => {
                request = changed;
                self.send(request, includes_credentials, partition.cloned())
                    .await?
            }
        };
        let is_text = |it: &[u8]| {
            (it.starts_with(b"text/") && it != b"text/event-stream")
                || mime::is_json(it)
                || mime::is_xml(it)
                || mime::is_javascript(it)
        };
        if self.request.destination == Destination::Empty
            && answer
                .headers
                .mime()
                .is_some_and(|it| is_text(it.essence()))
        {
            let (source, session) = (core::mem::take(&mut answer.body), Arc::clone(self.session));
            answer.body = Body::new(Inspected {
                source,
                copy: Vec::new(),
                session,
                about: self.about(),
            });
        }
        Ok(answer)
    }

    /// https://fetch.spec.whatwg.org/#http-network-or-cache-fetch
    async fn network_or_cache_fetch(
        &mut self,
        includes_credentials: bool,
        context: &cookies::Context,
    ) -> Result<Answer> {
        let (session, request) = (self.session, &self.request);
        let mut headers = request.headers.clone();
        request
            .cors_exempt_headers
            .iter()
            .for_each(|it| headers.set(it.0, it.1));
        self.add_common_headers(&mut headers);
        headers.set_if_absent(b"Origin", self.origin_header().unwrap_or_default());
        if self.navigates() {
            headers.set(b"Upgrade-Insecure-Requests", b"1");
        }
        if headers.contains(b"range") {
            headers.set_if_absent(b"Accept-Encoding", b"identity");
        }
        match &request.body {
            None if matches!(&*request.method, b"POST" | b"PUT") => {
                headers.set(b"Content-Length", b"0")
            }
            Some(RequestBody::Data(data)) if data.is_empty() => {
                headers.set(b"Content-Length", b"0")
            }
            _ => {}
        }
        if includes_credentials && !request.omits_cookies && !headers.contains(b"cookie") {
            session.cookies_loaded().await;
            headers.set_if_absent(
                b"Cookie",
                &session.with_cookies(|it| it.header(&request.url, context)),
            );
        }
        if !is_local(&request.url) {
            let about = self.about();
            let details = |headers: &HeaderList| Details {
                request_headers: Some(headers.clone()),
                ..Details::default()
            };
            let decision = session
                .ask(RequestEvent::BeforeSendHeaders, &about, || {
                    details(&headers)
                })
                .await?;
            headers = decision.headers.unwrap_or(headers);
            session.tell(RequestEvent::SendHeaders, &about, || details(&headers));
        }
        let frame_site = || {
            self.initiator
                .origin
                .as_ref()
                .filter(|_| !self.navigates())
                .map_or_else(|| Site::of(&request.url), Site::of_origin)
        };
        let partition = (self.is_checked() && !self.is_for_socket()).then(|| {
            [
                context.top_level_site.as_bytes(),
                b" ",
                frame_site().as_bytes(),
            ]
            .concat()
            .into()
        });
        self.timing.request_start = monotonic_now();
        let answer = self
            .exchange(&headers, includes_credentials, partition.as_ref())
            .await?;
        if answer.status == 401 && self.request.has_streamed_body() {
            return Err(NetError::Failed);
        }
        self.timing.response_start = monotonic_now();
        Ok(answer)
    }

    async fn store_site_data(&self, headers: &HeaderList, context: &cookies::Context) {
        let (session, url) = (self.session, &self.request.url);
        if headers.contains(b"set-cookie") {
            session.cookies_loaded().await;
            session.with_cookies(|jar| {
                headers
                    .values(b"set-cookie")
                    .for_each(|it| _ = jar.receive(it, url, context))
            });
        }
        let Some(cleared) = headers
            .get(b"clear-site-data")
            .filter(|_| self.is_checked() && is_potentially_trustworthy(url))
        else {
            return;
        };
        let asks_for = |kind: SiteData| {
            split(&cleared, b',').any(|it| it == kind.as_bytes() || it == b"\"*\"")
        };
        if asks_for(SiteData::Cookies) {
            session.cookies_loaded().await;
            session.clear_cookies(core::slice::from_ref(url), true);
        }
        if asks_for(SiteData::Storage) {
            let origins = Origins {
                listed: vec![Origin::of(url).as_bytes().into()],
                are_meant: true,
            };
            Arc::clone(&session.storage)
                .clear(Kinds::all(), origins)
                .await;
        }
        if asks_for(SiteData::Cache) {
            Arc::clone(&session.cache).clear().await;
        }
    }

    /// https://fetch.spec.whatwg.org/#cross-origin-resource-policy-check
    fn corp_check(&self, headers: &HeaderList, includes_credentials: bool) -> bool {
        let is_navigation = self.request.mode == Mode::Navigate;
        let origin = if is_navigation {
            self.initiator.ancestors.first()
        } else {
            self.initiator.origin.as_ref()
        };
        let Some(origin) =
            origin.filter(|_| is_navigation || self.tainting == ResponseType::Opaque)
        else {
            return true;
        };
        let allows = |policy| {
            checks::corp_allows(
                origin,
                policy,
                &self.request.url,
                headers,
                includes_credentials,
                is_navigation,
            )
        };
        let policies = [
            (IsolationKind::Embedder, self.initiator.embedder_policy),
            (
                IsolationKind::Document,
                self.initiator.document_isolation_policy,
            ),
        ];
        allows(EmbedderPolicy::UnsafeNone)
            && policies
                .into_iter()
                .fold(true, |is_allowed, (kind, policy)| {
                    for (policy, is_enforced) in [(policy.reported, false), (policy.enforced, true)]
                    {
                        if !allows(policy) {
                            self.observer
                                .violated(kind, &self.request, &self.urls[0], is_enforced);
                        }
                    }
                    is_allowed && allows(policy.enforced)
                })
    }

    async fn redirect_to(&mut self, target: Url, status: u16, headers: &HeaderList) -> Result<()> {
        if !self
            .observer
            .follows(status, &self.request.method, &target, headers)
            .await
        {
            return Err(NetError::Aborted);
        }
        if self.urls.len() > 20 {
            return Err(NetError::TooManyRedirects);
        }
        if Origin::of(&target) != Origin::of(&self.request.url) {
            self.request.headers.delete(b"authorization");
            self.request.headers.delete(b"cookie");
            self.has_tainted_origin |= !self.is_same_origin();
        }
        if self.navigates() {
            self.redirects.push(headers.clone());
        }
        if self.urls.len() == 1 {
            self.timing.redirect_start = self.timing.fetch_start;
        }
        self.timing.redirect_end = monotonic_now();
        self.request.url = target;
        Ok(())
    }

    /// https://fetch.spec.whatwg.org/#http-redirect-fetch
    async fn redirect_fetch(&mut self, about: &About, received: Received) -> Result<()> {
        let (
            request,
            Received {
                status, headers, ..
            },
        ) = (&self.request, &received);
        let location = headers.values(b"location").next().unwrap_or_default();
        let target = request
            .url
            .join(&escape_unless_utf8(location))
            .filter(|_| headers.values(b"location").all(|it| it == location));
        let mut target = target.ok_or(NetError::InvalidRedirect)?;
        if request.url.is_http()
            && matches!(
                target.scheme(),
                b"about" | b"file" | b"data" | b"blob" | b"javascript"
            )
        {
            return Err(NetError::UnsafeRedirect);
        }
        let is_foreign = self.tainting == ResponseType::Cors
            || !self
                .initiator
                .origin
                .as_ref()
                .is_some_and(|it| it.is_origin_of(&target));
        if (self.is_checked()
            && request.mode == Mode::Cors
            && target.includes_credentials()
            && is_foreign)
            || (*status != 303 && request.has_streamed_body())
        {
            return Err(NetError::Failed);
        }
        if let (None, Some(fragment)) = (target.fragment(), request.url.fragment()) {
            target = target.with_fragment(fragment);
        }
        let details = || Details {
            received: Some(received.clone()),
            redirect_url: Some(target.clone()),
            ..Details::default()
        };
        self.session
            .tell(RequestEvent::BeforeRedirect, about, details);
        let request = &mut self.request;
        if if *status == 303 {
            !is_get_or_head(&request.method)
        } else {
            *status < 303 && *request.method == *b"POST"
        } {
            (request.method, request.body) = (b"GET"[..].into(), None);
            for name in [
                &b"content-encoding"[..],
                b"content-language",
                b"content-location",
                b"content-type",
            ] {
                request.headers.delete(name);
            }
        }
        request.referrer_policy =
            ReferrerPolicy::from_header(&headers.get_or_empty(b"referrer-policy"))
                .or(request.referrer_policy);
        self.redirect_to(target, *status, headers).await
    }

    async fn is_blocked_by_orb(&self, answer: &mut Answer) -> Result<bool> {
        if self.tainting != ResponseType::Opaque || !self.request.url.is_http() {
            return Ok(false);
        }
        if let Some(is_blocked) = checks::orb_blocks_by_headers(&answer.headers, answer.status) {
            return Ok(is_blocked);
        }
        let start = answer.body.peek(sniff::HEADER_LENGTH).await?;
        Ok(!start.is_empty() && checks::orb_blocks_by_body(&answer.headers, answer.status, start))
    }

    /// `None` after a redirect.
    async fn main_fetch(&mut self) -> Result<Option<Response>> {
        let session = self.session;
        if checks::has_bad_port(&self.request.url) {
            return Err(NetError::UnsafePort);
        }
        self.observer.will_check(&self.request, self.urls.first());
        if self.is_checked() {
            self.block_or_upgrade_insecure()?;
        }
        if !self.observer.allows(&self.request, self.urls.first()) {
            return Err(NetError::BlockedByCsp);
        }
        if session.hsts.upgrades(&self.request.url) {
            self.request.url = self.request.url.with_scheme(b"https");
        }
        if self.is_checked() {
            self.taint()?;
        }
        self.referrer = self.referrer.take().and_then(|it| {
            self.request
                .referrer_policy
                .referrer(&it, &self.request.url)
        });
        self.timing.fetch_start = if self.urls.is_empty() {
            self.timing.start
        } else {
            monotonic_now()
        };
        self.urls.push(self.request.url.clone());
        let (about, is_told) = (self.about(), !is_local(&self.request.url));
        if is_told {
            let upload = || match &self.request.body {
                Some(RequestBody::Data(Data::Bytes(bytes))) => Details {
                    upload: Some(bytes.clone()),
                    ..Details::default()
                },
                _ => Details::default(),
            };
            let decision = session
                .ask(RequestEvent::BeforeRequest, &about, upload)
                .await?;
            if let Some(target) = decision.redirect_url.filter(|it| **it != *about.url.href()) {
                self.redirect_to(
                    Url::parse(&target).ok_or(NetError::InvalidUrl)?,
                    307,
                    &HeaderList::default(),
                )
                .await?;
                return Ok(None);
            }
        }
        if self.tainting == ResponseType::Cors && self.request.url.is_http() {
            self.preflight().await?;
        }
        let (includes_credentials, context) = (self.includes_credentials(), self.cookie_context());
        let mut answer = self
            .network_or_cache_fetch(includes_credentials, &context)
            .await?;
        let received = |it: &Answer| Received {
            status: it.status,
            status_text: it.status_text.clone(),
            headers: it.headers.clone(),
            cached: it.cached,
        };
        let details = |it: &Answer| Details {
            received: Some(received(it)),
            ..Details::default()
        };
        if is_told {
            let decision = session
                .ask(RequestEvent::HeadersReceived, &about, || details(&answer))
                .await?;
            answer.headers = decision.headers.unwrap_or(answer.headers);
            if let Some((status, text)) =
                decision.status_line.as_deref().and_then(parse_status_line)
            {
                (answer.status, answer.status_text) = (status, text.into());
            }
        }
        if includes_credentials && !self.request.omits_cookies && answer.cached != Cached::Local {
            self.store_site_data(&answer.headers, &context).await;
        }
        let has_credentials_mode_include = self.request.credentials == Credentials::Include;
        if (answer.status == 407 && self.is_checked() && !self.navigates())
            || (self.tainting == ResponseType::Cors
                && !checks::cors_check(
                    &answer.headers,
                    self.serialized_origin(),
                    has_credentials_mode_include,
                ))
        {
            return Err(NetError::Failed);
        }
        if !self.corp_check(&answer.headers, includes_credentials) {
            return Err(NetError::BlockedByResponse);
        }
        let origin = Origin::of(&about.url);
        let has_left_origin = || {
            self.initiator
                .origin
                .as_ref()
                .map_or_else(|| Origin::of(&self.urls[0]) != origin, |it| *it != origin)
        };
        if self.tainting != ResponseType::Basic || (self.navigates() && has_left_origin()) {
            self.allows_timing &= checks::tao_check(&answer.headers, self.serialized_origin());
        }
        let mut kind = self.tainting;
        if is_redirect_status(answer.status) {
            match self.request.redirect {
                Redirect::Error => return Err(NetError::Failed),
                Redirect::Manual if self.is_checked() => kind = ResponseType::OpaqueRedirect,
                Redirect::Follow if answer.headers.contains(b"location") => {
                    self.redirect_fetch(&about, received(&answer)).await?;
                    return Ok(None);
                }
                _ => {}
            }
        }
        let request = &self.request;
        if (self.is_checked()
            && checks::is_blocked_by_mime_type(&answer.headers, request.destination))
            || (kind == ResponseType::Opaque
                && answer.status == 206
                && !request.headers.contains(b"range"))
        {
            return Err(NetError::BlockedByResponse);
        }
        if self.is_blocked_by_orb(&mut answer).await? {
            if request.destination != Destination::Empty {
                return Err(NetError::BlockedByOrb);
            }
            (answer.headers, answer.body) = Default::default();
        }
        session.tell(RequestEvent::ResponseStarted, &about, || details(&answer));
        let has_body = *request.method != *b"HEAD"
            && (self.is_for_socket() || !is_null_body_status(answer.status))
            && kind != ResponseType::OpaqueRedirect;
        if !request.metadata.integrity.is_empty() {
            let bytes = core::mem::take(&mut answer.body).read_to_end().await?;
            if !has_body
                || kind == ResponseType::Opaque
                || !bytes_match_metadata(&bytes, &request.metadata.integrity)
            {
                return Err(NetError::Failed);
            }
            answer.body = bytes.into();
        }
        let has_cross_origin_redirects =
            (self.urls.iter().rev().skip(1)).any(|it| Origin::of(it) != origin);
        let head = Head {
            kind,
            url: about.url.clone(),
            status: answer.status,
            status_text: answer.status_text,
            headers: answer.headers,
            redirects: self.urls.len() as u8 - 1,
            has_cross_origin_redirects,
            includes_credentials,
            has_credentials_mode_include,
            allows_timing: self.allows_timing,
            exposes_redirects: !has_cross_origin_redirects
                || (request.referrer_policy != ReferrerPolicy::NoReferrer
                    && (self.redirects.iter()).all(|it| checks::tao_check(it, origin.as_bytes()))),
            cached: answer.cached,
            protocol: answer.protocol,
            timing: self.timing,
            referrer: self.referrer.clone(),
        };
        let ending = Ending {
            session: Arc::clone(session),
            about,
            head: head.clone(),
            observer: self.observer.end_of_body(),
        };
        if !has_body {
            ending.run(Ok(0));
            return Ok(Some(Response { head, body: None }));
        }
        *self.controller.body.lock() = Some(Arriving {
            source: answer.body,
            size: 0,
            ending: Some(ending),
        });
        Ok(Some(Response {
            head,
            body: Some(Body::new(Tracked(self.controller.clone()))),
        }))
    }
}

fn parse_status_line(line: &[u8]) -> Option<(u16, &[u8])> {
    let rest = strings::split_once_char(line, b' ')?.1;
    let (status, text) = strings::split_once_char(rest, b' ').unwrap_or((rest, b""));
    Some((bun_core::fmt::parse_unsigned(status, 10).ok()?, text))
}

fn escape_unless_utf8(location: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    if strings::is_valid_utf8(location) {
        return location.into();
    }
    location
        .iter()
        .flat_map(|it| {
            if it.is_ascii() {
                vec![*it]
            } else {
                format!("%{it:02X}").into_bytes()
            }
        })
        .collect()
}

struct Ending {
    session: Arc<Session>,
    about: About,
    head: Head,
    observer: Option<EndOfBody>,
}

impl Ending {
    fn run(self, outcome: Result<u64>) {
        let Head {
            status,
            status_text,
            headers,
            cached,
            ..
        } = &self.head;
        let event = if outcome.is_ok() {
            RequestEvent::Completed
        } else {
            RequestEvent::ErrorOccurred
        };
        self.session.tell(event, &self.about, || Details {
            received: Some(Received {
                status: *status,
                status_text: status_text.clone(),
                headers: headers.clone(),
                cached: *cached,
            }),
            outcome: Some(outcome.map(|_| ())),
            ..Details::default()
        });
        if let Some(observer) = self.observer {
            observer(&self.head, outcome);
        }
    }
}

struct Arriving {
    source: Body,
    size: u64,
    ending: Option<Ending>,
}

impl Drop for Arriving {
    fn drop(&mut self) {
        // The collector may be who drops it.
        if let Some(ending) = self.ending.take() {
            Arc::clone(&ending.session).later(move || ending.run(Err(NetError::Aborted)));
        }
    }
}

/// What it reads is where the controller can drop it.
struct Tracked(Controller);

impl Source for Tracked {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        let Some(mut body) = self.0.body.lock().take() else {
            return Poll::Ready(Err(NetError::Aborted));
        };
        let read = self.0.unless_aborted(cx, |cx| body.source.poll_read(cx));
        match &read {
            Poll::Ready(Ok(Some(chunk))) => body.size += chunk.len() as u64,
            Poll::Ready(end) => {
                if let Some(ending) = body.ending.take() {
                    ending.run(end.as_ref().map(|_| body.size).map_err(|it| *it));
                }
                return read;
            }
            Poll::Pending => {}
        }
        if !self.0.is_aborted() {
            *self.0.body.lock() = Some(body);
        }
        read
    }

    fn expect_read_to_end(&mut self, budget: &'static super::body::Budget) {
        if let Some(body) = &mut *self.0.body.lock() {
            body.source.expect_read_to_end(budget);
        }
    }
}

impl Drop for Tracked {
    fn drop(&mut self) {
        let body = self.0.body.lock().take();
        drop(body);
    }
}

struct Inspected {
    source: Body,
    copy: Vec<u8>,
    session: Arc<Session>,
    about: About,
}

impl Source for Inspected {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        let read = ready!(self.source.poll_read(cx));
        if let Ok(Some(chunk)) = &read {
            self.copy.extend_from_slice(chunk);
        } else if read.is_ok() {
            let (about, copy) = (
                self.about.clone(),
                Chunk::Owned(core::mem::take(&mut self.copy)).into_shared(),
            );
            self.session.notify(move |it| it.keep_body(&about, copy));
        }
        Poll::Ready(read)
    }
}

/// Boxed, so that the crates that await it do not each compile it.
pub fn fetch<'a>(
    session: &'a Arc<Session>,
    initiator: &'a Initiator,
    request: Request,
    observer: &'a dyn Observer,
    controller: &'a Controller,
) -> LocalFuture<'a, core::result::Result<Response, Failure>> {
    Box::pin(run_fetch(session, initiator, request, observer, controller))
}

async fn run_fetch(
    session: &Arc<Session>,
    initiator: &Initiator,
    request: Request,
    observer: &dyn Observer,
    controller: &Controller,
) -> core::result::Result<Response, Failure> {
    let mut fetch = Fetch {
        session,
        initiator,
        observer,
        controller,
        id: next_request_id(),
        urls: Vec::new(),
        referrer: request.referrer.clone(),
        request,
        tainting: ResponseType::Basic,
        has_tainted_origin: false,
        allows_timing: true,
        redirects: Vec::new(),
        timing: Timing {
            start: monotonic_now(),
            ..Timing::default()
        },
        needs_web_engine: false,
    };
    loop {
        match controller.race(fetch.main_fetch()).await {
            Ok(Some(response)) => return Ok(response),
            Ok(None) => {}
            Err(error) => {
                session.tell(RequestEvent::ErrorOccurred, &fetch.about(), || Details {
                    outcome: Some(Err(error)),
                    ..Details::default()
                });
                return Err(Failure {
                    error,
                    needs_web_engine: fetch.needs_web_engine,
                });
            }
        }
    }
}
