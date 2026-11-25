use core::convert::Infallible;
use core::ops::Range;

use bun_jsc::job::{CancelTokens, OwnedJob, Running};
use bun_jsc::{JSGlobalObject, JSPromiseStrong, JSValue, Job, JsResult, JsThread};
use bun_ptr::{BackRef, RefPtr};
use bun_sys::windows_format::open_flags::SEQUENTIAL;
use bun_sys::{self as sys, O};

use super::blocking::{BlockingIo, run_and_finish};
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
    blocking_io: BlockingIo,
}

impl OwnedJob for WriteFile {
    type OffThread = Self;
    type Js = (JSPromiseStrong, BackRef<JSGlobalObject>);
    type Shared = CancelTokens;
    type Resume = Infallible;
    const OUTLIVES_SCRIPT: bool = false;
    /// Small writes have no synchronous fast path on Windows, so an exiting Worker would lose them.
    const SHOULD_RUN_DURING_TEARDOWN: bool = true;
    const IS_FILE_IO: bool = true;

    fn run(mut job: Running<Self>) {
        let this = job.off();
        let mut order_guard = this.order_guard.take();
        let file = JobFile::open_destination(&mut this.target, O::TRUNC | SEQUENTIAL, this.mkdirp);
        // A bad descriptor is reported by the write.
        let can_block = matches!(file.as_ref().map(JobFile::can_block), Ok(Ok(true)));
        let is_own_connection = can_block && file.as_ref().is_ok_and(JobFile::is_own_connection);
        let pending_write = order_guard
            .take_if(|_| is_own_connection)
            .and_then(io_order::OrderGuard::release_early);
        run_and_finish(job, can_block, move |this| {
            let _guards = (order_guard, pending_write);
            let bytes = &this.source.shared_view()[this.range.clone()];
            let io = can_block.then_some(&this.blocking_io);
            this.result = file.and_then(|file| file.write_all(bytes, io));
        });
    }

    fn resume(_: Running<Self>, with: Infallible) {
        match with {}
    }

    fn then(this: Self, (mut promise, global): Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        let result = match this.result {
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
            blocking_io: BlockingIo::default(),
        };
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        io_order::OrderGuard::enqueue_job(cx, key, true, |order_guard| {
            write.order_guard = Some(order_guard);
            let js = (promise, BackRef::new(cx.global()));
            let cancel_tokens = write.blocking_io.cancel_tokens();
            Job::<Self>::create(cx, write, js, cancel_tokens).use_device_pool(can_block)
        });
        value
    }
}
