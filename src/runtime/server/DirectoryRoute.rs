//! Serve a directory tree at a URL prefix: `"/static/*": { dir: "./public" }`.
//!
//! Path resolution: percent-decode the request path once, reject NUL and `\`,
//! lexically collapse `.`/`..` (capped at the root), then on Linux open with
//! `openat2(RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS)` so symlinks cannot
//! escape the root. Other platforms fall back to `openat(dirfd, rel)` and the
//! lexical clean is the only containment. Once opened the file is served via
//! `FileResponseStream` (same path as `FileRoute`): `Last-Modified`, weak ETag
//! (`W/"size-mtime"`), `If-None-Match`/`If-Modified-Since`, and single-range
//! `Range` handling all apply.

use core::cell::Cell;
use core::ffi::c_void;
use core::mem::size_of;

use bun_core::strings;
use bun_http::Method;
use bun_http_types::ETag;
use bun_io::{Closer, FileType};
use bun_resolver::fs::StatHash;
use bun_sys::{self, Fd};
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::file_response_stream::StartOptions as FileResponseStreamOptions;
use crate::server::jsc::{JSGlobalObject, JsResult};
use crate::server::{AnyServer, FileResponseStream, HTTPStatusText, RangeRequest, write_status};

bun_output::declare_scope!(DirectoryRoute, hidden);

/// Per-path `StatHash` cache. Indexed by `xxhash(subpath) % N`; on collision
/// the slot is overwritten. Keeps the formatted `Last-Modified` string around
/// so repeat hits on unchanged files skip the date formatter.
const STAT_CACHE_SLOTS: usize = 1024;

struct StatCacheEntry {
    path_hash: u64,
    stat_hash: StatHash,
}

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = DirectoryRoute::deinit)]
pub struct DirectoryRoute {
    ref_count: Cell<u32>,
    server: Cell<Option<AnyServer>>,
    /// Open directory fd for the root. All per-request opens are relative to
    /// this (openat2 `RESOLVE_BENEATH` on Linux).
    root_fd: Fd,
    /// Absolute path to the root directory (diagnostics and non-Linux fallback).
    root_path: Box<[u8]>,
    /// URL prefix this route is mounted at, without the trailing `*` and with
    /// a trailing `/` — e.g. `"/static/"` for a `"/static/*"` route, `"/"` for
    /// `"/*"`. `req.url()` is stripped against this to obtain the subpath.
    url_prefix: Box<[u8]>,
    stat_cache: Box<[Cell<StatCacheEntry>]>,
}

impl DirectoryRoute {
    #[inline]
    pub fn set_server(&self, server: Option<AnyServer>) {
        self.server.set(server);
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<DirectoryRoute>()
            + self.root_path.len()
            + self.url_prefix.len()
            + self.stat_cache.len() * size_of::<Cell<StatCacheEntry>>()
    }

    /// Open `root` and construct the route. `url_prefix` must end in `/`.
    pub fn create(
        global: &JSGlobalObject,
        root: &[u8],
        url_prefix: &[u8],
    ) -> JsResult<*mut DirectoryRoute> {
        debug_assert!(url_prefix.last() == Some(&b'/'));

        let root_fd = match bun_sys::open_a(
            root,
            bun_sys::O::DIRECTORY | bun_sys::O::CLOEXEC | bun_sys::O::RDONLY,
            0,
        ) {
            Ok(fd) => fd,
            Err(err) => {
                use bun_sys_jsc::ErrorJsc;
                return Err(global.throw_value(err.to_js(global)?));
            }
        };

        let mut stat_cache = Vec::with_capacity(STAT_CACHE_SLOTS);
        for _ in 0..STAT_CACHE_SLOTS {
            stat_cache.push(Cell::new(StatCacheEntry {
                path_hash: 0,
                stat_hash: StatHash::default(),
            }));
        }

        Ok(bun_core::heap::into_raw(Box::new(DirectoryRoute {
            ref_count: Cell::new(1),
            server: Cell::new(None),
            root_fd,
            root_path: root.to_vec().into_boxed_slice(),
            url_prefix: url_prefix.to_vec().into_boxed_slice(),
            stat_cache: stat_cache.into_boxed_slice(),
        })))
    }

