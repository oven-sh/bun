use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use bun_iocp::{PipeHandle, PipeReadCb, PipeWriteCb, TtyHandle, TtyMode, TtyReadCb, TtyWriteCb};
use bun_sys::Fd;
use bun_sys::FdExt as _;
use bun_sys::windows::win_error;
use bun_windows_sys::kernel32::DuplicateHandle;
use bun_windows_sys::{
    CloseHandle, DUPLICATE_SAME_ACCESS, FALSE, GetCurrentProcess, HANDLE, INVALID_HANDLE_VALUE,
    Win32Error,
};

bun_core::declare_scope!(PipeSource, hidden);

/// Read destination registered with the engine. Heap-pinned inside the
/// source wrapper because the kernel targets it while a read is in flight
/// (parked reads included); it is freed only in the engine close callback.
pub(crate) const READ_BUF_LEN: usize = 64 * 1024;

#[inline]
fn errno_err(code: Win32Error, tag: bun_sys::Tag, fd: Fd) -> bun_sys::Error {
    bun_sys::Error {
        errno: win_error::translate(code) as _,
        syscall: tag,
        fd,
        ..Default::default()
    }
}

/// Bridge an event-loop wrapper pointer (`bun_io::Loop` = `us_loop_t`) to the
/// engine loop. The wrapper outlives every source created on it.
#[inline]
fn engine_loop(loop_: *mut crate::Loop) -> *mut bun_iocp::Loop {
    // SAFETY: `loop_` is a live `us_loop_t` created by `us_create_loop`
    // (every event-loop accessor hands that wrapper out).
    unsafe { bun_iocp::usockets::native_loop(loop_.cast()) }
}

/// A named-pipe stream source: an engine [`PipeHandle`] plus the consumer
/// bookkeeping the engine does not carry (`data` backref, shadow ref/reading
/// state, the pinned read buffer, and the originating fd).
pub struct PipeSource {
    pub handle: Box<PipeHandle>,
    /// Fd this source was opened from (`Fd::INVALID` for pre-adopted engine
    /// handles). The engine owns a private duplicate, so this fd stays valid
    /// for queries until [`Source::close`] releases it via the table protocol.
    pub fd: Fd,
    pub data: *mut c_void,
    reading: bool,
    has_ref_: bool,
    read_buf: Option<Box<[u8; READ_BUF_LEN]>>,
}

