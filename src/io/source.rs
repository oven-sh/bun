use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use bun_sys::windows::libuv as uv;
// `is_closed`/`is_active`/`fd` are default trait methods on `UvHandle`;
// the trait must be in scope for method resolution on `Box<Pipe>`/`Tty`.
use bun_sys::windows::libuv::UvHandle as _;
// `to_error` on `ReturnCode`/`ReturnCodeI64` lives in `bun_sys` (layering).
use bun_sys::Fd;
use bun_sys::ReturnCodeExt as _;

bun_core::declare_scope!(PipeSource, hidden);

pub type Pipe = uv::Pipe;
pub use uv::Tty;

pub enum Source {
    Pipe(Box<Pipe>),
    /// From `open_tty`; the close callback frees it once the source closes it.
    Tty(bun_ptr::BackRef<Tty, bun_ptr::Mut>),
    /// Borrowed from the VM's [`StdinTty`], which outlives it; never closed here.
    StdinTty(bun_ptr::BackRef<Tty, bun_ptr::Mut>),
    File(Box<File>),
    SyncFile(Box<File>),
}

/// File source for async file I/O operations using libuv.
///
/// Manages a single `uv_fs_t` through a state machine that ensures:
/// - Only one operation uses the `fs` field at a time
/// - The `fs` is properly deinitialized before reuse
/// - Cancellation is only attempted when an operation is in-flight
///
/// Typical usage pattern:
/// 1. Check `can_start()` - returns true if ready for a new operation
/// 2. Call `prepare()` - marks fs as in-use
/// 3. Set up buffer and call `uv_fs_read()` or `uv_fs_write()`
/// 4. In callback, call `complete()` first to clean up
/// 5. Process the result
///
/// Cancellation:
/// - Call `stop()` to cancel an in-flight operation
/// - The callback will still fire with UV_ECANCELED
/// - Always call `complete()` in the callback regardless of cancellation
///
/// Cleanup:
/// - Call `detach()` if parent is destroyed before operation completes
/// - File will automatically close itself after the operation finishes
#[repr(C)]
pub struct File {
    /// The fs_t for I/O operations (reads/writes) and state-machine-managed closes.
    /// State machine ensures this is only used for one operation at a time.
    pub(crate) fs: uv::fs_t,

    /// Buffer descriptor for the current read operation (unused by writers).
    pub(crate) iov: uv::uv_buf_t,

    /// The file descriptor.
    pub(crate) file: uv::uv_file,

    /// Current state of the fs_t request.
    pub(crate) state: FileState,

    /// When true, file will close itself when the current operation completes.
    pub(crate) close_after_operation: bool,

    /// A read still in flight when its reader let go of this file (`iov`
    /// points into it): the reader's buffer, kept alive here until the
    /// detached completion frees the Box, so the pending ReadFile never lands
    /// in freed memory.
    pub(crate) orphaned_read_buf: Vec<u8>,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum FileState {
    /// fs.deinit() called, ready for next operation
    #[default]
    Deinitialized,
    /// read or write operation in progress
    Operating,
    /// cancel requested, waiting for callback
    Canceling,
    /// close operation in progress
    Closing,
}

impl Default for File {
    fn default() -> Self {
        // Hand-written equivalent of zero-initialization because `state` is an enum field
        // (PORTING.md forbids blanket zeroed() over enums). FileState::Deinitialized == 0.
        Self {
            fs: bun_core::ffi::zeroed(),
            iov: bun_core::ffi::zeroed(),
            file: 0,
            state: FileState::Deinitialized,
            close_after_operation: false,
            orphaned_read_buf: Vec::new(),
        }
    }
}

impl File {
    /// Get the File struct from an fs_t pointer using field offset.
    pub(crate) unsafe fn from_fs(fs: *mut uv::fs_t) -> *mut File {
        // SAFETY: fs points to File.fs; recover the parent via offset_of.
        unsafe { bun_core::from_field_ptr!(File, fs, fs) }
    }

