//! blocking, but off the main thread

use crate::node::fs as node_fs;
use crate::node::types::PathLikeExt as _;
#[cfg(not(windows))]
use crate::webcore::blob::{self, Retry};
use crate::webcore::blob::{MAX_SIZE, MkdirpTarget, SizeType, StoreRef, store};
use crate::webcore::node_types::PathOrFileDescriptor;
#[cfg(windows)]
use bun_io as aio;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue};
use bun_paths::PathBuffer;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(not(windows))]
use bun_sys::Stat;
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self, Fd, FdExt, Mode, SystemError};
#[cfg(windows)]
use bun_sys_jsc::ErrorJsc as _;
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::ffi::c_int;
#[cfg(windows)]
use core::ffi::c_void;
use core::marker::ConstParamTy;

// ───────────────────────────────────────────────────────────────────────────
// CopyFile (POSIX, blocking off-thread)
// ───────────────────────────────────────────────────────────────────────────

pub struct CopyFile {
    #[cfg(not(windows))]
    pub(crate) destination_file_store: store::File,
    pub(crate) source_file_store: store::File,
    // `StoreRef` is the thread-safe refcounted handle;
    // it keeps the stores — and the path slices the `File` clones borrow — alive
    // while this task is on the work pool.
    pub(crate) store: Option<StoreRef>,
    pub(crate) source_store: Option<StoreRef>,
    pub offset: SizeType,
    #[cfg(not(windows))]
    pub(crate) max_length: SizeType,
    #[cfg(not(windows))]
    pub(crate) destination_fd: Fd,
    #[cfg(not(windows))]
    pub(crate) source_fd: Fd,

    pub(crate) system_error: Option<SystemError>,

    pub(crate) read_len: SizeType,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) read_off: SizeType,

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

// SAFETY: file stores/paths and blob store refs (atomic counts); nothing thread-affine.
unsafe impl Send for CopyFile {}

impl jsc::JobContext for CopyFile {
    type OffThread = Self;
    type Js = jsc::JSPromiseStrong;
    fn run(
        this: &mut Self,
        _vm: &jsc::vm_handle::Borrow,
        done: bun_jsc::Completion<Self>,
    ) -> Option<bun_jsc::Completion<Self>> {
        this.run_async();
        Some(done)
    }
    fn then(
        mut this: Self,
        mut promise: jsc::JSPromiseStrong,
        cx: &jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        Ok(CopyFile::then(&mut this, promise.swap(), cx.global())?)
    }
}

