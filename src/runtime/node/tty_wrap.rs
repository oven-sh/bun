//! `process.binding("tty_wrap").TTY`: the native handle behind `tty.ReadStream`, with Node's `LibuvStreamWrap` surface.

use core::cell::Cell;
use core::ffi::c_void;
#[cfg(unix)]
use core::ptr::NonNull;
#[cfg(unix)]
use std::collections::VecDeque;

use bun_core::UnwrapOrOom as _;
use bun_io::pipe_reader::BufferedReaderParent;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
#[cfg(unix)]
use bun_io::posix_event_loop::{FilePoll, Flags as PollFlag, Owner, PollTag};
use bun_io::{BufferedReader, ReadState};
use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::{
    self as jsc, EventLoopHandle, JSGlobalObject, JSValue, JsCell, JsRef, JsResult,
    MarkedArrayBuffer, StringJsc as _,
};
#[cfg(unix)]
use bun_sys::FdExt as _;
use bun_sys::{self as sys, Fd};

bun_output::declare_scope!(TTYWrap, hidden);

pub(crate) use crate::generated_bindgen::tty_wrap::js_TTY as js;

const UV_EOF: i32 = -4095;

unsafe extern "C" {
    safe fn Bun__ttyGetWindowSize(fd: i32, width: *mut usize, height: *mut usize) -> i32;
    #[cfg(unix)]
    safe fn open_as_nonblocking_tty(fd: i32, flags: i32) -> i32;
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    struct Flags: u16 {
        /// Between `readStart()` and `readStop()`.
        const READING        = 1 << 0;
        const CLOSED         = 1 << 1;
        /// `reader.start()` succeeded and the reader holds a ref on this struct.
        const READER_STARTED = 1 << 2;
        /// The reader hit EOF or an error: `readStart()` is a no-op from now on.
        const READER_DONE    = 1 << 3;
        /// JS called `unref()`; `readStart()` must not re-ref the loop.
        const UNREFFED       = 1 << 4;
        const FINALIZED      = 1 << 5;
        /// The loop refused to poll the fd (kqueue on the macOS `/dev/tty` alias): `readStart()` reports `ENOTSUP`, everything else works.
        const UNPOLLABLE     = 1 << 6;
        /// `close()` closes `fd` too: libuv owns a non-stdio fd it could not reopen.
        const OWNS_FD        = 1 << 7;
        /// Inside `with_reader`: a done/error the reader reports is parked.
        const IN_READER      = 1 << 8;
        /// `uv_tty_init` refused the fd: the handle was never open.
        const INIT_FAILED    = 1 << 9;
        /// libuv's `UV_HANDLE_READABLE`: the caller's fd is open for reading.
        const READABLE       = 1 << 10;
        /// libuv's `UV_HANDLE_WRITABLE`: the caller's fd is open for writing.
        const WRITABLE       = 1 << 11;
        /// libuv's `UV_HANDLE_BLOCKING_WRITES`: a write waits in place. A tty that could not be reopened (a pty master, a terminal without a name to open), a blocking description that the handle shares with the caller, or one that the loop cannot poll.
        const BLOCKING_WRITES = 1 << 12;
        /// `setBlocking(true)`: a write waits in place until `setBlocking(false)`.
        const BLOCKING_ASKED = 1 << 13;
        /// `own_fd` is a description of the handle's own (the reopen), not a dup of the caller's.
        const OWN_DESCRIPTION = 1 << 14;
    }
}

/// One `writeBuffer()` that the descriptor did not take whole.
#[cfg(unix)]
struct PendingWrite {
    /// How many of the queued bytes are of this write.
    len: usize,
    /// `oncomplete(status, context)`, in the async context of the write.
    oncomplete: Option<jsc::Strong>,
    context: Option<jsc::Strong>,
}

/// What the descriptor refused, in call order, and the poll that says when it takes more.
#[cfg(unix)]
#[derive(Default)]
struct WriteQueue {
    bytes: Vec<u8>,
    /// `bytes[..head]` is written.
    head: usize,
    pending: VecDeque<PendingWrite>,
    /// A dup of `own_fd` for the poll alone: the reader's poll has the number of `own_fd`, and epoll keys on the number.
    poll_fd: Option<Fd>,
    poll: Option<NonNull<FilePoll>>,
}

#[derive(bun_ptr::RefCounted)]
pub(crate) struct TTY {
    /// One ref is the JS wrapper's, released in `finalize`. One is the reader's, released by its last callback.
    ref_count: bun_ptr::RefCount<TTY>,

    /// The fd JS passed in, which `fd` answers. On Windows writes and `getWindowSize` act on it.
    fd: Fd,

    /// The handle's own descriptor until `close()`. On POSIX a nonblocking reopen of the terminal in the caller's access mode, or a dup of `fd`: reads, writes, the mode and the window size go through it, as through the descriptor of a `uv_tty_t`. On Windows `fd` as a `uv_tty_t` of this handle's own.
    own_fd: Cell<Fd>,

    reader: JsCell<BufferedReader>,
    event_loop_handle: EventLoopHandle,
    global_this: bun_ptr::BackRef<JSGlobalObject>,
    /// Strong while reading, while a write is queued, and while the handle holds the snapshot of the process: `close()` or the end of the context puts the terminal back, not the collector. On Windows strong until `close()`: there the reader's handle is the caller's fd.
    this_value: JsCell<JsRef>,
    bytes_read: Cell<u64>,
    bytes_written: Cell<u64>,
    flags: Cell<Flags>,
    /// The `nread` of a done/error reported while the reader was borrowed.
    parked_finish: Cell<Option<i32>>,

    /// The raw-mode fields of libuv's `uv_tty_t`: `setRawMode(false)` writes back what this handle saw when it left normal mode. What `close()` writes is libuv's too: see `close_internal`.
    #[cfg(unix)]
    tty_state: Cell<bun_core::tty::State>,

    #[cfg(unix)]
    writes: JsCell<WriteQueue>,

