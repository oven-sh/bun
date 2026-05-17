use std::cell::Cell;
use std::sync::{Arc, Barrier};
use std::thread;

struct Global {
    js_thread_only_state: Cell<u32>,
}

struct Blob {
    global_this: Cell<*const Global>,
}

unsafe impl Send for Blob {}
unsafe impl Sync for Blob {}

impl Blob {
    fn global_this(&self) -> Option<&Global> {
        let p = self.global_this.get();
        (!p.is_null()).then(|| unsafe { &*p })
    }
}

fn main() {
    let global = Box::leak(Box::new(Global {
        js_thread_only_state: Cell::new(0),
    }));
    let blob = Arc::new(Blob {
        global_this: Cell::new(global),
    });
    let barrier = Arc::new(Barrier::new(2));

    let worker_blob = Arc::clone(&blob);
    let worker_barrier = Arc::clone(&barrier);
    let worker = thread::spawn(move || {
        worker_barrier.wait();
        let global = worker_blob.global_this().unwrap();
        global.js_thread_only_state.set(1);
    });

    barrier.wait();
    let global = blob.global_this().unwrap();
    global.js_thread_only_state.set(2);
    worker.join().unwrap();
}

