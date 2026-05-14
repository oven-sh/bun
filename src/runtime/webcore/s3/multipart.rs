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
use bun_core::{MutableString, strings};
use bun_core::{declare_scope, scoped_log};
use bun_io::KeepAlive;
use bun_io::StreamBuffer;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JSGlobalObject};
use bun_s3_signing::acl::ACL;
use bun_s3_signing::credentials::S3Credentials;
use bun_s3_signing::error::S3Error;
use bun_s3_signing::storage_class::StorageClass;

// PORT NOTE: file-level mods are declared flat in `webcore.rs` via `#[path]`, so
// `super` here is `crate::webcore`, not the `s3` directory. Route through the
// `s3` re-export hub instead.
use crate::webcore::ResumableSinkBackpressure;
use crate::webcore::s3::multipart_options::MultiPartUploadOptions;
use crate::webcore::s3::simple_request::{
    self as s3_simple_request, S3CommitResult, S3DownloadResult, S3PartResult, S3UploadResult,
    execute_simple_s3_request,
};

// TODO(port): verify exact path/type for `bun.JSTerminated!T` — assumed `Result<T, bun_jsc::JsTerminated>`
type JsTerminatedResult<T> = Result<T, bun_jsc::JsTerminated>;

declare_scope!(S3MultiPartUpload, hidden);

#[derive(bun_ptr::CellRefCounted)]
pub struct MultiPartUpload {
    pub queue: Option<Box<[UploadPart]>>,
    pub available: IntegerBitSet<{ Self::MAX_QUEUE_SIZE }>,

    pub current_part_number: u16,
    pub ref_count: Cell<u32>, // intrusive refcount — see bun_ptr::IntrusiveRc
    pub ended: bool,

    pub options: MultiPartUploadOptions,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    pub request_payer: bool,
    pub credentials: bun_ptr::IntrusiveRc<S3Credentials>,
    pub poll_ref: KeepAlive,
    pub vm: &'static VirtualMachine,
    // JSC_BORROW per LIFETIMES.tsv row 1886 — rust_type `&JSGlobalObject` used verbatim
    pub global_this: GlobalRef,

    pub buffered: StreamBuffer,

    pub path: Box<[u8]>,
    pub proxy: Box<[u8]>,
    pub content_type: Option<Box<[u8]>>,
    pub content_disposition: Option<Box<[u8]>>,
    pub content_encoding: Option<Box<[u8]>>,
    // PORT NOTE: in Zig this is a self-referential slice into `uploadid_buffer`.
    // Duped into an owned Box here to avoid self-referential struct.
    // PERF(port): was zero-copy slice into uploadid_buffer — profile in Phase B
    pub upload_id: Box<[u8]>,
    pub uploadid_buffer: MutableString,

    pub multipart_etags: Vec<UploadPartResult>,
    pub multipart_upload_list: Vec<u8>, // was bun.Vec<u8>

    pub state: State,

    pub callback: fn(S3UploadResult, *mut c_void) -> JsTerminatedResult<()>,
    pub on_writable: Option<fn(*mut MultiPartUpload, *mut c_void, u64)>,
    pub callback_context: *mut c_void,
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
    const ONE_MIB: usize = MultiPartUploadOptions::ONE_MIB;
    const MAX_SINGLE_UPLOAD_SIZE: usize = MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE; // we limit to 5 GiB
    const MIN_SINGLE_UPLOAD_SIZE: usize = MultiPartUploadOptions::MIN_SINGLE_UPLOAD_SIZE;
    const DEFAULT_PART_SIZE: usize = MultiPartUploadOptions::DEFAULT_PART_SIZE;
    const MAX_QUEUE_SIZE: usize = MultiPartUploadOptions::MAX_QUEUE_SIZE as usize;
    const MAX_UPLOAD_ID_LEN: usize = 2000;
    // `const AWS = S3Credentials;` — type alias unused in this file; dropped.

    // bun.ptr.RefCount(Self, "ref_count", deinit, .{}) — intrusive refcount.
    // `ref_()`/`deref()` are provided by `#[derive(CellRefCounted)]`; `deref_`
    // is kept as a safe-signature alias so existing call sites keep working.
    // PORT NOTE: inherent associated types (`pub type Ref = ...` inside `impl`)
    // are unstable; the alias lives at module scope as `MultiPartUploadRef`.
    #[inline]
    pub fn deref_(this: *mut Self) {
        // SAFETY: `this` is a live heap-allocated MultiPartUpload created via
        // heap::alloc; forwarded to the derived intrusive-rc decrement.
        unsafe { <Self as bun_ptr::CellRefCounted>::deref(this) }
    }
}