    fn deinit(this: *mut DirectoryRoute) {
        // SAFETY: `this` was allocated via heap::into_raw in `create` and the
        // intrusive ref_count has reached 0.
        unsafe {
            #[cfg(windows)]
            Closer::close((*this).root_fd, bun_sys::windows::libuv::Loop::get());
            #[cfg(not(windows))]
            Closer::close((*this).root_fd, ());
            drop(bun_core::heap::take(this));
        }
    }

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn on_head_request(this: *mut DirectoryRoute, req: AnyRequest, resp: AnyResponse) {
        // SAFETY: forwarded with the same precondition as `on_request`.
        unsafe { Self::on(this, req, resp, Method::HEAD) };
    }

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn on_request(this: *mut DirectoryRoute, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        // SAFETY: `this` is a live heap DirectoryRoute — intrusive ref held by
        // the route table; only reached from the uWS route callback.
        unsafe { Self::on(this, req, resp, method) };
    }

    /// # Safety
    /// `this_ptr` must point to a live heap `DirectoryRoute` for the duration
    /// of this call. The `ref_()` taken below keeps it alive until
    /// `on_response_complete`. All mutation through `this` goes via `Cell`.
    pub unsafe fn on(
        this_ptr: *mut DirectoryRoute,
        mut req: AnyRequest,
        resp: AnyResponse,
        method: Method,
    ) {
        // SAFETY: see fn-level Safety doc.
        let this = unsafe { &*this_ptr };
        debug_assert!(this.server.get().is_some());
        this.ref_();
        if let Some(mut server) = this.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }

        let mut decode_buf = bun_paths::path_buffer_pool::get();
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let rel_len = match resolve_subpath(
            req.url(),
            &this.url_prefix,
            &mut decode_buf.0[..],
            &mut path_buf.0[..],
        ) {
            Some(n) => n,
            None => {
                bun_output::scoped_log!(
                    DirectoryRoute,
                    "reject {}",
                    bstr::BStr::new(req.url())
                );
                req.set_yield(true);
                Self::on_response_complete(this_ptr, resp);
                return;
            }
        };
        drop(decode_buf);
        let rel: &[u8] = &path_buf.0[..rel_len];

        let (fd, is_index) = match this.open_subpath(rel) {
            Some(pair) => pair,
            None => {
                bun_output::scoped_log!(DirectoryRoute, "miss  {}", bstr::BStr::new(rel));
                req.set_yield(true);
                Self::on_response_complete(this_ptr, resp);
                return;
            }
        };

        // Every non-streaming return below hits this guard: closes the fd and
        // releases the route ref. The streaming path clears it immediately
        // before handing ownership to `FileResponseStream`.
        let mut fd_guard = scopeguard::guard(true, move |owned| {
            if owned {
                #[cfg(windows)]
                Closer::close(fd, bun_sys::windows::libuv::Loop::get());
                #[cfg(not(windows))]
                Closer::close(fd, ());
                Self::on_response_complete(this_ptr, resp);
            }
        });

        let stat = match bun_sys::fstat(fd) {
            Ok(s) => s,
            Err(_) => {
                req.set_yield(true);
                return;
            }
        };

        let mode = stat.st_mode as bun_sys::Mode;
        if bun_sys::S::ISDIR(mode) || !bun_sys::S::ISREG(mode) {
            req.set_yield(true);
            return;
        }

        let size: u64 = u64::try_from(stat.st_size.max(0)).expect("int cast");

