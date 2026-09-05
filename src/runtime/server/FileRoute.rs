use core::cell::Cell;
use core::mem::size_of;

use bun_core::String as BunString;
use bun_core::strings;
use bun_http::{Headers, Method};
use bun_http_types::ETag;
use bun_http_types::ETag::StringPointer;
use bun_io::Closer;
use bun_io::FileType;
use bun_ptr::{RefPtr, ThisPtr};
use bun_resolver::fs::StatHash;
use bun_sys::{self, Fd};
use bun_uws::{AnyRequest, AnyResponse};

use crate::node::types::PathOrFileDescriptor;
use crate::server::file_response_stream::{StartOptions as FileResponseStreamOptions, StreamOwner};
use crate::server::jsc::{JSGlobalObject, JSValue, JsResult, VirtualMachine};
use bun_jsc::bun_string_jsc;

use crate::server::{AnyServer, FileResponseStream, HTTPStatusText, RangeRequest};
use crate::webcore::blob::store::Data as StoreData;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::{Blob, FetchHeaders, Response};

#[derive(bun_ptr::CellRefCounted)]
pub struct FileRoute {
    ref_count: Cell<u32>,
    server: Cell<Option<AnyServer>>,
    blob: Blob,
    headers: Headers,
    status_code: u16,
    // Mutated on every request (`on()` runs `hash()`) through a shared
    // `&Self`; `StatHash` is small POD with `Default`, so `Cell` +
    // `take()/set()` gives safe read-modify-write on the single-threaded JS
    // event loop.
    stat_hash: Cell<StatHash>,
    has_last_modified_header: bool,
    has_content_length_header: bool,
    has_content_range_header: bool,
    has_date_header: bool,
}

pub struct InitOptions<'a> {
    pub(crate) server: Option<AnyServer>,
    pub(crate) status_code: u16, // default 200
    pub(crate) headers: Option<&'a FetchHeaders>,
}

use crate::webcore::headers_ref::blob_content_type;

#[inline]
fn headers_from(fetch_headers: Option<&FetchHeaders>, blob: &Blob) -> Headers {
    bun_http_jsc::headers_jsc::from_fetch_headers(fetch_headers, blob_content_type(blob))
}

#[inline]
fn sp_slice<'a>(ptr: StringPointer, buf: &'a [u8]) -> &'a [u8] {
    &buf[ptr.offset as usize..][..ptr.length as usize]
}

/// What `FileRoute::serve` left for `on()` to do with the open fd.
enum Serve {
    /// The response is finished; close the fd and complete.
    Done,
    /// Hand the fd to a `FileResponseStream`.
    Stream {
        file_type: FileType,
        pollable: bool,
        offset: u64,
        length: Option<u64>,
    },
}

impl FileRoute {
    /// Exposes the private `server` Cell to the route table (`AnyRoute::set_server`).
    #[inline]
    pub(crate) fn set_server(&self, server: Option<AnyServer>) {
        self.server.set(server);
    }

    pub(crate) fn memory_cost(&self) -> usize {
        size_of::<FileRoute>()
            + self.headers.memory_cost()
            + self.blob.reported_estimated_size.get()
    }

    pub(crate) fn last_modified_date(&self) -> JsResult<Option<u64>> {
        if self.has_last_modified_header {
            if let Some(last_modified) = self.headers.get(b"last-modified") {
                let string = BunString::borrow_utf8(last_modified);
                let global = VirtualMachine::get().as_mut().global();
                let date_f64 = bun_string_jsc::parse_date(&string, global)?;
                if !date_f64.is_nan() && date_f64.is_finite() {
                    return Ok(Some(date_f64 as u64));
                }
            }
        }

        // `Cell::take` then restore — single-threaded event loop, no re-entry
        // reads `stat_hash` between take/set (see field comment).
        let sh = self.stat_hash.take();
        let last_modified_u64 = sh.last_modified_u64;
        self.stat_hash.set(sh);
        if last_modified_u64 > 0 {
            return Ok(Some(last_modified_u64));
        }

        Ok(None)
    }

