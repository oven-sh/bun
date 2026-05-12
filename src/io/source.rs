use core::ffi::{c_int, c_void};
use core::mem::{MaybeUninit, offset_of};
use core::sync::atomic::{AtomicBool, Ordering};

use bun_sys::windows::libuv as uv;
// `is_closed`/`is_active`/`fd` are default trait methods on `UvHandle`;
// the trait must be in scope for method resolution on `Box<Pipe>`/`Tty`.
use bun_sys::windows::libuv::UvHandle as _;
// `to_error` on `ReturnCode`/`ReturnCodeI64` lives in `bun_sys` (layering).
use bun_sys::Fd;
use bun_sys::ReturnCodeExt as _;

bun_core::declare_scope!(PipeSource, hidden);

pub type Pipe = uv::Pipe;
pub type Tty = uv::uv_tty_t;

pub enum Source {
    Pipe(Box<Pipe>),
    /// `BackRef` not `Box`: the stdin tty (fd 0) lives in static storage
    /// (`stdin_tty::value()`), and Box-from-static is UB. Heap-allocated ttys
    /// use `heap::alloc`; destroy paths gate `heap::take` on `!is_stdin_tty()`.
    /// In both cases the `Tty` strictly outlives every `Source` that holds it
    /// (process-static, or freed only by the libuv close callback after the
    /// `Source` is dropped), so the `BackRef` invariant holds and `Deref`
    /// yields `&Tty` without a per-site `unsafe`.
    Tty(bun_ptr::BackRef<Tty>),
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
    pub fs: uv::fs_t,

    /// Buffer descriptor for the current read operation (unused by writers).
    pub iov: uv::uv_buf_t,

    /// The file descriptor.
    pub file: uv::uv_file,

    /// Current state of the fs_t request.
    pub state: FileState,

    /// When true, file will close itself when the current operation completes.
    pub close_after_operation: bool,
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
        // PORT NOTE: std.mem.zeroes(File) — hand-written because `state` is an enum field
        // (PORTING.md forbids blanket zeroed() over enums). FileState::Deinitialized == 0.
        Self {
            fs: bun_core::ffi::zeroed(),
            iov: bun_core::ffi::zeroed(),
            file: 0,
            state: FileState::Deinitialized,
            close_after_operation: false,
        }
    }
}

