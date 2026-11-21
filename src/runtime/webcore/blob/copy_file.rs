//! blocking, but off the main thread

use crate::node::fs as node_fs;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::{self, MkdirpTarget, Retry, store};
use crate::webcore::blob::{MAX_SIZE, SizeType, Store};
use crate::webcore::node_types::PathOrFileDescriptor;
use bun_jsc::JSGlobalObject;
use bun_jsc::{self as jsc, JSPromise, JSValue};
use bun_paths::PathBuffer;
use bun_ptr::RefPtr;
use bun_sys::File;
use bun_sys::Stat;
use bun_sys::SystemError;
use bun_sys::{self, Fd, Mode};
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::ffi::c_int;
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::marker::ConstParamTy;

// ───────────────────────────────────────────────────────────────────────────
// CopyFile (POSIX, blocking off-thread)
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
            // Not `slice_z`, which makes "" of a path that does not fit.
            let path = self.destination_file_store.pathlike.path().slice();
            let len = path.len().min(path_buf.len() - 1);
            path_buf[..len].copy_from_slice(&path[..len]);
            let dest = bun_core::ZStr::nul_terminate(path_buf, len);
            let mode = self.destination_mode.unwrap_or(node_fs::DEFAULT_PERMISSION);
            let errno = match File::open(dest, OPEN_DESTINATION_FLAGS, mode) {
                Ok(file) => return Some(file),
                Err(errno) => errno,
            };
            match blob::mkdir_if_not_exists(self, &errno, dest) {
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
                TryWith::Splice => linux::splice(src_fd.native(), dest_fd.native(), remain),
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
            let dest = self
                .destination_file_store
                .pathlike
                .path()
                .slice_z(&mut dest_buf);
            match bun_sys::clonefile(
                self.source_file_store
                    .pathlike
                    .path()
                    .slice_z(&mut source_buf),
                dest,
            ) {
                bun_sys::Result::Err(errno) => {
                    match blob::mkdir_if_not_exists(self, &errno, dest) {
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
                            let _ = bun_sys::truncate(
                                self.destination_file_store
                                    .pathlike
                                    .path()
                                    .slice_z(&mut path_buf),
                                i64::try_from(self.max_length).expect("int cast"),
                            );
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
fn read_write_loop_capped(
    src_fd: Fd,
    dest_fd: Fd,
    cap: SizeType,
    total: &mut u64,
) -> bun_sys::Result<()> {
    let mut stack_buf = [const { core::mem::MaybeUninit::uninit() }; 64 * 1024];
    let mut remaining = cap;
    while remaining > 0 {
        let want = (stack_buf.len() as SizeType).min(remaining) as usize;
        let mut buf = bun_core::vec::BorrowedBuf::from(&mut stack_buf[..want]);
        let amt = bun_sys::read_buf(src_fd, buf.unfilled())?;
        if amt == 0 {
            break;
        }
        remaining -= amt as SizeType;
        let mut slice = buf.filled();
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
// clone's own drop), bumps refs for WTF-backed slices, and only
// shares the backing for borrowed-string/Buffer variants (whose owner is kept
// alive by the `source_store` `RefPtr<Store>`). Each clone's field `Drop` frees
// exactly what it owns; the `RefPtr<Store>`s release just their Store refcounts on
// drop. No explicit `Drop` impl is needed.

// Kept local until bun_sys exports these; values match crate::node::fs.
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
    pub(crate) const fn tag(self) -> bun_sys::Tag {
        match self {
            TryWith::Sendfile => bun_sys::Tag::sendfile,
            TryWith::CopyFileRange => bun_sys::Tag::copy_file_range,
            TryWith::Splice => bun_sys::Tag::splice,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Module-level constants
// ───────────────────────────────────────────────────────────────────────────

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
