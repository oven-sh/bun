//! Bidirectional IPC channel for `bun test --parallel`. Reads are
//! frame-decoded by the owner between ticks; writes go through the platform
//! socket/pipe with backpressure buffered and drained via the loop, so a full
//! kernel buffer never truncates a frame.
//!
//! POSIX backend: `uws::NewSocketHandler` adopted from a socketpair fd.
//! Windows backend: `uv::Pipe` over the inherited duplex named-pipe end (same
//! mechanism as `Bun.spawn({ipc})` / `process.send()`).
//!
//! Lifetime: a `Channel` is embedded as a field in an owner that outlives all
//! uv/usockets callbacks (the coordinator's `Worker[]`, or the worker's
//! `CoordinatorLink` which lives for the process). On Windows `OwnedChannel` boxes it.

use core::cell::Cell;
#[cfg(not(windows))]
use core::ffi::c_void;

use bun_collections::VecExt;
#[cfg(windows)]
use bun_io::{IoEvent, OwnedPipe, Owner, PollTag};
#[cfg(windows)]
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::VecCellExt as _;
use bun_sys::Fd;
#[cfg(not(windows))]
use bun_sys::FdExt as _;
#[cfg(not(windows))]
use bun_uws as uws;
#[cfg(not(windows))]
use bun_uws_sys::thunk::ExtSlot;

#[cfg(windows)]
use bun_ptr::{AliasableBox, CellExt as _};
#[cfg(windows)]
use bun_sys::ReturnCodeExt as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

use super::frame;

#[derive(Default)]
pub(crate) struct Channel {
    /// Incoming bytes that the owner has not read as frames yet.
    r#in: Cell<Vec<u8>>,
    /// `in` has grown since the owner last took it.
    has_incoming: Cell<bool>,
    /// Outgoing bytes the kernel didn't accept yet.
    pub out: Cell<Vec<u8>>,
    pub(crate) done: Cell<bool>,
    /// The peer's byte stream stopped decoding as frames, i.e. something in
    /// the peer wrote straight to fd 3: a length `next_frame` rejected, or on
    /// Windows a read error from libuv's own IPC framing underneath ours. Set
    /// together with `done`. The coordinator kills
    /// such a worker and reports this rather than the exit status it caused.
    pub(crate) corrupt_frame: Cell<bool>,
    /// A corrupt frame or a failed write that the coordinator has not killed the worker for yet.
    pub(crate) kill_pending: Cell<bool>,

    pub(crate) backend: Backend,
}

/// `in`, taken out while its frames are decoded.
pub(crate) struct IncomingFrames {
    bytes: Vec<u8>,
    head: usize,
    is_corrupt: bool,
}

impl IncomingFrames {
    pub(crate) fn next_frame(&mut self) -> Option<(frame::Kind, frame::Reader<'_>)> {
        loop {
            let (&[ref len @ .., kind], rest) =
                self.bytes[self.head..].split_first_chunk::<{ frame::HEADER_LEN }>()?;
            let len = u32::from_le_bytes(*len);
            if len > frame::MAX_PAYLOAD {
                self.is_corrupt = true;
                return None;
            }
            let p = rest.get(..len as usize)?;
            self.head += frame::HEADER_LEN + p.len();
            if let Ok(kind) = frame::Kind::try_from(kind) {
                return Some((kind, frame::Reader { p }));
            }
        }
    }
}

#[cfg(windows)]
pub(crate) type Backend = WindowsBackend;
#[cfg(not(windows))]
pub(crate) type Backend = PosixBackend;

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
impl Channel {
    /// Shared embedded group for this channel. Uses `.dynamic` kind +
    /// its own vtable because the channel is an internal-only one-off — not worth a
    /// `SocketKind` value of its own. The per-file isolation swap skips
    /// `rare.test_parallel_ipc_group` so the coordinator link survives.
    fn ensure_posix_group(vm: &VirtualMachine) -> &uws::SocketGroup {
        let loop_ = vm.uws_loop();
        let g = vm.rare_data().test_parallel_ipc_group(loop_);
        g.vtable.set(Some(uws::vtable::make::<Self>()));
        g
    }
}

// -- Windows (uv.Pipe) -------------------------------------------------------

