//! Socket-like transport over a POSIX FIFO / character-device fd.
//!
//! The POSIX twin of `WindowsNamedPipe.rs`: `new net.Socket({ fd, readable: true })`,
//! `net.connect({ fd })` and `Bun.connect({ fd })` on an fd that is not a
//! socket cannot go through uSockets (`epoll`/`kqueue` + `recv`/`send` reject
//! it), so the fd is adopted here instead and driven by the same
//! `bun_io::BufferedReader` / `bun_io::StreamingWriter` pair that backs
//! `Bun.Terminal` and child-process stdio. The wrapper presents the uSockets
//! callback surface (`on_open`, `on_data`, `on_close`, ...) to
//! `PosixPipeContext`, which forwards to the wrapped `NewSocket`, and the
//! `PosixPipe__*` C shims let `bun_uws_sys::InternalSocket::Pipe` dispatch to
//! it like any other socket.
//!
//! Lifecycle (same shape as the Windows arm):
//! - `open` classifies the fd once (`fstat` + `F_GETFL`), starts a reader for
//!   a readable fd and a writer for a writable one, then fires `on_open`
//!   (or the TLS handshake when `Bun.connect({ fd, tls })` asked for it).
//! - Reader EOF is `on_end` followed by closing the writer (no half-open);
//!   `shutdown` ends the writer after its buffered bytes drain, `close`
//!   drops them and ends it at once.
//! - `on_close` fires once, when every half that was started is done, and
//!   releases the connection's ref on the owning context.
//!
//! Fd ownership: the adopted fd is owned, not borrowed (node's `uv_pipe_open`
//! semantics): it is handed to the reader, or to the writer when the fd is
//! write-only, and the other half gets a `dup` (epoll registers an fd once,
//! so two polls cannot share one). Fds 0-2 are the exception: stdio is only
//! ever `dup`'d, never closed and never switched to `O_NONBLOCK` through this
//! path (`O_NONBLOCK` lives on the open file description, so setting it on a
//! dup would change stdio too). The reader's and writer's own fd-closing is
//! turned off: `close_read_fd` / `close_write_fd` close each half's fd on
//! this thread before `on_end` / `on_close` are reported, so the fd is
//! already gone when JS sees `'close'` (the `Closer` the halves would use
//! closes on a pool thread, which the tests could observe as a still-open fd).

use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void};

use bun_boringssl_sys as boringssl;
use bun_io::pipe_reader::BufferedReaderParent;
use bun_io::pipe_reader::PosixFlags;
use bun_io::pipe_writer::PosixPipeWriter;
use bun_io::{BufferedReader, Chunk, ReadState, StreamingWriter, WriteResult, WriteStatus};
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::{self, Fd, FdExt as _};
use bun_uws::us_bun_verify_error_t;

use crate::socket::SSLConfig;
use crate::socket::ssl_wrapper::{self, SSLWrapper};
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(PosixPipe, visible);

pub(crate) type CertError = crate::socket::upgraded_duplex::CertError;

type WrapperType = SSLWrapper<*mut PosixPipe>;

use crate::jsc_hooks::timer_all_mut as timer_all;

pub(crate) struct PosixPipe {
    pub(crate) wrapper: JsCell<Option<WrapperType>>,
    pub(crate) deferred_writer_close: Cell<bool>,
    /// Address of this struct inside its owning `PosixPipeContext`; set by
    /// the context right after construction. Handed to the reader, the writer
    /// and the SSL wrapper as their parent back-pointer.
    pub(crate) root: Cell<*mut PosixPipe>,
    /// The fd `open` adopted, for `PosixPipe__fd` (`socket.fd` / `getFd`).
    /// The reader / writer hold their own handles to it.
    pub(crate) fd: Cell<Fd>,
    /// The fds the reader / writer were started with; `Fd::INVALID` before
    /// `open` and once closed. Closed by `close_read_fd` / `close_write_fd`
    /// (see the module doc), never by the halves themselves.
    read_fd: Cell<Fd>,
    write_fd: Cell<Fd>,
    /// The per-thread VM singleton outlives this struct (it is torn down only
    /// at thread exit, after every pipe is closed), so `&'static` is the
    /// honest model here rather than a threaded lifetime.
    pub(crate) vm: &'static VirtualMachine,
    pub(crate) reader: JsCell<BufferedReader>,
    pub(crate) writer: JsCell<StreamingWriter<PosixPipe>>,

    pub(crate) ssl_error: JsCell<CertError>,
    pub(crate) handlers: Handlers,

    /// A reader that fails to arm its poll inside `open` reports here instead
    /// of through `handlers.on_error`, so `open` can return the error and let
    /// the context's guard fail the connect exactly once.
    open_error: Cell<Option<bun_sys::Error>>,
    /// The last write was short (`WriteStatus::Pending`); the next full drain
    /// is the `on_writable` the owner is waiting for.
    writer_backed_up: Cell<bool>,

    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    pub(crate) current_timeout: Cell<u32>,
    pub(crate) flags: Cell<Flags>,
}

bun_event_loop::impl_timer_owner!(PosixPipe; from_timer_ptr => event_loop_timer);

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u16 {
        const DISCONNECTED = 1 << 0;
        const IS_CLOSED    = 1 << 1;
        const IS_CLIENT    = 1 << 2;
        const IS_SSL       = 1 << 3;
        const WRAPPER_BUSY = 1 << 4;
        const WRITER_BUSY  = 1 << 5;
        /// `open` started a reader on the fd (it was opened for reading).
        const HAS_READER   = 1 << 6;
        /// `open` started a writer on the fd (it was opened for writing).
        const HAS_WRITER   = 1 << 7;
        /// The reader finished (EOF, error, or closed by us); its fd is gone.
        const READER_DONE  = 1 << 8;
        /// The writer finished (EOF, error, or ended); its fd is gone.
        const WRITER_DONE  = 1 << 9;
        /// Inside `open`, before the handlers may be dispatched to.
        const OPENING      = 1 << 10;
        /// `shutdown` asked to end the writer while it still had buffered
        /// bytes; the next full drain ends it.
        const END_AFTER_DRAIN = 1 << 11;
        /// The writer's fd is a blocking pipe (`FileType::Pipe`): its poll
        /// drains at most the kernel's size hint per wakeup and reports
        /// `Drained` with bytes left, without re-arming itself.
        const WRITER_BLOCKING = 1 << 12;
    }
}

