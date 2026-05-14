use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use bun_core::String;
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult};

// PORT NOTE: `jsc.markBinding(@src())` calls were dropped — debug-only binding-trace
// helper with no Rust equivalent; Phase B can add a `mark_binding!()` macro if wanted.

bun_opaque::opaque_ffi! {
    /// Opaque handle to a WebKit `WTF::URL` allocated on the C++ side.
    pub struct URL;
}

// TODO(port): move to jsc_sys
// PORT NOTE: getters take `*const URL` — the C++ side (BunString.cpp) never mutates the
// WTF::URL on read. `JSGlobalObject` is an opaque FFI handle whose state Rust never
// observes directly, so it is passed `*const` per the JSGlobalObject.rs convention.
// Getters take `&URL` (non-null `*const URL` at the C ABI; BunString.cpp never
// mutates the WTF::URL on read). `&mut String` for the in/out params is
// ABI-identical to non-null `*mut String`. `URL__deinit` consumes the C++
// allocation, so it keeps a raw pointer and stays `unsafe fn`.
unsafe extern "C" {
    safe fn URL__fromJS(value: JSValue, global: &JSGlobalObject) -> *mut URL;
    safe fn URL__fromString(input: &mut String) -> *mut URL;
    safe fn URL__protocol(url: &URL) -> String;
    safe fn URL__href(url: &URL) -> String;
    safe fn URL__username(url: &URL) -> String;
    safe fn URL__password(url: &URL) -> String;
    safe fn URL__search(url: &URL) -> String;
    safe fn URL__host(url: &URL) -> String;
    safe fn URL__hostname(url: &URL) -> String;
    safe fn URL__port(url: &URL) -> u32;
    fn URL__deinit(url: *mut URL);
    safe fn URL__pathname(url: &URL) -> String;
    safe fn URL__getHrefFromJS(value: JSValue, global: &JSGlobalObject) -> String;
    safe fn URL__getHref(input: &mut String) -> String;
    safe fn URL__getFileURLString(input: &mut String) -> String;
    safe fn URL__getHrefJoin(base: &mut String, relative: &mut String) -> String;
    safe fn URL__pathFromFileURL(input: &mut String) -> String;
    safe fn URL__hash(url: &URL) -> String;
    safe fn URL__fragmentIdentifier(url: &URL) -> String;
}

impl URL {
    /// Includes the leading '#'.
    pub fn hash(&self) -> String {
        URL__hash(self)
    }

    /// Exactly the same as hash, excluding the leading '#'.
    pub fn fragment_identifier(&self) -> String {
        URL__fragmentIdentifier(self)
    }

    pub fn href_from_string(str: String) -> String {
        let mut input = str;
        URL__getHref(&mut input)
    }

    pub fn join(base: String, relative: String) -> String {
        let mut base_str = base;
        let mut relative_str = relative;
        URL__getHrefJoin(&mut base_str, &mut relative_str)
    }

    pub fn file_url_from_string(str: String) -> String {
        let mut input = str;
        URL__getFileURLString(&mut input)
    }

    pub fn path_from_file_url(str: String) -> String {
        let mut input = str;
        URL__pathFromFileURL(&mut input)
    }

    /// This percent-encodes the URL, punycode-encodes the hostname, and returns the result
    /// If it fails, the tag is marked Dead
    #[track_caller]
    pub fn href_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<String> {
        // Zig (URL.zig): `fromJSHostCallGeneric` (== `call_check_slow`).
        crate::call_check_slow(global, || URL__getHrefFromJS(value, global))
    }

    #[track_caller]
    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<NonNull<URL>>> {
        // Zig (URL.zig): `fromJSHostCallGeneric` (== `call_check_slow`).
        crate::call_check_slow(global, || URL__fromJS(value, global)).map(NonNull::new)
    }

    pub fn from_utf8(input: &[u8]) -> Option<NonNull<URL>> {
        Self::from_string(String::borrow_utf8(input))
    }

    pub fn from_string(str: String) -> Option<NonNull<URL>> {
        let mut input = str;
        NonNull::new(URL__fromString(&mut input))
    }
    // TODO(port): from_js/from_string/from_utf8 return an owned C++ heap pointer that
    // the caller must destroy(). Consider an RAII wrapper in Phase B instead of NonNull<URL>.

    pub fn protocol(&self) -> String {
        URL__protocol(self)
    }

    pub fn href(&self) -> String {
        URL__href(self)
    }

    pub fn username(&self) -> String {
        URL__username(self)
    }

    pub fn password(&self) -> String {
        URL__password(self)
    }

    pub fn search(&self) -> String {
        URL__search(self)
    }

    /// Returns the host WITHOUT the port.
    ///
    /// Note that this does NOT match JS behavior, which returns the host with the port. See
    /// `hostname` for the JS equivalent of `host`.
    ///
    /// ```text
    /// URL("http://example.com:8080").host() => "example.com"
    /// ```
    pub fn host(&self) -> String {
        URL__host(self)
    }

    /// Returns the host WITH the port.
    ///
    /// Note that this does NOT match JS behavior which returns the host without the port. See
    /// `host` for the JS equivalent of `hostname`.
    ///
    /// ```text
    /// URL("http://example.com:8080").hostname() => "example.com:8080"
    /// ```
    pub fn hostname(&self) -> String {
        URL__hostname(self)
    }

    /// Returns `u32::MAX` if the port is not set. Otherwise, `port`
    /// is guaranteed to be within the `u16` range.
    pub fn port(&self) -> u32 {
        URL__port(self)
    }

    // PORT NOTE: kept as explicit destroy (not Drop) — URL is an opaque #[repr(C)] FFI
    // handle constructed/destroyed across the C++ boundary.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: `this` is a valid *URL from C++; freed exactly once
        unsafe { URL__deinit(this) }
    }

    pub fn pathname(&self) -> String {
        URL__pathname(self)
    }
}

// ported from: src/jsc/URL.zig
