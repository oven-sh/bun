use core::cell::Cell;
use core::sync::atomic::Ordering;

use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_http::{AsyncHTTP, HTTPClientResult, HTTPThread, Headers};
use bun_io::JsKeepAlive;
use bun_jsc::{JSGlobalObject, WeakGlobalRef};
use bun_ptr::{BackRef, RefCount};
use bun_s3_signing::credentials::SignResult;
use bun_s3_signing::error::S3Error;
use bun_url::URL;

use crate::webcore::ByteStream;
use crate::webcore::byte_stream::{AfterDelivery, ProducerHold};
use crate::webcore::http_result_inbox::{HttpResultInbox, StoreResult};
use crate::webcore::s3::client::s3_error_to_js;
use crate::webcore::s3::xml_response;
use crate::webcore::streams::{SourceHandle, StreamError, StreamResult};

bun_core::declare_scope!(S3, hidden);

#[derive(bun_ptr::RefCounted)]
pub struct S3HttpDownloadStreamingTask {
    ref_count: RefCount,
    inbox: HttpResultInbox<Received>,
    sign_result: SignResult,
    headers_buf: Vec<u8>,
    stream: ProducerHold,
    path: Box<[u8]>,
    global: WeakGlobalRef,
    poll_ref: JsKeepAlive,

    proxy_url: Box<[u8]>,
    async_http_id: Cell<u32>,
    abort_handle: bun_jsc::AbortHandle,
}

bun_core::intrusive_field!(S3HttpDownloadStreamingTask, inbox: HttpResultInbox<Received>);

#[derive(Default)]
struct Received {
    buffer: Vec<u8>,
    /// The HTTP-level failure, if any.
    request_error: Option<bun_http::Error>,
    /// 0 until the response head has arrived.
    status_code: u32,
    has_more: bool,
}

bun_jsc::impl_abort_handle_owner!(S3HttpDownloadStreamingTask, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live.
    unsafe { &*this }.abort_transport();
});

// Hot-dispatch tag for `ConcurrentTask::from`.
impl Taskable for S3HttpDownloadStreamingTask {
    const TAG: TaskTag = task_tag::S3HttpDownloadStreamingTask;
    /// The completion frees the task; run it.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract; only `inbox` posts this tag.
        unsafe { S3HttpDownloadStreamingTask::on_response(this) };
    }
    /// The completion frees the request; the stream it feeds was aborted with its context
    /// (`abort_handle`).
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

pub(crate) fn fail_stream(
    stream: &ProducerHold,
    global: &JSGlobalObject,
    path: &[u8],
    err: &S3Error,
) {
    let Some(bytes) = stream.take() else {
        return;
    };
    bytes.on_data(StreamResult::Err(StreamError::JSValue(
        bun_jsc::strong::Optional::create(s3_error_to_js(err, global, Some(path)), global),
    )));
}

impl S3HttpDownloadStreamingTask {
    pub(crate) fn schedule(
        cx: &bun_jsc::JsThread<'_>,
        sign_result: SignResult,
        headers: Headers,
        proxy_url: Box<[u8]>,
        path: &[u8],
        stream: ProducerHold,
    ) {
        let vm = cx.vm();
        let task = Box::new(S3HttpDownloadStreamingTask {
            ref_count: RefCount::init(),
            inbox: HttpResultInbox::new(Default::default(), Default::default()),
            sign_result,
            proxy_url,
            stream,
            path: Box::<[u8]>::from(path),
            global: WeakGlobalRef::new(cx.global()),
            headers_buf: headers.buf,
            poll_ref: JsKeepAlive::active(),
            async_http_id: Cell::new(0),
            abort_handle: bun_jsc::AbortHandle::for_owner::<S3HttpDownloadStreamingTask>(),
        });

        HttpResultInbox::schedule(cx, task, None, |task| {
            let http = AsyncHTTP::init(
                bun_http::Method::GET,
                URL::parse(&task.sign_result.url),
                headers.entries,
                &task.headers_buf,
                b"",
                bun_http::FetchRedirect::Follow,
                bun_http::async_http::Options {
                    http_proxy: (!task.proxy_url.is_empty()).then(|| URL::parse(&task.proxy_url)),
                    verbose: Some(vm.get_verbose_fetch()),
                    signals: Some(task.inbox.signal_store.to_with_backpressure()),
                    reject_unauthorized: Some(vm.get_tls_reject_unauthorized()),
                    tls_props: crate::socket::http_client_defaults(vm),
                    ..Default::default()
                },
            );
            task.async_http_id.set(http.async_http_id);
            // Cleared before `task` is freed (`ProducerHold::take`).
            task.stream
                .set_producer(SourceHandle::S3DownloadBody(BackRef::new(task)));
            http.enable_response_body_streaming();
            http
        });
    }

