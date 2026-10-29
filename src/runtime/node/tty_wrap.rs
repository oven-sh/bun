//! `process.binding("tty_wrap").TTY`: the native handle behind `tty.ReadStream`, with Node's `LibuvStreamWrap` surface.

use core::cell::Cell;
use core::ffi::c_void;

use bun_core::UnwrapOrOom as _;
use bun_io::pipe_reader::BufferedReaderParent;
#[cfg(unix)]
use bun_io::pipe_reader::PosixFlags;
use bun_io::{BufferedReader, ReadState};
use bun_jsc::bindgen::{JsLocal, JsScope, JsStructure, JsWrapper};
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
    safe fn Bun__ttyGetWindowSize(fd: i32, width: *mut usize, height: *mut usize) -> bool;
    #[cfg(unix)]
    safe fn open_as_nonblocking_tty(fd: i32, flags: i32) -> i32;
    #[cfg(windows)]
    safe fn Source__setRawModeStdin(uv_loop: *mut bun_libuv_sys::Loop, raw: bool) -> i32;
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
        /// The loop refused to poll the fd (kqueue on the macOS `/dev/tty`
        /// alias): `readStart()` reports `ENOTSUP`, everything else works.
        const UNPOLLABLE     = 1 << 6;
        /// `close()` closes `fd` too: libuv owns a non-stdio fd it could not reopen.
        const OWNS_FD        = 1 << 7;
        /// Inside `with_reader`: a done/error the reader reports is parked.
        const IN_READER      = 1 << 8;
    }
}

#[derive(bun_ptr::RefCounted)]
pub(crate) struct TTY {
    /// One ref is the JS wrapper's, released in `finalize`. One is the reader's, released by its last callback.
    ref_count: bun_ptr::RefCount<TTY>,

    /// The fd JS passed in. `setRawMode`/`getWindowSize` act on it.
    fd: Fd,

    /// What the reader polls and closes: on POSIX a nonblocking reopen of the terminal or a dup of `fd`, on Windows `fd` as a `uv_tty_t` of this handle's own.
    read_fd: Cell<Fd>,

    reader: JsCell<BufferedReader>,
    event_loop_handle: EventLoopHandle,
    global_this: bun_ptr::BackRef<JSGlobalObject>,
    /// Strong while reading. On Windows strong until `close()`: there the reader's handle is the caller's fd.
    this_value: JsCell<JsRef>,
    bytes_read: Cell<u64>,
    bytes_written: Cell<u64>,
    flags: Cell<Flags>,
    /// The `nread` of a done/error reported while the reader was borrowed.
    parked_finish: Cell<Option<i32>>,

    /// Per-handle raw-mode state (libuv keeps it on each `uv_tty_t`), so one
    /// handle leaving raw mode never disturbs another on the same terminal.
    #[cfg(unix)]
    tty_state: Cell<bun_core::tty::State>,

