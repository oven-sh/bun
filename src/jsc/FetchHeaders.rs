use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult, VM, WrapperGuard, host_fn};
use bun_core::ffi::FfiSlice;
use bun_core::{EncodedSlice, String as BunString, StringPointer};
use bun_http::picohttp;
use bun_uws::{AnyResponse, ResponseKind};

bun_opaque::sealed_handle! {
    /// Opaque C++ `WebCore::FetchHeaders` handle (ref-counted on the C++ side; see [`HeadersRef`]).
    pub struct FetchHeaders;
}

// `FetchHeaders`/`JSGlobalObject`/`VM` are opaque `UnsafeCell`-backed ZST
// handles, so `&T` is ABI-identical to a non-null `*const T` and C++ mutating
// header storage / VM state through them is interior mutation invisible to
// Rust. `EncodedSlice` and `String` (`BunString`) are plain `#[repr(C)]` structs;
// `&`/`&mut` refs to them at the FFI boundary are sound (C++ reads/writes
// only the named struct).
// Shims that traffic only in such refs + scalars are declared `safe fn`; those
// that take raw `*mut c_void` / unsized `*mut StringPointer` arrays / `deref`
// (which may free) keep their `unsafe fn` body.
unsafe extern "C" {
    safe fn WebCore__FetchHeaders__cast_(value0: JSValue, arg1: &VM) -> *mut FetchHeaders;
    safe fn WebCore__FetchHeaders__cloneThis(
        arg0: &FetchHeaders,
        arg1: &JSGlobalObject,
    ) -> Option<HeadersRef>;
    fn WebCore__FetchHeaders__copyTo(
        arg0: &FetchHeaders,
        arg1: *mut StringPointer,
        arg2: *mut StringPointer,
        arg3: u32,
        arg4: *mut u8,
        arg5: u32,
    );
    safe fn WebCore__FetchHeaders__count(
        arg0: &FetchHeaders,
        arg1: &mut u32,
        arg2: &mut u32,
    ) -> bool;
    safe fn WebCore__FetchHeaders__createEmpty() -> HeadersRef;
    safe fn WebCore__FetchHeaders__createFromPicoHeaders_(
        arg0: &FfiSlice<'_, picohttp::Header<'_>>,
    ) -> HeadersRef;
    safe fn WebCore__FetchHeaders__createFromUWS(arg1: &bun_uws::Request) -> HeadersRef;
    fn WebCore__FetchHeaders__deref(arg0: *mut FetchHeaders);
    safe fn WebCore__FetchHeaders__fastGet_(arg0: &FetchHeaders, arg1: HTTPHeaderName)
    -> BunString;
    safe fn WebCore__FetchHeaders__fastHas_(arg0: &FetchHeaders, arg1: HTTPHeaderName) -> bool;
    safe fn WebCore__FetchHeaders__fastRemove_(arg0: &FetchHeaders, arg1: HTTPHeaderName);
    safe fn WebCore__FetchHeaders__get_(
        arg0: &FetchHeaders,
        arg1: &EncodedSlice,
        arg2: &JSGlobalObject,
    ) -> BunString;
    safe fn WebCore__FetchHeaders__isEmpty(arg0: &FetchHeaders) -> bool;
    safe fn WebCore__FetchHeaders__toJS(arg0: &FetchHeaders, arg1: &JSGlobalObject) -> JSValue;
    fn WebCore__FetchHeaders__toUWSResponse(
        arg0: &FetchHeaders,
        kind: ResponseKind,
        arg2: *mut c_void,
    );
    fn WebCore__FetchHeaders__toUWSResponseForWebSocketUpgrade(
        arg0: &FetchHeaders,
        ssl: bool,
        arg1: *mut c_void,
    );
    safe fn WebCore__FetchHeaders__createFromH3(arg0: &bun_uws::H3::Request) -> HeadersRef;

    safe fn WebCore__FetchHeaders__createFromJS(
        arg0: &JSGlobalObject,
        arg1: JSValue,
    ) -> Option<HeadersRef>;

    safe fn WebCore__FetchHeaders__put(
        this: &FetchHeaders,
        name_: HTTPHeaderName,
        value: &BunString,
        global: &JSGlobalObject,
    );
}

// SAFETY: only the imports that return a new ref make one.
bun_opaque::owned_handle! {
    /// One ref on a `WebCore::FetchHeaders`. `clone_this` makes a deep copy.
    pub struct HeadersRef(FetchHeaders) => unsafe WebCore__FetchHeaders__deref;
}

impl HeadersRef {
    /// Construct a `Headers` object from a JSValue.
    ///
    /// This can be:
    /// -  Array<[String, String]>
    /// -  Record<String, String>.
    ///
    /// Throws an exception if invalid.
    ///
    /// If empty, returns null.
    pub fn create_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Self>> {
        host_fn::from_js_host_call_generic(global, || {
            WebCore__FetchHeaders__createFromJS(global, value)
        })
    }

    pub fn create_from_uws(uws_request: &bun_uws::Request) -> Self {
        WebCore__FetchHeaders__createFromUWS(uws_request)
    }

    pub fn create_from_h3(h3_request: &bun_uws::H3::Request) -> Self {
        WebCore__FetchHeaders__createFromH3(h3_request)
    }

    pub fn create_empty() -> Self {
        WebCore__FetchHeaders__createEmpty()
    }