    /// Backref-deref accessor for libuv `fs_t` completion callbacks: snapshot
    /// the `result` / `data` POD fields, then recover the owning `&mut File`
    /// via `container_of`. Collapses the open-coded raw-deref prelude in each
    /// `on_fs_*_complete` / `on_file_read` callback into one call site.
    ///
    /// # Safety
    /// `fs` must be the live `uv_fs_t*` libuv handed to a completion callback
    /// for an operation started on a heap-boxed `File` (i.e. it points at
    /// `self.fs`). No other `&`/`&mut File` may be live for `'a` — satisfied by
    /// libuv's single-threaded callback dispatch (sole re-entry point).
    #[inline]
    pub(crate) unsafe fn from_fs_callback<'a>(
        fs: *mut uv::fs_t,
    ) -> (&'a mut File, uv::ReturnCodeI64, *mut c_void) {
        // SAFETY: caller contract — `fs` is live; read the POD `result`/`data`
        // before forming `&mut File` so the short raw read is dead (NLL) by the
        // time the parent borrow covers the same bytes.
        let (result, data) = unsafe { ((*fs).result, (*fs).data) };
        // SAFETY: caller contract — `fs` is `File.fs`; `from_fs` container_of
        // recovers the boxed parent, which outlives `'a` (callback contract).
        (unsafe { &mut *Self::from_fs(fs) }, result, data)
    }

    /// Returns true if ready to start a new operation.
    pub(crate) fn can_start(&self) -> bool {
        self.state == FileState::Deinitialized && !self.fs.data.is_null()
    }

    /// Mark the file as in-use for an operation.
    /// Must only be called when can_start() returns true.
    pub(crate) fn prepare(&mut self) {
        debug_assert!(self.state == FileState::Deinitialized);
        debug_assert!(!self.fs.data.is_null());
        self.state = FileState::Operating;
        self.close_after_operation = false;
    }

    /// Request cancellation of the current operation.
    /// If successful, the callback will fire with UV_ECANCELED.
    /// If cancel fails, the operation completes normally.
    pub(crate) fn stop(&mut self) {
        if self.state != FileState::Operating {
            return;
        }

        // SAFETY: &mut self.fs is a valid uv_fs_t request; uv_req_t is its base.
        let cancel_result =
            unsafe { uv::uv_cancel(core::ptr::from_mut::<uv::fs_t>(&mut self.fs).cast()) };
        if cancel_result == 0 {
            self.state = FileState::Canceling;
        }
    }

    /// Detach from parent and schedule automatic cleanup.
    /// If an operation is in progress, it will complete and then close the file.
    /// If idle, closes the file immediately.
    pub(crate) fn detach(&mut self) {
        self.fs.data = core::ptr::null_mut();
        self.close_after_operation = true;
        self.stop();

        if self.state == FileState::Deinitialized {
            self.close_after_operation = false;
            self.start_close();
        }
    }

    /// Detach without closing the parent-owned fd. Returns true when an
    /// operation is in flight (its callback frees the Box); false when idle
    /// (caller drops the Box).
    pub(crate) fn detach_borrowed_fd(&mut self) -> bool {
        self.fs.data = core::ptr::null_mut();
        self.stop();
        self.state != FileState::Deinitialized
    }

    /// Mark the operation as complete and clean up.
    /// Must be called first in the callback before processing data.
    pub(crate) fn complete(&mut self, was_canceled: bool) {
        debug_assert!(self.state == FileState::Operating || self.state == FileState::Canceling);
        if was_canceled {
            debug_assert!(self.state == FileState::Canceling);
        }

        self.fs.deinit();
        self.state = FileState::Deinitialized;

        if self.close_after_operation {
            self.close_after_operation = false;
            self.start_close();
        }
    }

