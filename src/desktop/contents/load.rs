//! From the wish to go somewhere to the document that is shown.

use std::future::poll_fn;
use std::rc::Rc;
use std::sync::Arc;
use std::task::Poll;

use bun_core::strings;
use bun_web::client::Client;
use bun_web::convert::resolve_blob_url;
use bun_web::encoding::{Decoder, Encoding, MetaScan};
use bun_web::exec::{LocalFuture, Receiver, Sender, never_at_once, oneshot};
use bun_web::headers::HeaderList;
use bun_web::host::{Arrival, Serialized};
use bun_web::mime;
use bun_web::net::NetError;
use bun_web::net::body::{Blob, Body, Data, Source as _};
use bun_web::net::embedder::ClientId;
use bun_web::net::fetch::{self, Controller, IsolationKind, Observer, Role};
use bun_web::net::response::{Head, Response, ResponseType};
use bun_web::net::schemes::may_ask_for_file;
use bun_web::origin::Origin;
use bun_web::referrer::ReferrerPolicy;
use bun_web::request::{
    self, CacheMode, Credentials, Destination, InitiatorType, Mode, RequestBody,
};
use bun_web::service::{Handler, Reserved};
use bun_web::time::monotonic_now;
use bun_web::timing::{NavigationType, ResourceTiming};
use bun_web::trust;
use bun_web::url::Url;

use bun_web::host::Wish;
use bun_web::page::{self, Controls, News as ForElement, Swap};

use super::history::Item;
use super::page::{About, Creator, Page};
use super::{Contents, Kind, Markup, fields, is_web, place, without_hash};
use crate::contents::inspection::{News, Stage};
use crate::prelude::*;
use crate::session;
use crate::session::download::{DownloadItem, Redirects, facts_of};
use crate::text::{before, escape_html, origin_of};
use crate::webview::{engine, guest, remote::Remote};
use crate::{app, task};

const ERROR_PAGE: &str = "chrome-error://chromewebdata/";

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum How {
    Push,
    Replace,
    Reload,
    /// To the entry with that index.
    Traverse(usize),
}

impl How {
    pub(super) fn name(self) -> &'static str {
        match self {
            How::Push => "push",
            How::Replace => "replace",
            How::Reload => "reload",
            How::Traverse(_) => "traverse",
        }
    }

    pub(super) fn swap(self) -> Swap {
        match self {
            How::Push => Swap::Push,
            How::Replace => Swap::Replace,
            How::Reload => Swap::Reload,
            How::Traverse(_) => Swap::Traverse,
        }
    }

    fn navigation_type(self) -> NavigationType {
        match self {
            How::Traverse(_) => NavigationType::BackForward,
            How::Reload => NavigationType::Reload,
            How::Push | How::Replace => NavigationType::Navigate,
        }
    }
}

/// What it takes to load a document again.
#[derive(Clone, Default)]
pub(crate) struct Request {
    pub(crate) body: Option<Arc<[u8]>>,
    pub(crate) headers: HeaderList,
    pub(crate) referrer: Option<String>,
    pub(crate) referrer_policy: ReferrerPolicy,
    srcdoc: Option<String>,
    /// What is left of the initiator.
    creator: Option<Creator>,
    origin: Option<Origin>,
}

impl Request {
    fn forget_body(&mut self) {
        self.body = None;
        self.headers.delete(b"content-type");
    }

    pub(super) fn set_initiator(&mut self, origin: &str) {
        self.origin = Some(Origin::from_serialized(origin.as_bytes()));
    }

    pub(super) fn foreign_initiator(&self, url: &str) -> Option<String> {
        let origin = string(self.origin.as_ref()?.as_bytes());
        (origin != origin_of(url)).then_some(origin)
    }

    /// The document has given itself another URL.
    pub(super) fn pass_to(&mut self, page: &Page) {
        self.forget_body();
        self.origin = self.origin.take().map(|_| page.client.origin());
    }
}

#[derive(Clone)]
pub(super) enum Initiator {
    Page(Rc<Root<Page>>),
    /// A frame in the web engine.
    Guest {
        frame: Rc<bun_jsc::Strong>,
        origin: String,
    },
}

impl Initiator {
    pub(super) fn of(page: &Page) -> Initiator {
        Initiator::Page(Rc::new(Root::new(page)))
    }

    pub(super) fn of_guest(frame: JSValue) -> JsResult<Initiator> {
        Ok(Initiator::Guest {
            frame: Rc::new(keep(frame)),
            origin: guest::origin_of_frame(frame)?,
        })
    }

    fn page(&self) -> Option<&'static Page> {
        match self {
            Initiator::Page(page) => Some(page.get()),
            Initiator::Guest { .. } => None,
        }
    }

    fn frame(&self) -> JSValue {
        match self {
            Initiator::Page(page) => page.get().handle(),
            Initiator::Guest { frame, .. } => frame.get(),
        }
    }

    fn origin(&self) -> String {
        match self {
            Initiator::Page(page) => page.get().origin(),
            Initiator::Guest { origin, .. } => origin.clone(),
        }
    }

    fn may_download(&self) -> bool {
        self.page().is_none_or(|it| !it.forbids("allow-downloads"))
    }
}

pub(super) struct Navigation {
    pub(super) how: How,
    pub(super) initiator: Option<Initiator>,
    pub(super) request: Rc<Request>,
    pub(super) user_agent: Option<String>,
    pub(super) is_form: bool,
    pub(super) is_by_user: bool,
    pub(super) has_text_activation: bool,
    /// The document has been asked.
    pub(super) may_unload: bool,
    /// The app has been told.
    pub(super) is_announced: bool,
    /// A reload that does not take over what the history has.
    pub(super) starts_over: bool,
    pub(super) wants_web_engine: bool,
    pub(super) base_of_data: Option<String>,
    pub(super) blob: Option<Blob>,
    pub(super) state: Option<Serialized>,
    /// What a `javascript:` URL has evaluated to.
    pub(super) markup: Option<String>,
    pub(super) started: f64,
}

impl Navigation {
    pub(super) fn new(how: How) -> Navigation {
        Navigation {
            how,
            initiator: None,
            request: Rc::default(),
            user_agent: None,
            is_form: false,
            is_by_user: false,
            has_text_activation: false,
            may_unload: false,
            is_announced: false,
            starts_over: false,
            wants_web_engine: false,
            base_of_data: None,
            blob: None,
            state: None,
            markup: None,
            started: monotonic_now(),
        }
    }

    fn frame_of_initiator(&self) -> JSValue {
        self.initiator
            .as_ref()
            .map_or(JSValue::UNDEFINED, Initiator::frame)
    }

    fn initiating_page(&self) -> Option<&'static Page> {
        self.initiator.as_ref()?.page()
    }

    fn origin(&self) -> Option<Origin> {
        let of = |it: &Initiator| match it.page() {
            Some(page) => page.client.origin(),
            None => Origin::from_serialized(it.origin().as_bytes()),
        };
        let (own, kept) = (self.initiator.as_ref().map(of), self.request.origin.clone());
        match self.how {
            How::Traverse(_) => kept.or(own),
            _ => own.or(kept),
        }
    }

    /// The request becomes the last one that was sent.
    fn follow(&mut self, first: &str, pending: &Pending) {
        let origin = self.origin();
        let request = Rc::make_mut(&mut self.request);
        request.origin = origin;
        if pending.has_lost_body.get() {
            request.forget_body();
        }
        if origin_of(first) != origin_of(&pending.url.borrow()) {
            request.headers.delete(b"authorization");
            request.headers.delete(b"cookie");
        }
    }
}

struct Pending {
    controller: Controller,
    url: RefCell<String>,
    has_lost_body: Cell<bool>,
    is_led_by_stranger: Cell<bool>,
    is_traversal: bool,
    is_by_app: bool,
}

/// Of `loadURL()`.
struct Promised {
    result: Deferred,
    url: String,
    /// What the error page is shown for.
    error: Option<NetError>,
}

#[derive(Clone, Copy, Default, PartialEq)]
enum Cause {
    #[default]
    Navigation,
    JavaScriptUrl,
    DocumentOpen,
}

#[derive(Default)]
pub(super) struct Loading {
    pending: RefCell<Option<Rc<Pending>>>,
    is_on: Cell<bool>,
    cause: Cell<Cause>,
    /// Navigations that have no request, or not yet.
    beginnings: Cell<u32>,
    in_guest: Cell<Option<i32>>,
    /// The guest is about to say what has been said.
    guest_repeats_start: Cell<bool>,
    /// What the app knows of this and of its frames.
    is_reported: Cell<bool>,
    /// For the one that is shown to be complete.
    awaits_document: Cell<bool>,
    fires_load: Cell<bool>,
    promise: RefCell<Option<Promised>>,
    wishes: Cell<u32>,
    has_wish: Cell<bool>,
    /// Service workers that wait for the document after that of a client.
    awaited: RefCell<Vec<(ClientId, Sender<Option<ClientId>>)>>,
    /// A document of an origin that the app serves, which the app does not have.
    not_served: RefCell<String>,
}

impl Loading {
    pub(super) fn is_reported(&self) -> bool {
        self.is_reported.get()
    }

    pub(super) fn is_pending(&self) -> bool {
        self.pending.borrow().is_some()
    }

    pub(super) fn is_pending_or_wished(&self) -> bool {
        self.is_pending() || self.has_wish.get()
    }

