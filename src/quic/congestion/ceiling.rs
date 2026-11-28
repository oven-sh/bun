//! Short transfers do not end startup, so nothing else corrects a pace that is a little too high for the path.

/// For how many rounds it stays.
const MIN_STAY: u8 = 9;
const MAX_STAY: u8 = 8 * MIN_STAY;
/// For how many rounds a loss shows that a change was wrong.
const TRIAL_ROUNDS: u8 = 4;
const HIGH_SUSPICION: u8 = 6;

pub(super) struct Ceiling {
    /// In bytes per second.
    pub(super) rate: u64,
    rounds: u8,
    stay: u8,
    was_raised: bool,
    /// Of a queue that is too short to show in the round-trip time.
    suspicion: u8,
    /// The rate and the rounds, if it was lowered on suspicion.
    former: Option<(u64, u8)>,
}

impl Ceiling {
    pub(super) const NONE: Self = Self {
        rate: u64::MAX,
        rounds: 0,
        stay: MIN_STAY,
        was_raised: false,
        suspicion: 0,
        former: None,
    };

    pub(super) fn suspects_short_queue(&self) -> bool {
        self.former.is_some()
    }

    pub(super) fn on_congestion(&mut self, pacing_rate: u64) {
        *self = Self {
            rate: pacing_rate - pacing_rate / 8,
            stay: match self.was_raised && self.rounds <= TRIAL_ROUNDS {
                true => MAX_STAY.min(2 * self.stay),
                false => self.stay,
            },
            ..Self::NONE
        };
    }

    /// For a round in which the application sent much and met no queue.
    pub(super) fn on_clear_round(&mut self, pacing_rate: u64, has_loss: bool) {
        self.rounds = self.rounds.saturating_add(1);
        let former = (self.rate, self.rounds);
        if !has_loss {
            self.suspicion = self.suspicion.saturating_sub(1);
        } else if let Some((rate, rounds)) = self.former.filter(|_| self.rounds <= TRIAL_ROUNDS) {
            *self = Self {
                rate,
                rounds: rounds.saturating_add(self.rounds),
                ..Self::NONE
            };
        } else if self.suspicion + 2 >= HIGH_SUSPICION {
            self.on_congestion(pacing_rate);
            self.former = Some(former);
        } else {
            self.suspicion += 2;
        }
        let stay = match self.was_raised {
            true => MIN_STAY,
            false => self.stay,
        };
        if self.rounds >= stay && self.rate <= pacing_rate {
            *self = Self {
                rate: pacing_rate.saturating_add(pacing_rate / 8),
                stay,
                was_raised: true,
                suspicion: HIGH_SUSPICION,
                ..Self::NONE
            };
        }
    }
}
