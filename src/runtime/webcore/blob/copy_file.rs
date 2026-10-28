//! blocking, but off the main thread

use crate::node::fs as node_fs;
use crate::node::types::PathLikeExt as _;
#[cfg(not(windows))]
use crate::webcore::blob::{self, MkdirpTarget, Retry, store};
use crate::webcore::blob::{MAX_SIZE, SizeType, Store};
use crate::webcore::node_types::PathOrFileDescriptor;
#[cfg(windows)]
use bun_io as aio;
#[cfg(not(windows))]
use bun_jsc::JSGlobalObject;
use bun_jsc::{self as jsc, JSPromise, JSValue};
use bun_ptr::RefPtr;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(not(windows))]
use bun_sys::Stat;
#[cfg(not(windows))]
use bun_sys::SystemError;
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self, Fd, FdExt, Mode};
#[cfg(windows)]
use bun_sys_jsc::ErrorJsc as _;
#[cfg(windows)]
use core::ffi::c_void;
#[cfg(not(windows))]
use core::marker::ConstParamTy;
#[cfg(not(windows))]
use core::sync::atomic::{AtomicBool, AtomicI32, Ordering};

// ───────────────────────────────────────────────────────────────────────────
// CopyFile (POSIX, blocking off-thread)
// ───────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub(crate) struct CopyFile {
    pub(crate) destination_file_store: store::File,
    pub(crate) source_file_store: store::File,
    // `RefPtr<Store>` is the thread-safe refcounted handle;
    // it keeps the stores — and the path slices the `File` clones borrow — alive
    // while this task is on the work pool.
    pub(crate) store: Option<RefPtr<Store>>,
    pub(crate) source_store: Option<RefPtr<Store>>,
    pub offset: SizeType,
    pub(crate) max_length: SizeType,
    pub(crate) destination_fd: Fd,
    pub(crate) source_fd: Fd,

    pub(crate) system_error: Option<SystemError>,

    pub(crate) read_len: SizeType,

    pub(crate) mkdirp_if_not_exists: bool,
    pub(crate) destination_mode: Option<Mode>,

    cancel: Cancel,
}

#[cfg(not(windows))]
impl MkdirpTarget for CopyFile {
    fn mkdirp_if_not_exists(&self) -> bool {
        self.mkdirp_if_not_exists
    }
    fn set_mkdirp_if_not_exists(&mut self, v: bool) {
        self.mkdirp_if_not_exists = v;
    }
    fn set_system_error(&mut self, e: SystemError) {
        self.system_error = Some(e);
    }
}

// SAFETY: file stores/paths and blob store refs (atomic counts); nothing thread-affine.
#[cfg(not(windows))]
unsafe impl Send for CopyFile {}

#[cfg(not(windows))]
impl jsc::JobContext for CopyFile {
    const CANCELLABLE: bool = true;
    type OffThread = Self;
    type Js = jsc::JSPromiseStrong;
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.run_async();
        Some(done)
    }
    fn then(
        mut this: Self,
        mut promise: jsc::JSPromiseStrong,
        cx: &jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        CopyFile::then(&mut this, promise.swap(), cx.global())
    }
    /// Ends the wait of a copy whose other end (a FIFO, pipe, socket or terminal) is silent: it fails with ECANCELED.
    unsafe fn cancel(this: *mut Self) {
        // SAFETY: fn contract. `Cancel::request` touches atomics, and an fd that only `Drop` closes (this thread).
        unsafe { (*this).cancel.request() }
    }
}

#[cfg(not(windows))]
impl CopyFile {
    /// Schedule the copy on the work pool; returns its promise.
    pub(crate) fn create(
        store: RefPtr<Store>,
        source_store: RefPtr<Store>,
        off: SizeType,
        max_len: SizeType,
        cx: &bun_jsc::JsThread<'_>,
        mkdirp_if_not_exists: bool,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        let copy = CopyFile {
            destination_file_store: store.data.as_file().clone(),
            source_file_store: source_store.data.as_file().clone(),
            store: Some(store),
            source_store: Some(source_store),
            offset: off,
            max_length: max_len,
            mkdirp_if_not_exists,
            destination_mode,
            // defaults:
            destination_fd: Fd::INVALID,
            source_fd: Fd::INVALID,
            system_error: None,
            read_len: 0,
            cancel: Cancel::new(),
        };
        let promise = jsc::JSPromiseStrong::init(cx.global());
        let value = promise.value();
        jsc::Job::<CopyFile>::schedule(cx, copy, promise);
        value
    }

    pub(crate) fn reject(
        &mut self,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        let mut system_error: SystemError = self.system_error.take().unwrap_or_default();
        if matches!(
            self.source_file_store.pathlike,
            PathOrFileDescriptor::Path(_)
        ) && system_error.path.is_empty()
        {
            system_error.path =
                bun_core::String::clone_utf8(self.source_file_store.pathlike.path().slice());
        }

        if system_error.message.is_empty() {
            system_error.message = bun_core::String::static_("Failed to copy file");
        }

        let instance = jsc::SystemError::from(system_error)
            .to_error_instance_with_async_stack(global_this, promise);
        if let Some(store) = self.store.take() {
            drop(store); // deref()
        }
        promise.reject(global_this, Ok(instance))
    }

    pub(crate) fn then(
        &mut self,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        drop(self.source_store.take()); // source_store.?.deref()

        if self.system_error.is_some() {
            return self.reject(promise, global_this);
        }

        promise.resolve(
            global_this,
            JSValue::js_number_from_uint64(self.read_len as u64),
        )
    }

    pub(crate) fn do_close(&mut self) {
        let close_input = !matches!(
            self.destination_file_store.pathlike,
            PathOrFileDescriptor::Fd(_)
        ) && self.destination_fd != Fd::INVALID;
        let close_output = !matches!(self.source_file_store.pathlike, PathOrFileDescriptor::Fd(_))
            && self.source_fd != Fd::INVALID;

        // Apply destination mode using fchmod before closing.
        // This ensures mode is applied even when overwriting existing files, since
        // open()'s mode argument only affects newly created files.
        // On macOS clonefile path, chmod is called separately after clonefile.
        if let Some(mode) = self.destination_mode {
            if self.destination_fd != Fd::INVALID && self.system_error.is_none() {
                match bun_sys::fchmod(self.destination_fd, mode) {
                    bun_sys::Result::Err(err) => {
                        self.system_error = Some(err.to_system_error());
                    }
                    bun_sys::Result::Ok(()) => {}
                }
            }
        }

        if close_input && close_output {
            self.do_close_file::<{ IOWhich::Both }>();
        } else if close_input {
            self.do_close_file::<{ IOWhich::Destination }>();
        } else if close_output {
            self.do_close_file::<{ IOWhich::Source }>();
        }
    }

    pub(crate) fn do_close_file<const WHICH: IOWhich>(&mut self) {
        match WHICH {
            IOWhich::Both => {
                self.destination_fd.close();
                self.source_fd.close();
            }
            IOWhich::Destination => {
                self.destination_fd.close();
            }
            IOWhich::Source => {
                self.source_fd.close();
            }
        }
    }

    /// Opens the source path. `Ok(true)`: the fd is non-blocking.
    fn open_source(&mut self, path_buf: &mut bun_core::PathBuffer) -> Result<bool, crate::Error> {
        let path = self.source_file_store.pathlike.path().slice_z(path_buf);
        let mut nonblocking = true;
        let opened = match bun_sys::open(path, OPEN_SOURCE_FLAGS, 0) {
            // A lease on the file (`F_SETLEASE`) fails a non-blocking open. A blocking one waits for the holder.
            bun_sys::Result::Err(errno) if errno.get_errno() == bun_sys::E::EAGAIN => {
                nonblocking = false;
                bun_sys::open(path, OPEN_SOURCE_FLAGS & !bun_sys::O::NONBLOCK, 0)
            }
            opened => opened,
        };
        self.source_fd = match opened {
            bun_sys::Result::Ok(result) => {
                match result.make_lib_uv_owned_for_syscall(
                    bun_sys::Tag::open,
                    bun_sys::ErrorCase::CloseOnFail,
                ) {
                    bun_sys::Result::Ok(result_fd) => result_fd,
                    bun_sys::Result::Err(errno) => {
                        self.system_error = Some(errno.to_system_error());
                        return Err(bun_errno::from_errno(errno.errno as i32).into());
                    }
                }
            }
            bun_sys::Result::Err(errno) => {
                self.system_error = Some(errno.to_system_error());
                return Err(bun_errno::from_errno(errno.errno as i32).into());
            }
        };
        Ok(nonblocking)
    }

