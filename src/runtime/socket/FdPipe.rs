//! The transport of `new net.Socket({ fd, writable: true })` over a pipe, a terminal, or a socket that is only written to.

use core::cell::Cell;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JsCell, JsResult};
use bun_ptr::{AliasableBox, RefPtr};
use bun_sys::{self as sys, Fd, FdExt as _};
use bun_uws::{SocketTCP, Transport};

use super::TCPSocket;
use crate::dispatch::fold;

/// Writes with `write(2)` at once, in the descriptor's own blocking mode, so what a program wrote before `process.exit()` is out. It keeps no bytes: its socket queues what a full pipe refused.
pub(crate) struct FdPipe {
    handle: bun_uws::TransportHandle,
    fd: Fd,
    /// `None` once closed.
    socket: JsCell<Option<RefPtr<TCPSocket>>>,
    is_shutdown: Cell<bool>,
    rejected_send_error: Cell<i32>,
    /// `None` once it is in the queue, as the task that closes and frees `self`.
    owner: Cell<Option<AliasableBox<Self>>>,
    /// In no uSockets group, so the context that opened it closes it through this when it stops.
    abort_handle: bun_jsc::AbortHandle,
    /// Forced: the kernel keeps a fired poll for as long as the file is open, and `close` leaves stdout open.
    #[cfg(not(windows))]
    poll: JsCell<Option<bun_io::OwnedFilePoll<true>>>,
}

bun_jsc::impl_abort_handle_owner!(FdPipe, abort_handle, |this, _cause| {
    // SAFETY: trait contract: `this` is live (armed, so `Drop` has not run).
    unsafe { &*this }.close()
});

impl FdPipe {
    /// Makes `fd` the transport of `socket` and reports it open.
    pub(crate) fn open(
        socket: RefPtr<TCPSocket>,
        fd: Fd,
        context: &bun_jsc::ScriptExecutionContext,
    ) -> JsResult<()> {
        let owner = AliasableBox::new(Self {
            handle: Default::default(),
            fd,
            socket: JsCell::new(Some(socket.clone())),
            is_shutdown: Cell::new(false),
            rejected_send_error: Cell::new(0),
            owner: Cell::new(None),
            abort_handle: bun_jsc::AbortHandle::for_owner::<Self>(),
            #[cfg(not(windows))]
            poll: JsCell::new(None),
        });
        let this = owner.as_ptr();
        // SAFETY: just allocated, and freed only by the task that `close` queues.
        let pipe = unsafe { &*this };
        pipe.owner.set(Some(owner));
        // SAFETY: fully initialised and heap-pinned; dropping the handle disarms it.
        unsafe { bun_jsc::AbortHandle::arm_owner(this, context) };
        pipe.handle.set(this);
        let handle = SocketTCP::from_transport(&raw const pipe.handle);
        socket.socket.set(handle);
        socket.on_open(handle)
    }

    /// Returns true if `on_poll` will report that the descriptor takes bytes again.
    #[cfg(not(windows))]
    fn wait_until_writable(&self) -> bool {
        use bun_io::posix_event_loop::{Flags, Owner, PollTag};
        // kqueue doesn't reliably report a FIFO's readiness on macOS, and the write could wait forever.
        if !cfg!(target_os = "linux") {
            return false;
        }
        self.poll.with_mut(|poll| {
            poll.get_or_insert_with(|| {
                let owner =
                    Owner::new(PollTag::FdPipe, core::ptr::from_ref(self).cast_mut().cast());
                // SAFETY: `owner` points to the heap allocation that holds this poll.
                unsafe { bun_io::OwnedFilePoll::new(bun_io::js_vm_ctx(), self.fd, owner) }
            })
            .register(Flags::Writable, true)
            .is_ok()
        })
    }

    #[cfg(windows)]
    fn wait_until_writable(&self) -> bool {
        false
    }

    #[cfg(not(windows))]
    pub(crate) fn on_poll(&self) {
        if let Some(socket) = self.socket.get().clone() {
            fold(socket.on_writable(SocketTCP::from_transport(&raw const self.handle)));
        }
    }

    fn enqueue(&self) {
        if let Some(owner) = self.owner.take() {
            VirtualMachine::get()
                .event_loop()
                .enqueue_task(bun_jsc::Task::new::<Self>(owner));
        }
    }

    pub(crate) fn close_and_free(this: AliasableBox<Self>) {
        this.close();
        // A closed pipe's socket holds no handle to it.
        drop(this);
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
        self.poll.set(None);
        // Leaves stdin, stdout and stderr open. The program may have closed the descriptor itself.
        let _ = self.fd.close_allowing_bad_file_descriptor(None);
        self.enqueue();
        let handle = SocketTCP::from_transport(&raw const self.handle);
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

impl bun_event_loop::Taskable for FdPipe {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FdPipe;
    type Payload = AliasableBox<Self>;
    /// What the task does runs no script by then.
    fn release_unrun(this: Self::Payload) {
        Self::close_and_free(this);
    }
    /// A socket's own hop. Its handlers carry their context.
    fn context(_: &Self::Payload) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}
