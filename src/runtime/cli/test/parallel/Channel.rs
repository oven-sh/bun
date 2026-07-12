//! Bidirectional IPC channel for `bun test --parallel`. Reads are
//! frame-decoded in the loop's data callback; writes go through the platform
//! socket/pipe with backpressure buffered and drained via the loop, so a full
//! kernel buffer never truncates a frame. The owner type provides
//! `on_channel_frame(kind, &mut Frame::Reader)` and `on_channel_done()`.
//!
//! POSIX backend: Protocol v2 (`SocketKind::TestChannel`) over a socketpair
//! fd; the refcounted [`ChannelState`] is the socket owner, so the dispatch
//! trampoline holds it alive across every callback and no raw ext-slot
//! pointer exists.
//! Windows backend: `uv::Pipe` over the inherited duplex named-pipe end (same
//! mechanism as `Bun.spawn({ipc})` / `process.send()`).
//!
//! Lifetime: a `Channel` is embedded as a field in an owner that outlives all
//! uv/usockets callbacks (the coordinator's `Worker[]`, or the worker's
//! `WorkerLoop` which lives for the process). Frame delivery goes through the
//! `ChannelState.owner` backref (set at adopt via `IntrusiveField::OFFSET`,
//! cleared in `Drop`); everything socket-facing lives in the refcounted state.

use core::cell::Cell;
use core::marker::PhantomData;

#[cfg(not(windows))]
use bun_collections::VecExt;
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::Fd;
#[cfg(not(windows))]
use bun_sys::FdExt as _;
#[cfg(not(windows))]
use bun_usockets as uws;

#[cfg(windows)]
use bun_libuv_sys::{UvHandle as _, UvStream as _};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

use super::frame;

/// The owner implements [`bun_core::IntrusiveField<Channel<Self>>`]
/// (via `bun_core::intrusive_field!`) plus the two callbacks below.
pub trait ChannelOwner: bun_core::IntrusiveField<Channel<Self>> {
    fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>);
    fn on_channel_done(&mut self);
}

#[cfg(not(windows))]
pub type Socket = uws::NewSocketHandler<false>;
#[cfg(windows)]
pub type Socket = ();

/// Refcounted transport state; on POSIX this is the Protocol v2 socket owner
/// for `SocketKind::TestChannel`. Refs: the embedding [`Channel`] holds one
/// (released in its `Drop`); the socket core holds one from `from_fd_owned`
/// until the terminal callback.
#[derive(bun_ptr::RefCounted)]
pub struct ChannelState<Owner> {
    ref_count: bun_ptr::RefCount<Self>,
    /// Backref for frame delivery only (owner dispatch, not socket
    /// lifecycle); null before `adopt` and after `Channel::drop`.
    owner: Cell<*mut Owner>,
    /// Incoming bytes that don't yet form a complete frame.
    incoming: JsCell<Vec<u8>>,
    /// Outgoing bytes the kernel didn't accept yet.
    out: JsCell<Vec<u8>>,
    done: Cell<bool>,
    #[cfg(not(windows))]
    socket: Cell<Socket>,
}

impl<Owner> ChannelState<Owner> {
    fn new() -> bun_ptr::RefPtr<Self> {
        bun_ptr::RefPtr::new(ChannelState {
            ref_count: bun_ptr::RefCount::init(),
            owner: Cell::new(core::ptr::null_mut()),
            incoming: JsCell::new(Vec::new()),
            out: JsCell::new(Vec::new()),
            done: Cell::new(false),
            #[cfg(not(windows))]
            socket: Cell::new(Socket::DETACHED),
        })
    }
}

impl<Owner: ChannelOwner> ChannelState<Owner> {
    fn deliver_frame(&self, kind: frame::Kind, rd: &mut frame::Reader<'_>) {
        let owner = self.owner.get();
        if !owner.is_null() {
            // SAFETY: the owner embeds the `Channel` holding this state and
            // outlives all callbacks (module doc); nulled in `Channel::drop`.
            unsafe { &mut *owner }.on_channel_frame(kind, rd);
        }
    }

    fn mark_done(&self) {
        if self.done.replace(true) {
            return;
        }
        let owner = self.owner.get();
        if !owner.is_null() {
            // SAFETY: see `deliver_frame`.
            unsafe { &mut *owner }.on_channel_done();
        }
    }

