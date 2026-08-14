use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use bun_core::MutableString;
use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_http::{AsyncHTTP, HTTPClientResult, Headers, Signals};
use bun_io::KeepAlive;
use bun_s3_signing::credentials::SignResult;
use bun_s3_signing::error::S3Error;

use crate::webcore::s3::xml_response;
use bun_threading::Mutex;

bun_core::declare_scope!(S3, hidden);

/// One streaming GET, shared by the HTTP thread (which appends each chunk under `mutex`) and
/// the JS thread (which reports the chunks from `on_response` under the same mutex and frees
/// the task once it has read `has_more == false`), from the moment it is scheduled until that
/// free.
///
/// While both threads are live the task is reached only through its raw pointer, with any
/// reference scoped to a single field or a single call: a `&mut self` method would assert
/// the whole task, `mutex` and the atomics included, for the duration of the call, while the
/// other thread may be writing to exactly those words (every `lock()` attempt is one), and on
/// the HTTP thread it would still be asserted when the final unlock lets the JS thread free the
/// task. `&self` helpers are fine: they assert only the non-atomic fields, which only the lock
/// holder writes. Both HTTP-thread critical sections release through `Mutex::unlock_raw` for
/// the same reason (see `process_http_callback`). Enforced by
/// test/internal/source-lints/s3-download-task-raw-access.test.ts; `Drop` runs once the HTTP
/// thread is done with the task, so its `&mut self` is not subject to this.
pub struct S3HttpDownloadStreamingTask {
    // `MaybeUninit` because `AsyncHTTP` contains non-null references, so
    // `mem::zeroed()` can't be used here (mirrors `S3HttpSimpleTask`).
    pub(crate) http: core::mem::MaybeUninit<AsyncHTTP<'static>>,
    /// How the HTTP thread reaches the VM to deliver chunks.
    pub(crate) loop_handle: bun_jsc::LoopHandle,
    pub(crate) sign_result: SignResult,
    pub(crate) headers: Headers,
    pub(crate) callback_context: NonNull<()>,
    pub callback: fn(chunk: &MutableString, has_more: bool, err: Option<S3Error>, ctx: *mut c_void),
    pub(crate) has_schedule_callback: AtomicBool,
    pub(crate) signal_store: bun_http::signals::Store,
    pub(crate) signals: Signals,
    pub poll_ref: KeepAlive,

    pub(crate) mutex: Mutex,
    pub(crate) reported_response_buffer: MutableString,
    /// The HTTP-level failure, if any. Guarded by `mutex`; the `request_error`
    /// bit in `state` mirrors `request_error.is_some()`.
    pub(crate) request_error: Option<bun_http::Error>,
    pub(crate) state: AtomicU64,

    pub(crate) concurrent_task: ConcurrentTask,
    pub(crate) proxy_url: Box<[u8]>,
    /// Captured once on the main thread before the request is queued so the cancel
    /// path can call `schedule_shutdown_by_id` without dereferencing `http` (which
    /// `update_state` overwrites on the HTTP thread under `mutex`).
    pub(crate) async_http_id: u32,
}

// Hot-dispatch tag for `ConcurrentTask::from`.
impl Taskable for S3HttpDownloadStreamingTask {
    const TAG: TaskTag = task_tag::S3HttpDownloadStreamingTask;
    /// As `S3HttpSimpleTask`: the completion frees the context; run it.
    unsafe fn release_unrun(this: *mut Self) {
        S3HttpDownloadStreamingTask::on_response(this);
    }
}

impl S3HttpDownloadStreamingTask {
    pub(crate) fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub(crate) fn get_state(&self) -> State {
        State(self.state.load(Ordering::Acquire))
    }

    pub(crate) fn set_state(&self, state: State) {
        self.state.store(state.0, Ordering::Relaxed);
    }

