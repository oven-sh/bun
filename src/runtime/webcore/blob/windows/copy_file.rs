use bun_core::env_var::feature_flag;
use bun_core::vec::append_with;
use bun_core::{ZStr, strings};
use bun_jsc::{
    Completion, JSPromiseStrong, JSValue, Job, JobContext, JsResult, JsThread, SystemError,
};
use bun_ptr::RefPtr;
use bun_sys::windows::Win32Error;
use bun_sys::windows_format::wide;
use bun_sys::{self as sys, E, Mode, O, Tag, Win32ErrorExt as _};

use super::blocking::{Blocking, BlockingPart};
use super::job_file::{JobFile, Target, bare, is_device, make_folder_for};
use crate::io_order::Turn;
use crate::webcore::blob::{MAX_SIZE, SizeType, Store};

pub(crate) struct CopyFile {
    source: Target,
    destination: Target,
    turn: Option<Turn>,
    max_length: SizeType,
    mkdirp_if_not_exists: bool,
    destination_mode: Option<Mode>,
    result: sys::Result<SizeType>,
    blocking_part: BlockingPart<SizeType>,
}

impl JobContext for CopyFile {
    const CANCELLABLE: bool = true;
    /// As `WriteFile`.
    const RUNS_IN_FINAL_WAIT: bool = true;
    const IS_FILE_IO: bool = true;
    type OffThread = Self;
    type Js = JSPromiseStrong;

    fn run(this: &mut Self, done: Completion<Self>) -> Option<Completion<Self>> {
        let mut turn = this.turn.take();
        if let Some(result) = this.copy_path() {
            this.result = result;
            return Some(done);
        }
        match this.open() {
            Ok(transfer) if transfer.source_can_block || transfer.destination_can_block => {
                // Other writes do not wait for a source that may never end.
                if let Some(turn) = turn.take_if(|_| transfer.source_can_block) {
                    turn.pass_on_now();
                }
                this.blocking_part.run(done, move |blocking| {
                    let _turn = turn;
                    transfer.run(Some(blocking))
                })
            }
            transfer => {
                this.result = transfer.and_then(|transfer| transfer.run(None));
                Some(done)
            }
        }
    }

