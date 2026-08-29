//! blocking, but off the main thread

use crate::node::fs as node_fs;
#[cfg(windows)]
use crate::node::types::PathLikeExt as _;
#[cfg(not(windows))]
use crate::webcore::blob::{self, Retry};
use crate::webcore::blob::{FileSnapshot, SnapshotPath};
use crate::webcore::blob::{MAX_SIZE, MkdirpTarget, SizeType, Store};
#[cfg(windows)]
use crate::webcore::node_types::PathOrFileDescriptor;
#[cfg(windows)]
use bun_io as aio;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue};
use bun_paths::PathBuffer;
use bun_ptr::RefPtr;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(not(windows))]
use bun_sys::Stat;
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self, Fd, FdExt, Mode, SystemError};
#[cfg(windows)]
use bun_sys_jsc::ErrorJsc as _;
use core::marker::ConstParamTy;

// ───────────────────────────────────────────────────────────────────────────
// CopyFile (POSIX, blocking off-thread)
// ───────────────────────────────────────────────────────────────────────────

#[cfg_attr(windows, allow(dead_code))] // Windows copies go through `CopyFileWindows`
pub struct CopyFile {
    /// What the pool thread reads of each store's `File`, copied at creation.
    pub(crate) destination_file_store: FileSnapshot,
    pub(crate) source_file_store: FileSnapshot,
    /// Held (not read) so both stores stay alive while this task is on the
    /// work pool; released before the promise settles.
    _store: RefPtr<Store>,
    _source_store: RefPtr<Store>,
    pub offset: SizeType,
    #[cfg(not(windows))]
    pub(crate) max_length: SizeType,
    #[cfg(not(windows))]
    pub(crate) destination_fd: Fd,
    #[cfg(not(windows))]
    pub(crate) source_fd: Fd,

    pub(crate) system_error: Option<SystemError>,

    pub(crate) read_len: SizeType,

    pub(crate) mkdirp_if_not_exists: bool,
    #[cfg(not(windows))]
    pub(crate) destination_mode: Option<Mode>,
}

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

impl jsc::JobContext for CopyFile {
    type OffThread = Self;
    type Js = jsc::JSPromiseStrong;
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.run_async();
        Some(done)
    }
    fn then(
        this: Self,
        mut promise: jsc::JSPromiseStrong,
        cx: &jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        CopyFile::then(this, promise.swap(), cx.global())
    }
}

impl CopyFile {
    #[cfg(not(windows))]
    #[inline]
    pub(crate) fn destination_file_store(&self) -> &FileSnapshot {
        &self.destination_file_store
    }

    #[inline]
    pub(crate) fn source_file_store(&self) -> &FileSnapshot {
        &self.source_file_store
    }

    /// Schedule the copy on the work pool; returns its promise.
    #[cfg(not(windows))]
    pub(crate) fn create(
        store: RefPtr<Store>,
        source_store: RefPtr<Store>,
        off: SizeType,
        max_len: SizeType,
        global_this: &JSGlobalObject,
        mkdirp_if_not_exists: bool,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        let copy = CopyFile {
            destination_file_store: FileSnapshot::new(store.data.as_file()),
            source_file_store: FileSnapshot::new(source_store.data.as_file()),
            _store: store,
            _source_store: source_store,
            offset: off,
            max_length: max_len,
            mkdirp_if_not_exists,
            destination_mode,
            // defaults:
            destination_fd: Fd::INVALID,
            source_fd: Fd::INVALID,
            system_error: None,
            read_len: 0,
        };
        let cx = global_this.js_thread();
        let promise = jsc::JSPromiseStrong::init(global_this);
        let value = promise.value();
        jsc::Job::<CopyFile>::schedule(&cx, copy, promise);
        value
    }

    pub(crate) fn reject(
        mut self,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        let mut system_error: SystemError = self.system_error.take().unwrap_or_default();
        if matches!(self.source_file_store().pathlike, SnapshotPath::Path(_))
            && system_error.path.is_empty()
        {
            system_error.path =
                bun_core::String::clone_utf8(self.source_file_store().pathlike.path().slice());
        }

        if system_error.message.is_empty() {
            system_error.message = bun_core::String::static_("Failed to copy file");
        }

        let instance = jsc::SystemError::from(system_error)
            .to_error_instance_with_async_stack(global_this, promise);
        // Releases both store refs before settling.
        drop(self);
        promise.reject(global_this, Ok(instance))
    }

    pub(crate) fn then(
        self,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) -> jsc::JsResult<()> {
        if self.system_error.is_some() {
            return self.reject(promise, global_this);
        }

        let read_len = self.read_len;
        // Releases both store refs before settling.
        drop(self);
        promise.resolve(global_this, JSValue::js_number_from_uint64(read_len as u64))
    }

