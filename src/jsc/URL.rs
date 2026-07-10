use bun_core::String;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

/// The C++ object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`URL`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// A heap-allocated WebKit `WTF::URL`. `&Self` is ABI-identical to a
        /// non-null `WTF::URL*` and carries no `noalias`/`readonly`.
        pub struct URL;
    }
}

// C++ allocates (`new WTF::URL(...)`) and hands the allocation to Rust;
// `URL__deinit` is an unconditional `delete`. One `URL` handle owns exactly
// that one allocation.
bun_opaque::foreign_handle! {
    /// Owned handle to a C++ heap `WTF::URL`.
    ///
    /// `Drop` `delete`s the allocation. Every method takes `&self`: the C++ side
    /// never mutates the `WTF::URL` on read, and destroying it is not exclusive
    /// access in Rust's sense.
    pub struct URL(sys::URL) via URL__deinit;
}

// Getters take `&sys::URL` (a non-null `WTF::URL*` at the C ABI; BunString.cpp
// never mutates it on read); `&mut String` is ABI-identical to `*mut String`.
// Every shim traffics only in those plus value types, so all are `safe fn`.
unsafe extern "C" {
    safe fn URL__fromJS(value: JSValue, global: &JSGlobalObject) -> *mut sys::URL;
    safe fn URL__fromString(input: &mut String) -> *mut sys::URL;
    safe fn URL__protocol(url: &sys::URL) -> String;
    safe fn URL__href(url: &sys::URL) -> String;
    safe fn URL__username(url: &sys::URL) -> String;
    safe fn URL__password(url: &sys::URL) -> String;
    safe fn URL__search(url: &sys::URL) -> String;
    safe fn URL__host(url: &sys::URL) -> String;
    safe fn URL__hostname(url: &sys::URL) -> String;
    safe fn URL__port(url: &sys::URL) -> u32;
    // safe: C++ `delete`s the `WTF::URL*`. Reached only through `Drop`.
    safe fn URL__deinit(url: &sys::URL);
    safe fn URL__pathname(url: &sys::URL) -> String;
    safe fn URL__getHrefFromJS(value: JSValue, global: &JSGlobalObject) -> String;
    safe fn URL__getHref(input: &mut String) -> String;
    safe fn URL__getFileURLString(input: &mut String) -> String;
    safe fn URL__getHrefJoin(base: &mut String, relative: &mut String) -> String;
    safe fn URL__pathFromFileURL(input: &mut String) -> String;
    safe fn URL__hash(url: &sys::URL) -> String;
    safe fn URL__fragmentIdentifier(url: &sys::URL) -> String;
}

impl URL {
    /// Includes the leading '#'.
    pub fn hash(&self) -> String {
        URL__hash(self.raw())
    }

    /// Exactly the same as hash, excluding the leading '#'.
    pub fn fragment_identifier(&self) -> String {
        URL__fragmentIdentifier(self.raw())
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
        crate::call_check_slow(global, || URL__getHrefFromJS(value, global))
    }

    /// C++ `new WTF::URL` on success; `None` if the URL is invalid.
    #[track_caller]
    pub fn from_js(value: JSValue, global: &JSGlobalObject) -> JsResult<Option<Self>> {
        // SAFETY: `URL__fromJS` transfers a fresh `new WTF::URL` (or null) to us.
        crate::call_check_slow(global, || URL__fromJS(value, global))
            .map(|p| unsafe { Self::adopt_ptr(p) })
    }

    pub fn from_utf8(input: &[u8]) -> Option<Self> {
        Self::from_string(String::borrow_utf8(input))
    }

    pub fn from_string(str: String) -> Option<Self> {
        let mut input = str;
        // SAFETY: `URL__fromString` transfers a fresh `new WTF::URL` (or null) to us.
        unsafe { Self::adopt_ptr(URL__fromString(&mut input)) }
    }

    pub fn protocol(&self) -> String {
        URL__protocol(self.raw())
    }

    pub fn href(&self) -> String {
        URL__href(self.raw())
    }

    pub fn username(&self) -> String {
        URL__username(self.raw())
    }

    pub fn password(&self) -> String {
        URL__password(self.raw())
    }

    pub fn search(&self) -> String {
        URL__search(self.raw())
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
        URL__host(self.raw())
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
        URL__hostname(self.raw())
    }

    /// Returns `u32::MAX` if the port is not set. Otherwise, `port`
    /// is guaranteed to be within the `u16` range.
    pub fn port(&self) -> u32 {
        URL__port(self.raw())
    }

    pub fn pathname(&self) -> String {
        URL__pathname(self.raw())
    }
}
