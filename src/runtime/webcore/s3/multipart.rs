// When we start the request we will buffer data until partSize is reached or the last chunk is received.
// If the buffer is smaller than partSize, it will be sent as a single request. Otherwise, a multipart upload will be initiated.
// If we send a single request it will retry until the maximum retry count is reached. The single request do not increase the reference count of MultiPartUpload, as they are the final step.
// When sending a multipart upload, if there is space in the queue, the part is enqueued, and the request starts immediately.
// If the queue is full, it waits to be drained before starting a new part request.
// Each part maintains a reference to MultiPartUpload until completion.
// If a part is canceled or fails early, the allocated slice is freed, and the reference is removed. If a part completes successfully, an etag is received, the allocated slice is deallocated, and the etag is appended to multipart_etags. If a part request fails, it retries until the maximum retry count is reached. If it still fails, MultiPartUpload is marked as failed and its reference is removed.
// If all parts succeed, a complete request is sent.
// If any part fails, a rollback request deletes the uploaded parts. Rollback and commit requests do not increase the reference count of MultiPartUpload, as they are the final step. Once commit or rollback finishes, the reference count is decremented, and MultiPartUpload is freed. These requests retry up to the maximum retry count on a best-effort basis.

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
//          │             (No Ref Inc)    (No Ref Inc)   │
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

use core::cell::Cell;
use core::ffi::c_void;
use std::io::Write as _;

use bstr::BStr;

use bun_alloc::AllocError;
use bun_collections::IntegerBitSet;
use bun_core::{declare_scope, scoped_log};
use bun_io::KeepAlive;
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
use crate::webcore::s3::multipart_options::MultiPartUploadOptions;
use crate::webcore::s3::simple_request::{
    self as s3_simple_request, S3CommitResult, S3DownloadResult, S3PartResult, S3UploadResult,
    execute_simple_s3_request,
};
use crate::webcore::s3::xml_response;
use bun_collections::index_sort;

declare_scope!(S3MultiPartUpload, hidden);

#[derive(bun_ptr::CellRefCounted)]
pub struct MultiPartUpload {
    pub(crate) root: Cell<Option<core::ptr::NonNull<MultiPartUpload>>>,
    pub(crate) queue: JsCell<Option<Box<[UploadPart]>>>,
    pub(crate) available: Cell<IntegerBitSet<{ Self::MAX_QUEUE_SIZE }>>,

    pub(crate) current_part_number: Cell<u16>,
    pub(crate) ref_count: Cell<u32>,
    pub(crate) ended: Cell<bool>,

    pub(crate) options: Cell<MultiPartUploadOptions>,
    pub(crate) acl: Option<ACL>,
    pub(crate) storage_class: Option<StorageClass>,
    pub(crate) request_payer: bool,
    pub(crate) credentials: RefPtr<S3Credentials>,
    pub poll_ref: JsCell<KeepAlive>,
    pub(crate) vm: &'static VirtualMachine,
    // JSC_BORROW per LIFETIMES.tsv row 1886 — rust_type `&JSGlobalObject` used verbatim
    pub global_this: GlobalRef,

    pub(crate) buffered: JsCell<StreamBuffer>,
    /// Bytes accepted by `write*` (after encoding): what a streamed `Bun.write`/`writer.end()`
    /// resolves with.
    pub(crate) uploaded_bytes: Cell<u64>,

    pub path: Box<[u8]>,
    pub(crate) proxy: Box<[u8]>,
    pub(crate) content_type: Option<Box<[u8]>>,
    pub(crate) content_disposition: Option<Box<[u8]>>,
    pub(crate) content_encoding: Option<Box<[u8]>>,
    pub(crate) upload_id: JsCell<Box<[u8]>>,

    pub(crate) multipart_etags: JsCell<Vec<UploadPartResult>>,
    pub(crate) multipart_upload_list: JsCell<Vec<u8>>, // was bun.Vec<u8>

    pub(crate) state: Cell<State>,

