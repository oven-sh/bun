use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use bun_core::{MutableString, strings};
use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_http::{AsyncHTTP, HTTPClientResult, Headers, Signals};
use bun_io::KeepAlive;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_s3_signing::credentials::SignResult;
use bun_s3_signing::error::S3Error;
use bun_threading::Mutex;

bun_core::declare_scope!(S3, hidden);

pub struct S3HttpDownloadStreamingTask {
    // `MaybeUninit` because `AsyncHTTP` contains non-null references, so
    // `mem::zeroed()` can't be used here (mirrors `S3HttpSimpleTask`).
    pub http: core::mem::MaybeUninit<AsyncHTTP<'static>>,
    /// JSC_BORROW: per-thread VM singleton, outlives every task. `None` only in
    /// the inert `Default` placeholder (overwritten before the task escapes).
    pub vm: Option<bun_ptr::BackRef<VirtualMachine>>,
    pub sign_result: SignResult,
    pub headers: Headers,
    pub callback_context: NonNull<()>,
    pub callback: fn(chunk: &MutableString, has_more: bool, err: Option<S3Error>, ctx: *mut c_void),
    pub has_schedule_callback: AtomicBool,
    pub signal_store: bun_http::signals::Store,
    pub signals: Signals,
    pub poll_ref: KeepAlive,

    pub response_buffer: MutableString,
    pub mutex: Mutex,
    pub reported_response_buffer: MutableString,
    /// The HTTP-level failure, if any. Guarded by `mutex`; the `request_error`
    /// bit in `state` mirrors `request_error.is_some()`.
    pub request_error: Option<bun_http::Error>,
    pub state: AtomicU64,

    pub concurrent_task: ConcurrentTask,
    pub range: Option<Box<[u8]>>,
    pub proxy_url: Box<[u8]>,
    /// Captured once on the main thread before the request is queued so the cancel
    /// path can call `schedule_shutdown_by_id` without dereferencing `http` (which
    /// `update_state` overwrites on the HTTP thread under `mutex`).
    pub async_http_id: u32,
}

// Hot-dispatch tag for `ConcurrentTask::from`.
impl Taskable for S3HttpDownloadStreamingTask {
    const TAG: TaskTag = task_tag::S3HttpDownloadStreamingTask;
}

impl Default for S3HttpDownloadStreamingTask {
    fn default() -> Self {
        // only the fields `has_schedule_callback` .. `concurrent_task`
        // are observed via this path; the rest are placeholders that the caller (client.rs
        // `..Default::default()`) overwrites before the task pointer escapes
        // (see S3HttpSimpleTask in simple_request.rs).
        Self {
            // never read — fully overwritten by `AsyncHTTP::init` before first use.
            http: core::mem::MaybeUninit::uninit(),
            vm: None,
            sign_result: SignResult::default(),
            headers: Headers::default(),
            callback_context: NonNull::dangling(),
            callback: |_, _, _, _| {},
            range: None,
            proxy_url: Box::default(),
            has_schedule_callback: AtomicBool::new(false),
            signal_store: bun_http::signals::Store::default(),
            signals: Signals::default(),
            poll_ref: KeepAlive::default(),
            response_buffer: MutableString::default(),
            mutex: Mutex::default(),
            reported_response_buffer: MutableString::default(),
            request_error: None,
            state: AtomicU64::new(State::default().0),
            concurrent_task: ConcurrentTask::default(),
            async_http_id: 0,
        }
    }
}

impl S3HttpDownloadStreamingTask {
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
        let failed = match state.status_code() {
            200 | 204 | 206 => state.request_error() != 0,
            _ => true,
        };

