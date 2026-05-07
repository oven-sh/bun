//! blocking, but off the main thread

use core::ffi::{c_int, c_void};
use core::marker::ConstParamTy;
#[cfg(windows)]
use core::mem::offset_of;

#[cfg(windows)]
use bun_aio as aio;
use bun_jsc::{self as jsc, JSGlobalObject, JSPromise, JSValue};
use bun_paths::PathBuffer;
use crate::node::fs as node_fs;
#[allow(unused_imports)]
use crate::webcore::blob::{self, SizeType, Store, StoreRef, store, MkdirpTarget, Retry, MAX_SIZE};
use crate::webcore::node_types::PathOrFileDescriptor;
use crate::node::types::PathLikeExt as _;
use bun_sys::{self, Fd, FdExt, Mode, Stat, SystemError};
#[cfg(windows)]
use bun_sys::windows::libuv;


// Local conversion: `bun_sys::SystemError` -> `bun_jsc::SystemError`. Both mirror
// the same Zig `jsc.SystemError` extern struct; map field-by-field because the
// two Rust definitions order their fields differently.
#[allow(dead_code)]
fn to_jsc_system_error(e: SystemError) -> jsc::SystemError {
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
    // TODO(port): lifetime — heap-allocated across threads; Arc vs raw needs Phase B review
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
    // TODO(port): lifetime — this struct is Box-allocated and crosses threads;
    // `'a` here is unsound in practice. Phase B: likely *const JSGlobalObject.
    pub global_this: &'a JSGlobalObject,

    pub mkdirp_if_not_exists: bool,
    pub destination_mode: Option<Mode>,
}

pub type ResultType = Result<SizeType, bun_core::Error>;

pub type Callback = fn(ctx: *mut c_void, len: ResultType);