        let path_hash = bun_wyhash::hash(rel);
        let slot = &this.stat_cache[(path_hash as usize) % STAT_CACHE_SLOTS];
        let mut entry = slot.replace(StatCacheEntry {
            path_hash: 0,
            stat_hash: StatHash::default(),
        });
        if entry.path_hash != path_hash {
            entry.path_hash = path_hash;
            entry.stat_hash = StatHash::default();
        }
        entry.stat_hash.hash(&stat, rel);
        let last_modified_ms = entry.stat_hash.last_modified_u64;
        // 64-byte stack buffer: `Last-Modified` is exactly 29 bytes; the ETag
        // is at most `W/"` + 16 + `-` + 16 + `"` = 36 bytes.
        let mut lm_buf = [0u8; 32];
        let last_modified: Option<&[u8]> = entry.stat_hash.last_modified().map(|s| {
            lm_buf[..s.len()].copy_from_slice(s);
            &lm_buf[..s.len()]
        });
        slot.set(entry);

        let mut etag_buf = [0u8; 40];
        let etag = format_weak_etag(&mut etag_buf, size, last_modified_ms);

        // RFC 9110 §13.2.2 precedence: If-Match → If-Unmodified-Since →
        // If-None-Match → If-Modified-Since → Range.
        let range: RangeRequest::Result = if method == Method::GET || method == Method::HEAD {
            RangeRequest::from_request(&req, size)
        } else {
            RangeRequest::Result::None
        };

        let status_code: u16 = 'brk: {
            if method == Method::HEAD || method == Method::GET {
                if let Some(im) = req.header(b"if-match").filter(|v| !v.is_empty()) {
                    if !ETag::if_match(Some(etag), im) {
                        break 'brk 412;
                    }
                } else if let Some(ius) = req
                    .header(b"if-unmodified-since")
                    .and_then(crate::jsc_hooks::parse_http_date)
                {
                    if last_modified_ms > 0 && last_modified_ms / 1000 > ius / 1000 {
                        break 'brk 412;
                    }
                }

                if let Some(inm) = req.header(b"if-none-match").filter(|v| !v.is_empty()) {
                    if ETag::if_none_match(etag, inm) {
                        break 'brk 304;
                    }
                } else if let Some(ims) = req
                    .header(b"if-modified-since")
                    .and_then(crate::jsc_hooks::parse_http_date)
                {
                    if last_modified_ms > 0 && last_modified_ms / 1000 <= ims / 1000 {
                        break 'brk 304;
                    }
                }
            }

