//! Counts of pending POSIX signals, one per signal number.

use core::sync::atomic::{AtomicU32, AtomicU64, Ordering};

/// Multi-producer, multi-consumer pending-signal counts. Never full.
pub struct PendingSignals {
    /// How many times each signal number arrived since it was last taken.
    counts: [AtomicU32; 256],
    /// Bit `n` set: `counts[n]` may be nonzero (a hint, never authoritative).
    mask: [AtomicU64; 4],
}

#[inline]
const fn mask_bit(signal: u8) -> (usize, u64) {
    (signal as usize / 64, 1u64 << (signal % 64))
}

impl Default for PendingSignals {
    fn default() -> Self {
        Self::new()
    }
}

impl PendingSignals {
    pub const fn new() -> Self {
        Self {
            counts: [const { AtomicU32::new(0) }; 256],
            mask: [const { AtomicU64::new(0) }; 4],
        }
    }

    /// Producer side, any thread, async-signal-safe. `signal` is never 0.
    pub fn add(&self, signal: u8) {
        debug_assert_ne!(signal, 0, "signal numbers start at 1");
        self.counts[usize::from(signal)].fetch_add(1, Ordering::Relaxed);
        let (word, bit) = mask_bit(signal);
        self.mask[word].fetch_or(bit, Ordering::Release);
    }

    /// Consumer side, any number of them. Calls `f(signal, count)` for each
    /// pending number, lowest first, and resets its count.
    pub fn take(&self, mut f: impl FnMut(u8, u32)) {
        for (index, word) in self.mask.iter().enumerate() {
            if word.load(Ordering::Acquire) == 0 {
                continue;
            }
            let mut bits = word.swap(0, Ordering::AcqRel);
            while bits != 0 {
                let bit = bits.trailing_zeros();
                bits &= bits - 1;
                let signal = (index * 64 + bit as usize) as u8;
                let count = self.counts[usize::from(signal)].swap(0, Ordering::AcqRel);
                // 0 when another consumer took it or the bit outran the count.
                if count != 0 {
                    f(signal, count);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    // Miri interprets every atomic op, so the stress stays short there.
    #[cfg(miri)]
    const PRODUCERS: u8 = 4;
    #[cfg(not(miri))]
    const PRODUCERS: u8 = 8;
    #[cfg(miri)]
    const PER_PRODUCER: u32 = 200;
    #[cfg(not(miri))]
    const PER_PRODUCER: u32 = 50_000;

    #[test]
    fn counts_are_exact_and_lowest_number_first() {
        let pending = PendingSignals::new();
        pending.add(15);
        pending.add(2);
        pending.add(15);
        pending.add(255);
        pending.add(64);
        pending.add(15);

        let mut seen = Vec::new();
        pending.take(|signal, count| seen.push((signal, count)));
        assert_eq!(seen, [(2, 1), (15, 3), (64, 1), (255, 1)]);

        seen.clear();
        pending.take(|signal, count| seen.push((signal, count)));
        assert_eq!(seen, []);

        pending.add(2);
        pending.take(|signal, count| seen.push((signal, count)));
        assert_eq!(seen, [(2, 1)]);
    }

    /// Producers on several threads never lose an arrival.
    #[test]
    fn concurrent_producers_deliver_every_arrival_once() {
        let pending = PendingSignals::new();
        let done = AtomicUsize::new(0);
        let mut taken = [0u32; 256];

        std::thread::scope(|scope| {
            for signal in 1..=PRODUCERS {
                let (pending, done) = (&pending, &done);
                scope.spawn(move || {
                    for _ in 0..PER_PRODUCER {
                        pending.add(signal);
                    }
                    done.fetch_add(1, Ordering::Release);
                });
            }
            loop {
                let all_done = done.load(Ordering::Acquire) == usize::from(PRODUCERS);
                pending.take(|signal, count| taken[usize::from(signal)] += count);
                if all_done {
                    break;
                }
                std::hint::spin_loop();
            }
        });

        for signal in 1..=PRODUCERS {
            assert_eq!(taken[usize::from(signal)], PER_PRODUCER, "signal {signal}");
        }
        assert_eq!(
            taken.iter().map(|&n| u64::from(n)).sum::<u64>(),
            u64::from(PRODUCERS) * u64::from(PER_PRODUCER)
        );
    }
}