    fn new(blob: Blob, headers: Headers, server: Option<AnyServer>, status_code: u16) -> FileRoute {
        FileRoute {
            ref_count: Cell::new(1),
            server: Cell::new(server),
            has_last_modified_header: headers.get(b"last-modified").is_some(),
            has_content_length_header: headers.get(b"content-length").is_some(),
            has_content_range_header: headers.get(b"content-range").is_some(),
            has_date_header: headers.get(b"date").is_some(),
            blob,
            headers,
            status_code,
            stat_hash: Cell::new(StatHash::default()),
        }
    }

    pub(crate) fn init_from_blob(blob: Blob, opts: &InitOptions<'_>) -> RefPtr<FileRoute> {
        let headers = headers_from(opts.headers, &blob);
        RefPtr::new(FileRoute::new(blob, headers, opts.server, opts.status_code))
    }

    pub fn from_js(
        global: &JSGlobalObject,
        argument: JSValue,
    ) -> JsResult<Option<RefPtr<FileRoute>>> {
        // `as_class_ref` is the safe shared-borrow downcast (one audited
        // unsafe in `JSValue`); `get_body_value`/`get_init_headers`/
        // `status_code` all take `&self`.
        if let Some(response) = argument.as_class_ref::<Response>() {
            let body_value = response.get_body_value();
            body_value.to_blob_if_possible();
            let needs_read = matches!(body_value, BodyValue::Blob(b) if b.needs_to_read_file());
            if needs_read {
                // `needs_to_read_file()` ⇒ `store` is Some and `data` is `File`.
                let is_fd = matches!(
                    body_value,
                    BodyValue::Blob(b)
                        if matches!(
                            b.store.get().as_ref().unwrap().data,
                            StoreData::File(ref f)
                                if matches!(f.pathlike, PathOrFileDescriptor::Fd(_))
                        )
                );
                if is_fd {
                    return Err(global.throw_todo(
                        b"Support serving files from a file descriptor. Please pass a path instead.",
                    ));
                }

                let blob = body_value.use_();

                blob.global_this.set(std::ptr::from_ref(global));
                debug_assert!(
                    !blob.is_heap_allocated(),
                    "expected blob not to be heap-allocated"
                );
                *body_value = BodyValue::Blob(blob.dupe());
                let headers = headers_from(response.get_init_headers(), &blob);
                let status_code = response.status_code();

                return Ok(Some(RefPtr::new(FileRoute::new(
                    blob,
                    headers,
                    None,
                    status_code,
                ))));
            }
        }
        if let Some(blob) = argument.as_class_ref::<Blob>() {
            if blob.needs_to_read_file() {
                let b = blob.dupe();
                b.global_this.set(std::ptr::from_ref(global));
                debug_assert!(
                    !b.is_heap_allocated(),
                    "expected blob not to be heap-allocated"
                );
                let headers = headers_from(None, &b);
                return Ok(Some(RefPtr::new(FileRoute::new(b, headers, None, 200))));
            }
        }
        Ok(None)
    }

    fn write_headers(&self, resp: AnyResponse) {
        use bun_http_types::ETag::HeaderEntryColumns;
        let entries = self.headers.entries.slice();
        let names: &[StringPointer] = entries.items_name();
        let values: &[StringPointer] = entries.items_value();
        let buf = self.headers.buf.as_slice();

        debug_assert_eq!(names.len(), values.len());
        for (name, value) in names.iter().zip(values) {
            resp.write_header(sp_slice(*name, buf), sp_slice(*value, buf));
        }
        if !matches!(resp, AnyResponse::H3(_)) {
            if let Some(srv) = self.server.get() {
                if let Some(alt) = srv.h3_alt_svc() {
                    resp.write_header(b"alt-svc", alt);
                }
            }
        }

        if !self.has_last_modified_header {
            // `Cell::take` then restore — `write_header` is a sync uWS buffer
            // copy, no re-entry into `stat_hash` between take/set.
            let sh = self.stat_hash.take();
            if let Some(last_modified) = sh.last_modified() {
                resp.write_header(b"last-modified", last_modified);
            }
            self.stat_hash.set(sh);
        }

        if self.has_content_length_header {
            resp.mark_wrote_content_length_header();
        }
    }