/// Intrusive-refcount handle alias (Zig: `bun.ptr.RefCount(MultiPartUpload, ...)`).
pub type MultiPartUploadRef = bun_ptr::IntrusiveRc<MultiPartUpload>;

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
    pub data: *const [u8],
    pub ctx: bun_ptr::BackRef<MultiPartUpload>, // BACKREF (LIFETIMES.tsv)
    pub allocated_size: usize,
    pub state: PartState,
    pub part_number: u16, // max is 10,000
    pub retry: u8,        // auto retry, decrement until 0 and fail after this
    pub index: u8,
}

pub struct UploadPartResult {
    pub number: u16,
    pub etag: Box<[u8]>,
}

impl UploadPart {
    fn sort_etags(_: &MultiPartUpload, a: &UploadPartResult, b: &UploadPartResult) -> bool {
        a.number < b.number
    }

    fn free_allocated_slice(&mut self) {
        if self.allocated_size > 0 {
            // SAFETY: `data.ptr` was allocated by the global allocator with capacity == allocated_size
            // (either via `to_vec().into_boxed_slice()` where len==cap, or by taking ownership of
            // StreamBuffer's backing allocation). Reconstruct and drop.
            unsafe {
                let ptr = (*self.data).as_ptr().cast_mut();
                drop(Vec::from_raw_parts(
                    ptr,
                    self.allocated_size,
                    self.allocated_size,
                ));
            }
        }
        self.data = std::ptr::from_ref::<[u8]>(b"" as &[u8]);
        self.allocated_size = 0;
    }

    #[inline]
    fn data(&self) -> &[u8] {
        // SAFETY: data is either a static empty slice or a live heap slice owned by this part
        unsafe { &*self.data }
    }

    pub fn on_part_response(result: S3PartResult, this: *mut c_void) -> JsTerminatedResult<()> {
        // SAFETY: callback context — `this` is the `*mut UploadPart` passed in `perform()`
        let this = unsafe { bun_ptr::callback_ctx::<Self>(this) };
        // Copy the BackRef out so the `&mut MultiPartUpload` borrow is detached
        // from `this` (Zig held both `*UploadPart` and `*MultiPartUpload` freely).
        let mut ctx_ref = this.ctx;
        // SAFETY: ctx is a live BACKREF while a part is in flight (part holds a ref on ctx)
        let ctx = unsafe { ctx_ref.get_mut() };

        if this.state == PartState::Canceled || ctx.state == State::Finished {
            scoped_log!(
                S3MultiPartUpload,
                "onPartResponse {} canceled",
                this.part_number
            );
            this.free_allocated_slice();
            MultiPartUpload::deref_(this.ctx.as_ptr());
            return Ok(());
        }

        this.state = PartState::Completed;

        match result {
            S3PartResult::Failure(err) => {
                if this.retry > 0 {
                    scoped_log!(
                        S3MultiPartUpload,
                        "onPartResponse {} retry",
                        this.part_number
                    );
                    this.retry -= 1;
                    // retry failed
                    this.perform()?;
                    Ok(())
                } else {
                    this.state = PartState::NotAssigned;
                    scoped_log!(
                        S3MultiPartUpload,
                        "onPartResponse {} failed",
                        this.part_number
                    );
                    this.free_allocated_slice();
                    // PORT NOTE: `defer this.ctx.deref()` reordered after fail()
                    let ctx_ptr = this.ctx.as_ptr();
                    // SAFETY: ctx_ptr is a live BACKREF; part still holds a ref on ctx until deref_ below
                    let r = unsafe { (*ctx_ptr).fail(err) };
                    MultiPartUpload::deref_(ctx_ptr);
                    r
                }
            }
            S3PartResult::Etag(etag) => {
                scoped_log!(
                    S3MultiPartUpload,
                    "onPartResponse {} success",
                    this.part_number
                );
                let sent = this.data().len();
                this.free_allocated_slice();
                // we will need to order this
                ctx.multipart_etags.push(UploadPartResult {
                    number: this.part_number,
                    etag: Box::<[u8]>::from(etag),
                });
                this.state = PartState::NotAssigned;
                // mark as available
                ctx.available.set(this.index as usize);
                // PORT NOTE: `defer this.ctx.deref()` reordered after drainEnqueuedParts()
                let ctx_ptr = this.ctx.as_ptr();
                // drain more
                // SAFETY: ctx_ptr is a live BACKREF; part still holds a ref on ctx until deref_ below
                let r = unsafe { (*ctx_ptr).drain_enqueued_parts(sent as u64) };
                MultiPartUpload::deref_(ctx_ptr);
                r
            }
        }
    }

