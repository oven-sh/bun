//! Wrapper that provides a socket-like API for Windows Named Pipes.
//!
//! This allows us to use the same networking interface and event handling
//! patterns across platforms, treating Named Pipes as if they were regular
//! sockets. The wrapper translates between µWebSockets' socket-based API
//! and Windows Named Pipe operations, enabling seamless cross-platform
//! IPC without requiring separate code paths for Windows vs Unix domain sockets.
//!
//! Integration with µWebSockets/uSockets:
//! - Uses the same event loop and timer mechanisms as other socket types
//! - Implements compatible handlers (onOpen, onData, onClose, etc.) that match uSockets callbacks
//! - Supports SSL/TLS wrapping through the same BoringSSL integration used by TCP sockets
//! - Provides streaming writer interface that mirrors uSockets' write operations
//! - Maintains the same connection lifecycle and state management as network sockets
//! - Enables transparent use of Named Pipes in contexts expecting standard socket APIs
//!
//! Uses libuv for the underlying Named Pipe operations while maintaining compatibility
//! with µWebSockets, bridging the gap between libuv's pipe handling and uSockets'
//! unified socket interface.

use core::cell::{Cell, OnceCell};
use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_boringssl_sys as boringssl;
use bun_collections::ByteVecExt;
use bun_core::{ZStr, timespec};
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{StreamingWriter, WriteStatus};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{GlobalRef, JsCell, SysErrorJsc};
use bun_libuv_sys::{UvHandle as _, UvStream as _};
use bun_ptr::RefPtr;
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd, ReturnCodeExt as _, SystemErrno};
use bun_uws::ssl_wrapper::{self, SSLWrapper};
use bun_uws::{self as uws, Transport, us_bun_verify_error_t};

use crate::socket::{NewSocket, TCPSocket, TLSSocket};
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(WindowsNamedPipe, visible);

type WrapperType = SSLWrapper<*mut WindowsNamedPipe>;

use crate::jsc_hooks::timer_all_mut as timer_all;

/// Live pipes, read by `bun:internal-for-testing` leak tests: `heapStats()` only sees the JS wrappers.
pub(crate) static LIVE_COUNT: AtomicUsize = AtomicUsize::new(0);

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::queue_free)]
pub(crate) struct WindowsNamedPipe {
    /// Starts at one, the connection's ref, which `on_close` releases.
    ref_count: Cell<u32>,
    handle: uws::TransportHandle,
    /// Holds one ref on the socket while not `None`. `on_close` and `fail_connect` release it.
    socket: Cell<SocketType>,
    global_this: GlobalRef,
    is_open: Cell<bool>,
    /// In no uSockets group, so the context that opened it closes it through this when it stops.
    abort_handle: bun_jsc::AbortHandle,
    /// Set before the pipe opens and freed with `self`: a `handle_traffic` frame can be on the stack when the pipe closes.
    wrapper: OnceCell<WrapperType>,
    pub(crate) deferred_writer_close: Cell<bool>,
    pub(crate) root: Cell<*mut WindowsNamedPipe>,
    /// Non-owning alias of the heap `uv::Pipe`. The owning
    /// `Box<uv::Pipe>` is leaked in [`Self::create`] and adopted by
    /// `self.writer.source` (`Source::Pipe`) inside [`start`]; this field only
    /// ever observes/null-checks the handle, never frees it. Cleared by
    /// [`Self::on_close`] before the writer's async close frees the Box.
    pub(crate) pipe: Cell<Option<NonNull<uv::Pipe>>>, // any duplex
    /// The per-thread VM singleton outlives this struct (it is torn down only
    /// at thread exit, after every named pipe is closed), so `&'static` is the
    /// honest model here rather than a threaded lifetime.
    pub(crate) vm: &'static VirtualMachine,
    pub(crate) writer: JsCell<StreamingWriter<WindowsNamedPipe>>,

    pub(crate) incoming: JsCell<Vec<u8>>, // Maybe we should use IPCBuffer here as well
    pub(crate) connect_req: JsCell<uv::uv_connect_t>,

    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    pub(crate) current_timeout: Cell<u32>,
    pub(crate) flags: Cell<Flags>,
}

bun_event_loop::impl_timer_owner!(WindowsNamedPipe; from_timer_ptr => event_loop_timer);

// `close` re-enters `on_close`, which may queue the free of `this`.
bun_jsc::impl_abort_handle_owner!(WindowsNamedPipe, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live.
    unsafe { &*this }.close_or_cancel_connect()
});

/// The socket this pipe is the transport of.
#[derive(Copy, Clone)]
pub(crate) enum SocketType {
    Tls(bun_ptr::ThisPtr<TLSSocket>),
    Tcp(bun_ptr::ThisPtr<TCPSocket>),
    None,
}

impl SocketType {
    pub(crate) fn of<const SSL: bool>(socket: bun_ptr::ThisPtr<NewSocket<SSL>>) -> Self {
        let socket = socket.as_ptr();
        // SAFETY: `socket` is live, `NewSocket<true>` is `TLSSocket` and `NewSocket<false>` is `TCPSocket`.
        unsafe {
            if SSL {
                Self::Tls(bun_ptr::ThisPtr::new(socket.cast()))
            } else {
                Self::Tcp(bun_ptr::ThisPtr::new(socket.cast()))
            }
        }
    }
}

