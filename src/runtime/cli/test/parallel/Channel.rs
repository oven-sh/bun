//! Bidirectional IPC channel for `bun test --parallel`. Reads are
//! frame-decoded in the loop's data callback; writes go through the platform
//! socket/pipe with backpressure buffered and drained via the loop, so a full
//! kernel buffer never truncates a frame. The owner type provides
//! `on_channel_frame(kind, &mut Frame::Reader)` and `on_channel_done()`.
//!
//! POSIX backend: `uws::NewSocketHandler` adopted from a socketpair fd.
//! Windows backend: engine `PipeHandle` over the inherited duplex named-pipe end (same
//! mechanism as `Bun.spawn({ipc})` / `process.send()`).
//!
//! Lifetime: a `Channel` is embedded as a field in an owner that outlives all
//! uv/usockets callbacks (the coordinator's `Worker[]`, or the worker's
//! `WorkerLoop` which lives for the process). The owner is recovered via
//! `container_of` (field offset) so the channel default-inits without a
//! self-pointer. `Drop` assumes no write is in flight — true for both call
//! sites (start() errdefer and reap_worker after the peer has exited).

#[cfg(not(windows))]
use core::ffi::c_void;
use core::marker::PhantomData;

#[cfg(windows)]
use crate::api::bun::process as spawn;
use bun_collections::VecExt;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::Fd;
use bun_sys::FdExt as _;
#[cfg(not(windows))]
use bun_uws as uws;

#[cfg(windows)]
use bun_sys::windows::win_error;

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
        // `Owner` that outlives all callbacks (see module doc).
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
        // borrowck split — `rare_data()` mutably borrows `vm`, but
        // the group accessor needs `vm` again for `uws_loop()`. The two touch
        // disjoint storage (the `Box<RareData>` payload vs the loop pointer
        // field), so a raw-pointer reborrow is sound here.
        let rd: *mut bun_jsc::rare_data::RareData = vm.rare_data();
        // SAFETY: `rd` points into `vm`'s boxed RareData, which outlives this
        // call; the accessor only reads `vm.uws_loop()` (a separate field).
        let g = unsafe { (*rd).test_parallel_ipc_group(vm) };
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
    pub pipe: Option<Box<bun_iocp::pipe::PipeHandle>>,
    /// Engine reads land here (single-buf zero-copy contract: the Channel is
    /// heap-pinned by its owner, so this address is stable across reads).
    pub read_chunk: [u8; 16 * 1024],
    /// Payload owned by the in-flight engine write; must stay stable until
    /// the callback. New writes go to `out` until this completes, then the
    /// buffers swap.
    pub inflight: Vec<u8>,
}

