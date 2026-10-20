// This is close to WHATWG URL, but we don't want the validation errors
#![warn(unused_must_use)]
pub mod error;
pub use error::{Error, Result};

use core::mem::MaybeUninit;

use bun_collections::hashbrown::{self, hash_table::Entry};
use bun_core::{self, fmt as bun_fmt};
use bun_core::{String as BunString, Tag as BunStringTag, strings};
use bun_paths::resolve_path::{self, platform};

// `bun.schema.api.StringPointer` — canonical definition lives in `bun_core`
// (T0, already a dep). Re-exported under `api::` so `QueryStringMap` /
// `CombinedScanner` field types keep resolving.
pub mod api {
    pub use bun_core::StringPointer;
}

use bun_core::io::Write as _;

// ── route_param (moved from bun_router) ───────────────────────────────────
pub mod route_param {
    // name/value borrow from the route template + the live request
    // path; lifetime-generic so `bun_router` (the only producer) can fill them
    // from non-'static buffers. Downstream that only stores literals can use
    // `Param<'static>`.
    #[derive(Clone, Copy)]
    pub struct Param<'a> {
        pub name: &'a [u8],
        pub value: &'a [u8],
    }
    // SoA (`MultiArrayList`) layout would be a perf optimization only; a plain
    // Vec is semantically identical.
    pub type List<'a> = Vec<Param<'a>>;
}
use route_param::List as ParamsList;

// ── whatwg (WTF::URL FFI shim, MOVE_DOWN from bun_jsc) ────────────────────
// The JS-value entry points (`hrefFromJS`, `fromJS`)
// stay in tier-6 `bun_jsc` as extension methods — they need JSValue/JSGlobalObject.
// Everything else is a thin extern-"C" wrapper around WTF::URL and is JSC-agnostic.
pub mod whatwg {
    use core::ptr::NonNull;

    use super::BunString as String;
    use super::strings;

    bun_opaque::opaque_ffi! {
        /// Opaque handle to a heap-allocated `WTF::URL` (C++); owned via
        /// [`Parsed`].
        pub struct URL;
    }

    // Getters take `&URL` (C++ never mutates on read). String inputs are
    // `const BunString*`; string returns are +1 (`Bun::toStringRef`), declared
    // as owning `String`. `URL__deinit` frees the allocation, so it stays
    // `unsafe fn`. `URL__getHrefFromJS` lives in `bun_jsc::URLJsc`.
    unsafe extern "C" {
        safe fn URL__fromString(str: &String) -> Option<NonNull<URL>>;
        safe fn URL__protocol(url: &URL) -> String;
        safe fn URL__href(url: &URL) -> String;
        safe fn URL__username(url: &URL) -> String;
        safe fn URL__password(url: &URL) -> String;
        safe fn URL__host(url: &URL) -> String;
        safe fn URL__hostname(url: &URL) -> String;
        safe fn URL__port(url: &URL) -> u32;
        safe fn URL__pathname(url: &URL) -> String;
        safe fn URL__fragmentIdentifier(url: &URL) -> String;
        fn URL__deinit(url: *mut URL);
        safe fn URL__getHref(input: &String) -> String;
        safe fn URL__getFileURLString(input: &String) -> String;
        safe fn URL__pathFromFileURL(input: &String) -> String;
        safe fn URL__getHrefJoin(base: &String, relative: &String) -> String;
        fn URL__originLength(latin1_slice: *const u8, len: usize) -> usize;
    }

    /// Percent-encodes the URL, punycode-encodes the hostname, and returns the normalized
    /// href. If parsing fails, the returned String's tag is `Dead`.
    pub fn href_from_string(str: &String) -> String {
        URL__getHref(str)
    }
    pub fn join(base: &String, relative: &String) -> String {
        URL__getHrefJoin(base, relative)
    }
    pub fn file_url_from_string(str: &String) -> String {
        URL__getFileURLString(str)
    }
    pub fn path_from_file_url(str: &String) -> String {
        URL__pathFromFileURL(str)
    }
    /// Returns the origin (`scheme://host[:port]`) prefix of `slice` as a borrowed
    /// subslice, or `None` if `slice` does not parse as a valid WHATWG URL.
    ///
    /// Backed by `WTF::URL::pathStart()` via `URL__originLength` (BunString.cpp).
    #[inline]
    pub fn origin_from_slice(slice: &[u8]) -> Option<&[u8]> {
        // A valid URL will not have non-ASCII bytes in its origin, so it suffices
        // to hand C++ only the leading ASCII prefix (latin1-safe).
        let first_non_ascii = strings::first_non_ascii(slice).map_or(slice.len(), |i| i as usize);
        // SAFETY: ptr/len derived from a valid slice prefix; C++ only reads.
        let len = unsafe { URL__originLength(slice.as_ptr(), first_non_ascii) };
        if len == 0 || len > first_non_ascii {
            return None;
        }
        Some(&slice[..len])
    }

    impl URL {
        /// The URL fragment (the part after `#`), excluding the leading '#'.
        pub fn fragment_identifier(&self) -> String {
            URL__fragmentIdentifier(self)
        }
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
        /// The host WITHOUT the port (JS `hostname`).
        ///
        /// ```text
        /// URL("http://example.com:8080").host() => "example.com"
        /// ```
        pub fn host(&self) -> String {
            URL__host(self)
        }
        /// The host WITH the port (JS `host`).
        ///
        /// ```text
        /// URL("http://example.com:8080").hostname() => "example.com:8080"
        /// ```
        pub fn hostname(&self) -> String {
            URL__hostname(self)
        }
        /// `u32::MAX` if the port is not set; otherwise within `u16` range.
        pub fn port(&self) -> u32 {
            URL__port(self)
        }
        pub fn pathname(&self) -> String {
            URL__pathname(self)
        }
    }

    /// A `URL` this handle owns; `Drop` frees it.
    pub struct Parsed(NonNull<URL>);

    impl Parsed {
        pub fn from_string(str: &String) -> Option<Self> {
            URL__fromString(str).map(Self)
        }
        pub fn from_utf8(input: &[u8]) -> Option<Self> {
            Self::from_string(&String::borrow_utf8(input))
        }
    }

    impl core::ops::Deref for Parsed {
        type Target = URL;
        fn deref(&self) -> &URL {
            // SAFETY: `self.0` is a live heap `WTF::URL` that only `Drop` frees.
            unsafe { self.0.as_ref() }
        }
    }

    impl Drop for Parsed {
        fn drop(&mut self) {
            // SAFETY: this handle is the only owner of the `WTF::URL`, so it is deleted once.
            unsafe { URL__deinit(self.0.as_ptr()) }
        }
    }
}
// Re-export the free helpers at crate root so lower-tier callers can write
// `bun_url::join(...)` / `bun_url::href_from_string(...)` (install, http, bake, js_parser).
pub use whatwg::{
    file_url_from_string, href_from_string, join, origin_from_slice, path_from_file_url,
};

/// Where the authority ends, which is where the search for the `@` of the userinfo stops.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AuthorityEnd {
    /// `/`, `?`, `#`, and a `\` in a special scheme. For a string that something else reads too.
    LikeNewURL,
    /// `/`, `?` or `#`, so a `\` stays userinfo. Only for a string this parser alone reads.
    SlashQueryOrHash,
}