    /// Opens the destination path. `Ok(true)`: the fd is non-blocking.
    fn open_destination(
        &mut self,
        path_buf: &mut bun_core::PathBuffer,
    ) -> Result<bool, crate::Error> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let (mut flags, mut retry_ms) = (OPEN_DESTINATION_FLAGS, 1i32);
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let flags = OPEN_DESTINATION_FLAGS;
        loop {
            // `slice_z` would tie `dest` to `self`: copy the path into `path_buf` and borrow that.
            let dest_len = {
                let s = self.destination_file_store.pathlike.path().slice();
                let n = s.len().min(path_buf.len() - 1);
                path_buf[..n].copy_from_slice(&s[..n]);
                path_buf[n] = 0;
                n
            };
            // SAFETY: path_buf[dest_len] == 0 written above.
            let dest: &bun_core::ZStr = bun_core::ZStr::from_buf(&path_buf[..], dest_len);
            let mode = self.destination_mode.unwrap_or(node_fs::DEFAULT_PERMISSION);
            match bun_sys::open(dest, flags, mode) {
                bun_sys::Result::Ok(result) => {
                    match result.make_lib_uv_owned_for_syscall(
                        bun_sys::Tag::open,
                        bun_sys::ErrorCase::CloseOnFail,
                    ) {
                        bun_sys::Result::Ok(result_fd) => self.destination_fd = result_fd,
                        bun_sys::Result::Err(errno) => {
                            self.system_error = Some(errno.to_system_error());
                            return Err(bun_errno::from_errno(errno.errno as i32).into());
                        }
                    }
                    return Ok(flags & bun_sys::O::NONBLOCK != 0);
                }
                bun_sys::Result::Err(errno) => {
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    match errno.get_errno() {
                        // As in `open_source`.
                        bun_sys::E::EAGAIN if flags & bun_sys::O::NONBLOCK != 0 => {
                            flags &= !bun_sys::O::NONBLOCK;
                            continue;
                        }
                        // A FIFO with no reader yet. No event reports a reader's open: repeat until it works or a cancel.
                        bun_sys::E::ENXIO
                            if bun_sys::stat(dest)
                                .is_ok_and(|stat| bun_sys::S::ISFIFO(stat.st_mode as _)) =>
                        {
                            if let bun_sys::Result::Err(err) =
                                self.cancel.wait(None, Some(retry_ms), bun_sys::Tag::open)
                            {
                                self.system_error =
                                    Some(err.with_path(dest.as_bytes()).to_system_error());
                                return Err(bun_errno::from_errno(err.errno as i32).into());
                            }
                            retry_ms = (retry_ms * 2).min(FIFO_READER_RETRY_MS);
                            continue;
                        }
                        _ => {}
                    }

                    match blob::mkdir_if_not_exists(self, &errno, dest, dest.as_bytes()) {
                        Retry::Continue => continue,
                        Retry::Fail => {
                            return Err(bun_errno::from_errno(errno.errno as i32).into());
                        }
                        Retry::No => {}
                    }

                    self.system_error = Some(
                        errno
                            .with_path(self.destination_file_store.pathlike.path().slice())
                            .to_system_error(),
                    );
                    return Err(bun_errno::from_errno(errno.errno as i32).into());
                }
            }
        }
    }

    /// Copies the rest of the file with a read/write loop when
    /// `copy_file_range`/`sendfile`/`splice` is unavailable or unusable,
    /// recording a failure in `system_error` the same way the syscall paths do.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn fallback_read_write(
        &mut self,
        src: End,
        mut dst: End,
        remain: usize,
        unknown_size: bool,
        total_written: &mut u64,
    ) -> Result<(), crate::Error> {
        let bun_opened_dest = matches!(
            self.destination_file_store.pathlike,
            PathOrFileDescriptor::Path(_)
        );
        let cap = if unknown_size {
            MAX_SIZE
        } else {
            remain as SizeType
        };
        // The copy began as one between two regular files, and the syscall for that refused it.
        dst.learn_peer();
        let copied = if waits_for_peer(src, dst) {
            copy_with_waits(&self.cancel, src, dst, cap, total_written)
        } else {
            read_write_fallback(src.fd, dst.fd, bun_opened_dest, cap, total_written)
        };
        self.recorded(copied)
    }

    /// Records a failure the way the copy loops record one.
    fn recorded<T>(&mut self, result: bun_sys::Result<T>) -> Result<T, crate::Error> {
        result.map_err(|err| {
            self.system_error = Some(err.to_system_error());
            bun_errno::from_errno(err.errno as i32).into()
        })
    }

    /// For a source that a read waits in (a socket, a terminal): sendfile() refuses the first and sleeps in the second.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn do_read_write(&mut self, src: End, dst: End) -> Result<(), crate::Error> {
        let remain: usize = self.max_length as usize;
        let unknown_size = remain == MAX_SIZE as usize || remain == 0;
        let mut total_written: u64 = 0;
        let result = self.fallback_read_write(src, dst, remain, unknown_size, &mut total_written);
        self.read_len = total_written as SizeType;
        result
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn do_copy_file_range(
        &mut self,
        mut with: TryWith,
        source_mode: Mode,
        src: End,
        mut dst: End,
    ) -> Result<(), crate::Error> {
        use bun_sys::linux;
        use bun_sys::posix::{POLL_IN, POLL_OUT};

        let mut remain: usize = self.max_length as usize;
        let unknown_size = remain == MAX_SIZE as usize || remain == 0;
        if unknown_size {
            // fstat on a FIFO / char device / socket legitimately reports
            // st_size == 0. In that case `remain` is only the per-call chunk
            // size; the loop below keeps going until the kernel reports EOF
            // (written == 0). 64 KiB matches the read/write-loop fallback.
            remain = 64 * 1024;
        }

        let mut total_written: u64 = 0;
        let src_fd = self.source_fd;
        let dest_fd = self.destination_fd;

        let read_len_slot: *mut SizeType = &raw mut self.read_len;
        let total_written_slot: *const u64 = core::ptr::addr_of!(total_written);
        scopeguard::defer! {
            // SAFETY: both raw ptrs point into the enclosing stack frame which
            // outlives this guard (dropped before fn return); disjoint fields.
            unsafe { *read_len_slot = *total_written_slot as SizeType };
        }

        // sendfile() and splice() say ENOSYS themselves where they are missing.
        if with == TryWith::CopyFileRange && !bun_sys::copy_file::can_use_copy_file_range_syscall()
        {
            return self.fallback_read_write(src, dst, remain, unknown_size, &mut total_written);
        }

        // A FIFO with no writer yet reads as an end of file. Only a wait tells that from a writer that left.
        if with == TryWith::Splice && src.peer == Peer::Fifo && src.nonblocking {
            self.recorded(self.cancel.wait_until_ready(src_fd, POLL_IN, with.tag()))?;
        }

        // The end that an EAGAIN waits for. The wait ends at once if it was the other end: the next EAGAIN in a row swaps.
        let mut wait_for_source = src.peer == Peer::Fifo;
        let mut stalled = false;

        loop {
            // An end that waits for a peer: no call may sleep in it. The copy sleeps in `Cancel::wait`.
            let waits = waits_for_peer(src, dst);
            if waits {
                // A copy between two ends that always have bytes and room never waits.
                self.recorded(self.cancel.check(with.tag()))?;
            }
            // splice() keeps its flag for a pipe. It sleeps in a socket or a terminal that has nothing to read: ask first.
            if with == TryWith::Splice && matches!(src.peer, Peer::Socket | Peer::Terminal) {
                self.recorded(self.cancel.wait_until_ready(src_fd, POLL_IN, with.tag()))?;
            }
            let written: isize = match with {
                TryWith::CopyFileRange => {
                    // SAFETY: raw copy_file_range(2); both fds owned by caller, null offsets.
                    unsafe {
                        linux::copy_file_range(
                            src_fd.native(),
                            core::ptr::null_mut(),
                            dest_fd.native(),
                            core::ptr::null_mut(),
                            remain,
                            0,
                        )
                    }
                }
                TryWith::Sendfile => {
                    // SAFETY: raw sendfile(2); both fds owned by caller, null offset.
                    unsafe {
                        linux::sendfile(
                            dest_fd.native(),
                            src_fd.native(),
                            core::ptr::null_mut(),
                            remain,
                        )
                    }
                }
                TryWith::Splice => {
                    // SAFETY: raw splice(2); both fds owned by caller, null offsets.
                    unsafe {
                        libc::splice(
                            src_fd.native(),
                            core::ptr::null_mut(),
                            dest_fd.native(),
                            core::ptr::null_mut(),
                            remain,
                            // One end is a pipe: with the flag, the call does not sleep in it.
                            libc::SPLICE_F_NONBLOCK,
                        )
                    }
                }
            };

            match bun_sys::get_errno(written) {
                bun_sys::E::SUCCESS => {}

                // The source is empty, or the destination is full.
                bun_sys::E::EAGAIN if waits => {
                    if stalled && src.peer.waits() && dst.peer.waits() {
                        wait_for_source = !wait_for_source;
                    }
                    stalled = true;
                    let (fd, events) = if wait_for_source {
                        (src_fd, POLL_IN)
                    } else {
                        (dest_fd, POLL_OUT)
                    };
                    self.recorded(self.cancel.wait_until_ready(fd, events, with.tag()))?;
                    continue;
                }

                // XDEV: cross-device copy not supported
                // NOSYS: syscall not available
                // OPNOTSUPP: filesystem doesn't support this operation
                bun_sys::E::ENOSYS | bun_sys::E::EXDEV | bun_sys::E::ENOTSUP => {
                    return self.fallback_read_write(
                        src,
                        dst,
                        remain,
                        unknown_size,
                        &mut total_written,
                    );
                }

                // EINVAL: eCryptfs and other filesystems may not support copy_file_range.
                // Also returned when the file descriptor is incompatible with the syscall.
                bun_sys::E::EINVAL => {
                    // If the Linux machine doesn't support
                    // copy_file_range or the file descriptor is
                    // incompatible with the chosen syscall, fall back
                    // to a read/write loop
                    if total_written == 0 {
                        // copy_file_range() refuses a destination that is not a regular file: another call may copy into it.
                        if dst.peer == Peer::Unknown {
                            let destination_mode = dst.learn_peer();
                            match Self::plan(source_mode, src.peer, destination_mode, dst.peer) {
                                Some(Plan::Syscall(other)) if other != with => {
                                    with = other;
                                    continue;
                                }
                                _ => {}
                            }
                        }
                        return self.fallback_read_write(
                            src,
                            dst,
                            remain,
                            unknown_size,
                            &mut total_written,
                        );
                    }

                    self.system_error = Some(
                        bun_sys::Error {
                            // bare `as` is lossless here (E repr == Error.Int).
                            errno: bun_sys::E::EINVAL as bun_sys::ErrorInt,
                            syscall: with.tag(),
                            ..Default::default()
                        }
                        .to_system_error(),
                    );
                    return Err(bun_errno::from_errno(bun_sys::E::EINVAL as i32).into());
                }
                errno => {
                    self.system_error = Some(
                        bun_sys::Error {
                            // bare `as` is lossless here (E repr == Error.Int).
                            errno: errno as bun_sys::ErrorInt,
                            syscall: with.tag(),
                            ..Default::default()
                        }
                        .to_system_error(),
                    );
                    return Err(bun_errno::from_errno(errno as i32).into());
                }
            }

            stalled = false;
            // wrote zero bytes means EOF
            total_written += u64::try_from(written).expect("int cast");
            if written == 0 {
                break;
            }
            if !unknown_size {
                remain = remain.saturating_sub(usize::try_from(written).expect("int cast"));
                if remain == 0 {
                    break;
                }
            }
        }
        Ok(())
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    fn do_read_write_loop_capped(
        &mut self,
        src: End,
        dst: End,
        cap: SizeType,
    ) -> Result<(), crate::Error> {
        let mut total: u64 = 0;
        let copied = if waits_for_peer(src, dst) {
            copy_with_waits(&self.cancel, src, dst, cap, &mut total)
        } else {
            read_write_loop_capped(src.fd, dst.fd, cap, &mut total)
        };
        self.read_len = total as SizeType;
        self.recorded(copied)
    }

    /// Returns the number of bytes copied.
    #[cfg(target_os = "macos")]
    pub(crate) fn do_fcopy_file_with_read_write_loop_fallback(
        &mut self,
        source_size: u64,
    ) -> Result<u64, crate::Error> {
        match bun_sys::fcopyfile(
            self.source_fd,
            self.destination_fd,
            bun_sys::darwin::COPYFILE {
                data: true,
                ..Default::default()
            }
            .bits(),
        ) {
            bun_sys::Result::Err(errno) => {
                match errno.get_errno() {
                    // If the file type doesn't support seeking, it may return EBADF
                    // Example case:
                    //
                    // bun test bun-write.test | xargs echo
                    //
                    bun_sys::E::EBADF => {
                        let mut total_written: u64 = 0;

                        // TODO: this should use non-blocking I/O.
                        match node_fs::NodeFS::copy_file_using_read_write_loop(
                            bun_core::ZStr::EMPTY,
                            bun_core::ZStr::EMPTY,
                            self.source_fd,
                            self.destination_fd,
                            0,
                            &mut total_written,
                        ) {
                            bun_sys::Result::Err(err) => {
                                self.system_error = Some(err.to_system_error());
                                Err(bun_errno::from_errno(err.errno as i32).into())
                            }
                            bun_sys::Result::Ok(()) => Ok(total_written),
                        }
                    }
                    _ => {
                        self.system_error = Some(errno.to_system_error());
                        Err(bun_errno::from_errno(errno.errno as i32).into())
                    }
                }
            }
            bun_sys::Result::Ok(()) => Ok(source_size),
        }
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn do_clonefile(&mut self) -> Result<(), crate::Error> {
        let mut source_buf = bun_paths::path_buffer_pool::get();
        let mut dest_buf = bun_paths::path_buffer_pool::get();

        loop {
            // reshaped for borrowck — `slice_z(&'a self, &'a mut buf)`
            // ties the returned `&ZStr` to `self`, which would conflict with
            // the `&mut self` borrow `mkdir_if_not_exists` needs below. The
            // bytes live in `dest_buf`, so capture the length and re-borrow
            // from the buffer (not `self`) after dropping the first borrow.
            let dest_len = self
                .destination_file_store
                .pathlike
                .path()
                .slice_z(&mut dest_buf)
                .len();
            // SAFETY: `slice_z` wrote `dest_len` bytes + NUL into `dest_buf`.
            let dest = bun_core::ZStr::from_buf(&dest_buf[..], dest_len);
            match bun_sys::clonefile(
                self.source_file_store
                    .pathlike
                    .path()
                    .slice_z(&mut source_buf),
                dest,
            ) {
                bun_sys::Result::Err(errno) => {
                    let err_path = self.destination_file_store.pathlike.path().slice().to_vec();
                    match blob::mkdir_if_not_exists(self, &errno, dest, &err_path) {
                        Retry::Continue => continue,
                        Retry::Fail => {}
                        Retry::No => {}
                    }
                    self.system_error = Some(errno.to_system_error());
                    return Err(bun_errno::from_errno(errno.errno as i32).into());
                }
                bun_sys::Result::Ok(()) => {}
            }
            break;
        }
        Ok(())
    }

    /// The call that copies between ends of these kinds. `None`: no call does.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn plan(
        source_mode: Mode,
        source: Peer,
        destination_mode: Mode,
        destination: Peer,
    ) -> Option<Plan> {
        // Bun.write(Bun.file("a"), Bun.file("b"))
        if bun_sys::S::ISREG(source_mode)
            && (bun_sys::S::ISREG(destination_mode) || destination_mode == 0)
        {
            return Some(Plan::Syscall(TryWith::CopyFileRange));
        }
        // $ bun run foo.js | bun run bar.js
        if bun_sys::S::ISFIFO(source_mode) && bun_sys::S::ISFIFO(destination_mode) {
            return Some(Plan::Syscall(TryWith::Splice));
        }
        if bun_sys::S::ISREG(source_mode)
            || bun_sys::S::ISCHR(source_mode)
            || bun_sys::S::ISSOCK(source_mode)
        {
            return Some(if bun_sys::S::ISFIFO(destination_mode) {
                // sendfile() into a pipe is this splice(), without the flag that keeps it from a sleep in the pipe.
                Plan::Syscall(TryWith::Splice)
            } else if source.waits() || destination.waits() {
                // sendfile() has no such flag: nothing ends its sleep in a socket or a terminal.
                Plan::ReadWrite
            } else {
                Plan::Syscall(TryWith::Sendfile)
            });
        }
        None
    }

    pub(crate) fn run_async(&mut self) {
        #[cfg(target_os = "macos")]
        let mut stat_: Option<Stat> = None;
        #[cfg(not(target_os = "macos"))]
        let stat_: Option<Stat> = None;

        if let PathOrFileDescriptor::Fd(fd) = &self.destination_file_store.pathlike {
            self.destination_fd = *fd;
        }

        if let PathOrFileDescriptor::Fd(fd) = &self.source_file_store.pathlike {
            self.source_fd = *fd;
        }

        let opens_source = self.source_fd == Fd::INVALID;
        let opens_destination = self.destination_fd == Fd::INVALID;

        // Do we need to open both files?
        if opens_source && opens_destination {
            // First, we attempt to clonefile() on macOS
            // This is the fastest way to copy a file.
            #[cfg(target_os = "macos")]
            {
                if self.offset == 0
                    && matches!(
                        self.source_file_store.pathlike,
                        PathOrFileDescriptor::Path(_)
                    )
                    && matches!(
                        self.destination_file_store.pathlike,
                        PathOrFileDescriptor::Path(_)
                    )
                {
                    'do_clonefile: {
                        let mut path_buf = bun_paths::path_buffer_pool::get();

                        // stat the output file, make sure it:
                        // 1. Exists
                        match bun_sys::stat(
                            self.source_file_store
                                .pathlike
                                .path()
                                .slice_z(&mut path_buf),
                        ) {
                            bun_sys::Result::Ok(result) => {
                                stat_ = Some(result);

                                if bun_sys::S::ISDIR(result.st_mode as u32) {
                                    self.system_error = Some(unsupported_directory_error());
                                    return;
                                }

                                if !bun_sys::S::ISREG(result.st_mode as u32) {
                                    break 'do_clonefile;
                                }
                            }
                            bun_sys::Result::Err(err) => {
                                // If we can't stat it, we also can't copy it.
                                self.system_error = Some(err.to_system_error());
                                return;
                            }
                        }

                        match self.do_clonefile() {
                            Ok(()) => {
                                let stat_size = stat_.unwrap().st_size;
                                if self.max_length != MAX_SIZE
                                    && self.max_length
                                        < SizeType::try_from(stat_size).expect("int cast")
                                {
                                    // If this fails...well, there's not much we can do about it.
                                    // SAFETY: NUL-terminated path in path_buf; libc truncate(2).
                                    let _ = unsafe {
                                        bun_sys::c::truncate(
                                            self.destination_file_store
                                                .pathlike
                                                .path()
                                                .slice_z(&mut path_buf)
                                                .as_ptr(),
                                            i64::try_from(self.max_length).expect("int cast"),
                                        )
                                    };
                                    self.read_len =
                                        SizeType::try_from(self.max_length).expect("int cast");
                                } else {
                                    self.read_len =
                                        SizeType::try_from(stat_size).expect("int cast");
                                }
                                // Apply destination mode if specified (clonefile copies source permissions)
                                if let Some(mode) = self.destination_mode {
                                    match bun_sys::chmod(
                                        self.destination_file_store
                                            .pathlike
                                            .path()
                                            .slice_z(&mut path_buf),
                                        mode,
                                    ) {
                                        bun_sys::Result::Err(err) => {
                                            self.system_error = Some(err.to_system_error());
                                            return;
                                        }
                                        bun_sys::Result::Ok(()) => {}
                                    }
                                }
                                return;
                            }
                            Err(_) => {
                                // this may still fail, in which case we just continue trying with fcopyfile
                                // it can fail when the input file already exists
                                // or if the output is not a directory
                                // or if it's a network volume
                                self.system_error = None;
                            }
                        }
                    }
                }
            }
        }

        let mut path_buf = bun_paths::path_buffer_pool::get();
        // The source first: a copy that its kind rules out must not create, truncate or wait for the destination.
        let source_nonblocking = if opens_source {
            match self.open_source(&mut path_buf) {
                Ok(nonblocking) => nonblocking,
                Err(_) => return,
            }
        } else {
            false
        };

        let stat: Stat = match stat_ {
            Some(s) => s,
            None => match bun_sys::fstat(self.source_fd) {
                bun_sys::Result::Ok(result) => result,
                bun_sys::Result::Err(err) => {
                    self.do_close();
                    self.system_error = Some(err.to_system_error());
                    return;
                }
            },
        };

        if bun_sys::S::ISDIR(stat.st_mode as _) {
            self.system_error = Some(unsupported_directory_error());
            self.do_close();
            return;
        }

        let mut src = End {
            fd: self.source_fd,
            peer: Peer::of(
                stat.st_mode as _,
                self.source_fd,
                self.source_file_store.is_atty,
            ),
            nonblocking: source_nonblocking,
        };
        src.keep_nonblocking_for(stat.st_mode as _);

        // The destination is not open yet: this says whether there is a call at all. Which one, once it is.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let Some(mut plan) = Self::plan(
            stat.st_mode as _,
            src.peer,
            self.destination_file_store.mode,
            Peer::Unknown,
        ) else {
            self.system_error = Some(unsupported_non_regular_file_error());
            self.do_close();
            return;
        };

        let destination_nonblocking = if opens_destination {
            match self.open_destination(&mut path_buf) {
                Ok(nonblocking) => nonblocking,
                Err(_) => {
                    self.do_close();
                    return;
                }
            }
        } else {
            false
        };
        drop(path_buf);

        debug_assert!(self.destination_fd.is_valid());
        debug_assert!(self.source_fd.is_valid());

        let mut dst = End {
            fd: self.destination_fd,
            peer: Peer::of(
                self.destination_file_store.mode,
                self.destination_fd,
                self.destination_file_store.is_atty,
            ),
            nonblocking: destination_nonblocking,
        };
        dst.keep_nonblocking_for(self.destination_file_store.mode);
        // Only copy_file_range() says by itself that the destination is not a regular file.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if !matches!(plan, Plan::Syscall(TryWith::CopyFileRange)) {
            let destination_mode = match dst.learn_peer() {
                0 => self.destination_file_store.mode,
                learned => learned,
            };
            plan =
                Self::plan(stat.st_mode as _, src.peer, destination_mode, dst.peer).unwrap_or(plan);
        }
        // No call here refuses a destination of another kind: ask about an fd that nothing has `stat`ed.
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        if !opens_destination {
            dst.learn_peer();
        }

        // BSD fstat on a pipe reports bytes currently buffered in st_size;
        // only a regular-file st_size is a length.
        if stat.st_size != 0 && bun_sys::S::ISREG(stat.st_mode as _) {
            self.max_length = (SizeType::try_from(stat.st_size)
                .expect("int cast")
                .min(self.max_length))
            .max(self.offset)
                - self.offset;
            if self.max_length == 0 {
                self.do_close();
                return;
            }

            if PREALLOCATE_SUPPORTED
                && matches!(
                    self.destination_file_store.pathlike,
                    PathOrFileDescriptor::Path(_)
                )
                && self.max_length > PREALLOCATE_LENGTH
                && self.max_length != MAX_SIZE
            {
                let _ = bun_sys::preallocate_file(
                    self.destination_fd.native(),
                    0,
                    self.max_length as i64,
                );
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let _ = match plan {
                Plan::Syscall(with) => self.do_copy_file_range(with, stat.st_mode as _, src, dst),
                Plan::ReadWrite => self.do_read_write(src, dst),
            };

            self.do_close();
            return;
        }

        #[cfg(target_os = "macos")]
        {
            // fcopyfile rewrites dest from offset 0 and the slice trim is
            // ftruncate; both are only safe for a dest Bun opened O_TRUNC.
            // It takes regular files only: an end that waits for a peer has the loop below.
            if matches!(
                self.destination_file_store.pathlike,
                PathOrFileDescriptor::Path(_)
            ) && !waits_for_peer(src, dst)
            {
                let copied = match self.do_fcopy_file_with_read_write_loop_fallback(
                    u64::try_from(stat.st_size).expect("int cast"),
                ) {
                    Ok(copied) => copied,
                    Err(_) => {
                        self.do_close();
                        return;
                    }
                };
                if stat.st_size != 0
                    && SizeType::try_from(stat.st_size).expect("int cast") > self.max_length
                {
                    let _ = bun_sys::ftruncate(
                        self.destination_fd,
                        i64::try_from(self.max_length).expect("int cast"),
                    );
                    self.read_len = copied.min(self.max_length as u64) as SizeType;
                } else {
                    self.read_len = copied as SizeType;
                }
            } else if self
                .do_read_write_loop_capped(src, dst, self.max_length)
                .is_err()
            {
                self.do_close();
                return;
            }

            self.do_close();
            return;
        }

        #[cfg(target_os = "freebsd")]
        {
            if matches!(
                self.destination_file_store.pathlike,
                PathOrFileDescriptor::Path(_)
            ) && !waits_for_peer(src, dst)
            {
                let mut total_written: u64 = 0;
                match node_fs::NodeFS::copy_file_using_read_write_loop(
                    bun_core::ZStr::EMPTY,
                    bun_core::ZStr::EMPTY,
                    self.source_fd,
                    self.destination_fd,
                    0,
                    &mut total_written,
                ) {
                    bun_sys::Result::Err(err) => {
                        self.system_error = Some(err.to_system_error());
                        self.do_close();
                        return;
                    }
                    bun_sys::Result::Ok(()) => {}
                }
                if stat.st_size != 0
                    && SizeType::try_from(stat.st_size).expect("int cast") > self.max_length
                {
                    let _ = bun_sys::ftruncate(
                        self.destination_fd,
                        i64::try_from(self.max_length).expect("int cast"),
                    );
                    self.read_len = total_written.min(self.max_length as u64) as SizeType;
                } else {
                    self.read_len = total_written as SizeType;
                }
            } else if self
                .do_read_write_loop_capped(src, dst, self.max_length)
                .is_err()
            {
                self.do_close();
                return;
            }
            self.do_close();
            return;
        }

        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        )))]
        {
            compile_error!("TODO: implement copyfile");
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn read_write_fallback(
    src_fd: Fd,
    dest_fd: Fd,
    bun_opened_dest: bool,
    cap: SizeType,
    total: &mut u64,
) -> bun_sys::Result<()> {
    if bun_opened_dest {
        let stat_size = if cap == MAX_SIZE { 0 } else { cap as usize };
        node_fs::NodeFS::copy_file_using_read_write_loop(
            bun_core::ZStr::EMPTY,
            bun_core::ZStr::EMPTY,
            src_fd,
            dest_fd,
            stat_size,
            total,
        )?;
        let _ = bun_sys::ftruncate(dest_fd, i64::try_from(*total).expect("int cast"));
        Ok(())
    } else {
        read_write_loop_capped(src_fd, dest_fd, cap, total)
    }
}

#[inline(never)] // 64 KB stack buffer
#[cfg(not(windows))]
fn read_write_loop_capped(
    src_fd: Fd,
    dest_fd: Fd,
    cap: SizeType,
    total: &mut u64,
) -> bun_sys::Result<()> {
    let mut stack_buf = bun_core::vec::UninitBuf::<{ 64 * 1024 }>::uninit();
    // SAFETY: `read` is the only writer of `buf`; each iteration reads back only `buf[..amt]`.
    let buf = unsafe { stack_buf.as_bytes_mut() };
    let mut remaining = cap;
    while remaining > 0 {
        let want = (buf.len() as SizeType).min(remaining) as usize;
        let amt = bun_sys::read(src_fd, &mut buf[..want])?;
        if amt == 0 {
            break;
        }
        remaining -= amt as SizeType;
        let mut slice = &buf[..amt];
        while !slice.is_empty() {
            match bun_sys::write(dest_fd, slice)? {
                0 => return Ok(()),
                n => {
                    *total += n as u64;
                    slice = &slice[n..];
                }
            }
        }
    }
    Ok(())
}

/// What a read or a write of one end of the copy waits for.
#[cfg(not(windows))]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Peer {
    /// Nothing: a regular file, or a device that answers at once (`/dev/null`).
    None,
    Fifo,
    Socket,
    Terminal,
    /// A destination that nothing has `stat`ed (a path, most often). A regular file, until a call refuses it.
    Unknown,
}

