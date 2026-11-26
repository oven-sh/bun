use core::convert::Infallible;

use bun_core::vec::append_with;
use bun_jsc::job::{CancelTokens, OwnedJob, Running};
use bun_jsc::{JSTimeType, Job, JsResult, JsThread};
use bun_ptr::RefPtr;
use bun_sys::windows::named_pipe;
use bun_sys::{self as sys, E, Stat, Tag};

use super::blocking::{BlockingIo, run_and_finish};
use super::job_file::{JobFile, Target, is_device, strip_error_context};
use crate::io_order::{self, Key};
use crate::node::fs::error_for_caller;
use crate::webcore::blob::read_file::{
    PendingReadFileCompletion, ReadFileCompletion, directory_error,
};
use crate::webcore::blob::store::Data;
use crate::webcore::blob::{Blob, SizeType, Store, stat_to_js_mtime};
use crate::webcore::node_types::PathOrFileDescriptor;

const MAX_BUFFER_LEN: usize = bun_jsc::ArrayBuffer::MAX_SIZE as usize;

pub(crate) struct ReadFile {
    /// Mutated on the JS thread, so `run` must not access it.
    store: RefPtr<Store>,
    target: Target,
    order_guard: Option<io_order::OrderGuard>,
    offset: SizeType,
    max_length: SizeType,
    result: sys::Result<Vec<u8>>,
    is_directory: bool,
    /// Copied to the store in `then`.
    last_modified: Option<JSTimeType>,
    blocking_io: BlockingIo,
}

impl OwnedJob for ReadFile {
    type OffThread = Self;
    type Js = PendingReadFileCompletion;
    type Shared = CancelTokens;
    type Resume = Infallible;
    const OUTLIVES_SCRIPT: bool = false;
    const IS_FILE_IO: bool = true;

    fn run(mut job: Running<Self>) {
        let order_guard = job.off().order_guard.take();
        let opened = job.off().open();
        let can_block = matches!(&opened, Ok((_, stat)) if !sys::S::ISREG(stat.st_mode as _));
        run_and_finish(job, can_block, move |this| {
            let _order_guard = order_guard;
            this.result = opened.and_then(|(file, stat)| {
                let result = if can_block {
                    read_stream(
                        &file,
                        this.offset,
                        this.max_length as usize,
                        &this.blocking_io,
                    )
                } else {
                    this.read_regular_file(&file, stat.st_size)
                };
                result.map_err(|err| strip_error_context(&err))
            });
        });
    }

    fn resume(_: Running<Self>, with: Infallible) {
        match with {}
    }

    fn then(this: Self, completion: Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        if let Some(last_modified) = this.last_modified
            && let Data::File(file) = Store::data_mut(&this.store)
        {
            file.last_modified = last_modified;
        }
        let result = match this.result {
            Ok(bytes) => Ok(bytes.into()),
            Err(_) if this.is_directory => Err(directory_error(pathlike(&this.store))),
            Err(err) => Err(match pathlike(&this.store) {
                PathOrFileDescriptor::Path(path) => error_for_caller([Some(path), None], err),
                PathOrFileDescriptor::Fd(_) => err,
            }
            .into()),
        };
        completion.complete(result)
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
            order_guard: None,
            store,
            offset: blob.offset.get(),
            max_length: blob.size.get(),
            result: Ok(Vec::new()),
            is_directory: false,
            last_modified: None,
            blocking_io: BlockingIo::default(),
        };
        let completion = PendingReadFileCompletion::new(completion);
        let cancel_tokens = read.blocking_io.cancel_tokens(cx);
        let &PathOrFileDescriptor::Fd(fd) = pathlike(&read.store) else {
            return Job::<Self>::create(cx, read, completion, cancel_tokens).schedule();
        };
        let can_block = is_device(pathlike(&read.store));
        let key = if can_block {
            Key::from_device_input(fd)
        } else {
            Key::from_fd(fd)
        };
        io_order::OrderGuard::enqueue_job(cx, key, false, |order_guard| {
            read.order_guard = Some(order_guard);
            Job::<Self>::create(cx, read, completion, cancel_tokens).use_device_pool(can_block)
        });
    }

    fn open(&mut self) -> sys::Result<(JobFile, Stat)> {
        let file = JobFile::open_source(&mut self.target)?;
        let stat = file.stat().map_err(|err| strip_error_context(&err))?;
        self.last_modified = Some(stat_to_js_mtime(&stat));
        self.is_directory = sys::S::ISDIR(stat.st_mode as _);
        if self.is_directory {
            return Err(sys::Error::from_code(E::EISDIR, Tag::read));
        }
        Ok((file, stat))
    }

    fn read_regular_file(&self, file: &JobFile, size: u64) -> sys::Result<Vec<u8>> {
        let len = size.saturating_sub(self.offset).min(self.max_length) as usize;
        if file.is_borrowed() && self.offset > 0 {
            // Leaves the caller's file position at the start of the slice.
            let _ = file.seek_to(self.offset);
        }
        let mut bytes = Vec::new();
        if len == 0 {
            return Ok(bytes);
        }
        if len > MAX_BUFFER_LEN || bytes.try_reserve_exact(len).is_err() {
            return Err(sys::Error::oom());
        }
        append_with(&mut bytes, len, |spare| {
            if file.is_borrowed() {
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

fn read_stream(
    file: &JobFile,
    offset: u64,
    max_length: usize,
    io: &BlockingIo,
) -> sys::Result<Vec<u8>> {
    const MIN_READ_LEN: usize = 64 * 1024;
    /// Above a power of two, so that a large power-of-two input reaches EOF without another doubling.
    const INITIAL_CAPACITY: usize = MIN_READ_LEN + 4 * 1024;
    /// The kernel probes every page of the buffer before each read.
    const MAX_READ_LEN: usize = 1024 * 1024;

    let max_read_len = MAX_READ_LEN.min(named_pipe::max_transfer_len(file.fd().native()));
    let mut bytes = Vec::with_capacity(max_length.min(INITIAL_CAPACITY));
    while bytes.len() < max_length {
        let remaining = max_length - bytes.len();
        if bytes.len() > MAX_BUFFER_LEN || bytes.try_reserve(remaining.min(MIN_READ_LEN)).is_err() {
            return Err(sys::Error::oom());
        }
        let offset = offset + bytes.len() as u64;
        let bytes_read = append_with(&mut bytes, remaining.min(max_read_len), |spare| {
            io.read(file.fd(), spare, Some(offset))
        })?;
        if bytes_read == 0 {
            break;
        }
    }
    bytes.shrink_to_fit();
    Ok(bytes)
}