impl MkdirpTarget for CopyFile<'_> {
    fn mkdirp_if_not_exists(&self) -> bool { self.mkdirp_if_not_exists }
    fn set_mkdirp_if_not_exists(&mut self, v: bool) { self.mkdirp_if_not_exists = v; }
    fn set_system_error(&mut self, e: SystemError) { self.system_error = Some(e); }
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
            // store.ref() / source_store.ref() — StoreRef::clone bumps the refcount
            store: Some(store.clone()),
            source_store: Some(source_store.clone()),
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
        let mut system_error: SystemError = self
            .system_error
            .take()
            .unwrap_or_default();
        if matches!(self.source_file_store.pathlike, PathOrFileDescriptor::Path(_))
            && system_error.path.is_empty()
        {
            system_error.path =
                bun_str::String::clone_utf8(self.source_file_store.pathlike.path().slice());
        }

        if system_error.message.is_empty() {
            system_error.message = bun_str::String::static_("Failed to copy file");
        }

        let instance = to_jsc_system_error(system_error)
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

        promise.resolve(self.global_this, JSValue::js_number_from_uint64(self.read_len as u64))
    }

    pub fn run(&mut self) {
        self.run_async();
    }

    pub fn do_close(&mut self) {
        let close_input = !matches!(
            self.destination_file_store.pathlike,
            PathOrFileDescriptor::Fd(_)
        ) && self.destination_fd != Fd::INVALID;
        let close_output = !matches!(
            self.source_file_store.pathlike,
            PathOrFileDescriptor::Fd(_)
        ) && self.source_fd != Fd::INVALID;

        // Apply destination mode using fchmod before closing (for POSIX platforms)
        // This ensures mode is applied even when overwriting existing files, since
        // open()'s mode argument only affects newly created files.
        // On macOS clonefile path, chmod is called separately after clonefile.
        // On Windows, this is handled via async uv_fs_chmod.
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
        // TODO(port): narrow error set
        let mut path_buf1 = PathBuffer::uninit();
        // open source file first
        // if it fails, we don't want the extra destination file hanging out
        if matches!(WHICH, IOWhich::Both | IOWhich::Source) {
            self.source_fd = match bun_sys::open(
                self.source_file_store.pathlike.path().slice_z(&mut path_buf1),
                OPEN_SOURCE_FLAGS,
                0,
            ) {
                bun_sys::Result::Ok(result) => {
                    match result.make_lib_uv_owned_for_syscall(bun_sys::Tag::open, bun_sys::ErrorCase::CloseOnFail) {
                        bun_sys::Result::Ok(result_fd) => result_fd,
                        bun_sys::Result::Err(errno) => {
                            self.system_error = Some(errno.to_system_error());
                            return Err(bun_core::errno_to_zig_err(errno.errno as i32));
                        }
                    }
                }
                bun_sys::Result::Err(errno) => {
                    self.system_error = Some(errno.to_system_error());
                    return Err(bun_core::errno_to_zig_err(errno.errno as i32));
                }
            };
        }

        if matches!(WHICH, IOWhich::Both | IOWhich::Destination) {
            loop {
                // PORT NOTE: detach `dest` lifetime from `self` (borrowck) — slice_z
                // copies into path_buf1, so build the ZStr directly from the buffer.
                let dest_len = {
                    let s = self.destination_file_store.pathlike.path().slice();
                    let n = s.len().min(path_buf1.len() - 1);
                    path_buf1[..n].copy_from_slice(&s[..n]);
                    path_buf1[n] = 0;
                    n
                };
                // SAFETY: path_buf1[dest_len] == 0 written above.
                let dest: &bun_str::ZStr = unsafe { bun_str::ZStr::from_raw(path_buf1.as_ptr(), dest_len) };
                let mode = self.destination_mode.unwrap_or(node_fs::DEFAULT_PERMISSION);
                match bun_sys::open(dest, OPEN_DESTINATION_FLAGS, mode) {
                    bun_sys::Result::Ok(result) => {
                        match result.make_lib_uv_owned_for_syscall(bun_sys::Tag::open, bun_sys::ErrorCase::CloseOnFail) {
                            bun_sys::Result::Ok(result_fd) => self.destination_fd = result_fd,
                            bun_sys::Result::Err(errno) => {
                                self.system_error = Some(errno.to_system_error());
                                return Err(bun_core::errno_to_zig_err(errno.errno as i32));
                            }
                        }
                    }
                    bun_sys::Result::Err(errno) => {
                        match blob::mkdir_if_not_exists(self, errno.clone(), dest, dest.as_bytes()) {
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

    #[cfg(target_os = "linux")]
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
        let read_len_slot: *mut SizeType = &mut self.read_len;
        let total_written_slot: *const u64 = core::ptr::addr_of!(total_written);
        scopeguard::defer! {
            // SAFETY: both raw ptrs point into the enclosing stack frame which
            // outlives this guard (dropped before fn return); disjoint fields.
            unsafe { *read_len_slot = *total_written_slot as SizeType };
        }
        // TODO(port): defer captures &mut to disjoint field via raw ptr;
        // Phase B: reshape to set read_len at each return site instead.

        #[allow(unused_mut, unused_variables)]
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
                        libc::ftruncate(dest_fd.native(), i64::try_from(total_written).expect("int cast"))
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
                    unsafe { linux::sendfile(dest_fd.native(), src_fd.native(), core::ptr::null_mut(), remain) }
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
                                libc::ftruncate(dest_fd.native(), i64::try_from(total_written).expect("int cast"))
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
                            let flags = unsafe { libc::fcntl(dest_fd.native(), libc::F_GETFL, 0 as c_int) };
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
                                    libc::ftruncate(dest_fd.native(), i64::try_from(total_written).expect("int cast"))
                                };
                                return Ok(());
                            }
                        }
                    }

                    self.system_error = Some(
                        bun_sys::Error {
                            // PORT NOTE: @intCast is identity here (E repr == Error.Int); bare `as` matches Zig @intFromEnum.
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
                            // PORT NOTE: @intCast is identity here (E repr == Error.Int); bare `as` matches Zig @intFromEnum.
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
    pub fn do_fcopy_file_with_read_write_loop_fallback(
        &mut self,
    ) -> Result<(), bun_core::Error> {
        match bun_sys::fcopyfile(
            self.source_fd,
            self.destination_fd,
            bun_sys::darwin::COPYFILE { data: true, ..Default::default() },
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
            let dest = self
                .destination_file_store
                .pathlike
                .path()
                .slice_z(&mut dest_buf);
            match bun_sys::clonefile(
                self.source_file_store.pathlike.path().slice_z(&mut source_buf),
                dest,
            ) {
                bun_sys::Result::Err(errno) => {
                    let err_path = self.destination_file_store.pathlike.path().slice().to_vec();
                    match blob::mkdir_if_not_exists(self, errno.clone(), dest, &err_path) {
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
            return; // why
        }
        #[cfg(not(windows))]
        {
            // defer task.onFinish();

            let mut stat_: Option<Stat> = None;

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
                                self.source_file_store.pathlike.path().slice_z(&mut path_buf),
                            ) {
                                bun_sys::Result::Ok(result) => {
                                    stat_ = Some(result);

                                    if bun_sys::S::ISDIR(result.st_mode) {
                                        self.system_error = Some(unsupported_directory_error());
                                        return;
                                    }

                                    if !bun_sys::S::ISREG(result.st_mode) {
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
                                        let _ = bun_sys::c::truncate(
                                            self.destination_file_store
                                                .pathlike
                                                .path()
                                                .slice_z(&mut path_buf),
                                            i64::try_from(self.max_length).expect("int cast"),
                                        );
                                        self.read_len =
                                            SizeType::try_from(self.max_length).expect("int cast");
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
                // (empty in Zig)
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
                self.max_length = (SizeType::try_from(stat.st_size).expect("int cast").min(self.max_length))
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

            #[cfg(target_os = "linux")]
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
                    let _ = bun_sys::darwin::ftruncate(
                        self.destination_fd.native(),
                        i64::try_from(self.max_length).expect("int cast"),
                    );
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
                    self.read_len =
                        total_written.min(self.max_length as u64) as SizeType;
                } else {
                    self.read_len = total_written as SizeType;
                }
                self.do_close();
                return;
            }

            #[cfg(not(any(
                target_os = "linux",
                target_os = "macos",
                target_os = "freebsd"
            )))]
            {
                compile_error!("TODO: implement copyfile");
            }
        }
    }
}

impl Drop for CopyFile<'_> {
    fn drop(&mut self) {
        // Zig deinit():
        if let PathOrFileDescriptor::Path(p) = &self.source_file_store.pathlike {
            if p.is_string() && self.system_error.is_none() {
                // TODO(port): the Zig frees the path slice here. In Rust, ownership of
                // `source_file_store.pathlike.path` should be encoded in the type so
                // Drop handles it. Phase B: verify Store::File path ownership.
            }
        }
        // self.store.?.deref() — Arc drop is automatic
        // bun.destroy(this) — Box drop is automatic
    }
}

// Port of `bun.sys.preallocate_supported` / `bun.sys.preallocate_length` (sys.zig).
// Kept local until bun_sys exports them; values match crate::node::fs.
const PREALLOCATE_SUPPORTED: bool = cfg!(target_os = "linux");
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
// CopyFileWindows (libuv async)
// ───────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub struct CopyFileWindows<'a> {
    pub destination_file_store: StoreRef,
    pub source_file_store: StoreRef,

    pub io_request: libuv::fs_t,
    pub promise: jsc::JSPromiseStrong,
    pub mkdirp_if_not_exists: bool,
    pub destination_mode: Option<Mode>,
    // per LIFETIMES.tsv: JSC_BORROW → &jsc::EventLoop
    // TODO(port): lifetime — heap-allocated and re-entered from libuv callbacks;
    // Phase B: likely *const jsc::EventLoop.
    pub event_loop: &'a jsc::EventLoop,

    pub size: SizeType,

    /// Bytes written, stored for use after async chmod completes
    pub written_bytes: usize,

    /// For mkdirp
    pub err: Option<bun_sys::Error>,

    /// When we are unable to get the original file path, we do a read-write loop that uses libuv.
    pub read_write_loop: ReadWriteLoop,
}

