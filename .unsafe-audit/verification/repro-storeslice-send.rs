// Concrete reproduction of the StoreSlice<T> unconditional Send/Sync bug
// found in src/ast/nodes.rs:339-340.
//
// Run with: rustc this_file.rs -o /tmp/repro && /tmp/repro
//
// Behavior:
//   - WITH the bug (current `unsafe impl<T> Send/Sync for StoreSlice<T>`): compiles cleanly, prints the laundering message
//   - AFTER the fix (adding `<T: Send>` / `<T: Sync>` bounds): produces compile error
//     "the trait bound `Cell<u32>: Sync` is not satisfied" — exactly the protection we want.
//
// This compile-fail-after-fix property would be a perfect test fixture for the
// PR landing the fix:
//   #[test] fn storeslice_should_not_launder_cell() { /* this code, in a compile-fail trybuild test */ }
use std::cell::Cell;

// Simulated StoreSlice<T> with the CURRENT impl from src/ast/nodes.rs:322-340:
struct StoreSlice<T> {
    _ptr: std::ptr::NonNull<T>,
    _len: u32,
}

// THE BUG — unconditional impls (mirrors src/ast/nodes.rs:339-340):
unsafe impl<T> Send for StoreSlice<T> {}
unsafe impl<T> Sync for StoreSlice<T> {}

// THE FIX (matches sister type StoreRef<T> at src/ast/nodes.rs:39-40):
// unsafe impl<T: Send> Send for StoreSlice<T> {}
// unsafe impl<T: Sync> Sync for StoreSlice<T> {}

// Function that requires Send + Sync — Cell<u32> is !Sync so this should
// fail to compile for StoreSlice<Cell<u32>> after the fix.
fn requires_send_sync<T: Send + Sync>(_t: T) {}

fn main() {
    let s: StoreSlice<Cell<u32>> = StoreSlice {
        _ptr: std::ptr::NonNull::dangling(),
        _len: 0,
    };
    // Compiles only because of the buggy unconditional impl above.
    // After fix: error[E0277]: `Cell<u32>` cannot be shared between threads safely
    requires_send_sync(s);
    println!("Cell<u32> launders through StoreSlice — the bug is reproducible.");
}
