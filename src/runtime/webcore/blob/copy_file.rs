//! blocking, but off the main thread

use crate::node::fs as node_fs;
#[cfg(windows)]
use crate::node::types::PathLikeExt as _;
#[cfg(windows)]
use crate::server::file_response_stream::StreamFd;
#[cfg(not(target_os = "freebsd"))]
use crate::webcore::blob::MAX_SIZE;
#[cfg(not(windows))]
use crate::webcore::blob::creating_parents;
#[cfg(not(windows))]
use crate::webcore::blob::fd_job::Target;
#[cfg(not(windows))]
use crate::webcore::blob::write_file::{note_written, settle};
use crate::webcore::blob::{SizeType, Store};
use crate::webcore::node_types::PathOrFileDescriptor;
#[cfg(windows)]
use bun_io::{self as aio, IntrusiveUvFs as _};
#[cfg(windows)]
use bun_jsc::JSPromise;
#[cfg(not(windows))]
use bun_jsc::SystemError;
use bun_jsc::{self as jsc, JSValue};
use bun_paths::Path;
use bun_ptr::RefPtr;
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv;
use bun_sys::{self, Fd, Mode};
#[cfg(not(windows))]
use bun_sys::{File, MaybeOwnedFile, Stat};
#[cfg(windows)]
use bun_sys_jsc::ErrorJsc as _;

// ───────────────────────────────────────────────────────────────────────────
// CopyFile (POSIX, blocking off-thread)
// ───────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
pub(crate) struct CopyFile {
    destination: RefPtr<Store>,
    source: RefPtr<Store>,
    destination_file: Target,
    source_file: Target,
    /// What the store knew when the copy was asked for.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    destination_cached_mode: Mode,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    destination_is_atty: bool,
    offset: SizeType,
    max_length: SizeType,
    mkdirp: bool,
    new_mode: Option<Mode>,
    copied: Result<SizeType, Box<SystemError>>,
}

#[cfg(not(windows))]
impl jsc::JobContext for CopyFile {
    type OffThread = Self;
    type Js = jsc::JSPromiseStrong;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.copied = this.copy();
        Some(done)
    }

    fn then(
        this: Self,
        mut promise: jsc::JSPromiseStrong,
        cx: &jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        let copied = this.copied.map_err(|mut err| {
            if let PathOrFileDescriptor::Path(path) = &this.source.data.as_file().pathlike
                && err.path.is_empty()
            {
                err.path = bun_core::String::clone_utf8(path.slice());
            }
            err
        });
        if copied.is_ok() {
            note_written(&this.destination);
        }
        settle(promise.swap(), cx.global(), copied)
    }
}

#[cfg(not(windows))]
impl CopyFile {
    /// Schedule the copy on the work pool; returns its promise.
    pub(crate) fn create(
        destination: RefPtr<Store>,
        source: RefPtr<Store>,
        offset: SizeType,
        max_length: SizeType,
        cx: &bun_jsc::JsThread<'_>,
        mkdirp: bool,
        new_mode: Option<Mode>,
    ) -> JSValue {
        let copy = CopyFile {
            destination_file: Target::of(&destination),
            source_file: Target::of(&source),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            destination_cached_mode: destination.data.as_file().mode,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            destination_is_atty: destination.data.as_file().is_atty.unwrap_or(false),
            destination,
            source,
            offset,
            max_length,
            mkdirp,
            new_mode,
            copied: Ok(0),
        };
        let promise = jsc::JSPromiseStrong::init(cx.global());
        let value = promise.value();
        jsc::Job::<CopyFile>::schedule(cx, copy, promise);
        value
    }

    fn opens_destination(&self) -> bool {
        !matches!(self.destination_file, Target::Fd(_))
    }

