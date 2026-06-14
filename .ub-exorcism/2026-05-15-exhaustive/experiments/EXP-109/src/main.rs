//! EXP-109 reproducer (NEEDS_REFINEMENT for Bun/JSC integration; standalone
//! stale-handle model is Miri-confirmed).
//!
//! SOURCE-ANCHOR: src/runtime/ffi/mod.rs:438-445 (the `pub struct Compiled`
//! definition) + author's TODO at :440 ("bare JSValue on heap — rooted via
//! JSFFI.symbolsValue own: property; revisit Strong/JsRef once bun_jsc lands").
//!
//! WHAT THIS SHOWS:
//! Compiled stores a bare `JSValue` (no `Strong<JSValue>` wrapper). JSC's
//! garbage collector has no way to know the Rust side is holding this handle;
//! if the JS-side rooting chain ever breaks (e.g., user keeps only `cb.ptr`
//! and lets the FFI symbols-table object become unreachable), JSC may collect
//! the function and the next invocation of `FFI_Callback_call` dereferences a
//! stale `JSValue`.
//!
//! WHY MIRI CANNOT CONFIRM THIS DIRECTLY:
//! Miri does not simulate JSC GC. A faithful confirmation needs a Bun
//! integration test that forces `globalThis.gc()` between handle-acquisition
//! and the callback invocation. See `regression_plan/` for the Bun-level
//! test design.
//!
//! WHAT THIS REPRODUCER DOES INSTEAD:
//! Models the *Rust-side shape* of the unsoundness using a stand-in
//! `FakeJsCell` whose Drop is observable. We:
//!   1. Allocate a FakeJsCell on the heap (mimics `JSValue` pointing into JSC heap)
//!   2. Store its raw pointer "bits" in a bare `FakeJsValue { bits: usize }` field
//!      inside `FakeCompiled` (mirroring `Compiled.js_function: JSValue`)
//!   3. Drop the FakeJsCell (mimics JSC GC collecting an unrooted function)
//!   4. Invoke a faux callback that reads through the FakeJsValue bits
//!
//! The point is to show that the SHAPE is unsound — nothing in the Rust type
//! system prevents step 3 from happening between step 2 and step 4.
//!
//! Run under Miri:
//!     MIRIFLAGS="-Zmiri-strict-provenance" cargo +nightly miri run
//!
//! Expected signal:
//!     error: Undefined Behavior: trying to retag from <N> for SharedReadOnly
//!     permission at allocK[0x...], but that tag does not exist in the borrow
//!     stack for this location
//!
//! Falsifiability:
//! - If `Compiled.js_function` is changed to `Strong<JSValue>` (which roots
//!   via JSC's protected-set), the shape is sound — GC cannot collect a
//!   protected value. The author's TODO at src/runtime/ffi/mod.rs:440-441
//!   already names this fix.
//! - If JSC's protected-set tracing is shown to ALSO cover bare JSValue
//!   stored in FFI heap allocations (it does not, per JSC source), the
//!   concern dissolves. Confirm with WebKit/Source/JavaScriptCore/heap/Heap.cpp
//!   visitor logic.

use std::cell::Cell;

/// Stand-in for `JSValue` — bare bits, no GC integration.
#[derive(Copy, Clone)]
#[repr(transparent)]
struct FakeJsValue {
    bits: usize, // tagged pointer in real JSC; raw usize here for repro purposes
}

/// Stand-in for a JSCell on the JS heap. Tracked via a `dropped` flag so we
/// can detect dereference-after-drop in safe Rust.
struct FakeJsCell {
    dropped: bool,
    payload: u32, // the "function body" that the callback dispatch wants to call
}

impl Drop for FakeJsCell {
    fn drop(&mut self) {
        self.dropped = true; // mimics JSC marking the cell as collected
    }
}

/// Stand-in for `Compiled` — bare `FakeJsValue`, no Strong wrapper.
/// MIRROR of src/runtime/ffi/mod.rs:438-445.
struct FakeCompiled {
    #[allow(dead_code)]
    ptr: *mut std::ffi::c_void,
    js_function: FakeJsValue, // <-- THE EXP-109 FIELD: bare JSValue
}

/// Stand-in for `FFI_Callback_call` — reads through the bare JSValue bits.
unsafe fn ffi_callback_call(c: &FakeCompiled) -> u32 {
    // The real FFI_Callback_call dereferences the JSValue to find the function
    // cell. We mirror that here by interpreting bits as *const FakeJsCell.
    let cell_ptr = c.js_function.bits as *const FakeJsCell;
    // SAFETY (CLAIMED, NOT UPHELD): caller must ensure the cell is still alive.
    // The whole point of EXP-109 is that *nothing in the Rust type system
    // enforces this*. The author's TODO acknowledges that this should be a
    // `Strong<JSValue>` which roots via JSC, but the current code stores bits.
    let cell = unsafe { &*cell_ptr };
    if cell.dropped {
        // In real Bun: JSC's slot manager may have rewritten the bits, or the
        // memory may have been reallocated for another JSCell entirely. The
        // dereference is a heap-use-after-free.
        panic!("regression: dereferenced a collected FakeJsCell — UB in production");
    }
    cell.payload
}

fn main() {
    // Phase 1: construct the (fake) JS cell on the heap. In real Bun this is
    // a `JSFunction` allocated by JSC's MarkedSpace allocator.
    let cell_box: Box<Cell<FakeJsCell>> = Box::new(Cell::new(FakeJsCell {
        dropped: false,
        payload: 0xCAFE_BABE,
    }));

    // Phase 2: stash the raw bits in a `FakeCompiled.js_function`. In real Bun
    // this corresponds to `Compiled.js_function: JSValue = jsFn` in
    // `Function::compile_callback`.
    let bits = Box::as_ref(&cell_box) as *const Cell<FakeJsCell> as usize;
    let compiled = FakeCompiled {
        ptr: std::ptr::null_mut(),
        js_function: FakeJsValue { bits },
    };

    // Phase 3: invoke the callback while the cell is still alive (NORMAL path).
    let v = unsafe { ffi_callback_call(std::mem::transmute::<
        &FakeCompiled,
        &FakeCompiled,
    >(&compiled)) };
    println!("[exp-109] normal invocation: payload=0x{:08X}", v);

    // Phase 4: simulate JSC GC collecting the function while `compiled.js_function`
    // still holds the stale bits. In real Bun this happens when:
    //   - the user calls `globalThis.gc()`
    //   - AND the JSFFI.symbolsValue object is no longer rooted
    //   - AND the function's only reference was via that symbols table
    drop(cell_box); // <-- GC sweep

    // Phase 5: the stale callback is invoked from C-side (e.g., async I/O
    // completion that captured `cb.ptr` earlier). The bits in
    // `compiled.js_function` now reference freed memory.
    //
    // Under Miri: this dereference is heap-use-after-free.
    // Without Miri: may crash, may silently return garbage, may return a
    //               reallocated unrelated JSCell's payload.
    let v2 = unsafe { ffi_callback_call(&compiled) };
    println!("[exp-109] STALE invocation: payload=0x{:08X}", v2);
    println!("[exp-109] If this line printed, Miri was NOT enabled — \
              the dereference at FakeCompiled.js_function.bits is HUFO.");
}