impl File {
    /// Get the File struct from an fs_t pointer using field offset.
    pub unsafe fn from_fs(fs: *mut uv::fs_t) -> *mut File {
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
    pub unsafe fn from_fs_callback<'a>(
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
    pub fn can_start(&self) -> bool {
        self.state == FileState::Deinitialized && !self.fs.data.is_null()
    }

    /// Mark the file as in-use for an operation.
    /// Must only be called when can_start() returns true.
    pub fn prepare(&mut self) {
        debug_assert!(self.state == FileState::Deinitialized);
        debug_assert!(!self.fs.data.is_null());
        self.state = FileState::Operating;
        self.close_after_operation = false;
    }

    /// Request cancellation of the current operation.
    /// If successful, the callback will fire with UV_ECANCELED.
    /// If cancel fails, the operation completes normally.
    pub fn stop(&mut self) {
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
    pub fn detach(&mut self) {
        self.fs.data = core::ptr::null_mut();
        self.close_after_operation = true;
        self.stop();

        if self.state == FileState::Deinitialized {
            self.close_after_operation = false;
            self.start_close();
        }
    }

    /// Mark the operation as complete and clean up.
    /// Must be called first in the callback before processing data.
    pub fn complete(&mut self, was_canceled: bool) {
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
    /// Exclusive borrow of the `Tty` arm. `BackRef` already gives safe `Deref`
    /// for shared reads; mutation still needs the per-site exclusivity
    /// guarantee (single-threaded uv loop, no other `&Tty` live), so this
    /// remains the one centralised `unsafe` for tty mutation.
    #[inline]
    fn tty_mut(tty: &mut bun_ptr::BackRef<Tty>) -> &mut Tty {
        // SAFETY: `BackRef` invariant guarantees liveness/alignment; the uv
        // loop is single-threaded and `&mut Source` (or the sole `BackRef`
        // returned from `open_tty`) is the only access path, so no `&Tty`
        // overlaps this `&mut Tty`.
        unsafe { tty.get_mut() }
    }

    pub fn is_closed(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.is_closed(),
            Source::Tty(tty) => tty.is_closed(),
            Source::SyncFile(file) | Source::File(file) => file.file == -1,
        }
    }

    pub fn is_active(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.is_active(),
            Source::Tty(tty) => tty.is_active(),
            Source::SyncFile(_) | Source::File(_) => true,
        }
    }

    pub fn get_handle(&mut self) -> *mut uv::Handle {
        match self {
            // SAFETY: uv::Pipe / uv::uv_tty_t embed uv_handle_t as their first member.
            // `&mut self` so the returned `*mut` carries write provenance (Zig: `getHandle` returns `*uv.Handle`).
            Source::Pipe(pipe) => core::ptr::from_mut::<Pipe>(pipe.as_mut()).cast(),
            Source::Tty(tty) => tty.as_ptr().cast(),
            Source::SyncFile(_) | Source::File(_) => unreachable!(),
        }
    }

    pub fn to_stream(&mut self) -> *mut uv::uv_stream_t {
        match self {
            // SAFETY: uv::Pipe / uv::uv_tty_t embed uv_stream_t as their first member.
            // `&mut self` so the returned `*mut` carries write provenance (Zig: `toStream` returns `*uv.uv_stream_t`).
            Source::Pipe(pipe) => core::ptr::from_mut::<Pipe>(pipe.as_mut()).cast(),
            Source::Tty(tty) => tty.as_ptr().cast(),
            Source::SyncFile(_) | Source::File(_) => unreachable!(),
        }
    }

    pub fn get_fd(&self) -> Fd {
        match self {
            // `UvHandle::fd()` returns the raw `uv_os_fd_t` (a HANDLE on
            // Windows); tag kind=system so callers can round-trip through
            // `Fd::native()`.
            Source::Pipe(pipe) => Fd::from_system(pipe.fd()),
            Source::Tty(tty) => Fd::from_system(tty.fd()),
            Source::SyncFile(file) | Source::File(file) => Fd::from_uv(file.file),
        }
    }

    pub fn set_data(&mut self, data: *mut c_void) {
        match self {
            Source::Pipe(pipe) => pipe.data = data,
            Source::Tty(tty) => Self::tty_mut(tty).data = data,
            Source::SyncFile(file) | Source::File(file) => file.fs.data = data,
        }
    }

    pub fn get_data(&self) -> *mut c_void {
        match self {
            Source::Pipe(pipe) => pipe.data,
            Source::Tty(tty) => tty.data,
            Source::SyncFile(file) | Source::File(file) => file.fs.data,
        }
    }

    pub fn ref_(&mut self) {
        match self {
            Source::Pipe(pipe) => pipe.ref_(),
            Source::Tty(tty) => Self::tty_mut(tty).ref_(),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Source::Pipe(pipe) => pipe.unref(),
            Source::Tty(tty) => Self::tty_mut(tty).unref(),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub fn has_ref(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.has_ref(),
            Source::Tty(tty) => tty.has_ref(),
            Source::SyncFile(_) | Source::File(_) => false,
        }
    }

    pub fn open_pipe(loop_: *mut uv::Loop, fd: Fd) -> bun_sys::Result<Box<Pipe>> {
        bun_core::scoped_log!(PipeSource, "openPipe (fd = {})", fd);
        let mut pipe: Box<Pipe> = Box::new(bun_core::ffi::zeroed::<Pipe>());
        // we should never init using IPC here see ipc.zig
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

    pub fn open_tty(loop_: *mut uv::Loop, fd: Fd) -> bun_sys::Result<bun_ptr::BackRef<Tty>> {
        bun_core::scoped_log!(PipeSource, "openTTY (fd = {})", fd);

        let uv_fd = fd.uv();

        if uv_fd == 0 {
            return stdin_tty::get_stdin_tty(loop_);
        }

        let mut tty: Box<Tty> = bun_core::boxed_zeroed();
        if let Some(err) = tty.init(loop_, uv_fd).to_error(bun_sys::Tag::open) {
            drop(tty);
            return bun_sys::Result::Err(err);
        }

        // Heap-allocated tty: ownership is handed to libuv (the close callback
        // `heap::take`s it). The `BackRef` invariant — pointee outlives every
        // holder — is upheld because the only holder is the `Source::Tty` arm,
        // which is dropped before the close callback fires.
        bun_sys::Result::Ok(bun_ptr::BackRef::from(bun_core::heap::into_raw_nn(tty)))
    }

    pub fn open_file(fd: Fd) -> Box<File> {
        debug_assert!(fd.is_valid() && fd.uv() != -1);
        bun_core::scoped_log!(PipeSource, "openFile (fd = {})", fd);
        let mut file: Box<File> = Box::new(File::default());
        file.file = fd.uv();
        file
    }

    pub fn open(loop_: *mut uv::Loop, fd: Fd) -> bun_sys::Result<Source> {
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
            uv::HandleType::Tty => match Self::open_tty(loop_, fd) {
                bun_sys::Result::Ok(tty) => bun_sys::Result::Ok(Source::Tty(tty)),
                bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
            },
            uv::HandleType::File => bun_sys::Result::Ok(Source::File(Self::open_file(fd))),
            _ => {
                let errno = bun_sys::windows::get_last_errno();

                if errno == bun_sys::E::SUCCESS {
                    return bun_sys::Result::Ok(Source::File(Self::open_file(fd)));
                }

                bun_sys::Result::Err(bun_sys::Error::from_code(errno, bun_sys::Tag::open))
            }
        }
    }

    /// Direct accessor for the `File`/`SyncFile` arm (Zig: `source.file`).
    /// Panics on Pipe/Tty — callers gate on `matches!(.., File | SyncFile)`.
    pub fn file(&self) -> &File {
        match self {
            Source::SyncFile(file) | Source::File(file) => file,
            _ => unreachable!("Source::file() on non-file source"),
        }
    }

    pub fn set_raw_mode(&mut self, value: bool) -> bun_sys::Result<()> {
        match self {
            Source::Tty(tty) => {
                if let Some(err) = Self::tty_mut(tty)
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
                // TODO(port): bun_sys::Error remaining fields default
                ..Default::default()
            }),
        }
    }
}

pub mod stdin_tty {
    use super::*;

