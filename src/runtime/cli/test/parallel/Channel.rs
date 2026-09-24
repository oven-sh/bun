//! Bidirectional IPC channel for `bun test --parallel`. Reads are
//! frame-decoded in the loop's data callback; writes go through the platform
//! socket/pipe with backpressure buffered and drained via the loop, so a full
//! kernel buffer never truncates a frame. The owner type provides
//! `on_channel_frame(kind, &mut Frame::Reader)` and `on_channel_done()`.
//!
//! POSIX backend: `uws::NewSocketHandler` adopted from a socketpair fd.
//! Windows backend: a `bun_io::windows::Pipe` over an end of the duplex pipe
//! spawn makes for fd 3. Both ends are this binary, so the bytes on the pipe
//! are the frames themselves.
//!
//! Lifetime: a `Channel` is embedded as a field in an owner that outlives all
//! pipe/usockets callbacks (the coordinator's `Worker[]`, or the worker's
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
#[cfg(windows)]
use bun_io::windows::{Pipe, PipeOrigin, ReadEvent};
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::Fd;
use bun_sys::FdExt as _;
#[cfg(not(windows))]
use bun_uws as uws;

use super::frame;

/// The owner implements [`bun_core::IntrusiveField<Channel<Self>>`]
/// (via `bun_core::intrusive_field!`) plus the two callbacks below.
pub(crate) trait ChannelOwner: bun_core::IntrusiveField<Channel<Self>> {
    fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>);
    fn on_channel_done(&mut self);
}

// The struct itself carries no `ChannelOwner` bound so that owners
// (Worker, WorkerCommands) can embed `Channel<Self>` as a field before their
// `impl ChannelOwner` is in scope. Method impls that recover the owner via
// `IntrusiveField::OFFSET` keep the bound. (Rust also forbids a stricter bound
// on `Drop` than on the struct, so Drop/Default below are unbounded too.)
pub(crate) struct Channel<Owner> {
    /// Incoming bytes that don't yet form a complete frame.
    pub(crate) r#in: JsCell<Vec<u8>>,
    /// Outgoing bytes the kernel didn't accept yet.
    pub out: JsCell<Vec<u8>>,
    pub(crate) done: Cell<bool>,
    /// The peer's byte stream stopped decoding as frames, i.e. something in
    /// the peer wrote straight to fd 3: a length `ingest` rejected. Set
    /// together with `done`, transport still attached. The coordinator kills
    /// such a worker and reports this rather than the exit status it caused.
    pub(crate) corrupt_frame: Cell<bool>,

    pub(crate) backend: Backend,

    root: Cell<*mut Channel<Owner>>,

    _owner: PhantomData<*mut Owner>,
}

#[cfg(windows)]
pub(crate) type Backend = WindowsBackend;
#[cfg(not(windows))]
pub(crate) type Backend = PosixBackend;

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
pub(crate) type Socket = uws::NewSocketHandler<false>;

#[cfg(not(windows))]
pub(crate) struct PosixBackend {
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

// -- Windows (pipe) ----------------------------------------------------------

#[cfg(windows)]
#[derive(Default)]
pub(crate) struct WindowsBackend {
    pub(crate) pipe: JsCell<Option<Pipe>>,
    /// A write is with the pipe; `out` collects what follows it.
    writing: Cell<bool>,
}

// -- adopt -------------------------------------------------------------------

impl<Owner: ChannelOwner> Channel<Owner> {
    /// Adopt a duplex fd into the channel and start reading. POSIX: the
    /// socketpair end. Windows: an end of the pipe spawn made for fd 3;
    /// `inherited` says it is the worker's: the coordinator made it for this
    /// process alone. Takes `fd` either way.
    /// `this` is the channel's address derived from the owner's `&mut`.
    pub(crate) fn adopt(this: *mut Self, fd: Fd, inherited: bool) -> bool {
        // SAFETY: caller passes `&raw mut owner.channel` (live for the call).
        let self_ = unsafe { &*this };
        self_.root.set(this);
        Self::adopt_impl(self_, this, fd, inherited)
    }

