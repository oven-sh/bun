//! The HTTP/2 stream state machine (RFC 9113 §5.1).

/// The values are nghttp2's `nghttp2_stream_proto_state`, which node:http2 reports as `stream.state.state`.
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

impl State {
    /// Returns true while the peer's half is open.
    #[inline]
    pub fn can_receive(self) -> bool {
        matches!(self, State::Open | State::HalfClosedLocal)
    }

    /// Returns true while our half is open.
    #[inline]
    pub fn can_send(self) -> bool {
        matches!(self, State::Open | State::HalfClosedRemote)
    }
}

/// `Send*` is a frame we wrote, `Recv*` one the peer sent. END_STREAM is its own event after the frame that carried it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Event {
    SendHeaders,
    RecvHeaders,
    SendEndStream,
    RecvEndStream,
    SendPushPromise,
    RecvPushPromise,
    Reset,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TransitionError {
    /// The state doesn't allow the frame.
    Protocol,
    /// The half the frame belongs to is already closed.
    StreamClosed,
}

pub fn transition(state: State, event: Event) -> Result<State, TransitionError> {
    use Event::*;
    use State::*;
    Ok(match (state, event) {
        (Idle, SendHeaders | RecvHeaders) => Open,
        (Idle, SendPushPromise) => ReservedLocal,
        (Idle, RecvPushPromise) => ReservedRemote,
        (Idle, _) => return Err(TransitionError::Protocol),

        (_, Reset) => Closed,

        (ReservedLocal, SendHeaders) => HalfClosedRemote,
        (ReservedRemote, RecvHeaders) => HalfClosedLocal,
        (ReservedLocal | ReservedRemote, _) => return Err(TransitionError::Protocol),

        (Open, SendHeaders | RecvHeaders) => Open,
        (Open, SendEndStream) => HalfClosedLocal,
        (Open, RecvEndStream) => HalfClosedRemote,

        (HalfClosedLocal, RecvHeaders) => HalfClosedLocal,
        (HalfClosedLocal, RecvEndStream) => Closed,
        (HalfClosedRemote, SendHeaders) => HalfClosedRemote,
        (HalfClosedRemote, SendEndStream) => Closed,

        (HalfClosedRemote | Closed, RecvHeaders | RecvEndStream) => {
            return Err(TransitionError::StreamClosed);
        }
        (HalfClosedLocal | Closed, SendHeaders | SendEndStream) => {
            return Err(TransitionError::StreamClosed);
        }
        (_, SendPushPromise | RecvPushPromise) => return Err(TransitionError::Protocol),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(events: &[Event]) -> Result<State, TransitionError> {
        events
            .iter()
            .try_fold(State::Idle, |state, &event| transition(state, event))
    }

    #[test]
    fn request_and_response() {
        use Event::*;
        assert_eq!(run(&[RecvHeaders]), Ok(State::Open));
        assert_eq!(
            run(&[RecvHeaders, RecvEndStream]),
            Ok(State::HalfClosedRemote)
        );
        assert_eq!(
            run(&[RecvHeaders, RecvEndStream, SendHeaders, SendEndStream]),
            Ok(State::Closed)
        );
        assert_eq!(
            run(&[
                SendHeaders,
                SendEndStream,
                RecvHeaders,
                RecvHeaders,
                RecvEndStream
            ]),
            Ok(State::Closed)
        );
    }

    #[test]
    fn push() {
        use Event::*;
        assert_eq!(
            run(&[RecvPushPromise, RecvHeaders]),
            Ok(State::HalfClosedLocal)
        );
        assert_eq!(
            run(&[SendPushPromise, SendHeaders]),
            Ok(State::HalfClosedRemote)
        );
        assert_eq!(
            run(&[RecvPushPromise, RecvEndStream]),
            Err(TransitionError::Protocol)
        );
        assert_eq!(run(&[SendPushPromise, Reset]), Ok(State::Closed));
    }

    #[test]
    fn frames_the_state_refuses() {
        use Event::*;
        assert_eq!(run(&[Reset]), Err(TransitionError::Protocol));
        assert_eq!(run(&[RecvEndStream]), Err(TransitionError::Protocol));
        assert_eq!(
            run(&[RecvHeaders, RecvEndStream, RecvHeaders]),
            Err(TransitionError::StreamClosed)
        );
        assert_eq!(
            run(&[RecvHeaders, Reset, RecvEndStream]),
            Err(TransitionError::StreamClosed)
        );
        assert_eq!(
            run(&[SendHeaders, SendEndStream, SendEndStream]),
            Err(TransitionError::StreamClosed)
        );
        assert_eq!(run(&[RecvHeaders, Reset, Reset]), Ok(State::Closed));
    }
}
