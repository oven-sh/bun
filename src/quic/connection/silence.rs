//! A server only learns of a new address of the client from a packet (RFC 9000 §9.3).

use super::Connection;
use super::timers::Timer;
use crate::time::{Duration, Instant};

const MIN_DELIVERIES: u32 = 20;
const MIN_PAUSES_PER_IDLE_TIMEOUT: u64 = 8;

#[derive(Default)]
pub(super) struct Silence {
    /// Data has arrived.
    pub(super) is_over: bool,
    /// It needs no stream.
    pub(super) was_datagram: bool,
    deliveries: u32,
    delivered_at: Option<Instant>,
    /// Between two deliveries. It fades with each one.
    longest_pause: Duration,
    /// As of the last delivery.
    idle_at: Instant,
    /// From which packet on an acknowledgment is an answer. Loss recovery knows nothing of these packets.
    awaited: Option<u64>,
    timeouts: u32,
    pub(super) owes_ping: bool,
}

impl Connection {
    /// After a client has read what there is.
    #[inline]
    pub(super) fn listen(&mut self, now: Instant) {
        let silence = &mut self.silence;
        let is_over = core::mem::take(&mut silence.is_over);
        let is_answered = silence.awaited <= self.spaces.data.sent.largest_acked;
        if match silence.awaited {
            Some(_) => is_answered || is_over && silence.timeouts > 0,
            None => is_over,
        } {
            (silence.awaited, silence.owes_ping) = (None, false);
            self.timers.stop(Timer::Silence);
        }
        self.spaces.data.received.is_ack_due |= silence.owes_ping;
        if is_over {
            let pause = now - silence.delivered_at.replace(now).unwrap_or(now);
            let pause = pause.max(silence.longest_pause * 15 / 16);
            silence.longest_pause = pause;
            silence.idle_at = self.timers.get(Timer::Idle);
            silence.deliveries = silence.deliveries.saturating_add(1);
            silence.timeouts = 0;
            if silence.awaited.is_none()
                && silence.deliveries >= MIN_DELIVERIES
                && now + pause * MIN_PAUSES_PER_IDLE_TIMEOUT <= silence.idle_at
            {
                self.set_silence_timer(now, pause * 2);
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
        if now >= silence.idle_at
            || !self.streams.table.has_application_streams() && !silence.was_datagram
        {
            (silence.awaited, silence.delivered_at) = (None, None);
            return;
        }
        silence.awaited.get_or_insert(space.next_number);
        silence.timeouts += 1;
        silence.owes_ping = !space.sent.has_in_flight();
        self.set_silence_timer(now, Duration::ZERO);
    }

    #[inline]
    fn set_silence_timer(&mut self, now: Instant, min_pause: Duration) {
        let pause = self.backed_off_by(self.silence.timeouts.max(1), self.probe_timeout());
        self.timers.set(Timer::Silence, now + pause.max(min_pause));
    }
}
