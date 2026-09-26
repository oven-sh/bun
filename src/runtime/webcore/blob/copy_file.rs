//! blocking, but off the main thread

use crate::node::fs as node_fs;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::{self, Retry};
use crate::webcore::blob::{MAX_SIZE, MkdirpTarget, SizeType, Store, store};
use crate::webcore::node_types::PathOrFileDescriptor;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue};
use bun_ptr::RefPtr;
use bun_sys::Stat;
use bun_sys::{self, Fd, FdExt, Mode, SystemError};
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::ffi::c_int;
use core::marker::ConstParamTy;

// ───────────────────────────────────────────────────────────────────────────
// CopyFile (blocking off-thread)
// ───────────────────────────────────────────────────────────────────────────

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
unsafe impl Send for CopyFile {}

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
            // Windows `fchmod` reopens the file by its handle, which a pipe or
            // a console refuses: there the mode is for a destination opened
            // by path, which is a disk file.
            let has_mode = cfg!(not(windows))
                || matches!(
                    self.destination_file_store.pathlike,
                    PathOrFileDescriptor::Path(_)
                );
            if has_mode && self.destination_fd != Fd::INVALID && self.system_error.is_none() {
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

    pub(crate) fn do_open_file<const WHICH: IOWhich>(&mut self) -> Result<(), crate::Error> {
        let mut path_buf1 = bun_paths::path_buffer_pool::get();
        // open source file first
        // if it fails, we don't want the extra destination file hanging out
        if matches!(WHICH, IOWhich::Both | IOWhich::Source) {
            self.source_fd = match bun_sys::open(
                self.source_file_store
                    .pathlike
                    .path()
                    .slice_z_as_written(&mut path_buf1),
                OPEN_SOURCE_FLAGS,
                0,
            ) {
                bun_sys::Result::Ok(result) => result,
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
                    let s = self.destination_file_store.pathlike.path().slice();
                    let n = s.len().min(path_buf1.len() - 1);
                    path_buf1[..n].copy_from_slice(&s[..n]);
                    path_buf1[n] = 0;
                    n
                };
                // SAFETY: path_buf1[dest_len] == 0 written above.
                let dest: &bun_core::ZStr = bun_core::ZStr::from_buf(&path_buf1[..], dest_len);
                let mode = self.destination_mode.unwrap_or(node_fs::DEFAULT_PERMISSION);
                match bun_sys::open(dest, OPEN_DESTINATION_FLAGS, mode) {
                    bun_sys::Result::Ok(result) => self.destination_fd = result,
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
                                .with_path(self.destination_file_store.pathlike.path().slice())
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

        let mut has_unset_append = false;

        // If they can't use copy_file_range, they probably also can't
        // use sendfile() or splice()
        if !bun_sys::copy_file::can_use_copy_file_range_syscall() {
            return self.fallback_read_write(remain, unknown_size, &mut total_written);
        }

        loop {
            // TODO: this should use non-blocking I/O.
            let written: isize = match USE {
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
                    return self.fallback_read_write(remain, unknown_size, &mut total_written);
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
                    if total_written == 0 {
                        // TODO: this should use non-blocking I/O.
                        return self.fallback_read_write(remain, unknown_size, &mut total_written);
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

    #[cfg(any(target_os = "macos", target_os = "freebsd", windows))]
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
                .slice_z_as_written(&mut dest_buf)
                .len();
            // SAFETY: `slice_z` wrote `dest_len` bytes + NUL into `dest_buf`.
            let dest = bun_core::ZStr::from_buf(&dest_buf[..], dest_len);
            match bun_sys::clonefile(
                self.source_file_store
                    .pathlike
                    .path()
                    .slice_z_as_written(&mut source_buf),
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
        // `BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE` skips `CopyFileW`, so that
        // the handle-to-handle loop below can be tested with two paths.
        #[cfg(windows)]
        if !bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE
            .get()
            .unwrap_or(false)
        {
            match copy_by_path(
                &self.destination_file_store,
                &self.source_file_store,
                &mut self.mkdirp_if_not_exists,
                self.max_length,
                self.destination_mode,
            ) {
                CopyByPath::Copied(len) => {
                    self.read_len = len;
                    return;
                }
                CopyByPath::Failed(err) => {
                    self.system_error = Some(err);
                    return;
                }
                CopyByPath::Unavailable => {}
            }
        }

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

        // Do we need to open both files?
        if self.destination_fd == Fd::INVALID && self.source_fd == Fd::INVALID {
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
                                .slice_z_as_written(&mut path_buf),
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
                                                .slice_z_as_written(&mut path_buf)
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
                                            .slice_z_as_written(&mut path_buf),
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
            self.source_fd = self.source_file_store.pathlike.fd();

            if self.do_open_file::<{ IOWhich::Destination }>().is_err() {
                return;
            }
            // Do we need to open only one file?
        } else if self.source_fd == Fd::INVALID {
            self.destination_fd = self.destination_file_store.pathlike.fd();

            if self.do_open_file::<{ IOWhich::Source }>().is_err() {
                return;
            }
        }

        if self.system_error.is_some() {
            return;
        }

        debug_assert!(self.destination_fd.is_valid());
        debug_assert!(self.source_fd.is_valid());

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

                self.do_close();
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

                self.do_close();
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
                self.destination_file_store.pathlike,
                PathOrFileDescriptor::Path(_)
            ) {
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

        #[cfg(windows)]
        {
            let _ = self.do_read_write_loop_capped(self.max_length);
            self.do_close();
        }
    }
}

#[cfg(windows)]
enum CopyByPath {
    /// The number of bytes now in the destination.
    Copied(SizeType),
    /// A side has no path (a pipe, a console, the NUL device): copy through
    /// handles instead.
    Unavailable,
    Failed(SystemError),
}

/// The NUL-terminated path `CopyFileW` can name `pathlike` by, if it has one.
#[cfg(windows)]
fn copyable_path<'a>(
    pathlike: &'a PathOrFileDescriptor<'static>,
    buf: &'a mut bun_paths::PathBuffer,
) -> bun_sys::Result<Option<&'a bun_core::ZStr>> {
    match pathlike {
        PathOrFileDescriptor::Path(path) => Ok(Some(path.slice_z_as_written(buf))),
        PathOrFileDescriptor::Fd(fd) => match bun_sys::File::borrow(fd).kind()? {
            bun_sys::FileKind::Directory => Err(bun_sys::Error::from_code(
                bun_sys::E::EISDIR,
                bun_sys::Tag::open,
            )),
            bun_sys::FileKind::CharacterDevice => Ok(None),
            _ => {
                let Ok(len) = bun_sys::get_fd_path(*fd, buf).map(|path| path.len()) else {
                    return Ok(None);
                };
                buf[len] = 0;
                // SAFETY: buf[len] == 0 written above.
                Ok(Some(bun_core::ZStr::from_buf(&buf[..], len)))
            }
        },
    }
}

#[cfg(windows)]
fn error_with_pathlike(
    err: bun_sys::Error,
    pathlike: &PathOrFileDescriptor<'static>,
) -> SystemError {
    match pathlike {
        PathOrFileDescriptor::Path(path) => err.with_path(path.slice()),
        PathOrFileDescriptor::Fd(fd) => err.with_fd(*fd),
    }
    .to_system_error()
}

/// Copies with `CopyFileW` when both sides have a path.
#[cfg(windows)]
fn copy_by_path(
    destination: &store::File,
    source: &store::File,
    mkdirp_if_not_exists: &mut bool,
    max_length: SizeType,
    destination_mode: Option<Mode>,
) -> CopyByPath {
    use bun_sys::E;
    use bun_sys::windows as w;

    let mut dest_buf = bun_paths::path_buffer_pool::get();
    let mut source_buf = bun_paths::path_buffer_pool::get();
    let dest_path = match copyable_path(&destination.pathlike, &mut dest_buf) {
        Ok(Some(path)) => path,
        Ok(None) => return CopyByPath::Unavailable,
        Err(err) => return CopyByPath::Failed(err.to_system_error()),
    };
    let source_path = match copyable_path(&source.pathlike, &mut source_buf) {
        Ok(Some(path)) => path,
        Ok(None) => return CopyByPath::Unavailable,
        Err(err) => return CopyByPath::Failed(err.to_system_error()),
    };
    // Named as every other `Bun.file` call names them.
    let dest_w = match w::fs::WPath::new(dest_path.as_bytes()) {
        Ok(path) => path,
        Err(err) => {
            let err = bun_sys::Error::from_win32(err, bun_sys::Tag::copyfile);
            return CopyByPath::Failed(error_with_pathlike(err, &destination.pathlike));
        }
    };
    let source_w = match w::fs::WPath::new(source_path.as_bytes()) {
        Ok(path) => path,
        Err(err) => {
            let err = bun_sys::Error::from_win32(err, bun_sys::Tag::copyfile);
            return CopyByPath::Failed(error_with_pathlike(err, &source.pathlike));
        }
    };

    loop {
        // SAFETY: both paths are NUL-terminated.
        if unsafe { w::CopyFileW(source_w.as_ptr(), dest_w.as_ptr(), 0) } != 0 {
            break;
        }
        let err = bun_sys::Error::from_win32(w::Win32Error::get(), bun_sys::Tag::copyfile);
        match err.get_errno() {
            // Both sides are the same file: nothing to copy, as in libuv's
            // uv_fs_copyfile.
            E::EBUSY => {
                if let (Ok(a), Ok(b)) = (bun_sys::stat(source_path), bun_sys::stat(dest_path)) {
                    if a.st_dev == b.st_dev && a.st_ino == b.st_ino {
                        break;
                    }
                }
            }
            // Either the source or the destination's directory is missing.
            E::ENOENT => {
                let source_missing = matches!(source.pathlike, PathOrFileDescriptor::Path(_))
                    && matches!(
                        bun_sys::access(source_path, 0),
                        Err(e) if e.get_errno() == E::ENOENT
                    );
                if source_missing {
                    return CopyByPath::Failed(error_with_pathlike(err, &source.pathlike));
                }
                if *mkdirp_if_not_exists {
                    *mkdirp_if_not_exists = false;
                    match blob::mkdirp_parent(dest_path.as_bytes()) {
                        Ok(()) => continue,
                        Err(mkdir_err) => return CopyByPath::Failed(mkdir_err.to_system_error()),
                    }
                }
            }
            // A source that is a directory is refused this way.
            E::EPERM => {
                if matches!(bun_sys::stat(source_path), Ok(stat) if bun_sys::S::ISDIR(stat.st_mode as u32))
                {
                    return CopyByPath::Failed(unsupported_directory_error());
                }
            }
            _ => {}
        }
        // A source that does not open for reading is the side that failed.
        // SAFETY: the path is NUL-terminated; no security attributes or template.
        let source_handle = unsafe {
            w::CreateFileW(
                source_w.as_ptr(),
                w::GENERIC_READ,
                w::FILE_SHARE_READ | w::FILE_SHARE_WRITE | w::FILE_SHARE_DELETE,
                core::ptr::null_mut(),
                w::OPEN_EXISTING,
                0,
                core::ptr::null_mut(),
            )
        };
        if source_handle == w::INVALID_HANDLE_VALUE {
            return CopyByPath::Failed(error_with_pathlike(err, &source.pathlike));
        }
        // SAFETY: a handle this function opened.
        unsafe { w::CloseHandle(source_handle) };
        return CopyByPath::Failed(error_with_pathlike(err, &destination.pathlike));
    }

    let size = match &destination.pathlike {
        PathOrFileDescriptor::Path(_) => bun_sys::stat(dest_path),
        PathOrFileDescriptor::Fd(fd) => bun_sys::fstat(*fd),
    };
    let mut copied = match size {
        Ok(stat) => stat.size() as SizeType,
        Err(err) => return CopyByPath::Failed(err.to_system_error()),
    };
    if max_length != MAX_SIZE && copied > max_length {
        let _ = node_fs::NodeFS::default().truncate(
            &node_fs::args::Truncate {
                path: destination.pathlike.clone(),
                len: max_length as u64,
                flags: 0,
                as_written: true,
            },
            node_fs::Flavor::Sync,
        );
        copied = max_length;
    }
    if let (Some(mode), PathOrFileDescriptor::Path(_)) = (destination_mode, &destination.pathlike) {
        if let Err(err) = bun_sys::chmod(dest_path, mode) {
            return CopyByPath::Failed(error_with_pathlike(err, &destination.pathlike));
        }
    }
    CopyByPath::Copied(copied)
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

// Same values as in `node_fs.rs`.
const PREALLOCATE_SUPPORTED: bool = cfg!(any(target_os = "linux", target_os = "android"));
const PREALLOCATE_LENGTH: SizeType = 2048 * 1024;

const OPEN_DESTINATION_FLAGS: i32 =
    bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC;
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
// IOWhich + module-level constants
// ───────────────────────────────────────────────────────────────────────────

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
pub(crate) enum IOWhich {
    Source,
    Destination,
    Both,
}

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
