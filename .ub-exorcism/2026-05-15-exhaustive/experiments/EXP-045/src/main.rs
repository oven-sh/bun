use std::cell::{Cell, UnsafeCell};
use std::thread;

#[repr(transparent)]
struct JsCell<T>(UnsafeCell<T>);

// Mirrors src/jsc/JSCell.rs:126-128.
unsafe impl<T> Sync for JsCell<T> {}
unsafe impl<T> Send for JsCell<T> {}

impl<T> JsCell<T> {
    pub const fn new(value: T) -> Self {
        Self(UnsafeCell::new(value))
    }

    pub fn get(&self) -> &T {
        unsafe { &*self.0.get() }
    }
}

static CELL: JsCell<Cell<u32>> = JsCell::new(Cell::new(0));

fn main() {
    let handle = thread::spawn(|| {
        for _ in 0..1000 {
            let v = CELL.get().get();
            CELL.get().set(v.wrapping_add(1));
        }
    });

    for _ in 0..1000 {
        let v = CELL.get().get();
        CELL.get().set(v.wrapping_add(1));
    }

    handle.join().unwrap();
}
