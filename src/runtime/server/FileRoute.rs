use core::cell::{Cell, UnsafeCell};
use core::ffi::c_void;
use core::mem::size_of;

use bun_aio::Closer;
use bun_http::headers::{AnyBlobRef, AnyBlobVTable, Options as HeadersFromOptions};
use bun_http::{Headers, HeadersExt, Method};
use bun_http_types::ETag::{StringPointer};
use bun_io::FileType;
use bun_resolver::fs::StatHash;
use bun_str::String as BunString;
use bun_sys::{self, Fd};
use bun_uws::{AnyRequest, AnyResponse};

use crate::node::types::PathOrFileDescriptor;
use crate::server::file_response_stream::StartOptions as FileResponseStreamOptions;
use crate::server::jsc::{JSGlobalObject, JSValue, JsResult, VirtualMachine};

use crate::server::{write_status, AnyServer, FileResponseStream, RangeRequest};
use crate::webcore::blob::store::Data as StoreData;
use crate::webcore::BlobExt as _;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::{Blob, FetchHeaders, Response};

pub struct FileRoute {
    // PORT NOTE (§Pointers Rc/Arc default): owned via intrusive refcount; the
    // raw `*mut FileRoute` is round-tripped through `FileResponseStream`'s
    // `ctx: *mut c_void` userdata, so `Rc<FileRoute>` is unsuitable. See
    // StaticRoute.rs note re: FFI userdata fallback to RefPtr.
    ref_count: Cell<u32>,
    server: Cell<Option<AnyServer>>,
    blob: Blob,
    headers: Headers,
    status_code: u16,
    // Mutated on every request (`on()` runs `hash()`); FileRoute is reached via
    // a shared `*const Self` from the route table, so wrap for interior
    // mutability. Sound: `on()` runs to completion synchronously on the
    // single-threaded JS event loop — no overlapping `&mut StatHash`.
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

// ─── cycle-break vtables: FetchHeaders/Blob → bun_http::headers refs ─────────
// `Headers::from` (T5 bun_http) takes vtable-erased refs because it cannot
// name `webcore::FetchHeaders`/`Blob` (T6). The Zig call site passes the
// concrete types directly; here we erase them through the vtable.

unsafe fn fh_count(owner: *const (), header_count: &mut u32, buf_len: &mut u32) {
    // SAFETY: `owner` is `&FetchHeaders` erased; `count` mutates only internal
    // scratch state on the C++ side, hence the const→mut cast.
    unsafe { (*owner.cast::<FetchHeaders>().cast_mut()).count(header_count, buf_len) }
}
unsafe fn fh_fast_has(owner: *const (), name: bun_http::headers::HeaderName) -> bool {
    // SAFETY: see `fh_count`. `bun_http::headers::HeaderName` re-exports
    // `bun_http_types::Method::HeaderName`, which is `#[repr(u8)]` with
    // discriminants identical to `bun_jsc::HTTPHeaderName` (both mirror
    // WebCore's `HTTPHeaderNames.in`); `fast_has_` takes the raw `u8`.
    unsafe { (*owner.cast::<FetchHeaders>().cast_mut()).fast_has_(name as u8) }
}
unsafe fn fh_copy_to(
    owner: *const (),
    names: *mut StringPointer,
    values: *mut StringPointer,
    buf: *mut u8,
) {
    // SAFETY: see `fh_count`. `bun_http::headers::api::StringPointer` and
    // `bun_jsc`'s `StringPointer` param are the same `bun_core::StringPointer`.
    unsafe { (*owner.cast::<FetchHeaders>().cast_mut()).copy_to(names, values, buf) }
}

static FETCH_HEADERS_VTABLE: bun_http::headers::FetchHeadersVTable =
    bun_http::headers::FetchHeadersVTable {
        count: fh_count,
        fast_has: fh_fast_has,
        copy_to: fh_copy_to,
    };

#[inline]
fn fetch_headers_ref(h: &FetchHeaders) -> bun_http::headers::FetchHeadersRef<'_> {
    bun_http::headers::FetchHeadersRef {
        owner: std::ptr::from_ref::<FetchHeaders>(h).cast::<()>(),
        vtable: &FETCH_HEADERS_VTABLE,
        _phantom: core::marker::PhantomData,
    }
}

