use core::ffi::c_void;
use core::ptr::NonNull;

use bun_jsc::node_path::PathOrFileDescriptor;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue, SystemError};

use crate::webcore::blob::{self, Blob, SizeType};
use crate::webcore::body;
#[cfg(not(windows))]
use {
    crate::webcore::blob::Store,
    crate::webcore::blob::fd_job::{self, FdJob, FdOp, Interest, JobFd, Step},
    bun_ptr::RefPtr,
    bun_sys::{self as sys, Fd},
};

#[cfg(windows)]
pub(crate) use super::windows::WriteFile;

#[cfg(not(windows))]
pub(crate) struct WriteFile {
    destination: RefPtr<Store>,
    source: RefPtr<Store>,
    /// Of the bytes of `source`.
    range: core::ops::Range<usize>,
    written: usize,
    could_block: bool,
    mkdirp: bool,
}

#[cfg(not(windows))]
impl WriteFile {
    /// `source` is the store of `source_blob`. Returns the promise.
    pub(crate) fn start(
        destination: RefPtr<Store>,
        source: RefPtr<Store>,
        source_blob: &Blob,
        mkdirp: bool,
        cx: &bun_jsc::JsThread<'_>,
    ) -> JSValue {
        let start = (source_blob.offset.get() as usize).min(source.shared_view().len());
        let write = WriteFile {
            range: start..start + source_blob.shared_view().len(),
            written: 0,
            could_block: false,
            mkdirp,
            destination,
            source,
        };
        let promise = jsc::JSPromiseStrong::init(cx.global());
        let value = promise.value();
        FdJob::schedule(write, (promise, bun_ptr::BackRef::new(cx.global())), cx);
        value
    }
}

#[cfg(not(windows))]
impl FdOp for WriteFile {
    const INTEREST: Interest = Interest::Writable;
    const IO_TAG: bun_io::Tag = bun_io::Tag::WriteFile;
    /// With the global that the promise was made in.
    type Js = (jsc::JSPromiseStrong, bun_ptr::BackRef<JSGlobalObject>);

    fn open(&mut self) -> Result<(JobFd, Step), Box<SystemError>> {
        let file = self.destination.data.as_file();
        let pathlike = &file.pathlike;
        let fd = fd_job::open(
            pathlike,
            sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
            self.mkdirp,
        )?;

        // Only what the store knows by now: fstat() is expensive, and a path is opened with O_NONBLOCK.
        self.could_block =
            pathlike.is_fd() && file.seekable.is_some() && !sys::is_regular_file(file.mode);

        #[cfg(any(target_os = "linux", target_os = "android"))]
        if !self.could_block && self.range.len() > 1024 {
            let _ = sys::preallocate_file(fd.get().native(), 0, self.range.len() as i64);
        }
        let step = self.step(fd.get(), false)?;
        Ok((fd, step))
    }

    fn step(&mut self, fd: Fd, mut ready: bool) -> Result<Step, Box<SystemError>> {
        let bytes = &self.source.shared_view()[self.range.clone()];
        let mut eof = false;
        loop {
            // After the last write too: scripts count on room in the pipe when the promise resolves.
            if self.could_block
                && !core::mem::take(&mut ready)
                && bun_core::is_writable(fd) == bun_core::Pollable::NotReady
            {
                return Ok(Step::Wait);
            }
            if eof || self.written >= bytes.len() {
                return Ok(Step::Done);
            }
            // Not pwrite(): the destination may not be seekable.
            match sys::write(fd, &bytes[self.written..]) {
                Ok(wrote) => {
                    self.written += wrote;
                    eof = wrote == 0;
                }
                Err(err) if err.get_errno() != sys::E::EAGAIN => return Err(err.into()),
                Err(_) if self.could_block => return Ok(Step::Wait),
                // Spins: https://github.com/oven-sh/bun/pull/35953
                Err(_) => {}
            }
        }
    }

    fn then(
        self,
        result: Result<(), Box<SystemError>>,
        (mut promise, global_this): Self::Js,
    ) -> jsc::JsResult<()> {
        let result = result.map(|()| {
            note_written(&self.destination);
            self.written as SizeType
        });
        drop(self);
        settle(promise.swap(), &global_this, result)
    }
}

// ──────────────────────────────────────────────────────────────────────────