    /// Armed while open: the handle closes when the context that opened it stops (a `Bun.ModuleGraph`, or the thread's VM).
    abort_handle: jsc::AbortHandle,
}

jsc::impl_abort_handle_owner!(TTY, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live, and the wrapper's ref outlasts the close.
    unsafe { (*this).close_by_owner() }
});

enum StartError {
    Sys(sys::Error),
    Unpollable,
}

/// libuv's negative errno (`UV_E*` on Windows), as `onread` and `setRawMode()` report it.
fn uv_errno(errno: u16) -> i32 {
    #[cfg(windows)]
    {
        sys::windows::libuv::e_discriminant_to_uv(errno).unwrap_or(-i32::from(errno))
    }
    #[cfg(not(windows))]
    {
        -i32::from(errno)
    }
}

/// What libuv's `uv_tty_init` answers for a fd that it refuses.
const UV_TTY_INIT_REFUSED: sys::E = if cfg!(windows) {
    sys::E::EBADF
} else {
    sys::E::EINVAL
};

/// libuv's `uv_tty_init`: `src/unix/tty.c` refuses what `uv_guess_handle` calls a file or unknown, `src/win/tty.c` takes a console handle alone. `Some(true)` is a tty.
fn uv_tty_init_accepts(fd: Fd) -> Option<bool> {
    #[cfg(unix)]
    {
        match crate::socket::udp_socket::guess_handle_kind(fd.native()) {
            "FILE" | "UNKNOWN" => None,
            kind => Some(kind == "TTY"),
        }
    }
    #[cfg(windows)]
    {
        (bun_libuv_sys::uv_guess_handle(fd.uv()) == bun_libuv_sys::HandleType::Tty).then_some(true)
    }
}

/// `uv_tty_mode_t` for POSIX, which has one raw mode: `UV_TTY_MODE_RAW_VT` (3) is `UV_TTY_MODE_RAW` (1).
#[cfg(unix)]
fn posix_tty_mode(mode: i32) -> Option<bun_core::tty::Mode> {
    match mode {
        0 => Some(bun_core::tty::Mode::Normal),
        1 | 3 => Some(bun_core::tty::Mode::Raw),
        2 => Some(bun_core::tty::Mode::Io),
        _ => None,
    }
}

#[cfg(windows)]
fn windows_tty_mode(mode: i32) -> Option<bun_libuv_sys::TtyMode> {
    use bun_libuv_sys::TtyMode;
    match mode {
        0 => Some(TtyMode::Normal),
        1 => Some(TtyMode::Raw),
        2 => Some(TtyMode::Io),
        3 => Some(TtyMode::Vt),
        _ => None,
    }
}

/// Raw mode of a terminal's stdin that has no handle, because no descriptor was free for one. It needs none.
pub(crate) fn set_stdin_raw_mode(cx: &mut JsScope<'_>, mode: i32) -> i32 {
    #[cfg(unix)]
    {
        thread_local! {
            static STATE: Cell<bun_core::tty::State> = Cell::new(bun_core::tty::State::new());
        }
        let _ = cx;
        let Some(mode) = posix_tty_mode(mode) else {
            return uv_errno(sys::E::EINVAL as u16);
        };
        STATE.with(|cell| {
            let mut state = cell.get();
            let rc = state.set_mode(0, mode, bun_core::tty::SetAttrWhen::Drain);
            cell.set(state);
            -rc
        })
    }
    #[cfg(windows)]
    {
        let Some(mode) = windows_tty_mode(mode) else {
            return uv_errno(sys::E::EINVAL as u16);
        };
        let event_loop = EventLoopHandle::init(cx.global().bun_vm().as_mut().event_loop().cast());
        match bun_io::source::set_stdin_tty_mode(event_loop.uv_loop(), mode) {
            Ok(()) => 0,
            Err(err) => uv_errno(err.errno),
        }
    }
}

/// Writes until the descriptor takes no more. `Ok` is what it refused with `EAGAIN`, `Err` a negative libuv errno.
#[cfg(unix)]
fn write_until_refused(fd: Fd, mut rest: &[u8]) -> Result<&[u8], i32> {
    while !rest.is_empty() {
        match sys::write(fd, rest) {
            Ok(0) => return Err(uv_errno(sys::E::EIO as u16)),
            Ok(n) => rest = &rest[n..],
            Err(err) if err.get_errno() == sys::E::EINTR => {}
            Err(err) if err.get_errno() == sys::E::EAGAIN => break,
            Err(err) => return Err(uv_errno(err.errno)),
        }
    }
    Ok(rest)
}

/// Writes all of `rest` before it returns, as a libuv stream with blocking writes does. 0, or a negative libuv errno.
fn write_in_place(fd: Fd, mut rest: &[u8]) -> i32 {
    while !rest.is_empty() {
        match sys::write(fd, rest) {
            Ok(0) => return uv_errno(sys::E::EIO as u16),
            Ok(n) => rest = &rest[n..],
            Err(err) if err.get_errno() == sys::E::EINTR => {}
            // A nonblocking fd that is full (a pty master whose other side is slow to read) is waited for.
            #[cfg(unix)]
            Err(err) if err.get_errno() == sys::E::EAGAIN => {
                let mut pfd = [sys::posix::PollFd {
                    fd: fd.native(),
                    events: sys::posix::POLL_OUT,
                    revents: 0,
                }];
                if let Err(err) = sys::posix::poll(&mut pfd, -1) {
                    return uv_errno(err.errno);
                }
            }
            Err(err) => return uv_errno(err.errno),
        }
    }
    0
}

