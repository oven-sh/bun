use crate::outbox::{Idle, Unacked};
use core::mem::replace;

/// Where a channel is in its life. `O` is who gets its messages, `T` the socket or pipe.
pub struct Link<O, T>(State<O, T>);

enum State<O, T> {
    Live {
        owner: O,
        transport: T,
        stage: Stage,
    },
    /// The task tells the owner.
    Closed(O),
    Reported(O),
    Detached,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum Stage {
    Open,
    /// `disconnect()` waits for the ack of a handle and for what is queued behind it.
    Draining,
    /// The task closes the transport.
    Closing,
    /// The task first reads what the peer wrote before it exited.
    ClosingAfterRead,
    /// The write in flight closes the transport when it completes.
    #[cfg(any(windows, test))]
    ClosingAfterWrite,
}

pub enum Event {
    Disconnect,
    DisconnectBeforeAck(Unacked),
    Idle(Idle),
    PeerExited,
    #[cfg(any(windows, test))]
    ReadFailed,
    /// A close found a write in flight.
    #[cfg(any(windows, test))]
    CloseBlocked,
}

/// What the task does to the transport.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Due {
    Nothing,
    Close,
    ReadAndClose,
}

impl Stage {
    /// `None`: the event changes nothing.
    fn after(self, event: Event) -> Option<Stage> {
        use {Event::*, Stage::*};
        match (self, event) {
            (Open, DisconnectBeforeAck(_)) => Some(Draining),
            (Open | Draining, Disconnect) | (Draining, Idle(_)) => Some(Closing),
            (Open | Draining, PeerExited) => Some(ClosingAfterRead),
            (Open, Idle(_)) | (Draining, DisconnectBeforeAck(_)) => None,
            (
                Closing | ClosingAfterRead,
                Disconnect | DisconnectBeforeAck(_) | Idle(_) | PeerExited,
            ) => None,
            #[cfg(any(windows, test))]
            (Open | Draining, ReadFailed) => Some(Closing),
            #[cfg(any(windows, test))]
            (Open | Draining | Closing | ClosingAfterRead, CloseBlocked) => Some(ClosingAfterWrite),
            #[cfg(any(windows, test))]
            (Closing | ClosingAfterRead, ReadFailed)
            | (
                ClosingAfterWrite,
                Disconnect
                | DisconnectBeforeAck(_)
                | Idle(_)
                | PeerExited
                | ReadFailed
                | CloseBlocked,
            ) => None,
        }
    }

    fn due(self) -> Due {
        match self {
            Stage::Open | Stage::Draining => Due::Nothing,
            Stage::Closing => Due::Close,
            Stage::ClosingAfterRead => Due::ReadAndClose,
            #[cfg(any(windows, test))]
            Stage::ClosingAfterWrite => Due::Nothing,
        }
    }
}

impl<O: Copy, T> Link<O, T> {
    pub fn open(owner: O, transport: T) -> Self {
        let stage = Stage::Open;
        Self(State::Live {
            owner,
            transport,
            stage,
        })
    }

    pub fn detached() -> Self {
        Self(State::Detached)
    }

    pub fn owner(&self) -> Option<O> {
        match self.0 {
            State::Live { owner, .. } | State::Closed(owner) | State::Reported(owner) => {
                Some(owner)
            }
            State::Detached => None,
        }
    }

    pub fn live(&mut self) -> Option<(O, &mut T)> {
        match &mut self.0 {
            State::Live {
                owner, transport, ..
            } => Some((*owner, transport)),
            State::Closed(_) | State::Reported(_) | State::Detached => None,
        }
    }

    fn stage(&self) -> Option<Stage> {
        match self.0 {
            State::Live { stage, .. } => Some(stage),
            State::Closed(_) | State::Reported(_) | State::Detached => None,
        }
    }

    pub fn is_open(&self) -> bool {
        self.stage() == Some(Stage::Open)
    }

    #[cfg(any(windows, test))]
    pub fn closes_after_write(&self) -> bool {
        self.stage() == Some(Stage::ClosingAfterWrite)
    }

    /// The owner knows of the close, or is gone.
    pub fn is_over(&self) -> bool {
        match self.0 {
            State::Live { .. } | State::Closed(_) => false,
            State::Reported(_) | State::Detached => true,
        }
    }

    pub fn due(&self) -> Due {
        self.stage().map_or(Due::Nothing, Stage::due)
    }

    #[must_use = "`Some`: queue the task"]
    pub fn advance(&mut self, event: Event) -> Option<&T> {
        match &mut self.0 {
            State::Live {
                transport, stage, ..
            } => {
                *stage = stage.after(event)?;
                (stage.due() != Due::Nothing).then_some(transport)
            }
            State::Closed(_) | State::Reported(_) | State::Detached => None,
        }
    }

    #[must_use = "`Some`: queue the task"]
    pub fn close(&mut self) -> Option<T> {
        let (state, transport) = match replace(&mut self.0, State::Detached) {
            State::Live {
                owner, transport, ..
            } => (State::Closed(owner), Some(transport)),
            state @ (State::Closed(_) | State::Reported(_) | State::Detached) => (state, None),
        };
        self.0 = state;
        transport
    }

    #[must_use = "`Some`: tell the owner"]
    pub fn report(&mut self) -> Option<O> {
        match self.0 {
            State::Closed(owner) => {
                self.0 = State::Reported(owner);
                Some(owner)
            }
            State::Live { .. } | State::Reported(_) | State::Detached => None,
        }
    }

    /// The transport comes out of a link that is already detached, so closing it reports nothing.
    #[must_use = "`Some`: close it"]
    pub fn detach(&mut self) -> Option<T> {
        match replace(&mut self.0, State::Detached) {
            State::Live { transport, .. } => Some(transport),
            State::Closed(_) | State::Reported(_) | State::Detached => None,
        }
    }
}