impl Flags {
    #[inline]
    pub(crate) fn disconnected(self) -> bool {
        self.contains(Self::DISCONNECTED)
    }
    #[inline]
    pub(crate) fn is_closed(self) -> bool {
        self.contains(Self::IS_CLOSED)
    }
    #[inline]
    pub(crate) fn is_ssl(self) -> bool {
        self.contains(Self::IS_SSL)
    }
    /// Nothing to tear down: `open` never started a half (or failed), or
    /// `on_close` already ran. `close`/`shutdown` are no-ops then, like the
    /// Windows arm without an adopted pipe; reaching `on_close` would deref
    /// the context at zero.
    #[inline]
    fn inert(self) -> bool {
        self.contains(Self::IS_CLOSED) || !self.intersects(Self::HAS_READER | Self::HAS_WRITER)
    }
    #[inline]
    fn reader_active(self) -> bool {
        self.contains(Self::HAS_READER) && !self.contains(Self::READER_DONE)
    }
    #[inline]
    fn writer_active(self) -> bool {
        self.contains(Self::HAS_WRITER) && !self.contains(Self::WRITER_DONE)
    }
}

pub(crate) struct Handlers {
    pub ctx: *mut c_void,
    pub(crate) ref_ctx: fn(*mut c_void),
    pub(crate) deref_ctx: fn(*mut c_void),
    pub(crate) on_open: fn(*mut c_void),
    pub(crate) on_handshake: fn(*mut c_void, bool, us_bun_verify_error_t),
    pub(crate) on_data: fn(*mut c_void, &[u8]),
    pub on_close: fn(*mut c_void),
    pub(crate) on_end: fn(*mut c_void),
    pub(crate) on_writable: fn(*mut c_void),
    pub(crate) on_error: fn(*mut c_void, bun_sys::Error),
    pub(crate) on_timeout: fn(*mut c_void),
    /// A new resumable TLS session (serialized SSL_SESSION) - node's
    /// `'session'` event on the wrapping TLSSocket.
    pub(crate) on_session: fn(*mut c_void, &[u8]),
    /// An NSS key-log line - node's `'keylog'` event.
    pub(crate) on_keylog: fn(*mut c_void, &[u8]),
    pub(crate) server_identity:
        fn(*mut c_void, &mut boringssl::SSL) -> bun_boringssl::ServerIdentity,
}

fn close_dups(dups: &[Fd; 2]) {
    for d in dups {
        if *d != Fd::INVALID {
            d.close();
        }
    }
}

/// What `open` learned about the fd from one `fstat` + one `F_GETFL`.
struct FdInfo {
    readable: bool,
    writable: bool,
    nonblocking: bool,
    pollable: bool,
    is_socket: bool,
}

impl PosixPipe {
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    #[inline]
    fn wrapper_ref(&self) -> Option<&WrapperType> {
        self.wrapper.get().as_ref()
    }

    fn with_wrapper<R>(&self, f: impl FnOnce(&WrapperType) -> R) -> Option<R> {
        let w = self.wrapper_ref()?;
        let was_busy = self.flags.get().contains(Flags::WRAPPER_BUSY);
        self.update_flags(|flags| flags.insert(Flags::WRAPPER_BUSY));
        let result = f(w);
        if !was_busy {
            self.update_flags(|flags| flags.remove(Flags::WRAPPER_BUSY));
            if self.flags.get().is_closed() {
                self.wrapper.set(None);
            }
        }
        Some(result)
    }

