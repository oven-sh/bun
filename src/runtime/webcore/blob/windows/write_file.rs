use core::ops::Range;

use bun_jsc::{
    Completion, JSGlobalObject, JSPromiseStrong, JSValue, Job, JobContext, JsResult, JsThread,
};
use bun_ptr::{BackRef, RefPtr};
use bun_sys::windows_format::open_flags::SEQUENTIAL;
use bun_sys::{self as sys, O};

use super::blocking::BlockingPart;
use super::job_file::{JobFile, Target, is_device};
use crate::io_order::Turn;
use crate::webcore::blob::write_file::{note_written, settle};
use crate::webcore::blob::{Blob, SizeType, Store};
use crate::webcore::node_types::PathOrFileDescriptor;

pub(crate) struct WriteFile {
    /// Not for `run`: the thread of the script changes it.
    destination: RefPtr<Store>,
    source: RefPtr<Store>,
    /// Of the bytes of `source`.
    range: Range<usize>,
    mkdirp: bool,
    target: Target,
    turn: Option<Turn>,
    result: sys::Result<()>,
    blocking_part: BlockingPart<()>,
}

impl JobContext for WriteFile {
    const CANCELLABLE: bool = true;
    /// There is no synchronous path for small writes, which a Worker that exits would lose.
    const RUNS_IN_FINAL_WAIT: bool = true;
    const IS_FILE_IO: bool = true;
    type OffThread = Self;
    type Js = (JSPromiseStrong, BackRef<JSGlobalObject>);

    fn run(this: &mut Self, done: Completion<Self>) -> Option<Completion<Self>> {
        let turn = this.turn.take();
        match JobFile::destination(&mut this.target, O::TRUNC | SEQUENTIAL, this.mkdirp) {
            // The write reports a bad descriptor.
            Ok(file) if file.can_block().unwrap_or_default() => {
                let (source, range) = (this.source.clone(), this.range.clone());
                this.blocking_part.run(done, move |blocking| {
                    let bytes = &source.shared_view()[range];
                    let result = file.write_everything(bytes, Some(blocking));
                    drop((file, turn));
                    result
                })
            }
            file => {
                let bytes = &this.source.shared_view()[this.range.clone()];
                this.result = file.and_then(|file| file.write_everything(bytes, None));
                Some(done)
            }
        }
    }

    fn then(this: Self, (mut promise, global): Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        let result = match this.blocking_part.take_result().unwrap_or(this.result) {
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
        // SAFETY: fn contract. Nothing writes to the field.
        unsafe { &(*this).blocking_part }.cancel();
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
        let (key, can_block) = (target.key(pathlike), is_device(pathlike));
        let start = (source_blob.offset.get() as usize).min(source.shared_view().len());
        let mut write = WriteFile {
            range: start..start + source_blob.shared_view().len(),
            destination,
            source,
            mkdirp,
            target,
            turn: None,
            result: Ok(()),
            blocking_part: BlockingPart::default(),
        };
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        Turn::after_earlier(cx, key, true, |turn| {
            write.turn = Some(turn);
            let js = (promise, BackRef::new(cx.global()));
            Job::<Self>::create(cx, write, js).for_device_if(can_block)
        });
        value
    }
}
