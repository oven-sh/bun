#![deny(unsafe_op_in_unsafe_fn)]

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;

#[derive(Copy, Clone)]
struct ForeignTsfnHandle(*mut ThreadSafeFunction);

// Mirrors the C ABI boundary: addon threads can copy the opaque
// napi_threadsafe_function pointer and call exported functions concurrently.
unsafe impl Send for ForeignTsfnHandle {}
unsafe impl Sync for ForeignTsfnHandle {}

struct ThreadSafeFunction {
    lock: Mutex<()>,
    dispatch_state: AtomicU8,
}

impl ThreadSafeFunction {
    fn enqueue(&mut self) {
        // Internal synchronization is too late if callers have already minted
        // concurrent `&mut ThreadSafeFunction` from the same raw handle.
        let _guard = self.lock.lock().unwrap();
        self.dispatch_state.fetch_add(1, Ordering::SeqCst);
    }
}

fn napi_call_threadsafe_function_like(func: ForeignTsfnHandle) {
    // Mirrors Bun's src/runtime/napi/napi_body.rs:2954:
    // unsafe { &mut *func }.enqueue(...)
    let tsfn = unsafe { &mut *func.0 };
    tsfn.enqueue();
}

fn main() {
    let raw = Box::into_raw(Box::new(ThreadSafeFunction {
        lock: Mutex::new(()),
        dispatch_state: AtomicU8::new(0),
    }));

    std::thread::scope(|scope| {
        let a = ForeignTsfnHandle(raw);
        let b = ForeignTsfnHandle(raw);
        scope.spawn(move || napi_call_threadsafe_function_like(a));
        scope.spawn(move || napi_call_threadsafe_function_like(b));
    });

    unsafe { drop(Box::from_raw(raw)) };
}
