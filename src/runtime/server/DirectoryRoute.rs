//! Serve a directory tree at a URL prefix: `"/static/*": { dir: "./public" }`.

use core::cell::Cell;
use core::ffi::c_void;
use core::mem::size_of;
use core::ptr::NonNull;

use bun_core::strings;
use bun_http::Method;
use bun_io::FileType;
use bun_paths::resolve_path;
use bun_resolver::fs::StatHash;
use bun_sys::{self, Fd, File};
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::file_response_stream::StartOptions as FileResponseStreamOptions;
use crate::server::file_route::{status_for_preconditions, write_any_status, write_content_range};
use crate::server::jsc::{JSGlobalObject, JsResult};
use crate::server::{AnyServer, FileResponseStream, HTTPStatusText, RangeRequest};

bun_output::declare_scope!(DirectoryRoute, hidden);

/// `wyhash(subpath) % N` direct-mapped StatHash cache; collisions overwrite.
const STAT_CACHE_SLOTS: usize = 1024;

struct StatCacheEntry {
    path_hash: u64,
    stat_hash: StatHash,
}

impl Default for StatCacheEntry {
    fn default() -> Self {
        Self {
            path_hash: 0,
            stat_hash: StatHash::default(),
        }
    }
}

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = DirectoryRoute::deinit)]
pub struct DirectoryRoute {
    ref_count: Cell<u32>,
    server: Cell<Option<AnyServer>>,
    root_fd: Cell<Fd>,
    /// Mount prefix with trailing `/` (`"/static/"`, or `"/"` for `"/*"`).
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
            stat_cache.push(Cell::new(StatCacheEntry::default()));
        }

        Ok(bun_core::heap::into_raw(Box::new(DirectoryRoute {
            ref_count: Cell::new(1),
            server: Cell::new(None),
            root_fd: Cell::new(root_fd),
            url_prefix: url_prefix.to_vec().into_boxed_slice(),
            stat_cache: stat_cache.into_boxed_slice(),
        })))
    }

    fn deinit(this: *mut DirectoryRoute) {
        // SAFETY: heap-allocated in `create`; refcount has reached 0.
        let this = unsafe { bun_core::heap::take(this) };
        drop(File::from_fd(this.root_fd.get()));
    }

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn on_head_request(this: *mut DirectoryRoute, req: AnyRequest, resp: AnyResponse) {
        bun_ptr::BackRef::from(NonNull::new(this).unwrap()).on(req, resp, Method::HEAD);
    }

    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn on_request(this: *mut DirectoryRoute, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        bun_ptr::BackRef::from(NonNull::new(this).unwrap()).on(req, resp, method);
    }

    fn on(&self, mut req: AnyRequest, resp: AnyResponse, method: Method) {
        debug_assert!(self.server.get().is_some());
        self.ref_();
        let guard = ResponseGuard {
            route: NonNull::from(self),
            resp,
        };
        if let Some(mut server) = self.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }

        let mut decode_buf = bun_paths::path_buffer_pool::get();
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let Some(rel_len) = resolve_subpath(
            req.url(),
            &self.url_prefix,
            &mut decode_buf.0[..],
            &mut path_buf.0[..],
        ) else {
            bun_output::scoped_log!(DirectoryRoute, "reject {}", bstr::BStr::new(req.url()));
            req.set_yield(true);
            return;
        };
        drop(decode_buf);
        let rel: &[u8] = &path_buf.0[..rel_len];

        let Some((file, is_index)) = self.open_subpath(rel) else {
            bun_output::scoped_log!(DirectoryRoute, "miss  {}", bstr::BStr::new(rel));
            req.set_yield(true);
            return;
        };

        let Ok(stat) = file.stat() else {
            req.set_yield(true);
            return;
        };
        let mode = stat.st_mode as bun_sys::Mode;
        if !bun_sys::S::ISREG(mode) {
            req.set_yield(true);
            return;
        }

        let size: u64 = u64::try_from(stat.st_size.max(0)).expect("int cast");

        let (last_modified_ms, lm_buf, lm_len) = self.stat_cache_lookup(rel, &stat);
        let last_modified = (lm_len > 0).then(|| &lm_buf[..lm_len]);

        let mut etag_buf = [0u8; 40];
        let etag = format_weak_etag(&mut etag_buf, size, last_modified_ms);

        let range = if method == Method::GET || method == Method::HEAD {
            RangeRequest::from_request(&req, size)
        } else {
            RangeRequest::Result::None
        };

        let status_code = status_for_preconditions(
            &req,
            method,
            200,
            Some(etag),
            (last_modified_ms > 0).then_some(last_modified_ms),
            range,
        );

        req.set_yield(false);
        write_any_status(resp, status_code);
        resp.write_mark();

        let ext: &[u8] = if is_index {
            b"html"
        } else {
            extension_for_mime(rel)
        };
        resp.write_header(b"content-type", &bun_http_types::MimeType::by_extension(ext).value);
        if let Some(lm) = last_modified {
            resp.write_header(b"last-modified", lm);
        }
        resp.write_header(b"etag", etag);
        if let Some(srv) = self.server.get() {
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

        let server = self.server.get().unwrap();
        FileResponseStream::start(&FileResponseStreamOptions {
            fd: file.into_raw(),
            auto_close: true,
            resp,
            vm: bun_ptr::BackRef::new(server.vm()),
            file_type: FileType::File,
            pollable: false,
            offset: body_offset,
            length: Some(body_len),
            idle_timeout: server.config().idle_timeout,
            ctx: guard.into_ctx(),
            on_complete: on_stream_complete,
            on_abort: None,
            on_error: on_stream_error,
        });
    }

    /// Returns `(fd, served_index_html)`; tries `index.html` for directories.
    fn open_subpath(&self, rel: &[u8]) -> Option<(File, bool)> {
        if rel.is_empty() || rel == b"." {
            return self.open_beneath(b"index.html").map(|f| (f, true));
        }
        let file = self.open_beneath(rel)?;
        match file.stat() {
            Ok(s) if bun_sys::S::ISDIR(s.st_mode as bun_sys::Mode) => {
                drop(file);
                let mut buf = bun_paths::path_buffer_pool::get();
                let joined = resolve_path::join_string_buf::<resolve_path::platform::Posix>(
                    &mut buf.0[..],
                    &[rel, b"index.html"],
                );
                self.open_beneath(joined).map(|f| (f, true))
            }
            Ok(_) => Some((file, false)),
            Err(_) => None,
        }
    }

    /// `openat2(RESOLVE_IN_ROOT|NO_MAGICLINKS)` on Linux, `openat` elsewhere.
    fn open_beneath(&self, rel: &[u8]) -> Option<File> {
        let mut buf = bun_paths::path_buffer_pool::get();
        let zrel = resolve_path::z(rel, &mut *buf);
        let flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NONBLOCK;
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
        let path_hash = bun_wyhash::hash(rel);
        let slot = &self.stat_cache[(path_hash as usize) % STAT_CACHE_SLOTS];
        let mut entry = slot.replace(StatCacheEntry::default());
        if entry.path_hash != path_hash {
            entry = StatCacheEntry::default();
            entry.path_hash = path_hash;
        }
        entry.stat_hash.hash(stat, rel);
        let ms = entry.stat_hash.last_modified_u64;
        let mut buf = [0u8; 32];
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

    fn on_response_complete(this: NonNull<DirectoryRoute>, resp: AnyResponse) {
        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        if let Some(mut server) = bun_ptr::BackRef::from(this).server.get() {
            server.on_static_request_complete();
        }
        // SAFETY: intrusive refcount; `ref_()` in `on()` pairs with this.
        unsafe { Self::deref(this.as_ptr()) };
    }
}

