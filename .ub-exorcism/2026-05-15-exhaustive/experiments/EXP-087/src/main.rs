use std::cell::UnsafeCell;

#[derive(Default)]
struct Worker {
    touched: usize,
}

struct Pool {
    // Mirrors the source shape: a shared receiver can recover a stable worker
    // allocation from an internal raw pointer map. The UnsafeCell stands in for
    // Bun's Guarded<ArrayHashMap<ThreadId, *mut Worker>> storage.
    worker: UnsafeCell<Worker>,
}

impl Pool {
    fn new() -> Self {
        Self {
            worker: UnsafeCell::new(Worker::default()),
        }
    }

    fn get_worker(&self) -> &'static mut Worker {
        unsafe { &mut *self.worker.get() }
    }
}

fn main() {
    let pool = Pool::new();

    let first = pool.get_worker();
    let second = pool.get_worker();

    first.touched = 1;
    second.touched = 2;

    std::hint::black_box((first.touched, second.touched));
}

