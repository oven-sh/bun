// When we start the request we will buffer data until partSize is reached or the last chunk is received.
// If the buffer is smaller than partSize, it will be sent as a single request. Otherwise, a multipart upload will be initiated.
// If we send a single request it will retry until the maximum retry count is reached. Each request holds a reference to MultiPartUpload until it is answered.
// When sending a multipart upload, if there is space in the queue, the part is enqueued, and the request starts immediately.
// If the queue is full, it waits to be drained before starting a new part request.
// Each part maintains a reference to MultiPartUpload until completion.
// If a part is canceled or fails early, the allocated slice is freed, and the reference is removed. If a part completes successfully, an etag is received, the allocated slice is deallocated, and the etag is appended to multipart_etags. If a part request fails, it retries until the maximum retry count is reached. If it still fails, MultiPartUpload is marked as failed and its reference is removed.
// If all parts succeed, a complete request is sent.
// If any part fails, a rollback request deletes the uploaded parts. The first rollback or commit request takes the reference in `self_ref`. Once commit or rollback finishes, the reference count is decremented, and MultiPartUpload is freed. These requests retry up to the maximum retry count on a best-effort basis.

//                Start Upload
//                       │
//                       ▼
//               Buffer Incoming Data
//                       │
//                       │
//          ┌────────────┴────────────────┐
//          │                             │
//          ▼                             ▼
// Buffer < PartSize             Buffer >= PartSize
//  and is Last Chunk                     │
//          │                             │
//          │                             │
//          │                             │
//          │                             │
//          │                             ▼
//          │                  Start Multipart Upload
//          │                             │
//          │                  Initialize Parts Queue
//          │                             │
//          │                   Process Upload Parts
//          │                             │
//          │                  ┌──────────┴──────────┐
//          │                  │                     │
//          │                  ▼                     ▼
//          │             Queue Has Space       Queue Full
//          │                  │                     │
//          │                  │                     ▼
//          │                  │              Wait for Queue
//          │                  │                     │
//          │                  └──────────┬──────────┘
//          │                             │
//          │                             ▼
//          │                     Start Part Upload
//          │               (Reference MultiPartUpload)
//          │                             │
//          │                  ┌─────────┼─────────┐
//          │                  │         │         │
//          │                  ▼         ▼         ▼
//          │               Part      Success   Failure
//          │             Canceled       │         │
//          │                  │         │     Retry Part
//          │                  │         │         │
//          │               Free       Free    Max Retries?
//          │               Slice      Slice    │        │
//          │                  │         │      No       Yes
//          │               Deref    Add eTag   │        │
//          │                MPU    to Array    │    Fail MPU
//          │                  │         │      │        │
//          │                  │         │      │    Deref MPU
//          │                  └─────────┼──────┘        │
//          │                            │               │
//          │                            ▼               │
//          │                   All Parts Complete?      │
//          │                            │               │
//          │                    ┌───────┴───────┐       │
//          │                    │               │       │
//          │                    ▼               ▼       │
//          │               All Success     Some Failed  │
//          │                    │               │       │
//          │                    ▼               ▼       │
//          │              Send Commit     Send Rollback │
//          │             (Takes Ref)     (Takes Ref)    │
//          │                    │               │       │
//          │                    └───────┬───────┘       │
//          │                            │               │
//          │                            ▼               │
//          │                     Retry if Failed        │
//          │                    (Best Effort Only)      │
//          │                            │               │
//          │                            ▼               │
//          │                     Deref Final MPU        │
//          │                            │               │
//          ▼                            │               │
//  Single Upload Request                │               │
//          │                            │               │
//          └────────────────────────────┴───────────────┘
//                         │
//                         ▼
//                        End

use core::cell::{Cell, OnceCell};
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::AllocError;
use bun_collections::IntegerBitSet;
use bun_core::{declare_scope, scoped_log};
use bun_io::JsKeepAlive;
use bun_io::StreamBuffer;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JsCell};
use bun_ptr::RefPtr;
use bun_s3_signing::acl::ACL;
use bun_s3_signing::credentials::S3Credentials;
use bun_s3_signing::error::S3Error;
use bun_s3_signing::storage_class::StorageClass;

// File-level mods are declared flat in `webcore.rs` via `#[path]`, so `super`
// here is `crate::webcore`, not the `s3` directory. Route through the `s3`
// re-export hub instead.
use crate::webcore::s3::client::S3UploadStreamWrapper;
use crate::webcore::s3::multipart_options::MultiPartUploadOptions;
use crate::webcore::s3::simple_request::{
    self as s3_simple_request, S3CommitResult, S3DeleteResult, S3DownloadResult, S3PartResult,
    S3UploadResult, execute_simple_s3_request,
};
use crate::webcore::s3::xml_response;
use crate::webcore::streams::{EncodedChunk, NetworkSink};
use bun_collections::index_sort;

