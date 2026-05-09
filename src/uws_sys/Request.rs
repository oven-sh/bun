use core::ffi::{c_ushort, c_char};
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
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        // SAFETY: variant pointers are non-null FFI handles owned by uWS/lsquic for the
        // duration of the request callback; returned slice borrows request-internal storage.
        match self {
            Self::H1(r) => unsafe { (**r).header(name) },
            Self::H3(r) => unsafe { (**r).header(name) },
        }
    }
    pub fn method(&self) -> &[u8] {
        // SAFETY: see header()
        match self {
            Self::H1(r) => unsafe { (**r).method() },
            Self::H3(r) => unsafe { (**r).method() },
        }
    }
    pub fn url(&self) -> &[u8] {
        // SAFETY: see header()
        match self {
            Self::H1(r) => unsafe { (**r).url() },
            Self::H3(r) => unsafe { (**r).url() },
        }
    }
    pub fn set_yield(&mut self, y: bool) {
        // SAFETY: see header(); set_yield mutates the underlying uWS/lsquic request state
        match self {
            Self::H1(r) => unsafe { (&mut **r).set_yield(y) },
            Self::H3(r) => unsafe { (&mut **r).set_yield(y) },
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
        // SAFETY: uws_req_get_url writes a pointer into request-owned storage and returns its length
        let len = unsafe { c::uws_req_get_url(self, &raw mut ptr) };
        if len == 0 {
            return &[];
        }
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
    pub fn method(&self) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_method writes a pointer into request-owned storage and returns its length
        let len = unsafe { c::uws_req_get_method(self, &raw mut ptr) };
        if len == 0 {
            return &[];
        }
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime
        unsafe { core::slice::from_raw_parts(ptr, len) }
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
        Some(unsafe { core::slice::from_raw_parts(ptr, len) })
    }
    pub fn query(&self, name: &[u8]) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_query writes a pointer into request-owned storage and returns its length
        let len = unsafe { c::uws_req_get_query(self, name.as_ptr(), name.len(), &raw mut ptr) };
        if len == 0 {
            return &[];
        }
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
    pub fn parameter(&self, index: u16) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_parameter writes a pointer into request-owned storage and returns its length
        let len =
            unsafe { c::uws_req_get_parameter(self, c_ushort::try_from(index).unwrap(), &raw mut ptr) };
        if len == 0 {
            return &[];
        }
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
}

mod c {
    use super::Request;
    use core::ffi::c_ushort;

    unsafe extern "C" {
        pub safe fn uws_req_is_ancient(res: &Request) -> bool;
        pub safe fn uws_req_get_yield(res: &Request) -> bool;
        pub safe fn uws_req_set_yield(res: &mut Request, yield_: bool);
        pub fn uws_req_get_url(res: *const Request, dest: *mut *const u8) -> usize;
        pub fn uws_req_get_method(res: *const Request, dest: *mut *const u8) -> usize;
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
        pub fn uws_req_get_parameter(
            res: *const Request,
            index: c_ushort,
            dest: *mut *const u8,
        ) -> usize;
    }
}

// ported from: src/uws_sys/Request.zig
