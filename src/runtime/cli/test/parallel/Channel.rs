//! Bidirectional IPC channel for `bun test --parallel`. Reads are
//! frame-decoded in the loop's data callback; writes go through the platform
//! socket/pipe with backpressure buffered and drained via the loop, so a full
//! kernel buffer never truncates a frame. The owner type provides
//! `on_channel_frame(kind, &mut Frame::Reader)` and `on_channel_done()`.
//!
//! POSIX backend: `uws::NewSocketHandler` adopted from a socketpair fd.
//! Windows backend: `uv::Pipe` over the inherited duplex named-pipe end (same
//! mechanism as `Bun.spawn({ipc})` / `process.send()`).
//!
//! Lifetime: a `Channel` is embedded as a field in an owner that outlives all
//! uv/usockets callbacks (the coordinator's `Worker[]`, or the worker's
//! `WorkerLoop` which lives for the process). The owner is recovered via
//! `container_of` (field offset) so the channel default-inits without a
//! self-pointer. `Drop` assumes no write is in flight — true for both call
//! sites (start() errdefer and reap_worker after the peer has exited).

use core::ffi::c_void;
use core::marker::PhantomData;
use core::mem::offset_of;

use bun_collections::VecExt;
use bun_core::Output;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::{Fd, FdExt as _};
use bun_uws as uws;

#[cfg(windows)]
use bun_libuv_sys::{UvHandle as _, UvStream as _};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

use super::frame;

/// The Zig version is `fn Channel(comptime Owner: type, comptime owner_field:
/// []const u8) type`. Rust cannot take a field-name string as a const generic,
/// so the owner instead implements [`bun_core::IntrusiveField<Channel<Self>>`]
/// (via `bun_core::intrusive_field!`) plus the two callbacks the Zig called
/// as `owner().onChannelFrame` / `onChannelDone`.
pub trait ChannelOwner: bun_core::IntrusiveField<Channel<Self>> {
    fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>);
    fn on_channel_done(&mut self);
}

// PORT NOTE: the struct itself carries no `ChannelOwner` bound so that owners
// (Worker, WorkerCommands) can embed `Channel<Self>` as a field before their
// `impl ChannelOwner` is in scope. Method impls that recover the owner via
// `IntrusiveField::OFFSET` keep the bound. (Rust also forbids a stricter bound
// on `Drop` than on the struct, so Drop/Default below are unbounded too.)
pub struct Channel<Owner> {
    /// Incoming bytes that don't yet form a complete frame.
    // PORT NOTE: Zig field name is `in`, a Rust keyword — kept via raw ident
    // so the .zig ↔ .rs diff stays aligned.
    pub r#in: Vec<u8>,
    /// Outgoing bytes the kernel didn't accept yet.
    pub out: Vec<u8>,
    pub done: bool,

    pub backend: Backend,

    _owner: PhantomData<*mut Owner>,
}

#[cfg(windows)]
pub type Backend = WindowsBackend;
#[cfg(not(windows))]
pub type Backend = PosixBackend;

impl<Owner> Default for Channel<Owner> {
    fn default() -> Self {
        Self {
            r#in: Vec::new(),
            out: Vec::new(),
            done: false,
            backend: Backend::default(),
            _owner: PhantomData,
        }
    }
}

impl<Owner: ChannelOwner> Channel<Owner> {
    #[inline]
    fn owner(&mut self) -> &mut Owner {
        // SAFETY: `self` is always embedded at `Owner::OFFSET` inside an
        // `Owner` that outlives all callbacks (see module doc). Mirrors Zig
        // `@alignCast(@fieldParentPtr(owner_field, self))`.
        unsafe { &mut *Owner::from_field_ptr(std::ptr::from_mut(self)) }
    }
}

// -- POSIX (usockets) --------------------------------------------------------

#[cfg(not(windows))]
pub type Socket = uws::NewSocketHandler<false>;
#[cfg(windows)]
pub type Socket = ();

