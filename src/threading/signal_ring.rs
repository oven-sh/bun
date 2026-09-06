//! Lock-free ring of pending POSIX signal numbers.

use core::sync::atomic::{AtomicU8, AtomicU32, Ordering};

/// Multi-producer, single-consumer ring of nonzero `u8` values. `enqueue` is
/// atomics only, so signal handlers on any thread may run it at once or nested.
/// `CAPACITY` is a power of two up to 32768: `u16` indices, `tail - head` fits.
pub struct SignalRing<const CAPACITY: usize> {
    /// 0 while free or claimed but not yet written (signal numbers start at 1).
    slots: [AtomicU8; CAPACITY],
    /// `head` (consumer) in the low half, `tail` (producer) in the high half,
    /// so one load reads a consistent pair and one CAS claims against it.
    state: AtomicU32,
}

#[inline]
const fn unpack(state: u32) -> (u16, u16) {
    (state as u16, (state >> 16) as u16)
}

#[inline]
const fn pack(head: u16, tail: u16) -> u32 {
    (tail as u32) << 16 | head as u32
}

impl<const CAPACITY: usize> Default for SignalRing<CAPACITY> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const CAPACITY: usize> SignalRing<CAPACITY> {
    const CAPACITY_IS_VALID: () = assert!(
        CAPACITY.is_power_of_two() && CAPACITY <= 1 << 15,
        "SignalRing capacity must be a power of two no larger than 32768"
    );

    pub const fn new() -> Self {
        let () = Self::CAPACITY_IS_VALID;
        Self {
            slots: [const { AtomicU8::new(0) }; CAPACITY],
            state: AtomicU32::new(0),
        }
    }

    #[inline]
    fn slot(&self, index: u16) -> &AtomicU8 {
        &self.slots[index as usize % CAPACITY]
    }