#[cfg(not(windows))]
impl Peer {
    fn of(mode: Mode, fd: Fd, is_atty: Option<bool>) -> Peer {
        if mode == 0 {
            Peer::Unknown
        } else if bun_sys::S::ISFIFO(mode) {
            Peer::Fifo
        } else if bun_sys::S::ISSOCK(mode) {
            Peer::Socket
        } else if bun_sys::S::ISCHR(mode) && is_atty.unwrap_or_else(|| bun_sys::isatty(fd)) {
            Peer::Terminal
        } else {
            Peer::None
        }
    }

    fn waits(self) -> bool {
        !matches!(self, Peer::None | Peer::Unknown)
    }
}

/// One end of the copy.
#[cfg(not(windows))]
#[derive(Clone, Copy)]
pub(crate) struct End {
    fd: Fd,
    peer: Peer,
    /// Bun opened the fd with O_NONBLOCK, so no read or write of it sleeps. An fd from the caller keeps its flags.
    nonblocking: bool,
}

#[cfg(not(windows))]
impl End {
    /// O_NONBLOCK stays on a regular file, which ignores it, and on an end that the copy waits for. Not on a device.
    fn keep_nonblocking_for(&mut self, mode: Mode) {
        if self.nonblocking && mode != 0 && !bun_sys::S::ISREG(mode) && !self.peer.waits() {
            let _ = bun_sys::update_nonblocking(self.fd, false);
            self.nonblocking = false;
        }
    }