pub struct PosixBackend {
    pub socket: Socket,
}

#[cfg(not(windows))]
impl Default for PosixBackend {
    fn default() -> Self {
        Self {
            socket: Socket::DETACHED,
        }
    }
}

#[cfg(not(windows))]
impl<Owner: ChannelOwner> Channel<Owner> {
    /// Shared embedded group for this channel. Uses `.dynamic` kind +
    /// per-Owner vtable because the test-parallel channel is an internal-only
    /// one-off whose ext type (`*mut Self`) varies by Owner — not worth a
    /// `SocketKind` value of its own. The per-file isolation swap skips
    /// `rare.test_parallel_ipc_group` so the coordinator link survives.
    fn ensure_posix_group(vm: &mut VirtualMachine) -> &mut uws::SocketGroup {
        // PORT NOTE: borrowck split — `rare_data()` mutably borrows `vm`, but
        // the group accessor needs `vm` again for `uws_loop()`. The two touch
        // disjoint storage (the `Box<RareData>` payload vs the loop pointer
        // field), so a raw-pointer reborrow is sound here. Mirrors Zig's
        // `vm.rareData().testParallelIpcGroup(vm)` which has no such aliasing
        // restriction.
        let rd: *mut bun_jsc::rare_data::RareData = vm.rare_data();
        // SAFETY: `rd` points into `vm`'s boxed RareData, which outlives this
        // call; the accessor only reads `vm.uws_loop()` (a separate field).
        let g = unsafe { (*rd).test_parallel_ipc_group(vm) };
        // First Owner to call wins the vtable; coordinator and worker run in
        // separate processes so there's never more than one Owner type sharing
        // this group.
        if g.vtable.is_none() {
            // PORT NOTE: cannot use `uws::vtable::make::<PosixHandlers<Owner>>()`
            // because `bun_uws_sys::vtable::Handler` requires `Self: 'static`
            // and one owner (`WorkerCommands<'a>`) carries a lifetime. The
            // hand-rolled `PosixHandlers::<Owner>::VTABLE` const below mirrors
            // exactly what `vtable::make` would produce.
            g.vtable = Some(&PosixHandlers::<Owner>::VTABLE);
        }
        g
    }
}

// -- Windows (uv.Pipe) -------------------------------------------------------

#[cfg(windows)]
pub struct WindowsBackend {
    pub pipe: Option<Box<uv::Pipe>>,
    /// Read scratch — libuv asks us to allocate before each read.
    pub read_chunk: [u8; 16 * 1024],
    /// Payload owned by the in-flight uv_write; must stay stable until the
    /// callback. New writes go to `out` until this completes, then the buffers
    /// swap.
    pub inflight: Vec<u8>,
    pub write_req: uv::uv_write_t,
    pub write_buf: uv::uv_buf_t,
}

#[cfg(windows)]
impl Default for WindowsBackend {
    fn default() -> Self {
        Self {
            pipe: None,
            read_chunk: [0u8; 16 * 1024],
            inflight: Vec::new(),
            write_req: bun_core::ffi::zeroed::<uv::uv_write_t>(),
            write_buf: uv::uv_buf_t::init(b""),
        }
    }
}

// -- adopt -------------------------------------------------------------------