impl PipeSource {
    /// Adopt a pipe-like fd: the handle is always privately duplicated first
    /// (close must never cancel I/O on — or close — the caller's handle;
    /// stdio especially). // quirk: PIPE-19
    pub fn open(loop_: *mut crate::Loop, fd: Fd) -> bun_sys::Result<Box<PipeSource>> {
        let raw = fd.native();
        if raw == INVALID_HANDLE_VALUE {
            return bun_sys::Result::Err(bun_sys::Error::from_code(
                bun_sys::E::BADF,
                bun_sys::Tag::open,
            ));
        }
        let mut dup: HANDLE = core::ptr::null_mut();
        // SAFETY: pseudo process handles; valid out-pointer; `raw` is live for
        // the duration of the call (fd contract).
        let ok = unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                raw,
                GetCurrentProcess(),
                &raw mut dup,
                0,
                FALSE,
                DUPLICATE_SAME_ACCESS,
            )
        };
        if ok == 0 {
            return bun_sys::Result::Err(errno_err(Win32Error::get(), bun_sys::Tag::open, fd));
        }
        // SAFETY: loop wrapper is live (engine_loop contract); `dup` is owned
        // here and transfers to the engine on success.
        match unsafe { PipeHandle::open(engine_loop(loop_), dup) } {
            Ok(handle) => bun_sys::Result::Ok(Box::new(PipeSource {
                handle,
                fd,
                data: core::ptr::null_mut(),
                reading: false,
                has_ref_: true,
                read_buf: None,
            })),
            Err(err) => {
                // SAFETY: on error the engine left ownership with us.
                unsafe { CloseHandle(dup) };
                bun_sys::Result::Err(errno_err(err, bun_sys::Tag::open, fd))
            }
        }
    }

    /// Wrap a handle already adopted into the engine (pair end, accepted or
    /// connected client). Ownership of the box transfers to the source.
    pub fn from_engine(handle: Box<PipeHandle>) -> Box<PipeSource> {
        Box::new(PipeSource {
            handle,
            fd: Fd::INVALID,
            data: core::ptr::null_mut(),
            reading: false,
            has_ref_: true,
            read_buf: None,
        })
    }

    /// Start (or resume) reading into the pinned source buffer. A completion
    /// parked by a previous stop is re-delivered by the engine. // quirk: PIPE-32
    ///
    /// # Safety
    /// `data` must stay valid for every callback until reading stops or the
    /// source closes.
    pub unsafe fn read_start(&mut self, cb: PipeReadCb, data: *mut c_void) -> Win32Error {
        let buf = self
            .read_buf
            .get_or_insert_with(|| Box::new([0u8; READ_BUF_LEN]));
        let ptr = buf.as_mut_ptr();
        // SAFETY: `buf` is heap-pinned in self until the close callback frees
        // the wrapper; `data` per fn contract.
        match unsafe { self.handle.read_start(ptr, READ_BUF_LEN, cb, data) } {
            Ok(()) => {
                self.reading = true;
                Win32Error::SUCCESS
            }
            Err(err) => err,
        }
    }

    pub fn read_stop(&mut self) {
        self.reading = false;
        if !self.handle.is_closing() {
            self.handle.read_stop();
        }
    }

    /// Mark reading stopped without poking the engine — for read callbacks
    /// where the engine already delivered a terminal event (EOF/error) and
    /// stopped itself.
    pub fn mark_read_stopped(&mut self) {
        self.reading = false;
    }
}

/// A console stream source: an engine [`TtyHandle`] plus consumer
/// bookkeeping. The engine duplicates the handle internally at open.
pub struct TtySource {
    pub handle: Box<TtyHandle>,
    pub fd: Fd,
    pub data: *mut c_void,
    reading: bool,
    has_ref_: bool,
    read_buf: Option<Box<[u8; READ_BUF_LEN]>>,
}

impl TtySource {
    pub fn open(loop_: *mut crate::Loop, fd: Fd) -> bun_sys::Result<Box<TtySource>> {
        let raw = fd.native();
        if raw == INVALID_HANDLE_VALUE {
            return bun_sys::Result::Err(bun_sys::Error::from_code(
                bun_sys::E::BADF,
                bun_sys::Tag::open,
            ));
        }
        // SAFETY: loop wrapper live; the engine takes a private duplicate of
        // `raw` and never owns the original. // quirk: TTY-03
        match unsafe { TtyHandle::open(engine_loop(loop_), raw) } {
            Ok(handle) => bun_sys::Result::Ok(Box::new(TtySource {
                handle,
                fd,
                data: core::ptr::null_mut(),
                reading: false,
                has_ref_: true,
                read_buf: None,
            })),
            Err(err) => bun_sys::Result::Err(errno_err(err, bun_sys::Tag::open, fd)),
        }
    }

    /// # Safety
    /// `data` must stay valid for every callback until reading stops or the
    /// source closes.
    pub unsafe fn read_start(&mut self, cb: TtyReadCb, data: *mut c_void) -> Win32Error {
        let buf = self
            .read_buf
            .get_or_insert_with(|| Box::new([0u8; READ_BUF_LEN]));
        let ptr = buf.as_mut_ptr();
        // SAFETY: `buf` heap-pinned until the close callback; `data` per fn
        // contract.
        match unsafe { self.handle.read_start(ptr, READ_BUF_LEN, cb, data) } {
            Ok(()) => {
                self.reading = true;
                Win32Error::SUCCESS
            }
            Err(err) => err,
        }
    }

