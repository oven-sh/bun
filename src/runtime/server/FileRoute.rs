use core::cell::Cell;
use core::ffi::c_void;
use core::mem::size_of;

use bun_core::String as BunString;
use bun_core::strings;
use bun_http::{Headers, Method};
use bun_http_types::ETag;
use bun_http_types::ETag::StringPointer;
use bun_io::Closer;
use bun_io::FileType;
use bun_resolver::fs::StatHash;
use bun_sys::{self, Fd};
use bun_uws::{AnyRequest, AnyResponse};

use crate::node::types::PathOrFileDescriptor;
use crate::server::file_response_stream::StartOptions as FileResponseStreamOptions;
use crate::server::jsc::{JSGlobalObject, JSValue, JsResult, VirtualMachine};

use crate::server::{AnyServer, FileResponseStream, HTTPStatusText, RangeRequest, write_status};
use crate::webcore::blob::store::Data as StoreData;
use crate::webcore::body::Value as BodyValue;
use crate::webcore::{Blob, FetchHeaders, Response};

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = FileRoute::deinit)]
pub struct FileRoute {
    // Owned via intrusive refcount; the
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
    // mutability. `StatHash` is small POD with `Default`, so `Cell` +
    // `take()/set()` gives safe read-modify-write on the single-threaded JS
    // event loop.
    stat_hash: Cell<StatHash>,
    has_last_modified_header: bool,
    has_content_length_header: bool,
    has_content_range_header: bool,
    has_date_header: bool,
}

pub struct InitOptions<'a> {
    pub server: Option<AnyServer>,
    pub status_code: u16, // default 200
    pub headers: Option<&'a FetchHeaders>,
}

impl<'a> Default for InitOptions<'a> {
    fn default() -> Self {
        Self {
            server: None,
            status_code: 200,
            headers: None,
        }
    }
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

impl FileRoute {
    /// Exposes the private `server` Cell to the route table (`AnyRoute::set_server`).
    #[inline]
    pub fn set_server(&self, server: Option<AnyServer>) {
        self.server.set(server);
    }

    pub fn memory_cost(&self) -> usize {
        size_of::<FileRoute>()
            + self.headers.memory_cost()
            + self.blob.reported_estimated_size.get()
    }