    fn perform(&mut self) -> JsTerminatedResult<()> {
        // Copy the BackRef out so the `&mut MultiPartUpload` borrow is detached
        // from `self` (request body reads `self.data()`/`self.part_number`).
        let mut ctx_ref = self.ctx;
        // SAFETY: ctx is a live BACKREF (part holds a ref on ctx)
        let ctx = unsafe { ctx_ref.get_mut() };
        let mut params_buffer = [0u8; 2048];
        let written = {
            let mut w: &mut [u8] = &mut params_buffer[..];
            write!(
                w,
                "?partNumber={}&uploadId={}&x-id=UploadPart",
                self.part_number,
                BStr::new(&ctx.upload_id),
            )
            .expect("unreachable");
            2048 - w.len()
        };
        let search_params = &params_buffer[..written];
        let callback_context: *mut c_void = std::ptr::from_mut::<Self>(self).cast::<c_void>();
        execute_simple_s3_request(
            &*ctx.credentials,
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
            callback_context,
        )
    }

    pub fn start(&mut self) -> JsTerminatedResult<()> {
        let ctx = self.ctx.get();
        if self.state != PartState::Pending || ctx.state != State::MultipartCompleted {
            return Ok(());
        }
        ctx.ref_();
        self.state = PartState::Started;
        self.perform()
    }

    pub fn cancel(&mut self) {
        let state = self.state;
        self.state = PartState::Canceled;

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
        // Zig `deinit`
        scoped_log!(S3MultiPartUpload, "deinit");
        // queue: Box<[UploadPart]> — dropped automatically (parts' raw `data` already freed during lifecycle)
        // PORT NOTE: KeepAlive::unref takes an `EventLoopCtx` (aio cycle-break vtable),
        // not `&VirtualMachine`. Route through the global hook like simple_request does.
        let _ = self.vm;
        self.poll_ref.unref(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::AllocatorType::Js,
        ));
        // path, proxy, content_type, content_disposition, content_encoding — Box dropped automatically
        // credentials: Arc<S3Credentials> — dropped automatically (== .deref())
        // uploadid_buffer: MutableString — Drop
        // multipart_etags: Vec<UploadPartResult> — Drop (each etag Box<[u8]> freed)
        // multipart_upload_list: Vec<u8> — Drop
        // bun.destroy(this) — handled by deref_() via heap::take
    }
}

impl MultiPartUpload {
    pub fn single_send_upload_response(
        result: S3UploadResult,
        this: *mut c_void,
    ) -> JsTerminatedResult<()> {
        // SAFETY: callback context — `this` was passed as opaque ctx and is live (holds final ref)
        let this = unsafe { bun_ptr::callback_ctx::<Self>(this) };
        if this.state == State::Finished {
            return Ok(());
        }
        match result {
            S3UploadResult::Failure(err) => {
                if this.options.retry > 0 {
                    scoped_log!(
                        S3MultiPartUpload,
                        "singleSendUploadResponse {} retry",
                        this.options.retry
                    );
                    this.options.retry -= 1;
                    let callback_context: *mut c_void =
                        std::ptr::from_mut::<Self>(this).cast::<c_void>();
                    execute_simple_s3_request(
                        &*this.credentials,
                        s3_simple_request::S3RequestOptions {
                            path: &this.path,
                            method: bun_http::Method::PUT,
                            proxy_url: this.proxy_url(),
                            body: this.buffered.slice(),
                            content_type: this.content_type.as_deref(),
                            content_disposition: this.content_disposition.as_deref(),
                            content_encoding: this.content_encoding.as_deref(),
                            acl: this.acl,
                            storage_class: this.storage_class,
                            request_payer: this.request_payer,
                            ..Default::default()
                        },
                        s3_simple_request::S3Callback::Upload(Self::single_send_upload_response),
                        callback_context,
                    )?;

                    Ok(())
                } else {
                    scoped_log!(S3MultiPartUpload, "singleSendUploadResponse failed");
                    this.fail(err)
                }
            }
            S3UploadResult::Success => {
                scoped_log!(S3MultiPartUpload, "singleSendUploadResponse success");

                if let Some(callback) = this.on_writable {
                    callback(this, this.callback_context, this.buffered.size() as u64);
                }
                this.done()
            }
        }
    }

