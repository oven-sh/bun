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

use core::ffi::{c_uint, c_void};
#[cfg(windows)]
use core::ptr::NonNull;

use bun_boringssl_sys as boringssl;
#[cfg(windows)]
use bun_collections::ByteVecExt;
use bun_core::timespec;
use bun_io::Loop as AsyncLoop;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{StreamingWriter, WriteStatus};
use bun_jsc::virtual_machine::VirtualMachine;
#[cfg(windows)]
use bun_libuv_sys::{UvHandle as _, UvStream as _};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd};
use bun_uws::us_bun_verify_error_t;

use crate::socket::SSLConfig;
use crate::socket::ssl_wrapper::{self, SSLWrapper};
#[cfg(windows)]
use crate::timer::EventLoopTimerTag;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState};

bun_output::declare_scope!(WindowsNamedPipe, visible);

// Zig `pub const CertError = UpgradedDuplex.CertError;`
pub type CertError = crate::socket::upgraded_duplex::CertError;

type WrapperType = SSLWrapper<*mut WindowsNamedPipe>;

use crate::jsc_hooks::timer_all_mut as timer_all;

pub struct WindowsNamedPipe {
    pub wrapper: Option<WrapperType>,
    #[cfg(windows)]
    pub pipe: Option<NonNull<uv::Pipe>>, // any duplex
    #[cfg(not(windows))]
    pub pipe: (),
    // TODO(port): lifetime — JSC_BORROW; VM outlives this struct. Using &'static for now;
    // create a timeout version that doesn't need the jsc VM
    pub vm: &'static VirtualMachine,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub event_loop_handle: bun_jsc::EventLoopHandle,

    // TODO(port): `bun.io.StreamingWriter(WindowsNamedPipe, .{ onClose, onWritable, onError, onWrite })`
    // is a comptime type-generator binding callbacks at type level. Encode callbacks as a
    // trait impl (`impl StreamingWriterHandler for WindowsNamedPipe`) or const-generic vtable.
    pub writer: StreamingWriter<WindowsNamedPipe>,

    pub incoming: Vec<u8>, // Maybe we should use IPCBuffer here as well
    pub ssl_error: CertError,
    pub handlers: Handlers,
    #[cfg(windows)]
    pub connect_req: uv::uv_connect_t,
    #[cfg(not(windows))]
    pub connect_req: (),

    pub event_loop_timer: EventLoopTimer,
    pub current_timeout: u32,
    pub flags: Flags,
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
        const PIPE_ADOPTED = 1 << 4;
        const WRAPPER_BUSY = 1 << 5;
        // _: u2 padding
    }
}

impl Flags {
    #[inline]
    pub fn disconnected(self) -> bool {
        self.contains(Self::DISCONNECTED)
    }
    #[inline]
    pub fn set_disconnected(&mut self, v: bool) {
        self.set(Self::DISCONNECTED, v)
    }
    #[inline]
    pub fn is_closed(self) -> bool {
        self.contains(Self::IS_CLOSED)
    }
    #[inline]
    pub fn set_is_closed(&mut self, v: bool) {
        self.set(Self::IS_CLOSED, v)
    }
    #[inline]
    pub fn is_client(self) -> bool {
        self.contains(Self::IS_CLIENT)
    }
    #[inline]
    pub fn set_is_client(&mut self, v: bool) {
        self.set(Self::IS_CLIENT, v)
    }
    #[inline]
    pub fn is_ssl(self) -> bool {
        self.contains(Self::IS_SSL)
    }
    #[inline]
    pub fn set_is_ssl(&mut self, v: bool) {
        self.set(Self::IS_SSL, v)
    }
}

pub struct Handlers {
    pub ctx: *mut c_void,
    pub ref_ctx: fn(*mut c_void),
    pub deref_ctx: fn(*mut c_void),
    pub on_open: fn(*mut c_void),
    pub on_handshake: fn(*mut c_void, bool, us_bun_verify_error_t),
    pub on_data: fn(*mut c_void, &[u8]),
    pub on_close: fn(*mut c_void),
    pub on_end: fn(*mut c_void),
    pub on_writable: fn(*mut c_void),
    pub on_error: fn(*mut c_void, bun_sys::Error),
    pub on_timeout: fn(*mut c_void),
}

impl WindowsNamedPipe {
    #[inline]
    fn wrapper_ptr(&mut self) -> Option<*mut WrapperType> {
        self.wrapper.as_mut().map(core::ptr::from_mut)
    }

    #[cfg(windows)]
    #[inline]
    fn pipe_mut(&mut self) -> Option<&mut uv::Pipe> {
        // SAFETY: see doc comment — non-owning libuv-handle alias, single JS
        // thread, no overlapping `&mut uv::Pipe` from the writer for the
        // returned borrow's duration.
        self.pipe.map(|p| unsafe { &mut *p.as_ptr() })
    }