    pub(super) fn is_traversing(&self) -> bool {
        self.pending
            .borrow()
            .as_ref()
            .is_some_and(|it| it.is_traversal)
    }

    fn waits_for(&self, pending: &Rc<Pending>) -> bool {
        self.pending
            .borrow()
            .as_ref()
            .is_some_and(|it| Rc::ptr_eq(it, pending))
    }

    fn forget_wish(&self) -> u32 {
        self.has_wish.set(false);
        self.wishes.update(|it| it + 1);
        self.wishes.get()
    }
}

/// What a document came with.
#[derive(Default)]
pub(super) struct Loaded {
    pub(super) url: String,
    pub(super) status: u16,
    status_text: String,
    pub(super) headers: HeaderList,
    referrer: Option<String>,
    has_crossed_origins: bool,
    /// By a redirect.
    pub(super) is_led_by_stranger: bool,
    /// By a service worker.
    is_made_in_page_process: bool,
    pub(super) encoding: Cell<Option<Encoding>>,
    pub(super) essence: Option<String>,
    pub(super) required_csp: Option<String>,
    pub(super) started: f64,
    pub(super) timing: Option<(ResourceTiming, NavigationType)>,
    pub(super) text_directives: Option<String>,
    pub(super) has_text_activation: bool,
    pub(super) reserved: Cell<Option<Reserved>>,
    /// What an error page is shown for.
    pub(super) unreachable: Option<(String, NetError)>,
}

impl Loaded {
    fn new(url: String) -> Loaded {
        Loaded {
            url,
            status: 200,
            ..Default::default()
        }
    }
}

#[derive(Default)]
struct Source {
    text: String,
    xml_type: Option<String>,
    rest: Option<Rest>,
}

/// What a server has not sent yet.
struct Rest {
    body: Body,
    decoder: Decoder,
    undecided: Option<Undecided>,
    controller: Controller,
    size: u64,
    head: Head,
    how: NavigationType,
    for_parent: Option<Timed>,
}

/// While a `<meta>` may still say how to read what has come.
struct Undecided {
    all: Vec<u8>,
    /// The page has had the ASCII that it starts with.
    given: usize,
    scan: MetaScan,
}

/// The load of a frame, as a resource of the document around it.
struct Timed {
    parent: Rc<Client>,
    name: String,
    initiator: InitiatorType,
    head: Head,
}

impl Timed {
    fn record(self, size: u64) {
        let name = self.name.as_bytes();
        let record = ResourceTiming::of_response(name, self.initiator, &self.head, size);
        self.parent.record_timing(record);
    }
}

/// How much is the same in every encoding that a `<meta>` can ask for.
fn plain_len(bytes: &[u8]) -> usize {
    (bytes.iter())
        .position(|it| !it.is_ascii() || matches!(it, 0 | 0x0e | 0x0f | 0x1b))
        .unwrap_or(bytes.len())
}

impl Rest {
    fn decode(&mut self, page: &Page, more: &[u8], is_last: bool) -> JsResult<String> {
        let Some(Undecided { all, given, scan }) = &mut self.undecided else {
            return Ok(self.decoder.decode(more, is_last));
        };
        all.extend_from_slice(more);
        let new = &all[*given..];
        if !is_last && all.len() < MOST_AT_ONCE && !scan.is_settled_by(all) {
            let plain = &new[..plain_len(new)];
            *given += plain.len();
            return Ok(self.decoder.decode(plain, false));
        }
        if let Some(declared) = Encoding::declared_in_html(all) {
            self.decoder = declared.decoder_of_rest();
            page.loaded()
                .iter()
                .for_each(|it| it.encoding.set(Some(declared)));
            page.tell(|it| it.set_encoding(declared.name().to_ascii_lowercase()))?;
        }
        let text = self.decoder.decode(new, is_last);
        self.undecided = None;
        Ok(text)
    }

    async fn give_to(mut self, page: Root<Page>) -> JsResult<()> {
        let failure = loop {
            match never_at_once(self.body.read()).await {
                _ if page.get().is_disposed() => return Ok(()),
                Ok(Some(more)) => {
                    self.size += more.len() as u64;
                    let text = self.decode(page.get(), &more, false)?;
                    let wants_more = page
                        .get()
                        .ask_later(|it, reply| it.append_html(text, reply));
                    if !wants_more.await? {
                        return Ok(());
                    }
                }
                Ok(None) => break None,
                Err(error) => break Some(error),
            }
        };
        let page = page.get();
        let last = self.decode(page, &[], true)?;
        let url = self.head.url.href();
        page.client.set_navigation_timing(
            ResourceTiming::of_response(url, InitiatorType::Navigation, &self.head, self.size),
            self.how,
        );
        self.for_parent
            .into_iter()
            .for_each(|it| it.record(self.size));
        if let Some(error) = failure.filter(|it| *it != NetError::Aborted) {
            let (contents, url) = (page.contents(), string(url));
            let promise = contents.loading.promise.take();
            contents.announce_failure("did-fail-load", &url, error)?;
            promise.map_or(Ok(()), |it| it.fail(error))?;
        }
        page.tell(|it| it.append_html(last, |_, _| {}))?;
        page.tell(|it| it.end_html(failure.is_none()))
    }
}

const MOST_AT_ONCE: usize = 4 << 20;

/// What it takes to choose a decoder, and what is there besides.
async fn read_start(
    mut body: Body,
    has_charset: bool,
    scan: &mut MetaScan,
) -> Result<(Vec<u8>, Option<Body>), NetError> {
    let (mut bytes, mut is_settled, mut is_enough) = (Vec::new(), has_charset, false);
    let mut plain = 0;
    while bytes.len() < MOST_AT_ONCE {
        let read = poll_fn(|cx| match body.poll_read(cx) {
            Poll::Pending if !is_enough => Poll::Pending,
            read => Poll::Ready(read),
        });
        match read.await {
            Poll::Pending => break,
            Poll::Ready(read) => match read? {
                Some(more) if bytes.is_empty() => bytes = more.into_vec(),
                Some(more) => bytes.extend_from_slice(&more),
                None => return Ok((bytes, None)),
            },
        }
        is_settled =
            is_settled || Encoding::for_bom(&bytes).is_some() || scan.is_settled_by(&bytes);
        if !is_settled {
            plain += plain_len(&bytes[plain..]);
        }
        is_enough = bytes.len() >= 3 && (is_settled || plain == bytes.len());
    }
    Ok((bytes, Some(body)))
}

enum Failure {
    Error(NetError),
    NeedsWebEngine,
    /// Which does not know the URL, and gets this one.
    NeedsWebEngineFor(String),
    /// The response is not something to show.
    NoDocument,
    Thrown(bun_jsc::JsError),
}

impl From<bun_jsc::JsError> for Failure {
    fn from(error: bun_jsc::JsError) -> Failure {
        Failure::Thrown(error)
    }
}

impl From<NetError> for Failure {
    fn from(error: NetError) -> Failure {
        Failure::Error(error)
    }
}

struct Watcher<'a> {
    contents: &'a Root<Contents>,
    navigation: &'a Navigation,
    pending: &'a Pending,
    parent: Option<Rc<Client>>,
    refusal: Cell<Option<Failure>>,
}

impl Watcher<'_> {
    fn follows(&self, url: &str) -> Result<bool, Failure> {
        let (contents, initiator) = (self.contents.get(), self.navigation.frame_of_initiator());
        if !contents.dispatch_navigation("will-redirect", url, false, initiator)? {
            return Ok(false);
        }
        let from = self.pending.url.replace(url.to_owned());
        if !holds(&from, trust::is_excepted) && !contents.is_trusted(&from)? {
            self.pending.is_led_by_stranger.set(true);
        }
        contents.may_show(url)?;
        contents.dispatch_navigation("did-redirect-navigation", url, false, initiator)?;
        Ok(true)
    }
}

impl Observer for Watcher<'_> {
    fn will_check(&self, request: &request::Request, first: Option<&Url>) {
        (self.parent.iter()).for_each(|it| it.report_request(request, first));
    }

    fn allows(&self, request: &request::Request, first: Option<&Url>) -> bool {
        let allows_form = |page: &Page| {
            let verdict = page
                .client
                .policies()
                .csp
                .check_form_action(&request.url, first);
            page.client.enforce(verdict, JSValue::UNDEFINED)
        };
        let form_owner = self
            .navigation
            .initiating_page()
            .filter(|_| self.navigation.is_form && first.is_some());
        form_owner.is_none_or(allows_form)
            && (self.parent.as_ref()).is_none_or(|it| it.allows_request(request, first))
    }

    fn accepts(&self, request: &request::Request, _: Option<&Url>) -> bool {
        (self.contents.get().may_show(&string(request.url.href()))).is_ok()
    }

    fn leads_to_page_process(&self, url: &Url) -> Option<bool> {
        let is_led_by_stranger = self.pending.is_led_by_stranger.get()
            || (self.navigation.initiating_page()).is_some_and(|it| !it.place().is_trusted());
        task::or_warning(self.contents.get().will_be_apart(url, is_led_by_stranger))?
    }

    fn blocked_as_mixed_content(&self, request: &request::Request, first: Option<&Url>) {
        (self.parent.iter()).for_each(|it| it.report_mixed_content(first.unwrap_or(&request.url)));
    }

    fn violated(
        &self,
        kind: IsolationKind,
        request: &request::Request,
        first: &Url,
        is_enforced: bool,
    ) {
        if let Some(parent) = &self.parent {
            parent.report_corp_violation(kind, b"corp", request.destination, first, is_enforced);
        }
    }

    fn follows<'a>(
        &'a self,
        _: u16,
        method: &'a [u8],
        target: &'a Url,
        _: &'a HeaderList,
    ) -> LocalFuture<'a, bool> {
        self.pending.has_lost_body.set(method == b"GET");
        let follows = Watcher::follows(self, &string(target.href())).unwrap_or_else(|refusal| {
            match refusal {
                Failure::Thrown(error) => task::report(Err(error)),
                refusal => self.refusal.set(Some(refusal)),
            }
            false
        });
        Box::pin(core::future::ready(follows))
    }
}

