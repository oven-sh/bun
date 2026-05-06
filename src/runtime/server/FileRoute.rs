use core::cell::{Cell, UnsafeCell};
use core::ffi::c_void;
use core::mem::size_of;

use bun_aio::Closer;
use bun_http::headers::Options as HeadersFromOptions;
use bun_http::{Headers, Method};
use bun_http_types::ETag::{HeaderEntryField, StringPointer};
use bun_io::FileType;
use bun_resolver::fs::StatHash;
use bun_str::String as BunString;
use bun_sys::{self, Fd, S};
use bun_uws::{AnyRequest, AnyResponse};

use crate::server::file_response_stream::StartOptions as FileResponseStreamOptions;
use crate::server::jsc::{JSGlobalObject, JSValue, JsResult, VirtualMachine};
use crate::server::{write_status, AnyServer, FileResponseStream, RangeRequest};
use crate::webcore::blob::store::Data as StoreData;
use crate::webcore::node_types::PathOrFileDescriptor;
use crate::webcore::{body, Blob, FetchHeaders, Response};

pub struct FileRoute {
    // PORT NOTE: intrusive RefCount — `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`.
    // Crosses FFI as raw `*mut c_void` userdata into `FileResponseStream`, so
    // `Rc<FileRoute>` is not used; ref/deref are explicit.
    ref_count: Cell<u32>,
    server: Cell<Option<AnyServer>>,
    blob: Blob,
    headers: Headers,
    status_code: u16,
    // Mutated on every request (`on()` runs `hash()`); FileRoute is shared via
    // `&self` from the route table, so wrap for interior mutability. Safe:
    // `on()` is fully synchronous on the single-threaded event loop.
    stat_hash: UnsafeCell<StatHash>,
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

// ─── Headers::from cycle-break adapter ───────────────────────────────────────
// `Headers::from` lives in bun_http (T5) and takes vtable-erased refs because
// it cannot depend on bun_runtime. Reuse the `FetchHeaders` / `AnyBlob` vtables
// from `static_route` and wrap a bare `Blob` as `AnyBlob::Blob` for the body.
fn headers_from_blob(fetch_headers: Option<&FetchHeaders>, blob: &Blob) -> Headers {
    // PORT NOTE: Zig passed `&.{ .Blob = blob }` (an `AnyBlob` literal). Build
    // the wrapper on the stack; `AnyBlobRef` only borrows it for the duration
    // of `Headers::from`. `dupe()` is a shallow refcount-bump clone.
    let any = AnyBlob::Blob(blob.dupe());
    Headers::from(
        fetch_headers.map(fetch_headers_ref),
        HeadersFromOptions { body: Some(any_blob_ref(&any)) },
    )
}

impl FileRoute {
    pub fn last_modified_date(&self) -> JsResult<Option<u64>> {
        if self.has_last_modified_header {
            if let Some(last_modified) = self.headers.get(b"last-modified") {
                let mut string = BunString::init(last_modified);
                // `defer string.deref()` — handled by Drop on bun_str::String.
                // SAFETY: VirtualMachine::get() returns the live per-thread VM;
                // `.global` is set at VM init and valid for VM lifetime.
                let global = unsafe { &*(*VirtualMachine::get()).global };
                let date_f64 = bun_jsc::bun_string_jsc::parse_date(&mut string, global)?;
                if !date_f64.is_nan() && date_f64.is_finite() {
                    return Ok(Some(date_f64 as u64));
                }
            }
        }

        // SAFETY: single-threaded; no concurrent &mut to stat_hash (see field comment).
        let last_modified_u64 = unsafe { (*self.stat_hash.get()).last_modified_u64 };
        if last_modified_u64 > 0 {
            return Ok(Some(last_modified_u64));
        }

        Ok(None)
    }

