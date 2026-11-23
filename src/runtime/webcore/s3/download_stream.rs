use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use bun_core::MutableString;
use bun_event_loop::ConcurrentTask::ConcurrentTask;
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_http::{HTTPClientResult, Headers};
use bun_io::JsKeepAlive;
use bun_s3_signing::credentials::SignResult;
use bun_s3_signing::error::S3Error;

use crate::webcore::s3::client::S3DownloadStreamWrapper;
use crate::webcore::s3::xml_response;
use bun_threading::Mutex;

bun_core::declare_scope!(S3, hidden);

pub struct S3HttpDownloadStreamingTask {
    /// Held while the download is out on the HTTP thread: how it delivers
    /// chunks, and what makes the VM wait for it.
    pub(crate) http_ticket: Option<bun_jsc::Ticket>,
    pub(crate) sign_result: SignResult,
    pub(crate) headers: Headers,
    /// JS thread only.
    pub(crate) wrapper: bun_ptr::AliasableBox<S3DownloadStreamWrapper>,
    pub(crate) has_schedule_callback: AtomicBool,
    pub(crate) signal_store: bun_http::signals::Store,
    pub poll_ref: JsKeepAlive,

    pub(crate) mutex: Mutex,
    pub(crate) reported_response_buffer: MutableString,
    /// `reported_response_buffer` could not grow. HTTP thread only.
    pub(crate) is_out_of_memory: bool,
    /// The HTTP-level failure, if any. Guarded by `mutex`; the `request_error`
    /// bit in `state` mirrors `request_error.is_some()`.
    pub(crate) request_error: Option<bun_http::Error>,
    pub(crate) state: AtomicU64,

    pub(crate) concurrent_task: ConcurrentTask,
    pub(crate) proxy_url: Box<[u8]>,
    pub(crate) async_http_id: u32,
    pub(crate) abort_handle: bun_jsc::AbortHandle,
}

bun_jsc::impl_abort_handle_owner!(S3HttpDownloadStreamingTask, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ not yet freed by `on_response`).
    unsafe {
        (*this).signal_store.aborted.store(true, Ordering::Relaxed);
        bun_http::HTTPThread::schedule_shutdown((*this).async_http_id);
    }
});