    // PORTING.md §Global mutable state: init guarded by `LOCK` + `INITIALIZED`;
    // afterwards only accessed by uv on the loop thread. RacyCell.
    static DATA: bun_core::RacyCell<MaybeUninit<uv::uv_tty_t>> =
        bun_core::RacyCell::new(MaybeUninit::uninit());
    static LOCK: bun_threading::Mutex = bun_threading::Mutex::new();
    static INITIALIZED: AtomicBool = AtomicBool::new(false);

    #[inline]
    pub fn value() -> *mut uv::uv_tty_t {
        DATA.get().cast::<uv::uv_tty_t>()
    }

    pub fn is_stdin_tty(tty: *const Tty) -> bool {
        core::ptr::eq(tty, value())
    }

    pub(super) fn get_stdin_tty(loop_: *mut uv::Loop) -> bun_sys::Result<bun_ptr::BackRef<Tty>> {
        // Zig spec (source.zig:247-248): `lock.lock(); defer lock.unlock();`
        // bun_threading::Mutex::lock() returns `()` — must use lock_guard() for RAII
        // unlock-on-drop, otherwise the mutex is held forever and the next call
        // (e.g. Source__setRawModeStdin → open_tty(stdin)) deadlocks/UB-relocks.
        let _guard = LOCK.lock_guard();

        if !INITIALIZED.swap(true, Ordering::Relaxed) {
            // SAFETY: value() points to static storage sized for uv_tty_t; lock held.
            let rc = unsafe { uv::uv_tty_init(loop_, value(), 0, 0) };
            if let Some(err) = rc.to_error(bun_sys::Tag::open) {
                INITIALIZED.store(false, Ordering::Relaxed);
                return bun_sys::Result::Err(err);
            }
        }

        // Destroy path must gate `heap::take` on `!is_stdin_tty(ptr)`.
        bun_sys::Result::Ok(bun_ptr::BackRef::from(
            core::ptr::NonNull::new(value()).expect("stdin_tty value() is a process-global static"),
        ))
    }
}

/// Zig spec (source.zig:357) calls `bun.jsc.VirtualMachine.get().uvLoop()` directly,
/// which is a T6 dependency. PORTING.md §Forbidden bans dep-cycle fn-ptr hooks, so
/// the uv loop is taken as a parameter instead; the C++ caller
/// (`ProcessBindingTTYWrap.cpp`) supplies `defaultGlobalObject()->uvLoop()`.
#[unsafe(no_mangle)]
pub extern "C" fn Source__setRawModeStdin(uv_loop: *mut uv::Loop, raw: bool) -> c_int {
    let mut tty = match Source::open_tty(uv_loop, Fd::stdin()) {
        bun_sys::Result::Ok(tty) => tty,
        bun_sys::Result::Err(e) => return e.errno as c_int,
    };
    // UV_TTY_MODE_RAW_VT is a variant of UV_TTY_MODE_RAW that enables control
    // sequence processing on the TTY implementer side, rather than having libuv
    // translate keypress events into control sequences, aligning behavior more
    // closely with POSIX platforms. This is also required to support some
    // control sequences at all on Windows, such as bracketed paste mode. The
    // Node.js readline implementation handles differences between these modes.
    // `tty` is the static stdin tty (fd 0 → `get_stdin_tty`), live for the
    // process — same invariant the `Source::Tty` arm relies on, so reuse the
    // shared `tty_mut` accessor.
    if let Some(err) = Source::tty_mut(&mut tty)
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

// ported from: src/io/source.zig