#[cfg(windows)]
const READ_BUF_SIZE: usize = 16 * 1024;

#[cfg(windows)]
#[derive(Default)]
pub(crate) struct WindowsBackend {
    pub(crate) pipe: JsCell<Option<OwnedPipe>>,
    /// New writes go to `out` until the one in flight completes.
    is_writing: Cell<bool>,
    /// The buffer of the last write, which is swapped with `out` for the next.
    spare: Cell<Vec<u8>>,
}

/// On the heap, because the pipe holds its address.
#[cfg(windows)]
pub(crate) struct OwnedChannel(AliasableBox<Channel>);
#[cfg(not(windows))]
pub(crate) type OwnedChannel = Channel;

#[cfg(windows)]
impl Default for OwnedChannel {
    fn default() -> Self {
        Self(AliasableBox::new(Channel::default()))
    }
}

#[cfg(windows)]
impl core::ops::Deref for OwnedChannel {
    type Target = Channel;
    fn deref(&self) -> &Channel {
        &self.0
    }
}

// -- adopt -------------------------------------------------------------------

impl OwnedChannel {
    /// Adopt a duplex fd into the channel and start reading. POSIX: the
    /// socketpair end. Windows: the inherited named-pipe end (worker side).
    pub(crate) fn adopt(&self, vm: &VirtualMachine, fd: Fd) -> bool {
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
            match OwnedPipe::open(uv::Loop::get(), true, fd) {
                Ok(pipe) => self.adopt_pipe(pipe),
                Err(e) => {
                    bun_core::debug_warn!(
                        "Channel.adopt: uv_pipe_open({}) failed: {}",
                        fd.uv(),
                        e.name().escape_ascii(),
                    );
                    false
                }
            }
        }
        #[cfg(not(windows))]
        {
            let g = Self::ensure_posix_group(vm);
            let this = core::ptr::from_ref(self).cast_mut();
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
    /// reading. The pipe stays ref'd so the loop blocks for the peer's first frame.
    #[cfg(windows)]
    pub(crate) fn adopt_pipe(&self, pipe: OwnedPipe) -> bool {
        let owner = Owner::new(PollTag::TestParallelChannel, self.0.as_ptr().cast());
        // SAFETY: the box drops the pipe, and is only lent shared.
        unsafe { pipe.set_owner(owner) };
        pipe.set_max_read_len(READ_BUF_SIZE);
        if let Some(e) = pipe.read_start().to_error(bun_sys::Tag::listen) {
            bun_core::debug_warn!(
                "Channel.adoptPipe: readStart failed: {}",
                e.name().escape_ascii(),
            );
            return false;
        }
        self.backend.pipe.set(Some(pipe));
        true
    }
}

// -- write -------------------------------------------------------------------

impl Channel {
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
            if !self.out.is_empty() {
                self.out.extend_from_slice(frame_bytes);
                return;
            }
            let wrote = self.backend.socket.get().write(frame_bytes);
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
    fn send_windows(&self, frame_bytes: &[u8]) {
        // A uv_write is in flight — queue behind it.
        if self.backend.is_writing.get() {
            self.out.extend_from_slice(frame_bytes);
            return;
        }
        // Try a synchronous write first. uv_try_write on a Windows
        // UV_NAMED_PIPE always returns EAGAIN (vendor/libuv/src/win/stream.c),
        // so this currently always falls through to submit_windows_write —
        // kept because EBADF/EPIPE here mean the pipe is dead and must not
        // silently drop the frame.
        let Some(pipe) = self.backend.pipe.get() else {
            return;
        };
        let rc = pipe.try_write(frame_bytes);
        let w: usize = match rc.to_error(bun_sys::Tag::try_write) {
            None => rc.int() as usize,
            Some(e) => {
                if e.get_errno() == bun_sys::E::AGAIN {
                    0
                } else {
                    self.mark_failed();
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
    fn submit_windows_write(&self) {
        if self.out.is_empty() || self.backend.is_writing.get() || self.done.get() {
            return;
        }
        let Some(pipe) = self.backend.pipe.get() else {
            return;
        };
        match pipe.write(self.out.replace(self.backend.spare.take()), 0) {
            Ok(()) => self.backend.is_writing.set(true),
            Err(_) => self.mark_failed(),
        }
    }

    /// True while any encoded bytes are still queued or in flight.
    pub(crate) fn has_pending_writes(&self) -> bool {
        #[cfg(windows)]
        {
            !self.out.is_empty() || self.backend.is_writing.get()
        }
        #[cfg(not(windows))]
        {
            !self.out.is_empty()
        }
    }

    /// Best-effort drain of any buffered writes.
    #[cfg(not(windows))]
    pub(crate) fn flush(&self) {
        while !self.done.get() {
            let mut pending = self.out.take();
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
            let queued_meanwhile = self.out.replace(pending);
            self.out.extend_from_slice(&queued_meanwhile);
            if wrote <= 0 {
                return;
            }
        }
    }

    // -- read ----------------------------------------------------------------

    fn ingest(&self, data: &[u8]) {
        if self.done.get() {
            return;
        }
        self.r#in.extend_from_slice(data);
        self.has_incoming.set(true);
    }

    /// `None` if nothing has arrived since the last call. Goes back through `restore_incoming`.
    pub(crate) fn take_incoming(&self) -> Option<IncomingFrames> {
        self.has_incoming.take().then(|| IncomingFrames {
            bytes: self.r#in.take(),
            head: 0,
            is_corrupt: false,
        })
    }

    pub(crate) fn restore_incoming(&self, mut incoming: IncomingFrames) {
        if incoming.is_corrupt {
            return self.mark_corrupt();
        }
        incoming.bytes.drain_front(incoming.head);
        debug_assert!(self.r#in.is_empty());
        self.r#in.set(incoming.bytes);
    }

    fn mark_failed(&self) {
        self.done.set(true);
        self.kill_pending.set(true);
    }

    fn mark_corrupt(&self) {
        self.corrupt_frame.set(true);
        self.mark_failed();
    }
}

impl Drop for Channel {
    fn drop(&mut self) {
        self.done.set(true);
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

#[cfg(not(windows))]
impl uws::vtable::Handler for Channel {
    type Ext = ExtSlot<Self>;

    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;

    fn on_data(ext: &mut Self::Ext, _: *mut uws::us_socket_t, data: &[u8]) {
        let Some(this) = ext.owner_ref() else { return };
        this.ingest(data);
    }

    fn on_writable(ext: &mut Self::Ext, _: *mut uws::us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        this.flush();
    }

    fn on_close(ext: &mut Self::Ext, _: *mut uws::us_socket_t, _: i32, _: Option<*mut c_void>) {
        let Some(this) = ext.owner_ref() else { return };
        this.backend.socket.set(Socket::DETACHED);
        this.done.set(true);
    }
}

#[cfg(windows)]
impl Channel {
    pub(crate) fn on_io(&self, event: IoEvent) {
        match event {
            IoEvent::StreamRead(nread) => match nread.errno() {
                Some(err) => self.on_error(err),
                None => self.on_read(),
            },
            IoEvent::StreamWrite(bytes, status) => self.on_write(bytes, status),
            IoEvent::VmTeardown => {}
            _ => unreachable!("not an event of a channel"),
        }
    }
    fn on_read(&self) {
        if let Some(pipe) = self.backend.pipe.get() {
            pipe.input().with_taken(|input| {
                self.ingest(input);
                input.clear();
            });
        }
    }
    fn on_error(&self, err: bun_sys::E) {
        // libuv frames this pipe itself (ipc=1), so bytes the peer writes
        // straight to fd 3 fail its frame-header check and surface here as a
        // read error instead of reaching `ingest`; report it like a bad frame.
        if err != bun_sys::E::EOF {
            self.mark_corrupt();
        }
        self.backend.pipe.set(None);
        self.backend.is_writing.set(false);
        self.done.set(true);
    }
    fn on_write(&self, mut bytes: Vec<u8>, status: uv::ReturnCode) {
        bytes.clear();
        self.backend.spare.set(bytes);
        self.backend.is_writing.set(false);
        if self.done.get() {
            return;
        }
        if status.is_err() {
            self.mark_failed();
            return;
        }
        self.submit_windows_write();
    }
}
