//! HTTP/2 stream state machine (RFC 9113 §5.1). Pure. Part of the from-scratch rewrite.
//!
//! The integer values of `State` match the contract the JS layer expects (they are passed to JS
//! as the stream `state`): IDLE=1, OPEN=2, RESERVED_LOCAL=3, RESERVED_REMOTE=4,
//! HALF_CLOSED_LOCAL=5, HALF_CLOSED_REMOTE=6, CLOSED=7.

#![allow(dead_code)]

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum State {
    Idle = 1,
    Open = 2,
    ReservedLocal = 3,
    ReservedRemote = 4,
    HalfClosedLocal = 5,
    HalfClosedRemote = 6,
    Closed = 7,
}

/// A transition-driving event. `send_*` = we initiated; `recv_*` = peer initiated.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Event {
    SendHeaders,
    RecvHeaders,
    SendHeadersEndStream,
    RecvHeadersEndStream,
    SendEndStream, // END_STREAM on DATA/trailers
    RecvEndStream,
    SendPushPromise, // reserve a stream (server push)
    RecvPushPromise, // peer reserves a stream
    SendRst,
    RecvRst,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TransitionError {
    /// §5.1: a frame for a stream where it is not allowed.
    Protocol,
    /// §5.1: a frame (other than PRIORITY) on a fully closed stream.
    StreamClosed,
}

/// Apply `ev` to `state`, returning the new state per §5.1, or an error the caller raises.
pub fn transition(state: State, ev: Event) -> Result<State, TransitionError> {
    use Event::*;
    use State::*;
    Ok(match state {
        Idle => match ev {
            SendHeaders | RecvHeaders => Open,
            SendHeadersEndStream => HalfClosedLocal,
            RecvHeadersEndStream => HalfClosedRemote,
            SendPushPromise => ReservedLocal,
            RecvPushPromise => ReservedRemote,
            // §5.1: RST_STREAM / DATA / etc. on an idle stream is a connection PROTOCOL_ERROR.
            _ => return Err(TransitionError::Protocol),
        },
        ReservedLocal => match ev {
            SendHeaders => HalfClosedRemote,
            // RFC 9113 5.1: reserved -> HEADERS moves to half-closed; END_STREAM on that same
            // HEADERS closes the stream.
            SendHeadersEndStream => Closed,
            SendRst | RecvRst => Closed,
            _ => return Err(TransitionError::Protocol),
        },
        ReservedRemote => match ev {
            RecvHeaders => HalfClosedLocal,
            // RFC 9113 5.1: reserved -> HEADERS moves to half-closed; END_STREAM on that same
            // HEADERS closes the stream.
            RecvHeadersEndStream => Closed,
            SendRst | RecvRst => Closed,
            _ => return Err(TransitionError::Protocol),
        },
        Open => match ev {
            SendEndStream | SendHeadersEndStream => HalfClosedLocal,
            RecvEndStream | RecvHeadersEndStream => HalfClosedRemote,
            SendRst | RecvRst => Closed,
            SendHeaders | RecvHeaders => Open, // trailing / info HEADERS
            _ => return Err(TransitionError::Protocol),
        },
        HalfClosedLocal => match ev {
            RecvEndStream | RecvHeadersEndStream => Closed,
            RecvHeaders => HalfClosedLocal,
            SendRst | RecvRst => Closed,
            _ => return Err(TransitionError::Protocol),
        },
        HalfClosedRemote => match ev {
            SendEndStream | SendHeadersEndStream => Closed,
            SendHeaders => HalfClosedRemote,
            SendRst | RecvRst => Closed,
            // §5.1: receiving anything but WINDOW_UPDATE/PRIORITY/RST here is STREAM_CLOSED.
            RecvEndStream | RecvHeaders | RecvHeadersEndStream => {
                return Err(TransitionError::StreamClosed);
            }
            _ => return Err(TransitionError::Protocol),
        },
        Closed => match ev {
            SendRst | RecvRst => Closed,
            // §5.1: a frame on a closed stream is STREAM_CLOSED (PRIORITY handled before here).
            _ => return Err(TransitionError::StreamClosed),
        },
    })
}

/// §6.1/§5.1: DATA may only be received in `open` or `half-closed (local)`. In particular a
/// promised stream still in `reserved (remote)` must not be handed DATA before its response
/// HEADERS arrive. (Locally-opened streams the engine never saw are shimmed to `Open` by the
/// caller before this check.)
pub fn can_receive_data(state: State) -> bool {
    matches!(state, State::Open | State::HalfClosedLocal)
}

/// §6.1/§5.1: DATA may only be sent in `open` or `half-closed (remote)`.
pub fn can_send_data(state: State) -> bool {
    matches!(state, State::Open | State::HalfClosedRemote)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_lifecycle() {
        assert_eq!(transition(State::Idle, Event::RecvHeaders), Ok(State::Open));
        assert_eq!(
            transition(State::Open, Event::RecvEndStream),
            Ok(State::HalfClosedRemote)
        );
        assert_eq!(
            transition(State::HalfClosedRemote, Event::SendEndStream),
            Ok(State::Closed)
        );
    }

    #[test]
    fn rst_on_idle_is_protocol_error() {
        assert_eq!(
            transition(State::Idle, Event::RecvRst),
            Err(TransitionError::Protocol)
        );
    }

    #[test]
    fn data_after_peer_end_is_stream_closed() {
        assert_eq!(
            transition(State::HalfClosedRemote, Event::RecvEndStream),
            Err(TransitionError::StreamClosed)
        );
    }
}
