use core::ffi::c_ushort;
use std::borrow::Cow;

use bun_core::strings;
use bun_http1::request::Field;

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
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        match self {
            Self::H1(r) => bun_opaque::opaque_deref_mut(*r).header(name),
            Self::H3(r) => bun_opaque::opaque_deref_mut(*r).header(name),
        }
    }
    /// Every value of `name` (lower-case), joined with `", "` when it repeats.
    pub fn header_joined(&self, name: &[u8]) -> Option<Cow<'_, [u8]>> {
        match self {
            Self::H1(r) => bun_opaque::opaque_deref_mut(*r).header_joined(name),
            Self::H3(r) => bun_opaque::opaque_deref_mut(*r).header_joined(name),
        }
    }
    pub fn telemetry_headers(&self) -> TelemetryHeaders<'_> {
        match self {
            Self::H1(r) => bun_opaque::opaque_deref_mut(*r).telemetry_headers(),
            Self::H3(r) => {
                let r = || bun_opaque::opaque_deref_mut(*r);
                TelemetryHeaders {
                    host: r().header(b"host"),
                    user_agent: r().header(b"user-agent"),
                    traceparent: r().header(b"traceparent"),
                    tracestate: r().header(b"tracestate"),
                    baggage: r().header(b"baggage"),
                    forwarded: r().header(b"forwarded"),
                    x_forwarded_for: r().header(b"x-forwarded-for"),
                    is_http_1_0: false,
                    tracestate_may_repeat: true,
                    baggage_may_repeat: true,
                    // A valid one has no comma.
                    traceparent_repeats: (r().header_joined(b"traceparent"))
                        .is_some_and(|value| strings::contains_char(&value, b',')),
                }
            }
        }
    }
    pub fn method(&self) -> &[u8] {
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

bun_opaque::opaque_ffi! {
    /// uWS::Request C++ -> Rust bindings.
    pub struct Request;
}

/// The first value of each header that telemetry reads.
#[derive(Default)]
pub struct TelemetryHeaders<'a> {
    pub host: Option<&'a [u8]>,
    pub user_agent: Option<&'a [u8]>,
    pub traceparent: Option<&'a [u8]>,
    pub tracestate: Option<&'a [u8]>,
    pub baggage: Option<&'a [u8]>,
    pub forwarded: Option<&'a [u8]>,
    pub x_forwarded_for: Option<&'a [u8]>,
    pub is_http_1_0: bool,
    pub tracestate_may_repeat: bool,
    pub baggage_may_repeat: bool,
    pub traceparent_repeats: bool,
}

pub(crate) fn join_header_value<'a>(joined: &mut Option<Cow<'a, [u8]>>, value: &'a [u8]) {
    match joined {
        None => *joined = Some(Cow::Borrowed(value)),
        Some(joined) => {
            let joined = joined.to_mut();
            joined.extend_from_slice(b", ");
            joined.extend_from_slice(value);
        }
    }
}

/// `name` is a token, so it has none of the control bytes that `| 0x20` would take for `-`.
#[inline(always)]
fn is_named<const N: usize>(name: &[u8], lowercase: &[u8; N]) -> bool {
    <&[u8; N]>::try_from(name).is_ok_and(|name| name.map(|byte| byte | 0x20) == *lowercase)
}

impl Request {
    pub fn set_yield(&mut self, yield_: bool) {
        c::uws_req_set_yield(self, yield_)
    }
    pub fn parsed(&self) -> &bun_http1::request::Request<'_> {
        // SAFETY: http1.rs lent it to the handler that has `self` on its stack.
        unsafe { &*c::uws_req_get_parsed(self).cast() }
    }
    pub fn url(&self) -> &[u8] {
        self.parsed().target()
    }
    pub fn method(&self) -> &[u8] {
        self.parsed().lowercase_method()
    }
    #[inline]
    fn telemetry_headers(&self) -> TelemetryHeaders<'_> {
        let request = self.parsed();
        let mut headers = TelemetryHeaders {
            is_http_1_0: request.is_http_1_0(),
            ..Default::default()
        };
        for Field { name, value } in request.fields() {
            let first = match name.len() {
                4 if is_named(name, b"host") => &mut headers.host,
                7 if is_named(name, b"baggage") => {
                    headers.baggage_may_repeat = headers.baggage.is_some();
                    &mut headers.baggage
                }
                9 if is_named(name, b"forwarded") => &mut headers.forwarded,
                10 if is_named(name, b"user-agent") => &mut headers.user_agent,
                10 if is_named(name, b"tracestate") => {
                    headers.tracestate_may_repeat = headers.tracestate.is_some();
                    &mut headers.tracestate
                }
                11 if is_named(name, b"traceparent") => {
                    headers.traceparent_repeats = headers.traceparent.is_some();
                    &mut headers.traceparent
                }
                15 if is_named(name, b"x-forwarded-for") => &mut headers.x_forwarded_for,
                _ => continue,
            };
            first.get_or_insert(value);
        }
        headers
    }
    fn header_joined(&self, name: &[u8]) -> Option<Cow<'_, [u8]>> {
        let mut joined = None;
        for field in self.parsed().fields() {
            if strings::eql_case_insensitive_ascii_check_length(field.name, name) {
                join_header_value(&mut joined, field.value);
            }
        }
        joined
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
    pub fn parameter(&self, index: u16) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        let len = c::uws_req_get_parameter(self, c_ushort::try_from(index).unwrap(), &mut ptr);
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime;
        // ffi::slice tolerates the (null, 0) shape uWS returns when no parameter is present.
        unsafe { bun_core::ffi::slice(ptr, len) }
    }
}

mod c {
    use super::Request;
    use core::ffi::{c_ushort, c_void};

    unsafe extern "C" {
        pub(super) safe fn uws_req_set_yield(res: &mut Request, yield_: bool);
        pub(super) safe fn uws_req_get_parsed(res: &Request) -> *const c_void;
        // Out-param `dest` is a `&mut *const u8` (non-null, valid for write); the C
        // shim only stores a pointer into request-owned storage and returns its
        // length — no read-through-ptr precondition, so `safe fn`.
        pub(super) safe fn uws_req_get_parameter(
            res: &Request,
            index: c_ushort,
            dest: &mut *const u8,
        ) -> usize;
    }
}
