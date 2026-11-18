use bun_core::vec::append_with;
use bun_jsc::{Completion, JSTimeType, Job, JobContext, JsResult, JsThread, SystemError};
use bun_ptr::RefPtr;
use bun_sys::{self as sys, Stat};

use super::blocking::{Blocking, BlockingPart};
use super::job_file::{JobFile, Target, bare, is_device};
use crate::io_order::{Key, Turn};
use crate::webcore::blob::read_file::{
    PendingReadFileCompletion, ReadFileCompletion, ReadFileRead, ReadFileResultType,
    directory_error,
};
use crate::webcore::blob::store::Data;
use crate::webcore::blob::{Blob, SizeType, Store, stat_to_js_mtime};
use crate::webcore::node_types::PathOrFileDescriptor;

const MAX_BUFFER: usize = bun_jsc::ArrayBuffer::MAX_SIZE as usize;

pub(crate) struct ReadFile {
    store: RefPtr<Store>,
    pathlike: PathOrFileDescriptor<'static>,
    target: Target,
    turn: Option<Turn>,
    offset: SizeType,
    max_length: SizeType,
    result: Result<Vec<u8>, Box<SystemError>>,
    /// For the store, which `then` updates.
    last_modified: Option<JSTimeType>,
    blocking_part: BlockingPart<Vec<u8>>,
}

// SAFETY: the count of the store is atomic, and only `then` looks into it.
unsafe impl Send for ReadFile {}

impl JobContext for ReadFile {
    const CANCELLABLE: bool = true;
    const IS_FILE_IO: bool = true;
    type OffThread = Self;
    type Js = PendingReadFileCompletion;

    fn run(this: &mut Self, done: Completion<Self>) -> Option<Completion<Self>> {
        let turn = this.turn.take();
        let (file, stat) = match this.open() {
            Ok(opened) => opened,
            Err(err) => {
                this.result = Err(err);
                return Some(done);
            }
        };
        if !sys::S::ISREG(stat.st_mode as _) {
            let max_length = this.max_length as usize;
            return (this.blocking_part).run(done, move |blocking| {
                let _turn = turn;
                read_stream(&file, max_length, blocking)
            });
        }
        this.result =
            (this.read_regular_file(&file, stat.st_size)).map_err(|err| shown(&bare(&err)));
        Some(done)
    }

    fn then(this: Self, completion: Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        if let (Some(last_modified), Data::File(file)) =
            (this.last_modified, Store::data_mut(&this.store))
        {
            file.last_modified = last_modified;
        }
        let blocking = this.blocking_part.take_result();
        let result = blocking.map_or(this.result, |result| {
            result.map_err(|err| shown(&bare(&err)))
        });
        completion.complete(match result {
            Ok(bytes) => ReadFileResultType::Result(ReadFileRead { buf: bytes.into() }),
            Err(err) => ReadFileResultType::Err(*err),
        })
    }

    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract. Nothing writes to the field.
        unsafe { &(*this).blocking_part }.cancel();
    }
}

fn shown(err: &sys::Error) -> Box<SystemError> {
    Box::new(err.to_system_error().into())
}

impl ReadFile {
    pub(crate) fn create(blob: &Blob) -> ReadFile {
        let store = blob.store().expect("infallible: store present").clone();
        let pathlike = store.data.as_file().clone().pathlike;
        ReadFile {
            target: Target::new(&pathlike),
            turn: None,
            store,
            pathlike,
            offset: blob.offset.get(),
            max_length: blob.size.get(),
            result: Ok(Vec::new()),
            last_modified: None,
            blocking_part: BlockingPart::default(),
        }
    }

    pub(crate) fn schedule(mut self, completion: Box<dyn ReadFileCompletion>, cx: &JsThread<'_>) {
        let completion = PendingReadFileCompletion::new(completion);
        let PathOrFileDescriptor::Fd(fd) = self.pathlike else {
            return Job::<Self>::schedule(cx, self, completion);
        };
        let can_block = is_device(&self.pathlike);
        let key = match can_block {
            true => Key::device_input(fd),
            false => Key::descriptor(fd),
        };
        Turn::after_earlier(cx, key, false, |turn| {
            self.turn = Some(turn);
            Job::<Self>::create(cx, self, completion).for_device_if(can_block)
        });
    }

    fn open(&mut self) -> Result<(JobFile, Stat), Box<SystemError>> {
        let file = JobFile::source(core::mem::take(&mut self.target), &self.pathlike);
        let file = file.map_err(|err| shown(&err))?;
        let stat = file.stat().map_err(|err| shown(&bare(&err)))?;
        self.last_modified = Some(stat_to_js_mtime(&stat));
        if sys::S::ISDIR(stat.st_mode as _) {
            return Err(Box::new(directory_error(&self.pathlike)));
        }
        Ok((file, stat))
    }

    fn read_regular_file(&self, file: &JobFile, size: u64) -> sys::Result<Vec<u8>> {
        let len = size.saturating_sub(self.offset).min(self.max_length) as usize;
        if file.is_lent() && self.offset > 0 {
            // The descriptor is left at the start of the slice.
            let _ = file.seek_to(self.offset);
        }
        let mut bytes = Vec::new();
        if len == 0 {
            return Ok(bytes);
        }
        if len > MAX_BUFFER || bytes.try_reserve_exact(len).is_err() {
            return Err(sys::Error::oom());
        }
        append_with(&mut bytes, len, |spare| {
            if file.is_lent() {
                return file.pread_all_buf(spare, self.offset);
            }
            if self.offset > 0 {
                file.seek_to(self.offset)?;
            }
            file.read_all_buf(spare)
        })?;
        Ok(bytes)
    }
}

fn read_stream(file: &JobFile, max_length: usize, blocking: &Blocking) -> sys::Result<Vec<u8>> {
    const MIN_READ: usize = 64 * 1024;
    /// The system touches every page of the buffer in front of each read.
    const MAX_READ: usize = 1024 * 1024;

    let mut bytes = Vec::new();
    while bytes.len() < max_length {
        let left = max_length - bytes.len();
        if bytes.len() > MAX_BUFFER || bytes.try_reserve(left.min(MIN_READ)).is_err() {
            return Err(sys::Error::oom());
        }
        let read = append_with(&mut bytes, left.min(MAX_READ), |spare| {
            blocking.read(file.fd(), spare)
        })?;
        if read == 0 {
            break;
        }
    }
    bytes.shrink_to_fit();
    Ok(bytes)
}
