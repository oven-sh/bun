use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use core::time::Duration;
use std::sync::mpsc;
use std::time::Instant;

use bun_engine_platform::suspend::{SuspendLock, ThreadHandle};
use bun_engine_platform::{StackBounds, clock, machine};
use bun_engine_standalone as _;

#[test]
fn bounds_contain_the_frame() {
    let local = 0u8;
    let bounds = StackBounds::current();
    assert!(bounds.contains((&raw const local).addr()));
    assert!(!bounds.contains(bounds.end));
}

#[test]
fn machine_has_memory_and_processors() {
    assert!(machine::ram_size() >= 1 << 20);
    let expected = std::thread::available_parallelism().unwrap().get();
    assert!((1..=expected).contains(&(machine::processor_count() as usize)));
}

#[test]
fn clocks_advance() {
    let (monotonic, wall) = (clock::monotonic_seconds(), clock::wall_seconds());
    while clock::monotonic_seconds() == monotonic {}
    assert!(clock::monotonic_seconds() > monotonic);
    assert!(wall > 1.7e9);
    let milliseconds = clock::wall_milliseconds() as f64;
    assert!((wall * 1e3 - 2.0..=clock::wall_seconds() * 1e3 + 1.0).contains(&milliseconds));
}

/// Runs `body` while each of the threads counts as fast as it can.
fn with_counting_threads<const N: usize>(
    body: impl FnOnce([(ThreadHandle, StackBounds, &AtomicU64); N]),
) {
    let counters = [const { AtomicU64::new(0) }; N];
    let is_done = AtomicBool::new(false);
    std::thread::scope(|scope| {
        let threads = counters.each_ref().map(|counter| {
            let (sender, receiver) = mpsc::channel();
            let is_done = &is_done;
            scope.spawn(move || {
                let thread = (ThreadHandle::current(), StackBounds::current());
                sender.send(thread).unwrap();
                while !is_done.load(Ordering::Relaxed) {
                    counter.fetch_add(1, Ordering::Relaxed);
                }
            });
            let (handle, bounds) = receiver.recv().unwrap();
            (handle, bounds, counter)
        });
        body(threads);
        is_done.store(true, Ordering::Relaxed);
    });
}

#[test]
fn a_suspended_thread_stands_still() {
    with_counting_threads(|[(thread, bounds, counter)]| {
        let mut lock = SuspendLock::lock();
        let suspended = thread.suspend(&mut lock).unwrap();
        assert!(bounds.contains(suspended.registers().stack_pointer));
        assert!(suspended.registers().program_counter != 0);
        let count = counter.load(Ordering::Relaxed);
        // Nothing signals that a thread has not run. A sleep need not end among the signals of another test.
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(20) {}
        let count_afterwards = counter.load(Ordering::Relaxed);
        drop(suspended);
        assert_eq!(count, count_afterwards);
        while counter.load(Ordering::Relaxed) == count {}
    });
}

#[test]
fn each_request_reaches_its_thread() {
    with_counting_threads::<3>(|threads| {
        for (thread, bounds, counter) in threads.iter().cycle().take(6000) {
            let mut lock = SuspendLock::lock();
            let suspended = thread.suspend(&mut lock).unwrap();
            let count = counter.load(Ordering::Relaxed);
            let is_on_its_stack = bounds.contains(suspended.registers().stack_pointer);
            let has_moved = counter.load(Ordering::Relaxed) != count;
            drop(suspended);
            assert!(is_on_its_stack && !has_moved);
        }
    });
}

#[test]
fn a_thread_that_has_ended_is_not_suspended() {
    let thread = std::thread::scope(|scope| scope.spawn(ThreadHandle::current).join().unwrap());
    assert!(thread.suspend(&mut SuspendLock::lock()).is_none());
}

#[cfg(all(unix, not(target_os = "macos")))]
#[test]
fn signals_from_elsewhere_are_ignored() {
    use bun_engine_platform::suspend::SIGNAL;

    with_counting_threads::<2>(|threads| {
        let is_done = AtomicBool::new(false);
        std::thread::scope(|scope| {
            scope.spawn(|| {
                while !is_done.load(Ordering::Relaxed) {
                    // SAFETY: the handler is installed.
                    unsafe { libc::kill(libc::getpid(), SIGNAL) };
                }
            });
            for (thread, bounds, _) in threads.iter().cycle().take(2000) {
                let mut lock = SuspendLock::lock();
                let registers = *thread.suspend(&mut lock).unwrap().registers();
                assert!(bounds.contains(registers.stack_pointer));
            }
            is_done.store(true, Ordering::Relaxed);
        });
    });
}