impl<Owner: ChannelOwner> Channel<Owner> {
    /// Adopt a duplex fd into the channel and start reading. POSIX: the
    /// socketpair end. Windows: the inherited named-pipe end (worker side).
    // PORT NOTE: callers (`runner.rs`, `Worker.rs`) only hold `&VirtualMachine`;
    // the upstream `rare_data()` / `test_parallel_ipc_group()` accessors require
    // `&mut`. Take a raw `*const` (matches Zig `*jsc.VirtualMachine`) and cast
    // away const locally — single-threaded init path. A `&VirtualMachine`
    // parameter would trip `invalid_reference_casting` on the `&T → &mut T`
    // promotion; the raw-pointer route sidesteps that lint while keeping both
    // call sites (which pass `&`/`&mut` and coerce) unchanged.
    pub fn adopt(&mut self, vm: *const VirtualMachine, fd: Fd) -> bool {
        // PORT NOTE — VM is process-singleton and accessed only from the main
        // thread here; route through the safe singleton accessor.
        let _ = vm;
        let vm: &mut VirtualMachine = VirtualMachine::get().as_mut();
        #[cfg(windows)]
        {
            // ipc=true matches ipc.zig windowsConfigureClient. With ipc=true
            // libuv wraps reads/writes in its own framing; both ends use it so
            // the wrapping is transparent and our payload bytes pass through
            // unchanged. With ipc=false the parent end (created by uv_spawn for
            // the .ipc stdio container, which always inits with ipc=true) and
            // child end disagree on framing and the channel never delivers a
            // frame.
            let mut pipe = Box::new(bun_core::ffi::zeroed::<uv::Pipe>());
            if let Some(e) = pipe
                .init(uv::Loop::get(), true)
                .to_error(bun_sys::Tag::pipe)
            {
                Output::debug_warn(format_args!(
                    "Channel.adopt: uv_pipe_init failed: {}",
                    e.name().escape_ascii(),
                ));
                drop(pipe);
                return false;
            }
            if let Some(e) = pipe.open(fd.uv()).to_error(bun_sys::Tag::open) {
                Output::debug_warn(format_args!(
                    "Channel.adopt: uv_pipe_open({}) failed: {}",
                    fd.uv(),
                    e.name().escape_ascii(),
                ));
                // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
                unsafe { uv::Pipe::close_and_destroy(bun_core::heap::into_raw(pipe)) };
                return false;
            }
            let pipe = bun_core::heap::into_raw(pipe);
            if !self.adopt_pipe(vm, pipe) {
                // Caller still owns `pipe` on adopt_pipe failure (Zig spec).
                // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
                unsafe { uv::Pipe::close_and_destroy(pipe) };
                return false;
            }
            return true;
        }
        #[cfg(not(windows))]
        {
            let g = Self::ensure_posix_group(vm);
            let Some(sock) =
                Socket::from_fd(g, uws::SocketKind::Dynamic, fd, std::ptr::from_mut(self), true)
            else {
                // us_socket_from_fd does NOT take ownership on failure; leaving
                // the inherited IPC endpoint open keeps the peer process alive.
                fd.close();
                return false;
            };
            self.backend.socket = sock;
            sock.set_timeout(0);
            true
        }
    }

    /// Windows-only: adopt a `uv::Pipe` already initialized by spawn (the
    /// `.ipc` extra-fd parent end, or the worker's just-opened pipe). Starts
    /// reading. On failure the caller still owns `pipe`.
    ///
    /// Unlike ipc.zig's windowsConfigureServer/Client we keep the pipe ref'd:
    /// the worker (and the coordinator before workers register process exit
    /// handles) has nothing else keeping `uv_loop_alive()` true, so unref'ing
    /// here makes autoTick() take the tickWithoutIdle (NOWAIT) path and never
    /// block for the peer's first frame. The pipe is closed explicitly in
    /// `close()` / `Drop`, and both sides exit via Global.exit / drive()
    /// returning, so the extra ref never holds the process open.
    #[cfg(windows)]
    pub fn adopt_pipe(&mut self, _vm: *const VirtualMachine, pipe: *mut uv::Pipe) -> bool {
        // PORT NOTE: Zig's `pipe.readStart(self, onAlloc, onError, onRead)`
        // bakes the three callbacks at comptime; the Rust binding expresses
        // that via the `StreamReader` trait impl below and routes through
        // `read_start_ctx`, which stashes `self` in `handle.data`.
        // SAFETY: `pipe` is a live, init'ed `Box<Pipe>` allocation owned by the
        // caller; we only borrow it to start reading.
        let rc = unsafe { (*pipe).read_start_ctx::<Self>(core::ptr::from_mut(self)) };
        if let Some(e) = rc.to_error(bun_sys::Tag::listen) {
            Output::debug_warn(format_args!(
                "Channel.adoptPipe: readStart failed: {}",
                e.name().escape_ascii(),
            ));
            // Caller still owns `pipe` on failure (Zig spec) and is responsible
            // for `close_and_destroy`.
            return false;
        }
        // SAFETY: `pipe` was Box-allocated by the caller (`bun.new(uv.Pipe)` /
        // `bun_core::heap::into_raw`); on success the channel takes ownership.
        self.backend.pipe = Some(unsafe { Box::from_raw(pipe) });
        true
    }