        // reshaped for borrowck — `code`/`message` borrow from
        // `self.reported_response_buffer`, so we compute the chunk after the
        // borrow scope ends rather than inside the labeled block.
        let chunk: MutableString = 'brk: {
            if failed {
                if !has_more {
                    let mut _has_body_code = false;
                    let mut _has_body_message = false;

                    let mut code: &[u8] = b"UnknownError";
                    let mut message: &[u8] = b"an unexpected error has occurred";
                    if let Some(req_err) = self.request_error {
                        code = req_err.name().as_bytes();
                        _has_body_code = true;
                    } else {
                        let bytes = self.reported_response_buffer.list.as_slice();
                        if !bytes.is_empty() {
                            message = bytes;

                            if let Some(start) = strings::index_of(bytes, b"<Code>") {
                                let value_start = start + b"<Code>".len();
                                if let Some(end) =
                                    strings::index_of(&bytes[value_start..], b"</Code>")
                                {
                                    code = &bytes[value_start..value_start + end];
                                    _has_body_code = true;
                                }
                            }
                            if let Some(start) = strings::index_of(bytes, b"<Message>") {
                                let value_start = start + b"<Message>".len();
                                if let Some(end) =
                                    strings::index_of(&bytes[value_start..], b"</Message>")
                                {
                                    message = &bytes[value_start..value_start + end];
                                    _has_body_message = true;
                                }
                            }
                        }
                    }

                    // `code`/`message` borrow `self.reported_response_buffer`;
                    // the callback consumes them before any reset/deinit.
                    err = Some(S3Error { code, message });
                }
                break 'brk MutableString::default();
            } else {
                // `core::mem::take` transfers ownership of the buffer, leaving an
                // empty MutableString behind.
                let buffer = core::mem::take(&mut self.reported_response_buffer);
                break 'brk buffer;
            }
        };
        bun_core::scoped_log!(
            S3,
            "reportProgres failed: {} has_more: {} len: {}",
            failed,
            has_more,
            chunk.len()
        );
        if failed {
            if !has_more {
                (self.callback)(&chunk, false, err, self.callback_context.as_ptr().cast());
            }
        } else {
            // dont report empty chunks if we have more data to read
            if !has_more || chunk.len() > 0 {
                (self.callback)(
                    &chunk,
                    has_more,
                    None,
                    self.callback_context.as_ptr().cast(),
                );
                self.reported_response_buffer.reset();
            }
        }
    }

    /// this is the task callback from the last task result and is always in the main thread
    ///
    /// # Safety
    /// `this` must be a live heap pointer produced by `Self::new`; the event loop guarantees
    /// exclusive main-thread access for the duration of this call. When the loaded state's
    /// `has_more` is false this call reclaims and drops the allocation exactly once.
    pub(crate) fn on_response(this: *mut Self) {
        // SAFETY: `this` is a live heap allocation created via `Self::new`; the event loop
        // guarantees exclusive access on the main thread for the duration of this callback.
        let self_ = unsafe { &mut *this };
        // lets lock and unlock the reported response buffer
        self_.mutex.lock();
        // the state is atomic let's load it once
        let state = self_.get_state();
        let has_more = state.has_more();
        // Use a scopeguard so any future early-exit / unwind through
        // `report_progress` still unlocks + deinits.
        let this_ptr = this;
        scopeguard::defer! {
            // SAFETY: `this_ptr` was allocated via `Box::new` in `Self::new`; once
            // `has_more == false` we are the sole owner (HTTP thread will not call back again).
            unsafe {
                (*this_ptr).mutex.unlock();
                if !has_more {
                    drop(bun_core::heap::take(this_ptr));
                }
            }
        };

        // there is no reason to set has_schedule_callback to true if we dont have more data to read
        if has_more {
            self_.has_schedule_callback.store(false, Ordering::Relaxed);
        }
        self_.report_progress(state);
    }

    /// this function is only called from the http callback in the HTTPThread and returns true if we
    /// should wait until we are done buffering the response body to report
    /// should only be called when already locked
    fn update_state(
        &mut self,
        async_http: &mut AsyncHTTP<'static>,
        // borrowed so the caller (process_http_callback) can still read
        // `result.body` afterward.
        result: &HTTPClientResult,
        state: &mut State,
    ) -> bool {
        let is_done = !result.has_more;
        // if we got a error or fail wait until we are done buffering the response body to report
        let wait_until_done;
        {
            state.set_has_more(!is_done);

            self.request_error = result.fail;
            state.set_request_error(if result.fail.is_some() { 1 } else { 0 });
            if state.status_code() == 0 {
                // `certificate_info` / `metadata` free their owned buffers via `Drop`
                // when `HTTPClientResult` is dropped by the caller after this returns.
                if let Some(m) = &result.metadata {
                    state.set_status_code(m.response.status_code);
                }
            }
            match state.status_code() {
                200 | 204 | 206 => wait_until_done = state.request_error() != 0,
                _ => wait_until_done = true,
            }
            // store the new state
            self.set_state(*state);
            // SAFETY: `async_http` points to a live AsyncHTTP owned by the HTTP thread; a
            // bitwise read+write copies its current state into `self.http` without running
            // destructors (the HTTP thread retains ownership of the source until the request
            // completes). `self.http` was previously initialised in
            // `execute_s3_streaming_download`.
            unsafe { core::ptr::write(self.http.as_mut_ptr(), core::ptr::read(async_http)) };
        }
        wait_until_done
    }

    /// this functions is only called from the http callback in the HTTPThread and returns true if
    /// we should enqueue another task
    fn process_http_callback(
        &mut self,
        async_http: &mut AsyncHTTP<'static>,
        result: HTTPClientResult,
    ) -> bool {
        // lets lock and unlock to be safe we know the state is not in the middle of a callback when locked
        // The RAII guard unlocks on every
        // return path. The guard holds the mutex by raw pointer (see
        // `Mutex::lock_guard`), so `&mut self` stays freely usable while
        // locked, and it drops before this fn returns — strictly before the
        // task can be freed by the main thread.
        let _guard = self.mutex.lock_guard();

        // remember the state is atomic load it once, and store it again
        let mut state = self.get_state();
        // old state should have more otherwise it's an HTTP-client bug
        debug_assert!(state.has_more());
        let is_done = !result.has_more;
        let wait_until_done = self.update_state(async_http, &result, &mut state);
        let should_enqueue = !wait_until_done || is_done;
        bun_core::scoped_log!(
            S3,
            "state err: {} status_code: {} has_more: {} should_enqueue: {}",
            state.request_error(),
            state.status_code(),
            state.has_more(),
            should_enqueue
        );

        if should_enqueue {
            if let Some(body) = result.body {
                // `body` is `&this.response_buffer`, so a `ptr::read` + assign here would
                // run Drop on the old `self.response_buffer`, freeing the Vec allocation
                // that `body` (and the freshly-stored value) still point at — a
                // use-after-free / double-free. Instead, append `body`'s bytes to
                // `reported_response_buffer`, then reset the buffer, operating on `body`
                // directly.
                if !body.list.as_slice().is_empty() {
                    let _ = self.reported_response_buffer.write(body.list.as_slice());
                }
                body.reset();
                if self.reported_response_buffer.list.as_slice().is_empty() && !is_done {
                    return false;
                }
            } else if !is_done {
                return false;
            }
            if let Err(has_schedule_callback) = self.has_schedule_callback.compare_exchange(
                false,
                true,
                Ordering::Acquire,
                Ordering::Relaxed,
            ) {
                if has_schedule_callback {
                    return false;
                }
            }
            return true;
        }
        false
    }

    /// this is the AsyncHTTP callback and is always called from the HTTPThread
    ///
    /// # Safety
    /// `this` must be a live heap pointer produced by `Self::new`, valid for the duration of the
    /// HTTP request; `mutex` serializes against `on_response`. `async_http` must be a valid
    /// pointer to an initialised `AsyncHTTP` for the duration of this call.
    pub(crate) fn http_callback(
        this: *mut Self,
        async_http: *mut AsyncHTTP<'static>,
        result: HTTPClientResult,
    ) {
        // SAFETY: `this` is live for the duration of the HTTP request; HTTPThread holds the only
        // concurrent reference and `mutex` serializes against `on_response`.
        let self_ = unsafe { &mut *this };
        // SAFETY: `async_http` is the live HTTP-thread copy; non-null for the callback's duration.
        let async_http = unsafe { &mut *async_http };
        if self_.process_http_callback(async_http, result) {
            // we are always unlocked here and its safe to enqueue
            let task = core::ptr::NonNull::from(
                self_.concurrent_task.from(this, AutoDeinit::ManualDeinit),
            );
            // `vm` is the live per-thread VM BackRef captured at task creation; event_loop
            // is initialized for the request's lifetime and enqueue is thread-safe (`&self`).
            // `task` is the inline `concurrent_task` field of this heap request;
            // the queue takes ownership of its `next` link.
            self_
                .vm
                .expect("vm set at task creation")
                .event_loop_shared()
                .enqueue_task_concurrent(task);
        }
    }
}

