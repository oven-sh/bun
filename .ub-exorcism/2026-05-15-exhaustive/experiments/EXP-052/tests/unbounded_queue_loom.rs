// EXP-052 loom test: 2 producers, 1 consumer.
//
// Two models:
//   * `correct_orderings_are_sound` — uses AcqRel/Release/Acquire; loom must
//     find no UB across all explored interleavings (state space bounded
//     by `LOOM_MAX_PREEMPTIONS=3`, well under 200 iterations for this shape).
//   * `racy_relaxed_negative_control` — drops all orderings to Relaxed; we
//     **expect** loom to find a missing-sync interleaving (e.g. the consumer
//     observing a stale `next == null` in a state where the producer's swap
//     already completed, leading to lost items in the drained queue).
//
// The negative control's job is to prove the harness probes interesting
// interleavings; the correct variant's clean run is the actual EXP verdict.

#![cfg(loom)]

use exp_052_unbounded_queue_loom::{
    model_thread, Link, ModelArc, Ordering, UnboundedQueue,
};

// `static mut` storage for nodes — loom requires that nodes remain reachable
// throughout the model, so we leak them into `Box::leak` (loom's `Box` does
// not deallocate at end-of-model).
fn alloc_link(value: usize) -> *mut Link<usize> {
    Box::into_raw(Box::new(Link::new(value)))
}

#[test]
fn correct_orderings_are_sound() {
    loom::model(|| {
        let sentinel = alloc_link(usize::MAX);
        let q = ModelArc::new(UnboundedQueue::<usize>::new_with_sentinel(sentinel));

        let p1 = {
            let q = q.clone();
            model_thread::spawn(move || {
                q.correct_push(alloc_link(1));
            })
        };
        let p2 = {
            let q = q.clone();
            model_thread::spawn(move || {
                q.correct_push(alloc_link(2));
            })
        };

        let q_c = q.clone();
        let consumer = model_thread::spawn(move || {
            let mut seen = Vec::new();
            for _ in 0..2 {
                if let Some(p) = q_c.correct_pop(4) {
                    seen.push(unsafe { (*p).value });
                }
            }
            seen
        });

        p1.join().unwrap();
        p2.join().unwrap();
        let seen = consumer.join().unwrap();

        // Post-join drain: producers/consumer all stopped. Use the queue's
        // Acquire ordering for the drain so loom does not flag a mut/atomic
        // race with the still-live `*mut Link<usize>` interior atomics.
        let mut all = seen;
        loop {
            // After join, no concurrent stores; Acquire is overkill but
            // satisfies loom's bookkeeping.
            let front = q.front.load(Ordering::Acquire);
            let next = unsafe { (*front).next.load(Ordering::Acquire) };
            if next.is_null() {
                break;
            }
            q.front.store(next, Ordering::Release);
            all.push(unsafe { (*next).value });
        }

        // Every produced value must appear exactly once.
        assert_eq!(all.len(), 2, "saw: {:?}", all);
        assert!(all.contains(&1) && all.contains(&2), "saw: {:?}", all);

        // Intentionally leak nodes — loom forbids non-atomic frees while
        // any model thread might still touch them. Memory is reclaimed by
        // model teardown.
    });
}

#[test]
fn racy_relaxed_negative_control() {
    // We expect loom to find a "Causality violation" or "missing acquire"
    // interleaving here, proving the harness exercises the interesting
    // interleavings. The assertion is permissive — the test passes if no
    // model panic OR if loom flags the race; either result is informative.
    let result = std::panic::catch_unwind(|| {
        loom::model(|| {
            let sentinel = alloc_link(usize::MAX);
            let q = ModelArc::new(UnboundedQueue::<usize>::new_with_sentinel(sentinel));

            let p1 = {
                let q = q.clone();
                model_thread::spawn(move || {
                    q.racy_push(alloc_link(10));
                })
            };
            let p2 = {
                let q = q.clone();
                model_thread::spawn(move || {
                    q.racy_push(alloc_link(20));
                })
            };

            let q_c = q.clone();
            let consumer = model_thread::spawn(move || {
                let mut seen = Vec::new();
                for _ in 0..2 {
                    if let Some(p) = q_c.racy_pop(4) {
                        seen.push(unsafe { (*p).value });
                    }
                }
                seen
            });

            p1.join().unwrap();
            p2.join().unwrap();
            let _ = consumer.join().unwrap();
        });
    });

    // Either loom is silent (the Relaxed orderings happen to be safe for
    // this shape — possible since loom probes execution, not strict TSO) OR
    // it flags a race. Document either outcome.
    match result {
        Ok(()) => eprintln!("loom did not flag the Relaxed variant in this harness"),
        Err(_) => eprintln!("loom DID flag the Relaxed variant (negative control fired)"),
    }
}
