use core::cell::Cell;

use crate::Work;
use crate::digits::{DigitDivisor, Reciprocal};

/// What has been worked out about the divisors seen last, for when they come again.
#[derive(Default)]
pub struct DivisorCache {
    digits: [Cell<DigitEntry>; DIGIT_ENTRIES],
    /// Of the divisor that `reciprocal` is for.
    length: Cell<usize>,
    top: [Cell<u64>; Reciprocal::DIVISOR_LENGTH],
    reciprocal: Reciprocal,
    /// A mark of the last divisor that was another.
    last_miss: Cell<u64>,
    since_hit: Cell<Misses>,
}

const DIGIT_ENTRIES: usize = 4;

#[derive(Clone, Copy, Default)]
struct DigitEntry {
    divisor: u64,
    /// Not before it comes a second time.
    prepared: Option<DigitDivisor>,
}

#[derive(Clone, Copy, Default)]
struct Misses {
    all: u32,
    repeated: u32,
}

impl DivisorCache {
    #[inline(always)]
    pub(crate) fn digit(&self, divisor: u64) -> Option<DigitDivisor> {
        let index = divisor.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> (64 - DIGIT_ENTRIES.ilog2());
        let entry = &self.digits[index as usize];
        let known = entry.get();
        if known.divisor != divisor {
            entry.set(DigitEntry {
                divisor,
                prepared: None,
            });
            return None;
        }
        Some(known.prepared.unwrap_or_else(|| Self::prepare(entry)))
    }

    #[cold]
    fn prepare(entry: &Cell<DigitEntry>) -> DigitDivisor {
        let divisor = entry.get().divisor;
        let prepared = DigitDivisor::new(divisor);
        entry.set(DigitEntry {
            divisor,
            prepared: Some(prepared),
        });
        prepared
    }

    /// `divisor` has two digits or more. What is returned holds until the next call.
    #[inline(always)]
    pub(crate) fn reciprocal(&self, divisor: &[u64]) -> Option<&Reciprocal> {
        let is_known = self.length.get() == divisor.len()
            && (self.top.iter().rev())
                .zip(divisor.iter().rev())
                .all(|(known, &digit)| known.get() == digit);
        if is_known {
            self.since_hit.take();
            return Some(&self.reciprocal);
        }
        self.did_miss(divisor);
        None
    }

    /// The reciprocal takes as long as a few divisions. A quotient and a remainder in a row are no reason yet.
    #[inline(never)]
    fn did_miss(&self, divisor: &[u64]) {
        const MIN_REPEATED: u32 = 3;
        const MIN_ALL: u32 = 64;
        let mark = divisor[0] ^ divisor[divisor.len() - 1].rotate_left(32);
        let is_repeated = self.last_miss.replace(mark) == mark;
        let Misses { all, repeated } = self.since_hit.take();
        let misses = Misses {
            all: all + 1,
            repeated: if is_repeated { repeated + 1 } else { 0 },
        };
        if misses.repeated >= MIN_REPEATED || misses.all >= MIN_ALL {
            self.remember(divisor);
        } else {
            self.since_hit.set(misses);
        }
    }

    #[cold]
    fn remember(&self, divisor: &[u64]) {
        if let Ok(reciprocal) = Reciprocal::new(divisor, &mut Work::new(&mut || false)) {
            self.reciprocal.set(&reciprocal);
            self.length.set(divisor.len());
            for (known, &digit) in self.top.iter().rev().zip(divisor.iter().rev()) {
                known.set(digit);
            }
        }
    }
}
