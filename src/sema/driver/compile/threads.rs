use crate::{ThreadCaches, for_each_parallel_while, region_pool};
use bun_threading::Guarded;
use bun_threading::thread_pool::{Batch, Node, Task};
use core::ffi::c_void;

pub fn drop_thread_caches(caches: &ThreadCaches) {
    caches.idle.lock().clear();
}

pub fn run_on_one_thread_while<A: Send, B>(
    caches: &ThreadCaches,
    on_one_thread: impl FnOnce() -> A + Send,
    meanwhile: impl FnOnce() -> B,
) -> (A, B) {
    let (task, result) = (Guarded::new(Some(on_one_thread)), Guarded::new(None));
    let run_task = |_: usize| {
        let task = task.lock().take().expect("one index");
        *result.lock() = Some(task());
    };
    let (mut meanwhile, mut other_result) = (Some(meanwhile), None);
    for_each_parallel_while(caches, 1, 1, 1, &run_task, &mut || {
        other_result = meanwhile.take().map(|meanwhile| meanwhile());
    });
    let result = result.lock().take();
    (
        result.expect("the region ended"),
        other_result.expect("called once"),
    )
}

pub unsafe extern "C" fn run_on_region_thread(
    run: unsafe extern "C" fn(*mut c_void),
    argument: *mut c_void,
) {
    #[repr(C)]
    struct Call {
        task: Task,
        run: unsafe extern "C" fn(*mut c_void),
        argument: *mut c_void,
    }
    unsafe fn call(task: *mut Task) {
        // SAFETY: the first field of the `Call` allocated below, which is queued once.
        let call = unsafe { bun_core::heap::take(task.cast::<Call>()) };
        // SAFETY: the promise of whoever queued it.
        unsafe { (call.run)(call.argument) };
    }
    let task = Task {
        node: Node::default(),
        callback: call,
    };
    let call = bun_core::heap::into_raw(Box::new(Call {
        task,
        run,
        argument,
    }));
    region_pool().schedule(Batch::from(call.cast::<Task>()));
}