    /// JS thread, under `mutex`: delivers what the HTTP thread has recorded so far to
    /// `callback`.
    ///
    /// # Safety
    /// `this` is live and this thread holds its `mutex`. The HTTP thread may be trying to take
    /// the mutex throughout, and the callback may reach the task again (`on_stream_cancelled`),
    /// so no reference here spans more than one field or one call; see the type docs.
    unsafe fn report_progress(this: *mut Self, state: State) {
        let has_more = state.has_more();
        let failed = match state.status_code() {
            200 | 204 | 206 => state.request_error() != 0,
            _ => true,
        };
        // SAFETY: fn contract. What the callbacks borrow is either a local (`empty`, `chunk`,
        // taken out of the task first) or, for `message`, the buffer's heap bytes, which the
        // HTTP thread cannot touch until this thread unlocks.
        unsafe {
            bun_core::scoped_log!(
                S3,
                "reportProgres failed: {} has_more: {} len: {}",
                failed,
                has_more,
                (*this).reported_response_buffer.list.len()
            );

            if failed {
                if has_more {
                    return;
                }
                let empty = MutableString::default();
                let mut code: &[u8] = b"UnknownError";
                let mut message: &[u8] = b"an unexpected error has occurred";
                let parsed;
                if let Some(req_err) = (*this).request_error {
                    code = req_err.name().as_bytes();
                } else {
                    let bytes = (*this).reported_response_buffer.list.as_slice();
                    if !bytes.is_empty() {
                        message = bytes;
                    }
                    parsed = xml_response::parse_error(bytes);
                    if let Some(error) = &parsed {
                        code = error.code.as_deref().unwrap_or(code);
                        message = error.message.as_deref().unwrap_or(message);
                    }
                }
                ((*this).callback)(
                    &empty,
                    false,
                    Some(S3Error { code, message }),
                    (*this).callback_context.as_ptr().cast(),
                );
                return;
            }

            // dont report empty chunks if we have more data to read
            if !has_more || (*this).reported_response_buffer.list.len() > 0 {
                let chunk = core::mem::take(&mut (*this).reported_response_buffer);
                ((*this).callback)(
                    &chunk,
                    has_more,
                    None,
                    (*this).callback_context.as_ptr().cast(),
                );
                (*this).reported_response_buffer.reset();
            }
        }
    }

    /// this is the task callback from the last task result and is always in the main thread
    ///
    /// # Safety
    /// `this` must be a live heap pointer produced by `Self::new`, and this must be the run of
    /// the task posted for it (one per post). When the loaded state's `has_more` is false this
    /// call reclaims and drops the allocation exactly once.
    pub(crate) fn on_response(this: *mut Self) {
        // SAFETY: fn contract. The HTTP thread may be using the task concurrently until it
        // publishes the final state, so every access below is a field access or a single call
        // (see the type docs).
        unsafe { (*this).mutex.lock() };
        // the state is atomic let's load it once
        // SAFETY: as above.
        let state = unsafe { (*this).get_state() };
        let has_more = state.has_more();
        // Use a scopeguard so any future early-exit / unwind through
        // `report_progress` still unlocks + deinits.
        let this_ptr = this;
        scopeguard::defer! {
            // SAFETY: `this_ptr` was allocated via `Box::new` in `Self::new`. Once we have read
            // `has_more == false` under the mutex, the HTTP thread is done with the task (its
            // last access was the release we acquired from; it will not call back again), so we
            // are the sole owner.
            unsafe {
                (*this_ptr).mutex.unlock();
                if !has_more {
                    crate::jsc_hooks::ActiveHandle::S3Download(core::ptr::NonNull::new(this_ptr).expect("task")).unregister();
                    drop(bun_core::heap::take(this_ptr));
                }
            }
        };

        // there is no reason to set has_schedule_callback to true if we dont have more data to read
        if has_more {
            // SAFETY: as above.
            unsafe {
                (*this)
                    .has_schedule_callback
                    .store(false, Ordering::Relaxed)
            };
        }
        // SAFETY: as above, and we hold the mutex.
        unsafe { Self::report_progress(this, state) };
    }

    /// HTTP thread, under `mutex` (from `process_http_callback`): folds `result` into `state`,
    /// publishes it and takes over the request's current `AsyncHTTP`. Returns true if we should
    /// wait until we are done buffering the response body to report (the body of a failed
    /// request is its error document).
    ///
    /// # Safety
    /// `this` is live and this thread holds its `mutex`; `async_http` is the HTTP thread's live
    /// copy of the request.
    unsafe fn update_state(
        this: *mut Self,
        async_http: &mut AsyncHTTP<'static>,
        // borrowed so the caller can still take `result`'s body afterward.
        result: &HTTPClientResult,
        state: &mut State,
    ) -> bool {
        let is_done = !result.has_more;
        state.set_has_more(!is_done);
        state.set_request_error(if result.fail.is_some() { 1 } else { 0 });
        if state.status_code() == 0 {
            // `certificate_info` / `metadata` free their owned buffers via `Drop`
            // when `HTTPClientResult` is dropped by the caller after this returns.
            if let Some(m) = &result.metadata {
                state.set_status_code(m.response.status_code);
            }
        }
        let wait_until_done = match state.status_code() {
            200 | 204 | 206 => state.request_error() != 0,
            _ => true,
        };
        // SAFETY: fn contract (field accesses only, see the type docs). The bitwise read+write
        // copies `async_http`'s current state into `http` without running destructors: the
        // HTTP thread retains ownership of the source until the request completes, and `http`
        // was initialised in `client::download_stream`.
        unsafe {
            (*this).request_error = result.fail;
            (*this).set_state(*state);
            core::ptr::write((*this).http.as_mut_ptr(), core::ptr::read(async_http));
        }
        wait_until_done
    }

