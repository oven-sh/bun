use core::ffi::{c_int, c_void};
use core::mem::{offset_of, MaybeUninit};
use core::sync::atomic::{AtomicBool, Ordering};

use bun_sys::windows::libuv as uv;
use bun_sys::Fd;

bun_output::declare_scope!(PipeSource, hidden);

pub type Pipe = uv::Pipe;
pub type Tty = uv::uv_tty_t;

pub enum Source {
    Pipe(Box<Pipe>),
    Tty(Box<Tty>),
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
            // SAFETY: uv_fs_t / uv_buf_t are #[repr(C)] libuv POD; all-zero is the valid pre-init state.
            fs: unsafe { core::mem::zeroed() },
            iov: unsafe { core::mem::zeroed() },
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
        unsafe { (fs as *mut u8).sub(offset_of!(File, fs)).cast::<File>() }
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
        let cancel_result = unsafe { uv::uv_cancel((&mut self.fs as *mut uv::fs_t).cast()) };
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
        unsafe {
            uv::uv_fs_close(
                uv::Loop::get(),
                &mut self.fs,
                self.file,
                Some(Self::on_close_complete),
            );
        }
    }

    extern "C" fn on_close_complete(fs: *mut uv::fs_t) {
        // SAFETY: fs points to the .fs field of a Box<File> allocated in open_file().
        let file = unsafe { &mut *File::from_fs(fs) };
        debug_assert!(file.state == FileState::Closing);
        file.fs.deinit();
        // SAFETY: file was allocated via Box::new in open_file(); reclaim and drop.
        drop(unsafe { Box::from_raw(file as *mut File) });
    }
}

impl Source {
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

    pub fn get_handle(&self) -> *mut uv::Handle {
        match self {
            // SAFETY: uv::Pipe / uv::uv_tty_t embed uv_handle_t as their first member.
            Source::Pipe(pipe) => (pipe.as_ref() as *const Pipe as *mut Pipe).cast(),
            Source::Tty(tty) => (tty.as_ref() as *const Tty as *mut Tty).cast(),
            Source::SyncFile(_) | Source::File(_) => unreachable!(),
        }
    }

    pub fn to_stream(&self) -> *mut uv::uv_stream_t {
        match self {
            Source::Pipe(pipe) => pipe.as_stream(),
            // SAFETY: uv_tty_t embeds uv_stream_t as its first member.
            Source::Tty(tty) => (tty.as_ref() as *const Tty as *mut Tty).cast(),
            Source::SyncFile(_) | Source::File(_) => unreachable!(),
        }
    }

    pub fn get_fd(&self) -> Fd {
        match self {
            Source::Pipe(pipe) => pipe.fd(),
            Source::Tty(tty) => tty.fd(),
            Source::SyncFile(file) | Source::File(file) => Fd::from_uv(file.file),
        }
    }

