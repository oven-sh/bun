// This is close to WHATWG URL, but we don't want the validation errors
//
// ══════════════════════════════════════════════════════════════════════════
// B-1 GATE-AND-STUB SURFACE
// Phase-A draft preserved verbatim below in `#[cfg(any())] mod _phase_a_draft`.
// This top section exposes the minimal public types/fns downstream crates name
// (URL, PercentEncoding, QueryStringMap, route_param, whatwg, scanners) so the
// dep graph type-checks. Bodies are `todo!()`; un-gating happens in B-2.
// ══════════════════════════════════════════════════════════════════════════
#![allow(unused, non_snake_case, clippy::all)]

use bun_string::{self, strings, String as BunString, Tag as BunStringTag};

// ── local stubs for lower-tier symbols not yet on their stub surface ──────
// TODO(b1): bun_schema::api missing — StringPointer is `{offset:u32,length:u32}`
pub mod api {
    #[repr(C)]
    #[derive(Clone, Copy, Default, Debug)]
    pub struct StringPointer {
        pub offset: u32,
        pub length: u32,
    }
}

// TODO(b1): bun_io gated (does not compile) — minimal byte-writer trait stub
mod bun_io {
    pub trait Write {}
    impl Write for Vec<u8> {}
}

// ── route_param (TYPE_ONLY move-down from bun_router, see CYCLEBREAK.md) ──
pub mod route_param {
    #[derive(Clone, Copy)]
    pub struct Param {
        pub name: &'static [u8],
        pub value: &'static [u8],
    }
    // TODO(b1): bun_collections::MultiArrayList is an opaque stub; use Vec for now
    pub type List = Vec<Param>;
}
pub use route_param::List as ParamsList;

// ── whatwg (WTF::URL FFI shim, MOVE_DOWN from bun_jsc) ────────────────────
pub mod whatwg {
    use super::BunString as String;

    #[repr(C)]
    pub struct URL {
        _opaque: [u8; 0],
    }

    unsafe extern "C" {
        fn URL__fromString(str: *mut String) -> Option<core::ptr::NonNull<URL>>;
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
        fn URL__getHref(input: *mut String) -> String;
        fn URL__getFileURLString(input: *mut String) -> String;
        fn URL__getHrefJoin(base: *mut String, relative: *mut String) -> String;
        fn URL__pathFromFileURL(input: *mut String) -> String;
        fn URL__hash(url: *mut URL) -> String;
        fn URL__fragmentIdentifier(url: *mut URL) -> String;
        fn URL__originLength(latin1_slice: *const u8, len: usize) -> u32;
    }

    #[inline]
    fn as_mut_ptr(s: &String) -> *mut String {
        s as *const String as *mut String
    }

    pub fn href_from_string(str: &String) -> String {
        unsafe { URL__getHref(as_mut_ptr(str)) }
    }
    pub fn join(base: &String, relative: &String) -> String {
        unsafe { URL__getHrefJoin(as_mut_ptr(base), as_mut_ptr(relative)) }
    }
    pub fn file_url_from_string(str: &String) -> String {
        unsafe { URL__getFileURLString(as_mut_ptr(str)) }
    }
    pub fn path_from_file_url(str: &String) -> String {
        unsafe { URL__pathFromFileURL(as_mut_ptr(str)) }
    }
    pub fn origin_from_slice(slice: &[u8]) -> Option<&[u8]> {
        let first_non_ascii = super::strings::first_non_ascii(slice).map_or(slice.len(), |i| i as usize);
        let len = unsafe { URL__originLength(slice.as_ptr(), first_non_ascii) };
        if len == 0 {
            return None;
        }
        Some(&slice[..len as usize])
    }

    impl URL {
        pub fn from_string(str: &String) -> Option<core::ptr::NonNull<URL>> {
            unsafe { URL__fromString(as_mut_ptr(str)) }
        }
        pub fn from_utf8(input: &[u8]) -> Option<core::ptr::NonNull<URL>> {
            Self::from_string(&String::borrow_utf8(input))
        }
        pub fn hash(&mut self) -> String { unsafe { URL__hash(self) } }
        pub fn fragment_identifier(&mut self) -> String { unsafe { URL__fragmentIdentifier(self) } }
        pub fn protocol(&mut self) -> String { unsafe { URL__protocol(self) } }
        pub fn href(&mut self) -> String { unsafe { URL__href(self) } }
        pub fn username(&mut self) -> String { unsafe { URL__username(self) } }
        pub fn password(&mut self) -> String { unsafe { URL__password(self) } }
        pub fn search(&mut self) -> String { unsafe { URL__search(self) } }
        pub fn host(&mut self) -> String { unsafe { URL__host(self) } }
        pub fn hostname(&mut self) -> String { unsafe { URL__hostname(self) } }
        pub fn port(&mut self) -> u32 { unsafe { URL__port(self) } }
        pub fn pathname(&mut self) -> String { unsafe { URL__pathname(self) } }
        pub fn deinit(&mut self) { unsafe { URL__deinit(self) } }
    }
}
pub use whatwg::{file_url_from_string, href_from_string, join, origin_from_slice, path_from_file_url};

// ── URL view-struct ───────────────────────────────────────────────────────
#[derive(Clone)]
pub struct URL<'a> {
    pub hash: &'a [u8],
    pub host: &'a [u8],
    pub hostname: &'a [u8],
    pub href: &'a [u8],
    pub origin: &'a [u8],
    pub password: &'a [u8],
    pub pathname: &'a [u8],
    pub path: &'a [u8],
    pub port: &'a [u8],
    pub protocol: &'a [u8],
    pub search: &'a [u8],
    pub search_params: Option<QueryStringMap>,
    pub username: &'a [u8],
    pub port_was_automatically_set: bool,
}

impl<'a> Default for URL<'a> {
    fn default() -> Self {
        Self {
            hash: b"",
            host: b"",
            hostname: b"",
            href: b"",
            origin: b"",
            password: b"",
            pathname: b"/",
            path: b"/",
            port: b"",
            protocol: b"",
            search: b"",
            search_params: None,
            username: b"",
            port_was_automatically_set: false,
        }
    }
}

impl<'a> URL<'a> {
    pub fn parse(_base: &'a [u8]) -> URL<'a> {
        todo!("B-2: un-gate _phase_a_draft::URL::parse")
    }
    pub fn from_string(_input: &BunString) -> Result<URL<'static>, bun_core::Error> {
        todo!("B-2")
    }
    pub fn from_utf8(_input: &[u8]) -> Result<URL<'static>, bun_core::Error> {
        todo!("B-2")
    }
    pub fn is_file(&self) -> bool { self.protocol == b"file" }
    pub fn is_blob(&self) -> bool {
        self.href.len() == b"blob:".len() + 36 && self.href.starts_with(b"blob:")
    }
    pub fn is_localhost(&self) -> bool {
        self.hostname.is_empty() || self.hostname == b"localhost" || self.hostname == b"0.0.0.0"
    }
    #[inline] pub fn is_unix(&self) -> bool { self.protocol.starts_with(b"unix") }
    #[inline] pub fn is_https(&self) -> bool { self.protocol == b"https" }
    #[inline] pub fn is_s3(&self) -> bool { self.protocol == b"s3" }
    #[inline] pub fn is_http(&self) -> bool { self.protocol == b"http" }
    pub fn is_empty(&self) -> bool { self.href.is_empty() }
    pub fn is_absolute(&self) -> bool { !self.hostname.is_empty() && !self.pathname.is_empty() }
    pub fn has_http_like_protocol(&self) -> bool {
        self.protocol == b"http" || self.protocol == b"https"
    }
    pub fn display_hostname(&self) -> &[u8] {
        if !self.hostname.is_empty() { self.hostname } else { b"localhost" }
    }
    pub fn display_protocol(&self) -> &[u8] {
        if !self.protocol.is_empty() {
            return self.protocol;
        }
        if let Some(443) = self.get_port() {
            return b"https";
        }
        b"http"
    }
    pub fn get_port(&self) -> Option<u16> {
        core::str::from_utf8(self.port).ok()?.parse::<u16>().ok()
    }
    pub fn get_port_auto(&self) -> u16 {
        self.get_port().unwrap_or_else(|| self.get_default_port())
    }
    pub fn get_default_port(&self) -> u16 {
        if self.is_https() { 443u16 } else { 80u16 }
    }
    pub fn has_valid_port(&self) -> bool { self.get_port().unwrap_or(0) > 0 }
    pub fn s3_path(&self) -> &'a [u8] {
        let href = if !self.protocol.is_empty() && self.href.len() > self.protocol.len() + 2 {
            &self.href[self.protocol.len() + 2..]
        } else {
            self.href
        };
        &href[0..href.len() - (self.search.len() + self.hash.len())]
    }
    // gated in B-1: host_with_path, display_host, is_ip_address, join_normalize,
    // join_write, join_alloc, parse_{protocol,username,password,host} — see draft below.
}