// The Zig call site wraps the blob in a stack-temporary `&.{ .Blob = blob }`
// (an `AnyBlob`); here we erase `&Blob` directly — `Any::content_type`/
// `Any::has_content_type_from_user` for the `.Blob` arm just forward to the
// same Blob methods.

unsafe fn blob_has_content_type_from_user(owner: *const ()) -> bool {
    // SAFETY: `owner` is `&Blob` erased via `blob_body_ref`.
    unsafe { (*owner.cast::<Blob>()).has_content_type_from_user() }
}
unsafe fn blob_content_type(owner: *const ()) -> (*const u8, usize) {
    // SAFETY: `owner` is `&Blob` erased; the returned slice borrows blob
    // storage that outlives the `AnyBlobRef`.
    let s = unsafe { (*owner.cast::<Blob>()).content_type_slice() };
    (s.as_ptr(), s.len())
}

static BLOB_BODY_VTABLE: AnyBlobVTable = AnyBlobVTable {
    has_content_type_from_user: blob_has_content_type_from_user,
    content_type: blob_content_type,
};

#[inline]
fn blob_body_ref(b: &Blob) -> AnyBlobRef<'_> {
    AnyBlobRef {
        owner: std::ptr::from_ref::<Blob>(b).cast::<()>(),
        vtable: &BLOB_BODY_VTABLE,
        _phantom: core::marker::PhantomData,
    }
}

#[inline]
fn headers_from(fetch_headers: Option<&FetchHeaders>, blob: &Blob) -> Headers {
    // UFCS: bare `Headers::from` resolves to prelude `core::convert::From::from`;
    // the two-arg vtable constructor lives on `HeadersExt`.
    <Headers as HeadersExt>::from(
        fetch_headers.map(fetch_headers_ref),
        HeadersFromOptions { body: Some(blob_body_ref(blob)) },
    )
}

#[inline]
fn sp_slice<'a>(ptr: &StringPointer, buf: &'a [u8]) -> &'a [u8] {
    &buf[ptr.offset as usize..][..ptr.length as usize]
}

impl FileRoute {
    /// Exposes the private `server` Cell to the route table (`AnyRoute::set_server`).
    #[inline]
    pub fn set_server(&self, server: Option<AnyServer>) {
        self.server.set(server);
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<FileRoute>() + self.headers.memory_cost() + self.blob.reported_estimated_size
    }

    pub fn last_modified_date(&self) -> JsResult<Option<u64>> {
        if self.has_last_modified_header {
            if let Some(last_modified) = self.headers.get(b"last-modified") {
                let mut string = BunString::borrow_utf8(last_modified);
                // `defer string.deref()` — handled by Drop on bun_str::String
                // SAFETY: `VirtualMachine::get()` returns the live per-thread
                // singleton; FileRoute is only ever reached from a server
                // request callback on the JS thread.
                let global = VirtualMachine::get().as_mut().global();
                let date_f64 = bun_jsc::bun_string_jsc::parse_date(&mut string, global)?;
                if !date_f64.is_nan() && date_f64.is_finite() {
                    return Ok(Some(date_f64 as u64));
                }
            }
        }

        // SAFETY: single-threaded event loop; no concurrent &mut to stat_hash
        // (see field comment).
        let last_modified_u64 = unsafe { (*self.stat_hash.get()).last_modified_u64 };
        if last_modified_u64 > 0 {
            return Ok(Some(last_modified_u64));
        }

        Ok(None)
    }