impl Drop for S3HttpDownloadStreamingTask {
    fn drop(&mut self) {
        // KeepAlive::unref now takes an aio EventLoopCtx; the JS-loop ctx is fetched
        // via the global hook (registered by crate::init) — same pattern as
        // `S3HttpSimpleTask::drop` in simple_request.rs.
        self.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        // response_buffer, reported_response_buffer, headers, sign_result, range, proxy_url:
        // dropped automatically (Box/Vec-backed fields).
        // SAFETY: `http` is always initialised before the task is scheduled / dropped.
        let http = unsafe { self.http.assume_init_mut() };
        http.clear_data();
        // `init` clones the EntryList into task.headers / request_headers /
        // client.header_entries, so free the two copies clear_data() skips.
        // (Same fix as `S3HttpSimpleTask::drop` in simple_request.rs.)
        http.request_headers = Default::default();
        http.client.header_entries = Default::default();
    }
}

/// Manual bitfield over a transparent u64. Layout (LSB-first):
///   bits  0..32 : status_code (u32)
///   bits 32..48 : request_error (u16)
///   bit  48     : has_more (bool)
///   bits 49..64 : _reserved (u15)
#[repr(transparent)]
#[derive(Copy, Clone)]
pub struct State(pub u64);

impl State {
    const STATUS_CODE_SHIFT: u32 = 0;
    const REQUEST_ERROR_SHIFT: u32 = 32;
    const HAS_MORE_SHIFT: u32 = 48;

