use core::convert::Infallible;

use bun_core::env_var::feature_flag;
use bun_core::vec::append_with;
use bun_core::{ZStr, strings};
use bun_jsc::job::{CancelTokens, OwnedJob, Running};
use bun_jsc::{JSPromiseStrong, JSValue, Job, JsResult, JsThread, SystemError};
use bun_ptr::RefPtr;
use bun_sys::windows::{Win32Error, named_pipe};
use bun_sys::windows_format::wtf16;
use bun_sys::{self as sys, E, Mode, O, Tag, Win32ErrorExt as _};

use super::blocking::{BlockingIo, run_and_finish};
use super::job_file::{JobFile, Target, create_parent_dirs, is_device, strip_error_context};
use crate::io_order;
use crate::webcore::blob::{MAX_SIZE, SizeType, Store};

pub(crate) struct CopyFile {
    source: Target,
    destination: Target,
    order_guard: Option<io_order::OrderGuard>,
    max_length: SizeType,
    mkdirp_if_not_exists: bool,
    destination_mode: Option<Mode>,
    result: sys::Result<SizeType>,
    blocking_io: BlockingIo,
}

impl OwnedJob for CopyFile {
    type OffThread = Self;
    type Js = JSPromiseStrong;
    type Shared = CancelTokens;
    type Resume = Infallible;
    const OUTLIVES_SCRIPT: bool = false;
    /// See `WriteFile`.
    const SHOULD_RUN_DURING_TEARDOWN: bool = true;
    const IS_FILE_IO: bool = true;

    fn run(mut job: Running<Self>) {
        let this = job.off();
        let mut order_guard = this.order_guard.take();
        if let Some(result) = this.try_copy_file() {
            this.result = result;
            drop(order_guard);
            return job.finish();
        }
        let transfer = this.open();
        let (source_can_block, destination_can_block) =
            transfer.as_ref().map_or((false, false), |transfer| {
                (transfer.source_can_block, transfer.destination_can_block)
            });
        // Other writes must not wait for a source that may never reach EOF.
        if let Some(order_guard) = order_guard.take_if(|_| source_can_block) {
            order_guard.release_early();
        }
        run_and_finish(job, source_can_block || destination_can_block, |this| {
            let _order_guard = order_guard;
            this.result = transfer.and_then(|transfer| transfer.run(&this.blocking_io));
        });
    }

    fn resume(_: Running<Self>, with: Infallible) {
        match with {}
    }

    fn then(this: Self, mut promise: Self::Js, cx: &JsThread<'_>) -> JsResult<()> {
        let promise = promise.swap();
        let global = cx.global();
        match this.result {
            Ok(copied) => {
                if let Target::Path { original_path, .. } = &this.destination {
                    crate::node::fs::note_opened_for_write(original_path, true);
                }
                promise.resolve(global, JSValue::js_number_from_uint64(copied))
            }
            Err(err) => {
                let err = SystemError::from(err.to_system_error());
                let err = err.to_error_instance_with_async_stack(global, promise);
                promise.reject(global, Ok(err))
            }
        }
    }
}

impl CopyFile {
    /// Returns the promise.
    pub(crate) fn create(
        destination_store: RefPtr<Store>,
        source_store: RefPtr<Store>,
        max_length: SizeType,
        cx: &JsThread<'_>,
        mkdirp_if_not_exists: bool,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        let stores = [source_store, destination_store];
        let [from, to] = stores
            .each_ref()
            .map(|store| &store.data.as_file().pathlike);
        let source = Target::new(from);
        let destination = Target::new(to);
        let can_block = is_device(from) || is_device(to);
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        io_order::OrderGuard::enqueue_job(cx, destination.key(to), true, |order_guard| {
            let copy = CopyFile {
                source,
                destination,
                order_guard: Some(order_guard),
                max_length,
                mkdirp_if_not_exists,
                destination_mode,
                result: Ok(0),
                blocking_io: BlockingIo::default(),
            };
            let cancel_tokens = copy.blocking_io.cancel_tokens();
            Job::<Self>::create(cx, copy, promise, cancel_tokens).use_device_pool(can_block)
        });
        value
    }

    /// `None` if the copy needs the read/write loop.
    fn try_copy_file(&self) -> Option<sys::Result<SizeType>> {
        let [from, to] = [&self.source, &self.destination].map(|target| match target {
            Target::Path {
                resolved_path,
                original_path,
            } if can_use_copy_file(resolved_path.as_bytes()) => {
                Some((resolved_path.as_zstr(), &**original_path))
            }
            _ => None,
        });
        // Lets tests force the read/write loop.
        if feature_flag::BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE.get() == Some(true) {
            return None;
        }
        Some(self.copy_file(from?, to?))
    }