impl TTY {
    #[inline]
    fn global(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    fn ref_(&self) {
        // SAFETY: `self` is the live heap allocation; the intrusive count is a
        // `Cell`, so no `&mut` is materialized.
        unsafe { bun_ptr::RefCount::<TTY>::ref_(self.as_ctx_ptr()) };
    }

    /// `self` may be freed on return; callers use this in tail position only.
    fn deref_(&self) {
        // SAFETY: see `ref_`.
        unsafe { bun_ptr::RefCount::<TTY>::deref(self.as_ctx_ptr()) };
    }

    /// All reader access: a done/error reported during `f` reaches JS after `f`.
    fn with_reader<R>(&self, f: impl FnOnce(&mut BufferedReader) -> R) -> R {
        debug_assert!(!self.flags.get().contains(Flags::IN_READER));
        self.update_flags(|fl| fl.insert(Flags::IN_READER));
        let result = self.reader.with_mut(f);
        self.update_flags(|fl| fl.remove(Flags::IN_READER));
        if let Some(nread) = self.parked_finish.take() {
            self.finish(nread);
        }
        result
    }

    /// `new TTY(fd, ctx)`. An fd `uv_tty_init` rejects reports through `ctx` and yields a closed handle, as in Node.
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        fd: JsLocal<'a>,
        ctx: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global_object = cx.global();
        let (fd_value, ctx) = (fd.to_js(), ctx.to_js());
        if !fd_value.is_number() {
            return Err(global_object.throw(format_args!("fd must be a number")));
        }
        let fd_int = fd_value.to_int32();
        if fd_int < 0 {
            return Err(global_object.throw(format_args!("fd must be a non-negative integer")));
        }
        let fd = Fd::from_uv(fd_int);

        let event_loop_handle =
            EventLoopHandle::init(global_object.bun_vm().as_mut().event_loop().cast());

        let tty: *mut TTY = bun_core::heap::into_raw(Box::new(TTY {
            ref_count: bun_ptr::RefCount::init(),
            fd,
            own_fd: Cell::new(Fd::INVALID),
            reader: JsCell::new(BufferedReader::init::<TTY>()),
            event_loop_handle,
            global_this: bun_ptr::BackRef::new(global_object),
            this_value: JsCell::new(JsRef::empty()),
            bytes_read: Cell::new(0),
            bytes_written: Cell::new(0),
            flags: Cell::new(Flags::empty()),
            parked_finish: Cell::new(None),
            #[cfg(unix)]
            tty_state: Cell::new(bun_core::tty::State::new()),
            #[cfg(unix)]
            writes: JsCell::new(WriteQueue::default()),
            abort_handle: jsc::AbortHandle::for_owner::<TTY>(),
        }));
        // SAFETY: the ref `RefCount::init()` took. The wrapper gets it below.
        let owned = unsafe { bun_ptr::RefPtr::from_raw(tty) };
        let this = owned.this_ptr();
        this.reader.with_mut(|r| r.set_parent(tty.cast::<c_void>()));

        let Some(is_tty) = uv_tty_init_accepts(fd) else {
            this.update_flags(|f| f.insert(Flags::CLOSED | Flags::INIT_FAILED));
            Self::fill_init_error(
                global_object,
                ctx,
                &sys::Error::from_code(UV_TTY_INIT_REFUSED, sys::Tag::open),
            )?;
            let this_value = structure.create(&cx.heap, owned);
            this.this_value.set(JsRef::init_weak(this_value.to_js()));
            return Ok(this_value);
        };
        match this.start_reader(is_tty) {
            Ok(()) => {}
            Err(StartError::Unpollable) => {
                this.update_flags(|f| f.insert(Flags::UNPOLLABLE));
            }
            // As Node does for a `uv_tty_init` failure: `ctx` gets the error, the handle is closed.
            Err(StartError::Sys(err)) => {
                this.update_flags(|f| f.insert(Flags::CLOSED | Flags::INIT_FAILED));
                Self::fill_init_error(global_object, ctx, &err)?;
            }
        }

        let this_value = structure.create(&cx.heap, owned);
        this.this_value.set(JsRef::init_weak(this_value.to_js()));
        #[cfg(windows)]
        if this.flags.get().contains(Flags::READER_STARTED) {
            let global = this.global();
            this.this_value.with_mut(|v| v.upgrade(global));
        }
        if !this.flags.get().contains(Flags::CLOSED) {
            // SAFETY: heap-allocated above; leaves its context in `close_internal`.
            unsafe { jsc::AbortHandle::arm_owner(this.as_ctx_ptr(), cx.js_thread().context()) };
        }
        Ok(this_value)
    }

    fn fill_init_error(global: &JSGlobalObject, ctx: JSValue, err: &sys::Error) -> JsResult<()> {
        if !ctx.is_object() {
            return Ok(());
        }
        let (code, label) = err.uv_code_label().unwrap_or(("UNKNOWN", "unknown error"));
        jsc::cpp::Bun__TTY__collectInitError(
            global,
            ctx,
            uv_errno(err.errno),
            bun_core::String::static_(code).to_js(global)?,
            bun_core::String::static_(label).to_js(global)?,
        )
    }

