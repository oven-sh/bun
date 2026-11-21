use bun_core::vec::append_with;
use bun_jsc::{Completion, JSTimeType, Job, JobContext, JsResult, JsThread};
use bun_ptr::RefPtr;
use bun_sys::{self as sys, E, Stat, Tag};

use super::blocking::{Blocking, BlockingPart};
use super::job_file::{JobFile, Target, bare, is_device};
use crate::io_order::{Key, Turn};
use crate::webcore::blob::read_file::{
    PendingReadFileCompletion, ReadFileCompletion, directory_error,
};
use crate::webcore::blob::store::Data;
use crate::webcore::blob::{Blob, SizeType, Store, stat_to_js_mtime};
use crate::webcore::node_types::PathOrFileDescriptor;

const MAX_BUFFER: usize = bun_jsc::ArrayBuffer::MAX_SIZE as usize;

pub(crate) struct ReadFile {
    /// Not for `run`: the thread of the script changes it.
    store: RefPtr<Store>,
    target: Target,
    turn: Option<Turn>,
    offset: SizeType,
    max_length: SizeType,
    result: sys::Result<Vec<u8>>,
    is_directory: bool,
    /// For the store, which `then` updates.
    last_modified: Option<JSTimeType>,
    blocking_part: BlockingPart<Vec<u8>>,
}

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
                read_stream(&file, max_length, blocking).map_err(|err| bare(&err))
            });
        }
        this.result = (this.read_regular_file(&file, stat.st_size)).map_err(|err| bare(&err));
        Some(done)
    }

    fn then(this: Self, completion: Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        if let (Some(last_modified), Data::File(file)) =
            (this.last_modified, Store::data_mut(&this.store))
        {
            file.last_modified = last_modified;
        }
        let result = match this.blocking_part.take_result().unwrap_or(this.result) {
            Ok(bytes) => Ok(bytes.into()),
            Err(_) if this.is_directory => Err(directory_error(pathlike(&this.store))),
            Err(err) => Err(err.into()),
        };
        completion.complete(result)
    }

    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract. Nothing writes to the field.
        unsafe { &(*this).blocking_part }.cancel();
    }
}

fn pathlike(store: &Store) -> &PathOrFileDescriptor<'static> {
    &store.data.as_file().pathlike
}

impl ReadFile {
    pub(crate) fn start(blob: &Blob, completion: Box<dyn ReadFileCompletion>, cx: &JsThread<'_>) {
        let store = blob.store().expect("infallible: store present").clone();
        let mut read = ReadFile {
            target: Target::new(pathlike(&store)),
            turn: None,
            store,
            offset: blob.offset.get(),
            max_length: blob.size.get(),
            result: Ok(Vec::new()),
            is_directory: false,
            last_modified: None,
            blocking_part: BlockingPart::default(),
        };
        let completion = PendingReadFileCompletion::new(completion);
        let &PathOrFileDescriptor::Fd(fd) = pathlike(&read.store) else {
            return Job::<Self>::schedule(cx, read, completion);
        };
        let can_block = is_device(pathlike(&read.store));
        let key = match can_block {
            true => Key::device_input(fd),
            false => Key::descriptor(fd),
        };
        Turn::after_earlier(cx, key, false, |turn| {
            read.turn = Some(turn);
            Job::<Self>::create(cx, read, completion).for_device_if(can_block)
        });
    }

    fn open(&mut self) -> sys::Result<(JobFile, Stat)> {
        let file = JobFile::source(&mut self.target)?;
        let stat = file.stat().map_err(|err| bare(&err))?;
        self.last_modified = Some(stat_to_js_mtime(&stat));
        self.is_directory = sys::S::ISDIR(stat.st_mode as _);
        if self.is_directory {
            return Err(sys::Error::from_code(E::EISDIR, Tag::read));
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
    /// As it doubles, there is room to find the end of an input whose size is a power of two.
    const FIRST_CAPACITY: usize = MIN_READ + 4 * 1024;
    /// The system touches every page of the buffer in front of each read.
    const MAX_READ: usize = 1024 * 1024;

    let mut bytes = Vec::with_capacity(max_length.min(FIRST_CAPACITY));
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
