//! Serve a directory tree at a URL prefix: `"/static/*": { dir: "./public" }`.

use core::cell::Cell;
use core::mem::size_of;

use bun_core::String as BunString;
use bun_core::strings;
use bun_http::{Headers, Method};
use bun_io::FileType;
use bun_jsc::bun_string_jsc;
use bun_paths::resolve_path;
use bun_ptr::{RefPtr, ThisPtr};
use bun_resolver::fs::StatHash;
use bun_sys::{self, Fd, File};
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::file_response_stream::{StartOptions as FileResponseStreamOptions, StreamOwner};
use crate::server::file_route::{status_for_preconditions, write_any_status, write_content_range};
use crate::server::jsc::{JSGlobalObject, JsResult};
use crate::server::{AnyServer, FileResponseStream, HTTPStatusText, RangeRequest};

bun_output::declare_scope!(DirectoryRoute, hidden);

/// `wyhash(subpath) % N` direct-mapped StatHash cache; collisions overwrite.
const STAT_CACHE_SLOTS: usize = 256;

#[derive(Default)]
struct StatCacheEntry {
    path: Vec<u8>,
    stat_hash: StatHash,
}

#[derive(bun_ptr::CellRefCounted)]
pub struct DirectoryRoute {
    ref_count: Cell<u32>,
    server: Cell<Option<AnyServer>>,
    root_fd: Cell<Fd>,
    /// Mount prefix with trailing `/` (`"/static/"`, or `"/"` for `"/*"`).
    url_prefix: Box<[u8]>,
    stat_cache: Box<[Cell<StatCacheEntry>]>,
    /// Sum of `StatCacheEntry.path` capacities, for `memory_cost()`.
    stat_cache_path_bytes: Cell<usize>,
    /// User headers from `{ dir, headers }`, written onto every file response.
    headers: Headers,
    /// A user `last-modified` header, parsed once, for precondition checks.
    user_last_modified_ms: Option<u64>,
    has_content_type_header: bool,
    has_last_modified_header: bool,
    has_etag_header: bool,
    has_date_header: bool,
}

impl DirectoryRoute {
    #[inline]
    pub fn set_server(&self, server: Option<AnyServer>) {
        self.server.set(server);
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<DirectoryRoute>()
            + self.url_prefix.len()
            + self.stat_cache.len() * size_of::<Cell<StatCacheEntry>>()
            + self.stat_cache_path_bytes.get()
            + self.headers.memory_cost()
    }

    /// Open `root` and construct the route. `url_prefix` must end in `/`.
    pub fn create(
        global: &JSGlobalObject,
        root: &[u8],
        url_prefix: &[u8],
        enable_stat_cache: bool,
        headers: Headers,
    ) -> JsResult<RefPtr<DirectoryRoute>> {
        debug_assert!(url_prefix.last() == Some(&b'/'));
        debug_assert!(!strings::contains(url_prefix, b"//"));

        // Stays before the open: a `?` after `open_a` would leak `root_fd`.
        let user_last_modified_ms = match headers.get(b"last-modified") {
            Some(lm) => {
                let date = bun_string_jsc::parse_date(&BunString::borrow_utf8(lm), global)?;
                // Same rule as `FileRoute::last_modified_date`.
                date.is_finite().then_some(date as u64)
            }
            None => None,
        };

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

        let slots = if enable_stat_cache {
            STAT_CACHE_SLOTS
        } else {
            0
        };
        let mut stat_cache = Vec::with_capacity(slots);
        for _ in 0..slots {
            stat_cache.push(Cell::new(StatCacheEntry::default()));
        }

        Ok(RefPtr::new(DirectoryRoute {
            ref_count: Cell::new(1),
            server: Cell::new(None),
            root_fd: Cell::new(root_fd),
            url_prefix: url_prefix.to_vec().into_boxed_slice(),
            stat_cache: stat_cache.into_boxed_slice(),
            stat_cache_path_bytes: Cell::new(0),
            user_last_modified_ms,
            has_content_type_header: headers.get(b"content-type").is_some(),
            has_last_modified_header: headers.get(b"last-modified").is_some(),
            has_etag_header: headers.get(b"etag").is_some(),
            has_date_header: headers.get(b"date").is_some(),
            headers,
        }))
    }