declare_scope!(S3MultiPartUpload, hidden);

#[derive(bun_ptr::CellRefCounted)]
pub struct MultiPartUpload {
    /// Taken on the move to `State::Finished`.
    pub(crate) self_ref: Cell<Option<RefPtr<MultiPartUpload>>>,
    pub(crate) queue: OnceCell<Box<[UploadPart]>>,
    pub(crate) available: Cell<IntegerBitSet<{ Self::MAX_QUEUE_SIZE }>>,

    pub(crate) current_part_number: Cell<u16>,
    pub(crate) ref_count: Cell<u32>,
    pub(crate) ended: Cell<bool>,

    pub(crate) options: Cell<MultiPartUploadOptions>,
    pub(crate) acl: Option<ACL>,
    pub(crate) storage_class: Option<StorageClass>,
    pub(crate) request_payer: bool,
    pub(crate) credentials: RefPtr<S3Credentials>,
    pub poll_ref: JsKeepAlive,
    /// An upload waits for its script to write more, which the script of a `Bun.ModuleGraph` that
    /// was disposed never does: the graph's context fails it.
    pub(crate) abort_handle: bun_jsc::AbortHandle,
    /// The context of the script that started the upload: its requests are that script's.
    pub(crate) context: bun_jsc::ContextId,
    pub(crate) vm: &'static VirtualMachine,
    // JSC_BORROW per LIFETIMES.tsv row 1886 — rust_type `&JSGlobalObject` used verbatim
    pub global_this: GlobalRef,

    pub(crate) buffered: JsCell<StreamBuffer>,
    /// Bytes accepted by `write*` (after encoding): what a streamed `Bun.write`/`writer.end()`
    /// resolves with.
    pub(crate) uploaded_bytes: Cell<u64>,

    pub path: Box<[u8]>,
    /// As `S3SimpleRequestOptions::proxy_url`.
    pub(crate) proxy: Option<Box<[u8]>>,
    pub(crate) content_type: Option<Box<[u8]>>,
    pub(crate) content_disposition: Option<Box<[u8]>>,
    pub(crate) content_encoding: Option<Box<[u8]>>,
    pub(crate) upload_id: JsCell<Box<[u8]>>,

    pub(crate) multipart_etags: JsCell<Vec<UploadPartResult>>,
    pub(crate) multipart_upload_list: JsCell<Vec<u8>>, // was bun.Vec<u8>

    pub(crate) state: Cell<State>,

    /// Taken by `notify_finished`.
    pub(crate) callback: JsCell<Option<UploadCallback>>,
}

/// Told when the upload can take more bytes and when it finishes.
pub(crate) enum UploadCallback {
    Writer(RefPtr<NetworkSink>),
    Stream(RefPtr<S3UploadStreamWrapper>),
}

bun_jsc::impl_abort_handle_owner!(MultiPartUpload, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ not dropped); the scoped ref keeps it so
    // while the completion callback releases others.
    unsafe {
        let _guard = RefPtr::init_ref(this);
        // (What its callback settles is settled in the stopped context: for nobody.)
        let _ = (*this).fail(S3Error {
            code: b"AbortError",
            message: b"The operation was aborted",
        });
    }
});