/// Releases the route ref (and file, if any) on every non-streaming return.
struct ResponseGuard {
    route: NonNull<DirectoryRoute>,
    resp: AnyResponse,
}

impl ResponseGuard {
    fn into_ctx(self) -> *mut c_void {
        let ctx = self.route.as_ptr().cast::<c_void>();
        core::mem::forget(self);
        ctx
    }
}

impl Drop for ResponseGuard {
    fn drop(&mut self) {
        DirectoryRoute::on_response_complete(self.route, self.resp);
    }
}

fn on_stream_complete(ctx: *mut c_void, resp: AnyResponse) {
    DirectoryRoute::on_response_complete(NonNull::new(ctx.cast()).unwrap(), resp);
}

fn on_stream_error(ctx: *mut c_void, resp: AnyResponse, _err: bun_sys::Error) {
    DirectoryRoute::on_response_complete(NonNull::new(ctx.cast()).unwrap(), resp);
}

/// Strip `url_prefix`, percent-decode once, reject NUL/`\`, normalize `.`/`..`;
/// `None` if the result would escape the root. Writes into `out`.
fn resolve_subpath(
    url: &[u8],
    url_prefix: &[u8],
    scratch: &mut [u8],
    out: &mut [u8],
) -> Option<usize> {
    // `req.url()` is uWS `getFullUrl()`, which includes the query string.
    let url = match strings::index_of_char(url, b'?') {
        Some(i) => &url[..i as usize],
        None => url,
    };
    let after_prefix = if strings::starts_with(url, url_prefix) {
        &url[url_prefix.len()..]
    } else if url.len() + 1 == url_prefix.len() && url == &url_prefix[..url_prefix.len() - 1] {
        b""
    } else {
        return None;
    };

    if after_prefix.len() > scratch.len() {
        return None;
    }

    let decoded_len = bun_url::PercentEncoding::decode_into(
        &mut scratch[..after_prefix.len()],
        after_prefix,
    )
    .ok()? as usize;

    let mut start = 0;
    while start < decoded_len && scratch[start] == b'/' {
        start += 1;
    }
    let decoded = &scratch[start..decoded_len];
    for &b in decoded {
        if b == 0 || b == b'\\' {
            return None;
        }
    }
    if decoded.is_empty() {
        return Some(0);
    }

    let norm =
        resolve_path::normalize_string_buf::<true, resolve_path::platform::Posix, false>(decoded, out);
    if norm == b".." || strings::starts_with(norm, b"../") {
        return None;
    }
    Some(norm.len())
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
        assert_eq!(resolve(b"/static/a.txt?v=1", b"/static/").as_deref(), Some(&b"a.txt"[..]));
        assert_eq!(resolve(b"/static?x", b"/static/").as_deref(), Some(&b""[..]));
    }

    #[test]
    fn resolve_traversal() {
        assert_eq!(resolve(b"/static/../etc/passwd", b"/static/"), None);
        assert_eq!(resolve(b"/static/..%2Fetc", b"/static/"), None);
        assert_eq!(resolve(b"/static/%2e%2e/etc", b"/static/"), None);
        assert_eq!(resolve(b"/static/a/../../etc", b"/static/"), None);
        assert_eq!(resolve(b"/static/a/../b.txt", b"/static/").as_deref(), Some(&b"b.txt"[..]));
        assert_eq!(resolve(b"/static/a//b.txt", b"/static/").as_deref(), Some(&b"a/b.txt"[..]));
        assert_eq!(resolve(b"/static/a%00.txt", b"/static/"), None);
        assert_eq!(resolve(b"/static/a%5Cb.txt", b"/static/"), None);
    }
}
