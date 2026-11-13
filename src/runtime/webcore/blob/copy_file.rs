//! blocking, but off the main thread

use crate::node::fs as node_fs;
use crate::node::types::PathLikeExt as _;
#[cfg(not(windows))]
use crate::webcore::blob::{self, MkdirpTarget, Retry, store};
use crate::webcore::blob::{MAX_SIZE, SizeType, Store};
use crate::webcore::node_types::PathOrFileDescriptor;
#[cfg(windows)]
use bun_io::{self as aio, IntrusiveUvFs as _};
#[cfg(not(windows))]
use bun_jsc::JSGlobalObject;
use bun_jsc::{self as jsc, JSPromise, JSValue};
#[cfg(not(windows))]
use bun_paths::PathBuffer;
use bun_ptr::RefPtr;
#[cfg(windows)]
use bun_sys::FdExt as _;
#[cfg(not(windows))]
use bun_sys::File;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(not(windows))]
use bun_sys::Stat;
#[cfg(not(windows))]
use bun_sys::SystemError;
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self, Fd, Mode};
#[cfg(windows)]
use bun_sys_jsc::ErrorJsc as _;
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::ffi::c_int;
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::marker::ConstParamTy;

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
        if let PathOrFileDescriptor::Path(path) = &self.destination_file_store.pathlike {
            crate::node::fs::note_opened_for_write(path.slice(), true);
        }

        promise.resolve(
            global_this,
            JSValue::js_number_from_uint64(self.read_len as u64),
        )
    }

    fn apply_destination_mode(&mut self) {
        // Apply destination mode using fchmod before closing.
        // This ensures mode is applied even when overwriting existing files, since
        // open()'s mode argument only affects newly created files.
        // On macOS clonefile path, chmod is called separately after clonefile.
        if let Some(mode) = self.destination_mode {
            if self.system_error.is_none() {
                match bun_sys::fchmod(self.destination_fd, mode) {
                    bun_sys::Result::Err(err) => {
                        self.system_error = Some(err.to_system_error());
                    }
                    bun_sys::Result::Ok(()) => {}
                }
            }
        }
    }

    fn open_source(&mut self, path_buf: &mut PathBuffer) -> Option<File> {
        let path = self.source_file_store.pathlike.path().slice_z(path_buf);
        match File::open(path, OPEN_SOURCE_FLAGS, 0) {
            Ok(file) => Some(file),
            Err(errno) => {
                self.system_error = Some(errno.to_system_error());
                None
            }
        }
    }

    fn open_destination(&mut self, path_buf: &mut PathBuffer) -> Option<File> {
        loop {
            // Not `slice_z`: `dest` must not borrow `self`.
            let dest_len = {
                let s = self.destination_file_store.pathlike.path().slice();
                let n = s.len().min(path_buf.len() - 1);
                path_buf[..n].copy_from_slice(&s[..n]);
                path_buf[n] = 0;
                n
            };
            let dest: &bun_core::ZStr = bun_core::ZStr::from_buf(&path_buf[..], dest_len);
            let mode = self.destination_mode.unwrap_or(node_fs::DEFAULT_PERMISSION);
            let errno = match File::open(dest, OPEN_DESTINATION_FLAGS, mode) {
                Ok(file) => return Some(file),
                Err(errno) => errno,
            };
            match blob::mkdir_if_not_exists(self, &errno, dest, dest.as_bytes()) {
                Retry::Continue => continue,
                Retry::Fail => return None,
                Retry::No => {}
            }

            self.system_error = Some(
                errno
                    .with_path(self.destination_file_store.pathlike.path().slice())
                    .to_system_error(),
            );
            return None;
        }
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
            self.destination_file_store.pathlike,
            PathOrFileDescriptor::Path(_)
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
        let mut total_written = 0;
        let result = self.copy_file_range_loop::<USE, CLEAR_APPEND_IF_INVALID>(&mut total_written);
        self.read_len = total_written;
        result
    }

    /// Adds what it copies to `total_written`, also when it fails.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn copy_file_range_loop<const USE: TryWith, const CLEAR_APPEND_IF_INVALID: bool>(
        &mut self,
        total_written: &mut SizeType,
    ) -> Result<(), crate::Error> {
        use bun_sys::linux;

        let mut remain: usize = self.max_length as usize;
        let unknown_size = remain == MAX_SIZE as usize || remain == 0;
        if unknown_size {
            // fstat on a FIFO / char device / socket legitimately reports
            // st_size == 0. In that case `remain` is only the per-call chunk
            // size; the loop below keeps going until the kernel reports EOF
            // (written == 0). 64 KiB matches the read/write-loop fallback.
            remain = 64 * 1024;
        }

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
                TryWith::CopyFileRange => {
                    linux::copy_file_range(src_fd.native(), None, dest_fd.native(), None, remain, 0)
                }
                TryWith::Sendfile => {
                    linux::sendfile(dest_fd.native(), src_fd.native(), None, remain)
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
                            0,
                        )
                    }
                }
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
                            // SAFETY: dest_fd is a valid open fd; raw fcntl(2).
                            let flags =
                                unsafe { libc::fcntl(dest_fd.native(), libc::F_GETFL, 0 as c_int) };
                            if (flags & bun_sys::O::APPEND) != 0 {
                                // SAFETY: dest_fd is a valid open fd; raw fcntl(2).
                                let _ = unsafe {
                                    libc::fcntl(
                                        dest_fd.native(),
                                        libc::F_SETFL,
                                        flags ^ bun_sys::O::APPEND,
                                    )
                                };
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

        // clonefile() is the fastest way to copy a file, so it goes first.
        #[cfg(target_os = "macos")]
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
                            && self.max_length < SizeType::try_from(stat_size).expect("int cast")
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
                            self.read_len = SizeType::try_from(self.max_length).expect("int cast");
                        } else {
                            self.read_len = SizeType::try_from(stat_size).expect("int cast");
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
                        // The destination may exist or be on a network volume: go on to fcopyfile.
                        self.system_error = None;
                    }
                }
            }
        }

        let mut source: Option<File> = None;
        let mut destination: Option<File> = None;
        if self.source_fd == Fd::INVALID || self.destination_fd == Fd::INVALID {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            // Source first: if it fails, no destination file is left behind.
            if self.source_fd == Fd::INVALID {
                let Some(file) = self.open_source(&mut path_buf) else {
                    return;
                };
                self.source_fd = source.insert(file).fd();
            }
            if self.destination_fd == Fd::INVALID {
                let Some(file) = self.open_destination(&mut path_buf) else {
                    return;
                };
                self.destination_fd = destination.insert(file).fd();
            }
        }

        let stat: Stat = match stat_ {
            Some(s) => s,
            None => match bun_sys::fstat(self.source_fd) {
                bun_sys::Result::Ok(result) => result,
                bun_sys::Result::Err(err) => {
                    self.apply_destination_mode();
                    self.system_error = Some(err.to_system_error());
                    return;
                }
            },
        };

        self.copy_opened(&stat);
        self.apply_destination_mode();
    }

    fn copy_opened(&mut self, stat: &Stat) {
        if bun_sys::S::ISDIR(stat.st_mode as _) {
            self.system_error = Some(unsupported_directory_error());
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
            // Bun.write(Bun.file("a"), Bun.file("b"))
            if bun_sys::S::ISREG(stat.st_mode as _)
                && (bun_sys::S::ISREG(self.destination_file_store.mode as _)
                    || self.destination_file_store.mode == 0)
            {
                if self.destination_file_store.is_atty.unwrap_or(false) {
                    let _ = self.do_copy_file_range::<{ TryWith::CopyFileRange }, true>();
                } else {
                    let _ = self.do_copy_file_range::<{ TryWith::CopyFileRange }, false>();
                }

                return;
            }

            // $ bun run foo.js | bun run bar.js
            if bun_sys::S::ISFIFO(stat.st_mode as _)
                && bun_sys::S::ISFIFO(self.destination_file_store.mode as _)
            {
                if self.destination_file_store.is_atty.unwrap_or(false) {
                    let _ = self.do_copy_file_range::<{ TryWith::Splice }, true>();
                } else {
                    let _ = self.do_copy_file_range::<{ TryWith::Splice }, false>();
                }

                return;
            }

            if bun_sys::S::ISREG(stat.st_mode as _)
                || bun_sys::S::ISCHR(stat.st_mode as _)
                || bun_sys::S::ISSOCK(stat.st_mode as _)
            {
                if self.destination_file_store.is_atty.unwrap_or(false) {
                    let _ = self.do_copy_file_range::<{ TryWith::Sendfile }, true>();
                } else {
                    let _ = self.do_copy_file_range::<{ TryWith::Sendfile }, false>();
                }

                return;
            }

            self.system_error = Some(unsupported_non_regular_file_error());
            return;
        }

        #[cfg(target_os = "macos")]
        {
            // fcopyfile rewrites dest from offset 0 and the slice trim is
            // ftruncate; both are only safe for a dest Bun opened O_TRUNC.
            if matches!(
                self.destination_file_store.pathlike,
                PathOrFileDescriptor::Path(_)
            ) {
                let copied = match self.do_fcopy_file_with_read_write_loop_fallback(
                    u64::try_from(stat.st_size).expect("int cast"),
                ) {
                    Ok(copied) => copied,
                    Err(_) => return,
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
            } else {
                let _ = self.do_read_write_loop_capped(self.max_length);
            }

            return;
        }

        #[cfg(target_os = "freebsd")]
        {
            if matches!(
                self.destination_file_store.pathlike,
                PathOrFileDescriptor::Path(_)
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
            } else {
                let _ = self.do_read_write_loop_capped(self.max_length);
            }
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

#[cfg(not(windows))]
const OPEN_DESTINATION_FLAGS: i32 =
    bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC;
#[cfg(not(windows))]
const OPEN_SOURCE_FLAGS: i32 = bun_sys::O::CLOEXEC | bun_sys::O::RDONLY;

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
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

/// One owner at a time: a `Box` here, or libuv and the pool while they work for it.
#[cfg(windows)]
pub(crate) struct CopyFileWindows {
    pub(crate) destination_file_store: RefPtr<Store>,
    pub(crate) source_file_store: RefPtr<Store>,

    pub(crate) io_request: libuv::fs_t,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) mkdirp_if_not_exists: bool,
    pub(crate) destination_mode: Option<Mode>,
    pub(crate) event_loop: &'static jsc::event_loop::EventLoop,
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
bun_io::intrusive_uv_fs!(CopyFileWindows, io_request);

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

#[cfg(windows)]
impl CopyFileWindows {
    fn read_write_loop_read(mut self: Box<Self>) {
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
        let this = bun_core::heap::into_raw(self);
        // SAFETY: the VM's loop outlives the request, which is zeroed or cleaned up. libuv has
        // `this`, whose `uv_buf` is the capacity of its `read_buf`, until `on_read`.
        let rc = unsafe {
            libuv::uv_fs_read(
                loop_,
                &raw mut (*this).io_request,
                source_fd.uv(),
                &raw const (*this).read_write_loop.uv_buf,
                1,
                -1,
                Some(on_read),
            )
        };
        if let Some(err) = rc.to_error(bun_sys::Tag::read) {
            // SAFETY: libuv keeps nothing of a request that it refuses.
            unsafe { bun_core::heap::take(this) }.on_read_write_loop_complete(Err(err));
        }
    }

    fn read_write_loop_write(mut self: Box<Self>) {
        let destination_fd = self.read_write_loop.destination_fd;
        let loop_ = self.event_loop.uv_loop();

        // Re-use the fs request.
        self.io_request.deinit();
        let this = bun_core::heap::into_raw(self);
        // SAFETY: the VM's loop outlives the request. libuv has `this`, whose `uv_buf` points into
        // its `read_buf`, until `on_write`.
        let rc = unsafe {
            libuv::uv_fs_write(
                loop_,
                &raw mut (*this).io_request,
                destination_fd.uv(),
                &raw const (*this).read_write_loop.uv_buf,
                1,
                -1,
                Some(on_write),
            )
        };
        if let Some(err) = rc.to_error(bun_sys::Tag::write) {
            // SAFETY: libuv keeps nothing of a request that it refuses.
            unsafe { bun_core::heap::take(this) }.on_read_write_loop_complete(Err(err));
        }
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
    // SAFETY: `req` is the `io_request` of the box that `read_write_loop_read` left to libuv.
    let mut this = unsafe { bun_core::heap::take(CopyFileWindows::from_uv_fs(req)) };

    let source_fd = this.read_write_loop.source_fd;
    // reshaped for borrowck — `read_buf.items` is `Vec` len-slice.
    let read_buf = &mut this.read_write_loop.read_buf;

    let rc = this.io_request.result;

    bun_sys::syslog!(
        "uv_fs_read({}, {}) = {}",
        source_fd,
        read_buf.len(),
        rc.int()
    );
    if let Some(err) = rc.to_error(bun_sys::Tag::read) {
        this.on_read_write_loop_complete(Err(err));
        return;
    }

    let n = usize::try_from(rc.int()).expect("int cast");
    // SAFETY: libuv wrote `n` bytes into the buffer's capacity.
    unsafe { read_buf.set_len(n) };
    this.read_write_loop.uv_buf = libuv::uv_buf_t::init(read_buf.as_slice());

    if rc.int() == 0 {
        // Handle EOF. We can't read any more.
        this.on_read_write_loop_complete(Ok(()));
        return;
    }

    this.read_write_loop_write();
}

#[cfg(windows)]
extern "C" fn on_write(req: *mut libuv::fs_t) {
    // SAFETY: `req` is the `io_request` of the box that `read_write_loop_write` left to libuv.
    let mut this = unsafe { bun_core::heap::take(CopyFileWindows::from_uv_fs(req)) };
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
        this.on_read_write_loop_complete(Err(err));
        return;
    }

    let wrote: u32 = u32::try_from(rc.int()).expect("int cast");

    this.read_write_loop.written += wrote as usize;

    if (wrote as usize) < buf_len {
        if wrote == 0 {
            // Handle EOF. We can't write any more.
            this.on_read_write_loop_complete(Ok(()));
            return;
        }

        let prev = this.read_write_loop.uv_buf.slice();
        this.read_write_loop.uv_buf = libuv::uv_buf_t::init(&prev[wrote as usize..]);
        this.read_write_loop_write();
        return;
    }

    this.io_request.deinit();
    this.read_write_loop_read();
}

#[cfg(windows)]
impl CopyFileWindows {
    fn on_read_write_loop_complete(self: Box<Self>, result: bun_sys::Result<()>) {
        self.event_loop.unref_keep_alive();

        if let Err(err) = result {
            self.throw(err);
            return;
        }

        let written = self.read_write_loop.written;
        self.on_complete(written);
    }

    pub(crate) fn init(
        destination_file_store: RefPtr<Store>,
        source_file_store: RefPtr<Store>,
        event_loop: &'static jsc::event_loop::EventLoop,
        context: &jsc::ScriptExecutionContext,
        mkdirp_if_not_exists: bool,
        size_: SizeType,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        // destination_file_store.ref() / source_file_store.ref() — Arc clone
        let global = event_loop.global_ref();
        let result = Box::new(CopyFileWindows {
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
        });
        let promise = result.promise.value();

        result.copyfile();

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

    fn prepare_read_write_loop(mut self: Box<Self>) {
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

        self.read_write_loop.read_buf.reserve_exact(64 * 1024);

        self.event_loop.ref_keep_alive();
        self.read_write_loop_read();
    }

    fn copyfile(self: Box<Self>) {
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
                PathOrFileDescriptor::Path(path) => {
                    // In the buffer: it is read again after `self` is given up.
                    let len = path.slice_z_with_force_copy::<true>(&mut pathbuf2).len();
                    break 'brk bun_core::ZStr::from_buf(&pathbuf2[..], len);
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
        let new_path = new_path.as_ptr();
        let event_loop = self.event_loop;
        let this = bun_core::heap::into_raw(self);
        // SAFETY: the VM's loop outlives the request, libuv copies the NUL-terminated paths before
        // it returns, and it has `this` until `on_copy_file`.
        let rc = unsafe {
            libuv::uv_fs_copyfile(
                event_loop.uv_loop(),
                &raw mut (*this).io_request,
                old_path.as_ptr(),
                new_path,
                0,
                Some(on_copy_file),
            )
        };

        if let Some(mut err) = rc.to_error(bun_sys::Tag::copyfile) {
            // https://github.com/oven-sh/bun/issues/6336
            if err.get_errno() == bun_sys::E::EPERM {
                err = bun_sys::Error::from_code(bun_sys::E::ENOENT, bun_sys::Tag::copyfile);
            }
            // SAFETY: libuv keeps nothing of a request that it refuses.
            unsafe { bun_core::heap::take(this) }.throw(err.with_path(old_path.as_bytes()));
            return;
        }
        event_loop.ref_keep_alive();
    }

    fn throw(mut self: Box<Self>, err: bun_sys::Error) {
        let _context = jsc::virtual_machine::VirtualMachine::get().enter_context(self.context);
        let global_this = self.event_loop.global_ref();
        // A GC cell: not tied to `self`, which is dropped before it is settled.
        let promise = JSPromise::opaque_mut(self.promise.swap());
        let err_instance = err.to_js_with_async_stack(global_this, promise);

        let _guard = self.event_loop.enter_scope();
        drop(self);
        // This libuv completion is the landing frame for what settling leaves.
        crate::dispatch::fold(promise.reject(global_this, err_instance));
    }

    fn on_complete(mut self: Box<Self>, written_actual: usize) {
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
                let path_ptr = self
                    .destination_file_store
                    .data
                    .as_file()
                    .pathlike
                    .path()
                    .slice_z(&mut pathbuf)
                    .as_ptr();
                let event_loop = self.event_loop;
                self.io_request.deinit();
                // SAFETY: all-zero is a valid libuv::fs_t
                self.io_request = bun_core::ffi::zeroed::<libuv::fs_t>();

                let this = bun_core::heap::into_raw(self);
                // SAFETY: the VM's loop outlives the request, libuv copies the NUL-terminated path
                // before it returns, and it has `this` until `on_chmod`.
                let rc = unsafe {
                    libuv::uv_fs_chmod(
                        event_loop.uv_loop(),
                        &raw mut (*this).io_request,
                        path_ptr,
                        i32::try_from(mode).expect("int cast"),
                        Some(on_chmod),
                    )
                };

                // chmod failed to start - reject the promise to report the error.
                if let Some(mut err) = rc.to_error(bun_sys::Tag::chmod) {
                    // SAFETY: libuv keeps nothing of a request that it refuses.
                    let this = unsafe { bun_core::heap::take(this) };
                    let destination = &this.destination_file_store.data.as_file();
                    if let PathOrFileDescriptor::Path(p) = &destination.pathlike {
                        err = err.with_path(p.slice());
                    }
                    this.throw(err);
                    return;
                }
                event_loop.ref_keep_alive();
                return;
            }
        }

        self.resolve_promise(written);
    }

    fn resolve_promise(mut self: Box<Self>, written: usize) {
        if let PathOrFileDescriptor::Path(path) =
            &self.destination_file_store.data.as_file().pathlike
        {
            crate::node::fs::note_opened_for_write(path.slice(), true);
        }
        let _context = jsc::virtual_machine::VirtualMachine::get().enter_context(self.context);
        let global_this = self.event_loop.global_ref();
        // A GC cell: not tied to `self`, which is dropped before it is settled.
        let promise = JSPromise::opaque_mut(self.promise.swap());
        let _guard = self.event_loop.enter_scope();

        drop(self);
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

    fn mkdirp(mut self: Box<Self>) {
        bun_sys::syslog!("mkdirp");
        self.mkdirp_if_not_exists = false;
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
            // BORROW: points into `destination_file_store`, alive until `completion` runs.
            bun_paths::dirname(path_slice)
                // this shouldn't happen
                .unwrap_or(path_slice) as *const [u8]
        };

        self.event_loop.ref_keep_alive();
        node_fs::async_::AsyncMkdirp::schedule(node_fs::async_::AsyncMkdirp {
            completion: on_mkdirp_complete_concurrent,
            completion_ctx: bun_core::heap::into_raw(self).cast::<()>(),
            path,
            ticket: jsc::VirtualMachine::VirtualMachine::get().ticket(),
            task: Default::default(),
        });
    }

    pub(crate) fn on_mkdirp_complete(mut self: Box<Self>) {
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
impl Drop for CopyFileWindows {
    fn drop(&mut self) {
        self.read_write_loop.close();
        self.io_request.deinit();
    }
}

#[cfg(windows)]
extern "C" fn on_copy_file(req: *mut libuv::fs_t) {
    // SAFETY: `req` is the `io_request` of the box that `copyfile` left to libuv.
    let mut this = unsafe { bun_core::heap::take(CopyFileWindows::from_uv_fs(req)) };

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
    // SAFETY: `req` is the `io_request` of the box that `on_complete` left to libuv.
    let this = unsafe { bun_core::heap::take(CopyFileWindows::from_uv_fs(req)) };

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

    let written = this.written_bytes;
    this.resolve_promise(written);
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
        ctx.cast::<CopyFileWindows>(),
    ));
}

/// `mkdirp` finished on the work pool: the hop back to the JS thread.
#[cfg(windows)]
impl bun_event_loop::Taskable for CopyFileWindows {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::CopyFileWindowsMkdirp;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract: the box that `on_mkdirp_complete_concurrent` posted.
        let this = unsafe { bun_core::heap::take(this) };
        this.event_loop.unref_keep_alive();
    }
    /// Enters no context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Module-level constants
// ───────────────────────────────────────────────────────────────────────────

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
