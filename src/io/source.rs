use core::cell::{Cell, UnsafeCell};
use core::ffi::{c_int, c_void};
use core::mem::MaybeUninit;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_sys::windows::libuv as uv;
// `is_closed`/`fd` are default trait methods on `UvHandle`;
// the trait must be in scope for method resolution on `Pipe`/`Tty`.
use bun_sys::windows::libuv::UvHandle as _;
// `to_error` on `ReturnCode`/`ReturnCodeI64` lives in `bun_sys` (layering).
use bun_sys::Fd;
use bun_sys::ReturnCodeExt as _;

bun_core::declare_scope!(PipeSource, hidden);

pub type Pipe = uv::Pipe;
pub use uv::Tty;

pub enum Source {
    Pipe(uv::Owned<Pipe>),
    Tty(OpenTty),
    File(OpenFile),
    SyncFile(OpenFile),
}

/// Closes on drop, unless it is the one for stdin, which is static.
pub struct OpenTty(bun_ptr::BackRef<Tty, bun_ptr::Mut>);

impl OpenTty {
    pub fn as_ptr(&self) -> *mut Tty {
        self.0.as_ptr()
    }

    /// Stops the read if the reader at `data` started it: the stdin tty is static.
    pub(crate) fn stop_reading_for(&self, data: *const c_void) {
        if core::ptr::eq(self.uv.data, data) {
            // SAFETY: a live stream.
            unsafe { uv::uv_read_stop(self.as_ptr().cast()) };
        }
    }

    /// Restarts a read, whose alloc callback borrows `read_scratch`.
    fn set_mode(&self, mode: uv::TtyMode) -> bun_sys::Result<()> {
        // SAFETY: a live tty.
        unsafe { uv::uv_tty_set_mode(self.as_ptr().cast(), mode as _) }
            .to_result(bun_sys::Tag::uv_tty_set_mode)
    }

    /// Closes the one for stdin too.
    pub(crate) fn close(mut self) {
        extern "C" fn closed(_: *mut Tty) {}
        if stdin_tty::is_stdin_tty(self.as_ptr()) {
            (*self).close(closed);
        }
    }
}

impl core::ops::Deref for OpenTty {
    type Target = Tty;
    fn deref(&self) -> &Tty {
        &self.0
    }
}

impl core::ops::DerefMut for OpenTty {
    fn deref_mut(&mut self) -> &mut Tty {
        // SAFETY: the uv loop is single-threaded, and no borrow is held across it.
        unsafe { self.0.get_mut() }
    }
}

impl Drop for OpenTty {
    fn drop(&mut self) {
        // Node only ever closes stdin on process exit.
        if !stdin_tty::is_stdin_tty(self.as_ptr()) {
            // SAFETY: the box `open_tty` made.
            drop(unsafe { uv::Owned::from_raw(self.as_ptr()) });
        }
    }
}

/// A heap [`File`]. An operation in flight keeps it past the drop, until its callback.
pub struct OpenFile(NonNull<File>);

impl OpenFile {
    pub(crate) fn as_ptr(&self) -> *mut File {
        self.0.as_ptr()
    }

    /// Reads at most `max_len` bytes into the spare capacity of `buffer`, which is moved out on `Ok`.
    pub(crate) fn submit_read(
        &self,
        buffer: &mut Vec<u8>,
        max_len: usize,
        offset: i64,
        callback: unsafe extern "C" fn(*mut uv::fs_t),
    ) -> bun_sys::Result<()> {
        assert!(self.can_start());
        self.prepare();
        let spare = buffer.spare_capacity_mut();
        let iov = uv::uv_buf_t {
            len: spare.len().min(max_len) as _,
            base: spare.as_mut_ptr().cast(),
        };
        self.buffer.set(core::mem::take(buffer));
        let (loop_, fs, file) = (self.loop_.uv_loop(), self.as_ptr().cast(), self.file);
        // SAFETY: `fs` is the first field. A busy file and its buffer stay until `on_complete`, and
        // libuv copies `iov`.
        let rc =
            unsafe { uv::uv_fs_read(loop_, fs, file, &raw const iov, 1, offset, Some(callback)) };
        // Tagged `write`: `error.syscall` is user-visible.
        rc.to_result(bun_sys::Tag::write).inspect_err(|_| {
            // SAFETY: `uv_fs_read` returned an error, so no pool thread has `fs`.
            unsafe { self.complete(false) };
            *buffer = self.buffer.take();
        })
    }