    pub(crate) fn on_head_request(this: ThisPtr<FileRoute>, req: AnyRequest, resp: AnyResponse) {
        Self::on(this, req, resp, Method::HEAD);
    }

    pub(crate) fn on_request(this: ThisPtr<FileRoute>, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        Self::on(this, req, resp, method);
    }

    pub(crate) fn on(
        this: ThisPtr<FileRoute>,
        mut req: AnyRequest,
        resp: AnyResponse,
        method: Method,
    ) {
        debug_assert!(this.server.get().is_some());
        // Held until `on_response_complete`; a reload can drop the route
        // table's ref while a `FileResponseStream` is still streaming.
        let route = RefPtr::from_this(this);
        if let Some(server) = route.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        let store = route.blob.store().unwrap().clone();
        let Some(path) = store.get_path() else {
            req.set_yield(true);
            route.on_response_complete(resp);
            return;
        };

        let open_flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NONBLOCK;

        let fd_result: bun_sys::Result<Fd> = {
            #[cfg(windows)]
            {
                let mut path_buffer = bun_paths::PathBuffer::uninit();
                path_buffer[..path.len()].copy_from_slice(path);
                path_buffer[path.len()] = 0;
                bun_sys::open(
                    bun_core::ZStr::from_buf(&path_buffer[..], path.len()),
                    open_flags,
                    0,
                )
            }
            #[cfg(not(windows))]
            {
                bun_sys::open_a(path, open_flags, 0)
            }
        };

        let Ok(fd) = fd_result else {
            req.set_yield(true);
            route.on_response_complete(resp);
            return;
        };

        // Every non-streaming outcome — bodiless status codes
        // (304/204/205/307/308), HEAD, non-streamable files, and the JS-exception
        // early returns — is `Serve::Done`, so neither the fd nor the route ref
        // (or the server's pending_requests counter) can leak regardless of
        // which branch ran.
        match route.serve(fd, path, &mut req, resp, method) {
            Serve::Done => {
                #[cfg(windows)]
                Closer::close(fd, bun_sys::windows::libuv::Loop::get());
                #[cfg(not(windows))]
                Closer::close(fd, ());
                route.on_response_complete(resp);
            }
            Serve::Stream {
                file_type,
                pollable,
                offset,
                length,
            } => {
                let server = route.server.get().unwrap();
                FileResponseStream::start(FileResponseStreamOptions {
                    fd,
                    auto_close: true,
                    resp,
                    vm: bun_ptr::BackRef::new(server.vm()),
                    file_type,
                    pollable,
                    offset,
                    length,
                    idle_timeout: server.config().idle_timeout,
                    owner: StreamOwner::FileRoute(route),
                });
            }
        }
    }