    // -- write ---------------------------------------------------------------

    /// Queue and write a complete encoded frame. If the kernel accepts only
    /// part of it (or there's already a backlog), the remainder lands in `out`
    /// and the writable callback finishes it.
    pub fn send(&mut self, frame_bytes: &[u8]) {
        if self.done {
            return;
        }
        #[cfg(windows)]
        {
            return self.send_windows(frame_bytes);
        }
        #[cfg(not(windows))]
        {
            if !self.out.is_empty() {
                self.out.extend_from_slice(frame_bytes);
                return;
            }
            let wrote = self.backend.socket.write(frame_bytes);
            let w: usize = if wrote > 0 {
                usize::try_from(wrote).unwrap()
            } else {
                0
            };
            if w < frame_bytes.len() {
                self.out.extend_from_slice(&frame_bytes[w..]);
            }
        }
    }

    #[cfg(windows)]
    fn send_windows(&mut self, frame_bytes: &[u8]) {
        // A uv_write is in flight — queue behind it.
        if !self.backend.inflight.is_empty() {
            self.out.extend_from_slice(frame_bytes);
            return;
        }
        let Some(pipe) = self.backend.pipe.as_mut() else {
            return;
        };
        // Try a synchronous write first. uv_try_write on a Windows
        // UV_NAMED_PIPE always returns EAGAIN (vendor/libuv/src/win/stream.c),
        // so this currently always falls through to submit_windows_write —
        // kept because EBADF/EPIPE here mean the pipe is dead and must not
        // silently drop the frame.
        // PORT NOTE: Zig `pipe.tryWrite([]const u8) Maybe(usize)` is inlined
        // here against the low-level `UvStream::try_write(&[uv_buf_t])`.
        let buf = uv::uv_buf_t::init(frame_bytes);
        let rc = pipe.try_write(core::slice::from_ref(&buf));
        let w: usize = match rc.to_error(bun_sys::Tag::try_write) {
            None => rc.int() as usize,
            Some(e) => {
                if e.get_errno() == bun_sys::E::AGAIN {
                    0
                } else {
                    self.mark_done();
                    return;
                }
            }
        };
        if w >= frame_bytes.len() {
            return;
        }
        self.out.extend_from_slice(&frame_bytes[w..]);
        self.submit_windows_write();
    }

    #[cfg(windows)]
    fn submit_windows_write(&mut self) {
        if self.out.is_empty() || !self.backend.inflight.is_empty() || self.done {
            return;
        }
        // Capture the raw self pointer for uv_write's `data` field before
        // taking any field borrows below (the borrow used by from_mut ends
        // immediately; raw pointers carry no lifetime).
        let this: *mut Self = core::ptr::from_mut(self);
        let Some(pipe) = self.backend.pipe.as_mut() else {
            return;
        };
        // Swap: out → inflight (stable for uv_write), out becomes empty.
        core::mem::swap(&mut self.backend.inflight, &mut self.out);
        self.backend.write_buf = uv::uv_buf_t::init(self.backend.inflight.as_slice());
        if self
            .backend
            .write_req
            .write(
                pipe.as_stream(),
                &self.backend.write_buf,
                this,
                // SAFETY: `p` was `this: *mut Self`; libuv invokes on the loop
                // thread with no other Rust borrow live, so `&mut *p` is unique.
                |p, s| unsafe { WindowsHandlers::<Owner>::on_write(&mut *p, s) },
            )
            .is_err()
        {
            self.backend.inflight.clear();
            self.mark_done();
        }
    }

