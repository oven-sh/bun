//! <https://fetch.spec.whatwg.org/#response-class>

use bun_web::net::response::{
    Head, ResponseType, is_null_body_status, is_ok_status, is_redirect_status,
};

use super::body::Body;
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
}

impl About {
    fn new(kind: &'static [u8], status: u16, status_text: &[u8]) -> About {
        About {
            kind,
            url: Bytes::default(),
            is_redirected: false,
            status,
            status_text: status_text.into(),
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
            ..About::new(head.kind.as_bytes(), status, status_text)
        }
    }
}

#[repr(C)]
pub(crate) struct Response {
    pub(crate) base: Message,
    pub(crate) about: About,
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
            },
        );
        this.set_body(body);
        this
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
        Ok(Response::new(
            self.realm(&cx.heap),
            self.about.clone(),
            self.headers.list().clone(),
            self.headers.guard,
            body,
        ))
    }
}