    /// HTTP thread: records one result of the request under `mutex` and returns true if the
    /// caller should post the task to the JS thread.
    ///
    /// On the final result the unlock at the end can be what frees the task: if a task is
    /// already queued (`has_schedule_callback` is set, so nothing gets posted), the JS thread
    /// may be blocked in `on_response`'s `lock()`, and once let in it sees `has_more == false`
    /// and frees the task while this thread is still returning. Hence, on top of the type's
    /// field-access rule, the section is not a `lock_guard()` one (its guard would unlock
    /// through a `&Mutex` into the task) and is released by `Mutex::unlock_raw`, which makes
    /// the releasing store this thread's last access to the task.
    ///
    /// # Safety
    /// `this` is the task registered with the `AsyncHTTP` whose result this is; it is live
    /// because this result has not been published yet. `async_http` is the HTTP thread's live
    /// copy of the request.
    unsafe fn process_http_callback(
        this: *mut Self,
        async_http: &mut AsyncHTTP<'static>,
        mut result: HTTPClientResult,
    ) -> bool {
        let is_done = !result.has_more;
        // SAFETY: fn contract. Every access is a field access or a single call (type docs), and
        // nothing touches the task after `unlock_raw` (`result`, dropped on return, is this
        // thread's own).
        unsafe {
            (*this).mutex.lock();
            // remember the state is atomic load it once, and store it again
            let mut state = (*this).get_state();
            // old state should have more otherwise it's an HTTP-client bug
            debug_assert!(state.has_more());
            let wait_until_done = Self::update_state(this, async_http, &result, &mut state);
            bun_core::scoped_log!(
                S3,
                "state err: {} status_code: {} has_more: {} should_enqueue: {}",
                state.request_error(),
                state.status_code(),
                state.has_more(),
                !wait_until_done || is_done
            );
            result.body_into(&mut (*this).reported_response_buffer.list);
            let should_enqueue = (!wait_until_done || is_done)
                // dont report empty chunks if we have more data to read
                && (is_done || !(*this).reported_response_buffer.list.is_empty())
                // if a task is already queued it will pick this state up; the exchange only
                // happens when we would post, since a set flag without a post stalls the stream.
                && (*this)
                    .has_schedule_callback
                    .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
                    .is_ok();
            Mutex::unlock_raw(&raw const (*this).mutex);
            should_enqueue
        }
    }

    /// this is the AsyncHTTP callback and is always called from the HTTPThread
    ///
    /// # Safety
    /// `this` must be the heap task produced by `Self::new` for this request, live until this
    /// thread publishes the request's final result (the JS thread frees it after that; see the
    /// type docs). `async_http` must be a valid pointer to an initialised `AsyncHTTP` for the
    /// duration of this call.
    pub(crate) fn http_callback(
        this: *mut Self,
        async_http: *mut AsyncHTTP<'static>,
        result: HTTPClientResult,
    ) {
        // SAFETY: fn contract; nothing below holds a reference into the task beyond a single
        // field access or call, and the final result is published inside `process_http_callback`.
        let is_done = !result.has_more;
        // The final callback is where the HTTP thread hands the request back
        // (`embedded_work_finished` below, after `this` may have been freed).
        // SAFETY: `this` is live for the duration of the request.
        let done_handle = is_done.then(|| unsafe { (*this).loop_handle.clone() });
        // SAFETY: as above; `async_http` is the HTTP thread's live copy of the request.
        if unsafe { Self::process_http_callback(this, &mut *async_http, result) } {
            // we are always unlocked here and its safe to enqueue
            // SAFETY: `true` means no task was queued, so the JS thread cannot free the task
            // before this post; `task` is the inline `concurrent_task` field of this heap
            // request and the queue takes ownership of its `next` link. The VM waits for its S3
            // requests (embedded work) before closing its handle: always queued.
            unsafe {
                let task = core::ptr::NonNull::from(
                    (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit),
                );
                let bun_jsc::vm_handle::Posted::Queued = (*this).loop_handle.post_task(task) else {
                    unreachable!(
                        "VM handle closed with an S3 download outstanding on the HTTP thread"
                    );
                };
            }
        }
        if let Some(handle) = done_handle {
            handle.embedded_work_finished();
        }
    }