/// Runs `$body`, written over `NewSocket<$ssl>`, for the socket in `$socket`, and folds what its handlers left pending. `SocketType::None` is a no-op.
macro_rules! match_socket {
    ($socket:expr, |$s:ident: NewSocket<$ssl:ident>| $body:expr) => {
        match $socket {
            SocketType::Tls($s) => {
                const $ssl: bool = true;
                let _ = $ssl;
                crate::dispatch::fold($body)
            }
            SocketType::Tcp($s) => {
                const $ssl: bool = false;
                let _ = $ssl;
                crate::dispatch::fold($body)
            }
            SocketType::None => {}
        }
    };
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u16 {
        const DISCONNECTED = 1 << 0;
        const IS_CLOSED    = 1 << 1;
        /// Rust-only bookkeeping: set once `start_with_pipe` adopts the
        /// `Box<uv::Pipe>` leaked in `create`. Lets `Drop` reclaim the orphan
        /// allocation on early-error paths (before adoption) without risking a
        /// double-free once the writer owns it.
        const PIPE_ADOPTED = 1 << 4;
        const WRITER_BUSY  = 1 << 6;
        /// `shutdown()` ran on a plain pipe. The write side ends once queued data drains, and reads continue.
        const SHUTDOWN_REQUESTED = 1 << 7;
        /// libuv has the `uv_shutdown` request.
        const SHUTDOWN_SENT = 1 << 8;
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
}

impl WindowsNamedPipe {
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    #[inline]
    fn wrapper_ref(&self) -> Option<&WrapperType> {
        self.wrapper.get()
    }

    #[inline]
    fn uv_pipe(&self) -> Option<*mut uv::Pipe> {
        self.pipe.get().map(NonNull::as_ptr)
    }

    /// Reclaim the leaked `Box<uv::Pipe>` on an early-error path **before**
    /// [`start`] hands it to `self.writer.source` via `start_with_pipe`.
    ///
    /// [`Self::create`] `Box::leak`s the allocation and records only a non-owning
    /// `NonNull` in `self.pipe`; until adoption the writer's `Drop`
    /// (`close_without_reporting`) is a no-op (`source == None`), so any
    /// `connect`/`open`/`get_accepted_by` early return would leak the box and —
    /// if `uv_pipe_init` had already run — leave the handle in the libuv
    /// `handle_queue` with no `uv_close` ever scheduled (loop never drains).
    /// `close_and_destroy` covers both states via its `loop_.is_null()` branch.
    ///
    /// MUST NOT be called once `start_with_pipe` has adopted the allocation
    /// (would double-free against `writer.source`'s `Box`).
    fn discard_unadopted_pipe(&self) {
        debug_assert!(
            self.writer.get().source.is_none(),
            "pipe already adopted by writer.source; discard would double-free"
        );
        if let Some(pipe) = self.pipe.take() {
            // SAFETY: `pipe` is the `NonNull` recorded from `Box::leak` in
            // `create()` and not yet re-materialised (asserted above);
            // `close_and_destroy` reclaims via `Box::from_raw` either
            // immediately (never-init'd, `loop_ == null`) or in the `uv_close`
            // callback (init'd). Ownership transfers here exactly once.
            unsafe { uv::Pipe::close_and_destroy(pipe.as_ptr()) };
        }
    }

    /// Holds a ref on `self` until the returned guard drops.
    ///
    /// `self` frees itself from a task it queues when [`on_close`] releases
    /// the connection's ref. A handler can close the socket and then spin the
    /// event loop before it returns (`expect().resolves` blocks on a promise
    /// that way), which runs that task. A callback that uses `self` after it
    /// dispatched to a handler holds this guard, so the free waits until the
    /// callback is done. The writer does the same around an in-flight write,
    /// and `connect`/`open` around the connect.
    ///
    /// Only for paths that cannot run after `on_close` released the
    /// connection's ref (reads stop and the wrapper goes away in
    /// `release_resources`): a ref taken at zero would queue the free twice.
    ///
    /// [`on_close`]: Self::on_close
    fn keep_alive(&self) -> RefPtr<Self> {
        // SAFETY: `root_ptr` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.root_ptr()) }
    }

    /// Releases one ref. The last one queues the free, so `self` outlives the caller's frame.
    fn release(&self) {
        // SAFETY: `root_ptr` is the live heap allocation, and the caller owns the ref.
        unsafe { Self::deref(self.root_ptr()) }
    }

    fn queue_free(this: *mut Self) {
        // SAFETY: the count just reached zero; `this` is live until the task runs.
        unsafe { (*this).vm }
            .event_loop_mut()
            .enqueue_task(bun_jsc::Task::init(this));
    }

    /// SAFETY: `this` is the queued pointer, whose last ref is gone. The call frees it.
    pub(crate) unsafe fn run_event(this: *mut Self) {
        // SAFETY: fn contract.
        drop(unsafe { bun_core::heap::take(this) });
    }

    /// `self` as the handle its socket holds.
    fn handle<const SSL: bool>(&self) -> uws::NewSocketHandler<SSL> {
        uws::NewSocketHandler::from_transport(&self.handle)
    }

    fn on_writable(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWritable");
        // flush pending data
        self.flush();
        // call onWritable (will flush on demand)
        self.dispatch_writable();
    }

    fn dispatch_writable(&self) {
        match_socket!(self.socket.get(), |s: NewSocket<SSL>| {
            NewSocket::on_writable(s, self.handle::<SSL>())
        });
    }

    fn on_read(&self, nread: usize) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", nread);
        let _keep_alive = self.keep_alive();
        // SAFETY: `nread` bytes written by libuv into on_read_alloc's slice.
        self.incoming
            .with_mut(|incoming| unsafe { incoming.uv_commit(nread) });

        self.reset_timeout();

        let mut data = self.incoming.replace(Vec::new());

        match self.wrapper_ref() {
            Some(w) => w.receive_data(data.as_slice()),
            None => self.on_data(data.as_slice()),
        }
        data.clear();
        self.incoming.set(data);
    }

    fn on_write(&self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(
            WindowsNamedPipe,
            "onWrite {} {}",
            amount,
            match status {
                WriteStatus::Pending => "pending",
                WriteStatus::Drained => "drained",
                WriteStatus::EndOfFile => "end_of_file",
            }
        );

        match status {
            WriteStatus::Pending => {}
            WriteStatus::Drained => {
                // unref after sending all data
                self.writer.with_mut(|w| {
                    if let Some(source) = w.source.as_mut() {
                        // `Source` is an enum;
                        // `unref()` matches the active variant (always `Pipe` here
                        // via `start_with_pipe`).
                        source.unref();
                    }
                });
                self.send_shutdown_if_drained();
            }
            WriteStatus::EndOfFile => {
                // we send FIN so we close after this
                self.close_writer();
            }
        }
    }

    #[inline]
    fn root_ptr(&self) -> *mut WindowsNamedPipe {
        let p = self.root.get();
        debug_assert!(!p.is_null(), "WindowsNamedPipe root not recorded");
        p
    }

    fn close_writer(&self) {
        self.with_writer(|w| w.close());
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

    fn on_read_error(&self, err: bun_sys::E) {
        bun_output::scoped_log!(WindowsNamedPipe, "onReadError");
        let _keep_alive = self.keep_alive();
        if err == bun_sys::E::EOF {
            // we received FIN but we dont allow half-closed connections right now
            match_socket!(self.socket.get(), |s: NewSocket<SSL>| {
                NewSocket::on_end(s, self.handle::<SSL>())
            });
            self.close_writer();
            return;
        }
        self.on_error(bun_sys::Error::from_code(err, bun_sys::Tag::read));
        self.close_writer();
    }

    fn on_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(WindowsNamedPipe, "onError");
        let _keep_alive = self.keep_alive();
        if self.is_open.get() {
            match_socket!(self.socket.get(), |s: NewSocket<SSL>| {
                s.handle_error(err.to_js(&self.global_this))
            });
        } else {
            self.fail_connect(SystemErrno::from_raw(err.errno));
        }
        self.close();
    }

    /// `connectError` is the last event of a socket whose connect failed, so this pipe forgets the socket: neither `on_close`, which still fires on the asynchronous failure path, nor `Drop` touches it again.
    fn fail_connect(&self, errno: SystemErrno) {
        // Cleared before `connectError` runs JS, which may connect the same socket again through a new pipe.
        let socket = self.socket.replace(SocketType::None);
        match_socket!(socket, |s: NewSocket<SSL>| {
            let failed = NewSocket::handle_connect_error(s, errno);
            s.get().deref();
            failed
        });
    }

    fn on_open(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onOpen");
        self.is_open.set(true);
        match_socket!(self.socket.get(), |s: NewSocket<SSL>| {
            NewSocket::on_open(s, self.handle::<SSL>())
        });
    }

    fn on_data(&self, decoded_data: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onData ({})", decoded_data.len());
        match_socket!(self.socket.get(), |s: NewSocket<SSL>| {
            NewSocket::on_data(s, self.handle::<SSL>(), decoded_data)
        });
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
    fn ssl_on_close(this: *mut Self) {
        // SAFETY: see block note above.
        unsafe { &*this }.on_close()
    }
    fn ssl_write(this: *mut Self, d: &[u8]) -> usize {
        // SAFETY: see block note above.
        unsafe { &*this }.internal_write(d);
        d.len()
    }

    fn wrapper_handlers(&self) -> ssl_wrapper::Handlers<*mut WindowsNamedPipe> {
        ssl_wrapper::Handlers {
            ctx: self.root_ptr(),
            on_open: Self::ssl_on_open,
            on_handshake: Self::ssl_on_handshake,
            on_data: Self::ssl_on_data,
            on_close: Self::ssl_on_close,
            write: Self::ssl_write,
        }
    }

    fn on_handshake(&self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(WindowsNamedPipe, "onHandshake");
        let _keep_alive = self.keep_alive();

        match_socket!(self.socket.get(), |s: NewSocket<SSL>| {
            NewSocket::on_handshake(s, self.handle::<SSL>(), handshake_success as i32, ssl_error)
        });
        // Retry writes parked during the handshake; a TLS 1.2 client's completion sends nothing.
        if handshake_success && !self.is_shutdown() {
            self.dispatch_writable();
        }
    }

    fn on_close(&self) {
        if self.flags.get().contains(Flags::WRITER_BUSY) {
            self.deferred_writer_close.set(true);
            return;
        }
        bun_output::scoped_log!(WindowsNamedPipe, "onClose");
        self.pipe.set(None);
        if !self.flags.get().is_closed() {
            self.update_flags(|f| f.set(Flags::IS_CLOSED, true)); // only call onClose once
            let socket = self.socket.replace(SocketType::None);
            match_socket!(socket, |s: NewSocket<SSL>| {
                let closed = NewSocket::on_close(s, self.handle::<SSL>(), 0, None);
                s.get().deref();
                closed
            });
            self.release_resources();
            // The connection's ref.
            self.release();
        }
    }

    fn call_write_or_end(&self, data: Option<&[u8]>, msg_more: bool) {
        if let Some(bytes) = data {
            if !bytes.is_empty() {
                // ref because we have pending data
                self.writer.with_mut(|w| {
                    if let Some(source) = w.source.as_mut() {
                        // See `on_write` for the active-variant note.
                        source.ref_();
                    }
                });
                if self.flags.get().disconnected() {
                    // enqueue to be sent after connecting
                    self.writer
                        .with_mut(|w| bun_core::handle_oom(w.outgoing.write(bytes)));
                } else {
                    // write will enqueue the data if it cannot be sent
                    let _ = self.writer.with_mut(|w| w.write(bytes));
                }
            }
        }

        if !msg_more {
            if let Some(w) = self.wrapper_ref() {
                let _ = w.shutdown(false);
            }
            self.with_writer(|w| w.end());
        }
    }

    fn internal_write(&self, encoded_data: &[u8]) {
        self.reset_timeout();

        // Possible scenarios:
        // Scenario 1: will not write if is not connected yet but will enqueue the data
        // Scenario 2: will not write if a exception is thrown (will be handled by onError)
        // Scenario 3: will be queued in memory and will be flushed later
        // Scenario 4: no write/end function exists (will be handled by onError)
        self.call_write_or_end(Some(encoded_data), true);
    }

    pub(crate) fn on_timeout(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onTimeout");

        let has_been_cleared = self.event_loop_timer.get().state == EventLoopTimerState::CANCELLED
            || self.vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.with_mut(|t| {
            t.state = EventLoopTimerState::FIRED;
            t.heap = Default::default();
        });

        if has_been_cleared {
            return;
        }

        match_socket!(self.socket.get(), |s: NewSocket<SSL>| {
            NewSocket::on_timeout(s, self.handle::<SSL>())
        });
    }

    /// The transport of `socket`, on which it takes a ref. Returns the pipe with one ref, the connection's.
    pub(crate) fn create(cx: &bun_jsc::JsThread<'_>, socket: SocketType) -> *mut WindowsNamedPipe {
        let global_this = GlobalRef::from(cx.global());
        let pipe = Box::new(bun_core::ffi::zeroed::<uv::Pipe>());
        let this = bun_core::heap::into_raw(Box::new(WindowsNamedPipe {
            ref_count: Cell::new(1),
            handle: Default::default(),
            socket: Cell::new(socket),
            vm: global_this.bun_vm(),
            global_this,
            is_open: Cell::new(false),
            abort_handle: bun_jsc::AbortHandle::for_owner::<WindowsNamedPipe>(),
            // Leaked here. `start_with_pipe` in `start()` hands the allocation to `self.writer.source`, which frees it.
            pipe: Cell::new(Some(NonNull::from(Box::leak(pipe)))),
            wrapper: OnceCell::new(),
            deferred_writer_close: Cell::new(false),
            root: Cell::new(core::ptr::null_mut()),
            writer: JsCell::new(StreamingWriter::default()),
            incoming: JsCell::new(Vec::new()),
            connect_req: JsCell::new(bun_core::ffi::zeroed::<uv::uv_connect_t>()),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::WindowsNamedPipe,
            )),
            current_timeout: Cell::new(0),
            flags: Cell::new(Flags::DISCONNECTED),
        }));
        // SAFETY: just allocated, and nothing else has the pointer yet.
        unsafe {
            (*this).root.set(this);
            (*this).handle.set(this);
        }
        LIVE_COUNT.fetch_add(1, Ordering::Relaxed);
        match_socket!(socket, |s: NewSocket<SSL>| {
            s.ref_();
            Ok(())
        });
        // SAFETY: fully initialised and heap-pinned; dropping the handle disarms it.
        unsafe { bun_jsc::AbortHandle::arm_owner(this, cx.context()) };
        this
    }

    /// Makes a new pipe the transport of `socket`, then runs `start` on it. On `Err` the socket is detached again and has had no event.
    fn attach(
        cx: &bun_jsc::JsThread<'_>,
        socket: SocketType,
        start: impl FnOnce(&WindowsNamedPipe) -> bun_sys::Result<()>,
    ) -> Result<(), SystemErrno> {
        // SAFETY: `create()` returns a live pipe with its only ref.
        let pipe = unsafe { &*Self::create(cx, socket) };
        match_socket!(socket, |s: NewSocket<SSL>| {
            s.socket.set(pipe.handle::<SSL>());
            Ok(())
        });
        if start(pipe).is_ok() {
            return Ok(());
        }
        pipe.socket.set(SocketType::None);
        match_socket!(socket, |s: NewSocket<SSL>| {
            s.socket.set(uws::NewSocketHandler::<SSL>::DETACHED);
            s.get().deref();
            Ok(())
        });
        pipe.release();
        Err(SystemErrno::ENOENT)
    }

    /// Makes a pipe over the libuv descriptor `fd` the transport of `socket`.
    pub(crate) fn from_fd(
        cx: &bun_jsc::JsThread<'_>,
        fd: Fd,
        ssl_ctx: Option<boringssl::OwnedSslCtx>,
        socket: SocketType,
    ) -> Result<(), SystemErrno> {
        Self::attach(cx, socket, |pipe| pipe.open(fd, ssl_ctx))
    }

    /// Makes a pipe that connects to `path` the transport of `socket`.
    pub(crate) fn from_path(
        cx: &bun_jsc::JsThread<'_>,
        path: &[u8],
        ssl_ctx: Option<boringssl::OwnedSslCtx>,
        socket: SocketType,
    ) -> Result<(), SystemErrno> {
        Self::attach(cx, socket, |pipe| {
            if path[path.len() - 1] == 0 {
                return pipe.connect(ZStr::from_slice_with_nul(path), ssl_ctx);
            }
            let mut path_buf = bun_paths::path_buffer_pool::get();
            let len = path.len().min(path_buf.len() - 1);
            path_buf[..len].copy_from_slice(&path[..len]);
            path_buf[len] = 0;
            pipe.connect(ZStr::from_buf(&path_buf[..], len), ssl_ctx)
        })
    }

    /// `extern "C"` trampoline matching `uv_connect_cb` (`Pipe::connect`'s
    /// `on_connect` parameter). Recovers `*mut Self` from `req->data` (set in
    /// `connect()`) and forwards to the safe `&self` body. Only ever invoked
    /// by libuv (coerces to the `uv_connect_cb` fn-pointer type at the
    /// `Pipe::connect` call site).
    extern "C" fn uv_on_connect(req: *mut uv::uv_connect_t, status: uv::ReturnCode) {
        // SAFETY: `req` is `self.connect_req`, whose `data` was set to
        // `self as *mut Self` in `connect`; the owning struct is kept alive by
        // the `ref_()` taken there until this callback runs.
        let this = unsafe { (*req).data.cast::<Self>() };
        // SAFETY: as above.
        unsafe { &*this }.on_connect(status);
    }

    fn on_connect(&self, status: uv::ReturnCode) {
        if let Some(pipe) = self.uv_pipe() {
            // SAFETY: live libuv handle alias; see `pipe`.
            unsafe { (*pipe).unref() };
        }

        if let Some(err) = status.to_error(bun_sys::Tag::connect) {
            // The writer never adopted the pipe (`start_with_pipe` only runs on
            // the success branch below), so `on_error → close → writer.end()`
            // has no source to close: it neither frees the pipe nor reports
            // `on_close`. Do both here. `discard_unadopted_pipe` schedules the
            // `uv_close` that frees the `Box`, like the synchronous early-error
            // paths in `connect`/`open`/`get_accepted_by`, and `on_close` is
            // what releases the connection's ref.
            self.discard_unadopted_pipe();
            self.on_error(err);
            self.on_close();
            self.release();
            return;
        }

        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start() {
            match self.wrapper_ref() {
                // trigger onOpen and start the handshake
                Some(w) => w.start(),
                None => self.on_open(),
            }
        }
        self.flush();
        // With nothing queued, no `on_write(Drained)` follows to send a shutdown requested before the connect.
        self.send_shutdown_if_drained();
        self.release();
    }

    pub(crate) fn get_accepted_by(
        &self,
        server: &mut uv::Pipe,
        ssl_ctx: Option<&boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        let _keep_alive = self.keep_alive();
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        self.init_tls_wrapper(ssl_ctx.cloned(), false);
        let uv_loop = self.vm.uv_loop();
        let pipe = self.uv_pipe().unwrap();
        // SAFETY: live libuv handle alias; see `pipe`.
        if let Err(e) = unsafe { (*pipe).init(uv_loop, false) }.to_result(bun_sys::Tag::pipe) {
            self.discard_unadopted_pipe();
            return Err(e);
        }
        // Until the writer adopts it (start_with_pipe), a thread teardown closes
        // this pipe through us; afterwards the writer re-records itself as owner.
        uv::open_handles::set_owner(
            pipe.cast(),
            self.root_ptr().cast(),
            Some(Self::stop_for_vm_teardown),
        );

        // SAFETY: as above.
        if let Err(e) = server
            .accept(unsafe { &mut *pipe })
            .to_result(bun_sys::Tag::accept)
        {
            self.discard_unadopted_pipe();
            return Err(e);
        }

        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start() {
            match self.wrapper_ref() {
                // trigger onOpen and start the handshake
                Some(w) => w.start(),
                None => self.on_open(),
            }
        }
        bun_sys::Result::Ok(())
    }

    fn open(&self, fd: Fd, ssl_ctx: Option<boringssl::OwnedSslCtx>) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        self.init_tls_wrapper(ssl_ctx, true);
        let uv_loop = self.vm.uv_loop();
        let pipe = self.uv_pipe().unwrap();
        // SAFETY: live libuv handle alias; see `pipe`.
        if let Err(e) = unsafe { (*pipe).init(uv_loop, false) }.to_result(bun_sys::Tag::pipe) {
            self.discard_unadopted_pipe();
            return Err(e);
        }
        // Until the writer adopts it (start_with_pipe), a thread teardown closes
        // this pipe through us; afterwards the writer re-records itself as owner.
        uv::open_handles::set_owner(
            pipe.cast(),
            self.root_ptr().cast(),
            Some(Self::stop_for_vm_teardown),
        );

        // SAFETY: as above.
        if let Err(e) = unsafe { (*pipe).open(fd.uv()) }.to_result(bun_sys::Tag::open) {
            self.discard_unadopted_pipe();
            return Err(e);
        }

        self.ref_();
        self.on_connect(uv::ReturnCode::ZERO);
        bun_sys::Result::Ok(())
    }

    fn connect(&self, path: &[u8], ssl_ctx: Option<boringssl::OwnedSslCtx>) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));
        let pipe = self.uv_pipe().unwrap();
        // ref because we are connecting
        // SAFETY: live libuv handle alias; see `pipe`.
        unsafe { (*pipe).ref_() };

        self.init_tls_wrapper(ssl_ctx, true);
        let uv_loop = self.vm.uv_loop();
        // SAFETY: as above.
        if let Err(e) = unsafe { (*pipe).init(uv_loop, false) }.to_result(bun_sys::Tag::pipe) {
            self.discard_unadopted_pipe();
            return Err(e);
        }
        // Until the writer adopts it (start_with_pipe), a thread teardown closes
        // this pipe through us; afterwards the writer re-records itself as owner.
        uv::open_handles::set_owner(
            pipe.cast(),
            self.root_ptr().cast(),
            Some(Self::stop_for_vm_teardown),
        );

        let ctx: *mut Self = self.root_ptr();
        let req: *mut uv::uv_connect_t = self.connect_req.as_ptr();
        // SAFETY: `req` is our own cell storage; libuv stashes `req`/`ctx` until
        // the connect callback fires (this struct outlives that).
        unsafe { (*req).data = ctx.cast::<c_void>() };
        // SAFETY: `pipe` is live (see above) and `req`/`pipe` are disjoint.
        if let Some(err) =
            unsafe { (*pipe).connect(&mut *req, path, ctx.cast::<c_void>(), Self::uv_on_connect) }
                .to_error(bun_sys::Tag::connect2)
        {
            self.discard_unadopted_pipe();
            return Err(err);
        }
        self.ref_();
        Ok(())
    }

    /// Makes the TLS engine if `ssl_ctx` asks for one.
    fn init_tls_wrapper(&self, ssl_ctx: Option<boringssl::OwnedSslCtx>, is_client: bool) {
        let Some(ctx) = ssl_ctx else { return };
        self.wrapper
            .get_or_init(|| WrapperType::init_with_ctx(ctx, is_client, self.wrapper_handlers()));
    }

    fn start(&self) -> bool {
        let Some(pipe_nn) = self.pipe.get() else {
            return false;
        };
        // SAFETY: live libuv handle alias; see `pipe`.
        unsafe { (*pipe_nn.as_ptr()).unref() };
        let this: *mut Self = self.root_ptr();
        self.update_flags(|f| f.insert(Flags::PIPE_ADOPTED));
        let start_pipe_result = self.writer.with_mut(|w| {
            w.set_parent(this);
            // SAFETY: `start_with_pipe`'s contract is "Box-allocated pointer;
            // ownership transfers to `self.source`". `pipe_nn` is the
            // `NonNull` recorded from the `Box<uv::Pipe>` leaked in `create()`
            // and not yet adopted (asserted by `start_with_pipe`'s
            // `debug_assert!(source.is_none())`).
            unsafe { w.start_with_pipe(pipe_nn.as_ptr()) }
        });
        if let bun_sys::Result::Err(err) = start_pipe_result {
            self.on_error(err);
            return false;
        }
        let Some(stream) = self.writer.with_mut(|w| w.get_stream()) else {
            self.on_error(bun_sys::Error::from_code(
                bun_sys::E::PIPE,
                bun_sys::Tag::read,
            ));
            return false;
        };

        // SAFETY: `stream` is the live `*mut uv_stream_t` for our pipe
        // (returned by `writer.get_stream()`); the `StreamReader` impl
        // below routes the trampolines back to `self`.
        let read_start_result =
            unsafe { (*stream).read_start_ctx::<Self>(this) }.to_result(bun_sys::Tag::listen);
        if let bun_sys::Result::Err(err) = read_start_result {
            self.on_error(err);
            return false;
        }
        true
    }

    /// `uv::open_handles` closes a not-yet-adopted pipe through here at teardown.
    unsafe fn stop_for_vm_teardown(this: *mut core::ffi::c_void) {
        // SAFETY: recorded right after `pipe.init` by this live object; replaced by
        // the writer at adoption or dropped with the pipe (discard_unadopted_pipe).
        unsafe { &*this.cast::<Self>() }.close_or_cancel_connect();
    }

    /// `close`, for a pipe that may still be connecting. That one is not the writer's yet, so
    /// `close` has nothing to end and the connection would open later all the same: discarding the
    /// pipe cancels the connect (libuv completes it with `UV_ECANCELED`), and `on_connect` reports
    /// the error and the close.
    pub(crate) fn close_or_cancel_connect(&self) {
        if !self.flags.get().contains(Flags::PIPE_ADOPTED) {
            self.discard_unadopted_pipe();
            return;
        }
        self.close();
    }

    /// Half-closes with `uv_shutdown` once libuv has every queued byte. `writer.end()` would close the read side too and drop the peer's reply.
    fn send_shutdown_if_drained(&self) {
        let flags = self.flags.get();
        if !flags.contains(Flags::SHUTDOWN_REQUESTED)
            || flags.contains(Flags::SHUTDOWN_SENT)
            || flags.is_closed()
            || flags.disconnected()
            || self.writer.get().has_pending_data()
        {
            return;
        }
        let Some(stream) = self.writer.with_mut(|w| w.get_stream()) else {
            self.with_writer(|w| w.end());
            return;
        };
        self.update_flags(|f| f.insert(Flags::SHUTDOWN_SENT));
        let req = bun_core::heap::alloc(bun_core::ffi::zeroed::<uv::uv_shutdown_t>());
        // SAFETY: `stream` is the live pipe stream owned by `self.writer.source`. libuv
        // owns `req` until it calls `uv_on_shutdown`, with `UV_ECANCELED` if the handle
        // closes first.
        let rc = unsafe { uv::uv_shutdown(req, stream, Some(Self::uv_on_shutdown)) };
        if rc.is_err() {
            // SAFETY: libuv didn't take `req`, so the callback never runs.
            unsafe { bun_core::heap::destroy(req) };
            // Close the whole handle so the peer still sees EOF.
            self.with_writer(|w| w.end());
        }
    }

    /// Only frees the request. A canceled shutdown can run after its `WindowsNamedPipe` is gone.
    extern "C" fn uv_on_shutdown(req: *mut uv::uv_shutdown_t, _status: core::ffi::c_int) {
        // SAFETY: `req` comes from `heap::alloc` in `send_shutdown_if_drained`, and libuv calls this once.
        unsafe { bun_core::heap::destroy(req) };
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
        let next = timespec::ms_from_now(bun_core::TimespecMockMode::ForceRealTime, ms as i64);
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

    /// Free internal resources, it can be called multiple times.
    // Private idempotent helper invoked from on_close and Drop.
    // Owned fields (writer, wrapper) free themselves via their own Drop impls; only
    // the side effects (timer cancel, read_stop, take()) remain explicit here.
    fn release_resources(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        // "The source is already
        // closed by the time on_close reaches here (that close is what fired the
        // callback)" is true ONLY for the writer-initiated close path
        // (`WindowsStreamingWriterParent::on_close`). It is FALSE when we arrive
        // via `ssl_on_close` (TLS close_notify): the underlying `uv_pipe_t` is
        // still open and in libuv's handle_queue, so without an explicit close
        // here the HANDLE survives ≥ one extra event-loop tick (until the
        // pipe's refcount hits 0 and `WindowsStreamingWriter::Drop`
        // finally runs). Inline `close_without_reporting()` (private on the
        // writer) so the source pipe is `uv_close`d NOW; the `get_fd() != INVALID`
        // guard makes this a no-op on the writer-initiated path where the source
        // was already taken, and `closed_without_reporting = true` keeps
        // `on_close_source()` from re-entering `Parent::on_close` (we're already
        // inside it). `current_payload` may still back an in-flight `uv_write`
        // (cancelled async by `uv_close`) so it is left to the writer's own Drop.
        if let Some(stream) = self.writer.with_mut(|w| w.get_stream()) {
            // SAFETY: `stream` is the live pipe stream; `uv_read_stop`
            // always succeeds and is a no-op if not reading.
            unsafe { (*stream).read_stop() };
        }
        self.writer.with_mut(|w| w.close_without_reporting());
        self.writer.with_mut(|w| w.outgoing = Default::default());
        if let Some(w) = self.wrapper_ref() {
            w.deinit();
        }
    }
}