#[derive(Default)]
#[cfg(windows)]
pub struct ReadWriteLoop {
    pub source_fd: Fd,
    pub must_close_source_fd: bool,
    pub destination_fd: Fd,
    pub must_close_destination_fd: bool,
    pub written: usize,
    pub read_buf: Vec<u8>,
    pub uv_buf: libuv::uv_buf_t,
}

#[cfg(windows)]
impl ReadWriteLoop {
    pub fn start(&mut self, this: &mut CopyFileWindows) -> bun_sys::Result<()> {
        self.read_buf.reserve_exact(64 * 1024);

        self.read(this)
    }

    pub fn read(&mut self, this: &mut CopyFileWindows) -> bun_sys::Result<()> {
        self.read_buf.clear();
        // PORT NOTE: reshaped for borrowck — Zig's `allocatedSlice()` is the full capacity slice.
        let cap = self.read_buf.capacity();
        self.uv_buf = libuv::uv_buf_t::init_raw(self.read_buf.as_mut_ptr(), cap);
        let loop_ = this.event_loop.virtual_machine.event_loop_handle.unwrap();

        // This io_request is used for both reading and writing.
        // For now, we don't start reading the next chunk until
        // we've finished writing all the previous chunks.
        this.io_request.data = this as *mut _ as *mut c_void;

        let rc = libuv::uv_fs_read(
            loop_,
            &mut this.io_request,
            self.source_fd.uv(),
            &mut self.uv_buf as *mut _,
            1,
            -1,
            Some(on_read),
        );

        if let Some(err) = rc.to_error(bun_sys::Tag::read) {
            return bun_sys::Result::Err(err);
        }

        bun_sys::Result::Ok(())
    }

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
extern "C" fn on_read(req: *mut libuv::fs_t) {
    // SAFETY: req points to CopyFileWindows.io_request
    let this: &mut CopyFileWindows = unsafe {
        &mut *(req as *mut u8)
            .sub(offset_of!(CopyFileWindows, io_request))
            .cast::<CopyFileWindows>()
    };
    // SAFETY: req points to a live CopyFileWindows.io_request (recovered above via @fieldParentPtr).
    debug_assert!(unsafe { (*req).data } == this as *mut _ as *mut c_void);

    let source_fd = this.read_write_loop.source_fd;
    let destination_fd = this.read_write_loop.destination_fd;
    // PORT NOTE: reshaped for borrowck — `read_buf.items` is `Vec` len-slice.
    let read_buf = &mut this.read_write_loop.read_buf;

    let event_loop = this.event_loop;

    // SAFETY: req points to a live CopyFileWindows.io_request; libuv populated `result` before invoking this callback.
    let rc = unsafe { (*req).result };

    bun_sys::syslog!("uv_fs_read({}, {}) = {}", source_fd, read_buf.len(), rc.int());
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
    // SAFETY: req points to a live CopyFileWindows.io_request; deinit (uv_fs_req_cleanup) is safe to call once per completed request.
    unsafe { (*req).deinit() };
    let rc2 = libuv::uv_fs_write(
        event_loop.virtual_machine.event_loop_handle.unwrap(),
        &mut this.io_request,
        destination_fd.uv(),
        &mut this.read_write_loop.uv_buf as *mut _,
        1,
        -1,
        Some(on_write),
    );
    this.io_request.data = this as *mut _ as *mut c_void;

    if let Some(err) = rc2.to_error(bun_sys::Tag::write) {
        this.err = Some(err);
        this.on_read_write_loop_complete();
        return;
    }
}

#[cfg(windows)]
extern "C" fn on_write(req: *mut libuv::fs_t) {
    // SAFETY: req points to CopyFileWindows.io_request
    let this: &mut CopyFileWindows = unsafe {
        &mut *(req as *mut u8)
            .sub(offset_of!(CopyFileWindows, io_request))
            .cast::<CopyFileWindows>()
    };
    // SAFETY: req points to a live CopyFileWindows.io_request (recovered above via @fieldParentPtr).
    debug_assert!(unsafe { (*req).data } == this as *mut _ as *mut c_void);
    let buf_len = this.read_write_loop.read_buf.len();

    let destination_fd = this.read_write_loop.destination_fd;

    // SAFETY: req points to a live CopyFileWindows.io_request; libuv populated `result` before invoking this callback.
    let rc = unsafe { (*req).result };

    bun_sys::syslog!("uv_fs_write({}, {}) = {}", destination_fd, buf_len, rc.int());

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
        // SAFETY: req points to a live CopyFileWindows.io_request; deinit (uv_fs_req_cleanup) is safe to call once per completed request.
        unsafe { (*req).deinit() };
        this.io_request.data = this as *mut _ as *mut c_void;

        let prev = this.read_write_loop.uv_buf.slice();
        this.read_write_loop.uv_buf = libuv::uv_buf_t::init(&prev[wrote as usize..]);
        let rc2 = libuv::uv_fs_write(
            this.event_loop.virtual_machine.event_loop_handle.unwrap(),
            &mut this.io_request,
            destination_fd.uv(),
            &mut this.read_write_loop.uv_buf as *mut _,
            1,
            -1,
            Some(on_write),
        );

        if let Some(err) = rc2.to_error(bun_sys::Tag::write) {
            this.err = Some(err);
            this.on_read_write_loop_complete();
            return;
        }

        return;
    }

