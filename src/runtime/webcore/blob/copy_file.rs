//! blocking, but off the main thread

use crate::node::fs as node_fs;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::{self, MAX_SIZE, MkdirpTarget, Retry, SizeType, StoreRef, store};
use crate::webcore::node_types::PathOrFileDescriptor;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue};
use bun_paths::PathBuffer;
#[cfg(not(windows))]
use bun_sys::Stat;
use bun_sys::{self, Fd, FdExt, Mode, SystemError};
#[cfg(windows)]
use bun_sys_jsc::ErrorJsc as _;
#[cfg(windows)]
use bun_threading::{IntrusiveWorkTask as _, WorkPool, WorkPoolTask};
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::ffi::c_int;
use core::ffi::c_void;
use core::marker::ConstParamTy;

// Local conversion: `bun_sys::SystemError` -> `bun_jsc::SystemError`. Mapped
// field-by-field because the two definitions order their fields differently.
fn to_jsc_system_error(e: &SystemError) -> jsc::SystemError {
    jsc::SystemError {
        errno: e.errno,
        code: e.code,
        message: e.message,
        path: e.path,
        syscall: e.syscall,
        hostname: e.hostname,
        fd: e.fd,
        dest: e.dest,
    }
}

// ───────────────────────────────────────────────────────────────────────────
// CopyFile (POSIX, blocking off-thread)
// ───────────────────────────────────────────────────────────────────────────

pub struct CopyFile<'a> {
    pub destination_file_store: store::File,
    pub source_file_store: store::File,
    // `StoreRef` is the thread-safe refcounted handle;
    // it keeps the stores — and the path slices the `File` clones borrow — alive
    // while this task is on the work pool.
    pub store: Option<StoreRef>,
    pub source_store: Option<StoreRef>,
    pub offset: SizeType,
    pub size: SizeType,
    pub max_length: SizeType,
    pub destination_fd: Fd,
    pub source_fd: Fd,

    pub system_error: Option<SystemError>,

    pub read_len: SizeType,
    pub read_off: SizeType,

    // per LIFETIMES.tsv: JSC_BORROW → &JSGlobalObject
    // TODO(refactor): lifetime — this struct is Box-allocated and crosses threads;
    // `'a` here is unsound in practice. Likely should be *const JSGlobalObject.
    pub global_this: &'a JSGlobalObject,

    pub mkdirp_if_not_exists: bool,
    pub destination_mode: Option<Mode>,
}

pub type ResultType = Result<SizeType, bun_core::Error>;

pub type Callback = fn(ctx: *mut c_void, len: ResultType);

impl MkdirpTarget for CopyFile<'_> {
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

impl jsc::concurrent_promise_task::ConcurrentPromiseTaskContext for CopyFile<'_> {
    const TASK_TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::CopyFilePromiseTask;
    fn run(&mut self) {
        self.run_async();
    }
    fn then(&mut self, promise: &mut JSPromise) -> Result<(), jsc::JsTerminated> {
        CopyFile::then(self, promise)
    }
}

