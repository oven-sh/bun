// This is close to WHATWG URL, but we don't want the validation errors
#![allow(unused, non_snake_case, clippy::all)]
#![warn(unused_must_use)]
#![warn(unreachable_pub)]
use core::cell::RefCell;

use bun_collections::bit_set::{ArrayBitSet, num_masks_for};
use bun_core::{self, fmt as bun_fmt};
use bun_core::{String as BunString, Tag as BunStringTag, immutable as strings};
use bun_paths::resolve_path::{self, platform};
use bun_wyhash::hash as wyhash;

// `bun.schema.api.StringPointer` — canonical definition lives in `bun_core`
// (T0, already a dep). Re-exported under `api::` so `QueryStringMap` /
// `CombinedScanner` field types keep resolving.
pub mod api {
    pub use bun_core::StringPointer;
}

use bun_core::io::Write as _;

// ── route_param (moved from bun_router) ───────────────────────────────────
pub mod route_param {
    // PORT NOTE: name/value borrow from the route template + the live request
    // path; lifetime-generic so `bun_router` (the only producer) can fill them
    // from non-'static buffers. Downstream that only stores literals can use
    // `Param<'static>`.
    #[derive(Clone, Copy)]
    pub struct Param<'a> {
        pub name: &'a [u8],
        pub value: &'a [u8],
    }
    // TODO(b2-blocked): bun_collections::MultiArrayList — derive(MultiArrayElement)
    // proc-macro not yet available. Using Vec; SoA layout is a perf concern only.
    pub type List<'a> = Vec<Param<'a>>;
}
pub use route_param::List as ParamsList;

// ── whatwg (WTF::URL FFI shim, MOVE_DOWN from bun_jsc) ────────────────────
// Ground truth: src/jsc/URL.zig. The JS-value entry points (`hrefFromJS`, `fromJS`)
// stay in tier-6 `bun_jsc` as extension methods — they need JSValue/JSGlobalObject.
// Everything else is a thin extern-"C" wrapper around WTF::URL and is JSC-agnostic.
pub mod whatwg {
    use super::BunString as String;
    use super::strings;

    /// Opaque handle to a heap-allocated WTF::URL (C++). Always behind `*mut URL`.
    /// Construct via `from_string`/`from_utf8`; free via `deinit`.
    #[repr(C)]
    pub struct URL {
        _opaque: [u8; 0],
    }

    // TODO(port): move to <area>_sys
    // PORT NOTE: getters take `*const URL` — the C++ side (BunString.cpp) never mutates the
    // WTF::URL on read. `URL__deinit` keeps `*mut` (it `delete`s). `BunString*` inputs stay
    // `*mut` to match the C ABI; callers pass a mutable local copy (see below).
    // SAFETY (safe fn): `URL` is an opaque ZST handle (never null when behind `&`);
    // `String` is a `#[repr(C)]` Copy POD that C++ reads (`BunString::toWTFString() const`).
    // Getters take `&URL` (C++ never mutates on read); `deinit` takes `&mut URL` (consumes).
    // `URL__originLength` keeps a raw `(*const u8, usize)` slice pair → stays `unsafe fn`.
    unsafe extern "C" {
        // `URL__fromJS` / `URL__getHrefFromJS` intentionally omitted — tier-6 (bun_jsc).
        safe fn URL__fromString(str: &mut String) -> Option<core::ptr::NonNull<URL>>;
        safe fn URL__protocol(url: &URL) -> String;
        safe fn URL__href(url: &URL) -> String;
        safe fn URL__username(url: &URL) -> String;
        safe fn URL__password(url: &URL) -> String;
        safe fn URL__search(url: &URL) -> String;
        safe fn URL__host(url: &URL) -> String;
        safe fn URL__hostname(url: &URL) -> String;
        safe fn URL__port(url: &URL) -> u32;
        safe fn URL__deinit(url: &mut URL);
        safe fn URL__pathname(url: &URL) -> String;
        safe fn URL__getHref(input: &mut String) -> String;
        safe fn URL__getFileURLString(input: &mut String) -> String;
        safe fn URL__getHrefJoin(base: &mut String, relative: &mut String) -> String;
        safe fn URL__pathFromFileURL(input: &mut String) -> String;
        safe fn URL__hash(url: &URL) -> String;
        safe fn URL__fragmentIdentifier(url: &URL) -> String;
        fn URL__originLength(latin1_slice: *const u8, len: usize) -> u32;
    }

