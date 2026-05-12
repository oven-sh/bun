use core::ffi::{c_char, c_ushort};
use core::marker::{PhantomData, PhantomPinned};

// TODO(port): verify module path for H3 request opaque (h3.zig:19 — H3.Request = opaque{})
use crate::h3::Request as H3Request;

// PORT NOTE: `dateForHeader` (Request.zig:62) is NOT ported here. Parsing an
// HTTP date needs `bun_jsc::VirtualMachine` (T6); rather than hook upward, the
// sole caller (`bun_runtime::server::FileRoute`) does
// `req.header(name).and_then(parse_http_date)` itself — call site moved UP per
// docs/PORTING.md §"Low crate needs to call high crate" option (a).

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

impl Request {
    pub fn is_ancient(&self) -> bool {
        c::uws_req_is_ancient(self)
    }
    pub fn get_yield(&self) -> bool {
        c::uws_req_get_yield(self)
    }
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
    pub fn query(&self, name: &[u8]) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_query writes a pointer into request-owned storage and returns its length
        let len = unsafe { c::uws_req_get_query(self, name.as_ptr(), name.len(), &raw mut ptr) };
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime;
        // ffi::slice tolerates the (null, 0) shape uWS returns when no query is present.
        unsafe { bun_core::ffi::slice(ptr, len) }
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
    use core::ffi::c_ushort;

    unsafe extern "C" {
        pub safe fn uws_req_is_ancient(res: &Request) -> bool;
        pub safe fn uws_req_get_yield(res: &Request) -> bool;
        pub safe fn uws_req_set_yield(res: &mut Request, yield_: bool);
        // Out-param `dest` is a `&mut *const u8` (non-null, valid for write); the C
        // shim only stores a pointer into request-owned storage and returns its
        // length — no read-through-ptr precondition, so `safe fn`.
        pub safe fn uws_req_get_url(res: &Request, dest: &mut *const u8) -> usize;
        pub safe fn uws_req_get_method(res: &Request, dest: &mut *const u8) -> usize;
        pub fn uws_req_get_header(
            res: *const Request,
            lower_case_header: *const u8,
            lower_case_header_length: usize,
            dest: *mut *const u8,
        ) -> usize;
        pub fn uws_req_get_query(
            res: *const Request,
            key: *const u8,
            key_length: usize,
            dest: *mut *const u8,
        ) -> usize;
        pub safe fn uws_req_get_parameter(
            res: &Request,
            index: c_ushort,
            dest: &mut *const u8,
        ) -> usize;
    }
}

// ported from: src/uws_sys/Request.zig