/// Reports a finished write to its promise.
pub(super) fn settle(
    promise: &mut JSPromise,
    global_this: &JSGlobalObject,
    count: Result<SizeType, Box<SystemError>>,
) -> jsc::JsResult<()> {
    let value = promise.to_js();
    value.ensure_still_alive();
    match count {
        Err(err) => {
            let err_js = err.to_error_instance_with_async_stack(global_this, promise);
            promise.reject(global_this, Ok(err_js))?;
        }
        Ok(wrote) => {
            promise.resolve(global_this, JSValue::js_number_from_uint64(wrote as u64))?;
        }
    }
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────

pub(super) fn note_written(destination: &blob::Store) {
    if let blob::store::Data::File(file) = &destination.data
        && let PathOrFileDescriptor::Path(path) = &file.pathlike
    {
        crate::node::fs::note_opened_for_write(path.slice(), true);
    }
}

pub(crate) struct WriteFileWaitFromLockedValueTask {
    pub(crate) file_blob: Blob,
    /// The context of the script that asked for the write.
    pub(crate) context: bun_jsc::ContextId,
    /// JSC_BORROW: process-lifetime global; `BackRef` so the deref is safe and
    /// (being `Copy`) detaches from `&self` for use across `&mut self` and
    /// past `heap::take(this)`.
    pub global_this: bun_ptr::BackRef<JSGlobalObject>,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) mkdirp_if_not_exists: bool,
}

impl WriteFileWaitFromLockedValueTask {
    pub(crate) fn then_wrap(this: NonNull<c_void>, value: &mut body::Value) {
        // SAFETY: `this` is the Box-allocated task registered as `locked.task` below;
        // ownership is reclaimed here (the `Locked` arm re-leaks it).
        let this = unsafe {
            bun_core::heap::take(this.cast::<WriteFileWaitFromLockedValueTask>().as_ptr())
        };
        let _ = Self::then(this, value);
        // TODO: properly propagate exception upwards
    }

    pub(crate) fn then(
        mut this: Box<WriteFileWaitFromLockedValueTask>,
        value: &mut body::Value,
    ) -> jsc::JsResult<()> {
        let global_ref = this.global_this;
        let global_this = global_ref.get();
        let context = global_this.bun_vm().context_of(this.context);
        match value {
            body::Value::Error(err_ref) => {
                let err = err_ref.to_js(global_this);
                let _ = value.use_();
                this.promise
                    .get()
                    .reject_with_async_stack(global_this, Ok(err))?;
            }
            body::Value::Used => {
                let _ = value.use_();
                this.promise.get().reject(
                    global_this,
                    Ok(global_this.create_error_instance(format_args!(
                        "Body was used after it was consumed"
                    ))),
                )?;
            }
            body::Value::WTFStringImpl(_)
            | body::Value::InternalBlob(_)
            | body::Value::Null
            | body::Value::Empty
            | body::Value::Blob(_) => {
                let mut blob = value.use_();
                // TODO: this should be one promise not two!
                let new_promise = match blob::write_file_with_source_destination(
                    &global_this.js_thread(context),
                    &mut blob,
                    &mut this.file_blob,
                    &blob::WriteFileOptions {
                        mkdirp_if_not_exists: Some(this.mkdirp_if_not_exists),
                        ..Default::default()
                    },
                ) {
                    Ok(p) => p,
                    Err(err) => {
                        this.promise.get().reject(global_this, Err(err))?;
                        return Ok(());
                    }
                };

                if let Some(p) = new_promise.as_any_promise() {
                    let promise = this.promise.get();
                    match p.unwrap(global_this.vm(), jsc::PromiseUnwrapMode::MarkHandled) {
                        // Fulfill the new promise using the pending promise
                        jsc::PromiseResult::Pending => promise.resolve(global_this, new_promise)?,
                        jsc::PromiseResult::Rejected(err) => {
                            promise.reject(global_this, Ok(err))?
                        }
                        jsc::PromiseResult::Fulfilled(result) => {
                            promise.resolve(global_this, result)?
                        }
                    }
                }
            }
            body::Value::Locked(locked) => {
                // Re-registering for a future callback — `this` stays alive.
                locked.on_receive_value = Some(Self::then_wrap);
                locked.task = Some(bun_core::heap::into_raw_nn(this).cast::<c_void>());
            }
        }
        Ok(())
    }
}