    /// Armed while open, for a handle that script of a `Bun.ModuleGraph` opened: it closes with the graph.
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

/// libuv's `uv_tty_init` accepts a tty, pipe or socket fd and rejects a
/// regular file or anything it cannot classify with `UV_EINVAL`.
fn uv_tty_init_accepts(fd: Fd) -> bool {
    #[cfg(unix)]
    {
        if sys::isatty(fd) {
            return true;
        }
        let Ok(st) = sys::fstat(fd) else {
            return false;
        };
        let mode = st.st_mode as _;
        sys::S::ISFIFO(mode) || sys::S::ISSOCK(mode)
    }
    #[cfg(windows)]
    {
        use bun_libuv_sys::HandleType;
        matches!(
            bun_libuv_sys::uv_guess_handle(fd.uv()),
            HandleType::Tty | HandleType::NamedPipe | HandleType::Tcp | HandleType::Udp
        )
    }
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

    /// `new TTY(fd, ctx)`. An fd `uv_tty_init` rejects reports through `ctx`
    /// and yields a closed handle, as in Node.
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
            read_fd: Cell::new(Fd::INVALID),
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
            abort_handle: jsc::AbortHandle::for_owner::<TTY>(),
        }));
        // SAFETY: the ref `RefCount::init()` took. The wrapper gets it below.
        let owned = unsafe { bun_ptr::RefPtr::from_raw(tty) };
        let this = owned.this_ptr();
        this.reader.with_mut(|r| r.set_parent(tty.cast::<c_void>()));

        if !uv_tty_init_accepts(fd) {
            this.update_flags(|f| f.insert(Flags::CLOSED));
            Self::fill_init_error(
                global_object,
                ctx,
                &sys::Error::from_code(sys::E::EINVAL, sys::Tag::open),
            )?;
        } else {
            match this.start_reader() {
                Ok(()) => {}
                Err(StartError::Unpollable) => {
                    this.update_flags(|f| f.insert(Flags::UNPOLLABLE));
                }
                // As Node does for a `uv_tty_init` failure: `ctx` gets the error, the handle is closed.
                Err(StartError::Sys(err)) => {
                    this.update_flags(|f| f.insert(Flags::CLOSED));
                    Self::fill_init_error(global_object, ctx, &err)?;
                }
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
            let vm = cx.global().bun_vm();
            if let Some(context) = vm.as_graph_context(vm.context_of_caller()) {
                // SAFETY: heap-allocated above; leaves its context in `close_internal`.
                unsafe { jsc::AbortHandle::arm_owner(this.as_ctx_ptr(), context) };
            }
        }
        Ok(this_value)
    }

    fn fill_init_error(global: &JSGlobalObject, ctx: JSValue, err: &sys::Error) -> JsResult<()> {
        if !ctx.is_object() {
            return Ok(());
        }
        let (code, label) = err.uv_code_label().unwrap_or(("UNKNOWN", "unknown error"));
        ctx.put(
            global,
            b"errno",
            JSValue::js_number_from_int32(uv_errno(err.errno)),
        );
        ctx.put(
            global,
            b"code",
            bun_core::String::static_(code).to_js(global)?,
        );
        ctx.put(
            global,
            b"syscall",
            bun_core::String::static_("uv_tty_init").to_js(global)?,
        );
        ctx.put(
            global,
            b"message",
            bun_core::String::static_(label).to_js(global)?,
        );
        Ok(())
    }

    /// Opens the reader on its own fd, paused. On success the reader holds a ref.
    fn start_reader(&self) -> Result<(), StartError> {
        #[cfg(unix)]
        let (read_fd, nonblocking, owns_fd) = {
            // Like libuv: a fresh nonblocking open never flips O_NONBLOCK on a
            // shared stdin. The dup fallback keeps the caller's blocking mode.
            let reopened = open_as_nonblocking_tty(self.fd.native(), sys::O::RDONLY);
            if reopened > -1 {
                (Fd::from_native(reopened), true, false)
            } else {
                let duped = sys::dup_with_flags(self.fd, 0).map_err(StartError::Sys)?;
                let nonblocking = sys::get_fcntl_flags(duped)
                    .map(|flags| flags & sys::O::NONBLOCK as isize != 0)
                    .unwrap_or(false);
                (duped, nonblocking, self.fd.native() > 2)
            }
        };
        #[cfg(windows)]
        let (read_fd, owns_fd) = (self.fd, false);

        self.read_fd.set(read_fd);

        let started = self.with_reader(|r| {
            #[cfg(unix)]
            {
                r.flags.set(PosixFlags::NONBLOCKING, nonblocking);
                r.flags.insert(PosixFlags::POLLABLE);
                r.start(read_fd, true)
            }
            // No read before `readStart()`: libuv cancels a pending console read by typing an Enter.
            #[cfg(windows)]
            {
                r.open(read_fd)
            }
        });
        if let Err(err) = started {
            #[cfg(unix)]
            read_fd.close();
            self.read_fd.set(Fd::INVALID);
            return Err(StartError::Sys(err));
        }
        // The loop refused the poll (`on_reader_error` ran): close the reader's fd.
        if self.flags.get().contains(Flags::READER_DONE) {
            self.with_reader(|r| r.close());
            self.read_fd.set(Fd::INVALID);
            return Err(StartError::Unpollable);
        }
        self.ref_();
        self.update_flags(|f| {
            f.insert(Flags::READER_STARTED);
            f.set(Flags::OWNS_FD, owns_fd);
        });

        #[cfg(unix)]
        self.with_reader(|r| {
            if let Some(poll) = r.handle.get_poll() {
                if nonblocking {
                    poll.set_flag(bun_io::FilePollFlag::Nonblocking);
                }
            }
            r.pause();
        });
        Ok(())
    }

    // ── JS methods ────────────────────────────────────────────────────────

    pub(crate) fn read_start(&self, _: &mut JsScope<'_>) -> i32 {
        bun_output::scoped_log!(TTYWrap, "readStart");
        let flags = self.flags.get();
        if flags.contains(Flags::UNPOLLABLE) {
            return uv_errno(sys::E::ENOTSUP as u16);
        }
        if flags.intersects(Flags::CLOSED | Flags::READER_DONE) {
            return 0;
        }
        self.update_flags(|f| f.insert(Flags::READING));
        let global = self.global();
        self.this_value.with_mut(|v| v.upgrade(global));
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
        if self.flags.get().contains(Flags::READER_STARTED) {
            self.with_reader(|r| r.pause());
        }
        #[cfg(unix)]
        self.this_value.with_mut(|v| v.downgrade());
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

    pub(crate) fn set_raw_mode(&self, raw: bool) -> i32 {
        if self.flags.get().contains(Flags::CLOSED) {
            return uv_errno(sys::E::EBADF as u16);
        }
        #[cfg(unix)]
        {
            let mut state = self.tty_state.get();
            let rc = state.set_mode(
                self.fd.native(),
                if raw {
                    bun_core::tty::Mode::Raw
                } else {
                    bun_core::tty::Mode::Normal
                },
                bun_core::tty::SetAttrWhen::Drain,
            );
            self.tty_state.set(state);
            -rc
        }
        #[cfg(windows)]
        {
            // As Node's `TTYWrap::SetRawMode`: the VT variant of raw mode.
            let mode = if raw {
                bun_libuv_sys::TtyMode::Vt
            } else {
                bun_libuv_sys::TtyMode::Normal
            };
            if let Err(err) = self.with_reader(|r| r.set_tty_mode(mode)) {
                return uv_errno(err.errno);
            }
            if self.fd.uv() != 0 {
                return 0;
            }
            // libuv reads by the mode of each `uv_tty_t`: the process-wide one of stdin, which `Bun.stdin.stream()` reads, follows.
            let rc = Source__setRawModeStdin(self.event_loop_handle.uv_loop(), raw);
            // It returns a positive `E` discriminant, 0 on success.
            if rc == 0 { 0 } else { uv_errno(rc as u16) }
        }
    }

    pub(crate) fn get_window_size(
        &self,
        cx: &mut JsScope<'_>,
        size: JsLocal<'_>,
    ) -> JsResult<bool> {
        let global_object = cx.global();
        let array = size.to_js();
        if !array.is_object() {
            return Err(global_object.throw(format_args!("getWindowSize expects an array")));
        }
        let mut width: usize = 0;
        let mut height: usize = 0;
        if !Bun__ttyGetWindowSize(self.fd.uv(), &raw mut width, &raw mut height) {
            return Ok(false);
        }
        array.put_index(global_object, 0, JSValue::js_number(width as f64))?;
        array.put_index(global_object, 1, JSValue::js_number(height as f64))?;
        Ok(true)
    }

    /// Writes all of `data`, as a libuv stream with blocking writes does.
    pub(crate) fn write_buffer(&self, data: &[u8]) -> i32 {
        if self.flags.get().contains(Flags::CLOSED) {
            return uv_errno(sys::E::EBADF as u16);
        }
        let mut rest = data;
        while !rest.is_empty() {
            match sys::write(self.fd, rest) {
                Ok(0) => return uv_errno(sys::E::EIO as u16),
                Ok(n) => {
                    self.bytes_written
                        .set(self.bytes_written.get().wrapping_add(n as u64));
                    rest = &rest[n..];
                }
                Err(err) if err.get_errno() == sys::E::EINTR => {}
                // A nonblocking fd (a pty master whose other side is slow to read) is waited for.
                #[cfg(unix)]
                Err(err) if err.get_errno() == sys::E::EAGAIN => {
                    let mut pfd = [sys::posix::PollFd {
                        fd: self.fd.native(),
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

    pub(crate) fn close(&self, _: &mut JsScope<'_>) {
        self.close_by_owner();
    }

    pub(crate) fn get_bytes_read(&self) -> f64 {
        self.bytes_read.get() as f64
    }

    pub(crate) fn get_bytes_written(&self) -> f64 {
        self.bytes_written.get() as f64
    }

    pub(crate) fn get_fd(&self) -> i32 {
        self.fd.uv()
    }

    // ── internals ─────────────────────────────────────────────────────────

    /// As libuv's `uv__tty_close()`: restores a terminal the handle left raw and closes the fd libuv would own.
    fn close_by_owner(&self) {
        if self.flags.get().contains(Flags::CLOSED) {
            return;
        }
        self.close_internal();
        #[cfg(unix)]
        {
            let mut state = self.tty_state.get();
            let _ = state.set_mode(
                self.fd.native(),
                bun_core::tty::Mode::Normal,
                bun_core::tty::SetAttrWhen::Now,
            );
            self.tty_state.set(state);
            if self.flags.get().contains(Flags::OWNS_FD) {
                // JS may have closed it first: EBADF is not an invariant violation here.
                let _ = self.fd.close_allowing_bad_file_descriptor(None);
            }
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
        if self.flags.get().contains(Flags::READER_STARTED) {
            // `on_reader_done` releases the reader's ref once the poll and fd close.
            self.with_reader(|r| r.close());
        }
        self.read_fd.set(Fd::INVALID);
        self.this_value.with_mut(|v| v.downgrade());
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
        if !callback.is_callable() {
            return;
        }
        let global = self.global();
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
        // A chunk read after `readStop()` (a hung-up pipe drains to EOF) is still delivered.
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
        if !self.flags.get().contains(Flags::CLOSED) {
            self.call_onread(nread, JSValue::UNDEFINED);
        }
        self.this_value.with_mut(|v| v.downgrade());
        if self.flags.get().contains(Flags::READER_STARTED) {
            self.deref_();
        }
    }

    pub(crate) fn finalize(&self) {
        bun_output::scoped_log!(TTYWrap, "finalize");
        jsc::mark_binding();
        self.this_value.with_mut(|v| v.finalize());
        self.update_flags(|f| f.insert(Flags::FINALIZED));
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
        // Only the constructor's failure paths still own an fd here.
        self.update_flags(|f| f.remove(Flags::READER_STARTED));
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