    // -- frame decode (shared) -------------------------------------------

    fn ingest(&self, data: &[u8]) {
        if self.done.get() {
            return;
        }
        self.incoming.with_mut(|v| v.extend_from_slice(data));
        // One frame per iteration, split out of the cell BEFORE delivery: the
        // undecoded tail stays in the cell, so a re-entrant ingest (owner
        // callback pumping the loop) decodes from a frame boundary, in order.
        loop {
            enum Step {
                Incomplete,
                Corrupt,
                Frame(Vec<u8>),
            }
            let step = self.incoming.with_mut(|v| {
                if v.len() < 5 {
                    return Step::Incomplete;
                }
                let len = u32::from_le_bytes(v[..4].try_into().unwrap());
                if len > frame::MAX_PAYLOAD {
                    return Step::Corrupt;
                }
                let total = 5usize + len as usize;
                if v.len() < total {
                    return Step::Incomplete;
                }
                let rest = v.split_off(total);
                Step::Frame(core::mem::replace(v, rest))
            });
            match step {
                Step::Incomplete => return,
                Step::Corrupt => {
                    self.mark_done();
                    return;
                }
                Step::Frame(frame_bytes) => {
                    if let Ok(kind) = frame::Kind::try_from(frame_bytes[4]) {
                        let mut rd = frame::Reader {
                            p: &frame_bytes[5..],
                        };
                        self.deliver_frame(kind, &mut rd);
                    }
                }
            }
        }
    }

    // -- POSIX write path --------------------------------------------------

    #[cfg(not(windows))]
    fn send_bytes(&self, frame_bytes: &[u8]) {
        if self.done.get() {
            return;
        }
        let queued = self.out.with_mut(|out| {
            if out.is_empty() {
                false
            } else {
                out.extend_from_slice(frame_bytes);
                true
            }
        });
        if queued {
            return;
        }
        let wrote = self.socket.get().write(frame_bytes);
        let w: usize = if wrote > 0 {
            usize::try_from(wrote).unwrap()
        } else {
            0
        };
        if w < frame_bytes.len() {
            self.out
                .with_mut(|out| out.extend_from_slice(&frame_bytes[w..]));
        }
    }

    /// Best-effort drain of buffered writes (`write` never dispatches, so the
    /// cell borrow is safe across it).
    #[cfg(not(windows))]
    fn flush(&self) {
        self.out.with_mut(|out| {
            while !out.is_empty() && !self.done.get() {
                let wrote = self.socket.get().write(out.as_slice());
                if wrote <= 0 {
                    return;
                }
                out.drain_front(usize::try_from(wrote).unwrap());
            }
        });
    }
}

/// Protocol v2 registration tag; one `Owner` instantiation per process
/// (coordinator vs worker run in separate processes), so the single
/// `TestChannel` kind never sees a conflicting registration.
#[cfg(not(windows))]
struct ChannelProtocol<Owner>(PhantomData<Owner>);

#[cfg(not(windows))]
impl<Owner: ChannelOwner + 'static> uws::Protocol for ChannelProtocol<Owner> {
    type Owner = ChannelState<Owner>;
    const KIND: uws::SocketKind = uws::SocketKind::TestChannel;

    fn on_data(o: &ChannelState<Owner>, _s: uws::AnySocket, data: &mut [u8]) {
        o.ingest(data);
    }

    fn on_writable(o: &ChannelState<Owner>, _s: uws::AnySocket) {
        o.flush();
    }

    fn on_close(o: &ChannelState<Owner>, _s: uws::AnySocket, _code: uws::CloseCode2, _errno: i32) {
        o.socket.set(Socket::DETACHED);
        o.mark_done();
    }

    fn on_end(o: &ChannelState<Owner>, _s: uws::AnySocket) {
        // No half-close: peer FIN closes the socket outright.
        o.socket.get().close(uws::CloseCode::Normal);
    }
}

