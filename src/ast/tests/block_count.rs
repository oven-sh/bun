//! Block allocations of the AST block store, counted through a `#[global_allocator]`.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::ptr::NonNull;

use bun_ast::E;
use bun_ast::expr::data::Store as ExprStore;

// A block has 64 payload bytes: eight `u64` nodes fill it.
bun_ast::new_store!(probe_store, [u64], 4);

use probe_store::Store;

thread_local! {
    static ALLOCATED: Cell<usize> = const { Cell::new(0) };
    static FREED: Cell<usize> = const { Cell::new(0) };
    static LAST_SIZE: Cell<usize> = const { Cell::new(0) };
}

/// A block is the one allocation in these tests that is 16-aligned.
fn is_block(layout: Layout) -> bool {
    layout.align() == 16
}

struct CountBlocks;

// SAFETY: every call goes to `System` unchanged.
unsafe impl GlobalAlloc for CountBlocks {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if is_block(layout) {
            ALLOCATED.set(ALLOCATED.get() + 1);
            LAST_SIZE.set(layout.size());
        }
        // SAFETY: the caller's contract, passed on.
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        if is_block(layout) {
            FREED.set(FREED.get() + 1);
        }
        // SAFETY: the caller's contract, passed on.
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static GLOBAL: CountBlocks = CountBlocks;

#[test]
fn untouched_store_allocates_no_block() {
    let store = Store::init();
    // SAFETY: `init()` returned the pointer; destroyed once, here.
    unsafe {
        Store::reset(&mut *store);
        Store::destroy(store);
    }

    assert_eq!((ALLOCATED.get(), FREED.get()), (0, 0));
}

#[test]
fn blocks_are_allocated_once_and_reused_after_reset() {
    let store = Store::init();
    // SAFETY: `init()` returned the pointer; destroyed at the end.
    let append = move |i: u64| Store::append(unsafe { &mut *store }, i);

    let first = append(0);
    assert_eq!(ALLOCATED.get(), 1);
    assert_eq!(LAST_SIZE.get(), 64 + 16, "payload and a 16-byte header");

    // Two more blocks of eight `u64`.
    let mut before = vec![first];
    before.extend((1..24).map(append));
    assert_eq!(ALLOCATED.get(), 3);

    // SAFETY: as above.
    Store::reset(unsafe { &mut *store });
    let after: Vec<NonNull<u64>> = (0..24).map(append).collect();
    assert_eq!(before, after);
    assert_eq!(ALLOCATED.get(), 3, "reset keeps the blocks");

    assert_eq!(FREED.get(), 0);
    // SAFETY: `init()` returned the pointer; destroyed once, here.
    unsafe { Store::destroy(store) };
    assert_eq!(FREED.get(), 3);
}

#[test]
fn expr_store_allocates_its_block_on_the_first_append() {
    ExprStore::create();
    ExprStore::reset();
    assert_eq!(ALLOCATED.get(), 0);

    let first = ExprStore::append(E::Number::new(1.0));
    assert_eq!(ALLOCATED.get(), 1);

    ExprStore::reset();
    let again = ExprStore::append(E::Number::new(2.0));
    assert_eq!(again.as_ptr(), first.as_ptr());
    assert_eq!(ALLOCATED.get(), 1);

    ExprStore::deinit();
    assert_eq!(FREED.get(), 1);
}
