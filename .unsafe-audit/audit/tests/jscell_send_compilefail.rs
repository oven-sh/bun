// =========================================================================
// trybuild compile-fail fixture
// Bug:      pass-3 PUB-N-A — JsCell<T> unconditional Send + Sync
//           (src/jsc/JSCell.rs:126-128)
// Catches:  laundering of !Send payloads through JsCell<T>: Send
// Today:    COMPILES — `unsafe impl<T> Send for JsCell<T> {}` is wholly
//           unbounded, so JsCell<Rc<u32>>: Send even though Rc<u32>: !Send.
//           That makes it possible to construct a JsCell holding a JS-thread
//           atomic-string Rc and move it to a worker thread, which fires
//           the AtomStringImpl wasRemoved abort.
// After fix: FAILS TO COMPILE. The audit-recommended bound is:
//
//               unsafe impl<T: Send> Send for JsCell<T> {}
//               unsafe impl<T: Sync> Sync for JsCell<T> {}
//
//           Rationale: JsCell is "Cell<T> with extra unsafe escape hatches".
//           Its safety doc says "Cross-thread access goes through
//           ConcurrentTask, which never hands out &JsCell" — so anything
//           that *could* re-enter the JsCell on another thread must have a
//           !Send payload reflected in the bound.
//
// To wire in: add to `tests/compile_fail.rs` in `bun_jsc` crate.
// =========================================================================

#![allow(dead_code)]

use std::rc::Rc;

use bun_jsc::JsCell;

fn requires_send<T: Send>(_: T) {}

fn main() {
    // Rc<u32>: !Send. After fix: JsCell<Rc<u32>>: !Send → E0277 here.
    let cell: JsCell<Rc<u32>> = JsCell::new(Rc::new(0));
    requires_send(cell);
}