    /// Completion. The upload is passed so `uploaded_bytes` can be read by a callee that no
    /// longer holds a ref to it (a `writer()` sink whose JS wrapper was collected).
    pub callback: fn(&MultiPartUpload, S3UploadResult, *mut c_void) -> bun_jsc::JsResult<()>,
    pub(crate) on_writable: Option<fn(&MultiPartUpload, *mut c_void, u64)>,
    pub(crate) callback_context: Cell<*mut c_void>,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum State {
    WaitStreamCheck,
    NotStarted,
    MultipartStarted,
    MultipartCompleted,
    SinglefileStarted,
    Finished,
}

impl MultiPartUpload {
    const MAX_QUEUE_SIZE: usize = MultiPartUploadOptions::MAX_QUEUE_SIZE as usize;
    const MAX_UPLOAD_ID_LEN: usize = 2000;
    // `const AWS = S3Credentials;` — type alias unused in this file; dropped.

    // bun.ptr.RefCount(Self, "ref_count", deinit, .{}) — intrusive refcount.
    // `ref_()`/`deref()` are provided by `#[derive(CellRefCounted)]`.
    // Inherent associated types (`pub type Ref = ...` inside `impl`) are
    // unstable; the alias lives at module scope as `MultiPartUploadRef`.
    /// # Safety
    /// `this` must be a live heap-allocated `MultiPartUpload` created via
    /// `heap::alloc` with a non-zero intrusive refcount.
    #[inline]
    // Forwards `this` to the derived intrusive-rc decrement without dereferencing it here;
    // not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub(crate) fn deref_(this: *mut Self) {
        // SAFETY: per fn contract — forwarded to the derived intrusive-rc decrement.
        unsafe { <Self as bun_ptr::CellRefCounted>::deref(this) }
    }

    #[inline]
    fn root_ptr(&self) -> *mut MultiPartUpload {
        self.root
            .get()
            .expect("MultiPartUpload root set at construction")
            .as_ptr()
    }

    #[inline]
    fn as_ctx_ptr(&self) -> *mut c_void {
        self.root_ptr().cast::<c_void>()
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PartState {
    NotAssigned = 0,
    Pending = 1,
    Started = 2,
    Completed = 3,
    Canceled = 4,
}

pub struct UploadPart {
    /// Raw owned slice; backing allocation length is `allocated_size` (may exceed `data.len()`).
    /// Freed via `free_allocated_slice`. Default is a static empty slice.
    pub(crate) data: Cell<*const [u8]>,
    pub ctx: bun_ptr::BackRef<MultiPartUpload, bun_ptr::Mut>, // BACKREF (LIFETIMES.tsv)
    pub(crate) allocated_size: Cell<usize>,
    pub(crate) state: Cell<PartState>,
    pub(crate) part_number: Cell<u16>, // max is 10,000
    pub(crate) retry: Cell<u8>,        // auto retry, decrement until 0 and fail after this
    pub(crate) index: Cell<u8>,
}

pub struct UploadPartResult {
    pub(crate) number: u16,
    pub(crate) etag: Box<[u8]>,
}

impl UploadPart {
    fn free_allocated_slice(&self) {
        let allocated_size = self.allocated_size.get();
        if allocated_size > 0 {
            // SAFETY: `data.ptr` was allocated by the global allocator with capacity == allocated_size
            // (either via `to_vec().into_boxed_slice()` where len==cap, or by taking ownership of
            // StreamBuffer's backing allocation). Reconstruct and drop.
            unsafe {
                let ptr = (*self.data.get()).as_ptr().cast_mut();
                drop(Vec::from_raw_parts(ptr, allocated_size, allocated_size));
            }
        }
        self.data.set(std::ptr::from_ref::<[u8]>(b"" as &[u8]));
        self.allocated_size.set(0);
    }

    #[inline]
    fn data(&self) -> &[u8] {
        // SAFETY: data is either a static empty slice or a live heap slice owned by this part
        unsafe { &*self.data.get() }
    }

    fn on_part_response(result: S3PartResult, this: *mut c_void) -> bun_jsc::JsResult<()> {
        // SAFETY: callback context — `this` is the queue slot passed in `perform()`; the
        // ref this part holds on `ctx` keeps the queue alive until the tail `deref_` below.
        let this = unsafe { &*this.cast::<Self>() };
        let ctx_ptr = this.ctx.as_ptr();
        let ctx = this.ctx.get();
        let part_number = this.part_number.get();

        if this.state.get() == PartState::Canceled || ctx.state.get() == State::Finished {
            scoped_log!(S3MultiPartUpload, "onPartResponse {} canceled", part_number);
            this.free_allocated_slice();
            MultiPartUpload::deref_(ctx_ptr);
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
                    this.perform()
                } else {
                    scoped_log!(S3MultiPartUpload, "onPartResponse {} failed", part_number);
                    this.state.set(PartState::NotAssigned);
                    this.free_allocated_slice();
                    // The ctx deref must run after fail():
                    let r = ctx.fail(err);
                    MultiPartUpload::deref_(ctx_ptr);
                    r
                }
            }
            S3PartResult::Etag(etag) => {
                scoped_log!(S3MultiPartUpload, "onPartResponse {} success", part_number);
                let sent = this.data().len();
                this.free_allocated_slice();
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
                available.set(this.index.get() as usize);
                ctx.available.set(available);
                // The ctx deref must run after drain_enqueued_parts():
                // drain more
                let r = ctx.drain_enqueued_parts(sent as u64);
                MultiPartUpload::deref_(ctx_ptr);
                r
            }
        }
    }

