//! The transport of `new net.Socket({ fd, writable: true })` over a pipe, a terminal, or a socket that is only written to.

use core::cell::Cell;

use bun_jsc::JsResult;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::ThisPtr;
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_uws::{SocketTCP, Transport};

use super::TCPSocket;
use crate::dispatch::fold;

/// Writes with `write(2)` at once, in the descriptor's own blocking mode, so what a program wrote before `process.exit()` is out. It keeps no bytes: its socket queues what a full pipe refused.
pub(crate) struct FdPipe {
    fd: Fd,
    /// `None` once closed. `connect_finish` took the connection's ref on it, and `on_close` releases that ref.
    socket: Cell<Option<ThisPtr<TCPSocket>>>,
    is_shutdown: Cell<bool>,
    rejected_send_error: Cell<i32>,
    /// The task that closes and frees `self` is in the queue.
    is_queued: Cell<bool>,
    /// In no uSockets group, so the context that opened it closes it through this when it stops.
    abort_handle: bun_jsc::AbortHandle,
    #[cfg(not(windows))]
    poll: Cell<Option<*mut bun_io::posix_event_loop::FilePoll>>,
}

bun_jsc::impl_abort_handle_owner!(FdPipe, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live (armed, so `Drop` has not run).
    unsafe { &*this }.close()
});

impl FdPipe {
    /// Makes `fd` the transport of `socket` and reports it open.
    pub(crate) fn open(
        socket: ThisPtr<TCPSocket>,
        fd: Fd,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> JsResult<()> {
        let this = bun_core::heap::into_raw(Box::new(Self {
            fd,
            socket: Cell::new(Some(socket)),
            is_shutdown: Cell::new(false),
            rejected_send_error: Cell::new(0),
            is_queued: Cell::new(false),
            abort_handle: bun_jsc::AbortHandle::for_owner::<Self>(),
            #[cfg(not(windows))]
            poll: Cell::new(None),
        }));
        // SAFETY: fully initialised and heap-pinned; `Drop` leaves the context.
        unsafe { bun_jsc::AbortHandle::arm_owner(this, context) };
        let handle = SocketTCP::from_transport(this);
        socket.socket.set(handle);
        TCPSocket::on_open(socket, handle)
    }

    /// Returns true if `on_poll` will report that the descriptor takes bytes again.
    #[cfg(not(windows))]
    fn wait_until_writable(&self) -> bool {
        use bun_io::posix_event_loop::{FilePoll, Flags, Owner, PollTag};
        // kqueue doesn't reliably report a FIFO's readiness on macOS, and the write could wait forever.
        if !cfg!(target_os = "linux") {
            return false;
        }
        let ctx = bun_io::js_vm_ctx();
        let poll = self.poll.get().unwrap_or_else(|| {
            let owner = Owner::new(PollTag::FdPipe, core::ptr::from_ref(self).cast_mut().cast());
            FilePoll::init(ctx, self.fd, Default::default(), owner)
        });
        self.poll.set(Some(poll));
        // SAFETY: `poll` is this pipe's live hive slot, and no other borrow of it or of the loop is live.
        unsafe { (*poll).register(ctx.platform_event_loop(), Flags::Writable, true) }.is_ok()
    }

    #[cfg(windows)]
    fn wait_until_writable(&self) -> bool {
        false
    }

    #[cfg(not(windows))]
    pub(crate) fn on_poll(&self) {
        if let Some(socket) = self.socket.get() {
            fold(TCPSocket::on_writable(
                socket,
                SocketTCP::from_transport(self),
            ));
        }
    }

    fn enqueue(&self) {
        if !self.is_queued.replace(true) {
            VirtualMachine::get()
                .event_loop_mut()
                .enqueue_task(bun_jsc::Task::init(core::ptr::from_ref(self).cast_mut()));
        }
    }

    /// SAFETY: `this` is the queued pointer. The call frees it.
    pub(crate) unsafe fn run_event(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { &*this }.close();
        // SAFETY: fn contract; a closed pipe's socket holds no handle to it.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

impl Transport for FdPipe {
    fn is_closed(&self) -> bool {
        self.socket.get().is_none()
    }

    fn is_shutdown(&self) -> bool {
        self.is_shutdown.get()
    }

    fn write(&self, data: &[u8]) -> (i32, i32) {
        let mut written = 0;
        let mut send_error = 0;
        while written < data.len() {
            match sys::write(self.fd, &data[written..]) {
                Ok(n) => written += n,
                Err(err) if err.is_retry() && self.wait_until_writable() => break,
                Err(err) => {
                    send_error =
                        -super::socket_body::uv_status(sys::SystemErrno::from_raw(err.errno));
                    break;
                }
            }
        }
        (i32::try_from(written).expect("int cast"), send_error)
    }

    fn raw_write(&self, data: &[u8]) -> i32 {
        self.write(data).0
    }

    fn shutdown(&self) {
        self.is_shutdown.set(true);
    }

    /// Touches nothing of `self` after `on_close`, whose handler can turn the event loop and so free `self`.
    fn close(&self) {
        let Some(socket) = self.socket.take() else {
            return;
        };
        #[cfg(not(windows))]
        if let Some(poll) = self.poll.take() {
            // SAFETY: this pipe's live hive slot, given back here.
            unsafe { (*poll).deinit() };
        }
        // Leaves stdin, stdout and stderr open, which other streams share. The program may have closed the descriptor itself.
        let _ = self.fd.close_allowing_bad_file_descriptor(None);
        self.enqueue();
        let handle = SocketTCP::from_transport(self);
        fold(TCPSocket::on_close(
            socket,
            handle,
            self.rejected_send_error.get(),
            None,
        ));
    }

    fn pause_stream(&self) -> bool {
        true
    }

    fn resume_stream(&self) -> bool {
        true
    }

    fn fd(&self) -> Fd {
        self.fd
    }

    fn reject_send(&self, error: i32) {
        self.rejected_send_error.set(error);
        self.is_shutdown.set(true);
        self.enqueue();
    }

    fn rejected_send_error(&self) -> i32 {
        self.rejected_send_error.get()
    }
}

impl Drop for FdPipe {
    fn drop(&mut self) {
        self.abort_handle.leave();
    }
}

impl bun_event_loop::Taskable for FdPipe {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FdPipe;
    /// What the task does runs no script by then.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract.
        unsafe { Self::run_event(this) }
    }
    /// A socket's own hop. Its handlers carry their context.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