// ── QueryStringMap & friends ──────────────────────────────────────────────
#[derive(Clone)]
pub struct QueryStringMap {
    _opaque: (),
}

#[derive(Clone, Copy)]
pub struct Param {
    pub name: api::StringPointer,
    pub name_hash: u64,
    pub value: api::StringPointer,
}

pub type ParamList = Vec<Param>; // TODO(b1): bun_collections::MultiArrayList<Param>

#[derive(Clone, Copy)]
pub struct ScannerResult {
    pub name_needs_decoding: bool,
    pub value_needs_decoding: bool,
    pub name: api::StringPointer,
    pub value: api::StringPointer,
}

pub struct Scanner<'a> {
    pub query_string: &'a [u8],
    pub i: usize,
    pub start: usize,
}
impl<'a> Scanner<'a> {
    pub fn init(_query_string: &'a [u8]) -> Scanner<'a> { todo!("B-2") }
    pub fn next(&mut self) -> Option<ScannerResult> { todo!("B-2") }
    pub fn reset(&mut self) { self.i = self.start; }
}

pub struct PathnameScanner<'a> {
    pub params: &'a ParamsList,
    pub pathname: &'a [u8],
    pub routename: &'a [u8],
    pub i: usize,
}
impl<'a> PathnameScanner<'a> {
    pub fn init(_pathname: &'a [u8], _routename: &'a [u8], _params: &'a ParamsList) -> PathnameScanner<'a> {
        todo!("B-2")
    }
    pub fn next(&mut self) -> Option<ScannerResult> { todo!("B-2") }
    pub fn reset(&mut self) { self.i = 0; }
}

pub struct CombinedScanner<'a> {
    pub query: Scanner<'a>,
    pub pathname: PathnameScanner<'a>,
}
impl<'a> CombinedScanner<'a> {
    pub fn init(
        _query_string: &'a [u8],
        _pathname: &'a [u8],
        _routename: &'a [u8],
        _url_params: &'a ParamsList,
    ) -> CombinedScanner<'a> {
        todo!("B-2")
    }
    pub fn next(&mut self) -> Option<ScannerResult> { todo!("B-2") }
    pub fn reset(&mut self) {}
}

pub struct Iterator<'a> {
    pub i: usize,
    pub map: &'a QueryStringMap,
}
pub struct IteratorResult<'a> {
    pub name: &'a [u8],
    pub values: &'a mut [&'a [u8]],
}

// ── PercentEncoding ───────────────────────────────────────────────────────
pub struct PercentEncoding;

#[derive(Debug)]
pub enum DecodeError {
    DecodingError,
    Write(bun_core::Error),
}
impl From<bun_core::Error> for DecodeError {
    fn from(e: bun_core::Error) -> Self { DecodeError::Write(e) }
}
impl From<DecodeError> for bun_core::Error {
    fn from(_e: DecodeError) -> Self { bun_core::err!("DecodingError") }
}

impl PercentEncoding {
    pub fn decode(_writer: &mut impl bun_io::Write, _input: &[u8]) -> Result<u32, DecodeError> {
        todo!("B-2")
    }
    pub fn decode_alloc(_input: &[u8]) -> Result<Box<[u8]>, DecodeError> {
        todo!("B-2")
    }
    pub fn decode_into(_out: &mut [u8], _input: &[u8]) -> Result<u32, DecodeError> {
        todo!("B-2")
    }
    pub fn decode_fault_tolerant<W: bun_io::Write, const FAULT_TOLERANT: bool>(
        _writer: &mut W,
        _input: &[u8],
        _needs_redirect: Option<&mut bool>,
    ) -> Result<u32, DecodeError> {
        todo!("B-2")
    }
}

impl QueryStringMap {
    pub fn init(_query_string: &[u8]) -> Result<Option<QueryStringMap>, bun_alloc::AllocError> {
        todo!("B-2")
    }
    pub fn init_with_scanner(
        _scanner: CombinedScanner<'_>,
    ) -> Result<Option<QueryStringMap>, bun_alloc::AllocError> {
        todo!("B-2")
    }
    pub fn get(&self, _input: &[u8]) -> Option<&[u8]> { todo!("B-2") }
    pub fn has(&self, _input: &[u8]) -> bool { todo!("B-2") }
    pub fn iter(&self) -> Iterator<'_> { todo!("B-2") }
    pub fn get_name_count(&mut self) -> usize { todo!("B-2") }
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE-A DRAFT (gated — preserved verbatim for B-2 un-gating)
// ══════════════════════════════════════════════════════════════════════════
#[cfg(any())]
mod _phase_a_draft {

use core::cell::RefCell;

use bun_collections::{MultiArrayList, StaticBitSet};
use bun_core::{self, fmt as bun_fmt, Output};
use bun_paths::resolve_path;
use bun_schema::api;
use bun_str::{self as bun_string, strings};
use bun_wyhash::hash as wyhash;

// TYPE_ONLY(b0): router::Param::List moved down into url (CYCLEBREAK.md).
// bun_router (T4) now re-imports this; move-in pass reconciles the canonical def.
pub mod route_param {
    use super::MultiArrayList;

    // TODO(port): lifetime — name/value borrow from route name + request path
    #[derive(Clone, Copy)]
    pub struct Param {
        pub name: &'static [u8],
        pub value: &'static [u8],
    }

    pub type List = MultiArrayList<Param>;
}
use route_param::List as ParamsList;

// MOVE_DOWN(b0): bun_jsc::URL (WHATWG/WTF::URL FFI shim) moved into this crate.
// Ground truth: src/jsc/URL.zig. The JS-value entry points (`hrefFromJS`, `fromJS`)
// stay in tier-6 `bun_jsc` as extension methods — they need JSValue/JSGlobalObject.
// Everything else is a thin extern-"C" wrapper around WTF::URL and is JSC-agnostic.
pub mod whatwg {
    use super::bun_string::String;
    use super::strings;

    /// Opaque handle to a heap-allocated WTF::URL (C++). Always behind `*mut URL`.
    /// Construct via `from_string`/`from_utf8`; free via `deinit`.
    #[repr(C)]
    pub struct URL {
        _opaque: [u8; 0],
    }

    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        // `URL__fromJS` / `URL__getHrefFromJS` intentionally omitted — tier-6 (bun_jsc).
        fn URL__fromString(str: *mut String) -> Option<core::ptr::NonNull<URL>>;
        fn URL__protocol(url: *mut URL) -> String;
        fn URL__href(url: *mut URL) -> String;
        fn URL__username(url: *mut URL) -> String;
        fn URL__password(url: *mut URL) -> String;
        fn URL__search(url: *mut URL) -> String;
        fn URL__host(url: *mut URL) -> String;
        fn URL__hostname(url: *mut URL) -> String;
        fn URL__port(url: *mut URL) -> u32;
        fn URL__deinit(url: *mut URL) -> ();
        fn URL__pathname(url: *mut URL) -> String;
        fn URL__getHref(input: *mut String) -> String;
        fn URL__getFileURLString(input: *mut String) -> String;
        fn URL__getHrefJoin(base: *mut String, relative: *mut String) -> String;
        fn URL__pathFromFileURL(input: *mut String) -> String;
        fn URL__hash(url: *mut URL) -> String;
        fn URL__fragmentIdentifier(url: *mut URL) -> String;
        fn URL__originLength(latin1_slice: *const u8, len: usize) -> u32;
    }