    fn copy_file(
        &self,
        (from, original_from): (&ZStr, &[u8]),
        (to, original_to): (&ZStr, &[u8]),
    ) -> sys::Result<SizeType> {
        let copy_error =
            |errno: E, path| sys::Error::from_code(errno, Tag::copyfile).with_path(path);
        let encode_error = |err, path| copy_error(Win32Error::from(err).to_node_errno(), path);
        let mut from_buf = bun_paths::w_path_buffer_pool::get();
        let from_w = wtf16::encode(from.as_bytes(), &mut from_buf[..])
            .map_err(|err| encode_error(err, original_from))?;
        let mut to_buf = bun_paths::w_path_buffer_pool::get();
        let to_w = wtf16::encode(to.as_bytes(), &mut to_buf[..])
            .map_err(|err| encode_error(err, original_to))?;

        let mut mkdirp = self.mkdirp_if_not_exists;
        while let Err(err) = sys::windows::CopyFileW(from_w, to_w, false) {
            match err.to_node_errno() {
                E::EBUSY
                    if let Ok(source) = sys::stat(from)
                        && let Ok(destination) = sys::stat(to)
                        && source.is_same_file(&destination) =>
                {
                    break;
                }
                E::ENOENT
                    if let Err(err) = sys::access(from, 0)
                        && err.get_errno() == E::ENOENT =>
                {
                    return Err(copy_error(E::ENOENT, original_from));
                }
                E::ENOENT if core::mem::take(&mut mkdirp) => create_parent_dirs(to, original_to)?,
                // https://github.com/oven-sh/bun/issues/6336
                E::EPERM => return Err(copy_error(E::ENOENT, original_to)),
                errno => return Err(copy_error(errno, original_to)),
            }
        }

        let with_path = |err: sys::Error| err.with_path(original_to);
        let mut size = sys::stat(to).map_err(with_path)?.st_size;
        if size > self.max_length && self.max_length != MAX_SIZE {
            size = self.max_length;
            let _ = sys::File::open(to, O::WRONLY, 0)
                .and_then(|file| sys::ftruncate(file.fd(), size as i64));
        }
        if let Some(mode) = self.destination_mode {
            sys::chmod(to, mode).map_err(with_path)?;
        }
        Ok(size)
    }

    fn open(&mut self) -> sys::Result<Transfer> {
        let is_destination_fd = matches!(self.destination, Target::Fd(_));
        let mut open_destination = |flags| {
            let mkdirp = self.mkdirp_if_not_exists;
            let file = JobFile::open_destination(&mut self.destination, flags, mkdirp)?;
            file.can_block().map(|can_block| (file, can_block))
        };
        let borrowed_destination = is_destination_fd.then(|| open_destination(0)).transpose()?;

        let source = JobFile::open_source(&mut self.source)?;
        let source_can_block = source.can_block()?;
        // `stat` fails on a volume.
        let source_stat = (!source_can_block).then(|| source.stat().ok()).flatten();
        if source_stat.is_some_and(|stat| sys::S::ISDIR(stat.st_mode as _)) {
            return Err(sys::Error::from_code(E::EISDIR, Tag::read));
        }

        let (destination, destination_can_block) = match borrowed_destination {
            Some(borrowed) => borrowed,
            // The destination may be the source, so it is truncated after the copy.
            None if source_stat.is_some() => open_destination(0)?,
            None => open_destination(O::TRUNC)?,
        };
        let destination_stat = (source_stat.is_some() && !destination_can_block)
            .then(|| destination.stat().ok())
            .flatten();
        if destination_stat.is_some_and(|stat| sys::S::ISDIR(stat.st_mode as _)) {
            let err = sys::Error::from_code(E::EISDIR, Tag::open);
            return Err(self.destination.attach_path(err));
        }

        Ok(Transfer {
            should_read_from_start: source.is_borrowed()
                && source_stat.is_some()
                && !(destination.is_borrowed() && destination_can_block),
            is_same_file: source_stat
                .zip(destination_stat)
                .is_some_and(|(source, destination)| source.is_same_file(&destination)),
            source_size: source_stat.map_or(0, |stat| stat.st_size),
            destination_size: match (source_stat, destination_stat) {
                (None, _) => 0,
                (Some(_), stat) => stat.map_or(u64::MAX, |stat| stat.st_size),
            },
            source,
            source_can_block,
            destination,
            destination_can_block,
            max_length: self.max_length,
            mode: self.destination_mode,
        })
    }
}

/// `CopyFileW` on a pipe or a console would block a file pool thread.
fn can_use_copy_file(path: &[u8]) -> bool {
    let Some(path) = path.strip_prefix(b"\\\\?\\") else {
        return false;
    };
    let mut components = strings::split(path, b"\\");
    let (name, device_names): (_, &[&[u8]]) = match components.next() {
        Some(unc) if unc.eq_ignore_ascii_case(b"unc") => (components.nth(1), &[b"pipe"]),
        name => (name, &[b"con", b"conin$", b"conout$", b"pipe"]),
    };
    !name.is_some_and(|name| strings::eql_any_case_insensitive_ascii(name, device_names))
}

