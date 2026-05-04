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

use bun_core::Output;
use bun_jsc::VirtualMachine;
use bun_sys::Fd;
use bun_uws as uws;

#[cfg(windows)]
use bun_sys::windows::libuv as uv;

use super::frame::{self, Frame};

/// The Zig version is `fn Channel(comptime Owner: type, comptime owner_field:
/// []const u8) type`. Rust cannot take a field-name string as a const generic,
/// so the owner instead implements [`ChannelOwner`] supplying the byte offset
/// of the embedded `Channel` (via `core::mem::offset_of!`) plus the two
/// callbacks the Zig called as `owner().onChannelFrame` / `onChannelDone`.
pub trait ChannelOwner: Sized {
    /// `offset_of!(Self, <channel field>)` — used to recover `&mut Self` from
    /// `&mut Channel<Self>` in platform callbacks (Zig: `@fieldParentPtr`).
    const CHANNEL_OFFSET: usize;
    fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>);
    fn on_channel_done(&mut self);
}

pub struct Channel<Owner: ChannelOwner> {
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

impl<Owner: ChannelOwner> Default for Channel<Owner> {
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
        // SAFETY: `self` is always embedded at `CHANNEL_OFFSET` inside an
        // `Owner` that outlives all callbacks (see module doc). Mirrors Zig
        // `@alignCast(@fieldParentPtr(owner_field, self))`.
        unsafe {
            &mut *(self as *mut Self)
                .cast::<u8>()
                .sub(Owner::CHANNEL_OFFSET)
                .cast::<Owner>()
        }
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
        Self { socket: Socket::DETACHED }
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
        let g = vm.rare_data().test_parallel_ipc_group(vm);
        // First Owner to call wins the vtable; coordinator and worker run in
        // separate processes so there's never more than one Owner type sharing
        // this group.
        if g.vtable.is_none() {
            g.vtable = Some(uws::vtable::make::<PosixHandlers<Owner>>());
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
            // SAFETY: uv_write_t is #[repr(C)] POD; all-zero is a valid value
            // (matches Zig `std.mem.zeroes(uv.uv_write_t)`).
            write_req: unsafe { core::mem::zeroed::<uv::uv_write_t>() },
            write_buf: uv::uv_buf_t::init(b""),
        }
    }
}

// -- adopt -------------------------------------------------------------------