    fn then(this: Self, mut promise: Self::Js, cx: &JsThread<'_>) -> JsResult<()> {
        let (promise, global) = (promise.swap(), cx.global());
        match this.blocking_part.take_result().unwrap_or(this.result) {
            Ok(copied) => {
                if let Target::Path { shown, .. } = &this.destination {
                    crate::node::fs::note_opened_for_write(shown, true);
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

    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract. Nothing writes to the field.
        unsafe { &(*this).blocking_part }.cancel();
    }
}

impl CopyFile {
    /// Returns the promise of the copy.
    pub(crate) fn create(
        to: RefPtr<Store>,
        from: RefPtr<Store>,
        max_length: SizeType,
        cx: &JsThread<'_>,
        mkdirp_if_not_exists: bool,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        let stores = [from, to];
        let [from, to] = stores
            .each_ref()
            .map(|store| &store.data.as_file().pathlike);
        let (source, destination) = (Target::new(from), Target::new(to));
        let can_block = is_device(from) || is_device(to);
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        Turn::after_earlier(cx, destination.key(to), true, |turn| {
            let copy = CopyFile {
                source,
                destination,
                turn: Some(turn),
                max_length,
                mkdirp_if_not_exists,
                destination_mode,
                result: Ok(0),
                blocking_part: BlockingPart::default(),
            };
            Job::<Self>::create(cx, copy, promise).for_device_if(can_block)
        });
        value
    }

    /// `None` if it takes the read/write loop.
    fn copy_path(&self) -> Option<sys::Result<SizeType>> {
        let [from, to] = [&self.source, &self.destination].map(|target| match target {
            Target::Path { resolved, shown } if suits_copy_file(resolved.as_bytes()) => {
                Some((resolved.as_zstr(), &**shown))
            }
            _ => None,
        });
        // For testing the read/write loop.
        let is_disabled = feature_flag::BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE.get() == Some(true);
        Some(self.copy_file(from.filter(|_| !is_disabled)?, to?))
    }

    fn copy_file(
        &self,
        (from, shown_from): (&ZStr, &[u8]),
        (to, shown_to): (&ZStr, &[u8]),
    ) -> sys::Result<SizeType> {
        let error = |errno: E, path| sys::Error::from_code(errno, Tag::copyfile).with_path(path);
        let refused = |path| move |err| error(Win32Error::from(err).to_node_e(), path);
        let mut from_buf = bun_paths::w_path_buffer_pool::get();
        let from_w =
            wide::encode(from.as_bytes(), &mut from_buf[..]).map_err(refused(shown_from))?;
        let mut to_buf = bun_paths::w_path_buffer_pool::get();
        let to_w = wide::encode(to.as_bytes(), &mut to_buf[..]).map_err(refused(shown_to))?;

        let mut mkdirp = self.mkdirp_if_not_exists;
        while let Err(err) = sys::windows::CopyFileW(from_w, to_w, false) {
            match err.to_node_e() {
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
                    return Err(error(E::ENOENT, shown_from));
                }
                E::ENOENT if core::mem::take(&mut mkdirp) => make_folder_for(to, shown_to)?,
                // https://github.com/oven-sh/bun/issues/6336
                E::EPERM => return Err(error(E::ENOENT, shown_to)),
                errno => return Err(error(errno, shown_to)),
            }
        }

        let with_path = |err: sys::Error| err.with_path(shown_to);
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
        let is_lent = matches!(self.destination, Target::Lent(_));
        let mut open_destination = |flags| {
            let mkdirp = self.mkdirp_if_not_exists;
            let file = JobFile::destination(&mut self.destination, flags, mkdirp)?;
            file.can_block().map(|can_block| (file, can_block))
        };
        let lent = is_lent.then(|| open_destination(0)).transpose()?;

        let source = JobFile::source(&mut self.source)?;
        let source_can_block = source.can_block()?;
        // A volume has no `stat`.
        let source_stat = (!source_can_block).then(|| source.stat().ok()).flatten();
        if source_stat.is_some_and(|stat| sys::S::ISDIR(stat.st_mode as _)) {
            return Err(sys::Error::from_code(E::EISDIR, Tag::read));
        }

        let (destination, destination_can_block) = match lent {
            Some(lent) => lent,
            // It may be the source, so it is cut when the copy is done.
            None if source_stat.is_some() => open_destination(0)?,
            None => open_destination(O::TRUNC)?,
        };
        let destination_stat = (source_stat.is_some() && !destination_can_block)
            .then(|| destination.stat().ok())
            .flatten();
        if destination_stat.is_some_and(|stat| sys::S::ISDIR(stat.st_mode as _)) {
            let err = sys::Error::from_code(E::EISDIR, Tag::open);
            return Err(self.destination.blame(err));
        }

        Ok(Transfer {
            reads_from_start: source.is_lent()
                && source_stat.is_some()
                && !(destination.is_lent() && destination_can_block),
            is_onto_itself: (source_stat.zip(destination_stat))
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

/// `CopyFileW` would wait for a pipe or a console on a thread of the pool.
fn suits_copy_file(path: &[u8]) -> bool {
    let Some(path) = path.strip_prefix(b"\\\\?\\") else {
        return false;
    };
    let mut parts = strings::split(path, b"\\");
    let (name, devices): (_, &[&[u8]]) = match parts.next() {
        Some(unc) if unc.eq_ignore_ascii_case(b"unc") => (parts.nth(1), &[b"pipe"]),
        name => (name, &[b"con", b"conin$", b"conout$", b"pipe"]),
    };
    !name.is_some_and(|name| strings::eql_any_case_insensitive_ascii(name, devices))
}

/// The two ends of the read/write loop.
struct Transfer {
    source: JobFile,
    source_can_block: bool,
    /// 0 if unknown.
    source_size: u64,
    /// The position of the source is neither used nor moved.
    reads_from_start: bool,
    destination: JobFile,
    destination_can_block: bool,
    /// `u64::MAX` if unknown.
    destination_size: u64,
    is_onto_itself: bool,
    max_length: SizeType,
    mode: Option<Mode>,
}

impl Transfer {
    fn run(self, blocking: Option<&Blocking>) -> sys::Result<SizeType> {
        self.run_to_end(blocking).map_err(|err| bare(&err))
    }

    fn run_to_end(&self, blocking: Option<&Blocking>) -> sys::Result<SizeType> {
        let copied = if self.is_onto_itself {
            self.source_size.min(self.max_length)
        } else {
            self.copy(blocking)?
        };
        if self.destination.is_lent() || self.destination_can_block {
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

    fn copy(&self, blocking: Option<&Blocking>) -> sys::Result<SizeType> {
        const CHUNK: SizeType = 256 * 1024;
        let limit = match self.source_size {
            0 => self.max_length,
            size => size.min(self.max_length),
        };
        let mut buf = Vec::new();
        if buf.try_reserve_exact(limit.min(CHUNK) as usize).is_err() {
            return Err(sys::Error::oom());
        }
        let source = self.source.fd();
        let blocking_read = blocking.filter(|_| self.source_can_block);
        let blocking_write = blocking.filter(|_| self.destination_can_block);
        let mut copied = 0;
        while copied < limit {
            buf.clear();
            let left = (limit - copied) as usize;
            let read = append_with(&mut buf, left, |spare| match blocking_read {
                Some(blocking) => blocking.read(source, spare),
                None if self.reads_from_start => sys::pread_buf(source, spare, copied as i64),
                None => sys::read_buf(source, spare),
            })?;
            if read == 0 {
                break;
            }
            self.destination.write_everything(&buf, blocking_write)?;
            copied += read as u64;
        }
        Ok(copied)
    }
}