    /// What `uv_tty_init` does with the fd: the handle gets a descriptor of its own, and the reader starts on it, paused. On success the reader holds a ref.
    fn start_reader(&self, is_tty: bool) -> Result<(), StartError> {
        #[cfg(unix)]
        let nonblocking = {
            // The access mode for the reopen, and whether a description that the handle shares is nonblocking.
            let caller_flags = sys::get_fcntl_flags(self.fd).map_err(StartError::Sys)?;
            let access = caller_flags as i32 & libc::O_ACCMODE;
            // Like libuv: a fresh nonblocking open never flips O_NONBLOCK on a shared stdin. Unlike libuv the caller's number keeps its description: no dup2 over it.
            let reopened = open_as_nonblocking_tty(self.fd.native(), access);
            let (own_fd, nonblocking) = if reopened > -1 {
                (Fd::from_native(reopened), true)
            } else {
                // Above stdio: a dup that lands on a closed fd 0 to 2 would share that number with whoever reads it next.
                let duped = sys::dup_at_least(self.fd, 3).map_err(StartError::Sys)?;
                (duped, caller_flags & sys::O::NONBLOCK as isize != 0)
            };
            self.own_fd.set(own_fd);
            self.update_flags(|f| {
                f.set(Flags::READABLE, access != sys::O::WRONLY);
                f.set(Flags::WRITABLE, access != sys::O::RDONLY);
                f.set(Flags::OWN_DESCRIPTION, reopened > -1);
                f.set(Flags::OWNS_FD, reopened == -1 && self.fd.native() > 2);
                f.set(
                    Flags::BLOCKING_WRITES,
                    reopened == -1 && (is_tty || !nonblocking),
                );
            });
            let mut state = self.tty_state.get();
            state.own_descriptor(self.fd.native());
            self.tty_state.set(state);
            nonblocking
        };
        #[cfg(windows)]
        {
            let _ = is_tty;
            self.own_fd.set(self.fd);
            self.update_flags(|f| f.insert(Flags::READABLE | Flags::WRITABLE));
        }
        let own_fd = self.own_fd.get();
        // A fd that is open for writing alone has nothing to read: `readStart()` answers `UV_ENOTCONN`.
        if !self.flags.get().contains(Flags::READABLE) {
            return Ok(());
        }

        let started = self.with_reader(|r| {
            #[cfg(unix)]
            {
                r.flags.set(PosixFlags::NONBLOCKING, nonblocking);
                r.flags
                    .insert(PosixFlags::POLLABLE | PosixFlags::ONE_READ_PER_WAKEUP);
                // The descriptor is the handle's: the reader polls and reads it, and never closes it.
                r.flags.remove(PosixFlags::CLOSE_HANDLE);
                // epoll takes every fd that `uv_tty_init` accepts, so the poll is made at the first `readStart()`. kqueue can refuse one: there the first registration is the probe.
                #[cfg(any(target_os = "linux", target_os = "android"))]
                r.flags.insert(PosixFlags::IS_PAUSED);
                r.start(own_fd, true)
            }
            // No read before `readStart()`: libuv cancels a pending console read by typing an Enter.
            #[cfg(windows)]
            {
                r.open(own_fd)
            }
        });
        if let Err(err) = started {
            #[cfg(unix)]
            own_fd.close();
            self.own_fd.set(Fd::INVALID);
            return Err(StartError::Sys(err));
        }
        // The loop refused the poll (`on_reader_error` ran, and `finish()` let the poll go): the descriptor stays for writes and the mode.
        if self.flags.get().contains(Flags::READER_DONE) {
            self.update_flags(|f| f.insert(Flags::BLOCKING_WRITES));
            return Err(StartError::Unpollable);
        }
        self.ref_();
        self.update_flags(|f| f.insert(Flags::READER_STARTED));

        #[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
        self.with_reader(|r| r.pause());
        Ok(())
    }

    // ── JS methods ────────────────────────────────────────────────────────

    pub(crate) fn read_start(&self, _: &mut JsScope<'_>) -> i32 {
        bun_output::scoped_log!(TTYWrap, "readStart");
        let flags = self.flags.get();
        if flags.contains(Flags::UNPOLLABLE) {
            return uv_errno(sys::E::ENOTSUP as u16);
        }
        // `uv_read_start` on a closed handle. After EOF it answers 0 and reads nothing.
        if flags.contains(Flags::CLOSED) {
            return uv_errno(sys::E::EINVAL as u16);
        }
        if !flags.contains(Flags::READABLE) {
            return uv_errno(sys::E::ENOTCONN as u16);
        }
        if flags.contains(Flags::READER_DONE) {
            return 0;
        }
        self.update_flags(|f| f.insert(Flags::READING));
        self.sync_wrapper_hold();
        #[cfg(unix)]
        self.with_reader(|r| {
            r.unpause();
            if !r.has_pending_read() {
                r.watch();
            }
        });
        // `uv_read_start()` refuses a console handle that cannot be read.
        #[cfg(windows)]
        if let Err(err) = self.with_reader(|r| r.start_reading()) {
            self.update_flags(|f| f.remove(Flags::READING));
            return uv_errno(err.errno);
        }
        if !self.flags.get().contains(Flags::UNREFFED) {
            self.with_reader(|r| r.update_ref(true));
        }
        0
    }

    pub(crate) fn read_stop(&self, _: &mut JsScope<'_>) -> i32 {
        bun_output::scoped_log!(TTYWrap, "readStop");
        self.update_flags(|f| f.remove(Flags::READING));
        let flags = self.flags.get();
        if flags.contains(Flags::READER_STARTED) && !flags.contains(Flags::READER_DONE) {
            self.with_reader(|r| r.pause());
        }
        self.sync_wrapper_hold();
        0
    }

    pub(crate) fn do_ref(&self) {
        self.update_flags(|f| f.remove(Flags::UNREFFED));
        // Only an active handle holds the loop; `readStart()` adds the hold.
        if self.flags.get().contains(Flags::READING) {
            self.with_reader(|r| r.update_ref(true));
        }
    }

    pub(crate) fn do_unref(&self) {
        self.update_flags(|f| f.insert(Flags::UNREFFED));
        self.with_reader(|r| r.update_ref(false));
    }

    /// `uv_has_ref`: what `ref()` and `unref()` left, whether or not the handle reads.
    pub(crate) fn has_ref(&self) -> bool {
        !self.flags.get().intersects(Flags::UNREFFED | Flags::CLOSED)
    }

    /// Bun has no async ids: 0, as `async_hooks.executionAsyncId()` answers.
    pub(crate) fn get_async_id(&self) -> f64 {
        0.0
    }

    /// libuv's `uv_stream_set_blocking()`. A description of the handle's own changes its mode. One that the caller shares keeps it, and a write then waits in place for it.
    pub(crate) fn set_blocking(&self, enable: JsLocal<'_>) -> i32 {
        if self.flags.get().contains(Flags::CLOSED) {
            return uv_errno(sys::E::EBADF as u16);
        }
        let enable = enable.to_js() == JSValue::TRUE;
        self.update_flags(|f| f.set(Flags::BLOCKING_ASKED, enable));
        #[cfg(unix)]
        if self.flags.get().contains(Flags::OWN_DESCRIPTION) {
            if let Err(err) = sys::update_nonblocking(self.own_fd.get(), !enable) {
                return uv_errno(err.errno);
            }
        }
        0
    }