    /// `fstat`s a destination of `Peer::Unknown`. Returns its mode, or 0 if there was nothing to learn.
    fn learn_peer(&mut self) -> Mode {
        if self.peer != Peer::Unknown {
            return 0;
        }
        let bun_sys::Result::Ok(stat) = bun_sys::fstat(self.fd) else {
            return 0;
        };
        self.peer = Peer::of(stat.st_mode as _, self.fd, None);
        self.keep_nonblocking_for(stat.st_mode as _);
        stat.st_mode as _
    }
}

/// Whether a read or a write of one of the two waits for a peer. `copy_with_waits` copies between such ends.
#[cfg(not(windows))]
fn waits_for_peer(src: End, dst: End) -> bool {
    src.peer.waits() || dst.peer.waits()
}

/// `JobContext::cancel` for a copy that waits: a flag, and an fd in every poll that the pool thread sleeps in.
#[cfg(not(windows))]
struct Cancel {
    requested: AtomicBool,
    /// -1 until the first wait.
    wake: AtomicI32,
    /// macOS has no eventfd: the write end of a pipe, and `wake` is its read end.
    #[cfg(target_os = "macos")]
    wake_writer: AtomicI32,
}

#[cfg(not(windows))]
impl Cancel {
    /// Without a wake fd (the process is out of descriptors) a wait comes back this often to read the flag.
    const TICK_MS: i32 = 50;

    const fn new() -> Self {
        Self {
            requested: AtomicBool::new(false),
            wake: AtomicI32::new(-1),
            #[cfg(target_os = "macos")]
            wake_writer: AtomicI32::new(-1),
        }
    }

    /// JS thread.
    fn request(&self) {
        self.requested.store(true, Ordering::SeqCst);
        #[cfg(target_os = "macos")]
        let fd = self.wake_writer.load(Ordering::SeqCst);
        #[cfg(not(target_os = "macos"))]
        let fd = self.wake.load(Ordering::SeqCst);
        if fd >= 0 {
            // An eventfd takes 8 bytes. A failed write means that the fd is readable already.
            let _ = bun_sys::write(Fd::from_native(fd), &1u64.to_ne_bytes());
        }
    }

    fn check(&self, tag: bun_sys::Tag) -> bun_sys::Result<()> {
        if self.requested.load(Ordering::SeqCst) {
            return Err(bun_sys::Error::from_code(bun_sys::E::ECANCELED, tag));
        }
        Ok(())
    }

    /// Pool thread. `None`: the process is out of descriptors.
    fn wake_fd(&self) -> Option<Fd> {
        let fd = self.wake.load(Ordering::SeqCst);
        if fd >= 0 {
            return Some(Fd::from_native(fd));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let fd = bun_sys::eventfd(0, bun_sys::O::CLOEXEC).ok()?;
            self.wake.store(fd.native(), Ordering::SeqCst);
            Some(fd)
        }
        #[cfg(target_os = "macos")]
        {
            let [reader, writer] = bun_sys::pipe().ok()?.map(bun_sys::move_above_stdio);
            for fd in [reader, writer] {
                let _ = bun_sys::set_close_on_exec(fd);
                let _ = bun_sys::set_nonblocking(fd);
            }
            self.wake.store(reader.native(), Ordering::SeqCst);
            self.wake_writer.store(writer.native(), Ordering::SeqCst);
            Some(reader)
        }
    }