fn reject(promise: Option<Deferred>, code: &str, number: i32, url: &str) -> JsResult<()> {
    let Some(promise) = promise else {
        return Ok(());
    };
    let failure = global().create_error_instance(format_args!("{code} ({number}) loading '{url}'"));
    failure.put(global(), b"errno", number.into());
    failure.put(global(), b"code", js(code)?);
    failure.put(global(), b"url", js(url)?);
    promise.settle(Err(global().throw_value(failure)))
}

impl Promised {
    fn fail(self, otherwise: NetError) -> JsResult<()> {
        let error = self.error.unwrap_or(otherwise);
        reject(Some(self.result), error.code(), error as i32, &self.url)
    }

    fn settle(self) -> JsResult<()> {
        match self.error {
            Some(error) => self.fail(error),
            None => self.result.resolve(JSValue::UNDEFINED),
        }
    }
}

pub(crate) fn can_evaluate() -> JsResult<bool> {
    Ok(catch(invoke(global().to_js_value(), "eval", &[js("true")?]))?.is_ok())
}

fn holds(url: &str, condition: impl FnOnce(&Url) -> bool) -> bool {
    Url::parse(url.as_bytes()).is_some_and(|it| condition(&it))
}

pub(super) fn is_trusted_in_frame(url: &str) -> JsResult<bool> {
    let directory = app::path()?;
    Ok(holds(url, |it| {
        trust::is_trusted_in_frame(it, directory.as_bytes())
    }))
}

fn can_be_shown(essence: &str) -> bool {
    let kinds = [
        "text/",
        "image/",
        "application/xhtml",
        "application/xml",
        "application/json",
        "application/javascript",
    ];
    kinds.iter().any(|it| essence.starts_with(it))
}

impl Contents {
    /// What a page asks for.
    pub(super) fn wish(
        &self,
        page: &Page,
        it: Wish,
        initiator: Initiator,
        given_referrer: Option<String>,
    ) -> JsResult<()> {
        let (url, markup, srcdoc) = (&*it.url, it.markup, it.srcdoc);
        let (body, content_type) = it.post.map(|it| (it.body, it.content_type)).unzip();
        let is_by = |holds: &dyn Fn(&Page) -> bool| initiator.page().is_some_and(holds);
        let may_write =
            || without_hash(url) == without_hash(&page.url()) && is_by(&|it| it.is_kin_of(page));
        let may_embed = || {
            url == "about:srcdoc"
                && is_by(&|it| page.parent().is_some_and(|parent| same(parent, it)))
        };
        let is_of_form = |it: &str| {
            matches!(
                before(it, ";"),
                "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain"
            )
        };
        if (markup.is_some() && !may_write())
            || (srcdoc.is_some() && !may_embed())
            || !content_type.as_deref().is_none_or(is_of_form)
        {
            return Ok(());
        }
        let origin = initiator.origin();
        let download = it.download.filter(|_| {
            url.starts_with("blob:")
                || url.starts_with("data:")
                || (origin != "null" && origin_of(url) == origin)
        });
        if download.is_some() && !initiator.may_download() {
            return Ok(());
        }
        let mut headers = HeaderList::default();
        content_type
            .into_iter()
            .for_each(|it| headers.append(b"content-type", it.as_bytes()));
        let referrer = || {
            initiator
                .page()?
                .client
                .referrer_source()
                .map(|it| string(it.href()))
        };

        let request = Request {
            body,
            headers,
            referrer: given_referrer.or_else(referrer),
            referrer_policy: (it.referrer_policy)
                .and_then(|it| ReferrerPolicy::parse(it.as_bytes()))
                .or_else(|| Some(initiator.page()?.client.policies().referrer_policy))
                .unwrap_or_default(),
            srcdoc,
            creator: None,
            origin: None,
        };
        let navigation = Navigation {
            request: request.into(),
            may_unload: it.may_unload || markup.is_some(),
            is_form: it.source == bun_web::host::Source::Form,
            is_by_user: it.is_by_user || it.has_activation,
            has_text_activation: it.has_text_activation,
            blob: (Url::parse(url.as_bytes()).filter(|it| it.scheme() == b"blob")).and_then(
                |url| {
                    let is_own = Origin::of(&url).as_bytes() == origin.as_bytes();
                    resolve_blob_url(&url).or_else(|| it.blob.filter(|_| is_own))
                },
            ),
            state: it.navigation_state,
            markup,
            initiator: Some(initiator),
            ..Navigation::new(if it.replaces { How::Replace } else { How::Push })
        };
        if let Some(name) = download {
            return self.download(page, url, navigation, name);
        }
        let (wish, page, url) = (self.loading.forget_wish(), Root::new(page), url.to_owned());
        self.loading.has_wish.set(true);
        self.tell_element(ForElement::Navigating)?;
        self.tell_element(ForElement::Loading)?;
        self.after_script(move |it| {
            (it.loading.has_wish).update(|has| has && wish != it.loading.wishes.get());
            let is_of_survivor = navigation
                .initiating_page()
                .is_some_and(|it| !it.is_disposed());
            let page = match it.has_crashed() && is_of_survivor {
                true => it.page(),
                false => page.get(),
            };
            if !page.is_disposed()
                && wish == it.loading.wishes.get()
                && !it.loading.is_traversing()
                && !it.ignores(navigation.initiating_page())
            {
                it.grant(page, &url, navigation)?;
            }
            match it.loading.is_on.get() || wish != it.loading.wishes.get() {
                true => Ok(()),
                false => it.tell_element(ForElement::Finished { fires_load: false }),
            }
        });
        Ok(())
    }

    /// A redirect to another origin makes it a navigation.
    fn download(
        &self,
        page: &Page,
        url: &str,
        navigation: Navigation,
        name: String,
    ) -> JsResult<()> {
        let Some(parsed) = Url::parse(url.as_bytes()) else {
            return Ok(());
        };
        let (mut request, mut initiator) = self.prepare(parsed, &navigation, None)?;
        request.destination = Destination::Empty;
        initiator.service = Handler::Nobody;
        let (this, page) = (Root::new(self), Root::new(page));
        let (redirects, controller) = (Redirects::within_origin(url), Controller::default());
        task::spawn(async move {
            let session = Arc::clone(&page.get().client.session);
            let loaded = fetch::fetch(&session, &initiator, request, &redirects, &controller).await;
            let (it, mut urls) = (this.get(), redirects.urls.take());
            task::report(match (loaded, urls.last()) {
                (Ok(loaded), _) => {
                    let name = Some(&*name).filter(|it| !it.is_empty());
                    it.save(urls, loaded, name, &navigation, controller)
                }
                (Err(_), Some(last))
                    if origin_of(last) != origin_of(&urls[0]) && !page.get().is_disposed() =>
                {
                    it.grant(page.get(), &urls.pop().unwrap_or_default(), navigation)
                }
                _ => Ok(()),
            });
        });
        Ok(())
    }

    fn save(
        &self,
        urls: Vec<String>,
        loaded: Response,
        name: Option<&str>,
        navigation: &Navigation,
        controller: Controller,
    ) -> JsResult<()> {
        let facts = facts_of(urls, &loaded.head.headers, name)
            .with("hasUserGesture", navigation.is_by_user)
            .with(
                "getInitiatorOrigin",
                navigation.origin().map(|it| string(it.as_bytes())),
            );
        let frame = match navigation.initiating_page().is_some_and(Page::is_disposed) {
            true => JSValue::NULL,
            false => navigation.frame_of_initiator(),
        };
        let (body, owner) = (loaded.body.unwrap_or_default(), self.owner().to_js());
        DownloadItem::save_loaded(self.session, facts, body, [owner, frame], controller)
    }

    fn grant(&self, page: &Page, url: &str, navigation: Navigation) -> JsResult<()> {
        let (scheme, origin) = (
            before(url, ":"),
            navigation
                .initiator
                .as_ref()
                .map(Initiator::origin)
                .unwrap_or_default(),
        );
        let is_in_reach = || {
            origin == "file://"
                && Url::parse(url.as_bytes()).is_none_or(|it| may_ask_for_file(&it, false))
        };
        if (scheme == "data" && !self.is_frame()) || (scheme == "file" && !is_in_reach()) {
            page.tell(Controls::abort_navigation)?;
            return page.log_error(&format!(
                "Not allowed to navigate top frame to {scheme} URL"
            ));
        }
        if scheme == "javascript" {
            return page.tell(Controls::abort_navigation);
        }
        if navigation.markup.is_some() {
            return self.load(url, navigation, None);
        }
        let restores = |it: &Page| it.is_from_history.get() && !it.is_loaded.get();
        let is_restored = |it: &Item| {
            page.is_initial()
                && self.is_frame()
                && !it.borrow().is_of(page)
                && restores(self.embedder())
        };
        if let Some(restored) = self.item().filter(is_restored) {
            let (url, request) = (
                restored.borrow().url.clone(),
                Rc::clone(&restored.borrow().request),
            );
            let how = How::Traverse(self.history().borrow().index);
            let navigation = Navigation {
                request,
                initiator: navigation.initiator,
                ..Navigation::new(how)
            };
            return self.load_for_page(&url, navigation);
        }
        if matches!(
            scheme,
            "http" | "https" | "file" | "about" | "data" | "blob"
        ) || self.session.handles(scheme)
        {
            return self.load_for_page(url, navigation);
        }
        let mut navigation = navigation;
        self.while_beginning(
            &mut || match self.announce_start(url, &mut navigation, true)? {
                true => self.open_external(page, url, &navigation),
                false => page.tell(Controls::abort_navigation),
            },
        )
    }

