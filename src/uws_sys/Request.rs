use core::ffi::c_ushort;
use std::borrow::Cow;

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
                let r = bun_opaque::opaque_deref_mut(*r);
                TelemetryHeaders {
                    host: RawSlice::of(r.header(b"host")),
                    user_agent: RawSlice::of(r.header(b"user-agent")),
                    traceparent: RawSlice::of(r.header(b"traceparent")),
                    tracestate: RawSlice::of(r.header(b"tracestate")),
                    baggage: RawSlice::of(r.header(b"baggage")),
                    forwarded: RawSlice::of(r.header(b"forwarded")),
                    x_forwarded_for: RawSlice::of(r.header(b"x-forwarded-for")),
                    path_len: u32::MAX,
                    http10: 0,
                    // H3 cannot see repeats in one pass; the caller joins.
                    tracestate_repeated: 1,
                    baggage_repeated: 1,
                    // (a valid traceparent has no comma; a joined repeat does)
                    traceparent_repeated: r
                        .header_joined(b"traceparent")
                        .is_some_and(|v| v.contains(&b','))
                        as u8,
                    _req: core::marker::PhantomData,
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

/// `(ptr, len)` of a header value inside the request; null = absent.
#[repr(C)]
#[derive(Clone, Copy)]
struct RawSlice {
    ptr: *const u8,
    len: usize,
}

impl RawSlice {
    const NONE: RawSlice = RawSlice {
        ptr: core::ptr::null(),
        len: 0,
    };
    #[inline]
    fn of(s: Option<&[u8]>) -> RawSlice {
        match s {
            Some(s) => RawSlice {
                ptr: s.as_ptr(),
                len: s.len(),
            },
            None => RawSlice::NONE,
        }
    }
}

/// Values of the headers telemetry reads, found in one pass over the header
/// block. Mirrors `uws_telemetry_headers_t`.
#[repr(C)]
pub struct TelemetryHeaders<'a> {
    host: RawSlice,
    user_agent: RawSlice,
    traceparent: RawSlice,
    tracestate: RawSlice,
    baggage: RawSlice,
    forwarded: RawSlice,
    x_forwarded_for: RawSlice,
    /// Length of the path part of `url()` (up to `?`); `u32::MAX` if unknown.
    pub path_len: u32,
    /// The request line said `HTTP/1.0` (H1 only).
    pub http10: u8,
    /// More than one `tracestate` / `baggage` field was present: use `header_joined`.
    pub tracestate_repeated: u8,
    pub baggage_repeated: u8,
    /// More than one `traceparent` field: the header is invalid (W3C trace-context).
    pub traceparent_repeated: u8,
    _req: core::marker::PhantomData<&'a Request>,
}

impl<'a> TelemetryHeaders<'a> {
    #[inline]
    fn get(&self, s: RawSlice) -> Option<&'a [u8]> {
        if s.ptr.is_null() {
            return None;
        }
        // SAFETY: ptr/len describe a slice owned by the request for its lifetime.
        Some(unsafe { bun_core::ffi::slice(s.ptr, s.len) })
    }
    pub fn host(&self) -> Option<&'a [u8]> {
        self.get(self.host)
    }
    pub fn user_agent(&self) -> Option<&'a [u8]> {
        self.get(self.user_agent)
    }
    pub fn traceparent(&self) -> Option<&'a [u8]> {
        self.get(self.traceparent)
    }
    pub fn tracestate(&self) -> Option<&'a [u8]> {
        self.get(self.tracestate)
    }
    pub fn baggage(&self) -> Option<&'a [u8]> {
        self.get(self.baggage)
    }
    pub fn forwarded(&self) -> Option<&'a [u8]> {
        self.get(self.forwarded)
    }
    pub fn x_forwarded_for(&self) -> Option<&'a [u8]> {
        self.get(self.x_forwarded_for)
    }
}