/// [`MultiPartUpload::fail_writer_collected`]'s task.
pub(crate) struct WriterCollected;
impl bun_event_loop::RefTask for WriterCollected {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::S3UploadWriterCollected;
    type Ref = RefPtr<MultiPartUpload>;
    /// The context that stopped fails the upload through `abort_handle`.
    fn release_unrun(_: Self::Ref) {}
    /// The context of the script that made the writer.
    fn context(upload: &Self::Ref) -> bun_event_loop::ContextId {
        upload.context
    }
}
impl WriterCollected {
    pub(crate) fn run(upload: &MultiPartUpload) -> bun_jsc::JsResult<()> {
        upload.fail(S3Error {
            code: b"UnknownError",
            message: b"S3 writer was garbage collected before end() was called",
        })
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum State {
    WaitStreamCheck,
    NotStarted,
    MultipartStarted,
    MultipartCompleted,
    SinglefileStarted,
    Finished,
}

impl MultiPartUpload {
    fn context(&self) -> &bun_jsc::ScriptExecutionContext {
        self.vm.context_of(self.context)
    }

    fn notify_writable(&self, flushed: u64) {
        let sink = match self.callback.get() {
            Some(UploadCallback::Writer(sink)) => sink.as_ptr(),
            // After `end()` the stream has nothing left to write.
            Some(UploadCallback::Stream(wrapper))
                if !self.ended.get()
                    && let Some(sink) = &wrapper.sink =>
            {
                sink.as_ptr()
            }
            _ => return,
        };
        NetworkSink::on_writable(self, sink, flushed);
    }

    fn notify_finished(&self, result: S3UploadResult) -> bun_jsc::JsResult<()> {
        bun_removable_features::removable_body_behind_value!(S3Client, {
            match self.callback.take().expect("an upload finishes once") {
                UploadCallback::Writer(sink) => NetworkSink::on_finished(&sink, self, result),
                UploadCallback::Stream(wrapper) => S3UploadStreamWrapper::resolve(&wrapper, result),
            }
        })
    }

    const MAX_QUEUE_SIZE: usize = MultiPartUploadOptions::MAX_QUEUE_SIZE as usize;
    const MAX_UPLOAD_ID_LEN: usize = 2000;
    // `const AWS = S3Credentials;` — type alias unused in this file; dropped.
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum PartState {
    NotAssigned = 0,
    Pending = 1,
    Started = 2,
    Completed = 3,
    Canceled = 4,
}

pub(crate) struct UploadPart {
    pub(crate) data: JsCell<Vec<u8>>,
    pub(crate) state: Cell<PartState>,
    pub(crate) part_number: Cell<u16>, // max is 10,000
    pub(crate) retry: Cell<u8>,        // auto retry, decrement until 0 and fail after this
    pub(crate) index: Cell<u8>,
}

pub(crate) struct UploadPartResult {
    pub(crate) number: u16,
    pub(crate) etag: Box<[u8]>,
}

/// Selects the bytes of `buffered` that a new part uploads.
#[derive(Clone, Copy)]
enum PartBytes {
    /// All of them. The buffer's allocation is moved into the part.
    Whole,
    /// A copy of the first `usize` bytes.
    First(usize),
}

impl UploadPart {
    fn free_data(&self) {
        self.data.set(Vec::new());
    }

    pub(crate) fn on_part_response(
        ctx: &RefPtr<MultiPartUpload>,
        index: u8,
        result: S3PartResult,
    ) -> bun_jsc::JsResult<()> {
        let this = &ctx.queue.get().expect("a part was sent")[usize::from(index)];
        let part_number = this.part_number.get();

        if this.state.get() == PartState::Canceled || ctx.state.get() == State::Finished {
            scoped_log!(S3MultiPartUpload, "onPartResponse {} canceled", part_number);
            this.free_data();
            return Ok(());
        }

        this.state.set(PartState::Completed);

        match result {
            S3PartResult::Failure(err) => {
                let retry = this.retry.get();
                if retry > 0 {
                    scoped_log!(S3MultiPartUpload, "onPartResponse {} retry", part_number);
                    this.retry.set(retry - 1);
                    // retry failed
                    this.perform(ctx)
                } else {
                    scoped_log!(S3MultiPartUpload, "onPartResponse {} failed", part_number);
                    this.state.set(PartState::NotAssigned);
                    this.free_data();
                    ctx.fail(err)
                }
            }
            S3PartResult::Etag(etag) => {
                scoped_log!(S3MultiPartUpload, "onPartResponse {} success", part_number);
                let sent = this.data.get().len();
                this.free_data();
                // we will need to order this
                ctx.multipart_etags.with_mut(|etags| {
                    etags.push(UploadPartResult {
                        number: part_number,
                        etag: Box::<[u8]>::from(etag),
                    });
                });
                this.state.set(PartState::NotAssigned);
                // mark as available
                let mut available = ctx.available.get();
                available.set(usize::from(index));
                ctx.available.set(available);
                // drain more
                MultiPartUpload::drain_enqueued_parts(ctx, sent as u64)
            }
        }
    }

    fn perform(&self, ctx: &RefPtr<MultiPartUpload>) -> bun_jsc::JsResult<()> {
        let mut params_buffer = [0u8; 2048];
        let written = {
            let mut w: &mut [u8] = &mut params_buffer[..];
            write!(
                w,
                "?partNumber={}&uploadId={}&x-id=UploadPart",
                self.part_number.get(),
                BStr::new(ctx.upload_id.get()),
            )
            .expect("unreachable");
            2048 - w.len()
        };
        let search_params = &params_buffer[..written];
        execute_simple_s3_request(
            &ctx.credentials,
            ctx.context(),
            s3_simple_request::S3RequestOptions {
                path: &ctx.path,
                method: bun_http::Method::PUT,
                proxy_url: ctx.proxy_url(),
                body: self.data.get(),
                search_params: Some(search_params),
                request_payer: ctx.request_payer,
                ..Default::default()
            },
            s3_simple_request::S3Callback::Part(ctx.clone(), self.index.get()),
        )
    }

    fn start(&self, ctx: &RefPtr<MultiPartUpload>) -> bun_jsc::JsResult<()> {
        if self.state.get() != PartState::Pending || ctx.state.get() != State::MultipartCompleted {
            return Ok(());
        }
        self.state.set(PartState::Started);
        self.perform(ctx)
    }

    fn cancel(&self) {
        let state = self.state.replace(PartState::Canceled);

        match state {
            PartState::Pending => {
                self.free_data();
            }
            // if is not pending we will free later or is already freed
            _ => {}
        }
    }
}

impl MultiPartUpload {
    fn send_single(this: &RefPtr<Self>) -> bun_jsc::JsResult<()> {
        execute_simple_s3_request(
            &this.credentials,
            this.context(),
            s3_simple_request::S3RequestOptions {
                path: &this.path,
                method: bun_http::Method::PUT,
                proxy_url: this.proxy_url(),
                body: this.buffered.get().slice(),
                content_type: this.content_type.as_deref(),
                content_disposition: this.content_disposition.as_deref(),
                content_encoding: this.content_encoding.as_deref(),
                acl: this.acl,
                storage_class: this.storage_class,
                request_payer: this.request_payer,
                ..Default::default()
            },
            s3_simple_request::S3Callback::SingleSend(this.clone()),
        )
    }

    pub(crate) fn single_send_upload_response(
        this: &RefPtr<Self>,
        result: S3UploadResult,
    ) -> bun_jsc::JsResult<()> {
        if this.state.get() == State::Finished {
            return Ok(());
        }
        match result {
            S3UploadResult::Failure(err) => {
                let mut options = this.options.get();
                if options.retry > 0 {
                    scoped_log!(
                        S3MultiPartUpload,
                        "singleSendUploadResponse {} retry",
                        options.retry
                    );
                    options.retry -= 1;
                    this.options.set(options);
                    Self::send_single(this)
                } else {
                    scoped_log!(S3MultiPartUpload, "singleSendUploadResponse failed");
                    this.fail(err)
                }
            }
            S3UploadResult::Success => {
                scoped_log!(S3MultiPartUpload, "singleSendUploadResponse success");

                this.notify_writable(this.buffered.get().size() as u64);
                this.done()
            }
        }
    }

    /// This is the only place we allocate the queue or the parts, this is responsible for the flow of parts and the max allowed concurrency
    /// The bytes are only removed from `buffered` if the queue has a free slot, and then the part owns them.
    fn get_create_part(&self, bytes: PartBytes) -> Option<&UploadPart> {
        let mut available = self.available.get();
        let Some(index) = available.find_first_set() else {
            // this means that the queue is full and we cannot flush it
            return None;
        };
        let queue_size = self.options.get().queue_size as usize;
        if index >= queue_size {
            // ops too much concurrency wait more
            return None;
        }
        available.unset(index);
        self.available.set(available);
        let queue = self.queue.get_or_init(|| {
            // queueSize will never change and is small (max 255)
            let mut queue: Vec<UploadPart> = Vec::with_capacity(queue_size);
            // zero set just in case
            for _ in 0..queue_size {
                queue.push(UploadPart {
                    data: JsCell::default(),
                    part_number: Cell::new(0),
                    index: Cell::new(0),
                    retry: Cell::new(0),
                    state: Cell::new(PartState::NotAssigned),
                });
            }
            queue.into_boxed_slice()
        });
        let part_number = self.current_part_number.get();
        self.current_part_number.set(part_number + 1);

        let queue_item = &queue[index];
        let data = match bytes {
            PartBytes::Whole => self.buffered.take().list,
            PartBytes::First(len) => self.buffered.get().slice()[..len].to_vec(),
        };
        queue_item.data.set(data);
        queue_item.part_number.set(part_number);
        queue_item.index.set(index as u8); // @truncate
        queue_item.retry.set(self.options.get().retry);
        queue_item.state.set(PartState::Pending);
        Some(queue_item)
    }

    /// Drain the parts, this is responsible for starting the parts and processing the buffered data
    fn drain_enqueued_parts(this: &RefPtr<Self>, flushed: u64) -> bun_jsc::JsResult<()> {
        let state = this.state.get();
        if state == State::Finished || state == State::SinglefileStarted {
            return Ok(());
        }
        // check pending to start or transformed buffered ones into tasks
        if state == State::MultipartCompleted {
            if let Some(queue) = this.queue.get() {
                for part in queue {
                    if part.state.get() == PartState::Pending {
                        // lets start the part request
                        part.start(this)?;
                    }
                }
            }
        }
        let part_size = this.part_size_in_bytes();
        if this.ended.get() || this.buffered.get().size() >= part_size {
            Self::process_multi_part(this, part_size)?;
        }

        // empty queue
        if this.is_queue_empty() {
            this.notify_writable(flushed);
            // `notify_writable` may re-enter and enqueue a final part; re-check.
            if this.ended.get() && this.is_queue_empty() {
                this.done()?;
            }
        } else if !this.has_backpressure() && flushed > 0 {
            // we have more space in the queue, we can drain more
            this.notify_writable(flushed);
        }
        Ok(())
    }

    pub(crate) fn fail(&self, err: S3Error) -> bun_jsc::JsResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "fail {}:{}",
            BStr::new(err.code),
            BStr::new(err.message)
        );
        self.ended.set(true);
        if let Some(queue) = self.queue.get() {
            for task in queue {
                if task.state.get() != PartState::NotAssigned {
                    task.cancel();
                }
            }
        }
        if self.state.get() != State::Finished {
            let old_state = self.state.replace(State::Finished);
            self.abort_handle.leave();
            let self_ref = self.take_self_ref();
            self.notify_finished(S3UploadResult::Failure(err))?;
            // Nothing more is expected for this upload (a rollback request keeps the loop alive
            // itself), and whoever still holds a ref may hold it for as long as the collector likes.
            self.poll_ref.unref(bun_io::js_vm_ctx());

            if old_state == State::MultipartCompleted {
                // we are a multipart upload so we need to rollback
                self.rollback_multi_part_request(self_ref)?;
            }
        }
        Ok(())
    }

    /// `fail` from a task: the caller is a finalizer inside a GC sweep, and `fail` settles promises.
    pub(crate) fn fail_writer_collected(this: RefPtr<Self>) {
        let event_loop = this.vm.event_loop();
        event_loop.enqueue_task(bun_event_loop::Task::from_ref::<WriterCollected>(this));
    }

    fn take_self_ref(&self) -> RefPtr<Self> {
        self.self_ref.take().expect("an upload finishes once")
    }

    fn done(&self) -> bun_jsc::JsResult<()> {
        let state = self.state.get();
        if state == State::MultipartCompleted && self.is_queue_empty() {
            // we are a multipart upload so we need to send the etags and commit
            self.state.set(State::Finished);
            self.multipart_upload_list.with_mut(|list| {
                // start the multipart upload list
                list.extend_from_slice(
                    b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">",
                );
                self.multipart_etags.with_mut(|etags| {
                    // sort the etags
                    index_sort::sort_slice_by(etags, |a, b| a.number.cmp(&b.number));
                    for tag in etags.drain(..) {
                        write!(
                            list,
                            "<Part><PartNumber>{}</PartNumber><ETag>{}</ETag></Part>",
                            tag.number,
                            BStr::new(&tag.etag),
                        )
                        .expect("oom");
                        // tag.etag (Box<[u8]>) freed at end of iteration
                    }
                });
                list.extend_from_slice(b"</CompleteMultipartUpload>");
            });
            self.multipart_etags.set(Vec::new());
            self.commit_multi_part_request(self.take_self_ref())
        } else if state == State::SinglefileStarted {
            self.state.set(State::Finished);
            // single file upload no need to commit
            let _self_ref = self.take_self_ref();
            self.notify_finished(S3UploadResult::Success)
        } else {
            Ok(())
        }
    }

    /// Result of the Multipart request, after this we can start draining the parts
    pub(crate) fn start_multi_part_request_result(
        this: &RefPtr<Self>,
        result: S3DownloadResult,
    ) -> bun_jsc::JsResult<()> {
        // `fail` ran while this request was in flight: an upload the server created is still open.
        let failed = this.state.get() == State::Finished;
        match result {
            S3DownloadResult::Failure(err) => {
                if failed {
                    return Ok(());
                }
                scoped_log!(
                    S3MultiPartUpload,
                    "startMultiPartRequestResult {} failed {}: {}",
                    BStr::new(&this.path),
                    BStr::new(err.message),
                    BStr::new(err.message)
                );
                this.fail(err)
            }
            S3DownloadResult::Success(response) => {
                // response.body is bun.MutableString — `list` is a Vec<u8>
                let slice = response.body.list.as_slice();
                // <InitiateMultipartUploadResult><Bucket/><Key/><UploadId/></…>
                let upload_id = xml_response::parse(slice, |root| {
                    (root.name == b"InitiateMultipartUploadResult")
                        .then(|| root.child_text(b"UploadId"))
                        .flatten()
                })
                .flatten()
                // It goes into query strings as is: printable, and nothing
                // that would end or split a query value.
                .filter(|id| {
                    !id.is_empty()
                        && id.len() <= Self::MAX_UPLOAD_ID_LEN
                        && id
                            .iter()
                            .all(|&b| b.is_ascii_graphic() && !matches!(b, b'&' | b'#' | b'?'))
                });
                let valid = upload_id.is_some();
                if let Some(upload_id) = upload_id {
                    this.upload_id.set(upload_id);
                }
                if failed {
                    if valid {
                        scoped_log!(
                            S3MultiPartUpload,
                            "startMultiPartRequestResult {} aborting after fail id: {}",
                            BStr::new(&this.path),
                            BStr::new(this.upload_id.get())
                        );
                        this.rollback_multi_part_request(this.clone())?;
                    }
                    return Ok(());
                }
                if !valid {
                    // Unknown type of response error from AWS
                    scoped_log!(
                        S3MultiPartUpload,
                        "startMultiPartRequestResult {} failed invalid id",
                        BStr::new(&this.path)
                    );
                    this.fail(S3Error {
                        code: b"UnknownError",
                        message: b"Failed to initiate multipart upload",
                    })?;
                    return Ok(());
                }
                scoped_log!(
                    S3MultiPartUpload,
                    "startMultiPartRequestResult {} success id: {}",
                    BStr::new(&this.path),
                    BStr::new(this.upload_id.get())
                );
                this.state.set(State::MultipartCompleted);
                // start draining the parts
                Self::drain_enqueued_parts(this, 0)
            }
            // this is "unreachable" but we cover in case AWS returns 404
            S3DownloadResult::NotFound(_) => {
                if failed {
                    return Ok(());
                }
                this.fail(S3Error {
                    code: b"UnknownError",
                    message: b"Failed to initiate multipart upload",
                })
            }
        }
    }

    /// We do a best effort to commit the multipart upload, if it fails we will retry, if it still fails we will fail the upload
    pub(crate) fn on_commit_multi_part_request(
        this: &RefPtr<Self>,
        result: S3CommitResult,
    ) -> bun_jsc::JsResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "onCommitMultiPartRequest {}",
            BStr::new(this.upload_id.get())
        );