    // SAFETY: req points to a live CopyFileWindows.io_request; deinit (uv_fs_req_cleanup) is safe to call once per completed request.
    unsafe { (*req).deinit() };
    // TODO(port): overlapping &mut self/self.read_write_loop — restructure ReadWriteLoop::read to take disjoint fields (or move to impl CopyFileWindows) in Phase B.
    let rwl = &mut this.read_write_loop as *mut ReadWriteLoop;
    // SAFETY: rwl points to this.read_write_loop; read() only touches this.io_request/this.event_loop, so no overlapping &mut alias is live across the call.
    match unsafe { (*rwl).read(this) } {
        bun_sys::Result::Err(err) => {
            this.err = Some(err);
            this.on_read_write_loop_complete();
        }
        bun_sys::Result::Ok(()) => {}
    }
}

#[cfg(windows)]
impl<'a> CopyFileWindows<'a> {
    pub fn on_read_write_loop_complete(&mut self) {
        self.event_loop.unref_concurrently();

        if let Some(err) = self.err.take() {
            self.throw(err);
            return;
        }

        let written = self.read_write_loop.written;
        self.on_complete(written);
    }

    pub fn new(init: CopyFileWindows<'a>) -> Box<CopyFileWindows<'a>> {
        Box::new(init)
    }

    pub fn init(
        destination_file_store: StoreRef,
        source_file_store: StoreRef,
        event_loop: &'a jsc::EventLoop,
        mkdirp_if_not_exists: bool,
        size_: SizeType,
        destination_mode: Option<Mode>,
    ) -> JSValue {
        // destination_file_store.ref() / source_file_store.ref() — Arc clone
        let result = Box::into_raw(CopyFileWindows::new(CopyFileWindows {
            destination_file_store,
            source_file_store,
            promise: jsc::JSPromiseStrong::init(event_loop.global),
            // SAFETY: all-zero is a valid libuv::fs_t
            io_request: unsafe { core::mem::zeroed::<libuv::fs_t>() },
            event_loop,
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
            let fd = match bun_sys::openat_windows_t::<u8>(
                Fd::INVALID,
                path.slice(),
                if is_reading {
                    bun_sys::O::RDONLY
                } else {
                    bun_sys::O::WRONLY | bun_sys::O::CREAT
                },
                0,
            ) {
                bun_sys::Result::Ok(result) => match result.make_libuv_owned() {
                    Ok(fd) => fd,
                    Err(_) => {
                        result.close();
                        return bun_sys::Result::Err(bun_sys::Error {
                            errno: bun_sys::SystemErrno::EMFILE as c_int,
                            syscall: bun_sys::Tag::open,
                            path: Some(path.slice().into()),
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
            &mut self.destination_file_store.data.as_file().pathlike,
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
            &mut self.source_file_store.data.as_file().pathlike,
            &mut self.read_write_loop.must_close_source_fd,
            true,
        ) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(err) => {
                self.throw(err);
                return;
            }
        };

        // TODO(port): overlapping &mut self/self.read_write_loop — restructure ReadWriteLoop::start to take disjoint fields (or move to impl CopyFileWindows) in Phase B.
        let rwl = &mut self.read_write_loop as *mut ReadWriteLoop;
        // SAFETY: rwl points to self.read_write_loop; start() only touches self.io_request/self.event_loop, so no overlapping &mut alias is live across the call.
        match unsafe { (*rwl).start(self) } {
            bun_sys::Result::Err(err) => {
                self.throw(err);
            }
            bun_sys::Result::Ok(()) => {
                self.event_loop.ref_concurrently();
            }
        }
    }

    fn copyfile(&mut self) {
        // This is for making it easier for us to test this code path
        if bun_core::feature_flag::BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE.get() {
            self.prepare_read_write_loop();
            return;
        }

        let mut pathbuf1 = PathBuffer::uninit();
        let mut pathbuf2 = PathBuffer::uninit();
        // PORT NOTE: reshaped for borrowck — borrow file stores after computing paths
        let destination_file_store = &mut self.destination_file_store.data.as_file();
        let source_file_store = &mut self.source_file_store.data.as_file();

        let new_path: &bun_str::ZStr = 'brk: {
            match &destination_file_store.pathlike {
                PathOrFileDescriptor::Path(_) => {
                    break 'brk destination_file_store.pathlike.path().slice_z(&mut pathbuf1);
                }
                PathOrFileDescriptor::Fd(fd) => {
                    let fd = *fd;
                    match bun_sys::File::from(fd).kind() {
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
                                break 'brk unsafe {
                                    bun_str::ZStr::from_raw(pathbuf1.as_ptr(), len)
                                };
                            }
                        },
                    }
                }
            }
        };
        let old_path: &bun_str::ZStr = 'brk: {
            match &source_file_store.pathlike {
                PathOrFileDescriptor::Path(_) => {
                    break 'brk source_file_store.pathlike.path().slice_z(&mut pathbuf2);
                }
                PathOrFileDescriptor::Fd(fd) => {
                    let fd = *fd;
                    match bun_sys::File::from(fd).kind() {
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
                                break 'brk unsafe {
                                    bun_str::ZStr::from_raw(pathbuf2.as_ptr(), len)
                                };
                            }
                        },
                    }
                }
            }
        };
        let loop_ = self.event_loop.virtual_machine.event_loop_handle.unwrap();
        self.io_request.data = self as *mut _ as *mut c_void;