            if matches!(range, RangeRequest::Result::Unsatisfiable) {
                break 'brk 416;
            }
            if matches!(range, RangeRequest::Result::Satisfiable { .. }) {
                break 'brk 206;
            }
            200
        };

        req.set_yield(false);

        write_any_status(resp, status_code);
        resp.write_mark();

        let ext: &[u8] = if is_index { b"html" } else { extension_for_mime(rel) };
        let mime = bun_http_types::MimeType::by_extension(ext);
        resp.write_header(b"content-type", &mime.value);
        if let Some(lm) = last_modified {
            resp.write_header(b"last-modified", lm);
        }
        resp.write_header(b"etag", etag);
        if let Some(srv) = this.server.get() {
            if let Some(alt) = srv.h3_alt_svc() {
                resp.write_header(b"alt-svc", alt);
            }
        }

        if HTTPStatusText::is_null_body(status_code) {
            resp.end_without_body(resp.should_close_connection());
            return;
        }
        if status_code == 412 {
            resp.end(b"", resp.should_close_connection());
            return;
        }

        let (body_offset, body_len): (u64, Option<u64>) = match range {
            RangeRequest::Result::Satisfiable { start, end } => {
                let mut crbuf = [0u8; RangeRequest::CONTENT_RANGE_BUF];
                resp.write_header(
                    b"content-range",
                    RangeRequest::format_content_range(&mut crbuf, range, Some(size)),
                );
                resp.write_header(b"accept-ranges", b"bytes");
                (start, Some(end - start + 1))
            }
            RangeRequest::Result::Unsatisfiable => {
                let mut crbuf = [0u8; RangeRequest::CONTENT_RANGE_BUF];
                resp.write_header(
                    b"content-range",
                    RangeRequest::format_content_range(&mut crbuf, range, Some(size)),
                );
                resp.write_header(b"accept-ranges", b"bytes");
                resp.end(b"", resp.should_close_connection());
                return;
            }
            RangeRequest::Result::None => {
                resp.write_header(b"accept-ranges", b"bytes");
                (0, Some(size))
            }
        };

        if !resp.state().has_written_content_length_header() {
            resp.write_header_int(b"content-length", body_len.unwrap_or(size));
            resp.mark_wrote_content_length_header();
        }

        if method == Method::HEAD {
            resp.end_without_body(resp.should_close_connection());
            return;
        }

        bun_output::scoped_log!(
            DirectoryRoute,
            "serve {} ({} bytes)",
            bstr::BStr::new(rel),
            size
        );

        *fd_guard = false;
        FileResponseStream::start(&FileResponseStreamOptions {
            fd,
            auto_close: true,
            resp,
            vm: bun_ptr::BackRef::new(this.server.get().unwrap().vm()),
            file_type: FileType::File,
            pollable: false,
            offset: body_offset,
            length: body_len,
            idle_timeout: this.server.get().unwrap().config().idle_timeout,
            ctx: this_ptr.cast::<c_void>(),
            on_complete: on_stream_complete,
            on_abort: None,
            on_error: on_stream_error,
        });
    }

    /// Open `rel` beneath `root_fd`. Tries `index.html` when `rel` resolves to
    /// a directory (the caller has already normalized `rel` and guaranteed no
    /// `..` components). Returns `(fd, served_index_html)`.
    fn open_subpath(&self, rel: &[u8]) -> Option<(Fd, bool)> {
        if rel.is_empty() || rel == b"." {
            return self.open_beneath(b"index.html").map(|fd| (fd, true));
        }
        let fd = self.open_beneath(rel)?;
        match bun_sys::fstat(fd) {
            Ok(s) if bun_sys::S::ISDIR(s.st_mode as bun_sys::Mode) => {
                #[cfg(windows)]
                Closer::close(fd, bun_sys::windows::libuv::Loop::get());
                #[cfg(not(windows))]
                Closer::close(fd, ());
                let mut buf = bun_paths::path_buffer_pool::get();
                let sub = &mut buf.0[..];
                if rel.len() + 1 + b"index.html".len() >= sub.len() {
                    return None;
                }
                sub[..rel.len()].copy_from_slice(rel);
                sub[rel.len()] = b'/';
                sub[rel.len() + 1..rel.len() + 1 + b"index.html".len()]
                    .copy_from_slice(b"index.html");
                self.open_beneath(&sub[..rel.len() + 1 + b"index.html".len()])
                    .map(|fd| (fd, true))
            }
            Ok(_) => Some((fd, false)),
            Err(_) => {
                #[cfg(windows)]
                Closer::close(fd, bun_sys::windows::libuv::Loop::get());
                #[cfg(not(windows))]
                Closer::close(fd, ());
                None
            }
        }
    }

    /// Open `rel` relative to `root_fd`. On Linux this is
    /// `openat2(RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS)`: the kernel rejects
    /// any resolution step (including symlink hops) that escapes the root.
    /// On other platforms the only containment is the lexical `..` strip done
    /// by the caller in `resolve_subpath`.
    fn open_beneath(&self, rel: &[u8]) -> Option<Fd> {
        let mut buf = bun_paths::path_buffer_pool::get();
        let zrel = bun_paths::resolve_path::z(rel, &mut *buf);
        let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NONBLOCK;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            bun_sys::openat2_beneath(self.root_fd, zrel, flags, 0).ok()
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            bun_sys::openat(self.root_fd, zrel, flags, 0).ok()
        }
    }

    fn on_response_complete(this: *mut DirectoryRoute, resp: AnyResponse) {
        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        // SAFETY: `this` is live (ref held by caller); `deref()` may free it.
        unsafe {
            if let Some(mut server) = (*this).server.get() {
                server.on_static_request_complete();
            }
            Self::deref(this);
        }
    }
}

