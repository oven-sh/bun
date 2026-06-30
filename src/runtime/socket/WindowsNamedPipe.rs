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
//! Uses the engine pipe handle (`bun_iocp::pipe::PipeHandle`, via the io
//! layer's `PipeSource`/`StreamingWriter`) for the underlying Named Pipe
//! operations while maintaining compatibility with µWebSockets.

use core::ffi::{c_uint, c_void};
#[cfg(windows)]
use core::ptr::NonNull;

use bun_boringssl_sys as boringssl;
use bun_core::timespec;
#[cfg(windows)]
use bun_io::Source;
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
#[cfg(windows)]
use bun_io::source::PipeSource;
use bun_io::{StreamingWriter, WriteStatus};
use bun_jsc::virtual_machine::VirtualMachine;
#[cfg(windows)]
use bun_sys::windows::{Win32Error, win_error};
use bun_sys::{self, Fd};
use bun_uws::us_bun_verify_error_t;

use crate::socket::SSLConfig;
#[cfg(windows)]
use crate::socket::ssl_wrapper;
use crate::socket::ssl_wrapper::SSLWrapper;
#[cfg(windows)]
use crate::timer::EventLoopTimerTag;
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState};

bun_output::declare_scope!(WindowsNamedPipe, visible);

pub type CertError = crate::socket::upgraded_duplex::CertError;

type WrapperType = SSLWrapper<*mut WindowsNamedPipe>;

use crate::jsc_hooks::timer_all_mut as timer_all;

pub struct WindowsNamedPipe {
    pub wrapper: Option<WrapperType>,
    /// Owned engine pipe between creation (`connect`/`open`/`adopt_accepted`)
    /// and adoption by `self.writer.source` in [`start`] — `None` afterwards.
    /// Engine handles must be closed (freed in the close callback), never
    /// plain-dropped; `discard_unadopted_pipe`/`Drop` honor that.
    #[cfg(windows)]
    pub pipe: Option<Box<PipeSource>>, // any duplex
    #[cfg(not(windows))]
    pub pipe: (),
    /// The per-thread VM singleton outlives this struct (it is torn down only
    /// at thread exit, after every named pipe is closed), so `&'static` is the
    /// honest model here rather than a threaded lifetime.
    pub vm: &'static VirtualMachine,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub event_loop_handle: bun_jsc::EventLoopHandle,

    pub writer: StreamingWriter<WindowsNamedPipe>,

    pub incoming: Vec<u8>, // Maybe we should use IPCBuffer here as well
    pub ssl_error: CertError,
    pub handlers: Handlers,

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
        /// Rust-only re-entrancy guard: set while `SSLWrapper::receive_data`
        /// is executing through a raw `*mut WrapperType` into `self.wrapper`.
        /// `release_resources()` checks this to DEFER `self.wrapper = None`
        /// (which would run `SSLWrapper::drop` and rewrite the `Option`
        /// discriminant) until the in-flight call returns — `receive_data` can
        /// synchronously fire `ssl_on_close → on_close → release_resources`,
        /// and dropping the wrapper out from under its own `&mut self` is UAF.
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
    /// A new resumable TLS session (serialized SSL_SESSION) - node's
    /// `'session'` event on the wrapping TLSSocket.
    pub on_session: fn(*mut c_void, &[u8]),
    /// An NSS key-log line - node's `'keylog'` event.
    pub on_keylog: fn(*mut c_void, &[u8]),
}

impl WindowsNamedPipe {
    /// Safe raw-pointer accessor for the `Some` payload of `self.wrapper`,
    /// used by the WRAPPER_BUSY re-entrancy pattern (see `on_read`).
    ///
    /// Deriving the `*mut` is itself entirely safe — only the later
    /// `(*w).<method>()` deref requires `unsafe`. Consolidating here removes
    /// the per-site `as_mut().unwrap_unchecked()` dance (×8) into a single
    /// safe projection; callers either match on the `Option` or `.unwrap()`
    /// after an explicit `is_some()`/just-assigned.
    #[inline]
    fn wrapper_ptr(&mut self) -> Option<*mut WrapperType> {
        self.wrapper.as_mut().map(core::ptr::from_mut)
    }

