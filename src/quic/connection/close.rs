//! RFC 9000 §10.

use super::sent::Control;
use super::space::SpaceId;
use super::streams::{Flags, Role};
use super::timers::{Timer, Timers};
use super::{Connection, Ending};
use crate::coding::{MAX_VARINT, Write};
use crate::config::KeepAlive;
use crate::error::{Error, Layer, http3_code, transport_code};
use crate::event::{CloseReason, Event};
use crate::frame::kind;
use crate::stream_id::Direction;
use crate::time::{Duration, Instant};

/// With an empty reason.
pub(super) const MIN_FRAME_ROOM: usize = 1 + 8 + 1 + 2;
/// There have to be up to three packets in a datagram.
const MAX_HANDSHAKE_REASON_LEN: usize = 128;
/// For how long to wait for the peer to take more of what has been written.
const GRACE_PERIOD: Duration = Duration::from_secs(30);
const MIN_IDLE_PROBE_TIMEOUT: Duration = Duration::from_millis(150);
const INITIAL_IDLE_PROBE_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_UNANSWERED_PINGS: u32 = 3;
const MAX_SETTLING_PERIOD: Duration = Duration::from_secs(15);
const MIN_YIELDING_PERIOD: Duration = Duration::from_secs(1);

pub(super) struct CloseFrame {
    layer: Layer,
    code: u64,
    reason: Box<[u8]>,
}

impl CloseFrame {
    /// RFC 9114 §5.2.
    pub(super) fn no_error(is_http3: bool) -> Self {
        match is_http3 {
            true => Self::new(Layer::Application, http3_code::NO_ERROR, &[]),
            false => Self::new(Layer::Transport, transport_code::NO_ERROR, &[]),
        }
    }

    fn new(layer: Layer, code: u64, reason: &[u8]) -> Self {
        Self {
            layer,
            code: code.min(MAX_VARINT),
            reason: reason.into(),
        }
    }

    fn is_error(&self) -> bool {
        self.code
            != match self.layer {
                Layer::Transport => transport_code::NO_ERROR,
                Layer::Application => http3_code::NO_ERROR,
            }
    }

    /// Whether it says more in a 1-RTT packet than in the others.
    pub(super) fn is_for_application(&self) -> bool {
        self.layer == Layer::Application
    }

    pub(super) fn write(&self, space: SpaceId, out: &mut Vec<u8>, end: usize) {
        let room = end.saturating_sub(out.len() + MIN_FRAME_ROOM);
        let (layer, code, max_len) = match (self.layer, space) {
            (layer, SpaceId::Data) => (layer, self.code, room),
            (Layer::Transport, _) => (self.layer, self.code, room.min(MAX_HANDSHAKE_REASON_LEN)),
            // RFC 9000 §10.2.3.
            (Layer::Application, _) => (Layer::Transport, transport_code::APPLICATION_ERROR, 0),
        };
        out.push(match layer {
            Layer::Transport => kind::TRANSPORT_CLOSE as u8,
            Layer::Application => kind::APPLICATION_CLOSE as u8,
        });
        out.varint(code);
        if layer == Layer::Transport {
            out.varint(kind::PADDING);
        }
        let is_boundary = |&at: &usize| self.reason.get(at).is_none_or(|it| it & 0xc0 != 0x80);
        let len = (0..=max_len.min(self.reason.len())).rfind(is_boundary);
        out.prefixed_bytes(self.reason.get(..len.unwrap_or(0)).unwrap_or_default());
    }
}

impl Connection {
    #[inline]
    pub(super) fn is_receiving(&self) -> bool {
        matches!(self.ending, Ending::No | Ending::Graceful)
    }

    /// Whether it is past the point where anything new can be started.
    pub fn is_closing(&self) -> bool {
        self.ending != Ending::No
    }

    pub fn close_reason(&self) -> &CloseReason {
        &self.close_reason
    }

    /// Resets the bidirectional streams that have not been written to the end, and delivers the rest first.
    pub fn close(&mut self, now: Instant) {
        if self.ending != Ending::No {
            return;
        }
        self.ending = Ending::Graceful;
        self.timers.set(Timer::Close, now + GRACE_PERIOD);
        self.streams.table.is_going_away = true;
        let is_open =
            self.is_confirmed() && !(self.streams.state.owed).contains(Control::HANDSHAKE_DONE);
        let (table, state) = (&mut self.streams.table, &mut self.streams.state);
        self.is_abrupt = (!is_open || self.close_frame.is_error()) && table.has_had_no_request();
        for (id, stream) in table.sorted(|id, _| id.direction() == Direction::Bidirectional) {
            stream.abandon_message(id, self.http3.as_deref_mut());
            if !stream.flags.contains(Flags::ANNOUNCED) {
                state.turn_away(id, stream);
            }
            if !stream.flags.contains(Flags::WRITE_DONE) {
                let code = match stream.role {
                    Role::Message(_) => http3_code::REQUEST_CANCELLED,
                    _ => 0,
                };
                state.reset(id, stream, code);
            }
            state.stop(id, stream, http3_code::NO_ERROR);
        }
        state.events.retain(|event| match event {
            Event::Stream(id, ..) => {
                !(table.get(*id)).is_some_and(|it| it.flags.contains(Flags::TURNED_AWAY))
            }
            _ => true,
        });
    }