    /// If the app lets it.
    pub(super) fn load_for_page(&self, url: &str, navigation: Navigation) -> JsResult<()> {
        let mut navigation = Some(navigation);
        self.while_beginning(&mut || {
            let Some(mut navigation) = navigation.take() else {
                return Ok(());
            };
            let wish = self.loading.wishes.get();
            if self.announce_start(url, &mut navigation, true)? && wish == self.loading.wishes.get()
            {
                return self.load(url, navigation, None);
            }
            self.forget_aim();
            self.page().tell(Controls::abort_navigation)
        })
    }

    pub(super) fn navigate_for_service_worker(
        &self,
        page: &Page,
        url: &str,
    ) -> JsResult<Receiver<Option<ClientId>>> {
        let (sender, next) = oneshot();
        let navigation = Navigation {
            initiator: Some(Initiator::of(page)),
            ..Navigation::new(How::Push)
        };
        self.grant(page, url, navigation)?;
        if self.loading.is_pending() {
            (self.loading.awaited.borrow_mut()).push((page.client.id, sender));
        }
        Ok(next)
    }

    pub(super) fn while_beginning(&self, work: &mut dyn FnMut() -> JsResult<()>) -> JsResult<()> {
        self.loading.beginnings.update(|it| it + 1);
        let result = self.report_loading().and_then(|()| work());
        self.loading.beginnings.update(|it| it - 1);
        result.and_then(|()| self.report_loading())
    }

    /// False if a listener has prevented it.
    fn announce_start(
        &self,
        url: &str,
        navigation: &mut Navigation,
        is_by_page: bool,
    ) -> JsResult<bool> {
        let initiator = match (&navigation.initiator, is_by_page) {
            (None, true) => self.page().handle(),
            _ => navigation.frame_of_initiator(),
        };
        navigation.is_announced = true;
        self.dispatch_navigation("did-start-navigation", url, false, initiator)?;
        Ok(!is_by_page || url.starts_with("about:") || self.may_navigate(url, initiator)?)
    }

    fn may_navigate(&self, url: &str, initiator: JSValue) -> JsResult<bool> {
        Ok(
            self.dispatch_navigation("will-frame-navigate", url, false, initiator)?
                && (self.is_frame()
                    || self.dispatch_navigation("will-navigate", url, false, initiator)?),
        )
    }

    /// What the app loads comes before what a script asks for by itself.
    pub(super) fn ignores(&self, initiator: Option<&Page>) -> bool {
        let is_by_app = (self.loading.pending.borrow().as_ref()).is_some_and(|it| it.is_by_app);
        match initiator.filter(|_| is_by_app) {
            Some(page) => !page.has_activation(),
            None => is_by_app,
        }
    }

    pub(super) fn cancel_navigation(&self) -> JsResult<()> {
        self.loading.forget_wish();
        if self.loading.is_traversing() || self.ignores(Some(self.page())) {
            return Ok(());
        }
        if self.loading.is_pending() {
            self.after_script(Contents::rest);
        }
        self.cancel_pending()
    }

    /// Unless there is something left to wait for.
    pub(super) fn rest(&self) -> JsResult<()> {
        let is_done = !self.loading.awaits_document.get() || !self.page().is_started();
        if is_done && !self.loading.is_pending() && self.loading.cause.get() != Cause::DocumentOpen
        {
            self.set_loading(false)
        } else {
            self.report_loading()
        }
    }

    /// The next document.
    pub(super) fn stop_loading(&self) -> JsResult<()> {
        self.loading.forget_wish();
        self.page().stop_streaming();
        self.cancel_pending()?;
        self.after_script(Contents::rest);
        Ok(())
    }

    /// The next document and this one.
    pub(super) fn stop_everything(&self) -> JsResult<()> {
        match self.page().is_started() {
            true => self.page().tell(Controls::stop),
            false => self.stop_loading(),
        }
    }

    pub(super) fn reload_page(&self, is_by_page: bool) -> JsResult<()> {
        let crashed_at = self.crashed_at.borrow().clone();
        if self.page().is_initial() && crashed_at.is_none() {
            return Ok(());
        }
        let mut request = self.request_to_repeat();
        if is_by_page {
            let (request, client) = (Rc::make_mut(&mut request), &self.page().client);
            request.referrer = client.referrer_source().map(|it| string(it.href()));
            request.referrer_policy = client.policies().referrer_policy;
            request.origin = Some(client.origin());
        }
        let navigation = Navigation {
            request,
            may_unload: is_by_page,
            starts_over: self.page().unreachable_url().is_some(),
            ..Navigation::new(How::Reload)
        };
        let url = crashed_at.unwrap_or_else(|| self.page().url_in_history());
        match is_by_page {
            true => self.load_for_page(&url, navigation),
            false => self.load(&url, navigation, None),
        }
    }

    /// From the web engine. False if it is not for here.
    pub(crate) fn take_over(
        &self,
        url: String,
        frame: JSValue,
        origin: String,
        how: How,
    ) -> JsResult<bool> {
        if !self.has_shown_trusted.get() || !self.is_trusted(&url)? {
            return Ok(false);
        }
        let navigation = Navigation {
            initiator: Some(Initiator::Guest {
                frame: Rc::new(keep(frame)),
                origin,
            }),
            ..Navigation::new(how)
        };
        let (this, guest, cookies) = (
            Root::new(self),
            self.guest().map(Remote::id),
            self.guest().map(Remote::fetch_cookies),
        );
        task::spawn(async move {
            let has_cookies = match cookies {
                Some(cookies) => cookies.await.is_ok(),
                None => true,
            };
            if has_cookies
                && this.get().guest().map(Remote::id) == guest
                && !this.get().loading.is_pending()
            {
                task::report(this.get().load(&url, navigation, None));
            }
        });
        Ok(true)
    }

    fn switch_loading(&self, is_on: bool) -> JsResult<()> {
        if self.loading.is_on.replace(is_on) == is_on {
            return Ok(());
        }
        let fires_load = self.loading.fires_load.take();
        match is_on {
            true => self.tell_element(ForElement::Loading),
            false => self.tell_element(ForElement::Finished { fires_load }),
        }
    }

    pub(super) fn set_loading(&self, is_on: bool) -> JsResult<()> {
        if !is_on {
            let shows_error = (self.page().loaded()).is_some_and(|it| it.unreachable.is_some());
            for (before, sender) in self.loading.awaited.take() {
                sender.send(Some(self.page().client.id).filter(|it| *it != before && !shows_error));
            }
        }
        self.switch_loading(is_on)?;
        self.report_loading()
    }

    /// Not counting its frames.
    pub(super) fn is_busy(&self) -> bool {
        let it = &self.loading;
        let mut guests = [self.guest(), fields::pending_guest(self.itself())]
            .into_iter()
            .flatten();
        (it.is_on.get() && it.cause.get() == Cause::Navigation)
            || it.beginnings.get() > 0
            || guests.any(|guest| it.in_guest.get() == Some(guest.id()))
    }

    pub(crate) fn report_loading(&self) -> JsResult<()> {
        let owner = self.owner();
        let is_on = super::alive().any(|it| same(it.owner(), owner) && it.is_busy());
        if owner.is_destroyed.get() || owner.loading.is_reported.replace(is_on) == is_on {
            return Ok(());
        }
        if is_on {
            if owner.loading.in_guest.get().is_none() {
                owner.announce_frame()?;
            }
            return owner.emit("did-start-loading", &[]);
        }
        let promise = owner.loading.promise.take();
        owner.emit("did-stop-loading", &[])?;
        promise.map_or(Ok(()), |it| it.fail(NetError::Failed))
    }

    pub(crate) fn guest_is_loading(&self, guest: &Remote, is_on: bool) -> JsResult<()> {
        if is_on || self.loading.in_guest.get() == Some(guest.id()) {
            self.loading.in_guest.set(is_on.then(|| guest.id()));
        }
        self.report_loading()
    }

    pub(crate) fn has_announced_start(&self) -> bool {
        self.loading.guest_repeats_start.take()
    }

    pub(super) fn announce_frame(&self) -> JsResult<()> {
        match self.page().introduce() {
            Some(frame) => self.announce("frame-created", &[object!({ "frame": frame })]),
            None => Ok(()),
        }
    }