// Hot-dispatch tag for `ConcurrentTask::from`.
impl Taskable for S3HttpDownloadStreamingTask {
    const TAG: TaskTag = task_tag::S3HttpDownloadStreamingTask;
    /// The completion frees the task; run it.
    unsafe fn release_unrun(this: *mut Self) {
        S3HttpDownloadStreamingTask::on_response(this);
    }
    /// The completion frees the request; the stream it feeds was aborted with its context
    /// (`abort_handle`).
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl S3HttpDownloadStreamingTask {
    const HOLDS_TICKET: &str = "S3 download on the HTTP thread holds a ticket";

    pub(crate) fn new(init: Self) -> Box<Self> {
        Box::new(init)
    }

    pub(crate) fn get_state(&self) -> State {
        State(self.state.load(Ordering::Acquire))
    }

    pub(crate) fn set_state(&self, state: State) {
        self.state.store(state.0, Ordering::Relaxed);
    }

    /// `on_chunk` and `on_error` run JS, which reaches back into this task through the stream
    /// wrapper's pointer (`pause_receive`, `poll_ref`). No borrow of `this` may span that call,
    /// so this takes the raw pointer and scopes every access to its statement.
    ///
    /// # Safety
    /// `this` is live and exclusively accessed by this thread for the duration of the call
    /// (`on_response`).
    unsafe fn report_progress(this: *mut Self, state: State) {
        let has_more = state.has_more();
        let failed = match state.status_code() {
            200 | 204 | 206 => state.request_error() != 0,
            _ => true,
        };
        // SAFETY: fn contract; the wrapper is a separate allocation, so `*this` is not borrowed.
        let wrapper: &S3DownloadStreamWrapper = unsafe { &(*this).wrapper };
        bun_core::scoped_log!(
            S3,
            "reportProgres failed: {} has_more: {} len: {}",
            failed,
            has_more,
            // SAFETY: fn contract.
            unsafe { (*this).reported_response_buffer.list.len() }
        );

        if failed {
            if has_more {
                return;
            }
            let mut code: &[u8] = b"UnknownError";
            let mut message: &[u8] = b"an unexpected error has occurred";
            let parsed;
            // SAFETY: fn contract.
            if let Some(req_err) = unsafe { (*this).request_error } {
                code = req_err.name().as_bytes();
            } else {
                // SAFETY: fn contract; the buffer is not touched again before `on_error`
                // returns, and `message` is not used after it.
                let bytes = unsafe { (*this).reported_response_buffer.list.as_slice() };
                if !bytes.is_empty() {
                    message = bytes;
                }
                parsed = xml_response::parse_error(bytes);
                if let Some(error) = &parsed {
                    code = error.code.as_deref().unwrap_or(code);
                    message = error.message.as_deref().unwrap_or(message);
                }
            }
            return wrapper.on_error(&S3Error { code, message });
        }

        // dont report empty chunks if we have more data to read
        // SAFETY: fn contract.
        if !has_more || unsafe { (*this).reported_response_buffer.list.len() } > 0 {
            // `core::mem::take` transfers ownership of the buffer, leaving an
            // empty MutableString behind.
            // SAFETY: fn contract; the borrow ends with the statement.
            let chunk = unsafe { core::mem::take(&mut (*this).reported_response_buffer) };
            wrapper.on_chunk(&chunk, has_more);
            // SAFETY: fn contract; `on_chunk` does not free the task, `on_response` does,
            // after this returns.
            unsafe { (*this).reported_response_buffer.reset() };
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
        // Each access below is scoped so no borrow spans `report_progress` (which invokes
        // `on_chunk` or `on_error`).
        let guard = unsafe { (*this).mutex.lock_guard() };
        // the state is atomic let's load it once
        // SAFETY: as above.
        let state = unsafe { (*this).get_state() };
        let has_more = state.has_more();

        // there is no reason to set has_schedule_callback to true if we dont have more data to read
        if has_more {
            // SAFETY: as above.
            unsafe {
                (*this)
                    .has_schedule_callback
                    .store(false, Ordering::Relaxed)
            };
        }
        // SAFETY: as above.
        unsafe { Self::report_progress(this, state) };
        drop(guard);
        if !has_more {
            // SAFETY: the HTTP thread does not call back again.
            unsafe { bun_core::heap::destroy(this) };
        }
    }

    /// this function is only called from the http callback in the HTTPThread and returns true if we
    /// should wait until we are done buffering the response body to report
    /// should only be called when already locked
    fn update_state(
        &mut self,
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
                    state.set_status_code(m.status_code());
                }
            }
            match state.status_code() {
                200 | 204 | 206 => wait_until_done = state.request_error() != 0,
                _ => wait_until_done = true,
            }
            // store the new state
            self.set_state(*state);
        }
        wait_until_done
    }

    /// this functions is only called from the http callback in the HTTPThread and returns true if
    /// we should enqueue another task
    fn process_http_callback(&mut self, mut result: HTTPClientResult) -> bool {
        // lets lock and unlock to be safe we know the state is not in the middle of a callback when locked
        // The RAII guard unlocks on every
        // return path. The guard holds the mutex by raw pointer (see
        // `Mutex::lock_guard`), so `&mut self` stays freely usable while
        // locked, and it drops before this fn returns — strictly before the
        // task can be freed by the main thread.
        let _guard = self.mutex.lock_guard();

        let buffer = &mut self.reported_response_buffer;
        if !self.is_out_of_memory && result.try_body_into(&mut buffer.list).is_err() {
            *buffer = MutableString::default();
            self.is_out_of_memory = true;
            self.signal_store.aborted.store(true, Ordering::Relaxed);
            bun_http::HTTPThread::schedule_shutdown(self.async_http_id);
        }
        if self.is_out_of_memory {
            if result.has_more {
                return false;
            }
            result.fail = Some(bun_alloc::AllocError.into());
        }

        // remember the state is atomic load it once, and store it again
        let mut state = self.get_state();
        // old state should have more otherwise it's an HTTP-client bug
        debug_assert!(state.has_more());
        let is_done = !result.has_more;
        let wait_until_done = self.update_state(&result, &mut state);
        let should_enqueue = !wait_until_done || is_done;
        bun_core::scoped_log!(
            S3,
            "state err: {} status_code: {} has_more: {} should_enqueue: {}",
            state.request_error(),
            state.status_code(),
            state.has_more(),
            should_enqueue
        );

        // Only a body that is being delivered can be resumed: the wrapper resumes as JS takes
        // chunks. An error body is collected whole before it is reported, with no chunk
        // delivered in between, so pausing it would never be undone.
        if !is_done
            && !wait_until_done
            && self.reported_response_buffer.list.len() >= bun_http::signals::BODY_HIGH_WATER_MARK
        {
            self.signal_store.pause_receive();
        }
        if should_enqueue {
            if self.reported_response_buffer.list.is_empty() && !is_done {
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
    /// HTTP request; `mutex` serializes against `on_response`.
    pub(crate) fn http_callback(
        this: *mut Self,
        finished: Option<bun_http::FinishedRequest>,
        result: HTTPClientResult,
    ) {
        drop(finished);
        // SAFETY: `this` is live for the duration of the HTTP request; HTTPThread holds the only
        // concurrent reference and `mutex` serializes against `on_response`.
        let is_done = !result.has_more;
        // No refcount here: on the final callback `on_response` may free `this`
        // as soon as the task is queued, so the ticket has to be out first.
        let done_ticket = is_done.then(|| {
            // SAFETY: as above; HTTP-thread field.
            unsafe { (*this).http_ticket.take() }.expect(Self::HOLDS_TICKET)
        });
        // SAFETY: as above; the HTTP thread is the only one touching it here.
        if unsafe { (*this).process_http_callback(result) } {
            // we are always unlocked here and its safe to enqueue
            // SAFETY: same exclusivity as above; `task` is the inline `concurrent_task` field of
            // this heap request and the queue takes ownership of its `next` link. Not done ⇒
            // `this` (and the ticket in it) outlives the post.
            unsafe {
                let task = core::ptr::NonNull::from((*this).concurrent_task.from(this));
                done_ticket
                    .as_ref()
                    .unwrap_or_else(|| (*this).http_ticket.as_ref().expect(Self::HOLDS_TICKET))
                    .post_intrusive(task);
            }
        }
        drop(done_ticket);
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
        // thread is waiting in the HTTP shutdown).
        unsafe {
            let ticket = (*this).http_ticket.take().expect(Self::HOLDS_TICKET);
            let should_enqueue = {
                let _guard = (*this).mutex.lock_guard();
                let mut state = (*this).get_state();
                state.set_has_more(false);
                (*this).request_error = Some(bun_http::Error::Aborted);
                state.set_request_error(1);
                (*this).set_state(state);
                (*this)
                    .has_schedule_callback
                    .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
                    .is_ok()
            };
            if should_enqueue {
                let task = core::ptr::NonNull::from((*this).concurrent_task.from(this));
                ticket.post_intrusive(task);
            }
            drop(ticket);
        }
    }

    /// A consumer took bytes: undo a pause from either side of the hop.
    pub(crate) fn resume_receive(&self) {
        if self.signal_store.unpause_receive() {
            bun_http::HTTPThread::schedule_receive_resume(self.async_http_id);
        }
    }
}

/// Manual bitfield over a transparent u64. Layout (LSB-first):
///   bits  0..32 : status_code (u32)
///   bits 32..48 : request_error (u16)
///   bit  48     : has_more (bool)
///   bits 49..64 : _reserved (u15)
#[repr(transparent)]
#[derive(Copy, Clone)]
pub(crate) struct State(pub(crate) u64);

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