    /// The callback fires with UV_ECANCELED, or as usual if it is too late to cancel.
    pub(crate) fn stop(&self) {
        if self.state.get() != FileState::Operating {
            return;
        }

        // SAFETY: `fs`, the first field, is a request in flight; uv_req_t is its base.
        if unsafe { uv::uv_cancel(self.as_ptr().cast()) } == 0 {
            self.state.set(FileState::Canceling);
        }
    }
}

impl core::ops::Deref for OpenFile {
    type Target = File;
    fn deref(&self) -> &File {
        // SAFETY: live until `self` is dropped.
        unsafe { self.0.as_ref() }
    }
}

impl Drop for OpenFile {
    fn drop(&mut self) {
        self.parent.set(core::ptr::null_mut());
        if !self.is_busy() {
            // SAFETY: the box `open_file` made, which libuv is not using.
            unsafe { bun_core::heap::take(self.as_ptr()) }.finish();
        }
    }
}

/// File source for async file I/O operations using libuv.
/// Shared borrows only: a pool thread writes `fs` while an operation is in flight.
///
/// Manages a single `uv_fs_t` through a state machine that ensures:
/// - Only one operation uses the `fs` field at a time
/// - The `fs` is properly deinitialized before reuse
/// - Cancellation is only attempted when an operation is in-flight
///
/// Typical usage pattern:
/// 1. Check `can_start()` - returns true if ready for a new operation
/// 2. Call `prepare()` - marks fs as in-use
/// 3. Set up buffer and call `uv_fs_write()` (`submit_read()` does both steps for a read)
/// 4. In callback, call `on_complete()` first to clean up
/// 5. Process the result
///
/// Cancellation:
/// - Call `stop()` to cancel an in-flight operation
/// - The callback will still fire with UV_ECANCELED
/// - Always call `on_complete()` in the callback regardless of cancellation
#[repr(C)]
pub struct File {
    /// The fs_t for I/O operations (reads/writes) and state-machine-managed closes.
    /// State machine ensures this is only used for one operation at a time.
    fs: UnsafeCell<uv::fs_t>,

    /// The reader or writer that hears of a completion.
    pub(crate) parent: Cell<*mut c_void>,

    loop_: &'static bun_uws_sys::Loop,

    /// The file descriptor.
    pub(crate) file: uv::uv_file,

    /// Current state of the fs_t request.
    state: Cell<FileState>,

    /// Whether dropping the [`OpenFile`] closes `file`.
    pub(crate) close_on_drop: Cell<bool>,

    /// The buffer of a read in flight, or of a detached write.
    pub(crate) buffer: Cell<Vec<u8>>,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum FileState {
    /// fs.deinit() called, ready for next operation
    Deinitialized,
    /// read or write operation in progress
    Operating,
    /// cancel requested, waiting for callback
    Canceling,
}

impl File {
    /// The result of a read or write and the parent, unless that has dropped the file.
    ///
    /// # Safety
    /// `fs` is what libuv passed to the callback of an operation on an [`OpenFile`].
    pub(crate) unsafe fn on_complete(
        fs: *mut uv::fs_t,
    ) -> Option<(uv::ReturnCodeI64, *mut c_void)> {
        // SAFETY: `fs` is the first field, and with no parent this callback is what holds the box.
        unsafe {
            let this = fs.cast::<File>();
            let (result, parent) = ((*fs).result, (*this).parent.get());
            (*this).complete(result.int() == uv::UV_ECANCELED as i64);
            if parent.is_null() {
                bun_core::heap::take(this).finish();
                return None;
            }
            Some((result, parent))
        }
    }