    /// True while the underlying socket/pipe is still open. When `done` is set
    /// with the transport still attached, it was a protocol error (corrupt
    /// frame), not a clean close.
    pub fn is_attached(&self) -> bool {
        #[cfg(windows)]
        {
            return self.backend.pipe.is_some();
        }
        #[cfg(not(windows))]
        {
            !self.backend.socket.is_detached()
        }
    }

    /// True while any encoded bytes are still queued or in flight.
    pub fn has_pending_writes(&self) -> bool {
        if !self.out.is_empty() {
            return true;
        }
        #[cfg(windows)]
        {
            return !self.backend.inflight.is_empty();
        }
        #[cfg(not(windows))]
        {
            false
        }
    }

    /// Best-effort drain of any buffered writes.
    pub fn flush(&mut self) {
        #[cfg(windows)]
        {
            return self.submit_windows_write();
        }
        #[cfg(not(windows))]
        {
            while !self.out.is_empty() && !self.done {
                let wrote = self.backend.socket.write(self.out.as_slice());
                if wrote <= 0 {
                    return;
                }
                let w: usize = usize::try_from(wrote).unwrap();
                self.out.drain_front(w);
            }
        }
    }

    pub fn close(&mut self) {
        if self.done {
            return;
        }
        self.flush();
        #[cfg(windows)]
        {
            if let Some(p) = self.backend.pipe.take() {
                if !p.is_closing() {
                    // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
                    unsafe { uv::Pipe::close_and_destroy(bun_core::heap::into_raw(p)) };
                } else {
                    // TODO(port): Zig left the field set if already closing;
                    // with Box we cannot put it back without re-taking. Phase B
                    // may need raw *mut uv::Pipe here.
                    self.backend.pipe = Some(p);
                }
            }
        }
        #[cfg(not(windows))]
        {
            self.backend.socket.close(uws::CloseCode::Normal);
        }
        self.mark_done();
    }

    // -- frame decode (shared) -----------------------------------------------

    fn ingest(&mut self, data: &[u8]) {
        if self.done {
            return;
        }
        self.r#in.extend_from_slice(data);
        let mut head: usize = 0;
        while self.r#in.len() - head >= 5 {
            let len = u32::from_le_bytes(self.r#in[head..][..4].try_into().unwrap());
            if len > frame::MAX_PAYLOAD {
                self.mark_done();
                return;
            }
            if self.r#in.len() - head < 5usize + len as usize {
                break;
            }
            let Ok(kind) = frame::Kind::try_from(self.r#in[head + 4]) else {
                // TODO(port): Zig used std.meta.intToEnum; ensure Kind impls
                // TryFrom<u8> in frame.rs.
                head += 5usize + len as usize;
                continue;
            };
            // PORT NOTE: borrowck split — `rd` borrows `self.r#in` while
            // `owner()` would re-borrow `*self` mutably. Capture the owner raw
            // pointer *before* forming `rd` (so the `&mut *self` reborrow ends
            // immediately), then recover `&mut Owner` from it after. Same
            // `container_of` arithmetic as `owner()`. The callback never
            // touches `self.r#in` (it only reads `rd` and may write other
            // channel fields / call `send()`), so the aliasing is sound.
            let owner_ptr: *mut Owner = unsafe { Owner::from_field_ptr(std::ptr::from_mut(self)) };
            let mut rd = frame::Reader {
                p: &self.r#in[head + 5..][..len as usize],
            };
            // SAFETY: see `Channel::owner()` — `self` is embedded at
            // `Owner::OFFSET` inside an `Owner` that outlives all callbacks.
            let owner: &mut Owner = unsafe { &mut *owner_ptr };
            owner.on_channel_frame(kind, &mut rd);
            head += 5usize + len as usize;
        }
        self.r#in.drain_front(head);
    }

    fn mark_done(&mut self) {
        if self.done {
            return;
        }
        self.done = true;
        self.owner().on_channel_done();
    }
}