    pub fn last_modified_date(&self) -> JsResult<Option<u64>> {
        if self.has_last_modified_header {
            if let Some(last_modified) = self.headers.get(b"last-modified") {
                let mut string = BunString::borrow_utf8(last_modified);
                // `defer string.deref()` — handled by Drop on bun_core::String
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

    pub fn init_from_blob(blob: Blob, opts: &InitOptions<'_>) -> *mut FileRoute {
        let headers = headers_from(opts.headers, &blob);
        bun_core::heap::into_raw(Box::new(FileRoute {
            ref_count: Cell::new(1),
            server: Cell::new(opts.server),
            has_last_modified_header: headers.get(b"last-modified").is_some(),
            has_content_length_header: headers.get(b"content-length").is_some(),
            has_content_range_header: headers.get(b"content-range").is_some(),
            has_date_header: headers.get(b"date").is_some(),
            blob,
            headers,
            status_code: opts.status_code,
            stat_hash: Cell::new(StatHash::default()),
        }))
    }

    fn deinit(this: *mut FileRoute) {
        // SAFETY: `this` was allocated via heap::alloc in init_from_blob/from_js and the
        // intrusive ref_count has reached 0.
        // `headers` is freed by its own Drop when the Box is dropped.
        unsafe {
            (*this).blob.deinit();
            drop(bun_core::heap::take(this));
        }
    }

    pub fn from_js(global: &JSGlobalObject, argument: JSValue) -> JsResult<Option<*mut FileRoute>> {
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

                return Ok(Some(bun_core::heap::into_raw(Box::new(FileRoute {
                    ref_count: Cell::new(1),
                    server: Cell::new(None),
                    has_last_modified_header: headers.get(b"last-modified").is_some(),
                    has_content_length_header: headers.get(b"content-length").is_some(),
                    has_content_range_header: headers.get(b"content-range").is_some(),
                    has_date_header: headers.get(b"date").is_some(),
                    blob,
                    headers,
                    status_code,
                    stat_hash: Cell::new(StatHash::default()),
                }))));
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
                return Ok(Some(bun_core::heap::into_raw(Box::new(FileRoute {
                    ref_count: Cell::new(1),
                    server: Cell::new(None),
                    headers,
                    blob: b,
                    has_content_length_header: false,
                    has_last_modified_header: false,
                    has_content_range_header: false,
                    has_date_header: false,
                    status_code: 200,
                    stat_hash: Cell::new(StatHash::default()),
                }))));
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
        // S008: variant payloads are ZST opaques — safe `*mut → &mut` deref.
        match resp {
            AnyResponse::SSL(s) => {
                let s = bun_opaque::opaque_deref_mut(s);
                for (name, value) in names.iter().zip(values) {
                    s.write_header(sp_slice(*name, buf), sp_slice(*value, buf));
                }
                if let Some(srv) = self.server.get() {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::TCP(s) => {
                let s = bun_opaque::opaque_deref_mut(s);
                for (name, value) in names.iter().zip(values) {
                    s.write_header(sp_slice(*name, buf), sp_slice(*value, buf));
                }
                if let Some(srv) = self.server.get() {
                    if let Some(alt) = srv.h3_alt_svc() {
                        s.write_header(b"alt-svc", alt);
                    }
                }
            }
            AnyResponse::H3(s) => {
                let s = bun_opaque::opaque_deref_mut(s);
                for (name, value) in names.iter().zip(values) {
                    s.write_header(sp_slice(*name, buf), sp_slice(*value, buf));
                }
                // tag == .H3 → no alt-svc header
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

    fn write_status_code(&self, status: u16, resp: AnyResponse) {
        match resp {
            AnyResponse::SSL(r) => write_status::<true>(r, status),
            AnyResponse::TCP(r) => write_status::<false>(r, status),
            AnyResponse::H3(r) => {
                let mut b = bun_core::fmt::ItoaBuf::new();
                let s = bun_core::fmt::itoa(&mut b, status);
                // S008: `h3::Response` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(r).write_status(s);
            }
        }
    }

    /// # Safety
    /// `this` must point to a live heap `FileRoute` (intrusive ref held by the
    /// route table) for the duration of the call.
    // Forwards `this` to `Self::on` without dereferencing; not_unsafe_ptr_arg_deref
    // is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn on_head_request(this: *mut FileRoute, req: AnyRequest, resp: AnyResponse) {
        // SAFETY: forwarded with the same precondition.
        unsafe { Self::on(this, req, resp, Method::HEAD) };
    }

    // Forwards `this` to `Self::on` without dereferencing; not_unsafe_ptr_arg_deref
    // is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn on_request(this: *mut FileRoute, req: AnyRequest, resp: AnyResponse) {
        let method = Method::find(req.method()).unwrap_or(Method::GET);
        // SAFETY: `this` is a live heap FileRoute — intrusive ref held by the
        // route table; only reached from the uWS route callback.
        unsafe { Self::on(this, req, resp, method) };
    }

    // Takes `*mut FileRoute` (not `&self`) because `this_ptr` is stashed as
    // `FileResponseStream`'s `ctx` userdata; the async `on_stream_complete`
    // may hold the last ref after a reload drops the route table's. Within
    // the body the route-table ref + the `ref_()` below keep `*this_ptr`
    // alive, and every per-request mutation (`ref_count`, `stat_hash`) goes
    // through `Cell`, so a single `&FileRoute` is sound under Stacked
    // Borrows for the whole call.
    /// # Safety
    /// `this_ptr` must point to a live heap `FileRoute` for the duration of
    /// this call. The `ref_()` taken below keeps it alive until
    /// `on_response_complete`. All mutation through `this` goes via `Cell`, so
    /// the shared borrow is sound.
    pub unsafe fn on(
        this_ptr: *mut FileRoute,
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
        let store = this.blob.store().unwrap().clone();
        let Some(path) = store.get_path() else {
            req.set_yield(true);
            Self::on_response_complete(this_ptr, resp);
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
            Self::on_response_complete(this_ptr, resp);
            return;
        };

        // `fd_owned` tracks whether this function is still responsible for
        // closing the file descriptor and releasing the route ref. Every
        // non-streaming return — null-body status codes (1xx/204/205/304),
        // HEAD, non-streamable files, and the two JS-exception early-return
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

        // `parse_http_date` maps a parse failure to `None`, so a
        // malformed If-Modified-Since header degrades to "serve the file
        // unconditionally" — the RFC 9110 §13.1.3-correct behaviour.
        //
        // LAYERING: the parse step lives HERE (T6) because it needs `bun_jsc` —
        // so `bun_uws_sys` (T0) carries no upward hook.
        let input_if_modified_since_date: Option<u64> = req
            .header(b"if-modified-since")
            .and_then(crate::jsc_hooks::parse_http_date);

        let (can_serve_file, size, file_type, pollable): (bool, u64, FileType, bool) = 'brk: {
            let stat = match bun_sys::fstat(fd) {
                Ok(s) => s,
                // file_type is never read because can_serve_file == false
                Err(_) => break 'brk (false, 0, FileType::File, false),
            };

            let stat_size: u64 = u64::try_from(stat.st_size.max(0)).expect("int cast");
            let _size: u64 = stat_size.min(this.blob.size.get());

            let mode = stat.st_mode as bun_sys::Mode;
            if bun_sys::S::ISDIR(mode) {
                break 'brk (false, 0, FileType::File, false);
            }

            // `Cell::take` → mutate → `set`: single-threaded event loop, no
            // re-entry reads `stat_hash` between take/set.
            let mut sh = this.stat_hash.take();
            sh.hash(&stat, path);
            this.stat_hash.set(sh);

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
            // Range. If-None-Match is evaluated first; when present it suppresses
            // If-Modified-Since regardless of outcome (step 3 vs step 4). Both
            // only apply to GET/HEAD for 304 purposes.
            if method == Method::HEAD || method == Method::GET {
                if let Some(inm) = req.header(b"if-none-match").filter(|v| !v.is_empty()) {
                    if this.status_code == 200 {
                        let matched = match this.headers.get(b"etag").filter(|v| !v.is_empty()) {
                            Some(etag) => ETag::if_none_match(etag, inm),
                            // No stored ETag: only `*` can match (RFC 9110
                            // §13.1.2 — any current representation).
                            None => strings::trim(inm, b" \t") == b"*",
                        };
                        if matched {
                            break 'brk 304;
                        }
                    }
                    // If-None-Match present but did not match: condition is
                    // true, fall through to Range/200 without consulting
                    // If-Modified-Since.
                } else if let Some(requested_if_modified_since) = input_if_modified_since_date {
                    let Ok(lmd) = this.last_modified_date() else {
                        return;
                    }; // TODO: properly propagate exception upwards
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

            this.status_code
        };

        req.set_yield(false);

        this.write_status_code(status_code, resp);
        if this.has_date_header {
            resp.mark_wrote_date_header();
        }
        resp.write_mark();
        this.write_headers(resp);

        // Null-body statuses end before the range switch so a 304 emits no
        // Content-Range. FileResponseStream ships via sendfile/write(), so a
        // null-body status must never start it. 307/308 are ordinary
        // body-bearing statuses (RFC 9110 §15.4) and fall through to stream
        // the file, same as StaticRoute and the fetch-handler path.
        if HTTPStatusText::is_null_body(status_code) {
            // 205 is the one null-body status RFC 9112 §6.3 does NOT
            // self-terminate, so a keep-alive client needs Content-Length.
            if status_code == 205 && !resp.state().has_written_content_length_header() {
                resp.write_header_int(b"content-length", 0);
            }
            resp.end_without_body(resp.should_close_connection());
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
                (this.blob.offset.get() + start, Some(end - start + 1))
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
            RangeRequest::Result::None => (
                if file_type == FileType::File {
                    this.blob.offset.get()
                } else {
                    0
                },
                if file_type == FileType::File && this.blob.size.get() > 0 {
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
        FileResponseStream::start(&FileResponseStreamOptions {
            fd,
            auto_close: true,
            resp,
            vm: bun_ptr::BackRef::new(this.server.get().unwrap().vm()),
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