fn on_stream_complete(ctx: *mut c_void, resp: AnyResponse) {
    DirectoryRoute::on_response_complete(ctx.cast::<DirectoryRoute>(), resp);
}

fn on_stream_error(ctx: *mut c_void, resp: AnyResponse, _err: bun_sys::Error) {
    DirectoryRoute::on_response_complete(ctx.cast::<DirectoryRoute>(), resp);
}

fn write_any_status(resp: AnyResponse, status: u16) {
    match resp {
        AnyResponse::SSL(r) => write_status::<true>(r, status),
        AnyResponse::TCP(r) => write_status::<false>(r, status),
        AnyResponse::H3(r) => {
            let mut b = bun_core::fmt::ItoaBuf::new();
            let s = bun_core::fmt::itoa(&mut b, status);
            bun_opaque::opaque_deref_mut(r).write_status(s);
        }
    }
}

/// Resolve the URL path into a root-relative filesystem subpath.
///
/// Percent-decodes into `scratch`, writes the cleaned result into `out`, and
/// returns its length. `None` on any rejection: malformed percent-escape, NUL
/// byte, backslash, path that normalizes above the root, or prefix mismatch.
///
/// Steps:
/// 1. Strip `url_prefix` (which always ends in `/`).
/// 2. Percent-decode the remainder **once**.
/// 3. Reject NUL and `\`.
/// 4. Lexically collapse `//`, `.`, `..` (capped at the root).
///
/// The result never begins with `/` and never contains `..` as a component.
fn resolve_subpath(
    url: &[u8],
    url_prefix: &[u8],
    scratch: &mut [u8],
    out: &mut [u8],
) -> Option<usize> {
    let after_prefix = if strings::starts_with(url, url_prefix) {
        &url[url_prefix.len()..]
    } else if url.len() + 1 == url_prefix.len() && url == &url_prefix[..url_prefix.len() - 1] {
        // `"/static"` against prefix `"/static/"` — treat as the root.
        b""
    } else {
        return None;
    };

    if after_prefix.len() > scratch.len() {
        return None;
    }

    let decoded_len = match bun_url::PercentEncoding::decode_into(
        &mut scratch[..after_prefix.len()],
        after_prefix,
    ) {
        Ok(n) => n as usize,
        Err(_) => return None,
    };
    let decoded = &scratch[..decoded_len];

    for &b in decoded {
        if b == 0 || b == b'\\' {
            return None;
        }
    }

    // Lexical clean: collapse `//`, drop `.`, apply `..` up to the root. Any
    // `..` that would climb above the root is rejected outright rather than
    // clamped so an off-by-one elsewhere can't silently expose the root.
    let mut w: usize = 0;
    let mut i: usize = 0;
    while i < decoded_len {
        while i < decoded_len && decoded[i] == b'/' {
            i += 1;
        }
        let start = i;
        while i < decoded_len && decoded[i] != b'/' {
            i += 1;
        }
        let seg = &decoded[start..i];
        if seg.is_empty() || seg == b"." {
            continue;
        }
        if seg == b".." {
            if w == 0 {
                return None;
            }
            while w > 0 && out[w - 1] != b'/' {
                w -= 1;
            }
            if w > 0 {
                w -= 1;
            }
            continue;
        }
        if w > 0 {
            if w >= out.len() {
                return None;
            }
            out[w] = b'/';
            w += 1;
        }
        if w + seg.len() > out.len() {
            return None;
        }
        out[w..w + seg.len()].copy_from_slice(seg);
        w += seg.len();
    }

    Some(w)
}

