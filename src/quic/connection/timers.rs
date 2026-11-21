use crate::time::Instant;

/// In the order in which they are handled.
#[derive(Debug, Clone, Copy)]
pub(super) enum Timer {
    Handshake,
    Idle,
    Progress,
    Close,
    Loss,
    Ack,
    Qpack,
    Pacing,
    KeepAlive,
    Blocked,
    Path,
    KeyDiscard,
}

impl Timer {
    pub(super) const ALL: [Self; 12] = [
        Self::Handshake,
        Self::Idle,
        Self::Progress,
        Self::Close,
        Self::Loss,
        Self::Ack,
        Self::Qpack,
        Self::Pacing,
        Self::KeepAlive,
        Self::Blocked,
        Self::Path,
        Self::KeyDiscard,
    ];
}

pub(super) struct Timers([Instant; Timer::ALL.len()]);

impl Default for Timers {
    fn default() -> Self {
        Self([Instant::NEVER; Timer::ALL.len()])
    }
}

#[expect(clippy::indexing_slicing, reason = "there is an entry for each timer")]
impl Timers {
    #[inline]
    pub(super) fn get(&self, timer: Timer) -> Instant {
        self.0[timer as usize]
    }

    #[inline]
    pub(super) fn set(&mut self, timer: Timer, at: Instant) {
        self.0[timer as usize] = at;
    }

    #[inline]
    pub(super) fn stop(&mut self, timer: Timer) {
        self.set(timer, Instant::NEVER);
    }

    #[inline]
    pub(super) fn is_set(&self, timer: Timer) -> bool {
        self.get(timer) != Instant::NEVER
    }

    #[inline]
    pub(super) fn earliest(&self) -> Instant {
        self.0.iter().copied().fold(Instant::NEVER, Instant::min)
    }
}
