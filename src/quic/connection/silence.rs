//! A server only learns of a new address of the client from a packet (RFC 9000 §9.3).

use super::Connection;
use super::timers::Timer;
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
    /// The last delivery, or a request after it.
    since: Option<Instant>,
    /// It fades with each delivery.
    longest_pause: Duration,
    patience: Duration,
    /// As of the last delivery or request.
    idle_at: Instant,
    /// From which packet on an acknowledgment is an answer. Loss recovery knows nothing of these packets.
    awaited: Option<u64>,
    timeouts: u32,
    pub(super) owes_ping: bool,
}

impl Silence {
    #[inline]
    fn on_delivery(&mut self, now: Instant) {
        let pause = now - self.since.replace(now).unwrap_or(now);
        self.longest_pause = pause.max(self.longest_pause * 15 / 16);
        self.deliveries = self.deliveries.saturating_add(1);
        let plenty = self.longest_pause * 2;
        self.patience = if pause * 2 > USUAL_PATIENCE {
            plenty.min(USUAL_PATIENCE.max((self.idle_at - now) / WAITS_PER_IDLE_TIMEOUT))
        } else if self.deliveries >= MIN_DELIVERIES {
            plenty.min(USUAL_PATIENCE)
        } else {
            USUAL_PATIENCE
        };
    }
}

impl Connection {
    /// After a client has read what there is.
    #[inline]
    pub(super) fn listen(&mut self, now: Instant) {
        let expects_data = self.expects_data();
        let has_asked = core::mem::take(&mut self.streams.state.has_asked);
        let silence = &mut self.silence;
        let is_over = core::mem::take(&mut silence.is_over);
        if is_over || has_asked {
            silence.idle_at = self.timers.get(Timer::Idle);
        }
        if is_over {
            silence.on_delivery(now);
        }
        if has_asked {
            silence.since = silence.since.and(Some(now));
            silence.patience = match is_over || self.timers.is_set(Timer::Silence) {
                true => silence.patience.min(USUAL_PATIENCE),
                false => USUAL_PATIENCE,
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
        let expects_data = self.expects_data();
        let (silence, space) = (&mut self.silence, &self.spaces.data);
        if now >= silence.idle_at || !expects_data {
            (silence.awaited, silence.since) = (None, None);
            return;
        }
        if silence.awaited.is_none() {
            silence.awaited = Some(space.next_number);
            silence.patience = USUAL_PATIENCE.max(silence.patience * 2);
        }
        silence.timeouts += 1;
        silence.owes_ping = !space.sent.has_in_flight();
        self.set_silence_timer(now, Duration::ZERO);
    }

    #[inline]
    fn expects_data(&self) -> bool {
        self.silence.was_datagram || self.streams.table.has_application_streams()
    }

    #[inline]
    fn set_silence_timer(&mut self, now: Instant, min_pause: Duration) {
        let pause = self.backed_off_by(self.silence.timeouts.max(1), self.probe_timeout());
        self.timers.set(Timer::Silence, now + pause.max(min_pause));
    }
}
