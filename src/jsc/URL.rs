use core::marker::{PhantomData, PhantomPinned};
use core::ptr::NonNull;

use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult};
use bun_str::String;
use bun_str::strings;

// PORT NOTE: `jsc.markBinding(@src())` calls were dropped — debug-only binding-trace
// helper with no Rust equivalent; Phase B can add a `mark_binding!()` macro if wanted.

/// Opaque handle to a WebKit `WTF::URL` allocated on the C++ side.
#[repr(C)]
pub struct URL {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn URL__fromJS(value: JSValue, global: *mut JSGlobalObject) -> *mut URL;
    fn URL__fromString(input: *mut String) -> *mut URL;
    fn URL__protocol(url: *mut URL) -> String;
    fn URL__href(url: *mut URL) -> String;
    fn URL__username(url: *mut URL) -> String;
    fn URL__password(url: *mut URL) -> String;
    fn URL__search(url: *mut URL) -> String;
    fn URL__host(url: *mut URL) -> String;
    fn URL__hostname(url: *mut URL) -> String;
    fn URL__port(url: *mut URL) -> u32;
    fn URL__deinit(url: *mut URL);
    fn URL__pathname(url: *mut URL) -> String;
    fn URL__getHrefFromJS(value: JSValue, global: *mut JSGlobalObject) -> String;
    fn URL__getHref(input: *mut String) -> String;
    fn URL__getFileURLString(input: *mut String) -> String;
    fn URL__getHrefJoin(base: *mut String, relative: *mut String) -> String;
    fn URL__pathFromFileURL(input: *mut String) -> String;
    fn URL__hash(url: *mut URL) -> String;
    fn URL__fragmentIdentifier(url: *mut URL) -> String;

    fn URL__originLength(latin1_slice: *const u8, len: usize) -> u32;
}

impl URL {
    /// Includes the leading '#'.
    pub fn hash(&self) -> String {
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__hash(self as *const URL as *mut URL) }
    }

    /// Exactly the same as hash, excluding the leading '#'.
    pub fn fragment_identifier(&self) -> String {
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__fragmentIdentifier(self as *const URL as *mut URL) }
    }

    pub fn href_from_string(str: String) -> String {
        let mut input = str;
        // SAFETY: input lives for the duration of the call
        unsafe { URL__getHref(&mut input) }
    }

    pub fn join(base: String, relative: String) -> String {
        let mut base_str = base;
        let mut relative_str = relative;
        // SAFETY: locals live for the duration of the call
        unsafe { URL__getHrefJoin(&mut base_str, &mut relative_str) }
    }

    pub fn file_url_from_string(str: String) -> String {
        let mut input = str;
        // SAFETY: input lives for the duration of the call
        unsafe { URL__getFileURLString(&mut input) }
    }

    pub fn path_from_file_url(str: String) -> String {
        let mut input = str;
        // SAFETY: input lives for the duration of the call
        unsafe { URL__pathFromFileURL(&mut input) }
    }

    /// This percent-encodes the URL, punycode-encodes the hostname, and returns the result
    /// If it fails, the tag is marked Dead
    pub fn href_from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<String> {
        // SAFETY: global is a valid &JSGlobalObject; FFI takes *mut
        let result = unsafe {
            URL__getHrefFromJS(value, global as *const JSGlobalObject as *mut JSGlobalObject)
        };
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(result)
    }

    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<NonNull<URL>>> {
        // SAFETY: global is a valid &JSGlobalObject; FFI takes *mut
        let result =
            unsafe { URL__fromJS(value, global as *const JSGlobalObject as *mut JSGlobalObject) };
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        Ok(NonNull::new(result))
    }

    pub fn from_utf8(input: &[u8]) -> Option<NonNull<URL>> {
        Self::from_string(String::borrow_utf8(input))
    }

    pub fn from_string(str: String) -> Option<NonNull<URL>> {
        let mut input = str;
        // SAFETY: input lives for the duration of the call
        NonNull::new(unsafe { URL__fromString(&mut input) })
    }
    // TODO(port): from_js/from_string/from_utf8 return an owned C++ heap pointer that
    // the caller must destroy(). Consider an RAII wrapper in Phase B instead of NonNull<URL>.

    pub fn protocol(&self) -> String {
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__protocol(self as *const URL as *mut URL) }
    }

    pub fn href(&self) -> String {
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__href(self as *const URL as *mut URL) }
    }

    pub fn username(&self) -> String {
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__username(self as *const URL as *mut URL) }
    }

    pub fn password(&self) -> String {
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__password(self as *const URL as *mut URL) }
    }

    pub fn search(&self) -> String {
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__search(self as *const URL as *mut URL) }
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
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__host(self as *const URL as *mut URL) }
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
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__hostname(self as *const URL as *mut URL) }
    }

    /// Returns `u32::MAX` if the port is not set. Otherwise, `port`
    /// is guaranteed to be within the `u16` range.
    pub fn port(&self) -> u32 {
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__port(self as *const URL as *mut URL) }
    }

    // PORT NOTE: kept as explicit destroy (not Drop) — URL is an opaque #[repr(C)] FFI
    // handle constructed/destroyed across the C++ boundary.
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: `this` is a valid *URL from C++; freed exactly once
        unsafe { URL__deinit(this) }
    }

    pub fn pathname(&self) -> String {
        // SAFETY: self is a valid *URL handle from C++
        unsafe { URL__pathname(self as *const URL as *mut URL) }
    }

    pub fn origin_from_slice(slice: &[u8]) -> Option<&[u8]> {
        // a valid URL will not have ascii in the origin.
        let first_non_ascii = strings::first_non_ascii(slice)
            .map(|i| i as usize)
            .unwrap_or(slice.len());
        // SAFETY: ptr/len derived from a valid slice prefix
        let len = unsafe {
            URL__originLength(slice[..first_non_ascii].as_ptr(), first_non_ascii)
        };
        if len == 0 {
            return None;
        }
        Some(&slice[..len as usize])
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/URL.zig (166 lines)
//   confidence: high
//   todos:      2
//   notes:      opaque FFI handle; from_* return NonNull<URL> (owned C++ ptr) — Phase B may want RAII wrapper
// ──────────────────────────────────────────────────────────────────────────