        let rc = libuv::uv_fs_copyfile(
            loop_,
            &mut self.io_request,
            old_path,
            new_path,
            0,
            Some(on_copy_file),
        );

        if let Some(errno) = rc.errno() {
            self.throw(bun_sys::Error {
                // #6336
                errno: if errno == bun_sys::SystemErrno::EPERM as c_int {
                    bun_sys::SystemErrno::ENOENT as c_int
                } else {
                    errno
                },
                syscall: bun_sys::Tag::copyfile,
                path: Some(old_path.as_bytes().into()),
                ..Default::default()
            });
            return;
        }
        self.event_loop.ref_concurrently();
    }

    pub fn throw(&mut self, err: bun_sys::Error) {
        let global_this = self.event_loop.global;
        let promise = self.promise.swap();
        let err_instance = err.to_js_with_async_stack(global_this, &promise);

        // SAFETY: VM-owned event loop is valid for the process lifetime; `enter_scope`
        // calls enter() now and exit() on drop (RAII for Zig's `loop.enter(); defer loop.exit();`).
        let _guard = unsafe {
            jsc::event_loop::EventLoop::enter_scope(self.event_loop as *const _ as *mut _)
        };
        // SAFETY: self was Box::into_raw'd in init(); destroy reclaims and drops it. self is not accessed afterward.
        unsafe { Self::destroy(self as *mut Self) };
        let _ = promise.reject(global_this, err_instance); // TODO: properly propagate exception upwards
    }

    pub fn on_complete(&mut self, written_actual: usize) {
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
                let path = self
                    .destination_file_store
                    .data
                    .as_file()
                    .pathlike
                    .path()
                    .slice_z(&mut pathbuf);
                let loop_ = self.event_loop.virtual_machine.event_loop_handle.unwrap();
                self.io_request.deinit();
                // SAFETY: all-zero is a valid libuv::fs_t
                self.io_request = unsafe { core::mem::zeroed::<libuv::fs_t>() };
                self.io_request.data = self as *mut _ as *mut c_void;

                let rc = libuv::uv_fs_chmod(
                    loop_,
                    &mut self.io_request,
                    path,
                    i32::try_from(mode).expect("int cast"),
                    Some(on_chmod),
                );

                if let Some(errno) = rc.errno() {
                    // chmod failed to start - reject the promise to report the error
                    let mut err = bun_sys::Error::from_code(
                        // SAFETY: errno is a valid SystemErrno discriminant
                        unsafe { core::mem::transmute::<c_int, bun_sys::SystemErrno>(errno) },
                        bun_sys::Tag::chmod,
                    );
                    let destination = &self.destination_file_store.data.as_file();
                    if let PathOrFileDescriptor::Path(p) = &destination.pathlike {
                        err = err.with_path(p.slice());
                    }
                    self.throw(err);
                    return;
                }
                self.event_loop.ref_concurrently();
                return;
            }
        }

        self.resolve_promise(written);
    }

    fn resolve_promise(&mut self, written: usize) {
        let global_this = self.event_loop.global;
        let promise = self.promise.swap();
        // SAFETY: VM-owned event loop is valid for the process lifetime; `enter_scope`
        // calls enter() now and exit() on drop (RAII for Zig's `loop.enter(); defer loop.exit();`).
        let _guard = unsafe {
            jsc::event_loop::EventLoop::enter_scope(self.event_loop as *const _ as *mut _)
        };

        // SAFETY: self was Box::into_raw'd in init(); destroy reclaims and drops it. self is not accessed afterward.
        unsafe { Self::destroy(self as *mut Self) };
        let _ = promise.resolve(global_this, JSValue::js_number_from_uint64(written as u64)); // TODO: properly propagate exception upwards
    }

    #[cold]
    fn truncate(&mut self) {
        // TODO: optimize this

        let mut node_fs_ = node_fs::NodeFS::default();
        let _ = node_fs_.truncate(
            node_fs::TruncateArgs {
                path: self.destination_file_store.data.as_file().pathlike.clone(),
                len: i64::try_from(self.size).expect("int cast"),
                ..Default::default()
            },
            node_fs::Flavor::Sync,
        );
    }

    /// SAFETY: `this` must have been produced by `Box::into_raw` in `init()` and
    /// not yet destroyed. After this call `this` is dangling.
    pub unsafe fn destroy(this: *mut Self) {
        (*this).read_write_loop.close();
        // destination_file_store.deref() / source_file_store.deref() — Arc Drop on Box drop
        (*this).promise.deinit();
        (*this).io_request.deinit();
        drop(Box::from_raw(this));
    }

    fn mkdirp(&mut self) {
        bun_sys::syslog!("mkdirp");
        self.mkdirp_if_not_exists = false;
        let destination = &self.destination_file_store.data.as_file();
        if !matches!(
            destination.pathlike,
            PathOrFileDescriptor::Path(_)
        ) {
            self.throw(bun_sys::Error {
                errno: bun_sys::SystemErrno::EINVAL as c_int,
                syscall: bun_sys::Tag::mkdir,
                ..Default::default()
            });
            return;
        }

        self.event_loop.ref_concurrently();
        node_fs::async_::AsyncMkdirp::new(node_fs::async_::AsyncMkdirp {
            // TODO(port): callback ABI — Zig casts &onMkdirpCompleteConcurrent to a generic completion fn ptr
            completion: on_mkdirp_complete_concurrent as *const c_void,
            completion_ctx: self as *mut _ as *mut c_void,
            path: bun_paths::dirname(destination.pathlike.path().slice())
                // this shouldn't happen
                .unwrap_or(destination.pathlike.path().slice())
                .into(),
        })
        .schedule();
    }

    fn on_mkdirp_complete(&mut self) {
        self.event_loop.unref_concurrently();

        if let Some(err) = self.err.take() {
            let mut err2 = err.clone();
            self.throw(err);
            err2.deinit();
            return;
        }

        self.copyfile();
    }
}