    // PORT NOTE: Zig takes `bun.String` by value then `var input = str; f(&input)` to
    // obtain a mutable address for C ABI. We take `&String` (matching existing call sites
    // in this crate) and — since `bun_core::String: Copy` — bit-copy into a mutable
    // local and pass `&mut local`. This mirrors the Zig spec exactly and avoids casting
    // a shared-ref-derived pointer to `*mut` (read-only provenance). The C++ side
    // (`BunString::toWTFString() const`) does not mutate, but the local-copy form is
    // sound regardless.

    /// Percent-encodes the URL, punycode-encodes the hostname, and returns the normalized
    /// href. If parsing fails, the returned String's tag is `Dead`.
    pub fn href_from_string(str: &String) -> String {
        let mut input = *str;
        URL__getHref(&mut input)
    }
    pub fn join(base: &String, relative: &String) -> String {
        let mut base_str = *base;
        let mut relative_str = *relative;
        URL__getHrefJoin(&mut base_str, &mut relative_str)
    }
    pub fn file_url_from_string(str: &String) -> String {
        let mut input = *str;
        URL__getFileURLString(&mut input)
    }
    pub fn path_from_file_url(str: &String) -> String {
        let mut input = *str;
        URL__pathFromFileURL(&mut input)
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
        if len == 0 {
            return None;
        }
        Some(&slice[..len as usize])
    }

    impl URL {
        pub fn from_string(str: &String) -> Option<core::ptr::NonNull<URL>> {
            let mut input = *str;
            URL__fromString(&mut input)
        }
        pub fn from_utf8(input: &[u8]) -> Option<core::ptr::NonNull<URL>> {
            Self::from_string(&String::borrow_utf8(input))
        }
        /// Includes the leading '#'.
        pub fn hash(&self) -> String {
            URL__hash(self)
        }
        /// Exactly the same as `hash`, excluding the leading '#'.
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
        /// Returns `u32::MAX` if the port is not set. Otherwise, the result is
        /// guaranteed to be within the `u16` range.
        pub fn port(&self) -> u32 {
            URL__port(self)
        }
        pub fn pathname(&self) -> String {
            URL__pathname(self)
        }
        pub fn deinit(&mut self) {
            URL__deinit(self)
        }
    }
}
// Re-export the free helpers at crate root so lower-tier callers can write
// `bun_url::join(...)` / `bun_url::href_from_string(...)` (install, http, bake, js_parser).
pub use whatwg::{
    file_url_from_string, href_from_string, join, origin_from_slice, path_from_file_url,
};

// PORT NOTE: URL is a pure view struct — every field is a slice into `href` (or a
// literal default). Zig expresses this with `[]const u8` fields borrowing the
// caller-provided `base`.
#[derive(Clone)]
pub struct URL<'a> {
    pub hash: &'a [u8],
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

/// An owning URL — holds the normalized `href` buffer that the borrowed
/// `URL<'_>` view slices into. Port of `URL.fromString`'s ownership model:
/// Zig returned a `URL` borrowing from a fresh allocation the caller had to
/// `allocator.free(url.href)`; in Rust, `OwnedURL` owns that buffer and
/// `Drop` frees it.
#[derive(Default, Clone)]
pub struct OwnedURL {
    href: Box<[u8]>,
}