    // PORT NOTE: Zig takes `bun.String` by value then `var input = str; f(&input)` purely to
    // obtain a mutable address for C ABI. We take `&String` (matching existing call sites in
    // this crate) and cast through `*mut` — the C++ side does not actually mutate the input.
    #[inline]
    fn as_mut_ptr(s: &String) -> *mut String {
        s as *const String as *mut String
    }

    /// Percent-encodes the URL, punycode-encodes the hostname, and returns the normalized
    /// href. If parsing fails, the returned String's tag is `Dead`.
    pub fn href_from_string(str: &String) -> String {
        unsafe { URL__getHref(as_mut_ptr(str)) }
    }

    pub fn join(base: &String, relative: &String) -> String {
        unsafe { URL__getHrefJoin(as_mut_ptr(base), as_mut_ptr(relative)) }
    }

    pub fn file_url_from_string(str: &String) -> String {
        unsafe { URL__getFileURLString(as_mut_ptr(str)) }
    }

    pub fn path_from_file_url(str: &String) -> String {
        unsafe { URL__pathFromFileURL(as_mut_ptr(str)) }
    }

    pub fn origin_from_slice(slice: &[u8]) -> Option<&[u8]> {
        // a valid URL will not have non-ascii in the origin.
        let first_non_ascii = strings::first_non_ascii(slice)
            .map(|i| i as usize)
            .unwrap_or(slice.len());
        let len = unsafe { URL__originLength(slice.as_ptr(), first_non_ascii) };
        if len == 0 {
            return None;
        }
        Some(&slice[..len as usize])
    }

    impl URL {
        pub fn from_string(str: &String) -> Option<core::ptr::NonNull<URL>> {
            unsafe { URL__fromString(as_mut_ptr(str)) }
        }

        pub fn from_utf8(input: &[u8]) -> Option<core::ptr::NonNull<URL>> {
            Self::from_string(&String::borrow_utf8(input))
        }

        /// Includes the leading '#'.
        pub fn hash(&mut self) -> String {
            unsafe { URL__hash(self) }
        }

        /// Exactly the same as `hash`, excluding the leading '#'.
        pub fn fragment_identifier(&mut self) -> String {
            unsafe { URL__fragmentIdentifier(self) }
        }

        pub fn protocol(&mut self) -> String {
            unsafe { URL__protocol(self) }
        }

        pub fn href(&mut self) -> String {
            unsafe { URL__href(self) }
        }

        pub fn username(&mut self) -> String {
            unsafe { URL__username(self) }
        }

        pub fn password(&mut self) -> String {
            unsafe { URL__password(self) }
        }

        pub fn search(&mut self) -> String {
            unsafe { URL__search(self) }
        }

        /// Returns the host WITHOUT the port.
        ///
        /// Note that this does NOT match JS behavior, which returns the host with the port. See
        /// `hostname` for the JS equivalent of `host`.
        ///
        /// ```text
        /// URL("http://example.com:8080").host() => "example.com"
        /// ```
        pub fn host(&mut self) -> String {
            unsafe { URL__host(self) }
        }

        /// Returns the host WITH the port.
        ///
        /// Note that this does NOT match JS behavior which returns the host without the port. See
        /// `host` for the JS equivalent of `hostname`.
        ///
        /// ```text
        /// URL("http://example.com:8080").hostname() => "example.com:8080"
        /// ```
        pub fn hostname(&mut self) -> String {
            unsafe { URL__hostname(self) }
        }

        /// Returns `u32::MAX` if the port is not set. Otherwise, the result is
        /// guaranteed to be within the `u16` range.
        pub fn port(&mut self) -> u32 {
            unsafe { URL__port(self) }
        }

        pub fn pathname(&mut self) -> String {
            unsafe { URL__pathname(self) }
        }

        pub fn deinit(&mut self) {
            unsafe { URL__deinit(self) }
        }
    }
}
// Re-export the free helpers at crate root so lower-tier callers can write
// `bun_url::join(...)` / `bun_url::href_from_string(...)` (install, http, bake, js_parser).
pub use whatwg::{file_url_from_string, href_from_string, join, origin_from_slice, path_from_file_url};

bun_output::declare_scope!(URL, visible);

// PORT NOTE: URL is a pure view struct — every field is a slice into `href` (or a
// literal default). Zig expresses this with `[]const u8` fields borrowing the
// caller-provided `base`. Phase A normally avoids lifetime params on structs, but
// the only correct representation here is `&'a [u8]`; `Box`/`&'static`/raw would
// all misrepresent ownership. Phase B should confirm.
#[derive(Clone)]
pub struct URL<'a> {
    pub hash: &'a [u8],
    /// hostname, but with a port
    /// `localhost:3000`
    pub host: &'a [u8],
    /// hostname does not have a port
    /// `localhost`
    pub hostname: &'a [u8],
    pub href: &'a [u8],
    pub origin: &'a [u8],
    pub password: &'a [u8],
    pub pathname: &'a [u8],
    pub path: &'a [u8],
    pub port: &'a [u8],
    pub protocol: &'a [u8],
    pub search: &'a [u8],
    pub search_params: Option<QueryStringMap>,
    pub username: &'a [u8],
    pub port_was_automatically_set: bool,
}

impl<'a> Default for URL<'a> {
    fn default() -> Self {
        Self {
            hash: b"",
            host: b"",
            hostname: b"",
            href: b"",
            origin: b"",
            password: b"",
            pathname: b"/",
            path: b"/",
            port: b"",
            protocol: b"",
            search: b"",
            search_params: None,
            username: b"",
            port_was_automatically_set: false,
        }
    }
}

impl<'a> URL<'a> {
    pub fn is_file(&self) -> bool {
        self.protocol == b"file"
    }