    /// `mode` is libuv's `uv_tty_mode_t`, as Node's `TTYWrap::SetRawMode` takes it.
    pub(crate) fn set_raw_mode(&self, mode: i32) -> i32 {
        if self.flags.get().contains(Flags::CLOSED) {
            return uv_errno(sys::E::EBADF as u16);
        }
        #[cfg(unix)]
        {
            let Some(mode) = posix_tty_mode(mode) else {
                return uv_errno(sys::E::EINVAL as u16);
            };
            let mut state = self.tty_state.get();
            // TCSADRAIN for every terminal, a pty master too: libuv's `uv_tty_set_mode()` has no other.
            let rc = state.set_mode(
                self.own_fd.get().native(),
                mode,
                bun_core::tty::SetAttrWhen::Drain,
            );
            self.tty_state.set(state);
            self.sync_wrapper_hold();
            -rc
        }
        #[cfg(windows)]
        {
            let Some(mode) = windows_tty_mode(mode) else {
                return uv_errno(sys::E::EINVAL as u16);
            };
            if let Err(err) = self.with_reader(|r| r.set_tty_mode(mode)) {
                return uv_errno(err.errno);
            }
            if self.fd.uv() != 0 {
                return 0;
            }
            // libuv reads by the mode of each `uv_tty_t`: the process-wide one of stdin, which `Bun.stdin.stream()` reads, follows.
            match bun_io::source::set_stdin_tty_mode(self.event_loop_handle.uv_loop(), mode) {
                Ok(()) => 0,
                Err(err) => uv_errno(err.errno),
            }
        }
    }

    /// Strong while a read, a queued write or the snapshot of the process needs the handle after JS lets go of it: `close()` alone ends those, as it ends every handle in Node. Weak otherwise.
    fn sync_wrapper_hold(&self) {
        let flags = self.flags.get();
        if flags.contains(Flags::FINALIZED) {
            return;
        }
        #[cfg(unix)]
        let held = !flags.contains(Flags::CLOSED)
            && (flags.contains(Flags::READING)
                || self.tty_state.get().holds_reset_snapshot()
                || !self.writes.get().pending.is_empty());
        #[cfg(windows)]
        let held = flags.contains(Flags::READER_STARTED)
            && !flags.intersects(Flags::CLOSED | Flags::READER_DONE);
        let global = self.global();
        self.this_value.with_mut(|v| {
            if held {
                v.upgrade(global);
            } else {
                v.downgrade();
            }
        });
    }

    /// As Node's `TTYWrap::GetWindowSize`: 0 and `size` is [columns, rows], or a negative libuv errno and `size` is left alone.
    pub(crate) fn get_window_size(
        &self,
        cx: &mut JsScope<'_>,
        size: JsLocal<'_, jsc::JSArray>,
    ) -> JsResult<i32> {
        if self.flags.get().contains(Flags::CLOSED) {
            return Ok(uv_errno(sys::E::EBADF as u16));
        }
        let mut width: usize = 0;
        let mut height: usize = 0;
        #[cfg(unix)]
        let fd = self.own_fd.get();
        #[cfg(windows)]
        let fd = self.fd;
        let err = Bun__ttyGetWindowSize(fd.uv(), &raw mut width, &raw mut height);
        if err != 0 {
            return Ok(err);
        }
        let (global_object, array) = (cx.global(), size.to_js());
        array.put_index(global_object, 0, JSValue::js_number(width as f64))?;
        array.put_index(global_object, 1, JSValue::js_number(height as f64))?;
        Ok(0)
    }

    /// Node's `StreamBase::WriteBuffer`. A number: the write is complete, 0 or a negative libuv errno. `None`: the descriptor did not take all of it, the rest goes out from the loop, and `oncomplete(status, context)` runs then with the handle as `this`. `_req` is Node's request object, which this handle does not read.
    pub(crate) fn write_buffer(
        &self,
        _heap: &JsHeap<'_>,
        _req: JsLocal<'_>,
        data: &[u8],
        oncomplete: JsLocal<'_>,
        context: JsLocal<'_>,
    ) -> Option<i32> {
        let flags = self.flags.get();
        if flags.contains(Flags::CLOSED) {
            return Some(uv_errno(sys::E::EBADF as u16));
        }
        // `uv_write()` on a stream that is not writable.
        if !flags.contains(Flags::WRITABLE) {
            return Some(uv_errno(sys::E::EPIPE as u16));
        }
        // As libuv: the whole chunk counts when the handle takes the write.
        self.bytes_written
            .set(self.bytes_written.get().wrapping_add(data.len() as u64));
        #[cfg(windows)]
        {
            let _ = (oncomplete, context);
            Some(write_in_place(self.fd, data))
        }
        #[cfg(unix)]
        {
            let fd = self.own_fd.get();
            let mut rest = data;
            // Behind bytes that wait already, nothing is tried: the order of the writes holds.
            if self.writes.get().pending.is_empty() {
                rest = match write_until_refused(fd, data) {
                    Ok(rest) => rest,
                    Err(errno) => return Some(errno),
                };
                if rest.is_empty() {
                    return Some(0);
                }
                let in_place = flags.intersects(Flags::BLOCKING_WRITES | Flags::BLOCKING_ASKED);
                if in_place || !self.arm_write_poll() {
                    return Some(write_in_place(fd, rest));
                }
            }
            self.queue_write(rest, oncomplete.to_js(), context.to_js());
            None
        }
    }

    /// Keeps what the descriptor refused, and whom to tell when it is out.
    #[cfg(unix)]
    fn queue_write(&self, rest: &[u8], oncomplete: JSValue, context: JSValue) {
        let global = self.global();
        let write = PendingWrite {
            len: rest.len(),
            oncomplete: oncomplete.is_callable().then(|| {
                jsc::Strong::create(oncomplete.with_async_context_if_needed(global), global)
            }),
            context: (!context.is_undefined()).then(|| jsc::Strong::create(context, global)),
        };
        self.writes.with_mut(|q| {
            q.bytes.try_reserve(rest.len()).unwrap_or_oom();
            q.bytes.extend_from_slice(rest);
            q.pending.push_back(write);
        });
        self.sync_wrapper_hold();
    }

