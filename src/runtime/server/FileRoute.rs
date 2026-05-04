use core::cell::Cell;
use core::ffi::c_void;
use core::mem::size_of;

use bun_aio::Closer;
use bun_fs::StatHash;
use bun_http::{Headers, Method};
use bun_io::FileType;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, VirtualMachine};
use bun_runtime::api::server::{write_status, AnyServer, FileResponseStream, RangeRequest};
use bun_runtime::webcore::{Blob, FetchHeaders, Response};
use bun_str::String as BunString;
use bun_sys::{self, Fd};
use bun_uws::{AnyRequest, AnyResponse};

pub struct FileRoute {
    ref_count: Cell<u32>, // intrusive refcount (see bun_ptr::IntrusiveRc below)
    server: Option<AnyServer>,
    blob: Blob,
    headers: Headers,
    status_code: u16,
    stat_hash: StatHash,
    has_last_modified_header: bool,
    has_content_length_header: bool,
    has_content_range_header: bool,
}

pub struct InitOptions<'a> {
    pub server: Option<AnyServer>,
    pub status_code: u16, // default 200
    pub headers: Option<&'a FetchHeaders>,
}

impl<'a> Default for InitOptions<'a> {
    fn default() -> Self {
        Self { server: None, status_code: 200, headers: None }
    }
}

impl FileRoute {
    pub fn last_modified_date(&self) -> JsResult<Option<u64>> {
        if self.has_last_modified_header {
            if let Some(last_modified) = self.headers.get(b"last-modified") {
                let string = BunString::init(last_modified);
                // `defer string.deref()` — handled by Drop on bun_str::String
                let date_f64 = string.parse_date(VirtualMachine::get().global())?;
                if !date_f64.is_nan() && date_f64.is_finite() {
                    return Ok(Some(date_f64 as u64));
                }
            }
        }

        if self.stat_hash.last_modified_u64 > 0 {
            return Ok(Some(self.stat_hash.last_modified_u64));
        }

        Ok(None)
    }

    pub fn init_from_blob(blob: Blob, opts: InitOptions<'_>) -> *mut FileRoute {
        // TODO(port): Headers::from body argument shape (`&.{ .Blob = blob }`) — verify Rust API in Phase B
        let headers = Headers::from(opts.headers, /* body = */ &blob);
        Box::into_raw(Box::new(FileRoute {
            ref_count: Cell::new(1),
            server: opts.server,
            has_last_modified_header: headers.get(b"last-modified").is_some(),
            has_content_length_header: headers.get(b"content-length").is_some(),
            has_content_range_header: headers.get(b"content-range").is_some(),
            blob,
            headers,
            status_code: opts.status_code,
            stat_hash: StatHash::default(),
        }))
    }

    fn deinit(this: *mut FileRoute) {
        // blob and headers are owned fields — freed by Drop when the Box is dropped.
        // SAFETY: `this` was allocated via Box::into_raw in init_from_blob/from_js and the
        // intrusive ref_count has reached 0.
        unsafe { drop(Box::from_raw(this)) }
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<FileRoute>() + self.headers.memory_cost() + self.blob.reported_estimated_size
    }