    /// host + path without the ending slash, protocol, searchParams and hash
    pub fn host_with_path(&self) -> &'a [u8] {
        if !self.host.is_empty() {
            if self.path.len() > 1
                && bun_core::is_slice_in_buffer(self.path, self.href)
                && bun_core::is_slice_in_buffer(self.host, self.href)
            {
                let end = self.path.as_ptr() as usize + self.path.len();
                let start = self.host.as_ptr() as usize;
                let len: usize = end
                    - start
                    - (if self.path.ends_with(b"/") { 1usize } else { 0usize });
                let ptr = start as *const u8;
                // SAFETY: start..end is a subrange of self.href (both slices verified above)
                return unsafe { core::slice::from_raw_parts(ptr, len) };
            }
            return self.host;
        }
        b""
    }

    /// `"blob:".len + UUID.stringLength` — see `runtime/webcore/ObjectURLRegistry.specifier_len`.
    const BLOB_SPECIFIER_LEN: usize = b"blob:".len() + 36;

    pub fn is_blob(&self) -> bool {
        self.href.len() == Self::BLOB_SPECIFIER_LEN && self.href.starts_with(b"blob:")
    }

    // PORT NOTE: `fromJS` alias to url_jsc deleted per PORTING.md — JSC interop lives
    // in bun_url_jsc as an extension trait.

    // TODO(port): ownership — Zig returns a URL borrowing from a freshly-allocated
    // owned slice (`href.toOwnedSlice`). Caller is responsible for freeing href.
    // Returning URL<'static> here leaks; Phase B should decide on an owning wrapper.
    pub fn from_string(input: &bun_string::String) -> Result<URL<'static>, bun_core::Error> {
        // MOVE_DOWN(b0): resolved — `whatwg::href_from_string` now lives in this crate.
        let href = whatwg::href_from_string(input);
        if href.tag() == bun_string::Tag::Dead {
            return Err(bun_core::err!("InvalidURL"));
        }
        // `defer href.deref()` — bun_str::String impls Drop
        let owned = href.to_owned_slice()?; // TODO(port): narrow error set
        // SAFETY/TODO(port): leaking owned slice to get 'static; matches Zig caller-frees contract
        let leaked: &'static [u8] = Box::leak(owned);
        Ok(URL::parse(leaked))
    }

    pub fn from_utf8(input: &[u8]) -> Result<URL<'static>, bun_core::Error> {
        Self::from_string(&bun_string::String::borrow_utf8(input))
    }

    pub fn is_localhost(&self) -> bool {
        self.hostname.is_empty()
            || self.hostname == b"localhost"
            || self.hostname == b"0.0.0.0"
    }

    #[inline]
    pub fn is_unix(&self) -> bool {
        self.protocol.starts_with(b"unix")
    }

    pub fn display_protocol(&self) -> &[u8] {
        if !self.protocol.is_empty() {
            return self.protocol;
        }

        if let Some(port) = self.get_port() {
            if port == 443 {
                return b"https";
            }
        }

        b"http"
    }

    #[inline]
    pub fn is_https(&self) -> bool {
        self.protocol == b"https"
    }

    #[inline]
    pub fn is_s3(&self) -> bool {
        self.protocol == b"s3"
    }

    #[inline]
    pub fn is_http(&self) -> bool {
        self.protocol == b"http"
    }

    pub fn display_hostname(&self) -> &[u8] {
        if !self.hostname.is_empty() {
            return self.hostname;
        }

        b"localhost"
    }

    pub fn s3_path(&self) -> &'a [u8] {
        // we need to remove protocol if exists and ignore searchParams, should be host + pathname
        let href = if !self.protocol.is_empty() && self.href.len() > self.protocol.len() + 2 {
            &self.href[self.protocol.len() + 2..]
        } else {
            self.href
        };
        &href[0..href.len() - (self.search.len() + self.hash.len())]
    }

    pub fn display_host(&self) -> bun_fmt::HostFormatter<'_> {
        bun_fmt::HostFormatter {
            host: if !self.host.is_empty() { self.host } else { self.display_hostname() },
            port: if !self.port.is_empty() { self.get_port() } else { None },
            is_https: self.is_https(),
        }
    }

    pub fn has_http_like_protocol(&self) -> bool {
        self.protocol == b"http" || self.protocol == b"https"
    }

    pub fn get_port(&self) -> Option<u16> {
        // TODO(port): std.fmt.parseInt on []const u8 — port digits are always ASCII
        core::str::from_utf8(self.port).ok()?.parse::<u16>().ok()
    }

    pub fn get_port_auto(&self) -> u16 {
        self.get_port().unwrap_or_else(|| self.get_default_port())
    }

    pub fn get_default_port(&self) -> u16 {
        if self.is_https() { 443u16 } else { 80u16 }
    }

    pub fn is_ip_address(&self) -> bool {
        strings::is_ip_address(self.hostname)
    }

    pub fn has_valid_port(&self) -> bool {
        self.get_port().unwrap_or(0) > 0
    }

    pub fn is_empty(&self) -> bool {
        self.href.is_empty()
    }

    pub fn is_absolute(&self) -> bool {
        !self.hostname.is_empty() && !self.pathname.is_empty()
    }

    pub fn join_normalize<'b>(
        out: &'b mut [u8],
        prefix: &[u8],
        dirname: &[u8],
        basename: &[u8],
        extname: &[u8],
    ) -> &'b [u8] {
        let mut buf = [0u8; 2048];

        let mut path_parts: [&[u8]; 10] = [b""; 10];
        let mut path_end: usize = 0;

        path_parts[0] = b"/";
        path_end += 1;

        if !prefix.is_empty() {
            path_parts[path_end] = prefix;
            path_end += 1;
        }

        if !dirname.is_empty() {
            path_parts[path_end] = strings::trim(dirname, b"/\\");
            path_end += 1;
        }

        if !basename.is_empty() {
            if !dirname.is_empty() {
                path_parts[path_end] = b"/";
                path_end += 1;
            }

            path_parts[path_end] = strings::trim(basename, b"/\\");
            path_end += 1;
        }

        if !extname.is_empty() {
            path_parts[path_end] = extname;
            path_end += 1;
        }

        let mut buf_i: usize = 0;
        for part in &path_parts[0..path_end] {
            buf[buf_i..buf_i + part.len()].copy_from_slice(part);
            buf_i += part.len();
        }
        resolve_path::normalize_string_buf(&buf[0..buf_i], out, false, resolve_path::Platform::Loose, false)
    }

    pub fn join_write(
        &self,
        writer: &mut impl bun_io::Write,
        prefix: &[u8],
        dirname: &[u8],
        basename: &[u8],
        extname: &[u8],
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut out = [0u8; 2048];
        let normalized_path = Self::join_normalize(&mut out, prefix, dirname, basename, extname);

        // Zig: writer.print("{s}/{s}", .{ this.origin, normalized_path })
        writer.write_all(self.origin)?;
        writer.write_all(b"/")?;
        writer.write_all(normalized_path)?;
        Ok(())
    }

    pub fn join_alloc(
        &self,
        prefix: &[u8],
        dirname: &[u8],
        basename: &[u8],
        extname: &[u8],
        absolute_path: &[u8],
    ) -> Result<Box<[u8]>, bun_core::Error> {
        // TODO(port): narrow error set
        let has_uplevels = strings::index_of(dirname, b"../").is_some();

        if has_uplevels {
            // std.fmt.allocPrint("{s}/abs:{s}")
            let mut v = Vec::with_capacity(self.origin.len() + 5 + absolute_path.len());
            v.extend_from_slice(self.origin);
            v.extend_from_slice(b"/abs:");
            v.extend_from_slice(absolute_path);
            Ok(v.into_boxed_slice())
        } else {
            let mut out = [0u8; 2048];
            let normalized_path = Self::join_normalize(&mut out, prefix, dirname, basename, extname);
            let mut v = Vec::with_capacity(self.origin.len() + 1 + normalized_path.len());
            v.extend_from_slice(self.origin);
            v.extend_from_slice(b"/");
            v.extend_from_slice(normalized_path);
            Ok(v.into_boxed_slice())
        }
    }

    pub fn parse(base: &'a [u8]) -> URL<'a> {
        if base.is_empty() {
            return URL::default();
        }
        let mut url = URL::default();
        url.href = base;
        // PORT NOTE: Zig uses u31; Rust has no u31 — using u32 (values never approach 2^31).
        let mut offset: u32 = 0;
        match base[0] {
            b'@' => {
                offset += url.parse_password(&base[offset as usize..]).unwrap_or(0);
                offset += url.parse_host(&base[offset as usize..]).unwrap_or(0);
            }
            b'/' | b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b':' => {
                let is_protocol_relative = base.len() > 1 && base[1] == b'/';
                if is_protocol_relative {
                    offset += 1;
                } else {
                    offset += url.parse_protocol(&base[offset as usize..]).unwrap_or(0);
                }

                let is_relative_path = !is_protocol_relative && base[0] == b'/';

                if !is_relative_path {
                    // if there's no protocol or @, it's ambiguous whether the colon is a port or a username.
                    if offset > 0 {
                        // see https://github.com/oven-sh/bun/issues/1390
                        let first_at = strings::index_of_char(&base[offset as usize..], b'@').unwrap_or(0);
                        let first_colon = strings::index_of_char(&base[offset as usize..], b':').unwrap_or(0);

                        if first_at > first_colon
                            && first_at
                                < strings::index_of_char(&base[offset as usize..], b'/')
                                    .unwrap_or(u32::MAX)
                        {
                            offset += url.parse_username(&base[offset as usize..]).unwrap_or(0);
                            offset += url.parse_password(&base[offset as usize..]).unwrap_or(0);
                        }
                    }

                    offset += url.parse_host(&base[offset as usize..]).unwrap_or(0);
                }
            }
            _ => {}
        }

        url.origin = &base[0..offset as usize];
        let mut hash_offset: u32 = u32::MAX;

        if offset as usize > base.len() {
            return url;
        }

        let path_offset = offset;

        let mut can_update_path = true;
        if base.len() > offset as usize + 1 && base[offset as usize] == b'/' && !base[offset as usize..].is_empty() {
            url.path = &base[offset as usize..];
            url.pathname = url.path;
        }

        if let Some(q) = strings::index_of_char(&base[offset as usize..], b'?') {
            offset += u32::try_from(q).unwrap();
            url.path = &base[path_offset as usize..][0..q as usize];
            can_update_path = false;
            url.search = &base[offset as usize..];
        }

        if let Some(hash) = strings::index_of_char(&base[offset as usize..], b'#') {
            offset += u32::try_from(hash).unwrap();
            hash_offset = offset;
            if can_update_path {
                url.path = &base[path_offset as usize..][0..hash as usize];
            }
            url.hash = &base[offset as usize..];

            if !url.search.is_empty() {
                url.search = &url.search[0..url.search.len() - url.hash.len()];
            }
        }

        if base.len() > path_offset as usize && base[path_offset as usize] == b'/' && offset > 0 {
            if !url.search.is_empty() {
                url.pathname = &base[path_offset as usize
                    ..((offset as usize + url.search.len()).min(base.len())).min(hash_offset as usize)];
            } else if hash_offset < u32::MAX {
                url.pathname = &base[path_offset as usize..hash_offset as usize];
            }

            url.origin = &base[0..path_offset as usize];
        }

        if url.path.len() > 1 {
            let trimmed = strings::trim(url.path, b"/");
            if trimmed.len() > 1 {
                let ptr_diff = (trimmed.as_ptr() as usize) - (url.path.as_ptr() as usize);
                let start = (ptr_diff.max(1) - 1).min(hash_offset as usize);
                url.path = &url.path[start..];
            } else {
                url.path = b"/";
            }
        } else {
            url.path = b"/";
        }

        if url.pathname.is_empty() {
            url.pathname = b"/";
        }

        const SLASH_SLASH: u16 = u16::from_le_bytes(*b"//");
        while url.pathname.len() > 1
            && u16::from_le_bytes([url.pathname[0], url.pathname[1]]) == SLASH_SLASH
        {
            url.pathname = &url.pathname[1..];
        }

        url.origin = strings::trim(url.origin, b"/ ?#");
        url
    }

    pub fn parse_protocol(&mut self, str: &'a [u8]) -> Option<u32> {
        if str.len() < b"://".len() {
            return None;
        }
        for i in 0..str.len() {
            match str[i] {
                b'/' | b'?' | b'%' => {
                    return None;
                }
                b':' => {
                    if i + 3 <= str.len() && str[i + 1] == b'/' && str[i + 2] == b'/' {
                        self.protocol = &str[0..i];
                        return Some(u32::try_from(i + 3).unwrap());
                    }
                }
                _ => {}
            }
        }

        None
    }

    pub fn parse_username(&mut self, str: &'a [u8]) -> Option<u32> {
        // reset it
        self.username = b"";

        if str.len() < b"@".len() {
            return None;
        }
        for i in 0..str.len() {
            match str[i] {
                b':' | b'@' => {
                    // we found a username, everything before this point in the slice is a username
                    self.username = &str[0..i];
                    return Some(u32::try_from(i + 1).unwrap());
                }
                // if we reach a slash or "?", there's no username
                b'?' | b'/' => {
                    return None;
                }
                _ => {}
            }
        }
        None
    }

    pub fn parse_password(&mut self, str: &'a [u8]) -> Option<u32> {
        // reset it
        self.password = b"";

        if str.len() < b"@".len() {
            return None;
        }
        for i in 0..str.len() {
            match str[i] {
                b'@' => {
                    // we found a password, everything before this point in the slice is a password
                    self.password = &str[0..i];
                    if cfg!(debug_assertions) {
                        debug_assert!(
                            str[i..].len() < 2
                                || u16::from_le_bytes([str[i], str[i + 1]])
                                    != u16::from_le_bytes(*b"//")
                        );
                    }
                    return Some(u32::try_from(i + 1).unwrap());
                }
                // if we reach a slash or "?", there's no password
                b'?' | b'/' => {
                    return None;
                }
                _ => {}
            }
        }
        None
    }

    pub fn parse_host(&mut self, str: &'a [u8]) -> Option<u32> {
        let mut i: u32 = 0;

        // reset it
        self.host = b"";
        self.hostname = b"";
        self.port = b"";

        // if starts with "[" so its IPV6
        if !str.is_empty() && str[0] == b'[' {
            i = 1;
            let mut ipv6_i: Option<u32> = None;
            let mut colon_i: Option<u32> = None;

            while (i as usize) < str.len() {
                ipv6_i = if ipv6_i.is_none() && str[i as usize] == b']' { Some(i) } else { ipv6_i };
                colon_i = if ipv6_i.is_some() && colon_i.is_none() && str[i as usize] == b':' {
                    Some(i)
                } else {
                    colon_i
                };
                match str[i as usize] {
                    // alright, we found the slash or "?"
                    b'?' | b'/' => {
                        break;
                    }
                    _ => {}
                }
                i += 1;
            }

            self.host = &str[0..i as usize];
            if let Some(ipv6) = ipv6_i {
                // hostname includes "[" and "]"
                self.hostname = &str[0..ipv6 as usize + 1];
            }

            if let Some(colon) = colon_i {
                self.port = &str[colon as usize + 1..i as usize];
            }
        } else {
            // look for the first "/" or "?"
            // if we have a slash or "?", anything before that is the host
            // anything before the colon is the hostname
            // anything after the colon but before the slash is the port
            // the origin is the scheme before the slash

            let mut colon_i: Option<u32> = None;
            while (i as usize) < str.len() {
                colon_i = if colon_i.is_none() && str[i as usize] == b':' { Some(i) } else { colon_i };

                match str[i as usize] {
                    // alright, we found the slash or "?"
                    b'?' | b'/' => {
                        break;
                    }
                    _ => {}
                }
                i += 1;
            }

            self.host = &str[0..i as usize];
            if let Some(colon) = colon_i {
                self.hostname = &str[0..colon as usize];
                self.port = &str[colon as usize + 1..i as usize];
            } else {
                self.hostname = &str[0..i as usize];
            }
        }

        Some(i)
    }
}