    fn serve(
        &self,
        fd: Fd,
        path: &[u8],
        req: &mut AnyRequest,
        resp: AnyResponse,
        method: Method,
    ) -> Serve {
        let (can_serve_file, offset, size, file_type, pollable) = 'brk: {
            let stat = match bun_sys::fstat(fd) {
                Ok(s) => s,
                // file_type is never read because can_serve_file == false
                Err(_) => break 'brk (false, 0, 0, FileType::File, false),
            };

            let stat_size: u64 = u64::try_from(stat.st_size.max(0)).expect("int cast");
            let offset: u64 = self.blob.offset.get().min(stat_size);
            let size: u64 = self.blob.size.get().min(stat_size - offset);

            let mode = stat.st_mode as bun_sys::Mode;
            if bun_sys::S::ISDIR(mode) {
                break 'brk (false, 0, 0, FileType::File, false);
            }

            // `Cell::take` → mutate → `set`: single-threaded event loop, no
            // re-entry reads `stat_hash` between take/set.
            let mut sh = self.stat_hash.take();
            sh.hash(&stat, path);
            self.stat_hash.set(sh);

            if bun_sys::S::ISFIFO(mode) || bun_sys::S::ISCHR(mode) {
                break 'brk (true, offset, size, FileType::Pipe, true);
            }

            if bun_sys::S::ISSOCK(mode) {
                break 'brk (true, offset, size, FileType::Socket, true);
            }

            break 'brk (true, offset, size, FileType::File, false);
        };

        if !can_serve_file {
            req.set_yield(true);
            return Serve::Done;
        }

        // Range applies to the slice the route was configured with, not the
        // underlying file: a Bun.file(p).slice(a,b) route exposes only [a,b).
        // RFC 9110 §14.2: Range is only defined for GET (HEAD mirrors GET's
        // headers). Skip if the route has a non-200 status or the user already
        // set Content-Range — they're managing partial responses themselves.
        let range: RangeRequest::Result = if (method == Method::GET || method == Method::HEAD)
            && file_type == FileType::File
            && self.status_code == 200
            && !self.has_content_range_header
        {
            RangeRequest::from_request(req, size)
        } else {
            RangeRequest::Result::None
        };

        let etag = self.headers.get(b"etag").filter(|v| !v.is_empty());
        let last_modified_ms = if req.header(b"if-modified-since").is_some()
            || req.header(b"if-unmodified-since").is_some()
        {
            let Ok(lmd) = self.last_modified_date() else {
                return Serve::Done;
            };
            lmd
        } else {
            None
        };
        let status_code =
            status_for_preconditions(req, method, self.status_code, etag, last_modified_ms, range);

        req.set_yield(false);

        write_any_status(resp, status_code);
        if self.has_date_header {
            resp.mark_wrote_date_header();
        }
        resp.write_mark();
        self.write_headers(resp);

        // Bodiless statuses end before the range switch so a 304 emits no
        // Content-Range. FileResponseStream ships via sendfile/write(), so a
        // null-body status must never start it; 307/308 routes skip it too.
        if HTTPStatusText::is_null_body(status_code) || matches!(status_code, 307 | 308) {
            resp.end_without_body(resp.should_close_connection());
            return Serve::Done;
        }
        if status_code == 412 {
            resp.end(b"", resp.should_close_connection());
            return Serve::Done;
        }

        // `None` (read to EOF) is only for pipes and sockets; a file's body is its Content-Length.
        let (body_offset, body_len): (u64, Option<u64>) = match range {
            RangeRequest::Result::Satisfiable { .. } => {
                let (start, len) = write_content_range(resp, range, size).unwrap();
                (offset + start, Some(len))
            }
            RangeRequest::Result::Unsatisfiable => {
                write_content_range(resp, range, size);
                resp.end(b"", resp.should_close_connection());
                return Serve::Done;
            }
            RangeRequest::Result::None => {
                if file_type == FileType::File {
                    (offset, Some(size))
                } else {
                    (0, None)
                }
            }
        };

        if let Some(len) = body_len {
            if !resp.state().has_written_content_length_header() {
                resp.write_header_int(b"content-length", len);
                resp.mark_wrote_content_length_header();
            }
        }

        if method == Method::HEAD {
            resp.end_without_body(resp.should_close_connection());
            return Serve::Done;
        }

        if body_len == Some(0) {
            resp.end(b"", resp.should_close_connection());
            return Serve::Done;
        }