    /// Pool thread. `Ok(false)`: `timeout_ms` passed (`None`: no limit). `Err`: ECANCELED after `request`, or a failed poll.
    fn wait(
        &self,
        fd: Option<(Fd, i16)>,
        timeout_ms: Option<i32>,
        syscall: bun_sys::Tag,
    ) -> bun_sys::Result<bool> {
        self.check(syscall)?;
        let wake = self.wake_fd();
        // `request` found no fd to write to if it ran between the check and the store of the fd.
        self.check(syscall)?;
        let timeout_ms = match (wake, timeout_ms) {
            (Some(_), None) => -1,
            (Some(_), Some(ms)) => ms,
            (None, None) => Self::TICK_MS,
            (None, Some(ms)) => ms.min(Self::TICK_MS),
        };
        let waited = bun_sys::wait_for_io(fd, wake, timeout_ms)?;
        self.check(syscall)?;
        Ok(waited.ready)
    }

    fn wait_until_ready(&self, fd: Fd, events: i16, syscall: bun_sys::Tag) -> bun_sys::Result<()> {
        while !self.wait(Some((fd, events)), None, syscall)? {}
        Ok(())
    }
}

#[cfg(not(windows))]
impl Drop for Cancel {
    /// JS thread, after the job left the VM's list: `request` does not run again.
    fn drop(&mut self) {
        let fd = *self.wake.get_mut();
        if fd >= 0 {
            Fd::from_native(fd).close();
        }
        #[cfg(target_os = "macos")]
        {
            let fd = *self.wake_writer.get_mut();
            if fd >= 0 {
                Fd::from_native(fd).close();
            }
        }
    }
}

/// One write that does not sleep while the destination has no room. `None`: it has none.
#[cfg(not(windows))]
fn write_now(cancel: &Cancel, dst: End, bytes: &[u8]) -> bun_sys::Result<Option<usize>> {
    // Without O_NONBLOCK a write sleeps until every byte is in. On Linux a pipe with room takes PIPE_BUF bytes at once.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let bytes = if matches!(dst.peer, Peer::Fifo | Peer::Terminal) && !dst.nonblocking {
        cancel.wait_until_ready(dst.fd, bun_sys::posix::POLL_OUT, bun_sys::Tag::write)?;
        if dst.peer == Peer::Fifo {
            &bytes[..bytes.len().min(libc::PIPE_BUF)]
        } else {
            bytes
        }
    } else {
        bytes
    };
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    let _ = cancel;
    let wrote = if dst.peer == Peer::Socket {
        bun_sys::send_non_block(dst.fd, bytes)
    } else {
        bun_sys::write(dst.fd, bytes)
    };
    match wrote {
        Ok(wrote) => Ok(Some(wrote)),
        Err(err) if err.get_errno() == bun_sys::E::EAGAIN => Ok(None),
        Err(err) => Err(err),
    }
}

/// The read/write loop for a copy with an end that waits for a peer. It sleeps only in `Cancel::wait`.
#[inline(never)] // 64 KB stack buffer
#[cfg(not(windows))]
fn copy_with_waits(
    cancel: &Cancel,
    src: End,
    dst: End,
    cap: SizeType,
    total: &mut u64,
) -> bun_sys::Result<()> {
    use bun_sys::posix::{POLL_IN, POLL_OUT};
    let mut stack_buf = bun_core::vec::UninitBuf::<{ 64 * 1024 }>::uninit();
    // SAFETY: `read` and `recv` are the only writers of `buf`; each iteration reads back only `buf[..amt]`.
    let buf = unsafe { stack_buf.as_bytes_mut() };
    // A read without O_NONBLOCK sleeps, and a FIFO with no writer yet reads as an end of file: wait for "ready" first.
    let mut wait_before_read = match src.peer {
        Peer::None | Peer::Socket | Peer::Unknown => false,
        Peer::Fifo => true,
        Peer::Terminal => !src.nonblocking,
    };
    let mut remaining = cap;
    while remaining > 0 {
        // A copy between two ends that always have bytes and room never waits.
        cancel.check(bun_sys::Tag::read)?;
        let want = (buf.len() as SizeType).min(remaining) as usize;
        let amt = loop {
            if wait_before_read {
                cancel.wait_until_ready(src.fd, POLL_IN, bun_sys::Tag::read)?;
            }
            let read = if src.peer == Peer::Socket {
                bun_sys::recv_non_block(src.fd, &mut buf[..want])
            } else {
                bun_sys::read(src.fd, &mut buf[..want])
            };
            match read {
                Ok(amt) => break amt,
                Err(err) if err.get_errno() == bun_sys::E::EAGAIN => {
                    cancel.wait_until_ready(src.fd, POLL_IN, bun_sys::Tag::read)?;
                    wait_before_read = false;
                }
                Err(err) => return Err(err),
            }
        };
        wait_before_read = matches!(src.peer, Peer::Fifo | Peer::Terminal) && !src.nonblocking;
        if amt == 0 {
            break;
        }
        remaining -= amt as SizeType;
        let mut slice = &buf[..amt];
        while !slice.is_empty() {
            match write_now(cancel, dst, slice)? {
                Some(0) => return Ok(()),
                Some(wrote) => {
                    *total += wrote as u64;
                    slice = &slice[wrote..];
                }
                None => cancel.wait_until_ready(dst.fd, POLL_OUT, bun_sys::Tag::write)?,
            }
        }
    }
    Ok(())
}

// Ownership is encoded in the types, so cleanup is all field `Drop`:
// `source_file_store.pathlike` is a `PathLike` clone that is independently
// droppable — `PathLike::clone` dupes owned string buffers (freed by the
// clone's own `CowSlice` drop), bumps refs for WTF-backed slices, and only
// shares the backing for borrowed-string/Buffer variants (whose owner is kept
// alive by the `source_store` `RefPtr<Store>`). Each clone's field `Drop` frees
// exactly what it owns; the `RefPtr<Store>`s release just their Store refcounts on
// drop. No explicit `Drop` impl is needed.

// Kept local until bun_sys exports these; values match crate::node::fs.
#[cfg(not(windows))]
const PREALLOCATE_SUPPORTED: bool = cfg!(any(target_os = "linux", target_os = "android"));
#[cfg(not(windows))]
const PREALLOCATE_LENGTH: SizeType = 2048 * 1024;

// O_NONBLOCK: open(2) of a FIFO does not wait for its other end. A regular file ignores the flag.
#[cfg(any(target_os = "linux", target_os = "android"))]
const OPEN_DESTINATION_FLAGS: i32 = bun_sys::O::CLOEXEC
    | bun_sys::O::CREAT
    | bun_sys::O::WRONLY
    | bun_sys::O::TRUNC
    | bun_sys::O::NONBLOCK;
// No O_NONBLOCK: fcopyfile() and the node:fs loop fail on a full FIFO that has it, and only an fstat per copy tells.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
const OPEN_DESTINATION_FLAGS: i32 =
    bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC;
#[cfg(not(windows))]
const OPEN_SOURCE_FLAGS: i32 = bun_sys::O::CLOEXEC | bun_sys::O::RDONLY | bun_sys::O::NONBLOCK;

/// The longest time between two opens of a destination FIFO that has no reader yet.
#[cfg(any(target_os = "linux", target_os = "android"))]
const FIFO_READER_RETRY_MS: i32 = 50;

#[cfg(any(target_os = "linux", target_os = "android"))]
#[derive(Clone, Copy)]
enum Plan {
    Syscall(TryWith),
    /// `copy_with_waits`.
    ReadWrite,
}