    pub fn from_js(global: &JSGlobalObject, argument: JSValue) -> JsResult<Option<*mut FileRoute>> {
        if let Some(response) = argument.as_::<Response>() {
            let body_value = response.get_body_value();
            body_value.to_blob_if_possible();
            // TODO(port): Body.Value tag/payload access — verify exact Rust enum API in Phase B
            if body_value.is_blob() && body_value.as_blob().needs_to_read_file() {
                if body_value.as_blob().store.as_ref().unwrap().data.file().pathlike.is_fd() {
                    return global.throw_todo(
                        "Support serving files from a file descriptor. Please pass a path instead.",
                    );
                }

                let mut blob = body_value.use_();

                blob.global_this = global;
                debug_assert!(!blob.is_heap_allocated(), "expected blob not to be heap-allocated");
                *body_value = bun_runtime::webcore::body::Value::blob(blob.dupe());
                let headers = Headers::from(response.get_init_headers(), /* body = */ &blob);

                return Ok(Some(Box::into_raw(Box::new(FileRoute {
                    ref_count: Cell::new(1),
                    server: None,
                    has_last_modified_header: headers.get(b"last-modified").is_some(),
                    has_content_length_header: headers.get(b"content-length").is_some(),
                    has_content_range_header: headers.get(b"content-range").is_some(),
                    blob,
                    headers,
                    status_code: response.status_code(),
                    stat_hash: StatHash::default(),
                }))));
            }
        }
        if let Some(blob) = argument.as_::<Blob>() {
            if blob.needs_to_read_file() {
                let mut b = blob.dupe();
                b.global_this = global;
                debug_assert!(!b.is_heap_allocated(), "expected blob not to be heap-allocated");
                return Ok(Some(Box::into_raw(Box::new(FileRoute {
                    ref_count: Cell::new(1),
                    server: None,
                    headers: Headers::from(None, /* body = */ &b),
                    blob: b,
                    has_content_length_header: false,
                    has_last_modified_header: false,
                    has_content_range_header: false,
                    status_code: 200,
                    stat_hash: StatHash::default(),
                }))));
            }
        }
        Ok(None)
    }

