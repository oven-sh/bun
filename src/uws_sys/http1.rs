//! The request parser and the routes for packages/bun-uws/src/HttpParser.h.

use core::cell::RefCell;
use core::ffi::{c_int, c_void};
use core::mem::{MaybeUninit, offset_of};
use core::ptr;

use bun_http_types::Method::Method;
use bun_http_types::router::{Parameters, Router};
use bun_http1::request::{
    Connection, Outcome, Request, RequestOptions, RequestParser, read as read_requests,
};

use crate::request::{self, Routed};
use crate::response::c::uws_res_write_continue;
use crate::uws_res;
use crate::web_socket::UpgradeRoute;

const _: () = assert!(
    size_of::<RequestParser>() == 80
        && align_of::<RequestParser>() == 8
        && offset_of!(RequestParser, is_closing) == 0
        && offset_of!(RequestParser, is_body_until_eof) == 1
        && offset_of!(RequestParser, is_tunnel) == 2
);

#[repr(C)]
pub(crate) struct Bytes {
    data: *const u8,
    len: usize,
}

impl From<&[u8]> for Bytes {
    fn from(bytes: &[u8]) -> Self {
        Self {
            data: bytes.as_ptr(),
            len: bytes.len(),
        }
    }
}

/// LTO does not inline a function that returns `Bytes`: clang and rustc give it different types.
pub(crate) type Out<'a> = &'a mut MaybeUninit<Bytes>;

/// The handlers return null if the read is over, as it is once the parser is destroyed.
#[repr(C)]
struct Socket {
    parser: *mut RequestParser,
    user: *mut c_void,
    on_request: extern "C" fn(*mut c_void, &Request<'_>) -> *mut c_void,
    on_body: extern "C" fn(*mut c_void, Bytes, bool) -> *mut c_void,
}

impl Connection for &mut Socket {
    fn parser(&mut self) -> &mut RequestParser {
        // SAFETY: no handler has returned null, and none runs while this is borrowed.
        unsafe { &mut *self.parser }
    }

    fn on_request(self, request: &Request<'_>) -> Option<Self> {
        (!(self.on_request)(self.user, request).is_null()).then_some(self)
    }

    fn on_body(self, data: &[u8], is_last: bool) -> Option<Self> {
        (!(self.on_body)(self.user, data.into(), is_last).is_null()).then_some(self)
    }
}

#[repr(C)]
struct ReadResult {
    /// 0 if there is none.
    error: u8,
    is_stopped: bool,
    consumed: usize,
    error_response: Bytes,
}

impl From<Outcome> for ReadResult {
    fn from(outcome: Outcome) -> Self {
        let (error, consumed, error_response) = match outcome {
            Outcome::Consumed => (0, 0, &b""[..]),
            Outcome::Stopped { consumed } => (0, consumed, &b""[..]),
            Outcome::Failed(error) => (error as u8, 0, error.response()),
        };
        Self {
            error,
            is_stopped: outcome != Outcome::Consumed,
            consumed,
            error_response: error_response.into(),
        }
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__RequestParser__construct(
    parser: &mut MaybeUninit<RequestParser>,
    default_max_head_len: usize,
) {
    parser.write(RequestParser::new(default_max_head_len));
}

/// SAFETY: `parser` was constructed, and is not used again.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__RequestParser__destruct(parser: &mut MaybeUninit<RequestParser>) {
    // SAFETY: forwarded.
    unsafe { parser.assume_init_drop() }
}

/// SAFETY: `data` has `len` bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__RequestParser__read(
    socket: &mut Socket,
    data: *const u8,
    len: usize,
    options: &RequestOptions,
) -> ReadResult {
    // SAFETY: forwarded.
    let bytes = unsafe { bun_core::ffi::slice(data, len) };
    read_requests::<false>(socket, bytes, options).into()
}

/// SAFETY: `data` has `len` bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__RequestParser__readForNode(
    socket: &mut Socket,
    data: *const u8,
    len: usize,
    options: &RequestOptions,
) -> ReadResult {
    // SAFETY: forwarded.
    let bytes = unsafe { bun_core::ffi::slice(data, len) };
    read_requests::<true>(socket, bytes, options).into()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__RequestParser__hasPartialHead(parser: &RequestParser) -> bool {
    parser.has_partial_head()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__RequestParser__hasIncompleteBody(parser: &RequestParser) -> bool {
    parser.has_incomplete_body()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__target(request: &Request<'_>, out: Out<'_>) {
    out.write(request.target().into());
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__afterHead(request: &Request<'_>, out: Out<'_>) {
    out.write(request.after_head().into());
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__isHttp10(request: &Request<'_>) -> bool {
    request.is_http_1_0()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__nextField(
    request: &Request<'_>,
    index: &mut usize,
    name: Out<'_>,
    value: Out<'_>,
) -> bool {
    request.field_at(*index).is_some_and(|field| {
        *index += 1;
        name.write(field.name.into());
        value.write(field.value.into());
        true
    })
}

#[unsafe(no_mangle)]
extern "C" fn Bun__RouteParameters__at(parameters: &Parameters<'_>, index: usize, out: Out<'_>) {
    out.write(parameters.get(index).copied().unwrap_or_default().into());
}

#[derive(Default)]
pub(crate) struct Routes {
    pub(crate) requests: request::Routes<uws_res, crate::Request>,
    /// They go first.
    pub(crate) upgrades: RefCell<Router<UpgradeRoute>>,
}

impl Routes {
    fn find_upgrade<'a>(
        &self,
        path: &'a [u8],
        request: &mut Routed<'a, &Request<'_>>,
    ) -> Option<UpgradeRoute> {
        let upgrades = self.upgrades.borrow();
        if upgrades.is_empty() || request.head.field(b"sec-websocket-key")?.len() != 24 {
            return None;
        }
        upgrades.find(Method::GET, path, 0, &mut request.parameters)
    }
}

/// False if no handler took it.
#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Routes__dispatch(
    routes: &Routes,
    ssl: c_int,
    response: *mut uws_res,
    head: &Request<'_>,
    answers_expect: bool,
) -> bool {
    let Some(method) = Method::find_uppercase(head.method()) else {
        return false;
    };
    let write_continue = || {
        if answers_expect && head.field(b"expect") == Some(b"100-continue") {
            uws_res_write_continue(ssl, uws_res::opaque_mut(response));
        }
    };
    let (path, mut request) = (head.path(), Routed::new(method, head));
    if method == Method::GET
        && let Some(upgrade) = routes.find_upgrade(path, &mut request)
    {
        write_continue();
        let handle = crate::Request::opaque_mut(ptr::from_mut(&mut request).cast());
        upgrade.run(response, handle);
        debug_assert!(!request.has_yielded.get());
        return true;
    }
    (routes.requests).dispatch(path, response, &mut request, write_continue)
}