// The struct itself carries no `ChannelOwner` bound so that owners
// (Worker, WorkerCommands) can embed `Channel<Self>` as a field before their
// `impl ChannelOwner` is in scope. (Rust also forbids a stricter bound
// on `Drop` than on the struct, so Drop/Default below are unbounded too.)
pub struct Channel<Owner> {
    /// Owned ref (`RefPtr` has no `Drop`): released in `Channel::drop` after
    /// the owner backref is cleared.
    state: bun_ptr::RefPtr<ChannelState<Owner>>,
    #[cfg(windows)]
    pub backend: WindowsBackend,
    _owner: PhantomData<*mut Owner>,
}

impl<Owner> Default for Channel<Owner> {
    fn default() -> Self {
        Self {
            state: ChannelState::new(),
            #[cfg(windows)]
            backend: WindowsBackend::default(),
            _owner: PhantomData,
        }
    }
}

impl<Owner> Channel<Owner> {
    /// True once the channel is dead (clean close, protocol error, or failed
    /// adopt marked via [`Self::set_done`]).
    pub fn done(&self) -> bool {
        self.state.done.get()
    }

    /// Mark dead without firing `on_channel_done` (failed-adopt bookkeeping).
    pub fn set_done(&mut self) {
        self.state.done.set(true);
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
            !self.state.socket.get().is_detached()
        }
    }

    /// True while any encoded bytes are still queued or in flight.
    pub fn has_pending_writes(&self) -> bool {
        if !self.state.out.get().is_empty() {
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

// -- adopt / send / close ------------------------------------------------------

impl<Owner: ChannelOwner + 'static> Channel<Owner> {
    /// Shared embedded group for this channel. The per-file isolation swap
    /// skips `rare.test_parallel_ipc_group` so the coordinator link survives.
    #[cfg(not(windows))]
    fn ensure_posix_group(vm: &mut VirtualMachine) -> &mut uws::SocketGroup {
        // borrowck split — `rare_data()` mutably borrows `vm`, but
        // the group accessor needs `vm` again for `uws_loop()`. The two touch
        // disjoint storage (the `Box<RareData>` payload vs the loop pointer
        // field), so a raw-pointer reborrow is sound here.
        let rd: *mut bun_jsc::rare_data::RareData = vm.rare_data();
        // SAFETY: `rd` points into `vm`'s boxed RareData, which outlives this
        // call; the accessor only reads `vm.uws_loop()` (a separate field).
        unsafe { (*rd).test_parallel_ipc_group(vm) }
    }

    /// Adopt a duplex fd into the channel and start reading. POSIX: the
    /// socketpair end. Windows: the inherited named-pipe end (worker side).
    // callers (`runner.rs`, `Worker.rs`) only hold `&VirtualMachine`;
    // the upstream `rare_data()` / `test_parallel_ipc_group()` accessors require
    // `&mut`. Take a raw `*const` and cast
    // away const locally — single-threaded init path. A `&VirtualMachine`
    // parameter would trip `invalid_reference_casting` on the `&T → &mut T`
    // promotion; the raw-pointer route sidesteps that lint while keeping both
    // call sites (which pass `&`/`&mut` and coerce) unchanged.
    pub fn adopt(&mut self, vm: *const VirtualMachine, fd: Fd) -> bool {
        // VM is process-singleton and accessed only from the main
        // thread here; route through the safe singleton accessor.
        let _ = vm;
        let vm: &mut VirtualMachine = VirtualMachine::get().as_mut();
        // Frame-delivery backref (cleared in `Drop`).
        // SAFETY: `self` is always embedded at `Owner::OFFSET` inside an
        // `Owner` that outlives all callbacks (see module doc).
        let owner_ptr: *mut Owner = unsafe { Owner::from_field_ptr(std::ptr::from_mut(self)) };
        self.state.owner.set(owner_ptr);
        #[cfg(windows)]
        {
            let _ = vm;
            // With ipc=true
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
                bun_core::debug_warn!(
                    "Channel.adopt: uv_pipe_init failed: {}",
                    e.name().escape_ascii(),
                );
                drop(pipe);
                return false;
            }
            if let Some(e) = pipe.open(fd.uv()).to_error(bun_sys::Tag::open) {
                bun_core::debug_warn!(
                    "Channel.adopt: uv_pipe_open({}) failed: {}",
                    fd.uv(),
                    e.name().escape_ascii(),
                );
                // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
                unsafe { uv::Pipe::close_and_destroy(bun_core::heap::into_raw(pipe)) };
                return false;
            }
            let pipe = bun_core::heap::into_raw(pipe);
            if !self.adopt_pipe(core::ptr::null(), pipe) {
                // Caller still owns `pipe` on adopt_pipe failure.
                // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
                unsafe { uv::Pipe::close_and_destroy(pipe) };
                return false;
            }
            return true;
        }
        #[cfg(not(windows))]
        {
            // Lazy registration: one Owner type per process (coordinator and
            // worker are separate processes), so first-registration wins and
            // never conflicts.
            uws::register::<ChannelProtocol<Owner>>();
            let g = Self::ensure_posix_group(vm);
            // Transfers a strong ref to the socket core (released at the
            // terminal callback); the other ref stays in `self.state`.
            let Some(sock) = Socket::from_fd_owned(
                g,
                uws::SocketKind::TestChannel,
                fd,
                self.state.dupe_ref(),
                /*is_ipc=*/ true,
            ) else {
                // us_socket_from_fd does NOT take ownership on failure; leaving
                // the inherited IPC endpoint open keeps the peer process alive.
                fd.close();
                return false;
            };
            self.state.socket.set(sock);
            sock.set_timeout(0);
            true
        }
    }

    /// Windows-only: adopt a `uv::Pipe` already initialized by spawn (the
    /// `.ipc` extra-fd parent end, or the worker's just-opened pipe). Starts
    /// reading. On failure the caller still owns `pipe`.
    ///
    /// We keep the pipe ref'd:
    /// the worker (and the coordinator before workers register process exit
    /// handles) has nothing else keeping `uv_loop_alive()` true, so unref'ing
    /// here makes autoTick() take the tickWithoutIdle (NOWAIT) path and never
    /// block for the peer's first frame. The pipe is closed explicitly in
    /// `close()` / `Drop`, and both sides exit via Global.exit / drive()
    /// returning, so the extra ref never holds the process open.
    #[cfg(windows)]
    pub fn adopt_pipe(&mut self, _vm: *const VirtualMachine, pipe: *mut uv::Pipe) -> bool {
        // Frame-delivery backref (cleared in `Drop`); also set here for the
        // coordinator path that calls `adopt_pipe` directly.
        // SAFETY: `self` is embedded at `Owner::OFFSET` inside an `Owner` that
        // outlives all callbacks (see module doc).
        let owner_ptr: *mut Owner = unsafe { Owner::from_field_ptr(std::ptr::from_mut(self)) };
        self.state.owner.set(owner_ptr);
        // The read callbacks are expressed via the `StreamReader` trait impl
        // below and routed through `read_start_ctx`, which stashes `self` in
        // `handle.data`.
        // SAFETY: `pipe` is a live, init'ed `Box<Pipe>` allocation owned by the
        // caller; we only borrow it to start reading.
        let rc = unsafe { (*pipe).read_start_ctx::<Self>(core::ptr::from_mut(self)) };
        if let Some(e) = rc.to_error(bun_sys::Tag::listen) {
            bun_core::debug_warn!(
                "Channel.adoptPipe: readStart failed: {}",
                e.name().escape_ascii(),
            );
            // Caller still owns `pipe` on failure and is responsible
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
        if self.state.done.get() {
            return;
        }
        #[cfg(windows)]
        {
            return self.send_windows(frame_bytes);
        }
        #[cfg(not(windows))]
        {
            self.state.send_bytes(frame_bytes);
        }
    }

    #[cfg(windows)]
    fn send_windows(&mut self, frame_bytes: &[u8]) {
        // A uv_write is in flight — queue behind it.
        if !self.backend.inflight.is_empty() {
            self.state
                .out
                .with_mut(|out| out.extend_from_slice(frame_bytes));
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
        let buf = uv::uv_buf_t::init(frame_bytes);
        let rc = pipe.try_write(core::slice::from_ref(&buf));
        let w: usize = match rc.to_error(bun_sys::Tag::try_write) {
            None => rc.int() as usize,
            Some(e) => {
                if e.get_errno() == bun_sys::E::AGAIN {
                    0
                } else {
                    self.state.mark_done();
                    return;
                }
            }
        };
        if w >= frame_bytes.len() {
            return;
        }
        self.state
            .out
            .with_mut(|out| out.extend_from_slice(&frame_bytes[w..]));
        self.submit_windows_write();
    }

    #[cfg(windows)]
    fn submit_windows_write(&mut self) {
        if self.state.out.get().is_empty()
            || !self.backend.inflight.is_empty()
            || self.state.done.get()
        {
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
        self.state
            .out
            .with_mut(|out| core::mem::swap(&mut self.backend.inflight, out));
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
            self.state.mark_done();
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
            self.state.flush();
        }
    }

    pub fn close(&mut self) {
        if self.state.done.get() {
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
                    // Already closing: put the Box back; the uv close callback
                    // finishes the teardown.
                    self.backend.pipe = Some(p);
                }
            }
        }
        #[cfg(not(windows))]
        {
            self.state.socket.get().close(uws::CloseCode::Normal);
        }
        self.state.mark_done();
    }
}