    fn write_headers(&self, resp: AnyResponse) {
        let entries = self.headers.entries.slice();
        let names = entries.items_name();
        let values = entries.items_value();
        let buf = self.headers.buf.as_slice();

        debug_assert_eq!(names.len(), values.len());
        // PORT NOTE: Zig `switch (resp) { inline else => |s, tag| { ... } }` expanded per-variant.
        match resp {
            AnyResponse::Ssl(s) => {
                for (name, value) in names.iter().zip(values) {
                    s.write_header(name.slice(buf), value.slice(buf));
                }
                if let Some(srv) = self.server {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::Tcp(s) => {
                for (name, value) in names.iter().zip(values) {
                    s.write_header(name.slice(buf), value.slice(buf));
                }
                if let Some(srv) = self.server {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::H3(s) => {
                for (name, value) in names.iter().zip(values) {
                    s.write_header(name.slice(buf), value.slice(buf));
                }
                // tag == .H3 → no alt-svc header
            }
        }

        if !self.has_last_modified_header {
            if let Some(last_modified) = self.stat_hash.last_modified() {
                resp.write_header(b"last-modified", last_modified);
            }
        }

        if self.has_content_length_header {
            resp.mark_wrote_content_length_header();
        }
    }

    fn write_status_code(&self, status: u16, resp: AnyResponse) {
        match resp {
            AnyResponse::Ssl(r) => write_status::<true>(r, status),
            AnyResponse::Tcp(r) => write_status::<false>(r, status),
            AnyResponse::H3(r) => {
                let mut b = [0u8; 16];
                let written = {
                    use std::io::Write;
                    let mut w = &mut b[..];
                    write!(w, "{}", status).expect("unreachable");
                    16 - w.len()
                };
                r.write_status(&b[..written]);
            }
        }
    }

    pub fn on_head_request(&mut self, req: AnyRequest, resp: AnyResponse) {
        debug_assert!(self.server.is_some());

        self.on(req, resp, Method::HEAD);
    }

    pub fn on_request(&mut self, req: AnyRequest, resp: AnyResponse) {
        self.on(req, resp, Method::find(req.method()).unwrap_or(Method::GET));
    }

    pub fn on(&mut self, req: AnyRequest, resp: AnyResponse, method: Method) {
        debug_assert!(self.server.is_some());
        self.ref_();
        if let Some(server) = self.server {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        let Some(path) = self.blob.store.as_ref().unwrap().get_path() else {
            req.set_yield(true);
            self.on_response_complete(resp);
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
                    // SAFETY: path_buffer[path.len()] == 0 written above
                    unsafe { bun_str::ZStr::from_raw(path_buffer.as_ptr(), path.len()) },
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
            self.on_response_complete(resp);
            return;
        };

        // `fd_owned` tracks whether this function is still responsible for
        // closing the file descriptor and releasing the route ref. Every
        // non-streaming return — bodiless status codes (304/204/205/307/308),
        // HEAD, non-streamable files, and the two JS-exception `catch return`
        // paths below — hits this defer, so neither the fd nor the route ref
        // (or the server's pending_requests counter) can leak regardless of
        // which branch runs. The streaming path clears `fd_owned` right
        // before handing ownership to `FileResponseStream`.
        // PORT NOTE: capturing `self` as raw ptr because this is an intrusive-refcounted heap
        // object and the guard outlives later `&mut self` borrows. Ref held at top of on().
        let this_ptr: *mut FileRoute = self;
        let mut fd_guard = scopeguard::guard(true, move |owned| {
            if owned {
                #[cfg(windows)]
                Closer::close(fd, bun_sys::windows::libuv::Loop::get());
                #[cfg(not(windows))]
                Closer::close(fd);
                // SAFETY: this_ptr is valid; ref taken above keeps FileRoute alive until on_response_complete
                unsafe { (*this_ptr).on_response_complete(resp) };
            }
        });
        // TODO(port): defer-guard captures &mut self via raw ptr — Phase B should verify borrowck reshaping

        let Ok(input_if_modified_since_date): JsResult<Option<u64>> =
            req.date_for_header(b"if-modified-since")
        else {
            return;
        }; // TODO: properly propagate exception upwards

        let (can_serve_file, size, file_type, pollable): (bool, u64, FileType, bool) = 'brk: {
            let stat = match bun_sys::fstat(fd) {
                Ok(s) => s,
                // PORT NOTE: file_type is `undefined` in Zig here; never read because can_serve_file == false
                Err(_) => break 'brk (false, 0, FileType::File, false),
            };

            let stat_size: u64 = u64::try_from(stat.size.max(0)).unwrap();
            let _size: u64 = stat_size.min(self.blob.size as u64);

            let mode = u32::try_from(stat.mode).unwrap();
            if bun_sys::S::isdir(mode) {
                break 'brk (false, 0, FileType::File, false);
            }

            self.stat_hash.hash(&stat, path);

            if bun_sys::S::isfifo(mode) || bun_sys::S::ischr(mode) {
                break 'brk (true, _size, FileType::Pipe, true);
            }

            if bun_sys::S::issock(mode) {
                break 'brk (true, _size, FileType::Socket, true);
            }

            break 'brk (true, _size, FileType::File, false);
        };

        if !can_serve_file {
            req.set_yield(true);
            return;
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

        let status_code: u16 = 'brk: {
            // RFC 9110 §13.2.2: conditional preconditions are evaluated before
            // Range. If-Modified-Since on an unmodified resource yields 304 even
            // when a Range header is present (without If-Range).
            // Unlike If-Unmodified-Since, If-Modified-Since can only be used with a
            // GET or HEAD. When used in combination with If-None-Match, it is
            // ignored, unless the server doesn't support If-None-Match.
            if let Some(requested_if_modified_since) = input_if_modified_since_date {
                if method == Method::HEAD || method == Method::GET {
                    let Ok(lmd) = self.last_modified_date() else { return }; // TODO: properly propagate exception upwards
                    if let Some(actual_last_modified_at) = lmd {
                        // Compare at second precision: the Last-Modified header we
                        // emit is second-granular (HTTP-date), so a sub-second
                        // mtime would otherwise never satisfy `<=` against the
                        // client's echoed value.
                        if actual_last_modified_at / 1000 <= requested_if_modified_since / 1000 {
                            break 'brk 304;
                        }
                    }
                }
            }

            if matches!(range, RangeRequest::Result::Unsatisfiable) {
                break 'brk 416;
            }
            if matches!(range, RangeRequest::Result::Satisfiable(_)) {
                break 'brk 206;
            }

            if size == 0 && file_type == FileType::File && self.status_code == 200 {
                break 'brk 204;
            }

            self.status_code
        };

        req.set_yield(false);

        self.write_status_code(status_code, resp);
        resp.write_mark();
        self.write_headers(resp);

        // Bodiless statuses end here — before the range switch, so a 304 (which
        // can win over a satisfiable Range per RFC 9110 §13.2.2) doesn't emit
        // Content-Range.
        match status_code {
            204 | 205 | 304 | 307 | 308 => {
                resp.end_without_body(resp.should_close_connection());
                return;
            }
            _ => {}
        }

        let (body_offset, body_len): (u64, Option<u64>) = match range {
            RangeRequest::Result::Satisfiable(r) => {
                let mut crbuf = [0u8; 96];
                let written = {
                    use std::io::Write;
                    let mut w = &mut crbuf[..];
                    write!(w, "bytes {}-{}/{}", r.start, r.end, size).expect("unreachable");
                    96 - w.len()
                };
                resp.write_header(b"content-range", &crbuf[..written]);
                resp.write_header(b"accept-ranges", b"bytes");
                (self.blob.offset + r.start, Some(r.end - r.start + 1))
            }
            RangeRequest::Result::Unsatisfiable => {
                let mut crbuf = [0u8; 64];
                let written = {
                    use std::io::Write;
                    let mut w = &mut crbuf[..];
                    write!(w, "bytes */{}", size).expect("unreachable");
                    64 - w.len()
                };
                resp.write_header(b"content-range", &crbuf[..written]);
                resp.write_header(b"accept-ranges", b"bytes");
                resp.end(b"", resp.should_close_connection());
                return;
            }
            RangeRequest::Result::None => (
                if file_type == FileType::File { self.blob.offset } else { 0 },
                if file_type == FileType::File && self.blob.size > 0 {
                    Some(size)
                } else {
                    None
                },
            ),
        };

        if file_type == FileType::File && !resp.state().has_written_content_length_header() {
            resp.write_header_int(b"content-length", body_len.unwrap_or(size));
            resp.mark_wrote_content_length_header();
        }

        if method == Method::HEAD {
            resp.end_without_body(resp.should_close_connection());
            return;
        }

        // Hand ownership of the fd to FileResponseStream; disable the defer close.
        // The route ref taken at the top of on() is released in on_stream_complete.
        *fd_guard = false;
        FileResponseStream::start(FileResponseStream::Options {
            fd,
            auto_close: true,
            resp,
            vm: self.server.unwrap().vm(),
            file_type,
            pollable,
            offset: body_offset,
            length: body_len,
            idle_timeout: self.server.unwrap().config().idle_timeout,
            ctx: self as *mut FileRoute as *mut c_void,
            on_complete: on_stream_complete,
            on_error: on_stream_error,
        });
    }

    fn on_response_complete(&mut self, resp: AnyResponse) {
        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        if let Some(server) = self.server {
            server.on_static_request_complete();
        }
        self.deref();
    }
}

fn on_stream_complete(ctx: *mut c_void, resp: AnyResponse) {
    // SAFETY: ctx was passed as `*mut FileRoute` to FileResponseStream::start
    let this = unsafe { &mut *(ctx as *mut FileRoute) };
    this.on_response_complete(resp);
}

fn on_stream_error(ctx: *mut c_void, resp: AnyResponse, _err: bun_sys::Error) {
    // SAFETY: ctx was passed as `*mut FileRoute` to FileResponseStream::start
    let this = unsafe { &mut *(ctx as *mut FileRoute) };
    this.on_response_complete(resp);
}

// Intrusive refcount: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`
// Macro provides `ref_()` / `deref()` over the embedded `ref_count: Cell<u32>`.
// TODO(port): `ref` is a Rust keyword — using `ref_`; wire to bun_ptr::IntrusiveRc<FileRoute> in Phase B
bun_ptr::intrusive_rc!(FileRoute, ref_count, FileRoute::deinit);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/FileRoute.zig (390 lines)
//   confidence: medium
//   todos:      4
//   notes:      defer-guard in on() captures self via raw ptr (intrusive RC); Headers::from / Body.Value enum APIs guessed; RangeRequest::Result path syntax needs Phase B fix
// ──────────────────────────────────────────────────────────────────────────