    #[cfg(windows)]
    fn discard_unadopted_pipe(&mut self) {
        debug_assert!(
            self.writer.source.is_none(),
            "pipe already adopted by writer.source; discard would double-free"
        );
        if let Some(pipe) = self.pipe.take() {
            // SAFETY: `pipe` is the `NonNull` recorded from `Box::leak` in
            // `from()` and not yet re-materialised (asserted above);
            // `close_and_destroy` reclaims via `Box::from_raw` either
            // immediately (never-init'd, `loop_ == null`) or in the `uv_close`
            // callback (init'd). Ownership transfers here exactly once.
            unsafe { uv::Pipe::close_and_destroy(pipe.as_ptr()) };
        }
    }

    fn on_writable(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWritable");
        // flush pending data
        self.flush();
        // call onWritable (will flush on demand)
        (self.handlers.on_writable)(self.handlers.ctx);
    }

    #[cfg(windows)]
    fn on_read_alloc(&mut self, suggested_size: usize) -> &mut [u8] {
        // SAFETY: libuv writes into this region before on_read commits.
        let spare = unsafe { self.incoming.uv_alloc_spare_u8(suggested_size) };
        &mut spare[..suggested_size]
    }

    #[cfg(windows)]
    fn on_read(&mut self, nread: usize) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", nread);
        // SAFETY: `nread` bytes written by libuv into on_read_alloc's slice.
        unsafe { self.incoming.uv_commit(nread) };

        self.reset_timeout();

        let mut data = core::mem::take(&mut self.incoming);

