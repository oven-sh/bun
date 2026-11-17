//! <https://fetch.spec.whatwg.org/#request-class>

use bun_jsc::AbortSignal;
use bun_web::client::Client;
use bun_web::convert::resolve_blob_url;
use bun_web::headers::{is_forbidden_method, is_token, normalize_method};
use bun_web::net::body::Blob;
use bun_web::origin::Origin;
use bun_web::referrer::ReferrerPolicy;
use bun_web::request::{self, CacheMode, Credentials, Destination, InitiatorType, Mode, Redirect};

use super::body::{Body, Content};
use super::headers::{Guard, Guarded};
use super::*;

#[derive(Clone)]
pub(super) enum Referrer {
    None,
    Client,
    Url(Url),
}

impl Referrer {
    #[optimize(size)]
    pub(super) fn as_bytes(&self) -> &[u8] {
        match self {
            Referrer::None => b"",
            Referrer::Client => b"about:client",
            Referrer::Url(url) => url.href(),
        }
    }
}

#[derive(Clone)]
pub(crate) struct Options {
    pub(crate) url: Url,
    pub(crate) method: Bytes,
    destination: Destination,
    pub(super) mode: Mode,
    pub(super) credentials: Credentials,
    pub(super) cache: CacheMode,
    redirect: Redirect,
    pub(super) referrer: Referrer,
    referrer_policy: ReferrerPolicy,
    integrity: Bytes,
    pub(super) keepalive: bool,
    pub(super) uses_preflight: bool,
    is_reload_navigation: bool,
    is_history_navigation: bool,
    blob: Option<Blob>,
}

impl Options {
    #[optimize(size)]
    pub(crate) fn new(url: Url) -> Options {
        Options {
            blob: if url.scheme() == b"blob" {
                resolve_blob_url(&url)
            } else {
                None
            },
            url,
            method: b"GET"[..].into(),
            destination: Destination::Empty,
            mode: Mode::Cors,
            credentials: Credentials::SameOrigin,
            cache: CacheMode::Default,
            redirect: Redirect::Follow,
            referrer: Referrer::Client,
            referrer_policy: ReferrerPolicy::Empty,
            integrity: Bytes::default(),
            keepalive: false,
            uses_preflight: false,
            is_reload_navigation: false,
            is_history_navigation: false,
        }
    }

    pub(super) fn has_get_or_head(&self) -> bool {
        matches!(&*self.method, b"GET" | b"HEAD")
    }

    fn guard(&self) -> Guard {
        if self.mode == Mode::NoCors {
            Guard::RequestNoCors
        } else {
            Guard::Request
        }
    }

    #[optimize(size)]
    pub(super) fn into_request(
        self,
        client: &Client,
        headers: HeaderList,
        initiator: InitiatorType,
    ) -> request::Request {
        let mut request =
            request::Request::new(self.url, self.destination, self.mode, self.credentials);
        (
            request.method,
            request.headers,
            request.cache,
            request.redirect,
        ) = (self.method, headers, self.cache, self.redirect);
        request.referrer = match self.referrer {
            Referrer::None => None,
            Referrer::Client => client.referrer_source(),
            Referrer::Url(url) => Some(url),
        };
        (
            request.referrer_policy,
            request.metadata.integrity,
            request.initiator_type,
        ) = (self.referrer_policy, self.integrity, Some(initiator));
        (request.keepalive, request.uses_preflight, request.blob) =
            (self.keepalive, self.uses_preflight, self.blob);
        request
    }
}

/// `fetch()` needs no object.
pub(crate) struct Parts<'a> {
    pub(crate) options: Options,
    pub(crate) headers: Rc<Guarded>,
    pub(crate) body: Body<'a>,
    pub(crate) signal: Option<JsLocal<'a, AbortSignal>>,
}

macro_rules! same_keywords {
    ($given:expr, $from:ident => $to:ident { $($variant:ident),* }) => {
        match $given { $($from::$variant => $to::$variant,)* }
    };
}

#[optimize(size)]
fn is_empty(init: &DomRequestInit<'_>) -> bool {
    let DomRequestInit {
        body,
        cache,
        credentials,
        duplex,
        headers,
        integrity,
        keepalive,
        method,
        mode,
        priority,
        redirect,
        referrer,
        referrer_policy,
        signal,
        window,
    } = init;
    body.is_undefined()
        && window.is_undefined()
        && (cache.is_none()
            && credentials.is_none()
            && duplex.is_none()
            && headers.is_none()
            && integrity.is_none()
            && keepalive.is_none())
        && (method.is_none()
            && mode.is_none()
            && priority.is_none()
            && redirect.is_none()
            && referrer.is_none()
            && referrer_policy.is_none())
        && signal.is_undefined()
}