    pub fn on_head_request(this: ThisPtr<DirectoryRoute>, req: AnyRequest, resp: AnyResponse) {
        Self::on(this, req, resp, Method::HEAD);
    }

    pub fn on_request(this: ThisPtr<DirectoryRoute>, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        Self::on(this, req, resp, method);
    }

    fn on(this: ThisPtr<DirectoryRoute>, mut req: AnyRequest, resp: AnyResponse, method: Method) {
        debug_assert!(this.server.get().is_some());
        // Held until the response completes; a reload can drop the route
        // table's ref while a `FileResponseStream` is still streaming.
        let guard = ResponseGuard {
            route: Some(RefPtr::from_this(this)),
            resp,
        };
        if let Some(mut server) = this.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }

        let mut path_buf = bun_paths::path_buffer_pool::get();
        let Some((rel_len, had_trailing_slash)) =
            resolve_subpath(req.url(), &this.url_prefix, &mut path_buf.0[..])
        else {
            bun_output::scoped_log!(DirectoryRoute, "reject {}", bstr::BStr::new(req.url()));
            write_miss(&mut req, resp);
            return;
        };
        let rel: &[u8] = &path_buf.0[..rel_len];

        let (file, stat, is_index) = match this.open_subpath(rel, had_trailing_slash) {
            Some(Subpath::File(f, s, idx)) => (f, s, idx),
            Some(Subpath::RedirectSlash) => {
                let mut loc = bun_paths::path_buffer_pool::get();
                let n = build_slash_redirect(req.url(), &mut loc.0[..]);
                if n == 0 {
                    write_miss(&mut req, resp);
                    return;
                }
                req.set_yield(false);
                write_any_status(resp, 301);
                resp.write_mark();
                resp.write_header(b"location", &loc.0[..n]);
                resp.end(b"", resp.should_close_connection());
                return;
            }
            None => {
                bun_output::scoped_log!(DirectoryRoute, "miss  {}", bstr::BStr::new(rel));
                write_miss(&mut req, resp);
                return;
            }
        };

        let size: u64 = u64::try_from(stat.st_size.max(0)).expect("int cast");

        let (last_modified_ms, lm_buf, lm_len) = this.stat_cache_lookup(rel, &stat);
        let last_modified = (lm_len > 0).then(|| &lm_buf[..lm_len]);

        let mut etag_buf = [0u8; 40];
        let weak_etag = format_weak_etag(&mut etag_buf, size, last_modified_ms);
        // Preconditions compare against the validators the client saw.
        let etag: Option<&[u8]> = if this.has_etag_header {
            this.headers.get(b"etag").filter(|v| !v.is_empty())
        } else {
            Some(weak_etag)
        };
        let precondition_last_modified_ms = if this.has_last_modified_header {
            this.user_last_modified_ms
        } else {
            (last_modified_ms > 0).then_some(last_modified_ms)
        };

        let range = if method == Method::GET || method == Method::HEAD {
            RangeRequest::from_request(&req, size)
        } else {
            RangeRequest::Result::None
        };

        let status_code = status_for_preconditions(
            &req,
            method,
            200,
            etag,
            precondition_last_modified_ms,
            range,
        );

        req.set_yield(false);
        write_any_status(resp, status_code);
        if this.has_date_header {
            resp.mark_wrote_date_header();
        }
        resp.write_mark();
        this.write_user_headers(resp);

