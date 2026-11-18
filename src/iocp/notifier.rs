use core::cell::{Cell, OnceCell};
use std::os::windows::io::{AsHandle as _, BorrowedHandle, OwnedHandle};
use std::sync::Arc;

use bun_windows_sys::{INFINITE, NTSTATUS};

use crate::blocking;
use crate::port::{Shared, key};
use crate::slab::Token;
use crate::sys::{self, WaitPacket};

/// Queues the packet of a request once an object is signalled.
#[derive(Default)]
pub(crate) struct Notifier {
    packet: OnceCell<WaitPacket>,
    /// Ends the wait of the thread that stands in for the packet where the system has none.
    cancel: Cell<Option<Arc<OwnedHandle>>>,
}

impl Notifier {
    /// The part of `associate` that takes resources.
    pub(crate) fn prepare(&self) -> Result<Option<&WaitPacket>, NTSTATUS> {
        if let Some(packet) = self.packet.get() {
            return Ok(Some(packet));
        }
        Ok(WaitPacket::new()?.map(|packet| self.packet.get_or_init(|| packet)))
    }

    pub(crate) fn associate(
        &self,
        port: &Arc<Shared>,
        target: BorrowedHandle<'_>,
        request: Token,
    ) -> Result<(), NTSTATUS> {
        match self.prepare()? {
            Some(packet) => packet.associate(&port.handle, target, key::REQUEST, request.to_raw()),
            None => {
                (self.wait_on_thread(port, target, request)).ok_or(NTSTATUS::INSUFFICIENT_RESOURCES)
            }
        }
    }

    fn wait_on_thread(
        &self,
        port: &Arc<Shared>,
        target: BorrowedHandle<'_>,
        request: Token,
    ) -> Option<()> {
        let target = target.try_clone_to_owned().ok()?;
        let cancel = Arc::new(bun_sys::windows::CreateEventW().ok()?);
        self.cancel.set(Some(Arc::clone(&cancel)));
        let port = Arc::clone(port);
        blocking::spawn(move || {
            bun_sys::windows::wait_for_either(cancel.as_handle(), target.as_handle(), INFINITE);
            sys::post(&port.handle, key::REQUEST, request.to_raw());
        });
        Some(())
    }

    /// `false` if the packet is still to come.
    pub(crate) fn cancel(&self) -> bool {
        if let Some(cancel) = self.cancel.take() {
            bun_sys::windows::set_event(&cancel);
        }
        self.packet.get().is_none_or(WaitPacket::cancel)
    }
}
