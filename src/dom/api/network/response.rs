//! <https://fetch.spec.whatwg.org/#response-class>

use core::any::Any;
use core::task::{Context, Poll};

use bun_web::exec::Shared;
use bun_web::net::NetError;
use bun_web::net::body::{Body as Outgoing, Chunk, Read, SharedBytes, Source, pipe};
use bun_web::net::response::{
    Answer, Head, Response as Fetched, ResponseType, is_null_body_status, is_ok_status,
    is_redirect_status,
};
use bun_web::request::RequestBody;
use bun_web::service::{Busy, Served};
use bun_web::streams::Incoming;

use super::body::{Body, Content};
use super::headers::{Guard, Guarded};
use super::*;

#[derive(Clone)]
pub(crate) struct About {
    pub(crate) kind: &'static [u8],
    /// Without a fragment.
    pub(crate) url: Bytes,
    pub(crate) is_redirected: bool,
    pub(crate) status: u16,
    pub(crate) status_text: Bytes,
    /// If this is not all.
    pub(super) internal: Option<Rc<Head>>,
}

/// The body of an opaque response.
#[derive(Clone, Default)]
enum Hidden {
    #[default]
    Null,
    Incoming(Rc<Incoming>),
    Whole(Shared<Option<SharedBytes>>),
    Served,
}

struct Holding {
    body: Outgoing,
    _busy: Busy,
}

impl Source for Holding {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        self.body.poll_read(cx)
    }
}

impl About {
    fn new(kind: &'static [u8], status: u16, status_text: &[u8]) -> About {
        About {
            kind,
            url: Bytes::default(),
            is_redirected: false,
            status,
            status_text: status_text.into(),
            internal: None,
        }
    }

    /// Of the filtered response.
    #[optimize(size)]
    pub(super) fn of(head: &Head) -> About {
        let (status, status_text) = if head.is_cors_cross_origin() {
            (0, &b""[..])
        } else {
            (head.status, &*head.status_text)
        };
        let is_opaque = head.kind == ResponseType::Opaque;
        About {
            url: if is_opaque {
                Bytes::default()
            } else {
                head.url.without_fragment().into()
            },
            is_redirected: !is_opaque && head.redirects > 0,
            internal: (head.kind != ResponseType::Basic).then(|| head.clone().into()),
            ..About::new(head.kind.as_bytes(), status, status_text)
        }
    }
}

#[repr(C)]
pub(crate) struct Response {
    pub(crate) base: Message,
    pub(crate) about: About,
    hidden: RefCell<Hidden>,
}