#[derive(PartialEq, Eq, Clone, Copy)]
#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) enum TryWith {
    Sendfile,
    CopyFileRange,
    Splice,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl TryWith {
    pub(crate) const fn tag(self) -> bun_sys::Tag {
        match self {
            TryWith::Sendfile => bun_sys::Tag::sendfile,
            TryWith::CopyFileRange => bun_sys::Tag::copy_file_range,
            TryWith::Splice => bun_sys::Tag::splice,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// CopyFileWindows (libuv async)
// ───────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub(crate) struct CopyFileWindows<'a> {
    pub(crate) destination_file_store: RefPtr<Store>,
    pub(crate) source_file_store: RefPtr<Store>,

    pub(crate) io_request: libuv::fs_t,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) mkdirp_if_not_exists: bool,
    pub(crate) destination_mode: Option<Mode>,
    // per LIFETIMES.tsv: JSC_BORROW → &jsc::EventLoop
    // TODO(refactor): lifetime — heap-allocated and re-entered from libuv callbacks;
    // likely should be *const jsc::EventLoop.
    pub(crate) event_loop: &'a jsc::event_loop::EventLoop,
    /// The context of the script that asked for the copy.
    pub(crate) context: jsc::ContextId,

    pub(crate) size: SizeType,

    /// Bytes written, stored for use after async chmod completes
    pub(crate) written_bytes: usize,

    /// For mkdirp
    pub(crate) err: Option<bun_sys::Error>,

    /// When we are unable to get the original file path, we do a read-write loop that uses libuv.
    pub(crate) read_write_loop: ReadWriteLoop,
}

#[cfg(windows)]
pub(crate) struct ReadWriteLoop {
    pub(crate) source_fd: Fd,
    pub(crate) must_close_source_fd: bool,
    pub(crate) destination_fd: Fd,
    pub(crate) must_close_destination_fd: bool,
    pub(crate) written: usize,
    pub(crate) read_buf: Vec<u8>,
    pub(crate) uv_buf: libuv::uv_buf_t,
}

#[cfg(windows)]
impl Default for ReadWriteLoop {
    fn default() -> Self {
        Self {
            source_fd: Fd::INVALID,
            must_close_source_fd: false,
            destination_fd: Fd::INVALID,
            must_close_destination_fd: false,
            written: 0,
            read_buf: Vec::new(),
            uv_buf: libuv::uv_buf_t {
                len: 0,
                base: core::ptr::null_mut(),
            },
        }
    }
}

// `ReadWriteLoop` is a subobject of `CopyFileWindows`, so passing both as
// `&mut` would be aliasing UB. These are hoisted onto `CopyFileWindows` so the
// borrow checker can see `self.read_write_loop` / `self.io_request` / `self.event_loop`
// as disjoint field accesses through a single `&mut self`.
#[cfg(windows)]
impl<'a> CopyFileWindows<'a> {
    fn read_write_loop_start(&mut self) -> bun_sys::Result<()> {
        self.read_write_loop.read_buf.reserve_exact(64 * 1024);

        self.read_write_loop_read()
    }

    fn read_write_loop_read(&mut self) -> bun_sys::Result<()> {
        self.read_write_loop.read_buf.clear();
        // reshaped for borrowck — use the full capacity slice.
        let cap = self.read_write_loop.read_buf.capacity();
        self.read_write_loop.uv_buf = libuv::uv_buf_t {
            len: cap as libuv::ULONG,
            base: self.read_write_loop.read_buf.as_mut_ptr(),
        };
        let source_fd = self.read_write_loop.source_fd;
        let loop_ = self.event_loop.uv_loop();

        // This io_request is used for both reading and writing.
        // For now, we don't start reading the next chunk until
        // we've finished writing all the previous chunks.
        self.io_request.data = core::ptr::from_mut(self).cast::<c_void>();

        // SAFETY: FFI — `loop_` is the live VM uv loop, `io_request` is a zeroed/cleaned
        // `fs_t` owned by `self`, `uv_buf` points into `read_buf`'s capacity, and
        // `on_read` is a valid `uv_fs_cb`.
        let rc = unsafe {
            libuv::uv_fs_read(
                loop_,
                &mut self.io_request,
                source_fd.uv(),
                core::ptr::from_mut(&mut self.read_write_loop.uv_buf),
                1,
                -1,
                Some(on_read),
            )
        };

        if let Some(err) = rc.to_error(bun_sys::Tag::read) {
            return bun_sys::Result::Err(err);
        }

        bun_sys::Result::Ok(())
    }
}

#[cfg(windows)]
impl ReadWriteLoop {
    pub(crate) fn close(&mut self) {
        if self.must_close_source_fd {
            match self.source_fd.make_libuv_owned() {
                Ok(fd) => {
                    aio::Closer::close(fd, aio::Loop::get());
                }
                Err(_) => {
                    self.source_fd.close();
                }
            }
            self.must_close_source_fd = false;
            self.source_fd = Fd::INVALID;
        }

        if self.must_close_destination_fd {
            match self.destination_fd.make_libuv_owned() {
                Ok(fd) => {
                    aio::Closer::close(fd, aio::Loop::get());
                }
                Err(_) => {
                    self.destination_fd.close();
                }
            }
            self.must_close_destination_fd = false;
            self.destination_fd = Fd::INVALID;
        }

        self.read_buf = Vec::new(); // clearAndFree()
    }
}

#[cfg(windows)]
extern "C" fn on_read(req: *mut libuv::fs_t) {
    // SAFETY: `req->data` was set to `core::ptr::from_mut(self)` (whole-struct
    // provenance) before scheduling. Recover the parent from `data` rather than
    // `from_field_ptr!(.., io_request, req)`: the `req` pointer libuv hands back was
    // produced from a `&mut self.io_request` reborrow whose provenance covers only the
    // `io_request` field, so `container_of`-style subtraction would yield a
    // `*mut CopyFileWindows` with out-of-bounds provenance (UB under Stacked/Tree
    // Borrows). After forming `this`, access the request via `this.io_request` — never
    // through `(*req)`, which would alias the live `&mut`.
    let this: &mut CopyFileWindows = unsafe { &mut *(*req).data.cast::<CopyFileWindows>() };
    debug_assert!(core::ptr::addr_of_mut!(this.io_request) == req);

    let source_fd = this.read_write_loop.source_fd;
    let destination_fd = this.read_write_loop.destination_fd;
    // reshaped for borrowck — `read_buf.items` is `Vec` len-slice.
    let read_buf = &mut this.read_write_loop.read_buf;

    let event_loop = this.event_loop;

    let rc = this.io_request.result;

    bun_sys::syslog!(
        "uv_fs_read({}, {}) = {}",
        source_fd,
        read_buf.len(),
        rc.int()
    );
    if let Some(err) = rc.to_error(bun_sys::Tag::read) {
        this.err = Some(err);
        this.on_read_write_loop_complete();
        return;
    }

    let n = usize::try_from(rc.int()).expect("int cast");
    // SAFETY: libuv wrote `n` bytes into the buffer's capacity.
    unsafe { read_buf.set_len(n) };
    this.read_write_loop.uv_buf = libuv::uv_buf_t::init(read_buf.as_slice());

    if rc.int() == 0 {
        // Handle EOF. We can't read any more.
        this.on_read_write_loop_complete();
        return;
    }

    // Re-use the fs request.
    this.io_request.deinit();
    // SAFETY: FFI — `io_request` was just cleaned via `deinit()`, `uv_buf` points into
    // `read_buf` (len set above), and `on_write` is a valid `uv_fs_cb`.
    let rc2 = unsafe {
        libuv::uv_fs_write(
            event_loop.uv_loop(),
            &mut this.io_request,
            destination_fd.uv(),
            core::ptr::from_mut(&mut this.read_write_loop.uv_buf),
            1,
            -1,
            Some(on_write),
        )
    };
    this.io_request.data = core::ptr::from_mut(this).cast::<c_void>();

    if let Some(err) = rc2.to_error(bun_sys::Tag::write) {
        this.err = Some(err);
        this.on_read_write_loop_complete();
        return;
    }
}

#[cfg(windows)]
extern "C" fn on_write(req: *mut libuv::fs_t) {
    // SAFETY: see `on_read` — recover from `req->data` (whole-struct provenance),
    // not `from_field_ptr!`; then access the request only via `this.io_request`.
    let this: &mut CopyFileWindows = unsafe { &mut *(*req).data.cast::<CopyFileWindows>() };
    debug_assert!(core::ptr::addr_of_mut!(this.io_request) == req);
    let buf_len = this.read_write_loop.read_buf.len();

    let destination_fd = this.read_write_loop.destination_fd;

    let rc = this.io_request.result;

    bun_sys::syslog!(
        "uv_fs_write({}, {}) = {}",
        destination_fd,
        buf_len,
        rc.int()
    );

    if let Some(err) = rc.to_error(bun_sys::Tag::write) {
        this.err = Some(err);
        this.on_read_write_loop_complete();
        return;
    }

    let wrote: u32 = u32::try_from(rc.int()).expect("int cast");

    this.read_write_loop.written += wrote as usize;

    if (wrote as usize) < buf_len {
        if wrote == 0 {
            // Handle EOF. We can't write any more.
            this.on_read_write_loop_complete();
            return;
        }

        // Re-use the fs request.
        this.io_request.deinit();
        this.io_request.data = core::ptr::from_mut(this).cast::<c_void>();

        let prev = this.read_write_loop.uv_buf.slice();
        this.read_write_loop.uv_buf = libuv::uv_buf_t::init(&prev[wrote as usize..]);
        // SAFETY: FFI — `io_request` was just cleaned via `deinit()`, `uv_buf` is a tail
        // slice of the previous write buffer (still backed by `read_buf`), and
        // `on_write` is a valid `uv_fs_cb`.
        let rc2 = unsafe {
            libuv::uv_fs_write(
                this.event_loop.uv_loop(),
                &mut this.io_request,
                destination_fd.uv(),
                core::ptr::from_mut(&mut this.read_write_loop.uv_buf),
                1,
                -1,
                Some(on_write),
            )
        };

        if let Some(err) = rc2.to_error(bun_sys::Tag::write) {
            this.err = Some(err);
            this.on_read_write_loop_complete();
            return;
        }

        return;
    }

    this.io_request.deinit();
    match this.read_write_loop_read() {
        bun_sys::Result::Err(err) => {
            this.err = Some(err);
            this.on_read_write_loop_complete();
        }
        bun_sys::Result::Ok(()) => {}
    }
}

#[cfg(windows)]
impl<'a> CopyFileWindows<'a> {
    pub(crate) fn on_read_write_loop_complete(&mut self) {
        self.event_loop.unref_keep_alive();

        if let Some(err) = self.err.take() {
            self.throw(err);
            return;
        }

        let written = self.read_write_loop.written;
        self.on_complete(written);
    }

    pub(crate) fn new(init: CopyFileWindows<'a>) -> Box<CopyFileWindows<'a>> {
        Box::new(init)
    }

    pub(crate) fn init(
        destination_file_store: RefPtr<Store>,
        source_file_store: RefPtr<Store>,
        event_loop: &'a jsc::event_loop::EventLoop,
        context: &jsc::ScriptExecutionContext,
        mkdirp_if_not_exists: bool,
        size_: SizeType,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        // destination_file_store.ref() / source_file_store.ref() — Arc clone
        let global = event_loop.global_ref();
        let result = bun_core::heap::into_raw(CopyFileWindows::new(CopyFileWindows {
            destination_file_store,
            source_file_store,
            promise: jsc::JSPromiseStrong::init(global),
            // SAFETY: all-zero is a valid libuv::fs_t
            io_request: bun_core::ffi::zeroed::<libuv::fs_t>(),
            event_loop,
            context: context.id(),
            mkdirp_if_not_exists,
            destination_mode,
            size: size_,
            written_bytes: 0,
            err: None,
            read_write_loop: ReadWriteLoop::default(),
        }));
        // SAFETY: result was just allocated above
        let result_ref = unsafe { &mut *result };
        let promise = result_ref.promise.value();

        // On error, this function might free the CopyFileWindows struct.
        // So we can no longer reference it beyond this point.
        result_ref.copyfile();

        promise
    }

    fn prepare_pathlike(
        pathlike: &mut PathOrFileDescriptor,
        must_close: &mut bool,
        is_reading: bool,
    ) -> bun_sys::Result<Fd> {
        if let PathOrFileDescriptor::Path(path) = pathlike {
            let fd = match bun_sys::openat_windows_a(
                Fd::INVALID,
                path.slice(),
                if is_reading {
                    bun_sys::O::RDONLY
                } else {
                    bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC
                },
                0,
            ) {
                bun_sys::Result::Ok(result) => match result.make_libuv_owned() {
                    Ok(fd) => fd,
                    Err(_) => {
                        result.close();
                        return bun_sys::Result::Err(bun_sys::Error {
                            errno: bun_sys::SystemErrno::EMFILE as u16,
                            syscall: bun_sys::Tag::open,
                            path: path.slice().into(),
                            ..Default::default()
                        });
                    }
                },
                bun_sys::Result::Err(err) => {
                    return bun_sys::Result::Err(err);
                }
            };
            *must_close = true;
            bun_sys::Result::Ok(fd)
        } else {
            // We assume that this is already a uv-casted file descriptor.
            bun_sys::Result::Ok(pathlike.fd())
        }
    }

    fn prepare_read_write_loop(&mut self) {
        // Open the destination first, so that if we need to call
        // mkdirp(), we don't spend extra time opening the file handle for
        // the source.
        self.read_write_loop.destination_fd = match Self::prepare_pathlike(
            &mut Store::data_mut(&self.destination_file_store)
                .as_file_mut()
                .pathlike,
            &mut self.read_write_loop.must_close_destination_fd,
            false,
        ) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(err) => {
                if self.mkdirp_if_not_exists && err.get_errno() == bun_sys::E::ENOENT {
                    self.mkdirp();
                    return;
                }

                self.throw(err);
                return;
            }
        };

        self.read_write_loop.source_fd = match Self::prepare_pathlike(
            &mut Store::data_mut(&self.source_file_store)
                .as_file_mut()
                .pathlike,
            &mut self.read_write_loop.must_close_source_fd,
            true,
        ) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(err) => {
                self.throw(err);
                return;
            }
        };

        match self.read_write_loop_start() {
            bun_sys::Result::Err(err) => {
                self.throw(err);
            }
            bun_sys::Result::Ok(()) => {
                self.event_loop.ref_keep_alive();
            }
        }
    }

    fn copyfile(&mut self) {
        // This is for making it easier for us to test this code path
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE
            .get()
            .unwrap_or(false)
        {
            self.prepare_read_write_loop();
            return;
        }

        let mut pathbuf1 = bun_paths::path_buffer_pool::get();
        let mut pathbuf2 = bun_paths::path_buffer_pool::get();
        // capture the raw `self` pointer before borrowing the file
        // stores. `slice_z` ties the returned `&ZStr` lifetime to `&self`, so
        // `new_path`/`old_path` keep `self.{destination,source}_file_store`
        // borrowed across the `uv_fs_copyfile` call below; taking
        // `core::ptr::from_mut(self)` there would require an exclusive reborrow
        // of all of `*self` and conflict. The pointer is only stored in
        // `io_request.data` for the libuv callback to recover `self`.
        let this_ptr: *mut c_void = core::ptr::from_mut(self).cast::<c_void>();
        let destination_file_store = &mut self.destination_file_store.data.as_file();
        let source_file_store = &mut self.source_file_store.data.as_file();

        let new_path: &bun_core::ZStr = 'brk: {
            match &destination_file_store.pathlike {
                PathOrFileDescriptor::Path(_) => {
                    break 'brk destination_file_store
                        .pathlike
                        .path()
                        .slice_z(&mut pathbuf1);
                }
                PathOrFileDescriptor::Fd(fd) => {
                    let fd = *fd;
                    match bun_sys::File::borrow(&fd).kind() {
                        bun_sys::Result::Err(err) => {
                            self.throw(err);
                            return;
                        }
                        bun_sys::Result::Ok(kind) => match kind {
                            bun_sys::FileKind::Directory => {
                                self.throw(bun_sys::Error::from_code(
                                    bun_sys::E::EISDIR,
                                    bun_sys::Tag::open,
                                ));
                                return;
                            }
                            bun_sys::FileKind::CharacterDevice => {
                                self.prepare_read_write_loop();
                                return;
                            }
                            _ => {
                                let out = match bun_sys::get_fd_path(fd, &mut pathbuf1) {
                                    Ok(out) => out,
                                    Err(_) => {
                                        // This case can happen when either:
                                        // - NUL device
                                        // - Pipe. `cat foo.txt | bun bar.ts`
                                        self.prepare_read_write_loop();
                                        return;
                                    }
                                };
                                let len = out.len();
                                pathbuf1[len] = 0;
                                // SAFETY: pathbuf1[len] == 0 written above
                                break 'brk bun_core::ZStr::from_buf(&pathbuf1[..], len);
                            }
                        },
                    }
                }
            }
        };
        let old_path: &bun_core::ZStr = 'brk: {
            match &source_file_store.pathlike {
                PathOrFileDescriptor::Path(_) => {
                    break 'brk source_file_store.pathlike.path().slice_z(&mut pathbuf2);
                }
                PathOrFileDescriptor::Fd(fd) => {
                    let fd = *fd;
                    match bun_sys::File::borrow(&fd).kind() {
                        bun_sys::Result::Err(err) => {
                            self.throw(err);
                            return;
                        }
                        bun_sys::Result::Ok(kind) => match kind {
                            bun_sys::FileKind::Directory => {
                                self.throw(bun_sys::Error::from_code(
                                    bun_sys::E::EISDIR,
                                    bun_sys::Tag::open,
                                ));
                                return;
                            }
                            bun_sys::FileKind::CharacterDevice => {
                                self.prepare_read_write_loop();
                                return;
                            }
                            _ => {
                                let out = match bun_sys::get_fd_path(fd, &mut pathbuf2) {
                                    Ok(out) => out,
                                    Err(_) => {
                                        // This case can happen when either:
                                        // - NUL device
                                        // - Pipe. `cat foo.txt | bun bar.ts`
                                        self.prepare_read_write_loop();
                                        return;
                                    }
                                };
                                let len = out.len();
                                pathbuf2[len] = 0;
                                // SAFETY: pathbuf2[len] == 0 written above
                                break 'brk bun_core::ZStr::from_buf(&pathbuf2[..], len);
                            }
                        },
                    }
                }
            }
        };
        let loop_ = self.event_loop.uv_loop();
        self.io_request.data = this_ptr;

        // SAFETY: FFI — `loop_` is the live VM uv loop, `io_request` is owned by `self`,
        // `old_path`/`new_path` are NUL-terminated (from `slice_z`/`ZStr`), and
        // `on_copy_file` is a valid `uv_fs_cb`.
        let rc = unsafe {
            libuv::uv_fs_copyfile(
                loop_,
                &mut self.io_request,
                old_path.as_ptr(),
                new_path.as_ptr(),
                0,
                Some(on_copy_file),
            )
        };

        if let Some(mut err) = rc.to_error(bun_sys::Tag::copyfile) {
            // https://github.com/oven-sh/bun/issues/6336
            if err.get_errno() == bun_sys::E::EPERM {
                err = bun_sys::Error::from_code(bun_sys::E::ENOENT, bun_sys::Tag::copyfile);
            }
            self.throw(err.with_path(old_path.as_bytes()));
            return;
        }
        self.event_loop.ref_keep_alive();
    }

    pub(crate) fn throw(&mut self, err: bun_sys::Error) {
        let _context = jsc::virtual_machine::VirtualMachine::get().enter_context(self.context);
        let global_this = self.event_loop.global_ref();
        // `swap()` returns a `&mut JSPromise` into a GC-owned cell (not into
        // `self`), but its lifetime is elided to `&mut self`. Decay to a raw pointer so
        // borrowck doesn't tie it to `self` across `destroy` below.
        let promise = JSPromise::opaque_mut(self.promise.swap());
        let err_instance = err.to_js_with_async_stack(global_this, promise);

        // SAFETY: VM-owned event loop is valid for the process lifetime; `enter_scope`
        // calls enter() now and exit() on drop.
        let _guard = unsafe {
            jsc::event_loop::EventLoop::enter_scope(self.event_loop as *const _ as *mut _)
        };
        // SAFETY: self was heap-allocated in init(); destroy reclaims and drops it. self is not accessed afterward.
        unsafe { Self::destroy(core::ptr::from_mut(self)) };
        // `promise` points to a GC-owned `JSPromise` cell, not into `self`; valid after `destroy`.
        // This libuv completion is the landing frame for what settling leaves.
        crate::dispatch::fold(promise.reject(global_this, err_instance));
    }

    pub(crate) fn on_complete(&mut self, written_actual: usize) {
        let mut written = written_actual;
        if written > usize::try_from(self.size).expect("int cast") && self.size != MAX_SIZE {
            self.truncate();
            written = usize::try_from(self.size).expect("int cast");
        }

        // Apply destination mode if specified (async)
        if let Some(mode) = self.destination_mode {
            if matches!(
                self.destination_file_store.data.as_file().pathlike,
                PathOrFileDescriptor::Path(_)
            ) {
                self.written_bytes = written;
                let mut pathbuf = bun_paths::path_buffer_pool::get();
                // Borrowck: `slice_z` ties the returned `&ZStr` to
                // `&self.destination_file_store`, which would conflict with the
                // `core::ptr::from_mut(self)` below. Capture the raw C pointer now —
                // it points either into the stack-local `pathbuf` or into the
                // Arc-held `destination_file_store` path bytes, both of which outlive
                // the `uv_fs_chmod` call (libuv `strdup`s the path internally).
                let path_ptr = self
                    .destination_file_store
                    .data
                    .as_file()
                    .pathlike
                    .path()
                    .slice_z(&mut pathbuf)
                    .as_ptr();
                let loop_ = self.event_loop.uv_loop();
                self.io_request.deinit();
                // SAFETY: all-zero is a valid libuv::fs_t
                self.io_request = bun_core::ffi::zeroed::<libuv::fs_t>();
                self.io_request.data = core::ptr::from_mut(self).cast::<c_void>();

                // SAFETY: FFI — `loop_` is the live VM uv loop, `io_request` was just zeroed,
                // `path_ptr` is NUL-terminated (from `slice_z`) and live for this call,
                // and `on_chmod` is a valid `uv_fs_cb`.
                let rc = unsafe {
                    libuv::uv_fs_chmod(
                        loop_,
                        &mut self.io_request,
                        path_ptr,
                        i32::try_from(mode).expect("int cast"),
                        Some(on_chmod),
                    )
                };

                // chmod failed to start - reject the promise to report the error.
                if let Some(mut err) = rc.to_error(bun_sys::Tag::chmod) {
                    let destination = &self.destination_file_store.data.as_file();
                    if let PathOrFileDescriptor::Path(p) = &destination.pathlike {
                        err = err.with_path(p.slice());
                    }
                    self.throw(err);
                    return;
                }
                self.event_loop.ref_keep_alive();
                return;
            }
        }

        self.resolve_promise(written);
    }

    fn resolve_promise(&mut self, written: usize) {
        let _context = jsc::virtual_machine::VirtualMachine::get().enter_context(self.context);
        let global_this = self.event_loop.global_ref();
        // see `throw` — re-type the GC cell via the ZST opaque deref so it
        // outlives `destroy(self)` for borrowck.
        let promise = JSPromise::opaque_mut(self.promise.swap());
        // SAFETY: VM-owned event loop is valid for the process lifetime; `enter_scope`
        // calls enter() now and exit() on drop.
        let _guard = unsafe {
            jsc::event_loop::EventLoop::enter_scope(self.event_loop as *const _ as *mut _)
        };

        // SAFETY: self was heap-allocated in init(); destroy reclaims and drops it. self is not accessed afterward.
        unsafe { Self::destroy(core::ptr::from_mut(self)) };
        // `promise` points to a GC-owned `JSPromise` cell, not into `self`; valid after `destroy`.
        // As in `throw`: folded at this libuv completion.
        crate::dispatch::fold(
            promise.resolve(global_this, JSValue::js_number_from_uint64(written as u64)),
        );
    }

    #[cold]
    fn truncate(&mut self) {
        // TODO: optimize this

        let mut node_fs_ = node_fs::NodeFS::default();
        let _ = node_fs_.truncate(
            &node_fs::args::Truncate {
                path: self.destination_file_store.data.as_file().pathlike.clone(),
                len: u64::try_from(self.size).expect("int cast"),
                flags: 0,
            },
            node_fs::Flavor::Sync,
        );
    }

    /// SAFETY: `this` must have been produced by `heap::alloc` in `init()` and
    /// not yet destroyed. After this call `this` is dangling.
    pub(crate) unsafe fn destroy(this: *mut Self) {
        // SAFETY: caller contract — `this` is a live `heap::alloc`-ed pointer.
        unsafe {
            (*this).read_write_loop.close();
            // destination_file_store.deref() / source_file_store.deref() — Arc Drop on Box drop
            // promise.deinit() — handled by JscStrong's Drop on Box drop
            (*this).io_request.deinit();
            drop(bun_core::heap::take(this));
        }
    }

    fn mkdirp(&mut self) {
        bun_sys::syslog!("mkdirp");
        self.mkdirp_if_not_exists = false;
        // Borrowck: compute the raw path slice pointer up-front so the
        // immutable borrow of `self.destination_file_store` ends before we take
        // `core::ptr::from_mut(self)` for `completion_ctx` below.
        let path: *const [u8] = {
            let destination = &self.destination_file_store.data.as_file();
            if !matches!(destination.pathlike, PathOrFileDescriptor::Path(_)) {
                self.throw(bun_sys::Error {
                    errno: bun_sys::SystemErrno::EINVAL as u16,
                    syscall: bun_sys::Tag::mkdir,
                    ..Default::default()
                });
                return;
            }
            let path_slice = destination.pathlike.path().slice();
            // BORROW: not owned — `destination_file_store` (and thus its path) is held in
            // `self`, which outlives the workpool task (completion runs `copyfile`/`throw`
            // on `self` before any `destroy`).
            bun_paths::dirname(path_slice)
                // this shouldn't happen
                .unwrap_or(path_slice) as *const [u8]
        };

        self.event_loop.ref_keep_alive();
        node_fs::async_::AsyncMkdirp::schedule(node_fs::async_::AsyncMkdirp {
            completion: on_mkdirp_complete_concurrent,
            completion_ctx: core::ptr::from_mut(self).cast::<()>(),
            path,
            ticket: jsc::VirtualMachine::VirtualMachine::get().ticket(),
            task: Default::default(),
        });
    }

    fn on_mkdirp_complete(&mut self) {
        self.event_loop.unref_keep_alive();

        if let Some(err) = self.err.take() {
            // `bun_sys::Error.path` is an owned `Box<[u8]>` and is dropped with
            // `err` inside `throw`.
            self.throw(err);
            return;
        }

        self.copyfile();
    }
}