    fn perform(&self) -> bun_jsc::JsResult<()> {
        let ctx = self.ctx.get();
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
            s3_simple_request::S3RequestOptions {
                path: &ctx.path,
                method: bun_http::Method::PUT,
                proxy_url: ctx.proxy_url(),
                body: self.data(),
                search_params: Some(search_params),
                request_payer: ctx.request_payer,
                ..Default::default()
            },
            s3_simple_request::S3Callback::Part(Self::on_part_response),
            std::ptr::from_ref::<Self>(self).cast_mut().cast::<c_void>(),
        )
    }

    fn start(&self) -> bun_jsc::JsResult<()> {
        let ctx = self.ctx.get();
        if self.state.get() != PartState::Pending || ctx.state.get() != State::MultipartCompleted {
            return Ok(());
        }
        ctx.ref_();
        self.state.set(PartState::Started);
        self.perform()
    }

    fn cancel(&self) {
        let state = self.state.replace(PartState::Canceled);

        match state {
            PartState::Pending => {
                self.free_allocated_slice();
            }
            // if is not pending we will free later or is already freed
            _ => {}
        }
    }
}

impl Drop for MultiPartUpload {
    fn drop(&mut self) {
        scoped_log!(S3MultiPartUpload, "deinit");
        // queue: Box<[UploadPart]> — dropped automatically (parts' raw `data` already freed during lifecycle)
        // KeepAlive::unref takes an `EventLoopCtx` (aio cycle-break vtable),
        // not `&VirtualMachine`. Route through the global hook like simple_request does.
        let _ = self.vm;
        self.poll_ref.with_mut(|poll_ref| {
            poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });
    }
}