    /// This is the only place we allocate the queue or the parts, this is responsible for the flow of parts and the max allowed concurrency
    fn get_create_part(
        &mut self,
        chunk: &[u8],
        allocated_size: usize,
        needs_clone: bool,
    ) -> Option<*mut UploadPart> {
        let Some(index) = self.available.find_first_set() else {
            // this means that the queue is full and we cannot flush it
            return None;
        };
        let queue_size = self.options.queue_size as usize;
        if index >= queue_size {
            // ops too much concurrency wait more
            return None;
        }
        self.available.unset(index);
        // SAFETY: `self` is a heap-stable `MultiPartUpload` (intrusive RC); every
        // `UploadPart` holds a ref so `self` outlives the part (BackRef invariant).
        let self_ref = unsafe { bun_ptr::BackRef::from_raw(std::ptr::from_mut::<Self>(self)) };
        if self.queue.is_none() {
            // queueSize will never change and is small (max 255)
            let mut queue: Vec<UploadPart> = Vec::with_capacity(queue_size);
            // zero set just in case
            for _ in 0..queue_size {
                queue.push(UploadPart {
                    data: std::ptr::from_ref::<[u8]>(b"" as &[u8]),
                    allocated_size: 0,
                    part_number: 0,
                    ctx: self_ref,
                    index: 0,
                    retry: 0,
                    state: PartState::NotAssigned,
                });
            }
            self.queue = Some(queue.into_boxed_slice());
        }
        let (data, allocated_len): (*const [u8], usize) = if needs_clone {
            let owned = Box::<[u8]>::from(chunk);
            let len = owned.len();
            (bun_core::heap::into_raw(owned).cast_const(), len)
        } else {
            (std::ptr::from_ref::<[u8]>(chunk), allocated_size)
        };

        let part_number = self.current_part_number;
        // PORT NOTE: `defer this.currentPartNumber += 1` hoisted before return
        self.current_part_number += 1;

        let queue_item = &mut self.queue.as_mut().unwrap()[index];
        // always set all struct fields to avoid undefined behavior
        *queue_item = UploadPart {
            data,
            allocated_size: allocated_len,
            part_number,
            ctx: self_ref,
            index: index as u8, // @truncate
            retry: self.options.retry,
            state: PartState::Pending,
        };
        Some(std::ptr::from_mut::<UploadPart>(queue_item))
    }

    /// Drain the parts, this is responsible for starting the parts and processing the buffered data
    fn drain_enqueued_parts(&mut self, flushed: u64) -> JsTerminatedResult<()> {
        if self.state == State::Finished || self.state == State::SinglefileStarted {
            return Ok(());
        }
        // check pending to start or transformed buffered ones into tasks
        if self.state == State::MultipartCompleted {
            if let Some(queue) = self.queue.as_mut() {
                for part in queue.iter_mut() {
                    if part.state == PartState::Pending {
                        // lets start the part request
                        part.start()?;
                    }
                }
            }
        }
        let part_size = self.part_size_in_bytes();
        if self.ended || self.buffered.size() >= part_size {
            self.process_multi_part(part_size)?;
        }

        // empty queue
        if self.is_queue_empty() {
            if let Some(callback) = self.on_writable {
                callback(self, self.callback_context, flushed);
            }
            if self.ended {
                // we are done and no more parts are running
                self.done()?;
            }
        } else if !self.has_backpressure() && flushed > 0 {
            // we have more space in the queue, we can drain more
            if let Some(callback) = self.on_writable {
                callback(self, self.callback_context, flushed);
            }
        }
        Ok(())
    }

