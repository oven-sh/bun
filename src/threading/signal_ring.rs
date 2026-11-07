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

    /// Any thread. Calls `f` with each queued signal, oldest first, and takes none out.
    /// Waits for a slot that a producer has claimed but not stored yet.
    pub fn for_each_queued(&self, mut f: impl FnMut(u8)) {
        let (head, tail) = unpack(self.state.load(Ordering::Acquire));
        'slots: for offset in 0..tail.wrapping_sub(head) {
            let index = head.wrapping_add(offset);
            let slot = self.slot(index);
            loop {
                let signal = slot.load(Ordering::Acquire);
                if signal != 0 {
                    f(signal);
                    break;
                }
                // A 0 slot outside the live range is one the consumer took.
                let (head_now, tail_now) = unpack(self.state.load(Ordering::Acquire));
                if index.wrapping_sub(head_now) >= tail_now.wrapping_sub(head_now) {
                    continue 'slots;
                }
                std::thread::yield_now();
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
    /// `before_consuming` runs on the consumer thread once the producers are up.
    fn stress<const CAPACITY: usize>(
        ring: &SignalRing<CAPACITY>,
        outstanding_limit: usize,
        before_consuming: impl FnOnce(),
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

            before_consuming();
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
        let result = stress(&ring, usize::MAX, || {});
        assert_eq!((result.zeros, result.unknown), (0, 0));
        assert_eq!(result.dequeued, result.accepted);
    }

    /// Fullness is judged on one consistent `(head, tail)` pair, never a stale one.
    #[test]
    fn never_rejects_below_capacity() {
        let ring = SignalRing::<64>::new();
        let result = stress(&ring, 32, || {});
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

    fn queued<const CAPACITY: usize>(ring: &SignalRing<CAPACITY>) -> Vec<u8> {
        let mut signals = Vec::new();
        ring.for_each_queued(|signal| signals.push(signal));
        signals
    }

    #[test]
    fn view_reports_what_is_queued_and_takes_nothing() {
        let ring = SignalRing::<4>::starting_at(u16::MAX - 1);
        assert_eq!(queued(&ring), []);
        for signal in 1..=4u8 {
            assert!(ring.enqueue(signal));
        }
        assert_eq!(queued(&ring), [1, 2, 3, 4]);
        assert_eq!(queued(&ring), [1, 2, 3, 4]);
        assert_eq!(ring.dequeue(), Some(1));
        assert_eq!(queued(&ring), [2, 3, 4]);
        for signal in 2..=4u8 {
            assert_eq!(ring.dequeue(), Some(signal));
        }
        assert_eq!(queued(&ring), []);
    }

    /// Views the ring on another thread, runs `release` while that view waits on a slot of 0, and returns the view.
    fn view_while_a_slot_is_zero<const CAPACITY: usize>(
        ring: &SignalRing<CAPACITY>,
        release: impl FnOnce(),
    ) -> Vec<u8> {
        std::thread::scope(|scope| {
            let viewer = scope.spawn(|| queued(ring));
            std::thread::sleep(std::time::Duration::from_millis(20));
            assert!(
                !viewer.is_finished(),
                "the view returned with a slot still at 0"
            );
            release();
            viewer.join().unwrap()
        })
    }

    #[test]
    fn view_waits_for_a_claimed_slot() {
        let ring = SignalRing::<8>::new();
        // A producer between its CAS and its store.
        let (_, claimed) = unpack(ring.state.fetch_add(pack(0, 1), Ordering::AcqRel));
        assert!(ring.enqueue(2));
        assert_eq!(ring.dequeue(), None);

        let view =
            view_while_a_slot_is_zero(&ring, || ring.slot(claimed).store(1, Ordering::Release));
        assert_eq!(view, [1, 2]);
        assert_eq!(ring.dequeue(), Some(1));
        assert_eq!(ring.dequeue(), Some(2));
    }

    #[test]
    fn view_skips_a_slot_that_the_consumer_is_taking() {
        let ring = SignalRing::<8>::new();
        assert!(ring.enqueue(1));
        assert!(ring.enqueue(2));
        // The consumer between its swap and its move of `head`.
        assert_eq!(ring.slot(0).swap(0, Ordering::AcqRel), 1);

        let view = view_while_a_slot_is_zero(&ring, || {
            ring.state.fetch_add(pack(1, 0), Ordering::AcqRel);
        });
        assert_eq!(view, [2]);
        assert_eq!(ring.dequeue(), Some(2));
        assert_eq!(ring.dequeue(), None);
    }

    /// The consumer takes 65536 signals while the view waits: `head` reads as before.
    #[test]
    fn view_ends_when_the_consumer_drained_a_full_u16_cycle_past_its_snapshot() {
        let ring = SignalRing::<8>::starting_at(7);
        let (_, claimed) = unpack(ring.state.fetch_add(pack(0, 1), Ordering::AcqRel));
        let view = view_while_a_slot_is_zero(&ring, || {
            ring.state.store(pack(claimed, claimed), Ordering::Release);
        });
        assert_eq!(view, []);
    }

    /// A viewer beside working producers and the consumer sees only published signals.
    #[test]
    fn view_beside_producers_and_the_consumer_reports_only_published_signals() {
        const CAPACITY: usize = 64;
        let ring = SignalRing::<CAPACITY>::new();
        let finished = AtomicUsize::new(0);
        let seen_signals = AtomicUsize::new(0);
        let (result, (views, bad)) = std::thread::scope(|scope| {
            let viewer = scope.spawn(|| {
                let (mut views, mut bad) = (0usize, 0usize);
                loop {
                    let view = queued(&ring);
                    views += 1;
                    if !view.is_empty() {
                        seen_signals.store(1, Ordering::Release);
                    }
                    bad += usize::from(view.len() > CAPACITY);
                    bad += view.iter().filter(|&&s| s == 0 || s > PRODUCERS).count();
                    if finished.load(Ordering::Acquire) != 0 {
                        break (views, bad);
                    }
                    std::thread::yield_now();
                }
            });
            // The consumer holds back until a view has seen producers at work.
            let result = stress(&ring, usize::MAX, || {
                while seen_signals.load(Ordering::Acquire) == 0 {
                    std::thread::yield_now();
                }
            });
            finished.store(1, Ordering::Release);
            (result, viewer.join().unwrap())
        });
        assert!(views > 0);
        assert_eq!((result.zeros, result.unknown, bad), (0, 0, 0));
        assert_eq!(result.dequeued, result.accepted);
    }
}
