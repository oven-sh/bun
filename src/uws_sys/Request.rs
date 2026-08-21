use core::ffi::c_ushort;

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
    pub fn telemetry_headers(&self) -> TelemetryHeaders<'_> {
        match self {
            Self::H1(r) => bun_opaque::opaque_deref_mut(*r).telemetry_headers(),
            Self::H3(r) => {
                let r = bun_opaque::opaque_deref_mut(*r);
                let mut out = TelemetryHeaders {
                    ptr: [core::ptr::null(); 5],
                    len: [0; 5],
                    path_len: u32::MAX,
                    _req: core::marker::PhantomData,
                };
                for (i, name) in [
                    &b"host"[..],
                    b"user-agent",
                    b"traceparent",
                    b"tracestate",
                    b"baggage",
                ]
                .iter()
                .enumerate()
                {
                    if let Some(v) = r.header(name) {
                        out.ptr[i] = v.as_ptr();
                        out.len[i] = v.len() as u32;
                    }
                }
                out
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

/// Values of the headers telemetry reads, found in one pass over the header
/// block: host, user-agent, traceparent, tracestate, baggage.
#[repr(C)]
pub struct TelemetryHeaders<'a> {
    ptr: [*const u8; 5],
    len: [u32; 5],
    /// Length of the path part of `url()` (up to `?`); `u32::MAX` if unknown.
    pub path_len: u32,
    _req: core::marker::PhantomData<&'a Request>,
}

impl<'a> TelemetryHeaders<'a> {
    #[inline]
    fn get(&self, i: usize) -> Option<&'a [u8]> {
        if self.ptr[i].is_null() {
            return None;
        }
        // SAFETY: ptr/len describe a slice owned by the request for its lifetime.
        Some(unsafe { bun_core::ffi::slice(self.ptr[i], self.len[i] as usize) })
    }
    pub fn host(&self) -> Option<&'a [u8]> {
        self.get(0)
    }
    pub fn user_agent(&self) -> Option<&'a [u8]> {
        self.get(1)
    }
    pub fn traceparent(&self) -> Option<&'a [u8]> {
        self.get(2)
    }
    pub fn tracestate(&self) -> Option<&'a [u8]> {
        self.get(3)
    }
    pub fn baggage(&self) -> Option<&'a [u8]> {
        self.get(4)
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
            ptr: [core::ptr::null(); 5],
            len: [0; 5],
            path_len: u32::MAX,
            _req: core::marker::PhantomData,
        };
        c::uws_req_telemetry_headers(self, &mut out);
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
    }
}