/// A copy through the read/write loop.
struct Transfer {
    source: JobFile,
    source_can_block: bool,
    /// 0 if unknown.
    source_size: u64,
    /// The file position of the source is neither used nor moved.
    should_read_from_start: bool,
    destination: JobFile,
    destination_can_block: bool,
    /// `u64::MAX` if unknown.
    destination_size: u64,
    is_same_file: bool,
    max_length: SizeType,
    mode: Option<Mode>,
}

impl Transfer {
    fn run(self, blocking_io: &BlockingIo) -> sys::Result<SizeType> {
        self.run_inner(blocking_io)
            .map_err(|err| strip_error_context(&err))
    }

    fn run_inner(&self, blocking_io: &BlockingIo) -> sys::Result<SizeType> {
        let copied = if self.is_same_file {
            self.source_size.min(self.max_length)
        } else {
            self.copy(blocking_io)?
        };
        if self.destination.is_borrowed() || self.destination_can_block {
            return Ok(copied);
        }
        if self.destination_size > copied {
            sys::ftruncate(self.destination.fd(), copied as i64)?;
        }
        if let Some(mode) = self.mode {
            sys::fchmod(self.destination.fd(), mode)?;
        }
        Ok(copied)
    }

    fn copy(&self, blocking_io: &BlockingIo) -> sys::Result<SizeType> {
        const CHUNK_SIZE: SizeType = 256 * 1024;
        const MAX_SECTOR_SIZE: SizeType = 4096;
        let limit = match self.source_size {
            0 => self.max_length,
            size => size.min(self.max_length),
        };
        let mut buf = Vec::new();
        if buf
            .try_reserve_exact(limit.min(CHUNK_SIZE) as usize)
            .is_err()
        {
            return Err(sys::Error::oom());
        }
        let mut source = ReopenableFile::new(&self.source, O::RDONLY);
        let mut destination = ReopenableFile::new(&self.destination, O::WRONLY);
        let source_io = self.source_can_block.then_some(blocking_io);
        let destination_io = self.destination_can_block.then_some(blocking_io);
        let max_read_len = source_io.map_or(usize::MAX, |_| {
            named_pipe::max_transfer_len(self.source.fd().native())
        });
        let mut copied = 0;
        while copied < limit {
            buf.clear();
            let read_len = max_read_len.min((limit - copied) as usize);
            let bytes_read = source.run(|source| {
                let fd = source.fd();
                append_with(&mut buf, read_len, |spare| match source_io {
                    Some(io) => io.read(fd, spare, None),
                    None if self.should_read_from_start => sys::pread_buf(fd, spare, copied as i64),
                    None => sys::read_buf(fd, spare),
                })
            })?;
            if bytes_read == 0 {
                break;
            }
            destination.run(|destination| destination.write_all(&buf, destination_io))?;
            copied += bytes_read as u64;
        }
        source.update_position(|end| end.next_multiple_of(MAX_SECTOR_SIZE));
        // Another process may have moved the position back.
        destination.update_position(|end| end.saturating_sub(copied));
        Ok(copied)
    }
}

/// Continues on a handle of its own once the caller's file refuses a transfer because of how it was opened.
struct ReopenableFile<'a> {
    file: &'a JobFile,
    flags: i32,
    reopened: Option<JobFile>,
}

impl<'a> ReopenableFile<'a> {
    fn new(file: &'a JobFile, flags: i32) -> Self {
        Self {
            file,
            flags,
            reopened: None,
        }
    }

    fn run<T>(&mut self, mut transfer: impl FnMut(&JobFile) -> sys::Result<T>) -> sys::Result<T> {
        if let Some(reopened) = &self.reopened {
            return transfer(reopened);
        }
        match transfer(self.file) {
            Err(err)
                if err.get_errno() == E::EINVAL
                    && sys::windows::is_disk_file(self.file.fd())
                    && let Some(fd) =
                        sys::windows::reopen_buffered(self.file.fd(), self.flags)? =>
            {
                transfer(
                    self.reopened
                        .insert(JobFile::Opened(sys::File::from_fd(fd))),
                )
            }
            result => result,
        }
    }

    /// An unbuffered file accepts only a multiple of the sector size, which `align` returns.
    fn update_position(self, align: impl FnOnce(u64) -> u64) {
        if let Some(reopened) = self.reopened
            && let Ok(position) = sys::lseek(reopened.fd(), 0, libc::SEEK_CUR)
            && sys::set_file_offset(self.file.fd(), position as u64).is_err()
        {
            let _ = sys::set_file_offset(self.file.fd(), align(position as u64));
        }
    }
}