impl<Owner: ChannelOwner> Channel<Owner> {
    /// Adopt a duplex fd into the channel and start reading. POSIX: the
    /// socketpair end. Windows: the inherited named-pipe end (worker side).
    pub fn adopt(&mut self, vm: &mut VirtualMachine, fd: Fd) -> bool {
        #[cfg(windows)]
        {
            let _ = vm;
            // ipc=true matches ipc.zig windowsConfigureClient. With ipc=true
            // libuv wraps reads/writes in its own framing; both ends use it so
            // the wrapping is transparent and our payload bytes pass through
            // unchanged. With ipc=false the parent end (created by uv_spawn for
            // the .ipc stdio container, which always inits with ipc=true) and
            // child end disagree on framing and the channel never delivers a
            // frame.
            // SAFETY: uv::Pipe is #[repr(C)] POD; all-zero is a valid value
            // (matches Zig `std.mem.zeroes(uv.Pipe)`).
            let mut pipe = Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() });
            if let Err(e) = pipe.init(uv::Loop::get(), true).unwrap_result() {
                Output::debug_warn(format_args!(
                    "Channel.adopt: uv_pipe_init failed: {}",
                    e.name(),
                ));
                drop(pipe);
                return false;
            }
            if let Err(e) = pipe.open(fd).unwrap_result() {
                Output::debug_warn(format_args!(
                    "Channel.adopt: uv_pipe_open({}) failed: {}",
                    fd.uv(),
                    e.name(),
                ));
                pipe.close_and_destroy();
                return false;
            }
            if !self.adopt_pipe(vm, pipe) {
                // adopt_pipe consumed the Box on failure path itself.
                // TODO(port): Zig caller still owned `pipe` on adoptPipe failure
                // and called closeAndDestroy here; reconcile ownership in Phase B.
                return false;
            }
            return true;
        }
        #[cfg(not(windows))]
        {
            let g = Self::ensure_posix_group(vm);
            let Some(sock) = Socket::from_fd(
                g,
                uws::SocketKind::Dynamic,
                fd,
                self as *mut Self,
                None,
                true,
            ) else {
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
    pub fn adopt_pipe(&mut self, _vm: &mut VirtualMachine, mut pipe: Box<uv::Pipe>) -> bool {
        if let Err(e) = pipe
            .read_start(
                self as *mut Self,
                WindowsHandlers::<Owner>::on_alloc,
                WindowsHandlers::<Owner>::on_error,
                WindowsHandlers::<Owner>::on_read,
            )
            .unwrap_result()
        {
            Output::debug_warn(format_args!(
                "Channel.adoptPipe: readStart failed: {}",
                e.name(),
            ));
            // TODO(port): Zig returned false leaving caller owning `pipe`;
            // with Box we'd need to hand it back. Phase B: take `&mut Box` or
            // return the Box on failure.
            pipe.close_and_destroy();
            return false;
        }
        self.backend.pipe = Some(pipe);
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
            let w: usize = if wrote > 0 { usize::try_from(wrote).unwrap() } else { 0 };
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
        let Some(pipe) = self.backend.pipe.as_mut() else { return };
        // Try a synchronous write first. uv_try_write on a Windows
        // UV_NAMED_PIPE always returns EAGAIN (vendor/libuv/src/win/stream.c),
        // so this currently always falls through to submit_windows_write —
        // kept because EBADF/EPIPE here mean the pipe is dead and must not
        // silently drop the frame.
        let w: usize = match pipe.try_write(frame_bytes) {
            bun_sys::Result::Ok(n) => n,
            bun_sys::Result::Err(e) => {
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
        let Some(pipe) = self.backend.pipe.as_mut() else { return };
        // Swap: out → inflight (stable for uv_write), out becomes empty.
        core::mem::swap(&mut self.backend.inflight, &mut self.out);
        self.backend.write_buf = uv::uv_buf_t::init(self.backend.inflight.as_slice());
        if self
            .backend
            .write_req
            .write(
                pipe.as_stream(),
                &self.backend.write_buf,
                self as *mut Self,
                WindowsHandlers::<Owner>::on_write,
            )
            .unwrap_result()
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
                // PORT NOTE: reshaped for borrowck — capture len before copy_within.
                let len = self.out.len();
                self.out.copy_within(w.., 0);
                self.out.truncate(len - w);
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
                    p.close_and_destroy();
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
            if len > Frame::MAX_PAYLOAD {
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
            let mut rd = frame::Reader {
                p: &self.r#in[head + 5..][..len as usize],
            };
            self.owner().on_channel_frame(kind, &mut rd);
            head += 5usize + len as usize;
        }
        if head > 0 {
            let rest = self.r#in.len() - head;
            self.r#in.copy_within(head.., 0);
            self.r#in.truncate(rest);
        }
    }

    fn mark_done(&mut self) {
        if self.done {
            return;
        }
        self.done = true;
        self.owner().on_channel_done();
    }
}

impl<Owner: ChannelOwner> Drop for Channel<Owner> {
    fn drop(&mut self) {
        self.done = true;
        #[cfg(windows)]
        {
            if let Some(p) = self.backend.pipe.take() {
                p.close_and_destroy();
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

/// `vtable::make()` shape: `(ext: *mut *mut Channel<Owner>, *mut us_socket_t, …)`.
#[cfg(not(windows))]
pub struct PosixHandlers<Owner: ChannelOwner>(PhantomData<Owner>);

#[cfg(not(windows))]
impl<Owner: ChannelOwner> PosixHandlers<Owner> {
    pub type Ext = *mut *mut Channel<Owner>;

    pub fn on_data(self_: Self::Ext, _s: *mut uws::us_socket_t, data: &[u8]) {
        // SAFETY: ext slot was set to `self as *mut Channel<_>` in `adopt()`;
        // the owner outlives all usockets callbacks (see module doc).
        unsafe { &mut **self_ }.ingest(data);
    }
    pub fn on_writable(self_: Self::Ext, _s: *mut uws::us_socket_t) {
        // SAFETY: see on_data.
        unsafe { &mut **self_ }.flush();
    }
    pub fn on_close(self_: Self::Ext, _s: *mut uws::us_socket_t, _code: i32, _reason: *mut c_void) {
        // SAFETY: see on_data.
        let chan = unsafe { &mut **self_ };
        chan.backend.socket = Socket::DETACHED;
        chan.mark_done();
    }
    pub fn on_end(_self: Self::Ext, s: *mut uws::us_socket_t) {
        // SAFETY: `s` is a live us_socket_t passed by usockets.
        unsafe { &*s }.close(uws::CloseCode::Normal);
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
            p.close_and_destroy();
        }
        self_.mark_done();
    }
    pub fn on_write(self_: &mut Channel<Owner>, status: uv::ReturnCode) {
        self_.backend.inflight.clear();
        if self_.done {
            return;
        }
        if status.to_error(uv::SyscallTag::Write).is_some() {
            self_.mark_done();
            return;
        }
        self_.submit_windows_write();
    }
}

// Silence unused-import on the non-selecting cfg arm.
#[allow(unused_imports)]
use offset_of as _;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/test/parallel/Channel.zig (346 lines)
//   confidence: medium
//   todos:      4
//   notes:      comptime owner_field replaced by ChannelOwner trait (CHANNEL_OFFSET); Box<uv::Pipe> ownership vs close_and_destroy needs Phase-B reconcile; ingest() borrows self.in across owner() call — may need raw-ptr split.
// ──────────────────────────────────────────────────────────────────────────
