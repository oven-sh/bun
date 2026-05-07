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

use core::ffi::{c_uint, c_void, CStr};
use core::ptr::NonNull;

use bun_aio::Loop as AsyncLoop;
use bun_boringssl_sys as boringssl;
use bun_collections::VecExt;
use bun_core::timespec;
use bun_io::{StreamingWriter, WriteStatus};
use bun_jsc::virtual_machine::VirtualMachine;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd};
use bun_uws::us_bun_verify_error_t;

use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState};
use crate::socket::SSLConfig;
use crate::socket::ssl_wrapper::{self, SSLWrapper};

bun_output::declare_scope!(WindowsNamedPipe, visible);

// Zig `pub const CertError = UpgradedDuplex.CertError;`
pub type CertError = crate::socket::upgraded_duplex::CertError;

type WrapperType = SSLWrapper<*mut WindowsNamedPipe>;

/// Recover this thread's `timer::All` heap (b2-cycle: `vm.timer` is `()` in
/// the low-tier `VirtualMachine`; the real value lives in `RuntimeState`).
#[inline]
fn timer_all<'a>() -> &'a mut crate::timer::All {
    // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`;
    // single JS thread, raw-ptr-per-field re-entry pattern (jsc_hooks.rs).
    unsafe { &mut (*crate::jsc_hooks::runtime_state()).timer }
}

pub struct WindowsNamedPipe {
    pub wrapper: Option<WrapperType>,
    #[cfg(windows)]
    pub pipe: Option<Box<uv::Pipe>>, // any duplex
    #[cfg(not(windows))]
    pub pipe: (),
    // TODO(port): lifetime — JSC_BORROW; VM outlives this struct. Using &'static for Phase A;
    // create a timeout version that doesn't need the jsc VM
    pub vm: &'static VirtualMachine,

    // TODO(port): `bun.io.StreamingWriter(WindowsNamedPipe, .{ onClose, onWritable, onError, onWrite })`
    // is a comptime type-generator binding callbacks at type level. Phase B: encode callbacks as a
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

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const DISCONNECTED = 1 << 0;
        const IS_CLOSED    = 1 << 1;
        const IS_CLIENT    = 1 << 2;
        const IS_SSL       = 1 << 3;
        // _: u4 padding
    }
}

impl Flags {
    #[inline] pub fn disconnected(self) -> bool { self.contains(Self::DISCONNECTED) }
    #[inline] pub fn set_disconnected(&mut self, v: bool) { self.set(Self::DISCONNECTED, v) }
    #[inline] pub fn is_closed(self) -> bool { self.contains(Self::IS_CLOSED) }
    #[inline] pub fn set_is_closed(&mut self, v: bool) { self.set(Self::IS_CLOSED, v) }
    #[inline] pub fn is_client(self) -> bool { self.contains(Self::IS_CLIENT) }
    #[inline] pub fn set_is_client(&mut self, v: bool) { self.set(Self::IS_CLIENT, v) }
    #[inline] pub fn is_ssl(self) -> bool { self.contains(Self::IS_SSL) }
    #[inline] pub fn set_is_ssl(&mut self, v: bool) { self.set(Self::IS_SSL, v) }
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
    fn on_writable(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWritable");
        // flush pending data
        self.flush();
        // call onWritable (will flush on demand)
        (self.handlers.on_writable)(self.handlers.ctx);
    }

    fn on_pipe_close(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onPipeClose");
        self.flags.set_disconnected(true);
        #[cfg(windows)]
        {
            self.pipe = None;
        }
        self.on_close();
    }

    fn on_read_alloc(&mut self, suggested_size: usize) -> &mut [u8] {
        // PORT NOTE: reshaped for borrowck — check len, grow, then take the final borrow once.
        if self.incoming.unused_capacity_slice().len() < suggested_size {
            bun_core::handle_oom(self.incoming.ensure_unused_capacity(suggested_size));
        }
        let available = self.incoming.unused_capacity_slice();
        // SAFETY: `available` is the unused-capacity tail of `incoming`; slicing to
        // `suggested_size` is in-bounds because we just ensured at least that much.
        // `MaybeUninit<u8>` has the same layout as `u8`; the libuv read callback
        // writes into this region before it's observed.
        unsafe { core::slice::from_raw_parts_mut(available.as_mut_ptr().cast::<u8>(), suggested_size) }
    }