// URL is a pure view struct — every field is a slice into `href` (or a
// literal default).
#[derive(Clone)]
pub struct URL<'a> {
    pub(crate) hash: &'a [u8],
    /// hostname, but with a port — `localhost:3000`
    pub host: &'a [u8],
    /// hostname does not have a port — `localhost`
    pub hostname: &'a [u8],
    pub href: &'a [u8],
    pub origin: &'a [u8],
    pub password: &'a [u8],
    pub pathname: &'a [u8],
    pub path: &'a [u8],
    pub port: &'a [u8],
    pub protocol: &'a [u8],
    pub(crate) search: &'a [u8],
    pub(crate) search_params: Option<QueryStringMap>,
    pub username: &'a [u8],
    pub(crate) port_was_automatically_set: bool,
    /// The rule `parse` used, so `href_without_userinfo` cuts the same bytes.
    pub(crate) authority_end: AuthorityEnd,
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
            authority_end: AuthorityEnd::LikeNewURL,
        }
    }
}

/// An owning URL — holds the normalized `href` buffer that the borrowed
/// `URL<'_>` view slices into; `Drop` frees it.
#[derive(Default, Clone)]
pub struct OwnedURL {
    href: Box<[u8]>,
}

impl OwnedURL {
    /// Borrow as a parsed `URL` view. All slices in the returned `URL` borrow
    /// `self.href`.
    // PERF: re-parses on each call. Storing a parsed view alongside the
    // buffer would be a self-reference, which Rust cannot express without
    // unsafe lifetime extension.
    // Callers in practice call this once and hold the borrow — if this shows
    // up on a hot path, store component `(u32, u32)` offsets here instead.
    #[inline]
    pub fn url(&self) -> URL<'_> {
        URL::parse(&self.href)
    }
    #[inline]
    pub fn href(&self) -> &[u8] {
        &self.href
    }
    #[inline]
    pub fn into_href(self) -> Box<[u8]> {
        self.href
    }
    /// Construct from an already-normalized href buffer (the tail of
    /// `URL::from_string` after `to_owned_slice`). Exposed so out-of-crate
    /// producers can build an `OwnedURL` without the `href` field being
    /// public.
    #[inline]
    pub fn from_href(href: Box<[u8]>) -> Self {
        Self { href }
    }
}

/// What `S3Credentials` keeps of an endpoint. See `URL::parse_s3_endpoint`.
pub struct S3Endpoint {
    /// `host[:port][/prefix]`, the form `URL::host_with_path` returns.
    pub host_with_path: Box<[u8]>,
    pub is_http: bool,
}

impl<'a> URL<'a> {
    /// Detach the borrow-checker lifetime from a `URL`.
    ///
    /// Centralized helper for the self-referential pattern where a `URL`
    /// borrows from a buffer that the caller is about to move into a sibling
    /// field on the same struct (e.g. `self.url = URL::parse(&buf);
    /// self.redirect = buf;`). All slices in `URL` are `(ptr, len)` views, so
    /// the value is bitwise unchanged — only the borrow-checker tag widens.
    ///
    /// # Safety
    /// Caller must guarantee every slice the returned `URL<'b>` references
    /// outlives `'b`. The buffer must NOT be dropped, reallocated, or mutated
    /// for the lifetime of the returned value.
    #[inline(always)]
    #[allow(unsafe_op_in_unsafe_fn)]
    pub unsafe fn erase_lifetime<'b>(self) -> URL<'b> {
        // Field-by-field reconstruction — every slice is `(ptr, len)`, so the
        // value is bitwise unchanged; only the borrow-checker tag widens.
        // `d` stays `unsafe fn` so a safe-signature wrapper does not hide the
        // lifetime-widen; the outer fn carries `#[allow(unsafe_op_in_unsafe_fn)]`
        // so the dozen call sites below need no per-line `unsafe { }`.
        #[inline(always)]
        unsafe fn d<'b>(s: &[u8]) -> &'b [u8] {
            // SAFETY: caller contract on `erase_lifetime` — every slice the
            // returned `URL<'b>` references outlives `'b`.
            unsafe { &*core::ptr::from_ref::<[u8]>(s) }
        }
        URL {
            hash: d(self.hash),
            host: d(self.host),
            hostname: d(self.hostname),
            href: d(self.href),
            origin: d(self.origin),
            password: d(self.password),
            pathname: d(self.pathname),
            path: d(self.path),
            port: d(self.port),
            protocol: d(self.protocol),
            search: d(self.search),
            search_params: self.search_params,
            username: d(self.username),
            port_was_automatically_set: self.port_was_automatically_set,
            authority_end: self.authority_end,
        }
    }

    pub fn is_file(&self) -> bool {
        strings::eql_case_insensitive_ascii(self.protocol, b"file", true)
    }

    /// host + path without the ending slash, protocol, searchParams and hash
    pub fn host_with_path(&self) -> &'a [u8] {
        if !self.host.is_empty() {
            if self.path.len() > 1
                && bun_alloc::is_slice_in_buffer(self.path, self.href)
                && bun_alloc::is_slice_in_buffer(self.host, self.href)
            {
                let end = self.path.as_ptr() as usize + self.path.len();
                let start = self.host.as_ptr() as usize;
                let len: usize = end
                    - start
                    - (if self.path.ends_with(b"/") {
                        1usize
                    } else {
                        0usize
                    });
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

    // Ownership: returns an `OwnedURL` that owns the buffer; callers borrow
    // via `.url()` and Drop frees it.
    pub fn from_string(input: &BunString) -> crate::Result<OwnedURL> {
        let href = whatwg::href_from_string(input);
        if href.tag() == BunStringTag::Dead {
            return Err(crate::Error::InvalidURL);
        }
        Ok(OwnedURL {
            href: href.to_owned_slice().into_boxed_slice(),
        })
    }

    /// `input` is `[scheme://]host[:port][/prefix]`, `https` by default. `None` when it has no host.
    pub fn parse_s3_endpoint(input: &[u8]) -> Option<S3Endpoint> {
        let as_written = URL::parse(input);
        if as_written.host_with_path().is_empty() {
            return None;
        }
        let normalized = if as_written.protocol.is_empty() {
            whatwg::Parsed::from_utf8(&[b"https://".as_slice(), input].concat())
        } else {
            whatwg::Parsed::from_utf8(input)
        };
        let Some(url) = normalized else {
            return Some(S3Endpoint {
                host_with_path: Box::from(as_written.host_with_path()),
                is_http: as_written.is_http(),
            });
        };
        let is_http = url.protocol().eq_ascii(b"http");
        // `whatwg::URL::hostname` is the host with its port.
        let mut host_with_path = url.hostname().to_owned_slice();
        let pathname = url.pathname();
        let path = pathname.to_utf8();
        host_with_path.extend_from_slice(strings::without_suffix_comptime(path.slice(), b"/"));
        Some(S3Endpoint {
            host_with_path: host_with_path.into_boxed_slice(),
            is_http,
        })
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

    // RFC 3986 §3.1: the scheme is case-insensitive. `URL::parse` borrows
    // `protocol` from the input without normalizing, so compare accordingly.
    #[inline]
    pub fn is_https(&self) -> bool {
        strings::eql_case_insensitive_ascii(self.protocol, b"https", true)
    }
    #[inline]
    pub fn is_s3(&self) -> bool {
        strings::eql_case_insensitive_ascii(self.protocol, b"s3", true)
    }
    #[inline]
    pub fn is_http(&self) -> bool {
        strings::eql_case_insensitive_ascii(self.protocol, b"http", true)
    }

    /// The schemes WHATWG calls special: a `\` ends the authority of these, as a `/` does.
    fn has_special_scheme(&self) -> bool {
        strings::eql_any_case_insensitive_ascii(
            self.protocol,
            &[b"http", b"https", b"ws", b"wss", b"ftp", b"file"],
        )
    }

    fn backslash_ends_authority(&self, end: AuthorityEnd) -> bool {
        end == AuthorityEnd::LikeNewURL && self.has_special_scheme()
    }

    /// The one definition of where an authority ends, for the userinfo, the host and the port.
    fn ends_authority(byte: u8, backslash_ends_it: bool) -> bool {
        matches!(byte, b'/' | b'?' | b'#') || (backslash_ends_it && byte == b'\\')
    }

    /// The last `@` of the authority of `after_scheme`, the text after `scheme://`.
    pub fn userinfo_end(&self, after_scheme: &[u8], end: AuthorityEnd) -> Option<usize> {
        let backslash_ends_it = self.backslash_ends_authority(end);
        let mut last_at = None;
        // One pass over the authority, which is short.
        for (i, &byte) in after_scheme.iter().enumerate() {
            if Self::ends_authority(byte, backslash_ends_it) {
                break;
            }
            if byte == b'@' {
                last_at = Some(i);
            }
        }
        last_at
    }

    pub fn display_hostname(&self) -> &[u8] {
        if !self.hostname.is_empty() {
            self.hostname
        } else {
            b"localhost"
        }
    }

    pub fn s3_path(&self) -> &'a [u8] {
        if !self.protocol.is_empty() && self.href.len() > self.protocol.len() + 2 {
            &self.href[self.protocol.len() + 2..]
        } else {
            self.href
        }
    }

    pub(crate) fn display_host(&self) -> bun_fmt::HostFormatter<'_> {
        bun_fmt::HostFormatter {
            host: if !self.host.is_empty() {
                self.host
            } else {
                self.display_hostname()
            },
            port: if !self.port.is_empty() {
                self.get_port()
            } else {
                None
            },
            is_https: self.is_https(),
        }
    }

    /// The URL without its userinfo, ending in exactly one `/`: `http://host/`, `http://host/npm/`.
    pub fn href_without_auth(&self) -> Box<[u8]> {
        let proto = self.display_protocol();
        let path = strings::trim(self.pathname, b"/");

        let mut buf: Vec<u8> =
            Vec::with_capacity(proto.len() + 3 + self.host.len() + 1 + path.len() + 1);
        buf.extend_from_slice(proto);
        buf.extend_from_slice(b"://");
        // bun_core::io::Write on Vec<u8> is infallible.
        let _ = buf.print(format_args!("{}", self.display_host()));
        buf.push(b'/');
        if !path.is_empty() {
            buf.extend_from_slice(path);
            buf.push(b'/');
        }
        buf.into_boxed_slice()
    }

    /// `href` with `user:password@` cut out of its authority.
    pub fn href_without_userinfo(&self) -> std::borrow::Cow<'a, [u8]> {
        use std::borrow::Cow;
        if self.username.is_empty() && self.password.is_empty() {
            return Cow::Borrowed(self.href);
        }
        let Some(authority) = strings::index_of(self.href, b"://").map(|i| i + 3) else {
            return Cow::Borrowed(self.href);
        };
        let rest = &self.href[authority..];
        let Some(at) = self.userinfo_end(rest, self.authority_end) else {
            return Cow::Borrowed(self.href);
        };
        let mut out = Vec::with_capacity(self.href.len() - at - 1);
        out.extend_from_slice(&self.href[..authority]);
        out.extend_from_slice(&rest[at + 1..]);
        Cow::Owned(out)
    }