    #[cfg(not(windows))]
    pub(crate) fn do_close(&mut self) {
        let close_input = !matches!(self.destination_file_store().pathlike, SnapshotPath::Fd(_))
            && self.destination_fd != Fd::INVALID;
        let close_output = !matches!(self.source_file_store().pathlike, SnapshotPath::Fd(_))
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

    #[cfg(not(windows))]
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

    #[cfg(not(windows))]
    pub(crate) fn do_open_file<const WHICH: IOWhich>(&mut self) -> Result<(), crate::Error> {
        let mut path_buf1 = PathBuffer::uninit();
        // open source file first
        // if it fails, we don't want the extra destination file hanging out
        if matches!(WHICH, IOWhich::Both | IOWhich::Source) {
            self.source_fd = match bun_sys::open(
                self.source_file_store()
                    .pathlike
                    .path()
                    .slice_z(&mut path_buf1),
                OPEN_SOURCE_FLAGS,
                0,
            ) {
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
        }

        if matches!(WHICH, IOWhich::Both | IOWhich::Destination) {
            loop {
                // detach `dest` lifetime from `self` (borrowck) — slice_z
                // copies into path_buf1, so build the ZStr directly from the buffer.
                let dest_len = {
                    let s = self.destination_file_store().pathlike.path().slice();
                    let n = s.len().min(path_buf1.len() - 1);
                    path_buf1[..n].copy_from_slice(&s[..n]);
                    path_buf1[n] = 0;
                    n
                };
                // path_buf1[dest_len] == 0 written above.
                let dest: &bun_core::ZStr = bun_core::ZStr::from_buf(&path_buf1[..], dest_len);
                let mode = self.destination_mode.unwrap_or(node_fs::DEFAULT_PERMISSION);
                match bun_sys::open(dest, OPEN_DESTINATION_FLAGS, mode) {
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
                    }
                    bun_sys::Result::Err(errno) => {
                        match blob::mkdir_if_not_exists(self, &errno, dest, dest.as_bytes()) {
                            Retry::Continue => continue,
                            Retry::Fail => {
                                if matches!(WHICH, IOWhich::Both) {
                                    self.source_fd.close();
                                    self.source_fd = Fd::INVALID;
                                }
                                return Err(bun_errno::from_errno(errno.errno as i32).into());
                            }
                            Retry::No => {}
                        }

                        if matches!(WHICH, IOWhich::Both) {
                            self.source_fd.close();
                            self.source_fd = Fd::INVALID;
                        }

                        self.system_error = Some(
                            errno
                                .with_path(self.destination_file_store().pathlike.path().slice())
                                .to_system_error(),
                        );
                        return Err(bun_errno::from_errno(errno.errno as i32).into());
                    }
                }
                break;
            }
        }
        Ok(())
    }

    /// Copies the rest of the file with [`read_write_fallback`] when
    /// `copy_file_range`/`sendfile`/`splice` is unavailable or unusable,
    /// recording a failure in `system_error` the same way the syscall paths do.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn fallback_read_write(
        &mut self,
        remain: usize,
        unknown_size: bool,
        total_written: &mut u64,
    ) -> Result<(), crate::Error> {
        let bun_opened_dest = matches!(
            self.destination_file_store().pathlike,
            SnapshotPath::Path(_)
        );
        let cap = if unknown_size {
            MAX_SIZE
        } else {
            remain as SizeType
        };
        match read_write_fallback(
            self.source_fd,
            self.destination_fd,
            bun_opened_dest,
            cap,
            total_written,
        ) {
            bun_sys::Result::Err(err) => {
                self.system_error = Some(err.to_system_error());
                Err(bun_errno::from_errno(err.errno as i32).into())
            }
            bun_sys::Result::Ok(()) => Ok(()),
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) fn do_copy_file_range<const USE: TryWith, const CLEAR_APPEND_IF_INVALID: bool>(
        &mut self,
    ) -> Result<(), crate::Error> {
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
        let result = self.copy_file_range_loop::<USE, CLEAR_APPEND_IF_INVALID>(
            remain,
            unknown_size,
            &mut total_written,
        );
        self.read_len = total_written as SizeType;
        result
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn copy_file_range_loop<const USE: TryWith, const CLEAR_APPEND_IF_INVALID: bool>(
        &mut self,
        mut remain: usize,
        unknown_size: bool,
        total_written: &mut u64,
    ) -> Result<(), crate::Error> {
        use bun_sys::linux;
        let src_fd = self.source_fd;
        let dest_fd = self.destination_fd;
        let mut has_unset_append = false;

        // If they can't use copy_file_range, they probably also can't
        // use sendfile() or splice()
        if !bun_sys::copy_file::can_use_copy_file_range_syscall() {
            return self.fallback_read_write(remain, unknown_size, total_written);
        }

        loop {
            // TODO: this should use non-blocking I/O.
            let written: isize = match USE {
                TryWith::CopyFileRange => linux::copy_file_range_cur(src_fd, dest_fd, remain, 0),
                TryWith::Sendfile => linux::sendfile_cur(dest_fd, src_fd, remain),
                TryWith::Splice => linux::splice_cur(src_fd, dest_fd, remain, 0),
            };

            match bun_sys::get_errno(written) {
                bun_sys::E::SUCCESS => {}

                // XDEV: cross-device copy not supported
                // NOSYS: syscall not available
                // OPNOTSUPP: filesystem doesn't support this operation
                bun_sys::E::ENOSYS | bun_sys::E::EXDEV | bun_sys::E::ENOTSUP => {
                    // TODO: this should use non-blocking I/O.
                    return self.fallback_read_write(remain, unknown_size, total_written);
                }

                // EINVAL: eCryptfs and other filesystems may not support copy_file_range.
                // Also returned when the file descriptor is incompatible with the syscall.
                bun_sys::E::EINVAL => {
                    if CLEAR_APPEND_IF_INVALID {
                        if !has_unset_append {
                            // https://kylelaker.com/2018/08/31/stdout-oappend.html
                            // make() can set STDOUT / STDERR to O_APPEND
                            // this messes up sendfile()
                            has_unset_append = true;
                            let flags = match bun_sys::get_fcntl_flags(dest_fd) {
                                Ok(flags) => flags as i32,
                                Err(_) => -1,
                            };
                            if (flags & bun_sys::O::APPEND) != 0 {
                                let _ = bun_sys::set_fcntl_flags(
                                    dest_fd,
                                    (flags ^ bun_sys::O::APPEND) as bun_sys::FcntlInt,
                                );
                                continue;
                            }
                        }
                    }

                    // If the Linux machine doesn't support
                    // copy_file_range or the file descriptor is
                    // incompatible with the chosen syscall, fall back
                    // to a read/write loop
                    if *total_written == 0 {
                        // TODO: this should use non-blocking I/O.
                        return self.fallback_read_write(remain, unknown_size, total_written);
                    }

                    self.system_error = Some(
                        bun_sys::Error {
                            // bare `as` is lossless here (E repr == Error.Int).
                            errno: bun_sys::E::EINVAL as bun_sys::ErrorInt,
                            syscall: USE.tag(),
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
                            syscall: USE.tag(),
                            ..Default::default()
                        }
                        .to_system_error(),
                    );
                    return Err(bun_errno::from_errno(errno as i32).into());
                }
            }

            // wrote zero bytes means EOF
            *total_written += u64::try_from(written).expect("int cast");
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
    fn do_read_write_loop_capped(&mut self, cap: SizeType) -> Result<(), crate::Error> {
        let mut total: u64 = 0;
        match read_write_loop_capped(self.source_fd, self.destination_fd, cap, &mut total) {
            bun_sys::Result::Ok(()) => {
                self.read_len = total as SizeType;
                Ok(())
            }
            bun_sys::Result::Err(err) => {
                self.read_len = total as SizeType;
                self.system_error = Some(err.to_system_error());
                Err(bun_errno::from_errno(err.errno as i32).into())
            }
        }
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn do_fcopy_file_with_read_write_loop_fallback(
        &mut self,
    ) -> Result<(), crate::Error> {
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
                                return Err(bun_errno::from_errno(err.errno as i32).into());
                            }
                            bun_sys::Result::Ok(()) => {}
                        }
                    }
                    _ => {
                        self.system_error = Some(errno.to_system_error());
                        return Err(bun_errno::from_errno(errno.errno as i32).into());
                    }
                }
            }
            bun_sys::Result::Ok(()) => {}
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn do_clonefile(&mut self) -> Result<(), crate::Error> {
        let mut source_buf = PathBuffer::uninit();
        let mut dest_buf = PathBuffer::uninit();

        loop {
            // reshaped for borrowck — `slice_z(&'a self, &'a mut buf)`
            // ties the returned `&ZStr` to `self`, which would conflict with
            // the `&mut self` borrow `mkdir_if_not_exists` needs below. The
            // bytes live in `dest_buf`, so capture the length and re-borrow
            // from the buffer (not `self`) after dropping the first borrow.
            let dest_len = self
                .destination_file_store()
                .pathlike
                .path()
                .slice_z(&mut dest_buf)
                .len();
            // `slice_z` wrote `dest_len` bytes + NUL into `dest_buf`.
            let dest = bun_core::ZStr::from_buf(&dest_buf[..], dest_len);
            match bun_sys::clonefile(
                self.source_file_store()
                    .pathlike
                    .path()
                    .slice_z(&mut source_buf),
                dest,
            ) {
                bun_sys::Result::Err(errno) => {
                    let err_path = self
                        .destination_file_store()
                        .pathlike
                        .path()
                        .slice()
                        .to_vec();
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

    pub(crate) fn run_async(&mut self) {
        #[cfg(windows)]
        {
            return; // why
        }
        #[cfg(not(windows))]
        {
            #[cfg(target_os = "macos")]
            let mut stat_: Option<Stat> = None;
            #[cfg(not(target_os = "macos"))]
            let stat_: Option<Stat> = None;

            if let SnapshotPath::Fd(fd) = &self.destination_file_store().pathlike {
                self.destination_fd = *fd;
            }

            if let SnapshotPath::Fd(fd) = &self.source_file_store().pathlike {
                self.source_fd = *fd;
            }

            // Do we need to open both files?
            if self.destination_fd == Fd::INVALID && self.source_fd == Fd::INVALID {
                // First, we attempt to clonefile() on macOS
                // This is the fastest way to copy a file.
                #[cfg(target_os = "macos")]
                {
                    if self.offset == 0
                        && matches!(self.source_file_store().pathlike, SnapshotPath::Path(_))
                        && matches!(
                            self.destination_file_store().pathlike,
                            SnapshotPath::Path(_)
                        )
                    {
                        'do_clonefile: {
                            let mut path_buf = PathBuffer::uninit();

                            // stat the output file, make sure it:
                            // 1. Exists
                            match bun_sys::stat(
                                self.source_file_store()
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
                                        let _ = bun_sys::truncate(
                                            self.destination_file_store()
                                                .pathlike
                                                .path()
                                                .slice_z(&mut path_buf),
                                            i64::try_from(self.max_length).expect("int cast"),
                                        );
                                        self.read_len =
                                            SizeType::try_from(self.max_length).expect("int cast");
                                    } else {
                                        self.read_len =
                                            SizeType::try_from(stat_size).expect("int cast");
                                    }
                                    // Apply destination mode if specified (clonefile copies source permissions)
                                    if let Some(mode) = self.destination_mode {
                                        match bun_sys::chmod(
                                            self.destination_file_store()
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

                if self.do_open_file::<{ IOWhich::Both }>().is_err() {
                    return;
                }
                // Do we need to open only one file?
            } else if self.destination_fd == Fd::INVALID {
                self.source_fd = self.source_file_store().pathlike.fd();

                if self.do_open_file::<{ IOWhich::Destination }>().is_err() {
                    return;
                }
                // Do we need to open only one file?
            } else if self.source_fd == Fd::INVALID {
                self.destination_fd = self.destination_file_store().pathlike.fd();

                if self.do_open_file::<{ IOWhich::Source }>().is_err() {
                    return;
                }
            }

            if self.system_error.is_some() {
                return;
            }

            debug_assert!(self.destination_fd.is_valid());
            debug_assert!(self.source_fd.is_valid());

            if matches!(self.destination_file_store().pathlike, SnapshotPath::Fd(_)) {
                // nothing to do for the Fd case
            }

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
                        self.destination_file_store().pathlike,
                        SnapshotPath::Path(_)
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
                // Bun.write(Bun.file("a"), Bun.file("b"))
                if bun_sys::S::ISREG(stat.st_mode as _)
                    && (bun_sys::S::ISREG(self.destination_file_store().mode as _)
                        || self.destination_file_store().mode == 0)
                {
                    if self.destination_file_store().is_atty.unwrap_or(false) {
                        let _ = self.do_copy_file_range::<{ TryWith::CopyFileRange }, true>();
                    } else {
                        let _ = self.do_copy_file_range::<{ TryWith::CopyFileRange }, false>();
                    }

                    self.do_close();
                    return;
                }

                // $ bun run foo.js | bun run bar.js
                if bun_sys::S::ISFIFO(stat.st_mode as _)
                    && bun_sys::S::ISFIFO(self.destination_file_store().mode as _)
                {
                    if self.destination_file_store().is_atty.unwrap_or(false) {
                        let _ = self.do_copy_file_range::<{ TryWith::Splice }, true>();
                    } else {
                        let _ = self.do_copy_file_range::<{ TryWith::Splice }, false>();
                    }

                    self.do_close();
                    return;
                }

                if bun_sys::S::ISREG(stat.st_mode as _)
                    || bun_sys::S::ISCHR(stat.st_mode as _)
                    || bun_sys::S::ISSOCK(stat.st_mode as _)
                {
                    if self.destination_file_store().is_atty.unwrap_or(false) {
                        let _ = self.do_copy_file_range::<{ TryWith::Sendfile }, true>();
                    } else {
                        let _ = self.do_copy_file_range::<{ TryWith::Sendfile }, false>();
                    }

                    self.do_close();
                    return;
                }

                self.system_error = Some(unsupported_non_regular_file_error());
                self.do_close();
                return;
            }

            #[cfg(target_os = "macos")]
            {
                // fcopyfile rewrites dest from offset 0 and the slice trim is
                // ftruncate; both are only safe for a dest Bun opened O_TRUNC.
                if matches!(
                    self.destination_file_store().pathlike,
                    SnapshotPath::Path(_)
                ) {
                    if self.do_fcopy_file_with_read_write_loop_fallback().is_err() {
                        self.do_close();
                        return;
                    }
                    if stat.st_size != 0
                        && SizeType::try_from(stat.st_size).expect("int cast") > self.max_length
                    {
                        let _ = bun_sys::ftruncate(
                            self.destination_fd,
                            i64::try_from(self.max_length).expect("int cast"),
                        );
                    }
                } else if self.do_read_write_loop_capped(self.max_length).is_err() {
                    self.do_close();
                    return;
                }

                self.do_close();
                return;
            }

            #[cfg(target_os = "freebsd")]
            {
                if matches!(
                    self.destination_file_store().pathlike,
                    SnapshotPath::Path(_)
                ) {
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
                } else if self.do_read_write_loop_capped(self.max_length).is_err() {
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
    let mut buf = [core::mem::MaybeUninit::<u8>::uninit(); 64 * 1024];
    let mut remaining = cap;
    while remaining > 0 {
        let want = (buf.len() as SizeType).min(remaining) as usize;
        let read: &[u8] = bun_sys::read_uninit(src_fd, &mut buf[..want])?;
        let amt = read.len();
        if amt == 0 {
            break;
        }
        remaining -= amt as SizeType;
        let mut slice = read;
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

// Cleanup is all field `Drop`: the `RefPtr<Store>`s release their Store refcounts.

// Kept local until bun_sys exports these; values match crate::node::fs.
#[cfg(not(windows))]
const PREALLOCATE_SUPPORTED: bool = cfg!(any(target_os = "linux", target_os = "android"));
#[cfg(not(windows))]
const PREALLOCATE_LENGTH: SizeType = 2048 * 1024;

#[cfg(not(windows))]
const OPEN_DESTINATION_FLAGS: i32 =
    bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC;
#[cfg(not(windows))]
const OPEN_SOURCE_FLAGS: i32 = bun_sys::O::CLOEXEC | bun_sys::O::RDONLY;

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
pub enum TryWith {
    Sendfile,
    CopyFileRange,
    Splice,
}

impl TryWith {
    #[cfg(any(target_os = "linux", target_os = "android"))]
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
//
// Owned as a `Box` by whoever drives the next step: libuv while a
// copyfile/read/write/chmod is in flight (`bun_io::uv_fs`), the mkdirp hop, or
// the code below. Settling the promise drops the box.
// ───────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub struct CopyFileWindows {
    pub(crate) destination_file_store: RefPtr<Store>,
    pub(crate) source_file_store: RefPtr<Store>,

    pub(crate) io_request: libuv::fs_t,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) mkdirp_if_not_exists: bool,
    pub(crate) destination_mode: Option<Mode>,
    pub(crate) event_loop: bun_ptr::BackRef<jsc::event_loop::EventLoop>,

    pub(crate) size: SizeType,

    /// Bytes written, stored for use after async chmod completes
    pub(crate) written_bytes: usize,

    /// For mkdirp
    pub(crate) err: Option<bun_sys::Error>,

    /// When we are unable to get the original file path, we do a read-write loop that uses libuv.
    pub(crate) read_write_loop: ReadWriteLoop,
}

#[cfg(windows)]
bun_io::intrusive_uv_fs!(CopyFileWindows, io_request);

#[cfg(windows)]
pub struct ReadWriteLoop {
    pub(crate) source_fd: Fd,
    pub(crate) must_close_source_fd: bool,
    pub(crate) destination_fd: Fd,
    pub(crate) must_close_destination_fd: bool,
    pub(crate) written: usize,
    pub(crate) read_buf: Vec<u8>,
    /// How much of `read_buf` the current chunk's writes have consumed.
    pub(crate) chunk_written: usize,
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
            chunk_written: 0,
        }
    }
}

#[cfg(windows)]
impl CopyFileWindows {
    /// On return, libuv has `this` (until `on_fs_read`) or it has finished.
    fn read_write_loop_start(mut this: Box<Self>) {
        this.read_write_loop.read_buf.reserve_exact(64 * 1024);
        Self::read_write_loop_read(this);
    }

    /// On return, libuv has `this` (until `on_fs_read`) or it has finished.
    fn read_write_loop_read(mut this: Box<Self>) {
        this.read_write_loop.read_buf.clear();
        this.read_write_loop.chunk_written = 0;
        let source_fd = this.read_write_loop.source_fd.uv();
        let cap = this.read_write_loop.read_buf.capacity();

        // This io_request is used for both reading and writing.
        // For now, we don't start reading the next chunk until
        // we've finished writing all the previous chunks.
        if let Err((this, rc)) = aio::uv_fs::read(
            this,
            source_fd,
            |t: &mut Self| &mut t.read_write_loop.read_buf,
            cap,
            -1,
        ) {
            let err = rc.to_error(bun_sys::Tag::read).expect("negative rc");
            Self::fail_read_write_loop(this, err);
        }
    }

    /// The rest of the current chunk still to be written.
    fn pending_chunk(&self) -> &[u8] {
        &self.read_write_loop.read_buf[self.read_write_loop.chunk_written..]
    }

    /// On return, libuv has `this` (until `on_fs_write`) or it has finished.
    fn read_write_loop_write(this: Box<Self>) {
        let destination_fd = this.read_write_loop.destination_fd.uv();
        if let Err((this, rc)) = aio::uv_fs::write(this, destination_fd, Self::pending_chunk, -1) {
            let err = rc.to_error(bun_sys::Tag::write).expect("negative rc");
            Self::fail_read_write_loop(this, err);
        }
    }

    fn fail_read_write_loop(mut this: Box<Self>, err: bun_sys::Error) {
        this.err = Some(err);
        Self::on_read_write_loop_complete(this);
    }
}

#[cfg(windows)]
impl ReadWriteLoop {
    pub fn close(&mut self) {
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
impl aio::uv_fs::OnFsRead for CopyFileWindows {
    fn on_fs_read(mut this: Box<Self>, rc: libuv::ReturnCodeI64) {
        let source_fd = this.read_write_loop.source_fd;

        bun_sys::syslog!(
            "uv_fs_read({}, {}) = {}",
            source_fd,
            this.read_write_loop.read_buf.len(),
            rc.int()
        );
        if let Some(err) = rc.to_error(bun_sys::Tag::read) {
            return Self::fail_read_write_loop(this, err);
        }

        // `uv_fs::read` already appended the `rc` bytes to `read_buf`.
        if rc.int() == 0 {
            // Handle EOF. We can't read any more.
            return Self::on_read_write_loop_complete(this);
        }

        // Re-use the fs request.
        this.io_request.deinit();
        Self::read_write_loop_write(this);
    }
}

#[cfg(windows)]
impl aio::uv_fs::OnFsWrite for CopyFileWindows {
    fn on_fs_write(mut this: Box<Self>, rc: libuv::ReturnCodeI64) {
        let buf_len = this.pending_chunk().len();
        let destination_fd = this.read_write_loop.destination_fd;

        bun_sys::syslog!(
            "uv_fs_write({}, {}) = {}",
            destination_fd,
            buf_len,
            rc.int()
        );

        if let Some(err) = rc.to_error(bun_sys::Tag::write) {
            return Self::fail_read_write_loop(this, err);
        }

        let wrote: u32 = u32::try_from(rc.int()).expect("int cast");

        this.read_write_loop.written += wrote as usize;

        if (wrote as usize) < buf_len {
            if wrote == 0 {
                // Handle EOF. We can't write any more.
                return Self::on_read_write_loop_complete(this);
            }

            // Re-use the fs request.
            this.io_request.deinit();
            this.read_write_loop.chunk_written += wrote as usize;
            return Self::read_write_loop_write(this);
        }

        this.io_request.deinit();
        Self::read_write_loop_read(this);
    }
}

#[cfg(windows)]
impl CopyFileWindows {
    /// On return, `this` has settled and been dropped.
    pub(crate) fn on_read_write_loop_complete(mut this: Box<Self>) {
        this.event_loop.unref_keep_alive();

        if let Some(err) = this.err.take() {
            return Self::throw(this, err);
        }

        let written = this.read_write_loop.written;
        Self::on_complete(this, written);
    }

    pub(crate) fn init(
        destination_file_store: RefPtr<Store>,
        source_file_store: RefPtr<Store>,
        event_loop: &jsc::event_loop::EventLoop,
        mkdirp_if_not_exists: bool,
        size_: SizeType,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        // destination_file_store.ref() / source_file_store.ref() — the refs owned here
        let global = event_loop.global_ref();
        let this = Box::new(CopyFileWindows {
            destination_file_store,
            source_file_store,
            promise: jsc::JSPromiseStrong::init(global),
            io_request: bun_core::ffi::zeroed::<libuv::fs_t>(),
            event_loop: bun_ptr::BackRef::new(event_loop),
            mkdirp_if_not_exists,
            destination_mode,
            size: size_,
            written_bytes: 0,
            err: None,
            read_write_loop: ReadWriteLoop::default(),
        });
        let promise = this.promise.value();

        // On error, this settles (and frees) the CopyFileWindows.
        Self::copyfile(this);

        promise
    }

    fn prepare_pathlike(
        pathlike: &PathOrFileDescriptor,
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

    /// On return, `this` is with libuv, the mkdirp hop, or settled.
    fn prepare_read_write_loop(mut this: Box<Self>) {
        // Open the destination first, so that if we need to call
        // mkdirp(), we don't spend extra time opening the file handle for
        // the source.
        let dest_store = this.destination_file_store.clone();
        this.read_write_loop.destination_fd = match Self::prepare_pathlike(
            &dest_store.data.as_file().pathlike,
            &mut this.read_write_loop.must_close_destination_fd,
            false,
        ) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(err) => {
                if this.mkdirp_if_not_exists && err.get_errno() == bun_sys::E::ENOENT {
                    return Self::mkdirp(this);
                }

                return Self::throw(this, err);
            }
        };

        let src_store = this.source_file_store.clone();
        this.read_write_loop.source_fd = match Self::prepare_pathlike(
            &src_store.data.as_file().pathlike,
            &mut this.read_write_loop.must_close_source_fd,
            true,
        ) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(err) => {
                return Self::throw(this, err);
            }
        };

        this.event_loop.ref_keep_alive();
        Self::read_write_loop_start(this);
    }

    /// A path for `pathlike`: its own, or the fd's (into `buf`). `Ok(None)`
    /// when the fd has no path (NUL device, pipe) or is a character device —
    /// the read/write loop handles those.
    fn resolve_copy_path<'a>(
        pathlike: &'a PathOrFileDescriptor,
        buf: &'a mut PathBuffer,
    ) -> bun_sys::Result<Option<&'a bun_core::ZStr>> {
        match pathlike {
            PathOrFileDescriptor::Path(_) => Ok(Some(pathlike.path().slice_z(buf))),
            PathOrFileDescriptor::Fd(fd) => {
                let fd = *fd;
                match bun_sys::File::borrow(&fd).kind()? {
                    bun_sys::FileKind::Directory => Err(bun_sys::Error::from_code(
                        bun_sys::E::EISDIR,
                        bun_sys::Tag::open,
                    )),
                    bun_sys::FileKind::CharacterDevice => Ok(None),
                    _ => {
                        let len = match bun_sys::get_fd_path(fd, buf) {
                            Ok(out) => out.len(),
                            // This case can happen when either:
                            // - NUL device
                            // - Pipe. `cat foo.txt | bun bar.ts`
                            Err(_) => return Ok(None),
                        };
                        buf[len] = 0;
                        Ok(Some(bun_core::ZStr::from_buf(&buf[..], len)))
                    }
                }
            }
        }
    }

    /// On return, `this` is with libuv, the read/write loop, or settled.
    fn copyfile(mut this: Box<Self>) {
        // This is for making it easier for us to test this code path
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE
            .get()
            .unwrap_or(false)
        {
            return Self::prepare_read_write_loop(this);
        }

        let mut pathbuf1 = PathBuffer::uninit();
        let mut pathbuf2 = PathBuffer::uninit();
        // Cloned so the resolved paths borrow the stores, not `this`, which
        // moves into the request below.
        let dest_store = this.destination_file_store.clone();
        let src_store = this.source_file_store.clone();
        let event_loop = this.event_loop;

        let new_path =
            match Self::resolve_copy_path(&dest_store.data.as_file().pathlike, &mut pathbuf1) {
                Ok(Some(p)) => p,
                Ok(None) => return Self::prepare_read_write_loop(this),
                Err(err) => return Self::throw(this, err),
            };
        let old_path =
            match Self::resolve_copy_path(&src_store.data.as_file().pathlike, &mut pathbuf2) {
                Ok(Some(p)) => p,
                Ok(None) => return Self::prepare_read_write_loop(this),
                Err(err) => return Self::throw(this, err),
            };
        this.io_request.loop_ = this.event_loop.uv_loop().cast();

        if let Err((this, rc)) =
            aio::uv_fs::copyfile(this, old_path.as_cstr(), new_path.as_cstr(), 0)
        {
            let mut err = rc.to_error(bun_sys::Tag::copyfile).expect("negative rc");
            // https://github.com/oven-sh/bun/issues/6336
            if err.get_errno() == bun_sys::E::EPERM {
                err = bun_sys::Error::from_code(bun_sys::E::ENOENT, bun_sys::Tag::copyfile);
            }
            return Self::throw(this, err.with_path(old_path.as_bytes()));
        }
        event_loop.ref_keep_alive();
    }

    /// On return, `this` has been dropped.
    pub fn throw(mut this: Box<Self>, err: bun_sys::Error) {
        let global_this = this.event_loop.global_ref();
        // `swap()` releases the Strong's root; the promise cell stays alive on
        // the stack below.
        let promise = JSPromise::opaque_mut(this.promise.swap());
        let err_instance = err.to_js_with_async_stack(global_this, promise);

        let _guard = jsc::VirtualMachine::VirtualMachine::get().enter_event_loop_scope();
        drop(this);
        // This libuv completion is the landing frame for what settling leaves.
        crate::dispatch::fold(promise.reject(global_this, err_instance));
    }

    /// On return, `this` is with libuv (chmod) or settled.
    pub(crate) fn on_complete(this: Box<Self>, written_actual: usize) {
        let mut written = written_actual;
        if written != usize::try_from(this.size).expect("int cast") && this.size != MAX_SIZE {
            this.truncate();
            written = usize::try_from(this.size).expect("int cast");
        }

        // Apply destination mode if specified (async)
        if let Some(mode) = this.destination_mode {
            let dest_store = this.destination_file_store.clone();
            if let PathOrFileDescriptor::Path(p) = &dest_store.data.as_file().pathlike {
                let mut this = this;
                this.written_bytes = written;
                let event_loop = this.event_loop;
                let mut pathbuf = PathBuffer::uninit();
                let path = p.slice_z(&mut pathbuf);
                this.io_request.deinit();
                this.io_request = bun_core::ffi::zeroed::<libuv::fs_t>();
                this.io_request.loop_ = this.event_loop.uv_loop().cast();

                if let Err((this, rc)) =
                    aio::uv_fs::chmod(this, path.as_cstr(), i32::try_from(mode).expect("int cast"))
                {
                    // chmod failed to start - reject the promise to report the error.
                    let err = rc
                        .to_error(bun_sys::Tag::chmod)
                        .expect("negative rc")
                        .with_path(p.slice());
                    return Self::throw(this, err);
                }
                event_loop.ref_keep_alive();
                return;
            }
        }

        Self::resolve_promise(this, written);
    }

    /// On return, `this` has been dropped.
    fn resolve_promise(mut this: Box<Self>, written: usize) {
        let global_this = this.event_loop.global_ref();
        // see `throw` — re-type the GC cell via the ZST opaque deref so it
        // outlives `this` for borrowck.
        let promise = JSPromise::opaque_mut(this.promise.swap());
        let _guard = jsc::VirtualMachine::VirtualMachine::get().enter_event_loop_scope();

        drop(this);
        // As in `throw`: folded at this libuv completion.
        crate::dispatch::fold(
            promise.resolve(global_this, JSValue::js_number_from_uint64(written as u64)),
        );
    }

    #[cold]
    fn truncate(&self) {
        // TODO: optimize this

        let mut node_fs_ = node_fs::NodeFS::default();
        let _ = node_fs_.truncate(
            &node_fs::Arguments::Truncate {
                path: self.destination_file_store.data.as_file().pathlike.clone(),
                len: u64::try_from(self.size).expect("int cast"),
                flags: 0,
            },
            node_fs::Flavor::Sync,
        );
    }

    /// On return, `this` is with the mkdirp hop or settled.
    fn mkdirp(mut this: Box<Self>) {
        bun_sys::syslog!("mkdirp");
        this.mkdirp_if_not_exists = false;
        let dest_store = this.destination_file_store.clone();
        let destination = dest_store.data.as_file();
        if !matches!(destination.pathlike, PathOrFileDescriptor::Path(_)) {
            return Self::throw(
                this,
                bun_sys::Error {
                    errno: bun_sys::SystemErrno::EINVAL as u16,
                    syscall: bun_sys::Tag::mkdir,
                    ..Default::default()
                },
            );
        }
        let path_slice = destination.pathlike.path().slice();
        // BORROW: not owned — `destination_file_store` (and thus its path) is held in
        // `this`, which the mkdirp completion gets back before anything is freed.
        let path = bun_paths::dirname(path_slice)
            // this shouldn't happen
            .unwrap_or(path_slice) as *const [u8];

        this.event_loop.ref_keep_alive();
        node_fs::async_::AsyncMkdirp::schedule(
            this,
            path,
            jsc::VirtualMachine::VirtualMachine::get().ticket(),
        );
    }
}

#[cfg(windows)]
impl aio::uv_fs::OnFsCopyfile for CopyFileWindows {
    fn on_fs_copyfile(mut this: Box<Self>, rc: libuv::ReturnCodeI64) {
        this.event_loop.unref_keep_alive();

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
                return Self::mkdirp(this);
            }

            let mut err = bun_sys::Error::from_code(
                // #6336
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

            return Self::throw(this, err);
        }

        let size = this.io_request.statbuf.size();
        Self::on_complete(this, size as usize);
    }
}

#[cfg(windows)]
impl aio::uv_fs::OnFsChmod for CopyFileWindows {
    fn on_fs_chmod(this: Box<Self>, rc: libuv::ReturnCodeI64) {
        this.event_loop.unref_keep_alive();

        if let Some(mut err) = rc.to_error(bun_sys::Tag::chmod) {
            if let PathOrFileDescriptor::Path(p) =
                &this.destination_file_store.data.as_file().pathlike
            {
                err = err.with_path(p.slice());
            }
            return Self::throw(this, err);
        }

        let written = this.written_bytes;
        Self::resolve_promise(this, written);
    }
}

/// JS thread: the mkdirp hop came back.
#[cfg(windows)]
impl node_fs::async_::MkdirpCompletion for Box<CopyFileWindows> {
    fn on_mkdirp_done(self, result: bun_sys::Maybe<()>) {
        bun_sys::syslog!("mkdirp complete");
        self.event_loop.unref_keep_alive();

        debug_assert!(self.err.is_none());
        if let Err(err) = result {
            // `bun_sys::Error.path` is an owned `Box<[u8]>` and is dropped with
            // `err` inside `throw`.
            return CopyFileWindows::throw(self, err);
        }

        CopyFileWindows::copyfile(self);
    }
}

#[cfg(windows)]
impl Drop for CopyFileWindows {
    fn drop(&mut self) {
        self.read_write_loop.close();
        // destination_file_store.deref() / source_file_store.deref() — RefPtr<Store> Drop
        // promise.deinit() — handled by JSPromiseStrong's Drop
        self.io_request.deinit();
    }
}

// ───────────────────────────────────────────────────────────────────────────
// IOWhich + module-level constants
// ───────────────────────────────────────────────────────────────────────────

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
pub enum IOWhich {
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
