use bun_jsc::{Completion, JSGlobalObject, JSPromiseStrong, Job, JobContext, JsResult, JsThread};
use bun_ptr::BackRef;
use bun_sys::windows_format::open_flags::SEQUENTIAL;
use bun_sys::{self as sys, O};

use super::blocking::BlockingPart;
use super::job_file::{JobFile, Target, is_device};
use crate::io_order::Turn;
use crate::webcore::blob::write_file::{WriteFileResultType, note_written, settle};
use crate::webcore::blob::{Blob, SizeType};
use crate::webcore::node_types::PathOrFileDescriptor;

pub(crate) struct WriteFile {
    /// Not for `run`: the thread of the script changes its store.
    file_blob: Blob,
    bytes_blob: Blob,
    mkdirp_if_not_exists: bool,
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
        let bytes = this.bytes_blob.shared_view();
        let (flags, mkdirp) = (O::TRUNC | SEQUENTIAL, this.mkdirp_if_not_exists);
        match JobFile::destination(&mut this.target, flags, mkdirp) {
            // The write reports a bad descriptor.
            Ok(file) if file.can_block().unwrap_or_default() => {
                let store = this.bytes_blob.store().expect("infallible: store present");
                let start = (this.bytes_blob.offset.get() as usize).min(store.shared_view().len());
                let (store, range) = (store.clone(), start..start + bytes.len());
                this.blocking_part.run(done, move |blocking| {
                    let bytes = &store.shared_view()[range];
                    let result = file.write_everything(bytes, Some(blocking));
                    drop((file, turn));
                    result
                })
            }
            file => {
                this.result = file.and_then(|file| file.write_everything(bytes, None));
                Some(done)
            }
        }
    }

    fn then(mut this: Self, (mut promise, global): Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        if let Some(result) = this.blocking_part.take_result() {
            this.result = result;
        }
        let result = match &this.result {
            Ok(()) => {
                note_written(&this.file_blob);
                WriteFileResultType::Result(this.bytes_blob.shared_view().len() as SizeType)
            }
            Err(err) => {
                let err = match destination(&this.file_blob) {
                    PathOrFileDescriptor::Path(path) => err.with_path(path.slice()),
                    PathOrFileDescriptor::Fd(fd) => err.with_fd(*fd),
                };
                WriteFileResultType::Err(Box::new(err.to_system_error().into()))
            }
        };
        drop(this);
        settle(promise.swap(), global.get(), result)
    }

    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract. Nothing writes to the field.
        unsafe { &(*this).blocking_part }.cancel();
    }
}

impl WriteFile {
    pub(crate) fn create(file_blob: Blob, bytes_blob: Blob, mkdirp_if_not_exists: bool) -> Self {
        WriteFile {
            target: Target::new(destination(&file_blob)),
            file_blob,
            bytes_blob,
            mkdirp_if_not_exists,
            turn: None,
            result: Ok(()),
            blocking_part: BlockingPart::default(),
        }
    }

    pub(crate) fn schedule(mut self, promise: JSPromiseStrong, cx: &JsThread<'_>) {
        let destination = destination(&self.file_blob);
        let can_block = is_device(destination);
        Turn::after_earlier(cx, self.target.key(destination), true, |turn| {
            self.turn = Some(turn);
            let js = (promise, BackRef::new(cx.global()));
            Job::<Self>::create(cx, self, js).for_device_if(can_block)
        });
    }
}

fn destination(blob: &Blob) -> &PathOrFileDescriptor<'static> {
    let store = blob.store().expect("infallible: store present");
    &store.data.as_file().pathlike
}
