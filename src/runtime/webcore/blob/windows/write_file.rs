use core::ops::Range;

use bun_jsc::{
    Completion, JSGlobalObject, JSPromiseStrong, JSValue, Job, JobContext, JsResult, JsThread,
};
use bun_ptr::{BackRef, RefPtr};
use bun_sys::windows_format::open_flags::SEQUENTIAL;
use bun_sys::{self as sys, O};

use super::blocking::BlockingTask;
use super::job_file::{JobFile, Target, is_device};
use crate::io_order;
use crate::webcore::blob::write_file::{note_written, settle};
use crate::webcore::blob::{Blob, SizeType, Store};
use crate::webcore::node_types::PathOrFileDescriptor;

pub(crate) struct WriteFile {
    /// Mutated on the JS thread, so `run` must not access it.
    destination: RefPtr<Store>,
    source: RefPtr<Store>,
    /// Byte range within `source`.
    range: Range<usize>,
    mkdirp: bool,
    target: Target,
    order_guard: Option<io_order::OrderGuard>,
    result: sys::Result<()>,
    blocking_task: BlockingTask<()>,
}

impl JobContext for WriteFile {
    const CANCELLABLE: bool = true;
    /// Small writes have no synchronous fast path on Windows, so an exiting Worker would lose them.
    const SHOULD_RUN_DURING_TEARDOWN: bool = true;
    const IS_FILE_IO: bool = true;
    type OffThread = Self;
    type Js = (JSPromiseStrong, BackRef<JSGlobalObject>);

    fn run(this: &mut Self, done: Completion<Self>) -> Option<Completion<Self>> {
        let order_guard = this.order_guard.take();
        match JobFile::open_destination(&mut this.target, O::TRUNC | SEQUENTIAL, this.mkdirp) {
            // A bad descriptor is reported by the write.
            Ok(file) if file.can_block().unwrap_or_default() => {
                let source = this.source.clone();
                let range = this.range.clone();
                this.blocking_task.run(done, move |io| {
                    let bytes = &source.shared_view()[range];
                    let result = file.write_all(bytes, Some(io));
                    drop((file, order_guard));
                    result
                })
            }
            file => {
                let bytes = &this.source.shared_view()[this.range.clone()];
                this.result = file.and_then(|file| file.write_all(bytes, None));
                Some(done)
            }
        }
    }

    fn then(this: Self, (mut promise, global): Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        let result = match this.blocking_task.take_result().unwrap_or(this.result) {
            Ok(()) => {
                note_written(&this.destination);
                Ok(this.range.len() as SizeType)
            }
            Err(err) => Err(match &this.destination.data.as_file().pathlike {
                PathOrFileDescriptor::Path(path) => err.with_path(path.slice()).into(),
                PathOrFileDescriptor::Fd(fd) => err.with_fd(*fd).into(),
            }),
        };
        drop((this.target, this.source, this.destination));
        settle(promise.swap(), global.get(), result)
    }

    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract; the field is not written after the job is created.
        unsafe { &(*this).blocking_task }.cancel();
    }
}

impl WriteFile {
    /// `source` is the store of `source_blob`. Returns the promise.
    pub(crate) fn start(
        destination: RefPtr<Store>,
        source: RefPtr<Store>,
        source_blob: &Blob,
        mkdirp: bool,
        cx: &JsThread<'_>,
    ) -> JSValue {
        let pathlike = &destination.data.as_file().pathlike;
        let target = Target::new(pathlike);
        let key = target.key(pathlike);
        let can_block = is_device(pathlike);
        let start = (source_blob.offset.get() as usize).min(source.shared_view().len());
        let mut write = WriteFile {
            range: start..start + source_blob.shared_view().len(),
            destination,
            source,
            mkdirp,
            target,
            order_guard: None,
            result: Ok(()),
            blocking_task: BlockingTask::default(),
        };
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        io_order::OrderGuard::enqueue_job(cx, key, true, |order_guard| {
            write.order_guard = Some(order_guard);
            let js = (promise, BackRef::new(cx.global()));
            Job::<Self>::create(cx, write, js).use_device_pool(can_block)
        });
        value
    }
}
