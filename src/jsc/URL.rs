use core::ptr::NonNull;

use bun_core::String;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

bun_opaque::opaque_ffi! {
    /// Opaque handle to a WebKit `WTF::URL` allocated on the C++ side.
    pub struct URL;
}

// Getters take `&URL` (non-null `*const URL` at the C ABI; BunString.cpp never
// mutates the WTF::URL on read). `&mut String` for the in/out params is
// ABI-identical to non-null `*mut String`. `URL__deinit` consumes the C++
// allocation, so it keeps a raw pointer and stays `unsafe fn`.
unsafe extern "C" {
    safe fn URL__fromJS(value: JSValue, global: &JSGlobalObject) -> Option<NonNull<URL>>;
    safe fn URL__fromString(input: &mut String) -> Option<NonNull<URL>>;
    safe fn URL__protocol(url: &URL) -> String;
    safe fn URL__username(url: &URL) -> String;
    safe fn URL__password(url: &URL) -> String;
    safe fn URL__host(url: &URL) -> String;
    safe fn URL__port(url: &URL) -> u32;
    fn URL__deinit(url: *mut URL);
    safe fn URL__pathname(url: &URL) -> String;
    safe fn URL__getHrefFromJS(value: JSValue, global: &JSGlobalObject) -> String;
    safe fn URL__getFileURLString(input: &mut String) -> String;
    safe fn URL__pathFromFileURL(input: &mut String) -> String;
}

/// Owns the `new WTF::URL` handed back by `URL__fromJS` / `URL__fromString` and deletes it on drop.
#[repr(transparent)]
pub struct OwnedURL(NonNull<URL>);

impl core::ops::Deref for OwnedURL {
    type Target = URL;

    #[inline]
    fn deref(&self) -> &URL {
        // SAFETY: `self.0` is the live heap `WTF::URL` this handle owns until `drop`.
        unsafe { self.0.as_ref() }
    }
}

impl Drop for OwnedURL {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `self.0` is a C++ `new WTF::URL` and this handle is its only owner.
        unsafe { URL__deinit(self.0.as_ptr()) }
    }
}

impl URL {
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
        crate::call_check_slow(global, || URL__getHrefFromJS(value, global))
    }

    #[track_caller]
    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<OwnedURL>> {
        crate::call_check_slow(global, || URL__fromJS(value, global).map(OwnedURL))
    }

    pub fn from_utf8(input: &[u8]) -> Option<OwnedURL> {
        Self::from_string(String::borrow_utf8(input))
    }

    pub fn from_string(str: String) -> Option<OwnedURL> {
        let mut input = str;
        URL__fromString(&mut input).map(OwnedURL)
    }

    pub fn protocol(&self) -> String {
        URL__protocol(self)
    }

    pub fn username(&self) -> String {
        URL__username(self)
    }

    pub fn password(&self) -> String {
        URL__password(self)
    }

    /// Returns the host WITHOUT the port.
    ///
    /// Note that this does NOT match JS behavior, which returns the host with the port. The
    /// with-port form lives on the JSC-free shim as `bun_url::whatwg::URL::hostname`.
    ///
    /// ```text
    /// URL("http://example.com:8080").host() => "example.com"
    /// ```
    pub fn host(&self) -> String {
        URL__host(self)
    }

    /// `None` when the URL has no port, which `URL__port` encodes as `u32::MAX`.
    pub fn port(&self) -> Option<u16> {
        u16::try_from(URL__port(self)).ok()
    }

    pub fn pathname(&self) -> String {
        URL__pathname(self)
    }
}