    /// For a frame that stays with the empty document.
    pub(super) fn announce_empty_document(&self) -> JsResult<()> {
        let page = self.page();
        self.while_beginning(&mut || {
            self.dispatch_navigation(
                "did-start-navigation",
                &page.url(),
                false,
                self.embedder().handle(),
            )?;
            self.announce_for_frame(
                "did-frame-navigate",
                page,
                &[js(page.url())?, (-1).into(), js("")?],
            )?;
            self.announce_for_frame("did-frame-finish-load", page, &[])
        })
    }

    pub(super) fn document_opened(&self) -> JsResult<()> {
        if !self.loading.is_on.get() || self.page().is_loaded.get() {
            self.loading.cause.set(Cause::DocumentOpen);
        }
        self.switch_loading(true)
    }

    pub(super) fn reached(&self, page: &Page, stage: bun_web::host::Stage) -> JsResult<()> {
        let is_only_parsed = stage == bun_web::host::Stage::Parsed;
        self.notify(News::Reached(match is_only_parsed {
            true => Stage::Interactive,
            false => Stage::Complete,
        }))?;
        page.is_loaded.update(|it| it || !is_only_parsed);
        page.later(move |page| {
            let it = page.contents();
            if is_only_parsed {
                emit(page.handle(), "dom-ready", &[])?;
                return it.emit("dom-ready", &[]);
            }
            it.loading.awaits_document.set(false);
            if it.loading.is_pending() {
                return Ok(());
            }
            let (is_complete, is_news) = (
                stage == bun_web::host::Stage::Loaded,
                it.loading.cause.get() != Cause::DocumentOpen,
            );
            it.loading.fires_load.set(is_complete);
            let promise = it.loading.promise.take();
            match (is_news, is_complete) {
                (true, true) => {
                    it.announce_for_frame("did-frame-finish-load", page, &[])?;
                    it.emit("did-finish-load", &[])?;
                }
                (true, false) => it.announce_interruption(page)?,
                (false, _) => {}
            }
            let finish = |page: &'static Page| match page.contents().loading.is_pending() {
                true => Ok(()),
                false => page.contents().set_loading(false),
            };
            if it.is_frame() {
                finish(page)?;
            } else {
                page.later(finish);
            }
            match promise {
                Some(it) if is_complete => it.settle(),
                it => reject(
                    it.map(|it| it.result),
                    "",
                    NetError::Aborted as i32,
                    &page.url(),
                ),
            }
        });
        Ok(())
    }

    fn announce_interruption(&self, page: &Page) -> JsResult<()> {
        let about = [(NetError::Aborted as i32).into(), js("")?, js(page.url())?];
        self.announce_for_frame("did-fail-load", page, &about)
    }

    fn can_fall_back(&self) -> bool {
        self.embedded.as_ref().is_some_and(|it| it.kind == "object") && self.page().is_initial()
    }

    fn announce_failure(&self, name: &str, url: &str, error: NetError) -> JsResult<()> {
        let about = [(error as i32).into(), js(error.code())?, js(url)?];
        self.announce_for_frame(name, self.page(), &about)
    }

    fn show_error(&self, url: &str, error: NetError, mut navigation: Navigation) -> JsResult<()> {
        Rc::make_mut(&mut navigation.request).creator = None;
        (navigation.initiator, navigation.markup) = (None, None);
        let loaded = Loaded {
            unreachable: Some((url.to_owned(), error)),
            ..Loaded::new(ERROR_PAGE.to_owned())
        };
        self.commit(loaded, navigation, None)
    }

    /// Before anything has started.
    fn refuse(&self, url: &str, error: NetError, promise: Option<Deferred>) {
        let (url, was_busy) = (url.to_owned(), self.loading.beginnings.get().min(1));
        self.loading.beginnings.update(|it| it + was_busy);
        self.later(move |it| {
            it.later(move |it| {
                it.loading.beginnings.update(|it| it - was_busy);
                it.rest()
            });
            if promise.is_some() {
                it.announce_failure("did-fail-load", &url, error)?;
            }
            reject(promise, error.code(), error as i32, &url)
        });
    }

    /// False if the document stays.
    fn leaves(&self, url: &str, navigation: &mut Navigation) -> JsResult<bool> {
        if !navigation.may_unload && !self.may_unload(false)? {
            let promise = self.loading.promise.take();
            self.refuse(url, NetError::Aborted, promise.map(|it| it.result));
            return Ok(false);
        }
        (navigation.may_unload, navigation.started) = (true, monotonic_now());
        Ok(true)
    }

    pub(super) fn give_up_promise(&self) -> JsResult<()> {
        let promise = self.loading.promise.take();
        promise.map_or(Ok(()), |it| it.fail(NetError::Failed))
    }

    pub(super) fn cancel_pending(&self) -> JsResult<()> {
        let guest = fields::pending_guest(self.itself());
        fields::set_pending_guest(self, None);
        guest
            .filter(|it| self.guest().is_none_or(|shown| !same(shown, it)))
            .map_or(Ok(()), Remote::end)?;
        let Some(pending) = self.loading.pending.take() else {
            return Ok(());
        };
        pending.controller.abort();
        Ok(())
    }

    pub(super) fn load(
        &self,
        url: &str,
        navigation: Navigation,
        promise: Option<Deferred>,
    ) -> JsResult<()> {
        let Some(parsed) = Url::parse(url.as_bytes()) else {
            let url = url
                .strip_suffix("//")
                .filter(|it| it.ends_with(':'))
                .unwrap_or(url);
            self.refuse(url, NetError::InvalidUrl, promise);
            return Ok(());
        };
        self.cancel_pending()?;
        let is_by_app = promise.is_some();
        if is_by_app {
            self.loading.forget_wish();
            self.loading.not_served.take();
        }
        let promise = promise.map(|result| Promised {
            result,
            url: string(parsed.href()),
            error: None,
        });
        if let Some(it) = self.loading.promise.replace(promise) {
            let url = if it.error.is_some() {
                it.url.clone()
            } else {
                url.to_owned()
            };
            Promised { url, ..it }.fail(NetError::Aborted)?;
        }
        let (url, page) = (string(parsed.href()), self.page());
        if navigation.blob.is_none()
            && (self.is_for_guest(&url)? || (navigation.wants_web_engine && engine::shows_pages()?))
        {
            self.has_shown_trusted
                .update(|it| it || navigation.wants_web_engine || trust::is_excepted(&parsed));
            return self.load_in_guest(&url, navigation);
        }
        if (navigation.how == How::Push || (navigation.starts_over && is_by_app))
            && parsed.fragment().is_some()
            && without_hash(&url) == without_hash(&page.url())
            && page.is_started()
        {
            self.commit_entry(&url, navigation.how == How::Push, None, None)?;
            self.navigated_in_page(&url, navigation.how)?;
            self.later(Contents::rest);
            self.item().map_or(Ok(()), |it| self.pop_state(&url, &it))?;
            let promise = self.loading.promise.take();
            post(Priority::Host, move || {
                promise.map_or(Ok(()), Promised::settle)
            });
            return Ok(());
        }
        if navigation.markup.is_some() {
            return self.fetch(parsed, navigation, is_by_app);
        }
        let mut next = Some((parsed, navigation));
        self.while_beginning(&mut || match next.take() {
            Some((url, navigation)) => self.fetch(url, navigation, is_by_app),
            None => Ok(()),
        })
    }

    fn fetch(&self, parsed: Url, mut navigation: Navigation, is_by_app: bool) -> JsResult<()> {
        let url = string(parsed.href());
        if !self.leaves(&url, &mut navigation)? {
            return Ok(());
        }
        let is_traversal = matches!(navigation.how, How::Traverse(_));
        let pending = Rc::new(Pending {
            controller: Controller::default(),
            url: url.clone().into(),
            has_lost_body: false.into(),
            is_led_by_stranger: false.into(),
            is_traversal,
            is_by_app: is_by_app || is_traversal,
        });
        self.loading.pending.replace(Some(Rc::clone(&pending)));
        self.prepare_process(&parsed)?;
        self.loading.cause.set(
            match navigation.markup.is_none() || self.is_busy() && self.loading.is_on.get() {
                true => Cause::Navigation,
                false => Cause::JavaScriptUrl,
            },
        );
        self.set_loading(true)?;
        if !navigation.is_announced && navigation.markup.is_none() {
            self.announce_start(&url, &mut navigation, false)?;
        }
        let this = Root::new(self);
        task::spawn(async move {
            let fetched = never_at_once(fetch_document(&this, &pending, parsed, &navigation)).await;
            navigation.follow(&url, &pending);
            let it = this.get();
            task::report(match fetched {
                Err(Failure::Thrown(error)) => {
                    task::report(Err(error));
                    if it.loading.waits_for(&pending) {
                        it.recover(&pending, &NetError::Failed.into(), navigation)
                    } else {
                        Ok(())
                    }
                }
                _ if !it.loading.waits_for(&pending) => Ok(()),
                Ok((loaded, source)) => it.commit(loaded, navigation, Some(source)),
                Err(failure) => it.recover(&pending, &failure, navigation),
            });
        });
        Ok(())
    }

    fn recover(
        &self,
        pending: &Pending,
        failure: &Failure,
        mut navigation: Navigation,
    ) -> JsResult<()> {
        self.loading.pending.take();
        let url = pending.url.take();
        if matches!(failure, Failure::NeedsWebEngine) && engine::is_available()? {
            if self.is_frame() {
                return self.tell_element(ForElement::UseWebEngine(url));
            }
            self.has_shown_trusted.set(true);
            self.loading.is_on.set(false);
            self.loading
                .not_served
                .replace(without_hash(&url).to_owned());
            return self.load_in_guest(&url, navigation);
        }
        if let Failure::NeedsWebEngineFor(url) = failure
            && engine::is_available()?
        {
            self.has_shown_trusted.set(true);
            self.loading.is_on.set(false);
            return self.load_in_guest(url, navigation);
        }
        if navigation.blob.is_none() && self.is_for_guest(&url)? {
            self.has_shown_trusted
                .update(|it| it || holds(&url, trust::is_excepted));
            self.loading.is_on.set(false);
            let request = Rc::make_mut(&mut navigation.request);
            (request.body, request.headers) = Default::default();
            return self.load_in_guest(&url, navigation);
        }
        self.forget_aim();
        if !matches!(failure, Failure::NoDocument) {
            self.page().tell(Controls::abort_navigation)?;
        }
        let error = match failure {
            Failure::Error(error) => *error,
            Failure::NeedsWebEngine | Failure::NeedsWebEngineFor(_) => NetError::BlockedByClient,
            Failure::NoDocument | Failure::Thrown(_) => NetError::Aborted,
        };
        if error == NetError::Aborted {
            return self.rest();
        }
        if !self.can_fall_back() {
            return self.show_error(&url, error, navigation);
        }
        self.announce_failure("did-fail-provisional-load", &url, error)?;
        self.announce_failure("did-fail-load", &url, error)?;
        self.rest()
    }

    /// A site that is trusted is just a site in a session of its own.
    pub(super) fn is_trusted(&self, url: &str) -> JsResult<bool> {
        if self.is_frame() {
            return is_trusted_in_frame(url);
        }
        let directory = app::path()?;
        if self.preferences.uses_web_engine
            || !holds(url, |it| trust::is_trusted(it, directory.as_bytes()))
            || without_hash(url) == *self.loading.not_served.borrow()
        {
            return Ok(false);
        }
        Ok(!is_web(url)
            || same(self.session, session::default()?)
            || !(trust::has_sandbox_for_the_rest() || engine::is_available()?))
    }

    pub(crate) fn is_for_guest(&self, url: &str) -> JsResult<bool> {
        if self.is_frame() {
            return Ok(false);
        }
        if url != "about:blank" {
            let is_own_blob = holds(url, |it| resolve_blob_url(it).is_some());
            return Ok(!is_own_blob && !self.is_trusted(url)? && self.has_web_engine()?);
        }
        if self.guest().is_some() {
            return Ok(true);
        }
        if !self.page().is_initial()
            || self.page().is_started()
            || self.loading.is_pending()
            || self.is_destroyed.get()
            || self.crashed_at.borrow().is_some()
        {
            return Ok(false);
        }
        Ok(self.is_foreign()? && self.has_web_engine()?)
    }

    fn has_web_engine(&self) -> JsResult<bool> {
        match self.kind.get() {
            Kind::Print => engine::is_available(),
            _ => engine::shows_pages(),
        }
    }

    pub(super) fn is_foreign(&self) -> JsResult<bool> {
        Ok(self.preferences.uses_web_engine
            || !same(self.session, session::default()?)
            || !can_evaluate()?)
    }

    pub(super) fn show_guest(&self, is_opened_by_page: bool) -> JsResult<&'static Remote> {
        let guest = guest::create(self, How::Push, is_opened_by_page)?;
        guest.take_place().map(|()| guest)
    }

    /// For what wants the empty document.
    pub(super) fn started_guest(&self) -> JsResult<Option<&'static Remote>> {
        match self.guest() {
            None if self.is_for_guest("about:blank")? => self.show_guest(false).map(Some),
            guest => Ok(guest),
        }
    }

    pub(crate) fn guest_at_any_rate(&self) -> JsResult<&'static Remote> {
        self.guest().map_or_else(|| self.show_guest(false), Ok)
    }

    /// The page stays until there is something else to show.
    fn load_in_guest(&self, url: &str, mut navigation: Navigation) -> JsResult<()> {
        let mut leaves = navigation.may_unload || self.guest().is_some();
        if !leaves {
            self.loading.beginnings.update(|it| it + 1);
            let asked = self.leaves(url, &mut navigation);
            self.loading.beginnings.update(|it| it - 1);
            leaves = asked?;
        }
        if !leaves {
            return self.report_loading();
        }
        let promise = self.loading.promise.take().map(|it| it.result);
        let is_traversal = matches!(navigation.how, How::Traverse(_));
        let origin = match is_traversal {
            true => navigation.request.foreign_initiator(url),
            false => navigation.initiator.as_ref().map(Initiator::origin),
        };
        let source = origin
            .filter(|_| is_web(url) || self.session.handles(before(url, ":")))
            .map(|origin| guest::Source {
                origin,
                is_by_user: navigation.is_by_user,
                replaces: navigation.how != How::Push && !is_traversal,
                is_announced: navigation.is_announced || is_traversal,
            });
        let is_fit = |it: &Remote| match &source {
            Some(source) if !is_traversal => it.shows_origin(&source.origin),
            _ => Ok(!is_traversal),
        };
        let guest = match self.guest() {
            Some(guest) if is_fit(guest)? => guest,
            _ => {
                let guest = guest::create(self, navigation.how, false)?;
                fields::set_pending_guest(self, Some(guest));
                guest
            }
        };
        if self.guest().is_none() && self.page().is_initial() {
            guest.take_place()?;
        }
        self.loading
            .guest_repeats_start
            .set(navigation.is_announced);
        self.guest_is_loading(guest, true)?;
        let load = guest::Load {
            url,
            request: &navigation.request,
            user_agent: navigation.user_agent.as_deref(),
            base_of_data: navigation.base_of_data.as_deref(),
        };
        let loading: LocalFuture<'static, _> = match (navigation.how, source) {
            (_, Some(source)) => guest.load_for(&source, &load)?,
            (How::Traverse(index), _) => Box::pin(guest.traverse(&load, index)?),
            (_, None) => Box::pin(guest.load(&load)),
        };
        let (this, guest) = (Root::new(self), Root::new(guest));
        task::spawn(async move {
            let outcome = loading.await;
            let (it, guest) = (this.get(), guest.get());
            if fields::pending_guest(it).is_some_and(|it| same(it, guest)) {
                fields::set_pending_guest(it, None);
                if it.guest().is_none_or(|it| !same(it, guest)) {
                    task::report(guest.end());
                }
            }
            task::report(it.rest());
            if let Some(promise) = promise {
                task::report(
                    promise.settle(outcome.map(|_| JSValue::UNDEFINED).map_err(|it| it.throw())),
                );
            }
        });
        Ok(())
    }

    fn may_show(&self, url: &str) -> Result<(), Failure> {
        if url == "about:blank" || trust::has_sandbox_for_the_rest() || self.is_trusted(url)? {
            return Ok(());
        }
        if !engine::is_available()? {
            warn(&format!(
                "Refused to load {url}: it is not trusted, and there is no web engine to sandbox it. See app.setWebEngine()."
            ))?;
        }
        let is_iframe = self.embedded.as_ref().is_some_and(|it| it.kind == "iframe");
        Err(if is_iframe {
            Failure::NeedsWebEngine
        } else {
            NetError::BlockedByClient.into()
        })
    }

    fn prepare(
        &self,
        url: Url,
        it: &Navigation,
        csp: Option<&str>,
    ) -> JsResult<(request::Request, fetch::Initiator)> {
        let destination = self
            .embedded
            .as_ref()
            .and_then(|it| Destination::parse(it.kind.as_bytes()));
        let destination = destination.unwrap_or(Destination::Document);
        let mut request =
            request::Request::new(url, destination, Mode::Navigate, Credentials::Include);
        if let Some(body) = &it.request.body {
            request.method = b"POST"[..].into();
            request.body = Some(RequestBody::Data(Data::Bytes(body.to_vec().into())));
        }
        request.headers = it.request.headers.clone();
        request.cache = match it.how {
            How::Reload => CacheMode::NoCache,
            How::Traverse(_) => CacheMode::ForceCache,
            How::Push | How::Replace => CacheMode::Default,
        };
        request.referrer = it
            .request
            .referrer
            .as_ref()
            .and_then(|it| Url::parse(it.as_bytes()));
        request.referrer_policy = it.request.referrer_policy;
        request.has_user_activation = it.is_by_user;
        request.navigation = match it.how {
            How::Reload => bun_web::request::Navigation::Reload,
            How::Traverse(_) => bun_web::request::Navigation::History,
            _ => bun_web::request::Navigation::Other,
        };
        if request.url.scheme() == b"blob" {
            request.blob = it.blob.clone().or_else(|| resolve_blob_url(&request.url));
        }
        let source = it.initiating_page().map(|it| &*it.client);
        let user_agent = it
            .user_agent
            .clone()
            .map_or_else(|| self.owner().user_agent(), Ok)?;
        let languages = self.session.accept_language()?;
        let mut initiator = fetch::Initiator::new(
            Role::Page,
            it.origin(),
            user_agent.as_bytes(),
            languages.as_bytes(),
        );
        self.page().client.prepare_navigation(
            &mut request,
            &mut initiator,
            source,
            it.is_form,
            csp.map(str::as_bytes),
        );
        if (self.sandbox_of_next(&HeaderList::default())).forbids("allow-same-origin") {
            initiator.service = Handler::Nobody;
        }
        Ok((request, initiator))
    }

    fn take_fragment_directive(&self, loaded: &mut Loaded, navigation: &Navigation) {
        loaded.has_text_activation = navigation.has_text_activation;
        let Some(hash) = strings::index_of_char_usize(loaded.url.as_bytes(), b'#') else {
            return;
        };
        let Some(at) = strings::index_of(&loaded.url.as_bytes()[hash..], b":~:") else {
            return;
        };
        let directives = loaded.url[hash + at + 3..].to_owned();
        loaded.url.truncate(if at == 1 { hash } else { hash + at });
        loaded.has_text_activation = false;
        let is_private =
            |it: &Initiator| it.origin() == origin_of(&loaded.url) || self.context.is_alone();
        let is_allowed = |it| navigation.has_text_activation && !self.is_frame() && is_private(it);
        if matches!(loaded.essence.as_deref(), Some("text/html" | "text/plain"))
            && navigation.initiator.as_ref().is_none_or(is_allowed)
        {
            loaded.text_directives = Some(directives);
        }
    }

    fn commit(
        &self,
        loaded: Loaded,
        navigation: Navigation,
        source: Option<Source>,
    ) -> JsResult<()> {
        if let Some(process) = self.page().process() {
            return process.hold(|| self.swap_documents(loaded, navigation, source));
        }
        self.swap_documents(loaded, navigation, source)
    }

    fn swap_documents(
        &self,
        mut loaded: Loaded,
        mut navigation: Navigation,
        source: Option<Source>,
    ) -> JsResult<()> {
        self.take_fragment_directive(&mut loaded, &navigation);
        let has_own_group = loaded.headers.contains(b"cross-origin-opener-policy");
        loaded.started = match &loaded.timing {
            Some((it, _)) if has_own_group && !it.allows_timing => it.timing.fetch_start,
            _ => navigation.started,
        };
        loaded.timing.get_or_insert_with(|| {
            let record = ResourceTiming::of_nothing(loaded.url.as_bytes(), navigation.started);
            (record, navigation.how.navigation_type())
        });
        let (old, loaded) = (self.page(), Rc::new(loaded));
        let inherited = navigation.request.creator.clone();
        let referrer = match &navigation.markup {
            Some(_) if !old.is_initial() => Some(old.referrer()),
            Some(_) => navigation.request.referrer.clone(),
            None if loaded.unreachable.is_some() => None,
            None => loaded
                .referrer
                .clone()
                .or_else(|| navigation.request.referrer.clone()),
        };
        let about = About {
            referrer: referrer.unwrap_or_default(),
            has_policies_from_history: inherited.is_some(),
            creator: inherited.or_else(|| match &navigation.initiator {
                _ if navigation.markup.is_some() => Some(Creator::Page(Rc::new(Root::new(old)))),
                Some(Initiator::Page(page)) => Some(Creator::Page(Rc::clone(page))),
                _ => None,
            }),
            is_of_markup: navigation.markup.is_some(),
            loaded: Some(Rc::clone(&loaded)),
            ..Default::default()
        };
        let creator = about.creator.clone();
        let is_led_by_stranger = loaded.is_led_by_stranger
            || (creator.as_ref()).is_some_and(|it| !it.place().is_trusted());
        let mut page = self.new_page(&loaded.url, about)?;
        if !page.client.allows_embedder(&loaded.headers)
            || (loaded.is_made_in_page_process && page.place() == place::Place::App)
        {
            page.forget_creator();
            return self.show_error(&loaded.url, NetError::BlockedByResponse, navigation);
        }
        self.loading.pending.take();
        self.loading.not_served.take();
        let url = &*loaded.url;
        if let (Some(Creator::Page(creator)), "about" | "blob" | "data") =
            (creator, before(url, ":"))
        {
            Rc::make_mut(&mut navigation.request).creator = Some(page.bequest(creator.get()));
        }
        let was_initial = old.is_initial();
        if !was_initial && old.is_started() && !old.is_loaded.get() {
            self.announce_interruption(old)?;
        }
        if !was_initial {
            self.will_swap(page, url, loaded.has_crossed_origins, navigation.how)?;
        }
        if self.page().renew(page)? {
            page = self.page();
        } else {
            self.page().dispose()?;
            if !loaded.has_crossed_origins && old.origin_key() == page.origin_key() {
                page.client.follow(&old.client);
            }
        }
        if self.is_destroyed.get() {
            return Ok(());
        }
        self.make_room_for(page);
        self.guest().map_or(Ok(()), Remote::end)?;
        let is_of_app =
            page.place().is_trusted() || (!is_led_by_stranger && holds(url, trust::is_excepted));
        (self.has_shown_trusted).update(|it| it || (is_of_app && loaded.unreachable.is_none()));
        self.loading.awaits_document.set(true);
        self.show_from_now(page);
        let is_first = self.item().is_none();
        self.commit_document(&page.url_in_history(), &navigation)?;
        self.announce_frame()?;
        if navigation.markup.is_none() {
            let replaces = is_first || navigation.starts_over || navigation.how == How::Replace;
            if !self.is_frame() || !(replaces || was_initial) {
                self.announce_entry(false, replaces)?;
            }
            self.announce_arrival(page, &loaded, navigation.how)?;
        }
        if page.is_disposed() {
            return Ok(());
        }
        if !self.is_frame() && self.preferences.focuses_on_navigation && self.is_window_focused()? {
            self.take_focus()?;
        }
        self.tell_element(ForElement::Measure)?;
        let source = source.unwrap_or_default();
        (page.streaming).replace(source.rest.as_ref().map(|it| it.controller.clone()));
        let markup = match (&source.xml_type, &source.rest) {
            (Some(kind), _) => Markup::Xml(kind),
            (None, Some(_)) => Markup::StartOfHtml,
            (None, None) => Markup::Html,
        };
        let shown = self.show(page, &source.text, markup);
        if let Some(rest) = source.rest {
            let giving = rest.give_to(Root::new(page));
            task::spawn(async move { task::report(giving.await) });
        }
        shown
    }

    fn announce_arrival(&self, page: &Page, loaded: &Loaded, how: How) -> JsResult<()> {
        if let Some((url, error)) = &loaded.unreachable {
            if let Some(promise) = &mut *self.loading.promise.borrow_mut() {
                (promise.url, promise.error) = (url.clone(), Some(*error));
            }
            self.announce_failure("did-fail-provisional-load", url, *error)?;
            return self.announce_failure("did-fail-load", url, *error);
        }
        let (status, text) = match before(&loaded.url, ":") {
            "about" => (-1, ""),
            _ if is_web(&loaded.url) || loaded.status != 200 => {
                (loaded.status.into(), &*loaded.status_text)
            }
            _ => (200, "OK"),
        };
        let about = [js(&*loaded.url)?, status.into(), js(text)?];
        self.announce_for_frame("did-frame-navigate", page, &about)?;
        self.announce("did-navigate", &about)?;
        self.announce_title_after(how)
    }

    fn open_external(&self, page: &Page, url: &str, navigation: &Navigation) -> JsResult<()> {
        let initiator = navigation.initiating_page();
        if self.is_frame()
            && initiator.is_some_and(|it| !it.sandbox().allows_hand_off(navigation.is_by_user))
        {
            return page.log_error("A sandbox keeps the frame from opening another program");
        }
        if IS_WINDOWS && url.as_bytes().get(1) == Some(&b':') {
            return page.log_error("A path is not a URL");
        }
        let scheme = before(url, ":").to_ascii_lowercase();
        if IS_WINDOWS
            && (scheme == "file"
                || (!navigation.is_by_user || is_for_windows_itself(&scheme))
                    && self
                        .session
                        .handler("setPermissionRequestHandler")?
                        .is_none())
        {
            return page.log_error(&format!(
                "Not allowed to open {scheme} URL in another program"
            ));
        }
        let more = object!({ "externalURL": url });
        if initiator.is_none_or(|it| !same(it, page)) {
            let origin = || {
                navigation
                    .initiator
                    .as_ref()
                    .map(Initiator::origin)
                    .unwrap_or_default()
            };
            more.put(global(), b"isMainFrame", JSValue::FALSE);
            more.put(
                global(),
                b"requestingUrl",
                js(initiator.map_or_else(origin, Page::url))?,
            );
        }
        let url = url.to_owned();
        page.request_permission("openExternal", more, move |is_granted| {
            if is_granted {
                tell_system(SystemCommand::OpenUrl(url.into()))
            } else {
                Ok(())
            }
        })
    }
}