/// QueryString array-backed hash table that does few allocations and preserves the original order
pub struct QueryStringMap {
    // PORT NOTE: allocator field dropped — global mimalloc per PORTING.md.
    // TODO(port): `slice` is self-referential (points into `buffer`) when decoding
    // happened, otherwise borrows the caller's query_string. Stored as raw fat ptr.
    slice: *const [u8],
    pub buffer: Vec<u8>,
    pub list: ParamList,
    pub name_count: Option<usize>,
}

pub type ParamList = MultiArrayList<Param>;
// TODO(port): MultiArrayList::Slice associated type — confirm exact API in bun_collections
pub type ParamListSlice<'a> = <MultiArrayList<Param> as bun_collections::MultiArrayListExt>::Slice<'a>;

thread_local! {
    // PORT NOTE: unused in current code (commented-out path in get_name_count)
    static NAME_COUNT_BUF: RefCell<[*const [u8]; 8]> = const { RefCell::new([&[] as *const [u8]; 8]) };
}

impl QueryStringMap {
    pub fn get_name_count(&mut self) -> usize {
        self.list.len()
        // if (this.name_count == null) {
        //     var count: usize = 0;
        //     var iterate = this.iter();
        //     while (iterate.next(&_name_count) != null) {
        //         count += 1;
        //     }
        //     this.name_count = count;
        // }
        // return this.name_count.?;
    }