impl MultiPartUpload {
    pub(crate) fn single_send_upload_response(
        result: S3UploadResult,
        this: *mut c_void,
    ) -> bun_jsc::JsResult<()> {
        let this = this.cast::<Self>();
        // SAFETY: callback context — `this` is live; this takes over the ref
        // `process_buffered` (or the retry path) took for this request.
        let _guard = unsafe { RefPtr::from_raw(this) };
        // SAFETY: `this` is live for at least the guard's duration.
        let self_ = unsafe { &*this };
        if self_.state.get() == State::Finished {
            return Ok(());
        }
        match result {
            S3UploadResult::Failure(err) => {
                let mut options = self_.options.get();
                if options.retry > 0 {
                    scoped_log!(
                        S3MultiPartUpload,
                        "singleSendUploadResponse {} retry",
                        options.retry
                    );
                    options.retry -= 1;
                    self_.options.set(options);
                    self_.ref_();
                    execute_simple_s3_request(
                        &self_.credentials,
                        s3_simple_request::S3RequestOptions {
                            path: &self_.path,
                            method: bun_http::Method::PUT,
                            proxy_url: self_.proxy_url(),
                            body: self_.buffered.get().slice(),
                            content_type: self_.content_type.as_deref(),
                            content_disposition: self_.content_disposition.as_deref(),
                            content_encoding: self_.content_encoding.as_deref(),
                            acl: self_.acl,
                            storage_class: self_.storage_class,
                            request_payer: self_.request_payer,
                            ..Default::default()
                        },
                        s3_simple_request::S3Callback::Upload(Self::single_send_upload_response),
                        this.cast::<c_void>(),
                    )
                } else {
                    scoped_log!(S3MultiPartUpload, "singleSendUploadResponse failed");
                    self_.fail(err)
                }
            }
            S3UploadResult::Success => {
                scoped_log!(S3MultiPartUpload, "singleSendUploadResponse success");

                if let Some(callback) = self_.on_writable {
                    callback(
                        self_,
                        self_.callback_context.get(),
                        self_.buffered.get().size() as u64,
                    );
                }
                self_.done()
            }
        }
    }

    /// This is the only place we allocate the queue or the parts, this is responsible for the flow of parts and the max allowed concurrency
    fn get_create_part(
        &self,
        chunk: &[u8],
        allocated_size: usize,
        needs_clone: bool,
    ) -> Option<&UploadPart> {
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
        if self.queue.get().is_none() {
            // SAFETY: `root_ptr()` is this heap-stable allocation's root (write
            // provenance); every in-flight `UploadPart` holds a ref so it
            // outlives the part (BackRef invariant).
            let self_ref = unsafe { bun_ptr::BackRef::from_raw_mut(self.root_ptr()) };
            // queueSize will never change and is small (max 255)
            let mut queue: Vec<UploadPart> = Vec::with_capacity(queue_size);
            // zero set just in case
            for _ in 0..queue_size {
                queue.push(UploadPart {
                    data: Cell::new(std::ptr::from_ref::<[u8]>(b"" as &[u8])),
                    allocated_size: Cell::new(0),
                    part_number: Cell::new(0),
                    ctx: self_ref,
                    index: Cell::new(0),
                    retry: Cell::new(0),
                    state: Cell::new(PartState::NotAssigned),
                });
            }
            self.queue.set(Some(queue.into_boxed_slice()));
        }
        let (data, allocated_len): (*const [u8], usize) = if needs_clone {
            let owned = Box::<[u8]>::from(chunk);
            let len = owned.len();
            (bun_core::heap::into_raw(owned).cast_const(), len)
        } else {
            (std::ptr::from_ref::<[u8]>(chunk), allocated_size)
        };

        let part_number = self.current_part_number.get();
        self.current_part_number.set(part_number + 1);

        let queue = self.queue.get().as_deref().expect("queue allocated above");
        let queue_item = &queue[index];
        queue_item.data.set(data);
        queue_item.allocated_size.set(allocated_len);
        queue_item.part_number.set(part_number);
        queue_item.index.set(index as u8); // @truncate
        queue_item.retry.set(self.options.get().retry);
        queue_item.state.set(PartState::Pending);
        Some(queue_item)
    }