impl Transport for WindowsNamedPipe {
    fn is_closed(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_closed();
        }
        self.flags.get().disconnected()
    }

    fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_shutdown();
        }

        let flags = self.flags.get();
        flags.disconnected()
            || flags.contains(Flags::SHUTDOWN_REQUESTED)
            || self.writer.get().is_done
    }

    fn write(&self, data: &[u8]) -> (i32, i32) {
        bun_output::scoped_log!(WindowsNamedPipe, "write (len: {})", data.len());
        if let Some(w) = self.wrapper_ref() {
            let written = w.write_data(data).unwrap_or(0);
            return (i32::try_from(written).expect("int cast"), 0);
        }
        self.internal_write(data);
        (i32::try_from(data.len()).expect("int cast"), 0)
    }

    fn raw_write(&self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    fn shutdown(&self) {
        if let Some(w) = self.wrapper_ref() {
            let _ = w.shutdown(false);
            return;
        }
        let flags = self.flags.get();
        if flags.contains(Flags::SHUTDOWN_REQUESTED) || flags.is_closed() {
            return;
        }
        self.update_flags(|f| f.insert(Flags::SHUTDOWN_REQUESTED));
        self.send_shutdown_if_drained();
    }

    fn close(&self) {
        if let Some(w) = self.wrapper_ref() {
            let _ = w.shutdown(false);
        }
        self.with_writer(|w| w.end());
    }

    fn pause_stream(&self) -> bool {
        let Some(pipe) = self.uv_pipe() else {
            return false;
        };
        // SAFETY: live libuv handle alias; see `pipe`.
        unsafe { (*pipe).read_stop() };
        true
    }

    fn resume_stream(&self) -> bool {
        let Some(stream) = self.writer.with_mut(|w| w.get_stream()) else {
            return false;
        };
        let this: *mut Self = self.root_ptr();
        // SAFETY: `stream` is the live `*mut uv_stream_t` for our pipe
        // (returned by `writer.get_stream()`); the `StreamReader` impl
        // below routes the trampolines back to `self`.
        let read_start_result =
            unsafe { (*stream).read_start_ctx::<Self>(this) }.to_result(bun_sys::Tag::listen);
        read_start_result.is_ok()
    }

    fn shutdown_read(&self) {
        if let Some(wrapper) = self.wrapper_ref() {
            wrapper.shutdown_read();
        } else {
            if let Some(stream) = self.writer.with_mut(|w| w.get_stream()) {
                // SAFETY: `stream` is the live pipe stream; `uv_read_stop`
                // always succeeds and is a no-op if not reading.
                unsafe { (*stream).read_stop() };
            }
        }
    }

    fn flush(&self) {
        if let Some(w) = self.wrapper_ref() {
            w.flush();
        }
        if !self.flags.get().disconnected() {
            let _ = self.writer.with_mut(|w| w.flush());
        }
    }

    fn set_timeout(&self, seconds: c_uint) {
        bun_output::scoped_log!(WindowsNamedPipe, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    fn ssl(&self) -> Option<*mut boringssl::SSL> {
        self.wrapper_ref()
            .and_then(|w| w.ssl.get())
            .map(|p| p.as_ptr())
    }
}

impl Drop for WindowsNamedPipe {
    fn drop(&mut self) {
        LIVE_COUNT.fetch_sub(1, Ordering::Relaxed);
        // A pipe that never opened and never failed still holds its socket.
        let socket = self.socket.replace(SocketType::None);
        match_socket!(socket, |s: NewSocket<SSL>| {
            s.get().deref();
            Ok(())
        });
        self.release_resources();
        // Reclaim the `Box<uv::Pipe>` leaked in `create()` if it was never
        // adopted by `self.writer.source` (early-error returns from
        // `connect`/`open`/`get_accepted_by` before `start()` runs). Once
        // `PIPE_ADOPTED` is set the writer is the sole owner and frees via
        // its libuv close callback — touching it here would double-free.
        // `close_and_destroy` handles both un-adopted states: if `pipe.init()`
        // never ran (`loop_` still null) it just `Box::from_raw`-drops the
        // allocation; if init() DID run before the later open/accept/connect
        // failure it `uv_close`s first so the handle is unlinked from libuv's
        // `handle_queue` before the heap block is freed.
        if !self.flags.get().contains(Flags::PIPE_ADOPTED) {
            if let Some(pipe) = self.pipe.take() {
                // SAFETY: `pipe` is the `NonNull` from `Box::leak` in `create()`,
                // never adopted (gated on `!PIPE_ADOPTED`); `close_and_destroy`
                // is the unique reclaim and accepts both never-init'd and
                // init'd-but-unowned handles.
                unsafe { uv::Pipe::close_and_destroy(pipe.as_ptr()) };
            }
        }
    }
}

impl bun_event_loop::Taskable for WindowsNamedPipe {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::WindowsNamedPipe;
    /// The free that the last ref queued will not run, and nobody else frees `this`. It runs no script.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { Self::run_event(this) }
    }
    /// A socket's own hop. Its handlers carry their context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl bun_io::pipe_writer::WriterParent for WindowsNamedPipe {
    #[inline]
    unsafe fn ref_(this: *mut Self) {
        // SAFETY: BACKREF set via `set_parent`. Intrusive refcount bump.
        unsafe { (*this).ref_() };
    }
    #[inline]
    unsafe fn deref(this: *mut Self) {
        // SAFETY: see ref_. The last ref queues the free.
        unsafe { WindowsNamedPipe::deref(this) };
    }
}

impl bun_io::pipe_writer::WindowsWriterParent for WindowsNamedPipe {
    #[inline]
    unsafe fn loop_(this: *mut Self) -> *mut uv::Loop {
        // SAFETY: BACKREF set via `set_parent`; shared-only read.
        unsafe { (*this).vm.uv_loop() }
    }
}

impl bun_io::pipe_writer::WindowsStreamingWriterParent for WindowsNamedPipe {
    const HAS_ON_WRITABLE: bool = true;
    #[inline]
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        // SAFETY: BACKREF set via `set_parent`; the callbacks take `&self`.
        unsafe { (*this).on_write(amount, status) }
    }
    #[inline]
    unsafe fn on_error(this: *mut Self, err: bun_sys::Error) {
        // SAFETY: see on_write.
        unsafe { (*this).on_error(err) }
    }
    #[inline]
    unsafe fn on_writable(this: *mut Self) {
        // SAFETY: see on_write.
        unsafe { (*this).on_writable() }
    }
    #[inline]
    unsafe fn on_close(this: *mut Self) {
        // SAFETY: see on_write.
        unsafe { (*this).on_close() }
    }
}