#[cfg(windows)]
extern "C" fn on_copy_file(req: *mut libuv::fs_t) {
    // SAFETY: req points to CopyFileWindows.io_request
    let this: &mut CopyFileWindows = unsafe {
        &mut *(req as *mut u8)
            .sub(offset_of!(CopyFileWindows, io_request))
            .cast::<CopyFileWindows>()
    };
    // SAFETY: req points to a live CopyFileWindows.io_request (recovered above via @fieldParentPtr).
    debug_assert!(unsafe { (*req).data } == this as *mut _ as *mut c_void);

    let event_loop = this.event_loop;
    event_loop.unref_concurrently();
    // SAFETY: req points to a live CopyFileWindows.io_request; libuv populated `result` before invoking this callback.
    let rc = unsafe { (*req).result };

    bun_sys::syslog!("uv_fs_copyfile() = {}", rc);
    if let Some(errno) = rc.err_enum() {
        if this.mkdirp_if_not_exists && errno == bun_sys::E::ENOENT {
            // SAFETY: req points to a live CopyFileWindows.io_request; deinit (uv_fs_req_cleanup) is safe to call once per completed request.
            unsafe { (*req).deinit() };
            this.mkdirp();
            return;
        } else {
            let mut err = bun_sys::Error::from_code(
                // #6336
                if errno == bun_sys::E::EPERM {
                    bun_sys::E::ENOENT
                } else {
                    errno
                },
                bun_sys::Tag::copyfile,
            );
            let destination = &this.destination_file_store.data.as_file();

            // we don't really know which one it is
            match &destination.pathlike {
                PathOrFileDescriptor::Path(p) => {
                    err = err.with_path(p.slice());
                }
                PathOrFileDescriptor::Fd(fd) => {
                    err = err.with_fd(*fd);
                }
            }

            this.throw(err);
        }
        return;
    }

    // SAFETY: req points to a live CopyFileWindows.io_request; libuv populated `statbuf` for a successful uv_fs_copyfile.
    let size = unsafe { (*req).statbuf.size };
    this.on_complete(size);
}