#[optimize(size)]
fn apply<'a>(heap: &JsHeap<'a>, init: &DomRequestInit<'a>, options: &mut Options) -> Result<'a> {
    if !init.window.to_js().is_undefined_or_null() {
        return Err(type_error(
            heap,
            "The window of a request can only be null.",
        ));
    }
    if options.mode == Mode::Navigate {
        options.mode = Mode::SameOrigin;
    }
    (options.is_reload_navigation, options.is_history_navigation) = (false, false);
    (options.referrer, options.referrer_policy) = (Referrer::Client, ReferrerPolicy::Empty);
    match &init.referrer {
        Some(referrer) if referrer.is_empty() => options.referrer = Referrer::None,
        Some(referrer) => {
            let parsed = parse_url(heap, referrer).ok_or_else(|| {
                heap.type_error(format_args!(
                    "The referrer '{}' is not a valid URL.",
                    referrer.to_utf8()
                ))
            })?;
            if last_client_of(heap).is_some_and(|it| it.origin() == Origin::of(&parsed)) {
                options.referrer = Referrer::Url(parsed);
            }
        }
        None => {}
    }
    if let Some(policy) = init.referrer_policy {
        options.referrer_policy = same_keywords!(policy, DomReferrerPolicy => ReferrerPolicy {
            Empty, NoReferrer, NoReferrerWhenDowngrade, SameOrigin, Origin, StrictOrigin, OriginWhenCrossOrigin, StrictOriginWhenCrossOrigin, UnsafeUrl
        });
    }
    if init.mode == Some(RequestMode::Navigate) {
        return Err(type_error(
            heap,
            "The mode of a request cannot be 'navigate'.",
        ));
    }
    options.mode = init.mode.map_or(
        options.mode,
        |it| same_keywords!(it, RequestMode => Mode { Navigate, SameOrigin, NoCors, Cors }),
    );
    options.credentials = init.credentials.map_or(
        options.credentials,
        |it| same_keywords!(it, DomRequestCredentials => Credentials { Omit, SameOrigin, Include }),
    );
    options.cache = init.cache.map_or(options.cache, |it| same_keywords!(it, RequestCache => CacheMode { Default, NoStore, Reload, NoCache, ForceCache, OnlyIfCached }));
    if options.cache == CacheMode::OnlyIfCached && options.mode != Mode::SameOrigin {
        return Err(type_error(
            heap,
            "'only-if-cached' can only be set with the mode 'same-origin'.",
        ));
    }
    options.redirect = init.redirect.map_or(
        options.redirect,
        |it| same_keywords!(it, RequestRedirect => Redirect { Follow, Error, Manual }),
    );
    if let Some(integrity) = init.integrity {
        options.integrity = integrity.into();
    }
    options.keepalive = init.keepalive.unwrap_or(options.keepalive);
    if let Some(method) = init.method.as_ref().map(bytes_of) {
        if !is_token(&method) || is_forbidden_method(&method) {
            return Err(heap.type_error(format_args!(
                "'{}' is not a method that can be used.",
                bstr::BStr::new(&method)
            )));
        }
        options.method = normalize_method(&method).into();
    }
    Ok(())
}

pub(super) fn parse<'a>(heap: &JsHeap<'a>, url: &DomString) -> Result<'a, Url> {
    let parsed = parse_url(heap, url).ok_or_else(|| {
        heap.type_error(format_args!("Failed to parse URL from {}", url.to_utf8()))
    })?;
    if parsed.includes_credentials() {
        Err(type_error(
            heap,
            "A request cannot have a URL that includes credentials.",
        ))
    } else {
        Ok(parsed)
    }
}

impl<'a> Parts<'a> {
    pub(super) fn of(cx: Cx<'_, 'a>, input: &DomRequestInfo<'a>) -> Result<'a, Parts<'a>> {
        Parts::new(cx, input, &DomRequestInit::default())
    }

