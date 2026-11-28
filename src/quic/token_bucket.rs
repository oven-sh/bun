use crate::time::Instant;

pub struct TokenBucket {
    per_second: f64,
    burst: f64,
    tokens: f64,
    refilled_at: Instant,
}

impl TokenBucket {
    pub const fn new(per_second: f64, burst: f64) -> Self {
        Self {
            per_second,
            burst,
            tokens: burst,
            refilled_at: Instant::from_micros(0),
        }
    }

    /// Returns false if there are not as many.
    pub fn take(&mut self, now: Instant, count: u32) -> bool {
        let elapsed = now - core::mem::replace(&mut self.refilled_at, now);
        let refill = elapsed.as_micros() as f64 / 1e6 * self.per_second;
        self.tokens = (self.tokens + refill).min(self.burst);
        let has_enough = self.tokens >= count.into();
        if has_enough {
            self.tokens -= f64::from(count);
        }
        has_enough
    }

    pub fn put_back(&mut self, count: u32) {
        self.tokens += f64::from(count);
    }
}