/// `uws_*_for_each_header_value` callback: joins values into `*user`
/// (an `Option<Vec<u8>>`) with `", "`.
pub(crate) unsafe extern "C" fn push_joined_header_value(
    value: *const u8,
    len: usize,
    user: *mut core::ffi::c_void,
) {
    // SAFETY: `user` is the `&mut Option<Cow<[u8]>>` the caller passed alongside this callback.
    let out = unsafe { &mut *user.cast::<Option<Cow<'_, [u8]>>>() };
    // SAFETY: value/len is a slice owned by the request for its lifetime (the
    // same storage `header()` borrows from).
    let v = unsafe { bun_core::ffi::slice(value, len) };
    match out {
        None => *out = Some(Cow::Borrowed(v)),
        Some(joined) => {
            let buf = joined.to_mut();
            buf.extend_from_slice(b", ");
            buf.extend_from_slice(v);
        }
    }
}

impl Request {
    pub fn set_yield(&mut self, yield_: bool) {
        c::uws_req_set_yield(self, yield_)
    }
    pub fn url(&self) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        let len = c::uws_req_get_url(self, &mut ptr);
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime;
        // ffi::slice tolerates the (null, 0) shape uWS returns when no URL is present.
        unsafe { bun_core::ffi::slice(ptr, len) }
    }
    pub fn method(&self) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        let len = c::uws_req_get_method(self, &mut ptr);
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime;
        // ffi::slice tolerates the (null, 0) shape uWS returns when no method is present.
        unsafe { bun_core::ffi::slice(ptr, len) }
    }
    pub fn telemetry_headers(&self) -> TelemetryHeaders<'_> {
        let mut out = TelemetryHeaders {
            host: RawSlice::NONE,
            user_agent: RawSlice::NONE,
            traceparent: RawSlice::NONE,
            tracestate: RawSlice::NONE,
            baggage: RawSlice::NONE,
            forwarded: RawSlice::NONE,
            x_forwarded_for: RawSlice::NONE,
            path_len: u32::MAX,
            http10: 0,
            tracestate_repeated: 0,
            baggage_repeated: 0,
            traceparent_repeated: 0,
            _req: core::marker::PhantomData,
        };
        c::uws_req_telemetry_headers(self, &mut out);
        out
    }
    /// Every value of `name` (lower-case): the field itself when it occurs
    /// once, every field joined with `", "` when it repeats; `None` when absent.
    pub fn header_joined(&self, name: &[u8]) -> Option<Cow<'_, [u8]>> {
        let mut out: Option<Cow<'_, [u8]>> = None;
        // SAFETY: name is a valid slice; the callback only runs during the call with `out` alive.
        unsafe {
            c::uws_req_for_each_header_value(
                self,
                name.as_ptr(),
                name.len(),
                push_joined_header_value,
                (&raw mut out).cast(),
            )
        };
        out
    }
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        debug_assert!(name[0].is_ascii_lowercase());

        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_header writes a pointer into request-owned storage and returns its length
        let len = unsafe { c::uws_req_get_header(self, name.as_ptr(), name.len(), &raw mut ptr) };
        if len == 0 {
            return None;
        }
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime
        Some(unsafe { bun_core::ffi::slice(ptr, len) })
    }
    /// The parser's verdict on the Transfer-Encoding header, the one that
    /// selects chunked body framing. `header(b"transfer-encoding")` sees only
    /// the first field and reports an empty value as `None`, so it disagrees
    /// with the framing for "Transfer-Encoding:" followed by
    /// "Transfer-Encoding: chunked".
    pub fn has_transfer_encoding(&self) -> bool {
        c::uws_req_has_transfer_encoding(self)
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
    use super::{Request, TelemetryHeaders};
    use core::ffi::c_ushort;

    unsafe extern "C" {
        pub(super) safe fn uws_req_set_yield(res: &mut Request, yield_: bool);
        // Out-param `dest` is a `&mut *const u8` (non-null, valid for write); the C
        // shim only stores a pointer into request-owned storage and returns its
        // length — no read-through-ptr precondition, so `safe fn`.
        pub(super) safe fn uws_req_get_url(res: &Request, dest: &mut *const u8) -> usize;
        pub(super) safe fn uws_req_get_method(res: &Request, dest: &mut *const u8) -> usize;
        pub(super) safe fn uws_req_telemetry_headers(res: &Request, out: &mut TelemetryHeaders<'_>);
        pub(super) fn uws_req_for_each_header_value(
            res: *const Request,
            lower_case_name: *const u8,
            name_len: usize,
            handler: unsafe extern "C" fn(*const u8, usize, *mut core::ffi::c_void),
            user_data: *mut core::ffi::c_void,
        );
        pub(super) fn uws_req_get_header(
            res: *const Request,
            lower_case_header: *const u8,
            lower_case_header_length: usize,
            dest: *mut *const u8,
        ) -> usize;
        pub(super) safe fn uws_req_get_parameter(
            res: &Request,
            index: c_ushort,
            dest: &mut *const u8,
        ) -> usize;
        pub(super) safe fn uws_req_has_transfer_encoding(res: &Request) -> bool;
    }
}