    #[optimize(size)]
    pub(crate) fn new(
        cx: Cx<'_, 'a>,
        input: &DomRequestInfo<'a>,
        init: &DomRequestInit<'a>,
    ) -> Result<'a, Parts<'a>> {
        let heap = &cx.heap;
        let (mut options, other) = match input {
            DomRequestInfo::Request(other) => (other.options.clone(), Some(*other)),
            DomRequestInfo::Url(url) => (Options::new(parse(heap, &DomString::from(*url))?), None),
        };
        options.destination = Destination::Empty;
        let has_init = !is_empty(init);
        if has_init {
            apply(heap, init, &mut options)?;
        }
        let signal = match init.signal {
            given if given.is_undefined() => other.and_then(|it| it.followed(heap)),
            given if given.to_js().is_null() => None,
            given => Some(given.as_abort_signal().ok_or_else(|| {
                type_error(heap, "The signal of a request has to be an AbortSignal.")
            })?),
        };
        if options.mode == Mode::NoCors && !matches!(&*options.method, b"GET" | b"HEAD" | b"POST") {
            return Err(heap.type_error(format_args!(
                "'{}' is not supported in no-cors mode.",
                bstr::BStr::new(&options.method)
            )));
        }
        let inherited = other
            .map(|it| it.headers.list().clone())
            .unwrap_or_default();
        let headers = Guarded::new(
            if has_init {
                HeaderList::default()
            } else {
                inherited.clone()
            },
            options.guard(),
        );
        match &init.headers {
            Some(given) => headers.fill(heap, given)?,
            None if has_init => inherited
                .iter()
                .try_for_each(|it| headers.append(heap, it.0, it.1))?,
            None => {}
        }
        let (given, other) = (
            Some(init.body).filter(|it| !it.to_js().is_undefined_or_null()),
            other.filter(|it| it.has_body()),
        );
        if (given.is_some() || other.is_some()) && options.has_get_or_head() {
            return Err(type_error(
                heap,
                "A request with the method GET or HEAD cannot have a body.",
            ));
        }
        let extracted = given
            .map(|it| Body::extract(cx, it, options.keepalive))
            .transpose()?;
        headers.set_type_if_absent(&cx.heap, extracted.as_ref().and_then(|it| it.1.as_deref()))?;
        if extracted.as_ref().map_or_else(
            || other.is_some_and(|it| !it.has_source()),
            |it| matches!(it.0.content, Content::Stream),
        ) {
            if extracted.is_some() && init.duplex.is_none() {
                return Err(type_error(
                    &cx.heap,
                    "A streaming body needs the duplex member.",
                ));
            }
            if options.mode == Mode::NoCors {
                return Err(type_error(
                    &cx.heap,
                    "A request with a streaming body needs the mode 'same-origin' or 'cors'.",
                ));
            }
            options.uses_preflight = true;
        }
        if let (None, Some(other)) = (&extracted, other) {
            other.check_usable(&cx.heap)?;
        }
        let taken = other
            .filter(|it| !it.is_unusable())
            .map(|it| it.take_body(cx))
            .transpose()?;
        Ok(Parts {
            options,
            headers,
            body: extracted.map(|it| it.0).or(taken).unwrap_or_default(),
            signal,
        })
    }
}

#[repr(C)]
pub(crate) struct Request {
    pub(crate) base: Message,
    pub(crate) fields: js_DomRequest::Fields,
    pub(crate) options: Options,
}

macro_rules! keywords {
    ($($getter:ident: $($field:ident).+,)*) => {
        $(pub(crate) fn $getter<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
            heap.create_latin1_string(self.$($field).+.as_bytes())
        })*
    };
}

impl Request {
    fn create<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        parts: Parts<'a>,
    ) -> &'a Request {
        let this = structure.create(
            heap,
            Request {
                base: Message::new(parts.headers),
                fields: Default::default(),
                options: parts.options,
            },
        );
        this.set_body(parts.body);
        js_Message::set_followed(this, parts.signal.map_or(JSValue::ZERO, JsLocal::to_js));
        this
    }

    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        options: Options,
        headers: HeaderList,
        guard: Guard,
        body: Content,
    ) -> &'a Request {
        Request::create(
            heap,
            js_DomRequest::CLASS.structure(heap),
            Parts {
                options,
                headers: Guarded::new(headers, guard),
                body: body.into(),
                signal: None,
            },
        )
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        input: DomRequestInfo<'a>,
        init: &DomRequestInit<'a>,
    ) -> Result<'a, &'a Self> {
        let parts = Parts::new(cx, &input, init)?;
        Ok(Request::create(&cx.heap, structure, parts))
    }

    fn followed<'a>(&self, heap: &JsHeap<'a>) -> Option<JsLocal<'a, AbortSignal>> {
        JsLocal::new(heap, js_Message::followed(self)?).as_abort_signal()
    }

    keywords! {
        get_destination: options.destination,
        get_referrer: options.referrer,
        get_referrer_policy: options.referrer_policy,
        get_mode: options.mode,
        get_credentials: options.credentials,
        get_cache: options.cache,
        get_redirect: options.redirect,
    }

    pub(crate) fn get_method<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(&self.options.method)
    }

    pub(crate) fn get_url<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(self.options.url.href())
    }

    pub(crate) fn get_integrity(&self) -> &[u8] {
        &self.options.integrity
    }

    pub(crate) fn get_keepalive(&self) -> bool {
        self.options.keepalive
    }

    pub(crate) fn get_is_reload_navigation(&self) -> bool {
        self.options.is_reload_navigation
    }

    pub(crate) fn get_is_history_navigation(&self) -> bool {
        self.options.is_history_navigation
    }

    pub(crate) fn get_signal<'a>(&self, heap: &JsHeap<'a>) -> JSValue {
        heap.create_dependent_signal(self.followed(heap).as_slice())
            .to_js()
    }

    pub(crate) fn get_duplex<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(b"half")
    }

    pub(crate) fn duplicate<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, &'a Request> {
        let (body, headers) = (
            self.clone_body(cx)?,
            Guarded::new(self.headers.list().clone(), self.headers.guard),
        );
        let realm = self.realm(&cx.heap);
        Ok(Request::create(
            realm,
            js_DomRequest::CLASS.structure(realm),
            Parts {
                options: self.options.clone(),
                headers,
                body,
                signal: self.followed(realm),
            },
        ))
    }
}
