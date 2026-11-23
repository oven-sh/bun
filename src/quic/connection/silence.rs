//! A server only learns of a new address of the client from a packet (RFC 9000 §9.3).

use super::Connection;
use super::streams::Asked;
use super::timers::Timer;
use crate::event::Event;
use crate::stream_id::Direction;
use crate::time::{Duration, Instant};

/// How many it takes to know the pace of the server.
const MIN_DELIVERIES: u32 = 20;
const USUAL_PATIENCE: Duration = Duration::from_secs(1);
const WAITS_PER_IDLE_TIMEOUT: u64 = 4;

#[derive(Default)]
pub(super) struct Silence {
    /// Data has arrived.
    pub(super) is_over: bool,
    /// It needs no stream.
    pub(super) was_datagram: bool,
    deliveries: u32,
    /// It jumps with a long pause, and falls with each short one.
    slowness: u32,
    /// The last delivery, or progress with a request.
    since: Option<Instant>,
    /// It fades with each shorter one.
    longest_pause: Duration,
    patience: Duration,
    /// As of the last delivery or request.
    idle_at: Instant,
    /// From which packet on an acknowledgment is an answer. Loss recovery knows nothing of these packets.
    awaited: Option<u64>,
    timeouts: u32,
    pub(super) owes_ping: bool,
    /// Since the server was last heard from.
    pub(super) pings: u32,
    /// See [`Connection::ask_for_answer`].
    pub(super) is_watched: bool,
}

impl Silence {
    #[inline]
    fn end_pause(&mut self, now: Instant) {
        let pause = now - self.since.replace(now).unwrap_or(now);
        self.longest_pause = pause.max(self.longest_pause * 15 / 16);
        self.slowness = match pause * 2 > USUAL_PATIENCE {
            true => (self.slowness + MIN_DELIVERIES).min(2 * MIN_DELIVERIES),
            false => self.slowness.saturating_sub(1),
        };
    }

    #[inline]
    fn on_delivery(&mut self, now: Instant) {
        self.deliveries = self.deliveries.saturating_add(1);
        self.patience = self.max_patience(now);
        if self.deliveries >= MIN_DELIVERIES {
            self.patience = self.patience.min(self.longest_pause * 2);
        }
    }

    #[inline]
    fn max_patience(&self, now: Instant) -> Duration {
        if self.slowness <= MIN_DELIVERIES {
            return USUAL_PATIENCE;
        }
        let share = (self.idle_at - now) / (WAITS_PER_IDLE_TIMEOUT + 1);
        USUAL_PATIENCE.max(share.min(self.longest_pause * 2))
    }
}

impl Connection {
    /// After a client has read what there is.
    #[inline]
    pub(super) fn listen(&mut self, now: Instant) {
        if self.silence.is_watched && !self.is_stale(now) {
            self.silence.is_watched = false;
            self.emit(Event::StreamsAvailable(Direction::Bidirectional));
        }
        let state = &mut self.streams.state;
        let asked = core::mem::take(&mut state.asked);
        let has_asked = asked > Asked::InPart;
        let silence = &mut self.silence;
        let is_over = core::mem::take(&mut silence.is_over);
        state.unanswered.take_if(|_| is_over);
        silence.was_datagram &= is_over || !has_asked;
        let expects_data = silence.was_datagram || self.streams.table.has_application_streams();
        if is_over || has_asked {
            silence.idle_at = self.timers.get(Timer::Idle);
        }
        if is_over || asked > Asked::Nothing {
            silence.end_pause(now);
        }
        if is_over {
            silence.on_delivery(now);
        } else if asked == Asked::Anew {
            silence.patience = match self.timers.is_set(Timer::Silence) {
                true => silence.patience.min(silence.max_patience(now)),
                false => silence.max_patience(now),
            };
        }
        if !expects_data {
            silence.since = None;
        }
        if match silence.awaited {
            Some(_) => {
                silence.awaited <= self.spaces.data.sent.largest_acked
                    || is_over && silence.timeouts > 0
            }
            None => is_over || has_asked || !expects_data,
        } {
            (silence.awaited, silence.timeouts, silence.owes_ping) = (None, 0, false);
            match expects_data && now + silence.patience * WAITS_PER_IDLE_TIMEOUT <= silence.idle_at
            {
                true => self.set_silence_timer(now, self.silence.patience),
                false => self.timers.stop(Timer::Silence),
            }
        }
    }

    /// If a PATH_RESPONSE frame is lost, the server may have no allowance for another challenge.
    pub(super) fn await_acknowledgment(&mut self, now: Instant, number: u64) {
        if self.side.is_client() {
            let silence = &mut self.silence;
            (silence.awaited, silence.timeouts, silence.owes_ping) = (Some(number), 0, false);
            self.set_silence_timer(now, Duration::ZERO);
        }
    }

    pub(super) fn break_silence(&mut self, now: Instant) {
        let (silence, space) = (&mut self.silence, &self.spaces.data);
        let has_streams = match silence.awaited {
            Some(_) => self.streams.table.has_application_streams(),
            None => self.streams.table.has_unfinished_reads(),
        };
        if now >= silence.idle_at || !has_streams && !silence.was_datagram {
            (silence.awaited, silence.since) = (None, None);
            return;
        }
        if silence.awaited.is_none() {
            silence.awaited = Some(space.next_number);
            silence.patience = USUAL_PATIENCE.max(silence.patience * 2);
        }
        silence.timeouts += 1;
        silence.owes_ping = !space.sent.has_in_flight();
        silence.pings += u32::from(silence.owes_ping);
        self.set_silence_timer(now, Duration::ZERO);
    }

    #[inline]
    fn set_silence_timer(&mut self, now: Instant, min_pause: Duration) {
        let pause = self.backed_off_by(self.silence.timeouts.max(1), self.probe_timeout());
        self.timers.set(Timer::Silence, now + pause.max(min_pause));
    }
}