    /// Likewise, but the peer has time to be the first and to give its reason.
    pub fn close_after_peer(&mut self, now: Instant) {
        self.yields = true;
        self.close(now);
    }

    /// Whether something that the application has written is still on its way.
    pub fn is_delivering(&self) -> bool {
        self.streams.table.has_undelivered_application_data()
    }

    /// Whether the application is done, and all that may be missing is acknowledgments.
    pub fn has_sent_everything(&self) -> bool {
        let table = &self.streams.table;
        !self.is_receiving()
            || !table.has_application_streams() && !table.has_unsent_application_data()
    }

    /// From when on the application is done and the peer seems to be gone, unless something arrives.
    pub fn deserted_from(&self) -> Instant {
        let table = &self.streams.table;
        let oldest = self.spaces.data.sent.packets.front();
        let Some(oldest) = oldest.filter(|_| !table.has_application_streams()) else {
            return Instant::NEVER;
        };
        let timeout = self.idle_timeout.max(self.min_idle_timeout());
        (oldest.flight.at).max(self.timers.get(Timer::Idle) - timeout)
            + match self.is_delivering() || table.has_unsettled_requests() {
                true => self.settling_period().max(MIN_YIELDING_PERIOD),
                false => self.settling_period() / 3,
            }
    }

    /// For the end of [`Self::close`] and [`Self::go_away`].
    pub fn set_close_error(&mut self, layer: Layer, code: u64, reason: &[u8]) {
        if self.is_receiving() {
            self.close_frame = CloseFrame::new(layer, code, reason);
        }
    }

    /// Does not deliver anything more.
    pub fn abort(&mut self, now: Instant, layer: Layer, code: u64, reason: &[u8]) {
        self.streams.state.forget_events();
        let frame = CloseFrame::new(layer, code, reason);
        self.start_closing(now, CloseReason::Local, frame);
    }

    /// Without a word to the peer.
    pub fn abort_silently(&mut self) {
        self.streams.state.forget_events();
        if self.ending != Ending::Over {
            self.lingers = false;
            self.end();
        }
    }

    #[cold]
    pub(super) fn fail(&mut self, now: Instant, error: Error) {
        let Error {
            layer,
            code,
            reason,
        } = error;
        let frame = CloseFrame::new(layer, code, reason.as_bytes());
        let reason = CloseReason::Error {
            layer,
            code,
            reason,
        };
        self.start_closing(now, reason, frame);
    }

    fn start_closing(&mut self, now: Instant, reason: CloseReason, frame: CloseFrame) {
        if self.is_receiving() {
            self.streams.state.forget_readable();
            (self.close_reason, self.close_frame) = (reason, frame);
            self.send_close(now);
        }
    }

    pub(super) fn send_close(&mut self, now: Instant) {
        self.ending = Ending::Closing;
        self.timers = Timers::default();
        self.timers.set(Timer::Close, now + self.settling_period());
    }

    /// RFC 9000 §10.2.2.
    pub(crate) fn drain(&mut self, reason: CloseReason) {
        if self.is_receiving() {
            self.close_reason = reason;
            self.end();
            self.streams.unpause_all();
        } else {
            self.end();
        }
    }

    pub(super) fn end(&mut self) {
        self.ending = Ending::Over;
        self.timers = Timers::default();
        if self.config.gives_up_early {
            self.reject_unsent_requests();
        }
    }

    pub(super) fn time_out(&mut self, now: Instant, reason: CloseReason) {
        self.lingers = false;
        let has_heard_from_peer = match &self.setup {
            Some(setup) => setup.initial_source.is_some() && self.path.is_validated,
            None => true,
        };
        match self.config.closes_silently || !has_heard_from_peer {
            true => self.drain(reason),
            false => self.start_closing(now, reason, CloseFrame::no_error(false)),
        }
    }