impl OwnedURL {
    /// Borrow as a parsed `URL` view. All slices in the returned `URL` borrow
    /// `self.href`.
    // PERF(port): re-parses on each call. Zig parsed once into a borrowing
    // struct the caller held alongside the buffer; Rust cannot express that
    // self-reference without unsafe lifetime extension (PORTING.md §Forbidden).
    // Callers in practice call this once and hold the borrow — profile in
    // Phase B; if hot, store component `(u32, u32)` offsets here instead.
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
    /// producers (e.g. `bun_url_jsc::url_from_js`) can build an `OwnedURL`
    /// without the `href` field being public.
    #[inline]
    pub fn from_href(href: Box<[u8]>) -> Self {
        Self { href }
    }
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
        }
    }

    pub fn is_file(&self) -> bool {
        self.protocol == b"file"
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

    // PORT NOTE: `fromJS` alias to url_jsc deleted per PORTING.md — JSC interop lives
    // in bun_url_jsc as an extension trait.

    // PORT NOTE: ownership — Zig returns a `URL` borrowing from a freshly-allocated
    // owned slice (`href.toOwnedSlice`); caller frees `url.href` later. Per
    // PORTING.md §Forbidden (no Box::leak / mem::forget / unsafe lifetime
    // extension), Rust returns an `OwnedURL` that owns the buffer; callers borrow
    // via `.url()` and Drop frees it.
    pub fn from_string(input: &BunString) -> Result<OwnedURL, bun_core::Error> {
        let href = whatwg::href_from_string(input);
        if href.tag() == BunStringTag::Dead {
            return Err(bun_core::err!("InvalidURL"));
        }
        // Zig: `defer href.deref()` — `to_owned_slice` is infallible so explicit
        // ordering suffices (no error path between alloc and deref).
        let owned = href.to_owned_slice().into_boxed_slice();
        href.deref();
        Ok(OwnedURL { href: owned })
    }

    pub fn from_utf8(input: &[u8]) -> Result<OwnedURL, bun_core::Error> {
        Self::from_string(&BunString::borrow_utf8(input))
    }

    pub fn is_localhost(&self) -> bool {
        self.hostname.is_empty() || self.hostname == b"localhost" || self.hostname == b"0.0.0.0"
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
            self.hostname
        } else {
            b"localhost"
        }
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

    /// Zig: `std.fmt.allocPrint(alloc, "{s}://{f}/{s}/", .{
    ///     url.displayProtocol(), url.displayHost(),
    ///     std.mem.trim(u8, url.pathname, "/") })`.
    ///
    /// `display_host()` yields a `bun_core::fmt::HostFormatter` (impls
    /// `Display`); the other two pieces are raw byte slices, so we assemble
    /// into a `Vec<u8>` directly rather than going through `format!` and
    /// risking lossy UTF-8 round-trips.
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
        buf.extend_from_slice(path);
        buf.push(b'/');
        buf.into_boxed_slice()
    }

    pub fn has_http_like_protocol(&self) -> bool {
        self.protocol == b"http" || self.protocol == b"https"
    }

    pub fn get_port(&self) -> Option<u16> {
        bun_core::fmt::parse_int::<u16>(self.port, 10).ok()
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
        // Zig: resolve_path.normalizeStringBuf(buf[0..buf_i], out, false, .loose, false)
        resolve_path::normalize_string_buf::<false, platform::Loose, false>(&buf[0..buf_i], out)
    }

    pub fn join_write(
        &self,
        writer: &mut impl bun_core::io::Write,
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
            let normalized_path =
                Self::join_normalize(&mut out, prefix, dirname, basename, extname);
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
                        let first_at =
                            strings::index_of_char(&base[offset as usize..], b'@').unwrap_or(0);
                        let first_colon =
                            strings::index_of_char(&base[offset as usize..], b':').unwrap_or(0);

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
        if base.len() > offset as usize + 1
            && base[offset as usize] == b'/'
            && !base[offset as usize..].is_empty()
        {
            url.path = &base[offset as usize..];
            url.pathname = url.path;
        }

        if let Some(q) = strings::index_of_char(&base[offset as usize..], b'?') {
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
                        return Some(u32::try_from(i + 3).expect("int cast"));
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
                    return Some(u32::try_from(i + 1).expect("int cast"));
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
                colon_i = if colon_i.is_none() && str[i as usize] == b':' {
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

// ══════════════════════════════════════════════════════════════════════════
// QueryStringMap & friends
// ══════════════════════════════════════════════════════════════════════════

#[derive(Clone, Copy)]
pub struct Param {
    pub name: api::StringPointer,
    pub name_hash: u64,
    pub value: api::StringPointer,
}

// PERF(port): Zig uses `std.MultiArrayList(Param)` for SoA cache-friendly column
// scans. bun_collections::MultiArrayList exists but requires `MultiArrayElement`
// (no derive macro yet). Using Vec<Param> (AoS) for now — semantically identical;
// revisit once `` lands.
// TODO(b2-blocked): bun_collections::MultiArrayList derive
pub type ParamList = Vec<Param>;

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

impl Clone for QueryStringMap {
    fn clone(&self) -> Self {
        let buffer = self.buffer.clone();
        // Re-derive `slice` so the clone doesn't dangle into the original buffer.
        // If the original `slice` did NOT point into our own buffer (the
        // nothing-needs-decoding fast path borrows the caller's query_string),
        // keep it as-is — both clones borrow the same external slice.
        let slice = if !self.buffer.is_empty()
            && bun_alloc::is_slice_in_buffer(unsafe { &*self.slice }, &self.buffer)
        {
            let len = unsafe { &*self.slice }.len();
            &raw const buffer[..len]
        } else {
            self.slice
        };
        Self {
            slice,
            buffer,
            list: self.list.clone(),
            name_count: self.name_count,
        }
    }
}

thread_local! {
    // PORT NOTE: unused in current code (commented-out path in get_name_count)
    static NAME_COUNT_BUF: RefCell<[*const [u8]; 8]> = const { RefCell::new([std::ptr::from_ref::<[u8]>(&[]); 8]) };
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
        self.list.iter().position(|p| p.name_hash == hash)
    }

    pub fn get(&self, input: &[u8]) -> Option<&[u8]> {
        let hash = wyhash(input);
        let i = self.list.iter().position(|p| p.name_hash == hash)?;
        Some(self.str(self.list[i].value))
    }

    pub fn has(&self, input: &[u8]) -> bool {
        self.get_index(input).is_some()
    }

    pub fn get_all<'s>(&'s self, input: &[u8], target: &mut [&'s [u8]]) -> usize {
        let hash = wyhash(input);
        // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
        self.get_all_with_hash_from_offset(target, hash, 0)
    }

    pub fn get_all_with_hash_from_offset<'s>(
        &'s self,
        target: &mut [&'s [u8]],
        hash: u64,
        offset: usize,
    ) -> usize {
        let mut remainder = &self.list[offset..];
        let mut target_i: usize = 0;
        while !remainder.is_empty() && target_i < target.len() {
            let Some(i) = remainder.iter().position(|p| p.name_hash == hash) else {
                break;
            };
            target[target_i] = self.str(remainder[i].value);
            remainder = &remainder[i + 1..];
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

            name.length = u32::try_from(name_slice.len()).unwrap();
            name.offset = buf_writer_pos;
            buf.extend_from_slice(name_slice);
            buf_writer_pos += u32::try_from(name_slice.len()).unwrap();

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
            list.push(Param {
                name,
                value,
                name_hash,
            });
        }

        let route_parameter_begin = list.len();

        while let Some(result) = scanner.query.next() {
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
                if let Some(index) = list.iter().position(|p| p.name_hash == name_hash) {
                    // query string parameters should not override route parameters
                    // see https://nextjs.org/docs/routing/dynamic-routes
                    if index < route_parameter_begin {
                        continue;
                    }

                    name = list[index].name;
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
            list.push(Param {
                name,
                value,
                name_hash,
            });
        }

        // buf.expandToCapacity() — Vec doesn't expose this; not needed since we slice by buf_writer_pos
        let _ = nothing_needs_decoding;
        let slice_ptr: *const [u8] = &raw const buf[0..buf_writer_pos as usize];
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
                list.push(Param {
                    name,
                    value,
                    name_hash,
                });
            }

            return Ok(Some(QueryStringMap {
                list,
                buffer: Vec::new(),
                // TODO(port): borrows external query_string; lifetime not tracked in Phase A
                slice: std::ptr::from_ref::<[u8]>(query_string),
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
                if let Some(index) = list.iter().position(|p| p.name_hash == name_hash) {
                    name = list[index].name;
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
            list.push(Param {
                name,
                value,
                name_hash,
            });
        }

        let slice_ptr: *const [u8] = &raw const buf[0..buf_writer_pos as usize];
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
// PORT NOTE: Zig `StaticBitSet(2048)` resolves to `ArrayBitSet(usize, 2048)`.
// bun_collections::StaticBitSet currently aliases IntegerBitSet (≤64 bits), so
// pick ArrayBitSet directly. 2048 / 64 == 32 masks.
type VisitedMap = ArrayBitSet<2048, { num_masks_for(2048) }>;

pub struct Iterator<'a> {
    pub i: usize,
    pub map: &'a QueryStringMap,
    pub visited: VisitedMap,
}

pub struct IteratorResult<'a, 't> {
    pub name: &'a [u8],
    pub values: &'t mut [&'a [u8]],
}

impl<'a> Iterator<'a> {
    pub fn init(map: &'a QueryStringMap) -> Iterator<'a> {
        Iterator {
            i: 0,
            map,
            visited: VisitedMap::init_empty(),
        }
    }

    // TODO(port): lifetime on `target`/return — values borrow target, name borrows map.slice
    pub fn next<'t>(&mut self, target: &'t mut [&'a [u8]]) -> Option<IteratorResult<'a, 't>>
    where
        'a: 't,
    {
        while self.visited.is_set(self.i) {
            self.i += 1;
        }
        if self.i >= self.map.list.len() {
            return None;
        }

        let list = &self.map.list;
        let hash = list[self.i].name_hash;
        let name_slice = list[self.i].name;
        debug_assert!(name_slice.length > 0);
        let name = self.map.str(name_slice);
        target[0] = self.map.str(list[self.i].value);

        self.visited.set(self.i);
        self.i += 1;

        let remainder = &list[self.i..];

        let mut target_i: usize = 1;
        let mut current_i: usize = 0;

        while let Some(next_index) = remainder[current_i..]
            .iter()
            .position(|p| p.name_hash == hash)
        {
            let real_i = current_i + next_index + self.i;
            if cfg!(debug_assertions) {
                debug_assert!(!self.visited.is_set(real_i));
            }

            self.visited.set(real_i);
            target[target_i] = self.map.str(remainder[current_i + next_index].value);
            target_i += 1;

            current_i += next_index + 1;
            if target_i >= target.len() {
                return Some(IteratorResult {
                    name,
                    values: &mut target[0..target_i],
                });
            }
            if real_i + 1 >= self.map.list.len() {
                return Some(IteratorResult {
                    name,
                    values: &mut target[0..target_i],
                });
            }
        }

        Some(IteratorResult {
            name,
            values: &mut target[0..target_i],
        })
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
impl From<DecodeError> for bun_core::Error {
    fn from(e: DecodeError) -> Self {
        match e {
            DecodeError::DecodingError => bun_core::err!("DecodingError"),
            DecodeError::Write(inner) => inner,
        }
    }
}

impl PercentEncoding {
    pub fn decode(writer: &mut impl bun_core::io::Write, input: &[u8]) -> Result<u32, DecodeError> {
        // PERF(port): was @call(bun.callmod_inline, ...) — profile in Phase B
        Self::decode_fault_tolerant::<_, false>(writer, input, None)
    }

    /// Decode percent-encoded input into allocated memory.
    /// Caller owns the returned slice.
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

    /// Decode percent-encoded `input` into the caller-provided `out` buffer.
    /// Returns number of bytes written. `out.len()` must be >= `input.len()`.
    pub fn decode_into(out: &mut [u8], input: &[u8]) -> Result<u32, DecodeError> {
        let mut w = bun_core::fmt::SliceCursor::new(out);
        Self::decode(&mut w, input)
    }

    pub fn decode_fault_tolerant<W: bun_core::io::Write, const FAULT_TOLERANT: bool>(
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
                            && input[i + 1].is_ascii_hexdigit()
                            && input[i + 2].is_ascii_hexdigit())
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

// TODO(b0): FormData re-export removed — bun_runtime (T6) is upward.
// Callers should import from bun_runtime::webcore::form_data
// directly (or move-in pass relocates FormData here if it belongs at T2).
// pub use bun_runtime::webcore::form_data::FormData;

// ══════════════════════════════════════════════════════════════════════════
// Scanners
// ══════════════════════════════════════════════════════════════════════════

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

pub struct CombinedScanner<'a> {
    pub query: Scanner<'a>,
    pub pathname: PathnameScanner<'a>,
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
    pub params: &'a ParamsList<'a>,
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

    pub fn init(
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

    pub fn next(&mut self) -> Option<ScannerResult> {
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
            return Scanner {
                query_string,
                i: 1,
                start: 1,
            };
        }

        Scanner {
            query_string,
            i: 0,
            start: 0,
        }
    }

    #[inline]
    pub fn reset(&mut self) {
        self.i = self.start;
    }

    /// Get the next query string parameter without allocating memory.
    pub fn next(&mut self) -> Option<ScannerResult> {
        let mut relative_i: usize = 0;
        // PORT NOTE: Zig used `defer this.i += relative_i;` — emulated by applying
        // the deferred add at every return point.

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

// ported from: src/url/url.zig