    fn copy(&mut self) -> Result<SizeType, Box<SystemError>> {
        let source_file = &self.source_file.get();
        let destination_file = &self.destination_file.get();

        #[cfg(not(target_os = "macos"))]
        let known_stat: Option<Stat> = None;
        // clonefile() is the fastest way to copy a file, so it goes first.
        #[cfg(target_os = "macos")]
        let known_stat = match (source_file, destination_file) {
            (PathOrFileDescriptor::Path(from), PathOrFileDescriptor::Path(to))
                if self.offset == 0 =>
            {
                let from = &Path::from(from.slice());
                let stat = bun_sys::stat(from)?;
                if bun_sys::S::ISDIR(stat.st_mode as u32) {
                    return Err(unsupported_directory_error());
                }
                if bun_sys::S::ISREG(stat.st_mode as u32) {
                    let to = &Path::from(to.slice());
                    // The destination may exist or be on a network volume: then go on to fcopyfile.
                    let clone = || bun_sys::clonefile(from, to);
                    if creating_parents(&mut self.mkdirp, to.as_bytes(), clone).is_ok() {
                        return Ok(self.finish_clone(to, &stat)?);
                    }
                }
                Some(stat)
            }
            _ => None,
        };

        // Source first: if it fails, no destination file is left behind.
        let source = match source_file {
            PathOrFileDescriptor::Fd(fd) => MaybeOwnedFile::Borrowed(*fd),
            PathOrFileDescriptor::Path(path) => {
                File::open(&Path::from(path.slice()), OPEN_SOURCE_FLAGS, 0)?.into()
            }
        };
        let destination = match destination_file {
            PathOrFileDescriptor::Fd(fd) => MaybeOwnedFile::Borrowed(*fd),
            PathOrFileDescriptor::Path(path) => {
                let path = &Path::from(path.slice());
                let mode = self.new_mode.unwrap_or(node_fs::DEFAULT_PERMISSION);
                let open = || File::open(path, OPEN_DESTINATION_FLAGS, mode);
                creating_parents(&mut self.mkdirp, path.as_bytes(), open)?.into()
            }
        };

        // open() sets the mode of a new file only.
        let set_mode = || match self.new_mode {
            Some(mode) => bun_sys::fchmod(destination.fd(), mode),
            None => Ok(()),
        };
        let stat = match known_stat.map_or_else(|| bun_sys::fstat(source.fd()), Ok) {
            Ok(stat) => stat,
            Err(err) => {
                // The destination may exist already, and fstat() has the error to report.
                let _ = set_mode();
                return Err(err.into());
            }
        };
        let copied = self.copy_opened(source.fd(), destination.fd(), &stat)?;
        set_mode()?;
        Ok(copied)
    }

    #[cfg(target_os = "macos")]
    fn finish_clone(&self, to: &bun_core::ZStr, stat: &Stat) -> bun_sys::Result<SizeType> {
        let size = size_of_file(stat);
        let copied = if self.max_length != MAX_SIZE && self.max_length < size {
            let _ = bun_sys::truncate(to, self.max_length as i64);
            self.max_length
        } else {
            size
        };
        // clonefile() copies the permissions of the source.
        if let Some(mode) = self.new_mode {
            bun_sys::chmod(to, mode)?;
        }
        Ok(copied)
    }