    pub fn has_http_like_protocol(&self) -> bool {
        self.is_http() || self.is_https()
    }

    pub fn get_port(&self) -> Option<u16> {
        bun_core::fmt::parse_int::<u16>(self.port, 10).ok()
    }

    pub fn get_port_auto(&self) -> u16 {
        self.get_port().unwrap_or_else(|| self.get_default_port())
    }

    pub(crate) fn get_default_port(&self) -> u16 {
        if self.is_https() { 443u16 } else { 80u16 }
    }

    pub fn is_ip_address(&self) -> bool {
        bun_core::ip_address::is_ip_address(self.hostname)
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

    /// Stack scratch for `join_normalize`. Longer joins go to the heap.
    const JOIN_STACK_BUF_LEN: usize = 2048;

    /// Length bound of the unnormalized path `join_normalize` builds.
    fn join_needed(prefix: &[u8], dirname: &[u8], basename: &[u8], extname: &[u8]) -> usize {
        b"/".len() + prefix.len() + dirname.len() + b"/".len() + basename.len() + extname.len()
    }

    pub(crate) fn join_normalize<'b>(
        out: &'b mut [u8],
        prefix: &[u8],
        dirname: &[u8],
        basename: &[u8],
        extname: &[u8],
    ) -> &'b [u8] {
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