    fn on_read(&mut self, buffer: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", buffer.len());
        unsafe { self.incoming.set_len(self.incoming.len() + buffer.len()) };
        debug_assert!(self.incoming.len() <= self.incoming.capacity());
        debug_assert!({
            let alloc = self.incoming.allocated_slice();
            // SAFETY: `MaybeUninit<u8>` has the same layout as `u8`; only used for
            // a pointer-range containment check, never read.
            let alloc_bytes =
                unsafe { core::slice::from_raw_parts(alloc.as_ptr().cast::<u8>(), alloc.len()) };
            bun_core::is_slice_in_buffer(buffer, alloc_bytes)
        });

        // PORT NOTE: reordered before `incoming.slice()` for borrowck — `reset_timeout`
        // only touches timer fields, never `self.incoming`.
        self.reset_timeout();

        let data = self.incoming.slice();

        if let Some(wrapper) = self.wrapper.as_mut() {
            // PORT NOTE: reshaped for borrowck — `data` borrows self.incoming while wrapper borrows self.wrapper
            // TODO(port): verify no aliasing between wrapper.receiveData and self.incoming
            wrapper.receive_data(data);
        } else {
            (self.handlers.on_data)(self.handlers.ctx, data);
        }
        self.incoming.clear();
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
                if let Some(source) = self.writer.source.as_ref() {
                    source.pipe.unref();
                }
            }
            WriteStatus::EndOfFile => {
                // we send FIN so we close after this
                self.writer.close();
            }
        }
    }

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
    fn ssl_on_open(this: *mut Self) { unsafe { (*this).on_open() } }
    fn ssl_on_handshake(this: *mut Self, ok: bool, e: us_bun_verify_error_t) {
        unsafe { (*this).on_handshake(ok, e) }
    }
    fn ssl_on_data(this: *mut Self, d: &[u8]) { unsafe { (*this).on_data(d) } }
    fn ssl_on_close(this: *mut Self) { unsafe { (*this).on_close() } }
    fn ssl_write(this: *mut Self, d: &[u8]) { unsafe { (*this).internal_write(d) } }

    fn on_handshake(&mut self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(WindowsNamedPipe, "onHandshake");

        self.ssl_error = CertError {
            error_no: ssl_error.error_no,
            code: if ssl_error.code.is_null() || ssl_error.error_no == 0 {
                None
            } else {
                // SAFETY: code is a NUL-terminated C string from BoringSSL when non-null
                Some(unsafe { CStr::from_ptr(ssl_error.code) }.into())
            },
            reason: if ssl_error.reason.is_null() || ssl_error.error_no == 0 {
                None
            } else {
                // SAFETY: reason is a NUL-terminated C string from BoringSSL when non-null
                Some(unsafe { CStr::from_ptr(ssl_error.reason) }.into())
            },
        };
        (self.handlers.on_handshake)(self.handlers.ctx, handshake_success, ssl_error);
    }

    fn on_close(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onClose");
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
                if let Some(source) = self.writer.source.as_ref() {
                    source.pipe.r#ref();
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
            if let Some(wrapper) = self.wrapper.as_mut() {
                let _ = wrapper.shutdown(false);
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

    pub fn resume_stream(&mut self) -> bool {
        #[cfg(windows)]
        {
            let Some(stream) = self.writer.get_stream() else {
                return false;
            };
            let read_start_result = stream.read_start(
                self,
                Self::on_read_alloc,
                Self::on_read_error,
                Self::on_read,
            );
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

    pub fn pause_stream(&mut self) -> bool {
        #[cfg(windows)]
        {
            let Some(pipe) = self.pipe.as_mut() else {
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

    pub fn flush(&mut self) {
        if let Some(wrapper) = self.wrapper.as_mut() {
            let _ = wrapper.flush();
        }
        if !self.flags.disconnected() {
            let _ = self.writer.flush();
        }
    }

    fn on_internal_receive_data(&mut self, data: &[u8]) {
        // PORT NOTE: reshaped for borrowck — reset_timeout borrows self mutably, so guard on
        // is_some() first, call reset_timeout(), then re-borrow wrapper.
        if self.wrapper.is_some() {
            self.reset_timeout();
            if let Some(wrapper) = self.wrapper.as_mut() {
                wrapper.receive_data(data);
            }
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
            pipe: Some(pipe),
            wrapper: None,
            handlers,
            // defaults:
            writer: StreamingWriter::default(),
            incoming: Vec::new(),
            ssl_error: CertError::default(),
            // SAFETY: all-zero is a valid uv_connect_t (#[repr(C)] POD, libuv expects zeroed)
            connect_req: unsafe { core::mem::zeroed::<uv::uv_connect_t>() },
            event_loop_timer: EventLoopTimer {
                next: timespec::EPOCH,
                tag: EventLoopTimer::Tag::WindowsNamedPipe,
                ..Default::default()
            },
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
    fn on_connect(&mut self, status: uv::ReturnCode) {
        // PORT NOTE: reshaped — Zig `defer this.deref()` cannot be a scopeguard here (would need
        // to capture &mut self alongside body uses). Call deref() explicitly at each return.

        #[cfg(windows)]
        if let Some(pipe) = self.pipe.as_mut() {
            let _ = pipe.unref();
        }

        if let Some(err) = status.to_error(bun_sys::Tag::connect) {
            self.on_error(err);
            self.deref();
            return;
        }

        self.flags.set_disconnected(false);
        if self.start(true) {
            if self.is_tls() {
                if let Some(wrapper) = self.wrapper.as_mut() {
                    // trigger onOpen and start the handshake
                    wrapper.start();
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
            // SAFETY: caller passes Some only for a live SSL_CTX*.
            let tls_nn = unsafe { NonNull::new_unchecked(tls) };
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
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::EPIPE as _,
                        syscall: bun_sys::Tag::connect,
                        ..Default::default()
                    });
                }
            };
            // ref because we are accepting will unref when wrapper deinit
            // SAFETY: tls is a valid SSL_CTX*
            unsafe {
                let _ = boringssl::SSL_CTX_up_ref(tls);
            }
        }
        #[cfg(windows)]
        {
            let init_result = self
                .pipe
                .as_mut()
                .unwrap()
                .init(self.vm.uv_loop(), false);
            if init_result.is_err() {
                return init_result;
            }

            let open_result = server.accept(self.pipe.as_mut().unwrap());
            if open_result.is_err() {
                return open_result;
            }
        }

        self.flags.set_disconnected(false);
        if self.start(false) {
            if self.is_tls() {
                if let Some(wrapper) = self.wrapper.as_mut() {
                    // trigger onOpen and start the handshake
                    wrapper.start();
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
                return result;
            }
        }
        let init_result = self
            .pipe
            .as_mut()
            .unwrap()
            .init(self.vm.uv_loop(), false);
        if init_result.is_err() {
            return init_result;
        }

        let open_result = self.pipe.as_mut().unwrap().open(fd);
        if open_result.is_err() {
            return open_result;
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
        let _ = self.pipe.as_mut().unwrap().r#ref();

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                return result;
            }
        }
        let init_result = self
            .pipe
            .as_mut()
            .unwrap()
            .init(self.vm.uv_loop(), false);
        if init_result.is_err() {
            return init_result;
        }

        self.connect_req.data = self as *mut _ as *mut c_void;
        let result = self.pipe.as_mut().unwrap().connect(
            &mut self.connect_req,
            path,
            self,
            Self::on_connect,
        );
        if result.as_err().is_some() {
            return result;
        }
        self.r#ref();
        result
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
    fn init_tls_wrapper(
        &mut self,
        ssl_options: Option<SSLConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> Option<bun_sys::Result<()>> {
        let handlers = ssl_wrapper::Handlers {
            ctx: self as *mut _,
            on_open: Self::ssl_on_open,
            on_handshake: Self::ssl_on_handshake,
            on_data: Self::ssl_on_data,
            on_close: Self::ssl_on_close,
            write: Self::ssl_write,
        };
        if let Some(ctx) = owned_ctx {
            self.flags.set_is_ssl(true);
            // SAFETY: caller passes Some only for a live SSL_CTX*; null would be a bug.
            let ctx_nn = unsafe { NonNull::new_unchecked(ctx) };
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
            self.wrapper = match WrapperType::init(&tls, true, handlers) {
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
        ssl_options: SSLConfig,
        is_client: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.flags.set_is_ssl(true);
        if self.start(is_client) {
            self.wrapper = Some(WrapperType::init(
                &ssl_options,
                is_client,
                ssl_wrapper::Handlers {
                    ctx: self as *mut _,
                    on_open: Self::ssl_on_open,
                    on_handshake: Self::ssl_on_handshake,
                    on_data: Self::ssl_on_data,
                    on_close: Self::ssl_on_close,
                    write: Self::ssl_write,
                },
            )?);

            self.wrapper.as_mut().unwrap().start();
        }
        Ok(())
    }

    pub fn start(&mut self, is_client: bool) -> bool {
        self.flags.set_is_client(is_client);
        #[cfg(windows)]
        {
            if self.pipe.is_none() {
                return false;
            }
            let _ = self.pipe.as_mut().unwrap().unref();
            self.writer.set_parent(self);
            // TODO(port): start_with_pipe takes the pipe pointer; Box<uv::Pipe> must yield a stable *mut uv::Pipe.
            let start_pipe_result = self
                .writer
                .start_with_pipe(self.pipe.as_mut().unwrap().as_mut() as *mut uv::Pipe);
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

            let read_start_result = stream.read_start(
                self,
                Self::on_read_alloc,
                Self::on_read_error,
                Self::on_read,
            );
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
    pub unsafe fn loop_(&self) -> &mut AsyncLoop {
        // SAFETY: see fn-level safety comment — process-wide libuv loop, caller
        // promises no aliasing `&mut`.
        unsafe { &mut *self.vm.uv_loop() }
    }

    pub fn encode_and_write(&mut self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(WindowsNamedPipe, "encodeAndWrite (len: {})", data.len());
        if let Some(wrapper) = self.wrapper.as_mut() {
            return i32::try_from(wrapper.write_data(data).unwrap_or(0)).expect("int cast");
        } else {
            self.internal_write(data);
        }
        i32::try_from(data.len()).expect("int cast")
    }

    pub fn raw_write(&mut self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).expect("int cast")
    }

    pub fn close(&mut self) {
        if let Some(wrapper) = self.wrapper.as_mut() {
            let _ = wrapper.shutdown(false);
        }
        self.writer.end();
    }

    pub fn shutdown(&mut self) {
        if let Some(wrapper) = self.wrapper.as_mut() {
            let _ = wrapper.shutdown(false);
        }
    }

    pub fn shutdown_read(&mut self) {
        if let Some(wrapper) = self.wrapper.as_mut() {
            let _ = wrapper.shutdown_read();
        } else {
            #[cfg(windows)]
            if let Some(stream) = self.writer.get_stream() {
                let _ = stream.read_stop();
            }
        }
    }

    pub fn is_shutdown(&self) -> bool {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.is_shutdown();
        }

        self.flags.disconnected() || self.writer.is_done
    }

    pub fn is_closed(&self) -> bool {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.is_closed();
        }
        self.flags.disconnected()
    }

    pub fn is_established(&self) -> bool {
        !self.is_closed()
    }

    pub fn ssl(&self) -> Option<*mut boringssl::SSL> {
        if let Some(wrapper) = &self.wrapper {
            return wrapper.ssl.map(|p| p.as_ptr());
        }
        None
    }

    pub fn ssl_error(&self) -> us_bun_verify_error_t {
        us_bun_verify_error_t {
            error_no: self.ssl_error.error_no,
            // CertError.code/.reason are owned `Box<CStr>`s; fall back to "" when absent.
            code: self
                .ssl_error
                .code
                .as_deref()
                .map_or(b"\0".as_ptr().cast(), |c| c.as_ptr()),
            reason: self
                .ssl_error
                .reason
                .as_deref()
                .map_or(b"\0".as_ptr().cast(), |c| c.as_ptr()),
        }
    }

    pub fn reset_timeout(&mut self) {
        self.set_timeout_in_milliseconds(self.current_timeout);
    }

    pub fn set_timeout_in_milliseconds(&mut self, ms: c_uint) {
        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            timer_all().remove(&mut self.event_loop_timer);
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
        self.event_loop_timer.next = ElTimespec { sec: next.sec, nsec: next.nsec };
        timer_all().insert(&mut self.event_loop_timer);
    }

    pub fn set_timeout(&mut self, seconds: c_uint) {
        bun_output::scoped_log!(WindowsNamedPipe, "setTimeout({})", seconds);
        self.set_timeout_in_milliseconds(seconds * 1000);
    }

    /// Free internal resources, it can be called multiple times.
    // PORT NOTE: Zig `pub fn deinit` → private idempotent helper invoked from on_close and Drop.
    // Owned fields (writer, wrapper, ssl_error) free themselves via their own Drop impls; only
    // the side effects (timer cancel, read_stop, take()) remain explicit here.
    fn release_resources(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "deinit");
        // clear the timer
        self.set_timeout(0);
        #[cfg(windows)]
        if let Some(stream) = self.writer.get_stream() {
            let _ = stream.read_stop();
        }
        self.wrapper = None;
        self.ssl_error = CertError::default();
    }
}

impl Drop for WindowsNamedPipe {
    fn drop(&mut self) {
        self.release_resources();
    }
}

// `StreamingWriter<P>` resolves to `PosixStreamingWriter<P>` on non-Windows
// targets, which carries a `P: PosixStreamingWriterParent` bound. This type is
// Windows-only at runtime, but the struct field still needs to type-check on
// POSIX, so provide the trait impl forwarding to the same handlers the Zig
// `StreamingWriter(WindowsNamedPipe, .{ onClose, onWritable, onError, onWrite })`
// binds.
#[cfg(unix)]
impl bun_io::pipe_writer::PosixStreamingWriterParent for WindowsNamedPipe {
    // Never registered as a `FilePoll` owner on POSIX (Windows-only at
    // runtime); the impl exists purely so the `StreamingWriter<Self>` field
    // type-checks. NULL keeps the dispatch table from being silently wrong if
    // a poll is ever (incorrectly) created.
    const POLL_OWNER_TAG: u8 = bun_aio::posix_event_loop::poll_tag::NULL;
    const HAS_ON_READY: bool = true;
    unsafe fn on_write(this: *mut Self, amount: usize, status: WriteStatus) {
        // SAFETY: `this` is the BACKREF set via `set_parent`; unique for the
        // callback's duration (StreamingWriter never holds `&mut Parent`).
        WindowsNamedPipe::on_write(unsafe { &mut *this }, amount, status)
    }
    unsafe fn on_error(this: *mut Self, err: bun_sys::Error) {
        // SAFETY: see on_write.
        WindowsNamedPipe::on_error(unsafe { &mut *this }, err)
    }
    unsafe fn on_ready(this: *mut Self) {
        // Zig `.onWritable` slot.
        // SAFETY: see on_write.
        WindowsNamedPipe::on_writable(unsafe { &mut *this })
    }
    unsafe fn on_close(this: *mut Self) {
        // SAFETY: see on_write.
        WindowsNamedPipe::on_close(unsafe { &mut *this })
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // SAFETY: see on_write. Shared-only read of `vm`.
        // CYCLEBREAK: opaque `*mut c_void` round-tripped through io-layer vtable.
        bun_io::EventLoopHandle(unsafe { (*this).vm.event_loop() } as *mut c_void)
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_uws_sys::Loop {
        // SAFETY: see on_write. Shared-only read of `vm`.
        unsafe { (*this).vm.uws_loop().cast() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/WindowsNamedPipe.zig (614 lines)
//   confidence: medium
//   todos:      0
//   notes:      Windows-only; StreamingWriter callback binding + SslWrapper::Handlers shape modeled via trait/trampolines; on_connect's `defer deref()` reshaped to explicit calls; vm.timer resolved via runtime_state() (b2-cycle); deinit→Drop via private release_resources().
// ──────────────────────────────────────────────────────────────────────────