    /// Holds a ref on the owning context until the returned guard drops.
    ///
    /// The context frees itself from a task it queues when [`on_close`] releases
    /// the connection's ref. A handler can close the socket and then spin the
    /// event loop before it returns (`expect().resolves` blocks on a promise
    /// that way), which runs that task. A callback that uses `self` after it
    /// dispatched to a handler holds this guard, so the free waits until the
    /// callback is done. The reader does the same around a read loop, and the
    /// writer around an error report.
    ///
    /// Only for paths that cannot run after `on_close` released the
    /// connection's ref (reads stop, the writer ends and the wrapper goes away
    /// in `release_resources`): a ref taken at zero would queue the free twice.
    ///
    /// [`on_close`]: Self::on_close
    fn keep_alive(&self) -> impl Drop + '_ {
        self.r#ref();
        scopeguard::guard(self, |this| this.deref())
    }

    #[inline]
    fn root_ptr(&self) -> *mut PosixPipe {
        let p = self.root.get();
        debug_assert!(!p.is_null(), "PosixPipe root not recorded");
        p
    }

    #[inline]
    fn event_loop_ctx(&self) -> bun_io::EventLoopHandle {
        self.vm.loop_ctx()
    }

    /// `&Self` from the parent back-pointer the reader / writer / SSL wrapper
    /// carry. Shared only: every field is a `Cell`/`JsCell`, and a `&mut` to
    /// the embedded reader or writer may be live on the caller's stack.
    #[inline]
    fn from_parent_ptr<'a>(this: *mut Self) -> &'a Self {
        // SAFETY: `this` is `root`, recorded by the owning context before
        // `open`; the context outlives every callback (it frees itself from a
        // queued task only after `on_close` released the connection's ref,
        // and the callbacks that may reach that point hold `keep_alive`).
        unsafe { &*this }
    }

    fn with_writer<R>(&self, op: impl FnOnce(&mut StreamingWriter<Self>) -> R) -> R {
        let was_busy = self.flags.get().contains(Flags::WRITER_BUSY);
        self.update_flags(|f| f.insert(Flags::WRITER_BUSY));
        let r = self.writer.with_mut(op);
        if !was_busy {
            self.update_flags(|f| f.remove(Flags::WRITER_BUSY));
            if self.deferred_writer_close.replace(false) {
                self.on_close();
            }
        }
        r
    }

    // ── reader callbacks ────────────────────────────────────────────────────

    fn on_read_chunk(&self, chunk: &[u8], has_more: ReadState) -> bool {
        bun_output::scoped_log!(
            PosixPipe,
            "onReadChunk ({}, eof={})",
            chunk.len(),
            has_more == ReadState::Eof
        );
        let _keep_alive = self.keep_alive();
        self.reset_timeout();

        if self.with_wrapper(|w| w.receive_data(chunk)).is_none() {
            (self.handlers.on_data)(self.handlers.ctx, chunk);
        }
        // EOF arrives through `on_reader_done` right after this.
        true
    }

    /// Reader EOF. Half-open connections are not supported: the read side
    /// going away ends the write side as well (the Windows arm does the same).
    fn on_reader_done(&self) {
        bun_output::scoped_log!(PosixPipe, "onReaderDone");
        if self.flags.get().contains(Flags::READER_DONE) {
            return;
        }
        self.update_flags(|f| f.insert(Flags::READER_DONE));
        if self.flags.get().contains(Flags::OPENING) {
            return;
        }
        // Before `on_end`: the fd is gone by the time JS sees the event.
        self.close_read_fd();
        let _keep_alive = self.keep_alive();
        (self.handlers.on_end)(self.handlers.ctx);
        self.end_writer_or_finish();
    }

    fn on_reader_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(PosixPipe, "onReaderError");
        if self.flags.get().contains(Flags::READER_DONE) {
            return;
        }
        self.update_flags(|f| f.insert(Flags::READER_DONE));
        if self.flags.get().contains(Flags::OPENING) {
            // `open` returns this; the connect fails through the context's guard.
            self.open_error.set(Some(err));
            return;
        }
        self.close_read_fd();
        let _keep_alive = self.keep_alive();
        self.on_error(err);
    }

    // ── writer callbacks ────────────────────────────────────────────────────

    fn on_write(&self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(
            PosixPipe,
            "onWrite {} {}",
            amount,
            match status {
                WriteStatus::Pending => "pending",
                WriteStatus::Drained => "drained",
                WriteStatus::EndOfFile => "end_of_file",
            }
        );

        match status {
            WriteStatus::Pending => {
                self.writer_backed_up.set(true);
            }
            WriteStatus::Drained => {
                // `Drained` is also reported for bytes parked below the
                // writer's coalescing threshold; only an empty buffer is done.
                if self.writer.get().has_pending_data() {
                    if self.flags.get().contains(Flags::WRITER_BLOCKING) {
                        // A size-hint-limited partial drain: the one-shot
                        // poll fired and nothing else re-arms it.
                        self.with_writer(|w| {
                            <StreamingWriter<Self> as PosixPipeWriter>::register_poll(w);
                        });
                    }
                    return;
                }
                self.on_writer_drained();
            }
            WriteStatus::EndOfFile => {
                // The writer already released its fd; report the close.
                self.with_writer(|w| w.end());
            }
        }
    }

    /// The writer's buffer just became empty, through `on_write(Drained)` or
    /// a synchronous `flush()` (which reports no `on_write`): release the
    /// loop hold `call_write_or_end` took, finish a pending `shutdown()`, and
    /// deliver the `on_writable` a short write is waiting for.
    fn on_writer_drained(&self) {
        let ev = self.event_loop_ctx();
        self.writer
            .with_mut(|w| w.disable_keeping_process_alive(ev));
        if self.flags.get().contains(Flags::END_AFTER_DRAIN) {
            self.update_flags(|f| f.remove(Flags::END_AFTER_DRAIN));
            self.with_writer(|w| w.end());
            return;
        }
        if self.writer_backed_up.replace(false) {
            self.on_writable();
        }
    }

    fn on_writable(&self) {
        bun_output::scoped_log!(PosixPipe, "onWritable");
        let _keep_alive = self.keep_alive();
        (self.handlers.on_writable)(self.handlers.ctx);
    }

    fn on_writer_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(PosixPipe, "onWriterError");
        self.on_error(err);
    }

    /// The writer released its poll (not its fd: `close_fd` is off). The
    /// reader, if still running, goes with it; once both halves are done the
    /// connection is closed.
    fn on_writer_close(&self) {
        bun_output::scoped_log!(PosixPipe, "onWriterClose");
        if self.flags.get().contains(Flags::WRITER_DONE) {
            return;
        }
        self.update_flags(|f| f.insert(Flags::WRITER_DONE));
        // Reached from inside the writer's `close()`, so only the fd is
        // touched here, never `self.writer`.
        self.close_write_fd();
        if self.flags.get().contains(Flags::OPENING) {
            return;
        }
        self.finish_close();
    }

    // ── shared teardown ─────────────────────────────────────────────────────

    /// Releases the reader's poll and closes the fd it was started with, on
    /// this thread. Idempotent.
    fn close_read_fd(&self) {
        self.reader.with_mut(|r| {
            // Marks the reader done, which stops the read loop this may be
            // running under (a `destroy()` from a 'data' handler) before that
            // loop reads the fd again. Set by hand: `deinit` only sets it
            // while the handle is open, and asserts it is not set yet.
            r.flags.insert(PosixFlags::CLOSED_WITHOUT_REPORTING);
            r.handle.close_without_closing_fd();
            r.deinit();
        });
        let fd = self.read_fd.replace(Fd::INVALID);
        if fd != Fd::INVALID {
            fd.close();
        }
    }

    /// Closes the fd the writer was started with, on this thread. The writer
    /// has already released its poll (`on_writer_close`, `end()`, or its
    /// `Drop`). Idempotent.
    fn close_write_fd(&self) {
        let fd = self.write_fd.replace(Fd::INVALID);
        if fd != Fd::INVALID {
            fd.close();
        }
    }

    /// End the writer (after its buffered bytes drain), or close straight away
    /// when there is no writer left to wait for.
    fn end_writer_or_finish(&self) {
        if self.flags.get().writer_active() {
            self.end_writer();
        } else {
            self.finish_close();
        }
    }

    /// Stop the reader without a callback, close its fd, and report the close
    /// once.
    fn finish_close(&self) {
        if self.flags.get().reader_active() {
            self.update_flags(|f| f.insert(Flags::READER_DONE));
            self.close_read_fd();
        }
        self.on_close();
    }

    /// `writer.end()` once everything buffered reached the fd: the writer
    /// drops what it still holds when it ends, so a `shutdown()` right after a
    /// large `write()` would otherwise lose the tail.
    fn end_writer(&self) {
        if !self.flags.get().writer_active() {
            return;
        }
        let pending = self.with_writer(|w| {
            if w.is_done {
                return false;
            }
            if w.has_pending_data() {
                let _ = w.flush();
            }
            if w.has_pending_data() {
                true
            } else {
                w.end();
                false
            }
        });
        if pending {
            // The writable poll is armed (a short write registered it);
            // `on_write(Drained)` ends the writer.
            self.update_flags(|f| f.insert(Flags::END_AFTER_DRAIN));
        }
    }

    fn on_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(PosixPipe, "onError");
        let _keep_alive = self.keep_alive();
        (self.handlers.on_error)(self.handlers.ctx, err);
        self.close();
    }

    fn on_open(&self) {
        bun_output::scoped_log!(PosixPipe, "onOpen");
        (self.handlers.on_open)(self.handlers.ctx);
    }

    fn on_data(&self, decoded_data: &[u8]) {
        bun_output::scoped_log!(PosixPipe, "onData ({})", decoded_data.len());
        (self.handlers.on_data)(self.handlers.ctx, decoded_data);
    }

    fn on_session(&self, session: &[u8]) {
        bun_output::scoped_log!(PosixPipe, "onSession ({})", session.len());
        (self.handlers.on_session)(self.handlers.ctx, session);
    }

    fn on_keylog(&self, line: &[u8]) {
        bun_output::scoped_log!(PosixPipe, "onKeylog ({})", line.len());
        (self.handlers.on_keylog)(self.handlers.ctx, line);
    }

    // ── SSLWrapper trampolines ───────────────────────────────────────────────
    // `ssl_wrapper::Handlers<*mut Self>` carries `fn(*mut Self, ..)` slots.
    // SAFETY (all): `this` is the `ctx` set in `wrapper_handlers`; the engine
    // only fires handlers while `self` (its owner) is alive.
    fn ssl_on_open(this: *mut Self) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_open()
    }
    fn ssl_on_handshake(this: *mut Self, ok: bool, e: us_bun_verify_error_t) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_handshake(ok, e)
    }
    fn ssl_on_data(this: *mut Self, d: &[u8]) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_data(d)
    }
    fn ssl_on_session(this: *mut Self, d: &[u8]) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_session(d)
    }
    fn ssl_server_identity(
        this: *mut Self,
        ssl: &mut boringssl::SSL,
    ) -> bun_boringssl::ServerIdentity {
        // SAFETY: see block note above.
        let this = unsafe { &*this };
        (this.handlers.server_identity)(this.handlers.ctx, ssl)
    }
    fn ssl_on_keylog(this: *mut Self, d: &[u8]) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_keylog(d)
    }
    fn ssl_on_close(this: *mut Self) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_close()
    }
    fn ssl_write(this: *mut Self, d: &[u8]) {
        // SAFETY: see block note above.
        unsafe { &*this }.internal_write(d)
    }

    fn wrapper_handlers(&self) -> ssl_wrapper::Handlers<*mut PosixPipe> {
        ssl_wrapper::Handlers {
            ctx: self.root_ptr(),
            on_open: Self::ssl_on_open,
            on_handshake: Self::ssl_on_handshake,
            on_data: Self::ssl_on_data,
            on_close: Self::ssl_on_close,
            write: Self::ssl_write,
            on_session: Some(Self::ssl_on_session),
            on_keylog: Some(Self::ssl_on_keylog),
            server_identity: Some(Self::ssl_server_identity),
        }
    }

    fn on_handshake(&self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(PosixPipe, "onHandshake");
        let _keep_alive = self.keep_alive();

        self.ssl_error.set(CertError {
            error_no: ssl_error.error_no,
            code: ssl_error
                .code()
                .filter(|_| ssl_error.error_no != 0)
                .map(Into::into),
            reason: ssl_error
                .reason()
                .filter(|_| ssl_error.error_no != 0)
                .map(Into::into),
        });
        (self.handlers.on_handshake)(self.handlers.ctx, handshake_success, ssl_error);
        // Retry writes parked during the handshake; a TLS 1.2 client's completion sends nothing.
        if handshake_success && !self.is_shutdown() {
            (self.handlers.on_writable)(self.handlers.ctx);
        }
    }

    fn on_close(&self) {
        if self.flags.get().contains(Flags::WRITER_BUSY) {
            self.deferred_writer_close.set(true);
            return;
        }
        bun_output::scoped_log!(PosixPipe, "onClose");
        if !self.flags.get().is_closed() {
            self.update_flags(|f| f.set(Flags::IS_CLOSED, true)); // only call onClose once
            (self.handlers.on_close)(self.handlers.ctx);
            self.release_resources();
        }
    }

    fn call_write_or_end(&self, data: Option<&[u8]>, msg_more: bool) {
        if let Some(bytes) = data {
            if !bytes.is_empty()
                && self.flags.get().writer_active()
                && !self.flags.get().contains(Flags::END_AFTER_DRAIN)
            {
                if self.flags.get().disconnected() {
                    // enqueue to be sent after connecting
                    self.with_writer(|w| bun_core::handle_oom(w.outgoing.write(bytes)));
                } else {
                    let ev = self.event_loop_ctx();
                    // Hold the loop while bytes are pending, as the Windows arm
                    // refs its handle; `on_write(Drained)` lets go.
                    let result = self.with_writer(|w| {
                        w.enable_keeping_process_alive(ev);
                        // write enqueues what it cannot send right away
                        w.write(bytes)
                    });
                    if let WriteResult::Err(err) = result {
                        self.on_error(err);
                        return;
                    }
                }
            }
        }

        if !msg_more {
            let _ = self.with_wrapper(|w| {
                let _ = w.shutdown(false);
            });
            self.end_writer();
        }
    }

    fn internal_write(&self, encoded_data: &[u8]) {
        self.reset_timeout();

        // Possible scenarios:
        // Scenario 1: will not write if is not connected yet but will enqueue the data
        // Scenario 2: will not write if the fd rejected it (handled by onError)
        // Scenario 3: will be queued in memory and will be flushed later
        // Scenario 4: no writer exists (read-only fd) - the bytes are dropped,
        //             `is_shutdown()` already told the owner so
        self.call_write_or_end(Some(encoded_data), true);
    }

    #[bun_uws::uws_callback(export = "PosixPipe__resume_stream")]
    pub(crate) fn resume_stream(&self) -> bool {
        if !self.flags.get().reader_active() {
            return false;
        }
        // Arms the readable poll; bytes already waiting are delivered on the
        // next tick, like a uSockets resume.
        self.reader.with_mut(|r| {
            r.unpause();
            r.watch();
        });
        true
    }

    #[bun_uws::uws_callback(export = "PosixPipe__pause_stream")]
    pub(crate) fn pause_stream(&self) -> bool {
        if !self.flags.get().reader_active() {
            return false;
        }
        self.reader.with_mut(|r| r.pause());
        true
    }

    #[bun_uws::uws_callback(export = "PosixPipe__flush")]
    pub(crate) fn flush(&self) {
        let _ = self.with_wrapper(|w| {
            let _ = w.flush();
        });
        if !self.flags.get().disconnected() && self.flags.get().writer_active() {
            let (result, drained) = self.with_writer(|w| {
                let result = w.flush();
                (result, !w.has_pending_data())
            });
            if let WriteResult::Err(err) = result {
                self.on_error(err);
                return;
            }
            // A synchronous drain reports no `on_write(Drained)`.
            if drained && self.flags.get().writer_active() {
                self.on_writer_drained();
            }
        }
    }

    pub(crate) fn on_timeout(&self) {
        bun_output::scoped_log!(PosixPipe, "onTimeout");

        let has_been_cleared = self.event_loop_timer.get().state == EventLoopTimerState::CANCELLED
            || self.vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.with_mut(|t| {
            t.state = EventLoopTimerState::FIRED;
            t.heap = Default::default();
        });

        if has_been_cleared {
            return;
        }

        let _keep_alive = self.keep_alive();
        (self.handlers.on_timeout)(self.handlers.ctx);
    }

    pub(crate) fn from(handlers: Handlers, vm: &'static VirtualMachine) -> PosixPipe {
        PosixPipe {
            vm,
            wrapper: JsCell::new(None),
            deferred_writer_close: Cell::new(false),
            root: Cell::new(core::ptr::null_mut()),
            fd: Cell::new(Fd::INVALID),
            read_fd: Cell::new(Fd::INVALID),
            write_fd: Cell::new(Fd::INVALID),
            handlers,
            // defaults:
            reader: JsCell::new(BufferedReader::init::<PosixPipe>()),
            writer: JsCell::new(StreamingWriter::default()),
            ssl_error: JsCell::new(CertError::default()),
            open_error: Cell::new(None),
            writer_backed_up: Cell::new(false),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::PosixPipe,
            )),
            current_timeout: Cell::new(0),
            flags: Cell::new(Flags::DISCONNECTED), // disconnected: bool = true is the only non-false default
        }
    }

    pub(crate) fn r#ref(&self) {
        (self.handlers.ref_ctx)(self.handlers.ctx);
    }

    pub(crate) fn deref(&self) {
        (self.handlers.deref_ctx)(self.handlers.ctx);
    }

    /// One `fstat` + one `F_GETFL`: what the fd is, which directions it was
    /// opened for, and whether it already is `O_NONBLOCK`.
    fn classify(fd: Fd) -> bun_sys::Result<FdInfo> {
        let st = bun_sys::fstat(fd)?;
        let mode = st.st_mode & libc::S_IFMT;
        let is_socket = mode == libc::S_IFSOCK;
        let pollable = is_socket || mode == libc::S_IFIFO || mode == libc::S_IFCHR;

        let fl = bun_sys::get_fcntl_flags(fd)? as i32;
        let acc = fl & libc::O_ACCMODE;
        Ok(FdInfo {
            readable: acc == libc::O_RDONLY || acc == libc::O_RDWR,
            writable: acc == libc::O_WRONLY || acc == libc::O_RDWR,
            nonblocking: fl & libc::O_NONBLOCK != 0,
            pollable,
            is_socket,
        })
    }

    /// Adopt `fd`. On `Err` nothing was started, no handler ran, and `fd` is
    /// still the caller's (only fds this call `dup`'d were closed).
    pub(crate) fn open(
        &self,
        fd: Fd,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        debug_assert!(
            !self
                .flags
                .get()
                .intersects(Flags::HAS_READER | Flags::HAS_WRITER)
        );
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            result?;
        }

        let mut info = Self::classify(fd)?;
        if !info.readable && !info.writable {
            return Err(
                bun_sys::Error::from_code(bun_sys::E::EBADF, bun_sys::Tag::fstat).with_fd(fd),
            );
        }
        if !info.pollable {
            // A regular file or directory: nothing here can wait on it.
            return Err(
                bun_sys::Error::from_code(bun_sys::E::ENOTSUP, bun_sys::Tag::open).with_fd(fd),
            );
        }

        let is_stdio = fd.stdio_tag().is_some();
        if !is_stdio && !info.nonblocking {
            // A blocking fd still works (the reader and writer poll before
            // each syscall); non-blocking is just cheaper.
            info.nonblocking = bun_sys::update_nonblocking(fd, true).is_ok();
        }

        // The reader takes `fd` itself; the writer gets a dup so each half has
        // its own fd to poll and close. Stdio is only ever dup'd (never
        // closed, see the module doc).
        let mut dups: [Fd; 2] = [Fd::INVALID; 2];
        let read_fd = if !info.readable {
            Fd::INVALID
        } else if is_stdio {
            let d = bun_sys::dup(fd)?;
            dups[0] = d;
            d
        } else {
            fd
        };
        let write_fd = if !info.writable {
            Fd::INVALID
        } else if info.readable || is_stdio {
            match bun_sys::dup(fd) {
                Ok(d) => {
                    dups[1] = d;
                    d
                }
                Err(err) => {
                    close_dups(&dups);
                    return Err(err);
                }
            }
        } else {
            fd
        };

        self.fd.set(fd);
        self.update_flags(|f| f.insert(Flags::OPENING));
        let this: *mut Self = self.root_ptr();
        let ev = self.event_loop_ctx();

        if write_fd != Fd::INVALID {
            let started = self.writer.with_mut(|w| {
                w.set_parent(this);
                // `close_write_fd` closes it, synchronously, after the writer
                // reports its close.
                w.close_fd = false;
                w.start(write_fd, info.pollable)
            });
            if let Err(err) = started {
                // "On `Err` the writer holds nothing; `fd` is still the caller's to close."
                close_dups(&dups);
                self.update_flags(|f| f.remove(Flags::OPENING));
                return Err(err);
            }
            self.write_fd.set(write_fd);
            self.update_flags(|f| {
                f.insert(Flags::HAS_WRITER);
                f.set(Flags::WRITER_BLOCKING, !info.nonblocking && !info.is_socket);
            });
            self.writer.with_mut(|w| {
                if let Some(poll) = w.get_poll() {
                    if info.nonblocking {
                        poll.set_flag(bun_io::FilePollFlag::Nonblocking);
                    }
                    if info.is_socket {
                        poll.set_flag(bun_io::FilePollFlag::Socket);
                    }
                }
                // The socket's own `poll_ref` keeps the loop alive; the
                // writer only holds it while bytes are pending.
                w.update_ref(ev, false);
            });
        }

        if read_fd != Fd::INVALID {
            // A registration failure inside `start` is reported through
            // `on_reader_error` (OPENING parks it in `open_error`).
            let started = self.reader.with_mut(|r| {
                r.set_parent(this.cast::<c_void>());
                // `close_read_fd` releases the poll and closes the fd.
                r.flags.remove(PosixFlags::CLOSE_HANDLE);
                if info.nonblocking {
                    r.flags.insert(PosixFlags::NONBLOCKING);
                }
                if info.is_socket {
                    r.flags.insert(PosixFlags::SOCKET);
                }
                // See the writer: the socket's `poll_ref` owns loop liveness.
                r.update_ref(false);
                r.start(read_fd, info.pollable)
            });
            let failed = match started {
                Err(err) => Some(err),
                Ok(()) => self.open_error.take(),
            };
            if let Some(err) = failed {
                self.reader.with_mut(|r| {
                    // `fd` stays the caller's; only the poll goes.
                    r.handle.close_without_closing_fd();
                    r.deinit();
                });
                if self.flags.get().contains(Flags::HAS_WRITER) {
                    // Quiet: OPENING makes `on_writer_close` only record it
                    // and close the writer's dup.
                    self.writer.with_mut(|w| w.end());
                    self.update_flags(|f| f.insert(Flags::WRITER_DONE));
                }
                if read_fd != fd {
                    read_fd.close();
                }
                self.update_flags(|f| {
                    f.remove(Flags::OPENING | Flags::HAS_READER);
                });
                return Err(err);
            }
            self.read_fd.set(read_fd);
            self.update_flags(|f| f.insert(Flags::HAS_READER));
            if info.nonblocking {
                self.reader.with_mut(|r| {
                    if let Some(poll) = r.handle.get_poll() {
                        poll.set_flag(bun_io::FilePollFlag::Nonblocking);
                    }
                });
            }
        }

        self.update_flags(|f| {
            f.remove(Flags::OPENING);
            f.set(Flags::DISCONNECTED, false);
            f.set(Flags::IS_CLIENT, true);
        });

        let _keep_alive = self.keep_alive();
        if self.is_tls() {
            // trigger onOpen and start the handshake
            let _ = self.with_wrapper(|w| w.start());
        } else {
            // trigger onOpen
            self.on_open();
        }
        self.flush();
        Ok(())
    }

    /// Set up the in-process SSL wrapper for `open`. Prefers a prebuilt
    /// `SSL_CTX` (moved into `wrapper`) so a memoised `tls.createSecureContext`
    /// reaches this path with its CA bundle intact; on this branch `[buntls]`
    /// returns `{secureContext}` and no longer spreads `{ca,cert,key}`, so the
    /// `SSLConfig` fallback alone would build a CTX with an empty trust store
    /// and fail `DEPTH_ZERO_SELF_SIGNED_CERT`.
    /// Returns null when neither input requested TLS.
    fn init_tls_wrapper(
        &self,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> Option<bun_sys::Result<()>> {
        if let Some(ctx) = owned_ctx {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match WrapperType::init_with_ctx(ctx, true, self.wrapper_handlers()) {
                Ok(w) => self.wrapper.set(Some(w)),
                Err(_) => {
                    return Some(bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    }));
                }
            }
            return Some(bun_sys::Result::Ok(()));
        }
        if let Some(tls) = ssl_options {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match ssl_wrapper::init(&tls, true, self.wrapper_handlers()) {
                Ok(w) => self.wrapper.set(Some(w)),
                Err(_) => {
                    return Some(bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    }));
                }
            }
            return Some(bun_sys::Result::Ok(()));
        }
        None
    }

    pub(crate) fn is_tls(&self) -> bool {
        self.flags.get().is_ssl()
    }

    #[bun_uws::uws_callback(export = "PosixPipe__encode_and_write")]
    pub(crate) fn encode_and_write(&self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(PosixPipe, "encodeAndWrite (len: {})", data.len());
        if let Some(r) = self.with_wrapper(|w| w.write_data(data)) {
            return i32::try_from(r.unwrap_or(0)).expect("int cast");
        }
        self.internal_write(data);
        i32::try_from(data.len()).expect("int cast")
    }

    #[bun_uws::uws_callback(export = "PosixPipe__raw_write")]
    pub(crate) fn raw_write(&self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    /// `socket.destroy()`: bytes the kernel has not taken are dropped, the
    /// writer ends now and its loop hold goes with it (`uv_close` cancels
    /// queued writes; the Windows arm ends its writer the same way). Only
    /// `shutdown` waits for the drain.
    #[bun_uws::uws_callback(export = "PosixPipe__close")]
    pub(crate) fn close(&self) {
        if self.flags.get().inert() {
            return;
        }
        let _ = self.with_wrapper(|w| {
            let _ = w.shutdown(false);
        });
        self.update_flags(|f| f.remove(Flags::END_AFTER_DRAIN));
        if self.flags.get().writer_active() {
            self.with_writer(|w| {
                w.outgoing.reset();
                w.end();
            });
        } else {
            self.finish_close();
        }
    }

    #[bun_uws::uws_callback(export = "PosixPipe__shutdown")]
    pub(crate) fn shutdown(&self) {
        if self.flags.get().inert() {
            return;
        }
        let handled = self.with_wrapper(|w| {
            let _ = w.shutdown(false);
        });
        if handled.is_none() {
            // Plain pipe: end the write side so the peer observes EOF
            // (`Socket.prototype.end()` → `shutdown()`); without it an
            // allowHalfOpen peer waiting on 'end' hangs.
            self.end_writer();
        }
    }

    #[bun_uws::uws_callback(export = "PosixPipe__shutdown_read")]
    pub(crate) fn shutdown_read(&self) {
        if let Some(wrapper) = self.wrapper_ref() {
            wrapper.shutdown_read();
        } else if self.flags.get().reader_active() {
            self.reader.with_mut(|r| r.pause());
        }
    }

    #[bun_uws::uws_callback(export = "PosixPipe__is_shutdown", no_catch)]
    pub(crate) fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_shutdown();
        }

        let flags = self.flags.get();
        flags.disconnected()
            || !flags.writer_active()
            || flags.contains(Flags::END_AFTER_DRAIN)
            || self.writer.get().is_done
    }

    #[bun_uws::uws_callback(export = "PosixPipe__is_closed", no_catch)]
    pub(crate) fn is_closed(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_closed();
        }
        self.flags.get().disconnected()
    }

    #[bun_uws::uws_callback(export = "PosixPipe__is_established", no_catch)]
    pub(crate) fn is_established(&self) -> bool {
        !self.is_closed()
    }

    pub(crate) fn ssl(&self) -> Option<*mut boringssl::SSL> {
        self.wrapper_ref()
            .and_then(|w| w.ssl.get())
            .map(|p| p.as_ptr())
    }

    #[bun_uws::uws_callback(export = "PosixPipe__ssl_error", no_catch)]
    pub(crate) fn ssl_error(&self) -> us_bun_verify_error_t {
        let err = self.ssl_error.get();
        us_bun_verify_error_t {
            error_no: err.error_no,
            // CertError.code/.reason are owned `Box<CStr>`s; fall back to "" when absent.
            code: err.code.as_deref().map_or(c"".as_ptr(), |c| c.as_ptr()),
            reason: err.reason.as_deref().map_or(c"".as_ptr(), |c| c.as_ptr()),
        }
    }

    pub(crate) fn reset_timeout(&self) {
        self.set_timeout_in_milliseconds(self.current_timeout.get());
    }

    pub(crate) fn set_timeout_in_milliseconds(&self, ms: c_uint) {
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
        self.current_timeout.set(ms);

        // if the interval is 0 means that we stop the timer
        if ms == 0 {
            return;
        }

        // reschedule the timer
        // `EventLoopTimer.next` is the lower-tier `ElTimespec` stub;
        // bridge from `bun_core::Timespec` until the lower tier switches.
        let next =
            bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, ms as i64);
        self.event_loop_timer.with_mut(|t| {
            t.next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            };
        });
        timer_all().insert(
            core::ptr::addr_of!(self.event_loop_timer)
                .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>()
                .cast_mut(),
        );
    }

    #[bun_uws::uws_callback(export = "PosixPipe__set_timeout")]
    pub(crate) fn set_timeout(&self, seconds: c_uint) {
        bun_output::scoped_log!(PosixPipe, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    /// Free internal resources, it can be called multiple times.
    // Private idempotent helper invoked from on_close and Drop.
    // Owned fields (reader, writer, wrapper, ssl_error) free themselves via
    // their own Drop impls; only the side effects (timer cancel, closing the
    // halves, take()) remain explicit here.
    fn release_resources(&self) {
        bun_output::scoped_log!(PosixPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        // A TLS close_notify (`ssl_on_close`) reaches here with both halves
        // still open: close them now rather than when the context is freed a
        // tick later. Both flags are set first so the writer's close callback
        // does not re-enter `finish_close` → `on_close` (and so skips the fd:
        // closed below instead).
        let flags = self.flags.get();
        self.update_flags(|f| f.insert(Flags::READER_DONE | Flags::WRITER_DONE));
        self.close_read_fd();
        if flags.writer_active() {
            self.writer.with_mut(|w| w.end());
        }
        self.close_write_fd();
        self.writer.with_mut(|w| w.outgoing.reset());
        if !flags.contains(Flags::WRAPPER_BUSY) {
            self.wrapper.set(None);
        }
        self.ssl_error.set(CertError::default());
    }
}

impl Drop for PosixPipe {
    fn drop(&mut self) {
        // Mark both halves done first: the writer's own `Drop` releases its
        // fd without a callback, and a callback into a half-dropped `self`
        // has nothing to do.
        self.update_flags(|f| f.insert(Flags::READER_DONE | Flags::WRITER_DONE));
        self.release_resources();
    }
}

// Hand-written shims for the `bun_uws_sys` cycle-break extern — the safe
// methods return `Option<*mut SSL>` / read the fd while the C ABI flattens to
// a nullable raw pointer / `c_int`. All other `PosixPipe__*` symbols are
// emitted by `#[uws_callback(export = …)]` on the inherent methods above.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn PosixPipe__set_inline_reject(this: *const c_void) {
    // SAFETY: `this` is a live `*const PosixPipe` from the bun_uws opaque handle.
    if let Some(wrapper) = unsafe { (*this.cast::<PosixPipe>()).wrapper_ref() } {
        wrapper.set_inline_reject();
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn PosixPipe__latest_session(
    this: *const c_void,
) -> *mut bun_boringssl_sys::SSL_SESSION {
    // SAFETY: `this` is a live `*const PosixPipe` from the bun_uws opaque handle.
    unsafe { (*this.cast::<PosixPipe>()).wrapper_ref() }
        .map_or(core::ptr::null_mut(), |wrapper| wrapper.latest_session())
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn PosixPipe__ssl(this: *const c_void) -> *mut boringssl::SSL {
    // SAFETY: `this` is a live `*const PosixPipe` from the bun_uws opaque handle.
    unsafe {
        (*this.cast::<PosixPipe>())
            .ssl()
            .unwrap_or(core::ptr::null_mut())
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn PosixPipe__fd(this: *const c_void) -> c_int {
    // SAFETY: `this` is a live `*const PosixPipe` from the bun_uws opaque handle.
    unsafe { (*this.cast::<PosixPipe>()).fd.get() }.native()
}

// ── reader / writer parent vtables ───────────────────────────────────────────
//
// Every method takes `*mut Self` and only forms `&Self` (`from_parent_ptr`):
// the reader and writer are intrusive fields of `self`, so the caller holds a
// live `&mut` to one of them while these run. `ref_`/`deref` avoid even the
// shared borrow and project `handlers` through the raw pointer.

bun_io::buffered_reader_parent_link!(PosixPipe for PosixPipe);
impl BufferedReaderParent for PosixPipe {
    const KIND: bun_io::BufferedReaderParentLinkKind =
        bun_io::BufferedReaderParentLinkKind::PosixPipe;
    const HAS_ON_READ_CHUNK: bool = true;

    unsafe fn on_read_chunk(this: *mut Self, chunk: Chunk<'_>, has_more: ReadState) -> bool {
        Self::from_parent_ptr(this).on_read_chunk(&chunk, has_more)
    }
    unsafe fn on_reader_done(this: *mut Self) {
        Self::from_parent_ptr(this).on_reader_done();
    }
    unsafe fn on_reader_error(this: *mut Self, err: bun_sys::Error) {
        Self::from_parent_ptr(this).on_reader_error(err);
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_io::pipe_reader::Loop {
        Self::from_parent_ptr(this).vm.uws_loop()
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        Self::from_parent_ptr(this).event_loop_ctx()
    }
    unsafe fn ref_(this: *mut Self) {
        // SAFETY: see `WriterParent::ref_` below.
        unsafe { <Self as bun_io::pipe_writer::WriterParent>::ref_(this) }
    }
    unsafe fn deref(this: *mut Self) {
        // SAFETY: see `WriterParent::deref` below.
        unsafe { <Self as bun_io::pipe_writer::WriterParent>::deref(this) }
    }
}

impl bun_io::pipe_writer::WriterParent for PosixPipe {
    #[inline]
    unsafe fn ref_(this: *mut Self) {
        // SAFETY: BACKREF set via `set_parent`; the `handlers` field is read
        // through the raw pointer so no `&Self` overlaps the caller's
        // `&mut writer`/`&mut reader`. Intrusive refcount bump on the context.
        unsafe {
            let handlers = &raw const (*this).handlers;
            ((*handlers).ref_ctx)((*handlers).ctx);
        }
    }
    #[inline]
    unsafe fn deref(this: *mut Self) {
        // SAFETY: see ref_. May schedule the free of the context (deferred to
        // a task, so `this` stays valid for the rest of the caller).
        unsafe {
            let handlers = &raw const (*this).handlers;
            ((*handlers).deref_ctx)((*handlers).ctx);
        }
    }
}

impl bun_io::pipe_writer::PosixStreamingWriterParent for PosixPipe {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::posix_event_loop::poll_tag::POSIX_PIPE_WRITER;
    #[inline]
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        Self::from_parent_ptr(this).on_write(amount, status);
    }
    #[inline]
    unsafe fn on_error(this: *mut Self, err: bun_sys::Error) {
        Self::from_parent_ptr(this).on_writer_error(err);
    }
    #[inline]
    unsafe fn on_close(this: *mut Self) {
        Self::from_parent_ptr(this).on_writer_close();
    }
    #[inline]
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        Self::from_parent_ptr(this).event_loop_ctx()
    }
    #[inline]
    unsafe fn loop_(this: *mut Self) -> *mut bun_uws_sys::Loop {
        Self::from_parent_ptr(this).vm.uws_loop()
    }
}