    /// Asks the loop to say once when the descriptor takes more. A queued write holds the loop whatever `unref()` said, as an active `uv_write_t` does. `false`: the loop takes no poll of it, and the caller waits in place.
    #[cfg(unix)]
    fn arm_write_poll(&self) -> bool {
        let ctx = self.event_loop_handle.as_event_loop_ctx();
        let owner = Owner::new(PollTag::TtyWrite, self.as_ctx_ptr().cast());
        let own_fd = self.own_fd.get();
        let (has_descriptor, armed) = self.writes.with_mut(|q| {
            let poll_fd = match q.poll_fd {
                Some(fd) => fd,
                None => {
                    let Ok(fd) = sys::dup_at_least(own_fd, 3) else {
                        return (false, false);
                    };
                    q.poll_fd = Some(fd);
                    fd
                }
            };
            let poll = match q.poll {
                Some(poll) => poll,
                None => {
                    let Some(poll) =
                        NonNull::new(FilePoll::init(ctx, poll_fd, Default::default(), owner))
                    else {
                        return (true, false);
                    };
                    q.poll = Some(poll);
                    poll
                }
            };
            // SAFETY: the poll is live until `release_write_poll`, and the loop outlives every handle of its thread.
            let armed = unsafe {
                let poll = &mut *poll.as_ptr();
                let armed = poll
                    .register(ctx.platform_event_loop(), PollFlag::Writable, true)
                    .is_ok();
                if armed {
                    poll.enable_keeping_process_alive(ctx);
                }
                armed
            };
            (true, armed)
        });
        // A descriptor that the loop refuses once is refused every time: its writes wait in place from here on.
        if has_descriptor && !armed {
            self.update_flags(|f| f.insert(Flags::BLOCKING_WRITES));
        }
        armed
    }

    /// The loop says that the descriptor takes more. SAFETY: `this` is the owner of a poll that `arm_write_poll` made and that `release_write_poll` has not dropped.
    #[cfg(unix)]
    pub(crate) unsafe fn on_write_poll(this: *mut Self) {
        // SAFETY: the poll goes in `release_write_poll` before the handle does.
        let this = unsafe { &*this };
        // A completion runs JS, which can close the handle and drop its wrapper.
        this.ref_();
        this.drain_writes();
        this.deref_();
    }

    #[cfg(unix)]
    fn drain_writes(&self) {
        let fd = self.own_fd.get();
        let mut completed: Vec<(PendingWrite, i32)> = Vec::new();
        let more = self.writes.with_mut(|q| {
            let mut failed = None;
            // As `uv__write()`: a bounded number of writes, and then the loop runs the rest of its turn.
            for _ in 0..32 {
                if q.head == q.bytes.len() {
                    break;
                }
                match sys::write(fd, &q.bytes[q.head..]) {
                    Ok(0) => {
                        failed = Some(uv_errno(sys::E::EIO as u16));
                        break;
                    }
                    Ok(n) => {
                        q.head += n;
                        let mut written = n;
                        while let Some(front) = q.pending.front_mut() {
                            if front.len > written {
                                front.len -= written;
                                break;
                            }
                            written -= front.len;
                            completed.extend(q.pending.pop_front().map(|write| (write, 0)));
                        }
                    }
                    Err(err) if err.get_errno() == sys::E::EINTR => {}
                    Err(err) if err.get_errno() == sys::E::EAGAIN => break,
                    Err(err) => {
                        failed = Some(uv_errno(err.errno));
                        break;
                    }
                }
            }
            if let Some(status) = failed {
                completed.extend(q.pending.drain(..).map(|write| (write, status)));
                q.head = q.bytes.len();
            }
            if q.head == q.bytes.len() {
                q.bytes.clear();
                q.head = 0;
            }
            !q.pending.is_empty()
        });
        if more && !self.arm_write_poll() {
            let (bytes, head, pending) = self.writes.with_mut(|q| {
                let head = core::mem::take(&mut q.head);
                (
                    core::mem::take(&mut q.bytes),
                    head,
                    core::mem::take(&mut q.pending),
                )
            });
            let status = write_in_place(fd, &bytes[head..]);
            completed.extend(pending.into_iter().map(|write| (write, status)));
        }
        if self.writes.get().pending.is_empty() {
            self.idle_write_poll();
        }
        self.sync_wrapper_hold();
        for (write, status) in completed {
            self.complete_write(write, status);
        }
    }

    /// Nothing is queued: the poll has fired and stays for the next refusal, and the loop is let go.
    #[cfg(unix)]
    fn idle_write_poll(&self) {
        let ctx = self.event_loop_handle.as_event_loop_ctx();
        if let Some(poll) = self.writes.get().poll {
            // SAFETY: see `arm_write_poll`.
            unsafe { (*poll.as_ptr()).disable_keeping_process_alive(ctx) };
        }
    }

    /// Takes the poll out of the loop and closes its descriptor. Before `own_fd` closes: the loop keys on the number.
    #[cfg(unix)]
    fn release_write_poll(&self) {
        let ctx = self.event_loop_handle.as_event_loop_ctx();
        let (poll, poll_fd) = self.writes.with_mut(|q| (q.poll.take(), q.poll_fd.take()));
        if let Some(poll) = poll {
            // SAFETY: see `arm_write_poll`. A poll that has fired is still in epoll, so the removal is forced.
            unsafe {
                let poll = &mut *poll.as_ptr();
                let _ = poll.unregister(ctx.platform_event_loop(), true);
                poll.deinit();
            }
        }
        if let Some(fd) = poll_fd {
            fd.close();
        }
    }