        if !this.has_content_type_header {
            let ext: &[u8] = if is_index {
                b"html"
            } else {
                extension_for_mime(rel)
            };
            resp.write_header(
                b"content-type",
                &bun_http_types::MimeType::by_extension(ext).value,
            );
        }
        if !this.has_last_modified_header {
            if let Some(lm) = last_modified {
                resp.write_header(b"last-modified", lm);
            }
        }
        if !this.has_etag_header {
            resp.write_header(b"etag", weak_etag);
        }
        if !matches!(resp, AnyResponse::H3(_)) {
            if let Some(srv) = this.server.get() {
                if let Some(alt) = srv.h3_alt_svc() {
                    resp.write_header(b"alt-svc", alt);
                }
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

        let (body_offset, body_len): (u64, u64) = match range {
            RangeRequest::Result::Satisfiable { .. } => {
                write_content_range(resp, range, size).unwrap()
            }
            RangeRequest::Result::Unsatisfiable => {
                write_content_range(resp, range, size);
                resp.end(b"", resp.should_close_connection());
                return;
            }
            RangeRequest::Result::None => {
                resp.write_header(b"accept-ranges", b"bytes");
                (0, size)
            }
        };

        if !resp.state().has_written_content_length_header() {
            resp.write_header_int(b"content-length", body_len);
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

        let server = this.server.get().unwrap();
        FileResponseStream::start(FileResponseStreamOptions {
            fd: file.into_raw(),
            auto_close: true,
            resp,
            vm: bun_ptr::BackRef::new(server.vm()),
            file_type: FileType::File,
            pollable: false,
            offset: body_offset,
            length: Some(body_len),
            idle_timeout: server.config().idle_timeout,
            owner: StreamOwner::DirectoryRoute(guard.into_route()),
        });
    }

    /// Write the user `{ headers }` onto a file response (404/301 skip them).
    fn write_user_headers(&self, resp: AnyResponse) {
        use bun_http_types::ETag::HeaderEntryColumns;
        let entries = self.headers.entries.slice();
        let names = entries.items_name();
        let values = entries.items_value();
        debug_assert_eq!(names.len(), values.len());
        for (name, value) in names.iter().zip(values) {
            resp.write_header(self.headers.as_str(*name), self.headers.as_str(*value));
        }
    }

    /// Open `rel` under the root. For directories: serve `index.html` when the
    /// URL had a trailing slash, otherwise ask the caller to 301-redirect to
    /// the slash form so the new request re-enters routing (the served
    /// resource's canonical URL may be owned by a more-specific route).
    fn open_subpath(&self, rel: &[u8], had_trailing_slash: bool) -> Option<Subpath> {
        let open_and_stat = |p: &[u8]| -> Option<(File, bun_sys::Stat)> {
            let f = self.open_beneath(p)?;
            let s = f.stat().ok()?;
            Some((f, s))
        };
        if rel.is_empty() {
            let (f, s) = open_and_stat(b"index.html")?;
            return bun_sys::S::ISREG(s.st_mode as bun_sys::Mode)
                .then_some(Subpath::File(f, s, true));
        }
        let (file, stat) = open_and_stat(rel)?;
        let mode = stat.st_mode as bun_sys::Mode;
        if bun_sys::S::ISDIR(mode) {
            drop(file);
            if !had_trailing_slash {
                return Some(Subpath::RedirectSlash);
            }
            let mut buf = bun_paths::path_buffer_pool::get();
            let joined = resolve_path::join_string_buf::<resolve_path::platform::Posix>(
                &mut buf.0[..],
                &[rel, b"index.html"],
            );
            let (f, s) = open_and_stat(joined)?;
            return bun_sys::S::ISREG(s.st_mode as bun_sys::Mode)
                .then_some(Subpath::File(f, s, true));
        }
        // Trailing slash on a regular file is a miss (nginx, npm `send`):
        // `/file/` would route past an exact `/file` handler in uWS.
        (bun_sys::S::ISREG(mode) && !had_trailing_slash).then_some(Subpath::File(file, stat, false))
    }

    /// `openat2(RESOLVE_IN_ROOT|NO_MAGICLINKS)` on Linux, `openat` elsewhere.
    fn open_beneath(&self, rel: &[u8]) -> Option<File> {
        let mut buf = bun_paths::path_buffer_pool::get();
        let zrel = resolve_path::z(rel, &mut *buf);
        // NONBLOCK so opening a FIFO without a writer cannot block the event
        // loop on POSIX. Not on Windows: there `openat` maps it to omitting
        // FILE_SYNCHRONOUS_IO_NONALERT, which breaks the synchronous reads
        // FileResponseStream issues.
        #[cfg(not(windows))]
        let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NONBLOCK;
        #[cfg(windows)]
        let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let fd = bun_sys::openat2_in_root(self.root_fd.get(), zrel, flags, 0).ok()?;
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let fd = bun_sys::openat(self.root_fd.get(), zrel, flags, 0).ok()?;
        // Windows `openat` returns a HANDLE; `FileResponseStream` needs a
        // libuv fd. `make_lib_uv_owned` is a no-op on POSIX.
        use bun_sys::FdExt;
        fd.make_lib_uv_owned_for_syscall(bun_sys::Tag::open, bun_sys::ErrorCase::CloseOnFail)
            .ok()
            .map(File::from_fd)
    }

    fn stat_cache_lookup(&self, rel: &[u8], stat: &bun_sys::Stat) -> (u64, [u8; 32], usize) {
        let mut buf = [0u8; 32];
        if self.stat_cache.is_empty() {
            let mut sh = StatHash::default();
            sh.hash(stat, rel);
            let len = sh.last_modified().map(|s| {
                buf[..s.len()].copy_from_slice(s);
                s.len()
            });
            return (sh.last_modified_u64, buf, len.unwrap_or(0));
        }
        let slot = &self.stat_cache[(bun_wyhash::hash(rel) as usize) % self.stat_cache.len()];
        let mut entry = slot.replace(StatCacheEntry::default());
        if entry.path.as_slice() != rel {
            let old_cap = entry.path.capacity();
            entry.path.clear();
            entry.path.extend_from_slice(rel);
            entry.stat_hash = StatHash::default();
            self.stat_cache_path_bytes
                .set(self.stat_cache_path_bytes.get() + entry.path.capacity() - old_cap);
        }
        entry.stat_hash.hash(stat, rel);
        let ms = entry.stat_hash.last_modified_u64;
        let len = entry
            .stat_hash
            .last_modified()
            .map(|s| {
                buf[..s.len()].copy_from_slice(s);
                s.len()
            })
            .unwrap_or(0);
        slot.set(entry);
        (ms, buf, len)
    }

    /// The last thing a response does with the route; callers then release
    /// the ref `on()` took for it.
    pub(crate) fn on_response_complete(&self, resp: AnyResponse) {
        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        if let Some(mut server) = self.server.get() {
            server.on_static_request_complete();
        }
    }
}

impl Drop for DirectoryRoute {
    fn drop(&mut self) {
        drop(File::from_fd(self.root_fd.get()));
    }
}

/// Completes the response and releases its route ref (closing the file, if
/// any, as it drops) on every non-streaming return.
struct ResponseGuard {
    route: Option<RefPtr<DirectoryRoute>>,
    resp: AnyResponse,
}

impl ResponseGuard {
    /// Hand the ref to the `FileResponseStream` instead.
    fn into_route(mut self) -> RefPtr<DirectoryRoute> {
        self.route.take().expect("taken once")
    }
}

impl Drop for ResponseGuard {
    fn drop(&mut self) {
        if let Some(route) = self.route.take() {
            route.on_response_complete(self.resp);
        }
    }
}

// `Stat` is ~144 bytes; boxing it would add a heap alloc on the hot path.
#[allow(clippy::large_enum_variant)]
enum Subpath {
    File(File, bun_sys::Stat, bool),
    RedirectSlash,
}

fn write_miss(req: &mut AnyRequest, resp: AnyResponse) {
    req.set_yield(false);
    write_any_status(resp, 404);
    resp.write_mark();
    resp.end(b"", resp.should_close_connection());
}

/// `Location: {path}/{?query}` into `out`. `resolve_subpath` has already
/// validated `path`: it starts with `url_prefix` (which starts with `/`) and
/// its first segment is non-empty, so the result cannot be a `//...`
/// protocol-relative URL (CVE-2024-43799).
fn build_slash_redirect(url: &[u8], out: &mut [u8]) -> usize {
    let (path, query) = path_and_query(url);
    debug_assert!(path.first() == Some(&b'/') && path.get(1) != Some(&b'/'));
    if path.len() >= out.len() {
        return 0;
    }
    out[..path.len()].copy_from_slice(path);
    out[path.len()] = b'/';
    let q = query.len().min(out.len() - path.len() - 1);
    out[path.len() + 1..path.len() + 1 + q].copy_from_slice(&query[..q]);
    path.len() + 1 + q
}

/// Split a raw request-target (uWS `getFullUrl()`) into `(path, query)`.
/// Strips `?query` first, then any absolute-form scheme+authority (RFC 9112
/// §3.2.2), mirroring uWS `getUrlForRouting()` exactly. `query` includes the
/// leading `?` when present.
fn path_and_query(url: &[u8]) -> (&[u8], &[u8]) {
    let (path, query) = match strings::index_of_char(url, b'?') {
        Some(i) => (&url[..i as usize], &url[i as usize..]),
        None => (url, &b""[..]),
    };
    let path = if !path.is_empty() && path[0] != b'/' {
        let skip = if strings::has_prefix_case_insensitive(path, b"http://") {
            7
        } else if strings::has_prefix_case_insensitive(path, b"https://") {
            8
        } else {
            0
        };
        if skip > 0 {
            match strings::index_of_char(&path[skip..], b'/') {
                Some(i) => &path[skip + i as usize..],
                None => b"/",
            }
        } else {
            path
        }
    } else {
        path
    };
    (path, query)
}

/// RFC 3986 `pchar` (the bytes that may appear literally in a path segment):
/// unreserved / sub-delims / ":" / "@". `%XX` encoding one of these never
/// changes the URL's meaning, so there is no legitimate reason to send it.
#[inline]
fn is_url_path_literal(b: u8) -> bool {
    b.is_ascii_alphanumeric()
        || matches!(
            b,
            b'-' | b'.'
                | b'_'
                | b'~'
                | b'!'
                | b'$'
                | b'&'
                | b'\''
                | b'('
                | b')'
                | b'*'
                | b'+'
                | b','
                | b';'
                | b'='
                | b':'
                | b'@'
        )
}

/// Strip `url_prefix`, percent-decode once, and validate the result is a
/// canonical relative path. `None` for any input that would make the served
/// path differ from the routed path (see comment on the segment scan below).
/// Writes into `out`; returns `(len, had_trailing_slash)`.
fn resolve_subpath(url: &[u8], url_prefix: &[u8], out: &mut [u8]) -> Option<(usize, bool)> {
    let (path, _query) = path_and_query(url);
    let after_prefix = if strings::starts_with(path, url_prefix) {
        &path[url_prefix.len()..]
    } else if path.len() + 1 == url_prefix.len() && path == &url_prefix[..url_prefix.len() - 1] {
        b""
    } else {
        return None;
    };

    // Leave room for the NUL `z()` appends and for `"/index.html"` when the
    // resolved path turns out to be a directory.
    if after_prefix.len() >= out.len().saturating_sub(b"/index.html\0".len()) {
        return None;
    }

    // uWS routed on the raw URL split on literal `/` with no decode and no
    // normalization. Any transformation we apply that uWS did not creates a
    // path uWS never matched, which can bypass a more-specific overlapping
    // route. So reject every such transformation: `%XX` whose decoded byte is
    // a `pchar` (would let `%61dmin` reach `admin/`); encoded `%2F`; and any
    // non-canonical segment (empty / `.` / `..`). Route segments can only
    // consist of `pchar`s on the wire, so rejecting encoded `pchar`s leaves
    // percent-decoding as the identity on every byte that could influence
    // routing, while still decoding `%20`, high-bit bytes, etc.
    let mut raw_slashes = 0usize;
    let mut i = 0usize;
    while i < after_prefix.len() {
        match after_prefix[i] {
            b'/' => {
                raw_slashes += 1;
                i += 1;
            }
            b'%' if i + 2 < after_prefix.len()
                && after_prefix[i + 1].is_ascii_hexdigit()
                && after_prefix[i + 2].is_ascii_hexdigit() =>
            {
                let b = (strings::to_ascii_hex_value(after_prefix[i + 1]) << 4)
                    | strings::to_ascii_hex_value(after_prefix[i + 2]);
                if is_url_path_literal(b) {
                    return None;
                }
                i += 3;
            }
            _ => i += 1,
        }
    }

    let decoded_len =
        bun_url::PercentEncoding::decode_into(&mut out[..after_prefix.len()], after_prefix).ok()?
            as usize;
    let decoded = &out[..decoded_len];

    if strings::count_char(decoded, b'/') != raw_slashes {
        return None;
    }
    if decoded_len == 0 {
        return Some((0, false));
    }
    let had_trailing_slash = decoded[decoded_len - 1] == b'/';
    let end = decoded_len - usize::from(had_trailing_slash);
    let mut seg_start = 0;
    let mut i = 0;
    while i <= end {
        if i == end || decoded[i] == b'/' {
            let seg = &decoded[seg_start..i];
            if seg.is_empty() || seg == b"." || seg == b".." {
                return None;
            }
            seg_start = i + 1;
        } else if decoded[i] == 0 || decoded[i] == b'\\' || decoded[i] == b':' {
            return None;
        }
        i += 1;
    }
    Some((end, had_trailing_slash))
}

/// `W/"<size-hex>-<mtime-sec-hex>"` (nginx/send scheme).
fn format_weak_etag(buf: &mut [u8; 40], size: u64, mtime_ms: u64) -> &[u8] {
    use core::fmt::Write as _;
    let mut c = bun_core::fmt::SliceCursor::new(&mut buf[..]);
    let _ = write!(c, "W/\"{:x}-{:x}\"", size, mtime_ms / 1000);
    let n = c.at;
    &buf[..n]
}

fn extension_for_mime(path: &[u8]) -> &[u8] {
    let ext = bun_paths::extension(path);
    ext.strip_prefix(b".").unwrap_or(ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(url: &[u8], prefix: &[u8]) -> Option<(Vec<u8>, bool)> {
        let mut out = [0u8; 4096];
        resolve_subpath(url, prefix, &mut out).map(|(n, s)| (out[..n].to_vec(), s))
    }
    fn ok(bytes: &[u8], slash: bool) -> Option<(Vec<u8>, bool)> {
        Some((bytes.to_vec(), slash))
    }

    #[test]
    fn resolve_basic() {
        assert_eq!(resolve(b"/static/a.txt", b"/static/"), ok(b"a.txt", false));
        assert_eq!(
            resolve(b"/static/a/b.txt", b"/static/"),
            ok(b"a/b.txt", false)
        );
        assert_eq!(resolve(b"/a.txt", b"/"), ok(b"a.txt", false));
        assert_eq!(resolve(b"/", b"/"), ok(b"", false));
        assert_eq!(resolve(b"/static", b"/static/"), ok(b"", false));
        assert_eq!(resolve(b"/static/", b"/static/"), ok(b"", false));
        assert_eq!(
            resolve(b"/static/a.txt?v=1", b"/static/"),
            ok(b"a.txt", false)
        );
        assert_eq!(resolve(b"/static?x", b"/static/"), ok(b"", false));
        assert_eq!(
            resolve(b"http://x/static/a.txt", b"/static/"),
            ok(b"a.txt", false)
        );
        assert_eq!(
            resolve(b"HTTP://x/static/a.txt", b"/static/"),
            ok(b"a.txt", false)
        );
        assert_eq!(resolve(b"http://x?q/admin/secret", b"/"), ok(b"", false));
        assert_eq!(resolve(b"http://x", b"/"), ok(b"", false));
        assert_eq!(
            resolve(b"https://x:8080/static/a.txt?v=1", b"/static/"),
            ok(b"a.txt", false)
        );
    }

    #[test]
    fn resolve_trailing_slash() {
        assert_eq!(resolve(b"/static/a/", b"/static/"), ok(b"a", true));
        assert_eq!(resolve(b"/static/a/b/", b"/static/"), ok(b"a/b", true));
        assert_eq!(resolve(b"/static/a", b"/static/"), ok(b"a", false));
    }

    #[test]
    fn resolve_traversal() {
        assert_eq!(resolve(b"/static/../etc/passwd", b"/static/"), None);
        assert_eq!(resolve(b"/static/..%2Fetc", b"/static/"), None);
        assert_eq!(resolve(b"/static/%2e%2e/etc", b"/static/"), None);
        assert_eq!(resolve(b"/static/a/../../etc", b"/static/"), None);
        assert_eq!(resolve(b"/static/c:/windows", b"/static/"), None);
        assert_eq!(resolve(b"/static/file::$DATA", b"/static/"), None);
        assert_eq!(resolve(b"/static/a%00.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a%5Cb.txt", b"/static/"), None);
    }

    #[test]
    fn resolve_route_precedence_parity() {
        // These all route to the outer wildcard in uWS (which matches on raw
        // segments) but would reach a file under an inner prefix if we
        // normalized, decoded `/`, or decoded a pchar. Reject so the served
        // path equals the routed path.
        assert_eq!(resolve(b"/static/a%2Fb.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a%2fb.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static//a/b.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a//b.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static//", b"/static/"), None);
        assert_eq!(resolve(b"//", b"/"), None);
        assert_eq!(resolve(b"/static/./a.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a/./b.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a/../b.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a/..", b"/static/"), None);
        // `%XX` encoding a pchar (RFC 3986) is rejected: uWS would not have
        // matched the literal segment, so decoding it creates a new path.
        assert_eq!(resolve(b"/static/%61dmin/x", b"/static/"), None);
        assert_eq!(resolve(b"/static/admi%6E/x", b"/static/"), None);
        assert_eq!(resolve(b"/static/ad%4Din/x", b"/static/"), None);
        assert_eq!(resolve(b"/static/%40user/x", b"/static/"), None);
        assert_eq!(resolve(b"/static/%2Ewell-known/x", b"/static/"), None);
        // Legitimate percent-encoding (bytes that cannot appear literally in
        // a path segment) still works.
        assert_eq!(
            resolve(b"/static/hello%20world.txt", b"/static/"),
            ok(b"hello world.txt", false)
        );
        assert_eq!(
            resolve(b"/static/%C3%A9.txt", b"/static/"),
            ok(b"\xC3\xA9.txt", false)
        );
    }

    #[test]
    fn slash_redirect_location() {
        let mut out = [0u8; 256];
        let n = build_slash_redirect(b"/static/sub", &mut out);
        assert_eq!(&out[..n], b"/static/sub/");
        let n = build_slash_redirect(b"/static/sub?v=1&x=2", &mut out);
        assert_eq!(&out[..n], b"/static/sub/?v=1&x=2");
        let n = build_slash_redirect(b"http://h/static/sub?v=1", &mut out);
        assert_eq!(&out[..n], b"/static/sub/?v=1");
        // Path alone does not fit: bail rather than panic.
        let mut small = [0u8; 8];
        assert_eq!(build_slash_redirect(b"/static/sub", &mut small), 0);
        // Query truncated to fit.
        let mut small = [0u8; 14];
        let n = build_slash_redirect(b"/static/sub?verylongquery", &mut small);
        assert_eq!(&small[..n], b"/static/sub/?v");
    }
}