    pub fn init_from_blob(blob: Blob, opts: InitOptions<'_>) -> *mut FileRoute {
        let headers = headers_from_blob(opts.headers, &blob);
        Box::into_raw(Box::new(FileRoute {
            ref_count: Cell::new(1),
            server: Cell::new(opts.server),
            has_last_modified_header: headers.get(b"last-modified").is_some(),
            has_content_length_header: headers.get(b"content-length").is_some(),
            has_content_range_header: headers.get(b"content-range").is_some(),
            blob,
            headers,
            status_code: opts.status_code,
            stat_hash: UnsafeCell::new(StatHash::default()),
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

    /// Exposes the private `server` Cell to the route table (`AnyRoute::set_server`).
    #[inline]
    pub fn set_server(&self, server: Option<AnyServer>) {
        self.server.set(server);
    }

    pub fn from_js(global: &JSGlobalObject, argument: JSValue) -> JsResult<Option<*mut FileRoute>> {
        if let Some(response_ptr) = argument.as_::<Response>() {
            // SAFETY: non-null per JsClass::from_js contract.
            let response = unsafe { &mut *response_ptr };
            let body_value = response.get_body_value();
            body_value.to_blob_if_possible();
            if let body::Value::Blob(b) = body_value {
                if b.needs_to_read_file() {
                    let is_fd = matches!(
                        &b.store.as_ref().unwrap().data,
                        StoreData::File(f) if matches!(f.pathlike, PathOrFileDescriptor::Fd(_))
                    );
                    if is_fd {
                        return Err(global.throw_todo(
                            "Support serving files from a file descriptor. Please pass a path instead.",
                        ));
                    }

                    let mut blob = body_value.use_();

                    blob.global_this = global as *const _;
                    debug_assert!(!blob.is_heap_allocated(), "expected blob not to be heap-allocated");
                    *body_value = body::Value::Blob(blob.dupe());
                    let headers = headers_from_blob(response.get_init_headers(), &blob);
                    let status_code = response.status_code();

                    return Ok(Some(Box::into_raw(Box::new(FileRoute {
                        ref_count: Cell::new(1),
                        server: Cell::new(None),
                        has_last_modified_header: headers.get(b"last-modified").is_some(),
                        has_content_length_header: headers.get(b"content-length").is_some(),
                        has_content_range_header: headers.get(b"content-range").is_some(),
                        blob,
                        headers,
                        status_code,
                        stat_hash: UnsafeCell::new(StatHash::default()),
                    }))));
                }
            }
        }
        if let Some(blob_ptr) = argument.as_::<Blob>() {
            // SAFETY: non-null per JsClass::from_js contract.
            let blob = unsafe { &*blob_ptr };
            if blob.needs_to_read_file() {
                let mut b = blob.dupe();
                b.global_this = global as *const _;
                debug_assert!(!b.is_heap_allocated(), "expected blob not to be heap-allocated");
                return Ok(Some(Box::into_raw(Box::new(FileRoute {
                    ref_count: Cell::new(1),
                    server: Cell::new(None),
                    headers: headers_from_blob(None, &b),
                    blob: b,
                    has_content_length_header: false,
                    has_last_modified_header: false,
                    has_content_range_header: false,
                    status_code: 200,
                    stat_hash: UnsafeCell::new(StatHash::default()),
                }))));
            }
        }
        Ok(None)
    }

    fn write_headers(&self, resp: AnyResponse) {
        let entries = self.headers.entries.slice();
        // SAFETY: HeaderEntry stores two StringPointer columns; field tag matches type.
        let names: &[StringPointer] =
            unsafe { entries.items::<StringPointer>(HeaderEntryField::Name) };
        let values: &[StringPointer] =
            unsafe { entries.items::<StringPointer>(HeaderEntryField::Value) };
        let buf = self.headers.buf.as_slice();

        debug_assert_eq!(names.len(), values.len());
        // PORT NOTE: Zig `switch (resp) { inline else => |s, tag| { ... } }` expanded per-variant.
        match resp {
            AnyResponse::SSL(s) => {
                // SAFETY: AnyResponse stores a live FFI handle valid while the caller holds it.
                let s = unsafe { &mut *s };
                for (name, value) in names.iter().zip(values) {
                    s.write_header(sp_slice(name, buf), sp_slice(value, buf));
                }
                if let Some(srv) = self.server.get() {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::TCP(s) => {
                // SAFETY: see above.
                let s = unsafe { &mut *s };
                for (name, value) in names.iter().zip(values) {
                    s.write_header(sp_slice(name, buf), sp_slice(value, buf));
                }
                if let Some(srv) = self.server.get() {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::H3(s) => {
                // SAFETY: see above.
                let s = unsafe { &mut *s };
                for (name, value) in names.iter().zip(values) {
                    s.write_header(sp_slice(name, buf), sp_slice(value, buf));
                }
                // tag == .H3 → no alt-svc header
            }
        }

        if !self.has_last_modified_header {
            // SAFETY: single-threaded; no concurrent &mut (see field comment).
            if let Some(last_modified) = unsafe { (*self.stat_hash.get()).last_modified() } {
                resp.write_header(b"last-modified", last_modified);
            }
        }

        if self.has_content_length_header {
            resp.mark_wrote_content_length_header();
        }
    }

    fn write_status_code(&self, status: u16, resp: AnyResponse) {
        match resp {
            AnyResponse::SSL(r) => write_status::<true>(r, status),
            AnyResponse::TCP(r) => write_status::<false>(r, status),
            AnyResponse::H3(r) => {
                let mut b = [0u8; 16];
                let written = {
                    use std::io::Write;
                    let mut w = &mut b[..];
                    write!(w, "{}", status).expect("unreachable");
                    16 - w.len()
                };
                // SAFETY: AnyResponse stores a live FFI handle valid while the caller holds it.
                unsafe { (*r).write_status(&b[..written]) };
            }
        }
    }

    pub fn on_head_request(&self, req: AnyRequest, resp: AnyResponse) {
        debug_assert!(self.server.get().is_some());

        self.on(req, resp, Method::HEAD);
    }

    pub fn on_request(&self, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        self.on(req, resp, method);
    }

    pub fn on(&self, mut req: AnyRequest, resp: AnyResponse, method: Method) {
        debug_assert!(self.server.get().is_some());
        // FileRoute is heap-allocated with intrusive RC; `on_response_complete`
        // (reached from the defer-guard or the stream callbacks) may free it.
        // Derive the raw pointer once and route all later self-access through
        // it to keep a single provenance chain.
        let this: *const FileRoute = self;
        FileRoute::ref_(this);
        if let Some(mut server) = self.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        // PORT NOTE: clone the path to break the shared borrow on `self.blob`
        // so the borrow into `stat_hash.hash()` below doesn't conflict (Zig had
        // no borrowck here). // PERF(port): was zero-copy slice — profile in Phase B.
        let path_buf: Vec<u8> = match self.blob.store.as_ref().unwrap().get_path() {
            Some(p) => p.to_vec(),
            None => {
                req.set_yield(true);
                FileRoute::on_response_complete(this, resp);
                return;
            }
        };
        let path: &[u8] = path_buf.as_slice();

        let open_flags = bun_sys::O::RDONLY | bun_sys::O::CLOEXEC | bun_sys::O::NONBLOCK;

        let fd_result: bun_sys::Result<Fd> = {
            #[cfg(windows)]
            {
                let mut path_buffer = bun_paths::PathBuffer::default();
                path_buffer.0[..path.len()].copy_from_slice(path);
                path_buffer.0[path.len()] = 0;
                bun_sys::open(
                    // SAFETY: path_buffer[path.len()] == 0 written above
                    unsafe { bun_str::ZStr::from_raw(path_buffer.0.as_ptr(), path.len()) },
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
            FileRoute::on_response_complete(this, resp);
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
        let mut fd_guard = scopeguard::guard(true, move |owned| {
            if owned {
                #[cfg(windows)]
                Closer::close(fd, bun_sys::windows::libuv::Loop::get());
                #[cfg(not(windows))]
                Closer::close(fd, ());
                // SAFETY: `this` is valid; ref taken above keeps FileRoute alive
                // until on_response_complete (which releases that ref).
                FileRoute::on_response_complete(this, resp);
            }
        });

        // TODO: properly propagate exception upwards (Zig `catch return`).
        // Rust `date_for_header` swallows parse errors via the hook → `None`.
        let input_if_modified_since_date: Option<u64> = req.date_for_header(b"if-modified-since");

        let (can_serve_file, size, file_type, pollable): (bool, u64, FileType, bool) = 'brk: {
            let stat = match bun_sys::fstat(fd) {
                Ok(s) => s,
                // PORT NOTE: file_type is `undefined` in Zig here; never read because can_serve_file == false
                Err(_) => break 'brk (false, 0, FileType::File, false),
            };

            let stat_size: u64 = u64::try_from(stat.st_size.max(0)).unwrap();
            let _size: u64 = stat_size.min(self.blob.size);

            let mode = stat.st_mode;
            if S::ISDIR(mode as _) {
                break 'brk (false, 0, FileType::File, false);
            }

            // SAFETY: single-threaded event loop; no concurrent borrow of stat_hash.
            unsafe { (*self.stat_hash.get()).hash(&stat, path) };

            if S::ISFIFO(mode as _) || S::ISCHR(mode as _) {
                break 'brk (true, _size, FileType::Pipe, true);
            }

            if S::ISSOCK(mode as _) {
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
            RangeRequest::from_request(&req, size)
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
            if matches!(range, RangeRequest::Result::Satisfiable { .. }) {
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
            RangeRequest::Result::Satisfiable { start, end } => {
                let mut crbuf = [0u8; 96];
                let written = {
                    use std::io::Write;
                    let mut w = &mut crbuf[..];
                    write!(w, "bytes {}-{}/{}", start, end, size).expect("unreachable");
                    96 - w.len()
                };
                resp.write_header(b"content-range", &crbuf[..written]);
                resp.write_header(b"accept-ranges", b"bytes");
                (self.blob.offset + start, Some(end - start + 1))
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
        FileResponseStream::start(FileResponseStreamOptions {
            fd,
            auto_close: true,
            resp,
            vm: self.server.get().unwrap().vm(),
            file_type,
            pollable,
            offset: body_offset,
            length: body_len,
            idle_timeout: self.server.get().unwrap().config().idle_timeout,
            ctx: this as *mut c_void,
            on_complete: on_stream_complete,
            on_abort: None,
            on_error: on_stream_error,
        });
    }

    fn on_response_complete(this: *const FileRoute, resp: AnyResponse) {
        resp.clear_aborted();
        resp.clear_on_writable();
        resp.clear_timeout();
        // SAFETY: `this` is a live heap-allocated FileRoute (ref held by caller).
        if let Some(mut server) = unsafe { (*this).server.get() } {
            server.on_static_request_complete();
        }
        FileRoute::deref(this);
    }
}

#[inline]
fn sp_slice<'a>(ptr: &StringPointer, buf: &'a [u8]) -> &'a [u8] {
    &buf[ptr.offset as usize..][..ptr.length as usize]
}

fn on_stream_complete(ctx: *mut c_void, resp: AnyResponse) {
    FileRoute::on_response_complete(ctx as *const FileRoute, resp);
}

fn on_stream_error(ctx: *mut c_void, resp: AnyResponse, _err: bun_sys::Error) {
    FileRoute::on_response_complete(ctx as *const FileRoute, resp);
}

// Intrusive refcount: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`
impl FileRoute {
    pub fn ref_(this: *const FileRoute) {
        // SAFETY: `this` is a live heap-allocated FileRoute.
        let rc = unsafe { &(*this).ref_count };
        rc.set(rc.get() + 1);
    }

    pub fn deref(this: *const FileRoute) {
        // SAFETY: `this` is a live heap-allocated FileRoute.
        let rc = unsafe { &(*this).ref_count };
        let n = rc.get() - 1;
        rc.set(n);
        if n == 0 {
            FileRoute::deinit(this as *mut FileRoute);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/FileRoute.zig (390 lines)
//   confidence: medium
//   notes:      stat_hash interior-mutable via UnsafeCell; path cloned for borrowck
// ──────────────────────────────────────────────────────────────────────────
