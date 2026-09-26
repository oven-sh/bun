use core::ffi::{c_ushort, c_void};

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

    /// The bytes this request was parsed from: the request line through the blank line.
    pub fn raw_head(&self) -> &[u8] {
        let mut ptr: *const u8 = core::ptr::null();
        let len = c::uws_req_get_raw_head(self, &mut ptr);
        // SAFETY: ptr/len describe the parsed bytes, which live as long as the request.
        unsafe { bun_core::ffi::slice(ptr, len) }
    }

    /// Spare bytes uWS needs after a copy of [`Self::raw_head`] to parse it again.
    pub const RAW_HEAD_POST_PADDING: usize = 32;

    /// Lends `f` the request uWS parses from `copy`: a [`Self::raw_head`], then the spare bytes.
    pub fn with_raw_head_copy<R, F: FnOnce(&Request) -> R>(copy: &mut [u8], f: F) -> Option<R> {
        let len = copy.len().checked_sub(Self::RAW_HEAD_POST_PADDING)?;
        struct Call<R, F> {
            f: Option<F>,
            result: Option<R>,
        }
        extern "C" fn handle<R, F: FnOnce(&Request) -> R>(call: *mut c_void, req: *mut Request) {
            // SAFETY: `call` is the stack `Call` below, live for this synchronous callback.
            let call = unsafe { &mut *call.cast::<Call<R, F>>() };
            if let Some(f) = call.f.take() {
                call.result = Some(f(bun_opaque::opaque_deref(req)));
            }
        }
        let mut call = Call {
            f: Some(f),
            result: None,
        };
        // SAFETY: uWS reads and fences only inside `copy`; `call` outlives the synchronous callback.
        unsafe {
            c::uws_req_with_raw_head(
                copy.as_mut_ptr(),
                len,
                (&raw mut call).cast::<c_void>(),
                handle::<R, F>,
            )
        };
        call.result
    }
}

mod c {
    use super::Request;
    use core::ffi::{c_ushort, c_void};

    unsafe extern "C" {
        pub(super) safe fn uws_req_set_yield(res: &mut Request, yield_: bool);
        // Out-param `dest` is a `&mut *const u8` (non-null, valid for write); the C
        // shim only stores a pointer into request-owned storage and returns its
        // length — no read-through-ptr precondition, so `safe fn`.
        pub(super) safe fn uws_req_get_url(res: &Request, dest: &mut *const u8) -> usize;
        pub(super) safe fn uws_req_get_method(res: &Request, dest: &mut *const u8) -> usize;
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
        pub(super) safe fn uws_req_get_raw_head(res: &Request, dest: &mut *const u8) -> usize;
        pub(super) fn uws_req_with_raw_head(
            head: *mut u8,
            len: usize,
            call: *mut c_void,
            callback: extern "C" fn(*mut c_void, *mut Request),
        ) -> bool;
    }
}