/// The three `stream.readStart` callbacks (alloc/error/read) baked into a
/// trait so the
/// `extern "C"` libuv trampoline is monomorphised over `WindowsNamedPipe`.
impl uv::StreamReader for WindowsNamedPipe {
    #[inline]
    fn on_read_alloc(this: &mut Self, suggested_size: usize) -> &mut [u8] {
        let this: &Self = this;
        // SAFETY: the returned region is the buffer's spare capacity handed to
        // libuv for the pending read; nothing else touches `incoming` until
        // `on_read` commits the byte count.
        let incoming = unsafe { &mut *this.incoming.as_ptr() };
        // SAFETY: libuv writes into this region before `on_read` commits it.
        let spare = unsafe { incoming.uv_alloc_spare_u8(suggested_size) };
        &mut spare[..suggested_size]
    }
    #[inline]
    fn on_read_error(this: &mut Self, err: core::ffi::c_int) {
        // The trampoline only reaches this arm when `nreads < 0`, and for any
        // negative code `translate_uv_error_to_e` already
        // yields a concrete `E` (falling back to `UNKNOWN` for unmapped
        // codes). Pass it straight through; do NOT remap UNKNOWN→CANCELED.
        let e = bun_sys::windows::translate_uv_error_to_e(err);
        let this: &Self = this;
        this.on_read_error(e);
    }
    #[inline]
    unsafe fn on_read(this: *mut Self, data: &[u8]) {
        // `data` points into `(*this).incoming` (it was returned from
        // `on_read_alloc`). Capture the only thing the body needs (length)
        // and drop the slice before touching `*this`.
        let nread = data.len();
        // SAFETY: `this` is the live context stashed in `handle.data` by
        // `read_start_ctx`; `data` is no longer live.
        unsafe { &*this }.on_read(nread);
    }
}
