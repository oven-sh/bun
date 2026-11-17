/// Where a channel is in its life. A task is queued or running in `Closing`, `ClosingAfterRead` and `Closed`.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Phase {
    Open,
    /// `disconnect()` waits for the ack of a handle and for what is queued behind it, as in Node.js.
    Draining,
    /// The task closes the transport.
    Closing,
    /// The task first reads what the peer wrote before it exited.
    ClosingAfterRead,
    /// Windows: the transport closes once no write is in flight.
    ClosingAfterWrite,
    /// The transport is gone. The task tells the owner.
    Closed,
    /// The owner knows, or is gone.
    Reported,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Event {
    Disconnect {
        awaits_ack: bool,
    },
    /// Nothing is left to write or to be acked.
    Idle,
    PeerExited,
    /// Windows.
    ReadFailed,
    /// Windows: a close found a write in flight.
    CloseBlocked,
    TransportClosed,
}

impl Phase {
    /// `None`: the event changes nothing.
    pub fn after(self, event: Event) -> Option<Phase> {
        use {Event::*, Phase::*};
        match (self, event) {
            (Closed | Reported, _) => None,
            (_, TransportClosed) => Some(Closed),
            (_, CloseBlocked) => Some(ClosingAfterWrite),
            (Closing | ClosingAfterRead | ClosingAfterWrite, _) => None,
            (Open | Draining, PeerExited) => Some(ClosingAfterRead),
            (Open | Draining, ReadFailed) => Some(Closing),
            (Open, Disconnect { awaits_ack: true }) => Some(Draining),
            (Open | Draining, Disconnect { awaits_ack: false }) | (Draining, Idle) => Some(Closing),
            (Open, Idle) | (Draining, Disconnect { awaits_ack: true }) => None,
        }
    }

    pub fn needs_task(self) -> bool {
        matches!(
            self,
            Phase::Closing | Phase::ClosingAfterRead | Phase::Closed
        )
    }
}
