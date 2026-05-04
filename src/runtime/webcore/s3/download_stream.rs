use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use bun_aio::KeepAlive;
use bun_core::Error;
use bun_http::{AsyncHTTP, HTTPClientResult, Headers, Signals};
use bun_jsc::{ConcurrentTask, VirtualMachine};
use bun_s3_signing::credentials::SignResult;
use bun_s3_signing::error::S3Error;
use bun_str::{strings, MutableString};
use bun_threading::Mutex;

bun_output::declare_scope!(S3, hidden);

pub struct S3HttpDownloadStreamingTask {
    pub http: AsyncHTTP,
    pub vm: &'static VirtualMachine,
    pub sign_result: SignResult,
    pub headers: Headers,
    pub callback_context: NonNull<()>,
    /// this transfers ownership from the chunk
    pub callback: fn(chunk: MutableString, has_more: bool, err: Option<S3Error>, ctx: *mut ()),
    pub has_schedule_callback: AtomicBool,
    pub signal_store: bun_http::signals::Store,
    pub signals: Signals,
    pub poll_ref: KeepAlive,

    pub response_buffer: MutableString,
    pub mutex: Mutex,
    pub reported_response_buffer: MutableString,
    pub state: AtomicU64,

    pub concurrent_task: ConcurrentTask,
    pub range: Option<Box<[u8]>>,
    pub proxy_url: Box<[u8]>,
}

impl S3HttpDownloadStreamingTask {
    // Zig: `pub const new = bun.TrivialNew(@This());`
    pub fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub fn get_state(&self) -> State {
        State(self.state.load(Ordering::Acquire))
    }

    pub fn set_state(&self, state: State) {
        self.state.store(state.0, Ordering::Relaxed);
    }