    #[cfg(unix)]
    fn complete_write(&self, write: PendingWrite, status: i32) {
        if self.flags.get().contains(Flags::FINALIZED) {
            return;
        }
        let (Some(oncomplete), Some(this_value)) =
            (write.oncomplete, self.this_value.get().try_get())
        else {
            return;
        };
        let global = self.global();
        let context = write
            .context
            .map_or(JSValue::UNDEFINED, |context| context.get());
        // `oncomplete` carries the context of its write (`queue_write`).
        global.bun_vm().event_loop_mut().run_callback(
            bun_event_loop::ContextId::NONE,
            oncomplete.get(),
            global,
            this_value,
            &[JSValue::js_number_from_int32(status), context],
        );
    }

    /// Node's `HandleWrap::Close`: `callback` runs from the loop, never inside this call. A handle that is closed already takes none.
    pub(crate) fn close(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        callback: JsLocal<'_>,
    ) -> JsResult<()> {
        if self.flags.get().contains(Flags::CLOSED) {
            return Ok(());
        }
        #[cfg(unix)]
        let cancelled = self.writes.with_mut(|q| core::mem::take(&mut q.pending));
        self.close_by_owner();
        // libuv's `uv__stream_flush_write_queue(stream, UV_ECANCELED)`: each queued write is told from the loop, before the close callback.
        #[cfg(unix)]
        for write in cancelled {
            let Some(oncomplete) = write.oncomplete else {
                continue;
            };
            let context = write
                .context
                .map_or(JSValue::UNDEFINED, |context| context.get());
            let bound = oncomplete.get().without_async_context().bind(
                cx.global(),
                this_value.to_js(),
                &bun_core::String::static_("oncomplete"),
                0.0,
                &[
                    JSValue::js_number_from_int32(uv_errno(sys::E::ECANCELED as u16)),
                    context,
                ],
            )?;
            crate::timer::All::set_immediate(&cx.js_thread(), bound, JSValue::UNDEFINED)?;
        }
        let callback = callback.to_js();
        if !callback.is_callable() {
            return Ok(());
        }
        let bound = callback.bind(
            cx.global(),
            this_value.to_js(),
            &bun_core::String::static_("close"),
            0.0,
            &[],
        )?;
        crate::timer::All::set_immediate(&cx.js_thread(), bound, JSValue::UNDEFINED)?;
        Ok(())
    }

    pub(crate) fn get_onread(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        js::onread_get_cached(this_value.to_js())
            .map_or(JSValue::UNDEFINED, JSValue::without_async_context)
    }

    pub(crate) fn set_onread(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        let global = cx.global();
        js::onread_set_cached(
            this_value.to_js(),
            global,
            value.to_js().with_async_context_if_needed(global),
        );
    }

    pub(crate) fn get_bytes_read(&self) -> f64 {
        self.bytes_read.get() as f64
    }

    pub(crate) fn get_bytes_written(&self) -> f64 {
        self.bytes_written.get() as f64
    }

    /// The caller's fd (Node answers its reopened one). As Node: -1 once closed, `UV_EINVAL` for a handle that was never open.
    pub(crate) fn get_fd(&self) -> i32 {
        let flags = self.flags.get();
        if flags.contains(Flags::INIT_FAILED) {
            return uv_errno(sys::E::EINVAL as u16);
        }
        if flags.contains(Flags::CLOSED) {
            return -1;
        }
        self.fd.uv()
    }

    // ── internals ─────────────────────────────────────────────────────────

    /// What `close()` does, and the end of the context that opened the handle: libuv's `uv__tty_close()`, which also closes the caller's fd where libuv would own it.
    fn close_by_owner(&self) {
        if self.flags.get().contains(Flags::CLOSED) {
            return;
        }
        self.close_internal();
        #[cfg(unix)]
        if self.flags.get().contains(Flags::OWNS_FD) {
            // JS may have closed it first: EBADF is not an invariant violation here.
            let _ = self.fd.close_allowing_bad_file_descriptor(None);
        }
    }

    fn close_internal(&self) {
        if self.flags.get().contains(Flags::CLOSED) {
            return;
        }
        self.update_flags(|f| {
            f.insert(Flags::CLOSED);
            f.remove(Flags::READING);
        });
        self.abort_handle.leave();
        #[cfg(windows)]
        {
            if self.flags.get().contains(Flags::READER_STARTED) {
                // `on_reader_done` releases the reader's ref once its `uv_tty_t` is closed.
                self.with_reader(|r| r.close());
            }
            self.own_fd.set(Fd::INVALID);
            self.this_value.with_mut(|v| v.downgrade());
        }
        #[cfg(unix)]
        {
            let own_fd = self.own_fd.replace(Fd::INVALID);
            // libuv's order: the handle that took the snapshot of the process puts the terminal back through its own descriptor, and then that descriptor closes.
            let mut state = self.tty_state.get();
            state.close(own_fd.native());
            self.tty_state.set(state);
            // `close()` has taken the queued writes to tell them. The end of a context and the collector tell nobody.
            self.writes.with_mut(|q| {
                q.pending.clear();
                q.bytes = Vec::new();
                q.head = 0;
            });
            self.release_write_poll();
            let flags = self.flags.get();
            let reader_open =
                flags.contains(Flags::READER_STARTED) && !flags.contains(Flags::READER_DONE);
            self.update_flags(|f| f.insert(Flags::READER_DONE));
            self.stop_reader();
            own_fd.close();
            self.this_value.with_mut(|v| v.downgrade());
            // The reader's ref. Every caller holds another, so this one is not the last.
            if reader_open {
                self.deref_();
            }
        }
    }

    /// Ends the reader for good and leaves its descriptor open, which is the handle's: the poll leaves the loop, and nothing reads or polls again.
    #[cfg(unix)]
    fn stop_reader(&self) {
        self.with_reader(|r| {
            r.pause();
            r.handle.close_without_closing_fd();
        });
    }