#[cfg(windows)]
impl Default for WindowsBackend {
    fn default() -> Self {
        Self {
            pipe: None,
            read_chunk: [0u8; 16 * 1024],
            inflight: Vec::new(),
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
    pub fn adopt(&mut self, vm: *const VirtualMachine, fd: Fd) -> bool {
        // VM is process-singleton and accessed only from the main
        // thread here; route through the safe singleton accessor.
        let _ = vm;
        let vm: &mut VirtualMachine = VirtualMachine::get().as_mut();
        #[cfg(windows)]
        {
            // Both ends of this channel are Bun (test coordinator + worker),
            // so libuv's symmetric ipc=true framing is gone from BOTH sides at
            // once — raw bytes carry the channel's own frame protocol.
            // Duplicate-then-adopt (PIPE-19 shape): the engine owns the dup;
            // the inherited table fd closes immediately after.
            let mut dup: bun_windows_sys::HANDLE = core::ptr::null_mut();
            // SAFETY: `fd` is the live inherited IPC end; out-param is local.
            let ok = unsafe {
                bun_windows_sys::kernel32::DuplicateHandle(
                    bun_windows_sys::GetCurrentProcess(),
                    fd.native(),
                    bun_windows_sys::GetCurrentProcess(),
                    &raw mut dup,
                    0,
                    bun_windows_sys::FALSE,
                    bun_windows_sys::DUPLICATE_SAME_ACCESS,
                )
            };
            if ok == 0 {
                bun_core::debug_warn!(
                    "Channel.adopt: DuplicateHandle failed: {}",
                    bun_sys::windows::Win32Error::get().int(),
                );
                return false;
            }
            // SAFETY: the VM's loop is live for the channel's lifetime; `dup`
            // ownership transfers to the engine (closed by open on failure).
            let pipe = match unsafe {
                bun_iocp::pipe::PipeHandle::open(
                    bun_iocp::usockets::native_loop((*vm).platform_loop().cast()),
                    dup,
                )
            } {
                Ok(b) => b,
                Err(e) => {
                    bun_core::debug_warn!("Channel.adopt: pipe open failed: {}", e.int());
                    // SAFETY: open failed without adopting; the dup is still ours.
                    unsafe { bun_windows_sys::CloseHandle(dup) };
                    return false;
                }
            };
            if !self.adopt_pipe(vm, pipe) {
                return false;
            }
            let _ = fd.close();
            return true;
        }
        #[cfg(not(windows))]
        {
            let g = Self::ensure_posix_group(vm);
            let Some(sock) = Socket::from_fd(
                g,
                uws::SocketKind::Dynamic,
                fd,
                std::ptr::from_mut(self),
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

    /// Windows-only: adopt an engine pipe already opened by spawn (the
    /// `.ipc` extra-fd parent end, or the worker's just-opened pipe). Starts
    /// reading. Owns `pipe` on both paths — closes it itself on failure.
    ///
    /// We keep the pipe ref'd:
    /// the worker (and the coordinator before workers register process exit
    /// handles) has nothing else keeping `uv_loop_alive()` true, so unref'ing
    /// here makes autoTick() take the tickWithoutIdle (NOWAIT) path and never
    /// block for the peer's first frame. The pipe is closed explicitly in
    /// `close()` / `Drop`, and both sides exit via Global.exit / drive()
    /// returning, so the extra ref never holds the process open.
    #[cfg(windows)]
    pub fn adopt_pipe(
        &mut self,
        _vm: *const VirtualMachine,
        mut pipe: Box<bun_iocp::pipe::PipeHandle>,
    ) -> bool {
        let this: *mut Self = core::ptr::from_mut(self);
        // SAFETY: `read_chunk` is address-stable (the Channel is heap-pinned
        // by its owner) and outlives the pipe; `this` is stashed as cb data.
        let rc = unsafe {
            pipe.read_start(
                self.backend.read_chunk.as_mut_ptr(),
                self.backend.read_chunk.len(),
                Self::on_engine_read,
                this.cast(),
            )
        };
        if let Err(e) = rc {
            bun_core::debug_warn!("Channel.adoptPipe: readStart failed: {}", e.int());
            // Per contract this fn owns the pipe: tear it down here.
            spawn::close_engine_pipe(pipe);
            return false;
        }
        self.backend.pipe = Some(pipe);
        true
    }

    /// Engine read callback. Auto re-armed by the engine after return.
    #[cfg(windows)]
    unsafe fn on_engine_read(
        _lp: &mut bun_iocp::Loop,
        data: *mut core::ffi::c_void,
        _buf: *mut u8,
        n: usize,
        err: bun_windows_sys::Win32Error,
    ) {
        // SAFETY: `data` is the live Channel stashed at read_start; engine
        // cbs fire on the loop thread with no other Rust borrow live.
        let this = unsafe { &mut *data.cast::<Self>() };
        if this.done {
            return;
        }
        if err != bun_windows_sys::Win32Error::SUCCESS {
            let e = match win_error::classify_read(err) {
                win_error::ReadClass::Eof => bun_sys::E::EOF,
                win_error::ReadClass::Err(e) => e,
            };
            WindowsHandlers::<Owner>::on_error(this, e);
            return;
        }
        this.r#in.extend_from_slice(&this.backend.read_chunk[..n]);
        // Run the shared decode loop; the empty append is a no-op.
        this.ingest(&[]);
    }

    /// Engine write callback: exactly-once per write, incl. abort on close.
    #[cfg(windows)]
    unsafe fn on_engine_write(
        _lp: &mut bun_iocp::Loop,
        data: *mut core::ffi::c_void,
        _written: usize,
        err: bun_windows_sys::Win32Error,
    ) {
        // SAFETY: as in on_engine_read.
        let this = unsafe { &mut *data.cast::<Self>() };
        this.backend.inflight.clear();
        if this.done {
            return;
        }
        if err != bun_windows_sys::Win32Error::SUCCESS {
            this.mark_done();
            return;
        }
        this.submit_windows_write();
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
        // An engine write is in flight — queue behind it; the write callback
        // submits the backlog. Dead-pipe detection happens in that callback
        // (exactly-once, incl. OPERATION_ABORTED on close).
        self.out.extend_from_slice(frame_bytes);
        if self.backend.inflight.is_empty() {
            self.submit_windows_write();
        }
    }

    #[cfg(windows)]
    fn submit_windows_write(&mut self) {
        if self.out.is_empty() || !self.backend.inflight.is_empty() || self.done {
            return;
        }
        // Capture the raw self pointer for the engine cb data before taking
        // field borrows (the from_mut borrow ends immediately).
        let this: *mut Self = core::ptr::from_mut(self);
        // Swap: out → inflight (stable until the write cb), out becomes empty.
        core::mem::swap(&mut self.backend.inflight, &mut self.out);
        let Some(pipe) = self.backend.pipe.as_mut() else {
            return;
        };
        // SAFETY: `inflight` is address-stable until the exactly-once cb;
        // single-buf writes are zero-copy per the engine contract.
        let rc = unsafe {
            pipe.write(
                &[self.backend.inflight.as_slice()],
                Some(Self::on_engine_write),
                this.cast(),
            )
        };
        if rc.is_err() {
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
                // take() makes this idempotent; the engine close is safe on a
                // handle with in-flight work (drained before the close cb).
                spawn::close_engine_pipe(p);
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
                head += 5usize + len as usize;
                continue;
            };
            // borrowck split — `rd` borrows `self.r#in` while
            // `owner()` would re-borrow `*self` mutably. Capture the owner raw
            // pointer *before* forming `rd` (so the `&mut *self` reborrow ends
            // immediately), then recover `&mut Owner` from it after. Same
            // `container_of` arithmetic as `owner()`. The callback never
            // touches `self.r#in` (it only reads `rd` and may write other
            // channel fields / call `send()`), so the aliasing is sound.
            // SAFETY: `self` is embedded at `Owner::OFFSET` inside an `Owner`
            // that outlives all callbacks (see `Channel::owner()` / module doc).
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
                spawn::close_engine_pipe(p);
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
pub(crate) struct PosixHandlers<Owner: ChannelOwner>(PhantomData<Owner>);

/// Ext slot type for the usockets vtable: the slot holds a `*mut Channel<Owner>`.
// Inherent associated types are unstable in Rust, so this lives as a free alias.
#[cfg(not(windows))]
pub(crate) type PosixExt<Owner> = *mut Channel<Owner>;

#[cfg(not(windows))]
impl<Owner: ChannelOwner> PosixHandlers<Owner> {
    /// Per-Owner static vtable. `&Self::VTABLE` const-promotes to
    /// `&'static SocketGroupVTable` (all fields are `Option<fn>`; no Drop).
    pub(crate) const VTABLE: uws::SocketGroupVTable = uws::SocketGroupVTable {
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
        // SAFETY: caller upholds this fn's contract — `s` is live and its ext
        // slot was stamped with `*mut Channel<Owner>` in `adopt()`.
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
pub(crate) struct WindowsHandlers<Owner: ChannelOwner>(PhantomData<Owner>);

#[cfg(windows)]
impl<Owner: ChannelOwner> WindowsHandlers<Owner> {
    pub(crate) fn on_error(self_: &mut Channel<Owner>, _err: bun_sys::E) {
        // Mirror the POSIX on_close path: detach the transport before
        // signalling done so the owner can tell EOF apart from a protocol
        // error (where the pipe is still attached).
        if let Some(p) = self_.backend.pipe.take() {
            spawn::close_engine_pipe(p);
        }
        self_.mark_done();
    }
}