    /// Producer side, any thread. Returns `false` when full. `signal` is never 0.
    pub fn enqueue(&self, signal: u8) -> bool {
        debug_assert_ne!(signal, 0, "0 is the empty-slot sentinel");
        let mut state = self.state.load(Ordering::Acquire);
        loop {
            let (head, tail) = unpack(state);
            if usize::from(tail.wrapping_sub(head)) >= CAPACITY {
                return false;
            }
            match self.state.compare_exchange_weak(
                state,
                pack(head, tail.wrapping_add(1)),
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    self.slot(tail).store(signal, Ordering::Release);
                    return true;
                }
                Err(current) => state = current,
            }
        }
    }

    /// Consumer side, one thread only. Returns the oldest published signal.
    /// `None` means empty, or that the oldest claimed slot is still 0 because
    /// its producer has not stored yet: come back after that producer's
    /// wakeup, nothing behind it is skipped.
    pub fn dequeue(&self) -> Option<u8> {
        let mut state = self.state.load(Ordering::Acquire);
        let (head, tail) = unpack(state);
        if head == tail {
            return None;
        }

        let signal = self.slot(head).swap(0, Ordering::AcqRel);
        if signal == 0 {
            return None;
        }

        // Only this thread moves `head`; a lost CAS means `tail` moved.
        loop {
            let (_, tail) = unpack(state);
            match self.state.compare_exchange_weak(
                state,
                pack(head.wrapping_add(1), tail),
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Some(signal),
                Err(current) => state = current,
            }
        }
    }

    /// Starts both indices at `index`, to put the `u16` wrap within reach.
    #[cfg(test)]
    fn starting_at(index: u16) -> Self {
        let ring = Self::new();
        ring.state.store(pack(index, index), Ordering::Relaxed);
        ring
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
    const PER_PRODUCER: usize = 200;
    #[cfg(not(miri))]
    const PER_PRODUCER: usize = 50_000;

    struct Stress {
        accepted: Vec<usize>,
        dequeued: Vec<usize>,
        rejected: usize,
        zeros: usize,
        unknown: usize,
    }

    /// Producers wait while `outstanding_limit` accepted entries are in the ring.
    fn stress<const CAPACITY: usize>(
        ring: &SignalRing<CAPACITY>,
        outstanding_limit: usize,
    ) -> Stress {
        let done = AtomicUsize::new(0);
        let outstanding = AtomicUsize::new(0);
        let mut dequeued = vec![0usize; usize::from(PRODUCERS)];
        let mut zeros = 0;
        let mut unknown = 0;

        let (accepted, rejected) = std::thread::scope(|scope| {
            let workers: Vec<_> = (1..=PRODUCERS)
                .map(|signal| {
                    let (done, outstanding) = (&done, &outstanding);
                    scope.spawn(move || {
                        let mut accepted = 0usize;
                        let mut rejected = 0usize;
                        while accepted < PER_PRODUCER {
                            if outstanding.load(Ordering::Acquire) >= outstanding_limit {
                                std::thread::yield_now();
                                continue;
                            }
                            outstanding.fetch_add(1, Ordering::AcqRel);
                            if ring.enqueue(signal) {
                                accepted += 1;
                            } else {
                                outstanding.fetch_sub(1, Ordering::AcqRel);
                                rejected += 1;
                                std::thread::yield_now();
                            }
                        }
                        done.fetch_add(1, Ordering::Release);
                        (accepted, rejected)
                    })
                })
                .collect();

            let mut producers_done = false;
            loop {
                match ring.dequeue() {
                    Some(0) => zeros += 1,
                    Some(signal) if signal <= PRODUCERS => {
                        dequeued[usize::from(signal) - 1] += 1;
                        outstanding.fetch_sub(1, Ordering::AcqRel);
                    }
                    Some(_) => unknown += 1,
                    None if producers_done => break,
                    None => {
                        // Only a `None` read after `done` reached PRODUCERS means empty.
                        producers_done = done.load(Ordering::Acquire) == usize::from(PRODUCERS);
                        std::hint::spin_loop();
                    }
                }
            }

            let mut accepted = Vec::new();
            let mut rejected = 0;
            for worker in workers {
                let (a, r) = worker.join().unwrap();
                accepted.push(a);
                rejected += r;
            }
            (accepted, rejected)
        });

        Stress {
            accepted,
            dequeued,
            rejected,
            zeros,
            unknown,
        }
    }

    #[test]
    fn concurrent_producers_deliver_every_accepted_signal_once() {
        let ring = SignalRing::<64>::new();
        let result = stress(&ring, usize::MAX);
        assert_eq!((result.zeros, result.unknown), (0, 0));
        assert_eq!(result.dequeued, result.accepted);
    }

    /// Fullness is judged on one consistent `(head, tail)` pair, never a stale one.
    #[test]
    fn never_rejects_below_capacity() {
        let ring = SignalRing::<64>::new();
        let result = stress(&ring, 32);
        assert_eq!((result.zeros, result.unknown, result.rejected), (0, 0, 0));
        assert_eq!(result.dequeued, result.accepted);
    }

    #[test]
    fn fifo_across_both_wraps() {
        let ring = SignalRing::<4>::starting_at(u16::MAX - 5);
        for round in 0..4u8 {
            for i in 0..4u8 {
                assert!(ring.enqueue(round * 4 + i + 1));
            }
            assert!(!ring.enqueue(99), "full at CAPACITY");
            for i in 0..4u8 {
                assert_eq!(ring.dequeue(), Some(round * 4 + i + 1));
            }
            assert_eq!(ring.dequeue(), None);
        }
    }

    #[test]
    fn stops_at_a_claimed_slot_until_it_is_written() {
        let ring = SignalRing::<8>::new();
        // A producer between its CAS and its store.
        let (_, claimed) = unpack(ring.state.fetch_add(pack(0, 1), Ordering::AcqRel));
        assert!(ring.enqueue(2));
        assert!(ring.enqueue(3));
        assert_eq!(ring.dequeue(), None);
        assert_eq!(ring.dequeue(), None);

        ring.slot(claimed).store(1, Ordering::Release);
        assert_eq!(ring.dequeue(), Some(1));
        assert_eq!(ring.dequeue(), Some(2));
        assert_eq!(ring.dequeue(), Some(3));
        assert_eq!(ring.dequeue(), None);
    }
}