    fn start_close(&mut self) {
        debug_assert!(self.state == FileState::Deinitialized);
        self.state = FileState::Closing;
        // SAFETY: self is heap-allocated (Box<File>) and outlives the close callback,
        // which frees it in on_close_complete.
        // Derive the fs_t pointer from the whole `*mut File` (fs is the first
        // #[repr(C)] field, offset 0) so the pointer carries full-struct
        // provenance — `on_close_complete` recovers `*mut File` via `from_fs`
        // and reads/frees bytes outside the `fs` field. `&mut self.fs` would
        // narrow provenance to the field under SB/TB and make that UB.
        unsafe {
            let fs_ptr = core::ptr::from_mut::<File>(self).cast::<uv::fs_t>();
            uv::uv_fs_close(
                uv::Loop::get(),
                fs_ptr,
                self.file,
                Some(Self::on_close_complete),
            );
        }
    }

    extern "C" fn on_close_complete(fs: *mut uv::fs_t) {
        // SAFETY: fs points to the .fs field of a Box<File> allocated in open_file().
        // Unique ownership: by the time libuv fires this callback the parent has
        // detached (fs.data == null) and no Rust `&mut File` is live; this callback
        // is the sole owner and reclaims the Box below.
        let file = unsafe { &mut *File::from_fs(fs) };
        debug_assert!(file.state == FileState::Closing);
        file.fs.deinit();
        // SAFETY: file was allocated via Box::new in open_file(); reclaim and drop.
        drop(unsafe { bun_core::heap::take(file as *mut File) });
    }
}

impl Source {
    /// The one centralised `unsafe` for tty mutation.
    #[inline]
    fn tty_mut(tty: &mut bun_ptr::BackRef<Tty, bun_ptr::Mut>) -> &mut Tty {
        // SAFETY: the pointee is live (`BackRef` invariant) and every holder
        // borrows it only within one call on the single loop thread, so no
        // other `&Tty` overlaps this `&mut Tty`.
        unsafe { tty.get_mut() }
    }

    /// For a tty source, hand libuv the handle-owned read buffer with at
    /// least `size` spare bytes (`uv::Tty::read_scratch`); `None` otherwise.
    pub(crate) fn tty_read_scratch(&mut self, size: usize) -> Option<&mut [u8]> {
        let (Source::Tty(tty) | Source::StdinTty(tty)) = self else {
            return None;
        };
        let scratch = &mut Self::tty_mut(tty).read_scratch;
        scratch.clear();
        scratch.reserve(size);
        // SAFETY: spare capacity handed to libuv to write into; the read
        // callback copies out the written prefix.
        Some(unsafe { bun_core::vec::spare_bytes_mut(scratch) })
    }

