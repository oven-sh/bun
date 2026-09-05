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
//!
//! Reentrancy: the read/close/writable callbacks re-enter the owner, which
//! may call back into this channel (`send`), so every method takes `&self`
//! and mutable state lives in `Cell`/[`JsCell`]. Owners must not drop or
//! replace the channel from inside one of its callbacks; the coordinator
//! defers reaping until the callback frame has unwound.

use core::cell::Cell;
#[cfg(not(windows))]
use core::ffi::c_void;
use core::marker::PhantomData;

use bun_collections::VecExt;
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::Fd;
#[cfg(not(windows))]
use bun_sys::FdExt as _;
#[cfg(not(windows))]
use bun_uws as uws;

#[cfg(windows)]
use bun_libuv_sys::UvStream as _;
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

// The struct itself carries no `ChannelOwner` bound so that owners
// (Worker, WorkerCommands) can embed `Channel<Self>` as a field before their
// `impl ChannelOwner` is in scope. Method impls that recover the owner via
// `IntrusiveField::OFFSET` keep the bound. (Rust also forbids a stricter bound
// on `Drop` than on the struct, so Drop/Default below are unbounded too.)
pub struct Channel<Owner> {
    /// Incoming bytes that don't yet form a complete frame.
    pub(crate) r#in: JsCell<Vec<u8>>,
    /// Outgoing bytes the kernel didn't accept yet.
    pub out: JsCell<Vec<u8>>,
    pub(crate) done: Cell<bool>,
    /// The peer's byte stream stopped decoding as frames, i.e. something in
    /// the peer wrote straight to fd 3: a length `ingest` rejected, or on
    /// Windows a read error from libuv's own IPC framing underneath ours. Set
    /// together with `done`, transport still attached. The coordinator kills
    /// such a worker and reports this rather than the exit status it caused.
    pub(crate) corrupt_frame: Cell<bool>,

    pub(crate) backend: Backend,

    root: Cell<*mut Channel<Owner>>,

    _owner: PhantomData<*mut Owner>,
}

#[cfg(windows)]
pub type Backend = WindowsBackend;
#[cfg(not(windows))]
pub type Backend = PosixBackend;

impl<Owner> Default for Channel<Owner> {
    fn default() -> Self {
        Self {
            r#in: JsCell::new(Vec::new()),
            out: JsCell::new(Vec::new()),
            done: Cell::new(false),
            corrupt_frame: Cell::new(false),
            backend: Backend::default(),
            root: Cell::new(core::ptr::null_mut()),
            _owner: PhantomData,
        }
    }
}

impl<Owner: ChannelOwner> Channel<Owner> {
    #[inline]
    fn owner_ptr(&self) -> *mut Owner {
        let root = self.root.get();
        debug_assert!(!root.is_null(), "Channel::owner_ptr before adopt");
        // SAFETY: `self` is embedded at `Owner::OFFSET` inside an `Owner`
        // that outlives all callbacks (see module doc); `root` is that same
        // address with the owner's write provenance.
        unsafe { Owner::from_field_ptr(root) }
    }
}

// -- POSIX (usockets) --------------------------------------------------------

#[cfg(not(windows))]
pub type Socket = uws::NewSocketHandler<false>;

#[cfg(not(windows))]
pub struct PosixBackend {
    pub(crate) socket: Cell<Socket>,
    /// Bytes at the front of `out` already written to the kernel;
    /// front-draining per partial write instead is quadratic in backlog size.
    out_head: Cell<usize>,
}

