use core::cell::{Cell, OnceCell};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::os::windows::io::{AsHandle as _, OwnedHandle};
use std::sync::OnceLock;

use bun_sys::windows::{create_auto_reset_event, set_event};

use crate::port::key;
use crate::sys::WaitPacket;

const DISARMED: usize = 0;
const ARMED: usize = usize::MAX;

/// An event boosts the priority of the thread that it wakes. A posted packet does not, so the thread queues behind CPU-bound ones.
#[derive(Default)]
pub(crate) struct WakeEvent {
    event: OnceLock<OwnedHandle>,
    /// `DISARMED`, `ARMED`, or the key that the event was signaled for.
    state: AtomicUsize,
}

impl WakeEvent {
    /// Returns `false` if the port will not get a packet with `key`.
    pub(crate) fn try_signal(&self, key: usize) -> bool {
        let Some(event) = self.event.get() else {
            return false;
        };
        let was_armed = self.try_transition(ARMED, key);
        if was_armed {
            set_event(event);
        }
        was_armed
    }

    fn try_transition(&self, current: usize, new: usize) -> bool {
        self.state
            .compare_exchange(current, new, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
}

/// The part of a [`WakeEvent`] that stays on the port's thread.
#[derive(Default)]
pub(crate) struct WakeListener {
    packet: OnceCell<WaitPacket>,
    is_associated: Cell<bool>,
}

impl WakeListener {
    pub(crate) fn with_armed<T>(
        &self,
        wake_event: &WakeEvent,
        port: &OwnedHandle,
        sleep: impl FnOnce() -> T,
    ) -> T {
        if self.is_associated.get() || self.associate(wake_event, port).is_some() {
            self.is_associated.set(true);
            wake_event.try_transition(DISARMED, ARMED);
        }
        let result = sleep();
        wake_event.try_transition(ARMED, DISARMED);
        result
    }

    fn associate(&self, wake_event: &WakeEvent, port: &OwnedHandle) -> Option<()> {
        if self.packet.get().is_none() {
            let packet = WaitPacket::new().ok()??;
            let event = create_auto_reset_event().ok()?;
            self.packet.get_or_init(|| packet);
            wake_event.event.get_or_init(|| event);
        }
        let event = wake_event.event.get()?.as_handle();
        let packet = self.packet.get()?;
        packet.associate(port, event, key::WAKE_EVENT, 0).ok()
    }

    /// For a dequeued `key::WAKE_EVENT` packet.
    pub(crate) fn take_signaled_key(&self, wake_event: &WakeEvent) -> usize {
        self.is_associated.set(false);
        wake_event.state.swap(DISARMED, Ordering::SeqCst)
    }
}