/// `W/"<size-hex>-<mtime-sec-hex>"` — matches the nginx/send scheme so CDNs
/// that special-case weak validators behave the same.
fn format_weak_etag(buf: &mut [u8; 40], size: u64, mtime_ms: u64) -> &[u8] {
    use core::fmt::Write as _;
    let mut c = bun_core::fmt::SliceCursor::new(&mut buf[..]);
    let _ = write!(c, "W/\"{:x}-{:x}\"", size, mtime_ms / 1000);
    let n = c.at;
    &buf[..n]
}

/// Extension without the leading dot, or `b""`.
fn extension_for_mime(path: &[u8]) -> &[u8] {
    let ext = bun_paths::extension(path);
    if ext.first() == Some(&b'.') {
        &ext[1..]
    } else {
        ext
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(url: &[u8], prefix: &[u8]) -> Option<Vec<u8>> {
        let mut scratch = [0u8; 4096];
        let mut out = [0u8; 4096];
        resolve_subpath(url, prefix, &mut scratch, &mut out).map(|n| out[..n].to_vec())
    }

    #[test]
    fn resolve_basic() {
        assert_eq!(resolve(b"/static/a.txt", b"/static/").as_deref(), Some(&b"a.txt"[..]));
        assert_eq!(resolve(b"/static/a/b.txt", b"/static/").as_deref(), Some(&b"a/b.txt"[..]));
        assert_eq!(resolve(b"/a.txt", b"/").as_deref(), Some(&b"a.txt"[..]));
        assert_eq!(resolve(b"/", b"/").as_deref(), Some(&b""[..]));
        assert_eq!(resolve(b"/static", b"/static/").as_deref(), Some(&b""[..]));
        assert_eq!(resolve(b"/static/", b"/static/").as_deref(), Some(&b""[..]));
    }

    #[test]
    fn resolve_percent() {
        assert_eq!(
            resolve(b"/static/hello%20world.txt", b"/static/").as_deref(),
            Some(&b"hello world.txt"[..])
        );
        assert_eq!(
            resolve(b"/static/a%2Fb.txt", b"/static/").as_deref(),
            Some(&b"a/b.txt"[..])
        );
        // malformed %
        assert_eq!(resolve(b"/static/a%2.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a%", b"/static/"), None);
        // double-encoded '..' stays literal after one decode
        assert_eq!(
            resolve(b"/static/%252e%252e/etc", b"/static/").as_deref(),
            Some(&b"%2e%2e/etc"[..])
        );
    }

    #[test]
    fn resolve_traversal() {
        assert_eq!(resolve(b"/static/../etc/passwd", b"/static/"), None);
        assert_eq!(resolve(b"/static/..%2Fetc", b"/static/"), None);
        assert_eq!(resolve(b"/static/%2e%2e/etc", b"/static/"), None);
        assert_eq!(resolve(b"/static/a/../../etc", b"/static/"), None);
        assert_eq!(
            resolve(b"/static/a/../b.txt", b"/static/").as_deref(),
            Some(&b"b.txt"[..])
        );
        assert_eq!(
            resolve(b"/static/a/./b.txt", b"/static/").as_deref(),
            Some(&b"a/b.txt"[..])
        );
        assert_eq!(
            resolve(b"/static/a//b.txt", b"/static/").as_deref(),
            Some(&b"a/b.txt"[..])
        );
        // `....` is not `..`
        assert_eq!(
            resolve(b"/static/..../etc", b"/static/").as_deref(),
            Some(&b"..../etc"[..])
        );
    }

    #[test]
    fn resolve_nul_backslash() {
        assert_eq!(resolve(b"/static/a%00.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a\\b.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a%5Cb.txt", b"/static/"), None);
    }

    #[test]
    fn etag_format() {
        let mut buf = [0u8; 40];
        assert_eq!(format_weak_etag(&mut buf, 0, 0), b"W/\"0-0\"");
        assert_eq!(format_weak_etag(&mut buf, 1234, 5678_000), b"W/\"4d2-162e\"");
    }
}
