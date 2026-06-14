//! Loom model: `PackageManager::pending_tasks` Release/Acquire happens-before.
//!
//! SOURCE-ANCHOR: src/install/PackageManager.rs:425 (`pending_tasks: AtomicU32`)
//! SOURCE-ANCHOR: src/install/PackageManager/runTasks.rs:1582-1597 (load/inc/dec)
//! SOURCE-ANCHOR: src/install/PackageInstall.rs:730-737 (worker decrement after task done)
//!
//! Hypothesis: install workers write per-task results into a shared buffer,
//! then `pending_tasks.fetch_sub(1, Release)`. The main thread polls
//! `pending_tasks.load(Acquire) == 0` and, when it sees zero, reads the
//! results buffer.  The Release/Acquire pair must establish happens-before
//! so the main thread sees every worker's writes after the load.
//!
//! This is the textbook "completion counter" pattern — load(Acquire)==0 is
//! the synchronisation gate. Loom can prove it by stamping a result slot
//! per worker BEFORE the dec, then asserting the main thread always reads
//! the stamp after observing 0.
//!
//! Why this matters: `increment_pending_tasks` is Relaxed (start of task,
//! no side effects yet) and `decrement_pending_tasks` is Release. The
//! `Acquire` on the main-thread load is what synchronises with the workers'
//! Release decs. If anyone weakens the load to Relaxed (a tempting "I'm
//! just checking a counter" change), the main thread could read stale
//! results buffers — manifesting as missing/zero install result fields.

#![cfg(loom)]

use loom::cell::UnsafeCell;
use loom::sync::Arc;
use loom::sync::atomic::{AtomicU32, Ordering};
use loom::thread;

/// Per-worker result slot; mirrors the result field a worker writes into a
/// shared `Vec<Result>` before decrementing the pending counter.
struct ResultSlot {
    /// Worker writes this before `fetch_sub(Release)`. Main reads after
    /// `load(Acquire) == 0`. Must always read the worker-written value.
    value: UnsafeCell<u32>,
}

unsafe impl Send for ResultSlot {}
unsafe impl Sync for ResultSlot {}

/// Faithful subset of `PackageManager`: the atomic counter + N result slots.
struct PackageManager {
    pending_tasks: AtomicU32,
    /// Two slots = two-worker model. Real code has hundreds; the
    /// happens-before discipline is per-slot.
    slots: [ResultSlot; 2],
}

impl PackageManager {
    fn new() -> Self {
        Self {
            pending_tasks: AtomicU32::new(2),
            slots: [
                ResultSlot {
                    value: UnsafeCell::new(0),
                },
                ResultSlot {
                    value: UnsafeCell::new(0),
                },
            ],
        }
    }
}

/// Worker side (`PackageInstall::UninstallTask::run` and similar at PackageInstall.rs:728-737).
/// Writes the result, then `fetch_sub(1, Release)`.
fn worker_complete(pm: &PackageManager, slot_idx: usize, value: u32) {
    // Write the per-worker result FIRST. Real code touches many fields here
    // (output flags, error strings, install-method enum). The Release on the
    // decrement is what publishes them.
    //
    // SAFETY: each worker exclusively owns its slot; this is the only writer.
    pm.slots[slot_idx]
        .value
        .with_mut(|p| unsafe { core::ptr::write_volatile(p, value) });
    // Then the Release decrement.
    let _ = pm.pending_tasks.fetch_sub(1, Ordering::Release);
}

/// Main thread (`PackageManager/install_with_manager.rs:976-987`).
/// Polls until pending_tasks==0, then reads each result slot.
fn main_poll_and_read(pm: &PackageManager, expected: [u32; 2]) {
    // Spin until the workers have all signalled completion. In real code this
    // is wrapped in `auto_tick` / wake-on-libuv but the model just spins; loom
    // explores both "loop never observes 0" and "loop observes 0" schedules.
    loop {
        let pending = pm.pending_tasks.load(Ordering::Acquire);
        if pending == 0 {
            break;
        }
        loom::thread::yield_now();
    }
    // After the Acquire load == 0, every worker's Release dec must be
    // visible, so every slot write happens-before this read.
    for (i, slot) in pm.slots.iter().enumerate() {
        let v = slot.value.with(|p| unsafe { core::ptr::read_volatile(p) });
        assert_eq!(
            v, expected[i],
            "main read stale result slot[{i}]: got {v}, expected {}",
            expected[i],
        );
    }
}

/// Test 1: two workers each write a result and decrement. Main polls and
/// must see both writes.
///
/// Expected outcomes:
///   - Default (Release dec + Acquire load): PASS — no stale reads.
///   - Relaxed load (see `loom_sanity_relaxed_should_race`): FAIL — main
///     may observe 0 on the counter but stale 0s in the slots.
#[test]
fn loom_release_acquire_completion_gate() {
    let mut builder = loom::model::Builder::new();
    builder.preemption_bound = Some(3);
    builder.check(|| {
        let pm = Arc::new(PackageManager::new());

        let pm1 = Arc::clone(&pm);
        let w1 = thread::spawn(move || {
            worker_complete(&pm1, 0, 0x1111_AAAA);
        });

        let pm2 = Arc::clone(&pm);
        let w2 = thread::spawn(move || {
            worker_complete(&pm2, 1, 0x2222_BBBB);
        });

        let pm3 = Arc::clone(&pm);
        let m = thread::spawn(move || {
            main_poll_and_read(&pm3, [0x1111_AAAA, 0x2222_BBBB]);
        });

        w1.join().unwrap();
        w2.join().unwrap();
        m.join().unwrap();
    });
}

/// Negative control: weaken the main-thread load to Relaxed. This breaks the
/// Release→Acquire synchronisation; loom should report a data race on the
/// slot reads (or an assertion failure on the stale 0).
///
/// Marked `#[ignore]` so default runs are clean.
#[test]
#[ignore]
fn loom_sanity_relaxed_should_race() {
    fn main_poll_relaxed(pm: &PackageManager) {
        loop {
            // DELIBERATELY Relaxed — should let stale slot reads through
            let pending = pm.pending_tasks.load(Ordering::Relaxed);
            if pending == 0 {
                break;
            }
            loom::thread::yield_now();
        }
        // No happens-before with worker writes; slot reads may be 0.
        for slot in pm.slots.iter() {
            let v = slot.value.with(|p| unsafe { core::ptr::read_volatile(p) });
            assert_ne!(v, 0, "slot was 0 — stale read under Relaxed");
        }
    }

    loom::model(|| {
        let pm = Arc::new(PackageManager::new());
        let pm1 = Arc::clone(&pm);
        let w1 = thread::spawn(move || worker_complete(&pm1, 0, 0x1111_AAAA));
        let pm2 = Arc::clone(&pm);
        let w2 = thread::spawn(move || worker_complete(&pm2, 1, 0x2222_BBBB));
        let pm3 = Arc::clone(&pm);
        let m = thread::spawn(move || main_poll_relaxed(&pm3));

        w1.join().unwrap();
        w2.join().unwrap();
        m.join().unwrap();
    });
}