#[cfg(windows)]
extern "C" fn on_copy_file(req: *mut libuv::fs_t) {
    // SAFETY: see `on_read` — recover from `req->data` (whole-struct provenance),
    // not `from_field_ptr!`; then access the request only via `this.io_request`.
    let this: &mut CopyFileWindows = unsafe { &mut *(*req).data.cast::<CopyFileWindows>() };
    debug_assert!(core::ptr::addr_of_mut!(this.io_request) == req);

    let event_loop = this.event_loop;
    event_loop.unref_keep_alive();
    let rc = this.io_request.result;

    bun_sys::syslog!("uv_fs_copyfile() = {}", rc);
    if let Some(errno) = rc.errno() {
        // ENOENT from uv_fs_copyfile can mean either the source file or the
        // destination directory is missing. Disambiguate so a missing source
        // rejects directly instead of entering the mkdirp+retry path. Only an
        // ENOENT from the probe counts as "missing"; any other error leaves
        // the mkdirp+retry path available.
        let source_missing = errno == bun_sys::E::ENOENT
            && match &this.source_file_store.data.as_file().pathlike {
                PathOrFileDescriptor::Path(p) => {
                    let mut buf = bun_paths::path_buffer_pool::get();
                    matches!(
                        bun_sys::access(p.slice_z(&mut buf), 0),
                        bun_sys::Result::Err(e) if e.get_errno() == bun_sys::E::ENOENT
                    )
                }
                PathOrFileDescriptor::Fd(_) => false,
            };

        if this.mkdirp_if_not_exists && errno == bun_sys::E::ENOENT && !source_missing {
            this.io_request.deinit();
            this.mkdirp();
            return;
        }

        let mut err = bun_sys::Error::from_code(
            // https://github.com/oven-sh/bun/issues/6336
            if errno == bun_sys::E::EPERM {
                bun_sys::E::ENOENT
            } else {
                errno
            },
            bun_sys::Tag::copyfile,
        );
        let store = if source_missing {
            &this.source_file_store
        } else {
            &this.destination_file_store
        };
        match &store.data.as_file().pathlike {
            PathOrFileDescriptor::Path(p) => {
                err = err.with_path(p.slice());
            }
            PathOrFileDescriptor::Fd(fd) => {
                err = err.with_fd(*fd);
            }
        }

        this.throw(err);
        return;
    }

    // uv_fs_copyfile leaves `statbuf` empty.
    let size = match &this.destination_file_store.data.as_file().pathlike {
        PathOrFileDescriptor::Path(p) => {
            let mut buf = bun_paths::path_buffer_pool::get();
            bun_sys::stat(p.slice_z(&mut buf)).map(|stat| stat.size())
        }
        PathOrFileDescriptor::Fd(fd) => bun_sys::fstat(*fd).map(|stat| stat.size()),
    };
    let size = match size {
        Ok(size) => size,
        Err(err) => {
            this.throw(err);
            return;
        }
    };
    this.on_complete(usize::try_from(size).expect("int cast"));
}

