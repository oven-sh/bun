use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use core::ptr;

use bun_http_types::Method::Method;
use bun_http_types::router::{Parameters, Router};

use crate::h3::Request as H3Request;

/// Transport-agnostic request handle. Static/file routes (and RangeRequest)
/// take this so the same handler body serves HTTP/1.1 and HTTP/3 without
/// `anytype` — `inline else` keeps dispatch monomorphic.
pub enum AnyRequest {
    H1(*mut Request),
    H3(*mut H3Request),
}

impl AnyRequest {
    // S008: variant payloads are `opaque_ffi!` ZST handles (`Request` /
    // `h3::Request`); route the per-arm `*mut → &mut` deref through the
    // const-asserted `bun_opaque::opaque_deref_mut` so dispatch is `unsafe`-free.
    #[inline]
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        match self {
            Self::H1(r) => bun_opaque::opaque_deref_mut(*r).header(name),
            Self::H3(r) => bun_opaque::opaque_deref_mut(*r).header(name),
        }
    }
    pub fn method(&self) -> Method {
        match self {
            Self::H1(r) => bun_opaque::opaque_deref_mut(*r).method(),
            Self::H3(r) => bun_opaque::opaque_deref_mut(*r).method(),
        }
    }
    pub fn url(&self) -> &[u8] {
        match self {
            Self::H1(r) => bun_opaque::opaque_deref_mut(*r).url(),
            Self::H3(r) => bun_opaque::opaque_deref_mut(*r).url(),
        }
    }
    pub fn set_yield(&mut self, y: bool) {
        match self {
            Self::H1(r) => bun_opaque::opaque_deref_mut(*r).set_yield(y),
            Self::H3(r) => bun_opaque::opaque_deref_mut(*r).set_yield(y),
        }
    }
}

/// What a handler gets.
#[repr(C)]
pub(crate) struct Routed<'a, H> {
    pub(crate) head: H,
    pub(crate) method: Method,
    pub(crate) has_yielded: Cell<bool>,
    pub(crate) parameters: Parameters<'a>,
}

impl<H> Routed<'_, H> {
    pub(crate) fn new(method: Method, head: H) -> Self {
        Self {
            head,
            method,
            has_yielded: Cell::new(false),
            parameters: Parameters::new(),
        }
    }
}

pub(crate) type Handler<Res, Req> = extern "C" fn(*mut Res, *mut Req, *mut c_void);

/// Not borrowed while a handler runs, which may change them.
pub(crate) struct Routes<Res, Req>(RefCell<Router<(Handler<Res, Req>, *mut c_void)>>);

impl<Res, Req> Default for Routes<Res, Req> {
    fn default() -> Self {
        Self(RefCell::default())
    }
}

impl<Res, Req> Routes<Res, Req> {
    pub(crate) fn add(
        &self,
        method: Option<Method>,
        pattern: &[u8],
        handler: Handler<Res, Req>,
        user_data: *mut c_void,
    ) {
        (self.0.borrow_mut()).add(method, pattern, (handler, user_data));
    }

    pub(crate) fn clear(&self) {
        self.0.take();
    }

    /// False if no handler took it. `Req` is the handle of `request`.
    pub(crate) fn dispatch<'a, H>(
        &self,
        path: &'a [u8],
        response: *mut Res,
        request: &mut Routed<'a, H>,
        before_first_handler: impl Fn(),
    ) -> bool {
        let mut skip = 0;
        loop {
            let found = (self.0.borrow()).find(request.method, path, skip, &mut request.parameters);
            let Some((handler, user_data)) = found else {
                return false;
            };
            if skip == 0 {
                before_first_handler();
            }
            handler(response, ptr::from_mut(request).cast(), user_data);
            if !request.has_yielded.replace(false) {
                return true;
            }
            skip += 1;
        }
    }
}

bun_opaque::opaque_ffi! {
    /// `uWS::HttpRequest`
    pub struct Request;
}

impl Request {
    fn routed(&self) -> &Routed<'_, &bun_http1::request::Request<'_>> {
        // SAFETY: `http1::Routes::dispatch` lent it to the handler that has `self` on its stack.
        unsafe { &*self.as_mut_ptr().cast() }
    }
    /// The next route gets it.
    pub fn set_yield(&mut self, yield_: bool) {
        self.routed().has_yielded.set(yield_)
    }
    pub fn parsed(&self) -> &bun_http1::request::Request<'_> {
        self.routed().head
    }
    pub fn parameters(&self) -> &Parameters<'_> {
        &self.routed().parameters
    }
    pub fn url(&self) -> &[u8] {
        self.parsed().target()
    }
    pub fn method(&self) -> Method {
        self.routed().method
    }
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        debug_assert!(name[0].is_ascii_lowercase());
        self.parsed().field(name).filter(|value| !value.is_empty())
    }
    /// The parser's verdict on the Transfer-Encoding header, the one that
    /// selects chunked body framing. `header(b"transfer-encoding")` sees only
    /// the first field and reports an empty value as `None`, so it disagrees
    /// with the framing for "Transfer-Encoding:" followed by
    /// "Transfer-Encoding: chunked".
    pub fn has_transfer_encoding(&self) -> bool {
        self.parsed().has_transfer_encoding()
    }
    pub fn parameter(&self, index: usize) -> &[u8] {
        self.parameters().get(index).copied().unwrap_or_default()
    }
}