    pub fn iter(&self) -> Iterator<'_> {
        Iterator::init(self)
    }

    pub fn str(&self, ptr: api::StringPointer) -> &[u8] {
        // SAFETY: `slice` is valid for the lifetime of `self` (either borrows
        // `self.buffer` or an external query_string the caller keeps alive).
        let slice = unsafe { &*self.slice };
        &slice[ptr.offset as usize..ptr.offset as usize + ptr.length as usize]
    }

    pub fn get_index(&self, input: &[u8]) -> Option<usize> {
        let hash = wyhash(input);
        self.list.items_name_hash().iter().position(|&h| h == hash)
    }

    pub fn get(&self, input: &[u8]) -> Option<&[u8]> {
        let hash = wyhash(input);
        let slice = self.list.slice();
        let i = slice.items_name_hash().iter().position(|&h| h == hash)?;
        Some(self.str(slice.items_value()[i]))
    }

    pub fn has(&self, input: &[u8]) -> bool {
        self.get_index(input).is_some()
    }

    pub fn get_all<'t>(&self, input: &[u8], target: &'t mut [&[u8]]) -> usize {
        let hash = wyhash(input);
        let slice = self.list.slice();
        // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
        self.get_all_with_hash_from_offset(target, hash, 0, slice)
    }

    pub fn get_all_with_hash_from_offset<'t>(
        &self,
        target: &'t mut [&[u8]],
        hash: u64,
        offset: usize,
        slice: ParamListSlice<'_>,
    ) -> usize {
        let mut remainder_hashes = &slice.items_name_hash()[offset..];
        let mut remainder_values = &slice.items_value()[offset..];
        let mut target_i: usize = 0;
        while !remainder_hashes.is_empty() && target_i < target.len() {
            let Some(i) = remainder_hashes.iter().position(|&h| h == hash) else {
                break;
            };
            target[target_i] = self.str(remainder_values[i]);
            remainder_values = &remainder_values[i + 1..];
            remainder_hashes = &remainder_hashes[i + 1..];
            target_i += 1;
        }
        target_i
    }

    pub fn init_with_scanner(
        mut scanner: CombinedScanner<'_>,
    ) -> Result<Option<QueryStringMap>, bun_alloc::AllocError> {
        let mut list = ParamList::default();

        let mut estimated_str_len: usize = 0;
        let mut count: usize = 0;

        let mut nothing_needs_decoding = true;

        while let Some(result) = scanner.pathname.next() {
            if result.name_needs_decoding || result.value_needs_decoding {
                nothing_needs_decoding = false;
            }
            estimated_str_len += result.name.length as usize + result.value.length as usize;
            count += 1;
        }

        debug_assert!(count > 0); // We should not call initWithScanner when there are no path params

        while let Some(result) = scanner.query.next() {
            if result.name_needs_decoding || result.value_needs_decoding {
                nothing_needs_decoding = false;
            }
            estimated_str_len += result.name.length as usize + result.value.length as usize;
            count += 1;
        }

        if count == 0 {
            return Ok(None);
        }

        list.reserve(count); // PERF(port): was ensureTotalCapacity
        scanner.reset();

        // this over-allocates
        // TODO: refactor this to support multiple slices instead of copying the whole thing
        let mut buf: Vec<u8> = Vec::with_capacity(estimated_str_len);
        let mut buf_writer_pos: u32 = 0;

        while let Some(result) = scanner.pathname.next() {
            let mut name = result.name;
            let mut value = result.value;
            let name_slice = result.raw_name(scanner.pathname.routename);

            name.length = name_slice.len() as u32;
            name.offset = buf_writer_pos;
            buf.extend_from_slice(name_slice);
            buf_writer_pos += name_slice.len() as u32;

            let name_hash: u64 = wyhash(name_slice);

            value.length = match PercentEncoding::decode(
                &mut buf,
                result.raw_value(scanner.pathname.pathname),
            ) {
                Ok(n) => n,
                Err(_) => continue,
            };
            value.offset = buf_writer_pos;
            buf_writer_pos += value.length;

            // PERF(port): was appendAssumeCapacity
            list.push(Param { name, value, name_hash });
        }

        let route_parameter_begin = list.len();

        while let Some(result) = scanner.query.next() {
            let list_slice = list.slice();

            let mut name = result.name;
            let mut value = result.value;
            let name_hash: u64;
            if result.name_needs_decoding {
                name.length = match PercentEncoding::decode(
                    &mut buf,
                    &scanner.query.query_string[name.offset as usize..][..name.length as usize],
                ) {
                    Ok(n) => n,
                    Err(_) => continue,
                };
                name.offset = buf_writer_pos;
                buf_writer_pos += name.length;
                name_hash = wyhash(&buf[name.offset as usize..][..name.length as usize]);
            } else {
                name_hash = wyhash(result.raw_name(scanner.query.query_string));
                if let Some(index) = list_slice.items_name_hash().iter().position(|&h| h == name_hash) {
                    // query string parameters should not override route parameters
                    // see https://nextjs.org/docs/routing/dynamic-routes
                    if index < route_parameter_begin {
                        continue;
                    }

                    name = list_slice.items_name()[index];
                } else {
                    name.length = match PercentEncoding::decode(
                        &mut buf,
                        &scanner.query.query_string[name.offset as usize..][..name.length as usize],
                    ) {
                        Ok(n) => n,
                        Err(_) => continue,
                    };
                    name.offset = buf_writer_pos;
                    buf_writer_pos += name.length;
                }
            }

            value.length = match PercentEncoding::decode(
                &mut buf,
                &scanner.query.query_string[value.offset as usize..][..value.length as usize],
            ) {
                Ok(n) => n,
                Err(_) => continue,
            };
            value.offset = buf_writer_pos;
            buf_writer_pos += value.length;

            // PERF(port): was appendAssumeCapacity
            list.push(Param { name, value, name_hash });
        }

        // buf.expandToCapacity() — Vec doesn't expose this; not needed since we slice by buf_writer_pos
        let _ = nothing_needs_decoding;
        let slice_ptr: *const [u8] = &buf[0..buf_writer_pos as usize] as *const [u8];
        Ok(Some(QueryStringMap {
            list,
            buffer: buf,
            slice: slice_ptr,
            name_count: None,
        }))
    }

    pub fn init(query_string: &[u8]) -> Result<Option<QueryStringMap>, bun_alloc::AllocError> {
        let mut list = ParamList::default();

        let mut scanner = Scanner::init(query_string);
        let mut count: usize = 0;
        let mut estimated_str_len: usize = 0;

        let mut nothing_needs_decoding = true;
        while let Some(result) = scanner.next() {
            if result.name_needs_decoding || result.value_needs_decoding {
                nothing_needs_decoding = false;
            }
            estimated_str_len += result.name.length as usize + result.value.length as usize;
            count += 1;
        }

        if count == 0 {
            return Ok(None);
        }

        scanner = Scanner::init(query_string);
        list.reserve(count); // PERF(port): was ensureTotalCapacity

        if nothing_needs_decoding {
            scanner = Scanner::init(query_string);
            while let Some(result) = scanner.next() {
                debug_assert!(!result.name_needs_decoding);
                debug_assert!(!result.value_needs_decoding);

                let name = result.name;
                let value = result.value;
                let name_hash: u64 = wyhash(result.raw_name(query_string));
                // PERF(port): was appendAssumeCapacity
                list.push(Param { name, value, name_hash });
            }

            return Ok(Some(QueryStringMap {
                list,
                buffer: Vec::new(),
                // TODO(port): borrows external query_string; lifetime not tracked in Phase A
                slice: query_string as *const [u8],
                name_count: None,
            }));
        }

        let mut buf: Vec<u8> = Vec::with_capacity(estimated_str_len);
        let mut buf_writer_pos: u32 = 0;

        // PORT NOTE: reshaped for borrowck — Zig captured `list.slice()` once outside
        // the loop; here we re-slice per iteration to avoid holding a borrow across push().
        while let Some(result) = scanner.next() {
            let mut name = result.name;
            let mut value = result.value;
            let name_hash: u64;
            if result.name_needs_decoding {
                name.length = match PercentEncoding::decode(
                    &mut buf,
                    &query_string[name.offset as usize..][..name.length as usize],
                ) {
                    Ok(n) => n,
                    Err(_) => continue,
                };
                name.offset = buf_writer_pos;
                buf_writer_pos += name.length;
                name_hash = wyhash(&buf[name.offset as usize..][..name.length as usize]);
            } else {
                name_hash = wyhash(result.raw_name(query_string));
                let list_slice = list.slice();
                if let Some(index) = list_slice.items_name_hash().iter().position(|&h| h == name_hash) {
                    name = list_slice.items_name()[index];
                } else {
                    name.length = match PercentEncoding::decode(
                        &mut buf,
                        &query_string[name.offset as usize..][..name.length as usize],
                    ) {
                        Ok(n) => n,
                        Err(_) => continue,
                    };
                    name.offset = buf_writer_pos;
                    buf_writer_pos += name.length;
                }
            }

            value.length = match PercentEncoding::decode(
                &mut buf,
                &query_string[value.offset as usize..][..value.length as usize],
            ) {
                Ok(n) => n,
                Err(_) => continue,
            };
            value.offset = buf_writer_pos;
            buf_writer_pos += value.length;

            // PERF(port): was appendAssumeCapacity
            list.push(Param { name, value, name_hash });
        }

        let slice_ptr: *const [u8] = &buf[0..buf_writer_pos as usize] as *const [u8];
        Ok(Some(QueryStringMap {
            list,
            buffer: buf,
            slice: slice_ptr,
            name_count: None,
        }))
    }
}

