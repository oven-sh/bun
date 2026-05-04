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

use bun_aio::Loop as AsyncLoop;
use bun_boringssl_sys as boringssl;
use bun_collections::BabyList;
use bun_core::timespec;
use bun_io::{StreamingWriter, WriteStatus};
use bun_jsc::VirtualMachine;
use bun_sys::windows::libuv as uv;
use bun_sys::{self, Fd};
use bun_uws::UpgradedDuplex;
use bun_uws_sys::us_bun_verify_error_t;

use crate::api::timer::EventLoopTimer;
// TODO(port): verify path — `bun.jsc.API.ServerConfig.SSLConfig` lives under src/runtime/api/server/
use crate::api::server_config::SslConfig;
use crate::socket::ssl_wrapper::SslWrapper;

bun_output::declare_scope!(WindowsNamedPipe, visible);

pub type CertError = <UpgradedDuplex as UpgradedDuplexCertError>::CertError;
// TODO(port): Zig `pub const CertError = UpgradedDuplex.CertError;` — assumes UpgradedDuplex re-exports CertError as an associated type/alias.
// Phase B: replace the trait-projection above with the concrete `bun_uws::upgraded_duplex::CertError` path once ported.
#[doc(hidden)]
pub trait UpgradedDuplexCertError {
    type CertError;
}