    pub fn read_stop(&mut self) {
        self.reading = false;
        if !self.handle.is_closing() {
            // Best-effort: a failed console wake means the console is gone;
            // the pending completion surfaces through the normal drain.
            let _ = self.handle.read_stop();
        }
    }

    pub fn mark_read_stopped(&mut self) {
        self.reading = false;
    }
}

pub enum Source {
    Pipe(Box<PipeSource>),
    /// `BackRef` not `Box`: the shared stdin tty (fd 0) is a process-lifetime
    /// allocation (`stdin_tty::get`) so the mode-setting entry point
    /// (`Source__setRawModeStdin`) and the stdin reader flip modes on ONE
    /// engine handle — `TtyHandle::set_mode` can only stop/restart a pending
    /// cooked read on its own handle (TTY-42). Heap ttys are freed only by
    /// the engine close callback after the `Source` is dropped, so the
    /// `BackRef` invariant (pointee outlives holder) holds for both.
    Tty(bun_ptr::BackRef<TtySource>),
    File(Box<File>),
    SyncFile(Box<File>),
}

/// File source: a plain fd. I/O is synchronous on the loop thread via
/// `bun_sys` (the POSIX file shape — files are never pollable).
pub struct File {
    pub fd: Fd,
}

impl Source {
    /// Exclusive borrow of the `Tty` arm. `BackRef` gives safe `Deref` for
    /// shared reads; mutation needs the per-site exclusivity guarantee
    /// (single-threaded loop, no other `&TtySource` live).
    #[inline]
    pub(crate) fn tty_mut(tty: &mut bun_ptr::BackRef<TtySource>) -> &mut TtySource {
        // SAFETY: `BackRef` invariant guarantees liveness/alignment; the
        // event loop is single-threaded and `&mut Source` (or the sole
        // `BackRef` from `open_tty`) is the only access path.
        unsafe { tty.get_mut() }
    }