    /// `on_complete`, and the buffer with what was read in its spare capacity.
    ///
    /// # Safety
    /// `fs` is what libuv passed to the callback of `submit_read`.
    pub(crate) unsafe fn on_read_complete(
        fs: *mut uv::fs_t,
    ) -> Option<(uv::ReturnCodeI64, Vec<u8>, *mut c_void)> {
        // SAFETY: fn contract, and the parent holds the box.
        unsafe {
            let (result, parent) = Self::on_complete(fs)?;
            Some((result, (*fs.cast::<File>()).buffer.take(), parent))
        }
    }

    pub(crate) fn is_busy(&self) -> bool {
        self.state.get() != FileState::Deinitialized
    }

    /// Returns true if ready to start a new operation.
    pub(crate) fn can_start(&self) -> bool {
        !self.is_busy() && !self.parent.get().is_null()
    }

    /// Mark the file as in-use for an operation.
    /// Must only be called when can_start() returns true.
    pub(crate) fn prepare(&self) {
        debug_assert!(self.can_start());
        self.state.set(FileState::Operating);
    }

    /// Mark the operation as complete and clean up.
    ///
    /// # Safety
    /// libuv has refused the operation, or is calling its callback.
    pub(crate) unsafe fn complete(&self, was_canceled: bool) {
        debug_assert!(self.is_busy());
        if was_canceled {
            debug_assert!(self.state.get() == FileState::Canceling);
        }

        // SAFETY: fn contract: no pool thread has `fs`.
        unsafe { (*self.fs.get()).deinit() };
        self.state.set(FileState::Deinitialized);
    }

    fn finish(self: Box<Self>) {
        extern "C" fn on_close(fs: *mut uv::fs_t) {
            // SAFETY: the box given up below.
            drop(unsafe { bun_core::heap::take(fs.cast::<File>()) });
        }
        if self.close_on_drop.get() {
            let fd = self.file;
            let fs = bun_core::heap::into_raw(self).cast::<uv::fs_t>();
            // SAFETY: `fs` is the first field of a box that lives until `on_close`.
            unsafe { uv::uv_fs_close(uv::Loop::get(), fs, fd, Some(on_close)) };
        }
    }
}

impl Source {
    pub(crate) fn file(&self) -> Option<&OpenFile> {
        match self {
            Source::SyncFile(file) | Source::File(file) => Some(file),
            Source::Pipe(_) | Source::Tty(_) => None,
        }
    }

    pub fn is_closed(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.is_closed(),
            Source::Tty(tty) => tty.uv.is_closed(),
            Source::SyncFile(file) | Source::File(file) => file.file == -1,
        }
    }

    pub(crate) fn to_stream(&mut self) -> *mut uv::uv_stream_t {
        match self {
            // SAFETY: uv::Pipe / `Tty` (via its first field, `uv::uv_tty_t`) embed
            // uv_stream_t as their first member.
            Source::Pipe(pipe) => pipe.as_ptr().cast(),
            Source::Tty(tty) => tty.as_ptr().cast(),
            Source::SyncFile(_) | Source::File(_) => unreachable!(),
        }
    }

    pub(crate) fn get_fd(&self) -> Fd {
        match self {
            // `UvHandle::fd()` returns the raw `uv_os_fd_t` (a HANDLE on
            // Windows); tag kind=system so callers can round-trip through
            // `Fd::native()`.
            Source::Pipe(pipe) => Fd::from_system(pipe.fd()),
            Source::Tty(tty) => Fd::from_system(tty.uv.fd()),
            Source::SyncFile(file) | Source::File(file) => Fd::from_uv(file.file),
        }
    }

    pub fn set_data(&mut self, data: *mut c_void) {
        match self {
            Source::Pipe(pipe) => pipe.data = data,
            Source::Tty(tty) => tty.uv.data = data,
            Source::SyncFile(file) | Source::File(file) => file.parent.set(data),
        }
    }

    /// `owner` (a reader or writer) now drives this source: point the uv
    /// handle's `data` at it and record it as the one a thread teardown closes
    /// the source through (`uv::open_handles`). A file is listed only by a
    /// reader (`WindowsBufferedReader::set_source`); for anything else the
    /// file arm just sets `parent`.
    pub fn set_owner(
        &mut self,
        owner: *mut c_void,
        close_via_owner: uv::open_handles::CloseViaOwner,
    ) {
        self.set_data(owner);
        match self {
            Source::Pipe(pipe) => pipe.set_owner(owner, close_via_owner),
            Source::Tty(tty) => {
                uv::open_handles::set_owner(tty.as_ptr().cast(), owner, Some(close_via_owner))
            }
            Source::SyncFile(file) | Source::File(file) => {
                uv::open_handles::set_file_owner(file.as_ptr().cast(), owner, close_via_owner)
            }
        }
    }