    /// Drain the parts, this is responsible for starting the parts and processing the buffered data
    fn drain_enqueued_parts(&self, flushed: u64) -> bun_jsc::JsResult<()> {
        let state = self.state.get();
        if state == State::Finished || state == State::SinglefileStarted {
            return Ok(());
        }
        // check pending to start or transformed buffered ones into tasks
        if state == State::MultipartCompleted {
            if let Some(queue) = self.queue.get().as_deref() {
                for part in queue {
                    if part.state.get() == PartState::Pending {
                        // lets start the part request
                        part.start()?;
                    }
                }
            }
        }
        let part_size = self.part_size_in_bytes();
        if self.ended.get() || self.buffered.get().size() >= part_size {
            self.process_multi_part(part_size)?;
        }

        // empty queue
        if self.is_queue_empty() {
            if let Some(callback) = self.on_writable {
                callback(self, self.callback_context.get(), flushed);
            }
            // `on_writable` may re-enter and enqueue a final part; re-check.
            if self.ended.get() && self.is_queue_empty() {
                self.done()?;
            }
        } else if !self.has_backpressure() && flushed > 0 {
            // we have more space in the queue, we can drain more
            if let Some(callback) = self.on_writable {
                callback(self, self.callback_context.get(), flushed);
            }
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
        if let Some(queue) = self.queue.get().as_deref() {
            for task in queue {
                if task.state.get() != PartState::NotAssigned {
                    task.cancel();
                }
            }
        }
        if self.state.get() != State::Finished {
            let old_state = self.state.replace(State::Finished);
            (self.callback)(
                self,
                S3UploadResult::Failure(err),
                self.callback_context.get(),
            )?;

            if old_state == State::MultipartCompleted {
                // we are a multipart upload so we need to rollback
                // will deref after rollback
                self.rollback_multi_part_request()?;
            } else {
                // single file upload no need to rollback
                MultiPartUpload::deref_(self.root_ptr());
            }
        }
        Ok(())
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
            // will deref and ends after commit
            self.commit_multi_part_request()
        } else if state == State::SinglefileStarted {
            self.state.set(State::Finished);
            // single file upload no need to commit
            // The deref must run after the callback:
            let r = (self.callback)(self, S3UploadResult::Success, self.callback_context.get());
            MultiPartUpload::deref_(self.root_ptr());
            r
        } else {
            Ok(())
        }
    }