impl CopyFile {
    /// Schedule the copy on the work pool; returns its promise.
    #[cfg(not(windows))]
    pub(crate) fn create(
        store: StoreRef,
        source_store: StoreRef,
        off: SizeType,
        max_len: SizeType,
        global_this: &JSGlobalObject,
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
            #[cfg(any(target_os = "linux", target_os = "android"))]
            read_off: 0,
        };
        let cx = global_this.js_thread();
        let promise = jsc::JSPromiseStrong::init(global_this);
        let value = promise.value();
        jsc::Job::<CopyFile>::schedule(&cx, copy, promise);
        value
    }

    pub(crate) fn reject(
        &mut self,
        promise: &mut JSPromise,
        global_this: &JSGlobalObject,
    ) -> Result<(), jsc::JsTerminated> {
        let mut system_error: SystemError = self.system_error.take().unwrap_or_default();
        if matches!(
            self.source_file_store.pathlike,
            PathOrFileDescriptor::Path(_)
        ) && system_error.path.is_empty()
        {
            system_error.path =
                bun_core::String::clone_utf8(self.source_file_store.pathlike.path().slice()).into();
        }

        if system_error.message.is_empty() {
            system_error.message = bun_core::String::static_("Failed to copy file").into();
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
    ) -> Result<(), jsc::JsTerminated> {
        drop(self.source_store.take()); // source_store.?.deref()

        if self.system_error.is_some() {
            return self.reject(promise, global_this);
        }

        promise.resolve(
            global_this,
            JSValue::js_number_from_uint64(self.read_len as u64),
        )
    }

    #[cfg(not(windows))]
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
                self.source_file_store
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

        self.read_off += self.offset;

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

        // defer { this.read_len = @truncate(total_written); }
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
        #[cfg(windows)]
        {
            return; // why
        }
        #[cfg(not(windows))]
        {
            // defer task.onFinish();

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
                            let mut path_buf = PathBuffer::uninit();

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

            if matches!(
                self.destination_file_store.pathlike,
                PathOrFileDescriptor::Fd(_)
            ) {
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
    let mut buf = [0u8; 64 * 1024];
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
// alive by the `source_store` `StoreRef`). Each clone's field `Drop` frees
// exactly what it owns; the `StoreRef`s release just their Store refcounts on
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
// ───────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub struct CopyFileWindows<'a> {
    pub(crate) destination_file_store: StoreRef,
    pub(crate) source_file_store: StoreRef,

    pub(crate) io_request: libuv::fs_t,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) mkdirp_if_not_exists: bool,
    pub(crate) destination_mode: Option<Mode>,
    // per LIFETIMES.tsv: JSC_BORROW → &jsc::EventLoop
    // TODO(refactor): lifetime — heap-allocated and re-entered from libuv callbacks;
    // likely should be *const jsc::EventLoop.
    pub(crate) event_loop: &'a jsc::event_loop::EventLoop,
    /// How the mkdirp pool completion gets back to the VM.
    pub(crate) loop_handle: jsc::LoopHandle,

    pub(crate) size: SizeType,

    /// Bytes written, stored for use after async chmod completes
    pub(crate) written_bytes: usize,

    /// For mkdirp
    pub(crate) err: Option<bun_sys::Error>,

    /// When we are unable to get the original file path, we do a read-write loop that uses libuv.
    pub(crate) read_write_loop: ReadWriteLoop,
}

#[cfg(windows)]
pub struct ReadWriteLoop {
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

/// What one step of the copy asks [`CopyFileWindows::finish`] to do with the task.
///
/// The steps are `&mut self` methods, so none of them may free the task: a reference argument
/// has to stay dereferenceable until the call it was passed to returns. Each entry point
/// (`init`, the libuv completions, the mkdirp hop) therefore keeps the heap pointer, runs one
/// step through it, and hands the result to `finish`, the only place the task is freed.
#[cfg(windows)]
#[must_use]
enum Step {
    /// A libuv request or pool task is in flight; its completion runs the next step.
    Pending,
    /// The copy is over: settle the promise with this outcome and free the task.
    Done(bun_sys::Result<usize>),
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

/// Closes the descriptors `prepare_pathlike` opened (a `Bun.file(fd)` store's own descriptor is
/// left alone); `read_buf` frees itself.
#[cfg(windows)]
impl Drop for ReadWriteLoop {
    fn drop(&mut self) {
        if self.must_close_source_fd {
            match self.source_fd.make_libuv_owned() {
                Ok(fd) => {
                    aio::Closer::close(fd, aio::Loop::get());
                }
                Err(_) => {
                    self.source_fd.close();
                }
            }
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
        }
    }
}

/// The task holds one event-loop reference from `init` until it is dropped (every return to
/// the loop while it exists has a request or pool task in flight), and its libuv request is
/// cleaned up with it. `read_write_loop` closes its descriptors and the store references are
/// released by the field drops.
#[cfg(windows)]
impl Drop for CopyFileWindows<'_> {
    fn drop(&mut self) {
        self.io_request.deinit();
        self.event_loop.unref_keep_alive();
    }
}

/// Shared by the libuv completions (`on_read`, `on_write`, `on_copy_file`, `on_chmod`):
/// recover the task that owns `req`, run one step on it, and let `finish` free it if that
/// step ended the copy.
#[cfg(windows)]
fn on_uv_complete<'a>(req: *mut libuv::fs_t, step: fn(&mut CopyFileWindows<'a>) -> Step) {
    // SAFETY: `req->data` was set to the task pointer (whole-struct provenance) before
    // scheduling. Recover the task from `data` rather than
    // `from_field_ptr!(.., io_request, req)`: the `req` pointer libuv hands back was
    // produced from a `&mut self.io_request` reborrow whose provenance covers only the
    // `io_request` field, so `container_of`-style subtraction would yield a
    // `*mut CopyFileWindows` with out-of-bounds provenance (UB under Stacked/Tree
    // Borrows). The request is only accessed through the task from here on.
    let this: *mut CopyFileWindows<'a> = unsafe { (*req).data.cast::<CopyFileWindows<'a>>() };
    // SAFETY: `this` is the live task that scheduled `req`; only a field address is taken.
    debug_assert!(unsafe { core::ptr::addr_of_mut!((*this).io_request) } == req);
    // SAFETY: `this` is live and nothing else touches it while its completion runs. No step
    // frees the task, so the exclusive borrow formed for this call ends when it returns.
    let step = unsafe { step(&mut *this) };
    // SAFETY: `this` is still live; `finish` is the only thing that frees it.
    unsafe { CopyFileWindows::finish(this, step) };
}