    fn call_onread(&self, nread: i32, buffer: JSValue) {
        if self.flags.get().contains(Flags::FINALIZED) {
            return;
        }
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let Some(callback) = js::onread_get_cached(this_value) else {
            return;
        };
        if !callback.without_async_context().is_callable() {
            return;
        }
        let global = self.global();
        // `callback` carries the context that set it (`set_onread`).
        global.bun_vm().event_loop_mut().run_callback(
            bun_event_loop::ContextId::NONE,
            callback,
            global,
            this_value,
            &[JSValue::js_number_from_int32(nread), buffer],
        );
    }

    fn on_read_chunk(&self, chunk: &[u8], _has_more: ReadState) -> bool {
        bun_output::scoped_log!(TTYWrap, "onReadChunk: {} bytes", chunk.len());
        if chunk.is_empty() {
            return self.flags.get().contains(Flags::READING);
        }
        self.bytes_read
            .set(self.bytes_read.get().wrapping_add(chunk.len() as u64));

        let mut v: Vec<u8> = Vec::new();
        v.try_reserve_exact(chunk.len()).unwrap_or_oom();
        v.extend_from_slice(chunk);
        // The Buffer owns this allocation (freed on the C++ side when collected).
        let bytes: &'static mut [u8] = Box::leak(v.into_boxed_slice());
        let buffer = match MarkedArrayBuffer::from_bytes(bytes, jsc::JSType::Uint8Array)
            .to_node_buffer(self.global())
        {
            Ok(buffer) => buffer,
            Err(err) => {
                crate::dispatch::fold(Err(err));
                return true;
            }
        };
        // `nread` fits: one read is bounded by the loop's scratch buffer.
        self.call_onread(chunk.len() as i32, buffer);
        // `readStop()` from inside the callback ends this read loop.
        self.flags.get().contains(Flags::READING)
    }

    fn on_reader_done(&self) {
        bun_output::scoped_log!(TTYWrap, "onReaderDone");
        self.on_reader_finished(UV_EOF);
    }

    fn on_reader_error(&self, err: &sys::Error) {
        bun_output::scoped_log!(TTYWrap, "onReaderError: {:?}", err);
        self.on_reader_finished(uv_errno(err.errno));
    }

    /// Runs inside a reader method: touches `Cell` fields only, never `self.reader`.
    fn on_reader_finished(&self, nread: i32) {
        if self.flags.get().contains(Flags::READER_DONE) {
            return;
        }
        self.update_flags(|f| {
            f.insert(Flags::READER_DONE);
            f.remove(Flags::READING);
        });
        if self.flags.get().contains(Flags::IN_READER) {
            self.parked_finish.set(Some(nread));
            return;
        }
        self.finish(nread);
    }

    /// Reports the end to JS and drops the reader's ref. May free `self`.
    fn finish(&self, nread: i32) {
        // The descriptor stays for writes, the mode and the window size until `close()`.
        #[cfg(unix)]
        self.stop_reader();
        if !self.flags.get().contains(Flags::CLOSED) {
            self.call_onread(nread, JSValue::UNDEFINED);
        }
        self.sync_wrapper_hold();
        if self.flags.get().contains(Flags::READER_STARTED) {
            self.deref_();
        }
    }

    pub(crate) fn finalize(&self) {
        bun_output::scoped_log!(TTYWrap, "finalize");
        jsc::mark_binding();
        self.this_value.with_mut(|v| v.finalize());
        self.update_flags(|f| f.insert(Flags::FINALIZED));
        // No write to the terminal at a time that the collector chose: a handle that holds the snapshot of the process or has a write queued is strong, so it is not the one that is collected.
        self.close_internal();
    }

    fn loop_(&self) -> *mut bun_io::pipe_reader::Loop {
        #[cfg(windows)]
        {
            self.event_loop_handle.uv_loop().cast()
        }
        #[cfg(not(windows))]
        {
            self.event_loop_handle.r#loop().cast()
        }
    }
}

impl Drop for TTY {
    fn drop(&mut self) {
        bun_output::scoped_log!(TTYWrap, "deinit");
        self.update_flags(|f| f.insert(Flags::FINALIZED));
        self.update_flags(|f| f.remove(Flags::READER_STARTED));
        // Only a handle whose constructor threw still has a poll or a descriptor here.
        #[cfg(unix)]
        {
            self.release_write_poll();
            self.reader
                .with_mut(|r| r.handle.close_without_closing_fd());
            let own_fd = self.own_fd.replace(Fd::INVALID);
            if own_fd != Fd::INVALID {
                own_fd.close();
            }
        }
        self.reader.with_mut(|r| r.deinit());
    }
}

bun_io::buffered_reader_parent_link!(TTYWrap for TTY);
impl BufferedReaderParent for TTY {
    const KIND: bun_io::BufferedReaderParentLinkKind =
        bun_io::BufferedReaderParentLinkKind::TTYWrap;
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(
        this: *mut Self,
        chunk: bun_io::Chunk<'_>,
        has_more: ReadState,
    ) -> bool {
        // SAFETY: `this` is the live parent registered via `set_parent`.
        unsafe { &*this }.on_read_chunk(&chunk, has_more)
    }
    unsafe fn on_reader_done(this: *mut Self) {
        // SAFETY: see `on_read_chunk`.
        unsafe { &*this }.on_reader_done();
    }
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error) {
        // SAFETY: see `on_read_chunk`.
        unsafe { &*this }.on_reader_error(&err);
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_io::pipe_reader::Loop {
        // SAFETY: see `on_read_chunk`.
        unsafe { &*this }.loop_()
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // SAFETY: see `on_read_chunk`.
        unsafe { &*this }.event_loop_handle.as_event_loop_ctx()
    }
    // `on_read_chunk` runs JS that may `close()` the handle mid read loop.
    unsafe fn ref_(this: *mut Self) {
        // SAFETY: see `on_read_chunk`.
        unsafe { bun_ptr::RefCount::<TTY>::ref_(this) };
    }
    unsafe fn deref(this: *mut Self) {
        // SAFETY: see `on_read_chunk`; this may be the last ref.
        unsafe { bun_ptr::RefCount::<TTY>::deref(this) };
    }
}