type WrapperType = SslWrapper<*mut WindowsNamedPipe>;

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

    pub incoming: BabyList<u8>, // Maybe we should use IPCBuffer here as well
    pub ssl_error: CertError,
    pub handlers: Handlers,
    pub connect_req: uv::uv_connect_t,

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
        let mut available = self.incoming.unused_capacity_slice();
        if available.len() < suggested_size {
            // PORT NOTE: reshaped for borrowck — drop borrow before mut call
            drop(available);
            self.incoming
                .ensure_unused_capacity(suggested_size)
                .unwrap_or_oom();
            available = self.incoming.unused_capacity_slice();
        }
        // SAFETY: `available` is the unused-capacity tail of `incoming`; slicing to
        // `suggested_size` is in-bounds because we just ensured at least that much.
        unsafe { core::slice::from_raw_parts_mut(available.as_mut_ptr(), suggested_size) }
    }

    fn on_read(&mut self, buffer: &[u8]) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", buffer.len());
        self.incoming.len += buffer.len() as u32;
        debug_assert!(self.incoming.len <= self.incoming.cap);
        debug_assert!(bun_core::is_slice_in_buffer(
            buffer,
            self.incoming.allocated_slice()
        ));

        let data = self.incoming.slice();

        self.reset_timeout();

        if let Some(wrapper) = self.wrapper.as_mut() {
            // PORT NOTE: reshaped for borrowck — `data` borrows self.incoming while wrapper borrows self.wrapper
            // TODO(port): verify no aliasing between wrapper.receiveData and self.incoming
            wrapper.receive_data(data);
        } else {
            (self.handlers.on_data)(self.handlers.ctx, data);
        }
        self.incoming.len = 0;
    }

    fn on_write(&mut self, amount: usize, status: WriteStatus) {
        bun_output::scoped_log!(WindowsNamedPipe, "onWrite {} {:?}", amount, status);

        match status {
            WriteStatus::Pending => {}
            WriteStatus::Drained => {
                // unref after sending all data
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
        if err == bun_sys::E::EOF {
            // we received FIN but we dont allow half-closed connections right now
            (self.handlers.on_end)(self.handlers.ctx);
        } else {
            self.on_error(bun_sys::Error::from_code(err, bun_sys::Syscall::Read));
        }
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

    fn on_handshake(&mut self, handshake_success: bool, ssl_error: us_bun_verify_error_t) {
        bun_output::scoped_log!(WindowsNamedPipe, "onHandshake");

        self.ssl_error = CertError {
            error_no: ssl_error.error_no,
            code: if ssl_error.code.is_null() || ssl_error.error_no == 0 {
                bun_str::ZStr::empty()
            } else {
                // SAFETY: code is a NUL-terminated C string from BoringSSL when non-null
                let s = unsafe { core::ffi::CStr::from_ptr(ssl_error.code) }.to_bytes();
                bun_str::ZStr::from_bytes(s)
            },
            reason: if ssl_error.reason.is_null() || ssl_error.error_no == 0 {
                bun_str::ZStr::empty()
            } else {
                // SAFETY: reason is a NUL-terminated C string from BoringSSL when non-null
                let s = unsafe { core::ffi::CStr::from_ptr(ssl_error.reason) }.to_bytes();
                bun_str::ZStr::from_bytes(s)
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
                if let Some(source) = self.writer.source.as_ref() {
                    source.pipe.r#ref();
                }
                if self.flags.disconnected() {
                    // enqueue to be sent after connecting
                    self.writer.outgoing.write(bytes).unwrap_or_oom();
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

        let has_been_cleared = self.event_loop_timer.state == EventLoopTimer::State::CANCELLED
            || self.vm.script_execution_status() != bun_jsc::ScriptExecutionStatus::Running;

        self.event_loop_timer.state = EventLoopTimer::State::FIRED;
        self.event_loop_timer.heap = Default::default();

        if has_been_cleared {
            return;
        }

        (self.handlers.on_timeout)(self.handlers.ctx);
    }

    pub fn from(
        pipe: Box<uv::Pipe>,
        handlers: Handlers,
        vm: &'static VirtualMachine,
    ) -> WindowsNamedPipe {
        #[cfg(unix)]
        {
            compile_error!("WindowsNamedPipe is not supported on POSIX systems");
        }
        WindowsNamedPipe {
            vm,
            #[cfg(windows)]
            pipe: Some(pipe),
            #[cfg(not(windows))]
            pipe: (),
            wrapper: None,
            handlers,
            // defaults:
            writer: StreamingWriter::default(),
            incoming: BabyList::default(),
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

    fn on_connect(&mut self, status: uv::ReturnCode) {
        // PORT NOTE: reshaped — Zig `defer this.deref()` cannot be a scopeguard here (would need
        // to capture &mut self alongside body uses). Call deref() explicitly at each return.

        #[cfg(windows)]
        if let Some(pipe) = self.pipe.as_mut() {
            let _ = pipe.unref();
        }

        if let Some(err) = status.to_error(bun_sys::Syscall::Connect) {
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
            self.wrapper = match WrapperType::init_with_ctx(
                tls,
                false,
                WrapperType::Handlers {
                    ctx: self as *mut _,
                    on_open: Self::on_open,
                    on_handshake: Self::on_handshake,
                    on_data: Self::on_data,
                    on_close: Self::on_close,
                    write: Self::internal_write,
                },
            ) {
                Ok(w) => Some(w),
                Err(_) => {
                    return bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::PIPE as _,
                        syscall: bun_sys::Syscall::Connect,
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

    pub fn open(
        &mut self,
        fd: Fd,
        ssl_options: Option<SslConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        #[cfg(windows)]
        debug_assert!(self.pipe.is_some());
        self.flags.set_disconnected(true);

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                return result;
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

            let open_result = self.pipe.as_mut().unwrap().open(fd);
            if open_result.is_err() {
                return open_result;
            }
        }

        self.r#ref();
        Self::on_connect(self, uv::ReturnCode::ZERO);
        bun_sys::Result::Ok(())
    }

    pub fn connect(
        &mut self,
        path: &[u8],
        ssl_options: Option<SslConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> bun_sys::Result<()> {
        #[cfg(windows)]
        debug_assert!(self.pipe.is_some());
        self.flags.set_disconnected(true);
        // ref because we are connecting
        #[cfg(windows)]
        {
            let _ = self.pipe.as_mut().unwrap().r#ref();
        }

        if let Some(result) = self.init_tls_wrapper(ssl_options, owned_ctx) {
            if result.is_err() {
                return result;
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
            return result;
        }
        #[cfg(not(windows))]
        {
            let _ = path;
            bun_sys::Result::Ok(())
        }
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
        ssl_options: Option<SslConfig>,
        owned_ctx: Option<*mut boringssl::SSL_CTX>,
    ) -> Option<bun_sys::Result<()>> {
        let handlers = WrapperType::Handlers {
            ctx: self as *mut _,
            on_open: Self::on_open,
            on_handshake: Self::on_handshake,
            on_data: Self::on_data,
            on_close: Self::on_close,
            write: Self::internal_write,
        };
        if let Some(ctx) = owned_ctx {
            self.flags.set_is_ssl(true);
            self.wrapper = match WrapperType::init_with_ctx(ctx, true, handlers) {
                Ok(w) => Some(w),
                Err(_) => {
                    // SAFETY: ctx is a valid SSL_CTX* with one adopted ref
                    unsafe { boringssl::SSL_CTX_free(ctx) };
                    return Some(bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::PIPE as _,
                        syscall: bun_sys::Syscall::Connect,
                        ..Default::default()
                    }));
                }
            };
            return Some(bun_sys::Result::Ok(()));
        }
        if let Some(tls) = ssl_options {
            self.flags.set_is_ssl(true);
            self.wrapper = match WrapperType::init(tls, true, handlers) {
                Ok(w) => Some(w),
                Err(_) => {
                    return Some(bun_sys::Result::Err(bun_sys::Error {
                        errno: bun_sys::E::PIPE as _,
                        syscall: bun_sys::Syscall::Connect,
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
        ssl_options: SslConfig,
        is_client: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.flags.set_is_ssl(true);
        if self.start(is_client) {
            self.wrapper = Some(WrapperType::init(
                ssl_options,
                is_client,
                WrapperType::Handlers {
                    ctx: self as *mut _,
                    on_open: Self::on_open,
                    on_handshake: Self::on_handshake,
                    on_data: Self::on_data,
                    on_close: Self::on_close,
                    write: Self::internal_write,
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
                    bun_sys::Syscall::Read,
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

    pub fn loop_(&self) -> &mut AsyncLoop {
        self.vm.uv_loop()
    }

    pub fn encode_and_write(&mut self, data: &[u8]) -> i32 {
        bun_output::scoped_log!(WindowsNamedPipe, "encodeAndWrite (len: {})", data.len());
        if let Some(wrapper) = self.wrapper.as_mut() {
            return i32::try_from(wrapper.write_data(data).unwrap_or(0)).unwrap();
        } else {
            self.internal_write(data);
        }
        i32::try_from(data.len()).unwrap()
    }

    pub fn raw_write(&mut self, encoded_data: &[u8]) -> i32 {
        self.internal_write(encoded_data);
        i32::try_from(encoded_data.len()).unwrap()
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
            return Some(wrapper.ssl);
        }
        None
    }

    pub fn ssl_error(&self) -> us_bun_verify_error_t {
        us_bun_verify_error_t {
            error_no: self.ssl_error.error_no,
            // SAFETY: CertError.code/.reason are NUL-terminated owned slices; ptr cast to *const c_char
            code: self.ssl_error.code.as_ptr().cast(),
            reason: self.ssl_error.reason.as_ptr().cast(),
        }
    }

    pub fn reset_timeout(&mut self) {
        self.set_timeout_in_milliseconds(self.current_timeout);
    }

    pub fn set_timeout_in_milliseconds(&mut self, ms: c_uint) {
        if self.event_loop_timer.state == EventLoopTimer::State::ACTIVE {
            self.vm.timer.remove(&mut self.event_loop_timer);
        }
        self.current_timeout = ms;

        // if the interval is 0 means that we stop the timer
        if ms == 0 {
            return;
        }

        // reschedule the timer
        self.event_loop_timer.next = timespec::ms_from_now(timespec::Mock::AllowMockedTime, ms);
        self.vm.timer.insert(&mut self.event_loop_timer);
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/WindowsNamedPipe.zig (614 lines)
//   confidence: medium
//   todos:      7
//   notes:      Windows-only; StreamingWriter callback binding + SslWrapper::Handlers shape need Phase-B trait modeling; on_connect's `defer deref()` reshaped to explicit calls; vm field uses &'static pending lifetime audit; deinit→Drop via private release_resources().
// ──────────────────────────────────────────────────────────────────────────