impl<Owner> Drop for Channel<Owner> {
    fn drop(&mut self) {
        // Suppress owner callbacks first: the owner may be mid-drop, so a
        // close-triggered `on_channel_done` must not form `&mut Owner`.
        self.state.done.set(true);
        self.state.owner.set(core::ptr::null_mut());
        #[cfg(windows)]
        {
            // Drop assumes no uv_write is in flight: `submit_windows_write`
            // stored a raw `*mut Channel` in the write req, and a post-free
            // ECANCELED callback would dereference it dangling.
            if let Some(p) = self.backend.pipe.take() {
                // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
                unsafe { uv::Pipe::close_and_destroy(bun_core::heap::into_raw(p)) };
            }
            // `inflight` Vec drops automatically.
        }
        #[cfg(not(windows))]
        {
            let sock = self.state.socket.get();
            if !sock.is_detached() {
                sock.close(uws::CloseCode::Normal);
                self.state.socket.set(Socket::DETACHED);
            }
        }
        // Release the channel's ref; the socket core's ref (if the terminal
        // hasn't run yet) keeps the state alive until dispatch finishes.
        self.state.deref();
    }
}

// -- Windows read/write callbacks ---------------------------------------------

#[cfg(windows)]
pub(crate) struct WindowsHandlers<Owner: ChannelOwner>(PhantomData<Owner>);