    fn report_progress(&mut self, state: State) {
        let has_more = state.has_more();
        let mut err: Option<S3Error> = None;
        let mut failed = false;

        // PORT NOTE: reshaped for borrowck — `code`/`message` borrow from
        // `self.reported_response_buffer`, so we compute the chunk after the
        // borrow scope ends rather than inside the labeled block.
        let chunk: MutableString = 'brk: {
            match state.status_code() {
                200 | 204 | 206 => {
                    failed = state.request_error() != 0;
                }
                _ => {
                    failed = true;
                }
            }
            if failed {
                if !has_more {
                    let mut _has_body_code = false;
                    let mut _has_body_message = false;

                    let mut code: &[u8] = b"UnknownError";
                    let mut message: &[u8] = b"an unexpected error has occurred";
                    if state.request_error() != 0 {
                        // SAFETY: request_error != 0 checked above; value originated from @intFromError.
                        let req_err = Error::from_raw(state.request_error());
                        code = req_err.name().as_bytes();
                        _has_body_code = true;
                    } else {
                        let bytes = self.reported_response_buffer.as_slice();
                        if !bytes.is_empty() {
                            message = bytes;

                            if let Some(start) = strings::index_of(bytes, b"<Code>") {
                                if let Some(end) = strings::index_of(bytes, b"</Code>") {
                                    code = &bytes[start + b"<Code>".len()..end];
                                    _has_body_code = true;
                                }
                            }
                            if let Some(start) = strings::index_of(bytes, b"<Message>") {
                                if let Some(end) = strings::index_of(bytes, b"</Message>") {
                                    message = &bytes[start + b"<Message>".len()..end];
                                    _has_body_message = true;
                                }
                            }
                        }
                    }

                    err = Some(S3Error { code, message });
                    // TODO(port): S3Error field lifetimes — `code`/`message` borrow
                    // `self.reported_response_buffer`; callback consumes them before reset/deinit.
                }
                break 'brk MutableString::default();
            } else {
                // TODO(port): Zig copies the MutableString struct by value here (shallow copy of
                // ptr+len+cap). Ownership of the buffer is effectively shared with
                // `self.reported_response_buffer` until `.reset()` below. Phase B: confirm
                // MutableString move/clone semantics.
                let buffer = self.reported_response_buffer.shallow_copy();
                break 'brk buffer;
            }
        };
        bun_output::scoped_log!(
            S3,
            "reportProgres failed: {} has_more: {} len: {}",
            failed,
            has_more,
            chunk.len()
        );
        if failed {
            if !has_more {
                (self.callback)(chunk, false, err, self.callback_context.as_ptr().cast());
            }
        } else {
            // dont report empty chunks if we have more data to read
            if !has_more || chunk.len() > 0 {
                (self.callback)(chunk, has_more, None, self.callback_context.as_ptr().cast());
                self.reported_response_buffer.reset();
            }
        }
    }

    /// this is the task callback from the last task result and is always in the main thread
    pub fn on_response(this: *mut Self) {
        // SAFETY: `this` is a live heap allocation created via `Self::new`; the event loop
        // guarantees exclusive access on the main thread for the duration of this callback.
        let self_ = unsafe { &mut *this };
        // lets lock and unlock the reported response buffer
        self_.mutex.lock();
        // the state is atomic let's load it once
        let state = self_.get_state();
        let has_more = state.has_more();

        // there is no reason to set has_schedule_callback to true if we dont have more data to read
        if has_more {
            self_.has_schedule_callback.store(false, Ordering::Relaxed);
        }
        self_.report_progress(state);

        // Zig `defer { unlock; if (!has_more) deinit; }` — inlined here (no early returns above).
        self_.mutex.unlock();
        if !has_more {
            // SAFETY: `this` was allocated via `Box::new` in `Self::new`; we are the sole owner
            // once `has_more == false` (HTTP thread will not call back again).
            unsafe { drop(Box::from_raw(this)) };
        }
    }

    /// this function is only called from the http callback in the HTTPThread and returns true if we
    /// should wait until we are done buffering the response body to report
    /// should only be called when already locked
    fn update_state(
        &mut self,
        async_http: &mut AsyncHTTP,
        // PORT NOTE: reshaped for borrowck — Zig passed `result` by value; Rust borrows so the
        // caller (process_http_callback) can still read `result.body` afterward.
        result: &HTTPClientResult,
        state: &mut State,
    ) -> bool {
        let is_done = !result.has_more;
        // if we got a error or fail wait until we are done buffering the response body to report
        let mut wait_until_done = false;
        {
            state.set_has_more(!is_done);

            state.set_request_error(if let Some(err) = result.fail {
                err.into_raw()
            } else {
                0
            });
            if state.status_code() == 0 {
                if let Some(certificate) = &result.certificate_info {
                    // TODO(port): Zig passes `bun.default_allocator`; Rust Drop on CertificateInfo
                    // should handle this. Phase B: confirm whether explicit deinit is needed here.
                    certificate.deinit();
                }
                if let Some(m) = result.metadata {
                    let mut metadata = m;
                    state.set_status_code(metadata.response.status_code);
                    metadata.deinit();
                }
            }
            match state.status_code() {
                200 | 204 | 206 => wait_until_done = state.request_error() != 0,
                _ => wait_until_done = true,
            }
            // store the new state
            self.set_state(*state);
            // TODO(port): Zig does `this.http = async_http.*;` (struct copy). Phase B: confirm
            // AsyncHTTP copy/move semantics in Rust.
            // SAFETY: `async_http` points to a live AsyncHTTP owned by the HTTP thread; Zig does a
            // plain struct copy (`this.http = async_http.*`) — bitwise read matches that.
            self.http = unsafe { core::ptr::read(async_http) };
        }
        wait_until_done
    }

    /// this functions is only called from the http callback in the HTTPThread and returns true if
    /// we should enqueue another task
    fn process_http_callback(
        &mut self,
        async_http: &mut AsyncHTTP,
        result: HTTPClientResult,
    ) -> bool {
        // lets lock and unlock to be safe we know the state is not in the middle of a callback when locked
        self.mutex.lock();
        // Zig `defer this.mutex.unlock();` — handled at every return below.
        // TODO(port): replace with RAII MutexGuard once bun_threading::Mutex exposes one.
        let unlock = |s: &mut Self| s.mutex.unlock();

        // remember the state is atomic load it once, and store it again
        let mut state = self.get_state();
        // old state should have more otherwise its a http.zig bug
        debug_assert!(state.has_more());
        let is_done = !result.has_more;
        let wait_until_done = self.update_state(async_http, &result, &mut state);
        let should_enqueue = !wait_until_done || is_done;
        bun_output::scoped_log!(
            S3,
            "state err: {} status_code: {} has_more: {} should_enqueue: {}",
            state.request_error(),
            state.status_code(),
            state.has_more(),
            should_enqueue
        );

        if should_enqueue {
            if let Some(body) = result.body {
                // TODO(port): Zig does `this.response_buffer = body.*;` (struct copy of
                // MutableString). Phase B: confirm ownership transfer semantics.
                // SAFETY: `body` points to a live MutableString inside `result`; Zig does
                // `this.response_buffer = body.*` (shallow struct copy) — bitwise read matches that.
                self.response_buffer = unsafe { core::ptr::read(body) };
                if !body.as_slice().is_empty() {
                    self.reported_response_buffer.write(body.as_slice());
                }
                self.response_buffer.reset();
                if self.reported_response_buffer.as_slice().is_empty() && !is_done {
                    unlock(self);
                    return false;
                }
            } else if !is_done {
                unlock(self);
                return false;
            }
            if let Err(has_schedule_callback) = self.has_schedule_callback.compare_exchange(
                false,
                true,
                Ordering::Acquire,
                Ordering::Relaxed,
            ) {
                if has_schedule_callback {
                    unlock(self);
                    return false;
                }
            }
            unlock(self);
            return true;
        }
        unlock(self);
        false
    }

    /// this is the callback from the http.zig AsyncHTTP is always called from the HTTPThread
    pub fn http_callback(
        this: *mut Self,
        async_http: &mut AsyncHTTP,
        result: HTTPClientResult,
    ) {
        // SAFETY: `this` is live for the duration of the HTTP request; HTTPThread holds the only
        // concurrent reference and `mutex` serializes against `on_response`.
        let self_ = unsafe { &mut *this };
        if self_.process_http_callback(async_http, result) {
            // we are always unlocked here and its safe to enqueue
            // TODO(port): `.manual_deinit` is a Zig enum literal arg to ConcurrentTask.from;
            // map to the Rust equivalent (likely `ConcurrentTaskDeinit::Manual`).
            self_.vm.event_loop().enqueue_task_concurrent(
                self_
                    .concurrent_task
                    .from(this, bun_jsc::ConcurrentTaskDeinit::Manual),
            );
        }
    }
}