        let mut total: usize = 0;
        for part in &path_parts[0..path_end] {
            total += part.len();
        }
        let mut buf_stack = [const { MaybeUninit::<u8>::uninit() }; Self::JOIN_STACK_BUF_LEN];
        let mut buf_heap: Vec<u8> = Vec::new();
        let buf: &mut [MaybeUninit<u8>] = if total <= Self::JOIN_STACK_BUF_LEN {
            &mut buf_stack
        } else {
            buf_heap.reserve_exact(total);
            buf_heap.spare_capacity_mut()
        };
        let mut buf_i: usize = 0;
        for part in &path_parts[0..path_end] {
            buf[buf_i..buf_i + part.len()].write_copy_of_slice(part);
            buf_i += part.len();
        }
        // SAFETY: the loop above wrote every byte of `buf[..buf_i]`.
        let joined = unsafe { buf[..buf_i].assume_init_ref() };
        resolve_path::normalize_string_buf::<false, platform::Loose, false>(joined, out)
    }

    pub fn join_write(
        &self,
        writer: &mut impl bun_core::io::Write,
        prefix: &[u8],
        dirname: &[u8],
        basename: &[u8],
        extname: &[u8],
    ) -> crate::Result<()> {
        let needed = Self::join_needed(prefix, dirname, basename, extname);
        let mut out_pooled: bun_paths::path_buffer_pool::Guard;
        let mut out_heap: Vec<u8>;
        let out: &mut [u8] = if needed <= bun_paths::MAX_PATH_BYTES {
            out_pooled = bun_paths::path_buffer_pool::get();
            &mut out_pooled[..]
        } else {
            out_heap = vec![0u8; needed];
            &mut out_heap
        };
        let normalized_path = Self::join_normalize(out, prefix, dirname, basename, extname);

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
    ) -> crate::Result<Box<[u8]>> {
        let has_uplevels = strings::index_of(dirname, b"../").is_some();

        if has_uplevels {
            let mut v = Vec::with_capacity(self.origin.len() + 5 + absolute_path.len());
            v.extend_from_slice(self.origin);
            v.extend_from_slice(b"/abs:");
            v.extend_from_slice(absolute_path);
            Ok(v.into_boxed_slice())
        } else {
            let needed = Self::join_needed(prefix, dirname, basename, extname);
            let mut v = Vec::with_capacity(self.origin.len() + 1 + needed);
            self.join_write(&mut v, prefix, dirname, basename, extname)?;
            Ok(v.into_boxed_slice())
        }
    }

    /// Reads the authority as `new URL()` reads it. See [`URL::parse_single_reader`] for the other rule.
    pub fn parse(base: &'a [u8]) -> URL<'a> {
        Self::parse_with(base, AuthorityEnd::LikeNewURL)
    }

    /// `parse` for a string this parser alone reads, where a `\` before the `@` is userinfo.
    pub fn parse_single_reader(base: &'a [u8]) -> URL<'a> {
        Self::parse_with(base, AuthorityEnd::SlashQueryOrHash)
    }

    fn parse_with(base: &'a [u8], authority_end: AuthorityEnd) -> URL<'a> {
        if base.is_empty() {
            return URL::default();
        }
        let mut url = URL {
            href: base,
            authority_end,
            ..Default::default()
        };
        let mut offset: u32 = 0;
        match base[0] {
            b'@' => {
                offset += url.parse_password(&base[offset as usize..]).unwrap_or(0);
                offset += url.parse_host(&base[offset as usize..]).unwrap_or(0);
            }
            // Bare bracketed IPv6 host, e.g. the `[::1]:4873/` left of an .npmrc
            // `//[::1]:4873/:_authToken` key once its `//` is stripped.
            b'[' => {
                offset += url.parse_host(base).unwrap_or(0);
            }
            b'/' | b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b':' => {
                let is_protocol_relative = base.starts_with(b"//");
                if is_protocol_relative {
                    offset += 2;
                } else {
                    offset += url.parse_protocol(&base[offset as usize..]).unwrap_or(0);
                }

                let is_relative_path = !is_protocol_relative && base[0] == b'/';

                if !is_relative_path {
                    // Without a protocol it's ambiguous whether a colon is a port or a username,
                    // see https://github.com/oven-sh/bun/issues/1390. With one, the userinfo is
                    // what precedes the last `@` of the authority.
                    if offset > 0 {
                        let rest = &base[offset as usize..];
                        if let Some(at) = url.userinfo_end(rest, authority_end) {
                            let userinfo = &rest[..at];
                            (url.username, url.password) =
                                strings::split_once_char(userinfo, b':').unwrap_or((userinfo, b""));
                            offset += u32::try_from(at + 1).expect("int cast");
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
        if base.len() > offset as usize + 1
            && base[offset as usize] == b'/'
            && !base[offset as usize..].is_empty()
        {
            url.path = &base[offset as usize..];
            url.pathname = url.path;
        }

        // The fragment starts at the first `#`, so a `?` after it is part of
        // the fragment, not the start of the query.
        let before_hash = match strings::index_of_char(&base[offset as usize..], b'#') {
            Some(hash) => &base[offset as usize..][..hash as usize],
            None => &base[offset as usize..],
        };

        if let Some(q) = strings::index_of_char(before_hash, b'?') {
            offset += q;
            url.path = &base[path_offset as usize..][0..q as usize];
            can_update_path = false;
            url.search = &base[offset as usize..];
        }

        if let Some(hash) = strings::index_of_char(&base[offset as usize..], b'#') {
            offset += hash;
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
                    ..((offset as usize + url.search.len()).min(base.len()))
                        .min(hash_offset as usize)];
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

        // Only the right side: a protocol-relative origin keeps its leading `//`.
        url.origin = strings::trim_right(url.origin, b"/ ?#");
        url
    }

    pub(crate) fn parse_protocol(&mut self, str: &'a [u8]) -> Option<u32> {
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
                        // RFC 3986 §3.1: only behind `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )` is there an authority.
                        let is_scheme = self.protocol.first().is_some_and(u8::is_ascii_alphabetic)
                            && self.protocol.iter().all(|byte| {
                                matches!(byte, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'+' | b'-' | b'.')
                            });
                        return is_scheme.then(|| u32::try_from(i + 3).expect("int cast"));
                    }
                }
                _ => {}
            }
        }

        None
    }

    pub(crate) fn parse_password(&mut self, str: &'a [u8]) -> Option<u32> {
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
                    debug_assert!(
                        str[i..].len() < 2
                            || u16::from_le_bytes([str[i], str[i + 1]])
                                != u16::from_le_bytes(*b"//")
                    );
                    return Some(u32::try_from(i + 1).expect("int cast"));
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

    pub(crate) fn parse_host(&mut self, str: &'a [u8]) -> Option<u32> {
        let mut i: u32 = 0;
        let backslash_ends_it = self.backslash_ends_authority(self.authority_end);

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
                ipv6_i = if ipv6_i.is_none() && str[i as usize] == b']' {
                    Some(i)
                } else {
                    ipv6_i
                };
                colon_i = if ipv6_i.is_some() && colon_i.is_none() && str[i as usize] == b':' {
                    Some(i)
                } else {
                    colon_i
                };
                if Self::ends_authority(str[i as usize], backslash_ends_it) {
                    break;
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
                colon_i = if colon_i.is_none() && str[i as usize] == b':' {
                    Some(i)
                } else {
                    colon_i
                };

                if Self::ends_authority(str[i as usize], backslash_ends_it) {
                    break;
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

pub use bun_core::ip_address::strip_ipv6_brackets;

// ══════════════════════════════════════════════════════════════════════════
// QueryStringMap & friends
// ══════════════════════════════════════════════════════════════════════════

/// A name and its value: two ranges of the bytes of a [`QueryStringMap`]. The name is text.
#[derive(Clone, Copy)]
pub struct Param {
    pub(crate) name: api::StringPointer,
    pub(crate) value: api::StringPointer,
    /// The next pair of this name, or 0.
    pub(crate) next: u32,
    /// A pair before this one has this name.
    pub(crate) again: bool,
}

// Vec<Param> (AoS); SoA would be a perf optimization only.
pub(crate) type ParamList = Vec<Param>;

/// The pairs of a route's parameters, then of a query string: decoded, in the order they came. The pairs of one name are linked.
#[derive(Clone)]
pub struct QueryStringMap {
    // Allocator field dropped — global mimalloc per PORTING.md.
    /// The query string, which the caller keeps alive. A part of it that needs no decoding is a range of it.
    query: *const [u8],
    /// Every other range starts past the query string: a route parameter, a decoded part, a name made text.
    pub(crate) buffer: Vec<u8>,
    pub(crate) list: ParamList,
    pub(crate) name_count: usize,
}

impl QueryStringMap {
    /// Each name once, in the order of its first pair, with the values of its pairs in the order of the URL.
    pub fn names(&self) -> Names<'_> {
        Names {
            map: self,
            pairs: self.list.iter(),
            left: self.name_count,
        }
    }

    fn str(&self, range: api::StringPointer) -> &[u8] {
        // SAFETY: the caller keeps the query string alive for the lifetime of `self`.
        let query = unsafe { &*self.query };
        match (range.offset as usize).checked_sub(query.len()) {
            None => range.slice(query),
            Some(start) => &self.buffer[start..][..range.length as usize],
        }
    }

    /// The range of the buffer from `start` to its end.
    fn range_from(&self, start: usize) -> api::StringPointer {
        api::StringPointer {
            offset: u32::try_from(self.query.len() + start).unwrap(),
            length: u32::try_from(self.buffer.len() - start).unwrap(),
        }
    }

    fn append(&mut self, bytes: &[u8]) -> api::StringPointer {
        let start = self.buffer.len();
        self.buffer.extend_from_slice(bytes);
        self.range_from(start)
    }

    /// Appends `name` as text: each part of it that is not UTF-8 is U+FFFD, as in the string that JavaScript reads.
    fn append_text(&mut self, name: &[u8]) -> api::StringPointer {
        let start = self.buffer.len();
        for chunk in name.utf8_chunks() {
            self.buffer.extend_from_slice(chunk.valid().as_bytes());
            if !chunk.invalid().is_empty() {
                self.buffer.extend_from_slice("\u{FFFD}".as_bytes());
            }
        }
        self.range_from(start)
    }

    /// Where `part` of `query` is after decoding: `part` itself, or a range of the buffer. `None`, with the buffer as it was: a `%` of `part` is not an escape.
    fn decoded(
        &mut self,
        query: &[u8],
        part: api::StringPointer,
        needs_decoding: bool,
    ) -> Option<api::StringPointer> {
        if !needs_decoding {
            return Some(part);
        }
        let start = self.buffer.len();
        // Room for every part from this one on that is decoded.
        self.buffer.reserve(query.len() - part.offset as usize);
        if PercentEncoding::decode(&mut self.buffer, part.slice(query)).is_err() {
            self.buffer.truncate(start);
            return None;
        }
        Some(self.range_from(start))
    }

    /// As [`Self::decoded`], for a name: the name is made text. `query_is_text`: every name that needs no decoding is text.
    fn name(
        &mut self,
        query: &[u8],
        query_is_text: bool,
        part: api::StringPointer,
        needs_decoding: bool,
    ) -> Option<api::StringPointer> {
        if !needs_decoding {
            if query_is_text || is_text(part.slice(query)) {
                return Some(part);
            }
            return Some(self.append_text(part.slice(query)));
        }
        let name = self.decoded(query, part, true)?;
        if is_text(self.str(name)) {
            return Some(name);
        }
        let decoded = self
            .buffer
            .split_off(self.buffer.len() - name.length as usize);
        Some(self.append_text(&decoded))
    }

    pub fn init(query_string: &[u8]) -> Result<Option<QueryStringMap>, bun_alloc::AllocError> {
        let no_route_parameters = ParamsList::new();
        Self::init_with_scanner(CombinedScanner::init(
            query_string,
            b"",
            b"",
            &no_route_parameters,
        ))
    }

    pub fn init_with_scanner(
        mut scanner: CombinedScanner<'_>,
    ) -> Result<Option<QueryStringMap>, bun_alloc::AllocError> {
        let query_string = scanner.query.query_string;
        let route_parameters = scanner.pathname.params;
        let mut pairs = core::iter::from_fn(|| scanner.query.next()).peekable();
        if route_parameters.is_empty() && pairs.peek().is_none() {
            return Ok(None);
        }

        let count = (route_parameters.len() + pair_count_at_most(query_string))
            .min(MAX_QUERY_STRING_PARAMS);
        let mut map = QueryStringMap {
            query: std::ptr::from_ref::<[u8]>(query_string),
            buffer: Vec::new(),
            list: ParamList::with_capacity(count),
            name_count: 0,
        };
        let mut last_of_name = LastOfName::new(count);

        if !route_parameters.is_empty() {
            // Room for the route parameters, and for every part of the query string that is decoded.
            let route_bytes = route_parameters
                .iter()
                .map(|parameter| parameter.name.len() + parameter.value.len());
            map.buffer
                .reserve(route_bytes.sum::<usize>() + query_string.len());
        }
        while let Some(result) = scanner.pathname.next() {
            if map.list.len() >= MAX_QUERY_STRING_PARAMS {
                break;
            }
            let name = map.append_text(result.raw_name(scanner.pathname.routename));
            let value = map.append(result.raw_value(scanner.pathname.pathname));
            last_of_name.push(&mut map, name, value, 0);
        }

        let route_parameter_count = map.list.len();
        let query_is_text = is_text(query_string);
        for result in pairs {
            if map.list.len() >= MAX_QUERY_STRING_PARAMS {
                break;
            }
            let decoded_start = map.buffer.len();
            let name = map.name(
                query_string,
                query_is_text,
                result.name,
                result.name_needs_decoding,
            );
            let Some(name) = name else {
                continue;
            };
            let value = map.decoded(query_string, result.value, result.value_needs_decoding);
            // A route parameter hides a query pair of its name: https://nextjs.org/docs/routing/dynamic-routes
            let added = value.is_some_and(|value| {
                last_of_name.push(&mut map, name, value, route_parameter_count)
            });
            if !added {
                map.buffer.truncate(decoded_start);
            }
        }

        Ok(Some(map))
    }
}

// Browsers typically limit URL lengths to around 64k.
/// Hard cap on parsed query-string parameters: it bounds the work and the memory of one map. A pair past it is dropped.
const MAX_QUERY_STRING_PARAMS: usize = 2048;

/// The most pairs that `query_string` can have.
fn pair_count_at_most(query_string: &[u8]) -> usize {
    if query_string.is_empty() {
        return 0;
    }
    strings::count_char(query_string, b'&') + 1
}

/// Whether `bytes` are UTF-8.
fn is_text(bytes: &[u8]) -> bool {
    bytes.is_ascii() || strings::is_valid_utf8(bytes)
}

/// The names of a [`QueryStringMap`].
pub struct Names<'a> {
    map: &'a QueryStringMap,
    pairs: core::slice::Iter<'a, Param>,
    left: usize,
}

impl<'a> Iterator for Names<'a> {
    type Item = (&'a [u8], Values<'a>);

    fn next(&mut self) -> Option<Self::Item> {
        let first = self.pairs.find(|pair| !pair.again)?;
        self.left -= 1;
        let values = Values {
            map: self.map,
            pair: Some(first),
        };
        Some((self.map.str(first.name), values))
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.left, Some(self.left))
    }
}

/// The values of the pairs of one name.
pub struct Values<'a> {
    map: &'a QueryStringMap,
    pair: Option<&'a Param>,
}

impl<'a> Values<'a> {
    /// The value of a name that has one pair.
    pub fn only(&self) -> Option<&'a [u8]> {
        let pair = self.pair.filter(|pair| pair.next == 0)?;
        Some(self.map.str(pair.value))
    }
}

impl<'a> Iterator for Values<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        let pair = self.pair?;
        self.pair = match pair.next {
            0 => None,
            next => self.map.list.get(next as usize),
        };
        Some(self.map.str(pair.value))
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let mut count = 0;
        let mut pair = self.pair;
        while let Some(this) = pair {
            count += 1;
            pair = match this.next {
                0 => None,
                next => self.map.list.get(next as usize),
            };
        }
        (count, Some(count))
    }
}

/// Finds the last pair of a name as the pairs enter the list. A name is text, so the same bytes are the same property key.
struct LastOfName {
    /// `None` for a list of at most `SCAN_LIMIT` pairs: the list itself is searched.
    table: Option<hashbrown::HashTable<u32>>,
    /// New for each map, so that names cannot be made ahead of time to have one hash.
    seed: u64,
}

/// A list that can have at most this many pairs has no table, as in `bun_collections::ArrayHashMap`.
const SCAN_LIMIT: usize = 8;

impl LastOfName {
    fn new(pair_count: usize) -> Self {
        if pair_count <= SCAN_LIMIT {
            return Self {
                table: None,
                seed: 0,
            };
        }
        Self {
            table: Some(hashbrown::HashTable::with_capacity(pair_count)),
            seed: bun_core::fast_random(),
        }
    }

    /// Adds a pair to `map`, after the last pair of its name. `false`, with nothing added: one of the first `hidden` pairs has this name.
    fn push(
        &mut self,
        map: &mut QueryStringMap,
        name: api::StringPointer,
        value: api::StringPointer,
        hidden: usize,
    ) -> bool {
        let index = u32::try_from(map.list.len()).unwrap();
        let bytes = map.str(name);
        let name_of = |pair: &u32| map.str(map.list[*pair as usize].name);
        let last = match &mut self.table {
            None => (0..index).rev().find(|pair| name_of(pair) == bytes),
            Some(table) => {
                let seed = self.seed;
                let hash = |name: &[u8]| bun_wyhash::hash_with_seed(seed, name);
                let entry = table.entry(
                    hash(bytes),
                    |pair| name_of(pair) == bytes,
                    |pair| hash(name_of(pair)),
                );
                match entry {
                    Entry::Occupied(last) if (*last.get() as usize) < hidden => Some(*last.get()),
                    Entry::Occupied(mut last) => Some(core::mem::replace(last.get_mut(), index)),
                    Entry::Vacant(empty) => {
                        empty.insert(index);
                        None
                    }
                }
            }
        };
        if last.is_some_and(|last| (last as usize) < hidden) {
            return false;
        }
        match last {
            Some(last) => map.list[last as usize].next = index,
            None => map.name_count += 1,
        }
        map.list.push(Param {
            name,
            value,
            next: 0,
            again: last.is_some(),
        });
        true
    }
}

// ══════════════════════════════════════════════════════════════════════════
// PercentEncoding
// ══════════════════════════════════════════════════════════════════════════

pub struct PercentEncoding;

#[derive(Debug)]
pub enum DecodeError {
    DecodingError,
    Write(bun_core::Error),
}
impl From<bun_core::Error> for DecodeError {
    fn from(e: bun_core::Error) -> Self {
        DecodeError::Write(e)
    }
}
impl From<DecodeError> for crate::Error {
    fn from(e: DecodeError) -> Self {
        match e {
            DecodeError::DecodingError => crate::Error::DecodingError,
            DecodeError::Write(inner) => crate::Error::Core(inner),
        }
    }
}

impl PercentEncoding {
    pub(crate) fn decode(
        writer: &mut impl bun_core::io::Write,
        input: &[u8],
    ) -> Result<u32, DecodeError> {
        Self::decode_fault_tolerant::<_, false>(writer, input)
    }

    /// Decode percent-encoded input into allocated memory.
    /// Caller owns the returned slice.
    pub fn decode_alloc(input: &[u8]) -> Result<Box<[u8]>, DecodeError> {
        // Allocate enough space - decoded will be at most input.len bytes
        let mut buf: Vec<u8> = Vec::with_capacity(input.len());
        // errdefer allocator.free(buf) — Vec drops automatically on error

        let len = Self::decode(&mut buf, input)?;

        buf.truncate(len as usize);
        Ok(buf.into_boxed_slice())
    }

    /// Decode percent-encoded `input` into the caller-provided `out` buffer.
    /// Returns number of bytes written. `out.len()` must be >= `input.len()`.
    pub fn decode_into(out: &mut [u8], input: &[u8]) -> Result<u32, DecodeError> {
        let mut w = bun_core::fmt::SliceCursor::new(out);
        Self::decode(&mut w, input)
    }

    /// WHATWG percent-decode, which cannot fail: a `%` that no two hex digits follow stays.
    pub fn decode_lenient_alloc(input: &[u8]) -> Box<[u8]> {
        let mut out: Vec<u8> = Vec::with_capacity(input.len());
        let mut rest = input;
        while let Some(percent) = strings::index_of_char_usize(rest, b'%') {
            out.extend_from_slice(&rest[..percent]);
            rest = &rest[percent..];
            if let [b'%', hi, lo, ..] = rest
                && let Some(byte) = bun_fmt::hex_pair_value(*hi, *lo)
            {
                out.push(byte);
                rest = &rest[3..];
            } else {
                out.push(b'%');
                rest = &rest[1..];
            }
        }
        out.extend_from_slice(rest);
        out.into_boxed_slice()
    }

    pub fn decode_fault_tolerant<W: bun_core::io::Write, const FAULT_TOLERANT: bool>(
        writer: &mut W,
        input: &[u8],
    ) -> Result<u32, DecodeError> {
        let mut i: usize = 0;
        let mut written: u32 = 0;
        // unlike JavaScript's decodeURIComponent, we are not handling invalid surrogate pairs
        // we are assuming the input is valid ascii
        while i < input.len() {
            match input[i] {
                b'%' => {
                    if FAULT_TOLERANT {
                        if !(i + 3 <= input.len()
                            && input[i + 1].is_ascii_hexdigit()
                            && input[i + 2].is_ascii_hexdigit())
                        {
                            // i do not feel good about this
                            // create-react-app's public/index.html uses %PUBLIC_URL% in various tags
                            // This is an invalid %-encoded string, intended to be swapped out at build time by webpack-html-plugin
                            // We don't process HTML, so rewriting this URL path won't happen
                            // But we want to be a little more fault tolerant here than just throwing up an error for something that works in other tools
                            // So we just skip over it
                            if i + b"PUBLIC_URL%".len() < input.len()
                                && &input[i + 1..][..b"PUBLIC_URL%".len()] == b"PUBLIC_URL%"
                            {
                                i += b"PUBLIC_URL%".len() + 1;
                                continue;
                            }
                            return Err(DecodeError::DecodingError);
                        }
                    } else {
                        if !(i + 3 <= input.len()
                            && input[i + 1].is_ascii_hexdigit()
                            && input[i + 2].is_ascii_hexdigit())
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
                    written += u32::try_from(i - start).unwrap();
                }
            }
        }

        Ok(written)
    }
}

// FormData intentionally not re-exported here: bun_runtime (T6) is upward of
// this crate. Callers import from bun_runtime::webcore::form_data directly.

// ══════════════════════════════════════════════════════════════════════════
// Scanners
// ══════════════════════════════════════════════════════════════════════════

#[derive(Clone, Copy)]
struct ScannerResult {
    pub(crate) name_needs_decoding: bool,
    pub(crate) value_needs_decoding: bool,
    pub(crate) name: api::StringPointer,
    pub(crate) value: api::StringPointer,
}

impl ScannerResult {
    #[inline]
    fn raw_name<'a>(&self, query_string: &'a [u8]) -> &'a [u8] {
        if self.name.length > 0 {
            &query_string[self.name.offset as usize..][..self.name.length as usize]
        } else {
            b""
        }
    }

    #[inline]
    fn raw_value<'a>(&self, query_string: &'a [u8]) -> &'a [u8] {
        if self.value.length > 0 {
            &query_string[self.value.offset as usize..][..self.value.length as usize]
        } else {
            b""
        }
    }
}