    /// Release the owned engine pipe on an early-error path **before**
    /// [`start`] hands it to `self.writer.source` — the engine close
    /// callback frees the box; an `open()`-recorded fd is released through
    /// the table protocol.
    ///
    /// MUST NOT be called once `start` has adopted the source (the writer is
    /// then the sole owner; `self.pipe` is already `None`).
    #[cfg(windows)]
    fn discard_unadopted_pipe(&mut self) {
        debug_assert!(
            self.writer.source.is_none(),
            "pipe already adopted by writer.source; discard would double-free"
        );
        if let Some(ps) = self.pipe.take() {
            Source::Pipe(ps).close(true);
        }
    }

    fn on_writable(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWritable");
        // flush pending data
        self.flush();
        // call onWritable (will flush on demand)
        (self.handlers.on_writable)(self.handlers.ctx);
    }

    /// Engine read callback. `err == SUCCESS` delivers `n >= 1` bytes in the
    /// source's pinned buffer (a separate allocation from `self`, so copying
    /// into `incoming` needs no aliasing dance); terminal codes deliver
    /// exactly once and the engine has already stopped reading.
    #[cfg(windows)]
    unsafe fn on_engine_read(
        _lp: &mut bun_iocp::Loop,
        data: *mut c_void,
        buf: *mut u8,
        n: usize,
        err: Win32Error,
    ) {
        // SAFETY: `data` is the live WindowsNamedPipe (a field of the heap
        // context) registered at read_start; engine callbacks run on the
        // loop thread with no other borrow live.
        let this = unsafe { &mut *data.cast::<Self>() };
        if err != Win32Error::SUCCESS {
            if let Some(Source::Pipe(ps)) = this.writer.source.as_mut() {
                ps.mark_read_stopped();
            }
            let e = match win_error::classify_read(err) {
                win_error::ReadClass::Eof => bun_sys::E::EOF,
                win_error::ReadClass::Err(e) => e,
            };
            this.on_read_error(e);
            return;
        }
        // SAFETY: the engine lends `n` initialized bytes for this callback.
        this.incoming
            .extend_from_slice(unsafe { core::slice::from_raw_parts(buf, n) });
        this.on_read(n);
    }

    #[cfg(windows)]
    fn on_read(&mut self, nread: usize) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", nread);
        self.reset_timeout();

        // Stacked-Borrows: `receive_data` may synchronously re-enter this
        // struct via the SSL trampolines (`ssl_write`/`ssl_on_*`), which form
        // `&mut *this` over the WHOLE struct from the raw `*mut Self` stored in
        // `wrapper.handlers.ctx`. That Unique retag would pop (a) any SharedRO
        // borrow of `self.incoming` held by `data`, and (b) any live `&mut`
        // borrow of `self.wrapper`. Decouple both before calling in:
        //   (a) move the buffer out so `data` is independent of `*self`;
        //   (b) call `receive_data` through a raw `*mut WrapperType` so no
        //       outer `&mut self.wrapper` Unique tag is held across the
        //       re-entrant retag (raw-ptr-per-field pattern, see jsc_hooks.rs).
        let mut data = core::mem::take(&mut self.incoming);

