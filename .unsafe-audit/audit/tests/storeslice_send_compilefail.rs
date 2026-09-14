// =========================================================================
// trybuild compile-fail fixture
// Bug:      pass-2 finding `pre-existing-ub-002` — StoreSlice<T> Send/Sync
//           unconditional (src/ast/nodes.rs:339-340)
// Catches:  laundering of !Send / !Sync payloads (e.g. Cell<u32>) through
//           StoreSlice<T>
// Today:    COMPILES (the bug). `unsafe impl<T> Send/Sync for StoreSlice<T> {}`
//           gives StoreSlice<Cell<u32>>: Send + Sync even though Cell<u32>
//           is itself !Sync.
// After fix: FAILS TO COMPILE with E0277 — exactly the protection the
//           audit recommends. The proposed fix mirrors the sister
//           StoreRef<T> impl (src/ast/nodes.rs:39-40):
//
//               unsafe impl<T: Send> Send for StoreSlice<T> {}
//               unsafe impl<T: Sync> Sync for StoreSlice<T> {}
//
// To wire in: add as a member of a `tests/compile_fail.rs` trybuild harness
// in the `bun_ast` crate; see audit/tests/README.md.
// =========================================================================

#![allow(dead_code)]

use std::cell::Cell;

// Pull in the actual StoreSlice type so the test is testing the real impl,
// not a copy. (When the fix lands and adds `<T: Send>` / `<T: Sync>` bounds,
// this file becomes a compile error — that is the regression catcher.)
use bun_ast::nodes::StoreSlice;

fn requires_send<T: Send>(_: T) {}
fn requires_sync<T: Sync>(_: T) {}

fn main() {
    // Cell<u32> is !Sync. Laundering it through StoreSlice would be the bug.
    let s: StoreSlice<Cell<u32>> = StoreSlice::EMPTY;

    // After the fix lands, BOTH of these become hard compile errors:
    //   error[E0277]: `Cell<u32>` cannot be shared between threads safely
    //   error[E0277]: the trait `Sync` is not implemented for `Cell<u32>`
    requires_send(s);
    requires_sync(s);
}