    /// Finalize the upload with a failure
    pub fn fail(&mut self, err: S3Error) -> JsTerminatedResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "fail {}:{}",
            BStr::new(err.code),
            BStr::new(err.message)
        );
        self.ended = true;
        if let Some(queue) = self.queue.as_mut() {
            for task in queue.iter_mut() {
                if task.state != PartState::NotAssigned {
                    task.cancel();
                }
            }
        }
        if self.state != State::Finished {
            let old_state = self.state;
            self.state = State::Finished;
            (self.callback)(S3UploadResult::Failure(err), self.callback_context)?;

            // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
            // `self.callback` (promise reject → JS) re-enters via the JS
            // wrapper's `*mut MultiPartUpload` and may write `*self`. Nothing
            // derived from `self` is passed to the callback, so LLVM is
            // licensed to hoist `self.upload_id` (read by
            // `rollback_multi_part_request` once inlined) above the call.
            // SUSPECT (not yet ASM-cached); launder so post-callback reads go
            // through an opaque pointer. Mirrors cork fix b818e70e1c57.
            let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
            if old_state == State::MultipartCompleted {
                // we are a multipart upload so we need to rollback
                // will deref after rollback
                // SAFETY: `this` is the live heap `MultiPartUpload` (refcounted
                // — `state == Finished` guards re-entrant `fail`/`done`);
                // momentary `&mut` is the unique access on this JS thread.
                unsafe { (*this).rollback_multi_part_request()? };
            } else {
                // single file upload no need to rollback
                MultiPartUpload::deref_(this);
            }
        }
        Ok(())
    }

    /// Finalize successful the upload
    fn done(&mut self) -> JsTerminatedResult<()> {
        if self.state == State::MultipartCompleted {
            // we are a multipart upload so we need to send the etags and commit
            self.state = State::Finished;
            // sort the etags
            self.multipart_etags.sort_by(|a, b| a.number.cmp(&b.number));
            // start the multipart upload list
            self.multipart_upload_list.extend_from_slice(
                b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">",
            );
            for tag in self.multipart_etags.drain(..) {
                write!(
                    &mut self.multipart_upload_list,
                    "<Part><PartNumber>{}</PartNumber><ETag>{}</ETag></Part>",
                    tag.number,
                    BStr::new(&tag.etag),
                )
                .expect("oom");
                // tag.etag (Box<[u8]>) freed at end of iteration
            }
            self.multipart_etags = Vec::new();
            self.multipart_upload_list
                .extend_from_slice(b"</CompleteMultipartUpload>");
            // will deref and ends after commit
            self.commit_multi_part_request()
        } else if self.state == State::SinglefileStarted {
            self.state = State::Finished;
            // single file upload no need to commit
            // PORT NOTE: `defer this.deref()` reordered after callback
            let r = (self.callback)(S3UploadResult::Success, self.callback_context);
            MultiPartUpload::deref_(self);
            r
        } else {
            Ok(())
        }
    }

    /// Result of the Multipart request, after this we can start draining the parts
    pub fn start_multi_part_request_result(
        result: S3DownloadResult,
        this: *mut c_void,
    ) -> JsTerminatedResult<()> {
        let this = this.cast::<Self>();
        // PORT NOTE: `defer this.deref()` — `adopt` consumes the prior +1 on Drop.
        // SAFETY: callback context — a ref was taken before the request was queued.
        let _deref_guard = unsafe { bun_ptr::ScopedRef::<Self>::adopt(this) };
        // SAFETY: callback context — `this` is live (a ref was taken before the request)
        let this = unsafe { &mut *this };
        if this.state == State::Finished {
            return Ok(());
        }
        match result {
            S3DownloadResult::Failure(err) => {
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
                // PERF(port): Zig stored body and sliced upload_id into it; here we dupe upload_id
                if let Some(start) = strings::index_of(slice, b"<UploadId>") {
                    if let Some(end) = strings::index_of(slice, b"</UploadId>") {
                        this.upload_id = Box::<[u8]>::from(&slice[start + 10..end]);
                    }
                }
                this.uploadid_buffer = response.body;
                if this.upload_id.is_empty() || this.upload_id.len() > Self::MAX_UPLOAD_ID_LEN {
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
                    BStr::new(&this.upload_id)
                );
                this.state = State::MultipartCompleted;
                // start draining the parts
                this.drain_enqueued_parts(0)
            }
            // this is "unreachable" but we cover in case AWS returns 404
            S3DownloadResult::NotFound(_) => this.fail(S3Error {
                code: b"UnknownError",
                message: b"Failed to initiate multipart upload",
            }),
        }
    }

    /// We do a best effort to commit the multipart upload, if it fails we will retry, if it still fails we will fail the upload
    pub fn on_commit_multi_part_request(
        result: S3CommitResult,
        this: *mut c_void,
    ) -> JsTerminatedResult<()> {
        let this = this.cast::<Self>();
        // SAFETY: callback context — `this` is live (final-step ref)
        let this_ref = unsafe { &mut *this };
        scoped_log!(
            S3MultiPartUpload,
            "onCommitMultiPartRequest {}",
            BStr::new(&this_ref.upload_id)
        );

        match result {
            S3CommitResult::Failure(err) => {
                if this_ref.options.retry > 0 {
                    this_ref.options.retry -= 1;
                    // retry commit
                    this_ref.commit_multi_part_request()?;
                    return Ok(());
                }
                this_ref.state = State::Finished;
                // PORT NOTE: `defer this.deref()` reordered after callback
                let r =
                    (this_ref.callback)(S3UploadResult::Failure(err), this_ref.callback_context);
                MultiPartUpload::deref_(this);
                r
            }
            S3CommitResult::Success => {
                this_ref.state = State::Finished;
                // PORT NOTE: `defer this.deref()` reordered after callback
                let r = (this_ref.callback)(S3UploadResult::Success, this_ref.callback_context);
                MultiPartUpload::deref_(this);
                r
            }
        }
    }

    /// We do a best effort to rollback the multipart upload, if it fails we will retry, if it still we just deinit the upload
    pub fn on_rollback_multi_part_request(
        result: S3UploadResult,
        this: *mut c_void,
    ) -> JsTerminatedResult<()> {
        let this = this.cast::<Self>();
        // SAFETY: callback context — `this` is live (final-step ref)
        let this_ref = unsafe { &mut *this };
        scoped_log!(
            S3MultiPartUpload,
            "onRollbackMultiPartRequest {}",
            BStr::new(&this_ref.upload_id)
        );
        match result {
            S3UploadResult::Failure(_) => {
                if this_ref.options.retry > 0 {
                    this_ref.options.retry -= 1;
                    // retry rollback
                    this_ref.rollback_multi_part_request()?;
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

    fn commit_multi_part_request(&mut self) -> JsTerminatedResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "commitMultiPartRequest {}",
            BStr::new(&self.upload_id)
        );
        let mut params_buffer = [0u8; 2048];
        let written = {
            let mut w: &mut [u8] = &mut params_buffer[..];
            write!(w, "?uploadId={}", BStr::new(&self.upload_id)).expect("unreachable");
            2048 - w.len()
        };
        let search_params = &params_buffer[..written];

        let callback_context: *mut c_void = std::ptr::from_mut::<Self>(self).cast::<c_void>();
        execute_simple_s3_request(
            &*self.credentials,
            s3_simple_request::S3RequestOptions {
                path: &self.path,
                method: bun_http::Method::POST,
                proxy_url: self.proxy_url(),
                body: &self.multipart_upload_list,
                search_params: Some(search_params),
                request_payer: self.request_payer,
                ..Default::default()
            },
            s3_simple_request::S3Callback::Commit(Self::on_commit_multi_part_request),
            callback_context,
        )
    }

    fn rollback_multi_part_request(&mut self) -> JsTerminatedResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "rollbackMultiPartRequest {}",
            BStr::new(&self.upload_id)
        );
        let mut params_buffer = [0u8; 2048];
        let written = {
            let mut w: &mut [u8] = &mut params_buffer[..];
            write!(w, "?uploadId={}", BStr::new(&self.upload_id)).expect("unreachable");
            2048 - w.len()
        };
        let search_params = &params_buffer[..written];

        let callback_context: *mut c_void = std::ptr::from_mut::<Self>(self).cast::<c_void>();
        execute_simple_s3_request(
            &*self.credentials,
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
            callback_context,
        )
    }

    fn enqueue_part(
        &mut self,
        chunk: &[u8],
        allocated_size: usize,
        needs_clone: bool,
    ) -> JsTerminatedResult<bool> {
        let Some(part) = self.get_create_part(chunk, allocated_size, needs_clone) else {
            return Ok(false);
        };

        if self.state == State::NotStarted {
            // will auto start later
            self.state = State::MultipartStarted;
            self.ref_();
            let callback_context: *mut c_void = std::ptr::from_mut::<Self>(self).cast::<c_void>();
            execute_simple_s3_request(
                &*self.credentials,
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
                callback_context,
            )?;
        } else if self.state == State::MultipartCompleted {
            // SAFETY: part points into self.queue which is live; reborrow disjoint from self fields used above
            unsafe { (*part).start()? };
        }
        Ok(true)
    }

    fn process_multi_part(&mut self, part_size: usize) -> JsTerminatedResult<()> {
        scoped_log!(
            S3MultiPartUpload,
            "processMultiPart {} {}",
            BStr::new(&self.path),
            part_size
        );
        if self.buffered.is_empty() && self.is_queue_empty() && self.ended {
            // no more data to send and we are done
            self.done()?;
            return Ok(());
        }
        // need to split in multiple parts because of the size
        // PORT NOTE: `defer if (buffered.isEmpty()) buffered.reset()` hoisted to after the loop;
        // early-return paths either reset buffered to default (already empty) or leave it non-empty (no-op).

        while self.buffered.is_not_empty() {
            let len = part_size.min(self.buffered.size());
            if len < part_size && !self.ended {
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
            if self.buffered.cursor == 0 && self.buffered.size() == len {
                // we need to know the allocated size to free the memory later
                let allocated_size = self.buffered.memory_cost();
                // PORT NOTE: reshaped for borrowck — capture raw slice ptr before calling enqueue_part(&mut self)
                let slice_ptr = std::ptr::from_ref::<[u8]>(self.buffered.slice());
                // raw slice pointer carries its length in metadata; no deref needed
                let slice_len = slice_ptr.len();

                // we dont care about the result because we are sending everything
                // SAFETY: slice_ptr borrows self.buffered's storage; enqueue_part with needs_clone=false
                // takes ownership of that storage and self.buffered is reset below before any further use.
                if self.enqueue_part(unsafe { &*slice_ptr }, allocated_size, false)? {
                    scoped_log!(
                        S3MultiPartUpload,
                        "processMultiPart {} {} full buffer enqueued",
                        BStr::new(&self.path),
                        slice_len
                    );

                    // queue is not full, we can clear the buffer part now owns the data
                    // if its full we will retry later
                    // SAFETY: ownership of buffered's allocation transferred to the part above.
                    // The Zig spec does `this.buffered = .{}` which overwrites WITHOUT running a
                    // destructor, releasing the allocation to the UploadPart created via
                    // enqueue_part(..., needs_clone=false). In Rust, assigning a fresh
                    // StreamBuffer would Drop the old one and free the Vec<u8> backing storage,
                    // leaving UploadPart.data dangling (UAF on perform(), double-free on
                    // free_allocated_slice). Take + forget so the part remains sole owner.
                    core::mem::forget(core::mem::take(&mut self.buffered));
                    return Ok(());
                }
                scoped_log!(
                    S3MultiPartUpload,
                    "processMultiPart {} {} queue full",
                    BStr::new(&self.path),
                    slice_len
                );

                return Ok(());
            }

            // PORT NOTE: reshaped for borrowck — capture raw slice ptr before calling enqueue_part(&mut self)
            let slice_ptr = &raw const self.buffered.slice()[..len];
            // allocated size is the slice len because we dupe the buffer
            // SAFETY: slice_ptr borrows self.buffered which is not mutated until after enqueue_part dupes it
            if self.enqueue_part(unsafe { &*slice_ptr }, len, true)? {
                scoped_log!(
                    S3MultiPartUpload,
                    "processMultiPart {} {} slice enqueued",
                    BStr::new(&self.path),
                    len
                );
                // queue is not full, we can set the offset
                self.buffered.wrote(len);
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

        if self.buffered.is_empty() {
            self.buffered.reset();
        }
        Ok(())
    }

    pub fn proxy_url(&self) -> Option<&[u8]> {
        Some(&self.proxy)
    }

    fn process_buffered(&mut self, part_size: usize) {
        if self.ended
            && self.buffered.size() < self.part_size_in_bytes()
            && self.state == State::NotStarted
        {
            scoped_log!(
                S3MultiPartUpload,
                "processBuffered {} singlefile_started",
                BStr::new(&self.path)
            );
            self.state = State::SinglefileStarted;
            // we can do only 1 request
            let callback_context: *mut c_void = std::ptr::from_mut::<Self>(self).cast::<c_void>();
            let _ = execute_simple_s3_request(
                &*self.credentials,
                s3_simple_request::S3RequestOptions {
                    path: &self.path,
                    method: bun_http::Method::PUT,
                    proxy_url: self.proxy_url(),
                    body: self.buffered.slice(),
                    content_type: self.content_type.as_deref(),
                    content_disposition: self.content_disposition.as_deref(),
                    content_encoding: self.content_encoding.as_deref(),
                    acl: self.acl,
                    storage_class: self.storage_class,
                    request_payer: self.request_payer,
                    ..Default::default()
                },
                s3_simple_request::S3Callback::Upload(Self::single_send_upload_response),
                callback_context,
            ); // TODO: properly propagate exception upwards
        } else {
            // we need to split
            let _ = self.process_multi_part(part_size); // TODO: properly propagate exception upwards
        }
    }

    pub fn part_size_in_bytes(&self) -> usize {
        self.options.part_size as usize
    }

    pub fn continue_stream(&mut self) {
        if self.state == State::WaitStreamCheck {
            self.state = State::NotStarted;
            if self.ended {
                self.process_buffered(self.part_size_in_bytes());
            }
        }
    }

    pub fn has_backpressure(&self) -> bool {
        // if we dont have any space in the queue, we have backpressure
        // since we are not allowed to send more data
        let Some(index) = self.available.find_first_set() else {
            return true;
        };
        index >= self.options.queue_size as usize
    }

    pub fn is_queue_empty(&self) -> bool {
        self.available.mask == IntegerBitSet::<{ Self::MAX_QUEUE_SIZE }>::init_full().mask
    }

    // PORT NOTE: Zig used `comptime encoding: enum {bytes, latin1, utf16}`. Rust's
    // adt_const_params (enum-valued const generics) is unstable, so take it as a
    // plain runtime arg — the three thin wrappers below pass a constant, so the
    // optimizer still specializes each branch.
    fn write(
        &mut self,
        encoding: WriteEncoding,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<ResumableSinkBackpressure, AllocError> {
        if self.ended {
            return Ok(ResumableSinkBackpressure::Done); // no backpressure since we are done
        }
        // we may call done inside processBuffered so we ensure that we keep a ref until we are done
        // SAFETY: `self` is the live IntrusiveRc allocation; `ScopedRef` bumps the count
        // and derefs on every exit path.
        let _deref_guard = unsafe { bun_ptr::ScopedRef::new(std::ptr::from_mut::<Self>(self)) };

        if self.state == State::WaitStreamCheck && chunk.is_empty() && is_last {
            // we do this because stream will close if the file dont exists and we dont wanna to send an empty part in this case
            self.ended = true;
            if self.buffered.size() > 0 {
                self.process_buffered(self.part_size_in_bytes());
            }
            return Ok(if self.has_backpressure() {
                ResumableSinkBackpressure::Backpressure
            } else {
                ResumableSinkBackpressure::WantMore
            });
        }
        if is_last {
            self.ended = true;
            if !chunk.is_empty() {
                match encoding {
                    WriteEncoding::Bytes => self.buffered.write(chunk)?,
                    WriteEncoding::Latin1 => self.buffered.write_latin1::<true>(chunk)?,
                    WriteEncoding::Utf16 => {
                        // @alignCast — caller guarantees chunk is u16-aligned; bytemuck checks at runtime.
                        let utf16: &[u16] = bytemuck::cast_slice(chunk);
                        self.buffered.write_utf16(utf16)?
                    }
                }
            }
            self.process_buffered(self.part_size_in_bytes());
        } else {
            // still have more data and receive empty, nothing todo here
            if chunk.is_empty() {
                return Ok(if self.has_backpressure() {
                    ResumableSinkBackpressure::Backpressure
                } else {
                    ResumableSinkBackpressure::WantMore
                });
            }
            match encoding {
                WriteEncoding::Bytes => self.buffered.write(chunk)?,
                WriteEncoding::Latin1 => self.buffered.write_latin1::<true>(chunk)?,
                WriteEncoding::Utf16 => {
                    // @alignCast — caller guarantees chunk is u16-aligned; bytemuck checks at runtime.
                    let utf16: &[u16] = bytemuck::cast_slice(chunk);
                    self.buffered.write_utf16(utf16)?
                }
            }
            let part_size = self.part_size_in_bytes();
            if self.buffered.size() >= part_size {
                // send the part we have enough data
                self.process_buffered(part_size);
            }

            // wait for more
        }
        Ok(if self.has_backpressure() {
            ResumableSinkBackpressure::Backpressure
        } else {
            ResumableSinkBackpressure::WantMore
        })
    }

    pub fn write_latin1(
        &mut self,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<ResumableSinkBackpressure, AllocError> {
        self.write(WriteEncoding::Latin1, chunk, is_last)
    }

    pub fn write_utf16(
        &mut self,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<ResumableSinkBackpressure, AllocError> {
        self.write(WriteEncoding::Utf16, chunk, is_last)
    }

    pub fn write_bytes(
        &mut self,
        chunk: &[u8],
        is_last: bool,
    ) -> Result<ResumableSinkBackpressure, AllocError> {
        self.write(WriteEncoding::Bytes, chunk, is_last)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WriteEncoding {
    Bytes,
    Latin1,
    Utf16,
}

// ported from: src/runtime/webcore/s3/multipart.zig