#[cfg(not(windows))]
impl Default for PosixBackend {
    fn default() -> Self {
        Self {
            socket: Cell::new(Socket::DETACHED),
            out_head: Cell::new(0),
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
        let loop_ = vm.uws_loop();
        let g = vm.rare_data().test_parallel_ipc_group(loop_);
        // First Owner to call wins the vtable; coordinator and worker run in
        // separate processes so there's never more than one Owner type sharing
        // this group.
        if g.vtable.is_none() {
            // cannot use `uws::vtable::make::<PosixHandlers<Owner>>()`
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
    pub(crate) pipe: Cell<*mut uv::Pipe>,
    /// Read scratch — libuv asks us to allocate before each read.
    /// Wrapped so every byte is interior-mutable: libuv forms
    /// `&mut Channel` from the stored root on each read; a plain array here
    /// would be the one field where that retag pops the shared views held
    /// during frame decoding.
    pub(crate) read_chunk: JsCell<[u8; 16 * 1024]>,
    /// Payload owned by the in-flight uv_write; must stay stable until the
    /// callback. New writes go to `out` until this completes, then the buffers
    /// swap.
    pub(crate) inflight: JsCell<Vec<u8>>,
    pub(crate) write_req: JsCell<uv::uv_write_t>,
    pub(crate) write_buf: JsCell<uv::uv_buf_t>,
}

#[cfg(windows)]
impl Default for WindowsBackend {
    fn default() -> Self {
        Self {
            pipe: Cell::new(core::ptr::null_mut()),
            read_chunk: JsCell::new([0u8; 16 * 1024]),
            inflight: JsCell::new(Vec::new()),
            write_req: JsCell::new(bun_core::ffi::zeroed::<uv::uv_write_t>()),
            write_buf: JsCell::new(uv::uv_buf_t::init(b"")),
        }
    }
}

// -- adopt -------------------------------------------------------------------

impl<Owner: ChannelOwner> Channel<Owner> {
    /// Adopt a duplex fd into the channel and start reading. POSIX: the
    /// socketpair end. Windows: the inherited named-pipe end (worker side).
    // callers (`runner.rs`, `Worker.rs`) only hold `&VirtualMachine`;
    // the upstream `rare_data()` / `test_parallel_ipc_group()` accessors require
    // `&mut`. Take a raw `*const` and cast
    // away const locally — single-threaded init path. A `&VirtualMachine`
    // parameter would trip `invalid_reference_casting` on the `&T → &mut T`
    // promotion; the raw-pointer route sidesteps that lint while keeping both
    // call sites (which pass `&`/`&mut` and coerce) unchanged.
    /// `this` is the channel's address derived from the owner's `&mut`.
    pub(crate) fn adopt(this: *mut Self, vm: *const VirtualMachine, fd: Fd) -> bool {
        // SAFETY: caller passes `&raw mut owner.channel` (live for the call).
        let self_ = unsafe { &*this };
        self_.root.set(this);
        Self::adopt_impl(self_, this, vm, fd)
    }

    fn adopt_impl(&self, this: *mut Self, _vm: *const VirtualMachine, fd: Fd) -> bool {
        #[cfg(windows)]
        {
            let _ = this; // registered via `adopt_pipe_impl` from `self.root`
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
            if !self.adopt_pipe_impl(pipe) {
                // Caller still owns `pipe` on adopt_pipe failure.
                // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
                unsafe { uv::Pipe::close_and_destroy(pipe) };
                return false;
            }
            return true;
        }
        #[cfg(not(windows))]
        {
            // VM is process-singleton and accessed only from the main
            // thread here; route through the safe singleton accessor.
            let vm: &mut VirtualMachine = VirtualMachine::get().as_mut();
            let g = Self::ensure_posix_group(vm);
            let Some(sock) = Socket::from_fd(g, uws::SocketKind::Dynamic, fd, this, true) else {
                // us_socket_from_fd does NOT take ownership on failure; leaving
                // the inherited IPC endpoint open keeps the peer process alive.
                fd.close();
                return false;
            };
            self.backend.socket.set(sock);
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
    pub(crate) fn adopt_pipe(
        this: *mut Self,
        _vm: *const VirtualMachine,
        pipe: *mut uv::Pipe,
    ) -> bool {
        // SAFETY: caller passes `&raw mut owner.channel` (live for the call).
        let self_ = unsafe { &*this };
        self_.root.set(this);
        self_.adopt_pipe_impl(pipe)
    }

    #[cfg(windows)]
    fn adopt_pipe_impl(&self, pipe: *mut uv::Pipe) -> bool {
        // The read callbacks are expressed via the `StreamReader` trait impl
        // below and routed through `read_start_ctx`, which stashes `self` in
        // `handle.data`.
        // SAFETY: `pipe` is a live, init'ed `Box<Pipe>` allocation owned by the
        // caller; we only borrow it to start reading.
        let rc = unsafe { (*pipe).read_start_ctx::<Self>(self.root.get()) };
        if let Some(e) = rc.to_error(bun_sys::Tag::listen) {
            bun_core::debug_warn!(
                "Channel.adoptPipe: readStart failed: {}",
                e.name().escape_ascii(),
            );
            // Caller still owns `pipe` on failure and is responsible
            // for `close_and_destroy`.
            return false;
        }
        self.backend.pipe.set(pipe);
        true
    }

    // -- write ---------------------------------------------------------------

    /// Queue and write a complete encoded frame. If the kernel accepts only
    /// part of it (or there's already a backlog), the remainder lands in `out`
    /// and the writable callback finishes it.
    pub(crate) fn send(&self, frame_bytes: &[u8]) {
        if self.done.get() {
            return;
        }
        #[cfg(windows)]
        {
            return self.send_windows(frame_bytes);
        }
        #[cfg(not(windows))]
        {
            if !self.out.get().is_empty() {
                self.out.with_mut(|out| out.extend_from_slice(frame_bytes));
                return;
            }
            let wrote = self.backend.socket.get().write(frame_bytes);
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
    }

    #[cfg(windows)]
    fn send_windows(&self, frame_bytes: &[u8]) {
        // A uv_write is in flight — queue behind it.
        if !self.backend.inflight.get().is_empty() {
            self.out.with_mut(|out| out.extend_from_slice(frame_bytes));
            return;
        }
        let pipe = self.backend.pipe.get();
        if pipe.is_null() {
            return;
        }
        // Try a synchronous write first. uv_try_write on a Windows
        // UV_NAMED_PIPE always returns EAGAIN (vendor/libuv/src/win/stream.c),
        // so this currently always falls through to submit_windows_write —
        // kept because EBADF/EPIPE here mean the pipe is dead and must not
        // silently drop the frame.
        let buf = uv::uv_buf_t::init(frame_bytes);
        // SAFETY: `pipe` is the live Box-allocated uv_pipe_t owned by this channel.
        let rc = unsafe { (*pipe).try_write(core::slice::from_ref(&buf)) };
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
        self.out
            .with_mut(|out| out.extend_from_slice(&frame_bytes[w..]));
        self.submit_windows_write();
    }

    #[cfg(windows)]
    fn submit_windows_write(&self) {
        if self.out.get().is_empty() || !self.backend.inflight.get().is_empty() || self.done.get() {
            return;
        }
        let pipe = self.backend.pipe.get();
        if pipe.is_null() {
            return;
        }
        // Swap: out → inflight (stable for uv_write), out becomes empty.
        let out = self.out.replace(Vec::new());
        let prev_inflight = self.backend.inflight.replace(out);
        self.out.set(prev_inflight);
        self.backend
            .write_buf
            .set(uv::uv_buf_t::init(self.backend.inflight.get().as_slice()));
        let this: *mut Self = self.root.get();
        // SAFETY: `p` is the `this` handed to `write` below — the live Channel
        // stashed for the callback; every Channel method is `&self`.
        let on_write: fn(*mut Self, uv::ReturnCode) =
            |p, s| unsafe { WindowsHandlers::<Owner>::on_write(&*p, s) };
        // SAFETY: `pipe` is the live Box-allocated uv_pipe_t owned by this
        // channel; `write_req`/`write_buf`/`inflight` live in `self`, which is
        // address-stable and outlives the write, so libuv may hold them until
        // `on_write` fires.
        let rc = unsafe {
            (*self.backend.write_req.as_ptr()).write(
                (*pipe).as_stream(),
                &*self.backend.write_buf.as_ptr(),
                this,
                on_write,
            )
        };
        if rc.is_err() {
            self.backend.inflight.with_mut(|inflight| inflight.clear());
            self.mark_done();
        }
    }

    /// True while the underlying socket/pipe is still open. When `done` is set
    /// with the transport still attached, it was not a clean close: a corrupt
    /// frame (`corrupt_frame`) or, on Windows, a failed write.
    pub(crate) fn is_attached(&self) -> bool {
        #[cfg(windows)]
        {
            return !self.backend.pipe.get().is_null();
        }
        #[cfg(not(windows))]
        {
            !self.backend.socket.get().is_detached()
        }
    }

    /// True while any encoded bytes are still queued or in flight.
    pub(crate) fn has_pending_writes(&self) -> bool {
        if !self.out.get().is_empty() {
            return true;
        }
        #[cfg(windows)]
        {
            return !self.backend.inflight.get().is_empty();
        }
        #[cfg(not(windows))]
        {
            false
        }
    }

    /// Best-effort drain of any buffered writes.
    pub fn flush(&self) {
        #[cfg(windows)]
        {
            return self.submit_windows_write();
        }
        #[cfg(not(windows))]
        {
            while !self.done.get() {
                let mut pending = self.out.replace(Vec::new());
                let mut head = self.backend.out_head.get();
                debug_assert!(head <= pending.len());
                if pending.len() <= head {
                    self.backend.out_head.set(0);
                    self.out.set(pending);
                    return;
                }
                let wrote = self.backend.socket.get().write(&pending[head..]);
                let w = usize::try_from(wrote)
                    .unwrap_or(0)
                    .min(pending.len() - head);
                head += w;
                if head == pending.len() {
                    pending.clear();
                    head = 0;
                } else if head >= pending.len() - head {
                    // Sent prefix caught up to the tail: compact (amortized linear).
                    pending.drain_front(head);
                    head = 0;
                }
                self.backend.out_head.set(head);
                self.out.with_mut(|cur| {
                    pending.extend_from_slice(cur);
                    *cur = pending;
                });
                if wrote <= 0 {
                    return;
                }
            }
        }
    }

    // -- frame decode (shared) -----------------------------------------------

    fn ingest(&self, data: &[u8]) {
        if self.done.get() {
            return;
        }
        let mut buf = self.r#in.replace(Vec::new());
        buf.extend_from_slice(data);
        let mut head: usize = 0;
        while buf.len() - head >= 5 {
            let len = u32::from_le_bytes(buf[head..][..4].try_into().unwrap());
            if len > frame::MAX_PAYLOAD {
                self.mark_corrupt();
                return;
            }
            if buf.len() - head < 5usize + len as usize {
                break;
            }
            let Ok(kind) = frame::Kind::try_from(buf[head + 4]) else {
                head += 5usize + len as usize;
                continue;
            };
            let mut rd = frame::Reader {
                p: &buf[head + 5..][..len as usize],
            };
            // SAFETY: see `owner_ptr()` — the Owner outlives all callbacks and
            // the `&mut Owner` lives only for this call.
            let owner: &mut Owner = unsafe { &mut *self.owner_ptr() };
            owner.on_channel_frame(kind, &mut rd);
            head += 5usize + len as usize;
        }
        buf.drain_front(head);
        self.r#in.with_mut(|cur| {
            if cur.is_empty() {
                *cur = buf;
            } else {
                buf.extend_from_slice(cur);
                *cur = buf;
            }
        });
    }

    fn mark_done(&self) {
        if self.done.get() {
            return;
        }
        self.done.set(true);
        // SAFETY: see `owner_ptr()`.
        unsafe { (*self.owner_ptr()).on_channel_done() };
    }

    /// `mark_done` for an undecodable stream; the transport is left attached
    /// so the owner's `on_channel_done` sees it as a protocol error.
    fn mark_corrupt(&self) {
        self.corrupt_frame.set(true);
        self.mark_done();
    }
}

impl<Owner> Drop for Channel<Owner> {
    fn drop(&mut self) {
        self.done.set(true);
        #[cfg(windows)]
        {
            let p = self.backend.pipe.replace(core::ptr::null_mut());
            if !p.is_null() {
                // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
                unsafe { uv::Pipe::close_and_destroy(p) };
            }
            // `inflight` Vec drops automatically.
        }
        #[cfg(not(windows))]
        {
            let sock = self.backend.socket.replace(Socket::DETACHED);
            if !sock.is_detached() {
                sock.close(uws::CloseCode::Normal);
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
struct PosixHandlers<Owner: ChannelOwner>(PhantomData<Owner>);

/// Ext slot type for the usockets vtable: the slot holds a `*mut Channel<Owner>`.
// Inherent associated types are unstable in Rust, so this lives as a free alias.
#[cfg(not(windows))]
type PosixExt<Owner> = *mut Channel<Owner>;

#[cfg(not(windows))]
impl<Owner: ChannelOwner> PosixHandlers<Owner> {
    /// Per-Owner static vtable. `&Self::VTABLE` const-promotes to
    /// `&'static SocketGroupVTable` (all fields are `Option<fn>`; no Drop).
    const VTABLE: uws::SocketGroupVTable = uws::SocketGroupVTable {
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

    /// Recover `&Channel<Owner>` from the socket ext slot.
    ///
    /// # Safety
    /// `s` is a live us_socket_t whose ext was sized for and stamped with
    /// `*mut Channel<Owner>` in `adopt()`; the owner outlives all usockets
    /// callbacks (see module doc).
    #[inline(always)]
    unsafe fn chan<'a>(s: *mut uws::us_socket_t) -> &'a Channel<Owner> {
        // SAFETY: caller upholds this fn's contract — `s` is live and its ext
        // slot was stamped with `*mut Channel<Owner>` in `adopt()`.
        unsafe { &**(*s).ext::<PosixExt<Owner>>() }
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
        chan.backend.socket.set(Socket::DETACHED);
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
struct WindowsHandlers<Owner: ChannelOwner>(PhantomData<Owner>);

#[cfg(windows)]
impl<Owner: ChannelOwner> WindowsHandlers<Owner> {
    fn on_alloc(self_: &mut Channel<Owner>, suggested: usize) -> &mut [u8] {
        let _ = suggested;
        // SAFETY: hands libuv the cell payload; the buffer is only written by
        // libuv until `on_read` consumes it, all on this thread.
        let buf: &mut [u8; 16 * 1024] = unsafe { &mut *self_.backend.read_chunk.as_ptr() };
        &mut buf[..]
    }
    fn on_error(self_: &Channel<Owner>, err: bun_sys::E) {
        // libuv frames this pipe itself (ipc=1), so bytes the peer writes
        // straight to fd 3 fail its frame-header check and surface here as a
        // read error instead of reaching `ingest`; report it the way `ingest`
        // reports a bad frame, before detaching. EOF is the peer closing its
        // end: mirror the POSIX on_close path and detach first so it reads as
        // a clean close.
        if err != bun_sys::E::EOF {
            self_.mark_corrupt();
        }
        let p = self_.backend.pipe.replace(core::ptr::null_mut());
        if !p.is_null() {
            // SAFETY: Box-allocated; close_and_destroy reclaims via heap::take.
            unsafe { uv::Pipe::close_and_destroy(p) };
        }
        self_.mark_done();
    }
    fn on_write(self_: &Channel<Owner>, status: uv::ReturnCode) {
        self_.backend.inflight.with_mut(|inflight| inflight.clear());
        if self_.done.get() {
            return;
        }
        if status.is_err() {
            self_.mark_done();
            return;
        }
        self_.submit_windows_write();
    }
}

/// Adapter from `UvStream::read_start_ctx` to `WindowsHandlers`; expressed as
/// a trait impl so the `extern "C"` trampoline stays zero-alloc.
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
        // SAFETY: `this` is the live `Channel` stashed in `handle.data` by
        // `read_start_ctx`; `data` points into its `read_chunk` and is only
        // read (copied by `ingest`).
        let this = unsafe { &*this };
        this.ingest(data);
    }
}