    #[inline]
    pub(crate) const fn status_code(self) -> u32 {
        (self.0 >> Self::STATUS_CODE_SHIFT) as u32
    }
    #[inline]
    pub(crate) fn set_status_code(&mut self, v: u32) {
        self.0 = (self.0 & !0xFFFF_FFFF) | (v as u64);
    }
    #[inline]
    pub(crate) const fn request_error(self) -> u16 {
        (self.0 >> Self::REQUEST_ERROR_SHIFT) as u16
    }
    #[inline]
    pub(crate) fn set_request_error(&mut self, v: u16) {
        self.0 = (self.0 & !(0xFFFF << Self::REQUEST_ERROR_SHIFT))
            | ((v as u64) << Self::REQUEST_ERROR_SHIFT);
    }
    #[inline]
    pub(crate) const fn has_more(self) -> bool {
        (self.0 >> Self::HAS_MORE_SHIFT) & 1 != 0
    }
    #[inline]
    pub(crate) fn set_has_more(&mut self, v: bool) {
        self.0 = (self.0 & !(1 << Self::HAS_MORE_SHIFT)) | ((v as u64) << Self::HAS_MORE_SHIFT);
    }
}

impl Default for State {
    fn default() -> Self {
        // status_code = 0, request_error = 0, has_more = true, _reserved = 0
        State(1u64 << State::HAS_MORE_SHIFT)
    }
}