/// Some of these log in to other computers, or run what they find there.
fn is_for_windows_itself(scheme: &str) -> bool {
    [
        "ms-",
        "microsoft",
        "windows",
        "explorer",
        "search",
        "ie.",
        "onenote",
    ]
    .iter()
    .any(|it| scheme.starts_with(it))
        || matches!(
            scheme,
            "shell" | "hcp" | "its" | "mk" | "res" | "mhtml" | "ldap"
        )
}

async fn fetch_document(
    this: &Root<Contents>,
    pending: &Pending,
    url: Url,
    navigation: &Navigation,
) -> Result<(Loaded, Source), Failure> {
    let (first, csp) = (string(url.href()), this.get().element().csp);
    let is_blob_at_top = url.scheme() == b"blob" && !this.get().is_frame();
    if !is_blob_at_top {
        this.get().may_show(&first)?;
    }
    if url.scheme() == b"about" || navigation.markup.is_some() {
        let is_markup = navigation.markup.is_some();
        if url.path() == b"srcdoc" && !is_markup && navigation.request.srcdoc.is_none() {
            return Err(NetError::InvalidUrl.into());
        }
        let mut loaded = Loaded {
            encoding: Cell::new(Some(if is_markup {
                Encoding::default()
            } else {
                this.get().fallback_encoding(&first, "text/html")
            })),
            essence: (!is_markup).then(|| "text/html".to_owned()),
            required_csp: csp,
            ..Loaded::new(first)
        };
        loaded.headers.append(b"content-type", b"text/html");
        let text = navigation
            .markup
            .as_ref()
            .or(navigation.request.srcdoc.as_ref())
            .cloned()
            .unwrap_or_default();
        return Ok((
            loaded,
            Source {
                text,
                ..Source::default()
            },
        ));
    }
    let is_sent_again = pending.is_traversal && navigation.request.body.is_some() && url.is_http();
    let (mut request, initiator) = this.get().prepare(url, navigation, csp.as_deref())?;
    request.is_only_for_service_worker = is_sent_again;
    let client = Rc::clone(&this.get().page().client);
    let watcher = Watcher {
        contents: this,
        navigation,
        pending,
        parent: client.parent().cloned(),
        refusal: None.into(),
    };
    let fetched = fetch::fetch(
        &client.session,
        &initiator,
        request,
        &watcher,
        &pending.controller,
    )
    .await;
    let Response { head, body } = fetched.map_err(|it| {
        let failure = if it.needs_web_engine {
            Failure::NeedsWebEngine
        } else {
            it.error.into()
        };
        watcher.refusal.take().unwrap_or(failure)
    })?;
    let (it, url) = (this.get(), string(head.url.href()));
    let declared = head.headers.mime();
    let essence = match &declared {
        Some(it) => string(it.essence()),
        None => {
            if !head.headers.get_or_empty(b"content-type").is_empty() || head.headers.is_nosniff() {
                "text/plain"
            } else {
                "text/html"
            }
            .to_owned()
        }
    };
    let is_plugin = it
        .embedded
        .as_ref()
        .is_some_and(|it| matches!(&*it.kind, "object" | "embed"));
    if it.can_fall_back() && head.status >= 400 {
        return Err(NetError::Aborted.into());
    }
    if head.headers.is_attachment() || !can_be_shown(&essence) {
        let may_download = navigation
            .initiator
            .as_ref()
            .is_none_or(Initiator::may_download);
        if !is_plugin
            && may_download
            && !it
                .sandbox_of_next(&HeaderList::default())
                .forbids("allow-downloads")
        {
            let loaded = Response { head, body };
            it.save(vec![url], loaded, None, navigation, Controller::default())?;
        }
        return Err(Failure::NoDocument);
    }
    if matches!(head.status, 204 | 205) {
        return Err(Failure::NoDocument);
    }
    let is_xml = mime::is_xml(essence.as_bytes());
    let is_image = !is_xml && essence.starts_with("image/");
    if is_image && is_plugin {
        it.tell_element(ForElement::ShowImage(first))?;
        return Err(NetError::Aborted.into());
    }
    if is_blob_at_top
        && !trust::has_sandbox_for_the_rest()
        && (is_xml || essence == "text/html" || it.preferences.uses_web_engine)
        && !is_trusted_in_frame(&url)?
    {
        let kind = head.headers.get(b"content-type").unwrap_or_default();
        let bytes = match body {
            Some(body) => body.read_to_end().await?.into_vec(),
            None => Vec::new(),
        };
        return Err(Failure::NeedsWebEngineFor(format!(
            "data:{};base64,{}",
            string(&kind),
            crate::text::base64(&bytes)
        )));
    }
    let charset = (declared.as_ref()).and_then(|it| Encoding::for_label(it.parameter(b"charset")?));
    let mut scan = MetaScan::default();
    let (bytes, rest) = match body.filter(|_| !is_image) {
        Some(body) if essence == "text/html" && is_web(&url) => {
            read_start(body, charset.is_some(), &mut scan).await?
        }
        Some(body) => (body.read_to_end().await?.into_vec(), None),
        None => Default::default(),
    };
    let it = this.get();
    let encoding = Encoding::for_bom(&bytes)
        .or(charset)
        .or_else(|| {
            if is_xml {
                Encoding::declared_in_xml(&bytes)
            } else {
                Encoding::declared_in_html(&bytes)
            }
        })
        .unwrap_or_else(|| {
            if is_xml {
                Encoding::default()
            } else {
                it.fallback_encoding(&url, &essence)
            }
        });
    let (size, mut for_parent) = (bytes.len() as u64, None);
    if let (Some(parent), Some(frame)) = (navigation.initiating_page(), &it.embedded)
        && it.page().parent().is_some_and(|it| same(it, parent))
    {
        let kind = if parent.client.origin().is_origin_of(&head.url) {
            head.kind
        } else {
            ResponseType::Opaque
        };
        let initiator = InitiatorType::parse(frame.kind.as_bytes()).unwrap_or(InitiatorType::Other);
        for_parent = Some(Timed {
            parent: Rc::clone(&parent.client),
            name: first,
            initiator,
            head: Head {
                kind,
                ..head.clone()
            },
        });
    }
    let how = navigation.how.navigation_type();
    let mut rest = rest.map(|body| Rest {
        body,
        decoder: encoding.decoder(),
        undecided: (charset.is_none()
            && plain_len(&bytes) == bytes.len()
            && !scan.is_settled_by(&bytes))
        .then(|| Undecided {
            all: bytes.clone(),
            given: bytes.len(),
            scan,
        }),
        controller: pending.controller.clone(),
        size,
        head: head.clone(),
        how,
        for_parent: for_parent.take(),
    });
    for_parent.into_iter().for_each(|it| it.record(size));
    let decode = || encoding.decode(&bytes, false);
    let text = if let Some(rest) = &mut rest {
        rest.decoder.decode(&bytes, false)
    } else if is_image {
        format!(
            "<!doctype html><body style=\"margin:0\"><img src=\"{}\">",
            escape_html(&url)
        )
    } else if is_xml || essence == "text/html" {
        decode().into_owned()
    } else {
        format!(
            "<!doctype html><pre style=\"word-wrap:break-word;white-space:pre-wrap\">\n{}</pre>",
            escape_html(&decode())
        )
    };
    let mut record =
        ResourceTiming::of_response(url.as_bytes(), InitiatorType::Navigation, &head, size);
    if rest.is_some() {
        record.response_end = 0.0;
    }
    let loaded = Loaded {
        status: head.status,
        status_text: head.status_text.iter().map(|it| char::from(*it)).collect(),
        referrer: Some(
            head.referrer
                .as_ref()
                .map(|it| string(it.href()))
                .unwrap_or_default(),
        ),
        has_crossed_origins: head.has_cross_origin_redirects,
        reserved: head.reserved.clone().into(),
        is_made_in_page_process: head.is_from_service_worker
            && (head.reserved.as_ref()).is_none_or(|it| it.is_apart),
        is_led_by_stranger: pending.is_led_by_stranger.get(),
        encoding: Some(encoding).into(),
        required_csp: csp,
        timing: Some((record, how)),
        headers: head.headers,
        essence: Some(essence.clone()),
        ..Loaded::new(url)
    };
    Ok((
        loaded,
        Source {
            text,
            xml_type: is_xml.then_some(essence),
            rest,
        },
    ))
}

