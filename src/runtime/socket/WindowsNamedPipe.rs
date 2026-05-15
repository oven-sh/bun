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

use core::ffi::{CStr, c_uint, c_void};
use core::ptr::NonNull;

use bun_boringssl_sys as boringssl;
use bun_collections::{ByteVecExt, VecExt};
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
use crate::timer::{ElTimespec, EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

bun_output::declare_scope!(WindowsNamedPipe, visible);

// Zig `pub const CertError = UpgradedDuplex.CertError;`
pub type CertError = crate::socket::upgraded_duplex::CertError;

type WrapperType = SSLWrapper<*mut WindowsNamedPipe>;

use crate::jsc_hooks::timer_all_mut as timer_all;

pub struct WindowsNamedPipe {
    pub wrapper: Option<WrapperType>,
    /// Non-owning alias of the heap `uv::Pipe` (Zig: `?*uv.Pipe`). The owning
    /// `Box<uv::Pipe>` is leaked in [`from`] and adopted by
    /// `self.writer.source` (`Source::Pipe`) inside [`start`]; this field only
    /// ever observes/null-checks the handle, never frees it.
    #[cfg(windows)]
    pub pipe: Option<NonNull<uv::Pipe>>, // any duplex
    #[cfg(not(windows))]
    pub pipe: (),
    // TODO(port): lifetime — JSC_BORROW; VM outlives this struct. Using &'static for Phase A;
    // create a timeout version that doesn't need the jsc VM
    pub vm: &'static VirtualMachine,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub event_loop_handle: bun_jsc::EventLoopHandle,

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

bun_event_loop::impl_timer_owner!(WindowsNamedPipe; from_timer_ptr => event_loop_timer);

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const DISCONNECTED = 1 << 0;
        const IS_CLOSED    = 1 << 1;
        const IS_CLIENT    = 1 << 2;
        const IS_SSL       = 1 << 3;
        /// Rust-only bookkeeping: set once `start_with_pipe` adopts the
        /// `Box<uv::Pipe>` leaked in [`from`]. Lets `Drop` reclaim the orphan
        /// allocation on early-error paths (before adoption) without risking a
        /// double-free once the writer owns it.
        const PIPE_ADOPTED = 1 << 4;
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

    /// Dereference the non-owning [`pipe`](Self::pipe) alias.
    ///
    /// The heap `uv::Pipe` is owned by `self.writer.source` once [`start`]
    /// adopts it (before adoption it is the leaked `Box` from [`from`]).
    /// Single JS thread; the writer never holds a competing `&mut uv::Pipe`
    /// across a call into this struct, so the borrow is exclusive for its
    /// duration. FFI-adjacent: this is the libuv-handle raw-pointer deref the
    /// Zig `this.pipe.?` does implicitly.
    #[cfg(windows)]
    #[inline]
    fn pipe_mut(&mut self) -> Option<&mut uv::Pipe> {
        // SAFETY: see doc comment — non-owning libuv-handle alias, single JS
        // thread, no overlapping `&mut uv::Pipe` from the writer for the
        // returned borrow's duration.
        self.pipe.map(|p| unsafe { &mut *p.as_ptr() })
    }

    /// Reclaim the leaked `Box<uv::Pipe>` on an early-error path **before**
    /// [`start`] hands it to `self.writer.source` via `start_with_pipe`.
    ///
    /// [`from`] `Box::leak`s the allocation and records only a non-owning
    /// `NonNull` in `self.pipe`; until adoption the writer's `Drop`
    /// (`close_without_reporting`) is a no-op (`source == None`), so any
    /// `connect`/`open`/`get_accepted_by` early return would leak the box and —
    /// if `uv_pipe_init` had already run — leave the handle in the libuv
    /// `handle_queue` with no `uv_close` ever scheduled (loop never drains).
    /// `close_and_destroy` covers both states via its `loop_.is_null()` branch.
    ///
    /// PORT NOTE: the Zig spec has the same gap (WindowsNamedPipe.zig
    /// L334-401); this is a deliberate divergence to plug a pre-existing leak,
    /// not a transcription mismatch.
    ///
    /// MUST NOT be called once `start_with_pipe` has adopted the allocation
    /// (would double-free against `writer.source`'s `Box`).
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

    fn on_pipe_close(&mut self) {
        bun_output::scoped_log!(WindowsNamedPipe, "onPipeClose");
        self.flags.set_disconnected(true);
        #[cfg(windows)]
        {
            // Non-owning `NonNull` — clearing it does NOT free. The writer's
            // `Source::Pipe(Box)` is the sole owner and frees via
            // `close_and_destroy` (Zig: `this.pipe = null` is a raw-ptr null-out).
            self.pipe = None;
        }
        self.on_close();
    }

    fn on_read_alloc(&mut self, suggested_size: usize) -> &mut [u8] {
        // SAFETY: libuv writes into this region before on_read commits.
        let spare = unsafe { self.incoming.uv_alloc_spare_u8(suggested_size) };
        &mut spare[..suggested_size]
    }

    // PORT NOTE: takes `nread` (not the libuv `buffer` slice) because that
    // slice points *into* `self.incoming` — see `StreamReader::on_read` below
    // for the Stacked-Borrows split. The Zig `is_slice_in_buffer` debug assert
    // is dropped: libuv guarantees the read buffer is the one returned from
    // `on_read_alloc`, and we no longer hold the original pointer here.
    fn on_read(&mut self, nread: usize) {
        bun_output::scoped_log!(WindowsNamedPipe, "onRead ({})", nread);
        // SAFETY: `nread` bytes written by libuv into on_read_alloc's slice.
        unsafe { self.incoming.uv_commit(nread) };

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
        // The Zig original aliases freely (`wrapper.receiveData(data)` while
        // `data` points into `this.incoming`); Rust needs the explicit detach.
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
        unsafe { (*this).on_open() }
    }
    fn ssl_on_handshake(this: *mut Self, ok: bool, e: us_bun_verify_error_t) {
        unsafe { (*this).on_handshake(ok, e) }
    }
    fn ssl_on_data(this: *mut Self, d: &[u8]) {
        unsafe { (*this).on_data(d) }
    }
    fn ssl_on_close(this: *mut Self) {
        unsafe { (*this).on_close() }
    }
    fn ssl_write(this: *mut Self, d: &[u8]) {
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
            // PORT NOTE: `self.pipe` is a non-owning `NonNull` alias of the
            // `Box<uv::Pipe>` owned by `writer.source`. By the time the writer
            // invokes this `on_close` hook it has already `take()`n that Box and
            // scheduled `uv_close` → `Box::from_raw` on it (PipeWriter::close),
            // so the alias is about to dangle. Clear it here so later
            // `pipe_mut()` callers (e.g. `pause_stream` exported to JS) observe
            // `None` instead of a freed pointer. The Zig spec's `onPipeClose`
            // (which would null `this.pipe`) is dead code there too — the
            // writer's `.onClose` slot is wired to `onClose`, not `onPipeClose`.
            self.pipe = None;
        }
        if !self.flags.is_closed() {
            self.flags.set_is_closed(true); // only call onClose once
            // Drop the non-owning alias now: the writer's `close()` has
            // already handed the Box off to libuv's async close callback (or
            // will), so any later `pause_stream()` would deref freed memory.
            // (Zig leaves `this.pipe` dangling here — its `onPipeClose` is
            // dead code; we diverge to avoid the latent UAF.)
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

    fn on_internal_receive_data(&mut self, data: &[u8]) {
        // PORT NOTE: reshaped for borrowck — reset_timeout borrows self mutably, so guard on
        // is_some() first, call reset_timeout(), then re-borrow wrapper.
        if self.wrapper.is_some() {
            self.reset_timeout();
            // Same re-entrancy hazard as `on_read`: `receive_data` may fire
            // `ssl_on_close` synchronously. Hold `WRAPPER_BUSY` so
            // `release_resources()` defers `self.wrapper = None`, and call
            // through a raw pointer so no outer `&mut self.wrapper` Unique tag
            // is live across the re-entrant `&mut *this` retag.
            // `reset_timeout` cannot clear `wrapper`, so still `Some`.
            let w: *mut WrapperType = self.wrapper_ptr().unwrap();
            // Re-entrancy: see `on_read` — only the OUTERMOST scope may clear
            // the flag / run the deferred-drop epilogue.
            let was_busy = self.flags.contains(Flags::WRAPPER_BUSY);
            self.flags.insert(Flags::WRAPPER_BUSY);
            // SAFETY: see `on_read` — `WRAPPER_BUSY` keeps the `Some` payload
            // bytes at `*w` valid and un-overwritten for the call's duration.
            unsafe { (*w).receive_data(data) };
            if !was_busy {
                self.flags.remove(Flags::WRAPPER_BUSY);
                if self.flags.is_closed() {
                    self.wrapper = None;
                }
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
            event_loop_handle: bun_jsc::EventLoopHandle::init(vm.event_loop().cast::<()>()),
            // Leak the `Box` and keep only a non-owning `NonNull` alias (Zig:
            // `?*uv.Pipe`). Ownership of the allocation is later transferred to
            // `self.writer.source` via `start_with_pipe` in `start()`, which
            // re-materialises the `Box` and is responsible for freeing it.
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

    /// `extern "C"` trampoline matching `uv_connect_cb` (`Pipe::connect`'s
    /// `on_connect` parameter). Recovers `*mut Self` from `req->data` (set in
    /// `connect()`) and forwards to the safe `&mut self` body. Only ever
    /// invoked by libuv (coerces to the `uv_connect_cb` fn-pointer type at the
    /// `Pipe::connect` call site); body wraps its derefs explicitly.
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
            // PORT NOTE: divergence from Zig spec — on async connect failure the
            // leaked `Box<uv::Pipe>` was never adopted by `writer.source`
            // (`start_with_pipe` only runs on the success branch below), so
            // `on_error → close → writer.end()` is a no-op for it. Reclaim it
            // here via `discard_unadopted_pipe` (which schedules `uv_close` and
            // `Box::from_raw`s in the callback), mirroring the synchronous
            // early-error paths in `connect`/`open`/`get_accepted_by`. The Zig
            // original leaks the init'd `uv_pipe_t` in this path.
            self.discard_unadopted_pipe();
            self.on_error(err);
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
            // ffi-safe-fn: opaque-ZST `&SSL_CTX` redecl; `tls_nn` proven
            // non-null above (`NonNull::new(tls).expect(..)`).
            let _ = super::tls_socket_functions::ffi::SSL_CTX_up_ref(
                boringssl::SSL_CTX::opaque_ref(tls_nn.as_ptr()),
            );
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

        // BORROW_PARAM: `connect()` takes `&mut self.connect_req`, a `*mut c_void`
        // context, and `&mut self.pipe` simultaneously (Zig: all `*T` alias freely).
        // Derive `ctx` first via `addr_of_mut!` (no intermediate `&mut Self` retag),
        // then project `req`/`pipe` *from `ctx`* so all three share one provenance
        // root — taking `&mut self.connect_req` followed by `self as *mut Self`
        // would pop `req`'s tag under Stacked Borrows. libuv only *stores* `ctx`
        // here (no deref), so the brief field-level Unique borrows below don't
        // invalidate the bytes the callback later reads.
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
        ssl_options: SSLConfig,
        is_client: bool,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.flags.set_is_ssl(true);
        if self.start(is_client) {
            self.wrapper = Some(ssl_wrapper::init(
                &ssl_options,
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
            // nothing clears that alias when the writer frees the Box (the
            // `on_pipe_close` method above is dead code, matching Zig) — so
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
    pub unsafe fn loop_(&self) -> &mut AsyncLoop {
        // SAFETY: see fn-level safety comment — process-wide libuv loop, caller
        // promises no aliasing `&mut`.
        unsafe { &mut *self.vm.uv_loop() }
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
            let was_busy = unsafe { (*this).flags.contains(Flags::WRAPPER_BUSY) };
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
                if unsafe { (*this).flags.is_closed() } {
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
            let was_busy = unsafe { (*this).flags.contains(Flags::WRAPPER_BUSY) };
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
                if unsafe { (*this).flags.is_closed() } {
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
            // SAFETY: `stream` is the live pipe stream; `uv_read_stop` always
            // succeeds and is a no-op if not reading.
            unsafe { (*stream).read_stop() };
        }
        // Zig: `this.writer.deinit()` → `closeWithoutReporting(); outgoing.deinit();
        // current_payload.deinit();`. The earlier port skipped
        // `closeWithoutReporting()` on the assumption that "the source is already
        // closed by the time on_close reaches here (that close is what fired the
        // callback)" — true ONLY for the writer-initiated close path
        // (`WindowsStreamingWriterParent::on_close`). It is FALSE when we arrive
        // via `ssl_on_close` (TLS close_notify): the underlying `uv_pipe_t` is
        // still open and in libuv's handle_queue, so without an explicit close
        // here the HANDLE outlives Zig's by ≥ one event-loop tick (until the
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
            if self.writer.get_fd() != Fd::INVALID {
                debug_assert!(!self.writer.closed_without_reporting);
                self.writer.closed_without_reporting = true;
                self.writer.close();
            }
            self.writer.outgoing = Default::default();
        }
        // `receive_data → handle_traffic → trigger_close_callback` can land
        // here while a raw `*mut WrapperType` into `self.wrapper`'s payload is
        // still mid-execution (see `on_read`/`on_internal_receive_data`).
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
        // Reclaim the `Box<uv::Pipe>` leaked in `from()` if it was never
        // adopted by `self.writer.source` (early-error returns from
        // `connect`/`open`/`get_accepted_by` before `start()` runs). Once
        // `PIPE_ADOPTED` is set the writer is the sole owner and frees via
        // its libuv close callback — touching it here would double-free.
        // `close_and_destroy` handles both un-adopted states: if `pipe.init()`
        // never ran (`loop_` still null) it just `Box::from_raw`-drops the
        // allocation; if init() DID run before the later open/accept/connect
        // failure it `uv_close`s first so the handle is unlinked from libuv's
        // `handle_queue` before the heap block is freed.
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
        // Zig: `ReturnCodeI64.init(nreads).errEnum() orelse .CANCELED` — but
        // `errEnum()` returns `null` ONLY for non-negative values, and the
        // trampoline only reaches this arm when `nreads < 0`, so the `orelse`
        // is dead in spec. For any negative code `translateUVErrorToE` already
        // yields a concrete `E` (falling back to `UNKNOWN` for unmapped
        // codes). Pass it straight through; do NOT remap UNKNOWN→CANCELED.
        let e = bun_sys::windows::translate_uv_error_to_e(err);
        WindowsNamedPipe::on_read_error(this, e);
    }
    #[inline]
    unsafe fn on_read(this: *mut Self, data: &[u8]) {
        // `data` points into `(*this).incoming` (it was returned from
        // `on_read_alloc`). Forming `&mut *this` would retag every byte of
        // `*this` Unique and pop the SharedRW tag `data` descends from — UB
        // under Stacked Borrows. Capture the only thing the body needs (length),
        // drop the slice, *then* reborrow `*this`.
        let nread = data.len();
        let _ = data;
        // SAFETY: `this` is the live context stashed in `handle.data` by
        // `read_start_ctx`; `data` is no longer live so the Unique retag is sound.
        WindowsNamedPipe::on_read(unsafe { &mut *this }, nread);
    }
}

// ported from: src/runtime/socket/WindowsNamedPipe.zig