    pub(super) fn close_if_drained(&mut self, now: Instant) {
        let (table, state) = (&self.streams.table, &self.streams.state);
        let is_graceful = self.ending == Ending::Graceful;
        if !is_graceful && (self.side.is_client() || table.has_application_streams()) {
            return;
        }
        let is_busy = self.yields
            || state.has_frames()
            || self.has_datagrams()
            || table.has_unacked_data() && !self.is_abrupt
            || !is_graceful && table.has_unsettled_requests();
        if !self.is_ready || !is_busy {
            self.send_close(now);
        } else {
            let patience = match table.has_undelivered_application_data() {
                true => GRACE_PERIOD,
                false if self.yields => self.settling_period().max(MIN_YIELDING_PERIOD),
                false => self.settling_period(),
            };
            let deadline = match core::mem::take(&mut self.streams.state.has_delivered) {
                true => Instant::NEVER,
                false => self.timers.get(Timer::Close),
            };
            self.timers.set(Timer::Close, deadline.min(now + patience));
        }
    }

    pub(super) fn on_close_timeout(&mut self, now: Instant) {
        match core::mem::take(&mut self.streams.state.has_delivered) {
            true => self.timers.set(Timer::Close, now + GRACE_PERIOD),
            false => self.send_close(now),
        }
    }

    /// After which what is on the way has arrived, or is not going to.
    pub(super) fn settling_period(&self) -> Duration {
        (self.probe_timeout() * 3).min(MAX_SETTLING_PERIOD)
    }

    /// RFC 9000 §10.1.
    #[inline]
    pub(super) fn restart_idle_timer(&mut self, now: Instant) {
        if !self.idle_timeout.is_zero() {
            let timeout = self.idle_timeout.max(self.min_idle_timeout());
            self.timers.set(Timer::Idle, now + timeout);
        }
    }

    pub(super) fn leave_time_for_an_answer(&mut self, now: Instant) {
        let deadline = now + self.probe_timeout().min(MAX_SETTLING_PERIOD);
        (self.timers).set(Timer::Idle, deadline.max(self.timers.get(Timer::Idle)));
    }

    #[inline]
    pub(super) fn min_idle_timeout(&self) -> Duration {
        let probe_timeout = match self.rtt.has_sample() {
            true => self.probe_timeout().max(MIN_IDLE_PROBE_TIMEOUT),
            false => INITIAL_IDLE_PROBE_TIMEOUT,
        };
        (probe_timeout * 3).min(MAX_SETTLING_PERIOD)
    }

    #[inline]
    pub(super) fn restart_progress_timer(&mut self, now: Instant) {
        if !self.progress_timeout.is_zero() {
            (self.timers).set(Timer::Progress, now + self.progress_timeout);
        }
    }

    /// In place of [`Config::progress_timeout`](crate::Config::progress_timeout).
    pub fn set_progress_timeout(&mut self, now: Instant, timeout: Duration) {
        if self.is_receiving() && self.progress_timeout != timeout {
            self.progress_timeout = timeout;
            self.restart_progress_timer(now);
        }
    }

    /// For what the application does apart from reading and writing.
    pub fn note_progress(&mut self) {
        self.streams.state.made_progress = true;
    }

    /// For when the application may be silent for `timeout`, or for ever if it is zero, until it has no streams left.
    pub fn allow_silence(&mut self, timeout: Duration) {
        if !timeout.is_zero() && timeout <= self.idle_timeout || !self.is_receiving() {
            return;
        }
        if timeout.is_zero() || !self.progress_timeout.is_zero() && self.progress_timeout < timeout
        {
            self.progress_timeout = timeout;
        }
        self.timers.stop(Timer::Progress);
        self.note_progress();
        if self.keep_alive == KeepAlive::Never {
            self.keep_alive = KeepAlive::WhileStreamsAreOpen;
            self.start_keep_alive(self.timers.get(Timer::Idle) - self.idle_timeout);
        }
    }

    #[cold]
    pub(super) fn disallow_silence(&mut self, now: Instant) {
        self.progress_timeout = self.config.progress_timeout;
        self.restart_progress_timer(now);
        self.keep_alive = self.config.keep_alive;
        self.start_keep_alive(now);
    }

    /// Whether the peer may have dropped the connection by the time something new arrives.
    pub fn is_stale(&self, now: Instant) -> bool {
        let margin = (self.settling_period()).clamp(self.idle_timeout / 16, self.idle_timeout / 2);
        let oldest = self.spaces.data.sent.packets.front();
        oldest.is_some_and(|it| now >= it.flight.at + self.min_idle_timeout())
            || self.silence.pings > MAX_UNANSWERED_PINGS
            || self.silence.is_watched && self.has_sent_since_receiving
            || now + margin >= self.timers.get(Timer::Idle)
    }

    /// For a client. [`Event::StreamsAvailable`] follows when that has put an end to [`Self::is_stale`].
    pub fn ask_for_answer(&mut self) {
        self.silence.is_watched = true;
        self.streams.state.owed |= Control::PING;
        self.hasten_ack();
    }

    /// A gap tends to be acknowledged without delay (RFC 9000 §13.2.1).
    pub(super) fn hasten_ack(&mut self) {
        if self.next_skip != u64::MAX {
            self.next_skip = self.spaces.data.next_number;
        }
    }
}