    /// The boxed `File`'s address — the key a reader lists it under.
    pub fn file_key(&self) -> Option<*mut c_void> {
        self.file().map(|file| file.as_ptr().cast())
    }

    pub fn ref_(&mut self) {
        match self {
            Source::Pipe(pipe) => pipe.ref_(),
            Source::Tty(tty) => tty.uv.ref_(),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Source::Pipe(pipe) => pipe.unref(),
            Source::Tty(tty) => tty.uv.unref(),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    /// The pipe owns `fd` on `Ok`.
    pub fn open_pipe(loop_: *mut uv::Loop, fd: Fd) -> bun_sys::Result<uv::Owned<Pipe>> {
        bun_core::scoped_log!(PipeSource, "openPipe (fd = {})", fd);
        let mut pipe = uv::Owned::<Pipe>::zeroed();
        // we should never init using IPC here
        pipe.init(loop_, false).to_result(bun_sys::Tag::pipe)?;
        pipe.open(fd.uv()).to_result(bun_sys::Tag::open)?;
        Ok(pipe)
    }

    pub(crate) fn open_tty(loop_: *mut uv::Loop, fd: Fd) -> bun_sys::Result<OpenTty> {
        bun_core::scoped_log!(PipeSource, "openTTY (fd = {})", fd);

        let uv_fd = fd.uv();

        if uv_fd == 0 {
            return stdin_tty::get_stdin_tty(loop_).map(OpenTty);
        }

        // Not `zeroed`: a zeroed `Vec` is UB.
        let mut tty = uv::Owned::new(Tty {
            uv: bun_core::ffi::zeroed(),
            read_scratch: Vec::new(),
        });
        tty.init(loop_, uv_fd).to_result(bun_sys::Tag::open)?;
        // SAFETY: lives until the `OpenTty` is dropped.
        Ok(OpenTty(unsafe {
            bun_ptr::BackRef::from_raw_mut(tty.into_raw())
        }))
    }

    pub fn open_file(loop_: &'static bun_uws_sys::Loop, fd: Fd) -> OpenFile {
        debug_assert!(fd.is_valid() && fd.uv() != -1);
        bun_core::scoped_log!(PipeSource, "openFile (fd = {})", fd);
        OpenFile(Box::into_non_null(Box::new(File {
            fs: UnsafeCell::new(bun_core::ffi::zeroed()),
            parent: Cell::new(core::ptr::null_mut()),
            loop_,
            file: fd.uv(),
            state: Cell::new(FileState::Deinitialized),
            close_on_drop: Cell::new(false),
            buffer: Cell::default(),
        })))
    }

    pub(crate) fn open(loop_: &'static bun_uws_sys::Loop, fd: Fd) -> bun_sys::Result<Source> {
        let rc = uv::uv_guess_handle(fd.uv());
        bun_core::scoped_log!(
            PipeSource,
            "open(fd: {}, type: {})",
            fd,
            <&'static str>::from(rc)
        );

        match rc {
            uv::HandleType::NamedPipe => match Self::open_pipe(loop_.uv_loop(), fd) {
                bun_sys::Result::Ok(pipe) => bun_sys::Result::Ok(Source::Pipe(pipe)),
                bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
            },
            uv::HandleType::Tty => match Self::open_tty(loop_.uv_loop(), fd) {
                bun_sys::Result::Ok(tty) => bun_sys::Result::Ok(Source::Tty(tty)),
                bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
            },
            uv::HandleType::File => bun_sys::Result::Ok(Source::File(Self::open_file(loop_, fd))),
            _ => {
                let err = bun_sys::windows::Win32Error::get();
                if err == bun_sys::windows::Win32Error::SUCCESS {
                    return bun_sys::Result::Ok(Source::File(Self::open_file(loop_, fd)));
                }
                bun_sys::Result::Err(bun_sys::Error::from_win32(err, bun_sys::Tag::open))
            }
        }
    }

    pub(crate) fn set_raw_mode(&mut self, value: bool) -> bun_sys::Result<()> {
        match self {
            Source::Tty(tty) => tty.set_mode(if value {
                uv::TtyMode::Raw
            } else {
                uv::TtyMode::Normal
            }),
            _ => bun_sys::Result::Err(bun_sys::Error {
                errno: bun_sys::E::NOTSUP as _,
                syscall: bun_sys::Tag::uv_tty_set_mode,
                fd: self.get_fd(),
                ..Default::default()
            }),
        }
    }
}

mod stdin_tty {
    use super::*;

    // PORTING.md §Global mutable state: init guarded by `LOCK` + `INITIALIZED`;
    // afterwards only accessed by uv on the loop thread. RacyCell.
    static DATA: bun_core::RacyCell<MaybeUninit<Tty>> =
        bun_core::RacyCell::new(MaybeUninit::uninit());
    static LOCK: bun_threading::Mutex = bun_threading::Mutex::new();
    static INITIALIZED: AtomicBool = AtomicBool::new(false);

    #[inline]
    fn value() -> *mut Tty {
        DATA.get().cast::<Tty>()
    }

    pub(super) fn is_stdin_tty(tty: *const Tty) -> bool {
        core::ptr::eq(tty, value())
    }

    pub(super) fn get_stdin_tty(
        loop_: *mut uv::Loop,
    ) -> bun_sys::Result<bun_ptr::BackRef<Tty, bun_ptr::Mut>> {
        // bun_threading::Mutex::lock() returns `()` — must use lock_guard() for RAII
        // unlock-on-drop, otherwise the mutex is held forever and the next call
        // (e.g. Source__setRawModeStdin → open_tty(stdin)) deadlocks/UB-relocks.
        let _guard = LOCK.lock_guard();

        if !INITIALIZED.swap(true, Ordering::Relaxed) {
            let p = value();
            // SAFETY: value() points to static storage sized for Tty; lock
            // held. uv_tty_init fills the `uv` half; `read_scratch` starts
            // empty via a raw write (the storage is uninit, so a plain
            // assignment would drop garbage).
            let rc = unsafe { uv::uv_tty_init(loop_, core::ptr::addr_of_mut!((*p).uv), 0, 0) };
            if let Some(err) = rc.to_error(bun_sys::Tag::open) {
                INITIALIZED.store(false, Ordering::Relaxed);
                return bun_sys::Result::Err(err);
            }
            // SAFETY: as above; lock held, first initialization.
            unsafe { core::ptr::addr_of_mut!((*p).read_scratch).write(Vec::new()) };
        }

        // SAFETY: `value()` is the process-global static tty (never null,
        // never freed); uv writes through it.
        bun_sys::Result::Ok(unsafe { bun_ptr::BackRef::from_raw_mut(value()) })
    }
}

/// The uv loop is taken as a parameter (reading it from the VM directly would
/// be a T6 dependency); the C++ caller
/// (`ProcessBindingTTYWrap.cpp`) supplies `defaultGlobalObject()->uvLoop()`.
#[unsafe(no_mangle)]
extern "C" fn Source__setRawModeStdin(uv_loop: *mut uv::Loop, raw: bool) -> c_int {
    let tty = match Source::open_tty(uv_loop, Fd::stdin()) {
        bun_sys::Result::Ok(tty) => tty,
        bun_sys::Result::Err(e) => return e.errno as c_int,
    };
    // UV_TTY_MODE_RAW_VT is a variant of UV_TTY_MODE_RAW that enables control
    // sequence processing on the TTY implementer side, rather than having libuv
    // translate keypress events into control sequences, aligning behavior more
    // closely with POSIX platforms. This is also required to support some
    // control sequences at all on Windows, such as bracketed paste mode. The
    // Node.js readline implementation handles differences between these modes.
    let mode = if raw {
        uv::TtyMode::Vt
    } else {
        uv::TtyMode::Normal
    };
    tty.set_mode(mode)
        .map_or_else(|err| err.errno as c_int, |()| 0)
}