    /// `HTTPClientResultCallback::release_at_shutdown`: the exiting main
    /// thread parked the HTTP thread, which will not call back; hand the
    /// download back as failed/finished so its VM's wait ends and the JS
    /// thread frees it.
    ///
    /// # Safety
    /// `this` is the live task registered with the callback; HTTP thread parked.
    pub(crate) unsafe fn release_at_shutdown(this: *mut ()) {
        let this = this.cast::<Self>();
        // SAFETY: fn contract — nothing else touches the task now (the JS
        // thread is waiting in the HTTP shutdown), so unlike in
        // `process_http_callback` nothing can free the task while this runs.
        // The critical section still ends in `unlock_raw` so that every
        // HTTP-thread use of `mutex` has the one shape that is sound even when
        // the JS thread is waiting for the lock. The post below only happens
        // when the exchange won, i.e. when no task is queued.
        unsafe {
            let handle = (*this).loop_handle.clone();
            (*this).mutex.lock();
            let mut state = (*this).get_state();
            state.set_has_more(false);
            (*this).request_error = Some(bun_http::Error::Aborted);
            state.set_request_error(1);
            (*this).set_state(state);
            let should_enqueue = (*this)
                .has_schedule_callback
                .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
                .is_ok();
            Mutex::unlock_raw(&raw const (*this).mutex);
            if should_enqueue {
                let task = core::ptr::NonNull::from(
                    (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit),
                );
                let bun_jsc::vm_handle::Posted::Queued = handle.post_task(task) else {
                    unreachable!(
                        "VM handle closed with an S3 download outstanding on the HTTP thread"
                    );
                };
            }
            handle.embedded_work_finished();
        }
    }

    /// VM teardown's stop phase (JS thread): abort the transport so the HTTP
    /// thread fails the request promptly and hands it back.
    ///
    /// # Safety
    /// `this` is live (registered ⇒ not yet freed by `on_response`); JS thread.
    pub(crate) unsafe fn stop_for_vm_teardown(this: *mut Self) {
        // SAFETY: fn contract; `http` is initialised before the task is registered.
        unsafe {
            (*this).signal_store.aborted.store(true, Ordering::Relaxed);
            bun_http::http_thread().schedule_shutdown((*this).http.assume_init_ref());
        }
    }
}

/// Runs on the JS thread once the HTTP thread is done with the task (`on_response`), so unlike
/// the functions above this may take the whole task by reference.
impl Drop for S3HttpDownloadStreamingTask {
    fn drop(&mut self) {
        // KeepAlive::unref now takes an aio EventLoopCtx; the JS-loop ctx is fetched
        // via the global hook (registered by crate::init) — same pattern as
        // `S3HttpSimpleTask::drop` in simple_request.rs.
        self.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        // reported_response_buffer, headers, sign_result, range, proxy_url:
        // dropped automatically (Box/Vec-backed fields).
        // SAFETY: `http` is always initialised before the task is scheduled / dropped.
        let http = unsafe { self.http.assume_init_mut() };
        http.clear_data();
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
pub struct State(pub(crate) u64);

impl State {
    const STATUS_CODE_SHIFT: u32 = 0;
    const REQUEST_ERROR_SHIFT: u32 = 32;
    const HAS_MORE_SHIFT: u32 = 48;

    #[inline]
    const fn status_code(self) -> u32 {
        (self.0 >> Self::STATUS_CODE_SHIFT) as u32
    }
    #[inline]
    fn set_status_code(&mut self, v: u32) {
        self.0 = (self.0 & !0xFFFF_FFFF) | (v as u64);
    }
    #[inline]
    const fn request_error(self) -> u16 {
        (self.0 >> Self::REQUEST_ERROR_SHIFT) as u16
    }
    #[inline]
    fn set_request_error(&mut self, v: u16) {
        self.0 = (self.0 & !(0xFFFF << Self::REQUEST_ERROR_SHIFT))
            | ((v as u64) << Self::REQUEST_ERROR_SHIFT);
    }
    #[inline]
    const fn has_more(self) -> bool {
        (self.0 >> Self::HAS_MORE_SHIFT) & 1 != 0
    }
    #[inline]
    fn set_has_more(&mut self, v: bool) {
        self.0 = (self.0 & !(1 << Self::HAS_MORE_SHIFT)) | ((v as u64) << Self::HAS_MORE_SHIFT);
    }
}

impl Default for State {
    fn default() -> Self {
        // status_code = 0, request_error = 0, has_more = true, _reserved = 0
        State(1u64 << State::HAS_MORE_SHIFT)
    }
}