#[cfg(windows)]
extern "C" fn on_chmod(req: *mut libuv::fs_t) {
    // SAFETY: see `on_read` — recover from `req->data` (whole-struct provenance),
    // not `from_field_ptr!`; then access the request only via `this.io_request`.
    let this: &mut CopyFileWindows = unsafe { &mut *(*req).data.cast::<CopyFileWindows>() };
    debug_assert!(core::ptr::addr_of_mut!(this.io_request) == req);

    let event_loop = this.event_loop;
    event_loop.unref_keep_alive();

    let rc = this.io_request.result;
    if let Some(mut err) = rc.to_error(bun_sys::Tag::chmod) {
        let destination = &this.destination_file_store.data.as_file();
        if let PathOrFileDescriptor::Path(p) = &destination.pathlike {
            err = err.with_path(p.slice());
        }
        this.throw(err);
        return;
    }

    this.resolve_promise(this.written_bytes);
}

#[cfg(windows)]
fn on_mkdirp_complete_concurrent(ctx: *mut (), err_: bun_sys::Maybe<()>, ticket: &jsc::Ticket) {
    bun_sys::syslog!("mkdirp complete");
    // SAFETY: `ctx` is the `*mut CopyFileWindows` stored in `AsyncMkdirp.completion_ctx`
    // by `mkdirp` above; sole owner on this concurrent path.
    let this = unsafe { bun_ptr::callback_ctx::<CopyFileWindows>(ctx.cast()) };
    debug_assert!(this.err.is_none());
    this.err = match err_ {
        bun_sys::Result::Err(e) => Some(e),
        bun_sys::Result::Ok(()) => None,
    };
    ticket.post(jsc::ConcurrentTask::create_from(
        std::ptr::from_mut(this).cast::<CopyFileWindowsMkdirp<'_>>(),
    ));
}

/// `mkdirp` finished on the work pool: the hop back to the JS thread. Same pointer as the copy, its
/// own tag.
#[cfg(windows)]
#[repr(transparent)]
pub(crate) struct CopyFileWindowsMkdirp<'a>(CopyFileWindows<'a>);

#[cfg(windows)]
impl bun_event_loop::Taskable for CopyFileWindowsMkdirp<'_> {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::CopyFileWindowsMkdirp;
    /// Frees nothing: the copy is not this task's.
    unsafe fn release_unrun(_: *mut Self) {}
    /// Enters no context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

#[cfg(windows)]
impl CopyFileWindowsMkdirp<'_> {
    /// # Safety
    /// `this` is the live `CopyFileWindows` `on_mkdirp_complete_concurrent` posted;
    /// `on_mkdirp_complete` may free it via `throw`.
    pub(crate) unsafe fn run(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { (*this).0.on_mkdirp_complete() };
    }
}

// ───────────────────────────────────────────────────────────────────────────
// IOWhich + module-level constants
// ───────────────────────────────────────────────────────────────────────────

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
#[cfg(not(windows))]
pub(crate) enum IOWhich {
    Source,
    Destination,
    Both,
}

#[cfg(not(windows))]
fn unsupported_directory_error() -> SystemError {
    SystemError {
        errno: bun_sys::SystemErrno::EISDIR as i32,
        message: bun_core::String::static_("That doesn't work on folders"),
        syscall: bun_core::String::static_("fstat"),
        ..SystemError::default()
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn unsupported_non_regular_file_error() -> SystemError {
    SystemError {
        errno: bun_sys::SystemErrno::ENOTSUP as i32,
        message: bun_core::String::static_("Non-regular files aren't supported yet"),
        syscall: bun_core::String::static_("fstat"),
        ..SystemError::default()
    }
}
// `SystemError` contains `bun_core::String`, which is not const-constructible,
// so these are constructor fns instead of `const` values.
