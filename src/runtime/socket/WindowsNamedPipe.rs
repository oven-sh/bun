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

use core::cell::Cell;
use core::ffi::c_uint;

use bun_boringssl_sys as boringssl;
use bun_core::timespec;
#[cfg(windows)]
use bun_io::Source;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{StreamingWriter, WriteStatus};
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
#[cfg(windows)]
use bun_libuv_sys::{UvHandle as _, UvStream as _};
use bun_ptr::{BackRef, Root};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd};
use bun_uws::us_bun_verify_error_t;

use crate::socket::SSLConfig;
use crate::socket::WindowsNamedPipeContext;
use crate::socket::ssl_wrapper::{self, SSLWrapper};
#[cfg(windows)]
use crate::timer::EventLoopTimerTag;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState};

bun_output::declare_scope!(WindowsNamedPipe, visible);

pub type CertError = crate::socket::upgraded_duplex::CertError;

type WrapperType = SSLWrapper<BackRef<WindowsNamedPipe>>;

/// The context embedding this pipe as its `named_pipe` field; socket events
/// and lifetime refs go to it.
type Owner = WindowsNamedPipeContext;

use crate::jsc_hooks::timer_all_mut as timer_all;

pub struct WindowsNamedPipe {
    pub(crate) wrapper: JsCell<Option<WrapperType>>,
    pub(crate) deferred_writer_close: Cell<bool>,
    /// Set by the owning context right after it is allocated (this struct is
    /// one of its fields, so the context outlives it).
    pub(crate) owner: Cell<Option<BackRef<Owner, Root>>>,
    /// The `uv::Pipe` until [`Self::start`] hands it to `writer.source`;
    /// afterwards the handle is reached through the writer.
    #[cfg(windows)]
    pub(crate) pipe: JsCell<Option<Box<uv::Pipe>>>, // any duplex
    #[cfg(not(windows))]
    pub pipe: (),
    /// The per-thread VM singleton outlives this struct (it is torn down only
    /// at thread exit, after every named pipe is closed), so `&'static` is the
    /// honest model here rather than a threaded lifetime.
    pub(crate) vm: &'static VirtualMachine,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub event_loop_handle: bun_jsc::EventLoopHandle,

    /// Its parent is the owning context, whose refcount the writer holds
    /// across each in-flight write.
    pub(crate) writer: JsCell<StreamingWriter<Owner>>,

    pub(crate) incoming: JsCell<Vec<u8>>, // Maybe we should use IPCBuffer here as well
    pub(crate) ssl_error: JsCell<CertError>,
    #[cfg(windows)]
    pub(crate) connect_req: JsCell<uv::uv_connect_t>,
    #[cfg(not(windows))]
    pub connect_req: (),
    /// The context ref an in-flight `connect`/`open` holds until
    /// [`Self::on_connect`] runs.
    connect_ref: Cell<Option<bun_ptr::RefPtr<Owner>>>,

    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    pub(crate) current_timeout: Cell<u32>,
    pub(crate) flags: Cell<Flags>,
}