pub fn wake_idle_region_threads() {
    region_pool().wake_for_idle_events();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::for_each_parallel_in_runs;
    use std::sync::Once;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    fn set_up_output() {
        static OUTPUT: Once = Once::new();
        OUTPUT.call_once(bun_core::output::stdio::init);
    }

    #[test]
    fn regions_started_on_pool_threads_visit_each_index_once() {
        set_up_output();
        const OUTER: usize = 64;
        const INNER: usize = 1000;
        let caches = ThreadCaches::default();
        let visits: Vec<AtomicUsize> = (0..OUTER * INNER).map(|_| AtomicUsize::new(0)).collect();
        for_each_parallel_in_runs(&caches, 8, OUTER, 1, &|outer| {
            for_each_parallel_in_runs(&caches, 8, INNER, 7, &|inner| {
                visits[outer * INNER + inner].fetch_add(1, Ordering::Relaxed);
            });
        });
        assert!(
            visits
                .iter()
                .all(|visit| visit.load(Ordering::Relaxed) == 1)
        );
    }

    #[test]
    fn region_started_on_pool_thread_gets_idle_threads() {
        set_up_output();
        if region_pool().max_threads() < 3 {
            return;
        }
        let caches = ThreadCaches::default();
        let arrived = AtomicUsize::new(0);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let ((), ()) = run_on_one_thread_while(
            &caches,
            || {
                for_each_parallel_in_runs(&caches, 2, 2, 1, &|_| {
                    arrived.fetch_add(1, Ordering::SeqCst);
                    while arrived.load(Ordering::SeqCst) < 2 {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "no thread joined the region"
                        );
                        std::thread::yield_now();
                    }
                });
            },
            || {},
        );
        assert_eq!(arrived.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn region_started_on_pool_thread_gets_threads_that_become_idle_later() {
        set_up_output();
        let threads = region_pool().max_threads();
        if threads < 3 {
            return;
        }
        let caches = ThreadCaches::default();
        let (busy, gives_up) = (AtomicUsize::new(0), AtomicBool::new(false));
        let (has_begun, has_joined) = (AtomicBool::new(false), AtomicBool::new(false));
        let started = std::time::Instant::now();
        let is_late = |seconds: u64| started.elapsed() > std::time::Duration::from_secs(seconds);
        for_each_parallel_in_runs(&caches, threads, threads, 1, &|outer| {
            busy.fetch_add(1, Ordering::SeqCst);
            if outer != 0 {
                while !has_begun.load(Ordering::SeqCst) && !gives_up.load(Ordering::SeqCst) {
                    std::thread::yield_now();
                }
                return;
            }
            while busy.load(Ordering::SeqCst) < threads {
                if is_late(5) {
                    return gives_up.store(true, Ordering::SeqCst);
                }
                std::thread::yield_now();
            }
            let starter = std::thread::current().id();
            for_each_parallel_in_runs(&caches, 2, 1 << 22, 1, &|_| {
                if !has_begun.load(Ordering::SeqCst) {
                    has_begun.store(true, Ordering::SeqCst);
                }
                if std::thread::current().id() != starter {
                    has_joined.store(true, Ordering::SeqCst);
                }
                if !has_joined.load(Ordering::SeqCst) {
                    assert!(!is_late(25), "no thread joined the region");
                    std::thread::yield_now();
                }
            });
        });
        assert!(has_joined.load(Ordering::SeqCst) || gives_up.load(Ordering::SeqCst));
    }

    fn pool_without_spare_threads() -> &'static bun_threading::ThreadPool {
        let config = bun_threading::thread_pool::Config {
            max_threads: 8,
            ..Default::default()
        };
        let pool = bun_threading::ThreadPool::init(config).named("Test");
        Box::leak(Box::new(pool.without_spare_threads()))
    }

    fn schedule_on(pool: &'static bun_threading::ThreadPool, run: impl FnOnce() + Send + 'static) {
        pool.schedule(task_that_calls(run));
    }

    fn task_that_calls(run: impl FnOnce() + Send + 'static) -> Batch {
        #[repr(C)]
        struct Call {
            task: Task,
            run: Box<dyn FnOnce() + Send>,
        }
        unsafe fn call(task: *mut Task) {
            // SAFETY: the first field of the `Call` allocated below, which is queued once.
            let call = unsafe { bun_core::heap::take(task.cast::<Call>()) };
            (call.run)();
        }
        let task = Task {
            node: Node::default(),
            callback: call,
        };
        let run: Box<dyn FnOnce() + Send> = Box::new(run);
        let call = bun_core::heap::into_raw(Box::new(Call { task, run }));
        Batch::from(call.cast::<Task>())
    }

    fn wait_until(is_done: impl Fn() -> bool, what: &str) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while !is_done() {
            assert!(std::time::Instant::now() < deadline, "{what}");
            std::thread::yield_now();
        }
    }

    #[test]
    fn pool_without_spare_threads_starts_one_thread_for_one_task() {
        set_up_output();
        let pool = pool_without_spare_threads();
        static DONE: AtomicUsize = AtomicUsize::new(0);
        for round in 1..=20 {
            schedule_on(pool, || {
                DONE.fetch_add(1, Ordering::SeqCst);
            });
            wait_until(
                || DONE.load(Ordering::SeqCst) == round,
                "the task never ran",
            );
            wait_until(
                || pool.available_threads() == 8,
                "the thread never came to rest",
            );
        }
        assert_eq!(pool.started_threads(), 1);
    }

    #[test]
    fn pool_without_spare_threads_starts_a_thread_for_each_waiting_task() {
        set_up_output();
        let pool = pool_without_spare_threads();
        static ARRIVED: AtomicUsize = AtomicUsize::new(0);
        let meet = |all: usize| {
            ARRIVED.fetch_add(1, Ordering::SeqCst);
            wait_until(
                || ARRIVED.load(Ordering::SeqCst) >= all,
                "a task has no thread",
            );
        };
        for _ in 0..4 {
            schedule_on(pool, move || meet(4));
        }
        wait_until(
            || ARRIVED.load(Ordering::SeqCst) == 4,
            "a task has no thread",
        );
        schedule_on(pool, move || {
            for _ in 0..3 {
                pool.schedule_inside_thread_pool(task_that_calls(move || meet(8)));
            }
            meet(8);
        });
        wait_until(
            || ARRIVED.load(Ordering::SeqCst) == 8,
            "a task has no thread",
        );
    }

    #[test]
    fn pool_without_spare_threads_runs_every_task() {
        set_up_output();
        let pool = pool_without_spare_threads();
        static DONE: AtomicUsize = AtomicUsize::new(0);
        const SCHEDULERS: usize = 4;
        const TASKS: usize = 20_000;
        std::thread::scope(|scope| {
            for _ in 0..SCHEDULERS {
                scope.spawn(|| {
                    for _ in 0..TASKS {
                        schedule_on(pool, || {
                            DONE.fetch_add(1, Ordering::SeqCst);
                        });
                    }
                });
            }
        });
        wait_until(
            || DONE.load(Ordering::SeqCst) == SCHEDULERS * TASKS,
            "a task never ran",
        );
    }

    #[test]
    fn tasks_that_wait_get_the_threads_that_a_pool_is_allowed_later() {
        set_up_output();
        let pool = pool_without_spare_threads();
        pool.limit_threads(2);
        static ARRIVED: AtomicUsize = AtomicUsize::new(0);
        for _ in 0..6 {
            schedule_on(pool, || {
                ARRIVED.fetch_add(1, Ordering::SeqCst);
                wait_until(
                    || ARRIVED.load(Ordering::SeqCst) >= 6,
                    "a task has no thread",
                );
            });
        }
        wait_until(
            || ARRIVED.load(Ordering::SeqCst) == 2,
            "too few threads at first",
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(
            (ARRIVED.load(Ordering::SeqCst), pool.started_threads()),
            (2, 2)
        );
        pool.allow_threads(3);
        wait_until(
            || ARRIVED.load(Ordering::SeqCst) == 3,
            "the third thread never came",
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(
            (ARRIVED.load(Ordering::SeqCst), pool.started_threads()),
            (3, 3)
        );
        pool.allow_threads(2);
        pool.allow_threads(8);
        wait_until(
            || ARRIVED.load(Ordering::SeqCst) == 6,
            "a task has no thread",
        );
        assert_eq!(pool.started_threads(), 6);
    }

    #[test]
    fn region_on_a_limited_pool_visits_each_index_once() {
        set_up_output();
        let pool = pool_without_spare_threads();
        pool.limit_threads(2);
        let visits: Vec<AtomicUsize> = (0..1000).map(|_| AtomicUsize::new(0)).collect();
        let next = AtomicUsize::new(0);
        pool.each(
            (),
            |(), (), _| loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some(visit) = visits.get(index) else {
                    break;
                };
                visit.fetch_add(1, Ordering::Relaxed);
            },
            &mut vec![(); 8],
        );
        assert!(
            visits
                .iter()
                .all(|visit| visit.load(Ordering::Relaxed) == 1)
        );
        assert!(pool.started_threads() <= 2);
    }
}