impl<Owner> Drop for Channel<Owner> {
    fn drop(&mut self) {
        self.done = true;
        #[cfg(windows)]
        {
            if let Some(p) = self.backend.pipe.take() {
                // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
                unsafe { uv::Pipe::close_and_destroy(bun_core::heap::into_raw(p)) };
            }
            // `inflight` Vec drops automatically.
        }
        #[cfg(not(windows))]
        {
            if !self.backend.socket.is_detached() {
                self.backend.socket.close(uws::CloseCode::Normal);
                self.backend.socket = Socket::DETACHED;
            }
        }
        // `in` / `out` Vec drop automatically.
    }
}

// -- platform callbacks ------------------------------------------------------

/// `vtable.make()` shape: `(ext: **Self, *us_socket_t, …)`. Hand-rolled here
/// instead of `uws::vtable::make::<PosixHandlers<Owner>>()` because the
/// upstream `bun_uws_sys::vtable::Handler` trait is `'static`-bounded and one
/// owner (`WorkerCommands<'a>`) carries a lifetime. The trampolines below are
/// the exact shape `vtable::make` would have produced.
#[cfg(not(windows))]
pub struct PosixHandlers<Owner: ChannelOwner>(PhantomData<Owner>);

/// Ext slot type for the usockets vtable: the slot holds a `*mut Channel<Owner>`.
// PORT NOTE: was an inherent `type Ext` on the impl in the Zig-shaped draft;
// inherent associated types are unstable in Rust, so it lives as a free alias.
#[cfg(not(windows))]
pub type PosixExt<Owner> = *mut Channel<Owner>;

#[cfg(not(windows))]
impl<Owner: ChannelOwner> PosixHandlers<Owner> {
    /// Per-Owner static vtable. `&Self::VTABLE` const-promotes to
    /// `&'static SocketGroupVTable` (all fields are `Option<fn>`; no Drop).
    pub const VTABLE: uws::SocketGroupVTable = uws::SocketGroupVTable {
        on_open: None,
        on_data: Some(Self::raw_on_data),
        on_fd: None,
        on_writable: Some(Self::raw_on_writable),
        on_close: Some(Self::raw_on_close),
        on_timeout: None,
        on_long_timeout: None,
        on_end: Some(Self::raw_on_end),
        on_connect_error: None,
        on_connecting_error: None,
        on_handshake: None,
    };

    /// Recover `&mut Channel<Owner>` from the socket ext slot.
    ///
    /// # Safety
    /// `s` is a live us_socket_t whose ext was sized for and stamped with
    /// `*mut Channel<Owner>` in `adopt()`; the owner outlives all usockets
    /// callbacks (see module doc).
    #[inline(always)]
    unsafe fn chan<'a>(s: *mut uws::us_socket_t) -> &'a mut Channel<Owner> {
        unsafe { &mut **(*s).ext::<PosixExt<Owner>>() }
    }

    unsafe extern "C" fn raw_on_data(
        s: *mut uws::us_socket_t,
        data: *mut u8,
        len: core::ffi::c_int,
    ) -> *mut uws::us_socket_t {
        // SAFETY: usockets guarantees `data[0..len]` is valid for the call.
        let slice = unsafe { bun_core::ffi::slice(data, len as usize) };
        // SAFETY: see `chan` doc.
        unsafe { Self::chan(s) }.ingest(slice);
        s
    }

    unsafe extern "C" fn raw_on_writable(s: *mut uws::us_socket_t) -> *mut uws::us_socket_t {
        // SAFETY: see `chan` doc.
        unsafe { Self::chan(s) }.flush();
        s
    }

