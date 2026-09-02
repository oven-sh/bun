//! Lock-free ring of pending POSIX signal numbers.

use core::sync::atomic::{AtomicU8, AtomicU32, Ordering};

/// Multi-producer, single-consumer ring of nonzero `u8` values.
///
/// The producers are signal handlers. The kernel runs the handler of a
/// process-directed signal on any thread that does not block it, so two
/// handlers can run [`enqueue`](Self::enqueue) at the same time on two
/// threads, or nested on one thread. `enqueue` uses atomics only: no lock,
/// no allocation, no syscall. The consumer is one thread (the event loop).
///
/// `CAPACITY` is a power of two, at most 32768, so that the `u16` indices
/// wrap in step with the slot index and `tail - head` fits in a `u16`.
pub struct SignalRing<const CAPACITY: usize> {
    /// A slot holds 0 while it is free or claimed but not yet written. Signal
    /// numbers start at 1, so 0 never stands for a real signal.
    slots: [AtomicU8; CAPACITY],
    /// Consumer index `head` in the low half, producer index `tail` in the
    /// high half. One word, so that a load is a consistent pair and a CAS
    /// claims an index against exactly the pair it judged.
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

    /// Called by a producer (any thread, possibly several at once, possibly
    /// nested in another producer on the same thread). Returns `true` once
    /// `signal` is published, or `false` if the ring is full.
    ///
    /// `signal` must not be 0: that is the empty-slot sentinel.
    pub fn enqueue(&self, signal: u8) -> bool {
        debug_assert_ne!(signal, 0, "0 is the empty-slot sentinel");
        let mut state = self.state.load(Ordering::Acquire);
        loop {
            let (head, tail) = unpack(state);
            if usize::from(tail.wrapping_sub(head)) >= CAPACITY {
                // Full. A signal handler cannot block or wait, so drop it.
                return false;
            }
            // Claim the index. A lost race means another producer took it,
            // or the consumer moved `head`; either way judge the new pair.
            match self.state.compare_exchange_weak(
                state,
                pack(head, tail.wrapping_add(1)),
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    // Publish the signal into the claimed slot. Until this
                    // store the consumer sees 0 there and stops before it.
                    self.slot(tail).store(signal, Ordering::Release);
                    return true;
                }
                Err(current) => state = current,
            }
        }
    }

    /// Called by the single consumer. Returns the oldest published signal,
    /// or `None` when the ring is empty.
    ///
    /// `None` also means "the oldest claimed slot is not written yet": its
    /// producer is between the claim and the store. The caller must come
    /// back after that producer's wakeup. Slots come out in claim order, so
    /// nothing behind the unwritten one is skipped.
    pub fn dequeue(&self) -> Option<u8> {
        let mut state = self.state.load(Ordering::Acquire);
        let (head, tail) = unpack(state);
        if head == tail {
            return None;
        }

        // Take the slot and leave 0 behind. A 0 here was never written.
        let signal = self.slot(head).swap(0, Ordering::AcqRel);
        if signal == 0 {
            return None;
        }

        // Publish the new `head`. Only this thread moves it, so a lost race
        // means a producer moved `tail`: keep that and retry.
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

    /// Starts both indices at `index`, to put a `u16` wrap or a slot wrap
    /// within reach of a short test.
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

    // Under Miri every atomic op is interpreted; keep the stress short there.
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

    /// Runs `PRODUCERS` threads that each enqueue their own number
    /// `PER_PRODUCER` times while this thread dequeues. Producers wait while
    /// `outstanding_limit` accepted entries are still in the ring, so a test
    /// can keep the ring below full on purpose.
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
                        // This `None` may predate the last producer's final
                        // stores. Only a `None` read after `done` says every
                        // producer returned means the ring is empty.
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

    /// Every accepted signal comes out exactly once and the 0 sentinel never
    /// does, with the ring allowed to fill up and reject.
    #[test]
    fn concurrent_producers_deliver_every_accepted_signal_once() {
        let ring = SignalRing::<64>::new();
        let result = stress(&ring, usize::MAX);
        assert_eq!((result.zeros, result.unknown), (0, 0));
        assert_eq!(result.dequeued, result.accepted);
    }

    /// A ring that never holds more than half its capacity never rejects:
    /// fullness is judged on one consistent `(head, tail)` pair, never on a
    /// stale index.
    #[test]
    fn never_rejects_below_capacity() {
        let ring = SignalRing::<64>::new();
        let result = stress(&ring, 32);
        assert_eq!((result.zeros, result.unknown, result.rejected), (0, 0, 0));
        assert_eq!(result.dequeued, result.accepted);
    }

    /// FIFO order, fullness at exactly `CAPACITY`, and both wraps: the slot
    /// index wraps every 4 entries and the `u16` indices wrap past 65535.
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

    /// A claimed slot whose producer has not stored yet stops the consumer
    /// there, and nothing published behind it is lost or reordered.
    #[test]
    fn stops_at_a_claimed_slot_until_it_is_written() {
        let ring = SignalRing::<8>::new();
        // Claim index 0 without writing it, as a producer between its CAS
        // and its store would.
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