        match result {
            S3CommitResult::Failure(err) => {
                let mut options = this.options.get();
                // (Retried in the context of the script that uploads: once that has stopped the
                // request would only be aborted again.)
                if options.retry > 0 && !this.context().is_stopped() {
                    options.retry -= 1;
                    this.options.set(options);
                    // retry commit
                    return this.commit_multi_part_request(this.clone());
                }
                this.state.set(State::Finished);
                let r = this.notify_finished(S3UploadResult::Failure(err));
                // The store still holds the parts.
                let rolled_back = this.rollback_multi_part_request(this.clone());
                r.and(rolled_back)
            }
            S3CommitResult::Success => {
                this.state.set(State::Finished);
                this.notify_finished(S3UploadResult::Success)
            }
        }
    }

    /// We do a best effort to rollback the multipart upload, if it fails we will retry, if it still we just deinit the upload
    pub(crate) fn on_rollback_multi_part_request(
        this: &RefPtr<Self>,
        result: S3DeleteResult,
    ) -> bun_jsc::JsResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "onRollbackMultiPartRequest {}",
            BStr::new(this.upload_id.get())
        );
        match result {
            S3DeleteResult::Failure(_err) => {
                let mut options = this.options.get();
                if options.retry > 0 {
                    options.retry -= 1;
                    this.options.set(options);
                    // retry rollback
                    return this.rollback_multi_part_request(this.clone());
                }
                Ok(())
            }
            // 404: the store no longer has the upload, which is what a rollback is for.
            S3DeleteResult::Success | S3DeleteResult::NotFound(_) => Ok(()),
        }
    }

    fn commit_multi_part_request(&self, self_ref: RefPtr<Self>) -> bun_jsc::JsResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "commitMultiPartRequest {}",
            BStr::new(self.upload_id.get())
        );
        let mut params_buffer = [0u8; 2048];
        let written = {
            let mut w: &mut [u8] = &mut params_buffer[..];
            write!(w, "?uploadId={}", BStr::new(self.upload_id.get())).expect("unreachable");
            2048 - w.len()
        };
        let search_params = &params_buffer[..written];

        execute_simple_s3_request(
            &self.credentials,
            self.context(),
            s3_simple_request::S3RequestOptions {
                path: &self.path,
                method: bun_http::Method::POST,
                proxy_url: self.proxy_url(),
                body: self.multipart_upload_list.get().as_slice(),
                search_params: Some(search_params),
                request_payer: self.request_payer,
                ..Default::default()
            },
            s3_simple_request::S3Callback::Commit(self_ref),
        )
    }

    fn rollback_multi_part_request(&self, self_ref: RefPtr<Self>) -> bun_jsc::JsResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "rollbackMultiPartRequest {}",
            BStr::new(self.upload_id.get())
        );
        let mut params_buffer = [0u8; 2048];
        let written = {
            let mut w: &mut [u8] = &mut params_buffer[..];
            write!(w, "?uploadId={}", BStr::new(self.upload_id.get())).expect("unreachable");
            2048 - w.len()
        };
        let search_params = &params_buffer[..written];

        execute_simple_s3_request(
            &self.credentials,
            // Not the script's request: it tells the store to drop the parts it holds (they are billed
            // until they expire), and has to go out when the upload fails because its context stopped.
            self.vm.root_context(),
            s3_simple_request::S3RequestOptions {
                path: &self.path,
                method: bun_http::Method::DELETE,
                proxy_url: self.proxy_url(),
                body: b"",
                search_params: Some(search_params),
                request_payer: self.request_payer,
                ..Default::default()
            },
            s3_simple_request::S3Callback::Rollback(self_ref),
        )
    }

    /// Returns `Ok(false)` without touching `buffered` if the queue is full. On `Err`, a part owns the bytes.
    fn enqueue_part(this: &RefPtr<Self>, bytes: PartBytes) -> bun_jsc::JsResult<bool> {
        let Some(part) = this.get_create_part(bytes) else {
            return Ok(false);
        };

        if this.state.get() == State::NotStarted {
            // will auto start later
            this.state.set(State::MultipartStarted);
            execute_simple_s3_request(
                &this.credentials,
                this.context(),
                s3_simple_request::S3RequestOptions {
                    path: &this.path,
                    method: bun_http::Method::POST,
                    proxy_url: this.proxy_url(),
                    body: b"",
                    search_params: Some(b"?uploads="),
                    content_type: this.content_type.as_deref(),
                    content_disposition: this.content_disposition.as_deref(),
                    content_encoding: this.content_encoding.as_deref(),
                    acl: this.acl,
                    storage_class: this.storage_class,
                    request_payer: this.request_payer,
                    ..Default::default()
                },
                s3_simple_request::S3Callback::Start(this.clone()),
            )?;
        } else if this.state.get() == State::MultipartCompleted {
            part.start(this)?;
        }
        Ok(true)
    }

    fn process_multi_part(this: &RefPtr<Self>, part_size: usize) -> bun_jsc::JsResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "processMultiPart {} {}",
            BStr::new(&this.path),
            part_size
        );
        if this.buffered.get().is_empty() && this.is_queue_empty() && this.ended.get() {
            // no more data to send and we are done
            this.done()?;
            return Ok(());
        }
        // need to split in multiple parts because of the size
        // The "reset buffered if empty" cleanup runs after the loop;
        // early-return paths either reset buffered to default (already empty) or leave it non-empty (no-op).

        while this.buffered.get().is_not_empty() {
            let len = part_size.min(this.buffered.get().size());
            if len < part_size && !this.ended.get() {
                scoped_log!(
                    S3MultiPartUpload,
                    "processMultiPart {} {} slice too small",
                    BStr::new(&this.path),
                    len
                );
                // slice is too small, we need to wait for more data
                break;
            }
            // if is one big chunk we can pass ownership and avoid dupe
            if this.buffered.get().cursor == 0 && this.buffered.get().size() == len {
                // we dont care about the result because we are sending everything
                if Self::enqueue_part(this, PartBytes::Whole)? {
                    scoped_log!(
                        S3MultiPartUpload,
                        "processMultiPart {} {} full buffer enqueued",
                        BStr::new(&this.path),
                        len
                    );
                } else {
                    scoped_log!(
                        S3MultiPartUpload,
                        "processMultiPart {} {} queue full",
                        BStr::new(&this.path),
                        len
                    );
                }
                return Ok(());
            }

            if Self::enqueue_part(this, PartBytes::First(len))? {
                scoped_log!(
                    S3MultiPartUpload,
                    "processMultiPart {} {} slice enqueued",
                    BStr::new(&this.path),
                    len
                );
                // queue is not full, we can set the offset
                this.buffered.with_mut(|buffered| buffered.wrote(len));
            } else {
                scoped_log!(
                    S3MultiPartUpload,
                    "processMultiPart {} {} queue full",
                    BStr::new(&this.path),
                    len
                );
                // queue is full stop enqueue and retry later
                break;
            }
        }

        if this.buffered.get().is_empty() {
            this.buffered.with_mut(|buffered| buffered.reset());
        }
        Ok(())
    }

    pub(crate) fn proxy_url(&self) -> Option<&[u8]> {
        self.proxy.as_deref()
    }

    fn process_buffered(this: &RefPtr<Self>, part_size: usize) {
        // The upload of a context that has stopped sends nothing (its writer is a disposed
        // `Bun.ModuleGraph`'s leftover script): what stops a context aborts it, a turn later for
        // one that was made in a context already stopped.
        if this.abort_handle.context_stopped() {
            return;
        }
        if this.ended.get()
            && this.buffered.get().size() < this.part_size_in_bytes()
            && this.state.get() == State::NotStarted
        {
            scoped_log!(
                S3MultiPartUpload,
                "processBuffered {} singlefile_started",
                BStr::new(&this.path)
            );
            this.state.set(State::SinglefileStarted);
            // we can do only 1 request
            let _ = Self::send_single(this); // TODO: properly propagate exception upwards
        } else {
            // we need to split
            let _ = Self::process_multi_part(this, part_size); // TODO: properly propagate exception upwards
        }
    }

    pub(crate) fn part_size_in_bytes(&self) -> usize {
        self.options.get().part_size as usize
    }

    pub(crate) fn continue_stream(this: &RefPtr<Self>) {
        if this.state.get() == State::WaitStreamCheck {
            this.state.set(State::NotStarted);
            if this.ended.get() {
                Self::process_buffered(this, this.part_size_in_bytes());
            }
        }
    }

    pub(crate) fn has_backpressure(&self) -> bool {
        // if we dont have any space in the queue, we have backpressure
        // since we are not allowed to send more data
        let Some(index) = self.available.get().find_first_set() else {
            return true;
        };
        index >= self.options.get().queue_size as usize
    }

    pub(crate) fn is_queue_empty(&self) -> bool {
        self.available.get().mask == IntegerBitSet::<{ Self::MAX_QUEUE_SIZE }>::init_full().mask
    }

    fn append_chunk(&self, chunk: EncodedChunk<'_>) -> Result<(), AllocError> {
        let before = self.buffered.get().size();
        self.buffered.with_mut(|buffered| match chunk {
            EncodedChunk::Bytes(bytes) => buffered.write(bytes),
            EncodedChunk::Latin1(text) => buffered.write_latin1(text),
            EncodedChunk::Utf16(text) => buffered.write_utf16(text),
        })?;
        self.uploaded_bytes
            .set(self.uploaded_bytes.get() + (self.buffered.get().size() - before) as u64);
        Ok(())
    }

    fn write(
        this: &RefPtr<Self>,
        chunk: EncodedChunk<'_>,
        is_last: bool,
    ) -> Result<UploadBackpressure, AllocError> {
        if this.ended.get() {
            return Ok(UploadBackpressure::Done); // no backpressure since we are done
        }
        // Nothing of a context that has stopped will be sent (`process_buffered`), so nothing is
        // taken either: whoever is writing waits, for the abort that comes with what stopped it.
        if this.abort_handle.context_stopped() {
            return Ok(UploadBackpressure::Backpressure);
        }
        if this.state.get() == State::WaitStreamCheck && chunk.is_empty() && is_last {
            // we do this because stream will close if the file dont exists and we dont wanna to send an empty part in this case
            this.ended.set(true);
            if this.buffered.get().size() > 0 {
                Self::process_buffered(this, this.part_size_in_bytes());
            }
            return Ok(if this.has_backpressure() {
                UploadBackpressure::Backpressure
            } else {
                UploadBackpressure::WantMore
            });
        }
        if is_last {
            this.ended.set(true);
            if !chunk.is_empty() {
                this.append_chunk(chunk)?;
            }
            Self::process_buffered(this, this.part_size_in_bytes());
        } else {
            // still have more data and receive empty, nothing todo here
            if chunk.is_empty() {
                return Ok(if this.has_backpressure() {
                    UploadBackpressure::Backpressure
                } else {
                    UploadBackpressure::WantMore
                });
            }
            this.append_chunk(chunk)?;
            let part_size = this.part_size_in_bytes();
            if this.buffered.get().size() >= part_size {
                // send the part we have enough data
                Self::process_buffered(this, part_size);
            }

            // wait for more
        }
        Ok(if this.has_backpressure() {
            UploadBackpressure::Backpressure
        } else {
            UploadBackpressure::WantMore
        })
    }

    pub(crate) fn write_latin1(
        this: &RefPtr<Self>,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<UploadBackpressure, AllocError> {
        Self::write(this, EncodedChunk::Latin1(chunk), is_last)
    }

    pub(crate) fn write_utf16(
        this: &RefPtr<Self>,
        chunk: &[u16],
        is_last: bool,
    ) -> Result<UploadBackpressure, AllocError> {
        Self::write(this, EncodedChunk::Utf16(chunk), is_last)
    }

    pub(crate) fn write_bytes(
        this: &RefPtr<Self>,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<UploadBackpressure, AllocError> {
        Self::write(this, EncodedChunk::Bytes(chunk), is_last)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum UploadBackpressure {
    WantMore,
    Backpressure,
    Done,
}