impl Contents {
    fn fallback_encoding(&self, url: &str, essence: &str) -> Encoding {
        let of_parent = self
            .page()
            .parent()
            .filter(|it| it.origin() == origin_of(url))
            .and_then(Page::encoding_of_frames);
        let is_legacy = is_web(url) && !crate::text::contains(essence, "json");
        let usual = self.preferences.default_encoding;
        of_parent
            .or_else(|| {
                (usual.or_else(|| Encoding::for_label(b"windows-1252"))).filter(|_| is_legacy)
            })
            .unwrap_or_default()
    }
}

impl Loaded {
    pub(super) fn header(&self, name: &str) -> Option<String> {
        self.headers
            .get(name.as_bytes())
            .map(|it| it.iter().map(|it| char::from(*it)).collect())
    }

    pub(super) fn arrival(&self) -> Arrival {
        let policy = self.header("document-policy").unwrap_or_default();
        let forces_top = |item: &str| {
            let (name, value) = crate::text::split_once(before(item, ";"), "=")
                .unwrap_or_else(|| (before(item, ";"), "?1"));
            (name.trim(), value.trim()) == ("force-load-at-top", "?1")
        };
        Arrival {
            loads_at_top: crate::text::split(&policy, ",").any(forces_top),
            has_text_activation: self.has_text_activation,
            text_directives: self.text_directives.clone().unwrap_or_default(),
        }
    }

    pub(super) fn refresh(&self) -> Option<String> {
        self.header("refresh")
    }

    pub(super) fn describe(&self, url: String, base_url: Option<String>) -> page::About {
        page::About {
            url,
            base_url,
            encoding: (self.encoding.get()).map(|it| it.name().to_ascii_lowercase()),
            content_type: self.essence.clone(),
            last_modified: self.header("last-modified"),
            language: (self.header("content-language"))
                .map(|it| before(&it, ",").trim().to_owned()),
            links: self.headers.get_or_empty(b"link").to_vec(),
        }
    }
}