pub struct CombinedScanner<'a> {
    pub(crate) query: Scanner<'a>,
    pub(crate) pathname: PathnameScanner<'a>,
}

impl<'a> CombinedScanner<'a> {
    pub fn init(
        query_string: &'a [u8],
        pathname: &'a [u8],
        routename: &'a [u8],
        url_params: &'a ParamsList<'a>,
    ) -> CombinedScanner<'a> {
        CombinedScanner {
            query: Scanner::init(query_string),
            pathname: PathnameScanner::init(pathname, routename, url_params),
        }
    }
}

fn string_pointer_from_strings(parent: &[u8], in_: &[u8]) -> api::StringPointer {
    if in_.is_empty() || parent.is_empty() {
        return api::StringPointer::default();
    }

    if let Some([offset, length]) = bun_core::range_of_slice_in_buffer(in_, parent) {
        return api::StringPointer { offset, length };
    } else {
        if let Some(i) = strings::index_of(parent, in_) {
            debug_assert!(strings::eql_long(&parent[i..][..in_.len()], in_, false));

            return api::StringPointer {
                offset: u32::try_from(i).unwrap(),
                length: u32::try_from(in_.len()).unwrap(),
            };
        }
    }

    api::StringPointer::default()
}

pub struct PathnameScanner<'a> {
    pub(crate) params: &'a ParamsList<'a>,
    pub(crate) pathname: &'a [u8],
    pub(crate) routename: &'a [u8],
    pub(crate) i: usize,
}