#[cfg(windows)]
extern "C" fn on_read(req: *mut libuv::fs_t) {
    on_uv_complete(req, CopyFileWindows::on_read_complete);
}

#[cfg(windows)]
extern "C" fn on_write(req: *mut libuv::fs_t) {
    on_uv_complete(req, CopyFileWindows::on_write_complete);
}

#[cfg(windows)]
extern "C" fn on_copy_file(req: *mut libuv::fs_t) {
    on_uv_complete(req, CopyFileWindows::on_copyfile_complete);
}

#[cfg(windows)]
extern "C" fn on_chmod(req: *mut libuv::fs_t) {
    on_uv_complete(req, CopyFileWindows::on_chmod_complete);
}

#[cfg(windows)]
impl<'a> CopyFileWindows<'a> {
    fn on_read_complete(&mut self) -> Step {
        let source_fd = self.read_write_loop.source_fd;
        let destination_fd = self.read_write_loop.destination_fd;
        // reshaped for borrowck — `read_buf.items` is `Vec` len-slice.
        let read_buf = &mut self.read_write_loop.read_buf;

        let event_loop = self.event_loop;

        let rc = self.io_request.result;

        bun_sys::syslog!(
            "uv_fs_read({}, {}) = {}",
            source_fd,
            read_buf.len(),
            rc.int()
        );
        if let Some(err) = rc.to_error(bun_sys::Tag::read) {
            self.err = Some(err);
            return self.on_read_write_loop_complete();
        }

        let n = usize::try_from(rc.int()).expect("int cast");
        // SAFETY: libuv wrote `n` bytes into the buffer's capacity.
        unsafe { read_buf.set_len(n) };
        self.read_write_loop.uv_buf = libuv::uv_buf_t::init(read_buf.as_slice());

        if rc.int() == 0 {
            // Handle EOF. We can't read any more.
            return self.on_read_write_loop_complete();
        }

        // Re-use the fs request.
        self.io_request.deinit();
        // SAFETY: FFI — `io_request` was just cleaned via `deinit()`, `uv_buf` points into
        // `read_buf` (len set above), and `on_write` is a valid `uv_fs_cb`.
        let rc2 = unsafe {
            libuv::uv_fs_write(
                event_loop.uv_loop(),
                &mut self.io_request,
                destination_fd.uv(),
                core::ptr::from_mut(&mut self.read_write_loop.uv_buf),
                1,
                -1,
                Some(on_write),
            )
        };
        self.io_request.data = core::ptr::from_mut(self).cast::<c_void>();

        if let Some(err) = rc2.to_error(bun_sys::Tag::write) {
            self.err = Some(err);
            return self.on_read_write_loop_complete();
        }

        Step::Pending
    }