        Serve::Stream {
            file_type,
            pollable,
            offset: body_offset,
            length: body_len,
        }
    }

    /// The last thing a response does with the route; callers then release
    /// the ref `on()` took for it.
    pub(crate) fn on_response_complete(&self, resp: AnyResponse) {
        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        if let Some(server) = self.server.get() {
            server.on_static_request_complete();
        }
    }
}

impl Drop for FileRoute {
    fn drop(&mut self) {
        self.blob.deinit();
    }
}

/// RFC 9110 §13.2.2 precondition evaluation for a GET/HEAD file response.
/// Order: (1) If-Match, else (2) If-Unmodified-Since; then (3) If-None-Match,
/// else (4) If-Modified-Since. Steps 1/2 yield 412 on failure and must run
/// before steps 3/4 can yield 304. Preconditions only apply when the selected
/// representation would otherwise be 200 (§13.1.1).
pub(crate) fn status_for_preconditions(
    req: &AnyRequest,
    method: Method,
    base_status: u16,
    etag: Option<&[u8]>,
    last_modified_ms: Option<u64>,
    range: RangeRequest::Result,
) -> u16 {
    if (method == Method::HEAD || method == Method::GET) && base_status == 200 {
        if let Some(im) = req.header(b"if-match").filter(|v| !v.is_empty()) {
            if !ETag::if_match(etag, im) {
                return 412;
            }
        } else if let Some(ius) = req
            .header(b"if-unmodified-since")
            .and_then(crate::jsc_hooks::parse_http_date)
        {
            if let Some(lm) = last_modified_ms {
                if lm / 1000 > ius / 1000 {
                    return 412;
                }
            }
        }

        if let Some(inm) = req.header(b"if-none-match").filter(|v| !v.is_empty()) {
            let matched = match etag {
                Some(etag) => ETag::if_none_match(etag, inm),
                // No stored ETag: only `*` can match (§13.1.2).
                None => strings::trim(inm, b" \t") == b"*",
            };
            if matched {
                return 304;
            }
            // Did not match: fall through to Range/200 without consulting IMS.
        } else if let Some(ims) = req
            .header(b"if-modified-since")
            .and_then(crate::jsc_hooks::parse_http_date)
        {
            // Compare at second precision: the Last-Modified we emit is
            // second-granular (HTTP-date), so a sub-second mtime would never
            // satisfy `<=` against the client's echoed value otherwise.
            if let Some(lm) = last_modified_ms {
                if lm / 1000 <= ims / 1000 {
                    return 304;
                }
            }
        }
    }

    match range {
        RangeRequest::Result::Unsatisfiable => 416,
        RangeRequest::Result::Satisfiable { .. } => 206,
        RangeRequest::Result::None => base_status,
    }
}

/// Write a 206/416 `Content-Range` header plus `Accept-Ranges: bytes`, and
/// return the `(offset, length)` to stream for a 206, or `None` for 416.
pub(crate) fn write_content_range(
    resp: AnyResponse,
    range: RangeRequest::Result,
    size: u64,
) -> Option<(u64, u64)> {
    let mut crbuf = [0u8; RangeRequest::CONTENT_RANGE_BUF];
    resp.write_header(
        b"content-range",
        RangeRequest::format_content_range(&mut crbuf, range, Some(size)),
    );
    resp.write_header(b"accept-ranges", b"bytes");
    match range {
        RangeRequest::Result::Satisfiable { start, end } => Some((start, end - start + 1)),
        _ => None,
    }
}

pub(crate) fn write_any_status(resp: AnyResponse, status: u16) {
    match resp {
        AnyResponse::SSL(r) => crate::server::write_status::<true>(r, status),
        AnyResponse::TCP(r) => crate::server::write_status::<false>(r, status),
        AnyResponse::H3(_) | AnyResponse::H2(_) => {
            let mut b = bun_core::fmt::ItoaBuf::new();
            resp.write_status(bun_core::fmt::itoa(&mut b, status));
        }
    }
}