impl<'a> PathnameScanner<'a> {
    #[inline]
    pub(crate) fn is_done(&self) -> bool {
        self.params.len() <= self.i
    }

    pub(crate) fn init(
        pathname: &'a [u8],
        routename: &'a [u8],
        params: &'a ParamsList<'a>,
    ) -> PathnameScanner<'a> {
        PathnameScanner {
            pathname,
            routename,
            params,
            i: 0,
        }
    }

    pub(crate) fn next(&mut self) -> Option<ScannerResult> {
        if self.is_done() {
            return None;
        }

        let param = self.params[self.i];
        self.i += 1;

        Some(ScannerResult {
            // TODO: fix this technical debt
            name: string_pointer_from_strings(self.routename, param.name),
            name_needs_decoding: false,
            // TODO: fix this technical debt
            value: string_pointer_from_strings(self.pathname, param.value),
            value_needs_decoding: false,
        })
    }
}

pub struct Scanner<'a> {
    pub(crate) query_string: &'a [u8],
    pub(crate) i: usize,
}

impl<'a> Scanner<'a> {
    pub(crate) fn init(query_string: &'a [u8]) -> Scanner<'a> {
        if !query_string.is_empty() && query_string[0] == b'?' {
            return Scanner { query_string, i: 1 };
        }

        Scanner { query_string, i: 0 }
    }

    /// Get the next query string parameter without allocating memory.
    pub(crate) fn next(&mut self) -> Option<ScannerResult> {
        let mut relative_i: usize = 0;
        // `relative_i` is added to `this.i` at every return point.

        // reuse stack space
        // otherwise we'd recursively call the function
        'outer: loop {
            if self.i >= self.query_string.len() {
                self.i += relative_i;
                return None;
            }

            let slice = &self.query_string[self.i..];
            relative_i = 0;
            let mut name = api::StringPointer {
                offset: u32::try_from(self.i).unwrap(),
                length: 0,
            };
            let mut value = api::StringPointer {
                offset: 0,
                length: 0,
            };
            let mut name_needs_decoding = false;

            while relative_i < slice.len() {
                let char = slice[relative_i];
                match char {
                    b'=' => {
                        name.length = u32::try_from(relative_i).unwrap();
                        relative_i += 1;

                        value.offset = u32::try_from(relative_i + self.i).unwrap();

                        let offset = relative_i;
                        let mut value_needs_decoding = false;
                        while relative_i < slice.len() && slice[relative_i] != b'&' {
                            value_needs_decoding =
                                value_needs_decoding || matches!(slice[relative_i], b'%' | b'+');
                            relative_i += 1;
                        }
                        value.length = u32::try_from(relative_i - offset).unwrap();
                        self.i += relative_i;
                        // If the name is empty and it's just a value, skip it.
                        // This is kind of an opinion. But, it's hard to see where that might be intentional.
                        if name.length == 0 {
                            continue 'outer;
                        }
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
                            name.length = u32::try_from(relative_i).unwrap();
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

            name.length = u32::try_from(relative_i).unwrap();
            self.i += relative_i;
            return Some(ScannerResult {
                name,
                value,
                name_needs_decoding,
                value_needs_decoding: false,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{CombinedScanner, LastOfName, QueryStringMap, SCAN_LIMIT, URL, route_param};

    const ORIGIN: &[u8] = b"http://localhost:3000";

    fn join(prefix: &[u8], dirname: &[u8], basename: &[u8], extname: &[u8]) -> Vec<u8> {
        let url = URL::parse(b"http://localhost:3000/");
        assert_eq!(url.origin, ORIGIN);
        let mut out = Vec::new();
        url.join_write(&mut out, prefix, dirname, basename, extname)
            .expect("Vec<u8> writes cannot fail");
        let boxed = url
            .join_alloc(prefix, dirname, basename, extname, b"/abs/unused")
            .expect("Vec<u8> writes cannot fail");
        assert_eq!(&*boxed, &*out, "join_alloc and join_write must agree");
        out
    }

    #[test]
    fn fragment_is_not_part_of_the_path_or_query() {
        let url = URL::parse(b"http://localhost:3000/path#frag?x=1");
        assert_eq!(url.pathname, b"/path");
        assert_eq!(url.path, b"/path");
        assert_eq!(url.search, b"");
        assert_eq!(url.hash, b"#frag?x=1");

        let url = URL::parse(b"http://localhost:3000/cb#access_token=abc&scope=x?y");
        assert_eq!(url.pathname, b"/cb");
        assert_eq!(url.hash, b"#access_token=abc&scope=x?y");

        let url = URL::parse(b"http://localhost:3000/#?");
        assert_eq!(url.pathname, b"/");
        assert_eq!(url.hash, b"#?");

        let url = URL::parse(b"http://localhost:3000/path?q=1#frag?x=2");
        assert_eq!(url.pathname, b"/path?q=1");
        assert_eq!(url.path, b"/path");
        assert_eq!(url.search, b"?q=1");
        assert_eq!(url.hash, b"#frag?x=2");
    }

    #[test]
    fn the_authority_ends_where_new_url_ends_it() {
        let url = URL::parse(br"http://u:p@first.example:8080\x@second.example/path");
        assert_eq!((url.username, url.password), (&b"u"[..], &b"p"[..]));
        assert_eq!(
            (url.hostname, url.port),
            (&b"first.example"[..], &b"8080"[..])
        );

        let url = URL::parse(b"HTTPS://u:p@first.example:8443#@second.example/");
        assert_eq!((url.username, url.password), (&b"u"[..], &b"p"[..]));
        assert_eq!(
            (url.hostname, url.port),
            (&b"first.example"[..], &b"8443"[..])
        );

        // In a scheme that is not special, a `\` is part of the userinfo, as for `new URL()`.
        let url = URL::parse(br"socks5://u:p@first.example\x@second.example/");
        assert_eq!(
            (url.username, url.password),
            (&b"u"[..], &br"p@first.example\x"[..])
        );
        assert_eq!(url.hostname, b"second.example");
    }

    #[test]
    fn a_proxy_keeps_a_domain_login() {
        let proxy = URL::parse_single_reader(br"http://DOMAIN\user:pass@proxy.example:8080");
        assert_eq!(
            (proxy.username, proxy.password),
            (&br"DOMAIN\user"[..], &b"pass"[..])
        );
        assert_eq!(
            (proxy.hostname, proxy.port),
            (&b"proxy.example"[..], &b"8080"[..])
        );
        assert_eq!(
            &*proxy.href_without_userinfo(),
            b"http://proxy.example:8080"
        );
    }

    #[test]
    fn no_host_is_read_behind_a_second_scheme() {
        let url = URL::parse(b"http:first.example://second.example/");
        assert_eq!(url.protocol, b"http:first.example");
        assert_eq!(url.hostname, b"http");

        let url = URL::parse(b"blob:http://second.example/id");
        assert_eq!(url.protocol, b"blob:http");
        assert_eq!(url.hostname, b"blob");

        let url = URL::parse(b"1http://second.example/");
        assert_eq!(url.protocol, b"1http");
        assert_eq!(url.hostname, b"1http");

        let url = URL::parse(b"localhost:3000/api");
        assert_eq!(url.protocol, b"");
        assert_eq!((url.hostname, url.port), (&b"localhost"[..], &b"3000"[..]));
    }

    #[test]
    fn join_normalizes_the_path() {
        assert_eq!(
            join(b"_next/", b"/pages//", b"index", b".js"),
            b"http://localhost:3000/_next/pages/index.js"
        );
        assert_eq!(
            join(b"", b"a/./b/..", b"d", b""),
            b"http://localhost:3000/a/d"
        );
        assert_eq!(join(b"", b"", b"", b""), b"http://localhost:3000/");
    }

    #[test]
    fn join_alloc_uplevel_dirname_uses_the_absolute_path() {
        let url = URL::parse(b"http://localhost:3000/");
        let boxed = url
            .join_alloc(b"", b"../pages", b"index", b".js", b"/srv/pages/index.js")
            .expect("Vec<u8> writes cannot fail");
        assert_eq!(&*boxed, b"http://localhost:3000/abs:/srv/pages/index.js");
    }

    #[test]
    fn join_at_the_stack_buffer_limit() {
        // `/` plus the basename fills the scratch buffer exactly.
        let basename = vec![b'a'; URL::JOIN_STACK_BUF_LEN - 1];
        let mut expected = ORIGIN.to_vec();
        expected.push(b'/');
        expected.extend_from_slice(&basename);
        assert_eq!(join(b"", b"", &basename, b""), expected);
    }

    #[test]
    fn join_longer_than_every_stack_buffer() {
        let len = URL::JOIN_STACK_BUF_LEN.max(bun_paths::MAX_PATH_BYTES) + 1;
        let basename = vec![b'a'; len];
        let mut expected = ORIGIN.to_vec();
        expected.extend_from_slice(b"/dir/");
        expected.extend_from_slice(&basename);
        expected.extend_from_slice(b".js");
        assert_eq!(join(b"", b"dir", &basename, b".js"), expected);
    }

    type NamesAndValues<'a> = Vec<(&'a [u8], Vec<&'a [u8]>)>;

    fn names_and_values(map: &QueryStringMap) -> NamesAndValues<'_> {
        let names = map.names();
        assert_eq!(names.size_hint(), (map.name_count, Some(map.name_count)));
        names
            .map(|(name, values)| {
                let (count, _) = values.size_hint();
                let only = values.only();
                let values: Vec<&[u8]> = values.collect();
                assert_eq!(values.len(), count);
                assert_eq!(only, (count == 1).then(|| values[0]));
                (name, values)
            })
            .collect()
    }

    /// More pairs than `SCAN_LIMIT`, so that a map of `query` and these has a table.
    const MORE_PAIRS: &[u8] = b"&z0&z1&z2&z3&z4&z5&z6&z7&z8";

    fn without_more_pairs<'a>(mut pairs: NamesAndValues<'a>) -> NamesAndValues<'a> {
        let more = pairs.split_off(pairs.len() - 9);
        let names: Vec<&[u8]> = more.iter().map(|(name, _)| *name).collect();
        assert_eq!(names.concat(), b"z0z1z2z3z4z5z6z7z8");
        pairs
    }

    /// Checks the map of `query`, without a table and with one.
    fn expect_query(query: &[u8], expected: NamesAndValues<'_>) {
        let map = QueryStringMap::init(query).unwrap().unwrap();
        assert_eq!(names_and_values(&map), expected, "{}", query.escape_ascii());
        let query = [query, MORE_PAIRS].concat();
        let map = QueryStringMap::init(&query).unwrap().unwrap();
        assert_eq!(without_more_pairs(names_and_values(&map)), expected);
    }

    /// Checks the map of `query` on a route that has the parameter `name` and that matched the path `7`.
    fn expect_route_query(name: &[u8], query: &[u8], expected: NamesAndValues<'_>) {
        let route = [b"[", name, b"]"].concat();
        let pathname = b"7";
        let params: route_param::List = vec![route_param::Param {
            name: &route[1..route.len() - 1],
            value: pathname,
        }];
        let init = |query| {
            QueryStringMap::init_with_scanner(CombinedScanner::init(
                query, pathname, &route, &params,
            ))
            .unwrap()
            .unwrap()
        };
        assert_eq!(
            names_and_values(&init(query)),
            expected,
            "{}",
            query.escape_ascii()
        );
        let query = [query, MORE_PAIRS].concat();
        assert_eq!(
            without_more_pairs(names_and_values(&init(&query))),
            expected
        );
    }

    #[test]
    fn a_name_comes_once_with_its_values_in_the_order_of_the_query() {
        // Only a part with a "+" or an escape is decoded into the buffer.
        for (query, value_of_b) in [
            (&b"a=1&b=2&a=3&c&a=4"[..], &b"2"[..]),
            (b"a=1&%62=x+y&a=3&c&a=4", b"x+y"),
        ] {
            expect_query(
                query,
                vec![
                    (b"a", vec![b"1", b"3", b"4"]),
                    (b"b", vec![value_of_b]),
                    (b"c", vec![b""]),
                ],
            );
        }
        assert!(QueryStringMap::init(b"?&&=1").unwrap().is_none());
    }

    #[test]
    fn a_name_has_every_one_of_its_values() {
        let query = vec![&b"tag=v"[..]; 257].join(&b'&');
        let map = QueryStringMap::init(&query).unwrap().unwrap();
        assert_eq!(
            names_and_values(&map),
            [(&b"tag"[..], vec![&b"v"[..]; 257])]
        );
    }

    const SAME_WYHASH: [&[u8]; 2] = [
        b"rs5rgaaaprefixedaaaaaaaa38zu8ai7yyyyyyyy",
        b"rs5rgaaaprefixedbbbbbbbb38zu8ai7yyyyyyyy",
    ];

    #[test]
    fn two_names_that_have_one_wyhash_are_two_names() {
        let [first, second] = SAME_WYHASH;
        assert_eq!(bun_wyhash::hash(first), bun_wyhash::hash(second));
        let query = [first, b"=1&", second, b"=2&", first, b"=3"].concat();
        expect_query(
            &query,
            vec![(first, vec![b"1", b"3"]), (second, vec![b"2"])],
        );
    }

    #[test]
    fn names_that_have_one_wyhash_have_two_hashes_in_a_table() {
        let [first, second] = SAME_WYHASH;
        let seed = LastOfName::new(SCAN_LIMIT + 1).seed;
        assert_ne!(
            bun_wyhash::hash_with_seed(seed, first),
            bun_wyhash::hash_with_seed(seed, second)
        );
    }

    #[test]
    fn a_name_that_is_not_utf8_is_the_text_that_javascript_reads() {
        let key = "\u{FFFD}".as_bytes();
        // The router decodes the URL before the map decodes each name, so a name comes with or without an escape.
        for query in [
            &b"\xFF=1&\xFE=2&a\xFFb=3&\xE2\x82=4&\xEF\xBF\xBD=5&\xC3\xA9=6&\xFF\xFF=7"[..],
            b"%FF=1&%FE=2&a%FFb=3&%E2%82=4&%EF%BF%BD=5&%C3%A9=6&%FF%FF=7",
            b"\xFF=1&%FE=2&a\xFFb=3&%E2%82=4&\xEF\xBF\xBD=5&%C3%A9=6&\xFF%FF=7",
        ] {
            expect_query(
                query,
                vec![
                    (key, vec![b"1", b"2", b"4", b"5"]),
                    ("a\u{FFFD}b".as_bytes(), vec![b"3"]),
                    ("\u{e9}".as_bytes(), vec![b"6"]),
                    ("\u{FFFD}\u{FFFD}".as_bytes(), vec![b"7"]),
                ],
            );
        }
    }

    #[test]
    fn a_value_that_is_not_utf8_is_a_range_of_the_query() {
        let query = b"a=\xFF&b=\xC3\xA9&a=\xFE";
        let map = QueryStringMap::init(query).unwrap().unwrap();
        assert!(map.buffer.is_empty());
        expect_query(
            query,
            vec![(b"a", vec![b"\xFF", b"\xFE"]), (b"b", vec![b"\xC3\xA9"])],
        );
        // A value with an escape is decoded, and stays the bytes that came.
        expect_query(b"a=%FF&a=\xFE", vec![(b"a", vec![b"\xFF", b"\xFE"])]);
    }

    #[test]
    fn a_pair_with_an_escape_that_is_not_one_is_dropped() {
        expect_query(
            b"a=1&b%zz=2&c=%zz&d=4+&a=5",
            vec![(b"a", vec![b"1", b"5"]), (b"d", vec![b"4+"])],
        );
    }

    #[test]
    fn a_route_parameter_comes_first_and_hides_a_query_pair_of_its_name() {
        expect_route_query(
            b"id",
            b"a=1&id=8&%69d=9&b=2&a=3",
            vec![
                (b"id", vec![b"7"]),
                (b"a", vec![b"1", b"3"]),
                (b"b", vec![b"2"]),
            ],
        );
        // A name that is not UTF-8 hides the names that JavaScript reads as the same text.
        expect_route_query(
            b"\xFF",
            b"x=1&%FE=q&\xFF=r&%EF%BF%BD=s&x=2",
            vec![
                ("\u{FFFD}".as_bytes(), vec![b"7"]),
                (b"x", vec![b"1", b"2"]),
            ],
        );
    }
}