    unsafe extern "C" fn raw_on_close(
        s: *mut uws::us_socket_t,
        _code: core::ffi::c_int,
        _reason: *mut c_void,
    ) -> *mut uws::us_socket_t {
        // SAFETY: see `chan` doc.
        let chan = unsafe { Self::chan(s) };
        chan.backend.socket = Socket::DETACHED;
        chan.mark_done();
        s
    }

    unsafe extern "C" fn raw_on_end(s: *mut uws::us_socket_t) -> *mut uws::us_socket_t {
        // SAFETY: `s` is a live us_socket_t passed by usockets.
        unsafe { (*s).close(bun_uws_sys::CloseCode::normal) };
        s
    }
}

#[cfg(windows)]
pub struct WindowsHandlers<Owner: ChannelOwner>(PhantomData<Owner>);

#[cfg(windows)]
impl<Owner: ChannelOwner> WindowsHandlers<Owner> {
    pub fn on_alloc(self_: &mut Channel<Owner>, suggested: usize) -> &mut [u8] {
        let _ = suggested;
        &mut self_.backend.read_chunk[..]
    }
    pub fn on_read(self_: &mut Channel<Owner>, data: &[u8]) {
        self_.ingest(data);
    }
    pub fn on_error(self_: &mut Channel<Owner>, _err: bun_sys::E) {
        // Mirror the POSIX on_close path: detach the transport before
        // signalling done so the owner can tell EOF apart from a protocol
        // error (where the pipe is still attached).
        if let Some(p) = self_.backend.pipe.take() {
            // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
            unsafe { uv::Pipe::close_and_destroy(bun_core::heap::into_raw(p)) };
        }
        self_.mark_done();
    }
    pub fn on_write(self_: &mut Channel<Owner>, status: uv::ReturnCode) {
        self_.backend.inflight.clear();
        if self_.done {
            return;
        }
        if status.is_err() {
            self_.mark_done();
            return;
        }
        self_.submit_windows_write();
    }
}

/// Adapter from `UvStream::read_start_ctx` to `WindowsHandlers` — Zig's
/// `pipe.readStart(self, onAlloc, onError, onRead)` captures the three
/// callbacks at comptime; Rust expresses that as this trait impl so the
/// `extern "C"` trampoline stays zero-alloc.
#[cfg(windows)]
impl<Owner: ChannelOwner> uv::StreamReader for Channel<Owner> {
    #[inline]
    fn on_read_alloc(this: &mut Self, suggested_size: usize) -> &mut [u8] {
        WindowsHandlers::<Owner>::on_alloc(this, suggested_size)
    }
    #[inline]
    fn on_read_error(this: &mut Self, err: core::ffi::c_int) {
        let e = bun_sys::windows::translate_uv_error_to_e(err);
        WindowsHandlers::<Owner>::on_error(this, e);
    }
    #[inline]
    unsafe fn on_read(this: *mut Self, data: &[u8]) {
        // `data` points into `(*this).backend.read_chunk` (returned from
        // `on_read_alloc`). Forming `&mut *this` retags every byte Unique and
        // pops `data`'s SharedRW tag, so capture the length, drop `data`, then
        // re-derive the bytes from the freshly-retagged `this` via a disjoint
        // field split (read_chunk → r#in).
        let n = data.len();
        let _ = data;
        // SAFETY: `this` is the live `Channel` stashed in `handle.data` by
        // `read_start_ctx`; `data` is no longer live so the retag is sound.
        let this = unsafe { &mut *this };
        if this.done {
            return;
        }
        this.r#in.extend_from_slice(&this.backend.read_chunk[..n]);
        // Run the shared decode loop; the empty append is a no-op.
        this.ingest(&[]);
    }
}

// Silence unused-import on the non-selecting cfg arm.
#[allow(unused_imports)]
use offset_of as _;

// ported from: src/cli/test/parallel/Channel.zig