    fn on_write_complete(&mut self) -> Step {
        let buf_len = self.read_write_loop.read_buf.len();

        let destination_fd = self.read_write_loop.destination_fd;

        let rc = self.io_request.result;

        bun_sys::syslog!(
            "uv_fs_write({}, {}) = {}",
            destination_fd,
            buf_len,
            rc.int()
        );

        if let Some(err) = rc.to_error(bun_sys::Tag::write) {
            self.err = Some(err);
            return self.on_read_write_loop_complete();
        }

        let wrote: u32 = u32::try_from(rc.int()).expect("int cast");

        self.read_write_loop.written += wrote as usize;

        if (wrote as usize) < buf_len {
            if wrote == 0 {
                // Handle EOF. We can't write any more.
                return self.on_read_write_loop_complete();
            }

            // Re-use the fs request.
            self.io_request.deinit();
            self.io_request.data = core::ptr::from_mut(self).cast::<c_void>();

            let prev = self.read_write_loop.uv_buf.slice();
            self.read_write_loop.uv_buf = libuv::uv_buf_t::init(&prev[wrote as usize..]);
            // SAFETY: FFI — `io_request` was just cleaned via `deinit()`, `uv_buf` is a tail
            // slice of the previous write buffer (still backed by `read_buf`), and
            // `on_write` is a valid `uv_fs_cb`.
            let rc2 = unsafe {
                libuv::uv_fs_write(
                    self.event_loop.uv_loop(),
                    &mut self.io_request,
                    destination_fd.uv(),
                    core::ptr::from_mut(&mut self.read_write_loop.uv_buf),
                    1,
                    -1,
                    Some(on_write),
                )
            };

            if let Some(err) = rc2.to_error(bun_sys::Tag::write) {
                self.err = Some(err);
                return self.on_read_write_loop_complete();
            }

            return Step::Pending;
        }

        self.io_request.deinit();
        match self.read_write_loop_read() {
            bun_sys::Result::Err(err) => {
                self.err = Some(err);
                self.on_read_write_loop_complete()
            }
            bun_sys::Result::Ok(()) => Step::Pending,
        }
    }

    fn on_read_write_loop_complete(&mut self) -> Step {
        if let Some(err) = self.err.take() {
            return Step::Done(Err(err));
        }

        let written = self.read_write_loop.written;
        self.on_complete(written)
    }

    pub(crate) fn new(init: CopyFileWindows<'a>) -> Box<CopyFileWindows<'a>> {
        Box::new(init)
    }

    pub(crate) fn init(
        destination_file_store: StoreRef,
        source_file_store: StoreRef,
        event_loop: &'a jsc::event_loop::EventLoop,
        mkdirp_if_not_exists: bool,
        size_: SizeType,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        // destination_file_store.ref() / source_file_store.ref() — Arc clone
        let global = event_loop.global_ref();
        // Balanced by `Drop`.
        event_loop.ref_keep_alive();
        let this = bun_core::heap::into_raw(CopyFileWindows::new(CopyFileWindows {
            destination_file_store,
            source_file_store,
            promise: jsc::JSPromiseStrong::init(global),
            // SAFETY: all-zero is a valid libuv::fs_t
            io_request: bun_core::ffi::zeroed::<libuv::fs_t>(),
            loop_handle: jsc::VirtualMachine::VirtualMachine::get().loop_handle(),
            event_loop,
            mkdirp_if_not_exists,
            destination_mode,
            size: size_,
            written_bytes: 0,
            err: None,
            read_write_loop: ReadWriteLoop::default(),
        }));
        // SAFETY: `this` was allocated just above and nothing else holds it yet. The promise is
        // read out first because `finish` frees the task if `copyfile` fails synchronously.
        let promise = unsafe { (*this).promise.value() };
        // SAFETY: as above; `copyfile` does not free the task.
        let step = unsafe { (*this).copyfile() };
        // SAFETY: as above; after this call the task belongs to libuv / the pool, or is gone.
        unsafe { Self::finish(this, step) };

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

    fn prepare_read_write_loop(&mut self) -> Step {
        // Open the destination first, so that if we need to call
        // mkdirp(), we don't spend extra time opening the file handle for
        // the source.
        self.read_write_loop.destination_fd = match Self::prepare_pathlike(
            &mut self
                .destination_file_store
                .data_mut()
                .as_file_mut()
                .pathlike,
            &mut self.read_write_loop.must_close_destination_fd,
            false,
        ) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(err) => {
                if self.mkdirp_if_not_exists && err.get_errno() == bun_sys::E::ENOENT {
                    return self.mkdirp();
                }

                return Step::Done(Err(err));
            }
        };

        self.read_write_loop.source_fd = match Self::prepare_pathlike(
            &mut self.source_file_store.data_mut().as_file_mut().pathlike,
            &mut self.read_write_loop.must_close_source_fd,
            true,
        ) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(err) => {
                return Step::Done(Err(err));
            }
        };

        match self.read_write_loop_start() {
            bun_sys::Result::Err(err) => Step::Done(Err(err)),
            bun_sys::Result::Ok(()) => Step::Pending,
        }
    }