impl Response {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        about: About,
        headers: HeaderList,
        guard: Guard,
        body: Body<'a>,
    ) -> &'a Response {
        let this = js_DomResponse::create(
            heap,
            Response {
                base: Message::new(Guarded::new(headers, guard)),
                about,
                hidden: Default::default(),
            },
        );
        this.set_body(body);
        this
    }

    /// `held` is dropped when the body has arrived.
    #[optimize(size)]
    pub(crate) fn of_fetched<'a>(
        heap: &JsHeap<'a>,
        Fetched { head, body }: Fetched,
        held: Box<dyn Any>,
    ) -> &'a Response {
        let incoming = body.map(Incoming::new);
        if let Some(incoming) = &incoming {
            incoming.hold_until_end(held);
            incoming.read_ahead();
        }
        let (hidden, shown) = if head.is_cors_cross_origin() {
            (incoming, None)
        } else {
            (None, incoming)
        };
        let this = Response::new(
            heap,
            About::of(&head),
            head.exposed_headers(),
            Guard::Immutable,
            shown.map_or(Content::Null, Content::Incoming).into(),
        );
        this.hidden
            .replace(hidden.map_or(Hidden::Null, Hidden::Incoming));
        this
    }

    pub(super) fn hide(&self, body: Vec<u8>) {
        let body = Chunk::Owned(body).into_shared();
        self.hidden
            .replace(Hidden::Whole(Shared::spawn(async { Some(body) })));
    }

    pub(super) fn read_hidden(&self) -> Option<Shared<Option<SharedBytes>>> {
        let whole = match self.hidden.take() {
            Hidden::Null => return None,
            Hidden::Incoming(incoming) => {
                Shared::spawn(async move { Some(incoming.read_to_end().await.ok()?.into_shared()) })
            }
            Hidden::Whole(whole) => whole,
            Hidden::Served => Shared::spawn(async { None }),
        };
        self.hidden.replace(Hidden::Whole(whole.clone()));
        Some(whole)
    }

    /// What a service worker answers with. `None` is a network error.
    #[optimize(size)]
    pub(crate) fn serve<'a>(&'a self, cx: Cx<'_, 'a>, busy: Busy) -> Option<Served> {
        if self.about.kind == b"error" || self.is_unusable() {
            return None;
        }
        let hidden = self.hidden.take();
        if !matches!(hidden, Hidden::Null) {
            self.hidden.replace(Hidden::Served);
        }
        let body = match hidden {
            Hidden::Served => return None,
            Hidden::Null => self
                .take_body(cx)
                .and_then(|it| it.into_upload(cx))
                .map_err(|it| cx.catch(it).map(drop))
                .ok()?
                .0
                .map(RequestBody::open)
                .unwrap_or_default(),
            Hidden::Incoming(incoming) => incoming.take(),
            Hidden::Whole(whole) => {
                let (writer, body) = pipe(0);
                bun_web::exec::spawn(async move {
                    let bytes = whole.await;
                    let outcome = bytes
                        .map(|it| writer.write(Chunk::Shared(it)))
                        .ok_or(NetError::Failed);
                    writer.end(outcome);
                });
                body
            }
        };
        let (
            body,
            About {
                kind,
                url,
                is_redirected,
                status,
                status_text,
                internal,
            },
        ) = (Outgoing::new(Holding { body, _busy: busy }), &self.about);
        let of = |flag: fn(&Head) -> bool, otherwise| internal.as_deref().map_or(otherwise, flag);
        let mut headers = self.headers.list().clone();
        if internal.is_none() && *kind == b"cors" {
            headers.set(b"access-control-expose-headers", b"*");
        }
        Some(Served {
            kind: ResponseType::parse(kind),
            url: internal
                .as_ref()
                .map(|it| it.url.without_fragment())
                .or(Some(url))
                .and_then(Url::parse),
            is_redirected: of(|it| it.redirects > 0, *is_redirected),
            allows_timing: of(|it| it.allows_timing, *kind != b"cors"),
            includes_credentials: of(|it| it.includes_credentials, false),
            has_credentials_mode_include: of(|it| it.has_credentials_mode_include, false),
            kept_as: internal.as_ref().map_or(0, |it| it.kept_as),
            answer: match internal {
                Some(it) => Answer::new(it.status, &it.status_text, it.headers.clone(), body),
                None => Answer::new(*status, status_text, headers, body),
            },
        })
    }

    /// <https://fetch.spec.whatwg.org/#initialize-a-response>
    #[optimize(size)]
    fn initialize<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        init: &DomResponseInit<'a>,
        body: Option<(Body<'a>, Option<Bytes>)>,
    ) -> Result<'a, &'a Self> {
        if !matches!(init.status, 200..=599) {
            return Err(
                heap.range_error(format_args!("The status is outside the range [200, 599]."))
            );
        }
        let status_text = bytes_of(&init.status_text);
        if !status_text
            .iter()
            .all(|it| matches!(it, b'\t' | b' '..=b'~' | 0x80..))
        {
            return Err(type_error(heap, "Invalid statusText"));
        }
        let headers = Guarded::new(HeaderList::default(), Guard::Response);
        init.headers
            .as_ref()
            .map_or(Ok(()), |it| headers.fill(heap, it))?;
        if body.is_some() && is_null_body_status(init.status) {
            return Err(type_error(
                heap,
                "A response with a null body status cannot have a body.",
            ));
        }
        let (body, mime) = body.unwrap_or_default();
        headers.set_type_if_absent(heap, mime.as_deref())?;
        let this = structure.create(
            heap,
            Response {
                base: Message::new(headers),
                about: About::new(b"default", init.status, &status_text),
                hidden: Default::default(),
            },
        );
        this.set_body(body);
        Ok(this)
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        body: JsLocal<'a>,
        init: &DomResponseInit<'a>,
    ) -> Result<'a, &'a Self> {
        let body = Some(body)
            .filter(|it| !it.to_js().is_undefined_or_null())
            .map(|it| Body::extract(cx, it, false))
            .transpose()?;
        Response::initialize(&cx.heap, structure, init, body)
    }

    pub(crate) fn error<'a>(heap: &JsHeap<'a>) -> &'a Response {
        Response::new(
            heap,
            About::new(b"error", 0, b""),
            HeaderList::default(),
            Guard::Immutable,
            Body::default(),
        )
    }

    #[optimize(size)]
    pub(crate) fn redirect<'a>(
        cx: Cx<'_, 'a>,
        url: &DomString,
        status: u16,
    ) -> Result<'a, &'a Response> {
        let heap = &cx.heap;
        let parsed = parse_url(heap, url).ok_or_else(|| {
            heap.type_error(format_args!("Failed to parse URL from {}", url.to_utf8()))
        })?;
        if !is_redirect_status(status) {
            return Err(heap.range_error(format_args!("Invalid status code")));
        }
        Ok(Response::new(
            heap,
            About::new(b"default", status, b""),
            [("Location", parsed.href())].into_iter().collect(),
            Guard::Immutable,
            Body::default(),
        ))
    }

    #[optimize(size)]
    pub(crate) fn of_json<'a>(
        cx: Cx<'_, 'a>,
        data: JsLocal<'a>,
        init: &DomResponseInit<'a>,
    ) -> Result<'a, &'a Response> {
        let text = data.to_js().json_stringify_fast(cx.global())?;
        if text.is_empty() {
            return Err(type_error(&cx.heap, "The data is not JSON serializable."));
        }
        let body = (
            text.to_owned_slice().into(),
            Some(b"application/json"[..].into()),
        );
        Response::initialize(
            &cx.heap,
            js_DomResponse::CLASS.structure(&cx.heap),
            init,
            Some(body),
        )
    }

    pub(crate) fn get_type<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(self.about.kind)
    }

    pub(crate) fn get_url<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(&self.about.url)
    }

    pub(crate) fn get_redirected(&self) -> bool {
        self.about.is_redirected
    }

    pub(crate) fn get_status(&self) -> u16 {
        self.about.status
    }

    pub(crate) fn get_ok(&self) -> bool {
        is_ok_status(self.about.status)
    }

    pub(crate) fn get_status_text<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(&self.about.status_text)
    }

    pub(crate) fn duplicate<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, &'a Response> {
        let body = self.clone_body(cx)?;
        let copy = Response::new(
            self.realm(&cx.heap),
            self.about.clone(),
            self.headers.list().clone(),
            self.headers.guard,
            body,
        );
        copy.hidden
            .replace(self.read_hidden().map_or(Hidden::Null, Hidden::Whole));
        Ok(copy)
    }
}