impl<'a> CopyFile<'a> {
    pub fn create(
        store: StoreRef,
        source_store: StoreRef,
        off: SizeType,
        max_len: SizeType,
        global_this: &'a JSGlobalObject,
        mkdirp_if_not_exists: bool,
        destination_mode: Option<Mode>,
    ) -> Box<CopyFilePromiseTask<'a>> {
        let read_file = Box::new(CopyFile {
            destination_file_store: store.data.as_file().clone(),
            source_file_store: source_store.data.as_file().clone(),
            store: Some(store),
            source_store: Some(source_store),
            offset: off,
            max_length: max_len,
            global_this,
            mkdirp_if_not_exists,
            destination_mode,
            // defaults:
            size: 0,
            destination_fd: Fd::INVALID,
            source_fd: Fd::INVALID,
            system_error: None,
            read_len: 0,
            read_off: 0,
        });
        CopyFilePromiseTask::create_on_js_thread(global_this, read_file)
    }

    pub fn reject(&mut self, promise: &mut JSPromise) -> Result<(), jsc::JsTerminated> {
        let global_this = self.global_this;
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

        let instance = to_jsc_system_error(&system_error)
            .to_error_instance_with_async_stack(self.global_this, promise);
        if let Some(store) = self.store.take() {
            drop(store); // deref()
        }
        promise.reject(global_this, Ok(instance))
    }

    pub fn then(&mut self, promise: &mut JSPromise) -> Result<(), jsc::JsTerminated> {
        drop(self.source_store.take()); // source_store.?.deref()

        if self.system_error.is_some() {
            return self.reject(promise);
        }

        promise.resolve(
            self.global_this,
            JSValue::js_number_from_uint64(self.read_len as u64),
        )
    }

    pub fn run(&mut self) {
        self.run_async();
    }

    pub fn do_close(&mut self) {
        let close_input = !matches!(
            self.destination_file_store.pathlike,
            PathOrFileDescriptor::Fd(_)
        ) && self.destination_fd != Fd::INVALID;
        let close_output = !matches!(self.source_file_store.pathlike, PathOrFileDescriptor::Fd(_))
            && self.source_fd != Fd::INVALID;

        // Apply destination mode using fchmod before closing (for POSIX platforms)
        // This ensures mode is applied even when overwriting existing files, since
        // open()'s mode argument only affects newly created files.
        // On macOS clonefile path, chmod is called separately after clonefile.
        // On Windows, CopyFileWindows applies the mode after the copy.
        #[cfg(not(windows))]
        {
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
        }

        if close_input && close_output {
            self.do_close_file::<{ IOWhich::Both }>();
        } else if close_input {
            self.do_close_file::<{ IOWhich::Destination }>();
        } else if close_output {
            self.do_close_file::<{ IOWhich::Source }>();
        }
    }

    pub fn do_close_file<const WHICH: IOWhich>(&mut self) {
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

    pub fn do_open_file<const WHICH: IOWhich>(&mut self) -> Result<(), bun_core::Error> {
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
                bun_sys::Result::Ok(result) => result,
                bun_sys::Result::Err(errno) => {
                    self.system_error = Some(errno.to_system_error());
                    return Err(bun_core::errno_to_zig_err(errno.errno as i32));
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
                                return Err(bun_core::errno_to_zig_err(errno.errno as i32));
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
                        return Err(bun_core::errno_to_zig_err(errno.errno as i32));
                    }
                }
                break;
            }
        }
        Ok(())
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn do_copy_file_range<const USE: TryWith, const CLEAR_APPEND_IF_INVALID: bool>(
        &mut self,
    ) -> Result<(), bun_core::Error> {
        use bun_sys::linux;

        self.read_off += self.offset;

        let mut remain: usize = self.max_length as usize;
        let unknown_size = remain == MAX_SIZE as usize || remain == 0;
        if unknown_size {
            // sometimes stat lies
            // let's give it 4096 and see how it goes
            remain = 4096;
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
            match node_fs::NodeFS::copy_file_using_read_write_loop(
                bun_core::ZStr::EMPTY,
                bun_core::ZStr::EMPTY,
                src_fd,
                dest_fd,
                if unknown_size { 0 } else { remain },
                &mut total_written,
            ) {
                bun_sys::Result::Err(err) => {
                    self.system_error = Some(err.to_system_error());
                    return Err(bun_core::errno_to_zig_err(err.errno as i32));
                }
                bun_sys::Result::Ok(()) => {
                    // SAFETY: dest_fd is a valid open fd; raw ftruncate(2).
                    let _ = unsafe {
                        libc::ftruncate(
                            dest_fd.native(),
                            i64::try_from(total_written).expect("int cast"),
                        )
                    };
                    return Ok(());
                }
            }
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
                    match node_fs::NodeFS::copy_file_using_read_write_loop(
                        bun_core::ZStr::EMPTY,
                        bun_core::ZStr::EMPTY,
                        src_fd,
                        dest_fd,
                        if unknown_size { 0 } else { remain },
                        &mut total_written,
                    ) {
                        bun_sys::Result::Err(err) => {
                            self.system_error = Some(err.to_system_error());
                            return Err(bun_core::errno_to_zig_err(err.errno as i32));
                        }
                        bun_sys::Result::Ok(()) => {
                            // SAFETY: dest_fd is a valid open fd; raw ftruncate(2).
                            let _ = unsafe {
                                libc::ftruncate(
                                    dest_fd.native(),
                                    i64::try_from(total_written).expect("int cast"),
                                )
                            };
                            return Ok(());
                        }
                    }
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
                        match node_fs::NodeFS::copy_file_using_read_write_loop(
                            bun_core::ZStr::EMPTY,
                            bun_core::ZStr::EMPTY,
                            src_fd,
                            dest_fd,
                            if unknown_size { 0 } else { remain },
                            &mut total_written,
                        ) {
                            bun_sys::Result::Err(err) => {
                                self.system_error = Some(err.to_system_error());
                                return Err(bun_core::errno_to_zig_err(err.errno as i32));
                            }
                            bun_sys::Result::Ok(()) => {
                                // SAFETY: dest_fd is a valid open fd; raw ftruncate(2).
                                let _ = unsafe {
                                    libc::ftruncate(
                                        dest_fd.native(),
                                        i64::try_from(total_written).expect("int cast"),
                                    )
                                };
                                return Ok(());
                            }
                        }
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
                    return Err(bun_core::errno_to_zig_err(bun_sys::E::EINVAL as i32));
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
                    return Err(bun_core::errno_to_zig_err(errno as i32));
                }
            }

            // wrote zero bytes means EOF
            remain = remain.saturating_sub(usize::try_from(written).expect("int cast"));
            total_written += u64::try_from(written).expect("int cast");
            if written == 0 || remain == 0 {
                break;
            }
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub fn do_fcopy_file_with_read_write_loop_fallback(&mut self) -> Result<(), bun_core::Error> {
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
                                return Err(bun_core::errno_to_zig_err(err.errno as i32));
                            }
                            bun_sys::Result::Ok(()) => {}
                        }
                    }
                    _ => {
                        self.system_error = Some(errno.to_system_error());
                        return Err(bun_core::errno_to_zig_err(errno.errno as i32));
                    }
                }
            }
            bun_sys::Result::Ok(()) => {}
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    pub fn do_clonefile(&mut self) -> Result<(), bun_core::Error> {
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
                    return Err(bun_core::errno_to_zig_err(errno.errno as i32));
                }
                bun_sys::Result::Ok(()) => {}
            }
            break;
        }
        Ok(())
    }

    pub fn run_async(&mut self) {
        #[cfg(windows)]
        {
            unreachable!("CopyFile is POSIX-only; see CopyFileWindows");
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

            if stat.st_size != 0 {
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
                    && bun_sys::S::ISREG(stat.st_mode as _)
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
                if self.do_fcopy_file_with_read_write_loop_fallback().is_err() {
                    self.do_close();
                    return;
                }
                if stat.st_size != 0
                    && SizeType::try_from(stat.st_size).expect("int cast") > self.max_length
                {
                    // SAFETY: `destination_fd` is open; libc ftruncate(2).
                    let _ = unsafe {
                        bun_sys::darwin::ftruncate(
                            self.destination_fd.native(),
                            i64::try_from(self.max_length).expect("int cast"),
                        )
                    };
                }

                self.do_close();
                return;
            }

            #[cfg(target_os = "freebsd")]
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

const OPEN_DESTINATION_FLAGS: i32 =
    bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC;
const OPEN_SOURCE_FLAGS: i32 = bun_sys::O::CLOEXEC | bun_sys::O::RDONLY;

#[derive(ConstParamTy, PartialEq, Eq, Clone, Copy)]
pub enum TryWith {
    Sendfile,
    CopyFileRange,
    Splice,
}

impl TryWith {
    pub const fn tag(self) -> bun_sys::Tag {
        match self {
            TryWith::Sendfile => bun_sys::Tag::sendfile,
            TryWith::CopyFileRange => bun_sys::Tag::copy_file_range,
            TryWith::Splice => bun_sys::Tag::splice,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// CopyFileWindows (WorkPool + blocking syscalls)
//
// One WorkPool task: the path+path case is a single
// `bun_sys::windows::fs::copyfile` call (CopyFileExW does the whole job); the
// fd-backed/no-path case falls back to a blocking read/write loop. Completion
// returns to the JS thread via the event loop's concurrent task queue — the
// same execution model as the POSIX `CopyFile` and node_fs's `AsyncFSTask`.
// ───────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub struct CopyFileWindows {
    pub destination_file_store: StoreRef,
    pub source_file_store: StoreRef,

    pub promise: jsc::JSPromiseStrong,
    pub mkdirp_if_not_exists: bool,
    pub destination_mode: Option<Mode>,
    /// BACKREF — the VM-owned `EventLoop` outlives every in-flight copy; the
    /// op additionally pins it via `ref_concurrently()` until completion.
    pub event_loop: bun_ptr::BackRef<jsc::event_loop::EventLoop>,

    pub size: SizeType,

    /// Bytes written, after the copy and the destination-size clamp.
    pub written: usize,

    pub err: Option<bun_sys::Error>,

    /// When we are unable to get the original file path, we do a blocking
    /// read/write loop on the pool instead of one CopyFileExW call.
    pub read_write_loop: ReadWriteLoop,

    pub task: WorkPoolTask,
}

#[cfg(windows)]
bun_threading::intrusive_work_task!(CopyFileWindows, task);

#[cfg(windows)]
pub struct ReadWriteLoop {
    pub source_fd: Fd,
    pub must_close_source_fd: bool,
    pub destination_fd: Fd,
    pub must_close_destination_fd: bool,
    pub written: usize,
    pub read_buf: Vec<u8>,
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
        }
    }
}

#[cfg(windows)]
impl ReadWriteLoop {
    pub fn close(&mut self) {
        if self.must_close_source_fd {
            let _ = bun_sys::close(self.source_fd);
            self.must_close_source_fd = false;
            self.source_fd = Fd::INVALID;
        }

        if self.must_close_destination_fd {
            let _ = bun_sys::close(self.destination_fd);
            self.must_close_destination_fd = false;
            self.destination_fd = Fd::INVALID;
        }

        self.read_buf = Vec::new(); // clearAndFree()
    }
}

/// Outcome of one `try_copyfile` attempt.
#[cfg(windows)]
enum CopyFileStep {
    /// Finished — success or `self.err` recorded.
    Done,
    /// No usable path pair; use the read/write loop.
    Fallback,
    /// ENOENT with mkdirp still armed — caller runs mkdirp and retries.
    NeedsMkdirp,
}

#[cfg(windows)]
impl CopyFileWindows {
    pub fn init(
        destination_file_store: StoreRef,
        source_file_store: StoreRef,
        event_loop: &jsc::event_loop::EventLoop,
        mkdirp_if_not_exists: bool,
        size_: SizeType,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        // destination_file_store.ref() / source_file_store.ref() — Arc clone
        let global = event_loop.global_ref();
        let result = bun_core::heap::into_raw(Box::new(CopyFileWindows {
            destination_file_store,
            source_file_store,
            promise: jsc::JSPromiseStrong::init(global),
            event_loop: bun_ptr::BackRef::new(event_loop),
            mkdirp_if_not_exists,
            destination_mode,
            size: size_,
            written: 0,
            err: None,
            read_write_loop: ReadWriteLoop::default(),
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::run_from_work_pool,
            },
        }));
        // SAFETY: `result` was just allocated above; the promise cell is
        // GC-owned and stays valid after the work pool takes over.
        let promise = unsafe { (*result).promise.value() };
        // Keep the event loop alive while the copy is pending.
        event_loop.ref_concurrently();
        // SAFETY: freshly boxed; the work pool owns it until completion.
        WorkPool::schedule(unsafe { &raw mut (*result).task });
        promise
    }

    fn run_from_work_pool(task: *mut WorkPoolTask) {
        // SAFETY: only reached via `WorkPoolTask::callback` with `task` =
        // `&mut self.task` (intrusive) registered in `init`; recover parent.
        let this = unsafe { &mut *CopyFileWindows::from_task_ptr(task) };
        this.run_on_pool();

        fn complete_task(this: *mut CopyFileWindows) -> bun_event_loop::JsResult<()> {
            // SAFETY: the JS thread is the sole accessor now; consumed here.
            unsafe { CopyFileWindows::complete_on_js_thread(this) }
        }
        let event_loop = this.event_loop;
        event_loop.enqueue_task_concurrent(jsc::ConcurrentTask::create(
            jsc::ManagedTask::ManagedTask::new::<CopyFileWindows>(this, complete_task),
        ));
    }

    fn run_on_pool(&mut self) {
        self.copyfile_on_pool();
        if self.err.is_none() {
            self.finish_on_pool();
        }
    }

    fn copyfile_on_pool(&mut self) {
        // This is for making it easier for us to test this code path
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE
            .get()
            .unwrap_or(false)
        {
            self.run_read_write_loop();
            return;
        }

        loop {
            match self.try_copyfile() {
                CopyFileStep::Done => return,
                CopyFileStep::Fallback => {
                    self.run_read_write_loop();
                    return;
                }
                CopyFileStep::NeedsMkdirp => {
                    if self.mkdirp_on_pool() {
                        continue;
                    }
                    // `self.err` was recorded by `mkdirp_on_pool`.
                    return;
                }
            }
        }
    }

    /// One copyfile attempt: resolve both endpoints to paths and issue a
    /// single `CopyFileExW`. Success stores the copied size in `self.written`;
    /// failure records `self.err` (or asks for mkdirp / the loop fallback).
    fn try_copyfile(&mut self) -> CopyFileStep {
        let mut pathbuf1 = PathBuffer::uninit();
        let mut pathbuf2 = PathBuffer::uninit();

        let new_path: &bun_core::ZStr = 'brk: {
            match &self.destination_file_store.data.as_file().pathlike {
                PathOrFileDescriptor::Path(_) => {
                    break 'brk self
                        .destination_file_store
                        .data
                        .as_file()
                        .pathlike
                        .path()
                        .slice_z(&mut pathbuf1);
                }
                PathOrFileDescriptor::Fd(fd) => {
                    let fd = *fd;
                    match bun_sys::File::borrow(&fd).kind() {
                        bun_sys::Result::Err(err) => {
                            self.err = Some(err);
                            return CopyFileStep::Done;
                        }
                        bun_sys::Result::Ok(kind) => match kind {
                            bun_sys::FileKind::Directory => {
                                self.err = Some(bun_sys::Error::from_code(
                                    bun_sys::E::EISDIR,
                                    bun_sys::Tag::open,
                                ));
                                return CopyFileStep::Done;
                            }
                            bun_sys::FileKind::CharacterDevice => {
                                return CopyFileStep::Fallback;
                            }
                            _ => {
                                let out = match bun_sys::get_fd_path(fd, &mut pathbuf1) {
                                    Ok(out) => out,
                                    Err(_) => {
                                        // This case can happen when either:
                                        // - NUL device
                                        // - Pipe. `cat foo.txt | bun bar.ts`
                                        return CopyFileStep::Fallback;
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
            match &self.source_file_store.data.as_file().pathlike {
                PathOrFileDescriptor::Path(_) => {
                    break 'brk self
                        .source_file_store
                        .data
                        .as_file()
                        .pathlike
                        .path()
                        .slice_z(&mut pathbuf2);
                }
                PathOrFileDescriptor::Fd(fd) => {
                    let fd = *fd;
                    match bun_sys::File::borrow(&fd).kind() {
                        bun_sys::Result::Err(err) => {
                            self.err = Some(err);
                            return CopyFileStep::Done;
                        }
                        bun_sys::Result::Ok(kind) => match kind {
                            bun_sys::FileKind::Directory => {
                                self.err = Some(bun_sys::Error::from_code(
                                    bun_sys::E::EISDIR,
                                    bun_sys::Tag::open,
                                ));
                                return CopyFileStep::Done;
                            }
                            bun_sys::FileKind::CharacterDevice => {
                                return CopyFileStep::Fallback;
                            }
                            _ => {
                                let out = match bun_sys::get_fd_path(fd, &mut pathbuf2) {
                                    Ok(out) => out,
                                    Err(_) => {
                                        // This case can happen when either:
                                        // - NUL device
                                        // - Pipe. `cat foo.txt | bun bar.ts`
                                        return CopyFileStep::Fallback;
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

        // EXCL/FICLONE stay off — flags 0, same as the async path before it.
        match bun_sys::windows::fs::copyfile(old_path, new_path, 0) {
            bun_sys::Result::Ok(()) => {
                bun_sys::syslog!("copyfile() = 0");
                // CopyFileExW reports no byte count; stat the freshly-copied
                // destination so the resolved value and the size clamp in
                // `finish_on_pool` see the real size.
                self.written = match bun_sys::stat(new_path) {
                    bun_sys::Result::Ok(st) => usize::try_from(st.st_size).expect("int cast"),
                    bun_sys::Result::Err(_) => 0,
                };
                CopyFileStep::Done
            }
            bun_sys::Result::Err(err) => {
                bun_sys::syslog!("copyfile() = {}", err.errno);
                let errno = err.get_errno();
                if errno == bun_sys::E::ENOENT && self.mkdirp_if_not_exists {
                    self.mkdirp_if_not_exists = false;
                    return CopyFileStep::NeedsMkdirp;
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
                let destination = &self.destination_file_store.data.as_file();

                // we don't really know which one it is
                match &destination.pathlike {
                    PathOrFileDescriptor::Path(p) => {
                        err = err.with_path(p.slice());
                    }
                    PathOrFileDescriptor::Fd(fd) => {
                        err = err.with_fd(*fd);
                    }
                }

                self.err = Some(err);
                CopyFileStep::Done
            }
        }
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
                    bun_sys::O::WRONLY | bun_sys::O::CREAT
                },
                0,
            ) {
                bun_sys::Result::Ok(fd) => fd,
                bun_sys::Result::Err(err) => {
                    return bun_sys::Result::Err(err);
                }
            };
            *must_close = true;
            bun_sys::Result::Ok(fd)
        } else {
            bun_sys::Result::Ok(pathlike.fd())
        }
    }

    /// The fd-backed/no-path fallback: open whichever side has a path, then a
    /// blocking 64 KB read/write loop, then close what we opened.
    fn run_read_write_loop(&mut self) {
        self.prepare_read_write_loop();
        if self.err.is_none() {
            self.read_write_loop_on_pool();
        }
        self.read_write_loop.close();
        if self.err.is_none() {
            self.written = self.read_write_loop.written;
        }
    }

    fn prepare_read_write_loop(&mut self) {
        // Open the destination first, so that if we need to call
        // mkdirp(), we don't spend extra time opening the file handle for
        // the source.
        loop {
            match Self::prepare_pathlike(
                &self.destination_file_store.data.as_file().pathlike,
                &mut self.read_write_loop.must_close_destination_fd,
                false,
            ) {
                bun_sys::Result::Ok(fd) => {
                    self.read_write_loop.destination_fd = fd;
                    break;
                }
                bun_sys::Result::Err(err) => {
                    if self.mkdirp_if_not_exists && err.get_errno() == bun_sys::E::ENOENT {
                        self.mkdirp_if_not_exists = false;
                        if self.mkdirp_on_pool() {
                            continue;
                        }
                        // `self.err` was recorded by `mkdirp_on_pool`.
                        return;
                    }

                    self.err = Some(err);
                    return;
                }
            }
        }

        match Self::prepare_pathlike(
            &self.source_file_store.data.as_file().pathlike,
            &mut self.read_write_loop.must_close_source_fd,
            true,
        ) {
            bun_sys::Result::Ok(fd) => self.read_write_loop.source_fd = fd,
            bun_sys::Result::Err(err) => self.err = Some(err),
        }
    }

    fn read_write_loop_on_pool(&mut self) {
        let source_fd = self.read_write_loop.source_fd;
        let destination_fd = self.read_write_loop.destination_fd;
        self.read_write_loop.read_buf.reserve_exact(64 * 1024);

        loop {
            self.read_write_loop.read_buf.clear();
            // reshaped for borrowck — keep the read target as a raw (ptr, len)
            // so no `&mut [u8]` into `read_buf`'s capacity is live alongside
            // the `self.*` field writes below.
            let (ptr, cap) = {
                let spare = self.read_write_loop.read_buf.spare_capacity_mut();
                (spare.as_mut_ptr().cast::<u8>(), spare.len())
            };
            // SAFETY: `ptr` points at `cap` write-valid bytes of `read_buf`'s
            // spare capacity; `set_len` below only commits what `read` wrote.
            let buf = unsafe { core::slice::from_raw_parts_mut(ptr, cap) };
            let read = match bun_sys::read(source_fd, buf) {
                bun_sys::Result::Ok(n) => n,
                bun_sys::Result::Err(err) => {
                    self.err = Some(err);
                    return;
                }
            };
            bun_sys::syslog!("read({}, {}) = {}", source_fd, cap, read);

            if read == 0 {
                // Handle EOF. We can't read any more.
                return;
            }
            // SAFETY: `read` initialized `read` bytes of the spare capacity.
            unsafe { self.read_write_loop.read_buf.set_len(read) };

            // For now, we don't start reading the next chunk until
            // we've finished writing all the previous chunks.
            let mut offset = 0usize;
            while offset < read {
                let wrote = match bun_sys::write(
                    destination_fd,
                    &self.read_write_loop.read_buf[offset..],
                ) {
                    bun_sys::Result::Ok(n) => n,
                    bun_sys::Result::Err(err) => {
                        self.err = Some(err);
                        return;
                    }
                };
                bun_sys::syslog!("write({}, {}) = {}", destination_fd, read - offset, wrote);

                if wrote == 0 {
                    // Handle EOF. We can't write any more.
                    return;
                }

                offset += wrote;
                self.read_write_loop.written += wrote;
            }
        }
    }

    /// `mkdir -p dirname(destination)`, synchronously on the pool — the
    /// single retry the async path used to do via `AsyncMkdirp`. Returns true
    /// when the caller should retry the failed operation; records the failure
    /// in `self.err` otherwise.
    fn mkdirp_on_pool(&mut self) -> bool {
        bun_sys::syslog!("mkdirp");
        let result = {
            let destination = &self.destination_file_store.data.as_file();
            if !matches!(destination.pathlike, PathOrFileDescriptor::Path(_)) {
                None
            } else {
                let path_slice = destination.pathlike.path().slice();
                let dirname = bun_paths::dirname(path_slice)
                    // this shouldn't happen
                    .unwrap_or(path_slice);
                let mut node_fs_ = node_fs::NodeFS::default();
                Some(node_fs_.mkdir_recursive(&node_fs::args::Mkdir {
                    path: crate::node::PathLike::String(
                        bun_ptr::cow_slice::CowSlice::init_unchecked(dirname, false),
                    ),
                    recursive: true,
                    ..Default::default()
                }))
            }
        };
        match result {
            None => {
                self.err = Some(bun_sys::Error {
                    errno: bun_sys::SystemErrno::EINVAL as u16,
                    syscall: bun_sys::Tag::mkdir,
                    ..Default::default()
                });
                false
            }
            Some(bun_sys::Result::Ok(_)) => {
                bun_sys::syslog!("mkdirp complete");
                true
            }
            Some(bun_sys::Result::Err(err)) => {
                self.err = Some(err);
                false
            }
        }
    }

    /// Clamp to the destination blob's size (truncate + report the clamped
    /// count, as before) and apply `destination_mode` — chmod runs after the
    /// copy so it also applies when overwriting an existing file.
    fn finish_on_pool(&mut self) {
        if self.written != usize::try_from(self.size).expect("int cast") && self.size != MAX_SIZE {
            self.truncate();
            self.written = usize::try_from(self.size).expect("int cast");
        }

        // Apply destination mode if specified
        if let Some(mode) = self.destination_mode {
            if matches!(
                self.destination_file_store.data.as_file().pathlike,
                PathOrFileDescriptor::Path(_)
            ) {
                let mut pathbuf = PathBuffer::uninit();
                let result = bun_sys::chmod(
                    self.destination_file_store
                        .data
                        .as_file()
                        .pathlike
                        .path()
                        .slice_z(&mut pathbuf),
                    mode,
                );
                if let bun_sys::Result::Err(err) = result {
                    let mut err = err;
                    if let PathOrFileDescriptor::Path(p) =
                        &self.destination_file_store.data.as_file().pathlike
                    {
                        err = err.with_path(p.slice());
                    }
                    self.err = Some(err);
                }
            }
        }
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

    /// JS-thread completion: settle the promise and release everything.
    ///
    /// # Safety
    /// `this` must be the pointer boxed in `init`; consumed here.
    unsafe fn complete_on_js_thread(this: *mut Self) -> bun_event_loop::JsResult<()> {
        // SAFETY: `this` was heap-allocated in init(); reclaim ownership here.
        let mut this_box = unsafe { bun_core::heap::take(this) };
        let event_loop = this_box.event_loop;
        event_loop.unref_concurrently();

        let global_this = event_loop.global_ref();
        // `swap()` returns a `&mut JSPromise` into a GC-owned cell (not into
        // the box), so it stays valid after the box drops below.
        let promise = JSPromise::opaque_mut(this_box.promise.swap());

        let result = match this_box.err.take() {
            Some(err) => Err(err),
            None => Ok(this_box.written),
        };
        // destination/source store derefs + the promise Strong release happen
        // via field Drop here.
        drop(this_box);

        match result {
            Err(err) => {
                let err_instance = err.to_js_with_async_stack(global_this, promise);
                promise.reject(global_this, err_instance)?;
            }
            Ok(written) => {
                promise.resolve(global_this, JSValue::js_number_from_uint64(written as u64))?;
            }
        }
        Ok(())
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

pub type CopyFilePromiseTask<'a> =
    jsc::concurrent_promise_task::ConcurrentPromiseTask<'a, CopyFile<'a>>;
pub type CopyFilePromiseTaskEventLoopTask = jsc::EventLoopTask;