// Assume no query string param map will exceed 2048 keys
// Browsers typically limit URL lengths to around 64k
type VisitedMap = StaticBitSet<2048>;

pub struct Iterator<'a> {
    pub i: usize,
    pub map: &'a QueryStringMap,
    pub visited: VisitedMap,
}

pub struct IteratorResult<'a> {
    pub name: &'a [u8],
    pub values: &'a mut [&'a [u8]],
}

impl<'a> Iterator<'a> {
    pub fn init(map: &'a QueryStringMap) -> Iterator<'a> {
        Iterator { i: 0, map, visited: VisitedMap::init_empty() }
    }

    // TODO(port): lifetime on `target`/return — values borrow target, name borrows map.slice
    pub fn next<'t>(&mut self, target: &'t mut [&'a [u8]]) -> Option<IteratorResult<'t>>
    where
        'a: 't,
    {
        while self.visited.is_set(self.i) {
            self.i += 1;
        }
        if self.i >= self.map.list.len() {
            return None;
        }

        let slice = self.map.list.slice();
        let hash = slice.items_name_hash()[self.i];
        let name_slice = slice.items_name()[self.i];
        debug_assert!(name_slice.length > 0);
        let name = self.map.str(name_slice);
        target[0] = self.map.str(slice.items_value()[self.i]);

        self.visited.set(self.i);
        self.i += 1;

        let remainder_hashes = &slice.items_name_hash()[self.i..];
        let remainder_values = &slice.items_value()[self.i..];

        let mut target_i: usize = 1;
        let mut current_i: usize = 0;

        while let Some(next_index) = remainder_hashes[current_i..].iter().position(|&h| h == hash) {
            let real_i = current_i + next_index + self.i;
            if cfg!(debug_assertions) {
                debug_assert!(!self.visited.is_set(real_i));
            }

            self.visited.set(real_i);
            target[target_i] = self.map.str(remainder_values[current_i + next_index]);
            target_i += 1;

            current_i += next_index + 1;
            if target_i >= target.len() {
                return Some(IteratorResult { name, values: &mut target[0..target_i] });
            }
            if real_i + 1 >= self.map.list.len() {
                return Some(IteratorResult { name, values: &mut target[0..target_i] });
            }
        }

        Some(IteratorResult { name, values: &mut target[0..target_i] })
    }
}

#[derive(Clone, Copy)]
pub struct Param {
    pub name: api::StringPointer,
    pub name_hash: u64,
    pub value: api::StringPointer,
}

pub struct PercentEncoding;

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum DecodeError {
    #[error("DecodingError")]
    DecodingError,
    #[error("write failed")]
    Write(#[from] bun_core::Error),
}

impl From<DecodeError> for bun_core::Error {
    fn from(e: DecodeError) -> Self {
        match e {
            DecodeError::DecodingError => bun_core::err!("DecodingError"),
            DecodeError::Write(inner) => inner,
        }
    }
}

impl PercentEncoding {
    pub fn decode(writer: &mut impl bun_io::Write, input: &[u8]) -> Result<u32, DecodeError> {
        // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
        Self::decode_fault_tolerant::<_, false>(writer, input, None)
    }

    /// Decode percent-encoded input into allocated memory.
    /// Caller owns the returned slice and must free it with the same allocator.
    pub fn decode_alloc(input: &[u8]) -> Result<Box<[u8]>, DecodeError> {
        // Allocate enough space - decoded will be at most input.len bytes
        let mut buf: Vec<u8> = Vec::with_capacity(input.len());
        // errdefer allocator.free(buf) — Vec drops automatically on error

        // TODO(port): Zig used fixedBufferStream into a pre-sized [u8; input.len];
        // here we just write into a Vec and truncate.
        let len = Self::decode(&mut buf, input)?;

        buf.truncate(len as usize);
        Ok(buf.into_boxed_slice())
    }

    pub fn decode_fault_tolerant<W: bun_io::Write, const FAULT_TOLERANT: bool>(
        writer: &mut W,
        input: &[u8],
        needs_redirect: Option<&mut bool>,
    ) -> Result<u32, DecodeError> {
        let mut needs_redirect = needs_redirect;
        let mut i: usize = 0;
        let mut written: u32 = 0;
        // unlike JavaScript's decodeURIComponent, we are not handling invalid surrogate pairs
        // we are assuming the input is valid ascii
        while i < input.len() {
            match input[i] {
                b'%' => {
                    if FAULT_TOLERANT {
                        if !(i + 3 <= input.len()
                            && strings::is_ascii_hex_digit(input[i + 1])
                            && strings::is_ascii_hex_digit(input[i + 2]))
                        {
                            // i do not feel good about this
                            // create-react-app's public/index.html uses %PUBLIC_URL% in various tags
                            // This is an invalid %-encoded string, intended to be swapped out at build time by webpack-html-plugin
                            // We don't process HTML, so rewriting this URL path won't happen
                            // But we want to be a little more fault tolerant here than just throwing up an error for something that works in other tools
                            // So we just skip over it and issue a redirect
                            // We issue a redirect because various other tooling client-side may validate URLs
                            // We can't expect other tools to be as fault tolerant
                            if i + b"PUBLIC_URL%".len() < input.len()
                                && &input[i + 1..][..b"PUBLIC_URL%".len()] == b"PUBLIC_URL%"
                            {
                                i += b"PUBLIC_URL%".len() + 1;
                                *needs_redirect.as_deref_mut().unwrap() = true;
                                continue;
                            }
                            return Err(DecodeError::DecodingError);
                        }
                    } else {
                        if !(i + 3 <= input.len()
                            && strings::is_ascii_hex_digit(input[i + 1])
                            && strings::is_ascii_hex_digit(input[i + 2]))
                        {
                            return Err(DecodeError::DecodingError);
                        }
                    }

                    writer.write_byte(
                        (strings::to_ascii_hex_value(input[i + 1]) << 4)
                            | strings::to_ascii_hex_value(input[i + 2]),
                    )?;
                    i += 3;
                    written += 1;
                    continue;
                }
                _ => {
                    let start = i;
                    i += 1;

                    // scan ahead assuming .write_all is faster than .write_byte one at a time
                    while i < input.len() && input[i] != b'%' {
                        i += 1;
                    }
                    writer.write_all(&input[start..i])?;
                    written += (i - start) as u32;
                }
            }
        }

        Ok(written)
    }
}

// TODO(b0): FormData re-export removed — bun_runtime (T6) is upward.
// Not listed in CYCLEBREAK §url; callers should import from bun_runtime::webcore::form_data
// directly (or move-in pass relocates FormData here if it belongs at T2).
// pub use bun_runtime::webcore::form_data::FormData;

pub struct CombinedScanner<'a> {
    pub query: Scanner<'a>,
    pub pathname: PathnameScanner<'a>,
}

impl<'a> CombinedScanner<'a> {
    pub fn init(
        query_string: &'a [u8],
        pathname: &'a [u8],
        routename: &'a [u8],
        url_params: &'a ParamsList,
    ) -> CombinedScanner<'a> {
        CombinedScanner {
            query: Scanner::init(query_string),
            pathname: PathnameScanner::init(pathname, routename, url_params),
        }
    }

    pub fn reset(&mut self) {
        self.query.reset();
        self.pathname.reset();
    }

    pub fn next(&mut self) -> Option<ScannerResult> {
        self.pathname.next().or_else(|| self.query.next())
    }
}

fn string_pointer_from_strings(parent: &[u8], in_: &[u8]) -> api::StringPointer {
    if in_.is_empty() || parent.is_empty() {
        return api::StringPointer::default();
    }

    if let Some(range) = bun_core::range_of_slice_in_buffer(in_, parent) {
        return api::StringPointer { offset: range.0, length: range.1 };
    } else {
        if let Some(i) = strings::index_of(parent, in_) {
            debug_assert!(strings::eql_long(&parent[i..][..in_.len()], in_, false));

            return api::StringPointer {
                offset: i as u32,
                length: in_.len() as u32,
            };
        }
    }

    api::StringPointer::default()
}

pub struct PathnameScanner<'a> {
    pub params: &'a ParamsList,
    pub pathname: &'a [u8],
    pub routename: &'a [u8],
    pub i: usize,
}