    fn copy_opened(&self, src: Fd, dest: Fd, stat: &Stat) -> Result<SizeType, Box<SystemError>> {
        let mode = stat.st_mode as Mode;
        if bun_sys::S::ISDIR(mode) {
            return Err(unsupported_directory_error());
        }

        let mut max_length = self.max_length;
        // BSD fstat on a pipe reports bytes currently buffered in st_size;
        // only a regular-file st_size is a length.
        if stat.st_size != 0 && bun_sys::S::ISREG(mode) {
            max_length = (size_of_file(stat).min(max_length)).saturating_sub(self.offset);
            if max_length == 0 {
                return Ok(0);
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            if self.opens_destination() && max_length > PREALLOCATE_LENGTH && max_length != MAX_SIZE
            {
                let _ = bun_sys::preallocate_file(dest.native(), 0, max_length as i64);
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            use bun_sys::S::{ISCHR, ISFIFO, ISREG, ISSOCK};
            let dest_mode = self.destination_cached_mode;
            let syscall = if ISREG(mode) && (ISREG(dest_mode) || dest_mode == 0) {
                // Bun.write(Bun.file("a"), Bun.file("b"))
                TryWith::CopyFileRange
            } else if ISFIFO(mode) && ISFIFO(dest_mode) {
                // $ bun run foo.js | bun run bar.js
                TryWith::Splice
            } else if ISREG(mode) || ISCHR(mode) || ISSOCK(mode) {
                TryWith::Sendfile
            } else {
                return Err(unsupported_non_regular_file_error());
            };
            Ok(self.copy_in_kernel(syscall, src, dest, max_length)?)
        }

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            let mut copied = 0;
            // Copying from offset 0 and trimming with ftruncate() needs a destination opened with O_TRUNC.
            if !self.opens_destination() {
                read_write_loop_capped(src, dest, max_length, &mut copied)?;
                return Ok(copied);
            }

            #[cfg(target_os = "macos")]
            {
                let size = size_of_file(stat);
                let data = bun_sys::darwin::COPYFILE {
                    data: true,
                    ..Default::default()
                };
                match bun_sys::fcopyfile(src, dest, data.bits()) {
                    Ok(()) => copied = size,
                    // The file cannot seek: `bun test bun-write.test | xargs echo`
                    Err(err) if err.get_errno() == bun_sys::E::EBADF => {
                        read_write_loop(src, dest, 0, &mut copied)?
                    }
                    Err(err) => return Err(err.into()),
                }
            }
            #[cfg(target_os = "freebsd")]
            read_write_loop(src, dest, 0, &mut copied)?;

            if size_of_file(stat) > max_length {
                let _ = bun_sys::ftruncate(dest, max_length as i64);
                copied = copied.min(max_length);
            }
            Ok(copied)
        }
    }

    // TODO: this should use non-blocking I/O.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn copy_in_kernel(
        &self,
        syscall: TryWith,
        src: Fd,
        dest: Fd,
        max_length: SizeType,
    ) -> bun_sys::Result<SizeType> {
        use bun_sys::{E, linux};

        // fstat() on a FIFO, a character device or a socket reports 0: copy chunks until EOF.
        let unknown_size = max_length == MAX_SIZE || max_length == 0;
        let mut remain = if unknown_size {
            64 * 1024
        } else {
            max_length as usize
        };
        let mut copied: SizeType = 0;
        let mut may_clear_append = self.destination_is_atty;

        // Without copy_file_range(), sendfile() and splice() are probably missing too.
        let mut supported = bun_sys::copy_file::can_use_copy_file_range_syscall();
        while supported {
            let (from, to) = (src.native(), dest.native());
            let written: isize = match syscall {
                TryWith::CopyFileRange => linux::copy_file_range(from, None, to, None, remain, 0),
                TryWith::Sendfile => linux::sendfile(to, from, None, remain),
                TryWith::Splice => linux::splice(from, to, remain),
            };

            match bun_sys::get_errno(written) {
                E::SUCCESS => {
                    copied += written as SizeType;
                    if !unknown_size {
                        remain = remain.saturating_sub(written as usize);
                    }
                    if written == 0 || remain == 0 {
                        return Ok(copied);
                    }
                }
                E::ENOSYS | E::EXDEV | E::ENOTSUP => supported = false,
                // make sets O_APPEND on stdout, which sendfile() refuses: https://kylelaker.com/2018/08/31/stdout-oappend.html
                E::EINVAL if core::mem::take(&mut may_clear_append) && clear_append(dest) => {}
                // eCryptfs, for one, or a descriptor that the syscall does not work with.
                E::EINVAL if copied == 0 => supported = false,
                errno => return Err(bun_sys::Error::from_code(errno, syscall.tag())),
            }
        }

        if self.opens_destination() {
            let size = if unknown_size { 0 } else { remain };
            read_write_loop(src, dest, size, &mut copied)?;
            let _ = bun_sys::ftruncate(dest, copied as i64);
        } else {
            let cap = if unknown_size {
                MAX_SIZE
            } else {
                remain as SizeType
            };
            read_write_loop_capped(src, dest, cap, &mut copied)?;
        }
        Ok(copied)
    }
}

#[cfg(not(windows))]
fn size_of_file(stat: &Stat) -> SizeType {
    SizeType::try_from(stat.st_size).expect("int cast")
}

/// Whether it was set.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn clear_append(fd: Fd) -> bool {
    // SAFETY: F_GETFL takes no pointer.
    let flags = unsafe { libc::fcntl(fd.native(), libc::F_GETFL, 0) };
    if flags & bun_sys::O::APPEND == 0 {
        return false;
    }
    // SAFETY: F_SETFL takes an integer.
    unsafe { libc::fcntl(fd.native(), libc::F_SETFL, flags ^ bun_sys::O::APPEND) };
    true
}

#[cfg(not(windows))]
fn read_write_loop(src: Fd, dest: Fd, size: usize, total: &mut u64) -> bun_sys::Result<()> {
    let no_path = bun_core::ZStr::EMPTY;
    node_fs::NodeFS::copy_file_using_read_write_loop(no_path, no_path, src, dest, size, total)
}