    /// Result of the Multipart request, after this we can start draining the parts
    pub(crate) fn start_multi_part_request_result(
        result: S3DownloadResult,
        this: *mut c_void,
    ) -> bun_jsc::JsResult<()> {
        let this = this.cast::<Self>();
        // SAFETY: callback context — takes over the ref taken before the request was queued.
        let _guard = unsafe { RefPtr::from_raw(this) };
        // SAFETY: `this` is live for at least the guard's duration.
        let self_ = unsafe { &*this };
        if self_.state.get() == State::Finished {
            return Ok(());
        }
        match result {
            S3DownloadResult::Failure(err) => {
                scoped_log!(
                    S3MultiPartUpload,
                    "startMultiPartRequestResult {} failed {}: {}",
                    BStr::new(&self_.path),
                    BStr::new(err.message),
                    BStr::new(err.message)
                );
                self_.fail(err)
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
                    self_.upload_id.set(upload_id);
                }
                if !valid {
                    // Unknown type of response error from AWS
                    scoped_log!(
                        S3MultiPartUpload,
                        "startMultiPartRequestResult {} failed invalid id",
                        BStr::new(&self_.path)
                    );
                    self_.fail(S3Error {
                        code: b"UnknownError",
                        message: b"Failed to initiate multipart upload",
                    })?;
                    return Ok(());
                }
                scoped_log!(
                    S3MultiPartUpload,
                    "startMultiPartRequestResult {} success id: {}",
                    BStr::new(&self_.path),
                    BStr::new(self_.upload_id.get())
                );
                self_.state.set(State::MultipartCompleted);
                // start draining the parts
                self_.drain_enqueued_parts(0)
            }
            // this is "unreachable" but we cover in case AWS returns 404
            S3DownloadResult::NotFound(_) => self_.fail(S3Error {
                code: b"UnknownError",
                message: b"Failed to initiate multipart upload",
            }),
        }
    }

    /// We do a best effort to commit the multipart upload, if it fails we will retry, if it still fails we will fail the upload
    pub(crate) fn on_commit_multi_part_request(
        result: S3CommitResult,
        this: *mut c_void,
    ) -> bun_jsc::JsResult<()> {
        let this = this.cast::<Self>();
        // SAFETY: callback context — `this` is live; the request owns the final-step ref,
        // released as the tail statement below.
        let self_ = unsafe { &*this };
        scoped_log!(
            S3MultiPartUpload,
            "onCommitMultiPartRequest {}",
            BStr::new(self_.upload_id.get())
        );

        match result {
            S3CommitResult::Failure(err) => {
                let mut options = self_.options.get();
                if options.retry > 0 {
                    options.retry -= 1;
                    self_.options.set(options);
                    // retry commit
                    self_.commit_multi_part_request()?;
                    return Ok(());
                }
                self_.state.set(State::Finished);
                // The deref must run after the callback:
                let r = (self_.callback)(
                    self_,
                    S3UploadResult::Failure(err),
                    self_.callback_context.get(),
                );
                MultiPartUpload::deref_(this);
                r
            }
            S3CommitResult::Success => {
                self_.state.set(State::Finished);
                // The deref must run after the callback:
                let r =
                    (self_.callback)(self_, S3UploadResult::Success, self_.callback_context.get());
                MultiPartUpload::deref_(this);
                r
            }
        }
    }

    /// We do a best effort to rollback the multipart upload, if it fails we will retry, if it still we just deinit the upload
    pub(crate) fn on_rollback_multi_part_request(
        result: S3UploadResult,
        this: *mut c_void,
    ) -> bun_jsc::JsResult<()> {
        let this = this.cast::<Self>();
        // SAFETY: callback context — `this` is live; the request owns the final-step ref,
        // released as the tail statement below.
        let self_ = unsafe { &*this };
        scoped_log!(
            S3MultiPartUpload,
            "onRollbackMultiPartRequest {}",
            BStr::new(self_.upload_id.get())
        );
        match result {
            S3UploadResult::Failure(_err) => {
                let mut options = self_.options.get();
                if options.retry > 0 {
                    options.retry -= 1;
                    self_.options.set(options);
                    // retry rollback
                    self_.rollback_multi_part_request()?;
                    return Ok(());
                }
                MultiPartUpload::deref_(this);
                Ok(())
            }
            S3UploadResult::Success => {
                MultiPartUpload::deref_(this);
                Ok(())
            }
        }
    }

    fn commit_multi_part_request(&self) -> bun_jsc::JsResult<()> {
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
            s3_simple_request::S3RequestOptions {
                path: &self.path,
                method: bun_http::Method::POST,
                proxy_url: self.proxy_url(),
                body: self.multipart_upload_list.get().as_slice(),
                search_params: Some(search_params),
                request_payer: self.request_payer,
                ..Default::default()
            },
            s3_simple_request::S3Callback::Commit(Self::on_commit_multi_part_request),
            self.as_ctx_ptr(),
        )
    }

    fn rollback_multi_part_request(&self) -> bun_jsc::JsResult<()> {
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
            s3_simple_request::S3RequestOptions {
                path: &self.path,
                method: bun_http::Method::DELETE,
                proxy_url: self.proxy_url(),
                body: b"",
                search_params: Some(search_params),
                request_payer: self.request_payer,
                ..Default::default()
            },
            s3_simple_request::S3Callback::Upload(Self::on_rollback_multi_part_request),
            self.as_ctx_ptr(),
        )
    }

    fn enqueue_part(
        &self,
        chunk: &[u8],
        allocated_size: usize,
        needs_clone: bool,
    ) -> bun_jsc::JsResult<bool> {
        let Some(part) = self.get_create_part(chunk, allocated_size, needs_clone) else {
            return Ok(false);
        };

        if self.state.get() == State::NotStarted {
            // will auto start later
            self.state.set(State::MultipartStarted);
            self.ref_();
            execute_simple_s3_request(
                &self.credentials,
                s3_simple_request::S3RequestOptions {
                    path: &self.path,
                    method: bun_http::Method::POST,
                    proxy_url: self.proxy_url(),
                    body: b"",
                    search_params: Some(b"?uploads="),
                    content_type: self.content_type.as_deref(),
                    content_disposition: self.content_disposition.as_deref(),
                    content_encoding: self.content_encoding.as_deref(),
                    acl: self.acl,
                    storage_class: self.storage_class,
                    request_payer: self.request_payer,
                    ..Default::default()
                },
                s3_simple_request::S3Callback::Download(Self::start_multi_part_request_result),
                self.as_ctx_ptr(),
            )?;
        } else if self.state.get() == State::MultipartCompleted {
            part.start()?;
        }
        Ok(true)
    }

    fn process_multi_part(&self, part_size: usize) -> bun_jsc::JsResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "processMultiPart {} {}",
            BStr::new(&self.path),
            part_size
        );
        if self.buffered.get().is_empty() && self.is_queue_empty() && self.ended.get() {
            // no more data to send and we are done
            self.done()?;
            return Ok(());
        }
        // need to split in multiple parts because of the size
        // The "reset buffered if empty" cleanup runs after the loop;
        // early-return paths either reset buffered to default (already empty) or leave it non-empty (no-op).

        while self.buffered.get().is_not_empty() {
            let len = part_size.min(self.buffered.get().size());
            if len < part_size && !self.ended.get() {
                scoped_log!(
                    S3MultiPartUpload,
                    "processMultiPart {} {} slice too small",
                    BStr::new(&self.path),
                    len
                );
                // slice is too small, we need to wait for more data
                break;
            }
            // if is one big chunk we can pass ownership and avoid dupe
            if self.buffered.get().cursor == 0 && self.buffered.get().size() == len {
                let owned = self.buffered.replace(StreamBuffer::default());
                // we need to know the allocated size to free the memory later
                let allocated_size = owned.memory_cost();
                let slice_len = owned.slice().len();

                // we dont care about the result because we are sending everything
                if self.enqueue_part(owned.slice(), allocated_size, false)? {
                    scoped_log!(
                        S3MultiPartUpload,
                        "processMultiPart {} {} full buffer enqueued",
                        BStr::new(&self.path),
                        slice_len
                    );
                    let _ = core::mem::ManuallyDrop::new(owned);
                    return Ok(());
                }
                let appended = self.buffered.replace(owned);
                if appended.is_not_empty() {
                    self.buffered
                        .with_mut(|b| b.write(appended.slice()).map(|_| ()))
                        .unwrap_or(());
                }
                scoped_log!(
                    S3MultiPartUpload,
                    "processMultiPart {} {} queue full",
                    BStr::new(&self.path),
                    slice_len
                );

                return Ok(());
            }

            let slice_ptr = std::ptr::from_ref::<[u8]>(&self.buffered.get().slice()[..len]);
            // allocated size is the slice len because we dupe the buffer
            // SAFETY: slice_ptr points at self.buffered's storage which is not mutated until after enqueue_part dupes it
            if self.enqueue_part(unsafe { &*slice_ptr }, len, true)? {
                scoped_log!(
                    S3MultiPartUpload,
                    "processMultiPart {} {} slice enqueued",
                    BStr::new(&self.path),
                    len
                );
                // queue is not full, we can set the offset
                self.buffered.with_mut(|buffered| buffered.wrote(len));
            } else {
                scoped_log!(
                    S3MultiPartUpload,
                    "processMultiPart {} {} queue full",
                    BStr::new(&self.path),
                    len
                );
                // queue is full stop enqueue and retry later
                break;
            }
        }

        if self.buffered.get().is_empty() {
            self.buffered.with_mut(|buffered| buffered.reset());
        }
        Ok(())
    }

    pub(crate) fn proxy_url(&self) -> Option<&[u8]> {
        Some(&self.proxy)
    }

    fn process_buffered(&self, part_size: usize) {
        if self.ended.get()
            && self.buffered.get().size() < self.part_size_in_bytes()
            && self.state.get() == State::NotStarted
        {
            scoped_log!(
                S3MultiPartUpload,
                "processBuffered {} singlefile_started",
                BStr::new(&self.path)
            );
            self.state.set(State::SinglefileStarted);
            // we can do only 1 request
            self.ref_();
            let _ = execute_simple_s3_request(
                &self.credentials,
                s3_simple_request::S3RequestOptions {
                    path: &self.path,
                    method: bun_http::Method::PUT,
                    proxy_url: self.proxy_url(),
                    body: self.buffered.get().slice(),
                    content_type: self.content_type.as_deref(),
                    content_disposition: self.content_disposition.as_deref(),
                    content_encoding: self.content_encoding.as_deref(),
                    acl: self.acl,
                    storage_class: self.storage_class,
                    request_payer: self.request_payer,
                    ..Default::default()
                },
                s3_simple_request::S3Callback::Upload(Self::single_send_upload_response),
                self.as_ctx_ptr(),
            ); // TODO: properly propagate exception upwards
        } else {
            // we need to split
            let _ = self.process_multi_part(part_size); // TODO: properly propagate exception upwards
        }
    }

    pub(crate) fn part_size_in_bytes(&self) -> usize {
        self.options.get().part_size as usize
    }

    pub(crate) fn continue_stream(&self) {
        if self.state.get() == State::WaitStreamCheck {
            self.state.set(State::NotStarted);
            if self.ended.get() {
                self.process_buffered(self.part_size_in_bytes());
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

    fn append_chunk(&self, encoding: WriteEncoding, chunk: &[u8]) -> Result<(), AllocError> {
        let before = self.buffered.get().size();
        self.buffered.with_mut(|buffered| match encoding {
            WriteEncoding::Bytes => buffered.write(chunk),
            WriteEncoding::Latin1 => buffered.write_latin1::<true>(chunk),
            WriteEncoding::Utf16 => {
                // @alignCast — caller guarantees chunk is u16-aligned; bytemuck checks at runtime.
                let utf16: &[u16] = bytemuck::cast_slice(chunk);
                buffered.write_utf16(utf16)
            }
        })?;
        self.uploaded_bytes
            .set(self.uploaded_bytes.get() + (self.buffered.get().size() - before) as u64);
        Ok(())
    }

    // The encoding is a plain runtime arg — the three thin wrappers below
    // pass a constant, so the optimizer still specializes each branch.
    fn write(
        &self,
        encoding: WriteEncoding,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<UploadBackpressure, AllocError> {
        if self.ended.get() {
            return Ok(UploadBackpressure::Done); // no backpressure since we are done
        }
        // we may call done inside processBuffered so we ensure that we keep a ref until we are done
        // SAFETY: `self` is live; `root_ptr()` carries the allocation's provenance.
        let _guard = unsafe { RefPtr::init_ref(self.root_ptr()) };

        if self.state.get() == State::WaitStreamCheck && chunk.is_empty() && is_last {
            // we do this because stream will close if the file dont exists and we dont wanna to send an empty part in this case
            self.ended.set(true);
            if self.buffered.get().size() > 0 {
                self.process_buffered(self.part_size_in_bytes());
            }
            return Ok(if self.has_backpressure() {
                UploadBackpressure::Backpressure
            } else {
                UploadBackpressure::WantMore
            });
        }
        if is_last {
            self.ended.set(true);
            if !chunk.is_empty() {
                self.append_chunk(encoding, chunk)?;
            }
            self.process_buffered(self.part_size_in_bytes());
        } else {
            // still have more data and receive empty, nothing todo here
            if chunk.is_empty() {
                return Ok(if self.has_backpressure() {
                    UploadBackpressure::Backpressure
                } else {
                    UploadBackpressure::WantMore
                });
            }
            self.append_chunk(encoding, chunk)?;
            let part_size = self.part_size_in_bytes();
            if self.buffered.get().size() >= part_size {
                // send the part we have enough data
                self.process_buffered(part_size);
            }

            // wait for more
        }
        Ok(if self.has_backpressure() {
            UploadBackpressure::Backpressure
        } else {
            UploadBackpressure::WantMore
        })
    }

    pub(crate) fn write_latin1(
        &self,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<UploadBackpressure, AllocError> {
        self.write(WriteEncoding::Latin1, chunk, is_last)
    }

    pub(crate) fn write_utf16(
        &self,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<UploadBackpressure, AllocError> {
        self.write(WriteEncoding::Utf16, chunk, is_last)
    }

    pub(crate) fn write_bytes(
        &self,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<UploadBackpressure, AllocError> {
        self.write(WriteEncoding::Bytes, chunk, is_last)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum UploadBackpressure {
    WantMore,
    Backpressure,
    Done,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum WriteEncoding {
    Bytes,
    Latin1,
    Utf16,
}