    pub fn create_from_pico_headers(pico_headers_list: &[picohttp::Header<'_>]) -> Self {
        WebCore__FetchHeaders__createFromPicoHeaders_(&FfiSlice::new(pico_headers_list))
    }
}

/// A `headers` option: the caller's `Headers` object, or what another value was converted to.
pub enum HeadersInit<'a> {
    Object(WrapperGuard<'a, FetchHeaders>),
    Created(HeadersRef),
}

impl<'a> HeadersInit<'a> {
    /// `None` if `value` is not a `Headers` object and converts to no header.
    pub fn from_js(global: &JSGlobalObject, value: &'a JSValue) -> JsResult<Option<Self>> {
        match FetchHeaders::cast_(value, global.vm()) {
            Some(headers) => Ok(Some(Self::Object(headers))),
            None => Ok(HeadersRef::create_from_js(global, *value)?.map(Self::Created)),
        }
    }
}

impl core::ops::Deref for HeadersInit<'_> {
    type Target = FetchHeaders;
    fn deref(&self) -> &FetchHeaders {
        match self {
            Self::Object(headers) => headers,
            Self::Created(headers) => headers,
        }
    }
}

impl FetchHeaders {
    pub fn put_default(
        &self,
        name_: HTTPHeaderName,
        value: &BunString,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        if self.fast_has(name_) {
            return Ok(());
        }

        self.put(name_, value, global)
    }

    pub fn is_empty(&self) -> bool {
        WebCore__FetchHeaders__isEmpty(self)
    }

    pub fn to_uws_response(&self, response: AnyResponse) {
        let kind = ResponseKind::of(response);
        // SAFETY: `kind` and the pointer come from the same response.
        unsafe { WebCore__FetchHeaders__toUWSResponse(self, kind, response.as_ptr()) }
    }

    /// For the 101 response of an HTTP/1 WebSocket upgrade. Skips headers that `upgrade()` writes.
    pub fn to_uws_response_for_websocket_upgrade(&self, response: AnyResponse) {
        let ssl = matches!(response, AnyResponse::SSL(_));
        let response = response.socket().cast();
        // SAFETY: `socket` panics unless `response` is a `uWS::HttpResponse<ssl>`.
        unsafe { WebCore__FetchHeaders__toUWSResponseForWebSocketUpgrade(self, ssl, response) }
    }

    /// `value`'s tag carries its encoding, and a `WTFStringImpl`-tagged value
    /// is ref'd by the C++ side instead of copied character-by-character.
    pub fn put(
        &self,
        name_: HTTPHeaderName,
        value: &BunString,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        host_fn::from_js_host_call_generic(global, || {
            WebCore__FetchHeaders__put(self, name_, value, global)
        })
    }

    pub fn get(&self, name_: &[u8], global: &JSGlobalObject) -> JsResult<Option<BunString>> {
        let value = host_fn::from_js_host_call_generic(global, || {
            WebCore__FetchHeaders__get_(self, &EncodedSlice::latin1(name_), global)
        })?;
        Ok((!value.is_empty()).then_some(value))
    }

    pub fn fast_has(&self, name_: HTTPHeaderName) -> bool {
        WebCore__FetchHeaders__fastHas_(self, name_)
    }

    pub fn fast_get(&self, name_: HTTPHeaderName) -> Option<BunString> {
        let value = WebCore__FetchHeaders__fastGet_(self, name_);
        (!value.is_empty()).then_some(value)
    }

    pub fn fast_remove(&self, header: HTTPHeaderName) {
        WebCore__FetchHeaders__fastRemove_(self, header)
    }

    pub fn cast_<'a>(value: &'a JSValue, vm: &VM) -> Option<WrapperGuard<'a, FetchHeaders>> {
        // SAFETY: a `JSFetchHeaders` holds a ref on what it wraps.
        unsafe { WrapperGuard::new(value, WebCore__FetchHeaders__cast_(*value, vm)) }
    }

    pub fn to_js(&self, global_this: &JSGlobalObject) -> JSValue {
        WebCore__FetchHeaders__toJS(self, global_this)
    }

    /// Returns the header count and the total size of all names and values in bytes, or `None` if
    /// the size exceeds `u32::MAX`.
    pub fn count(&self) -> Option<(u32, u32)> {
        let (mut names, mut buf_len) = (0, 0);
        WebCore__FetchHeaders__count(self, &mut names, &mut buf_len).then_some((names, buf_len))
    }

    pub fn clone_this(&self, global: &JSGlobalObject) -> JsResult<Option<HeadersRef>> {
        host_fn::from_js_host_call_generic(global, || {
            WebCore__FetchHeaders__cloneThis(self, global)
        })
    }

    /// Aborts if `names`, `values` or `buf` is smaller than what `count()` reported.
    pub fn copy_to(
        &self,
        names: &mut [StringPointer],
        values: &mut [StringPointer],
        buf: &mut [u8],
    ) {
        // Clamping a longer slice is fine because C++ writes at most `u32::MAX` entries or bytes.
        let columns = u32::try_from(names.len().min(values.len())).unwrap_or(u32::MAX);
        let buf_len = u32::try_from(buf.len()).unwrap_or(u32::MAX);
        // SAFETY: C++ asserts that it writes at most `columns` entries and `buf_len` bytes.
        unsafe {
            WebCore__FetchHeaders__copyTo(
                self,
                names.as_mut_ptr(),
                values.as_mut_ptr(),
                columns,
                buf.as_mut_ptr(),
                buf_len,
            )
        }
    }
}

// Canonical enum lives in `bun_http_types::Method::HeaderName` (same 92
// `#[repr(u8)]` discriminants mirroring WebCore's `HTTPHeaderNames.in`). The
// `WebCore__FetchHeaders__put` extern decl above and the `fast_*` methods take
// it by value, so the re-export is ABI-transparent.
pub use bun_http_types::Method::HeaderName as HTTPHeaderName;
