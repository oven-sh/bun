use core::ffi::{c_ushort, c_char};
use core::marker::{PhantomData, PhantomPinned};

use bun_jsc::{JsResult, VirtualMachine};
use bun_str::String as BunString;

// TODO(port): verify module path for H3 request opaque (h3.zig:19 — H3.Request = opaque{})
use crate::h3::Request as H3Request;

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
    pub fn set_yield(&self, y: bool) {
        // SAFETY: see header()
        match self {
            Self::H1(r) => unsafe { (**r).set_yield(y) },
            Self::H3(r) => unsafe { (**r).set_yield(y) },
        }
    }
    pub fn date_for_header(&self, name: &[u8]) -> JsResult<Option<u64>> {
        // SAFETY: see header()
        match self {
            Self::H1(r) => unsafe { (**r).date_for_header(name) },
            Self::H3(r) => unsafe { (**r).date_for_header(name) },
        }
    }
}

/// uWS::Request C++ -> Rust bindings.
#[repr(C)]
pub struct Request {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl Request {
    pub fn is_ancient(&self) -> bool {
        // SAFETY: &self is a valid uWS::Request handle
        unsafe { c::uws_req_is_ancient(self) }
    }
    pub fn get_yield(&self) -> bool {
        // SAFETY: &self is a valid uWS::Request handle
        unsafe { c::uws_req_get_yield(self) }
    }
    pub fn set_yield(&self, yield_: bool) {
        // SAFETY: &self is a valid uWS::Request handle
        unsafe { c::uws_req_set_yield(self as *const _ as *mut _, yield_) }
    }
    pub fn url(&self) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_url writes a pointer into request-owned storage and returns its length
        unsafe {
            let len = c::uws_req_get_url(self, &mut ptr);
            core::slice::from_raw_parts(ptr, len)
        }
    }
    pub fn method(&self) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_method writes a pointer into request-owned storage and returns its length
        unsafe {
            let len = c::uws_req_get_method(self, &mut ptr);
            core::slice::from_raw_parts(ptr, len)
        }
    }
    pub fn header(&self, name: &[u8]) -> Option<&[u8]> {
        debug_assert!(name[0].is_ascii_lowercase());

        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_header writes a pointer into request-owned storage and returns its length
        let len = unsafe { c::uws_req_get_header(self, name.as_ptr(), name.len(), &mut ptr) };
        if len == 0 {
            return None;
        }
        // SAFETY: ptr/len describe a valid slice owned by the request for its lifetime
        Some(unsafe { core::slice::from_raw_parts(ptr, len) })
    }
    pub fn date_for_header(&self, name: &[u8]) -> JsResult<Option<u64>> {
        let Some(value) = self.header(name) else {
            return Ok(None);
        };
        // TODO(port): verify bun_str::String::init signature for borrowed-bytes construction
        let mut string = BunString::init(value);
        // `defer string.deref()` — handled by Drop on bun_str::String
        let date_f64 = BunString::parse_date(&mut string, VirtualMachine::get().global())?;
        if !date_f64.is_nan() && date_f64.is_finite() && date_f64 >= 0.0 {
            return Ok(Some(date_f64 as u64));
        }
        Ok(None)
    }
    pub fn query(&self, name: &[u8]) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_query writes a pointer into request-owned storage and returns its length
        unsafe {
            let len = c::uws_req_get_query(self, name.as_ptr(), name.len(), &mut ptr);
            core::slice::from_raw_parts(ptr, len)
        }
    }
    pub fn parameter(&self, index: u16) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        // SAFETY: uws_req_get_parameter writes a pointer into request-owned storage and returns its length
        unsafe {
            let len = c::uws_req_get_parameter(self, c_ushort::try_from(index).unwrap(), &mut ptr);
            core::slice::from_raw_parts(ptr, len)
        }
    }
}

mod c {
    use super::Request;
    use core::ffi::c_ushort;

    unsafe extern "C" {
        pub fn uws_req_is_ancient(res: *const Request) -> bool;
        pub fn uws_req_get_yield(res: *const Request) -> bool;
        pub fn uws_req_set_yield(res: *mut Request, yield_: bool);
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/Request.zig (97 lines)
//   confidence: medium
//   todos:      2
//   notes:      H3Request import path + bun_str::String::init signature need Phase B verification; returned &[u8] lifetimes tied to &self
// ──────────────────────────────────────────────────────────────────────────