    fn copyfile(&mut self) -> Step {
        // This is for making it easier for us to test this code path
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE
            .get()
            .unwrap_or(false)
        {
            return self.prepare_read_write_loop();
        }

        let mut pathbuf1 = PathBuffer::uninit();
        let mut pathbuf2 = PathBuffer::uninit();
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
                            return Step::Done(Err(err));
                        }
                        bun_sys::Result::Ok(kind) => match kind {
                            bun_sys::FileKind::Directory => {
                                return Step::Done(Err(bun_sys::Error::from_code(
                                    bun_sys::E::EISDIR,
                                    bun_sys::Tag::open,
                                )));
                            }
                            bun_sys::FileKind::CharacterDevice => {
                                return self.prepare_read_write_loop();
                            }
                            _ => {
                                let out = match bun_sys::get_fd_path(fd, &mut pathbuf1) {
                                    Ok(out) => out,
                                    Err(_) => {
                                        // This case can happen when either:
                                        // - NUL device
                                        // - Pipe. `cat foo.txt | bun bar.ts`
                                        return self.prepare_read_write_loop();
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
                            return Step::Done(Err(err));
                        }
                        bun_sys::Result::Ok(kind) => match kind {
                            bun_sys::FileKind::Directory => {
                                return Step::Done(Err(bun_sys::Error::from_code(
                                    bun_sys::E::EISDIR,
                                    bun_sys::Tag::open,
                                )));
                            }
                            bun_sys::FileKind::CharacterDevice => {
                                return self.prepare_read_write_loop();
                            }
                            _ => {
                                let out = match bun_sys::get_fd_path(fd, &mut pathbuf2) {
                                    Ok(out) => out,
                                    Err(_) => {
                                        // This case can happen when either:
                                        // - NUL device
                                        // - Pipe. `cat foo.txt | bun bar.ts`
                                        return self.prepare_read_write_loop();
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

        if let Some(errno) = rc.errno() {
            return Step::Done(Err(bun_sys::Error {
                // #6336
                errno: if errno == bun_sys::SystemErrno::EPERM as u16 {
                    bun_sys::SystemErrno::ENOENT as u16
                } else {
                    errno
                },
                syscall: bun_sys::Tag::copyfile,
                path: old_path.as_bytes().into(),
                ..Default::default()
            }));
        }
        Step::Pending
    }

    fn on_copyfile_complete(&mut self) -> Step {
        let rc = self.io_request.result;

        bun_sys::syslog!("uv_fs_copyfile() = {}", rc);
        if let Some(errno) = rc.err_enum_e() {
            // ENOENT from uv_fs_copyfile can mean either the source file or the
            // destination directory is missing. Disambiguate so a missing source
            // rejects directly instead of entering the mkdirp+retry path. Only an
            // ENOENT from the probe counts as "missing"; any other error leaves
            // the mkdirp+retry path available.
            let source_missing = errno == bun_sys::E::ENOENT
                && match &self.source_file_store.data.as_file().pathlike {
                    PathOrFileDescriptor::Path(p) => {
                        let mut buf = bun_paths::path_buffer_pool::get();
                        matches!(
                            bun_sys::access(p.slice_z(&mut buf), 0),
                            bun_sys::Result::Err(e) if e.get_errno() == bun_sys::E::ENOENT
                        )
                    }
                    PathOrFileDescriptor::Fd(_) => false,
                };

            if self.mkdirp_if_not_exists && errno == bun_sys::E::ENOENT && !source_missing {
                self.io_request.deinit();
                return self.mkdirp();
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
                &self.source_file_store
            } else {
                &self.destination_file_store
            };
            match &store.data.as_file().pathlike {
                PathOrFileDescriptor::Path(p) => {
                    err = err.with_path(p.slice());
                }
                PathOrFileDescriptor::Fd(fd) => {
                    err = err.with_fd(*fd);
                }
            }

            return Step::Done(Err(err));
        }

        let size = self.io_request.statbuf.size();
        self.on_complete(size as usize)
    }

    fn on_complete(&mut self, written_actual: usize) -> Step {
        let mut written = written_actual;
        if written != usize::try_from(self.size).expect("int cast") && self.size != MAX_SIZE {
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
                let mut pathbuf = PathBuffer::uninit();
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
                // previously `transmute::<c_int, SystemErrno>(errno)` — wrong on
                // two counts: `errno` is `u16` (size mismatch with `c_int`), and libuv
                // negative codes are NOT `SystemErrno` discriminants on Windows. Route
                // through `Error::from_uv_rc` so `from_libuv` is set and translation is
                // deferred to display, matching the other libuv error paths in this file.
                if let Some(mut err) = bun_sys::Error::from_uv_rc(rc, bun_sys::Tag::chmod) {
                    let destination = &self.destination_file_store.data.as_file();
                    if let PathOrFileDescriptor::Path(p) = &destination.pathlike {
                        err = err.with_path(p.slice());
                    }
                    return Step::Done(Err(err));
                }
                return Step::Pending;
            }
        }

        Step::Done(Ok(written))
    }

    fn on_chmod_complete(&mut self) -> Step {
        let rc = self.io_request.result;
        if let Some(errno) = rc.err_enum_e() {
            let mut err = bun_sys::Error::from_code(errno, bun_sys::Tag::chmod);
            let destination = &self.destination_file_store.data.as_file();
            if let PathOrFileDescriptor::Path(p) = &destination.pathlike {
                err = err.with_path(p.slice());
            }
            return Step::Done(Err(err));
        }

        Step::Done(Ok(self.written_bytes))
    }

    /// Takes `*mut Self`, not `&mut self`: a finished copy turns the pointer back into the
    /// `Box` that `init` leaked and drops it here, and a `&mut self` argument would have to
    /// stay dereferenceable until this returned.
    ///
    /// # Safety
    /// `this` must be the live task allocated in `init`, with no borrow of it outstanding.
    /// If `step` is [`Step::Done`], `*this` is freed before this returns.
    unsafe fn finish(this: *mut Self, step: Step) {
        let Step::Done(result) = step else { return };

        // SAFETY: caller contract — `this` is the allocation `init` leaked, and nothing
        // borrows it: the step that reported `Done` has returned.
        let mut task = unsafe { bun_core::heap::take(this) };
        let event_loop = task.event_loop;
        let mut promise = task.promise.take();
        let global_this = event_loop.global_ref();
        let settled = match result {
            Ok(written) => Ok(JSValue::js_number_from_uint64(written as u64)),
            Err(err) => Err(err.to_js_with_async_stack(global_this, promise.get())),
        };

        // SAFETY: VM-owned event loop is valid for the process lifetime; `enter_scope`
        // calls enter() now and exit() on drop.
        let _guard = unsafe {
            jsc::event_loop::EventLoop::enter_scope(core::ptr::from_ref(event_loop).cast_mut())
        };
        // Descriptors are closed and the loop reference is released before script can observe
        // the settled promise.
        drop(task);
        let _ = match settled {
            Ok(written) => promise.resolve(global_this, written),
            Err(err) => promise.reject(global_this, err),
        };
    }

    #[cold]
    fn truncate(&mut self) {
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

    fn mkdirp(&mut self) -> Step {
        bun_sys::syslog!("mkdirp");
        self.mkdirp_if_not_exists = false;
        // Borrowck: compute the raw path slice pointer up-front so the
        // immutable borrow of `self.destination_file_store` ends before we take
        // `core::ptr::from_mut(self)` for `completion_ctx` below.
        let path: *const [u8] = {
            let destination = &self.destination_file_store.data.as_file();
            if !matches!(destination.pathlike, PathOrFileDescriptor::Path(_)) {
                return Step::Done(Err(bun_sys::Error {
                    errno: bun_sys::SystemErrno::EINVAL as u16,
                    syscall: bun_sys::Tag::mkdir,
                    ..Default::default()
                }));
            }
            let path_slice = destination.pathlike.path().slice();
            // BORROW: not owned — `destination_file_store` (and thus its path) is held in
            // `self`, which outlives the workpool task (the completion runs
            // `on_mkdirp_complete` on `self` before `finish` can free it).
            bun_paths::dirname(path_slice)
                // this shouldn't happen
                .unwrap_or(path_slice) as *const [u8]
        };

        node_fs::async_::AsyncMkdirp::schedule(node_fs::async_::AsyncMkdirp {
            completion: on_mkdirp_complete_concurrent,
            completion_ctx: core::ptr::from_mut(self).cast::<()>(),
            path,
            ..Default::default()
        });
        Step::Pending
    }

    fn on_mkdirp_complete(&mut self) -> Step {
        if let Some(err) = self.err.take() {
            return Step::Done(Err(err));
        }

        self.copyfile()
    }
}

#[cfg(windows)]
fn on_mkdirp_complete_concurrent(ctx: *mut (), err_: bun_sys::Maybe<()>) {
    bun_sys::syslog!("mkdirp complete");
    // SAFETY: `ctx` is the `*mut CopyFileWindows` stored in `AsyncMkdirp.completion_ctx`
    // by `mkdirp` above; sole owner on this concurrent path.
    let this = unsafe { bun_ptr::callback_ctx::<CopyFileWindows>(ctx.cast()) };
    debug_assert!(this.err.is_none());
    this.err = match err_ {
        bun_sys::Result::Err(e) => Some(e),
        bun_sys::Result::Ok(()) => None,
    };
    // callback signature to match `ManagedTask::new`'s `fn(*mut T) -> JsResult<()>`.
    fn call_erased(this: *mut CopyFileWindows<'_>) -> bun_event_loop::JsResult<()> {
        // SAFETY: `this` is the heap-allocated `CopyFileWindows` passed to `ManagedTask::new`
        // below, back on the JS thread; `on_mkdirp_complete` does not free it.
        let step = unsafe { (*this).on_mkdirp_complete() };
        // SAFETY: as above; `finish` may free the task, and nothing touches it afterwards.
        unsafe { CopyFileWindows::finish(this, step) };
        Ok(())
    }
    let ct = jsc::ConcurrentTask::create(jsc::ManagedTask::ManagedTask::new::<CopyFileWindows>(
        this,
        call_erased,
    ));
    if let jsc::vm_handle::Posted::Refused(ct) = this.loop_handle.post_task(ct) {
        // VM torn down: nobody will settle the promise; free the hop.
        // SAFETY: refused ⇒ we own the task box.
        unsafe { bun_event_loop::ConcurrentTask::ConcurrentTask::release_refused(ct) };
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
        message: bun_core::String::static_("That doesn't work on folders").into(),
        syscall: bun_core::String::static_("fstat").into(),
        ..SystemError::default()
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn unsupported_non_regular_file_error() -> SystemError {
    SystemError {
        errno: bun_sys::SystemErrno::ENOTSUP as i32,
        message: bun_core::String::static_("Non-regular files aren't supported yet").into(),
        syscall: bun_core::String::static_("fstat").into(),
        ..SystemError::default()
    }
}
// `SystemError` contains `bun_core::String`, which is not const-constructible,
// so these are constructor fns instead of `const` values.