    pub fn is_closed(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.is_closed(),
            Source::Tty(tty) | Source::StdinTty(tty) => tty.uv.is_closed(),
            Source::SyncFile(file) | Source::File(file) => file.file == -1,
        }
    }

    pub(crate) fn is_active(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.is_active(),
            Source::Tty(tty) | Source::StdinTty(tty) => tty.uv.is_active(),
            Source::SyncFile(_) | Source::File(_) => true,
        }
    }

    pub(crate) fn to_stream(&mut self) -> *mut uv::uv_stream_t {
        match self {
            // SAFETY: uv::Pipe / `Tty` (via its first field, `uv::uv_tty_t`) embed
            // uv_stream_t as their first member.
            // `&mut self` so the returned `*mut` carries write provenance.
            Source::Pipe(pipe) => core::ptr::from_mut::<Pipe>(pipe.as_mut()).cast(),
            Source::Tty(tty) | Source::StdinTty(tty) => tty.as_ptr().cast(),
            Source::SyncFile(_) | Source::File(_) => unreachable!(),
        }
    }

    pub(crate) fn get_fd(&self) -> Fd {
        match self {
            // `UvHandle::fd()` returns the raw `uv_os_fd_t` (a HANDLE on
            // Windows); tag kind=system so callers can round-trip through
            // `Fd::native()`.
            Source::Pipe(pipe) => Fd::from_system(pipe.fd()),
            Source::Tty(tty) | Source::StdinTty(tty) => Fd::from_system(tty.uv.fd()),
            Source::SyncFile(file) | Source::File(file) => Fd::from_uv(file.file),
        }
    }

    pub fn set_data(&mut self, data: *mut c_void) {
        match self {
            Source::Pipe(pipe) => pipe.data = data,
            Source::Tty(tty) | Source::StdinTty(tty) => Self::tty_mut(tty).uv.data = data,
            Source::SyncFile(file) | Source::File(file) => file.fs.data = data,
        }
    }

    /// `owner` (a reader or writer) now drives this source: point the uv
    /// handle's `data` at it and record it as the one a thread teardown closes
    /// the source through (`uv::open_handles`). A file is listed only by a
    /// reader (`WindowsBufferedReader::set_source`); for anything else the
    /// file arm just sets `data`.
    pub fn set_owner(
        &mut self,
        owner: *mut c_void,
        close_via_owner: uv::open_handles::CloseViaOwner,
    ) {
        self.set_data(owner);
        match self {
            Source::Pipe(pipe) => uv::open_handles::set_owner(
                core::ptr::from_mut::<Pipe>(pipe).cast(),
                owner,
                Some(close_via_owner),
            ),
            Source::Tty(tty) => {
                uv::open_handles::set_owner(tty.as_ptr().cast(), owner, Some(close_via_owner))
            }
            Source::StdinTty(_) => {}
            Source::SyncFile(file) | Source::File(file) => uv::open_handles::set_file_owner(
                core::ptr::from_mut::<File>(file).cast(),
                owner,
                close_via_owner,
            ),
        }
    }

    /// The boxed `File`'s address — the key a reader lists it under.
    pub fn file_key(&mut self) -> Option<*mut c_void> {
        match self {
            Source::SyncFile(file) | Source::File(file) => {
                Some(core::ptr::from_mut::<File>(file).cast())
            }
            _ => None,
        }
    }

    pub fn ref_(&mut self) {
        match self {
            Source::Pipe(pipe) => pipe.ref_(),
            Source::Tty(tty) | Source::StdinTty(tty) => Self::tty_mut(tty).uv.ref_(),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Source::Pipe(pipe) => pipe.unref(),
            Source::Tty(tty) | Source::StdinTty(tty) => Self::tty_mut(tty).uv.unref(),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub(crate) fn open_pipe(loop_: *mut uv::Loop, fd: Fd) -> bun_sys::Result<Box<Pipe>> {
        bun_core::scoped_log!(PipeSource, "openPipe (fd = {})", fd);
        let mut pipe: Box<Pipe> = Box::new(bun_core::ffi::zeroed::<Pipe>());
        // we should never init using IPC here
        if let Some(err) = pipe.init(loop_, false).to_error(bun_sys::Tag::pipe) {
            drop(pipe);
            return bun_sys::Result::Err(err);
        }

        if let Some(err) = pipe.open(fd.uv()).to_error(bun_sys::Tag::open) {
            // close_and_destroy() schedules a libuv close whose callback frees
            // the allocation. Hand the Box to libuv via into_raw so Drop does not double-free.
            let raw = bun_core::heap::into_raw(pipe);
            // SAFETY: raw is a valid initialized uv::Pipe; ownership passes to libuv.
            unsafe { uv::Pipe::close_and_destroy(raw) };
            return bun_sys::Result::Err(err);
        }

        bun_sys::Result::Ok(pipe)
    }

    /// A tty of the caller's own; the shared stdin one is [`StdinTty::open`].
    pub(crate) fn open_tty(
        loop_: *mut uv::Loop,
        fd: Fd,
    ) -> bun_sys::Result<bun_ptr::BackRef<Tty, bun_ptr::Mut>> {
        bun_core::scoped_log!(PipeSource, "openTTY (fd = {})", fd);

        // Not `boxed_zeroed`: a zeroed `Vec` is UB.
        let mut tty: Box<Tty> = Box::new(Tty {
            uv: bun_core::ffi::zeroed(),
            read_scratch: Vec::new(),
        });
        if let Some(err) = tty.init(loop_, fd.uv()).to_error(bun_sys::Tag::open) {
            drop(tty);
            return bun_sys::Result::Err(err);
        }

        // Heap-allocated tty: ownership is handed to libuv (the close callback
        // `heap::take`s it). The `BackRef` invariant — pointee outlives every
        // holder — is upheld because the only holder is the `Source::Tty` arm,
        // which is dropped before the close callback fires.
        // SAFETY: heap-owned `Tty` (leaked box); write provenance from `into_raw_nn`.
        bun_sys::Result::Ok(unsafe {
            bun_ptr::BackRef::from_raw_mut(bun_core::heap::into_raw_nn(tty).as_ptr())
        })
    }

    pub fn open_file(fd: Fd) -> Box<File> {
        debug_assert!(fd.is_valid() && fd.uv() != -1);
        bun_core::scoped_log!(PipeSource, "openFile (fd = {})", fd);
        let mut file: Box<File> = Box::new(File::default());
        file.file = fd.uv();
        file
    }

    /// With a reader's context, a tty on fd 0 is that context's [`StdinTty`].
    pub(crate) fn open(
        loop_: *mut uv::Loop,
        fd: Fd,
        reader_ctx: Option<crate::EventLoopCtx>,
    ) -> bun_sys::Result<Source> {
        let rc = uv::uv_guess_handle(fd.uv());
        bun_core::scoped_log!(
            PipeSource,
            "open(fd: {}, type: {})",
            fd,
            <&'static str>::from(rc)
        );

        match rc {
            uv::HandleType::NamedPipe => match Self::open_pipe(loop_, fd) {
                bun_sys::Result::Ok(pipe) => bun_sys::Result::Ok(Source::Pipe(pipe)),
                bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
            },
            uv::HandleType::Tty => {
                if fd.uv() == 0 {
                    if let Some(shared) = reader_ctx.and_then(|ctx| NonNull::new(ctx.stdin_tty())) {
                        // SAFETY: points into the context's live rare data, on
                        // its own thread; `open` does not re-enter.
                        return unsafe { &mut *shared.as_ptr() }
                            .open(loop_)
                            .map(Source::StdinTty);
                    }
                }
                Self::open_tty(loop_, fd).map(Source::Tty)
            }
            uv::HandleType::File => bun_sys::Result::Ok(Source::File(Self::open_file(fd))),
            _ => {
                let err = bun_sys::windows::Win32Error::get();
                if err == bun_sys::windows::Win32Error::SUCCESS {
                    return bun_sys::Result::Ok(Source::File(Self::open_file(fd)));
                }
                bun_sys::Result::Err(bun_sys::Error::from_win32(err, bun_sys::Tag::open))
            }
        }
    }

    /// Direct accessor for the `File`/`SyncFile` arm.
    /// Panics on Pipe/Tty — callers gate on `matches!(.., File | SyncFile)`.
    pub(crate) fn file(&self) -> &File {
        match self {
            Source::SyncFile(file) | Source::File(file) => file,
            _ => unreachable!("Source::file() on non-file source"),
        }
    }

    pub(crate) fn set_raw_mode(&mut self, value: bool) -> bun_sys::Result<()> {
        match self {
            Source::Tty(tty) | Source::StdinTty(tty) => {
                if let Some(err) = Self::tty_mut(tty)
                    .uv
                    .set_mode(if value {
                        uv::TtyMode::Raw
                    } else {
                        uv::TtyMode::Normal
                    })
                    .to_error(bun_sys::Tag::uv_tty_set_mode)
                {
                    bun_sys::Result::Err(err)
                } else {
                    bun_sys::Result::Ok(())
                }
            }
            _ => bun_sys::Result::Err(bun_sys::Error {
                errno: bun_sys::E::NOTSUP as _,
                syscall: bun_sys::Tag::uv_tty_set_mode,
                fd: self.get_fd(),
                ..Default::default()
            }),
        }
    }
}

/// A VM's one tty over fd 0, shared so that `setRawMode` restarts the pending read.
#[derive(Default)]
pub struct StdinTty {
    /// Heap-allocated so that readers can hold `BackRef`s to it.
    tty: Option<NonNull<Tty>>,
}

impl StdinTty {
    pub(crate) fn open(
        &mut self,
        loop_: *mut uv::Loop,
    ) -> bun_sys::Result<bun_ptr::BackRef<Tty, bun_ptr::Mut>> {
        let tty = match self.tty {
            // Closed by the VM's teardown: stdin is gone for this VM.
            // SAFETY: owned by `self`; `is_closing` only reads the flags.
            Some(tty) if unsafe { (*tty.as_ptr()).uv.is_closing() } => {
                return bun_sys::Result::Err(bun_sys::Error::from_code(
                    bun_sys::E::BADF,
                    bun_sys::Tag::open,
                ));
            }
            Some(tty) => tty,
            None => {
                bun_core::scoped_log!(PipeSource, "openTTY (fd = 0, shared)");
                // Not `boxed_zeroed`: a zeroed `Vec` is UB.
                let mut tty: Box<Tty> = Box::new(Tty {
                    uv: bun_core::ffi::zeroed(),
                    read_scratch: Vec::new(),
                });
                // Whole-struct pointer as in `Tty::init`, which would also list it as heap.
                let uv_ptr = core::ptr::from_mut(&mut *tty).cast::<uv::uv_tty_t>();
                // SAFETY: `uv` is the first `#[repr(C)]` field, sized for uv_tty_t.
                let rc = unsafe { uv::uv_tty_init(loop_, uv_ptr, 0, 0) };
                if let Some(err) = rc.to_error(bun_sys::Tag::open) {
                    return bun_sys::Result::Err(err);
                }
                let tty = bun_core::heap::into_raw_nn(tty);
                uv::open_handles::add_stdin_tty(tty.as_ptr().cast::<uv::uv_tty_t>());
                self.tty = Some(tty);
                tty
            }
        };
        // SAFETY: owned by `self`, which outlives every holder; write
        // provenance from `into_raw_nn`.
        bun_sys::Result::Ok(unsafe { bun_ptr::BackRef::from_raw_mut(tty.as_ptr()) })
    }
}

impl Drop for StdinTty {
    fn drop(&mut self) {
        let Some(tty) = self.tty.take() else {
            return;
        };
        // SAFETY: leaked from a `Box` in `open`, freed nowhere else. A handle
        // nobody closed (the exiting main thread) is still linked into its
        // loop, so it is leaked rather than freed under libuv.
        unsafe {
            if (*tty.as_ptr()).uv.is_closed() {
                drop(bun_core::heap::take(tty.as_ptr()));
            }
        }
    }
}

/// `jsTTYSetMode` (`ProcessBindingTTYWrap.cpp`): the calling VM's [`StdinTty`].
#[unsafe(no_mangle)]
extern "C" fn Source__setRawModeStdin(uv_loop: *mut uv::Loop, raw: bool) -> c_int {
    let Some(shared) = NonNull::new(crate::js_vm_ctx().stdin_tty()) else {
        return bun_sys::E::NOTSUP as c_int;
    };
    // SAFETY: points into the calling VM's live rare data; JS thread, and
    // `open` does not re-enter.
    let mut tty = match unsafe { &mut *shared.as_ptr() }.open(uv_loop) {
        bun_sys::Result::Ok(tty) => tty,
        bun_sys::Result::Err(e) => return e.errno as c_int,
    };
    // UV_TTY_MODE_RAW_VT is a variant of UV_TTY_MODE_RAW that enables control
    // sequence processing on the TTY implementer side, rather than having libuv
    // translate keypress events into control sequences, aligning behavior more
    // closely with POSIX platforms. This is also required to support some
    // control sequences at all on Windows, such as bracketed paste mode. The
    // Node.js readline implementation handles differences between these modes.
    if let Some(err) = Source::tty_mut(&mut tty)
        .uv
        .set_mode(if raw {
            uv::TtyMode::Vt
        } else {
            uv::TtyMode::Normal
        })
        .to_error(bun_sys::Tag::uv_tty_set_mode)
    {
        return err.errno as c_int;
    }
    0
}