    fn report_progress(&self, received: &mut Received) {
        let failed = received.has_failed();
        bun_core::scoped_log!(
            S3,
            "reportProgres failed: {} has_more: {} len: {}",
            failed,
            received.has_more,
            received.buffer.len()
        );

        if failed {
            debug_assert!(!received.has_more);
            let mut code: &[u8] = b"UnknownError";
            let mut message: &[u8] = b"an unexpected error has occurred";
            let parsed;
            if let Some(req_err) = received.request_error {
                code = req_err.name().as_bytes();
            } else {
                let bytes = received.buffer.as_slice();
                if !bytes.is_empty() {
                    message = bytes;
                }
                parsed = xml_response::parse_error(bytes);
                if let Some(error) = &parsed {
                    code = error.code.as_deref().unwrap_or(code);
                    message = error.message.as_deref().unwrap_or(message);
                }
            }
            return self.on_error(&S3Error { code, message });
        }

        // dont report empty chunks if we have more data to read
        if !received.has_more || !received.buffer.is_empty() {
            let chunk = core::mem::take(&mut received.buffer);
            self.on_chunk(&chunk, received.has_more);
        }
    }

    /// JS thread, once per posted task.
    ///
    /// # Safety
    /// As [`HttpResultInbox::take`].
    pub(crate) unsafe fn on_response(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe {
            HttpResultInbox::take(this, |this, mut received| {
                // Under the lock, so that a slow sink holds back a tunnel, which reads on while paused.
                this.report_progress(&mut received);
            });
        }
    }

    fn on_error(&self, err: &S3Error) {
        let Some(global) = self.global.get() else {
            return self.on_stream_cancelled();
        };
        fail_stream(&self.stream, &global, &self.path, err);
    }

    fn on_chunk(&self, chunk: &[u8], has_more: bool) {
        if self.global.get().is_none() {
            return self.on_stream_cancelled();
        }
        if has_more {
            let Some(bytes) = self.stream.bytes() else {
                return;
            };
            bytes.on_data(StreamResult::Temporary(chunk));
            // `on_data` can cancel us, which releases the hold.
            if self.stream.is_held() {
                self.after_chunk_delivered(&bytes);
            }
            return;
        }
        let Some(bytes) = self.stream.take() else {
            return;
        };
        bytes.on_data(StreamResult::TemporaryAndDone(chunk));
    }

    /// The other half of this rule is in `store_result` (HTTP thread).
    fn after_chunk_delivered(&self, bytes: &ByteStream) {
        match self.stream.after_delivery(bytes) {
            AfterDelivery::Resume => self.resume_receive(),
            AfterDelivery::Pause => self.inbox.signal_store.pause_receive(),
            AfterDelivery::Park => {
                self.inbox.signal_store.pause_receive();
                if self.stream.park() {
                    self.poll_ref.unref(bun_io::js_vm_ctx());
                }
            }
        }
    }

    fn unpark(&self) {
        if self.stream.unpark() {
            self.poll_ref.ref_(bun_io::js_vm_ctx());
        }
    }

    pub(crate) fn on_stream_drained(&self) {
        self.unpark();
        self.resume_receive();
    }

    pub(crate) fn on_consumer_attached(&self) {
        self.unpark();
    }

    /// The stream's wrapper was collected: nothing can read the rest. Inside a GC sweep;
    /// touches no JS cell.
    pub(crate) fn on_stream_collected(&self) {
        self.on_stream_cancelled();
    }

    pub(crate) fn on_stream_cancelled(&self) {
        // The download may still be in progress, but `on_chunk` will see no stream and skip
        // delivery. When the download finishes (has_more == false) the task is freed.
        self.stream.release();
        self.poll_ref.unref(bun_io::js_vm_ctx());
        // Without this, a server that never sends the terminal chunk would leak the task.
        self.abort_transport();
    }

    /// Only the first call schedules a shutdown.
    fn abort_transport(&self) {
        if !self
            .inbox
            .signal_store
            .aborted
            .swap(true, Ordering::Relaxed)
        {
            HTTPThread::schedule_shutdown(self.async_http_id.get());
        }
    }

    /// A consumer took bytes: undo a pause from either side of the hop.
    fn resume_receive(&self) {
        if self.inbox.signal_store.unpause_receive() {
            HTTPThread::schedule_receive_resume(self.async_http_id.get());
        }
    }
}

impl Received {
    fn has_failed(&self) -> bool {
        !matches!(self.status_code, 200 | 204 | 206) || self.request_error.is_some()
    }
}

impl StoreResult for Received {
    fn store_result(
        &mut self,
        signal_store: &bun_http::signals::Store,
        result: &mut HTTPClientResult<'_>,
    ) -> bool {
        self.request_error = result.fail;
        self.has_more = result.has_more;
        if self.status_code == 0
            && let Some(metadata) = &result.metadata
        {
            self.status_code = metadata.status_code();
        }
        // if we got a error or fail wait until we are done buffering the response body to report
        let wait_until_done = self.has_failed();
        bun_core::scoped_log!(
            S3,
            "state err: {} status_code: {} has_more: {} wait_until_done: {}",
            self.request_error.is_some(),
            self.status_code,
            result.has_more,
            wait_until_done
        );

        result.body_into(&mut self.buffer);
        // Only a body that is being delivered can be resumed: the task resumes as JS takes
        // chunks. An error body is collected whole before it is reported, with no chunk
        // delivered in between, so pausing it would never be undone.
        if result.has_more
            && !wait_until_done
            && self.buffer.len() >= bun_http::signals::BODY_HIGH_WATER_MARK
        {
            signal_store.pause_receive();
        }
        !wait_until_done && !self.buffer.is_empty()
    }
}
