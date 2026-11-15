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
use bun_threading::Guarded;

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

    pub(crate) received: Guarded<Received>,
    pub(crate) state: AtomicU64,

    pub(crate) concurrent_task: ConcurrentTask,
    pub(crate) proxy_url: Box<[u8]>,
    pub(crate) async_http_id: u32,
    pub(crate) abort_handle: bun_jsc::AbortHandle,
}

#[derive(Default)]
pub(crate) struct Received {
    buffer: MutableString,
    /// The HTTP-level failure, if any. The `request_error` bit in `state` mirrors `is_some()`.
    request_error: Option<bun_http::Error>,
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

    fn report_progress(wrapper: &S3DownloadStreamWrapper, received: &mut Received, state: State) {
        let has_more = state.has_more();
        let failed = match state.status_code() {
            200 | 204 | 206 => state.request_error() != 0,
            _ => true,
        };
        bun_core::scoped_log!(
            S3,
            "reportProgres failed: {} has_more: {} len: {}",
            failed,
            has_more,
            received.buffer.list.len()
        );

        if failed {
            if has_more {
                return;
            }
            let mut code: &[u8] = b"UnknownError";
            let mut message: &[u8] = b"an unexpected error has occurred";
            let parsed;
            if let Some(req_err) = received.request_error {
                code = req_err.name().as_bytes();
            } else {
                let bytes = received.buffer.list.as_slice();
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
        if !has_more || !received.buffer.list.is_empty() {
            let chunk = core::mem::take(&mut received.buffer);
            wrapper.on_chunk(&chunk, has_more);
        }
    }

    /// this is the task callback from the last task result and is always in the main thread
    ///
    /// # Safety
    /// `this` must be a live heap pointer produced by `Self::new`. When the loaded state's
    /// `has_more` is false this call reclaims and drops the allocation exactly once.
    pub(crate) fn on_response(this: *mut Self) {
        // SAFETY: fn contract. `report_progress` runs JS, which reaches back into `*this` through
        // the wrapper's pointer (`pause_receive`, `poll_ref`), so only the field `received` and the
        // wrapper, a separate allocation, are borrowed across it.
        let (mut received, wrapper): (_, &S3DownloadStreamWrapper) =
            unsafe { ((*this).received.lock(), &(*this).wrapper) };
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
        Self::report_progress(wrapper, &mut received, state);
        drop(received);
        if !has_more {
            // SAFETY: the last access of the HTTP thread was its unlock or the post of this task.
            unsafe { bun_core::heap::destroy(this) };
        }
    }

    /// this function is only called from the http callback in the HTTPThread and returns true if we
    /// should wait until we are done buffering the response body to report
    fn update_state(
        &self,
        received: &mut Received,
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

            received.request_error = result.fail;
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
    fn process_http_callback(
        &self,
        received: &mut Received,
        result: &mut HTTPClientResult,
    ) -> bool {
        // remember the state is atomic load it once, and store it again
        let mut state = self.get_state();
        // old state should have more otherwise it's an HTTP-client bug
        debug_assert!(state.has_more());
        let is_done = !result.has_more;
        let wait_until_done = self.update_state(received, result, &mut state);
        let should_enqueue = !wait_until_done || is_done;
        bun_core::scoped_log!(
            S3,
            "state err: {} status_code: {} has_more: {} should_enqueue: {}",
            state.request_error(),
            state.status_code(),
            state.has_more(),
            should_enqueue
        );

        result.body_into(&mut received.buffer.list);
        // Only a body that is being delivered can be resumed: the wrapper resumes as JS takes
        // chunks. An error body is collected whole before it is reported, with no chunk
        // delivered in between, so pausing it would never be undone.
        if !is_done
            && !wait_until_done
            && received.buffer.list.len() >= bun_http::signals::BODY_HIGH_WATER_MARK
        {
            self.signal_store.pause_receive();
        }
        if should_enqueue {
            if received.buffer.list.is_empty() && !is_done {
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
    /// HTTP request; `received` serializes against `on_response`.
    pub(crate) fn http_callback(
        this: *mut Self,
        finished: Option<bun_http::FinishedRequest>,
        mut result: HTTPClientResult,
    ) {
        drop(finished);
        // SAFETY: `this` is live for the duration of the HTTP request; HTTPThread holds the only
        // concurrent reference and `received` serializes against `on_response`.
        let is_done = !result.has_more;
        // No refcount here: on the final callback `on_response` may free `this`
        // as soon as the task is queued, so the ticket has to be out first.
        let done_ticket = is_done.then(|| {
            // SAFETY: as above; HTTP-thread field.
            unsafe { (*this).http_ticket.take() }.expect(Self::HOLDS_TICKET)
        });
        // SAFETY: as above. A task that is already queued may free `this` after the last unlock.
        let should_enqueue = unsafe {
            Guarded::with_lock_raw(&raw const (*this).received, |received| {
                (*this).process_http_callback(received, &mut result)
            })
        };
        if should_enqueue {
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
            let should_enqueue = Guarded::with_lock_raw(&raw const (*this).received, |received| {
                let mut state = (*this).get_state();
                state.set_has_more(false);
                received.request_error = Some(bun_http::Error::Aborted);
                state.set_request_error(1);
                (*this).set_state(state);
                (*this)
                    .has_schedule_callback
                    .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
                    .is_ok()
            });
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
