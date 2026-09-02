//! `bun:internal-for-testing` bridge for `bun_threading::SignalRing`. The
//! ring's real producers are signal handlers on threads the kernel picks, so
//! a JS test cannot line two up; this drives the ring from plain threads.

use core::sync::atomic::{AtomicUsize, Ordering};

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_threading::SignalRing;

/// Same capacity as `PosixSignalHandle`.
const CAPACITY: usize = 8192;

/// `probe(producers, perProducer)`: each producer thread enqueues its own
/// number `perProducer` times while this thread dequeues. Returns
/// `{ accepted: number[], dequeued: number[], zeros, unknown }`.
pub(crate) fn probe(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let producers = frame.argument(0).to_int32().clamp(1, 64) as u8;
    let per_producer = frame.argument(1).to_int32().clamp(1, 1_000_000) as usize;

    let ring = Box::new(SignalRing::<CAPACITY>::new());
    let done = AtomicUsize::new(0);
    let mut dequeued = vec![0usize; usize::from(producers)];
    let mut zeros = 0usize;
    let mut unknown = 0usize;

    let accepted: Vec<usize> = std::thread::scope(|scope| {
        let workers: Vec<_> = (1..=producers)
            .map(|signal| {
                let (ring, done) = (&*ring, &done);
                scope.spawn(move || {
                    let mut accepted = 0usize;
                    while accepted < per_producer {
                        if ring.enqueue(signal) {
                            accepted += 1;
                        } else {
                            std::thread::yield_now();
                        }
                    }
                    done.fetch_add(1, Ordering::Release);
                    accepted
                })
            })
            .collect();

        let mut producers_done = false;
        loop {
            match ring.dequeue() {
                Some(0) => zeros += 1,
                Some(signal) if signal <= producers => dequeued[usize::from(signal) - 1] += 1,
                Some(_) => unknown += 1,
                None if producers_done => break,
                None => {
                    // Only a `None` read after `done` reached `producers` means empty.
                    producers_done = done.load(Ordering::Acquire) == usize::from(producers);
                    std::hint::spin_loop();
                }
            }
        }

        workers
            .into_iter()
            .map(|worker| worker.join().expect("probe producer thread panicked"))
            .collect()
    });

    let counts_to_js = |counts: &[usize]| -> JsResult<JSValue> {
        let array = JSValue::create_empty_array(global, counts.len())?;
        for (i, count) in counts.iter().enumerate() {
            array.put_index(global, i as u32, JSValue::js_number(*count as f64))?;
        }
        Ok(array)
    };

    let result = JSValue::create_empty_object(global, 4);
    result.put(global, "accepted", counts_to_js(&accepted)?);
    result.put(global, "dequeued", counts_to_js(&dequeued)?);
    result.put(global, "zeros", JSValue::js_number(zeros as f64));
    result.put(global, "unknown", JSValue::js_number(unknown as f64));
    Ok(result)
}