        if let Some(w) = self.wrapper_ptr() {
            // `receive_data → handle_traffic` may synchronously invoke
            // `trigger_close_callback` → `ssl_on_close` → `on_close` →
            // `release_resources()`. Guard so that path defers
            // `self.wrapper = None` instead of dropping the `SSLWrapper`
            // (and rewriting the `Option` discriminant) while `*w` is still
            // mid-execution inside its payload.
            //
            // Re-entrancy: the SSL trampolines (`on_data`/`on_open`/
            // `on_handshake`) call into JS, which may call back into
            // `encode_and_write`/`flush`/`close`/`shutdown` — each of which
            // ALSO sets/clears WRAPPER_BUSY. A nested clear would prematurely
            // disarm the OUTER guard and let the inner epilogue (or a
            // subsequent `release_resources`) drop `self.wrapper` while THIS
            // `(*w).receive_data()` is still executing. Capture the prior
            // state and only run the clear+epilogue at the outermost level.
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
                // If close fired re-entrantly, the deferred drop is now safe:
                // `receive_data` has returned and no `&mut` into the wrapper
                // is live. (`release_resources` is idempotent, but we only
                // need the wrapper teardown it skipped.)
                if self.flags.is_closed() {
                    self.wrapper = None;
                }
            }
        } else {
            (self.handlers.on_data)(self.handlers.ctx, data.as_slice());
        }
        // Restore the (cleared) allocation so
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
                    // `Source` is an enum;
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

    fn on_session(&mut self, session: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onSession ({})", session.len());
        (self.handlers.on_session)(self.handlers.ctx, session);
    }

    fn on_keylog(&mut self, line: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onKeylog ({})", line.len());
        (self.handlers.on_keylog)(self.handlers.ctx, line);
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
    fn ssl_on_session(this: *mut Self, d: &[u8]) {
        // SAFETY: see `ssl_on_open`.
        unsafe { (*this).on_session(d) }
    }
    fn ssl_on_keylog(this: *mut Self, d: &[u8]) {
        // SAFETY: see `ssl_on_open`.
        unsafe { (*this).on_keylog(d) }
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
        // The writer only fires this hook for an adopted source, so the
        // pre-adoption owner slot is already empty (Drop reclaims otherwise).
        #[cfg(windows)]
        debug_assert!(self.pipe.is_none());
        if !self.flags.is_closed() {
            self.flags.set_is_closed(true); // only call onClose once
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
                    // See `on_write` for the active-variant note.
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
                // Re-entrancy guard: `shutdown → trigger_close_callback` can fire
                // `ssl_on_close → release_resources()` synchronously; see `on_read`
                // for the WRAPPER_BUSY rationale (defers `self.wrapper = None` so
                // the SSLWrapper isn't dropped out from under its own `&mut self`).
                // Re-entrancy: see `on_read` — only the OUTERMOST scope may
                // clear the flag / run the deferred-drop epilogue.
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

        // Possible scenarios:
        // Scenario 1: will not write if is not connected yet but will enqueue the data
        // Scenario 2: will not write if a exception is thrown (will be handled by onError)
        // Scenario 3: will be queued in memory and will be flushed later
        // Scenario 4: no write/end function exists (will be handled by onError)
        self.call_write_or_end(Some(encoded_data), true);
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__resume_stream")]
    pub fn resume_stream(&mut self) -> bool {
        #[cfg(windows)]
        {
            let this: *mut Self = core::ptr::from_mut(self);
            let Some(Source::Pipe(ps)) = self.writer.source.as_mut() else {
                return false;
            };
            // SAFETY: `this` (the cb ctx) outlives reading — the source is
            // stopped or closed before this struct can be freed; a parked
            // completion is re-delivered by the engine.
            let rc = unsafe { ps.read_start(Self::on_engine_read, this.cast()) };
            rc == Win32Error::SUCCESS
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
            let Some(Source::Pipe(ps)) = self.writer.source.as_mut() else {
                return false;
            };
            ps.read_stop();
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
            // Re-entrancy guard: `SSLWrapper::flush → handle_traffic` can fire
            // `trigger_close_callback → ssl_on_close → release_resources()`
            // synchronously, and on the success path invokes `(handlers.write)`
            // → `ssl_write` → `&mut *this` (Unique retag over the whole struct).
            // Call through a raw `*mut WrapperType` under WRAPPER_BUSY so (a) no
            // outer `&mut self.wrapper` tag is live across the re-entrant retag,
            // and (b) `release_resources` defers `self.wrapper = None` instead
            // of dropping the SSLWrapper mid-call. See `on_read` for the full
            // rationale.
            // Re-entrancy: see `on_read` — only the OUTERMOST scope may clear
            // the flag / run the deferred-drop epilogue.
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
    pub fn from(handlers: Handlers, vm: &'static VirtualMachine) -> WindowsNamedPipe {
        WindowsNamedPipe {
            vm,
            event_loop_handle: bun_jsc::EventLoopHandle::init(vm.event_loop().cast::<()>()),
            // The engine pipe is created by `connect`/`open`/`adopt_accepted`
            // and handed to `self.writer.source` in `start()`.
            pipe: None,
            wrapper: None,
            handlers,
            // defaults:
            writer: StreamingWriter::default(),
            incoming: Vec::new(),
            ssl_error: CertError::default(),
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

    /// Engine connect callback (`PipeConnectCb`): always invoked
    /// asynchronously, exactly once, including for validation failures.
    #[cfg(windows)]
    unsafe fn on_engine_connect(_lp: &mut bun_iocp::Loop, data: *mut c_void, err: Win32Error) {
        // SAFETY: `data` was set to `self as *mut Self` in `connect()`; the
        // owning struct is kept alive by the `r#ref()` taken there.
        unsafe { (*data.cast::<Self>()).on_connect(err) };
    }

    #[cfg(windows)]
    fn on_connect(&mut self, err: Win32Error) {
        // A deref-on-exit scopeguard would need to capture &mut self alongside
        // body uses; call deref() explicitly at each return.

        if err != Win32Error::SUCCESS {
            // On async connect failure the engine pipe was never adopted by
            // `writer.source` (`start()` only runs on the success branch
            // below), so `on_error → close → writer.end()` is a no-op for it.
            // Reclaim it here, mirroring the synchronous early-error paths in
            // `connect`/`open`/`adopt_accepted`.
            self.discard_unadopted_pipe();
            self.on_error(bun_sys::Error::from_code(
                win_error::translate(err),
                bun_sys::Tag::connect,
            ));
            self.deref();
            return;
        }

        self.flags.set_disconnected(false);
        if self.start(true) {
            if self.is_tls() {
                if let Some(w) = self.wrapper_ptr() {
                    // trigger onOpen and start the handshake
                    // Re-entrancy guard: `SSLWrapper::start → handle_traffic`
                    // can fire `trigger_close_callback` (handshake fatal error)
                    // synchronously; see `on_read` for the WRAPPER_BUSY pattern.
                    // Re-entrancy: see `on_read` — only the OUTERMOST scope
                    // may clear the flag / run the deferred-drop epilogue.
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

    /// Adopt a connection just taken from an engine server's `accept()`.
    /// Owns `conn` on every path — closes it itself on failure.
    #[cfg(windows)]
    pub fn adopt_accepted(
        &mut self,
        conn: Box<bun_iocp::pipe::PipeHandle>,
        ssl_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.is_none());
        self.flags.set_disconnected(true);
        self.pipe = Some(PipeSource::from_engine(conn));

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
                    on_session: Some(Self::ssl_on_session),
                    on_keylog: Some(Self::ssl_on_keylog),
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

        self.flags.set_disconnected(false);
        if self.start(false) {
            if self.is_tls() {
                if let Some(w) = self.wrapper_ptr() {
                    // trigger onOpen and start the handshake
                    // Re-entrancy guard: `SSLWrapper::start → handle_traffic`
                    // can fire `trigger_close_callback` synchronously; see
                    // `on_read` for the WRAPPER_BUSY pattern.
                    // Re-entrancy: see `on_read` — only the OUTERMOST scope
                    // may clear the flag / run the deferred-drop epilogue.
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
        debug_assert!(self.pipe.is_none());
        self.flags.set_disconnected(true);

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                return result;
            }
        }
        // Adopt the fd: the engine takes a private duplicate (PIPE-19) and
        // the fd is recorded for release on close — the same teardown the
        // old uv table-fd ownership produced.
        let ps = match Source::open_pipe(self.vm.platform_loop(), fd) {
            bun_sys::Result::Ok(ps) => ps,
            bun_sys::Result::Err(e) => return bun_sys::Result::Err(e),
        };
        self.pipe = Some(ps);

        self.r#ref();
        Self::on_connect(self, Win32Error::SUCCESS);
        bun_sys::Result::Ok(())
    }

    #[cfg(windows)]
    pub fn connect(
        &mut self,
        path: &[u8],
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        debug_assert!(self.pipe.is_none());
        self.flags.set_disconnected(true);

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                return result;
            }
        }
        let Some(name) = pipe_name_utf16(path) else {
            return bun_sys::Result::Err(bun_sys::Error::from_code(
                bun_sys::E::INVAL,
                bun_sys::Tag::connect2,
            ));
        };
        // SAFETY: the VM's loop wrapper is live for the process lifetime.
        let lp = unsafe { bun_iocp::usockets::native_loop(self.vm.platform_loop().cast()) };
        // SAFETY: the loop outlives the handle (engine contract); the box is
        // freed only via the engine close callback (Source::close).
        let mut ps = PipeSource::from_engine(unsafe { bun_iocp::pipe::PipeHandle::new(lp) });
        let this: *mut Self = core::ptr::addr_of_mut!(*self);
        // SAFETY: `this` is the heap-context field address, stable until the
        // close paths run; the engine delivers exactly one connect callback
        // (asynchronously, including validation failures).
        let rc = unsafe {
            ps.handle
                .connect(&name, Some(Self::on_engine_connect), this.cast::<c_void>())
        };
        self.pipe = Some(ps);
        if rc.is_err() {
            // Only reachable on a closing handle — defensive; this one is
            // freshly created.
            self.discard_unadopted_pipe();
            return bun_sys::Result::Err(bun_sys::Error::from_code(
                bun_sys::E::PIPE,
                bun_sys::Tag::connect2,
            ));
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

    /// Set up the in-process SSL wrapper for `connect`/`open`. Prefers a prebuilt
    /// `SSL_CTX` (one ref ADOPTED — held by `wrapper` on success, freed here on
    /// failure) so a memoised `tls.createSecureContext` reaches this path with its
    /// CA bundle intact; on this branch `[buntls]` returns `{secureContext}` and no
    /// longer spreads `{ca,cert,key}`, so the `SSLConfig` fallback alone would build
    /// a CTX with an empty trust store and fail `DEPTH_ZERO_SELF_SIGNED_CERT`.
    /// Returns null when neither input requested TLS.
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
            on_session: Some(Self::ssl_on_session),
            on_keylog: Some(Self::ssl_on_keylog),
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

    pub fn start(&mut self, is_client: bool) -> bool {
        self.flags.set_is_client(is_client);
        #[cfg(windows)]
        {
            let Some(ps) = self.pipe.take() else {
                return false;
            };
            // raw self-ptr first to dodge the &mut self.writer / &mut *self overlap
            let this: *mut Self = core::ptr::from_mut(self);
            // Hand ownership to the writer (the `start_with_pipe` shape, with
            // the source pre-built): after this the writer's close hand-off is
            // the sole teardown path for the engine handle.
            debug_assert!(self.writer.source.is_none());
            self.writer.source = Some(Source::Pipe(ps));
            if let Some(src) = self.writer.source.as_mut() {
                // An idle pipe must not hold the loop; the write paths
                // re-`ref_()` while data is pending (see `call_write_or_end`).
                src.unref();
            }
            self.writer.set_parent(this);
            if let bun_sys::Result::Err(err) = self.writer.start_with_current_pipe() {
                self.on_error(err);
                return false;
            }

            // Begin reading through the writer-owned source.
            let rc = match self.writer.source.as_mut() {
                // SAFETY: `this` (the cb ctx) outlives reading — the source
                // is stopped or closed before this struct can be freed.
                Some(Source::Pipe(ps)) => unsafe {
                    ps.read_start(Self::on_engine_read, this.cast())
                },
                _ => Win32Error::INVALID_HANDLE,
            };
            if rc != Win32Error::SUCCESS {
                self.on_error(bun_sys::Error::from_code(
                    win_error::translate(rc),
                    bun_sys::Tag::listen,
                ));
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

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__encode_and_write")]
    pub fn encode_and_write(&mut self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(WindowsNamedPipe, "encodeAndWrite (len: {})", data.len());
        if let Some(w) = self.wrapper_ptr() {
            // Re-entrancy guard: `SSLWrapper::write_data` calls
            // `trigger_close_callback` on SSL_ERROR_SSL/SYSCALL and
            // `handle_traffic` on success — both can synchronously reach
            // `ssl_on_close → release_resources()` (UAF if it drops the
            // wrapper) and `ssl_write → &mut *this` (Stacked-Borrows pop if an
            // outer `&mut self.wrapper` is live). Use the raw-ptr +
            // WRAPPER_BUSY pattern from `on_read`.
            // Re-entrancy: see `on_read` — only the OUTERMOST scope may clear
            // the flag / run the deferred-drop epilogue. (JS `socket.write()`
            // from inside `onData`/`onOpen`/`onHandshake` re-enters here while
            // the outer `(*w).receive_data()`/`(*w).start()` is still running.)
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
        // PORT_NOTES_PLAN R-2: `&mut self` carries LLVM `noalias`, but
        // `SSLWrapper::shutdown` re-enters via the handler vtable
        // (`trigger_close_callback` → `ssl_on_close` → fresh
        // `&mut WindowsNamedPipe` from `m_ctx`) and writes `self.flags` /
        // `self.wrapper`. The launder + raw-pointer accesses below force LLVM
        // to reload those fields after the call instead of caching the
        // pre-call value (ASM-verified PROVEN_CACHED on `self.flags`).
        // Mirrors the cork fix at b818e70e1c57.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` aliases the live `&mut self`; single JS thread, no
        // concurrent mutator. All reads/writes go through `this` so no
        // `&mut self`-derived borrow is held across the re-entrant call.
        if unsafe { (*this).wrapper.is_some() } {
            // Re-entrancy guard: `SSLWrapper::shutdown` calls
            // `trigger_close_callback` on SSL_ERROR_SSL/SYSCALL → `ssl_on_close`
            // → `release_resources()`. See `on_read` for the WRAPPER_BUSY
            // pattern (defers `self.wrapper = None`).
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
        // PORT_NOTES_PLAN R-2: see `close` above — same `noalias`-cached-`flags`
        // miscompile across `(*w).shutdown(false)`'s re-entry (ASM-verified
        // PROVEN_CACHED). Launder so post-call reads of `flags`/`wrapper` are
        // fresh.
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
        } else {
            // Plain (non-TLS) named pipe: half-close the write side so the peer
            // observes EOF. Without this, Socket.prototype.end() over a Windows
            // named pipe (endNT → shutdown()) never signals the peer, and an
            // allowHalfOpen peer waiting on 'end' hangs. `writer.end()` is
            // idempotent and mirrors `close`'s unconditional writer teardown.
            // SAFETY: `this` aliases the live `&mut self`; single JS thread.
            unsafe { (*this).writer.end() };
        }
    }

    #[bun_uws::uws_callback(export = "WindowsNamedPipe__shutdown_read")]
    pub fn shutdown_read(&mut self) {
        if let Some(wrapper) = self.wrapper.as_mut() {
            let _ = wrapper.shutdown_read();
        } else {
            #[cfg(windows)]
            if let Some(Source::Pipe(ps)) = self.writer.source.as_mut() {
                // No-op if not reading; safe on a closing handle.
                ps.read_stop();
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
        // `EventLoopTimer.next` is the lower-tier `ElTimespec` stub;
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

    /// Free internal resources, it can be called multiple times.
    // Private idempotent helper invoked from on_close and Drop.
    // Owned fields (writer, wrapper, ssl_error) free themselves via their own Drop impls; only
    // the side effects (timer cancel, read_stop, take()) remain explicit here.
    fn release_resources(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        #[cfg(windows)]
        if let Some(Source::Pipe(ps)) = self.writer.source.as_mut() {
            // No-op if not reading; safe on a closing handle.
            ps.read_stop();
        }
        // "The source is already
        // closed by the time on_close reaches here (that close is what fired the
        // callback)" is true ONLY for the writer-initiated close path
        // (`WindowsStreamingWriterParent::on_close`). It is FALSE when we arrive
        // via `ssl_on_close` (TLS close_notify): the engine pipe is still open,
        // so without an explicit close here the HANDLE survives ≥ one extra
        // event-loop tick (until the embedding context's refcount hits 0 and
        // `WindowsStreamingWriter::Drop` finally runs). Inline
        // `close_without_reporting()` (private on the writer) so the source
        // pipe is closed NOW; the `get_fd() != INVALID` guard makes this a
        // no-op on the writer-initiated path where the source was already
        // taken, and `closed_without_reporting = true` keeps
        // `on_close_source()` from re-entering `Parent::on_close` (we're
        // already inside it). `current_payload` may still back an in-flight
        // engine write (failed with the abort shape by close) so it is left
        // to the writer's own Drop.
        #[cfg(windows)]
        {
            if self.writer.get_fd() != Fd::INVALID {
                debug_assert!(!self.writer.closed_without_reporting);
                self.writer.closed_without_reporting = true;
                self.writer.close();
            }
            self.writer.outgoing = Default::default();
        }
        // `receive_data → handle_traffic → trigger_close_callback` can land
        // here while a raw `*mut WrapperType` into `self.wrapper`'s payload is
        // still mid-execution (see `on_read`).
        // Dropping the wrapper now would free SSL/SSL_CTX and overwrite the
        // `Option` discriminant under that live pointer — UAF / aliased-&mut
        // UB. Defer; the call site drops it after `receive_data` returns.
        if !self.flags.contains(Flags::WRAPPER_BUSY) {
            self.wrapper = None;
        }
        self.ssl_error = CertError::default();
    }
}

impl Drop for WindowsNamedPipe {
    fn drop(&mut self) {
        self.release_resources();
        // Reclaim an engine pipe that was never adopted by
        // `self.writer.source` (early-error returns from
        // `connect`/`open`/`adopt_accepted` before `start()` runs). Once
        // adopted, the writer is the sole owner and frees via the engine
        // close callback.
        #[cfg(windows)]
        if let Some(ps) = self.pipe.take() {
            Source::Pipe(ps).close(true);
        }
    }
}

// Hand-written `ssl` shim for the `bun_uws` cycle-break extern — the safe
// method returns `Option<*mut SSL>` while the C ABI flattens to a nullable
// raw pointer. All other `WindowsNamedPipe__*` symbols are emitted by
// `#[uws_callback(export = …)]` on the inherent methods above.
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
    windows_loop = |this| (*this).vm.platform_loop(),
    ref_       = |this| (&mut *this).r#ref(),
    deref      = |this| (&mut *this).deref(),
}

/// UTF-16 pipe name for the engine connect/bind APIs (no terminator; the
/// engine appends its own). Tolerates one trailing NUL from ZStr-shaped
/// callers; returns `None` only on allocation failure.
#[cfg(windows)]
pub(crate) fn pipe_name_utf16(path: &[u8]) -> Option<Vec<u16>> {
    let path = path.strip_suffix(&[0]).unwrap_or(path);
    match bun_core::strings::to_utf16_alloc(path, false, false) {
        Ok(Some(v)) => Some(v),
        // Pure-ASCII fast path: widen in place.
        Ok(None) => Some(path.iter().map(|&b| u16::from(b)).collect()),
        Err(_) => None,
    }
}