    pub fn set_data(&mut self, data: *mut c_void) {
        match self {
            Source::Pipe(pipe) => pipe.data = data,
            Source::Tty(tty) => tty.data = data,
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

    pub fn ref_(&self) {
        match self {
            Source::Pipe(pipe) => pipe.ref_(),
            Source::Tty(tty) => tty.ref_(),
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub fn unref(&self) {
        match self {
            Source::Pipe(pipe) => pipe.unref(),
            Source::Tty(tty) => tty.unref(),
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
        bun_output::scoped_log!(PipeSource, "openPipe (fd = {})", fd);
        // SAFETY: uv::Pipe is a #[repr(C)] libuv struct; all-zero is a valid pre-init state.
        let mut pipe: Box<Pipe> = Box::new(unsafe { core::mem::zeroed::<Pipe>() });
        // we should never init using IPC here see ipc.zig
        match pipe.init(loop_, false) {
            bun_sys::Result::Err(err) => {
                drop(pipe);
                return bun_sys::Result::Err(err);
            }
            _ => {}
        }

        match pipe.open(fd) {
            bun_sys::Result::Err(err) => {
                // TODO(port): close_and_destroy() schedules a libuv close whose callback frees
                // the allocation. Hand the Box to libuv via into_raw so Drop does not double-free.
                let raw = Box::into_raw(pipe);
                // SAFETY: raw is a valid initialized uv::Pipe; ownership passes to libuv.
                unsafe { (*raw).close_and_destroy() };
                return bun_sys::Result::Err(err);
            }
            bun_sys::Result::Ok(()) => {}
        }

        bun_sys::Result::Ok(pipe)
    }

    pub fn open_tty(loop_: *mut uv::Loop, fd: Fd) -> bun_sys::Result<Box<Tty>> {
        bun_output::scoped_log!(PipeSource, "openTTY (fd = {})", fd);

        let uv_fd = fd.uv();

        if uv_fd == 0 {
            return stdin_tty::get_stdin_tty(loop_);
        }

        // SAFETY: uv_tty_t is a #[repr(C)] libuv struct; Box::new_zeroed yields a valid pre-init state.
        let mut tty: Box<Tty> = unsafe { Box::new_zeroed().assume_init() };
        match tty.init(loop_, uv_fd) {
            bun_sys::Result::Err(err) => {
                drop(tty);
                return bun_sys::Result::Err(err);
            }
            bun_sys::Result::Ok(()) => {}
        }

        bun_sys::Result::Ok(tty)
    }

    pub fn open_file(fd: Fd) -> Box<File> {
        debug_assert!(fd.is_valid() && fd.uv() != -1);
        bun_output::scoped_log!(PipeSource, "openFile (fd = {})", fd);
        let mut file: Box<File> = Box::new(File::default());
        file.file = fd.uv();
        file
    }

    pub fn open(loop_: *mut uv::Loop, fd: Fd) -> bun_sys::Result<Source> {
        let rc = uv::uv_guess_handle(fd.uv());
        bun_output::scoped_log!(
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

                bun_sys::Result::Err(bun_sys::Error::from_code(errno, bun_sys::Syscall::Open))
            }
        }
    }

    pub fn set_raw_mode(&self, value: bool) -> bun_sys::Result<()> {
        match self {
            Source::Tty(tty) => {
                if let Some(err) = tty
                    .set_mode(if value { uv::TtyMode::Raw } else { uv::TtyMode::Normal })
                    .to_error(bun_sys::Syscall::UvTtySetMode)
                {
                    bun_sys::Result::Err(err)
                } else {
                    bun_sys::Result::Ok(())
                }
            }
            _ => bun_sys::Result::Err(bun_sys::Error {
                errno: bun_sys::E::NOTSUP as _,
                syscall: bun_sys::Syscall::UvTtySetMode,
                fd: self.get_fd(),
                // TODO(port): bun_sys::Error remaining fields default
                ..Default::default()
            }),
        }
    }
}

pub mod stdin_tty {
    use super::*;

    static mut DATA: MaybeUninit<uv::uv_tty_t> = MaybeUninit::uninit();
    static LOCK: bun_threading::Mutex = bun_threading::Mutex::new();
    static INITIALIZED: AtomicBool = AtomicBool::new(false);

    #[inline]
    pub fn value() -> *mut uv::uv_tty_t {
        // SAFETY: address-of a static; never dereferenced here.
        unsafe { core::ptr::addr_of_mut!(DATA).cast::<uv::uv_tty_t>() }
    }

    pub fn is_stdin_tty(tty: *const Tty) -> bool {
        core::ptr::eq(tty, value())
    }

    pub(super) fn get_stdin_tty(loop_: *mut uv::Loop) -> bun_sys::Result<Box<Tty>> {
        let _guard = LOCK.lock();

        if !INITIALIZED.swap(true, Ordering::Relaxed) {
            // SAFETY: value() points to static storage sized for uv_tty_t; lock held.
            let rc = unsafe { uv::uv_tty_init(loop_, value(), 0, 0) };
            if let Some(err) = rc.to_error(bun_sys::Syscall::Open) {
                INITIALIZED.store(false, Ordering::Relaxed);
                return bun_sys::Result::Err(err);
            }
        }

        // TODO(port): UNSOUND under Box<Tty> ownership — value() is a process-global static,
        // not a heap allocation. The Zig destroy path (PipeWriter.zig onTtyClose) checks
        // is_stdin_tty() and skips freeing. Phase B must either (a) keep Source::Tty as a
        // raw *mut Tty, or (b) wrap in ManuallyDrop and gate Drop on is_stdin_tty().
        bun_sys::Result::Ok(unsafe { Box::from_raw(value()) })
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Source__setRawModeStdin(raw: bool) -> c_int {
    // CYCLEBREAK(hook): `bun_jsc::VirtualMachine::get().uv_loop()` (T6) routed
    // through `UV_LOOP_HOOK`; bun_runtime registers the fn-ptr at init.
    let uv_loop_hook = crate::UV_LOOP_HOOK.load(core::sync::atomic::Ordering::Relaxed);
    debug_assert!(!uv_loop_hook.is_null(), "UV_LOOP_HOOK unset");
    // SAFETY: hook is `unsafe fn() -> *mut uv::Loop` cast to `*mut ()`.
    let uv_loop: *mut uv::Loop =
        unsafe { core::mem::transmute::<*mut (), unsafe fn() -> *mut uv::Loop>(uv_loop_hook)() };
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
    if let Some(err) = tty
        .set_mode(if raw { uv::TtyMode::Vt } else { uv::TtyMode::Normal })
        .to_error(bun_sys::Syscall::UvTtySetMode)
    {
        return err.errno as c_int;
    }
    // TODO(port): tty is the static stdin_tty Box (see get_stdin_tty TODO); leak to avoid
    // dropping the static. Remove once Source::Tty ownership is resolved.
    core::mem::forget(tty);
    0
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/io/source.zig (375 lines)
//   confidence: medium
//   todos:      4
//   notes:      Box<Tty> vs static stdin_tty is unsound as-written; Phase B should make Source::Tty hold *mut Tty (destroy gated by is_stdin_tty) or ManuallyDrop. Pipe/File close via libuv callbacks — Box::into_raw/from_raw at handoff points.
// ──────────────────────────────────────────────────────────────────────────