impl Drop for S3HttpDownloadStreamingTask {
    fn drop(&mut self) {
        self.poll_ref.unref(self.vm);
        // response_buffer, reported_response_buffer, headers, sign_result, range, proxy_url:
        // dropped automatically (Box/Vec-backed fields).
        self.http.clear_data();
    }
}

/// Zig: `packed struct(u64)` — not all-bool, so manual bitfield over a transparent u64.
/// Layout (LSB-first, matching Zig packed-struct bit order):
///   bits  0..32 : status_code (u32)
///   bits 32..48 : request_error (u16)
///   bit  48     : has_more (bool)
///   bits 49..64 : _reserved (u15)
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct State(pub u64);

// Zig: `pub const AtomicType = std.atomic.Value(u64);`
pub type StateAtomicType = AtomicU64;

impl State {
    const STATUS_CODE_SHIFT: u32 = 0;
    const REQUEST_ERROR_SHIFT: u32 = 32;
    const HAS_MORE_SHIFT: u32 = 48;

    #[inline]
    pub const fn status_code(self) -> u32 {
        (self.0 >> Self::STATUS_CODE_SHIFT) as u32
    }
    #[inline]
    pub fn set_status_code(&mut self, v: u32) {
        self.0 = (self.0 & !0xFFFF_FFFF) | (v as u64);
    }
    #[inline]
    pub const fn request_error(self) -> u16 {
        (self.0 >> Self::REQUEST_ERROR_SHIFT) as u16
    }
    #[inline]
    pub fn set_request_error(&mut self, v: u16) {
        self.0 = (self.0 & !(0xFFFF << Self::REQUEST_ERROR_SHIFT))
            | ((v as u64) << Self::REQUEST_ERROR_SHIFT);
    }
    #[inline]
    pub const fn has_more(self) -> bool {
        (self.0 >> Self::HAS_MORE_SHIFT) & 1 != 0
    }
    #[inline]
    pub fn set_has_more(&mut self, v: bool) {
        self.0 = (self.0 & !(1 << Self::HAS_MORE_SHIFT)) | ((v as u64) << Self::HAS_MORE_SHIFT);
    }
}

impl Default for State {
    fn default() -> Self {
        // status_code = 0, request_error = 0, has_more = true, _reserved = 0
        State(1u64 << State::HAS_MORE_SHIFT)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/s3/download_stream.zig (244 lines)
//   confidence: medium
//   todos:      7
//   notes:      MutableString/AsyncHTTP struct-copy semantics + ConcurrentTask.from enum literal need Phase-B confirmation; mutex lock/unlock kept explicit pending RAII guard.
// ──────────────────────────────────────────────────────────────────────────