#[cfg(windows)]
impl<Owner: ChannelOwner + 'static> WindowsHandlers<Owner> {
    pub(crate) fn on_alloc(self_: &mut Channel<Owner>, suggested: usize) -> &mut [u8] {
        let _ = suggested;
        &mut self_.backend.read_chunk[..]
    }
    pub(crate) fn on_error(self_: &mut Channel<Owner>, _err: bun_sys::E) {
        // Mirror the POSIX on_close path: detach the transport before
        // signalling done so the owner can tell EOF apart from a protocol
        // error (where the pipe is still attached).
        if let Some(p) = self_.backend.pipe.take() {
            // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
            unsafe { uv::Pipe::close_and_destroy(bun_core::heap::into_raw(p)) };
        }
        self_.state.mark_done();
    }
    pub(crate) fn on_write(self_: &mut Channel<Owner>, status: uv::ReturnCode) {
        self_.backend.inflight.clear();
        if self_.state.done.get() {
            return;
        }
        if status.is_err() {
            self_.state.mark_done();
            return;
        }
        self_.submit_windows_write();
    }
}

/// Adapter from `UvStream::read_start_ctx` to `WindowsHandlers`; expressed as
/// a trait impl so the `extern "C"` trampoline stays zero-alloc.
#[cfg(windows)]
impl<Owner: ChannelOwner + 'static> uv::StreamReader for Channel<Owner> {
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
        // re-derive the bytes from the freshly-retagged `this`.
        let n = data.len();
        let _ = data;
        // SAFETY: `this` is the live `Channel` stashed in `handle.data` by
        // `read_start_ctx`; `data` is no longer live so the retag is sound.
        let this = unsafe { &mut *this };
        if this.state.done.get() {
            return;
        }
        // Copy into the state buffer first so no borrow of `read_chunk`
        // (a Channel field) is live across the frame callbacks.
        this.state
            .incoming
            .with_mut(|v| v.extend_from_slice(&this.backend.read_chunk[..n]));
        // Run the shared decode loop; the empty append is a no-op.
        this.state.ingest(&[]);
    }
}