    pub fn is_closed(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.handle.is_closing(),
            Source::Tty(tty) => tty.handle.is_closing(),
            Source::SyncFile(file) | Source::File(file) => !file.fd.is_valid(),
        }
    }

    pub fn is_active(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.reading || pipe.handle.write_queue_size() > 0,
            Source::Tty(tty) => tty.reading,
            Source::SyncFile(_) | Source::File(_) => true,
        }
    }

    pub fn get_fd(&self) -> Fd {
        match self {
            Source::Pipe(pipe) => {
                if pipe.fd.is_valid() {
                    pipe.fd
                } else {
                    let h = pipe.handle.raw_handle();
                    // Mirrors FileSink's construction guard: wrapping the
                    // INVALID_HANDLE_VALUE sentinel would mint a garbage Fd
                    // that is_valid() reports true.
                    if h as usize == usize::MAX {
                        Fd::INVALID
                    } else {
                        Fd::from_system(h)
                    }
                }
            }
            Source::Tty(tty) => tty.fd,
            Source::SyncFile(file) | Source::File(file) => file.fd,
        }
    }

    /// Store the consumer backref delivered to read/write callbacks.
    /// File sources have no callbacks (synchronous I/O), so this is a no-op
    /// for them.
    pub fn set_data(&mut self, data: *mut c_void) {
        match self {
            Source::Pipe(pipe) => pipe.data = data,
            Source::Tty(tty) => Self::tty_mut(tty).data = data,
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub fn ref_(&mut self) {
        match self {
            Source::Pipe(pipe) => {
                pipe.has_ref_ = true;
                pipe.handle.ref_();
            }
            Source::Tty(tty) => {
                let t = Self::tty_mut(tty);
                t.has_ref_ = true;
                t.handle.ref_();
            }
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub fn unref(&mut self) {
        match self {
            Source::Pipe(pipe) => {
                pipe.has_ref_ = false;
                pipe.handle.unref();
            }
            Source::Tty(tty) => {
                let t = Self::tty_mut(tty);
                t.has_ref_ = false;
                t.handle.unref();
            }
            Source::SyncFile(_) | Source::File(_) => {}
        }
    }

    pub fn has_ref(&self) -> bool {
        match self {
            Source::Pipe(pipe) => pipe.has_ref_,
            Source::Tty(tty) => tty.has_ref_,
            Source::SyncFile(_) | Source::File(_) => false,
        }
    }

    pub fn open_pipe(loop_: *mut crate::Loop, fd: Fd) -> bun_sys::Result<Box<PipeSource>> {
        bun_core::scoped_log!(PipeSource, "openPipe (fd = {})", fd);
        PipeSource::open(loop_, fd)
    }

    pub fn open_tty(
        loop_: *mut crate::Loop,
        fd: Fd,
    ) -> bun_sys::Result<bun_ptr::BackRef<TtySource>> {
        bun_core::scoped_log!(PipeSource, "openTTY (fd = {})", fd);
        if fd.stdio_tag() == Some(bun_core::Stdio::StdIn) {
            return stdin_tty::get(loop_, fd);
        }
        match TtySource::open(loop_, fd) {
            // Ownership is handed to the engine close callback
            // (`heap::take`s it); the only holder is the `Source::Tty` arm,
            // dropped before that callback fires.
            bun_sys::Result::Ok(tty) => {
                bun_sys::Result::Ok(bun_ptr::BackRef::from(bun_core::heap::into_raw_nn(tty)))
            }
            bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
        }
    }

    pub fn open_file(fd: Fd) -> Box<File> {
        debug_assert!(fd.is_valid());
        bun_core::scoped_log!(PipeSource, "openFile (fd = {})", fd);
        Box::new(File { fd })
    }

    /// `true` when `fd` refers to a pipe-kind handle (anonymous/named pipe;
    /// `GetFileType` cannot distinguish sockets, which also report pipe).
    /// Query-only probe; `false` on invalid/unclassifiable handles.
    pub fn is_pipe_kind(fd: Fd) -> bool {
        let raw = fd.native();
        if raw == INVALID_HANDLE_VALUE {
            return false;
        }
        // SAFETY: `raw` is live for the call (fd contract); the probe only
        // queries, never mutates.
        matches!(
            // SAFETY: `raw` is the live handle resolved from `fd` above.
            unsafe { bun_fdtable::classify_handle(raw) },
            Ok(bun_fdtable::FdKind::Pipe)
        )
    }

    pub fn open(loop_: *mut crate::Loop, fd: Fd) -> bun_sys::Result<Source> {
        let raw = fd.native();
        if raw == INVALID_HANDLE_VALUE {
            return bun_sys::Result::Err(bun_sys::Error::from_code(
                bun_sys::E::BADF,
                bun_sys::Tag::open,
            ));
        }
        // SAFETY: `raw` is live for the call (fd contract); the probe only
        // queries, never mutates.
        let kind = match unsafe { bun_fdtable::classify_handle(raw) } {
            Ok(kind) => kind,
            Err(err) => return bun_sys::Result::Err(errno_err(err, bun_sys::Tag::open, fd)),
        };
        bun_core::scoped_log!(PipeSource, "open(fd: {}, kind: {:?})", fd, kind);

        match kind {
            bun_fdtable::FdKind::Tty => match Self::open_tty(loop_, fd) {
                bun_sys::Result::Ok(tty) => bun_sys::Result::Ok(Source::Tty(tty)),
                bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
            },
            // `FdKind::Pipe` covers sockets too (GetFileType cannot
            // distinguish). Adoption failures propagate — a socket fails
            // with ENOTSOCK exactly like the libuv-era path did. Falling
            // back to the synchronous file shape would issue blocking reads
            // on the loop thread (an indefinite stall on a silent peer).
            bun_fdtable::FdKind::Pipe => match Self::open_pipe(loop_, fd) {
                bun_sys::Result::Ok(pipe) => bun_sys::Result::Ok(Source::Pipe(pipe)),
                bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
            },
            bun_fdtable::FdKind::File
            | bun_fdtable::FdKind::Directory
            | bun_fdtable::FdKind::Char => bun_sys::Result::Ok(Source::File(Self::open_file(fd))),
        }
    }

    /// Direct accessor for the `File`/`SyncFile` arm.
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
                let t = Self::tty_mut(tty);
                match t
                    .handle
                    .set_mode(if value { TtyMode::Raw } else { TtyMode::Normal })
                {
                    Ok(()) => bun_sys::Result::Ok(()),
                    Err(err) => {
                        bun_sys::Result::Err(errno_err(err, bun_sys::Tag::uv_tty_set_mode, t.fd))
                    }
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

    /// Submit one stream write through the engine. `cb` fires exactly once —
    /// including with an abort when the source closes first. For a `Pipe` the
    /// bytes are written zero-copy: `buf` must stay valid and unmodified
    /// until `cb` runs. For a `Tty` the units are consumed synchronously
    /// before return (the completion is still delivered asynchronously).
    /// Panics on File arms — file writes are synchronous in the callers.
    ///
    /// # Safety
    /// `data` must be valid whenever `cb` can run; for `Pipe`, `buf` per the
    /// zero-copy contract above.
    pub unsafe fn stream_write(
        &mut self,
        buf: &[u8],
        pipe_cb: PipeWriteCb,
        tty_cb: TtyWriteCb,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        match self {
            // SAFETY: forwarded fn contract (single-buffer zero-copy).
            Source::Pipe(pipe) => unsafe { pipe.handle.write(&[buf], Some(pipe_cb), data) },
            Source::Tty(tty) => {
                // WTF-8 → UTF-16 here (the engine takes UTF-16 and owns EOL
                // normalization, chunking and the cross-write surrogate
                // carry). Lone surrogates pass through so a pair split
                // across two writes is still joined. // quirk: TTY-12, TTY-13
                let mut units: Vec<u16> = vec![0; buf.len().max(1)];
                let n =
                    match bun_core::strings::try_convert_utf8_to_utf16_in_buffer(&mut units, buf) {
                        Some(out) => out.len(),
                        // UTF-16 unit count never exceeds the WTF-8 byte count.
                        None => unreachable!("utf16 output larger than utf8 input"),
                    };
                // SAFETY: forwarded fn contract; `units` is consumed
                // synchronously inside `write` (engine contract).
                unsafe {
                    Self::tty_mut(tty)
                        .handle
                        .write(&units[..n], Some(tty_cb), data)
                }
            }
            Source::SyncFile(_) | Source::File(_) => {
                unreachable!("Source::stream_write on a file source")
            }
        }
    }

    /// Begin the asynchronous close. The engine handle (a private duplicate)
    /// always closes; the originating fd is released through the table
    /// protocol only when `close_fd` is set (stdio fds are protected there).
    /// The wrapper allocation is freed in the engine close callback. The
    /// shared stdin tty is never closed (Node closes stdin only at exit).
    pub fn close(self, close_fd: bool) {
        match self {
            Source::Pipe(pipe) => {
                let fd = pipe.fd;
                let raw = Box::into_raw(pipe);
                // SAFETY: `raw` is heap-pinned until `on_pipe_source_close`
                // reclaims it (engine endgame contract).
                unsafe {
                    (*raw).reading = false;
                    (*raw)
                        .handle
                        .close(Some(on_pipe_source_close), raw.cast::<c_void>());
                }
                if close_fd && fd.is_valid() {
                    // EBADF-tolerant (PollOrFd parity): a sibling source over
                    // the same fd may have released it first.
                    let _ = fd.close_allowing_bad_file_descriptor(None);
                }
            }
            Source::Tty(tty) => {
                let p = tty.as_ptr();
                if stdin_tty::is_stdin_tty(p) {
                    // Node only ever closes stdin on process exit.
                    // SAFETY: shared stdin tty is process-lifetime.
                    unsafe { (*p).reading = false };
                    return;
                }
                // SAFETY: heap tty — pinned until `on_tty_source_close`
                // reclaims it.
                unsafe {
                    let fd = (*p).fd;
                    (*p).reading = false;
                    (*p).handle
                        .close(Some(on_tty_source_close), p.cast::<c_void>());
                    if close_fd && fd.is_valid() {
                        let _ = fd.close_allowing_bad_file_descriptor(None);
                    }
                }
            }
            Source::SyncFile(file) | Source::File(file) => {
                if close_fd && file.fd.is_valid() {
                    let _ = file.fd.close_allowing_bad_file_descriptor(None);
                }
            }
        }
    }
}

/// Engine close callback for [`PipeSource`]: every in-flight request has
/// drained — reclaim the wrapper (handle box + pinned read buffer).
unsafe fn on_pipe_source_close(_lp: &mut bun_iocp::Loop, data: *mut c_void) {
    // SAFETY: `data` is the `Box<PipeSource>` leaked in `Source::close`.
    drop(unsafe { Box::from_raw(data.cast::<PipeSource>()) });
}

/// Engine close callback for heap [`TtySource`]s (never the shared stdin tty).
unsafe fn on_tty_source_close(_lp: &mut bun_iocp::Loop, data: *mut c_void) {
    debug_assert!(!stdin_tty::is_stdin_tty(data.cast::<TtySource>()));
    // SAFETY: `data` is the heap `TtySource` leaked by `open_tty`/`close`.
    drop(unsafe { Box::from_raw(data.cast::<TtySource>()) });
}

pub mod stdin_tty {
    use super::*;
    use core::sync::atomic::{AtomicPtr, Ordering};

    /// Process-shared stdin `TtySource`, created on first use and never
    /// freed. Sharing (not lifetime) is the load-bearing property: raw-mode
    /// flips and stdin reads must ride one engine handle so `set_mode` can
    /// stop/restart the pending cooked read. // quirk: TTY-42
    static STDIN: AtomicPtr<TtySource> = AtomicPtr::new(core::ptr::null_mut());
    static LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

    pub(crate) fn is_stdin_tty(tty: *const TtySource) -> bool {
        core::ptr::eq(tty, STDIN.load(Ordering::Acquire))
    }

    pub(super) fn get(
        loop_: *mut crate::Loop,
        fd: Fd,
    ) -> bun_sys::Result<bun_ptr::BackRef<TtySource>> {
        let _guard = LOCK.lock_guard();
        let existing = STDIN.load(Ordering::Acquire);
        if !existing.is_null() {
            // SAFETY: published below with a live allocation; never freed.
            return bun_sys::Result::Ok(bun_ptr::BackRef::from(unsafe {
                NonNull::new_unchecked(existing)
            }));
        }
        match TtySource::open(loop_, fd) {
            bun_sys::Result::Ok(tty) => {
                let raw = bun_core::heap::into_raw_nn(tty);
                STDIN.store(raw.as_ptr(), Ordering::Release);
                bun_sys::Result::Ok(bun_ptr::BackRef::from(raw))
            }
            bun_sys::Result::Err(err) => bun_sys::Result::Err(err),
        }
    }
}

/// The loop wrapper is taken as a parameter (reading it from the VM directly
/// would be a T6 dependency); the C++ caller (`ProcessBindingTTYWrap.cpp`)
/// supplies `defaultGlobalObject()->uvLoop()`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Source__setRawModeStdin(loop_: *mut crate::Loop, raw: bool) -> c_int {
    let mut tty = match Source::open_tty(loop_, Fd::stdin()) {
        bun_sys::Result::Ok(tty) => tty,
        bun_sys::Result::Err(e) => return e.errno as c_int,
    };
    // RawVt asks the console host to translate keys into VT control
    // sequences (rather than translating keypress records ourselves),
    // aligning behavior with POSIX platforms and enabling sequences such as
    // bracketed paste mode. The Node.js readline implementation handles the
    // differences between these modes. `tty` is the shared stdin tty —
    // process-lifetime, same invariant the `Source::Tty` arm relies on.
    if let Err(err) = Source::tty_mut(&mut tty).handle.set_mode(if raw {
        TtyMode::RawVt
    } else {
        TtyMode::Normal
    }) {
        return win_error::translate(err) as c_int;
    }
    0
}

/// `tty_wrap` setRawMode bridge — the `uv_tty_set_mode` replacement. Takes
/// libuv mode ints (0 normal, 1 raw, 3 raw-vt; 2 "io" is POSIX-only and
/// unsupported on Windows, as in libuv's win/tty.c). Returns 0 or +errno.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Tty__setMode(
    loop_: *mut crate::Loop,
    fd: c_int,
    mode: c_int,
) -> c_int {
    let mode = match mode {
        0 => TtyMode::Normal,
        1 => TtyMode::Raw,
        3 => TtyMode::RawVt,
        2 => return bun_sys::E::NOTSUP as c_int,
        _ => return bun_sys::E::INVAL as c_int,
    };
    let mut tty = match Source::open_tty(loop_, Fd::from_js_fd(fd)) {
        bun_sys::Result::Ok(tty) => tty,
        bun_sys::Result::Err(e) => return e.errno as c_int,
    };
    let r = match Source::tty_mut(&mut tty).handle.set_mode(mode) {
        Ok(()) => 0,
        Err(err) => win_error::translate(err) as c_int,
    };
    if !stdin_tty::is_stdin_tty(tty.as_ptr()) {
        // One-shot probe handle: release through the engine close protocol
        // (the shared stdin tty stays alive for the process lifetime).
        Source::Tty(tty).close(false);
    }
    r
}

/// `uv_tty_reset_mode` bridge (Windows): restore the startup-captured
/// console input mode iff a raw switch armed the reset. Idempotent and
/// lock-free (safe from exit and crash paths).
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Tty__resetMode() {
    bun_iocp::tty::reset_mode();
}

/// `tty_wrap` getWindowSize bridge: visible window rect (not the buffer —
/// buffer height is scrollback) of the console behind a JS fd. 0 or +errno.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Tty__getWindowSize(
    fd: c_int,
    width: *mut c_int,
    height: *mut c_int,
) -> c_int {
    use bun_windows_sys::{CONSOLE_SCREEN_BUFFER_INFO, COORD, SMALL_RECT};
    if fd < 0 {
        return bun_sys::E::BADF as c_int;
    }
    let handle = Fd::from_js_fd(fd).native();
    if handle == INVALID_HANDLE_VALUE {
        return bun_sys::E::BADF as c_int;
    }
    let mut info = CONSOLE_SCREEN_BUFFER_INFO {
        dwSize: COORD { X: 0, Y: 0 },
        dwCursorPosition: COORD { X: 0, Y: 0 },
        wAttributes: 0,
        srWindow: SMALL_RECT {
            Left: 0,
            Top: 0,
            Right: 0,
            Bottom: 0,
        },
        dwMaximumWindowSize: COORD { X: 0, Y: 0 },
    };
    // SAFETY: `handle` is live for the duration of the call (fd-table
    // contract — a stale handle fails the query); valid out-pointer.
    if unsafe { bun_windows_sys::kernel32::GetConsoleScreenBufferInfo(handle, &raw mut info) } == 0
    {
        return win_error::translate(Win32Error::get()) as c_int;
    }
    // SAFETY: caller-provided out-pointers (C contract: non-null, writable).
    unsafe {
        // quirk: TTY-48 — width is the BUFFER width (dwSize.X), height is the
        // window height; wrapping happens at the buffer edge.
        *width = i32::from(info.dwSize.X);
        *height = i32::from(info.srWindow.Bottom) - i32::from(info.srWindow.Top) + 1;
    }
    0
}