        if let Some(w) = self.wrapper_ptr() {
            let was_busy = self.flags.contains(Flags::WRAPPER_BUSY);
            self.flags.insert(Flags::WRAPPER_BUSY);
            // SAFETY: `w` points into `self.wrapper`'s `Some` payload. The
            // re-entrant `&mut *this` formed by the SSL trampolines touches
            // only timer/writer/flags/handlers (`internal_write`, `on_data`,
            // `on_handshake`, `on_close`); `WRAPPER_BUSY` ensures the one
            // path that WOULD mutate `self.wrapper` (`release_resources`)
            // skips its `= None`, so the payload bytes stay valid and
            // un-overwritten for the duration of this call.
            unsafe { (*w).receive_data(data.as_slice()) };
            if !was_busy {
                self.flags.remove(Flags::WRAPPER_BUSY);
                if self.flags.is_closed() {
                    self.wrapper = None;
                }
            }
        } else {
            (self.handlers.on_data)(self.handlers.ctx, data.as_slice());
        }
        // Zig: `this.incoming.len = 0` — restore the (cleared) allocation so
        // the next `on_read_alloc` reuses it instead of growing from empty.
        data.clear();
        self.incoming = data;
    }

    fn on_write(&mut self, amount: usize, status: WriteStatus) {
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
                if let Some(source) = self.writer.source.as_mut() {
                    // Zig: `source.pipe.unref()` — Rust `Source` is an enum;
                    // `unref()` matches the active variant (always `Pipe` here
                    // via `start_with_pipe`).
                    source.unref();
                }
            }
            WriteStatus::EndOfFile => {
                // we send FIN so we close after this
                self.writer.close();
            }
        }
    }

    #[cfg(windows)]
    fn on_read_error(&mut self, err: bun_sys::E) {
        bun_output::scoped_log!(WindowsNamedPipe, "onReadError");
        // `E::EOF` only exists in the Windows errno table (libuv UV_EOF mapping);
        // this type is Windows-only at runtime so the comparison is gated.
        #[cfg(windows)]
        if err == bun_sys::E::EOF {
            // we received FIN but we dont allow half-closed connections right now
            (self.handlers.on_end)(self.handlers.ctx);
            self.writer.close();
            return;
        }
        self.on_error(bun_sys::Error::from_code(err, bun_sys::Tag::read));
        self.writer.close();
    }

    fn on_error(&mut self, err: bun_sys::Error) {
        bun_output::scoped_log!(WindowsNamedPipe, "onError");
        (self.handlers.on_error)(self.handlers.ctx, err);
        self.close();
    }

    fn on_open(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onOpen");
        (self.handlers.on_open)(self.handlers.ctx);
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onData ({})", decoded_data.len());
        (self.handlers.on_data)(self.handlers.ctx, decoded_data);
    }

    // ── SSLWrapper trampolines ───────────────────────────────────────────────
    // `ssl_wrapper::Handlers<*mut Self>` carries `fn(*mut Self, ..)` slots; the
    // method receivers above are `&mut self`, so adapt at the FFI boundary.
    // SAFETY (all): `this` is the `ctx` we set to `self as *mut _` when building
    // the wrapper; SSLWrapper never holds a competing `&mut WindowsNamedPipe`.
    fn ssl_on_open(this: *mut Self) {
        // SAFETY: `this` is the `ctx` we set to `self as *mut _` when building
        // the wrapper; SSLWrapper holds no competing `&mut WindowsNamedPipe`.
        unsafe { (*this).on_open() }
    }
    fn ssl_on_handshake(this: *mut Self, ok: bool, e: us_bun_verify_error_t) {
        // SAFETY: see `ssl_on_open`.
        unsafe { (*this).on_handshake(ok, e) }
    }
    fn ssl_on_data(this: *mut Self, d: &[u8]) {
        // SAFETY: see `ssl_on_open`.
        unsafe { (*this).on_data(d) }
    }
    fn ssl_on_close(this: *mut Self) {
        // SAFETY: see `ssl_on_open`.
        unsafe { (*this).on_close() }
    }
    fn ssl_write(this: *mut Self, d: &[u8]) {
        // SAFETY: see `ssl_on_open`.
        unsafe { (*this).internal_write(d) }
    }

    fn on_handshake(&mut self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(WindowsNamedPipe, "onHandshake");

        self.ssl_error = CertError {
            error_no: ssl_error.error_no,
            code: ssl_error
                .code()
                .filter(|_| ssl_error.error_no != 0)
                .map(Into::into),
            reason: ssl_error
                .reason()
                .filter(|_| ssl_error.error_no != 0)
                .map(Into::into),
        };
        (self.handlers.on_handshake)(self.handlers.ctx, handshake_success, ssl_error);
    }

    fn on_close(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onClose");
        #[cfg(windows)]
        {
            self.pipe = None;
        }
        if !self.flags.is_closed() {
            self.flags.set_is_closed(true); // only call onClose once
            #[cfg(windows)]
            {
                self.pipe = None;
            }
            (self.handlers.on_close)(self.handlers.ctx);
            self.release_resources();
        }
    }

    fn call_write_or_end(&mut self, data: Option<&[u8]>, msg_more: bool) {
        if let Some(bytes) = data {
            if !bytes.is_empty() {
                // ref because we have pending data
                #[cfg(windows)]
                if let Some(source) = self.writer.source.as_mut() {
                    // Zig: `source.pipe.ref()` — see `on_write` for the
                    // enum-vs-union note.
                    source.ref_();
                }
                if self.flags.disconnected() {
                    // enqueue to be sent after connecting
                    bun_core::handle_oom(self.writer.outgoing.write(bytes));
                } else {
                    // write will enqueue the data if it cannot be sent
                    let _ = self.writer.write(bytes);
                }
            }
        }

        if !msg_more {
            if let Some(w) = self.wrapper_ptr() {
                let was_busy = self.flags.contains(Flags::WRAPPER_BUSY);
                self.flags.insert(Flags::WRAPPER_BUSY);
                // SAFETY: see `on_read` — WRAPPER_BUSY keeps the `Some` payload
                // bytes at `*w` valid for the call's duration.
                unsafe {
                    let _ = (*w).shutdown(false);
                }
                if !was_busy {
                    self.flags.remove(Flags::WRAPPER_BUSY);
                    if self.flags.is_closed() {
                        self.wrapper = None;
                    }
                }
            }
            self.writer.end();
        }
    }

    fn internal_write(&mut self, encoded_data: &[u8]) {
        self.reset_timeout();

        self.call_write_or_end(Some(encoded_data), true);
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__resume_stream")]
    pub fn resume_stream(&mut self) -> bool {
        #[cfg(windows)]
        {
            let Some(stream) = self.writer.get_stream() else {
                return false;
            };
            // SAFETY: `stream` is the live `*mut uv_stream_t` for our pipe
            // (returned by `writer.get_stream()`); the `StreamReader` impl
            // below routes the trampolines back to `self`.
            let read_start_result =
                unsafe { (*stream).read_start_ctx::<Self>(self) }.to_result(bun_sys::Tag::listen);
            if read_start_result.is_err() {
                return false;
            }
            true
        }
        #[cfg(not(windows))]
        {
            false
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__pause_stream")]
    pub fn pause_stream(&mut self) -> bool {
        #[cfg(windows)]
        {
            let Some(pipe) = self.pipe_mut() else {
                return false;
            };
            pipe.read_stop();
            true
        }
        #[cfg(not(windows))]
        {
            false
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__flush")]
    pub fn flush(&mut self) {
        if let Some(w) = self.wrapper_ptr() {
            let was_busy = self.flags.contains(Flags::WRAPPER_BUSY);
            self.flags.insert(Flags::WRAPPER_BUSY);
            // SAFETY: see `on_read` — WRAPPER_BUSY keeps the `Some` payload
            // bytes at `*w` valid for the call's duration.
            unsafe {
                let _ = (*w).flush();
            }
            if !was_busy {
                self.flags.remove(Flags::WRAPPER_BUSY);
                if self.flags.is_closed() {
                    self.wrapper = None;
                }
            }
        }
        if !self.flags.disconnected() {
            let _ = self.writer.flush();
        }
    }

    pub fn on_timeout(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onTimeout");

        let has_been_cleared = self.event_loop_timer.state == EventLoopTimerState::CANCELLED
            || self.vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        self.event_loop_timer.heap = Default::default();

        if has_been_cleared {
            return;
        }

        (self.handlers.on_timeout)(self.handlers.ctx);
    }

    #[cfg(windows)]
    pub fn from(
        pipe: Box<uv::Pipe>,
        handlers: Handlers,
        vm: &'static VirtualMachine,
    ) -> WindowsNamedPipe {
        // Zig: `if (Environment.isPosix) @compileError(...)` — the whole fn is
        // now `#[cfg(windows)]`-gated so POSIX builds never see `uv::Pipe`.
        WindowsNamedPipe {
            vm,
            event_loop_handle: bun_jsc::EventLoopHandle::init(vm.event_loop().cast::<()>()),
            pipe: Some(NonNull::from(Box::leak(pipe))),
            wrapper: None,
            handlers,
            // defaults:
            writer: StreamingWriter::default(),
            incoming: Vec::new(),
            ssl_error: CertError::default(),
            connect_req: bun_core::ffi::zeroed::<uv::uv_connect_t>(),
            // Zig: `.{ .next = .epoch, .tag = .WindowsNamedPipe }` with field
            // defaults `state = .PENDING`, `heap = .{}`, `in_heap = .none` —
            // exactly what `init_paused` produces.
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::WindowsNamedPipe),
            current_timeout: 0,
            flags: Flags::DISCONNECTED, // disconnected: bool = true is the only non-false default
        }
    }

    pub fn r#ref(&mut self) {
        (self.handlers.ref_ctx)(self.handlers.ctx);
    }

    pub fn deref(&mut self) {
        (self.handlers.deref_ctx)(self.handlers.ctx);
    }

    #[cfg(windows)]
    extern "C" fn uv_on_connect(req: *mut uv::uv_connect_t, status: uv::ReturnCode) {
        // SAFETY: `req` is the `&mut self.connect_req` we passed to
        // `Pipe::connect`; `req->data` was set to `self as *mut Self` and the
        // owning struct is kept alive by the `r#ref()` taken before the call.
        let this = unsafe { (*req).data.cast::<Self>() };
        unsafe { (*this).on_connect(status) };
    }

    #[cfg(windows)]
    fn on_connect(&mut self, status: uv::ReturnCode) {
        // PORT NOTE: reshaped — Zig `defer this.deref()` cannot be a scopeguard here (would need
        // to capture &mut self alongside body uses). Call deref() explicitly at each return.

        #[cfg(windows)]
        if let Some(pipe) = self.pipe_mut() {
            pipe.unref();
        }

        if let Some(err) = status.to_error(bun_sys::Tag::connect) {
            self.discard_unadopted_pipe();
            self.on_error(err);
            self.deref();
            return;
        }

        self.flags.set_disconnected(false);
        if self.start(true) {
            if self.is_tls() {
                if let Some(w) = self.wrapper_ptr() {
                    let was_busy = self.flags.contains(Flags::WRAPPER_BUSY);
                    self.flags.insert(Flags::WRAPPER_BUSY);
                    // SAFETY: see `on_read` — WRAPPER_BUSY keeps the `Some`
                    // payload bytes at `*w` valid for the call's duration.
                    unsafe { (*w).start() };
                    if !was_busy {
                        self.flags.remove(Flags::WRAPPER_BUSY);
                        if self.flags.is_closed() {
                            self.wrapper = None;
                        }
                    }
                }
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        self.flush();
        self.deref();
    }

    #[cfg(windows)]
    pub fn get_accepted_by(
        &mut self,
        server: &mut uv::Pipe,
        ssl_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        #[cfg(windows)]
        debug_assert!(self.pipe.is_some());
        self.flags.set_disconnected(true);

        if let Some(tls) = ssl_ctx {
            self.flags.set_is_ssl(true);
            let tls_nn = NonNull::new(tls).expect("caller passes Some only for a live SSL_CTX*");
            self.wrapper = match WrapperType::init_with_ctx(
                tls_nn,
                false,
                ssl_wrapper::Handlers {
                    ctx: self as *mut _,
                    on_open: Self::ssl_on_open,
                    on_handshake: Self::ssl_on_handshake,
                    on_data: Self::ssl_on_data,
                    on_close: Self::ssl_on_close,
                    write: Self::ssl_write,
                },
            ) {
                Ok(w) => Some(w),
                Err(_) => {
                    self.discard_unadopted_pipe();
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    });
                }
            };
            // ref because we are accepting will unref when wrapper deinit.
            // SAFETY: `tls_nn` proven non-null above
            // (`NonNull::new(tls).expect(..)`); `SSL_CTX_up_ref` only bumps the
            // atomic refcount on a live `SSL_CTX*`.
            let _ = unsafe { boringssl::SSL_CTX_up_ref(tls_nn.as_ptr()) };
        }
        #[cfg(windows)]
        {
            let uv_loop = self.vm.uv_loop();
            if let Err(e) = self
                .pipe_mut()
                .unwrap()
                .init(uv_loop, false)
                .to_result(bun_sys::Tag::pipe)
            {
                self.discard_unadopted_pipe();
                return Err(e);
            }

            if let Err(e) = server
                .accept(self.pipe_mut().unwrap())
                .to_result(bun_sys::Tag::accept)
            {
                self.discard_unadopted_pipe();
                return Err(e);
            }
        }

        self.flags.set_disconnected(false);
        if self.start(false) {
            if self.is_tls() {
                if let Some(w) = self.wrapper_ptr() {
                    let was_busy = self.flags.contains(Flags::WRAPPER_BUSY);
                    self.flags.insert(Flags::WRAPPER_BUSY);
                    // SAFETY: see `on_read` — WRAPPER_BUSY keeps the `Some`
                    // payload bytes at `*w` valid for the call's duration.
                    unsafe { (*w).start() };
                    if !was_busy {
                        self.flags.remove(Flags::WRAPPER_BUSY);
                        if self.flags.is_closed() {
                            self.wrapper = None;
                        }
                    }
                }
            } else {
                // trigger onOpen
                self.on_open();
            }
        }
        bun_sys::Result::Ok(())
    }

    #[cfg(windows)]
    pub fn open(
        &mut self,
        fd: Fd,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.is_some());
        self.flags.set_disconnected(true);

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                self.discard_unadopted_pipe();
                return result;
            }
        }
        let uv_loop = self.vm.uv_loop();
        if let Err(e) = self
            .pipe_mut()
            .unwrap()
            .init(uv_loop, false)
            .to_result(bun_sys::Tag::pipe)
        {
            self.discard_unadopted_pipe();
            return Err(e);
        }

        if let Err(e) = self
            .pipe_mut()
            .unwrap()
            .open(fd.uv())
            .to_result(bun_sys::Tag::open)
        {
            self.discard_unadopted_pipe();
            return Err(e);
        }

        self.r#ref();
        Self::on_connect(self, uv::ReturnCode::ZERO);
        bun_sys::Result::Ok(())
    }

    #[cfg(windows)]
    pub fn connect(
        &mut self,
        path: &[u8],
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.is_some());
        self.flags.set_disconnected(true);
        // ref because we are connecting
        self.pipe_mut().unwrap().ref_();

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                self.discard_unadopted_pipe();
                return result;
            }
        }
        let uv_loop = self.vm.uv_loop();
        if let Err(e) = self
            .pipe_mut()
            .unwrap()
            .init(uv_loop, false)
            .to_result(bun_sys::Tag::pipe)
        {
            self.discard_unadopted_pipe();
            return Err(e);
        }

        let ctx: *mut Self = core::ptr::addr_of_mut!(*self);
        // SAFETY: `ctx` is `self`; field projections are in-bounds and disjoint.
        let req: *mut uv::uv_connect_t = unsafe { core::ptr::addr_of_mut!((*ctx).connect_req) };
        unsafe { (*req).data = ctx.cast::<c_void>() };
        // `pipe` lives in a separate heap allocation (the `uv::Pipe` aliased by
        // `self.pipe: NonNull`), so its bytes are outside `*self` and unaffected
        // by the `req` projection.
        let pipe: *mut uv::Pipe = unsafe { (*ctx).pipe }.unwrap().as_ptr();
        // SAFETY: `req`/`pipe` are live disjoint fields of `*self`; libuv stashes
        // `req`/`ctx` until the connect callback fires (this struct outlives that).
        if let Some(err) = unsafe { &mut *pipe }
            .connect(
                unsafe { &mut *req },
                path,
                ctx.cast::<c_void>(),
                Self::uv_on_connect,
            )
            .to_error(bun_sys::Tag::connect2)
        {
            self.discard_unadopted_pipe();
            return Err(err);
        }
        self.r#ref();
        Ok(())
    }

    #[cfg(not(windows))]
    pub fn open(
        &mut self,
        _fd: Fd,
        _ssl_options: Option<SSLConfig>,
        _owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        // Unreachable on POSIX — `WindowsNamedPipeContext` is aliased to `()` there;
        // this stub exists only so the module type-checks across platforms.
        unreachable!("WindowsNamedPipe::open is windows-only")
    }

    #[cfg(not(windows))]
    pub fn connect(
        &mut self,
        _path: &[u8],
        _ssl_options: Option<SSLConfig>,
        _owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        // Unreachable on POSIX — see `open` above.
        unreachable!("WindowsNamedPipe::connect is windows-only")
    }

    #[cfg(windows)]
    fn init_tls_wrapper(
        &mut self,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> Option<bun_sys::Result<()>> {
        let handlers = ssl_wrapper::Handlers {
            ctx: std::ptr::from_mut(self),
            on_open: Self::ssl_on_open,
            on_handshake: Self::ssl_on_handshake,
            on_data: Self::ssl_on_data,
            on_close: Self::ssl_on_close,
            write: Self::ssl_write,
        };
        if let Some(ctx) = owned_ctx {
            self.flags.set_is_ssl(true);
            let ctx_nn = NonNull::new(ctx).expect("caller passes Some only for a live SSL_CTX*");
            self.wrapper = match WrapperType::init_with_ctx(ctx_nn, true, handlers) {
                Ok(w) => Some(w),
                Err(_) => {
                    // SAFETY: ctx is a valid SSL_CTX* with one adopted ref
                    unsafe { boringssl::SSL_CTX_free(ctx) };
                    return Some(bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    }));
                }
            };
            return Some(bun_sys::Result::Ok(()));
        }
        if let Some(tls) = ssl_options {
            self.flags.set_is_ssl(true);
            self.wrapper = match ssl_wrapper::init(&tls, true, handlers) {
                Ok(w) => Some(w),
                Err(_) => {
                    return Some(bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    }));
                }
            };
            return Some(bun_sys::Result::Ok(()));
        }
        None
    }

    pub fn start_tls(
        &mut self,
        ssl_options: &SSLConfig,
        is_client: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.flags.set_is_ssl(true);
        if self.start(is_client) {
            self.wrapper = Some(ssl_wrapper::init(
                ssl_options,
                is_client,
                ssl_wrapper::Handlers {
                    ctx: std::ptr::from_mut(self),
                    on_open: Self::ssl_on_open,
                    on_handshake: Self::ssl_on_handshake,
                    on_data: Self::ssl_on_data,
                    on_close: Self::ssl_on_close,
                    write: Self::ssl_write,
                },
            )?);

            // Re-entrancy guard: `SSLWrapper::start → handle_traffic` can fire
            // `trigger_close_callback` synchronously; see `on_read` for the
            // WRAPPER_BUSY pattern. (`wrapper` was just assigned `Some` above.)
            let w: *mut WrapperType = self.wrapper_ptr().unwrap();
            // Re-entrancy: see `on_read` — only the OUTERMOST scope may clear
            // the flag / run the deferred-drop epilogue.
            let was_busy = self.flags.contains(Flags::WRAPPER_BUSY);
            self.flags.insert(Flags::WRAPPER_BUSY);
            // SAFETY: see `on_read` — WRAPPER_BUSY keeps the `Some` payload
            // bytes at `*w` valid for the call's duration.
            unsafe { (*w).start() };
            if !was_busy {
                self.flags.remove(Flags::WRAPPER_BUSY);
                if self.flags.is_closed() {
                    self.wrapper = None;
                }
            }
        }
        Ok(())
    }

    pub fn start(&mut self, is_client: bool) -> bool {
        self.flags.set_is_client(is_client);
        #[cfg(windows)]
        {
            let Some(pipe_nn) = self.pipe else {
                return false;
            };
            self.pipe_mut().unwrap().unref();
            // raw self-ptr first to dodge the &mut self.writer / &mut *self overlap
            // (Zig: `this.writer.setParent(this)` — `this` is already `*WindowsNamedPipe`).
            let this: *mut Self = core::ptr::from_mut(self);
            self.writer.set_parent(this);
            // SAFETY: `start_with_pipe`'s contract is "Box-allocated pointer;
            // ownership transfers to `self.source`". `pipe_nn` is the `NonNull`
            // recorded from the `Box<uv::Pipe>` leaked in `from()` and not yet
            // adopted (asserted by `start_with_pipe`'s
            // `debug_assert!(source.is_none())`). After this call
            // `self.writer.source` holds the SOLE `Box` for the allocation;
            // `self.pipe` remains a non-owning alias for `pause_stream`. NOTE:
            // nothing clears that alias when the writer frees the Box — so
            // `on_close` nulls it defensively and `Drop` only reclaims when
            // `PIPE_ADOPTED` was never set.
            self.flags.insert(Flags::PIPE_ADOPTED);
            let start_pipe_result = unsafe { self.writer.start_with_pipe(pipe_nn.as_ptr()) };
            if let bun_sys::Result::Err(err) = start_pipe_result {
                self.on_error(err);
                return false;
            }
            let Some(stream) = self.writer.get_stream() else {
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
                unsafe { (*stream).read_start_ctx::<Self>(self) }.to_result(bun_sys::Tag::listen);
            if let bun_sys::Result::Err(err) = read_start_result {
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

    pub fn is_tls(&self) -> bool {
        self.flags.is_ssl()
    }

    /// SAFETY: `vm.uv_loop()` hands back the process-wide libuv loop; two calls
    /// alias the same `&mut AsyncLoop`. Caller must not hold another live
    /// `&mut` to it.
    #[allow(clippy::mut_from_ref)]
    pub unsafe fn loop_(&self) -> &mut AsyncLoop {
        // SAFETY: see fn-level safety comment — process-wide libuv loop, caller
        // promises no aliasing `&mut`.
        unsafe { &mut *self.vm.uv_loop() }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__encode_and_write")]
    pub fn encode_and_write(&mut self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(WindowsNamedPipe, "encodeAndWrite (len: {})", data.len());
        if let Some(w) = self.wrapper_ptr() {
            let was_busy = self.flags.contains(Flags::WRAPPER_BUSY);
            self.flags.insert(Flags::WRAPPER_BUSY);
            // SAFETY: see `on_read` — WRAPPER_BUSY keeps the `Some` payload
            // bytes at `*w` valid for the call's duration.
            let r = unsafe { (*w).write_data(data) };
            if !was_busy {
                self.flags.remove(Flags::WRAPPER_BUSY);
                if self.flags.is_closed() {
                    self.wrapper = None;
                }
            }
            return i32::try_from(r.unwrap_or(0)).expect("int cast");
        } else {
            self.internal_write(data);
        }
        i32::try_from(data.len()).expect("int cast")
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__raw_write")]
    pub fn raw_write(&mut self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__close")]
    pub fn close(&mut self) {
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` aliases the live `&mut self`; single JS thread, no
        // concurrent mutator. All reads/writes go through `this` so no
        // `&mut self`-derived borrow is held across the re-entrant call.
        if unsafe { (*this).wrapper.is_some() } {
            let w: *mut WrapperType =
                // SAFETY: `is_some()` checked just above; single JS thread.
                unsafe { (*this).wrapper.as_mut().unwrap_unchecked() };
            // Re-entrancy: see `on_read` — only the OUTERMOST scope may clear
            // the flag / run the deferred-drop epilogue.
            // SAFETY: `this` aliases the live `&mut self`; single JS thread.
            let was_busy = unsafe { (*this).flags.contains(Flags::WRAPPER_BUSY) };
            // SAFETY: as above.
            unsafe { (*this).flags.insert(Flags::WRAPPER_BUSY) };
            // SAFETY: see `on_read` — WRAPPER_BUSY keeps the `Some` payload
            // bytes at `*w` valid for the call's duration.
            unsafe {
                let _ = (*w).shutdown(false);
            }
            if !was_busy {
                // SAFETY: `this` is still the live payload (re-entry only
                // toggles flags / defers wrapper drop while WRAPPER_BUSY).
                unsafe { (*this).flags.remove(Flags::WRAPPER_BUSY) };
                // SAFETY: `this` is still live; read-only flag check.
                if unsafe { (*this).flags.is_closed() } {
                    // SAFETY: `this` still live; WRAPPER_BUSY cleared so dropping
                    // the wrapper no longer races its own `&mut self`.
                    unsafe { (*this).wrapper = None };
                }
            }
        }
        // SAFETY: `this` is still live; `writer.end()` is idempotent.
        unsafe { (*this).writer.end() };
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown")]
    pub fn shutdown(&mut self) {
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` aliases the live `&mut self`; single JS thread.
        if unsafe { (*this).wrapper.is_some() } {
            // Re-entrancy guard: see `close` above.
            let w: *mut WrapperType =
                // SAFETY: `is_some()` checked just above; single JS thread.
                unsafe { (*this).wrapper.as_mut().unwrap_unchecked() };
            // Re-entrancy: see `on_read` — only the OUTERMOST scope may clear
            // the flag / run the deferred-drop epilogue.
            // SAFETY: `this` aliases the live `&mut self`; single JS thread.
            let was_busy = unsafe { (*this).flags.contains(Flags::WRAPPER_BUSY) };
            // SAFETY: as above.
            unsafe { (*this).flags.insert(Flags::WRAPPER_BUSY) };
            // SAFETY: see `on_read` — WRAPPER_BUSY keeps the `Some` payload
            // bytes at `*w` valid for the call's duration.
            unsafe {
                let _ = (*w).shutdown(false);
            }
            if !was_busy {
                // SAFETY: `this` is still live (re-entry only toggles flags /
                // defers wrapper drop while WRAPPER_BUSY).
                unsafe { (*this).flags.remove(Flags::WRAPPER_BUSY) };
                // SAFETY: `this` is still live; read-only flag check.
                if unsafe { (*this).flags.is_closed() } {
                    // SAFETY: `this` still live; WRAPPER_BUSY cleared so dropping
                    // the wrapper no longer races its own `&mut self`.
                    unsafe { (*this).wrapper = None };
                }
            }
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown_read")]
    pub fn shutdown_read(&mut self) {
        if let Some(wrapper) = self.wrapper.as_mut() {
            let _ = wrapper.shutdown_read();
        } else {
            #[cfg(windows)]
            if let Some(stream) = self.writer.get_stream() {
                // SAFETY: `stream` is the live pipe stream; `uv_read_stop`
                // always succeeds and is a no-op if not reading.
                unsafe { (*stream).read_stop() };
            }
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_shutdown", no_catch)]
    pub fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.is_shutdown();
        }

        self.flags.disconnected() || self.writer.is_done
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_closed", no_catch)]
    pub fn is_closed(&self) -> bool {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.is_closed();
        }
        self.flags.disconnected()
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__is_established", no_catch)]
    pub fn is_established(&self) -> bool {
        !self.is_closed()
    }

    pub fn ssl(&self) -> Option<*mut boringssl::SSL> {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.ssl.map(|p| p.as_ptr());
        }
        None
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__ssl_error", no_catch)]
    pub fn ssl_error(&self) -> us_bun_verify_error_t {
        us_bun_verify_error_t {
            error_no: self.ssl_error.error_no,
            // CertError.code/.reason are owned `Box<CStr>`s; fall back to "" when absent.
            code: self
                .ssl_error
                .code
                .as_deref()
                .map_or(c"".as_ptr(), |c| c.as_ptr()),
            reason: self
                .ssl_error
                .reason
                .as_deref()
                .map_or(c"".as_ptr(), |c| c.as_ptr()),
        }
    }

    pub fn reset_timeout(&mut self) {
        self.set_timeout_in_milliseconds(self.current_timeout);
    }

    pub fn set_timeout_in_milliseconds(&mut self, ms: c_uint) {
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            timer_all().remove(&raw mut self.event_loop_timer);
        }
        self.current_timeout = ms;

        // if the interval is 0 means that we stop the timer
        if ms == 0 {
            return;
        }

        // reschedule the timer
        // PORT NOTE: `EventLoopTimer.next` is the lower-tier `ElTimespec` stub;
        // bridge from `bun_core::Timespec` until the lower tier switches.
        let next = timespec::ms_from_now(bun_core::TimespecMockMode::AllowMockedTime, ms as i64);
        self.event_loop_timer.next = ElTimespec {
            sec: next.sec,
            nsec: next.nsec,
        };
        timer_all().insert(&raw mut self.event_loop_timer);
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__set_timeout")]
    pub fn set_timeout(&mut self, seconds: c_uint) {
        bun_output::scoped_log!(WindowsNamedPipe, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    fn release_resources(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        #[cfg(windows)]
        if let Some(stream) = self.writer.get_stream() {
            // SAFETY: `stream` is the live pipe stream; `uv_read_stop` always
            // succeeds and is a no-op if not reading.
            unsafe { (*stream).read_stop() };
        }
        #[cfg(windows)]
        {
            if self.writer.get_fd() != Fd::INVALID {
                debug_assert!(!self.writer.closed_without_reporting);
                self.writer.closed_without_reporting = true;
                self.writer.close();
            }
            self.writer.outgoing = Default::default();
        }
        if !self.flags.contains(Flags::WRAPPER_BUSY) {
            self.wrapper = None;
        }
        self.ssl_error = CertError::default();
    }
}

impl Drop for WindowsNamedPipe {
    fn drop(&mut self) {
        self.release_resources();
        #[cfg(windows)]
        if !self.flags.contains(Flags::PIPE_ADOPTED) {
            if let Some(pipe) = self.pipe.take() {
                // SAFETY: `pipe` is the `NonNull` from `Box::leak` in `from()`,
                // never adopted (gated on `!PIPE_ADOPTED`); `close_and_destroy`
                // is the unique reclaim and accepts both never-init'd and
                // init'd-but-unowned handles.
                unsafe { uv::Pipe::close_and_destroy(pipe.as_ptr()) };
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn WindowsNamedPipe__ssl(this: *const c_void) -> *mut boringssl::SSL {
    // SAFETY: `this` is a live `*const WindowsNamedPipe` from the bun_uws opaque handle.
    unsafe {
        (*this.cast::<WindowsNamedPipe>())
            .ssl()
            .unwrap_or(core::ptr::null_mut())
    }
}

// Windows-only at runtime; the POSIX impl exists purely so the
// `StreamingWriter<Self>` field type-checks (poll_tag::NULL keeps the
// dispatch table from being silently wrong if a poll is ever created).
bun_io::impl_streaming_writer_parent! {
    WindowsNamedPipe;
    poll_tag   = bun_io::posix_event_loop::poll_tag::NULL,
    borrow     = mut,
    on_write   = on_write,
    on_error   = on_error,
    on_ready   = on_writable,
    on_close   = on_close,
    event_loop = |this| (*this).event_loop_handle.as_event_loop_ctx(),
    uws_loop   = |this| (*this).vm.uws_loop(),
    uv_loop    = |this| (*this).vm.uv_loop(),
    ref_       = |this| (&mut *this).r#ref(),
    deref      = |this| (&mut *this).deref(),
}

/// Port of the three `comptime` fn-pointer args to Zig `stream.readStart(this,
/// onReadAlloc, onReadError, onRead)` — Rust bakes them into a trait so the
/// `extern "C"` libuv trampoline is monomorphised over `WindowsNamedPipe`.
#[cfg(windows)]
impl uv::StreamReader for WindowsNamedPipe {
    #[inline]
    fn on_read_alloc(this: &mut Self, suggested_size: usize) -> &mut [u8] {
        WindowsNamedPipe::on_read_alloc(this, suggested_size)
    }
    #[inline]
    fn on_read_error(this: &mut Self, err: core::ffi::c_int) {
        let e = bun_sys::windows::translate_uv_error_to_e(err);
        WindowsNamedPipe::on_read_error(this, e);
    }
    #[inline]
    unsafe fn on_read(this: *mut Self, data: &[u8]) {
        let nread = data.len();
        let _ = data;
        // SAFETY: `this` is the live context stashed in `handle.data` by
        // `read_start_ctx`; `data` is no longer live so the Unique retag is sound.
        WindowsNamedPipe::on_read(unsafe { &mut *this }, nread);
    }
}

// ported from: src/runtime/socket/WindowsNamedPipe.zig
