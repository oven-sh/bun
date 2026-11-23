use core::cell::{Cell, OnceCell};
use std::os::windows::io::{AsHandle as _, BorrowedHandle, OwnedHandle};
use std::sync::Arc;

use bun_windows_sys::NTSTATUS;

use crate::blocking;
use crate::port::{Shared, key};
use crate::slab::Token;
use crate::sys::{self, WaitPacket};

/// Queues a request's packet once an object is signaled.
#[derive(Default)]
pub(crate) struct Notifier {
    packet: OnceCell<WaitPacket>,
    /// Ends the wait of the fallback thread, which is used where wait completion packets are unavailable.
    cancel_event: Cell<Option<Arc<OwnedHandle>>>,
}

impl Notifier {
    /// Creates the wait completion packet ahead of `associate`.
    pub(crate) fn prepare(&self) -> Result<Option<&WaitPacket>, NTSTATUS> {
        if let Some(packet) = self.packet.get() {
            return Ok(Some(packet));
        }
        Ok(WaitPacket::new()?.map(|packet| self.packet.get_or_init(|| packet)))
    }

    pub(crate) fn associate(
        &self,
        shared: &Arc<Shared>,
        target: BorrowedHandle<'_>,
        token: Token,
    ) -> Result<(), NTSTATUS> {
        match self.prepare()? {
            Some(packet) => packet.associate(&shared.handle, target, key::REQUEST, token.to_raw()),
            None => self
                .spawn_waiter(shared, target, token)
                .ok_or(NTSTATUS::INSUFFICIENT_RESOURCES),
        }
    }

    fn spawn_waiter(
        &self,
        shared: &Arc<Shared>,
        target: BorrowedHandle<'_>,
        token: Token,
    ) -> Option<()> {
        let target = target.try_clone_to_owned().ok()?;
        let cancel_event = Arc::new(bun_sys::windows::CreateEventW().ok()?);
        self.cancel_event.set(Some(Arc::clone(&cancel_event)));
        let shared = Arc::clone(shared);
        blocking::spawn(move || {
            bun_sys::windows::wait_for_any(&[cancel_event.as_handle(), target.as_handle()]);
            sys::post_packet(&shared.handle, key::REQUEST, token.to_raw());
        });
        Some(())
    }

    /// Returns `false` if the wait completion packet is already on its way to the port.
    pub(crate) fn try_cancel(&self) -> bool {
        if let Some(cancel_event) = self.cancel_event.take() {
            bun_sys::windows::set_event(&cancel_event);
        }
        self.packet.get().is_none_or(WaitPacket::try_cancel)
    }
}