impl<'a> PathnameScanner<'a> {
    #[inline]
    pub fn is_done(&self) -> bool {
        self.params.len() <= self.i
    }

    pub fn reset(&mut self) {
        self.i = 0;
    }

    pub fn init(pathname: &'a [u8], routename: &'a [u8], params: &'a ParamsList) -> PathnameScanner<'a> {
        PathnameScanner { pathname, routename, params, i: 0 }
    }

    pub fn next(&mut self) -> Option<ScannerResult> {
        if self.is_done() {
            return None;
        }

        let param = self.params.get(self.i);
        self.i += 1;

        Some(ScannerResult {
            // TODO: fix this technical debt
            name: string_pointer_from_strings(self.routename, param.name),
            name_needs_decoding: false,
            // TODO: fix this technical debt
            value: string_pointer_from_strings(self.pathname, param.value),
            value_needs_decoding: strings::index_of_char(param.value, b'%').is_some(),
        })
    }
}

pub struct Scanner<'a> {
    pub query_string: &'a [u8],
    pub i: usize,
    pub start: usize,
}

impl<'a> Scanner<'a> {
    pub fn init(query_string: &'a [u8]) -> Scanner<'a> {
        if !query_string.is_empty() && query_string[0] == b'?' {
            return Scanner { query_string, i: 1, start: 1 };
        }

        Scanner { query_string, i: 0, start: 0 }
    }

    #[inline]
    pub fn reset(&mut self) {
        self.i = self.start;
    }

    /// Get the next query string parameter without allocating memory.
    pub fn next(&mut self) -> Option<ScannerResult> {
        let mut relative_i: usize = 0;
        // PORT NOTE: Zig used `defer this.i += relative_i;` — emulated with a guard.
        // Because the loop body also mutates `self.i` directly (continue :loop path),
        // we apply the deferred add at every return point instead.

        // reuse stack space
        // otherwise we'd recursively call the function
        'outer: loop {
            if self.i >= self.query_string.len() {
                self.i += relative_i;
                return None;
            }

            let slice = &self.query_string[self.i..];
            relative_i = 0;
            let mut name = api::StringPointer { offset: self.i as u32, length: 0 };
            let mut value = api::StringPointer { offset: 0, length: 0 };
            let mut name_needs_decoding = false;

            while relative_i < slice.len() {
                let char = slice[relative_i];
                match char {
                    b'=' => {
                        name.length = relative_i as u32;
                        relative_i += 1;

                        value.offset = (relative_i + self.i) as u32;

                        let offset = relative_i;
                        let mut value_needs_decoding = false;
                        while relative_i < slice.len() && slice[relative_i] != b'&' {
                            value_needs_decoding = value_needs_decoding
                                || matches!(slice[relative_i], b'%' | b'+');
                            relative_i += 1;
                        }
                        value.length = (relative_i - offset) as u32;
                        // If the name is empty and it's just a value, skip it.
                        // This is kind of an opinion. But, it's hard to see where that might be intentional.
                        if name.length == 0 {
                            self.i += relative_i;
                            return None;
                        }
                        self.i += relative_i;
                        return Some(ScannerResult {
                            name,
                            value,
                            name_needs_decoding,
                            value_needs_decoding,
                        });
                    }
                    b'%' | b'+' => {
                        name_needs_decoding = true;
                    }
                    b'&' => {
                        // key&
                        if relative_i > 0 {
                            name.length = relative_i as u32;
                            self.i += relative_i;
                            return Some(ScannerResult {
                                name,
                                value,
                                name_needs_decoding,
                                value_needs_decoding: false,
                            });
                        }

                        // &&&&&&&&&&&&&key=value
                        while relative_i < slice.len() && slice[relative_i] == b'&' {
                            relative_i += 1;
                        }
                        self.i += relative_i;

                        // reuse stack space
                        continue 'outer;
                    }
                    _ => {}
                }

                relative_i += 1;
            }

            if relative_i == 0 {
                self.i += relative_i;
                return None;
            }

            name.length = relative_i as u32;
            self.i += relative_i;
            return Some(ScannerResult { name, value, name_needs_decoding, value_needs_decoding: false });
        }
    }
}

#[derive(Clone, Copy)]
pub struct ScannerResult {
    pub name_needs_decoding: bool,
    pub value_needs_decoding: bool,
    pub name: api::StringPointer,
    pub value: api::StringPointer,
}

impl ScannerResult {
    #[inline]
    pub fn raw_name<'a>(&self, query_string: &'a [u8]) -> &'a [u8] {
        if self.name.length > 0 {
            &query_string[self.name.offset as usize..][..self.name.length as usize]
        } else {
            b""
        }
    }

    #[inline]
    pub fn raw_value<'a>(&self, query_string: &'a [u8]) -> &'a [u8] {
        if self.value.length > 0 {
            &query_string[self.value.offset as usize..][..self.value.length as usize]
        } else {
            b""
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/url/url.zig (1085 lines)
//   confidence: medium
//   todos:      12
//   notes:      URL<'a> borrows href (view struct) — Phase-A rule prefers raw *const [u8] but PORT NOTE above documents the deviation for Phase B to resolve; QueryStringMap.slice is self-referential raw ptr; MultiArrayList Slice accessor API (items_name_hash/items_name/items_value) assumed; bun_io::Write trait assumed for byte writers; from_string leaks owned href to match Zig caller-frees contract.
// ──────────────────────────────────────────────────────────────────────────

} // end #[cfg(any())] mod _phase_a_draft
