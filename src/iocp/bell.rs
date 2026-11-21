use core::cell::{Cell, OnceCell};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::os::windows::io::{AsHandle as _, OwnedHandle};
use std::sync::OnceLock;

use bun_sys::windows::{create_auto_reset_event, set_event};

use crate::port::key;
use crate::sys::WaitPacket;

const UNHEARD: usize = 0;
const HEARD: usize = usize::MAX;

/// An event raises the priority of the thread that it wakes. After a posted packet, that queues behind what keeps the CPUs busy.
#[derive(Default)]
pub(crate) struct Bell {
    event: OnceLock<OwnedHandle>,
    /// `UNHEARD`, `HEARD`, or the key that it was rung for.
    state: AtomicUsize,
}

impl Bell {
    /// `false` if the port is not going to get a packet with `key`.
    pub(crate) fn ring(&self, key: usize) -> bool {
        let Some(event) = self.event.get() else {
            return false;
        };
        let is_heard = self.change(HEARD, key);
        if is_heard {
            set_event(event);
        }
        is_heard
    }

    fn change(&self, from: usize, to: usize) -> bool {
        let order = Ordering::SeqCst;
        self.state.compare_exchange(from, to, order, order).is_ok()
    }
}

/// The part that stays on the thread of the port.
#[derive(Default)]
pub(crate) struct Listener {
    packet: OnceCell<WaitPacket>,
    is_associated: Cell<bool>,
}

impl Listener {
    pub(crate) fn listen<T>(
        &self,
        bell: &Bell,
        port: &OwnedHandle,
        sleep: impl FnOnce() -> T,
    ) -> T {
        if self.is_associated.get() || self.associate(bell, port).is_some() {
            self.is_associated.set(true);
            bell.change(UNHEARD, HEARD);
        }
        let result = sleep();
        bell.change(HEARD, UNHEARD);
        result
    }

    fn associate(&self, bell: &Bell, port: &OwnedHandle) -> Option<()> {
        if self.packet.get().is_none() {
            let (packet, event) = (WaitPacket::new().ok()??, create_auto_reset_event().ok()?);
            self.packet.get_or_init(|| packet);
            bell.event.get_or_init(|| event);
        }
        let event = bell.event.get()?.as_handle();
        (self.packet.get()?.associate(port, event, key::BELL, 0)).ok()
    }

    /// Returns the key that it was rung for.
    pub(crate) fn rang(&self, bell: &Bell) -> usize {
        self.is_associated.set(false);
        bell.state.swap(UNHEARD, Ordering::SeqCst)
    }
}