#[inline(never)] // 64 KB stack buffer
#[cfg(not(windows))]
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

#[cfg(any(target_os = "linux", target_os = "android"))]
const PREALLOCATE_LENGTH: SizeType = 2048 * 1024;

#[cfg(not(windows))]
const OPEN_DESTINATION_FLAGS: i32 =
    bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC;
#[cfg(not(windows))]
const OPEN_SOURCE_FLAGS: i32 = bun_sys::O::CLOEXEC | bun_sys::O::RDONLY;

#[derive(Clone, Copy)]
#[cfg(any(target_os = "linux", target_os = "android"))]
enum TryWith {
    Sendfile,
    CopyFileRange,
    Splice,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl TryWith {
    const fn tag(self) -> bun_sys::Tag {
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
    _keep_alive: aio::JsKeepAlive,
    /// The context of the script that asked for the copy.
    pub(crate) context: jsc::ContextId,

    pub(crate) size: SizeType,

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
    pub(crate) source_fd: StreamFd,
    pub(crate) destination_fd: StreamFd,
    pub(crate) read_buf: Vec<u8>,
    pub(crate) uv_buf: libuv::uv_buf_t,
}

#[cfg(windows)]
impl Default for ReadWriteLoop {
    fn default() -> Self {
        Self {
            source_fd: StreamFd::borrowed(Fd::INVALID),
            destination_fd: StreamFd::borrowed(Fd::INVALID),
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
        let source_fd = self.read_write_loop.source_fd.get();
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
        let destination_fd = self.read_write_loop.destination_fd.get();
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
extern "C" fn on_read(req: *mut libuv::fs_t) {
    // SAFETY: `req` is the `io_request` of the box that `read_write_loop_read` left to libuv.
    let mut this = unsafe { CopyFileWindows::take_from_uv_fs(req) };

    let source_fd = this.read_write_loop.source_fd.get();
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
    let mut this = unsafe { CopyFileWindows::take_from_uv_fs(req) };
    let buf_len = this.read_write_loop.read_buf.len();

    let destination_fd = this.read_write_loop.destination_fd.get();

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

    this.written_bytes += wrote as usize;

    if (wrote as usize) < buf_len {
        if wrote == 0 {
            // Handle EOF. We can't write any more.
            this.on_read_write_loop_complete(Ok(()));
            return;
        }

        let prev_start = buf_len - this.read_write_loop.uv_buf.len as usize;
        let prev = &this.read_write_loop.read_buf[prev_start..];
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
        if let Err(err) = result {
            self.throw(err);
            return;
        }

        let written = self.written_bytes;
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
            _keep_alive: aio::JsKeepAlive::active(),
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
        is_reading: bool,
    ) -> bun_sys::Result<StreamFd> {
        if let PathOrFileDescriptor::Path(path) = pathlike {
            let fd = bun_sys::openat_windows_a(
                Fd::INVALID,
                path.slice(),
                if is_reading {
                    bun_sys::O::RDONLY
                } else {
                    bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC
                },
                0,
            )?;
            bun_sys::File::from_fd(fd)
                .make_lib_uv_owned_for_syscall(bun_sys::Tag::open)
                .map(StreamFd::from)
                .map_err(|err| err.with_path(path.slice()))
        } else {
            // We assume that this is already a uv-casted file descriptor.
            bun_sys::Result::Ok(StreamFd::borrowed(pathlike.fd()))
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
            true,
        ) {
            bun_sys::Result::Ok(fd) => fd,
            bun_sys::Result::Err(err) => {
                self.throw(err);
                return;
            }
        };

        self.read_write_loop.read_buf.reserve_exact(64 * 1024);

        self.read_write_loop_read();
    }

    /// `None` if the descriptor has no path: the NUL device, or a pipe (`cat foo.txt | bun bar.ts`).
    fn copyfile_path<'b>(
        store: &Store,
        buf: &'b mut Path,
    ) -> bun_sys::Result<Option<&'b bun_core::ZStr>> {
        let fd = match &store.data.as_file().pathlike {
            PathOrFileDescriptor::Path(path) => return Ok(Some(path.slice_z(buf))),
            PathOrFileDescriptor::Fd(fd) => *fd,
        };
        match bun_sys::File::borrow(&fd).kind()? {
            bun_sys::FileKind::Directory => Err(bun_sys::Error::from_code(
                bun_sys::E::EISDIR,
                bun_sys::Tag::open,
            )),
            bun_sys::FileKind::CharacterDevice => Ok(None),
            _ => {
                let mut fd_path = bun_paths::path_buffer_pool::get();
                let Ok(fd_path) = bun_sys::get_fd_path(fd, &mut fd_path) else {
                    return Ok(None);
                };
                buf.set(fd_path);
                Ok(Some(buf))
            }
        }
    }

    fn copyfile_paths<'b>(
        &self,
        old_buf: &'b mut Path,
        new_buf: &'b mut Path,
    ) -> bun_sys::Result<Option<(&'b bun_core::ZStr, &'b bun_core::ZStr)>> {
        let Some(new_path) = Self::copyfile_path(&self.destination_file_store, new_buf)? else {
            return Ok(None);
        };
        let old_path = Self::copyfile_path(&self.source_file_store, old_buf)?;
        Ok(old_path.map(|old_path| (old_path, new_path)))
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

        let mut pathbuf1 = Path::new();
        let mut pathbuf2 = Path::new();
        let (old_path, new_path) = match self.copyfile_paths(&mut pathbuf2, &mut pathbuf1) {
            Ok(Some(paths)) => paths,
            Ok(None) => return self.prepare_read_write_loop(),
            Err(err) => return self.throw(err),
        };
        let event_loop = self.event_loop;
        let this = bun_core::heap::into_raw(self);
        // SAFETY: the VM's loop outlives the request, libuv copies the NUL-terminated paths before
        // it returns, and it has `this` until `on_copy_file`.
        let rc = unsafe {
            libuv::uv_fs_copyfile(
                event_loop.uv_loop(),
                &raw mut (*this).io_request,
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
            // SAFETY: libuv keeps nothing of a request that it refuses.
            unsafe { bun_core::heap::take(this) }.throw(err.with_path(old_path.as_bytes()));
        }
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
                let mut pathbuf = Path::new();
                let path_ptr = self
                    .destination_file_store
                    .data
                    .as_file()
                    .pathlike
                    .path()
                    .slice_z(&mut pathbuf)
                    .as_ptr();
                let event_loop = self.event_loop;
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
                }
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
        let destination = self.destination_file_store.data.as_file();
        if !matches!(destination.pathlike, PathOrFileDescriptor::Path(_)) {
            self.throw(bun_sys::Error {
                errno: bun_sys::SystemErrno::EINVAL as u16,
                syscall: bun_sys::Tag::mkdir,
                ..Default::default()
            });
            return;
        }

        node_fs::async_::AsyncMkdirp::schedule(self);
    }

    pub(crate) fn on_mkdirp_complete(mut self: Box<Self>) {
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
    // SAFETY: `req` is the `io_request` of the box that `copyfile` left to libuv.
    let mut this = unsafe { CopyFileWindows::take_from_uv_fs(req) };

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
                    let mut buf = Path::new();
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
            let mut buf = Path::new();
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
    let this = unsafe { CopyFileWindows::take_from_uv_fs(req) };

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
impl node_fs::async_::AsyncMkdirpTarget for CopyFileWindows {
    fn directory(&self) -> &[u8] {
        let destination = self.destination_file_store.data.as_file();
        let path = destination.pathlike.path().slice();
        bun_paths::dirname(path).unwrap_or(path)
    }
    fn set_error(&mut self, err: bun_sys::Error) {
        self.err = Some(err);
    }
}

/// `mkdirp` finished on the work pool: the hop back to the JS thread.
#[cfg(windows)]
impl bun_event_loop::BoxedTask for CopyFileWindows {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::CopyFileWindowsMkdirp;
    fn release_unrun(self: Box<Self>) {}
    /// Enters no context.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Module-level constants
// ───────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
fn unsupported_directory_error() -> Box<SystemError> {
    Box::new(SystemError {
        errno: bun_sys::SystemErrno::EISDIR as i32,
        message: bun_core::String::static_("That doesn't work on folders"),
        syscall: bun_core::String::static_("fstat"),
        ..SystemError::default()
    })
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn unsupported_non_regular_file_error() -> Box<SystemError> {
    Box::new(SystemError {
        errno: bun_sys::SystemErrno::ENOTSUP as i32,
        message: bun_core::String::static_("Non-regular files aren't supported yet"),
        syscall: bun_core::String::static_("fstat"),
        ..SystemError::default()
    })
}