    pub fn init_from_blob(blob: Blob, opts: InitOptions<'_>) -> *mut FileRoute {
        let headers = headers_from(opts.headers, &blob);
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

    pub fn from_js(global: &JSGlobalObject, argument: JSValue) -> JsResult<Option<*mut FileRoute>> {
        if let Some(response_ptr) = argument.as_::<Response>() {
            // SAFETY: non-null per JsClass::from_js contract.
            let response = unsafe { &mut *response_ptr };
            let body_value = response.get_body_value();
            body_value.to_blob_if_possible();
            let needs_read = matches!(body_value, BodyValue::Blob(b) if b.needs_to_read_file());
            if needs_read {
                // `needs_to_read_file()` ⇒ `store` is Some and `data` is `File`.
                let is_fd = matches!(
                    body_value,
                    BodyValue::Blob(b)
                        if matches!(
                            b.store.as_ref().unwrap().data,
                            StoreData::File(ref f)
                                if matches!(f.pathlike, PathOrFileDescriptor::Fd(_))
                        )
                );
                if is_fd {
                    return Err(global.throw_todo(
                        b"Support serving files from a file descriptor. Please pass a path instead.",
                    ));
                }

                let mut blob = body_value.use_();

                blob.global_this = std::ptr::from_ref(global);
                debug_assert!(!blob.is_heap_allocated(), "expected blob not to be heap-allocated");
                *body_value = BodyValue::Blob(blob.dupe());
                let headers = headers_from(response.get_init_headers(), &blob);
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
        if let Some(blob_ptr) = argument.as_::<Blob>() {
            // SAFETY: non-null per JsClass::from_js contract.
            let blob = unsafe { &*blob_ptr };
            if blob.needs_to_read_file() {
                let mut b = blob.dupe();
                b.global_this = std::ptr::from_ref(global);
                debug_assert!(!b.is_heap_allocated(), "expected blob not to be heap-allocated");
                let headers = headers_from(None, &b);
                return Ok(Some(Box::into_raw(Box::new(FileRoute {
                    ref_count: Cell::new(1),
                    server: Cell::new(None),
                    headers,
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
            unsafe { entries.items::<"name", StringPointer>() };
        let values: &[StringPointer] =
            unsafe { entries.items::<"value", StringPointer>() };
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
            // SAFETY: single-threaded event loop; no concurrent &mut to
            // stat_hash (see field comment).
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

    pub fn on_head_request(this: *mut FileRoute, req: AnyRequest, resp: AnyResponse) {
        // SAFETY: `this` is a live heap FileRoute (intrusive ref held by the route table).
        debug_assert!(unsafe { (*this).server.get() }.is_some());

        Self::on(this, req, resp, Method::HEAD);
    }

    pub fn on_request(this: *mut FileRoute, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        Self::on(this, req, resp, method);
    }

    // PORT NOTE: takes `*mut FileRoute` (not `&self`) because the
    // intrusive-refcounted heap object is captured raw into a `scopeguard`
    // whose closure may free `*this` via `deref()` before the local `&Self`
    // borrow lexically ends. Derive a single `&FileRoute` for all field reads;
    // the only per-request mutation (`stat_hash.hash`) goes through
    // `UnsafeCell`, so no `&mut Self` is ever materialized and the shared
    // borrow stays valid under Stacked Borrows across that write.
    pub fn on(this_ptr: *mut FileRoute, mut req: AnyRequest, resp: AnyResponse, method: Method) {
        // SAFETY: `this_ptr` is a live heap FileRoute for the duration of this
        // fn body — the `ref_()` taken below keeps it alive until
        // `on_response_complete`. All mutation through `this` goes via
        // `Cell`/`UnsafeCell`, so the shared borrow is sound.
        let this = unsafe { &*this_ptr };
        debug_assert!(this.server.get().is_some());
        this.ref_();
        if let Some(mut server) = this.server.get() {
            server.on_pending_request();
            resp.timeout(server.config().idle_timeout);
        }
        // PORT NOTE: clone the path so the borrow into `this.blob.store`
        // doesn't span the scopeguard creation (the guard's closure may free
        // `*this_ptr` on early-return drop). // PERF(port): was zero-copy
        // slice — profile in Phase B.
        let path_buf: Vec<u8> = match this.blob.store.as_ref().unwrap().get_path() {
            Some(p) => p.to_vec(),
            None => {
                req.set_yield(true);
                Self::on_response_complete(this_ptr, resp);
                return;
            }
        };
        let path: &[u8] = path_buf.as_slice();

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
            Self::on_response_complete(this_ptr, resp);
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
                // SAFETY: this_ptr is valid; ref taken above keeps FileRoute alive until on_response_complete
                Self::on_response_complete(this_ptr, resp);
            }
        });

        // PORT NOTE (intentional spec divergence): Zig writes
        // `req.dateForHeader(..) catch return` — i.e. on a JS parse exception
        // the handler bails with NO response written (the defer above closes
        // the fd and decrements the route ref, leaving the client hung until
        // timeout). That `catch return` is itself flagged as a TODO in the
        // .zig. `parse_http_date` instead maps a parse failure to `None`, so a
        // malformed If-Modified-Since header degrades to "serve the file
        // unconditionally" — the RFC 9110 §13.1.3-correct behaviour and what
        // the Zig TODO is asking for. Kept divergent on purpose.
        //
        // LAYERING: Zig's `req.dateForHeader` was a method on `uws.Request`;
        // in Rust the parse step lives HERE (T6) because it needs `bun_jsc` —
        // call site moved up so `bun_uws_sys` (T0) carries no upward hook.
        let input_if_modified_since_date: Option<u64> =
            req.header(b"if-modified-since").and_then(crate::jsc_hooks::parse_http_date);

        let (can_serve_file, size, file_type, pollable): (bool, u64, FileType, bool) = 'brk: {
            let stat = match bun_sys::fstat(fd) {
                Ok(s) => s,
                // PORT NOTE: file_type is `undefined` in Zig here; never read because can_serve_file == false
                Err(_) => break 'brk (false, 0, FileType::File, false),
            };

            let stat_size: u64 = u64::try_from(stat.st_size.max(0)).expect("int cast");
            let _size: u64 = stat_size.min(this.blob.size);

            let mode = u32::try_from(stat.st_mode).expect("int cast");
            if bun_sys::S::ISDIR(mode) {
                break 'brk (false, 0, FileType::File, false);
            }

            // SAFETY: single-threaded event loop; `this: &FileRoute` is the
            // only live borrow and `stat_hash` is `UnsafeCell`, so this write
            // does not invalidate `this`'s shared tag.
            unsafe { (*this.stat_hash.get()).hash(&stat, path) };

            if bun_sys::S::ISFIFO(mode) || bun_sys::S::ISCHR(mode) {
                break 'brk (true, _size, FileType::Pipe, true);
            }

            if bun_sys::S::ISSOCK(mode) {
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
            && this.status_code == 200
            && !this.has_content_range_header
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
                    let Ok(lmd) = this.last_modified_date() else { return }; // TODO: properly propagate exception upwards
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

            if size == 0 && file_type == FileType::File && this.status_code == 200 {
                break 'brk 204;
            }

            this.status_code
        };

        req.set_yield(false);

        this.write_status_code(status_code, resp);
        resp.write_mark();
        this.write_headers(resp);

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
                (this.blob.offset + start, Some(end - start + 1))
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
                if file_type == FileType::File { this.blob.offset } else { 0 },
                if file_type == FileType::File && this.blob.size > 0 {
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
            vm: this.server.get().unwrap().vm(),
            file_type,
            pollable,
            offset: body_offset,
            length: body_len,
            idle_timeout: this.server.get().unwrap().config().idle_timeout,
            ctx: this_ptr.cast::<c_void>(),
            on_complete: on_stream_complete,
            on_abort: None,
            on_error: on_stream_error,
        });
    }

    fn on_response_complete(this: *mut FileRoute, resp: AnyResponse) {
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
    FileRoute::on_response_complete(ctx.cast::<FileRoute>(), resp);
}

fn on_stream_error(ctx: *mut c_void, resp: AnyResponse, _err: bun_sys::Error) {
    FileRoute::on_response_complete(ctx.cast::<FileRoute>(), resp);
}

// Intrusive refcount: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`
bun_ptr::impl_cell_ref_counted! {
    impl FileRoute {
        fn ref_count(&self) -> &Cell<u32> { &self.ref_count }
        // SAFETY: `this` was produced by `Box::into_raw` (write provenance
        // preserved through FFI userdata round-trips); uniquely held at zero.
        unsafe fn destroy(this: *mut Self) { FileRoute::deinit(this) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/FileRoute.zig (390 lines)
//   confidence: high
//   todos:      0
//   notes:      on()/on_response_complete take *mut Self (intrusive RC freed
//               via deref); on() derives a single &Self — stat_hash wrapped in
//               UnsafeCell for the per-request hash() write so the shared
//               borrow stays SB-valid; StatHash from bun_resolver::fs;
//               Headers::from bridged via cycle-break vtable (FetchHeadersRef
//               shared with StaticRoute, AnyBlobRef local for &Blob);
//               If-Modified-Since parse intentionally diverges from Zig's
//               `catch return` (see PORT NOTE in on()).
// ──────────────────────────────────────────────────────────────────────────
