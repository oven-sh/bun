#![deny(unsafe_op_in_unsafe_fn)]

use std::cell::UnsafeCell;
use std::sync::atomic::{fence, Ordering};
use std::sync::Arc;

fn old_callback() -> u8 {
    1
}

fn new_callback() -> u8 {
    2
}

struct Request {
    callback: fn() -> u8,
}

struct Shared(UnsafeCell<Request>);

// Mirrors the intended cross-thread publication: the whole point is that both
// producer and consumer can touch the request from different threads.
unsafe impl Sync for Shared {}

impl Request {
    fn store_callback_seq_cst_like(&mut self, cb: fn() -> u8) {
        unsafe {
            core::ptr::write_volatile(&raw mut self.callback, cb);
        }
        fence(Ordering::SeqCst);
    }
}

fn main() {
    let shared = Arc::new(Shared(UnsafeCell::new(Request {
        callback: old_callback,
    })));

    std::thread::scope(|scope| {
        let writer = Arc::clone(&shared);
        scope.spawn(move || {
            let request = unsafe { &mut *writer.0.get() };
            request.store_callback_seq_cst_like(new_callback);
        });

        let reader = Arc::clone(&shared);
        scope.spawn(move || {
            let request = unsafe { &*reader.0.get() };
            let cb = request.callback;
            core::hint::black_box(cb());
        });
    });
}