#[cfg(windows)]
extern "C" fn on_chmod(req: *mut libuv::fs_t) {
    // SAFETY: req points to CopyFileWindows.io_request
    let this: &mut CopyFileWindows = unsafe {
        &mut *(req as *mut u8)
            .sub(offset_of!(CopyFileWindows, io_request))
            .cast::<CopyFileWindows>()
    };
    // SAFETY: req points to a live CopyFileWindows.io_request (recovered above via @fieldParentPtr).
    debug_assert!(unsafe { (*req).data } == this as *mut _ as *mut c_void);

    let event_loop = this.event_loop;
    event_loop.unref_concurrently();

    // SAFETY: req points to a live CopyFileWindows.io_request; libuv populated `result` before invoking this callback.
    let rc = unsafe { (*req).result };
    if let Some(errno) = rc.err_enum() {
        let mut err = bun_sys::Error::from_code(errno, bun_sys::Tag::chmod);
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
extern "C" fn on_mkdirp_complete_concurrent(
    this: *mut CopyFileWindows,
    err_: bun_sys::Result<()>,
) {
    bun_sys::syslog!("mkdirp complete");
    // SAFETY: this is a valid CopyFileWindows from completion_ctx
    let this = unsafe { &mut *this };
    debug_assert!(this.err.is_none());
    this.err = match err_ {
        bun_sys::Result::Err(e) => Some(e),
        bun_sys::Result::Ok(()) => None,
    };
    this.event_loop.enqueue_task_concurrent(jsc::ConcurrentTask::create(
        jsc::ManagedTask::new::<CopyFileWindows, _>(CopyFileWindows::on_mkdirp_complete, this),
    ));
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

fn unsupported_directory_error() -> SystemError {
    SystemError {
        errno: bun_sys::SystemErrno::EISDIR as i32,
        message: bun_str::String::static_("That doesn't work on folders"),
        syscall: bun_str::String::static_("fstat"),
        ..SystemError::default()
    }
}

fn unsupported_non_regular_file_error() -> SystemError {
    SystemError {
        errno: bun_sys::SystemErrno::ENOTSUP as i32,
        message: bun_str::String::static_("Non-regular files aren't supported yet"),
        syscall: bun_str::String::static_("fstat"),
        ..SystemError::default()
    }
}
// TODO(port): Zig had these as `const` values; SystemError contains bun.String which
// is not const-constructible in Rust. Using fns here. Phase B: consider lazy_static.

pub type CopyFilePromiseTask<'a> = jsc::concurrent_promise_task::ConcurrentPromiseTask<'a, CopyFile<'a>>;
// TODO(port): Zig `CopyFilePromiseTask.EventLoopTask` — exact Rust associated-type
// path depends on bun_jsc::ConcurrentPromiseTask shape; using `jsc::EventLoopTask` for now.
pub type CopyFilePromiseTaskEventLoopTask = jsc::EventLoopTask;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/blob/copy_file.zig (1286 lines)
//   confidence: medium
//   todos:      12
//   notes:      JSC_BORROW lifetimes (`&JSGlobalObject`/`&EventLoop` fields) are unsound for heap-allocated async tasks; ReadWriteLoop self-borrow uses raw-ptr split (flagged TODO(port) — restructure in Phase B); CopyFileWindows::destroy is the FFI self-free path (Box::from_raw).
// ──────────────────────────────────────────────────────────────────────────
