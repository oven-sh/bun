use std::cell::UnsafeCell;
use std::sync::{Arc, Barrier};
use std::thread;

struct State {
    buf: Vec<u8>,
}

// Mirrors `IOWriter { state: UnsafeCell<State> }` plus
// `unsafe impl Send/Sync for IOWriter`.
struct IOWriterShape {
    state: UnsafeCell<State>,
}

unsafe impl Send for IOWriterShape {}
unsafe impl Sync for IOWriterShape {}

impl IOWriterShape {
    fn new() -> Self {
        Self {
            state: UnsafeCell::new(State { buf: Vec::new() }),
        }
    }

    // Mirrors public `IOWriter::enqueue(&self, ...)` mutating `self.state()`.
    fn enqueue(&self, byte: u8) {
        let state = unsafe { &mut *self.state.get() };
        state.buf.push(byte);
    }
}

fn main() {
    let writer = Arc::new(IOWriterShape::new());
    let barrier = Arc::new(Barrier::new(3));

    let mut joins = Vec::new();
    for byte in [1_u8, 2] {
        let writer = Arc::clone(&writer);
        let barrier = Arc::clone(&barrier);
        joins.push(thread::spawn(move || {
            barrier.wait();
            writer.enqueue(byte);
        }));
    }

    barrier.wait();
    for join in joins {
        join.join().unwrap();
    }

    std::hint::black_box(unsafe { &*writer.state.get() }.buf.len());
}
