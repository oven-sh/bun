//! Bidirectional IPC channel for `bun test --parallel`. Reads are
//! frame-decoded by the owner between ticks; writes go through the platform
//! socket/pipe with backpressure buffered and drained via the loop, so a full
//! kernel buffer never truncates a frame.
//!
//! POSIX backend: `uws::NewSocketHandler` adopted from a socketpair fd.
//! Windows backend: a reader and a writer over the inherited duplex pipe end.
//!
//! Lifetime: a `Channel` is embedded as a field in an owner that outlives all
//! callbacks (the coordinator's `Worker[]`, or the worker's
//! `CoordinatorLink` which lives for the process).

use core::cell::Cell;
#[cfg(not(windows))]
use core::ffi::c_void;

use bun_collections::VecExt;
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::File;
#[cfg(not(windows))]
use bun_uws as uws;
#[cfg(not(windows))]
use bun_uws_sys::thunk::ExtSlot;

#[cfg(windows)]
use bun_io::{
    BufferedReader, IoEvent, Owner, Pipe, PollTag, ReadResult, StreamingWriter, WriteHandler,
    WriteStatus,
};

use super::frame;

#[derive(Default)]
pub(crate) struct Channel {
    /// Incoming bytes that the owner has not read as frames yet.
    r#in: JsCell<Vec<u8>>,
    /// `in` has grown since the owner last took it.
    has_incoming: Cell<bool>,
    /// Outgoing bytes the kernel didn't accept yet.
    #[cfg(not(windows))]
    out: JsCell<Vec<u8>>,
    pub(crate) done: Cell<bool>,
    /// The peer's byte stream stopped decoding as frames, i.e. something in
    /// the peer wrote straight to fd 3: a length `next_frame` rejected. Set
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
            // `Ready` carries no payload.
            if len > frame::MAX_PAYLOAD || (kind == frame::Kind::Ready as u8 && len != 0) {
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

// -- Windows -----------------------------------------------------------------

#[cfg(windows)]
pub(crate) struct WindowsBackend {
    reader: BufferedReader,
    writer: StreamingWriter,
}

#[cfg(windows)]
impl Default for WindowsBackend {
    fn default() -> Self {
        Self {
            reader: BufferedReader::init(),
            writer: StreamingWriter::default(),
        }
    }
}

// -- adopt -------------------------------------------------------------------

impl Channel {
    /// Adopt a duplex fd into the channel and start reading. POSIX: the
    /// socketpair end. Windows: the inherited named-pipe end (worker side).
    pub(crate) fn adopt(&self, vm: &VirtualMachine, end: File) -> bool {
        let fd = end.fd();
        #[cfg(windows)]
        {
            let Ok(pipe) = Pipe::open_duplex(vm.uws_loop().port(), fd) else {
                return false;
            };
            pipe.read_ahead();
            vm.rare_data().reads_from_test_coordinator.set(true);
            // `pipe` closes it.
            end.into_raw();
            return self.adopt_pipe(pipe);
        }
        #[cfg(not(windows))]
        {
            let g = Self::ensure_posix_group(vm);
            let this = core::ptr::from_ref(self).cast_mut();
            let Some(sock) = Socket::from_fd(g, uws::SocketKind::Dynamic, fd, this, true) else {
                return false;
            };
            // `sock` closes it.
            end.into_raw();
            self.backend.socket.set(sock);
            sock.set_timeout(0);
            true
        }
    }

    /// `adopt`, for the end that the coordinator keeps.
    pub(crate) fn adopt_own(&self, vm: &VirtualMachine, end: File) -> bool {
        #[cfg(windows)]
        return self.adopt_pipe(Pipe::from_exclusive(vm.uws_loop().port(), end));
        #[cfg(not(windows))]
        self.adopt(vm, end)
    }

    #[cfg(windows)]
    fn adopt_pipe(&self, pipe: Pipe) -> bool {
        let this = core::ptr::from_ref(self).cast_mut();
        let owner = Owner::new(PollTag::TestParallelChannel, this.cast());
        // SAFETY: both are fields of `self`, which does not move once it is adopted.
        unsafe {
            self.backend.reader.set_owner(owner);
            self.backend.writer.set_owner(owner);
        }
        pipe.update_ref(false);
        self.backend.writer.set_pipe(pipe.clone());
        self.backend.reader.start_with_pipe(pipe).is_ok()
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
            let writer = &self.backend.writer;
            if writer.has_pending_data() {
                writer.enqueue(frame_bytes);
            } else {
                writer.write_now(self, &[frame_bytes]);
            }
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

    /// True while any encoded bytes are still queued or in flight.
    pub(crate) fn has_pending_writes(&self) -> bool {
        #[cfg(windows)]
        {
            self.backend.writer.has_pending_data()
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

    // -- read ----------------------------------------------------------------

    fn ingest(&self, data: &[u8]) {
        if self.done.get() {
            return;
        }
        self.r#in.with_mut(|r#in| r#in.extend_from_slice(data));
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
        debug_assert!(self.r#in.get().is_empty());
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
        if let IoEvent::Write(_) = event {
            return self.backend.writer.on_io(self, event);
        }
        let result =
            (self.backend.reader).read_chunks(bun_io::js_vm_ctx(), Some(event), |chunk, _| {
                self.ingest(&chunk);
                true
            });
        if !matches!(result, ReadResult::Pending) {
            self.done.set(true);
            self.backend.reader.deinit();
            self.backend.writer.close(self);
        }
    }
}

#[cfg(windows)]
impl WriteHandler for Channel {
    fn on_write(&self, _: usize, _: WriteStatus) {}

    fn on_error(&self, _: bun_sys::Error) {
        if !self.done.get() {
            self.mark_failed();
        }
    }

    fn on_close(&self) {}
}
