//! The request parser for packages/bun-uws/src/HttpParser.h.

use core::ffi::c_void;
use core::mem::{MaybeUninit, offset_of};

use bun_http1::request::{
    Connection, Outcome, Request, RequestOptions, RequestParser, read as read_requests,
    read_for_node,
};

const _: () = assert!(
    size_of::<RequestParser>() == 80
        && align_of::<RequestParser>() == 8
        && offset_of!(RequestParser, is_closing) == 0
        && offset_of!(RequestParser, is_body_until_eof) == 1
        && offset_of!(RequestParser, is_tunnel) == 2
);

#[repr(C)]
struct Bytes {
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
type Out<'a> = &'a mut MaybeUninit<Bytes>;

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
    read_for_node(socket, bytes, options).into()
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
extern "C" fn Bun__Http1Request__method(request: &Request<'_>, out: Out<'_>) {
    out.write(request.method().into());
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__target(request: &Request<'_>, out: Out<'_>) {
    out.write(request.target().into());
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__path(request: &Request<'_>, out: Out<'_>) {
    out.write(request.path().into());
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__afterHead(request: &Request<'_>, out: Out<'_>) {
    out.write(request.after_head().into());
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__isHttp10(request: &Request<'_>) -> bool {
    request.is_http_1_0()
}

/// SAFETY: `name` has `len` bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Http1Request__field(
    request: &Request<'_>,
    name: *const u8,
    len: usize,
    out: Out<'_>,
) {
    // SAFETY: forwarded.
    let name = unsafe { bun_core::ffi::slice(name, len) };
    out.write(request.field(name).unwrap_or_default().into());
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Http1Request__fieldAt(
    request: &Request<'_>,
    index: usize,
    name: Out<'_>,
    value: Out<'_>,
) -> bool {
    request.field_at(index).is_some_and(|field| {
        name.write(field.name.into());
        value.write(field.value.into());
        true
    })
}