bun_event_loop::impl_timer_owner!(WindowsNamedPipe; from_timer_ptr => event_loop_timer);

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const DISCONNECTED = 1 << 0;
        const IS_CLOSED    = 1 << 1;
        const IS_CLIENT    = 1 << 2;
        const IS_SSL       = 1 << 3;
        const WRAPPER_BUSY = 1 << 5;
        const WRITER_BUSY  = 1 << 6;
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

    /// The owning context, for dispatching socket events and taking refs.
    #[inline]
    fn owner(&self) -> bun_ptr::ThisPtr<Owner> {
        self.owner
            .get()
            .expect("WindowsNamedPipe owner not recorded")
            .this_ptr()
    }

    /// Run `f` on the `uv::Pipe` — ours until `start()`, the writer's source
    /// after — if there still is one.
    #[cfg(windows)]
    fn with_pipe<R>(&self, f: impl FnOnce(&mut uv::Pipe) -> R) -> Option<R> {
        let mut f = Some(f);
        let r = self.pipe.with_mut(|p| {
            p.as_deref_mut()
                .map(|pipe| (f.take().expect("called once"))(pipe))
        });
        if r.is_some() {
            return r;
        }
        let f = f.take()?;
        self.writer.with_mut(|w| match w.source.as_mut() {
            Some(Source::Pipe(pipe)) => Some(f(pipe)),
            _ => None,
        })
    }

    /// Release the `uv::Pipe` on an early-error path **before** [`start`]
    /// hands it to `self.writer.source`. If `uv_pipe_init` had already run
    /// the handle sits in the libuv `handle_queue`, so it is `uv_close`d
    /// before its allocation is freed; otherwise it is freed directly.
    #[cfg(windows)]
    fn discard_unadopted_pipe(&self) {
        debug_assert!(
            self.writer.get().source.is_none(),
            "pipe already adopted by writer.source"
        );
        if let Some(pipe) = self.pipe.replace(None) {
            pipe.close_and_free();
        }
    }

    /// Holds a ref on the owning context until the returned guard drops.
    ///
    /// The context frees itself from a task it queues when [`on_close`] releases
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
    fn keep_alive(&self) -> bun_ptr::ScopedRef<Owner> {
        self.owner().ref_guard()
    }

    pub(crate) fn on_writable(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWritable");
        // flush pending data
        self.flush();
        // call onWritable (will flush on demand)
        Owner::on_writable(self.owner());
    }

    #[cfg(windows)]
    fn handle_read(&self, nread: usize) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", nread);
        let _keep_alive = self.keep_alive();

        self.reset_timeout();

        let mut data = self.incoming.replace(Vec::new());

        if self
            .with_wrapper(|w| w.receive_data(data.as_slice()))
            .is_none()
        {
            Owner::on_data(self.owner(), data.as_slice());
        }
        data.clear();
        self.incoming.set(data);
    }

    pub(crate) fn on_write(&self, amount: usize, status: WriteStatus) {
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
                #[cfg(windows)]
                self.writer.with_mut(|w| {
                    if let Some(source) = w.source.as_mut() {
                        // `Source` is an enum;
                        // `unref()` matches the active variant (always `Pipe` here
                        // via `start_with_pipe`).
                        source.unref();
                    }
                });
            }
            WriteStatus::EndOfFile => {
                // we send FIN so we close after this
                self.close_writer();
            }
        }
    }

    fn close_writer(&self) {
        self.with_writer(|w| w.close());
    }

    fn with_writer<R>(&self, op: impl FnOnce(&mut StreamingWriter<Owner>) -> R) -> R {
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

    #[cfg(windows)]
    fn handle_read_error(&self, err: bun_sys::E) {
        bun_output::scoped_log!(WindowsNamedPipe, "onReadError");
        let _keep_alive = self.keep_alive();
        // `E::EOF` only exists in the Windows errno table (libuv UV_EOF mapping);
        // this type is Windows-only at runtime so the comparison is gated.
        #[cfg(windows)]
        if err == bun_sys::E::EOF {
            // we received FIN but we dont allow half-closed connections right now
            Owner::on_end(self.owner());
            self.close_writer();
            return;
        }
        self.on_error(bun_sys::Error::from_code(err, bun_sys::Tag::read));
        self.close_writer();
    }

    pub(crate) fn on_error(&self, err: bun_sys::Error) {
        bun_output::scoped_log!(WindowsNamedPipe, "onError");
        let _keep_alive = self.keep_alive();
        Owner::on_error(self.owner(), &err);
        self.close();
    }

    fn on_open(&self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onOpen");
        Owner::on_open(self.owner());
    }

    fn on_data(&self, decoded_data: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onData ({})", decoded_data.len());
        Owner::on_data(self.owner(), decoded_data);
    }

    fn on_session(&self, session: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onSession ({})", session.len());
        Owner::on_session(self.owner(), session);
    }

    fn on_keylog(&self, line: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onKeylog ({})", line.len());
        Owner::on_keylog(self.owner(), line);
    }

    // ── SSLWrapper trampolines ───────────────────────────────────────────────
    // `ssl_wrapper::Handlers<BackRef<Self>>` slots; the engine is a field of
    // `self`, so `self` outlives every call it makes.
    fn ssl_on_open(this: BackRef<Self>) {
        this.on_open()
    }
    fn ssl_on_handshake(this: BackRef<Self>, ok: bool, e: us_bun_verify_error_t) {
        this.on_handshake(ok, e)
    }
    fn ssl_on_data(this: BackRef<Self>, d: &[u8]) {
        this.on_data(d)
    }
    fn ssl_on_session(this: BackRef<Self>, d: &[u8]) {
        this.on_session(d)
    }
    fn ssl_on_keylog(this: BackRef<Self>, d: &[u8]) {
        this.on_keylog(d)
    }
    fn ssl_on_close(this: BackRef<Self>) {
        this.on_close()
    }
    fn ssl_write(this: BackRef<Self>, d: &[u8]) {
        this.internal_write(d)
    }

    #[cfg(windows)]
    fn wrapper_handlers(&self) -> ssl_wrapper::Handlers<BackRef<WindowsNamedPipe>> {
        ssl_wrapper::Handlers {
            ctx: BackRef::new(self),
            on_open: Self::ssl_on_open,
            on_handshake: Self::ssl_on_handshake,
            on_data: Self::ssl_on_data,
            on_close: Self::ssl_on_close,
            write: Self::ssl_write,
            on_session: Some(Self::ssl_on_session),
            on_keylog: Some(Self::ssl_on_keylog),
        }
    }

    fn on_handshake(&self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(WindowsNamedPipe, "onHandshake");
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
        Owner::on_handshake(self.owner(), handshake_success, ssl_error);
        // Retry writes parked during the handshake; a TLS 1.2 client's completion sends nothing.
        if handshake_success && !self.is_shutdown() {
            Owner::on_writable(self.owner());
        }
    }

    pub(crate) fn on_close(&self) {
        if self.flags.get().contains(Flags::WRITER_BUSY) {
            self.deferred_writer_close.set(true);
            return;
        }
        bun_output::scoped_log!(WindowsNamedPipe, "onClose");
        if !self.flags.get().is_closed() {
            self.update_flags(|f| f.set(Flags::IS_CLOSED, true)); // only call onClose once
            Owner::on_close(self.owner());
            self.release_resources();
        }
    }

    fn call_write_or_end(&self, data: Option<&[u8]>, msg_more: bool) {
        if let Some(bytes) = data {
            if !bytes.is_empty() {
                // ref because we have pending data
                #[cfg(windows)]
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
            let _ = self.with_wrapper(|w| {
                let _ = w.shutdown(false);
            });
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

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__resume_stream")]
    pub fn resume_stream(&self) -> bool {
        #[cfg(windows)]
        {
            // Only the writer's stream: before `start()` there is nothing to
            // resume.
            let read_start_result = self.writer.with_mut(|w| match w.source.as_mut() {
                Some(Source::Pipe(pipe)) => Some(pipe.read_start_owned(BackRef::new(self))),
                _ => None,
            });
            match read_start_result {
                Some(rc) => rc.to_result(bun_sys::Tag::listen).is_ok(),
                None => false,
            }
        }
        #[cfg(not(windows))]
        {
            false
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__pause_stream")]
    pub fn pause_stream(&self) -> bool {
        #[cfg(windows)]
        {
            self.with_pipe(|pipe| {
                pipe.read_stop();
            })
            .is_some()
        }
        #[cfg(not(windows))]
        {
            false
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__flush")]
    pub fn flush(&self) {
        let _ = self.with_wrapper(|w| {
            let _ = w.flush();
        });
        if !self.flags.get().disconnected() {
            let _ = self.writer.with_mut(|w| w.flush());
        }
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

        Owner::on_timeout(self.owner());
    }

    #[cfg(windows)]
    pub(crate) fn new(vm: &'static VirtualMachine) -> WindowsNamedPipe {
        // The whole fn is `#[cfg(windows)]`-gated so POSIX builds never see
        // `uv::Pipe`.
        WindowsNamedPipe {
            vm,
            event_loop_handle: bun_jsc::EventLoopHandle::init(vm.event_loop().cast::<()>()),
            pipe: JsCell::new(Some(Box::new(bun_core::ffi::zeroed::<uv::Pipe>()))),
            wrapper: JsCell::new(None),
            deferred_writer_close: Cell::new(false),
            owner: Cell::new(None),
            // defaults:
            writer: JsCell::new(StreamingWriter::default()),
            incoming: JsCell::new(Vec::new()),
            ssl_error: JsCell::new(CertError::default()),
            connect_req: JsCell::new(bun_core::ffi::zeroed::<uv::uv_connect_t>()),
            connect_ref: Cell::new(None),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::WindowsNamedPipe,
            )),
            current_timeout: Cell::new(0),
            flags: Cell::new(Flags::DISCONNECTED), // disconnected: bool = true is the only non-false default
        }
    }

    #[cfg(windows)]
    fn on_connect(&self, status: uv::ReturnCode) {
        // Released once this returns: the ref `connect`/`open` took for the
        // in-flight connect.
        let _connect_ref = scopeguard::guard(self.connect_ref.take(), |r| {
            if let Some(r) = r {
                r.deref();
            }
        });
        let _ = self.with_pipe(|pipe| pipe.unref());

        if let Some(err) = status.to_error(bun_sys::Tag::connect) {
            // The writer never adopted the pipe (`start_with_pipe` only runs on
            // the success branch below), so `on_error → close → writer.end()`
            // has no source to close: it neither frees the pipe nor reports
            // `on_close`. Do both here. `discard_unadopted_pipe` schedules the
            // `uv_close` that frees the `Box`, like the synchronous early-error
            // paths in `connect`/`open`/`accept_from`, and `on_close` is
            // what makes the owner release its ref.
            self.discard_unadopted_pipe();
            self.on_error(err);
            self.on_close();
            return;
        }

        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start(true) {
            if self.is_tls() {
                // trigger onOpen and start the handshake
                let _ = self.with_wrapper(|w| w.start());
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        self.flush();
    }

    /// Prepare an accepted connection: adopt the listener's TLS context (the
    /// listener keeps its own ref; the wrapper gets one to release on deinit),
    /// initialise our pipe and `uv_accept` it from `server`. Follow with
    /// [`start_accepted`](Self::start_accepted), which may run user JS.
    #[cfg(windows)]
    pub(crate) fn accept_from(
        &self,
        server: &mut uv::Pipe,
        ssl_ctx: Option<&boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        if let Some(tls) = ssl_ctx {
            self.update_flags(|f| f.set(Flags::IS_SSL, true));
            match WrapperType::init_with_ctx(tls.up_ref(), false, self.wrapper_handlers()) {
                Ok(w) => self.wrapper.set(Some(w)),
                Err(_) => {
                    self.discard_unadopted_pipe();
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    });
                }
            }
        }
        let uv_loop = self.vm.uv_loop();
        let init_result = self
            .pipe
            .with_mut(|p| p.as_deref_mut().map(|pipe| pipe.init(uv_loop, false)))
            .expect("pipe present until start()");
        if let Err(e) = init_result.to_result(bun_sys::Tag::pipe) {
            self.discard_unadopted_pipe();
            return Err(e);
        }
        // Until the writer adopts it (start_with_pipe), a thread teardown closes
        // this pipe through us; afterwards the writer re-records itself as owner.
        self.register_for_vm_teardown();

        let accepted = self
            .pipe
            .with_mut(|p| p.as_deref_mut().map(|pipe| server.accept(pipe)))
            .expect("pipe present until start()");
        if let Err(e) = accepted.to_result(bun_sys::Tag::accept) {
            self.discard_unadopted_pipe();
            return Err(e);
        }
        Ok(())
    }

    /// Second half of accepting (after [`accept_from`](Self::accept_from)):
    /// start reading and fire `onOpen` / the TLS handshake.
    #[cfg(windows)]
    pub(crate) fn start_accepted(&self) {
        let _keep_alive = self.keep_alive();
        self.update_flags(|f| f.set(Flags::DISCONNECTED, false));
        if self.start(false) {
            if self.is_tls() {
                // trigger onOpen and start the handshake
                let _ = self.with_wrapper(|w| w.start());
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
    }

    /// Record `self` as what a thread teardown closes the not-yet-adopted
    /// pipe through (replaced by the writer at adoption, dropped with the
    /// pipe by `discard_unadopted_pipe`).
    #[cfg(windows)]
    fn register_for_vm_teardown(&self) {
        self.pipe.with_mut(|p| {
            if let Some(pipe) = p.as_deref_mut() {
                uv::open_handles::set_owner_ref(
                    core::ptr::from_mut::<uv::Pipe>(pipe).cast(),
                    BackRef::new(self),
                );
            }
        });
    }

    #[cfg(windows)]
    pub(crate) fn open(
        &self,
        fd: Fd,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                self.discard_unadopted_pipe();
                return result;
            }
        }
        let uv_loop = self.vm.uv_loop();
        let init_result = self
            .pipe
            .with_mut(|p| p.as_deref_mut().map(|pipe| pipe.init(uv_loop, false)))
            .expect("pipe present until start()");
        if let Err(e) = init_result.to_result(bun_sys::Tag::pipe) {
            self.discard_unadopted_pipe();
            return Err(e);
        }
        // Until the writer adopts it (start_with_pipe), a thread teardown closes
        // this pipe through us; afterwards the writer re-records itself as owner.
        self.register_for_vm_teardown();

        let opened = self
            .pipe
            .with_mut(|p| p.as_deref_mut().map(|pipe| pipe.open(fd.uv())))
            .expect("pipe present until start()");
        if let Err(e) = opened.to_result(bun_sys::Tag::open) {
            self.discard_unadopted_pipe();
            return Err(e);
        }

        self.connect_ref
            .set(Some(bun_ptr::RefPtr::from_this(self.owner())));
        self.on_connect(uv::ReturnCode::ZERO);
        bun_sys::Result::Ok(())
    }

    #[cfg(windows)]
    pub(crate) fn connect(
        &self,
        path: &[u8],
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.get().is_some());
        self.update_flags(|f| f.set(Flags::DISCONNECTED, true));
        // ref because we are connecting
        let _ = self
            .pipe
            .with_mut(|p| p.as_deref_mut().map(|pipe| pipe.ref_()));

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                self.discard_unadopted_pipe();
                return result;
            }
        }
        let uv_loop = self.vm.uv_loop();
        let init_result = self
            .pipe
            .with_mut(|p| p.as_deref_mut().map(|pipe| pipe.init(uv_loop, false)))
            .expect("pipe present until start()");
        if let Err(e) = init_result.to_result(bun_sys::Tag::pipe) {
            self.discard_unadopted_pipe();
            return Err(e);
        }
        // Until the writer adopts it (start_with_pipe), a thread teardown closes
        // this pipe through us; afterwards the writer re-records itself as owner.
        self.register_for_vm_teardown();

        // libuv stashes `self.connect_req` and `self` (its owner) until the
        // connect callback fires; `connect_ref` below keeps the context — and
        // so `self` — alive that long.
        let connected = self
            .pipe
            .with_mut(|p| {
                p.as_deref_mut()
                    .map(|pipe| pipe.connect_with(path, BackRef::new(self)))
            })
            .expect("pipe present until start()");
        if let Some(err) = connected.to_error(bun_sys::Tag::connect2) {
            self.discard_unadopted_pipe();
            return Err(err);
        }
        self.connect_ref
            .set(Some(bun_ptr::RefPtr::from_this(self.owner())));
        Ok(())
    }

    #[cfg(not(windows))]
    pub(crate) fn open(
        &self,
        _fd: Fd,
        _ssl_options: Option<SSLConfig>,
        _owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        // Unreachable on POSIX — `WindowsNamedPipeContext` is aliased to `()` there;
        // this stub exists only so the module type-checks across platforms.
        unreachable!("WindowsNamedPipe::open is windows-only")
    }

    #[cfg(not(windows))]
    pub(crate) fn connect(
        &self,
        _path: &[u8],
        _ssl_options: Option<SSLConfig>,
        _owned_ctx: Option<boringssl::OwnedSslCtx>,
    ) -> bun_sys::Result<()> {
        // Unreachable on POSIX — see `open` above.
        unreachable!("WindowsNamedPipe::connect is windows-only")
    }

    /// Set up the in-process SSL wrapper for `connect`/`open`. Prefers a prebuilt
    /// `SSL_CTX` (moved into `wrapper`) so a memoised `tls.createSecureContext`
    /// reaches this path with its CA bundle intact; on this branch `[buntls]`
    /// returns `{secureContext}` and no longer spreads `{ca,cert,key}`, so the
    /// `SSLConfig` fallback alone would build a CTX with an empty trust store
    /// and fail `DEPTH_ZERO_SELF_SIGNED_CERT`.
    /// Returns null when neither input requested TLS.
    #[cfg(windows)]
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

    pub(crate) fn start(&self, is_client: bool) -> bool {
        self.update_flags(|f| f.set(Flags::IS_CLIENT, is_client));
        #[cfg(windows)]
        {
            let Some(mut pipe) = self.pipe.replace(None) else {
                return false;
            };
            pipe.unref();
            let owner = self.owner();
            // Ownership of the pipe transfers to `self.writer.source`.
            let start_pipe_result = self.writer.with_mut(|w| {
                w.set_parent(owner.as_ptr());
                w.start_with_pipe(pipe)
            });
            if let bun_sys::Result::Err(err) = start_pipe_result {
                self.on_error(err);
                return false;
            }
            let read_start_result = self.writer.with_mut(|w| match w.source.as_mut() {
                Some(Source::Pipe(pipe)) => Some(pipe.read_start_owned(BackRef::new(self))),
                _ => None,
            });
            let Some(read_start_result) = read_start_result else {
                self.on_error(bun_sys::Error::from_code(
                    bun_sys::E::PIPE,
                    bun_sys::Tag::read,
                ));
                return false;
            };
            if let bun_sys::Result::Err(err) = read_start_result.to_result(bun_sys::Tag::listen) {
                self.on_error(err);
                return false;
            }
            true
        }
        #[cfg(not(windows))]
        {
            let _ = is_client;
            false
        }
    }

    pub(crate) fn is_tls(&self) -> bool {
        self.flags.get().is_ssl()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__encode_and_write")]
    pub fn encode_and_write(&self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(WindowsNamedPipe, "encodeAndWrite (len: {})", data.len());
        if let Some(r) = self.with_wrapper(|w| w.write_data(data)) {
            return i32::try_from(r.unwrap_or(0)).expect("int cast");
        }
        self.internal_write(data);
        i32::try_from(data.len()).expect("int cast")
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__raw_write")]
    pub fn raw_write(&self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__close")]
    pub fn close(&self) {
        let _ = self.with_wrapper(|w| {
            let _ = w.shutdown(false);
        });
        self.with_writer(|w| w.end());
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown")]
    pub fn shutdown(&self) {
        let handled = self.with_wrapper(|w| {
            let _ = w.shutdown(false);
        });
        if handled.is_none() {
            // Plain (non-TLS) named pipe: half-close the write side so the peer
            // observes EOF. Without this, Socket.prototype.end() over a Windows
            // named pipe (endNT → shutdown()) never signals the peer, and an
            // allowHalfOpen peer waiting on 'end' hangs. `writer.end()` is
            // idempotent and mirrors `close`'s unconditional writer teardown.
            self.with_writer(|w| w.end());
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown_read")]
    pub fn shutdown_read(&self) {
        if let Some(wrapper) = self.wrapper_ref() {
            wrapper.shutdown_read();
        } else {
            // `uv_read_stop` always succeeds and is a no-op if not reading.
            #[cfg(windows)]
            self.writer.with_mut(|w| {
                if let Some(Source::Pipe(pipe)) = w.source.as_mut() {
                    pipe.read_stop();
                }
            });
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_shutdown", no_catch)]
    pub fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_shutdown();
        }

        self.flags.get().disconnected() || self.writer.get().is_done
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_closed", no_catch)]
    pub fn is_closed(&self) -> bool {
        if let Some(wrapper) = self.wrapper_ref() {
            return wrapper.is_closed();
        }
        self.flags.get().disconnected()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_established", no_catch)]
    pub fn is_established(&self) -> bool {
        !self.is_closed()
    }

    pub(crate) fn ssl(&self) -> Option<*mut boringssl::SSL> {
        self.wrapper_ref()
            .and_then(|w| w.ssl.get())
            .map(|p| p.as_ptr())
    }

    /// The `bun_uws` cycle-break extern: the C ABI flattens
    /// [`ssl`](Self::ssl) to a nullable pointer.
    #[bun_uws::uws_callback(export = "WindowsNamedPipe__ssl", no_catch)]
    pub fn ssl_ptr(&self) -> *mut boringssl::SSL {
        self.ssl().unwrap_or(core::ptr::null_mut())
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__ssl_error", no_catch)]
    pub fn ssl_error(&self) -> us_bun_verify_error_t {
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

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__set_timeout")]
    pub fn set_timeout(&self, seconds: c_uint) {
        bun_output::scoped_log!(WindowsNamedPipe, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    /// Free internal resources, it can be called multiple times.
    // Private idempotent helper invoked from on_close and Drop.
    // Owned fields (writer, wrapper, ssl_error) free themselves via their own Drop impls; only
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
        // embedding context's refcount hits 0 and `WindowsStreamingWriter::Drop`
        // finally runs). Inline `close_without_reporting()` (private on the
        // writer) so the source pipe is `uv_close`d NOW; the `get_fd() != INVALID`
        // guard makes this a no-op on the writer-initiated path where the source
        // was already taken, and `closed_without_reporting = true` keeps
        // `on_close_source()` from re-entering `Parent::on_close` (we're already
        // inside it). `current_payload` may still back an in-flight `uv_write`
        // (cancelled async by `uv_close`) so it is left to the writer's own Drop.
        #[cfg(windows)]
        {
            self.writer.with_mut(|w| {
                // `uv_read_stop` always succeeds and is a no-op if not reading.
                if let Some(Source::Pipe(pipe)) = w.source.as_mut() {
                    pipe.read_stop();
                }
            });
            self.writer.with_mut(|w| w.close_without_reporting());
            self.writer.with_mut(|w| w.outgoing = Default::default());
        }
        if !self.flags.get().contains(Flags::WRAPPER_BUSY) {
            self.wrapper.set(None);
        }
        self.ssl_error.set(CertError::default());
    }
}

impl Drop for WindowsNamedPipe {
    fn drop(&mut self) {
        self.release_resources();
        // Release the `uv::Pipe` if it was never adopted by
        // `self.writer.source` (early-error returns from
        // `connect`/`open`/`accept_from` before `start()` runs). Once adopted
        // the writer is the sole owner and frees via its libuv close callback.
        // `close_and_free` handles both un-adopted states: if `pipe.init()`
        // never ran it just frees the allocation; if init() DID run before the
        // later open/accept/connect failure it `uv_close`s first so the handle
        // is unlinked from libuv's `handle_queue` before the heap block is
        // freed.
        #[cfg(windows)]
        if let Some(pipe) = self.pipe.replace(None) {
            pipe.close_and_free();
        }
    }
}

/// `uv::open_handles` closes a not-yet-adopted pipe through here at teardown.
#[cfg(windows)]
impl uv::open_handles::HandleOwner for WindowsNamedPipe {
    fn close_for_vm_teardown(&self) {
        if self.pipe.get().is_none() {
            self.close();
        } else {
            self.discard_unadopted_pipe();
        }
    }
}

#[cfg(windows)]
impl uv::ConnectHandler for WindowsNamedPipe {
    fn connect_req(&self) -> &JsCell<uv::uv_connect_t> {
        &self.connect_req
    }
    fn on_connect(&self, status: uv::ReturnCode) {
        WindowsNamedPipe::on_connect(self, status)
    }
}

/// libuv reads straight into `incoming`; see `handle_read`.
#[cfg(windows)]
impl uv::StreamOwner for WindowsNamedPipe {
    #[inline]
    fn read_buffer(&self) -> &JsCell<Vec<u8>> {
        &self.incoming
    }
    #[inline]
    fn on_read(&self, nread: usize) {
        self.handle_read(nread);
    }
    #[inline]
    fn on_read_error(&self, err: core::ffi::c_int) {
        // The trampoline only reaches this arm when `nreads < 0`, and for any
        // negative code `translate_uv_error_to_e` already
        // yields a concrete `E` (falling back to `UNKNOWN` for unmapped
        // codes). Pass it straight through; do NOT remap UNKNOWN→CANCELED.
        self.handle_read_error(bun_sys::windows::translate_uv_error_to_e(err));
    }
}