    fn adopt_impl(&self, this: *mut Self, fd: Fd, inherited: bool) -> bool {
        #[cfg(windows)]
        {
            let loop_ = VirtualMachine::get().as_mut().uws_loop();
            let origin = if inherited {
                PipeOrigin::InheritedUnshared
            } else {
                PipeOrigin::Created
            };
            let opened = Pipe::open(loop_, fd, origin, true);
            // The pipe stays ref'd so the loop blocks for the peer's first frame.
            let started =
                opened.and_then(|mut pipe| match pipe.read_start(this, Self::on_pipe_read) {
                    Ok(()) => Ok(pipe),
                    Err(e) => {
                        pipe.disown();
                        Err(e)
                    }
                });
            return match started {
                Ok(pipe) => {
                    self.backend.pipe.set(Some(pipe));
                    true
                }
                Err(e) => {
                    bun_core::debug_warn!(
                        "Channel.adopt: opening the pipe failed: {}",
                        e.name().escape_ascii(),
                    );
                    // Leaving the endpoint open keeps the peer process alive.
                    fd.close();
                    false
                }
            };
        }
        #[cfg(not(windows))]
        {
            let _ = inherited;
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

    /// A pipe takes a write whole and reports when it is through, so frames
    /// queue in `out` while one is in flight and go out together after it.
    #[cfg(windows)]
    fn send_windows(&self, frame_bytes: &[u8]) {
        self.out.with_mut(|out| out.extend_from_slice(frame_bytes));
        self.submit_windows_write();
    }

    #[cfg(windows)]
    fn submit_windows_write(&self) {
        if self.backend.writing.get() || self.out.get().is_empty() || self.done.get() {
            return;
        }
        let bytes = self.out.replace(Vec::new());
        let submitted = self.backend.pipe.with_mut(|pipe| match pipe {
            Some(pipe) => pipe
                .write_owned(bytes, self.root.get(), Some(Self::on_pipe_write))
                .is_ok(),
            None => false,
        });
        if submitted {
            self.backend.writing.set(true);
        } else {
            self.mark_done();
        }
    }

    /// # Safety
    /// `this` is the channel's root pointer; a pipe only reports while the
    /// channel has it open.
    #[cfg(windows)]
    unsafe fn on_pipe_write(this: *mut Self, result: bun_sys::Result<usize>) {
        // SAFETY: caller contract.
        let self_ = unsafe { &*this };
        self_.backend.writing.set(false);
        if self_.done.get() {
            return;
        }
        if result.is_err() {
            self_.mark_done();
            return;
        }
        self_.submit_windows_write();
    }

    /// # Safety
    /// As [`on_pipe_write`](Self::on_pipe_write).
    #[cfg(windows)]
    unsafe fn on_pipe_read(this: *mut Self, event: ReadEvent<'_>) {
        // SAFETY: caller contract.
        let self_ = unsafe { &*this };
        match event {
            ReadEvent::Data(bytes) => self_.ingest(bytes.as_slice()),
            // The peer closed its end (or the pipe broke): detach first so it
            // reads as a close, like the POSIX on_close path.
            ReadEvent::Eof | ReadEvent::EndOfWrite | ReadEvent::Err(_) => {
                self_.backend.pipe.set(None);
                self_.mark_done();
            }
        }
    }

    /// True while the underlying socket/pipe is still open. When `done` is set
    /// with the transport still attached, it was not a clean close: a corrupt
    /// frame (`corrupt_frame`) or, on Windows, a failed write.
    pub(crate) fn is_attached(&self) -> bool {
        #[cfg(windows)]
        {
            return self.backend.pipe.get().is_some();
        }
        #[cfg(not(windows))]
        {
            !self.backend.socket.get().is_detached()
        }
    }

    /// True while any encoded bytes are still queued or in flight.
    pub(crate) fn has_pending_writes(&self) -> bool {
        #[cfg(windows)]
        {
            !self.out.get().is_empty() || self.backend.writing.get()
        }
        #[cfg(not(windows))]
        {
            !self.out.get().is_empty()
        }
    }

    /// Best-effort drain of any buffered writes.
    #[cfg(not(windows))]
    pub(crate) fn flush(&self) {
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
        // Windows: the pipe closes as the backend drops.
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
